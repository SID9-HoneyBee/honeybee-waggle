"use client";

import type { ToolKind } from "@honeybee-waggle/schema";

const KIND_ICON: Record<ToolKind, string> = {
  shell: "⌘",
  file_read: "📄",
  file_edit: "✏️",
  web: "🌐",
  mcp: "🔌",
  other: "🔧",
};

interface Props {
  kind: ToolKind;
  name: string;
  input: unknown;
  result?: { ok: boolean; output?: string };
  /** run이 끝났는데 결과가 없으면 취소/실패로 끊긴 것이라 "실행 중"으로 두면 안 된다 */
  runEnded: boolean;
}

// 툴 호출은 대화 흐름 중간에 많이 끼어서, 기본은 한 줄 요약만 보이고 펼쳐야 입력/출력이 보이게 한다.
export function ToolCard({ kind, name, input, result, runEnded }: Props) {
  const status = result ? (result.ok ? "✓" : "✗") : runEnded ? "–" : "…";
  const statusClass = result
    ? result.ok
      ? "text-emerald-600"
      : "text-red-600"
    : runEnded
      ? "text-neutral-400"
      : "animate-pulse text-amber-500";

  return (
    <details className="group rounded-md border border-neutral-200 text-sm dark:border-neutral-800">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5">
        <span>{KIND_ICON[kind]}</span>
        <span className="font-medium">{name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500">{summarize(input)}</span>
        <span className={statusClass}>{status}</span>
      </summary>
      <div className="space-y-2 border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs text-neutral-600 dark:text-neutral-400">
          {JSON.stringify(input, null, 2)}
        </pre>
        {result?.output && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-900">
            {result.output}
          </pre>
        )}
      </div>
    </details>
  );
}

// 도구마다 입력 형태가 다르다. 사람이 알아볼 대표 필드 하나만 골라 요약에 쓴다.
function summarize(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "pattern", "url", "query", "description"]) {
    if (typeof o[key] === "string") return o[key];
  }
  return "";
}
