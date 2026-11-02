import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import {
  buildEnv,
  PERMISSION_FLAGS,
  type AdapterCapabilities,
  type AgentEvent,
  type BackendProfile,
  type EngineAdapter,
  type RunRequest,
} from "@honeybee-waggle/schema";
import { ClaudeStreamMapper } from "./ClaudeStreamMapper";
import { stripParentSessionEnv } from "./parentEnv";

interface ClaudeCliAdapterOptions {
  claudeBin: string;
  resolveKey: (ref: string) => string;
}

// 실패 원인은 대부분 stderr 끝부분에 있다. 전부 들고 있으면 장시간 run에서 메모리만 먹는다.
const STDERR_TAIL = 4_000;

/**
 * Claude Code CLI를 run(턴) 하나당 프로세스 하나로 실행한다.
 * 대화 이어가기는 프로세스를 살려두는 대신 --resume <nativeSessionId>로 처리한다.
 * 덕분에 서버가 재시작돼도 nativeSessionId만 있으면 같은 대화를 이어갈 수 있다.
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

  async *run(req: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const mapper = new ClaudeStreamMapper(req.runId, this.profile.auth);
    const completed = (status: "error" | "cancelled" | "timeout", error?: string): AgentEvent => ({
      type: "run.completed",
      runId: req.runId,
      ts: Date.now(),
      status,
      error,
    });

    if (signal.aborted) {
      yield completed("cancelled");
      return;
    }

    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      ...PERMISSION_FLAGS.claude[req.permission],
    ];
    if (this.profile.model) args.push("--model", this.profile.model);
    if (req.resumeNativeId) args.push("--resume", req.resumeNativeId);

    // CLAUDE.md 필수 규칙: spawn env는 반드시 buildEnv 결과만 쓴다.
    const env = buildEnv(this.profile, stripParentSessionEnv(process.env), this.opts.resolveKey);
    const child = spawn(this.opts.claudeBin, args, {
      cwd: req.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stopReason: "cancelled" | "timeout" | undefined;
    let spawnError: Error | undefined;
    let stderrTail = "";

    const exited = new Promise<number | null>((resolve) => {
      child.once("close", (code) => resolve(code));
      // ENOENT 같은 spawn 실패는 close 없이 error만 오는 경우가 있어 둘 다 받는다.
      child.once("error", (err) => {
        spawnError = err;
        resolve(null);
      });
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL);
    });

    const onAbort = () => {
      stopReason ??= "cancelled";
      killTree(child, env);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = req.timeoutMs
      ? setTimeout(() => {
          stopReason ??= "timeout";
          killTree(child, env);
        }, req.timeoutMs)
      : undefined;

    // 프롬프트는 인자가 아니라 stdin으로 넘긴다. Windows 명령줄은 escape 규칙이 까다롭고 길이 제한도 있다.
    // 프로세스가 먼저 죽으면 EPIPE가 나는데, 그 경우의 실패는 exit/stderr 쪽에서 보고되므로 여기선 삼킨다.
    child.stdin?.on("error", () => {});
    child.stdin?.end(req.prompt, "utf8");

    try {
      const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          // stream-json 사이에 경고 문구 같은 일반 텍스트가 섞여 나오는 경우가 있다. 버리지 않고 raw로 남긴다.
          yield { type: "raw", engine: "claude", runId: req.runId, ts: Date.now(), payload: line };
          continue;
        }
        for (const ev of mapper.map(parsed)) yield ev;
      }

      const code = await exited;
      if (!mapper.completed) {
        if (stopReason) yield completed(stopReason);
        else yield completed("error", spawnError?.message || stderrTail.trim() || `claude가 결과 없이 종료됨 (exit ${code})`);
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      // 소비자가 중간에 순회를 끊은 경우에도 프로세스가 남지 않게 한다.
      if (child.exitCode === null && child.signalCode === null) killTree(child, env);
    }
  }
}

/**
 * Windows에서 child.kill()은 claude.exe 하나만 죽이고, 그 아래서 돌던 셸/빌드 프로세스는 고아로 남는다.
 * taskkill /T로 트리째 정리한다. taskkill도 spawn이므로 규칙대로 같은 run의 buildEnv 결과를 그대로 쓴다.
 */
function killTree(child: ChildProcess, env: NodeJS.ProcessEnv): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { env, windowsHide: true, stdio: "ignore" }).on(
      "error",
      () => child.kill(),
    );
  } else {
    child.kill("SIGTERM");
  }
}
