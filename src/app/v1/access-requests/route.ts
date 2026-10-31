import { api, bearerToken, json, readJson } from "@/server/http";
import { resolveCaller } from "@/server/services/entitlements";
import { createAccessRequest } from "@/server/services/requests";

/** POST /v1/access-requests (Bearer + X-Device-Id) { appId?, message } → gửi yêu cầu quyền cho quản trị / trưởng phòng. Không tự cấp quyền. */
export const POST = api("access-requests", { max: 10, windowMs: 60_000 }, async (req) => {
  const { actor } = await resolveCaller(bearerToken(req), req.headers.get("x-device-id"));
  return json(await createAccessRequest(actor, await readJson(req)), 201);
});
