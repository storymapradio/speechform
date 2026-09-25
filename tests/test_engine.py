import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sentence_transformers import SentenceTransformer
from engine import Engine
ROOT=Path(__file__).resolve().parents[1]
class RoutingTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.model=SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2',cache_folder=str(ROOT/'models'),local_files_only=True)
 def setUp(self):self.e=Engine(self.model)
 def test_repeated_words_and_dedup(self):
  self.e.ingest('Seeds grow. Seeds grow in gardens.',event_id='one');self.e.ingest('Seeds grow. Seeds grow in gardens.',event_id='one')
  self.assertEqual(self.e.state['words']['seeds'],2);self.assertEqual(len(self.e.state['events']),1)
 def test_returning_to_an_idea(self):
  a=self.e.ingest('Looking back, I remember how my grandmother taught me to listen. Her stories made me feel at home.')
  self.e.ingest('Galaxies formed in an expanding universe. Dark matter shapes the structure of the cosmos.')
  c=self.e.ingest('Returning to my grandmother and her stories, I realize that listening to her was how I learned to belong.')
  self.assertEqual(a['topic'],c['topic']);self.assertEqual(len(self.e.state['topics']),2)
 def test_conclusion_and_speaker_share(self):
  self.e.ingest('The point of all of this is that we learn by listening.',speaker='B')
  self.assertEqual(self.e.state['radius'],0);self.assertGreater(self.e.state['conclusion_at'],0);self.assertGreater(self.e.state['speaker_words']['B'],0)
 def test_reassignment_preserves_text(self):
  a=self.e.ingest('Seeds need water.');b=self.e.ingest('Galaxies expand through the universe.')
  self.e.reassign(a['id'],b['topic']);self.assertEqual(self.e.state['events'][0]['text'],'Seeds need water.')
 def test_form_override(self):
  self.e.ingest('We look at the trees.',form_override='myth');self.assertEqual(self.e.state['form'],'myth');self.assertEqual(self.e.state['world'],'nodes')
if __name__=='__main__':unittest.main()
