import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

// 인증이 없으므로 로컬 주소에서 열린 웹만 접속을 허용한다. 인증을 갖춘 원격 접속이 들어오기 전까지 이 목록을 넓히면 안 된다.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const config = {
  // 원격 접속은 인증이 생기기 전까지 지원하지 않는다. 바인딩 주소는 환경변수로도 바꿀 수 없게 고정한다.
  host: "127.0.0.1",
  port: Number(process.env.WAGGLE_PORT ?? 4317),
  dataDir: process.env.WAGGLE_DATA_DIR ?? path.join(repoRoot, ".data"),
  // localhost 바인딩만으로는 부족하다. 브라우저는 아무 사이트에서나 ws://127.0.0.1 로 붙을 수 있어서,
  // Origin을 막지 않으면 방문한 외부 페이지가 내 PC에서 에이전트를 실행시킬 수 있다.
  allowedOrigins: parseLocalOrigins(process.env.WAGGLE_WEB_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000"),
};

/**
 * 터널(ngrok, Tailscale Funnel 등)로 웹을 열면 브라우저 Origin이 터널 도메인이 된다.
 * 그 도메인을 허용 목록에 넣는 것만으로 인증 없는 원격 접속이 열리므로, 로컬이 아닌 주소가 있으면 시작 자체를 거부한다.
 * 포트만 다른 로컬 주소(예: http://127.0.0.1:3100)는 허용한다.
 */
function parseLocalOrigins(raw: string): string[] {
  const origins = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const origin of origins) {
    let host: string;
    try {
      host = new URL(origin).hostname;
    } catch {
      throw new Error(`WAGGLE_WEB_ORIGINS에 잘못된 주소가 있음: ${origin}`);
    }
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(
        `WAGGLE_WEB_ORIGINS에는 로컬 주소만 넣을 수 있음: ${origin}\n` +
          "waggle은 인증이 없어 외부에 노출하면 누구나 이 PC에서 에이전트를 실행할 수 있다. 원격 접속은 지원하지 않는다.",
      );
    }
  }
  return origins;
}
