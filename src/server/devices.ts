import { z } from "zod";
import type { Db } from "./db";
import { forbidden } from "./errors";

/** `deviceId` do Hub tự sinh một lần khi cài (UUID). 8–64 ký tự chữ, số, gạch ngang / gạch dưới. */
export const deviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "deviceId gồm 8–64 ký tự chữ, số, gạch ngang / gạch dưới.");

/** Ghi nhận thiết bị (tạo mới hoặc cập nhật lần dùng cuối). Thiết bị đã bị thu hồi → từ chối. */
export async function touchDevice(d: Db, userId: string, deviceId: string, name = ""): Promise<void> {
  const row = await d.one<{ revoked_at: string | null }>(
    `INSERT INTO devices (user_id, id, name) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, id) DO UPDATE SET last_seen = now(), name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE devices.name END
     RETURNING revoked_at`,
    [userId, deviceId, name],
  );
  if (row?.revoked_at) throw forbidden("Thiết bị này đã bị thu hồi. Liên hệ quản trị viên.");
}
