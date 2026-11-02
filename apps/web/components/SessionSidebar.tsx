"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";
import { formatRelative } from "@/lib/format";
import { ModeBadge } from "./ModeBadge";

const CONN_LABEL = { connecting: "연결 중…", open: "서버 연결됨", closed: "연결 끊김 · 재시도 중" } as const;
const CONN_DOT = { connecting: "bg-amber-400", open: "bg-emerald-500", closed: "bg-red-500" } as const;

export function SessionSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const client = useWaggleClient();

  async function remove(id: string, title: string, running: boolean) {
    const warn = running ? "\n실행 중인 작업은 중단돼." : "";
    if (!confirm(`"${title || "(제목 없음)"}" 세션과 대화 기록을 삭제할까?${warn}`)) return;
    try {
      await client.deleteSession(id);
      // 지금 보고 있던 세션이면 빈 화면("세션을 찾을 수 없어")에 남지 않게 새 세션 화면으로 보낸다.
      if (pathname === `/sessions/${id}`) router.push("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }
  const sessions = useWaggle((s) => s.sessions);
  const conn = useWaggle((s) => s.conn);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="font-semibold">🐝 waggle</span>
        <Link
          href="/"
          className="rounded-md bg-neutral-900 px-2.5 py-1 text-sm text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          + 새 세션
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 && conn === "open" && (
          <p className="px-2 py-4 text-sm text-neutral-500">아직 세션이 없어.</p>
        )}
        {sessions.map((s) => {
          const active = pathname === `/sessions/${s.id}`;
          return (
            <Link
              key={s.id}
              href={`/sessions/${s.id}`}
              className={`group mb-0.5 block rounded-md px-2 py-2 text-sm ${
                active ? "bg-neutral-200 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
              }`}
            >
              <div className="flex items-center gap-2">
                {s.running && <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500" title="실행 중" />}
                <span className="min-w-0 flex-1 truncate">{s.title || "(제목 없음)"}</span>
                <ModeBadge profileId={s.profileId} />
                <button
                  type="button"
                  title="세션 삭제"
                  aria-label="세션 삭제"
                  onClick={(e) => {
                    // 버튼이 Link 안에 있어서 막지 않으면 삭제 확인창과 동시에 세션 화면으로 이동한다.
                    e.preventDefault();
                    e.stopPropagation();
                    void remove(s.id, s.title, s.running);
                  }}
                  className="hidden shrink-0 rounded px-1 text-neutral-400 hover:bg-neutral-300 hover:text-red-600 group-hover:block dark:hover:bg-neutral-700"
                >
                  ✕
                </button>
              </div>
              <div className="mt-0.5 truncate text-xs text-neutral-500">
                {formatRelative(s.updatedAt)} · {s.cwd}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-800">
        <span className={`size-2 rounded-full ${CONN_DOT[conn]}`} />
        <span className="flex-1">{CONN_LABEL[conn]}</span>
        <Link
          href="/settings"
          className={`rounded px-1.5 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-800 ${
            pathname === "/settings" ? "bg-neutral-200 dark:bg-neutral-800" : ""
          }`}
        >
          ⚙ 설정
        </Link>
      </div>
    </aside>
  );
}
