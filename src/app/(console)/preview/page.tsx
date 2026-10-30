import { Eye, Network, PackageOpen, ScanSearch } from "lucide-react";
import { guard, requireActor } from "@/server/session";
import { isDeptManager, isTenantAdmin } from "@/server/actor";
import { forbidden } from "@/server/errors";
import { db } from "@/server/db";
import { previewUser } from "@/server/services/access";
import { AppError } from "@/server/errors";
import { Avatar, AppIcon, Badge, buttonClass, Card, EmptyState, LevelBadge, PageHeader } from "@/components/ui/primitives";
import { LEVEL_HINT } from "@/lib/levels";
import { HUB_ROLE_LABEL, type HubRole } from "@/lib/validators";

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  await guard(() => {
    if (!isTenantAdmin(actor) && !isDeptManager(actor)) throw forbidden();
  });
  const d = await db();
  // Danh sách người xem trước được: admin → cả tenant; trưởng phòng → thành viên các phòng mình quản lý.
  const people = await d.q<{ id: string; display_name: string; email: string }>(
    isTenantAdmin(actor)
      ? "SELECT id, display_name, email FROM users WHERE tenant_id = $1 ORDER BY display_name"
      : "SELECT DISTINCT u.id, u.display_name, u.email FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.tenant_id = $1 AND m.department_id = ANY($2::text[]) ORDER BY u.display_name",
    isTenantAdmin(actor) ? [actor.tenantId] : [actor.tenantId, actor.managedDeptIds],
  );

  let preview = null;
  let error: string | null = null;
  if (sp.user) {
    try {
      preview = await previewUser(actor, sp.user);
    } catch (e) {
      if (e instanceof AppError) error = e.message;
      else throw e;
    }
  }

  return (
    <>
      <PageHeader title="Xem trước quyền" description="Chọn một người để xem đúng những app và mức quyền Hub sẽ cấp cho họ, kèm lý do. Kết quả dùng cùng phép tính với gói quyền gửi cho Hub." />

      <Card className="mb-6 p-4">
        <form className="flex flex-wrap items-center gap-3">
          <Eye className="size-5 text-slate-400" />
          <select name="user" defaultValue={sp.user ?? ""} className="h-10 min-w-72 flex-1 rounded-lg border-0 bg-slate-50 pr-8 text-sm ring-1 ring-inset ring-slate-200">
            <option value="">— Chọn người dùng —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.email}</option>)}
          </select>
          <button type="submit" className={buttonClass("primary")}>Xem trước</button>
        </form>
      </Card>

      {error && <p role="alert" className="mb-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{error}</p>}

      {!preview ? (
        <Card><EmptyState icon={ScanSearch} title="Chưa chọn người dùng" hint="Chọn một người ở trên để xem quyền hiệu lực của họ." /></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card className="h-fit p-5">
            <div className="flex items-center gap-3">
              <Avatar name={preview.user.name} size="lg" />
              <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{preview.user.name}</p><p className="truncate text-xs text-slate-500">{preview.user.email}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Badge tone="indigo">{HUB_ROLE_LABEL[preview.user.hubRole as HubRole]}</Badge>
              {preview.user.status === "disabled" && <Badge tone="rose">Vô hiệu hoá</Badge>}
            </div>
            <p className="mb-2 mt-5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Network className="size-3.5" /> Phòng ban</p>
            {preview.departments.length === 0 ? <p className="text-sm text-amber-700">Chưa thuộc phòng nào → không thấy app nào.</p> : (
              <div className="flex flex-wrap gap-1.5">{preview.departments.map((x) => <Badge key={x.id} tone={x.isManager ? "violet" : "slate"}>{x.name}{x.isManager ? " · Trưởng phòng" : ""}</Badge>)}</div>
            )}
            <p className="mt-5 text-xs text-slate-500">Phiên bản chính sách hiện tại: <b className="text-slate-700">v{preview.policyVersion}</b></p>
          </Card>

          <Card>
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold text-slate-900">App người này sẽ thấy trong Hub <span className="ml-1 font-normal text-slate-400">{preview.effective.length}</span></h2></div>
            {preview.effective.length === 0 ? (
              <EmptyState icon={PackageOpen} title="Không có app nào" hint={preview.user.status === "disabled" ? "Tài khoản đang bị vô hiệu hoá." : "Phòng của người này chưa được cấp app nào."} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {preview.effective.map((e) => (
                  <li key={e.appId} className="flex items-start gap-3.5 px-5 py-4">
                    <AppIcon icon={e.icon} color={e.color} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{e.name}</p><LevelBadge level={e.level} />{e.clamped && <Badge tone="amber">Bị kẹp bởi trần app</Badge>}</div>
                      <p className="mt-0.5 text-xs text-slate-500">{e.origin}</p>
                      <p className="mt-1.5 text-sm text-slate-600">{LEVEL_HINT[e.level]}</p>
                      <p className="mt-1.5 text-xs text-slate-500">Vì: {e.via.map((v) => `${v.deptName} (${v.level})`).join(" + ")}{e.via.length > 1 ? " → lấy mức cao nhất" : ""}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
