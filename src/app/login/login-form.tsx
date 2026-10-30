"use client";

import { Loader2, LogIn } from "lucide-react";
import { loginAction } from "@/app/actions/auth";
import { useSubmitAction } from "@/lib/use-submit-action";

export function LoginForm() {
  const { state, onSubmit, pending } = useSubmitAction(loginAction);
  const input = "block w-full rounded-lg border-0 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500";
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-slate-700">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" placeholder="ten@congty.vn" className={input} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-slate-700">Mật khẩu</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className={input} />
      </div>
      {state && !state.ok && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{state.error}</p>}
      <button type="submit" disabled={pending} className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:bg-indigo-300">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
        Đăng nhập
      </button>
    </form>
  );
}
