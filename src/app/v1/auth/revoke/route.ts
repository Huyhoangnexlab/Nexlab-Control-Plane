import { api, bearerToken, json } from "@/server/http";
import { revokeHubToken } from "@/server/services/entitlements";

/** POST /v1/auth/revoke  (Authorization: Bearer …)  →  đăng xuất: thu hồi token Hub hiện tại. */
export const POST = api("revoke", { max: 30, windowMs: 60_000 }, async (req) => {
  await revokeHubToken(bearerToken(req));
  return json({ ok: true });
});
