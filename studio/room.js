/* Speechform Studio: the room.
 *
 * A live participants thread for a session, built on the Asynchronous Instruments cohorts (Supabase project
 * nqelzijdjgpvzcczfvvy, tables sf_rooms, sf_room_state, sf_feedback, sf_votes). People in the room open
 * asynchronousinstruments.com/speechform/room?c=CODE on their phones, see the threads as they grow, react in one
 * tap and ask for more of a thread. This module is the speaker's side.
 *
 * The host signs in with a host key made in the Engine (#/rooms, "a key for Studio"). Studio runs on
 * 127.0.0.1, which cannot reach the site's sign-in session, so the key stands in for it: it is kept in this
 * browser's localStorage, sent only to the sf_host_* functions, and can be revoked in the Engine at any time.
 * Opening http://127.0.0.1:9990/studio/#sfhost=<key> stores it and clears it from the address bar.
 * On the website a host signed in with the site's own account hosts with that session instead (Room.useSession):
 * the sf_host_* functions take an empty key to mean the person signed in.
 *
 *   Room.open({ cohortId, title, allowGuests, shareTranscript })   opens a room; resolves to { code, url, ... }
 *   Room.publish(stateObj)    the shared state; throttled to one write in 3 s, sooner when threads change.
 *                             Accepts Studio's own state (an object with .steer) or the plain shape below.
 *   Room.onFeedback(fn)       fn(post) for every new post: { id, kind, text, thread_id, author_name, created_at }
 *   Room.onChange(fn)         fn(summary) whenever feedback, votes or the room change
 *   Room.summary()            per-thread interest and reaction tallies over time (see below)
 *   Room.panel(el)            the join panel for the desk: code, link, QR, live counts, open and close
 *   Room.weather(canvas)      the reactions as a live weather band (call again each frame or on change)
 *   Room.close(), Room.set({ allowGuests, shareTranscript, title }), Room.status(), Room.resume()
 *
 * The plain state shape (all optional):
 *   { form, arc, absorption: 0..1, threads: [{ id, label, state, speaker, started_at, active }],
 *     questions: ['...'], lines: ['...'] }     lines are published only when the room shares the transcript.
 */
(function (root) {
  'use strict';
  var SUPABASE_URL = 'https://nqelzijdjgpvzcczfvvy.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xZWx6aWpkamdwdnpjY3pmdnZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NjUyMzgsImV4cCI6MjA4ODM0MTIzOH0.oVB3MNpvsTTnaqmdimlSrRPzx_c7czDARTerzvC3Et8';
  var SB_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  var QR_JS = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
  var CFG = { site: 'https://asynchronousinstruments.com', engine: 'https://asynchronousinstruments.com/engine#/rooms', every: 3000, dormant: 90, halfLife: 180 };
  var KINDS = ['curious', 'confused', 'delighted', 'moved', 'disagree', 'question', 'note'];
  var COLOR = { curious: '#5ab4ff', confused: '#ffc94a', delighted: '#39ff14', moved: '#ff9ae0', disagree: '#ff6a5a', question: '#b4a6ff', note: '#8aa284' };
  var K_KEY = 'sf-host-key', K_ROOM = 'sf-host-room';

  var sb = null, chan = null, room = null, who = null, session = false;
  var feed = [], votes = {}, voteTimes = [], threadNames = {};
  var fbFns = [], chFns = [], panels = [];
  var pending = null, lastSent = '', lastShape = '', lastAt = 0, timer = null, busy = false, lastError = '';

  /* ── plumbing ──────────────────────────────────────────────────────── */
  function load(src, test) {
    if (test()) return Promise.resolve();
    return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { no(new Error('could not load ' + src)); }; document.head.appendChild(s); });
  }
  function client() {
    if (sb) return Promise.resolve(sb);
    return load(SB_JS, function () { return root.supabase && root.supabase.createClient; }).then(function () {
      sb = root.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'sf-room-host' } });
      return sb;
    });
  }
  function rpc(name, args) { return client().then(function (c) { return c.rpc(name, args); }).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; }); }
  function stored() { try { return localStorage.getItem(K_KEY) || ''; } catch (e) { return ''; } }
  function key() { return session ? '' : stored(); }                 // signed in on the site: the session is the key
  function setKey(k) { try { if (k) localStorage.setItem(K_KEY, k); else localStorage.removeItem(K_KEY); } catch (e) {} }
  function emit() { var s = summary(); chFns.forEach(function (f) { try { f(s); } catch (e) { console.error(e); } }); panels.forEach(drawPanel); }

  /* a key handed over in the address (#sfhost=...) is kept and cleared from view */
  (function () {
    var m = /[#&]sfhost=([A-Za-z0-9_]+)/.exec(location.hash || '');
    if (m) { setKey(m[1]); history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/[#&]?sfhost=[A-Za-z0-9_]+/, '').replace(/^#$/, '')); }
  })();

  /* ── the room ──────────────────────────────────────────────────────── */
  function signIn(k) {
    if (k) setKey(k.trim());
    if (!session && !key()) return Promise.reject(new Error('A host key is needed. Make one in the Engine under Speechform rooms.'));
    return rpc('sf_host_whoami', { p_key: key() }).then(function (w) { who = w; drawAll(); return w; })
      .catch(function (e) { who = null; drawAll(); throw e; });
  }
  function signOut() { setKey(''); who = null; leave(); drawAll(); }
  function take(snap) {
    room = snap.room;
    feed = snap.feedback || []; votes = snap.votes || {}; voteTimes = (snap.vote_times || []).map(function (v) { return { t: Date.parse(v.created_at), id: v.thread_id, d: 1 }; });
    try { localStorage.setItem(K_ROOM, room.status === 'open' ? room.id : ''); } catch (e) {}
    subscribe(); emit();
    return status();
  }
  function open(o) {
    o = o || {};
    return (who ? Promise.resolve(who) : signIn()).then(function () {
      var cohort = o.cohortId || (who.cohorts[0] && who.cohorts[0].id);
      if (!cohort) throw new Error('You facilitate no cohort yet. Make one in the Engine under People.');
      return rpc('sf_host_open', { p_key: key(), p_cohort: cohort, p_title: o.title || 'Speechform room', p_allow_guests: !!o.allowGuests, p_share_transcript: !!o.shareTranscript });
    }).then(function (snap) { lastSent = ''; lastShape = ''; return take(snap); });
  }
  function resume() {
    var id = ''; try { id = localStorage.getItem(K_ROOM) || ''; } catch (e) {}
    if (!id || !key()) return Promise.resolve(null);
    return signIn().then(function () { return rpc('sf_host_room', { p_key: key(), p_room: id }); }).then(function (snap) { return snap.room.status === 'open' ? take(snap) : null; }).catch(function () { return null; });
  }
  function set(o) {
    if (!room) return Promise.reject(new Error('No room is open.'));
    o = o || {};
    return rpc('sf_host_set', { p_key: key(), p_room: room.id, p_status: o.status || null,
      p_allow_guests: o.allowGuests == null ? null : !!o.allowGuests, p_share_transcript: o.shareTranscript == null ? null : !!o.shareTranscript, p_title: o.title || null })
      .then(function (snap) { lastSent = ''; return take(snap); });
  }
  function close() {
    if (!room) return Promise.resolve(null);
    return set({ status: 'closed' }).then(function (s) { leave(true); return s; });
  }
  function leave(keepSummary) {
    if (chan && sb) sb.removeChannel(chan); chan = null;
    if (!keepSummary) { room = null; feed = []; votes = {}; voteTimes = []; }
    try { localStorage.setItem(K_ROOM, ''); } catch (e) {}
    clearTimeout(timer); timer = null; pending = null; emit();
  }
  function subscribe() {
    if (!room || room.status !== 'open') return;
    client().then(function (c) {
      if (chan) c.removeChannel(chan);
      chan = c.channel(room.channel)
        .on('broadcast', { event: 'feedback' }, function (m) {
          var f = m.payload; if (!f || feed.some(function (x) { return x.id === f.id; })) return;
          feed.push(f); fbFns.forEach(function (fn) { try { fn(f); } catch (e) { console.error(e); } }); emit();
        })
        .on('broadcast', { event: 'unfeedback' }, function (m) { feed = feed.filter(function (x) { return x.id !== (m.payload || {}).id; }); emit(); })
        .on('broadcast', { event: 'vote' }, function (m) {
          var v = m.payload || {}; votes[v.thread_id] = Math.max(0, (votes[v.thread_id] || 0) + (v.delta || 0));
          voteTimes.push({ t: Date.parse(v.created_at) || Date.now(), id: v.thread_id, d: v.delta || 0 }); emit();
        })
        .on('broadcast', { event: 'room' }, function (m) { var r = m.payload || {}; if (room) { room.status = r.status; room.allow_guests = r.allow_guests; room.share_transcript = r.share_transcript; } emit(); })
        .subscribe(function (s) { if (room) room.live = s === 'SUBSCRIBED'; drawAll(); });
    });
  }

  /* ── publishing ────────────────────────────────────────────────────── */
  function clip(s, n) { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function liveState(t, now) { return t.state !== 'closed' && t.last_at && now - t.last_at >= CFG.dormant ? 'dormant' : t.state; }
  function arcWord(a) {
    if (!a) return null; if (typeof a === 'string') return a;
    var cur = (a.stages || []).filter(function (s) { return s.id === a.current; })[0];
    return cur ? cur.name : a.current || (a.stages && a.stages[0] && 'before ' + a.stages[0].name) || null;
  }
  /* Studio's state (with .steer) or the plain shape, made small for the room */
  function shape(o) {
    o = o || {};
    var st = o.steer || null, now = o.now || Date.now() / 1000;
    var threads = (o.threads || (st && st.threads) || []).slice(-16).map(function (t) {
      var label = t.label || t.title || (t.keywords && t.keywords.slice(0, 3).join(' ')) || clip(t.first, 40) || 'a thread';
      return { id: String(t.id).slice(0, 64), label: clip(label, 60), state: st ? liveState(t, now) : (t.state || 'opened'),
               speaker: t.speaker || t.opened_by || null, started_at: t.started_at || t.opened_at || null,
               active: t.active != null ? !!t.active : !!(st && st.active === t.id) };
    });
    threads.forEach(function (t) { threadNames[t.id] = t.label; });
    var qs = o.questions || (st && st.talk && st.talk.questions) || [];
    qs = qs.filter(function (q) { return typeof q === 'string' || !q.answered_at; }).slice(-6).map(function (q) { return clip(typeof q === 'string' ? q : q.text, 160); });
    var lines = o.lines || (o.transcript || []).slice(-4).map(function (e) { return e.text; });
    var absorption = o.absorption != null ? o.absorption : st && st.hold ? st.hold.meter : null;
    return { form: clip(o.form || o.lead_form || (st && st.arc && st.arc.kind) || '', 60) || null,
             arc: clip(arcWord(o.arc != null ? o.arc : st && st.arc), 60) || null,
             absorption: absorption == null ? null : Math.round(Math.max(0, Math.min(1, +absorption)) * 1000) / 1000,
             threads: threads, questions: qs, lines: room && room.share_transcript ? lines.slice(-4).map(function (l) { return clip(l, 200); }) : [] };
  }
  function publish(o) {
    if (!room || room.status !== 'open') return false;
    pending = shape(o);
    var form = JSON.stringify(pending.threads.map(function (t) { return [t.id, t.state, t.active]; }));
    var due = form !== lastShape ? 600 : CFG.every;          // a thread opening or changing state goes out at once
    var wait = Math.max(0, lastAt + due - Date.now());
    if (!timer) timer = setTimeout(flush, wait); else if (form !== lastShape && wait === 0) { clearTimeout(timer); timer = setTimeout(flush, 0); }
    return true;
  }
  function flush() {
    timer = null;
    if (!pending || !room || busy) { if (pending && busy) timer = setTimeout(flush, 500); return; }
    var body = JSON.stringify(pending);
    if (body === lastSent) { pending = null; return; }
    var send = pending; pending = null; busy = true; lastAt = Date.now();
    rpc('sf_host_publish', { p_key: key(), p_room: room.id, p_state: send }).then(function () {
      lastSent = body; lastShape = JSON.stringify(send.threads.map(function (t) { return [t.id, t.state, t.active]; })); lastError = '';
    }).catch(function (e) { lastError = e.message; if (/closed/.test(e.message)) { room.status = 'closed'; emit(); } })
      .then(function () { busy = false; if (pending) timer = setTimeout(flush, Math.max(0, lastAt + CFG.every - Date.now())); });
  }

  /* ── what the room wants ───────────────────────────────────────────── */
  /* summary(): {
       open, code, url, people,                  people = distinct names who posted
       reactions: { curious: n, ... },           every post so far, by kind
       recent: { curious: n, ... },              the last two minutes
       weather: [{ t, curious, confused, ... }], 15 s bins over the last ten minutes
       threads: { id: { label, votes, reactions: {kind: n}, posts, interest } },
       wants: [ids by interest]                  interest = votes + posts about the thread, halving every three minutes
     } */
  function summary(now) {
    now = now || Date.now();
    var hl = CFG.halfLife * 1000, decay = function (t) { return Math.pow(0.5, Math.max(0, now - t) / hl); };
    var out = { open: !!(room && room.status === 'open'), code: room && room.code, url: room && joinUrl(), people: 0, total: feed.length,
                reactions: {}, recent: {}, weather: [], threads: {}, wants: [] };
    KINDS.forEach(function (k) { out.reactions[k] = 0; out.recent[k] = 0; });
    var names = {}, bin = 15000, bins = 40, start = now - bin * bins;
    for (var i = 0; i < bins; i++) { var b = { t: start + i * bin }; KINDS.forEach(function (k) { b[k] = 0; }); out.weather.push(b); }
    function th(id) { return out.threads[id] || (out.threads[id] = { label: threadNames[id] || id, votes: votes[id] || 0, reactions: {}, posts: 0, interest: 0 }); }
    Object.keys(votes).forEach(function (id) { th(id); });
    voteTimes.forEach(function (v) { if (v.id) th(v.id).interest += (v.d || 0) * decay(v.t); });
    feed.forEach(function (f) {
      var t = Date.parse(f.created_at) || now, k = out.reactions[f.kind] != null ? f.kind : 'note';
      out.reactions[k]++; names[f.author_name] = 1;
      if (now - t <= 120000) out.recent[k]++;
      var bi = Math.floor((t - start) / bin); if (bi >= 0 && bi < bins) out.weather[bi][k]++;
      if (f.thread_id) { var x = th(f.thread_id); x.posts++; x.reactions[k] = (x.reactions[k] || 0) + 1; x.interest += (k === 'disagree' || k === 'confused' ? 0.6 : 1) * decay(t); }
    });
    Object.keys(out.threads).forEach(function (id) { var x = out.threads[id]; x.interest = Math.round(Math.max(0, x.interest) * 100) / 100; });
    out.people = Object.keys(names).length;
    out.wants = Object.keys(out.threads).filter(function (id) { return out.threads[id].interest > 0.05; }).sort(function (a, b) { return out.threads[b].interest - out.threads[a].interest; });
    return out;
  }

  /* the reactions as weather: each kind a coloured band stacked over time, the newest at the right */
  function weather(canvas, opts) {
    opts = opts || {};
    var s = summary(), ctx = canvas.getContext('2d'), dpr = root.devicePixelRatio || 1;
    var w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    var max = Math.max(3, Math.max.apply(null, s.weather.map(function (b) { return KINDS.reduce(function (a, k) { return a + b[k]; }, 0); })));
    var n = s.weather.length, step = w / (n - 1);
    var base = s.weather.map(function () { return h; });
    KINDS.forEach(function (k) {
      var top = s.weather.map(function (b, i) { return base[i] - (b[k] / max) * (h - 6); });
      ctx.beginPath(); ctx.moveTo(0, base[0]);
      for (var i = 0; i < n; i++) ctx.lineTo(i * step, top[i]);
      for (var j = n - 1; j >= 0; j--) ctx.lineTo(j * step, base[j]);
      ctx.closePath(); ctx.fillStyle = (opts.colors && opts.colors[k]) || COLOR[k]; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      base = top;
    });
    return s;
  }

  /* ── the panel for the desk ────────────────────────────────────────── */
  var CSS = [
    '.sfr{font:13px/1.45 var(--mono,ui-monospace,Menlo,monospace);color:var(--ink,#e8f5e4);border:2px solid var(--green-dim,rgba(57,255,20,.35));border-radius:14px;padding:12px;background:var(--panel,#070907);display:flex;flex-direction:column;gap:10px}',
    '.sfr h4{margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#7d9a78);font-weight:500}',
    '.sfr .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.sfr input[type=text],.sfr input[type=password],.sfr select{flex:1;min-width:0;height:32px;border-radius:9px;border:1px solid var(--faint,#2a3a28);background:#030503;color:inherit;padding:0 10px;font:inherit}',
    '.sfr button{height:32px;padding:0 12px;border-radius:9px;border:1px solid var(--faint,#2a3a28);background:#030503;color:inherit;font:inherit;cursor:pointer}',
    '.sfr button:hover{border-color:var(--amber,#ffc94a);color:var(--amber,#ffc94a)}',
    '.sfr button.go{border-color:var(--green,#39ff14);color:var(--green,#39ff14);background:var(--green-faint,rgba(57,255,20,.09));box-shadow:0 0 12px rgba(57,255,20,.25)}',
    '.sfr label.tg{display:inline-flex;gap:6px;align-items:center;color:var(--muted,#7d9a78);cursor:pointer}',
    '.sfr .code{font-size:34px;letter-spacing:.22em;font-weight:700;color:var(--green,#39ff14)}',
    '.sfr .join{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center}',
    '.sfr .qr{background:#fff;border-radius:10px;padding:6px;line-height:0}.sfr .qr svg{width:132px;height:132px}',
    '.sfr .url{word-break:break-all;color:var(--amber,#ffc94a)}',
    '.sfr .muted{color:var(--muted,#7d9a78)} .sfr .err{color:var(--red,#ff5a4a)}',
    '.sfr .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted,#7d9a78);margin-right:6px}.sfr .dot.on{background:var(--green,#39ff14);box-shadow:0 0 8px var(--green,#39ff14)}',
    '.sfr canvas{width:100%;height:46px;display:block;border-radius:8px;background:#030503}',
    '.sfr .tally{display:flex;gap:10px;flex-wrap:wrap}.sfr .tally span{display:inline-flex;gap:4px;align-items:center}.sfr .tally i{width:9px;height:9px;border-radius:50%}',
    '.sfr .wants{display:flex;flex-direction:column;gap:4px}.sfr .wants div{display:flex;justify-content:space-between;gap:8px}.sfr .wants b{font-weight:500}',
    '.sfr .feed{max-height:180px;overflow:auto;display:flex;flex-direction:column;gap:4px}.sfr .feed div{border-left:3px solid var(--k);padding-left:8px}'
  ].join('\n');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function joinUrl() { return room ? CFG.site + '/speechform/room?c=' + room.code : ''; }
  function panel(el, opts) {
    if (!document.getElementById('sfr-css')) { var st = document.createElement('style'); st.id = 'sfr-css'; st.textContent = CSS; document.head.appendChild(st); }
    var p = { el: el, opts: opts || {} }; panels.push(p);
    el.addEventListener('click', function (e) { var a = e.target.closest('[data-sfr]'); if (a) { if (a.tagName === 'A') e.preventDefault(); act(p, a.getAttribute('data-sfr')); } });
    el.addEventListener('change', function (e) { var a = e.target.closest('[data-sfr-set]'); if (a && room) set(a.getAttribute('data-sfr-set') === 'guests' ? { allowGuests: a.checked } : { shareTranscript: a.checked }).catch(function (x) { p.err = x.message; drawPanel(p); }); });
    drawPanel(p);
    if (key() && !who) signIn().catch(function (x) { p.err = x.message; drawPanel(p); });
    return { redraw: function () { drawPanel(p); }, remove: function () { panels.splice(panels.indexOf(p), 1); el.innerHTML = ''; } };
  }
  function act(p, a) {
    var $ = function (s) { return p.el.querySelector(s); };
    p.err = '';
    if (a === 'key') { signIn(($('[data-sfr-key]') || {}).value || '').catch(function (x) { p.err = x.message; drawPanel(p); }); return; }
    if (a === 'out') { signOut(); return; }
    if (a === 'open') {
      open({ cohortId: $('[data-sfr-cohort]').value, title: $('[data-sfr-title]').value, allowGuests: $('[data-sfr-guests0]').checked, shareTranscript: $('[data-sfr-lines0]').checked })
        .catch(function (x) { p.err = x.message; drawPanel(p); });
      return;
    }
    if (a === 'close') { close().catch(function (x) { p.err = x.message; drawPanel(p); }); return; }
    if (a === 'copy') { try { navigator.clipboard.writeText(joinUrl()); p.err = ''; p.note = 'The link is copied.'; drawPanel(p); } catch (e) {} return; }
    if (a === 'new') { leave(); return; }
    if (a === 'signin') { CFG.signIn && CFG.signIn(); return; }
  }
  function drawAll() { panels.forEach(drawPanel); }
  function drawPanel(p) {
    var el = p.el, h = '';
    if (!who && CFG.signIn && !session) {
      h = '<h4>The room</h4><div class="muted">Sign in to open a room for a cohort you facilitate.</div>' +
        '<div class="row"><button class="go" data-sfr="signin">Sign in</button></div>';
    } else if (!who) {
      h = '<h4>The room</h4><div class="muted">Hosting a room takes a host key from the Engine. It lets this Mac open rooms for your cohorts.</div>' +
        '<div class="row"><input type="password" data-sfr-key placeholder="sfh_..." autocomplete="off"><button class="go" data-sfr="key">Use the key</button></div>' +
        '<div class="row"><a class="url" href="' + esc(CFG.engine) + '" target="_blank" rel="noopener">Make a key in the Engine</a></div>';
    } else if (!room || (room.status !== 'open' && !p.keepClosed)) {
      h = '<h4>Open a room</h4><div class="muted">Signed in as ' + esc(who.name || 'the host') + '.' + (session ? '' : ' <a href="#" data-sfr="out" class="url">Use another key</a>') + '</div>' +
        '<div class="row"><select data-sfr-cohort>' + (who.cohorts || []).map(function (c) { return '<option value="' + esc(c.id) + '"' + (p.opts.cohortId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="row"><input type="text" data-sfr-title placeholder="A title for the session" value="' + esc(p.opts.title || '') + '"></div>' +
        '<div class="row"><label class="tg"><input type="checkbox" data-sfr-guests0' + (p.opts.allowGuests ? ' checked' : '') + '> guests may join by code</label>' +
        '<label class="tg"><input type="checkbox" data-sfr-lines0' + (p.opts.shareTranscript ? ' checked' : '') + '> share the last lines</label></div>' +
        '<div class="row"><button class="go" data-sfr="open">Open the room</button></div>' +
        (room && room.status !== 'open' ? '<div class="muted">The last room has closed. Its feedback stays in the Engine.</div>' : '');
    } else {
      var s = summary();
      h = '<div class="row" style="justify-content:space-between"><h4><span class="dot' + (room.live ? ' on' : '') + '"></span>' + esc(room.title) + '</h4><span class="muted">' + esc(room.cohort || '') + '</span></div>' +
        '<div class="join"><div class="qr" data-sfr-qr></div><div><div class="code">' + esc(room.code) + '</div><div class="url">' + esc(joinUrl().replace(/^https:\/\//, '')) + '</div>' +
        '<div class="row" style="margin-top:6px"><button data-sfr="copy">Copy the link</button><button data-sfr="close">Close the room</button></div></div></div>' +
        '<div class="row"><label class="tg"><input type="checkbox" data-sfr-set="guests"' + (room.allow_guests ? ' checked' : '') + '> guests by code</label>' +
        '<label class="tg"><input type="checkbox" data-sfr-set="lines"' + (room.share_transcript ? ' checked' : '') + '> share the last lines</label></div>' +
        '<canvas data-sfr-weather></canvas>' +
        '<div class="tally">' + KINDS.filter(function (k) { return s.reactions[k]; }).map(function (k) { return '<span><i style="background:' + COLOR[k] + '"></i>' + k + ' ' + s.reactions[k] + '</span>'; }).join('') + (s.total ? '' : '<span class="muted">The room has not reacted yet.</span>') + '</div>' +
        (s.wants.length ? '<h4>The room wants more of</h4><div class="wants">' + s.wants.slice(0, 4).map(function (id) { var t = s.threads[id]; return '<div><b>' + esc(t.label) + '</b><span class="muted">' + t.votes + ' explore · ' + t.posts + ' posts</span></div>'; }).join('') + '</div>' : '') +
        (p.opts.feed === false ? '' : '<div class="feed">' + feed.slice(-30).reverse().map(function (f) { return '<div style="--k:' + (COLOR[f.kind] || COLOR.note) + '"><b>' + esc(f.author_name) + '</b> <span class="muted">' + esc(f.kind) + '</span>' + (f.text ? ' ' + esc(f.text) : '') + (f.thread_id ? ' <span class="muted">on ' + esc(threadNames[f.thread_id] || 'a thread') + '</span>' : '') + '</div>'; }).join('') + '</div>');
    }
    if (p.err || lastError) h += '<div class="err">' + esc(p.err || lastError) + '</div>';
    if (p.note) { h += '<div class="muted">' + esc(p.note) + '</div>'; p.note = ''; }
    el.innerHTML = '<div class="sfr">' + h + '</div>';
    var q = el.querySelector('[data-sfr-qr]');
    if (q) load(QR_JS, function () { return root.qrcode; }).then(function () { var c = root.qrcode(0, 'M'); c.addData(joinUrl()); c.make(); q.innerHTML = c.createSvgTag({ cellSize: 4, margin: 1 }); }).catch(function () { q.textContent = ''; });
    var cv = el.querySelector('[data-sfr-weather]'); if (cv) requestAnimationFrame(function () { weather(cv); });
  }

  function status() { return room ? { id: room.id, code: room.code, url: joinUrl(), title: room.title, status: room.status, cohort: room.cohort, live: !!room.live, allowGuests: room.allow_guests, shareTranscript: room.share_transcript } : null; }

  root.Room = {
    config: function (o) { for (var k in o) CFG[k] = o[k]; return CFG; },
    signIn: signIn, signOut: signOut, hasKey: function () { return !!key() || session; }, host: function () { return who; },
    /* the website: host with the site's signed-in session (a supabase client holding it); null goes back to the key */
    useSession: function (c) { var was = session; session = !!c; if (c) sb = c; else if (was) sb = null; who = null; if (session) return signIn().then(function () { return resume(); }).catch(function () { drawAll(); }); drawAll(); return Promise.resolve(); },
    open: open, resume: resume, close: close, set: set, status: status,
    publish: publish, flush: function () { clearTimeout(timer); timer = null; flush(); },
    onFeedback: function (fn) { fbFns.push(fn); return function () { fbFns.splice(fbFns.indexOf(fn), 1); }; },
    onChange: function (fn) { chFns.push(fn); return function () { chFns.splice(chFns.indexOf(fn), 1); }; },
    summary: summary, feed: function () { return feed.slice(); }, weather: weather, panel: panel,
    KINDS: KINDS, COLOR: COLOR, _shape: shape
  };
})(typeof window !== 'undefined' ? window : this);
