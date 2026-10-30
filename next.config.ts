import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Repo gốc cũng có package-lock.json — ghim root để Turbopack không đoán nhầm.
  turbopack: { root: path.join(__dirname) },
  // Trang Hướng dẫn đọc thư mục docs/ lúc chạy → phải đóng gói kèm khi build kiểu standalone (Docker / Cloud Run).
  outputFileTracingIncludes: { "/help/[slug]": ["./docs/**/*"] },
};

export default nextConfig;
