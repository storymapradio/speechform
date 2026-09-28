/* Speechform: the reading of a whole recording, and the card it becomes.
 *
 * It takes the same phrases the classifier views draw (each with its ranked scores, its shape
 * signals and its idea) and weighs the recording at three scales:
 *   the phrases, as they were heard;
 *   the sections: each run of one idea, and a window of about fifty words sliding along;
 *   the whole recording, every phrase counted by its words.
 * Each gets a share for every kind of speech and an average shape. The card is written from it.
 */
(function (root) {
  'use strict';
  const IMAGE = {
    'instruction': 'stack', 'lecture': 'stack', 'lesson': 'stack', 'dialogue': 'tide',
    'reflective monologue': 'kelp', 'thinking aloud': 'kelp', 'stream of consciousness': 'kelp',
    'reading aloud': 'path', 'story': 'path', 'character development': 'path', 'song': 'waves', 'lyrics': 'waves',
    'poetry': 'bloom', 'scenery': 'land', 'lore': 'hive', 'myth': 'hive', 'cosmology': 'orrery',
    'mystery': 'rings', 'argument': 'rings',
  };
  const words = t => (String(t || '').match(/\S+/g) || []).length;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round50 = v => Math.round(v / 50) * 50;

  /* one phrase's scores as shares: the kinds above its sixth-best score, summing to one */
  function shares(p) {
    const r = p.ranked || []; if (!r.length) return {};
    const floor = r[Math.min(5, r.length - 1)][1], out = {}; let sum = 0;
    for (const [k, v] of r) { const s = Math.max(0, v - floor); if (s > 0) { out[k] = s; sum += s; } }
    for (const k in out) out[k] /= sum || 1;
    return out;
  }
  /* a stretch of phrases, weighed by their words */
  function weigh(ps) {
    const prof = {}, sig = {}; let total = 0;
    for (const p of ps) {
      const n = words(p.text); total += n;
      const s = shares(p); for (const k in s) prof[k] = (prof[k] || 0) + s[k] * n;
      for (const k in p.signals || {}) sig[k] = (sig[k] || 0) + (p.signals[k] || 0) * n;
    }
    for (const k in prof) prof[k] /= total || 1;
    for (const k in sig) sig[k] /= total || 1;
    const profile = Object.entries(prof).sort((a, b) => b[1] - a[1]);
    return { words: total, profile, signals: sig, top: profile[0] ? profile[0][0] : null };
  }

  function read(phrases, ideas) {
    const P = phrases.filter(p => p.ranked && p.ranked.length);
    if (!P.length) return null;
    const whole = weigh(P);
    const byId = Object.fromEntries((ideas || []).map(i => [i.id, i]));
    /* the sections: each run of one idea */
    const runs = [];
    P.forEach((p, i) => {
      const last = runs[runs.length - 1];
      if (last && last.idea === p.idea) last.phrases.push(p);
      else runs.push({ idea: p.idea, phrases: [p], at: i });
    });
    const sections = runs.map(r => ({ by: 'idea', idea: r.idea, title: (byId[r.idea] || {}).title || '', from: r.at, to: r.at + r.phrases.length - 1,
      text: r.phrases.map(p => p.text).join(' '), ...weigh(r.phrases) }));
    /* and a window of about fifty words, sliding half its length at a time */
    const windows = []; let i = 0;
    while (i < P.length) {
      let j = i, n = 0; while (j < P.length && (n < 50 || j === i)) { n += words(P[j].text); j++; }
      windows.push({ by: 'window', from: i, to: j - 1, text: P.slice(i, j).map(p => p.text).join(' '), ...weigh(P.slice(i, j)) });
      if (j >= P.length) break;
      let k = i, half = 0; while (k < j - 1 && half < 25) { half += words(P[k].text); k++; }
      i = Math.max(i + 1, k);
    }
    /* movement, clarity and ideas */
    let switches = 0, stays = 0, margins = 0, tops = 0;
    P.forEach((p, i) => {
      if (i && p.kind !== P[i - 1].kind) switches++;
      if (i && p.idea === P[i - 1].idea) stays++;
      margins += p.ranked[0][1] - (p.ranked[1] ? p.ranked[1][1] : 0); tops += Math.abs(p.ranked[0][1]) || 1e-6;
    });
    const used = [...new Set(P.map(p => p.idea))];
    const ideaWords = {}; P.forEach(p => ideaWords[p.idea] = (ideaWords[p.idea] || 0) + words(p.text));
    const returns = {}; P.forEach((p, i) => { if (i && p.idea !== P[i - 1].idea && P.slice(0, i).some(q => q.idea === p.idea)) returns[p.idea] = (returns[p.idea] || 0) + 1; });
    const strongest = P.reduce((b, p) => { const m = p.ranked[0][1] - (p.ranked[1] ? p.ranked[1][1] : 0); return m > b.m ? { m, p } : b; }, { m: -1e9, p: P[0] }).p;
    return {
      at: Date.now() / 1000, phrases: P.length, words: whole.words, profile: whole.profile, signals: whole.signals,
      kinds: P.map(p => p.kind), switches, clarity: clamp(margins / tops * 2, 0, 1), continuity: P.length > 1 ? stays / (P.length - 1) : 1,
      ideas: used.map(id => ({ id, title: (byId[id] || {}).title || '', words: ideaWords[id], returns: returns[id] || 0 })).sort((a, b) => b.words - a.words),
      sections, windows, strongest: { id: strongest.id, text: strongest.text, kind: strongest.kind },
      first: P[0].kind, last: P[P.length - 1].kind,
    };
  }

  /* the card: a name, a type, a level, two numbers, a rarity, and what it does, all from the reading */
  const TIMES = n => n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times';
  const titleCase = t => String(t || '').toLowerCase().replace(/(^|\s)[a-z]/g, c => c.toUpperCase());
  function card(r, past) {
    const [k1, p1] = r.profile[0] || ['thinking aloud', 1], [k2, p2] = r.profile[1] || [null, 0];
    const main = r.ideas[0] || { title: 'A new thought', returns: 0 };
    const focus = round50(3000 * (.6 * r.clarity + .4 * (1 - r.switches / Math.max(1, r.phrases - 1))));
    const returns = r.ideas.reduce((a, i) => a + i.returns, 0);
    const hold = round50(3000 * (.6 * r.continuity + .4 * clamp(returns / Math.max(1, r.ideas.length), 0, 1)));
    const level = clamp(1 + Math.floor(r.words / 60) + Math.floor(r.ideas.length / 2), 1, 12);
    /* rarity: how far this recording's profile sits from the cards before it */
    let rarity = 'common', distance = null;
    if (past && past.length) {
      const avg = {}; past.forEach(c => (c.profile || []).forEach(([k, v]) => avg[k] = (avg[k] || 0) + v / past.length));
      const mine = Object.fromEntries(r.profile), keys = new Set([...Object.keys(avg), ...Object.keys(mine)]);
      let dot = 0, a = 0, b = 0; keys.forEach(k => { dot += (avg[k] || 0) * (mine[k] || 0); a += (avg[k] || 0) ** 2; b += (mine[k] || 0) ** 2; });
      distance = 1 - dot / (Math.sqrt(a * b) || 1);
      rarity = distance < .15 ? 'common' : distance < .3 ? 'rare' : distance < .5 ? 'super rare' : 'ultra rare';
    } else rarity = 'rare';
    const pct = v => Math.round(v * 100) + '%';
    const effect = [k2 && p2 > .08 ? `It is mostly ${k1} (${pct(p1)}), with ${k2} (${pct(p2)}).` : `It is ${k1} through and through (${pct(p1)}).`];
    if (r.first !== r.last) effect.push(`It turns from ${r.first} to ${r.last}.`);
    else if (r.switches) effect.push(`It wanders ${TIMES(r.switches)} and comes home to ${r.last}.`);
    const back = [...r.ideas].sort((a, b) => b.returns - a.returns)[0];
    if (back && back.returns) effect.push(`It returns to "${back.title}" ${TIMES(back.returns)}.`);
    effect.push(`It holds ${r.ideas.length === 1 ? 'one idea' : r.ideas.length + ' ideas'} across ${r.words} words.`);
    return {
      name: titleCase(main.title), register: IMAGE[k1] || 'kelp', kind: k1, second: k2, level, focus, hold, rarity, distance,
      effect, profile: r.profile, strongest: r.strongest, at: r.at,
    };
  }

  /* drawing a card on a canvas, so it can be shown, flipped and saved as an image */
  const COLORS = { bloom: '#d77cff', path: '#ffc25a', land: '#8fd0dc', hive: '#b8ff5a', orrery: '#a9b8ff', rings: '#5af0f0', stack: '#9dffb4', kelp: '#5affa8', tide: '#7fa8ff', waves: '#ff9ae0' };
  const FOIL = { common: null, rare: '#39ff14', 'super rare': '#ffc94a', 'ultra rare': 'rainbow' };
  function wrap(x, text, w) {
    const out = []; let line = '';
    for (const word of String(text).split(/\s+/)) { const t = line ? line + ' ' + word : word; if (x.measureText(t).width > w && line) { out.push(line); line = word; } else line = t; }
    if (line) out.push(line); return out;
  }
  function drawCard(canvas, c, art, side = 'front', t = 0) {
    const W = canvas.width = 600, H = canvas.height = 870, x = canvas.getContext('2d'), hue = COLORS[c.register] || '#39ff14';
    const font = (s, w = '') => x.font = `${w} ${s}px ui-monospace, "SF Mono", Menlo, monospace`;
    const rr = (X, Y, w, h, r) => { x.beginPath(); x.roundRect(X, Y, w, h, r); };
    x.fillStyle = '#050805'; rr(0, 0, W, H, 34); x.fill();
    /* the frame: the image's colour, and a foil for the rarer cards */
    const foil = FOIL[c.rarity];
    let edge = hue;
    if (foil === 'rainbow') { const g = x.createLinearGradient(0, 0, W, H); ['#ff5a8a', '#ffc94a', '#39ff14', '#5af0f0', '#a9b8ff', '#d77cff'].forEach((q, i) => g.addColorStop((i / 5 + t * .1) % 1, q)); edge = g; }
    else if (foil) edge = foil;
    x.lineWidth = 10; x.strokeStyle = edge; rr(8, 8, W - 16, H - 16, 28); x.stroke();
    x.lineWidth = 2; x.strokeStyle = hue; x.globalAlpha = .5; rr(22, 22, W - 44, H - 44, 20); x.stroke(); x.globalAlpha = 1;
    const img = side === 'front' ? (art.clear || art.abstract) : art.abstract;
    if (side === 'front') {
      font(30, '700'); x.fillStyle = '#e8f5e4'; x.textBaseline = 'middle';
      const name = wrap(x, c.name, 400)[0]; x.fillText(name, 40, 62);
      /* the level, as hexagons */
      for (let i = 0; i < c.level; i++) {
        const cx = W - 44 - (i % 6) * 17, cy = 54 + Math.floor(i / 6) * 17; x.beginPath();
        for (let k = 0; k < 7; k++) { const a = Math.PI / 3 * k + Math.PI / 6; x.lineTo(cx + 7 * Math.cos(a), cy + 7 * Math.sin(a)); }
        x.fillStyle = '#ffc94a'; x.fill();
      }
      /* the art */
      x.save(); rr(40, 100, W - 80, W - 80, 14); x.clip();
      x.fillStyle = '#000'; x.fillRect(40, 100, W - 80, W - 80);
      if (img) x.drawImage(img, 40, 100, W - 80, W - 80);
      else { font(16); x.fillStyle = '#7d9a78'; x.textAlign = 'center'; x.fillText('drawing…', W / 2, 100 + (W - 80) / 2); x.textAlign = 'left'; }
      x.restore(); x.lineWidth = 2; x.strokeStyle = hue; rr(40, 100, W - 80, W - 80, 14); x.stroke();
      /* the type line */
      let y = 100 + W - 80 + 30;
      font(17, '700'); x.fillStyle = hue; x.fillText(c.register.toUpperCase(), 40, y);
      font(15); x.fillStyle = '#7d9a78'; x.fillText(' · ' + c.kind + (c.second ? ' / ' + c.second : ''), 40 + x.measureText(c.register.toUpperCase()).width + 8, y);
      font(13); x.textAlign = 'right'; x.fillStyle = foil === 'rainbow' ? '#ff9ae0' : foil || '#7d9a78'; x.fillText(c.rarity.toUpperCase(), W - 40, y); x.textAlign = 'left';
      /* the river strip: each kind's share, as the card's own barcode */
      y += 20; let sx = 40; const sw = W - 80;
      (c.profile || []).forEach(([k, v]) => { x.fillStyle = COLORS[IMAGE[k]] || '#555'; x.fillRect(sx, y, sw * v, 8); sx += sw * v; });
      /* what it does */
      y += 34; font(15.5); x.fillStyle = '#e8f5e4';
      for (const line of wrap(x, c.effect.join(' '), W - 80).slice(0, 5)) { x.fillText(line, 40, y); y += 22; }
      /* the two numbers */
      font(19, '700'); x.textAlign = 'right'; x.fillStyle = '#e8f5e4';
      x.fillText(`FOCUS ${c.focus}  /  HOLD ${c.hold}`, W - 40, H - 48); x.textAlign = 'left';
    } else {
      /* the back: the image the talk grew, and the whole reading */
      x.save(); rr(40, 40, W - 80, W - 80, 14); x.clip(); x.fillStyle = '#000'; x.fillRect(40, 40, W - 80, W - 80);
      if (art.abstract) x.drawImage(art.abstract, 40, 40, W - 80, W - 80);
      x.restore(); x.lineWidth = 2; x.strokeStyle = hue; rr(40, 40, W - 80, W - 80, 14); x.stroke();
      let y = W - 40 + 28; font(13); x.textBaseline = 'middle';
      (c.profile || []).slice(0, 6).forEach(([k, v]) => {
        x.fillStyle = '#7d9a78'; x.fillText(k, 40, y);
        x.fillStyle = '#0d130c'; x.fillRect(250, y - 5, W - 330, 10);
        x.fillStyle = COLORS[IMAGE[k]] || '#555'; x.fillRect(250, y - 5, (W - 330) * v, 10);
        x.fillStyle = '#e8f5e4'; x.textAlign = 'right'; x.fillText(Math.round(v * 100) + '%', W - 40, y); x.textAlign = 'left';
        y += 21;
      });
      if (c.jev && c.jev.kind) { y += 6; font(13.5); x.fillStyle = '#ffc94a'; x.fillText(`Jev reads it as ${c.jev.kind} (${Math.round((c.jev.confidence || 0) * 100)}% sure).`, 40, y); y += 20; }
      if (c.jev && c.jev.style) { font(13.5); x.fillStyle = '#ffc94a'; x.fillText(`Jev chose the ${c.jev.style} style.`, 40, y); y += 20; }
      /* the clearest moment: the phrase the classifier was surest of */
      if (c.strongest && c.strongest.text) {
        y += 12; font(12); x.fillStyle = '#7d9a78'; x.fillText(`The clearest moment, heard as ${c.strongest.kind}:`, 40, y); y += 22;
        font(14.5); x.fillStyle = '#e8f5e4';
        for (const line of wrap(x, '"' + c.strongest.text + '"', W - 80).slice(0, Math.max(1, Math.floor((H - 60 - y) / 21)))) { x.fillText(line, 40, y); y += 21; }
      }
    }
  }

  const api = { read, card, drawCard, shares, weigh, IMAGE, COLORS };
  if (typeof module !== 'undefined') module.exports = api; else root.SpeechformReading = api;
})(this);
