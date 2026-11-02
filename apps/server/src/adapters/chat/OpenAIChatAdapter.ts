import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type { AdapterCapabilities, AgentEvent, BackendProfile, EngineAdapter, RunRequest } from "@honeybee-waggle/schema";

interface OpenAIChatAdapterOptions {
  /** 설정 화면에서 모델이 바뀌면 다음 run부터 반영되도록 매번 다시 받는다 */
  getProfile: () => BackendProfile;
  resolveKey: (ref: string) => string;
  filesDir: (sessionId: string) => string;
}

/**
 * OpenAI Responses API로 직접 대화한다 (runtime "chat"). 이미지 생성 도구를 켜둔다.
 * 대화 이어가기는 previous_response_id로 처리한다. OpenAI가 이전 응답(생성한 이미지 포함)을 서버에 보관하므로
 * Anthropic처럼 기록을 다시 보낼 필요가 없고, nativeSessionId에 마지막 response id를 담는다.
 */
export class OpenAIChatAdapter implements EngineAdapter {
  readonly capabilities: AdapterCapabilities = {
    tools: false,
    fileEdits: false,
    resume: true,
    partialStreaming: true,
    reportsCost: false,
  };

  constructor(private readonly opts: OpenAIChatAdapterOptions) {}

  get profile(): BackendProfile {
    return this.opts.getProfile();
  }

  async *run(req: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const profile = this.profile;
    const runId = req.runId;
    const model = profile.model;
    yield { type: "run.started", runId, ts: Date.now(), engine: "codex", auth: profile.auth, runtime: "chat", model };

    try {
      if (!model) throw new Error("모델이 정해지지 않음. 설정에서 모델 목록을 확인해줘.");
      const client = new OpenAI({ apiKey: this.opts.resolveKey(profile.apiKeyRef!) });
      const stream = await client.responses.create(
        {
          model,
          input: req.prompt,
          // GPT API가 codex CLI 방식이던 때 만든 세션은 codex thread ID를 들고 있다. 그걸 보내면 404라서 resp_ 형식만 이어받는다.
          previous_response_id: req.resumeNativeId?.startsWith("resp_") ? req.resumeNativeId : undefined,
          tools: [{ type: "image_generation" }],
          stream: true,
        },
        { signal },
      );

      for await (const ev of stream) {
        switch (ev.type) {
          case "response.output_text.delta":
            yield { type: "message.delta", runId, ts: Date.now(), text: ev.delta };
            break;
          case "response.output_item.added":
            if (ev.item.type === "image_generation_call") {
              yield {
                type: "tool.started",
                runId,
                ts: Date.now(),
                toolCallId: ev.item.id,
                kind: "other",
                name: "image_generation",
                input: {},
              };
            }
            break;
          case "response.output_item.done": {
            const item = ev.item;
            if (item.type === "message") {
              const text = item.content.map((c) => (c.type === "output_text" ? c.text : "")).join("");
              if (text) yield { type: "message.completed", runId, ts: Date.now(), text };
            } else if (item.type === "reasoning") {
              const text = (item.summary ?? []).map((s) => s.text).join("\n");
              if (text) yield { type: "reasoning", runId, ts: Date.now(), text };
            } else if (item.type === "image_generation_call") {
              yield* this.saveImage(req.sessionId, runId, item);
            }
            break;
          }
          case "response.completed": {
            const u = ev.response.usage;
            yield {
              type: "usage",
              runId,
              ts: Date.now(),
              inputTokens: u?.input_tokens,
              outputTokens: u?.output_tokens,
              // Responses API는 비용을 주지 않는다. 단가표를 유지할 근거가 없어 토큰만 보여준다.
              costUsd: undefined,
            };
            yield { type: "run.completed", runId, ts: Date.now(), status: "success", nativeSessionId: ev.response.id };
            return;
          }
          case "response.failed":
            yield {
              type: "run.completed",
              runId,
              ts: Date.now(),
              status: "error",
              error: ev.response.error?.message ?? "응답 생성 실패",
            };
            return;
          case "error":
            yield { type: "run.completed", runId, ts: Date.now(), status: "error", error: ev.message };
            return;
        }
      }
      yield { type: "run.completed", runId, ts: Date.now(), status: "error", error: "응답이 완료 이벤트 없이 끝남" };
    } catch (err) {
      if (signal.aborted) {
        yield { type: "run.completed", runId, ts: Date.now(), status: "cancelled" };
        return;
      }
      const message =
        err instanceof OpenAI.AuthenticationError
          ? "API 키가 유효하지 않음. 설정에서 다시 등록해줘."
          : err instanceof OpenAI.RateLimitError
            ? "요청 한도 초과 또는 크레딧 부족. 잠시 후 다시 시도하거나 OpenAI 결제 상태를 확인해줘."
            : err instanceof Error
              ? err.message
              : String(err);
      yield { type: "run.completed", runId, ts: Date.now(), status: "error", error: message };
    }
  }

  /**
   * 생성된 이미지는 base64로 오는데, 그대로 기록(events.jsonl)에 넣으면 한 장에 수 MB씩 불어난다.
   * 세션 폴더에 파일로 저장하고 기록에는 상대 경로(files/<이름>)만 남긴다. 웹은 서버의 /files 경로로 받아 그린다.
   */
  private async *saveImage(
    sessionId: string,
    runId: string,
    item: { id: string; result: string | null; revised_prompt?: string | null; output_format?: string | null },
  ): AsyncIterable<AgentEvent> {
    if (!item.result) {
      yield { type: "tool.completed", runId, ts: Date.now(), toolCallId: item.id, ok: false, output: "이미지 결과 없음" };
      return;
    }
    const ext = item.output_format === "jpeg" ? "jpg" : (item.output_format ?? "png");
    // item.id는 API가 준 값이지만 파일명으로 쓰기 전에 안전한 문자만 남긴다.
    const name = `${item.id.replace(/[^A-Za-z0-9_-]/g, "")}.${ext}`;
    const dir = this.opts.filesDir(sessionId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), Buffer.from(item.result, "base64"));
    yield {
      type: "tool.completed",
      runId,
      ts: Date.now(),
      toolCallId: item.id,
      ok: true,
      output: item.revised_prompt ?? undefined,
    };
    yield { type: "file.changed", runId, ts: Date.now(), path: `files/${name}`, change: "add" };
  }
}
