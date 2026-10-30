import { db } from "../db";
import { isPlatformAdmin, isTenantAdmin, isDeptManager, type Actor } from "../actor";
import { forbidden } from "../errors";

export interface AuditRow {
  id: number;
  ts: string;
  actorEmail: string;
  action: string;
  targetType: string;
  summary: string;
  deptId: string | null;
  before: unknown;
  after: unknown;
}

export interface AuditFilter { q?: string; action?: string; limit?: number }

/**
 * Nhật ký theo phạm vi: quản trị nền tảng thấy vòng đời tenant; quản trị tổ chức thấy cả tổ chức;
 * trưởng phòng chỉ thấy các sự kiện gắn với phòng mình. Nhân viên thường không có quyền xem.
 */
export async function listAudit(actor: Actor, filter: AuditFilter = {}): Promise<AuditRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (isPlatformAdmin(actor)) where.push("(tenant_id IS NULL OR target_type = 'tenant')");
  else if (isTenantAdmin(actor) && actor.tenantId) {
    params.push(actor.tenantId);
    where.push(`tenant_id = $${params.length}`);
  } else if (isDeptManager(actor) && actor.tenantId) {
    params.push(actor.tenantId, actor.managedDeptIds);
    where.push(`tenant_id = $${params.length - 1} AND dept_id = ANY($${params.length}::text[])`);
  } else throw forbidden("Bạn không có quyền xem nhật ký.");
  if (filter.action) {
    params.push(`${filter.action}%`);
    where.push(`action LIKE $${params.length}`);
  }
  if (filter.q?.trim()) {
    params.push(`%${filter.q.trim().toLowerCase()}%`);
    where.push(`(lower(summary) LIKE $${params.length} OR lower(actor_email) LIKE $${params.length})`);
  }
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const rows = await (await db()).q<{ id: number; ts: string; actor_email: string; action: string; target_type: string; summary: string; dept_id: string | null; before: unknown; after: unknown }>(
    `SELECT id, ts, actor_email, action, target_type, summary, dept_id, before, after FROM audit_log WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limit}`,
    params,
  );
  return rows.map((r) => ({ id: r.id, ts: r.ts, actorEmail: r.actor_email, action: r.action, targetType: r.target_type, summary: r.summary, deptId: r.dept_id, before: r.before, after: r.after }));
}
