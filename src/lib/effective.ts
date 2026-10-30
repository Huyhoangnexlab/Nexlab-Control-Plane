import { clampLevel, levelRank, maxLevel, type Level } from "./levels";

export interface EffectiveApp {
  appId: string;
  name: string;
  origin: string;
  icon: string;
  color: string;
  level: Level;
  /** Phòng nào đã cấp, mức mỗi phòng (trước khi kẹp trần của app). */
  via: { deptId: string; deptName: string; level: Level }[];
  /** true nếu mức cấp bị kẹp bởi trần `max_level` của app. */
  clamped: boolean;
}

export interface EffectiveInput {
  apps: { id: string; name: string; origin: string; icon: string; color: string; maxLevel: Level; status: "active" | "disabled" }[];
  departments: { id: string; name: string }[];
  deptApps: { deptId: string; appId: string; level: Level }[];
  /** Các phòng người dùng thuộc về. */
  userDeptIds: string[];
}

/**
 * Quyền hiệu lực của MỘT người = hợp (max) các phòng của họ, rồi kẹp trần của app.
 * Hàm thuần — đây cũng là phần lõi của `PolicyCompiler` sau này (plan M3.3), nên Admin Console «Xem trước»
 * và gói quyền gửi cho Hub dùng chung đúng một logic.
 */
export function computeEffective(input: EffectiveInput): EffectiveApp[] {
  const deptName = new Map(input.departments.map((d) => [d.id, d.name]));
  const mine = new Set(input.userDeptIds);
  const out: EffectiveApp[] = [];
  for (const app of input.apps) {
    if (app.status !== "active") continue;
    const via = input.deptApps
      .filter((da) => da.appId === app.id && mine.has(da.deptId) && da.level !== "none")
      .map((da) => ({ deptId: da.deptId, deptName: deptName.get(da.deptId) ?? da.deptId, level: da.level }));
    if (via.length === 0) continue;
    const raw = maxLevel(via.map((v) => v.level));
    const level = clampLevel(raw, app.maxLevel);
    if (level === "none") continue;
    out.push({ appId: app.id, name: app.name, origin: app.origin, icon: app.icon, color: app.color, level, via, clamped: levelRank(raw) > levelRank(level) });
  }
  return out.sort((a, b) => levelRank(b.level) - levelRank(a.level) || a.name.localeCompare(b.name, "vi"));
}
