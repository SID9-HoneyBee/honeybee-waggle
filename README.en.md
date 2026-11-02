# 🐝 waggle

English | **[한국어](README.md)**

A local web app that puts Claude and GPT — **both subscription (CLI agents) and API** — in one screen, and lets **sessions pick up each other's context**.

Built for people who pay for both a Claude and a ChatGPT subscription but leave their separate API credits unused.
The goal: keep the subscriptions and the credits both working.

> The name comes from the honeybee's waggle dance: bees tell each other where the flowers are, and waggle sessions share what they've learned.

![Session sharing](docs/images/session-sharing.png)

## Features

### Four ways to run
| Mode | How it runs | What it can do |
|---|---|---|
| Claude subscription | Your local Claude Code CLI | Read/edit files and run shell commands in a working folder |
| GPT subscription | Your local Codex CLI | Read/edit files and run shell commands in a working folder |
| Claude API | Anthropic Messages API | Chat, file work in a connected folder |
| GPT API | OpenAI Responses API | Chat, **image generation**, file work in a connected folder |

![New session](docs/images/new-session.png)

### Cross-session context sharing
- Attach another session's conversation — including one from the other vendor's model — with the 📎 button.
- It is not an AI summary. waggle mechanically keeps **only the questions and final answers**, so nothing gets distorted. In our measurements this was 1–13% of the original log size.
- Optionally include the tool steps (which files were read or edited).
- Attachments that cross vendors (Claude ↔ GPT) ask for confirmation before sending.

### Folder access with approval in API mode
- Connect a folder to an API session and the model can list, read, and edit files.
- The model only **requests** tool calls. The local server executes them.
  - Paths outside the connected folder are blocked (`../`, absolute paths, symlink/junction escapes).
  - Edits show a diff and wait for your approval.
  - Approval policy is per session: confirm edits only / confirm everything / fully automatic.
- API mode never runs shell commands.

### Also
- 📄 Attach text files
- API keys live in the OS credential store (Windows Credential Manager). Only the last 4 characters are ever shown.
- Pick models from the list your account can actually use.
- Monthly budget cap for the Claude API (computed as tokens × list price)
- Rename/delete sessions, conversation history stored locally (survives server restarts)

![Settings](docs/images/settings.png)

## Quick start

See the **[setup guide](docs/SETUP.en.md)** for installation and account setup.

```bash
git clone https://github.com/SID9-HoneyBee/honeybee-waggle.git
cd honeybee-waggle
pnpm install
pnpm build
pnpm start
```

Open http://127.0.0.1:3000 in your browser.

## Before you use it

### Terms of service
- waggle only runs the Claude Code and Codex CLIs **installed on your own machine and logged in with your own account**. It is not a way to share a subscription with anyone else.
- You are responsible for complying with Anthropic's and OpenAI's terms and usage policies. Please review them before use.

### Security
- The server listens on `127.0.0.1` only and rejects connections from other websites (Origin check). It does **not** block other programs running on the same machine. Use it only on a machine you trust.
- The **"full access"** permission for subscription sessions lets the agent run shell commands without asking. Use it only when you really need it.
- API usage is billed for real. **Set spending limits** in the Anthropic and OpenAI consoles. waggle's monthly budget cap currently applies to the Claude API only.

## Current version and what's next

The current version is developed and used on Windows. The next updates aim to improve:

- Mac compatibility checks and fixes
- Attachments beyond text files, such as images
- A monthly budget cap for the GPT API as well
- A distribution package that makes installing and running easier

The goal is to make choosing between subscription and API on your own machine, and carrying context across sessions, even smoother.

## Layout

```
apps/server     Node + TypeScript. CLI/API adapters, session storage, WebSocket server
apps/web        Next.js. Session list, chat, and settings screens
packages/schema Adapter schema and protocol types shared by server and web
```

Conversation history and settings are stored in `.data/` (git-ignored).

## License

[MIT](LICENSE)
