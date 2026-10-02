/* Speechform Studio, wherever it is opened: with the Speechform server on this Mac, or entirely in the browser.
 *
 *   mac    the page is served by the Speechform server itself (127.0.0.1:9990/studio/): nothing to do
 *   full   the page is elsewhere (asynchronousinstruments.com/speechform/) and the server on this Mac answers:
 *          every call Studio makes goes to http://127.0.0.1:9990, exactly as on the Mac
 *   web    no server: this file answers those same calls inside the browser. The classifier (light/classify.js),
 *          the lenses (light/depth.js) and the threads (studio/ledger.js) run here; memory and sections stay in
 *          localStorage, cards in IndexedDB. Hearing is the browser's own on-device recognition or nothing. Jev and
 *          the easel run only with the Mac, so here the algorithm steers.
 *
 * The page asks the Mac only when it may: on localhost, after ?mac=1, or once the person has chosen to connect
 * (a public page reaching into the local network asks the browser's permission, so it is never done unasked).
 * Two windows of web mode (?screen=stage and ?screen=desk) share one session through a BroadcastChannel: the desk
 * (or a plain window) keeps the session and sends it on; the stage shows it.
 */
(function (root) {
  'use strict';
  const C = root.SpeechformClassify, D = root.SpeechformDepth, Lg = root.SpeechformLedger, R = root.SpeechformReading;
  const Q = new URLSearchParams(location.search), SCREEN = Q.get('screen') || '';
  const MAC = 'http://127.0.0.1:9990';
  const API = new Set(['state', 'status', 'say', 'intake', 'classify', 'card', 'cards', 'sections', 'memory', 'learned', 'pause', 'guide', 'depth', 'studio', 'transcribe', 'mask', 'settings', 'jev', 'listen', 'easel']);
  const KEY = 'speechform-web:';
  const store = { get(k, d) { try { const v = localStorage.getItem(KEY + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
                  set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } } };
  const nowS = () => Date.now() / 1000;
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ── which mode ── */
  const nativeFetch = root.fetch.bind(root);
  const sameOrigin = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port === '9990';
  const mayAsk = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) || Q.get('mac') === '1' || store.get('mac', false);
  let mode = sameOrigin ? 'mac' : null;
  const ready = sameOrigin ? Promise.resolve('mac') : (async () => {
    if (Q.get('web') === '1' || !mayAsk) return (mode = 'web');
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 1200);
      const r = await nativeFetch(MAC + '/status', { cache: 'no-store', signal: ctl.signal }); clearTimeout(t);
      if (r.ok) { store.set('mac', true); return (mode = 'full'); }
    } catch (e) { /* not running, or the browser said no */ }
    return (mode = 'web');
  })();
  if (!sameOrigin) {
    root.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : null;
      const seg = url && url.startsWith('/') ? url.split(/[/?#]/)[1] : null;
      if (!seg || !API.has(seg)) return nativeFetch(input, init);
      await ready;
      if (mode === 'full') return nativeFetch(MAC + url, init);
      return answer(url, init || {});
    };
  }

  /* ── the engine in the browser: the same choices as Light and the server, phrase by phrase ── */
  const STOP = new Set('a an the this that these those is are was were be been being to of and or in on at for with as i you he she it we they my your our their me us them but if then so from by have has had do does did will would can could should just very all some about into how what when where which who its let not there here one also more like'.split(' '));
  const keys = t => [...new Set((t.toLowerCase().match(/[a-z']+/g) || []).filter(w => w.length > 3 && !STOP.has(w)))];
  const WARM = new Set('sun fire flame gold golden home hearth grandmother mother love warm summer bread honey light lantern amber red heart dawn morning'.split(' '));
  const COOL = new Set('moon sea ocean silver mist night rain river snow winter blue cold star stars water ice shadow dusk grey gray fog'.split(' '));
  const index = { load: () => store.get('threads-index', []),
    add(threads, card, session, when) { const items = store.get('threads-index', []), have = new Set(items.map(x => x.session + '|' + x.id));
      for (const t of threads || []) if (!have.has(session + '|' + t.id) && (t.keywords || []).length)
        items.push({ id: t.id, title: t.title, keywords: t.keywords.slice(0, 24), kind: t.kind, state: t.state, session, card, at: when || nowS() });
      store.set('threads-index', items.slice(-600)); } };

  function Engine({ isolated = false } = {}) {
    const E = { session: uid('s'), events: [], ideas: [], settled: null, kind: null, streak: 0, candidate: null, lead: 'kelp', leadAt: 0, order: [], growth: {},
      gateAt: 0, dir: { warmth: .4, tempo: 1, memory: .4, seed: 0, density: 1 }, radius: .85, conclusionAt: 0, firstKeys: null, revision: 0, steer: null };
    E.ledger = Lg.Ledger(E.session, isolated ? null : index);
    function matchIdea(text) {
      const prev = E.events[E.events.length - 1];
      const k = keys(text.split(/\s+/).length < 8 && prev ? prev.text + ' ' + text : text);
      let best = null, score = 0;
      for (const idea of E.ideas) { const shared = k.filter(w => idea.keys.has(w)).length / Math.max(1, Math.min(k.length, idea.keys.size)); if (shared > score) { score = shared; best = idea; } }
      const line = /\b(returning to|back to|as i said|again about)\b/i.test(text) ? .2 : .3, n = text.split(/\s+/).length;
      if (best && score >= line) { if (prev && prev.topic !== best.id) best.returns++; k.forEach(w => best.keys.add(w)); best.words += n; best.n++; return best; }
      if (!k.length && prev) { const p = E.ideas.find(i => i.id === prev.topic); if (p) { p.words += n; p.n++; return p; } }
      const idea = { id: uid('i'), title: k.slice(0, 4).join(' ').replace(/^./, c => c.toUpperCase()) || 'A thought', keys: new Set(k), words: n, returns: 0, n: 1 };
      E.ideas.push(idea); return idea;
    }
    function direct() {
      const recent = E.events.slice(-6).map(p => p.text).join(' ').toLowerCase().match(/[a-z']+/g) || [];
      const warm = new Set(recent.filter(w => WARM.has(w))), cool = new Set(recent.filter(w => COOL.has(w))), d = E.dir;
      if (warm.size || cool.size) d.warmth += (.5 + .5 * (warm.size - cool.size) / (warm.size + cool.size) - d.warmth) * .5;
      const said = E.events.filter(p => nowS() - p.at < 30).reduce((a, p) => a + p.text.split(/\s+/).length, 0);
      d.tempo += (.6 + Math.min(1, said / 90) - d.tempo) * .5;
      const idea = E.ideas.find(i => i.id === (E.events[E.events.length - 1] || {}).topic);
      d.memory += (.35 + Math.min(.6, .15 * (idea ? idea.returns : 0)) - d.memory) * .5;
      if (idea) d.seed = [...idea.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 97;
    }
    function ingest(text, speaker = 'A', source = 'Typed', at) {
      text = String(text || '').trim(); if (!text) return null;
      const now = at || nowS();
      const hist = E.events.map(e => ({ id: e.id, text: e.text, at: e.at, scores: e.own }));
      const own = C.scorePhrase(text), heard = C.hear(hist, text, now);
      E.settled = C.settle(E.events.length ? E.settled : null, heard.ranked);
      const top = Object.keys(E.settled).reduce((a, b) => E.settled[a] >= E.settled[b] ? a : b);
      E.streak = top === E.candidate ? E.streak + 1 : 1; E.candidate = top;
      let run = 0; for (let i = E.events.length - 1; i >= 0 && E.events[i].form === E.kind; i--) run++;
      const choice = C.decide(E.kind, E.settled, E.streak, run), kind = choice.kind, image = C.IMAGE[kind], words = text.split(/\s+/).length;
      if (!E.events.length || (image !== E.lead && now - E.leadAt >= (root.SpeechformGrowers ? root.SpeechformGrowers.DWELL : 30))) {
        if (image !== E.lead || !E.events.length) E.gateAt = now;
        E.lead = image; E.leadAt = now; E.order = E.order.filter(r => r !== image).concat(image);
      }
      E.kind = kind; E.growth[image] = (E.growth[image] || 0) + words;
      if (/\b(the point of (all of )?this is|in conclusion|what it comes down to|the answer is)\b/i.test(text)) E.conclusionAt = now;
      const k = keys(text); E.firstKeys = E.firstKeys || new Set(k);
      E.radius = E.conclusionAt && now - E.conclusionAt < 1 ? 0 : Math.max(.12, Math.min(.95, 1 - k.filter(w => E.firstKeys.has(w)).length / Math.max(1, k.length)));
      const idea = matchIdea(text), id = uid('p');
      const depth = D.reading(heard.weights.map(x => [x.text, x.w]), D.nearKinds(kind, choice.ranked));
      const ev = { id, text, speaker, source, at: now, form: kind, topic: idea.id, own: own.scores,
        why: { scores: heard.ranked.map(([f, v]) => ({ form: f, similarity: +v.toFixed(3) })), own: own.scores, weights: heard.weights.map(w => ({ ...w, id: w.id })),
          partsList: own.parts, signals: own.structure, settled: choice.ranked.map(([f, v]) => ({ form: f, share: +v.toFixed(3) })), doubt: choice.doubt, run: choice.run,
          reason: choice.reason, depth } };
      ev.why.weights[ev.why.weights.length - 1].id = id;
      ev.why.steer = E.steer = E.ledger.add(ev, depth, { id: idea.id, title: idea.title, keywords: [...idea.keys] });
      E.events.push(ev); E.revision++;
      direct();
      return ev;
    }
    function state(test) {
      const yours = E.events.filter(e => test || e.source !== 'Test').slice(-60);
      return { mode: 'web', session: E.session, revision: E.revision, now: nowS(),
        transcript: yours.map((e, i) => ({ id: e.id, text: e.text, form: e.form, speaker: e.speaker, idea: e.topic, at: e.at, source: e.source, register: C.IMAGE[e.form] || 'kelp',
          why: i >= yours.length - 4 ? e.why : { ...e.why, steer: undefined } })),
        form: E.kind, ideas: E.ideas.map(i => ({ id: i.id, title: i.title, words: i.words, returns: i.returns, n: i.n })),
        active_idea: (E.events[E.events.length - 1] || {}).topic || null, lead: E.lead, growth: E.growth, form_to_register: C.IMAGE,
        direction: { ...E.dir }, gate_at: E.gateAt, radius: E.radius, conclusion_at: E.conclusionAt, steer: E.steer ? E.ledger.snapshot(nowS(), E.kind, (E.events[E.events.length - 1] || {}).topic) : null,
        has_jev: false, jev_pause: null, jev_asking: false, studio: { ...link, desk: SCREEN === 'desk' || Date.now() - deskSeen < 5000 }, microphone: false };
    }
    return { ingest, state, get E() { return E; } };
  }

  /* any stretch of text, read on its own: phrase by phrase, as if spoken, without touching the session */
  function readPassage(text) {
    const e = Engine({ isolated: true }), phrases = [];
    for (const x of String(text).split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(Boolean)) {
      let w = x.split(/\s+/); while (w.length > 30) { phrases.push(w.slice(0, 24).join(' ')); w = w.slice(24); } if (w.length) phrases.push(w.join(' '));
    }
    const t0 = nowS(), events = phrases.slice(0, 80).map((p, i) => e.ingest(p, 'A', 'Section', t0 + i)).filter(Boolean);
    const prof = {}; let total = 0;
    for (const ev of events) {
      const n = ev.text.split(/\s+/).length; total += n;
      const sc = ev.why.scores, floor = sc[Math.min(5, sc.length - 1)].similarity, sh = {}; let s = 0;
      for (const x of sc) { sh[x.form] = Math.max(0, x.similarity - floor); s += sh[x.form]; }
      for (const k in sh) prof[k] = (prof[k] || 0) + sh[k] / (s || 1) * n;
    }
    const ranked = Object.entries(prof).map(([k, v]) => [k, v / (total || 1)]).sort((a, b) => b[1] - a[1]);
    const depth = ranked.length ? D.passage(text, D.nearKinds(ranked[0][0], ranked)) : null;
    if (depth) depth.profile = ranked.slice(0, 6).map(([k, v]) => [k, +v.toFixed(3)]);
    return { events: events.map(ev => ({ id: ev.id, text: ev.text, at: ev.at, form: ev.form, topic: ev.topic, speaker: 'A', why: ev.why })),
      topics: e.E.ideas.map(i => ({ id: i.id, title: i.title, words: i.words, returns: i.returns, n: i.n })), depth };
  }

  /* ── cards, kept in IndexedDB (or in memory where the browser keeps nothing) ── */
  const mem = { cards: new Map(), files: new Map() };
  const db = (() => { try { return new Promise((res) => { let r; try { r = indexedDB.open('speechform-web', 1); } catch (e) { return res(null); }
    r.onupgradeneeded = () => { r.result.createObjectStore('cards', { keyPath: 'id' }); r.result.createObjectStore('files'); };
    r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); } catch (e) { return Promise.resolve(null); } })();
  const tx = async (name, modeRW, fn) => { const d = await db; if (!d) return fn(null);
    return new Promise((res, rej) => { const t = d.transaction(name, modeRW), s = t.objectStore(name); const q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  const cardsDb = {
    async put(card) { mem.cards.set(card.id, card); await tx('cards', 'readwrite', s => s && s.put(card)).catch(() => {}); },
    async all() { const got = await tx('cards', 'readonly', s => s && s.getAll()).catch(() => null); return (got || [...mem.cards.values()]).sort((a, b) => b.made - a.made); },
    async get(id) { return (await tx('cards', 'readonly', s => s && s.get(id)).catch(() => null)) || mem.cards.get(id); },
    async file(id, name, value) {
      const k = id + '/' + name;
      if (value === undefined) return (await tx('files', 'readonly', s => s && s.get(k)).catch(() => null)) ?? mem.files.get(k);
      mem.files.set(k, value); await tx('files', 'readwrite', s => s && s.put(value, k)).catch(() => {});
    },
  };
  function segments(phrases, most = 12) {
    const words = t => String(t || '').split(/\s+/).filter(Boolean).length, total = phrases.reduce((a, p) => a + words(p.text), 0), size = Math.max(40, total / most);
    const out = []; let cur = [], n = 0;
    for (const p of phrases) { cur.push(p); n += words(p.text); if (n >= size) { out.push(cur); cur = []; n = 0; } }
    if (cur.length) { if (out.length && n < size / 2) out[out.length - 1].push(...cur); else out.push(cur); }
    return out.map(seg => { const c = {}; seg.forEach(p => c[p.kind] = (c[p.kind] || 0) + words(p.text));
      return { text: seg.map(p => p.text).join(' '), classifier: Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null, from: seg[0].at, to: seg[seg.length - 1].at }; });
  }
  function depthRecord(phrases, text, card) {
    const profile = card.profile || [], kinds = profile.length ? D.nearKinds(profile[0][0], profile) : [card.kind], whole = D.passage(text, kinds);
    return { kind: whole && whole.kind, algorithm: whole, over_time: D.overTime(phrases), jev: null,
      segments: segments(phrases).map(sg => { const d = sg.classifier ? D.passage(sg.text, [sg.classifier]) : null;
        return { from: sg.from, to: sg.to, kind: sg.classifier, words: sg.text.split(/\s+/).length, algorithm: D.summary(d),
          elements: d ? Object.fromEntries(D.ORDER.map(l => [l, d.lenses[l].elements.filter(e => e.score > 0).map(e => ({ id: e.id, score: e.score, evidence: e.evidence }))])) : null }; }),
      note: 'The algorithm read every element from the words, in this browser. Jev answers the lens questions only with Speechform on a Mac.' };
  }
  const pct = v => Math.round((v || 0) * 100) + '%';
  function summary(card, reading, dr, threads) {
    const L = [card.name, '', `${card.kind} | ${String(card.register || '').toUpperCase()} | level ${card.level} | Focus ${card.focus} | Hold ${card.hold} | ${card.rarity}`, '',
      (card.effect || []).join(' '), '', 'THE WHOLE RECORDING', `${reading.words} words in ${reading.phrases} phrases. The kind switched ${reading.switches} times.`, ''];
    (reading.profile || []).slice(0, 10).forEach(([k, v]) => L.push(`  ${k.padEnd(26)} ${pct(v)}`));
    const a = dr && dr.algorithm, spec = a && D.spec(a.kind);
    if (a && spec) {
      L.push('', 'DEPTH', `  Read through the three lenses of ${a.kind}.`);
      for (const l of D.ORDER) { const got = a.lenses[l], found = got.elements.filter(e => e.found);
        L.push(`  ${(l[0].toUpperCase() + l.slice(1)).padEnd(11)} ${pct(got.meter)}`, `    ${spec[l].question}`,
          '    Found: ' + (found.length ? found.map(e => `${e.name} (${e.evidence.slice(0, 3).join(', ')})`).join('; ') : 'none yet') + '.'); }
      if (a.next) L.push(`  To try next: ${a.next.try || a.next.meaning}`);
      L.push('  ' + dr.note);
    }
    if (threads.length) {
      L.push('', 'THREADS');
      for (const t of threads) { L.push(`  ${t.title || 'a thread'}: ${t.state}${t.stage ? ', at ' + t.stage : ''}${t.need ? ', ' + t.need : ''}.`);
        if (t.suggestion) L.push(`    The algorithm suggests: ${t.suggestion.move}`); if (t.link) L.push(`    Picked up from ${t.link.date}: "${t.link.title}".`); }
    }
    L.push('', 'THE ART', '  ' + card.art);
    return L.join('\n') + '\n';
  }
  async function makeCard(d) {
    const raw = d.card || {}, reading = raw.reading || {}, phrases = d.phrases || [], text = String(d.text || '');
    const t0 = +(d.since || (phrases[0] && phrases[0].at) || nowS()), when = new Date();
    const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}.${String(when.getMinutes()).padStart(2, '0')}`;
    const all = await cardsDb.all(); let id = `${stamp} ${(raw.name || 'A recording').replace(/[^\w\s'-]/g, '').trim().slice(0, 48) || 'A recording'}`, n = 2;
    while (all.some(c => c.id === id)) id = id.replace(/ \(\d+\)$/, '') + ` (${n++})`;
    const threads = (d.threads || []).map(t => ({ ...t, ...(t.state !== 'closed' && t.next ? { suggestion: { by: 'algorithm', move: t.next } } : {}) }));
    const card = { ...raw, id, text: text.slice(0, 6000), abstract: d.abstract || null, clear: null, art: 'kept abstract: the easel paints this side with Speechform on a Mac',
      made: nowS(), since: t0, reading: { ideas: reading.ideas || [] }, audio: d.audio || null, faces: false };
    delete card.reading.profile;
    const dr = depthRecord(phrases, text, raw);
    card.depth = D.summary(dr.algorithm);
    if (d.threads) { card.threads = { open: threads.filter(t => t.state !== 'closed').length, closed: threads.filter(t => t.state === 'closed').length }; index.add(d.threads, id, d.session, t0); }
    await cardsDb.put(card);
    const files = { 'phrases.json': phrases, 'reading.json': reading, 'depth.json': dr, 'threads.json': { threads, note: 'Each idea is a thread, judged within its form\'s arc in this browser.' },
      'reading.txt': summary(card, reading, dr, threads), 'transcript.txt': phrases.map(p => `[${Math.max(0, Math.round(p.at - t0))} s] ${p.speaker || 'A'} | ${p.kind}\n${p.text}\n`).join('\n') };
    for (const [k, v] of Object.entries(files)) await cardsDb.file(id, k, v);
    return card;
  }

  /* ── the session here, and the two windows ── */
  let engine = Engine(), link = { toggle: 0, listening: false, rec_at: 0 }, follower = SCREEN === 'stage', remote = null, deskSeen = 0;
  const BC = 'BroadcastChannel' in root ? new BroadcastChannel('speechform-web') : null;
  let lastSent = 0;
  const share = () => { if (BC && !follower && mode === 'web') BC.postMessage({ t: 'state', S: engine.state(true) }); lastSent = Date.now(); };
  if (BC) BC.onmessage = ({ data }) => {
    if (mode !== 'web') return;
    if (data.t === 'state' && follower) { remote = data.S; deskSeen = Date.now(); }
    if (data.t === 'hello' && !follower) share();
    if (data.t === 'toggle' && !follower) { link.toggle++; share(); }
  };
  ready.then(m => { if (m === 'web' && BC) { if (follower) BC.postMessage({ t: 'hello' }); setInterval(() => { if (!follower && Date.now() - lastSent > 1500) share(); }, 1000); } });

  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const body = init => { try { return init.body ? JSON.parse(init.body) : {}; } catch (e) { return {}; } };
  const memory = { add(e) { if (e.source === 'Test' || e.source === 'Section') return; const m = store.get('memory', []);
      m.push({ id: e.id, text: e.text, at: e.at, form: e.form, register: C.IMAGE[e.form], speaker: e.speaker, source: e.source }); store.set('memory', m.slice(-3000)); } };

  async function answer(url, init) {
    await D.ready;
    const path = url.split('?')[0], method = (init.method || 'GET').toUpperCase(), test = /[?&]test=1/.test(url) || Q.get('test') === '1';
    if (path === '/status' || path === '/transcribe' || path === '/listen' || path === '/easel') return json({ ok: false, error: 'no Speechform server: this page runs in the browser' }, 404);
    if (path === '/state') {
      if (follower) { const S = remote ? { ...remote, now: nowS() } : engine.state(test); if (remote && !test) S.transcript = S.transcript.filter(e => e.source !== 'Test'); return json(S); }
      return json(engine.state(test));
    }
    if (method === 'GET' && path === '/memory') { const m = store.get('memory', []).slice().reverse(); return json({ memory: m, count: m.length }); }
    if (method === 'GET' && path === '/sections') return json({ sections: store.get('sections', []) });
    if (method === 'GET' && path === '/learned') return json({ learned: [], jev: {}, rules: {}, refinements: [] });
    if (method === 'GET' && path === '/cards') return json({ cards: await cardsDb.all() });
    if (method === 'GET' && path.startsWith('/cards/')) {
      const rest = decodeURIComponent(path.slice(7)), i = rest.lastIndexOf('/'), id = rest.slice(0, i), name = rest.slice(i + 1);
      const v = await cardsDb.file(id, name); if (v === undefined || v === null) return json({ error: 'not here' }, 404);
      return typeof v === 'string' ? new Response(v, { headers: { 'content-type': 'text/plain; charset=utf-8' } }) : json(v);
    }
    const d = body(init);
    if (path === '/say') {
      if (follower) return json({ ok: false });
      const e = engine.ingest(d.text, d.speaker || 'A', d.test ? 'Test' : d.heard ? 'Microphone' : 'Typed');
      if (e) { memory.add(e); share(); } return json({ ok: !!e });
    }
    if (path === '/intake') { if (d.action === 'reset' && !follower) { engine = Engine(); share(); } return json({ ok: true }); }
    if (path === '/classify') { const t = String(d.text || '').trim(); return t ? json({ ok: true, ...readPassage(t) }) : json({ error: 'nothing to classify' }, 400); }
    if (path === '/sections') { const s = { ...d, id: uid('x'), at: nowS() }; const all = store.get('sections', []); all.unshift(s); store.set('sections', all.slice(0, 300)); return json(s); }
    if (path === '/card') return json(await makeCard(d));
    if (path.startsWith('/cards/') && path.endsWith('/faces')) {
      const id = decodeURIComponent(path.slice(7, -6)), c = await cardsDb.get(id);
      if (c) { c.faces = true; await cardsDb.put(c); if (d.front) await cardsDb.file(id, 'card-front.png', d.front); if (d.back) await cardsDb.file(id, 'card-back.png', d.back); }
      return json({ ok: !!c });
    }
    if (path.endsWith('/reveal')) return json({ ok: false, error: 'the folder lives on a Mac' });
    if (path === '/pause') return json({ ok: false, why: 'Jev reads at a pause only with Speechform on a Mac; here the algorithm steers' });
    if (path === '/guide') { const S = follower && remote ? remote : engine.state(true); const move = S.steer ? Lg.nextMove(S.steer) : null; return json({ ok: !!move, move, by: 'the algorithm', revision: S.revision }); }
    if (path === '/depth/jev') return json({ ok: false, error: 'Jev is available with Speechform on a Mac' });
    if (path === '/studio') {
      if (d.action === 'toggle') { if (follower) { if (BC) BC.postMessage({ t: 'toggle' }); } else link.toggle++; }
      if (d.action === 'rec') { link.listening = !!d.on; link.rec_at = +d.at || 0; share(); }
      return json({ ok: true, ...link });
    }
    return json({ ok: false, error: 'not here' }, 404);
  }

  /* the bar's note on where Studio runs, and the choice to connect to the Mac or stay in the browser */
  function connect(on) { store.set('mac', !!on); const q = new URLSearchParams(location.search); q.delete('mac'); q.delete('web'); if (on) q.set('mac', '1'); else q.set('web', '1'); location.search = q.toString(); }
  root.SpeechformLocal = { ready, get mode() { return mode; }, base: () => (mode === 'full' ? MAC : ''), connect, readPassage, Engine, nativeFetch };
})(this);
