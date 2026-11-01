/**
 * Danh mục CẤU HÌNH và BÍ MẬT mà tổ chức đặt từ Control Plane cho Hub — danh mục ĐÓNG (danh sách trắng).
 * File này là bản dùng CHUNG: Hub giữ bản sao nguyên văn ở src/shared/control-plane/config-keys.ts (test chống lệch).
 *
 * Ba tầng cấu hình (tầng trên khoá thì tầng dưới không đổi được; tầng dưới chỉ được THU HẸP):
 *   1. tổ chức (org)      — quản trị tổ chức đặt; có thể KHOÁ
 *   2. phòng ban (dept)   — quản trị tổ chức đặt mặc định riêng cho một phòng; có thể KHOÁ
 *   3. cá nhân            — người dùng tự chỉnh, CHỈ các khoá trong PERSONAL_CONFIG_KEYS và chỉ khi chưa bị khoá
 * Bí mật (khoá API, token) KHÔNG nằm trong gói quyền đã ký (gói chỉ ký, không mã hoá): Hub lấy riêng qua GET /v1/secrets.
 */

export type ConfigKind = "enum" | "text" | "url";

export interface OrgConfigKey {
  env: string;
  label: string;
  hint: string;
  kind: ConfigKind;
  options?: readonly string[];
  group: "model" | "privacy" | "agent";
}

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;

export const ORG_CONFIG_KEYS: readonly OrgConfigKey[] = [
  { env: "AGENT_PROVIDER", label: "Nhà cung cấp mô hình mặc định", hint: "mock = demo không cần khoá; còn lại cần khoá tương ứng ở mục Khoá & token.", kind: "enum", options: ["mock", "real", "openrouter", "gemini", "openai", "anthropic", "ollama"], group: "model" },
  { env: "GEMINI_MODEL", label: "Model Gemini", hint: "Model chính của planner khi dùng Gemini.", kind: "text", group: "model" },
  { env: "ANTHROPIC_MODEL", label: "Model Anthropic", hint: "Model khi provider là anthropic / real.", kind: "text", group: "model" },
  { env: "OPENROUTER_MODEL", label: "Model OpenRouter", hint: "Dạng nhà-cung-cấp/tên-model.", kind: "text", group: "model" },
  { env: "OPENAI_MODEL", label: "Model OpenAI", hint: "Model khi provider là openai.", kind: "text", group: "model" },
  { env: "OLLAMA_MODEL", label: "Model Ollama", hint: "Model chạy nội bộ (Ollama).", kind: "text", group: "model" },
  { env: "OLLAMA_HOST", label: "Địa chỉ Ollama", hint: "http(s)://máy:cổng — máy chạy mô hình nội bộ của công ty.", kind: "url", group: "model" },
  { env: "GOOGLE_GENAI_USE_VERTEXAI", label: "Dùng Gemini qua Google Cloud (Vertex AI)", hint: "true = đăng nhập Google Cloud thay vì khoá API.", kind: "enum", options: ["true", "false"], group: "model" },
  { env: "GOOGLE_CLOUD_PROJECT", label: "Project Google Cloud", hint: "Chỉ dùng khi bật Vertex AI.", kind: "text", group: "model" },
  { env: "GOOGLE_CLOUD_LOCATION", label: "Vùng Vertex AI", hint: "Thường là global.", kind: "text", group: "model" },
  { env: "NEXLAB_MEMORY_PERSIST", label: "Lưu lịch sử trên máy người dùng", hint: "0 = chỉ giữ trong RAM, mất khi đóng Hub (nên khoá ở 0 với dữ liệu nhạy cảm).", kind: "enum", options: ["1", "0"], group: "privacy" },
  { env: "NEXLAB_MEMORY_RETENTION_DAYS", label: "Giữ lịch sử tối đa (ngày)", hint: "Người dùng chỉ được chọn số ngày BẰNG HOẶC ÍT HƠN giá trị này.", kind: "enum", options: ["7", "30", "90", "180", "365"], group: "privacy" },
  { env: "NEXLAB_LESSON_FROM_RUN", label: "Chế độ tự học", hint: "1 = Hub ghi lại từng bước và đề xuất bài học / quy trình nháp; chỉ là nháp, người dùng duyệt.", kind: "enum", options: ["0", "1"], group: "agent" },
  { env: "NEXLAB_AUTONOMY", label: "Chế độ tự chủ của agent", hint: "M0 chỉ đọc · M1 duyệt từng lần ghi · M2 duyệt kế hoạch. Trần vai trò và mức app vẫn áp thêm.", kind: "enum", options: ["M0", "M1", "M2"], group: "agent" },
];

/** Biến môi trường (Hub → tiến trình agent) chứa NGUYÊN VĂN JSON của service account Google Cloud. KHÔNG phải đường dẫn file. */
export const SERVICE_ACCOUNT_ENV = "GOOGLE_SERVICE_ACCOUNT_JSON";
export const SERVICE_ACCOUNT_MAX_CHARS = 4096;

export interface OrgSecretKey {
  env: string;
  label: string;
  usedBy: string;
  /** Giá trị nhiều dòng / dài (JSON): giao diện dùng ô văn bản lớn thay vì ô mật khẩu một dòng. */
  multiline?: boolean;
}

export const ORG_SECRET_KEYS: readonly OrgSecretKey[] = [
  { env: "GEMINI_API_KEY", label: "Google Gemini", usedBy: "Planner (agent) và bộ sinh chữ, khi không dùng Vertex AI" },
  { env: "OPENROUTER_API_KEY", label: "OpenRouter", usedBy: "Planner qua OpenRouter và bộ quyết định" },
  { env: "TYPESAFE_API_KEY", label: "TypeSafe (System One)", usedBy: "Bộ quyết định gọi trực tiếp" },
  { env: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)", usedBy: "Planner khi chọn provider Anthropic" },
  { env: "OPENAI_API_KEY", label: "OpenAI", usedBy: "Planner khi chọn provider OpenAI" },
  { env: "NOTION_TOKEN", label: "Notion (thư viện SOP)", usedBy: "Agent đọc SOP từ Notion" },
  {
    env: SERVICE_ACCOUNT_ENV,
    label: "Google Cloud (Vertex AI) — service account chung",
    usedBy: "Gemini qua Vertex AI cho cả công ty: dán NGUYÊN file JSON của service account (quyền Vertex AI User). Dùng cùng 3 cấu hình Vertex ở trang Cấu hình (bật Vertex, project, vùng)",
    multiline: true,
  },
];

/** Vai Hub nhận bí mật mặc định: mọi vai ngoại trừ viewer (chỉ đọc, không dùng agent). */
export const DEFAULT_SECRET_ROLES = ["member", "author", "lead", "admin"] as const;

/** Khoá người dùng thường được tự chỉnh (khi chưa bị khoá). Chỉ chiều THU HẸP so với giá trị tổ chức — xem isNarrowerOrEqual. */
export const PERSONAL_CONFIG_KEYS: readonly string[] = ["NEXLAB_MEMORY_PERSIST", "NEXLAB_MEMORY_RETENTION_DAYS"];

export const SECRET_VALUE_RE = /^[\x21-\x7E]{8,512}$/;

export const orgConfigKey = (env: string): OrgConfigKey | undefined => ORG_CONFIG_KEYS.find((k) => k.env === env);
export const orgSecretKey = (env: string): OrgSecretKey | undefined => ORG_SECRET_KEYS.find((k) => k.env === env);

/**
 * Kiểm + chuẩn hoá giá trị MỘT bí mật. Trả `{ value, last4 }` (value đã chuẩn hoá; last4 chỉ để nhận ra khoá, không đủ để dùng) hoặc null.
 *  - khoá thường: 8–512 ký tự in được, không khoảng trắng;
 *  - service account Google: JSON ≤ 4096 ký tự, `type: service_account`, có `client_email`, `project_id`, `private_key` PEM — lưu dạng JSON gọn một dòng.
 */
export function normalizeSecretValue(env: string, raw: string): { value: string; last4: string } | null {
  const v = String(raw ?? "").trim();
  if (env !== SERVICE_ACCOUNT_ENV) return SECRET_VALUE_RE.test(v) ? { value: v, last4: v.slice(-4) } : null;
  if (!v || v.length > SERVICE_ACCOUNT_MAX_CHARS) return null;
  try {
    const o = JSON.parse(v) as Record<string, unknown>;
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
    if (str("type") !== "service_account" || !str("client_email").includes("@") || !str("project_id") || !/^-----BEGIN (RSA )?PRIVATE KEY-----/.test(str("private_key"))) return null;
    const value = JSON.stringify(o);
    if (value.length > SERVICE_ACCOUNT_MAX_CHARS) return null;
    const id = str("private_key_id");
    return { value, last4: (id || str("client_email")).slice(-4) };
  } catch {
    return null;
  }
}

/** Kiểm giá trị một khoá cấu hình; trả giá trị đã chuẩn hoá hoặc null nếu không hợp lệ. */
export function validateOrgConfigValue(spec: Pick<OrgConfigKey, "kind" | "options">, raw: string): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (spec.kind === "enum") return spec.options?.includes(v) ? v : null;
  if (spec.kind === "url") {
    try {
      const u = new URL(v);
      return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password ? v.slice(0, 300) : null;
    } catch {
      return null;
    }
  }
  return MODEL_RE.test(v) ? v : null;
}

/**
 * Giá trị cá nhân `candidate` có THU HẸP hoặc bằng giá trị tổ chức `orgValue` không?
 *  - NEXLAB_MEMORY_RETENTION_DAYS: số ngày nhỏ hơn hoặc bằng;
 *  - NEXLAB_MEMORY_PERSIST: tổ chức đặt 0 thì chỉ được 0; tổ chức đặt 1 thì được 0 hoặc 1.
 * Không có giá trị tổ chức → tự do trong các giá trị hợp lệ.
 */
export function isNarrowerOrEqual(env: string, candidate: string, orgValue: string | undefined): boolean {
  if (orgValue === undefined) return true;
  if (env === "NEXLAB_MEMORY_RETENTION_DAYS") return Number(candidate) <= Number(orgValue);
  if (env === "NEXLAB_MEMORY_PERSIST") return !(orgValue === "0" && candidate === "1");
  return candidate === orgValue;
}

export interface ConfigRow {
  scope: "org" | "dept";
  deptName?: string;
  deptId?: string;
  key: string;
  value: string;
  locked: boolean;
}

export type ResolvedConfig = Record<string, { value: string; locked: boolean }>;

/**
 * Ghép cấu hình tổ chức + phòng ban cho MỘT người (hàm thuần, có test):
 *  - giá trị tổ chức là nền; nếu đã KHOÁ thì phòng ban không ghi đè được;
 *  - phòng ban ghi đè giá trị chưa khoá; người thuộc nhiều phòng → phòng có TÊN xếp trước thắng (ổn định, có thể đoán trước);
 *  - chỉ giữ các khoá nằm trong danh sách trắng và giá trị hợp lệ.
 */
export function resolveConfig(rows: readonly ConfigRow[]): ResolvedConfig {
  const out: ResolvedConfig = {};
  const ok = (r: ConfigRow) => {
    const spec = orgConfigKey(r.key);
    return spec ? validateOrgConfigValue(spec, r.value) : null;
  };
  for (const r of rows.filter((x) => x.scope === "org")) {
    const v = ok(r);
    if (v) out[r.key] = { value: v, locked: r.locked };
  }
  const dept = rows
    .filter((x) => x.scope === "dept")
    .sort((a, b) => (a.deptName ?? "").localeCompare(b.deptName ?? "", "vi") || (a.deptId ?? "").localeCompare(b.deptId ?? ""));
  const taken = new Set<string>();
  for (const r of dept) {
    if (out[r.key]?.locked || taken.has(r.key)) continue;
    const v = ok(r);
    if (!v) continue;
    out[r.key] = { value: v, locked: r.locked };
    taken.add(r.key);
  }
  return out;
}
