import { z } from "zod";
import { db, tx } from "../db";
import { requireTenantUser, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { newId } from "../ids";
import { parseInput } from "../validate";

/**
 * Yêu cầu quyền do nhân viên gửi từ Hub («Xin quyền»). Chỉ là THÔNG BÁO cho người có thẩm quyền — gửi yêu cầu không cấp quyền gì.
 * Việc cấp quyền vẫn làm ở trang Phân quyền app (luật chống leo quyền giữ nguyên). Người xử lý chỉ đánh dấu «đã cấp» / «từ chối».
 */
export const MAX_OPEN_REQUESTS = 5;

export interface CatalogChoice { id: string; name: string }

/** Tên các app đang bật trong danh mục của tổ chức — để nhân viên chọn app muốn xin. Chỉ tên, không địa chỉ. */
export async function catalogForRequest(actor: Actor): Promise<CatalogChoice[]> {
  const tenantId = requireTenantUser(actor);
  return (await db()).q<CatalogChoice>("SELECT id, name FROM catalog_apps WHERE tenant_id = $1 AND status = 'active' ORDER BY name", [tenantId]);
}

const createSchema = z.object({
  appId: z.string().max(60).optional().nullable(),
  message: z.string().trim().max(500, "Lý do tối đa 500 ký tự."),
});

/** Nhân viên (đã đăng nhập Hub) gửi yêu cầu. Mỗi người tối đa 5 yêu cầu đang chờ; một app không xin lặp khi đang chờ. */
export async function createAccessRequest(actor: Actor, input: unknown): Promise<{ id: string }> {
  const tenantId = requireTenantUser(actor);
  const v = parseInput(createSchema, input);
  if (!v.appId && v.message.length < 5) throw invalid("Hãy chọn app hoặc ghi rõ bạn cần gì (ít nhất 5 ký tự).", { message: "Ghi rõ bạn cần gì." });
  const id = newId("req");
  await tx(async (t) => {
    let appName: string | null = null;
    if (v.appId) {
      const a = await t.one<{ name: string }>("SELECT name FROM catalog_apps WHERE id = $1 AND tenant_id = $2 AND status = 'active'", [v.appId, tenantId]);
      if (!a) throw notFound("Không tìm thấy app này trong danh mục.");
      appName = a.name;
      if (await t.one("SELECT 1 FROM access_requests WHERE tenant_id=$1 AND user_id=$2 AND app_id=$3 AND status='open'", [tenantId, actor.userId, v.appId])) throw conflict("Bạn đã có yêu cầu đang chờ cho app này.");
    }
    const open = await t.one<{ n: number }>("SELECT count(*)::int AS n FROM access_requests WHERE tenant_id=$1 AND user_id=$2 AND status='open'", [tenantId, actor.userId]);
    if ((open?.n ?? 0) >= MAX_OPEN_REQUESTS) throw conflict(`Bạn đang có ${MAX_OPEN_REQUESTS} yêu cầu chờ xử lý — hãy đợi người quản lý trả lời.`);
    await t.q("INSERT INTO access_requests (id, tenant_id, user_id, app_id, message) VALUES ($1,$2,$3,$4,$5)", [id, tenantId, actor.userId, v.appId ?? null, v.message]);
    await writeAudit(t, actor, { tenantId, action: "request.create", targetType: "access", targetId: id, summary: `${actor.name} xin quyền${appName ? ` app «${appName}»` : ""}${v.message ? `: ${v.message.slice(0, 80)}` : ""}` });
  });
  return { id };
}

export interface AccessRequestRow {
  id: string;
  userName: string;
  userEmail: string;
  departments: string[];
  appName: string | null;
  message: string;
  status: "open" | "resolved" | "declined";
  createdAt: string;
  resolvedBy: string | null;
  resolvedNote: string;
}

type Raw = { id: string; user_name: string; user_email: string; departments: string[] | null; app_name: string | null; message: string; status: AccessRequestRow["status"]; created_at: string; resolved_by_name: string | null; resolved_note: string };

/**
 * Người xem được: quản trị tổ chức thấy hết; trưởng phòng thấy yêu cầu của THÀNH VIÊN các phòng mình quản lý. Người khác: không.
 */
export async function listAccessRequests(actor: Actor): Promise<AccessRequestRow[]> {
  const tenantId = requireTenantUser(actor);
  const isAdmin = actor.adminRole === "tenant_admin";
  if (!isAdmin && actor.managedDeptIds.length === 0) throw forbidden("Chỉ quản trị tổ chức hoặc trưởng phòng xem được yêu cầu quyền.");
  const rows = await (await db()).q<Raw>(
    `SELECT r.id, u.display_name AS user_name, u.email AS user_email,
            (SELECT array_agg(d.name ORDER BY d.name) FROM memberships m JOIN departments d ON d.id = m.department_id WHERE m.user_id = r.user_id) AS departments,
            a.name AS app_name, r.message, r.status, r.created_at, ru.display_name AS resolved_by_name, r.resolved_note
       FROM access_requests r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN catalog_apps a ON a.id = r.app_id
       LEFT JOIN users ru ON ru.id = r.resolved_by
      WHERE r.tenant_id = $1
        AND ($2::boolean OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = r.user_id AND m.department_id = ANY($3::text[])))
      ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 200`,
    [tenantId, isAdmin, actor.managedDeptIds],
  );
  return rows.map((r) => ({ id: r.id, userName: r.user_name, userEmail: r.user_email, departments: r.departments ?? [], appName: r.app_name, message: r.message, status: r.status, createdAt: r.created_at, resolvedBy: r.resolved_by_name, resolvedNote: r.resolved_note }));
}

export async function openRequestCount(actor: Actor): Promise<number> {
  try {
    return (await listAccessRequests(actor)).filter((r) => r.status === "open").length;
  } catch {
    return 0;
  }
}

const resolveSchema = z.object({ id: z.string(), status: z.enum(["resolved", "declined"]), note: z.string().trim().max(300).optional().default("") });

/** Đánh dấu đã xử lý. Chỉ quản trị tổ chức hoặc trưởng phòng của người xin. Việc cấp quyền thật làm ở trang Phân quyền app. */
export async function resolveAccessRequest(actor: Actor, input: unknown): Promise<void> {
  const tenantId = requireTenantUser(actor);
  const v = parseInput(resolveSchema, input);
  await tx(async (t) => {
    const r = await t.one<{ user_id: string; status: string; user_name: string }>(
      "SELECT r.user_id, r.status, u.display_name AS user_name FROM access_requests r JOIN users u ON u.id = r.user_id WHERE r.id = $1 AND r.tenant_id = $2 FOR UPDATE OF r", [v.id, tenantId]);
    if (!r) throw notFound("Không tìm thấy yêu cầu.");
    if (r.status !== "open") throw conflict("Yêu cầu này đã được xử lý.");
    if (actor.adminRole !== "tenant_admin") {
      const ok = actor.managedDeptIds.length > 0 && (await t.one("SELECT 1 FROM memberships WHERE user_id = $1 AND department_id = ANY($2::text[])", [r.user_id, actor.managedDeptIds]));
      if (!ok) throw forbidden("Bạn chỉ xử lý được yêu cầu của thành viên phòng mình quản lý.");
    }
    await t.q("UPDATE access_requests SET status = $2, resolved_by = $3, resolved_at = now(), resolved_note = $4 WHERE id = $1", [v.id, v.status, actor.userId, v.note]);
    await writeAudit(t, actor, { tenantId, action: "request.resolve", targetType: "access", targetId: v.id, summary: `${v.status === "resolved" ? "Đánh dấu đã cấp" : "Từ chối"} yêu cầu quyền của ${r.user_name}${v.note ? `: ${v.note}` : ""}` });
  });
}
