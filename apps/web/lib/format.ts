import type { Lang, Translate } from "./i18n";

export function formatRelative(ts: number, t: Translate, lang: Lang): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return t("time.justNow");
  const min = Math.round(sec / 60);
  if (min < 60) return t("time.minutes", { n: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t("time.hours", { n: hr });
  return new Date(ts).toLocaleDateString(lang === "ko" ? "ko-KR" : "en-US");
}

export function formatTokens(n: number | undefined): string {
  if (n === undefined) return "-";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// 토큰 수는 모델·언어마다 달라서 정확히 알 수 없다. 한글이 섞인 텍스트 기준 대략치로, 크기 감만 주는 용도.
export function approxTokens(chars: number): number {
  return Math.ceil(chars / 2.5);
}
