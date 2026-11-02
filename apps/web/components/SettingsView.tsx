"use client";

import { useState } from "react";
import type { KeyProvider, ProfileInfo } from "@honeybee-waggle/schema";
import { useDialog } from "@/lib/dialog";
import { LANGS, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";
import { ModeBadge } from "./ModeBadge";

const PROVIDERS: { provider: KeyProvider; title: MessageKey; placeholder: string }[] = [
  { provider: "anthropic", title: "settings.anthropicKey", placeholder: "sk-ant-..." },
  { provider: "openai", title: "settings.openaiKey", placeholder: "sk-..." },
];

export function SettingsView() {
  const profiles = useWaggle((s) => s.profiles);
  const connected = useWaggle((s) => s.conn === "open");
  const { lang, setLang, t } = useLanguage();

  return (
    <div className="w-full max-w-2xl space-y-10">
      <h1 className="text-xl font-semibold">{t("settings.title")}</h1>

      <section className="space-y-3">
        <h2 className="font-medium">{t("settings.language")}</h2>
        <p className="text-sm text-neutral-500">{t("settings.languageDesc")}</p>
        <div className="flex gap-2">
          {LANGS.map((l) => (
            <button
              key={l.value}
              type="button"
              onClick={() => setLang(l.value)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                lang === l.value
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-medium">{t("settings.apiKeys")}</h2>
        <p className="text-sm text-neutral-500">{t("settings.apiKeysDesc")}</p>
        {PROVIDERS.map((p) => (
          <KeyRow
            key={p.provider}
            provider={p.provider}
            title={t(p.title)}
            placeholder={p.placeholder}
            hint={profiles.find((x) => x.keyProvider === p.provider)?.keyHint}
            disabled={!connected}
          />
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="font-medium">{t("settings.models")}</h2>
        {profiles
          .filter((p) => p.runtime === "chat")
          .map((p) => (
            <ModelRow key={p.id} profile={p} disabled={!connected} />
          ))}
      </section>

      <section className="space-y-4">
        <h2 className="font-medium">{t("settings.budget")}</h2>
        <p className="text-sm text-neutral-500">{t("settings.budgetDesc")}</p>
        {profiles
          .filter((p) => p.costTracked)
          .map((p) => (
            <BudgetRow key={p.id} profile={p} disabled={!connected} />
          ))}
        <p className="text-xs text-neutral-500">{t("settings.budgetNote")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">{t("settings.status")}</h2>
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
          {profiles.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <ModeBadge profileId={p.id} />
              <span className={`flex-1 ${p.available ? "text-emerald-600" : "text-neutral-500"}`}>
                {p.available ? t("settings.available") : p.unavailableReason}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function KeyRow(props: { provider: KeyProvider; title: string; placeholder: string; hint?: string; disabled: boolean }) {
  const client = useWaggleClient();
  const dialog = useDialog();
  const t = useT();
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
        <span className="font-mono text-xs text-neutral-500">
          {props.hint ? t("settings.registered", { hint: props.hint }) : t("settings.notRegistered")}
        </span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          // 저장 요청을 보낸 뒤에는 입력값을 바로 비운다. 화면 상태에 키 원문을 오래 들고 있을 이유가 없다.
          const value = key;
          setKey("");
          void run(() => client.setKey(props.provider, value), t("settings.saved"));
        }}
      >
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={props.hint ? t("settings.replaceKey") : props.placeholder}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 font-mono text-sm dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={props.disabled || busy || !key.trim()}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? t("common.saving") : t("common.save")}
        </button>
        {props.hint && (
          <button
            type="button"
            disabled={props.disabled || busy}
            onClick={async () => {
              const ok = await dialog.confirm({
                title: t("settings.deleteKeyTitle"),
                message: t("settings.deleteKeyMessage"),
                tone: "danger",
                confirmLabel: t("common.delete"),
              });
              if (ok) void run(() => client.deleteKey(props.provider), t("settings.deleted"));
            }}
            className="rounded-md border border-red-400 px-3 py-1.5 text-sm text-red-600 disabled:opacity-40"
          >
            {t("common.delete")}
          </button>
        )}
      </form>
      {message && (
        <p className={`text-xs ${message.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{message.text}</p>
      )}
    </div>
  );
}

function ModelRow({ profile, disabled }: { profile: ProfileInfo; disabled: boolean }) {
  const client = useWaggleClient();
  const t = useT();
  const [error, setError] = useState<string>();
  const options = profile.modelOptions ?? [];

  return (
    <div className="flex items-center gap-3 rounded-md border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      <ModeBadge profileId={profile.id} />
      {options.length > 0 ? (
        <select
          value={profile.model ?? ""}
          disabled={disabled}
          onChange={(e) => {
            setError(undefined);
            client.setModel(profile.id, e.target.value).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
            });
          }}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 font-mono dark:border-neutral-700 dark:bg-neutral-950"
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex-1 text-neutral-500">
          {profile.keyHint ? t("settings.modelsLoading") : t("settings.modelsNeedKey")}
        </span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

function BudgetRow({ profile, disabled }: { profile: ProfileInfo; disabled: boolean }) {
  const client = useWaggleClient();
  const t = useT();
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
          {t("settings.spent", { spent: spent.toFixed(2) })}
          {profile.budgetUsd !== undefined ? ` / $${profile.budgetUsd}` : t("settings.noBudget")}
          {over && t("settings.overBudget")}
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
          placeholder={t("settings.unlimited")}
          className="w-32 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {t("common.save")}
        </button>
      </form>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
