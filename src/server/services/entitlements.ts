import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db, tx, type Db } from "../db";
import { loadActor, type Actor } from "../actor";
import { authenticate } from "../auth";
import { deviceIdSchema } from "../devices";
import { AppError, forbidden } from "../errors";
import { findIdpOfTenant, resolveOidcCaller } from "./sso";
import { getSigner, trustedKeys } from "../signer";
import { parseInput } from "../validate";
import { ENTITLEMENT_DOMAIN, canonicalize, type EntitlementPayload, type SignedEntitlement, type TrustedKey } from "@/lib/entitlement";
import { computeEffective } from "@/lib/effective";
import { ROLE_AUTONOMY_MAX, ROLE_PERMS } from "@/lib/hub-permissions";
import type { Level } from "@/lib/levels";
import { emailSchema, HUB_ROLE_LABEL, type HubRole } from "@/lib/validators";

/**
 * Hai cách Hub xác thực:
 *  - SSO (OIDC): token do IdP của tenant cấp, Control Plane kiểm bằng JWKS — cách DUY NHẤT khi tenant đã khai báo IdP.
 *  - Token cục bộ `nxh_…` (email + mật khẩu của Control Plane): chỉ để dev / tenant chưa có IdP. Production mặc định TẮT
 *    (bật bằng CP_LOCAL_HUB_TOKENS=1); tenant có IdP luôn bị ép dùng SSO để không vòng qua MFA / chính sách của IdP.
 */
export const HUB_TOKEN_HOURS = 12;
export function localHubTokensAllowed(): boolean {
  const v = process.env.CP_LOCAL_HUB_TOKENS;
  return v ? v === "1" : process.env.NODE_ENV !== "production";
}
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/* ───────────────────────── 1. Discover ───────────────────────── */

export interface DiscoverResult {
  apiVersion: 1;
  found: boolean;
  tenant?: { id: string; name: string; slug: string; productName: string | null; accent: string | null };
  /** Cách đăng nhập: SSO (OIDC + PKCE) nếu tenant có IdP; token cục bộ nếu không (chỉ dev); thiếu = chưa cấu hình đăng nhập. */
  auth?:
    | { method: "oidc"; issuer: string; clientId: string; scopes: string[]; deviceHeader: "X-Device-Id" }
    | { method: "local-password"; tokenEndpoint: string };
}

/**
 * Hub hỏi: "email này thuộc tổ chức nào, đăng nhập ở đâu?". Chỉ tra theo TÊN MIỀN — không tiết lộ email đó có tài khoản hay không.
 * Tổ chức tạm ngưng coi như không tìm thấy.
 */
export async function discover(input: unknown): Promise<DiscoverResult> {
  const { email } = parseInput(z.object({ email: emailSchema }), input);
  const domain = email.split("@")[1];
  const t = await (await db()).one<{ id: string; name: string; slug: string; product_name: string | null; accent: string | null }>(
    "SELECT id, name, slug, product_name, accent FROM tenants WHERE domain = $1 AND status = 'active'", [domain]);
  if (!t) return { apiVersion: 1, found: false };
  const idp = await findIdpOfTenant(await db(), t.id);
  const auth: DiscoverResult["auth"] = idp
    ? { method: "oidc", issuer: idp.issuer, clientId: idp.clientId, scopes: ["openid", "email", "profile"], deviceHeader: "X-Device-Id" }
    : localHubTokensAllowed() ? { method: "local-password", tokenEndpoint: "/v1/auth/token" } : undefined;
  return {
    apiVersion: 1,
    found: true,
    tenant: { id: t.id, name: t.name, slug: t.slug, productName: t.product_name, accent: t.accent },
    ...(auth ? { auth } : {}),
  };
}

/* ───────────────────────── 2. Token (thay IdP ở giai đoạn local) ───────────────────────── */

const tokenSchema = z.object({
  email: z.string(),
  password: z.string(),
  deviceId: deviceIdSchema,
  deviceName: z.string().trim().max(80).optional().default(""),
});

export interface HubToken { accessToken: string; tokenType: "Bearer"; expiresAt: string }

/** Đăng nhập từ Hub bằng email + mật khẩu cục bộ. Chỉ người thuộc tenant (không phải quản trị nền tảng) mới nhận token Hub. */
export async function issueHubToken(input: unknown): Promise<HubToken> {
  const v = parseInput(tokenSchema, input);
  if (!localHubTokensAllowed()) throw forbidden("Máy chủ này không cấp token mật khẩu. Hãy đăng nhập bằng SSO.");
  const userId = await authenticate(v.email, v.password);
  const actor = await loadActor(await db(), userId);
  if (!actor || !actor.tenantId) throw forbidden("Tài khoản này không dùng Hub.");
  if (await findIdpOfTenant(await db(), actor.tenantId)) throw forbidden("Tổ chức này dùng đăng nhập SSO — hãy đăng nhập qua nhà cung cấp danh tính.");
  const accessToken = `nxh_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + HUB_TOKEN_HOURS * 3600 * 1000);
  await tx(async (t) => {
    const dev = await t.one<{ revoked_at: string | null }>("SELECT revoked_at FROM devices WHERE user_id = $1 AND id = $2", [userId, v.deviceId]);
    if (dev?.revoked_at) throw forbidden("Thiết bị này đã bị thu hồi. Liên hệ quản trị viên.");
    await t.q(
      `INSERT INTO devices (user_id, id, name) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, id) DO UPDATE SET last_seen = now(), name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE devices.name END`,
      [userId, v.deviceId, v.deviceName],
    );
    await t.q("INSERT INTO sessions (id, user_id, kind, device_id, expires_at) VALUES ($1,$2,'hub',$3,$4)", [sha256(accessToken), userId, v.deviceId, expiresAt]);
  });
  return { accessToken, tokenType: "Bearer", expiresAt: expiresAt.toISOString() };
}

/** Thu hồi token Hub hiện tại (đăng xuất). */
export async function revokeHubToken(token: string | undefined): Promise<void> {
  if (!token) return;
  await (await db()).q("DELETE FROM sessions WHERE id = $1 AND kind = 'hub'", [sha256(token)]);
}

export interface HubSession { actor: Actor; deviceId: string }

/** Token Hub → người + thiết bị. Từ chối: không có / hết hạn / người bị vô hiệu hoá / tenant tạm ngưng / thiết bị bị thu hồi. */
export async function resolveHubToken(token: string | undefined): Promise<HubSession> {
  if (!token) throw new AppError("unauthenticated", "Thiếu token.");
  const d = await db();
  const s = await d.one<{ user_id: string; device_id: string | null }>(
    "SELECT user_id, device_id FROM sessions WHERE id = $1 AND kind = 'hub' AND expires_at > now()", [sha256(token)]);
  if (!s || !s.device_id) throw new AppError("unauthenticated", "Token không hợp lệ hoặc đã hết hạn.");
  const actor = await loadActor(d, s.user_id);
  if (!actor || !actor.tenantId) throw new AppError("unauthenticated", "Tài khoản không còn hoạt động.");
  if (!localHubTokensAllowed() || (await findIdpOfTenant(d, actor.tenantId))) throw new AppError("unauthenticated", "Tổ chức này dùng đăng nhập SSO — token cục bộ không còn hiệu lực.");
  const dev = await d.one<{ revoked_at: string | null }>("SELECT revoked_at FROM devices WHERE user_id = $1 AND id = $2", [s.user_id, s.device_id]);
  if (!dev || dev.revoked_at) throw forbidden("Thiết bị này đã bị thu hồi.");
  return { actor, deviceId: s.device_id };
}

/* ───────────────────────── 3. Gói quyền ───────────────────────── */

/**
 * Biên dịch quyền của MỘT người trên MỘT thiết bị thành payload (chưa ký).
 * Hub không biết khái niệm "phòng ban": chỉ nhận danh sách app + mức đã tính sẵn + quyền theo vai trò Hub.
 */
export async function buildEntitlementPayload(d: Db, actor: Actor, deviceId: string, now: Date = new Date()): Promise<EntitlementPayload> {
  const tenantId = actor.tenantId!;
  const t = await d.one<{ id: string; name: string; slug: string; policy_version: number; entitlement_ttl_hours: number; product_name: string | null; accent: string | null }>(
    "SELECT id, name, slug, policy_version, entitlement_ttl_hours, product_name, accent FROM tenants WHERE id = $1", [tenantId]);
  if (!t) throw new AppError("not_found", "Không tìm thấy tổ chức.");
  const u = await d.one<{ hub_role: HubRole; display_name: string }>("SELECT hub_role, display_name FROM users WHERE id = $1 AND tenant_id = $2", [actor.userId, tenantId]);
  if (!u) throw new AppError("not_found", "Không tìm thấy người dùng.");
  const depts = await d.q<{ id: string; name: string; manager_user_id: string | null }>(
    "SELECT d.id, d.name, d.manager_user_id FROM memberships m JOIN departments d ON d.id = m.department_id WHERE m.user_id = $1 AND d.tenant_id = $2 ORDER BY d.name", [actor.userId, tenantId]);
  const apps = await d.q<{ id: string; name: string; origin: string; icon: string; color: string; tags: string[]; max_level: Level; status: "active" | "disabled" }>(
    "SELECT id, name, origin, icon, color, tags, max_level, status FROM catalog_apps WHERE tenant_id = $1", [tenantId]);
  const deptApps = await d.q<{ department_id: string; app_id: string; level: Level }>(
    "SELECT department_id, app_id, level FROM department_apps WHERE department_id = ANY($1::text[])", [depts.map((x) => x.id)]);

  const effective = computeEffective({
    apps: apps.map((a) => ({ id: a.id, name: a.name, origin: a.origin, icon: a.icon, color: a.color, maxLevel: a.max_level, status: a.status })),
    departments: depts.map((x) => ({ id: x.id, name: x.name })),
    deptApps: deptApps.map((x) => ({ deptId: x.department_id, appId: x.app_id, level: x.level })),
    userDeptIds: depts.map((x) => x.id),
  });
  const tagsOf = new Map(apps.map((a) => [a.id, a.tags]));
  const role = u.hub_role;
  const access: Record<string, Exclude<Level, "none">> = {};
  for (const e of effective) access[`origin:${e.origin}`] = e.level as Exclude<Level, "none">;

  return {
    schemaVersion: 1,
    issuer: "control-plane",
    policyVersion: t.policy_version,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + t.entitlement_ttl_hours * 3600 * 1000).toISOString(),
    tenant: { id: t.id, name: t.name, slug: t.slug, branding: { productName: t.product_name, accent: t.accent } },
    audience: { userId: actor.userId, deviceId },
    subject: {
      email: actor.email,
      label: u.display_name,
      hubRole: role,
      departments: depts.map((x) => ({ id: x.id, name: x.name, isManager: x.manager_user_id === actor.userId })),
    },
    mode: "enforce",
    allowUnlistedApps: false,
    apps: effective.map((e) => ({ catalogAppId: e.appId, origin: e.origin, label: e.name, tags: tagsOf.get(e.appId) ?? [], icon: e.icon, color: e.color })),
    roles: { effective: { label: HUB_ROLE_LABEL[role], can: [...ROLE_PERMS[role]], autonomyMax: ROLE_AUTONOMY_MAX[role] } },
    access: { effective: access },
    assign: [{ who: { subject: actor.userId }, role: "effective" }],
  };
}

/** Ký payload: chữ ký trên  ENTITLEMENT_DOMAIN + canonicalize(payload). */
export async function signEntitlement(payload: EntitlementPayload): Promise<SignedEntitlement> {
  const signer = getSigner();
  const sig = await signer.sign(Buffer.from(ENTITLEMENT_DOMAIN + canonicalize(payload), "utf8"));
  return { payload, signature: { alg: "Ed25519", keyId: signer.keyId, sig: sig.toString("base64") } };
}

/**
 * Bearer token → gói quyền đã ký cho đúng người và đúng thiết bị.
 *  - token `nxh_…`: token cục bộ, thiết bị nằm trong token;
 *  - còn lại: token OIDC của IdP, thiết bị lấy từ header `X-Device-Id` (`deviceHeader`).
 */
export async function getSignedEntitlement(token: string | undefined, deviceHeader?: string | null, now: Date = new Date()): Promise<SignedEntitlement> {
  if (!token) throw new AppError("unauthenticated", "Thiếu token.");
  const { actor, deviceId } = token.startsWith("nxh_") ? await resolveHubToken(token) : await resolveOidcCaller(token, deviceHeader);
  const d = await db();
  await d.q("UPDATE devices SET last_seen = now() WHERE user_id = $1 AND id = $2", [actor.userId, deviceId]);
  return signEntitlement(await buildEntitlementPayload(d, actor, deviceId, now));
}

/** Khoá công khai đang tin cậy (tiện cho dev; Hub production nhúng khoá trong bản build). */
export function publicKeys(): { keys: (TrustedKey & { alg: "Ed25519" })[] } {
  return { keys: trustedKeys().map((k) => ({ ...k, alg: "Ed25519" as const })) };
}

