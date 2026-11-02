"use client";

import { useState } from "react";
import type { KeyProvider, ProfileInfo } from "@honeybee-waggle/schema";
import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";
import { ModeBadge } from "./ModeBadge";

const PROVIDERS: { provider: KeyProvider; title: string; placeholder: string; note?: string }[] = [
  { provider: "anthropic", title: "Anthropic API 키 (Claude API)", placeholder: "sk-ant-..." },
  {
    provider: "openai",
    title: "OpenAI API 키 (GPT API)",
    placeholder: "sk-...",
    note: "저장하면 전용 폴더에 codex 로그인까지 진행해서 몇 초 걸릴 수 있어.",
  },
];

export function SettingsView() {
  const profiles = useWaggle((s) => s.profiles);
  const connected = useWaggle((s) => s.conn === "open");

  return (
    <div className="w-full max-w-2xl space-y-10">
      <h1 className="text-xl font-semibold">설정</h1>

      <section className="space-y-4">
        <h2 className="font-medium">API 키</h2>
        <p className="text-sm text-neutral-500">
          키는 이 PC의 Windows 자격 증명 관리자에만 저장되고, 화면에는 끝 4자리만 다시 보여.
        </p>
        {PROVIDERS.map((p) => (
          <KeyRow
            key={p.provider}
            {...p}
            hint={profiles.find((x) => x.keyProvider === p.provider)?.keyHint}
            disabled={!connected}
          />
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="font-medium">월 예산</h2>
        <p className="text-sm text-neutral-500">
          이번 달 누적 비용이 예산에 닿으면 새 실행을 막아. 비워두면 제한 없이 표시만 해. 실행 중인 작업은 끝까지 가니까
          약간 넘을 수 있어.
        </p>
        {profiles
          .filter((p) => p.costTracked)
          .map((p) => (
            <BudgetRow key={p.id} profile={p} disabled={!connected} />
          ))}
        <p className="text-xs text-neutral-500">
          GPT API는 codex CLI가 비용을 알려주지 않아서 토큰 수만 보여주고 예산을 걸 수 없어. OpenAI 대시보드의 사용 한도를
          같이 걸어두는 걸 추천해.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">실행 방식 상태</h2>
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
          {profiles.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <ModeBadge profileId={p.id} />
              <span className={`flex-1 ${p.available ? "text-emerald-600" : "text-neutral-500"}`}>
                {p.available ? "사용 가능" : p.unavailableReason}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function KeyRow(props: {
  provider: KeyProvider;
  title: string;
  placeholder: string;
  note?: string;
  hint?: string;
  disabled: boolean;
}) {
  const client = useWaggleClient();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
      setMessage({ ok: true, text: done });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{props.title}</span>
        <span className="font-mono text-xs text-neutral-500">{props.hint ? `등록됨 ${props.hint}` : "미등록"}</span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          // 저장 요청을 보낸 뒤에는 입력값을 바로 비운다. 화면 상태에 키 원문을 오래 들고 있을 이유가 없다.
          const value = key;
          setKey("");
          void run(() => client.setKey(props.provider, value), "저장했어.");
        }}
      >
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={props.hint ? "새 키로 교체" : props.placeholder}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 font-mono text-sm dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={props.disabled || busy || !key.trim()}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? "저장 중…" : "저장"}
        </button>
        {props.hint && (
          <button
            type="button"
            disabled={props.disabled || busy}
            onClick={() => {
              if (confirm("이 키를 삭제할까? 이 방식으로 만든 세션은 키를 다시 등록할 때까지 실행할 수 없어.")) {
                void run(() => client.deleteKey(props.provider), "삭제했어.");
              }
            }}
            className="rounded-md border border-red-400 px-3 py-1.5 text-sm text-red-600 disabled:opacity-40"
          >
            삭제
          </button>
        )}
      </form>
      {props.note && <p className="text-xs text-neutral-500">{props.note}</p>}
      {message && (
        <p className={`text-xs ${message.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{message.text}</p>
      )}
    </div>
  );
}

function BudgetRow({ profile, disabled }: { profile: ProfileInfo; disabled: boolean }) {
  const client = useWaggleClient();
  const [value, setValue] = useState(profile.budgetUsd?.toString() ?? "");
  const [error, setError] = useState<string>();
  const spent = profile.spentUsd ?? 0;
  const over = profile.budgetUsd !== undefined && spent >= profile.budgetUsd;

  async function save(budget: number | null) {
    setError(undefined);
    try {
      await client.setBudget(profile.id, budget);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center gap-3">
        <ModeBadge profileId={profile.id} />
        <span className={`flex-1 text-sm ${over ? "text-red-600" : "text-neutral-600 dark:text-neutral-400"}`}>
          이번 달 ${spent.toFixed(2)}
          {profile.budgetUsd !== undefined ? ` / $${profile.budgetUsd}` : " (예산 없음)"}
          {over && " · 예산 초과로 실행 차단 중"}
        </span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save(value.trim() === "" ? null : Number(value));
        }}
      >
        <span className="self-center text-sm">$</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="제한 없음"
          className="w-32 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          저장
        </button>
      </form>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
