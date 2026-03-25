/**
 * OpenColab self-upgrade helpers.
 * Updates the current install to the latest origin/main, rebuilds, and verifies the build.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface UpgradeResult {
  previousBranch: string;
  previousRevision: string;
  currentRevision: string;
  dependencyInstallMode: "frozen_lockfile" | "fallback";
}

export interface UpgradeCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface UpgradeCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export type UpgradeCommandRunner = (
  command: string,
  args: string[],
  options?: UpgradeCommandOptions,
) => UpgradeCommandResult;

export function upgradeOpenColab(
  rootDir: string,
  options: {
    nodePath?: string;
    runCommand?: UpgradeCommandRunner;
  } = {},
): UpgradeResult {
  assertOpenColabInstallRoot(rootDir);

  const nodePath = options.nodePath ?? process.execPath;
  const runCommand = options.runCommand ?? defaultRunCommand;

  runCheckedCommand(runCommand, "git", ["--version"], {}, "verify git");
  runCheckedCommand(runCommand, "pnpm", ["--version"], {}, "verify pnpm");

  const previousBranch = runCheckedCommand(
    runCommand,
    "git",
    ["-C", rootDir, "branch", "--show-current"],
    {},
    "read current branch",
  ).stdout.trim();
  const previousRevision = runCheckedCommand(
    runCommand,
    "git",
    ["-C", rootDir, "rev-parse", "HEAD"],
    {},
    "read current revision",
  ).stdout.trim();
  const worktreeStatus = runCheckedCommand(
    runCommand,
    "git",
    ["-C", rootDir, "status", "--porcelain", "--untracked-files=no"],
    {},
    "check git worktree",
  ).stdout.trim();

  if (worktreeStatus) {
    throw new Error(
      "OpenColab upgrade requires a clean tracked git worktree. Commit, stash, or discard local changes first.",
    );
  }

  runCheckedCommand(
    runCommand,
    "git",
    ["-C", rootDir, "fetch", "origin", "main"],
    {},
    "fetch origin/main",
  );

  const localMainExists = runCommand(
    "git",
    ["-C", rootDir, "show-ref", "--verify", "--quiet", "refs/heads/main"],
    {},
  ).status === 0;

  if (localMainExists) {
    runCheckedCommand(
      runCommand,
      "git",
      ["-C", rootDir, "checkout", "main"],
      {},
      "switch to main",
    );
  } else {
    runCheckedCommand(
      runCommand,
      "git",
      ["-C", rootDir, "checkout", "-b", "main", "--track", "origin/main"],
      {},
      "create local main",
    );
  }

  runCheckedCommand(
    runCommand,
    "git",
    ["-C", rootDir, "pull", "--ff-only", "origin", "main"],
    {},
    "fast-forward local main",
  );

  let dependencyInstallMode: UpgradeResult["dependencyInstallMode"] =
    "frozen_lockfile";
  const frozenInstall = runCommand(
    "pnpm",
    ["install", "--frozen-lockfile"],
    { cwd: rootDir },
  );
  if (frozenInstall.status !== 0) {
    dependencyInstallMode = "fallback";
    runCheckedCommand(
      runCommand,
      "pnpm",
      ["install"],
      { cwd: rootDir },
      "install dependencies",
    );
  }

  runCheckedCommand(
    runCommand,
    "pnpm",
    ["run", "build"],
    { cwd: rootDir },
    "build project",
  );

  const builtCliPath = path.join(rootDir, "dist", "src", "cli.js");
  if (!fs.existsSync(builtCliPath)) {
    throw new Error(
      "Upgrade build completed without producing dist/src/cli.js.",
    );
  }

  runCheckedCommand(
    runCommand,
    nodePath,
    [builtCliPath, "--help"],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        OPENCOLAB_ROOT: rootDir,
      },
    },
    "run post-build smoke check",
  );

  const currentRevision = runCheckedCommand(
    runCommand,
    "git",
    ["-C", rootDir, "rev-parse", "HEAD"],
    {},
    "read upgraded revision",
  ).stdout.trim();

  return {
    previousBranch,
    previousRevision,
    currentRevision,
    dependencyInstallMode,
  };
}

function assertOpenColabInstallRoot(rootDir: string): void {
  const requiredPaths = [
    path.join(rootDir, ".git"),
    path.join(rootDir, "package.json"),
    path.join(rootDir, "src", "cli.ts"),
  ];

  for (const requiredPath of requiredPaths) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(
        `OpenColab upgrade requires an OpenColab git install root. Missing: ${requiredPath}`,
      );
    }
  }
}

function defaultRunCommand(
  command: string,
  args: string[],
  options: UpgradeCommandOptions = {},
): UpgradeCommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? undefined,
  };
}

function runCheckedCommand(
  runCommand: UpgradeCommandRunner,
  command: string,
  args: string[],
  options: UpgradeCommandOptions,
  label: string,
): UpgradeCommandResult {
  const result = runCommand(command, args, options);
  if (result.status === 0) {
    return result;
  }

  const detail =
    result.error?.message ||
    result.stderr.trim() ||
    result.stdout.trim() ||
    `Command failed: ${command} ${args.join(" ")}`;
  throw new Error(`${label}: ${detail}`);
}
