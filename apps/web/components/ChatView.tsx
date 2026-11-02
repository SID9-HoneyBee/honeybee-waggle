"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HistoryEntry, ToolKind } from "@honeybee-waggle/schema";
import { useSessionView, useWaggle, useWaggleClient } from "@/lib/WaggleProvider";
import { formatTokens } from "@/lib/format";
import { ToolCard } from "./ToolCard";

type Item =
  | { type: "user"; key: string; text: string }
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
  | { type: "usage"; key: string; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: "end"; key: string; status: string; error?: string };

const PERMISSION_LABEL = { "read-only": "읽기 전용", "workspace-write": "파일 수정 허용", full: "전체 허용" } as const;
const END_LABEL: Record<string, string> = { error: "오류로 종료", cancelled: "중단됨", timeout: "시간 초과" };

// 사용자가 위로 스크롤해서 예전 내용을 읽는 중이면 새 출력이 와도 끌어내리지 않는다.
const STICK_THRESHOLD_PX = 80;

export function ChatView({ sessionId }: { sessionId: string }) {
  const client = useWaggleClient();
  const view = useSessionView(sessionId);
  const session = useWaggle((s) => s.sessions.find((x) => x.id === sessionId));
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
    return <div className="p-8 text-sm text-neutral-500">{connected ? "세션을 찾을 수 없어." : "불러오는 중…"}</div>;
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{session.title || "(제목 없음)"}</h1>
          <p className="truncate font-mono text-xs text-neutral-500">{session.cwd}</p>
        </div>
        <span className="shrink-0 rounded-full border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700">
          {PERMISSION_LABEL[session.permission]}
        </span>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
        }}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl space-y-3 px-5 py-6">
          {!view.loaded && <p className="text-sm text-neutral-500">기록 불러오는 중…</p>}
          {view.loaded && items.length === 0 && (
            <p className="text-sm text-neutral-500">첫 메시지를 보내면 이 폴더에서 claude가 실행돼.</p>
          )}
          {items.map((item) => (
            <ItemView key={item.key} item={item} />
          ))}
          {view.streaming && <Markdown text={view.streaming} />}
          {session.running && !view.streaming && (
            <p className="animate-pulse text-sm text-neutral-500">작업 중…</p>
          )}
        </div>
      </div>

      <Composer
        disabled={!connected}
        running={session.running}
        onSend={(text) => {
          stickRef.current = true;
          client.sendMessage(sessionId, text);
        }}
        onCancel={() => client.cancelRun(sessionId)}
      />
    </>
  );
}

function ItemView({ item }: { item: Item }) {
  switch (item.type) {
    case "user":
      return (
        <div className="flex justify-end">
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
    case "usage":
      return (
        <p className="text-right text-xs text-neutral-400">
          입력 {formatTokens(item.inputTokens)} · 출력 {formatTokens(item.outputTokens)} 토큰
          {item.costUsd !== undefined && ` · $${item.costUsd.toFixed(4)}`}
        </p>
      );
    case "end":
      return (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {END_LABEL[item.status] ?? item.status}
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
  disabled: boolean;
  running: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  // 입력 잠금 기준은 run.completed가 아니라 session.running이다. 완료 이벤트 직후에도 서버는
  // 프로세스 종료를 기다리는 중이라, 그 틈에 보내면 "아직 실행 중"으로 거절된다.
  const canSend = !props.disabled && !props.running && text.trim().length > 0;

  function send() {
    if (!canSend) return;
    props.onSend(text);
    setText("");
  }

  return (
    <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 한글 IME 조합 중 Enter는 글자 확정용이다. 여기서 보내면 마지막 글자가 잘리거나 두 번 전송된다.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={Math.min(8, Math.max(2, text.split("\n").length))}
          placeholder={props.running ? "실행 중… (끝나면 이어서 보낼 수 있어)" : "메시지 (Enter 전송, Shift+Enter 줄바꿈)"}
          className="flex-1 resize-none rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        />
        {props.running ? (
          <button
            onClick={props.onCancel}
            className="rounded-md border border-red-400 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            중단
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!canSend}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            보내기
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
      items.push({ type: "user", key, text: e.text });
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
      case "usage":
        items.push({ type: "usage", key, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: ev.costUsd });
        break;
      case "run.completed":
        if (ev.status !== "success") items.push({ type: "end", key, status: ev.status, error: ev.error });
        break;
      // run.started, tool.completed(카드에 합쳐짐), raw, file.changed(claude는 안 보냄)는 그리지 않는다.
    }
  });
  return items;
}
