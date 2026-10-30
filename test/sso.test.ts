/**
 * Test đăng nhập SSO (OIDC) với IdP GIẢ tự dựng trong test (không cần Keycloak): mọi trường hợp lỗi của token,
 * liên kết người dùng, JIT, đồng bộ nhóm → phòng ban, thu hồi. Cần Postgres.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";

process.env.CP_DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
process.env.CP_SIGNING_KEY_PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;

import { closeDb, db } from "@/server/db";
import { loadActor } from "@/server/actor";
import { DEV_PASSWORD, seedDatabase } from "@/server/seed";
import { trustedKeys } from "@/server/signer";
import { normalizeIssuer, resetOidcCaches, verifyOidcAccessToken } from "@/server/oidc";
import { discover, issueHubToken, resolveHubToken } from "@/server/services/entitlements";
import { updateUser } from "@/server/services/users";
import { updateDepartment } from "@/server/services/departments";
import { verifyEntitlement, type SignedEntitlement } from "@/lib/entitlement";
import { GET as entitlementsGET } from "@/app/v1/entitlements/route";
import { POST as tokenPOST } from "@/app/v1/auth/token/route";

const CLIENT = "nexlab-hub";
const DEVICE = "sso-device-0001";

interface Realm { name: string; kid: string; privateKey: CryptoKey; jwk: JWK; wrongDiscoveryIssuer?: boolean; foreignJwksUri?: boolean }
const realms: Record<string, Realm> = {};
let server: Server;
let base = "";
const issuerOf = (r: string) => `${base}/realms/${r}`;

async function makeRealm(name: string, extra: Partial<Realm> = {}): Promise<Realm> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: `${name}-key-1`, alg: "RS256", use: "sig" };
  return { name, kid: jwk.kid!, privateKey, jwk, ...extra };
}

interface MintOpts {
  realm?: string; signWith?: Realm; sub?: string; email?: string | null; emailVerified?: boolean; name?: string; groups?: string[] | null;
  azp?: string; aud?: string | string[]; expiresIn?: string; iss?: string; alg?: string;
}
async function mint(o: MintOpts = {}): Promise<string> {
  const realm = realms[o.realm ?? "nexlab"];
  const signer = o.signWith ?? realm;
  const claims: Record<string, unknown> = { azp: o.azp ?? CLIENT, email_verified: o.emailVerified ?? true, name: o.name ?? "Người Thử" };
  if (o.email !== null) claims.email = o.email ?? "nv.nhansu@nexlab.tech";
  if (o.groups !== null) claims.groups = o.groups ?? [];
  if (o.aud) claims.aud = o.aud;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: signer.kid, typ: "JWT" })
    .setIssuer(o.iss ?? issuerOf(realm.name))
    .setSubject(o.sub ?? "sub-nhansu-1")
    .setIssuedAt()
    .setExpirationTime(o.expiresIn ?? "5m")
    .sign(signer.privateKey);
}

const fakeIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const call = (token: string | null, device: string | null = DEVICE) => {
  const headers: Record<string, string> = { "x-forwarded-for": fakeIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) headers["x-device-id"] = device;
  return entitlementsGET(new Request("http://cp.test/v1/entitlements", { headers }));
};
const bundleOf = async (res: Response) => (await res.json()) as SignedEntitlement;
const verify = (b: SignedEntitlement) => verifyEntitlement(b, { trustedKeys: trustedKeys() });
const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db()).q<T>(sql, params);
const userIdOf = async (email: string) => (await (await db()).one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]))!.id;
const deptId = async (name: string) => (await (await db()).one<{ id: string }>("SELECT d.id FROM departments d JOIN tenants t ON t.id = d.tenant_id WHERE t.slug = 'nexlab' AND d.name = $1", [name]))!.id;
const memberships = async (email: string) =>
  q<{ name: string; source: string }>("SELECT d.name, m.source FROM memberships m JOIN departments d ON d.id = m.department_id JOIN users u ON u.id = m.user_id WHERE lower(u.email) = lower($1) ORDER BY d.name", [email]);
const auditActions = async () => (await q<{ action: string }>("SELECT action FROM audit_log ORDER BY id")).map((r) => r.action);

beforeAll(async () => {
  realms.nexlab = await makeRealm("nexlab");
  realms["benhvien-b"] = await makeRealm("benhvien-b");
  realms.attacker = await makeRealm("attacker");
  realms.baddisco = await makeRealm("baddisco", { wrongDiscoveryIssuer: true });
  realms.foreignjwks = await makeRealm("foreignjwks", { foreignJwksUri: true });

  server = createServer((req, res) => {
    const m = /^\/realms\/([^/]+)\/(.*)$/.exec(req.url ?? "");
    const realm = m ? realms[m[1]] : undefined;
    if (!realm) { res.writeHead(404).end(); return; }
    res.setHeader("content-type", "application/json");
    if (m![2] === ".well-known/openid-configuration")
      res.end(JSON.stringify({ issuer: realm.wrongDiscoveryIssuer ? "https://evil.example.com/realms/x" : issuerOf(realm.name), jwks_uri: realm.foreignJwksUri ? "https://evil.example.com/keys" : `${issuerOf(realm.name)}/protocol/openid-connect/certs` }));
    else if (m![2] === "protocol/openid-connect/certs") res.end(JSON.stringify({ keys: [realm.jwk] }));
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db();
  await seedDatabase(await db());
  const d = await db();
  await d.q("INSERT INTO identity_providers (tenant_id, issuer, client_id, sync_groups, jit_provisioning) SELECT id, $1, $2, true, true FROM tenants WHERE slug = 'nexlab'", [issuerOf("nexlab"), CLIENT]);
  await d.q("INSERT INTO identity_providers (tenant_id, issuer, client_id, sync_groups, jit_provisioning) SELECT id, $1, $2, true, false FROM tenants WHERE slug = 'benhvien-b'", [issuerOf("benhvien-b"), CLIENT]);
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDb(true);
});

describe("cấu hình & ép SSO", () => {
  it("discover trả cách đăng nhập OIDC (issuer, clientId) cho tenant có IdP", async () => {
    const r = await discover({ email: "ai.do@nexlab.tech" });
    expect(r.auth).toMatchObject({ method: "oidc", issuer: issuerOf("nexlab"), clientId: CLIENT, deviceHeader: "X-Device-Id" });
    expect(r.auth).not.toHaveProperty("tokenEndpoint");
  });

  it("tenant có IdP: không cấp token mật khẩu; token cục bộ cũ cũng hết hiệu lực", async () => {
    const res = await tokenPOST(new Request("http://cp.test/v1/auth/token", { method: "POST", headers: { "x-forwarded-for": fakeIp() }, body: JSON.stringify({ email: "nv.nhansu@nexlab.tech", password: DEV_PASSWORD, deviceId: DEVICE }) }));
    expect(res.status).toBe(403);
    // token cục bộ phát hành trước khi bật SSO
    const d = await db();
    await d.q("DELETE FROM identity_providers WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'nexlab')");
    const t = await issueHubToken({ email: "nv.nhansu@nexlab.tech", password: DEV_PASSWORD, deviceId: DEVICE });
    await d.q("INSERT INTO identity_providers (tenant_id, issuer, client_id, sync_groups, jit_provisioning) SELECT id, $1, $2, true, true FROM tenants WHERE slug = 'nexlab'", [issuerOf("nexlab"), CLIENT]);
    await expect(resolveHubToken(t.accessToken)).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("production mặc định tắt token mật khẩu cục bộ", async () => {
    const old = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      await expect(issueHubToken({ email: "nv.ketoan@nexlab.tech", password: DEV_PASSWORD, deviceId: DEVICE })).rejects.toMatchObject({ code: "forbidden" });
      expect((await discover({ email: "x@khong-co-idp.vn" })).found).toBe(false);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = old!;
    }
  });

  it("normalizeIssuer: chỉ https (http chỉ localhost ở chế độ lab), không user/query, bỏ dấu / cuối", () => {
    expect(normalizeIssuer("https://idp.congty.vn/realms/a/")).toEqual({ ok: true, issuer: "https://idp.congty.vn/realms/a" });
    expect(normalizeIssuer("http://idp.congty.vn")).toMatchObject({ ok: false });
    expect(normalizeIssuer("http://localhost:8081/realms/a")).toMatchObject({ ok: false });
    expect(normalizeIssuer("http://localhost:8081/realms/a", { allowDev: true })).toEqual({ ok: true, issuer: "http://localhost:8081/realms/a" });
    expect(normalizeIssuer("https://u:p@idp.vn")).toMatchObject({ ok: false });
    expect(normalizeIssuer("https://idp.vn/?x=1")).toMatchObject({ ok: false });
    expect(normalizeIssuer("ftp://idp.vn")).toMatchObject({ ok: false });
  });
});

describe("kiểm token", () => {
  it("token hợp lệ của người đã có tài khoản → gói quyền ký, gắn đúng người + thiết bị", async () => {
    const res = await call(await mint({ sub: "sub-nhansu-1", email: "nv.nhansu@nexlab.tech", groups: ["nhan-su"] }));
    expect(res.status).toBe(200);
    const b = await bundleOf(res);
    expect(verify(b).ok).toBe(true);
    expect(b.payload.audience).toEqual({ userId: await userIdOf("nv.nhansu@nexlab.tech"), deviceId: DEVICE });
    expect(b.payload.apps.map((a) => a.origin).sort()).toEqual(["nexlab-app://hr", "nexlab-app://timesheet"]);
    expect(await auditActions()).toContain("user.sso_link");
  });

  it("lần sau nhận diện theo (issuer, sub) — đổi email ở IdP vẫn vào đúng tài khoản", async () => {
    const res = await call(await mint({ sub: "sub-nhansu-1", email: "email.moi.khac@nexlab.tech", groups: ["nhan-su"] }));
    expect(res.status).toBe(200);
    expect((await bundleOf(res)).payload.subject.email).toBe("nv.nhansu@nexlab.tech");
  });

  it("từ chối: chữ ký của khoá khác / khoá kẻ tấn công", async () => {
    expect((await call(await mint({ signWith: realms.attacker }))).status).toBe(401);
    expect((await call(await mint({ realm: "nexlab", signWith: realms["benhvien-b"] }))).status).toBe(401); // khoá của tenant khác
  });

  it("từ chối: issuer lạ, token hết hạn, sai client (azp), thuật toán HS256 giả mạo, rác", async () => {
    expect((await call(await mint({ iss: "https://evil.example.com/realms/nexlab" }))).status).toBe(401);
    expect((await call(await mint({ expiresIn: "-2m" }))).status).toBe(401);
    expect((await call(await mint({ azp: "app-khac" }))).status).toBe(401);
    const hs = await new SignJWT({ azp: CLIENT, email: "nv.nhansu@nexlab.tech", email_verified: true })
      .setProtectedHeader({ alg: "HS256", kid: realms.nexlab.kid }).setIssuer(issuerOf("nexlab")).setSubject("sub-nhansu-1").setExpirationTime("5m").sign(new TextEncoder().encode("khoa-bi-mat-bat-ky-0123456789abcdef"));
    expect((await call(hs)).status).toBe(401);
    expect((await call("khong.phai.jwt")).status).toBe(401);
    expect((await call(null)).status).toBe(401);
  });

  it("chấp nhận khi client nằm trong aud (IdP không có azp)", async () => {
    const res = await call(await mint({ azp: "khac", aud: [CLIENT, "account"], sub: "sub-nhansu-1" }));
    expect(res.status).toBe(200);
  });

  it("header X-Device-Id: thiếu / sai → 400; thiết bị bị thu hồi → 403", async () => {
    const token = await mint({ sub: "sub-nhansu-1" });
    expect((await call(token, null)).status).toBe(400);
    expect((await call(token, "ngan")).status).toBe(400);
    const uid = await userIdOf("nv.nhansu@nexlab.tech");
    await call(token, "sso-device-0099");
    await (await db()).q("UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND id = 'sso-device-0099'", [uid]);
    expect((await call(token, "sso-device-0099")).status).toBe(403);
    expect((await call(token, DEVICE)).status).toBe(200);
  });

  it("discovery sai: issuer tự khai khác cấu hình / jwks_uri khác origin → 503, không tin", async () => {
    resetOidcCaches();
    await expect(verifyOidcAccessToken(await mint({ realm: "baddisco" }), { issuer: issuerOf("baddisco"), clientId: CLIENT, groupsClaim: "groups" })).rejects.toMatchObject({ code: "unavailable" });
    await expect(verifyOidcAccessToken(await mint({ realm: "foreignjwks" }), { issuer: issuerOf("foreignjwks"), clientId: CLIENT, groupsClaim: "groups" })).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("liên kết tài khoản", () => {
  it("email chưa xác minh → không được liên kết vào tài khoản có sẵn", async () => {
    expect((await call(await mint({ sub: "sub-ketoan-1", email: "nv.ketoan@nexlab.tech", emailVerified: false }))).status).toBe(401);
    expect((await q("SELECT 1 FROM users WHERE lower(email) = 'nv.ketoan@nexlab.tech' AND idp_sub IS NOT NULL")).length).toBe(0);
  });

  it("tài khoản đã liên kết với danh tính khác → từ chối (chống chiếm tài khoản bằng email trùng)", async () => {
    expect((await call(await mint({ sub: "sub-ke-toan-gia-mao", email: "nv.nhansu@nexlab.tech" }))).status).toBe(403);
  });

  it("email của tenant khác không liên kết được qua IdP này", async () => {
    expect((await call(await mint({ sub: "sub-x", email: "bacsi@benhvien-b.test" }))).status).toBe(403);
  });

  it("tenant tắt JIT: người chưa có tài khoản → 403; tenant bật JIT nhưng sai tên miền → 403", async () => {
    expect((await call(await mint({ realm: "benhvien-b", sub: "sub-bv-moi", email: "nguoi.la@benhvien-b.test" }))).status).toBe(403);
    expect((await call(await mint({ sub: "sub-ngoai", email: "ai.do@gmail.com" }))).status).toBe(403);
    expect((await q("SELECT 1 FROM users WHERE lower(email) IN ('nguoi.la@benhvien-b.test','ai.do@gmail.com')")).length).toBe(0);
  });

  it("realm này không dùng được cho người của tenant kia (token đúng chữ ký nhưng email thuộc tenant khác)", async () => {
    expect((await call(await mint({ realm: "benhvien-b", sub: "sub-bs-1", email: "bacsi@benhvien-b.test", groups: ["khoa-noi"] }))).status).toBe(200);
    expect((await call(await mint({ realm: "benhvien-b", sub: "sub-chéo", email: "nv.ketoan@nexlab.tech" }))).status).toBe(403);
  });
});

describe("JIT — nhân viên mới", () => {
  it("lần đầu đăng nhập: tự tạo tài khoản nhân viên (không quyền quản trị), xếp phòng theo nhóm, có app", async () => {
    const res = await call(await mint({ sub: "sub-moi-1", email: "moi@nexlab.tech", name: "Nhân Viên Mới", groups: ["kinh-doanh"] }));
    expect(res.status).toBe(200);
    const b = await bundleOf(res);
    expect(b.payload.subject).toMatchObject({ email: "moi@nexlab.tech", label: "Nhân Viên Mới", hubRole: "member" });
    expect(b.payload.subject.departments.map((x) => x.name)).toEqual(["Kinh doanh"]);
    expect(b.payload.apps.map((a) => a.origin)).toContain("https://demo.us.espocrm.com");
    const row = (await q<{ admin_role: string; password_hash: string; seeded: boolean }>("SELECT admin_role, password_hash, seeded FROM users WHERE email = 'moi@nexlab.tech'"))[0];
    expect(row.admin_role).toBe("none");
    expect(row.password_hash).toBe("!sso-only"); // không đăng nhập bằng mật khẩu được
    expect(await memberships("moi@nexlab.tech")).toEqual([{ name: "Kinh doanh", source: "idp" }]);
    expect(await auditActions()).toEqual(expect.arrayContaining(["user.sso_create", "membership.sso_sync"]));
  });

  it("người tạo qua JIT không đăng nhập được bằng mật khẩu (kể cả đoán)", async () => {
    const { authenticate } = await import("@/server/auth");
    await expect(authenticate("moi@nexlab.tech", "!sso-only")).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("đồng bộ nhóm IdP → phòng ban", () => {
  it("IdP bỏ người khỏi nhóm → mất phòng đó và app; policy_version tăng", async () => {
    const before = (await (await db()).one<{ policy_version: number }>("SELECT policy_version FROM tenants WHERE slug = 'nexlab'"))!.policy_version;
    const res = await call(await mint({ sub: "sub-moi-1", email: "moi@nexlab.tech", groups: [] }));
    const b = await bundleOf(res);
    expect(b.payload.subject.departments).toEqual([]);
    expect(b.payload.apps).toEqual([]);
    expect(b.payload.policyVersion).toBeGreaterThan(before);
    expect(await memberships("moi@nexlab.tech")).toEqual([]);
  });

  it("thiếu hẳn claim nhóm = không thuộc nhóm nào (thu hẹp, không mở rộng)", async () => {
    await call(await mint({ sub: "sub-moi-1", email: "moi@nexlab.tech", groups: ["kinh-doanh", "cntt"] }));
    expect((await memberships("moi@nexlab.tech")).map((m) => m.name)).toEqual(["Công nghệ thông tin", "Kinh doanh"]);
    await call(await mint({ sub: "sub-moi-1", email: "moi@nexlab.tech", groups: null }));
    expect(await memberships("moi@nexlab.tech")).toEqual([]);
  });

  it("thành viên do quản trị thêm tay (manual) KHÔNG bị IdP gỡ; nhóm lạ bị bỏ qua", async () => {
    const before = await memberships("kiemnhiem@nexlab.tech");
    expect(before.every((m) => m.source === "manual")).toBe(true);
    const res = await call(await mint({ sub: "sub-kiemnhiem", email: "kiemnhiem@nexlab.tech", groups: ["nhom-khong-ton-tai"] }));
    expect(res.status).toBe(200);
    expect(await memberships("kiemnhiem@nexlab.tech")).toEqual(before);
  });

  it("trưởng phòng bị IdP bỏ khỏi nhóm thì mất chức trưởng phòng", async () => {
    const admin = (await loadActor(await db(), await userIdOf("admin@nexlab.tech")))!;
    await call(await mint({ sub: "sub-moi-1", email: "moi@nexlab.tech", groups: ["ke-toan"] })); // vào Kế toán qua IdP
    const acc = await deptId("Kế toán");
    await updateDepartment(admin, acc, { name: "Kế toán", description: "Thu chi", managerUserId: await userIdOf("moi@nexlab.tech") });
    expect((await (await db()).one<{ manager_user_id: string }>("SELECT manager_user_id FROM departments WHERE id = $1", [acc]))!.manager_user_id).toBe(await userIdOf("moi@nexlab.tech"));
    await call(await mint({ sub: "sub-moi-1", email: "moi@nexlab.tech", groups: [] }));
    expect((await (await db()).one<{ manager_user_id: string | null }>("SELECT manager_user_id FROM departments WHERE id = $1", [acc]))!.manager_user_id).toBeNull();
    expect(await auditActions()).toContain("department.manager_cleared");
  });

  it("tên nhóm so khớp không phân biệt hoa thường; có tiền tố / như Keycloak vẫn nhận", async () => {
    await call(await mint({ sub: "sub-moi-1", email: "moi@nexlab.tech", groups: ["/Kinh-Doanh"] }));
    expect(await memberships("moi@nexlab.tech")).toEqual([{ name: "Kinh doanh", source: "idp" }]);
  });
});

describe("thu hồi", () => {
  it("vô hiệu hoá người dùng ở Control Plane → token IdP còn hạn cũng bị từ chối ngay", async () => {
    const admin = (await loadActor(await db(), await userIdOf("admin@nexlab.tech")))!;
    const uid = await userIdOf("moi@nexlab.tech");
    const token = await mint({ sub: "sub-moi-1", email: "moi@nexlab.tech", groups: ["kinh-doanh"] });
    expect((await call(token)).status).toBe(200);
    const base = { name: "Nhân Viên Mới", hubRole: "member", adminRole: "none", deptIds: [] as string[] };
    await updateUser(admin, uid, { ...base, status: "disabled" });
    expect((await call(token)).status).toBe(401);
    await updateUser(admin, uid, { ...base, status: "active" });
    expect((await call(token)).status).toBe(200);
  });

  it("tenant tạm ngưng → token IdP bị từ chối", async () => {
    const token = await mint({ realm: "benhvien-b", sub: "sub-bs-1", email: "bacsi@benhvien-b.test", groups: ["khoa-noi"] });
    expect((await call(token)).status).toBe(200);
    await (await db()).q("UPDATE tenants SET status = 'suspended' WHERE slug = 'benhvien-b'");
    expect((await call(token)).status).toBe(401);
    await (await db()).q("UPDATE tenants SET status = 'active' WHERE slug = 'benhvien-b'");
  });

  it("bảng audit ghi các sự kiện SSO với chính người đó là tác nhân", async () => {
    const rows = await q<{ action: string; actor_email: string }>("SELECT action, actor_email FROM audit_log WHERE action LIKE 'user.sso%' OR action = 'membership.sso_sync'");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.actor_email.includes("@"))).toBe(true);
  });
});

describe("cấu hình IdP (chỉ quản trị nền tảng)", () => {
  const platformActor = async () => (await loadActor(await db(), await userIdOf("platform@nexlab.tech")))!;
  const tenantIdOf = async (slug: string) => (await (await db()).one<{ id: string }>("SELECT id FROM tenants WHERE slug = $1", [slug]))!.id;
  const input = (issuer: string, over: Record<string, unknown> = {}) => ({ issuer, clientId: CLIENT, groupsClaim: "groups", syncGroups: true, jit: false, ...over });

  it("quản trị tổ chức / trưởng phòng không khai báo được IdP", async () => {
    const { setIdp, removeIdp } = await import("@/server/services/identity-providers");
    const admin = (await loadActor(await db(), await userIdOf("admin@nexlab.tech")))!;
    expect(await setIdp(admin, await tenantIdOf("nexlab"), input(issuerOf("attacker"))).catch((e) => e.code)).toBe("forbidden");
    expect(await removeIdp(admin, await tenantIdOf("nexlab")).catch((e) => e.code)).toBe("forbidden");
  });

  it("từ chối issuer http ngoài chế độ lab, issuer không kết nối được, discovery sai", async () => {
    const { setIdp } = await import("@/server/services/identity-providers");
    const p = await platformActor();
    const bv = await tenantIdOf("benhvien-b");
    process.env.CP_ALLOW_DEV_ORIGINS = "0";
    expect(await setIdp(p, bv, input(issuerOf("attacker"))).catch((e) => e.code)).toBe("invalid"); // http://127.0.0.1 không được phép
    process.env.CP_ALLOW_DEV_ORIGINS = "1";
    expect(await setIdp(p, bv, input("http://127.0.0.1:1/realms/x")).catch((e) => e.code)).toBe("invalid"); // không kết nối được
    expect(await setIdp(p, bv, input(issuerOf("baddisco"))).catch((e) => e.code)).toBe("invalid"); // discovery khai issuer khác
    expect(await setIdp(p, bv, input(issuerOf("foreignjwks"))).catch((e) => e.code)).toBe("invalid"); // jwks_uri khác origin
  });

  it("issuer đã dùng ở tenant khác → conflict; lưu hợp lệ → có audit và policy_version tăng; gỡ được", async () => {
    const { setIdp, removeIdp, getIdp } = await import("@/server/services/identity-providers");
    process.env.CP_ALLOW_DEV_ORIGINS = "1";
    const p = await platformActor();
    const bv = await tenantIdOf("benhvien-b");
    expect(await setIdp(p, bv, input(issuerOf("nexlab"))).catch((e) => e.code)).toBe("conflict");
    const v0 = (await (await db()).one<{ policy_version: number }>("SELECT policy_version FROM tenants WHERE id = $1", [bv]))!.policy_version;
    await setIdp(p, bv, input(`${issuerOf("attacker")}/`, { jit: true })); // dấu / cuối được chuẩn hoá
    expect(await getIdp(p, bv)).toMatchObject({ issuer: issuerOf("attacker"), jit: true });
    expect((await (await db()).one<{ policy_version: number }>("SELECT policy_version FROM tenants WHERE id = $1", [bv]))!.policy_version).toBeGreaterThan(v0);
    expect(await auditActions()).toContain("tenant.idp_set");
    await removeIdp(p, bv);
    expect(await getIdp(p, bv)).toBeNull();
    expect(await auditActions()).toContain("tenant.idp_remove");
    await setIdp(p, bv, input(issuerOf("benhvien-b"))); // khôi phục
    // người của tenant khác không xem được cấu hình
    const nexAdmin = (await loadActor(await db(), await userIdOf("admin@nexlab.tech")))!;
    expect(await getIdp(nexAdmin, bv).catch((e) => e.code)).toBe("not_found");
  });
});
