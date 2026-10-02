/* Speechform Studio: Links. How this session's threads meet every recording before it.
 *
 * The past comes from the recordings this Studio can reach: the Mac's cards (full mode) or this browser's
 * (web mode), each with its threads.json, and the account's synced library when signed in (recordings made on
 * other devices). A thread here meets a thread there as match.js says (the same rule as the Mac's index): meaning
 * when both have vectors, the stems of their words always, and a little for the same form. When signed in and the
 * global index answers (studio/index-api.js), its links across every app join these, filtered by scope and app.
 *
 *   SpeechformLinks.refresh()            reload the past (cached; cheap to call)
 *   SpeechformLinks.analyze(threads, now) → { recordings, edges, clusters, current, waiting, at }
 *   SpeechformLinks.timeline(key)        every recording that touched a thread, with the state it reached
 *   SpeechformLinks.search(q)            threads across the library
 *   SpeechformLinks.panel(el, { open(card, at), preview })   the bottom-box panel
 */
(function (root) {
  'use strict';
  const R = root.SpeechformReading, VW = root.SpeechformViews, M = root.SpeechformMatch, IX = root.SpeechformIndex;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LENS = ['listener', 'speaker', 'absorption'];
  const MIN = .3;
  let graphFor = null, graph = null;
  let past = [], loadedAt = 0, loading = null, last = null;
  const day = t => new Date((t || 0) * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  /* ── the past ── */
  async function json(url) { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch (e) { return null; } }
  const cache = {};
  async function refresh(force) {
    if (loading) return loading;
    if (!force && Date.now() - loadedAt < 30000) return past;
    loading = (async () => {
      const out = {};
      const cards = ((await json('/cards')) || {}).cards || [];
      for (const c of cards.slice(0, 150)) {
        if (!cache[c.id]) { const t = await json(`/cards/${encodeURIComponent(c.id)}/threads.json`); cache[c.id] = (t && t.threads) || []; }
        out[c.id] = { id: c.id, title: c.name || c.id, at: c.since || c.made, kind: c.kind, depth: c.depth || null, threads: cache[c.id].map(stemmed), card: c, source: 'here' };
      }
      /* the library: recordings made on other devices */
      try {
        const sb = root.SpeechformLibrary && await root.SpeechformLibrary.client();
        if (sb) {
          const { data } = await sb.from('sf_cards').select('id, card_id, title, kind, made_at, threads, card, source').order('made_at', { ascending: false }).limit(300);
          for (const r of data || []) if (!out[r.card_id]) out[r.card_id] = { id: r.card_id, row: r.id, title: r.title, at: (r.card && r.card.since) || Date.parse(r.made_at) / 1000, kind: r.kind,
            depth: (r.card || {}).depth || null, threads: ((r.threads && r.threads.threads) || []).map(stemmed), card: null, source: 'library' };
        }
      } catch (e) { /* not signed in */ }
      past = Object.values(out).sort((a, b) => (b.at || 0) - (a.at || 0)); loadedAt = Date.now(); loading = null; return past;
    })();
    return loading;
  }

  /* recordings kept before the stemmer have plain words; their stems are taken here */
  function stemmed(t) { if (t.say || !t.keywords) return t; const say = {}; const kw = [...new Set(t.keywords.map(w => { const s = M.stem(w); say[s] = say[s] || w; return s; }))]; return { ...t, keywords: kw, say }; }
  /* ── how two threads meet: match.js, and the words as they were said ── */
  function strength(a, ra, b, rb) {
    const m = M.strength(a, b);
    return { s: m.s >= M.LINK ? m.s : 0, shared: m.shared.map(w => (a.say || {})[w] || (b.say || {})[w] || w).slice(0, 6), meaning: m.meaning, form: m.form };
  }

  /* ── the whole picture ── */
  function analyze(threads, now, recs) {
    recs = recs || past; now = now || Date.now() / 1000;
    const here = { id: 'here', title: 'this session', at: now, threads: threads || [], depth: null };
    /* this session's threads, each with the recordings that share it */
    const current = (threads || []).map(t => {
      const matches = [];
      for (const r of recs) for (const p of r.threads || []) { const m = strength(t, here, p, r); if (m.s >= MIN) matches.push({ rec: r, thread: p, strength: m.s, shared: m.shared, meaning: m.meaning, form: m.form }); }
      matches.sort((a, b) => b.strength - a.strength);
      const seen = new Set(); return { thread: t, matches: matches.filter(m => !seen.has(m.rec.id) && seen.add(m.rec.id)).slice(0, 8) };
    });
    /* recordings joined by the threads they share; clusters are themes (worked out again only when the past changes) */
    const key = recs.length + ':' + (recs[0] || {}).id + ':' + loadedAt;
    if (graphFor !== key) { graph = pastGraph(recs.slice(0, 60)); graphFor = key; }
    const edges = graph.edges.slice();
    current.forEach(c => c.matches.forEach(m => edges.push({ from: 'here', to: m.rec.id, strength: m.strength, shared: m.shared, title: c.thread.title, thread: c.thread.id, meaning: m.meaning })));
    return last = { at: now, recordings: recs.map(r => ({ id: r.id, title: r.title, at: r.at, kind: r.kind, cluster: graph.clusterOf[r.id] || null, source: r.source, threads: (r.threads || []).length })),
      edges, clusters: graph.clusters, current, waiting: graph.waiting, recs };
  }
  function pastGraph(recs) {
    const edges = [], parent = {};
    const find = x => parent[x] === x || parent[x] == null ? (parent[x] = x) : (parent[x] = find(parent[x]));
    recs.forEach(r => find(r.id));
    for (let i = 0; i < recs.length; i++) for (let j = i + 1; j < recs.length; j++) {
      let best = null;
      for (const a of recs[i].threads || []) for (const b of recs[j].threads || []) { const m = strength(a, recs[i], b, recs[j]); if (m.s >= .35 && (!best || m.s > best.s)) best = { ...m, a, b }; }
      if (best) { edges.push({ from: recs[i].id, to: recs[j].id, strength: best.s, shared: best.shared, title: best.b.title }); parent[find(recs[i].id)] = find(recs[j].id); }
    }
    const groups = {};
    recs.forEach(r => { const k = find(r.id); (groups[k] = groups[k] || []).push(r); });
    const clusters = Object.values(groups).filter(g => g.length > 1).map((g, i) => {
      const words = {}; edges.filter(e => g.some(r => r.id === e.from) && g.some(r => r.id === e.to)).forEach(e => e.shared.forEach(w => words[w] = (words[w] || 0) + 1));
      return { id: 'k' + i, recordings: g.map(r => r.id), theme: Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]).join(', ') };
    });
    const clusterOf = {}; clusters.forEach(c => c.recordings.forEach(id => clusterOf[id] = c.id));
    return { edges, clusters, clusterOf, waiting: waiting(recs) };
  }

  /* threads opened in past recordings and never closed, gathered across recordings, the most recurrent first */
  function waiting(recs) {
    const groups = [];
    for (const r of [...(recs || past)].sort((a, b) => (a.at || 0) - (b.at || 0))) for (const t of r.threads || []) {
      let g = groups.find(x => x.members.some(m => strength(m.thread, m.rec, t, r).s >= .34));
      if (!g) { g = { members: [] }; groups.push(g); }
      g.members.push({ rec: r, thread: t });
    }
    return groups.map(g => {
      const lastM = g.members[g.members.length - 1];
      return { key: lastM.rec.id + ':' + lastM.thread.id, title: lastM.thread.title, kind: lastM.thread.kind, count: new Set(g.members.map(m => m.rec.id)).size,
        lastAt: lastM.rec.at, firstAt: g.members[0].rec.at, need: lastM.thread.need, state: lastM.thread.state, keywords: lastM.thread.keywords || [], members: g.members };
    }).filter(g => g.state !== 'closed').sort((a, b) => b.count - a.count || (b.lastAt || 0) - (a.lastAt || 0)).slice(0, 12);
  }

  /* every recording that touched a thread (this session's, by id, or a waiting one, by key) */
  function timeline(key) {
    const a = last; if (!a) return [];
    const cur = a.current.find(c => c.thread.id === key);
    if (cur) return cur.matches.map(m => ({ rec: m.rec, thread: m.thread, strength: m.strength, shared: m.shared })).sort((x, y) => (x.rec.at || 0) - (y.rec.at || 0));
    const w = a.waiting.find(x => x.key === key);
    return w ? w.members.map(m => ({ rec: m.rec, thread: m.thread, strength: 1, shared: [] })) : [];
  }
  function search(q) {
    q = String(q || '').trim().toLowerCase(); if (q.length < 2) return [];
    const out = [];
    for (const r of past) for (const t of r.threads || []) {
      const hay = [t.title, t.first, ...(t.keywords || [])].join(' ').toLowerCase();
      if (hay.includes(q)) out.push({ rec: r, thread: t });
    }
    return out.slice(0, 40);
  }
  /* the steering's offer: a waiting thread this talk has come near, or, at the start, the most recurrent one */
  function offer(threads) {
    const a = last; if (!a || !a.waiting.length) return null;
    for (const c of a.current) for (const m of c.matches) {
      const w = a.waiting.find(x => x.members.some(y => y.rec.id === m.rec.id && y.thread.id === m.thread.id));
      if (w && m.strength >= .4) return { id: 'pickup', text: `Pick up “${w.title}” from ${day(w.lastAt)}.${w.need ? ' It was left ' + w.need.replace(/^needs/, 'needing') + '.' : ''}`, why: `${w.count === 1 ? 'one recording' : w.count + ' recordings'} left it open`, thread: c.thread.id };
    }
    if ((threads || []).length <= 1) { const w = a.waiting[0]; return { id: 'pickup', text: `Pick up “${w.title}” from ${day(w.lastAt)}.`, why: `${w.count === 1 ? 'one recording' : w.count + ' recordings'} left it open` }; }
    return null;
  }

  /* ── the panel ── */
  function panel(el, { open, preview } = {}) {
    el.classList.add('lk');
    el.innerHTML = `<div class="lkhead"><b>links</b><input class="lkq" placeholder="search every thread" autocomplete="off"><span class="lkmark" hidden>preview</span></div><div class="scroll lkbody"></div>`;
    const body = el.querySelector('.lkbody'), q = el.querySelector('.lkq'), mark = el.querySelector('.lkmark');
    let focus = null, a = null, isPreview = false;
    const color = k => (R && R.COLORS[R.IMAGE[k]]) || '#7d9a78';
    const bar = v => `<span class="lkbar"><i style="width:${Math.round(v * 100)}%"></i></span>`;
    function rec(r, extra = '') { return `<button class="lkrec" data-rec="${esc(r.id)}"><b>${esc(r.title)}</b><span>${day(r.at)}${r.kind ? ' · ' + esc(r.kind) : ''}${r.source === 'library' ? ' · another device' : ''}${extra}</span></button>`; }
    /* why two threads are linked: the words they share (as said), how alike they mean, whether the form is the same */
    const why = m => [m.shared && m.shared.length ? 'shares ' + m.shared.slice(0, 4).map(w => `<q>${esc(w)}</q>`).join(', ') : 'no words in common',
      m.meaning != null ? `meaning ${Math.round(Math.max(0, m.meaning) * 100)}%` : '', m.form ? 'same form' : '', m.edge ? esc(m.edge) : ''].filter(Boolean).join(' · ');
    let scope = 'me', apps = new Set(IX ? IX.APPS : []), fromIndex = null;
    function filters() {
      if (!IX || IX.status !== 'ready') return '';
      return `<div class="lkf">${IX.SCOPES.map(s => `<button class="${s === scope ? 'on' : ''}" data-scope="${s}">${s === 'me' ? 'mine' : s === 'cohort' ? 'my cohort' : 'public'}</button>`).join('')}</div>
        <div class="lkf">${IX.APPS.map(a => `<button class="${apps.has(a) ? 'on' : ''}" data-app="${a}">${a}</button>`).join('')}</div>`;
    }
    async function fromTheIndex() {
      if (!IX || !q.value.trim()) return null;
      fromIndex = await IX.search({ q: q.value.trim(), scope, apps: [...apps] }); if (a) draw(a);
    }
    function draw(an, prev) {
      a = an; isPreview = !!prev; mark.hidden = !prev; el.classList.toggle('lkpreview', !!prev);
      if (!a) { body.innerHTML = ''; return; }
      if (q.value.trim().length >= 2 && !prev) return drawSearch();
      const sp = VW && VW.SPEAKER || {};
      let h = filters() + '<h4>this session, against every recording</h4>';
      h += a.current.length ? a.current.map(c => `<div class="lkthr ${focus === c.thread.id ? 'on' : ''}" data-t="${esc(c.thread.id)}"><div class="lkt"><span style="color:${color(c.thread.kind)}">${esc(c.thread.title)}</span>
          <em style="color:${sp[c.thread.opened_by] || 'inherit'}">${esc(c.thread.opened_by || '')}</em><small>${c.matches.length ? c.matches.length + (c.matches.length === 1 ? ' recording' : ' recordings') : 'new here'}</small></div>
          ${c.matches.slice(0, 3).map(m => `<div class="lkm" data-rec="${esc(m.rec.id)}" data-at="${m.thread.opened_at || ''}">${bar(m.strength)}<span>${esc(m.rec.title)} · ${day(m.rec.at)}${m.thread.opened_by ? ' · ' + esc(m.thread.opened_by) : ''}</span></div>
            <div class="lkwhy">${why(m)}</div>`).join('')}</div>`).join('')
        : '<p class="quiet">Threads appear as ideas open.</p>';
      if (focus) {
        const tl = timeline(focus);
        h += `<h4>its timeline</h4>` + (tl.length ? tl.map(x => `<div class="lktl">${rec(x.rec, ' · ' + esc(VW && VW.STATE_WORD[x.thread.state] || x.thread.state || ''))}<p>“${esc(x.thread.first || '')}”</p>${x.thread.room ? `<small>the room: ${x.thread.room.votes || 0} asked for more</small>` : ''}${x.thread.connection ? `<small>Jev: ${esc(x.thread.connection.relation)} “${esc(x.thread.connection.past)}”</small>` : ''}</div>`).join('') : '<p class="quiet">No earlier recording touched it.</p>');
      }
      h += '<h4>waiting threads</h4>' + (a.waiting.length ? a.waiting.map(w => `<div class="lkw" data-w="${esc(w.key)}"><b>${esc(w.title)}</b><span>${w.count === 1 ? 'left open once' : 'open in ' + w.count + ' recordings'} · last ${day(w.lastAt)}${w.need ? ' · ' + esc(w.need) : ''}</span></div>`).join('') : '<p class="quiet">Every earlier thread has landed.</p>');
      if (a.clusters.length) h += '<h4>themes</h4>' + a.clusters.map(k => `<div class="lkk"><b>${esc(k.theme || 'a theme')}</b><span>${k.recordings.length} recordings</span></div>`).join('');
      body.innerHTML = h; wire();
    }
    function drawSearch() {
      const res = search(q.value);
      body.innerHTML = filters() + `<h4>${res.length} threads here</h4>` + res.map(x => `<div class="lktl">${rec(x.rec)}<p><b>${esc(x.thread.title)}</b> · “${esc(x.thread.first || '')}”</p></div>`).join('') +
        (fromIndex ? `<h4>${fromIndex.length} across every app</h4>` + fromIndex.map(r => `<div class="lktl"><b>${esc(r.title)}</b><span class="lksub">${esc(r.app)} · ${r.at ? day(r.at) : ''} · ${esc(r.scope)}</span><div class="lkwhy">${why(r)}</div><p>“${esc(r.first)}”</p></div>`).join('') : '');
      wire();
    }
    function wire() {
      if (isPreview) return;
      body.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { focus = focus === b.dataset.t ? null : b.dataset.t; draw(a); });
      body.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { focus = focus === b.dataset.w ? null : b.dataset.w; draw(a); });
      body.querySelectorAll('[data-rec]').forEach(b => b.onclick = e => { e.stopPropagation(); const r = past.find(x => x.id === b.dataset.rec); if (!r || !open) return;
        const t = (timeline(focus || '').find(x => x.rec.id === r.id) || {}).thread; open(r, b.dataset.at ? +b.dataset.at : t ? t.opened_at : null); });
      body.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => { scope = b.dataset.scope; fromTheIndex(); draw(a); });
      body.querySelectorAll('[data-app]').forEach(b => b.onclick = () => { apps.has(b.dataset.app) ? apps.delete(b.dataset.app) : apps.add(b.dataset.app); fromTheIndex(); draw(a); });
    }
    let qt = null; q.addEventListener('input', () => { if (a) draw(a); clearTimeout(qt); qt = setTimeout(fromTheIndex, 500); });
    return { draw };
  }

  const css = `.lk{display:flex;flex-direction:column;min-height:0;flex:1}.lkhead{display:flex;align-items:center;gap:10px;padding:10px 14px 6px;border-bottom:1px solid var(--faint)}
.lkhead b{color:var(--green);font-weight:500;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase}.lkq{flex:1;min-width:0;background:#000;color:var(--ink);border:1px solid var(--faint);border-radius:10px;padding:7px 9px;font:inherit;font-size:12px}
.lkmark,.pvmark{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);border:1px solid rgba(255,201,74,.5);border-radius:99px;padding:2px 7px}
.lkpreview .lkbody{opacity:.5}.lkbody h4{margin:14px 0 6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--green);font-weight:500}.lkbody h4:first-child{margin-top:4px}
.lkthr,.lkw,.lkk,.lktl{border:1px solid var(--faint);border-radius:12px;padding:8px 10px;margin-bottom:6px;cursor:pointer;background:#030503}.lkthr.on{border-color:var(--green-dim)}
.lkt{display:flex;gap:8px;align-items:baseline}.lkt span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lkt em{font-style:normal;font-size:11px}.lkt small,.lkw span,.lkk span{color:var(--muted);font-size:10.5px}
.lkm{display:flex;align-items:center;gap:8px;margin-top:5px;font-size:11px;color:var(--muted)}.lkm span:last-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lkbar{flex:0 0 48px;height:5px;border-radius:3px;background:#0d130c;overflow:hidden}.lkbar i{display:block;height:100%;background:var(--amber)}
.lkw b,.lkk b{display:block;font-weight:500}.lkw{border-color:rgba(255,201,74,.35)}.lktl p{margin:4px 0 0;font-size:11.5px;color:var(--muted);line-height:1.45}.lktl small{display:block;color:var(--amber);font-size:10.5px;margin-top:3px}
.lkwhy{font-size:10.5px;color:var(--muted);margin:2px 0 4px 56px;line-height:1.4}.lkwhy q{color:var(--amber)}.lksub{display:block;color:var(--muted);font-size:10.5px}
.lkf{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 6px}.lkf button{font:inherit;font-size:10.5px;padding:3px 9px;border-radius:99px;border:1px solid var(--faint);background:none;color:var(--muted);cursor:pointer}.lkf button.on{color:var(--green);border-color:var(--green-dim)}
.lkrec{display:block;width:100%;text-align:left;font:inherit;background:none;border:none;color:var(--ink);padding:0;cursor:pointer}.lkrec b{font-weight:500}.lkrec span{display:block;color:var(--muted);font-size:10.5px}`;
  if (typeof document !== 'undefined') { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }
  root.SpeechformLinks = { refresh, analyze, waiting, timeline, search, offer, panel, strength, stemmed, get past() { return past; }, get last() { return last; }, day };
})(this);
