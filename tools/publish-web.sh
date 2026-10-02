#!/bin/zsh
# Publish Speechform Studio to the website: copies exactly what studio/index.html needs into the site's speechform/
# folder (by default ~/storymapradio/speechform, served at asynchronousinstruments.com/speechform/), with every
# path pointed under /speechform/. It touches nothing else there: speechform/room/ belongs to another page.
#
#   tools/publish-web.sh [site-folder]
# Then commit speechform/ in the site's repo (explicit paths) and push; Vercel deploys main.
set -e
HERE="${0:A:h}/.."
SITE="${1:-$HOME/storymapradio}"
OUT="$SITE/speechform"
[[ -d "$SITE" ]] || { print "no site folder at $SITE"; exit 1; }
mkdir -p "$OUT/light" "$OUT/studio"
LIGHT=(classify.js growers.js views.js reading.js deck.js hearing.js depth.js)
STUDIO=(steer.js match.js ledger.js local.js jev.js whisper.js whisper-worker.js room.js library.js index-api.js links.js popit.js)
for f in $LIGHT; do cp "$HERE/light/$f" "$OUT/light/$f"; done
for f in $STUDIO; do cp "$HERE/studio/$f" "$OUT/studio/$f"; done
cp "$HERE/lenses.json" "$OUT/lenses.json"          # depth.js reads ../lenses.json beside its own folder
# the page: its scripts move from the Mac server's /light/ and /studio/ to /speechform/light/ and /speechform/studio/
sed -e 's#src="/light/#src="/speechform/light/#g' -e 's#src="/studio/#src="/speechform/studio/#g' \
    -e 's#<title>Speechform Studio</title>#<title>Speechform Studio</title>\n<meta name="description" content="Speak, and watch your speech grow into an image while the classifier, the lenses and the threads read it, all on this device.">#' \
    "$HERE/studio/index.html" > "$OUT/index.html"
# nothing may still point at the Mac server's own paths
if grep -nE '(src|href)="/(light|studio)/' "$OUT/index.html"; then print "a path still points at the Mac server"; exit 1; fi
print "published to $OUT:"
(cd "$SITE" && ls -1 speechform/index.html speechform/lenses.json speechform/light/*.js speechform/studio/*.js)
