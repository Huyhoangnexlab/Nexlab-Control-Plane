/**
 * Cổng LLM — phần THUẦN (không IO, có test): nhà cung cấp nào, đường nào được chuyển tiếp, chuyển tới đâu.
 *
 * Cổng KHÔNG phải proxy mở: mỗi nhà cung cấp chỉ nhận đúng vài đường đã khai ở đây; mọi đường khác bị từ chối trước khi chạm mạng.
 * Khoá của tổ chức được gắn ở phía server (services/llm-gateway.ts) và không bao giờ rời Control Plane.
 */

export type LlmProvider = "vertex" | "gemini" | "typesafe" | "openrouter";

export const LLM_PROVIDERS: readonly LlmProvider[] = ["vertex", "gemini", "typesafe", "openrouter"];

/** Đường gốc của cổng trên Control Plane (Hub nối `{địa chỉ máy chủ}{GATEWAY_PATH}/{provider}/{path}`). */
export const GATEWAY_PATH = "/v1/llm";

/** Bí mật của tổ chức đứng sau mỗi nhà cung cấp (tên khoá trong tenant_secrets). */
export const PROVIDER_SECRET: Record<LlmProvider, string> = {
  vertex: "GOOGLE_SERVICE_ACCOUNT_JSON",
  gemini: "GEMINI_API_KEY",
  typesafe: "TYPESAFE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/**
 * Bí mật KHÔNG giao bản rõ cho Hub khi cổng đang bật. Gồm cả khoá Anthropic / OpenAI: chưa có đường qua cổng, nhưng giao bản rõ
 * thì mất ý nghĩa của cổng — ở chế độ này hai nhà cung cấp đó tạm không dùng được.
 */
export const GATEWAY_WITHHELD_SECRETS: readonly string[] = [...Object.values(PROVIDER_SECRET), "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

export const isLlmProvider = (s: string): s is LlmProvider => (LLM_PROVIDERS as readonly string[]).includes(s);

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const GOOGLE_METHODS = new Set(["generateContent", "streamGenerateContent", "countTokens"]);
const VERTEX_PATH_RE = /^publishers\/google\/models\/([^/:]+):([A-Za-z]+)$/;
const GEMINI_PATH_RE = /^v1beta\/models\/([^/:]+):([A-Za-z]+)$/;
const LOCATION_RE = /^[a-z][a-z0-9-]{0,39}$/;
const PROJECT_RE = /^[a-z][a-z0-9-]{4,29}$/;

export interface GatewayRoute {
  provider: LlmProvider;
  /** Model trong đường (rỗng với đường không mang model, vd systemone — model nằm trong thân). */
  model: string;
  /** Đường trả về luồng SSE (để cổng không gom cả thân vào RAM). */
  streaming: boolean;
  /** Dựng địa chỉ nhà cung cấp. `vertex` cần project + vùng của TỔ CHỨC (lấy ở server, không lấy từ yêu cầu). */
  upstream(ctx: { project?: string; location?: string }): string;
}

export type RouteResult = { ok: true; route: GatewayRoute } | { ok: false; reason: "unknown-provider" | "path-not-allowed" | "bad-query" };

/**
 * Kiểm (nhà cung cấp, đường, query) → tuyến chuyển tiếp. `path` KHÔNG có dấu «/» ở đầu. Query chỉ cho `alt=sse` (đường stream của Google).
 * Từ chối mọi thứ có `..`, `//`, ký tự mã hoá `%` — đường hợp lệ không cần chúng.
 */
export function resolveRoute(provider: string, path: string, search: string): RouteResult {
  if (!isLlmProvider(provider)) return { ok: false, reason: "unknown-provider" };
  if (!path || path.length > 300 || path.includes("..") || path.includes("//") || path.includes("%") || path.includes("\\")) return { ok: false, reason: "path-not-allowed" };
  const q = search.replace(/^\?/, "");
  if (q !== "" && q !== "alt=sse") return { ok: false, reason: "bad-query" };

  if (provider === "vertex" || provider === "gemini") {
    const m = (provider === "vertex" ? VERTEX_PATH_RE : GEMINI_PATH_RE).exec(path);
    if (!m || !MODEL_RE.test(m[1]) || !GOOGLE_METHODS.has(m[2])) return { ok: false, reason: "path-not-allowed" };
    const [, model, method] = m;
    const streaming = method === "streamGenerateContent";
    if ((q === "alt=sse") !== streaming) return { ok: false, reason: "bad-query" };
    const tail = `${method}${streaming ? "?alt=sse" : ""}`;
    if (provider === "gemini") {
      return { ok: true, route: { provider, model, streaming, upstream: () => `https://generativelanguage.googleapis.com/v1beta/models/${model}:${tail}` } };
    }
    return {
      ok: true,
      route: {
        provider,
        model,
        streaming,
        upstream: ({ project, location }) => {
          const loc = location && LOCATION_RE.test(location) ? location : "global";
          if (!project || !PROJECT_RE.test(project)) throw new Error("project Google Cloud không hợp lệ");
          const host = loc === "global" ? "aiplatform.googleapis.com" : `${loc}-aiplatform.googleapis.com`;
          return `https://${host}/v1beta1/projects/${project}/locations/${loc}/publishers/google/models/${model}:${tail}`;
        },
      },
    };
  }

  // typesafe / openrouter: chỉ đường System One của bộ quyết định.
  if (path !== "systemone" || q !== "") return { ok: false, reason: "path-not-allowed" };
  const url = provider === "typesafe" ? "https://api.typesafe.ai/v1/systemone" : "https://openrouter.ai/api/v1/systemone";
  return { ok: true, route: { provider, model: "", streaming: false, upstream: () => url } };
}

/**
 * Model có khớp danh sách mẫu cho phép không. Mẫu dạng glob đơn giản: `*` = chuỗi bất kỳ (vd `gemini-*`), cách nhau bằng dấu phẩy.
 * Danh sách rỗng = từ chối hết. Model rỗng (đường không mang model) luôn qua — nhà cung cấp tự kiểm.
 */
export function modelAllowed(model: string, patterns: string): boolean {
  if (!model) return true;
  if (!MODEL_RE.test(model)) return false;
  return patterns
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .some((p) => new RegExp(`^${p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(model));
}

export interface UsageCounts { input: number; output: number }

/**
 * Rút số token từ PHẦN CUỐI thân trả về của Google (JSON hoặc SSE): lấy lần xuất hiện CUỐI của từng trường trong `usageMetadata`.
 * Token ra = câu trả lời + suy nghĩ. Không tìm thấy → 0 (không ước lượng).
 */
export function usageFromTail(tail: string): UsageCounts {
  const last = (field: string): number => {
    const re = new RegExp(`"${field}"\\s*:\\s*(\\d{1,12})`, "g");
    let v = 0;
    for (let m = re.exec(tail); m; m = re.exec(tail)) v = Number(m[1]);
    return v;
  };
  return { input: last("promptTokenCount"), output: last("candidatesTokenCount") + last("thoughtsTokenCount") };
}
