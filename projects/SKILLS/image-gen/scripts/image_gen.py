#!/usr/bin/env python3
"""Generate or edit images with Google Gemini (Nano Banana) or OpenAI GPT Image models."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
from contextlib import ExitStack
from pathlib import Path
from typing import Any, Callable


DEFAULT_MODEL_NAME = "gemini-nano-banana-2.1"
# IMAGE_GEN_MODEL is written by `opencolab ignite`; NANO_BANANA_MODEL is the
# legacy override from the former nano-banana skill and is still honored.
MODEL_ENV_VARS = ("IMAGE_GEN_MODEL", "NANO_BANANA_MODEL")
OPENAI_MODEL_PREFIXES = ("gpt-image-", "chatgpt-image-")
PROVIDER_API_KEY_ENV_VARS = {"gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY"}
PROVIDER_PACKAGES = {"gemini": "google-genai", "openai": "openai"}
DEFAULT_RESPONSE_MODALITIES = ["TEXT", "IMAGE"]
OPENAI_STANDARD_SIZES = {"square": "1024x1024", "landscape": "1536x1024", "portrait": "1024x1536"}
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
REPO_ROOT = SKILL_DIR.parent.parent.parent
ENV_LOCAL_PATH = REPO_ROOT / ".env.local"
ENV_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ASPECT_RATIO_PATTERN = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$")
DEFAULT_OUTPUT_ROOT = Path("images")


def parse_args() -> argparse.Namespace:
    default_model = resolve_default_model()
    parser = argparse.ArgumentParser(
        description="Generate or edit images with Gemini (Nano Banana) or OpenAI GPT Image models."
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
        help="Reference image to include. Repeat for multiple inputs. With OpenAI models, inputs switch the request to an edit.",
    )
    parser.add_argument(
        "--model",
        default=default_model,
        help=(
            f"Image model to call. gpt-image-*/chatgpt-image-* models use OpenAI, everything else uses Gemini. "
            f"Default: {default_model}."
        ),
    )
    parser.add_argument(
        "--aspect-ratio",
        help="Image aspect ratio such as 1:1, 4:5, 16:9. OpenAI models map it to the closest standard size unless --size is set.",
    )
    parser.add_argument(
        "--image-size",
        help="Gemini only: output resolution such as 1K, 2K, or 4K.",
    )
    parser.add_argument(
        "--google-search",
        action="store_true",
        help="Gemini only: enable Google Search grounding for more accurate real-world references.",
    )
    parser.add_argument(
        "--image-only",
        action="store_true",
        help="Gemini only: request image-only output instead of text plus image.",
    )
    parser.add_argument(
        "--size",
        help="OpenAI only: auto, 1024x1024, 1536x1024, 1024x1536, or another WIDTHxHEIGHT the model accepts.",
    )
    parser.add_argument(
        "--quality",
        choices=["auto", "low", "medium", "high", "xhigh", "max"],
        help="OpenAI only: rendering quality.",
    )
    parser.add_argument(
        "--background",
        choices=["auto", "transparent", "opaque"],
        help="OpenAI only: background handling. transparent needs png, webp, or gif output.",
    )
    parser.add_argument(
        "--output-format",
        choices=["png", "jpeg", "webp", "gif", "svg"],
        help="OpenAI only: output file format. gif is animated, svg is vector.",
    )
    parser.add_argument(
        "--count",
        type=int,
        help="OpenAI only: number of images to return (1-10).",
    )
    parser.add_argument(
        "--output-prefix",
        type=Path,
        help="Path prefix for saved files. Example: images/diagram -> images/diagram_01.png and images/diagram.json.",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Retry count for failed API requests.",
    )
    return parser.parse_args()


def main() -> int:
    load_env_local()
    args = parse_args()
    provider = provider_for_model(args.model)

    api_key_env_var = PROVIDER_API_KEY_ENV_VARS[provider]
    api_key = os.getenv(api_key_env_var)
    if not api_key:
        print(
            f"{api_key_env_var} is not set for model {args.model}. Checked process environment and {ENV_LOCAL_PATH}.",
            file=sys.stderr,
        )
        return 2

    if not provider_package_available(provider):
        package = PROVIDER_PACKAGES[provider]
        print(
            f"{package} is not installed. Install it with: python3 -m pip install {package}",
            file=sys.stderr,
        )
        return 2

    for warning in unsupported_option_warnings(args, provider):
        print(f"Warning: {warning}", file=sys.stderr)

    prompt = load_prompt(args)
    input_paths = [path.resolve() for path in args.input]
    validate_input_paths(input_paths)
    output_prefix = resolve_output_prefix(args.output_prefix)
    output_prefix.parent.mkdir(parents=True, exist_ok=True)

    print(
        f"Running image request with provider={provider} model={args.model} inputs={len(input_paths)} output_prefix={output_prefix}",
        file=sys.stderr,
    )

    try:
        if provider == "openai":
            options = openai_options(args)
            images, text_chunks = generate_with_openai(
                api_key=api_key,
                model=args.model,
                prompt=prompt,
                input_paths=input_paths,
                options=options,
                retries=args.retries,
            )
        else:
            options = gemini_options(args)
            images, text_chunks = generate_with_gemini(
                api_key=api_key,
                model=args.model,
                prompt=prompt,
                input_paths=input_paths,
                options=options,
                retries=args.retries,
            )
        saved_images = persist_outputs(
            images=images,
            text_chunks=text_chunks,
            output_prefix=output_prefix,
        )
        summary_path = write_summary(
            output_prefix=output_prefix,
            provider=provider,
            model=args.model,
            prompt=prompt,
            input_paths=input_paths,
            saved_images=saved_images,
            text_chunks=text_chunks,
            options=options,
        )
    except Exception as exc:
        print(f"Image request failed: {exc}", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "provider": provider,
                "model": args.model,
                "images": [str(path) for path in saved_images],
                "text_path": str(output_prefix.with_suffix(".txt")) if text_chunks else None,
                "summary_path": str(summary_path),
            },
            indent=2,
        )
    )
    return 0


def resolve_default_model() -> str:
    for env_var in MODEL_ENV_VARS:
        value = os.getenv(env_var, "").strip()
        if value:
            return value
    return DEFAULT_MODEL_NAME


def provider_for_model(model: str) -> str:
    if model.strip().lower().startswith(OPENAI_MODEL_PREFIXES):
        return "openai"
    return "gemini"


def provider_package_available(provider: str) -> bool:
    try:
        if provider == "openai":
            import openai  # noqa: F401
        else:
            from google import genai  # noqa: F401
    except ImportError:
        return False
    return True


def unsupported_option_warnings(args: argparse.Namespace, provider: str) -> list[str]:
    if provider == "openai":
        ignored = {
            "--image-size": args.image_size,
            "--google-search": args.google_search,
            "--image-only": args.image_only,
        }
        other = "Gemini"
    else:
        ignored = {
            "--size": args.size,
            "--quality": args.quality,
            "--background": args.background,
            "--output-format": args.output_format,
            "--count": args.count,
        }
        other = "OpenAI"
    return [
        f"{flag} only applies to {other} models and is ignored for {args.model}."
        for flag, value in ignored.items()
        if value
    ]


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
    return DEFAULT_OUTPUT_ROOT / f"image-gen-{timestamp}"


def detect_mime_type(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    if mime_type is None:
        raise ValueError(f"could not determine MIME type for input: {path}")
    return mime_type


def with_retries(request: Callable[[], Any], retries: int, label: str) -> Any:
    attempts = max(retries, 1)
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return request()
        except Exception as exc:
            last_error = exc
            if attempt < attempts:
                time.sleep(2 ** (attempt - 1))
    raise RuntimeError(f"{label} request failed after {attempts} attempt(s): {last_error}")


def gemini_options(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "aspect_ratio": args.aspect_ratio,
        "image_size": args.image_size,
        "google_search": args.google_search,
        "image_only": args.image_only,
    }


def generate_with_gemini(
    *,
    api_key: str,
    model: str,
    prompt: str,
    input_paths: list[Path],
    options: dict[str, Any],
    retries: int,
) -> tuple[list[tuple[bytes, str]], list[str]]:
    from google import genai
    from google.genai import types

    request_parts: list[Any] = [prompt]
    for path in input_paths:
        request_parts.append(
            types.Part.from_bytes(
                data=path.read_bytes(),
                mime_type=detect_mime_type(path),
            )
        )

    config_kwargs: dict[str, Any] = {
        "response_modalities": ["IMAGE"] if options["image_only"] else DEFAULT_RESPONSE_MODALITIES,
    }
    image_config_kwargs: dict[str, Any] = {}
    if options["aspect_ratio"]:
        image_config_kwargs["aspect_ratio"] = options["aspect_ratio"]
    if options["image_size"]:
        image_config_kwargs["image_size"] = options["image_size"]
    if image_config_kwargs:
        config_kwargs["image_config"] = types.ImageConfig(**image_config_kwargs)
    if options["google_search"]:
        config_kwargs["tools"] = [{"google_search": {}}]

    client = genai.Client(api_key=api_key)
    response = with_retries(
        lambda: client.models.generate_content(
            model=model,
            contents=request_parts,
            config=types.GenerateContentConfig(**config_kwargs),
        ),
        retries,
        "Gemini",
    )

    images: list[tuple[bytes, str]] = []
    text_chunks: list[str] = []
    for part in iter_gemini_response_parts(response):
        part_text = getattr(part, "text", None)
        if isinstance(part_text, str) and part_text.strip():
            text_chunks.append(part_text.strip())
            continue

        inline_data = getattr(part, "inline_data", None)
        if inline_data is None:
            continue

        mime_type = getattr(inline_data, "mime_type", None) or "image/png"
        images.append((gemini_inline_data_to_bytes(inline_data), extension_for_mime_type(mime_type)))

    if not images:
        raise RuntimeError("Gemini returned no image output")
    return images, text_chunks


def iter_gemini_response_parts(response: Any) -> list[Any]:
    direct_parts = getattr(response, "parts", None)
    if direct_parts:
        return list(direct_parts)

    collected: list[Any] = []
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            collected.append(part)
    return collected


def gemini_inline_data_to_bytes(inline_data: Any) -> bytes:
    data = getattr(inline_data, "data", None)
    if isinstance(data, bytes):
        return data
    if isinstance(data, str):
        return base64.b64decode(data)
    raise ValueError("Gemini returned image data in an unsupported format")


def openai_options(args: argparse.Namespace) -> dict[str, Any]:
    if args.count is not None and not 1 <= args.count <= 10:
        raise ValueError("--count must be between 1 and 10")
    size = args.size or openai_size_for_aspect_ratio(args.aspect_ratio)
    return {
        "size": size,
        "aspect_ratio": args.aspect_ratio,
        "quality": args.quality,
        "background": args.background,
        "output_format": args.output_format,
        "count": args.count,
    }


def openai_size_for_aspect_ratio(aspect_ratio: str | None) -> str | None:
    if not aspect_ratio:
        return None
    match = ASPECT_RATIO_PATTERN.match(aspect_ratio)
    if match is None:
        raise ValueError(f"invalid --aspect-ratio: {aspect_ratio} (expected WIDTH:HEIGHT such as 16:9)")
    ratio = float(match.group(1)) / float(match.group(2))
    if ratio > 1.05:
        return OPENAI_STANDARD_SIZES["landscape"]
    if ratio < 0.95:
        return OPENAI_STANDARD_SIZES["portrait"]
    return OPENAI_STANDARD_SIZES["square"]


def generate_with_openai(
    *,
    api_key: str,
    model: str,
    prompt: str,
    input_paths: list[Path],
    options: dict[str, Any],
    retries: int,
) -> tuple[list[tuple[bytes, str]], list[str]]:
    from openai import OpenAI

    request_kwargs: dict[str, Any] = {"model": model, "prompt": prompt}
    for option_name, request_name in (
        ("size", "size"),
        ("quality", "quality"),
        ("background", "background"),
        ("output_format", "output_format"),
        ("count", "n"),
    ):
        if options[option_name] is not None:
            request_kwargs[request_name] = options[option_name]

    client = OpenAI(api_key=api_key)

    def request() -> Any:
        if not input_paths:
            return client.images.generate(**request_kwargs)
        # Reopen the inputs on every attempt so retries upload from the start.
        with ExitStack() as stack:
            image_files = [stack.enter_context(path.open("rb")) for path in input_paths]
            return client.images.edit(image=image_files, **request_kwargs)

    response = with_retries(request, retries, "OpenAI")

    output_format = getattr(response, "output_format", None) or options["output_format"] or "png"
    extension = extension_for_output_format(output_format)
    images: list[tuple[bytes, str]] = []
    text_chunks: list[str] = []
    for item in getattr(response, "data", None) or []:
        b64_json = getattr(item, "b64_json", None)
        if not b64_json:
            continue
        images.append((base64.b64decode(b64_json), extension))
        revised_prompt = getattr(item, "revised_prompt", None)
        if isinstance(revised_prompt, str) and revised_prompt.strip():
            text_chunks.append(revised_prompt.strip())

    if not images:
        raise RuntimeError("OpenAI returned no image output")
    return images, text_chunks


def extension_for_output_format(output_format: str) -> str:
    normalized = output_format.strip().lower()
    if normalized in {"jpeg", "jpg"}:
        return ".jpg"
    return f".{normalized}"


def extension_for_mime_type(mime_type: str) -> str:
    if mime_type == "image/jpeg":
        return ".jpg"
    guessed = mimetypes.guess_extension(mime_type)
    return guessed or ".png"


def persist_outputs(
    *,
    images: list[tuple[bytes, str]],
    text_chunks: list[str],
    output_prefix: Path,
) -> list[Path]:
    saved_images: list[Path] = []
    for image_bytes, extension in images:
        image_path = output_prefix.parent / f"{output_prefix.name}_{len(saved_images) + 1:02d}{extension}"
        image_path.write_bytes(image_bytes)
        saved_images.append(image_path)

    if text_chunks:
        output_prefix.with_suffix(".txt").write_text(
            "\n\n".join(text_chunks).strip() + "\n",
            encoding="utf-8",
        )

    return saved_images


def write_summary(
    *,
    output_prefix: Path,
    provider: str,
    model: str,
    prompt: str,
    input_paths: list[Path],
    saved_images: list[Path],
    text_chunks: list[str],
    options: dict[str, Any],
) -> Path:
    summary_path = output_prefix.with_suffix(".json")
    payload = {
        "provider": provider,
        "model": model,
        "prompt": prompt,
        "input_images": [str(path) for path in input_paths],
        "output_images": [str(path) for path in saved_images],
        "text_path": str(output_prefix.with_suffix(".txt")) if text_chunks else None,
        "options": options,
        "generated_at_epoch_s": int(time.time()),
    }
    summary_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return summary_path


if __name__ == "__main__":
    raise SystemExit(main())
