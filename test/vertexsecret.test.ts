/**
 * Khoá Vertex AI chung (service account Google Cloud): kiểm + chuẩn hoá JSON, lưu mã hoá, giao đúng vai, không lọt vào gói quyền / audit. Cần Postgres.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CP_DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
process.env.CP_ALLOW_DEV_ORIGINS = "0";
process.env.CP_SIGNING_KEY_PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
process.env.CP_SECRETS_KEY = randomBytes(32).toString("base64");
// Kiểm đường giao JSON service account bản rõ — chế độ `legacy`. Mặc định `gateway` không giao khoá này (xem llm-gateway.test.ts).
process.env.CP_SECRET_DELIVERY = "legacy";

import { closeDb, db } from "@/server/db";
import { loadActor } from "@/server/actor";
import { DEV_PASSWORD, seedDatabase } from "@/server/seed";
import { listSecrets, setSecret } from "@/server/services/config";
import { SERVICE_ACCOUNT_ENV, normalizeSecretValue } from "@/lib/config-keys";
import { POST as tokenPOST } from "@/app/v1/auth/token/route";
import { GET as secretsGET } from "@/app/v1/secrets/route";
import { GET as entitlementsGET } from "@/app/v1/entitlements/route";

const DEVICE = "dev-vtx-0001";
const fakeIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function login(email: string): Promise<string> {
  const res = await tokenPOST(new Request("http://cp.test/v1/auth/token", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": fakeIp() }, body: JSON.stringify({ email, password: DEV_PASSWORD, deviceId: DEVICE }) }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}
const headers = (token: string) => ({ authorization: `Bearer ${token}`, "x-device-id": DEVICE, "x-forwarded-for": fakeIp() });
const secretsOf = async (token: string) => ((await (await secretsGET(new Request("http://cp.test/v1/secrets", { headers: headers(token) }))).json()) as { secrets: { env: string; value: string }[] }).secrets;
const actorOf = async (email: string) => {
  const r = (await (await db()).one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]))!;
  return (await loadActor(await db(), r.id))!;
};

// Khoá giả (KHÔNG phải khoá thật): đủ hình dạng để qua bước kiểm.
const PEM = "-----BEGIN PRIVATE KEY-----\nMIIFAKEFAKEFAKEDONOTLEAK\n-----END PRIVATE KEY-----\n";
const SA = { type: "service_account", project_id: "nexlab-poc", private_key_id: "abcdef0123456789", private_key: PEM, client_email: "hub-vertex@nexlab-poc.iam.gserviceaccount.com", client_id: "1" };

describe("normalizeSecretValue", () => {
  it("khoá thường: 8–512 ký tự in được", () => {
    expect(normalizeSecretValue("OPENAI_API_KEY", " sk-abcdefgh1234 ")).toEqual({ value: "sk-abcdefgh1234", last4: "1234" });
    expect(normalizeSecretValue("OPENAI_API_KEY", "ngan")).toBeNull();
    expect(normalizeSecretValue("OPENAI_API_KEY", "co khoang trang 123456")).toBeNull();
  });

  it("service account: nhận JSON hợp lệ (cả bản in đẹp nhiều dòng), lưu gọn một dòng, last4 là phần cuối private_key_id", () => {
    const r = normalizeSecretValue(SERVICE_ACCOUNT_ENV, JSON.stringify(SA, null, 2));
    expect(r?.last4).toBe("6789");
    expect(r?.value).toBe(JSON.stringify(SA));
    expect(r?.value).not.toContain("\n");
  });

  it("service account: từ chối JSON sai hình dạng", () => {
    const bad = (o: unknown) => normalizeSecretValue(SERVICE_ACCOUNT_ENV, typeof o === "string" ? o : JSON.stringify(o));
    expect(bad("không phải json")).toBeNull();
    expect(bad("[1,2]")).toBeNull();
    expect(bad({ ...SA, type: "authorized_user" })).toBeNull(); // ADC của một người (refresh token) — KHÔNG được chia sẻ
    expect(bad({ ...SA, private_key: "không phải PEM" })).toBeNull();
    expect(bad({ ...SA, client_email: "khong-co-a-cong" })).toBeNull();
    expect(bad({ ...SA, project_id: "" })).toBeNull();
    expect(bad({ ...SA, junk: "x".repeat(5000) })).toBeNull();
  });
});

describe("kho khoá Vertex chung", () => {
  beforeAll(async () => {
    await seedDatabase(await db());
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  it("quản trị đặt: DB chỉ có bản mã, audit và danh sách không lộ khoá riêng; member nhận JSON gọn; viewer/author-không-trong-vai thì không", async () => {
    const admin = await actorOf("admin@nexlab.tech");
    await expect(setSecret(admin, { key: SERVICE_ACCOUNT_ENV, value: "{}", roles: ["member"] })).rejects.toMatchObject({ code: "invalid" });
    await expect(setSecret(admin, { key: SERVICE_ACCOUNT_ENV, value: JSON.stringify({ ...SA, type: "authorized_user" }), roles: ["member"] })).rejects.toMatchObject({ code: "invalid" });
    await setSecret(admin, { key: SERVICE_ACCOUNT_ENV, value: JSON.stringify(SA, null, 2), roles: ["member", "lead", "admin"] });

    const row = (await (await db()).one<{ ciphertext: string; last4: string }>("SELECT ciphertext, last4 FROM tenant_secrets WHERE key = $1", [SERVICE_ACCOUNT_ENV]))!;
    expect(row.ciphertext).not.toContain("FAKEDONOTLEAK");
    expect(row.last4).toBe("6789");
    const audits = JSON.stringify(await (await db()).q("SELECT summary, before, after FROM audit_log WHERE action LIKE 'secret.%'"));
    expect(audits).not.toContain("DONOTLEAK");
    const list = await listSecrets(admin);
    expect(JSON.stringify(list)).not.toContain("DONOTLEAK");
    expect(list.find((s) => s.key === SERVICE_ACCOUNT_ENV)).toMatchObject({ configured: true, multiline: true, last4: "6789" });

    const got = (await secretsOf(await login("nv.nhansu@nexlab.tech"))).find((s) => s.env === SERVICE_ACCOUNT_ENV);
    expect(got).toBeDefined();
    expect(JSON.parse(got!.value)).toMatchObject({ type: "service_account", project_id: "nexlab-poc" });
    expect((await secretsOf(await login("soansop@nexlab.tech"))).some((s) => s.env === SERVICE_ACCOUNT_ENV)).toBe(false); // author không thuộc danh sách vai
    expect(await secretsOf(await login("khach.xem@nexlab.tech"))).toEqual([]); // viewer không bao giờ
  });

  it("khoá riêng không nằm trong gói quyền đã ký", async () => {
    const res = await entitlementsGET(new Request("http://cp.test/v1/entitlements", { headers: headers(await login("nv.nhansu@nexlab.tech")) }));
    expect(JSON.stringify(await res.json())).not.toContain("DONOTLEAK");
  });
});
