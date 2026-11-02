import type { ToolKind } from "@honeybee-waggle/schema";

/** 한 run 안에서 도구 왕복 상한. 모델이 같은 파일을 반복해서 읽는 등 헛돌 때 비용이 끝없이 나가지 않게 막는다 */
export const MAX_TOOL_TURNS = 25;

export function toolKindOf(name: string): ToolKind {
  if (name === "read_file" || name === "list_files") return "file_read";
  if (name === "edit_file" || name === "write_file") return "file_edit";
  return "other";
}

/**
 * 폴더가 연결된 세션의 시스템 지시. 토큰을 아끼는 사용법을 먼저 알려준다.
 * 폴더 전체를 훑으면 비용이 빠르게 늘어서, 필요한 파일만 골라 읽게 유도하는 게 이 지시의 핵심이다.
 */
export function folderInstructions(folder: string): string {
  return [
    `사용자가 폴더 "${folder}"를 연결했다. 파일은 제공된 도구로만 읽고 고칠 수 있고, 경로는 이 폴더 기준 상대 경로로 쓴다.`,
    "토큰을 아껴야 한다. 필요한 파일만 골라 읽고, 큰 파일은 필요한 줄 범위만 읽는다. 폴더 전체를 훑지 않는다.",
    "작은 수정은 edit_file, 새 파일이나 전면 재작성만 write_file을 쓴다.",
    "사용자가 도구 실행을 거절하면 같은 작업을 반복하지 말고 이유를 설명하거나 다른 방법을 묻는다.",
  ].join("\n");
}
