/* Speechform: Jev from the browser, through the site's proxy (TypeSafe's System One; the key stays on the server).
 *
 * The questions are the Mac's own (imagery/cards.py and imagery/server.py): the kind of speech, the three lens
 * scores, the strongest absorption element, the stage of the arc, the one next move, and how each open thread
 * could have continued. Jev is asked only:
 *   at the stop of a recording, once;
 *   at a natural pause (PAUSE seconds of quiet), and only when the last call was SPACING seconds ago and WORDS new
 *   words have arrived since;
 *   for a selected passage, at most once every PASSAGE seconds.
 * Never while words are arriving: an answer that lands after speech resumed is set aside by the caller.
 * Over the proxy's limits it answers 429 {rested: true}: Jev rests until REST seconds pass, and the algorithm steers.
 */
(function (root) {
  'use strict';
  const D = root.SpeechformDepth, Lg = root.SpeechformLedger;
  const ENDPOINT = 'https://nqelzijdjgpvzcczfvvy.supabase.co/functions/v1/speechform-jev';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xZWx6aWpkamdwdnpjY3pmdnZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NjUyMzgsImV4cCI6MjA4ODM0MTIzOH0.oVB3MNpvsTTnaqmdimlSrRPzx_c7czDARTerzvC3Et8';
  const PAUSE = 8, SPACING = 90, WORDS = 60, PASSAGE = 20, REST = 300, MAX_Q = 48, MAX_STATE = 16000;
  const KIND_CRITERIA = {
    'instruction': 'steps or commands telling someone how to do something', 'lecture': 'explaining a subject, research or evidence to an audience',
    'lesson': 'teaching a class, asking learners to try and answer', 'dialogue': 'two people talking, questions and replies',
    'reflective monologue': "looking back on one's own life and what it meant", 'thinking aloud': 'working a problem out loud, hesitating, trying options',
    'stream of consciousness': 'a run-on drift of images and thoughts', 'reading aloud': 'written prose read from a book',
    'song': 'singing, chorus, la la', 'lyrics': 'song words, rhymed lines to someone', 'poetry': 'a poem, images and metaphor in short lines',
    'story': 'telling what happened to characters, one event after another', 'character development': 'how a character feels, changes, fears or wants',
    'scenery': 'describing a place or landscape', 'lore': 'the customs, orders and history of an invented world', 'myth': 'gods, origins, why the world is as it is',
    'cosmology': 'the universe, stars, space and time', 'mystery': 'a puzzle, clues, who did it', 'argument': 'making a claim and supporting it',
  };
  const LENS_SCALE = {
    listener: ['How much must a listener already know or bring to appreciate it?', ['needs much context', 'some', 'self-contained']],
    speaker: ['How clearly does the speaker deliver its meaning?', ['meaning unclear', 'implied', 'clearly delivered']],
    absorption: ['How far does it draw a listener in?', ['alert', 'drawn in', 'entranced']],
  };
  const st = { pauseAt: 0, pauseWords: -1e9, passageAt: 0, restedUntil: 0, asking: false, calls: 0, last: null };
  const nowS = () => Date.now() / 1000;

  async function ask(state, questions) {
    if (nowS() < st.restedUntil) return { rested: true };
    const names = Object.keys(questions);
    if (names.length > MAX_Q) for (const n of names.slice(MAX_Q)) delete questions[n];
    st.asking = true;
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, apikey: ANON },
        body: JSON.stringify({ state: String(state).slice(0, MAX_STATE), questions }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429 || j.rested) { st.restedUntil = nowS() + REST; return { rested: true }; }
      if (!r.ok) return { error: j.error || ('Jev answered ' + r.status) };
      st.calls++; st.last = nowS();
      return { answers: j.answers || {} };
    } catch (e) { return { error: 'Jev could not be reached' }; }
    finally { st.asking = false; }
  }

  function lensQuestions(name, kind, prefix) {
    const spec = D.spec(kind); if (!spec) return {};
    const qs = {};
    for (const [lens, [q, scale]] of Object.entries(LENS_SCALE))
      qs[prefix + lens] = { type: 'score', instructions: `${name} is heard as ${kind}. ${spec[lens].question} ${q}`, criteria: scale };
    qs[prefix + 'element'] = { type: 'choice', instructions: `${name} is heard as ${kind}. Which of these most draws the listener in?`,
      criteria: Object.fromEntries(spec.absorption.elements.map(e => [e.id, e.name + ': ' + e.meaning])) };
    return qs;
  }
  function lensAnswers(a, prefix) {
    const out = {};
    for (const [lens, [, scale]] of Object.entries(LENS_SCALE)) {
      const got = a[prefix + lens] || {};
      if ('score' in got) { out[lens] = Math.round(got.score / (scale.length - 1) * 1000) / 1000; out[lens + '_confidence'] = got.confidence; }
    }
    const el = a[prefix + 'element'] || {};
    if (el.choice) { out.element = el.choice; out.element_confidence = el.confidence; }
    return Object.keys(out).length ? out : null;
  }

  /* at a pause: the lenses of the talk so far, the stage of its arc, and the one next move (from the algorithm's) */
  async function pause({ events, quiet, words, kind, steer }) {
    if (st.asking) return { ok: false, why: 'Jev is already reading' };
    if (nowS() < st.restedUntil) return { ok: false, rested: true, why: 'Jev is resting; the algorithm steers' };
    if (quiet < PAUSE) return { ok: false, why: 'words are still arriving' };
    if (nowS() - st.pauseAt < SPACING) return { ok: false, why: `Jev was asked ${Math.round(nowS() - st.pauseAt)} s ago; the next pause after ${SPACING} s may ask again` };
    if (words - st.pauseWords < WORDS) return { ok: false, why: `${words - st.pauseWords} new words since Jev last read; it waits for ${WORDS}` };
    const window = events.slice(-40).map(e => e.text).join(' ').split(/\s+/).slice(-160).join(' ');
    const qs = lensQuestions('The talk so far', kind, ''), arc = Lg.arc(kind);
    if (arc.length) qs.stage = { type: 'choice', instructions: `The talk so far is heard as ${kind}. Which stage of its arc has it reached?`, criteria: Object.fromEntries(arc.map(x => [x.id, x.name + ': ' + x.move])) };
    const cands = Lg.candidates(steer || {});
    if (cands.length > 1) qs.move = { type: 'choice', instructions: 'The speaker has paused. Which single next move would serve this talk best?', criteria: Object.fromEntries(cands.map(c => [c.id, c.text])) };
    st.pauseAt = nowS(); st.pauseWords = words;
    const r = await ask(window, qs);
    if (r.rested) return { ok: false, rested: true, why: 'Jev is resting; the algorithm steers' };
    if (!r.answers) return { ok: false, why: r.error };
    const a = r.answers, mv = (a.move || {}).choice;
    return { ok: true, kind, lenses: lensAnswers(a, '') || {}, stage: (a.stage || {}).choice, stage_confidence: (a.stage || {}).confidence,
      move: cands.find(c => c.id === mv) || cands[0] || null, move_confidence: (a.move || {}).confidence, at: nowS() };
  }

  /* a selected passage: the same lens questions, for it alone */
  async function passage(text, kind) {
    const wait = PASSAGE - (nowS() - st.passageAt);
    if (wait > 0) return { ok: false, error: `Jev was asked about a passage moments ago; ask again in ${Math.ceil(wait)} s` };
    if (nowS() < st.restedUntil) return { ok: false, rested: true, error: 'Jev is resting; the algorithm steers' };
    st.passageAt = nowS();
    const r = await ask(text, lensQuestions('This passage', kind, ''));
    if (r.rested) return { ok: false, rested: true, error: 'Jev is resting; the algorithm steers' };
    return r.answers ? { ok: true, kind, jev: lensAnswers(r.answers, '') } : { ok: false, error: r.error };
  }

  /* at the stop: the kind of the whole recording, the lenses of each passage, and how each open thread could have gone on */
  async function card({ segments, threads, text }) {
    const open = (threads || []).filter(t => t.state !== 'closed').slice(0, 6), moves = Lg.suggestions(open), linked = (threads || []).filter(t => t.link).slice(0, 4);
    const room = Math.floor((MAX_Q - 1 - open.length - linked.length) / 6), segs = segments.slice(0, Math.max(1, room));
    const per = Math.max(200, Math.floor(7000 / Math.max(1, segs.length)));
    const state = segs.length ? segs.map((s, i) => `Passage ${i + 1}: ` + s.text.slice(0, per)).join('\n\n') : text;
    const qs = { kind: { type: 'choice', instructions: 'What kind of speech is this recording, taken as a whole' + (segs.length ? ' (all the passages together)?' : '?'), criteria: KIND_CRITERIA } };
    segs.forEach((s, i) => { qs[`p${i + 1}`] = { type: 'choice', instructions: `What kind of speech is Passage ${i + 1}?`, criteria: KIND_CRITERIA };
      Object.assign(qs, lensQuestions(`Passage ${i + 1}`, s.classifier, `p${i + 1}_`)); });
    /* how this recording connects to earlier ones: continued, closed or contradicted */
    linked.forEach((t, i) => { const l = t.link; qs[`c${i + 1}`] = { type: 'choice', instructions: `The thread "${t.title}" in this recording is linked to the thread "${l.title}" from ${l.date}, which began "${String(l.first || '').slice(0, 100)}". What did this recording do with it?`,
      criteria: { continued: 'took it further', closed: 'brought it to an end or answered it', contradicted: 'said the opposite or changed its mind about it', unrelated: 'the link is a coincidence of words' } }; });
    open.forEach((t, i) => { qs[`t${i + 1}`] = { type: 'choice', instructions: `The thread "${t.title}" (${t.kind}) was left ${t.state}, beginning "${t.first || ''}". How could it best have continued or closed?`, criteria: moves[t.id] || { rest: 'Let it rest.' } }; });
    const r = await ask(state, qs);
    if (r.rested) return { rested: true };
    if (!r.answers) return { error: r.error };
    const a = r.answers;
    return { kind: (a.kind || {}).choice, confidence: (a.kind || {}).confidence,
      segments: segs.map((s, i) => ({ ...s, jev: (a[`p${i + 1}`] || {}).choice, confidence: (a[`p${i + 1}`] || {}).confidence, depth: lensAnswers(a, `p${i + 1}_`) })),
      connections: Object.fromEntries(linked.map((t, i) => [t.id, { past: t.link.title, date: t.link.date, card: t.link.card, relation: (a[`c${i + 1}`] || {}).choice, confidence: (a[`c${i + 1}`] || {}).confidence }]).filter(([, v]) => v.relation)),
      threads: Object.fromEntries(open.map((t, i) => { const c = (a[`t${i + 1}`] || {}).choice; return [t.id, { choice: c, move: (moves[t.id] || {})[c], confidence: (a[`t${i + 1}`] || {}).confidence }]; }).filter(([, v]) => v.choice)) };
  }

  root.SpeechformJev = { pause, passage, card, ask, lensQuestions, lensAnswers, KIND_CRITERIA,
    get resting() { return nowS() < st.restedUntil; }, get asking() { return st.asking; }, get state() { return { ...st }; },
    LIMITS: { PAUSE, SPACING, WORDS, PASSAGE, REST, MAX_Q, MAX_STATE } };
})(this);
