import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import type {
  AgentEvent,
  EngineAdapter,
  HistoryEntry,
  PermissionLevel,
  SessionMeta,
  SessionSummary,
} from "@honeybee-waggle/schema";
import type { FileSessionStore } from "../store/FileSessionStore";

interface ManagerEvents {
  updated: [SessionSummary];
  entry: [sessionId: string, entry: HistoryEntry];
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
  /** 세션별 마지막 저장 seq. 시작 시 기록 줄 수로 복원한다 */
  private readonly seqs = new Map<string, number>();

  constructor(
    private readonly store: FileSessionStore,
    private readonly adapter: EngineAdapter,
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

  async create(input: { title?: string; cwd: string; permission: PermissionLevel }): Promise<SessionSummary> {
    const cwd = input.cwd.trim();
    // 잘못된 cwd는 spawn 시점에야 ENOENT로 터지는데, 그때는 원인이 잘 안 보인다. 만들 때 미리 막는다.
    const stat = await fs.stat(cwd).catch(() => undefined);
    if (!stat?.isDirectory()) throw new Error(`작업 폴더가 없거나 폴더가 아님: ${cwd}`);

    const now = Date.now();
    const meta: SessionMeta = {
      id: randomUUID(),
      title: input.title?.trim() ?? "",
      profileId: this.adapter.profile.id,
      cwd,
      permission: input.permission,
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

  send(sessionId: string, text: string): string {
    const meta = this.require(sessionId);
    if (!text.trim()) throw new Error("빈 메시지는 보낼 수 없음");
    if (this.running.has(sessionId)) throw new Error("이 세션은 아직 실행 중. 끝나거나 중단한 뒤에 보내줘.");

    const runId = randomUUID();
    const ac = new AbortController();
    this.running.set(sessionId, ac);
    if (!meta.title) meta.title = text.trim().replace(/\s+/g, " ").slice(0, TITLE_MAX);
    this.touch(meta);

    // run은 길게 돌 수 있어서 기다리지 않는다. 결과는 entry 이벤트로 흘려보낸다.
    void this.execute(meta, runId, text, ac);
    return runId;
  }

  cancel(sessionId: string): void {
    this.require(sessionId);
    this.running.get(sessionId)?.abort();
  }

  cancelAll(): void {
    for (const ac of this.running.values()) ac.abort();
  }

  private async execute(meta: SessionMeta, runId: string, text: string, ac: AbortController): Promise<void> {
    this.record(meta.id, { kind: "user", runId, text, ts: Date.now() });
    let completed = false;
    try {
      const events = this.adapter.run(
        {
          runId,
          sessionId: meta.id,
          profileId: meta.profileId,
          prompt: text,
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
        this.record(meta.id, { kind: "event", event: ev });
      }
    } catch (err) {
      // 어댑터 내부 예외도 화면에서는 "run이 실패로 끝남"으로 보여야 입력창이 다시 풀린다.
      console.error(`[session ${meta.id}] run ${runId} 예외:`, err);
    } finally {
      if (!completed) {
        this.record(meta.id, {
          kind: "event",
          event: { type: "run.completed", runId, ts: Date.now(), status: "error", error: "어댑터가 완료 이벤트 없이 종료됨" },
        });
      }
      this.running.delete(meta.id);
      this.touch(meta);
    }
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
