import { EventEmitter } from "node:events";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidProfile, type BackendProfile, type KeyProvider, type ProfileInfo } from "@honeybee-waggle/schema";
import { defaultModel, listModels } from "../adapters/chat/modelCatalog";
import type { CodexCommand } from "../adapters/codex-cli/resolveCodexBin";
import type { KeyStore } from "./KeyStore";
import { builtinProfiles, type ProfileDef } from "./registry";

interface SettingsFile {
  budgets: Record<string, number>;
  /** API 프로필별로 고른 모델 */
  models: Record<string, string>;
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
 * 프로필 4종의 사용 가능 여부, API 키, 모델 선택, 월 예산·비용을 관리한다.
 * 키 원문은 resolveKey(구독 CLI의 buildEnv, API 대화 어댑터)에서만 쓰이고, 밖으로 나가는 ProfileInfo에는 힌트만 담는다.
 */
export class ProfileService extends EventEmitter<{ changed: [] }> {
  private readonly defs = builtinProfiles();
  private settings: SettingsFile = { budgets: {}, models: {} };
  private usage: UsageFile = {};
  /** provider → 키로 조회한 모델 목록. 메모리에만 둔다 (서버 시작·키 등록 때 다시 받음) */
  private readonly modelLists = new Map<KeyProvider, string[]>();
  private readonly modelErrors = new Map<KeyProvider, string>();
  private readonly settingsPath: string;
  private readonly usagePath: string;
  // 여러 세션의 usage가 동시에 들어오면 tmp→rename이 겹쳐 Windows에서 EPERM이 난다. 파일 쓰기를 한 줄로 세운다.
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: ProfileServiceOptions) {
    super();
    this.settingsPath = path.join(opts.dataDir, "settings.json");
    this.usagePath = path.join(opts.dataDir, "usage.json");
  }

  async init(): Promise<void> {
    const loaded = await readJson<Partial<SettingsFile>>(this.settingsPath, {});
    this.settings = { budgets: loaded.budgets ?? {}, models: loaded.models ?? {} };
    this.usage = await readJson(this.usagePath, {});
    // 모델 목록은 네트워크를 타므로 서버 시작을 막지 않는다. 받아오는 대로 화면에 반영된다.
    for (const provider of ["anthropic", "openai"] as const) {
      if (this.opts.keyStore.get(provider)) void this.refreshModels(provider).catch(() => {});
    }
  }

  /** 키 조회. 구독 CLI는 buildEnv의 resolveKey로, API 대화 어댑터는 SDK 클라이언트 생성 시 쓴다. 동기여야 한다 (스키마 시그니처) */
  resolveKey = (ref: string): string => {
    const key = this.opts.keyStore.get(ref as KeyProvider);
    if (!key) throw new Error(`API 키가 등록되지 않음: ${ref}. 설정 화면에서 등록해줘.`);
    return key;
  };

  /** 현재 설정(예산·모델)이 반영된 프로필. 어댑터는 run마다 이걸 다시 받아 설정 변경이 바로 적용되게 한다 */
  get(profileId: string): BackendProfile {
    const def = this.def(profileId);
    return { ...def.profile, budgetUsd: this.settings.budgets[profileId], model: this.modelFor(def) };
  }

  label(profileId: string): string {
    return this.defs.find((d) => d.profile.id === profileId)?.label ?? profileId;
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
        runtime: profile.runtime,
        available: !reason,
        unavailableReason: reason,
        keyProvider: def.keyProvider,
        keyHint: def.keyProvider ? this.opts.keyStore.hint(def.keyProvider) : undefined,
        model: this.modelFor(def),
        modelOptions: def.keyProvider ? this.modelLists.get(def.keyProvider) : undefined,
        costTracked: isCostTracked(profile),
        budgetUsd: this.settings.budgets[profile.id],
        spentUsd: isCostTracked(profile) ? this.spent(profile.id) : undefined,
      };
    });
  }

  /** 세션 생성·메시지 전송 직전 검사. 키가 지워졌거나 예산을 넘었으면 여기서 막는다 */
  assertCanRun(profileId: string): void {
    const def = this.def(profileId);
    const reason = this.unavailableReason(def);
    if (reason) throw new Error(`${def.label}: ${reason}`);
    const over = this.budgetExceeded(profileId);
    if (over) throw new Error(over);
  }

  /**
   * 이번 달 예산을 넘었으면 이유를, 아니면 undefined. run 시작 때뿐 아니라 도구 루프 안에서 API를 다시 부르기 전에도 쓴다.
   * 그래도 응답 하나·동시에 도는 다른 run만큼은 넘을 수 있어서, 하드 리밋이 아니라 1차 안전장치 수준이다.
   */
  budgetExceeded(profileId: string): string | undefined {
    const budget = this.settings.budgets[profileId];
    const spent = this.spent(profileId);
    if (budget === undefined || spent < budget) return undefined;
    return `${this.label(profileId)} 이번 달 예산 초과 ($${spent.toFixed(2)} / $${budget}). 설정에서 예산을 조정해줘.`;
  }

  async setKey(provider: KeyProvider, rawKey: string): Promise<void> {
    const key = rawKey.trim();
    if (!key) throw new Error("빈 키는 저장할 수 없음");
    // 저장 전에 모델 목록을 받아보며 키를 검증한다. 틀린 키를 "등록됨"으로 보여주면 실행 때가 돼서야 알게 된다.
    let models: string[];
    try {
      models = await listModels(provider, key);
    } catch (err) {
      throw new Error(`키 확인 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.opts.keyStore.set(provider, key);
    this.modelLists.set(provider, models);
    this.modelErrors.delete(provider);
    this.emit("changed");
  }

  async deleteKey(provider: KeyProvider): Promise<void> {
    this.opts.keyStore.delete(provider);
    this.modelLists.delete(provider);
    this.modelErrors.delete(provider);
    this.emit("changed");
  }

  async setModel(profileId: string, model: string): Promise<void> {
    const def = this.def(profileId);
    const options = def.keyProvider ? this.modelLists.get(def.keyProvider) : undefined;
    if (!options?.includes(model)) throw new Error(`선택할 수 없는 모델: ${model}`);
    this.settings.models[profileId] = model;
    await this.persist(this.settingsPath, this.settings);
    this.emit("changed");
  }

  async setBudget(profileId: string, budgetUsd: number | null): Promise<void> {
    if (budgetUsd !== null && !isCostTracked(this.get(profileId))) {
      throw new Error("이 방식은 비용을 계산할 수 없어 예산을 걸 수 없음");
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

  private async refreshModels(provider: KeyProvider): Promise<void> {
    try {
      this.modelLists.set(provider, await listModels(provider, this.resolveKey(provider)));
      this.modelErrors.delete(provider);
    } catch (err) {
      this.modelErrors.set(provider, err instanceof Error ? err.message : String(err));
      console.warn(`[profiles] ${provider} 모델 목록 조회 실패:`, err);
    } finally {
      this.emit("changed");
    }
  }

  private modelFor(def: ProfileDef): string | undefined {
    if (!def.keyProvider) return undefined;
    const chosen = this.settings.models[def.profile.id];
    const options = this.modelLists.get(def.keyProvider) ?? [];
    // 고른 모델이 목록에서 사라졌으면(계정 권한 변경 등) 기본값으로 돌아간다. 없는 모델로 보내면 매번 400이다.
    if (chosen && (options.length === 0 || options.includes(chosen))) return chosen;
    return defaultModel(def.keyProvider, options);
  }

  private persist(file: string, data: unknown): Promise<void> {
    const snapshot = JSON.stringify(data, null, 2);
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => writeJson(file, snapshot));
    return this.writeQueue;
  }

  private spent(profileId: string): number {
    return this.usage[currentMonth()]?.[profileId] ?? 0;
  }

  private def(profileId: string): ProfileDef {
    const def = this.defs.find((d) => d.profile.id === profileId);
    if (!def) throw new Error(`알 수 없는 실행 방식: ${profileId}`);
    return def;
  }

  private unavailableReason(def: ProfileDef): string | undefined {
    const { profile } = def;
    if (!isValidProfile(profile)) return "프로필 설정 오류";
    if (profile.runtime === "agent") {
      if (profile.engine === "claude" && !this.opts.claudeBin) return "claude CLI를 찾지 못함";
      if (profile.engine === "codex") {
        if (!this.opts.codex) return "codex CLI를 찾지 못함";
        const home = profile.configDir ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
        if (!existsSync(path.join(home, "auth.json"))) return "터미널에서 `codex login` 필요";
      }
      return undefined;
    }
    if (def.keyProvider && !this.opts.keyStore.get(def.keyProvider)) return "API 키 미등록";
    if (def.keyProvider && this.modelErrors.has(def.keyProvider)) return `모델 목록 조회 실패: ${this.modelErrors.get(def.keyProvider)}`;
    if (!this.modelFor(def)) return "모델 목록을 불러오는 중";
    return undefined;
  }
}

// Claude API만 토큰×정가로 비용을 계산한다. OpenAI는 단가표를 유지할 근거가 없어 토큰만 보여준다.
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
