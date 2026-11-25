/**
 * App mạng nội bộ trong danh mục (25/11): luật địa chỉ (thuần) + cờ theo tổ chức chỉ quản trị NỀN TẢNG bật + tắt cờ thì app nội bộ bị
 * tắt + origin nội bộ đi vào gói quyền đã ký. Cần Postgres.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CP_DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
process.env.CP_ALLOW_DEV_ORIGINS = "0";
process.env.CP_SIGNING_KEY_PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
process.env.CP_SECRETS_KEY = randomBytes(32).toString("base64");

import { closeDb, db } from "@/server/db";
import { loadActor } from "@/server/actor";
import { AppError } from "@/server/errors";
import { seedDatabase } from "@/server/seed";
import { createApp, updateApp } from "@/server/services/apps";
import { getOwnTenant, updateTenant } from "@/server/services/tenants";
import { buildEntitlementPayload } from "@/server/services/entitlements";
import { hostKind, isPrivateNetworkOrigin, normalizeOrigin } from "@/lib/origin";

const actorOf = async (email: string) => {
  const r = (await (await db()).one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]))!;
  return (await loadActor(await db(), r.id))!;
};
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `lỗi lạ: ${String(e)}`));

describe("luật địa chỉ (thuần)", () => {
  it("phân loại tên máy", () => {
    for (const h of ["10.0.5.20", "172.16.0.1", "172.31.255.254", "192.168.1.10", "100.64.0.5"]) expect(hostKind(h), h).toBe("private-ip");
    for (const h of ["his.benhvien.local", "erp.corp", "nas.lan", "portal.internal", "his-server", "intranet"]) expect(hostKind(h), h).toBe("private-name");
    for (const h of ["localhost", "app.localhost", "127.0.0.1", "127.9.9.9", "[::1]"]) expect(hostKind(h), h).toBe("loopback");
    for (const h of ["169.254.169.254", "169.254.1.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "999.1.1.1"]) expect(hostKind(h), h).toBe("never");
    for (const h of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.1.1", "100.128.0.1", "11.0.0.1"]) expect(hostKind(h), h).toBe("public-ip");
    expect(hostKind("[fd00::1]")).toBe("ipv6");
    for (const h of ["crm.congty.vn", "demo.us.espocrm.com", "localhost.evil.com", "10.0.0.1.evil.com"]) expect(hostKind(h), h).toBe("public-name");
  });

  it("mặc định (không bật): mọi địa chỉ mạng nội bộ bị từ chối như trước; tên miền công khai chỉ HTTPS", () => {
    for (const bad of ["https://10.0.5.20", "http://10.0.5.20", "https://his.benhvien.local", "https://his-server", "http://192.168.1.10:8080"]) {
      expect(normalizeOrigin(bad).ok, bad).toBe(false);
    }
    expect(normalizeOrigin("https://crm.congty.vn/duong/dan?x=1")).toEqual({ ok: true, origin: "https://crm.congty.vn", privateNetwork: false });
    expect(normalizeOrigin("http://crm.congty.vn").ok).toBe(false);
    expect(normalizeOrigin("nexlab-app://hr")).toEqual({ ok: true, origin: "nexlab-app://hr", privateNetwork: false });
  });

  it("bật allowPrivate: nhận IP riêng / tên nội bộ, cả http lẫn https, giữ cổng; đánh dấu privateNetwork", () => {
    const o = { allowPrivate: true };
    expect(normalizeOrigin("http://10.0.5.20:8080/his/login", o)).toEqual({ ok: true, origin: "http://10.0.5.20:8080", privateNetwork: true });
    expect(normalizeOrigin("https://his.benhvien.local", o)).toEqual({ ok: true, origin: "https://his.benhvien.local", privateNetwork: true });
    expect(normalizeOrigin("http://his-server", o)).toEqual({ ok: true, origin: "http://his-server", privateNetwork: true });
    expect(normalizeOrigin("http://192.168.1.10", o)).toMatchObject({ ok: true, privateNetwork: true });
    // Tên miền công khai vẫn chỉ HTTPS, không bị coi là nội bộ.
    expect(normalizeOrigin("http://crm.congty.vn", o).ok).toBe(false);
    expect(normalizeOrigin("https://crm.congty.vn", o)).toMatchObject({ ok: true, privateNetwork: false });
  });

  it("KHÔNG BAO GIỜ nhận dù bật allowPrivate: loopback, link-local / metadata cloud, 0.0.0.0, multicast, IP công khai bằng số, IPv6, có tài khoản trong URL", () => {
    const o = { allowPrivate: true };
    for (const bad of [
      "http://localhost:3000", "http://127.0.0.1", "https://127.0.0.1", "http://[::1]:8080", "http://app.localhost",
      "http://169.254.169.254/latest/meta-data", "https://169.254.1.1", "http://0.0.0.0", "http://224.0.0.1", "http://255.255.255.255",
      "https://8.8.8.8", "http://8.8.8.8", "http://[fd00::1]", "http://admin:pass@10.0.5.20", "ftp://10.0.5.20", "javascript:alert(1)",
    ]) {
      expect(normalizeOrigin(bad, o).ok, bad).toBe(false);
    }
    // Chế độ lab (allowDev) vẫn nhận http://localhost như trước — độc lập với allowPrivate.
    expect(normalizeOrigin("http://localhost:3000", { allowDev: true })).toMatchObject({ ok: true, privateNetwork: false });
  });

  it("isPrivateNetworkOrigin", () => {
    expect(isPrivateNetworkOrigin("http://10.0.5.20:8080")).toBe(true);
    expect(isPrivateNetworkOrigin("https://his.benhvien.local")).toBe(true);
    expect(isPrivateNetworkOrigin("https://crm.congty.vn")).toBe(false);
    expect(isPrivateNetworkOrigin("nexlab-app://hr")).toBe(false);
    expect(isPrivateNetworkOrigin("không phải url")).toBe(false);
  });
});

describe("cờ «cho phép app mạng nội bộ» theo tổ chức", () => {
  beforeAll(async () => {
    await seedDatabase(await db());
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  const HIS = { name: "HIS nội bộ", origin: "http://10.0.5.20:8080", maxLevel: "M1" };

  it("mặc định tắt: quản trị tổ chức không thêm được app mạng nội bộ; tự bật cờ cũng không được (chỉ quản trị nền tảng)", async () => {
    const admin = await actorOf("admin@nexlab.tech");
    expect((await getOwnTenant(admin))?.allowPrivateApps).toBe(false);
    expect(await code(createApp(admin, HIS))).toBe("invalid");
    expect(await code(updateTenant(admin, admin.tenantId!, { name: "Nexlab", status: "active", allowPrivateApps: true }))).toBe("forbidden");
    expect((await getOwnTenant(admin))?.allowPrivateApps).toBe(false);
  });

  it("quản trị nền tảng bật cho MỘT tổ chức: tổ chức đó thêm được app nội bộ, tổ chức khác thì không; loopback / metadata vẫn bị từ chối; có audit", async () => {
    const platform = await actorOf("platform@nexlab.tech");
    const admin = await actorOf("admin@nexlab.tech");
    const other = await actorOf("admin@benhvien-b.test");
    await updateTenant(platform, admin.tenantId!, { name: "Nexlab", status: "active", allowPrivateApps: true });
    expect((await getOwnTenant(admin))?.allowPrivateApps).toBe(true);

    const id = await createApp(admin, HIS);
    const row = (await (await db()).one<{ origin: string; status: string }>("SELECT origin, status FROM catalog_apps WHERE id = $1", [id]))!;
    expect(row).toEqual({ origin: "http://10.0.5.20:8080", status: "active" });
    expect(await code(createApp(admin, { name: "Máy mình", origin: "http://127.0.0.1:3000", maxLevel: "M1" }))).toBe("invalid");
    expect(await code(createApp(admin, { name: "Metadata", origin: "http://169.254.169.254", maxLevel: "M1" }))).toBe("invalid");
    // Sửa app công khai sang địa chỉ nội bộ cũng đi qua cùng luật.
    expect(await code(updateApp(admin, id, { ...HIS, origin: "https://his.benhvien.local" }))).toBe("ok");

    expect(await code(createApp(other, HIS))).toBe("invalid"); // tổ chức khác chưa được bật

    const audits = await (await db()).q<{ action: string; summary: string }>("SELECT action, summary FROM audit_log WHERE action IN ('tenant.private_apps','app.create') ORDER BY id");
    expect(audits.some((a) => a.action === "tenant.private_apps" && /Cho phép/.test(a.summary))).toBe(true);
    expect(audits.some((a) => a.action === "app.create" && /mạng nội bộ/.test(a.summary))).toBe(true);
  });

  it("origin nội bộ nằm trong gói quyền của người được cấp app (Hub mở đúng địa chỉ đã ký)", async () => {
    const admin = await actorOf("admin@nexlab.tech");
    const d = await db();
    const app = (await d.one<{ id: string }>("SELECT id FROM catalog_apps WHERE tenant_id = $1 AND origin = $2", [admin.tenantId, "https://his.benhvien.local"]))!;
    const dept = (await d.one<{ department_id: string }>("SELECT department_id FROM memberships WHERE user_id = $1 LIMIT 1", [admin.userId]))!;
    await d.q("INSERT INTO department_apps (department_id, app_id, level) VALUES ($1,$2,'M1') ON CONFLICT (department_id, app_id) DO UPDATE SET level = 'M1'", [dept.department_id, app.id]);
    const payload = await buildEntitlementPayload(d, admin, "dev-priv-0001");
    expect(payload.apps.map((a) => a.origin)).toContain("https://his.benhvien.local");
    expect(payload.access.effective["origin:https://his.benhvien.local"]).toBe("M1");
  });

  it("tắt cờ là thu hẹp: app mạng nội bộ đang có bị TẮT, phiên bản chính sách tăng, không thêm lại được; form không nói tới cờ thì giữ nguyên", async () => {
    const platform = await actorOf("platform@nexlab.tech");
    const admin = await actorOf("admin@nexlab.tech");
    const d = await db();
    const before = (await d.one<{ policy_version: number }>("SELECT policy_version FROM tenants WHERE id = $1", [admin.tenantId]))!.policy_version;

    // Cập nhật không kèm cờ (vd đổi tên) → cờ giữ nguyên.
    await updateTenant(platform, admin.tenantId!, { name: "Nexlab", status: "active" });
    expect((await getOwnTenant(admin))?.allowPrivateApps).toBe(true);

    await updateTenant(platform, admin.tenantId!, { name: "Nexlab", status: "active", allowPrivateApps: false });
    expect((await getOwnTenant(admin))?.allowPrivateApps).toBe(false);
    const apps = await d.q<{ origin: string; status: string }>("SELECT origin, status FROM catalog_apps WHERE tenant_id = $1", [admin.tenantId]);
    expect(apps.find((a) => a.origin === "https://his.benhvien.local")?.status).toBe("disabled");
    expect(apps.filter((a) => !isPrivateNetworkOrigin(a.origin)).every((a) => a.status === "active")).toBe(true); // app công khai không bị đụng
    const after = (await d.one<{ policy_version: number }>("SELECT policy_version FROM tenants WHERE id = $1", [admin.tenantId]))!.policy_version;
    expect(after).toBeGreaterThan(before);
    expect(await code(createApp(admin, { name: "HIS 2", origin: "http://10.0.5.21", maxLevel: "M1" }))).toBe("invalid");

    // App đã tắt không còn trong gói quyền.
    const payload = await buildEntitlementPayload(d, admin, "dev-priv-0001");
    expect(payload.apps.map((a) => a.origin)).not.toContain("https://his.benhvien.local");
  });
});
