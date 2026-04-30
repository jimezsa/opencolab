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

test("repository ships the latex-paper-writer shared skill resources", () => {
  const skillDir = path.join(REPO_ROOT, "projects", "SKILLS", "latex-paper-writer");
  const skillDoc = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

  assert.match(skillDoc, /name: latex-paper-writer/);
  assert.match(skillDoc, /Git-version/);
  assert.match(skillDoc, /latexmk/);
  assert.equal(fs.existsSync(path.join(skillDir, "references", "conference-map.md")), true);
  assert.equal(fs.existsSync(path.join(skillDir, "references", "deep-research-integration.md")), true);
  assert.equal(fs.existsSync(path.join(skillDir, "scripts", "init_paper_workspace.py")), true);
  assert.equal(fs.existsSync(path.join(skillDir, "scripts", "git_checkpoint.py")), true);
  assert.equal(fs.existsSync(path.join(skillDir, "scripts", "build_pdf.sh")), true);
  assert.equal(fs.existsSync(path.join(skillDir, "scripts", "validate_latex.sh")), true);
  assert.equal(fs.existsSync(path.join(skillDir, "scripts", "make_results_table.py")), true);
  assert.equal(fs.existsSync(path.join(skillDir, "assets", "templates", "iclr", "main.tex")), true);
  assert.equal(fs.existsSync(path.join(skillDir, "assets", "templates", "generic-survey", "main.tex")), true);
});

test("repository ships renamed paper research shared skills", () => {
  for (const skillId of ["fast-research", "pro-research", "deep-research"]) {
    const skillDir = path.join(REPO_ROOT, "projects", "SKILLS", skillId);
    const skillDoc = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

    assert.match(skillDoc, new RegExp(`name: ${skillId}`));
  }
});

test("repository ships the autoresearch progress graph helper", () => {
  const skillDir = path.join(REPO_ROOT, "projects", "SKILLS", "autoresearch");
  const skillDoc = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

  assert.match(skillDoc, /plot_progress\.py/);
  assert.match(skillDoc, /--metric-column/);
  assert.equal(fs.existsSync(path.join(skillDir, "scripts", "plot_progress.py")), true);
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
