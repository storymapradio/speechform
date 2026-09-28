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
  };
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
  function renderer(canvas, { note, onPick, start = 'now' } = {}) {
    let view = start, T = null, dpr = 1, W = 0, H = 0, hits = [], born = {}, eased = {};
    let x = canvas.getContext('2d');
    canvas.addEventListener('click', ev => {
      const r = canvas.getBoundingClientRect(), px = (ev.clientX - r.left) * dpr, py = (ev.clientY - r.top) * dpr;
      const h = hits.find(h => (px - h.x) ** 2 + (py - h.y) ** 2 < h.r * h.r);
      if (h && onPick) onPick(h.id);
    });

    const focus = () => T && (T.phrases.find(p => p.id === T.focus) || T.phrases[T.phrases.length - 1]);
    const ease = (key, target, k = .14) => (eased[key] = lerp(eased[key] ?? target, target, k));
    const age = id => { if (!(id in born)) born[id] = performance.now(); return clamp((performance.now() - born[id]) / 700, 0, 1); };
    const font = (s, w = '') => x.font = `${w} ${s * dpr}px ui-monospace, "SF Mono", Menlo, monospace`;
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

    function empty() { font(11); x.fillStyle = muted; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('The views fill as you speak.', W / 2, H / 2); say(''); }
    let said = '';
    function say(t) { if (t !== said) { said = t; if (note) note.textContent = t; } }

    function loop() {
      requestAnimationFrame(loop);
      if (view === 'now' || !T || !canvas.getClientRects().length) return;
      if (x.isContextLost && x.isContextLost()) return;
      dpr = devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      W = w; H = h; x.clearRect(0, 0, W, H); hits = [];
      ({ river, window: windowView, build, shape, ideas, bars })[view]();
    }
    requestAnimationFrame(loop);
    return { set(t) { T = t; }, setView(v) { view = v; }, get view() { return view; }, canvas };
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
  function grid(host, { onPick } = {}) {
    host.classList.add('vgrid');
    host.innerHTML = GRID.map(v => `<div class="vcell"><div class="vcap"><svg viewBox="0 0 24 24">${ICON[v]}</svg><span>${v}</span></div><canvas></canvas></div>`).join('');
    const rs = [...host.querySelectorAll('canvas')].map((c, i) => renderer(c, { start: GRID[i], onPick }));
    return { set: t => rs.forEach(r => r.set(t)) };
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

  root.SpeechformViews = { mount, renderer, grid, dashboard, screens, ICON, SCREENS, VIEWS: VIEWS.map(v => v[0]) };
})(this);
