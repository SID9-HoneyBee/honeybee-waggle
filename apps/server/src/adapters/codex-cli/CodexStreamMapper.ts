import type { AgentEvent, AuthMode, ToolKind } from "@honeybee-waggle/schema";
import type { LineMapper } from "../cliProcess";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventBody = DistributiveOmit<AgentEvent, "runId" | "ts">;

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  message?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  changes?: { path?: string; kind?: string }[];
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: { message?: string } | null;
  query?: string;
}

interface CodexLine {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
  message?: string;
}

const MAX_TOOL_OUTPUT = 20_000;

/**
 * codex exec --json 한 줄 → AgentEvent[] 변환.
 * 매핑 기준은 스키마 7번 표이고, codex-cli 0.164.0에서 실제 출력으로 확인했다.
 * claude와 달리 delta가 없어서 message.delta는 나오지 않는다 (응답이 문단 단위로 한 번에 온다).
 */
export class CodexStreamMapper implements LineMapper {
  completed = false;
  private threadId?: string;
  private lastError?: string;
  /** item.started 없이 item.completed만 오는 도구도 있어서, 카드가 생기도록 started를 대신 만들어야 하는지 추적한다 */
  private readonly startedTools = new Set<string>();

  constructor(
    private readonly runId: string,
    private readonly auth: AuthMode,
    private readonly model?: string,
  ) {}

  map(raw: unknown): AgentEvent[] {
    return this.mapBody(raw as CodexLine).map((body) => ({ ...body, runId: this.runId, ts: Date.now() }) as AgentEvent);
  }

  /** turn.completed/failed 없이 프로세스가 끝났을 때 원인으로 쓸 마지막 에러. stderr는 MCP 경고 등 잡음이 많다 */
  failureHint(): string | undefined {
    return this.lastError;
  }

  private mapBody(line: CodexLine): EventBody[] {
    switch (line.type) {
      case "thread.started":
        this.threadId = line.thread_id;
        return [
          {
            type: "run.started",
            engine: "codex",
            auth: this.auth,
            runtime: "agent",
            nativeSessionId: line.thread_id,
            model: this.model,
          },
        ];

      case "item.started":
      case "item.completed": {
        const out = line.item ? this.mapItem(line.item, line.type === "item.completed") : [];
        if (out.length > 0) return out;
        break;
      }

      case "turn.completed":
        this.completed = true;
        return [
          {
            type: "usage",
            // OpenAI usage의 input_tokens는 캐시 적중분을 이미 포함한다 (claude와 다름).
            inputTokens: line.usage?.input_tokens,
            outputTokens: line.usage?.output_tokens,
            // codex는 비용을 보고하지 않는다. 토큰×단가로 추정하면 실제 청구와 어긋나 예산 판단을 오도하므로 비워둔다.
            costUsd: undefined,
          },
          { type: "run.completed", status: "success", nativeSessionId: this.threadId },
        ];

      case "turn.failed":
        this.completed = true;
        return [
          {
            type: "run.completed",
            status: "error",
            nativeSessionId: this.threadId,
            error: line.error?.message ?? this.lastError ?? "turn.failed",
          },
        ];

      case "error":
        // 재연결 중 같은 일시적 오류도 error로 오고, 그 뒤에 turn이 정상 완료되기도 한다.
        // 여기서 run을 끝내지 않고 기억만 해뒀다가 turn.failed나 비정상 종료 때 원인으로 쓴다.
        this.lastError = line.message ?? line.error?.message;
        break;
    }
    return [{ type: "raw", engine: "codex", payload: line }];
  }

  private mapItem(item: CodexItem, done: boolean): EventBody[] {
    const id = item.id ?? "";
    switch (item.type) {
      case "agent_message":
        return done && item.text ? [{ type: "message.completed", text: item.text }] : [];
      case "reasoning":
        return done && item.text ? [{ type: "reasoning", text: item.text }] : [];
      case "command_execution":
        return this.tool(id, done, "shell", "shell", { command: item.command }, () => ({
          ok: item.exit_code === 0,
          output: truncate(item.aggregated_output),
        }));
      case "mcp_tool_call":
        return this.tool(id, done, "mcp", `${item.server}.${item.tool}`, item.arguments, () => ({
          ok: item.status === "completed" && !item.error,
          output: truncate(item.error?.message ?? stringify(item.result)),
        }));
      case "web_search":
        return this.tool(id, done, "web", "web_search", { query: item.query }, () => ({ ok: true }));
      case "file_change":
        if (!done) return [];
        return (item.changes ?? []).map((c) => ({
          type: "file.changed",
          path: c.path ?? "",
          change: c.kind === "add" ? "add" : c.kind === "delete" ? "delete" : "modify",
        }));
      // error 아이템은 config 경고 같은 비치명적 알림이다. todo_list 등 나머지와 함께 raw로 둔다.
      default:
        return [];
    }
  }

  private tool(
    id: string,
    done: boolean,
    kind: ToolKind,
    name: string,
    input: unknown,
    result: () => { ok: boolean; output?: string },
  ): EventBody[] {
    const out: EventBody[] = [];
    if (!this.startedTools.has(id)) {
      this.startedTools.add(id);
      out.push({ type: "tool.started", toolCallId: id, kind, name, input });
    }
    if (done) out.push({ type: "tool.completed", toolCallId: id, ...result() });
    return out;
  }
}

function stringify(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return typeof v === "string" ? v : JSON.stringify(v);
}

function truncate(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n…(${text.length - MAX_TOOL_OUTPUT}자 생략)` : text;
}
