# Setup guide

English | **[한국어](SETUP.md)**

You don't need all four modes. **Set up only the ones you want.** Modes that aren't set up show as "unavailable" in the app, with the reason.

| Mode | Steps |
|---|---|
| Claude subscription | Step 2 |
| GPT subscription | Step 3 |
| Claude API | Step 4 |
| GPT API | Step 5 |

> The app UI is currently in Korean. Menu names below are given with their Korean labels.

---

## 1. Basics

- **Node.js 22+**: https://nodejs.org
- **pnpm**:
  ```bash
  npm install -g pnpm
  ```
- **git**: https://git-scm.com

Check:
```bash
node -v    # v22 or later
pnpm -v
```

## 2. Claude subscription (Claude Code CLI)

Requires a Claude Pro/Max subscription.

1. Install Claude Code. Follow the official docs: https://code.claude.com/docs
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. Run `claude` once in a terminal and **log in with your Claude account**.
3. You can close the terminal afterwards. waggle reuses that login.

> waggle never passes environment variables like `ANTHROPIC_API_KEY` to the CLI. Even if one is set on your machine, subscription sessions run on your subscription, not on API billing.

## 3. GPT subscription (Codex CLI)

Requires a ChatGPT plan that includes Codex (Plus, Pro, etc.).

1. Install the Codex CLI. Follow the official repo: https://github.com/openai/codex
   ```bash
   npm install -g @openai/codex
   ```
2. Log in:
   ```bash
   codex login
   ```
   **Log in with your ChatGPT account** in the browser window that opens.

## 4. Claude API key

1. Sign in to the Anthropic Console: https://console.anthropic.com
2. Check **billing / credits**. API calls fail without credits.
3. **Set usage limits.** This is the most reliable protection against overspending.
4. Create a key under **API Keys** and copy it. It is shown only once.
5. Paste it into waggle under **⚙ 설정 (Settings) → API 키 → Anthropic API 키** and save.
   - waggle fetches your model list while saving, which also validates the key. Invalid keys are not saved.
   - The key is stored in Windows Credential Manager. Only the last 4 characters are shown.
6. On the same screen you can pick the **model** and a **monthly budget**.

## 5. OpenAI API key

1. Sign in to the OpenAI Platform: https://platform.openai.com
2. Check **billing / credits**.
3. **Set usage limits.** waggle can't compute GPT API costs, so OpenAI's limits are your only budget control.
4. Create a key under **API keys** and copy it.
5. Paste it into waggle under **⚙ 설정 (Settings) → API 키 → OpenAI API 키** and save.

> Depending on your account, image generation may require OpenAI organization verification. If image generation fails with a permission error, check your organization settings on the OpenAI Platform.

## 6. Install and run

```bash
git clone https://github.com/SID9-HoneyBee/honeybee-waggle.git
cd honeybee-waggle
pnpm install
pnpm build
pnpm start
```

Open **http://127.0.0.1:3000**. When the bottom-left corner shows "서버 연결됨" (server connected), you're ready.

- Press `Ctrl + C` in the terminal to stop. Running jobs are cleaned up too.
- If you're editing the code, use `pnpm dev` instead of `pnpm build` / `pnpm start`.

## 7. First steps

1. Click **+ 새 세션** (new session) and pick a mode.
   - Subscription modes: choose a working folder and a permission level. **"파일 수정 허용"** (allow file edits) is a good start.
   - API modes: the chat starts right away. For file work, click **📁 폴더 연결** (connect folder) at the top right of the session.
2. To carry over context from another session, click **📎** next to the input box and pick a session.
3. To share specific files, attach them with **📄**. This uses far fewer tokens than connecting a whole folder.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `WAGGLE_PORT` | `4317` | Server port (WebSocket and files) |
| `WAGGLE_DATA_DIR` | `<project>/.data` | Where history and settings are stored |
| `WAGGLE_WEB_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Web origins allowed to connect |
| `CLAUDE_BIN` | auto-detected | Path to the claude executable |
| `CODEX_BIN` | auto-detected | Path to the codex executable |
| `NEXT_PUBLIC_WAGGLE_WS` | `ws://127.0.0.1:4317` | Server address the web app connects to. **Fixed at build time**, so rebuild after changing it |

## Troubleshooting

| Symptom | What to check |
|---|---|
| "claude CLI를 찾지 못함" (claude CLI not found) | Make sure `claude --version` works in a terminal. If it does, set `CLAUDE_BIN` to the executable path |
| GPT subscription says "codex login 필요" (login required) | Run `codex login` in a terminal |
| "키 확인 실패" (key check failed) | Re-copy the key and confirm the console has billing/credits |
| "연결 끊김" (disconnected) | Check the server terminal for errors and make sure nothing else is using port 4317 |
| Port already in use | Check whether waggle is already running. To change ports, set `WAGGLE_PORT`, `WAGGLE_WEB_ORIGINS`, and `NEXT_PUBLIC_WAGGLE_WS` together, then rebuild |
| API session says "예산 초과" (over budget) | Raise or clear the monthly budget in ⚙ Settings |
| Build-script warning during `pnpm install` | Allow `esbuild` with `pnpm approve-builds` |
