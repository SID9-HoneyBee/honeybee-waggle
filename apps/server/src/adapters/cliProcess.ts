import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import type { AgentEvent, Engine, RunRequest } from "@honeybee-waggle/schema";

/** CLI 한 줄(JSON) → 정규화 이벤트. run 하나당 인스턴스 하나 */
export interface LineMapper {
  map(raw: unknown): AgentEvent[];
  /** 완료 이벤트(run.completed)를 이미 냈는지. 못 냈으면 프로세스 종료 후 대신 만든다 */
  readonly completed: boolean;
  /** 비정상 종료 시 stderr보다 우선해서 쓸 원인. stderr에 잡음이 많은 CLI(codex)용 */
  failureHint?(): string | undefined;
}

export interface CliRunSpec {
  engine: Engine;
  command: string;
  args: string[];
  /** 반드시 buildEnv 결과 (CLAUDE.md 필수 규칙) */
  env: NodeJS.ProcessEnv;
  mapper: LineMapper;
}

// 실패 원인은 대부분 stderr 끝부분에 있다. 전부 들고 있으면 장시간 run에서 메모리만 먹는다.
const STDERR_TAIL = 4_000;

/**
 * JSONL을 stdout으로 내보내는 에이전트 CLI를 run 하나 동안 실행한다.
 * 취소·타임아웃·spawn 실패·결과 없는 종료를 모두 run.completed 하나로 수렴시키는 게 이 함수의 책임이다.
 * 엔진별 차이(인자, 출력 매핑)는 호출하는 어댑터와 mapper에 둔다.
 */
export async function* runCliProcess(
  spec: CliRunSpec,
  req: RunRequest,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
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

  const child = spawn(spec.command, spec.args, {
    cwd: req.cwd,
    env: spec.env,
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
    killTree(child, spec.env);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = req.timeoutMs
    ? setTimeout(() => {
        stopReason ??= "timeout";
        killTree(child, spec.env);
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
        // JSONL 사이에 경고 문구 같은 일반 텍스트가 섞여 나오는 경우가 있다. 버리지 않고 raw로 남긴다.
        yield { type: "raw", engine: spec.engine, runId: req.runId, ts: Date.now(), payload: line };
        continue;
      }
      for (const ev of spec.mapper.map(parsed)) yield ev;
    }

    const code = await exited;
    if (!spec.mapper.completed) {
      if (stopReason) yield completed(stopReason);
      else yield completed("error", spawnError?.message || spec.mapper.failureHint?.() || stderrTail.trim() || `CLI가 결과 없이 종료됨 (exit ${code})`);
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    // 소비자가 중간에 순회를 끊은 경우에도 프로세스가 남지 않게 한다.
    if (child.exitCode === null && child.signalCode === null) killTree(child, spec.env);
  }
}

/**
 * Windows에서 child.kill()은 CLI 프로세스 하나만 죽이고, 그 아래서 돌던 셸/빌드 프로세스는 고아로 남는다.
 * (codex는 node → 네이티브 바이너리로 한 단계 더 깊다.) taskkill /T로 트리째 정리한다.
 * taskkill도 spawn이므로 규칙대로 같은 run의 buildEnv 결과를 그대로 쓴다.
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
