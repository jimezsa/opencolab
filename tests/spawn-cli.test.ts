import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  resolveCliInvocation,
  resolveShimScript,
  windowsExecutableCandidates
} from "../src/spawn-cli.js";

const DEFAULT_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];

function makeShimFixture(subdirs: string[]): {
  shimDir: string;
  scriptPath: string;
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-shim-"));
  // The shim itself lives in `shimDir`; the JS entry lives under subdirs.
  const shimDir = path.join(root, "npm");
  const scriptDir = path.join(shimDir, ...subdirs);
  fs.mkdirSync(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, "cli.js");
  fs.writeFileSync(scriptPath, "// entry\n");
  return { shimDir, scriptPath, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

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

test("resolveShimScript resolves a standard npm cmd-shim to its cli.js", () => {
  const { shimDir, scriptPath, cleanup } = makeShimFixture(["node_modules", "pkg"]);
  try {
    const text = `@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\pkg\\cli.js" %*\r\n`;
    assert.equal(resolveShimScript(text, shimDir), scriptPath);
  } finally {
    cleanup();
  }
});

test("resolveShimScript resolves a pnpm-style shim that traverses with ..", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-pnpm-"));
  try {
    const shimDir = path.join(root, "node_modules", ".bin");
    const pkgDir = path.join(root, "node_modules", "pkg");
    fs.mkdirSync(shimDir, { recursive: true });
    fs.mkdirSync(pkgDir, { recursive: true });
    const scriptPath = path.join(pkgDir, "cli.js");
    fs.writeFileSync(scriptPath, "// entry\n");
    const text = `node  "%~dp0\\..\\pkg\\cli.js" %*\r\n`;
    assert.equal(resolveShimScript(text, shimDir), scriptPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveShimScript handles a shim directory that contains spaces", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-space-"));
  try {
    const shimDir = path.join(root, "Daniela Garcia", "npm");
    const scriptDir = path.join(shimDir, "node_modules", "pkg");
    fs.mkdirSync(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, "cli.js");
    fs.writeFileSync(scriptPath, "// entry\n");
    const text = `"%dp0%\\node_modules\\pkg\\cli.js" %*`;
    assert.equal(resolveShimScript(text, shimDir), scriptPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveShimScript returns null when no referenced JS file exists", () => {
  const { shimDir, cleanup } = makeShimFixture(["node_modules", "pkg"]);
  try {
    const text = `"%dp0%\\node_modules\\pkg\\missing.js" %*`;
    assert.equal(resolveShimScript(text, shimDir), null);
  } finally {
    cleanup();
  }
});
