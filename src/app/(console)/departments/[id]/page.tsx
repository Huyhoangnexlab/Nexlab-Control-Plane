import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Crown, Info, UserMinus, UserPlus } from "lucide-react";
import { requireActor } from "@/server/session";
import { isTenantAdmin } from "@/server/actor";
import { AppError } from "@/server/errors";
import { getDepartment } from "@/server/services/departments";
import { listUsers } from "@/server/services/users";
import { addMemberAction, removeMemberAction } from "@/app/actions/departments";
import { Avatar, AppIcon, Badge, buttonClass, Card, EmptyState, LevelBadge, PageHeader } from "@/components/ui/primitives";
import { CheckboxGroup, FormDialog, TriggerButton } from "@/components/ui/form";
import { HUB_ROLE_LABEL } from "@/lib/validators";

export default async function DepartmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const admin = isTenantAdmin(actor);
  let dept;
  try {
    dept = await getDepartment(actor, id);
  } catch (e) {
    if (e instanceof AppError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }
  const memberIds = new Set(dept.members.map((m) => m.userId));
  const candidates = admin ? (await listUsers(actor, { status: "active" })).filter((u) => !memberIds.has(u.id)) : [];

  return (
    <>
      <Link href="/departments" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> {admin ? "Tất cả phòng ban" : "Phòng của tôi"}</Link>
      <PageHeader
        title={dept.name}
        description={dept.description || "Chưa có mô tả."}
        actions={dept.canEditApps && <Link href="/access" className={buttonClass("primary")}>Chỉnh app của phòng</Link>}
      />

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Thành viên <span className="ml-1 font-normal text-slate-400">{dept.members.length}</span></h2>
            {admin && (
              <FormDialog title="Thêm thành viên" description={`Chọn người cần thêm vào «${dept.name}».`} action={addMemberAction} submitLabel="Thêm vào phòng" trigger={<TriggerButton variant="secondary" size="sm"><UserPlus className="size-4" /> Thêm thành viên</TriggerButton>}>
                <input type="hidden" name="deptId" value={dept.id} />
                <CheckboxGroup label="Người dùng" name="userIds" options={candidates.map((u) => ({ value: u.id, label: u.name, hint: u.email }))} empty="Mọi người dùng đang hoạt động đều đã ở trong phòng này." />
              </FormDialog>
            )}
          </div>
          {!dept.canEditApps ? (
            <p className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500"><Info className="size-4" /> Chỉ trưởng phòng và quản trị viên mới xem được danh sách thành viên.</p>
          ) : dept.members.length === 0 ? (
            <EmptyState title="Chưa có thành viên" hint="Thêm người dùng vào phòng để họ nhận được app của phòng." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {dept.members.map((m) => (
                <li key={m.userId} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={m.name} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-900">{m.name}{m.isManager && <Badge tone="violet"><Crown className="size-3" /> Trưởng phòng</Badge>}{m.status === "disabled" && <Badge tone="rose">Vô hiệu hoá</Badge>}</p>
                    <p className="truncate text-xs text-slate-500">{m.email} · {HUB_ROLE_LABEL[m.hubRole]}</p>
                  </div>
                  {admin && m.source === "manual" && (
                    <FormDialog title="Bỏ khỏi phòng?" description={`${m.name} sẽ không còn thấy app của «${dept.name}».${m.isManager ? " Họ cũng sẽ mất chức trưởng phòng." : ""}`} action={removeMemberAction} submitLabel="Bỏ khỏi phòng" submitVariant="danger" size="sm" trigger={<TriggerButton variant="ghost" size="sm" title="Bỏ khỏi phòng" className="hover:bg-rose-50 hover:text-rose-600"><UserMinus className="size-4" /></TriggerButton>}>
                      <input type="hidden" name="deptId" value={dept.id} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <p className="text-sm text-slate-600">Tài khoản vẫn còn, chỉ bỏ khỏi phòng này.</p>
                    </FormDialog>
                  )}
                  {m.source === "idp" && <Badge tone="cyan">Đồng bộ từ IdP</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold text-slate-900">App của phòng <span className="ml-1 font-normal text-slate-400">{dept.apps.length}</span></h2></div>
          {dept.apps.length === 0 ? (
            <EmptyState title="Phòng chưa có app nào" hint={dept.canEditApps ? "Vào «Phân quyền app» để cấp app cho phòng." : undefined} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {dept.apps.map((a) => (
                <li key={a.appId} className="flex items-center gap-3 px-5 py-3">
                  <AppIcon icon={a.icon} color={a.color} />
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{a.name}</p>
                  <LevelBadge level={a.level} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
