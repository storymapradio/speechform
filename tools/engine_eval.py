"""The full engine with a set of rules, on the passages Jev has labelled and the fixed test passages. Prints JSON.
Usage: .worker/bin/python tools/engine_eval.py rules.json labelled.json"""
import json, sys, os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]
os.environ.setdefault('HF_HUB_OFFLINE', '1')
from sentence_transformers import SentenceTransformer
from engine import Engine
from passages import PASSAGES
e = Engine(SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', cache_folder=str(ROOT / 'models'), local_files_only=True))
n = e.set_rules(json.loads(Path(sys.argv[1]).read_text() or '{}'))
labelled = json.loads(Path(sys.argv[2]).read_text() or '[]')
kind = lambda t: e.labels[int(e.classify(t)[1].argmax())]
agree = sum(kind(p['text']) == p['kind'] for p in labelled)
whole = sum(kind(t) == g for g, t in PASSAGES)
print(json.dumps({'rules': n, 'agree': agree / len(labelled) if labelled else None, 'whole': whole, 'of': len(PASSAGES)}))
