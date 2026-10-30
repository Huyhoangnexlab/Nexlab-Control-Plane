/**
 * Test tích hợp với Keycloak THẬT (docker compose up -d keycloak). Tự bỏ qua nếu Keycloak không chạy.
 * Dữ liệu người dùng / nhóm lấy từ keycloak/realms/*.json (sinh từ seed-data.ts).
 */
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CP_DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
process.env.CP_SEED_IDP = "1";
process.env.CP_SIGNING_KEY_PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;

import { closeDb, db } from "@/server/db";
import { seedDatabase } from "@/server/seed";
import { DEV_PASSWORD, HUB_CLIENT_ID, issuerOf } from "@/server/seed-data";
import { trustedKeys } from "@/server/signer";
import { discover } from "@/server/services/entitlements";
import { verifyEntitlement, type SignedEntitlement } from "@/lib/entitlement";
import { GET as entitlementsGET } from "@/app/v1/entitlements/route";

const available = await fetch(`${issuerOf("nexlab")}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(2500) }).then((r) => r.ok).catch(() => false);
if (!available) console.warn("[keycloak.integration] Keycloak không chạy → bỏ qua. Bật bằng: docker compose up -d keycloak");

async function token(realm: string, email: string): Promise<string> {
  const res = await fetch(`${issuerOf(realm)}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: HUB_CLIENT_ID, username: email, password: DEV_PASSWORD, scope: "openid" }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) throw new Error(`Keycloak từ chối ${email}: ${body.error_description}`);
  return body.access_token;
}
const call = async (t: string): Promise<{ status: number; bundle: SignedEntitlement }> => {
  const res = await entitlementsGET(new Request("http://cp.test/v1/entitlements", { headers: { authorization: `Bearer ${t}`, "x-device-id": "kc-device-0001", "x-forwarded-for": `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } }));
  return { status: res.status, bundle: (await res.json()) as SignedEntitlement };
};

describe.skipIf(!available)("Keycloak thật", () => {
  beforeAll(async () => {
    await db();
    await seedDatabase(await db());
  }, 60_000);
  afterAll(async () => {
    await closeDb(true);
  });

  it("discover trả issuer Keycloak của từng tenant", async () => {
    expect((await discover({ email: "x@nexlab.tech" })).auth).toMatchObject({ method: "oidc", issuer: issuerOf("nexlab"), clientId: HUB_CLIENT_ID });
    expect((await discover({ email: "x@benhvien-b.test" })).auth).toMatchObject({ method: "oidc", issuer: issuerOf("benhvien-b") });
  });

  it("nhân viên Nhân sự: đăng nhập Keycloak → gói quyền ký đúng app của phòng", async () => {
    const { status, bundle } = await call(await token("nexlab", "nv.nhansu@nexlab.tech"));
    expect(status).toBe(200);
    expect(verifyEntitlement(bundle, { trustedKeys: trustedKeys() }).ok).toBe(true);
    expect(bundle.payload.apps.map((a) => a.origin).sort()).toEqual(["nexlab-app://hr", "nexlab-app://timesheet"]);
    expect(bundle.payload.subject.hubRole).toBe("member");
  });

  it("người thuộc hai nhóm Keycloak (kinh-doanh + cntt) được hợp quyền", async () => {
    const { bundle } = await call(await token("nexlab", "kiemnhiem@nexlab.tech"));
    expect(bundle.payload.access.effective["origin:https://demo.us.espocrm.com"]).toBe("M2");
  });

  it("người mới chỉ có ở Keycloak: tự tạo tài khoản (JIT) và vào phòng Kinh doanh theo nhóm", async () => {
    const { status, bundle } = await call(await token("nexlab", "nguoimoi@nexlab.tech"));
    expect(status).toBe(200);
    expect(bundle.payload.subject.departments.map((d) => d.name)).toEqual(["Kinh doanh"]);
    expect(bundle.payload.apps.map((a) => a.origin)).toContain("https://demo.us.espocrm.com");
    const row = await (await db()).one<{ admin_role: string; idp_sub: string }>("SELECT admin_role, idp_sub FROM users WHERE email = 'nguoimoi@nexlab.tech'");
    expect(row?.admin_role).toBe("none");
    expect(row?.idp_sub).toBeTruthy();
  });

  it("tenant bệnh viện (realm riêng): bác sĩ vào được, chỉ thấy app của tenant mình", async () => {
    const { status, bundle } = await call(await token("benhvien-b", "bacsi@benhvien-b.test"));
    expect(status).toBe(200);
    expect(bundle.payload.tenant.slug).toBe("benhvien-b");
    expect(JSON.stringify(bundle)).not.toContain("espocrm");
  });

  it("quản trị bệnh viện (không thuộc phòng nào) vào được nhưng không có app", async () => {
    const { bundle } = await call(await token("benhvien-b", "admin@benhvien-b.test"));
    expect(bundle.payload.apps).toEqual([]);
  });
});
