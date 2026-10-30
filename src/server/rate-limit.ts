import { AppError } from "./errors";

interface Globals { __cpRate?: Map<string, { count: number; start: number }> }
const g = globalThis as unknown as Globals;
const buckets = (g.__cpRate ??= new Map());

/**
 * Giới hạn tần suất đơn giản theo khoá, trong bộ nhớ MỘT tiến trình.
 * Khi chạy nhiều instance (Cloud Run) phải chuyển sang kho dùng chung (DB / Redis) — xem docs/07, giới hạn #4.
 */
export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    buckets.set(key, { count: 1, start: now });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.start > windowMs) buckets.delete(k);
    return;
  }
  b.count += 1;
  if (b.count > max) throw new AppError("rate_limited", "Quá nhiều yêu cầu. Thử lại sau ít phút.");
}
