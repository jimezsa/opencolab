import test from "node:test";
import assert from "node:assert/strict";
import { resolveAnthropicOauthStatus, resolveOpenAiOauthStatus } from "../src/secrets.js";

test("resolveOpenAiOauthStatus reports authenticated when codex login status is logged in", () => {
  const status = resolveOpenAiOauthStatus("codex", () => ({
    status: 0,
    stdout: "Logged in using ChatGPT",
    stderr: "",
    error: null
  }));

  assert.equal(status.authenticated, true);
});

test("resolveOpenAiOauthStatus reports unauthenticated when login status says not logged in", () => {
  const status = resolveOpenAiOauthStatus("codex", () => ({
    status: 1,
    stdout: "Not logged in",
    stderr: "",
    error: null
  }));

  assert.equal(status.authenticated, false);
});

test("resolveOpenAiOauthStatus reports command errors", () => {
  const status = resolveOpenAiOauthStatus("codex", () => ({
    status: null,
    stdout: "",
    stderr: "",
    error: new Error("spawn ENOENT")
  }));

  assert.equal(status.authenticated, false);
  assert.equal(status.detail, "spawn ENOENT");
});

test("resolveAnthropicOauthStatus reports authenticated when Claude Code has stored login", () => {
  const status = resolveAnthropicOauthStatus("claude", () => ({
    status: 0,
    stdout: '{"loggedIn":true,"authMethod":"oauth","apiProvider":"firstParty"}',
    stderr: "",
    error: null
  }));

  assert.equal(status.authenticated, true);
});

test("resolveAnthropicOauthStatus rejects API key auth for OAuth mode", () => {
  const status = resolveAnthropicOauthStatus("claude", () => ({
    status: 0,
    stdout:
      '{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty","apiKeySource":"ANTHROPIC_API_KEY"}',
    stderr: "",
    error: null
  }));

  assert.equal(status.authenticated, false);
  assert.equal(status.detail?.includes("ANTHROPIC_API_KEY"), true);
});

test("resolveAnthropicOauthStatus reports unauthenticated when Claude Code is logged out", () => {
  const status = resolveAnthropicOauthStatus("claude", () => ({
    status: 1,
    stdout: '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}',
    stderr: "",
    error: null
  }));

  assert.equal(status.authenticated, false);
});
