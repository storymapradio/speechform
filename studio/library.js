/* Speechform Studio: the library, kept with the person's account on the site (asynchronousinstruments.com).
 *
 * Signed in with the site's own sign-in (the /auth window; same site, so the session is shared), every card made
 * here, on the Mac (full mode) or in the browser (web mode), is copied to the account: a row in sf_cards (its
 * reading, depth, threads and phrases) and its files in the private bucket "speechform" under the person's own
 * folder. The library page lists them on any device, a phone too, and opens each one's replay.
 * Only the owner can read their rows and files (RLS on sf_cards and on the bucket).
 *
 *   SpeechformLibrary.mount(page, { open(card) })   the library page
 *   SpeechformLibrary.changed()                     a card was made or finished: sync soon
 *   SpeechformLibrary.client()                      the signed-in supabase client, or null
 */
(function (root) {
  'use strict';
  const SB_URL = 'https://nqelzijdjgpvzcczfvvy.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xZWx6aWpkamdwdnpjY3pmdnZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NjUyMzgsImV4cCI6MjA4ODM0MTIzOH0.oVB3MNpvsTTnaqmdimlSrRPzx_c7czDARTerzvC3Et8';
  const SB_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  const BUCKET = 'speechform', AUDIO_MAX = 10e6;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* the site's session lives on the site: on the Mac's own page (127.0.0.1:9990) the library is not reachable */
  const onSite = !(/^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port === '9990');
  let sb = null, user = null, page = null, opts = {}, rows = null, syncing = 0, syncErr = '', timer = null, busy = false;
  const listeners = [];

  const load = (src, ok) => ok() ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); });
  async function client() {
    if (!onSite) return null;
    if (sb) return sb;
    await load(SB_JS, () => root.supabase && root.supabase.createClient);
    sb = root.supabase.createClient(SB_URL, ANON);              // the site's default storage key: the same session as /auth
    sb.auth.onAuthStateChange((_e, s) => { const was = user && user.id; user = s ? s.user : null; if ((user && user.id) !== was) { rows = null; say(); if (user) changed(1500); } });
    const { data } = await sb.auth.getSession(); user = data.session ? data.session.user : null;
    return sb;
  }
  async function signIn() {
    const c = await client(); if (!c) return;
    await load('/shared/signin.js', () => root.SignInWindow);
    root.SignInWindow.open(c, { closable: true, onSignedIn: async () => { const { data } = await c.auth.getSession(); user = data.session ? data.session.user : null; say(); changed(500); } });
  }
  async function signOut() { const c = await client(); if (c) await c.auth.signOut(); user = null; rows = null; say(); }
  const say = () => { draw(); listeners.forEach(f => { try { f({ user, syncing, error: syncErr }); } catch (e) {} }); };

  /* ── sync: every card here that the account does not have yet ── */
  const safe = s => String(s).replace(/[^\w.-]+/g, '_').slice(0, 120);
  const fileOf = (c, f) => fetch(`/cards/${encodeURIComponent(c.id)}/${f}`);   // the Mac's or this browser's (studio/local.js routes it)
  async function asBlob(res, type) {
    if (!res || !res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct.startsWith('text/plain') && type !== 'text/plain') { const t = await res.text(); return t.startsWith('data:') ? await (await fetch(t)).blob() : null; }
    return await res.blob();
  }
  async function jsonOf(c, f) { try { const r = await fileOf(c, f); return r.ok ? await r.json() : null; } catch (e) { return null; } }
  async function audioOf(c) {
    if (!c.audio) return null;
    if (String(c.audio).startsWith('data:')) { const b = await (await fetch(c.audio)).blob(); return b.size <= AUDIO_MAX ? b : null; }
    try {   /* the Mac's: its size first, from one byte of it */
      const head = await fetch(`/cards/${encodeURIComponent(c.id)}/${c.audio}`, { headers: { Range: 'bytes=0-0' } });
      const total = +((head.headers.get('content-range') || '').split('/')[1] || 0);
      if (!total || total > AUDIO_MAX) return null;
      return await asBlob(await fileOf(c, c.audio), 'audio/wav');
    } catch (e) { return null; }
  }
  const finished = c => !/^(waiting|asking Jev|the easel is drawing)$/.test(c.art || '');
  async function syncOne(c, have) {
    const uid = user.id, dir = `${uid}/${safe(c.id)}`, files = { ...(have ? have.files : {}) };
    const put = async (name, blob, type) => {
      if (!blob) return;
      const path = `${dir}/${name}`, { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: type || blob.type || 'application/octet-stream' });
      if (!error) files[name] = path; else throw new Error(error.message);
    };
    if (!have) {
      const abstract = c.abstract && String(c.abstract).startsWith('data:') ? await (await fetch(c.abstract)).blob() : c.abstract ? await asBlob(await fileOf(c, c.abstract), 'image/jpeg') : null;
      await put('grown.jpg', abstract, 'image/jpeg');
      if (c.clear) await put('painted' + (String(c.clear).match(/\.\w+$/) || ['.png'])[0], await asBlob(await fileOf(c, c.clear), 'image'), 'image/png');
      await put('audio.wav', await audioOf(c), 'audio/wav');
      await put('reading.txt', await asBlob(await fileOf(c, 'reading.txt'), 'text/plain'), 'text/plain; charset=utf-8');
    }
    if (c.faces) {
      if (!files['card-front.png']) await put('card-front.png', await asBlob(await fileOf(c, 'card-front.png'), 'image/png'), 'image/png');
      if (!files['card-back.png']) await put('card-back.png', await asBlob(await fileOf(c, 'card-back.png'), 'image/png'), 'image/png');
    }
    const card = { ...c }; delete card.abstract; delete card.audio; delete card.text;
    const row = { owner: uid, card_id: c.id, source: root.SpeechformLocal && root.SpeechformLocal.mode === 'web' ? 'web' : 'mac', title: c.name || c.id, kind: c.kind || null,
      made_at: new Date((c.made || Date.now() / 1000) * 1000).toISOString(), transcript: c.text || null, card, files };
    if (!have) Object.assign(row, { reading: await jsonOf(c, 'reading.json'), depth: await jsonOf(c, 'depth.json'), threads: await jsonOf(c, 'threads.json'), phrases: await jsonOf(c, 'phrases.json') });
    else { row.depth = await jsonOf(c, 'depth.json'); row.threads = await jsonOf(c, 'threads.json'); }
    const { error } = await sb.from('sf_cards').upsert(row, { onConflict: 'owner,card_id' });
    if (error) throw new Error(error.message);
  }
  async function sync() {
    if (busy || !onSite) return; busy = true;
    try {
      await client(); if (!user) return;
      const mine = await (await fetch('/cards')).json().then(j => j.cards || []).catch(() => []);
      const { data: got, error } = await sb.from('sf_cards').select('card_id, files, card').eq('owner', user.id);
      if (error) throw new Error(error.message);
      const have = Object.fromEntries((got || []).map(r => [r.card_id, r]));
      const todo = mine.filter(c => finished(c) && (!have[c.id] || (c.faces && !(have[c.id].files || {})['card-front.png']) || (c.jev && !(have[c.id].card || {}).jev)));
      syncing = todo.length; syncErr = ''; say();
      for (const c of todo) { try { await syncOne(c, have[c.id]); } catch (e) { syncErr = e.message; } syncing--; say(); }
      if (todo.length) rows = null;
    } catch (e) { syncErr = e.message; } finally { busy = false; syncing = 0; say(); }
  }
  function changed(ms = 4000) { clearTimeout(timer); timer = setTimeout(sync, ms); }
  setInterval(() => { if (user) sync(); }, 60000);

  /* ── the library page ── */
  async function list() {
    const { data, error } = await sb.from('sf_cards').select('id, card_id, title, kind, made_at, source, files').order('made_at', { ascending: false }).limit(300);
    if (error) throw new Error(error.message);
    return data || [];
  }
  async function openRow(r) {
    const { data: full, error } = await sb.from('sf_cards').select('*').eq('id', r.id).single();
    if (error) return;
    const names = Object.keys(full.files || {}), urls = {};
    if (names.length) {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(names.map(n => full.files[n]), 3600);
      (signed || []).forEach((s, i) => { if (s.signedUrl) urls[names[i]] = s.signedUrl; });
    }
    const painted = names.find(n => n.startsWith('painted'));
    const card = { ...(full.card || {}), id: 'library:' + full.card_id, name: full.title, library: true, since: (full.card || {}).since, art: (full.card || {}).art || 'kept',
      abstract: urls['grown.jpg'] ? 'grown.jpg' : null, clear: painted || null, audio: urls['audio.wav'] ? 'audio.wav' : null, urls,
      inline: { 'phrases.json': full.phrases || [], 'threads.json': full.threads || { threads: [] }, 'reading.json': full.reading || {}, 'depth.json': full.depth || {} } };
    opts.open && opts.open(card);
  }
  async function draw() {
    if (!page) return;
    const head = `<div class="libhead"><b>library</b><span class="libnote">${!onSite ? '' : user ? esc(user.email || 'signed in') + (syncing ? ` · syncing ${syncing}` : '') : ''}</span>
      ${onSite ? (user ? '<button data-l="out">sign out</button>' : '') : ''}</div>`;
    if (!onSite) { page.innerHTML = head + '<p class="quiet libp">The library lives with your account on asynchronousinstruments.com/speechform. Open Studio there, connected to this Mac, to sync these cards and see them on any device.</p>'; return; }
    await client();
    if (!user) {
      page.innerHTML = head + `<p class="libp">Sign in to keep every recording in your library and open it on any device, your phone too. Only you can see it.</p>
        <p class="libp"><button class="libcta" data-l="in">sign in</button></p>`;
    } else {
      if (!rows) { try { rows = await list(); } catch (e) { rows = []; syncErr = e.message; } }
      page.innerHTML = head + (syncErr ? `<p class="quiet libp">${esc(syncErr)}</p>` : '') + (rows.length
        ? '<div class="scroll libl">' + rows.map((r, i) => `<div class="line" data-i="${i}"><div class="said">${esc(r.title)}</div><div class="meta"><span class="chip" style="color:${(root.SpeechformReading && root.SpeechformReading.COLORS[root.SpeechformReading.IMAGE[r.kind]]) || '#7d9a78'}">${esc(r.kind || 'a recording')}</span><span class="chip idea">${new Date(r.made_at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span><span class="chip idea">${r.source === 'mac' ? 'from the Mac' : 'in the browser'}</span></div></div>`).join('') + '</div>'
        : '<p class="quiet libp">Your recordings appear here as soon as they are made.</p>');
      page.querySelectorAll('.line[data-i]').forEach(l => l.onclick = () => openRow(rows[+l.dataset.i]));
    }
    const i = page.querySelector('[data-l="in"]'); if (i) i.onclick = signIn;
    const o = page.querySelector('[data-l="out"]'); if (o) o.onclick = signOut;
  }
  function mount(el, o = {}) { page = el; opts = o; draw(); client().then(() => { draw(); if (user) changed(1500); }).catch(() => {}); }
  const css = `.libhead{display:flex;align-items:center;gap:10px;padding:10px 14px 6px;border-bottom:1px solid var(--faint)}.libhead b{color:var(--green);font-weight:500;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase}
.libnote{flex:1;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.libhead button{font:inherit;font-size:11px;border:1px solid var(--faint);background:none;color:var(--muted);border-radius:10px;padding:4px 10px;cursor:pointer}
.libl .line{display:block;padding:9px 10px}.libl .said{font-size:14px}.libl .meta{margin-top:6px}
.libp{padding:4px 14px;line-height:1.55;margin:8px 0}.libcta{font:inherit;padding:9px 16px;border-radius:12px;border:1px solid rgba(255,201,74,.6);background:rgba(255,201,74,.08);color:var(--amber);cursor:pointer;box-shadow:0 0 14px rgba(255,201,74,.18)}`;
  if (typeof document !== 'undefined') { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }
  root.SpeechformLibrary = { mount, changed, sync, signIn, signOut, client: async () => (await client(), user ? sb : null), onChange: f => listeners.push(f), get user() { return user; }, get syncing() { return syncing; }, onSite };
})(this);
