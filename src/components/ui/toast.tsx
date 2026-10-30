"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastKind = "success" | "error";
interface ToastItem { id: number; kind: ToastKind; message: string }

const EVENT = "cp:toast";

/** Hiện thông báo nhỏ ở góc dưới — gọi được từ mọi Client Component. */
export function toast(message: string, kind: ToastKind = "success"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, kind } }));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const { message, kind } = (e as CustomEvent<{ message: string; kind: ToastKind }>).detail;
      const id = ++n;
      setItems((cur) => [...cur.slice(-3), { id, kind, message }]);
      window.setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3800);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={cn(
            "cp-toast pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-white p-3.5 text-sm shadow-pop",
            "animate-[cp-toast_0.2s_ease-out]",
            t.kind === "error" ? "border-rose-200" : "border-emerald-200",
          )}
        >
          {t.kind === "error" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
          <p className="min-w-0 flex-1 leading-snug text-slate-700">{t.message}</p>
          <button type="button" aria-label="Đóng" className="text-slate-400 hover:text-slate-700" onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
