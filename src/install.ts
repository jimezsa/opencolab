import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_NAME = "opencolab";

export type OpenColabInstallMode = "git" | "package";

export interface OpenColabInstall {
  rootDir: string;
  mode: OpenColabInstallMode;
  packageName: string;
}

export interface RuntimeRootResolutionOptions {
  cwd?: string;
  entryScriptPath?: string | null;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  moduleDir?: string;
  platform?: NodeJS.Platform;
}

export function resolveCurrentOpenColabInstall(
  options: {
    entryScriptPath?: string | null;
    moduleDir?: string;
    cwd?: string;
  } = {},
): OpenColabInstall {
  const starts = [
    options.entryScriptPath?.trim() || null,
    options.moduleDir ?? MODULE_DIR,
    options.cwd ?? process.cwd(),
  ];

  for (const start of starts) {
    if (!start) {
      continue;
    }
    const rootDir = resolveOpenColabPackageRoot(start);
    if (!rootDir) {
      continue;
    }

    return {
      rootDir,
      mode: detectOpenColabInstallMode(rootDir),
      packageName: readOpenColabPackageName(rootDir) ?? DEFAULT_PACKAGE_NAME,
    };
  }

  throw new Error("Could not resolve the current OpenColab install root.");
}

export function detectOpenColabInstallMode(rootDir: string): OpenColabInstallMode {
  return isGitInstallRoot(rootDir) ? "git" : "package";
}

export function isGitInstallRoot(rootDir: string): boolean {
  return (
    isOpenColabPackageRoot(rootDir) &&
    fs.existsSync(path.join(rootDir, ".git")) &&
    fs.existsSync(path.join(rootDir, "src", "cli.ts"))
  );
}

export function buildPackageUpgradeMessage(packageName: string): string[] {
  return [
    "This OpenColab install is package-based.",
    `Upgrade it with your package manager, for example: npm install -g ${packageName}@latest`,
  ];
}

export function resolveDefaultRuntimeRootDir(
  options: Pick<RuntimeRootResolutionOptions, "env" | "homeDir" | "platform"> = {}
): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (localAppData) {
      return path.join(localAppData, "OpenColab", "root");
    }
    return path.join(homeDir, "AppData", "Local", "OpenColab", "root");
  }

  return path.join(homeDir, ".opencolab");
}

export function resolveRuntimeRootDir(options: RuntimeRootResolutionOptions = {}): string {
  const env = options.env ?? process.env;
  const configured = env.OPENCOLAB_ROOT?.trim();
  if (configured) {
    return configured;
  }

  const cwd = options.cwd ?? process.cwd();
  if (hasExistingRuntimeState(cwd)) {
    return cwd;
  }

  try {
    const install = resolveCurrentOpenColabInstall({
      entryScriptPath: options.entryScriptPath ?? process.argv[1],
      moduleDir: options.moduleDir,
      cwd
    });
    if (install.mode === "package") {
      return resolveDefaultRuntimeRootDir(options);
    }
  } catch {
    // Fall through to cwd when the current execution does not look like an installed package.
  }

  return cwd;
}

function resolveOpenColabPackageRoot(startPath: string): string | null {
  let current = normalizeSearchStart(startPath);
  while (true) {
    if (isOpenColabPackageRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function normalizeSearchStart(startPath: string): string {
  const resolved = path.resolve(startPath);
  if (!fs.existsSync(resolved)) {
    return path.dirname(resolved);
  }
  const stats = fs.statSync(resolved);
  return stats.isDirectory() ? resolved : path.dirname(resolved);
}

function isOpenColabPackageRoot(rootDir: string): boolean {
  const packageName = readOpenColabPackageName(rootDir);
  return packageName === DEFAULT_PACKAGE_NAME || packageName?.endsWith("/opencolab") === true;
}

function readOpenColabPackageName(rootDir: string): string | null {
  const packageJsonPath = path.join(rootDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
    };
    return typeof parsed.name === "string" && parsed.name.trim()
      ? parsed.name.trim()
      : null;
  } catch {
    return null;
  }
}

function hasExistingRuntimeState(rootDir: string): boolean {
  return (
    fs.existsSync(path.join(rootDir, "opencolab.json")) ||
    fs.existsSync(path.join(rootDir, ".env.local"))
  );
}
