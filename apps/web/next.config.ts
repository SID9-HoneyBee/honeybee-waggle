import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // schema 패키지는 빌드 산출물 없이 TS 소스를 그대로 export한다. Next가 직접 트랜스파일해야 import된다.
  transpilePackages: ["@honeybee-waggle/schema"],
  // 에이전트용 문서는 .claude/docs/에 모으는 규칙이라, next dev가 AGENTS.md를 만들지 않게 한다.
  // 그 안내 내용(Next 문서는 node_modules/next/dist/docs/ 참고)은 .claude/docs/CLAUDE.md로 옮겨뒀다.
  agentRules: false,
  // 기본 위치(왼쪽 아래)는 사이드바의 연결 상태 표시를 가린다.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
