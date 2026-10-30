import { createRemoteJWKSet, decodeJwt, errors as joseErrors, jwtVerify, type JWTPayload } from "jose";
import { AppError } from "./errors";

/**
 * Kiểm access token OIDC của IdP (Keycloak / Entra / Google…) bằng JWKS.
 *
 * An toàn:
 *  - Chỉ tin issuer ĐÃ KHAI BÁO trong bảng identity_providers (do quản trị nền tảng đặt). Issuer đọc từ token chỉ để TÌM
 *    cấu hình; JWKS luôn tải từ địa chỉ trong cấu hình, không bao giờ từ token (chống SSRF / giả issuer).
 *  - Chỉ nhận thuật toán bất đối xứng (không HS*, không "none").
 *  - Token phải được cấp CHO client của Hub (`azp` hoặc `aud` = clientId), tránh dùng token của app khác trong cùng realm.
 *  - Tài liệu discovery phải tự khai đúng issuer và `jwks_uri` cùng origin với issuer.
 */
export interface OidcProvider { issuer: string; clientId: string; groupsClaim: string }

export interface OidcClaims {
  iss: string;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  groups: string[];
  /** true nếu token có claim nhóm (kể cả rỗng); false nếu thiếu hẳn → có thể cấu hình mapper sai. */
  hasGroupsClaim: boolean;
}

const ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512", "EdDSA"];
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

type Jwks = ReturnType<typeof createRemoteJWKSet>;
interface Globals {
  __cpDisco?: Map<string, { jwksUri: string; at: number }>;
  __cpJwks?: Map<string, Jwks>;
}
const g = globalThis as unknown as Globals;
const discoCache = (g.__cpDisco ??= new Map());
const jwksCache = (g.__cpJwks ??= new Map());

/** Chuẩn hoá issuer khi quản trị nền tảng khai báo: https (hoặc http://localhost khi chế độ lab), không user/query/hash, bỏ "/" cuối. */
export function normalizeIssuer(raw: string, opts: { allowDev?: boolean } = {}): { ok: true; issuer: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Issuer không phải địa chỉ hợp lệ." };
  }
  if (u.username || u.password || u.search || u.hash) return { ok: false, error: "Issuer không được chứa tên đăng nhập, query hay #." };
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol === "http:" && !(loopback && opts.allowDev)) return { ok: false, error: "Issuer phải dùng HTTPS (http://localhost chỉ ở chế độ lab)." };
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Issuer phải là địa chỉ HTTPS." };
  return { ok: true, issuer: (u.origin + u.pathname).replace(/\/+$/, "") };
}

/** Tải (và nhớ 10 phút) tài liệu discovery; kiểm `issuer` khớp và `jwks_uri` cùng origin. */
export async function discoverJwksUri(issuer: string): Promise<string> {
  const hit = discoCache.get(issuer);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.jwksUri;
  let doc: { issuer?: string; jwks_uri?: string };
  try {
    const res = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    doc = (await res.json()) as typeof doc;
  } catch (e) {
    throw new AppError("unavailable", `Không kết nối được nhà cung cấp danh tính (${(e as Error).message}).`);
  }
  if (doc.issuer !== issuer) throw new AppError("unavailable", "Nhà cung cấp danh tính khai issuer không khớp cấu hình.");
  let jwks: URL;
  try {
    jwks = new URL(doc.jwks_uri ?? "");
  } catch {
    throw new AppError("unavailable", "Nhà cung cấp danh tính không khai jwks_uri hợp lệ.");
  }
  if (jwks.origin !== new URL(issuer).origin) throw new AppError("unavailable", "jwks_uri phải cùng origin với issuer.");
  discoCache.set(issuer, { jwksUri: jwks.toString(), at: Date.now() });
  return jwks.toString();
}

async function jwksFor(issuer: string): Promise<Jwks> {
  const uri = await discoverJwksUri(issuer);
  let set = jwksCache.get(uri);
  if (!set) {
    set = createRemoteJWKSet(new URL(uri), { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60 * 1000 });
    jwksCache.set(uri, set);
  }
  return set;
}

/** Đọc `iss` từ token CHƯA kiểm — chỉ để chọn cấu hình IdP; tuyệt đối không tin các claim khác ở bước này. */
export function peekIssuer(token: string): string | null {
  try {
    const iss = decodeJwt(token).iss;
    return typeof iss === "string" ? iss.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function verifyOidcAccessToken(token: string, idp: OidcProvider): Promise<OidcClaims> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, await jwksFor(idp.issuer), { issuer: idp.issuer, algorithms: ALGORITHMS, clockTolerance: 30 }));
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof joseErrors.JWKSTimeout) throw new AppError("unavailable", "Nhà cung cấp danh tính không phản hồi.");
    if (e instanceof joseErrors.JWTExpired) throw new AppError("unauthenticated", "Token đã hết hạn.");
    throw new AppError("unauthenticated", "Token không hợp lệ.");
  }
  const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (payload.azp !== idp.clientId && !aud.includes(idp.clientId)) throw new AppError("unauthenticated", "Token không được cấp cho ứng dụng Hub.");
  const sub = str(payload.sub);
  if (!sub) throw new AppError("unauthenticated", "Token thiếu sub.");
  const raw = payload[idp.groupsClaim];
  const groups = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").map((x) => x.replace(/^\//, "")) : [];
  return {
    iss: idp.issuer,
    sub,
    email: str(payload.email)?.toLowerCase() ?? null,
    emailVerified: payload.email_verified === true,
    name: str(payload.name),
    groups,
    hasGroupsClaim: Array.isArray(raw),
  };
}

/** Dùng trong test: xoá cache discovery / JWKS. */
export function resetOidcCaches(): void {
  discoCache.clear();
  jwksCache.clear();
}
