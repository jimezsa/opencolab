#!/usr/bin/env python3
"""Generate or edit images with Google Gemini Nano Banana models."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None
    types = None


DEFAULT_MODEL_NAME = "gemini-3-pro-image-preview"
DEFAULT_RESPONSE_MODALITIES = ["TEXT", "IMAGE"]
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
REPO_ROOT = SKILL_DIR.parent.parent.parent
ENV_LOCAL_PATH = REPO_ROOT / ".env.local"
ENV_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
DEFAULT_OUTPUT_ROOT = Path("artifacts") / "nano-banana"


def parse_args() -> argparse.Namespace:
    default_model = os.getenv("NANO_BANANA_MODEL", DEFAULT_MODEL_NAME)
    parser = argparse.ArgumentParser(
        description="Generate or edit images with Google Gemini Nano Banana."
    )
    prompt_group = parser.add_mutually_exclusive_group(required=True)
    prompt_group.add_argument(
        "--prompt",
        help="Direct text prompt for the generation or edit request.",
    )
    prompt_group.add_argument(
        "--prompt-file",
        type=Path,
        help="Read the prompt from a UTF-8 text file.",
    )
    parser.add_argument(
        "--input",
        type=Path,
        action="append",
        default=[],
        help="Reference image to include. Repeat for multiple inputs.",
    )
    parser.add_argument(
        "--model",
        default=default_model,
        help=f"Gemini model name to call. Default: {default_model}.",
    )
    parser.add_argument(
        "--aspect-ratio",
        help="Optional image aspect ratio such as 1:1, 4:5, 16:9, or 21:9.",
    )
    parser.add_argument(
        "--image-size",
        help="Optional image size for Gemini 3 image preview models, such as 1K, 2K, or 4K.",
    )
    parser.add_argument(
        "--google-search",
        action="store_true",
        help="Enable Google Search grounding for more accurate real-world references.",
    )
    parser.add_argument(
        "--image-only",
        action="store_true",
        help="Request image-only output instead of text plus image.",
    )
    parser.add_argument(
        "--output-prefix",
        type=Path,
        help="Path prefix for saved files. Example: out/diagram -> out/diagram_01.png and out/diagram.json.",
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

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print(
            f"GEMINI_API_KEY is not set. Checked process environment and {ENV_LOCAL_PATH}.",
            file=sys.stderr,
        )
        return 2

    if genai is None or types is None:
        print(
            "google-genai is not installed. Install it with: python3 -m pip install google-genai",
            file=sys.stderr,
        )
        return 2

    prompt = load_prompt(args)
    input_paths = [path.resolve() for path in args.input]
    validate_input_paths(input_paths)
    output_prefix = resolve_output_prefix(args.output_prefix)
    output_prefix.parent.mkdir(parents=True, exist_ok=True)

    print(
        f"Running Nano Banana request with model={args.model} inputs={len(input_paths)} output_prefix={output_prefix}",
        file=sys.stderr,
    )

    try:
        response = generate_content(
            api_key=api_key,
            model=args.model,
            prompt=prompt,
            input_paths=input_paths,
            aspect_ratio=args.aspect_ratio,
            image_size=args.image_size,
            google_search=args.google_search,
            image_only=args.image_only,
            retries=args.retries,
        )
        text_chunks, saved_images = persist_response(
            response=response,
            output_prefix=output_prefix,
        )
        summary_path = write_summary(
            output_prefix=output_prefix,
            model=args.model,
            prompt=prompt,
            input_paths=input_paths,
            saved_images=saved_images,
            text_chunks=text_chunks,
            google_search=args.google_search,
            aspect_ratio=args.aspect_ratio,
            image_size=args.image_size,
        )
    except Exception as exc:
        print(f"Nano Banana request failed: {exc}", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "model": args.model,
                "images": [str(path) for path in saved_images],
                "text_path": str(output_prefix.with_suffix(".txt")) if text_chunks else None,
                "summary_path": str(summary_path),
            },
            indent=2,
        )
    )
    return 0


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


def load_prompt(args: argparse.Namespace) -> str:
    if args.prompt is not None:
        prompt = args.prompt.strip()
    else:
        prompt = args.prompt_file.read_text(encoding="utf-8").strip()

    if not prompt:
        raise ValueError("prompt is empty")
    return prompt


def validate_input_paths(input_paths: list[Path]) -> None:
    for path in input_paths:
        if not path.is_file():
            raise ValueError(f"input file does not exist: {path}")
        mime_type = detect_mime_type(path)
        if not mime_type.startswith("image/"):
            raise ValueError(f"input file is not a supported image: {path} ({mime_type})")


def resolve_output_prefix(output_prefix: Path | None) -> Path:
    if output_prefix is not None:
        return output_prefix
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    return DEFAULT_OUTPUT_ROOT / f"run-{timestamp}"


def detect_mime_type(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    if mime_type is None:
        raise ValueError(f"could not determine MIME type for input: {path}")
    return mime_type


def generate_content(
    *,
    api_key: str,
    model: str,
    prompt: str,
    input_paths: list[Path],
    aspect_ratio: str | None,
    image_size: str | None,
    google_search: bool,
    image_only: bool,
    retries: int,
) -> Any:
    request_parts: list[Any] = [prompt]
    for path in input_paths:
        request_parts.append(
            types.Part.from_bytes(
                data=path.read_bytes(),
                mime_type=detect_mime_type(path),
            )
        )

    config_kwargs: dict[str, Any] = {
        "response_modalities": ["IMAGE"] if image_only else DEFAULT_RESPONSE_MODALITIES,
    }
    if aspect_ratio or image_size:
        image_config_kwargs: dict[str, Any] = {}
        if aspect_ratio:
            image_config_kwargs["aspect_ratio"] = aspect_ratio
        if image_size:
            image_config_kwargs["image_size"] = image_size
        config_kwargs["image_config"] = types.ImageConfig(**image_config_kwargs)
    if google_search:
        config_kwargs["tools"] = [{"google_search": {}}]

    last_error: Exception | None = None
    client = genai.Client(api_key=api_key)
    for attempt in range(1, max(retries, 1) + 1):
        try:
            return client.models.generate_content(
                model=model,
                contents=request_parts,
                config=types.GenerateContentConfig(**config_kwargs),
            )
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(2 ** (attempt - 1))
                continue
            break

    raise RuntimeError(f"Gemini request failed after retries: {last_error}")


def persist_response(*, response: Any, output_prefix: Path) -> tuple[list[str], list[Path]]:
    text_chunks: list[str] = []
    saved_images: list[Path] = []

    for part in iter_response_parts(response):
        part_text = getattr(part, "text", None)
        if isinstance(part_text, str) and part_text.strip():
            text_chunks.append(part_text.strip())
            continue

        inline_data = getattr(part, "inline_data", None)
        if inline_data is None:
            continue

        image_bytes = inline_data_to_bytes(inline_data)
        mime_type = getattr(inline_data, "mime_type", None) or "image/png"
        image_path = output_prefix.parent / (
            f"{output_prefix.name}_{len(saved_images) + 1:02d}{extension_for_mime_type(mime_type)}"
        )
        image_path.write_bytes(image_bytes)
        saved_images.append(image_path)

    if not saved_images:
        raise RuntimeError("Gemini returned no image output")

    if text_chunks:
        output_prefix.with_suffix(".txt").write_text(
            "\n\n".join(text_chunks).strip() + "\n",
            encoding="utf-8",
        )

    return text_chunks, saved_images


def iter_response_parts(response: Any) -> list[Any]:
    direct_parts = getattr(response, "parts", None)
    if direct_parts:
        return list(direct_parts)

    collected: list[Any] = []
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            collected.append(part)
    return collected


def inline_data_to_bytes(inline_data: Any) -> bytes:
    data = getattr(inline_data, "data", None)
    if isinstance(data, bytes):
        return data
    if isinstance(data, str):
        return base64.b64decode(data)
    raise ValueError("Gemini returned image data in an unsupported format")


def extension_for_mime_type(mime_type: str) -> str:
    if mime_type == "image/jpeg":
        return ".jpg"
    guessed = mimetypes.guess_extension(mime_type)
    return guessed or ".png"


def write_summary(
    *,
    output_prefix: Path,
    model: str,
    prompt: str,
    input_paths: list[Path],
    saved_images: list[Path],
    text_chunks: list[str],
    google_search: bool,
    aspect_ratio: str | None,
    image_size: str | None,
) -> Path:
    summary_path = output_prefix.with_suffix(".json")
    payload = {
        "model": model,
        "prompt": prompt,
        "input_images": [str(path) for path in input_paths],
        "output_images": [str(path) for path in saved_images],
        "text_path": str(output_prefix.with_suffix(".txt")) if text_chunks else None,
        "google_search": google_search,
        "aspect_ratio": aspect_ratio,
        "image_size": image_size,
        "generated_at_epoch_s": int(time.time()),
    }
    summary_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return summary_path


if __name__ == "__main__":
    raise SystemExit(main())
