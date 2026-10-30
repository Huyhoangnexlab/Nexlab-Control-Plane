import { z } from "zod";
import { ASSIGNABLE_LEVELS, type Level } from "./levels";

const assignable = (v: string): v is Level => (ASSIGNABLE_LEVELS as readonly string[]).includes(v);

export const levelSchema = z.string().refine(assignable, "Mức quyền không hợp lệ.") as unknown as z.ZodType<Level>;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Email không hợp lệ.")
  .max(120, "Email quá dài.");

export const passwordSchema = z
  .string()
  .min(8, "Mật khẩu tối thiểu 8 ký tự.")
  .max(128, "Mật khẩu quá dài.")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Mật khẩu cần có cả chữ và số.");

export const nameSchema = (label: string, min = 2) =>
  z.string().trim().min(min, `${label} tối thiểu ${min} ký tự.`).max(80, `${label} tối đa 80 ký tự.`);

export const HUB_ROLES = ["viewer", "member", "lead", "admin"] as const;
export type HubRole = (typeof HUB_ROLES)[number];
export const HUB_ROLE_LABEL: Record<HubRole, string> = {
  viewer: "Chỉ đọc",
  member: "Nhân viên",
  lead: "Trưởng nhóm",
  admin: "Quản trị Hub",
};

export const ADMIN_ROLES = ["none", "tenant_admin", "platform_admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ICONS = ["Globe", "Users", "Wallet", "Briefcase", "Clock", "Building2", "ShieldCheck", "FileText", "BarChart3", "Stethoscope", "Headphones", "Package"] as const;
export type AppIcon = (typeof ICONS)[number];

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "Mã chỉ gồm chữ thường, số, dấu gạch ngang (2–31 ký tự).");

export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, "Tên miền không hợp lệ (ví dụ: congty.vn).");

export const colorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Màu dạng #RRGGBB.");

export const tagsSchema = z
  .string()
  .transform((s) =>
    Array.from(
      new Set(
        s
          .split(/[,\s]+/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      ),
    ),
  )
  .pipe(z.array(z.string().regex(/^[a-z0-9-]{1,20}$/, "Thẻ chỉ gồm chữ thường, số, gạch ngang.")).max(8, "Tối đa 8 thẻ."));
