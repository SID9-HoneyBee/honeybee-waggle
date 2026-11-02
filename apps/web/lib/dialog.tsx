"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Tone = "default" | "danger" | "warning";

interface BaseOptions {
  title: string;
  message?: React.ReactNode;
  tone?: Tone;
}
interface ConfirmOptions extends BaseOptions {
  confirmLabel?: string;
  cancelLabel?: string;
}
interface PromptOptions extends BaseOptions {
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

type Request =
  | { kind: "alert"; opts: BaseOptions; resolve: (v: void) => void }
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

interface DialogApi {
  alert: (opts: BaseOptions) => Promise<void>;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

const TONE_BUTTON: Record<Tone, string> = {
  default: "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900",
  danger: "bg-red-600 text-white hover:bg-red-700",
  warning: "bg-amber-500 text-white hover:bg-amber-600",
};
const TONE_ICON: Record<Tone, string> = { default: "💬", danger: "⚠️", warning: "💡" };

/**
 * 브라우저 alert/confirm 대신 쓰는 앱 내 메시지창.
 * 호출부는 기존처럼 `if (!(await dialog.confirm(...))) return;` 한 줄로 쓰도록 Promise를 돌려준다.
 * 동시에 여러 개가 열리면 순서대로 하나씩 보여준다 (겹쳐 뜨면 어느 질문에 답하는지 헷갈린다).
 */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const current = queue[0];

  const push = useCallback((req: Request) => setQueue((q) => [...q, req]), []);
  const api: DialogApi = {
    alert: (opts) => new Promise((resolve) => push({ kind: "alert", opts, resolve })),
    confirm: (opts) => new Promise((resolve) => push({ kind: "confirm", opts, resolve })),
    prompt: (opts) => new Promise((resolve) => push({ kind: "prompt", opts, resolve })),
  };

  function close(value: boolean | string | null) {
    if (!current) return;
    if (current.kind === "alert") current.resolve();
    else if (current.kind === "confirm") current.resolve(value === true);
    else current.resolve(typeof value === "string" ? value : null);
    setQueue((q) => q.slice(1));
  }

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && <DialogView key={queue.length} req={current} onClose={close} />}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error("DialogProvider 밖에서 사용됨");
  return api;
}

function DialogView({ req, onClose }: { req: Request; onClose: (value: boolean | string | null) => void }) {
  const tone = req.opts.tone ?? "default";
  const [value, setValue] = useState(req.kind === "prompt" ? (req.opts.defaultValue ?? "") : "");
  const primaryRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 열리자마자 키보드로 바로 답할 수 있게 포커스를 옮긴다. Esc는 취소로 본다.
  useEffect(() => {
    if (req.kind === "prompt") inputRef.current?.select();
    else primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(req.kind === "alert" ? true : null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, onClose]);

  const confirmLabel = req.kind === "alert" ? "확인" : (req.opts.confirmLabel ?? "확인");
  const cancelLabel = req.kind === "confirm" ? (req.opts.cancelLabel ?? "취소") : "취소";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        // 바깥 클릭은 취소로 본다. alert는 확인 외 선택지가 없으니 닫기만 한다.
        if (e.target === e.currentTarget) onClose(req.kind === "alert" ? true : null);
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        onSubmit={(e) => {
          e.preventDefault();
          onClose(req.kind === "prompt" ? value : true);
        }}
        className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="flex gap-3">
          <span className="text-xl leading-7">{TONE_ICON[tone]}</span>
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="font-semibold leading-7">{req.opts.title}</h2>
            {req.opts.message && (
              <div className="whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">{req.opts.message}</div>
            )}
            {req.kind === "prompt" && (
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={req.opts.placeholder}
                className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              />
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          {req.kind !== "alert" && (
            <button
              type="button"
              onClick={() => onClose(null)}
              className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={primaryRef}
            type="submit"
            disabled={req.kind === "prompt" && !value.trim()}
            className={`rounded-md px-4 py-1.5 text-sm disabled:opacity-40 ${TONE_BUTTON[tone]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
