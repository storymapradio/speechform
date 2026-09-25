"""The loom's growers: where every instance of every register stands, frame by frame.

Each register is an image that GROWS with the words spoken in it. A grower is given
how much has been said in its register (g, in words, plus whatever Jev adds), the
clock, the voice's energy, and Jev's direction, and it returns the instances of that
image: position, size, turn and colour. The drawing itself is native TouchDesigner:
instanced geometry, materials, one render, a feedback canvas that keeps what grew.

Coordinates are a square from -1 to 1, because the loom lives in the top box of a phone.
"""
import math, re

REGISTERS = ['bloom', 'path', 'land', 'hive', 'orrery', 'rings', 'stack', 'kelp', 'tide', 'waves']
FORM_TO_REGISTER = {
    'poetry': 'bloom',
    'story': 'path', 'prose': 'path', 'character development': 'path',
    'scenery': 'land',
    'lore': 'hive', 'myth': 'hive',
    'cosmology': 'orrery',
    'mystery': 'rings', 'argument': 'rings',
    'instruction': 'stack', 'lecture': 'stack', 'lesson': 'stack',
    'reflective monologue': 'kelp', 'stream of consciousness': 'kelp', 'thinking aloud': 'kelp',
    'dialogue': 'tide',
    'song': 'waves', 'lyrics': 'waves', 'prosody': 'waves',
}
# each register's own light: (r, g, b) at warmth 0 and at warmth 1
PALETTE = {
    'bloom':  ((0.62, 0.52, 1.00), (1.00, 0.46, 0.62)),
    'path':   ((0.55, 0.80, 1.00), (1.00, 0.72, 0.30)),
    'land':   ((0.40, 0.75, 0.85), (0.95, 0.62, 0.36)),
    'hive':   ((0.45, 1.00, 0.55), (1.00, 0.85, 0.30)),
    'orrery': ((0.60, 0.72, 1.00), (1.00, 0.80, 0.55)),
    'rings':  ((0.35, 0.95, 0.95), (1.00, 0.45, 0.35)),
    'stack':  ((0.50, 0.95, 0.70), (1.00, 0.78, 0.40)),
    'kelp':   ((0.35, 0.95, 0.70), (0.85, 0.95, 0.40)),
    'tide':   ((0.45, 0.70, 1.00), (1.00, 0.55, 0.45)),
    'waves':  ((0.70, 0.60, 1.00), (1.00, 0.60, 0.85)),
}
MAX = 900

def _words(t):
    return len(re.findall(r"[\w']+", t or ''))

def _h(i, k=0):
    """a steady pseudo-random number for instance i"""
    x = math.sin(i * 12.9898 + k * 78.233) * 43758.5453
    return x - math.floor(x)

def _mix(a, b, w):
    return tuple(a[j] + (b[j] - a[j]) * w for j in range(3))

class Ctx:
    def __init__(self, state, direction, now, energy):
        self.state = state or {}
        self.d = direction or {}
        self.t = now
        self.e = max(0.0, min(1.0, energy))
        self.warm = float(self.d.get('warmth', 0.35))
        self.seed = float(self.d.get('seed', 0))
        self.density = float(self.d.get('density', 1.0))
        self.speed = float(self.d.get('tempo', 1.0))

def growth(state, direction):
    """words spoken in each register, plus Jev's own additions"""
    g = {r: 0.0 for r in REGISTERS}
    for ev in (state or {}).get('events', []):
        r = FORM_TO_REGISTER.get(ev.get('form'), 'kelp')
        g[r] += _words(ev.get('text'))
    for r, v in ((direction or {}).get('grow') or {}).items():
        if r in g:
            g[r] += float(v)
    return g

def active(state, direction):
    """the one register most strongly heard (for the omega gate)"""
    m = mix(state, direction)
    return max(m, key=m.get)

def mix(state, direction):
    """how strongly each register is heard right now, 0..1. Several can stand at once:
    the classifier's near-tied speech forms each raise their own image, and Jev can set
    the mix outright ({"mix": {"path": 0.7, "land": 0.5}}) or name one register."""
    w = {r: 0.0 for r in REGISTERS}
    d = direction or {}
    if isinstance(d.get('mix'), dict) and d['mix']:
        for r, v in d['mix'].items():
            if r in w:
                w[r] = max(0.0, min(1.0, float(v)))
    else:
        scores = (state or {}).get('scores') or []
        if scores:
            top = scores[0].get('similarity', 0)
            for sc in scores:
                r = FORM_TO_REGISTER.get(sc.get('form'))
                if r:
                    # within 0.12 of the strongest form, a register shares the square
                    w[r] = max(w[r], max(0.0, min(1.0, 1 - (top - sc.get('similarity', 0)) / 0.12)))
        cur = FORM_TO_REGISTER.get((state or {}).get('form'), 'kelp')
        w[cur] = 1.0
    if d.get('register') in w:
        w[d['register']] = 1.0
    if not any(w.values()):
        w['kelp'] = 1.0
    return w

def _emit(rows, x, y, z, s, rz, col, a):
    rows.append((x, y, z, s, rz, col[0], col[1], col[2], a))

def _born(i, n):
    """the newest instance swells from nothing, so the image is seen to grow"""
    return max(0.0, min(1.0, n - i))

# ── the ten growers ───────────────────────────────────────────────────────────────

def bloom(c, g):
    n = min(MAX, 6 + g * 1.6 * c.density)
    rows = []
    turn = c.t * 0.03 * c.speed
    for i in range(int(math.ceil(n))):
        a = i * 2.399963 + turn
        r = 0.052 * math.sqrt(i + 1)
        if r > 1.05:
            break
        k = i / max(n, 1)
        col = _mix(*PALETTE['bloom'], min(1, c.warm + 0.5 * k))
        s = (0.016 + 0.026 * (1 - k)) * _born(i, n) * (1 + 0.35 * c.e)
        _emit(rows, r * math.cos(a), r * math.sin(a), -k, s, math.degrees(a) - 90, col, 0.55 + 0.45 * k)
    return rows

def path(c, g):
    n = min(MAX, 10 + g * 2.2 * c.density)
    rows = []
    # the trail climbs from the near edge toward the far horizon, winding as it goes
    for i in range(int(math.ceil(n))):
        u = i / 420.0
        far = 1 - math.exp(-u * 1.6)
        y = -0.95 + 1.55 * far
        x = (0.55 * math.sin(i * 0.045 + c.seed) + 0.2 * math.sin(i * 0.013 + 1.7)) * (1 - 0.8 * far)
        s = 0.028 * (1 - 0.75 * far) * _born(i, n)
        lantern = (i % 23 == 11)
        col = _mix(*PALETTE['path'], min(1, c.warm + (0.6 if lantern else 0)))
        if lantern:
            s *= 2.6 + 0.8 * math.sin(c.t * 2 + i)
        _emit(rows, x, y, -far, s, 0, col, 1.0 if lantern else 0.7)
    return rows

def land(c, g):
    per = 56
    n = min(MAX, per * 2 + g * 3.0 * c.density)
    rows = []
    lines = int(math.ceil(n / per))
    for j in range(lines):
        rise = _born(j * per, n / 1.0) if j == lines - 1 else 1.0
        depth = j / max(lines, 1)
        base = 0.55 - 1.35 * (j / max(lines + 2, 6))
        for k in range(per):
            i = j * per + k
            if i >= n:
                break
            x = -1.05 + 2.1 * k / (per - 1)
            ridge = (math.sin(x * 3.1 + j * 1.7 + c.seed) * 0.5 + math.sin(x * 7.3 - j * 0.9) * 0.22 + math.sin(x * 13 + j) * 0.08)
            y = base + ridge * (0.16 + 0.1 * depth) * rise + 0.02 * math.sin(c.t * 0.4 + j)
            col = _mix(*PALETTE['land'], min(1, c.warm + 0.4 * depth))
            _emit(rows, x, y, -1 + depth, 0.022 * (0.6 + 0.8 * depth), 0, col, 0.35 + 0.65 * depth)
    return rows

def hive(c, g):
    n = min(MAX, 7 + g * 1.2 * c.density)
    rows = []
    step = 0.105
    dirs = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
    cells = [(0, 0)]
    ring = 1
    while len(cells) < n and ring < 14:
        q, r = -ring, ring
        for d in range(6):
            for _ in range(ring):
                cells.append((q, r))
                q += dirs[d][0]; r += dirs[d][1]
        ring += 1
    for i, (q, r) in enumerate(cells[:int(math.ceil(n))]):
        x = step * (q + r / 2.0) * 1.0
        y = step * r * 0.8660254
        dist = math.sqrt(x * x + y * y)
        col = _mix(*PALETTE['hive'], min(1, c.warm + dist * 0.6))
        s = step * 0.43 * _born(i, n) * (1 + 0.12 * math.sin(c.t * 1.3 - dist * 6))
        _emit(rows, x, y, -dist * 0.3, s, 30, col, 0.95 - 0.35 * min(1, dist))
    return rows

def orrery(c, g):
    n = min(MAX, 1 + g * 0.9 * c.density)
    rows = []
    _emit(rows, 0, 0, 0, 0.09 * (1 + 0.3 * c.e), 0, _mix(*PALETTE['orrery'], 1.0), 1.0)
    for i in range(1, int(math.ceil(n))):
        orbit = 1 + int(math.sqrt(i * 1.3))
        rad = 0.11 * orbit
        if rad > 1.0:
            rad = 0.2 + (rad % 0.8)
        spd = 0.9 / (orbit ** 1.5) * c.speed
        a = _h(i) * 6.2832 + c.t * spd
        tilt = 0.55 + 0.25 * _h(i, 3)
        col = _mix(*PALETTE['orrery'], _h(i, 5) * 0.7 + c.warm * 0.3)
        s = (0.012 + 0.03 * _h(i, 2) ** 3) * _born(i, n)
        _emit(rows, rad * math.cos(a), rad * math.sin(a) * tilt, math.sin(a) * 0.3, s, 0, col, 0.9)
    return rows

def rings(c, g):
    per = 64
    n = min(MAX, per + g * 2.4 * c.density)
    rows = []
    radius = float((c.state or {}).get('radius', 0.85))
    point = c.t - float((c.state or {}).get('conclusion_at', 0)) < 7
    count = int(math.ceil(n / per))
    for j in range(count):
        # each ring closes in on the point the speech is heading for
        phase = (c.t * 0.12 * c.speed + j / count) % 1.0
        r = (1 - phase) * (0.25 + 0.8 * radius)
        for k in range(per):
            i = j * per + k
            if i >= n:
                break
            a = k / per * 6.2832 + j * 0.3
            col = _mix(*PALETTE['rings'], min(1, c.warm + (1 - phase) * 0.3))
            _emit(rows, r * math.cos(a), r * math.sin(a), -phase, 0.012 + 0.01 * (1 - phase), 0, col, phase * 0.9)
    blink = (0.5 + 0.5 * math.sin(c.t * 9)) if point else 0.25
    _emit(rows, 0, 0, 0.1, 0.05 + 0.05 * blink, 0, _mix(*PALETTE['rings'], 1), blink)
    return rows

def stack(c, g):
    """instruction lays stone on stone: towers of uneven blocks, each step a stone"""
    n = min(MAX, 3 + g * 0.8 * c.density)
    rows = []
    cols = 7
    tops = [-0.92] * cols
    w = 1.8 / cols
    for i in range(int(math.ceil(n))):
        # the middle towers take more stones, so the cairn rises toward the centre
        k = min(cols - 1, int(abs(_h(i, 7) + _h(i, 9) - 1) * cols * 0.999))
        k = (cols // 2 + (k if i % 2 else -k)) % cols
        hgt = w * (0.28 + 0.3 * _h(i, 4))
        y = tops[k] + hgt * 0.5
        tops[k] += hgt * 1.05
        if y > 0.95:
            continue
        x = -0.9 + w * (k + 0.5) + (_h(i, 11) - 0.5) * w * 0.22
        col = _mix(*PALETTE['stack'], min(1, c.warm + (y + 1) * 0.3))
        _emit(rows, x, y, 0, w * 0.2 * (0.8 + 0.4 * _h(i, 13)) * _born(i, n), (_h(i, 17) - 0.5) * 8, col, 0.8)
    return rows

def kelp(c, g):
    """one kelp, standing still. Its stalk rises with everything said in reflection;
    every idea is a branch off it, placed where the idea first arrived, and each time
    the speaker returns to an idea, that branch grows longer and puts out a new frond."""
    topics = list((c.state or {}).get('topics', []))
    rows = []
    total_words = sum(float(t.get('words', 0)) for t in topics) or g
    stalk_len = min(1.85, 0.25 + total_words * 0.006 * c.density)
    col_stalk = _mix(*PALETTE['kelp'], min(1, c.warm * 0.6))
    # the stalk: a gentle fixed curve up the middle
    pts = []
    steps = int(stalk_len / 0.014)
    x, y, ang = 0.0, -0.98, math.pi / 2
    raw = []
    for k in range(steps):
        ang = math.pi / 2 + 0.18 * math.sin(k * 0.021 + c.seed)
        x += 0.014 * math.cos(ang); y += 0.014 * math.sin(ang)
        raw.append((x, y, ang))
    # the stalk stands in the middle of the square, however it curves
    mid = (min(p[0] for p in raw) + max(p[0] for p in raw)) / 2 if raw else 0
    for k, (x, y, ang) in enumerate(raw):
        pts.append((x - mid, y, ang))
        x -= mid
        f = k / max(steps, 1)
        _emit(rows, x, y, 0, 0.024 * (1 - 0.55 * f), math.degrees(ang) - 90, col_stalk, 0.9)
    if not pts:
        return rows
    # the branches: one per idea, alternating sides, in the order the ideas arrived
    for i, tp in enumerate(topics[:18]):
        at = min(len(pts) - 1, int(len(pts) * (0.12 + 0.8 * (i + 0.5) / max(len(topics), 1))))
        bx, by, bang = pts[at]
        side = 1 if i % 2 == 0 else -1
        words = float(tp.get('words', 0))
        returns = int(tp.get('returns', 0))
        length = min(90, 6 + words * 0.9 * c.density)
        is_active = tp.get('id') == (c.state or {}).get('active_topic')
        col = _mix(*PALETTE['kelp'], min(1, c.warm + 0.25 + (0.35 if is_active else 0)))
        ang = bang - side * (0.95 + 0.25 * _h(i, 3))
        x, y = bx, by
        for k in range(int(math.ceil(length))):
            # the branch leans out, then lifts toward the light
            ang += side * 0.018 * (1 if k > length * 0.3 else -0.2)
            x += 0.011 * math.cos(ang); y += 0.011 * math.sin(ang)
            f = k / max(length, 1)
            _emit(rows, x, y, 0.01, 0.015 * (1 - 0.6 * f) * _born(k, length), math.degrees(ang) - 90, col, 0.85)
            # fronds: a new one for every return to the idea, spaced along the branch
            if returns and k > 4 and k % max(5, int(length / (returns + 1))) == 0:
                for j in range(5):
                    fa = ang + side * 0.9
                    _emit(rows, x + 0.012 * j * math.cos(fa), y + 0.012 * j * math.sin(fa), 0.02, 0.011 * (1 - j / 6), math.degrees(fa) - 90, col, 0.7)
            if len(rows) >= MAX:
                return rows
    return rows

def tide(c, g):
    words = (c.state or {}).get('dialogue_words') or (c.state or {}).get('speaker_words') or {'A': 1, 'B': 1}
    a, b = float(words.get('A', 1)), float(words.get('B', 1))
    share = a / max(a + b, 1)
    front = (share - 0.5) * 1.2          # where the two tides meet
    n = min(MAX, 80 + g * 2.0 * c.density)
    rows = []
    per = 40
    lines = int(math.ceil(n / per))
    for j in range(lines):
        side = -1 if j % 2 == 0 else 1
        y = -0.9 + 1.8 * (j // 2 + 0.5) / max(1, (lines + 1) // 2)
        for k in range(per):
            i = j * per + k
            if i >= n:
                break
            f = k / (per - 1)
            reach = (front + 1) if side < 0 else (1 - front)
            x = side * (1.02 - f * reach)
            yy = y + 0.05 * math.sin(f * 7 + c.t * 1.2 * c.speed + j)
            col = _mix(*PALETTE['tide'], 0.15 if side < 0 else 0.9)
            _emit(rows, x, yy, 0, 0.014 * (0.4 + f), 0, col, 0.3 + 0.7 * f)
    return rows

def waves(c, g):
    n = min(MAX, 100 + g * 3.0 * c.density)
    rows = []
    per = 90
    lines = int(math.ceil(n / per))
    for j in range(lines):
        base = -0.7 + 1.4 * (j + 0.5) / max(lines, 1)
        for k in range(per):
            i = j * per + k
            if i >= n:
                break
            x = -1.05 + 2.1 * k / (per - 1)
            amp = (0.08 + 0.18 * c.e) * (1 + 0.4 * math.sin(j))
            y = base + amp * math.sin(x * (3 + j * 0.7) + c.t * (1.4 + j * 0.2) * c.speed)
            col = _mix(*PALETTE['waves'], min(1, c.warm + j * 0.08))
            _emit(rows, x, y, -j * 0.05, 0.016, 0, col, 0.8)
    return rows

GROWERS = {r: globals()[r] for r in REGISTERS}

def fill(scriptOp, register, weight=1.0):
    """a Script CHOP's cook: one sample per instance of this register's image.
    weight is how far this register stands in front (the crossfade between registers)."""
    import td_runtime
    if weight < 0.004:
        scriptOp.clear(); scriptOp.numSamples = 1
        for nm in ['tx', 'ty', 'tz', 's', 'rz', 'cr', 'cg', 'cb', 'ca']:
            scriptOp.appendChan(nm).vals = [0.0]
        return
    state = td_runtime.STATE
    direction = getattr(td_runtime, 'DIRECTION', {})
    c = Ctx(state, direction, td_runtime.time.time() % 100000, getattr(td_runtime, 'level', 0.0) * 12)
    g = growth(state, direction).get(register, 0.0)
    rows = GROWERS[register](c, g) or [(0, 0, 0, 0, 0, 0, 0, 0, 0)]
    scriptOp.clear()
    scriptOp.numSamples = len(rows)
    # a register arriving swells out of the middle; one leaving sinks back and dims
    ease = weight * weight * (3 - 2 * weight)
    rows = [(r[0] * (0.6 + 0.4 * ease), r[1] * (0.6 + 0.4 * ease), r[2], r[3] * ease, r[4], r[5], r[6], r[7], r[8] * ease) for r in rows]
    names = ['tx', 'ty', 'tz', 's', 'rz', 'cr', 'cg', 'cb', 'ca']
    for j, nm in enumerate(names):
        ch = scriptOp.appendChan(nm)
        ch.vals = [r[j] for r in rows]
