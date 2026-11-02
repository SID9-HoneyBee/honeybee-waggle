import Anthropic from "@anthropic-ai/sdk";
import type {
  AdapterCapabilities,
  AgentEvent,
  BackendProfile,
  EngineAdapter,
  HistoryEntry,
  RunRequest,
} from "@honeybee-waggle/schema";
import { composePrompt } from "../../session/transcript";
import type { ToolGateway } from "../../tools/ToolGateway";
import { anthropicCost } from "./modelCatalog";
import { folderInstructions, MAX_TOOL_TURNS, toolKindOf } from "./chatTools";

interface AnthropicChatAdapterOptions {
  /** 설정 화면에서 모델이 바뀌면 다음 run부터 반영되도록 매번 다시 받는다 */
  getProfile: () => BackendProfile;
  resolveKey: (ref: string) => string;
  loadHistory: (sessionId: string) => Promise<HistoryEntry[]>;
  tools: ToolGateway;
}

/**
 * 다음 턴에 대화를 그대로 다시 보내기 위해 저장하는 raw 이벤트의 표식.
 * assistant = 응답 content 원본, tool_results = 도구 결과 user 메시지 원본.
 */
const ASSISTANT_RECORD = "anthropic.assistant";
const TOOL_RESULTS_RECORD = "anthropic.tool_results";

/**
 * Claude Messages API로 직접 대화한다 (runtime "chat"). 폴더가 연결된 세션이면 파일 도구를 준다.
 * API는 대화 상태를 들고 있지 않아서 매 run마다 이 세션의 기록으로 messages를 다시 만든다.
 * 이때 assistant 쪽은 화면용 텍스트가 아니라 응답 content 원본(thinking 블록 포함)을 그대로 돌려보낸다.
 * thinking 블록은 생성한 대화에 묶여 있어서, 텍스트만 추려 보내면 기록을 고친 것으로 취급될 수 있다.
 */
export class AnthropicChatAdapter implements EngineAdapter {
  readonly capabilities: AdapterCapabilities = {
    tools: true,
    fileEdits: true,
    resume: true,
    partialStreaming: true,
    reportsCost: true,
  };

  constructor(private readonly opts: AnthropicChatAdapterOptions) {}

  get profile(): BackendProfile {
    return this.opts.getProfile();
  }

  async *run(req: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const profile = this.profile;
    const runId = req.runId;
    const model = profile.model;
    const now = () => Date.now();
    yield { type: "run.started", runId, ts: now(), engine: "claude", auth: profile.auth, runtime: "chat", model };

    try {
      if (!model) throw new Error("모델이 정해지지 않음. 설정에서 모델 목록을 확인해줘.");
      const client = new Anthropic({ apiKey: this.opts.resolveKey(profile.apiKeyRef!) });
      const messages = buildMessages(await this.opts.loadHistory(req.sessionId), req.runId, req.prompt);
      const specs = this.opts.tools.toolsFor(req.sessionId);
      const folder = this.opts.tools.folderOf(req.sessionId);
      const tools: Anthropic.Beta.BetaToolUnion[] = specs.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema,
      }));

      for (let turn = 0; ; turn++) {
        const stream = client.beta.messages.stream(
          {
            model,
            max_tokens: 64000,
            // display를 summarized로 열어야 화면에 생각 요약이 보인다. 기본(omitted)은 빈 문자열이라 긴 침묵처럼 보인다.
            thinking: { type: "adaptive", display: "summarized" },
            // claude-opus-5-5의 기본 effort는 medium. 모델이 바뀌어도 같은 수준이 되게 명시한다.
            output_config: { effort: "medium" },
            // 매 턴 전체 기록을 다시 보내므로 앞부분 캐시가 비용을 크게 줄인다.
            cache_control: { type: "ephemeral" },
            // 안전 분류기가 거절하면 서버가 다른 모델로 이어서 답하게 한다 (claude-api 스킬 기본값).
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            ...(folder ? { system: folderInstructions(folder) } : {}),
            ...(tools.length ? { tools } : {}),
            messages,
          },
          { signal },
        );

        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            yield { type: "message.delta", runId, ts: now(), text: ev.delta.text };
          }
        }
        const msg = await stream.finalMessage();
        messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
        yield { type: "raw", runId, ts: now(), engine: "claude", payload: { kind: ASSISTANT_RECORD, content: msg.content } };

        const toolUses: Anthropic.Beta.BetaToolUseBlock[] = [];
        for (const block of msg.content) {
          if (block.type === "thinking" && block.thinking) {
            yield { type: "reasoning", runId, ts: now(), text: block.thinking };
          } else if (block.type === "text" && block.text) {
            yield { type: "message.completed", runId, ts: now(), text: block.text };
          } else if (block.type === "tool_use") {
            toolUses.push(block);
            yield {
              type: "tool.started",
              runId,
              ts: now(),
              toolCallId: block.id,
              kind: toolKindOf(block.name),
              name: block.name,
              input: block.input,
            };
          }
        }

        const u = msg.usage;
        yield {
          type: "usage",
          runId,
          ts: now(),
          inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
          outputTokens: u.output_tokens,
          // fallback으로 다른 모델이 답했을 수 있어 요청 모델이 아니라 응답 모델 단가로 계산한다.
          costUsd: anthropicCost(msg.model, u),
        };

        if (msg.stop_reason === "refusal") {
          const category = msg.stop_details?.category ?? "unknown";
          yield { type: "run.completed", runId, ts: now(), status: "error", error: `모델이 응답을 거절함 (${category})` };
          return;
        }
        if (msg.stop_reason !== "tool_use" || toolUses.length === 0) break;
        if (turn + 1 >= MAX_TOOL_TURNS) {
          yield { type: "run.completed", runId, ts: now(), status: "error", error: `도구 사용이 ${MAX_TOOL_TURNS}번을 넘어 중단함` };
          return;
        }

        // 병렬 도구 호출은 결과를 한 user 메시지에 모아서 돌려줘야 한다 (나눠 보내면 모델이 병렬 호출을 덜 하게 된다).
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const use of toolUses) {
          const r = await this.opts.tools.execute(req.sessionId, runId, use.id, use.name, use.input, signal);
          yield { type: "tool.completed", runId, ts: now(), toolCallId: use.id, ok: r.ok, output: r.output };
          results.push({ type: "tool_result", tool_use_id: use.id, content: r.output, is_error: !r.ok });
        }
        if (signal.aborted) throw new Error("aborted");
        messages.push({ role: "user", content: results });
        yield { type: "raw", runId, ts: now(), engine: "claude", payload: { kind: TOOL_RESULTS_RECORD, content: results } };
      }

      yield { type: "run.completed", runId, ts: now(), status: "success" };
    } catch (err) {
      if (signal.aborted) {
        yield { type: "run.completed", runId, ts: now(), status: "cancelled" };
        return;
      }
      const message =
        err instanceof Anthropic.AuthenticationError
          ? "API 키가 유효하지 않음. 설정에서 다시 등록해줘."
          : err instanceof Anthropic.RateLimitError
            ? "요청 한도 초과. 잠시 후 다시 시도해줘."
            : err instanceof Error
              ? err.message
              : String(err);
      yield { type: "run.completed", runId, ts: now(), status: "error", error: message };
    }
  }
}

/**
 * 저장된 기록 → Messages API 형식.
 * 실패·취소된 run은 assistant 기록 없이 user만 남는데, 연속된 user 메시지는 API가 한 턴으로 합쳐준다.
 * 도구를 쓰다 중단된 run은 tool_use 뒤에 tool_result가 없는 상태로 끝날 수 있다. 그대로 보내면 400이라
 * 짝이 없는 tool_use에는 "중단됨" 결과를 채워 넣는다.
 */
function buildMessages(history: HistoryEntry[], currentRunId: string, prompt: string): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  let openToolUses: string[] = [];
  const closeOpenToolUses = () => {
    if (openToolUses.length === 0) return;
    messages.push({
      role: "user",
      content: openToolUses.map((id) => ({ type: "tool_result", tool_use_id: id, content: "실행이 중단됨", is_error: true })),
    });
    openToolUses = [];
  };

  for (const e of history) {
    if (e.kind === "user") {
      // 이번 run의 user 항목은 이미 기록에 들어가 있다. 아래에서 prompt로 한 번만 넣는다.
      if (e.runId === currentRunId) continue;
      closeOpenToolUses();
      // 다른 세션·파일 첨부가 있던 턴은 당시 모델이 본 그대로(첨부 + 문장) 다시 보낸다.
      messages.push({ role: "user", content: composePrompt(e.context, e.text) });
    } else if (e.event.type === "raw") {
      const p = e.event.payload as { kind?: string; content?: Anthropic.Beta.BetaContentBlockParam[] } | null;
      if (!p?.content) continue;
      if (p.kind === ASSISTANT_RECORD) {
        closeOpenToolUses();
        messages.push({ role: "assistant", content: p.content });
        openToolUses = p.content.filter((b) => b.type === "tool_use").map((b) => (b as { id: string }).id);
      } else if (p.kind === TOOL_RESULTS_RECORD) {
        messages.push({ role: "user", content: p.content });
        openToolUses = [];
      }
    }
  }
  closeOpenToolUses();
  messages.push({ role: "user", content: prompt });
  return messages;
}
