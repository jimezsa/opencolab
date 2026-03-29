import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPackageUpgradeMessage,
  detectOpenColabInstallMode,
  isGitInstallRoot,
  resolveCurrentOpenColabInstall,
  resolveDefaultRuntimeRootDir,
  resolveRuntimeRootDir,
} from "../src/install.js";

function createPackageRoot(prefix: string, packageName = "opencolab"): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: packageName }),
    "utf8",
  );
  return rootDir;
}

test("resolveCurrentOpenColabInstall finds a git/source install from the entry script path", () => {
  const rootDir = createPackageRoot("opencolab-install-git-");
  fs.mkdirSync(path.join(rootDir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "dist", "src"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "src", "cli.ts"), "export {};\n", "utf8");
  fs.writeFileSync(path.join(rootDir, "dist", "src", "cli.js"), "export {};\n", "utf8");

  try {
    const install = resolveCurrentOpenColabInstall({
      entryScriptPath: path.join(rootDir, "dist", "src", "cli.js"),
      cwd: os.tmpdir(),
    });

    assert.equal(install.rootDir, rootDir);
    assert.equal(install.mode, "git");
    assert.equal(install.packageName, "opencolab");
    assert.equal(isGitInstallRoot(rootDir), true);
    assert.equal(detectOpenColabInstallMode(rootDir), "git");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("resolveCurrentOpenColabInstall detects a packaged install without git metadata", () => {
  const rootDir = createPackageRoot("opencolab-install-package-", "@acme/opencolab");
  fs.mkdirSync(path.join(rootDir, "dist", "src"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "dist", "src", "cli.js"), "export {};\n", "utf8");

  try {
    const install = resolveCurrentOpenColabInstall({
      entryScriptPath: path.join(rootDir, "dist", "src", "cli.js"),
      cwd: os.tmpdir(),
    });

    assert.equal(install.rootDir, rootDir);
    assert.equal(install.mode, "package");
    assert.equal(install.packageName, "@acme/opencolab");
    assert.equal(isGitInstallRoot(rootDir), false);
    assert.equal(detectOpenColabInstallMode(rootDir), "package");
    assert.deepEqual(buildPackageUpgradeMessage(install.packageName), [
      "This OpenColab install is package-based.",
      "Upgrade it with your package manager, for example: npm install -g @acme/opencolab@latest",
    ]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("resolveDefaultRuntimeRootDir uses the platform user runtime root", () => {
  assert.equal(
    resolveDefaultRuntimeRootDir({
      platform: "linux",
      homeDir: "/home/dev",
      env: {}
    }),
    "/home/dev/.opencolab"
  );
  assert.equal(
    resolveDefaultRuntimeRootDir({
      platform: "win32",
      homeDir: "C:\\Users\\Dev",
      env: { LOCALAPPDATA: "C:\\Users\\Dev\\AppData\\Local" }
    }),
    path.join("C:\\Users\\Dev\\AppData\\Local", "OpenColab", "root")
  );
});

test("resolveRuntimeRootDir honors OPENCOLAB_ROOT when set", () => {
  assert.equal(
    resolveRuntimeRootDir({
      cwd: "/tmp/work",
      env: { OPENCOLAB_ROOT: "/tmp/runtime-root" }
    }),
    "/tmp/runtime-root"
  );
});

test("resolveRuntimeRootDir defaults packaged installs to the user runtime root", () => {
  const installRoot = createPackageRoot("opencolab-runtime-root-package-", "@acme/opencolab");
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runtime-root-cwd-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runtime-root-home-"));

  try {
    const resolved = resolveRuntimeRootDir({
      cwd,
      entryScriptPath: path.join(installRoot, "dist", "src", "cli.js"),
      env: {},
      homeDir,
      platform: "linux"
    });

    assert.equal(resolved, path.join(homeDir, ".opencolab"));
  } finally {
    fs.rmSync(installRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("resolveRuntimeRootDir keeps the current directory for git/source checkouts", () => {
  const installRoot = createPackageRoot("opencolab-runtime-root-git-");
  fs.mkdirSync(path.join(installRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(installRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(installRoot, "src", "cli.ts"), "export {};\n", "utf8");
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runtime-root-git-cwd-"));

  try {
    const resolved = resolveRuntimeRootDir({
      cwd,
      entryScriptPath: path.join(installRoot, "dist", "src", "cli.js"),
      env: {},
      homeDir: os.tmpdir(),
      platform: "linux"
    });

    assert.equal(resolved, cwd);
  } finally {
    fs.rmSync(installRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("resolveRuntimeRootDir keeps an existing local runtime root for packaged installs", () => {
  const installRoot = createPackageRoot("opencolab-runtime-root-existing-", "@acme/opencolab");
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runtime-root-existing-cwd-"));
  fs.writeFileSync(path.join(cwd, "opencolab.json"), "{\"version\":1}\n", "utf8");

  try {
    const resolved = resolveRuntimeRootDir({
      cwd,
      entryScriptPath: path.join(installRoot, "dist", "src", "cli.js"),
      env: {},
      homeDir: os.tmpdir(),
      platform: "linux"
    });

    assert.equal(resolved, cwd);
  } finally {
    fs.rmSync(installRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
