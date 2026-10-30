import { Info } from "lucide-react";
import { guard, requireActor } from "@/server/session";
import { isTenantAdmin } from "@/server/actor";
import { getAccessMatrix } from "@/server/services/access";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { ASSIGNABLE_LEVELS, LEVEL_HINT, LEVEL_LABEL } from "@/lib/levels";
import { AccessMatrix } from "./access-matrix";

export default async function AccessPage() {
  const actor = await requireActor();
  const data = await guard(() => getAccessMatrix(actor));
  const admin = isTenantAdmin(actor);
  return (
    <>
      <PageHeader
        title="Phân quyền app"
        description={admin ? "Mỗi ô là mức quyền của một phòng với một app. Đổi là lưu ngay, có ghi nhật ký." : "Bạn chỉ chỉnh được các phòng do mình quản lý, và chỉ chọn trong danh mục app của tổ chức, không vượt trần của từng app."}
      />
      <Card className="overflow-hidden">
        <AccessMatrix data={data} />
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Info className="size-4 text-slate-400" /> Các mức quyền</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          {ASSIGNABLE_LEVELS.map((l) => (
            <div key={l} className="flex items-start gap-3">
              <Badge tone={l === "none" ? "slate" : l === "open" ? "slate" : l === "ask" ? "cyan" : l === "M0" ? "indigo" : l === "M1" ? "violet" : "emerald"} className="mt-0.5 min-w-16 justify-center">{l === "none" ? "Không" : l}</Badge>
              <div className="text-sm"><dt className="font-medium text-slate-800">{LEVEL_LABEL[l]}</dt><dd className="text-slate-500">{LEVEL_HINT[l]}</dd></div>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-slate-500">Người thuộc nhiều phòng được hưởng mức cao nhất trong các phòng (nhưng không vượt trần của app). Xem kết quả ở mục «Xem trước quyền».</p>
      </Card>
    </>
  );
}
