import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Kiểm sức khoẻ cho Caddy / giám sát: không cần đăng nhập, không lộ thông tin — chỉ 200 hoặc 503. */
export async function GET(): Promise<Response> {
  try {
    await (await db()).one("SELECT 1 AS ok");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
