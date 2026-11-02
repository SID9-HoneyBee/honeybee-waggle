import {
  buildEnv,
  PERMISSION_FLAGS,
  type AdapterCapabilities,
  type AgentEvent,
  type BackendProfile,
  type EngineAdapter,
  type RunRequest,
} from "@honeybee-waggle/schema";
import { stripParentSessionEnv } from "../../env/parentEnv";
import { runCliProcess } from "../cliProcess";
import { ClaudeStreamMapper } from "./ClaudeStreamMapper";

interface ClaudeCliAdapterOptions {
  claudeBin: string;
  resolveKey: (ref: string) => string;
}

/**
 * Claude Code CLI를 run(턴) 하나당 프로세스 하나로 실행한다.
 * 대화 이어가기는 프로세스를 살려두는 대신 --resume <nativeSessionId>로 처리한다.
 * 덕분에 서버가 재시작돼도 nativeSessionId만 있으면 같은 대화를 이어갈 수 있다.
 * 구독/API 차이는 이 클래스가 아니라 profile → buildEnv(키 주입 여부)에서 갈린다.
 */
export class ClaudeCliAdapter implements EngineAdapter {
  readonly capabilities: AdapterCapabilities;

  constructor(
    readonly profile: BackendProfile,
    private readonly opts: ClaudeCliAdapterOptions,
  ) {
    this.capabilities = {
      tools: true,
      fileEdits: true,
      resume: true,
      partialStreaming: true,
      reportsCost: profile.auth === "api",
    };
  }

  run(req: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      ...PERMISSION_FLAGS.claude[req.permission],
    ];
    if (this.profile.model) args.push("--model", this.profile.model);
    if (req.resumeNativeId) args.push("--resume", req.resumeNativeId);

    return runCliProcess(
      {
        engine: "claude",
        command: this.opts.claudeBin,
        args,
        // CLAUDE.md 필수 규칙: spawn env는 반드시 buildEnv 결과만 쓴다.
        env: buildEnv(this.profile, stripParentSessionEnv(process.env), this.opts.resolveKey),
        mapper: new ClaudeStreamMapper(req.runId, this.profile.auth),
      },
      req,
      signal,
    );
  }
}
