import type { AgentEvent, AuthMode, Engine, PermissionLevel, Runtime } from "./agent-adapter-schema";

// 서버 ↔ 웹 WebSocket 계약. 원본 스키마 파일은 수정하지 않기로 했으므로 별도 파일로 둔다.

export type KeyProvider = "anthropic" | "openai";

/** 웹에 보여주는 프로필 상태. 키 원문은 절대 담지 않는다 (keyHint는 끝 4자리) */
export interface ProfileInfo {
  id: string;
  label: string;
  engine: Engine;
  auth: AuthMode;
  /** agent = CLI 에이전트(작업 폴더·권한 필요), chat = API 직접 대화 */
  runtime: Runtime;
  available: boolean;
  unavailableReason?: string;
  keyProvider?: KeyProvider;
  keyHint?: string;
  /** chat 프로필의 현재 모델과, 키로 조회한 선택 가능 모델 목록 */
  model?: string;
  modelOptions?: string[];
  /** 비용을 계산할 수 있는지. false면 예산 상한을 걸 수 없다 (Claude API만 토큰×정가로 계산) */
  costTracked: boolean;
  budgetUsd?: number;
  /** 이번 달(서버 로컬 시간 기준) 누적 비용. api 모드만 */
  spentUsd?: number;
}

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
  | { type: "session.create"; title?: string; cwd: string; permission: PermissionLevel; profileId: string }
  | { type: "session.open"; sessionId: string }
  | { type: "session.close"; sessionId: string }
  | { type: "session.delete"; sessionId: string }
  | { type: "run.send"; sessionId: string; text: string }
  | { type: "run.cancel"; sessionId: string }
  | { type: "profile.list" }
  | { type: "settings.setKey"; provider: KeyProvider; key: string }
  | { type: "settings.deleteKey"; provider: KeyProvider }
  | { type: "settings.setBudget"; profileId: string; budgetUsd: number | null }
  | { type: "settings.setModel"; profileId: string; model: string }
);

export type ServerMessage =
  | { type: "ack"; reqId?: string }
  | { type: "profile.list"; profiles: ProfileInfo[] }
  | { type: "session.list"; sessions: SessionSummary[] }
  | { type: "session.created"; reqId?: string; session: SessionSummary }
  | { type: "session.updated"; session: SessionSummary }
  | { type: "session.removed"; sessionId: string }
  | { type: "session.history"; sessionId: string; entries: HistoryEntry[] }
  | { type: "session.entry"; sessionId: string; entry: HistoryEntry }
  | { type: "error"; reqId?: string; message: string };
