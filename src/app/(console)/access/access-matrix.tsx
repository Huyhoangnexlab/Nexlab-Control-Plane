"use client";

import { useState, useTransition } from "react";
import { Check, Lock, Loader2 } from "lucide-react";
import { setLevelAction } from "@/app/actions/apps";
import { toast } from "@/components/ui/toast";
import { AppIcon, Avatar, Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { ASSIGNABLE_LEVELS, LEVEL_HINT, LEVEL_LABEL, levelRank, type Level } from "@/lib/levels";
import type { MatrixData } from "@/server/services/access";

const CELL_STYLE: Record<Level, string> = {
  none: "bg-white text-slate-400 ring-slate-200 hover:ring-slate-300",
  open: "bg-slate-100 text-slate-700 ring-slate-200",
  ask: "bg-cyan-50 text-cyan-800 ring-cyan-200",
  M0: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  M1: "bg-violet-50 text-violet-700 ring-violet-200",
  M2: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  M3: "bg-amber-50 text-amber-800 ring-amber-200",
};

export function AccessMatrix({ data }: { data: MatrixData }) {
  const [cells, setCells] = useState<Record<string, Level>>(data.cells);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  function change(deptId: string, appId: string, level: Level) {
    const key = `${deptId}:${appId}`;
    const prev = cells[key] ?? "none";
    if (prev === level) return;
    setCells((c) => ({ ...c, [key]: level }));
    setSaving((s) => ({ ...s, [key]: true }));
    startTransition(async () => {
      const r = await setLevelAction(deptId, appId, level);
      setSaving((s) => ({ ...s, [key]: false }));
      if (r && !r.ok) {
        setCells((c) => ({ ...c, [key]: prev }));
        toast(r.error, "error");
      } else {
        toast("Đã lưu quyền.");
      }
    });
  }

  if (data.departments.length === 0) return <p className="px-6 py-12 text-center text-sm text-slate-500">Chưa có phòng ban nào để cấp quyền.</p>;
  if (data.apps.length === 0) return <p className="px-6 py-12 text-center text-sm text-slate-500">Danh mục app đang trống — quản trị tổ chức cần thêm app trước.</p>;

  return (
    <div className="overflow-x-auto cp-scroll">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-64 border-b border-slate-200 bg-slate-50 px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">App</th>
            {data.departments.map((d) => (
              <th key={d.id} className="min-w-48 border-b border-l border-slate-200 bg-slate-50 px-3 py-3 text-left align-bottom">
                <p className="text-[13px] font-semibold normal-case text-slate-800">{d.name}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-normal text-slate-500">
                  {d.managerName ? <><Avatar name={d.managerName} size="sm" /><span className="truncate">{d.managerName}</span></> : "Chưa có trưởng phòng"}
                </p>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.apps.map((a) => (
            <tr key={a.id} className={a.status === "disabled" ? "opacity-60" : undefined}>
              <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-5 py-3">
                <div className="flex items-center gap-3">
                  <AppIcon icon={a.icon} color={a.color} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{a.name}</p>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      Trần: <b className="font-medium text-slate-700">{LEVEL_LABEL[a.maxLevel]}</b>
                      {a.status === "disabled" && <Badge tone="rose">Tắt</Badge>}
                    </p>
                  </div>
                </div>
              </td>
              {data.departments.map((d) => {
                const key = `${d.id}:${a.id}`;
                const value = cells[key] ?? "none";
                return (
                  <td key={d.id} className="border-b border-l border-slate-100 px-3 py-2.5">
                    {d.editable ? (
                      <div className="relative">
                        <select
                          aria-label={`${a.name} — ${d.name}`}
                          value={value}
                          disabled={!!saving[key]}
                          title={LEVEL_HINT[value]}
                          onChange={(e) => change(d.id, a.id, e.target.value as Level)}
                          className={cn("h-9 w-full cursor-pointer appearance-none rounded-lg border-0 py-0 pl-3 pr-8 text-[13px] font-medium ring-1 ring-inset transition focus:ring-2 focus:ring-indigo-500 disabled:cursor-wait", CELL_STYLE[value])}
                        >
                          {ASSIGNABLE_LEVELS.map((l) => {
                            const over = l !== "none" && (levelRank(l) > levelRank(a.maxLevel) || a.status === "disabled");
                            return <option key={l} value={l} disabled={over && l !== value}>{l === "none" ? "— Không cấp —" : LEVEL_LABEL[l]}{over ? " (vượt trần)" : ""}</option>;
                          })}
                        </select>
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-current opacity-70">
                          {saving[key] ? <Loader2 className="size-3.5 animate-spin" /> : <Check className={cn("size-3.5", value === "none" && "opacity-0")} />}
                        </span>
                      </div>
                    ) : (
                      <span className={cn("inline-flex h-9 w-full items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium ring-1 ring-inset", CELL_STYLE[value])}>
                        <Lock className="size-3 opacity-50" />{value === "none" ? "—" : LEVEL_LABEL[value]}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
