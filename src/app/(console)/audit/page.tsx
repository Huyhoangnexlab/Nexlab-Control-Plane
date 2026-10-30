import Link from "next/link";
import { ClipboardList, Search } from "lucide-react";
import { guard, requireActor } from "@/server/session";
import { listAudit } from "@/server/services/audit-read";
import { Badge, buttonClass, Card, EmptyState, formatDateTime, PageHeader, type Tone } from "@/components/ui/primitives";

const GROUPS: { value: string; label: string }[] = [
  { value: "", label: "Mọi hành động" },
  { value: "access", label: "Quyền app" },
  { value: "user", label: "Người dùng" },
  { value: "department", label: "Phòng ban" },
  { value: "membership", label: "Thành viên" },
  { value: "app", label: "Danh mục app" },
  { value: "tenant", label: "Tổ chức / cấu hình" },
];

function tone(action: string): Tone {
  if (action.endsWith(".delete") || action.endsWith(".remove") || action.includes("clamp") || action.includes("cleared")) return "rose";
  if (action.endsWith(".create") || action.endsWith(".add")) return "emerald";
  if (action.startsWith("access")) return "violet";
  return "indigo";
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; action?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const rows = await guard(() => listAudit(actor, { q: sp.q, action: sp.action || undefined, limit: 200 }));
  const filtered = !!(sp.q || sp.action);
  return (
    <>
      <PageHeader title="Nhật ký" description="Mọi thay đổi về người dùng, phòng ban, app và quyền đều được ghi lại và không thể sửa hay xoá. Bạn chỉ thấy phần thuộc phạm vi của mình." />
      <Card className="overflow-hidden">
        <form className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 p-3.5">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input name="q" defaultValue={sp.q} placeholder="Tìm theo nội dung hoặc người thực hiện…" className="block h-9.5 w-full rounded-lg border-0 bg-slate-50 pl-9 pr-3 text-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-500" />
          </div>
          <select name="action" defaultValue={sp.action ?? ""} className="h-9.5 rounded-lg border-0 bg-slate-50 pr-8 text-sm ring-1 ring-inset ring-slate-200">
            {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
          <button type="submit" className={buttonClass("secondary")}>Lọc</button>
          {filtered && <Link href="/audit" className={buttonClass("ghost")}>Xoá lọc</Link>}
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Chưa có bản ghi nào" hint={filtered ? "Thử bỏ bớt điều kiện lọc." : undefined} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={tone(r.action)}>{r.action}</Badge>
                  <p className="text-sm text-slate-800">{r.summary}</p>
                </div>
                <p className="mt-1 text-xs text-slate-500">{r.actorEmail} · {formatDateTime(r.ts)}</p>
                {(r.before != null || r.after != null) && (
                  <details className="mt-1.5 text-xs text-slate-500">
                    <summary className="cursor-pointer select-none text-indigo-600 hover:text-indigo-500">Chi tiết thay đổi</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <pre className="overflow-x-auto rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-700 cp-scroll"><b className="mb-1 block font-sans text-slate-500">Trước</b>{r.before != null ? JSON.stringify(r.before, null, 2) : "—"}</pre>
                      <pre className="overflow-x-auto rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-700 cp-scroll"><b className="mb-1 block font-sans text-slate-500">Sau</b>{r.after != null ? JSON.stringify(r.after, null, 2) : "—"}</pre>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">Hiển thị {rows.length} bản ghi mới nhất{rows.length >= 200 ? " (tối đa 200)" : ""}</div>
      </Card>
    </>
  );
}
