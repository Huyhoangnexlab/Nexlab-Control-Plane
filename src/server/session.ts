import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Actor } from "./actor";
import { AppError } from "./errors";
import { createSession, destroySession, resolveSession } from "./auth";
import type { ActionResult } from "@/lib/action-result";

const COOKIE = "cp_session";

/** Người đang đăng nhập (cache theo mỗi request). Luôn dựng lại từ DB nên đổi vai trò có hiệu lực ngay. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  return resolveSession(token);
});

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(userId);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  await destroySession(jar.get(COOKIE)?.value);
  jar.delete(COOKIE);
}

/** Dùng trong trang (Server Component): thiếu quyền / không thấy → đưa về trang chủ kèm thông báo thay vì trang lỗi. */
export async function guard<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError && (e.code === "forbidden" || e.code === "not_found")) redirect("/?denied=1");
    throw e;
  }
}

/**
 * Bọc thân một Server Action: bắt lỗi nghiệp vụ thành kết quả hiển thị trong form; chuyển hướng / lỗi hệ thống thì ném tiếp.
 * Mọi Server Action phải tự gọi `requireActor()` bên trong `fn` — Server Action gọi được trực tiếp bằng POST nên không được tin UI.
 */
export async function runAction<T>(fn: () => Promise<{ message?: string; data?: T } | void>): Promise<ActionResult<T extends Record<string, unknown> ? T : Record<string, unknown>>> {
  try {
    const r = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message: r?.message, data: r?.data as never };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) {
      if (e.code === "unauthenticated") redirect("/login");
      return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    }
    console.error("[cp-action]", e);
    return { ok: false, error: "Có lỗi hệ thống, vui lòng thử lại. Nếu lặp lại hãy báo quản trị viên." };
  }
}
