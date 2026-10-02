/* Speechform: the deck. The cards a person's recordings have become, and the sections they have classified.
 *
 * store: where cards live. The Speechform server keeps them (and draws their clear side on the easel);
 *        without it, Light keeps them in this browser with their abstract side only.
 */
(function (root) {
  'use strict';
  const R = root.SpeechformReading;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICON = {
    cards: '<rect x="5" y="3.5" width="11" height="15" rx="2"/><path d="M8.5 21h9a2 2 0 0 0 2-2V7"/>',
    sections: '<path d="M4 6h10M4 10h16M4 14h7M4 18h13"/><path d="M15 12.5l2.5 1.5v3l-2.5 1.5-2.5-1.5v-3z"/>',
    make: '<rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M12 9v6M9 12h6"/>',
    save: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    pause: '<path d="M8 5.5v13M16 5.5v13"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    reading: '<path d="M4 19V11M9 19V6M14 19v-9M19 19v-5"/>',
  };
  const svg = k => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
  const VI = (root.SpeechformViews || {}).ICON || {};
  /* the tabs beside an opened card: its transcript, its reading, and every graph */
  const DTABS = [['transcript', VI.transcript || ICON.sections], ['reading', ICON.reading], ...['bars', 'river', 'window', 'build', 'shape', 'ideas'].map(k => [k, VI[k] || ''])];
  /* with steering (Studio): the depth and steering views over time, and the loose ends with what could have closed them */
  const STABS = [...['lenses', 'arc', 'threads', 'pulse', 'airtime', 'questions', 'links'].map(k => [k, VI[k] || '']), ['loose', '<path d="M4 7c4 0 6 3 16 3M4 14h9"/><circle cx="16.5" cy="14" r="2.2"/><path d="M16.5 16.2v3"/>']];
  const LOCAL = 'speechform-light:cards', LOCAL_SECTIONS = 'speechform-light:sections';
  const local = { get(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } },
                  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } } };
  const done = c => !c || !/^(waiting|asking Jev|the easel is drawing)$/.test(c.art || '');

  function mount({ page, server, onSection, steer = false }) {
    const TABS = steer ? [...DTABS, ...STABS] : DTABS;
    let tab = 'cards', list = [], secs = [], open = null, side = 'front', timer = null;
    /* the server may be this page's own, or the one on this Mac (Studio on the public site), or answered in the browser */
    const base = () => (root.SpeechformLocal && root.SpeechformLocal.base()) || '';
    const url = (c, f) => c && c.urls && c.urls[f] ? c.urls[f] : /^(data|blob|https?):/.test(String(f)) ? f : server ? `${base()}/cards/${encodeURIComponent(c.id)}/${f}` : f;
    /* a card from the account's library carries its JSON with it and its files as signed addresses */
    const getFile = (c, f) => c && c.inline && f in c.inline ? Promise.resolve(new Response(JSON.stringify(c.inline[f]), { headers: { 'content-type': 'application/json' } })) : fetch(url(c, f));
    const images = {};
    const img = src => new Promise(res => { if (!src) return res(null); if (images[src]) return res(images[src]); const i = new Image(); if ((base() || /^https?:/.test(src)) && !src.startsWith('data:')) i.crossOrigin = 'anonymous'; i.onload = () => { images[src] = i; res(i); }; i.onerror = () => res(null); i.src = src; });
    const art = async c => ({ abstract: await img(c.abstract && (c.abstract.startsWith('data:') ? c.abstract : url(c, c.abstract))),
                              clear: await img(c.clear && (c.clear.startsWith('data:') ? c.clear : url(c, c.clear) + '?' + (c.bank || ''))) });

    page.innerHTML = `<div class="deckbar"><button class="vchip on" data-t="cards" title="cards" aria-label="cards">${svg('cards')}</button>
      <button class="vchip" data-t="sections" title="sections" aria-label="sections">${svg('sections')}</button><span style="flex:1"></span>
      <button class="vchip" data-make title="make a card of this session" aria-label="make a card">${svg('make')}</button></div>
      <p class="jevline" id="jevline"></p>
      <div class="scroll deck" id="deckList"></div>`;
    const sheet = document.createElement('div'); sheet.className = 'cardsheet'; sheet.hidden = true;
    sheet.innerHTML = `<div class="cardhold"><div class="cardcol"><canvas class="bigcard"></canvas><p class="cardart"></p>
      <div class="cardtools"><button class="vchip" data-save title="save" aria-label="save">${svg('save')}</button><button class="vchip" data-folder title="open its folder" aria-label="open its folder">${svg('folder')}</button><button class="vchip" data-close title="close" aria-label="close">${svg('close')}</button></div></div>
      <div class="carddetail"><audio preload="auto"></audio>
        <div class="dplay"><button class="vchip" data-play title="play" aria-label="play">${svg('play')}</button><input type="range" class="dscrub" min="0" max="1000" value="1000"><span class="dtime"></span></div>
        <div class="dtabs">${TABS.map(([k, icon]) => `<button class="vchip" data-d="${k}" title="${k}" aria-label="${k}"><svg viewBox="0 0 24 24">${icon}</svg></button>`).join('')}</div>
        <div class="dtrans"></div><pre class="dtext"></pre><div class="dloose"></div><div class="dview"><canvas></canvas><p class="dnote"></p></div></div></div>`;
    document.body.appendChild(sheet);
    let big = sheet.querySelector('canvas');
    /* a card is drawn once; if the browser takes its canvas back (the easel shares the GPU), it is drawn again */
    const fresh = cv => { if (!cv.getContext('2d').isContextLost()) return cv; const n = cv.cloneNode(); cv.replaceWith(n); return n; };
    const flip = () => { big.classList.add('flip'); setTimeout(async () => { side = side === 'front' ? 'back' : 'front'; big = fresh(big); big.onclick = flip; R.drawCard(big, open, await art(open), side); big.classList.remove('flip'); }, 180); };
    big.addEventListener('contextrestored', () => open && art(open).then(a => R.drawCard(big, open, a, side)));
    page.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; page.querySelectorAll('[data-t]').forEach(q => q.classList.toggle('on', q === b)); draw(); });
    sheet.querySelector('[data-close]').onclick = () => { sheet.hidden = true; open = null; sheet.querySelector('audio').pause(); };
    sheet.querySelector('[data-folder]').onclick = () => open && server && !open.library && fetch(`/cards/${encodeURIComponent(open.id)}/reveal`, { method: 'POST', body: '{}' });
    /* everything kept with the recording, and its replay: press play and the audio, the transcript and every
       graph move through the recording as it happened; drag the line to go anywhere in it */
    let doc = 'transcript', P = [], ideaTitles = {}, since = 0, clock = null, playing = false;
    const box = sheet.querySelector('.carddetail'), au = box.querySelector('audio'), scrub = box.querySelector('.dscrub');
    const VW = root.SpeechformViews, view = VW && VW.renderer(box.querySelector('.dview canvas'), { note: box.querySelector('.dnote'), start: 'river',
      onPick: id => { const p = P.find(q => q.id === id); if (p) seek(p.at - since + .01); } });
    const length = () => Math.max((au.src && isFinite(au.duration) && au.duration) || 0, P.length ? P[P.length - 1].at - since + 4 : 1);
    /* the replay's own clock leads; the audio plays beside it and, while it plays, keeps the clock in step */
    const now = () => {
      if (!clock) return Infinity;
      if (clock.still) return clock.t0;
      if (au.src && !au.paused && au.readyState >= 3 && au.currentTime > 0) { clock = { t0: au.currentTime, at: performance.now() }; return au.currentTime; }
      return clock.t0 + (performance.now() - clock.at) / 1000;
    };
    const traceAt = t => {
      const cut = P.filter(p => (p.at || 0) - since <= t), ideas = {};
      cut.forEach((p, i) => { const it = ideas[p.idea] || (ideas[p.idea] = { id: p.idea, title: ideaTitles[p.idea] || 'an idea', words: 0, returns: 0, n: 0 });
        it.words += (p.text || '').split(/\s+/).length; it.n++; if (i && cut[i - 1].idea !== p.idea && cut.slice(0, i).some(q => q.idea === p.idea)) it.returns++; });
      return { kinds: Object.keys(R.IMAGE), color: k => R.COLORS[R.IMAGE[k]] || '#39ff14', focus: null, windowWords: 120, recency: 30, now: since + t,
        ideas: Object.values(ideas), active: cut.length ? cut[cut.length - 1].idea : null, phrases: cut };
    };
    const clockText = t => { const s2 = Math.max(0, Math.floor(t)); return `${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, '0')}`; };
    function frame() {
      const t = now(), L = length(), full = t === Infinity, tt = full ? L : Math.min(t, L);
      if (!full && document.activeElement !== scrub) scrub.value = Math.round(tt / L * 1000);
      box.querySelector('.dtime').textContent = full ? clockText(L) : `${clockText(tt)} / ${clockText(L)}`;
      const T = traceAt(full ? 1e9 : tt); if (view) view.set(T);
      /* the transcript follows: said lines lit, the line being said marked, the rest waiting */
      const lines = box.querySelectorAll('.dline'), said = T.phrases.length;
      lines.forEach((l, i) => { l.classList.toggle('future', i >= said); l.classList.toggle('current', !full && i === said - 1); });
      if (!full && playing && lines[said - 1]) { const c = box.querySelector('.dtrans'), l = lines[said - 1]; if (l.offsetTop < c.scrollTop || l.offsetTop > c.scrollTop + c.clientHeight - 40) c.scrollTop = l.offsetTop - 40; }
      if (playing && tt >= L - .02) pause();
      if (playing) requestAnimationFrame(frame);
    }
    function seek(t) {
      t = Math.max(0, Math.min(length(), t));
      if (au.src) { try { au.currentTime = t; } catch (e) {} }
      clock = playing ? { t0: t, at: performance.now() } : { t0: t, still: true }; frame();
    }
    function play() {
      let t = clock && clock.still ? clock.t0 : 0; if (t >= length() - .05) t = 0;
      clock = { t0: t, at: performance.now() };
      if (au.src) { try { au.currentTime = t; } catch (e) {} au.play().catch(() => {}); }
      playing = true; box.querySelector('[data-play]').innerHTML = svg('pause'); requestAnimationFrame(frame);
    }
    function pause() { const t = now(); playing = false; au.pause(); clock = { t0: t === Infinity ? length() : t, still: true }; box.querySelector('[data-play]').innerHTML = svg('play'); }
    box.querySelector('[data-play]').onclick = () => playing ? pause() : play();
    scrub.oninput = () => seek(scrub.value / 1000 * length());
    au.onended = () => { if (playing) pause(); };
    function showDoc() {
      box.querySelectorAll('[data-d]').forEach(b => b.classList.toggle('on', b.dataset.d === doc));
      box.querySelector('.dtrans').hidden = doc !== 'transcript'; box.querySelector('.dtext').hidden = doc !== 'reading'; box.querySelector('.dloose').hidden = doc !== 'loose';
      box.querySelector('.dview').hidden = doc === 'transcript' || doc === 'reading' || doc === 'loose';
      if (view && !box.querySelector('.dview').hidden) view.setView(doc);
      frame();
    }
    box.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { doc = b.dataset.d; showDoc(); });
    let loadedFor = null;
    const detail = async () => {
      box.hidden = !server || !open; if (box.hidden) return;
      const src = open.audio ? url(open, open.audio) : '';
      if (au.dataset.for !== src) { au.dataset.for = src; if (src) au.src = src; else au.removeAttribute('src'); }
      if (loadedFor !== open.id) {
        loadedFor = open.id; pause(); clock = null; P = []; since = open.since || 0;
        ideaTitles = Object.fromEntries(((open.reading || {}).ideas || []).map(i => [i.id, i.title]));
        try { const r = await getFile(open, 'phrases.json'); P = r.ok ? (await r.json()).filter(p => p.ranked) : []; } catch (e) {}
        if (!since && P.length) since = P[0].at - 2;
        box.querySelector('.dtrans').innerHTML = P.map(p => `<div class="dline"><span class="dt">${clockText((p.at || 0) - since)}</span> <span class="dk" style="color:${R.COLORS[R.IMAGE[p.kind]] || '#7d9a78'}">${esc(p.kind)}</span><div>${esc(p.text)}</div></div>`).join('');
        box.querySelectorAll('.dline').forEach((l, i) => l.onclick = () => seek((P[i].at || 0) - since + .01));
      }
      try { const r = await getFile(open, 'reading.txt'); box.querySelector('.dtext').textContent = r.ok ? await r.text() : ''; } catch (e) {}
      if (steer) {
        /* the loose ends: every thread, its state and stage, and how each open one could have continued or closed */
        let th = [];
        try { const r = await getFile(open, 'threads.json'); th = r.ok ? (await r.json()).threads || [] : []; } catch (e) {}
        const SP = (root.SpeechformViews || {}).SPEAKER || {}, WORD = (root.SpeechformViews || {}).STATE_WORD || {};
        box.querySelector('.dloose').innerHTML = th.length ? th.map(t => `<div class="dthr ${esc(t.state)}"><b>${esc(t.title || 'a thread')}</b>
          <span>${esc(WORD[t.state] || t.state)}${t.stage ? ' · at ' + esc(t.stage) : ''}${t.need && t.state !== 'closed' ? ' · ' + esc(t.need) : ''} · opened by <i style="color:${SP[t.opened_by] || 'inherit'}">${esc(t.opened_by)}</i></span>
          ${t.suggestion ? `<p><em>${t.suggestion.by === 'Jev' ? 'Jev' : 'The algorithm'}:</em> ${esc(t.suggestion.move)}</p>` : ''}${t.link ? `<p class="pk">Picked up from ${esc(t.link.date)}: “${esc(t.link.title)}”.</p>` : ''}
          <p class="first">“${esc(t.first || '')}”</p></div>`).join('') : '<p class="quiet">No threads were kept with this recording.</p>';
        box.querySelectorAll('.dthr').forEach((el, i) => el.onclick = () => { const p = P.find(q => q.at >= (th[i].opened_at || 0) - .01); if (p) seek(p.at - since + .01); });
      }
      showDoc();
    };
    sheet.onclick = e => { if (e.target === sheet) { sheet.hidden = true; open = null; au.pause(); playing = false; } };
    /* tap the card to flip it: the clear art on the front, the grown image and the whole reading on the back */
    big.onclick = flip;
    sheet.querySelector('[data-save]').onclick = () => { const a = document.createElement('a'); a.download = (open.name || 'card').replace(/\W+/g, '-').toLowerCase() + '-' + side + '.png'; a.href = big.toDataURL('image/png'); a.click(); };

    async function load() {
      if (server) {
        try { list = (await (await fetch('/cards')).json()).cards; secs = (await (await fetch('/sections')).json()).sections; } catch (e) { list = []; }
      } else { list = local.get(LOCAL); secs = local.get(LOCAL_SECTIONS); }
    }
    /* how near the classifier is to not needing Jev */
    async function jevLine() {
      if (!server) return;
      try {
        const j = await (await fetch('/learned')).json(), st = j.jev || {}, rules = Object.values(j.rules || {}).reduce((a, l) => a + l.length, 0);
        const recent = (st.recent || []).map(v => Math.round(v * 100) + '%').join(' · ');
        page.querySelector('#jevline').innerHTML = !st.recordings ? '' : st.graduated
          ? `The classifier agrees with Jev on nine passages in ten, so Jev now reads only every ${st.check_every}th recording. It has learned from ${(j.learned || []).length} passages and keeps ${rules} rules Claude wrote.`
          : `Agreement with Jev, last recordings: <b>${recent || 'none yet'}</b>. Jev is no longer needed at ${Math.round(st.need * 100)}% for ${st.in_a_row} in a row. It has learned from ${(j.learned || []).length} passages and keeps ${rules} rules Claude wrote.`;
      } catch (e) {}
    }
    async function draw() {
      await load(); jevLine();
      const box = page.querySelector('#deckList');
      if (tab === 'cards') {
        box.innerHTML = list.length ? '<div class="deckgrid">' + list.map(c => `<button class="minicard" data-id="${esc(c.id)}"><canvas></canvas></button>`).join('') + '</div>'
          : '<p class="quiet" style="padding:8px">Each recording becomes a card when you stop.</p>';
        if (server) list.filter(c => done(c) && !c.faces).forEach(c => { c.faces = true; keepFaces(c); });   // every finished card gets its two images
        box.querySelectorAll('.minicard').forEach(async b => { const c = list.find(x => x.id === b.dataset.id), cv = b.querySelector('canvas'), a = await art(c);
          R.drawCard(cv, c, a); cv.addEventListener('contextrestored', () => R.drawCard(cv, c, a)); b.onclick = () => show(c); });
      } else {
        box.innerHTML = secs.length ? secs.map((s, i) => `<div class="line" data-i="${i}"><div class="said">${esc(s.text)}</div><div class="meta">${(s.profile || []).slice(0, 3).map(([k, v]) =>
          `<span class="chip" style="color:${R.COLORS[R.IMAGE[k]] || '#7d9a78'}">${esc(k)} ${Math.round(v * 100)}%</span>`).join('')}${steer && s.depth && s.depth.lenses ? `<span class="dmeters" title="listener, speaker, absorption">${['listener', 'speaker', 'absorption'].map(l =>
          `<i style="height:${Math.round(4 + 14 * s.depth.lenses[l].meter)}px;background:${R.COLORS[R.IMAGE[s.depth.kind]] || '#39ff14'}"></i>`).join('')}</span>` : ''}</div></div>`).join('')
          : '<p class="quiet" style="padding:8px">Select any words in the transcript and tap the hexagon to classify them.</p>';
        box.querySelectorAll('.line[data-i]').forEach(l => l.onclick = () => onSection && onSection(secs[+l.dataset.i]));
      }
    }
    async function show(c) {
      open = c; side = 'front'; sheet.hidden = false;
      const paint = async () => { big = fresh(big); big.onclick = flip; R.drawCard(big, open, await art(open), side); sheet.querySelector('.cardart').textContent = open.art && open.art !== 'waiting' ? open.art : ''; detail(); };
      await paint();
      clearInterval(timer);
      if (!done(c) && server) timer = setInterval(async () => {
        try { const all = (await (await fetch('/cards')).json()).cards; const now = all.find(x => x.id === c.id); if (now) { open = now; await paint(); if (done(now)) { clearInterval(timer); draw(); keepFaces(now); } } } catch (e) {}
      }, 1200);
    }

    /* both sides of a finished card, as images, into its recording's folder */
    async function keepFaces(c) {
      const a = await art(c), f = document.createElement('canvas'), b = document.createElement('canvas');
      R.drawCard(f, c, a, 'front'); R.drawCard(b, c, a, 'back');
      fetch(`/cards/${encodeURIComponent(c.id)}/faces`, { method: 'POST', body: JSON.stringify({ front: f.toDataURL('image/png'), back: b.toDataURL('image/png') }) });
    }
    /* a recording becomes a card: read it, write the card, keep it (with its phrases and audio), and open it */
    async function make({ phrases, ideas, text, abstract, audio, since, threads, session }) {
      const reading = R.read(phrases, ideas); if (!reading) return null;
      await load();
      const card = { ...R.card(reading, list), reading };
      let kept;
      if (server) kept = await (await fetch('/card', { method: 'POST', body: JSON.stringify({ card, text, abstract, audio, since, phrases, threads, session }) })).json();
      else { kept = { ...card, id: 'c' + Date.now().toString(36), abstract, art: 'kept abstract: the easel runs with the Speechform server' }; const all = local.get(LOCAL); all.unshift(kept); local.set(LOCAL, all.slice(0, 30)); }
      draw(); show(kept); return kept;
    }
    async function keepSection(section) {
      if (server) await fetch('/sections', { method: 'POST', body: JSON.stringify(section) });
      else { const all = local.get(LOCAL_SECTIONS); all.unshift(section); local.set(LOCAL_SECTIONS, all.slice(0, 300)); }
      if (tab === 'sections') draw();
    }
    draw();
    return { make, keepSection, draw, open: c => show(c), show: t => { tab = t; page.querySelectorAll('[data-t]').forEach(q => q.classList.toggle('on', q.dataset.t === t)); draw(); }, onMake: f => page.querySelector('[data-make]').onclick = f };
  }

  /* the style every page shares for the deck */
  const css = `.deckbar{display:flex;align-items:center;gap:2px;padding:6px 8px 2px;border-bottom:1px solid var(--faint)}
.jevline{margin:0;padding:6px 12px 0;color:var(--muted,#7d9a78);font-size:10.5px;line-height:1.45}.jevline:empty{display:none}.jevline b{color:var(--amber,#ffc94a);font-weight:500}
.deckgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
.minicard{padding:0;border:none;background:none;cursor:pointer;transition:transform .18s}
.minicard:hover{transform:translateY(-3px) scale(1.03)}
.minicard canvas{width:100%;display:block;border-radius:6px}
.cardsheet{position:fixed;inset:0;background:rgba(0,0,0,.8);display:grid;place-items:center;z-index:20;padding:16px}
.cardsheet[hidden]{display:none}
.cardhold{display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:18px;max-height:100%;overflow:auto}
.cardcol{display:flex;flex-direction:column;align-items:center;gap:8px}
.carddetail{width:min(440px,92vw);max-height:78vh;display:flex;flex-direction:column;gap:8px;background:var(--panel,#070907);border:2px solid var(--green-dim,rgba(57,255,20,.35));border-radius:14px;padding:12px}
.carddetail[hidden]{display:none}
.carddetail{height:min(78vh,720px)}
.carddetail audio{display:none}
.dplay{display:flex;align-items:center;gap:8px}
.dscrub{flex:1;accent-color:#ffc94a}
.dtime{font:11px ui-monospace,Menlo,monospace;color:var(--muted,#7d9a78);min-width:78px;text-align:right}
.dtabs{flex-wrap:wrap}
.dtrans{flex:1;min-height:0;overflow:auto;font:12.5px/1.5 ui-monospace,Menlo,monospace;position:relative}
.dtrans[hidden],.dtext[hidden],.dview[hidden]{display:none}
.dline{padding:6px 8px;border-radius:8px;cursor:pointer;transition:opacity .3s,background .3s}
.dline:hover{background:rgba(255,255,255,.03)}
.dline.future{opacity:.3}
.dline.current{background:rgba(255,201,74,.12);outline:1px solid rgba(255,201,74,.5)}
.dt{color:var(--muted,#7d9a78);font-size:10.5px}.dk{font-size:10.5px}
.dview{flex:1;min-height:0;display:flex;flex-direction:column}
.dview canvas{flex:1;min-height:0;width:100%;display:block;cursor:pointer}
.dnote{margin:6px 0 0;color:var(--muted,#7d9a78);font-size:10.5px;line-height:1.45}
.dtabs{display:flex;gap:2px}
.dloose{flex:1;min-height:0;overflow:auto;font:12px/1.5 ui-monospace,Menlo,monospace;display:flex;flex-direction:column;gap:8px}
.dloose[hidden]{display:none}
.dthr{border:1px solid var(--faint,#2a3a28);border-radius:10px;padding:8px 10px;cursor:pointer}
.dthr:hover{border-color:var(--green-dim,rgba(57,255,20,.35))}
.dthr b{font-weight:500;display:block}.dthr span{color:var(--muted,#7d9a78);font-size:10.5px}.dthr i{font-style:normal}
.dthr p{margin:4px 0 0}.dthr em{font-style:normal;color:var(--amber,#ffc94a)}.dthr .first{color:var(--muted,#7d9a78)}.dthr .pk{color:var(--amber,#ffc94a)}
.dthr.ready{border-color:rgba(255,201,74,.5)}.dthr.closed b{color:var(--green,#39ff14)}
.dmeters{display:inline-flex;align-items:flex-end;gap:2px;height:18px;margin-left:4px}.dmeters i{width:5px;border-radius:1px;display:block}
.dtext{flex:1;min-height:0;overflow:auto;margin:0;white-space:pre-wrap;font:12px/1.55 ui-monospace,Menlo,monospace;color:var(--ink,#e8f5e4)}
.bigcard{height:min(78vh,720px);max-width:92vw;object-fit:contain;cursor:pointer;transition:transform .18s ease-in;animation:cardin .5s cubic-bezier(.2,.8,.2,1)}
.bigcard.flip{transform:scaleX(0)}
@keyframes cardin{from{transform:translateY(24px) scale(.94);opacity:0}}
.cardart{margin:0;color:var(--muted);font-size:11px;min-height:14px}
.cardtools{display:flex;gap:6px}
.selhex{position:fixed;z-index:15;width:34px;height:34px;padding:0;border:none;background:none;color:var(--amber);cursor:pointer;filter:drop-shadow(0 0 6px rgba(255,201,74,.5))}
.selhex svg{width:34px;height:34px;fill:rgba(0,0,0,.7);stroke:currentColor;stroke-width:1.5}`;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  /* select words in the transcript, and a hexagon appears to classify them */
  function selector(box, onPick) {
    const b = document.createElement('button'); b.className = 'selhex'; b.hidden = true; b.title = 'classify these words'; b.setAttribute('aria-label', 'classify these words');
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><path d="M8 12h8M12 8v8" stroke-width="1.8"/></svg>';
    document.body.appendChild(b);
    let text = '';
    const check = () => setTimeout(() => {
      const s = getSelection(); text = '';
      if (s && s.rangeCount && s.toString().trim()) {
        /* only the words said: the labels between the lines are left out */
        const frag = s.getRangeAt(0).cloneContents(); frag.querySelectorAll('.meta, .who, .chip').forEach(n => n.remove());
        const said = [...frag.querySelectorAll('.said')].map(n => n.textContent.trim());
        text = (said.length ? said.join(' ') : frag.textContent).replace(/\s+/g, ' ').trim();
      }
      if (!text || text.split(/\s+/).length < 3 || !box.contains(s.anchorNode)) { b.hidden = true; return; }
      const r = s.getRangeAt(0).getBoundingClientRect();
      b.style.left = Math.min(innerWidth - 40, r.right + 4) + 'px'; b.style.top = Math.max(4, r.top - 38) + 'px'; b.hidden = false;
    }, 10);
    box.addEventListener('mouseup', check); box.addEventListener('touchend', check); document.addEventListener('selectionchange', () => { if (!getSelection().toString()) b.hidden = true; });
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => { b.hidden = true; onPick(text); getSelection().removeAllRanges(); };
  }

  root.SpeechformDeck = { mount, selector };
})(this);
