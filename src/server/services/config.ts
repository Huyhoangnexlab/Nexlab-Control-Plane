import { z } from "zod";
import { db, tx, type Db } from "../db";
import { requireTenantAdmin, type Actor } from "../actor";
import { bumpPolicy, writeAudit } from "../audit";
import { invalid, notFound } from "../errors";
import { decryptSecret, encryptSecret } from "../secrets-crypto";
import { parseInput } from "../validate";
import {
  DEFAULT_SECRET_ROLES,
  ORG_CONFIG_KEYS,
  ORG_SECRET_KEYS,
  normalizeSecretValue,
  orgConfigKey,
  orgSecretKey,
  resolveConfig,
  validateOrgConfigValue,
  type ConfigRow,
  type ResolvedConfig,
} from "@/lib/config-keys";
import { HUB_ROLES, type HubRole } from "@/lib/validators";

/* ───────────────────────── Cấu hình (không bí mật) ───────────────────────── */

export interface ConfigEntry {
  key: string;
  scope: "org" | "dept";
  deptId: string | null;
  deptName: string | null;
  value: string;
  locked: boolean;
  updatedAt: string;
}

/** Quản trị tổ chức xem toàn bộ cấu hình (tổ chức + từng phòng). */
export async function listConfig(actor: Actor): Promise<ConfigEntry[]> {
  const tenantId = requireTenantAdmin(actor);
  const rows = await (await db()).q<{ key: string; scope_type: "org" | "dept"; scope_id: string; value: string; locked: boolean; updated_at: string; dept_name: string | null }>(
    `SELECT c.key, c.scope_type, c.scope_id, c.value, c.locked, c.updated_at, d.name AS dept_name
       FROM tenant_config c LEFT JOIN departments d ON c.scope_type = 'dept' AND d.id = c.scope_id
      WHERE c.tenant_id = $1 ORDER BY c.key, c.scope_type, d.name`, [tenantId]);
  return rows.map((r) => ({ key: r.key, scope: r.scope_type, deptId: r.scope_type === "dept" ? r.scope_id : null, deptName: r.dept_name, value: r.value, locked: r.locked, updatedAt: r.updated_at }));
}

const setSchema = z.object({
  key: z.string(),
  value: z.string(),
  locked: z.union([z.boolean(), z.string()]).transform((v) => v === true || v === "on" || v === "true").default(false),
  deptId: z.string().optional().default(""),
});

/** Đặt một giá trị cấu hình ở cấp tổ chức (deptId rỗng) hoặc cấp phòng. Chỉ quản trị tổ chức. */
export async function setConfig(actor: Actor, input: unknown): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  const v = parseInput(setSchema, input);
  const spec = orgConfigKey(v.key);
  if (!spec) throw invalid("Khoá cấu hình không nằm trong danh mục cho phép.", { key: "Khoá không hợp lệ." });
  const value = validateOrgConfigValue(spec, v.value);
  if (!value) throw invalid(`Giá trị không hợp lệ cho «${spec.label}».`, { value: "Giá trị không hợp lệ." });
  await tx(async (t) => {
    let scope: "org" | "dept" = "org";
    let scopeId = "";
    let where = "toàn tổ chức";
    if (v.deptId) {
      const d = await t.one<{ name: string }>("SELECT name FROM departments WHERE id = $1 AND tenant_id = $2", [v.deptId, tenantId]);
      if (!d) throw notFound("Không tìm thấy phòng ban.");
      scope = "dept";
      scopeId = v.deptId;
      where = `phòng «${d.name}»`;
    }
    const before = await t.one<{ value: string; locked: boolean }>("SELECT value, locked FROM tenant_config WHERE tenant_id=$1 AND scope_type=$2 AND scope_id=$3 AND key=$4", [tenantId, scope, scopeId, v.key]);
    await t.q(
      `INSERT INTO tenant_config (tenant_id, scope_type, scope_id, key, value, locked, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, scope_type, scope_id, key) DO UPDATE SET value = EXCLUDED.value, locked = EXCLUDED.locked, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, scope, scopeId, v.key, value, v.locked, actor.userId],
    );
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, deptId: scope === "dept" ? scopeId : null, action: "config.set", targetType: "settings", targetId: v.key, summary: `Đặt «${spec.label}» = ${value}${v.locked ? " (KHOÁ)" : ""} cho ${where}`, ...(before ? { before } : {}), after: { value, locked: v.locked } });
  });
}

export async function clearConfig(actor: Actor, input: unknown): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  const v = parseInput(z.object({ key: z.string(), deptId: z.string().optional().default("") }), input);
  const spec = orgConfigKey(v.key);
  if (!spec) throw invalid("Khoá cấu hình không nằm trong danh mục cho phép.");
  await tx(async (t) => {
    const scope = v.deptId ? "dept" : "org";
    const del = await t.q("DELETE FROM tenant_config WHERE tenant_id=$1 AND scope_type=$2 AND scope_id=$3 AND key=$4 RETURNING 1 AS x", [tenantId, scope, v.deptId, v.key]);
    if (del.length === 0) return;
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, deptId: v.deptId || null, action: "config.clear", targetType: "settings", targetId: v.key, summary: `Bỏ giá trị «${spec.label}» ở ${v.deptId ? "một phòng" : "cấp tổ chức"}` });
  });
}

/** Cấu hình hiệu lực của MỘT người (tổ chức + các phòng người đó thuộc) — đưa vào gói quyền đã ký. */
export async function resolveConfigForUser(d: Db, tenantId: string, deptIds: readonly string[]): Promise<ResolvedConfig> {
  const rows = await d.q<{ key: string; scope_type: "org" | "dept"; scope_id: string; value: string; locked: boolean; dept_name: string | null }>(
    `SELECT c.key, c.scope_type, c.scope_id, c.value, c.locked, d.name AS dept_name
       FROM tenant_config c LEFT JOIN departments d ON c.scope_type = 'dept' AND d.id = c.scope_id
      WHERE c.tenant_id = $1 AND (c.scope_type = 'org' OR c.scope_id = ANY($2::text[]))`, [tenantId, [...deptIds]]);
  const cfg: ConfigRow[] = rows.map((r) => ({ scope: r.scope_type, key: r.key, value: r.value, locked: r.locked, ...(r.scope_type === "dept" ? { deptId: r.scope_id, deptName: r.dept_name ?? "" } : {}) }));
  return resolveConfig(cfg);
}

/* ───────────────────────── Bí mật (khoá API, token) ───────────────────────── */

export interface SecretEntry {
  key: string;
  label: string;
  usedBy: string;
  multiline: boolean;
  configured: boolean;
  /** 4 ký tự cuối — để nhận ra khoá nào, không đủ để dùng lại. Giá trị đầy đủ KHÔNG BAO GIỜ trả về. */
  last4: string | null;
  roles: HubRole[];
  updatedAt: string | null;
}

/** Danh sách bí mật đã đặt (tên + 4 ký tự cuối + vai nhận). Quản trị tổ chức. Không có đường nào đọc giá trị. */
export async function listSecrets(actor: Actor): Promise<SecretEntry[]> {
  const tenantId = requireTenantAdmin(actor);
  const rows = await (await db()).q<{ key: string; last4: string; roles: HubRole[]; updated_at: string }>(
    "SELECT key, last4, roles, updated_at FROM tenant_secrets WHERE tenant_id = $1", [tenantId]);
  const by = new Map(rows.map((r) => [r.key, r]));
  return ORG_SECRET_KEYS.map((k) => {
    const r = by.get(k.env);
    return { key: k.env, label: k.label, usedBy: k.usedBy, multiline: Boolean(k.multiline), configured: Boolean(r), last4: r?.last4 ?? null, roles: r?.roles ?? [...DEFAULT_SECRET_ROLES], updatedAt: r?.updated_at ?? null };
  });
}

const secretSchema = z.object({
  key: z.string(),
  value: z.string().optional().default(""),
  roles: z.union([z.array(z.string()), z.string()]).transform((v) => (Array.isArray(v) ? v : v ? [v] : [])),
});

/**
 * Đặt / đổi một bí mật (giá trị CHỈ ghi, không đọc lại được) hoặc chỉ đổi danh sách vai nhận (value rỗng khi đã có bí mật).
 * Vai `viewer` bị loại: người chỉ đọc không dùng agent nên không có lý do nhận khoá.
 */
export async function setSecret(actor: Actor, input: unknown): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  const v = parseInput(secretSchema, input);
  const spec = orgSecretKey(v.key);
  if (!spec) throw invalid("Khoá không nằm trong danh mục cho phép.", { key: "Khoá không hợp lệ." });
  const roles = [...new Set(v.roles)].filter((r): r is HubRole => (HUB_ROLES as readonly string[]).includes(r) && r !== "viewer");
  if (roles.length === 0) throw invalid("Chọn ít nhất một vai trò được nhận khoá.", { roles: "Chọn ít nhất một vai." });
  const raw = v.value.trim();
  const norm = raw ? normalizeSecretValue(v.key, raw) : null;
  if (raw && !norm) {
    throw invalid(
      spec.multiline ? "Không đọc được JSON service account — dán nguyên file JSON tải từ Google Cloud (có type, project_id, client_email, private_key; tối đa 4096 ký tự)." : "Khoá phải dài 8–512 ký tự in được, không có khoảng trắng.",
      { value: "Khoá không hợp lệ." },
    );
  }
  const value = norm?.value ?? "";
  await tx(async (t) => {
    const cur = await t.one<{ last4: string }>("SELECT last4 FROM tenant_secrets WHERE tenant_id=$1 AND key=$2 FOR UPDATE", [tenantId, v.key]);
    if (!cur && !value) throw invalid("Hãy nhập giá trị khoá.", { value: "Chưa nhập khoá." });
    if (value) {
      await t.q(
        `INSERT INTO tenant_secrets (tenant_id, key, ciphertext, last4, roles, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, key) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, last4 = EXCLUDED.last4, roles = EXCLUDED.roles, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [tenantId, v.key, encryptSecret(value, `${tenantId}|${v.key}`), norm!.last4, roles, actor.userId],
      );
    } else {
      await t.q("UPDATE tenant_secrets SET roles = $3, updated_by = $4, updated_at = now() WHERE tenant_id=$1 AND key=$2", [tenantId, v.key, roles, actor.userId]);
    }
    await bumpPolicy(t, tenantId);
    // Audit CHỈ ghi tên khoá, vai nhận và 4 ký tự cuối — không bao giờ ghi giá trị.
    await writeAudit(t, actor, { tenantId, action: "secret.set", targetType: "settings", targetId: v.key, summary: `${value ? (cur ? "Đổi" : "Đặt") : "Đổi vai nhận của"} «${spec.label}» (vai: ${roles.join(", ")})`, ...(value ? { after: { last4: value.slice(-4), roles } } : { after: { roles } }) });
  });
}

export async function clearSecret(actor: Actor, input: unknown): Promise<void> {
  const tenantId = requireTenantAdmin(actor);
  const v = parseInput(z.object({ key: z.string() }), input);
  const spec = orgSecretKey(v.key);
  if (!spec) throw invalid("Khoá không nằm trong danh mục cho phép.");
  await tx(async (t) => {
    const del = await t.q("DELETE FROM tenant_secrets WHERE tenant_id=$1 AND key=$2 RETURNING 1 AS x", [tenantId, v.key]);
    if (del.length === 0) return;
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, action: "secret.clear", targetType: "settings", targetId: v.key, summary: `Xoá «${spec.label}» khỏi kho bí mật của tổ chức` });
  });
}

export interface DeliveredSecret { env: string; value: string }

/**
 * Bí mật giao cho MỘT người trên MỘT thiết bị: chỉ các bí mật có vai của người đó trong danh sách nhận. Giải mã tại đây, trả qua HTTPS
 * cho Hub (Hub giữ trong RAM, không ghi đĩa). Ghi audit (tên khoá, không giá trị) — tối đa một dòng mỗi giờ cho mỗi (người, thiết bị).
 */
export async function deliverSecrets(actor: Actor, deviceId: string): Promise<{ secrets: DeliveredSecret[]; expiresInSeconds: number }> {
  const tenantId = actor.tenantId;
  if (!tenantId) return { secrets: [], expiresInSeconds: 0 };
  const d = await db();
  const rows = await d.q<{ key: string; ciphertext: string }>("SELECT key, ciphertext FROM tenant_secrets WHERE tenant_id = $1 AND $2 = ANY(roles) ORDER BY key", [tenantId, actor.hubRole]);
  const secrets: DeliveredSecret[] = [];
  for (const r of rows) {
    if (!orgSecretKey(r.key)) continue;
    try {
      secrets.push({ env: r.key, value: decryptSecret(r.ciphertext, `${tenantId}|${r.key}`) });
    } catch {
      // bản mã không giải được (đổi khoá mã hoá / dữ liệu hỏng) → bỏ qua khoá này, không làm hỏng các khoá khác
    }
  }
  if (secrets.length > 0) {
    const recent = await d.one("SELECT 1 FROM audit_log WHERE action = 'secret.deliver' AND actor_user_id = $1 AND after->>'deviceId' = $2 AND ts > now() - interval '1 hour'", [actor.userId, deviceId]);
    if (!recent) {
      await tx(async (t) => {
        await writeAudit(t, actor, { tenantId, action: "secret.deliver", targetType: "settings", targetId: null, summary: `Giao ${secrets.length} khoá cho Hub (${secrets.map((s) => s.env).join(", ")})`, after: { deviceId, keys: secrets.map((s) => s.env) } });
      });
    }
  }
  return { secrets, expiresInSeconds: 3600 };
}

export { ORG_CONFIG_KEYS };
