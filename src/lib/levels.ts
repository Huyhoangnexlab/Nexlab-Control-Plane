/**
 * Thang «mức dùng app» — trùng với RBAC-30/10 (docs/rbac/rbac-easy-customization-design-2026-10-30.md §2.2):
 * none · open · ask · M0 · M1 · M2 · M3. M3 có trong lược đồ nhưng CHƯA cho gán (chờ P6 qua cổng).
 * File này là hàm thuần, không import gì của server để Hub / Admin Console dùng chung sau này.
 */
export const LEVELS = ["none", "open", "ask", "M0", "M1", "M2", "M3"] as const;
export type Level = (typeof LEVELS)[number];

/** Mức được phép gán ở thời điểm này (M3 ẩn tới khi P6 qua cổng). */
export const ASSIGNABLE_LEVELS: readonly Level[] = ["none", "open", "ask", "M0", "M1", "M2"];

export const LEVEL_LABEL: Record<Level, string> = {
  none: "Ẩn",
  open: "Chỉ mở app",
  ask: "Hỏi agent",
  M0: "Agent đọc",
  M1: "Agent ghi · duyệt từng lần",
  M2: "Agent ghi · duyệt kế hoạch",
  M3: "Tự duyệt (chưa mở)",
};

export const LEVEL_HINT: Record<Level, string> = {
  none: "Người dùng không thấy app này.",
  open: "Mở được app, tab luôn ở chế độ riêng tư — agent không đọc gì.",
  ask: "Được chia sẻ tab để hỏi agent; agent chỉ trả lời, không thao tác.",
  M0: "Agent được thao tác trang nhưng chỉ đọc.",
  M1: "Agent được ghi, mỗi lần ghi đều cần người duyệt (hành vi hiện tại của Hub).",
  M2: "Duyệt cả kế hoạch một lần; thao tác khớp kế hoạch được tự cấp.",
  M3: "Chỉ dành cho skill đã chứng nhận — chưa mở.",
};

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** Mức cao nhất trong danh sách (rỗng → none). */
export function maxLevel(levels: readonly Level[]): Level {
  return levels.reduce<Level>((best, l) => (levelRank(l) > levelRank(best) ? l : best), "none");
}

/** Kẹp `level` không vượt `ceiling` — quy tắc «lớp dưới chỉ thu hẹp». */
export function clampLevel(level: Level, ceiling: Level): Level {
  return levelRank(level) > levelRank(ceiling) ? ceiling : level;
}
