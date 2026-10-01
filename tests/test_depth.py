"""The depth layer: the lenses are well formed, each kind's elements light its own passages more than other kinds'
passages (on the classifier's test passages and on held-out ones), Python and the browser agree, and the thread
ledger moves through its states. No model is needed, except for the last test, which is skipped without it."""
import json, re, shutil, subprocess, sys, tempfile, time, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]
import depth, steer
from passages import PASSAGES
from heldout import HELDOUT

def lit(kind, text):
    r = depth.passage(text, [kind])
    els = [e['score'] for l in depth.ORDER for e in r['lenses'][l]['elements']]
    return sum(els) / len(els)

def table(passages):
    rows = []
    for k in depth.LENSES['kinds']:
        own = [lit(k, t) for g, t in passages if g == k]
        oth = [lit(k, t) for g, t in passages if g != k]
        rows.append((k, sum(own) / len(own), sum(oth) / len(oth), 1 + sum(o >= sum(own) / len(own) for o in oth)))
    return rows

class Lenses(unittest.TestCase):
    def test_every_kind_has_three_lenses_and_an_arc(self):
        kinds = depth.LENSES['kinds']
        self.assertEqual(len(kinds), 19)
        for k, spec in kinds.items():
            self.assertTrue(spec.get('sources'), k)
            self.assertGreaterEqual(len(spec.get('arc') or []), 3, k)
            ids = set()
            for l in depth.ORDER:
                L = spec[l]
                self.assertTrue(L['question'] and L['answer'], (k, l))
                self.assertTrue(4 <= len(L['elements']) <= 8, (k, l))
                for e in L['elements']:
                    self.assertNotIn(e['id'], ids, (k, e['id'])); ids.add(e['id'])
                    self.assertTrue(e['cue'].get('re') or e['cue'].get('signal'), (k, e['id']))
                    if e['cue'].get('re'):
                        self.assertNotRegex(e['cue']['re'], r'\(\?(<|P|i)', (k, e['id']))   # the browser runs the same patterns
            text = json.dumps(spec)
            self.assertNotIn('—', text, k)

    def test_each_kind_lights_its_own_passages(self):
        rows = table(PASSAGES)
        print('\n  test passages (tests/passages.py)')
        for k, own, oth, rank in rows:
            print(f'    {k:24} own {own:.3f}  others {oth:.3f}')
        self.assertEqual(sum(own > oth for _, own, oth, _ in rows), 19)

    def test_held_out_passages(self):
        rows = table(HELDOUT)
        print('\n  held-out passages (tests/heldout.py)')
        for k, own, oth, rank in rows:
            print(f'    {k:24} own {own:.3f}  others {oth:.3f}  rank {rank} of 19')
        above = sum(own > oth for _, own, oth, _ in rows); first = sum(rank == 1 for *_, rank in rows)
        print(f'    {above} of 19 above the others\' mean, {first} of 19 ranked first')
        self.assertGreaterEqual(above, 18)
        self.assertGreaterEqual(first, 15)

    def test_python_and_the_browser_agree(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('node is not installed')
        got = json.loads(subprocess.run([node, str(ROOT / 'light' / 'depth-eval.js'), '--json'], capture_output=True, text=True, check=True).stdout)
        worst = 0.0; i = 0
        for k in depth.LENSES['kinds']:
            for _, t in PASSAGES:
                r = depth.passage(t, [k])
                py = [r['lenses'][l]['meter'] for l in depth.ORDER]
                self.assertEqual(got[i][0], k)
                worst = max(worst, max(abs(a - b) for a, b in zip(py, got[i][2]))); i += 1
        print(f'\n  Python and light/depth.js differ by at most {worst:.4f} on {i} readings')
        self.assertLess(worst, .002)

    def test_window_weights_and_near_kinds(self):
        win = [('Once there was a girl who lived by the river.', .2), ('Then the boat began to sink.', 1.0)]
        d = depth.reading(win, depth.near_kinds('story', [('story', .5), ('myth', .45), ('lore', .1)]))
        self.assertEqual(d['kind'], 'story'); self.assertIn('myth', d['near']); self.assertNotIn('lore', d['near'])
        self.assertTrue(d['next'] and d['next']['try'])

class Threads(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); steer.INDEX = Path(self.tmp.name) / 'threads-index.json'
    def tearDown(self):
        self.tmp.cleanup()

    def feed(self, L, lines, t0=1000.0, form='story', topic='t1', speaker='A', step=5):
        snap = None
        for i, text in enumerate(lines):
            ev = {'id': f'{topic}-{i}-{t0}', 'text': text, 'speaker': speaker, 'at': t0 + i * step, 'form': form, 'topic': topic, 'source': 'Microphone'}
            snap = L.add(ev, depth.reading([(text, 1)], [form]), {'id': topic, 'title': topic, 'keywords': steer.keywords(text)})
        return snap

    def state(self, snap, tid):
        return next(t for t in snap['threads'] if t['id'] == tid)

    def test_a_story_opens_develops_readies_and_closes(self):
        L = steer.Ledger('s1')
        s = self.feed(L, ['Once there was a fisherman who lived by the sea.']); self.assertEqual(self.state(s, 't1')['state'], 'opened')
        s = self.feed(L, ['One night he heard a voice beneath the waves, and suddenly he rowed out past the rocks.'], t0=1005)
        self.assertEqual(self.state(s, 't1')['state'], 'ready'); self.assertEqual(self.state(s, 't1')['need'], 'needs an ending')
        self.assertEqual(s['arc']['current'], 'complication')
        s = self.feed(L, ['At last he carried the lantern home, and from then on his nets were never empty.'], t0=1010)
        self.assertEqual(self.state(s, 't1')['state'], 'closed')

    def test_dormant_by_other_talk_and_returned(self):
        L = steer.Ledger('s1')
        self.feed(L, ['The garden needs water and the roses need pruning this week.'], topic='garden', form='instruction')
        s = self.feed(L, ['Galaxies drift apart as the universe expands. ' * 3] * 6, t0=1010, topic='space', form='cosmology')
        self.assertEqual(self.state(s, 'garden')['state'], 'dormant')
        s = self.feed(L, ['Back to the garden: the roses need pruning before the frost.'], t0=1040, topic='garden', form='instruction')
        self.assertEqual(self.state(s, 'garden')['returns'], 1)
        self.assertIn(self.state(s, 'garden')['state'], ('returned', 'ready'))

    def test_questions_speakers_and_airtime(self):
        L = steer.Ledger('s1')
        self.feed(L, ['Where were you yesterday?'], speaker='A', topic='q')
        s = self.feed(L, ['I was at the shop buying milk.'], t0=1005, speaker='B', topic='q')
        q = s['talk']['questions'][0]
        self.assertEqual((q['speaker'], q['answered_by']), ('A', 'B'))
        s = self.feed(L, ['Did you see the new bridge?'], t0=1010, speaker='C', topic='bridge')
        self.assertEqual(s['talk']['open'], 1); self.assertEqual(set(s['talk']['airtime']), {'A', 'B', 'C'})

    def test_a_thread_is_picked_up_in_a_later_recording(self):
        L = steer.Ledger('first')
        s = self.feed(L, ['My grandmother kept bees in the orchard behind the farmhouse.'], topic='bees')
        steer.index_add(s['threads'], card='2026-09-30 card', session='first', when=time.time() - 86400)
        L2 = steer.Ledger('second')
        s2 = self.feed(L2, ['The bees in the orchard were my grandmother\'s pride.'], topic='bees2')
        link = self.state(s2, 'bees2')['link']
        self.assertTrue(link and link['card'] == '2026-09-30 card'); self.assertIn('orchard', link['shared'])

    def test_racing_cues_a_pause(self):
        L = steer.Ledger('s1')
        s = self.feed(L, ['and then we went to the shop and then to the park and then home again and then out'] * 4, step=1)
        self.assertEqual(s['hold']['cue']['type'], 'pause')
        self.assertEqual(steer.next_move(s)['id'], 'hold')

class Engine(unittest.TestCase):
    def test_every_phrase_carries_depth_and_threads(self):
        try:
            from sentence_transformers import SentenceTransformer
            model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', cache_folder=str(ROOT / 'models'), local_files_only=True)
        except Exception as e:
            self.skipTest('no model: ' + str(e)[:80])
        from engine import Engine as E
        e = E(model)
        for line in ['Once there was a girl who lived by the river.', 'One morning she found a boat tied to the old post.']:
            ev = e.ingest(line, source='Test')
        self.assertEqual(ev['why']['depth']['kind'], ev['form'])
        self.assertTrue(ev['why']['steer']['threads'])
        r = e.read_passage('The point of all of this is simple. Libraries return more than they cost. Therefore we should fund them.')
        self.assertEqual(r['depth']['kind'], 'argument')
        self.assertEqual(len(e.state['events']), 2)          # the passage was read without touching the live session

if __name__ == '__main__':
    unittest.main()
