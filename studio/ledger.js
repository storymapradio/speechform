/* Speechform: the thread ledger in the browser, the same algorithm as steer.py, line for line.
 *
 * Every idea is a thread: opened, developing, returned, ready (to close), dormant or closed, judged within its form's
 * arc (lenses.json "arc"). The ledger also keeps who spoke and asked what, the airtime, and the listener's hold.
 * Studio's web mode (no Mac server) uses it; with the server, steer.py does the same work.
 *
 *   const L = SpeechformLedger.Ledger(session, index)    index: { load(), add(threads, card, session, when) }
 *   L.add(event, depthReading, topic) → snapshot       SpeechformLedger.candidates(snap), nextMove(snap), suggestions(threads)
 */
(function (root) {
  'use strict';
  const D = root.SpeechformDepth || (typeof require !== 'undefined' ? require('../light/depth.js') : null);
  const M = root.SpeechformMatch || (typeof require !== 'undefined' ? require('./match.js') : null);
  const RECHECK = 3, MOST_LINKS = 3;
  const DORMANT_SECONDS = 90, DORMANT_WORDS = 120, READY_WORDS = 60, RACE_WPS = 3.0, RACE_SPAN = 20, DROP = .7, MARKS = 24;
  const LANDING = /\b(?:so in the end|in the end|that'?s why|that is why|and that'?s (?:how|why|it|all)|the moral|the lesson (?:is|was)|so the answer|which brings (?:me|us) back|to this day|from then on|ever after|the end)\b/i;
  const STOP = new Set('the and that this with from have were they them their there then when what which would could should about into your just like been some very over also more than only will said says know think really yeah okay right going want thing things people because where while these those here each every other after before again still even much many most such being'.split(' '));
  const norm = t => String(t ?? '').replace(/’|‘/g, "'").replace(/“|”/g, '"');
  const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  const uniq = a => [...new Set(a)];
  /* a counter that keeps first-seen order for ties, like Python's Counter.most_common */
  const most = c => Object.entries(c).sort((a, b) => b[1] - a[1]);

  const arc = kind => ((D.lenses && D.lenses.kinds[kind]) || {}).arc || [];
  function stagesIn(kind, text) {
    const out = [];
    for (const s of arc(kind)) {
      const cue = s.cue || {};
      let hit = !!(cue.re && (norm(text).match(new RegExp(cue.re, 'gi')) || []).length >= (+cue.need || 1));
      if (!hit && cue.signal) hit = (D.features(text)[0][cue.signal] || 0) >= (+cue.at || 1);
      if (hit) out.push(s.id);
    }
    return out;
  }
  const keywords = text => M.keywords(text);

  /* the earlier threads this one is most like (match.js: meaning when vectors exist, stems always), the best few */
  function indexMatches(thread, session, items, most = MOST_LINKS) {
    const out = [];
    for (const x of items || []) {
      if (x.session === session) continue;
      const m = M.strength(thread, x);
      if (m.s >= M.LINK) { const words = x.say || {};
        out.push({ title: x.title, at: x.at, card: x.card, kind: x.kind, state: x.state, first: x.first, opened_at: x.opened_at, thread: x.id, strength: m.s, score: m.s,
          shared: m.shared.map(w => (thread.say || {})[w] || words[w] || w).slice(0, 6), meaning: m.meaning, form: m.form,
          date: new Date((x.at || 0) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) }); }
    }
    out.sort((a, b) => b.strength - a.strength);
    const seen = new Set(), best = [];
    for (const m of out) { const k = m.card + '|' + m.thread; if (!seen.has(k) && best.length < most) { seen.add(k); best.push(m); } }
    return best;
  }
  const indexMatch = (kw, session, items) => indexMatches({ keywords: kw }, session, items, 1)[0] || null;

  function Ledger(session, index) {
    const L = { session, threads: {}, order: [], questions: [], airtime: {}, turns: 0, lastSpeaker: null, words: 0, prevTopic: null,
      absorb: [], held: {}, heldNames: {}, times: [], _index: null };

    function thread(topic, text, speaker, now) {
      let t = L.threads[topic.id]; if (t) return [t, false];
      t = { id: topic.id, title: topic.title, kinds: {}, opened_at: now, opened_by: speaker, last_at: now, last_word: L.words, words: 0, n: 0, returns: 0,
        speakers: {}, stages: {}, landing_n: null, landing_at: null, returned_n: null, marks: [], first: text.slice(0, 90), link: null, links: [], keywords: [], say: {}, opening: '', vec: null };
      L.threads[topic.id] = t; L.order.push(topic.id); return [t, true];
    }

    function add(event, depthReading, topic) {
      const text = event.text, speaker = event.speaker || 'A', now = +(event.at || Date.now() / 1000), kind = event.form;
      const n = text.split(/\s+/).filter(Boolean).length;
      topic = topic || { id: event.topic, title: '' };
      const [t, isNew] = thread(topic, text, speaker, now);
      if (!isNew && L.prevTopic && L.prevTopic !== t.id) { t.returns++; t.returned_n = t.n; }
      L.prevTopic = t.id; L.words += n;
      t.n++; t.words += n; t.last_at = now; t.last_word = L.words; t.kinds[kind] = (t.kinds[kind] || 0) + n; t.speakers[speaker] = (t.speakers[speaker] || 0) + n;
      t.title = topic.title || t.title;
      for (const [st_, w] of M.pairs(text)) if (!(st_ in t.say) && Object.keys(t.say).length < 40) t.say[st_] = w;
      t.keywords = uniq([...t.keywords, ...keywords(text)]).slice(0, 30);
      if (t.opening.split(/\s+/).filter(Boolean).length < 40) t.opening = (t.opening + ' ' + text).trim();
      const hit = stagesIn(kind, text);
      for (const s of hit) { const st = t.stages[kind] || (t.stages[kind] = {}); if (!(s in st)) st[s] = now; }
      t.marks.push([r(now, 2), n, speaker, hit]); t.marks = t.marks.slice(-MARKS);
      const lands = arc(kind).filter(s => s.landing).map(s => s.id);
      if (t.n >= 2 && (hit.some(s => lands.includes(s)) || LANDING.test(text))) { t.landing_n = t.n; t.landing_at = now; }
      if (t.n <= 3 || t.n % RECHECK === 0) relink(t, kind);
      if (L.lastSpeaker && speaker !== L.lastSpeaker) {
        L.turns++;
        for (const q of L.questions) if (!q.answered_at && q.speaker !== speaker) { q.answered_at = now; q.answered_by = speaker; }
      }
      L.lastSpeaker = speaker;
      L.airtime[speaker] = (L.airtime[speaker] || 0) + n;
      for (const qs of norm(text).match(/[^.!?]*\?/g) || []) if (qs.trim()) L.questions.push({ id: `${event.id}-${L.questions.length}`, speaker, at: now, text: qs.trim().slice(-90), idea: t.id });
      L.questions = L.questions.slice(-40);
      if (!['Typed', 'Test', 'Section'].includes(event.source)) L.times.push([now, n]);
      L.times = L.times.filter(x => now - x[0] <= 120);
      if (depthReading) {
        const ab = depthReading.lenses.absorption;
        L.absorb.push([now, ab.meter]);
        for (const e of ab.elements) if (e.found) { const k = depthReading.kind + '|' + e.id; L.held[k] = (L.held[k] || 0) + 1; L.heldNames[k] = e.name; }
      }
      return snapshot(now, kind, t.id);
    }

    function relink(t, kind) {
      const probe = { keywords: t.keywords, vec: t.vec, kind: kind || (most(t.kinds)[0] || [])[0], say: t.say };
      t.links = indexMatches(probe, L.session, index ? index.load() : []); t.link = t.links[0] || null;
    }
    function judge(t, now) {
      const kind = most(t.kinds).length ? most(t.kinds)[0][0] : null;
      const stages = arc(kind), reached = t.stages[kind] || {}, ids = stages.map(s => s.id);
      const top = Math.max(-1, ...Object.keys(reached).filter(s => ids.includes(s)).map(s => ids.indexOf(s)));
      const nxt = stages.slice(top + 1).find(s => !(s.id in reached)) || stages.find(s => !(s.id in reached)) || null;
      const landing = stages.find(s => s.landing) || null;
      const closed = t.landing_n !== null && t.n - t.landing_n <= 1, dormantFor = now - t.last_at;
      const anyReached = Object.keys(reached).length > 0;
      const middle = ids.length > 2 ? ids.slice(1, -1).some(s => s in reached) : anyReached;
      let state;
      if (closed) state = 'closed';
      else if (dormantFor >= DORMANT_SECONDS || L.words - t.last_word >= DORMANT_WORDS) state = 'dormant';
      else if (t.n >= 2 && (middle || t.words >= READY_WORDS) && (anyReached || t.words >= READY_WORDS)) state = 'ready';
      else if (t.returned_n !== null && t.n - t.returned_n <= 1) state = 'returned';
      else if (t.n >= 2) state = 'developing';
      else state = 'opened';
      const need = state === 'closed' ? null : (state === 'ready' && landing ? landing.need : (nxt ? nxt.need : null));
      const move = state === 'closed' ? null : (state === 'ready' && landing ? landing.move : (nxt ? nxt.move : null));
      return { kind, state, stage: top >= 0 ? ids[top] : null, stages: ids.filter(s => s in reached), need, next: move, dormant_for: state === 'dormant' ? Math.round(dormantFor) : 0 };
    }

    function leadArc(kind, tid) {
      const stages = arc(kind); if (!stages.length) return null;
      const t = L.threads[tid] || {}, reached = (t.stages || {})[kind] || {}, ids = stages.map(s => s.id);
      const top = Math.max(-1, ...Object.keys(reached).filter(s => ids.includes(s)).map(s => ids.indexOf(s)));
      const nxt = stages.slice(top + 1).find(s => !(s.id in reached)) || null;
      return { kind, thread: tid, current: top >= 0 ? ids[top] : null,
        stages: stages.map(s => ({ id: s.id, name: s.name, reached: s.id in reached, at: reached[s.id] ?? null, landing: !!s.landing })),
        next: nxt ? { id: nxt.id, name: nxt.name, move: nxt.move, need: nxt.need } : null };
    }

    function hold(now) {
      const win = L.times.filter(([at]) => now - at <= RACE_SPAN), recent = win.map(x => x[1]);
      const span = Math.max(5, Math.min(RACE_SPAN, now - (win.length ? Math.min(...win.map(x => x[0])) : now)));
      const wps = recent.length ? recent.reduce((a, b) => a + b, 0) / span : 0;
      const meters = L.absorb.map(x => x[1]), avg = a => a.reduce((x, y) => x + y, 0) / a.length;
      const cur = meters.length ? avg(meters.slice(-2)) : 0;
      let best = 0; if (meters.length) for (let i = 0; i < Math.max(1, meters.length - 2); i++) best = Math.max(best, avg(meters.slice(i, i + 3)));
      const held = most(L.held).slice(0, 3).map(([k]) => L.heldNames[k]);
      let cue = null;
      if (wps >= RACE_WPS && L.times.length >= 3) cue = { type: 'pause', text: 'The words are coming fast. Let a pause land before the next line.' };
      else if (meters.length >= 4 && best > .2 && cur < DROP * best)
        cue = { type: 'return', text: held.length ? 'Earlier, ' + held.slice(0, 2).map(n => n.toLowerCase()).join(' and ') + ' held the listener. Return to it.' : 'The hold is loosening. Slow down and give one concrete detail.', held: held.slice(0, 2) };
      return { meter: r(cur, 3), best: r(best, 3), wps: r(wps, 2), tempo: r(Math.max(.5, Math.min(2, wps ? wps / 2.2 : .8)), 2),
        trend: r(cur - (meters.length > 4 ? avg(meters.slice(-5, -2)) : cur), 3), held, cue };
    }

    function snapshot(now, lead, active) {
      now = now || Date.now() / 1000;
      const threads = L.order.slice(-16).map(tid => { const t = L.threads[tid];
        return { id: tid, title: t.title, ...judge(t, now), opened_at: t.opened_at, opened_by: t.opened_by, last_at: t.last_at, words: t.words, n: t.n, returns: t.returns,
          speakers: { ...t.speakers }, first: t.first, link: t.link, links: t.links, landing_at: t.landing_at, marks: t.marks, keywords: t.keywords.slice(0, 12),
          say: Object.fromEntries(t.keywords.slice(0, 12).filter(k => k in t.say).map(k => [k, t.say[k]])) }; });
      const many = Object.values(L.airtime).filter(v => v > 0).length > 1;
      const unpicked = threads.filter(t => many && t.state !== 'closed' && Object.keys(t.speakers).length === 1 && t.speakers[t.opened_by] && t.id !== active).map(t => t.id);
      const talk = { airtime: { ...L.airtime }, turns: L.turns, speakers: Object.keys(L.airtime).sort(),
        questions: L.questions.slice(-24).map(q => ({ id: q.id, speaker: q.speaker, at: q.at, text: q.text, idea: q.idea, answered_at: q.answered_at ?? null, answered_by: q.answered_by ?? null })),
        open: L.questions.filter(q => !q.answered_at).length, unpicked };
      const snap = { threads, arc: lead ? leadArc(lead, active) : null, talk, hold: hold(now), active };
      snap.next = nextMove(snap);
      return snap;
    }
    return { add, snapshot, relink: id => L.threads[id] && relink(L.threads[id]), get state() { return L; } };
  }

  const RANK = { ready: 0, dormant: 1, developing: 2, returned: 2, opened: 3, closed: 4 };
  function candidates(snap) {
    const out = [], hold = snap.hold || {};
    if (hold.cue) out.push({ id: 'hold', text: hold.cue.text, why: 'the hold', thread: null });
    const a = snap.arc || {};
    if (a.next) out.push({ id: 'arc', text: a.next.move, why: `the ${a.kind} ${a.next.need}`, thread: a.thread });
    for (const t of [...(snap.threads || [])].sort((x, y) => (RANK[x.state] ?? 5) - (RANK[y.state] ?? 5)))
      if ((t.state === 'ready' || t.state === 'dormant') && t.next)
        out.push({ id: 't:' + t.id, text: t.state === 'ready' ? t.next : `Return to "${t.title}". ${t.next}`, why: `"${t.title}" ${t.need || ''}`.trim(), thread: t.id });
    const talk = snap.talk || {}, openQ = (talk.questions || []).filter(q => !q.answered_at);
    if ((talk.speakers || []).length > 1 && openQ.length) { const q = openQ[0]; out.push({ id: 'q:' + q.id, text: `Answer the question ${q.speaker} asked: "${q.text}"`, why: 'a question waits', thread: q.idea }); }
    for (const tid of (talk.unpicked || []).slice(0, 1)) { const t = (snap.threads || []).find(x => x.id === tid); if (t) out.push({ id: 'u:' + tid, text: `Pick up what ${t.opened_by} opened: "${t.title}".`, why: 'a thread nobody else took up', thread: tid }); }
    const seen = new Set(); return out.filter(c => !seen.has(c.text) && seen.add(c.text)).slice(0, 8);
  }
  const nextMove = snap => candidates(snap)[0] || null;
  function suggestions(threads) {
    const out = {};
    for (const t of threads || []) {
      if (t.state === 'closed') continue;
      const reached = new Set(t.stages || []), opts = {};
      for (const s of arc(t.kind)) if (!reached.has(s.id)) opts[s.id] = s.move;
      opts.rest = 'Let it rest: it was a passing thought.'; opts.return = 'Pick it up again in a later recording.';
      out[t.id] = opts;
    }
    return out;
  }

  const api = { Ledger, candidates, nextMove, suggestions, keywords, indexMatch, indexMatches, arc, DORMANT_SECONDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SpeechformLedger = api;
})(this);
