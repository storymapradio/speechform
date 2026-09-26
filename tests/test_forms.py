"""The classifier is tested on form, not topic: passages whose subjects differ from their kind's usual subject."""
import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]
from sentence_transformers import SentenceTransformer
from engine import Engine
from passages import PASSAGES

class FormTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.e = Engine(SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', cache_folder=str(ROOT / 'models'), local_files_only=True))

    def kind(self, text):
        return self.e.labels[int(self.e.classify(text)[1].argmax())]

    def test_whole_passages(self):
        right = sum(self.kind(t) == g for g, t in PASSAGES)
        self.assertGreaterEqual(right, 25, f'{right} of {len(PASSAGES)} passages')

    def test_reading_instructions_about_sound_is_instruction(self):
        # read aloud from a field-recording guide; the first classifier called it prosody
        self.assertEqual(self.kind(PASSAGES[0][1]), 'instruction')

    def test_a_passage_is_followed_across_fragments(self):
        e = Engine(self.e.model)
        for f in ['Field recording is a great way to become more sensitive to sounds.', 'Headphones tend to.',
                  'Listen both with and without headphones.', 'Try different placements of your microphone as well.']:
            last = e.ingest(f, source='Test')
        self.assertEqual(last['form'], 'instruction')

if __name__ == '__main__':
    unittest.main()
