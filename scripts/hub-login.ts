/**
 * Mô phỏng ĐÚNG những gì Hub sẽ làm để đăng nhập SSO và nhận gói quyền — dùng làm mẫu khi viết IdentityService trong Hub.
 *
 *   discover (email → tổ chức + IdP) → trình duyệt hệ thống → Authorization Code + PKCE (S256) về redirect loopback
 *   127.0.0.1:<cổng ngẫu nhiên> (RFC 8252) → đổi code lấy token → GET /v1/entitlements (Bearer + X-Device-Id)
 *   → kiểm chữ ký bằng verifyEntitlement (file src/lib/entitlement.ts mà Hub sẽ nhập).
 *
 * Dùng:   npm run hub:login -- --email nv.nhansu@nexlab.tech [--cp http://localhost:4000] [--no-open]
 *   --no-open   không tự mở trình duyệt, chỉ in địa chỉ đăng nhập (dùng khi chạy tự động)
 *
 * Khoá công khai ở đây lấy từ /v1/keys CHỈ để tiện dev. Hub thật phải NHÚNG khoá trong bản build.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { verifyEntitlement, type SignedEntitlement, type TrustedKey } from "../src/lib/entitlement";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const CP = (arg("cp", "http://localhost:4000") as string).replace(/\/+$/, "");
const email = arg("email");
if (!email) {
  console.error("Thiếu --email. Ví dụ: npm run hub:login -- --email nv.nhansu@nexlab.tech");
  process.exit(2);
}

/** deviceId do Hub sinh MỘT LẦN khi cài và giữ nguyên (Hub thật lưu trong kho an toàn). */
function deviceId(): string {
  const file = path.join(process.cwd(), ".data", "hub-device-id");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(path.dirname(file), { recursive: true });
  const id = randomUUID();
  writeFileSync(file, id);
  return id;
}

const b64url = (b: Buffer) => b.toString("base64url");

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} → ${res.status} ${JSON.stringify((body as { error?: unknown }).error ?? body)}`);
  return body;
}

async function main() {
  const device = deviceId();
  console.log(`Thiết bị: ${device}`);

  // 1. discover
  const disc = await getJson<{ found: boolean; tenant?: { name: string }; auth?: { method: string; issuer: string; clientId: string; scopes: string[]; deviceHeader: string } }>(
    `${CP}/v1/discover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  if (!disc.found || !disc.auth) throw new Error("Không tìm thấy tổ chức cho email này, hoặc tổ chức chưa cấu hình đăng nhập.");
  if (disc.auth.method !== "oidc") throw new Error(`Tổ chức dùng cách đăng nhập '${disc.auth.method}', script này chỉ làm OIDC.`);
  console.log(`Tổ chức: ${disc.tenant?.name} — IdP: ${disc.auth.issuer}`);

  // 2. cấu hình OIDC của IdP
  const oidc = await getJson<{ authorization_endpoint: string; token_endpoint: string }>(`${disc.auth.issuer}/.well-known/openid-configuration`);

  // 3. PKCE + loopback redirect (cổng ngẫu nhiên, chỉ bind 127.0.0.1)
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const code = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (u.searchParams.get("state") !== state) { res.writeHead(400).end("State không khớp."); reject(new Error("State không khớp (có thể bị giả mạo).")); server.close(); return; }
      const err = u.searchParams.get("error");
      const c = u.searchParams.get("code");
      if (err || !c) { res.writeHead(400).end(`Lỗi từ IdP: ${err}`); reject(new Error(`IdP trả lỗi: ${err} ${u.searchParams.get("error_description") ?? ""}`)); server.close(); return; }
      res.end("<h3>Đăng nhập xong. Quay lại cửa sổ dòng lệnh.</h3>");
      resolve({ code: c, redirectUri: `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback` });
      server.close();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const url = new URL(oidc.authorization_endpoint);
      url.search = new URLSearchParams({
        response_type: "code", client_id: disc.auth!.clientId, redirect_uri: redirectUri, scope: disc.auth!.scopes.join(" "),
        state, code_challenge: challenge, code_challenge_method: "S256", login_hint: email!,
      }).toString();
      console.log(`\nMở địa chỉ này để đăng nhập:\n${url.toString()}\n`);
      if (!flag("no-open")) exec(process.platform === "win32" ? `start "" "${url.toString()}"` : process.platform === "darwin" ? `open "${url.toString()}"` : `xdg-open "${url.toString()}"`);
      setTimeout(() => { reject(new Error("Hết 3 phút chờ đăng nhập.")); server.close(); }, 3 * 60_000).unref();
    });
  });

  // 4. đổi code lấy token (client công khai: chỉ cần code_verifier, không có client secret)
  const tok = await getJson<{ access_token: string; expires_in: number }>(oidc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: code.code, redirect_uri: code.redirectUri, client_id: disc.auth.clientId, code_verifier: verifier }),
  });
  console.log(`Đã nhận access token (hết hạn sau ${tok.expires_in}s).`);

  // 5. gói quyền đã ký
  const bundle = await getJson<SignedEntitlement>(`${CP}/v1/entitlements`, { headers: { authorization: `Bearer ${tok.access_token}`, "x-device-id": device } });
  const keys = (await getJson<{ keys: TrustedKey[] }>(`${CP}/v1/keys`)).keys;
  const r = verifyEntitlement(bundle, { trustedKeys: keys, expect: { deviceId: device, tenantId: bundle.payload.tenant.id } });
  if (!r.ok) throw new Error(`Gói quyền KHÔNG hợp lệ: ${r.reason} ${r.detail ?? ""}`);

  const p = r.payload;
  console.log("\n✔ Chữ ký gói quyền hợp lệ (Ed25519, khoá " + bundle.signature.keyId + ")");
  console.log(`  Người dùng : ${p.subject.label} <${p.subject.email}> — vai trò Hub: ${p.subject.hubRole}`);
  console.log(`  Phòng ban  : ${p.subject.departments.map((d) => d.name + (d.isManager ? " (TP)" : "")).join(", ") || "(chưa thuộc phòng nào)"}`);
  console.log(`  Phiên bản  : v${p.policyVersion} — hết hạn ${p.expiresAt}`);
  console.log("  App được cấp:");
  for (const a of p.apps) console.log(`    - ${a.label.padEnd(26)} ${p.access.effective[`origin:${a.origin}`]?.padEnd(3)}  ${a.origin}`);
  if (p.apps.length === 0) console.log("    (không có)");
  console.log(`  Quyền Hub  : ${p.roles.effective.can.join(", ")}  [trần tự chủ ${p.roles.effective.autonomyMax}]`);
}

main().catch((e) => {
  console.error("\n✘", (e as Error).message);
  process.exit(1);
});
