import { Fingerprint } from "lucide-react";
import { guard, requireActor } from "@/server/session";
import { requireTenantAdmin } from "@/server/actor";
import { getOwnTenant } from "@/server/services/tenants";
import { getIdp } from "@/server/services/identity-providers";
import { saveSettingsAction } from "@/app/actions/tenants";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const actor = await requireActor();
  await guard(() => requireTenantAdmin(actor));
  const tenant = (await getOwnTenant(actor))!;
  const idp = await getIdp(actor, tenant.id);
  return (
    <>
      <PageHeader title="Cài đặt tổ chức" description="Thông tin hiển thị trong Hub, thời hạn của gói quyền gửi xuống máy người dùng và trạng thái đăng nhập SSO." />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card className="p-6">
            <SettingsForm action={saveSettingsAction} initial={{ productName: tenant.productName ?? "", accent: tenant.accent ?? "#4f46e5", ttl: tenant.entitlementTtlHours }} />
          </Card>

          <Card className="p-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Fingerprint className="size-4 text-slate-400" /> Đăng nhập SSO</h2>
            {idp ? (
              <>
                <p className="mt-2 text-sm text-slate-600">Người dùng đăng nhập Hub qua nhà cung cấp danh tính của tổ chức. Token mật khẩu cục bộ không còn dùng được cho Hub.</p>
                <dl className="mt-4 space-y-2.5 text-sm">
                  {[["Issuer", idp.issuer], ["Client ID", idp.clientId], ["Claim nhóm", idp.groupsClaim]].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2"><dt className="text-slate-500">{k}</dt><dd className="break-all text-right font-mono text-[13px] text-slate-800">{v}</dd></div>
                  ))}
                  <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2"><dt className="text-slate-500">Đồng bộ phòng ban từ nhóm IdP</dt><dd>{idp.syncGroups ? <Badge tone="emerald">Bật</Badge> : <Badge tone="slate">Tắt</Badge>}</dd></div>
                  <div className="flex items-center justify-between gap-4"><dt className="text-slate-500">Tự tạo tài khoản lần đầu (JIT)</dt><dd>{idp.jit ? <Badge tone="amber">Bật</Badge> : <Badge tone="slate">Tắt</Badge>}</dd></div>
                </dl>
                <p className="mt-4 text-xs text-slate-500">Cấu hình SSO do quản trị nền tảng Nexlab quản lý. Muốn đổi, liên hệ họ. Gắn «Nhóm IdP» cho từng phòng ở mục Phòng ban.</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-600">Tổ chức chưa cấu hình SSO. Liên hệ quản trị nền tảng Nexlab để nối với Keycloak / Entra ID / Google của công ty.</p>
            )}
          </Card>
        </div>
        <Card className="h-fit p-6">
          <h2 className="text-sm font-semibold text-slate-900">Thông tin tổ chức</h2>
          <dl className="mt-4 space-y-3 text-sm">
            {[["Tên", tenant.name], ["Mã", tenant.slug], ["Tên miền email", `@${tenant.domain}`], ["Phiên bản chính sách", `v${tenant.policyVersion}`], ["Người dùng", String(tenant.users)], ["Phòng ban", String(tenant.departments)], ["App trong danh mục", String(tenant.apps)]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2.5 last:border-0"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-800">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-slate-500">Tên, mã và tên miền do quản trị nền tảng Nexlab quản lý.</p>
        </Card>
      </div>
    </>
  );
}
