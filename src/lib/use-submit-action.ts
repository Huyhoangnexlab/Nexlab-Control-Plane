"use client";

import { useActionState, useTransition, type FormEvent } from "react";
import type { ActionResult } from "./action-result";

/**
 * Gửi form tới Server Action NHƯNG KHÔNG để React 19 tự xoá các ô đã nhập khi action xong.
 * (Với `<form action={fn}>`, React reset form sau mỗi lần gửi — người dùng gõ sai một ô là mất sạch những ô còn lại.)
 */
export function useSubmitAction(action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>) {
  const [state, dispatch, actionPending] = useActionState(action, null as ActionResult);
  const [transitionPending, startTransition] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return { state, onSubmit, pending: actionPending || transitionPending };
}
