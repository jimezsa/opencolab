import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  removeSecretFromLocalEnv,
  resolveAnthropicOauthStatus,
  resolveOpenAiOauthStatus,
  resolveTelegramBotTokenFor,
  writeSecretToLocalEnv
} from "../src/secrets.js";

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

test("removeSecretFromLocalEnv deletes one key and leaves the rest intact", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-secret-remove-"));

  try {
    writeSecretToLocalEnv(tempDir, "TELEGRAM_BOT_TOKEN", "111:aaa");
    writeSecretToLocalEnv(tempDir, "TELEGRAM_BOT_TOKEN_BETA", "222:bbb");
    writeSecretToLocalEnv(tempDir, "OPENAI_API_KEY", "sk-test");

    assert.equal(removeSecretFromLocalEnv(tempDir, "TELEGRAM_BOT_TOKEN_BETA"), true);

    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envLocal.includes("TELEGRAM_BOT_TOKEN_BETA"), false);
    assert.equal(envLocal.includes("TELEGRAM_BOT_TOKEN=111:aaa"), true);
    assert.equal(envLocal.includes("OPENAI_API_KEY=sk-test"), true);
    assert.equal(process.env.TELEGRAM_BOT_TOKEN_BETA, undefined);

    // Removing an absent key is a no-op, not an error.
    assert.equal(removeSecretFromLocalEnv(tempDir, "NOT_PRESENT"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveTelegramBotTokenFor never falls back to another bot's token", () => {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "111:aaa";
  delete process.env.TELEGRAM_BOT_TOKEN_GAMMA;

  try {
    assert.equal(resolveTelegramBotTokenFor("TELEGRAM_BOT_TOKEN"), "111:aaa");
    assert.equal(resolveTelegramBotTokenFor("TELEGRAM_BOT_TOKEN_GAMMA"), null);
  } finally {
    if (previous === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = previous;
    }
  }
});
