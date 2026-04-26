#!/usr/bin/env python3
"""Convert experiment results into a LaTeX table fragment."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any


SPECIALS = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}


def latex_escape(value: Any, precision: int) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        text = f"{value:.{precision}f}".rstrip("0").rstrip(".")
    else:
        text = str(value)
        if re.fullmatch(r"-?\d+\.\d+", text):
            text = f"{float(text):.{precision}f}".rstrip("0").rstrip(".")
    return "".join(SPECIALS.get(ch, ch) for ch in text)


def read_csv(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def read_json(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("rows"), list):
        data = data["rows"]
    if not isinstance(data, list):
        raise ValueError("JSON input must be an array of objects or an object with a rows array.")
    rows: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("Every JSON row must be an object.")
        rows.append(item)
    return rows


def read_markdown(path: Path) -> list[dict[str, Any]]:
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip().startswith("|")]
    if len(lines) < 2:
        return []
    headers = [cell.strip() for cell in lines[0].strip("|").split("|")]
    rows: list[dict[str, Any]] = []
    for line in lines[2:]:
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) == len(headers):
            rows.append(dict(zip(headers, cells)))
    return rows


def read_metric_log(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    pattern = re.compile(r"([A-Za-z_][A-Za-z0-9_.-]*)=([^\s,;]+)")
    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        pairs = pattern.findall(line)
        if pairs:
            row = {"line": index}
            row.update({key: value for key, value in pairs})
            rows.append(row)
    return rows


def read_rows(path: Path, fmt: str) -> list[dict[str, Any]]:
    selected = fmt
    if selected == "auto":
        suffix = path.suffix.lower()
        if suffix == ".csv":
            selected = "csv"
        elif suffix == ".json":
            selected = "json"
        elif suffix in {".md", ".markdown"}:
            selected = "markdown"
        else:
            selected = "log"

    if selected == "csv":
        return read_csv(path)
    if selected == "json":
        return read_json(path)
    if selected == "markdown":
        return read_markdown(path)
    if selected == "log":
        return read_metric_log(path)
    raise ValueError(f"Unknown format: {fmt}")


def columns_for(rows: list[dict[str, Any]], requested: str | None) -> list[str]:
    if requested:
        return [name.strip() for name in requested.split(",") if name.strip()]
    columns: list[str] = []
    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)
    return columns


def write_table(path: Path, rows: list[dict[str, Any]], columns: list[str], caption: str, label: str, precision: int) -> None:
    align = "l" * len(columns)
    lines = [
        r"\begin{table}[t]",
        r"\centering",
        r"\small",
        rf"\caption{{{latex_escape(caption, precision)}}}",
        rf"\label{{{latex_escape(label, precision)}}}",
        rf"\begin{{tabular}}{{{align}}}",
        r"\toprule",
        " & ".join(latex_escape(column.replace("_", " ").title(), precision) for column in columns) + r" \\",
        r"\midrule",
    ]
    for row in rows:
        lines.append(" & ".join(latex_escape(row.get(column, ""), precision) for column in columns) + r" \\")
    lines.extend([r"\bottomrule", r"\end{tabular}", r"\end{table}", ""])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="CSV, JSON, markdown table, or metric log input.")
    parser.add_argument("--output", required=True, help="Output .tex table fragment.")
    parser.add_argument("--format", default="auto", choices=["auto", "csv", "json", "markdown", "log"])
    parser.add_argument("--columns", help="Comma-separated column order.")
    parser.add_argument("--caption", default="Experiment results.")
    parser.add_argument("--label", default="tab:results")
    parser.add_argument("--precision", type=int, default=3)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    rows = read_rows(input_path, args.format)
    if not rows:
        print(f"No rows found in {input_path}.", file=sys.stderr)
        return 2
    columns = columns_for(rows, args.columns)
    write_table(Path(args.output), rows, columns, args.caption, args.label, args.precision)
    print(f"Wrote LaTeX table: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

