import { closeDb, db } from "../src/server/db";
import { seedIfEmpty } from "../src/server/seed";

// Dùng:  npm run db:seed   (chỉ nạp khi DB chưa có người dùng nào)
async function main() {
  const d = await db();
  const seeded = await seedIfEmpty(d);
  console.log(seeded ? "Đã nạp dữ liệu mẫu." : "DB đã có dữ liệu — bỏ qua. Dùng `npm run db:reset` để xoá và nạp lại.");
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
