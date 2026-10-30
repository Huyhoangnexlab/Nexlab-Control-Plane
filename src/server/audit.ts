import type { Db } from "./db";
import type { Actor } from "./actor";

export interface AuditEntry {
  tenantId: string | null;
  deptId?: string | null;
  action: string;
  targetType: "tenant" | "user" | "department" | "membership" | "app" | "access" | "session" | "settings";
  targetId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}

/** Ghi nhật ký — luôn gọi TRONG cùng giao dịch với thay đổi (R6: không có đường ghi nào bỏ qua audit). */
export async function writeAudit(db: Db, actor: Pick<Actor, "userId" | "email">, e: AuditEntry): Promise<void> {
  await db.q(
    `INSERT INTO audit_log (tenant_id, dept_id, actor_user_id, actor_email, action, target_type, target_id, summary, before, after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
    [
      e.tenantId,
      e.deptId ?? null,
      actor.userId,
      actor.email,
      e.action,
      e.targetType,
      e.targetId ?? null,
      e.summary,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
    ],
  );
}

/** Mỗi thay đổi ảnh hưởng quyền → tăng policy_version của tenant (Hub dùng để chống quay lui gói quyền). */
export async function bumpPolicy(db: Db, tenantId: string): Promise<number> {
  const row = await db.one<{ policy_version: number }>(
    "UPDATE tenants SET policy_version = policy_version + 1 WHERE id = $1 RETURNING policy_version",
    [tenantId],
  );
  return row?.policy_version ?? 0;
}
