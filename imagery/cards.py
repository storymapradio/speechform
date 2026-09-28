"""Speechform cards: a recording, read whole, becomes a card with two sides of art.

The page reads the recording (light/reading.js) and posts the reading and the card to /card.
Here the card is kept, and its art is made in the background:

  abstract  the image the talk grew: posted by the page (Light) or taken from TouchDesigner's frame
  Jev       if a TypeSafe key is saved: is the recording safe to draw, which of the six styles fits,
            what kind Jev hears it as, and whether a banked image fits well enough to reuse
  clear     the bank first; otherwise the easel (SDXL Turbo on this Mac) redraws the abstract image
            toward a prompt written from the recording's most repeated words

Cards live in runtime/cards/<id>/ (card.json, abstract.jpg, clear.png). Sections classified by hand
are kept in runtime/sections.jsonl.
"""
import base64, json, re, subprocess, sys, threading, time, urllib.request, uuid
from collections import Counter
from pathlib import Path
import heavy

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / 'runtime' / 'cards'
SECTIONS = ROOT / 'runtime' / 'sections.jsonl'
EASEL = 'http://127.0.0.1:9996'
FRAME = 'http://127.0.0.1:9983/frame.jpg'
STRENGTH = 0.85            # how far the easel may move from the grown image: the shape stays, the scene arrives
# without Jev, a style is chosen by the kind of speech
STYLE_FOR = {'poetry': 'water', 'story': 'woodcut', 'reading aloud': 'woodcut', 'character development': 'woodcut',
             'scenery': 'water', 'lore': 'glass', 'myth': 'glass', 'cosmology': 'cosmic', 'mystery': 'ink', 'argument': 'ink',
             'instruction': 'woodcut', 'lecture': 'ink', 'lesson': 'water', 'reflective monologue': 'ink', 'thinking aloud': 'ink',
             'stream of consciousness': 'water', 'dialogue': 'glass', 'song': 'neon', 'lyrics': 'neon'}
_easel_started = {'at': 0.0}

def _get(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()

def _post(url, body, timeout=300):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

# ── the easel ─────────────────────────────────────────────────────────────────────
def easel_status():
    try:
        return json.loads(_get(EASEL + '/status', 2))
    except Exception:
        return {'ready': False, 'running': False, 'installed': (ROOT / '.art' / 'bin' / 'python').exists()}

def ensure_easel(wait=240):
    """start the easel if it is not running, and wait until its model is loaded"""
    st = easel_status()
    if st.get('ready'):
        return True
    py = ROOT / '.art' / 'bin' / 'python'
    if st.get('running') is False and py.exists() and time.time() - _easel_started['at'] > 60:
        _easel_started['at'] = time.time()
        log = open(ROOT / 'runtime' / 'easel.log', 'a')
        subprocess.Popen([str(py), str(ROOT / 'imagery' / 'easel.py')], cwd=str(ROOT), stdout=log, stderr=log, start_new_session=True)
    t0 = time.time()
    while time.time() - t0 < wait:
        st = easel_status()
        if st.get('ready'):
            return True
        if st.get('error'):
            return False
        time.sleep(2)
    return False

# ── words for the prompt ──────────────────────────────────────────────────────────
def main_words(text, n=6):
    """the recording's most repeated content words, never a blocked one"""
    ws = [w for w in re.findall(r"[a-z']+", (text or '').lower())
          if len(w) > 3 and w not in heavy.STOP and w not in heavy.BLOCKED]
    first = {}
    for i, w in enumerate(ws):
        first.setdefault(w, i)
    return [w for w, _ in sorted(Counter(ws).items(), key=lambda kv: (-kv[1], first[kv[0]]))][:n]

# ── Jev's part: four decisions, one call ──────────────────────────────────────────
def jev_card(cfg, text, bank_hit=None):
    qs = {
        'kind': {'type': 'choice', 'instructions': 'What kind of speech is this recording, taken as a whole?', 'criteria': heavy.KIND_CRITERIA},
        'style': {'type': 'choice', 'instructions': 'Which art style would picture this recording best?',
                  'criteria': {k: v[0] + ': ' + v[1] for k, v in heavy.STYLES.items()}},
        'unsafe': {'type': 'noul', 'instructions': 'Does this recording describe violence, gore or cruelty, or use profanity?'},
    }
    if bank_hit:
        qs['reuse'] = {'type': 'noul', 'instructions': 'A saved picture shows: ' + ', '.join(bank_hit['keywords']) +
                       '. Would that picture fit this recording well?'}
    a = heavy.typesafe(cfg, heavy.mask(text), qs, timeout=25)
    k, st = a.get('kind', {}), a.get('style', {})
    out = {'kind': k.get('choice'), 'confidence': k.get('confidence'), 'style': st.get('choice'),
           'style_confidence': st.get('confidence'), 'unsafe': a.get('unsafe', {}).get('noul', 0)}
    if bank_hit:
        out['reuse'] = a.get('reuse', {}).get('noul', 0)
    return out

# ── cards ─────────────────────────────────────────────────────────────────────────
def _write(folder, card):
    tmp = folder / 'card.tmp'
    tmp.write_text(json.dumps(card, indent=1))
    tmp.replace(folder / 'card.json')

def make(cfg, card, text, abstract=None):
    """keep a new card and start its art; returns the card at once, with its abstract side"""
    ident = time.strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:4]
    folder = CARDS / ident
    folder.mkdir(parents=True, exist_ok=True)
    raw = None
    if abstract:
        raw = base64.b64decode(abstract.split(',', 1)[-1])
    else:
        try:
            raw = _get(FRAME, 5)                 # TouchDesigner's last frame: the image this talk grew
        except Exception:
            raw = None
    if raw:
        (folder / 'abstract.jpg').write_bytes(raw)
    card = {**card, 'id': ident, 'text': heavy.mask(text)[:6000], 'abstract': 'abstract.jpg' if raw else None,
            'clear': None, 'art': 'waiting', 'made': time.time()}
    _write(folder, card)
    threading.Thread(target=_art, args=(cfg, folder), daemon=True).start()
    return card

def _art(cfg, folder):
    card = json.loads((folder / 'card.json').read_text())
    def say(**kw):
        card.update(kw); _write(folder, card)
    words = main_words(card.get('text', ''))
    register = card.get('register', 'kelp')
    style = STYLE_FOR.get(card.get('kind'), 'ink')
    hit, likeness = heavy.from_bank(register, style, words)
    # Jev, when its key is saved, decides before anything is drawn
    if heavy.service(cfg) == 'typesafe':
        say(art='asking Jev')
        try:
            j = jev_card(cfg, card.get('text', ''), hit)
            say(jev=j)
            if j.get('style') in heavy.STYLES:
                style = j['style']
                hit, likeness = heavy.from_bank(register, style, words)
            if j.get('unsafe', 0) > .5:
                return say(art='kept abstract: Jev judged the recording unsafe to draw')
            if hit and j.get('reuse') is not None and j['reuse'] < .5:
                hit = None                       # Jev says the saved picture does not fit
        except Exception as e:
            say(jev={'error': str(e)[:200]})
    prompt, _ = heavy.prompt_for(register, ' '.join(words), style)
    say(style=style, prompt=prompt, words=words)
    if hit:
        src = heavy.BANK / hit['file']
        (folder / ('clear' + src.suffix)).write_bytes(src.read_bytes())
        return say(clear='clear' + src.suffix, art=f'from the bank ({round(likeness * 100)}% alike)', bank=hit['id'])
    say(art='the easel is drawing')
    if not ensure_easel():
        return say(art='kept abstract: the easel is not installed or could not load its model')
    init = None
    if (folder / 'abstract.jpg').exists():
        init = 'data:image/jpeg;base64,' + base64.b64encode((folder / 'abstract.jpg').read_bytes()).decode()
    try:
        got = _post(EASEL + '/draw', {'prompt': prompt, 'negative': heavy.NEGATIVE, 'init': init, 'strength': STRENGTH,
                                     'steps': 4, 'seed': int(card['id'][-4:], 16)})
        (folder / 'clear.png').write_bytes(base64.b64decode(got['image'].split(',', 1)[1]))
        item = heavy.to_bank(register, style, words, prompt, got['image'])   # Heavy can reuse it too
        say(clear='clear.png', art=f"drawn on this Mac in {got.get('seconds')} s", bank=item['id'])
    except Exception as e:
        say(art='kept abstract: ' + str(e)[:160])

def cards(limit=200):
    out = []
    for f in sorted(CARDS.glob('*/card.json'), reverse=True)[:limit]:
        try:
            out.append(json.loads(f.read_text()))
        except (OSError, ValueError):
            pass
    return out

def card_file(rel):
    f = (CARDS / rel).resolve()
    return f if f.is_file() and CARDS in f.parents else None

# ── sections ──────────────────────────────────────────────────────────────────────
def keep_section(d):
    d = {**d, 'id': uuid.uuid4().hex[:10], 'at': time.time(), 'text': heavy.mask(str(d.get('text', '')))[:6000]}
    SECTIONS.parent.mkdir(parents=True, exist_ok=True)
    with open(SECTIONS, 'a') as f:
        f.write(json.dumps(d) + '\n')
    return d

def sections(limit=300):
    try:
        lines = SECTIONS.read_text().splitlines()[-limit:]
    except OSError:
        return []
    out = []
    for l in reversed(lines):
        try:
            out.append(json.loads(l))
        except ValueError:
            pass
    return out
