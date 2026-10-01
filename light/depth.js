/* Speechform: depth. The three lenses on a kind of speech, read from the words by algorithm alone.
 *
 * lenses.json (at the top of the repo, shared with depth.py) asks three questions of each of the nineteen kinds:
 *   listener    what must the audience know or bring to appreciate listening to it
 *   speaker     what must the speaker know to deliver its meaning (the moral, the takeaway, the claim, the turn)
 *   absorption  which elements of the act, and of the choice of material, most draw a listener in
 * Each lens has a short answer and a handful of elements, and every element has a cue that can be found in a
 * transcript: a pattern of words (counted; "need" hits make a full mark) and/or a structural signal (full at "at").
 *
 * The window is the classifier's: the phrases a phrase is heard with, each with its share of the verdict. Word cues
 * are counted phrase by phrase and weighted by that share; the structural signals are read over the whole window.
 * depth.py is the same algorithm, line for line. Jev is never asked while anyone speaks.
 *
 *   SpeechformDepth.ready.then(...)               the lenses are loaded (in node they load at once)
 *   SpeechformDepth.reading([[text, w], ...], [lead, ...near])
 *   SpeechformDepth.passage(text, kinds)          any stretch of text, every phrase counting the same
 *   SpeechformDepth.nearKinds(lead, settledRanked)
 */
(function (root) {
  'use strict';
  const ORDER = ['listener', 'speaker', 'absorption'];
  const FOUND = .5;
  let LENSES = null, LEX = {};
  const compiled = {};
  const rx = p => compiled[p] || (compiled[p] = new RegExp(p, 'gi'));
  const clip = v => Math.max(0, Math.min(1, v));
  const norm = t => String(t ?? '').replace(/’|‘/g, "'").replace(/“|”/g, '"');
  const uniq = a => [...new Set(a)];
  const sentences = t => t.split(/[.!?;]+|\n/).map(s => s.trim()).filter(Boolean);
  const words = t => t.match(/[a-z']+/g) || [];
  const r3 = v => Math.round(v * 1000) / 1000;

  function use(data) {
    LENSES = data; LEX = {};
    for (const [k, v] of Object.entries(data.lexicon || {})) LEX[k] = new Set(v);
    return data;
  }

  /* how a passage is built, each a rate from 0 to 1, with the words that show it */
  function features(text) {
    const t = norm(text), low = t.toLowerCase(), W = words(low), n = Math.max(W.length, 1);
    const sents = sentences(t), ns = Math.max(sents.length, 1);
    const lens = sents.map(s => words(s.toLowerCase()).length).filter(Boolean);
    const f = {}, ev = {};
    const rate = (name, lex, scale) => { const hit = W.filter(w => LEX[lex].has(w)); f[name] = clip(hit.length / n * scale); ev[name] = uniq(hit).slice(0, 6); };
    rate('you', 'you', 12); rate('we', 'we', 12); rate('i', 'i', 10); rate('third', 'third', 12);
    rate('sensory', 'sensory', 10); rate('present', 'present', 8); rate('numbers', 'numbers', 10);
    const past = W.filter(w => LEX.past.has(w) || (w.endsWith('ed') && w.length > 4));
    f.past = clip(past.length / n * 8); ev.past = uniq(past).slice(0, 6);
    const firsts = sents.map(s => (words(s.toLowerCase())[0]) || '');
    const imp = firsts.filter(w => LEX.imperative.has(w));
    f.imperative = clip(imp.length / ns * 1.4); ev.imperative = uniq(imp).slice(0, 6);
    const q = (t.match(/\?/g) || []).length;
    f.question = clip(q / ns * 1.5); ev.question = (t.match(/[^.!?]*\?/g) || []).map(x => x.trim().slice(-48)).slice(0, 4);
    const joins = (low.match(/ and /g) || []).length + (low.match(/,/g) || []).length;
    f.runon = clip(joins / ns / 5); ev.runon = joins ? [`${joins} joins in ${sents.length} sentences`] : [];
    const grams = []; for (let i = 0; i + 2 < W.length; i++) grams.push(W.slice(i, i + 3).join(' '));
    const rep = grams.length ? 1 - new Set(grams).size / grams.length : 0;
    f.refrain = clip(rep * 3);
    const seen = new Set(), again = [];
    for (const g of grams) { if (seen.has(g) && !again.includes(g)) again.push(g); seen.add(g); }
    ev.refrain = again.slice(0, 4);
    const opens = sents.map(s => words(s.toLowerCase()).slice(0, 2).join(' ')).filter(o => o.split(' ').length === 2);
    const dup = opens.filter(o => opens.filter(x => x === o).length > 1);
    f.anaphora = clip(dup.length / ns * 1.5); ev.anaphora = uniq(dup).slice(0, 4);
    const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    f.short = lens.length ? clip((8 - avg) / 6) : 0;
    f.long = lens.length ? clip((avg - 14) / 12) : 0;
    ev.short = ev.long = lens.length ? [`${Math.round(avg)} words a sentence`] : [];
    if (lens.length >= 3) {
      const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
      const sd = Math.sqrt(lens.reduce((a, x) => a + (x - mean) ** 2, 0) / lens.length);
      f.rhythm = clip(1 - sd / Math.max(mean, 1) * 1.5);
      ev.rhythm = ['sentences of ' + lens.slice(0, 6).join(', ') + ' words'];
    } else { f.rhythm = 0; ev.rhythm = []; }
    const names = [];
    for (const s of sents) {
      const toks = s.match(/[A-Za-z][a-z']+/g) || [];
      for (const w of toks.slice(1)) if (w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() && !LEX.notnames.has(w.toLowerCase())) names.push(w);
    }
    f.names = clip(new Set(names).size / 3); ev.names = uniq(names).slice(0, 6);
    const content = W.filter(w => w.length > 3 && !LEX.stop.has(w));
    const pairs = []; for (let i = 0; i + 1 < content.length; i++) pairs.push([content[i], content[i + 1]]);
    const allit = pairs.filter(([a, b]) => a[0] === b[0] && a !== b).map(([a, b]) => a + ' ' + b);
    f.alliteration = clip(allit.length / Math.max(pairs.length, 1) * 4); ev.alliteration = allit.slice(0, 4);
    const said = low.match(/\b(said|asked|replied|answered|cried|whispered)\b/g) || [];
    const quotes = Math.floor((t.match(/"/g) || []).length / 2) + said.length;
    f.quote = clip(quotes / 2); ev.quote = said.slice(0, 4);
    return [f, ev];
  }

  /* one element's score over the window, and the words that earned it */
  function element(el, win, feats) {
    const cue = el.cue || {};
    let score = 0, evidence = [];
    if (cue.re) {
      const re = rx(cue.re), top = Math.max(...win.map(x => x[1]), 0) || 1;
      let hits = 0;
      for (const [text, w] of win) {
        const found = norm(text).match(re) || [];
        hits += found.length * (w / top);
        evidence.push(...found.map(x => x.trim()));
      }
      score = clip(hits / (+cue.need || 2));
    }
    if (cue.signal) {
      const v = feats[0][cue.signal] || 0, s = clip(v / (+cue.at || 1));
      if (s > score) score = s;
      if (s > 0) evidence.push(...(feats[1][cue.signal] || []));
    }
    return [r3(score), uniq(evidence.filter(Boolean).map(e => e.toLowerCase())).slice(0, 6)];
  }

  /* the three lenses of one kind over a window [[text, weight]] */
  function lensReading(kind, win, feats) {
    feats = feats || features(win.map(x => x[0]).join(' '));
    const spec = LENSES.kinds[kind], out = {};
    for (const lens of ORDER) {
      let total = 0, wsum = 0; const els = [];
      for (const el of spec[lens].elements) {
        const [s, ev] = element(el, win, feats), wt = +(el.weight ?? 1);
        total += wt * s; wsum += wt;
        els.push({ id: el.id, name: el.name, score: s, found: s >= FOUND, evidence: ev, weight: wt });
      }
      out[lens] = { meter: r3(wsum ? total / wsum : 0), elements: els };
    }
    return out;
  }

  /* the strongest missing element: in the weakest lens, the heaviest element not yet found */
  function nextStep(kind, lenses) {
    const spec = LENSES.kinds[kind]; let best = null;
    for (const lens of [...ORDER].sort((a, b) => lenses[a].meter - lenses[b].meter)) {
      spec[lens].elements.forEach((el, i) => {
        const got = lenses[lens].elements[i]; if (got.found) return;
        const gain = +(el.weight ?? 1) * (1 - got.score);
        if (!best || gain > best[0] + 1e-9) best = [gain, lens, el];
      });
      if (best) break;
    }
    if (!best) return null;
    const [, lens, el] = best;
    return { lens, id: el.id, name: el.name, meaning: el.meaning, try: el.try || '' };
  }

  /* the depth of the talk: full detail for the lead kind, the meters for any near-tied kinds */
  function reading(win, kinds) {
    if (!LENSES) return null;
    kinds = uniq(kinds || []).filter(k => LENSES.kinds[k]);
    win = (win || []).filter(x => x[0] && String(x[0]).trim()).map(x => [x[0], +x[1]]);
    if (!kinds.length || !win.length) return null;
    const feats = features(win.map(x => x[0]).join(' ')), lead = kinds[0];
    const lenses = lensReading(lead, win, feats), near = {};
    for (const k of kinds.slice(1, 3)) { const r = lensReading(k, win, feats); near[k] = Object.fromEntries(ORDER.map(l => [l, r[l].meter])); }
    return { kind: lead, lenses, near, next: nextStep(lead, lenses), words: win.reduce((a, x) => a + x[0].split(/\s+/).filter(Boolean).length, 0) };
  }
  /* any stretch of text read on its own, every phrase counting the same */
  function passage(text, kinds) {
    const parts = norm(text).split(/(?<=[.!?;])\s+|\n+/).map(x => x.trim()).filter(Boolean);
    return reading(parts.map(p => [p, 1]), kinds);
  }
  /* the kinds whose running share sits within a tenth of the lead's */
  function nearKinds(lead, settled, within = .1, most = 2) {
    const m = Object.fromEntries(settled || []); const top = lead in m ? m[lead] : Math.max(0, ...Object.values(m));
    return [lead, ...[...(settled || [])].sort((a, b) => b[1] - a[1]).filter(([k, v]) => k !== lead && v >= top - within).slice(0, most).map(x => x[0])];
  }
  /* each phrase's three meters, in order */
  function overTime(phrases) {
    return (phrases || []).map(p => p.depth && { at: p.at, kind: p.depth.kind, ...Object.fromEntries(ORDER.map(l => [l, p.depth.lenses[l].meter])) }).filter(Boolean);
  }
  /* the depth reading as a short record for a card */
  function summary(d) {
    if (!d) return null;
    return { kind: d.kind, ...Object.fromEntries(ORDER.map(l => [l, d.lenses[l].meter])),
      found: Object.fromEntries(ORDER.map(l => [l, d.lenses[l].elements.filter(e => e.found).map(e => e.id)])), next: d.next };
  }
  /* the lens questions and answers for a kind, and one element's whole entry */
  const spec = kind => LENSES && LENSES.kinds[kind];
  const elementOf = (kind, id) => { const s = spec(kind); if (!s) return null; for (const l of ORDER) { const e = s[l].elements.find(x => x.id === id); if (e) return { ...e, lens: l }; } return null; };

  const api = { ORDER, FOUND, features, reading, passage, nearKinds, overTime, summary, spec, element: elementOf, use, get lenses() { return LENSES; } };
  if (typeof module !== 'undefined' && module.exports) {
    use(require('../lenses.json'));
    api.ready = Promise.resolve(LENSES);
    module.exports = api;
  } else {
    /* lenses.json sits one folder above this script, wherever the page is served from */
    const here = (document.currentScript && document.currentScript.src) || location.href;
    api.ready = fetch(new URL('../lenses.json', here), { cache: 'no-cache' }).then(r => r.json()).then(use).catch(() => null);
    root.SpeechformDepth = api;
  }
})(this);
