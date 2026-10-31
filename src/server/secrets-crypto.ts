import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Mã hoá bí mật của tổ chức (khoá API, token) trước khi vào DB: AES-256-GCM, khoá 32 byte từ CP_SECRETS_KEY (base64).
 *  - Production BẮT BUỘC có CP_SECRETS_KEY (tách khỏi khoá ký gói quyền — hai việc khác nhau, xoay khoá độc lập).
 *  - Dev (không phải production): tự sinh `.data/dev-secrets-key` (đã .gitignore).
 *  - AAD = `tenantId|key` → bản mã của khoá A không thể dán sang khoá B hoặc tenant khác.
 *  - Bản mã = base64( iv(12) | tag(16) | ciphertext ). Giá trị gốc KHÔNG bao giờ được ghi vào DB, audit hay log.
 */
const ALGO = "aes-256-gcm";

interface Globals { __cpSecretsKey?: Buffer }
const g = globalThis as unknown as Globals;

function loadKey(): Buffer {
  const fromEnv = process.env.CP_SECRETS_KEY?.trim();
  if (fromEnv) {
    const k = Buffer.from(fromEnv, "base64");
    if (k.length !== 32) throw new Error("CP_SECRETS_KEY phải là 32 byte mã hoá base64.");
    return k;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Thiếu CP_SECRETS_KEY ở production — không tự sinh khoá mã hoá bí mật.");
  const file = path.join(process.cwd(), ".data", "dev-secrets-key");
  if (existsSync(file)) return Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  const k = randomBytes(32);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, k.toString("base64"), { mode: 0o600 });
  return k;
}

const key = (): Buffer => (g.__cpSecretsKey ??= loadKey());

export function resetSecretsKeyForTests(): void {
  g.__cpSecretsKey = undefined;
}

export function encryptSecret(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv(ALGO, key(), iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(blob: string, aad: string): string {
  const raw = Buffer.from(blob, "base64");
  if (raw.length < 12 + 16 + 1) throw new Error("bản mã hỏng");
  const d = createDecipheriv(ALGO, key(), raw.subarray(0, 12));
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
