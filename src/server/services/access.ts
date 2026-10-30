import { db, tx } from "../db";
import { canManageDept, isTenantAdmin, requireTenantUser, type Actor } from "../actor";
import { bumpPolicy, writeAudit } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { ASSIGNABLE_LEVELS, isLevel, levelRank, LEVEL_LABEL, type Level } from "@/lib/levels";
import { computeEffective, type EffectiveApp } from "@/lib/effective";
import type { AppRow } from "./apps";

export interface MatrixData {
  departments: { id: string; name: string; editable: boolean; managerName: string | null }[];
  apps: Pick<AppRow, "id" | "name" | "origin" | "icon" | "color" | "tags" | "maxLevel" | "status">[];
  /** khoá `${deptId}:${appId}` → mức; thiếu = none */
  cells: Record<string, Level>;
}

/**
 * Ma trận phòng × app. Quản trị tổ chức thấy và sửa mọi phòng; trưởng phòng chỉ thấy và sửa PHÒNG CỦA MÌNH;
 * nhân viên thường không có quyền (họ xem «Quyền của tôi»).
 */
export async function getAccessMatrix(actor: Actor): Promise<MatrixData> {
  const tenantId = requireTenantUser(actor);
  if (!isTenantAdmin(actor) && actor.managedDeptIds.length === 0) throw forbidden("Chỉ quản trị viên hoặc trưởng phòng mới xem được ma trận quyền.");
  const d = await db();
  const depts = await d.q<{ id: string; name: string; manager_name: string | null }>(
    `SELECT d.id, d.name, u.display_name AS manager_name FROM departments d LEFT JOIN users u ON u.id = d.manager_user_id
      WHERE d.tenant_id = $1 ${isTenantAdmin(actor) ? "" : "AND d.id = ANY($2::text[])"} ORDER BY d.name`,
    isTenantAdmin(actor) ? [tenantId] : [tenantId, actor.managedDeptIds],
  );
  const apps = await d.q<{ id: string; name: string; origin: string; icon: string; color: string; tags: string[]; max_level: Level; status: "active" | "disabled" }>(
    "SELECT id, name, origin, icon, color, tags, max_level, status FROM catalog_apps WHERE tenant_id = $1 ORDER BY name",
    [tenantId],
  );
  const cells = await d.q<{ department_id: string; app_id: string; level: Level }>(
    "SELECT department_id, app_id, level FROM department_apps WHERE department_id = ANY($1::text[])",
    [depts.map((x) => x.id)],
  );
  return {
    departments: depts.map((x) => ({ id: x.id, name: x.name, editable: canManageDept(actor, x.id), managerName: x.manager_name })),
    apps: apps.map((a) => ({ id: a.id, name: a.name, origin: a.origin, icon: a.icon, color: a.color, tags: a.tags, maxLevel: a.max_level, status: a.status })),
    cells: Object.fromEntries(cells.map((c) => [`${c.department_id}:${c.app_id}`, c.level])),
  };
}

/**
 * Cấp / đổi / thu hồi quyền một app cho một phòng. Đây là chỗ cưỡng chế luật cốt lõi:
 *  - R1  phòng và app đều phải thuộc tenant của người thao tác (truy vấn ràng `tenant_id`, không tin id từ ngoài);
 *  - R2  chỉ chọn trong DANH MỤC đóng, mức ≤ trần của app, và trong thang được phép;
 *  - R3  trưởng phòng chỉ sửa phòng của mình; không có đường nào thêm app mới hay sửa thành viên ở đây.
 */
export async function setDepartmentAppLevel(actor: Actor, deptId: string, appId: string, levelRaw: string): Promise<void> {
  const tenantId = requireTenantUser(actor);
  if (!isLevel(levelRaw) || !(ASSIGNABLE_LEVELS as readonly string[]).includes(levelRaw)) throw invalid("Mức quyền không hợp lệ.");
  const level: Level = levelRaw;
  await tx(async (t) => {
    const dep = await t.one<{ name: string }>("SELECT name FROM departments WHERE id = $1 AND tenant_id = $2", [deptId, tenantId]);
    if (!dep) throw notFound("Không tìm thấy phòng ban.");
    if (!canManageDept(actor, deptId)) throw forbidden("Bạn chỉ được chỉnh quyền cho phòng ban do mình quản lý.");
    const app = await t.one<{ name: string; max_level: Level; status: string }>("SELECT name, max_level, status FROM catalog_apps WHERE id = $1 AND tenant_id = $2", [appId, tenantId]);
    if (!app) throw notFound("App này không có trong danh mục của tổ chức.");
    if (level !== "none") {
      if (app.status !== "active") throw invalid("App đang bị tắt trong danh mục, chưa thể cấp.");
      if (levelRank(level) > levelRank(app.max_level)) throw invalid(`Mức «${LEVEL_LABEL[level]}» vượt trần của app («${LEVEL_LABEL[app.max_level]}»).`);
    }
    const before = (await t.one<{ level: Level }>("SELECT level FROM department_apps WHERE department_id = $1 AND app_id = $2", [deptId, appId]))?.level ?? "none";
    if (before === level) return;
    if (level === "none") await t.q("DELETE FROM department_apps WHERE department_id = $1 AND app_id = $2", [deptId, appId]);
    else
      await t.q(
        `INSERT INTO department_apps (department_id, app_id, level, updated_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (department_id, app_id) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [deptId, appId, level, actor.userId],
      );
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, {
      tenantId, deptId, action: "access.set", targetType: "access", targetId: appId,
      summary: `${level === "none" ? "Thu hồi" : "Đặt"} quyền «${app.name}» của phòng «${dep.name}»: ${LEVEL_LABEL[before]} → ${LEVEL_LABEL[level]}`,
      before: { level: before }, after: { level },
    });
  });
}

export interface UserPreview {
  user: { id: string; email: string; name: string; status: string; hubRole: string };
  departments: { id: string; name: string; isManager: boolean }[];
  effective: EffectiveApp[];
  policyVersion: number;
}

/**
 * «Xem trước»: người này sẽ thấy app nào, mức nào, và VÌ SAO — dùng đúng hàm `computeEffective` mà gói quyền gửi Hub sẽ dùng.
 * Quản trị tổ chức xem được mọi người; trưởng phòng xem người thuộc phòng mình; mọi người xem được chính mình.
 */
export async function previewUser(actor: Actor, userId: string): Promise<UserPreview> {
  const tenantId = requireTenantUser(actor);
  const d = await db();
  const u = await d.one<{ id: string; email: string; display_name: string; status: string; hub_role: string }>(
    "SELECT id, email, display_name, status, hub_role FROM users WHERE id = $1 AND tenant_id = $2", [userId, tenantId]);
  if (!u) throw notFound("Không tìm thấy người dùng.");
  const depts = await d.q<{ id: string; name: string; manager_user_id: string | null }>(
    `SELECT d.id, d.name, d.manager_user_id FROM memberships m JOIN departments d ON d.id = m.department_id WHERE m.user_id = $1 AND d.tenant_id = $2 ORDER BY d.name`,
    [userId, tenantId],
  );
  const allowed = isTenantAdmin(actor) || userId === actor.userId || depts.some((x) => actor.managedDeptIds.includes(x.id));
  if (!allowed) throw forbidden("Bạn chỉ xem trước được quyền của người thuộc phòng mình quản lý.");
  const apps = await d.q<{ id: string; name: string; origin: string; icon: string; color: string; max_level: Level; status: "active" | "disabled" }>(
    "SELECT id, name, origin, icon, color, max_level, status FROM catalog_apps WHERE tenant_id = $1", [tenantId]);
  const deptApps = await d.q<{ department_id: string; app_id: string; level: Level }>(
    "SELECT department_id, app_id, level FROM department_apps WHERE department_id = ANY($1::text[])", [depts.map((x) => x.id)]);
  const policy = await d.one<{ policy_version: number }>("SELECT policy_version FROM tenants WHERE id = $1", [tenantId]);
  return {
    user: { id: u.id, email: u.email, name: u.display_name, status: u.status, hubRole: u.hub_role },
    departments: depts.map((x) => ({ id: x.id, name: x.name, isManager: x.manager_user_id === userId })),
    effective: u.status === "active"
      ? computeEffective({
          apps: apps.map((a) => ({ id: a.id, name: a.name, origin: a.origin, icon: a.icon, color: a.color, maxLevel: a.max_level, status: a.status })),
          departments: depts.map((x) => ({ id: x.id, name: x.name })),
          deptApps: deptApps.map((x) => ({ deptId: x.department_id, appId: x.app_id, level: x.level })),
          userDeptIds: depts.map((x) => x.id),
        })
      : [],
    policyVersion: policy?.policy_version ?? 0,
  };
}
