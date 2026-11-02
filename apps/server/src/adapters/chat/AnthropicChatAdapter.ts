import Anthropic from "@anthropic-ai/sdk";
import type {
  AdapterCapabilities,
  AgentEvent,
  BackendProfile,
  EngineAdapter,
  HistoryEntry,
  RunRequest,
} from "@honeybee-waggle/schema";
import { anthropicCost } from "./modelCatalog";

interface AnthropicChatAdapterOptions {
  /** 설정 화면에서 모델이 바뀌면 다음 run부터 반영되도록 매번 다시 받는다 */
  getProfile: () => BackendProfile;
  resolveKey: (ref: string) => string;
  loadHistory: (sessionId: string) => Promise<HistoryEntry[]>;
}

/** 다음 턴에 assistant 메시지를 그대로 되돌려 보내기 위해 저장하는 raw 이벤트의 표식 */
const ASSISTANT_RECORD = "anthropic.assistant";

/**
 * Claude Messages API로 직접 대화한다 (runtime "chat"). 도구·파일 접근은 없다.
 * API는 대화 상태를 들고 있지 않아서 매 run마다 이 세션의 기록으로 messages를 다시 만든다.
 * 이때 assistant 쪽은 화면용 텍스트가 아니라 응답 content 원본(thinking 블록 포함)을 그대로 돌려보낸다.
 * thinking 블록은 생성한 대화에 묶여 있어서, 텍스트만 추려 보내면 기록을 고친 것으로 취급될 수 있다.
 */
export class AnthropicChatAdapter implements EngineAdapter {
  readonly capabilities: AdapterCapabilities = {
    tools: false,
    fileEdits: false,
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
    yield { type: "run.started", runId, ts: Date.now(), engine: "claude", auth: profile.auth, runtime: "chat", model };

    try {
      if (!model) throw new Error("모델이 정해지지 않음. 설정에서 모델 목록을 확인해줘.");
      const client = new Anthropic({ apiKey: this.opts.resolveKey(profile.apiKeyRef!) });
      const messages = buildMessages(await this.opts.loadHistory(req.sessionId), runId, req.prompt);

      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          // display를 summarized로 열어야 화면에 생각 요약이 보인다. 기본(omitted)은 빈 문자열이라 긴 침묵처럼 보인다.
          thinking: { type: "adaptive", display: "summarized" },
          // claude-opus-5-5의 기본 effort는 medium. 대화 용도라 그대로 쓰되 모델이 바뀌어도 같은 수준이 되게 명시한다.
          output_config: { effort: "medium" },
          // 매 턴 전체 기록을 다시 보내므로 앞부분 캐시가 비용을 크게 줄인다.
          cache_control: { type: "ephemeral" },
          // 안전 분류기가 거절하면 서버가 다른 모델로 이어서 답하게 한다 (claude-api 스킬 기본값).
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          messages,
        },
        { signal },
      );

      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          yield { type: "message.delta", runId, ts: Date.now(), text: ev.delta.text };
        }
      }
      const msg = await stream.finalMessage();

      yield { type: "raw", runId, ts: Date.now(), engine: "claude", payload: { kind: ASSISTANT_RECORD, content: msg.content } };
      for (const block of msg.content) {
        if (block.type === "thinking" && block.thinking) {
          yield { type: "reasoning", runId, ts: Date.now(), text: block.thinking };
        } else if (block.type === "text" && block.text) {
          yield { type: "message.completed", runId, ts: Date.now(), text: block.text };
        }
      }

      const u = msg.usage;
      yield {
        type: "usage",
        runId,
        ts: Date.now(),
        inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens,
        // fallback으로 다른 모델이 답했을 수 있어 요청 모델이 아니라 응답 모델 단가로 계산한다.
        costUsd: anthropicCost(msg.model, u),
      };

      if (msg.stop_reason === "refusal") {
        const category = msg.stop_details?.category ?? "unknown";
        yield { type: "run.completed", runId, ts: Date.now(), status: "error", error: `모델이 응답을 거절함 (${category})` };
      } else {
        yield { type: "run.completed", runId, ts: Date.now(), status: "success" };
      }
    } catch (err) {
      if (signal.aborted) {
        yield { type: "run.completed", runId, ts: Date.now(), status: "cancelled" };
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
      yield { type: "run.completed", runId, ts: Date.now(), status: "error", error: message };
    }
  }
}

/**
 * 저장된 기록 → Messages API 형식.
 * 실패·취소된 run은 assistant 기록 없이 user만 남는데, 연속된 user 메시지는 API가 한 턴으로 합쳐준다.
 */
function buildMessages(history: HistoryEntry[], currentRunId: string, prompt: string): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const e of history) {
    if (e.kind === "user") {
      // 이번 run의 user 항목은 이미 기록에 들어가 있다. 아래에서 prompt로 한 번만 넣는다.
      if (e.runId !== currentRunId) messages.push({ role: "user", content: e.text });
    } else if (e.event.type === "raw") {
      const p = e.event.payload as { kind?: string; content?: Anthropic.Beta.BetaContentBlockParam[] } | null;
      if (p?.kind === ASSISTANT_RECORD && p.content) messages.push({ role: "assistant", content: p.content });
    }
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}
