// node light/eval.js: the light classifier on the same test passages as the model-based one
const C = require('./classify.js'); const P = require('./passages.json');
let whole = 0, fr = 0, wi = 0, tot = 0;
for (const [g, t] of P) {
  const top = C.KINDS.map(k => [k, C.scorePhrase(t).scores[k]]).sort((a, b) => b[1] - a[1])[0][0];
  whole += top === g; if (top !== g) console.log('  whole ✗', g, '→', top);
  const w = t.split(' '), frags = []; for (let i = 0; i < w.length; i += 6) frags.push(w.slice(i, i + 6).join(' '));
  const hist = []; let at = 1000;
  frags.forEach((f, i) => {
    const h = C.hear(hist, f, at); const s = C.scorePhrase(f); hist.push({ text: f, at, scores: s.scores }); at += 2;
    if (i >= 2) { tot++; wi += h.ranked[0][0] === g; fr += C.KINDS.map(k => [k, s.scores[k]]).sort((a, b) => b[1] - a[1])[0][0] === g; }
  });
}
console.log(`light classifier: whole passages ${whole}/${P.length}   fragments alone ${fr}/${tot} (${Math.round(100 * fr / tot)}%)   rolling window ${wi}/${tot} (${Math.round(100 * wi / tot)}%)`);
