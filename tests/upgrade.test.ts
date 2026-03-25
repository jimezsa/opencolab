import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type UpgradeCommandRunner,
  upgradeOpenColab,
} from "../src/upgrade.js";

function createMinimalUpgradeRoot(prefix: string): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(rootDir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "dist", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: "opencolab" }),
    "utf8",
  );
  fs.writeFileSync(path.join(rootDir, "src", "cli.ts"), "export {};\n", "utf8");
  fs.writeFileSync(
    path.join(rootDir, "dist", "src", "cli.js"),
    "console.log('ok');\n",
    "utf8",
  );
  return rootDir;
}

test("upgradeOpenColab targets origin/main and falls back when frozen lockfile install fails", () => {
  const rootDir = createMinimalUpgradeRoot("opencolab-upgrade-success-");
  const calls: string[] = [];
  let revParseCount = 0;

  const runCommand: UpgradeCommandRunner = (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push(key);

    if (command === "git" && args[0] === "--version") {
      return { status: 0, stdout: "git version 2.42.0\n", stderr: "" };
    }
    if (command === "pnpm" && args[0] === "--version") {
      return { status: 0, stdout: "9.15.5\n", stderr: "" };
    }
    if (command === "git" && args.includes("branch") && args.includes("--show-current")) {
      return { status: 0, stdout: "feature/lab\n", stderr: "" };
    }
    if (command === "git" && args.includes("rev-parse")) {
      revParseCount += 1;
      return {
        status: 0,
        stdout: revParseCount === 1 ? "aaaa1111\n" : "bbbb2222\n",
        stderr: "",
      };
    }
    if (command === "git" && args.includes("status")) {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args.includes("show-ref")) {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "pnpm" && args[0] === "install" && args[1] === "--frozen-lockfile") {
      return { status: 1, stdout: "", stderr: "lockfile mismatch" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  try {
    const result = upgradeOpenColab(rootDir, {
      nodePath: process.execPath,
      runCommand,
    });

    assert.equal(result.previousBranch, "feature/lab");
    assert.equal(result.previousRevision, "aaaa1111");
    assert.equal(result.currentRevision, "bbbb2222");
    assert.equal(result.dependencyInstallMode, "fallback");

    assert.deepEqual(calls, [
      "git --version",
      "pnpm --version",
      `git -C ${rootDir} branch --show-current`,
      `git -C ${rootDir} rev-parse HEAD`,
      `git -C ${rootDir} status --porcelain --untracked-files=no`,
      `git -C ${rootDir} fetch origin main`,
      `git -C ${rootDir} show-ref --verify --quiet refs/heads/main`,
      `git -C ${rootDir} checkout main`,
      `git -C ${rootDir} pull --ff-only origin main`,
      "pnpm install --frozen-lockfile",
      "pnpm install",
      "pnpm run build",
      `${process.execPath} ${path.join(rootDir, "dist", "src", "cli.js")} --help`,
      `git -C ${rootDir} rev-parse HEAD`,
    ]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("upgradeOpenColab refuses to run with tracked git changes", () => {
  const rootDir = createMinimalUpgradeRoot("opencolab-upgrade-dirty-");

  const runCommand: UpgradeCommandRunner = (command, args) => {
    if (command === "git" && args[0] === "--version") {
      return { status: 0, stdout: "git version 2.42.0\n", stderr: "" };
    }
    if (command === "pnpm" && args[0] === "--version") {
      return { status: 0, stdout: "9.15.5\n", stderr: "" };
    }
    if (command === "git" && args.includes("branch") && args.includes("--show-current")) {
      return { status: 0, stdout: "main\n", stderr: "" };
    }
    if (command === "git" && args.includes("rev-parse")) {
      return { status: 0, stdout: "aaaa1111\n", stderr: "" };
    }
    if (command === "git" && args.includes("status")) {
      return { status: 0, stdout: " M src/cli.ts\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  try {
    assert.throws(
      () =>
        upgradeOpenColab(rootDir, {
          nodePath: process.execPath,
          runCommand,
        }),
      /clean tracked git worktree/,
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
