import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderRuntimeEnv,
  getCanonicalProviderKeyEnvVar,
  getProviderOauthSetupHint,
  getProviderSupportedAuthModes,
  getProviderSetupDefaults,
  normalizeProviderAuthMode,
  normalizeProviderName
} from "../src/provider.js";

test("normalizeProviderName supports built-in providers and aliases", () => {
  assert.equal(normalizeProviderName("openai"), "openai");
  assert.equal(normalizeProviderName("codex"), "openai");
  assert.equal(normalizeProviderName("anthropic"), "anthropic");
  assert.equal(normalizeProviderName("claude_code"), "anthropic");
  assert.equal(normalizeProviderName("gemini"), "gemini");
  assert.equal(normalizeProviderName("minimax"), "minimax");
  assert.equal(normalizeProviderName("xai"), "xai");
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
    "{prompt}",
    "--model",
    "{model}",
    "--permission-mode",
    "bypassPermissions",
    "--add-dir",
    "{project_dir}",
    "--add-dir",
    "{shared_skills_dir}"
  ]);
  assert.equal(getCanonicalProviderKeyEnvVar("minimax"), "MINIMAX_API_KEY");
});

test("OpenAI setup defaults support OAuth and API key auth modes", () => {
  const defaults = getProviderSetupDefaults("openai");
  assert.equal(defaults.runtime, "codex");
  assert.equal(defaults.authMode, "api_key");
  assert.deepEqual(defaults.cliArgs, [
    "exec",
    "--full-auto",
    "--add-dir",
    "{project_dir}",
    "--add-dir",
    "{shared_skills_dir}",
    "-"
  ]);
  assert.deepEqual(getProviderSupportedAuthModes("openai"), ["api_key", "oauth"]);
  assert.equal(normalizeProviderAuthMode("api-key"), "api_key");
  assert.equal(normalizeProviderAuthMode("oauth"), "oauth");
});

test("Gemini setup defaults use concrete model names and support OAuth", () => {
  const defaults = getProviderSetupDefaults("gemini");
  assert.equal(defaults.model, "gemini-2.5-pro");
  assert.equal(defaults.runtime, "gemini");
  assert.equal(defaults.cliCommand, "gemini");
  assert.equal(defaults.authMode, "api_key");
  assert.deepEqual(defaults.cliArgs, [
    "--prompt",
    "{prompt}",
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
    "gpt-5.3-codex"
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
