import type {
  ClientMessage,
  HistoryEntry,
  PermissionLevel,
  ServerMessage,
  SessionSummary,
} from "@honeybee-waggle/schema";

export type ConnState = "connecting" | "open" | "closed";

export interface SessionView {
  loaded: boolean;
  entries: HistoryEntry[];
  /** 기록/실시간 항목 중복 제거 기준. 서버 계약은 protocol.ts의 HistoryEntry 주석 참고 */
  lastSeq: number;
  /** 아직 message.completed가 안 온 응답. delta는 저장되지 않으므로 entries와 따로 든다 */
  streaming: string;
}

export interface Snapshot {
  conn: ConnState;
  sessions: SessionSummary[];
  views: Record<string, SessionView>;
  notice?: { id: number; message: string };
}

type Pending = { resolve: (s: SessionSummary) => void; reject: (e: Error) => void };

const EMPTY_VIEW: SessionView = { loaded: false, entries: [], lastSeq: 0, streaming: "" };
const RECONNECT_MAX_MS = 10_000;

/**
 * 서버와의 WebSocket 하나와 그 위의 화면 상태를 들고 있는 외부 스토어.
 * React 상태가 아니라 클래스로 둔 이유: 페이지 이동/StrictMode 재마운트와 무관하게 연결이 유지돼야 하고,
 * useSyncExternalStore로 필요한 컴포넌트만 구독하게 하려는 것.
 * 스냅샷은 바뀔 때마다 새 객체로 교체한다 (같은 객체를 고치면 useSyncExternalStore가 변경을 못 알아챈다).
 */
export class WaggleClient {
  private ws?: WebSocket;
  private snapshot: Snapshot = { conn: "connecting", sessions: [], views: {} };
  private readonly listeners = new Set<() => void>();
  // StrictMode에서 effect가 두 번 돌면 open/close가 짝으로 두 번 온다. 참조 수로 세야 구독이 끊기지 않는다.
  private readonly openCounts = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  private reconnectDelay = 1_000;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private reqSeq = 0;
  private noticeSeq = 0;

  constructor(private readonly url: string) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  connect(): void {
    // StrictMode 개발 모드는 effect를 connect → dispose → connect 순으로 돌린다. dispose 뒤 재연결을 허용해야 한다.
    this.disposed = false;
    clearTimeout(this.reconnectTimer);
    this.set({ conn: "connecting" });
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1_000;
      this.set({ conn: "open" });
      this.rawSend({ type: "session.list" });
      // 재연결이면 서버 쪽 구독이 사라진 상태다. 열려 있던 세션을 다시 열어 그 사이 놓친 기록을 받는다.
      for (const id of this.openCounts.keys()) this.rawSend({ type: "session.open", sessionId: id });
    };
    ws.onmessage = (e) => this.handle(JSON.parse(String(e.data)) as ServerMessage);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.set({ conn: "closed" });
      for (const p of this.pending.values()) p.reject(new Error("서버 연결이 끊어짐"));
      this.pending.clear();
      if (this.disposed) return;
      // 서버 재시작 중일 때 1초 간격으로 계속 두드리지 않도록 간격을 늘려가며 재시도한다.
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    };
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = undefined;
  }

  openSession(id: string): void {
    const n = this.openCounts.get(id) ?? 0;
    this.openCounts.set(id, n + 1);
    if (n === 0) this.rawSend({ type: "session.open", sessionId: id });
  }

  closeSession(id: string): void {
    const n = (this.openCounts.get(id) ?? 1) - 1;
    if (n > 0) {
      this.openCounts.set(id, n);
      return;
    }
    this.openCounts.delete(id);
    this.rawSend({ type: "session.close", sessionId: id });
  }

  createSession(input: { title?: string; cwd: string; permission: PermissionLevel }): Promise<SessionSummary> {
    const reqId = this.nextReqId();
    return new Promise((resolve, reject) => {
      if (!this.rawSend({ type: "session.create", reqId, ...input })) {
        reject(new Error("서버에 연결되어 있지 않음"));
        return;
      }
      this.pending.set(reqId, { resolve, reject });
    });
  }

  sendMessage(sessionId: string, text: string): void {
    if (!this.rawSend({ type: "run.send", reqId: this.nextReqId(), sessionId, text })) {
      this.notify("서버에 연결되어 있지 않아 보내지 못했어.");
    }
  }

  cancelRun(sessionId: string): void {
    this.rawSend({ type: "run.cancel", sessionId });
  }

  dismissNotice(): void {
    this.set({ notice: undefined });
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case "session.list":
        this.set({ sessions: msg.sessions });
        return;
      case "session.created":
        this.upsertSession(msg.session);
        if (msg.reqId) this.settle(msg.reqId, (p) => p.resolve(msg.session));
        return;
      case "session.updated":
        this.upsertSession(msg.session);
        return;
      case "session.history": {
        const prev = this.snapshot.views[msg.sessionId] ?? EMPTY_VIEW;
        const lastSeq = msg.entries.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
        // 구독 직후 기록보다 먼저 도착한 실시간 항목 중 기록에 없는 것만 뒤에 이어 붙인다.
        const newer = prev.entries.filter((e) => (e.seq ?? 0) > lastSeq);
        this.setView(msg.sessionId, {
          loaded: true,
          entries: [...msg.entries, ...newer],
          lastSeq: Math.max(lastSeq, ...newer.map((e) => e.seq ?? 0)),
          streaming: prev.streaming,
        });
        return;
      }
      case "session.entry":
        this.applyEntry(msg.sessionId, msg.entry);
        return;
      case "error":
        if (msg.reqId && this.pending.has(msg.reqId)) {
          this.settle(msg.reqId, (p) => p.reject(new Error(msg.message)));
        } else {
          this.notify(msg.message);
        }
        return;
    }
  }

  private applyEntry(sessionId: string, entry: HistoryEntry): void {
    const view = this.snapshot.views[sessionId] ?? EMPTY_VIEW;
    if (entry.seq !== undefined && entry.seq <= view.lastSeq) return;

    if (entry.kind === "event") {
      const ev = entry.event;
      if (ev.type === "message.delta") {
        this.setView(sessionId, { ...view, streaming: view.streaming + ev.text });
        return;
      }
      // 저장되지 않는 raw(stream_event 조각)는 화면에도 안 쓰인다. 들고 있으면 메모리만 늘어난다.
      if (ev.type === "raw" && entry.seq === undefined) return;
    }

    const endsStreaming =
      entry.kind === "event" && (entry.event.type === "message.completed" || entry.event.type === "run.completed");
    this.setView(sessionId, {
      ...view,
      entries: [...view.entries, entry],
      lastSeq: entry.seq ?? view.lastSeq,
      streaming: endsStreaming ? "" : view.streaming,
    });
  }

  private upsertSession(s: SessionSummary): void {
    const sessions = [s, ...this.snapshot.sessions.filter((x) => x.id !== s.id)].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    this.set({ sessions });
  }

  private setView(id: string, view: SessionView): void {
    this.set({ views: { ...this.snapshot.views, [id]: view } });
  }

  private settle(reqId: string, fn: (p: Pending) => void): void {
    const p = this.pending.get(reqId);
    if (!p) return;
    this.pending.delete(reqId);
    fn(p);
  }

  private notify(message: string): void {
    this.set({ notice: { id: ++this.noticeSeq, message } });
  }

  private rawSend(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private nextReqId(): string {
    return `r${++this.reqSeq}`;
  }

  private set(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const fn of this.listeners) fn();
  }
}

export function emptyView(): SessionView {
  return EMPTY_VIEW;
}
