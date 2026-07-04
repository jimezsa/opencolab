import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCliInvocation,
  windowsExecutableCandidates
} from "../src/spawn-cli.js";

const DEFAULT_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];

test("windowsExecutableCandidates never selects the extension-less shim for a bare name", () => {
  const candidates = windowsExecutableCandidates(
    "C:\\Users\\me\\AppData\\Roaming\\npm\\claude",
    DEFAULT_PATHEXT
  );
  // The extension-less file is an npm Git-Bash shell shim, not a Windows exe.
  assert.ok(!candidates.includes("C:\\Users\\me\\AppData\\Roaming\\npm\\claude"));
  assert.ok(
    candidates.includes("C:\\Users\\me\\AppData\\Roaming\\npm\\claude.CMD")
  );
});

test("windowsExecutableCandidates honors an explicit extension", () => {
  const candidates = windowsExecutableCandidates(
    "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd",
    DEFAULT_PATHEXT
  );
  assert.deepEqual(candidates, [
    "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd"
  ]);
});

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
