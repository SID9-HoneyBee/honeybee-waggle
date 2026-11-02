"use client";

import type { ApprovalRequest } from "@honeybee-waggle/schema";
import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";

const ACTION_LABEL = { list: "폴더 목록 보기", read: "파일 읽기", write: "파일 수정" } as const;
const EMPTY: ApprovalRequest[] = [];

/**
 * 도구 실행 승인 요청. 모델은 여기서 답할 때까지 멈춰 있다.
 * 입력창 바로 위에 둬서, 대화를 위로 스크롤해 읽고 있어도 대기 중인 요청을 놓치지 않게 한다.
 */
export function ApprovalPanel({ sessionId }: { sessionId: string }) {
  const client = useWaggleClient();
  const requests = useWaggle((s) => s.approvals[sessionId] ?? EMPTY);
  if (requests.length === 0) return null;

  return (
    <div className="mx-auto mb-2 max-w-3xl space-y-2">
      {requests.map((r) => (
        <div key={r.approvalId} className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
          <div className="flex items-center gap-2">
            <span>{r.action === "write" ? "✏️" : "📄"}</span>
            <span className="font-medium">{ACTION_LABEL[r.action]}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.path}</span>
          </div>
          {r.diff && <DiffView diff={r.diff} />}
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => client.respondApproval(sessionId, r.approvalId, false)}
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-white dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              거절
            </button>
            <button
              onClick={() => client.respondApproval(sessionId, r.approvalId, true)}
              className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              승인
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  // 파일 이름 헤더(===, ---, +++)는 위에 경로로 이미 보여주므로 생략하고 변경 줄만 색으로 구분한다.
  const lines = diff.split("\n").filter((l) => !/^(={3,}|-{3} |\+{3} |Index:)/.test(l));
  return (
    <pre className="mt-2 max-h-72 overflow-auto rounded border border-neutral-200 bg-white text-xs dark:border-neutral-800 dark:bg-neutral-950">
      {lines.map((l, i) => (
        <div
          key={i}
          className={`px-2 ${
            l.startsWith("+")
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              : l.startsWith("-")
                ? "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300"
                : l.startsWith("@@")
                  ? "text-neutral-400"
                  : ""
          }`}
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}
