"use client";

import { useState } from "react";
import type { ApprovalPolicy, SessionSummary } from "@honeybee-waggle/schema";
import { useDialog } from "@/lib/dialog";
import { useT } from "@/lib/i18n";
import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";

export const APPROVAL_KEY = { writes: "approval.writes", all: "approval.all", none: "approval.none" } as const;
const APPROVAL_DESC_KEY = {
  writes: "approval.writes.desc",
  all: "approval.all.desc",
  none: "approval.none.desc",
} as const;
const APPROVAL_ORDER: ApprovalPolicy[] = ["writes", "all", "none"];

/**
 * API 세션에 폴더를 연결하는 창. 폴더는 직접 입력하거나, 다른 세션의 작업 폴더에서 고른다.
 * 연결 전에 토큰 경고를 한 번 더 띄운다. 폴더 전체를 열어두면 모델이 탐색하면서 파일을 여러 개 읽기 때문이다.
 */
export function FolderConnect({ session, onClose }: { session: SessionSummary; onClose: () => void }) {
  const client = useWaggleClient();
  const dialog = useDialog();
  const t = useT();
  const sessions = useWaggle((s) => s.sessions);
  const [folder, setFolder] = useState(session.cwd);
  const [approval, setApproval] = useState<ApprovalPolicy>(session.approval ?? "writes");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // 다른 세션(특히 구독 에이전트)에서 쓰던 폴더를 이어 쓰는 경우가 많아서 바로 고를 수 있게 모아준다.
  const recent = [...new Set(sessions.map((s) => s.cwd).filter((c) => c && c !== folder))].slice(0, 5);

  async function save(next: string | null) {
    if (next !== null) {
      const ok = await dialog.confirm({
        title: t("folder.warnTitle"),
        message: t("folder.warnMessage"),
        tone: "warning",
        confirmLabel: t("folder.warnConfirm"),
        cancelLabel: t("folder.warnCancel"),
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await client.setFolder(session.id, next, approval);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(folder.trim());
        }}
        className="w-full max-w-lg space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        <h2 className="font-semibold">{t("folder.title")}</h2>
        <p className="text-sm text-neutral-500">{t("folder.desc")}</p>

        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("folder.path")}</span>
          <input
            required
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="C:\Projects\my-app"
            className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-neutral-700"
          />
        </label>
        {recent.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {recent.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFolder(c)}
                className="max-w-full truncate rounded-full border border-neutral-300 px-2 py-0.5 font-mono text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm font-medium">{t("folder.approval")}</legend>
          {APPROVAL_ORDER.map((value) => (
            <label key={value} className="flex cursor-pointer gap-2 text-sm">
              <input type="radio" name="approval" checked={approval === value} onChange={() => setApproval(value)} className="mt-1" />
              <span>
                <span className="font-medium">{t(APPROVAL_KEY[value])}</span>
                <span className="block text-neutral-500">{t(APPROVAL_DESC_KEY[value])}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-between gap-2">
          {session.cwd ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(null)}
              className="rounded-md border border-red-400 px-3 py-1.5 text-sm text-red-600 disabled:opacity-40"
            >
              {t("folder.disconnect")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy || !folder.trim()}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {t("folder.connect")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
