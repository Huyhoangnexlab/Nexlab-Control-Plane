/**
 * Test API cho Hub: discover, token, entitlements (ký Ed25519), keys + hàm kiểm của Hub (verifyEntitlement).
 * Cần Postgres: `docker compose up -d`.
 */
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CP_DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
process.env.CP_ALLOW_DEV_ORIGINS = "0";
process.env.CP_SIGNING_KEY_PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;

import { closeDb, db } from "@/server/db";
import { loadActor } from "@/server/actor";
import { DEV_PASSWORD, seedDatabase } from "@/server/seed";
import { trustedKeys } from "@/server/signer";
import { setDepartmentAppLevel } from "@/server/services/access";
import { updateUser } from "@/server/services/users";
import { discover, issueHubToken } from "@/server/services/entitlements";
import { canonicalize, verifyEntitlement, type SignedEntitlement } from "@/lib/entitlement";
import { HUB_ROLE_ORDER, PERMS, ROLE_PERMS } from "@/lib/hub-permissions";
import { POST as discoverPOST } from "@/app/v1/discover/route";
import { POST as tokenPOST } from "@/app/v1/auth/token/route";
import { POST as revokePOST } from "@/app/v1/auth/revoke/route";
import { GET as entitlementsGET } from "@/app/v1/entitlements/route";
import { GET as keysGET } from "@/app/v1/keys/route";

const DEVICE = "dev-laptop-0001";
const DEVICE2 = "dev-laptop-0002";

// Mỗi yêu cầu mang một IP riêng để không chạm giới hạn tần suất theo IP (có test riêng cho giới hạn này).
const fakeIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://cp.test${url}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": fakeIp(), ...headers }, body: JSON.stringify(body) });
const get = (url: string, token?: string) =>
  new Request(`http://cp.test${url}`, { headers: { "x-forwarded-for": fakeIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) } });

async function login(email: string, deviceId = DEVICE): Promise<string> {
  const res = await tokenPOST(post("/v1/auth/token", { email, password: DEV_PASSWORD, deviceId, deviceName: "Laptop thử" }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}
async function fetchBundle(token: string): Promise<SignedEntitlement> {
  const res = await entitlementsGET(get("/v1/entitlements", token));
  expect(res.status).toBe(200);
  return (await res.json()) as SignedEntitlement;
}
const verifyOpts = () => ({ trustedKeys: trustedKeys() });
const id = async (sql: string, params: unknown[] = []) => (await (await db()).one<{ id: string }>(sql, params))!.id;
const userId = (email: string) => id("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
const deptId = (name: string) => id("SELECT d.id FROM departments d JOIN tenants t ON t.id = d.tenant_id WHERE t.slug = 'nexlab' AND d.name = $1", [name]);
const appId = (name: string) => id("SELECT a.id FROM catalog_apps a JOIN tenants t ON t.id = a.tenant_id WHERE t.slug = 'nexlab' AND a.name = $1", [name]);
const actorOf = async (email: string) => (await loadActor(await db(), await userId(email)))!;

beforeAll(async () => {
  await seedDatabase(await db());
}, 60_000);
afterAll(async () => {
  await closeDb(true);
});

describe("discover", () => {
  it("tìm tổ chức theo tên miền email; không tiết lộ email có tài khoản hay không", async () => {
    const fake = await discover({ email: "nguoi.khong.ton.tai@nexlab.tech" });
    const real = await discover({ email: "admin@nexlab.tech" });
    expect(fake).toEqual(real); // giống hệt dù email không có thật
    expect(real.found).toBe(true);
    expect(real.tenant?.slug).toBe("nexlab");
    expect((await discover({ email: "ai.do@khong-co.vn" })).found).toBe(false);
  });

  it("route: sai định dạng → 400; JSON hỏng → 400; trả no-store", async () => {
    expect((await discoverPOST(post("/v1/discover", { email: "khong-phai-email" }))).status).toBe(400);
    expect((await discoverPOST(new Request("http://cp.test/v1/discover", { method: "POST", body: "{xxx" }))).status).toBe(400);
    const ok = await discoverPOST(post("/v1/discover", { email: "nv.nhansu@nexlab.tech" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("giới hạn tần suất theo IP: quá 30 lần/phút → 429", async () => {
    const ip = "203.0.113.9";
    let last = 200;
    for (let i = 0; i < 32; i++) last = (await discoverPOST(post("/v1/discover", { email: "a@nexlab.tech" }, { "x-forwarded-for": ip }))).status;
    expect(last).toBe(429);
    expect((await discoverPOST(post("/v1/discover", { email: "a@nexlab.tech" }))).status).toBe(200); // IP khác không bị ảnh hưởng
  });

  it("tenant tạm ngưng coi như không tìm thấy", async () => {
    const d = await db();
    await d.q("UPDATE tenants SET status = 'suspended' WHERE slug = 'benhvien-b'");
    expect((await discover({ email: "bacsi@benhvien-b.test" })).found).toBe(false);
    await d.q("UPDATE tenants SET status = 'active' WHERE slug = 'benhvien-b'");
  });
});

describe("token", () => {
  it("sai mật khẩu → 401; thiếu / sai deviceId → 400; quản trị nền tảng → 403", async () => {
    expect((await tokenPOST(post("/v1/auth/token", { email: "nv.nhansu@nexlab.tech", password: "sai-mat-khau-1", deviceId: DEVICE }))).status).toBe(401);
    expect((await tokenPOST(post("/v1/auth/token", { email: "nv.nhansu@nexlab.tech", password: DEV_PASSWORD, deviceId: "ngan" }))).status).toBe(400);
    expect((await tokenPOST(post("/v1/auth/token", { email: "nv.nhansu@nexlab.tech", password: DEV_PASSWORD }))).status).toBe(400);
    expect((await tokenPOST(post("/v1/auth/token", { email: "platform@nexlab.tech", password: DEV_PASSWORD, deviceId: DEVICE }))).status).toBe(403);
  });

  it("token Hub KHÔNG dùng được làm phiên Admin Console và ngược lại", async () => {
    const { resolveSession, createSession } = await import("@/server/auth");
    const hub = await login("nv.nhansu@nexlab.tech");
    expect(await resolveSession(hub)).toBeNull();
    const { token: consoleToken } = await createSession(await userId("nv.nhansu@nexlab.tech"));
    expect((await entitlementsGET(get("/v1/entitlements", consoleToken))).status).toBe(401);
  });
});

describe("entitlements — nội dung", () => {
  it("nhân viên Nhân sự nhận đúng app, mức, quyền và gắn đúng người + thiết bị", async () => {
    const token = await login("nv.nhansu@nexlab.tech");
    const b = await fetchBundle(token);
    const r = verifyEntitlement(b, { ...verifyOpts(), expect: { userId: await userId("nv.nhansu@nexlab.tech"), deviceId: DEVICE } });
    expect(r.ok).toBe(true);
    const p = b.payload;
    expect(p.tenant.slug).toBe("nexlab");
    expect(p.subject.hubRole).toBe("member");
    expect(p.subject.departments.map((d) => d.name)).toEqual(["Nhân sự"]);
    expect(p.apps.map((a) => a.origin).sort()).toEqual(["nexlab-app://hr", "nexlab-app://timesheet"]);
    expect(p.access.effective["origin:nexlab-app://hr"]).toBe("M1");
    expect(p.roles.effective.can).toEqual([...ROLE_PERMS.member]);
    expect(p.roles.effective.autonomyMax).toBe("M1");
    expect(p.allowUnlistedApps).toBe(false);
    expect(p.mode).toBe("enforce");
    expect(Date.parse(p.expiresAt) - Date.parse(p.issuedAt)).toBe(24 * 3600 * 1000);
  });

  it("người thuộc hai phòng được hợp quyền; không có app của phòng khác", async () => {
    const b = await fetchBundle(await login("kiemnhiem@nexlab.tech"));
    expect(b.payload.access.effective["origin:https://demo.us.espocrm.com"]).toBe("M2"); // Kinh doanh M2 + CNTT ask
    expect(b.payload.apps.some((a) => a.origin === "nexlab-app://hr")).toBe(false);
  });

  it("không bao giờ lọt app / thông tin của tenant khác", async () => {
    const b = await fetchBundle(await login("nv.kinhdoanh@nexlab.tech"));
    expect(JSON.stringify(b)).not.toContain("benhvien");
    expect(JSON.stringify(b)).not.toContain("HIS Demo");
    const other = await fetchBundle(await login("bacsi@benhvien-b.test"));
    expect(other.payload.tenant.slug).toBe("benhvien-b");
    expect(other.payload.apps.map((a) => a.label)).toEqual(["HIS Demo"]);
  });

  it("người chưa thuộc phòng nào → không có app; không vai Hub nào có app.add / app.remove", async () => {
    const d = await db();
    const uid = await userId("khach.xem@nexlab.tech");
    await d.q("DELETE FROM memberships WHERE user_id = $1", [uid]);
    const b = await fetchBundle(await login("khach.xem@nexlab.tech"));
    expect(b.payload.apps).toEqual([]);
    expect(b.payload.access.effective).toEqual({});
    expect(b.payload.roles.effective.can).toEqual(["memory.wipe"]);
    for (const role of HUB_ROLE_ORDER) {
      expect(ROLE_PERMS[role]).not.toContain("app.add");
      expect(ROLE_PERMS[role]).not.toContain("app.remove");
      for (const perm of ROLE_PERMS[role]) expect(PERMS).toContain(perm);
    }
    await d.q("INSERT INTO memberships (user_id, department_id) VALUES ($1,$2)", [uid, await deptId("Kinh doanh")]);
  });

  it("policy_version tăng và gói phản ánh thay đổi của trưởng phòng", async () => {
    const token = await login("nv.kinhdoanh@nexlab.tech");
    const before = await fetchBundle(token);
    const mgr = await actorOf("truongphong.kinhdoanh@nexlab.tech");
    await setDepartmentAppLevel(mgr, await deptId("Kinh doanh"), await appId("EspoCRM demo"), "ask");
    const after = await fetchBundle(token);
    expect(after.payload.policyVersion).toBeGreaterThan(before.payload.policyVersion);
    expect(after.payload.access.effective["origin:https://demo.us.espocrm.com"]).toBe("ask");
    const r = verifyEntitlement(after, { ...verifyOpts(), lastSeenPolicyVersion: before.payload.policyVersion });
    expect(r.ok).toBe(true);
    await setDepartmentAppLevel(mgr, await deptId("Kinh doanh"), await appId("EspoCRM demo"), "M2");
  });
});

describe("entitlements — chữ ký và kiểm của Hub (H1–H4)", () => {
  it("canonicalize ổn định theo thứ tự khoá", () => {
    expect(canonicalize({ b: 1, a: [2, { d: null, c: "x" }] })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
    expect(() => canonicalize({ a: undefined })).toThrow();
  });

  it("H1 sửa MỘT chữ trong payload → bad_signature (kể cả nâng mức quyền)", async () => {
    const b = await fetchBundle(await login("nv.nhansu@nexlab.tech"));
    const tampered = structuredClone(b);
    tampered.payload.access.effective["origin:nexlab-app://hr"] = "M2";
    expect(verifyEntitlement(tampered, verifyOpts())).toMatchObject({ ok: false, reason: "bad_signature" });
    const extra = structuredClone(b);
    extra.payload.roles.effective.can.push("app.add");
    expect(verifyEntitlement(extra, verifyOpts())).toMatchObject({ ok: false, reason: "bad_signature" });
    const sigFlip = structuredClone(b);
    const raw = Buffer.from(sigFlip.signature.sig, "base64");
    raw[0] ^= 1;
    sigFlip.signature.sig = raw.toString("base64");
    expect(verifyEntitlement(sigFlip, verifyOpts())).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("khoá lạ / khoá của kẻ khác ký → unknown_key / bad_signature", async () => {
    const b = await fetchBundle(await login("nv.nhansu@nexlab.tech"));
    expect(verifyEntitlement(b, { trustedKeys: [] })).toMatchObject({ ok: false, reason: "unknown_key" });
    const stranger = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");
    expect(verifyEntitlement(b, { trustedKeys: [{ keyId: b.signature.keyId, publicKey: stranger }] })).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("H2 gói của người khác / máy khác / tenant khác bị từ chối", async () => {
    const b = await fetchBundle(await login("nv.nhansu@nexlab.tech"));
    expect(verifyEntitlement(b, { ...verifyOpts(), expect: { userId: await userId("nv.ketoan@nexlab.tech") } })).toMatchObject({ ok: false, reason: "wrong_audience" });
    expect(verifyEntitlement(b, { ...verifyOpts(), expect: { deviceId: DEVICE2 } })).toMatchObject({ ok: false, reason: "wrong_audience" });
    expect(verifyEntitlement(b, { ...verifyOpts(), expect: { tenantId: "ten_khac" } })).toMatchObject({ ok: false, reason: "wrong_tenant" });
  });

  it("H3 quay lui policyVersion bị từ chối", async () => {
    const b = await fetchBundle(await login("nv.nhansu@nexlab.tech"));
    expect(verifyEntitlement(b, { ...verifyOpts(), lastSeenPolicyVersion: b.payload.policyVersion + 1 })).toMatchObject({ ok: false, reason: "rollback" });
    expect(verifyEntitlement(b, { ...verifyOpts(), lastSeenPolicyVersion: b.payload.policyVersion }).ok).toBe(true);
  });

  it("H4 hết hạn → expired; đồng hồ lệch quá nhiều → not_yet_valid; lệch ít được chấp nhận", async () => {
    const b = await fetchBundle(await login("nv.nhansu@nexlab.tech"));
    const issued = Date.parse(b.payload.issuedAt);
    const expires = Date.parse(b.payload.expiresAt);
    expect(verifyEntitlement(b, { ...verifyOpts(), now: new Date(expires + 1000) })).toMatchObject({ ok: false, reason: "expired" });
    expect(verifyEntitlement(b, { ...verifyOpts(), now: new Date(issued - 60 * 60 * 1000) })).toMatchObject({ ok: false, reason: "not_yet_valid" });
    expect(verifyEntitlement(b, { ...verifyOpts(), now: new Date(issued - 60 * 1000) }).ok).toBe(true);
  });

  it("cấu trúc sai → malformed", () => {
    expect(verifyEntitlement(null, verifyOpts())).toMatchObject({ ok: false, reason: "malformed" });
    expect(verifyEntitlement({ payload: {} }, verifyOpts())).toMatchObject({ ok: false, reason: "malformed" });
    expect(verifyEntitlement({ payload: {}, signature: { alg: "RS256", keyId: "x", sig: "y" } }, verifyOpts())).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("route /v1/keys trả khoá công khai khớp khoá đang ký", async () => {
    const res = await keysGET(get("/v1/keys"));
    const body = (await res.json()) as { keys: { keyId: string; alg: string; publicKey: string }[] };
    expect(body.keys[0]).toMatchObject({ alg: "Ed25519", keyId: trustedKeys()[0].keyId });
    const b = await fetchBundle(await login("nv.nhansu@nexlab.tech"));
    expect(verifyEntitlement(b, { trustedKeys: body.keys }).ok).toBe(true);
  });
});

describe("thu hồi", () => {
  it("không có / sai token → 401", async () => {
    expect((await entitlementsGET(get("/v1/entitlements"))).status).toBe(401);
    expect((await entitlementsGET(get("/v1/entitlements", "nxh_khong-co-that"))).status).toBe(401);
  });

  it("đăng xuất (revoke) làm token hết dùng", async () => {
    const token = await login("nv.ketoan@nexlab.tech");
    expect((await entitlementsGET(get("/v1/entitlements", token))).status).toBe(200);
    expect((await revokePOST(post("/v1/auth/revoke", {}, { authorization: `Bearer ${token}` }))).status).toBe(200);
    expect((await entitlementsGET(get("/v1/entitlements", token))).status).toBe(401);
  });

  it("vô hiệu hoá người dùng → token Hub chết ngay", async () => {
    const admin = await actorOf("admin@nexlab.tech");
    const uid = await userId("nv.kinhdoanh@nexlab.tech");
    const token = await login("nv.kinhdoanh@nexlab.tech");
    expect((await entitlementsGET(get("/v1/entitlements", token))).status).toBe(200);
    const base = { name: "Đặng Khánh Linh", hubRole: "member", adminRole: "none", deptIds: [await deptId("Kinh doanh")] };
    await updateUser(admin, uid, { ...base, status: "disabled" });
    expect((await entitlementsGET(get("/v1/entitlements", token))).status).toBe(401);
    await updateUser(admin, uid, { ...base, status: "active" });
  });

  it("thu hồi thiết bị → token của thiết bị đó bị 403 và không cấp token mới", async () => {
    const uid = await userId("nv.nhansu@nexlab.tech");
    const token = await login("nv.nhansu@nexlab.tech", DEVICE2);
    expect((await entitlementsGET(get("/v1/entitlements", token))).status).toBe(200);
    await (await db()).q("UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND id = $2", [uid, DEVICE2]);
    expect((await entitlementsGET(get("/v1/entitlements", token))).status).toBe(403);
    await expect(issueHubToken({ email: "nv.nhansu@nexlab.tech", password: DEV_PASSWORD, deviceId: DEVICE2 })).rejects.toMatchObject({ code: "forbidden" });
    // thiết bị khác của cùng người vẫn dùng được
    expect((await entitlementsGET(get("/v1/entitlements", await login("nv.nhansu@nexlab.tech", DEVICE)))).status).toBe(200);
  });

  it("tenant tạm ngưng → token Hub của cả tenant chết", async () => {
    const token = await login("bacsi@benhvien-b.test");
    expect((await entitlementsGET(get("/v1/entitlements", token))).status).toBe(200);
    await (await db()).q("UPDATE tenants SET status = 'suspended' WHERE slug = 'benhvien-b'");
    expect((await entitlementsGET(get("/v1/entitlements", token))).status).toBe(401);
    await (await db()).q("UPDATE tenants SET status = 'active' WHERE slug = 'benhvien-b'");
  });
});
