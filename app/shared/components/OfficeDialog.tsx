import {
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  Show,
  type Component,
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  acquireModalScrollLock,
  handleModalKeyDown,
  isImeComposing,
  restoreFocus,
} from "../lib/dialog-a11y";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible in-app confirmation modal replacing native `window.confirm()`.
 * Traps Tab/Shift+Tab, ignores IME composition on Escape, locks body scroll
 * with ref-counting, defaults focus to Cancel for destructive actions, and
 * restores focus to the opener (falling back to `#main`) on close.
 */
export const ConfirmDialog: Component<ConfirmDialogProps> = (props) => {
  const titleId = createUniqueId();
  const descId = createUniqueId();
  let dialogRef: HTMLDivElement | undefined;
  let cancelBtnRef: HTMLButtonElement | undefined;
  let confirmBtnRef: HTMLButtonElement | undefined;
  let pointerDownOnBackdrop = false;

  createEffect(() => {
    if (!props.open) return;
    pointerDownOnBackdrop = false;
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const releaseScrollLock = acquireModalScrollLock();

    queueMicrotask(() => {
      if (props.danger) cancelBtnRef?.focus();
      else confirmBtnRef?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      handleModalKeyDown(e, dialogRef, () => {
        if (!props.busy) props.onCancel();
      });
    };

    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown, true);
      releaseScrollLock();
      queueMicrotask(() => restoreFocus(opener));
    });
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
          onPointerDown={(e) => {
            pointerDownOnBackdrop = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            const startedOnBackdrop = pointerDownOnBackdrop;
            pointerDownOnBackdrop = false;
            if (startedOnBackdrop && e.target === e.currentTarget && !props.busy) {
              props.onCancel();
            }
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            tabIndex={-1}
            class="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 text-gray-900 shadow-2xl outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId} class="text-base font-semibold leading-snug">
              {props.title}
            </h2>
            <p
              id={descId}
              class="mt-2.5 text-sm leading-relaxed text-gray-600 dark:text-neutral-300"
            >
              {props.message}
            </p>
            <div class="mt-6 flex flex-wrap justify-end gap-2">
              <button
                ref={cancelBtnRef}
                type="button"
                disabled={props.busy}
                onClick={() => props.onCancel()}
                class="min-h-11 sm:min-h-10 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                {props.cancelLabel}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                disabled={props.busy}
                onClick={() => props.onConfirm()}
                class={props.danger
                  ? "min-h-11 sm:min-h-10 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-800"
                  : "min-h-11 sm:min-h-10 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-800"}
              >
                {props.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  inputType?: "text" | "url";
  confirmLabel: string;
  cancelLabel: string;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Accessible in-app text/URL prompt dialog replacing native `window.prompt()`.
 * Includes inline `role="alert"` validation, IME-safe Enter/Escape handling,
 * full Tab/Shift+Tab focus trap, ref-counted scroll lock, and opener focus return.
 */
export const PromptDialog: Component<PromptDialogProps> = (props) => {
  const titleId = createUniqueId();
  const inputId = createUniqueId();
  const errorId = createUniqueId();
  const [value, setValue] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  let dialogRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let pointerDownOnBackdrop = false;

  createEffect(() => {
    if (!props.open) return;
    pointerDownOnBackdrop = false;
    setValue(props.initialValue ?? "");
    setError(null);
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const releaseScrollLock = acquireModalScrollLock();

    queueMicrotask(() => {
      inputRef?.focus();
      inputRef?.select();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      handleModalKeyDown(e, dialogRef, () => props.onCancel());
    };

    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown, true);
      releaseScrollLock();
      queueMicrotask(() => restoreFocus(opener));
    });
  });

  const submit = (e?: Event) => {
    e?.preventDefault();
    const trimmed = value().trim();
    const validationError = props.validate ? props.validate(trimmed) : null;
    if (validationError) {
      setError(validationError);
      inputRef?.focus();
      return;
    }
    props.onSubmit(trimmed);
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
          onPointerDown={(e) => {
            pointerDownOnBackdrop = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            const startedOnBackdrop = pointerDownOnBackdrop;
            pointerDownOnBackdrop = false;
            if (startedOnBackdrop && e.target === e.currentTarget) {
              props.onCancel();
            }
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            class="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 text-gray-900 shadow-2xl outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId} class="text-base font-semibold leading-snug">
              {props.title}
            </h2>
            <form class="mt-4" onSubmit={submit} noValidate>
              <label
                for={inputId}
                class="block text-sm font-medium text-gray-700 dark:text-neutral-300"
              >
                {props.label}
              </label>
              <input
                ref={inputRef}
                id={inputId}
                type={props.inputType ?? "text"}
                value={value()}
                placeholder={props.placeholder}
                aria-invalid={error() ? "true" : undefined}
                aria-describedby={error() ? errorId : undefined}
                onInput={(e) => {
                  const next = e.currentTarget.value;
                  setValue(next);
                  if (error() && props.validate) {
                    setError(props.validate(next.trim()));
                  }
                }}
                onKeyDown={(e) => {
                  if (isImeComposing(e)) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                class="mt-1.5 w-full rounded-lg border bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:bg-neutral-900 dark:text-neutral-100"
                classList={{
                  "border-red-500 dark:border-red-400": Boolean(error()),
                  "border-gray-300 dark:border-neutral-600": !error(),
                }}
              />
              <Show when={error()}>
                <p
                  id={errorId}
                  role="alert"
                  class="mt-1.5 text-xs font-medium text-red-700 dark:text-red-300"
                >
                  {error()}
                </p>
              </Show>
              <div class="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => props.onCancel()}
                  class="min-h-11 sm:min-h-10 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  {props.cancelLabel}
                </button>
                <button
                  type="submit"
                  class="min-h-11 sm:min-h-10 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-800"
                >
                  {props.confirmLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Portal>
    </Show>
  );
};
