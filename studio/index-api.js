/* Speechform Studio: the global index (Supabase edge function "index": pgvector items, threads, edges and concepts
 * across every app, scoped me | cohort | public). A thin adapter: Studio speaks to it in the shapes below, and
 * anything the index answers is turned into the Links section's own shape. Signed in only; without the index (not
 * deployed yet, or signed out, or offline) every call resolves to null and Links uses this device's own index.
 *
 *   SpeechformIndex.upsert({ item, threads })        at the stop: the recording and its threads
 *   SpeechformIndex.live({ threads, text })           every few phrases while speaking (retrieval, not Jev)
 *   SpeechformIndex.search({ q, scope, apps })        threads and items across the index
 *   SpeechformIndex.thread({ id, scope, apps })       one thread's timeline across apps
 *   SpeechformIndex.concepts({ scope, apps })         the themes
 *   SpeechformIndex.status                            'unknown' | 'ready' | 'absent' | 'signed out'
 * Every result row is normalised to { id, title, app, at, scope, strength, shared, meaning, edge, first, item, thread }.
 */
(function (root) {
  'use strict';
  const URL_ = 'https://nqelzijdjgpvzcczfvvy.supabase.co/functions/v1/index';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xZWx6aWpkamdwdnpjY3pmdnZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NjUyMzgsImV4cCI6MjA4ODM0MTIzOH0.oVB3MNpvsTTnaqmdimlSrRPzx_c7czDARTerzvC3Et8';
  let status = 'unknown', absentUntil = 0;
  const APPS = ['studio', 'oral', 'dreams', 'walks', 'engine'], SCOPES = ['me', 'cohort', 'public'];

  async function token() {
    const L = root.SpeechformLibrary; if (!L || !L.onSite) return null;
    const sb = await L.client(); if (!sb) return null;
    const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : null;
  }
  async function call(action, body) {
    if (Date.now() < absentUntil) return null;
    const t = await token(); if (!t) { status = 'signed out'; return null; }
    try {
      const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t, apikey: ANON }, body: JSON.stringify({ action, ...body }) });
      if (r.status === 404 || r.status === 501) { status = 'absent'; absentUntil = Date.now() + 5 * 60e3; return null; }
      if (!r.ok) return null;
      status = 'ready'; return await r.json();
    } catch (e) { status = 'absent'; absentUntil = Date.now() + 60e3; return null; }
  }
  /* rows from the index, whatever their exact field names, in the Links section's shape */
  const rowsOf = j => (j && (j.results || j.items || j.threads || j.matches || j.data || (Array.isArray(j) ? j : []))) || [];
  const norm = r => ({ id: r.id || r.item_id || r.thread_id, title: r.title || r.label || r.name || '', app: r.app || r.source || 'studio', at: r.at ? (typeof r.at === 'number' ? r.at : Date.parse(r.at) / 1000) : r.created_at ? Date.parse(r.created_at) / 1000 : null,
    scope: r.scope || 'me', strength: r.strength ?? r.score ?? r.similarity ?? null, shared: (r.why && (r.why.words || r.why.shared)) || r.shared || [], meaning: (r.why && (r.why.vector ?? r.why.meaning)) ?? r.meaning ?? null,
    edge: r.edge || r.type || r.kind_of_link || null, first: r.first || r.snippet || r.text || '', item: r.item_id || r.item || null, thread: r.thread_id || null });
  const threadsOut = ts => (ts || []).map(t => ({ id: t.id, title: t.title, kind: t.kind, state: t.state, stage: t.stage, keywords: t.keywords, words: Object.values(t.say || {}), first: t.first, opened_by: t.opened_by, opened_at: t.opened_at }));

  const api = {
    APPS, SCOPES,
    get status() { return status; },
    async upsert({ item, threads }) { return call('upsert', { app: 'studio', item, threads: threadsOut(threads) }); },
    async live({ threads, text }) { const j = await call('live', { app: 'studio', threads: threadsOut(threads), text: String(text || '').slice(-2000) }); return j ? rowsOf(j).map(norm) : null; },
    async search({ q, scope = 'me', apps = APPS }) { const j = await call('search', { q, scope, apps }); return j ? rowsOf(j).map(norm) : null; },
    async thread({ id, scope = 'me', apps = APPS }) { const j = await call('thread', { id, scope, apps }); return j ? rowsOf(j).map(norm) : null; },
    async concepts({ scope = 'me', apps = APPS }) { const j = await call('concepts', { scope, apps }); return j ? rowsOf(j).map(r => ({ ...norm(r), members: r.members || r.items || [] })) : null; },
  };
  root.SpeechformIndex = api;
})(this);
