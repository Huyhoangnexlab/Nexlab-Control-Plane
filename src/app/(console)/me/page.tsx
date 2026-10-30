import { KeyRound, Network, ShieldCheck } from "lucide-react";
import { requireActor } from "@/server/session";
import { previewUser } from "@/server/services/access";
import { changePasswordAction } from "@/app/actions/users";
import { Avatar, AppIcon, Badge, Card, EmptyState, LevelBadge, PageHeader } from "@/components/ui/primitives";
import { FormDialog, TextField, TriggerButton } from "@/components/ui/form";
import { LEVEL_HINT } from "@/lib/levels";
import { HUB_ROLE_LABEL } from "@/lib/validators";

export default async function MePage() {
  const actor = await requireActor();
  const preview = actor.tenantId ? await previewUser(actor, actor.userId) : null;
  return (
    <>
      <PageHeader
        title="Tài khoản của tôi"
        description="Phòng ban và các app bạn sẽ thấy trong Hub. Nếu thiếu app, hãy nhờ trưởng phòng hoặc quản trị viên cấp thêm."
        actions={
          <FormDialog title="Đổi mật khẩu" action={changePasswordAction} submitLabel="Đổi mật khẩu" size="sm" trigger={<TriggerButton><KeyRound className="size-4" /> Đổi mật khẩu</TriggerButton>}>
            <TextField label="Mật khẩu hiện tại" name="current" type="password" autoComplete="current-password" required />
            <TextField label="Mật khẩu mới" name="next" type="password" autoComplete="new-password" required hint="Tối thiểu 8 ký tự, gồm cả chữ và số." />
          </FormDialog>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit p-5">
          <div className="flex items-center gap-3">
            <Avatar name={actor.name} size="lg" />
            <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{actor.name}</p><p className="truncate text-xs text-slate-500">{actor.email}</p></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {actor.adminRole === "platform_admin" && <Badge tone="amber">Quản trị nền tảng</Badge>}
            {actor.adminRole === "tenant_admin" && <Badge tone="amber">Quản trị tổ chức</Badge>}
            <Badge tone="indigo">{HUB_ROLE_LABEL[actor.hubRole]}</Badge>
          </div>
          {actor.tenantName && <p className="mt-4 text-sm text-slate-600">Tổ chức: <b className="text-slate-800">{actor.tenantName}</b></p>}
          {preview && (
            <>
              <p className="mb-2 mt-5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Network className="size-3.5" /> Phòng ban</p>
              {preview.departments.length === 0 ? <p className="text-sm text-amber-700">Bạn chưa thuộc phòng nào nên chưa có app. Hãy báo quản trị viên.</p> : (
                <div className="flex flex-wrap gap-1.5">{preview.departments.map((d) => <Badge key={d.id} tone={d.isManager ? "violet" : "slate"}>{d.name}{d.isManager ? " · Trưởng phòng" : ""}</Badge>)}</div>
              )}
            </>
          )}
        </Card>

        {preview ? (
          <Card>
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShieldCheck className="size-4 text-slate-400" /> App của tôi <span className="font-normal text-slate-400">{preview.effective.length}</span></h2></div>
            {preview.effective.length === 0 ? (
              <EmptyState title="Bạn chưa có app nào" hint="Phòng ban của bạn chưa được cấp app. Hãy nhờ trưởng phòng bật app cho phòng." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {preview.effective.map((e) => (
                  <li key={e.appId} className="flex items-start gap-3.5 px-5 py-4">
                    <AppIcon icon={e.icon} color={e.color} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{e.name}</p><LevelBadge level={e.level} /></div>
                      <p className="mt-1 text-sm text-slate-600">{LEVEL_HINT[e.level]}</p>
                      <p className="mt-1 text-xs text-slate-500">Cấp bởi: {e.via.map((v) => v.deptName).join(", ")}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <Card><EmptyState title="Tài khoản nền tảng" hint="Tài khoản này không thuộc tổ chức nào nên không có app. Dùng mục «Tổ chức» để quản lý tenant." /></Card>
        )}
      </div>
    </>
  );
}
