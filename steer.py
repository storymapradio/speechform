"""Steering: what the talk has opened and not yet closed, where each thread stands in its form's arc,
who has spoken and asked what, and whether the listener is still held. By algorithm, phrase by phrase.

Every idea the engine finds becomes a thread. A thread is
  opened       its first phrase
  developing   more phrases since
  returned     the talk came back to it after another idea
  ready        it has setup and development by its form's arc, and no landing yet ("ready to close")
  dormant      nothing said of it for DORMANT_SECONDS or DORMANT_WORDS of other talk
  closed       a landing: its arc's last stage, or a closing marker ("in the end", "that's why", a stated moral)

Each kind's arc (lenses.json, "arc") is a list of stages, each with a cue, the move that reaches it and what a
thread lacks without it ("needs an ending"). The stage a thread has reached gives its natural next move.

Jev never runs here. The server may ask Jev at a natural pause (see imagery/server.py, /pause), spaced out.
"""
import json, re, time
from collections import Counter
from pathlib import Path
import depth, match

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / 'runtime' / 'threads-index.json'
DORMANT_SECONDS = 90       # a thread unmentioned this long is dormant
DORMANT_WORDS = 120        # or after this many words of other talk
READY_WORDS = 60           # a thread this long counts as developed even without a middle stage
RACE_WPS = 3.0             # words a second over the last RACE_SPAN seconds that count as racing
RACE_SPAN = 20
DROP = .7                  # absorption below this share of its best stretch so far counts as a drop
MARKS = 24                 # the mentions kept per thread for drawing
LANDING = re.compile(r"\b(?:so in the end|in the end|that'?s why|that is why|and that'?s (?:how|why|it|all)|the moral|the lesson (?:is|was)|so the answer|which brings (?:me|us) back|to this day|from then on|ever after|the end)\b", re.I)
STOP = set('the and that this with from have were they them their there then when what which would could should about into your just like been some very over also more than only will said says know think really yeah okay right going want thing things people because where while these those here each every other after before again still even much many most such being'.split())

def arc(kind):
    return (depth.LENSES['kinds'].get(kind) or {}).get('arc') or []

def stages_in(kind, text):
    """the stages of a kind's arc whose cue this text shows"""
    out = []
    for s in arc(kind):
        cue = s.get('cue') or {}
        hit = bool(cue.get('re') and len(depth._rx(cue['re']).findall(depth._norm(text))) >= int(cue.get('need', 1)))
        if not hit and cue.get('signal'):
            hit = depth.features(text)[0].get(cue['signal'], 0) >= float(cue.get('at', 1))
        if hit:
            out.append(s['id'])
    return out

def keywords(text):
    """the stems of a passage's content words (match.py: the same in the browser)"""
    return match.keywords(text)

RECHECK = 3                # a thread is matched again against the index every few phrases, all through its life
MOST_LINKS = 3

# ── the cross-recording index ─────────────────────────────────────────────────────
_index_cache = {'mtime': None, 'items': []}
def index_load():
    try:
        m = INDEX.stat().st_mtime
        if m != _index_cache['mtime']:
            _index_cache.update(mtime=m, items=json.loads(INDEX.read_text()))
        return _index_cache['items']
    except (OSError, ValueError):
        return []

def index_add(threads, card=None, session=None, when=None):
    """keep this recording's threads (their stems, meaning vectors and words), so a later recording is linked to them"""
    items = list(index_load())
    have = {(x.get('session'), x.get('id')) for x in items}
    for t in threads or []:
        if (session, t.get('id')) in have or not t.get('keywords'):
            continue
        items.append({'id': t['id'], 'title': t.get('title'), 'keywords': t['keywords'][:24], 'vec': t.get('vec'), 'say': (t.get('say') or {}),
                      'kind': t.get('kind'), 'stage': t.get('stage'), 'state': t.get('state'), 'first': (t.get('first') or '')[:120],
                      'opened_by': t.get('opened_by'), 'opened_at': t.get('opened_at'), 'session': session, 'card': card, 'at': when or time.time()})
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(items[-800:], indent=1))

_unpacked = {}
def index_matches(thread, session, items=None, most=MOST_LINKS):
    """the earlier threads this one is most like, by meaning and stems (match.strength), the best few above the line"""
    out = []
    for x in items if items is not None else index_load():
        if x.get('session') == session:
            continue
        v = _unpacked.get(x.get('vec')) if x.get('vec') else None
        if x.get('vec') and v is None:
            v = _unpacked[x['vec']] = match.unpack(x['vec'])
        m = match.strength(thread, {**x, 'vec': v})
        if m['s'] >= match.LINK:
            words = x.get('say') or {}
            out.append({'title': x.get('title'), 'at': x.get('at'), 'card': x.get('card'), 'kind': x.get('kind'), 'state': x.get('state'),
                        'first': x.get('first'), 'opened_at': x.get('opened_at'), 'thread': x.get('id'), 'strength': m['s'], 'score': m['s'],
                        'shared': [(thread.get('say') or {}).get(w) or words.get(w) or w for w in m['shared']][:6], 'meaning': m['meaning'], 'form': m['form'],
                        'date': time.strftime('%-d %B', time.localtime(x.get('at') or 0))})
    out.sort(key=lambda m: -m['strength'])
    seen, best = set(), []
    for m in out:                                   # one link per earlier recording
        if (m['card'], m['thread']) not in seen and len(best) < most:
            seen.add((m['card'], m['thread'])); best.append(m)
    return best

def index_match(kw, session, items=None):
    """the older call: stems alone, the best one link"""
    got = index_matches({'keywords': kw}, session, items, 1)
    return got[0] if got else None

# ── the ledger ────────────────────────────────────────────────────────────────────
class Ledger:
    def __init__(self, session=None, embed=None):
        self.session = session
        self.embed = embed       # text → a meaning vector (the Mac's MiniLM); without it, stems alone link threads
        self.threads = {}; self.order = []
        self.questions = []; self.airtime = Counter(); self.turns = 0; self.last_speaker = None
        self.words = 0; self.prev_topic = None
        self.absorb = []; self.held = Counter(); self.held_names = {}
        self.times = []          # (at, words) for the pace
        self._index = None

    def _thread(self, topic, text, speaker, now, kind):
        t = self.threads.get(topic['id'])
        if t:
            return t, False
        t = {'id': topic['id'], 'title': topic.get('title'), 'kinds': Counter(), 'opened_at': now, 'opened_by': speaker, 'last_at': now,
             'last_word': self.words, 'words': 0, 'n': 0, 'returns': 0, 'speakers': Counter(), 'stages': {}, 'landing_n': None, 'landing_at': None,
             'returned_n': None, 'marks': [], 'first': text[:90], 'link': None, 'links': [], 'keywords': [], 'say': {}, 'opening': '', 'vec': None}
        self.threads[topic['id']] = t; self.order.append(topic['id'])
        return t, True

    def add(self, event, depth_reading=None, topic=None):
        """one phrase: its thread, its arc, its speaker and questions, and the listener's hold. Returns the snapshot."""
        text, speaker, now, kind = event['text'], event.get('speaker') or 'A', float(event.get('at') or time.time()), event.get('form')
        n = len(text.split())
        topic = topic or {'id': event.get('topic'), 'title': ''}
        t, new = self._thread(topic, text, speaker, now, kind)
        # returning: the talk was on another idea and comes back to this one
        if not new and self.prev_topic and self.prev_topic != t['id']:
            t['returns'] += 1; t['returned_n'] = t['n']
        self.prev_topic = t['id']
        self.words += n
        t['n'] += 1; t['words'] += n; t['last_at'] = now; t['last_word'] = self.words; t['kinds'][kind] += n; t['speakers'][speaker] += n
        t['title'] = topic.get('title') or t['title']
        for st_, w in match.pairs(text):
            if st_ not in t['say'] and len(t['say']) < 40:
                t['say'][st_] = w
        t['keywords'] = list(dict.fromkeys(t['keywords'] + keywords(text)))[:30]
        if len(t['opening'].split()) < 40:
            t['opening'] = (t['opening'] + ' ' + text).strip()
        hit = stages_in(kind, text)
        for s in hit:
            t['stages'].setdefault(kind, {}).setdefault(s, now)
        t['marks'].append([round(now, 2), n, speaker, hit])
        t['marks'] = t['marks'][-MARKS:]
        lands = [s['id'] for s in arc(kind) if s.get('landing')]
        if t['n'] >= 2 and (any(s in lands for s in hit) or LANDING.search(text)):
            t['landing_n'] = t['n']; t['landing_at'] = now
        # earlier recordings' threads: matched at its first phrases, and again every few phrases all through its life
        if t['n'] <= 3 or t['n'] % RECHECK == 0:
            self.relink(t, kind)
        # who speaks, and what they ask
        if self.last_speaker and speaker != self.last_speaker:
            self.turns += 1
            for q in self.questions:
                if not q.get('answered_at') and q['speaker'] != speaker:
                    q['answered_at'] = now; q['answered_by'] = speaker
        self.last_speaker = speaker
        self.airtime[speaker] += n
        for qs in re.findall(r'[^.!?]*\?', depth._norm(text)):
            if qs.strip():
                self.questions.append({'id': '%s-%d' % (event.get('id'), len(self.questions)), 'speaker': speaker, 'at': now, 'text': qs.strip()[-90:], 'idea': t['id']})
        self.questions = self.questions[-40:]
        # the hold: the absorption meter, what has held it, and the pace
        if event.get('source') not in ('Typed', 'Test', 'Section'):          # the pace is the voice's, so typed words do not count
            self.times.append((now, n))
        self.times = [x for x in self.times if now - x[0] <= 120]
        if depth_reading:
            ab = depth_reading['lenses']['absorption']
            self.absorb.append((now, ab['meter']))
            for e in ab['elements']:
                if e['found']:
                    self.held[(depth_reading['kind'], e['id'])] += 1; self.held_names[(depth_reading['kind'], e['id'])] = e['name']
        return self.snapshot(now, kind, t['id'])

    def relink(self, t, kind=None):
        """this thread against the index: its meaning (opening words and its words so far), its stems, its form"""
        if self.embed:
            try:
                t['vec'] = match.pack(self.embed(t['opening'] + '. ' + ' '.join(list(t['say'].values())[:12])))
            except Exception:
                pass
        probe = {'keywords': t['keywords'], 'vec': t['vec'], 'kind': kind or (t['kinds'].most_common(1)[0][0] if t['kinds'] else None), 'say': t['say']}
        t['links'] = index_matches(probe, self.session, index_load())
        t['link'] = t['links'][0] if t['links'] else None

    def vectors(self):
        """each thread's meaning vector, for the card (kept out of the per-phrase snapshot, which stays small)"""
        return {tid: t['vec'] for tid, t in self.threads.items() if t.get('vec')}

    # ── judging ──
    def judge(self, t, now):
        """a thread's state, its stage in its form's arc, what it lacks and its natural next move"""
        kind = t['kinds'].most_common(1)[0][0] if t['kinds'] else None
        stages = arc(kind); reached = t['stages'].get(kind, {})
        ids = [s['id'] for s in stages]
        top = max([ids.index(s) for s in reached if s in ids], default=-1)
        nxt = next((s for s in stages[top + 1:] if s['id'] not in reached), None) or next((s for s in stages if s['id'] not in reached), None)
        landing = next((s for s in stages if s.get('landing')), None)
        closed = t['landing_n'] is not None and t['n'] - t['landing_n'] <= 1
        dormant_for = now - t['last_at']
        middle = any(s in reached for s in ids[1:-1]) if len(ids) > 2 else bool(reached)
        if closed:
            state = 'closed'
        elif dormant_for >= DORMANT_SECONDS or self.words - t['last_word'] >= DORMANT_WORDS:
            state = 'dormant'
        elif t['n'] >= 2 and (middle or t['words'] >= READY_WORDS) and (reached or t['words'] >= READY_WORDS):
            state = 'ready'
        elif t['returned_n'] is not None and t['n'] - t['returned_n'] <= 1:
            state = 'returned'
        elif t['n'] >= 2:
            state = 'developing'
        else:
            state = 'opened'
        need = None if state == 'closed' else (landing['need'] if state == 'ready' and landing else (nxt['need'] if nxt else None))
        move = None if state == 'closed' else (landing['move'] if state == 'ready' and landing else (nxt['move'] if nxt else None))
        return {'kind': kind, 'state': state, 'stage': ids[top] if top >= 0 else None, 'stages': [s for s in ids if s in reached],
                'need': need, 'next': move, 'dormant_for': round(dormant_for) if state == 'dormant' else 0}

    def lead_arc(self, kind, tid):
        """the lead kind's arc, read in the thread in play: each stage reached or not, where it stands, the next move"""
        stages = arc(kind)
        if not stages:
            return None
        t = self.threads.get(tid) or {}
        reached = (t.get('stages') or {}).get(kind, {})
        ids = [s['id'] for s in stages]
        top = max([ids.index(s) for s in reached if s in ids], default=-1)
        nxt = next((s for s in stages[top + 1:] if s['id'] not in reached), None)
        return {'kind': kind, 'thread': tid, 'current': ids[top] if top >= 0 else None,
                'stages': [{'id': s['id'], 'name': s['name'], 'reached': s['id'] in reached, 'at': reached.get(s['id']), 'landing': bool(s.get('landing'))} for s in stages],
                'next': {'id': nxt['id'], 'name': nxt['name'], 'move': nxt['move'], 'need': nxt['need']} if nxt else None}

    def hold(self, now):
        """the listener's hold: the absorption meter, its trend, what held it earlier, the pace, and a cue"""
        recent = [n for at, n in self.times if now - at <= RACE_SPAN]
        span = max(5.0, min(RACE_SPAN, now - min([at for at, _ in self.times if now - at <= RACE_SPAN], default=now)))
        wps = sum(recent) / span if recent else 0.0
        meters = [m for _, m in self.absorb]
        cur = sum(meters[-2:]) / len(meters[-2:]) if meters else 0.0
        best = max((sum(meters[i:i + 3]) / len(meters[i:i + 3]) for i in range(max(1, len(meters) - 2))), default=0.0) if meters else 0.0
        held = [self.held_names[k] for k, _ in self.held.most_common(3)]
        cue = None
        if wps >= RACE_WPS and len(self.times) >= 3:
            cue = {'type': 'pause', 'text': 'The words are coming fast. Let a pause land before the next line.'}
        elif len(meters) >= 4 and best > .2 and cur < DROP * best:
            cue = {'type': 'return', 'text': ('Earlier, ' + ' and '.join(n.lower() for n in held[:2]) + ' held the listener. Return to it.') if held else 'The hold is loosening. Slow down and give one concrete detail.',
                   'held': held[:2]}
        return {'meter': round(cur, 3), 'best': round(best, 3), 'wps': round(wps, 2), 'tempo': round(max(.5, min(2.0, wps / 2.2 if wps else .8)), 2),
                'trend': round(cur - (sum(meters[-5:-2]) / len(meters[-5:-2]) if len(meters) > 4 else cur), 3), 'held': held, 'cue': cue}

    def snapshot(self, now=None, lead=None, active=None):
        now = now or time.time()
        threads = []
        for tid in self.order[-16:]:
            t = self.threads[tid]
            threads.append({'id': tid, 'title': t['title'], **self.judge(t, now), 'opened_at': t['opened_at'], 'opened_by': t['opened_by'], 'last_at': t['last_at'],
                            'words': t['words'], 'n': t['n'], 'returns': t['returns'], 'speakers': dict(t['speakers']), 'first': t['first'],
                            'link': t['link'], 'links': t['links'], 'landing_at': t['landing_at'], 'marks': t['marks'], 'keywords': t['keywords'][:12],
                            'say': {k: t['say'][k] for k in t['keywords'][:12] if k in t['say']}})
        many = len([s for s, v in self.airtime.items() if v > 0]) > 1
        unpicked = [t['id'] for t in threads if many and t['state'] != 'closed' and set(t['speakers']) == {t['opened_by']} and t['id'] != active]
        talk = {'airtime': dict(self.airtime), 'turns': self.turns, 'speakers': sorted(self.airtime),
                'questions': [{k: q.get(k) for k in ('id', 'speaker', 'at', 'text', 'idea', 'answered_at', 'answered_by')} for q in self.questions[-24:]],
                'open': len([q for q in self.questions if not q.get('answered_at')]), 'unpicked': unpicked}
        hold = self.hold(now)
        snap = {'threads': threads, 'arc': self.lead_arc(lead, active) if lead else None, 'talk': talk, 'hold': hold, 'active': active}
        snap['next'] = next_move(snap)
        return snap

def need_rank(t):
    """the rail's order: ready to close, then dormant, then needs more, then just started, closed last"""
    return {'ready': 0, 'dormant': 1, 'developing': 2, 'returned': 2, 'opened': 3, 'closed': 4}.get(t.get('state'), 5)

def candidates(snap):
    """every next move the algorithm can see, best first: [{id, text, why, thread}]"""
    out = []
    hold = snap.get('hold') or {}
    if hold.get('cue'):
        out.append({'id': 'hold', 'text': hold['cue']['text'], 'why': 'the hold', 'thread': None})
    a = snap.get('arc') or {}
    if a.get('next'):
        out.append({'id': 'arc', 'text': a['next']['move'], 'why': f"the {a['kind']} {a['next']['need']}", 'thread': a.get('thread')})
    for t in sorted(snap.get('threads') or [], key=need_rank):
        if t['state'] in ('ready', 'dormant') and t.get('next'):
            out.append({'id': 't:' + t['id'], 'text': t['next'] if t['state'] == 'ready' else f'Return to "{t["title"]}". {t["next"]}', 'why': f'"{t["title"]}" {t["need"] or ""}'.strip(), 'thread': t['id']})
    talk = snap.get('talk') or {}
    open_q = [q for q in talk.get('questions', []) if not q.get('answered_at')]
    if len(talk.get('speakers', [])) > 1 and open_q:
        q = open_q[0]
        out.append({'id': 'q:' + q['id'], 'text': f'Answer the question {q["speaker"]} asked: "{q["text"]}"', 'why': 'a question waits', 'thread': q.get('idea')})
    for tid in talk.get('unpicked', [])[:1]:
        t = next((x for x in snap.get('threads', []) if x['id'] == tid), None)
        if t:
            out.append({'id': 'u:' + tid, 'text': f'Pick up what {t["opened_by"]} opened: "{t["title"]}".', 'why': 'a thread nobody else took up', 'thread': tid})
    seen, uniq = set(), []
    for c in out:
        if c['text'] not in seen:
            seen.add(c['text']); uniq.append(c)
    return uniq[:8]

def next_move(snap):
    c = candidates(snap)
    return c[0] if c else None

def suggestions(threads):
    """for each thread left open, the moves that could have continued or closed it (the arc's stages still to come)"""
    out = {}
    for t in threads or []:
        if t.get('state') == 'closed':
            continue
        stages = arc(t.get('kind'))
        reached = set(t.get('stages') or [])
        opts = {s['id']: s['move'] for s in stages if s['id'] not in reached}
        opts['rest'] = 'Let it rest: it was a passing thought.'
        opts['return'] = 'Pick it up again in a later recording.'
        out[t['id']] = opts
    return out
