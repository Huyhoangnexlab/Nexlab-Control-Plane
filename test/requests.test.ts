/**
 * Yêu cầu quyền từ Hub («Xin quyền»): chỉ thông báo, không cấp quyền; giới hạn số yêu cầu; ai xem / xử lý được. Cần Postgres.
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
import { listAccessRequests, resolveAccessRequest } from "@/server/services/requests";
import { POST as tokenPOST } from "@/app/v1/auth/token/route";
import { POST as requestPOST } from "@/app/v1/access-requests/route";
import { GET as catalogGET } from "@/app/v1/catalog/route";
import { GET as entitlementsGET } from "@/app/v1/entitlements/route";

const DEVICE = "dev-req-0001";
const fakeIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function login(email: string): Promise<string> {
  const res = await tokenPOST(new Request("http://cp.test/v1/auth/token", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": fakeIp() }, body: JSON.stringify({ email, password: DEV_PASSWORD, deviceId: DEVICE, deviceName: "Laptop thử" }) }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}
const post = (token: string | null, body: unknown) =>
  requestPOST(new Request("http://cp.test/v1/access-requests", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": fakeIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
const id = async (sql: string, params: unknown[] = []) => (await (await db()).one<{ id: string }>(sql, params))!.id;
const actorOf = async (email: string) => (await loadActor(await db(), await id("SELECT id FROM users WHERE lower(email) = lower($1)", [email])))!;
const appId = (name: string) => id("SELECT a.id FROM catalog_apps a JOIN tenants t ON t.id = a.tenant_id WHERE t.slug = 'nexlab' AND a.name = $1", [name]);

beforeAll(async () => {
  await seedDatabase(await db());
}, 60_000);
afterAll(async () => {
  await closeDb(true);
});

describe("Xin quyền từ Hub", () => {
  it("cần đăng nhập; catalog chỉ trả tên app đang bật, không địa chỉ", async () => {
    expect((await post(null, { message: "xin quyền với" })).status).toBe(401);
    const t = await login("nv.nhansu@nexlab.tech");
    const res = await catalogGET(new Request("http://cp.test/v1/catalog", { headers: { authorization: `Bearer ${t}`, "x-device-id": DEVICE, "x-forwarded-for": fakeIp() } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { apps: { id: string; name: string }[] };
    expect(body.apps.map((a) => a.name)).toContain("EspoCRM demo");
    expect(JSON.stringify(body)).not.toContain("espocrm.com");
  });

  it("gửi yêu cầu KHÔNG đổi quyền của ai (policyVersion và app trong gói không đổi)", async () => {
    const t = await login("nv.nhansu@nexlab.tech");
    const before = (await (await entitlementsGET(new Request("http://cp.test/v1/entitlements", { headers: { authorization: `Bearer ${t}`, "x-device-id": DEVICE, "x-forwarded-for": fakeIp() } }))).json()) as { payload: { policyVersion: number; apps: unknown[] } };
    const res = await post(t, { appId: await appId("EspoCRM demo"), message: "Cần xem khách hàng để làm báo cáo" });
    expect(res.status).toBe(201);
    const after = (await (await entitlementsGET(new Request("http://cp.test/v1/entitlements", { headers: { authorization: `Bearer ${t}`, "x-device-id": DEVICE, "x-forwarded-for": fakeIp() } }))).json()) as { payload: { policyVersion: number; apps: unknown[] } };
    expect(after.payload.policyVersion).toBe(before.payload.policyVersion);
    expect(after.payload.apps).toEqual(before.payload.apps);
  });

  it("không xin lặp cùng app đang chờ; app ngoài danh mục / lý do quá dài / rỗng bị từ chối; tối đa 5 yêu cầu chờ", async () => {
    const t = await login("nv.ketoan@nexlab.tech");
    const crm = await appId("EspoCRM demo");
    expect((await post(t, { appId: crm, message: "" })).status).toBe(201);
    expect((await post(t, { appId: crm, message: "" })).status).toBe(409);
    expect((await post(t, { appId: "app_khong_co", message: "x" })).status).toBe(404);
    expect((await post(t, { message: "x".repeat(501) })).status).toBe(400);
    expect((await post(t, { message: "" })).status).toBe(400);
    for (let i = 0; i < 4; i++) expect((await post(t, { message: `Cần quyền khác số ${i} cho công việc` })).status).toBe(201);
    expect((await post(t, { message: "Yêu cầu thứ sáu bị chặn" })).status).toBe(409);
  });

  it("ai xem được: quản trị tổ chức thấy hết; trưởng phòng chỉ thấy phòng mình; nhân viên thường không xem được", async () => {
    const admin = await listAccessRequests(await actorOf("admin@nexlab.tech"));
    expect(admin.length).toBeGreaterThanOrEqual(6);
    const hr = await listAccessRequests(await actorOf("truongphong.nhansu@nexlab.tech"));
    expect(hr.every((r) => r.userEmail === "nv.nhansu@nexlab.tech")).toBe(true);
    expect(hr.length).toBeGreaterThanOrEqual(1);
    const acc = await listAccessRequests(await actorOf("truongphong.ketoan@nexlab.tech"));
    expect(acc.every((r) => r.userEmail === "nv.ketoan@nexlab.tech")).toBe(true);
    await expect(listAccessRequests(await actorOf("nv.nhansu@nexlab.tech"))).rejects.toMatchObject({ code: "forbidden" });
  });

  it("xử lý: trưởng phòng chỉ xử lý được yêu cầu của phòng mình; chỉ một lần; ghi audit", async () => {
    const hrReq = (await listAccessRequests(await actorOf("admin@nexlab.tech"))).find((r) => r.userEmail === "nv.nhansu@nexlab.tech" && r.status === "open")!;
    const accReq = (await listAccessRequests(await actorOf("admin@nexlab.tech"))).find((r) => r.userEmail === "nv.ketoan@nexlab.tech" && r.status === "open")!;
    const hrLead = await actorOf("truongphong.nhansu@nexlab.tech");
    await expect(resolveAccessRequest(hrLead, { id: accReq.id, status: "resolved" })).rejects.toMatchObject({ code: "forbidden" });
    await resolveAccessRequest(hrLead, { id: hrReq.id, status: "resolved", note: "Đã cấp M0" });
    await expect(resolveAccessRequest(hrLead, { id: hrReq.id, status: "declined" })).rejects.toMatchObject({ code: "conflict" });
    await expect(resolveAccessRequest(await actorOf("nv.nhansu@nexlab.tech"), { id: accReq.id, status: "resolved" })).rejects.toMatchObject({ code: "forbidden" });
    await resolveAccessRequest(await actorOf("admin@nexlab.tech"), { id: accReq.id, status: "declined", note: "Không cần" });
    const log = await (await db()).q<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'request.%'");
    expect(log.filter((l) => l.action === "request.resolve").length).toBe(2);
    expect(log.some((l) => l.action === "request.create")).toBe(true);
  });

  it("người ở tổ chức khác không thấy / không xử lý được yêu cầu của tổ chức này", async () => {
    const other = await actorOf("admin@benhvien-b.test");
    expect(await listAccessRequests(other)).toEqual([]);
    const any = (await listAccessRequests(await actorOf("admin@nexlab.tech")))[0]!;
    await expect(resolveAccessRequest(other, { id: any.id, status: "resolved" })).rejects.toMatchObject({ code: "not_found" });
  });
});
