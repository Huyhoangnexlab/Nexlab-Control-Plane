import { closeDb, db } from "../src/server/db";
import { seedDatabase } from "../src/server/seed";

// Dùng:  npm run db:reset   — XOÁ toàn bộ dữ liệu trong DB dev rồi nạp lại dữ liệu mẫu.
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Không chạy reset ở production.");
  const d = await db();
  // audit_log có trigger chặn xoá/cắt bảng → tháo trigger tạm để dọn DB dev.
  await d.q("ALTER TABLE audit_log DISABLE TRIGGER USER");
  await d.q("TRUNCATE audit_log, sessions, department_apps, catalog_apps, memberships, departments, users, tenants RESTART IDENTITY CASCADE");
  await d.q("ALTER TABLE audit_log ENABLE TRIGGER USER");
  await seedDatabase(d);
  console.log("Đã xoá và nạp lại dữ liệu mẫu.");
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
