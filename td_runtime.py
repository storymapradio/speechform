"""TouchDesigner main-thread glue. Audio intake and controllable native operators."""
import json,time,uuid,subprocess,wave,os
from pathlib import Path
import numpy as np
from catalog import WORLDS,FORMS
import native_controls
ROOT=Path(__file__).resolve().parent
STATE={};mtime=0;last_frame=-1;configured=False;chunks=[];samples=0;level=0.;plate=.5;previous_mic=False;last_audio=0;audio_speaker='A';worker=None;panel_stamp=0;view_stamp=0;tick_time=time.monotonic()
try:view_stamp=(ROOT/'runtime/view.json').stat().st_mtime
except OSError:pass

def command(action,**kw):
 p=ROOT/'runtime'/'inbox'/(f'{time.time_ns()}-'+str(uuid.uuid4())+'.json');p.parent.mkdir(parents=True,exist_ok=True)
 temp=p.with_suffix('.tmp');temp.write_text(json.dumps(dict(action=action,id=str(uuid.uuid4()),**kw)));temp.replace(p)
def start_worker():
 global worker
 if worker is not None and worker.poll() is None:return
 log=open(ROOT/'runtime'/'worker.log','a');worker=subprocess.Popen([str(ROOT/'.worker/bin/python'),str(ROOT/'worker.py')],cwd=str(ROOT),stdout=log,stderr=log,start_new_session=True)
def flush_audio(b):
 global chunks,samples,last_audio
 if not chunks:return
 audio=np.concatenate(chunks);chunks=[];samples=0
 if np.sqrt(np.mean(audio*audio))<.002:return
 path=ROOT/'runtime'/('mic-'+str(time.time_ns())+'.wav')
 with wave.open(str(path),'wb') as f:
  f.setnchannels(1);f.setsampwidth(2);f.setframerate(44100);f.writeframes((np.clip(audio,-1,1)*32767).astype('<i2').tobytes())
 command('audio',path=str(path),speaker=audio_speaker,source='Microphone');last_audio=time.time()
DIRECTION={};direction_stamp=0
def read_direction():
 """Jev's (or the stand-in director's) latest word on the loom: runtime/direction.json"""
 global DIRECTION,direction_stamp
 p=ROOT/'runtime'/'direction.json'
 try:
  stamp=p.stat().st_mtime
  if stamp!=direction_stamp:DIRECTION=json.loads(p.read_text());direction_stamp=stamp
 except (OSError,ValueError):pass
def configure():
 """How Speechform runs TouchDesigner, applied at every start so it never depends on a saved project:
 thirty frames a second, the first pass's own visuals switched off (Speechform draws with the loom),
 and one small window showing only the image, in perform mode, so the node editor is not drawn."""
 global configured,view_stamp
 import td
 configured=True
 try:view_stamp=(ROOT/'runtime/view.json').stat().st_mtime
 except OSError:pass
 td.project.cookRate=30
 sg=td.op('/project1/speech_gates')
 if sg and sg.op('modules'):sg.op('modules').allowCooking=False
 if sg and sg.op('native_hud'):sg.op('native_hud').bypass=True
 if sg and sg.op('final'):
  try:sg.op('final').closeViewer()
  except Exception:pass
 for n in ('/project1/geo1',):
  o=td.op(n)
  if o is not None and o.isCOMP:o.allowCooking=False
 w=td.op('/perform'); L=td.op('/project1/loom')
 if w is not None and L is not None:
  w.par.winop='/project1/loom/out';w.par.title='Speechform'
  if 'custom' in w.par.size.menuNames:w.par.size='custom'
  w.par.winw=320;w.par.winh=320;w.par.justifyh='right';w.par.justifyv='bottom';w.par.winoffsetx=-24;w.par.winoffsety=24
  w.par.borders=True
  td.ui.performMode=True
def ensure_loom():
 """The loom lives in imagery/loom.tox. If the open project does not hold it, it is brought in,
 so the images never depend on the whole project having been saved."""
 import td,sys
 p=str(ROOT/'imagery')
 if p not in sys.path:sys.path.insert(0,p)
 if td.op('/project1/loom') is None and (ROOT/'imagery'/'loom.tox').exists():
  L=td.op('/project1').loadTox(str(ROOT/'imagery'/'loom.tox'));L.name='loom';L.nodeX,L.nodeY=0,-600
EXEC=ROOT/'runtime'/'exec'
def run_inbox():
 """A build channel on the main thread: runtime/exec/<name>.py runs once, its `result` goes to <name>.out."""
 import td,traceback
 try:jobs=sorted(EXEC.glob('*.py'))
 except OSError:return
 for job in jobs[:3]:
  g={'op':td.op,'project':td.project,'td':td,'ui':td.ui,'me':None,'result':None}
  try:
   exec(compile(job.read_text(),str(job),'exec'),g);out=json.dumps({'ok':True,'result':g.get('result')},default=str)
  except Exception:out=json.dumps({'ok':False,'error':traceback.format_exc()})
  tmp=job.with_suffix('.tmp');tmp.write_text(out);tmp.replace(job.with_suffix('.out'))
  try:job.unlink()
  except OSError:pass
def tick(b,frame):
 global STATE,mtime,last_frame,chunks,samples,level,plate,previous_mic,audio_speaker,panel_stamp,view_stamp,tick_time
 if frame==last_frame:return
 last_frame=frame
 if frame%3==0:run_inbox()
 if frame%30==0:ensure_loom()
 if not configured and frame%30==15 and __import__('td').op('/project1/loom') is not None:configure()
 mic=bool(b.par.Microphone.eval());a=b.op('microphone');a.par.active=mic
 if mic:
  a.cook(force=True);data=a.numpyArray()
  if data is not None and data.size:
   mono=np.mean(data,axis=0).astype(np.float32);level=.75*level+.25*float(np.sqrt(np.mean(mono*mono)))
   speaker=b.par.Speaker.eval()
   if audio_speaker!=speaker:flush_audio(b)
   audio_speaker=speaker;chunks.append(mono.copy());samples+=mono.size
   if samples>=44100*6:flush_audio(b)
 else:
  level*=.93
  if previous_mic:flush_audio(b)
 previous_mic=mic
 if frame%6==0:
  panel=ROOT/'runtime/panel.json'
  try:
   stamp=panel.stat().st_mtime
   if stamp!=panel_stamp:
    config=json.loads(panel.read_text());panel_stamp=stamp
    for key,par in [('microphone','Microphone'),('speaker','Speaker'),('light','Light'),('world','World')]:
     if key in config:b.par[par]=config[key]
  except (OSError,ValueError):pass
  view=ROOT/'runtime/view.json'
  try:
   stamp=view.stat().st_mtime
   if stamp!=view_stamp:view_stamp=stamp;b.op('final').openViewer()
  except OSError:pass
  read_direction()
  path=ROOT/'runtime/state.json'
  try:
   stamp=path.stat().st_mtime
   if stamp!=mtime:STATE=json.loads(path.read_text());mtime=stamp
  except (OSError,ValueError):pass
  if time.time()-STATE.get('heartbeat',time.time())>12:STATE['status']='The AI worker needs a restart. Use Restart worker.'
  table=b.op('utterances');table.clear();table.appendRow(['id','speaker','form','topic','text'])
  for e in STATE.get('events',[])[-300:]:table.appendRow([e['id'],e['speaker'],e['form'],e['topic'],e['text']])
  topics=b.op('ideas');topics.clear();topics.appendRow(['id','title','words','returns'])
  for t in STATE.get('topics',[]):topics.appendRow([t['id'],t['title'],t['words'],t['returns']])
  st=b.op('state');st.text=json.dumps(STATE,ensure_ascii=False)
  if b.op('modules') is None or b.op('modules').allowCooking:native_controls.update(b,STATE)   # the first pass's visuals, only while they run
 dialogue={'A':0,'B':0}
 for event in STATE.get('events',[]):
  if event.get('form')=='dialogue':dialogue[event['speaker']]=dialogue.get(event['speaker'],0)+len(event['text'].split())
 STATE['dialogue_words']=dialogue
 total=sum(dialogue.values());target=dialogue['A']/max(total,1) if total else .5
 now=time.monotonic();dt=min(.2,now-tick_time);tick_time=now
 plate+=(target-plate)*(1-math_exp(-dt/25))
 world=b.par.World.eval()
 if world=='auto':world=STATE.get('world','scrolls')
 b.op('world_switch').par.index=WORLDS.index(world) if world in WORLDS else 2
 channels=b.op('controls')
 values=[level,float(WORLDS.index(world)),len(STATE.get('topics',[])),STATE.get('radius',.85),target,float(time.time()-STATE.get('conclusion_at',0)<7)]
 for i,val in enumerate(values):channels.par['value'+str(i)]=val

def math_exp(x):
 import math
 return math.exp(x)
def pulse(par):
 b=par.owner;n=par.name
 if n=='Send':command('text',text=b.par.Thought.eval(),speaker=b.par.Speaker.eval(),form=None if b.par.Form.eval()=='auto' else b.par.Form.eval())
 elif n=='Transcribe':command('audio',path=b.par.Recording.eval(),speaker=b.par.Speaker.eval(),source='Recording')
 elif n=='Rehearsal':command('rehearsal')
 elif n=='Stoprehearsal':command('stop_rehearsal')
 elif n=='Export':command('export')
 elif n=='Newsession':
  b.par.Microphone=False;flush_audio(b);command('reset')
 elif n=='Restartworker':start_worker()
 elif n=='View':b.op('final').openViewer()
 elif n=='Saveproject':
  import td
  b.save(str(ROOT/'Speech Gates.tox'));td.project.save(str(ROOT/'Speech Gates.toe'))
