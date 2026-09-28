"""Refining the algorithm with Claude, so that one day Jev is not needed.

After Jev reads a recording, the passages where the classifier and Jev disagreed go to Claude (the Claude
Code command line, headless, on this Mac). Claude answers with marker rules only (a pattern, a kind, a
weight), never code. Each rule is tried on its own and kept only if:

  it raises either classifier's agreement with Jev on the passages Jev has labelled, lowering neither, and
  neither classifier loses a single fixed test passage (tests/passages.py and light/passages.json), and
  Light's fragment accuracy drops by no more than two points.

Kept rules live in runtime/rules.json and are read by both classifiers. Every attempt, kept or not, is
written to runtime/refinements/<time>.json with what Claude proposed and what the measures said.
"""
import json, re, shutil, subprocess, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = ROOT / 'runtime' / 'rules.json'
LEARNED = ROOT / 'runtime' / 'learned.json'
LOG = ROOT / 'runtime' / 'refinements'
KINDS = ['instruction', 'lecture', 'lesson', 'dialogue', 'reflective monologue', 'thinking aloud', 'stream of consciousness',
         'reading aloud', 'song', 'lyrics', 'poetry', 'story', 'character development', 'scenery', 'lore', 'myth',
         'cosmology', 'mystery', 'argument']
PER_KIND = 12           # at most this many rules per kind, the newest kept

PROMPT = """You are refining a small rule-based classifier of kinds of speech. It scores a passage for each of
these kinds: {kinds}. Besides its built-in marker words and sentence-shape signals, it reads extra rules:
each rule is a case-insensitive regular expression that, when it matches, adds points to one kind.

A careful judge (Jev) labelled passages from this speaker's own recordings. Here are the passages where the
classifier disagreed with Jev (Jev's kind first, then what the classifier said):

{wrong}

The rules already in use:
{rules}

Write new rules that would make the classifier agree with Jev on passages like these. Rules must capture the
FORM of the speech (how it is said: commands, second person, sequence words, pacing cues, questions, tense,
refrains), not its topic, so they carry over to other recordings on other subjects. Avoid single topic
nouns. Use word boundaries (\\b). Keep each pattern short. Give 2 to 8 rules in all.

Answer with JSON only, no prose, in exactly this shape:
{{"rules": [{{"kind": "<one of the kinds>", "pattern": "<regex>", "weight": <0.3 to 1.5>, "label": "<2-4 words>"}}]}}"""

def _json(path, default):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default

def _light(rules, labelled):
    with tempfile.TemporaryDirectory() as d:
        r, l = Path(d) / 'r.json', Path(d) / 'l.json'
        r.write_text(json.dumps(rules)); l.write_text(json.dumps(labelled))
        out = subprocess.run(['node', str(ROOT / 'light' / 'refine-eval.js'), str(r), str(l)], capture_output=True, text=True, timeout=120)
        return json.loads(out.stdout)

_model = {}
def _engine(rules, labelled):
    """the full engine with these rules; the model is loaded once and kept"""
    import sys, os
    if 'e' not in _model:
        os.environ.setdefault('HF_HUB_OFFLINE', '1')
        sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]
        from sentence_transformers import SentenceTransformer
        from engine import Engine
        from passages import PASSAGES
        _model['e'] = Engine(SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', cache_folder=str(ROOT / 'models'), local_files_only=True))
        _model['p'] = PASSAGES
    e = _model['e']; e.set_rules(rules)
    kind = lambda t: e.labels[int(e.classify(t)[1].argmax())]
    agree = sum(kind(p['text']) == p['kind'] for p in labelled)
    return {'rules': sum(len(v) for v in e.rules.values()), 'agree': agree / len(labelled) if labelled else None,
            'whole': sum(kind(t) == g for g, t in _model['p']), 'of': len(_model['p'])}

def ask_claude(prompt, timeout=240):
    claude = shutil.which('claude') or str(Path.home() / '.local' / 'bin' / 'claude')
    out = subprocess.run([claude, '-p', prompt, '--output-format', 'json'], capture_output=True, text=True, timeout=timeout, cwd=str(ROOT))
    reply = json.loads(out.stdout).get('result', '') if out.stdout.strip().startswith('{') else out.stdout
    m = re.search(r'\{.*\}', reply, re.S)
    return json.loads(m.group(0)) if m else {}

def valid(rule):
    if rule.get('kind') not in KINDS or not isinstance(rule.get('pattern'), str) or len(rule['pattern']) > 120:
        return False
    try:
        re.compile(rule['pattern'], re.I)
    except re.error:
        return False
    return not re.fullmatch(r'\\b\w+\\b', rule['pattern'])      # a lone word is a topic, not a form

def refine(card_id=None):
    labelled = [{'text': x['text'], 'kind': x['kind']} for x in _json(LEARNED, [])]
    if not labelled:
        return None
    current = _json(RULES, {})
    before_light, before_engine = _light(current, labelled), _engine(current, labelled)
    report = {'at': time.time(), 'card': card_id, 'labelled': len(labelled), 'before': {'light': {k: v for k, v in before_light.items() if k != 'wrong'}, 'engine': before_engine}}
    wrong = before_light.get('wrong', [])
    if not wrong:
        report['result'] = 'nothing to refine: the light classifier already agrees with Jev on every passage'
        return _log(report)
    listing = '\n'.join(f'- [{w["jev"]}] (classifier said {w["classifier"]}): "{w["text"][:400]}"' for w in wrong[:12])
    try:
        got = ask_claude(PROMPT.format(kinds=', '.join(KINDS), wrong=listing, rules=json.dumps(current) if current else 'none yet'))
    except Exception as e:
        report['result'] = f'Claude did not answer: {str(e)[:200]}'
        return _log(report)
    proposed = [r for r in got.get('rules', []) if valid(r)]
    report['proposed'] = proposed
    if not proposed:
        report['result'] = 'Claude proposed no usable rules'
        return _log(report)
    # each rule on its own merits: added one at a time, kept only if it raises agreement with Jev
    # in either classifier and costs nothing anywhere else
    kept = {k: list(v) for k, v in current.items()}
    light, engine = before_light, before_engine
    report['trials'] = []
    for r in proposed:
        trial = {k: list(v) for k, v in kept.items()}
        trial.setdefault(r['kind'], []).append({'pattern': r['pattern'], 'weight': max(.3, min(1.5, float(r.get('weight', .8)))), 'label': r.get('label', '')})
        trial[r['kind']] = trial[r['kind']][-PER_KIND:]
        tl, te = _light(trial, labelled), _engine(trial, labelled)
        better = (tl['agree'] or 0) > (light['agree'] or 0) or (te['agree'] or 0) > (engine['agree'] or 0)
        safe = (tl['whole'] >= light['whole'] and te['whole'] >= engine['whole'] and tl['window'] >= light['window'] - .02
                and (tl['agree'] or 0) >= (light['agree'] or 0) and (te['agree'] or 0) >= (engine['agree'] or 0))
        report['trials'].append({'rule': r, 'light': tl['agree'], 'engine': te['agree'], 'kept': better and safe,
                                 'why': 'raised agreement' if better and safe else 'no gain' if not better else 'cost a test passage or agreement'})
        if better and safe:
            kept, light, engine = trial, tl, te
    report['after'] = {'light': {k: v for k, v in light.items() if k != 'wrong'}, 'engine': engine}
    n = sum(1 for t in report['trials'] if t['kept'])
    if n:
        RULES.write_text(json.dumps(kept, indent=1))
    report['result'] = f'kept {n} of {len(proposed)} rules' if n else 'set aside: no rule raised agreement without a cost'
    return _log(report)

def _log(report):
    LOG.mkdir(parents=True, exist_ok=True)
    (LOG / (time.strftime('%Y-%m-%d %H.%M.%S') + '.json')).write_text(json.dumps(report, indent=1))
    return report

def history(limit=30):
    out = []
    for f in sorted(LOG.glob('*.json'), reverse=True)[:limit]:
        try:
            out.append(json.loads(f.read_text()))
        except (OSError, ValueError):
            pass
    return out

if __name__ == '__main__':
    print(json.dumps(refine(), indent=1))
