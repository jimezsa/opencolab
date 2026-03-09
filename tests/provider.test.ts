import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderRuntimeEnv,
  getCanonicalProviderKeyEnvVar,
  getProviderSetupDefaults,
  normalizeProviderName
} from "../src/provider.js";

test("normalizeProviderName supports built-in providers and aliases", () => {
  assert.equal(normalizeProviderName("openai"), "openai");
  assert.equal(normalizeProviderName("codex"), "openai");
  assert.equal(normalizeProviderName("anthropic"), "anthropic");
  assert.equal(normalizeProviderName("claude_code"), "anthropic");
  assert.equal(normalizeProviderName("minimax"), "minimax");
  assert.equal(normalizeProviderName("unknown"), null);
});

test("provider defaults expose MiniMax through the Claude runtime", () => {
  const defaults = getProviderSetupDefaults("minimax");
  assert.equal(defaults.model, "MiniMax-M2.5");
  assert.equal(defaults.cliCommand, "claude");
  assert.deepEqual(defaults.cliArgs, [
    "-p",
    "{prompt}",
    "--model",
    "{model}",
    "--permission-mode",
    "bypassPermissions",
    "--add-dir",
    "{project_dir}"
  ]);
  assert.equal(getCanonicalProviderKeyEnvVar("minimax"), "MINIMAX_API_KEY");
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
