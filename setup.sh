#!/bin/bash
# One-time setup: Python env with ManimGL + node modules + UI build.
set -e
cd "$(dirname "$0")"
if command -v uv >/dev/null 2>&1; then UV=uv; elif [ -x "$HOME/.local/bin/uv" ]; then UV="$HOME/.local/bin/uv"; fi
if [ ! -x engine/.venv/bin/python ]; then
  if [ -n "$UV" ]; then
    "$UV" venv --python 3.12 engine/.venv
  else
    python3 -m venv engine/.venv
  fi
fi
if [ -n "$UV" ]; then
  "$UV" pip install --python engine/.venv/bin/python manimgl "setuptools<81" onnxruntime tokenizers huggingface_hub
else
  engine/.venv/bin/python -m pip install manimgl "setuptools<81" onnxruntime tokenizers huggingface_hub
fi
# semantic library search model (~130 MB, cached in ~/.cache/huggingface); optional — keyword search works without it
engine/.venv/bin/python -c "from huggingface_hub import snapshot_download as d; d('BAAI/bge-small-en-v1.5', allow_patterns=['onnx/model.onnx','tokenizer.json','config.json'])" || echo "(semantic search model not downloaded — will retry on first launch)"
npm install
npm run build
echo "✓ Setup complete — run ./MathStudio.command (or npm start)"
