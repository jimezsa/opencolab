import assert from "node:assert/strict";
import test from "node:test";
import { resolveCliInvocation } from "../src/spawn-cli.js";

test("resolveCliInvocation passes commands through unchanged on non-Windows", () => {
  if (process.platform === "win32") {
    return;
  }
  const invocation = resolveCliInvocation("claude", ["auth", "status", "--json"]);
  assert.equal(invocation.command, "claude");
  assert.deepEqual(invocation.args, ["auth", "status", "--json"]);
  assert.equal(invocation.options.windowsVerbatimArguments, undefined);
});

test("resolveCliInvocation copies args so callers cannot mutate shared state", () => {
  const args = ["-p", "hello"];
  const invocation = resolveCliInvocation("claude", args);
  assert.notEqual(invocation.args, args);
  assert.deepEqual(invocation.args, ["-p", "hello"]);
});
