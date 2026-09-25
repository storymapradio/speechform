"""Seven independently addressable TouchDesigner Script TOP visual worlds."""
from PIL import Image,ImageDraw,ImageFont
import numpy as np
import math,time,textwrap
from catalog import COLORS,WORLDS,FORMS
FONT='/System/Library/Fonts/Avenir Next.ttc';MONO='/System/Library/Fonts/Menlo.ttc'
fonts={}
def font(n,mono=False):
 key=(n,mono)
 if key not in fonts:fonts[key]=ImageFont.truetype(MONO if mono else FONT,n)
 return fonts[key]
def rgb(h):return tuple(int(h[i:i+2],16) for i in (1,3,5))
def mix(a,b,t):return tuple(int(x*(1-t)+y*t) for x,y in zip(a,b))
def draw(state,world,seconds,light=False,level=0,plate=.5,mic=False):
 W,H=1280,720;bg=(240,242,229) if light else (7,15,17);fg=(24,47,41) if light else (232,244,232);muted=(75,96,83) if light else (116,145,137);line=(165,186,165) if light else (32,65,54)
 colors=[rgb(x) for x in COLORS]
 if light:colors=[mix(c,(0,65,43),.48) for c in colors]
 form=state.get('form','thinking aloud');variant=list(FORMS).index(form) if form in FORMS else 0
 accent=mix(colors[WORLDS.index(world)],colors[variant%7],.38);im=Image.new('RGBA',(W,H),bg+(255,));d=ImageDraw.Draw(im)
 def txt(x,y,s,size=16,color=None,mono=False):d.text((x,y),str(s),font=font(size,mono),fill=color or fg)
 def path(points,color,width=2):
  if len(points)>1:d.line(points,fill=color,width=width,joint='curve')
 def dot(x,y,r,c):d.ellipse((x-r,y-r,x+r,y+r),fill=c)
 def wrap(s,width=70,limit=4):return textwrap.wrap(s,width=width,break_long_words=True)[:limit]
 d.rounded_rectangle((14,14,W-15,H-15),radius=24,outline=(57,255,20) if not light else (46,129,42),width=2)
 txt(40,32,'Ω',42,accent);txt(97,32,'SPEECH GATES',25);txt(99,65,'AN ORAL LEARNING INSTRUMENT',10,muted,True)
 source=state.get('source','Ready');status='MIC LIVE' if mic else source.upper()
 dot(988,47,4,accent);txt(1002,38,status[:24],12,accent,True)
 txt(989,60,'LOCAL AI  /  FIRST PASS',10,muted,True)
 d.line((38,99,1242,99),fill=line)
 form=state.get('form','thinking aloud');txt(40,114,form.capitalize(),31,accent)
 titles={'blocks':'Words become a city.','seaweed':'Ideas grow, and find their way back.','scrolls':'Four places to continue a thought.','nodes':'A world takes shape between ideas.','radar':'A thought approaches its point.','plates':'A conversation moves the ground.','ribbons':'The voice leaves a living trace.'}
 txt(41,156,titles[world],16,muted)
 scores=state.get('scores',[])
 for i,s in enumerate(scores[:3]):
  x=720+i*171;txt(x,121,s['form'].upper()[:20],10,muted,True)
  v=max(0,min(1,s['similarity']));d.rounded_rectangle((x,143,x+145,146),radius=1,fill=line);d.rounded_rectangle((x,143,x+max(2,145*v),146),radius=1,fill=accent)
  txt(x,153,f"{s['similarity']:.2f} similarity",10,muted,True)
 topics=state.get('topics',[]);events=state.get('events',[]);active=state.get('active_topic');lookup={e['id']:e for e in events}
 if world=='blocks':
  items=sorted(state.get('words',{}).items(),key=lambda x:-x[1]);items=[(w,c) for w,c in items if len(w)>2][:20]
  for j,(word,count) in enumerate(items):
   x=78+(j%10)*119;y=390+(j//10)*158
   for k in range(min(count,8)):
    by=y-k*18;sz=26;col=mix(accent,bg,.15+min(k*.045,.5));d.polygon([(x,by),(x+sz,by-12),(x+sz*2,by),(x+sz,by+12)],outline=col,fill=mix(col,bg,.78));d.polygon([(x,by),(x+sz,by+12),(x+sz,by+39),(x,by+27)],outline=col,fill=mix(col,bg,.92));d.polygon([(x+sz,by+12),(x+sz*2,by),(x+sz*2,by+27),(x+sz,by+39)],outline=col)
   txt(x-3,y+45,word[:13],13);txt(x,y+66,f'{count} occurrence'+('s' if count!=1 else ''),9,muted,True)
  txt(42,197,'WORD FREQUENCY / EACH BOX IS ONE OCCURRENCE / STACKS DISPLAY UP TO EIGHT',10,muted,True)
 elif world=='seaweed':
  path([(x,540+int(((x-640)/600)**2*34)) for x in range(62,1219,4)],line,2)
  shown=topics[-14:]
  for i,t in enumerate(shown):
   x=95+i*(1080/max(1,len(shown)-1));base=540+int(((x-640)/600)**2*34);height=min(335,55+t['words']*2.1);col=colors[topics.index(t)%7];pts=[]
   for k in range(80):
    q=k/79;y=base-height*q;sway=math.sin(q*(6 if form=='reflective monologue' else 10)+seconds*.7+i)*q*(20 if form=='reflective monologue' else 33);pts.append((x+sway,y))
   path(pts,col,4 if t['id']==active else 2)
   for k in range(10,76,10):
    px,py=pts[k];side=1 if k%20 else -1;d.arc((px-24,py-25,px+24,py+14),0 if side==1 else 180,150 if side==1 else 340,fill=col,width=2)
   px,py=pts[-1];dot(px,py,5 if t['id']==active else 3,col)
   txt(max(45,min(x-30,1080)),base+9,t['title'][:17],10,col)
   if t['returns']:txt(x-24,base+25,f"{t['returns']} returns",10,muted)
  txt(42,197,f'{len(topics)} IDEAS / BRANCH LENGTH FOLLOWS WORD COUNT / RETURNING RESUMES GROWTH',10,muted,True)
 elif world=='scrolls':
  shown=sorted(topics,key=lambda t:t['updated'],reverse=True)[:4];shown.reverse()
  for i in range(4):
   x=40+i*303;t=shown[i] if i<len(shown) else None;col=colors[topics.index(t)%7] if t else line
   d.rounded_rectangle((x,221,x+288,597),radius=13,fill=mix(bg,col,.055),outline=col,width=2 if t and t['id']==active else 1)
   txt(x+16,236,f'SCROLL {i+1:02}',11,col,True)
   if t:
    txt(x+16,260,t['title'][:26],15)
    content=' '.join(lookup[k]['text'] for k in t['events'] if k in lookup);lines=wrap(content,31,999)
    for j,l in enumerate(lines[-12:]):txt(x+16,295+j*21,l,13,fg)
    txt(x+16,571,f"{t['words']} words · {t['returns']} returns",10,muted,True)
   else:txt(x+16,295,'A new idea will find a place here.',13,muted)
 elif world=='nodes':
  shown=topics[-22:];positions={}
  for i,t in enumerate(shown):
   angle=i*2.39996+seconds*.012;r=60+math.sqrt(i)*43
   if form=='scenery':positions[t['id']]=(120+(i%7)*170,330+(i//7)*100+math.sin(i)*30)
   elif form=='story':positions[t['id']]=(120+(i%8)*145,320+(i//8)*90+math.sin(i*.7)*45)
   elif form in ['myth','lore']:positions[t['id']]=(640+math.cos(i*math.pi/3)*(90+(i//6)*65)*1.5,409+math.sin(i*math.pi/3)*(90+(i//6)*65))
   elif form=='cosmology':positions[t['id']]=(640+math.cos(angle+seconds*.04/(i+1))*r*1.7,408+math.sin(angle+seconds*.04/(i+1))*r*.7)
   else:positions[t['id']]=(640+math.cos(angle)*r*1.7,408+math.sin(angle)*r*.7)
  for a,b in zip(events,events[1:]):
   if a['topic']!=b['topic'] and a['topic'] in positions and b['topic'] in positions:path([positions[a['topic']],positions[b['topic']]],line,1)
  for i,t in enumerate(shown):
   x,y=positions[t['id']];col=colors[topics.index(t)%7];r=12+min(20,math.sqrt(t['words'])*2)
   poly=[(x+math.cos(k*math.pi/3)*r,y+math.sin(k*math.pi/3)*r) for k in range(6)]
   d.polygon(poly,fill=mix(col,bg,.90),outline=col,width=3 if t['id']==active else 1);txt(x+r+10,y-9,t['title'][:28],12,col)
  txt(42,197,'IDEAS BECOME NODES / EDGES RECORD MOVEMENT BETWEEN THEM',10,muted,True)
 elif world=='radar':
  cx,cy,r=640,415,173
  for ring in range(1,5):
   rr=r*ring/4;d.ellipse((cx-rr,cy-rr,cx+rr,cy+rr),outline=line,width=1)
  d.line((cx-r,cy,cx+r,cy),fill=line);d.line((cx,cy-r,cx,cy+r),fill=line)
  angle=seconds*.6;path([(cx,cy),(cx+math.cos(angle)*r,cy+math.sin(angle)*r)],accent,2)
  pulse=time.time()-state.get('conclusion_at',0)<7;radius=state.get('radius',.85)*r
  dx=cx+math.cos(seconds*.08+1)*radius;dy=cy+math.sin(seconds*.08+1)*radius
  dot(dx,dy,7,accent);dot(cx,cy,7 if pulse and int(seconds*4)%2 else 3,accent)
  txt(855,325,'POINT FOUND' if pulse else 'FOLLOWING THE THREAD',16,accent)
  for j,l in enumerate(wrap('The point of all of this is…' if pulse else 'Distance compares this thought with the opening idea. A spoken conclusion brings it home.',36,4)):txt(855,360+j*23,l,14,muted)
  txt(42,197,'SEMANTIC DISTANCE / AN EXPLICIT CONCLUSION LIGHTS THE CENTER',10,muted,True)
 elif world=='plates':
  boundary=360+plate*560;ya=411;yb=433
  d.polygon([(60,ya-30),(boundary-35,ya-12),(boundary+195,ya+105),(80,ya+133)],fill=mix(colors[0],bg,.78),outline=colors[0],width=2)
  d.polygon([(boundary-50,yb-30),(1200,yb-68),(1190,yb+80),(boundary+200,yb+101)],fill=mix(colors[1],bg,.68),outline=colors[1],width=2)
  for k in range(5):
   path([(90,ya+15+k*20),(boundary-22,ya+30+k*10),(boundary+110,ya+90)],mix(colors[0],bg,.4),1)
   path([(boundary+70,yb+k*15),(1170,yb-22+k*20)],mix(colors[1],bg,.35),1)
  txt(86,292,'SPEAKER A',18,colors[0]);txt(1000,292,'SPEAKER B',18,colors[1]);txt(88,324,f"{state.get('dialogue_words',{}).get('A',0)} words",13,muted);txt(1000,324,f"{state.get('dialogue_words',{}).get('B',0)} words",13,muted)
  txt(42,197,'SPEAKING SHARE / A 25-SECOND DRIFT / SPEAKER LABELS ARE SELECTED AT INPUT',10,muted,True)
 elif world=='ribbons':
  for k in range(11):
   pts=[];col=mix(colors[k%7],bg,.25+k*.035)
   for x in range(52,1228,4):
    q=(x-52)/1176;envelope=math.sin(q*math.pi);amp=(23+level*80+len(events)%7*3)*envelope
    y=370+k*11+math.sin(q*math.pi*(3+variant%6)+seconds*.6+k*.2)*amp+math.sin(q*17-seconds*.3)*13
    pts.append((x,y))
   path(pts,col,2)
  txt(42,197,'VOCAL ENERGY / RHYTHMIC TRACES / LANGUAGE SHAPES THE PALETTE',10,muted,True)
  recent=events[-1]['text'] if events else 'Speak a line and let it find its rhythm.'
  for j,l in enumerate(wrap(recent,95,2)):txt(150,536+j*23,l,17,accent)
 if not events and world!='scrolls':
  txt(421,373,'Every thought can leave a trace.',23,muted)
 # Transition between forms is an expanding omega portal, preserving each world's state.
 age=time.time()-state.get('gate_at',0)
 if 0<=age<2.6:
  alpha=max(0,1-age/2.6);overlay=Image.new('RGBA',(W,H));od=ImageDraw.Draw(overlay);s=170+age*290;cx,cy=640,397
  od.arc((cx-s*.5,cy-s*.55,cx+s*.5,cy+s*.45),145,395,fill=accent+(int(200*alpha),),width=8)
  od.line([(cx-s*.41,cy+s*.23),(cx-s*.57,cy+s*.23)],fill=accent+(int(220*alpha),),width=8);od.line([(cx+s*.41,cy+s*.23),(cx+s*.57,cy+s*.23)],fill=accent+(int(220*alpha),),width=8)
  im=Image.alpha_composite(im,overlay);d=ImageDraw.Draw(im)
 d.line((38,626,1242,626),fill=line)
 latest=events[-1]['text'] if events else 'Start the microphone, choose a recording, or send a thought from the Intake controls.'
 if state.get('error'):latest=state['error']
 txt(40,639,latest[:141],13,fg)
 txt(40,674,f"{len(events):03} utterances  ·  {len(topics):02} ideas  ·  {world.upper()}",10,muted,True)
 status=state.get('status','Ready.');txt(740,674,status[:62],10,accent,True)
 return np.ascontiguousarray(np.flipud(np.array(im,dtype=np.float32)/255.0))
