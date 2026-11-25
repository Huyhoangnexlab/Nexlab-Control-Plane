import { createHash } from "node:crypto";
import { db, type Db } from "../db";
import type { Actor } from "../actor";
import { AppError } from "../errors";
import { bearerToken } from "../http";
import { rateLimit } from "../rate-limit";
import { decryptSecret } from "../secrets-crypto";
import { parseServiceAccount, serviceAccountAccessToken } from "../google-sa-token";
import { resolveCaller, type HubSession } from "./entitlements";
import { PROVIDER_SECRET, modelAllowed, resolveRoute, usageFromTail, type GatewayRoute, type LlmProvider } from "@/lib/llm-gateway";

/**
 * Cổng LLM: Hub gọi mô hình QUA Control Plane, khoá của tổ chức không rời server.
 *
 *   POST /v1/llm/{provider}/{path}   Authorization: Bearer <token Hub>, X-Device-Id
 *
 * Mỗi lần gọi, MÁY CHỦ kiểm: token → người + tổ chức còn hoạt động + thiết bị chưa thu hồi; vai của người nằm trong danh sách vai của khoá;
 * đường nằm trong danh sách cho phép (lib/llm-gateway.ts); model khớp mẫu; còn hạn mức ngày. Sau đó gắn khoá của tổ chức và chuyển tiếp.
 * Ghi lượng dùng vào `llm_usage` (chỉ số liệu). KHÔNG ghi nội dung yêu cầu / câu trả lời ở bất kỳ đâu.
 */

export const MAX_BODY_BYTES = 20 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120_000;
const TAIL_BYTES = 16 * 1024;

const intEnv = (name: string, def: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
};
const userDailyLimit = () => intEnv("CP_LLM_USER_DAILY_REQUESTS", 3000);
const tenantDailyLimit = () => intEnv("CP_LLM_TENANT_DAILY_REQUESTS", 100_000);
const modelPatterns = () => process.env.CP_LLM_MODEL_ALLOW?.trim() || "gemini-*";

/** Lỗi của CHÍNH cổng — cùng hình dạng lỗi Google (`error.code` là mã HTTP) để SDK phía Hub đọc được; header đánh dấu để phân biệt với lỗi nhà cung cấp. */
function gwError(status: number, statusText: string, message: string): Response {
  return Response.json({ error: { code: status, message, status: statusText } }, { status, headers: { "Cache-Control": "no-store", "X-Nexlab-Gateway-Error": "1" } });
}

const APP_ERROR_STATUS: Record<string, [number, string]> = {
  invalid: [400, "INVALID_ARGUMENT"],
  unauthenticated: [401, "UNAUTHENTICATED"],
  forbidden: [403, "PERMISSION_DENIED"],
  not_found: [404, "NOT_FOUND"],
  conflict: [409, "ABORTED"],
  rate_limited: [429, "RESOURCE_EXHAUSTED"],
  unavailable: [503, "UNAVAILABLE"],
};

/* ───────────── Người gọi: nhớ ngắn hạn để mỗi lần gọi mô hình không phải kiểm lại token + đồng bộ nhóm ───────────── */

interface CachedCaller { session: HubSession; until: number }
interface Globals { __cpLlmCallers?: Map<string, CachedCaller> }
const g = globalThis as unknown as Globals;
const callers = (g.__cpLlmCallers ??= new Map());
/** Thu hồi người / thiết bị có hiệu lực với cổng chậm nhất bằng khoảng này. */
const CALLER_TTL_MS = 30_000;

async function callerOf(token: string | undefined, deviceHeader: string | null): Promise<HubSession> {
  if (!token) throw new AppError("unauthenticated", "Thiếu token.");
  const key = createHash("sha256").update(`${token}|${deviceHeader ?? ""}`).digest("hex");
  const now = Date.now();
  const hit = callers.get(key);
  if (hit && hit.until > now) return hit.session;
  const session = await resolveCaller(token, deviceHeader);
  callers.set(key, { session, until: now + CALLER_TTL_MS });
  if (callers.size > 2000) for (const [k, v] of callers) if (v.until <= now) callers.delete(k);
  return session;
}

export function resetLlmGatewayForTests(): void {
  callers.clear();
}

/* ───────────── Khoá + cấu hình của tổ chức ───────────── */

async function orgSecret(d: Db, actor: Actor, provider: LlmProvider): Promise<string | null> {
  const key = PROVIDER_SECRET[provider];
  const row = await d.one<{ ciphertext: string }>("SELECT ciphertext FROM tenant_secrets WHERE tenant_id = $1 AND key = $2 AND $3 = ANY(roles)", [actor.tenantId, key, actor.hubRole]);
  if (!row) return null;
  try {
    return decryptSecret(row.ciphertext, `${actor.tenantId}|${key}`);
  } catch {
    return null;
  }
}

async function orgConfigValue(d: Db, tenantId: string, key: string): Promise<string> {
  const r = await d.one<{ value: string }>("SELECT value FROM tenant_config WHERE tenant_id = $1 AND scope_type = 'org' AND scope_id = '' AND key = $2", [tenantId, key]);
  return r?.value.trim() ?? "";
}

/* ───────────── Hạn mức + lượng dùng ───────────── */

async function overQuota(d: Db, tenantId: string, userId: string): Promise<"user" | "tenant" | null> {
  const r = await d.one<{ tenant_n: number; user_n: number }>(
    `SELECT COALESCE(SUM(requests), 0)::int AS tenant_n,
            COALESCE(SUM(requests) FILTER (WHERE user_id = $2), 0)::int AS user_n
       FROM llm_usage WHERE tenant_id = $1 AND day = current_date`, [tenantId, userId]);
  if ((r?.user_n ?? 0) >= userDailyLimit()) return "user";
  if ((r?.tenant_n ?? 0) >= tenantDailyLimit()) return "tenant";
  return null;
}

async function addUsage(d: Db, k: { tenantId: string; userId: string; provider: string; model: string }, delta: { requests?: number; errors?: number; input?: number; output?: number }): Promise<void> {
  await d.q(
    `INSERT INTO llm_usage (tenant_id, user_id, provider, model, requests, errors, input_tokens, output_tokens) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, user_id, day, provider, model) DO UPDATE SET
       requests = llm_usage.requests + EXCLUDED.requests, errors = llm_usage.errors + EXCLUDED.errors,
       input_tokens = llm_usage.input_tokens + EXCLUDED.input_tokens, output_tokens = llm_usage.output_tokens + EXCLUDED.output_tokens, updated_at = now()`,
    [k.tenantId, k.userId, k.provider, k.model, delta.requests ?? 0, delta.errors ?? 0, delta.input ?? 0, delta.output ?? 0],
  );
}

/** Model của đường không mang model (System One): đọc trường `model` trong thân JSON — chỉ để ghi lượng dùng. */
function modelFromBody(body: Uint8Array): string {
  if (body.byteLength > 256 * 1024) return "";
  try {
    const m = (JSON.parse(new TextDecoder().decode(body)) as { model?: unknown }).model;
    return typeof m === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(m) ? m : "";
  } catch {
    return "";
  }
}

/* ───────────── Chuyển tiếp ───────────── */

async function upstreamAuth(d: Db, actor: Actor, route: GatewayRoute, secret: string): Promise<{ url: string; headers: Record<string, string> }> {
  if (route.provider === "vertex") {
    const sa = parseServiceAccount(secret);
    const project = (await orgConfigValue(d, actor.tenantId!, "GOOGLE_CLOUD_PROJECT")) || sa.projectId;
    const location = (await orgConfigValue(d, actor.tenantId!, "GOOGLE_CLOUD_LOCATION")) || "global";
    return { url: route.upstream({ project, location }), headers: { authorization: `Bearer ${await serviceAccountAccessToken(sa)}` } };
  }
  if (route.provider === "gemini") return { url: route.upstream({}), headers: { "x-goog-api-key": secret } };
  return { url: route.upstream({}), headers: { authorization: `Bearer ${secret}` } };
}

/** Chuyển nguyên thân trả về, đồng thời giữ PHẦN CUỐI để rút số token; khi luồng kết thúc thì ghi lượng dùng. */
function meter(body: ReadableStream<Uint8Array>, done: (tail: string) => Promise<void>): ReadableStream<Uint8Array> {
  let tail = new Uint8Array(0);
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        if (chunk.byteLength >= TAIL_BYTES) tail = chunk.slice(chunk.byteLength - TAIL_BYTES);
        else {
          const keep = Math.min(tail.byteLength, TAIL_BYTES - chunk.byteLength);
          const next = new Uint8Array(keep + chunk.byteLength);
          next.set(tail.subarray(tail.byteLength - keep), 0);
          next.set(chunk, keep);
          tail = next;
        }
        ctl.enqueue(chunk);
      },
      async flush() {
        await done(new TextDecoder().decode(tail)).catch(() => undefined);
      },
    }),
  );
}

export async function proxyLlm(req: Request, provider: string, path: string): Promise<Response> {
  try {
    const { actor } = await callerOf(bearerToken(req), req.headers.get("x-device-id"));
    const tenantId = actor.tenantId;
    if (!tenantId) return gwError(403, "PERMISSION_DENIED", "Tài khoản này không thuộc tổ chức nào.");
    rateLimit(`llm:${actor.userId}`, 300, 60_000);

    const r = resolveRoute(provider, path, new URL(req.url).search);
    if (!r.ok) return gwError(r.reason === "bad-query" ? 400 : 404, r.reason === "bad-query" ? "INVALID_ARGUMENT" : "NOT_FOUND", "Cổng LLM không phục vụ đường này.");
    const route = r.route;
    if (!modelAllowed(route.model, modelPatterns())) return gwError(403, "PERMISSION_DENIED", `Model «${route.model}» không nằm trong danh sách tổ chức cho phép.`);

    const d = await db();
    const secret = await orgSecret(d, actor, route.provider);
    if (!secret) return gwError(403, "PERMISSION_DENIED", "Tổ chức chưa cấp nhà cung cấp mô hình này cho vai trò của bạn.");

    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > MAX_BODY_BYTES) return gwError(413, "INVALID_ARGUMENT", "Yêu cầu quá lớn.");
    const body = new Uint8Array(await req.arrayBuffer());
    if (body.byteLength > MAX_BODY_BYTES) return gwError(413, "INVALID_ARGUMENT", "Yêu cầu quá lớn.");

    const over = await overQuota(d, tenantId, actor.userId);
    if (over) return gwError(429, "RESOURCE_EXHAUSTED", over === "user" ? "Bạn đã dùng hết hạn mức gọi mô hình hôm nay." : "Tổ chức đã dùng hết hạn mức gọi mô hình hôm nay.");

    const usageKey = { tenantId, userId: actor.userId, provider: route.provider, model: route.model || modelFromBody(body) };
    await addUsage(d, usageKey, { requests: 1 });

    let target: { url: string; headers: Record<string, string> };
    try {
      target = await upstreamAuth(d, actor, route, secret);
    } catch (e) {
      await addUsage(d, usageKey, { errors: 1 });
      console.error("[cp-llm] không dựng được yêu cầu tới nhà cung cấp:", (e as Error).message);
      return gwError(502, "UNAVAILABLE", "Khoá mô hình của tổ chức không dùng được. Báo quản trị viên kiểm tra lại.");
    }

    let up: Response;
    try {
      up = await fetch(target.url, { method: "POST", headers: { "content-type": "application/json", ...target.headers }, body, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), redirect: "error" });
    } catch (e) {
      await addUsage(d, usageKey, { errors: 1 });
      const timeout = (e as Error).name === "TimeoutError";
      return gwError(timeout ? 504 : 502, timeout ? "DEADLINE_EXCEEDED" : "UNAVAILABLE", timeout ? "Nhà cung cấp mô hình không trả lời kịp." : "Không kết nối được nhà cung cấp mô hình.");
    }

    const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": up.headers.get("content-type") ?? "application/json" });
    const finish = async (tail: string) => {
      const u = up.ok ? usageFromTail(tail) : { input: 0, output: 0 };
      await addUsage(d, usageKey, { errors: up.ok ? 0 : 1, input: u.input, output: u.output });
    };
    if (!up.body) {
      await finish("");
      return new Response(null, { status: up.status, headers });
    }
    return new Response(meter(up.body, finish), { status: up.status, headers });
  } catch (e) {
    if (e instanceof AppError) {
      const [status, text] = APP_ERROR_STATUS[e.code] ?? [500, "INTERNAL"];
      return gwError(status, text, e.message);
    }
    console.error("[cp-llm]", e);
    return gwError(500, "INTERNAL", "Lỗi hệ thống.");
  }
}

/* ───────────── Báo cáo lượng dùng (quản trị tổ chức) ───────────── */

export interface UsageRow { day: string; provider: string; model: string; requests: number; errors: number; inputTokens: number; outputTokens: number; users: number }

/** Tổng theo ngày × nhà cung cấp × model của MỘT tổ chức trong `days` ngày gần nhất. */
export async function usageSummary(d: Db, tenantId: string, days = 30): Promise<UsageRow[]> {
  const rows = await d.q<{ day: string; provider: string; model: string; requests: number; errors: number; input_tokens: number; output_tokens: number; users: number }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, provider, model, SUM(requests)::int AS requests, SUM(errors)::int AS errors,
            SUM(input_tokens)::bigint AS input_tokens, SUM(output_tokens)::bigint AS output_tokens, COUNT(DISTINCT user_id)::int AS users
       FROM llm_usage WHERE tenant_id = $1 AND day > current_date - $2::int
      GROUP BY day, provider, model ORDER BY day DESC, provider, model`, [tenantId, Math.max(1, Math.min(days, 366))]);
  return rows.map((r) => ({ day: r.day, provider: r.provider, model: r.model, requests: r.requests, errors: r.errors, inputTokens: r.input_tokens, outputTokens: r.output_tokens, users: r.users }));
}
