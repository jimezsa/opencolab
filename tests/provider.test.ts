import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderInvocationArgs,
  buildProviderRuntimeEnv,
  getCanonicalProviderKeyEnvVar,
  getProviderDefaultReasoningEffort,
  getProviderOauthSetupHint,
  getProviderReasoningEffortOptions,
  getProviderRuntimeProviderName,
  getProviderSupportedAuthModes,
  getProviderSetupDefaults,
  normalizeProviderAuthMode,
  normalizeProviderName,
  normalizeProviderReasoningEffort,
  resolveProviderReasoningEffort
} from "../src/provider.js";

test("normalizeProviderName supports built-in providers and aliases", () => {
  assert.equal(normalizeProviderName("openai"), "openai");
  assert.equal(normalizeProviderName("codex"), "openai");
  assert.equal(normalizeProviderName("anthropic"), "anthropic");
  assert.equal(normalizeProviderName("claude_code"), "anthropic");
  assert.equal(normalizeProviderName("gemini"), "gemini");
  assert.equal(normalizeProviderName("minimax"), "minimax");
  assert.equal(normalizeProviderName("xai"), "xai");
  assert.equal(normalizeProviderName("openrouter"), "openrouter");
  assert.equal(normalizeProviderName("kimi"), "kimi");
  assert.equal(normalizeProviderName("kimi-coding"), "kimi");
  assert.equal(normalizeProviderName("unknown"), null);
});

test("provider defaults expose MiniMax through the Claude runtime", () => {
  const defaults = getProviderSetupDefaults("minimax");
  assert.equal(defaults.model, "MiniMax-M2.5");
  assert.equal(defaults.runtime, "claude");
  assert.equal(defaults.cliCommand, "claude");
  assert.equal(defaults.authMode, "api_key");
  assert.deepEqual(defaults.cliArgs, [
    "-p",
    "--verbose",
    "--output-format",
    "stream-json",
    "--model",
    "{model}",
    "--permission-mode",
    "bypassPermissions",
    "--add-dir",
    "{project_dir}",
    "--add-dir",
    "{shared_skills_dir}",
    "--",
    "{prompt}"
  ]);
  assert.equal(getCanonicalProviderKeyEnvVar("minimax"), "MINIMAX_API_KEY");
});

test("OpenAI setup defaults support OAuth and API key auth modes", () => {
  const defaults = getProviderSetupDefaults("openai");
  assert.equal(defaults.model, "gpt-5.5");
  assert.equal(defaults.runtime, "codex");
  assert.equal(defaults.authMode, "api_key");
  assert.deepEqual(defaults.cliArgs, [
    "-a",
    "never",
    "exec",
    "--json",
    "--output-last-message",
    "{output_file}",
    "--sandbox",
    "danger-full-access",
    "--add-dir",
    "{project_dir}",
    "--add-dir",
    "{shared_skills_dir}",
    "-"
  ]);
  assert.deepEqual(getProviderSupportedAuthModes("openai"), ["api_key", "oauth"]);
  assert.deepEqual(getProviderReasoningEffortOptions("openai", "gpt-5.5"), [
    "low",
    "medium",
    "high",
    "xhigh"
  ]);
  assert.equal(getProviderDefaultReasoningEffort("openai", "gpt-5.5"), "high");
  assert.equal(normalizeProviderAuthMode("api-key"), "api_key");
  assert.equal(normalizeProviderAuthMode("oauth"), "oauth");
});

test("Anthropic setup defaults support OAuth on the Claude runtime", () => {
  const defaults = getProviderSetupDefaults("anthropic");
  assert.equal(defaults.model, "claude-opus-4-7");
  assert.equal(defaults.runtime, "claude");
  assert.equal(defaults.cliCommand, "claude");
  assert.equal(defaults.authMode, "api_key");
  assert.deepEqual(defaults.cliArgs, [
    "-p",
    "--verbose",
    "--output-format",
    "stream-json",
    "--model",
    "{model}",
    "--permission-mode",
    "bypassPermissions",
    "--add-dir",
    "{project_dir}",
    "--add-dir",
    "{shared_skills_dir}",
    "--",
    "{prompt}"
  ]);
  assert.deepEqual(getProviderSupportedAuthModes("anthropic"), ["api_key", "oauth"]);
  assert.deepEqual(getProviderReasoningEffortOptions("anthropic", "claude-opus-4-6"), [
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
  ]);
  assert.equal(getProviderDefaultReasoningEffort("anthropic", "claude-opus-4-6"), "high");
  assert.equal(
    getProviderOauthSetupHint("anthropic", "claude"),
    "Run 'claude auth login' if needed."
  );
});

test("Gemini setup defaults use concrete model names and support OAuth", () => {
  const defaults = getProviderSetupDefaults("gemini");
  assert.equal(defaults.model, "gemini-3.5-flash");
  assert.equal(defaults.runtime, "gemini");
  assert.equal(defaults.cliCommand, "gemini");
  assert.equal(defaults.authMode, "api_key");
  assert.deepEqual(defaults.cliArgs, [
    "--prompt",
    "{prompt}",
    "--output-format",
    "stream-json",
    "--model",
    "{model}",
    "--yolo"
  ]);
  assert.deepEqual(getProviderSupportedAuthModes("gemini"), ["api_key", "oauth"]);
  assert.equal(getCanonicalProviderKeyEnvVar("gemini"), "GEMINI_API_KEY");
  assert.equal(
    getProviderOauthSetupHint("gemini", "gemini"),
    "Run 'gemini' and choose Login with Google if needed."
  );
});

test("xAI setup defaults use the pi runtime", () => {
  const defaults = getProviderSetupDefaults("xai");
  assert.equal(defaults.model, "grok-4-fast-non-reasoning");
  assert.equal(defaults.runtime, "pi");
  assert.equal(defaults.cliCommand, "pi");
  assert.equal(defaults.authMode, "api_key");
  assert.deepEqual(defaults.cliArgs, [
    "--mode",
    "json",
    "--print",
    "--provider",
    "{runtime_provider}",
    "--model",
    "{model}",
    "--append-system-prompt",
    "{system_prompt}",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--tools",
    "read,bash,edit,write,grep,find,ls",
    "{user_message}"
  ]);
  assert.deepEqual(getProviderSupportedAuthModes("xai"), ["api_key"]);
  assert.equal(getCanonicalProviderKeyEnvVar("xai"), "XAI_API_KEY");
});

test("OpenRouter setup defaults use the pi runtime", () => {
  const defaults = getProviderSetupDefaults("openrouter");
  assert.equal(defaults.model, "openai/gpt-5.5");
  assert.equal(defaults.runtime, "pi");
  assert.equal(defaults.cliCommand, "pi");
  assert.equal(defaults.authMode, "api_key");
  assert.deepEqual(defaults.cliArgs, [
    "--mode",
    "json",
    "--print",
    "--provider",
    "{runtime_provider}",
    "--model",
    "{model}",
    "--append-system-prompt",
    "{system_prompt}",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--tools",
    "read,bash,edit,write,grep,find,ls",
    "{user_message}"
  ]);
  assert.deepEqual(getProviderSupportedAuthModes("openrouter"), ["api_key"]);
  assert.equal(getCanonicalProviderKeyEnvVar("openrouter"), "OPENROUTER_API_KEY");
  assert.equal(getProviderRuntimeProviderName("openrouter"), "openrouter");
});

test("Kimi setup defaults use the pi runtime and kimi-coding provider id", () => {
  const defaults = getProviderSetupDefaults("kimi");
  assert.equal(defaults.model, "k2p5");
  assert.equal(defaults.runtime, "pi");
  assert.equal(defaults.cliCommand, "pi");
  assert.equal(defaults.authMode, "api_key");
  assert.deepEqual(defaults.cliArgs, [
    "--mode",
    "json",
    "--print",
    "--provider",
    "{runtime_provider}",
    "--model",
    "{model}",
    "--append-system-prompt",
    "{system_prompt}",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--tools",
    "read,bash,edit,write,grep,find,ls",
    "{user_message}"
  ]);
  assert.deepEqual(getProviderSupportedAuthModes("kimi"), ["api_key"]);
  assert.equal(getCanonicalProviderKeyEnvVar("kimi"), "KIMI_API_KEY");
  assert.equal(getProviderRuntimeProviderName("kimi"), "kimi-coding");
});

test("provider reasoning helpers validate only supported native values", () => {
  assert.equal(normalizeProviderReasoningEffort("openai", "gpt-5.5", "high"), "high");
  assert.equal(normalizeProviderReasoningEffort("openai", "gpt-5.5", "max"), null);
  assert.equal(normalizeProviderReasoningEffort("anthropic", "claude-opus-4-6", "xhigh"), "xhigh");
  assert.equal(normalizeProviderReasoningEffort("anthropic", "claude-opus-4-6", "max"), "max");
  assert.equal(normalizeProviderReasoningEffort("gemini", "gemini-2.5-pro", "high"), null);
  assert.equal(resolveProviderReasoningEffort("openai", "gpt-5.5", undefined, undefined), "high");
  assert.equal(resolveProviderReasoningEffort("anthropic", "claude-opus-4-6", "high"), "high");
  assert.equal(resolveProviderReasoningEffort("gemini", "gemini-2.5-pro", "high"), undefined);
});

test("provider invocation args add native reasoning flags when configured", () => {
  assert.deepEqual(
    buildProviderInvocationArgs({
      name: "openai",
      model: "gpt-5.5",
      runtime: "codex",
      cliCommand: "codex",
      cliArgs: [
        "-a",
        "never",
        "exec",
        "--sandbox",
        "danger-full-access",
        "--add-dir",
        "{project_dir}",
        "-"
      ],
      authMode: "api_key",
      reasoningEffort: "xhigh"
    }),
    [
      "-a",
      "never",
      "exec",
      "-c",
      'model_reasoning_effort="xhigh"',
      "--sandbox",
      "danger-full-access",
      "--add-dir",
      "{project_dir}",
      "-"
    ]
  );

  assert.deepEqual(
    buildProviderInvocationArgs({
      name: "anthropic",
      model: "claude-opus-4-6",
      runtime: "claude",
      cliCommand: "claude",
      cliArgs: [
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--model",
        "{model}",
        "--permission-mode",
        "bypassPermissions",
        "--add-dir",
        "{project_dir}",
        "--add-dir",
        "{shared_skills_dir}",
        "--",
        "{prompt}"
      ],
      authMode: "api_key",
      reasoningEffort: "max"
    }),
    [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}",
      "--effort",
      "max",
      "--",
      "{prompt}"
    ]
  );

  assert.deepEqual(
    buildProviderInvocationArgs({
      name: "gemini",
      model: "gemini-2.5-pro",
      runtime: "gemini",
      cliCommand: "gemini",
      cliArgs: ["--prompt", "{prompt}"],
      authMode: "api_key",
      reasoningEffort: "high"
    }),
    ["--prompt", "{prompt}"]
  );
});

test("MiniMax runtime env uses the Anthropic-compatible gateway without leaking parent Anthropic settings", () => {
  const env = buildProviderRuntimeEnv(
    {
      PATH: process.env.PATH,
      ANTHROPIC_API_KEY: "stale-key",
      ANTHROPIC_AUTH_TOKEN: "stale-token",
      ANTHROPIC_BASE_URL: "https://api.anthropic.com"
    },
    "minimax",
    "api_key",
    "minimax_test_key",
    "MiniMax-M2.5"
  );

  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, "minimax_test_key");
  assert.equal(env.ANTHROPIC_BASE_URL, "https://api.minimax.io/anthropic");
  assert.equal(env.ANTHROPIC_MODEL, "MiniMax-M2.5");
  assert.equal(env.ANTHROPIC_SMALL_FAST_MODEL, "MiniMax-M2.5");
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "MiniMax-M2.5");
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, "MiniMax-M2.5");
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "MiniMax-M2.5");
  assert.equal(env.API_TIMEOUT_MS, "3000000");
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
});

test("Anthropic runtime env clears MiniMax-specific Claude gateway overrides", () => {
  const env = buildProviderRuntimeEnv(
    {
      ANTHROPIC_AUTH_TOKEN: "stale-token",
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      ANTHROPIC_MODEL: "MiniMax-M2.5",
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1"
    },
    "anthropic",
    "api_key",
    "anthropic_test_key",
    "claude-sonnet-4-5"
  );

  assert.equal(env.ANTHROPIC_API_KEY, "anthropic_test_key");
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.ANTHROPIC_MODEL, undefined);
  assert.equal(env.API_TIMEOUT_MS, undefined);
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, undefined);
});

test("Anthropic OAuth runtime env clears Claude API key and gateway overrides", () => {
  const env = buildProviderRuntimeEnv(
    {
      ANTHROPIC_API_KEY: "stale-key",
      ANTHROPIC_AUTH_TOKEN: "stale-token",
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      PATH: process.env.PATH
    },
    "anthropic",
    "oauth",
    null,
    "claude-opus-4-6"
  );

  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.API_TIMEOUT_MS, undefined);
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, undefined);
});

test("Gemini OAuth runtime env clears Google and Gemini key vars and injects no API key", () => {
  const env = buildProviderRuntimeEnv(
    {
      GEMINI_API_KEY: "stale-gemini-key",
      GOOGLE_API_KEY: "stale-google-key",
      GOOGLE_GENAI_USE_VERTEXAI: "true",
      GOOGLE_CLOUD_PROJECT: "stale-project",
      GOOGLE_CLOUD_LOCATION: "stale-location",
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/stale-creds.json",
      PATH: process.env.PATH
    },
    "gemini",
    "oauth",
    null,
    "gemini-2.5-pro"
  );

  assert.equal(env.GEMINI_API_KEY, undefined);
  assert.equal(env.GOOGLE_API_KEY, undefined);
  assert.equal(env.GOOGLE_GENAI_USE_VERTEXAI, undefined);
  assert.equal(env.GOOGLE_CLOUD_PROJECT, undefined);
  assert.equal(env.GOOGLE_CLOUD_LOCATION, undefined);
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
});

test("OpenAI OAuth runtime env clears OPENAI_API_KEY and injects no API key", () => {
  const env = buildProviderRuntimeEnv(
    {
      OPENAI_API_KEY: "stale-key",
      PATH: process.env.PATH
    },
    "openai",
    "oauth",
    null,
    "gpt-5.5"
  );

  assert.equal(env.OPENAI_API_KEY, undefined);
});

test("xAI runtime env clears stale XAI_API_KEY values before injecting the selected credential", () => {
  const env = buildProviderRuntimeEnv(
    {
      XAI_API_KEY: "stale-key",
      PATH: process.env.PATH
    },
    "xai",
    "api_key",
    "xai_test_key",
    "grok-4-fast-non-reasoning"
  );

  assert.equal(env.XAI_API_KEY, "xai_test_key");
});

test("OpenRouter runtime env clears stale OPENROUTER_API_KEY values before injecting the selected credential", () => {
  const env = buildProviderRuntimeEnv(
    {
      OPENROUTER_API_KEY: "stale-key",
      PATH: process.env.PATH
    },
    "openrouter",
    "api_key",
    "openrouter_test_key",
    "openai/gpt-5.5"
  );

  assert.equal(env.OPENROUTER_API_KEY, "openrouter_test_key");
});

test("Kimi runtime env clears stale KIMI_API_KEY values before injecting the selected credential", () => {
  const env = buildProviderRuntimeEnv(
    {
      KIMI_API_KEY: "stale-key",
      PATH: process.env.PATH
    },
    "kimi",
    "api_key",
    "kimi_test_key",
    "k2p5"
  );

  assert.equal(env.KIMI_API_KEY, "kimi_test_key");
});
