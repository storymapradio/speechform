"""Structural signals: how a passage is built, whatever it is about. Each is a rate from 0 to 1."""
import re
IMPERATIVE = set('''add adjust allow apply ask avoid begin bring build call carry check choose clean close collect connect
continue cook count cover cut do draw drink drop eat enter fill find finish fold follow get give go grab hold insert keep
knead lay leave let lift listen look make mark measure mix move note notice open pack paint pick place plant plug pour
practise practice preheat press pull push put read record remember remove repeat rest roll rub run save say scoop screw
see select separate set shake slide sit slice sort speak spread start stir stop take tell thread tie try turn twist type
unplug unscrew use wait walk wash watch water wipe write'''.split())
SEQUENCE = r"\b(first|then|next|after that|afterwards|finally|before you|once you|until|step \w+|now)\b"
ACADEMIC = r"\b(research|evidence|theory|theories|historians|studies|study|data|suggests?|significant|concept|analysis|findings?|scholars?|examine|argue[sd]?|implications?|consequently)\b"
HEDGE = r"\b(let me (think|see|check)|maybe|what if|wait|hmm+|um+|uh+|actually|hold on|i'm not sure|i guess|i think|so,? (okay|ok))\b"
REALIZE = r"\b(i realize|i remember|looking back|i've come to|i have come to|i understand now|i used to|i felt|i feel)\b"
FORMAL = r"\b(however|thus|whom|whereupon|nevertheless|which|whose|chapter|the author|mr\.|mrs\.|considerably|accordingly|said to be)\b"
CLASS = r"\b(class|everyone|board|notebooks?|exercise|page \w+|homework|who can|can anyone)\b"
THEREFORE = r"\b(therefore|the point of (all of )?this|my claim|in conclusion|it follows|so we (must|should))\b"

def _rate(n, words, per=12.0):
    return min(1.0, n * per / max(words, 1))

def signals(text):
    t = text.strip()
    low = t.lower()
    words = re.findall(r"[a-z']+", low)
    n = max(len(words), 1)
    sentences = [s.strip() for s in re.split(r'[.!?;]+|\n', t) if s.strip()]
    first = [re.findall(r"[a-z']+", s.lower())[:1] for s in sentences]
    imperative = sum(1 for f in first if f and f[0] in IMPERATIVE) / max(len(sentences), 1)
    past = sum(1 for w in words if w in ('was', 'were', 'had', 'did') or (w.endswith('ed') and len(w) > 4)) / n
    third = sum(1 for w in words if w in ('he', 'she', 'they', 'him', 'her', 'his', 'them', 'their')) / n
    firstp = sum(1 for w in words if w in ('i', 'me', 'my', 'mine', "i'm", "i've", "i'd")) / n
    you = sum(1 for w in words if w in ('you', 'your', "you're", 'yours')) / n
    commas_and = low.count(' and ') + low.count(',')
    runon = min(1.0, commas_and / max(len(sentences), 1) / 5.0)
    repeated = 0
    grams = [' '.join(words[i:i + 3]) for i in range(len(words) - 2)]
    if grams:
        repeated = 1 - len(set(grams)) / len(grams)
    refrain = min(1.0, repeated * 3 + (0.5 if re.search(r"\b(la la|na na|oh oh|hey hey)\b", low) else 0))
    quote_turns = len(re.findall(r"\?\s+[A-Z]", t)) + low.count('i agree') + low.count('you said')
    return {
        'imperative': min(1.0, imperative * 1.4),
        'you': min(1.0, you * 12),
        'sequence': _rate(len(re.findall(SEQUENCE, low)), n),
        'question': min(1.0, t.count('?') / max(len(sentences), 1) * 1.5),
        'academic': _rate(len(re.findall(ACADEMIC, low)), n, 18),
        'therefore': _rate(len(re.findall(THEREFORE, low)), n, 25),
        'turns': min(1.0, quote_turns / 3.0),
        'hedge': _rate(len(re.findall(HEDGE, low)), n, 14),
        'i': min(1.0, firstp * 10),
        'realize': _rate(len(re.findall(REALIZE, low)), n, 25),
        'past': min(1.0, past * 8),
        'third': min(1.0, third * 12),
        'formal': _rate(len(re.findall(FORMAL, low)), n, 16),
        'class': _rate(len(re.findall(CLASS, low)), n, 16),
        'runon': runon,
        'refrain': refrain,
    }
