#!/bin/sh
# The easel: a small image model on this Mac for the clear side of Speechform's cards.
# Makes its own Python environment (.art), apart from the speech worker, and downloads SDXL Turbo (about 7 GB, once).
set -e
cd "$(dirname "$0")/.."
PY=${PYTHON:-python3}
[ -x .art/bin/python ] || "$PY" -m venv .art
.art/bin/pip install -q --upgrade pip
.art/bin/pip install -q torch diffusers transformers accelerate safetensors pillow
.art/bin/python - <<'PY'
from huggingface_hub import snapshot_download
snapshot_download('stabilityai/sdxl-turbo', allow_patterns=['model_index.json', 'scheduler/*', 'tokenizer/*', 'tokenizer_2/*',
    'text_encoder/config.json', 'text_encoder/*.fp16.safetensors', 'text_encoder_2/config.json', 'text_encoder_2/*.fp16.safetensors',
    'unet/config.json', 'unet/*.fp16.safetensors', 'vae/config.json', 'vae/*.fp16.safetensors'])
print('The easel is ready. Speechform starts it the first time a card needs a picture.')
PY
