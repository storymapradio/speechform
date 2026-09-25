"""Map AI assessment into native operator parameters and instance tables only."""
import math,time,textwrap
from catalog import FORMS,WORLDS
COLORS=[(.3,.95,.65),(.59,.67,1),(.95,.8,.4),(.95,.42,.65),(.3,.85,1),(.95,.58,.3),(.7,.95,.4)]
last_revision=None

def update(b,state):
 global last_revision
 modules=b.op('modules')
 if not modules:return
 events=state.get('events',[]);topics=state.get('topics',[])
 form=state.get('form','thinking aloud');rev=(state.get('session'),state.get('revision'),bool(b.par.Light))
 b.op('native_subtitle').par.text=form.capitalize()+'  /  '+str(len(topics))+' living ideas'
 b.op('native_status').par.text=('MIC LIVE' if b.par.Microphone else state.get('source','Ready').upper())+'  |  APPLE SPEECH + LOCAL AI'
 latest=events[-1]['text'] if events else 'Start the microphone, choose a recording, or send a thought.'
 b.op('native_footer').par.text='\n'.join(textwrap.wrap(state.get('error') or latest,110)[:2])
 # The native omega mesh flies toward the camera, then clears the next scene.
 age=time.time()-state.get('gate_at',0);active=0<=age<2.6;progress=max(0,min(1,age/2.6))
 gate=modules.op('omega_passage')
 gate.op('gate_phosphor').par.alpha=(1-progress)**.55 if active else 0
 for g in [gate.op('omega_tube'),gate.op('foot_left'),gate.op('foot_right')]:
  g.par.render=active
  for ax in 'xyz':g.par['s'+ax]=.5+progress*4.3
 for side,name in [(-1,'foot_left'),(1,'foot_right')]:
  gate.op(name).par.tx=side*1.62*(.5+progress*4.3);gate.op(name).par.ty=-1.22*(.5+progress*4.3)
 if rev==last_revision:return
 last_revision=rev
 city=modules.op('word_city');table=city.op('word_instances');table.clear();table.appendRow(['x','y','z','r','g','b','scale'])
 ignore=set('the and that this with from were have there they which would into about'.split())
 words=sorted([(w,c) for w,c in state.get('words',{}).items() if len(w)>2 and w not in ignore],key=lambda x:-x[1])[:20]
 for i,(word,count) in enumerate(words):
  col=COLORS[i%7]
  for k in range(min(count,60)):
   table.appendRow([-5.7+(i%10)*1.27,-1.6+(k%12)*.37,(i//10)*2.5+(k//12)*.64,*col,1])
 city.op('word_legend').par.text='   '.join(f'{w}: {c}' for w,c in words[:10])+'\n'+'   '.join(f'{w}: {c}' for w,c in words[10:])
 garden=modules.op('idea_garden');visible=topics[-14:]
 for i in range(14):
  g=garden.op('idea_'+str(i+1).zfill(2));g.par.render=i<len(visible)
  if i>=len(visible):continue
  topic=visible[i];g.par.tx=-6.2+i*12.4/max(1,len(visible)-1) if len(visible)>1 else 0
  g.par.ty=-2.75+.55*math.sqrt(max(0,1-(g.par.tx.eval()/7)**2))
  grammar=g.op('branch_grammar');grammar.par.generations=3+min(10,topic['words']/10);grammar.par.stepinit=.16;grammar.par.angleinit=18+(i%4)*7
  grammar.par.thickinit=.075 if topic['id']==state.get('active_topic') else .042
  g.op('frond_curl').par.strength=9 if form=='reflective monologue' else 21
  g.par.rz=(i%3-1)*7
 scrolls=modules.op('four_scrolls');shown=sorted(topics,key=lambda t:t['updated'],reverse=True)[:4];shown.reverse();lookup={e['id']:e for e in events}
 for i in range(4):
  if i<len(shown):
   t=shown[i];body=' '.join(lookup[k]['text'] for k in t['events'] if k in lookup)
   lines=textwrap.wrap(body,35);content=f"SCROLL {i+1}  |  {t['words']} WORDS\n{t['title'].upper()}\n\n"+'\n'.join(lines[-22:])
  else:content=f'SCROLL {i+1}\n\nA new idea will find a place here.'
  scrolls.op('scroll_text_'+str(i+1)).par.text=content
 constellation=modules.op('narrative_constellation');tab=constellation.op('idea_instances');tab.clear();tab.appendRow(['x','y','z','r','g','b','scale'])
 shown=topics[-22:];positions={}
 for i,t in enumerate(shown):
  angle=i*2.39996;radius=.55+math.sqrt(i)*.66
  if form=='scenery':x=-5.7+(i%7)*1.9;y=.4-(i//7)*1.5+math.sin(i)*.5
  elif form=='story':x=-5.8+(i%8)*1.6;y=.3-(i//8)*1.3+math.sin(i*.7)*.6
  elif form in ['myth','lore']:x=math.cos(i*math.pi/3)*(1.2+i//6)*1.4;y=math.sin(i*math.pi/3)*(1.2+i//6)*.8-.3
  else:x=math.cos(angle)*radius*1.6;y=math.sin(angle)*radius*.85-.3
  positions[t['id']]=(x,y,0);col=COLORS[i%7];tab.appendRow([x,y,0,*col,1+min(2,math.sqrt(t['words'])/8)])
 points=constellation.op('relationship_points');points.clear();polys=constellation.op('relationship_polygons');polys.clear()
 seen=set()
 for a,c in zip(events,events[1:]):
  edge=(a['topic'],c['topic'])
  if edge[0]!=edge[1] and edge[0] in positions and edge[1] in positions and edge not in seen:
   seen.add(edge);n=points.numRows;points.appendRow(positions[edge[0]]);points.appendRow(positions[edge[1]]);polys.appendRow([f'{n} {n+1}'])
 # Textual form changes the native orbital architecture and ribbon proportions.
 for i in range(3):constellation.op('cosmic_orbit_'+str(i)).par.render=form in ['cosmology','myth','lore','character development']
 index=list(FORMS).index(form) if form in FORMS else 0
 ribbons=modules.op('vocal_ribbons')
 for i in range(12):ribbons.op('ribbon_'+str(i).zfill(2)+'/harmonic_motion').par.period=2.3+(index%6)*.5
