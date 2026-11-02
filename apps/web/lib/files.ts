import type { FileAttachment } from "@honeybee-waggle/schema";

// 서버(SessionManager)와 같은 한도. 서버가 최종 기준이지만, 보내기 전에 막아야 입력이 날아가지 않는다.
export const MAX_FILES = 10;
export const MAX_FILE_CHARS = 200_000;
export const MAX_TOTAL_FILE_CHARS = 500_000;

/**
 * 브라우저에서 고른 파일을 텍스트로 읽는다. 1차는 텍스트 파일만 지원한다.
 * 확장자로 거르지 않고 내용에 NUL 문자가 있는지로 판별한다. 확장자 없는 설정 파일이나 낯선 확장자의 소스도 받기 위해서다.
 */
export async function readTextFiles(list: FileList): Promise<{ files: FileAttachment[]; rejected: string[] }> {
  const files: FileAttachment[] = [];
  const rejected: string[] = [];
  for (const file of Array.from(list)) {
    // 수 MB짜리 바이너리를 통째로 문자열로 읽으면 탭이 멈춘다. 크기로 먼저 거른다 (UTF-8 한 글자 최대 4바이트).
    if (file.size > MAX_FILE_CHARS * 4) {
      rejected.push(`${file.name}: 파일이 너무 커`);
      continue;
    }
    const content = await file.text();
    if (content.includes("\u0000")) rejected.push(`${file.name}: 텍스트 파일이 아니야 (이미지·바이너리는 아직 지원 안 해)`);
    else if (content.length > MAX_FILE_CHARS) rejected.push(`${file.name}: ${MAX_FILE_CHARS.toLocaleString()}자를 넘어`);
    else files.push({ name: file.name, content });
  }
  return { files, rejected };
}
