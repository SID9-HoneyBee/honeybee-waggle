"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PermissionLevel } from "@honeybee-waggle/schema";
import { useWaggle, useWaggleClient } from "@/lib/WaggleProvider";

const LAST_CWD_KEY = "waggle:lastCwd";

const PERMISSIONS: { value: PermissionLevel; label: string; desc: string }[] = [
  { value: "read-only", label: "읽기 전용", desc: "plan 모드. 파일을 읽고 계획만 세운다." },
  {
    value: "workspace-write",
    label: "파일 수정 허용",
    desc: "acceptEdits. 파일 수정은 자동 승인, 승인이 필요한 셸 명령은 거절될 수 있다.",
  },
  { value: "full", label: "전체 허용", desc: "bypassPermissions. 셸 포함 모든 도구를 묻지 않고 실행한다. 주의." },
];

export function NewSessionForm() {
  const client = useWaggleClient();
  const router = useRouter();
  const connected = useWaggle((s) => s.conn === "open");
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
    } catch {}
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const session = await client.createSession({ title: title || undefined, cwd, permission });
      try {
        localStorage.setItem(LAST_CWD_KEY, cwd);
      } catch {}
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xl space-y-5">
      <h1 className="text-xl font-semibold">새 세션</h1>

      <label className="block space-y-1">
        <span className="text-sm font-medium">작업 폴더 (cwd)</span>
        <input
          required
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="D:\00. SID9\03. Project\..."
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-neutral-700"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">
          제목 <span className="font-normal text-neutral-500">(비워두면 첫 메시지로 자동)</span>
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">권한</legend>
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
              <span className="font-medium">{p.label}</span>
              <span className="block text-neutral-500">{p.desc}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={!connected || busy || !cwd.trim()}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {connected ? "세션 만들기" : "서버 연결 대기 중…"}
      </button>
    </form>
  );
}
