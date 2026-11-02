"use client";

import { useWaggle } from "@/lib/WaggleProvider";

// 엔진은 색으로, 구독/API는 채움 여부로 구분한다. API는 실제 돈이 나가므로 눈에 더 띄게 채운다.
const STYLE: Record<string, string> = {
  "claude-sub": "border-orange-400 text-orange-700 dark:text-orange-300",
  "claude-api": "border-orange-500 bg-orange-500 text-white",
  "codex-sub": "border-teal-500 text-teal-700 dark:text-teal-300",
  "codex-api": "border-teal-600 bg-teal-600 text-white",
};

export function ModeBadge({ profileId }: { profileId: string }) {
  const label = useWaggle((s) => s.profiles.find((p) => p.id === profileId)?.label);
  return (
    <span
      className={`inline-block shrink-0 rounded border px-1.5 py-px text-[10px] font-medium leading-4 ${
        STYLE[profileId] ?? "border-neutral-400 text-neutral-500"
      }`}
    >
      {label ?? profileId}
    </span>
  );
}
