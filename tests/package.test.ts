import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

test("package metadata exposes the built CLI and required publish surface", () => {
  const packageJsonPath = path.join(REPO_ROOT, "package.json");
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    bin?: Record<string, string>;
    files?: string[];
    scripts?: Record<string, string>;
  };

  assert.equal(parsed.bin?.opencolab, "dist/src/cli.js");
  assert.deepEqual(parsed.files, ["dist/src", "projects/SKILLS"]);
  assert.equal(parsed.scripts?.prepack, "npm run build");
});

test("repository includes shell and PowerShell installer entrypoints", () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "install.sh")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "install.ps1")), true);
});

test("installer scripts expose the hacky clone flag and clone overrides", () => {
  const installSh = fs.readFileSync(path.join(REPO_ROOT, "install.sh"), "utf8");
  const installPs1 = fs.readFileSync(path.join(REPO_ROOT, "install.ps1"), "utf8");

  assert.match(installSh, /--hacky/);
  assert.match(installSh, /OPENCOLAB_CLONE_DIR/);
  assert.match(installSh, /\.opencolab/);
  assert.match(installSh, /install\.json/);
  assert.match(installPs1, /--hacky/);
  assert.match(installPs1, /OPENCOLAB_CLONE_DIR/);
  assert.match(installPs1, /\.opencolab/);
  assert.match(installPs1, /install\.json/);
});
