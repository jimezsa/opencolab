/**
 * OpenColab self-upgrade helpers.
 * Upgrades installer-managed package or clone installs, or a git/source checkout.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildPackageUpgradeMessage,
  isGitInstallRoot,
  readManagedInstallManifest,
  readOpenColabPackageNameAtRoot,
  resolveCurrentOpenColabInstall,
  resolveManagedInstallCliScriptPath,
  type ManagedOpenColabInstallManifest,
} from "./install.js";

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

export interface GitUpgradeResult {
  kind: "git" | "managed_clone";
  runtimeRootDir: string;
  installRootDir: string;
  cliScriptPath: string;
  previousBranch: string;
  previousRevision: string;
  currentRevision: string;
  dependencyInstallMode: "frozen_lockfile" | "fallback";
}

export interface ManagedPackageUpgradeResult {
  kind: "managed_package";
  runtimeRootDir: string;
  installRootDir: string;
  cliScriptPath: string;
  packageSpec: string;
}

export interface PackageUpgradeGuidanceResult {
  kind: "package_guidance";
  packageName: string;
  messageLines: string[];
}

export type UpgradeResult =
  | GitUpgradeResult
  | ManagedPackageUpgradeResult
  | PackageUpgradeGuidanceResult;

export function upgradeOpenColab(
  rootDir: string,
  options: {
    nodePath?: string;
    runCommand?: UpgradeCommandRunner;
    entryScriptPath?: string | null;
    moduleDir?: string;
  } = {},
): UpgradeResult {
  const nodePath = options.nodePath ?? process.execPath;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const manifest = readManagedInstallManifest(rootDir);
  if (manifest) {
    if (manifest.installMode === "package") {
      return upgradeManagedPackageInstall(manifest, nodePath, runCommand);
    }
    return upgradeGitLikeInstall(
      manifest.sourceDir ?? rootDir,
      manifest.runtimeRoot,
      "managed_clone",
      nodePath,
      runCommand,
    );
  }

  if (isGitInstallRoot(rootDir)) {
    return upgradeGitLikeInstall(rootDir, rootDir, "git", nodePath, runCommand);
  }

  const packageNameAtRoot = readOpenColabPackageNameAtRoot(rootDir);
  if (packageNameAtRoot) {
    return {
      kind: "package_guidance",
      packageName: packageNameAtRoot,
      messageLines: buildPackageUpgradeMessage(packageNameAtRoot),
    };
  }

  const install = resolveCurrentOpenColabInstall({
    entryScriptPath: options.entryScriptPath ?? process.argv[1],
    moduleDir: options.moduleDir,
    cwd: rootDir,
  });
  if (install.mode !== "git") {
    return {
      kind: "package_guidance",
      packageName: install.packageName,
      messageLines: buildPackageUpgradeMessage(install.packageName),
    };
  }

  return upgradeGitLikeInstall(install.rootDir, rootDir, "git", nodePath, runCommand);
}

function upgradeManagedPackageInstall(
  manifest: ManagedOpenColabInstallManifest,
  nodePath: string,
  runCommand: UpgradeCommandRunner,
): ManagedPackageUpgradeResult {
  const packagePrefix = manifest.packagePrefix?.trim();
  if (!packagePrefix) {
    throw new Error("Managed package install manifest is missing packagePrefix.");
  }

  runCheckedCommand(runCommand, "npm", ["--version"], {}, "verify npm");
  const packageSpec = manifest.packageSpec?.trim() || "opencolab@latest";
  runCheckedCommand(
    runCommand,
    "npm",
    ["install", "-g", "--prefix", packagePrefix, packageSpec],
    {},
    "upgrade managed package install",
  );

  const cliScriptPath = resolveManagedInstallCliScriptPath(manifest);
  if (!cliScriptPath || !fs.existsSync(cliScriptPath)) {
    throw new Error(
      "Managed package upgrade completed without producing a runnable dist/src/cli.js entrypoint.",
    );
  }

  runPostBuildSmokeCheck(runCommand, nodePath, cliScriptPath, manifest.runtimeRoot);

  return {
    kind: "managed_package",
    runtimeRootDir: manifest.runtimeRoot,
    installRootDir: path.dirname(path.dirname(path.dirname(cliScriptPath))),
    cliScriptPath,
    packageSpec,
  };
}

function upgradeGitLikeInstall(
  installRootDir: string,
  runtimeRootDir: string,
  kind: GitUpgradeResult["kind"],
  nodePath: string,
  runCommand: UpgradeCommandRunner,
): GitUpgradeResult {
  assertGitInstallRoot(installRootDir);

  runCheckedCommand(runCommand, "git", ["--version"], {}, "verify git");
  runCheckedCommand(runCommand, "pnpm", ["--version"], {}, "verify pnpm");

  const previousBranch = runCheckedCommand(
    runCommand,
    "git",
    ["-C", installRootDir, "branch", "--show-current"],
    {},
    "read current branch",
  ).stdout.trim();
  const previousRevision = runCheckedCommand(
    runCommand,
    "git",
    ["-C", installRootDir, "rev-parse", "HEAD"],
    {},
    "read current revision",
  ).stdout.trim();
  const worktreeStatus = runCheckedCommand(
    runCommand,
    "git",
    ["-C", installRootDir, "status", "--porcelain", "--untracked-files=no"],
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
    ["-C", installRootDir, "fetch", "origin", "main"],
    {},
    "fetch origin/main",
  );

  const localMainExists = runCommand(
    "git",
    ["-C", installRootDir, "show-ref", "--verify", "--quiet", "refs/heads/main"],
    {},
  ).status === 0;

  if (localMainExists) {
    runCheckedCommand(
      runCommand,
      "git",
      ["-C", installRootDir, "checkout", "main"],
      {},
      "switch to main",
    );
  } else {
    runCheckedCommand(
      runCommand,
      "git",
      ["-C", installRootDir, "checkout", "-b", "main", "--track", "origin/main"],
      {},
      "create local main",
    );
  }

  runCheckedCommand(
    runCommand,
    "git",
    ["-C", installRootDir, "pull", "--ff-only", "origin", "main"],
    {},
    "fast-forward local main",
  );

  let dependencyInstallMode: GitUpgradeResult["dependencyInstallMode"] = "frozen_lockfile";
  const frozenInstall = runCommand(
    "pnpm",
    ["install", "--frozen-lockfile"],
    { cwd: installRootDir },
  );
  if (frozenInstall.status !== 0) {
    dependencyInstallMode = "fallback";
    runCheckedCommand(
      runCommand,
      "pnpm",
      ["install"],
      { cwd: installRootDir },
      "install dependencies",
    );
  }

  runCheckedCommand(
    runCommand,
    "pnpm",
    ["run", "build"],
    { cwd: installRootDir },
    "build project",
  );

  const cliScriptPath = path.join(installRootDir, "dist", "src", "cli.js");
  if (!fs.existsSync(cliScriptPath)) {
    throw new Error(
      "Upgrade build completed without producing dist/src/cli.js.",
    );
  }

  runPostBuildSmokeCheck(runCommand, nodePath, cliScriptPath, runtimeRootDir, installRootDir);

  const currentRevision = runCheckedCommand(
    runCommand,
    "git",
    ["-C", installRootDir, "rev-parse", "HEAD"],
    {},
    "read upgraded revision",
  ).stdout.trim();

  return {
    kind,
    runtimeRootDir,
    installRootDir,
    cliScriptPath,
    previousBranch,
    previousRevision,
    currentRevision,
    dependencyInstallMode,
  };
}

function runPostBuildSmokeCheck(
  runCommand: UpgradeCommandRunner,
  nodePath: string,
  cliScriptPath: string,
  runtimeRootDir: string,
  cwd = runtimeRootDir,
): void {
  runCheckedCommand(
    runCommand,
    nodePath,
    [cliScriptPath, "--help"],
    {
      cwd,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        OPENCOLAB_ROOT: runtimeRootDir,
      },
    },
    "run post-build smoke check",
  );
}

function assertGitInstallRoot(rootDir: string): void {
  if (isGitInstallRoot(rootDir)) {
    return;
  }

  const requiredPaths = [
    path.join(rootDir, ".git"),
    path.join(rootDir, "package.json"),
    path.join(rootDir, "src", "cli.ts"),
  ];
  const missingPath = requiredPaths.find((requiredPath) => !fs.existsSync(requiredPath));
  if (missingPath) {
    throw new Error(
      `OpenColab upgrade requires a git/source install root. Missing: ${missingPath}`,
    );
  }

  throw new Error("OpenColab upgrade requires a git/source install root.");
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
