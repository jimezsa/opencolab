#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "answer"


def safe_id_from_pdf(pdf_path: Path) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", pdf_path.stem)


def emit_progress(kind: str, message: str, *, stage: str = "pageindex", current: int | None = None, total: int | None = None) -> None:
    progress_file = os.environ.get("OPENCOLAB_PROGRESS_FILE")
    if not progress_file:
        return

    event: dict[str, Any] = {
        "kind": kind,
        "stage": stage,
        "slot": "grounding",
        "message": message,
    }
    if current is not None:
        event["current"] = current
    if total is not None:
        event["total"] = total
    with open(progress_file, "a", encoding="utf8") as handle:
        handle.write(json.dumps(event, ensure_ascii=True) + "\n")


def load_manifest(manifest_path: Path) -> dict[str, Any]:
    if not manifest_path.exists():
        return {"generated_at": now_iso(), "documents": [], "answers": []}

    payload = json.loads(manifest_path.read_text(encoding="utf8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected manifest object in {manifest_path}")

    payload.setdefault("documents", [])
    payload.setdefault("answers", [])
    return payload


def save_manifest(manifest_path: Path, manifest: dict[str, Any]) -> None:
    manifest["generated_at"] = now_iso()
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=True) + "\n", encoding="utf8")


def upsert_document_entry(manifest: dict[str, Any], safe_id: str) -> dict[str, Any]:
    documents = manifest.setdefault("documents", [])
    for entry in documents:
        if entry.get("safe_id") == safe_id:
            return entry

    entry: dict[str, Any] = {"safe_id": safe_id}
    documents.append(entry)
    return entry


def resolve_pageindex_client(api_key_env: str):
    try:
        from pageindex import PageIndexClient
    except ImportError as error:  # pragma: no cover - import check only
        raise SystemExit(
            "The 'pageindex' package is not installed. Run 'python3 -m pip install -q --upgrade pageindex' and retry."
        ) from error

    api_key = os.environ.get(api_key_env)
    if not api_key:
        raise SystemExit(f"Missing required environment variable: {api_key_env}")

    return PageIndexClient(api_key=api_key)


def sync_document(
    client: Any,
    pdf_path: Path,
    entry: dict[str, Any],
    trees_dir: Path,
    timeout_sec: int,
    poll_interval_sec: int,
    force_upload: bool,
) -> dict[str, Any]:
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    stat = pdf_path.stat()
    safe_id = safe_id_from_pdf(pdf_path)
    summary_path = pdf_path.with_suffix(".md")
    tree_path = trees_dir / f"{safe_id}.json"
    recorded_mtime = entry.get("source_mtime_ns")
    current_mtime = stat.st_mtime_ns

    entry["pdf_path"] = str(pdf_path)
    entry["summary_path"] = str(summary_path) if summary_path.exists() else ""
    entry["tree_path"] = str(tree_path)
    entry["source_mtime_ns"] = current_mtime
    entry["updated_at"] = now_iso()

    reuse_existing = bool(entry.get("doc_id")) and recorded_mtime == current_mtime and not force_upload
    metadata: dict[str, Any] | None = None

    if reuse_existing:
        try:
            metadata = client.get_document(entry["doc_id"])
        except Exception:
            metadata = None

    if metadata is None:
        emit_progress("progress", f"Submitting {pdf_path.name} to PageIndex.")
        result = client.submit_document(str(pdf_path))
        entry["doc_id"] = result["doc_id"]
        entry["submitted_at"] = now_iso()

    deadline = time.time() + timeout_sec
    while True:
        metadata = client.get_document(entry["doc_id"])
        status = str(metadata.get("status", "")).lower()
        entry["status"] = status or "unknown"
        entry["page_num"] = metadata.get("pageNum")
        entry["name"] = metadata.get("name", pdf_path.name)

        if status == "completed":
            break
        if status == "failed":
            raise RuntimeError(f"PageIndex processing failed for {pdf_path.name} ({entry['doc_id']})")
        if time.time() >= deadline:
            raise TimeoutError(f"Timed out waiting for PageIndex processing for {pdf_path.name}")
        time.sleep(poll_interval_sec)

    emit_progress("progress", f"Syncing tree for {pdf_path.name}.")
    tree_payload = client.get_tree(entry["doc_id"])
    trees_dir.mkdir(parents=True, exist_ok=True)
    tree_path.write_text(json.dumps(tree_payload, indent=2, ensure_ascii=True) + "\n", encoding="utf8")
    entry["tree_synced_at"] = now_iso()
    return entry


def write_answer_files(
    question: str,
    answer_text: str,
    response_payload: dict[str, Any],
    synced_entries: list[dict[str, Any]],
    answers_dir: Path,
) -> tuple[Path, Path]:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    slug = slugify(question)[:80]
    markdown_path = answers_dir / f"{timestamp}-{slug}.md"
    json_path = answers_dir / f"{timestamp}-{slug}.json"
    answers_dir.mkdir(parents=True, exist_ok=True)

    lines = [
        f"# Grounded Answer: {question}",
        "",
        "## Question",
        "",
        question,
        "",
        "## Selected Local Papers",
        "",
    ]
    for entry in synced_entries:
        title = entry.get("title") or entry.get("name") or Path(entry["pdf_path"]).name
        lines.append(f"- `{entry['safe_id']}`: {title}")
    lines.extend(
        [
            "",
            "## Answer",
            "",
            answer_text.strip() or "No answer text returned by PageIndex.",
            "",
            "## Notes",
            "",
            "- Citations are preserved exactly as returned by PageIndex when available.",
            "- Verify figures, tables, and equations against the local PDF when the wording is especially sensitive.",
            "",
        ]
    )

    markdown_path.write_text("\n".join(lines), encoding="utf8")
    json_path.write_text(json.dumps(response_payload, indent=2, ensure_ascii=True) + "\n", encoding="utf8")
    return markdown_path, json_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync local PDFs through the PageIndex Python SDK, cache trees locally, and optionally ask a cited question."
    )
    parser.add_argument("--pdf", action="append", required=True, help="Local PDF path. Pass multiple times for multiple documents.")
    parser.add_argument("--question", help="Optional grounded question to ask after syncing the selected PDFs.")
    parser.add_argument("--workspace", default="research/pageindex", help="Local workspace directory for manifests, trees, and answers.")
    parser.add_argument("--api-key-env", default="PAGEINDEX_API_KEY", help="Environment variable used for the PageIndex API key.")
    parser.add_argument("--timeout-sec", type=int, default=900, help="Maximum time to wait per document for processing.")
    parser.add_argument("--poll-interval-sec", type=int, default=5, help="Polling interval while waiting for processing.")
    parser.add_argument("--force-upload", action="store_true", help="Force re-upload of local PDFs instead of reusing saved doc ids.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    emit_progress("started", "Starting PageIndex grounded sync.")

    workspace = Path(args.workspace)
    manifest_path = workspace / "manifest.json"
    trees_dir = workspace / "trees"
    answers_dir = workspace / "answers"
    manifest = load_manifest(manifest_path)
    client = resolve_pageindex_client(args.api_key_env)

    synced_entries: list[dict[str, Any]] = []
    pdf_paths = [Path(value).resolve() for value in args.pdf]
    total = len(pdf_paths)

    for index, pdf_path in enumerate(pdf_paths, start=1):
        safe_id = safe_id_from_pdf(pdf_path)
        entry = upsert_document_entry(manifest, safe_id)
        emit_progress("progress", f"Processing {pdf_path.name}.", current=index, total=total)
        synced_entry = sync_document(
            client=client,
            pdf_path=pdf_path,
            entry=entry,
            trees_dir=trees_dir,
            timeout_sec=args.timeout_sec,
            poll_interval_sec=args.poll_interval_sec,
            force_upload=args.force_upload,
        )
        synced_entries.append(synced_entry)
        save_manifest(manifest_path, manifest)

    if not args.question:
        emit_progress("completed", f"Synced {len(synced_entries)} PageIndex document(s).")
        print(f"Synced {len(synced_entries)} document(s). Manifest: {manifest_path}")
        return 0

    emit_progress("milestone", f"Asking grounded question across {len(synced_entries)} document(s).")
    doc_ids = [entry["doc_id"] for entry in synced_entries]
    doc_scope: str | list[str] = doc_ids[0] if len(doc_ids) == 1 else doc_ids
    response_payload = client.chat_completions(
        messages=[{"role": "user", "content": args.question}],
        doc_id=doc_scope,
        enable_citations=True,
    )
    answer_text = (
        response_payload.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    markdown_path, json_path = write_answer_files(
        question=args.question,
        answer_text=answer_text,
        response_payload=response_payload,
        synced_entries=synced_entries,
        answers_dir=answers_dir,
    )

    manifest.setdefault("answers", []).append(
        {
            "question": args.question,
            "markdown_path": str(markdown_path),
            "json_path": str(json_path),
            "doc_ids": doc_ids,
            "created_at": now_iso(),
        }
    )
    save_manifest(manifest_path, manifest)
    emit_progress("completed", "Grounded answer completed.")

    if answer_text:
        print(answer_text)
    print(f"\nSaved markdown answer: {markdown_path}", file=sys.stderr)
    print(f"Saved raw response: {json_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
