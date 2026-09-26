# Speechform for agents

This guide is for Claude Code, Codex, or any agent working with Speechform. It covers the image while someone speaks, the code, and the TouchDesigner network. Everything runs locally on 127.0.0.1.

## 1. Start it

```sh
./setup.sh                               # once
.worker/bin/python imagery/server.py &   # the server on http://127.0.0.1:9990 (it also starts the speech worker)
open -a TouchDesigner Speechform.toe     # the image and the microphone (or POST /touchdesigner)
```

Check that it is running with `curl -s 127.0.0.1:9990/status`. The response shows whether TouchDesigner is drawing, whether the worker is alive, and whether the microphone is on.

## 2. Steer the image (be Jev)

An agent can direct the image as often as once a second. Read what is being said, then send decisions.

**Read:** `GET /listen`

```json
{ "transcript": [{"text": "The moon is a silver wound upon the sea.", "form": "poetry", "speaker": "A", "idea": "7a001676", "at": 1790372002.1}],
  "form": "poetry", "active_idea": "7a001676",
  "ideas": [{"id": "7a001676", "title": "Moon silver wound upon", "words": 21, "returns": 0}],
  "registers": ["bloom","path","land","hive","orrery","rings","stack","kelp","tide","waves"],
  "direction": {"warmth": 0.4, "tempo": 0.8}, "directed_by": "director" }
```

**Write:** `POST /direct`. Every key is optional. Send only what you mean to change.

| Key | Range | Effect |
| --- | --- | --- |
| `register` | one of the ten | brings one image fully forward |
| `mix` | `{"path": 0.8, "land": 0.5}`, each 0 to 1 | several images at once (`{}` hands the choice back to the classifier) |
| `grow` | `{"bloom": 12}` | adds that many words' worth of growth |
| `warmth` | 0 to 1 | cool light to warm light |
| `hue` | -0.5 to 0.5 | turns the whole palette |
| `saturation` | 0 to 1 | |
| `tempo` | 0.3 to 2 | how fast things sway, orbit and turn |
| `density` | 0.5 to 2 | how thickly each image grows per word |
| `memory` | 0 to 1 | how long the canvas keeps trails |
| `drift` | 0 to 3 | how far the canvas slides as it remembers |
| `seed` | any number | a new variation of the same image |
| `why` | a sentence | shown in the app's decision log |

A post takes charge for 8 seconds. After that, the stand-in director resumes.

A minimal Jev in Python:

```python
import json, time, urllib.request
BASE = 'http://127.0.0.1:9990'
def get(p): return json.load(urllib.request.urlopen(BASE + p))
def post(p, d): urllib.request.urlopen(urllib.request.Request(BASE + p, json.dumps(d).encode(), {'content-type': 'application/json'}))
while True:
    heard = get('/listen')
    last = heard['transcript'][-1]['text'] if heard['transcript'] else ''
    if 'sea' in last or 'river' in last:
        post('/direct', {'mix': {'waves': 1, 'land': 0.4}, 'warmth': 0.2, 'why': 'water in the last phrase'})
    time.sleep(3)
```

To have Speechform call an agent instead, choose **Jev** under the key icon and give an endpoint. Every few seconds, Speechform POSTs the `/listen` payload to that endpoint with `Authorization: Bearer <key>`. It expects the same JSON as `/direct` in reply. Claude (Anthropic API) and any OpenAI-compatible local model are built in as well.

## 3. Other endpoints

| Call | Does |
| --- | --- |
| `GET /state` | everything the app shows, including each phrase's full reasoning under `why` |
| `GET /memory` | everything said in the app, newest first |
| `POST /say` `{"text": "...", "speaker": "A"}` | a typed phrase, classified like speech (add `"test": true` so it stays out of memory) |
| `POST /start` | opens TouchDesigner if needed, then listens |
| `POST /stop` | stops listening |
| `POST /intake` `{"action": "reset"}` | starts a new session |
| `POST /settings` `{"provider": "claude", "key": "...", "model": "...", "every": 3}` | who decides (the key is saved locally and never returned) |
| `POST /settings/test` | asks the chosen provider once |

## 4. Change the TouchDesigner network

`imagery/tdx.py` runs Python inside the open project. It drops a file in `runtime/exec/`, and `td_runtime.py` runs it on TouchDesigner's main thread within a few frames. Set `result` to return a value.

```sh
imagery/tdx.py -c "result = [c.name for c in op('/project1/loom').children]"
imagery/tdx.py my_build_step.py
```

Rules learned the hard way:

- Save the image network as its component: `op('/project1/loom').save(project.folder + '/imagery/loom.tox')`. Do not call `project.save()` from a script, because it can lock TouchDesigner. A person saves the whole project with ⌘S.
- Use `td.absTime`, not `absTime`, in these scripts.
- Keep each script short, and read values in a separate call from the one that changes them.
- Parameter names often differ from what you expect. List them first, for example `[p.name for p in o.pars()]` or `o.par.x.menuNames`.
- Script CHOPs do not cook unless something pulls them. The `heartbeat` Execute DAT in the loom cooks the growers, the output and the recorder every frame.
- Use file paths relative to the project folder, such as `imagery/growers.py`, so the project runs from any folder.
- To look at the image, run `op('/project1/loom/out').save('/tmp/look.jpg')` and open the file.
- At start, `td_runtime.configure()` sets thirty frames a second, turns off `/project1/speech_gates/modules`, and opens the perform window on `/project1/loom/out`. To measure cost, read `cpuCookTime` on operators where `cookedThisFrame` is true.

## 5. Where things are

| Path | What it is |
| --- | --- |
| `Speechform.toe` | the TouchDesigner project: microphone intake, the first-pass visual worlds, and the loom |
| `imagery/loom.tox`, `imagery/growers.py` | the image network and its rules of growth |
| `imagery/server.py`, `imagery/app/index.html` | the server and the app page |
| `forms.py`, `signals.py`, `engine.py`, `worker.py` | the kinds of speech and their examples, the structural signals, classification over the last minute, and the worker process |
| `tests/passages.py` | passages for measuring the classifier on form rather than topic |
| `Transcribe.swift` | Apple on-device transcription (built to `bin/transcribe`) |
| `td_runtime.py` | TouchDesigner's link to the worker, the direction file and the exec channel |
| `mac/` | the Mac app |
| `runtime/`, `sessions/` | a person's speech, state and memory; never committed |

To add a kind of image, write a grower in `growers.py`, then add its Script CHOP, Geometry COMP and material in the loom, following the ten already there. Map speech forms to it in `FORM_TO_REGISTER`, and add a colour in `app/index.html`.

## 6. Contributing

Keep everything local by default and never commit anything from `runtime/`, `sessions/`, `models/` or `~/.config/speechform`. Run `.worker/bin/python -m unittest tests.test_engine tests.test_forms` before sending a change. To add or change a kind of speech, edit `forms.py`: give it examples on varied subjects, and check the test passages still pass.
