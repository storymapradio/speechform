#!/bin/zsh
# Speechform Studio: starts the Speechform server beside it if it is not running (for this Mac's own
# transcription), then opens Studio (the classifier and its visualizations, no TouchDesigner) in a window of its own.
ROOT="$(defaults read org.speechform.app root 2>/dev/null)"
[[ -d "$ROOT" ]] || ROOT="${0:A:h}/../../../../.."
URL="http://127.0.0.1:9990/studio/"
if ! curl -s -m 1 -o /dev/null "$URL"; then
  cd "$ROOT" && PY=".worker/bin/python"; [[ -x $PY ]] || PY=python3
  nohup $PY imagery/server.py >> runtime/server.log 2>&1 &
  for i in {1..40}; do curl -s -m 1 -o /dev/null "$URL" && break; sleep .25; done
fi
if [[ -d "/Applications/Google Chrome.app" ]]; then
  open -na "Google Chrome" --args --app="$URL" --window-size=1000,1000
else
  open "$URL"
fi
