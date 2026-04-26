#!/usr/bin/env python3
"""Initialize a Git-aware LaTeX paper workspace from bundled templates."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
TEMPLATES_DIR = SKILL_ROOT / "assets" / "templates"

DEFAULT_SECTIONS = {
    "generic-survey": [
        ("executive_summary.tex", "\\section*{Executive Summary}\n\nTODO: Summarize the main conclusions and confidence limits.\n"),
        ("scope_and_corpus.tex", "\\section{Scope and Corpus}\n\nTODO: Describe the search scope, included papers, and exclusions.\n"),
        ("taxonomy.tex", "\\section{Taxonomy}\n\nTODO: Organize the main method families.\n"),
        ("method_comparison.tex", "\\section{Method Comparison}\n\nTODO: Compare methods with cited evidence.\n"),
        ("evidence_table.tex", "\\section{Evidence Table}\n\nTODO: Include or input a generated comparison table.\n"),
        ("open_problems.tex", "\\section{Open Problems}\n\nTODO: List unresolved questions and limitations in the corpus.\n"),
        ("conclusion.tex", "\\section{Conclusion}\n\nTODO: Close with grounded takeaways.\n"),
    ],
    "generic-technical-report": [
        ("summary.tex", "\\section*{Summary}\n\nTODO: State the core result or recommendation.\n"),
        ("background.tex", "\\section{Background}\n\nTODO: Add relevant context.\n"),
        ("system_or_method.tex", "\\section{System or Method}\n\nTODO: Describe the system, method, or experiment setup.\n"),
        ("evidence_and_experiments.tex", "\\section{Evidence and Experiments}\n\nTODO: Report evidence, metrics, or observations.\n"),
        ("recommendations.tex", "\\section{Recommendations}\n\nTODO: List concrete next steps.\n"),
        ("limitations.tex", "\\section{Limitations}\n\nTODO: State limitations and missing evidence.\n"),
    ],
}

PAPER_SECTIONS = [
    ("abstract.tex", "TODO: Write a concise abstract with the problem, method, evidence, and result.\n"),
    ("introduction.tex", "\\section{Introduction}\n\nTODO: Motivate the problem and summarize contributions.\n"),
    ("related_work.tex", "\\section{Related Work}\n\nTODO: Position the work with verified citations.\n"),
    ("method.tex", "\\section{Method}\n\nTODO: Describe the method and include equations or diagrams when useful.\n"),
    ("experiments.tex", "\\section{Experiments}\n\nTODO: Describe datasets, baselines, metrics, and results.\n"),
    ("limitations.tex", "\\section{Limitations}\n\nTODO: State known limitations and threats to validity.\n"),
    ("conclusion.tex", "\\section{Conclusion}\n\nTODO: Summarize the contribution and future work.\n"),
]

GITIGNORE_BLOCK = """# LaTeX build byproducts
*.aux
*.bbl
*.bcf
*.blg
*.fdb_latexmk
*.fls
*.log
*.out
*.run.xml
*.synctex.gz
*.toc
*.xdv
_minted-*/

# Local editor and OS files
.DS_Store
Thumbs.db
"""


def run_git(cwd: Path, args: list[str], check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        check=check,
        capture_output=True,
        text=True,
    )


def is_git_worktree(path: Path) -> bool:
    result = run_git(path, ["rev-parse", "--is-inside-work-tree"])
    return result.returncode == 0 and result.stdout.strip() == "true"


def git_toplevel(path: Path) -> str | None:
    result = run_git(path, ["rev-parse", "--show-toplevel"])
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def copy_template(template_dir: Path, output_dir: Path, replacements: dict[str, str], overwrite: bool) -> None:
    for src in template_dir.rglob("*"):
        rel = src.relative_to(template_dir)
        dest = output_dir / rel
        if src.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
            continue
        if dest.exists() and not overwrite:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        if dest.suffix.lower() in {".tex", ".bib", ".md", ".sty", ".cls"}:
            text = dest.read_text(encoding="utf-8")
            for key, value in replacements.items():
                text = text.replace("{{" + key + "}}", value)
                text = text.replace("{{{" + key + "}}}", value)
            dest.write_text(text, encoding="utf-8")


def ensure_sections(output_dir: Path, template: str) -> None:
    sections_dir = output_dir / "sections"
    sections_dir.mkdir(parents=True, exist_ok=True)
    section_defs = DEFAULT_SECTIONS.get(template, PAPER_SECTIONS)
    for name, content in section_defs:
        path = sections_dir / name
        if not path.exists():
            path.write_text(content, encoding="utf-8")


def ensure_support_files(output_dir: Path) -> None:
    (output_dir / "figures").mkdir(parents=True, exist_ok=True)
    (output_dir / "tables").mkdir(parents=True, exist_ok=True)
    bib = output_dir / "references.bib"
    if not bib.exists():
        bib.write_text(
            "@article{placeholder2026paper,\n"
            "  title = {Placeholder Citation},\n"
            "  author = {Author, Example},\n"
            "  journal = {Replace with verified source metadata},\n"
            "  year = {2026}\n"
            "}\n",
            encoding="utf-8",
        )
    gitignore = output_dir / ".gitignore"
    if gitignore.exists():
        existing = gitignore.read_text(encoding="utf-8")
        if "# LaTeX build byproducts" not in existing:
            gitignore.write_text(existing.rstrip() + "\n\n" + GITIGNORE_BLOCK, encoding="utf-8")
    else:
        gitignore.write_text(GITIGNORE_BLOCK, encoding="utf-8")


def ensure_git(output_dir: Path, dedicated_git: bool, no_git: bool) -> None:
    if no_git:
        print("Git initialization skipped by --no-git.")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    if dedicated_git:
        if not (output_dir / ".git").exists():
            subprocess.run(["git", "-C", str(output_dir), "init"], check=True)
        print(f"Using dedicated Git repository: {output_dir}")
        return

    if is_git_worktree(output_dir):
        print(f"Using existing Git worktree: {git_toplevel(output_dir)}")
        return

    subprocess.run(["git", "-C", str(output_dir), "init"], check=True)
    print(f"Initialized Git repository: {output_dir}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", default="generic-paper", help="Template directory name.")
    parser.add_argument("--output", required=True, help="Paper workspace directory.")
    parser.add_argument("--title", default="Untitled Scientific Paper")
    parser.add_argument("--author", default="OpenColab")
    parser.add_argument("--venue", default="Generic")
    parser.add_argument("--date", default=r"\today")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing template files.")
    parser.add_argument("--dedicated-git", action="store_true", help="Initialize a Git repo in the paper folder even inside a parent worktree.")
    parser.add_argument("--no-git", action="store_true", help="Skip Git initialization.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    template = args.template.strip()
    template_dir = TEMPLATES_DIR / template
    if not template_dir.is_dir():
        available = ", ".join(sorted(p.name for p in TEMPLATES_DIR.iterdir() if p.is_dir()))
        print(f"Unknown template '{template}'. Available templates: {available}", file=sys.stderr)
        return 2

    output_dir = Path(args.output).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    replacements = {
        "TITLE": args.title,
        "AUTHOR": args.author,
        "VENUE": args.venue,
        "DATE": args.date or date.today().isoformat(),
    }

    copy_template(template_dir, output_dir, replacements, args.overwrite)
    ensure_sections(output_dir, template)
    ensure_support_files(output_dir)
    ensure_git(output_dir, args.dedicated_git, args.no_git)

    print(f"Paper workspace ready: {output_dir}")
    print(f"Main LaTeX file: {output_dir / 'main.tex'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

