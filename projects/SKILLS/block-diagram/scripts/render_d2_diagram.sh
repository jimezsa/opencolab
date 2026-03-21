#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  render_d2_diagram.sh --input file.d2 [--svg out.svg] [--png out.png] [--layout elk|dagre] [--theme 0] [--pad 32] [--style sketch|clean]

Formats, validates, and renders a D2 diagram. SVG is always rendered. PNG is optional.
Default style is sketch for a hand-drawn look.
EOF
}

input_path=""
svg_path=""
png_path=""
layout="elk"
theme="0"
pad="32"
style="sketch"
elk_node_node_between_layers="40"
elk_padding="[top=20,left=20,bottom=20,right=20]"
elk_edge_node_between_layers="20"
dagre_nodesep="40"
dagre_edgesep="16"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input)
      input_path="${2:-}"
      shift 2
      ;;
    --svg)
      svg_path="${2:-}"
      shift 2
      ;;
    --png)
      png_path="${2:-}"
      shift 2
      ;;
    --layout)
      layout="${2:-}"
      shift 2
      ;;
    --theme)
      theme="${2:-}"
      shift 2
      ;;
    --pad)
      pad="${2:-}"
      shift 2
      ;;
    --style)
      style="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$input_path" ]]; then
  printf 'Missing required --input argument\n' >&2
  usage >&2
  exit 1
fi

if [[ ! -f "$input_path" ]]; then
  printf 'Input file not found: %s\n' "$input_path" >&2
  exit 1
fi

if [[ "$input_path" != *.d2 ]]; then
  printf 'Input file must end with .d2: %s\n' "$input_path" >&2
  exit 1
fi

case "$style" in
  sketch|clean)
    ;;
  *)
    printf 'Style must be one of: sketch, clean. Got: %s\n' "$style" >&2
    exit 1
    ;;
esac

base_path="${input_path%.d2}"
svg_path="${svg_path:-${base_path}.svg}"

d2_style_args=()
if [[ "$style" == "sketch" ]]; then
  d2_style_args+=(--sketch)
fi

render_args=(
  --layout "$layout"
  --theme "$theme"
  --pad "$pad"
  --omit-version
)
if [[ "$layout" == "elk" ]]; then
  render_args+=(
    --elk-nodeNodeBetweenLayers "$elk_node_node_between_layers"
    --elk-padding "$elk_padding"
    --elk-edgeNodeBetweenLayers "$elk_edge_node_between_layers"
  )
fi
if [[ "$layout" == "dagre" ]]; then
  render_args+=(
    --dagre-nodesep "$dagre_nodesep"
    --dagre-edgesep "$dagre_edgesep"
  )
fi
if [[ ${#d2_style_args[@]} -gt 0 ]]; then
  render_args+=("${d2_style_args[@]}")
fi

mkdir -p "$(dirname "$svg_path")"
if [[ -n "$png_path" ]]; then
  mkdir -p "$(dirname "$png_path")"
fi

d2 fmt "$input_path" >/dev/null
d2 validate "$input_path"

d2 "${render_args[@]}" "$input_path" "$svg_path" >/dev/null

if [[ ! -f "$svg_path" ]]; then
  printf 'SVG render did not produce an output file: %s\n' "$svg_path" >&2
  exit 1
fi

if [[ -n "$png_path" ]]; then
  d2 "${render_args[@]}" "$input_path" "$png_path" >/dev/null

  if [[ ! -f "$png_path" ]]; then
    printf 'PNG render did not produce an output file: %s\n' "$png_path" >&2
    exit 1
  fi
fi

printf 'source=%s\n' "$input_path"
printf 'svg=%s\n' "$svg_path"
printf 'style=%s\n' "$style"
if [[ -n "$png_path" ]]; then
  printf 'png=%s\n' "$png_path"
fi
