import { api, json, readJson } from "@/server/http";
import { issueHubToken } from "@/server/services/entitlements";

/** POST /v1/auth/token  { email, password, deviceId, deviceName? }  →  { accessToken, tokenType, expiresAt }  (thay IdP ở giai đoạn local) */
export const POST = api("token", { max: 20, windowMs: 60_000 }, async (req) => json(await issueHubToken(await readJson(req))));
