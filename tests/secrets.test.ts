import test from "node:test";
import assert from "node:assert/strict";
import { resolveOpenAiOauthStatus } from "../src/secrets.js";

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
