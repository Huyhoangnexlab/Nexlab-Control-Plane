import type { Db } from "./db";
import { newId } from "./ids";
import { hashPassword } from "./password";
import { BV_DEPT, BV_USERS, DEV_PASSWORD, HUB_CLIENT_ID, NEXLAB_DEPTS, NEXLAB_USERS, issuerOf } from "./seed-data";
import type { Level } from "@/lib/levels";

export { DEV_PASSWORD };

/**
 * Dữ liệu mẫu DEV (xem seed-data.ts). Ở dev, trang đăng nhập có nút «Đăng nhập nhanh» cho các tài khoản `seeded`.
 * Production KHÔNG chạy seed này (CP_AUTO_SEED không bật).
 *
 * `CP_SEED_IDP=0` → không khai báo IdP (Vitest đặt như vậy để test không cần Keycloak). Mặc định có khai báo
 * Keycloak local cho 2 tenant; khi đó tenant bị ÉP đăng nhập SSO ở API Hub (không còn token mật khẩu cục bộ).
 */
export async function seedIfEmpty(db: Db): Promise<boolean> {
  const row = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM users");
  if ((row?.n ?? 0) > 0) return false;
  await seedDatabase(db);
  return true;
}

export async function seedDatabase(db: Db): Promise<void> {
  const hash = await hashPassword(DEV_PASSWORD);
  const withIdp = process.env.CP_SEED_IDP !== "0";

  // ── Quản trị nền tảng Nexlab (không thuộc tenant nào) ─────────────────────────────────────────
  await db.q(
    `INSERT INTO users (id, tenant_id, email, display_name, password_hash, admin_role, hub_role, seeded)
     VALUES ($1, NULL, 'platform@nexlab.tech', 'Vận hành Nexlab', $2, 'platform_admin', 'admin', true)`,
    [newId("usr"), hash],
  );

  // ── Tenant 1: Nexlab (nexlab.tech) ───────────────────────────────────────────────────────────
  const t1 = newId("ten");
  await db.q("INSERT INTO tenants (id, name, slug, domain, product_name, accent) VALUES ($1,'Nexlab','nexlab','nexlab.tech','Nexlab Hub','#4f46e5')", [t1]);

  const depts: Record<string, string> = {};
  for (const d of NEXLAB_DEPTS) {
    depts[d.key] = newId("dep");
    await db.q("INSERT INTO departments (id, tenant_id, name, description, idp_group) VALUES ($1,$2,$3,$4,$5)", [depts[d.key], t1, d.name, d.description, d.idpGroup]);
  }

  const apps: Record<string, string> = {};
  for (const [key, name, origin, icon, color, tags, max] of [
    ["hr", "Nhân sự (mô phỏng)", "nexlab-app://hr", "Users", "#0ea5e9", ["hr", "pii"], "M1"],
    ["ts", "Chấm công (mô phỏng)", "nexlab-app://timesheet", "Clock", "#10b981", ["hr"], "M1"],
    ["crm", "EspoCRM demo", "https://demo.us.espocrm.com", "Briefcase", "#f59e0b", ["crm"], "M2"],
    ["acc", "Kế toán S3 (ví dụ)", "https://ketoan.nexlab.tech", "Wallet", "#8b5cf6", ["finance"], "M1"],
  ] as const) {
    apps[key] = newId("app");
    await db.q(
      "INSERT INTO catalog_apps (id, tenant_id, name, origin, icon, color, tags, max_level) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [apps[key], t1, name, origin, icon, color, tags, max],
    );
  }

  const userIds: Record<string, string> = {};
  for (const u of NEXLAB_USERS) {
    userIds[u.key] = newId("usr");
    await db.q(
      "INSERT INTO users (id, tenant_id, email, display_name, password_hash, admin_role, hub_role, seeded) VALUES ($1,$2,$3,$4,$5,$6,$7,true)",
      [userIds[u.key], t1, u.email, u.name, hash, u.adminRole, u.hubRole],
    );
    for (const d of u.depts) await db.q("INSERT INTO memberships (user_id, department_id) VALUES ($1,$2)", [userIds[u.key], depts[d]]);
  }
  for (const [dept, key] of [["hr", "m-hr"], ["acc", "m-acc"], ["sales", "m-sales"]] as const)
    await db.q("UPDATE departments SET manager_user_id = $2 WHERE id = $1", [depts[dept], userIds[key]]);

  const grants: [string, string, Level][] = [
    ["hr", "hr", "M1"], ["hr", "ts", "M1"],
    ["acc", "acc", "M1"], ["acc", "ts", "ask"],
    ["sales", "crm", "M2"], ["sales", "ts", "open"],
    ["it", "crm", "ask"],
  ];
  for (const [d, a, level] of grants)
    await db.q("INSERT INTO department_apps (department_id, app_id, level) VALUES ($1,$2,$3)", [depts[d], apps[a], level]);

  await db.q(
    `INSERT INTO audit_log (tenant_id, actor_email, action, target_type, summary) VALUES ($1,'system','seed','tenant','Nạp dữ liệu mẫu dev cho «Nexlab»')`, [t1]);

  // ── Tenant 2: để thử cô lập chéo tenant ───────────────────────────────────────────────────────
  const t2 = newId("ten");
  await db.q("INSERT INTO tenants (id, name, slug, domain) VALUES ($1,'Bệnh viện Demo B','benhvien-b','benhvien-b.test')", [t2]);
  const d2 = newId("dep");
  await db.q("INSERT INTO departments (id, tenant_id, name, description, idp_group) VALUES ($1,$2,$3,$4,$5)", [d2, t2, BV_DEPT.name, BV_DEPT.description, BV_DEPT.idpGroup]);
  const a2 = newId("app");
  await db.q("INSERT INTO catalog_apps (id, tenant_id, name, origin, icon, color, tags, max_level) VALUES ($1,$2,'HIS Demo','https://his.benhvien-b.test','Stethoscope','#ef4444',ARRAY['his','phi'],'M0')", [a2, t2]);
  const bvIds: Record<string, string> = {};
  for (const u of BV_USERS) {
    bvIds[u.email] = newId("usr");
    await db.q("INSERT INTO users (id, tenant_id, email, display_name, password_hash, admin_role, hub_role, seeded) VALUES ($1,$2,$3,$4,$5,$6,$7,true)", [bvIds[u.email], t2, u.email, u.name, hash, u.adminRole, u.hubRole]);
    if (u.inDept) await db.q("INSERT INTO memberships (user_id, department_id) VALUES ($1,$2)", [bvIds[u.email], d2]);
  }
  await db.q("UPDATE departments SET manager_user_id = $2 WHERE id = $1", [d2, bvIds["bacsi@benhvien-b.test"]]);
  await db.q("INSERT INTO department_apps (department_id, app_id, level) VALUES ($1,$2,'M0')", [d2, a2]);

  // ── Nhà cung cấp danh tính (Keycloak local): mỗi tenant một realm ──────────────────────────────
  if (withIdp) {
    // Nexlab: bật JIT để thử «nhân viên mới» (nguoimoi@nexlab.tech chỉ có ở Keycloak). Bệnh viện: không tự tạo tài khoản.
    await db.q("INSERT INTO identity_providers (tenant_id, issuer, client_id, sync_groups, jit_provisioning) VALUES ($1,$2,$3,true,true)", [t1, issuerOf("nexlab"), HUB_CLIENT_ID]);
    await db.q("INSERT INTO identity_providers (tenant_id, issuer, client_id, sync_groups, jit_provisioning) VALUES ($1,$2,$3,true,false)", [t2, issuerOf("benhvien-b"), HUB_CLIENT_ID]);
  }
}
