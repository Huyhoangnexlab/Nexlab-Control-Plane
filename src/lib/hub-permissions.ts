import type { Level } from "./levels";
import type { HubRole } from "./validators";

/**
 * Danh mục quyền DÙNG HUB (tầng 1) — danh mục ĐÓNG. Thêm quyền = đổi file này + Hub + test + docs/02.
 * Nguồn sự thật duy nhất: gói quyền gửi cho Hub, trang Hướng dẫn và test đều đọc từ đây.
 * Xem docs/02-vai-tro-va-quyen.md (phần B).
 */
export const PERMS = [
  "app.add",
  "app.remove",
  "mcp.consent",
  "agent.config",
  "settings.config",
  "settings.apikeys",
  "skill.edit",
  "skill.enable",
  "skill.publish",
  "memory.view",
  "memory.approve",
  "memory.wipe",
  "learn.run",
  "audit.view",
  "policy.edit",
] as const;
export type Perm = (typeof PERMS)[number];

export type Risk = "cao" | "trung-binh" | "thap";

export const PERM_INFO: Record<Perm, { group: string; label: string; risk: Risk; description: string }> = {
  "app.add": { group: "Ứng dụng", label: "Thêm app tự do", risk: "cao", description: "Thêm app tự do trong Hub. Mặc định TẮT cho mọi vai (chế độ 1: cấm hẳn)." },
  "app.remove": { group: "Ứng dụng", label: "Gỡ / đổi tên app", risk: "cao", description: "Gỡ app hoặc đổi tên (xoá cookie, cấu hình, hội thoại của app). Mặc định TẮT cho mọi vai." },
  "mcp.consent": { group: "Agent", label: "Cho phép kết nối MCP", risk: "trung-binh", description: "Cho agent kết nối MCP của một app (chỉ chiều cấp; thu hồi luôn được)." },
  "agent.config": { group: "Agent", label: "Sửa cấu hình agent", risk: "cao", description: "Sửa cấu hình agent, phạm vi SOP, nguồn dữ liệu." },
  "settings.config": { group: "Cài đặt", label: "Sửa cấu hình triển khai", risk: "trung-binh", description: "Sửa cấu hình chung và riêng từng app (trong danh sách biến cho phép)." },
  "settings.apikeys": { group: "Cài đặt", label: "Quản lý khoá API", risk: "cao", description: "Lưu / xoá khoá API, xuất khoá ra .env. Đòi xác thực mạnh hơn." },
  "skill.edit": { group: "Kỹ năng & bộ nhớ", label: "Sửa skill", risk: "trung-binh", description: "Tạo, sửa, nhập, xuất, xoá skill (skill nhập vào luôn là bản nháp)." },
  "skill.enable": { group: "Kỹ năng & bộ nhớ", label: "Bật skill", risk: "trung-binh", description: "Bật skill đã qua lint (tối đa 5 skill bật mỗi app)." },
  "skill.publish": { group: "Kỹ năng & bộ nhớ", label: "Chia sẻ skill dùng chung", risk: "trung-binh", description: "Bật skill dùng chung cho nhiều người (cần danh tính thật)." },
  "memory.view": { group: "Kỹ năng & bộ nhớ", label: "Xem bộ nhớ agent", risk: "thap", description: "Xem bài học, quy trình nháp, thống kê bộ nhớ." },
  "memory.approve": { group: "Kỹ năng & bộ nhớ", label: "Duyệt thẻ ghi nhớ", risk: "trung-binh", description: "Duyệt thẻ ghi nhớ do agent đề xuất." },
  "memory.wipe": { group: "Kỹ năng & bộ nhớ", label: "Xoá bộ nhớ của mình", risk: "thap", description: "Xoá bộ nhớ agent của chính mình (quyền riêng tư — mọi vai đều có)." },
  "learn.run": { group: "Kỹ năng & bộ nhớ", label: "Bật chế độ tự học", risk: "trung-binh", description: "Bật tự học trên tab (cần mức app ≥ M0; tự học không bao giờ ghi thật)." },
  "audit.view": { group: "Quản trị", label: "Xem nhật ký trong Hub", risk: "thap", description: "Xem nhật ký hoạt động trong Hub." },
  "policy.edit": { group: "Quản trị", label: "Sửa chính sách", risk: "cao", description: "Sửa / nhập / xuất chính sách. Đòi xác thực mạnh hơn." },
};

/** Mặc định theo 4 vai trò Hub (đã áp chế độ 1: không vai nào có app.add / app.remove). */
export const ROLE_PERMS: Record<HubRole, readonly Perm[]> = {
  viewer: ["memory.wipe"],
  member: ["skill.edit", "skill.enable", "memory.view", "memory.approve", "memory.wipe"],
  lead: ["mcp.consent", "skill.edit", "skill.enable", "memory.view", "memory.approve", "memory.wipe", "learn.run", "audit.view"],
  admin: ["mcp.consent", "agent.config", "settings.config", "settings.apikeys", "skill.edit", "skill.enable", "skill.publish", "memory.view", "memory.approve", "memory.wipe", "learn.run", "audit.view", "policy.edit"],
};

/** Trần chế độ tự chủ theo vai trò. Hub lấy min(trần vai trò, mức app, lựa chọn của người dùng). */
export const ROLE_AUTONOMY_MAX: Record<HubRole, Extract<Level, "M0" | "M1" | "M2">> = {
  viewer: "M0",
  member: "M1",
  lead: "M2",
  admin: "M2",
};

export const HUB_ROLE_ORDER: readonly HubRole[] = ["viewer", "member", "lead", "admin"];
