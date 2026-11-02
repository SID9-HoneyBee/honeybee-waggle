"use client";

import { useState } from "react";
import type { ApprovalPolicy, SessionSummary } from "@honeybee-waggle/schema";
import { useDialog } from "@/lib/dialog";
import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";

export const APPROVAL_LABEL: Record<ApprovalPolicy, string> = {
  writes: "수정만 확인",
  all: "매번 확인",
  none: "모두 자동",
};

const APPROVAL_OPTIONS: { value: ApprovalPolicy; desc: string }[] = [
  { value: "writes", desc: "읽기는 자동, 파일을 고칠 때만 변경 내용을 보여주고 물어봐." },
  { value: "all", desc: "파일 목록·읽기까지 전부 물어봐." },
  { value: "none", desc: "묻지 않고 실행해. 연결 폴더 밖으로는 여전히 못 나가." },
];

/**
 * API 세션에 폴더를 연결하는 창. 폴더는 직접 입력하거나, 다른 세션의 작업 폴더에서 고른다.
 * 연결 전에 토큰 경고를 한 번 더 띄운다. 폴더 전체를 열어두면 모델이 탐색하면서 파일을 여러 개 읽기 때문이다.
 */
export function FolderConnect({ session, onClose }: { session: SessionSummary; onClose: () => void }) {
  const client = useWaggleClient();
  const dialog = useDialog();
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
        title: "폴더 전체를 연결할까?",
        message:
          "폴더를 연결하면 모델이 필요한 파일을 찾느라 여러 파일을 읽으면서 토큰을 많이 쓸 수 있어.\n" +
          "고칠 파일이 정해져 있다면 입력창의 📄 파일 첨부로 그 파일만 붙이는 걸 권장해.",
        tone: "warning",
        confirmLabel: "그래도 연결",
        cancelLabel: "돌아가기",
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
        <h2 className="font-semibold">📁 폴더 연결</h2>
        <p className="text-sm text-neutral-500">
          연결한 폴더 안에서만 파일 목록·읽기·수정을 할 수 있어. 셸 명령은 실행하지 않아.
        </p>

        <label className="block space-y-1">
          <span className="text-sm font-medium">폴더 경로</span>
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
          <legend className="mb-1 text-sm font-medium">승인 방식</legend>
          {APPROVAL_OPTIONS.map((o) => (
            <label key={o.value} className="flex cursor-pointer gap-2 text-sm">
              <input type="radio" name="approval" checked={approval === o.value} onChange={() => setApproval(o.value)} className="mt-1" />
              <span>
                <span className="font-medium">{APPROVAL_LABEL[o.value]}</span>
                <span className="block text-neutral-500">{o.desc}</span>
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
              연결 해제
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
              취소
            </button>
            <button
              type="submit"
              disabled={busy || !folder.trim()}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              연결
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
