#!/bin/zsh
# Speechform Studio on two screens: the growing image alone on one display (?screen=stage) and every view, large,
# on another (?screen=desk). Both read one live state from the Speechform server, and the record button on either
# starts and stops the recording for both. With one display it opens Studio as one window, as before.
#
#   two-screens.sh            the largest display is the stage, the next largest the desk
#   two-screens.sh --swap     the other way round (or: defaults write org.speechform.app studioSwap -bool true)
#   STAGE_DISPLAY="Name" two-screens.sh    a display by its name (System Settings, Displays)
#   DRY=1 two-screens.sh      print where each window would open, and open nothing
ROOT="$(defaults read org.speechform.app root 2>/dev/null)"
[[ -d "$ROOT" ]] || ROOT="${0:A:h}/../.."
BASE="http://127.0.0.1:9990/studio/"
if ! curl -s -m 1 -o /dev/null "$BASE"; then
  cd "$ROOT" && PY=".worker/bin/python"; [[ -x $PY ]] || PY=python3
  nohup $PY imagery/server.py >> runtime/server.log 2>&1 &
  for i in {1..40}; do curl -s -m 1 -o /dev/null "$BASE" && break; sleep .25; done
fi
SWAP=0; [[ "$1" == "--swap" || "$(defaults read org.speechform.app studioSwap 2>/dev/null)" == "1" ]] && SWAP=1
# the displays, in the top-left coordinates Chrome places windows in: "x y w h name", largest first
DISPLAYS=("${(@f)$(osascript -l JavaScript -e '
ObjC.import("AppKit");
const all = ObjC.unwrap($.NSScreen.screens), H = all[0].frame.size.height;
all.map(s => { const f = s.frame; return { x: f.origin.x, y: H - (f.origin.y + f.size.height), w: f.size.width, h: f.size.height, n: ObjC.unwrap(s.localizedName) }; })
   .sort((a, b) => b.w * b.h - a.w * a.h).map(d => [d.x, d.y, d.w, d.h, d.n].join(" ")).join("\n")')}")
CHROME="/Applications/Google Chrome.app"
if [[ ${#DISPLAYS} -lt 2 || ! -d "$CHROME" ]]; then
  [[ -d "$CHROME" ]] && open -na "Google Chrome" --args --app="$BASE" --window-size=1000,1000 || open "$BASE"
  exit 0
fi
STAGE=1; DESK=2
if [[ -n "$STAGE_DISPLAY" ]]; then
  for i in {1..${#DISPLAYS}}; do [[ "${DISPLAYS[$i]#* * * * }" == "$STAGE_DISPLAY" ]] && STAGE=$i; done
  [[ $STAGE == 1 ]] && DESK=2 || DESK=1
fi
(( SWAP )) && { T=$STAGE; STAGE=$DESK; DESK=$T; }
open_on() {   # open_on <display line> <screen> : a window of its own, placed on that display, full screen
  local d=(${=1}); local dir="$HOME/.config/speechform/chrome-$2"
  if [[ -n "$DRY" ]]; then print "$2 on ${1#* * * * } at ${d[1]%.*},${d[2]%.*} size ${d[3]%.*}x${d[4]%.*}"; return; fi
  mkdir -p "$dir"
  open -na "Google Chrome" --args --user-data-dir="$dir" --no-first-run --app="$BASE?screen=$2" \
    --window-position="${d[1]%.*},${d[2]%.*}" --window-size="${d[3]%.*},${d[4]%.*}" --start-fullscreen
}
open_on "${DISPLAYS[$DESK]}" desk          # the desk hears (it asks once for the microphone)
[[ -z "$DRY" ]] && sleep 1.5
open_on "${DISPLAYS[$STAGE]}" stage
