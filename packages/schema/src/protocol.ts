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

/**
 * API 세션 폴더 도구의 승인 방식.
 * writes = 수정만 확인(기본), all = 읽기 포함 매번 확인, none = 모두 자동
 */
export type ApprovalPolicy = "writes" | "all" | "none";

/** 서버가 도구 실행 직전에 멈추고 사용자에게 묻는 요청 */
export interface ApprovalRequest {
  approvalId: string;
  runId: string;
  toolCallId: string;
  tool: string;
  action: "list" | "read" | "write";
  /** 연결 폴더 기준 상대 경로 */
  path: string;
  /** 수정 요청일 때 변경 내용 (unified diff) */
  diff?: string;
  /** .env·키 파일처럼 비밀이 있을 수 있는 파일. 승인 방식과 무관하게 묻고, 화면에 경고를 띄운다 */
  sensitive?: boolean;
}

export interface SessionMeta {
  id: string;
  title: string;
  profileId: string;
  cwd: string;
  permission: PermissionLevel;
  /**
   * API(chat) 세션에서는 cwd가 "연결된 폴더"다 (빈 값이면 파일 도구 없음).
   * approval은 그 폴더 도구의 승인 방식이며 chat 세션에서만 쓴다.
   */
  approval?: ApprovalPolicy;
  /** 다음 run에서 --resume으로 넘길 값. run마다 엔진이 돌려준 최신 값으로 갱신된다 */
  nativeSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummary extends SessionMeta {
  running: boolean;
}

/** 메시지에 첨부할 다른 세션. includeTools면 정리본에 도구 호출 과정도 넣는다 */
export interface SessionRef {
  sessionId: string;
  includeTools: boolean;
}

/** 첨부된 참조의 표시용 정보. 원본 세션이 나중에 삭제·변경돼도 당시 모습으로 보이게 함께 저장한다 */
export interface AttachedRef extends SessionRef {
  title: string;
  profileId: string;
  chars: number;
}

/** 브라우저에서 고른 텍스트 파일. 내용은 메시지 context에 합쳐지고, 기록에는 이름·크기만 따로 남는다 */
export interface FileAttachment {
  name: string;
  content: string;
}

export interface AttachedFile {
  name: string;
  chars: number;
}

/**
 * seq는 디스크에 저장된 항목에만 붙는다.
 * 세션을 열 때 "구독 → 기록 전송" 사이에 끼어든 실시간 항목이 기록과 중복될 수 있어서,
 * 클라이언트가 seq로 중복을 걸러낸다. message.delta처럼 저장하지 않는 항목은 seq가 없다.
 */
export type HistoryEntry = (
  | {
      kind: "user";
      runId: string;
      /** 사용자가 입력한 문장 그대로 (화면 표시·제목용) */
      text: string;
      ts: number;
      refs?: AttachedRef[];
      files?: AttachedFile[];
      /** 첨부(세션 정리본·파일)를 합친 텍스트. 모델에는 context + text가 간다. 대화 재구성(Claude API)도 이 값을 쓴다 */
      context?: string;
    }
  | { kind: "event"; event: AgentEvent }
) & { seq?: number };

export type ClientMessage = { reqId?: string } & (
  | { type: "session.list" }
  | { type: "session.create"; title?: string; cwd: string; permission: PermissionLevel; profileId: string }
  | { type: "session.open"; sessionId: string }
  | { type: "session.close"; sessionId: string }
  | { type: "session.delete"; sessionId: string }
  | { type: "session.rename"; sessionId: string; title: string }
  | { type: "session.setFolder"; sessionId: string; folder: string | null; approval: ApprovalPolicy }
  | { type: "approval.respond"; sessionId: string; approvalId: string; approve: boolean }
  | { type: "run.send"; sessionId: string; text: string; refs?: SessionRef[]; files?: FileAttachment[] }
  | { type: "session.transcript"; sessionId: string; includeTools: boolean }
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
  | { type: "approval.request"; sessionId: string; request: ApprovalRequest }
  | { type: "approval.resolved"; sessionId: string; approvalId: string }
  | { type: "session.history"; sessionId: string; entries: HistoryEntry[] }
  | { type: "session.transcript"; reqId?: string; sessionId: string; text: string; chars: number }
  | { type: "session.entry"; sessionId: string; entry: HistoryEntry }
  | { type: "error"; reqId?: string; message: string };
