"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";
import { useSubmitAction } from "@/lib/use-submit-action";

export function SettingsForm({ action, initial }: { action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>; initial: { productName: string; accent: string; ttl: number } }) {
  const { state, onSubmit, pending } = useSubmitAction(action);
  useEffect(() => {
    if (state?.ok) toast(state.message ?? "Đã lưu.");
  }, [state]);
  const err = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const input = "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-indigo-500";
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="productName" className="mb-1.5 block text-[13px] font-medium text-slate-700">Tên hiển thị trong Hub</label>
        <input id="productName" name="productName" defaultValue={initial.productName} placeholder="Nexlab Hub" className={`${input} ${err.productName ? "ring-rose-400" : "ring-slate-300"}`} />
        <p className="mt-1 text-xs text-slate-500">{err.productName ?? "Hiện ở thanh tiêu đề và màn đăng nhập của Hub."}</p>
      </div>
      <div>
        <label htmlFor="accent" className="mb-1.5 block text-[13px] font-medium text-slate-700">Màu chủ đạo</label>
        <input id="accent" name="accent" type="color" defaultValue={initial.accent} className="h-10 w-20 cursor-pointer rounded-lg border-0 bg-white p-1 ring-1 ring-inset ring-slate-300" />
      </div>
      <div>
        <label htmlFor="ttl" className="mb-1.5 block text-[13px] font-medium text-slate-700">Thời hạn gói quyền (giờ)</label>
        <input id="ttl" name="entitlementTtlHours" type="number" min={1} max={168} defaultValue={initial.ttl} className={`${input} w-40 ${err.entitlementTtlHours ? "ring-rose-400" : "ring-slate-300"}`} />
        <p className="mt-1 text-xs text-slate-500">{err.entitlementTtlHours ?? "Hub làm mới gói quyền định kỳ; mất kết nối quá thời hạn này thì Hub chỉ cho mở app, tắt agent. Ngắn hơn = thu hồi quyền nhanh hơn."}</p>
      </div>
      {state && !state.ok && Object.keys(state.fieldErrors ?? {}).length === 0 && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{state.error}</p>}
      <button type="submit" disabled={pending} className={buttonClass("primary")}>
        {pending && <Loader2 className="size-4 animate-spin" />} Lưu cấu hình
      </button>
    </form>
  );
}
