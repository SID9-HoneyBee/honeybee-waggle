import type { BackendProfile, KeyProvider } from "@honeybee-waggle/schema";

export interface ProfileDef {
  profile: BackendProfile;
  label: string;
  keyProvider?: KeyProvider;
}

/**
 * 프로필은 사용자가 만들지 않고 4종을 내장으로 고정한다.
 * - 구독 2종: CLI 에이전트 (파일·셸 도구 사용, 작업 폴더 필요)
 * - API 2종: SDK로 직접 대화 (도구 없음, 작업 폴더 불필요). 스키마의 runtime "chat"
 * 프로필을 자유롭게 만들게 하면 configDir 같은 env 관련 값까지 화면에서 받게 된다.
 * apiKeyRef에는 키 원문이 아니라 KeyStore의 provider 이름이 들어간다.
 * model은 여기 두지 않는다. 설정 화면에서 고르고 ProfileService.get이 채워 넣는다.
 */
export function builtinProfiles(): ProfileDef[] {
  return [
    {
      label: "Claude 구독",
      profile: { id: "claude-sub", engine: "claude", auth: "subscription", runtime: "agent" },
    },
    {
      label: "GPT 구독",
      // configDir 없음 = 사용자가 평소 쓰는 ~/.codex 로그인을 그대로 쓴다.
      profile: { id: "codex-sub", engine: "codex", auth: "subscription", runtime: "agent" },
    },
    {
      label: "Claude API",
      keyProvider: "anthropic",
      profile: { id: "claude-api", engine: "claude", auth: "api", runtime: "chat", apiKeyRef: "anthropic" },
    },
    {
      label: "GPT API",
      keyProvider: "openai",
      profile: { id: "codex-api", engine: "codex", auth: "api", runtime: "chat", apiKeyRef: "openai" },
    },
  ];
}
