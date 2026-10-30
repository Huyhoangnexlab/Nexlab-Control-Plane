import { api, json, readJson } from "@/server/http";
import { discover } from "@/server/services/entitlements";

/** POST /v1/discover  { email }  →  tổ chức của email + nơi đăng nhập. Không tiết lộ email có tài khoản hay không. */
export const POST = api("discover", { max: 30, windowMs: 60_000 }, async (req) => json(await discover(await readJson(req))));
