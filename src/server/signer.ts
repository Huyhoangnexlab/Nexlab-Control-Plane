import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TrustedKey } from "@/lib/entitlement";

/**
 * Ký gói quyền bằng Ed25519. Giao diện `Signer` để sau này thay bằng Cloud KMS (khoá không rời KMS) mà không đổi nơi gọi.
 *
 * Nguồn khoá hôm nay (LocalKeySigner):
 *  - `CP_SIGNING_KEY_PEM`: khoá riêng PKCS#8 PEM (production: lấy từ Secret Manager). Cho phép viết `\n` thay xuống dòng.
 *  - nếu không đặt và KHÔNG ở production: tự sinh ở `.data/dev-signing-key.pem` (đã .gitignore) — chỉ để chạy dev.
 *  - production mà thiếu khoá → lỗi, không tự sinh.
 */
export interface Signer {
  keyId: string;
  /** SPKI DER base64 — giá trị Hub nhúng vào bản build. */
  publicKey: string;
  sign(data: Buffer): Promise<Buffer>;
}

class LocalKeySigner implements Signer {
  readonly keyId: string;
  readonly publicKey: string;
  constructor(private readonly privateKey: KeyObject) {
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Khoá ký phải là Ed25519");
    const der = createPublicKey(privateKey).export({ type: "spki", format: "der" });
    this.publicKey = der.toString("base64");
    this.keyId = createHash("sha256").update(der).digest("hex").slice(0, 16);
  }
  async sign(data: Buffer): Promise<Buffer> {
    return cryptoSign(null, data, this.privateKey);
  }
}

interface Globals { __cpSigner?: Signer }
const g = globalThis as unknown as Globals;

function loadPrivateKey(): KeyObject {
  const fromEnv = process.env.CP_SIGNING_KEY_PEM;
  if (fromEnv?.trim()) return createPrivateKey(fromEnv.replace(/\\n/g, "\n"));
  if (process.env.NODE_ENV === "production") throw new Error("Thiếu CP_SIGNING_KEY_PEM ở production — không tự sinh khoá ký.");
  const file = path.join(process.cwd(), ".data", "dev-signing-key.pem");
  if (existsSync(file)) return createPrivateKey(readFileSync(file, "utf8"));
  const { privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }) as string, { mode: 0o600 });
  return privateKey;
}

export function getSigner(): Signer {
  g.__cpSigner ??= new LocalKeySigner(loadPrivateKey());
  return g.__cpSigner;
}

/** Dùng trong test để đặt khoá cố định. */
export function resetSignerForTests(): void {
  g.__cpSigner = undefined;
}

/** Danh sách khoá công khai đang tin cậy (hiện chỉ có khoá đang ký; xoay khoá = thêm khoá cũ vào đây). */
export function trustedKeys(): TrustedKey[] {
  const s = getSigner();
  return [{ keyId: s.keyId, publicKey: s.publicKey }];
}
