import type { z } from "zod";
import { invalid } from "./errors";

/** Kiểm dữ liệu vào bằng zod; sai thì ném lỗi nghiệp vụ kèm lỗi theo từng ô để form hiển thị. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  throw invalid(Object.values(fieldErrors)[0] ?? "Dữ liệu không hợp lệ.", fieldErrors);
}
