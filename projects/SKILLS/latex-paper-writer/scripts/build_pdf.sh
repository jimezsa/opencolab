#!/usr/bin/env bash
set -euo pipefail

ROOT="."
MAIN="main.tex"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root)
      ROOT="${2:?missing value for --root}"
      shift 2
      ;;
    --main)
      MAIN="${2:?missing value for --main}"
      shift 2
      ;;
    -h|--help)
      printf 'Usage: %s [--root DIR] [--main main.tex]\n' "$0"
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$ROOT" && pwd)"
BASE="${MAIN%.tex}"

if [ ! -f "$ROOT/$MAIN" ]; then
  printf 'Missing LaTeX entrypoint: %s\n' "$ROOT/$MAIN" >&2
  exit 2
fi

cd "$ROOT"

if command -v latexmk >/dev/null 2>&1; then
  latexmk -pdf -interaction=nonstopmode -halt-on-error "$MAIN"
elif command -v pdflatex >/dev/null 2>&1; then
  pdflatex -interaction=nonstopmode -halt-on-error "$MAIN"
  if [ -f "${BASE}.bcf" ] && command -v biber >/dev/null 2>&1; then
    biber "$BASE" || true
  elif [ -f "${BASE}.aux" ] && command -v bibtex >/dev/null 2>&1; then
    bibtex "$BASE" || true
  fi
  pdflatex -interaction=nonstopmode -halt-on-error "$MAIN"
  pdflatex -interaction=nonstopmode -halt-on-error "$MAIN"
else
  cat >&2 <<'EOF'
No LaTeX compiler found. Install latexmk through a local TeX distribution.

Examples:
  macOS full:       brew install --cask mactex
  macOS smaller:    brew install --cask basictex && sudo tlmgr update --self && sudo tlmgr install latexmk
  Debian/Ubuntu:    sudo apt-get update && sudo apt-get install -y latexmk texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended
  Fedora:           sudo dnf install latexmk texlive-scheme-medium
  Arch:             sudo pacman -S texlive-binextra texlive-latexrecommended texlive-latexextra
  Windows:          install MiKTeX or TeX Live and ensure latexmk is on PATH
EOF
  exit 127
fi

bash "$SCRIPT_DIR/validate_latex.sh" --root "$ROOT" --main "$MAIN"
printf 'PDF built: %s/%s.pdf\n' "$ROOT" "$BASE"

