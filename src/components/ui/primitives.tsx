import type { ReactNode } from "react";
import {
  BarChart3, Briefcase, Building2, Clock, FileText, Globe, Headphones, Package, ShieldCheck, Stethoscope, Users, Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { LEVEL_LABEL, type Level } from "@/lib/levels";

export type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
export type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-indigo-300",
  secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  soft: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40",
  danger: "bg-rose-600 text-white shadow-sm hover:bg-rose-500 active:bg-rose-700 disabled:bg-rose-300",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string): string {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed",
    size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9.5 px-3.5 text-sm",
    VARIANT[variant],
    className,
  );
}

const TONE = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  cyan: "bg-cyan-50 text-cyan-800 ring-cyan-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
} as const;
export type Tone = keyof typeof TONE;

export function Badge({ tone = "slate", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

const LEVEL_TONE: Record<Level, Tone> = { none: "slate", open: "slate", ask: "cyan", M0: "indigo", M1: "violet", M2: "emerald", M3: "amber" };
export const levelTone = (l: Level): Tone => LEVEL_TONE[l];

export function LevelBadge({ level }: { level: Level }) {
  return <Badge tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</Badge>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-slate-200/80 bg-white shadow-card", className)}>{children}</section>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon: Icon = Package, title, hint, action }: { icon?: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
        <Icon className="size-6" />
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const AVATAR_COLORS = ["bg-indigo-100 text-indigo-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-700", "bg-cyan-100 text-cyan-800", "bg-violet-100 text-violet-700"];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold", AVATAR_COLORS[h % AVATAR_COLORS.length], size === "sm" ? "size-7 text-[11px]" : size === "lg" ? "size-11 text-sm" : "size-9 text-xs")}>
      {initials}
    </span>
  );
}

const ICONS: Record<string, LucideIcon> = { Globe, Users, Wallet, Briefcase, Clock, Building2, ShieldCheck, FileText, BarChart3, Stethoscope, Headphones, Package };

export function AppIcon({ icon, color, size = "md" }: { icon: string; color: string; size?: "sm" | "md" | "lg" }) {
  const Icon = ICONS[icon] ?? Globe;
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-xl text-white shadow-sm", size === "sm" ? "size-7 rounded-lg" : size === "lg" ? "size-11" : "size-9")}
      style={{ backgroundColor: color }}
    >
      <Icon className={size === "sm" ? "size-3.5" : size === "lg" ? "size-5.5" : "size-4.5"} strokeWidth={2} />
    </span>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "Chưa đăng nhập";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d} ngày trước` : formatDateTime(iso);
}
