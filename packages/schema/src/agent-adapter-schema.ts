/**
 * Agent Adapter Schema v0.1
 * Claude / Codex × 구독(CLI) / API 를 하나의 이벤트 포맷으로 정규화한다.
 * 프론트(Next.js)와 백엔드가 이 파일을 공유한다.
 */

// ─────────────────────────────────────────────
// 1. 실행 프로필: 엔진 × 인증 × 런타임
// ─────────────────────────────────────────────

export type Engine = "claude" | "codex";
export type AuthMode = "subscription" | "api";
/** agent = CLI 에이전트(툴·파일 수정 가능), chat = 순수 API 호출(툴 없음) */
export type Runtime = "agent" | "chat";

export interface BackendProfile {
  id: string;               // "claude-sub", "claude-api", "codex-sub", "codex-api", "claude-chat" ...
  engine: Engine;
  auth: AuthMode;
  runtime: Runtime;
  model?: string;           // 미지정 시 각 CLI 기본값
  /** 프로필별 설정 폴더 격리 (CLAUDE_CONFIG_DIR / CODEX_HOME) */
  configDir?: string;
  /** 키 원문이 아니라 비밀 저장소 참조명 */
  apiKeyRef?: string;
  /** 월 예산 상한(USD). api 모드에서만 의미 있음 */
  budgetUsd?: number;
}

/** 런타임 조합 규칙
 *  subscription → runtime "agent" 만 허용 (구독은 CLI 경유로만 사용)
 *  api          → "agent"(CLI에 키 주입) 또는 "chat"(SDK 직접 호출)
 */
export function isValidProfile(p: BackendProfile): boolean {
  if (p.auth === "subscription" && p.runtime !== "agent") return false;
  if (p.auth === "api" && !p.apiKeyRef) return false;
  return true;
}

// ─────────────────────────────────────────────
// 2. 실행 요청
// ─────────────────────────────────────────────

/** 헤드리스에서는 승인 프롬프트에 답할 수 없으므로 권한을 미리 정한다 */
export type PermissionLevel = "read-only" | "workspace-write" | "full";

export interface RunRequest {
  runId: string;
  sessionId: string;        // 우리 시스템의 세션 ID
  profileId: string;
  prompt: string;
  cwd?: string;             // agent 런타임 작업 폴더
  permission: PermissionLevel;
  /** 이어하기: 엔진이 돌려준 네이티브 세션 ID (claude session_id / codex thread_id) */
  resumeNativeId?: string;
  timeoutMs?: number;
}

// ─────────────────────────────────────────────
// 3. 정규화 이벤트 (프론트는 이것만 안다)
// ─────────────────────────────────────────────

interface Base { runId: string; ts: number; }

export type ToolKind = "shell" | "file_read" | "file_edit" | "web" | "mcp" | "other";

export type AgentEvent =
  | (Base & { type: "run.started"; engine: Engine; auth: AuthMode; runtime: Runtime;
              nativeSessionId?: string; model?: string })
  | (Base & { type: "message.delta"; text: string })
  | (Base & { type: "message.completed"; text: string })
  | (Base & { type: "reasoning"; text: string })
  | (Base & { type: "tool.started"; toolCallId: string; kind: ToolKind; name: string; input: unknown })
  | (Base & { type: "tool.completed"; toolCallId: string; ok: boolean; output?: string })
  | (Base & { type: "file.changed"; path: string; change: "add" | "modify" | "delete"; diff?: string })
  | (Base & { type: "usage"; inputTokens?: number; outputTokens?: number;
              /** api 모드에서만 실제 과금액. 구독 모드는 undefined */
              costUsd?: number })
  | (Base & { type: "run.completed"; status: "success" | "error" | "cancelled" | "timeout";
              nativeSessionId?: string; error?: string })
  /** 매핑 안 된 원본 이벤트. CLI 버전업 대응·디버깅용으로 항상 보존 */
  | (Base & { type: "raw"; engine: Engine; payload: unknown });

// ─────────────────────────────────────────────
// 4. 어댑터 인터페이스
// ─────────────────────────────────────────────

export interface AdapterCapabilities {
  tools: boolean;           // chat 런타임은 false
  fileEdits: boolean;
  resume: boolean;
  partialStreaming: boolean;
  reportsCost: boolean;
}

export interface EngineAdapter {
  readonly profile: BackendProfile;
  readonly capabilities: AdapterCapabilities;
  run(req: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

/** 구현체 4종
 *  ClaudeCliAdapter   — subscription | api(키 주입)   claude -p ... --output-format stream-json
 *  CodexCliAdapter    — subscription | api(키 로그인)  codex exec --json ...
 *  AnthropicChatAdapter — api 전용, Messages API 스트리밍
 *  OpenAIChatAdapter    — api 전용, Responses API 스트리밍
 */

// ─────────────────────────────────────────────
// 5. 인증 격리: spawn 할 때 env 를 명시적으로 만든다
// ─────────────────────────────────────────────

const STRIP_KEYS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY", "CODEX_API_KEY",
];

export function buildEnv(
  p: BackendProfile,
  base: NodeJS.ProcessEnv,
  resolveKey: (ref: string) => string,
): NodeJS.ProcessEnv {
  // 부모 프로세스 env 의 키가 새어 들어가 구독 대신 API 로 과금되는 사고 방지
  const env: NodeJS.ProcessEnv = { ...base };
  for (const k of STRIP_KEYS) delete env[k];

  if (p.engine === "claude") {
    if (p.configDir) env.CLAUDE_CONFIG_DIR = p.configDir;
    if (p.auth === "api") env.ANTHROPIC_API_KEY = resolveKey(p.apiKeyRef!);
  } else {
    // Codex 는 프로필별 CODEX_HOME 에 각각 로그인해 둔다
    //   구독:  CODEX_HOME=<dir> codex login
    //   API :  CODEX_HOME=<dir> codex login --with-api-key  (키는 stdin)
    if (p.configDir) env.CODEX_HOME = p.configDir;
  }
  return env;
}

// ─────────────────────────────────────────────
// 6. 권한 매핑
// ─────────────────────────────────────────────

export const PERMISSION_FLAGS: Record<Engine, Record<PermissionLevel, string[]>> = {
  claude: {
    "read-only":       ["--permission-mode", "plan"],
    "workspace-write": ["--permission-mode", "acceptEdits"],
    "full":            ["--permission-mode", "bypassPermissions"],
  },
  codex: {
    "read-only":       ["--sandbox", "read-only"],
    "workspace-write": ["--sandbox", "workspace-write"],
    "full":            ["--sandbox", "danger-full-access"],
  },
};

// ─────────────────────────────────────────────
// 7. 원본 → 정규화 매핑표 (설치된 CLI 버전으로 반드시 검증)
// ─────────────────────────────────────────────
/*
 Claude Code (stream-json)
   system/init (session_id)            → run.started.nativeSessionId
   stream_event text delta             → message.delta   (--include-partial-messages 필요)
   assistant: content[text]            → message.completed
   assistant: content[tool_use]        → tool.started  (Bash→shell, Edit/Write→file_edit, Read→file_read)
   user: content[tool_result]          → tool.completed
   result (usage, total_cost_usd)      → usage + run.completed
     * 구독 모드에서도 total_cost_usd 가 나올 수 있음 → auth=subscription 이면 costUsd 를 비운다

 Codex (exec --json)
   thread.started (thread_id)          → run.started.nativeSessionId
   item.completed: agent_message       → message.completed
   item.*: reasoning                   → reasoning
   item.started: command_execution     → tool.started(kind=shell)
   item.completed: command_execution   → tool.completed
   item.completed: file_change         → file.changed (파일마다 1건)
   item.*: mcp_tool_call / web_search  → tool.*(kind=mcp / web)
   turn.completed (usage)              → usage + run.completed(success)
   turn.failed / error                 → run.completed(error)

 그 외 전부                             → raw
*/
