/**
 * Test luật phân quyền của Control Plane (R1–R8 trong plan). Chạy trên Postgres thật, mỗi lần chạy dùng một schema tạm.
 * Cần Postgres: `docker compose up -d` (cổng 5433) hoặc đặt DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CP_DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
process.env.CP_ALLOW_DEV_ORIGINS = "0";

import { closeDb, db, tx } from "@/server/db";
import { loadActor, type Actor } from "@/server/actor";
import { seedDatabase } from "@/server/seed";
import { AppError } from "@/server/errors";
import { authenticate, createSession, resolveSession } from "@/server/auth";
import { listTenants, createTenant, updateTenant, updateOwnTenantSettings } from "@/server/services/tenants";
import { createUser, deleteUser, listUsers, updateUser, getUser, resetPassword, changeOwnPassword } from "@/server/services/users";
import { addMember, createDepartment, listDepartments, removeMember, updateDepartment, getDepartment } from "@/server/services/departments";
import { createApp, listApps, updateApp } from "@/server/services/apps";
import { getAccessMatrix, previewUser, setDepartmentAppLevel } from "@/server/services/access";
import { listAudit } from "@/server/services/audit-read";
import { DEV_PASSWORD } from "@/server/seed";

const A = (email: string): Promise<Actor> =>
  db().then(async (d) => {
    const row = await d.one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
    const actor = await loadActor(d, row!.id);
    if (!actor) throw new Error(`không dựng được actor cho ${email}`);
    return actor;
  });

const id = async (sql: string, params: unknown[] = []) => (await (await db()).one<{ id: string }>(sql, params))!.id;
const deptId = (tenantSlug: string, name: string) => id("SELECT d.id FROM departments d JOIN tenants t ON t.id = d.tenant_id WHERE t.slug = $1 AND d.name = $2", [tenantSlug, name]);
const appId = (tenantSlug: string, name: string) => id("SELECT a.id FROM catalog_apps a JOIN tenants t ON t.id = a.tenant_id WHERE t.slug = $1 AND a.name = $2", [tenantSlug, name]);
const userId = (email: string) => id("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

beforeAll(async () => {
  await db();
  await seedDatabase(await db());
}, 60_000);
afterAll(async () => {
  await closeDb(true);
});

describe("R1 — cô lập tenant", () => {
  it("quản trị tenant A không đọc/sửa được gì của tenant B dù biết id", async () => {
    const adminA = await A("admin@nexlab.tech");
    const userB = await userId("bacsi@benhvien-b.test");
    const deptB = await deptId("benhvien-b", "Khoa Nội");
    const appB = await appId("benhvien-b", "HIS Demo");
    const appA = await appId("nexlab", "EspoCRM demo");
    const deptA = await deptId("nexlab", "Kinh doanh");
    expect(await code(getUser(adminA, userB))).toBe("not_found");
    expect(await code(updateUser(adminA, userB, { name: "x x", hubRole: "admin", adminRole: "tenant_admin", status: "active", deptIds: [] }))).toBe("not_found");
    expect(await code(deleteUser(adminA, userB))).toBe("not_found");
    expect(await code(resetPassword(adminA, userB))).toBe("not_found");
    expect(await code(setDepartmentAppLevel(adminA, deptB, appB, "M0"))).toBe("not_found");
    expect(await code(setDepartmentAppLevel(adminA, deptA, appB, "open"))).toBe("not_found"); // app của tenant khác
    expect(await code(setDepartmentAppLevel(adminA, deptB, appA, "open"))).toBe("not_found"); // phòng của tenant khác
    expect(await code(addMember(adminA, deptB, userB))).toBe("not_found");
    expect(await code(updateApp(adminA, appB, { name: "Hack", origin: "https://evil.example.com", maxLevel: "M2" }))).toBe("not_found");
    const users = await listUsers(adminA);
    expect(users.every((u) => !u.email.endsWith("benhvien-b.test"))).toBe(true);
    const audit = await listAudit(adminA);
    expect(audit.every((r) => !r.summary.includes("Bệnh viện Demo B"))).toBe(true);
  });

  it("DB chặn dữ liệu chéo tenant dù lớp dịch vụ bị bỏ qua (phòng thủ chiều sâu)", async () => {
    const deptB = await deptId("benhvien-b", "Khoa Nội");
    const appA = await appId("nexlab", "EspoCRM demo");
    const userA = await userId("nv.nhansu@nexlab.tech");
    await expect(tx((t) => t.q("INSERT INTO department_apps (department_id, app_id, level) VALUES ($1,$2,'open')", [deptB, appA]))).rejects.toBeInstanceOf(AppError);
    await expect(tx((t) => t.q("INSERT INTO memberships (user_id, department_id) VALUES ($1,$2)", [userA, deptB]))).rejects.toBeInstanceOf(AppError);
  });
});

describe("R2 — trưởng phòng chỉ chọn trong danh mục và trong trần", () => {
  it("cấp / đổi / thu hồi trong phòng của mình thì được, có audit và tăng policy_version", async () => {
    const mgr = await A("truongphong.kinhdoanh@nexlab.tech");
    const dept = await deptId("nexlab", "Kinh doanh");
    const app = await appId("nexlab", "Kế toán S3 (ví dụ)");
    const before = (await (await db()).one<{ policy_version: number }>("SELECT policy_version FROM tenants WHERE slug='nexlab'"))!.policy_version;
    await setDepartmentAppLevel(mgr, dept, app, "ask");
    await setDepartmentAppLevel(mgr, dept, app, "M1");
    await setDepartmentAppLevel(mgr, dept, app, "none");
    const after = (await (await db()).one<{ policy_version: number }>("SELECT policy_version FROM tenants WHERE slug='nexlab'"))!.policy_version;
    expect(after).toBe(before + 3);
    const log = await listAudit(mgr);
    expect(log.filter((r) => r.action === "access.set").length).toBeGreaterThanOrEqual(3);
  });

  it("mức vượt trần của app bị từ chối; mức không có trong thang bị từ chối", async () => {
    const mgr = await A("truongphong.kinhdoanh@nexlab.tech");
    const dept = await deptId("nexlab", "Kinh doanh");
    const hrApp = await appId("nexlab", "Nhân sự (mô phỏng)"); // trần M1
    expect(await code(setDepartmentAppLevel(mgr, dept, hrApp, "M2"))).toBe("invalid");
    expect(await code(setDepartmentAppLevel(mgr, dept, hrApp, "M3"))).toBe("invalid"); // M3 chưa mở
    expect(await code(setDepartmentAppLevel(mgr, dept, hrApp, "root"))).toBe("invalid");
  });

  it("trưởng phòng không sửa được phòng khác", async () => {
    const mgr = await A("truongphong.kinhdoanh@nexlab.tech");
    const hr = await deptId("nexlab", "Nhân sự");
    const app = await appId("nexlab", "Chấm công (mô phỏng)");
    expect(await code(setDepartmentAppLevel(mgr, hr, app, "none"))).toBe("forbidden");
  });

  it("hạ trần app thì kẹp mức của các phòng xuống và ghi audit", async () => {
    const admin = await A("admin@nexlab.tech");
    const crm = await appId("nexlab", "EspoCRM demo"); // Kinh doanh đang M2
    const sales = await deptId("nexlab", "Kinh doanh");
    const res = await updateApp(admin, crm, { name: "EspoCRM demo", origin: "https://demo.us.espocrm.com", maxLevel: "M0", icon: "Briefcase", color: "#f59e0b", tags: "crm", status: "active" });
    expect(res.clamped).toBeGreaterThanOrEqual(1);
    const m = await getAccessMatrix(admin);
    expect(m.cells[`${sales}:${crm}`]).toBe("M0");
    const log = await listAudit(admin, { action: "access.clamp" });
    expect(log.length).toBeGreaterThanOrEqual(1);
    // khôi phục trần để các test sau không phụ thuộc
    await updateApp(admin, crm, { name: "EspoCRM demo", origin: "https://demo.us.espocrm.com", maxLevel: "M2", icon: "Briefcase", color: "#f59e0b", tags: "crm", status: "active" });
    await setDepartmentAppLevel(admin, sales, crm, "M2");
  });
});

describe("R3 — trưởng phòng không chạm thành viên / danh mục / người dùng", () => {
  it("mọi thao tác quản trị tổ chức đều bị từ chối với trưởng phòng", async () => {
    const mgr = await A("truongphong.nhansu@nexlab.tech");
    const hr = await deptId("nexlab", "Nhân sự");
    const outsider = await userId("nv.kinhdoanh@nexlab.tech");
    expect(await code(addMember(mgr, hr, outsider))).toBe("forbidden");
    expect(await code(removeMember(mgr, hr, await userId("nv.nhansu@nexlab.tech")))).toBe("forbidden");
    expect(await code(createUser(mgr, { email: "x@nexlab.tech", name: "X Y", hubRole: "member", adminRole: "none", deptIds: [] }))).toBe("forbidden");
    expect(await code(listUsers(mgr))).toBe("forbidden");
    expect(await code(createApp(mgr, { name: "Evil", origin: "https://evil.example.com", maxLevel: "M1" }))).toBe("forbidden");
    expect(await code(createDepartment(mgr, { name: "Phòng mới" }))).toBe("forbidden");
    expect(await code(updateDepartment(mgr, hr, { name: "Nhân sự", description: "", managerUserId: outsider }))).toBe("forbidden");
    expect(await code(updateOwnTenantSettings(mgr, { entitlementTtlHours: 100 }))).toBe("forbidden");
    expect(await code(createTenant(mgr, { name: "T", slug: "tt", domain: "tt.vn", adminName: "A B", adminEmail: "a@tt.vn" }))).toBe("forbidden");
  });

  it("trưởng phòng chỉ thấy phòng, ma trận và nhật ký của mình", async () => {
    const mgr = await A("truongphong.nhansu@nexlab.tech");
    const depts = await listDepartments(mgr);
    expect(depts.map((d) => d.name)).toEqual(["Nhân sự"]);
    const m = await getAccessMatrix(mgr);
    expect(m.departments.map((d) => d.name)).toEqual(["Nhân sự"]);
    expect(m.departments[0].editable).toBe(true);
    expect((await listApps(mgr)).length).toBeGreaterThan(0);
    const acc = await deptId("nexlab", "Kế toán");
    expect(await code(getDepartment(mgr, acc))).toBe("forbidden");
    const audit = await listAudit(mgr);
    expect(audit.every((r) => r.deptId !== null)).toBe(true);
  });

  it("nhân viên thường không vào được ma trận, danh sách người dùng, nhật ký", async () => {
    const emp = await A("nv.nhansu@nexlab.tech");
    expect(await code(getAccessMatrix(emp))).toBe("forbidden");
    expect(await code(listUsers(emp))).toBe("forbidden");
    expect(await code(listAudit(emp))).toBe("forbidden");
    expect(await listApps(emp)).toEqual([]);
  });
});

describe("R4 — không tự nâng quyền", () => {
  it("quản trị không tự đổi vai trò / trạng thái / xoá chính mình", async () => {
    const admin = await A("admin@nexlab.tech");
    const base = { name: "Quản trị Nexlab", hubRole: "admin", adminRole: "tenant_admin", status: "active", deptIds: [] as string[] };
    expect(await code(updateUser(admin, admin.userId, { ...base, adminRole: "none" }))).toBe("forbidden");
    expect(await code(updateUser(admin, admin.userId, { ...base, status: "disabled" }))).toBe("forbidden");
    expect(await code(updateUser(admin, admin.userId, { ...base, hubRole: "viewer" }))).toBe("forbidden");
    expect(await code(deleteUser(admin, admin.userId))).toBe("forbidden");
  });

  it("quản trị thứ hai hạ quản trị gốc được; người vừa bị hạ mất quyền ngay ở lần thao tác kế tiếp", async () => {
    const admin = await A("admin@nexlab.tech");
    const { user } = await createUser(admin, { email: "admin2@nexlab.tech", name: "Admin Hai", hubRole: "admin", adminRole: "tenant_admin", deptIds: [] });
    const admin2 = await A("admin2@nexlab.tech");
    const base = { name: "Quản trị Nexlab", hubRole: "admin", adminRole: "none", status: "active", deptIds: [] as string[] };
    await updateUser(admin2, admin.userId, base);
    // Actor được dựng lại từ DB cho mỗi yêu cầu (như khi chạy thật) → quản trị cũ không còn quyền.
    const demoted = await A("admin@nexlab.tech");
    expect(await code(listUsers(demoted))).toBe("forbidden");
    await updateUser(admin2, admin.userId, { ...base, adminRole: "tenant_admin" });
    await deleteUser(await A("admin@nexlab.tech"), user.id);
  });

  it("không thể hạ / xoá quản trị viên đang hoạt động cuối cùng", async () => {
    const admin = await A("admin@nexlab.tech");
    const { user } = await createUser(admin, { email: "admin3@nexlab.tech", name: "Admin Ba", hubRole: "admin", adminRole: "tenant_admin", deptIds: [] });
    const admin3 = await A("admin3@nexlab.tech");
    const base = { name: "Quản trị Nexlab", hubRole: "admin", adminRole: "none", status: "disabled", deptIds: [] as string[] };
    // admin3 vô hiệu hoá admin gốc → còn đúng một quản trị hoạt động (admin3).
    await updateUser(admin3, admin.userId, base);
    // admin gốc (bị vô hiệu hoá) không còn là actor hợp lệ.
    expect(await (await db()).one("SELECT 1 FROM users WHERE id = $1 AND status = 'disabled'", [admin.userId])).not.toBeNull();
    // Không ai khác ngoài admin3 → admin3 không thể tự hạ / tự xoá (R4); quy tắc «còn ít nhất một quản trị» được bảo đảm cả khi bị khoá dòng.
    expect(await code(updateUser(admin3, user.id, { ...base, status: "active", adminRole: "none", hubRole: "admin" }))).toBe("forbidden");
    expect(await code(deleteUser(admin3, user.id))).toBe("forbidden");
    await updateUser(admin3, admin.userId, { ...base, status: "active", adminRole: "tenant_admin" });
    await deleteUser(await A("admin@nexlab.tech"), user.id);
  });

  it("người dùng bị vô hiệu hoá: đá khỏi phiên và không đăng nhập lại được", async () => {
    const admin = await A("admin@nexlab.tech");
    const uid = await userId("nv.ketoan@nexlab.tech");
    const { token } = await createSession(uid);
    expect(await resolveSession(token)).not.toBeNull();
    await updateUser(admin, uid, { name: "Võ Thanh Tùng", hubRole: "member", adminRole: "none", status: "disabled", deptIds: [await deptId("nexlab", "Kế toán")] });
    expect(await resolveSession(token)).toBeNull();
    expect(await code(authenticate("nv.ketoan@nexlab.tech", DEV_PASSWORD))).toBe("unauthenticated");
    await updateUser(admin, uid, { name: "Võ Thanh Tùng", hubRole: "member", adminRole: "none", status: "active", deptIds: [await deptId("nexlab", "Kế toán")] });
    expect(await authenticate("nv.ketoan@nexlab.tech", DEV_PASSWORD)).toBe(uid);
  });
});

describe("Đăng nhập", () => {
  it("sai mật khẩu và email lạ cho cùng một thông báo; đủ mật khẩu thì vào", async () => {
    const wrongPw = await authenticate("nv.nhansu@nexlab.tech", "sai-mat-khau-1").catch((e: AppError) => e.message);
    const unknown = await authenticate("khong.co@nexlab.tech", "sai-mat-khau-1").catch((e: AppError) => e.message);
    expect(wrongPw).toBe(unknown);
    expect(await authenticate("NV.NhanSu@nexlab.tech", DEV_PASSWORD)).toBeTruthy();
  });

  it("khoá tạm sau 5 lần sai", async () => {
    for (let i = 0; i < 5; i++) await authenticate("kiemnhiem@nexlab.tech", `sai-${i}-matkhau1`).catch(() => undefined);
    expect(await code(authenticate("kiemnhiem@nexlab.tech", DEV_PASSWORD))).toBe("rate_limited");
  });

  it("tenant bị tạm ngưng thì mọi người của tenant không đăng nhập được và mất phiên", async () => {
    const platform = await A("platform@nexlab.tech");
    const tenantB = (await listTenants(platform)).find((t) => t.slug === "benhvien-b")!;
    const uid = await userId("bacsi@benhvien-b.test");
    const { token } = await createSession(uid);
    await updateTenant(platform, tenantB.id, { name: tenantB.name, status: "suspended" });
    expect(await resolveSession(token)).toBeNull();
    expect(await code(authenticate("bacsi@benhvien-b.test", DEV_PASSWORD))).toBe("unauthenticated");
    await updateTenant(platform, tenantB.id, { name: tenantB.name, status: "active" });
    expect(await authenticate("bacsi@benhvien-b.test", DEV_PASSWORD)).toBe(uid);
  });

  it("đổi mật khẩu cần mật khẩu hiện tại đúng và mật khẩu mới đủ mạnh", async () => {
    const emp = await A("nv.kinhdoanh@nexlab.tech");
    expect(await code(changeOwnPassword(emp, { current: "sai-roi-nhe1", next: "MatKhauMoi123" }))).toBe("invalid");
    expect(await code(changeOwnPassword(emp, { current: DEV_PASSWORD, next: "ngan" }))).toBe("invalid");
    await changeOwnPassword(emp, { current: DEV_PASSWORD, next: "MatKhauMoi123" });
    expect(await authenticate("nv.kinhdoanh@nexlab.tech", "MatKhauMoi123")).toBeTruthy();
    await changeOwnPassword(emp, { current: "MatKhauMoi123", next: DEV_PASSWORD });
  });
});

describe("Phòng ban, thành viên, trưởng phòng", () => {
  it("bỏ trưởng phòng khỏi phòng thì gỡ luôn chức trưởng phòng", async () => {
    const admin = await A("admin@nexlab.tech");
    const acc = await deptId("nexlab", "Kế toán");
    const mgrId = await userId("truongphong.ketoan@nexlab.tech");
    await removeMember(admin, acc, mgrId);
    expect((await getDepartment(admin, acc)).managerUserId).toBeNull();
    // khôi phục
    await updateDepartment(admin, acc, { name: "Kế toán", description: "Thu chi, công nợ, báo cáo tài chính", managerUserId: mgrId });
    expect((await getDepartment(admin, acc)).managerUserId).toBe(mgrId);
  });

  it("không đặt người bị vô hiệu hoá hoặc người tenant khác làm trưởng phòng", async () => {
    const admin = await A("admin@nexlab.tech");
    const acc = await deptId("nexlab", "Kế toán");
    expect(await code(updateDepartment(admin, acc, { name: "Kế toán", description: "", managerUserId: await userId("bacsi@benhvien-b.test") }))).toBe("invalid");
  });

  it("tên phòng ban trùng bị từ chối", async () => {
    const admin = await A("admin@nexlab.tech");
    expect(await code(createDepartment(admin, { name: "kế toán" }))).toBe("conflict");
  });
});

describe("Danh mục app", () => {
  it("chỉ nhận origin HTTPS hợp lệ; chặn IP / .local / http; không trùng", async () => {
    const admin = await A("admin@nexlab.tech");
    for (const bad of ["http://crm.congty.vn", "https://192.168.1.10", "https://app.local", "https://localhost:3000", "ftp://x.vn", "https://user:pw@crm.vn", "khong-phai-url"])
      expect(await code(createApp(admin, { name: "Thử", origin: bad, maxLevel: "M1" })), bad).toBe("invalid");
    expect(await code(createApp(admin, { name: "Trùng", origin: "https://demo.us.espocrm.com/duong/dan", maxLevel: "M1" }))).toBe("conflict");
    const ok = await createApp(admin, { name: "Wiki nội bộ", origin: "https://wiki.nexlab.tech/trang?x=1", maxLevel: "ask", tags: "Wiki, docs", icon: "FileText", color: "#0ea5e9" });
    const apps = await listApps(admin);
    expect(apps.find((a) => a.id === ok)!.origin).toBe("https://wiki.nexlab.tech");
    expect(apps.find((a) => a.id === ok)!.tags).toEqual(["wiki", "docs"]);
  });

  it("app bị tắt không cấp thêm được, nhưng thu hồi vẫn được", async () => {
    const admin = await A("admin@nexlab.tech");
    const app = await createApp(admin, { name: "App tạm", origin: "https://tam.nexlab.tech", maxLevel: "M0", status: "disabled" });
    const dept = await deptId("nexlab", "Kinh doanh");
    expect(await code(setDepartmentAppLevel(admin, dept, app, "open"))).toBe("invalid");
    expect(await code(setDepartmentAppLevel(admin, dept, app, "none"))).toBe("ok");
  });
});

describe("Xem trước quyền hiệu lực", () => {
  it("người thuộc hai phòng được hợp quyền (lấy mức cao nhất), kèm lý do", async () => {
    const admin = await A("admin@nexlab.tech");
    const p = await previewUser(admin, await userId("kiemnhiem@nexlab.tech"));
    const crm = p.effective.find((e) => e.name === "EspoCRM demo")!;
    expect(crm.level).toBe("M2");
    expect(crm.via.map((v) => v.level).sort()).toEqual(["M2", "ask"]);
    expect(p.effective.find((e) => e.name.startsWith("Nhân sự"))).toBeUndefined();
  });

  it("phạm vi xem trước: trưởng phòng chỉ người phòng mình; nhân viên chỉ mình; admin tất cả trong tenant", async () => {
    const mgr = await A("truongphong.nhansu@nexlab.tech");
    expect(await code(previewUser(mgr, await userId("nv.nhansu@nexlab.tech")))).toBe("ok");
    expect(await code(previewUser(mgr, await userId("nv.kinhdoanh@nexlab.tech")))).toBe("forbidden");
    const emp = await A("nv.nhansu@nexlab.tech");
    expect(await code(previewUser(emp, emp.userId))).toBe("ok");
    expect(await code(previewUser(emp, await userId("truongphong.nhansu@nexlab.tech")))).toBe("forbidden");
    expect(await code(previewUser(await A("admin@nexlab.tech"), await userId("bacsi@benhvien-b.test")))).toBe("not_found");
  });

  it("người bị vô hiệu hoá không có app nào", async () => {
    const admin = await A("admin@nexlab.tech");
    const uid = await userId("khach.xem@nexlab.tech");
    await updateUser(admin, uid, { name: "Khách chỉ xem", hubRole: "viewer", adminRole: "none", status: "disabled", deptIds: [await deptId("nexlab", "Kinh doanh")] });
    expect((await previewUser(admin, uid)).effective).toEqual([]);
    await updateUser(admin, uid, { name: "Khách chỉ xem", hubRole: "viewer", adminRole: "none", status: "active", deptIds: [await deptId("nexlab", "Kinh doanh")] });
  });
});

describe("Nền tảng & nhật ký", () => {
  it("chỉ quản trị nền tảng tạo tenant; email quản trị phải thuộc tên miền; tạo xong đăng nhập được", async () => {
    const platform = await A("platform@nexlab.tech");
    expect(await code(createTenant(platform, { name: "Công ty C", slug: "cty-c", domain: "cty-c.vn", adminName: "Admin C", adminEmail: "admin@khac.vn" }))).toBe("invalid");
    const { tenant, tempPassword } = await createTenant(platform, { name: "Công ty C", slug: "cty-c", domain: "cty-c.vn", adminName: "Admin C", adminEmail: "admin@cty-c.vn" });
    expect(tenant.users).toBe(1);
    expect(tempPassword).toBeTruthy();
    expect(await authenticate("admin@cty-c.vn", tempPassword!)).toBeTruthy();
    expect(await code(createTenant(platform, { name: "Trùng", slug: "cty-c", domain: "khac.vn", adminName: "A B", adminEmail: "a@khac.vn" }))).toBe("conflict");
  });

  it("quản trị nền tảng không đọc được dữ liệu nghiệp vụ của tenant", async () => {
    const platform = await A("platform@nexlab.tech");
    expect(await code(listUsers(platform))).toBe("forbidden");
    expect(await code(getAccessMatrix(platform))).toBe("forbidden");
    const audit = await listAudit(platform);
    expect(audit.every((r) => r.targetType === "tenant")).toBe(true);
  });

  it("nhật ký chỉ-thêm: UPDATE / DELETE / TRUNCATE đều bị chặn", async () => {
    const d = await db();
    await expect(d.q("UPDATE audit_log SET summary = 'sửa'")).rejects.toThrow(/chỉ được thêm/);
    await expect(d.q("DELETE FROM audit_log")).rejects.toThrow(/chỉ được thêm/);
    await expect(d.q("TRUNCATE audit_log")).rejects.toThrow(/chỉ được thêm/);
  });
});
