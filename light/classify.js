/* Speechform Light: the kind of speech, by algorithm alone.
 *
 * No model and no network. Every point a kind receives comes from something that can be
 * pointed at in the words: a marker word ("once upon", "therefore", "valley"), or the way
 * the passage is built (commands, questions, "I" and "you", past tense, run-on "and"s,
 * refrains). So the classifier can always say exactly why it chose what it chose.
 *
 * A phrase is judged with the minute of talk before it; each phrase is scored on its own
 * and the scores are averaged, the newest words counting most.
 */
(function (root) {
  'use strict';

  const KINDS = ['instruction', 'lecture', 'lesson', 'dialogue', 'reflective monologue', 'thinking aloud',
    'stream of consciousness', 'reading aloud', 'song', 'lyrics', 'poetry', 'story', 'character development',
    'scenery', 'lore', 'myth', 'cosmology', 'mystery', 'argument'];

  const IMAGE = {
    'instruction': 'stack', 'lecture': 'stack', 'lesson': 'stack', 'dialogue': 'tide',
    'reflective monologue': 'kelp', 'thinking aloud': 'kelp', 'stream of consciousness': 'kelp',
    'reading aloud': 'path', 'story': 'path', 'character development': 'path', 'song': 'waves', 'lyrics': 'waves',
    'poetry': 'bloom', 'scenery': 'land', 'lore': 'hive', 'myth': 'hive', 'cosmology': 'orrery',
    'mystery': 'rings', 'argument': 'rings',
  };

  /* marker words and phrases: each match adds its weight to the kind */
  const MARKERS = {
    'instruction': [[/\b(first|then|next|finally|afterwards|once you|before you|until|make sure|be sure|step)\b/g, 1],
      [/\b(minutes?|degrees|inches|screws?|tray|oven|level|settings?|button|switch|cable|microphone|headphones)\b/g, .5]],
    'lecture': [[/\b(today (we|i) will|research|evidence|theory|theories|historians?|scholars?|studies|data|findings?|concept|analysis|suggests?|in this (session|lecture|talk)|examine|century)\b/g, 1.2]],
    'lesson': [[/\b(let'?s (try|practise|practice|look|learn)|class|everyone|board|notebooks?|page \w+|exercises?|who can|can anyone|good\. now|your partner|your own|what do you notice)\b/g, 1.4]],
    'dialogue': [[/\b(you said|i agree|what do you think|i hear you|let me answer|what did you mean|really\?|did you|do you|are you|why did you|tell me)\b/g, 1.2]],
    'reflective monologue': [[/\b(looking back|i realize|i remember|i('ve| have) come to|i understand now|i used to|at the time|years later|i felt|i was grateful|taught me)\b/g, 1.4]],
    'thinking aloud': [[/\b(let me (think|see|check)|maybe|what if|wait|hmm+|um+|uh+|actually|hold on|i'?m not sure|i guess|no, that|that won'?t work|let'?s see)\b/g, 1.2]],
    'stream of consciousness': [[/\b(and then|and the|and my|and i keep|always)\b/g, .35]],
    'reading aloud': [[/\b(chapter \w+|the author|writes|writing|pages?|account|however|whom|whose|custom|considerably|obliged|in those days|it was the)\b/g, 1]],
    'song': [[/\b(la la|na na|oh oh|hey hey|sing|chorus|verse|everybody|clap|hold (that|the) note|one more time)\b/g, 1.5]],
    'lyrics': [[/\b(baby|you'?re the one|back to you|every time|tonight|forever|my heart|hold me|don'?t let go)\b/g, 1.2]],
    'poetry': [[/\b(moon|silver|wound|hush|petals?|ledger|lantern|folds?|wings?|sleeps?|grief|tide|willow|ash|bone|stone after stone)\b/g, .8],
      [/\b(is a|like a|as if)\b/g, .5]],
    'story': [[/\b(once upon|once there was|one (day|morning|night|evening)|when (he|she|they)|suddenly|finally|after (three|many|a few)|she (found|climbed|packed|walked)|he (woke|found|opened|sat))\b/g, 1.1]],
    'character development': [[/\b(feared|fear|pride|proud|loyal(ty)?|flaw|wanted|longed|became|grew (stronger|kinder|colder)|changed|forgiven|cruel|kindness|strength)\b/g, 1.1]],
    'scenery': [[/\b(valley|hills?|mountains?|river|fields?|mist|pines?|ridge|lake|horizon|sky|light caught|shore|meadow|forest|street|dunes)\b/g, .9]],
    'lore': [[/\b(kingdom|order of|guild|clan|custom|oath|founders?|records|ancestors|charter|lineage|by custom|keeps? the)\b/g, 1.2]],
    'myth': [[/\b(gods?|goddess|in the beginning|stole fire|trickster|heavens?|divine|sacred|the first people|that is why|forever)\b/g, 1.3]],
    'cosmology': [[/\b(universe|cosmos|galax(y|ies)|stars?|space and time|expanding|atoms?|big bang|filaments?|voids?|planets?|orbit)\b/g, 1.2]],
    'mystery': [[/\b(clue|who (could|had|took|did)|why had|locked|alibi|missing|secret|evidence points|suspect|somebody had|someone had)\b/g, 1.3]],
    'argument': [[/\b(the point of (all of )?this|therefore|my claim|the evidence is clear|in conclusion|it follows|does not hold|we should|we must|critics)\b/g, 1.4]],
  };

  const IMPERATIVE = new Set(('add adjust allow apply ask avoid begin bring build call carry check choose clean close collect connect continue cook count cover cut do draw drink drop eat enter fill find finish fold follow get give go grab hold insert keep knead lay leave let lift listen look make mark measure mix move note notice open pack paint pick place plant plug pour practise practice preheat press pull push put read record remember remove repeat rest roll rub run save say scoop screw see select separate set shake slide sit slice sort speak spread start stir stop take tell thread tie try turn twist type unplug unscrew use wait walk wash watch water wipe write').split(' '));

  /* how the passage is built, as rates from 0 to 1 */
  function structure(text) {
    const low = text.toLowerCase();
    const words = low.match(/[a-z']+/g) || [];
    const n = Math.max(words.length, 1);
    const sentences = text.split(/[.!?;]+|\n/).map(s => s.trim()).filter(Boolean);
    const firsts = sentences.map(s => (s.toLowerCase().match(/[a-z']+/) || [''])[0]);
    const count = set => words.filter(w => set.includes(w)).length;
    const grams = []; for (let i = 0; i + 2 < words.length; i++) grams.push(words.slice(i, i + 3).join(' '));
    const repeated = grams.length ? 1 - new Set(grams).size / grams.length : 0;
    const clip = v => Math.max(0, Math.min(1, v));
    return {
      imperative: clip(firsts.filter(f => IMPERATIVE.has(f)).length / Math.max(sentences.length, 1) * 1.4),
      you: clip(count(['you', 'your', "you're", 'yours']) / n * 12),
      question: clip((text.match(/\?/g) || []).length / Math.max(sentences.length, 1) * 1.5),
      i: clip(count(['i', 'me', 'my', 'mine', "i'm", "i've", "i'd"]) / n * 10),
      past: clip(words.filter(w => ['was', 'were', 'had', 'did'].includes(w) || (w.endsWith('ed') && w.length > 4)).length / n * 8),
      third: clip(count(['he', 'she', 'they', 'him', 'her', 'his', 'them', 'their']) / n * 12),
      runon: clip(((low.match(/ and /g) || []).length + (low.match(/,/g) || []).length) / Math.max(sentences.length, 1) / 5),
      refrain: clip(repeated * 3),
      short: clip((8 - n / Math.max(sentences.length, 1)) / 6),   // short lines, as in verse
    };
  }
  const SHAPE = {
    'instruction': { imperative: 1.6, you: .6 }, 'lesson': { question: .6, you: .5 }, 'dialogue': { question: .9, you: .6 },
    'thinking aloud': { question: .3, i: .3 }, 'reflective monologue': { i: .9, past: .5 }, 'stream of consciousness': { runon: 1.6 },
    'story': { past: .5, third: .5 }, 'reading aloud': { past: .4, third: .4 }, 'character development': { third: .5 },
    'song': { refrain: 1.4 }, 'lyrics': { refrain: 1.0, you: .3 }, 'poetry': { short: .3 },
  };

  /* one phrase, on its own: every kind's points, and the words and shapes that earned them */
  function scorePhrase(text) {
    const low = ' ' + text.toLowerCase().replace(/[“”]/g, '"').replace(/’/g, "'") + ' ';
    const n = Math.max((low.match(/[a-z']+/g) || []).length, 1);
    const scores = {}, because = {}, parts = {};
    const sg = structure(text), soft = 1.5 / Math.sqrt(n);
    for (const k of KINDS) {
      let s = 0; const why = [], built = [];
      for (const [re, w] of MARKERS[k] || []) {
        const hits = low.match(re) || [];
        if (hits.length) { s += w * hits.length; hits.forEach(h => { why.push(h.trim()); built.push({ label: h.trim(), add: w * soft, type: 'word' }); }); }
      }
      s = s * soft;                                     // markers per length, softened for long passages
      for (const [f, w] of Object.entries(SHAPE[k] || {})) {
        if (sg[f] > .05) { s += w * sg[f]; why.push(f); built.push({ label: f, add: w * sg[f], type: 'shape' }); }
      }
      scores[k] = s; because[k] = why; parts[k] = built;
    }
    return { scores, because, parts, structure: sg };
  }

  /* a phrase with the minute before it: each phrase's points averaged, the newest words counting most */
  const WINDOW_SECONDS = 60, WINDOW_WORDS = 60, RECENCY = 16;
  function hear(history, text, now) {
    now = now || Date.now() / 1000;
    const own = scorePhrase(text);
    const recent = []; let words = text.split(/\s+/).length;
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i]; const k = h.text.split(/\s+/).length;
      if (now - h.at > WINDOW_SECONDS || words + k > WINDOW_WORDS) break;
      recent.unshift(h); words += k;
    }
    const total = {}; KINDS.forEach(k => total[k] = own.scores[k] * text.split(/\s+/).length);
    let wsum = text.split(/\s+/).length, age = wsum;
    const weights = [{ id: null, text, w: wsum }];
    for (let i = recent.length - 1; i >= 0; i--) {
      const h = recent[i]; const k = h.text.split(/\s+/).length; const w = Math.exp(-age / RECENCY) * k;
      KINDS.forEach(kind => total[kind] += w * (h.scores ? h.scores[kind] : 0)); wsum += w; age += k;
      weights.unshift({ id: h.id, text: h.text, w });
    }
    KINDS.forEach(k => total[k] /= wsum);
    weights.forEach(x => x.w /= wsum);                // each phrase's share of the verdict, oldest first
    const ranked = KINDS.map(k => [k, total[k]]).sort((a, b) => b[1] - a[1]);
    return { ranked, own, words, recent, weights };
  }

  /* the decision: take a new kind when it clearly leads, or after it has led twice */
  function decide(prev, ranked, streak) {
    const [top, second] = ranked;
    const margin = top[1] - second[1];
    if (!prev) return { kind: top[0], reason: 'the first phrase sets the kind' };
    if (top[1] < .15) return { kind: prev, reason: 'nothing in the last minute marks a new kind' };
    if (top[0] === prev) return { kind: prev, reason: 'the last minute still reads as ' + prev };
    if (margin > .12) return { kind: top[0], reason: 'it leads by ' + margin.toFixed(2) };
    if (streak >= 2) return { kind: top[0], reason: 'it has led for two phrases' };
    return { kind: prev, reason: 'held at ' + prev + ' until ' + top[0] + ' leads again' };
  }

  const api = { KINDS, IMAGE, scorePhrase, hear, decide, structure };
  if (typeof module !== 'undefined') module.exports = api; else root.SpeechformClassify = api;
})(this);
