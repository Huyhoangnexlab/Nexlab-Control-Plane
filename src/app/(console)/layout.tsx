import type { ReactNode } from "react";
import {
  BookOpen, Building, Building2, ClipboardList, Eye, Grid3x3, LayoutDashboard, LogOut, Network, Settings, ShieldCheck, UserCircle, Users,
} from "lucide-react";
import { isDeptManager, isPlatformAdmin, isTenantAdmin } from "@/server/actor";
import { requireActor } from "@/server/session";
import { logoutAction } from "@/app/actions/auth";
import { NavLink } from "@/components/nav-link";
import { Avatar } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  const platform = isPlatformAdmin(actor);
  const admin = isTenantAdmin(actor);
  const manager = isDeptManager(actor);
  const ic = "size-[18px]";

  const nav: { href: string; label: string; icon: ReactNode }[] = [];
  if (platform) {
    nav.push({ href: "/", label: "Tổng quan", icon: <LayoutDashboard className={ic} /> });
    nav.push({ href: "/tenants", label: "Tổ chức (tenant)", icon: <Building2 className={ic} /> });
    nav.push({ href: "/audit", label: "Nhật ký nền tảng", icon: <ClipboardList className={ic} /> });
  } else if (admin) {
    nav.push({ href: "/", label: "Tổng quan", icon: <LayoutDashboard className={ic} /> });
    nav.push({ href: "/users", label: "Người dùng", icon: <Users className={ic} /> });
    nav.push({ href: "/departments", label: "Phòng ban", icon: <Network className={ic} /> });
    nav.push({ href: "/apps", label: "Danh mục app", icon: <Grid3x3 className={ic} /> });
    nav.push({ href: "/access", label: "Phân quyền app", icon: <ShieldCheck className={ic} /> });
    nav.push({ href: "/preview", label: "Xem trước quyền", icon: <Eye className={ic} /> });
    nav.push({ href: "/audit", label: "Nhật ký", icon: <ClipboardList className={ic} /> });
    nav.push({ href: "/settings", label: "Cài đặt tổ chức", icon: <Settings className={ic} /> });
  } else if (manager) {
    nav.push({ href: "/", label: "Tổng quan", icon: <LayoutDashboard className={ic} /> });
    nav.push({ href: "/departments", label: "Phòng của tôi", icon: <Building className={ic} /> });
    nav.push({ href: "/access", label: "Phân quyền app", icon: <ShieldCheck className={ic} /> });
    nav.push({ href: "/preview", label: "Xem trước quyền", icon: <Eye className={ic} /> });
    nav.push({ href: "/audit", label: "Nhật ký phòng", icon: <ClipboardList className={ic} /> });
  }
  nav.push({ href: "/help", label: "Hướng dẫn", icon: <BookOpen className={ic} /> });
  nav.push({ href: "/me", label: "Tài khoản của tôi", icon: <UserCircle className={ic} /> });

  const roleLabel = platform ? "Quản trị nền tảng" : admin ? "Quản trị tổ chức" : manager ? "Trưởng phòng" : "Nhân viên";

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-ink-950 px-3.5 py-5 md:flex">
        <div className="mb-7 flex items-center gap-2.5 px-2">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-400 to-indigo-600 shadow-lg shadow-indigo-900/40">
            <ShieldCheck className="size-5 text-white" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">Control Plane</p>
            <p className="max-w-[10.5rem] truncate text-xs text-slate-400">{actor.tenantName ?? "Nexlab"}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto" aria-label="Điều hướng chính">
          {nav.map((n) => (
            <NavLink key={n.href} {...n} />
          ))}
        </nav>
        <div className="mt-4 rounded-xl bg-white/5 p-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={actor.name} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-medium text-white">{actor.name}</p>
              <p className="truncate text-xs text-slate-400">{roleLabel}</p>
            </div>
          </div>
          <form action={logoutAction} className="mt-3">
            <button type="submit" className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/15">
              <LogOut className="size-3.5" /> Đăng xuất
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1200px] px-5 py-8 md:px-9">{children}</div>
      </main>
    </div>
  );
}
