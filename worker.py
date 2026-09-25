"""Background AI worker. The render thread exchanges atomic local files only."""
import os,json,time,traceback,uuid,threading,queue,fcntl,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY','1')
os.environ.setdefault('TOKENIZERS_PARALLELISM','false')
os.environ.setdefault('HF_HUB_OFFLINE','1')
RUNTIME=ROOT/'runtime';INBOX=RUNTIME/'inbox';SESSIONS=ROOT/'sessions'
for p in [INBOX,SESSIONS]:p.mkdir(parents=True,exist_ok=True)
def atomic(path,obj):
 temp=path.with_suffix('.tmp');temp.write_text(json.dumps(obj,ensure_ascii=False));temp.replace(path)
def main():
 lock=open(RUNTIME/'worker.lock','w')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 from sentence_transformers import SentenceTransformer
 from engine import Engine
 from catalog import REHEARSAL
 if not (RUNTIME/'state.json').exists():atomic(RUNTIME/'state.json',{'status':'Loading the local language model.','processing':True,'error':''})
 model=SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2',cache_folder=str(ROOT/'models'),local_files_only=True)
 engine=Engine(model)
 # Resume the last saved session, including exact stable idea IDs and assignments.
 try:
  previous=json.loads((RUNTIME/'state.json').read_text())
  if previous.get('session') and previous.get('events'):
   import numpy as np
   engine.state=previous;engine.seen={e['id'] for e in previous['events']}
   byid={e['id']:e for e in previous['events']}
   for topic in previous['topics']:
    texts=[byid[i]['text'] for i in topic['events'] if i in byid]
    if texts:
     vector=np.mean(model.encode(texts,normalize_embeddings=True),axis=0)
     engine.vectors[topic['id']]=vector/(np.linalg.norm(vector)+1e-9)
   engine.state.update(processing=False,error='',status='Your session is ready to continue.')
 except (OSError,ValueError,KeyError):pass
 last_save=0;rehearsal=None;tasks=queue.Queue()
 def save():
  engine.state['heartbeat']=time.time();engine.state['queue_depth']=tasks.qsize()
  atomic(RUNTIME/'state.json',engine.state)
  atomic(SESSIONS/(engine.state['session']+'.json'),engine.state)
 def scan():
  while True:
   for p in sorted(INBOX.glob('*.json')):
    try:command=json.loads(p.read_text());p.unlink();tasks.put(command)
    except Exception:pass
   time.sleep(.1)
 threading.Thread(target=scan,daemon=True).start()
 save()
 while True:
  try:
   if rehearsal and time.time()>=rehearsal[1]:
    i=rehearsal[0];speaker,text=REHEARSAL[i]
    engine.ingest(text,speaker,'Rehearsal');save()
    rehearsal=(i+1,time.time()+7) if i+1<len(REHEARSAL) else None
   try:c=tasks.get(timeout=.15)
   except queue.Empty:
    if time.time()-last_save>1:save();last_save=time.time()
    continue
   action=c.get('action');speaker=c.get('speaker','A')
   if action=='text':engine.ingest(c.get('text',''),speaker,c.get('source','Typed'),c.get('id'),form_override=c.get('form'))
   elif action=='rehearsal':rehearsal=(0,time.time())
   elif action=='stop_rehearsal':rehearsal=None
   elif action=='reset':
    save();engine.reset();rehearsal=None
   elif action=='reassign':engine.reassign(c['event'],c['topic'])
   elif action=='audio':
    engine.state.update(processing=True,status='Transcribing audio locally.',error='');save()
    path=Path(c['path']).expanduser().resolve()
    if not path.is_file():raise ValueError('The selected recording could not be found.')
    count=0
    proc=subprocess.Popen([str(ROOT/'bin'/'transcribe'),str(path)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    # Apple emits finalized segments; each segment is committed once.
    for line in proc.stdout:
     result=json.loads(line)
     if 'error' in result:raise RuntimeError(result['error'])
     if 'status' in result:engine.state['status']=result['status'];save()
     if result.get('text','').strip():
      engine.ingest(result['text'],speaker,c.get('source','Recording'),str(c.get('id','audio'))+':'+str(count),start=result.get('start'),end=result.get('end'))
      count+=1;save()
    proc.wait(timeout=120)
    if proc.returncode:raise RuntimeError(proc.stderr.read()[-500:] or 'Apple transcription could not finish.')
    engine.state.update(processing=False,status='Following your speech.' if count else 'Audio received. Waiting for clear speech.')
   elif action=='export':
    events=engine.state['events'];topics=engine.state['topics'];byid={e['id']:e for e in events}
    lines=['SPEECH GATES / SESSION',engine.state['session'],'','CHRONOLOGICAL TRANSCRIPT','']
    lines += [e['speaker']+': '+e['text'] for e in events]
    lines+=['','IDEA SCROLLS','']
    for t in topics:
     lines+=[t['title']]+[byid[x]['speaker']+': '+byid[x]['text'] for x in t['events']]+['']
    out=SESSIONS/(engine.state['session']+'.txt');out.write_text('\n'.join(lines))
    engine.state['status']='Exported the transcript and idea scrolls.'
   save()
  except Exception as exc:
   engine.state.update(error=str(exc),processing=False,status='Input needs attention.');save();traceback.print_exc()
if __name__=='__main__':main()
