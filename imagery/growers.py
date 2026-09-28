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
    'story': 'path', 'reading aloud': 'path', 'prose': 'path', 'character development': 'path',
    'scenery': 'land',
    'lore': 'hive', 'myth': 'hive',
    'cosmology': 'orrery',
    'mystery': 'rings', 'argument': 'rings',
    'instruction': 'stack', 'lecture': 'stack', 'lesson': 'stack',
    'reflective monologue': 'kelp', 'stream of consciousness': 'kelp', 'thinking aloud': 'kelp',
    'dialogue': 'tide',
    'song': 'waves', 'lyrics': 'waves', 'prosody': 'waves',   # prose and prosody remain only for older sessions
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
MAX = 1400

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
        # the ideas of the talk, in the order they arrived: each one adds structure to every image
        self.ideas = [{'id': t.get('id'), 'words': float(t.get('words', 0)), 'returns': int(t.get('returns', 0)), 'n': len(t.get('events', []))}
                      for t in self.state.get('topics', [])]
        self.active_idea = self.state.get('active_topic')

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
    """the image in front: the one Jev names or mixes most, or the kind of speech now"""
    d = direction or {}
    if d.get('register') in REGISTERS:
        return d['register']
    if isinstance(d.get('mix'), dict) and d['mix']:
        best = max(d['mix'], key=lambda r: d['mix'][r])
        if best in REGISTERS and d['mix'][best] > 0:
            return best
    return FORM_TO_REGISTER.get((state or {}).get('form'), 'kelp')

def order(state, direction):
    """every image the talk has grown so far, in the order it first appeared"""
    seen = []
    for ev in (state or {}).get('events', []):
        r = FORM_TO_REGISTER.get(ev.get('form'), 'kelp')
        if r not in seen:
            seen.append(r)
    for r in ((direction or {}).get('mix') or {}):
        if r in REGISTERS and r not in seen and (direction['mix'][r] or 0) > 0:
            seen.append(r)
    return seen

TILES = 4
def layout(state, direction):
    """where each image stands, so that no two overlap: the image in front takes the square,
    and the images the talk grew before it stand in a row of small tiles along the bottom,
    in the order they first appeared. Returns {register: (cx, cy, scale)}."""
    lead = active(state, direction)
    before = [r for r in order(state, direction) if r != lead][-TILES:]
    if not before:
        return {lead: (0.0, 0.0, 1.0)}
    place = {lead: (0.0, 0.2, 0.78)}
    n = len(before)
    for i, r in enumerate(before):
        place[r] = (-1 + (i + 0.5) * 2.0 / TILES + (TILES - n) / TILES, -0.8, 0.19)
    return place

def mix(state, direction):
    """how present each image is: the one in front whole, the earlier ones a little dimmer, the rest gone"""
    w = {r: 0.0 for r in REGISTERS}
    for r in layout(state, direction):
        w[r] = 1.0
    lead = active(state, direction)
    for r in w:
        if w[r] and r != lead:
            w[r] = 0.8
    return w

_at = {}
def _glide(register, target):
    """an image moves to its new place over about a second rather than jumping"""
    cur = _at.get(register)
    if cur is None:
        _at[register] = list(target)
        return target
    for j in range(3):
        cur[j] += (target[j] - cur[j]) * 0.07
    return tuple(cur)

def _emit(rows, x, y, z, s, rz, col, a):
    rows.append((x, y, z, s, rz, col[0], col[1], col[2], a))

def _born(i, n):
    """the newest instance swells from nothing, so the image is seen to grow"""
    return max(0.0, min(1.0, n - i))

# ── the ten growers ───────────────────────────────────────────────────────────────

def bloom(c, g):
    """poetry: a flower in a golden spiral, an outer ring and stamens; each new idea opens a smaller flower around it"""
    rows = []; turn = c.t * 0.03 * c.speed
    def flower(cx, cy, n, scale, bias, spin):
        for i in range(int(math.ceil(n))):
            a = i * 2.399963 + turn * spin; r = 0.052 * math.sqrt(i + 1) * scale
            if r > 0.62 * (1 if scale < 1 else 1.7) * scale:
                break
            k = i / max(n, 1); outer = i % 7 == 3
            _emit(rows, cx + r * math.cos(a), cy + r * math.sin(a), -k, (0.016 + 0.026 * (1 - k)) * scale * (1.6 if outer else 1) * _born(i, n) * (1 + 0.35 * c.e),
                  math.degrees(a) - 90, _mix(*PALETTE['bloom'], min(1, c.warm + 0.5 * k + bias)), (0.35 + 0.3 * k) if outer else (0.55 + 0.45 * k))
        for j in range(int(min(24, n / 6))):
            a = j * 2.4 + turn * 3; r = 0.02 * scale * math.sqrt(j + 1)
            _emit(rows, cx + r * math.cos(a), cy + r * math.sin(a), 0.05, 0.007 * scale, 0, (1, 0.9, 0.55), 0.9)
    ring = len(c.ideas) > 1
    flower(0, 0, min(MAX, 6 + g * 1.6 * c.density), 0.66 if ring else 1, 0, 1)
    for i, idea in enumerate(c.ideas[1:7]):
        a = i / min(6, len(c.ideas) - 1) * 6.2832 + 0.4
        flower(0.8 * math.cos(a), 0.8 * math.sin(a), min(160, 4 + idea['words'] * 1.4), 0.28 + min(0.12, idea['returns'] * 0.04), 0.2, -1)
    return rows

def path(c, g):
    """story: a winding trail toward the horizon; each new idea forks a path off it, returns light lanterns, footprints run along"""
    n = min(MAX, 10 + g * 2.2 * c.density); rows = []; trail = []
    for i in range(int(math.ceil(n))):
        far = 1 - math.exp(-i / 420.0 * 1.6); y = -0.95 + 1.55 * far
        x = (0.55 * math.sin(i * 0.045 + c.seed) + 0.2 * math.sin(i * 0.013 + 1.7)) * (1 - 0.8 * far)
        trail.append((x, y, far))
        s = 0.028 * (1 - 0.75 * far) * _born(i, n); lantern = i % 23 == 11
        if lantern:
            s *= 2.6 + 0.8 * math.sin(c.t * 2 + i)
        _emit(rows, x, y, -far, s, 0, _mix(*PALETTE['path'], min(1, c.warm + (0.6 if lantern else 0))), 1.0 if lantern else 0.7)
        if i % 5 == 2:
            for side in (-1, 1):
                _emit(rows, x + side * 0.035 * (1 - 0.8 * far), y + 0.004, -far, 0.006 * (1 - 0.7 * far), 0, _mix(*PALETTE['path'], c.warm * 0.5), 0.4)
    for i, idea in enumerate(c.ideas[1:9]):
        at = trail[min(len(trail) - 1, int(len(trail) * (0.15 + 0.75 * (i + 0.5) / max(len(c.ideas) - 1, 1))))] if trail else None
        if not at:
            continue
        side = 1 if i % 2 else -1; length = min(120, 8 + idea['words'] * 1.6)
        x, y, far = at
        ang = 0.25 + 0.2 * _h(i, 5) if side > 0 else math.pi - 0.25 - 0.2 * _h(i, 5)
        for k in range(int(length)):
            ang += side * 0.012; x += 0.016 * math.cos(ang) * (1 - 0.5 * far); y += 0.016 * math.sin(ang) * (1 - 0.5 * far)
            if abs(x) > 1.05 or y > 0.95:
                break
            lamp = idea['returns'] and k % max(8, int(length / (idea['returns'] + 1))) == 5
            _emit(rows, x, y, -far, (0.05 if lamp else 0.026) * (1 - 0.5 * far) * _born(k, length), 0,
                  _mix(*PALETTE['path'], min(1, c.warm + (0.7 if lamp else 0.45) + (0.2 if idea['id'] == c.active_idea else 0))), 0.95 if lamp else 0.7)
    return rows

def land(c, g):
    """scenery: ridgelines one behind another, a river winding down from the horizon, stars over the peaks"""
    per = 56; n = min(MAX, per * 2 + g * 3.0 * c.density); rows = []; lines = int(math.ceil(n / per))
    for j in range(lines):
        rise = _born(j * per, n) if j == lines - 1 else 1.0
        depth = j / max(lines, 1); base = 0.55 - 1.35 * (j / max(lines + 2, 6))
        for k in range(per):
            if j * per + k >= n:
                break
            x = -1.05 + 2.1 * k / (per - 1)
            ridge = math.sin(x * 3.1 + j * 1.7 + c.seed) * 0.5 + math.sin(x * 7.3 - j * 0.9) * 0.22 + math.sin(x * 13 + j) * 0.08
            _emit(rows, x, base + ridge * (0.16 + 0.1 * depth) * rise + 0.02 * math.sin(c.t * 0.4 + j), -1 + depth, 0.022 * (0.6 + 0.8 * depth), 0,
                  _mix(*PALETTE['land'], min(1, c.warm + 0.4 * depth)), 0.35 + 0.65 * depth)
    for i in range(int(min(220, g * 1.2))):
        u = i / 220.0; y = 0.5 - 1.45 * u; x = 0.25 * math.sin(u * 7 + c.seed) * (0.3 + u)
        _emit(rows, x, y, 0.1, 0.006 + 0.02 * u, 0, (0.55, 0.8, 1), 0.35 + 0.4 * u + 0.15 * math.sin(c.t * 2 - i * 0.2))
    for i in range(int(min(80, g * 0.5))):
        _emit(rows, _h(i, 21) * 2 - 1, 0.62 + _h(i, 22) * 0.38, -1, 0.004 + 0.006 * _h(i, 23), 0, (1, 1, 0.9), 0.3 + 0.5 * abs(math.sin(c.t * (0.5 + _h(i, 24)) + i)))
    return rows

def hive(c, g):
    """lore and myth: a comb laid ring by ring; each idea buds a small comb of its own, and the one in play glows"""
    rows = []; step = 0.105
    def comb(cx, cy, n, scale, lit):
        dirs = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]; cells = [(0, 0)]; ring = 1
        while len(cells) < n and ring < 14:
            q, r = -ring, ring
            for d in range(6):
                for _ in range(ring):
                    cells.append((q, r)); q += dirs[d][0]; r += dirs[d][1]
            ring += 1
        for i, (q, r) in enumerate(cells[:int(math.ceil(n))]):
            x = step * scale * (q + r / 2.0); y = step * scale * r * 0.8660254; dist = math.hypot(x, y) / scale
            honey = 0.25 + 0.2 * math.sin(c.t * 2 - dist * 8) if lit else 0
            _emit(rows, cx + x, cy + y, -dist * 0.3, step * scale * 0.43 * _born(i, n) * (1 + 0.12 * math.sin(c.t * 1.3 - dist * 6)), 30,
                  _mix(*PALETTE['hive'], min(1, c.warm + dist * 0.6 + honey)), min(1, 0.95 - 0.35 * min(1, dist) + honey))
    buds = len(c.ideas) > 1
    comb(0, 0, min(127 if buds else MAX, 7 + g * 1.2 * c.density), 0.72 if buds else 1, not c.ideas or c.ideas[0]['id'] == c.active_idea)
    for i, idea in enumerate(c.ideas[1:7]):
        a = i / 6.0 * 6.2832 + 0.5
        comb(0.86 * math.cos(a), 0.86 * math.sin(a), min(37, 1 + idea['words'] * 0.6), 0.45, idea['id'] == c.active_idea)
    return rows

def orrery(c, g):
    """cosmology: bodies join a sun; each idea is a planet with a moon for every return, tracing its orbit"""
    n = min(MAX, 1 + g * 0.9 * c.density); rows = []
    _emit(rows, 0, 0, 0, 0.09 * (1 + 0.3 * c.e), 0, _mix(*PALETTE['orrery'], 1.0), 1.0)
    for i in range(1, int(math.ceil(n))):
        orbit = 1 + int(math.sqrt(i * 1.3)); rad = 0.11 * orbit
        if rad > 1.0:
            rad = 0.2 + (rad % 0.8)
        a = _h(i) * 6.2832 + c.t * (0.9 / orbit ** 1.5) * c.speed; tilt = 0.55 + 0.25 * _h(i, 3)
        _emit(rows, rad * math.cos(a), rad * math.sin(a) * tilt, math.sin(a) * 0.3, (0.008 + 0.02 * _h(i, 2) ** 3) * _born(i, n), 0,
              _mix(*PALETTE['orrery'], _h(i, 5) * 0.7 + c.warm * 0.3), 0.7)
    for i, idea in enumerate(c.ideas[:7]):
        rad = 0.25 + 0.11 * i; a = i * 2.1 + c.t * 0.5 / (1 + i) ** 0.8 * c.speed; tilt = 0.6
        for k in range(60):
            q = k / 60.0 * 6.2832
            _emit(rows, rad * math.cos(q), rad * math.sin(q) * tilt, -0.2, 0.003, 0, _mix(*PALETTE['orrery'], 0.3), 0.25)
        px, py = rad * math.cos(a), rad * math.sin(a) * tilt; size = 0.025 + min(0.04, idea['words'] * 0.0008)
        _emit(rows, px, py, 0.1, size, 0, _mix(*PALETTE['orrery'], min(1, c.warm + 0.5 + (0.3 if idea['id'] == c.active_idea else 0))), 1.0)
        for m in range(min(6, idea['returns'] + (1 if idea['n'] > 3 else 0))):
            mq = c.t * (2 + m) + m * 2; d = size + 0.03 + m * 0.012
            _emit(rows, px + d * math.cos(mq), py + d * math.sin(mq), 0.2, 0.008, 0, (0.9, 0.95, 1), 0.9)
    return rows

def rings(c, g):
    """mystery and argument: ripples close in on a point; each idea is a centre of its own, and the ripples cross"""
    rows = []; centres = c.ideas[:5] or [{'id': None}]
    radius = float((c.state or {}).get('radius', 0.85)); point = c.t - float((c.state or {}).get('conclusion_at', 0)) < 7
    per = 48; total = min(MAX, per + g * 2.4 * c.density); each = total / len(centres)
    for ci, idea in enumerate(centres):
        cx = 0.55 * math.cos(ci * 2.4) if ci else 0; cy = 0.55 * math.sin(ci * 2.4) if ci else 0; count = int(math.ceil(each / per))
        for j in range(count):
            phase = (c.t * 0.12 * c.speed + j / count + ci * 0.21) % 1.0; r = (1 - phase) * (0.25 + 0.8 * radius) * (0.6 if ci else 1)
            for k in range(per):
                a = k / per * 6.2832 + j * 0.3
                _emit(rows, cx + r * math.cos(a), cy + r * math.sin(a), -phase, 0.01 + 0.01 * (1 - phase), 0,
                      _mix(*PALETTE['rings'], min(1, c.warm + (1 - phase) * 0.3 + (0.3 if idea['id'] == c.active_idea else 0))), phase * (0.6 if ci else 0.9))
    blink = (0.5 + 0.5 * math.sin(c.t * 9)) if point else 0.25
    _emit(rows, 0, 0, 0.1, 0.05 + 0.05 * blink, 0, _mix(*PALETTE['rings'], 1), blink)
    return rows

def stack(c, g):
    """instruction: a cairn of uneven towers, with arched bridges laid between neighbours as they rise"""
    n = min(MAX, 3 + g * 0.8 * c.density); rows = []; cols = 7; tops = [-0.92] * cols; w = 1.8 / cols
    col_x = lambda k: -0.9 + w * (k + 0.5)
    for i in range(int(math.ceil(n))):
        k = min(cols - 1, int(abs(_h(i, 7) + _h(i, 9) - 1) * cols * 0.999))
        k = (cols // 2 + (k if i % 2 else -k)) % cols
        hgt = w * (0.28 + 0.3 * _h(i, 4)); y = tops[k] + hgt * 0.5; tops[k] += hgt * 1.05
        if y > 0.95:
            continue
        _emit(rows, col_x(k) + (_h(i, 11) - 0.5) * w * 0.22, y, 0, w * 0.2 * (0.8 + 0.4 * _h(i, 13)) * _born(i, n), (_h(i, 17) - 0.5) * 8,
              _mix(*PALETTE['stack'], min(1, c.warm + (y + 1) * 0.3)), 0.8)
    for k in range(cols - 1):
        top = min(tops[k], tops[k + 1], 0.9); x0, x1 = col_x(k), col_x(k + 1); y = -0.6 + (k % 2) * 0.18
        while y <= top - 0.04:                     # a bridge at every level both towers reach
            for j in range(11):
                u = j / 10.0
                _emit(rows, x0 + (x1 - x0) * u, y + 0.06 * math.sin(u * math.pi), 0.05, w * 0.07, (u - 0.5) * 40, _mix(*PALETTE['stack'], min(1, c.warm + 0.5)), 0.75)
            y += 0.36
    return rows

def kelp(c, g):
    """reflection: one still kelp; a branch per idea, a fork for every return, a bud for every phrase, bubbles rising"""
    topics = c.ideas; rows = []
    total = sum(t['words'] for t in topics) or g
    steps = int(min(1.85, 0.25 + total * 0.006 * c.density) / 0.014); raw = []; x, y = 0.0, -0.98
    for k in range(steps):
        ang = math.pi / 2 + 0.18 * math.sin(k * 0.021 + c.seed); x += 0.014 * math.cos(ang); y += 0.014 * math.sin(ang); raw.append((x, y, ang))
    if not raw:
        return rows
    mid = (min(p[0] for p in raw) + max(p[0] for p in raw)) / 2
    pts = [(px - mid, py, a) for px, py, a in raw]
    cs = _mix(*PALETTE['kelp'], min(1, c.warm * 0.6))
    for k, (px, py, a) in enumerate(pts):
        _emit(rows, px, py, 0, 0.024 * (1 - 0.55 * k / steps), math.degrees(a) - 90, cs, 0.9)
    def branch(sx, sy, ang, side, length, col, depth):
        px, py = sx, sy; along = []
        for k in range(int(math.ceil(length))):
            ang += side * 0.018 * (1 if k > length * 0.3 else -0.2); px += 0.011 * math.cos(ang); py += 0.011 * math.sin(ang)
            _emit(rows, px, py, 0.01, (0.015 - depth * 0.004) * (1 - 0.6 * k / length) * _born(k, length), math.degrees(ang) - 90, col, 0.85 - depth * 0.15)
            along.append((px, py, ang))
        return along
    for i, tp in enumerate(topics[:18]):
        bx, by, bang = pts[min(len(pts) - 1, int(len(pts) * (0.12 + 0.8 * (i + 0.5) / max(len(topics), 1))))]
        side = 1 if i % 2 == 0 else -1; length = min(90, 6 + tp['words'] * 0.9 * c.density)
        col = _mix(*PALETTE['kelp'], min(1, c.warm + 0.25 + (0.35 if tp['id'] == c.active_idea else 0)))
        along = branch(bx, by, bang - side * (0.95 + 0.25 * _h(i, 3)), side, length, col, 0)
        for r in range(min(5, tp['returns'])):
            at = along[int(len(along) * (0.35 + 0.5 * (r + 0.5) / max(tp['returns'], 1)))] if along else None
            if at:
                branch(at[0], at[1], at[2] + side * 0.8, -side, length * 0.45, _mix(*PALETTE['kelp'], min(1, c.warm + 0.45)), 1)
        buds = min(12, tp['n'] or 1)
        for b in range(buds):
            at = along[int(len(along) * (b + 0.5) / buds)] if along else None
            if at:
                _emit(rows, at[0] + side * 0.012, at[1] + 0.01, 0.02, 0.008, 0, (1, 0.95, 0.6), 0.8)
        if len(rows) >= MAX:
            return rows
    for i in range(int(min(40, total * 0.2))):
        u = (c.t * 0.05 * (0.5 + _h(i, 31)) + _h(i, 32)) % 1.0
        _emit(rows, (_h(i, 33) - 0.5) * 1.2 + 0.03 * math.sin(c.t + i), -1 + 2 * u, 0.05, 0.006 + 0.006 * _h(i, 34), 0, (0.8, 1, 0.95), 0.35 * (1 - u))
    return rows

def tide(c, g):
    """dialogue: two tides meeting where the speakers' share of the talk balances, foam gathering at the line"""
    words = (c.state or {}).get('dialogue_words') or (c.state or {}).get('speaker_words') or {'A': 1, 'B': 1}
    a, b = float(words.get('A', 1)), float(words.get('B', 1)); front = (a / max(a + b, 1) - 0.5) * 1.2
    n = min(MAX, 80 + g * 2.0 * c.density); rows = []; per = 40; lines = int(math.ceil(n / per))
    for j in range(lines):
        side = -1 if j % 2 == 0 else 1; y = -0.9 + 1.8 * (j // 2 + 0.5) / max(1, (lines + 1) // 2)
        for k in range(per):
            if j * per + k >= n:
                break
            f = k / (per - 1); reach = (front + 1) if side < 0 else (1 - front)
            _emit(rows, side * (1.02 - f * reach), y + 0.05 * math.sin(f * 7 + c.t * 1.2 * c.speed + j), 0, 0.014 * (0.4 + f), 0,
                  _mix(*PALETTE['tide'], 0.15 if side < 0 else 0.9), 0.3 + 0.7 * f)
    for i in range(int(min(160, g * 1.2))):
        _emit(rows, front + (_h(i, 42) - 0.5) * 0.12 + 0.03 * math.sin(c.t * 3 + i), -0.95 + 1.9 * _h(i, 41), 0.05, 0.005 + 0.006 * _h(i, 43), 0,
              (0.95, 0.98, 1), 0.4 + 0.4 * abs(math.sin(c.t * 2 + i)))
    return rows

def waves(c, g):
    """song: ribbons swelling with the voice; each idea adds a ribbon with a rhythm of its own"""
    n = min(MAX, 100 + g * 3.0 * c.density); rows = []; per = 90; base_lines = int(math.ceil(n / per))
    lines = base_lines + min(4, max(0, len(c.ideas) - 1))
    for j in range(lines):
        base = -0.75 + 1.5 * (j + 0.5) / max(lines, 1); own = j >= base_lines
        for k in range(per):
            if not own and j * per + k >= n:
                break
            x = -1.05 + 2.1 * k / (per - 1); amp = (0.08 + 0.18 * c.e) * (1 + 0.4 * math.sin(j)) * (0.7 if own else 1)
            f = 2 + j * 1.3 if own else 3 + j * 0.7
            y = base + amp * math.sin(x * f + c.t * (1.4 + j * 0.2) * c.speed) + (0.03 * math.sin(x * f * 3 + c.t * 4) if own else 0)
            _emit(rows, x, y, -j * 0.05, 0.011 if own else 0.016, 0, _mix(*PALETTE['waves'], min(1, c.warm + j * 0.08 + (0.3 if own else 0))), 0.6 if own else 0.8)
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
    # a register arriving swells out of its place; one leaving sinks back and dims
    ease = weight * weight * (3 - 2 * weight)
    cx, cy, sc = _glide(register, layout(state, direction).get(register, _at.get(register, (0.0, 0.0, 1.0))))
    k = sc * (0.6 + 0.4 * ease)
    rows = [(cx + r[0] * k, cy + r[1] * k, r[2], r[3] * sc * ease, r[4], r[5], r[6], r[7], r[8] * ease) for r in rows]
    names = ['tx', 'ty', 'tz', 's', 'rz', 'cr', 'cg', 'cb', 'ca']
    for j, nm in enumerate(names):
        ch = scriptOp.appendChan(nm)
        ch.vals = [r[j] for r in rows]
