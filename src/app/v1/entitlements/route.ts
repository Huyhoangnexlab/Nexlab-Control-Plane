import { api, bearerToken, json } from "@/server/http";
import { getSignedEntitlement } from "@/server/services/entitlements";

/** GET /v1/entitlements  (Authorization: Bearer <token SSO của IdP>, X-Device-Id: <deviceId>)  →  gói quyền ĐÃ KÝ của đúng người + thiết bị. */
export const GET = api("entitlements", { max: 60, windowMs: 60_000 }, async (req) => json(await getSignedEntitlement(bearerToken(req), req.headers.get("x-device-id"))));
