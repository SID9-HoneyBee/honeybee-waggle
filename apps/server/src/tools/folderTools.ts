import { promises as fs } from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";

/** 모델에게 보여줄 도구 정의. Anthropic input_schema / OpenAI function parameters에 같은 JSON Schema를 쓴다 */
export interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  action: "list" | "read" | "write";
}

export const FOLDER_TOOLS: ToolSpec[] = [
  {
    name: "list_files",
    action: "list",
    description: "연결된 폴더 안의 파일 목록을 본다. 큰 폴더는 하위 폴더 경로를 지정해서 필요한 부분만 본다.",
    schema: {
      type: "object",
      properties: { path: { type: "string", description: "연결 폴더 기준 상대 경로. 생략하면 폴더 루트" } },
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    action: "read",
    description: "텍스트 파일을 읽는다. 큰 파일은 start_line/end_line으로 필요한 범위만 읽어서 토큰을 아낀다.",
    schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "integer", minimum: 1 },
        end_line: { type: "integer", minimum: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_file",
    action: "write",
    description: "파일의 일부를 바꾼다. old_string은 파일 안에서 정확히 한 번만 나와야 한다. 작은 수정은 write_file보다 이걸 쓴다.",
    schema: {
      type: "object",
      properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    action: "write",
    description: "파일 전체를 새 내용으로 쓴다 (없으면 만든다). 새 파일이나 전면 재작성에만 쓴다.",
    schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
];

// 목록에서 빼는 폴더. 의존성·빌드 산출물은 파일 수가 많아 목록만으로 토큰을 크게 잡아먹는다.
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "bin", "obj", ".data", ".vs", ".idea", "__pycache__"]);
const MAX_LIST_ENTRIES = 500;
const MAX_LIST_DEPTH = 6;
const MAX_READ_CHARS = 100_000;
const MAX_READ_BYTES = 5 * 1024 * 1024;

/**
 * 승인을 기다리는 동안 사용자나 다른 세션(같은 폴더의 CLI 에이전트 등)이 파일을 고쳤을 수 있다.
 * 승인한 diff는 대기 전 내용 기준이라, 그대로 쓰면 그 사이 변경을 말없이 덮어쓴다. 바뀌었으면 쓰지 않는다.
 */
async function assertUnchanged(file: string, expected: string | null): Promise<void> {
  const current = await fs.readFile(file, "utf8").catch(() => null);
  if (current !== expected) throw new Error("승인을 기다리는 동안 파일이 바뀌어서 쓰지 않음. 파일을 다시 읽고 수정해.");
}

/**
 * 비밀이 들어 있을 가능성이 높은 파일. 읽은 내용은 모델 API로 전송되고 대화 기록에도 남으므로,
 * 승인 방식이 "모두 자동"이어도 이 파일들은 항상 사용자에게 묻는다. .gitignore에 있다고 안전한 게 아니다.
 * 예시·템플릿 파일(.env.example 등)은 보통 값이 비어 있어 제외한다.
 */
const SENSITIVE_NAMES: RegExp[] = [
  /^\.env(?!\.(example|sample|template)$)(\..+)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|asc)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^\.(npmrc|pypirc|netrc|git-credentials|pgpass)$/i,
  /^(credentials|secrets?)(\..+)?$/i,
  // C#/.NET 프로젝트는 연결 문자열·키를 appsettings*.json, web.config, *.publishsettings에 두는 경우가 많다.
  /^appsettings(\..+)?\.json$/i,
  /^web\.config$/i,
  /\.publishsettings$/i,
];
const SENSITIVE_DIRS = new Set([".ssh", ".aws", ".gnupg", ".azure", ".kube"]);

export function isSensitivePath(relPath: string): boolean {
  const parts = relPath.split("/");
  const name = parts[parts.length - 1] ?? "";
  return parts.some((p) => SENSITIVE_DIRS.has(p)) || SENSITIVE_NAMES.some((re) => re.test(name));
}

export interface PreparedCall {
  action: ToolSpec["action"];
  /** 연결 폴더 기준 상대 경로 (승인 화면 표시용) */
  relPath: string;
  /** 민감한 파일이면 승인 방식과 무관하게 항상 묻는다 */
  sensitive: boolean;
  diff?: string;
  /** 승인 후 실제 실행. 승인 전에 diff를 만들려고 읽은 내용을 재사용한다 */
  run: () => Promise<string>;
}

/**
 * 도구 호출을 검증하고 실행 준비를 한다. 경로 검사와 diff 생성은 여기서 끝내고, 실제 쓰기는 run()에서 한다.
 * 이렇게 나눠야 사용자가 승인하는 diff와 실제로 쓰이는 내용이 같다는 걸 보장할 수 있다.
 */
export async function prepareCall(root: string, name: string, input: Record<string, unknown>): Promise<PreparedCall> {
  const spec = FOLDER_TOOLS.find((t) => t.name === name);
  if (!spec) throw new Error(`알 수 없는 도구: ${name}`);
  const rel = typeof input.path === "string" && input.path.trim() ? input.path.trim() : ".";
  const forWrite = spec.action === "write";
  const abs = await resolveInside(root, rel, forWrite);
  const relPath = toSlash(path.relative(await fs.realpath(root), abs)) || ".";
  const sensitive = spec.action !== "list" && isSensitivePath(relPath);

  /**
   * 검사(여기)와 실행(승인 뒤 run) 사이에는 시간이 있다. 그 사이 다른 프로세스가 하위 폴더를 외부를 가리키는
   * 링크로 바꾸면, 처음에 검사한 경로로 그대로 쓰는 순간 연결 폴더 밖에 쓰게 된다. 실행 직전에 같은 검사를 다시 해서
   * 실제 경로가 처음과 같은지 확인한다. 재검사와 쓰기 사이의 아주 짧은 틈은 남는다 (Windows에서 경로 구성요소마다
   * 링크를 따라가지 않고 여는 방법이 없다). 로컬에 악성 프로세스가 있는 상황까지 완전히 막지는 못한다.
   */
  const reverify = async () => {
    const again = await resolveInside(root, rel, forWrite);
    if (again !== abs) throw new Error("검사 이후 경로가 바뀌어서 실행하지 않음 (링크 교체 등). 다시 시도해.");
  };

  switch (name) {
    case "list_files":
      return {
        action: "list",
        relPath,
        sensitive,
        run: async () => {
          await reverify();
          return listFiles(abs);
        },
      };
    case "read_file": {
      const start = asInt(input.start_line);
      const end = asInt(input.end_line);
      return {
        action: "read",
        relPath,
        sensitive,
        run: async () => {
          await reverify();
          return readFile(abs, start, end);
        },
      };
    }
    case "edit_file": {
      const oldStr = String(input.old_string ?? "");
      const newStr = String(input.new_string ?? "");
      const before = await fs.readFile(abs, "utf8");
      const count = oldStr ? before.split(oldStr).length - 1 : 0;
      if (count !== 1) throw new Error(count === 0 ? "old_string을 파일에서 찾지 못함" : `old_string이 ${count}번 나옴. 앞뒤 문맥을 더 넣어 한 곳만 가리키게 해`);
      const after = before.replace(oldStr, () => newStr);
      return {
        action: "write",
        relPath,
        sensitive,
        diff: createTwoFilesPatch(relPath, relPath, before, after),
        run: async () => {
          await reverify();
          await assertUnchanged(abs, before);
          await fs.writeFile(abs, after, "utf8");
          return `수정함: ${relPath}`;
        },
      };
    }
    case "write_file": {
      const content = String(input.content ?? "");
      const before = await fs.readFile(abs, "utf8").catch(() => null);
      return {
        action: "write",
        relPath,
        sensitive,
        diff: createTwoFilesPatch(relPath, relPath, before ?? "", content),
        run: async () => {
          await reverify();
          await assertUnchanged(abs, before);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          // mkdir가 만든 중간 폴더 경로도 링크로 바뀔 수 있어서 쓰기 직전에 한 번 더 본다.
          await reverify();
          await fs.writeFile(abs, content, "utf8");
          return `저장함: ${relPath}`;
        },
      };
    }
  }
  throw new Error(`알 수 없는 도구: ${name}`);
}

/**
 * 연결 폴더 밖으로 나가는 경로를 막는다. 문자열 비교만으로는 심볼릭 링크·정션(Windows)으로 빠져나갈 수 있어서,
 * 실제 경로(realpath)로 바꾼 뒤 비교한다. 아직 없는 파일(새로 쓸 파일)은 존재하는 가장 가까운 상위 폴더로 검사한다.
 */
async function resolveInside(root: string, rel: string, forWrite: boolean): Promise<string> {
  const rootReal = await fs.realpath(root);
  const target = path.resolve(rootReal, rel);
  const missing: string[] = [];
  let probe = target;
  let real: string;
  for (;;) {
    try {
      real = path.join(await fs.realpath(probe), ...missing.reverse());
      break;
    } catch {
      // realpath가 실패해도 "없는 경로"가 아니라 대상이 사라진 링크일 수 있다. 그걸 없는 파일로 취급하면
      // 상위 폴더 기준 검사는 통과하고, 실제 쓰기는 링크를 따라 폴더 밖에 파일을 만든다. 링크 자체가 있으면 막는다.
      if (await fs.lstat(probe).then(() => true, () => false)) throw new Error(`대상을 확인할 수 없는 링크라 접근할 수 없음: ${rel}`);
      const parent = path.dirname(probe);
      if (parent === probe) throw new Error(`경로를 확인할 수 없음: ${rel}`);
      missing.push(path.basename(probe));
      probe = parent;
    }
  }
  const inside = path.relative(rootReal, real);
  if (inside.startsWith("..") || path.isAbsolute(inside)) throw new Error(`연결된 폴더 밖 경로는 접근할 수 없음: ${rel}`);
  // .git 안을 고치면 저장소가 깨질 수 있다. 읽기는 허용하지만 쓰기는 막는다.
  if (forWrite && inside.split(path.sep).includes(".git")) throw new Error(".git 폴더는 수정할 수 없음");
  return real;
}

async function listFiles(dir: string): Promise<string> {
  const lines: string[] = [];
  let truncated = false;
  async function walk(current: string, depth: number): Promise<void> {
    if (lines.length >= MAX_LIST_ENTRIES) {
      truncated = true;
      return;
    }
    // 권한 없는 폴더(System Volume Information 등) 하나 때문에 목록 전체가 실패하면 안 된다. 그 항목만 표시하고 넘어간다.
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => null);
    if (!entries) {
      lines.push(`${toSlash(path.relative(dir, current)) || "."}/ (접근 불가)`);
      return;
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (lines.length >= MAX_LIST_ENTRIES) {
        truncated = true;
        return;
      }
      const rel = toSlash(path.relative(dir, path.join(current, e.name)));
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) {
          lines.push(`${rel}/ (생략)`);
          continue;
        }
        lines.push(`${rel}/`);
        if (depth < MAX_LIST_DEPTH) await walk(path.join(current, e.name), depth + 1);
      } else {
        const stat = await fs.stat(path.join(current, e.name)).catch(() => null);
        lines.push(stat ? `${rel} (${stat.size}B)` : `${rel} (접근 불가)`);
      }
    }
  }
  await walk(dir, 0);
  if (truncated) lines.push(`… ${MAX_LIST_ENTRIES}개에서 잘림. 하위 폴더를 지정해서 다시 봐.`);
  return lines.join("\n") || "(빈 폴더)";
}

async function readFile(file: string, start?: number, end?: number): Promise<string> {
  // 통째로 메모리에 올리기 전에 크기로 거른다. 수 GB 로그를 읽으면 서버 하나에 붙은 모든 세션이 멈춘다.
  const { size } = await fs.stat(file);
  if (size > MAX_READ_BYTES) {
    throw new Error(`파일이 너무 큼 (${(size / 1024 / 1024).toFixed(1)}MB). 로그·데이터 파일이면 사용자에게 필요한 부분을 첨부해달라고 요청해.`);
  }
  const text = await fs.readFile(file, "utf8");
  if (text.includes("\u0000")) throw new Error("텍스트 파일이 아님");
  let body = text;
  if (start || end) {
    const lines = text.split("\n");
    body = lines.slice((start ?? 1) - 1, end ?? lines.length).join("\n");
  }
  if (body.length > MAX_READ_CHARS) {
    return `${body.slice(0, MAX_READ_CHARS)}\n…(${body.length - MAX_READ_CHARS}자 생략. start_line/end_line으로 나눠 읽어)`;
  }
  return body;
}

// 모델·화면에 보여주는 경로는 OS와 무관하게 / 로 통일한다. 모델이 그대로 되돌려 써도 path.resolve가 받아준다.
function toSlash(p: string): string {
  return p.split(path.sep).join("/");
}

function asInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
}
