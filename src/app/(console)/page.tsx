import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, History } from "lucide-react";
import { requireActor } from "@/server/session";
import { getDashboard } from "@/server/services/dashboard";
import { listAudit } from "@/server/services/audit-read";
import { isDeptManager, isPlatformAdmin, isTenantAdmin } from "@/server/actor";
import { Badge, Card, formatDateTime, PageHeader, StatTile } from "@/components/ui/primitives";
import { db } from "@/server/db";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const stats = await getDashboard(actor);
  if (stats.kind === "member") redirect("/me");

  const recent = (await listAudit(actor, { limit: 8 }).catch(() => [])) ?? [];
  const attention: { text: string; href: string }[] = [];
  if (isTenantAdmin(actor)) {
    const d = await db();
    const noMgr = await d.q<{ name: string }>("SELECT name FROM departments WHERE tenant_id = $1 AND manager_user_id IS NULL ORDER BY name", [actor.tenantId]);
    for (const x of noMgr) attention.push({ text: `Phòng «${x.name}» chưa có trưởng phòng.`, href: "/departments" });
    const unused = await d.q<{ name: string }>("SELECT name FROM catalog_apps a WHERE tenant_id = $1 AND status = 'active' AND NOT EXISTS (SELECT 1 FROM department_apps da WHERE da.app_id = a.id) ORDER BY name", [actor.tenantId]);
    for (const x of unused) attention.push({ text: `App «${x.name}» chưa được cấp cho phòng nào.`, href: "/access" });
    const idle = await d.one<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND status = 'active' AND last_login_at IS NULL", [actor.tenantId]);
    if ((idle?.n ?? 0) > 0) attention.push({ text: `${idle!.n} tài khoản chưa đăng nhập lần nào.`, href: "/users" });
    const lone = await d.one<{ n: number }>("SELECT count(*)::int AS n FROM users u WHERE tenant_id = $1 AND status = 'active' AND admin_role = 'none' AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)", [actor.tenantId]);
    if ((lone?.n ?? 0) > 0) attention.push({ text: `${lone!.n} người chưa thuộc phòng ban nào — họ sẽ không thấy app nào.`, href: "/users" });
  }

  const greeting = isPlatformAdmin(actor) ? "Tình hình các tổ chức trên nền tảng." : isTenantAdmin(actor) ? `Tổng quan tổ chức ${actor.tenantName}.` : "Các phòng ban bạn đang quản lý.";

  return (
    <>
      {sp.denied && <p role="alert" className="mb-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">Bạn không có quyền xem trang đó. Các mục bạn dùng được nằm ở thanh bên trái.</p>}
      <PageHeader title={`Xin chào, ${actor.name.replace(/\(.*?\)/g, "").trim()}`} description={greeting} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.tiles.map((t) => (
          <StatTile key={t.label} {...t} />
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><History className="size-4 text-slate-400" /> Hoạt động gần đây</h2>
            <Link href="/audit" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500">Xem tất cả <ArrowRight className="size-3" /></Link>
          </div>
          {recent.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Chưa có hoạt động nào.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((r) => (
                <li key={r.id} className="px-5 py-3">
                  <p className="text-sm text-slate-800">{r.summary}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{r.actorEmail} · {formatDateTime(r.ts)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">{isTenantAdmin(actor) ? "Việc cần chú ý" : "Lối tắt"}</h2>
          </div>
          {isTenantAdmin(actor) ? (
            attention.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500">Mọi thứ đã gọn gàng — không có gì cần xử lý.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {attention.map((a) => (
                  <li key={a.text}>
                    <Link href={a.href} className="flex items-start justify-between gap-3 px-5 py-3 text-sm text-slate-700 hover:bg-slate-50">
                      <span>{a.text}</span>
                      <ArrowRight className="mt-0.5 size-4 shrink-0 text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="space-y-2 p-5 text-sm">
              {isPlatformAdmin(actor) ? (
                <Link href="/tenants" className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-3 hover:bg-slate-50">Quản lý tổ chức <ArrowRight className="size-4 text-slate-400" /></Link>
              ) : isDeptManager(actor) ? (
                <>
                  <Link href="/access" className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-3 hover:bg-slate-50">Chỉnh app cho phòng của tôi <ArrowRight className="size-4 text-slate-400" /></Link>
                  <Link href="/preview" className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-3 hover:bg-slate-50">Xem trước quyền của một thành viên <ArrowRight className="size-4 text-slate-400" /></Link>
                </>
              ) : null}
              <p className="pt-2"><Badge tone="indigo">Gợi ý</Badge> <span className="text-slate-500">Mọi thay đổi đều được ghi vào nhật ký và tăng phiên bản chính sách.</span></p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
