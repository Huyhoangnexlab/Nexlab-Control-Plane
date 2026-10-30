import { Building2, Fingerprint, Pencil, Plus, ShieldOff, Trash2 } from "lucide-react";
import { guard, requireActor } from "@/server/session";
import { requirePlatform } from "@/server/actor";
import { listTenants } from "@/server/services/tenants";
import { deleteTenantAction, removeIdpAction, saveIdpAction, saveTenantAction } from "@/app/actions/tenants";
import { Badge, Card, EmptyState, formatDateTime, PageHeader } from "@/components/ui/primitives";
import { CheckField, FormDialog, SelectField, TextField, TriggerButton } from "@/components/ui/form";

export default async function TenantsPage() {
  const actor = await requireActor();
  await guard(() => requirePlatform(actor));
  const tenants = await listTenants(actor);
  return (
    <>
      <PageHeader
        title="Tổ chức (tenant)"
        description="Mỗi tổ chức là một vùng dữ liệu tách biệt hoàn toàn: người dùng, phòng ban, danh mục app và nhật ký riêng. Quản trị nền tảng không xem được dữ liệu nghiệp vụ bên trong."
        actions={
          <FormDialog title="Tạo tổ chức mới" description="Hệ thống tạo luôn tài khoản quản trị đầu tiên cho tổ chức." action={saveTenantAction} submitLabel="Tạo tổ chức" size="lg" trigger={<TriggerButton variant="primary"><Plus className="size-4" /> Tạo tổ chức</TriggerButton>}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Tên tổ chức" name="name" required placeholder="Công ty ABC" />
              <TextField label="Mã (slug)" name="slug" required placeholder="cong-ty-abc" hint="Chữ thường, số, gạch ngang." />
            </div>
            <TextField label="Tên miền email" name="domain" required placeholder="congty.vn" hint="Mọi tài khoản của tổ chức phải có email @tên-miền-này. Hub dùng nó để biết người dùng thuộc tổ chức nào." />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Tên quản trị viên" name="adminName" required placeholder="Nguyễn Văn A" />
              <TextField label="Email quản trị viên" name="adminEmail" type="email" required placeholder="admin@congty.vn" />
            </div>
            <TextField label="Mật khẩu ban đầu" name="adminPassword" type="password" autoComplete="new-password" hint="Để trống để hệ thống tự tạo mật khẩu tạm." />
          </FormDialog>
        }
      />
      {tenants.length === 0 ? (
        <Card><EmptyState icon={Building2} title="Chưa có tổ chức nào" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto cp-scroll">
            <table className="w-full min-w-[780px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5">Tổ chức</th><th className="px-3 py-2.5">Tên miền</th><th className="px-3 py-2.5">Quy mô</th><th className="px-3 py-2.5">Trạng thái</th><th className="px-3 py-2.5">Tạo lúc</th><th className="px-5 py-2.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50">
                    <td className="px-5 py-3"><p className="font-medium text-slate-900">{t.name}</p><p className="text-xs text-slate-500">{t.slug}</p></td>
                    <td className="px-3 py-3 text-slate-600">@{t.domain}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {t.users} người · {t.departments} phòng · {t.apps} app
                      <div className="mt-1">
                        {t.sso ? <Badge tone="cyan"><Fingerprint className="size-3" /> SSO · {new URL(t.sso.issuer).host}</Badge> : <Badge tone="slate">Chưa cấu hình SSO</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-3">{t.status === "active" ? <Badge tone="emerald" dot>Hoạt động</Badge> : <Badge tone="rose" dot>Tạm ngưng</Badge>}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{formatDateTime(t.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <FormDialog
                          title="Đăng nhập SSO (OIDC)"
                          description={`Nhà cung cấp danh tính của «${t.name}». Hub đăng nhập qua đây; Control Plane chỉ tin token do issuer này ký.`}
                          action={saveIdpAction}
                          submitLabel="Kiểm tra & lưu"
                          size="lg"
                          trigger={<TriggerButton variant="ghost" size="sm" title="Cấu hình SSO"><Fingerprint className="size-4" /></TriggerButton>}
                        >
                          <input type="hidden" name="tenantId" value={t.id} />
                          <TextField label="Issuer" name="issuer" defaultValue={t.sso?.issuer} required placeholder="https://idp.congty.vn/realms/congty" hint="Địa chỉ gốc của IdP (Keycloak: .../realms/<tên>). Phải mở được .well-known/openid-configuration — hệ thống kiểm tra khi lưu." />
                          <div className="grid gap-4 sm:grid-cols-2">
                            <TextField label="Client ID của Hub" name="clientId" defaultValue={t.sso?.clientId ?? "nexlab-hub"} required hint="Client công khai (PKCE) đã tạo cho Hub ở IdP." />
                            <TextField label="Claim chứa nhóm" name="groupsClaim" defaultValue={t.sso?.groupsClaim ?? "groups"} hint="Tên claim trong token liệt kê nhóm của người dùng." />
                          </div>
                          <CheckField label="Đồng bộ phòng ban từ nhóm IdP" name="syncGroups" defaultChecked={t.sso?.syncGroups ?? true} hint="Mỗi lần đăng nhập, thành viên phòng (đã gắn «Nhóm IdP») được thêm / bớt theo nhóm. Thành viên do quản trị thêm tay không bị đụng tới." />
                          <CheckField label="Tự tạo tài khoản khi đăng nhập lần đầu (JIT)" name="jit" defaultChecked={t.sso?.jit ?? false} hint="Người có email đúng tên miền nhưng chưa có tài khoản sẽ được tạo với vai trò nhân viên, không quyền quản trị. Tắt nếu muốn quản trị viên tạo trước." />
                        </FormDialog>
                        {t.sso && (
                          <FormDialog title="Gỡ cấu hình SSO?" description={`«${t.name}» sẽ không còn đăng nhập Hub qua ${t.sso.issuer}. Nếu máy chủ cho phép token mật khẩu cục bộ (chỉ dev), tổ chức quay về cách đó.`} action={removeIdpAction} submitLabel="Gỡ SSO" submitVariant="danger" size="sm" trigger={<TriggerButton variant="ghost" size="sm" title="Gỡ SSO" className="hover:bg-amber-50 hover:text-amber-700"><ShieldOff className="size-4" /></TriggerButton>}>
                            <input type="hidden" name="tenantId" value={t.id} />
                            <p className="text-sm text-slate-600">Tài khoản người dùng và liên kết danh tính vẫn được giữ.</p>
                          </FormDialog>
                        )}
                        <FormDialog title="Sửa tổ chức" description={`@${t.domain}`} action={saveTenantAction} size="sm" trigger={<TriggerButton variant="ghost" size="sm" title="Sửa"><Pencil className="size-4" /></TriggerButton>}>
                          <input type="hidden" name="id" value={t.id} />
                          <TextField label="Tên tổ chức" name="name" defaultValue={t.name} required />
                          <SelectField label="Trạng thái" name="status" defaultValue={t.status} options={[{ value: "active", label: "Hoạt động" }, { value: "suspended", label: "Tạm ngưng — mọi người bị đăng xuất, không đăng nhập được" }]} />
                        </FormDialog>
                        <FormDialog title="Xoá tổ chức?" description={`Xoá vĩnh viễn «${t.name}» cùng ${t.users} người dùng, ${t.departments} phòng ban, ${t.apps} app. Nhật ký xoá vẫn được giữ.`} action={deleteTenantAction} submitLabel="Xoá vĩnh viễn" submitVariant="danger" size="sm" trigger={<TriggerButton variant="ghost" size="sm" title="Xoá" className="hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></TriggerButton>}>
                          <input type="hidden" name="id" value={t.id} />
                          <TextField label={`Gõ «${t.slug}» để xác nhận`} name="confirmSlug" required />
                        </FormDialog>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
