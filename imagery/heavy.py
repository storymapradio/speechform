"""Speechform Heavy, on the server: safe prompts, the image bank, saved sequences, and Jev's tasks.

Jev is reached through one endpoint with the person's own token (kept in
~/.config/speechform/settings.json, never sent to the page). Every call is a POST with a `task`:

  {"task": "direct", ...the /listen payload...}          -> a direction (register, mix, warmth, ...)
  {"task": "image", "prompt", "negative", "style", "size": [w, h], "seed", "scene"}
                                                          -> {"image": "data:image/...;base64,..." or "https://..."}
  {"task": "choose", "text", "candidates": [{"id", "kind", "keywords", "at"}]}
                                                          -> {"id": "...", "why": "..."}

Images are generated only when the bank has nothing close enough, and at most once every
IMAGE_EVERY seconds, so tokens are spent on new scenes only.
"""
import base64, hashlib, json, re, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANK = ROOT / 'runtime' / 'bank'
SEQUENCES = ROOT / 'runtime' / 'sequences'
IMAGE_EVERY = 15.0

# ── what an image may never be ────────────────────────────────────────────────────
PROFANITY = set('''fuck fucking fucked fucker shit shitty bullshit bitch bitches bastard asshole ass damn goddamn crap
dick cock cunt pussy piss slut whore wanker bollocks motherfucker'''.split())
VIOLENCE = set('''kill killed killing kills murder murdered murderer blood bloody gore gory gun guns shoot shooting shot
stab stabbed knife knives bomb bombs explode explosion corpse corpses torture tortured weapon weapons massacre
slaughter behead decapitate war wounded wound rape suicide dead death die dying'''.split())
NEGATIVE = 'violence, gore, blood, weapons, injury, death, nudity, profanity, text, letters, words, watermark, logo'
BLOCKED = PROFANITY | VIOLENCE

def mask(text):
    """a transcript shown or kept without bad words"""
    return re.sub(r"[A-Za-z']+", lambda m: '•' * len(m.group(0)) if m.group(0).lower() in PROFANITY else m.group(0), text or '')

STOP = set('''a an the this that these those is are was were be been being to of and or in on at for with as i you he she it we
they my your our their me us them but if then so from by have has had do does did will would can could should just very all some
about into how what when where which who its let not there here one also more like said says know think really yeah okay right
going want thing things something people upon down across along over under through once there then'''.split())

def keywords(text, n=6):
    """the words of a passage an image may use: content words, never a blocked one"""
    seen = []
    for w in re.findall(r"[a-z']+", (text or '').lower()):
        if len(w) > 3 and w not in STOP and w not in BLOCKED and w not in seen:
            seen.append(w)
    return seen[:n]

# ── styles and subjects ───────────────────────────────────────────────────────────
STYLES = {
    'ink':      ('sumi ink wash on rice paper', 'soft black ink, generous white space, quiet brush strokes'),
    'glass':    ('stained glass window', 'jewel colours, lead lines, light shining through'),
    'water':    ('loose watercolour', 'wet edges, pale washes, paper texture'),
    'neon':     ('glowing neon line art on black', 'luminous outlines, deep black, soft bloom'),
    'woodcut':  ('hand-carved woodcut print', 'bold relief lines, two or three inks, paper grain'),
    'cosmic':   ('deep-space nebula painting', 'star fields, soft gas clouds, distant light'),
}
SUBJECT = {
    'bloom': 'a luminous flower opening in a golden spiral',
    'path': 'a winding path with small lanterns toward a distant horizon',
    'land': 'layered ridgelines of a quiet valley at dusk',
    'hive': 'a temple of tessellated hexagons, like a honeycomb',
    'orrery': 'small planets orbiting a warm sun',
    'rings': 'concentric ripples closing on one bright point',
    'stack': 'a cairn of balanced stones',
    'kelp': 'a single kelp stalk with branching fronds under water',
    'tide': 'two tides meeting gently on a shore',
    'waves': 'ribbons of sound rising like waves',
}

def prompt_for(register, text, style):
    style = style if style in STYLES else 'ink'
    lead, finish = STYLES[style]
    words = keywords(text, 5)
    evoking = ', evoking ' + ', '.join(words) if words else ''
    prompt = f'{lead}: {SUBJECT.get(register, SUBJECT["kelp"])}{evoking}; {finish}; calm, hopeful, suitable for all ages, no text'
    return prompt, words

# ── the bank ──────────────────────────────────────────────────────────────────────
def _index():
    try:
        return json.loads((BANK / 'index.json').read_text())
    except (OSError, ValueError):
        return []

def _save_index(items):
    BANK.mkdir(parents=True, exist_ok=True)
    tmp = BANK / 'index.tmp'
    tmp.write_text(json.dumps(items, indent=0))
    tmp.replace(BANK / 'index.json')

def from_bank(register, style, words):
    """an image already made for this image, style and nearly these words"""
    best, score = None, 0.0
    ws = set(words)
    for it in _index():
        if it['register'] != register or it['style'] != style:
            continue
        other = set(it['keywords'])
        s = len(ws & other) / max(1, len(ws | other)) if (ws or other) else 1.0
        if s > score:
            best, score = it, s
    if best and (score >= .5 or not ws):
        best['uses'] = best.get('uses', 0) + 1
        items = [best if i['id'] == best['id'] else i for i in _index()]
        _save_index(items)
        return best, score
    return None, score

def to_bank(register, style, words, prompt, image):
    """keep what Jev made, so the same scene never costs twice"""
    BANK.mkdir(parents=True, exist_ok=True)
    ident = hashlib.sha1(f'{register}|{style}|{" ".join(sorted(words))}|{time.time()}'.encode()).hexdigest()[:14]
    if image.startswith('data:'):
        head, data = image.split(',', 1)
        ext = 'svg' if 'svg' in head else 'jpg' if 'jpeg' in head or 'jpg' in head else 'png'
        (BANK / f'{ident}.{ext}').write_bytes(base64.b64decode(data))
    else:
        with urllib.request.urlopen(image, timeout=30) as r:
            kind = r.headers.get('content-type', 'image/png')
            ext = 'svg' if 'svg' in kind else 'jpg' if 'jpeg' in kind else 'png'
            (BANK / f'{ident}.{ext}').write_bytes(r.read())
    item = {'id': ident, 'file': f'{ident}.{ext}', 'register': register, 'style': style, 'keywords': words,
            'prompt': prompt, 'at': time.time(), 'uses': 0}
    items = _index(); items.append(item); _save_index(items)
    return item

def bank_list():
    return sorted(_index(), key=lambda i: -i['at'])

# ── Jev: a token from a known service, or a custom Jev service ────────────────────
# A token's first characters say whose it is, and each service's address is fixed, so a person
# only ever pastes their token. A custom Jev service is the one case that needs an address.
SERVICES = {
    'typesafe': {'name': 'Jev (TypeSafe)', 'images': False, 'model': 'jev-latest'},
    'openai': {'name': 'OpenAI', 'images': True, 'text_model': 'gpt-4o-mini', 'image_model': 'gpt-image-1'},
    'gemini': {'name': 'Google Gemini', 'images': True, 'text_model': 'gemini-2.5-flash', 'image_model': 'gemini-2.5-flash-image'},
    'claude': {'name': 'Anthropic Claude', 'images': False, 'text_model': 'claude-haiku-4-5-20251001'},
    'jev':    {'name': 'a custom Jev service', 'images': True},
}

def detect(token):
    t = (token or '').strip()
    if t.startswith('apikey_') or t.startswith('tsk_'):
        return 'typesafe'
    if t.startswith('sk-ant-'):
        return 'claude'
    if t.startswith('sk-'):
        return 'openai'
    if t.startswith('AIza'):
        return 'gemini'
    return None

def service(cfg):
    """which service the saved settings point at"""
    p = cfg.get('provider')
    if p == 'jev' and (cfg.get('endpoint') or cfg.get('image_endpoint')):
        return 'jev'
    if p in ('typesafe', 'openai', 'gemini', 'claude') and cfg.get('key'):
        return p
    return None

def image_service(cfg):
    """who makes the images: an image key of its own if one is saved, otherwise the main key if it can"""
    ik = cfg.get('image_key')
    if ik and detect(ik) in ('openai', 'gemini'):
        return detect(ik), ik
    svc = service(cfg)
    if svc and SERVICES[svc]['images']:
        return svc, cfg.get('key', '')
    return None, None

# ── Jev by TypeSafe: a decision model that answers choices, scores and true-or-false with probabilities ──
TYPESAFE = 'https://api.typesafe.ai'
KIND_CRITERIA = {
    'instruction': 'steps or commands telling someone how to do something', 'lecture': 'explaining a subject, research or evidence to an audience',
    'lesson': 'teaching a class, asking learners to try and answer', 'dialogue': 'two people talking, questions and replies',
    'reflective monologue': 'looking back on one\'s own life and what it meant', 'thinking aloud': 'working a problem out loud, hesitating, trying options',
    'stream of consciousness': 'a run-on drift of images and thoughts', 'reading aloud': 'written prose read from a book',
    'song': 'singing, chorus, la la', 'lyrics': 'song words, rhymed lines to someone', 'poetry': 'a poem, images and metaphor in short lines',
    'story': 'telling what happened to characters, one event after another', 'character development': 'how a character feels, changes, fears or wants',
    'scenery': 'describing a place or landscape', 'lore': 'the customs, orders and history of an invented world', 'myth': 'gods, origins, why the world is as it is',
    'cosmology': 'the universe, stars, space and time', 'mystery': 'a puzzle, clues, who did it', 'argument': 'making a claim and supporting it',
}

def typesafe(cfg, state, questions, timeout=15, limit=4000):
    got = _call(TYPESAFE + '/v1/systemone', {'state': state[:limit], 'model': cfg.get('model') or 'jev-latest', 'questions': questions},
                {'Authorization': 'Bearer ' + cfg.get('key', '')}, timeout)
    return got.get('answers', {})

def jev_hear(cfg, text):
    """Jev's reading of the last minute of talk: its kind, its warmth and pace, and whether it is safe to draw"""
    a = typesafe(cfg, mask(text), {
        'kind': {'type': 'choice', 'instructions': 'What kind of speech is this passage?', 'criteria': KIND_CRITERIA},
        'warmth': {'type': 'score', 'instructions': 'How warm is the feeling of this passage?', 'criteria': ['cool, blue, night, distant', 'neutral', 'warm, golden, home, close']},
        'tempo': {'type': 'score', 'instructions': 'How lively is the pace of this passage?', 'criteria': ['slow and still', 'steady', 'quick and lively']},
        'unsafe': {'type': 'noul', 'instructions': 'Does this passage describe violence, gore or cruelty, or use profanity?'},
    })
    k = a.get('kind', {})
    return {'kind': k.get('choice'), 'confidence': k.get('confidence'), 'probabilities': k.get('probabilities', {}),
            'warmth': (a.get('warmth', {}).get('score', 1) or 0) / 2, 'tempo': (a.get('tempo', {}).get('score', 1) or 0) / 2,
            'unsafe': a.get('unsafe', {}).get('noul', 0)}

def _call(url, body, headers, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'content-type': 'application/json', **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')[:300]
        raise RuntimeError(f'{e.code}: {detail}')

def jev(cfg, body, timeout=45):
    """a custom Jev service: every call is a POST with a task (see heavy/README.md)"""
    endpoint = (cfg.get('image_endpoint') if body.get('task') == 'image' else None) or cfg.get('endpoint')
    if not endpoint:
        raise RuntimeError('no Jev address set')
    headers = {'Authorization': 'Bearer ' + cfg['key']} if cfg.get('key') else {}
    return _call(endpoint, body, headers, timeout)

def make_image(cfg, prompt, negative, style, seed, scene):
    """one image from whichever service can make it; returns a data: or https: address"""
    svc = service(cfg); key = cfg.get('key', '')
    if svc != 'jev':
        svc, key = image_service(cfg)
    if svc == 'jev':
        got = jev(cfg, {'task': 'image', 'prompt': prompt, 'negative': negative, 'style': style, 'size': [768, 768], 'seed': seed, 'scene': scene})
        return got.get('image') if isinstance(got, dict) else None
    full = f'{prompt}. Avoid: {negative}.'
    if svc == 'openai':
        got = _call('https://api.openai.com/v1/images/generations',
                    {'model': cfg.get('image_model') or SERVICES['openai']['image_model'], 'prompt': full, 'size': '1024x1024', 'n': 1},
                    {'Authorization': 'Bearer ' + key}, timeout=120)
        d = (got.get('data') or [{}])[0]
        return 'data:image/png;base64,' + d['b64_json'] if d.get('b64_json') else d.get('url')
    if svc == 'gemini':
        model = cfg.get('image_model') or SERVICES['gemini']['image_model']
        got = _call(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
                    {'contents': [{'parts': [{'text': full}]}], 'generationConfig': {'responseModalities': ['IMAGE']}},
                    {'x-goog-api-key': key}, timeout=120)
        for part in ((got.get('candidates') or [{}])[0].get('content') or {}).get('parts', []):
            inline = part.get('inlineData') or part.get('inline_data')
            if inline and inline.get('data'):
                return f"data:{inline.get('mimeType') or inline.get('mime_type') or 'image/png'};base64,{inline['data']}"
        return None
    return None

def ask_text(cfg, prompt, timeout=20):
    """a short answer in words from whichever service the token belongs to"""
    svc = service(cfg); key = cfg.get('key', '')
    if svc == 'openai':
        got = _call('https://api.openai.com/v1/chat/completions', {'model': cfg.get('model') or SERVICES['openai']['text_model'],
                    'messages': [{'role': 'user', 'content': prompt}]}, {'Authorization': 'Bearer ' + key}, timeout)
        return got['choices'][0]['message']['content']
    if svc == 'gemini':
        model = cfg.get('model') or SERVICES['gemini']['text_model']
        got = _call(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
                    {'contents': [{'parts': [{'text': prompt}]}]}, {'x-goog-api-key': key}, timeout)
        return ''.join(p.get('text', '') for p in got['candidates'][0]['content']['parts'])
    if svc == 'claude':
        got = _call('https://api.anthropic.com/v1/messages', {'model': cfg.get('model') or SERVICES['claude']['text_model'], 'max_tokens': 200,
                    'messages': [{'role': 'user', 'content': prompt}]}, {'x-api-key': key, 'anthropic-version': '2023-06-01'}, timeout)
        return got['content'][0]['text']
    raise RuntimeError('no service')

def describe(cfg):
    """what the saved token is, in plain words, for the key screen"""
    svc = service(cfg)
    if not svc:
        return {'service': None, 'images': False, 'says': ''}
    info = SERVICES[svc]
    if svc == 'typesafe':
        img = image_service(cfg)[0]
        can = 'decides the kind of speech, the warmth and pace, and which image to build on; ' + (f"images come from {SERVICES[img]['name']}" if img else 'add an OpenAI or Gemini key under Images for generated images')
    else:
        can = 'makes images and picks which image to build on' if info['images'] else 'picks which image to build on; it cannot make images, so the growing images carry the scene'
    return {'service': svc, 'images': bool(image_service(cfg)[0]), 'says': f"{info['name']}: {can}."}

_last_made = {'at': 0.0}

def imagine(cfg, scene):
    """an image for this moment: from the bank if one is close, from Jev if not, or none"""
    register = scene.get('register', 'kelp'); style = scene.get('style', 'ink')
    prompt, words = prompt_for(register, scene.get('text', ''), style)
    hit, score = from_bank(register, style, words)
    if hit:
        return {'ok': True, 'from': 'bank', 'item': hit, 'likeness': round(score, 2)}
    svc = service(cfg)
    img_svc = 'jev' if svc == 'jev' else image_service(cfg)[0]
    if not img_svc:
        why = (SERVICES[svc]['name'] + ' decides but does not make images; add an OpenAI or Gemini key under Images') if svc else 'no token yet'
        return {'ok': True, 'from': None, 'why': why + '; the growing images carry the scene', 'prompt': prompt}
    svc = img_svc
    if time.time() - _last_made['at'] < IMAGE_EVERY:
        return {'ok': True, 'from': None, 'why': 'waiting before asking Jev again', 'prompt': prompt}
    _last_made['at'] = time.time()
    image = make_image(cfg, prompt, NEGATIVE, style, int(hashlib.sha1(prompt.encode()).hexdigest()[:6], 16),
                       {k: scene.get(k) for k in ('kind', 'register', 'camera')})
    if not image:
        return {'ok': False, 'error': SERVICES[svc]['name'] + ' answered without an image'}
    return {'ok': True, 'from': svc, 'item': to_bank(register, style, words, prompt, image)}

def choose(cfg, text, candidates):
    """which saved image to keep building on: Jev's pick, or the one sharing the most words"""
    words = set(keywords(text, 12))
    svc = service(cfg)
    if svc and candidates:
        try:
            if svc == 'jev':
                got = jev(cfg, {'task': 'choose', 'text': mask(text), 'candidates': candidates}, timeout=10)
            elif svc == 'typesafe':
                names = {f'image {i + 1}': c for i, c in enumerate(candidates[-10:])}
                a = typesafe(cfg, 'Someone is speaking while an image is built from their words. They now say: ' + mask(text),
                             {'build_on': {'type': 'choice', 'instructions': 'Which saved image fits best to keep building on?',
                                           'criteria': {n: f"{c.get('kind', '')}: {', '.join(c.get('keywords', [])) or 'no words'}" for n, c in names.items()}}}, timeout=12)
                pick = a.get('build_on', {})
                c = names.get(pick.get('choice'))
                got = {'id': c['id'], 'why': f"it fits what you are saying now ({round((pick.get('confidence') or 0) * 100)}% sure)"} if c else {}
            else:
                listing = '\n'.join(f"{c['id']}: {c.get('kind', '')}; {', '.join(c.get('keywords', []))}" for c in candidates)
                answer = ask_text(cfg, 'Someone is speaking and an image is being built from their words. They now say: "' + mask(text)
                                  + '". Which saved image fits best to keep building on? Reply with ONLY JSON {"id": "...", "why": "..."}.\n' + listing, timeout=12)
                m = re.search(r'\{.*\}', answer, re.S); got = json.loads(m.group(0)) if m else {}
            if got.get('id') in {c['id'] for c in candidates}:
                return {'id': got['id'], 'by': svc, 'why': got.get('why', '')}
        except Exception:
            pass
    best, score = None, -1.0
    for c in candidates:
        s = len(words & set(c.get('keywords', []))) + (0.5 if c.get('kind') == candidates[-1].get('kind') else 0)
        if s > score:
            best, score = c, s
    return {'id': best['id'] if best else None, 'by': 'rule', 'why': f'shares {int(score)} words with what you are saying' if best else ''}

# ── sequences ─────────────────────────────────────────────────────────────────────
def save_frame(session, streak, meta, jpeg):
    d = SEQUENCES / re.sub(r'[^\w-]', '', session or 'session')
    d.mkdir(parents=True, exist_ok=True)
    n = len(list(d.glob('*.jpg')))
    name = f'{n:04d}.jpg'
    (d / name).write_bytes(jpeg)
    index = d / 'sequence.json'
    try:
        items = json.loads(index.read_text())
    except (OSError, ValueError):
        items = []
    item = {'id': f'{d.name}/{name}', 'file': name, 'streak': streak, 'at': time.time(), **{k: meta.get(k) for k in ('kind', 'register', 'style', 'text', 'keywords')}}
    items.append(item)
    index.write_text(json.dumps(items, indent=0))
    return item

def sequences():
    out = []
    for d in sorted(SEQUENCES.glob('*'), reverse=True):
        try:
            items = json.loads((d / 'sequence.json').read_text())
        except (OSError, ValueError):
            continue
        out.append({'session': d.name, 'frames': items})
    return out
