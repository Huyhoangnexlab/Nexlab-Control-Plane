import Link from "next/link";
import { ArrowUpRight, Network, Pencil, Plus, Trash2, UserCog, Users } from "lucide-react";
import { guard, requireActor } from "@/server/session";
import { isTenantAdmin } from "@/server/actor";
import { listDepartments } from "@/server/services/departments";
import { listUsers } from "@/server/services/users";
import { deleteDepartmentAction, saveDepartmentAction } from "@/app/actions/departments";
import { Avatar, Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { FormDialog, SelectField, TextAreaField, TextField, TriggerButton } from "@/components/ui/form";

export default async function DepartmentsPage() {
  const actor = await requireActor();
  const admin = isTenantAdmin(actor);
  const depts = await guard(() => listDepartments(actor));
  const users = admin ? await listUsers(actor, { status: "active" }) : [];

  const form = (d?: (typeof depts)[number]) => (
    <>
      {d && <input type="hidden" name="id" value={d.id} />}
      <TextField label="Tên phòng ban" name="name" defaultValue={d?.name} required placeholder="Ví dụ: Kế toán" />
      <TextAreaField label="Mô tả" name="description" defaultValue={d?.description} placeholder="Phòng này làm việc gì, dùng những hệ thống nào…" />
      <TextField
        label="Nhóm trên IdP (SSO)"
        name="idpGroup"
        defaultValue={d?.idpGroup ?? ""}
        placeholder="vd: kinh-doanh"
        hint="Tên nhóm ở nhà cung cấp danh tính. Người đăng nhập SSO thuộc nhóm này sẽ tự vào phòng. Để trống nếu phòng chỉ do quản trị thêm tay."
      />
      <SelectField
        label="Trưởng phòng"
        name="managerUserId"
        defaultValue={d?.managerUserId ?? ""}
        options={[{ value: "", label: "— Chưa có —" }, ...users.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }))]}
        hint="Trưởng phòng được chọn app cho phòng (trong danh mục) nhưng không sửa được thành viên. Người được chọn sẽ tự thành thành viên của phòng."
      />
    </>
  );

  return (
    <>
      <PageHeader
        title={admin ? "Phòng ban" : "Phòng của tôi"}
        description={admin ? "Mỗi phòng ban có một trưởng phòng và một bộ app riêng. Thành viên do quản trị tổ chức quản lý." : "Các phòng ban bạn đang quản lý. Bạn chọn app cho phòng ở mục «Phân quyền app»."}
        actions={
          admin && (
            <FormDialog title="Thêm phòng ban" action={saveDepartmentAction} submitLabel="Tạo phòng ban" trigger={<TriggerButton variant="primary"><Plus className="size-4" /> Thêm phòng ban</TriggerButton>}>
              {form()}
            </FormDialog>
          )
        }
      />
      {depts.length === 0 ? (
        <Card><EmptyState icon={Network} title="Chưa có phòng ban" hint={admin ? "Tạo phòng ban đầu tiên để bắt đầu phân quyền app." : "Bạn chưa được giao quản lý phòng nào."} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {depts.map((d) => (
            <Card key={d.id} className="flex flex-col p-5 transition hover:shadow-pop/30">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-slate-900">{d.name}</h2>
                  <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-relaxed text-slate-500">{d.description || "Chưa có mô tả."}</p>
                </div>
                {admin && (
                  <div className="-mr-1.5 flex shrink-0">
                    <FormDialog title="Sửa phòng ban" action={saveDepartmentAction} trigger={<TriggerButton variant="ghost" size="sm" title="Sửa"><Pencil className="size-4" /></TriggerButton>}>
                      {form(d)}
                    </FormDialog>
                    <FormDialog title="Xoá phòng ban?" description={`«${d.name}» có ${d.memberCount} thành viên và ${d.appCount} app. Xoá sẽ thu hồi mọi quyền app của phòng này; tài khoản người dùng vẫn được giữ.`} action={deleteDepartmentAction} submitLabel="Xoá phòng ban" submitVariant="danger" size="sm" trigger={<TriggerButton variant="ghost" size="sm" title="Xoá" className="hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></TriggerButton>}>
                      <input type="hidden" name="id" value={d.id} />
                      <p className="text-sm text-slate-600">Thao tác này không hoàn tác được.</p>
                    </FormDialog>
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5">
                {d.managerName ? <><Avatar name={d.managerName} size="sm" /><div className="min-w-0 text-xs leading-tight"><p className="text-slate-500">Trưởng phòng</p><p className="truncate font-medium text-slate-800">{d.managerName}</p></div></> : (
                  <><span className="grid size-7 place-items-center rounded-full bg-amber-100 text-amber-700"><UserCog className="size-3.5" /></span><p className="text-xs font-medium text-amber-800">Chưa có trưởng phòng</p></>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex flex-wrap gap-1.5"><Badge tone="slate"><Users className="size-3" /> {d.memberCount} người</Badge><Badge tone="indigo">{d.appCount} app</Badge>{d.idpGroup && <Badge tone="cyan">SSO: {d.idpGroup}</Badge>}</div>
                <Link href={`/departments/${d.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">Chi tiết <ArrowUpRight className="size-4" /></Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
