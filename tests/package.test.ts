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
