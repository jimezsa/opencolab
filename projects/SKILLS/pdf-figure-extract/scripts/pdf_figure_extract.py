#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

try:
    import pymupdf
except ImportError:
    try:
        import fitz as pymupdf  # type: ignore[no-redef]
    except ImportError as exc:  # pragma: no cover - import-time environment issue
        raise SystemExit("PyMuPDF is required. Install it with: python3 -m pip install PyMuPDF") from exc


STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "do",
    "for",
    "from",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "me",
    "of",
    "on",
    "or",
    "paper",
    "please",
    "return",
    "send",
    "show",
    "that",
    "the",
    "this",
    "to",
    "user",
    "want",
    "with",
}

FIGURE_HINT_TERMS = (
    "figure",
    "fig.",
    "fig ",
    "architecture",
    "pipeline",
    "framework",
    "overview",
    "method",
    "system",
    "diagram",
    "qualitative",
    "result",
)

TEXT_KEYS = {
    "title",
    "summary",
    "text",
    "caption",
    "content",
    "heading",
    "section",
    "node_title",
    "node_summary",
    "node_text",
}

PAGE_KEYS = {
    "page",
    "pages",
    "page_no",
    "page_num",
    "page_nums",
    "page_number",
    "page_numbers",
    "page_start",
    "page_end",
    "start_page",
    "end_page",
    "page_range",
    "pages_range",
}

CAPTION_RE = re.compile(r"^\s*(?:figure|fig\.?)\s*\d+", re.IGNORECASE)
FIGURE_NUMBER_RE = re.compile(r"\b(?:figure|fig\.?)\s*(\d+)\b", re.IGNORECASE)


@dataclass
class PageSignal:
    score: float = 0.0
    reasons: list[str] = field(default_factory=list)


@dataclass
class Candidate:
    page_index: int
    page_number: int
    score: float
    kind: str
    bbox: tuple[float, float, float, float]
    caption: str = ""
    page_excerpt: str = ""
    reasons: list[str] = field(default_factory=list)
    output_path: str | None = None
    raw_path: str | None = None
    raw_ext: str | None = None
    raw_bytes: bytes | None = field(default=None, repr=False)

    def to_dict(self) -> dict[str, Any]:
        payload = {
            "page_index": self.page_index,
            "page_number": self.page_number,
            "score": round(self.score, 3),
            "kind": self.kind,
            "bbox": [round(value, 3) for value in self.bbox],
            "caption": self.caption,
            "page_excerpt": self.page_excerpt,
            "reasons": self.reasons,
            "output_path": self.output_path,
            "raw_path": self.raw_path,
        }
        return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract likely paper figures from a local PDF with PyMuPDF.")
    parser.add_argument("--pdf-path", required=True, help="Path to the local PDF.")
    parser.add_argument("--query", required=True, help="User request, such as 'architecture figure' or 'Figure 3'.")
    parser.add_argument("--output-root", default="research/figures", help="Root output directory.")
    parser.add_argument("--pageindex-tree", default=None, help="Optional PageIndex tree JSON path.")
    parser.add_argument("--pageindex-manifest", default="research/pageindex/manifest.json", help="Optional PageIndex manifest JSON path.")
    parser.add_argument("--page-hint", type=int, action="append", default=[], help="Optional 1-based page hint. Repeat as needed.")
    parser.add_argument("--figure-number", type=int, default=None, help="Optional explicit figure number.")
    parser.add_argument("--top-k", type=int, default=3, help="How many candidate images to export.")
    parser.add_argument("--max-pages", type=int, default=8, help="Maximum shortlisted pages to inspect closely.")
    parser.add_argument("--dpi", type=int, default=300, help="PNG render DPI for exported figure candidates.")
    parser.add_argument("--slug", default=None, help="Optional output slug override.")
    return parser.parse_args()


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def relative_to_cwd(path: Path) -> str:
    try:
        return path.resolve().relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def slugify(value: str, limit: int = 80) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:limit] or "figure"


def unique_preserve(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for item in items:
        trimmed = item.strip()
        if not trimmed or trimmed in seen:
            continue
        seen.add(trimmed)
        output.append(trimmed)
    return output


def normalize_text(value: str) -> str:
    return " ".join(value.lower().split())


def shorten(value: str, limit: int = 220) -> str:
    text = " ".join(value.split())
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def derive_keywords(query: str) -> list[str]:
    raw_tokens = re.findall(r"[a-z0-9]+", query.lower())
    keywords = {token for token in raw_tokens if len(token) > 2 and token not in STOPWORDS}
    if {"architecture", "pipeline", "framework", "overview", "system", "diagram"} & keywords:
        keywords.update({"architecture", "pipeline", "framework", "overview", "system", "diagram"})
    if "qualitative" in keywords or "result" in keywords:
        keywords.update({"qualitative", "result", "comparison"})
    if not keywords:
        keywords.update({"figure", "architecture", "pipeline"})
    return sorted(keywords)


def infer_figure_number(query: str, explicit: int | None) -> int | None:
    if explicit is not None:
        return explicit
    match = FIGURE_NUMBER_RE.search(query)
    if match:
        return int(match.group(1))
    return None


def score_text(text: str, keywords: Sequence[str], figure_number: int | None) -> tuple[float, list[str]]:
    normalized = normalize_text(text)
    if not normalized:
        return 0.0, []

    score = 0.0
    reasons: list[str] = []

    hits = [keyword for keyword in keywords if keyword in normalized]
    if hits:
        score += min(len(hits), 6) * 1.25
        reasons.append("keywords:" + ",".join(hits[:4]))

    figure_hits = [term for term in FIGURE_HINT_TERMS if term in normalized]
    if figure_hits:
        score += min(len(figure_hits), 3) * 0.5
        reasons.append("figure-context")

    if figure_number is not None:
        exact = re.search(rf"\b(?:figure|fig\.?)\s*{figure_number}\b", normalized, re.IGNORECASE)
        if exact:
            score += 6.0
            reasons.append(f"figure:{figure_number}")

    return score, reasons


def parse_page_numbers(value: Any) -> set[int]:
    pages: set[int] = set()
    if value is None:
        return pages
    if isinstance(value, bool):
        return pages
    if isinstance(value, int):
        if value > 0:
            pages.add(value - 1)
        return pages
    if isinstance(value, float):
        if value.is_integer() and value > 0:
            pages.add(int(value) - 1)
        return pages
    if isinstance(value, str):
        for part in re.split(r"[,\s]+", value.strip()):
            if not part:
                continue
            if "-" in part:
                bounds = [segment for segment in part.split("-", 1) if segment]
                if len(bounds) != 2 or not all(segment.isdigit() for segment in bounds):
                    continue
                start, end = int(bounds[0]), int(bounds[1])
                for page in range(min(start, end), max(start, end) + 1):
                    if page > 0:
                        pages.add(page - 1)
                continue
            if part.isdigit():
                page = int(part)
                if page > 0:
                    pages.add(page - 1)
        return pages
    if isinstance(value, list):
        for item in value:
            pages.update(parse_page_numbers(item))
        return pages
    return pages


def add_signal(signals: dict[int, PageSignal], page_index: int, score: float, reasons: Iterable[str], page_count: int) -> None:
    if page_index < 0 or page_index >= page_count or score <= 0:
        return
    signal = signals.setdefault(page_index, PageSignal())
    signal.score += score
    signal.reasons.extend(reasons)


def resolve_pageindex_tree(pdf_path: Path, explicit_tree: str | None, manifest_path: str | None) -> Path | None:
    if explicit_tree:
        candidate = Path(explicit_tree)
        return candidate if candidate.exists() else None

    if not manifest_path:
        return None

    manifest_file = Path(manifest_path)
    if not manifest_file.exists():
        return None

    try:
        data = json.loads(manifest_file.read_text(encoding="utf8"))
    except json.JSONDecodeError:
        return None

    pdf_name = pdf_path.name
    pdf_stem = pdf_path.stem
    for paper in data.get("papers", []):
        if not isinstance(paper, dict):
            continue
        manifest_pdf = str(paper.get("pdf_path", ""))
        safe_id = str(paper.get("safe_id", ""))
        if pdf_name == Path(manifest_pdf).name or pdf_stem == safe_id:
            tree_path = paper.get("tree_path")
            if isinstance(tree_path, str):
                candidate = Path(tree_path)
                if candidate.exists():
                    return candidate
    return None


def collect_pageindex_signals(tree_path: Path | None, keywords: Sequence[str], figure_number: int | None, page_count: int) -> dict[int, PageSignal]:
    if tree_path is None or not tree_path.exists():
        return {}

    try:
        payload = json.loads(tree_path.read_text(encoding="utf8"))
    except json.JSONDecodeError:
        return {}

    signals: dict[int, PageSignal] = {}

    def walk(node: Any, inherited_pages: set[int]) -> None:
        if isinstance(node, dict):
            local_pages = set(inherited_pages)
            for key, value in node.items():
                if key.lower() in PAGE_KEYS:
                    local_pages.update(parse_page_numbers(value))

            texts: list[str] = []
            for key, value in node.items():
                if not isinstance(value, str):
                    continue
                lower_key = key.lower()
                if lower_key in TEXT_KEYS or lower_key.endswith("_title") or lower_key.endswith("_summary") or lower_key.endswith("_text"):
                    texts.append(value)

            score, reasons = score_text(" ".join(texts), keywords, figure_number)
            if score > 0 and local_pages:
                for page_index in local_pages:
                    add_signal(signals, page_index, score + 1.0, ["pageindex", *reasons], page_count)

            for value in node.values():
                walk(value, local_pages)
            return

        if isinstance(node, list):
            for item in node:
                walk(item, inherited_pages)

    walk(payload, set())
    for signal in signals.values():
        signal.reasons = unique_preserve(signal.reasons)
    return signals


def collect_standalone_signals(doc: Any, keywords: Sequence[str], figure_number: int | None) -> dict[int, PageSignal]:
    signals: dict[int, PageSignal] = {}
    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        text = page.get_text("text")
        score, reasons = score_text(text, keywords, figure_number)
        if CAPTION_RE.search(text):
            score += 1.0
            reasons.append("figure-caption")
        add_signal(signals, page_index, score, reasons, doc.page_count)

    for signal in signals.values():
        signal.reasons = unique_preserve(signal.reasons)
    return signals


def merge_signals(*signal_sets: dict[int, PageSignal], page_count: int) -> dict[int, PageSignal]:
    merged: dict[int, PageSignal] = {}
    for signal_set in signal_sets:
        for page_index, signal in signal_set.items():
            add_signal(merged, page_index, signal.score, signal.reasons, page_count)
    for signal in merged.values():
        signal.reasons = unique_preserve(signal.reasons)
    return merged


def extract_block_text(block: dict[str, Any]) -> str:
    parts: list[str] = []
    for line in block.get("lines", []):
        if not isinstance(line, dict):
            continue
        for span in line.get("spans", []):
            if not isinstance(span, dict):
                continue
            text = span.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts).strip()


def union_rects(rects: Sequence[Any]) -> Any:
    rect = pymupdf.Rect(rects[0])
    for value in rects[1:]:
        rect |= pymupdf.Rect(value)
    return rect


def expand_rect(rect: Any, page_rect: Any, x_margin: float = 8.0, y_margin: float = 8.0) -> Any:
    expanded = pymupdf.Rect(rect.x0 - x_margin, rect.y0 - y_margin, rect.x1 + x_margin, rect.y1 + y_margin)
    expanded.x0 = max(page_rect.x0, expanded.x0)
    expanded.y0 = max(page_rect.y0, expanded.y0)
    expanded.x1 = min(page_rect.x1, expanded.x1)
    expanded.y1 = min(page_rect.y1, expanded.y1)
    return expanded


def nearest_caption(image_rect: Any, captions: Sequence[tuple[Any, str]]) -> str:
    best_text = ""
    best_distance = float("inf")
    for caption_rect, text in captions:
        distance = caption_rect.y0 - image_rect.y1
        if distance < -40:
            continue
        absolute = abs(distance)
        if absolute < best_distance:
            best_distance = absolute
            best_text = shorten(text)
    return best_text


def derive_caption_clip(page_rect: Any, caption_rect: Any, image_rects: Sequence[Any]) -> Any:
    linked_images = [
        pymupdf.Rect(value)
        for value in image_rects
        if pymupdf.Rect(value).y1 <= caption_rect.y1 + 12 and pymupdf.Rect(value).y0 >= page_rect.y0
    ]
    if linked_images:
        return expand_rect(union_rects(linked_images), page_rect, x_margin=10.0, y_margin=10.0)

    top = max(page_rect.y0, caption_rect.y0 - page_rect.height * 0.42)
    bottom = max(top + 40, caption_rect.y0 - 6)
    clip = pymupdf.Rect(page_rect.x0 + 6, top, page_rect.x1 - 6, bottom)
    return expand_rect(clip, page_rect, x_margin=4.0, y_margin=4.0)


def page_excerpt(text_blocks: Sequence[tuple[Any, str]]) -> str:
    chunks = [text for _rect, text in text_blocks if text]
    return shorten(" ".join(chunks), limit=180)


def build_candidates_for_page(
    doc: Any,
    page_index: int,
    signal: PageSignal,
    keywords: Sequence[str],
    figure_number: int | None,
) -> list[Candidate]:
    page = doc.load_page(page_index)
    page_dict = page.get_text("dict", sort=True)
    blocks = page_dict.get("blocks", [])
    text_blocks: list[tuple[Any, str]] = []
    image_blocks: list[dict[str, Any]] = []

    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == 0:
            text = extract_block_text(block)
            if text:
                text_blocks.append((pymupdf.Rect(block["bbox"]), text))
        elif block_type == 1:
            image_blocks.append(block)

    captions = [(rect, text) for rect, text in text_blocks if CAPTION_RE.match(text)]
    excerpt = page_excerpt(text_blocks)
    candidates: list[Candidate] = []
    page_rect = page.rect

    for image_block in image_blocks:
        image_rect = pymupdf.Rect(image_block["bbox"])
        caption = nearest_caption(image_rect, captions)
        caption_score, caption_reasons = score_text(caption, keywords, figure_number)
        area_ratio = max((image_rect.width * image_rect.height) / max(page_rect.width * page_rect.height, 1.0), 0.0)
        score = signal.score + caption_score + 1.5 + min(area_ratio * 10.0, 4.0)
        reasons = unique_preserve([*signal.reasons, "image-block", *caption_reasons])
        image_bytes = image_block.get("image")
        raw_bytes = image_bytes if isinstance(image_bytes, (bytes, bytearray)) else None
        raw_ext = image_block.get("ext") if isinstance(image_block.get("ext"), str) else "png"
        candidates.append(
            Candidate(
                page_index=page_index,
                page_number=page_index + 1,
                score=score,
                kind="image_block",
                bbox=(image_rect.x0, image_rect.y0, image_rect.x1, image_rect.y1),
                caption=caption,
                page_excerpt=excerpt,
                reasons=reasons,
                raw_bytes=bytes(raw_bytes) if raw_bytes is not None else None,
                raw_ext=raw_ext,
            )
        )

    image_rects = [image_block["bbox"] for image_block in image_blocks]
    for caption_rect, caption_text in captions:
        clip_rect = derive_caption_clip(page_rect, caption_rect, image_rects)
        caption_score, caption_reasons = score_text(caption_text, keywords, figure_number)
        reasons = ["caption-clip", *signal.reasons, *caption_reasons]
        if image_rects:
            reasons.append("caption-linked-image")
        candidates.append(
            Candidate(
                page_index=page_index,
                page_number=page_index + 1,
                score=signal.score + caption_score + 2.0 + (1.5 if image_rects else 0.0),
                kind="caption_clip",
                bbox=(clip_rect.x0, clip_rect.y0, clip_rect.x1, clip_rect.y1),
                caption=shorten(caption_text),
                page_excerpt=excerpt,
                reasons=unique_preserve(reasons),
            )
        )

    if not candidates:
        candidates.append(
            Candidate(
                page_index=page_index,
                page_number=page_index + 1,
                score=max(signal.score, 0.5),
                kind="page_fallback",
                bbox=(page_rect.x0, page_rect.y0, page_rect.x1, page_rect.y1),
                caption="",
                page_excerpt=excerpt,
                reasons=unique_preserve([*signal.reasons, "page-fallback"]),
            )
        )

    return candidates


def dedupe_candidates(candidates: Sequence[Candidate]) -> list[Candidate]:
    deduped: list[Candidate] = []
    seen: set[tuple[int, str, tuple[float, float, float, float]]] = set()
    for candidate in sorted(candidates, key=lambda item: (-item.score, item.page_number, item.kind)):
        rounded_bbox = tuple(round(value, 1) for value in candidate.bbox)
        key = (candidate.page_number, candidate.kind, rounded_bbox)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def export_candidates(doc: Any, candidates: Sequence[Candidate], export_dir: Path, slug: str, dpi: int) -> list[Candidate]:
    export_dir.mkdir(parents=True, exist_ok=True)
    exported: list[Candidate] = []
    for rank, candidate in enumerate(candidates, start=1):
        page = doc.load_page(candidate.page_index)
        clip_rect = pymupdf.Rect(candidate.bbox)
        if clip_rect.width < 2 or clip_rect.height < 2:
            clip_rect = page.rect

        png_path = export_dir / f"{slug}__p{candidate.page_number:03d}__cand{rank}.png"
        pixmap = page.get_pixmap(clip=clip_rect, dpi=dpi)
        pixmap.save(png_path)
        candidate.output_path = relative_to_cwd(png_path)

        if candidate.raw_bytes is not None:
            raw_ext = candidate.raw_ext or "png"
            raw_path = export_dir / f"{slug}__p{candidate.page_number:03d}__cand{rank}__raw.{raw_ext}"
            raw_path.write_bytes(candidate.raw_bytes)
            candidate.raw_path = relative_to_cwd(raw_path)

        exported.append(candidate)
    return exported


def main() -> int:
    args = parse_args()
    pdf_path = Path(args.pdf_path)
    if not pdf_path.exists():
        print(json.dumps({"error": f"PDF not found: {pdf_path.as_posix()}"}))
        return 1

    output_root = Path(args.output_root)
    export_dir = output_root / "exports"
    manifest_dir = output_root / "manifests"
    output_root.mkdir(parents=True, exist_ok=True)
    export_dir.mkdir(parents=True, exist_ok=True)
    manifest_dir.mkdir(parents=True, exist_ok=True)

    query = args.query.strip()
    figure_number = infer_figure_number(query, args.figure_number)
    keywords = derive_keywords(query)

    doc = pymupdf.open(pdf_path.as_posix())
    try:
        pageindex_tree = resolve_pageindex_tree(pdf_path, args.pageindex_tree, args.pageindex_manifest)

        explicit_signals: dict[int, PageSignal] = {}
        for page_hint in args.page_hint:
            add_signal(explicit_signals, page_hint - 1, 20.0, ["explicit-page-hint"], doc.page_count)

        pageindex_signals = collect_pageindex_signals(pageindex_tree, keywords, figure_number, doc.page_count)
        standalone_signals = collect_standalone_signals(doc, keywords, figure_number)
        merged_signals = merge_signals(explicit_signals, pageindex_signals, standalone_signals, page_count=doc.page_count)

        if merged_signals:
            shortlisted = sorted(merged_signals.items(), key=lambda item: (-item[1].score, item[0]))[: max(args.max_pages, 1)]
            selected_pages = [page_index for page_index, _signal in shortlisted]
        else:
            selected_pages = list(range(min(doc.page_count, max(args.max_pages, 1))))

        source_mode = "pageindex-assisted" if any(page_index in pageindex_signals for page_index in selected_pages) else "standalone"

        candidates: list[Candidate] = []
        selected_page_payload: list[dict[str, Any]] = []
        for page_index in selected_pages:
            signal = merged_signals.get(page_index, PageSignal(score=0.5, reasons=["default-page"]))
            selected_page_payload.append(
                {
                    "page_index": page_index,
                    "page_number": page_index + 1,
                    "score": round(signal.score, 3),
                    "reasons": unique_preserve(signal.reasons),
                }
            )
            candidates.extend(build_candidates_for_page(doc, page_index, signal, keywords, figure_number))

        deduped_candidates = dedupe_candidates(candidates)
        top_candidates = deduped_candidates[: max(args.top_k, 1)]

        slug_source = args.slug or f"{pdf_path.stem}-{slugify(query)}"
        exported_candidates = export_candidates(doc, top_candidates, export_dir, slug_source, args.dpi)
        selected_candidate = exported_candidates[0] if exported_candidates else None

        summary = {
            "generated_at": now_utc_iso(),
            "source_mode": source_mode,
            "pdf_path": relative_to_cwd(pdf_path),
            "query": query,
            "keywords": keywords,
            "figure_number": figure_number,
            "pageindex_tree_path": relative_to_cwd(pageindex_tree) if pageindex_tree is not None else None,
            "selected_pages": selected_page_payload,
            "selected": selected_candidate.to_dict() if selected_candidate is not None else None,
            "candidates": [candidate.to_dict() for candidate in exported_candidates],
            "agent_verification_prompt": (
                "Inspect the exported candidate images directly and confirm which one best matches the request. "
                "Prefer the architecture or pipeline overview only if the visual content and nearby caption agree."
            ),
        }

        manifest_path = manifest_dir / f"{slug_source}.json"
        manifest_path.write_text(json.dumps(summary, indent=2), encoding="utf8")
        (output_root / "manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf8")

        result = {
            "source_mode": source_mode,
            "manifest_path": relative_to_cwd(manifest_path),
            "selected": summary["selected"],
            "candidates": summary["candidates"],
        }
        print(json.dumps(result, indent=2))
        return 0
    finally:
        doc.close()


if __name__ == "__main__":
    raise SystemExit(main())
