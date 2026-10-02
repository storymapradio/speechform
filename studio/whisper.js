/* Speechform: hearing with Whisper in the page, for browsers that cannot hear on the device themselves (iPhone,
 * Android, Safari, Firefox). The voice is cut into phrases at pauses of about a second (eight seconds at most),
 * brought to 16 kHz and transcribed in a worker by whisper-tiny.en. Nothing is sent anywhere: the model is
 * downloaded once (about 40 MB) and kept by the browser.
 *
 *   SpeechformWhisper.cached        whether the listener has been downloaded on this device before
 *   SpeechformWhisper.load(onProgress)  → resolves when it is ready; onProgress(0..1, loadedBytes, totalBytes)
 *   SpeechformWhisper.listener(rate, { onPhrase, onInterim }) → { push(Float32Array), flush() }
 *   SpeechformWhisper.transcribe(Float32Array at 16 kHz) → text
 *   SpeechformWhisper.feedWav(url, onPhrase) → the same pipeline fed from a file (for tests)
 */
(function (root) {
  'use strict';
  const here = (document.currentScript && document.currentScript.src) || location.href;
  const KEY = 'speechform-web:whisper';
  let worker = null, ready = null, device = null, seq = 0;
  const waiting = new Map();
  const cached = () => { try { return localStorage.getItem(KEY) === 'ready'; } catch (e) { return false; } };

  function load(onProgress) {
    if (ready) return ready;
    worker = new Worker(new URL('whisper-worker.js', here), { type: 'module' });
    const files = {};
    ready = new Promise((ok, no) => {
      worker.onmessage = ({ data }) => {
        if (data.t === 'progress' && data.p && data.p.file && data.p.total) {
          files[data.p.file] = [data.p.loaded || 0, data.p.total];
          const L = Object.values(files).reduce((a, f) => a + f[0], 0), T = Object.values(files).reduce((a, f) => a + f[1], 0);
          onProgress && onProgress(T ? L / T : 0, L, T);
        }
        if (data.t === 'ready') { device = data.device; try { localStorage.setItem(KEY, 'ready'); } catch (e) {} onProgress && onProgress(1); ok(device); }
        if (data.t === 'text' || (data.t === 'error' && data.id)) { const w = waiting.get(data.id); if (w) { waiting.delete(data.id); data.t === 'text' ? w[0](data.text) : w[1](new Error(data.error)); } }
        if (data.t === 'error' && !data.id) { ready = null; no(new Error(data.error)); }
      };
      worker.onerror = e => { ready = null; no(new Error(e.message || 'the listener could not start')); };
      worker.postMessage({ t: 'load' });
    });
    return ready;
  }
  /* what Whisper says over silence or noise is not speech */
  const clean = t => String(t || '').replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ').replace(/\s+/g, ' ').trim();
  const NOISE = /^(thank you\.?|thanks\.?|you|bye\.?|\.+)$/i;
  async function transcribe(audio) {
    await load();
    const id = ++seq;
    const text = await new Promise((ok, no) => { waiting.set(id, [ok, no]); worker.postMessage({ t: 'run', id, audio }, [audio.buffer]); });
    const t = clean(text); return NOISE.test(t) ? '' : t;
  }
  function resample(chunks, from) {
    const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    if (from === 16000) return all;
    const m = Math.floor(n * 16000 / from), out = new Float32Array(m), r = from / 16000;
    for (let i = 0; i < m; i++) { const x = i * r, j = Math.floor(x), k = x - j; out[i] = (all[j] || 0) * (1 - k) + (all[j + 1] || 0) * k; }
    return out;
  }
  /* phrases cut at about a second of quiet after some speech, or at eight seconds; transcribed one after another */
  function listener(rate, { onPhrase, onInterim } = {}) {
    let chunks = [], voiced = 0, quiet = 0, queue = Promise.resolve();
    const send = () => {
      if (voiced > .35) {
        const audio = resample(chunks, rate);
        onInterim && onInterim('…');
        queue = queue.then(() => transcribe(audio)).then(t => { onInterim && onInterim(''); if (t) onPhrase && onPhrase(t); }).catch(() => onInterim && onInterim(''));
      }
      chunks = []; voiced = 0; quiet = 0;
    };
    return {
      push(d) {
        let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
        const rms = Math.sqrt(sum / d.length), secs = d.length / rate;
        chunks.push(new Float32Array(d));
        if (rms > .012) { voiced += secs; quiet = 0; } else quiet += secs;
        const length = chunks.reduce((a, c) => a + c.length, 0) / rate;
        if ((voiced > .35 && quiet > 1.0) || length > 8) send();
        else if (!voiced && length > 3) chunks = [];
      },
      flush() { send(); return queue; },
    };
  }
  /* a file through the same pipeline, in 4096-sample pieces as the microphone gives them */
  async function feedWav(url, onPhrase) {
    const buf = await (await fetch(url)).arrayBuffer();
    const ac = new OfflineAudioContext(1, 16000, 16000), audio = await ac.decodeAudioData(buf), d = audio.getChannelData(0), out = [];
    const L = listener(audio.sampleRate, { onPhrase: t => { out.push(t); onPhrase && onPhrase(t); } });
    for (let i = 0; i < d.length; i += 4096) L.push(d.subarray(i, i + 4096));
    for (let i = 0; i < 12; i++) L.push(new Float32Array(4096));        // the quiet after the last words
    await L.flush();
    return out;
  }
  root.SpeechformWhisper = { load, transcribe, listener, feedWav, get cached() { return cached(); }, get device() { return device; }, get loaded() { return !!device; }, get usable() { return !!device || !!ready || cached(); } };
})(this);
