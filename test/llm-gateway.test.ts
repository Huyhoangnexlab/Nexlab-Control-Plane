/**
 * Cổng LLM: khoá của tổ chức không rời server. Kiểm (1) luật đường thuần, (2) /v1/secrets không còn giao khoá mô hình,
 * (3) /v1/llm chuyển tiếp đúng nơi với khoá của tổ chức, (4) các đường từ chối, (5) hạn mức + lượng dùng. Cần Postgres.
 * Nhà cung cấp được GIẢ bằng cách thay `fetch` toàn cục — không gọi mạng thật.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.CP_DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
process.env.CP_ALLOW_DEV_ORIGINS = "0";
process.env.CP_SIGNING_KEY_PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
process.env.CP_SECRETS_KEY = randomBytes(32).toString("base64");
delete process.env.CP_SECRET_DELIVERY;

import { closeDb, db } from "@/server/db";
import { loadActor } from "@/server/actor";
import { DEV_PASSWORD, seedDatabase } from "@/server/seed";
import { setConfig, setSecret } from "@/server/services/config";
import { resetLlmGatewayForTests } from "@/server/services/llm-gateway";
import { resetServiceAccountTokensForTests } from "@/server/google-sa-token";
import { modelAllowed, resolveRoute, usageFromTail } from "@/lib/llm-gateway";
import { POST as tokenPOST } from "@/app/v1/auth/token/route";
import { GET as secretsGET } from "@/app/v1/secrets/route";
import { POST as llmPOST } from "@/app/v1/llm/[provider]/[...path]/route";

const DEVICE = "dev-llm-0001";
const fakeIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function login(email: string): Promise<string> {
  const res = await tokenPOST(new Request("http://cp.test/v1/auth/token", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": fakeIp() }, body: JSON.stringify({ email, password: DEV_PASSWORD, deviceId: DEVICE }) }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}
const actorOf = async (email: string) => {
  const r = (await (await db()).one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]))!;
  return (await loadActor(await db(), r.id))!;
};
const secretsOf = async (token: string) =>
  (await (await secretsGET(new Request("http://cp.test/v1/secrets", { headers: { authorization: `Bearer ${token}`, "x-device-id": DEVICE, "x-forwarded-for": fakeIp() } }))).json()) as {
    secrets: { env: string; value: string }[];
    llmGateway?: { path: string; providers: string[] };
  };

/** Gọi cổng như Hub gọi: provider + đường (có thể kèm query). */
function callGateway(token: string | null, provider: string, path: string, body: unknown = { contents: [] }, extra: Record<string, string> = {}): Promise<Response> {
  const [p, q] = path.split("?");
  const req = new Request(`http://cp.test/v1/llm/${provider}/${p}${q ? `?${q}` : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": DEVICE, ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: JSON.stringify(body),
  });
  return llmPOST(req, { params: Promise.resolve({ provider, path: p.split("/") }) });
}

// Service account với khoá RSA THẬT (sinh tại chỗ, không dùng ở đâu khác) để bước ký JWT chạy thật.
const RSA_PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const SA = { type: "service_account", project_id: "sa-project-1", private_key_id: "kid0123456789", private_key: RSA_PEM, client_email: "hub-vertex@sa-project-1.iam.gserviceaccount.com", client_id: "1" };
const TYPESAFE_KEY = "ts-ORGKEY-DONOTLEAK-0001";
const GEMINI_KEY = "AIza-ORGKEY-DONOTLEAK-0002";
const NOTION = "ntn_ORGTOKEN_notion_0003";
const SA_ACCESS_TOKEN = "ya29.fake-access-token";

interface Seen { url: string; headers: Headers; body: string }
let seen: Seen[] = [];
/** Trả lời của nhà cung cấp giả, đặt lại trước mỗi ca cần khác mặc định. */
let upstreamReply: () => Response = () => Response.json({ candidates: [{ content: { parts: [{ text: "xin chào" }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 12, totalTokenCount: 162 } });

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const body = init?.body == null ? "" : typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as Uint8Array);
  seen.push({ url, headers: new Headers(init?.headers), body });
  if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: SA_ACCESS_TOKEN, expires_in: 3600, token_type: "Bearer" });
  return upstreamReply();
});

const usageRows = async (email: string) =>
  (await db()).q<{ provider: string; model: string; requests: number; errors: number; input_tokens: number; output_tokens: number }>(
    "SELECT u.provider, u.model, u.requests, u.errors, u.input_tokens, u.output_tokens FROM llm_usage u JOIN users x ON x.id = u.user_id WHERE lower(x.email) = lower($1) ORDER BY provider, model", [email]);

describe("luật đường của cổng (thuần)", () => {
  it("vertex: chỉ nhận publishers/google/models/<model>:<phương thức đã khai>, dựng địa chỉ từ project + vùng của tổ chức", () => {
    const r = resolveRoute("vertex", "publishers/google/models/gemini-3.8-flash:generateContent", "");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.route.model).toBe("gemini-3.8-flash");
    expect(r.route.upstream({ project: "nexlab-poc", location: "global" })).toBe("https://aiplatform.googleapis.com/v1beta1/projects/nexlab-poc/locations/global/publishers/google/models/gemini-3.8-flash:generateContent");
    expect(r.route.upstream({ project: "nexlab-poc", location: "asia-southeast1" })).toBe("https://asia-southeast1-aiplatform.googleapis.com/v1beta1/projects/nexlab-poc/locations/asia-southeast1/publishers/google/models/gemini-3.8-flash:generateContent");
    expect(() => r.route.upstream({ project: "x/../y", location: "global" })).toThrow();
  });

  it("stream phải đi kèm alt=sse và ngược lại; query lạ bị từ chối", () => {
    expect(resolveRoute("vertex", "publishers/google/models/gemini-3.8-flash:streamGenerateContent", "?alt=sse").ok).toBe(true);
    expect(resolveRoute("vertex", "publishers/google/models/gemini-3.8-flash:streamGenerateContent", "")).toMatchObject({ ok: false, reason: "bad-query" });
    expect(resolveRoute("vertex", "publishers/google/models/gemini-3.8-flash:generateContent", "?alt=sse")).toMatchObject({ ok: false, reason: "bad-query" });
    expect(resolveRoute("gemini", "v1beta/models/gemini-3.8-flash:generateContent", "?key=abc")).toMatchObject({ ok: false, reason: "bad-query" });
  });

  it("từ chối đường ngoài danh sách: phương thức khác, project của người gọi, chui thư mục, nhà cung cấp lạ", () => {
    const bad = (p: string, path: string) => expect(resolveRoute(p, path, "")).toMatchObject({ ok: false });
    bad("vertex", "publishers/google/models/gemini-3.8-flash:predict");
    bad("vertex", "projects/attacker/locations/global/publishers/google/models/gemini-3.8-flash:generateContent");
    bad("vertex", "publishers/google/models/../../endpoints/1:generateContent");
    bad("vertex", "publishers/anthropic/models/claude:rawPredict");
    bad("gemini", "v1beta/cachedContents");
    bad("gemini", "v1beta/models/gemini-3.8-flash%3AgenerateContent");
    bad("typesafe", "models");
    bad("openrouter", "chat/completions");
    bad("anthropic", "v1/messages");
    expect(resolveRoute("typesafe", "systemone", "")).toMatchObject({ ok: true });
  });

  it("modelAllowed: mẫu glob, danh sách rỗng từ chối hết, model rỗng luôn qua", () => {
    expect(modelAllowed("gemini-3.8-flash", "gemini-*")).toBe(true);
    expect(modelAllowed("gemini-3.8-flash", "gemini-3.8-flash, gemini-4-*")).toBe(true);
    expect(modelAllowed("claude-opus-5", "gemini-*")).toBe(false);
    expect(modelAllowed("xgemini-1", "gemini-*")).toBe(false);
    expect(modelAllowed("gemini-3.8-flash", "")).toBe(false);
    expect(modelAllowed("gemini.3", "gemini-3")).toBe(false); // dấu chấm trong mẫu là ký tự thường
    expect(modelAllowed("", "gemini-*")).toBe(true);
  });

  it("usageFromTail: lấy lần xuất hiện cuối (SSE nhiều khúc), token ra gồm cả suy nghĩ", () => {
    expect(usageFromTail('{"usageMetadata":{"promptTokenCount":120,"candidatesTokenCount":30,"thoughtsTokenCount":12}}')).toEqual({ input: 120, output: 42 });
    expect(usageFromTail('data: {"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":1}}\n\ndata: {"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":9}}\n\n')).toEqual({ input: 5, output: 9 });
    expect(usageFromTail("không có gì")).toEqual({ input: 0, output: 0 });
  });
});

describe("cổng LLM", () => {
  beforeAll(async () => {
    await seedDatabase(await db());
    const admin = await actorOf("admin@nexlab.tech");
    await setSecret(admin, { key: "GOOGLE_SERVICE_ACCOUNT_JSON", value: JSON.stringify(SA), roles: ["member", "lead", "admin"] });
    await setSecret(admin, { key: "TYPESAFE_API_KEY", value: TYPESAFE_KEY, roles: ["member", "lead", "admin"] });
    await setSecret(admin, { key: "GEMINI_API_KEY", value: GEMINI_KEY, roles: ["admin"] });
    await setSecret(admin, { key: "NOTION_TOKEN", value: NOTION, roles: ["member", "author", "lead", "admin"] });
    await setConfig(admin, { key: "GOOGLE_CLOUD_PROJECT", value: "org-project-9", locked: true });
    await setConfig(admin, { key: "GOOGLE_CLOUD_LOCATION", value: "asia-southeast1", locked: true });
    vi.stubGlobal("fetch", fetchMock);
  }, 60_000);

  afterEach(() => {
    seen = [];
    upstreamReply = () => Response.json({ candidates: [{ content: { parts: [{ text: "xin chào" }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 12, totalTokenCount: 162 } });
    delete process.env.CP_LLM_USER_DAILY_REQUESTS;
    delete process.env.CP_LLM_TENANT_DAILY_REQUESTS;
    delete process.env.CP_LLM_MODEL_ALLOW;
    delete process.env.CP_SECRET_DELIVERY;
    resetLlmGatewayForTests();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    resetServiceAccountTokensForTests();
    await closeDb();
  });

  it("/v1/secrets: KHÔNG giao khoá mô hình; chỉ báo tên nhà cung cấp theo vai; token Notion vẫn giao", async () => {
    const member = await secretsOf(await login("nv.nhansu@nexlab.tech"));
    expect(member.secrets.map((s) => s.env)).toEqual(["NOTION_TOKEN"]);
    expect(member.llmGateway).toEqual({ path: "/v1/llm", providers: ["vertex", "typesafe"] }); // GEMINI_API_KEY chỉ cấp cho admin
    expect(JSON.stringify(member)).not.toContain("DONOTLEAK");
    expect(JSON.stringify(member)).not.toContain("PRIVATE KEY");

    const admin = await secretsOf(await login("admin@nexlab.tech"));
    expect(admin.llmGateway?.providers).toEqual(["vertex", "gemini", "typesafe"]);
    expect(JSON.stringify(admin)).not.toContain("DONOTLEAK");

    const viewer = await secretsOf(await login("khach.xem@nexlab.tech"));
    expect(viewer.secrets).toEqual([]);
    expect(viewer.llmGateway?.providers).toEqual([]);
  });

  it("CP_SECRET_DELIVERY=legacy: giao bản rõ như trước và không báo cổng (cho bản Hub cũ)", async () => {
    process.env.CP_SECRET_DELIVERY = "legacy";
    const r = await secretsOf(await login("nv.nhansu@nexlab.tech"));
    expect(r.secrets.map((s) => s.env).sort()).toEqual(["GOOGLE_SERVICE_ACCOUNT_JSON", "NOTION_TOKEN", "TYPESAFE_API_KEY"]);
    expect(r.llmGateway).toBeUndefined();
  });

  it("vertex: chuyển tới project + vùng của TỔ CHỨC bằng access token của service account; trả nguyên thân; ghi token", async () => {
    const token = await login("nv.nhansu@nexlab.tech");
    const res = await callGateway(token, "vertex", "publishers/google/models/gemini-3.8-flash:generateContent", { contents: [{ role: "user", parts: [{ text: "chào" }] }] });
    expect(res.status).toBe(200);
    const out = await res.text();
    expect(out).toContain("xin chào");

    const tokenCall = seen.find((s) => s.url === "https://oauth2.googleapis.com/token")!;
    expect(tokenCall.body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    const up = seen.find((s) => s.url.includes("aiplatform.googleapis.com"))!;
    expect(up.url).toBe("https://asia-southeast1-aiplatform.googleapis.com/v1beta1/projects/org-project-9/locations/asia-southeast1/publishers/google/models/gemini-3.8-flash:generateContent");
    expect(up.headers.get("authorization")).toBe(`Bearer ${SA_ACCESS_TOKEN}`);
    expect(up.headers.get("authorization")).not.toContain(token); // token của người dùng không đi tới nhà cung cấp
    expect(JSON.parse(up.body)).toEqual({ contents: [{ role: "user", parts: [{ text: "chào" }] }] });

    expect(await usageRows("nv.nhansu@nexlab.tech")).toEqual([{ provider: "vertex", model: "gemini-3.8-flash", requests: 1, errors: 0, input_tokens: 120, output_tokens: 42 }]);

    // Lần hai dùng lại access token đã nhớ — không xin lại.
    seen = [];
    await (await callGateway(token, "vertex", "publishers/google/models/gemini-3.8-flash:generateContent")).text();
    expect(seen.some((s) => s.url === "https://oauth2.googleapis.com/token")).toBe(false);
  });

  it("stream SSE: chuyển nguyên luồng, lấy số token ở khúc cuối", async () => {
    upstreamReply = () =>
      new Response('data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":"b"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":2}}\n\n', { headers: { "content-type": "text/event-stream" } });
    const res = await callGateway(await login("truongphong.nhansu@nexlab.tech"), "vertex", "publishers/google/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect((await res.text()).split("data: ").length).toBe(3);
    expect(seen.at(-1)!.url.endsWith(":streamGenerateContent?alt=sse")).toBe(true);
    expect(await usageRows("truongphong.nhansu@nexlab.tech")).toEqual([{ provider: "vertex", model: "gemini-3.8-flash", requests: 1, errors: 0, input_tokens: 7, output_tokens: 2 }]);
  });

  it("typesafe: gắn khoá của tổ chức, ghi model lấy từ thân; lỗi của nhà cung cấp trả nguyên và tính là lỗi", async () => {
    const token = await login("nv.ketoan@nexlab.tech");
    upstreamReply = () => Response.json({ answers: {} });
    const ok = await callGateway(token, "typesafe", "systemone", { model: "jev-latest", state: {}, questions: {} });
    expect(ok.status).toBe(200);
    await ok.text();
    const up = seen.find((s) => s.url === "https://api.typesafe.ai/v1/systemone")!;
    expect(up.headers.get("authorization")).toBe(`Bearer ${TYPESAFE_KEY}`);

    upstreamReply = () => Response.json({ error: "Unknown model" }, { status: 400 });
    const bad = await callGateway(token, "typesafe", "systemone", { model: "jev-latest" });
    expect(bad.status).toBe(400);
    expect(bad.headers.get("x-nexlab-gateway-error")).toBeNull(); // lỗi của nhà cung cấp, không phải của cổng
    expect(await bad.text()).toContain("Unknown model");
    expect(await usageRows("nv.ketoan@nexlab.tech")).toEqual([{ provider: "typesafe", model: "jev-latest", requests: 2, errors: 1, input_tokens: 0, output_tokens: 0 }]);
  });

  it("từ chối: không token, token sai, vai không được cấp, tổ chức khác, đường / model ngoài danh sách — và không chạm nhà cung cấp", async () => {
    const path = "publishers/google/models/gemini-3.8-flash:generateContent";
    const expectGw = async (res: Response, status: number) => {
      expect(res.status).toBe(status);
      expect(res.headers.get("x-nexlab-gateway-error")).toBe("1");
      const j = (await res.json()) as { error: { code: number; message: string } };
      expect(j.error.code).toBe(status);
      expect(JSON.stringify(j)).not.toContain("DONOTLEAK");
    };
    await expectGw(await callGateway(null, "vertex", path), 401);
    await expectGw(await callGateway("nxh_khong-ton-tai", "vertex", path), 401);
    await expectGw(await callGateway(await login("khach.xem@nexlab.tech"), "vertex", path), 403); // viewer không nằm trong vai nhận
    await expectGw(await callGateway(await login("nv.nhansu@nexlab.tech"), "gemini", "v1beta/models/gemini-3.8-flash:generateContent"), 403); // khoá Gemini chỉ cấp admin
    await expectGw(await callGateway(await login("bacsi@benhvien-b.test"), "vertex", path), 403); // tổ chức khác chưa đặt khoá — không dùng nhờ khoá của Nexlab
    const member = await login("nv.kinhdoanh@nexlab.tech");
    await expectGw(await callGateway(member, "vertex", "publishers/google/models/gemini-3.8-flash:predict"), 404);
    await expectGw(await callGateway(member, "vertex", "projects/attacker/locations/global/publishers/google/models/gemini-3.8-flash:generateContent"), 404);
    await expectGw(await callGateway(member, "anthropic", "v1/messages"), 404);
    await expectGw(await callGateway(member, "vertex", "publishers/google/models/text-bison:generateContent"), 403);
    expect(seen).toEqual([]);
    expect(await usageRows("nv.kinhdoanh@nexlab.tech")).toEqual([]); // bị từ chối thì không tính lượng dùng
  });

  it("CP_LLM_MODEL_ALLOW siết model theo máy chủ", async () => {
    process.env.CP_LLM_MODEL_ALLOW = "gemini-4-*";
    const res = await callGateway(await login("nv.kinhdoanh@nexlab.tech"), "vertex", "publishers/google/models/gemini-3.8-flash:generateContent");
    expect(res.status).toBe(403);
    expect(seen).toEqual([]);
  });

  it("hạn mức ngày theo người và theo tổ chức → 429 của cổng, không chạm nhà cung cấp", async () => {
    const token = await login("kiemnhiem@nexlab.tech");
    const path = "publishers/google/models/gemini-3.8-flash:generateContent";
    process.env.CP_LLM_USER_DAILY_REQUESTS = "2";
    await (await callGateway(token, "vertex", path)).text();
    await (await callGateway(token, "vertex", path)).text();
    seen = [];
    const third = await callGateway(token, "vertex", path);
    expect(third.status).toBe(429);
    expect(third.headers.get("x-nexlab-gateway-error")).toBe("1");
    expect(((await third.json()) as { error: { status: string } }).error.status).toBe("RESOURCE_EXHAUSTED");
    expect(seen).toEqual([]);

    delete process.env.CP_LLM_USER_DAILY_REQUESTS;
    process.env.CP_LLM_TENANT_DAILY_REQUESTS = "1"; // cả tổ chức đã vượt 1 lần gọi trong ngày
    expect((await callGateway(token, "vertex", path)).status).toBe(429);
  });

  it("nhà cung cấp không kết nối được → 502 của cổng, tính là lỗi", async () => {
    upstreamReply = () => {
      throw new TypeError("fetch failed");
    };
    const res = await callGateway(await login("truongphong.ketoan@nexlab.tech"), "typesafe", "systemone", { model: "jev-latest" });
    expect(res.status).toBe(502);
    expect(res.headers.get("x-nexlab-gateway-error")).toBe("1");
    expect(await usageRows("truongphong.ketoan@nexlab.tech")).toEqual([{ provider: "typesafe", model: "jev-latest", requests: 1, errors: 1, input_tokens: 0, output_tokens: 0 }]);
  });
});
