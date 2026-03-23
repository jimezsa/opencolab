# OpenColab Technical Guide

Start with [README.md](README.md) for the general overview and installer-based quickstart.
For full requirements and architecture intent, see [docs/spec.md](docs/spec.md) and [docs/VISION.md](docs/VISION.md).

## Manual Run (git clone + node)

If you prefer not to use the installer command shim:

```bash
git clone https://github.com/jimezsa/opencolab.git
cd opencolab
pnpm install
pnpm run build
node dist/src/cli.js ignite
node dist/src/cli.js gateway start --foreground true --port 4646
```

## Provider Setup and Auth

OpenColab configures `claude`, `codex`, `gemini`, and `pi` for non-interactive runs, so agents can work in the active project without extra terminal prompts.
Each agent chooses its own provider, and all agent runtimes work inside the project workspace by default.
Progress updates for long-running runs are also enabled by default, so agents can stream bounded status events back through Telegram without extra setup.

Auth options:

- Use `api_key` when you want env-based auth such as local scripts, servers, or CI.
- Use `oauth` when you already use the provider CLI locally and want to reuse that login session.

Gemini-based built-in shared tools such as `paper-summary` and `nano-banana` use `GEMINI_API_KEY` even if the active agent runtime uses another provider or Gemini OAuth. `opencolab ignite` includes a dedicated step for that key, and you can also save one provider key without changing the active agent runtime:

```bash
opencolab setup api-key --provider gemini --api-key <your_gemini_key>
```

OpenAI:

- `api_key`: uses `OPENAI_API_KEY`
- `oauth`: uses your `codex login` session

Gemini:

- `api_key`: uses `GEMINI_API_KEY`
- `oauth`: uses your `gemini` CLI login

OAuth setup examples:

```bash
# OpenAI OAuth
codex login
opencolab setup model --provider openai --auth oauth --model gpt-5.3-codex

# Gemini OAuth
gemini
opencolab setup model --provider gemini --auth oauth --model gemini-2.5-pro
```

`opencolab ignite` offers these preset Gemini model choices: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.1-pro-preview`, and `gemini-3-flash-preview`.

For MiniMax, `opencolab ignite` offers these preset model choices: `MiniMax-M2.5` and `MiniMax-M2.7`.

If you want to use Gemini, install the CLI first:

```bash
npm install -g @google/gemini-cli
```

xAI support uses the `pi` runtime with `XAI_API_KEY`:

```bash
opencolab setup model --provider xai --model grok-code-fast-1 --api-key <your_xai_key>
```

OpenColab runs `pi` with a workspace-local `PI_CODING_AGENT_DIR` so non-interactive Telegram and CLI runs do not depend on `~/.pi/agent`.

Provider CLI execution defaults to a 10 minute timeout. Override it in `.env.local` if needed:

```env
OPENCOLAB_CODEX_TIMEOUT_MS=600000
```

## Gateway Operation

Start local gateway server:

```bash
opencolab gateway start --port 4646
```

`gateway start` runs as a background service by default on macOS/Linux.
Useful commands:

- `opencolab gateway status`
- `opencolab gateway logs`
- `opencolab gateway stop`
- `opencolab gateway restart --port 4646`

If you want to run it in the active terminal process:

```bash
opencolab gateway start --foreground true --port 4646
```

Telegram webhook endpoint:

`POST http://127.0.0.1:4646/api/telegram/webhook`

Inbound Telegram files are downloaded into the active project under `memory/TelegramInbox/` when possible, using collision-safe local filenames, and the agent receives the caption plus the local file path instead of only Telegram metadata. If Telegram file resolution is slow or fails, routing falls back to caption plus attachment metadata instead of hanging the chat.
For outbound Telegram files, agents can emit raw `@telegram-file <json>` lines. OpenColab accepts local file paths relative to the active agent directory as well as absolute paths, and it tolerates single-backtick wrapping around the directive line.
The built-in paper search skills keep their `findings.md` schemas stable, generate a companion literature-map block diagram through the shared `block-diagram` skill, and for user-facing interactive runs return a short, friendly summary in chat while sending back `findings.md` plus a PNG-first literature-map diagram when file delivery is supported, with SVG fallback if PNG rendering is unavailable. The shared `pageindex-grounded` skill complements that workflow by answering precise follow-up questions over already-downloaded local papers with bounded paper selection, cached PageIndex trees under `research/pageindex/`, and exact paper or page references when the local evidence supports them. The shared `pdf-figure-extract` skill can then extract architecture and other paper figures from those local PDFs with PyMuPDF, optionally reuse PageIndex to narrow the page search, verify the best candidate multimodally when the active provider supports local image inspection, and return the chosen image through the existing Telegram file-delivery path.
For long-running work, agents can emit bounded Telegram progress updates before the final answer instead of staying silent for the whole run, choosing when to send `started`, `progress`, `milestone`, `warning`, `needs_input`, or `completed` events.
If a provider runtime fails because of auth, timeout, missing CLI setup, or another execution error, OpenColab sends a Telegram error reply instead of silently retrying the same message forever.

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

Telegram slash-menu aliases (for `/` popup command list):

- `/project_list`
- `/project_create <project_id>`
- `/project_use <project_id>`
- `/agent_list`
- `/agent_create <agent_id>`
- `/agent_use <agent_id>`
- `/session_reset`

## Agent Contract

Each agent directory must include:

- `AGENTS.md`
- `BOOTSTRAP.md`
- `IDENTITY.md`
- `ALMA.md`
- `TOOLS.md` (agent-local tooling notes, additions, and overrides)
- `USER.md`
- `TODO.md` (active plan and task list)
- `MEMORY.md` (long-term memory only)
- `SKILLS/` (agent-local skills for that agent only)

`AGENTS.md` is initialized from built-in template folders: the fixed lead agent `professor` uses `src/agent-templates/professor/`, the built-in beginner agent id `beginner` uses `src/agent-templates/beginner/`, additional agents use `src/agent-templates/specialist/`, and shared scaffolds fall back to `src/agent-templates/shared/`.
`BOOTSTRAP.md` is initialized from a built-in first-run guide to help the agent discover identity and preferences.
`IDENTITY.md` is initialized from a built-in identity scaffold.
`TOOLS.md` is initialized as a small local-notes scaffold for agent-specific tooling additions, overrides, and caveats.
In the current built-in layout, the role folders provide `AGENTS.md` overrides and `src/agent-templates/shared/` provides the shared `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, and `MEMORY.md` templates.
Built-in tool guidance and the default summaries for selected shared skills, including `fast-search`, `pro-search`, `deep-search`, `pageindex-grounded`, `pdf-figure-extract`, and `block-diagram`, are injected by OpenColab at prompt-build time, so repo upgrades can update them without overwriting local `TOOLS.md` edits.

Default layout:

- shared skill library: `projects/SKILLS/`
- lead agent `professor`: `projects/<project_id>/AGENTS/professor/`
- built-in beginner agent `beginner`: `projects/<project_id>/AGENTS/beginner/`
- additional specialist agents: `projects/<project_id>/AGENTS/<agent_id>/`

Naming guidance:

- keep `professor` as the fixed lead agent id
- use `beginner` when you want the built-in beginner-student template for naive questions, assumption checks, and plain-language explanations
- give additional agents memorable names that reflect their specialty or work style, such as `paperhound`, `labrat`, or `synthesizer`

Shared project skills:

- the shared skill library lives under `projects/SKILLS/`
- all agents in all projects share that same skill library
- built-in `fast-search`, `pro-search`, `deep-search`, `paper-summary`, `pageindex-grounded`, `pdf-figure-extract`, `nano-banana`, and `block-diagram` skills live there and are not replicated into each agent or project
- the paper search skills use `block-diagram` as their canonical companion-visual workflow for compact literature maps that show how selected papers connect
- `pageindex-grounded` is the local-first grounded QA workflow for already-downloaded papers; it keeps selection bounded, caches per-paper PageIndex trees under `research/pageindex/`, and is the right tool for exact follow-up questions after search or summary work is already done
- `pdf-figure-extract` is the local-first figure extraction workflow for already-downloaded papers; it uses PyMuPDF to export paper figures, can optionally reuse `research/pageindex/` to narrow the page search, and asks the active agent to verify the chosen image multimodally before sending it back when the provider supports local image inspection
- `block-diagram` is the deterministic shared skill for generating autonomous D2-based architecture and system diagrams as `.d2`, compact sketch-style `.svg`, and optional `.png` artifacts by default, with unlabeled arrows unless a label adds concrete meaning, optional LaTeX equation blocks when the diagram genuinely needs them, and clean output available on explicit request

Agent-local skills:

- each agent also has its own local `SKILLS/` directory inside the agent folder
- use `projects/<project_id>/AGENTS/<agent_id>/SKILLS/<skill_id>/SKILL.md` for skills unique to one agent
- shared skills and agent-local skills can coexist; agents should check both when choosing a workflow

Conversation history layout:

- current session logs: `<agent_path>/memory/Session/<session_id>/<YYYY-MM-DD>.jsonl`
- previous-day summary: `<agent_path>/memory/Daily/<YYYY-MM-DD>.md`
- reset active session from Telegram with `/session reset`
- conversation logs are no longer written under `.opencolab`

Prompt memory model:

- working memory: recent turns from the active session on the current UTC day
- recent episodic memory: only the previous UTC day summary
- long-term memory: curated stable facts in `MEMORY.md`

## Configuration

`opencolab.json` stores runtime state:

- active project id
- projects map
- per-project agents map
- per-agent provider config (`openai`, `anthropic`, `gemini`, `minimax`, or `xai`) including auth mode and runtime
- shared Telegram settings and pairing state

OpenColab stores the derived runtime, CLI command, and CLI args for each agent.
OpenAI and Gemini support both `api_key` and `oauth`. xAI uses `api_key` with `XAI_API_KEY` through the `pi` runtime.

Secret values are stored in `.env.local` and should not be committed to git.
`opencolab.json` stores only non-secret runtime state.

## Development

```bash
pnpm run check
pnpm run build
pnpm test
```
