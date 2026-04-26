#!/usr/bin/env python3
"""Create a scoped Git checkpoint for a LaTeX paper workspace."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def git(cwd: Path, args: list[str], check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=check)


def toplevel(root: Path) -> Path:
    result = git(root, ["rev-parse", "--show-toplevel"])
    if result.returncode != 0:
        subprocess.run(["git", "-C", str(root), "init"], check=True)
        result = git(root, ["rev-parse", "--show-toplevel"], check=True)
    return Path(result.stdout.strip()).resolve()


def rel_to_top(root: Path, top: Path) -> str:
    root = root.resolve()
    top = top.resolve()
    try:
        rel = root.relative_to(top)
    except ValueError:
        print(f"Paper root {root} is not inside Git worktree {top}.", file=sys.stderr)
        raise SystemExit(2)
    return "." if str(rel) == "." else rel.as_posix()


def cached_files(top: Path) -> list[str]:
    result = git(top, ["diff", "--cached", "--name-only", "-z"], check=True)
    if not result.stdout:
        return []
    return [item for item in result.stdout.split("\0") if item]


def is_inside(rel_file: str, rel_root: str) -> bool:
    if rel_root == ".":
        return True
    return rel_file == rel_root or rel_file.startswith(rel_root.rstrip("/") + "/")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, help="Paper workspace root.")
    parser.add_argument("--message", required=True, help="Commit message.")
    parser.add_argument("--allow-existing-staged", action="store_true", help="Allow already staged files outside the paper root.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    if not root.exists():
        print(f"Paper root does not exist: {root}", file=sys.stderr)
        return 2

    top = toplevel(root)
    rel_root = rel_to_top(root, top)

    staged_before = cached_files(top)
    outside = [name for name in staged_before if not is_inside(name, rel_root)]
    if outside and not args.allow_existing_staged:
        print("Refusing to commit because unrelated files are already staged:", file=sys.stderr)
        for name in outside:
            print(f"  {name}", file=sys.stderr)
        return 3

    git(top, ["add", "--", rel_root], check=True)
    staged_after = [name for name in cached_files(top) if is_inside(name, rel_root)]
    if not staged_after:
        print("No paper-workspace changes to commit.")
        return 0

    commit = git(top, ["commit", "-m", args.message])
    if commit.returncode != 0:
        sys.stderr.write(commit.stderr)
        return commit.returncode

    head = git(top, ["rev-parse", "--short", "HEAD"], check=True).stdout.strip()
    print(f"Created paper checkpoint {head}: {args.message}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

