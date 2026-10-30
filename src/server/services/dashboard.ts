import { db } from "../db";
import { isPlatformAdmin, isTenantAdmin, type Actor } from "../actor";

export interface DashboardStats {
  kind: "platform" | "tenant" | "manager" | "member";
  tiles: { label: string; value: number | string; hint?: string }[];
}

export async function getDashboard(actor: Actor): Promise<DashboardStats> {
  const d = await db();
  const count = async (sql: string, params: unknown[] = []) => (await d.one<{ n: number }>(sql, params))?.n ?? 0;
  if (isPlatformAdmin(actor)) {
    return {
      kind: "platform",
      tiles: [
        { label: "Tổ chức", value: await count("SELECT count(*)::int AS n FROM tenants") },
        { label: "Đang hoạt động", value: await count("SELECT count(*)::int AS n FROM tenants WHERE status = 'active'") },
        { label: "Tạm ngưng", value: await count("SELECT count(*)::int AS n FROM tenants WHERE status = 'suspended'") },
        { label: "Người dùng", value: await count("SELECT count(*)::int AS n FROM users WHERE tenant_id IS NOT NULL") },
      ],
    };
  }
  const tid = actor.tenantId!;
  if (isTenantAdmin(actor)) {
    const t = await d.one<{ policy_version: number; entitlement_ttl_hours: number }>("SELECT policy_version, entitlement_ttl_hours FROM tenants WHERE id = $1", [tid]);
    return {
      kind: "tenant",
      tiles: [
        { label: "Người dùng", value: await count("SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND status = 'active'", [tid]), hint: `${await count("SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND status = 'disabled'", [tid])} bị vô hiệu hoá` },
        { label: "Phòng ban", value: await count("SELECT count(*)::int AS n FROM departments WHERE tenant_id = $1", [tid]), hint: `${await count("SELECT count(*)::int AS n FROM departments WHERE tenant_id = $1 AND manager_user_id IS NULL", [tid])} chưa có trưởng phòng` },
        { label: "App trong danh mục", value: await count("SELECT count(*)::int AS n FROM catalog_apps WHERE tenant_id = $1 AND status = 'active'", [tid]) },
        { label: "Phiên bản chính sách", value: `v${t?.policy_version ?? 1}`, hint: `Gói quyền hết hạn sau ${t?.entitlement_ttl_hours ?? 24} giờ` },
      ],
    };
  }
  if (actor.managedDeptIds.length > 0) {
    return {
      kind: "manager",
      tiles: [
        { label: "Phòng tôi quản lý", value: actor.managedDeptIds.length },
        { label: "Thành viên", value: await count("SELECT count(DISTINCT user_id)::int AS n FROM memberships WHERE department_id = ANY($1::text[])", [actor.managedDeptIds]) },
        { label: "App đang cấp", value: await count("SELECT count(DISTINCT app_id)::int AS n FROM department_apps WHERE department_id = ANY($1::text[])", [actor.managedDeptIds]) },
        { label: "Thay đổi 7 ngày qua", value: await count("SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND dept_id = ANY($2::text[]) AND ts > now() - interval '7 days'", [tid, actor.managedDeptIds]) },
      ],
    };
  }
  return { kind: "member", tiles: [] };
}
