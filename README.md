# OpenColab

OpenColab v1 is a minimalist multi-project research assistant.

Architecture:

`Telegram -> Gateway -> Active Project -> Active Agent`

- multiple projects
- multiple agents per project
- one active project/agent at a time
- one provider runtime per project: Codex or Claude Code
- setup and control via CLI and Telegram commands
- persistence in `opencolab.json`

## Stack

- TypeScript (Node.js ESM)
- pnpm

## Requirements

- Node.js 22+
- pnpm 9+
- Telegram bot token (exported in env var)
- Codex CLI or Claude Code CLI + provider API key env var (or mock mode)

## Quickstart

```bash
pnpm install
pnpm run build
```

Initialize state and default project/agent files:

```bash
node dist/src/cli.js init
```

`AGENTS.md` is seeded from an internal essential researcher template.
Fresh initialization defaults the active project provider to `claude_code` with model `claude-opus-4-6`.

Create and select a project:

```bash
node dist/src/cli.js project create --project-id personal
```

This creates the main `researcher_agent` files directly in `projects/personal/`.

Create and select an additional agent in the active project:

```bash
node dist/src/cli.js agent create --agent-id personal_agent
```

Configure Codex provider for the active project:

```bash
node dist/src/cli.js setup model \
  --provider codex \
  --model gpt-5 \
  --api-key-env-var OPENAI_API_KEY \
  --cli-command codex \
  --cli-args "exec,-"
```

Configure Anthropic provider with Claude for the active project:

```bash
node dist/src/cli.js setup model \
  --provider claude_code \
  --model claude-opus-4-6 \
  --api-key-env-var ANTHROPIC_API_KEY \
  --cli-command claude \
  --cli-args "-p,{prompt},--model,{model}"
```

Configure Telegram once for all projects:

```bash
node dist/src/cli.js setup telegram \
  --bot-token-env-var TELEGRAM_BOT_TOKEN \
  --chat-id <telegram_chat_id>
```

Start pairing (code is sent to Telegram):

```bash
node dist/src/cli.js setup telegram pair start
```

Complete pairing in CLI using the code received on Telegram:

```bash
node dist/src/cli.js setup telegram pair complete --code <pairing_code>
```

Start local gateway server:

```bash
node dist/src/cli.js gateway start --port 4646
```

During response generation, the gateway sends Telegram `typing...` feedback automatically.
Telegram inbound supports text plus file/media messages (document, photo, audio, video, voice, video note, animation, sticker).

Agent responses can send Telegram files with directive lines:

```text
@telegram-file {"kind":"document","file":"<file_id_or_url>","caption":"optional"}
```

Telegram webhook endpoint:

`POST http://127.0.0.1:4646/api/telegram/webhook`

## Project and Agent Commands

CLI:

- `opencolab project create --project-id <id>`
- `opencolab project use --project-id <id>`
- `opencolab project list`
- `opencolab project show`
- `opencolab agent create --agent-id <id> [--path <path>]`
- `opencolab agent use --agent-id <id>`
- `opencolab agent list`
- `opencolab agent show`

Telegram (paired and authorized chat):

- `/project create <project_id>`
- `/project use <project_id>`
- `/project list`
- `/agent create <agent_id>`
- `/agent use <agent_id>`
- `/agent list`
- `/session reset`

## Agent Contract

Each agent directory must include:

- `AGENTS.md`
- `BOOTSTRAP.md`
- `IDENTITY.md`
- `SOUL.md`
- `TOOLS.md`
- `USER.md`
- `MEMORY.md` (long-term memory only)

`AGENTS.md` is initialized from a built-in essential researcher template.
`BOOTSTRAP.md` is initialized from a built-in first-run guide to help the agent discover identity and preferences.
`IDENTITY.md` is initialized from a built-in identity scaffold.

Default layout:

- main `researcher_agent`: `projects/<project_id>/`
- additional agents: `projects/<project_id>/subagents/<agent_id>/`

Conversation history layout:

- current session logs: `<agent_path>/memory/Session/<session_id>/<YYYY-MM-DD>.jsonl`
- reset active session from Telegram with `/session reset`
- conversation logs are no longer written under `.opencolab`

## Configuration

`opencolab.json` stores runtime state:

- active project id
- projects map
- per-project agents map
- per-project provider config (`codex` or `claude_code`)
- shared Telegram settings and pairing state

Secrets are referenced by env var names and should not be committed to git.

## Development

```bash
pnpm run check
pnpm run build
pnpm test
```
