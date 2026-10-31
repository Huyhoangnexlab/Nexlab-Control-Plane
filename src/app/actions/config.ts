"use server";

import { requireActor, runAction } from "@/server/session";
import { clearConfig, clearSecret, setConfig, setSecret } from "@/server/services/config";
import type { ActionResult } from "@/lib/action-result";

export async function saveConfigAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await setConfig(await requireActor(), {
      key: String(formData.get("key") ?? ""),
      value: String(formData.get("value") ?? ""),
      locked: formData.get("locked") === "on",
      deptId: String(formData.get("deptId") ?? ""),
    });
    return { message: "Đã lưu cấu hình. Hub của người dùng cập nhật ở lần làm mới kế tiếp." };
  });
}

export async function clearConfigAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await clearConfig(await requireActor(), { key: String(formData.get("key") ?? ""), deptId: String(formData.get("deptId") ?? "") });
    return { message: "Đã bỏ giá trị." };
  });
}

export async function saveSecretAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await setSecret(await requireActor(), {
      key: String(formData.get("key") ?? ""),
      value: String(formData.get("value") ?? ""),
      roles: formData.getAll("roles").map(String),
    });
    return { message: "Đã lưu khoá. Giá trị được mã hoá và không xem lại được." };
  });
}

export async function clearSecretAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await clearSecret(await requireActor(), { key: String(formData.get("key") ?? "") });
    return { message: "Đã xoá khoá khỏi kho bí mật." };
  });
}
