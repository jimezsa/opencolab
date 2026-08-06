# PI Runtime Reasoning Effort Spec

## Goal

Expose native reasoning-effort selection for pi-backed providers, starting with
the OpenRouter DeepSeek V4 models.

Today reasoning effort is wired only for the `codex` runtime (`-c
model_reasoning_effort="<effort>"`) and the `claude` runtime (`--effort
<effort>`). Providers on the shared `pi` runtime (`xai`, `openrouter`, `kimi`)
expose no reasoning choice at all, even when the selected model supports it.

## Rationale

The whole chain already exists; pi is simply never told which level to use.

- OpenRouter accepts reasoning control for these models. `deepseek/deepseek-v4-pro`
  and `~deepseek/deepseek-v4-flash-latest` both list `reasoning` and
  `reasoning_effort` in `supported_parameters` on every endpoint.
- pi accepts `--thinking <off|minimal|low|medium|high|xhigh|max>`.
- pi's bundled OpenRouter catalog already describes the model as
  `reasoning: true` with `compat.thinkingFormat: "openrouter"` and
  `thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high",
  xhigh: "xhigh", max: null }`.
- pi serializes that as `reasoning: { effort: <mapped> }` on the OpenRouter
  request.

Without `--thinking`, pi applies its own default level (`medium`) and clamps it
upward to `high` for these models. The model therefore already reasons at `high`;
this spec adds explicit, visible control (notably `xhigh`) rather than turning
reasoning on.

## Scope

- `PROVIDER_REASONING_CAPABILITIES` gains an `openrouter` entry for
  `deepseek/deepseek-v4-pro` (`src/provider.ts`).
- `buildProviderInvocationArgs` gains a `pi` branch that injects `--thinking`
  (`src/provider.ts`).
- No changes to `runtime.setupModel`, the `--reasoning-effort` CLI flag, config
  normalization, ignite prompts, or the web/workflow display: all of those are
  already driven by the capability map and pick the new model up for free.
- No config migration. The flag is injected at invocation time and is never
  persisted into `cliArgs`.

## Supported Levels

Effective levels for `deepseek/deepseek-v4-pro` are `off`, `high`, and `xhigh`.
`ProviderReasoningEffort` has no `off` member, so OpenColab exposes:

- options: `high`, `xhigh`
- default: `high`

Levels outside that set must not be offered. pi never rejects an unsupported
level — `clampThinkingLevel` silently moves it (upward first, then downward), so
`low` and `medium` would land on `high` and `max` on `xhigh`. Offering them would
misreport what the run actually does.

## Invocation Rules

- The `pi` branch applies only when `provider.runtime === "pi"` and the
  configured `cliCommand` still matches the provider default, matching the guard
  the existing branches use.
- The branch applies only when `normalizeProviderReasoningEffort` accepts the
  stored effort for that provider/model pair, so pi-backed models without a
  capability entry are unaffected.
- `--thinking <effort>` must be inserted **before** the trailing
  `{user_message}` token of `PI_WORKSPACE_ARGS`, not appended after it. This
  mirrors how the anthropic branch inserts ahead of the `--` separator. pi's
  parser tolerates trailing flags today, but the positional message must stay
  last.
- Effort names pass through unchanged: `high` and `xhigh` are valid pi thinking
  levels, so no name translation layer is needed.

## Existing Agents

Agents already configured on an OpenRouter model keep `reasoningEffort`
undefined and continue to run at pi's default level until the user re-runs
`opencolab setup model` or ignite. This is intentional — no silent behavior
change on upgrade.

## Constraints

- `provider-agent.ts` sets `PI_OFFLINE=1`, so model capabilities come from the
  pi version installed on the execution host, not from a live catalog fetch.
  Verified against pi `0.83.0`.
- If the host's pi predates the DeepSeek V4 catalog entries, the id resolves via
  pi's custom-model-id fallback. `--thinking` still works there (the fallback
  forces `reasoning: true` and passes the level through), but the level is
  unclamped and unvalidated. Behavior is safe either way; only validation is
  lost.
- The OpenRouter provider default stays `openai/gpt-5.5`. No provider default
  changes.

## Follow-Ups (not in this change)

- `~deepseek/deepseek-v4-flash-latest`, offered in ignite since 0.2.12, is not
  present in pi `0.83.0`'s OpenRouter catalog (which ships
  `deepseek/deepseek-v4-flash`). It runs through the custom-model-id fallback
  with default context/max-token values. Confirm the intended id before giving
  it a capability entry.
- Every `xai` model offered in ignite is likewise absent from pi's `xai`
  catalog, which ships only `grok-4.3` and `grok-build-0.1`. The curated pi model
  lists have drifted from pi's catalog and deserve a separate audit.
- pi's `kimi-coding` catalog gives `k3` and `k3-256k` a `thinkingLevelMap` of
  `low | high | max`. The `pi` branch added here is provider-agnostic, so kimi
  needs only capability-map entries when wanted.

## Tests

- `tests/provider.test.ts`: extend the invocation-args test with an `openrouter`
  case asserting `--thinking` lands before `{user_message}`, plus a negative case
  for a pi-backed provider/model with no capability entry (args unchanged),
  alongside the existing gemini negative case.
- `tests/provider.test.ts`: assert `normalizeProviderReasoningEffort` accepts
  `high` and `xhigh` for `openrouter` / `deepseek/deepseek-v4-pro` and rejects
  `low`, `medium`, and `max`.
- `tests/ignite.test.ts`: any scripted answer array that selects the OpenRouter
  DeepSeek V4 Pro model gains a "Reasoning effort" prompt and must be reordered.

## Doc Updates

- `docs/spec.md`: add a requirement line next to the existing OpenAI and
  Anthropic reasoning-effort entries stating that OpenRouter
  `deepseek/deepseek-v4-pro` supports `high` and `xhigh`, defaulting to `high`,
  and that pi-backed reasoning effort is delivered as `pi --thinking <level>`.
- `README.md`: the reasoning-effort bullet already reads generically
  ("when the selected provider/model supports them") and needs no change; add an
  `opencolab setup model --provider openrouter ... --reasoning-effort xhigh`
  example alongside the existing ones.
- `CHANGELOG.md`: one `Added` entry under `[Unreleased]`.
