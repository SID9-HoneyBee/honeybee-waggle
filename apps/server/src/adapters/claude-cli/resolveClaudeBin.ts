import { existsSync } from "node:fs";
import path from "node:path";

/**
 * spawn할 claude 실행 파일 경로를 찾는다.
 *
 * Windows에서 npm 전역 설치된 `claude`는 `claude.cmd` shim이다. Node는 보안 패치(CVE-2024-27980) 이후
 * .cmd를 shell 없이 spawn하면 EINVAL을 내고, shell:true는 프롬프트/인자 escape 문제가 생긴다.
 * shim이 실제로는 node_modules 안의 claude.exe를 호출하므로 그 exe를 직접 찾아서 쓴다.
 * shim 구조가 바뀌어 못 찾으면 CLAUDE_BIN으로 직접 지정하게 한다.
 */
export function resolveClaudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform !== "win32") return "claude";

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const exe = path.join(dir, "claude.exe");
    if (existsSync(exe)) return exe;
    if (existsSync(path.join(dir, "claude.cmd"))) {
      const shimTarget = path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
      if (existsSync(shimTarget)) return shimTarget;
    }
  }
  throw new Error("claude 실행 파일을 찾지 못함. CLAUDE_BIN 환경변수로 claude.exe 경로를 지정해줘.");
}
