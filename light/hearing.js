/* Speechform: hearing, only ever on this device.
 *
 *   1. the browser's own recognition, asked to run on the device (Chrome downloads its model once, then keeps it local)
 *   2. otherwise this Mac's Apple transcription, through the Speechform server beside the page
 * Speech is never sent to a cloud service: if neither is available, hearing does not start.
 * While it listens it also keeps its own copy of the voice, so the recording can be saved with its card.
 *
 *   const H = SpeechformHearing({ onPhrase(text), onInterim(text), onChange(state) })
 *   await H.start(); H.stop(); H.level(); H.wav()  → a 16 kHz WAV Blob of everything heard since start
 */
(function (root) {
  'use strict';
  const Rec = root.SpeechRecognition || root.webkitSpeechRecognition;

  function toWav(chunks, from, to) {
    const all = new Float32Array(chunks.reduce((a, c) => a + c.length, 0)); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const n = Math.floor(all.length * to / from), pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) { const v = all[Math.min(all.length - 1, Math.floor(i * from / to))]; pcm[i] = Math.max(-1, Math.min(1, v)) * 32767; }
    const buf = new ArrayBuffer(44 + pcm.byteLength), v = new DataView(buf), w = (p, t) => [...t].forEach((ch, i) => v.setUint8(p + i, ch.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, to, true); v.setUint32(28, to * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.byteLength, true);
    new Int16Array(buf, 44).set(pcm); return new Blob([buf], { type: 'audio/wav' });
  }

  function SpeechformHearing({ onPhrase, onInterim, onChange } = {}) {
    let listening = false, rec = null, mac = null, audio = null, take = null, level = 0, how = null;
    const say = () => onChange && onChange({ listening, how });

    async function onDevice(lang) {
      if (!Rec || !Rec.available) return false;
      try {
        let a = await Rec.available({ langs: [lang], processLocally: true });
        if (a === 'downloadable' || a === 'downloading') { await Rec.install({ langs: [lang], processLocally: true }); a = await Rec.available({ langs: [lang], processLocally: true }); }
        return a === 'available';
      } catch (e) { return false; }
    }
    async function macThere() { try { return (await fetch('/status', { cache: 'no-store' })).ok; } catch (e) { return false; } }

    function browser(lang) {
      rec = new Rec(); rec.continuous = true; rec.interimResults = true; rec.lang = lang; rec.processLocally = true;
      rec.onresult = ev => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) onPhrase && onPhrase(r[0].transcript.trim()); else interim += r[0].transcript;
        }
        onInterim && onInterim(interim);
      };
      rec.onend = () => { if (listening && rec) try { rec.start(); } catch (e) {} };
      rec.onerror = e => { if (/not-allowed|service-not-allowed|language-not-supported/.test(e.error)) stop(); };
      try { rec.start(); } catch (e) {}
    }
    /* the Mac path: phrases are cut at pauses and the Mac transcribes each one */
    function viaMac(stream, ac) {
      const src = ac.createMediaStreamSource(stream), node = ac.createScriptProcessor(4096, 1, 1); src.connect(node); node.connect(ac.destination);
      let chunks = [], voiced = 0, quiet = 0;
      node.onaudioprocess = e => {
        if (!listening) return;
        const d = new Float32Array(e.inputBuffer.getChannelData(0)); let sum = 0; for (const v of d) sum += v * v;
        const rms = Math.sqrt(sum / d.length), secs = d.length / ac.sampleRate;
        chunks.push(d);
        if (rms > .012) { voiced += secs; quiet = 0; } else quiet += secs;
        const length = chunks.length * secs;
        if ((voiced > .4 && quiet > 1.0) || length > 12) { if (voiced > .4) send(chunks, ac.sampleRate); chunks = []; voiced = 0; quiet = 0; }
        else if (!voiced && length > 3) chunks = [];
      };
      mac = node;
    }
    function send(chunks, rate) {
      onInterim && onInterim('…');
      fetch('/transcribe', { method: 'POST', body: toWav(chunks, rate, 16000) }).then(r => r.json())
        .then(j => { onInterim && onInterim(''); if (j.ok && j.text) onPhrase && onPhrase(j.text.trim()); }).catch(() => onInterim && onInterim(''));
    }

    async function start() {
      if (listening) return true;
      const lang = navigator.language || 'en-US';
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return false; }
      const ac = new (root.AudioContext || root.webkitAudioContext)();
      const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an); const buf = new Float32Array(an.fftSize);
      /* the recording itself, kept while listening */
      const keep = ac.createScriptProcessor(4096, 1, 1); ac.createMediaStreamSource(stream).connect(keep); keep.connect(ac.destination);
      take = { rate: ac.sampleRate, chunks: [] };
      keep.onaudioprocess = e => { if (listening && take) take.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
      audio = { stream, ac, read() { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); } };
      listening = true;
      if (await onDevice(lang)) { how = 'this device (the browser, on-device)'; browser(lang); }
      else if (await macThere()) { how = "this Mac (Apple's on-device transcription)"; viaMac(stream, ac); }
      else { stop(); return false; }
      say(); return true;
    }
    function stop() {
      listening = false; onInterim && onInterim('');
      if (rec) { const r = rec; rec = null; try { r.stop(); } catch (e) {} }
      mac = null;
      if (audio) { audio.stream.getTracks().forEach(t => t.stop()); audio.ac.close(); audio = null; }
      say();
    }
    return {
      start, stop,
      get listening() { return listening; }, get how() { return how; },
      level() { if (audio) level = level * .8 + audio.read() * .2; else level *= .95; return level; },
      wav() { return take && take.chunks.length ? toWav(take.chunks, take.rate, 16000) : null; },
    };
  }
  root.SpeechformHearing = SpeechformHearing;
  root.SpeechformHearing.toWav = toWav;
})(this);
