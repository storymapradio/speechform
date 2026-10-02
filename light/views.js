/* Speechform: the classifier, seen five more ways.
 *
 * Both classifiers (the full engine and Light's algorithm) hand this module the same trace:
 *   phrases: [{ id, text, kind, ranked: [[kind, score]], own: {kind: score}, weights: [{id, text, w}],
 *               parts: {kind: [{label, add, type}]}, signals: {name: 0..1}, idea }]
 *   ideas:   [{ id, title, words, returns, n }]
 *   active:  the idea in play;  focus: the phrase being looked at;  color(kind): its colour
 *
 * river   every kind's standing phrase by phrase, and the moments the choice moved
 * window  the minute a phrase was heard with, and how much each earlier phrase counted
 * build   how the leading kinds' points were built, part by part
 * shape   how the phrase is built, as a radar, with the phrases before it fading behind
 * ideas   the ideas as hexagons, every phrase tied to its idea, and the returns
 */
(function (root) {
  'use strict';
  const ICON = {
    transcript: '<path d="M5 6h14M5 10.5h14M5 15h14M5 19.5h8"/>',
    now: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="5.5" r="2"/><circle cx="12" cy="18.5" r="2"/><circle cx="19" cy="12" r="2"/><path d="M6.6 10.6l3.8-3.6M6.6 13.4l3.8 3.6M13.6 7l3.8 3.6M13.6 17l3.8-3.6"/>',
    bars: '<path d="M4 6h13M4 10.5h9M4 15h15M4 19.5h6"/>',
    river: '<path d="M3 8c4-3 6 3 9 0s5-3 9 0M3 13c4-3 6 3 9 0s5-3 9 0M3 18c4-3 6 3 9 0s5-3 9 0"/>',
    window: '<path d="M5 19V9M9.5 19v-7M14 19v-4M18.5 19v-2"/><path d="M3 20h18"/>',
    build: '<rect x="4" y="5" width="7" height="4" rx="1"/><rect x="11" y="10" width="5" height="4" rx="1"/><rect x="16" y="15" width="4" height="4" rx="1"/>',
    shape: '<path d="M12 3.5l7.4 4.3v8.4L12 20.5l-7.4-4.3V7.8z"/><path d="M12 8l3.5 2.5-1 4.5h-5l-1.5-4z"/>',
    ideas: '<path d="M7 5.5l2.6 1.5v3L7 11.5 4.4 10V7zM17 5.5l2.6 1.5v3L17 11.5 14.4 10V7zM12 13l2.6 1.5v3L12 19l-2.6-1.5v-3z"/><path d="M9 10l1.5 3.3M15 10l-1.5 3.3"/>',
    all: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    memory: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
    cards: '<rect x="5" y="3.5" width="11" height="15" rx="2"/><path d="M8.5 21h9a2 2 0 0 0 2-2V7"/>',
    depth: '<path d="M12 3.5L20 18H4z"/><path d="M12 9.5l3.2 5.7H8.8z"/>',
    lenses: '<path d="M12 3.5l8 14.5H4z"/><circle cx="12" cy="3.5" r="1.4"/><circle cx="20" cy="18" r="1.4"/><circle cx="4" cy="18" r="1.4"/>',
    arc: '<path d="M3.5 17c3-9 14-9 17 0"/><circle cx="5" cy="14" r="1.6"/><circle cx="12" cy="9.3" r="1.6"/><circle cx="19" cy="14" r="1.6"/>',
    threads: '<path d="M3 7c5 0 7 3 18 3M3 12h11M3 17c6 0 8-2 13-2"/><circle cx="16.5" cy="12" r="1.8"/><circle cx="18" cy="15" r="1.4"/>',
    pulse: '<path d="M2.5 12h4l2-5 3 10 3-12 2.5 7h4.5"/>',
    airtime: '<path d="M12 5v14M4 9.5l16-3M8 20h8"/><circle cx="5" cy="13" r="2.6"/><circle cx="19" cy="10" r="2"/>',
    questions: '<path d="M8.5 9a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3"/><circle cx="12" cy="18.5" r=".9"/>',
    links: '<path d="M2.5 6c7 0 8 6 13 6M2.5 18c7 0 8-6 13-6"/><circle cx="18" cy="12" r="2.6"/>',
    library: '<path d="M4 19.5V6.5M8.5 19.5V4.5M13 19.5v-11l4.5-1.5 3 12.5-4.4 1z"/><path d="M3 20.5h18"/>',
    room: '<circle cx="12" cy="8" r="3"/><circle cx="5" cy="10.5" r="2.2"/><circle cx="19" cy="10.5" r="2.2"/><path d="M6.5 19.5c.6-3.5 2.8-5.5 5.5-5.5s4.9 2 5.5 5.5M1.8 17.5c.4-2 1.6-3.3 3.2-3.5M22.2 17.5c-.4-2-1.6-3.3-3.2-3.5"/>',
    steerall: '<rect x="3.5" y="3.5" width="7" height="7" rx="3.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="3.5"/>',
  };
  /* the speakers, by letter, the same colours everywhere they appear */
  const SPEAKER = { A: '#5af0f0', B: '#ff9ae0', C: '#ffc25a' };
  const STATE = { opened: '#b9c9b5', developing: null, returned: '#ffc94a', ready: '#ffc94a', dormant: '#41503f', closed: '#39ff14' };
  const STATE_WORD = { opened: 'just started', developing: 'needs more', returned: 'returned to', ready: 'ready to close', dormant: 'dormant', closed: 'closed' };
  const VIEWS = [
    ['now', '<path d="M5 6h14M5 10.5h14M5 15h9"/>'],
    ['river', '<path d="M3 8c4-3 6 3 9 0s5-3 9 0M3 13c4-3 6 3 9 0s5-3 9 0M3 18c4-3 6 3 9 0s5-3 9 0"/>'],
    ['window', '<path d="M5 19V9M9.5 19v-7M14 19v-4M18.5 19v-2"/><path d="M3 20h18"/>'],
    ['build', '<rect x="4" y="5" width="7" height="4" rx="1"/><rect x="11" y="10" width="5" height="4" rx="1"/><rect x="16" y="15" width="4" height="4" rx="1"/>'],
    ['shape', '<path d="M12 3.5l7.4 4.3v8.4L12 20.5l-7.4-4.3V7.8z"/><path d="M12 8l3.5 2.5-1 4.5h-5l-1.5-4z"/>'],
    ['ideas', '<path d="M7 5.5l2.6 1.5v3L7 11.5 4.4 10V7zM17 5.5l2.6 1.5v3L17 11.5 14.4 10V7zM12 13l2.6 1.5v3L12 19l-2.6-1.5v-3z"/><path d="M9 10l1.5 3.3M15 10l-1.5 3.3"/>'],
  ];
  const TYPE = { example: 'nearest examples', bias: 'general pull', shape: 'shape', word: 'word', learned: 'learned from Jev' };
  const LEARNED_COLOR = '#a9b8ff';
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* one canvas drawing one view at a time; several can run side by side (the dashboard, a card's replay) */
  function renderer(canvas, { note, onPick, start = 'now', scale = 1 } = {}) {
    let view = start, T = null, dpr = 1, W = 0, H = 0, hits = [], born = {}, eased = {}, P = null, wasEmpty = false, previewing = false;
    let x = canvas.getContext('2d');
    canvas.addEventListener('click', ev => {
      const r = canvas.getBoundingClientRect(), px = (ev.clientX - r.left) * dpr, py = (ev.clientY - r.top) * dpr;
      const h = hits.find(h => (px - h.x) ** 2 + (py - h.y) ** 2 < h.r * h.r);
      if (h && onPick) onPick(h.id);
    });

    const focus = () => T && (T.phrases.find(p => p.id === T.focus) || T.phrases[T.phrases.length - 1]);
    const ease = (key, target, k = .14) => (eased[key] = lerp(eased[key] ?? target, target, k));
    const age = id => { if (!(id in born)) born[id] = performance.now(); return clamp((performance.now() - born[id]) / 700, 0, 1); };
    const font = (s, w = '') => x.font = `${w} ${s * dpr * scale}px ui-monospace, "SF Mono", Menlo, monospace`;
    const U = v => v * dpr * scale;                                         // a length in the view's own units
    const muted = '#7d9a78', ink = '#e8f5e4', faint = '#1c281a', amber = '#ffc94a';
    const fit = (t, w) => { if (x.measureText(t).width <= w) return t; while (t.length > 1 && x.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; };
    const hex = (cx, cy, r) => { x.beginPath(); for (let k = 0; k < 7; k++) { const a = Math.PI / 3 * k + Math.PI / 6; x.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); } };

    /* ── river: every kind's standing, phrase by phrase ── */
    function river() {
      let P = T.phrases.slice(-40); if (!P.length) return empty();
      if (P.length === 1) P = [P[0], P[0]];                     // a single phrase still shows as a short stripe
      const hasDoubt = P.some(p => p.doubt != null), band = hasDoubt ? 22 * dpr : 0;
      const top = 16 * dpr + band, bottom = H - 30 * dpr, left = 8 * dpr, right = W - 96 * dpr, mid = (top + bottom) / 2;
      const kinds = T.kinds, n = P.length, step = n > 1 ? (right - left) / (n - 1) : 0;
      /* each column: the kinds above that phrase's fifth-best score, as shares; thickness is how clearly it is marked */
      const peak = Math.max(...P.map(p => Math.max(0, p.ranked[0][1])), 1e-6);
      const cols = P.map(p => {
        const floor = p.ranked[Math.min(5, p.ranked.length - 1)][1], share = {}; let sum = 0;
        for (const [k, v] of p.ranked) { const s = Math.max(0, v - floor); share[k] = s; sum += s; }
        const thick = (bottom - top) * (.35 + .65 * Math.max(0, p.ranked[0][1]) / peak);
        kinds.forEach(k => share[k] = sum && share[k] ? share[k] / sum * thick : 0);
        return share;
      });
      const slide = 1 - age(P[n - 1].id);
      const X = i => left + i * step + slide * step;
      /* the bands */
      let base = cols.map(c => mid - kinds.reduce((a, k) => a + c[k], 0) / 2);
      const lead = {};
      for (const k of kinds) {
        if (!cols.some(c => c[k] > .5)) continue;
        const lo = base.slice(), hi = base.map((b, i) => b + cols[i][k]);
        x.beginPath(); x.moveTo(X(0), lo[0]);
        for (let i = 1; i < n; i++) { const cx = (X(i - 1) + X(i)) / 2; x.bezierCurveTo(cx, lo[i - 1], cx, lo[i], X(i), lo[i]); }
        x.lineTo(X(n - 1), hi[n - 1]);
        for (let i = n - 2; i >= 0; i--) { const cx = (X(i + 1) + X(i)) / 2; x.bezierCurveTo(cx, hi[i + 1], cx, hi[i], X(i), hi[i]); }
        x.closePath(); x.fillStyle = T.color(k); x.globalAlpha = .72; x.fill(); x.globalAlpha = 1;
        x.strokeStyle = '#000'; x.lineWidth = dpr * .6; x.stroke();
        lead[k] = [(lo[n - 1] + hi[n - 1]) / 2, cols[n - 1][k]];
        base = hi;
      }
      /* the kinds still in the stream at the newest phrase, named at its edge */
      font(9.5); x.textAlign = 'left'; x.textBaseline = 'middle';
      let lastY = -1e9;
      Object.entries(lead).filter(([, [, t]]) => t > 6 * dpr).sort((a, b) => a[1][0] - b[1][0]).forEach(([k, [y]]) => {
        y = Math.max(y, lastY + 11 * dpr); lastY = y; x.fillStyle = T.color(k); x.fillText(fit(k, W - right - 12 * dpr), right + 8 * dpr, y);
      });
      /* the choice beneath: it can lag the stream, because a new kind must lead clearly or twice */
      hits = []; const tags = [];
      P.forEach((p, i) => {
        x.fillStyle = T.color(p.kind); x.fillRect(X(i) - step / 2, bottom + 8 * dpr, Math.max(step, 2 * dpr), 5 * dpr);
        if (i && p.kind !== P[i - 1].kind) {
          x.strokeStyle = ink; x.globalAlpha = .6; x.setLineDash([3 * dpr, 3 * dpr]); x.lineWidth = dpr;
          x.beginPath(); x.moveTo(X(i), top - 6 * dpr); x.lineTo(X(i), bottom + 14 * dpr); x.stroke(); x.setLineDash([]); x.globalAlpha = 1;
          /* the switch is named at the top, stepped down when names would touch */
          font(8.5); const t = '→ ' + p.kind, tw = x.measureText(t).width, right0 = X(i) > W * .6;
          const L = right0 ? X(i) - 3 * dpr - tw : X(i) + 3 * dpr; let ty = top - 6 * dpr;
          while (tags.some(g => g.y === ty && L < g.R + 4 * dpr && L + tw > g.L - 4 * dpr)) ty += 11 * dpr;
          tags.push({ L, R: L + tw, y: ty });
          x.fillStyle = '#070907'; x.fillRect(L - 2 * dpr, ty - 6 * dpr, tw + 4 * dpr, 12 * dpr);
          x.fillStyle = T.color(p.kind); x.textAlign = 'left'; x.fillText(t, L, ty);
        }
        if (p.id === (focus() || {}).id) { x.strokeStyle = amber; x.lineWidth = 1.5 * dpr; x.strokeRect(X(i) - 3 * dpr, bottom + 6 * dpr, 6 * dpr, 9 * dpr); }
        hits.push({ x: X(i), y: bottom + 10 * dpr, r: Math.max(8 * dpr, step / 2), id: p.id });
      });
      /* the doubt: how near the classifier came, phrase by phrase, to changing its mind */
      if (hasDoubt) {
        const y0 = 4 * dpr, hgt = band - 8 * dpr;
        x.beginPath(); P.forEach((p, i) => x.lineTo(X(i), y0 + hgt * (1 - (p.doubt || 0)))); x.lineTo(X(n - 1), y0 + hgt); x.lineTo(X(0), y0 + hgt); x.closePath();
        x.fillStyle = 'rgba(255,201,74,.18)'; x.fill();
        x.beginPath(); P.forEach((p, i) => x.lineTo(X(i), y0 + hgt * (1 - (p.doubt || 0)))); x.strokeStyle = amber; x.lineWidth = 1.2 * dpr; x.stroke();
        font(8); x.fillStyle = amber; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText('doubt', right + 8 * dpr, y0 + hgt / 2);
      }
      font(8.5); x.fillStyle = muted; x.textAlign = 'left'; x.fillText('heard', left, H - 8 * dpr);
      x.textAlign = 'right'; x.fillText('chosen ▬', right, H - 8 * dpr);
      say('Each band is a kind; its thickness is its share of the points after every phrase. The strip beneath is the kind chosen, which holds until a new kind clearly leads over time. The amber line above is the doubt: how near the classifier came to changing its mind.');
    }

    /* ── window: the minute of talk and each phrase's share of the verdict ── */
    function windowView() {
      const p = focus(); if (!p || !p.weights) return empty();
      const rows = p.weights, pad = 10 * dpr, graphH = 54 * dpr, rowH = Math.min(26 * dpr, (H - graphH - 44 * dpr) / Math.max(rows.length, 1));
      /* the decay: a phrase ten words back counts about half, forty words back hardly at all */
      const gx = pad, gy = pad, gw = W - pad * 2, gh = graphH - 14 * dpr;
      x.strokeStyle = faint; x.lineWidth = dpr; x.strokeRect(gx, gy, gw, gh);
      const SPAN = T.windowWords || 120, REC = T.recency || 30;
      x.beginPath(); for (let k = 0; k <= SPAN; k++) x.lineTo(gx + gw - k / SPAN * gw, gy + gh - Math.exp(-k / REC) * gh * .92); x.strokeStyle = amber; x.stroke();
      let back = 0; const lens = rows.map(r => r.text.split(/\s+/).length);
      for (let i = rows.length - 1; i >= 0; i--) {
        const px = gx + gw - Math.min(SPAN, back) / SPAN * gw, pw = Math.min(lens[i], SPAN - Math.min(SPAN, back)) / SPAN * gw;
        const own = T.phrases.find(q => q.id === rows[i].id) || p;
        x.fillStyle = T.color(topOwn(own)); x.globalAlpha = .25; x.fillRect(px - pw, gy + gh - 4 * dpr, pw, 4 * dpr); x.globalAlpha = 1;
        back += lens[i];
      }
      font(8.5); x.fillStyle = muted; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      x.fillText(SPAN + ' words back', gx, gy + gh + 11 * dpr); x.textAlign = 'right'; x.fillText('now', gx + gw, gy + gh + 11 * dpr);
      /* the phrases, oldest first, each bar its share */
      const maxW = Math.max(...rows.map(r => r.w), 1e-6), barX = W * .52, barW = W - barX - 44 * dpr;
      rows.forEach((r, i) => {
        const y = graphH + 16 * dpr + i * rowH, own = T.phrases.find(q => q.id === r.id) || p, k = topOwn(own);
        const w = ease('w' + p.id + i, r.w / maxW) * barW;
        font(10); x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillStyle = r.id ? muted : ink;
        x.fillText(fit(r.text, barX - pad - 8 * dpr), pad, y + rowH / 2);
        x.fillStyle = '#0d130c'; x.fillRect(barX, y + rowH * .3, barW, rowH * .4);
        x.fillStyle = T.color(k); x.fillRect(barX, y + rowH * .3, w, rowH * .4);
        x.fillStyle = r.id ? muted : ink; x.textAlign = 'right'; x.fillText(Math.round(r.w * 100) + '%', W - pad, y + rowH / 2);
      });
      const alone = topOwn(p), y = graphH + 22 * dpr + rows.length * rowH;
      font(10.5); x.textAlign = 'left'; x.fillStyle = ink;
      x.fillText(`Alone it reads as ${alone}.`, pad, y + 6 * dpr);
      x.fillStyle = T.color(p.ranked[0][0]); x.fillText(`With the minute it reads as ${p.ranked[0][0]}.`, pad, y + 22 * dpr);
      say("The curve is how much a word counts by how far back it was said. Each bar is one phrase's share of this verdict, coloured by what that phrase would be on its own.");
    }
    const topOwn = p => { const o = p.own || {}; let best = p.kind, v = -1e9; for (const k in o) if (o[k] > v) { v = o[k]; best = k; } return best; };

    /* ── build: the leading kinds, part by part ── */
    function build() {
      const p = focus(); if (!p) return empty();
      const kinds = p.ranked.slice(0, 5).map(r => r[0]), pad = 10 * dpr, labelW = 118 * dpr;
      const rows = kinds.map(k => ({ k, parts: (p.parts && p.parts[k]) || [], total: p.ranked.find(r => r[0] === k)[1], own: (p.own || {})[k] }));
      let hi = 1e-6, lo = 0;
      rows.forEach(r => { let pos = 0, neg = 0; r.parts.forEach(q => q.add >= 0 ? pos += q.add : neg += q.add); hi = Math.max(hi, pos, r.total); lo = Math.min(lo, neg, r.total); });
      const x0 = pad + labelW, span = W - x0 - 50 * dpr, S = v => x0 + (v - lo) / (hi - lo) * span, zero = S(0);
      const rowH = Math.min(58 * dpr, (H - 40 * dpr) / rows.length);
      x.strokeStyle = faint; x.lineWidth = dpr; x.beginPath(); x.moveTo(zero, 6 * dpr); x.lineTo(zero, 6 * dpr + rows.length * rowH); x.stroke();
      rows.forEach((r, i) => {
        const y = 8 * dpr + i * rowH, bh = rowH * .38, by = y + rowH * .18, c = T.color(r.k);
        font(10.5, i ? '' : '600'); x.fillStyle = i ? muted : ink; x.textAlign = 'left'; x.textBaseline = 'middle';
        x.fillText(fit(r.k, labelW - 8 * dpr), pad, by + bh / 2);
        let pos = 0, neg = 0;
        r.parts.forEach((q, j) => {
          const a = q.add >= 0 ? pos : neg + q.add, b = q.add >= 0 ? pos + q.add : neg;
          if (q.add >= 0) pos += q.add; else neg += q.add;
          const L = S(a), R = lerp(S(a), S(b), ease('b' + p.id + r.k + j, 1, .1));
          x.fillStyle = q.type === 'bias' ? '#3a4a38' : q.type === 'shape' ? amber : q.type === 'learned' ? LEARNED_COLOR : c;
          x.globalAlpha = q.type === 'word' ? (j % 2 ? .75 : .95) : .9; x.fillRect(L, by, Math.max(1, R - L - dpr), bh); x.globalAlpha = 1;
          font(8.5); x.fillStyle = '#000'; x.textAlign = 'center';
          const t = q.label; if (R - L > x.measureText(t).width + 6 * dpr) x.fillText(t, (L + R) / 2, by + bh / 2);
        });
        /* the verdict with the minute of talk, against the phrase's own */
        const tx = S(ease('t' + r.k, r.total)); x.strokeStyle = ink; x.lineWidth = 2 * dpr;
        x.beginPath(); x.moveTo(tx, by - 4 * dpr); x.lineTo(tx, by + bh + 4 * dpr); x.stroke();
        font(9); x.fillStyle = ink; x.textAlign = 'left'; x.fillText(r.total.toFixed(2), W - 44 * dpr, by + bh / 2);
        font(8.5); x.fillStyle = muted;
        const words = r.parts.filter(q => q.type === 'word' || q.type === 'shape' && !p.engine).map(q => q.label);
        const line = p.engine ? r.parts.map(q => `${TYPE[q.type] === 'shape' ? q.label : TYPE[q.type]} ${q.add >= 0 ? '+' : ''}${q.add.toFixed(2)}`).join('  ') : (words.length ? [...new Set(words)].join(', ') : 'nothing marked it');
        x.fillText(fit(line, W - x0 - 10 * dpr), x0, by + bh + 11 * dpr);
      });
      say(p.engine
        ? 'Each bar is one kind: how near the phrase came to that kind\'s examples, what Jev has taught it (blue), less the kind\'s general pull, plus its shape (amber). The white tick is the score with the talk before it counted in.'
        : 'Each bar is one kind, built from the marker words it heard (one block each), the words Jev has taught it (blue) and the phrase\'s shape (amber). The white tick is the score with the talk before it counted in.');
    }

    /* ── shape: how the phrase is built, as a radar ── */
    function shape() {
      const P = T.phrases.filter(p => p.signals).slice(-6); if (!P.length) return empty();
      const f = focus(), cur = (f && f.signals) ? f : P[P.length - 1], names = Object.keys(cur.signals);
      const cx = W / 2, cy = H / 2 + 4 * dpr, R = Math.min(W, H) * .36, A = i => -Math.PI / 2 + i / names.length * Math.PI * 2;
      x.strokeStyle = faint; x.lineWidth = dpr;
      [.25, .5, .75, 1].forEach(s => { x.beginPath(); names.forEach((_, i) => x.lineTo(cx + R * s * Math.cos(A(i)), cy + R * s * Math.sin(A(i)))); x.closePath(); x.stroke(); });
      names.forEach((_, i) => { x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + R * Math.cos(A(i)), cy + R * Math.sin(A(i))); x.stroke(); });
      const poly = (p, alpha, fill, key) => {
        x.beginPath();
        names.forEach((k, i) => { const v = key ? ease(key + k, p.signals[k] || 0, .12) : (p.signals[k] || 0); x.lineTo(cx + R * (.04 + .96 * v) * Math.cos(A(i)), cy + R * (.04 + .96 * v) * Math.sin(A(i))); });
        x.closePath(); x.strokeStyle = T.color(p.kind); x.globalAlpha = alpha; x.lineWidth = (fill ? 2 : 1) * dpr; x.stroke();
        if (fill) { x.fillStyle = T.color(p.kind); x.globalAlpha = .22; x.fill(); } x.globalAlpha = 1;
      };
      P.filter(p => p !== cur).forEach((p, i, a) => poly(p, .12 + .3 * i / a.length, false));
      poly(cur, 1, true, 'r');
      font(9.5); x.textBaseline = 'middle';
      names.forEach((k, i) => {
        const v = cur.signals[k] || 0, lx = cx + (R + 12 * dpr) * Math.cos(A(i)), ly = cy + (R + 12 * dpr) * Math.sin(A(i));
        x.textAlign = Math.abs(Math.cos(A(i))) < .2 ? 'center' : Math.cos(A(i)) > 0 ? 'left' : 'right';
        x.fillStyle = v > .05 ? ink : muted; x.fillText(k + (v > .05 ? ' ' + v.toFixed(2) : ''), lx, ly);
      });
      say('Each spoke is one way a passage can be built, from 0 at the centre to 1 at the rim. The filled shape is this phrase; the faint outlines are the phrases before it.');
    }

    /* ── ideas: hexagons, the phrases tied to them, and the returns ── */
    function ideas() {
      const I = T.ideas, P = T.phrases.slice(-60); if (!I.length || !P.length) return empty();
      const pad = 14 * dpr, lineY = H - 22 * dpr, n = I.length;
      const maxWords = Math.max(...I.map(i => i.words || 1), 1);
      const at = {};
      /* the ideas sit on a honeycomb, in the order they arrived, filling the space above the phrases */
      const areaH = lineY - 34 * dpr, cols = Math.max(1, Math.ceil(Math.sqrt(n * (W - pad * 2) / areaH))), rowsN = Math.ceil(n / cols);
      const cw = (W - pad * 2) / cols, ch = areaH / rowsN, rMax = Math.min(cw * .36, ch * .32);
      I.forEach((idea, i) => {
        const row = Math.floor(i / cols), c = i % cols;
        const px = pad + cw * (c + (cols > 1 ? (row % 2 ? .65 : .35) : .5)), py = 8 * dpr + ch * (row + .55);
        at[idea.id] = [ease('ix' + idea.id, px, .08), ease('iy' + idea.id, py, .08), (.3 + .7 * Math.sqrt((idea.words || 1) / maxWords)) * rMax, cw];
      });
      const step = (W - pad * 2) / Math.max(P.length - 1, 1);
      hits = [];
      /* each phrase hangs from its idea; a phrase that comes back to an earlier idea is drawn in amber */
      P.forEach((p, i) => {
        const a = at[p.idea]; if (!a) return;
        const px = pad + i * step, back = i && P[i - 1].idea !== p.idea && P.slice(0, i).some(q => q.idea === p.idea);
        const grow = age(p.id), ty = lerp(lineY, a[1] + a[2], grow), tx = lerp(px, a[0], grow);
        x.strokeStyle = back ? amber : T.color(p.kind); x.globalAlpha = back ? .9 : .35; x.lineWidth = (back ? 1.6 : 1) * dpr;
        x.beginPath(); x.moveTo(px, lineY); x.quadraticCurveTo(px, (lineY + ty) / 2, tx, ty); x.stroke(); x.globalAlpha = 1;
        x.fillStyle = T.color(p.kind); x.beginPath(); x.arc(px, lineY, (p.id === (focus() || {}).id ? 4.5 : 2.6) * dpr, 0, 7); x.fill();
        hits.push({ x: px, y: lineY, r: Math.max(7 * dpr, step / 2), id: p.id });
      });
      font(9.5); x.textAlign = 'center'; x.textBaseline = 'middle';
      I.forEach(idea => {
        const [px, py, r] = at[idea.id], on = idea.id === T.active;
        hex(px, py, r); x.fillStyle = on ? 'rgba(255,201,74,.16)' : 'rgba(57,255,20,.05)'; x.fill();
        x.strokeStyle = on ? amber : 'rgba(57,255,20,.45)'; x.lineWidth = (on ? 2 : 1) * dpr;
        if (on) { x.shadowColor = amber; x.shadowBlur = 12 * dpr; } x.stroke(); x.shadowBlur = 0;
        for (let k = 0; k < Math.min(6, idea.returns || 0); k++) { const a = Math.PI / 3 * k; x.fillStyle = amber; x.beginPath(); x.arc(px + (r + 5 * dpr) * Math.cos(a), py + (r + 5 * dpr) * Math.sin(a), 2 * dpr, 0, 7); x.fill(); }
        x.fillStyle = on ? ink : muted; const t = fit(idea.title || '', at[idea.id][3] - 8 * dpr), hw = x.measureText(t).width / 2; x.fillText(t, clamp(px, pad + hw, W - pad - hw), py + r + 9 * dpr);
        font(8.5); x.fillStyle = muted; x.fillText(`${idea.n || 0}·${idea.words || 0}w`, px, py); font(9.5);
      });
      say('Each hexagon is an idea, sized by its words, with an amber bead for every return. Each dot below is a phrase, tied to its idea; amber ties are returns. Tap a dot to look at that phrase.');
    }

    /* ── bars: every kind's share over time, and how firmly the kind in front holds ── */
    function bars() {
      const p = focus(); if (!p) return empty();
      const settled = p.settled || (() => { const r = p.ranked, f = r[Math.min(5, r.length - 1)][1], o = {}; let s = 0; r.forEach(([k, v]) => { o[k] = Math.max(0, v - f); s += o[k]; }); for (const k in o) o[k] /= s || 1; return o; })();
      const rows = Object.entries(settled).sort((a, b) => b[1] - a[1]).slice(0, 8), pad = 10 * dpr, labelW = 150 * dpr;
      const top = rows[0] ? rows[0][1] : 1, rowH = Math.min(24 * dpr, (H - 110 * dpr) / rows.length);
      rows.forEach(([k, v], i) => {
        const y = pad + i * rowH, w = ease('s' + k, v / Math.max(top, 1e-6)) * (W - labelW - 60 * dpr);
        font(10.5, k === p.kind ? '600' : ''); x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillStyle = k === p.kind ? ink : muted;
        x.fillText(fit(k, labelW - 8 * dpr), pad, y + rowH / 2);
        x.fillStyle = '#0d130c'; x.fillRect(labelW, y + rowH * .28, W - labelW - 60 * dpr, rowH * .44);
        x.fillStyle = T.color(k); x.globalAlpha = k === p.kind ? 1 : .7; x.fillRect(labelW, y + rowH * .28, w, rowH * .44); x.globalAlpha = 1;
        x.fillStyle = ink; x.textAlign = 'right'; x.fillText(Math.round(v * 100) + '%', W - pad, y + rowH / 2);
      });
      /* the doubt meter */
      const y = pad + rows.length * rowH + 14 * dpr, d = ease('doubt', p.doubt || 0, .08), mw = W - pad * 2;
      font(10); x.textAlign = 'left'; x.fillStyle = amber; x.fillText('doubt', pad, y);
      x.fillStyle = '#0d130c'; x.fillRect(pad + 50 * dpr, y - 4 * dpr, mw - 50 * dpr, 8 * dpr);
      const g = x.createLinearGradient(pad + 50 * dpr, 0, pad + mw, 0); g.addColorStop(0, '#39ff14'); g.addColorStop(.6, amber); g.addColorStop(1, '#ff5a4a');
      x.fillStyle = g; x.fillRect(pad + 50 * dpr, y - 4 * dpr, (mw - 50 * dpr) * d, 8 * dpr);
      font(10); x.fillStyle = ink; let ty = y + 20 * dpr;
      const said = p.run != null ? `${p.kind} has held for ${p.run} phrases.` : `The kind is ${p.kind}.`;
      x.fillText(fit(said, mw), pad, ty); ty += 15 * dpr;
      if (p.reason) { font(9.5); x.fillStyle = muted; let line = ''; for (const w2 of String(p.reason).split(' ')) { const t = line ? line + ' ' + w2 : w2; if (x.measureText(t).width > mw) { x.fillText(line, pad, ty); ty += 13 * dpr; line = w2; } else line = t; } if (line) x.fillText(line, pad, ty); }
      say('Each bar is a kind\'s share over time: every phrase adds to it, so one phrase moves it only so far. The longer a kind has held, the more a new one must lead by. The doubt shows how near it is to changing.');
    }

    /* ════ depth and steering: what each phrase carries in p.depth (the three lenses) and p.steer (the threads) ════ */
    const lastWith = key => { const P = T.phrases, f = focus(); if (!f) return null; for (let j = P.indexOf(f); j >= 0; j--) if (P[j][key]) return P[j][key]; return null; };
    const nowOf = () => T.now || (focus() ? focus().at : Date.now() / 1000);
    const live = (t, now) => t.state !== 'closed' && now - (t.last_at || now) >= (T.dormantSeconds || 90) ? 'dormant' : t.state;
    const pulseT = () => performance.now() / 1000;
    const LN = ['listener', 'speaker', 'absorption'], LNAME = { listener: 'Listener', speaker: 'Speaker', absorption: 'Absorption' };
    const wrapText = (t, w) => { const out = []; let line = ''; for (const wd of String(t || '').split(/\s+/)) { const tt = line ? line + ' ' + wd : wd; if (x.measureText(tt).width > w && line) { out.push(line); line = wd; } else line = tt; } if (line) out.push(line); return out; };
    const glowOn = (c, b) => { x.shadowColor = c; x.shadowBlur = b; }, glowOff = () => { x.shadowBlur = 0; };

    /* ── lenses: the three questions as a triangle, the elements lighting as they are found ── */
    function lensesView() {
      const d = lastWith('depth'); if (!d) return empty();
      const rowsN = LN.reduce((a, q) => a + d.lenses[q].elements.length, 0), most0 = Math.max(...LN.map(q => d.lenses[q].elements.length));
      const wide = W > H * 1.25 && (H - U(102)) / rowsN >= U(15), kc = T.color(d.kind);
      const small = H < 250 * dpr || W < 280 * dpr || (!wide && (H - (H * .3 + Math.min(W * .3, H * .22) * 1.05 + U(54))) / most0 < U(11));
      const cx = wide ? W * .28 : W / 2, cy = wide ? H * .54 : small ? H * .36 : H * .3, R = wide ? Math.min(W * .18, H * .34) : small ? Math.min(W * .26, H * .24) : Math.min(W * .3, H * .22);
      const A = i => -Math.PI / 2 + i * 2 * Math.PI / 3, pt = (i, v) => [cx + R * v * Math.cos(A(i)), cy + R * v * Math.sin(A(i))];
      x.strokeStyle = faint; x.lineWidth = dpr;
      [.25, .5, .75, 1].forEach(s => { x.beginPath(); for (let i = 0; i < 3; i++) x.lineTo(...pt(i, s)); x.closePath(); x.stroke(); });
      for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(cx, cy); x.lineTo(...pt(i, 1)); x.stroke(); }
      const tri = (m, alpha, fill, key, col, dash) => {
        x.beginPath(); LN.forEach((l, i) => x.lineTo(...pt(i, .04 + .96 * (key ? ease(key + l, m[l] || 0, .1) : (m[l] || 0))))); x.closePath();
        x.strokeStyle = col; x.globalAlpha = alpha; x.lineWidth = (fill ? 2 : 1) * dpr; if (dash) x.setLineDash([U(4), U(4)]); x.stroke(); x.setLineDash([]);
        if (fill) { x.fillStyle = col; x.globalAlpha = .2; x.fill(); } x.globalAlpha = 1;
      };
      const meters = dd => Object.fromEntries(LN.map(l => [l, dd.lenses[l].meter]));
      const H6 = T.phrases.filter(q => q.depth).slice(-7, -1);
      H6.forEach((q, i) => tri(meters(q.depth), .08 + .22 * i / Math.max(1, H6.length), false, null, T.color(q.depth.kind)));
      Object.entries(d.near || {}).forEach(([k, m]) => tri(m, .7, false, null, T.color(k), true));
      tri(meters(d), 1, true, 'lz', kc);
      if (T.jev && T.jev.lenses) LN.forEach((l, i) => { if (T.jev.lenses[l] == null) return; const [px, py] = pt(i, .04 + .96 * T.jev.lenses[l]); x.fillStyle = amber; x.beginPath(); x.moveTo(px, py - U(5)); x.lineTo(px + U(5), py); x.lineTo(px, py + U(5)); x.lineTo(px - U(5), py); x.fill(); });
      /* the corners: each lens and its meter */
      font(small ? 9.5 : 11, '600'); x.textBaseline = 'middle'; x.textAlign = 'left';
      LN.forEach((l, i) => {
        const [px, py] = pt(i, 1.13), t = `${small ? LNAME[l].slice(0, 6) : LNAME[l]} ${Math.round(d.lenses[l].meter * 100)}%`, tw = x.measureText(t).width;
        const lx = clamp(i === 0 ? px - tw / 2 : i === 1 ? px : px - tw, U(4), W - tw - U(4));
        x.fillStyle = ink; x.fillText(t, lx, py + (i === 0 ? -U(4) : U(10)));
      });
      if (small) {
        /* a small cell: each lens a row of hexagons, lit as their elements are found */
        let y = cy + R * .6 + U(30);
        LN.forEach(l => {
          font(8.5); x.fillStyle = muted; x.textAlign = 'left'; x.fillText(LNAME[l].slice(0, 6), U(6), y);
          d.lenses[l].elements.forEach((e, j) => { hex(U(62) + j * U(15), y, U(5.5)); if (e.found) { glowOn(kc, U(6)); x.fillStyle = kc; x.fill(); glowOff(); } else { x.fillStyle = kc; x.globalAlpha = .12 + .5 * e.score; x.fill(); x.globalAlpha = 1; x.strokeStyle = kc; x.lineWidth = dpr; x.stroke(); } });
          y += U(16);
        });
        say(`The three lenses of ${d.kind}; hexagons light as elements are found.`);
        return;
      }
      /* the elements, lens by lens: lit when found, half lit as they gather, with the first words that showed them */
      const x0 = wide ? Math.max(W * .56, cx + R * 1.25 + U(60)) : U(10), colW = wide ? W - x0 - U(10) : (W - U(20)) / 3;
      let y0 = wide ? U(14) : cy + R * 1.05 + U(26);
      LN.forEach((l, i) => {
        const bx = wide ? x0 : x0 + i * colW, els = d.lenses[l].elements;
        let by = wide ? y0 : y0;
        font(9.5, '600'); x.textAlign = 'left'; x.fillStyle = kc; x.fillText(LNAME[l].toUpperCase(), bx, by); by += U(15);
        const rows = LN.reduce((a, q) => a + d.lenses[q].elements.length, 0);
        const most = Math.max(...LN.map(q => d.lenses[q].elements.length));
        const rowH = wide ? Math.min(U(22), (H - U(24) - 3 * U(26)) / Math.max(1, rows)) : Math.min(U(19), (H - y0 - U(28)) / most);
        els.forEach((e, j) => {
          const lit = ease('el' + l + e.id, e.score, .08);
          hex(bx + U(6), by, U(5.5));
          if (e.found) { glowOn(kc, U(8)); x.fillStyle = kc; x.fill(); glowOff(); }
          else { x.fillStyle = kc; x.globalAlpha = .12 + .5 * lit; x.fill(); x.globalAlpha = 1; x.strokeStyle = kc; x.lineWidth = dpr; x.stroke(); }
          font(Math.min(wide ? 10 : 9.5, rowH / U(1) * .62)); x.fillStyle = e.found ? ink : muted;
          const ev = e.found && e.evidence && e.evidence[0] ? ' · ' + e.evidence[0] : '';
          x.fillText(fit(e.name + ev, colW - U(20)), bx + U(16), by);
          by += rowH;
        });
        if (wide) y0 = by + U(8);
      });
      say(`The triangle is the three lenses of ${d.kind}: what the listener must bring, what the speaker must deliver, and what draws a listener in. Earlier phrases fade behind; dashed outlines are kinds near it; amber marks are Jev's reading at a pause. A hexagon lights when its element is found.`);
    }

    /* ── arc: the lead form's stages as a path, the marker where the talk stands, the next move glowing ── */
    function arcView() {
      const st = lastWith('steer'), a = st && st.arc; if (!a || !a.stages || !a.stages.length) return empty();
      const n = a.stages.length, kc = T.color(a.kind), pad = U(34), small = H < U(300), y0 = small ? H * .5 : H * .56, top = small ? H * .26 : H * .2;
      const B = u => { const q = 1 - u; return [q * q * pad + 2 * q * u * (W / 2) + u * u * (W - pad), q * q * y0 + 2 * q * u * top + u * u * y0]; };
      const U_ = i => n > 1 ? i / (n - 1) : .5;
      x.lineWidth = U(3); x.strokeStyle = faint; x.beginPath(); for (let k = 0; k <= 60; k++) x.lineTo(...B(k / 60)); x.stroke();
      const cur = a.stages.findIndex(s => s.id === a.current), curE = ease('arcm', Math.max(0, cur), .06);
      if (cur >= 0) { x.strokeStyle = kc; x.lineWidth = U(3); x.beginPath(); for (let k = 0; k <= 60 * U_(curE); k++) x.lineTo(...B(k / 60)); x.stroke(); }
      const nextI = a.next ? a.stages.findIndex(s => s.id === a.next.id) : -1, beat = .5 + .5 * Math.sin(pulseT() * 3);
      a.stages.forEach((s, i) => {
        const [px, py] = B(U_(i)), r = Math.min(U(13), (W - 2 * pad) / n * .22);
        if (i === nextI) { glowOn('#39ff14', U(10 + 14 * beat)); hex(px, py, r * (1.05 + .1 * beat)); x.strokeStyle = '#39ff14'; x.lineWidth = U(2); x.stroke(); glowOff(); }
        hex(px, py, r);
        if (s.reached) { x.fillStyle = kc; x.fill(); } else { x.fillStyle = '#070907'; x.fill(); x.strokeStyle = s.landing ? kc : muted; x.lineWidth = dpr * (s.landing ? 2 : 1); x.stroke(); }
        if (s.landing) { hex(px, py, r * 1.35); x.strokeStyle = kc; x.globalAlpha = .35; x.lineWidth = dpr; x.stroke(); x.globalAlpha = 1; }
        let fs = 10; font(fs, s.reached ? '600' : ''); while (fs > 7 && x.measureText(s.name).width > (W - 2 * pad) / n * .95) font(fs -= .5, s.reached ? '600' : '');
        x.fillStyle = s.reached ? ink : muted; x.textAlign = 'center'; x.textBaseline = 'top';
        x.fillText(fit(s.name, (W - 2 * pad) / n), px, py + r + U(8));
        if (T.jev && T.jev.stage === s.id) { x.fillStyle = amber; x.beginPath(); x.moveTo(px, py - r - U(4)); x.lineTo(px - U(5), py - r - U(13)); x.lineTo(px + U(5), py - r - U(13)); x.fill(); }
      });
      if (cur >= 0) { const [mx, my] = B(U_(curE)); glowOn(amber, U(12)); x.strokeStyle = amber; x.lineWidth = U(2.5); x.beginPath(); x.arc(mx, my, Math.max(U(3), Math.min(U(19), (W - 2 * pad) / n * .33)), 0, 7); x.stroke(); glowOff(); }
      /* the other threads of this form, as beads under the stage each has reached */
      const others = (st.threads || []).filter(t => t.id !== a.thread && t.kind === a.kind && t.stage);
      others.forEach((t, j) => { const i = a.stages.findIndex(s => s.id === t.stage); if (i < 0) return; const [px, py] = B(U_(i)); x.fillStyle = STATE[live(t, nowOf())] || kc; x.beginPath(); x.arc(px - U(12) + (j % 5) * U(6), py + U(44), U(2.6), 0, 7); x.fill(); });
      font(11, '600'); x.textAlign = 'left'; x.textBaseline = 'top'; x.fillStyle = kc;
      const th = (st.threads || []).find(t => t.id === a.thread);
      x.fillText(fit(`${a.kind}${th ? ' · ' + th.title : ''}`, W - U(20)), U(10), U(8));
      font(12); x.textAlign = 'center'; x.fillStyle = ink;
      if (a.next) {
        font(12.5); const lines = wrapText(a.next.move, W - U(40)).slice(0, small ? 2 : 3);
        let ty = Math.min(y0 + U(52), H - U(10) - U(16) - lines.length * U(17)); x.fillStyle = '#39ff14'; font(10, '600'); x.fillText('NEXT', W / 2, ty); ty += U(16);
        font(12.5); x.fillStyle = ink; lines.forEach(l => { x.fillText(l, W / 2, ty); ty += U(17); });
      } else { font(12); x.fillStyle = kc; x.fillText('The arc has landed.', W / 2, Math.min(y0 + U(56), H - U(24))); }
      say(`The path is the arc of ${a.kind}, stage by stage. Filled hexagons are reached in the thread in play; the amber ring is where it stands; the glowing hexagon is the natural next move. Beads beneath are other threads of the same form.`);
    }

    /* ── threads: a loom of lines that begin, thicken, dim, bud and flower ── */
    function threadsView() {
      const st = lastWith('steer'), TH = st && st.threads; if (!TH || !TH.length) return empty();
      const now = nowOf(), many = ((st.talk || {}).speakers || []).length > 1;
      const t0 = Math.min(...TH.map(t => t.opened_at)), t1 = Math.max(now, ...TH.map(t => t.last_at)) + 2;
      const labelW = Math.min(U(150), W * .28), left = U(10) + labelW, right = W - U(84), top = U(14), bottom = H - U(22);
      const rowH = Math.min(U(34), (bottom - top) / TH.length), X = t => left + (t - t0) / Math.max(1, t1 - t0) * (right - left);
      hits = [];
      TH.forEach((t, i) => {
        const y = top + rowH * (i + .5), state = live(t, now), kc = T.color(t.kind), sc = STATE[state] || kc;
        /* arriving from the edge: a thread an earlier recording opened */
        if (t.link) { x.strokeStyle = amber; x.globalAlpha = .7; x.setLineDash([U(3), U(3)]); x.lineWidth = dpr; x.beginPath(); x.moveTo(0, y - rowH * .4); x.bezierCurveTo(left * .5, y - rowH * .4, left * .7, y, X(t.opened_at), y); x.stroke(); x.setLineDash([]); x.globalAlpha = 1; }
        let cum = 0; const M = t.marks || [];
        M.forEach((m, k) => {
          cum += m[1]; const w = U(1.2) + Math.min(U(9), cum * U(.06)), xa = X(m[0]), xb = k + 1 < M.length ? X(M[k + 1][0]) : xa + U(4);
          x.strokeStyle = many ? (SPEAKER[m[2]] || kc) : kc; x.globalAlpha = state === 'dormant' ? .3 : .9; x.lineWidth = w; x.lineCap = 'round';
          x.beginPath(); x.moveTo(xa, y); x.lineTo(xb, y); x.stroke(); x.globalAlpha = 1;
          if (m[3] && m[3].length) { x.fillStyle = ink; x.beginPath(); x.arc(xa, y - w / 2 - U(3), U(1.6), 0, 7); x.fill(); }   // an arc stage reached here
        });
        x.lineCap = 'butt';
        const end = M.length ? X(M[M.length - 1][0]) + U(4) : X(t.opened_at), w = U(1.2) + Math.min(U(9), (t.words || 0) * U(.06));
        if (state === 'dormant') {                                       // dims, and slowly curls
          x.strokeStyle = sc; x.lineWidth = dpr; x.setLineDash([U(2), U(4)]); x.beginPath(); x.moveTo(end, y); x.lineTo(X(now), y); x.stroke(); x.setLineDash([]);
          const cx2 = X(now), curl = Math.min(1, (now - t.last_at) / 300); x.beginPath();
          for (let k = 0; k <= 30; k++) { const a = k / 30 * Math.PI * (1 + 2 * curl), r = U(7) * (1 - k / 40); x.lineTo(cx2 + r * Math.sin(a), y - U(7) + r * Math.cos(a)); } x.stroke();
        } else if (state !== 'closed') { x.strokeStyle = kc; x.globalAlpha = .25; x.lineWidth = dpr; x.beginPath(); x.moveTo(end, y); x.lineTo(X(now), y); x.stroke(); x.globalAlpha = 1; }
        const want = T.room && T.room.threads && T.room.threads[t.id] ? Math.min(1, (T.room.threads[t.id].interest || 0) / 3) : 0;
        if (want > .05 && state !== 'closed') {                          // the room wants more of it: a brighter glow where it stands
          const gx = state === 'dormant' ? X(now) : end, beat = .5 + .5 * Math.sin(pulseT() * 3 + i);
          glowOn('#5ab4ff', U(8 + 14 * want)); x.strokeStyle = 'rgba(90,180,255,' + (.35 + .5 * want) + ')'; x.lineWidth = U(1.5);
          x.beginPath(); x.arc(gx, y, U(7 + 5 * want * beat), 0, 7); x.stroke(); glowOff();
        }
        if (state === 'ready') {                                         // swells into a bud
          const b = 1 + .12 * Math.sin(pulseT() * 2.4 + i); glowOn(amber, U(10)); x.fillStyle = 'rgba(255,201,74,.85)';
          x.beginPath(); x.ellipse(end + U(6), y, U(6) * b, U(4.2) * b, 0, 0, 7); x.fill(); glowOff();
          x.strokeStyle = '#39ff14'; x.lineWidth = dpr; x.beginPath(); x.moveTo(end, y); x.lineTo(end + U(2), y - U(5)); x.stroke();
        }
        if (state === 'closed') {                                        // knots and flowers
          const fx = t.landing_at ? X(t.landing_at) : end; glowOn('#39ff14', U(8)); x.fillStyle = 'rgba(57,255,20,.85)';
          for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; x.beginPath(); x.ellipse(fx + U(6) * Math.cos(a), y + U(6) * Math.sin(a), U(4), U(2.2), a, 0, 7); x.fill(); }
          x.fillStyle = '#ffe9a0'; x.beginPath(); x.arc(fx, y, U(2.4), 0, 7); x.fill(); glowOff();
        }
        if (state === 'opened') { x.fillStyle = sc; x.beginPath(); x.arc(X(t.opened_at), y, U(3), 0, 7); x.fill(); }
        for (let r = 0; r < Math.min(5, t.returns || 0); r++) { x.fillStyle = amber; x.beginPath(); x.arc(X(t.opened_at) + U(5) * r, y + w / 2 + U(4), U(1.6), 0, 7); x.fill(); }
        font(10, t.id === st.active ? '600' : ''); x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillStyle = t.id === st.active ? ink : muted;
        x.fillText(fit(t.title || 'a thread', labelW - U(8)), left - U(8), y);
        font(9); x.textAlign = 'left'; x.fillStyle = sc === '#41503f' ? muted : sc;
        x.fillText(state === 'dormant' ? `dormant ${Math.max(1, Math.round((now - t.last_at) / 60))}m` : STATE_WORD[state], right + U(14), y);
      });
      font(8.5); x.fillStyle = muted; x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillText('start', left, H - U(6));
      x.textAlign = 'right'; x.fillText('now', right, H - U(6));
      if (many) { let lx = right + U(14); x.textAlign = 'left'; (st.talk.speakers || []).forEach(sp => { x.fillStyle = SPEAKER[sp] || ink; x.fillText(sp, lx, H - U(6)); lx += U(14); }); }
      say('Each line is a thread: it begins when an idea opens and thickens as it is developed' + (many ? ', coloured by who spoke' : '') + '. Dormant threads dim and curl; a thread ready to close swells into a bud; a closed thread flowers. Amber beads are returns; dashed lines from the edge are threads picked up from an earlier recording.');
    }

    /* ── pulse: the absorption over time as a wave, beating at the pace of the talk ── */
    function pulseView() {
      const P = T.phrases.filter(p => p.depth).slice(-40), st = lastWith('steer'), hold = (st && st.hold) || {}; if (!P.length) return empty();
      const left = U(10), right = W - Math.min(U(150), W * .3), top = U(16), bottom = H - U(26), n = P.length;
      const X = i => left + (n > 1 ? i / (n - 1) : .5) * (right - left), Y = v => bottom - v * (bottom - top);
      x.strokeStyle = faint; x.lineWidth = dpr; [0, .5, 1].forEach(v => { x.beginPath(); x.moveTo(left, Y(v)); x.lineTo(right, Y(v)); x.stroke(); });
      ['listener', 'speaker'].forEach(l => { x.strokeStyle = muted; x.globalAlpha = .45; x.lineWidth = dpr; x.beginPath(); P.forEach((p, i) => x.lineTo(X(i), Y(p.depth.lenses[l].meter))); x.stroke(); x.globalAlpha = 1; });
      const ab = P.map(p => p.depth.lenses.absorption.meter), tempo = hold.tempo || 1, t = pulseT();
      const g = x.createLinearGradient(0, top, 0, bottom); g.addColorStop(0, 'rgba(255,201,74,.35)'); g.addColorStop(1, 'rgba(255,201,74,0)');
      x.beginPath(); x.moveTo(X(0), bottom);
      const steps = 160; const val = u => { const f = u * (n - 1), i = Math.floor(f), k = f - i; return ab[i] + ((ab[i + 1] ?? ab[i]) - ab[i]) * k; };
      for (let k = 0; k <= steps; k++) { const u = k / steps, v = val(u); x.lineTo(left + u * (right - left), Y(v) + U(5) * v * Math.sin(u * 40 * tempo - t * 4 * tempo)); }
      x.lineTo(right, bottom); x.closePath(); x.fillStyle = g; x.fill();
      x.beginPath(); for (let k = 0; k <= steps; k++) { const u = k / steps, v = val(u); x.lineTo(left + u * (right - left), Y(v) + U(5) * v * Math.sin(u * 40 * tempo - t * 4 * tempo)); }
      x.strokeStyle = amber; x.lineWidth = U(1.6); x.stroke();
      /* the beat: a ring that swells at the pace of the words */
      const bx = (right + W) / 2, by = top + (bottom - top) * .32, base = Math.min(U(30), (W - right) * .28), beat = .5 + .5 * Math.sin(t * Math.PI * 2 * tempo * .6);
      const racing = hold.cue && hold.cue.type === 'pause';
      glowOn(racing ? '#ff5a4a' : amber, U(10 + 10 * beat)); x.strokeStyle = racing ? '#ff5a4a' : amber; x.lineWidth = U(2);
      x.beginPath(); x.arc(bx, by, base * (.75 + .25 * beat) * (.6 + .4 * (hold.meter || 0)), 0, 7); x.stroke(); glowOff();
      font(10); x.textAlign = 'center'; x.textBaseline = 'top'; x.fillStyle = ink;
      x.fillText(`${(hold.wps || 0).toFixed(1)} words/s`, bx, by + base + U(8));
      x.fillStyle = muted; x.fillText(`hold ${Math.round((hold.meter || 0) * 100)}%`, bx, by + base + U(22));
      let ty = by + base + U(42); font(9.5); x.fillStyle = racing ? '#ff8a7a' : ink;
      if (hold.cue) wrapText(hold.cue.text, W - right - U(14)).slice(0, 4).forEach(l => { x.fillText(l, bx, ty); ty += U(13); });
      else if ((hold.held || []).length) { x.fillStyle = muted; wrapText('Held by ' + hold.held.slice(0, 2).join(' and ').toLowerCase() + '.', W - right - U(14)).slice(0, 3).forEach(l => { x.fillText(l, bx, ty); ty += U(13); }); }
      font(8.5); x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillStyle = amber; x.fillText('absorption', left, H - U(8)); x.fillStyle = muted; x.fillText('  listener, speaker', left + U(66), H - U(8));
      say('The amber wave is the absorption, phrase by phrase, rippling at the pace of the talk; the grey lines are the listener and speaker lenses. The ring beats with the words a second, and turns red when the talk races.');
    }

    /* ── airtime: the speakers on a balance ── */
    function airtimeView() {
      const st = lastWith('steer'), talk = st && st.talk; if (!talk || !Object.keys(talk.airtime || {}).length) return empty();
      const sp = Object.keys(talk.airtime).sort(), total = sp.reduce((a, k) => a + talk.airtime[k], 0) || 1;
      const pos = sp.length === 1 ? [-.75] : sp.map((_, i) => -.85 + 1.7 * i / (sp.length - 1));
      const torque = sp.reduce((a, k, i) => a + pos[i] * talk.airtime[k] / total, 0), tilt = ease('tilt', Math.max(-.38, Math.min(.38, torque * .7)), .05);
      const cx = W / 2, cy = H * .2, L = Math.min(W * .38, U(260)), big = Math.min(W, H) / U(340);
      x.fillStyle = faint; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx - U(16), cy + U(46)); x.lineTo(cx + U(16), cy + U(46)); x.fill();
      x.strokeStyle = ink; x.lineWidth = U(2.5); x.beginPath(); x.moveTo(cx - L * Math.cos(tilt), cy - L * Math.sin(tilt)); x.lineTo(cx + L * Math.cos(tilt), cy + L * Math.sin(tilt)); x.stroke();
      x.fillStyle = ink; x.beginPath(); x.arc(cx, cy, U(4), 0, 7); x.fill();
      let low = cy;
      sp.forEach((k, i) => {
        const share = talk.airtime[k] / total, px = cx + pos[i] * L * Math.cos(tilt), py = cy + pos[i] * L * Math.sin(tilt), r = (U(7) + Math.sqrt(share) * U(24)) * Math.min(1.3, Math.max(.55, big));
        x.strokeStyle = muted; x.lineWidth = dpr; x.beginPath(); x.moveTo(px, py); x.lineTo(px, py + U(18)); x.stroke();
        glowOn(SPEAKER[k] || ink, U(10)); x.fillStyle = SPEAKER[k] || ink; x.globalAlpha = .85; x.beginPath(); x.arc(px, py + U(18) + r, r, 0, 7); x.fill(); x.globalAlpha = 1; glowOff();
        font(13, '700'); x.fillStyle = '#000'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(k, px, py + U(18) + r);
        font(10); x.fillStyle = ink; x.fillText(`${Math.round(share * 100)}%`, px, py + U(18) + 2 * r + U(10)); low = Math.max(low, py + U(18) + 2 * r + U(20));
      });
      /* per speaker: words, threads opened and taken up, questions asked and still open */
      const TH = st.threads || [], Q = talk.questions || [];
      let y = Math.max(low + U(10), H - U(28) - (sp.length + 1) * U(16)); font(9.5); x.textAlign = 'left'; x.textBaseline = 'middle';
      if (y + (sp.length + 1) * U(16) > H) {
        font(10); x.textAlign = 'center'; x.textBaseline = 'alphabetic'; x.fillStyle = muted;
        x.fillText(fit(sp.map(k => `${k} ${talk.airtime[k]} words`).join(' · ') + (sp.length > 1 ? ` · ${talk.turns} turns` : ''), W - U(16)), W / 2, H - U(8));
        say('The beam tips toward whoever has spoken most; each weight is a speaker.'); return;
      }
      const cw = (W - U(52)) / 4, cols = [U(12), U(40), U(40) + cw, U(40) + 2 * cw, U(40) + 3 * cw];
      x.fillStyle = muted; ['', 'words', 'opened', 'took up', 'open ?'].forEach((h, j) => x.fillText(h, cols[j], y)); y += U(16);
      sp.forEach(k => {
        const opened = TH.filter(t => t.opened_by === k).length, taken = TH.filter(t => t.opened_by !== k && (t.speakers || {})[k]).length, open = Q.filter(q => q.speaker === k && !q.answered_at).length;
        x.fillStyle = SPEAKER[k] || ink; x.fillText(k, cols[0], y); x.fillStyle = ink;
        [talk.airtime[k], opened, taken, open].forEach((v, j) => x.fillText(String(v), cols[j + 1], y)); y += U(16);
      });
      if (sp.length > 1) { x.fillStyle = muted; x.fillText(`${talk.turns} turns. ${talk.unpicked.length} threads one person opened that nobody else took up.`, U(12), y + U(4)); }
      say(sp.length > 1 ? 'The beam tips toward whoever has spoken most. Each weight is a speaker, sized by their share of the words. Beneath: what each has opened, taken up from the others, and asked without an answer yet.'
        : 'One speaker so far. Tap the speaker letter to switch to B or C when a conversation begins, and the balance shows the share of each.');
    }

    /* ── questions: every question as a mark, open until someone else answers ── */
    function questionsView() {
      const st = lastWith('steer'), Q = (st && st.talk && st.talk.questions) || []; if (!Q.length) return empty();
      const now = nowOf(), t0 = Math.min(...Q.map(q => q.at)) - 2, t1 = Math.max(now, ...Q.map(q => q.answered_at || q.at)) + 2;
      const left = U(16), right = W - U(16), y = H * .32, X = t => left + (t - t0) / Math.max(1, t1 - t0) * (right - left);
      x.strokeStyle = faint; x.lineWidth = dpr; x.beginPath(); x.moveTo(left, y); x.lineTo(right, y); x.stroke();
      const solo = ((st.talk || {}).speakers || []).length < 2;
      Q.forEach(q => {
        const qx = X(q.at), c = SPEAKER[q.speaker] || ink;
        font(16, '700'); x.fillStyle = c; x.textAlign = 'center'; x.textBaseline = 'bottom'; x.fillText('?', qx, y - U(4));
        if (q.answered_at) {
          const ax = X(q.answered_at); x.strokeStyle = SPEAKER[q.answered_by] || ink; x.lineWidth = U(1.4);
          x.beginPath(); x.moveTo(qx, y + U(6)); x.quadraticCurveTo((qx + ax) / 2, y + U(34), ax, y + U(6)); x.stroke();
          x.beginPath(); x.arc(ax, y + U(6), U(3), 0, 7); x.fillStyle = SPEAKER[q.answered_by] || ink; x.fill();
        } else {
          const beat = .5 + .5 * Math.sin(pulseT() * 2); x.strokeStyle = c; x.lineWidth = U(1.6); glowOn(c, U(4 + 6 * beat));
          x.beginPath(); x.arc(qx, y + U(14), U(6), -Math.PI / 2 + .5, Math.PI * 1.5 - .5); x.stroke(); glowOff();
        }
      });
      const open = Q.filter(q => !q.answered_at).slice(-5).reverse();
      let ty = y + U(56); font(10, '600'); x.textAlign = 'left'; x.textBaseline = 'top'; x.fillStyle = ink;
      x.fillText(solo ? `${open.length} questions put to the listener` : `${open.length} waiting for an answer`, left, ty); ty += U(18); font(10);
      open.forEach(q => { if (ty > H - U(16)) return; x.fillStyle = SPEAKER[q.speaker] || ink; x.fillText(q.speaker, left, ty); x.fillStyle = muted; x.fillText(fit(`${q.text}  ·  ${Math.max(0, Math.round((now - q.at) / 60))}m ago`, W - left * 2 - U(20)), left + U(18), ty); ty += U(16); });
      say(solo ? 'Each mark is a question put to the listener. In a conversation, a question stays open, a broken ring, until someone else answers, and then a line joins it to the answer.'
        : 'Each mark is a question, coloured by who asked it. It stays open, a broken ring, until someone else answers; then a line joins it to the answer, in the answerer\'s colour.');
    }

    /* ── links: this session among every recording before it, joined by the threads they share ── */
    function linksView() {
      const L = T.links; if (!L || !L.recordings || !L.recordings.length) return empty();
      const head = U(34), plotH = H - head - U(8), cx = W / 2, cy = head + plotH / 2, R0 = Math.min(W - U(40), plotH) * .4, recs = L.recordings.slice(0, 40);
      /* labels never collide, never leave the box, and never enter the header */
      const placed = [], label = (t, px, py, side, size = 8.5, col = muted) => {
        font(size); x.textBaseline = 'middle'; const w = x.measureText(t).width, h = U(size + 3), pad = U(4);
        let left = side === 'right' ? px : side === 'left' ? px - w : px - w / 2;
        if (left + w > W - pad) left = Math.max(pad, px - w - U(10)); if (left < pad) left = pad;
        for (const dy of [0, h, -h, 2 * h, -2 * h]) {
          const top = py + dy - h / 2; if (top < head || top + h > H - pad) continue;
          const r = [left, top, left + w, top + h];
          if (placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
          placed.push(r); x.fillStyle = col; x.textAlign = 'left'; x.fillText(t, left, py + dy); return true;
        }
        return false;
      };
      /* clusters sit together around the circle; within one, oldest first */
      const order = [...recs].sort((a, b) => String(a.cluster || 'z' + a.id).localeCompare(String(b.cluster || 'z' + b.id)) || (a.at || 0) - (b.at || 0));
      const toHere = {}; (L.edges || []).filter(e => e.from === 'here').forEach(e => toHere[e.to] = Math.max(toHere[e.to] || 0, e.strength));
      const pos = {};
      order.forEach((r, i) => { const a = -Math.PI / 2 + i / order.length * Math.PI * 2, s = toHere[r.id] || 0, rad = R0 * (1 - .45 * s);
        pos[r.id] = [ease('lx' + r.id, cx + rad * Math.cos(a), .08), ease('ly' + r.id, cy + rad * Math.sin(a), .08), a]; });
      pos.here = [cx, cy];
      /* the themes: a soft field behind each cluster, named */
      (L.clusters || []).forEach((k, ki) => {
        const ps = k.recordings.map(id => pos[id]).filter(Boolean); if (!ps.length) return;
        const mx = ps.reduce((a, p) => a + p[0], 0) / ps.length, my = ps.reduce((a, p) => a + p[1], 0) / ps.length;
        const rr = Math.max(U(26), ...ps.map(p => Math.hypot(p[0] - mx, p[1] - my))) + U(16);
        const g = x.createRadialGradient(mx, my, 0, mx, my, rr); g.addColorStop(0, 'rgba(57,255,20,.07)'); g.addColorStop(1, 'rgba(57,255,20,0)');
        x.fillStyle = g; x.beginPath(); x.arc(mx, my, rr, 0, 7); x.fill();
        if (k.theme) { font(9); label(fit(k.theme, U(140)), mx + (mx - cx) * .25, my + (my - cy) * .25, 'center', 9); }
      });
      /* recordings joined to each other, then to this session, as thick as the thread they share */
      (L.edges || []).forEach(e => {
        const a = pos[e.from], b = pos[e.to]; if (!a || !b) return;
        const here = e.from === 'here', beat = .5 + .5 * Math.sin(pulseT() * 2 + (b[2] || 0));
        x.strokeStyle = here ? amber : '#5ab4ff'; x.globalAlpha = here ? .35 + .5 * e.strength * (.7 + .3 * beat) : .18 + .3 * e.strength; x.lineWidth = U(here ? 1 + 3 * e.strength : .8 + 1.5 * e.strength);
        x.beginPath(); x.moveTo(a[0], a[1]); x.quadraticCurveTo((a[0] + b[0]) / 2 + (cy - (a[1] + b[1]) / 2) * .15, (a[1] + b[1]) / 2 + ((a[0] + b[0]) / 2 - cx) * .15, b[0], b[1]); x.stroke(); x.globalAlpha = 1;
      });
      hits = [];
      order.forEach(r => {
        const [px, py] = pos[r.id], s = toHere[r.id] || 0, size = U(5 + Math.min(7, (r.threads || 0) * 1.2)), c = r.kind ? T.color(r.kind) : '#5ab4ff';   // from another app: cool blue
        hex(px, py, size); x.fillStyle = c; x.globalAlpha = .25 + .6 * Math.max(s, .2); x.fill(); x.globalAlpha = 1; x.strokeStyle = s ? amber : c; x.lineWidth = U(s ? 1.6 : .8); x.stroke();
        if (s > .3 || order.length < 14) { const c2 = Math.cos(pos[r.id][2]); font(8.5);
          label(fit(r.title || '', U(110)), px + (c2 > .2 ? size + U(5) : c2 < -.2 ? -size - U(5) : 0), py + Math.sin(pos[r.id][2]) * (size + U(9)), c2 > .2 ? 'right' : c2 < -.2 ? 'left' : 'center', 8.5, s ? ink : muted); }
        hits.push({ x: px, y: py, r: Math.max(U(12), size + U(4)), id: 'rec:' + r.id });
      });
      /* this session at the centre, its threads a ring of beads */
      const cur = L.current || [], beat = .5 + .5 * Math.sin(pulseT() * 2.4);
      glowOn(amber, U(10 + 8 * beat)); hex(cx, cy, U(14)); x.fillStyle = 'rgba(255,201,74,.22)'; x.fill(); x.strokeStyle = amber; x.lineWidth = U(2); x.stroke(); glowOff();
      cur.forEach((c, i) => { const a = -Math.PI / 2 + i / Math.max(1, cur.length) * Math.PI * 2; x.fillStyle = c.matches.length ? amber : muted;
        x.beginPath(); x.arc(cx + U(22) * Math.cos(a), cy + U(22) * Math.sin(a), U(2.4), 0, 7); x.fill(); });
      placed.push([cx - U(16), cy - U(16), cx + U(16), cy + U(16)]); label('this session', cx, cy + U(30), 'center', 9.5, ink);
      font(9); x.fillStyle = muted; x.textAlign = 'left'; x.textBaseline = 'top';
      const toThis = new Set((L.edges || []).filter(e => e.from === 'here').map(e => e.to)).size;
      x.fillText(`${recs.length} recordings · ${toThis} linked to this session`, U(8), U(6));
      if ((L.waiting || []).length) { x.fillStyle = amber; x.fillText(fit(`waiting: ${L.waiting[0].title} (${L.waiting[0].count})`, W - U(16)), U(8), U(19)); }
      say('Each hexagon is an earlier recording; the amber hexagon is this session. Amber lines are threads this session shares with a recording, as thick as the likeness; blue lines join recordings to each other, and soft fields gather them into themes. Tap a recording to replay it at that thread.');
    }

    /* nothing to draw yet: the loop shows a preview instead, drawn from made-up speech and marked as such */
    function empty() { wasEmpty = true; }
    let said = '';
    function say(t) { if (t !== said) { said = t; if (note) note.textContent = t; } }

    function loop() {
      requestAnimationFrame(loop);
      if (view === 'now' || (!T && !P) || !canvas.getClientRects().length) return;
      if (x.isContextLost && x.isContextLost()) return;
      dpr = devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      W = w; H = h; x.clearRect(0, 0, W, H); hits = [];
      if (W < 40 * dpr || H < 40 * dpr) return;                            // too small to draw anything legible
      const draw = () => ({ river, window: windowView, build, shape, ideas, bars, lenses: lensesView, arc: arcView, threads: threadsView, pulse: pulseView, airtime: airtimeView, questions: questionsView, links: linksView })[view]();
      wasEmpty = false; if (T) draw(); else wasEmpty = true;
      if (wasEmpty && P) {
        /* a showcase of what this view will show: made-up speech, phrase by phrase, looping gently, marked "preview" */
        const keep = T, n = P.phrases.length, k = Math.max(2, Math.min(n, 2 + Math.floor((performance.now() / 1600) % (n + 3))));
        T = { ...P, focus: null, phrases: P.phrases.slice(0, k), now: (P.phrases[k - 1] || {}).at };
        x.clearRect(0, 0, W, H); hits = []; draw(); hits = []; T = keep;
        font(8.5, '600'); const t = 'PREVIEW', tw = x.measureText(t).width;
        x.fillStyle = 'rgba(0,0,0,.75)'; x.fillRect(W - tw - U(16), U(4), tw + U(12), U(15)); x.strokeStyle = amber; x.lineWidth = dpr; x.strokeRect(W - tw - U(16), U(4), tw + U(12), U(15));
        x.fillStyle = amber; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(t, W - tw - U(10), U(11.5));
      }
      if (previewing !== (wasEmpty && !!P)) { previewing = wasEmpty && !!P; canvas.style.opacity = previewing ? .55 : ''; }
    }
    requestAnimationFrame(loop);
    return { set(t) { T = t; }, setPreview(p) { P = p; }, setView(v) { view = v; }, get view() { return view; }, canvas };
  }

  /* the classifier screen: one renderer, and (if a bar is given) a row of view icons */
  function mount({ bar, canvas, note, onView, onPick, start = 'now' }) {
    const r = renderer(canvas, { note, onPick, start });
    const set = v => { r.setView(v); if (bar) bar.querySelectorAll('.vchip').forEach(b => b.classList.toggle('on', b.dataset.v === v)); onView && onView(v); };
    if (bar) {
      bar.innerHTML = VIEWS.map(([k, svg]) => `<button class="vchip" data-v="${k}" title="${k}" aria-label="${k}"><svg viewBox="0 0 24 24">${svg}</svg></button>`).join('');
      bar.querySelectorAll('.vchip').forEach(b => b.onclick = () => set(b.dataset.v));
    }
    set(start);
    return { set: t => r.set(t), setView: set, get view() { return r.view; } };
  }

  /* every graph at once, over the whole window */
  const GRID = ['bars', 'river', 'window', 'build', 'shape', 'ideas'];
  /* the depth and steering views, together */
  const STEER = ['lenses', 'arc', 'threads', 'pulse', 'airtime', 'questions', 'links'];
  function grid(host, { onPick, views = GRID, scale = 1 } = {}) {
    host.classList.add('vgrid');
    host.innerHTML = views.map(v => `<div class="vcell" data-v="${v}"><div class="vcap"><svg viewBox="0 0 24 24">${ICON[v]}</svg><span>${v}</span></div><canvas></canvas></div>`).join('');
    const rs = [...host.querySelectorAll('canvas')].map((c, i) => renderer(c, { start: views[i], onPick, scale }));
    return { set: t => rs.forEach(r => r.set(t)), setPreview: p => rs.forEach(r => r.setPreview(p)) };
  }
  let board = null;
  function dashboard({ onPick } = {}) {
    if (board) return board;
    const el = document.createElement('div'); el.className = 'vboard'; el.hidden = true;
    el.innerHTML = `<button class="vclose" title="close" aria-label="close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button><div class="vboardgrid"></div>`;
    document.body.appendChild(el);
    const g = grid(el.querySelector('.vboardgrid'), { onPick });
    el.querySelector('.vclose').onclick = () => { el.hidden = true; };
    board = { open() { el.hidden = false; }, close() { el.hidden = true; }, set: g.set, get isOpen() { return !el.hidden; } };
    return board;
  }
  const css = `.vgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px}
.vcell{display:flex;flex-direction:column;min-height:300px;border:2px solid var(--green-dim,rgba(57,255,20,.35));border-radius:14px;background:var(--panel,#070907);padding:8px 10px}
.vcell canvas{flex:1;min-height:0;width:100%;display:block}
.vcap{display:flex;align-items:center;gap:6px;color:var(--green,#39ff14);font:10.5px ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px}
.vcap svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.vboard{position:fixed;inset:0;z-index:18;background:rgba(0,0,0,.92);padding:16px;overflow:auto}
.vboard[hidden]{display:none}
.vboardgrid{grid-template-columns:repeat(auto-fit,minmax(max(340px,31%),1fr));grid-auto-rows:minmax(300px,calc((100vh - 60px)/2))}
.vclose{position:fixed;top:12px;right:14px;z-index:19;width:36px;height:36px;border:none;background:none;color:var(--ink,#e8f5e4);cursor:pointer}
.vclose svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8}`;
  if (typeof document !== 'undefined') { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }

  /* every screen is an icon in the top row: the transcript, the classifier's seven views, memory and the deck,
     and a last icon that opens every graph at once */
  const SCREENS = [['transcript', 0], ['now', 1], ['bars', 1], ['river', 1], ['window', 1], ['build', 1], ['shape', 1], ['ideas', 1], ['memory', 2], ['cards', 3]];
  function screens(host, { go, setView, openAll }) {
    let cur = 'transcript';
    host.innerHTML = SCREENS.map(([k]) => `<button class="tool" data-s="${k}" title="${k}" aria-label="${k}"><svg viewBox="0 0 24 24">${ICON[k]}</svg></button>`).join('') +
      `<button class="tool" data-all title="every graph at once" aria-label="every graph at once"><svg viewBox="0 0 24 24">${ICON.all}</svg></button>`;
    const paint = () => host.querySelectorAll('[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === cur));
    const show = name => { const sc = SCREENS.find(x => x[0] === name) || SCREENS[0]; cur = sc[0]; if (sc[1] === 1) setView(sc[0]); go(sc[1], true); paint(); };
    host.querySelectorAll('[data-s]').forEach(b => b.onclick = () => show(b.dataset.s));
    host.querySelector('[data-all]').onclick = openAll;
    paint();
    return { show, step(d) { const i = SCREENS.findIndex(x => x[0] === cur); show(SCREENS[Math.max(0, Math.min(SCREENS.length - 1, i + d))][0]); },
      sync(page, view) { cur = page === 1 ? view : (SCREENS.find(x => x[1] === page) || SCREENS[0])[0]; paint(); }, get current() { return cur; } };
  }

  root.SpeechformViews = { mount, renderer, LOOKS: [['image', 'the image'], ['bars', 'shares'], ['river', 'river'], ['window', 'window'], ['build', 'build'], ['shape', 'shape'], ['ideas', 'ideas'],
    ['lenses', 'lenses'], ['arc', 'arc'], ['threads', 'threads'], ['pulse', 'pulse'], ['airtime', 'speakers'], ['questions', 'questions'], ['links', 'links'], ['all', 'all at once']], grid, dashboard, screens, ICON, SCREENS, VIEWS: VIEWS.map(v => v[0]), STEER, GRID, SPEAKER, STATE, STATE_WORD };
})(this);
