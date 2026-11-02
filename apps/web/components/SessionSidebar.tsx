"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionSummary } from "@honeybee-waggle/schema";
import { useDialog } from "@/lib/dialog";
import { useLanguage } from "@/lib/i18n";
import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";
import { formatRelative } from "@/lib/format";
import { ModeBadge } from "./ModeBadge";

const CONN_KEY = { connecting: "conn.connecting", open: "conn.open", closed: "conn.closed" } as const;
const CONN_DOT = { connecting: "bg-amber-400", open: "bg-emerald-500", closed: "bg-red-500" } as const;

export function SessionSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const client = useWaggleClient();
  const dialog = useDialog();
  const { lang, setLang, t } = useLanguage();
  const sessions = useWaggle((s) => s.sessions);
  const conn = useWaggle((s) => s.conn);

  async function remove(s: SessionSummary) {
    const title = s.title || t("common.untitled");
    const ok = await dialog.confirm({
      title: t("sidebar.deleteTitle"),
      message: `${t("sidebar.deleteMessage", { title })}${s.running ? `\n${t("sidebar.deleteRunning")}` : ""}`,
      tone: "danger",
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    try {
      await client.deleteSession(s.id);
      // 지금 보고 있던 세션이면 빈 화면("세션을 찾을 수 없어")에 남지 않게 새 세션 화면으로 보낸다.
      if (pathname === `/sessions/${s.id}`) router.push("/");
    } catch (err) {
      await dialog.alert({ title: t("sidebar.deleteFailed"), message: errorText(err), tone: "danger" });
    }
  }

  async function rename(s: SessionSummary) {
    const title = await dialog.prompt({
      title: t("sidebar.renameTitle"),
      defaultValue: s.title,
      confirmLabel: t("sidebar.renameConfirm"),
    });
    if (title === null || title.trim() === s.title) return;
    try {
      await client.renameSession(s.id, title);
    } catch (err) {
      await dialog.alert({ title: t("sidebar.renameFailed"), message: errorText(err), tone: "danger" });
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
          {t("sidebar.newSession")}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 && conn === "open" && (
          <p className="px-2 py-4 text-sm text-neutral-500">{t("sidebar.empty")}</p>
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
                {s.running && (
                  <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500" title={t("sidebar.running")} />
                )}
                <span className="min-w-0 flex-1 truncate">{s.title || t("common.untitled")}</span>
                <ModeBadge profileId={s.profileId} />
                <ItemButton label={t("sidebar.rename")} onClick={() => void rename(s)}>
                  ✎
                </ItemButton>
                <ItemButton label={t("sidebar.delete")} danger onClick={() => void remove(s)}>
                  ✕
                </ItemButton>
              </div>
              <div className="mt-0.5 truncate text-xs text-neutral-500">
                {formatRelative(s.updatedAt, t, lang)} · {s.cwd || t("sidebar.apiChat")}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-800">
        <span className={`size-2 rounded-full ${CONN_DOT[conn]}`} />
        <span className="flex-1">{t(CONN_KEY[conn])}</span>
        {/* 설정 화면까지 가지 않고 바로 바꿀 수 있게 둔다. 현재 언어가 아니라 바꿀 언어를 보여줘야 누를 이유가 분명하다 */}
        <button
          type="button"
          title={t("sidebar.switchLang")}
          onClick={() => setLang(lang === "ko" ? "en" : "ko")}
          className="rounded px-1.5 py-0.5 font-medium hover:bg-neutral-200 dark:hover:bg-neutral-800"
        >
          {lang === "ko" ? "EN" : "KO"}
        </button>
        <Link
          href="/settings"
          className={`rounded px-1.5 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-800 ${
            pathname === "/settings" ? "bg-neutral-200 dark:bg-neutral-800" : ""
          }`}
        >
          {t("sidebar.settings")}
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
