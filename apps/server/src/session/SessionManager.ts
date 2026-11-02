import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import type {
  AgentEvent,
  AttachedRef,
  FileAttachment,
  SessionRef,
  EngineAdapter,
  HistoryEntry,
  PermissionLevel,
  SessionMeta,
  SessionSummary,
} from "@honeybee-waggle/schema";
import type { ProfileService } from "../profiles/ProfileService";
import type { FileSessionStore } from "../store/FileSessionStore";
import { buildFileBlock, buildTranscript, composePrompt } from "./transcript";

// 한 메시지에 너무 많은 세션을 붙이면 컨텍스트가 순식간에 차서 막아둔다.
const MAX_REFS = 5;
// 파일 첨부 한도. 웹에서도 같은 값으로 미리 막지만, 서버가 최종 기준이다.
// 한 파일 20만 자(대략 8만 토큰)를 넘으면 대부분 로그·빌드 산출물이라 첨부보다 필요한 부분만 붙이는 게 맞다.
const MAX_FILES = 10;
const MAX_FILE_CHARS = 200_000;
const MAX_TOTAL_FILE_CHARS = 500_000;

interface ManagerEvents {
  updated: [SessionSummary];
  entry: [sessionId: string, entry: HistoryEntry];
  removed: [sessionId: string];
}

const TITLE_MAX = 40;

/**
 * 세션 생명주기와 run 실행을 맡는다.
 * - 세션 간에는 동시에 run을 돌릴 수 있지만, 한 세션 안에서는 하나씩만 돈다.
 *   같은 nativeSessionId로 --resume을 동시에 두 번 걸면 대화 기록이 갈라지기 때문이다.
 * - 모든 항목은 emit으로 실시간 전달하고, 다시 볼 가치가 있는 것만 디스크에 남긴다.
 */
export class SessionManager extends EventEmitter<ManagerEvents> {
  private readonly sessions = new Map<string, SessionMeta>();
  private readonly running = new Map<string, AbortController>();
  /** 삭제 시 진행 중인 run이 기록·meta 쓰기를 다 끝낼 때까지 기다리기 위해 들고 있는다 */
  private readonly executions = new Map<string, Promise<void>>();
  private readonly deleting = new Set<string>();
  /** 세션별 마지막 저장 seq. 시작 시 기록 줄 수로 복원한다 */
  private readonly seqs = new Map<string, number>();

  constructor(
    private readonly store: FileSessionStore,
    /** profileId → 어댑터. 프로필마다 env(키, CODEX_HOME)가 달라서 어댑터도 프로필별로 하나씩 둔다 */
    private readonly adapters: ReadonlyMap<string, EngineAdapter>,
    private readonly profiles: ProfileService,
  ) {
    super();
  }

  /**
   * 기록을 전부 한 번씩 읽는다(seq 복원 + 중단된 run 정리). 세션 수가 많아지면 시작이 느려지는데,
   * 1단계 규모에선 문제 없고 필요해지면 seq를 meta에 같이 저장하는 쪽으로 바꾼다.
   */
  async init(): Promise<void> {
    for (const meta of await this.store.loadAll()) {
      this.sessions.set(meta.id, meta);
      const history = await this.store.readHistory(meta.id);
      this.seqs.set(meta.id, history.reduce((max, e) => Math.max(max, e.seq ?? 0), 0));
      await this.closeDanglingRun(meta.id, history);
    }
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((m) => this.summary(m));
  }

  async create(input: {
    title?: string;
    cwd: string;
    permission: PermissionLevel;
    profileId: string;
  }): Promise<SessionSummary> {
    this.profiles.assertCanRun(input.profileId);
    if (!this.adapters.has(input.profileId)) throw new Error(`아직 지원하지 않는 실행 방식: ${input.profileId}`);
    // API 대화(chat)는 파일에 손대지 않으므로 작업 폴더·권한이 의미 없다. 빈 값으로 저장해 화면에서도 숨긴다.
    const isChat = this.profiles.get(input.profileId).runtime === "chat";
    const cwd = isChat ? "" : input.cwd.trim();
    if (!isChat) {
      // 잘못된 cwd는 spawn 시점에야 ENOENT로 터지는데, 그때는 원인이 잘 안 보인다. 만들 때 미리 막는다.
      const stat = await fs.stat(cwd).catch(() => undefined);
      if (!stat?.isDirectory()) throw new Error(`작업 폴더가 없거나 폴더가 아님: ${cwd}`);
    }

    const now = Date.now();
    const meta: SessionMeta = {
      id: randomUUID(),
      title: input.title?.trim() ?? "",
      profileId: input.profileId,
      cwd,
      permission: isChat ? "read-only" : input.permission,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveMeta(meta);
    this.sessions.set(meta.id, meta);
    this.seqs.set(meta.id, 0);
    const summary = this.summary(meta);
    this.emit("updated", summary);
    return summary;
  }

  async history(sessionId: string): Promise<HistoryEntry[]> {
    this.require(sessionId);
    return this.store.readHistory(sessionId);
  }

  rename(sessionId: string, title: string): void {
    const meta = this.require(sessionId);
    const next = title.trim();
    if (!next) throw new Error("빈 제목으로는 바꿀 수 없음");
    meta.title = next.slice(0, 100);
    this.touch(meta);
  }

  /** 다른 세션 첨부 미리보기. 실제 전송 때와 같은 함수로 만들어서 보이는 것과 보내는 것이 같다 */
  async transcript(sessionId: string, includeTools: boolean): Promise<{ text: string; chars: number }> {
    const meta = this.require(sessionId);
    const text = buildTranscript(meta, this.profiles.label(meta.profileId), await this.store.readHistory(sessionId), includeTools);
    return { text, chars: text.length };
  }

  send(sessionId: string, text: string, refs: SessionRef[] = [], files: FileAttachment[] = []): string {
    const meta = this.require(sessionId);
    if (!text.trim()) throw new Error("빈 메시지는 보낼 수 없음");
    if (refs.length > MAX_REFS) throw new Error(`다른 세션은 한 번에 ${MAX_REFS}개까지 첨부할 수 있음`);
    validateFiles(files);
    for (const ref of refs) {
      if (ref.sessionId === sessionId) throw new Error("현재 세션은 자기 자신을 참조할 수 없음");
      this.require(ref.sessionId);
    }
    if (this.deleting.has(sessionId)) throw new Error("삭제 중인 세션");
    if (this.running.has(sessionId)) throw new Error("이 세션은 아직 실행 중. 끝나거나 중단한 뒤에 보내줘.");
    // 세션을 만든 뒤 키가 삭제됐거나 이번 달 예산을 넘겼을 수 있어서 보낼 때마다 다시 검사한다.
    this.profiles.assertCanRun(meta.profileId);

    const runId = randomUUID();
    const ac = new AbortController();
    this.running.set(sessionId, ac);
    if (!meta.title) meta.title = text.trim().replace(/\s+/g, " ").slice(0, TITLE_MAX);
    this.touch(meta);

    // run은 길게 돌 수 있어서 기다리지 않는다. 결과는 entry 이벤트로 흘려보낸다.
    const execution = this.execute(meta, runId, text, refs, files, ac);
    this.executions.set(sessionId, execution);
    void execution.finally(() => {
      if (this.executions.get(sessionId) === execution) this.executions.delete(sessionId);
    });
    return runId;
  }

  cancel(sessionId: string): void {
    this.require(sessionId);
    this.running.get(sessionId)?.abort();
  }

  /**
   * 우리 쪽 기록(.data/sessions/<id>)만 지운다. CLI가 자체 보관하는 대화(~/.claude, ~/.codex)는 건드리지 않는다.
   * 그건 사용자의 다른 도구(터미널의 claude --resume 등)에서도 쓰는 데이터라서다.
   * 실행 중이면 중단시키고, run이 마지막 기록을 다 쓴 뒤에 폴더를 지운다. 순서가 바뀌면 지운 폴더에 다시 써서 되살아난다.
   */
  async delete(sessionId: string): Promise<void> {
    this.require(sessionId);
    if (this.deleting.has(sessionId)) return;
    this.deleting.add(sessionId);
    try {
      this.running.get(sessionId)?.abort();
      await this.executions.get(sessionId);
      await this.store.deleteSession(sessionId);
      this.sessions.delete(sessionId);
      this.seqs.delete(sessionId);
      this.emit("removed", sessionId);
    } finally {
      this.deleting.delete(sessionId);
    }
  }

  cancelAll(): void {
    for (const ac of this.running.values()) ac.abort();
  }

  private async execute(
    meta: SessionMeta,
    runId: string,
    text: string,
    refs: SessionRef[],
    files: FileAttachment[],
    ac: AbortController,
  ): Promise<void> {
    const { attached, context: refContext } = await this.buildRefs(refs);
    const fileContext = files.length ? buildFileBlock(files) : undefined;
    const context = [refContext, fileContext].filter(Boolean).join("\n\n") || undefined;
    this.record(meta.id, {
      kind: "user",
      runId,
      text,
      ts: Date.now(),
      refs: attached,
      files: files.length ? files.map((f) => ({ name: f.name, chars: f.content.length })) : undefined,
      context,
    });
    let completed = false;
    let failure: string | undefined;
    try {
      const adapter = this.adapters.get(meta.profileId);
      if (!adapter) throw new Error(`실행 방식 ${meta.profileId}의 어댑터가 없음`);
      const events = adapter.run(
        {
          runId,
          sessionId: meta.id,
          profileId: meta.profileId,
          prompt: composePrompt(context, text),
          cwd: meta.cwd,
          permission: meta.permission,
          resumeNativeId: meta.nativeSessionId,
        },
        ac.signal,
      );
      for await (const ev of events) {
        if ((ev.type === "run.started" || ev.type === "run.completed") && ev.nativeSessionId) {
          meta.nativeSessionId = ev.nativeSessionId;
        }
        if (ev.type === "run.completed") completed = true;
        if (ev.type === "usage" && ev.costUsd) {
          this.profiles.addCost(meta.profileId, ev.costUsd).catch((err) => console.error("[session] 비용 기록 실패:", err));
        }
        this.record(meta.id, { kind: "event", event: ev });
      }
    } catch (err) {
      // 어댑터 내부 예외도 화면에서는 "run이 실패로 끝남"으로 보여야 입력창이 다시 풀린다.
      console.error(`[session ${meta.id}] run ${runId} 예외:`, err);
      failure = err instanceof Error ? err.message : String(err);
    } finally {
      if (!completed) {
        this.record(meta.id, {
          kind: "event",
          event: { type: "run.completed", runId, ts: Date.now(), status: "error", error: failure ?? "어댑터가 완료 이벤트 없이 종료됨" },
        });
      }
      this.running.delete(meta.id);
      this.touch(meta);
    }
  }

  /**
   * 첨부 시점의 정리본을 만들어 user 항목에 그대로 저장한다. 원본 세션이 나중에 이어지거나 삭제돼도
   * 이 대화에서 모델이 봤던 내용은 바뀌지 않아야 기록을 다시 보낼 때(Claude API) 앞뒤가 맞는다.
   * 전송 검증 뒤에 원본이 삭제됐으면 그 첨부만 빼고 진행한다.
   */
  private async buildRefs(refs: SessionRef[]): Promise<{ attached?: AttachedRef[]; context?: string }> {
    if (refs.length === 0) return {};
    const attached: AttachedRef[] = [];
    const parts: string[] = [];
    for (const ref of refs) {
      const source = this.sessions.get(ref.sessionId);
      if (!source) continue;
      try {
        const { text, chars } = await this.transcript(ref.sessionId, ref.includeTools);
        parts.push(text);
        attached.push({ ...ref, title: source.title, profileId: source.profileId, chars });
      } catch (err) {
        console.error(`[session] 참조 세션 ${ref.sessionId} 읽기 실패, 첨부에서 제외:`, err);
      }
    }
    return parts.length ? { attached, context: parts.join("\n\n") } : {};
  }

  /**
   * 서버가 run 도중 죽으면 기록이 user 메시지에서 끊긴 채로 남는다.
   * 화면이 영원히 "실행 중"으로 보이지 않도록 다음 시작 때 실패 완료를 덧붙여 닫는다.
   */
  private async closeDanglingRun(sessionId: string, history: HistoryEntry[]): Promise<void> {
    const lastUser = history.findLast((e) => e.kind === "user");
    if (!lastUser || lastUser.kind !== "user") return;
    const closed = history.some(
      (e) => e.kind === "event" && e.event.type === "run.completed" && e.event.runId === lastUser.runId,
    );
    if (closed) return;
    this.record(sessionId, {
      kind: "event",
      event: {
        type: "run.completed",
        runId: lastUser.runId,
        ts: Date.now(),
        status: "error",
        error: "서버가 재시작되어 실행이 중단됨",
      },
    });
  }

  private record(sessionId: string, entry: HistoryEntry): void {
    if (isPersistent(entry)) {
      const seq = (this.seqs.get(sessionId) ?? 0) + 1;
      this.seqs.set(sessionId, seq);
      entry = { ...entry, seq };
      this.store.append(sessionId, entry).catch((err) => console.error(`[session ${sessionId}] 기록 저장 실패:`, err));
    }
    this.emit("entry", sessionId, entry);
  }

  private touch(meta: SessionMeta): void {
    meta.updatedAt = Date.now();
    this.store.saveMeta(meta).catch((err) => console.error(`[session ${meta.id}] meta 저장 실패:`, err));
    this.emit("updated", this.summary(meta));
  }

  private summary(meta: SessionMeta): SessionSummary {
    return { ...meta, running: this.running.has(meta.id) };
  }

  private require(sessionId: string): SessionMeta {
    const meta = this.sessions.get(sessionId);
    if (!meta) throw new Error(`세션을 찾을 수 없음: ${sessionId}`);
    return meta;
  }
}

/**
 * message.delta는 message.completed에 같은 내용이 다시 오고, stream_event raw는 delta 조각들이라
 * 저장하면 기록만 수십 배로 불어난다. 실시간 표시에만 쓰고 디스크에는 남기지 않는다.
 */
function isPersistent(entry: HistoryEntry): boolean {
  if (entry.kind !== "event") return true;
  const ev: AgentEvent = entry.event;
  if (ev.type === "message.delta") return false;
  if (ev.type === "raw" && (ev.payload as { type?: string } | null)?.type === "stream_event") return false;
  return true;
}

function validateFiles(files: FileAttachment[]): void {
  if (files.length > MAX_FILES) throw new Error(`파일은 한 번에 ${MAX_FILES}개까지 첨부할 수 있음`);
  let total = 0;
  for (const f of files) {
    if (f.content.length > MAX_FILE_CHARS) throw new Error(`${f.name}: 파일이 너무 큼 (${MAX_FILE_CHARS.toLocaleString()}자 초과)`);
    total += f.content.length;
  }
  if (total > MAX_TOTAL_FILE_CHARS) throw new Error(`첨부 파일 합계가 너무 큼 (${MAX_TOTAL_FILE_CHARS.toLocaleString()}자 초과)`);
}
