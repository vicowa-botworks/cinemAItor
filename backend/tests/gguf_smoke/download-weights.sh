#!/usr/bin/env bash
# Downloads the GGUF smoke-test weights (~13 GB total).
#
#   sd3.5_medium-Q4_0.gguf  city96's SD3.5-medium Q4_0 transformer (GGUF)
#   base/                   the matching diffusers-format SD3.5-medium
#                           component set (3-encoder layout: CLIP-L + CLIP-G
#                           + T5, matching the transformer's 2048 pooled and
#                           4096 joint-attention dims)
#
# Keep the two sources paired as-is: the components come from ONE repackage
# of the same model. Do not swap in pieces from a different mirror — CLIP
# tower sizes / T5 vocab variants must match the transformer, or the
# pipeline fails with token-id or dtype errors.
#
# Usage: bash download-weights.sh [target-dir]   (default: ./weights)

set -euo pipefail

TARGET="${1:-$(cd "$(dirname "$0")" && pwd)/weights}"
GGUF_REPO="https://huggingface.co/city96/stable-diffusion-3.5-medium-gguf/resolve/main"
BASE_REPO="https://huggingface.co/yuvraj108c/stable-diffusion-3.5-medium/resolve/main"

fetch() {
  local url="$1" dest="$2"
  if [ -f "$dest" ] && [ -s "$dest" ]; then
    echo "skip  ${dest#"$TARGET"/} (present)"
    return
  fi
  mkdir -p "$(dirname "$dest")"
  echo "fetch ${url##*/} -> ${dest#"$TARGET"/}"
  curl -L --fail --retry 3 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

fetch "$GGUF_REPO/sd3.5_medium-Q4_0.gguf" "$TARGET/sd3.5_medium-Q4_0.gguf"

for f in \
  model_index.json \
  transformer/config.json \
  text_encoder/config.json text_encoder/model.safetensors \
  text_encoder_2/config.json text_encoder_2/model.safetensors \
  text_encoder_3/config.json \
  text_encoder_3/model-00001-of-00002.safetensors \
  text_encoder_3/model-00002-of-00002.safetensors \
  text_encoder_3/model.safetensors.index.json \
  vae/config.json vae/diffusion_pytorch_model.safetensors \
  tokenizer/merges.txt tokenizer/vocab.json \
  tokenizer/tokenizer_config.json tokenizer/special_tokens_map.json \
  tokenizer_2/merges.txt tokenizer_2/vocab.json \
  tokenizer_2/tokenizer_config.json tokenizer_2/special_tokens_map.json \
  tokenizer_3/spiece.model tokenizer_3/tokenizer.json \
  tokenizer_3/tokenizer_config.json tokenizer_3/special_tokens_map.json \
  scheduler/scheduler_config.json
do
  fetch "$BASE_REPO/$f" "$TARGET/base/$f"
done

echo "weights ready under $TARGET"
