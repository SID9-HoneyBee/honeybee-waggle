"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PermissionLevel } from "@honeybee-waggle/schema";
import { useT } from "@/lib/i18n";
import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";
import { ModeBadge } from "./ModeBadge";

const LAST_CWD_KEY = "waggle:lastCwd";
const LAST_PROFILE_KEY = "waggle:lastProfile";

// 같은 권한 단계라도 엔진마다 실제 플래그가 다르다(스키마 PERMISSION_FLAGS). 설명에 둘 다 적어둬야 고를 때 헷갈리지 않는다.
const PERMISSIONS = [
  { value: "read-only", label: "perm.read-only", desc: "perm.read-only.desc" },
  { value: "workspace-write", label: "perm.workspace-write", desc: "perm.workspace-write.desc" },
  { value: "full", label: "perm.full", desc: "perm.full.desc" },
] as const satisfies readonly { value: PermissionLevel; label: string; desc: string }[];

// 서버가 보내는 사용 불가 사유는 한국어 고정이다. 키 미등록 안내 링크를 띄울지는 이 원문으로 판단한다.
const NO_KEY_REASON = "API 키 미등록";

export function NewSessionForm() {
  const client = useWaggleClient();
  const router = useRouter();
  const t = useT();
  const connected = useWaggle((s) => s.conn === "open");
  const profiles = useWaggle((s) => s.profiles);
  const [profileId, setProfileId] = useState("claude-sub");
  const [title, setTitle] = useState("");
  const [cwd, setCwd] = useState("");
  const [permission, setPermission] = useState<PermissionLevel>("workspace-write");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // 같은 프로젝트에서 세션을 여러 개 여는 경우가 대부분이라 마지막 작업 폴더를 기본값으로 채운다.
  // 시크릿 창 등에서 localStorage 접근이 막혀도 폼은 동작해야 한다.
  useEffect(() => {
    try {
      setCwd(localStorage.getItem(LAST_CWD_KEY) ?? "");
      setProfileId(localStorage.getItem(LAST_PROFILE_KEY) ?? "claude-sub");
    } catch {}
  }, []);

  // 저장해둔 방식이 지금은 쓸 수 없을 수 있다(키 삭제 등). 그대로 두면 버튼만 막혀서 이유를 알기 어렵다.
  const selected = profiles.find((p) => p.id === profileId);
  const usable = selected?.available ?? false;
  // API 대화는 파일에 손대지 않는다. 작업 폴더·권한을 받으면 의미 없는 입력을 강요하는 셈이라 숨긴다.
  const isChat = selected?.runtime === "chat";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const session = await client.createSession({ title: title || undefined, cwd, permission, profileId });
      try {
        localStorage.setItem(LAST_CWD_KEY, cwd);
        localStorage.setItem(LAST_PROFILE_KEY, profileId);
      } catch {}
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xl space-y-5">
      <h1 className="text-xl font-semibold">{t("new.title")}</h1>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t("new.mode")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {profiles.map((p) => (
            <label
              key={p.id}
              className={`flex gap-2 rounded-md border px-3 py-2 text-sm ${
                p.available ? "cursor-pointer" : "cursor-not-allowed opacity-50"
              } ${profileId === p.id ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-300 dark:border-neutral-700"}`}
            >
              <input
                type="radio"
                name="profile"
                disabled={!p.available}
                checked={profileId === p.id}
                onChange={() => setProfileId(p.id)}
                className="mt-1"
              />
              <span className="min-w-0 space-y-0.5">
                <ModeBadge profileId={p.id} />
                <span className="block text-xs text-neutral-500">
                  {p.available
                    ? p.runtime === "chat"
                      ? t("new.chatDesc", { model: p.model ?? "" })
                      : t("new.agentDesc")
                    : p.unavailableReason}
                </span>
              </span>
            </label>
          ))}
        </div>
        {profiles.some((p) => p.unavailableReason === NO_KEY_REASON) && (
          <p className="text-xs text-neutral-500">
            {t("new.keyHintBefore")}
            <Link href="/settings" className="underline">
              {t("new.keyHintLink")}
            </Link>
            {t("new.keyHintAfter")}
          </p>
        )}
      </fieldset>

      {!isChat && (
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("new.cwd")}</span>
          <input
            required
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="C:\Projects\my-app"
            className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-neutral-700"
          />
        </label>
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium">
          {t("new.titleLabel")} <span className="font-normal text-neutral-500">{t("new.titleHint")}</span>
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        />
      </label>

      {!isChat && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t("new.permission")}</legend>
          {PERMISSIONS.map((p) => (
            <label
              key={p.value}
              className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 text-sm ${
                permission === p.value
                  ? "border-neutral-900 dark:border-neutral-100"
                  : "border-neutral-300 dark:border-neutral-700"
              }`}
            >
              <input
                type="radio"
                name="permission"
                checked={permission === p.value}
                onChange={() => setPermission(p.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{t(p.label)}</span>
                <span className="block text-neutral-500">{t(p.desc)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={!connected || busy || (!isChat && !cwd.trim()) || !usable}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {connected ? t("new.create") : t("new.waiting")}
      </button>
    </form>
  );
}
