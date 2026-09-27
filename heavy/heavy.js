/* Speechform Heavy: the image Jev builds as you speak, over the camera, saved as a sequence.
 *
 * First the camera feed; as you speak it dims and the layers move in over it: the growing images,
 * then the images Jev makes (or finds in the bank). When the talk is narrative, your silhouette looms
 * over the scene. Moving in front of the camera throws sparks and grows the image. Every moment is
 * saved; a long pause breaks the streak, and the next words build on the saved image you pick, or on
 * the one Jev (or the words themselves) picks.
 */
import { Camera } from './camera.js';
const C = window.SpeechformClassify, G = window.SpeechformGrowers;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const col = r => `var(--r-${r})`;
const now = () => Date.now() / 1000;
const post = (p, b) => fetch(p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json()).catch(() => null);

/* ── nothing unkind is shown or drawn: the same words the server keeps out of every image ── */
const PROFANITY = new Set('fuck fucking fucked fucker shit shitty bullshit bitch bitches bastard asshole ass damn goddamn crap dick cock cunt pussy piss slut whore wanker bollocks motherfucker'.split(' '));
const VIOLENCE = new Set('kill killed killing kills murder murdered murderer blood bloody gore gory gun guns shoot shooting shot stab stabbed knife knives bomb bombs explode explosion corpse corpses torture tortured weapon weapons massacre slaughter behead decapitate war wounded wound rape suicide dead death die dying'.split(' '));
const mask = t => t.replace(/[A-Za-z']+/g, w => PROFANITY.has(w.toLowerCase()) ? '•'.repeat(w.length) : w);
const STOP = new Set('a an the this that these those is are was were be been being to of and or in on at for with as i you he she it we they my your our their me us them but if then so from by have has had do does did will would can could should just very all some about into how what when where which who its let not there here one also more like said says know think really yeah okay right going want thing things something people upon down across along over under through once there then'.split(' '));
const keys = (t, n = 12) => [...new Set((t.toLowerCase().match(/[a-z']+/g) || []).filter(w => w.length > 3 && !STOP.has(w) && !PROFANITY.has(w) && !VIOLENCE.has(w)))].slice(0, n);
const NARRATIVE = new Set(['story', 'myth', 'lore', 'character development', 'cosmology', 'reading aloud']);

/* ── the styles ── */
const STYLES = {
  ink: { name: 'ink', filter: 'grayscale(1) contrast(1.25) brightness(1.1)' },
  glass: { name: 'stained glass', filter: 'saturate(1.9) contrast(1.1)' },
  water: { name: 'watercolour', filter: 'saturate(.75) brightness(1.1) blur(.6px)' },
  neon: { name: 'neon', filter: 'saturate(1.7) brightness(1.25)' },
  woodcut: { name: 'woodcut', filter: 'sepia(.75) contrast(1.45)' },
  cosmic: { name: 'cosmic', filter: 'hue-rotate(40deg) saturate(1.4)' },
};
let style = localStorage.getItem('speechform-heavy:style') || 'neon';
function drawStyles() {
  $('#styles').innerHTML = Object.entries(STYLES).map(([k, v]) => `<button class="chip ${k === style ? 'on' : ''}" data-style="${k}">${v.name}</button>`).join('');
  $('#styles').querySelectorAll('.chip').forEach(b => b.onclick = () => { style = b.dataset.style; try { localStorage.setItem('speechform-heavy:style', style); } catch (e) {} drawStyles(); });
}
$('#styleBtn').onclick = () => { $('#styles').classList.toggle('open'); $('#styleBtn').classList.toggle('on'); };
drawStyles();

/* ── the session ── */
let S;
function fresh() {
  S = { id: new Date().toISOString().replace(/[:.]/g, '-'), phrases: [], ideas: [], growth: {}, order: [], lead: 'kelp', kind: null, streakOf: 0, candidate: null,
        gateAt: -1e9, lastSpoke: 0, streak: 0, streakLen: 0, base: null, baseId: null, manualBase: false, layers: [], frames: [],
        radius: .85, conclusionAt: 0, firstKeys: null, jev: 'The procedural images carry the scene until Jev has a token.', prompt: '',
        dir: { warmth: .4, speed: 1, memory: .4, seed: 0, density: 1 } };
}
fresh();

function matchIdea(text) {
  const prev = S.phrases[S.phrases.length - 1];
  const k = keys(text.split(/\s+/).length < 8 && prev ? prev.text + ' ' + text : text);
  let best = null, score = 0;
  for (const idea of S.ideas) {
    const shared = k.filter(w => idea.keys.has(w)).length / Math.max(1, Math.min(k.length, idea.keys.size));
    if (shared > score) { score = shared; best = idea; }
  }
  if (best && score >= .3) { if (prev && prev.idea !== best.id) best.returns++; k.forEach(w => best.keys.add(w)); best.words += text.split(/\s+/).length; return best; }
  if (!k.length && prev) { const p = S.ideas.find(i => i.id === prev.idea); if (p) return p; }
  const idea = { id: 'i' + S.ideas.length, title: k.slice(0, 3).join(' ') || 'a thought', keys: new Set(k), words: text.split(/\s+/).length, returns: 0 };
  S.ideas.push(idea); return idea;
}
const WARM = new Set('sun fire flame gold golden home hearth grandmother mother love warm summer bread honey light lantern amber red heart dawn morning'.split(' '));
const COOL = new Set('moon sea ocean silver mist night rain river snow winter blue cold star stars water ice shadow dusk grey gray fog'.split(' '));
function direct() {
  const w = S.phrases.slice(-6).map(p => p.text).join(' ').toLowerCase().match(/[a-z']+/g) || [];
  const warm = w.filter(x => WARM.has(x)).length, cool = w.filter(x => COOL.has(x)).length;
  if (warm || cool) S.dir.warmth += (.5 + .5 * (warm - cool) / (warm + cool) - S.dir.warmth) * .5;
  const said = S.phrases.filter(p => now() - p.at < 30).reduce((a, p) => a + p.text.split(/\s+/).length, 0);
  S.dir.speed += (.6 + Math.min(1, said / 90) - S.dir.speed) * .5;
}

/* ── a phrase arrives ── */
const BREAK = 8;                      // seconds of quiet that end a streak
async function ingest(raw, source) {
  const text = mask(raw.trim()); if (!text) return;
  const t = now();
  const broke = S.phrases.length && t - S.lastSpoke > BREAK;
  if (broke || !S.phrases.length) { S.streak++; S.streakLen = 0; }
  S.lastSpoke = t; S.streakLen++;
  const own = C.scorePhrase(text), heard = C.hear(S.phrases, text, t);
  const top = heard.ranked[0][0]; S.streakOf = top === S.candidate ? S.streakOf + 1 : 1; S.candidate = top;
  const choice = C.decide(S.kind, heard.ranked, S.streakOf);
  const idea = matchIdea(text), kind = choice.kind, image = C.IMAGE[kind], words = text.split(/\s+/).length;
  if (image !== S.lead || S.phrases.length === 0) S.gateAt = performance.now();
  S.kind = kind; S.lead = image;
  S.growth[image] = (S.growth[image] || 0) + words;
  if (!S.order.includes(image)) S.order.push(image);
  if (/\b(the point of (all of )?this is|in conclusion|what it comes down to)\b/i.test(text)) S.conclusionAt = t;
  const p = { id: 'p' + Date.now().toString(36), text, at: t, source, kind, image, idea: idea.id, ranked: heard.ranked,
              because: own.because, structure: own.structure, window: heard.recent.map(r => r.text), reason: choice.reason, streak: S.streak };
  S.phrases.push(p); direct(); remember(p);
  drawLines(); if (page === 1) drawWhy();
  /* the streak broke: build on the saved image that fits what is being said now */
  if (broke && !S.manualBase) await pickBase(text);
  imagine(text);
  snapshotSoon(1800);
}

/* Jev (or the bank) makes an image for this moment; it moves in over the scene as a new layer */
let asking = false;
async function imagine(text) {
  if (asking) return; asking = true;
  const windowText = S.phrases.slice(-6).map(p => p.text).join(' ');
  const r = await post('/imagine', { scene: { text: windowText, register: S.lead, kind: S.kind, style, camera: cam.cues } });
  asking = false;
  if (!r) { S.jev = 'The Speechform server is not answering.'; return; }
  S.prompt = r.prompt || (r.item && r.item.prompt) || '';
  if (r.item && !S.layers.some(l => l.id === r.item.id)) {
    S.jev = r.from === 'bank' ? `From the bank, reused (${Math.round((r.likeness || 1) * 100)}% alike); no token spent.` : 'Made by Jev and kept in the bank.';
    addLayer('/bank/' + r.item.file, r.item.id);
  } else if (!r.item) S.jev = r.error ? 'Jev: ' + r.error : (r.why ? r.why.charAt(0).toUpperCase() + r.why.slice(1) + '.' : '');
  if (page === 1) drawWhy();
}
function addLayer(src, id) {
  const img = new Image(); img.onload = () => {
    const side = cam.cues.side === 'left' ? -1 : cam.cues.side === 'right' ? 1 : (Math.random() < .5 ? -1 : 1);
    S.layers.push({ id, img, x: side * 1.1, y: .15, a: 0, born: performance.now() });
    if (S.layers.length > 3) S.layers.shift();
    snapshotSoon(2600);
  }; img.src = src;
}
async function pickBase(text) {
  const cands = S.frames.slice(-12).map(f => ({ id: f.id, kind: f.kind, keywords: f.keywords || [], at: f.at }));
  if (!cands.length) return;
  const r = await post('/choose', { text, candidates: cands });
  if (r && r.id) setBase(r.id, false, r.by !== 'rule' ? 'Jev picked this image to build on: ' + (r.why || '') : 'Building on the saved image that ' + r.why + '.');
}
function setBase(id, manual, why) {
  if (!id) { S.base = null; S.baseId = null; S.manualBase = false; drawFilm(); return; }
  const img = new Image(); img.onload = () => { S.base = img; S.baseId = id; S.manualBase = manual; S.baseWhy = why || ''; drawFilm(); };
  img.src = '/seq/' + id;
}

/* ── the sequence: the scene is saved at every change, and every ten seconds while the streak lasts ── */
let snapTimer = null, lastSnap = 0;
function snapshotSoon(ms) { clearTimeout(snapTimer); snapTimer = setTimeout(snapshot, ms); }
async function snapshot() {
  if (!S.phrases.length) return;
  lastSnap = performance.now();
  const last = S.phrases[S.phrases.length - 1];
  const r = await post('/frame', { session: S.id, streak: S.streak, jpeg: scene.toDataURL('image/jpeg', .82),
    meta: { kind: S.kind, register: S.lead, style, text: last.text, keywords: keys(S.phrases.slice(-4).map(p => p.text).join(' ')) } });
  if (r && r.id) { S.frames.push(r); drawFilm(); }
}

/* ── hearing: only ever on this device (as in Speechform Light) ── */
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, interim = '', mac = null;
async function onDevice(lang) {
  if (!Rec || !Rec.available) return false;
  try { let a = await Rec.available({ langs: [lang], processLocally: true });
    if (a === 'downloadable' || a === 'downloading') { await Rec.install({ langs: [lang], processLocally: true }); a = await Rec.available({ langs: [lang], processLocally: true }); }
    return a === 'available'; } catch (e) { return false; }
}
async function start() {
  if (listening) return;
  listening = true; paint();
  if (!cam.on) await cam.start().catch(() => {});
  const lang = navigator.language || 'en-US';
  if (await onDevice(lang)) {
    rec = new Rec(); rec.continuous = true; rec.interimResults = true; rec.lang = lang; rec.processLocally = true;
    rec.onresult = ev => { interim = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) ingest(r[0].transcript, 'Microphone'); else interim += r[0].transcript; } drawLines(); };
    rec.onend = () => { if (listening && rec) try { rec.start(); } catch (e) {} };
    try { rec.start(); } catch (e) {}
  } else startMac();
  paint();
}
function startMac() {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const ac = new AudioContext(), node = ac.createScriptProcessor(4096, 1, 1);
    ac.createMediaStreamSource(stream).connect(node); node.connect(ac.destination);
    let chunks = [], voiced = 0, quiet = 0;
    node.onaudioprocess = e => {
      if (!listening) return;
      const d = new Float32Array(e.inputBuffer.getChannelData(0)); let s = 0; for (const v of d) s += v * v;
      const rms = Math.sqrt(s / d.length), secs = d.length / ac.sampleRate; chunks.push(d);
      if (rms > .012) { voiced += secs; quiet = 0; } else quiet += secs;
      const len = chunks.length * secs;
      if ((voiced > .4 && quiet > 1) || len > 12) { if (voiced > .4) sendWav(chunks, ac.sampleRate); chunks = []; voiced = 0; quiet = 0; }
      else if (!voiced && len > 3) chunks = [];
    };
    mac = { stream, ac };
  }).catch(() => stop());
}
function sendWav(chunks, from) {
  const all = new Float32Array(chunks.reduce((a, c) => a + c.length, 0)); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const to = 16000, n = Math.floor(all.length * to / from), pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.max(-1, Math.min(1, all[Math.floor(i * from / to)])) * 32767;
  const buf = new ArrayBuffer(44 + pcm.byteLength), v = new DataView(buf), w = (p, t) => [...t].forEach((ch, i) => v.setUint8(p + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, to, true); v.setUint32(28, to * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.byteLength, true);
  new Int16Array(buf, 44).set(pcm);
  interim = '…'; drawLines();
  fetch('/transcribe', { method: 'POST', body: new Blob([buf], { type: 'audio/wav' }) }).then(r => r.json()).then(j => { interim = ''; if (j.ok && j.text) ingest(j.text, 'Microphone'); drawLines(); }).catch(() => { interim = ''; });
}
function stop() {
  listening = false; interim = '';
  if (rec) { const r = rec; rec = null; try { r.stop(); } catch (e) {} }
  if (mac) { mac.stream.getTracks().forEach(t => t.stop()); mac.ac.close(); mac = null; }
  paint(); drawLines();
}
function paint() {
  $('#start').className = 'tool ' + (listening ? 'live' : '');
  $('#stop').className = 'tool ' + (listening ? '' : 'idle');
  $('#cam').className = 'tool ' + (cam.on ? 'on' : '');
  $('#micBtn').classList.toggle('live', listening);
}
const cam = new Camera();
$('#start').onclick = start; $('#stop').onclick = stop;
$('#cam').onclick = async () => { if (cam.on) cam.stop(); else await cam.start().catch(() => {}); paint(); };
$('#fresh').onclick = () => { fresh(); drawLines(); drawFilm(); drawWhy(); };
$('#say').onsubmit = e => { e.preventDefault(); const t = $('#words').value.trim();
  if (t) { ingest(t, 'Typed'); $('#words').value = ''; } else if (listening) stop(); else start(); };

/* ── the scene ── */
const scene = $('#scene'), SIZE = 540;
scene.width = scene.height = SIZE;
const sx = scene.getContext('2d');
const grown = document.createElement('canvas'); const R = G.Renderer(grown, SIZE, { transparent: true });
const sparks = []; let videoAlpha = 1, last = 0, lastT = 0;
function cover(img, w, h, mirror) {
  const s = Math.max(SIZE / w, SIZE / h), dw = w * s, dh = h * s;
  sx.save(); if (mirror) { sx.translate(SIZE, 0); sx.scale(-1, 1); }
  sx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh); sx.restore();
}
const fader = document.createElement('canvas'); fader.width = fader.height = SIZE;
function frame(t) {
  requestAnimationFrame(frame);
  if (document.hidden || t - lastT < 1000 / 30) return;     // thirty frames a second, none while hidden
  render(t, Math.min(.1, (t - (lastT || t)) / 1000)); lastT = t;
}
function render(t, dt) {
  cam.update(t);
  const speaking = S.phrases.length > 0;
  /* the scene is black, then the camera, which dims as the layers move in */
  sx.globalCompositeOperation = 'source-over'; sx.globalAlpha = 1; sx.filter = 'none'; sx.fillStyle = '#000'; sx.fillRect(0, 0, SIZE, SIZE);
  videoAlpha += ((speaking ? (S.base ? .16 : .36) : 1) - videoAlpha) * Math.min(1, dt * .8);
  if (S.base) { sx.globalAlpha = .88; cover(S.base, S.base.width, S.base.height, false); }
  if (cam.on && cam.video.readyState >= 2) { sx.globalAlpha = videoAlpha; cover(cam.video, cam.video.videoWidth, cam.video.videoHeight, true); }
  /* Jev's images: each moves in from the side, the newest brightest, soft at the edges */
  sx.globalCompositeOperation = 'screen';
  S.layers.forEach((L, i) => {
    const target = i === S.layers.length - 1 ? .85 : .35;
    L.x += (0 - L.x) * Math.min(1, dt * 1.4); L.a += (target - L.a) * Math.min(1, dt * 1.2);
    const f = fader.getContext('2d'); f.globalCompositeOperation = 'source-over'; f.clearRect(0, 0, SIZE, SIZE);
    f.drawImage(L.img, 0, 0, SIZE, SIZE); f.globalCompositeOperation = 'destination-in';
    const g = f.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * .18, SIZE / 2, SIZE / 2, SIZE * .56);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); f.fillStyle = g; f.fillRect(0, 0, SIZE, SIZE);
    sx.globalAlpha = L.a; sx.filter = STYLES[style].filter; sx.drawImage(fader, L.x * SIZE * .5, L.y * SIZE * .1);
  });
  /* waving grows the image in front */
  if (listening && cam.cues.motion > .3) S.growth[S.lead] = (S.growth[S.lead] || 0) + cam.cues.motion * dt * 5;
  /* the growing images */
  if (speaking) {
    const lastP = S.phrases[S.phrases.length - 1];
    R.draw({ order: S.order, lead: S.lead, growth: S.growth, gateAt: S.gateAt, now: t, dt,
      c: { t: t / 1000, e: Math.min(1, cam.cues.motion), warm: S.dir.warmth, seed: S.dir.seed, density: 1, speed: S.dir.speed, memory: S.dir.memory,
           radius: S.radius, point: now() - S.conclusionAt < 7, ideas: S.ideas, activeIdea: lastP && lastP.idea, speakers: { A: 1, B: 1 } } });
    sx.globalCompositeOperation = 'lighter'; sx.globalAlpha = 1; sx.filter = STYLES[style].filter; sx.drawImage(grown, 0, 0);
  }
  /* EyeToy: where you move, sparks of the image's own colour */
  sx.filter = 'none';
  if (cam.on) for (const [x, y, m] of cam.hotspots(24)) if (Math.random() < m * .5) sparks.push({ x: x * SIZE, y: y * SIZE, vx: (Math.random() - .5) * 60, vy: -30 - Math.random() * 60, life: 1 });
  const hue = getComputedStyle(document.documentElement).getPropertyValue('--r-' + S.lead).trim() || '#39ff14';
  sx.globalCompositeOperation = 'lighter';
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i]; p.life -= dt * 1.4; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.life <= 0) { sparks.splice(i, 1); continue; }
    sx.globalAlpha = p.life * .8; sx.fillStyle = hue; sx.beginPath(); sx.arc(p.x, p.y, 1.5 + 2.5 * p.life, 0, 7); sx.fill();
  }
  if (sparks.length > 400) sparks.splice(0, sparks.length - 400);
  /* the storyteller looms over the scene when the talk is a story */
  if (cam.maskReady && cam.cues.person && NARRATIVE.has(S.kind)) {
    sx.globalCompositeOperation = 'screen'; sx.globalAlpha = .34; sx.filter = STYLES[style].filter + ' blur(1px)';
    const w = SIZE * 1.35, h = w * cam.cut.height / cam.cut.width;
    sx.drawImage(cam.cut, (SIZE - w) / 2, -h * .12, w, h);
  }
  sx.globalAlpha = 1; sx.filter = 'none'; sx.globalCompositeOperation = 'source-over';
  /* the streak */
  const quietFor = now() - S.lastSpoke, broken = S.phrases.length && quietFor > BREAK;
  $('#streak').className = 'streak' + (broken ? ' broken' : '');
  $('#streak').innerHTML = '<i></i>'.repeat(Math.min(14, S.streakLen));
  if (listening && !broken && S.phrases.length && t - lastSnap > 10000) snapshot();
}
requestAnimationFrame(frame);

/* ── the lower screens ── */
let page = 0;
function go(i) {
  page = Math.max(0, Math.min(3, i));
  $('#track').style.transform = `translateX(${-25 * page}%)`;
  document.querySelectorAll('.tool[data-page]').forEach(b => b.classList.toggle('on', +b.dataset.page === page));
  if (page === 1) drawWhy(); if (page === 2) drawFilm(true); if (page === 3) drawMemory();
}
document.querySelectorAll('.tool[data-page]').forEach(b => b.onclick = () => go(+b.dataset.page));
let px0 = null;
$('#lower').addEventListener('pointerdown', e => px0 = e.clientX);
$('#lower').addEventListener('pointerup', e => { if (px0 !== null && Math.abs(e.clientX - px0) > 60) go(page + (e.clientX < px0 ? 1 : -1)); px0 = null; });

function drawLines() {
  const box = $('#lines'), seen = new Set();
  box.innerHTML = S.phrases.map(p => { const idea = S.ideas.find(i => i.id === p.idea) || {}, back = seen.has(p.idea); seen.add(p.idea);
    return `<div class="line"><div class="said">${esc(p.text)}</div><div class="meta"><span class="tag" style="color:${col(p.image)}">${esc(p.kind)} → ${p.image}</span><span class="tag ${back ? 'back' : 'idea'}">${back ? '↺ ' : ''}${esc(idea.title)}</span></div></div>`; }).join('')
    + (interim ? `<div class="line interim">${esc(mask(interim))}</div>` : '');
  box.scrollTop = box.scrollHeight;
}
const rows = {};
function drawWhy() {
  const p = S.phrases[S.phrases.length - 1];
  const c = cam.cues;
  $('#camNote').textContent = !cam.on ? 'The camera is off.' : `${c.person ? 'Someone is in view' : 'No one is in view'}${c.head ? ', their head near the ' + (c.head.x < .4 ? 'left' : c.head.x > .6 ? 'right' : 'centre') : ''}. Movement ${(c.motion * 100).toFixed(0)}%, mostly ${c.side}. ${NARRATIVE.has(S.kind) && c.person ? 'The talk is a story, so the speaker looms over the scene.' : ''}`;
  $('#jevNote').textContent = S.jev + (S.base ? ' ' + (S.baseWhy || 'Building on a saved image.') : '');
  $('#prompt').textContent = S.prompt ? 'Asked for: ' + S.prompt : '';
  if (!p) { $('#heat').textContent = ''; $('#choice').textContent = ''; $('#rank').innerHTML = ''; return; }
  const shapes = new Set(Object.keys(p.structure || {}));
  const hits = [...new Set((p.because[p.kind] || []).filter(w => !shapes.has(w)))].sort((a, b) => b.length - a.length);
  const lit = text => { let t = String(text); for (const h of hits) t = t.replace(new RegExp('\\b(' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\b', 'gi'), '\u0001$1\u0002');
    return esc(t).replace(/\u0001/g, `<span class="hit" style="background:color-mix(in srgb, ${col(p.image)} 45%, transparent)">`).replace(/\u0002/g, '</span>'); };
  $('#heat').innerHTML = (p.window || []).map(lit).join(' ') + ' <span class="now">' + lit(p.text) + '</span>';
  const box = $('#rank'), RH = 17, top = Math.max(p.ranked[0][1], .01); box.style.height = p.ranked.length * RH + 'px';
  p.ranked.forEach(([k, v], i) => { let row = rows[k];
    if (!row) { row = document.createElement('div'); row.className = 'b'; row.innerHTML = '<span class="nm"></span><span class="track2"><span class="fill"></span></span><span class="v"></span>'; box.appendChild(row); rows[k] = row; }
    row.style.transform = `translateY(${i * RH}px)`; row.classList.toggle('top', i === 0);
    const why = [...new Set(p.because[k] || [])].slice(0, 3).join(', ');
    row.querySelector('.nm').textContent = k + (why ? ' · ' + why : '');
    const f = row.querySelector('.fill'); f.style.width = Math.round(100 * Math.max(0, v) / top) + '%'; f.style.background = i < 4 ? col(C.IMAGE[k]) : '';
    row.querySelector('.v').textContent = v.toFixed(2); });
  $('#choice').innerHTML = `The kind is <b>${esc(p.kind)}</b>, because ${esc(p.reason)}. It grows <b style="color:${col(p.image)}">${p.image}</b>, in the ${STYLES[style].name} style. Streak ${p.streak}.`;
}
/* the sequence: every saved moment, streak by streak; tap one to build on it, tap it again to return to the camera */
async function drawFilm(fetchAll) {
  let all = S.frames;
  if (fetchAll) { const r = await fetch('/sequences').then(x => x.json()).catch(() => null); if (r) all = r.sequences.flatMap(s => s.frames.map(f => ({ ...f, id: s.session + '/' + f.file }))).sort((a, b) => b.at - a.at); }
  else all = [...S.frames].reverse();
  let h = '', streak = null;
  all.slice(0, 120).forEach(f => { if (streak !== null && f.streak !== streak) h += '<div class="brk"></div>'; streak = f.streak;
    h += `<img src="/seq/${esc(f.id)}" data-id="${esc(f.id)}" class="${f.id === S.baseId ? 'base' : ''}" title="${esc(f.kind || '')}" loading="lazy">`; });
  $('#film').innerHTML = h;
  $('#film').querySelectorAll('img').forEach(im => im.onclick = () => { if (im.dataset.id === S.baseId) setBase(null); else setBase(im.dataset.id, true, 'Building on the image you picked.'); });
}
const MEM_KEY = 'speechform-heavy:memory';
function remember(p) { try { const m = JSON.parse(localStorage.getItem(MEM_KEY) || '[]'); m.push({ text: p.text, at: p.at, kind: p.kind, image: p.image }); localStorage.setItem(MEM_KEY, JSON.stringify(m.slice(-3000))); } catch (e) {} }
function drawMemory() {
  let m = []; try { m = JSON.parse(localStorage.getItem(MEM_KEY) || '[]').reverse(); } catch (e) {}
  let day = '', h = '';
  m.forEach(x => { const d = new Date(x.at * 1000).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    if (d !== day) { day = d; h += `<div class="day">${esc(d)}</div>`; }
    h += `<div class="line"><div class="said">${esc(x.text)}</div><div class="meta"><span class="tag" style="color:${col(x.image)}">${esc(x.kind)} → ${x.image}</span></div></div>`; });
  $('#mem').innerHTML = h;
}

/* ── Jev's token, on this Mac only: paste it, and Speechform recognises whose it is ── */
const WHO = t => t.startsWith('sk-ant-') ? ['claude', 'Anthropic Claude', false] : t.startsWith('sk-') ? ['openai', 'OpenAI', true] : t.startsWith('AIza') ? ['gemini', 'Google Gemini', true] : null;
function explain() {
  const t = $('#token').value.trim(), custom = $('#endpoint').value.trim();
  const d = $('#detected');
  if (custom) { d.textContent = 'This token will be sent to the custom Jev service at the address below.'; d.style.color = 'var(--ink)'; return; }
  if (!t) { d.textContent = $('#token').placeholder === 'saved' ? '' : 'Keys from OpenAI (they begin sk-), Anthropic (sk-ant-) and Google Gemini (AIza) are recognised, and need nothing else. Any other token needs its service address under custom Jev service.'; d.style.color = 'var(--muted)'; return; }
  const w = WHO(t);
  if (w) { d.textContent = `Recognised: ${w[1]}. Nothing else to fill in. ` + (w[2] ? 'It will make images and pick which image to build on.' : 'It will pick which image to build on; it cannot make images, so the growing images carry the scene.'); d.style.color = 'var(--green)'; }
  else { d.textContent = 'This token is not from OpenAI, Anthropic or Google. Open custom Jev service and enter the address that came with it.'; d.style.color = 'var(--amber)'; $('#custom').open = true; }
}
$('#token').addEventListener('input', explain); $('#endpoint').addEventListener('input', explain);
$('#keyBtn').onclick = async () => {
  const st = await fetch('/status').then(r => r.json()).catch(() => ({}));
  const p = st.provider || {};
  $('#endpoint').value = p.provider === 'jev' ? p.endpoint || '' : ''; $('#imageEndpoint').value = p.image_endpoint || '';
  $('#custom').open = p.provider === 'jev';
  $('#token').value = ''; $('#token').placeholder = p.has_key ? 'saved' : 'paste your key here';
  explain();
  $('#jevState').textContent = p.service && p.service.says ? 'Now: ' + p.service.says : ''; $('#jevState').style.color = 'var(--muted)';
  $('#sheet').hidden = false;
};
$('#close').onclick = () => $('#sheet').hidden = true;
const saveJev = () => {
  const custom = $('#endpoint').value.trim();
  return post('/settings', { provider: custom ? 'jev' : 'auto', endpoint: custom, image_endpoint: $('#imageEndpoint').value.trim(), key: $('#token').value.trim() || undefined });
};
$('#jevForm').onsubmit = async e => { e.preventDefault(); await saveJev(); $('#sheet').hidden = true; };
$('#test').onclick = async () => {
  $('#jevState').textContent = 'Testing…'; $('#jevState').style.color = 'var(--muted)';
  await saveJev(); const r = await post('/jev/test', {});
  $('#jevState').textContent = r ? (r.ok ? '✓ ' : '✕ ') + r.says : '✕ The Speechform server is not answering.';
  $('#jevState').style.color = r && r.ok ? 'var(--green)' : 'var(--red)';
};

paint(); drawLines();

/* a handle for tests and for agents driving the page */
window.speechformHeavy = { get state() { return S; }, ingest, snapshot, render };
