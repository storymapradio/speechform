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
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))
import depth, steer        # the three lenses on each kind of speech (depth.py, lenses.json, light/depth.js) and the threads (steer.py)
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
ON_LEARN = {}              # the server sets this: tell the speech worker to learn what Jev taught

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

# ── Jev's part: one call when the recording stops ─────────────────────────────────
LEARNED = ROOT / 'runtime' / 'learned.json'

def segments(phrases, most=12):
    """the recording cut into at most twelve passages of whole phrases, each at least forty words"""
    words = lambda t: len((t or '').split())
    total = sum(words(p.get('text')) for p in phrases)
    size = max(40, total / most)
    out, cur, n = [], [], 0
    for p in phrases:
        cur.append(p); n += words(p.get('text'))
        if n >= size:
            out.append(cur); cur, n = [], 0
    if cur:
        if out and n < size / 2:
            out[-1] += cur
        else:
            out.append(cur)
    result = []
    for seg in out:
        count = Counter()
        for p in seg:
            count[p.get('kind')] += words(p.get('text'))
        result.append({'text': ' '.join(p.get('text', '') for p in seg), 'classifier': count.most_common(1)[0][0] if count else None,
                       'from': seg[0].get('at'), 'to': seg[-1].get('at')})
    return result

def jev_card(cfg, text, bank_hit=None, segs=None, threads=None):
    """four decisions about the whole recording, the kind and the three lenses of every passage, and for each
    thread left open how it could have continued or closed, all in one call"""
    segs = segs or []
    open_threads = [t for t in (threads or []) if t.get('state') != 'closed'][:6]
    moves = steer.suggestions(open_threads)
    room = max(200, 7000 // max(1, len(segs))) if segs else 0
    state = ('\n\n'.join(f'Passage {i + 1}: ' + heavy.mask(s['text'])[:room] for i, s in enumerate(segs))) if segs else heavy.mask(text)
    qs = {
        'kind': {'type': 'choice', 'instructions': 'What kind of speech is this recording, taken as a whole' + (' (all the passages together)?' if segs else '?'), 'criteria': heavy.KIND_CRITERIA},
        'style': {'type': 'choice', 'instructions': 'Which art style would picture this recording best?',
                  'criteria': {k: v[0] + ': ' + v[1] for k, v in heavy.STYLES.items()}},
        'unsafe': {'type': 'noul', 'instructions': 'Does this recording describe violence, gore or cruelty, or use profanity?'},
    }
    for i in range(len(segs)):
        qs[f'p{i + 1}'] = {'type': 'choice', 'instructions': f'What kind of speech is Passage {i + 1}?', 'criteria': heavy.KIND_CRITERIA}
        qs.update(lens_questions(f'Passage {i + 1}', segs[i].get('classifier'), f'p{i + 1}_'))
    # how this recording connects to earlier ones: each thread linked to an earlier thread, continued, closed or contradicted
    linked = [t for t in (threads or []) if t.get('link')][:4]
    for i, t in enumerate(linked):
        l = t['link']
        qs[f'c{i + 1}'] = {'type': 'choice', 'instructions': f'The thread "{t.get("title")}" in this recording is linked to the thread "{l.get("title")}" from {l.get("date")}, which began "{(l.get("first") or "")[:100]}". What did this recording do with it?',
                           'criteria': {'continued': 'took it further', 'closed': 'brought it to an end or answered it', 'contradicted': 'said the opposite or changed its mind about it', 'unrelated': 'the link is a coincidence of words'}}
    for i, t in enumerate(open_threads):
        qs[f't{i + 1}'] = {'type': 'choice', 'instructions': f'The thread "{t.get("title")}" ({t.get("kind")}) was left {t.get("state")}, beginning "{t.get("first", "")}". How could it best have continued or closed?',
                           'criteria': moves.get(t['id']) or {'rest': 'Let it rest.'}}
    if bank_hit:
        qs['reuse'] = {'type': 'noul', 'instructions': 'A saved picture shows: ' + ', '.join(bank_hit['keywords']) +
                       '. Would that picture fit this recording well?'}
    a = heavy.typesafe(cfg, state, qs, timeout=60, limit=8000)
    k, st = a.get('kind', {}), a.get('style', {})
    out = {'kind': k.get('choice'), 'confidence': k.get('confidence'), 'style': st.get('choice'),
           'style_confidence': st.get('confidence'), 'unsafe': a.get('unsafe', {}).get('noul', 0)}
    if bank_hit:
        out['reuse'] = a.get('reuse', {}).get('noul', 0)
    out['segments'] = [{**sg, 'jev': a.get(f'p{i + 1}', {}).get('choice'), 'confidence': a.get(f'p{i + 1}', {}).get('confidence'),
                        'depth': lens_answers(a, f'p{i + 1}_')} for i, sg in enumerate(segs)]
    out['connections'] = {t['id']: {'past': t['link'].get('title'), 'date': t['link'].get('date'), 'card': t['link'].get('card'), 'relation': (a.get(f'c{i + 1}') or {}).get('choice'),
                                    'confidence': (a.get(f'c{i + 1}') or {}).get('confidence')} for i, t in enumerate(linked) if (a.get(f'c{i + 1}') or {}).get('choice')}
    out['threads'] = {t['id']: {'move': (moves.get(t['id']) or {}).get((a.get(f't{i + 1}') or {}).get('choice')), 'choice': (a.get(f't{i + 1}') or {}).get('choice'),
                                'confidence': (a.get(f't{i + 1}') or {}).get('confidence')} for i, t in enumerate(open_threads) if a.get(f't{i + 1}')}
    return out

# ── depth: the three lenses, asked of Jev once the speaking is over ───────────────
LENS_SCALE = {
    'listener': ('How much must a listener already know or bring to appreciate it?', ['needs much context', 'some', 'self-contained']),
    'speaker': ('How clearly does the speaker deliver its meaning?', ['meaning unclear', 'implied', 'clearly delivered']),
    'absorption': ('How far does it draw a listener in?', ['alert', 'drawn in', 'entranced']),
}

def lens_questions(name, kind, prefix):
    """three scores, one per lens, and a choice of the strongest absorption element, for one passage heard as one kind"""
    spec = depth.LENSES['kinds'].get(kind)
    if not spec:
        return {}
    qs = {}
    for lens, (ask, scale) in LENS_SCALE.items():
        qs[prefix + lens] = {'type': 'score', 'instructions': f'{name} is heard as {kind}. {spec[lens]["question"]} {ask}', 'criteria': scale}
    qs[prefix + 'element'] = {'type': 'choice', 'instructions': f'{name} is heard as {kind}. Which of these most draws the listener in?',
                              'criteria': {e['id']: e['name'] + ': ' + e['meaning'] for e in spec['absorption']['elements']}}
    return qs

def lens_answers(a, prefix):
    """Jev's answers to lens_questions, each lens 0..1"""
    out = {}
    for lens, (_, scale) in LENS_SCALE.items():
        got = a.get(prefix + lens) or {}
        if 'score' in got:
            out[lens] = round(float(got['score']) / (len(scale) - 1), 3)
            out[lens + '_confidence'] = got.get('confidence')
    el = a.get(prefix + 'element') or {}
    if el.get('choice'):
        out['element'] = el['choice']; out['element_confidence'] = el.get('confidence')
    return out or None

def jev_passage(cfg, text, kind):
    """the same lens questions for one passage a person selected, after the speaking is over"""
    if kind not in depth.LENSES['kinds']:
        raise ValueError('no lenses for ' + str(kind))
    a = heavy.typesafe(cfg, heavy.mask(text), lens_questions('This passage', kind, ''), timeout=40, limit=6000)
    return lens_answers(a, '')

def depth_record(phrases, text, card):
    """depth.json: the whole recording read through the lenses of its kind, each phrase's meters over time, and
    every passage Jev will be asked about, each with the algorithm's elements and the words that showed them"""
    profile = [tuple(x) for x in (card.get('profile') or [])]
    kinds = depth.near_kinds(profile[0][0], profile) if profile else [card.get('kind')]
    whole = depth.passage(text, kinds)
    segs = []
    for sg in segments(phrases):
        d = depth.passage(sg['text'], [sg['classifier']]) if sg.get('classifier') else None
        segs.append({'from': sg['from'], 'to': sg['to'], 'kind': sg['classifier'], 'words': len(sg['text'].split()),
                     'algorithm': depth.summary(d), 'elements': {l: [{'id': e['id'], 'score': e['score'], 'evidence': e['evidence']}
                                                                    for e in d['lenses'][l]['elements'] if e['score'] > 0] for l in depth.ORDER} if d else None})
    return {'kind': whole and whole['kind'], 'algorithm': whole, 'over_time': depth.over_time(phrases), 'segments': segs, 'jev': None,
            'note': 'The algorithm read every element from the words. Jev is asked only after the recording stops.'}

def _depth_merge(folder, j):
    """Jev's lens answers joined to the algorithm's reading in depth.json"""
    try:
        rec = json.loads((folder / 'depth.json').read_text())
    except (OSError, ValueError):
        return None
    if j and not j.get('error') and not j.get('skipped'):
        for sg, js in zip(rec.get('segments', []), j.get('segments') or []):
            sg['jev'] = js.get('depth')
        got = [sg['jev'] for sg in rec['segments'] if sg.get('jev')]
        if got:
            mean = {l: round(sum(g.get(l, 0) for g in got) / len(got), 3) for l in depth.ORDER if any(l in g for g in got)}
            elems = Counter(g['element'] for g in got if g.get('element'))
            rec['jev'] = {**mean, 'element': elems.most_common(1)[0][0] if elems else None, 'passages': len(got)}
            rec['note'] = 'The algorithm read every element from the words; Jev answered the three lens questions for each passage after the recording stopped.'
    elif j and j.get('skipped'):
        rec['note'] = 'The algorithm read every element from the words. Jev was not asked: ' + j['skipped'] + '.'
    elif j and j.get('error'):
        rec['note'] = 'The algorithm read every element from the words. Jev did not answer: ' + j['error']
    (folder / 'depth.json').write_text(json.dumps(rec, indent=1))
    return rec

# ── the aim: a classifier good enough that Jev is no longer needed ───────────────
AGREEMENT = ROOT / 'runtime' / 'agreement.json'
GRADUATE = 0.9          # the classifier agrees with Jev on at least nine passages in ten
IN_A_ROW = 5            # for five recordings in a row
CHECK_EVERY = 5         # after that, Jev reads only every fifth recording, to catch any drift

def agreement():
    try:
        return json.loads(AGREEMENT.read_text())
    except (OSError, ValueError):
        return []

def record_agreement(segs, card_id):
    judged = [sg for sg in segs if sg.get('jev')]
    if not judged:
        return None
    share = sum(1 for sg in judged if sg.get('classifier') == sg['jev']) / len(judged)
    items = agreement() + [{'card': card_id, 'at': time.time(), 'passages': len(judged), 'agree': round(share, 3)}]
    AGREEMENT.write_text(json.dumps(items[-200:], indent=1))
    return share

def graduated():
    """whether the classifier has earned its independence: nine in ten for five recordings in a row"""
    last = agreement()[-IN_A_ROW:]
    return len(last) == IN_A_ROW and all(x['agree'] >= GRADUATE for x in last)

def jev_status():
    items = agreement(); last = items[-IN_A_ROW:]
    since = 0
    for x in reversed(items):
        if x.get('skipped'):
            since += 1
        else:
            break
    return {'recordings': len(items), 'recent': [x['agree'] for x in last if 'agree' in x],
            'mean': round(sum(x['agree'] for x in last if 'agree' in x) / max(1, len([x for x in last if 'agree' in x])), 3) if last else None,
            'graduated': graduated(), 'need': GRADUATE, 'in_a_row': IN_A_ROW, 'check_every': CHECK_EVERY, 'skipped_since_check': since}

def ask_jev_now():
    """before the classifier graduates, Jev reads every recording; after, only every fifth"""
    if not graduated():
        return True
    return jev_status()['skipped_since_check'] >= CHECK_EVERY - 1

def learned():
    try:
        return json.loads(LEARNED.read_text())
    except (OSError, ValueError):
        return []

def learn(segs, card_id):
    """every passage Jev is sure of becomes an example of its kind for the classifier (the newest forty per kind)"""
    items = learned()
    have = {it['text'] for it in items}                       # a passage already learned is not learned twice
    new = [{'text': sg['text'][:600], 'kind': sg['jev'], 'confidence': round(sg['confidence'], 3), 'classifier': sg.get('classifier'),
            'card': card_id, 'at': time.time()} for sg in segs if sg.get('jev') and (sg.get('confidence') or 0) >= .6 and sg['text'][:600] not in have]
    if not new:
        return 0
    items += new
    keep, count = [], Counter()
    for it in reversed(items):
        if count[it['kind']] < 40:
            keep.append(it); count[it['kind']] += 1
    LEARNED.write_text(json.dumps(list(reversed(keep)), indent=1))
    return len(new)

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
depth.json        the three lenses (listener, speaker, absorption): the elements the algorithm found, with their words, and Jev's answers
threads.json      every idea as a thread: its state, its stage in its form's arc, and how each open one could have continued or closed
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
    if card.get('named') == 'stated':
        L += ['The name is the title the speaker gave.', '']
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
    if j.get('skipped'):
        L.append('  Jev was not asked: ' + j['skipped'] + '.')
    elif j.get('error'):
        L.append('  Jev did not answer: ' + j['error'])
    elif j:
        L.append(f"  Jev hears it as {j.get('kind')} ({pct(j.get('confidence') or 0)} sure), chose the {j.get('style')} style ({pct(j.get('style_confidence') or 0)} sure), and judged it {pct(1 - (j.get('unsafe') or 0))} safe to draw.")
        for i, sg in enumerate(j.get('segments') or []):
            same = 'agrees' if sg.get('jev') == sg.get('classifier') else 'differs'
            L.append(f"  Passage {i + 1}: the classifier said {sg.get('classifier')}; Jev hears {sg.get('jev')} ({pct(sg.get('confidence') or 0)} sure), and {same}.")
        if j.get('agree') is not None:
            L.append(f"  The classifier agreed with Jev on {pct(j['agree'])} of the passages. Jev stops being needed once that is at least {pct(GRADUATE)} for {IN_A_ROW} recordings in a row.")
        if card.get('refining'):
            L.append('  Claude and the rules: ' + card['refining'] + '.')
        if card.get('taught'):
            L.append(f"  {card['taught']} passages Jev was sure of now teach the classifier.")
        if 'reuse' in j:
            L.append(f"  A saved picture was offered; Jev gave it {pct(j['reuse'])} to fit.")
    else:
        L.append('  No Jev key is saved, so the style came from the kind of speech.')
    try:
        dr = json.loads((folder / 'depth.json').read_text())
    except (OSError, ValueError):
        dr = {}
    if dr.get('algorithm'):
        a = dr['algorithm']; spec = depth.LENSES['kinds'].get(a['kind'], {})
        L += ['', 'DEPTH', f"  Read through the three lenses of {a['kind']}."]
        for lens in depth.ORDER:
            got = a['lenses'][lens]
            found = [e for e in got['elements'] if e['found']]
            L.append(f"  {lens.capitalize():<11} {pct(got['meter'])}" + (f"   Jev {pct(dr['jev'][lens])}" if dr.get('jev') and lens in dr['jev'] else ''))
            L.append(f"    {spec.get(lens, {}).get('question', '')}")
            L.append('    Found: ' + ('; '.join(f"{e['name']} ({', '.join(e['evidence'][:3])})" for e in found) if found else 'none yet') + '.')
        if a.get('next'):
            L.append(f"  To try next: {a['next']['try'] or a['next']['meaning']}")
        if dr.get('jev') and dr['jev'].get('element'):
            el = next((e for e in spec.get('absorption', {}).get('elements', []) if e['id'] == dr['jev']['element']), None)
            if el:
                L.append(f"  Jev hears {el['name'].lower()} as what most draws a listener in.")
        if dr.get('note'):
            L.append('  ' + dr['note'])
    try:
        th = json.loads((folder / 'threads.json').read_text()).get('threads') or []
    except (OSError, ValueError):
        th = []
    if th:
        L += ['', 'THREADS']
        for t in th:
            sug = t.get('suggestion') or {}
            L.append(f"  {t.get('title') or 'a thread'}: {t.get('state')}" + (f", at {t.get('stage')}" if t.get('stage') else '') + (f", {t.get('need')}" if t.get('need') else '') + '.')
            if sug.get('move'):
                L.append(f"    {'Jev' if sug.get('by') == 'Jev' else 'The algorithm'} suggests: {sug['move']}")
            if t.get('link'):
                L.append(f"    Picked up from {t['link'].get('date')}: \"{t['link'].get('title')}\".")
            if t.get('connection'):
                L.append(f"    Jev: this recording {t['connection'].get('relation')} \"{t['connection'].get('past')}\" from {t['connection'].get('date')}.")
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

def threads_record(threads):
    """threads.json: every thread of the recording, its state and stage, and for each one left open the move the
    algorithm sees next (Jev's choice is added after the stop call)"""
    out = []
    for t in threads or []:
        t = {k: v for k, v in t.items()}
        if t.get('state') != 'closed' and t.get('next'):
            t['suggestion'] = {'by': 'algorithm', 'move': t['next']}
        out.append(t)
    return {'threads': out, 'note': 'Each idea is a thread. The algorithm judged each within its form\'s arc; Jev, if asked at the stop, chose how each open thread could have continued or closed.'}

def make(cfg, card, text, abstract=None, phrases=None, audio=None, since=None, threads=None, session=None):
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
    try:
        drec = depth_record(phrases, heavy.mask(text), card)
        if heavy.service(cfg) != 'typesafe':
            drec['note'] = 'The algorithm read every element from the words. No Jev key is saved, so the lens questions were not asked of Jev.'
        (folder / 'depth.json').write_text(json.dumps(drec, indent=1))
        card.setdefault('depth', depth.summary(drec['algorithm']))
    except Exception as e:
        (folder / 'depth.json').write_text(json.dumps({'error': str(e)[:200]}))
    if threads is not None:
        (folder / 'threads.json').write_text(json.dumps(threads_record(threads), indent=1))
        try:
            steer.index_add(threads, card=ident, session=session, when=t0)
        except Exception:
            pass
        card['threads'] = {'open': len([t for t in threads if t.get('state') != 'closed']), 'closed': len([t for t in threads if t.get('state') == 'closed'])}
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
        _paint(cfg, folder, card, say, ON_LEARN.get('f'))
        # Claude refines the rules from where the classifier and Jev disagreed, and keeps only what helps
        if (card.get('jev') or {}).get('segments'):
            say(refining='Claude is refining the rules')
            try:
                import refine
                rep = refine.refine(card['id'])
                if rep:
                    say(refining=rep.get('result'), refined={'before': rep.get('before'), 'after': rep.get('after')})
                    if rep.get('result', '').startswith('kept') and ON_LEARN.get('f'):
                        ON_LEARN['f']()
            except Exception as e:
                say(refining='Claude could not refine the rules: ' + str(e)[:160])
    finally:
        if stitch:
            time.sleep(4)                        # the last piece is written when the microphone stops
            if _stitch_microphone(folder, card.get('since', card['made']), card['made']):
                say(audio='audio.wav')
        elif (folder / 'audio.wav').exists():
            say(audio='audio.wav')

def _paint(cfg, folder, card, say, on_learn=None):
    words = main_words(card.get('text', ''))
    register = card.get('register', 'kelp')
    style = STYLE_FOR.get(card.get('kind'), 'ink')
    hit, likeness = heavy.from_bank(register, style, words)
    # Jev, when its key is saved, decides before anything is drawn
    if heavy.service(cfg) == 'typesafe' and not ask_jev_now():
        items = agreement() + [{'card': card['id'], 'at': time.time(), 'skipped': True}]
        AGREEMENT.write_text(json.dumps(items[-200:], indent=1))
        say(jev={'skipped': 'the classifier agrees with Jev on nine passages in ten, so Jev was not needed for this recording'})
        _depth_merge(folder, card['jev'])
    elif heavy.service(cfg) == 'typesafe':
        say(art='asking Jev')
        try:
            try:
                segs = segments(json.loads((folder / 'phrases.json').read_text()))
            except (OSError, ValueError):
                segs = []
            try:
                ths = json.loads((folder / 'threads.json').read_text()).get('threads')
            except (OSError, ValueError):
                ths = None
            j = jev_card(cfg, card.get('text', ''), hit, segs, ths)
            if ths and j.get('connections'):
                for t in ths:
                    if j['connections'].get(t['id']):
                        t['connection'] = j['connections'][t['id']]
            if ths and (j.get('threads') or j.get('connections')):
                for t in ths:
                    got = j['threads'].get(t['id'])
                    if got and got.get('move'):
                        t['suggestion'] = {'by': 'Jev', 'move': got['move'], 'choice': got['choice'], 'confidence': got.get('confidence'),
                                           'algorithm': (t.get('suggestion') or {}).get('move')}
                rec = json.loads((folder / 'threads.json').read_text()); rec['threads'] = ths
                (folder / 'threads.json').write_text(json.dumps(rec, indent=1))
            taught = learn(j.get('segments', []), card['id'])
            j['agree'] = record_agreement(j.get('segments', []), card['id'])
            if taught and on_learn:
                on_learn()
            _depth_merge(folder, j)
            say(jev=j, taught=taught, depth_jev=(json.loads((folder / 'depth.json').read_text()) or {}).get('jev'))
            if j.get('style') in heavy.STYLES:
                style = j['style']
                hit, likeness = heavy.from_bank(register, style, words)
            if j.get('unsafe', 0) > .5:
                return say(art='kept abstract: Jev judged the recording unsafe to draw')
            if hit and j.get('reuse') is not None and j['reuse'] < .5:
                hit = None                       # Jev says the saved picture does not fit
        except Exception as e:
            say(jev={'error': str(e)[:200]})
            _depth_merge(folder, card['jev'])
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
    dp = d.get('depth') or {}
    if dp.get('lenses'):
        lines += ['', f"Read through the three lenses of {dp.get('kind')}:"]
        for lens in depth.ORDER:
            got = dp['lenses'].get(lens) or {}
            found = [e['name'] for e in got.get('elements', []) if e.get('found')]
            lines.append(f"  {lens:<11} {round((got.get('meter') or 0) * 100)}%   found: {', '.join(found) or 'none yet'}")
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
