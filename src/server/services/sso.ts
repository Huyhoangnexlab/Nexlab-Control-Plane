import { db, tx, type Db } from "../db";
import { loadActor } from "../actor";
import { bumpPolicy, writeAudit } from "../audit";
import { touchDevice, deviceIdSchema } from "../devices";
import { AppError, forbidden, invalid } from "../errors";
import { newId } from "../ids";
import { peekIssuer, verifyOidcAccessToken, type OidcClaims, type OidcProvider } from "../oidc";
import type { HubSession } from "./entitlements";

/**
 * Đăng nhập SSO cho Hub: token OIDC của IdP → người dùng Control Plane.
 *
 *  1. Tìm IdP theo `iss` (chỉ issuer đã khai báo), kiểm chữ ký bằng JWKS, kiểm token cấp cho client của Hub.
 *  2. Liên kết người dùng: (issuer, sub) đã biết → dùng luôn; chưa có → liên kết theo email (CHỈ khi IdP xác nhận email đã
 *     xác minh); vẫn không có → tạo mới (JIT) nếu tenant bật, ngược lại từ chối.
 *  3. Đồng bộ phòng ban từ claim nhóm (nếu tenant bật): thêm / bớt thành viên có nguồn `idp`; thành viên `manual` giữ nguyên.
 *  4. Người dùng bị vô hiệu hoá / tenant tạm ngưng / thiết bị bị thu hồi → từ chối, đúng như token cục bộ.
 */

export interface IdpConfig extends OidcProvider {
  tenantId: string;
  syncGroups: boolean;
  jit: boolean;
}

type IdpRaw = { tenant_id: string; issuer: string; client_id: string; groups_claim: string; sync_groups: boolean; jit_provisioning: boolean };
const mapIdp = (r: IdpRaw): IdpConfig => ({ tenantId: r.tenant_id, issuer: r.issuer, clientId: r.client_id, groupsClaim: r.groups_claim, syncGroups: r.sync_groups, jit: r.jit_provisioning });

export async function findIdpByIssuer(d: Db, issuer: string): Promise<IdpConfig | null> {
  const r = await d.one<IdpRaw>("SELECT tenant_id, issuer, client_id, groups_claim, sync_groups, jit_provisioning FROM identity_providers WHERE issuer = $1", [issuer]);
  return r ? mapIdp(r) : null;
}

export async function findIdpOfTenant(d: Db, tenantId: string): Promise<IdpConfig | null> {
  const r = await d.one<IdpRaw>("SELECT tenant_id, issuer, client_id, groups_claim, sync_groups, jit_provisioning FROM identity_providers WHERE tenant_id = $1", [tenantId]);
  return r ? mapIdp(r) : null;
}

/** Mật khẩu không thể khớp bất kỳ đầu vào nào (định dạng khác `scrypt$…`) — người dùng chỉ vào qua SSO. */
const UNUSABLE_PASSWORD = "!sso-only";

async function linkOrProvision(idp: IdpConfig, c: OidcClaims): Promise<string> {
  return tx(async (t) => {
    const bySub = await t.one<{ id: string; tenant_id: string }>("SELECT id, tenant_id FROM users WHERE idp_issuer = $1 AND idp_sub = $2", [idp.issuer, c.sub]);
    if (bySub) {
      if (bySub.tenant_id !== idp.tenantId) throw forbidden("Danh tính này thuộc tổ chức khác.");
      return bySub.id;
    }
    if (!c.email || !c.emailVerified) throw new AppError("unauthenticated", "IdP chưa xác minh email của bạn nên không thể liên kết tài khoản.");
    const tenant = await t.one<{ domain: string; name: string }>("SELECT domain, name FROM tenants WHERE id = $1", [idp.tenantId]);
    if (!tenant) throw new AppError("unauthenticated", "Tổ chức không tồn tại.");

    const byEmail = await t.one<{ id: string; tenant_id: string | null; idp_sub: string | null }>("SELECT id, tenant_id, idp_sub FROM users WHERE lower(email) = $1", [c.email]);
    if (byEmail) {
      if (byEmail.tenant_id !== idp.tenantId) throw forbidden("Email này thuộc tổ chức khác.");
      if (byEmail.idp_sub) throw forbidden("Tài khoản này đã liên kết với một danh tính SSO khác.");
      await t.q("UPDATE users SET idp_issuer = $2, idp_sub = $3 WHERE id = $1", [byEmail.id, idp.issuer, c.sub]);
      await writeAudit(t, { userId: byEmail.id, email: c.email }, { tenantId: idp.tenantId, action: "user.sso_link", targetType: "user", targetId: byEmail.id, summary: `Liên kết ${c.email} với danh tính SSO lần đầu đăng nhập` });
      return byEmail.id;
    }

    if (!idp.jit) throw forbidden("Tài khoản chưa được cấp ở tổ chức. Liên hệ quản trị viên.");
    if (!c.email.endsWith(`@${tenant.domain}`)) throw forbidden(`Email phải thuộc @${tenant.domain}.`);
    const id = newId("usr");
    await t.q(
      "INSERT INTO users (id, tenant_id, email, display_name, password_hash, admin_role, hub_role, idp_issuer, idp_sub) VALUES ($1,$2,$3,$4,$5,'none','member',$6,$7)",
      [id, idp.tenantId, c.email, c.name ?? c.email.split("@")[0], UNUSABLE_PASSWORD, idp.issuer, c.sub],
    );
    await bumpPolicy(t, idp.tenantId);
    await writeAudit(t, { userId: id, email: c.email }, { tenantId: idp.tenantId, action: "user.sso_create", targetType: "user", targetId: id, summary: `Tự tạo tài khoản ${c.email} từ đăng nhập SSO lần đầu (vai trò nhân viên, chưa có quyền quản trị)` });
    return id;
  });
}

/** Đồng bộ thành viên phòng từ nhóm IdP. Chỉ đụng các dòng `source='idp'`; thiếu claim nhóm = coi như không thuộc nhóm nào (thu hẹp). */
export async function syncGroupMemberships(idp: IdpConfig, userId: string, email: string, groups: string[]): Promise<{ added: string[]; removed: string[] }> {
  return tx(async (t) => {
    const mapped = await t.q<{ id: string; name: string; idp_group: string }>("SELECT id, name, idp_group FROM departments WHERE tenant_id = $1 AND idp_group IS NOT NULL", [idp.tenantId]);
    const have = await t.q<{ department_id: string }>("SELECT department_id FROM memberships WHERE user_id = $1 AND source = 'idp'", [userId]);
    const haveIds = new Set(have.map((h) => h.department_id));
    const inGroups = new Set(groups.map((x) => x.toLowerCase()));
    const want = mapped.filter((m) => inGroups.has(m.idp_group.toLowerCase()));
    const wantIds = new Set(want.map((w) => w.id));
    const added: string[] = [];
    const removed: string[] = [];

    for (const w of want) {
      if (haveIds.has(w.id)) continue;
      const ins = await t.q("INSERT INTO memberships (user_id, department_id, source) VALUES ($1,$2,'idp') ON CONFLICT DO NOTHING RETURNING department_id", [userId, w.id]);
      if (ins.length > 0) added.push(w.name); // nếu đã có dòng 'manual' thì giữ nguyên, không tính là thay đổi
    }
    for (const h of have) {
      if (wantIds.has(h.department_id)) continue;
      await t.q("DELETE FROM memberships WHERE user_id = $1 AND department_id = $2 AND source = 'idp'", [userId, h.department_id]);
      const dep = await t.one<{ name: string }>("UPDATE departments SET manager_user_id = NULL WHERE id = $1 AND manager_user_id = $2 RETURNING name", [h.department_id, userId]);
      const name = mapped.find((m) => m.id === h.department_id)?.name ?? (await t.one<{ name: string }>("SELECT name FROM departments WHERE id = $1", [h.department_id]))?.name ?? h.department_id;
      removed.push(name);
      if (dep) await writeAudit(t, { userId, email }, { tenantId: idp.tenantId, deptId: h.department_id, action: "department.manager_cleared", targetType: "department", targetId: h.department_id, summary: `Gỡ trưởng phòng «${dep.name}» vì IdP không còn xếp người này vào nhóm` });
    }
    if (added.length > 0 || removed.length > 0) {
      await bumpPolicy(t, idp.tenantId);
      await writeAudit(t, { userId, email }, {
        tenantId: idp.tenantId, action: "membership.sso_sync", targetType: "membership", targetId: userId,
        summary: `Đồng bộ phòng ban của ${email} từ nhóm SSO${added.length ? `: thêm ${added.join(", ")}` : ""}${removed.length ? `; bỏ ${removed.join(", ")}` : ""}`,
        after: { added, removed, groups },
      });
    }
    return { added, removed };
  });
}

/** Token OIDC → người + thiết bị. `deviceHeader` là giá trị header `X-Device-Id` Hub gửi kèm. */
export async function resolveOidcCaller(token: string, deviceHeader: string | null | undefined): Promise<HubSession> {
  const iss = peekIssuer(token);
  if (!iss) throw new AppError("unauthenticated", "Token không hợp lệ.");
  const d = await db();
  const idp = await findIdpByIssuer(d, iss);
  if (!idp) throw new AppError("unauthenticated", "Nhà cung cấp danh tính không được tin cậy.");
  const device = deviceIdSchema.safeParse(deviceHeader ?? "");
  if (!device.success) throw invalid("Thiếu hoặc sai header X-Device-Id.", { deviceId: device.error.issues[0]?.message ?? "deviceId không hợp lệ." });

  const claims = await verifyOidcAccessToken(token, idp);

  let userId: string;
  try {
    userId = await linkOrProvision(idp, claims);
  } catch (e) {
    // Hai yêu cầu đầu tiên cùng lúc có thể đụng ràng buộc duy nhất → thử lại một lần (lần này sẽ thấy dòng vừa tạo).
    if (e instanceof AppError && e.code === "conflict") userId = await linkOrProvision(idp, claims);
    else throw e;
  }

  const pre = await loadActor(d, userId);
  if (!pre || pre.tenantId !== idp.tenantId) throw new AppError("unauthenticated", "Tài khoản đã bị vô hiệu hoá hoặc tổ chức đang tạm ngưng.");
  if (idp.syncGroups) await syncGroupMemberships(idp, userId, pre.email, claims.groups);
  // Dựng lại actor SAU đồng bộ để danh sách phòng quản lý phản ánh thay đổi mới nhất.
  const actor = (await loadActor(d, userId))!;
  await touchDevice(d, userId, device.data);
  return { actor, deviceId: device.data };
}
