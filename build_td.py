"""Run inside the TouchDesigner Textport: exec(open('/absolute/path/build_td.py').read())."""
import sys,os,json,importlib
ROOT=str(__import__('pathlib').Path(__file__).resolve().parent)
for p in [ROOT,ROOT+'/.venv/lib/python3.11/site-packages']:
 if p not in sys.path:sys.path.append(p)
import td_runtime,render
importlib.reload(td_runtime);importlib.reload(render)
b=op('/project1/speech_gates') or op('/project1').create(baseCOMP,'speech_gates')
# Rebuild this instrument's generated operators only.
for n in b.children:
 if n.valid:n.destroy()
for page in list(b.customPages):page.destroy()
p=b.appendCustomPage('Intake')
p.appendToggle('Microphone',label='Start microphone')[0].default=False
p.appendMenu('Speaker',label='Current speaker')[0].menuNames=['A','B'];b.par.Speaker.menuLabels=['Speaker A','Speaker B']
p.appendFile('Recording',label='Audio recording')
p.appendPulse('Transcribe',label='Transcribe recording')
p.appendStr('Thought',label='Send a thought')[0].default='Looking back, I remember how stories taught me to listen.'
p.appendPulse('Send',label='Send thought')
p.appendMenu('Form',label='Speech form override')[0].menuNames=['auto']+list(td_runtime.FORMS);b.par.Form.menuLabels=['Automatic']+[k.capitalize() for k in td_runtime.FORMS]
p=b.appendCustomPage('Worlds')
p.appendMenu('World',label='Visual world')[0].menuNames=['auto']+td_runtime.WORLDS;b.par.World.menuLabels=['Follow speech']+[x.capitalize() for x in td_runtime.WORLDS]
p.appendToggle('Light',label='Light palette')
p.appendPulse('View',label='Open instrument viewer')
p.appendPulse('Rehearsal',label='Run example speech')
p.appendPulse('Stoprehearsal',label='Stop example speech')
p=b.appendCustomPage('Session')
p.appendPulse('Export',label='Export transcript and scrolls')
p.appendPulse('Newsession',label='Start a new session')
p.appendPulse('Restartworker',label='Restart AI worker')
p.appendPulse('Saveproject',label='Save TouchDesigner project')
a=b.create(audiodeviceinCHOP,'microphone');a.par.active=False;a.par.rate=44100;a.nodeX=-900;a.nodeY=200
for i,name in enumerate(['state','utterances','ideas']):
 n=b.create(textDAT if name=='state' else tableDAT,name);n.nodeX=-600;n.nodeY=200-i*150
controls=b.create(constantCHOP,'controls');controls.nodeX=-300;controls.nodeY=210
for i,name in enumerate(['audio_rms','world','idea_count','radar_distance','speaker_balance','point_found']):
 controls.par['name'+str(i)]=name;controls.par['value'+str(i)]=0
frame=b.create(executeDAT,'frame_clock');frame.par.frameend=True;frame.par.start=True
frame.text="""import sys
ROOT=project.folder
for p in [ROOT,ROOT+'/.venv/lib/python3.11/site-packages']:
 if p not in sys.path:sys.path.append(p)
import td_runtime
def onStart():
 td_runtime.start_worker()
 return
def onFrameEnd(frame):
 td_runtime.tick(parent(),frame)
 return
"""
frame.nodeX=-900;frame.nodeY=-100
pars=b.create(parameterexecuteDAT,'intake_actions');pars.par.op=b.path;pars.par.pars='*';pars.par.onpulse=True
pars.text="""import td_runtime
def onPulse(par):
 td_runtime.pulse(par)
 return
""";pars.nodeX=-900;pars.nodeY=-240
switch=b.create(switchTOP,'world_switch');switch.nodeX=480;switch.nodeY=150
for i,world in enumerate(td_runtime.WORLDS):
 n=b.create(scriptTOP,world);n.nodeX=0;n.nodeY=200-i*140;n.par.resolutionw=1280;n.par.resolutionh=720
 cb=n.par.callbacks.eval();cb.text="""import render,td_runtime
def onCook(scriptOp):
 scriptOp.copyNumpyArray(render.draw(td_runtime.STATE,scriptOp.name,absTime.seconds,bool(parent().par.Light),td_runtime.level,td_runtime.plate,bool(parent().par.Microphone)))
 return
""";cb.nodeX=200;cb.nodeY=n.nodeY
 switch.inputConnectors[i].connect(n) if i<len(switch.inputConnectors) else n.outputConnectors[0].connect(switch)
final=b.create(nullTOP,'final');final.inputConnectors[0].connect(switch);final.nodeX=720;final.nodeY=150;final.viewer=True
out=b.create(outTOP,'out1');out.inputConnectors[0].connect(final);out.nodeX=940;out.nodeY=150
b.par.opviewer=final.path
b.nodeX=50;b.nodeY=-380;b.viewer=True
# Keep AI work in a separate process so model inference cannot stall rendering.
td_runtime.start_worker()
b.save(ROOT+'/Speech Gates.tox')
project.save(ROOT+'/Speech Gates.toe')
print('Built Speech Gates',len(b.children),'operators')
