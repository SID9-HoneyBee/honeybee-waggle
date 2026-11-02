"use client";

import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";

export function NoticeBanner() {
  const client = useWaggleClient();
  const notice = useWaggle((s) => s.notice);
  if (!notice) return null;
  return (
    <div className="absolute inset-x-4 top-3 z-10 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      <span className="flex-1">{notice.message}</span>
      <button className="opacity-70 hover:opacity-100" onClick={() => client.dismissNotice()} aria-label="닫기">
        ✕
      </button>
    </div>
  );
}
