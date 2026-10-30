import { randomBytes } from "node:crypto";

export type IdPrefix = "ten" | "usr" | "dep" | "app";

/** Id có tiền tố loại đối tượng, ví dụ `usr_3f9a1c0b7d2e4a55`. Không đoán được, không lộ thứ tự tạo. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/** Mật khẩu tạm dễ đọc (không có ký tự dễ nhầm), đủ mạnh cho lần đăng nhập đầu. */
export function newTempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}9`;
}
