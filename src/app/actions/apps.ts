"use server";

import { requireActor, runAction } from "@/server/session";
import { createApp, deleteApp, updateApp } from "@/server/services/apps";
import { setDepartmentAppLevel } from "@/server/services/access";
import type { ActionResult } from "@/lib/action-result";

export async function saveAppAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const id = String(formData.get("id") ?? "");
    const input = {
      name: String(formData.get("name") ?? ""),
      origin: String(formData.get("origin") ?? ""),
      icon: String(formData.get("icon") ?? "Globe"),
      color: String(formData.get("color") ?? "#4f46e5"),
      tags: String(formData.get("tags") ?? ""),
      maxLevel: String(formData.get("maxLevel") ?? "M1"),
      status: String(formData.get("status") ?? "active"),
    };
    if (id) {
      const r = await updateApp(actor, id, input);
      return { message: r.clamped > 0 ? `Đã cập nhật app. ${r.clamped} phòng bị hạ mức xuống theo trần mới.` : "Đã cập nhật app." };
    }
    await createApp(actor, input);
    return { message: "Đã thêm app vào danh mục." };
  });
}

export async function deleteAppAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await deleteApp(await requireActor(), String(formData.get("id") ?? ""));
    return { message: "Đã xoá app khỏi danh mục." };
  });
}

/** Gọi từ ô chọn mức trong ma trận (không qua <form>), nên nhận đối số thường. */
export async function setLevelAction(deptId: string, appId: string, level: string): Promise<ActionResult> {
  return runAction(async () => {
    await setDepartmentAppLevel(await requireActor(), String(deptId), String(appId), String(level));
    return { message: "Đã lưu quyền." };
  });
}
