import { createHash } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

/**
 * Service account Google Cloud (JSON) → access token OAuth2, dùng cho cổng LLM gọi Vertex AI thay người dùng.
 * Token sống ~1 giờ; giữ trong RAM của tiến trình (khoá cache = băm của client_email + private_key_id, không chứa khoá riêng)
 * và xin lại khi còn dưới 2 phút. Khoá riêng và access token không bao giờ rời tiến trình này, không ghi log.
 */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

interface Cached { token: string; until: number }
interface Globals { __cpSaTokens?: Map<string, Cached> }
const g = globalThis as unknown as Globals;
const cache = (g.__cpSaTokens ??= new Map());

export interface ServiceAccountInfo { clientEmail: string; projectId: string; privateKey: string; privateKeyId: string }

export function parseServiceAccount(json: string): ServiceAccountInfo {
  const o = JSON.parse(json) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  if (s("type") !== "service_account" || !s("client_email") || !s("private_key") || !s("project_id")) throw new Error("service account không hợp lệ");
  return { clientEmail: s("client_email"), projectId: s("project_id"), privateKey: s("private_key"), privateKeyId: s("private_key_id") };
}

export async function serviceAccountAccessToken(sa: ServiceAccountInfo, now: () => number = Date.now): Promise<string> {
  const key = createHash("sha256").update(`${sa.clientEmail}|${sa.privateKeyId}|${createHash("sha256").update(sa.privateKey).digest("hex")}`).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.until - now() > 120_000) return hit.token;

  const iat = Math.floor(now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", ...(sa.privateKeyId ? { kid: sa.privateKeyId } : {}) })
    .setIssuer(sa.clientEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(await importPKCS8(sa.privateKey, "RS256"));

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown };
  if (!res.ok || typeof body.access_token !== "string") {
    // Chỉ ghi mã lỗi của Google (vd invalid_grant) — không ghi assertion hay khoá.
    throw new Error(`Google từ chối service account (${typeof body.error === "string" ? body.error : `HTTP ${res.status}`})`);
  }
  const ttl = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  cache.set(key, { token: body.access_token, until: now() + ttl * 1000 });
  if (cache.size > 200) for (const [k, v] of cache) if (v.until <= now()) cache.delete(k);
  return body.access_token;
}

export function resetServiceAccountTokensForTests(): void {
  cache.clear();
}
