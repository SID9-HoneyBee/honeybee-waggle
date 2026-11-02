export function formatRelative(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return "방금";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return new Date(ts).toLocaleDateString("ko-KR");
}

export function formatTokens(n: number | undefined): string {
  if (n === undefined) return "-";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
