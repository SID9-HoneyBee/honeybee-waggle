import type { AgentEvent, PermissionLevel } from "./agent-adapter-schema";

// 서버 ↔ 웹 WebSocket 계약. 원본 스키마 파일은 수정하지 않기로 했으므로 별도 파일로 둔다.

export interface SessionMeta {
  id: string;
  title: string;
  profileId: string;
  cwd: string;
  permission: PermissionLevel;
  /** 다음 run에서 --resume으로 넘길 값. run마다 엔진이 돌려준 최신 값으로 갱신된다 */
  nativeSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummary extends SessionMeta {
  running: boolean;
}

/**
 * seq는 디스크에 저장된 항목에만 붙는다.
 * 세션을 열 때 "구독 → 기록 전송" 사이에 끼어든 실시간 항목이 기록과 중복될 수 있어서,
 * 클라이언트가 seq로 중복을 걸러낸다. message.delta처럼 저장하지 않는 항목은 seq가 없다.
 */
export type HistoryEntry = (
  | { kind: "user"; runId: string; text: string; ts: number }
  | { kind: "event"; event: AgentEvent }
) & { seq?: number };

export type ClientMessage = { reqId?: string } & (
  | { type: "session.list" }
  | { type: "session.create"; title?: string; cwd: string; permission: PermissionLevel }
  | { type: "session.open"; sessionId: string }
  | { type: "session.close"; sessionId: string }
  | { type: "run.send"; sessionId: string; text: string }
  | { type: "run.cancel"; sessionId: string }
);

export type ServerMessage =
  | { type: "session.list"; sessions: SessionSummary[] }
  | { type: "session.created"; reqId?: string; session: SessionSummary }
  | { type: "session.updated"; session: SessionSummary }
  | { type: "session.history"; sessionId: string; entries: HistoryEntry[] }
  | { type: "session.entry"; sessionId: string; entry: HistoryEntry }
  | { type: "error"; reqId?: string; message: string };
