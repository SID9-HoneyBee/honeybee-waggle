/**
 * buildEnv에 넘길 base env. 서버 프로세스의 env를 통째로 넘기지 않고, CLI 실행에 필요한 것만 허용 목록으로 고른다.
 *
 * 처음에는 "위험한 것만 빼기"(API 키, 상위 Claude Code 세션 마커) 방식이었는데, 그러면 GH_TOKEN,
 * AWS_SECRET_ACCESS_KEY, DATABASE_URL처럼 목록에 없는 비밀이 전부 에이전트로 넘어간다. 에이전트는 셸을 실행할 수
 * 있으니 env에 있는 건 곧 모델이 읽을 수 있는 것이다. 그래서 "필요한 것만 넣기"로 바꿨다.
 *
 * 상위 세션 마커(CLAUDECODE, CLAUDE_CODE_*)는 허용 목록에 없으므로 자연히 빠진다. 남아 있으면 자식 claude가
 * 중첩 세션으로 인식하거나 부모 세션의 메시징 소켓에 붙을 수 있다.
 * 사용자가 일부러 넘기고 싶은 변수가 있으면 WAGGLE_PASS_ENV에 이름을 쉼표로 적는다 (예: GH_TOKEN).
 */

// Windows env 이름은 대소문자를 구분하지 않아서(Path/PATH) 대문자로 비교한다.
const ALLOWED = new Set([
  // 실행 파일 탐색·OS 기본
  "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "OS", "PSMODULEPATH",
  "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "PROCESSOR_LEVEL", "PROCESSOR_REVISION", "NUMBER_OF_PROCESSORS",
  // 사용자·폴더 (CLI가 로그인 정보와 설정을 찾는 위치)
  "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "ALLUSERSPROFILE", "PUBLIC",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
  "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "COMMONPROGRAMW6432",
  "USERNAME", "USERDOMAIN", "USER", "LOGNAME", "COMPUTERNAME", "HOSTNAME",
  "TEMP", "TMP", "TMPDIR",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
  // 터미널·언어
  "LANG", "LANGUAGE", "TZ", "TERM", "COLORTERM", "SHELL",
  // 회사망 등에서 HTTPS가 되려면 필요하다
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
  // 사용자가 직접 설정한 CLI 설정 폴더. 프로필에 configDir가 있으면 buildEnv가 덮어쓴다.
  "CLAUDE_CONFIG_DIR", "CODEX_HOME",
]);
const ALLOWED_PREFIXES = ["LC_"];

export function safeBaseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const extra = new Set(
    (env.WAGGLE_PASS_ENV ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    const key = k.toUpperCase();
    if (ALLOWED.has(key) || extra.has(key) || ALLOWED_PREFIXES.some((p) => key.startsWith(p))) out[k] = v;
  }
  return out;
}
