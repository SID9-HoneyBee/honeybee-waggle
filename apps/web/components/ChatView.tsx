"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AttachedFile, AttachedRef, Engine, FileAttachment, HistoryEntry, ToolKind } from "@honeybee-waggle/schema";
import { useDialog } from "@/lib/dialog";
import { profileLabel, useT } from "@/lib/i18n";
import { FILES_BASE, useSessionView, useWaggle, useWaggleClient } from "@/lib/WaggleProvider";
import { MAX_FILES, MAX_TOTAL_FILE_CHARS, readTextFiles } from "@/lib/files";
import { approxTokens, formatTokens } from "@/lib/format";
import { ApprovalPanel } from "./ApprovalPanel";
import { APPROVAL_KEY, FolderConnect } from "./FolderConnect";
import { ModeBadge } from "./ModeBadge";
import { RefPicker } from "./RefPicker";
import { ToolCard } from "./ToolCard";

type Item =
  | { type: "user"; key: string; text: string; refs?: AttachedRef[]; files?: AttachedFile[]; context?: string }
  | { type: "assistant"; key: string; text: string }
  | { type: "reasoning"; key: string; text: string }
  | {
      type: "tool";
      key: string;
      kind: ToolKind;
      name: string;
      input: unknown;
      result?: { ok: boolean; output?: string };
      runEnded: boolean;
    }
  | { type: "file"; key: string; path: string; change: "add" | "modify" | "delete" }
  | { type: "usage"; key: string; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: "end"; key: string; status: string; error?: string };

const PERMISSION_KEY = {
  "read-only": "perm.read-only",
  "workspace-write": "perm.workspace-write",
  full: "perm.full",
} as const;
const VENDOR = { claude: "Anthropic", codex: "OpenAI" } as const;
const CLI_NAME = { claude: "Claude Code", codex: "Codex" } as const;
const CHANGE_KEY = { add: "change.add", modify: "change.modify", delete: "change.delete" } as const;
const END_KEY = { error: "end.error", cancelled: "end.cancelled", timeout: "end.timeout" } as const;

// 사용자가 위로 스크롤해서 예전 내용을 읽는 중이면 새 출력이 와도 끌어내리지 않는다.
const STICK_THRESHOLD_PX = 80;

export function ChatView({ sessionId }: { sessionId: string }) {
  const client = useWaggleClient();
  const t = useT();
  const view = useSessionView(sessionId);
  const session = useWaggle((s) => s.sessions.find((x) => x.id === sessionId));
  const profile = useWaggle((s) => s.profiles.find((p) => p.id === session?.profileId));
  const [folderOpen, setFolderOpen] = useState(false);
  const isChat = profile?.runtime === "chat";
  const connected = useWaggle((s) => s.conn === "open");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    client.openSession(sessionId);
    return () => client.closeSession(sessionId);
  }, [client, sessionId]);

  const items = useMemo(() => toItems(view.entries), [view.entries]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [items, view.streaming]);

  if (!session) {
    return <div className="p-8 text-sm text-neutral-500">{connected ? t("chat.notFound") : t("chat.loading")}</div>;
  }
  const label = profile ? profileLabel(t, profile.id, profile.label) : "";

  return (
    <>
      <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{session.title || t("common.untitled")}</h1>
          <p className="truncate font-mono text-xs text-neutral-500">
            {isChat
              ? `${t("chat.apiChat")} · ${profile?.model ?? ""}${session.cwd ? ` · 📁 ${session.cwd}` : ""}`
              : session.cwd}
          </p>
        </div>
        <ModeBadge profileId={session.profileId} />
        {/* API 세션은 CLI 권한 대신 폴더 연결·승인 방식을 보여준다 */}
        {isChat ? (
          <button
            onClick={() => setFolderOpen(true)}
            disabled={session.running}
            title={session.running ? t("chat.cantChangeRunning") : undefined}
            className="shrink-0 rounded-full border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {session.cwd ? `📁 ${t(APPROVAL_KEY[session.approval ?? "writes"])}` : t("chat.connectFolder")}
          </button>
        ) : (
          <span className="shrink-0 rounded-full border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700">
            {t(PERMISSION_KEY[session.permission])}
          </span>
        )}
      </header>
      {folderOpen && <FolderConnect session={session} onClose={() => setFolderOpen(false)} />}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
        }}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl space-y-3 px-5 py-6">
          {!view.loaded && <p className="text-sm text-neutral-500">{t("chat.loadingHistory")}</p>}
          {view.loaded && items.length === 0 && (
            <p className="text-sm text-neutral-500">
              {isChat
                ? t(session.cwd ? "chat.emptyChatFolder" : "chat.emptyChat", {
                    label,
                    model: profile?.model ?? t("chat.modelUnknown"),
                  })
                : profile
                  ? t("chat.emptyAgent", { cli: CLI_NAME[profile.engine], label })
                  : t("chat.emptyAgent", { cli: t("chat.agentFallback"), label: "" })}
            </p>
          )}
          {items.map((item) => (
            <ItemView key={item.key} item={item} sessionId={sessionId} />
          ))}
          {view.streaming && <Markdown text={view.streaming} />}
          {session.running && !view.streaming && (
            <p className="animate-pulse text-sm text-neutral-500">{t("chat.working")}</p>
          )}
        </div>
      </div>

      <Composer
        sessionId={sessionId}
        targetEngine={profile?.engine}
        disabled={!connected}
        running={session.running}
        onSend={(text, refs, files) => {
          stickRef.current = true;
          client.sendMessage(
            sessionId,
            text,
            refs.map((r) => ({ sessionId: r.sessionId, includeTools: r.includeTools })),
            files,
          );
        }}
        onCancel={() => client.cancelRun(sessionId)}
      />
    </>
  );
}

function ItemView({ item, sessionId }: { item: Item; sessionId: string }) {
  const t = useT();
  switch (item.type) {
    case "user":
      return (
        <div className="flex flex-col items-end gap-1.5">
          {item.context && (
            <details className="max-w-[85%] text-xs">
              <summary className="flex cursor-pointer list-none flex-wrap justify-end gap-1.5">
                {item.refs?.map((r) => (
                  <RefChip key={r.sessionId} refInfo={r} />
                ))}
                {item.files?.map((f, i) => (
                  <FileChip key={`${f.name}-${i}`} name={f.name} chars={f.chars} />
                ))}
              </summary>
              {/* 원본 세션이 바뀌거나 지워져도 이 메시지와 함께 보냈던 그대로를 보여준다 */}
              <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 dark:bg-neutral-900">
                {item.context}
              </pre>
            </details>
          )}
          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
            {item.text}
          </div>
        </div>
      );
    case "assistant":
      return <Markdown text={item.text} />;
    case "reasoning":
      return <p className="whitespace-pre-wrap text-xs italic text-neutral-500">{item.text}</p>;
    case "tool":
      return (
        <ToolCard kind={item.kind} name={item.name} input={item.input} result={item.result} runEnded={item.runEnded} />
      );
    case "file":
      // API 대화에서 만든 이미지는 세션 폴더 기준 상대 경로(files/...)로 온다. CLI의 파일 변경은 절대 경로라 겹치지 않는다.
      if (item.path.startsWith("files/") && /\.(png|jpg|webp)$/.test(item.path)) {
        const src = `${FILES_BASE}/files/${sessionId}/${item.path.slice("files/".length)}`;
        return (
          <a href={src} target="_blank" rel="noreferrer" className="block w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element -- 로컬 서버가 주는 동적 파일이라 next/image 최적화 대상이 아니다 */}
            <img src={src} alt={t("chat.generatedImage")} className="max-h-96 rounded-lg border border-neutral-200 dark:border-neutral-800" />
          </a>
        );
      }
      return (
        <p className="font-mono text-xs text-neutral-500">
          ✏️ {item.path} <span className="font-sans">({t(CHANGE_KEY[item.change])})</span>
        </p>
      );
    case "usage":
      return (
        <p className="text-right text-xs text-neutral-400">
          {t("chat.usage", { in: formatTokens(item.inputTokens), out: formatTokens(item.outputTokens) })}
          {item.costUsd !== undefined && ` · $${item.costUsd.toFixed(4)}`}
        </p>
      );
    case "end":
      return (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {item.status in END_KEY ? t(END_KEY[item.status as keyof typeof END_KEY]) : item.status}
          {item.error && <span className="mt-1 block whitespace-pre-wrap font-mono text-xs">{item.error}</span>}
        </p>
      );
  }
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="md text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function Composer(props: {
  sessionId: string;
  /** 첨부 내용이 다른 회사 API로 넘어가는지 판단하는 기준 */
  targetEngine?: Engine;
  disabled: boolean;
  running: boolean;
  onSend: (text: string, refs: AttachedRef[], files: FileAttachment[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<AttachedRef[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const profiles = useWaggle((s) => s.profiles);
  const dialog = useDialog();
  const t = useT();
  // 입력 잠금 기준은 run.completed가 아니라 session.running이다. 완료 이벤트 직후에도 서버는
  // 프로세스 종료를 기다리는 중이라, 그 틈에 보내면 "아직 실행 중"으로 거절된다.
  const canSend = !props.disabled && !props.running && text.trim().length > 0;

  async function send() {
    if (!canSend) return;
    // 같은 회사 안(구독↔API)은 이미 그 회사가 본 내용이다. 회사가 바뀔 때만 외부 전송을 확인한다.
    const crossing = refs.filter((r) => {
      const engine = profiles.find((p) => p.id === r.profileId)?.engine;
      return engine && props.targetEngine && engine !== props.targetEngine;
    });
    if (crossing.length > 0 && props.targetEngine) {
      const vendor = VENDOR[props.targetEngine];
      const titles = crossing.map((r) => `"${r.title || t("common.untitled")}"`).join(", ");
      const ok = await dialog.confirm({
        title: t("composer.sendToTitle", { vendor }),
        message: t("composer.sendToMessage", { titles, vendor }),
        tone: "warning",
        confirmLabel: t("composer.sendToConfirm"),
      });
      if (!ok) return;
    }
    props.onSend(text, refs, files);
    setText("");
    setRefs([]);
    setFiles([]);
    setPicking(false);
  }

  async function addFiles(list: FileList) {
    const { files: picked, rejected } = await readTextFiles(list, t);
    const next = [...files, ...picked];
    const total = next.reduce((n, f) => n + f.content.length, 0);
    if (next.length > MAX_FILES) rejected.push(t("composer.tooManyFiles", { n: MAX_FILES }));
    else if (total > MAX_TOTAL_FILE_CHARS) rejected.push(t("composer.totalTooBig", { n: MAX_TOTAL_FILE_CHARS.toLocaleString() }));
    else setFiles(next);
    if (rejected.length > 0) {
      await dialog.alert({ title: t("composer.attachFailed"), message: rejected.join("\n"), tone: "warning" });
    }
  }

  return (
    <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
      <ApprovalPanel sessionId={props.sessionId} />
      {picking && (
        <RefPicker
          currentSessionId={props.sessionId}
          attachedIds={refs.map((r) => r.sessionId)}
          onAttach={(ref) => {
            setRefs((prev) => [...prev, ref]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {(refs.length > 0 || files.length > 0) && (
        <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
          {refs.map((r) => (
            <RefChip key={r.sessionId} refInfo={r} onRemove={() => setRefs((prev) => prev.filter((x) => x !== r))} />
          ))}
          {files.map((f) => (
            <FileChip
              key={f.name}
              name={f.name}
              chars={f.content.length}
              onRemove={() => setFiles((prev) => prev.filter((x) => x !== f))}
            />
          ))}
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <button
          type="button"
          title={t("composer.refButton")}
          onClick={() => setPicking((v) => !v)}
          disabled={props.disabled}
          className={`rounded-md border px-2.5 py-2 text-sm disabled:opacity-40 ${
            picking ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-300 dark:border-neutral-700"
          }`}
        >
          📎
        </button>
        <button
          type="button"
          title={t("composer.fileButton")}
          onClick={() => fileInputRef.current?.click()}
          disabled={props.disabled}
          className="rounded-md border border-neutral-300 px-2.5 py-2 text-sm disabled:opacity-40 dark:border-neutral-700"
        >
          📄
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            // 같은 파일을 지웠다가 다시 고를 때도 change가 나도록 비운다.
            e.target.value = "";
          }}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 한글 IME 조합 중 Enter는 글자 확정용이다. 여기서 보내면 마지막 글자가 잘리거나 두 번 전송된다.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={Math.min(8, Math.max(2, text.split("\n").length))}
          placeholder={props.running ? t("composer.placeholderRunning") : t("composer.placeholder")}
          className="flex-1 resize-none rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        />
        {props.running ? (
          <button
            onClick={props.onCancel}
            className="rounded-md border border-red-400 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            {t("composer.stop")}
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!canSend}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {t("composer.send")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 저장된 항목 목록을 화면 단위로 바꾼다.
 * tool.completed는 따로 그리지 않고 같은 toolCallId의 tool.started 카드에 결과로 붙인다.
 */
function toItems(entries: HistoryEntry[]): Item[] {
  const results = new Map<string, { ok: boolean; output?: string }>();
  const endedRuns = new Set<string>();
  for (const e of entries) {
    if (e.kind !== "event") continue;
    if (e.event.type === "tool.completed") results.set(e.event.toolCallId, { ok: e.event.ok, output: e.event.output });
    if (e.event.type === "run.completed") endedRuns.add(e.event.runId);
  }

  const items: Item[] = [];
  entries.forEach((e, i) => {
    const key = String(e.seq ?? `i${i}`);
    if (e.kind === "user") {
      items.push({ type: "user", key, text: e.text, refs: e.refs, files: e.files, context: e.context });
      return;
    }
    const ev = e.event;
    switch (ev.type) {
      case "message.completed":
        items.push({ type: "assistant", key, text: ev.text });
        break;
      case "reasoning":
        items.push({ type: "reasoning", key, text: ev.text });
        break;
      case "tool.started":
        items.push({
          type: "tool",
          key,
          kind: ev.kind,
          name: ev.name,
          input: ev.input,
          result: results.get(ev.toolCallId),
          runEnded: endedRuns.has(ev.runId),
        });
        break;
      case "file.changed":
        items.push({ type: "file", key, path: ev.path, change: ev.change });
        break;
      case "usage":
        items.push({ type: "usage", key, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: ev.costUsd });
        break;
      case "run.completed":
        if (ev.status !== "success") items.push({ type: "end", key, status: ev.status, error: ev.error });
        break;
      // run.started, tool.completed(카드에 합쳐짐), raw는 그리지 않는다.
    }
  });
  return items;
}

function RefChip({ refInfo, onRemove }: { refInfo: AttachedRef; onRemove?: () => void }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900">
      📎 <span className="max-w-48 truncate">{refInfo.title || t("common.untitled")}</span>
      <ModeBadge profileId={refInfo.profileId} />
      <span className="text-neutral-500">
        {refInfo.includeTools ? t("chip.withTools") : t("chip.transcript")} ·{" "}
        {t("common.approxTokens", { n: approxTokens(refInfo.chars).toLocaleString() })}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-neutral-400 hover:text-red-600" aria-label={t("common.removeAttachment")}>
          ✕
        </button>
      )}
    </span>
  );
}

function FileChip({ name, chars, onRemove }: { name: string; chars: number; onRemove?: () => void }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900">
      📄 <span className="max-w-48 truncate font-mono">{name}</span>
      <span className="text-neutral-500">{t("common.approxTokens", { n: approxTokens(chars).toLocaleString() })}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-neutral-400 hover:text-red-600" aria-label={t("common.removeAttachment")}>
          ✕
        </button>
      )}
    </span>
  );
}
