import { api, json } from "@/server/http";
import { publicKeys } from "@/server/services/entitlements";

/** GET /v1/keys  →  khoá công khai Ed25519 đang dùng để ký. Tiện cho dev; production Hub NHÚNG khoá trong bản build, không tin tải qua mạng. */
export const GET = api("keys", { max: 60, windowMs: 60_000 }, async () => json(publicKeys()));
