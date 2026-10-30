import { Fragment } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Check, Minus } from "lucide-react";
import { requireActor } from "@/server/session";
import { audienceOf, DOCS, slugify, START_HERE, type HelpAudience } from "@/server/docs";
import { Badge, Card, PageHeader, type Tone } from "@/components/ui/primitives";
import { HUB_ROLE_ORDER, PERMS, PERM_INFO, ROLE_AUTONOMY_MAX, ROLE_PERMS, type Risk } from "@/lib/hub-permissions";
import { HUB_ROLE_LABEL } from "@/lib/validators";

const AUDIENCE_LABEL: Record<HelpAudience, string> = {
  platform: "quản trị nền tảng",
  tenant_admin: "quản trị tổ chức",
  manager: "trưởng phòng",
  member: "nhân viên",
};
const RISK: Record<Risk, { label: string; tone: Tone }> = { cao: { label: "Cao", tone: "rose" }, "trung-binh": { label: "Trung bình", tone: "amber" }, thap: { label: "Thấp", tone: "slate" } };

export default async function HelpPage() {
  const actor = await requireActor();
  const audience = audienceOf(actor);
  const groups = [...new Set(PERMS.map((p) => PERM_INFO[p].group))];

  return (
    <>
      <PageHeader title="Hướng dẫn" description="Tài liệu của Control Plane ngay trong ứng dụng. Nội dung lấy trực tiếp từ thư mục docs của dự án nên luôn khớp với bản đang chạy." />

      <Card className="mb-6 bg-gradient-to-br from-indigo-50 to-white p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Dành cho bạn · {AUDIENCE_LABEL[audience]}</p>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {START_HERE[audience].map((s) => (
            <Link key={`${s.slug}#${s.heading ?? ""}`} href={`/help/${s.slug}${s.heading ? `#${slugify(s.heading)}` : ""}`} className="group flex items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm transition hover:border-indigo-300">
              {s.label}
              <ArrowRight className="size-4 shrink-0 text-indigo-400 transition group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </Card>

      <h2 className="mb-3 text-sm font-semibold text-slate-900">Tất cả tài liệu</h2>
      <div className="mb-8 grid gap-3 md:grid-cols-2">
        {DOCS.map((d) => (
          <Link key={d.slug} href={`/help/${d.slug}`}>
            <Card className="flex h-full items-start gap-3.5 p-4 transition hover:border-indigo-300">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><BookOpen className="size-4.5" /></span>
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{d.title}</p>
                <p className="mt-0.5 text-sm text-slate-500">{d.summary}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="mb-1 text-sm font-semibold text-slate-900">Quyền dùng Hub theo vai trò</h2>
      <p className="mb-3 max-w-3xl text-sm text-slate-500">
        Bảng này được sinh trực tiếp từ danh mục quyền trong mã nên không thể lệch. Đây là bộ quyền mặc định gửi cho Hub; Hub chưa cưỡng chế (xem «Lộ trình & giới hạn»).
        Chế độ hiện tại: <b className="text-slate-700">cấm tự thêm app</b> — không vai nào có «Thêm app» hay «Gỡ app».
      </p>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto cp-scroll">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5">Quyền</th>
                <th className="px-3 py-2.5">Rủi ro</th>
                {HUB_ROLE_ORDER.map((r) => <th key={r} className="px-3 py-2.5 text-center">{HUB_ROLE_LABEL[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr className="bg-slate-50/50"><td colSpan={2 + HUB_ROLE_ORDER.length} className="px-5 py-1.5 text-xs font-semibold text-slate-500">{g}</td></tr>
                  {PERMS.filter((p) => PERM_INFO[p].group === g).map((p) => (
                    <tr key={p} className="border-t border-slate-100">
                      <td className="px-5 py-2.5">
                        <p className="font-medium text-slate-800">{PERM_INFO[p].label} <code className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">{p}</code></p>
                        <p className="text-xs text-slate-500">{PERM_INFO[p].description}</p>
                      </td>
                      <td className="px-3 py-2.5"><Badge tone={RISK[PERM_INFO[p].risk].tone}>{RISK[PERM_INFO[p].risk].label}</Badge></td>
                      {HUB_ROLE_ORDER.map((r) => (
                        <td key={r} className="px-3 py-2.5 text-center">
                          {ROLE_PERMS[r].includes(p) ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Có" /> : <Minus className="mx-auto size-4 text-slate-300" aria-label="Không" />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50/60">
                <td className="px-5 py-2.5 font-medium text-slate-800">Trần chế độ tự chủ của agent</td>
                <td />
                {HUB_ROLE_ORDER.map((r) => <td key={r} className="px-3 py-2.5 text-center"><Badge tone="indigo">{ROLE_AUTONOMY_MAX[r]}</Badge></td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
