/* How a thread meets a thread: match.py, line for line, for the browser.
 *   stem(word), keywords(text), pack(vec)/unpack(s), cosine(a, b), strength(a, b) → { s, shared, meaning, form }, LINK
 * strength = .55 × meaning (cosine .15..5 → 0..1) + .35 × shared stems (two at least) + .10 × same form or arc stage;
 * without vectors the stems alone decide (two shared and .34 of the smaller set).
 */
(function (root) {
  'use strict';
  const LINK = .3;
  const STOP = new Set(`the and that this with from have were they them their there then when what which would could should about into your just
like been some very over also more than only will said says know think really yeah okay right going want thing things people because where
while these those here each every other after before again still even much many most such being are was for you not but all any can had
her his him she our out who how its let may our own too use way yes got get one two did does done has its it's i'm you're don't can't won't
let's i've we're they're that's there's what's not nor off per via upon onto us we me my mine i a an of to in on at by or if so as is it be do no`.split(/\s+/));

  const cons = (w, i) => { const c = w[i]; if ('aeiou'.includes(c)) return false; if (c === 'y') return i === 0 || !cons(w, i - 1); return true; };
  function m(w) { let n = 0, i = 0; const L = w.length; while (i < L && cons(w, i)) i++;
    while (i < L) { while (i < L && !cons(w, i)) i++; if (i >= L) break; n++; while (i < L && cons(w, i)) i++; } return n; }
  const vowel = w => { for (let i = 0; i < w.length; i++) if (!cons(w, i)) return true; return false; };
  const dcons = w => w.length >= 2 && w[w.length - 1] === w[w.length - 2] && cons(w, w.length - 1);
  const cvc = w => w.length >= 3 && cons(w, w.length - 3) && !cons(w, w.length - 2) && cons(w, w.length - 1) && !'wxy'.includes(w[w.length - 1]);
  const ends = (w, s) => w.endsWith(s);
  function rep(w, rules, cond) { for (const [suf, r] of rules) if (ends(w, suf)) { const base = w.slice(0, w.length - suf.length); return cond(base) ? base + r : w; } return w; }
  function stem(w) {
    w = w.toLowerCase(); if (w.length <= 2) return w;
    if (ends(w, 'sses')) w = w.slice(0, -2); else if (ends(w, 'ies')) w = w.slice(0, -2); else if (ends(w, 'ss')) {} else if (ends(w, 's')) w = w.slice(0, -1);
    let flag = false;
    if (ends(w, 'eed')) { if (m(w.slice(0, -3)) > 0) w = w.slice(0, -1); }
    else if (ends(w, 'ed') && vowel(w.slice(0, -2))) { w = w.slice(0, -2); flag = true; }
    else if (ends(w, 'ing') && vowel(w.slice(0, -3))) { w = w.slice(0, -3); flag = true; }
    if (flag) { if (ends(w, 'at') || ends(w, 'bl') || ends(w, 'iz')) w += 'e'; else if (dcons(w) && !'lsz'.includes(w[w.length - 1])) w = w.slice(0, -1); else if (m(w) === 1 && cvc(w)) w += 'e'; }
    if (ends(w, 'y') && vowel(w.slice(0, -1))) w = w.slice(0, -1) + 'i';
    w = rep(w, [['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'], ['izer', 'ize'], ['abli', 'able'], ['alli', 'al'], ['entli', 'ent'], ['eli', 'e'], ['ousli', 'ous'],
      ['ization', 'ize'], ['ation', 'ate'], ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'], ['fulness', 'ful'], ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble']], b => m(b) > 0);
    w = rep(w, [['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'], ['ical', 'ic'], ['ful', ''], ['ness', '']], b => m(b) > 0);
    for (const suf of ['al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize']) {
      if (ends(w, suf)) { const base = w.slice(0, w.length - suf.length); if (m(base) > 1 && (suf !== 'ion' || (base && 'st'.includes(base[base.length - 1])))) w = base; break; }
    }
    if (ends(w, 'e')) { const base = w.slice(0, -1); if (m(base) > 1 || (m(base) === 1 && !cvc(base))) w = base; }
    if (m(w) > 1 && dcons(w) && ends(w, 'l')) w = w.slice(0, -1);
    return w;
  }
  function pairs(text) {
    const out = [], seen = new Set();
    for (let word of (String(text || '').toLowerCase().replace(/\u2019/g, "'").match(/[a-z']+/g) || [])) {
      word = word.replace(/^'+|'+$/g, '');
      if (word.length < 3 || STOP.has(word)) continue;
      const s = stem(word); if (s.length >= 3 && !seen.has(s)) { seen.add(s); out.push([s, word]); }
    }
    return out;
  }
  const keywords = (text, most = 40) => pairs(text).map(p => p[0]).slice(0, most);
  function pack(v) {
    if (!v) return null; let bin = '';
    for (const x of v) bin += String.fromCharCode((Math.max(-127, Math.min(127, Math.round(x * 127))) + 256) % 256);
    return btoa(bin);
  }
  function unpack(s) { if (!s) return null; const b = atob(s), out = new Array(b.length); for (let i = 0; i < b.length; i++) { const x = b.charCodeAt(i); out[i] = (x > 127 ? x - 256 : x) / 127; } return out; }
  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return null; let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? d / Math.sqrt(na * nb) : null;
  }
  const r3 = v => Math.round(v * 1000) / 1000;
  function strength(a, b) {
    const A = [...new Set(a.keywords || [])], B = new Set(b.keywords || []), shared = A.filter(w => B.has(w));
    const kw = shared.length >= 2 ? shared.length / Math.max(1, Math.min(A.length, B.size)) : 0;
    const va = typeof a.vec === 'string' ? unpack(a.vec) : a.vec, vb = typeof b.vec === 'string' ? unpack(b.vec) : b.vec, c = cosine(va, vb);
    let form = a.kind && a.kind === b.kind ? 1 : 0; if (!form && a.stage && a.stage === b.stage) form = 1;
    let s, mean = null;
    if (c === null) s = shared.length >= 2 && kw >= .34 ? kw : 0;
    else { mean = Math.max(0, Math.min(1, (c - .15) / .35)); s = .55 * mean + .35 * Math.min(1, kw) + (mean > .25 || kw ? .1 * form : 0); }
    return { s: r3(Math.min(1, s)), shared: shared.slice(0, 8), meaning: c === null ? null : r3(c), form: !!form };
  }
  const api = { stem, keywords, pairs, pack, unpack, cosine, strength, LINK, STOP };
  if (typeof module !== 'undefined' && module.exports) { if (typeof btoa === 'undefined') { global.btoa = s => Buffer.from(s, 'binary').toString('base64'); global.atob = s => Buffer.from(s, 'base64').toString('binary'); } module.exports = api; }
  else root.SpeechformMatch = api;
})(this);
