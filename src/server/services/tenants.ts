import { z } from "zod";
import { db, tx } from "../db";
import { requirePlatform, requireTenantAdmin, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { conflict, invalid, notFound } from "../errors";
import { newId, newTempPassword } from "../ids";
import { hashPassword } from "../password";
import { parseInput } from "../validate";
import { colorSchema, domainSchema, emailSchema, nameSchema, passwordSchema, slugSchema } from "@/lib/validators";

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  domain: string;
  status: "active" | "suspended";
  policyVersion: number;
  entitlementTtlHours: number;
  productName: string | null;
  accent: string | null;
  createdAt: string;
  users: number;
  departments: number;
  apps: number;
  sso: { issuer: string; clientId: string; groupsClaim: string; syncGroups: boolean; jit: boolean } | null;
}

type Raw = {
  id: string; name: string; slug: string; domain: string; status: "active" | "suspended"; policy_version: number;
  entitlement_ttl_hours: number; product_name: string | null; accent: string | null; created_at: string;
  users: number; departments: number; apps: number;
  sso_issuer: string | null; sso_client: string | null; sso_claim: string | null; sso_sync: boolean | null; sso_jit: boolean | null;
};

const map = (r: Raw): TenantRow => ({
  id: r.id, name: r.name, slug: r.slug, domain: r.domain, status: r.status, policyVersion: r.policy_version,
  entitlementTtlHours: r.entitlement_ttl_hours, productName: r.product_name, accent: r.accent, createdAt: r.created_at,
  users: r.users, departments: r.departments, apps: r.apps,
  sso: r.sso_issuer ? { issuer: r.sso_issuer, clientId: r.sso_client ?? "", groupsClaim: r.sso_claim ?? "groups", syncGroups: !!r.sso_sync, jit: !!r.sso_jit } : null,
});

const SELECT = `SELECT t.*,
   (SELECT count(*) FROM users u WHERE u.tenant_id = t.id)::int AS users,
   (SELECT count(*) FROM departments d WHERE d.tenant_id = t.id)::int AS departments,
   (SELECT count(*) FROM catalog_apps a WHERE a.tenant_id = t.id)::int AS apps,
   i.issuer AS sso_issuer, i.client_id AS sso_client, i.groups_claim AS sso_claim, i.sync_groups AS sso_sync, i.jit_provisioning AS sso_jit
   FROM tenants t LEFT JOIN identity_providers i ON i.tenant_id = t.id`;

export async function listTenants(actor: Actor): Promise<TenantRow[]> {
  requirePlatform(actor);
  return (await (await db()).q<Raw>(`${SELECT} ORDER BY t.created_at`)).map(map);
}

/** Tenant của chính người đang đăng nhập (đọc được bởi mọi thành viên). */
export async function getOwnTenant(actor: Actor): Promise<TenantRow | null> {
  if (!actor.tenantId) return null;
  const r = await (await db()).one<Raw>(`${SELECT} WHERE t.id = $1`, [actor.tenantId]);
  return r ? map(r) : null;
}

const createSchema = z.object({
  name: nameSchema("Tên tổ chức"),
  slug: slugSchema,
  domain: domainSchema,
  adminName: nameSchema("Tên quản trị viên"),
  adminEmail: emailSchema,
  adminPassword: z.string().optional(),
});

/** Tạo tenant + tài khoản quản trị đầu tiên (chỉ quản trị nền tảng). */
export async function createTenant(actor: Actor, input: unknown): Promise<{ tenant: TenantRow; tempPassword: string | null }> {
  requirePlatform(actor);
  const v = parseInput(createSchema, input);
  if (!v.adminEmail.endsWith(`@${v.domain}`)) throw invalid(`Email quản trị phải thuộc @${v.domain}.`, { adminEmail: `Phải kết thúc bằng @${v.domain}` });
  const explicit = v.adminPassword?.trim();
  if (explicit) parseInput(passwordSchema, explicit);
  const password = explicit || newTempPassword();
  const hash = await hashPassword(password);
  const id = newId("ten");
  const adminId = newId("usr");
  await tx(async (t) => {
    if (await t.one("SELECT 1 FROM tenants WHERE slug = $1 OR domain = $2", [v.slug, v.domain])) throw conflict("Mã hoặc tên miền đã được tổ chức khác dùng.");
    if (await t.one("SELECT 1 FROM users WHERE lower(email) = $1", [v.adminEmail])) throw conflict("Email này đã có tài khoản.");
    await t.q("INSERT INTO tenants (id, name, slug, domain) VALUES ($1,$2,$3,$4)", [id, v.name, v.slug, v.domain]);
    await t.q(
      `INSERT INTO users (id, tenant_id, email, display_name, password_hash, admin_role, hub_role) VALUES ($1,$2,$3,$4,$5,'tenant_admin','admin')`,
      [adminId, id, v.adminEmail, v.adminName, hash],
    );
    await writeAudit(t, actor, { tenantId: id, action: "tenant.create", targetType: "tenant", targetId: id, summary: `Tạo tổ chức «${v.name}» (${v.domain}) và tài khoản quản trị ${v.adminEmail}`, after: { slug: v.slug, domain: v.domain } });
  });
  const created = await (await db()).one<Raw>(`${SELECT} WHERE t.id = $1`, [id]);
  return { tenant: map(created!), tempPassword: explicit ? null : password };
}

const platformUpdateSchema = z.object({ name: nameSchema("Tên tổ chức"), status: z.enum(["active", "suspended"]) });

/** Quản trị nền tảng đổi tên / tạm ngưng tổ chức. Tạm ngưng = mọi người của tenant bị đá khỏi phiên. */
export async function updateTenant(actor: Actor, id: string, input: unknown): Promise<void> {
  requirePlatform(actor);
  const v = parseInput(platformUpdateSchema, input);
  await tx(async (t) => {
    const cur = await t.one<{ name: string; status: string }>("SELECT name, status FROM tenants WHERE id = $1 FOR UPDATE", [id]);
    if (!cur) throw notFound("Không tìm thấy tổ chức.");
    await t.q("UPDATE tenants SET name = $2, status = $3 WHERE id = $1", [id, v.name, v.status]);
    if (v.status === "suspended") await t.q("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)", [id]);
    await writeAudit(t, actor, { tenantId: id, action: "tenant.update", targetType: "tenant", targetId: id, summary: `Cập nhật tổ chức «${v.name}» (${v.status === "active" ? "hoạt động" : "tạm ngưng"})`, before: cur, after: v });
  });
}

/** Xoá hẳn tenant và toàn bộ dữ liệu bên trong. Phải gõ lại mã (slug) để xác nhận. */
export async function deleteTenant(actor: Actor, id: string, confirmSlug: string): Promise<void> {
  requirePlatform(actor);
  await tx(async (t) => {
    const cur = await t.one<{ slug: string; name: string }>("SELECT slug, name FROM tenants WHERE id = $1 FOR UPDATE", [id]);
    if (!cur) throw notFound("Không tìm thấy tổ chức.");
    if (cur.slug !== confirmSlug.trim()) throw invalid("Mã xác nhận không khớp.", { confirmSlug: "Gõ đúng mã của tổ chức để xoá." });
    await t.q("DELETE FROM tenants WHERE id = $1", [id]);
    await writeAudit(t, actor, { tenantId: null, action: "tenant.delete", targetType: "tenant", targetId: id, summary: `Xoá tổ chức «${cur.name}» (${cur.slug})` });
  });
}

const settingsSchema = z.object({
  productName: z.string().trim().max(40, "Tên hiển thị tối đa 40 ký tự.").optional().transform((s) => s || null),
  accent: z.union([colorSchema, z.literal("")]).optional().transform((s) => s || null),
  entitlementTtlHours: z.coerce.number().int("Phải là số nguyên.").min(1, "Tối thiểu 1 giờ.").max(168, "Tối đa 168 giờ (7 ngày)."),
});

/** Quản trị tenant sửa cấu hình của chính tenant mình (tên hiển thị, màu, thời hạn gói quyền). */
export async function updateOwnTenantSettings(actor: Actor, input: unknown): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  const v = parseInput(settingsSchema, input);
  await tx(async (t) => {
    const cur = await t.one("SELECT product_name, accent, entitlement_ttl_hours FROM tenants WHERE id = $1 FOR UPDATE", [tenantId]);
    await t.q("UPDATE tenants SET product_name = $2, accent = $3, entitlement_ttl_hours = $4, policy_version = policy_version + 1 WHERE id = $1", [tenantId, v.productName, v.accent, v.entitlementTtlHours]);
    await writeAudit(t, actor, { tenantId, action: "tenant.settings", targetType: "settings", targetId: tenantId, summary: "Cập nhật cấu hình tổ chức", before: cur, after: v });
  });
}
