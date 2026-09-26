# Speechform Light

Speechform Light is Speechform with no model, no TouchDesigner, no Python and no key. It is three small files that run in any modern browser. The whole thing is about 50 KB.

- **Hearing** uses the browser's own speech recognition. Chrome and Safari have it; Chrome sends the audio to Google's recognition service, and Safari to Apple's. You can also type a phrase.
- **Judging** is an algorithm (`classify.js`). A kind of speech earns points from marker words and phrases, such as "once upon", "therefore" or "valley", and from how the passage is built: commands, questions, "I" and "you", past tense, run-on "and"s and refrains. Each phrase is judged with the minute of talk before it, and the newest words count most. Every point can be traced to a word or a shape of the sentence, and the classifier screen shows exactly which.
- **Growing and drawing** use the same ten images as the TouchDesigner version (`growers.js`, a direct port of `imagery/growers.py`). They are drawn on a canvas at thirty frames a second with trails and a soft glow, and nothing is drawn while the page is hidden.
- **Deciding** uses the stand-in rules: warmth from warm and cool words, tempo from the pace of speech, trails from how often ideas return. No LLM is involved.
- **Memory** is kept in the browser, on this device only.

## Try it

Open `index.html` through any web server, for example `python3 -m http.server` inside this folder, then visit `http://localhost:8000`. Microphones need a secure page (`https://` or `localhost`). With the full Speechform server running, it is also served at `http://127.0.0.1:9990/light/`.

## How accurate it is

`node eval.js` measures the classifier on the same test passages as the full version (`passages.json`, exported from `tests/passages.py`):

| | Whole passages | Six-word fragments, rolling window |
| --- | --- | --- |
| Speechform Light (algorithm) | 27 of 29 | 80% right kind, 83% right image |
| Speechform (MiniLM model) | 27 of 29 | about 90% right kind |

Most of the light version's misses land on a neighbouring kind that grows the same image: reading aloud or story, lesson or instruction, myth or lore. The marker lists were written with these passages in view, so real speech will score somewhat lower. To tune it, add markers in `classify.js` and run `node eval.js`.
