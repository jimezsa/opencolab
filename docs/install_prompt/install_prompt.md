# OpenColab Installation Prompt

Paste the prompt below into your AI agent (Claude Code, ChatGPT desktop, Cursor, etc.) and let it drive the install end to end. The agent will install the OpenColab CLI through npm, create a Claude Code agent backed by `claude-opus-4-7`, and walk you step-by-step through Telegram pairing so you can control OpenColab from your phone.

---

## Prompt — copy from here

You are installing **OpenColab** for me on this machine. Drive the entire flow yourself: run the commands, read the output, only stop to ask me for information you cannot get from the shell (API keys, BotFather tokens, my Telegram chat id, project name).

Be explicit at every step. Before running a command, say what it does in one sentence. After running, summarize what changed. If a command fails, diagnose the root cause and fix it — do not blindly retry or fall back to destructive options.

Follow this plan in order. Do not skip steps.

### 0. Preflight

1. Confirm the operating system and shell.
2. Verify `node --version` reports Node.js >= 20 and `npm --version` works. If Node is missing or too old, stop and tell me to install Node 20+ before continuing (recommend `nvm` on macOS/Linux, the official installer on Windows). Do not attempt to install Node yourself.
3. Verify `claude --version` works — the Anthropic Claude Code CLI is the runtime OpenColab will drive. If it is missing, install it with `npm install -g @anthropic-ai/claude-code` and re-check. Reference: https://code.claude.com/docs/en/getting-started

### 1. Install OpenColab from npm

Run:

```bash
npm install -g opencolab
```

Then confirm the install with:

```bash
opencolab --version
opencolab --help
```

If `npm install -g` fails with a permission error on macOS/Linux, do **not** run it under `sudo`. Instead tell me and recommend either a Node version manager (nvm/fnm) or a user-writable npm prefix (`npm config set prefix ~/.npm-global` plus a PATH update). Pause for my confirmation before changing npm config.

### 2. Create a project

Ask me for a short project id (lowercase kebab-case, e.g. `lab-notebook`). Then run:

```bash
opencolab project create --project-id <project_id>
```

Confirm with `opencolab project show`.

### 3. Create a Claude agent on Opus 4-7

Pick a short agent id (default to `professor` unless I say otherwise). Create it:

```bash
opencolab agent create --agent-id <agent_id>
```

Wire the agent to Anthropic through **OAuth** (no API key). You cannot drive the interactive browser login yourself, so:

1. Tell me to run `claude auth login` in this terminal and complete the browser flow.
2. Wait until I confirm I am logged in. Verify with `claude --version` and (if available) a quick `claude auth status` — do not proceed if login looks broken.
3. Then configure the agent:

   ```bash
   opencolab setup model \
     --agent-id <agent_id> \
     --provider anthropic \
     --auth oauth \
     --model claude-opus-4-7 \
     --reasoning-effort xhigh
   ```

Do **not** ask me for an `ANTHROPIC_API_KEY` and do not pass `--api-key`. This install is OAuth-only.

Confirm the configuration with:

```bash
opencolab agent show
```

The output must show `provider: anthropic`, `model: claude-opus-4-7`, and `auth: oauth`. If anything is wrong, fix it before moving on.

### 4. Telegram setup (guide me through it)

This is the part where you stop and walk me through actions only I can take.

**4a. Create a Telegram bot with BotFather.**

Tell me to:

1. Open Telegram and message **@BotFather**.
2. Send `/newbot` and follow the prompts to pick a display name and a unique username ending in `bot` (e.g. `my_opencolab_bot`).
3. BotFather will reply with an `HTTP API token` that looks like `123456789:AA...`. Ask me to paste it to you. Treat it as a secret.

**4b. Find my Telegram chat id.**

Tell me to:

1. In Telegram, message **@userinfobot** (or `@RawDataBot`) with any text.
2. It will reply with my numeric user id (e.g. `987654321`). Ask me to paste it to you. That is my `chat_id`.

**4c. Wire the bot into OpenColab.**

Run:

```bash
opencolab setup telegram \
  --bot-token <bot_token> \
  --chat-id <chat_id>
```

This saves the bot token to `.env.local`, authorizes my chat, and syncs the Telegram slash-command menu. If the command menu sync warns, run `opencolab setup telegram commands sync` and try again.

**4d. Pair the chat.**

Run:

```bash
opencolab setup telegram pair start
```

OpenColab will send a one-time pairing code to my Telegram chat. Ask me to read the code back to you, then run:

```bash
opencolab setup telegram pair complete --code <code>
```

Confirm pairing succeeded by checking the success output.

### 5. Start the gateway

```bash
opencolab gateway start --port 4646
```

The gateway runs in the background by default. Verify with:

```bash
opencolab gateway status
```

It should report `running` on port `4646`.

### 6. Smoke test from Telegram

Tell me to open my Telegram chat with the bot and send `/help` (or just type "hello"). OpenColab should reply through the paired Claude Opus 4-7 agent. If nothing comes back within ~30 seconds:

- Re-check `opencolab gateway status`.
- Re-check `opencolab agent show` for the right provider/model/auth.
- Re-check `.env.local` contains the `TELEGRAM_BOT_TOKEN`.
- Re-check that `claude auth login` is still valid (re-run it if Anthropic shows an unauthorized error in the gateway logs).
- Re-run `opencolab setup telegram commands sync` if the slash-command menu is empty.

### 7. Final summary

When everything is green, tell me in one short message:

- The opencolab version installed.
- The active project id and agent id.
- That the agent is on `claude-opus-4-7` via Anthropic OAuth with reasoning effort `xhigh`.
- That the gateway is running on port 4646.
- That Telegram is paired and replying.

Then stop. Do **not** start configuring extra agents, GPU servers, or shared tools unless I ask.

---

## Notes for the human (not part of the agent prompt)

- The CLI commands above match the current OpenColab CLI surface (`opencolab setup model`, `opencolab setup telegram`, `opencolab setup telegram pair start|complete`, `opencolab gateway start`).
- `claude-opus-4-7` is the current default Anthropic model in OpenColab and supports reasoning efforts `low|medium|high|xhigh|max`.
- `opencolab ignite` is the interactive alternative to steps 2–4; the prompt above prefers explicit non-interactive commands so an agent can execute them reliably.
- Secrets land in `.env.local` at the OpenColab install root. Keep that file out of version control.
