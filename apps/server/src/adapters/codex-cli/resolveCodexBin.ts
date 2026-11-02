import { existsSync } from "node:fs";
import path from "node:path";

export interface CodexCommand {
  command: string;
  /** 실제 codex 인자 앞에 붙일 인자 (Windows에선 codex.js 경로) */
  prefixArgs: string[];
}

/**
 * Windows의 `codex.cmd`는 claude와 달리 exe가 아니라 `node codex.js`를 부르는 shim이다.
 * .cmd를 shell 없이 spawn할 수 없으므로(CVE-2024-27980 패치) 같은 일을 직접 한다:
 * 현재 node로 codex.js를 실행하면 codex.js가 플랫폼별 네이티브 바이너리를 찾아 띄운다.
 * 못 찾으면 null — 서버는 뜨되 GPT 방식만 비활성화된다.
 */
export function resolveCodexBin(): CodexCommand | null {
  if (process.env.CODEX_BIN) return { command: process.env.CODEX_BIN, prefixArgs: [] };
  if (process.platform !== "win32") return { command: "codex", prefixArgs: [] };

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const exe = path.join(dir, "codex.exe");
    if (existsSync(exe)) return { command: exe, prefixArgs: [] };
    if (existsSync(path.join(dir, "codex.cmd"))) {
      const js = path.join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
      if (existsSync(js)) return { command: process.execPath, prefixArgs: [js] };
    }
  }
  return null;
}
