import type { Db } from "./db";
import { forbidden } from "./errors";
import type { AdminRole, HubRole } from "@/lib/validators";

/**
 * Chủ thể đang thao tác. CHỈ được dựng từ phiên (cookie → bảng sessions → bảng users) ở phía server,
 * không bao giờ từ body / query / form. `tenantId` là nguồn duy nhất cho phạm vi tenant (luật R1).
 */
export interface Actor {
  userId: string;
  email: string;
  name: string;
  tenantId: string | null;
  tenantName: string | null;
  adminRole: AdminRole;
  hubRole: HubRole;
  /** Các phòng người này là trưởng phòng (suy ra từ departments.manager_user_id). */
  managedDeptIds: string[];
}

export async function loadActor(db: Db, userId: string): Promise<Actor | null> {
  const u = await db.one<{
    id: string;
    email: string;
    display_name: string;
    tenant_id: string | null;
    tenant_name: string | null;
    tenant_status: string | null;
    admin_role: AdminRole;
    hub_role: HubRole;
    status: string;
  }>(
    `SELECT u.id, u.email, u.display_name, u.tenant_id, t.name AS tenant_name, t.status AS tenant_status,
            u.admin_role, u.hub_role, u.status
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1`,
    [userId],
  );
  if (!u || u.status !== "active") return null;
  if (u.tenant_id && u.tenant_status !== "active") return null;
  const managed = u.tenant_id
    ? await db.q<{ id: string }>("SELECT id FROM departments WHERE manager_user_id = $1 AND tenant_id = $2", [u.id, u.tenant_id])
    : [];
  return {
    userId: u.id,
    email: u.email,
    name: u.display_name,
    tenantId: u.tenant_id,
    tenantName: u.tenant_name,
    adminRole: u.admin_role,
    hubRole: u.hub_role,
    managedDeptIds: managed.map((m) => m.id),
  };
}

export const isPlatformAdmin = (a: Actor) => a.adminRole === "platform_admin";
export const isTenantAdmin = (a: Actor) => a.adminRole === "tenant_admin";
export const isDeptManager = (a: Actor) => a.managedDeptIds.length > 0;

/** Chỉ operator của Nexlab (không thuộc tenant nào). */
export function requirePlatform(a: Actor): void {
  if (!isPlatformAdmin(a)) throw forbidden("Chỉ quản trị nền tảng Nexlab mới làm được việc này.");
}

/** Quản trị tenant — trả về tenantId đã tin cậy. */
export function requireTenantAdmin(a: Actor): string {
  if (!isTenantAdmin(a) || !a.tenantId) throw forbidden("Chỉ quản trị viên của tổ chức mới làm được việc này.");
  return a.tenantId;
}

/** Bất kỳ người nào thuộc một tenant. */
export function requireTenantUser(a: Actor): string {
  if (!a.tenantId) throw forbidden("Tài khoản này không thuộc tổ chức nào.");
  return a.tenantId;
}

/** Được sửa quyền app của phòng này không? (quản trị tenant, hoặc đúng trưởng phòng đó) */
export function canManageDept(a: Actor, deptId: string): boolean {
  return isTenantAdmin(a) || a.managedDeptIds.includes(deptId);
}
