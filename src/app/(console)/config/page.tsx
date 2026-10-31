import { Lock, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { guard, requireActor } from "@/server/session";
import { requireTenantAdmin } from "@/server/actor";
import { listConfig } from "@/server/services/config";
import { listDepartments } from "@/server/services/departments";
import { clearConfigAction, saveConfigAction } from "@/app/actions/config";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { CheckField, FormDialog, SelectField, TextField, TriggerButton } from "@/components/ui/form";
import { ORG_CONFIG_KEYS, PERSONAL_CONFIG_KEYS } from "@/lib/config-keys";

const GROUP_LABEL = { model: "Mô hình & nhà cung cấp", privacy: "Riêng tư & dữ liệu", agent: "Agent" } as const;

export default async function ConfigPage() {
  const actor = await requireActor();
  await guard(() => requireTenantAdmin(actor));
  const [entries, depts] = await Promise.all([listConfig(actor), listDepartments(actor)]);

  return (
    <>
      <PageHeader
        title="Cấu hình chung"
        description="Cấu hình KHÔNG bí mật mà Hub của mọi người dùng nhận qua gói quyền đã ký. Có hai tầng: toàn tổ chức và theo phòng ban. Giá trị đã KHOÁ thì phòng ban và người dùng không đổi được; giá trị chưa khoá chỉ là mặc định. Khoá API và token đặt ở mục Khoá & token."
      />
      <div className="space-y-6">
        {(["model", "privacy", "agent"] as const).map((g) => (
          <section key={g}>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">{GROUP_LABEL[g]}</h2>
            <Card className="divide-y divide-slate-100">
              {ORG_CONFIG_KEYS.filter((k) => k.group === g).map((k) => {
                const mine = entries.filter((e) => e.key === k.env);
                const org = mine.find((e) => e.scope === "org");
                const personal = PERSONAL_CONFIG_KEYS.includes(k.env);
                const form = (deptId: string, cur?: { value: string; locked: boolean }) => (
                  <>
                    <input type="hidden" name="key" value={k.env} />
                    <SelectField label="Áp dụng cho" name="deptId" defaultValue={deptId} options={[{ value: "", label: "Toàn tổ chức" }, ...depts.map((d) => ({ value: d.id, label: `Phòng ${d.name}` }))]} hint="Giá trị theo phòng ghi đè giá trị toàn tổ chức, trừ khi giá trị toàn tổ chức đã khoá." />
                    {k.kind === "enum" ? (
                      <SelectField label={k.label} name="value" defaultValue={cur?.value ?? k.options?.[0]} options={(k.options ?? []).map((o) => ({ value: o, label: o }))} hint={k.hint} required />
                    ) : (
                      <TextField label={k.label} name="value" defaultValue={cur?.value} hint={k.hint} placeholder={k.kind === "url" ? "https://…" : ""} required />
                    )}
                    <CheckField label="Khoá — người dùng và phòng ban không đổi được" name="locked" defaultChecked={cur?.locked ?? false} hint={personal ? "Không khoá: người dùng được tự chỉnh nhưng chỉ theo chiều thu hẹp (ít hơn hoặc bằng giá trị này)." : "Không khoá: chỉ là giá trị mặc định cho người dùng."} />
                  </>
                );
                return (
                  <div key={k.env} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="text-sm font-medium text-slate-900">{k.label}</p>
                      <p className="mt-0.5 text-xs text-slate-500"><code>{k.env}</code>{personal ? " · người dùng tự chỉnh được khi chưa khoá" : ""}</p>
                    </div>
                    <div className="flex min-w-0 flex-[2] basis-72 flex-wrap items-center gap-1.5">
                      {mine.length === 0 && <span className="text-xs text-slate-400">Chưa đặt — Hub dùng giá trị của máy</span>}
                      {mine.map((e) => (
                        <span key={`${e.scope}${e.deptId ?? ""}`} className="inline-flex items-center gap-1">
                          <Badge tone={e.scope === "org" ? "indigo" : "violet"}>{e.scope === "org" ? "Tổ chức" : `Phòng ${e.deptName}`}: {e.value}</Badge>
                          {e.locked && <Lock className="size-3.5 text-amber-600" aria-label="Đã khoá" />}
                          <FormDialog title="Bỏ giá trị này?" description={`${k.label} — ${e.scope === "org" ? "toàn tổ chức" : `phòng ${e.deptName}`}`} action={clearConfigAction} submitLabel="Bỏ giá trị" submitVariant="danger" size="sm"
                            trigger={<TriggerButton variant="ghost" size="sm" title="Bỏ giá trị" className="hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-3.5" /></TriggerButton>}>
                            <input type="hidden" name="key" value={k.env} />
                            <input type="hidden" name="deptId" value={e.deptId ?? ""} />
                            <p className="text-sm text-slate-600">Hub sẽ quay về giá trị của tầng dưới (hoặc của chính máy người dùng).</p>
                          </FormDialog>
                        </span>
                      ))}
                    </div>
                    <FormDialog title={k.label} description={k.env} action={saveConfigAction} size="md" trigger={<TriggerButton variant="secondary" size="sm"><Pencil className="size-3.5" /> {org ? "Sửa / thêm" : "Đặt giá trị"}</TriggerButton>}>
                      {form("", org)}
                    </FormDialog>
                  </div>
                );
              })}
            </Card>
          </section>
        ))}
        {entries.length === 0 && <p className="flex items-center gap-2 text-xs text-slate-500"><SlidersHorizontal className="size-4" /> Chưa đặt giá trị nào — Hub dùng cấu hình của chính từng máy.</p>}
      </div>
    </>
  );
}
