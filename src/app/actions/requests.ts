"use server";

import { requireActor, runAction } from "@/server/session";
import { resolveAccessRequest } from "@/server/services/requests";
import type { ActionResult } from "@/lib/action-result";

export async function resolveRequestAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await resolveAccessRequest(await requireActor(), {
      id: String(formData.get("id") ?? ""),
      status: String(formData.get("status") ?? ""),
      note: String(formData.get("note") ?? ""),
    });
    return { message: "Đã cập nhật yêu cầu." };
  });
}
