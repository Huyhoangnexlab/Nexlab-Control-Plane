import { z } from "zod";
import { db, tx } from "../db";
import { requireTenantAdmin, requireTenantUser, type Actor } from "../actor";
import { bumpPolicy, writeAudit } from "../audit";
import { conflict, invalid, notFound } from "../errors";
import { newId } from "../ids";
import { normalizeOrigin } from "@/lib/origin";
import { ASSIGNABLE_LEVELS, LEVELS, type Level } from "@/lib/levels";
import { parseInput } from "../validate";
import { colorSchema, ICONS, nameSchema, tagsSchema } from "@/lib/validators";

export interface AppRow {
  id: string;
  name: string;
  origin: string;
  icon: string;
  color: string;
  tags: string[];
  maxLevel: Level;
  status: "active" | "disabled";
  createdAt: string;
  departments: number;
}

type Raw = {
  id: string; name: string; origin: string; icon: string; color: string; tags: string[]; max_level: Level;
  status: "active" | "disabled"; created_at: string; departments: number;
};

const SELECT = `SELECT a.*, (SELECT count(*) FROM department_apps da WHERE da.app_id = a.id)::int AS departments FROM catalog_apps a`;

const map = (r: Raw): AppRow => ({
  id: r.id, name: r.name, origin: r.origin, icon: r.icon, color: r.color, tags: r.tags, maxLevel: r.max_level,
  status: r.status, createdAt: r.created_at, departments: r.departments,
});

/** Danh mục app của tenant: quản trị tổ chức và trưởng phòng đọc được (trưởng phòng cần để chọn app cho phòng). */
export async function listApps(actor: Actor): Promise<AppRow[]> {
  const tenantId = requireTenantUser(actor);
  if (actor.adminRole !== "tenant_admin" && actor.managedDeptIds.length === 0) return [];
  return (await (await db()).q<Raw>(`${SELECT} WHERE a.tenant_id = $1 ORDER BY a.name`, [tenantId])).map(map);
}

const allowDev = () => process.env.CP_ALLOW_DEV_ORIGINS === "1";

const appSchema = z.object({
  name: nameSchema("Tên app"),
  origin: z.string(),
  icon: z.enum(ICONS).default("Globe"),
  color: colorSchema.default("#4f46e5"),
  tags: tagsSchema.default([]),
  maxLevel: z.string().refine((v) => (ASSIGNABLE_LEVELS as readonly string[]).includes(v) && v !== "none", "Trần tối đa không hợp lệ."),
  status: z.enum(["active", "disabled"]).default("active"),
});

function parseApp(input: unknown) {
  const v = parseInput(appSchema, input);
  const o = normalizeOrigin(v.origin, { allowDev: allowDev() });
  if (!o.ok) throw invalid(o.error, { origin: o.error });
  return { ...v, origin: o.origin, maxLevel: v.maxLevel as Level };
}

export async function createApp(actor: Actor, input: unknown): Promise<string> {
  const tenantId = requireTenantAdmin(actor);
  const v = parseApp(input);
  const id = newId("app");
  await tx(async (t) => {
    if (await t.one("SELECT 1 FROM catalog_apps WHERE tenant_id = $1 AND origin = $2", [tenantId, v.origin])) throw conflict("Địa chỉ này đã có trong danh mục.");
    await t.q(
      "INSERT INTO catalog_apps (id, tenant_id, name, origin, icon, color, tags, max_level, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id, tenantId, v.name, v.origin, v.icon, v.color, v.tags, v.maxLevel, v.status],
    );
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, action: "app.create", targetType: "app", targetId: id, summary: `Thêm app «${v.name}» (${v.origin}) vào danh mục, trần ${v.maxLevel}`, after: v });
  });
  return id;
}

/**
 * Sửa app trong danh mục. Hạ `maxLevel` sẽ KẸP các mức đã cấp cho phòng ban xuống bằng trần mới (lớp dưới chỉ thu hẹp),
 * tắt app (`disabled`) thì mọi phòng đều không còn thấy nó nhưng cấu hình cấp quyền được giữ lại.
 */
export async function updateApp(actor: Actor, id: string, input: unknown): Promise<{ clamped: number }> {
  const tenantId = requireTenantAdmin(actor);
  const v = parseApp(input);
  return tx(async (t) => {
    const cur = await t.one<Raw>(`${SELECT} WHERE a.id = $1 AND a.tenant_id = $2 FOR UPDATE OF a`, [id, tenantId]);
    if (!cur) throw notFound("Không tìm thấy app.");
    if (await t.one("SELECT 1 FROM catalog_apps WHERE tenant_id = $1 AND origin = $2 AND id <> $3", [tenantId, v.origin, id])) throw conflict("Địa chỉ này đã có trong danh mục.");
    await t.q(
      "UPDATE catalog_apps SET name=$2, origin=$3, icon=$4, color=$5, tags=$6, max_level=$7, status=$8 WHERE id=$1",
      [id, v.name, v.origin, v.icon, v.color, v.tags, v.maxLevel, v.status],
    );
    const rank = `array_position(ARRAY[${LEVELS.map((l) => `'${l}'`).join(",")}], level)`;
    const over = await t.q<{ department_id: string; level: Level }>(
      `SELECT department_id, level FROM department_apps WHERE app_id = $1 AND ${rank} > array_position(ARRAY[${LEVELS.map((l) => `'${l}'`).join(",")}], $2::text)`,
      [id, v.maxLevel],
    );
    if (over.length > 0) {
      await t.q("UPDATE department_apps SET level = $2, updated_by = $3, updated_at = now() WHERE app_id = $1 AND department_id = ANY($4::text[])", [id, v.maxLevel, actor.userId, over.map((o) => o.department_id)]);
      for (const o of over)
        await writeAudit(t, actor, { tenantId, deptId: o.department_id, action: "access.clamp", targetType: "access", targetId: id, summary: `Hạ mức «${v.name}» của một phòng từ ${o.level} xuống ${v.maxLevel} vì trần app giảm`, before: { level: o.level }, after: { level: v.maxLevel } });
    }
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, action: "app.update", targetType: "app", targetId: id, summary: `Cập nhật app «${v.name}»`, before: { name: cur.name, origin: cur.origin, maxLevel: cur.max_level, status: cur.status, tags: cur.tags }, after: v });
    return { clamped: over.length };
  });
}

export async function deleteApp(actor: Actor, id: string): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  await tx(async (t) => {
    const cur = await t.one<{ name: string }>("SELECT name FROM catalog_apps WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [id, tenantId]);
    if (!cur) throw notFound("Không tìm thấy app.");
    await t.q("DELETE FROM catalog_apps WHERE id = $1", [id]);
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, action: "app.delete", targetType: "app", targetId: id, summary: `Xoá app «${cur.name}» khỏi danh mục (đồng thời gỡ khỏi mọi phòng)` });
  });
}
