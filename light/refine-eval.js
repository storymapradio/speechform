// node light/refine-eval.js rules.json passages.json: how the light classifier does with a set of rules,
// on the passages Jev has labelled and on the fixed test passages. Prints JSON.
const fs = require('fs'), C = require('./classify.js');
const rules = JSON.parse(fs.readFileSync(process.argv[2], 'utf8') || '{}'), labelled = JSON.parse(fs.readFileSync(process.argv[3], 'utf8') || '[]');
const n = C.rules(rules);
const top = t => { const s = C.scorePhrase(t).scores; return C.KINDS.reduce((a, b) => s[a] >= s[b] ? a : b); };
let agree = 0; const wrong = [];
for (const p of labelled) { const k = top(p.text); if (k === p.kind) agree++; else wrong.push({ text: p.text, jev: p.kind, classifier: k }); }
const P = require('./passages.json'); let whole = 0, wi = 0, tot = 0;
for (const [g, t] of P) {
  whole += top(t) === g;
  const w = t.split(' '), hist = []; let at = 1000;
  for (let i = 0; i < w.length; i += 6) { const f = w.slice(i, i + 6).join(' '); const h = C.hear(hist, f, at); hist.push({ text: f, at, scores: C.scorePhrase(f).scores }); at += 2; if (i >= 12) { tot++; wi += h.ranked[0][0] === g; } }
}
console.log(JSON.stringify({ rules: n, agree: labelled.length ? agree / labelled.length : null, labelled: labelled.length, whole, of: P.length, window: wi / tot, wrong }));
