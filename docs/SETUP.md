# 설치 가이드

**[English](SETUP.en.md)** | 한국어

4가지 방식을 모두 쓸 필요는 없습니다. **쓰려는 방식의 준비만 하면 됩니다.** 준비하지 않은 방식은 화면에서 "사용 불가"로 표시되고, 이유가 함께 나옵니다.

| 쓰려는 방식 | 필요한 준비 |
|---|---|
| Claude 구독 | 2단계 |
| GPT 구독 | 3단계 |
| Claude API | 4단계 |
| GPT API | 5단계 |

---

## 1. 기본 준비

- **Node.js 22 이상**: https://nodejs.org
- **pnpm**: 터미널에서 설치합니다.
  ```bash
  npm install -g pnpm
  ```
- **git**: https://git-scm.com

설치가 끝났는지 확인합니다.
```bash
node -v    # v22 이상
pnpm -v
```

## 2. Claude 구독 (Claude Code CLI)

Claude Pro/Max 구독이 필요합니다.

1. Claude Code를 설치합니다. 설치 방법은 공식 문서를 따르세요: https://code.claude.com/docs
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. 터미널에서 `claude`를 한 번 실행하고, 안내에 따라 **Claude 계정으로 로그인**합니다.
3. 로그인이 끝나면 터미널을 닫아도 됩니다. waggle은 이 로그인 정보를 그대로 씁니다.

> waggle은 `ANTHROPIC_API_KEY` 같은 환경변수를 CLI에 넘기지 않습니다. 환경변수에 API 키가 있어도 구독으로 실행되고, API로 과금되지 않습니다.

## 3. GPT 구독 (Codex CLI)

ChatGPT Plus/Pro 등 Codex를 쓸 수 있는 구독이 필요합니다.

1. Codex CLI를 설치합니다. 설치 방법은 공식 저장소를 따르세요: https://github.com/openai/codex
   ```bash
   npm install -g @openai/codex
   ```
2. 터미널에서 로그인합니다.
   ```bash
   codex login
   ```
   브라우저가 열리면 **ChatGPT 계정으로 로그인**합니다.

## 4. Claude API 키

1. Anthropic Console(https://console.anthropic.com)에 로그인합니다.
2. **결제·크레딧**을 확인합니다. 크레딧이 없으면 API 호출이 실패합니다.
3. **사용 한도(Limits)를 설정**합니다. 실수로 많이 쓰는 걸 막는 가장 확실한 방법입니다.
4. **API Keys** 메뉴에서 새 키를 만들고 복사합니다. 키는 만들 때 한 번만 보입니다.
5. waggle의 **⚙ 설정 → API 키 → Anthropic API 키**에 붙여넣고 저장합니다.
   - 저장할 때 모델 목록을 받아오면서 키가 맞는지 확인합니다. 키가 틀리면 저장되지 않습니다.
   - 키는 Windows 자격 증명 관리자에 저장되고, 화면에는 끝 4자리만 보입니다.
6. 같은 설정 화면에서 **모델**과 **월 예산**을 정할 수 있습니다.

## 5. OpenAI API 키

1. OpenAI Platform(https://platform.openai.com)에 로그인합니다.
2. **결제·크레딧**을 확인합니다.
3. **사용 한도를 설정**합니다. GPT API의 월 예산 상한은 다음 업데이트에서 지원할 예정이라, 지금은 OpenAI 쪽 한도 설정이 예산 관리 수단입니다.
4. **API keys** 메뉴에서 새 키를 만들고 복사합니다.
5. waggle의 **⚙ 설정 → API 키 → OpenAI API 키**에 붙여넣고 저장합니다.

> 이미지 생성은 계정 상태에 따라 OpenAI의 조직 인증이 필요할 수 있습니다. 이미지 생성에서 권한 오류가 나면 OpenAI Platform의 조직 설정을 확인하세요.

## 6. 설치와 실행

```bash
git clone https://github.com/SID9-HoneyBee/honeybee-waggle.git
cd honeybee-waggle
pnpm install
pnpm build
pnpm start
```

브라우저에서 **http://127.0.0.1:3000** 을 엽니다. 왼쪽 아래에 "서버 연결됨"이 보이면 준비가 끝난 겁니다.

- 끌 때는 터미널에서 `Ctrl + C`를 누릅니다. 실행 중이던 작업도 함께 정리됩니다.
- 코드를 고치면서 쓰려면 `pnpm build` / `pnpm start` 대신 `pnpm dev`를 씁니다.

## 7. 처음 써보기

1. **+ 새 세션**에서 방식을 고릅니다.
   - 구독 방식: 작업할 폴더와 권한을 정합니다. 처음에는 **"파일 수정 허용"**을 권장합니다.
   - API 방식: 바로 대화가 시작됩니다. 파일 작업이 필요하면 세션 화면 오른쪽 위 **📁 폴더 연결**을 누릅니다.
2. 다른 세션의 내용을 이어받으려면 입력창 왼쪽 **📎**로 세션을 골라 첨부합니다.
3. 특정 파일만 보여주려면 **📄**로 첨부합니다. 폴더 전체를 연결하는 것보다 토큰을 훨씬 적게 씁니다.

## 설정할 수 있는 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `WAGGLE_PORT` | `4317` | 서버(WebSocket·파일) 포트 |
| `WAGGLE_DATA_DIR` | `<프로젝트>/.data` | 대화 기록·설정 저장 위치 |
| `WAGGLE_WEB_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | 접속을 허용할 웹 주소 |
| `CLAUDE_BIN` | 자동 탐색 | claude 실행 파일 경로 |
| `CODEX_BIN` | 자동 탐색 | codex 실행 파일 경로 |
| `NEXT_PUBLIC_WAGGLE_WS` | `ws://127.0.0.1:4317` | 웹이 접속할 서버 주소. **빌드할 때 고정**되므로 바꾸면 다시 빌드해야 합니다 |

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| "claude CLI를 찾지 못함" | 터미널에서 `claude --version`이 되는지 확인하세요. 되는데도 안 되면 `CLAUDE_BIN`에 실행 파일 경로를 지정하세요 |
| GPT 구독이 "codex login 필요" | 터미널에서 `codex login`을 실행하세요 |
| "키 확인 실패" | 키를 다시 복사했는지, 콘솔에 결제·크레딧이 있는지 확인하세요 |
| "서버 연결 끊김" | 서버 터미널에 오류가 있는지, 4317 포트를 다른 프로그램이 쓰고 있지 않은지 확인하세요 |
| 포트가 이미 사용 중 | 이미 켜둔 waggle이 있는지 확인하세요. 포트를 바꾸려면 `WAGGLE_PORT`, `WAGGLE_WEB_ORIGINS`, `NEXT_PUBLIC_WAGGLE_WS`를 함께 바꾸고 다시 빌드하세요 |
| API 세션이 "예산 초과" | ⚙ 설정의 월 예산을 올리거나 비우세요 |
| `pnpm install` 중 빌드 스크립트 경고 | `pnpm approve-builds`로 `esbuild`를 허용하세요 |
