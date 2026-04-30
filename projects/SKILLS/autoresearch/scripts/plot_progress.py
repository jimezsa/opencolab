#!/usr/bin/env python3
"""Render a Karpathy-style autoresearch progress plot from a results table."""

from __future__ import annotations

import argparse
import csv
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_KEPT_STATUSES = ("KEEP", "KEPT")
DEFAULT_SKIP_STATUSES = ("CRASH", "ERROR", "FAIL", "FAILED", "TIMEOUT", "OOM")
DEFAULT_EXCLUDED_METRIC_COLUMNS = {
    "commit",
    "description",
    "hash",
    "memory",
    "memory_gb",
    "notes",
    "status",
}


@dataclass(frozen=True)
class Experiment:
    x: float
    metric: float
    status: str
    description: str
    row_number: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", default="results.tsv", help="Delimited results table with a header.")
    parser.add_argument("--output", default="progress.png", help="Output image path.")
    parser.add_argument("--metric-column", help="Metric column to plot. Defaults to val_bpb when present.")
    parser.add_argument("--metric-label", help="Human-readable y-axis metric label.")
    parser.add_argument("--direction", required=True, choices=["lower", "higher"], help="Whether lower or higher is better.")
    parser.add_argument("--status-column", default="status", help="Column containing KEEP/DISCARD style statuses.")
    parser.add_argument("--description-column", default="description", help="Column containing short experiment descriptions.")
    parser.add_argument("--experiment-column", help="Optional x-axis experiment number column.")
    parser.add_argument("--delimiter", default="auto", choices=["auto", "tab", "comma", "semicolon", "pipe"])
    parser.add_argument("--kept-statuses", default=",".join(DEFAULT_KEPT_STATUSES), help="Comma-separated statuses plotted in green.")
    parser.add_argument("--skip-statuses", default=",".join(DEFAULT_SKIP_STATUSES), help="Comma-separated statuses omitted from the plot.")
    parser.add_argument("--start-index", type=int, default=0, help="First experiment number when no experiment column is provided.")
    parser.add_argument("--label-max-chars", type=int, default=48, help="Maximum characters for kept-experiment labels.")
    parser.add_argument("--title", help="Plot title. Defaults to an experiment and kept-count summary.")
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--width", type=float, default=16.0)
    parser.add_argument("--height", type=float, default=8.0)
    parser.add_argument("--y-margin", type=float, default=0.15, help="Focused y-axis margin as a fraction of baseline-best span.")
    parser.add_argument("--include-all-y", action="store_true", help="Do not focus y-axis around baseline and best kept metric.")
    parser.add_argument("--show", action="store_true", help="Open an interactive matplotlib window after saving.")
    return parser.parse_args()


def split_statuses(value: str) -> set[str]:
    return {item.strip().upper() for item in value.split(",") if item.strip()}


def delimiter_from_name(name: str) -> str:
    return {
        "tab": "\t",
        "comma": ",",
        "semicolon": ";",
        "pipe": "|",
    }[name]


def detect_delimiter(path: Path, requested: str) -> str:
    if requested != "auto":
        return delimiter_from_name(requested)
    if path.suffix.lower() == ".tsv":
        return "\t"
    if path.suffix.lower() == ".csv":
        return ","

    sample = path.read_text(encoding="utf-8")[:8192]
    try:
        return csv.Sniffer().sniff(sample, delimiters="\t,;|").delimiter
    except csv.Error:
        first_line = sample.splitlines()[0] if sample.splitlines() else ""
        return "\t" if "\t" in first_line else ","


def read_rows(path: Path, delimiter: str) -> tuple[list[dict[str, str]], list[str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle, delimiter=delimiter)
        rows = [{key: value for key, value in row.items() if key is not None} for row in reader]
        fieldnames = [name for name in (reader.fieldnames or []) if name]
    if not fieldnames:
        raise ValueError(f"{path} does not look like a delimited table with a header.")
    return rows, fieldnames


def parse_float(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("%"):
        text = text[:-1]
    text = text.replace(",", "")
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return number


def infer_metric_column(rows: list[dict[str, str]], fieldnames: list[str], requested: str | None) -> str:
    if requested:
        if requested not in fieldnames:
            raise ValueError(f"Metric column {requested!r} was not found. Available columns: {', '.join(fieldnames)}")
        return requested
    if "val_bpb" in fieldnames:
        return "val_bpb"

    numeric_candidates: list[str] = []
    for column in fieldnames:
        if column.lower() in DEFAULT_EXCLUDED_METRIC_COLUMNS:
            continue
        valid_count = sum(1 for row in rows if parse_float(row.get(column)) is not None)
        if valid_count:
            numeric_candidates.append(column)

    if len(numeric_candidates) == 1:
        return numeric_candidates[0]
    if not numeric_candidates:
        raise ValueError("Could not infer a metric column. Pass --metric-column.")
    raise ValueError(
        "Multiple numeric metric candidates found. Pass --metric-column. "
        f"Candidates: {', '.join(numeric_candidates)}"
    )


def normalize_status(value: object) -> str:
    return str(value or "").strip().upper()


def normalize_description(value: object, fallback: str) -> str:
    text = " ".join(str(value or "").split())
    return text or fallback


def truncate_label(value: str, max_chars: int) -> str:
    if max_chars <= 0 or len(value) <= max_chars:
        return value
    return value[: max_chars - 3].rstrip() + "..."


def build_experiments(
    rows: list[dict[str, str]],
    metric_column: str,
    status_column: str,
    description_column: str,
    experiment_column: str | None,
    start_index: int,
    skip_statuses: set[str],
) -> tuple[list[Experiment], int]:
    experiments: list[Experiment] = []
    skipped = 0
    for index, row in enumerate(rows):
        status = normalize_status(row.get(status_column))
        metric = parse_float(row.get(metric_column))
        if metric is None or status in skip_statuses:
            skipped += 1
            continue
        if experiment_column:
            x = parse_float(row.get(experiment_column))
            if x is None:
                skipped += 1
                continue
        else:
            x = float(start_index + index)
        fallback = f"experiment {start_index + index}"
        experiments.append(
            Experiment(
                x=x,
                metric=metric,
                status=status,
                description=normalize_description(row.get(description_column), fallback),
                row_number=index + 1,
            )
        )
    return experiments, skipped


def running_best(points: Iterable[Experiment], direction: str) -> tuple[list[float], list[float]]:
    xs: list[float] = []
    ys: list[float] = []
    best: float | None = None
    for point in sorted(points, key=lambda item: item.x):
        if best is None:
            best = point.metric
        elif direction == "lower":
            best = min(best, point.metric)
        else:
            best = max(best, point.metric)
        xs.append(point.x)
        ys.append(best)
    return xs, ys


def metric_axis_label(metric_column: str, metric_label: str | None, direction: str) -> str:
    label = metric_label or metric_column.replace("_", " ")
    qualifier = "lower is better" if direction == "lower" else "higher is better"
    return f"{label} ({qualifier})"


def configure_focused_ylim(ax: object, experiments: list[Experiment], kept: list[Experiment], direction: str, y_margin: float) -> None:
    if not experiments or not kept:
        return
    baseline = experiments[0].metric
    best = min((point.metric for point in kept), default=baseline) if direction == "lower" else max(
        (point.metric for point in kept),
        default=baseline,
    )
    span = abs(best - baseline)
    margin = span * max(y_margin, 0.0)
    if margin == 0:
        margin = max(abs(baseline) * 0.01, 1e-9)
    lower = min(best, baseline) - margin
    upper = max(best, baseline) + margin
    ax.set_ylim(lower, upper)


def plot(args: argparse.Namespace) -> int:
    results_path = Path(args.results)
    if not results_path.exists():
        print(f"Results file not found: {results_path}", file=sys.stderr)
        return 2

    delimiter = detect_delimiter(results_path, args.delimiter)
    rows, fieldnames = read_rows(results_path, delimiter)
    if args.status_column not in fieldnames:
        print(f"Status column {args.status_column!r} was not found. Available columns: {', '.join(fieldnames)}", file=sys.stderr)
        return 2
    if args.experiment_column and args.experiment_column not in fieldnames:
        print(f"Experiment column {args.experiment_column!r} was not found. Available columns: {', '.join(fieldnames)}", file=sys.stderr)
        return 2

    try:
        metric_column = infer_metric_column(rows, fieldnames, args.metric_column)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    kept_statuses = split_statuses(args.kept_statuses)
    skip_statuses = split_statuses(args.skip_statuses)
    experiments, skipped = build_experiments(
        rows,
        metric_column,
        args.status_column,
        args.description_column,
        args.experiment_column,
        args.start_index,
        skip_statuses,
    )
    if not experiments:
        print("No plottable experiments found after filtering missing metrics and skipped statuses.", file=sys.stderr)
        return 2

    try:
        import matplotlib

        if not args.show:
            matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError as exc:
        print("matplotlib is required. Install it with: python3 -m pip install matplotlib", file=sys.stderr)
        return 2

    kept = [point for point in experiments if point.status in kept_statuses]
    discarded = [point for point in experiments if point.status not in kept_statuses]

    fig, ax = plt.subplots(figsize=(args.width, args.height))
    if discarded:
        ax.scatter(
            [point.x for point in discarded],
            [point.metric for point in discarded],
            c="#cccccc",
            s=12,
            alpha=0.5,
            zorder=2,
            label="Discarded",
        )
    if kept:
        ax.scatter(
            [point.x for point in kept],
            [point.metric for point in kept],
            c="#2ecc71",
            s=50,
            zorder=4,
            label="Kept",
            edgecolors="black",
            linewidths=0.5,
        )
        best_xs, best_ys = running_best(kept, args.direction)
        ax.step(best_xs, best_ys, where="post", color="#27ae60", linewidth=2, alpha=0.7, zorder=3, label="Running best")
        for point in kept:
            ax.annotate(
                truncate_label(point.description, args.label_max_chars),
                (point.x, point.metric),
                textcoords="offset points",
                xytext=(6, 6),
                fontsize=8.0,
                color="#1a7a3a",
                alpha=0.9,
                rotation=30,
                ha="left",
                va="bottom",
            )

    n_total = len(rows)
    n_kept = len(kept)
    title = args.title or f"Autoresearch Progress: {n_total} Experiments, {n_kept} Kept Improvements"
    ax.set_xlabel("Experiment #", fontsize=12)
    ax.set_ylabel(metric_axis_label(metric_column, args.metric_label, args.direction), fontsize=12)
    ax.set_title(title, fontsize=14)
    ax.grid(True, alpha=0.2)
    ax.legend(loc="upper right", fontsize=9)
    if not args.include_all_y:
        configure_focused_ylim(ax, experiments, kept, args.direction, args.y_margin)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    fig.savefig(output_path, dpi=args.dpi, bbox_inches="tight")
    if args.show:
        plt.show()
    plt.close(fig)

    best_metric = None
    if kept:
        best_metric = min((point.metric for point in kept), default=None) if args.direction == "lower" else max(
            (point.metric for point in kept),
            default=None,
        )
    print(f"Saved progress graph: {output_path}")
    summary = f"Experiments: {n_total}, plotted: {len(experiments)}, kept: {n_kept}, discarded: {len(discarded)}, skipped: {skipped}"
    if best_metric is not None:
        summary += f", best {metric_column}: {best_metric:g}"
    print(summary)
    return 0


def main() -> int:
    try:
        return plot(parse_args())
    except (OSError, csv.Error, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
