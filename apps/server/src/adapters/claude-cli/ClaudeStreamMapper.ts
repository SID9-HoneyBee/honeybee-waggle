import type { AgentEvent, AuthMode, ToolKind } from "@honeybee-waggle/schema";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventBody = DistributiveOmit<AgentEvent, "runId" | "ts">;

// stream-json 한 줄의 형태. CLI 버전마다 필드가 늘어나므로 쓰는 필드만 느슨하게 잡는다.
interface ClaudeLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  parent_tool_use_id?: string | null;
  event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
  message?: { content?: ContentBlock[] | string };
  is_error?: boolean;
  result?: string;
  errors?: string[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  total_cost_usd?: number;
}

interface ContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: string | { type?: string; text?: string }[];
}

// Read 결과 등이 통째로 들어오면 events.jsonl이 금방 비대해진다. 화면에서 확인하는 용도라 앞부분만 남긴다.
const MAX_TOOL_OUTPUT = 20_000;

/**
 * Claude Code stream-json 한 줄 → AgentEvent[] 변환.
 * 매핑 기준은 스키마 7번 표이고, 2.1.316에서 실제 출력으로 확인했다.
 * run 하나당 인스턴스 하나를 쓴다 (nativeSessionId, 완료 여부를 run 단위로 들고 있어야 해서).
 */
export class ClaudeStreamMapper {
  private nativeSessionId?: string;
  /** result 줄을 받았는지. 못 받고 프로세스가 끝나면 어댑터가 run.completed를 대신 만든다 */
  completed = false;

  constructor(
    private readonly runId: string,
    private readonly auth: AuthMode,
  ) {}

  map(raw: unknown): AgentEvent[] {
    return this.mapBody(raw as ClaudeLine).map((body) => ({ ...body, runId: this.runId, ts: Date.now() }) as AgentEvent);
  }

  private mapBody(line: ClaudeLine): EventBody[] {
    // 서브에이전트(Task) 내부 메시지까지 본 대화에 섞으면 흐름이 뒤엉킨다. 1단계는 raw로만 보존한다.
    if (line.parent_tool_use_id) return [this.raw(line)];

    switch (line.type) {
      case "system":
        if (line.subtype === "init") {
          this.nativeSessionId = line.session_id;
          return [
            {
              type: "run.started",
              engine: "claude",
              auth: this.auth,
              runtime: "agent",
              nativeSessionId: line.session_id,
              model: line.model,
            },
          ];
        }
        break;

      case "stream_event": {
        const delta = line.event?.type === "content_block_delta" ? line.event.delta : undefined;
        if (delta?.type === "text_delta" && delta.text) return [{ type: "message.delta", text: delta.text }];
        // 구독 CLI는 thinking 원문을 비워서 보내는 경우가 많다. 빈 reasoning은 화면에 의미가 없어 내보내지 않는다.
        if (delta?.type === "thinking_delta" && delta.thinking) return [{ type: "reasoning", text: delta.thinking }];
        break;
      }

      case "assistant": {
        const blocks = Array.isArray(line.message?.content) ? line.message.content : [];
        const out: EventBody[] = [];
        for (const b of blocks) {
          if (b.type === "text" && b.text) {
            out.push({ type: "message.completed", text: b.text });
          } else if (b.type === "tool_use" && b.id) {
            out.push({ type: "tool.started", toolCallId: b.id, kind: toolKind(b.name), name: b.name ?? "", input: b.input });
          }
        }
        // thinking 블록만 있는 메시지는 이미 stream_event 단계에서 reasoning으로 처리했으므로 raw로도 남기지 않는다.
        if (out.length > 0 || blocks.every((b) => b.type === "thinking")) return out;
        break;
      }

      case "user": {
        const blocks = Array.isArray(line.message?.content) ? line.message.content : [];
        const out: EventBody[] = blocks
          .filter((b) => b.type === "tool_result" && b.tool_use_id)
          .map((b) => ({
            type: "tool.completed",
            toolCallId: b.tool_use_id!,
            ok: !b.is_error,
            output: toolOutputText(b.content),
          }));
        if (out.length > 0) return out;
        break;
      }

      case "result": {
        this.completed = true;
        const u = line.usage ?? {};
        const nativeSessionId = line.session_id ?? this.nativeSessionId;
        return [
          {
            type: "usage",
            // 캐시 적중분도 컨텍스트로 들어간 입력이라 합산한다. input_tokens만 보면 한 자릿수로 나와 의미가 없다.
            inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
            outputTokens: u.output_tokens,
            // 구독 모드에서도 total_cost_usd가 정가 환산값으로 찍혀 나온다. 실제 과금이 아니므로 비운다.
            costUsd: this.auth === "api" ? line.total_cost_usd : undefined,
          },
          line.is_error
            ? {
                type: "run.completed",
                status: "error",
                nativeSessionId,
                error: line.errors?.join("\n") || line.result || line.subtype || "unknown error",
              }
            : { type: "run.completed", status: "success", nativeSessionId },
        ];
      }
    }
    return [this.raw(line)];
  }

  private raw(payload: unknown): EventBody {
    return { type: "raw", engine: "claude", payload };
  }
}

function toolKind(name: string | undefined): ToolKind {
  if (!name) return "other";
  if (name.startsWith("mcp__")) return "mcp";
  switch (name) {
    case "Bash":
    case "PowerShell":
      return "shell";
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return "file_edit";
    case "Read":
    case "Glob":
    case "Grep":
      return "file_read";
    case "WebFetch":
    case "WebSearch":
      return "web";
    default:
      return "other";
  }
}

function toolOutputText(content: ContentBlock["content"]): string | undefined {
  if (content === undefined) return undefined;
  const text =
    typeof content === "string"
      ? content
      : content.map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`)).join("\n");
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n…(${text.length - MAX_TOOL_OUTPUT}자 생략)` : text;
}
