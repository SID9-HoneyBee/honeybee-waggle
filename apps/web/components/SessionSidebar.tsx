"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionSummary } from "@honeybee-waggle/schema";
import { useDialog } from "@/lib/dialog";
import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";
import { formatRelative } from "@/lib/format";
import { ModeBadge } from "./ModeBadge";

const CONN_LABEL = { connecting: "연결 중…", open: "서버 연결됨", closed: "연결 끊김 · 재시도 중" } as const;
const CONN_DOT = { connecting: "bg-amber-400", open: "bg-emerald-500", closed: "bg-red-500" } as const;

export function SessionSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const client = useWaggleClient();
  const dialog = useDialog();
  const sessions = useWaggle((s) => s.sessions);
  const conn = useWaggle((s) => s.conn);

  async function remove(s: SessionSummary) {
    const ok = await dialog.confirm({
      title: "세션을 삭제할까?",
      message: `"${s.title || "(제목 없음)"}" 세션과 대화 기록이 지워져.${s.running ? "\n실행 중인 작업은 중단돼." : ""}`,
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    try {
      await client.deleteSession(s.id);
      // 지금 보고 있던 세션이면 빈 화면("세션을 찾을 수 없어")에 남지 않게 새 세션 화면으로 보낸다.
      if (pathname === `/sessions/${s.id}`) router.push("/");
    } catch (err) {
      await dialog.alert({ title: "삭제하지 못했어", message: errorText(err), tone: "danger" });
    }
  }

  async function rename(s: SessionSummary) {
    const title = await dialog.prompt({ title: "세션 제목 변경", defaultValue: s.title, confirmLabel: "변경" });
    if (title === null || title.trim() === s.title) return;
    try {
      await client.renameSession(s.id, title);
    } catch (err) {
      await dialog.alert({ title: "제목을 바꾸지 못했어", message: errorText(err), tone: "danger" });
    }
  }

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
              onDoubleClick={(e) => {
                e.preventDefault();
                void rename(s);
              }}
              className={`group mb-0.5 block rounded-md px-2 py-2 text-sm ${
                active ? "bg-neutral-200 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
              }`}
            >
              <div className="flex items-center gap-1.5">
                {s.running && <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500" title="실행 중" />}
                <span className="min-w-0 flex-1 truncate">{s.title || "(제목 없음)"}</span>
                <ModeBadge profileId={s.profileId} />
                <ItemButton label="제목 변경" onClick={() => void rename(s)}>
                  ✎
                </ItemButton>
                <ItemButton label="세션 삭제" danger onClick={() => void remove(s)}>
                  ✕
                </ItemButton>
              </div>
              <div className="mt-0.5 truncate text-xs text-neutral-500">
                {formatRelative(s.updatedAt)} · {s.cwd || "API 대화"}
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

function ItemButton(props: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      onClick={(e) => {
        // 버튼이 Link 안에 있어서 막지 않으면 버튼 동작과 동시에 세션 화면으로 이동한다.
        e.preventDefault();
        e.stopPropagation();
        props.onClick();
      }}
      className={`hidden shrink-0 rounded px-1 text-neutral-400 hover:bg-neutral-300 group-hover:block dark:hover:bg-neutral-700 ${
        props.danger ? "hover:text-red-600" : "hover:text-neutral-800 dark:hover:text-neutral-100"
      }`}
    >
      {props.children}
    </button>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
