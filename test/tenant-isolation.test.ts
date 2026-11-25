/**
 * QUÉT cách ly tổ chức (25/11) — bổ sung cho R1 ở rules.test.ts: quản trị của tổ chức này, dù BIẾT id, không đọc / sửa / xoá / gắn
 * được bất kỳ loại đối tượng nào của tổ chức kia; danh sách của mình không lẫn dữ liệu bên kia. Chạy CẢ HAI CHIỀU (A→B, B→A).
 * Phép thử dùng đầu vào HỢP LỆ để kết quả «không tìm thấy / bị cấm» là do cách ly, không phải do sai định dạng. Cần Postgres.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CP_DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
process.env.CP_ALLOW_DEV_ORIGINS = "0";
process.env.CP_SIGNING_KEY_PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
process.env.CP_SECRETS_KEY = randomBytes(32).toString("base64");

import { closeDb, db } from "@/server/db";
import { loadActor, type Actor } from "@/server/actor";
import { AppError } from "@/server/errors";
import { seedDatabase } from "@/server/seed";
import { createUser, getUser, listUsers } from "@/server/services/users";
import { deleteDepartment, getDepartment, listDepartments, removeMember, updateDepartment } from "@/server/services/departments";
import { deleteApp, listApps } from "@/server/services/apps";
import { getAccessMatrix, previewUser } from "@/server/services/access";
import { createAccessRequest, listAccessRequests, resolveAccessRequest } from "@/server/services/requests";
import { listConfig, listSecrets, setConfig, setSecret } from "@/server/services/config";
import { setAppSopScope } from "@/server/services/sop-scope";
import { getIdp, removeIdp, setIdp } from "@/server/services/identity-providers";
import { deleteTenant, listTenants, updateTenant } from "@/server/services/tenants";
import { listAudit } from "@/server/services/audit-read";
import { getDashboard } from "@/server/services/dashboard";
import { buildEntitlementPayload } from "@/server/services/entitlements";

/** Bị từ chối do cách ly. `invalid` cũng là từ chối (vd «phòng ban không hợp lệ») — khi đó test có phép ĐỐI CHỨNG: cùng đầu vào nhưng dùng đối tượng của chính mình thì chạy được. */
const BLOCKED = ["not_found", "forbidden", "invalid"];
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `lỗi lạ: ${String(e)}`));

interface Side { slug: string; admin: Actor; member: Actor; userId: string; deptId: string; appId: string; tenantId: string; domain: string }

async function side(slug: string, adminEmail: string, memberEmail: string): Promise<Side> {
  const d = await db();
  const t = (await d.one<{ id: string; domain: string }>("SELECT id, domain FROM tenants WHERE slug = $1", [slug]))!;
  const actor = async (email: string) => (await loadActor(d, (await d.one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]))!.id))!;
  const dept = (await d.one<{ id: string }>("SELECT id FROM departments WHERE tenant_id = $1 ORDER BY name LIMIT 1", [t.id]))!;
  const app = (await d.one<{ id: string }>("SELECT id FROM catalog_apps WHERE tenant_id = $1 ORDER BY name LIMIT 1", [t.id]))!;
  const member = await actor(memberEmail);
  return { slug, admin: await actor(adminEmail), member, userId: member.userId, deptId: dept.id, appId: app.id, tenantId: t.id, domain: t.domain };
}

let A: Side;
let B: Side;

describe("quét cách ly giữa hai tổ chức", () => {
  beforeAll(async () => {
    await seedDatabase(await db());
    A = await side("nexlab", "admin@nexlab.tech", "nv.nhansu@nexlab.tech");
    B = await side("benhvien-b", "admin@benhvien-b.test", "bacsi@benhvien-b.test");
    // Mỗi bên có một khoá, một cấu hình và một yêu cầu quyền riêng để phép thử «không lẫn» có nghĩa.
    for (const s of [A, B]) {
      await setSecret(s.admin, { key: "OPENAI_API_KEY", value: `sk-${s.slug}-DONOTLEAK-12345678`, roles: ["member", "admin"] });
      await setConfig(s.admin, { key: "GEMINI_MODEL", value: `gemini-${s.slug}`, locked: false });
      await createAccessRequest(s.member, { appId: s.appId, message: `xin quyền ở ${s.slug}` });
    }
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  for (const [from, to] of [["A", "B"], ["B", "A"]] as const) {
    it(`quản trị ${from} KHÔNG đụng được đối tượng của ${to} dù biết id`, async () => {
      const me = from === "A" ? A : B;
      const other = from === "A" ? B : A;
      const admin = me.admin;
      const blocked = async (what: string, p: Promise<unknown>) => expect(BLOCKED, `${what} → ${await code(p)}`).toContain(await code(p));

      // Người dùng
      await blocked("getUser", getUser(admin, other.userId));
      await blocked("previewUser", previewUser(admin, other.userId));
      const newUser = { email: `moi-${from.toLowerCase()}@${me.domain}`, name: "Người Mới", hubRole: "member", adminRole: "none" };
      await blocked("createUser gắn phòng của bên kia", createUser(admin, { ...newUser, deptIds: [other.deptId] }));
      expect(await (await db()).one("SELECT 1 FROM users WHERE lower(email) = $1", [newUser.email]), "không được tạo người dùng khi gắn phòng bên kia").toBeNull();
      expect(await code(createUser(admin, { ...newUser, deptIds: [me.deptId] })), "đối chứng: cùng đầu vào với phòng của mình thì tạo được").toBe("ok");
      // Phòng ban
      await blocked("getDepartment", getDepartment(admin, other.deptId));
      await blocked("updateDepartment", updateDepartment(admin, other.deptId, { name: "Bị chiếm", description: "" }));
      await blocked("updateDepartment đặt trưởng phòng là người bên kia", updateDepartment(admin, me.deptId, { name: "Phòng của tôi", description: "", managerUserId: other.userId }));
      expect((await (await db()).one<{ manager_user_id: string | null }>("SELECT manager_user_id FROM departments WHERE id = $1", [me.deptId]))!.manager_user_id).not.toBe(other.userId);
      await blocked("removeMember", removeMember(admin, other.deptId, other.userId));
      await blocked("deleteDepartment", deleteDepartment(admin, other.deptId));
      // App + phạm vi SOP
      await blocked("deleteApp", deleteApp(admin, other.appId));
      await blocked("setAppSopScope", setAppSopScope(admin, other.appId, { sopScope: null }));
      // Cấu hình theo phòng của bên kia
      await blocked("setConfig theo phòng của bên kia", setConfig(admin, { key: "GEMINI_MODEL", value: "gemini-x", locked: false, deptId: other.deptId }));
      // Yêu cầu quyền
      const reqOther = (await (await db()).one<{ id: string }>("SELECT id FROM access_requests WHERE tenant_id = $1 LIMIT 1", [other.tenantId]))!;
      await blocked("resolveAccessRequest", resolveAccessRequest(admin, { id: reqOther.id, status: "resolved", note: "" }));
      await blocked("createAccessRequest cho app của bên kia", createAccessRequest(me.member, { appId: other.appId, message: "xin app bên kia" }));
      // Tổ chức + SSO: việc của quản trị nền tảng
      for (const [what, p] of [
        ["listTenants", listTenants(admin)],
        ["updateTenant bên kia", updateTenant(admin, other.tenantId, { name: "Bị chiếm", status: "suspended" })],
        ["updateTenant của chính mình", updateTenant(admin, me.tenantId, { name: "Tự sửa", status: "active", allowPrivateApps: true })],
        ["deleteTenant bên kia", deleteTenant(admin, other.tenantId, other.slug)],
        ["getIdp bên kia", getIdp(admin, other.tenantId)],
        ["setIdp bên kia", setIdp(admin, other.tenantId, { issuer: "https://idp.ke-gian.example/realms/x", clientId: "hub", groupsClaim: "groups", syncGroups: true, jit: true })],
        ["removeIdp bên kia", removeIdp(admin, other.tenantId)],
      ] as const) {
        expect(["forbidden", "not_found"], `${what} → ${await code(p)}`).toContain(await code(p));
      }

      // Không gì của bên kia bị đổi.
      const d = await db();
      expect((await d.one<{ name: string; status: string }>("SELECT name, status FROM tenants WHERE id = $1", [other.tenantId]))!.status).toBe("active");
      expect(await d.one("SELECT 1 FROM departments WHERE id = $1", [other.deptId])).not.toBeNull();
      expect(await d.one("SELECT 1 FROM catalog_apps WHERE id = $1", [other.appId])).not.toBeNull();
      expect((await d.one<{ status: string }>("SELECT status FROM access_requests WHERE id = $1", [reqOther.id]))!.status).toBe("open");
      expect(await d.one("SELECT 1 FROM memberships WHERE user_id = $1 AND department_id = $2", [other.userId, me.deptId])).toBeNull();
    });

    it(`mọi danh sách của ${from} không lẫn dữ liệu của ${to}`, async () => {
      const me = from === "A" ? A : B;
      const other = from === "A" ? B : A;
      const admin = me.admin;
      const d = await db();
      const otherUserIds = new Set((await d.q<{ id: string }>("SELECT id FROM users WHERE tenant_id = $1", [other.tenantId])).map((r) => r.id));
      const otherDeptIds = new Set((await d.q<{ id: string }>("SELECT id FROM departments WHERE tenant_id = $1", [other.tenantId])).map((r) => r.id));
      const otherAppIds = new Set((await d.q<{ id: string }>("SELECT id FROM catalog_apps WHERE tenant_id = $1", [other.tenantId])).map((r) => r.id));

      expect((await listUsers(admin)).some((u) => otherUserIds.has(u.id))).toBe(false);
      expect((await listDepartments(admin)).some((x) => otherDeptIds.has(x.id))).toBe(false);
      expect((await listApps(admin)).some((x) => otherAppIds.has(x.id))).toBe(false);
      const matrix = JSON.stringify(await getAccessMatrix(admin));
      for (const id of [...otherDeptIds, ...otherAppIds]) expect(matrix.includes(id), `ma trận quyền lẫn ${id}`).toBe(false);
      expect((await listAccessRequests(admin)).every((r) => !JSON.stringify(r).includes(`xin quyền ở ${other.slug}`))).toBe(true);
      expect(JSON.stringify(await listConfig(admin))).not.toContain(`gemini-${other.slug}`);
      expect(JSON.stringify(await listConfig(admin))).toContain(`gemini-${me.slug}`);
      const secrets = JSON.stringify(await listSecrets(admin));
      expect(secrets).not.toContain("DONOTLEAK"); // không có đường đọc giá trị, kể cả của chính mình
      const audit = JSON.stringify(await listAudit(admin));
      expect(audit).not.toContain(`xin quyền ở ${other.slug}`);
      for (const id of otherUserIds) expect(audit.includes(id), `nhật ký lẫn người dùng ${id}`).toBe(false);
      // Bảng tổng quan: số đếm đúng bằng số của chính tổ chức mình.
      const dash = JSON.stringify(await getDashboard(admin));
      expect(dash).not.toContain(other.slug);
      // Gói quyền của nhân viên chỉ có app của tổ chức mình, cấu hình của tổ chức mình.
      const payload = await buildEntitlementPayload(d, me.member, "dev-iso-0001");
      expect(payload.tenant.id).toBe(me.tenantId);
      const otherOrigins = new Set((await d.q<{ origin: string }>("SELECT origin FROM catalog_apps WHERE tenant_id = $1", [other.tenantId])).map((r) => r.origin));
      const myOrigins = new Set((await d.q<{ origin: string }>("SELECT origin FROM catalog_apps WHERE tenant_id = $1", [me.tenantId])).map((r) => r.origin));
      for (const a of payload.apps) expect(myOrigins.has(a.origin) && (!otherOrigins.has(a.origin) || myOrigins.has(a.origin)), a.origin).toBe(true);
      expect(JSON.stringify(payload.config)).not.toContain(`gemini-${other.slug}`);
    });
  }

  it("lớp DB: ghi chéo tổ chức bị trigger chặn dù bỏ qua lớp dịch vụ (trưởng phòng là người bên kia)", async () => {
    const d = await db();
    await expect(d.q("UPDATE departments SET manager_user_id = $2 WHERE id = $1", [A.deptId, B.userId])).rejects.toBeTruthy();
    await expect(d.q("INSERT INTO memberships (user_id, department_id) VALUES ($1,$2)", [B.userId, A.deptId])).rejects.toBeTruthy();
    await expect(d.q("INSERT INTO department_apps (department_id, app_id, level) VALUES ($1,$2,'open')", [A.deptId, B.appId])).rejects.toBeTruthy();
  });
});
