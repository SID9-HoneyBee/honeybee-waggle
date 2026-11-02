import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { KeyProvider } from "@honeybee-waggle/schema";

/**
 * 키로 실제 사용 가능한 모델 목록을 받아온다. 키 등록 시 유효성 검사도 겸한다(잘못된 키면 401).
 * 모델 이름을 코드에 박아두면 계정마다 열린 모델이 달라 400이 나기 쉬워서, 목록에서 고르게 한다.
 */
export async function listModels(provider: KeyProvider, apiKey: string): Promise<string[]> {
  const ids: string[] = [];
  if (provider === "anthropic") {
    for await (const m of new Anthropic({ apiKey }).models.list()) ids.push(m.id);
    return ids;
  }
  for await (const m of new OpenAI({ apiKey }).models.list()) ids.push(m.id);
  // OpenAI 목록에는 임베딩·음성·이미지 전용 모델이 섞여 있다. 대화(Responses API)에 쓸 gpt 계열만 남긴다.
  return ids
    .filter((id) => id.startsWith("gpt-") && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(id))
    .sort()
    .reverse();
}

// claude-opus-5-5는 claude-api 스킬이 지정한 기본 모델. OpenAI는 계정 목록에 있는 것 중 앞쪽 후보를 쓴다.
const PREFERRED: Record<KeyProvider, string[]> = {
  anthropic: ["claude-opus-5-5"],
  openai: ["gpt-6.1-sol", "gpt-6-sol", "gpt-5.5"],
};

export function defaultModel(provider: KeyProvider, available: string[]): string | undefined {
  return PREFERRED[provider].find((m) => available.includes(m)) ?? available[0];
}

/**
 * 정가 기준 비용 계산용 단가 (USD / 100만 토큰, claude-api 스킬 2026-10-06 기준).
 * Anthropic API는 응답에 비용을 주지 않아서 토큰 수로 계산한다. 할인·크레딧은 반영되지 않는다.
 */
const ANTHROPIC_PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-fable-5-1": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
};

/**
 * 표에 없는 모델(서버 측 fallback으로 바뀐 경우, 새 모델 등)은 비용을 비우지 않고 Opus 계열 최고 단가로 넉넉하게 잡는다.
 * 비우면 누적 비용이 실제보다 적게 잡혀 예산 상한이 늦게 걸린다. 많이 잡히는 쪽이 예산 용도에선 안전하다.
 */
const UNKNOWN_MODEL_PRICE = ANTHROPIC_PRICES["claude-opus-4-8"]!;

export function anthropicCost(
  model: string,
  u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null },
): number {
  const p = ANTHROPIC_PRICES[model] ?? UNKNOWN_MODEL_PRICE;
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1_000_000
  );
}
