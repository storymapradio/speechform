/* Speechform Studio: the pop-it. Every control on one floating card, about the size of a playing card.
 *
 * Before recording it shows only the recorder. Once recording starts (or with "more"), it opens into pages the thumb
 * swipes through, with dots beneath. Drag it anywhere by its top strip; make it larger or smaller with the corner
 * grip or a pinch. Where it sits and how large it is are kept on this device.
 *
 * On a phone it rests as a small round pill after a few seconds untouched (the recorder's state and clock, from
 * pill(el)), snapped to the nearest edge; one tap opens it again. It never sits over avoid() (the input row).
 *
 *   const P = SpeechformPopit.mount({ key, pages: [{ id, label, build(el) }], onPage, pill(el), avoid() })
 *   P.expand(true|false)  P.show(id)  P.page  P.expanded  P.el
 */
(function (root) {
  'use strict';
  const css = `
.popit{position:fixed;z-index:40;display:flex;flex-direction:column;border:2px solid var(--green-dim,rgba(57,255,20,.35));border-radius:1.5em;
  background:rgba(5,8,5,.94);backdrop-filter:blur(8px);box-shadow:0 14px 40px rgba(0,0,0,.7),0 0 0 1px rgba(0,0,0,.8),0 0 22px rgba(57,255,20,.08);
  color:var(--ink,#e8f5e4);font-family:var(--mono,ui-monospace,Menlo,monospace);overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
.popit .pgrip{flex:0 0 auto;height:2.4em;display:flex;align-items:center;justify-content:center;gap:.45em;cursor:grab;touch-action:none}
.popit .pgrip:active{cursor:grabbing}
.popit .pgrip::before{content:'';position:absolute;top:.55em;left:50%;width:2.6em;height:.28em;margin-left:-1.3em;border-radius:1em;background:var(--faint,#2a3a28)}
.popit .pdots{display:flex;gap:.4em;margin-top:.9em}
.popit .pdots i{width:.5em;height:.5em;border-radius:50%;background:var(--faint,#2a3a28);transition:background .2s,transform .2s;cursor:pointer}
.popit .pdots i.on{background:var(--green,#39ff14);transform:scale(1.25)}
.popit.closed .pdots{visibility:hidden}
.popit .ppages{flex:1;min-height:0;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scrollbar-width:none;touch-action:pan-x;overscroll-behavior:contain}
.popit .ppages::-webkit-scrollbar{display:none}
.popit.closed .ppages{overflow:hidden}
.popit .ppage{flex:0 0 100%;min-width:0;scroll-snap-align:start;display:flex;flex-direction:column;padding:.2em .9em .9em;overflow-y:auto;scrollbar-width:none;touch-action:pan-x pan-y}
.popit .ppage::-webkit-scrollbar{display:none}
.popit .ptitle{font-size:.82em;letter-spacing:.16em;text-transform:uppercase;color:var(--green,#39ff14);margin:0 0 .6em;text-align:center}
.popit .pmore{position:absolute;left:50%;bottom:.6em;transform:translateX(-50%);font:inherit;font-size:.9em;padding:.35em 1em;min-height:2.6em;border-radius:1em;border:1px solid var(--faint,#2a3a28);
  background:none;color:var(--muted,#7d9a78);cursor:pointer;display:none}
.popit.closed .pmore{display:block}
.popit .psize{position:absolute;right:0;bottom:0;width:3.2em;height:3.2em;z-index:2;cursor:nwse-resize;touch-action:none}
.popit .psize::after{content:'';position:absolute;right:.5em;bottom:.5em;width:.9em;height:.9em;border-right:2px solid var(--muted,#7d9a78);border-bottom:2px solid var(--muted,#7d9a78);border-radius:0 0 .3em 0;opacity:.7}
.popit .pgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45em}
.popit .pbtn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.25em;min-height:44px;min-width:44px;padding:.45em .2em;border-radius:1em;
  border:1px solid var(--faint,#2a3a28);background:#030503;color:var(--ink,#e8f5e4);font:inherit;font-size:.82em;line-height:1.15;cursor:pointer;text-align:center;
  transition:border-color .15s,background .15s,color .15s,transform .1s}
.popit .pbtn:active{transform:scale(.95)}
.popit .pbtn svg{width:1.9em;height:1.9em;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.popit .pbtn.on{border-color:var(--green,#39ff14);color:var(--green,#39ff14);background:var(--green-faint,rgba(57,255,20,.09));box-shadow:0 0 12px rgba(57,255,20,.2)}
.popit .pbtn.wide{grid-column:1/-1;flex-direction:row;justify-content:flex-start;gap:.7em;padding:.55em .8em;text-align:left}
.popit .pbtn.wide small{display:block;color:var(--muted,#7d9a78);font-size:.86em;margin-top:.15em}
.popit .pbtn[disabled]{opacity:.35;pointer-events:none}
.popit .plabel{grid-column:1/-1;font-size:.75em;color:var(--muted,#7d9a78);letter-spacing:.08em;margin:.5em 0 0}
.popit .pnote{font-size:.8em;line-height:1.45;color:var(--muted,#7d9a78);margin:.4em 0}
.popit .ppill{display:none}
.popit.pill{border-radius:50%;cursor:pointer;transition:left .25s,top .25s,width .2s,height .2s}
.popit.pill>*:not(.ppill){display:none!important}
.popit.pill .ppill{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;gap:2px}`;
  if (typeof document !== 'undefined') { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function mount({ key = 'main', pages = [], onPage, pill, avoid, idle = 4000 } = {}) {
    const STORE = 'speechform-popit:' + key;
    const el = document.createElement('div'); el.className = 'popit closed';
    el.innerHTML = `<div class="pgrip" title="drag to move"><div class="pdots"></div></div><div class="ppages"></div><button class="pmore">more</button><div class="psize" title="drag to resize"></div><div class="ppill"></div>`;
    document.body.appendChild(el);
    const box = el.querySelector('.ppages'), dots = el.querySelector('.pdots');
    pages.forEach(p => {
      const s = document.createElement('section'); s.className = 'ppage'; s.dataset.id = p.id;
      s.innerHTML = p.label ? `<p class="ptitle">${p.label}</p>` : ''; const body = document.createElement('div'); s.appendChild(body); box.appendChild(s);
      p.build && p.build(body);
      const d = document.createElement('i'); d.title = p.label || p.id; d.onclick = () => show(p.id); dots.appendChild(d);
    });
    const phone = () => Math.min(innerWidth, innerHeight) < 600;
    const base = () => (phone() ? 150 : 180);
    let g = (() => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; } })();
    const PILL = 58;
    let pilled = false;
    /* the lowest the card may sit: above the input row, if one is given */
    const floor = () => { const r = avoid && avoid(); return r && r.height ? r.top - 8 : innerHeight - 4; };
    const place = () => {
      if (pilled) {
        /* the pill: the nearest side edge, above the input row */
        const r = el.getBoundingClientRect(), mid = (g && g.x != null ? g.x : innerWidth) + (g ? g.w : 150) / 2;
        const x = mid < innerWidth / 2 ? 8 : innerWidth - PILL - 8, y = clamp(g && g.y != null ? g.y + (g.w * 1.4 - PILL) : innerHeight, 8, floor() - PILL);
        el.style.width = el.style.height = PILL + 'px'; el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.fontSize = '10.5px';
        return { x: g && g.x, y: g && g.y, w: g && g.w };
      }
      const w = clamp(g ? g.w : base(), 120, Math.min(innerWidth - 16, 440)), h = Math.round(w * 1.4);
      const x = clamp(g && g.x != null ? g.x : innerWidth - w - 14, 4, innerWidth - w - 4), y = clamp(g && g.y != null ? g.y : floor() - h - 6, 4, Math.max(4, floor() - h));
      el.style.width = w + 'px'; el.style.height = h + 'px'; el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.fontSize = (w / 150 * 10.5).toFixed(2) + 'px';
      return { x, y, w };
    };
    const keep = () => { try { localStorage.setItem(STORE, JSON.stringify(g)); } catch (e) {} };
    place(); addEventListener('resize', place);

    /* moving: the top strip; resizing: the corner grip, or two fingers anywhere */
    const drag = (handle, onMove) => handle.addEventListener('pointerdown', e => {
      e.preventDefault(); handle.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const mv = ev => { onMove(r, ev.clientX - sx, ev.clientY - sy); };
      const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); keep(); };
      handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    });
    drag(el.querySelector('.pgrip'), (r, dx, dy) => { g = { w: r.width, x: r.left + dx, y: r.top + dy }; place(); });
    drag(el.querySelector('.psize'), (r, dx, dy) => { g = { w: r.width + Math.max(dx, dy / 1.4), x: r.left, y: r.top }; g = { ...g, ...place() }; });
    const touches = new Map(); let pinch = null;
    el.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch') return; touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 2) { const [a, b] = [...touches.values()], r = el.getBoundingClientRect(); pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), w: r.width, x: r.left, y: r.top }; } }, true);
    el.addEventListener('pointermove', e => { if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && touches.size === 2) { const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); g = { w: pinch.w * d / pinch.d, x: pinch.x, y: pinch.y }; g = { ...g, ...place() }; } }, true);
    const lift = e => { touches.delete(e.pointerId); if (pinch && touches.size < 2) { pinch = null; keep(); } };
    el.addEventListener('pointerup', lift, true); el.addEventListener('pointercancel', lift, true);

    /* resting: after a few seconds untouched, on a phone, the card becomes a pill; a tap opens it again */
    let timer = null;
    const ppill = el.querySelector('.ppill');
    const rest = () => { if (!phone() || pilled) return; pilled = true; el.classList.add('pill'); pill && pill(ppill); place(); };
    const wake = () => { clearTimeout(timer); if (pilled) { pilled = false; el.classList.remove('pill'); place(); } timer = setTimeout(rest, idle); };
    el.addEventListener('pointerdown', e => { if (pilled) { e.preventDefault(); e.stopPropagation(); wake(); return; } wake(); }, true);
    el.addEventListener('scroll', wake, true);
    timer = setTimeout(rest, idle);
    let cur = pages[0] && pages[0].id, expanded = false;
    const sync = () => { const i = pages.findIndex(p => p.id === cur); dots.querySelectorAll('i').forEach((d, j) => d.classList.toggle('on', j === i)); };
    box.addEventListener('scroll', () => { const i = Math.round(box.scrollLeft / Math.max(1, box.clientWidth)); const p = pages[i]; if (p && p.id !== cur) { cur = p.id; sync(); onPage && onPage(cur); } }, { passive: true });
    function show(id) { const i = pages.findIndex(p => p.id === id); if (i < 0) return; if (!expanded && i) expand(true); cur = id; box.scrollTo({ left: i * box.clientWidth, behavior: 'smooth' }); sync(); }
    function expand(on) { expanded = !!on; el.classList.toggle('closed', !expanded); if (!expanded) { cur = pages[0].id; box.scrollLeft = 0; sync(); } }
    el.querySelector('.pmore').onclick = () => { expand(true); show(pages[1] ? pages[1].id : cur); };
    sync();
    return { el, show, expand, get expanded() { return expanded; }, get page() { return cur; }, get pilled() { return pilled; }, place, wake, rest,
      refreshPill() { if (pilled && pill) pill(ppill); }, reset() { g = null; keep(); place(); } };
  }
  root.SpeechformPopit = { mount };
})(this);
