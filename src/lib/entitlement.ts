/**
 * Gói quyền (entitlement) gửi cho Hub: định dạng, chuẩn hoá để ký, và HÀM KIỂM do Hub dùng.
 *
 * File này chỉ phụ thuộc `zod` và `node:crypto` (Hub chạy Main bằng Node) nên Hub có thể nhập thẳng hoặc sao chép nguyên.
 * Chữ ký: Ed25519 trên  "nexlab-entitlement-v1\n" + canonicalize(payload).
 * Xem docs/08-api-cho-hub.md.
 */
import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { PERMS } from "./hub-permissions";

export const ENTITLEMENT_DOMAIN = "nexlab-entitlement-v1\n";
export const ENTITLEMENT_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** JSON chuẩn hoá: khoá sắp xếp theo thứ tự chữ, không khoảng trắng. Từ chối giá trị không biểu diễn được. */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalize: số không hợp lệ");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return `{${keys.map((k) => {
        if (obj[k] === undefined) throw new Error(`canonicalize: giá trị undefined ở khoá ${k}`);
        return `${JSON.stringify(k)}:${canonicalize(obj[k])}`;
      }).join(",")}}`;
    }
    default:
      throw new Error(`canonicalize: kiểu ${typeof value} không hỗ trợ`);
  }
}

const level = z.enum(["open", "ask", "M0", "M1", "M2", "M3"]);

export const entitlementPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  issuer: z.literal("control-plane"),
  /** Số tăng đơn điệu của tenant. Hub từ chối gói có số thấp hơn số đã thấy (chống quay lui). */
  policyVersion: z.number().int().min(1),
  issuedAt: z.string(),
  expiresAt: z.string(),
  tenant: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    branding: z.object({ productName: z.string().nullable(), accent: z.string().nullable() }),
  }),
  /** Gói chỉ dùng được cho đúng người và đúng máy này. */
  audience: z.object({ userId: z.string(), deviceId: z.string() }),
  subject: z.object({
    email: z.string(),
    label: z.string(),
    hubRole: z.enum(["viewer", "member", "lead", "admin"]),
    departments: z.array(z.object({ id: z.string(), name: z.string(), isManager: z.boolean() })),
  }),
  mode: z.literal("enforce"),
  /** Luôn false ở chế độ managed: Hub không cho mở origin ngoài `apps`. */
  allowUnlistedApps: z.literal(false),
  apps: z.array(z.object({
    catalogAppId: z.string(),
    origin: z.string(),
    label: z.string(),
    tags: z.array(z.string()),
    icon: z.string(),
    color: z.string(),
  })),
  roles: z.record(z.string(), z.object({
    label: z.string(),
    can: z.array(z.enum(PERMS)),
    autonomyMax: z.enum(["M0", "M1", "M2"]),
  })),
  /** vai trò → "origin:<origin>" → mức */
  access: z.record(z.string(), z.record(z.string(), level)),
  assign: z.array(z.object({ who: z.object({ subject: z.string() }), role: z.string() })),
});
export type EntitlementPayload = z.infer<typeof entitlementPayloadSchema>;

export interface EntitlementSignature { alg: "Ed25519"; keyId: string; sig: string }
export interface SignedEntitlement { payload: EntitlementPayload; signature: EntitlementSignature }
/** Khoá công khai tin cậy: SPKI DER mã hoá base64. Hub NHÚNG khoá này trong bản build, không tải qua mạng ở production. */
export interface TrustedKey { keyId: string; publicKey: string }

export type VerifyFailure =
  | "malformed"
  | "unknown_key"
  | "bad_signature"
  | "wrong_audience"
  | "wrong_tenant"
  | "not_yet_valid"
  | "expired"
  | "rollback";

export type VerifyResult = { ok: true; payload: EntitlementPayload } | { ok: false; reason: VerifyFailure; detail?: string };

export interface VerifyOptions {
  trustedKeys: readonly TrustedKey[];
  now?: Date;
  /** Hub biết mình đang đăng nhập ai trên máy nào → gói của người/máy khác bị từ chối. */
  expect?: { userId?: string; deviceId?: string; tenantId?: string };
  /** policyVersion lớn nhất Hub đã từng chấp nhận cho tenant này. */
  lastSeenPolicyVersion?: number;
  clockSkewMs?: number;
}

/**
 * Kiểm một gói quyền theo đúng thứ tự: cấu trúc → khoá → CHỮ KÝ → nội dung hợp lệ → người/máy → thời hạn → quay lui.
 * Chữ ký được kiểm TRƯỚC khi tin bất kỳ trường nào của payload.
 */
export function verifyEntitlement(bundle: unknown, opts: VerifyOptions): VerifyResult {
  const b = bundle as { payload?: unknown; signature?: Partial<EntitlementSignature> } | null;
  if (!b || typeof b !== "object" || !b.payload || typeof b.payload !== "object" || !b.signature || typeof b.signature !== "object")
    return { ok: false, reason: "malformed" };
  const sig = b.signature;
  if (sig.alg !== "Ed25519" || typeof sig.keyId !== "string" || typeof sig.sig !== "string") return { ok: false, reason: "malformed" };

  const key = opts.trustedKeys.find((k) => k.keyId === sig.keyId);
  if (!key) return { ok: false, reason: "unknown_key", detail: sig.keyId };

  let valid = false;
  try {
    const publicKey = createPublicKey({ key: Buffer.from(key.publicKey, "base64"), format: "der", type: "spki" });
    valid = verify(null, Buffer.from(ENTITLEMENT_DOMAIN + canonicalize(b.payload), "utf8"), publicKey, Buffer.from(sig.sig, "base64"));
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (!valid) return { ok: false, reason: "bad_signature" };

  const parsed = entitlementPayloadSchema.safeParse(b.payload);
  if (!parsed.success) return { ok: false, reason: "malformed", detail: parsed.error.issues[0]?.message };
  const p = parsed.data;

  if (opts.expect?.userId && p.audience.userId !== opts.expect.userId) return { ok: false, reason: "wrong_audience", detail: "userId" };
  if (opts.expect?.deviceId && p.audience.deviceId !== opts.expect.deviceId) return { ok: false, reason: "wrong_audience", detail: "deviceId" };
  if (opts.expect?.tenantId && p.tenant.id !== opts.expect.tenantId) return { ok: false, reason: "wrong_tenant" };

  const now = (opts.now ?? new Date()).getTime();
  const skew = opts.clockSkewMs ?? ENTITLEMENT_CLOCK_SKEW_MS;
  if (now + skew < Date.parse(p.issuedAt)) return { ok: false, reason: "not_yet_valid" };
  if (now > Date.parse(p.expiresAt)) return { ok: false, reason: "expired" };

  if (opts.lastSeenPolicyVersion !== undefined && p.policyVersion < opts.lastSeenPolicyVersion)
    return { ok: false, reason: "rollback", detail: `${p.policyVersion} < ${opts.lastSeenPolicyVersion}` };

  return { ok: true, payload: p };
}
