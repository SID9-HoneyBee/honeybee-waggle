import { EventEmitter } from "node:events";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidProfile, type BackendProfile, type KeyProvider, type ProfileInfo } from "@honeybee-waggle/schema";
import { codexLoginWithApiKey, codexLogout } from "../adapters/codex-cli/codexLogin";
import type { CodexCommand } from "../adapters/codex-cli/resolveCodexBin";
import type { KeyStore } from "./KeyStore";
import { builtinProfiles, type ProfileDef } from "./registry";

interface SettingsFile {
  budgets: Record<string, number>;
}
/** 월(YYYY-MM) → 프로필 → 누적 USD */
type UsageFile = Record<string, Record<string, number>>;

interface ProfileServiceOptions {
  dataDir: string;
  keyStore: KeyStore;
  claudeBin: string | null;
  codex: CodexCommand | null;
}

/**
 * 프로필 4종의 사용 가능 여부, API 키, 월 예산·비용을 관리한다.
 * 키 원문은 resolveKey(buildEnv 경유)와 codex 로그인에서만 쓰이고, 밖으로 나가는 ProfileInfo에는 힌트만 담는다.
 */
export class ProfileService extends EventEmitter<{ changed: [] }> {
  private readonly defs: ProfileDef[];
  private settings: SettingsFile = { budgets: {} };
  private usage: UsageFile = {};
  private readonly settingsPath: string;
  private readonly usagePath: string;
  // 여러 세션의 usage가 동시에 들어오면 tmp→rename이 겹쳐 Windows에서 EPERM이 난다. 파일 쓰기를 한 줄로 세운다.
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: ProfileServiceOptions) {
    super();
    this.defs = builtinProfiles(opts.dataDir);
    this.settingsPath = path.join(opts.dataDir, "settings.json");
    this.usagePath = path.join(opts.dataDir, "usage.json");
  }

  async init(): Promise<void> {
    this.settings = await readJson(this.settingsPath, { budgets: {} });
    this.usage = await readJson(this.usagePath, {});
  }

  /** buildEnv에 넘기는 키 조회. 동기여야 한다 (스키마 시그니처) */
  resolveKey = (ref: string): string => {
    const key = this.opts.keyStore.get(ref as KeyProvider);
    if (!key) throw new Error(`API 키가 등록되지 않음: ${ref}. 설정 화면에서 등록해줘.`);
    return key;
  };

  get(profileId: string): BackendProfile {
    const def = this.defs.find((d) => d.profile.id === profileId);
    if (!def) throw new Error(`알 수 없는 실행 방식: ${profileId}`);
    return { ...def.profile, budgetUsd: this.settings.budgets[profileId] };
  }

  list(): ProfileInfo[] {
    return this.defs.map((def) => {
      const { profile } = def;
      const reason = this.unavailableReason(def);
      return {
        id: profile.id,
        label: def.label,
        engine: profile.engine,
        auth: profile.auth,
        available: !reason,
        unavailableReason: reason,
        keyProvider: def.keyProvider,
        keyHint: def.keyProvider ? this.opts.keyStore.hint(def.keyProvider) : undefined,
        costTracked: isCostTracked(profile),
        budgetUsd: this.settings.budgets[profile.id],
        spentUsd: isCostTracked(profile) ? this.spent(profile.id) : undefined,
      };
    });
  }

  /** 세션 생성·메시지 전송 직전 검사. 키가 지워졌거나 예산을 넘었으면 여기서 막는다 */
  assertCanRun(profileId: string): void {
    const def = this.defs.find((d) => d.profile.id === profileId);
    if (!def) throw new Error(`알 수 없는 실행 방식: ${profileId}`);
    const reason = this.unavailableReason(def);
    if (reason) throw new Error(`${def.label}: ${reason}`);
    const budget = this.settings.budgets[profileId];
    const spent = this.spent(profileId);
    // run 시작 전에만 검사하므로 동시에 여러 run이 돌면 상한을 조금 넘길 수 있다. 하드 리밋이 아니라 안전장치 수준.
    if (budget !== undefined && spent >= budget) {
      throw new Error(`${def.label} 이번 달 예산 초과 ($${spent.toFixed(2)} / $${budget}). 설정에서 예산을 조정해줘.`);
    }
  }

  async setKey(provider: KeyProvider, rawKey: string): Promise<void> {
    const key = rawKey.trim();
    if (!key) throw new Error("빈 키는 저장할 수 없음");
    this.opts.keyStore.set(provider, key);
    try {
      if (provider === "openai") await this.loginCodexApi(key);
    } catch (err) {
      // 로그인 실패한 키를 남겨두면 "등록됨"으로 보이는데 실행은 안 되는 상태가 된다. 되돌린다.
      this.opts.keyStore.delete(provider);
      throw err;
    } finally {
      this.emit("changed");
    }
  }

  async deleteKey(provider: KeyProvider): Promise<void> {
    this.opts.keyStore.delete(provider);
    if (provider === "openai" && this.opts.codex) {
      await codexLogout(this.opts.codex, this.get("codex-api"), this.resolveKey);
    }
    this.emit("changed");
  }

  async setBudget(profileId: string, budgetUsd: number | null): Promise<void> {
    if (budgetUsd !== null && !isCostTracked(this.get(profileId))) {
      throw new Error("이 방식은 CLI가 비용을 보고하지 않아 예산을 걸 수 없음");
    }
    if (budgetUsd === null) delete this.settings.budgets[profileId];
    else if (!Number.isFinite(budgetUsd) || budgetUsd < 0) throw new Error("예산은 0 이상의 숫자여야 함");
    else this.settings.budgets[profileId] = budgetUsd;
    await this.persist(this.settingsPath, this.settings);
    this.emit("changed");
  }

  async addCost(profileId: string, usd: number): Promise<void> {
    if (!(usd > 0)) return;
    const month = currentMonth();
    const m = (this.usage[month] ??= {});
    m[profileId] = (m[profileId] ?? 0) + usd;
    await this.persist(this.usagePath, this.usage);
    this.emit("changed");
  }

  private persist(file: string, data: unknown): Promise<void> {
    const snapshot = JSON.stringify(data, null, 2);
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => writeJson(file, snapshot));
    return this.writeQueue;
  }

  private spent(profileId: string): number {
    return this.usage[currentMonth()]?.[profileId] ?? 0;
  }

  private unavailableReason(def: ProfileDef): string | undefined {
    const { profile } = def;
    if (!isValidProfile(profile)) return "프로필 설정 오류";
    if (profile.engine === "claude" && !this.opts.claudeBin) return "claude CLI를 찾지 못함";
    if (profile.engine === "codex" && !this.opts.codex) return "codex CLI를 찾지 못함";
    if (def.keyProvider && !this.opts.keyStore.get(def.keyProvider)) return "API 키 미등록";
    if (profile.engine === "codex") {
      const home = profile.configDir ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
      if (!existsSync(path.join(home, "auth.json"))) {
        return profile.auth === "subscription" ? "터미널에서 `codex login` 필요" : "codex 로그인 안 됨 (키를 다시 등록해줘)";
      }
    }
    return undefined;
  }

  private async loginCodexApi(key: string): Promise<void> {
    if (!this.opts.codex) throw new Error("codex CLI를 찾지 못해 GPT API 로그인을 할 수 없음");
    await codexLoginWithApiKey(this.opts.codex, this.get("codex-api"), key, this.resolveKey);
  }
}

// claude CLI만 total_cost_usd를 보고한다. 구독은 실제 청구가 아니라 제외.
function isCostTracked(p: BackendProfile): boolean {
  return p.auth === "api" && p.engine === "claude";
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[profiles] ${file} 읽기 실패, 기본값 사용:`, err);
    return fallback;
  }
}

async function writeJson(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, file);
}
