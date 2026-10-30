import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "test/server-only-stub.ts") } },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Test không cần Keycloak: seed không khai báo IdP (test SSO tự dựng IdP giả).
    env: { CP_SEED_IDP: "0" },
  },
});
