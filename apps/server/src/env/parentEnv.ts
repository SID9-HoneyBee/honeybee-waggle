/**
 * buildEnv에 넘길 base env에서 상위 Claude Code 세션의 흔적을 지운다.
 *
 * 서버를 Claude Code(터미널/VSCode 확장) 안에서 띄우면 CLAUDECODE, CLAUDE_CODE_SESSION_ID,
 * CLAUDE_CODE_MESSAGING_SOCKET/TOKEN 등이 상속된다. 그대로 두면 자식 claude가 자신을
 * 중첩 세션으로 인식하거나 부모 세션의 메시징 소켓에 붙을 수 있다.
 * 스키마의 buildEnv는 API 키만 걸러내고 원본은 수정하지 않기로 했으므로 여기서 미리 거른다.
 *
 * CLAUDE_CODE_* 접두어는 통째로 지운다. 사용자가 의도적으로 설정한 CLAUDE_CODE_* 옵션도 같이 빠지는데,
 * 그런 설정이 필요해지면 BackendProfile 쪽으로 옮겨 명시적으로 주입하는 게 맞다.
 */
export function stripParentSessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === "CLAUDECODE" || k === "CLAUDE_PID" || k.startsWith("CLAUDE_CODE_")) continue;
    out[k] = v;
  }
  return out;
}
