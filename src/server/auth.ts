import { createHash, randomBytes } from "node:crypto";
import { db, tx, type Db } from "./db";
import { loadActor, type Actor } from "./actor";
import { AppError, invalid } from "./errors";
import { hashPassword, verifyPassword } from "./password";

export const SESSION_HOURS = 8;
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface Globals {
  __cpFails?: Map<string, { count: number; first: number }>;
  __cpDummyHash?: Promise<string>;
}
const g = globalThis as unknown as Globals;
const fails = (g.__cpFails ??= new Map());

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const BAD_LOGIN = "Email hoặc mật khẩu không đúng.";

function checkRate(email: string): void {
  const e = fails.get(email);
  if (!e) return;
  if (Date.now() - e.first > WINDOW_MS) {
    fails.delete(email);
    return;
  }
  if (e.count >= MAX_FAILS) throw new AppError("rate_limited", "Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút.");
}

function noteFailure(email: string): void {
  const e = fails.get(email);
  if (!e || Date.now() - e.first > WINDOW_MS) fails.set(email, { count: 1, first: Date.now() });
  else e.count += 1;
}

/** Kiểm email + mật khẩu. Trả userId. Thông báo lỗi giống hệt cho «không có người dùng» và «sai mật khẩu». */
export async function authenticate(emailRaw: string, password: string): Promise<string> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) throw invalid("Nhập email và mật khẩu.");
  checkRate(email);
  const d = await db();
  const u = await d.one<{ id: string; password_hash: string; status: string; tenant_status: string | null }>(
    `SELECT u.id, u.password_hash, u.status, t.status AS tenant_status
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE lower(u.email) = $1`,
    [email],
  );
  // Luôn tốn thời gian băm như nhau để không lộ email nào tồn tại.
  g.__cpDummyHash ??= hashPassword("dummy-password-1");
  const ok = await verifyPassword(password, u?.password_hash ?? (await g.__cpDummyHash));
  if (!u || !ok) {
    noteFailure(email);
    throw new AppError("unauthenticated", BAD_LOGIN);
  }
  if (u.status !== "active") throw new AppError("unauthenticated", "Tài khoản đã bị vô hiệu hoá. Liên hệ quản trị viên.");
  if (u.tenant_status && u.tenant_status !== "active") throw new AppError("unauthenticated", "Tổ chức của bạn đang tạm ngưng.");
  fails.delete(email);
  await d.q("UPDATE users SET last_login_at = now() WHERE id = $1", [u.id]);
  return u.id;
}

/** Tạo phiên: trả token thô (đặt vào cookie); DB chỉ giữ băm của token. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await tx(async (t) => {
    await t.q("DELETE FROM sessions WHERE expires_at < now()");
    await t.q("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2,$3)", [sha256(token), userId, expiresAt]);
  });
  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const d = await db();
  // Chỉ nhận phiên của Admin Console. Token của Hub (kind='hub') KHÔNG được dùng làm cookie, và ngược lại.
  const s = await d.one<{ user_id: string }>("SELECT user_id FROM sessions WHERE id = $1 AND kind = 'console' AND expires_at > now()", [sha256(token)]);
  return s ? loadActor(d, s.user_id) : null;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await (await db()).q("DELETE FROM sessions WHERE id = $1", [sha256(token)]);
}

/** Dùng khi vô hiệu hoá / đặt lại mật khẩu: đá người đó ra khỏi mọi phiên đang mở. */
export async function revokeUserSessions(d: Db, userId: string): Promise<void> {
  await d.q("DELETE FROM sessions WHERE user_id = $1", [userId]);
}
