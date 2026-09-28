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
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    reading: '<path d="M4 19V11M9 19V6M14 19v-9M19 19v-5"/>',
  };
  const svg = k => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
  const LOCAL = 'speechform-light:cards', LOCAL_SECTIONS = 'speechform-light:sections';
  const local = { get(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } },
                  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } } };
  const done = c => !c || !/^(waiting|asking Jev|the easel is drawing)$/.test(c.art || '');

  function mount({ page, server, onSection }) {
    let tab = 'cards', list = [], secs = [], open = null, side = 'front', timer = null;
    const url = (c, f) => server ? `/cards/${encodeURIComponent(c.id)}/${f}` : f;
    const images = {};
    const img = src => new Promise(res => { if (!src) return res(null); if (images[src]) return res(images[src]); const i = new Image(); i.onload = () => { images[src] = i; res(i); }; i.onerror = () => res(null); i.src = src; });
    const art = async c => ({ abstract: await img(c.abstract && (c.abstract.startsWith('data:') ? c.abstract : url(c, c.abstract))),
                              clear: await img(c.clear && (c.clear.startsWith('data:') ? c.clear : url(c, c.clear) + '?' + (c.bank || ''))) });

    page.innerHTML = `<div class="deckbar"><button class="vchip on" data-t="cards" title="cards" aria-label="cards">${svg('cards')}</button>
      <button class="vchip" data-t="sections" title="sections" aria-label="sections">${svg('sections')}</button><span style="flex:1"></span>
      <button class="vchip" data-make title="make a card of this session" aria-label="make a card">${svg('make')}</button></div>
      <div class="scroll deck" id="deckList"></div>`;
    const sheet = document.createElement('div'); sheet.className = 'cardsheet'; sheet.hidden = true;
    sheet.innerHTML = `<div class="cardhold"><div class="cardcol"><canvas class="bigcard"></canvas><p class="cardart"></p>
      <div class="cardtools"><button class="vchip" data-save title="save" aria-label="save">${svg('save')}</button><button class="vchip" data-folder title="open its folder" aria-label="open its folder">${svg('folder')}</button><button class="vchip" data-close title="close" aria-label="close">${svg('close')}</button></div></div>
      <div class="carddetail"><audio controls preload="none"></audio><div class="dtabs"><button class="vchip on" data-d="transcript.txt" title="transcript" aria-label="transcript">${svg('sections')}</button><button class="vchip" data-d="reading.txt" title="reading" aria-label="reading">${svg('reading')}</button></div><pre class="dtext"></pre></div></div>`;
    document.body.appendChild(sheet);
    let big = sheet.querySelector('canvas');
    /* a card is drawn once; if the browser takes its canvas back (the easel shares the GPU), it is drawn again */
    const fresh = cv => { if (!cv.getContext('2d').isContextLost()) return cv; const n = cv.cloneNode(); cv.replaceWith(n); return n; };
    const flip = () => { big.classList.add('flip'); setTimeout(async () => { side = side === 'front' ? 'back' : 'front'; big = fresh(big); big.onclick = flip; R.drawCard(big, open, await art(open), side); big.classList.remove('flip'); }, 180); };
    big.addEventListener('contextrestored', () => open && art(open).then(a => R.drawCard(big, open, a, side)));
    page.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; page.querySelectorAll('[data-t]').forEach(q => q.classList.toggle('on', q === b)); draw(); });
    sheet.querySelector('[data-close]').onclick = () => { sheet.hidden = true; open = null; sheet.querySelector('audio').pause(); };
    sheet.querySelector('[data-folder]').onclick = () => open && server && fetch(`/cards/${encodeURIComponent(open.id)}/reveal`, { method: 'POST', body: '{}' });
    /* everything kept with the recording: its audio, its transcript and its reading */
    let doc = 'transcript.txt';
    const detail = async () => {
      const box = sheet.querySelector('.carddetail'); box.hidden = !server || !open; if (box.hidden) return;
      const au = box.querySelector('audio'), src = open.audio ? url(open, open.audio) : '';
      au.hidden = !src; if (au.dataset.for !== src) { au.dataset.for = src; if (src) au.src = src; else au.removeAttribute('src'); }
      box.querySelectorAll('[data-d]').forEach(b => b.classList.toggle('on', b.dataset.d === doc));
      try { const r = await fetch(url(open, doc)); box.querySelector('.dtext').textContent = r.ok ? await r.text() : ''; } catch (e) {}
    };
    sheet.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { doc = b.dataset.d; detail(); });
    sheet.onclick = e => { if (e.target === sheet) { sheet.hidden = true; open = null; } };
    /* tap the card to flip it: the clear art on the front, the grown image and the whole reading on the back */
    big.onclick = flip;
    sheet.querySelector('[data-save]').onclick = () => { const a = document.createElement('a'); a.download = (open.name || 'card').replace(/\W+/g, '-').toLowerCase() + '-' + side + '.png'; a.href = big.toDataURL('image/png'); a.click(); };

    async function load() {
      if (server) {
        try { list = (await (await fetch('/cards')).json()).cards; secs = (await (await fetch('/sections')).json()).sections; } catch (e) { list = []; }
      } else { list = local.get(LOCAL); secs = local.get(LOCAL_SECTIONS); }
    }
    async function draw() {
      await load();
      const box = page.querySelector('#deckList');
      if (tab === 'cards') {
        box.innerHTML = list.length ? '<div class="deckgrid">' + list.map(c => `<button class="minicard" data-id="${esc(c.id)}"><canvas></canvas></button>`).join('') + '</div>'
          : '<p class="quiet" style="padding:8px">Each recording becomes a card when you stop.</p>';
        if (server) list.filter(c => done(c) && !c.faces).forEach(c => { c.faces = true; keepFaces(c); });   // every finished card gets its two images
        box.querySelectorAll('.minicard').forEach(async b => { const c = list.find(x => x.id === b.dataset.id), cv = b.querySelector('canvas'), a = await art(c);
          R.drawCard(cv, c, a); cv.addEventListener('contextrestored', () => R.drawCard(cv, c, a)); b.onclick = () => show(c); });
      } else {
        box.innerHTML = secs.length ? secs.map((s, i) => `<div class="line" data-i="${i}"><div class="said">${esc(s.text)}</div><div class="meta">${(s.profile || []).slice(0, 3).map(([k, v]) =>
          `<span class="chip" style="color:${R.COLORS[R.IMAGE[k]] || '#7d9a78'}">${esc(k)} ${Math.round(v * 100)}%</span>`).join('')}</div></div>`).join('')
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
    async function make({ phrases, ideas, text, abstract, audio, since }) {
      const reading = R.read(phrases, ideas); if (!reading) return null;
      await load();
      const card = { ...R.card(reading, list), reading };
      let kept;
      if (server) kept = await (await fetch('/card', { method: 'POST', body: JSON.stringify({ card, text, abstract, audio, since, phrases }) })).json();
      else { kept = { ...card, id: 'c' + Date.now().toString(36), abstract, art: 'kept abstract: the easel runs with the Speechform server' }; const all = local.get(LOCAL); all.unshift(kept); local.set(LOCAL, all.slice(0, 30)); }
      draw(); show(kept); return kept;
    }
    async function keepSection(section) {
      if (server) await fetch('/sections', { method: 'POST', body: JSON.stringify(section) });
      else { const all = local.get(LOCAL_SECTIONS); all.unshift(section); local.set(LOCAL_SECTIONS, all.slice(0, 300)); }
      if (tab === 'sections') draw();
    }
    draw();
    return { make, keepSection, draw, show: t => { tab = t; page.querySelectorAll('[data-t]').forEach(q => q.classList.toggle('on', q.dataset.t === t)); draw(); }, onMake: f => page.querySelector('[data-make]').onclick = f };
  }

  /* the style every page shares for the deck */
  const css = `.deckbar{display:flex;align-items:center;gap:2px;padding:6px 8px 2px;border-bottom:1px solid var(--faint)}
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
.carddetail audio{width:100%;height:34px}
.carddetail audio[hidden]{display:none}
.dtabs{display:flex;gap:2px}
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
