# Speechform in a browser and on an iPhone

TouchDesigner cannot run in a browser or on a phone. Speechform can, because its image is small rules drawing a few thousand shapes, and every other part already has a light equivalent. This note sets out how each part works on each platform, the recommended way to build it, and how to keep it light.

## The five parts, and what replaces TouchDesigner

| Part | On the Mac today | In a browser | On an iPhone |
| --- | --- | --- | --- |
| **Hearing**: speech to text | Apple SpeechAnalyzer, in 6-second batches | A small speech model running in the page (Moonshine or Whisper through transformers.js), or the browser's own speech recognition | Apple SpeechAnalyzer, streaming, on the device |
| **Judging**: the kind of speech | MiniLM embeddings in Python, with examples, signals, and a rolling window | The same MiniLM, quantized, running in the page through transformers.js; the examples' vectors are computed once when the site is built | Apple's built-in NLContextualEmbedding (nothing to ship), or MiniLM converted to Core ML |
| **Growing**: where every shape stands | `growers.py` | `growers.js`, a direct port with the same arithmetic | `Growers.swift`, a direct port |
| **Drawing**: the image | TouchDesigner: instancing, feedback, bloom | WebGL2 with instanced shapes, a feedback texture, and one blur pass | Metal (or the same WebGL page inside the app) |
| **Deciding**: Jev | a stand-in, Jev's endpoint, Claude, or a local model | the stand-in in the page, or Jev's endpoint | the stand-in, Jev's endpoint, or Apple's on-device Foundation Models |

The contract between the parts stays the same everywhere: phrases with their kind and idea go in, and a direction (`register`, `mix`, `grow`, `warmth` …) comes out. A Jev written for the Mac drives the phone without change.

## Recommended: one web core, used in three places

Build the judging, growing, drawing and memory once as a small web module. Use it in three places:

1. **The browser**, as an installable web app (a PWA). It works offline after the first visit.
2. **The Mac app**, which is already a native window around a web page. It would draw the image itself; TouchDesigner becomes optional.
3. **The iPhone app**, a native shell around the same page. The shell adds only what the phone does better natively: Apple's on-device transcription, and Apple's on-device model as a free local Jev. The shell passes phrases into the page and the page answers with the image.

TouchDesigner stays the studio instrument: the high-fidelity renderer for installations and recordings, steered by the same direction.

This is the best path for three reasons:

- **One implementation** of the ten images means they look the same everywhere, and every improvement lands everywhere at once.
- **The phone's hard part**, hearing, is best done natively, and Apple's speech framework is free, private and streaming.
- **The drawing is small.** At most a few thousand instanced shapes a frame is light work for any phone's GPU through WebGL2, which Safari on iOS supports.

A fully native iPhone app (Swift and Metal throughout) would be a little lighter and smoother. It would also be a second copy of every image to maintain, so it is worth doing only once the images have settled.

## How it is kept light

**Drawing**

- Each shape is drawn as an instance of one small mesh (a petal, a hexagon, a stone), so the whole image is ten draw calls or fewer.
- The canvas renders at 360 to 540 pixels and is scaled up by the page. The images are soft glows, so the lower resolution does not show.
- The frame rate is 30, and drops to 10 when nothing is growing or swaying. Nothing is drawn when the app is in the background.
- The glow comes from one blur at quarter size. The trails come from one feedback texture that fades a little each frame.

**Judging**

- Judging runs once per phrase, never per frame.
- MiniLM quantized to 8 bits is about 23 MB. It is downloaded once and then cached. On iPhone, the operating system's own embedding model adds nothing to the app.
- The examples' vectors are computed once at build time and shipped as a small file of about 150 KB.
- One phrase takes tens of milliseconds, and the rolling window reuses each phrase's scores rather than re-embedding the minute.

**Hearing**

- On iPhone and Mac, Apple's streaming transcription replaces the 6-second batches. It is faster, and it adds nothing to download.
- In a browser there is a real choice:
  - **The browser's own speech recognition** adds nothing to download. Depending on the browser, audio may be sent to a server; this should be checked per browser.
  - **A small model in the page** (Moonshine tiny is about 27 million parameters) keeps everything on the device, at the cost of a one-time download of tens of megabytes.

**Deciding**

- The stand-in costs nothing.
- Jev is asked every few seconds with the last few phrases, a few hundred words, and answers with a few numbers.
- On iPhone, Apple's Foundation Models can play a local Jev: free, offline, with structured answers.
- A cloud key must never ship inside a web page or an app. Jev and Claude are reached through the person's own endpoint or a small relay that holds the key.

**Rough size**

| | Download | When running |
| --- | --- | --- |
| Web core (code, examples, shapes) | about 200 KB | a few percent of one core, drawing |
| MiniLM, quantized | about 23 MB, once | tens of milliseconds per phrase |
| Speech model, only if needed in the browser | tens of MB, once | continuous while listening |
| iPhone app | a few MB, plus the web core | Apple's own models, nothing extra |

Some of these figures are estimates, to be confirmed while building: the in-browser speech model, and how each browser treats its own speech recognition.

## Order of work

1. **`growers.js` and the WebGL renderer.** Port the ten growers and draw them in the app's top screen from the state the Mac already produces. This proves the look matches TouchDesigner, side by side.
2. **Judging in the page.** Add `forms`, `signals` and the rolling window in JavaScript with transformers.js. Check them against `tests/passages.py`, which should give the same answers as Python.
3. **The PWA.** Hearing in the browser, memory in IndexedDB, and the stand-in in the page, so a phone browser runs Speechform alone.
4. **The iPhone shell.** A native window around the web core, Apple's SpeechAnalyzer feeding it phrases, and Foundation Models offered as a local Jev.
