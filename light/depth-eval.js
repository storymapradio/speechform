// node light/depth-eval.js: the depth layer in the browser's algorithm, on the classifier's test passages.
// Each kind's elements are scored on every passage; a kind passes when its own passages light its elements more,
// on average, than the other kinds' passages do. --json prints every passage's meters, for the Python parity test.
const D = require('./depth.js'), P = require('./passages.json');
const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const lit = (kind, text) => { const r = D.passage(text, [kind]); return mean(D.ORDER.flatMap(l => r.lenses[l].elements.map(e => e.score))); };
if (process.argv.includes('--json')) {
  const out = []; for (const k of Object.keys(D.lenses.kinds)) for (const [, t] of P) { const r = D.passage(t, [k]); out.push([k, t.slice(0, 24), D.ORDER.map(l => r.lenses[l].meter)]); }
  console.log(JSON.stringify(out)); process.exit(0);
}
let pass = 0; const rows = [];
for (const k of Object.keys(D.lenses.kinds)) {
  const own = mean(P.filter(([g]) => g === k).map(([, t]) => lit(k, t))), others = mean(P.filter(([g]) => g !== k).map(([, t]) => lit(k, t)));
  pass += own > others; rows.push(`${k.padEnd(24)} own ${own.toFixed(3)}  others ${others.toFixed(3)}  ${own > others ? 'ok' : 'LOW'}`);
}
console.log(rows.join('\n'));
console.log(`depth (light/depth.js): ${pass} of ${Object.keys(D.lenses.kinds).length} kinds light their own passages' elements more than the other kinds' passages do`);
process.exit(pass === Object.keys(D.lenses.kinds).length ? 0 : 1);
