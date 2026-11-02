import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type { AdapterCapabilities, AgentEvent, BackendProfile, EngineAdapter, HistoryEntry, RunRequest } from "@honeybee-waggle/schema";
import { FOLDER_TOOLS } from "../../tools/folderTools";
import type { ToolGateway } from "../../tools/ToolGateway";
import { folderInstructions, MAX_TOOL_TURNS, toolKindOf } from "./chatTools";

interface OpenAIChatAdapterOptions {
  /** 설정 화면에서 모델이 바뀌면 다음 run부터 반영되도록 매번 다시 받는다 */
  getProfile: () => BackendProfile;
  resolveKey: (ref: string) => string;
  filesDir: (sessionId: string) => string;
  loadHistory: (sessionId: string) => Promise<HistoryEntry[]>;
  tools: ToolGateway;
}

/** 이어가기 지점(응답 ID)과 그 응답에 아직 못 보낸 도구 결과를 기록하는 raw 이벤트의 표식 */
const OPENAI_STATE = "openai.state";

/**
 * OpenAI Responses API로 직접 대화한다 (runtime "chat"). 이미지 생성은 항상, 폴더가 연결되면 파일 도구도 준다.
 * 대화 이어가기는 previous_response_id로 처리한다. OpenAI가 이전 응답(생성 이미지·도구 호출 포함)을 서버에 보관하므로
 * Anthropic처럼 기록을 다시 보낼 필요가 없고, nativeSessionId에 마지막 response id를 담는다.
 */
export class OpenAIChatAdapter implements EngineAdapter {
  readonly capabilities: AdapterCapabilities = {
    tools: true,
    fileEdits: true,
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
    const now = () => Date.now();
    yield { type: "run.started", runId, ts: now(), engine: "codex", auth: profile.auth, runtime: "chat", model };

    // GPT API가 codex CLI 방식이던 때 만든 세션은 codex thread ID를 들고 있다. 그걸 보내면 404라서 resp_ 형식만 이어받는다.
    let previous = req.resumeNativeId?.startsWith("resp_") ? req.resumeNativeId : undefined;
    // 다음 요청에 함께 보내야 하는 도구 결과. 지난 run이 도구 실행 뒤에 끊겼다면 그 결과가 여기로 이어진다.
    let pending: OpenAI.Responses.ResponseInputItem[] = [];

    /**
     * run이 어떻게 끝나든 마지막으로 완료된 응답을 이어가기 지점으로 남긴다. 중간에 끊겼다고 이전 run의 응답으로 되돌아가면
     * 이번 요청과 이미 디스크에 적용된 수정이 OpenAI 쪽 대화에서 통째로 사라진다.
     * 그 응답이 도구 결과를 기다리는 상태면, 아직 못 보낸 결과를 기록해 두었다가 다음 run 첫 요청에 같이 보낸다.
     */
    const finish = (status: "success" | "error" | "cancelled", error?: string): AgentEvent[] => {
      const events: AgentEvent[] = [];
      if (pending.length > 0) {
        events.push({ type: "raw", runId, ts: now(), engine: "codex", payload: { kind: OPENAI_STATE, responseId: previous, pending } });
      }
      events.push({ type: "run.completed", runId, ts: now(), status, error, nativeSessionId: previous });
      return events;
    };

    try {
      if (previous) pending = findPendingOutputs(await this.opts.loadHistory(req.sessionId), previous);
      if (!model) throw new Error("모델이 정해지지 않음. 설정에서 모델 목록을 확인해줘.");
      const client = new OpenAI({ apiKey: this.opts.resolveKey(profile.apiKeyRef!) });
      const folder = this.opts.tools.folderOf(req.sessionId);
      // 폴더를 해제했어도 지난 도구 호출에 대한 결과를 보내야 하는 경우엔 정의를 유지한다 (실제 호출은 Gateway가 막는다).
      const specs = folder || pending.length > 0 ? FOLDER_TOOLS : [];
      const tools: OpenAI.Responses.Tool[] = [
        { type: "image_generation" },
        ...specs.map(
          (t): OpenAI.Responses.FunctionTool => ({
            type: "function",
            name: t.name,
            description: t.description,
            parameters: t.schema,
            // strict는 모든 속성을 required로 요구해서 선택 인자(start_line 등)를 못 쓴다. 인자 검증은 서버 도구 쪽에서 한다.
            strict: false,
          }),
        ),
      ];

      for (let turn = 0; ; turn++) {
        const input: OpenAI.Responses.ResponseInputItem[] =
          turn === 0 ? [...pending, { role: "user", content: req.prompt }] : pending;
        const stream = await client.responses.create(
          {
            model,
            input,
            previous_response_id: previous,
            tools,
            ...(folder ? { instructions: folderInstructions(folder) } : {}),
            stream: true,
          },
          { signal },
        );

        const calls: OpenAI.Responses.ResponseFunctionToolCall[] = [];
        let completedId: string | undefined;
        for await (const ev of stream) {
          switch (ev.type) {
            case "response.output_text.delta":
              yield { type: "message.delta", runId, ts: now(), text: ev.delta };
              break;
            case "response.output_item.added":
              if (ev.item.type === "image_generation_call") {
                yield { type: "tool.started", runId, ts: now(), toolCallId: ev.item.id, kind: "other", name: "image_generation", input: {} };
              }
              break;
            case "response.output_item.done": {
              const item = ev.item;
              if (item.type === "message") {
                const text = item.content.map((c) => (c.type === "output_text" ? c.text : "")).join("");
                if (text) yield { type: "message.completed", runId, ts: now(), text };
              } else if (item.type === "reasoning") {
                const text = (item.summary ?? []).map((s) => s.text).join("\n");
                if (text) yield { type: "reasoning", runId, ts: now(), text };
              } else if (item.type === "image_generation_call") {
                yield* this.saveImage(req.sessionId, runId, item);
              } else if (item.type === "function_call") {
                calls.push(item);
                yield {
                  type: "tool.started",
                  runId,
                  ts: now(),
                  toolCallId: item.call_id,
                  kind: toolKindOf(item.name),
                  name: item.name,
                  input: parseArgs(item.arguments),
                };
              }
              break;
            }
            case "response.completed": {
              const u = ev.response.usage;
              // Responses API는 비용을 주지 않는다. 단가표를 유지할 근거가 없어 토큰만 보여준다.
              yield { type: "usage", runId, ts: now(), inputTokens: u?.input_tokens, outputTokens: u?.output_tokens, costUsd: undefined };
              completedId = ev.response.id;
              break;
            }
            case "response.failed":
              yield* finish("error", ev.response.error?.message ?? "응답 생성 실패");
              return;
            case "error":
              yield* finish("error", ev.message);
              return;
          }
        }

        if (!completedId) {
          yield* finish("error", "응답이 완료 이벤트 없이 끝남");
          return;
        }
        // 이 응답이 보낸 입력(첫 턴의 프롬프트, 이후 턴의 도구 결과)을 받아들였으니 여기부터가 새 이어가기 지점이다.
        previous = completedId;
        pending = [];
        if (calls.length === 0) {
          yield* finish("success");
          return;
        }
        if (turn + 1 >= MAX_TOOL_TURNS) {
          pending = calls.map((c) => ({ type: "function_call_output" as const, call_id: c.call_id, output: "도구 사용 상한을 넘어 실행하지 않음" }));
          yield* finish("error", `도구 사용이 ${MAX_TOOL_TURNS}번을 넘어 중단함`);
          return;
        }

        for (const call of calls) {
          const r = await this.opts.tools.execute(req.sessionId, runId, call.call_id, call.name, parseArgs(call.arguments), signal);
          yield { type: "tool.completed", runId, ts: now(), toolCallId: call.call_id, ok: r.ok, output: r.output };
          pending.push({ type: "function_call_output", call_id: call.call_id, output: r.ok ? r.output : `오류: ${r.output}` });
        }
        if (signal.aborted) {
          yield* finish("cancelled");
          return;
        }
      }
    } catch (err) {
      if (signal.aborted) {
        yield* finish("cancelled");
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
      yield* finish("error", message);
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
    yield { type: "tool.completed", runId, ts: Date.now(), toolCallId: item.id, ok: true, output: item.revised_prompt ?? undefined };
    yield { type: "file.changed", runId, ts: Date.now(), path: `files/${name}`, change: "add" };
  }
}

/** 지난 run이 남긴 "못 보낸 도구 결과". 이어갈 응답 ID와 같을 때만 쓴다 (다른 지점의 결과를 섞으면 400) */
function findPendingOutputs(history: HistoryEntry[], responseId: string): OpenAI.Responses.ResponseInputItem[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]!;
    if (e.kind !== "event" || e.event.type !== "raw") continue;
    const p = e.event.payload as { kind?: string; responseId?: string; pending?: OpenAI.Responses.ResponseInputItem[] } | null;
    if (p?.kind === OPENAI_STATE) return p.responseId === responseId ? (p.pending ?? []) : [];
  }
  return [];
}

// 모델이 깨진 JSON을 보낼 수 있다. 예외로 run을 죽이지 않고 빈 인자로 넘겨서 도구 쪽 검증 오류로 돌려준다.
function parseArgs(args: string): Record<string, unknown> {
  try {
    const v = JSON.parse(args) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
