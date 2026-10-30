"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function NavLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-white/12 text-white shadow-[inset_2px_0_0_0_#818cf8]" : "text-slate-400 hover:bg-white/6 hover:text-slate-100",
      )}
    >
      <span className={cn("transition-colors", active ? "text-indigo-300" : "text-slate-500 group-hover:text-slate-300")}>{icon}</span>
      {label}
    </Link>
  );
}
