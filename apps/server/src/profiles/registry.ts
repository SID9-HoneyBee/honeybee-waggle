import path from "node:path";
import type { BackendProfile, KeyProvider } from "@honeybee-waggle/schema";

export interface ProfileDef {
  profile: BackendProfile;
  label: string;
  keyProvider?: KeyProvider;
}

/**
 * 프로필은 사용자가 만들지 않고 4종을 내장으로 고정한다.
 * 방식 선택만 필요하고, 프로필을 자유롭게 만들게 하면 configDir 같은 env 관련 값까지 화면에서 받게 된다.
 * apiKeyRef에는 키 원문이 아니라 KeyStore의 provider 이름이 들어간다.
 */
export function builtinProfiles(dataDir: string): ProfileDef[] {
  return [
    {
      label: "Claude 구독",
      profile: { id: "claude-sub", engine: "claude", auth: "subscription", runtime: "agent" },
    },
    {
      label: "Claude API",
      keyProvider: "anthropic",
      profile: { id: "claude-api", engine: "claude", auth: "api", runtime: "agent", apiKeyRef: "anthropic" },
    },
    {
      label: "GPT 구독",
      // configDir 없음 = 사용자가 평소 쓰는 ~/.codex 로그인을 그대로 쓴다.
      profile: { id: "codex-sub", engine: "codex", auth: "subscription", runtime: "agent" },
    },
    {
      label: "GPT API",
      keyProvider: "openai",
      profile: {
        id: "codex-api",
        engine: "codex",
        auth: "api",
        runtime: "agent",
        apiKeyRef: "openai",
        // 구독 로그인(~/.codex)과 섞이지 않게 API 전용 CODEX_HOME을 따로 둔다. 키 등록 시 여기에 로그인한다.
        configDir: path.join(dataDir, "codex-home", "api"),
      },
    },
  ];
}
