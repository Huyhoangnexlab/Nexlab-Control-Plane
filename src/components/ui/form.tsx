"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Copy, KeyRound, Loader2, X } from "lucide-react";
import { buttonClass, type Size, type Variant } from "./primitives";
import { toast } from "./toast";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/action-result";
import { useSubmitAction } from "@/lib/use-submit-action";

/* ───────── Ngữ cảnh lỗi theo ô ───────── */
const FormCtx = createContext<{ errors: Record<string, string> }>({ errors: {} });

const inputBase =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-500";

export function Field({ label, name, hint, required, children }: { label: string; name: string; hint?: string; required?: boolean; children: (p: { id: string; invalid: boolean; className: string }) => ReactNode }) {
  const id = useId();
  const { errors } = useContext(FormCtx);
  const error = errors[name];
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children({ id, invalid: !!error, className: cn(inputBase, error ? "ring-rose-400" : "ring-slate-300") })}
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function TextField({ label, name, defaultValue, type = "text", placeholder, hint, required, autoComplete, disabled }: {
  label: string; name: string; defaultValue?: string; type?: string; placeholder?: string; hint?: string; required?: boolean; autoComplete?: string; disabled?: boolean;
}) {
  return (
    <Field label={label} name={name} hint={hint} required={required}>
      {({ id, invalid, className }) => (
        <input id={id} name={name} type={type} defaultValue={defaultValue} placeholder={placeholder} required={required} autoComplete={autoComplete ?? "off"} disabled={disabled} aria-invalid={invalid} className={className} />
      )}
    </Field>
  );
}

export function TextAreaField({ label, name, defaultValue, placeholder, hint, rows = 3 }: { label: string; name: string; defaultValue?: string; placeholder?: string; hint?: string; rows?: number }) {
  return (
    <Field label={label} name={name} hint={hint}>
      {({ id, invalid, className }) => <textarea id={id} name={name} rows={rows} defaultValue={defaultValue} placeholder={placeholder} aria-invalid={invalid} className={className} />}
    </Field>
  );
}

export function SelectField({ label, name, defaultValue, options, hint, required, disabled }: {
  label: string; name: string; defaultValue?: string; options: { value: string; label: string; disabled?: boolean }[]; hint?: string; required?: boolean; disabled?: boolean;
}) {
  return (
    <Field label={label} name={name} hint={hint} required={required}>
      {({ id, invalid, className }) => (
        <select id={id} name={name} defaultValue={defaultValue} disabled={disabled} aria-invalid={invalid} className={cn(className, "pr-8")}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function CheckboxGroup({ label, name, options, defaultValues, hint, empty }: {
  label: string; name: string; options: { value: string; label: string; hint?: string }[]; defaultValues?: string[]; hint?: string; empty?: string;
}) {
  const { errors } = useContext(FormCtx);
  return (
    <fieldset>
      <legend className="mb-1.5 block text-[13px] font-medium text-slate-700">{label}</legend>
      {options.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-500">{empty ?? "Chưa có lựa chọn."}</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50/60">
              <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValues?.includes(o.value)} className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              <span className="min-w-0">
                <span className="block font-medium text-slate-800">{o.label}</span>
                {o.hint && <span className="block text-xs text-slate-500">{o.hint}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      {errors[name] ? <p className="mt-1 text-xs text-rose-600">{errors[name]}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </fieldset>
  );
}

export function SubmitButton({ children, variant = "primary", size = "md", pendingLabel, pending }: { children: ReactNode; variant?: Variant; size?: Size; pendingLabel?: string; pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, size)}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

/* ───────── Hộp thoại ───────── */
export function Modal({ open, onClose, title, description, children, size = "md" }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn("m-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-slate-800 shadow-pop backdrop:bg-ink-950/50", width)}
    >
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 pb-4 pt-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
            </div>
            <button type="button" aria-label="Đóng" onClick={onClose} className="-mr-2 -mt-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X className="size-4.5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-amber-900">
        <KeyRound className="size-4" /> {label}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-slate-900 ring-1 ring-amber-200">{value}</code>
        <button
          type="button"
          className={buttonClass("secondary", "sm")}
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => undefined);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          {copied ? "Đã chép" : "Chép"}
        </button>
      </div>
      <p className="mt-2 text-xs text-amber-800">Chỉ hiển thị một lần. Hãy gửi cho người dùng qua kênh an toàn.</p>
    </div>
  );
}

function DialogBody({ action, children, submitLabel, submitVariant, onDone, footerExtra }: { action: FormAction; children: ReactNode; submitLabel: string; submitVariant: Variant; onDone: () => void; footerExtra?: ReactNode }) {
  const { state, onSubmit, pending } = useSubmitAction(action);
  const secret = state?.ok ? ((state.data as { tempPassword?: string | null } | undefined)?.tempPassword ?? null) : null;
  useEffect(() => {
    if (state?.ok) {
      if (state.message) toast(state.message);
      if (!secret) onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (state?.ok && secret) {
    return (
      <div className="space-y-4 overflow-y-auto px-6 py-5">
        <p className="text-sm text-slate-600">{state.message}</p>
        <CopyBox label="Mật khẩu tạm" value={secret} />
        <div className="flex justify-end pt-1">
          <button type="button" className={buttonClass("primary")} onClick={onDone}>Xong</button>
        </div>
      </div>
    );
  }
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <FormCtx.Provider value={{ errors }}>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
        <div className="space-y-4 overflow-y-auto px-6 py-5">
          {children}
          {state && !state.ok && (!state.fieldErrors || Object.keys(state.fieldErrors).length === 0) && (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{state.error}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">
          <div className="text-xs text-slate-500">{footerExtra}</div>
          <div className="flex gap-2">
            <button type="button" className={buttonClass("secondary")} onClick={onDone}>Huỷ</button>
            <SubmitButton variant={submitVariant} pendingLabel="Đang lưu…" pending={pending}>{submitLabel}</SubmitButton>
          </div>
        </div>
      </form>
    </FormCtx.Provider>
  );
}

/**
 * Nút + hộp thoại chứa form gắn với một Server Action. Mở lại là form mới hoàn toàn (state của action được reset).
 * Nếu action trả `data.tempPassword` thì hộp thoại chuyển sang màn «chép mật khẩu tạm» thay vì tự đóng.
 */
export function FormDialog({
  trigger, title, description, action, submitLabel = "Lưu", submitVariant = "primary", size = "md", children, footerExtra,
}: {
  trigger: ReactNode; title: string; description?: string; action: FormAction; submitLabel?: string; submitVariant?: Variant; size?: "sm" | "md" | "lg" | "xl"; children: ReactNode; footerExtra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={() => setOpen(true)} className="inline-flex">{trigger}</span>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description} size={size}>
        <DialogBody action={action} submitLabel={submitLabel} submitVariant={submitVariant} onDone={() => setOpen(false)} footerExtra={footerExtra}>
          {children}
        </DialogBody>
      </Modal>
    </>
  );
}

/** Nút kích hoạt dạng văn bản/icon cho FormDialog (button thật để dùng bàn phím được). */
export function TriggerButton({ children, variant = "secondary", size = "md", title, className }: { children: ReactNode; variant?: Variant; size?: Size; title?: string; className?: string }) {
  return (
    <button type="button" title={title} aria-label={title} className={buttonClass(variant, size, className)}>
      {children}
    </button>
  );
}

export function ColorField({ label, name, defaultValue = "#4f46e5", hint }: { label: string; name: string; defaultValue?: string; hint?: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Field label={label} name={name} hint={hint}>
      {({ id, className }) => (
        <div className="flex items-center gap-2">
          <input id={id} name={name} type="color" value={value} onChange={(e) => setValue(e.target.value)} className="h-9.5 w-14 cursor-pointer rounded-lg border-0 bg-white p-1 ring-1 ring-inset ring-slate-300" />
          <code className={cn(className, "w-auto flex-1 font-mono")}>{value}</code>
        </div>
      )}
    </Field>
  );
}

export function CheckField({ label, name, defaultChecked, hint }: { label: string; name: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3.5 py-3 hover:bg-slate-50 has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50/50">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
      <span className="min-w-0 text-sm">
        <span className="block font-medium text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}
