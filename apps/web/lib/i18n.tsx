"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "ko" | "en";
export const LANGS: { value: Lang; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

const LANG_KEY = "waggle:lang";

/**
 * 화면 문구 사전. 한국어를 기준으로 키를 정하고, 영어 사전은 같은 키를 모두 갖도록 타입으로 강제한다.
 * 키가 빠지면 화면에 키 이름이 그대로 노출되는데, 그걸 실행해보기 전에 컴파일 단계에서 잡으려는 것이다.
 * 서버가 만드는 메시지(에러·사용 불가 사유)는 여기 없다. 서버 응답 그대로 보여준다.
 */
const ko = {
  "common.untitled": "(제목 없음)",
  "common.save": "저장",
  "common.saving": "저장 중…",
  "common.delete": "삭제",
  "common.cancel": "취소",
  "common.confirm": "확인",
  "common.close": "닫기",
  "common.removeAttachment": "첨부 제거",
  "common.approxTokens": "약 {n}토큰",

  "profile.claude-sub": "Claude 구독",
  "profile.codex-sub": "GPT 구독",
  "profile.claude-api": "Claude API",
  "profile.codex-api": "GPT API",

  "conn.connecting": "연결 중…",
  "conn.open": "서버 연결됨",
  "conn.closed": "연결 끊김 · 재시도 중",

  "time.justNow": "방금",
  "time.minutes": "{n}분 전",
  "time.hours": "{n}시간 전",

  "sidebar.newSession": "+ 새 세션",
  "sidebar.empty": "아직 세션이 없어.",
  "sidebar.apiChat": "API 대화",
  "sidebar.settings": "⚙ 설정",
  "sidebar.running": "실행 중",
  "sidebar.rename": "제목 변경",
  "sidebar.delete": "세션 삭제",
  "sidebar.deleteTitle": "세션을 삭제할까?",
  "sidebar.deleteMessage": "\"{title}\" 세션과 대화 기록이 지워져.",
  "sidebar.deleteRunning": "실행 중인 작업은 중단돼.",
  "sidebar.deleteFailed": "삭제하지 못했어",
  "sidebar.renameTitle": "세션 제목 변경",
  "sidebar.renameConfirm": "변경",
  "sidebar.renameFailed": "제목을 바꾸지 못했어",
  "sidebar.switchLang": "Switch to English",

  "new.title": "새 세션",
  "new.mode": "실행 방식",
  "new.chatDesc": "API 대화 · {model}",
  "new.agentDesc": "에이전트 · 구독 한도 사용",
  "new.keyHintBefore": "API 방식은 ",
  "new.keyHintLink": "설정",
  "new.keyHintAfter": "에서 키를 등록하면 쓸 수 있어.",
  "new.cwd": "작업 폴더 (cwd)",
  "new.titleLabel": "제목",
  "new.titleHint": "(비워두면 첫 메시지로 자동)",
  "new.permission": "권한",
  "new.create": "세션 만들기",
  "new.waiting": "서버 연결 대기 중…",

  "perm.read-only": "읽기 전용",
  "perm.read-only.desc": "파일을 읽고 계획만 세운다. (Claude plan 모드 / GPT read-only 샌드박스)",
  "perm.workspace-write": "파일 수정 허용",
  "perm.workspace-write.desc": "작업 폴더 안 파일 수정 허용. (Claude acceptEdits / GPT workspace-write)",
  "perm.full": "전체 허용",
  "perm.full.desc": "셸 포함 모든 도구를 묻지 않고 실행한다. 주의. (Claude bypassPermissions / GPT danger-full-access)",

  "chat.notFound": "세션을 찾을 수 없어.",
  "chat.loading": "불러오는 중…",
  "chat.apiChat": "API 대화",
  "chat.cantChangeRunning": "실행 중에는 바꿀 수 없어",
  "chat.connectFolder": "📁 폴더 연결",
  "chat.loadingHistory": "기록 불러오는 중…",
  "chat.emptyChat": "첫 메시지를 보내면 {label}({model})와 대화가 시작돼. 파일이나 셸에는 접근하지 않아.",
  "chat.emptyChatFolder": "첫 메시지를 보내면 {label}({model})와 대화가 시작돼. 연결한 폴더 안의 파일만 다룰 수 있어.",
  "chat.modelUnknown": "모델 미정",
  "chat.emptyAgent": "첫 메시지를 보내면 이 폴더에서 {cli}({label})가 실행돼.",
  "chat.agentFallback": "에이전트",
  "chat.working": "작업 중…",
  "chat.generatedImage": "생성된 이미지",
  "chat.usage": "입력 {in} · 출력 {out} 토큰",
  "change.add": "추가",
  "change.modify": "수정",
  "change.delete": "삭제",
  "end.error": "오류로 종료",
  "end.cancelled": "중단됨",
  "end.timeout": "시간 초과",

  "composer.sendToTitle": "{vendor}로 전송할까?",
  "composer.sendToMessage": "{titles} 세션의 대화 내용이 {vendor}로 전송돼. 코드나 경로가 들어 있을 수 있어.",
  "composer.sendToConfirm": "전송",
  "composer.tooManyFiles": "파일은 한 번에 {n}개까지야",
  "composer.totalTooBig": "합계가 {n}자를 넘어",
  "composer.attachFailed": "첨부하지 못한 파일이 있어",
  "composer.refButton": "다른 세션 참조",
  "composer.fileButton": "파일 첨부 (텍스트 파일)",
  "composer.placeholderRunning": "실행 중… (끝나면 이어서 보낼 수 있어)",
  "composer.placeholder": "메시지 (Enter 전송, Shift+Enter 줄바꿈)",
  "composer.stop": "중단",
  "composer.send": "보내기",
  "chip.withTools": "도구 포함",
  "chip.transcript": "정리본",

  "files.tooLarge": "{name}: 파일이 너무 커",
  "files.notText": "{name}: 텍스트 파일이 아니야 (이미지·바이너리는 아직 지원 안 해)",
  "files.tooManyChars": "{name}: {n}자를 넘어",

  "client.disconnected": "서버 연결이 끊어짐",
  "client.notConnected": "서버에 연결되어 있지 않음",
  "client.notConnectedSend": "서버에 연결되어 있지 않아 보내지 못했어.",

  "ref.title": "다른 세션 참조",
  "ref.none": "첨부할 수 있는 다른 세션이 없어.",
  "ref.includeTools": "도구 과정 포함",
  "ref.includeToolsHint": "(어떤 파일을 읽고 고쳤는지까지. 출력은 앞부분만)",
  "ref.building": "미리보기 만드는 중…",
  "ref.size": "{chars}자 · 약 {tokens} 토큰",
  "ref.attach": "첨부",

  "approval.writes": "수정만 확인",
  "approval.writes.desc": "읽기는 자동, 파일을 고칠 때만 변경 내용을 보여주고 물어봐.",
  "approval.all": "매번 확인",
  "approval.all.desc": "파일 목록·읽기까지 전부 물어봐.",
  "approval.none": "모두 자동",
  "approval.none.desc": "묻지 않고 실행해. 연결 폴더 밖으로는 여전히 못 나가.",
  "approval.action.list": "폴더 목록 보기",
  "approval.action.read": "파일 읽기",
  "approval.action.write": "파일 수정",
  "approval.reject": "거절",
  "approval.approve": "승인",

  "folder.title": "📁 폴더 연결",
  "folder.desc": "연결한 폴더 안에서만 파일 목록·읽기·수정을 할 수 있어. 셸 명령은 실행하지 않아.",
  "folder.path": "폴더 경로",
  "folder.approval": "승인 방식",
  "folder.disconnect": "연결 해제",
  "folder.connect": "연결",
  "folder.warnTitle": "폴더 전체를 연결할까?",
  "folder.warnMessage":
    "폴더를 연결하면 모델이 필요한 파일을 찾느라 여러 파일을 읽으면서 토큰을 많이 쓸 수 있어.\n고칠 파일이 정해져 있다면 입력창의 📄 파일 첨부로 그 파일만 붙이는 걸 권장해.",
  "folder.warnConfirm": "그래도 연결",
  "folder.warnCancel": "돌아가기",

  "settings.title": "설정",
  "settings.language": "언어",
  "settings.languageDesc": "화면 언어를 바꿔. 대화 내용과 서버가 보내는 메시지는 바뀌지 않아.",
  "settings.apiKeys": "API 키",
  "settings.apiKeysDesc":
    "키는 이 PC의 Windows 자격 증명 관리자에만 저장되고, 화면에는 끝 4자리만 다시 보여. 저장할 때 모델 목록을 받아보면서 키가 맞는지 확인해.",
  "settings.anthropicKey": "Anthropic API 키 (Claude API)",
  "settings.openaiKey": "OpenAI API 키 (GPT API)",
  "settings.registered": "등록됨 {hint}",
  "settings.notRegistered": "미등록",
  "settings.replaceKey": "새 키로 교체",
  "settings.saved": "저장했어.",
  "settings.deleted": "삭제했어.",
  "settings.deleteKeyTitle": "API 키를 삭제할까?",
  "settings.deleteKeyMessage": "이 방식으로 만든 세션은 키를 다시 등록할 때까지 실행할 수 없어.",
  "settings.models": "API 모델",
  "settings.modelsLoading": "모델 목록 불러오는 중…",
  "settings.modelsNeedKey": "키를 등록하면 고를 수 있어",
  "settings.budget": "월 예산",
  "settings.budgetDesc":
    "이번 달 누적 비용이 예산에 닿으면 새 실행을 막고, 파일 작업 중이면 다음 API 호출 전에 멈춰. 비워두면 제한 없이 표시만 해. 진행 중인 응답 하나나 동시에 돌던 다른 세션만큼은 약간 넘을 수 있어.",
  "settings.budgetNote":
    "Claude API 비용은 토큰 수 × 정가로 계산한 값이라 할인·크레딧은 반영되지 않아. 단가를 모르는 모델이 답하면 Opus 최고 단가로 넉넉하게 잡아. GPT API 예산은 다음 업데이트에서 지원할 예정이라 지금은 토큰 수만 보여줘. 각 콘솔(Anthropic / OpenAI)의 사용 한도도 같이 걸어두는 걸 추천해.",
  "settings.spent": "이번 달 ${spent}",
  "settings.noBudget": " (예산 없음)",
  "settings.overBudget": " · 예산 초과로 실행 차단 중",
  "settings.unlimited": "제한 없음",
  "settings.status": "실행 방식 상태",
  "settings.available": "사용 가능",
};

export type MessageKey = keyof typeof ko;

const en: Record<MessageKey, string> = {
  "common.untitled": "(Untitled)",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.delete": "Delete",
  "common.cancel": "Cancel",
  "common.confirm": "OK",
  "common.close": "Close",
  "common.removeAttachment": "Remove attachment",
  "common.approxTokens": "~{n} tokens",

  "profile.claude-sub": "Claude Sub",
  "profile.codex-sub": "GPT Sub",
  "profile.claude-api": "Claude API",
  "profile.codex-api": "GPT API",

  "conn.connecting": "Connecting…",
  "conn.open": "Connected",
  "conn.closed": "Disconnected · retrying",

  "time.justNow": "just now",
  "time.minutes": "{n}m ago",
  "time.hours": "{n}h ago",

  "sidebar.newSession": "+ New session",
  "sidebar.empty": "No sessions yet.",
  "sidebar.apiChat": "API chat",
  "sidebar.settings": "⚙ Settings",
  "sidebar.running": "Running",
  "sidebar.rename": "Rename",
  "sidebar.delete": "Delete session",
  "sidebar.deleteTitle": "Delete this session?",
  "sidebar.deleteMessage": "\"{title}\" and its conversation history will be deleted.",
  "sidebar.deleteRunning": "The running task will be stopped.",
  "sidebar.deleteFailed": "Couldn't delete the session",
  "sidebar.renameTitle": "Rename session",
  "sidebar.renameConfirm": "Rename",
  "sidebar.renameFailed": "Couldn't rename the session",
  "sidebar.switchLang": "한국어로 보기",

  "new.title": "New session",
  "new.mode": "Mode",
  "new.chatDesc": "API chat · {model}",
  "new.agentDesc": "Agent · uses your subscription quota",
  "new.keyHintBefore": "Register API keys in ",
  "new.keyHintLink": "Settings",
  "new.keyHintAfter": " to use the API modes.",
  "new.cwd": "Working folder (cwd)",
  "new.titleLabel": "Title",
  "new.titleHint": "(defaults to your first message)",
  "new.permission": "Permissions",
  "new.create": "Create session",
  "new.waiting": "Waiting for the server…",

  "perm.read-only": "Read only",
  "perm.read-only.desc": "Reads files and plans only. (Claude plan mode / GPT read-only sandbox)",
  "perm.workspace-write": "Allow file edits",
  "perm.workspace-write.desc": "Allows editing files inside the working folder. (Claude acceptEdits / GPT workspace-write)",
  "perm.full": "Full access",
  "perm.full.desc": "Runs every tool, including the shell, without asking. Use with care. (Claude bypassPermissions / GPT danger-full-access)",

  "chat.notFound": "Session not found.",
  "chat.loading": "Loading…",
  "chat.apiChat": "API chat",
  "chat.cantChangeRunning": "Can't change this while running",
  "chat.connectFolder": "📁 Connect folder",
  "chat.loadingHistory": "Loading history…",
  "chat.emptyChat": "Send a message to start chatting with {label} ({model}). It won't access files or the shell.",
  "chat.emptyChatFolder": "Send a message to start chatting with {label} ({model}). It can only work with files in the connected folder.",
  "chat.modelUnknown": "no model selected",
  "chat.emptyAgent": "Send a message to run {cli} ({label}) in this folder.",
  "chat.agentFallback": "the agent",
  "chat.working": "Working…",
  "chat.generatedImage": "Generated image",
  "chat.usage": "In {in} · Out {out} tokens",
  "change.add": "added",
  "change.modify": "modified",
  "change.delete": "deleted",
  "end.error": "Ended with an error",
  "end.cancelled": "Stopped",
  "end.timeout": "Timed out",

  "composer.sendToTitle": "Send to {vendor}?",
  "composer.sendToMessage": "The conversation from {titles} will be sent to {vendor}. It may include code or file paths.",
  "composer.sendToConfirm": "Send",
  "composer.tooManyFiles": "You can attach up to {n} files at a time",
  "composer.totalTooBig": "The total exceeds {n} characters",
  "composer.attachFailed": "Some files couldn't be attached",
  "composer.refButton": "Reference another session",
  "composer.fileButton": "Attach files (text only)",
  "composer.placeholderRunning": "Running… (you can send once it finishes)",
  "composer.placeholder": "Message (Enter to send, Shift+Enter for a new line)",
  "composer.stop": "Stop",
  "composer.send": "Send",
  "chip.withTools": "with tools",
  "chip.transcript": "transcript",

  "files.tooLarge": "{name}: the file is too large",
  "files.notText": "{name}: not a text file (images and binaries aren't supported yet)",
  "files.tooManyChars": "{name}: exceeds {n} characters",

  "client.disconnected": "Lost connection to the server",
  "client.notConnected": "Not connected to the server",
  "client.notConnectedSend": "Not connected to the server, so the message wasn't sent.",

  "ref.title": "Reference another session",
  "ref.none": "There are no other sessions to attach.",
  "ref.includeTools": "Include tool steps",
  "ref.includeToolsHint": "(which files were read or edited; outputs are truncated)",
  "ref.building": "Building preview…",
  "ref.size": "{chars} chars · ~{tokens} tokens",
  "ref.attach": "Attach",

  "approval.writes": "Confirm edits",
  "approval.writes.desc": "Reads run automatically. Edits show the changes and ask first.",
  "approval.all": "Confirm everything",
  "approval.all.desc": "Asks before every action, including listing and reading files.",
  "approval.none": "Fully automatic",
  "approval.none.desc": "Runs without asking. Paths outside the connected folder are still blocked.",
  "approval.action.list": "List folder",
  "approval.action.read": "Read file",
  "approval.action.write": "Edit file",
  "approval.reject": "Reject",
  "approval.approve": "Approve",

  "folder.title": "📁 Connect folder",
  "folder.desc": "The model can list, read, and edit files only inside the connected folder. It never runs shell commands.",
  "folder.path": "Folder path",
  "folder.approval": "Approval",
  "folder.disconnect": "Disconnect",
  "folder.connect": "Connect",
  "folder.warnTitle": "Connect the whole folder?",
  "folder.warnMessage":
    "With a folder connected, the model may read many files while looking for what it needs, which can use a lot of tokens.\nIf you already know which files to change, attaching just those with 📄 is recommended.",
  "folder.warnConfirm": "Connect anyway",
  "folder.warnCancel": "Go back",

  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.languageDesc": "Changes the interface language. Conversations and messages from the server aren't translated.",
  "settings.apiKeys": "API keys",
  "settings.apiKeysDesc":
    "Keys are stored only in this PC's Windows Credential Manager, and only the last 4 characters are shown. Saving fetches your model list to check that the key works.",
  "settings.anthropicKey": "Anthropic API key (Claude API)",
  "settings.openaiKey": "OpenAI API key (GPT API)",
  "settings.registered": "Registered {hint}",
  "settings.notRegistered": "Not registered",
  "settings.replaceKey": "Replace with a new key",
  "settings.saved": "Saved.",
  "settings.deleted": "Deleted.",
  "settings.deleteKeyTitle": "Delete this API key?",
  "settings.deleteKeyMessage": "Sessions using this mode can't run until you register a key again.",
  "settings.models": "API models",
  "settings.modelsLoading": "Loading models…",
  "settings.modelsNeedKey": "Register a key to choose a model",
  "settings.budget": "Monthly budget",
  "settings.budgetDesc":
    "Once this month's spend reaches the budget, new runs are blocked, and file work stops before the next API call. Leave it empty to just track spending. One in-flight response, or another session running at the same time, can push slightly past the cap.",
  "settings.budgetNote":
    "Claude API cost is tokens × list price, so discounts and credits aren't reflected. Models with an unknown price are counted at the highest Opus price. A GPT API budget is planned for a future update; for now only token counts are shown. Setting usage limits in each console (Anthropic / OpenAI) is recommended too.",
  "settings.spent": "This month ${spent}",
  "settings.noBudget": " (no budget)",
  "settings.overBudget": " · over budget, runs blocked",
  "settings.unlimited": "No limit",
  "settings.status": "Mode status",
  "settings.available": "Available",
};

const DICTS: Record<Lang, Record<MessageKey, string>> = { ko, en };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = DICTS[lang][key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * 첫 렌더는 서버 렌더와 같아야 hydration 불일치가 안 나서 항상 한국어로 그린다.
 * 마운트 후 저장된 선택(없으면 브라우저 언어)으로 바꾼다. 영어 사용자는 첫 순간 한국어가 잠깐 보일 수 있다.
 * 선택은 이 브라우저에만 남기는 편의 설정이라 서버가 아니라 localStorage에 둔다.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ko");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LANG_KEY);
    } catch {}
    const initial: Lang = saved === "ko" || saved === "en" ? saved : navigator.language.startsWith("ko") ? "ko" : "en";
    setLangState(initial);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {}
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("LanguageProvider 밖에서 사용됨");
  return ctx;
}

export function useT(): Translate {
  return useLanguage().t;
}

/** 실행 방식 배지 이름. 알려진 4종은 사전에서, 그 외엔 서버가 준 이름을 그대로 쓴다 */
export function profileLabel(t: Translate, profileId: string, fallback?: string): string {
  const key = `profile.${profileId}` as MessageKey;
  return key in ko ? t(key) : (fallback ?? profileId);
}
