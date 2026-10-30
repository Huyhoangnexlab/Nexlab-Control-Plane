"use server";

import { requireActor, runAction } from "@/server/session";
import { createUser, deleteUser, resetPassword, updateUser, changeOwnPassword } from "@/server/services/users";
import type { ActionResult } from "@/lib/action-result";

export async function saveUserAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const id = String(formData.get("id") ?? "");
    const input = {
      email: String(formData.get("email") ?? ""),
      name: String(formData.get("name") ?? ""),
      password: String(formData.get("password") ?? ""),
      hubRole: String(formData.get("hubRole") ?? "member"),
      adminRole: String(formData.get("adminRole") ?? "none"),
      status: String(formData.get("status") ?? "active"),
      deptIds: formData.getAll("deptIds").map(String),
    };
    if (id) {
      await updateUser(actor, id, input);
      return { message: "Đã cập nhật tài khoản." };
    }
    const r = await createUser(actor, input);
    return { message: `Đã tạo tài khoản ${r.user.email}.`, data: { tempPassword: r.tempPassword } };
  });
}

export async function resetPasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const r = await resetPassword(actor, String(formData.get("id") ?? ""), String(formData.get("password") ?? ""));
    return { message: r.tempPassword ? "Đã đặt lại mật khẩu. Người dùng bị đăng xuất khỏi mọi thiết bị." : "Đã đặt mật khẩu mới.", data: { tempPassword: r.tempPassword } };
  });
}

export async function deleteUserAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await deleteUser(actor, String(formData.get("id") ?? ""));
    return { message: "Đã xoá tài khoản." };
  });
}

export async function changePasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await changeOwnPassword(actor, { current: String(formData.get("current") ?? ""), next: String(formData.get("next") ?? "") });
    return { message: "Đã đổi mật khẩu." };
  });
}
