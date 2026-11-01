/**
 * Phạm vi SOP theo app do tổ chức đặt: ai đặt được, chỉ app được cấp, cô lập tenant, đi vào gói quyền ĐÃ KÝ cho đúng người. Cần Postgres.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CP_DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
process.env.CP_ALLOW_DEV_ORIGINS = "0";
process.env.CP_SIGNING_KEY_PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
process.env.CP_SECRETS_KEY = randomBytes(32).toString("base64");

import { closeDb, db } from "@/server/db";
import { loadActor } from "@/server/actor";
import { DEV_PASSWORD, seedDatabase } from "@/server/seed";
import { trustedKeys } from "@/server/signer";
import { setAppSopScope, sopScopeSummary } from "@/server/services/sop-scope";
import { verifyEntitlement, type SignedEntitlement } from "@/lib/entitlement";
import { POST as tokenPOST } from "@/app/v1/auth/token/route";
import { GET as entitlementsGET } from "@/app/v1/entitlements/route";
import { PUT as sopPUT } from "@/app/v1/apps/[id]/sop-scope/route";

const DEVICE = "dev-sop-0001";
const fakeIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function login(email: string): Promise<string> {
  const res = await tokenPOST(new Request("http://cp.test/v1/auth/token", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": fakeIp() }, body: JSON.stringify({ email, password: DEV_PASSWORD, deviceId: DEVICE, deviceName: "Laptop thử" }) }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}
const bundleOf = async (token: string) => (await (await entitlementsGET(new Request("http://cp.test/v1/entitlements", { headers: { authorization: `Bearer ${token}`, "x-device-id": DEVICE, "x-forwarded-for": fakeIp() } }))).json()) as SignedEntitlement;
const put = (token: string, appId: string, body: unknown) =>
  sopPUT(new Request(`http://cp.test/v1/apps/${appId}/sop-scope`, { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-device-id": DEVICE, "x-forwarded-for": fakeIp() }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: appId }) });
const id = async (sql: string, params: unknown[] = []) => (await (await db()).one<{ id: string }>(sql, params))!.id;
const appId = (name: string) => id("SELECT a.id FROM catalog_apps a JOIN tenants t ON t.id = a.tenant_id WHERE t.slug = 'nexlab' AND a.name = $1", [name]);
const actorOf = async (email: string) => (await loadActor(await db(), await id("SELECT id FROM users WHERE lower(email) = lower($1)", [email])))!;

const SCOPE = { roots: [{ id: "11111111-1111-4111-8111-111111111111", kind: "data_source", title: "Thư viện SOP Nhân sự" }], exclude: ["22222222-2222-4222-8222-222222222222"], allowedStatuses: ["Approved"] };

beforeAll(async () => {
  await seedDatabase(await db());
}, 60_000);
afterAll(async () => {
  await closeDb(true);
});

describe("Phạm vi SOP theo app", () => {
  it("member / viewer không đặt được; người soạn SOP (author) chỉ đặt cho app ĐƯỢC CẤP cho mình", async () => {
    const hr = await appId("Nhân sự (mô phỏng)");
    const crm = await appId("EspoCRM demo");
    expect((await put(await login("nv.nhansu@nexlab.tech"), hr, { sopScope: SCOPE })).status).toBe(403);
    expect((await put(await login("khach.xem@nexlab.tech"), crm, { sopScope: SCOPE })).status).toBe(403);
    const author = await login("soansop@nexlab.tech"); // phòng CNTT: chỉ có EspoCRM
    expect((await put(author, hr, { sopScope: SCOPE })).status).toBe(403); // app không được cấp
    const ok = await put(author, crm, { sopScope: SCOPE });
    expect(ok.status).toBe(200);
  });

  it("mọi nhân viên được cấp app nhận phạm vi trong gói ĐÃ KÝ; người không được cấp app thì không thấy", async () => {
    const sales = await bundleOf(await login("nv.kinhdoanh@nexlab.tech")); // Kinh doanh có EspoCRM
    expect(verifyEntitlement(sales, { trustedKeys: trustedKeys() }).ok).toBe(true);
    const crm = sales.payload.apps.find((a) => a.label === "EspoCRM demo")!;
    expect(crm.sopScope).toEqual(SCOPE);
    const hr = await bundleOf(await login("nv.nhansu@nexlab.tech")); // Nhân sự không có EspoCRM
    expect(hr.payload.apps.some((a) => a.sopScope)).toBe(false);
    expect(JSON.stringify(hr)).not.toContain("Thư viện SOP Nhân sự");
    // gói bị sửa phạm vi → chữ ký sai
    sales.payload.apps.find((a) => a.label === "EspoCRM demo")!.sopScope = { roots: [] };
    expect(verifyEntitlement(sales, { trustedKeys: trustedKeys() })).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("đặt phạm vi tăng policyVersion; dữ liệu sai dạng bị từ chối; bỏ phạm vi (null) về mặc định; có audit", async () => {
    const crm = await appId("EspoCRM demo");
    const admin = await actorOf("admin@nexlab.tech");
    const before = (await bundleOf(await login("nv.kinhdoanh@nexlab.tech"))).payload.policyVersion;
    await expect(setAppSopScope(admin, crm, { sopScope: { roots: [{ id: "", kind: "page", title: "x" }] } })).rejects.toMatchObject({ code: "invalid" });
    await expect(setAppSopScope(admin, crm, { sopScope: { roots: [{ id: "a", kind: "khac", title: "x" }] } })).rejects.toMatchObject({ code: "invalid" });
    await expect(setAppSopScope(admin, crm, { sopScope: { roots: Array.from({ length: 26 }, (_, i) => ({ id: `r${i}`, kind: "page", title: "x" })) } })).rejects.toMatchObject({ code: "invalid" });
    await expect(setAppSopScope(admin, "app_khong_co", { sopScope: null })).rejects.toMatchObject({ code: "not_found" });
    expect(await sopScopeSummary(admin)).toEqual({ [crm]: 1 });
    await setAppSopScope(admin, crm, { sopScope: { roots: [] } });
    const mid = await bundleOf(await login("nv.kinhdoanh@nexlab.tech"));
    expect(mid.payload.policyVersion).toBeGreaterThan(before);
    expect(mid.payload.apps.find((a) => a.label === "EspoCRM demo")!.sopScope).toEqual({ roots: [] });
    await setAppSopScope(admin, crm, { sopScope: null });
    expect((await bundleOf(await login("nv.kinhdoanh@nexlab.tech"))).payload.apps.find((a) => a.label === "EspoCRM demo")!.sopScope).toBeUndefined();
    const log = await (await db()).q<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'app.sop_scope%'");
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["app.sop_scope_set", "app.sop_scope_clear"]));
  });

  it("tổ chức khác không đặt / không thấy phạm vi của tổ chức này", async () => {
    const crm = await appId("EspoCRM demo");
    const other = await actorOf("admin@benhvien-b.test");
    await expect(setAppSopScope(other, crm, { sopScope: SCOPE })).rejects.toMatchObject({ code: "not_found" });
    expect(await sopScopeSummary(other)).toEqual({});
  });

  it("thiếu / sai token → 401", async () => {
    const crm = await appId("EspoCRM demo");
    const res = await sopPUT(new Request(`http://cp.test/v1/apps/${crm}/sop-scope`, { method: "PUT", headers: { "content-type": "application/json", "x-forwarded-for": fakeIp() }, body: JSON.stringify({ sopScope: null }) }), { params: Promise.resolve({ id: crm }) });
    expect(res.status).toBe(401);
  });
});
