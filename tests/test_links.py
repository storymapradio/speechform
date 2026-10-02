"""Links between recordings: stems (Porter, the same in Python and the browser), meaning (MiniLM), several links per
thread, re-checked all through the thread's life. The owner's cases: a lamp at the top of the stairs meets the
grandfather's lighthouse; the keeper of the beacon meets it by meaning alone; a budget meeting meets nothing."""
import json, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT)]
import match, steer, depth

LIGHTHOUSE = 'My grandfather kept the lighthouse. Every night he climbed the stairs and lit the lamp.'

class Stems(unittest.TestCase):
    def test_porter(self):
        for w, s in [('caresses', 'caress'), ('ponies', 'poni'), ('motoring', 'motor'), ('hopping', 'hop'), ('relational', 'relat'),
                     ('generalizations', 'gener'), ('stairs', 'stair'), ('climbed', 'climb')]:
            self.assertEqual(match.stem(w), s, w)
        self.assertIn('fog', match.keywords('The fog came in.'))         # three letters count now

    def test_python_and_the_browser_agree(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('node is not installed')
        words = sorted(set('the stairs climbed lighthouse keeper beacon caresses ponies hopping relational generalizations oscillators happily running'.split()))
        js = json.loads(subprocess.run([node, '-e', "const M=require('./studio/match.js');console.log(JSON.stringify(JSON.parse(process.argv[1]).map(M.stem)))", json.dumps(words)],
                                       capture_output=True, text=True, check=True, cwd=ROOT).stdout)
        self.assertEqual(js, [match.stem(w) for w in words])
        a = {'keywords': ['lamp', 'stair', 'light'], 'vec': match.pack([.1] * 8), 'kind': 'story'}
        b = {'keywords': ['lamp', 'stair', 'climb'], 'vec': match.pack([.1, .2] * 4), 'kind': 'story'}
        got = json.loads(subprocess.run([node, '-e', "const M=require('./studio/match.js');const [a,b]=JSON.parse(process.argv[1]);console.log(JSON.stringify(M.strength(a,b)))", json.dumps([a, b])],
                                        capture_output=True, text=True, check=True, cwd=ROOT).stdout)
        py = match.strength(a, b)
        self.assertAlmostEqual(got['s'], py['s'], places=2); self.assertEqual(got['shared'], py['shared'])

class Meaning(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from sentence_transformers import SentenceTransformer
            cls.m = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', cache_folder=str(ROOT / 'models'), local_files_only=True)
        except Exception as e:
            raise unittest.SkipTest('no model: ' + str(e)[:60])

    def thread(self, text, kind='story'):
        return {'keywords': match.keywords(text), 'vec': match.pack(self.m.encode([text], normalize_embeddings=True)[0]), 'kind': kind}

    def test_the_owners_cases(self):
        L = self.thread(LIGHTHOUSE)
        lamp = match.strength(self.thread('The lamp at the top of the stairs, the light going round.'), L)
        beacon = match.strength(self.thread('The keeper of the beacon watched the ships all winter.'), L)
        budget = match.strength(self.thread('The budget and the hiring plan for next quarter.', 'lecture'), L)
        print(f"\n  lamp {lamp}\n  beacon {beacon}\n  budget {budget}")
        self.assertGreaterEqual(lamp['s'], match.LINK); self.assertEqual(set(lamp['shared']), {'lamp', 'stair'})
        self.assertGreaterEqual(beacon['s'], match.LINK); self.assertEqual(beacon['shared'], [])     # by meaning alone
        self.assertLess(budget['s'], match.LINK)

    def test_a_ledger_links_through_the_threads_life(self):
        tmp = tempfile.TemporaryDirectory(); steer.INDEX = Path(tmp.name) / 'index.json'; steer._index_cache.update(mtime=None, items=[])
        earlier = steer.Ledger('earlier', lambda t: self.m.encode([t], normalize_embeddings=True)[0])
        s = earlier.add({'id': 'e1', 'text': LIGHTHOUSE, 'at': 1000, 'form': 'story', 'source': 'Microphone'}, None, {'id': 'house', 'title': 'Grandfather kept lighthouse'})
        th = [{**t, 'vec': earlier.vectors().get(t['id'])} for t in s['threads']]
        steer.index_add(th, card='2026-09-01 The lighthouse', session='earlier', when=1000)
        steer.index_add([{'id': 'b', 'title': 'Budget hiring plan', 'keywords': match.keywords('budget hiring plan quarter'), 'kind': 'lecture'}], card='meeting', session='other', when=900)
        now = steer.Ledger('now', lambda t: self.m.encode([t], normalize_embeddings=True)[0])
        lines = ['We talked about the weather for a while today.', 'It was cold and grey over the harbour.', 'Then I thought of the stairs again.',
                 'The lamp at the top of the stairs, the light going round, the keeper climbing up.']
        for i, l in enumerate(lines):
            s = now.add({'id': f'n{i}', 'text': l, 'at': 2000 + i * 5, 'form': 'story', 'source': 'Microphone'}, None, {'id': 'walk', 'title': 'Weather walk'})
        t = s['threads'][0]
        print('  links after phrase', t['n'], [(l['title'], l['strength'], l['shared'], l['meaning']) for l in t['links']])
        self.assertTrue(t['links'] and t['links'][0]['card'] == '2026-09-01 The lighthouse')    # found at the fourth phrase, not only the first three
        self.assertFalse(any(l['card'] == 'meeting' for l in t['links']))
        self.assertIn('stairs', t['links'][0]['shared'])                                       # the why, in the words as they were said
        tmp.cleanup()

if __name__ == '__main__':
    unittest.main()
