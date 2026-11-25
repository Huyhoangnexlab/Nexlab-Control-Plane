/**
 * Cấu hình theo tầng + kho bí mật: ghép tổ chức → phòng ban có khoá, chiều thu hẹp của giá trị cá nhân, quyền sửa chỉ quản trị tổ chức,
 * bí mật mã hoá khi lưu (không bản rõ ở DB / audit), giao đúng vai, không có đường đọc lại. Cần Postgres: `docker compose up -d`.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CP_DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
process.env.CP_ALLOW_DEV_ORIGINS = "0";
process.env.CP_SIGNING_KEY_PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
process.env.CP_SECRETS_KEY = randomBytes(32).toString("base64");
// File này kiểm CƠ CHẾ giao khoá bản rõ (lọc theo vai, audit, bản mã bị dán) — tức chế độ `legacy`. Chế độ mặc định `gateway`
// (khoá mô hình không rời server) có test riêng ở llm-gateway.test.ts.
process.env.CP_SECRET_DELIVERY = "legacy";

import { closeDb, db } from "@/server/db";
import { loadActor } from "@/server/actor";
import { DEV_PASSWORD, seedDatabase } from "@/server/seed";
import { trustedKeys } from "@/server/signer";
import { clearConfig, clearSecret, listSecrets, setConfig, setSecret } from "@/server/services/config";
import { decryptSecret, encryptSecret } from "@/server/secrets-crypto";
import { verifyEntitlement, type SignedEntitlement } from "@/lib/entitlement";
import { isNarrowerOrEqual, resolveConfig, validateOrgConfigValue, orgConfigKey, type ConfigRow } from "@/lib/config-keys";
import { GET as entitlementsGET } from "@/app/v1/entitlements/route";
import { GET as secretsGET } from "@/app/v1/secrets/route";
import { POST as tokenPOST } from "@/app/v1/auth/token/route";

const DEVICE = "dev-cfg-0001";
const fakeIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const req = (url: string, token?: string) => new Request(`http://cp.test${url}`, { headers: { "x-forwarded-for": fakeIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
async function login(email: string): Promise<string> {
  const res = await tokenPOST(new Request("http://cp.test/v1/auth/token", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": fakeIp() }, body: JSON.stringify({ email, password: DEV_PASSWORD, deviceId: DEVICE, deviceName: "Laptop thử" }) }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}
const bundleOf = async (token: string) => (await (await entitlementsGET(req("/v1/entitlements", token))).json()) as SignedEntitlement;
const secretsOf = async (token: string) => {
  const res = await secretsGET(req("/v1/secrets", token));
  return { status: res.status, body: (await res.json()) as { secrets?: { env: string; value: string }[] } };
};
const id = async (sql: string, params: unknown[] = []) => (await (await db()).one<{ id: string }>(sql, params))!.id;
const userId = (email: string) => id("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
const actorOf = async (email: string) => (await loadActor(await db(), await userId(email)))!;
const deptId = (name: string) => id("SELECT d.id FROM departments d JOIN tenants t ON t.id = d.tenant_id WHERE t.slug = 'nexlab' AND d.name = $1", [name]);

beforeAll(async () => {
  await seedDatabase(await db());
}, 60_000);
afterAll(async () => {
  await closeDb(true);
});

describe("ghép cấu hình (hàm thuần)", () => {
  const org = (key: string, value: string, locked = false): ConfigRow => ({ scope: "org", key, value, locked });
  const dept = (deptName: string, key: string, value: string, locked = false): ConfigRow => ({ scope: "dept", deptName, deptId: `dep_${deptName}`, key, value, locked });

  it("tổ chức là nền; phòng ban ghi đè giá trị chưa khoá", () => {
    const r = resolveConfig([org("AGENT_PROVIDER", "gemini"), dept("Nhân sự", "AGENT_PROVIDER", "openai")]);
    expect(r.AGENT_PROVIDER).toEqual({ value: "openai", locked: false });
  });
  it("giá trị tổ chức đã KHOÁ thì phòng ban không ghi đè được", () => {
    const r = resolveConfig([org("AGENT_PROVIDER", "gemini", true), dept("Nhân sự", "AGENT_PROVIDER", "openai")]);
    expect(r.AGENT_PROVIDER).toEqual({ value: "gemini", locked: true });
  });
  it("nhiều phòng: phòng xếp trước theo tên thắng, ổn định", () => {
    const rows = [dept("Kinh doanh", "NEXLAB_AUTONOMY", "M0"), dept("Kế toán", "NEXLAB_AUTONOMY", "M2")];
    expect(resolveConfig(rows).NEXLAB_AUTONOMY.value).toBe(resolveConfig([...rows].reverse()).NEXLAB_AUTONOMY.value);
  });
  it("khoá ngoài danh mục hoặc giá trị sai dạng bị bỏ", () => {
    const r = resolveConfig([org("PATH", "C:\\x"), org("AGENT_PROVIDER", "khong-co"), org("OLLAMA_HOST", "javascript:alert(1)"), org("OLLAMA_HOST", "http://u:p@h"), org("GEMINI_MODEL", "gemini-3.8-flash")]);
    expect(Object.keys(r)).toEqual(["GEMINI_MODEL"]);
  });
  it("giá trị cá nhân chỉ được thu hẹp", () => {
    expect(isNarrowerOrEqual("NEXLAB_MEMORY_RETENTION_DAYS", "30", "90")).toBe(true);
    expect(isNarrowerOrEqual("NEXLAB_MEMORY_RETENTION_DAYS", "90", "90")).toBe(true);
    expect(isNarrowerOrEqual("NEXLAB_MEMORY_RETENTION_DAYS", "180", "90")).toBe(false);
    expect(isNarrowerOrEqual("NEXLAB_MEMORY_PERSIST", "1", "0")).toBe(false);
    expect(isNarrowerOrEqual("NEXLAB_MEMORY_PERSIST", "0", "1")).toBe(true);
    expect(isNarrowerOrEqual("NEXLAB_MEMORY_RETENTION_DAYS", "365", undefined)).toBe(true);
    expect(isNarrowerOrEqual("AGENT_PROVIDER", "openai", "gemini")).toBe(false);
  });
  it("kiểm dạng giá trị theo danh mục", () => {
    const spec = orgConfigKey("NEXLAB_MEMORY_RETENTION_DAYS")!;
    expect(validateOrgConfigValue(spec, "30")).toBe("30");
    expect(validateOrgConfigValue(spec, "31")).toBeNull();
  });
});

describe("mã hoá bí mật", () => {
  it("khứ hồi đúng; AAD gắn bản mã với (tenant, khoá) nên không dán sang khoá khác được", () => {
    const blob = encryptSecret("sk-test-1234567890", "ten_1|OPENAI_API_KEY");
    expect(blob).not.toContain("sk-test");
    expect(decryptSecret(blob, "ten_1|OPENAI_API_KEY")).toBe("sk-test-1234567890");
    expect(() => decryptSecret(blob, "ten_1|GEMINI_API_KEY")).toThrow();
    expect(() => decryptSecret(blob, "ten_2|OPENAI_API_KEY")).toThrow();
    expect(encryptSecret("x".repeat(20), "a")).not.toBe(encryptSecret("x".repeat(20), "a")); // IV ngẫu nhiên
  });
});

describe("cấu hình trong gói quyền", () => {
  it("chỉ quản trị tổ chức đặt được; trưởng phòng / nhân viên bị từ chối", async () => {
    for (const email of ["truongphong.nhansu@nexlab.tech", "nv.nhansu@nexlab.tech", "soansop@nexlab.tech", "khach.xem@nexlab.tech"]) {
      const a = await actorOf(email);
      await expect(setConfig(a, { key: "AGENT_PROVIDER", value: "gemini" }), email).rejects.toMatchObject({ code: "forbidden" });
      await expect(clearConfig(a, { key: "AGENT_PROVIDER" }), email).rejects.toMatchObject({ code: "forbidden" });
      await expect(setSecret(a, { key: "OPENAI_API_KEY", value: "sk-abcdefgh12345678", roles: ["member"] }), email).rejects.toMatchObject({ code: "forbidden" });
      await expect(clearSecret(a, { key: "OPENAI_API_KEY" }), email).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("khoá / giá trị ngoài danh mục bị từ chối; dữ liệu hợp lệ vào gói quyền ĐÃ KÝ của đúng người", async () => {
    const admin = await actorOf("admin@nexlab.tech");
    await expect(setConfig(admin, { key: "PATH", value: "C:\\Windows" })).rejects.toMatchObject({ code: "invalid" });
    await expect(setConfig(admin, { key: "AGENT_PROVIDER", value: "khong-co" })).rejects.toMatchObject({ code: "invalid" });
    await setConfig(admin, { key: "AGENT_PROVIDER", value: "gemini", locked: true });
    await setConfig(admin, { key: "NEXLAB_MEMORY_RETENTION_DAYS", value: "30", locked: false });
    await setConfig(admin, { key: "NEXLAB_AUTONOMY", value: "M1", locked: false });
    await setConfig(admin, { key: "NEXLAB_AUTONOMY", value: "M0", locked: false, deptId: await deptId("Nhân sự") });
    // cố ghi đè giá trị đã khoá ở cấp phòng: được lưu nhưng KHÔNG có hiệu lực
    await setConfig(admin, { key: "AGENT_PROVIDER", value: "openai", deptId: await deptId("Nhân sự") });

    const b = await bundleOf(await login("nv.nhansu@nexlab.tech"));
    expect(verifyEntitlement(b, { trustedKeys: trustedKeys() }).ok).toBe(true); // chữ ký vẫn đúng khi có config
    expect(b.payload.config).toEqual({
      AGENT_PROVIDER: { value: "gemini", locked: true },
      NEXLAB_MEMORY_RETENTION_DAYS: { value: "30", locked: false },
      NEXLAB_AUTONOMY: { value: "M0", locked: false },
    });
    const sales = await bundleOf(await login("nv.kinhdoanh@nexlab.tech"));
    expect(sales.payload.config.NEXLAB_AUTONOMY).toEqual({ value: "M1", locked: false });
  });

  it("gói bị sửa config (gỡ khoá) thì chữ ký không còn đúng", async () => {
    const b = await bundleOf(await login("nv.nhansu@nexlab.tech"));
    b.payload.config.AGENT_PROVIDER = { value: "mock", locked: false };
    expect(verifyEntitlement(b, { trustedKeys: trustedKeys() })).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("đổi cấu hình tăng policyVersion và ghi audit; bỏ giá trị thì biến mất khỏi gói", async () => {
    const admin = await actorOf("admin@nexlab.tech");
    const before = (await bundleOf(await login("nv.ketoan@nexlab.tech"))).payload.policyVersion;
    await setConfig(admin, { key: "GEMINI_MODEL", value: "gemini-3.8-flash" });
    const mid = await bundleOf(await login("nv.ketoan@nexlab.tech"));
    expect(mid.payload.policyVersion).toBeGreaterThan(before);
    expect(mid.payload.config.GEMINI_MODEL.value).toBe("gemini-3.8-flash");
    await clearConfig(admin, { key: "GEMINI_MODEL" });
    expect((await bundleOf(await login("nv.ketoan@nexlab.tech"))).payload.config.GEMINI_MODEL).toBeUndefined();
    const a = await (await db()).q("SELECT action FROM audit_log WHERE action IN ('config.set','config.clear')");
    expect(a.length).toBeGreaterThanOrEqual(2);
  });
});

describe("kho bí mật", () => {
  const SECRET = "sk-demo-DO-NOT-LEAK-7f3a9c21";

  it("đặt khoá: DB chỉ có bản mã, audit không có giá trị, danh sách chỉ lộ 4 ký tự cuối", async () => {
    const admin = await actorOf("admin@nexlab.tech");
    await setSecret(admin, { key: "OPENAI_API_KEY", value: SECRET, roles: ["member", "lead", "admin"] });
    const row = (await (await db()).one<{ ciphertext: string; last4: string }>("SELECT ciphertext, last4 FROM tenant_secrets WHERE key = 'OPENAI_API_KEY'"))!;
    expect(row.ciphertext).not.toContain("DO-NOT-LEAK");
    expect(row.last4).toBe("9c21");
    const audits = JSON.stringify(await (await db()).q("SELECT summary, before, after FROM audit_log WHERE action LIKE 'secret.%'"));
    expect(audits).not.toContain("DO-NOT-LEAK");
    const list = await listSecrets(admin);
    expect(JSON.stringify(list)).not.toContain("DO-NOT-LEAK");
    expect(list.find((s) => s.key === "OPENAI_API_KEY")).toMatchObject({ configured: true, last4: "9c21", roles: ["member", "lead", "admin"] });
    await expect(setSecret(admin, { key: "OPENAI_API_KEY", value: "ngan", roles: ["member"] })).rejects.toMatchObject({ code: "invalid" });
    await expect(setSecret(admin, { key: "OPENAI_API_KEY", value: SECRET, roles: ["viewer"] })).rejects.toMatchObject({ code: "invalid" });
    await expect(setSecret(admin, { key: "KHONG_CO", value: SECRET, roles: ["member"] })).rejects.toMatchObject({ code: "invalid" });
  });

  it("GET /v1/secrets: giao đúng vai; vai không có / viewer / không token thì không nhận", async () => {
    const member = await secretsOf(await login("nv.nhansu@nexlab.tech"));
    expect(member.status).toBe(200);
    expect(member.body.secrets).toEqual([{ env: "OPENAI_API_KEY", value: SECRET }]);
    expect((await secretsOf(await login("truongphong.nhansu@nexlab.tech"))).body.secrets).toHaveLength(1); // lead
    expect((await secretsOf(await login("soansop@nexlab.tech"))).body.secrets).toEqual([]); // author không có trong danh sách vai
    expect((await secretsOf(await login("khach.xem@nexlab.tech"))).body.secrets).toEqual([]); // viewer không bao giờ
    expect((await secretsGET(req("/v1/secrets"))).status).toBe(401);
    expect((await secretsGET(req("/v1/secrets", "nxh_khong-co-that"))).status).toBe(401);
  });

  it("bí mật KHÔNG nằm trong gói quyền đã ký", async () => {
    const b = await bundleOf(await login("nv.nhansu@nexlab.tech"));
    expect(JSON.stringify(b)).not.toContain("DO-NOT-LEAK");
  });

  it("audit giao khoá chỉ ghi tên khoá, tối đa một dòng mỗi giờ cho mỗi (người, thiết bị)", async () => {
    const before = (await (await db()).q("SELECT 1 FROM audit_log WHERE action = 'secret.deliver'")).length;
    const t = await login("nv.kinhdoanh@nexlab.tech");
    await secretsOf(t);
    await secretsOf(t);
    const rows = await (await db()).q<{ summary: string; after: { keys: string[] } }>("SELECT summary, after FROM audit_log WHERE action = 'secret.deliver' ORDER BY id");
    expect(rows.length - before).toBe(1);
    expect(JSON.stringify(rows)).not.toContain("DO-NOT-LEAK");
    expect(rows[rows.length - 1].after.keys).toEqual(["OPENAI_API_KEY"]);
  });

  it("bản mã bị dán sang khoá khác thì không giải được (khoá đó bị bỏ qua, không làm hỏng khoá khác)", async () => {
    const admin = await actorOf("admin@nexlab.tech");
    await setSecret(admin, { key: "GEMINI_API_KEY", value: "gemini-key-1234567890", roles: ["member"] });
    await (await db()).q("UPDATE tenant_secrets SET ciphertext = (SELECT ciphertext FROM tenant_secrets WHERE key = 'OPENAI_API_KEY') WHERE key = 'GEMINI_API_KEY'");
    const r = await secretsOf(await login("nv.nhansu@nexlab.tech"));
    expect(r.body.secrets).toEqual([{ env: "OPENAI_API_KEY", value: SECRET }]);
  });

  it("xoá khoá: người dùng không còn nhận được", async () => {
    const admin = await actorOf("admin@nexlab.tech");
    await clearSecret(admin, { key: "OPENAI_API_KEY" });
    await clearSecret(admin, { key: "GEMINI_API_KEY" });
    expect((await secretsOf(await login("nv.nhansu@nexlab.tech"))).body.secrets).toEqual([]);
  });
});
