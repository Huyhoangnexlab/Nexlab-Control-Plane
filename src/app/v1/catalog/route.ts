import { api, bearerToken, json } from "@/server/http";
import { resolveCaller } from "@/server/services/entitlements";
import { catalogForRequest } from "@/server/services/requests";

/** GET /v1/catalog (Bearer + X-Device-Id) → tên các app đang bật trong danh mục của tổ chức, để chọn app khi «Xin quyền». Chỉ tên, không địa chỉ. */
export const GET = api("catalog", { max: 30, windowMs: 60_000 }, async (req) => {
  const { actor } = await resolveCaller(bearerToken(req), req.headers.get("x-device-id"));
  return json({ apps: await catalogForRequest(actor) });
});
