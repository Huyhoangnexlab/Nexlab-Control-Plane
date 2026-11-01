import { KeyRound, Pencil, ShieldAlert, Trash2 } from "lucide-react";
import { guard, requireActor } from "@/server/session";
import { requireTenantAdmin } from "@/server/actor";
import { listSecrets } from "@/server/services/config";
import { clearSecretAction, saveSecretAction } from "@/app/actions/config";
import { Badge, Card, PageHeader, formatDateTime } from "@/components/ui/primitives";
import { CheckboxGroup, FormDialog, TextAreaField, TextField, TriggerButton } from "@/components/ui/form";
import { HUB_ROLES, HUB_ROLE_LABEL } from "@/lib/validators";

export default async function SecretsPage() {
  const actor = await requireActor();
  await guard(() => requireTenantAdmin(actor));
  const secrets = await listSecrets(actor);
  const roleOptions = HUB_ROLES.filter((r) => r !== "viewer").map((r) => ({ value: r, label: HUB_ROLE_LABEL[r] }));

  return (
    <>
      <PageHeader
        title="Khoá & token"
        description="Khoá API và token dùng chung của tổ chức. Giá trị được mã hoá khi lưu, CHỈ ghi — không ai xem lại được (kể cả quản trị). Hub của người dùng thuộc vai được chọn tự nhận khoá lúc đăng nhập, giữ trong bộ nhớ và không hiển thị cho họ."
      />
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <p>Khoá nằm trong bộ nhớ của Hub trên máy người dùng. Người có quyền quản trị hệ điều hành của máy vẫn có thể lấy ra được. Chỉ cấp khoá cho vai thật sự cần, ưu tiên khoá có hạn mức chi tiêu và đổi khi có người nghỉ việc.</p>
      </div>
      <Card className="divide-y divide-slate-100">
        {secrets.map((s) => (
          <div key={s.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
            <div className="min-w-0 flex-1 basis-64">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-900"><KeyRound className="size-4 text-slate-400" /> {s.label}</p>
              <p className="mt-0.5 text-xs text-slate-500"><code>{s.key}</code> · {s.usedBy}</p>
            </div>
            <div className="flex min-w-0 flex-[2] basis-72 flex-wrap items-center gap-1.5">
              {s.configured ? (
                <>
                  <Badge tone="emerald">Đã đặt · ••••{s.last4}</Badge>
                  {s.roles.map((r) => <Badge key={r} tone="slate">{HUB_ROLE_LABEL[r]}</Badge>)}
                  <span className="text-xs text-slate-400">cập nhật {formatDateTime(s.updatedAt)}</span>
                </>
              ) : (
                <span className="text-xs text-slate-400">Chưa đặt</span>
              )}
            </div>
            <div className="flex">
              <FormDialog title={s.label} description={s.key} action={saveSecretAction} size="md" trigger={<TriggerButton variant="secondary" size="sm"><Pencil className="size-3.5" /> {s.configured ? "Đổi khoá / vai nhận" : "Đặt khoá"}</TriggerButton>}>
                <input type="hidden" name="key" value={s.key} />
                {s.multiline ? (
                  <TextAreaField label={s.configured ? "JSON mới (để trống nếu chỉ đổi vai nhận)" : "Nội dung file JSON"} name="value" rows={8} placeholder={'{ "type": "service_account", "project_id": "…", … }'} hint="Dán nguyên file JSON của service account. Được lưu mã hoá, chỉ ghi — không xem lại được." />
                ) : (
                  <TextField label={s.configured ? "Khoá mới (để trống nếu chỉ đổi vai nhận)" : "Giá trị khoá"} name="value" type="password" autoComplete="new-password" placeholder="••••••••" hint="8–512 ký tự, không khoảng trắng. Lưu xong không xem lại được." />
                )}
                <CheckboxGroup label="Vai trò Hub được nhận khoá" name="roles" options={roleOptions} defaultValues={s.roles} hint="Vai «Chỉ đọc» không bao giờ nhận khoá." />
              </FormDialog>
              {s.configured && (
                <FormDialog title="Xoá khoá khỏi kho?" description={`${s.label} — người dùng sẽ mất khoá này ở lần làm mới kế tiếp.`} action={clearSecretAction} submitLabel="Xoá khoá" submitVariant="danger" size="sm"
                  trigger={<TriggerButton variant="ghost" size="sm" title="Xoá khoá" className="hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></TriggerButton>}>
                  <input type="hidden" name="key" value={s.key} />
                  <p className="text-sm text-slate-600">Không hoàn tác được. Nếu khoá đã lộ, hãy thu hồi nó ở nhà cung cấp.</p>
                </FormDialog>
              )}
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}
