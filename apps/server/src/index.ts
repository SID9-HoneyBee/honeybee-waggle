import { ClaudeCliAdapter } from "./adapters/claude-cli/ClaudeCliAdapter";
import { resolveClaudeBin } from "./adapters/claude-cli/resolveClaudeBin";
import { config } from "./config";
import { CLAUDE_SUB, resolveKey } from "./profiles";
import { SessionManager } from "./session/SessionManager";
import { FileSessionStore } from "./store/FileSessionStore";
import { startWsServer } from "./ws/server";

// claude 경로는 시작 시점에 확정한다. 첫 메시지를 보낼 때 가서야 못 찾았다고 알리면 원인 파악이 늦어진다.
const claudeBin = resolveClaudeBin();
const store = new FileSessionStore(config.dataDir);
const adapter = new ClaudeCliAdapter(CLAUDE_SUB, { claudeBin, resolveKey });
const manager = new SessionManager(store, adapter);
await manager.init();

const wss = startWsServer(manager, config);
wss.on("listening", () => {
  console.log(`[waggle] ws://${config.host}:${config.port}`);
  console.log(`[waggle] claude: ${claudeBin}`);
  console.log(`[waggle] data:   ${config.dataDir}`);
});

// 종료 시 돌던 claude 프로세스를 정리하지 않으면 서버가 내려간 뒤에도 백그라운드에서 계속 작업한다.
const shutdown = () => {
  manager.cancelAll();
  wss.close();
  // taskkill이 끝날 시간을 잠깐 준다. 기다리지 않고 바로 나가면 kill 요청 자체가 안 나갈 수 있다.
  setTimeout(() => process.exit(0), 500);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
