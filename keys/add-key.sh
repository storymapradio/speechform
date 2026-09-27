#!/bin/zsh
# Speechform Keys: one place to add a key for all of Speechform (full, Light, Heavy).
# A Mac dialog takes the key; it is saved in ~/.config/speechform/settings.json (readable only by
# you) and in the login Keychain as "speechform", then tested, and the result is said plainly.
ROOT="$(defaults read org.speechform.app root 2>/dev/null)"; [[ -d "$ROOT" ]] || ROOT="${0:A:h}/../../../../.."
dialog() { osascript -e "display dialog \"$1\" buttons {\"OK\"} default button 1 with title \"Speechform Keys\"" >/dev/null 2>&1; }
KEY=$(osascript -e 'display dialog "Paste your key. Keys from Jev (apikey_), OpenAI (sk-), Google Gemini (AIza) and Anthropic (sk-ant-) need nothing else." default answer "" with hidden answer buttons {"Cancel", "Save"} default button 2 with title "Speechform Keys"' -e 'text returned of result' 2>/dev/null) || exit 0
KEY="${KEY//[[:space:]]/}"
[[ -z "$KEY" ]] && exit 0
ADDR=""
case "$KEY" in
  apikey_*|tsk_*|sk-ant-*|sk-*|AIza*) ;;
  *) ADDR=$(osascript -e 'display dialog "This key is not from Jev, OpenAI, Gemini or Anthropic. Enter the address that came with it (it starts with https://)." default answer "https://" buttons {"Cancel", "Save"} default button 2 with title "Speechform Keys"' -e 'text returned of result' 2>/dev/null) || exit 0 ;;
esac
# the Keychain, for anything else on this Mac that needs the key
security add-generic-password -U -a "$USER" -s speechform -l "Speechform key" -w "$KEY" >/dev/null 2>&1
# Speechform's own settings: through the server if it is running, else straight to the file
URL=http://127.0.0.1:9990
if ! curl -s -m 1 -o /dev/null "$URL/status"; then
  (cd "$ROOT" && PY=.worker/bin/python && { [[ -x $PY ]] || PY=python3; } && nohup $PY imagery/server.py >> runtime/server.log 2>&1 &)
  for i in {1..40}; do curl -s -m 1 -o /dev/null "$URL/status" && break; sleep .25; done
fi
BODY=$(KEY="$KEY" ADDR="$ADDR" python3 -c 'import json,os; a=os.environ["ADDR"].strip(); print(json.dumps({"provider": "jev" if a and a != "https://" else "auto", "endpoint": a if a != "https://" else "", "key": os.environ["KEY"]}))')
print -r -- "$BODY" | curl -s -m 5 -X POST "$URL/settings" --data-binary @- >/dev/null
SAYS=$(curl -s -m 30 -X POST "$URL/jev/test" -d '{}' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(("Works. " if d.get("ok") else "Saved, but not working yet. ") + d.get("says",""))' 2>/dev/null)
dialog "${SAYS:-Saved. The Speechform server did not answer the test.}"
