import { proxyLlm } from "@/server/services/llm-gateway";

/**
 * POST /v1/llm/{provider}/{path…}  (Authorization: Bearer <token Hub>, X-Device-Id)
 * Cổng LLM: Hub gọi mô hình qua đây, máy chủ gắn khoá của tổ chức rồi chuyển tiếp — khoá không rời Control Plane.
 * Chỉ các đường khai trong lib/llm-gateway.ts được chuyển; mọi kiểm tra (người, vai, model, hạn mức) nằm ở services/llm-gateway.ts.
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string; path: string[] }> }): Promise<Response> {
  const { provider, path } = await ctx.params;
  return proxyLlm(req, provider, path.join("/"));
}
