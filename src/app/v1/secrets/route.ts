import { api, bearerToken, json } from "@/server/http";
import { resolveCaller } from "@/server/services/entitlements";
import { deliverSecrets } from "@/server/services/config";

/**
 * GET /v1/secrets  (Authorization: Bearer <token>, X-Device-Id)  →  khoá API / token của tổ chức dành cho VAI của người gọi.
 * Hub giữ trong RAM (không ghi đĩa, không gửi cho renderer). Không gói trong gói quyền vì gói chỉ được KÝ, không MÃ HOÁ.
 */
export const GET = api("secrets", { max: 30, windowMs: 60_000 }, async (req) => {
  const { actor, deviceId } = await resolveCaller(bearerToken(req), req.headers.get("x-device-id"));
  return json(await deliverSecrets(actor, deviceId));
});
