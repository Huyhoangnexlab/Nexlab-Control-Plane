"use server";

import { requireActor, runAction } from "@/server/session";
import { addMember, createDepartment, deleteDepartment, removeMember, updateDepartment } from "@/server/services/departments";
import type { ActionResult } from "@/lib/action-result";

export async function saveDepartmentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const id = String(formData.get("id") ?? "");
    const input = {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      managerUserId: String(formData.get("managerUserId") ?? ""),
      idpGroup: String(formData.get("idpGroup") ?? ""),
    };
    if (id) {
      await updateDepartment(actor, id, input);
      return { message: "Đã cập nhật phòng ban." };
    }
    await createDepartment(actor, input);
    return { message: "Đã tạo phòng ban." };
  });
}

export async function deleteDepartmentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await deleteDepartment(await requireActor(), String(formData.get("id") ?? ""));
    return { message: "Đã xoá phòng ban." };
  });
}

export async function addMemberAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const deptId = String(formData.get("deptId") ?? "");
    const userIds = formData.getAll("userIds").map(String);
    if (userIds.length === 0) throw new (await import("@/server/errors")).AppError("invalid", "Chọn ít nhất một người.");
    for (const u of userIds) await addMember(actor, deptId, u);
    return { message: `Đã thêm ${userIds.length} thành viên.` };
  });
}

export async function removeMemberAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await removeMember(await requireActor(), String(formData.get("deptId") ?? ""), String(formData.get("userId") ?? ""));
    return { message: "Đã bỏ khỏi phòng ban." };
  });
}
