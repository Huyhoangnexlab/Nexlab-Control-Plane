export type ErrorCode = "forbidden" | "not_found" | "invalid" | "conflict" | "unauthenticated" | "rate_limited" | "unavailable";

/** Lỗi nghiệp vụ có chủ đích — thông điệp tiếng Việt, an toàn để hiện cho người dùng. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "Bạn không có quyền thực hiện thao tác này.") => new AppError("forbidden", msg);
export const notFound = (msg = "Không tìm thấy.") => new AppError("not_found", msg);
export const invalid = (msg: string, fieldErrors?: Record<string, string>) => new AppError("invalid", msg, fieldErrors);
export const conflict = (msg: string) => new AppError("conflict", msg);
