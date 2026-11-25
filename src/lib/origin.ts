/**
 * Chuẩn hoá «origin» của app trong danh mục. Hub so khớp origin CHÍNH XÁC (CLAUDE.md quy tắc 4) nên danh mục
 * chỉ lưu origin, không lưu path, không wildcard.
 *
 *  - https://host[:port]            → hợp lệ (tên miền công khai)
 *  - nexlab-app://hr | timesheet    → app mô phỏng của Hub
 *  - http://localhost[:port]        → chỉ khi allowDev (lab nội bộ)
 *  - địa chỉ MẠNG NỘI BỘ            → chỉ khi allowPrivate (25/11): IP riêng (10/8, 172.16/12, 192.168/16, 100.64/10), tên miền
 *                                     nội bộ (.local, .internal, .lan, .home, .corp) hoặc tên máy một nhãn («his-server»); nhận cả
 *                                     http lẫn https vì app nội bộ của bệnh viện / doanh nghiệp thường chạy http trong LAN.
 *
 * KHÔNG BAO GIỜ nhận, kể cả khi allowPrivate: loopback (trừ allowDev), 169.254.0.0/16 (link-local — gồm địa chỉ metadata của cloud),
 * 0.0.0.0/8, multicast / broadcast, IP công khai viết bằng số, IPv6 viết bằng số.
 *
 * Vì sao tách: luật chặn mạng nội bộ sinh ra để người dùng không trỏ agent vào router / máy in / dịch vụ nội bộ. App nội bộ THẬT của
 * tổ chức thì do quản trị tổ chức khai ở đây, và chỉ khi quản trị NỀN TẢNG đã bật cờ cho tổ chức đó. Origin đi trong gói quyền đã ký
 * nên Hub chỉ mở đúng địa chỉ này.
 */
export type OriginResult = { ok: true; origin: string; privateNetwork: boolean } | { ok: false; error: string };

const PRIVATE_HOST = /(^|\.)(local|internal|lan|home|corp)$/i;

export type HostKind = "loopback" | "never" | "private-ip" | "public-ip" | "ipv6" | "private-name" | "public-name";

/** Phân loại tên máy (đã thường hoá). Thuần — dùng chung cho kiểm lúc thêm app và lúc tắt cờ. */
export function hostKind(host: string): HostKind {
  const h = host.toLowerCase();
  if (h.startsWith("[")) return h === "[::1]" ? "loopback" : "ipv6";
  if (h === "localhost" || h.endsWith(".localhost")) return "loopback";
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (m.slice(1).some((x) => Number(x) > 255)) return "never";
    if (a === 127) return "loopback";
    if (a === 0 || a === 169 && b === 254 || a >= 224) return "never"; // 0/8, link-local (metadata cloud), multicast, broadcast
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "private-ip";
    return "public-ip";
  }
  if (!h.includes(".") || PRIVATE_HOST.test(h)) return "private-name";
  return "public-name";
}

/** Origin (đã chuẩn hoá) có thuộc mạng nội bộ không. Origin sai định dạng / app mô phỏng → false. */
export function isPrivateNetworkOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const k = hostKind(u.hostname);
    return k === "private-ip" || k === "private-name";
  } catch {
    return false;
  }
}

export function normalizeOrigin(raw: string, opts: { allowDev?: boolean; allowPrivate?: boolean } = {}): OriginResult {
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
    return { ok: true, origin: `nexlab-app://${host}`, privateNetwork: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "Chỉ chấp nhận địa chỉ HTTPS." };

  const kind = hostKind(url.hostname);
  if (kind === "loopback") {
    if (url.protocol === "http:" && opts.allowDev) return { ok: true, origin: url.origin, privateNetwork: false };
    return { ok: false, error: "Không nhận địa chỉ của chính máy này (localhost / 127.x) — http://localhost chỉ dùng được ở chế độ lab." };
  }
  if (kind === "never") return { ok: false, error: "Địa chỉ này không bao giờ được dùng làm app (dải link-local / metadata, 0.0.0.0, multicast)." };
  if (kind === "private-ip" || kind === "private-name") {
    if (opts.allowPrivate) return { ok: true, origin: url.origin, privateNetwork: true };
    return { ok: false, error: "Không nhận địa chỉ IP hoặc tên miền nội bộ (.local, .internal…). Tổ chức cần được quản trị nền tảng bật «Cho phép app mạng nội bộ»." };
  }
  if (kind === "public-ip" || kind === "ipv6") return { ok: false, error: "Không nhận địa chỉ IP viết bằng số — dùng tên miền của app." };
  // Tên miền công khai: chỉ HTTPS.
  if (url.protocol === "http:") return { ok: false, error: "Chỉ chấp nhận HTTPS (http://localhost chỉ dùng được ở chế độ lab)." };
  return { ok: true, origin: url.origin, privateNetwork: false };
}
