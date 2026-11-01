import { api, bearerToken, json, readJson } from "@/server/http";
import { resolveCaller } from "@/server/services/entitlements";
import { setAppSopScope } from "@/server/services/sop-scope";

/**
 * PUT /v1/apps/{catalogAppId}/sop-scope  (Bearer + X-Device-Id)  { sopScope: {...} | null }
 * Người soạn SOP (author / lead / admin) đặt phạm vi SOP của app MÌNH ĐƯỢC CẤP cho cả tổ chức; mọi nhân viên nhận ở lần làm mới gói quyền kế tiếp.
 * Vai và quyền với app do MÁY CHỦ kiểm theo token — không tin gì từ Hub gửi lên ngoài chính phạm vi.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return api("sop-scope", { max: 20, windowMs: 60_000 }, async (r) => {
    const { actor } = await resolveCaller(bearerToken(r), r.headers.get("x-device-id"));
    return json(await setAppSopScope(actor, id, await readJson(r, 32 * 1024)));
  })(req);
}
