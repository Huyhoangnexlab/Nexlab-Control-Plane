import { z } from "zod";
import { db, tx } from "../db";
import { requireTenantUser, type Actor } from "../actor";
import { bumpPolicy, writeAudit } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { parseInput } from "../validate";
import { MAX_SOP_SCOPE_BYTES, sopScopeSchema, type SopScopeV1 } from "@/lib/sop-scope";

/**
 * Phạm vi SOP của một app trong danh mục — đặt MỘT LẦN, mọi nhân viên được cấp app nhận qua gói quyền đã ký.
 *  - Ai đặt: quản trị tổ chức (web), hoặc người có vai Hub `author` / `lead` / `admin` (từ Hub), và chỉ với app đã được cấp cho họ.
 *  - Máy chủ tự kiểm vai + app theo token / phiên đăng nhập — không tin vai Hub gửi lên.
 *  - Phạm vi chỉ gồm id + tiêu đề trang Notion (không có nội dung SOP); mọi giá trị qua sopScopeSchema.
 */
const SOP_EDITOR_ROLES = ["author", "lead", "admin"];

const schema = z.object({ sopScope: sopScopeSchema.nullable() });

export async function setAppSopScope(actor: Actor, appId: string, input: unknown): Promise<{ policyVersion: number }> {
  const tenantId = requireTenantUser(actor);
  const isTenantAdmin = actor.adminRole === "tenant_admin";
  if (!isTenantAdmin && !SOP_EDITOR_ROLES.includes(actor.hubRole)) throw forbidden("Vai trò của bạn không được đặt phạm vi SOP của app.");
  const v = parseInput(schema, input);
  if (v.sopScope && JSON.stringify(v.sopScope).length > MAX_SOP_SCOPE_BYTES) throw invalid("Phạm vi SOP quá lớn.");
  return tx(async (t) => {
    const app = await t.one<{ name: string; sop_scope: SopScopeV1 | null; status: string }>(
      "SELECT name, sop_scope, status FROM catalog_apps WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [appId, tenantId]);
    if (!app || app.status !== "active") throw notFound("Không tìm thấy app trong danh mục.");
    if (!isTenantAdmin) {
      const granted = await t.one(
        `SELECT 1 FROM department_apps da JOIN memberships m ON m.department_id = da.department_id
          WHERE m.user_id = $1 AND da.app_id = $2 AND da.level <> 'none' LIMIT 1`, [actor.userId, appId]);
      if (!granted) throw forbidden("App này chưa được cấp cho bạn.");
    }
    await t.q("UPDATE catalog_apps SET sop_scope = $2::jsonb WHERE id = $1", [appId, v.sopScope === null ? null : JSON.stringify(v.sopScope)]);
    const policyVersion = await bumpPolicy(t, tenantId);
    const n = v.sopScope?.roots.length ?? 0;
    await writeAudit(t, actor, {
      tenantId, action: v.sopScope ? "app.sop_scope_set" : "app.sop_scope_clear", targetType: "app", targetId: appId,
      summary: v.sopScope ? `Đặt phạm vi SOP của «${app.name}»: ${n === 0 ? "mọi gốc được chia sẻ" : `${n} gốc`}${v.sopScope.exclude?.length ? `, loại ${v.sopScope.exclude.length} trang` : ""}` : `Bỏ phạm vi SOP của «${app.name}» (về mặc định)`,
      ...(app.sop_scope ? { before: { roots: app.sop_scope.roots.length } } : {}),
      after: v.sopScope ? { roots: n } : null,
    });
    return { policyVersion };
  });
}

/** Số gốc SOP đã đặt cho từng app của tổ chức (cho trang Danh mục app): appId → số gốc (0 = «mọi gốc được chia sẻ»); thiếu = chưa đặt. */
export async function sopScopeSummary(actor: Actor): Promise<Record<string, number>> {
  const tenantId = requireTenantUser(actor);
  const rows = await (await db()).q<{ id: string; sop_scope: SopScopeV1 | null }>("SELECT id, sop_scope FROM catalog_apps WHERE tenant_id = $1 AND sop_scope IS NOT NULL", [tenantId]);
  return Object.fromEntries(rows.map((r) => [r.id, r.sop_scope?.roots.length ?? 0]));
}
