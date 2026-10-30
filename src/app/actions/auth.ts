"use server";

import { redirect } from "next/navigation";
import { authenticate } from "@/server/auth";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { endSession, startSession } from "@/server/session";
import type { ActionResult } from "@/lib/action-result";

export async function loginAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const userId = await authenticate(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
    await startSession(userId);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error("[cp-login]", e);
    return { ok: false, error: "Không đăng nhập được do lỗi hệ thống. Kiểm tra Postgres (docker compose up -d)." };
  }
  redirect("/");
}

/**
 * Đăng nhập nhanh cho tài khoản MẪU — chỉ khi chạy dev (CP_DEV_LOGIN=1) và tài khoản được đánh dấu `seeded`.
 * Production không bao giờ bật cờ này.
 */
export async function devLoginAction(formData: FormData): Promise<void> {
  if (process.env.CP_DEV_LOGIN !== "1" || process.env.NODE_ENV === "production") redirect("/login");
  const email = String(formData.get("email") ?? "").toLowerCase();
  const d = await db();
  const u = await d.one<{ id: string; status: string }>("SELECT id, status FROM users WHERE lower(email) = $1 AND seeded = true", [email]);
  if (!u || u.status !== "active") redirect("/login");
  await d.q("UPDATE users SET last_login_at = now() WHERE id = $1", [u.id]);
  await startSession(u.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}
