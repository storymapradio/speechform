# The image layer

The image layer of Speechform is `/project1/loom` in **Speechform.toe**, kept in `imagery/loom.tox`. While someone speaks, it grows an image that represents the kind of speech it hears. It contains no text. Its frame is a square of 720 by 720, sized for the top half of a phone.

Open it through **Speechform.app**, or open `Speechform.toe` in TouchDesigner.

## What grows

Every register is an image that grows with the words spoken in it. A new instance swells from nothing, so the growth can be seen as it happens.

| Speech | Register | What grows |
| --- | --- | --- |
| Poetry | bloom | Petals open in a golden-angle spiral. The newest petals sit on the rim. |
| Story, prose, character development | path | A winding trail climbs toward the horizon, with a lantern every few steps. |
| Scenery | land | Ridgelines rise one behind another. |
| Lore, myth | hive | Hexagons are laid ring by ring from the centre. |
| Cosmology | orrery | Bodies join a sun on widening orbits. |
| Mystery, argument | rings | Rings close in on a point. At "the point of all of this is," the centre blinks. |
| Instruction, lecture, lesson | stack | Stones build into a cairn of uneven towers. |
| Reflective monologue, stream of consciousness, thinking aloud | kelp | One kelp stands still. Every idea is a branch off its stalk. Returning to an idea lengthens that branch and adds a frond. |
| Dialogue | tide | Two tides meet where the speakers' share of words balances. |
| Song, lyrics, prosody | waves | Ribbons swell with the voice's energy. |

Several images can stand at once. When the classifier finds speech forms that are nearly tied, each form raises its own image, and the images share the square in proportion. Jev can also set the mix outright. When the leading register changes, an omega gate of light opens and fades.

## How it is built

- **Growers** (`imagery/growers.py`, file-synced into the `growers` DAT) decide where every instance stands. They read the speech state and Jev's direction and write one Script CHOP per register (`grow_<register>`). They supply positions, sizes, turns and colours only.
- **Drawing** is native TouchDesigner. Each register has its own Geometry COMP with its own SOP asset: petal, footfall, ridge grain, hexagon, body, pulse, stone, blade, foam and bead. Each is instanced from its grower with instance colour, through an additive Constant MAT. One orthographic camera and one square Render TOP draw all of them.
- **The canvas** is a 16-bit feedback loop: `fb` feeds `drift` (the canvas slides and turns slightly), which feeds `fade` (memory, with a black floor), which feeds `accum`. It keeps faint trails of what moved. A blur-and-add bloom and an HSV grade follow, then `out`.
- **Crossfades** come from `active` (the mix), through `pick`, into `weights`, a Lag CHOP. An arriving image swells out of the centre, and a leaving image sinks back and dims.
- **The heartbeat** Execute DAT cooks the growers, the output and the recorder every frame, so the canvas keeps moving even when no viewer is open.
- `recorder` writes Motion JPEG `.mov`. It uses no H.264, so it needs no commercial licence. ffmpeg converts the file to MP4 afterward.

## Jev

Jev can drive the image as often as every second through **http://127.0.0.1:9990**, served by `imagery/server.py`.

- `GET /listen` returns the latest transcript lines with their speech form, speaker and idea. It also returns the ideas with their word counts and returns, the registers, and the current direction.
- `POST /direct` accepts any of the following, each optional:

```json
{ "register": "path",
  "mix": {"path": 0.8, "land": 0.5},
  "grow": {"bloom": 12},
  "warmth": 0.7, "hue": 0.05, "saturation": 0.6,
  "tempo": 1.2, "density": 1.0, "memory": 0.6, "drift": 1.0, "seed": 42 }
```

The decisions are written to `runtime/direction.json`, and TouchDesigner reads that file ten times a second. Other tools can write the same file directly.

When Jev is quiet for eight seconds, a stand-in director takes over. It sets warmth from warm and cool words, tempo from the pace of speech, memory from how often ideas return, and a variation seed from the idea in play. To let Jev, Claude or a local model decide, choose it with the Deciding button in the app.

## Working on it

- `imagery/tdx.py` runs Python inside the open project through `runtime/exec/`, which `td_runtime.py` checks every third frame. Use `tdx.py -c "result = op('/project1/loom').children"` or `tdx.py script.py`.
- `td_runtime.ensure_loom()` brings the loom back from `loom.tox` whenever the open project lacks it. After a change, save the COMP with `op('/project1/loom').save('.../imagery/loom.tox')`. Calling `project.save()` from a script can lock TouchDesigner; save the whole project with **⌘S**.
- For a fuller agent bridge, [touchdesigner-mcp](https://github.com/8beeeaaat/touchdesigner-mcp) can be added to the project separately.

## The app

**Speechform.app** is built by `mac/build.sh` from `mac/Speechform.swift`. When it opens, it starts `imagery/server.py`, and its **Open TouchDesigner** button opens the project. Its window has three screens:

- **Top: the image.** Frames stream from a Web Server DAT inside the loom (`frames`, port 9983, `GET /frame.jpg`).
- **Bottom: transcript.** It shows only your own speech and typing, never rehearsal samples or tests, with the kind of speech and the image each phrase grows.
- **Bottom: classifier.** It shows the pipeline (listen, words, embed, compare, choose, idea, direct, grow), with each stage lighting as a phrase passes through. It also shows:
  - word heat, meaning how much each word pulled the phrase toward its form (the engine drops one word at a time and measures the fall);
  - the map of speech, a PCA of the twenty prototypes with the phrase, its nearest forms, the trail of the talk, and the ideas;
  - the twenty scores, which re-sort, with the margin marked;
  - the choice and its reason, and the idea against its threshold;
  - who is directing, the direction gauges, and the image mix;
  - the decision log.
- **Bottom: memory.** It holds everything you have said in the app, across sessions, in `runtime/memory.jsonl`, grouped by day and searchable. Tapping a phrase replays its classification.

The Deciding button chooses who decides. The choices are the stand-in only, Jev (an endpoint and key), Claude (an Anthropic key), or a local model (any OpenAI-compatible endpoint, such as Ollama). Settings live in `~/.config/speechform/settings.json`, which only this user can read.

The engine (`engine.py`) records a `why` on every phrase: all twenty scores, the cues that fired, the margin, the hold count, the reason in words, the idea decision, the map position, and the word saliency.
