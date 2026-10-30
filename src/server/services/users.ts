import { z } from "zod";
import { db, tx, type Db } from "../db";
import { requireTenantAdmin, type Actor } from "../actor";
import { bumpPolicy, writeAudit } from "../audit";
import { revokeUserSessions } from "../auth";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { newId, newTempPassword } from "../ids";
import { hashPassword, verifyPassword } from "../password";
import { parseInput } from "../validate";
import { emailSchema, HUB_ROLES, nameSchema, passwordSchema, type AdminRole, type HubRole } from "@/lib/validators";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  adminRole: AdminRole;
  hubRole: HubRole;
  status: "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
  /** Đã liên kết với danh tính SSO (đăng nhập qua IdP). */
  sso: boolean;
  departments: { id: string; name: string; isManager: boolean }[];
}

type Raw = {
  id: string; email: string; display_name: string; admin_role: AdminRole; hub_role: HubRole; status: "active" | "disabled";
  last_login_at: string | null; created_at: string; sso: boolean; departments: { id: string; name: string; isManager: boolean }[] | null;
};

const SELECT = `SELECT u.id, u.email, u.display_name, u.admin_role, u.hub_role, u.status, u.last_login_at, u.created_at, (u.idp_sub IS NOT NULL) AS sso,
  (SELECT json_agg(json_build_object('id', d.id, 'name', d.name, 'isManager', d.manager_user_id = u.id) ORDER BY d.name)
     FROM memberships m JOIN departments d ON d.id = m.department_id WHERE m.user_id = u.id) AS departments
  FROM users u`;

const map = (r: Raw): UserRow => ({
  id: r.id, email: r.email, name: r.display_name, adminRole: r.admin_role, hubRole: r.hub_role, status: r.status,
  lastLoginAt: r.last_login_at, createdAt: r.created_at, sso: r.sso, departments: r.departments ?? [],
});

export interface UserFilter { q?: string; deptId?: string; status?: "active" | "disabled" }

export async function listUsers(actor: Actor, filter: UserFilter = {}): Promise<UserRow[]> {
  const tenantId = requireTenantAdmin(actor);
  const where = ["u.tenant_id = $1"];
  const params: unknown[] = [tenantId];
  if (filter.q?.trim()) {
    params.push(`%${filter.q.trim().toLowerCase()}%`);
    where.push(`(lower(u.email) LIKE $${params.length} OR lower(u.display_name) LIKE $${params.length})`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`u.status = $${params.length}`);
  }
  if (filter.deptId) {
    params.push(filter.deptId);
    where.push(`EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.department_id = $${params.length})`);
  }
  return (await (await db()).q<Raw>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY u.display_name`, params)).map(map);
}

export async function getUser(actor: Actor, id: string): Promise<UserRow> {
  const tenantId = requireTenantAdmin(actor);
  const r = await (await db()).one<Raw>(`${SELECT} WHERE u.id = $1 AND u.tenant_id = $2`, [id, tenantId]);
  if (!r) throw notFound("Không tìm thấy người dùng.");
  return map(r);
}

async function assertDepartmentsInTenant(t: Db, tenantId: string, deptIds: string[]): Promise<void> {
  if (deptIds.length === 0) return;
  const rows = await t.q("SELECT id FROM departments WHERE tenant_id = $1 AND id = ANY($2::text[])", [tenantId, deptIds]);
  if (rows.length !== new Set(deptIds).size) throw invalid("Có phòng ban không thuộc tổ chức của bạn.", { deptIds: "Phòng ban không hợp lệ." });
}

/** Số quản trị viên đang hoạt động khác người này. Khoá các dòng quản trị để hai người cùng hạ nhau cùng lúc không làm tổ chức hết quản trị. */
async function tenantAdminCountExcluding(t: Db, tenantId: string, excludeUserId: string): Promise<number> {
  const rows = await t.q<{ id: string }>("SELECT id FROM users WHERE tenant_id = $1 AND admin_role = 'tenant_admin' AND status = 'active' FOR UPDATE", [tenantId]);
  return rows.filter((r) => r.id !== excludeUserId).length;
}

const deptIdsSchema = z.array(z.string()).max(30).default([]);

const createSchema = z.object({
  email: emailSchema,
  name: nameSchema("Họ tên"),
  password: z.string().optional(),
  hubRole: z.enum(HUB_ROLES).default("member"),
  adminRole: z.enum(["none", "tenant_admin"]).default("none"),
  deptIds: deptIdsSchema,
});

export async function createUser(actor: Actor, input: unknown): Promise<{ user: UserRow; tempPassword: string | null }> {
  const tenantId = requireTenantAdmin(actor);
  const v = parseInput(createSchema, input);
  const explicit = v.password?.trim();
  if (explicit) parseInput(passwordSchema, explicit);
  const password = explicit || newTempPassword();
  const hash = await hashPassword(password);
  const id = newId("usr");
  await tx(async (t) => {
    const tenant = await t.one<{ domain: string }>("SELECT domain FROM tenants WHERE id = $1", [tenantId]);
    if (!v.email.endsWith(`@${tenant!.domain}`)) throw invalid(`Email phải thuộc @${tenant!.domain}.`, { email: `Phải kết thúc bằng @${tenant!.domain}` });
    if (await t.one("SELECT 1 FROM users WHERE lower(email) = $1", [v.email])) throw conflict("Email này đã có tài khoản.");
    await assertDepartmentsInTenant(t, tenantId, v.deptIds);
    await t.q(
      "INSERT INTO users (id, tenant_id, email, display_name, password_hash, admin_role, hub_role) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, tenantId, v.email, v.name, hash, v.adminRole, v.hubRole],
    );
    for (const deptId of new Set(v.deptIds)) await t.q("INSERT INTO memberships (user_id, department_id) VALUES ($1,$2)", [id, deptId]);
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, action: "user.create", targetType: "user", targetId: id, summary: `Tạo tài khoản ${v.email} (${v.adminRole === "tenant_admin" ? "quản trị tổ chức" : v.hubRole})`, after: { email: v.email, adminRole: v.adminRole, hubRole: v.hubRole, deptIds: v.deptIds } });
  });
  return { user: await getUser(actor, id), tempPassword: explicit ? null : password };
}

const updateSchema = z.object({
  name: nameSchema("Họ tên"),
  hubRole: z.enum(HUB_ROLES),
  adminRole: z.enum(["none", "tenant_admin"]),
  status: z.enum(["active", "disabled"]),
  deptIds: deptIdsSchema,
});

/** Bỏ người khỏi phòng; nếu họ đang là trưởng phòng đó thì gỡ luôn chức trưởng phòng (R: trưởng phòng phải là thành viên). */
export async function detachMembership(t: Db, actor: Actor, tenantId: string, userId: string, deptId: string): Promise<void> {
  await t.q("DELETE FROM memberships WHERE user_id = $1 AND department_id = $2 AND source = 'manual'", [userId, deptId]);
  const cleared = await t.one<{ name: string }>("UPDATE departments SET manager_user_id = NULL WHERE id = $1 AND manager_user_id = $2 AND tenant_id = $3 RETURNING name", [deptId, userId, tenantId]);
  if (cleared) await writeAudit(t, actor, { tenantId, deptId, action: "department.manager_cleared", targetType: "department", targetId: deptId, summary: `Gỡ trưởng phòng «${cleared.name}» vì người này rời phòng` });
}

export async function updateUser(actor: Actor, id: string, input: unknown): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  const v = parseInput(updateSchema, input);
  const isSelf = id === actor.userId;
  await tx(async (t) => {
    const cur = await t.one<{ display_name: string; admin_role: AdminRole; hub_role: HubRole; status: string; email: string }>(
      "SELECT display_name, admin_role, hub_role, status, email FROM users WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [id, tenantId]);
    if (!cur) throw notFound("Không tìm thấy người dùng.");
    // R4: không ai tự đổi vai trò / trạng thái của chính mình.
    if (isSelf && (v.adminRole !== cur.admin_role || v.hubRole !== cur.hub_role || v.status !== cur.status))
      throw forbidden("Bạn không thể tự đổi vai trò hoặc trạng thái của chính mình.");
    if (cur.admin_role === "tenant_admin" && (v.adminRole !== "tenant_admin" || v.status !== "active") && (await tenantAdminCountExcluding(t, tenantId, id)) === 0)
      throw invalid("Phải còn ít nhất một quản trị viên đang hoạt động trong tổ chức.");
    await assertDepartmentsInTenant(t, tenantId, v.deptIds);

    await t.q("UPDATE users SET display_name = $2, hub_role = $3, admin_role = $4, status = $5 WHERE id = $1", [id, v.name, v.hubRole, v.adminRole, v.status]);
    if (v.status === "disabled") await revokeUserSessions(t, id);

    const want = new Set(v.deptIds);
    const have = await t.q<{ department_id: string; source: string }>("SELECT department_id, source FROM memberships WHERE user_id = $1", [id]);
    const haveIds = new Set(have.map((h) => h.department_id));
    for (const h of have) if (!want.has(h.department_id) && h.source === "manual") await detachMembership(t, actor, tenantId, id, h.department_id);
    for (const deptId of want) if (!haveIds.has(deptId)) await t.q("INSERT INTO memberships (user_id, department_id) VALUES ($1,$2)", [id, deptId]);

    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, action: "user.update", targetType: "user", targetId: id, summary: `Cập nhật tài khoản ${cur.email}`, before: { name: cur.display_name, adminRole: cur.admin_role, hubRole: cur.hub_role, status: cur.status }, after: { name: v.name, adminRole: v.adminRole, hubRole: v.hubRole, status: v.status, deptIds: v.deptIds } });
  });
}

export async function resetPassword(actor: Actor, id: string, password?: string): Promise<{ tempPassword: string | null }> {
  const tenantId = requireTenantAdmin(actor);
  const explicit = password?.trim();
  if (explicit) parseInput(passwordSchema, explicit);
  const next = explicit || newTempPassword();
  const hash = await hashPassword(next);
  await tx(async (t) => {
    const u = await t.one<{ email: string }>("UPDATE users SET password_hash = $3 WHERE id = $1 AND tenant_id = $2 RETURNING email", [id, tenantId, hash]);
    if (!u) throw notFound("Không tìm thấy người dùng.");
    await revokeUserSessions(t, id);
    await writeAudit(t, actor, { tenantId, action: "user.reset_password", targetType: "user", targetId: id, summary: `Đặt lại mật khẩu cho ${u.email}` });
  });
  return { tempPassword: explicit ? null : next };
}

export async function deleteUser(actor: Actor, id: string): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  if (id === actor.userId) throw forbidden("Bạn không thể tự xoá tài khoản của chính mình.");
  await tx(async (t) => {
    const cur = await t.one<{ email: string; admin_role: AdminRole }>("SELECT email, admin_role FROM users WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [id, tenantId]);
    if (!cur) throw notFound("Không tìm thấy người dùng.");
    if (cur.admin_role === "tenant_admin" && (await tenantAdminCountExcluding(t, tenantId, id)) === 0) throw invalid("Không thể xoá quản trị viên cuối cùng của tổ chức.");
    await t.q("DELETE FROM users WHERE id = $1", [id]);
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, action: "user.delete", targetType: "user", targetId: id, summary: `Xoá tài khoản ${cur.email}` });
  });
}

const changePwSchema = z.object({ current: z.string().min(1, "Nhập mật khẩu hiện tại."), next: passwordSchema });

/** Người dùng tự đổi mật khẩu của mình (mọi vai trò, kể cả quản trị nền tảng). */
export async function changeOwnPassword(actor: Actor, input: unknown): Promise<void> {
  const v = parseInput(changePwSchema, input);
  const d = await db();
  const row = await d.one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [actor.userId]);
  if (!row || !(await verifyPassword(v.current, row.password_hash))) throw invalid("Mật khẩu hiện tại không đúng.", { current: "Không đúng." });
  const hash = await hashPassword(v.next);
  await tx(async (t) => {
    await t.q("UPDATE users SET password_hash = $2 WHERE id = $1", [actor.userId, hash]);
    await writeAudit(t, actor, { tenantId: actor.tenantId, action: "user.change_password", targetType: "user", targetId: actor.userId, summary: "Tự đổi mật khẩu" });
  });
}

