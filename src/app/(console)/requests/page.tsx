import Link from "next/link";
import { Check, Inbox, X } from "lucide-react";
import { guard, requireActor } from "@/server/session";
import { listAccessRequests } from "@/server/services/requests";
import { resolveRequestAction } from "@/app/actions/requests";
import { Badge, Card, EmptyState, PageHeader, formatDateTime } from "@/components/ui/primitives";
import { FormDialog, TextField, TriggerButton } from "@/components/ui/form";

export default async function RequestsPage() {
  const actor = await requireActor();
  const rows = await guard(() => listAccessRequests(actor));
  const open = rows.filter((r) => r.status === "open");
  const done = rows.filter((r) => r.status !== "open");

  const resolveForm = (id: string, status: "resolved" | "declined") => (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <TextField label="Ghi chú cho người xin (không bắt buộc)" name="note" placeholder={status === "resolved" ? "Đã cấp mức M0 cho phòng X" : "Lý do từ chối"} />
    </>
  );

  return (
    <>
      <PageHeader
        title="Yêu cầu quyền"
        description={
          <>
            Nhân viên bấm «Xin quyền» trong Hub sẽ gửi yêu cầu về đây. Yêu cầu <b>không tự cấp quyền</b>: để cấp, vào <Link href="/access" className="text-indigo-600 underline">Phân quyền app</Link> rồi quay lại bấm «Đã cấp». Trưởng phòng chỉ thấy yêu cầu của thành viên phòng mình.
          </>
        }
      />
      {rows.length === 0 ? (
        <Card><EmptyState icon={Inbox} title="Chưa có yêu cầu nào" hint="Khi nhân viên xin quyền từ Hub, yêu cầu sẽ hiện ở đây." /></Card>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Đang chờ ({open.length})</h2>
            <Card className="divide-y divide-slate-100">
              {open.length === 0 && <p className="px-5 py-4 text-sm text-slate-500">Không có yêu cầu nào đang chờ.</p>}
              {open.map((r) => (
                <div key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4" data-testid="request-row">
                  <div className="min-w-0 flex-1 basis-72">
                    <p className="text-sm font-medium text-slate-900">{r.userName} <span className="font-normal text-slate-500">· {r.userEmail}</span></p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {r.departments.map((d) => <Badge key={d} tone="slate">{d}</Badge>)}
                      <span>{formatDateTime(r.createdAt)}</span>
                    </p>
                    <p className="mt-2 text-sm text-slate-800">
                      Xin {r.appName ? <>app <b>{r.appName}</b></> : "quyền"}
                      {r.message ? <>: <span className="text-slate-600">«{r.message}»</span></> : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <FormDialog title="Đánh dấu đã cấp" description={`${r.userName}${r.appName ? ` — ${r.appName}` : ""}`} action={resolveRequestAction} submitLabel="Đã cấp" size="sm" trigger={<TriggerButton variant="secondary" size="sm"><Check className="size-3.5" /> Đã cấp</TriggerButton>}>
                      {resolveForm(r.id, "resolved")}
                    </FormDialog>
                    <FormDialog title="Từ chối yêu cầu" description={`${r.userName}${r.appName ? ` — ${r.appName}` : ""}`} action={resolveRequestAction} submitLabel="Từ chối" submitVariant="danger" size="sm" trigger={<TriggerButton variant="ghost" size="sm" className="hover:bg-rose-50 hover:text-rose-600"><X className="size-3.5" /> Từ chối</TriggerButton>}>
                      {resolveForm(r.id, "declined")}
                    </FormDialog>
                  </div>
                </div>
              ))}
            </Card>
          </section>
          {done.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Đã xử lý</h2>
              <Card className="divide-y divide-slate-100">
                {done.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                    <Badge tone={r.status === "resolved" ? "emerald" : "rose"}>{r.status === "resolved" ? "Đã cấp" : "Từ chối"}</Badge>
                    <span className="font-medium text-slate-800">{r.userName}</span>
                    <span className="text-slate-500">{r.appName ?? "quyền khác"}</span>
                    <span className="text-xs text-slate-400">{r.resolvedBy ? `bởi ${r.resolvedBy}` : ""}{r.resolvedNote ? ` · ${r.resolvedNote}` : ""}</span>
                  </div>
                ))}
              </Card>
            </section>
          )}
        </div>
      )}
    </>
  );
}
