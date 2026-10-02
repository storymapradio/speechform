"""How a thread meets a thread: the same rules in Python (here) and in the browser (studio/match.js), line for line.

  stem(word)         the Porter stemmer (1980), so "stairs" meets "stair" and "climbed" meets "climb"
  keywords(text)     the stems of a passage's content words, three letters or more ("fog" counts), stop words out
  pack(vec)/unpack   a thread's meaning vector (MiniLM, 384 numbers) as int8, base64, for the index
  strength(a, b)     how strongly two threads are one thread:
                       .55 × meaning (cosine of their vectors, from .15 up to .5 mapped to 0..1)
                     + .35 × shared stems (over the smaller set; two at least)
                     + .10 × the same form or the same arc stage
                     Without vectors, the stems alone decide, as before.
  LINK               the strength from which two threads count as linked; a thread keeps its best three links
"""
import base64, math, re

LINK = .3
STOP = set('''the and that this with from have were they them their there then when what which would could should about into your just
like been some very over also more than only will said says know think really yeah okay right going want thing things people because where
while these those here each every other after before again still even much many most such being are was for you not but all any can had
her his him she our out who how its let may our own too use way yes got get one two did does done has its it's i'm you're don't can't won't
let's i've we're they're that's there's what's not nor off per via upon onto us we me my mine i a an of to in on at by or if so as is it be do no'''.split())

# ── the Porter stemmer ────────────────────────────────────────────────────────────
def _cons(w, i):
    c = w[i]
    if c in 'aeiou':
        return False
    if c == 'y':
        return i == 0 or not _cons(w, i - 1)
    return True

def _m(w):
    """the measure: the number of vowel-consonant sequences"""
    n, i, L = 0, 0, len(w)
    while i < L and _cons(w, i):
        i += 1
    while i < L:
        while i < L and not _cons(w, i):
            i += 1
        if i >= L:
            break
        n += 1
        while i < L and _cons(w, i):
            i += 1
    return n

def _vowel(w):
    return any(not _cons(w, i) for i in range(len(w)))

def _dcons(w):
    return len(w) >= 2 and w[-1] == w[-2] and _cons(w, len(w) - 1)

def _cvc(w):
    if len(w) < 3:
        return False
    return _cons(w, len(w) - 3) and not _cons(w, len(w) - 2) and _cons(w, len(w) - 1) and w[-1] not in 'wxy'

def _rep(w, rules, cond):
    for suf, rep in rules:
        if w.endswith(suf):
            base = w[:len(w) - len(suf)]
            return base + rep if cond(base) else w
    return w

def stem(w):
    w = w.lower()
    if len(w) <= 2:
        return w
    # 1a
    if w.endswith('sses'): w = w[:-2]
    elif w.endswith('ies'): w = w[:-2]
    elif w.endswith('ss'): pass
    elif w.endswith('s'): w = w[:-1]
    # 1b
    flag = False
    if w.endswith('eed'):
        if _m(w[:-3]) > 0: w = w[:-1]
    elif w.endswith('ed') and _vowel(w[:-2]):
        w = w[:-2]; flag = True
    elif w.endswith('ing') and _vowel(w[:-3]):
        w = w[:-3]; flag = True
    if flag:
        if w.endswith(('at', 'bl', 'iz')): w += 'e'
        elif _dcons(w) and w[-1] not in 'lsz': w = w[:-1]
        elif _m(w) == 1 and _cvc(w): w += 'e'
    # 1c
    if w.endswith('y') and _vowel(w[:-1]): w = w[:-1] + 'i'
    # 2
    w = _rep(w, [('ational', 'ate'), ('tional', 'tion'), ('enci', 'ence'), ('anci', 'ance'), ('izer', 'ize'), ('abli', 'able'), ('alli', 'al'),
                 ('entli', 'ent'), ('eli', 'e'), ('ousli', 'ous'), ('ization', 'ize'), ('ation', 'ate'), ('ator', 'ate'), ('alism', 'al'),
                 ('iveness', 'ive'), ('fulness', 'ful'), ('ousness', 'ous'), ('aliti', 'al'), ('iviti', 'ive'), ('biliti', 'ble')], lambda b: _m(b) > 0)
    # 3
    w = _rep(w, [('icate', 'ic'), ('ative', ''), ('alize', 'al'), ('iciti', 'ic'), ('ical', 'ic'), ('ful', ''), ('ness', '')], lambda b: _m(b) > 0)
    # 4
    for suf in ('al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize'):
        if w.endswith(suf):
            base = w[:len(w) - len(suf)]
            if _m(base) > 1 and (suf != 'ion' or (base and base[-1] in 'st')):
                w = base
            break
    # 5
    if w.endswith('e'):
        base = w[:-1]
        if _m(base) > 1 or (_m(base) == 1 and not _cvc(base)):
            w = base
    if _m(w) > 1 and _dcons(w) and w.endswith('l'):
        w = w[:-1]
    return w

def pairs(text):
    """each content word's stem, with the word as it was said: [(stem, word)], in order of first use"""
    out, seen = [], set()
    for word in re.findall(r"[a-z']+", (text or '').lower().replace('\u2019', "'")):
        word = word.strip("'")
        if len(word) < 3 or word in STOP:
            continue
        s = stem(word)
        if len(s) >= 3 and s not in seen:
            seen.add(s); out.append((s, word))
    return out

def keywords(text, most=40):
    """the stems of a passage's content words, in order of first use"""
    return [s for s, _ in pairs(text)][:most]

# ── meaning vectors, small enough for the index ───────────────────────────────────
def pack(vec):
    if vec is None:
        return None
    v = [max(-127, min(127, int(math.floor(float(x) * 127 + .5)))) for x in vec]
    return base64.b64encode(bytes((x + 256) % 256 for x in v)).decode()

def unpack(s):
    if not s:
        return None
    b = base64.b64decode(s)
    return [((x - 256) if x > 127 else x) / 127 for x in b]

def cosine(a, b):
    if not a or not b or len(a) != len(b):
        return None
    dot = sum(x * y for x, y in zip(a, b)); na = math.sqrt(sum(x * x for x in a)); nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else None

def strength(a, b):
    """two threads, each {keywords (stems), vec (packed or list), kind, stage}: the strength of the link, and why"""
    A, B = list(dict.fromkeys(a.get('keywords') or [])), set(b.get('keywords') or [])
    shared = [w for w in A if w in B]
    kw = len(shared) / max(1, min(len(A), len(B))) if len(shared) >= 2 else 0.0
    va = a.get('vec'); vb = b.get('vec')
    va = unpack(va) if isinstance(va, str) else va
    vb = unpack(vb) if isinstance(vb, str) else vb
    c = cosine(va, vb)
    form = 1.0 if a.get('kind') and a.get('kind') == b.get('kind') else 0.0
    if not form and a.get('stage') and a.get('stage') == b.get('stage'):
        form = 1.0
    if c is None:
        s = kw if (len(shared) >= 2 and kw >= .34) else 0.0
        mean = None
    else:
        mean = max(0.0, min(1.0, (c - .15) / .35))
        s = .55 * mean + .35 * min(1.0, kw) + (.1 * form if (mean > .25 or kw) else 0.0)
    return {'s': round(min(1.0, s), 3), 'shared': shared[:8], 'meaning': None if c is None else round(c, 3), 'form': bool(form)}
