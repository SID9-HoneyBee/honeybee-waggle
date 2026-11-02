import type { EngineAdapter } from "@honeybee-waggle/schema";
import { AnthropicChatAdapter } from "./adapters/chat/AnthropicChatAdapter";
import { OpenAIChatAdapter } from "./adapters/chat/OpenAIChatAdapter";
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

const store = new FileSessionStore(config.dataDir);
const { resolveKey } = profiles;

const adapters = new Map<string, EngineAdapter>();
if (claudeBin) adapters.set("claude-sub", new ClaudeCliAdapter(profiles.get("claude-sub"), { claudeBin, resolveKey }));
if (codex) adapters.set("codex-sub", new CodexCliAdapter(profiles.get("codex-sub"), { codex, resolveKey }));
adapters.set(
  "claude-api",
  new AnthropicChatAdapter({
    getProfile: () => profiles.get("claude-api"),
    resolveKey,
    loadHistory: (id) => store.readHistory(id),
  }),
);
adapters.set(
  "codex-api",
  new OpenAIChatAdapter({
    getProfile: () => profiles.get("codex-api"),
    resolveKey,
    filesDir: (id) => store.filesDir(id),
  }),
);

const manager = new SessionManager(store, adapters, profiles);
await manager.init();

const wss = startWsServer(manager, profiles, { ...config, filesDir: (id) => store.filesDir(id) });
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
