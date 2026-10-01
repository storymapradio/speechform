/* Speechform Studio: the depth screen and the steering controls.
 *
 *   depth page   the lead kind, its three lenses (Listener, Speaker, Absorption) each with a meter, its question,
 *                its answer from the scholarship (folded), and its elements as chips that light when found; tap a
 *                chip for its meaning and the words that showed it. Beneath: a quiet line for what to try next.
 *   loose ends   the threads as a rail of chips, sorted by need; tap one to hear the moment it began (or read it)
 *   guide card   at a natural pause in Guide mode, one card naming a single next move
 *   closing      at stop, the threads still open, as buds, with a choice to record a coda first
 *   speaker      a tap control cycling A, B and C; mode: Mirror, Nudge, Guide; a slow ring while Jev reads
 * No text goes over the growing image: everything here lives in the bottom screen or its own window.
 */
(function (root) {
  'use strict';
  const VW = root.SpeechformViews, DP = root.SpeechformDepth;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LN = ['listener', 'speaker', 'absorption'], LNAME = { listener: 'Listener', speaker: 'Speaker', absorption: 'Absorption' };
  const SPK = VW.SPEAKER, STATE = VW.STATE, WORD = VW.STATE_WORD;
  const RANK = { ready: 0, dormant: 1, developing: 2, returned: 2, opened: 3, closed: 4 };
  const ICON = {
    mirror: '<path d="M12 3v18"/><path d="M9 7H5v10h4M15 7h4v10h-4"/>',
    nudge: '<path d="M4 12h12"/><path d="M12 7l5 5-5 5"/><circle cx="19.5" cy="12" r="1.3"/>',
    guide: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    coda: '<circle cx="12" cy="12" r="6"/>',
    card: '<rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M9.5 12.5l2 2 3.5-4"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    ask: '<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><path d="M9.6 9.6a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1 .8-1 1.6"/><circle cx="12" cy="16.4" r=".7"/>',
  };
  const svg = k => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
  const live = (t, now, dormant = 90) => t.state !== 'closed' && now - (t.last_at || now) >= dormant ? 'dormant' : t.state;
  const css = `
.dp{display:flex;flex-direction:column;min-height:0;flex:1}
.rail{display:flex;gap:8px;overflow-x:auto;padding:10px 12px 8px;border-bottom:1px solid var(--faint);scrollbar-width:thin;flex:0 0 auto;cursor:grab}
.rail:empty::before{content:'Threads gather here as ideas open.';color:var(--muted);font-size:11px}
.thr{flex:0 0 auto;max-width:220px;text-align:left;padding:7px 10px 7px 12px;border-radius:12px;border:1px solid var(--faint);background:#030503;color:var(--ink);font:inherit;font-size:11px;cursor:pointer;position:relative;transition:transform .15s,border-color .2s}
.thr:hover{transform:translateY(-2px);border-color:var(--green-dim)}
.thr b{display:block;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}
.thr span{display:block;color:var(--muted);font-size:10.5px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.thr i{position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:2px}
.thr.ready{border-color:rgba(255,201,74,.55)} .thr.ready i{background:var(--amber);box-shadow:0 0 8px var(--amber)}
.thr.dormant{opacity:.6} .thr.closed{opacity:.75} .thr.closed i{background:var(--green)}
.thr .pk{color:var(--amber)}
.opening{margin:0;padding:6px 14px 8px;color:var(--ink);font-size:12px;line-height:1.5;border-bottom:1px solid var(--faint)}
.opening[hidden]{display:none}
.dhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 12px;padding:10px 14px 4px}
.dhead .kind{font-size:15px;font-weight:600}
.dhead .near{color:var(--muted);font-size:11px}
.dhead .src{margin-left:auto;color:var(--muted);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase}
.lenses{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px;padding:6px 12px 8px}
.lens{border:1px solid var(--faint);border-radius:12px;padding:10px 12px;background:#030503;min-width:0}
.lens header{display:flex;justify-content:space-between;align-items:baseline}
.lens .lt{color:var(--green);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase}
.lens .lm{font-size:15px;font-weight:600}
.meter{position:relative;height:7px;border-radius:4px;background:#0d130c;margin:7px 0 8px;overflow:visible}
.meter i{display:block;height:100%;border-radius:4px;transition:width .6s cubic-bezier(.2,.8,.2,1)}
.meter b{position:absolute;top:-4px;width:3px;height:15px;border-radius:2px;background:var(--amber);box-shadow:0 0 6px var(--amber);transition:left .6s}
.meter b[hidden]{display:none}
.lq{margin:0 0 6px;line-height:1.45;font-size:12px}
.lens details{margin:0 0 8px;color:var(--muted);font-size:11.5px;line-height:1.5}
.lens summary{cursor:pointer;color:var(--muted);font-size:10.5px;letter-spacing:.06em}
.lens details p{margin:6px 0 0}
.chips{display:flex;flex-wrap:wrap;gap:5px}
.el{font:inherit;font-size:10.5px;padding:3px 8px;border-radius:99px;border:1px solid var(--faint);background:none;color:var(--muted);cursor:pointer;transition:all .3s}
.el.half{color:var(--ink);border-color:var(--c,var(--green-dim))}
.el.on{color:#000;background:var(--c,var(--green));border-color:var(--c,var(--green));box-shadow:0 0 10px color-mix(in srgb,var(--c,#39ff14) 55%,transparent)}
.el.sel{outline:2px solid var(--amber);outline-offset:1px}
.ev{margin:8px 0 0;font-size:11.5px;line-height:1.5;color:var(--ink)}
.ev q{color:var(--amber)}
.ev[hidden]{display:none}
.cues{padding:4px 14px 12px;display:flex;flex-direction:column;gap:6px}
.cue{margin:0;font-size:12px;line-height:1.5;color:var(--muted)}
.cue b{font-weight:500;color:var(--green);letter-spacing:.1em;font-size:10px;text-transform:uppercase;margin-right:8px}
.cue.hold b{color:var(--amber)} .cue.hold{color:var(--ink)}
.cue.jev b{color:var(--amber)}
.askjev{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;margin:4px 14px 12px;padding:7px 12px;border-radius:12px;border:1px solid rgba(255,201,74,.55);background:rgba(255,201,74,.08);color:var(--amber);font:inherit;font-size:11.5px;cursor:pointer;box-shadow:0 0 14px rgba(255,201,74,.18)}
.askjev svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5}
.askjev[hidden]{display:none}
.guide{position:absolute;left:12px;right:12px;bottom:12px;z-index:6;border:2px solid var(--green);border-radius:14px;background:rgba(3,6,3,.96);padding:14px 16px 12px;box-shadow:0 0 28px rgba(57,255,20,.25);animation:guidein .5s cubic-bezier(.2,.8,.2,1)}
.guide[hidden]{display:none}
.guide b{display:block;color:var(--green);font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:500;margin-bottom:6px}
.guide p{margin:0;font-size:15px;line-height:1.45}
.guide small{display:block;margin-top:6px;color:var(--muted);font-size:10.5px}
.guide button{position:absolute;top:6px;right:6px;width:28px;height:28px;border:none;background:none;color:var(--muted);cursor:pointer}
.guide button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8}
@keyframes guidein{from{opacity:0;transform:translateY(14px)}}
.closing{position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.84);display:grid;place-items:center;padding:16px}
.closing[hidden]{display:none}
.closing .box{width:min(560px,94vw);border:2px solid var(--green-dim);border-radius:16px;background:var(--panel);padding:18px}
.closing h3{margin:0 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--green);font-weight:500}
.closing p{margin:0 0 12px;color:var(--muted);font-size:12px;line-height:1.5}
.buds{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px}
.bud{display:flex;align-items:center;gap:8px;font-size:12px;max-width:100%}
.bud canvas{width:30px;height:30px;flex:0 0 auto}
.bud span{color:var(--muted);font-size:10.5px;display:block}
.closing .row{display:flex;gap:10px;justify-content:flex-end}
.closing .row button{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:12px;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--green-dim);background:var(--green-faint);color:var(--green)}
.closing .row button.coda{border-color:rgba(255,90,74,.6);background:rgba(255,90,74,.08);color:#ffb3aa}
.closing .row button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7}
.closing .row button.coda svg{fill:var(--red);stroke:none}
.spk{width:34px;height:34px;border-radius:50%;border:2px solid currentColor;background:none;font:inherit;font-size:14px;font-weight:700;cursor:pointer;display:grid;place-items:center;transition:color .2s,transform .12s}
.spk:active{transform:scale(.9)}
.jevring{width:26px;height:26px;opacity:0;transition:opacity .6s}
.jevring.on{opacity:1}
.jevring circle{fill:none;stroke:var(--amber);stroke-width:2;stroke-dasharray:6 8;transform-origin:50% 50%;animation:jevspin 6s linear infinite}
@keyframes jevspin{to{transform:rotate(360deg)}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* a bud, drawn: the closing check shows each open thread as one */
  function bud(cv, color) {
    const d = 2, x = cv.getContext('2d'); cv.width = cv.height = 30 * d; x.scale(d, d);
    x.strokeStyle = '#39ff14'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(15, 29); x.quadraticCurveTo(13, 20, 15, 14); x.stroke();
    x.shadowColor = color; x.shadowBlur = 8; x.fillStyle = color;
    [[0, 1], [-.4, .82], [.4, .82]].forEach(([a, k]) => { x.save(); x.translate(15, 13); x.rotate(a); x.beginPath(); x.ellipse(0, -4, 3.4 * k, 7 * k, 0, 0, 7); x.fill(); x.restore(); });
  }

  /* ── the depth page ── */
  function depthPage(host, { onThread, onAsk } = {}) {
    host.classList.add('dp');
    host.innerHTML = `<div class="rail" id="rail"></div><p class="opening" hidden></p>
      <div class="scroll"><div class="dhead"><span class="kind"></span><span class="near"></span><span class="src"></span></div>
      <div class="lenses">${LN.map(l => `<section class="lens" data-l="${l}"><header><span class="lt">${LNAME[l]}</span><span class="lm"></span></header>
        <div class="meter"><i></i><b hidden title="Jev"></b></div><p class="lq"></p><details><summary>what the scholarship says</summary><p class="la"></p></details>
        <div class="chips"></div><p class="ev" hidden></p></section>`).join('')}</div>
      <div class="cues"></div><button class="askjev" hidden>${svg('ask')}<span>ask Jev about this passage</span></button></div>`;
    const rail = host.querySelector('.rail'), opening = host.querySelector('.opening'), cues = host.querySelector('.cues'), ask = host.querySelector('.askjev');
    let sel = null, lastKey = '', cur = null;
    /* the rail can be dragged sideways like a shelf */
    let dx = null; rail.addEventListener('pointerdown', e => { dx = [e.clientX, rail.scrollLeft]; });
    addEventListener('pointerup', () => dx = null); rail.addEventListener('pointermove', e => { if (dx && e.buttons) rail.scrollLeft = dx[1] - (e.clientX - dx[0]); });
    ask.onclick = () => onAsk && cur && onAsk(cur);

    function threads(list, now, { dormant = 90, color } = {}) {
      const items = (list || []).map(t => ({ ...t, st: live(t, now, dormant) })).sort((a, b) => (RANK[a.st] ?? 5) - (RANK[b.st] ?? 5) || b.last_at - a.last_at);
      const html = items.map(t => {
        const word = t.st === 'dormant' ? `dormant for ${Math.max(1, Math.round((now - t.last_at) / 60))} min` : WORD[t.st];
        const by = Object.keys(t.speakers || {}).length > 1 || t.opened_by !== 'A' ? `<em style="color:${SPK[t.opened_by] || 'inherit'};font-style:normal">${esc(t.opened_by)}</em> · ` : '';
        return `<button class="thr ${t.st}" data-id="${esc(t.id)}"><i style="background:${t.st === 'ready' ? '' : (STATE[t.st] || color(t.kind))}"></i><b>${esc(t.title || 'a thread')}</b>
          <span>${by}${esc(word)}${t.need && t.st !== 'closed' ? ' · ' + esc(t.need) : ''}</span>${t.link ? `<span class="pk">picked up from ${esc(t.link.date)}</span>` : ''}</button>`;
      }).join('');
      if (html === rail._h) return; rail._h = html; rail.innerHTML = html;
      rail.querySelectorAll('.thr').forEach(b => b.onclick = () => {
        const t = items.find(x => x.id === b.dataset.id); if (!t) return;
        const played = onThread && onThread(t);
        opening.hidden = !!played; if (!played) opening.innerHTML = `<b style="color:var(--green);font-weight:500">${esc(t.title)}</b> began: “${esc(t.first)}”`;
      });
    }

    function show(d, { color, source = 'live', jev = null, hold = null, arc = null, section = false, canAsk = false, asked = null } = {}) {
      cur = d; ask.hidden = !(section && canAsk);
      if (!d) { host.querySelector('.kind').textContent = 'The lenses fill as you speak.'; host.querySelector('.kind').style.color = 'var(--muted)'; return; }
      const spec = DP.spec(d.kind); if (!spec) return;
      const kc = color(d.kind), key = d.kind;
      const k = host.querySelector('.kind'); k.textContent = d.kind; k.style.color = kc;
      host.querySelector('.near').textContent = Object.keys(d.near || {}).length ? 'near: ' + Object.keys(d.near).join(', ') : '';
      host.querySelector('.src').textContent = source;
      const J = asked || jev;
      LN.forEach(l => {
        const box = host.querySelector(`.lens[data-l="${l}"]`), L = d.lenses[l], S = spec[l];
        box.querySelector('.lm').textContent = Math.round(L.meter * 100) + '%';
        const bar = box.querySelector('.meter i'); bar.style.width = Math.round(L.meter * 100) + '%'; bar.style.background = kc;
        const jm = box.querySelector('.meter b'); jm.hidden = !(J && J[l] != null); if (!jm.hidden) jm.style.left = `calc(${Math.round(J[l] * 100)}% - 1px)`;
        if (key !== lastKey) { box.querySelector('.lq').textContent = S.question; box.querySelector('.la').textContent = S.answer; box.querySelector('.ev').hidden = true; }
        const chips = box.querySelector('.chips');
        chips.innerHTML = L.elements.map(e => `<button class="el ${e.found ? 'on' : e.score > .15 ? 'half' : ''} ${sel && sel[0] === l && sel[1] === e.id ? 'sel' : ''}" data-id="${esc(e.id)}" style="--c:${kc}">${esc(e.name)}</button>`).join('');
        chips.querySelectorAll('.el').forEach(b => b.onclick = () => {
          sel = [l, b.dataset.id]; const e = L.elements.find(x => x.id === b.dataset.id), full = S.elements.find(x => x.id === b.dataset.id) || {};
          const ev = box.querySelector('.ev'); ev.hidden = false;
          ev.innerHTML = `${esc(full.meaning || '')} ` + (e.evidence && e.evidence.length ? `Heard in: ${e.evidence.map(w => `<q>${esc(w)}</q>`).join(', ')}.` : `<span class="quiet">${esc(full.try || '')}</span>`);
          chips.querySelectorAll('.el').forEach(q => q.classList.toggle('sel', q === b));
        });
      });
      lastKey = key;
      /* the quiet lines: what to try next, what held the listener, where the arc goes */
      const lines = [];
      if (hold && hold.cue) lines.push(`<p class="cue hold"><b>${hold.cue.type === 'pause' ? 'pause' : 'hold'}</b>${esc(hold.cue.text)}</p>`);
      if (d.next) lines.push(`<p class="cue"><b>try next</b>${esc(d.next.try || d.next.meaning)} <span class="quiet">(${esc(d.next.name.toLowerCase())}, ${esc(LNAME[d.next.lens].toLowerCase())})</span></p>`);
      if (arc && arc.next) lines.push(`<p class="cue"><b>arc</b>${esc(arc.next.move)} <span class="quiet">(${esc(arc.next.need)})</span></p>`);
      if (J && J.element) { const el = spec.absorption.elements.find(e => e.id === J.element); if (el) lines.push(`<p class="cue jev"><b>Jev</b>${esc(el.name)} draws the listener in most${section ? ' in this passage' : ''}.</p>`); }
      if (jev && jev.move && !section) lines.push(`<p class="cue jev"><b>Jev</b>${esc(jev.move.text)}</p>`);
      cues.innerHTML = lines.join('');
    }
    return { show, threads };
  }

  /* ── the guide card ── */
  function guideCard(host) {
    const el = document.createElement('div'); el.className = 'guide'; el.hidden = true;
    el.innerHTML = `<button title="close" aria-label="close">${svg('close')}</button><b>next move</b><p></p><small></small>`;
    host.appendChild(el); el.querySelector('button').onclick = () => el.hidden = true;
    return { show(move, by) { if (!move) return; el.querySelector('p').textContent = move.text; el.querySelector('small').textContent = (move.why ? move.why + '. ' : '') + 'Chosen by ' + by + '.'; el.hidden = false; },
      hide() { el.hidden = true; }, get open() { return !el.hidden; } };
  }

  /* ── the closing check at stop ── */
  function closing({ onCoda, onCard }) {
    const el = document.createElement('div'); el.className = 'closing'; el.hidden = true;
    el.innerHTML = `<div class="box"><h3>still open</h3><p></p><div class="buds"></div>
      <div class="row"><button class="coda">${svg('coda')}<span>record a coda</span></button><button class="card">${svg('card')}<span>make the card</span></button></div></div>`;
    document.body.appendChild(el);
    el.querySelector('.coda').onclick = () => { el.hidden = true; onCoda && onCoda(); };
    el.querySelector('.card').onclick = () => { el.hidden = true; onCard && onCard(); };
    return {
      ask(open) {
        el.querySelector('p').textContent = open.length === 1 ? 'One thread has not landed. Record a coda to close it, or make the card as it is.' : `${open.length} threads have not landed. Record a coda to close them, or make the card as it is.`;
        const buds = el.querySelector('.buds');
        buds.innerHTML = open.map(t => `<div class="bud"><canvas></canvas><div>${esc(t.title || 'a thread')}<span>${esc(t.need || WORD[t.state] || '')}</span></div></div>`).join('');
        buds.querySelectorAll('canvas').forEach((c, i) => bud(c, open[i].state === 'ready' ? '#ffc94a' : '#7d9a78'));
        el.hidden = false;
      },
      get open() { return !el.hidden; },
    };
  }

  /* ── the speaker: one tap control, A then B then C ── */
  function speaker(btn, onChange) {
    const ORDER = ['A', 'B', 'C']; let who = 'A';
    try { const v = localStorage.getItem('speechform-studio:speaker'); if (ORDER.includes(v)) who = v; } catch (e) {}
    const paint = () => { btn.textContent = who; btn.style.color = SPK[who]; btn.title = btn.ariaLabel = `speaking: ${who} (tap for ${ORDER[(ORDER.indexOf(who) + 1) % 3]})`; };
    btn.classList.add('spk');
    btn.onclick = () => { who = ORDER[(ORDER.indexOf(who) + 1) % 3]; try { localStorage.setItem('speechform-studio:speaker', who); } catch (e) {} paint(); onChange && onChange(who); };
    paint();
    return { get who() { return who; }, set(v) { if (ORDER.includes(v)) { who = v; paint(); } } };
  }

  /* ── the steering mode: Mirror, Nudge (the default), Guide ── */
  function modes(host, onChange) {
    let mode = 'nudge';
    try { const v = localStorage.getItem('speechform-studio:mode'); if (['mirror', 'nudge', 'guide'].includes(v)) mode = v; } catch (e) {}
    const T = { mirror: 'Mirror: threads only', nudge: 'Nudge: cues in the image and the loose ends', guide: 'Guide: and at a pause, one next move' };
    host.classList.add('seg');
    host.innerHTML = ['mirror', 'nudge', 'guide'].map(k => `<button data-m="${k}" title="${T[k]}" aria-label="${T[k]}">${svg(k)}</button>`).join('');
    const paint = () => host.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    host.querySelectorAll('button').forEach(b => b.onclick = () => { mode = b.dataset.m; try { localStorage.setItem('speechform-studio:mode', mode); } catch (e) {} paint(); onChange && onChange(mode); });
    paint();
    return { get mode() { return mode; } };
  }

  /* ── the slow ring while Jev reads at a pause ── */
  function ring(host) {
    host.innerHTML = '<svg class="jevring" viewBox="0 0 26 26" aria-label="Jev is reading"><circle cx="13" cy="13" r="10"/></svg>';
    const el = host.firstChild; return { set(on) { el.classList.toggle('on', !!on); } };
  }

  root.SpeechformSteer = { depthPage, guideCard, closing, speaker, modes, ring, live, RANK };
})(this);
