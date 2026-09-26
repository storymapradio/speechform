#!/usr/bin/env python3
"""Speechform server: the app page, the transcript, and the decision link, on http://127.0.0.1:9990

The app (GET /) shows the image TouchDesigner is growing above, and below it three screens:
the transcript, the classifier at work, and the memory of everything said. Behind it:

  GET  /listen    what Jev reads: the latest phrases with their form, speaker and idea,
                  the ideas with their returns, the registers, and the current direction.
  POST /direct    what Jev decides, merged into runtime/direction.json (TouchDesigner reads
                  it ten times a second). Every key is optional:
      register    bloom path land hive orrery rings stack kelp tide waves, brought fully forward
      mix         {"path": 0.8, "land": 0.5}  several images at once, each 0..1
      grow        {"bloom": 12}  words' worth of growth added to a register
      warmth 0..1, hue -0.5..0.5, saturation 0..1, tempo 0.3..2, density 0.5..2,
      memory 0..1, drift 0..3, seed (any number)
  GET  /state     everything the app shows: transcript with each phrase's reasoning, all
                  twenty form scores, the register mix and growth, the decision log.
  POST /say       {"text": "...", "speaker": "A"}  typed speech, classified like spoken speech
  POST /intake    {"microphone": true} or {"action": "rehearsal" | "stop_rehearsal" | "reset" | "export"}
  GET  /status    is TouchDesigner drawing, is the speech worker alive, is the microphone on,
                  who decides and whether a key is saved (the key itself is never sent)
  POST /touchdesigner   opens Speechform.toe in TouchDesigner
  POST /transcribe  a WAV file in, its words out: this Mac's on-device Apple transcription
  POST /start     opens TouchDesigner if it is not running, then listens through the microphone
  POST /stop      stops listening; the image holds where it is
  POST /settings/test   asks the chosen provider once and reports how it went
  POST /settings  {"provider": "jev" | "claude" | "local" | "stand-in", "endpoint", "key", "model", "every"}
                  Stored in ~/.config/loom/jev.json, readable only by this user; the key is never sent back.

Who decides: while nobody has posted to /direct for eight seconds, the director does. It
always runs the stand-in (warmth from the words, tempo from the pace, memory from returns,
a variation per idea) and, when a provider is configured, asks it every few seconds:
  jev       POSTs the /listen payload to your Jev endpoint with the key as a Bearer token
            and takes the JSON it answers with.
  claude    the Anthropic Messages API.
  local     any OpenAI-compatible chat endpoint, such as llama.cpp's server or Ollama
            (http://127.0.0.1:11434/v1), so a small model on this Mac can play Jev.
"""
import json, os, re, sys, threading, time, urllib.request, uuid
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import growers  # the same rules TouchDesigner uses, so the app shows what the Loom does

STATE = ROOT / 'runtime' / 'state.json'
DIRECTION = ROOT / 'runtime' / 'direction.json'
PANEL = ROOT / 'runtime' / 'panel.json'
INBOX = ROOT / 'runtime' / 'inbox'
APP = HERE / 'app'
SETTINGS = Path.home() / '.config' / 'speechform' / 'settings.json'
MEMORY = ROOT / 'runtime' / 'memory.jsonl'   # everything you have said in the app, kept across sessions
YOURS = ('Microphone', 'Typed')              # only your own voice and typing; samples and tests are never kept
PORT = int(os.environ.get('JEV_PORT', '9990'))
REGISTERS = growers.REGISTERS
RANGES = {'warmth': (0, 1), 'hue': (-0.5, 0.5), 'saturation': (0, 1), 'tempo': (0.3, 2), 'density': (0.5, 2),
          'memory': (0, 1), 'drift': (0, 3), 'seed': (-1e6, 1e6)}
WARM = set('sun fire flame gold golden home hearth grandmother mother love warm summer bread honey light lantern amber red heart blood dawn morning'.split())
COOL = set('moon sea ocean silver mist night rain river snow winter blue cold star stars water ice shadow dusk grey gray fog'.split())

lock = threading.Lock()
last_jev = 0.0
current = {}
decisions = deque(maxlen=80)
provider_status = {'state': 'idle', 'last': None, 'error': None, 'latency': None}
remembered = set()

def load_memory():
    try:
        for line in MEMORY.read_text().splitlines():
            try:
                remembered.add(json.loads(line)['id'])
            except (ValueError, KeyError):
                pass
    except OSError:
        pass

def remember(s):
    """keep every phrase you say, with how it was heard, the moment it is classified"""
    titles = {t['id']: t.get('title') for t in s.get('topics', [])}
    new = []
    for e in s.get('events', []):
        if e.get('source') in YOURS and e.get('id') not in remembered:
            w = e.get('why') or {}
            new.append({'id': e['id'], 'text': e.get('text'), 'speaker': e.get('speaker'), 'source': e.get('source'),
                        'form': e.get('form'), 'register': growers.FORM_TO_REGISTER.get(e.get('form'), 'kelp'),
                        'idea': titles.get(e.get('topic')), 'at': e.get('at'), 'session': s.get('session'), 'why': w})
            remembered.add(e['id'])
    if new:
        with open(MEMORY, 'a') as f:
            for m in new:
                f.write(json.dumps(m) + '\n')

def memory(limit=800):
    out = []
    try:
        for line in MEMORY.read_text().splitlines()[-limit:]:
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    except OSError:
        pass
    return out[::-1]

# ── storage ───────────────────────────────────────────────────────────────────────

def read_json(p, default):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return default

def write_atomic(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix('.tmp' + uuid.uuid4().hex[:4])
    tmp.write_text(json.dumps(obj))
    tmp.replace(p)

def settings():
    return read_json(SETTINGS, {'provider': 'stand-in'})

def save_settings(new):
    s = settings()
    for k in ('provider', 'endpoint', 'model', 'every'):
        if k in new and new[k] is not None:
            s[k] = new[k]
    if new.get('key'):
        s['key'] = new['key']
    if new.get('clear_key'):
        s.pop('key', None)
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    write_atomic(SETTINGS, s)
    os.chmod(SETTINGS, 0o600)
    return public_settings(s)

def public_settings(s=None):
    s = s or settings()
    return {'provider': s.get('provider', 'stand-in'), 'endpoint': s.get('endpoint', ''), 'model': s.get('model', ''),
            'every': s.get('every', 3), 'has_key': bool(s.get('key'))}

def command(action, **kw):
    write_atomic(INBOX / f'{time.time_ns()}-{uuid.uuid4()}.json', dict(action=action, id=str(uuid.uuid4()), **kw))

# ── direction ─────────────────────────────────────────────────────────────────────

def clean(d):
    out = {}
    if not isinstance(d, dict):
        return out
    if isinstance(d.get('register'), str) and d['register'] in REGISTERS:
        out['register'] = d['register']
    if isinstance(d.get('mix'), dict):
        out['mix'] = {k: max(0.0, min(1.0, float(v))) for k, v in d['mix'].items() if k in REGISTERS}
    if isinstance(d.get('grow'), dict):
        out['grow'] = {k: max(0.0, min(400.0, float(v))) for k, v in d['grow'].items() if k in REGISTERS}
    for k, (lo, hi) in RANGES.items():
        if k in d:
            try:
                out[k] = max(lo, min(hi, float(d[k])))
            except (TypeError, ValueError):
                pass
    return out

def log(by, changes, reasons):
    if changes:
        decisions.appendleft({'at': time.time(), 'by': by, 'set': changes, 'reasons': reasons})

def listen_payload(n=24):
    s = read_json(STATE, {})
    events = s.get('events', [])[-n:]
    return {
        'transcript': [{'text': e.get('text'), 'form': e.get('form'), 'speaker': e.get('speaker'),
                        'idea': e.get('topic'), 'at': e.get('at')} for e in events],
        'form': s.get('form'), 'active_idea': s.get('active_topic'),
        'ideas': [{'id': t['id'], 'title': t.get('title'), 'words': t.get('words'), 'returns': t.get('returns')} for t in s.get('topics', [])],
        'registers': REGISTERS, 'direction': current,
        'directed_by': 'jev' if time.time() - last_jev < 8 else 'director',
    }

def stand_in(s, prev):
    """the stand-in director: small, legible rules, each with its reason"""
    events = s.get('events', [])
    recent = ' '.join(e.get('text', '') for e in events[-6:]).lower()
    words = re.findall(r"[a-z']+", recent)
    warm = sorted({w for w in words if w in WARM}); cool = sorted({w for w in words if w in COOL})
    reasons = []
    if warm or cool:
        target = 0.5 + 0.5 * (len(warm) - len(cool)) / max(1, len(warm) + len(cool))
        reasons.append('warmth toward %.2f: warm words %s, cool words %s' % (target, ', '.join(warm) or 'none', ', '.join(cool) or 'none'))
    else:
        target = prev.get('warmth', 0.4)
    now = time.time()
    said = sum(len(e.get('text', '').split()) for e in events if now - float(e.get('at', 0)) < 30)
    tempo = 0.6 + min(1.0, said / 90.0)
    reasons.append('tempo toward %.2f: %d words in the last 30 seconds' % (tempo, said))
    topic = next((t for t in s.get('topics', []) if t['id'] == s.get('active_topic')), None)
    returns = (topic or {}).get('returns', 0)
    memory = 0.35 + min(0.6, 0.15 * returns)
    reasons.append('memory toward %.2f: the idea in play has returned %d times' % (memory, returns))
    seed = int((topic or {}).get('id', '0')[:6] or '0', 16) % 97 if topic else 0
    if topic:
        reasons.append('variation %d for the idea "%s"' % (seed, topic.get('title', '')))
    ease = lambda a, b: round(a + (b - a) * 0.35, 3)   # every decision arrives gently
    return {'warmth': ease(prev.get('warmth', target), target), 'tempo': ease(prev.get('tempo', tempo), tempo),
            'memory': ease(prev.get('memory', memory), memory), 'seed': seed, 'drift': 0.3, 'saturation': 0.55}, reasons

# ── providers: Jev, Claude, or a local model ──────────────────────────────────────

PROMPT = """You direct a generative image that grows while someone speaks. It must represent the speech, never show text.
Registers: bloom (poetry), path (story), land (scenery), hive (lore, myth), orrery (cosmology), rings (mystery, argument),
stack (instruction), kelp (reflection; one stalk, a branch per idea), tide (dialogue), waves (song).
Reply with ONLY a JSON object with any of: register, mix {register: 0..1} for several images at once, warmth 0..1,
hue -0.5..0.5, tempo 0.3..2, density 0.5..2, memory 0..1, drift 0..3, grow {register: words}, and "why": one short sentence.
Here is what is being said, newest last:
"""

def _post(url, body, headers, timeout=12):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'content-type': 'application/json', **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

def _json_in(text):
    m = re.search(r'\{.*\}', text or '', re.S)
    return json.loads(m.group(0)) if m else {}

def ask_provider(cfg, payload):
    p = cfg.get('provider')
    lines = '\n'.join(f"[{e['form']}] {e['text']}" for e in payload['transcript'][-10:])
    if p == 'jev':
        if not cfg.get('endpoint'):
            raise RuntimeError('no Jev endpoint set')
        headers = {'Authorization': 'Bearer ' + cfg['key']} if cfg.get('key') else {}
        return _post(cfg['endpoint'], payload, headers)
    if p == 'claude':
        if not cfg.get('key'):
            raise RuntimeError('no Anthropic key set')
        r = _post('https://api.anthropic.com/v1/messages',
                  {'model': cfg.get('model') or 'claude-haiku-4-5-20251001', 'max_tokens': 220,
                   'messages': [{'role': 'user', 'content': PROMPT + lines}]},
                  {'x-api-key': cfg['key'], 'anthropic-version': '2023-06-01'})
        return _json_in(r['content'][0]['text'])
    if p == 'local':
        base = (cfg.get('endpoint') or 'http://127.0.0.1:11434/v1').rstrip('/')
        headers = {'Authorization': 'Bearer ' + cfg['key']} if cfg.get('key') else {}
        r = _post(base + '/chat/completions',
                  {'model': cfg.get('model') or 'gemma3:1b', 'temperature': 0.4,
                   'response_format': {'type': 'json_object'},
                   'messages': [{'role': 'user', 'content': PROMPT + lines}]}, headers)
        return _json_in(r['choices'][0]['message']['content'])
    return None

def director():
    global current
    last_ask = 0.0
    beat = 0
    while True:
        time.sleep(1.0)
        beat += 1
        if beat % 10 == 0:
            ensure_worker()                      # a worker that stops is started again
        s = read_json(STATE, {})
        remember(s)
        with lock:
            if time.time() - last_jev < 8:
                continue
            d, reasons = stand_in(s, current)
            changes = {k: v for k, v in d.items() if current.get(k) != v}
            new = dict(d)
            if 'mix' in current:
                new['mix'] = current['mix']
            current = new
            write_atomic(DIRECTION, current)
            log('stand-in', changes, reasons)
        cfg = settings()
        every = float(cfg.get('every', 3) or 3)
        if cfg.get('provider') not in (None, 'stand-in') and s.get('events') and time.time() - last_ask > every:
            last_ask = time.time()
            provider_status.update(state='asking')
            t0 = time.time()
            try:
                raw = ask_provider(cfg, listen_payload()) or {}
                why = raw.get('why') if isinstance(raw, dict) else None
                got = clean(raw)
                with lock:
                    changes = {k: v for k, v in got.items() if current.get(k) != v}
                    current = {**current, **got}
                    write_atomic(DIRECTION, current)
                    log(cfg['provider'], changes, [why] if why else ['as the model decided'])
                provider_status.update(state='ok', last=time.time(), error=None, latency=round(time.time() - t0, 2))
            except Exception as e:
                provider_status.update(state='error', error=str(e)[:200], last=time.time())

# ── what the app shows ────────────────────────────────────────────────────────────

def td_up():
    try:
        with urllib.request.urlopen('http://127.0.0.1:9983/frame.jpg', timeout=0.6) as r:
            return r.status == 200
    except Exception:
        return False

PROVIDER_NAMES = {'stand-in': 'the stand-in', 'jev': 'Jev', 'claude': 'Claude', 'local': 'a local model'}

def status():
    s = read_json(STATE, {})
    cfg = public_settings()
    up = td_up()
    if up:
        _opening['until'] = 0.0
    return {'touchdesigner': up, 'opening': not up and (time.time() < _opening['until'] or td_running()), 'worker': time.time() - float(s.get('heartbeat', 0)) < 12,
            'microphone': bool(read_json(PANEL, {}).get('microphone')), 'provider': cfg,
            'provider_name': PROVIDER_NAMES.get(cfg['provider'], cfg['provider']),
            'model': cfg.get('model') or {'claude': 'claude-haiku-4-5', 'local': 'gemma3:1b'}.get(cfg['provider'], ''),
            'provider_status': provider_status, 'directed_by': 'jev (posted)' if time.time() - last_jev < 8 else 'director'}

_opening = {'until': 0.0}

def td_running():
    import subprocess
    return subprocess.run(['pgrep', '-f', 'TouchDesigner.app/Contents/MacOS/TouchDesigner'], capture_output=True).returncode == 0

def transcribe(wav):
    """this Mac's own transcription: Apple's on-device SpeechAnalyzer, through bin/transcribe; nothing leaves the Mac"""
    import subprocess, tempfile
    helper = ROOT / 'bin' / 'transcribe'
    if not helper.exists():
        return {'ok': False, 'error': 'bin/transcribe is not built; run ./setup.sh'}
    with tempfile.NamedTemporaryFile(suffix='.wav', dir=str(ROOT / 'runtime'), delete=False) as f:
        f.write(wav); name = f.name
    try:
        out = subprocess.run([str(helper), name], capture_output=True, text=True, timeout=60).stdout
        parts = []
        for line in out.splitlines():
            try:
                j = json.loads(line)
            except ValueError:
                continue
            if j.get('text'):
                parts.append(j['text'].strip())
        return {'ok': True, 'text': ' '.join(p for p in parts if p)}
    except Exception as e:
        return {'ok': False, 'error': str(e)[:200]}
    finally:
        try:
            os.remove(name)
        except OSError:
            pass

def open_touchdesigner():
    """opens TouchDesigner once: never while it is opening or already open"""
    toe = ROOT / 'Speechform.toe'
    if td_running() or time.time() < _opening['until']:
        return {'ok': True, 'already': True}
    if not Path('/Applications/TouchDesigner.app').exists():
        return {'ok': False, 'error': 'TouchDesigner is not installed. The free Non-Commercial licence is enough: derivative.ca/download'}
    import subprocess
    _opening['until'] = time.time() + 60
    subprocess.Popen(['open', '-g', '-a', 'TouchDesigner', str(toe)])
    return {'ok': True}

def test_provider():
    cfg = settings()
    if cfg.get('provider') in (None, 'stand-in'):
        return {'ok': True, 'said': 'The stand-in needs no key. It decides from the transcript alone.'}
    t0 = time.time()
    try:
        got = ask_provider(cfg, {'transcript': [{'form': 'poetry', 'text': 'The moon is a silver wound upon the sea.'}]}) or {}
        return {'ok': True, 'seconds': round(time.time() - t0, 2), 'said': got}
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}

def app_state():
    s = read_json(STATE, {})
    d = read_json(DIRECTION, {})
    mix = growers.mix(s, d)
    grow = growers.growth(s, d)
    events = [e for e in s.get('events', []) if e.get('source') in YOURS][-60:]
    panel = read_json(PANEL, {})
    return {
        'transcript': [{'id': e.get('id'), 'text': e.get('text'), 'form': e.get('form'), 'speaker': e.get('speaker'),
                        'idea': e.get('topic'), 'at': e.get('at'), 'source': e.get('source'), 'why': e.get('why'),
                        'register': growers.FORM_TO_REGISTER.get(e.get('form'), 'kelp')} for e in events],
        'form': s.get('form'), 'scores': s.get('scores', []), 'status': s.get('status'), 'processing': s.get('processing'),
        'ideas': [{'id': t['id'], 'title': t.get('title'), 'words': t.get('words'), 'returns': t.get('returns')} for t in s.get('topics', [])],
        'active_idea': s.get('active_topic'), 'radius': s.get('radius'), 'conclusion_at': s.get('conclusion_at'),
        'map': s.get('map') or {'forms': [], 'ideas': []},
        'mix': mix, 'growth': grow, 'lead': max(mix, key=mix.get), 'form_to_register': growers.FORM_TO_REGISTER,
        'direction': d, 'directed_by': 'jev (posted)' if time.time() - last_jev < 8 else 'director',
        'decisions': list(decisions)[:40], 'provider': public_settings(), 'provider_status': provider_status,
        'status': status(), 'microphone': bool(panel.get('microphone')), 'worker_alive': time.time() - float(s.get('heartbeat', 0)) < 12,
        'now': time.time(),
    }

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj, ctype='application/json'):
        body = obj if isinstance(obj, (bytes, bytearray)) else json.dumps(obj, indent=1).encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        try:
            return json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        except ValueError:
            return None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/listen':
            return self._send(200, listen_payload())
        if path == '/state':
            return self._send(200, app_state())
        if path == '/status':
            return self._send(200, status())
        if path == '/memory':
            return self._send(200, {'memory': memory(), 'count': len(remembered)})
        if path in ('/', '/index.html'):
            return self._send(200, (APP / 'index.html').read_bytes(), 'text/html; charset=utf-8')
        if path == '/light' or path.startswith('/light/'):
            LIGHT = ROOT / 'light'
            f = (LIGHT / (path[len('/light/'):] or 'index.html')).resolve()
            if f.is_file() and LIGHT in f.parents:
                kind = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json'}.get(f.suffix, 'application/octet-stream')
                return self._send(200, f.read_bytes(), kind)
            return self._send(404, {'error': 'not here'})
        f = (APP / path.lstrip('/')).resolve()
        if f.is_file() and APP in f.parents:
            kind = {'.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png'}.get(f.suffix, 'application/octet-stream')
            return self._send(200, f.read_bytes(), kind)
        return self._send(404, {'error': 'not here'})

    def do_POST(self):
        global last_jev, current
        path = self.path.split('?')[0]
        if path == '/transcribe':
            return self._send(200, transcribe(self.rfile.read(int(self.headers.get('Content-Length', 0)))))
        d = self._body()
        if d is None:
            return self._send(400, {'error': 'not JSON'})
        if path == '/direct':
            with lock:
                last_jev = time.time()
                got = clean(d)
                changes = {k: v for k, v in got.items() if current.get(k) != v}
                current = {**current, **got}
                if d.get('register') in ('auto',) or ('register' in d and d['register'] is None):
                    current.pop('register', None)
                if d.get('mix') == {}:
                    current.pop('mix', None)
                write_atomic(DIRECTION, current)
                log('jev (posted)', changes, [d['why']] if isinstance(d.get('why'), str) else ['posted to /direct'])
            return self._send(200, {'ok': True, 'direction': current})
        if path == '/say':
            text = str(d.get('text', '')).strip()
            if not text:
                return self._send(400, {'error': 'nothing to say'})
            command('text', text=text, speaker=d.get('speaker', 'A'), source='Test' if d.get('test') else 'Typed', form=d.get('form'))
            return self._send(200, {'ok': True})
        if path == '/intake':
            if 'microphone' in d:
                p = read_json(PANEL, {})
                p['microphone'] = bool(d['microphone'])
                if d.get('speaker') in ('A', 'B'):
                    p['speaker'] = d['speaker']
                write_atomic(PANEL, p)
            if d.get('action') in ('stop_rehearsal', 'reset', 'export'):
                command(d['action'])
            return self._send(200, {'ok': True})
        if path == '/settings':
            return self._send(200, save_settings(d))
        if path == '/settings/test':
            return self._send(200, test_provider())
        if path == '/touchdesigner':
            return self._send(200, open_touchdesigner())
        if path in ('/start', '/stop'):
            on = path == '/start'
            opened = None
            if on and not td_up():
                opened = open_touchdesigner()           # the microphone lives in TouchDesigner
                if not opened.get('ok'):
                    return self._send(200, opened)
            p = read_json(PANEL, {})
            p['microphone'] = on
            if d.get('speaker') in ('A', 'B'):
                p['speaker'] = d['speaker']
            write_atomic(PANEL, p)
            return self._send(200, {'ok': True, 'listening': on, 'opened_touchdesigner': bool(opened)})
        return self._send(404, {'error': 'not here'})

    def log_message(self, *a):
        pass

def ensure_worker():
    """the speech worker (transcription and classification) runs whether or not TouchDesigner does;
    its own lock keeps it to one"""
    s = read_json(STATE, {})
    if time.time() - float(s.get('heartbeat', 0)) < 12:
        return
    import subprocess
    py = ROOT / '.worker' / 'bin' / 'python'
    log = open(ROOT / 'runtime' / 'worker.log', 'a')
    subprocess.Popen([str(py) if py.exists() else sys.executable, str(ROOT / 'worker.py')], cwd=str(ROOT),
                     stdout=log, stderr=log, start_new_session=True)

if __name__ == '__main__':
    DIRECTION.parent.mkdir(parents=True, exist_ok=True)
    INBOX.mkdir(parents=True, exist_ok=True)
    ensure_worker()
    write_atomic(DIRECTION, current)
    load_memory()
    threading.Thread(target=director, daemon=True).start()
    print(f'Speechform on http://127.0.0.1:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
