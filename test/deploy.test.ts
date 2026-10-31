import { describe, expect, it } from "vitest";
import { assertProductionConfig } from "@/server/db";

const prodOk = { NODE_ENV: "production", DATABASE_URL: "postgres://x", CP_SIGNING_KEY_PEM: "pem", CP_SECRETS_KEY: "k" } as unknown as NodeJS.ProcessEnv;

describe("cấu hình production", () => {
  it("không phải production → không kiểm gì", () => {
    expect(() => assertProductionConfig({ NODE_ENV: "development", CP_DEV_LOGIN: "1" } as unknown as NodeJS.ProcessEnv)).not.toThrow();
  });
  it("production hợp lệ → qua", () => {
    expect(() => assertProductionConfig(prodOk)).not.toThrow();
  });
  it("production mà còn cờ dev (đăng nhập nhanh / origin localhost / token mật khẩu) → TỪ CHỐI chạy", () => {
    for (const flag of ["CP_DEV_LOGIN", "CP_ALLOW_DEV_ORIGINS", "CP_LOCAL_HUB_TOKENS"])
      expect(() => assertProductionConfig({ ...prodOk, [flag]: "1" } as NodeJS.ProcessEnv), flag).toThrow(flag);
  });
  it("production thiếu khoá ký hoặc DATABASE_URL → từ chối", () => {
    expect(() => assertProductionConfig({ NODE_ENV: "production", DATABASE_URL: "x" } as unknown as NodeJS.ProcessEnv)).toThrow(/CP_SIGNING_KEY_PEM/);
    expect(() => assertProductionConfig({ NODE_ENV: "production", CP_SIGNING_KEY_PEM: "x", CP_SECRETS_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(() => assertProductionConfig({ NODE_ENV: "production", DATABASE_URL: "x", CP_SIGNING_KEY_PEM: "x" } as unknown as NodeJS.ProcessEnv)).toThrow(/CP_SECRETS_KEY/);
  });
});
