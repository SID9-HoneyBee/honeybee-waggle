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
import { CodexStreamMapper } from "./CodexStreamMapper";
import type { CodexCommand } from "./resolveCodexBin";

interface CodexCliAdapterOptions {
  codex: CodexCommand;
  resolveKey: (ref: string) => string;
}

/**
 * Codex CLI를 run 하나당 `codex exec` 프로세스 하나로 실행한다. 이어하기는 `exec resume <thread_id>`.
 * 구독/API 차이는 buildEnv가 지정하는 CODEX_HOME(어느 로그인을 쓸지)에서만 갈린다.
 */
export class CodexCliAdapter implements EngineAdapter {
  readonly capabilities: AdapterCapabilities = {
    tools: true,
    fileEdits: true,
    resume: true,
    partialStreaming: false,
    reportsCost: false,
  };

  constructor(
    readonly profile: BackendProfile,
    private readonly opts: CodexCliAdapterOptions,
  ) {}

  run(req: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    // `exec resume`은 --sandbox를 자체 옵션으로 받지 않는다. exec 쪽 옵션으로 앞에 두면 resume에도 적용된다 (0.164.0 확인).
    // 사용자가 고른 cwd가 git 저장소가 아닐 수 있어서 저장소 검사는 끈다.
    const args = [
      ...this.opts.codex.prefixArgs,
      "exec",
      "--json",
      "--skip-git-repo-check",
      ...PERMISSION_FLAGS.codex[req.permission],
    ];
    if (this.profile.model) args.push("-m", this.profile.model);
    // 프롬프트는 "-"로 stdin에서 읽게 한다.
    if (req.resumeNativeId) args.push("resume", req.resumeNativeId, "-");
    else args.push("-");

    const mapper = new CodexStreamMapper(req.runId, this.profile.auth, this.profile.model);
    return runCliProcess(
      {
        engine: "codex",
        command: this.opts.codex.command,
        args,
        // CLAUDE.md 필수 규칙: spawn env는 반드시 buildEnv 결과만 쓴다.
        env: buildEnv(this.profile, stripParentSessionEnv(process.env), this.opts.resolveKey),
        mapper,
      },
      req,
      signal,
    );
  }
}
