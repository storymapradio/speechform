/* Speechform Studio: the global index (storymapradio/engine/INDEX-API.md; the edge function "index").
 * One cloud index of everything people say across the estate: Speechform, SOLOS (oral histories), Dream Journal,
 * Perambulations, Story Map readings, the Engine's tapes, rooms. Signed in only; what anyone sees is decided by RLS.
 * Without a session (or offline) every call resolves to null and Links uses this device's own index.
 *
 *   SpeechformIndex.upsert({ item, phrases, threads, since, visibility })   at the stop (private by default)
 *   SpeechformIndex.live({ phrases, recordingId, scope, apps })             every few phrases while speaking (retrieval, not Jev)
 *   SpeechformIndex.search({ q, scope, apps })                              hybrid: meaning + words + people and places
 *   SpeechformIndex.thread({ id, recordingId, scope, apps })                a thread's timeline across apps
 *   SpeechformIndex.concepts({ scope, apps })                               themes, with their apps and growth
 *   SpeechformIndex.status    'unknown' | 'ready' | 'signed out' | 'resting' | 'absent'
 * Rows come back normalised: { id, title, app, appName, at, scope, mine, strength, shared, entities, meaning, edge, edgeBy, first, highlight,
 *   recording, thread, span, speaker }. Over a limit (429) the index rests for retry_s, quietly.
 */
(function (root) {
  'use strict';
  const URL_ = 'https://nqelzijdjgpvzcczfvvy.supabase.co/functions/v1/index';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xZWx6aWpkamdwdnpjY3pmdnZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NjUyMzgsImV4cCI6MjA4ODM0MTIzOH0.oVB3MNpvsTTnaqmdimlSrRPzx_c7czDARTerzvC3Et8';
  const APP_NAME = { speechform: 'Speechform', studio: 'Speechform', oral: 'SOLOS', dreams: 'Dream Journal', walks: 'Perambulations', nights: 'Story Map readings', engine: 'Engine tapes', room: 'Speechform room' };
  const APPS = ['speechform', 'oral', 'dreams', 'walks', 'nights', 'engine', 'room'];
  const SCOPES = ['all', 'me', 'cohort', 'public'];
  let status = 'unknown', restUntil = 0;

  async function token() {
    const L = root.SpeechformLibrary; if (!L || !L.onSite) return null;
    const sb = await L.client(); if (!sb) return null;
    const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : null;
  }
  async function call(action, body) {
    if (Date.now() < restUntil) { status = 'resting'; return null; }
    const t = await token(); if (!t) { status = 'signed out'; return null; }
    try {
      const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t, apikey: ANON }, body: JSON.stringify({ action, ...body }) });
      if (r.status === 429) { const j = await r.json().catch(() => ({})); restUntil = Date.now() + 1000 * (+j.retry_s || +r.headers.get('retry-after') || 60); status = 'resting'; return null; }
      if (r.status === 404) { status = 'absent'; restUntil = Date.now() + 5 * 60e3; return null; }
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok === false) return null;
      status = 'ready'; return j;
    } catch (e) { return null; }
  }
  const epoch = v => v == null ? null : typeof v === 'number' ? v : Date.parse(v) / 1000;
  const norm = r => { const w = r.why || {};
    return { id: r.id, title: r.title || '', app: r.app || 'speechform', appName: APP_NAME[r.app] || r.app || '', at: epoch(r.at), scope: r.scope || (r.mine ? 'me' : ''), mine: !!r.mine,
      strength: r.score ?? null, shared: w.words || [], entities: (w.entities || []).map(e => String(e).replace(/^\w+:/, '')), meaning: w.cosine ?? null, edge: r.edge || null, edgeBy: r.edge_by || null,
      first: r.first || r.text || '', highlight: r.highlight || null, recording: r.recording_id || null, thread: r.thread_id || r.id, span: r.span || null, speaker: r.speaker || null, here: !!r.here, state: r.state || null }; };
  const threadsOut = ts => (ts || []).map(t => ({ id: t.id, title: t.title, kind: t.kind, state: t.state, stage: t.stage, keywords: t.keywords, first: t.first, opened_by: t.opened_by }));

  root.SpeechformIndex = {
    APPS, SCOPES, APP_NAME,
    get status() { return status; },
    async upsert({ item, phrases, threads, since, visibility = 'private' }) {
      const j = await call('upsert', { app: 'studio', visibility, item: { ...item, since: since ?? item.since },
        phrases: (phrases || []).slice(0, 1500).map(p => ({ text: p.text, at: p.at, kind: p.kind, idea: p.idea, speaker: p.speaker || 'A' })), threads: threadsOut(threads).slice(0, 200) });
      return j ? { ...j, results: (j.results || []).map(norm) } : null;
    },
    async live({ phrases, recordingId, scope = 'all', apps = null }) { const j = await call('live', { phrases: (phrases || []).slice(-12), recording_id: recordingId || undefined, scope, apps, limit: 8 }); return j ? (j.results || []).map(norm) : null; },
    async search({ q, scope = 'all', apps = null }) { const j = await call('search', { q, scope, apps, limit: 20 }); return j ? (j.results || []).map(norm) : null; },
    async thread({ id, recordingId, scope = 'all', apps = null }) { const j = await call('thread', { id, recording_id: recordingId || undefined, scope, apps, limit: 12 });
      return j ? { thread: j.thread, related: (j.results || []).map(norm), timeline: (j.timeline || []).map(norm), concepts: j.concepts || [] } : null; },
    async concepts({ scope = 'all', apps = null }) { const j = await call('concepts', { scope, apps, limit: 40 });
      return j ? (j.results || []).map(c => ({ id: c.id, title: c.title || c.label, words: c.words || [], scope: c.scope, apps: c.apps || [], n: c.n, members: (c.members || []).map(norm), last: epoch(c.last_at) })) : null; },
  };
})(this);
