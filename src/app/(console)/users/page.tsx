import Link from "next/link";
import { KeyRound, Pencil, Plus, Search, Trash2, UserX } from "lucide-react";
import { guard, requireActor } from "@/server/session";
import { listUsers } from "@/server/services/users";
import { listDepartments } from "@/server/services/departments";
import { saveUserAction, resetPasswordAction, deleteUserAction } from "@/app/actions/users";
import { Avatar, Badge, buttonClass, Card, EmptyState, PageHeader, relativeTime, type Tone } from "@/components/ui/primitives";
import { CheckboxGroup, FormDialog, SelectField, TextField, TriggerButton } from "@/components/ui/form";
import { HUB_ROLE_LABEL, HUB_ROLES } from "@/lib/validators";

const HUB_TONE: Record<string, Tone> = { viewer: "slate", member: "indigo", lead: "violet", admin: "amber" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string; status?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const [users, depts] = await guard(() =>
    Promise.all([
      listUsers(actor, { q: sp.q, deptId: sp.dept || undefined, status: sp.status === "active" || sp.status === "disabled" ? sp.status : undefined }),
      listDepartments(actor),
    ]),
  );
  const deptOptions = depts.map((d) => ({ value: d.id, label: d.name, hint: d.managerName ? `Trưởng phòng: ${d.managerName}` : undefined }));
  const filtered = !!(sp.q || sp.dept || sp.status);

  const form = (u?: (typeof users)[number]) => (
    <>
      {u && <input type="hidden" name="id" value={u.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Họ tên" name="name" defaultValue={u?.name} required placeholder="Nguyễn Văn A" />
        <TextField label="Email" name="email" type="email" defaultValue={u?.email} required disabled={!!u} placeholder="ten@nexlab.tech" hint={u ? "Không đổi được email." : "Phải thuộc tên miền của tổ chức."} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Vai trò dùng Hub" name="hubRole" defaultValue={u?.hubRole ?? "member"} options={HUB_ROLES.map((r) => ({ value: r, label: HUB_ROLE_LABEL[r] }))} hint="Quyết định các thao tác trong Hub (áp dụng ở bước RBAC)." />
        <SelectField label="Quyền quản trị" name="adminRole" defaultValue={u?.adminRole === "tenant_admin" ? "tenant_admin" : "none"} options={[{ value: "none", label: "Không (người dùng thường)" }, { value: "tenant_admin", label: "Quản trị tổ chức" }]} hint="Quản trị tổ chức có toàn quyền trong tenant này." />
      </div>
      {u ? (
        <SelectField label="Trạng thái" name="status" defaultValue={u.status} options={[{ value: "active", label: "Đang hoạt động" }, { value: "disabled", label: "Vô hiệu hoá (đăng xuất khỏi mọi thiết bị)" }]} />
      ) : (
        <TextField label="Mật khẩu ban đầu" name="password" type="password" autoComplete="new-password" hint="Để trống để hệ thống tự tạo mật khẩu tạm và hiện cho bạn một lần." />
      )}
      <CheckboxGroup label="Thuộc phòng ban" name="deptIds" options={deptOptions} defaultValues={u?.departments.map((d) => d.id)} empty="Chưa có phòng ban. Tạo phòng ban trước ở mục «Phòng ban»." hint="Người dùng chỉ thấy app của các phòng mình thuộc." />
    </>
  );

  return (
    <>
      <PageHeader
        title="Người dùng"
        description="Tạo tài khoản, gán vào phòng ban, vô hiệu hoá khi nghỉ việc. Trưởng phòng và nhân viên không có quyền ở trang này."
        actions={
          <FormDialog title="Thêm người dùng" description="Tài khoản mới sẽ thấy các app của phòng ban được gán." action={saveUserAction} submitLabel="Tạo tài khoản" size="lg" trigger={<TriggerButton variant="primary"><Plus className="size-4" /> Thêm người dùng</TriggerButton>}>
            {form()}
          </FormDialog>
        }
      />

      <Card className="overflow-hidden">
        <form className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 p-3.5">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input name="q" defaultValue={sp.q} placeholder="Tìm theo tên hoặc email…" className="block h-9.5 w-full rounded-lg border-0 bg-slate-50 pl-9 pr-3 text-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-500" />
          </div>
          <select name="dept" defaultValue={sp.dept ?? ""} className="h-9.5 rounded-lg border-0 bg-slate-50 pr-8 text-sm ring-1 ring-inset ring-slate-200">
            <option value="">Mọi phòng ban</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select name="status" defaultValue={sp.status ?? ""} className="h-9.5 rounded-lg border-0 bg-slate-50 pr-8 text-sm ring-1 ring-inset ring-slate-200">
            <option value="">Mọi trạng thái</option>
            <option value="active">Đang hoạt động</option>
            <option value="disabled">Đã vô hiệu hoá</option>
          </select>
          <button type="submit" className={buttonClass("secondary")}>Lọc</button>
          {filtered && <Link href="/users" className={buttonClass("ghost")}>Xoá lọc</Link>}
        </form>

        {users.length === 0 ? (
          <EmptyState icon={UserX} title={filtered ? "Không có người dùng khớp bộ lọc" : "Chưa có người dùng"} hint={filtered ? "Thử bỏ bớt điều kiện lọc." : "Bấm «Thêm người dùng» để tạo tài khoản đầu tiên."} />
        ) : (
          <div className="overflow-x-auto cp-scroll">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5">Người dùng</th>
                  <th className="px-3 py-2.5">Phòng ban</th>
                  <th className="px-3 py-2.5">Vai trò</th>
                  <th className="px-3 py-2.5">Đăng nhập gần nhất</th>
                  <th className="px-5 py-2.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className={u.status === "disabled" ? "bg-slate-50/70 text-slate-500" : "hover:bg-slate-50/50"}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{u.name}{u.id === actor.userId && <span className="ml-1.5 text-xs font-normal text-slate-400">(bạn)</span>}</p>
                          <p className="truncate text-xs text-slate-500">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {u.departments.length === 0 ? <span className="text-xs text-amber-700">Chưa thuộc phòng nào</span> : (
                        <div className="flex flex-wrap gap-1">
                          {u.departments.map((d) => <Badge key={d.id} tone={d.isManager ? "violet" : "slate"}>{d.name}{d.isManager ? " · TP" : ""}</Badge>)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.adminRole === "tenant_admin" && <Badge tone="amber">Quản trị tổ chức</Badge>}
                        <Badge tone={HUB_TONE[u.hubRole]}>{HUB_ROLE_LABEL[u.hubRole]}</Badge>
                        {u.sso && <Badge tone="cyan">SSO</Badge>}
                        {u.status === "disabled" && <Badge tone="rose">Vô hiệu hoá</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">{relativeTime(u.lastLoginAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <FormDialog title="Sửa người dùng" description={u.email} action={saveUserAction} size="lg" trigger={<TriggerButton variant="ghost" size="sm" title="Sửa"><Pencil className="size-4" /></TriggerButton>}>
                          {form(u)}
                        </FormDialog>
                        <FormDialog title="Đặt lại mật khẩu" description={`Đặt mật khẩu mới cho ${u.email}. Người này sẽ bị đăng xuất khỏi mọi thiết bị.`} action={resetPasswordAction} submitLabel="Đặt lại" size="sm" trigger={<TriggerButton variant="ghost" size="sm" title="Đặt lại mật khẩu"><KeyRound className="size-4" /></TriggerButton>}>
                          <input type="hidden" name="id" value={u.id} />
                          <TextField label="Mật khẩu mới" name="password" type="password" autoComplete="new-password" hint="Để trống để hệ thống tự tạo mật khẩu tạm." />
                        </FormDialog>
                        {u.id !== actor.userId && (
                          <FormDialog title="Xoá tài khoản?" description={`${u.name} (${u.email}) sẽ bị xoá vĩnh viễn khỏi tổ chức. Nhật ký vẫn được giữ lại.`} action={deleteUserAction} submitLabel="Xoá tài khoản" submitVariant="danger" size="sm" trigger={<TriggerButton variant="ghost" size="sm" title="Xoá" className="hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></TriggerButton>}>
                            <input type="hidden" name="id" value={u.id} />
                            <p className="text-sm text-slate-600">Nếu chỉ tạm thời không cho dùng, hãy chọn <b>Vô hiệu hoá</b> trong mục Sửa thay vì xoá.</p>
                          </FormDialog>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">{users.length} người dùng{filtered ? " khớp bộ lọc" : ""}</div>
      </Card>
    </>
  );
}
