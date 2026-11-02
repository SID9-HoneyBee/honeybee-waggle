"use client";

import { useEffect, useState } from "react";
import type { AttachedRef } from "@honeybee-waggle/schema";
import { useT } from "@/lib/i18n";
import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";
import { approxTokens } from "@/lib/format";
import { ModeBadge } from "./ModeBadge";

interface Props {
  currentSessionId: string;
  attachedIds: string[];
  onAttach: (ref: AttachedRef) => void;
  onClose: () => void;
}

/**
 * 다른 세션을 골라 정리본을 미리 보고 첨부한다.
 * 미리보기는 서버가 실제 전송 때와 같은 함수로 만든 텍스트라, 여기서 본 그대로 모델에 간다.
 */
export function RefPicker({ currentSessionId, attachedIds, onAttach, onClose }: Props) {
  const client = useWaggleClient();
  const t = useT();
  const sessions = useWaggle((s) => s.sessions.filter((x) => x.id !== currentSessionId && !attachedIds.includes(x.id)));
  const [selectedId, setSelectedId] = useState<string>();
  const [includeTools, setIncludeTools] = useState(false);
  const [preview, setPreview] = useState<{ text: string; chars: number }>();
  const [error, setError] = useState<string>();
  const selected = sessions.find((s) => s.id === selectedId);

  useEffect(() => {
    if (!selectedId) return;
    // 세션이나 옵션을 빠르게 바꾸면 늦게 온 이전 응답이 새 미리보기를 덮을 수 있어서 버린다.
    let stale = false;
    setPreview(undefined);
    setError(undefined);
    client
      .transcript(selectedId, includeTools)
      .then((p) => !stale && setPreview(p))
      .catch((err: unknown) => !stale && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      stale = true;
    };
  }, [client, selectedId, includeTools]);

  return (
    <div className="mx-auto mb-2 max-w-3xl rounded-md border border-neutral-300 bg-white p-3 text-sm shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{t("ref.title")}</span>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label={t("common.close")}>
          ✕
        </button>
      </div>

      {sessions.length === 0 ? (
        <p className="text-neutral-500">{t("ref.none")}</p>
      ) : (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setSelectedId(s.id)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${
                  s.id === selectedId ? "bg-neutral-200 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{s.title || t("common.untitled")}</span>
                <ModeBadge profileId={s.profileId} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeTools} onChange={(e) => setIncludeTools(e.target.checked)} />
            <span>
              {t("ref.includeTools")} <span className="text-neutral-500">{t("ref.includeToolsHint")}</span>
            </span>
          </label>
          {error && <p className="text-red-600">{error}</p>}
          {!preview && !error && <p className="text-neutral-500">{t("ref.building")}</p>}
          {preview && (
            <>
              <p className="text-neutral-500">
                {t("ref.size", {
                  chars: preview.chars.toLocaleString(),
                  tokens: approxTokens(preview.chars).toLocaleString(),
                })}
              </p>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-950">
                {preview.text}
              </pre>
              <button
                onClick={() =>
                  onAttach({
                    sessionId: selected.id,
                    includeTools,
                    title: selected.title,
                    profileId: selected.profileId,
                    chars: preview.chars,
                  })
                }
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                {t("ref.attach")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
