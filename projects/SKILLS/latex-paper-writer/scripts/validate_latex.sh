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

ROOT="$(cd "$ROOT" && pwd)"
BASE="${MAIN%.tex}"
PDF="$ROOT/${BASE}.pdf"
LOG="$ROOT/${BASE}.log"

if [ ! -s "$PDF" ]; then
  printf 'PDF was not produced or is empty: %s\n' "$PDF" >&2
  exit 3
fi

if [ -f "$LOG" ]; then
  if grep -Eq 'LaTeX Warning: Citation .* undefined|There were undefined citations|undefined references|Reference .* undefined' "$LOG"; then
    printf 'Warning: unresolved citations or references remain in %s\n' "$LOG" >&2
  fi
  if grep -Eq 'LaTeX Warning: File .* not found|No file .*\.bbl|Package .* Error|LaTeX Error' "$LOG"; then
    printf 'Warning: LaTeX log contains missing-file or package errors in %s\n' "$LOG" >&2
  fi
  if grep -Eq 'Overfull \\hbox|Overfull \\vbox' "$LOG"; then
    printf 'Warning: overfull boxes were reported in %s\n' "$LOG" >&2
  fi
fi

printf 'Validation passed: %s\n' "$PDF"
