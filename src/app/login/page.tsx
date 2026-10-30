import { redirect } from "next/navigation";
import { ShieldCheck, Sparkles } from "lucide-react";
import { db } from "@/server/db";
import { getActor } from "@/server/session";
import { devLoginAction } from "@/app/actions/auth";
import { Avatar } from "@/components/ui/primitives";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { platform_admin: "Quản trị nền tảng", tenant_admin: "Quản trị tổ chức" };

export default async function LoginPage() {
  if (await getActor()) redirect("/");
  const devLogin = process.env.CP_DEV_LOGIN === "1" && process.env.NODE_ENV !== "production";
  let accounts: { email: string; name: string; admin_role: string; tenant: string | null; manages: string | null; hub_role: string }[] = [];
  let dbError: string | null = null;
  try {
    const d = await db();
    if (devLogin)
      accounts = await d.q(
        `SELECT u.email, u.display_name AS name, u.admin_role, u.hub_role, t.name AS tenant,
                (SELECT string_agg(dp.name, ', ') FROM departments dp WHERE dp.manager_user_id = u.id) AS manages
           FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.seeded = true AND u.status = 'active'
          ORDER BY (u.admin_role = 'platform_admin') DESC, t.name NULLS FIRST, (u.admin_role = 'tenant_admin') DESC, u.display_name`,
      );
  } catch (e) {
    dbError = (e as Error).message;
  }

  const groups = new Map<string, typeof accounts>();
  for (const a of accounts) groups.set(a.tenant ?? "Nexlab (vận hành nền tảng)", [...(groups.get(a.tenant ?? "Nexlab (vận hành nền tảng)") ?? []), a]);

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(420px,1fr)_minmax(520px,1.1fr)]">
      <section className="flex flex-col justify-between bg-gradient-to-br from-ink-950 via-ink-900 to-indigo-950 p-10 text-white">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-indigo-500 shadow-lg shadow-indigo-500/30"><ShieldCheck className="size-5" /></span>
          <span className="text-[15px] font-semibold tracking-tight">Nexlab Control Plane</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-semibold leading-[1.15] tracking-tight">Mỗi phòng ban một bộ app.<br />Mỗi người đúng quyền của mình.</h1>
          <p className="mt-5 text-[15px] leading-relaxed text-slate-300">
            Quản trị viên khai báo danh mục app và phòng ban. Trưởng phòng chỉ chọn trong danh mục đó. Hub chỉ nhận đúng phần quyền của từng người.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            {["Tách dữ liệu theo tổ chức (tenant)", "Trưởng phòng không thêm app, không sửa thành viên", "Mọi thay đổi đều có nhật ký và có thể xem trước"].map((t) => (
              <li key={t} className="flex items-center gap-2.5"><Sparkles className="size-4 text-indigo-300" /> {t}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">Bản chạy local · dữ liệu mẫu cho phát triển</p>
      </section>

      <section className="flex items-center justify-center bg-white px-6 py-10">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Đăng nhập</h2>
          <p className="mt-1.5 text-sm text-slate-500">Dùng email công ty được cấp để vào bảng quản trị.</p>
          {dbError && (
            <p role="alert" className="mt-5 rounded-lg bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              Không kết nối được cơ sở dữ liệu. Chạy <code className="rounded bg-amber-100 px-1">docker compose up -d</code> rồi tải lại trang.
            </p>
          )}
          <LoginForm />

          {devLogin && accounts.length > 0 && (
            <div className="mt-8">
              <div className="mb-3 flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Đăng nhập nhanh · tài khoản mẫu (dev)</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="max-h-[360px] space-y-4 overflow-y-auto pr-1 cp-scroll">
                {[...groups.entries()].map(([tenant, list]) => (
                  <div key={tenant}>
                    <p className="mb-1.5 text-xs font-semibold text-slate-500">{tenant}</p>
                    <div className="space-y-1.5">
                      {list.map((a) => (
                        <form key={a.email} action={devLoginAction}>
                          <input type="hidden" name="email" value={a.email} />
                          <button type="submit" className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50">
                            <Avatar name={a.name} size="sm" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-slate-800">{a.name}</span>
                              <span className="block truncate text-xs text-slate-500">{a.email}</span>
                            </span>
                            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              {ROLE_LABEL[a.admin_role] ?? (a.manages ? `Trưởng phòng ${a.manages}` : a.hub_role === "viewer" ? "Chỉ đọc" : "Nhân viên")}
                            </span>
                          </button>
                        </form>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
