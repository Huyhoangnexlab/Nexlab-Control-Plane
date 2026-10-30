/**
 * Chuẩn hoá «origin» của app trong danh mục. Hub so khớp origin CHÍNH XÁC (CLAUDE.md quy tắc 4) nên danh mục
 * chỉ lưu origin, không lưu path, không wildcard.
 *
 *  - https://host[:port]            → hợp lệ
 *  - nexlab-app://hr | timesheet    → app mô phỏng của Hub
 *  - http://localhost[:port]        → chỉ khi allowDev (lab nội bộ)
 */
export type OriginResult = { ok: true; origin: string } | { ok: false; error: string };

const PRIVATE_HOST = /(^|\.)(local|internal|lan|home|corp)$/i;

export function normalizeOrigin(raw: string, opts: { allowDev?: boolean } = {}): OriginResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Chưa nhập địa chỉ app." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "Địa chỉ không hợp lệ. Ví dụ: https://crm.congty.vn" };
  }
  if (url.username || url.password) return { ok: false, error: "Địa chỉ không được chứa tên đăng nhập / mật khẩu." };

  if (url.protocol === "nexlab-app:") {
    const host = url.hostname.toLowerCase();
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(host)) return { ok: false, error: "Tên app mô phỏng không hợp lệ." };
    return { ok: true, origin: `nexlab-app://${host}` };
  }

  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:") {
    const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    if (isLoopback && opts.allowDev) return { ok: true, origin: url.origin };
    return { ok: false, error: "Chỉ chấp nhận HTTPS (http://localhost chỉ dùng được ở chế độ lab)." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Chỉ chấp nhận địa chỉ HTTPS." };
  if (!host.includes(".")) return { ok: false, error: "Tên miền không hợp lệ." };
  if (PRIVATE_HOST.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) {
    return { ok: false, error: "Không nhận địa chỉ IP hoặc tên miền nội bộ (.local, .internal…)." };
  }
  return { ok: true, origin: url.origin };
}
