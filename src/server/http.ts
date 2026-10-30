import { AppError, type ErrorCode } from "./errors";
import { rateLimit } from "./rate-limit";

const STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
};

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

/** Chuyển lỗi nghiệp vụ thành phản hồi JSON `{ error: { code, message } }` với mã HTTP phù hợp. */
export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return json({ error: { code: e.code, message: e.message, ...(e.fieldErrors ? { fields: e.fieldErrors } : {}) } }, STATUS[e.code]);
  }
  console.error("[cp-api]", e);
  return json({ error: { code: "internal", message: "Lỗi hệ thống." } }, 500);
}

export function bearerToken(req: Request): string | undefined {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m?.[1];
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
}

/** Đọc body JSON có giới hạn kích thước; sai định dạng → 400. */
export async function readJson(req: Request, maxBytes = 8 * 1024): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("invalid", "Yêu cầu quá lớn.");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("invalid", "Nội dung phải là JSON hợp lệ.");
  }
}

/** Bọc một route handler: bắt lỗi, và (tuỳ chọn) giới hạn tần suất theo IP. */
export function api(name: string, limit: { max: number; windowMs: number } | null, fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      if (limit) rateLimit(`${name}:${clientIp(req)}`, limit.max, limit.windowMs);
      return await fn(req);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
