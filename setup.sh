#!/bin/zsh
# Sets Speechform up on this Mac: the speech worker's Python, the language model,
# Apple's on-device transcription helper, and the Mac app. Run it once from the Speechform folder.
set -eu
cd "${0:A:h}"
say() { print -P "%F{green}==>%f $1"; }

say "Checking this Mac"
[[ "$(uname)" == "Darwin" ]] || { echo "Speechform runs on macOS."; exit 1; }
major=$(sw_vers -productVersion | cut -d. -f1)
(( major >= 26 )) || echo "macOS $major found. Live transcription uses Apple's SpeechAnalyzer, which needs macOS 26 or later; typing phrases still works."

PY=""
for p in python3.12 python3.13 python3.11 python3; do command -v $p >/dev/null && { PY=$p; break; }; done
[[ -n "$PY" ]] || { echo "Python 3.11 or later is needed: https://www.python.org/downloads/ or 'brew install python@3.12'"; exit 1; }

say "Making the speech worker's Python in .worker"
[[ -x .worker/bin/python ]] || $PY -m venv .worker
.worker/bin/python -m pip install --quiet --upgrade pip
.worker/bin/python -m pip install --quiet -r requirements.txt

say "Downloading the sentence model (all-MiniLM-L6-v2, about 90 MB)"
.worker/bin/python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', cache_folder='models')"

say "Building Apple's on-device transcription helper"
mkdir -p bin runtime/inbox runtime/exec sessions
if (( major >= 26 )); then xcrun swiftc -parse-as-library Transcribe.swift -o bin/transcribe; bin/transcribe --prepare || true
else echo "Skipped: needs macOS 26."; fi

say "Building Speechform.app"
./mac/build.sh

if [[ ! -d /Applications/TouchDesigner.app ]]; then
  echo "TouchDesigner is not installed. It draws the image and listens to the microphone."
  echo "The free Non-Commercial licence is enough: https://derivative.ca/download"
fi
say "Ready. Open mac/Speechform.app, or run: .worker/bin/python imagery/server.py and visit http://127.0.0.1:9990"
