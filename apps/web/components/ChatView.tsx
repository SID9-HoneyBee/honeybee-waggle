"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AttachedRef, Engine, HistoryEntry, ToolKind } from "@honeybee-waggle/schema";
import { FILES_BASE, useSessionView, useWaggle, useWaggleClient } from "@/lib/WaggleProvider";
import { approxTokens, formatTokens } from "@/lib/format";
import { ModeBadge } from "./ModeBadge";
import { RefPicker } from "./RefPicker";
import { ToolCard } from "./ToolCard";

type Item =
  | { type: "user"; key: string; text: string; refs?: AttachedRef[]; context?: string }
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

const PERMISSION_LABEL = { "read-only": "읽기 전용", "workspace-write": "파일 수정 허용", full: "전체 허용" } as const;
const VENDOR = { claude: "Anthropic", codex: "OpenAI" } as const;
const CLI_NAME = { claude: "Claude Code", codex: "Codex" } as const;
const CHANGE_LABEL = { add: "추가", modify: "수정", delete: "삭제" } as const;
const END_LABEL: Record<string, string> = { error: "오류로 종료", cancelled: "중단됨", timeout: "시간 초과" };

// 사용자가 위로 스크롤해서 예전 내용을 읽는 중이면 새 출력이 와도 끌어내리지 않는다.
const STICK_THRESHOLD_PX = 80;

export function ChatView({ sessionId }: { sessionId: string }) {
  const client = useWaggleClient();
  const view = useSessionView(sessionId);
  const session = useWaggle((s) => s.sessions.find((x) => x.id === sessionId));
  const profile = useWaggle((s) => s.profiles.find((p) => p.id === session?.profileId));
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
          <p className="truncate font-mono text-xs text-neutral-500">
            {session.cwd || (profile?.model ? `API 대화 · ${profile.model}` : "API 대화")}
          </p>
        </div>
        <ModeBadge profileId={session.profileId} />
        {/* API 대화 세션은 파일 권한이 의미 없어서 권한 배지를 숨긴다 */}
        {profile?.runtime !== "chat" && (
          <span className="shrink-0 rounded-full border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700">
            {PERMISSION_LABEL[session.permission]}
          </span>
        )}
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
            <p className="text-sm text-neutral-500">
              {profile?.runtime === "chat"
                ? `첫 메시지를 보내면 ${profile.label}(${profile.model ?? "모델 미정"})와 대화가 시작돼. 파일이나 셸에는 접근하지 않아.`
                : `첫 메시지를 보내면 이 폴더에서 ${profile ? `${CLI_NAME[profile.engine]}(${profile.label})` : "에이전트"}가 실행돼.`}
            </p>
          )}
          {items.map((item) => (
            <ItemView key={item.key} item={item} sessionId={sessionId} />
          ))}
          {view.streaming && <Markdown text={view.streaming} />}
          {session.running && !view.streaming && (
            <p className="animate-pulse text-sm text-neutral-500">작업 중…</p>
          )}
        </div>
      </div>

      <Composer
        sessionId={sessionId}
        targetEngine={profile?.engine}
        disabled={!connected}
        running={session.running}
        onSend={(text, refs) => {
          stickRef.current = true;
          client.sendMessage(
            sessionId,
            text,
            refs.map((r) => ({ sessionId: r.sessionId, includeTools: r.includeTools })),
          );
        }}
        onCancel={() => client.cancelRun(sessionId)}
      />
    </>
  );
}

function ItemView({ item, sessionId }: { item: Item; sessionId: string }) {
  switch (item.type) {
    case "user":
      return (
        <div className="flex flex-col items-end gap-1.5">
          {item.refs && item.refs.length > 0 && (
            <details className="max-w-[85%] text-xs">
              <summary className="flex cursor-pointer list-none flex-wrap justify-end gap-1.5">
                {item.refs.map((r) => (
                  <RefChip key={r.sessionId} refInfo={r} />
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
            <img src={src} alt="생성된 이미지" className="max-h-96 rounded-lg border border-neutral-200 dark:border-neutral-800" />
          </a>
        );
      }
      return (
        <p className="font-mono text-xs text-neutral-500">
          ✏️ {item.path} <span className="font-sans">({CHANGE_LABEL[item.change]})</span>
        </p>
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
  sessionId: string;
  /** 첨부 내용이 다른 회사 API로 넘어가는지 판단하는 기준 */
  targetEngine?: Engine;
  disabled: boolean;
  running: boolean;
  onSend: (text: string, refs: AttachedRef[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<AttachedRef[]>([]);
  const [picking, setPicking] = useState(false);
  const profiles = useWaggle((s) => s.profiles);
  // 입력 잠금 기준은 run.completed가 아니라 session.running이다. 완료 이벤트 직후에도 서버는
  // 프로세스 종료를 기다리는 중이라, 그 틈에 보내면 "아직 실행 중"으로 거절된다.
  const canSend = !props.disabled && !props.running && text.trim().length > 0;

  function send() {
    if (!canSend) return;
    // 같은 회사 안(구독↔API)은 이미 그 회사가 본 내용이다. 회사가 바뀔 때만 외부 전송을 확인한다.
    const crossing = refs.filter((r) => {
      const engine = profiles.find((p) => p.id === r.profileId)?.engine;
      return engine && props.targetEngine && engine !== props.targetEngine;
    });
    if (crossing.length > 0 && props.targetEngine) {
      const vendor = VENDOR[props.targetEngine];
      const titles = crossing.map((r) => `"${r.title || "(제목 없음)"}"`).join(", ");
      if (!confirm(`${titles} 세션의 대화 내용이 ${vendor}로 전송돼. 코드나 경로가 들어 있을 수 있어. 계속할까?`)) return;
    }
    props.onSend(text, refs);
    setText("");
    setRefs([]);
    setPicking(false);
  }

  return (
    <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
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
      {refs.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
          {refs.map((r) => (
            <RefChip key={r.sessionId} refInfo={r} onRemove={() => setRefs((prev) => prev.filter((x) => x !== r))} />
          ))}
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <button
          type="button"
          title="다른 세션 참조"
          onClick={() => setPicking((v) => !v)}
          disabled={props.disabled}
          className={`rounded-md border px-2.5 py-2 text-sm disabled:opacity-40 ${
            picking ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-300 dark:border-neutral-700"
          }`}
        >
          📎
        </button>
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
      items.push({ type: "user", key, text: e.text, refs: e.refs, context: e.context });
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
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900">
      📎 <span className="max-w-48 truncate">{refInfo.title || "(제목 없음)"}</span>
      <ModeBadge profileId={refInfo.profileId} />
      <span className="text-neutral-500">
        {refInfo.includeTools ? "도구 포함" : "정리본"} · 약 {approxTokens(refInfo.chars).toLocaleString()}토큰
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-neutral-400 hover:text-red-600" aria-label="첨부 제거">
          ✕
        </button>
      )}
    </span>
  );
}
