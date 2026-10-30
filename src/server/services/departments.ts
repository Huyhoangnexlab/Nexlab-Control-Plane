import { z } from "zod";
import { db, tx, type Db } from "../db";
import { canManageDept, isTenantAdmin, requireTenantAdmin, requireTenantUser, type Actor } from "../actor";
import { bumpPolicy, writeAudit } from "../audit";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { newId } from "../ids";
import { parseInput } from "../validate";
import { nameSchema, type HubRole } from "@/lib/validators";
import type { Level } from "@/lib/levels";
import { detachMembership } from "./users";

export interface DepartmentRow {
  id: string;
  name: string;
  description: string;
  managerUserId: string | null;
  managerName: string | null;
  /** Tên nhóm ở IdP tương ứng với phòng (thành viên phòng đồng bộ từ nhóm này khi đăng nhập SSO). */
  idpGroup: string | null;
  memberCount: number;
  appCount: number;
  createdAt: string;
}

type Raw = {
  id: string; name: string; description: string; manager_user_id: string | null; manager_name: string | null; idp_group: string | null;
  member_count: number; app_count: number; created_at: string;
};

const SELECT = `SELECT d.id, d.name, d.description, d.manager_user_id, mu.display_name AS manager_name, d.idp_group, d.created_at,
  (SELECT count(*) FROM memberships m WHERE m.department_id = d.id)::int AS member_count,
  (SELECT count(*) FROM department_apps da WHERE da.department_id = d.id)::int AS app_count
  FROM departments d LEFT JOIN users mu ON mu.id = d.manager_user_id`;

const map = (r: Raw): DepartmentRow => ({
  id: r.id, name: r.name, description: r.description, managerUserId: r.manager_user_id, managerName: r.manager_name, idpGroup: r.idp_group,
  memberCount: r.member_count, appCount: r.app_count, createdAt: r.created_at,
});

/**
 * Danh sách phòng ban theo quyền xem:
 *  - quản trị tổ chức: tất cả phòng của tenant;
 *  - trưởng phòng: các phòng mình quản lý;
 *  - nhân viên: các phòng mình thuộc về.
 */
export async function listDepartments(actor: Actor): Promise<DepartmentRow[]> {
  const tenantId = requireTenantUser(actor);
  const d = await db();
  if (isTenantAdmin(actor)) return (await d.q<Raw>(`${SELECT} WHERE d.tenant_id = $1 ORDER BY d.name`, [tenantId])).map(map);
  return (
    await d.q<Raw>(
      `${SELECT} WHERE d.tenant_id = $1 AND (d.manager_user_id = $2 OR EXISTS (SELECT 1 FROM memberships m WHERE m.department_id = d.id AND m.user_id = $2)) ORDER BY d.name`,
      [tenantId, actor.userId],
    )
  ).map(map);
}

export interface MemberRow {
  userId: string;
  email: string;
  name: string;
  hubRole: HubRole;
  status: "active" | "disabled";
  source: "manual" | "idp";
  isManager: boolean;
}

export interface DepartmentApp {
  appId: string;
  name: string;
  icon: string;
  color: string;
  level: Level;
  maxLevel: Level;
}

export interface DepartmentDetail extends DepartmentRow {
  members: MemberRow[];
  apps: DepartmentApp[];
  canEditApps: boolean;
}

export async function getDepartment(actor: Actor, id: string): Promise<DepartmentDetail> {
  const tenantId = requireTenantUser(actor);
  const d = await db();
  const row = await d.one<Raw>(`${SELECT} WHERE d.id = $1 AND d.tenant_id = $2`, [id, tenantId]);
  if (!row) throw notFound("Không tìm thấy phòng ban.");
  const isMember = !!(await d.one("SELECT 1 FROM memberships WHERE department_id = $1 AND user_id = $2", [id, actor.userId]));
  if (!canManageDept(actor, id) && !isMember) throw forbidden("Bạn không thuộc phòng ban này.");
  const members = canManageDept(actor, id)
    ? (
        await d.q<{ id: string; email: string; display_name: string; hub_role: HubRole; status: "active" | "disabled"; source: "manual" | "idp" }>(
          `SELECT u.id, u.email, u.display_name, u.hub_role, u.status, m.source FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.department_id = $1 AND u.tenant_id = $2 ORDER BY u.display_name`,
          [id, tenantId],
        )
      ).map((m) => ({ userId: m.id, email: m.email, name: m.display_name, hubRole: m.hub_role, status: m.status, source: m.source, isManager: m.id === row.manager_user_id }))
    : [];
  const apps = (
    await d.q<{ app_id: string; name: string; icon: string; color: string; level: Level; max_level: Level }>(
      `SELECT a.id AS app_id, a.name, a.icon, a.color, da.level, a.max_level FROM department_apps da JOIN catalog_apps a ON a.id = da.app_id
        WHERE da.department_id = $1 AND a.tenant_id = $2 AND a.status = 'active' ORDER BY a.name`,
      [id, tenantId],
    )
  ).map((a) => ({ appId: a.app_id, name: a.name, icon: a.icon, color: a.color, level: a.level, maxLevel: a.max_level }));
  return { ...map(row), members, apps, canEditApps: canManageDept(actor, id) };
}

const deptSchema = z.object({
  name: nameSchema("Tên phòng ban"),
  description: z.string().trim().max(200, "Mô tả tối đa 200 ký tự.").default(""),
  managerUserId: z.string().trim().optional().transform((s) => s || null),
  idpGroup: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s ? s.replace(/^\//, "") : null))
    .refine((s) => s === null || /^[A-Za-z0-9._ -]{1,60}$/.test(s), "Tên nhóm chỉ gồm chữ, số, khoảng trắng và . _ -"),
});

/** Gán trưởng phòng: phải là người ĐANG HOẠT ĐỘNG của cùng tenant; tự động thêm vào danh sách thành viên. */
async function applyManager(t: Db, actor: Actor, tenantId: string, deptId: string, managerUserId: string | null): Promise<void> {
  if (!managerUserId) return;
  const u = await t.one<{ status: string }>("SELECT status FROM users WHERE id = $1 AND tenant_id = $2", [managerUserId, tenantId]);
  if (!u) throw invalid("Trưởng phòng phải là người dùng của tổ chức.", { managerUserId: "Người dùng không hợp lệ." });
  if (u.status !== "active") throw invalid("Không thể chọn tài khoản đang bị vô hiệu hoá làm trưởng phòng.", { managerUserId: "Tài khoản đang bị vô hiệu hoá." });
  await t.q("INSERT INTO memberships (user_id, department_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [managerUserId, deptId]);
  void actor;
}

export async function createDepartment(actor: Actor, input: unknown): Promise<string> {
  const tenantId = requireTenantAdmin(actor);
  const v = parseInput(deptSchema, input);
  const id = newId("dep");
  await tx(async (t) => {
    if (await t.one("SELECT 1 FROM departments WHERE tenant_id = $1 AND lower(name) = lower($2)", [tenantId, v.name])) throw conflict("Đã có phòng ban trùng tên.");
    if (v.idpGroup && (await t.one("SELECT 1 FROM departments WHERE tenant_id = $1 AND lower(idp_group) = lower($2)", [tenantId, v.idpGroup]))) throw conflict("Nhóm IdP này đã gắn với phòng khác.");
    await t.q("INSERT INTO departments (id, tenant_id, name, description, idp_group) VALUES ($1,$2,$3,$4,$5)", [id, tenantId, v.name, v.description, v.idpGroup]);
    await applyManager(t, actor, tenantId, id, v.managerUserId);
    if (v.managerUserId) await t.q("UPDATE departments SET manager_user_id = $2 WHERE id = $1", [id, v.managerUserId]);
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, deptId: id, action: "department.create", targetType: "department", targetId: id, summary: `Tạo phòng ban «${v.name}»`, after: v });
  });
  return id;
}

export async function updateDepartment(actor: Actor, id: string, input: unknown): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  const v = parseInput(deptSchema, input);
  await tx(async (t) => {
    const cur = await t.one<{ name: string; description: string; manager_user_id: string | null }>("SELECT name, description, manager_user_id FROM departments WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [id, tenantId]);
    if (!cur) throw notFound("Không tìm thấy phòng ban.");
    if (await t.one("SELECT 1 FROM departments WHERE tenant_id = $1 AND lower(name) = lower($2) AND id <> $3", [tenantId, v.name, id])) throw conflict("Đã có phòng ban trùng tên.");
    await applyManager(t, actor, tenantId, id, v.managerUserId);
    if (v.idpGroup && (await t.one("SELECT 1 FROM departments WHERE tenant_id = $1 AND lower(idp_group) = lower($2) AND id <> $3", [tenantId, v.idpGroup, id]))) throw conflict("Nhóm IdP này đã gắn với phòng khác.");
    await t.q("UPDATE departments SET name = $2, description = $3, manager_user_id = $4, idp_group = $5 WHERE id = $1", [id, v.name, v.description, v.managerUserId, v.idpGroup]);
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, deptId: id, action: "department.update", targetType: "department", targetId: id, summary: `Cập nhật phòng ban «${v.name}»${cur.manager_user_id !== v.managerUserId ? " (đổi trưởng phòng)" : ""}`, before: { name: cur.name, description: cur.description, managerUserId: cur.manager_user_id }, after: v });
  });
}

export async function deleteDepartment(actor: Actor, id: string): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  await tx(async (t) => {
    const cur = await t.one<{ name: string }>("SELECT name FROM departments WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [id, tenantId]);
    if (!cur) throw notFound("Không tìm thấy phòng ban.");
    await t.q("DELETE FROM departments WHERE id = $1", [id]);
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, deptId: id, action: "department.delete", targetType: "department", targetId: id, summary: `Xoá phòng ban «${cur.name}»` });
  });
}

/** R3: chỉ quản trị tổ chức sửa được thành viên — trưởng phòng KHÔNG (tránh tự kéo người vào phòng để mở rộng quyền). */
export async function addMember(actor: Actor, deptId: string, userId: string): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  await tx(async (t) => {
    const dep = await t.one<{ name: string }>("SELECT name FROM departments WHERE id = $1 AND tenant_id = $2", [deptId, tenantId]);
    const usr = await t.one<{ email: string; status: string }>("SELECT email, status FROM users WHERE id = $1 AND tenant_id = $2", [userId, tenantId]);
    if (!dep || !usr) throw notFound("Không tìm thấy phòng ban hoặc người dùng.");
    await t.q("INSERT INTO memberships (user_id, department_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [userId, deptId]);
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, deptId, action: "membership.add", targetType: "membership", targetId: userId, summary: `Thêm ${usr.email} vào «${dep.name}»` });
  });
}

export async function removeMember(actor: Actor, deptId: string, userId: string): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  await tx(async (t) => {
    const dep = await t.one<{ name: string }>("SELECT name FROM departments WHERE id = $1 AND tenant_id = $2", [deptId, tenantId]);
    const usr = await t.one<{ email: string }>("SELECT email FROM users WHERE id = $1 AND tenant_id = $2", [userId, tenantId]);
    if (!dep || !usr) throw notFound("Không tìm thấy phòng ban hoặc người dùng.");
    const m = await t.one<{ source: string }>("SELECT source FROM memberships WHERE user_id = $1 AND department_id = $2", [userId, deptId]);
    if (!m) throw notFound("Người này không thuộc phòng ban.");
    if (m.source !== "manual") throw invalid("Thành viên này được đồng bộ từ hệ thống danh tính, hãy đổi ở đó.");
    await detachMembership(t, actor, tenantId, userId, deptId);
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, deptId, action: "membership.remove", targetType: "membership", targetId: userId, summary: `Bỏ ${usr.email} khỏi «${dep.name}»` });
  });
}
