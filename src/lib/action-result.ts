/** Kết quả trả về từ Server Action cho form. `null` = chưa gửi lần nào. */
export type ActionResult<T = Record<string, unknown>> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | null;
