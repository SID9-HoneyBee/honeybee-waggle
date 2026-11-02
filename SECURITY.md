# Security Policy / 보안 정책

[English](#english) | [한국어](#한국어)

---

## English

### Supported versions

Only the latest commit on `main` receives security fixes.

### Intended use

waggle is a **local, single-user tool with no authentication**. It listens on `127.0.0.1` only and checks the Origin of browser connections. Exposing it to a network — through tunnels, reverse proxies, port forwarding, or private networks such as Tailscale — is not supported. See the caution in the [README](README.en.md).

### Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub: **Security** tab → **Report a vulnerability**.

Please include:
- What the issue is and what an attacker could do
- Steps to reproduce (version or commit, OS, configuration)
- Whether it requires the app to be exposed beyond `127.0.0.1`

**Never include API keys, session logs, or other secrets** in your report.

Examples of what we especially want to hear about:
- Escaping the connected folder in API mode (path traversal, symlink/junction tricks)
- Bypassing the Origin check or the local-only startup check
- API keys leaking into logs, files, WebSocket messages, or child process environments
- A web page on another site being able to drive the local server

This is a personal project, so responses are best-effort. Reports will be acknowledged as soon as possible.

---

## 한국어

### 지원 버전

보안 수정은 `main`의 최신 커밋에만 반영됩니다.

### 의도한 사용 방식

waggle은 **인증이 없는 1인용 로컬 도구**입니다. `127.0.0.1`에서만 열리고, 브라우저 접속의 Origin을 검사합니다. 터널, 리버스 프록시, 포트 포워딩, Tailscale 같은 사설망 등으로 외부에 노출하는 사용은 지원하지 않습니다. 자세한 내용은 [README](README.md)의 경고를 참고하세요.

### 취약점 제보

**보안 문제는 공개 이슈로 올리지 말아주세요.**

GitHub의 비공개 제보 기능을 이용해주세요: **Security** 탭 → **Report a vulnerability**

다음 내용을 함께 적어주세요.
- 어떤 문제이고, 공격자가 무엇을 할 수 있는지
- 재현 방법 (버전 또는 커밋, OS, 설정)
- `127.0.0.1` 밖으로 노출해야만 성립하는 문제인지

**API 키, 세션 기록 등 민감한 정보는 절대 포함하지 마세요.**

특히 알려주시면 좋은 문제:
- API 모드에서 연결 폴더 밖으로 접근 (경로 조작, 심볼릭 링크·정션 우회)
- Origin 검사나 로컬 전용 시작 검사 우회
- API 키가 로그·파일·WebSocket 메시지·자식 프로세스 환경변수로 새는 문제
- 다른 사이트의 웹 페이지가 로컬 서버를 조작할 수 있는 문제

개인 프로젝트라 답변은 가능한 범위에서 드립니다. 제보를 받으면 최대한 빨리 확인하겠습니다.
