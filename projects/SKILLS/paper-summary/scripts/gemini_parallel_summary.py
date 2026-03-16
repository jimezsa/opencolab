#!/usr/bin/env python3
"""Generate schema-conformant paper summaries from PDFs with Gemini."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None
    types = None


DEFAULT_MODEL_NAME = "gemini-3.1-flash-lite-preview"
DEFAULT_MAX_OUTPUT_TOKENS = 8192
REQUIRED_SECTION_PREFIXES = [
    "# Paper Extraction Schema:",
    "## 1.",
    "## 2.",
    "## 3.",
    "## 4.",
    "## 5.",
]
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
REPO_ROOT = SKILL_DIR.parent.parent
ENV_LOCAL_PATH = REPO_ROOT / ".env.local"
ENV_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass(frozen=True)
class Job:
    pdf_path: Path
    output_path: Path
    metadata_path: Path | None

    @property
    def safe_id(self) -> str:
        return self.pdf_path.stem


@dataclass(frozen=True)
class Result:
    job: Job
    status: str
    original_id: str | None = None
    message: str | None = None


def parse_args() -> argparse.Namespace:
    default_model = os.getenv("PAPER_SUMMARY_GEMINI_MODEL", DEFAULT_MODEL_NAME)
    parser = argparse.ArgumentParser(
        description="Generate markdown paper summaries from one PDF or a directory of PDFs."
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--pdf", type=Path, help="Path to one PDF to summarize.")
    source_group.add_argument(
        "--pdf-dir",
        type=Path,
        help="Directory containing PDF files to summarize in parallel.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Directory for generated markdown files. Defaults to the PDF directory.",
    )
    parser.add_argument(
        "--metadata-dir",
        type=Path,
        help="Directory containing papercli metadata JSON files named <safe_id>.json.",
    )
    parser.add_argument(
        "--summarized-ids",
        type=Path,
        help="Append successful original paper IDs to this file when metadata is available.",
    )
    parser.add_argument(
        "--failures-tsv",
        type=Path,
        help="Append summary failures to this TSV file as stage, id, and reason.",
    )
    parser.add_argument(
        "--model",
        default=default_model,
        help=f"Gemini model name to call. Default: {default_model}.",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=20,
        help="Maximum number of concurrent Gemini requests in batch mode.",
    )
    parser.add_argument(
        "--max-output-tokens",
        type=int,
        default=DEFAULT_MAX_OUTPUT_TOKENS,
        help="Maximum output tokens requested from Gemini.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Regenerate summaries even if the markdown file already exists.",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Retry count for retryable Gemini API failures.",
    )
    return parser.parse_args()


def main() -> int:
    load_env_local()
    args = parse_args()
    jobs = build_jobs(args)
    if not jobs:
        print("No PDF files found to summarize.", file=sys.stderr)
        return 1

    print_detected_jobs(jobs, args.overwrite)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print(f"GEMINI_API_KEY is not set. Checked process environment and {ENV_LOCAL_PATH}.", file=sys.stderr)
        return 2
    if genai is None or types is None:
        print(
            "google-genai is not installed. Install it with: python3 -m pip install google-genai",
            file=sys.stderr,
        )
        return 2

    schema_path = SKILL_DIR / "references" / "summary_schema.md"
    schema_text = schema_path.read_text(encoding="utf-8").strip()

    for job in jobs:
        job.output_path.parent.mkdir(parents=True, exist_ok=True)

    workers = min(max(args.concurrency, 1), len(jobs))
    results: list[Result] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {
            executor.submit(run_job, job, args, api_key, schema_text): job for job in jobs
        }
        for future in concurrent.futures.as_completed(future_map):
            results.append(future.result())

    ok_count = 0
    skipped_count = 0
    failed_count = 0
    for result in sorted(results, key=lambda item: item.job.safe_id):
        identifier = result.original_id or result.job.safe_id
        if result.status == "ok":
            ok_count += 1
            print(f"OK   {result.job.pdf_path} -> {result.job.output_path}", file=sys.stderr)
            append_line(args.summarized_ids, identifier)
        elif result.status == "skipped":
            skipped_count += 1
            print(f"SKIP {result.job.output_path} already exists", file=sys.stderr)
        else:
            failed_count += 1
            message = result.message or "unknown summary failure"
            print(f"FAIL {result.job.pdf_path}: {message}", file=sys.stderr)
            append_failure(args.failures_tsv, identifier, message)

    print(
        json.dumps(
            {
                "ok": ok_count,
                "skipped": skipped_count,
                "failed": failed_count,
                "total": len(results),
            },
            indent=2,
        )
    )
    return 0 if failed_count == 0 else 1


def load_env_local() -> None:
    if not ENV_LOCAL_PATH.is_file():
        return

    for raw_line in ENV_LOCAL_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()

        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not ENV_KEY_PATTERN.match(key) or key in os.environ:
            continue

        os.environ[key] = parse_env_value(value.strip())


def parse_env_value(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        quote = value[0]
        inner = value[1:-1]
        if quote == '"':
            return bytes(inner, "utf-8").decode("unicode_escape")
        return inner
    return value


def build_jobs(args: argparse.Namespace) -> list[Job]:
    pdf_paths: list[Path]
    if args.pdf is not None:
        pdf_paths = [args.pdf]
    else:
        pdf_paths = sorted(path for path in args.pdf_dir.glob("*.pdf") if path.is_file())

    jobs: list[Job] = []
    for pdf_path in pdf_paths:
        output_dir = args.output_dir or pdf_path.parent
        output_path = output_dir / f"{pdf_path.stem}.md"
        metadata_path = None
        if args.metadata_dir is not None:
            candidate = args.metadata_dir / f"{pdf_path.stem}.json"
            if candidate.exists():
                metadata_path = candidate
        jobs.append(Job(pdf_path=pdf_path, output_path=output_path, metadata_path=metadata_path))
    return jobs


def print_detected_jobs(jobs: list[Job], overwrite: bool) -> None:
    mode = "overwrite" if overwrite else "preserve-existing"
    print(
        f"Detected {len(jobs)} PDF(s) to summarize. Mode: {mode}.",
        file=sys.stderr,
    )
    for index, job in enumerate(jobs, start=1):
        metadata_state = str(job.metadata_path) if job.metadata_path is not None else "missing"
        output_state = "exists" if job.output_path.exists() else "new"
        print(
            f"[{index}/{len(jobs)}] pdf={job.pdf_path} safe_id={job.safe_id}",
            file=sys.stderr,
        )
        print(f"  output={job.output_path} ({output_state})", file=sys.stderr)
        print(f"  metadata={metadata_state}", file=sys.stderr)


def run_job(
    job: Job,
    args: argparse.Namespace,
    api_key: str,
    schema_text: str,
) -> Result:
    if not job.pdf_path.exists():
        return Result(job=job, status="failed", message="pdf file does not exist")

    if job.output_path.exists() and not args.overwrite:
        return Result(job=job, status="skipped")

    original_id = None
    try:
        metadata = load_metadata(job.metadata_path)
        original_id = extract_original_id(metadata)
        prompt = build_prompt(job, metadata, schema_text)
        summary = generate_summary(
            api_key=api_key,
            model=args.model,
            prompt=prompt,
            pdf_path=job.pdf_path,
            max_output_tokens=args.max_output_tokens,
            retries=args.retries,
        )
        summary = strip_code_fences(summary).strip()
        validate_summary(summary)
        job.output_path.write_text(summary + "\n", encoding="utf-8")
    except Exception as exc:
        return Result(job=job, status="failed", original_id=original_id, message=str(exc))

    return Result(job=job, status="ok", original_id=original_id)


def load_metadata(metadata_path: Path | None) -> dict[str, Any] | None:
    if metadata_path is None:
        return None
    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid metadata JSON at {metadata_path}: {exc}") from exc

    if isinstance(payload, dict):
        return payload
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                return item
        raise ValueError(f"metadata JSON at {metadata_path} does not contain an object entry")

    raise ValueError(f"metadata JSON at {metadata_path} must be an object or list of objects")


def extract_original_id(metadata: dict[str, Any] | None) -> str | None:
    if not metadata:
        return None
    candidate = metadata.get("id")
    if isinstance(candidate, str) and candidate.strip():
        return candidate.strip()
    return None


def build_prompt(job: Job, metadata: dict[str, Any] | None, schema_text: str) -> str:
    metadata_block = "None available."
    if metadata is not None:
        metadata_block = json.dumps(metadata, indent=2, ensure_ascii=True)

    return f"""You are generating a deterministic markdown paper summary from a scientific PDF.

Return markdown only. Do not wrap the answer in code fences.
Follow the canonical schema exactly and preserve the section order.
Use the PDF as the primary source of evidence. Use metadata only as fallback and label it clearly.
Keep figures, captions, tables, equations, algorithms, and page anchors as first-class evidence.
If evidence is missing, write the required missing-evidence labels instead of guessing.

Local context:
- PDF path: {job.pdf_path}
- Safe ID: {job.safe_id}
- Metadata path: {job.metadata_path or "None"}

Metadata JSON:
{metadata_block}

Canonical schema:
{schema_text}
"""


def generate_summary(
    *,
    api_key: str,
    model: str,
    prompt: str,
    pdf_path: Path,
    max_output_tokens: int,
    retries: int,
) -> str:
    last_error: Exception | None = None
    for attempt in range(1, max(retries, 1) + 1):
        try:
            client = genai.Client(api_key=api_key)
            document = types.Part.from_bytes(
                data=pdf_path.read_bytes(),
                mime_type="application/pdf",
            )
            response = client.models.generate_content(
                model=model,
                contents=[prompt, document],
                config=types.GenerateContentConfig(
                    temperature=0,
                    max_output_tokens=max_output_tokens,
                    response_mime_type="text/plain",
                ),
            )
            summary = extract_text_from_response(response)
            if summary:
                return summary
            raise RuntimeError("Gemini returned empty content")
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(2 ** (attempt - 1))
                continue
            break

    raise RuntimeError(f"Gemini request failed after retries: {last_error}")


def extract_text_from_response(response: Any) -> str:
    try:
        text = response.text
    except Exception:
        text = None

    if isinstance(text, str) and text.strip():
        return text.strip()

    candidates = getattr(response, "candidates", None)
    if not candidates:
        return ""

    text_parts: list[str] = []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            part_text = getattr(part, "text", None)
            if isinstance(part_text, str) and part_text.strip():
                text_parts.append(part_text)

    return "".join(text_parts).strip()


def strip_code_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            return "\n".join(lines[1:-1]).strip()
    return stripped


def validate_summary(summary: str) -> None:
    positions: list[int] = []
    for prefix in REQUIRED_SECTION_PREFIXES:
        position = summary.find(prefix)
        if position == -1:
            raise ValueError(f"generated summary is missing required section prefix: {prefix}")
        positions.append(position)

    if positions != sorted(positions):
        raise ValueError("generated summary does not preserve the required section order")


def append_line(path: Path | None, line: str | None) -> None:
    if path is None or line is None or not line.strip():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line.strip() + "\n")


def append_failure(path: Path | None, identifier: str, reason: str) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_reason = reason.replace("\t", " ").replace("\n", " ").strip()
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"summary\t{identifier}\t{safe_reason}\n")


if __name__ == "__main__":
    raise SystemExit(main())
