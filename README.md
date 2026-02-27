# OpenColab

OpenColab v1 is now a minimalist single-agent research assistant.

Architecture:

`Telegram -> Gateway -> Agent`

- one agent
- one provider runtime: Codex only
- setup and control via CLI
- persistence in `opencolab.json`

## Stack

- TypeScript (Node.js ESM)
- pnpm

## Requirements

- Node.js 22+
- pnpm 9+
- Telegram bot token (exported in env var)
- Codex CLI + API key env var (or mock mode)

## Quickstart

```bash
pnpm install
pnpm run build
```

Initialize project state and default agent files:

```bash
node dist/src/cli.js init
```

Configure a different personal-named agent (this replaces the active agent in v1):

```bash
node dist/src/cli.js agent init \
  --agent-id personal_agent \
  --path agents/personal_agent
```

Configure Codex provider:

```bash
node dist/src/cli.js setup model \
  --model gpt-5 \
  --api-key-env-var OPENAI_API_KEY \
  --cli-command codex \
  --cli-args "exec,-"
```

Configure Telegram:

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

Telegram webhook endpoint:

`POST http://127.0.0.1:4646/api/telegram/webhook`

## Agent Contract

Agent directory must include:

- `AGENTS.md`
- `IDENTITY.md`
- `SOUL.md`
- `TOOLS.md`
- `USER.md`
- `MEMORY.md` (long-term memory only)

Default location: `agents/research_agent`.

## Configuration

`opencolab.json` stores the local runtime state:

- agent metadata
- provider metadata (`codex`)
- Telegram settings
- pairing state

Secrets are referenced by env var names and should not be committed to git.

## Development

```bash
pnpm run check
pnpm run build
pnpm test
```
