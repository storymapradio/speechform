/* Speechform: what the top square shows. The growing image is one visualization of the classifier among
 * several: the bars, the river, the window, the build, the shape, the ideas, or all of them at once.
 *
 *   const L = SpeechformLooks.install(screenEl, { image: imgOrCanvas, onPick, openAll })
 *   L.set(trace)  L.show('river')  L.current
 *
 * Also the shared controls: a segmented group of icons (SpeechformLooks.segment) and the record button,
 * a red dot to record that becomes a red square to stop.
 */
(function (root) {
  'use strict';
  const VW = root.SpeechformViews;
  const IMAGE_ICON = '<circle cx="12" cy="12" r="3"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1"/>';
  const LOOKS = ['image', 'bars', 'river', 'window', 'build', 'shape', 'ideas', 'all'];
  const icon = k => `<svg viewBox="0 0 24 24">${k === 'image' ? IMAGE_ICON : VW.ICON[k]}</svg>`;
  const css = `.seg{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--faint,#2a3a28);border-radius:12px;background:#030503}
.seg button{display:grid;place-items:center;width:32px;height:28px;padding:0;border:none;border-radius:9px;background:none;color:var(--ink,#e8f5e4);opacity:.5;cursor:pointer;transition:opacity .15s,color .15s,background .15s}
.seg button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.seg button:hover{opacity:1;color:var(--amber,#ffc94a)}
.seg button.on{opacity:1;color:var(--green,#39ff14);background:var(--green-faint,rgba(57,255,20,.09))}
.rec{position:relative;width:36px;height:36px;border-radius:50%;border:2px solid var(--red,#ff5a4a);background:none;cursor:pointer;display:grid;place-items:center;padding:0;flex:0 0 auto}
.rec i{display:block;width:16px;height:16px;border-radius:50%;background:var(--red,#ff5a4a);transition:border-radius .2s,width .2s,height .2s}
.rec.on i{width:13px;height:13px;border-radius:3px}
.rec.on{animation:recring 1.6s ease-out infinite}
.rec.waking{border-color:var(--amber,#ffc94a)}.rec.waking i{background:var(--amber,#ffc94a);animation:recblink 1s ease-in-out infinite}
.rec.off{opacity:.3;pointer-events:none}
.rec .dot{position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:transparent}
.rec .dot.on{background:var(--green,#39ff14);box-shadow:0 0 6px var(--green,#39ff14)}
@keyframes recring{0%{box-shadow:0 0 0 0 rgba(255,90,74,.55)}100%{box-shadow:0 0 0 12px rgba(255,90,74,0)}}
@keyframes recblink{50%{opacity:.35}}
.looks{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:3;background:rgba(3,5,3,.82);backdrop-filter:blur(4px)}
.lookstage{position:absolute;inset:46px 10px 26px;z-index:2}
.lookstage canvas{width:100%;height:100%;display:block;cursor:pointer}
.looknote{position:absolute;left:12px;right:12px;bottom:6px;margin:0;z-index:2;color:var(--muted,#7d9a78);font-size:10px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lookstage[hidden],.looknote[hidden]{display:none}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* a segmented group: one pill of icons, one of them on */
  function segment(host, items, onPick) {
    host.classList.add('seg');
    host.innerHTML = items.map(([k, svg, title]) => `<button data-k="${k}" title="${title || k}" aria-label="${title || k}"><svg viewBox="0 0 24 24">${svg}</svg></button>`).join('');
    host.querySelectorAll('button').forEach(b => b.onclick = () => onPick(b.dataset.k));
    return { mark: k => host.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k)) };
  }

  function install(screen, { image, onPick, openAll } = {}) {
    let look = 'image', T = null;
    const head = document.createElement('span'); head.className = 'looks'; screen.appendChild(head);
    const stage = document.createElement('div'); stage.className = 'lookstage'; stage.hidden = true; stage.innerHTML = '<canvas></canvas>'; screen.appendChild(stage);
    const note = document.createElement('p'); note.className = 'looknote'; note.hidden = true; screen.appendChild(note);
    const r = VW.renderer(stage.querySelector('canvas'), { note, start: 'bars', onPick });
    const seg = segment(head, LOOKS.map(k => [k, k === 'image' ? IMAGE_ICON : VW.ICON[k], k === 'all' ? 'every visualization' : k]), k => show(k));
    function show(k) {
      if (k === 'all') { openAll && openAll(); return; }     // every visualization at once, over the whole window
      look = k; seg.mark(k);
      stage.hidden = note.hidden = k === 'image';
      if (image) image.style.visibility = k === 'image' ? '' : 'hidden';
      if (k !== 'image') { r.setView(k); if (T) r.set(T); }
    }
    show('image');
    return { set(t) { T = t; if (look !== 'image') r.set(t); }, show, get current() { return look; } };
  }

  /* the record button: tap to record, tap again to stop */
  function recordButton(btn) {
    btn.classList.add('rec'); btn.innerHTML = '<i></i><span class="dot"></span>';
    return {
      paint({ on, waking, off, ready }) {
        btn.classList.toggle('on', !!on); btn.classList.toggle('waking', !!waking && !on); btn.classList.toggle('off', !!off);
        btn.querySelector('.dot').classList.toggle('on', !!ready);
        btn.title = btn.ariaLabel = on ? 'stop recording' : waking ? 'opening' : 'record';
      },
    };
  }

  root.SpeechformLooks = { install, segment, recordButton, LOOKS, IMAGE_ICON };
})(this);
