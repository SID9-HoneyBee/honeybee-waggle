import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

export const config = {
  // 원격 접속은 1단계 범위 밖이라 바인딩 주소는 환경변수로도 바꿀 수 없게 고정한다.
  host: "127.0.0.1",
  port: Number(process.env.WAGGLE_PORT ?? 4317),
  dataDir: process.env.WAGGLE_DATA_DIR ?? path.join(repoRoot, ".data"),
  // localhost 바인딩만으로는 부족하다. 브라우저는 아무 사이트에서나 ws://127.0.0.1 로 붙을 수 있어서,
  // Origin을 막지 않으면 방문한 외부 페이지가 내 PC에서 에이전트를 실행시킬 수 있다.
  allowedOrigins: (process.env.WAGGLE_WEB_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((s) => s.trim()),
};
