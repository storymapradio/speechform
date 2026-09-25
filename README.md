# Speechform

Speechform listens while you talk. It hears what kind of speech you are making, and it grows an image of that speech as you go. A story lays down a winding path with lanterns, and a poem opens a flower. Scenery raises ridgelines, and a reflection grows one still kelp whose branches are your ideas. Everything grows from what you say, and none of it is text.

Below the image, you can watch the decision being made: the words that pushed it, where the phrase lands among twenty kinds of speech, the scores, the choice and its reason, and who is steering the image. Everything you say is kept in a memory on your own Mac.

![The ten images](docs/registers.jpg)

A one-minute recording is in [docs/demo.mp4](docs/demo.mp4).

## What you see

- **The image (top).** TouchDesigner draws it in a 720 by 720 square, sized for the top half of a phone. Each kind of speech has its own image, and each grows with the words spoken in it. When two kinds are nearly tied, both images share the square.
- **Transcript.** Each phrase you say or type appears with the kind of speech it was heard as and the image it grows. A phrase that returns to an earlier idea is marked with ↺.
- **Classifier.** Each phrase travels a pipeline: listen, words, embed, compare, choose, idea, direct, grow. Each stage lights as the phrase passes through it. The screen also shows the following:
  - **Word heat** lights each word by how much it pulled the phrase toward its kind.
  - **The map** lays out the twenty kinds of speech. The phrase lands among them, with lines drawn to its nearest kinds and a trail of the talk so far.
  - **The scores** are twenty bars that re-sort as each phrase is weighed, with the winning margin marked.
  - **The choice** is stated with its reason, such as "a clear margin of 0.21" or "held until it is heard again".
  - **The idea** shows whether the phrase starts a new idea or returns to one, measured against a threshold.
  - **The direction** shows who is steering the image and every value they set, with a log of each decision and its reasons.
- **Memory.** Everything you have said in Speechform, across every session, grouped by day and searchable. Tap a phrase to watch it being classified again.

| Kind of speech | Image | What grows |
| --- | --- | --- |
| Poetry | bloom | Petals open in a golden-angle spiral. |
| Story, prose, character | path | A winding trail with lanterns climbs toward the horizon. |
| Scenery | land | Ridgelines rise one behind another. |
| Lore, myth | hive | Hexagons are laid ring by ring. |
| Cosmology | orrery | Bodies join a sun on widening orbits. |
| Mystery, argument | rings | Rings close in on a point, and the centre blinks at "the point of all of this is". |
| Instruction, lecture, lesson | stack | Stones build into a cairn. |
| Reflection, stream of consciousness, thinking aloud | kelp | One still stalk grows a branch for each idea. A return lengthens that branch. |
| Dialogue | tide | Two tides meet where the speakers' share of the talk balances. |
| Song, lyrics, prosody | waves | Ribbons swell with the voice. |

## What you need

- **A Mac with macOS 26 or later.** Live transcription uses Apple's on-device SpeechAnalyzer, so no audio leaves your Mac. On an older macOS you can still type phrases.
- **[TouchDesigner](https://derivative.ca/download)**, which draws the image and listens to the microphone. The free Non-Commercial licence is enough. A `.toe` file needs TouchDesigner or TouchPlayer to run. Without TouchDesigner, the transcript, the classifier and the memory still work for typed phrases, and the image screen stays dark.
- **Python 3.11 or later.**

## Install

```sh
git clone https://github.com/storymapradio/speechform.git
cd speechform
./setup.sh
```

`setup.sh` does the following:

- makes the worker's Python environment in `.worker`;
- installs `sentence-transformers` and downloads the small MiniLM model (about 90 MB);
- builds Apple's transcription helper;
- builds `mac/Speechform.app`.

Then open **mac/Speechform.app**. You can move it anywhere; the first time, it asks where the Speechform folder is and remembers the answer.

The same page runs in any browser. Start the server with `.worker/bin/python imagery/server.py`, then visit **http://127.0.0.1:9990**.

## Using it

A row of icons runs across the top.

| Icon | Does |
| --- | --- |
| ≡ | Opens the transcript. |
| ⋄ (four joined points) | Opens the classifier. |
| ◷ | Opens the memory. |
| ▶ | Starts. It opens TouchDesigner if it is not running, then listens. The green dot means TouchDesigner is drawing. |
| ■ | Stops listening. The image holds where it is, and closing the app stops listening too. |
| + | Starts a new session. Memory keeps everything already said. |
| ⚿ (a key) | Holds the provider fields: provider, endpoint, key, model, and how often to ask. **Test** asks the provider once. |

You can also type a phrase below the transcript.

The key fields are optional. With no provider, a built-in stand-in steers the image by simple rules: warmth from warm and cool words, tempo from the pace of speech, trail memory from how often ideas return, and a variation for each idea. You can add one of the following:

- **Jev**, or any decision service. Give its endpoint and key; every few seconds it receives the latest transcript and answers with decisions (see [AGENTS.md](AGENTS.md)).
- **Claude**, with your Anthropic API key. The default model is Claude Haiku 4.5.
- **A local model** through any OpenAI-compatible endpoint, such as [Ollama](https://ollama.com) at `http://127.0.0.1:11434/v1` with `gemma3:1b`.

## Privacy

Speechform needs no account and connects to none. Your speech is transcribed on your Mac and classified on your Mac. Your memory is kept in `runtime/memory.jsonl` and your keys in `~/.config/speechform/settings.json`, and neither is ever part of this repository. The only thing that leaves your Mac is the latest few phrases, sent to the provider you choose, and only if you choose a cloud provider.

## How it works

```
microphone ─ TouchDesigner (Audio Device In CHOP) ─ 6-second batches
    └─ worker.py ─ Apple SpeechAnalyzer (bin/transcribe) ─ phrases
         └─ engine.py ─ MiniLM embedding ─ compared with 20 kinds of speech ─ the choice, the idea, the reasons
              └─ runtime/state.json ─┬─ imagery/server.py ─ the app, the memory, the decision link (port 9990)
                                     │     └─ direction.json ◄─ the stand-in, Jev, Claude or a local model
                                     └─ TouchDesigner /project1/loom ─ growers ─ the image (frames on port 9983)
```

- `engine.py` classifies each phrase and keeps ideas. For every phrase it records all twenty scores, the cues that fired, the margin, the reason, the idea match, a position on the map and the word saliency.
- `imagery/growers.py` holds the rules of growth: where every petal, stone, branch and bead stands. TouchDesigner instances native geometry from it, renders it, and keeps a feedback canvas of what moved.
- `imagery/loom.tox` is the image network. `td_runtime.py` loads it into the project if the project lacks it.
- `imagery/server.py` serves the app and links it all, using only the Python standard library.
- `mac/Speechform.swift` is the Mac app, a native window around the page.

Each kind of speech is judged on each phrase. A new kind is taken when it leads by more than 0.07, or after it has led for two phrases. Ideas are compared with everything said in the session, and each image grows with every word ever spoken in its kind.

## For agents

Claude Code, Codex, or any agent can read the transcript, steer the image, and change the TouchDesigner network. See [AGENTS.md](AGENTS.md).

## Licence

MIT. Speechform uses Apple's Speech framework, [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) (Apache 2.0), and [TouchDesigner](https://derivative.ca) by Derivative, which is installed separately under its own licence. The first pass of the project is described in [docs/speech-gates-first-pass.md](docs/speech-gates-first-pass.md).
