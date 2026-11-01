import { z } from "zod";

/**
 * Phạm vi SOP của MỘT app do tổ chức đặt (gửi cho mọi nhân viên qua gói quyền đã ký). Khớp SopScopeSchema của Hub
 * (src/shared/agent-registry-contract.ts) — Hub giữ bản sao nguyên văn file này ở src/shared/control-plane/sop-scope.ts (test chống lệch).
 * Chọn một GỐC (trang cha / library Notion) = lấy cả nhánh. Chỉ chứa id + tiêu đề trang, KHÔNG có nội dung SOP.
 */
export const MAX_SOP_ROOTS = 25;
export const MAX_SOP_EXCLUDES = 500;

export const sopFilterSchema = z.object({
  modules: z.array(z.string().min(1).max(60)).max(20).optional(),
  kinds: z.array(z.string().min(1).max(60)).max(20).optional(),
});

export const sopScopeSchema = z.object({
  roots: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        kind: z.enum(["page", "data_source"]),
        title: z.string().max(200),
        filter: sopFilterSchema.optional(),
      }),
    )
    .max(MAX_SOP_ROOTS),
  filter: sopFilterSchema.optional(),
  exclude: z.array(z.string().min(1).max(64)).max(MAX_SOP_EXCLUDES).optional(),
  originFilter: z.boolean().optional(),
  allowedStatuses: z.array(z.string().min(1).max(60)).max(20).optional(),
});
export type SopScopeV1 = z.infer<typeof sopScopeSchema>;

/** Trần kích thước JSON của một phạm vi (chặn nhồi dữ liệu vào gói quyền). */
export const MAX_SOP_SCOPE_BYTES = 24 * 1024;
