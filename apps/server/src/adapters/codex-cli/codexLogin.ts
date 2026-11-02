import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { buildEnv, type BackendProfile } from "@honeybee-waggle/schema";
import { stripParentSessionEnv } from "../../env/parentEnv";
import type { CodexCommand } from "./resolveCodexBin";

/**
 * GPT API 프로필의 전용 CODEX_HOME에 API 키로 로그인한다.
 * 스키마의 buildEnv는 codex에 키를 env로 넣지 않고 CODEX_HOME만 지정하는 설계라,
 * 키는 실행 때마다가 아니라 등록 시점에 이 로그인으로 한 번 반영된다.
 * 키는 인자가 아니라 stdin으로 넘긴다. 인자로 넘기면 작업 관리자/프로세스 목록에 원문이 보인다.
 */
export async function codexLoginWithApiKey(
  codex: CodexCommand,
  profile: BackendProfile,
  key: string,
  resolveKey: (ref: string) => string,
): Promise<void> {
  if (!profile.configDir) throw new Error(`${profile.id}에 configDir이 없음`);
  await fs.mkdir(profile.configDir, { recursive: true });

  const env = buildEnv(profile, stripParentSessionEnv(process.env), resolveKey);
  const child = spawn(codex.command, [...codex.prefixArgs, "login", "--with-api-key"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (s: string) => (output += s));
  child.stderr.setEncoding("utf8").on("data", (s: string) => (output += s));
  child.stdin.on("error", () => {});
  child.stdin.end(key + "\n", "utf8");

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) throw new Error(`codex login 실패 (exit ${code}): ${output.trim().slice(-500)}`);
}

export async function codexLogout(codex: CodexCommand, profile: BackendProfile, resolveKey: (ref: string) => string) {
  if (!profile.configDir) return;
  const env = buildEnv(profile, stripParentSessionEnv(process.env), resolveKey);
  await new Promise<void>((resolve) => {
    const child = spawn(codex.command, [...codex.prefixArgs, "logout"], { env, stdio: "ignore", windowsHide: true });
    // 로그아웃 실패는 치명적이지 않다. 키 저장소에서 지웠으면 다음 등록 때 덮어쓴다.
    child.once("error", () => resolve());
    child.once("close", () => resolve());
  });
}
