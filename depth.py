"""Depth: the three lenses on a kind of speech, read from the words by algorithm alone.

lenses.json (beside this file, shared with light/depth.js) holds, for each of the nineteen kinds, three
questions asked of that form:

  listener    what must the audience know or bring to appreciate listening to it
  speaker     what must the speaker know to deliver its meaning (the moral, the takeaway, the claim, the turn)
  absorption  which elements of the act, and of the choice of material, most draw a listener in

Each lens has a short answer grounded in the scholarship of oral forms, and a handful of elements. Every
element has a cue the algorithm can find in a transcript: a pattern of words ("re", counted, "need" hits
for a full mark) and/or a structural signal ("signal", full at "at"). An element scores 0..1; a lens meter
is its elements' scores averaged by weight.

The window is the classifier's: the phrases a phrase is heard with, each with its share of the verdict.
Word cues are counted phrase by phrase and weighted by that share (the newest phrase counts fully), and the
structural signals are read over the whole window, because a refrain or a rhythm only exists across phrases.

light/depth.js is the same algorithm, line for line, so Light, Studio and the full app agree.
"""
import json, math, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LENSES, LEX = {}, {}

def load(path=None):
    """read the lenses (lenses.json beside this file, or another copy for testing)"""
    global LENSES, LEX
    LENSES = json.loads(Path(path or ROOT / 'lenses.json').read_text())
    LEX = {k: set(v) for k, v in LENSES['lexicon'].items()}
    return LENSES

load()
ORDER = ('listener', 'speaker', 'absorption')
FOUND = .5            # an element counts as found from this score

_compiled = {}
def _rx(pattern):
    r = _compiled.get(pattern)
    if r is None:
        r = _compiled[pattern] = re.compile(pattern, re.I)
    return r

def _clip(v):
    return max(0.0, min(1.0, v))

def _norm(text):
    return str(text or '').replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')

def _sentences(text):
    return [s.strip() for s in re.split(r'[.!?;]+|\n', text) if s.strip()]

def features(text):
    """how a passage is built, each a rate from 0 to 1, with the words that show it"""
    t = _norm(text)
    low = t.lower()
    words = re.findall(r"[a-z']+", low)
    n = max(len(words), 1)
    sents = _sentences(t)
    ns = max(len(sents), 1)
    lens = [len(re.findall(r"[a-z']+", s.lower())) for s in sents]
    lens = [x for x in lens if x]
    f, ev = {}, {}
    def rate(name, lex, scale):
        hit = [w for w in words if w in LEX[lex]]
        f[name] = _clip(len(hit) / n * scale)
        ev[name] = list(dict.fromkeys(hit))[:6]
    rate('you', 'you', 12)
    rate('we', 'we', 12)
    rate('i', 'i', 10)
    rate('third', 'third', 12)
    rate('sensory', 'sensory', 10)
    rate('present', 'present', 8)
    rate('numbers', 'numbers', 10)
    past = [w for w in words if w in LEX['past'] or (w.endswith('ed') and len(w) > 4)]
    f['past'] = _clip(len(past) / n * 8); ev['past'] = list(dict.fromkeys(past))[:6]
    firsts = [(re.findall(r"[a-z']+", s.lower()) or [''])[0] for s in sents]
    imp = [w for w in firsts if w in LEX['imperative']]
    f['imperative'] = _clip(len(imp) / ns * 1.4); ev['imperative'] = list(dict.fromkeys(imp))[:6]
    q = t.count('?')
    f['question'] = _clip(q / ns * 1.5); ev['question'] = [x.strip()[-48:] for x in re.findall(r'[^.!?]*\?', t)][:4]
    joins = low.count(' and ') + low.count(',')
    f['runon'] = _clip(joins / ns / 5); ev['runon'] = ['%d joins in %d sentences' % (joins, len(sents))] if joins else []
    grams = [' '.join(words[i:i + 3]) for i in range(len(words) - 2)]
    rep = 1 - len(set(grams)) / len(grams) if grams else 0
    f['refrain'] = _clip(rep * 3)
    seen, again = set(), []
    for g in grams:
        if g in seen and g not in again:
            again.append(g)
        seen.add(g)
    ev['refrain'] = again[:4]
    opens = [' '.join(re.findall(r"[a-z']+", s.lower())[:2]) for s in sents]
    opens = [o for o in opens if len(o.split()) == 2]
    dup = [o for o in opens if opens.count(o) > 1]
    f['anaphora'] = _clip(len(dup) / ns * 1.5); ev['anaphora'] = list(dict.fromkeys(dup))[:4]
    avg = sum(lens) / len(lens) if lens else 0
    f['short'] = _clip((8 - avg) / 6) if lens else 0.0
    f['long'] = _clip((avg - 14) / 12) if lens else 0.0
    ev['short'] = ev['long'] = ['%.0f words a sentence' % avg] if lens else []
    if len(lens) >= 3:
        mean = sum(lens) / len(lens)
        sd = math.sqrt(sum((x - mean) ** 2 for x in lens) / len(lens))
        f['rhythm'] = _clip(1 - sd / max(mean, 1) * 1.5)
        ev['rhythm'] = ['sentences of ' + ', '.join(str(x) for x in lens[:6]) + ' words']
    else:
        f['rhythm'] = 0.0; ev['rhythm'] = []
    names = []
    for s in sents:
        toks = re.findall(r"[A-Za-z][a-z']+", s)
        for w in toks[1:]:
            if w[0].isupper() and w.lower() not in LEX['notnames']:
                names.append(w)
    f['names'] = _clip(len(set(names)) / 3); ev['names'] = list(dict.fromkeys(names))[:6]
    content = [w for w in words if len(w) > 3 and w not in LEX['stop']]
    pairs = [(a, b) for a, b in zip(content, content[1:])]
    allit = [a + ' ' + b for a, b in pairs if a[0] == b[0] and a != b]
    f['alliteration'] = _clip(len(allit) / max(len(pairs), 1) * 4); ev['alliteration'] = allit[:4]
    quotes = len(re.findall(r'"', t)) // 2 + len(re.findall(r"\b(said|asked|replied|answered|cried|whispered)\b", low))
    f['quote'] = _clip(quotes / 2); ev['quote'] = re.findall(r"\b(said|asked|replied|answered|cried|whispered)\b", low)[:4]
    return f, ev

def element(el, window, feats):
    """one element's score over the window, and the words that earned it"""
    cue = el.get('cue') or {}
    score, evidence = 0.0, []
    if cue.get('re'):
        rx = _rx(cue['re'])
        top = max((w for _, w in window), default=1) or 1
        hits = 0.0
        for text, w in window:
            found = [m.group(0) for m in rx.finditer(_norm(text))]
            hits += len(found) * (w / top)
            evidence += [x.strip() for x in found]
        score = _clip(hits / float(cue.get('need', 2)))
    if cue.get('signal'):
        v = feats[0].get(cue['signal'], 0.0)
        s = _clip(v / float(cue.get('at', 1)))
        if s > score:
            score = s
        if s > 0:
            evidence += feats[1].get(cue['signal'], [])
    return round(score, 3), list(dict.fromkeys(e.lower() for e in evidence if e))[:6]

def lens_reading(kind, window, feats=None):
    """the three lenses of one kind over a window [(text, weight)]"""
    feats = feats or features(' '.join(t for t, _ in window))
    spec = LENSES['kinds'][kind]
    out = {}
    for lens in ORDER:
        L = spec[lens]
        els, total, wsum = [], 0.0, 0.0
        for el in L['elements']:
            s, ev = element(el, window, feats)
            wt = float(el.get('weight', 1))
            total += wt * s; wsum += wt
            els.append({'id': el['id'], 'name': el['name'], 'score': s, 'found': s >= FOUND, 'evidence': ev, 'weight': wt})
        out[lens] = {'meter': round(total / wsum if wsum else 0, 3), 'elements': els}
    return out

def next_step(kind, lenses):
    """the strongest missing element: in the weakest lens, the heaviest element not yet found"""
    spec = LENSES['kinds'][kind]
    best = None
    for lens in sorted(ORDER, key=lambda l: lenses[l]['meter']):
        for el, got in zip(spec[lens]['elements'], lenses[lens]['elements']):
            if got['found']:
                continue
            gain = float(el.get('weight', 1)) * (1 - got['score'])
            if best is None or gain > best[0] + 1e-9:
                best = (gain, lens, el)
        if best:
            break
    if not best:
        return None
    _, lens, el = best
    return {'lens': lens, 'id': el['id'], 'name': el['name'], 'meaning': el['meaning'], 'try': el.get('try', '')}

def reading(window, kinds):
    """the depth of the talk: full detail for the lead kind, the meters for any near-tied kinds"""
    kinds = [k for k in dict.fromkeys(kinds) if k in LENSES['kinds']]
    if not kinds or not window:
        return None
    window = [(t, float(w)) for t, w in window if t and str(t).strip()]
    if not window:
        return None
    feats = features(' '.join(t for t, _ in window))
    lead = kinds[0]
    lenses = lens_reading(lead, window, feats)
    near = {}
    for k in kinds[1:3]:
        r = lens_reading(k, window, feats)
        near[k] = {l: r[l]['meter'] for l in ORDER}
    return {'kind': lead, 'lenses': lenses, 'near': near, 'next': next_step(lead, lenses),
            'words': sum(len(t.split()) for t, _ in window)}

def passage(text, kinds):
    """any stretch of text read on its own, every phrase counting the same"""
    parts = [x.strip() for x in re.split(r'(?<=[.!?;])\s+|\n+', _norm(text)) if x.strip()]
    return reading([(p, 1.0) for p in parts], kinds)

def near_kinds(lead, settled, within=.1, most=2):
    """the kinds whose running share sits within a tenth of the lead's: [(kind, share)] sorted"""
    shares = dict(settled)
    top = shares.get(lead, max(shares.values()) if shares else 0)
    out = [k for k, v in sorted(settled, key=lambda x: -x[1]) if k != lead and v >= top - within][:most]
    return [lead] + out

def over_time(phrases):
    """the three lens meters of each phrase, in order, from the depth each phrase carries"""
    out = []
    for p in phrases:
        d = p.get('depth') or (p.get('why') or {}).get('depth')
        if d:
            out.append({'at': p.get('at'), 'kind': d['kind'], **{l: d['lenses'][l]['meter'] for l in ORDER}})
    return out

def summary(d):
    """the depth reading as a short record for a card"""
    if not d:
        return None
    return {'kind': d['kind'], **{l: d['lenses'][l]['meter'] for l in ORDER},
            'found': {l: [e['id'] for e in d['lenses'][l]['elements'] if e['found']] for l in ORDER},
            'next': d.get('next')}
