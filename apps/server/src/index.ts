import type { EngineAdapter } from "@honeybee-waggle/schema";
import { ClaudeCliAdapter } from "./adapters/claude-cli/ClaudeCliAdapter";
import { resolveClaudeBin } from "./adapters/claude-cli/resolveClaudeBin";
import { CodexCliAdapter } from "./adapters/codex-cli/CodexCliAdapter";
import { resolveCodexBin } from "./adapters/codex-cli/resolveCodexBin";
import { config } from "./config";
import { KeyStore } from "./profiles/KeyStore";
import { ProfileService } from "./profiles/ProfileService";
import { SessionManager } from "./session/SessionManager";
import { FileSessionStore } from "./store/FileSessionStore";
import { startWsServer } from "./ws/server";

// CLI 경로는 시작 시점에 확정한다. 한쪽 CLI가 없어도 서버는 뜨고, 해당 방식만 "사용 불가"로 표시된다.
const claudeBin = tryResolve(resolveClaudeBin);
const codex = resolveCodexBin();

const profiles = new ProfileService({ dataDir: config.dataDir, keyStore: new KeyStore(), claudeBin, codex });
await profiles.init();

const adapters = new Map<string, EngineAdapter>();
for (const info of profiles.list()) {
  const profile = profiles.get(info.id);
  if (profile.engine === "claude" && claudeBin) {
    adapters.set(profile.id, new ClaudeCliAdapter(profile, { claudeBin, resolveKey: profiles.resolveKey }));
  } else if (profile.engine === "codex" && codex) {
    adapters.set(profile.id, new CodexCliAdapter(profile, { codex, resolveKey: profiles.resolveKey }));
  }
}

const store = new FileSessionStore(config.dataDir);
const manager = new SessionManager(store, adapters, profiles);
await manager.init();

const wss = startWsServer(manager, profiles, config);
wss.on("listening", () => {
  console.log(`[waggle] ws://${config.host}:${config.port}`);
  console.log(`[waggle] claude: ${claudeBin ?? "(없음)"}`);
  console.log(`[waggle] codex:  ${codex ? [codex.command, ...codex.prefixArgs].join(" ") : "(없음)"}`);
  console.log(`[waggle] data:   ${config.dataDir}`);
});

// 종료 시 돌던 CLI 프로세스를 정리하지 않으면 서버가 내려간 뒤에도 백그라운드에서 계속 작업한다.
const shutdown = () => {
  manager.cancelAll();
  wss.close();
  // taskkill이 끝날 시간을 잠깐 준다. 기다리지 않고 바로 나가면 kill 요청 자체가 안 나갈 수 있다.
  setTimeout(() => process.exit(0), 500);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function tryResolve(fn: () => string): string | null {
  try {
    return fn();
  } catch (err) {
    console.warn("[waggle]", err instanceof Error ? err.message : err);
    return null;
  }
}
