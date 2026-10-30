import { z } from "zod";
import { db, tx } from "../db";
import { requirePlatform, type Actor } from "../actor";
import { bumpPolicy, writeAudit } from "../audit";
import { conflict, invalid, notFound } from "../errors";
import { discoverJwksUri, normalizeIssuer } from "../oidc";
import { parseInput } from "../validate";

export interface IdpView {
  issuer: string;
  clientId: string;
  groupsClaim: string;
  syncGroups: boolean;
  jit: boolean;
}

type Raw = { issuer: string; client_id: string; groups_claim: string; sync_groups: boolean; jit_provisioning: boolean };
const map = (r: Raw): IdpView => ({ issuer: r.issuer, clientId: r.client_id, groupsClaim: r.groups_claim, syncGroups: r.sync_groups, jit: r.jit_provisioning });

/** Đọc cấu hình SSO: quản trị nền tảng xem mọi tenant; người trong tenant chỉ xem tenant của mình (chỉ-đọc). */
export async function getIdp(actor: Actor, tenantId: string): Promise<IdpView | null> {
  if (actor.adminRole !== "platform_admin" && actor.tenantId !== tenantId) throw notFound("Không tìm thấy tổ chức.");
  const r = await (await db()).one<Raw>("SELECT issuer, client_id, groups_claim, sync_groups, jit_provisioning FROM identity_providers WHERE tenant_id = $1", [tenantId]);
  return r ? map(r) : null;
}

const schema = z.object({
  issuer: z.string(),
  clientId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,100}$/, "Client ID chỉ gồm chữ, số và . _ : -"),
  groupsClaim: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,60}$/, "Tên claim chỉ gồm chữ, số và . _ : -").default("groups"),
  syncGroups: z.boolean(),
  jit: z.boolean(),
});

/**
 * Khai báo / sửa IdP của một tenant — CHỈ quản trị nền tảng. Tin một issuer nghĩa là: mọi token nó ký cho client này
 * được coi là người của tenant, và server sẽ tải khoá (JWKS) từ địa chỉ đó. Vì vậy phải kiểm tra kết nối được trước khi lưu.
 */
export async function setIdp(actor: Actor, tenantId: string, input: unknown): Promise<void> {
  requirePlatform(actor);
  const v = parseInput(schema, input);
  const n = normalizeIssuer(v.issuer, { allowDev: process.env.CP_ALLOW_DEV_ORIGINS === "1" });
  if (!n.ok) throw invalid(n.error, { issuer: n.error });
  try {
    await discoverJwksUri(n.issuer);
  } catch (e) {
    throw invalid(`Không kiểm tra được nhà cung cấp danh tính: ${(e as Error).message}`, { issuer: "Không kết nối / discovery không hợp lệ." });
  }
  await tx(async (t) => {
    const ten = await t.one<{ name: string }>("SELECT name FROM tenants WHERE id = $1", [tenantId]);
    if (!ten) throw notFound("Không tìm thấy tổ chức.");
    const clash = await t.one("SELECT 1 FROM identity_providers WHERE issuer = $1 AND tenant_id <> $2", [n.issuer, tenantId]);
    if (clash) throw conflict("Issuer này đang được tổ chức khác dùng.");
    const before = await t.one("SELECT issuer, client_id, sync_groups, jit_provisioning FROM identity_providers WHERE tenant_id = $1", [tenantId]);
    await t.q(
      `INSERT INTO identity_providers (tenant_id, issuer, client_id, groups_claim, sync_groups, jit_provisioning) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id) DO UPDATE SET issuer = EXCLUDED.issuer, client_id = EXCLUDED.client_id, groups_claim = EXCLUDED.groups_claim,
         sync_groups = EXCLUDED.sync_groups, jit_provisioning = EXCLUDED.jit_provisioning`,
      [tenantId, n.issuer, v.clientId, v.groupsClaim, v.syncGroups, v.jit],
    );
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, {
      tenantId, action: "tenant.idp_set", targetType: "tenant", targetId: tenantId,
      summary: `Cấu hình SSO cho «${ten.name}»: ${n.issuer} (đồng bộ nhóm ${v.syncGroups ? "bật" : "tắt"}, tự tạo tài khoản ${v.jit ? "bật" : "tắt"})`,
      before, after: { issuer: n.issuer, clientId: v.clientId, syncGroups: v.syncGroups, jit: v.jit },
    });
  });
}

/** Gỡ SSO: tenant quay về đăng nhập cục bộ (chỉ khi máy chủ cho phép token cục bộ). */
export async function removeIdp(actor: Actor, tenantId: string): Promise<void> {
  requirePlatform(actor);
  await tx(async (t) => {
    const cur = await t.one<{ issuer: string }>("DELETE FROM identity_providers WHERE tenant_id = $1 RETURNING issuer", [tenantId]);
    if (!cur) throw notFound("Tổ chức này chưa cấu hình SSO.");
    await bumpPolicy(t, tenantId);
    await writeAudit(t, actor, { tenantId, action: "tenant.idp_remove", targetType: "tenant", targetId: tenantId, summary: `Gỡ cấu hình SSO (${cur.issuer})` });
  });
}
