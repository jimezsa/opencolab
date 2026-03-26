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
