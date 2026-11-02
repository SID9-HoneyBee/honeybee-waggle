import type { BackendProfile } from "@honeybee-waggle/schema";

// 1단계는 구독 CLI 프로필 하나만 쓴다. 프로필 선택 UI/저장은 API 런타임이 들어올 때 같이 만든다.
export const CLAUDE_SUB: BackendProfile = {
  id: "claude-sub",
  engine: "claude",
  auth: "subscription",
  runtime: "agent",
};

// 구독 프로필만 있으니 실제로 불릴 일이 없어야 한다. 불렸다면 프로필 설정이 잘못된 것이라 조용히 넘기지 않는다.
export function resolveKey(ref: string): string {
  throw new Error(`API 키 저장소가 아직 없음 (요청된 ref: ${ref}). 1단계는 구독 프로필만 지원.`);
}
