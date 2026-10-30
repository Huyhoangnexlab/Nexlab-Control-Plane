import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEV_PASSWORD, HUB_CLIENT_ID, KEYCLOAK_REALMS } from "../src/server/seed-data";

/**
 * Sinh file import realm cho Keycloak từ dữ liệu mẫu (seed-data.ts) → tài khoản Keycloak và Control Plane luôn khớp.
 * Dùng:  npm run keycloak:gen      (rồi xoá volume Keycloak nếu muốn import lại:  docker compose rm -sfv keycloak)
 *
 * CẢNH BÁO: file sinh ra chứa mật khẩu mẫu của người dùng dev và bật Direct Access Grants (đăng nhập bằng mật khẩu
 * qua API — chỉ để chạy test tự động). KHÔNG dùng cấu hình này ở production.
 */
const outDir = path.join(process.cwd(), "keycloak", "realms");
mkdirSync(outDir, { recursive: true });

for (const r of KEYCLOAK_REALMS) {
  const realm = {
    realm: r.realm,
    displayName: r.displayName,
    enabled: true,
    sslRequired: "none", // dev: http://localhost
    registrationAllowed: false,
    registrationEmailAsUsername: true,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: false,
    editUsernameAllowed: false,
    bruteForceProtected: true,
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1800,
    ssoSessionMaxLifespan: 36000,
    groups: r.groups.map((name) => ({ name })),
    clients: [
      {
        clientId: HUB_CLIENT_ID,
        name: "Nexlab Hub",
        enabled: true,
        protocol: "openid-connect",
        publicClient: true,
        standardFlowEnabled: true,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: true, // chỉ dev/test
        serviceAccountsEnabled: false,
        // RFC 8252: app cài trên máy dùng redirect loopback (cổng ngẫu nhiên). Keycloak chỉ cho wildcard ở cuối URI.
        redirectUris: ["http://127.0.0.1:*", "http://localhost:*"],
        webOrigins: [],
        fullScopeAllowed: true,
        attributes: { "pkce.code.challenge.method": "S256" },
        defaultClientScopes: ["web-origins", "acr", "profile", "roles", "basic", "email"],
        optionalClientScopes: ["offline_access"],
        protocolMappers: [
          {
            name: "groups",
            protocol: "openid-connect",
            protocolMapper: "oidc-group-membership-mapper",
            consentRequired: false,
            config: {
              "full.path": "false",
              "id.token.claim": "true",
              "access.token.claim": "true",
              "userinfo.token.claim": "true",
              "claim.name": "groups",
            },
          },
        ],
      },
    ],
    users: r.users.map((u) => {
      const [first, ...rest] = u.name.replace(/\s*\(.*?\)\s*/g, " ").trim().split(/\s+/);
      return {
        username: u.email,
        email: u.email,
        emailVerified: true,
        enabled: true,
        firstName: first,
        lastName: rest.join(" ") || "-",
        credentials: [{ type: "password", value: DEV_PASSWORD, temporary: false }],
        groups: u.groups.map((g) => `/${g}`),
      };
    }),
  };
  const file = path.join(outDir, `${r.realm}-realm.json`);
  writeFileSync(file, JSON.stringify(realm, null, 2) + "\n");
  console.log("Đã ghi", path.relative(process.cwd(), file), `(${r.users.length} người dùng, ${r.groups.length} nhóm)`);
}
