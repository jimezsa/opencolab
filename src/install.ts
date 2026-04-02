import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeReadJson, writeJson } from "./utils.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_NAME = "opencolab";
const MANAGED_INSTALL_MANIFEST_VERSION = 1 as const;
const MANAGED_INSTALL_MANIFEST_RELATIVE_PATH = path.join(".opencolab", "install.json");

export type OpenColabInstallMode = "git" | "package";
export type ManagedOpenColabInstallMode = "package" | "clone";

export interface OpenColabInstall {
  rootDir: string;
  mode: OpenColabInstallMode;
  packageName: string;
}

export interface ManagedOpenColabInstallManifest {
  version: typeof MANAGED_INSTALL_MANIFEST_VERSION;
  manager: "one_link";
  installMode: ManagedOpenColabInstallMode;
  runtimeRoot: string;
  packageSpec: string | null;
  packagePrefix: string | null;
  sourceDir: string | null;
  repoUrl: string | null;
  branch: string | null;
  shimPath: string | null;
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

export function readOpenColabPackageNameAtRoot(rootDir: string): string | null {
  return readOpenColabPackageName(rootDir);
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

export function buildManagedInstallManifestPath(runtimeRoot: string): string {
  return path.join(runtimeRoot, MANAGED_INSTALL_MANIFEST_RELATIVE_PATH);
}

export function readManagedInstallManifest(runtimeRoot: string): ManagedOpenColabInstallManifest | null {
  const manifestPath = buildManagedInstallManifestPath(runtimeRoot);
  const raw = safeReadJson<Record<string, unknown> | null>(manifestPath, null);
  if (!raw || raw.manager !== "one_link") {
    return null;
  }

  const installMode =
    raw.installMode === "package" || raw.installMode === "clone"
      ? raw.installMode
      : null;
  if (!installMode) {
    return null;
  }

  return {
    version:
      raw.version === MANAGED_INSTALL_MANIFEST_VERSION
        ? MANAGED_INSTALL_MANIFEST_VERSION
        : MANAGED_INSTALL_MANIFEST_VERSION,
    manager: "one_link",
    installMode,
    runtimeRoot: asOptionalString(raw.runtimeRoot) ?? runtimeRoot,
    packageSpec: asOptionalString(raw.packageSpec),
    packagePrefix: asOptionalString(raw.packagePrefix),
    sourceDir: asOptionalString(raw.sourceDir),
    repoUrl: asOptionalString(raw.repoUrl),
    branch: asOptionalString(raw.branch),
    shimPath: asOptionalString(raw.shimPath),
  };
}

export function writeManagedInstallManifest(
  runtimeRoot: string,
  manifest: Omit<ManagedOpenColabInstallManifest, "version" | "manager" | "runtimeRoot"> & {
    runtimeRoot?: string;
  },
): ManagedOpenColabInstallManifest {
  const normalized: ManagedOpenColabInstallManifest = {
    version: MANAGED_INSTALL_MANIFEST_VERSION,
    manager: "one_link",
    installMode: manifest.installMode,
    runtimeRoot: manifest.runtimeRoot ?? runtimeRoot,
    packageSpec: manifest.packageSpec ?? null,
    packagePrefix: manifest.packagePrefix ?? null,
    sourceDir: manifest.sourceDir ?? null,
    repoUrl: manifest.repoUrl ?? null,
    branch: manifest.branch ?? null,
    shimPath: manifest.shimPath ?? null,
  };
  writeJson(buildManagedInstallManifestPath(runtimeRoot), normalized);
  return normalized;
}

export function resolveManagedInstallCliScriptPath(
  manifest: ManagedOpenColabInstallManifest,
): string | null {
  if (manifest.installMode === "clone") {
    if (!manifest.sourceDir) {
      return null;
    }
    return path.join(manifest.sourceDir, "dist", "src", "cli.js");
  }

  if (!manifest.packagePrefix) {
    return null;
  }
  const packageRoot = resolveManagedPackageRoot(manifest.packagePrefix, manifest.packageSpec);
  if (!packageRoot) {
    return null;
  }
  return path.join(packageRoot, "dist", "src", "cli.js");
}

export function resolveManagedPackageRoot(
  packagePrefix: string,
  packageSpec: string | null,
): string | null {
  const packageName = parsePackageNameFromSpec(packageSpec) ?? DEFAULT_PACKAGE_NAME;
  const packagePathParts = packageName.split("/");
  const candidates = [
    path.join(packagePrefix, "lib", "node_modules", ...packagePathParts),
    path.join(packagePrefix, "node_modules", ...packagePathParts),
  ];

  for (const candidate of candidates) {
    if (isOpenColabPackageRoot(candidate)) {
      return candidate;
    }
  }

  return null;
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

  if (hasExistingRuntimeState(cwd)) {
    return cwd;
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

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parsePackageNameFromSpec(packageSpec: string | null): string | null {
  const value = packageSpec?.trim();
  if (!value) {
    return null;
  }
  if (value.startsWith("@")) {
    const slash = value.indexOf("/");
    if (slash < 0) {
      return null;
    }
    const versionSeparator = value.indexOf("@", slash + 1);
    return versionSeparator === -1 ? value : value.slice(0, versionSeparator);
  }
  const versionSeparator = value.indexOf("@");
  return versionSeparator === -1 ? value : value.slice(0, versionSeparator);
}
