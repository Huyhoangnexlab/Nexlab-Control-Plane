"use server";

import { requireActor, runAction } from "@/server/session";
import { createTenant, deleteTenant, updateOwnTenantSettings, updateTenant } from "@/server/services/tenants";
import { removeIdp, setIdp } from "@/server/services/identity-providers";
import type { ActionResult } from "@/lib/action-result";

export async function saveTenantAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const id = String(formData.get("id") ?? "");
    if (id) {
      await updateTenant(actor, id, { name: String(formData.get("name") ?? ""), status: String(formData.get("status") ?? "active") });
      return { message: "Đã cập nhật tổ chức." };
    }
    const r = await createTenant(actor, {
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      domain: String(formData.get("domain") ?? ""),
      adminName: String(formData.get("adminName") ?? ""),
      adminEmail: String(formData.get("adminEmail") ?? ""),
      adminPassword: String(formData.get("adminPassword") ?? ""),
    });
    return { message: `Đã tạo tổ chức «${r.tenant.name}» và tài khoản quản trị.`, data: { tempPassword: r.tempPassword } };
  });
}

export async function deleteTenantAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await deleteTenant(await requireActor(), String(formData.get("id") ?? ""), String(formData.get("confirmSlug") ?? ""));
    return { message: "Đã xoá tổ chức và toàn bộ dữ liệu của nó." };
  });
}

export async function saveIdpAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await setIdp(await requireActor(), String(formData.get("tenantId") ?? ""), {
      issuer: String(formData.get("issuer") ?? ""),
      clientId: String(formData.get("clientId") ?? ""),
      groupsClaim: String(formData.get("groupsClaim") ?? "") || "groups",
      syncGroups: formData.get("syncGroups") === "on",
      jit: formData.get("jit") === "on",
    });
    return { message: "Đã lưu cấu hình SSO. Từ giờ tổ chức này đăng nhập Hub qua nhà cung cấp danh tính." };
  });
}

export async function removeIdpAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await removeIdp(await requireActor(), String(formData.get("tenantId") ?? ""));
    return { message: "Đã gỡ cấu hình SSO." };
  });
}

export async function saveSettingsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await updateOwnTenantSettings(await requireActor(), {
      productName: String(formData.get("productName") ?? ""),
      accent: String(formData.get("accent") ?? ""),
      entitlementTtlHours: String(formData.get("entitlementTtlHours") ?? ""),
    });
    return { message: "Đã lưu cấu hình tổ chức." };
  });
}
