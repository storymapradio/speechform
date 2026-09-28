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
import base64, hashlib, json, re, subprocess, sys, threading, time, urllib.request, uuid
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

# ── a recording's folder ──────────────────────────────────────────────────────────
# Each recording keeps everything in one folder, named by its date, time and card:
#   audio.wav          the whole recording (full app: TouchDesigner's microphone; Light: the page's own capture)
#   transcript.txt     every phrase with its time, speaker, kind of speech and idea
#   reading.txt        the reading in words: the shares, the sections, Jev's answers, how the art was made
#   card-front.png     the card, front and back, as images
#   card-back.png
#   grown.jpg          the image the talk grew (the card's abstract side)
#   painted.png        the easel's picture (the card's clear side)
#   phrases.json       every phrase with the classifier's full reasoning
#   reading.json       the whole reading: shares for the recording, each idea's section and each fifty-word window
#   card.json          the card itself
ABOUT = """Speechform keeps one folder here for every recording. Each folder holds:

audio.wav         the recording itself
transcript.txt    every phrase, with its time, speaker, kind of speech and idea
reading.txt       what the classifier and Jev made of the whole recording, and how the art was made
card-front.png    the card, front and back
card-back.png
grown.jpg         the image your talk grew
painted.png       the picture the easel painted from it, on this Mac
phrases.json      every phrase with the classifier's full reasoning
reading.json      the reading as data: the whole recording, each idea's section, each fifty-word window
card.json         the card as data

Sections holds the passages you selected in a transcript and classified on their own.
"""

def _write(folder, card):
    tmp = folder / 'card.tmp'
    tmp.write_text(json.dumps(card, indent=1))
    tmp.replace(folder / 'card.json')

def _clock(t, t0):
    s = max(0, int(t - t0)); return f'{s // 60:02d}:{s % 60:02d}'

def _transcript(folder, card, phrases, t0):
    titles = {i.get('id'): i.get('title') for i in (card.get('reading') or {}).get('ideas', [])}
    lines = [card.get('name', ''), time.strftime('%A %-d %B %Y, %H:%M', time.localtime(t0)), '']
    for p in phrases:
        lines.append(f"[{_clock(p.get('at', t0), t0)}] {p.get('speaker', 'A')} | {p.get('kind', '')} | {titles.get(p.get('idea')) or ''}")
        lines.append(heavy.mask(p.get('text', '')))
        lines.append('')
    (folder / 'transcript.txt').write_text('\n'.join(lines))

def _summary(folder):
    """reading.txt: the whole reading, in words"""
    try:
        card = json.loads((folder / 'card.json').read_text())
        r = json.loads((folder / 'reading.json').read_text())
    except (OSError, ValueError):
        return
    pct = lambda v: f'{round(v * 100)}%'
    L = [card.get('name', ''), '', f"{card.get('kind')} | {card.get('register', '').upper()} | level {card.get('level')} | Focus {card.get('focus')} | Hold {card.get('hold')} | {card.get('rarity')}", '']
    L += [' '.join(card.get('effect', [])), '', 'THE WHOLE RECORDING', f"{r.get('words')} words in {r.get('phrases')} phrases. The kind switched {r.get('switches')} times.", '']
    L += [f'  {k:<26} {pct(v)}' for k, v in r.get('profile', [])[:10]]
    L += ['', 'EACH IDEA']
    for sct in r.get('sections', []):
        L.append(f"  {sct.get('title') or 'an idea'}: " + ', '.join(f'{k} {pct(v)}' for k, v in sct.get('profile', [])[:3]))
    L += ['', 'EVERY FIFTY WORDS']
    for i, w in enumerate(r.get('windows', [])):
        L.append(f'  {i + 1}. ' + ', '.join(f'{k} {pct(v)}' for k, v in w.get('profile', [])[:3]))
    j = card.get('jev') or {}
    L += ['', 'JEV']
    if j.get('error'):
        L.append('  Jev did not answer: ' + j['error'])
    elif j:
        L.append(f"  Jev hears it as {j.get('kind')} ({pct(j.get('confidence') or 0)} sure), chose the {j.get('style')} style ({pct(j.get('style_confidence') or 0)} sure), and judged it {pct(1 - (j.get('unsafe') or 0))} safe to draw.")
        if 'reuse' in j:
            L.append(f"  A saved picture was offered; Jev gave it {pct(j['reuse'])} to fit.")
    else:
        L.append('  No Jev key is saved, so the style came from the kind of speech.')
    L += ['', 'THE ART', f"  {card.get('art', '')}", f"  Style: {card.get('style', '')}", f"  Words: {', '.join(card.get('words') or [])}", f"  Prompt: {card.get('prompt', '')}"]
    (folder / 'reading.txt').write_text('\n'.join(L) + '\n')

def _stitch_microphone(folder, since, until):
    """the full app's audio: TouchDesigner writes the microphone in six-second pieces (runtime/mic-<ns>.wav,
    named when each piece ends, quiet pieces skipped). The pieces of this recording are laid at their own times,
    silence between them, so the audio keeps step with the transcript."""
    import wave
    pieces = []
    for f in (ROOT / 'runtime').glob('mic-*.wav'):
        try:
            end = int(f.stem[4:]) / 1e9
        except ValueError:
            continue
        if since - 1 <= end <= until + 15:
            pieces.append((end, f))
    if not pieces:
        return False
    pieces.sort()
    rate, out, cursor = 44100, bytearray(), None
    for end, f in pieces:
        with wave.open(str(f), 'rb') as w:
            rate = w.getframerate(); frames = w.readframes(w.getnframes())
        start = end - len(frames) / 2 / rate
        if cursor is not None and start > cursor:
            out += b'\0\0' * int(min(start - cursor, 30) * rate)     # the quiet between pieces, up to half a minute
        out += frames; cursor = end
    with wave.open(str(folder / 'audio.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(bytes(out))
    return True

def _name(card):
    title = re.sub(r'[^\w\s\'-]', '', card.get('name') or 'A recording').strip()[:48] or 'A recording'
    base = time.strftime('%Y-%m-%d %H.%M ') + title
    ident, n = base, 2
    while (CARDS / ident).exists():
        ident = f'{base} ({n})'; n += 1
    return ident

def make(cfg, card, text, abstract=None, phrases=None, audio=None, since=None):
    """keep a new recording and its card, and start its art; returns the card at once, with its abstract side"""
    CARDS.mkdir(parents=True, exist_ok=True)
    if not (CARDS / 'About this folder.txt').exists():
        (CARDS / 'About this folder.txt').write_text(ABOUT)
    ident = _name(card)
    folder = CARDS / ident
    folder.mkdir(parents=True)
    phrases = phrases or []
    t0 = float(since or (phrases[0].get('at') if phrases else time.time()) or time.time())
    raw = None
    if abstract:
        raw = base64.b64decode(abstract.split(',', 1)[-1])
    else:
        try:
            raw = _get(FRAME, 5)                 # TouchDesigner's last frame: the image this talk grew
        except Exception:
            raw = None
    if raw:
        (folder / 'grown.jpg').write_bytes(raw)
    if audio:
        (folder / 'audio.wav').write_bytes(base64.b64decode(audio.split(',', 1)[-1]))
    reading = card.pop('reading', None) or {}
    (folder / 'reading.json').write_text(json.dumps(reading, indent=1))
    (folder / 'phrases.json').write_text(json.dumps([{**p, 'text': heavy.mask(p.get('text', ''))} for p in phrases], indent=1))
    card = {**card, 'id': ident, 'text': heavy.mask(text)[:6000], 'abstract': 'grown.jpg' if raw else None,
            'clear': None, 'art': 'waiting', 'made': time.time(), 'since': t0, 'reading': {'ideas': reading.get('ideas', [])}}
    _write(folder, card)
    _transcript(folder, card, phrases, t0)
    threading.Thread(target=_art, args=(cfg, folder, not audio), daemon=True).start()
    return card

def faces(ident, d):
    """the card's two sides as images, drawn by the page once its art is done"""
    folder = CARDS / ident
    if not (folder / 'card.json').exists() or CARDS not in folder.resolve().parents:
        return {'ok': False}
    for side in ('front', 'back'):
        if d.get(side):
            (folder / f'card-{side}.png').write_bytes(base64.b64decode(d[side].split(',', 1)[-1]))
    card = json.loads((folder / 'card.json').read_text()); card['faces'] = True; _write(folder, card)
    return {'ok': True}

def _art(cfg, folder, stitch=True):
    card = json.loads((folder / 'card.json').read_text())
    def say(**kw):
        card.update(kw); _write(folder, card); _summary(folder)
    try:
        _paint(cfg, folder, card, say)
    finally:
        if stitch:
            time.sleep(4)                        # the last piece is written when the microphone stops
            if _stitch_microphone(folder, card.get('since', card['made']), card['made']):
                say(audio='audio.wav')
        elif (folder / 'audio.wav').exists():
            say(audio='audio.wav')

def _paint(cfg, folder, card, say):
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
        (folder / ('painted' + src.suffix)).write_bytes(src.read_bytes())
        return say(clear='painted' + src.suffix, art=f'from the bank ({round(likeness * 100)}% alike)', bank=hit['id'])
    say(art='the easel is drawing')
    if not ensure_easel():
        return say(art='kept abstract: the easel is not installed or could not load its model')
    init = None
    if (folder / 'grown.jpg').exists():
        init = 'data:image/jpeg;base64,' + base64.b64encode((folder / 'grown.jpg').read_bytes()).decode()
    try:
        got = _post(EASEL + '/draw', {'prompt': prompt, 'negative': heavy.NEGATIVE, 'init': init, 'strength': STRENGTH,
                                     'steps': 4, 'seed': int(hashlib.sha1(card['id'].encode()).hexdigest()[:6], 16)})
        (folder / 'painted.png').write_bytes(base64.b64decode(got['image'].split(',', 1)[1]))
        item = heavy.to_bank(register, style, words, prompt, got['image'])   # Heavy can reuse it too
        say(clear='painted.png', art=f"drawn on this Mac in {got.get('seconds')} s", bank=item['id'])
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
    # and one readable file per section, in the folder on the Desktop
    folder = CARDS / 'Sections'; folder.mkdir(parents=True, exist_ok=True)
    top = (d.get('top') or 'a section').strip()
    lines = [time.strftime('%A %-d %B %Y, %H:%M'), '', d['text'], '', 'Its kinds of speech:']
    lines += [f'  {k:<26} {round(v * 100)}%' for k, v in (d.get('profile') or [])[:8]]
    (folder / f"{time.strftime('%Y-%m-%d %H.%M.%S')} {top}.txt").write_text('\n'.join(lines) + '\n')
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
