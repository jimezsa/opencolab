# OpenColab v1 Minimal Specification

## 1. Purpose

OpenColab v1 is a minimal personal research assistant that provides one AI agent reachable through Telegram.

This specification replaces the previous multi-agent lab direction for the initial release.

## 2. Product Scope

v1 supports exactly one agent and one provider runtime:

- one research agent instance
- one model provider: Codex only
- one user interaction channel: Telegram chat through a gateway
- one operator control channel: OpenColab CLI

No parallel agent orchestration is included in this version.

## 3. Initial Architecture

The runtime architecture is strictly:

`Telegram -> Gateway -> Agent`

Definitions:

- `Telegram`: external messaging channel used by the user.
- `Gateway`: local OpenColab service that receives Telegram updates, validates pairing, and routes messages.
- `Agent`: single Codex-backed research assistant execution unit.

## 4. Core Capabilities (v1)

Required:

- Receive Telegram messages and route them to the single agent.
- Return agent responses back to Telegram.
- Keep minimal conversation context for the chat session.
- Configure model API key and Telegram pairing via CLI.
- Persist agent and provider configuration in `opencolab.json`.

Not required in v1:

- web UI
- multi-agent scheduling
- provider abstraction across multiple vendors
- meetings, run orchestration, or shared repositories

## 5. Agent Definition Files

The single agent must include the following files in its agent directory:

- `AGENTS.md`
- `IDENTITY.md`
- `SOUL.md`
- `TOOLS.md`
- `USER.md`
- `MEMORY.md`

These files define behavior, persona, boundaries, and user context for the agent prompt assembly flow.
`MEMORY.md` is reserved for long-term memory only.

## 6. Telegram Pairing Flow

Pairing is mandatory before normal chat routing.

### 6.1 Pairing Sequence

1. Operator runs CLI pairing start command.
2. OpenColab generates a short-lived pairing code.
3. Gateway sends the pairing code to the configured Telegram user/chat.
4. Operator enters that code in the CLI to complete pairing.
5. On success, Telegram chat is marked as trusted and chat routing is enabled.

### 6.2 Pairing Requirements

- Pairing code must expire (recommended: 10 minutes).
- Pairing code must be single-use.
- Failed attempts must not enable chat routing.
- Gateway must reject normal messages until pairing is completed.

## 7. CLI Requirements

CLI is the required setup and control surface for v1.

Required command groups:

- `opencolab init`
- `opencolab setup model`
- `opencolab setup telegram`
- `opencolab setup telegram pair`
- `opencolab agent`

### 7.1 CLI Responsibilities

- collect and store Codex API key
- collect Telegram bot configuration
- start pairing and validate pairing code
- show current configured agent and provider status

## 8. Provider Constraint

v1 supports only Codex.

Requirements:

- provider identifier is fixed to `codex`
- no `claude_code` or `gemini` adapters in scope for v1
- agent runtime calls only Codex execution path

## 9. Configuration Persistence (`opencolab.json`)

`opencolab.json` is the source of truth for local runtime configuration.

It must store:

- agent metadata
- provider metadata (Codex)
- Telegram settings
- pairing state

### 9.1 Minimum Shape

```json
{
  "agent": {
    "id": "research_agent",
    "path": "agents/research_agent",
    "files": {
      "agents": "AGENTS.md",
      "identity": "IDENTITY.md",
      "soul": "SOUL.md",
      "tools": "TOOLS.md",
      "user": "USER.md",
      "memory": "MEMORY.md"
    }
  },
  "provider": {
    "name": "codex",
    "model": "<model-name>",
    "apiKeyEnvVar": "OPENAI_API_KEY"
  },
  "telegram": {
    "botTokenEnvVar": "TELEGRAM_BOT_TOKEN",
    "chatId": "<telegram-chat-id>",
    "paired": true,
    "pairedAt": "2026-02-27T00:00:00.000Z"
  }
}
```

Notes:

- Secrets should be loaded from environment variables, not stored as raw keys.
- Additional fields are allowed if they do not violate this minimum contract.

## 10. Message Handling Rules

- If chat is unpaired: Gateway replies with pairing-required message.
- If chat is paired: Gateway forwards message content to the Codex agent.
- Agent response is sent back to the same Telegram chat.
- System should log request/response metadata for local debugging.

## 11. Non-Goals for This Version

- multi-user support
- multi-chat routing
- autonomous background jobs
- complex toolchains beyond the minimal agent prompt contract

## 12. Acceptance Criteria

v1 is complete when all are true:

- A user can pair Telegram using a CLI-entered pairing code sent by OpenColab.
- After pairing, user can chat with the single agent from Telegram.
- Agent responses come from the Codex runtime path.
- `opencolab.json` persists agent and provider information plus Telegram pairing state.
- Agent directory includes `AGENTS.md`, `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, `USER.md`, and `MEMORY.md`.
