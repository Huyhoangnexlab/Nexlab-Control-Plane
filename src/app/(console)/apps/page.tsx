import { Grid3x3, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { guard, requireActor } from "@/server/session";
import { listApps } from "@/server/services/apps";
import { requireTenantAdmin } from "@/server/actor";
import { deleteAppAction, saveAppAction } from "@/app/actions/apps";
import { AppIcon, Badge, Card, EmptyState, LevelBadge, PageHeader } from "@/components/ui/primitives";
import { ColorField, FormDialog, SelectField, TextField, TriggerButton } from "@/components/ui/form";
import { ASSIGNABLE_LEVELS, LEVEL_HINT, LEVEL_LABEL } from "@/lib/levels";
import { ICONS } from "@/lib/validators";

const ICON_LABEL: Record<string, string> = {
  Globe: "Web chung", Users: "Con người", Wallet: "Tài chính", Briefcase: "Kinh doanh", Clock: "Chấm công", Building2: "Toà nhà",
  ShieldCheck: "Bảo mật", FileText: "Tài liệu", BarChart3: "Báo cáo", Stethoscope: "Y tế", Headphones: "Hỗ trợ", Package: "Kho / hàng",
};

export default async function AppsPage() {
  const actor = await requireActor();
  await guard(() => requireTenantAdmin(actor));
  const apps = await listApps(actor);
  const ceilings = ASSIGNABLE_LEVELS.filter((l) => l !== "none").map((l) => ({ value: l, label: `${LEVEL_LABEL[l]} — ${LEVEL_HINT[l]}` }));

  const form = (a?: (typeof apps)[number]) => (
    <>
      {a && <input type="hidden" name="id" value={a.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Tên hiển thị" name="name" defaultValue={a?.name} required placeholder="Ví dụ: EspoCRM" />
        <TextField label="Địa chỉ (origin)" name="origin" defaultValue={a?.origin} required placeholder="https://crm.congty.vn" hint="Chỉ HTTPS. Hub so khớp chính xác địa chỉ này nên không dùng ký tự đại diện." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Biểu tượng" name="icon" defaultValue={a?.icon ?? "Globe"} options={ICONS.map((i) => ({ value: i, label: ICON_LABEL[i] ?? i }))} />
        <ColorField label="Màu nhận diện" name="color" defaultValue={a?.color ?? "#4f46e5"} />
      </div>
      <SelectField label="Mức tối đa cho phép" name="maxLevel" defaultValue={a?.maxLevel ?? "M1"} options={ceilings} hint="Trưởng phòng không thể cấp cho phòng mình mức cao hơn trần này. Hạ trần sẽ tự hạ mức đã cấp." />
      <TextField label="Thẻ" name="tags" defaultValue={a?.tags.join(", ")} placeholder="hr, pii" hint="Phân nhóm app (cách nhau bằng dấu phẩy). Dùng cho chính sách theo nhóm sau này." />
      {a && <SelectField label="Trạng thái" name="status" defaultValue={a.status} options={[{ value: "active", label: "Đang bật" }, { value: "disabled", label: "Tắt — không phòng nào thấy, cấu hình được giữ lại" }]} />}
    </>
  );

  return (
    <>
      <PageHeader
        title="Danh mục app"
        description="Đây là danh sách DUY NHẤT các app mà phòng ban được chọn. Chỉ quản trị tổ chức thêm app vào đây; trưởng phòng chỉ chọn trong danh sách này."
        actions={
          <FormDialog title="Thêm app vào danh mục" action={saveAppAction} submitLabel="Thêm app" size="lg" trigger={<TriggerButton variant="primary"><Plus className="size-4" /> Thêm app</TriggerButton>}>
            {form()}
          </FormDialog>
        }
      />
      {apps.length === 0 ? (
        <Card><EmptyState icon={Grid3x3} title="Danh mục đang trống" hint="Thêm các app nghiệp vụ của tổ chức (CRM, nhân sự, kế toán…) để có thể cấp cho phòng ban." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {apps.map((a) => (
            <Card key={a.id} className={`p-5 ${a.status === "disabled" ? "opacity-70" : ""}`}>
              <div className="flex items-start gap-3.5">
                <AppIcon icon={a.icon} color={a.color} size="lg" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold text-slate-900">{a.name}</h2>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500"><Link2 className="size-3 shrink-0" /> {a.origin}</p>
                </div>
                <div className="-mr-1.5 -mt-1 flex shrink-0">
                  <FormDialog title="Sửa app" description={a.origin} action={saveAppAction} size="lg" trigger={<TriggerButton variant="ghost" size="sm" title="Sửa"><Pencil className="size-4" /></TriggerButton>}>
                    {form(a)}
                  </FormDialog>
                  <FormDialog title="Xoá app khỏi danh mục?" description={`«${a.name}» sẽ bị gỡ khỏi ${a.departments} phòng đang dùng. Không hoàn tác được.`} action={deleteAppAction} submitLabel="Xoá app" submitVariant="danger" size="sm" trigger={<TriggerButton variant="ghost" size="sm" title="Xoá" className="hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></TriggerButton>}>
                    <input type="hidden" name="id" value={a.id} />
                    <p className="text-sm text-slate-600">Muốn tạm ngưng thay vì xoá? Chọn <b>Tắt</b> trong mục Sửa — cấu hình quyền sẽ được giữ lại.</p>
                  </FormDialog>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-500">Trần:</span><LevelBadge level={a.maxLevel} />
                {a.status === "disabled" && <Badge tone="rose">Đang tắt</Badge>}
                {a.tags.map((t) => <Badge key={t} tone="slate">#{t}</Badge>)}
              </div>
              <p className="mt-3 text-xs text-slate-500">{a.departments === 0 ? "Chưa phòng nào dùng" : `Đang cấp cho ${a.departments} phòng`}</p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
