"""Local semantic routing. Each phrase is heard within the last minute of talk; ideas keep stable identities; every decision keeps its reasons."""
import re, time, uuid, math
from collections import Counter
import numpy as np
from catalog import FORMS as CATALOG
from forms import KINDS, SIGNALS
from signals import signals
STOP=set('a an the this that these those is are was were be been being to of and or in on at for with as i you he she it we they my your our their me us them but if then so from by have has had do does did will would can could should just very all some about into how what when where which who its let not'.split())
def words(text): return re.findall(r"[\w]+(?:['’][\w]+)?",text.lower())
def keywords(text): return [w for w in words(text) if w not in STOP and len(w)>2]
def cos(a,b): return float(np.dot(a,b)/(np.linalg.norm(a)*np.linalg.norm(b)+1e-9))
class Engine:
 WINDOW_SECONDS=60;WINDOW_WORDS=60;RECENCY=16.0   # a phrase's weight halves roughly every 11 words back
 def __init__(self,model):
  self.model=model;self.labels=list(KINDS)
  # every example of every kind, and which kind it belongs to
  ex=[(k,t) for k in self.labels for t in KINDS[k][1]]
  self.examples=model.encode([t for _,t in ex],normalize_embeddings=True)
  self.owner=np.array([self.labels.index(k) for k,_ in ex])
  # some kinds sit close to almost anything; their pull on the other kinds' examples is measured once and taken off
  pull=np.zeros(len(self.labels))
  for i in range(len(self.labels)):
   others=self.examples[self.owner!=i]
   pull[i]=np.mean([self.kind_scores(v)[i] for v in others])
  self.bias=0.6*(pull-pull.mean())
  # the map of speech: each kind at the centre of its examples, laid flat by the two strongest directions
  self.prototypes=np.array([self.examples[self.owner==i].mean(axis=0) for i in range(len(self.labels))])
  self.prototypes/=np.linalg.norm(self.prototypes,axis=1,keepdims=True)
  self.mean=self.prototypes.mean(axis=0)
  _,_,vt=np.linalg.svd(self.prototypes-self.mean,full_matrices=False)
  self.axes=vt[:2]
  flat=(self.prototypes-self.mean)@self.axes.T
  self.scale=float(np.abs(flat).max()) or 1.0
  self.form_xy=[{'form':k,'x':round(float(x/self.scale),3),'y':round(float(y/self.scale),3)} for k,(x,y) in zip(self.labels,flat)]
  self.reset()
 def kind_scores(self,v,topk=2):
  s=self.examples@v;out=np.zeros(len(self.labels))
  for i in range(len(self.labels)):out[i]=np.sort(s[self.owner==i])[-topk:].mean()
  return out
 def classify(self,text):
  """the kind of a passage: nearest examples, less each kind's general pull, plus how the passage is built"""
  v=self.model.encode([text],normalize_embeddings=True)[0]
  match=self.kind_scores(v);base=match-self.bias
  sg=signals(text);scores=base.copy();fired=[]
  self.last_parts={'match':match,'signals':np.zeros(len(self.labels)),'sg':sg}
  for k,w in SIGNALS.items():
   add=sum(sg[f]*wt for f,wt in w.items())
   if add>0.005:
    scores[self.labels.index(k)]+=add;self.last_parts['signals'][self.labels.index(k)]+=add
    top=max(w,key=lambda f:sg[f]*w[f])
    fired.append({'form':k,'cue':top,'add':round(add,3)})
  return v,scores,fired,sg
 def window(self,text,now):
  """the phrases a phrase is heard with: the last minute of talk, up to sixty words, ending with this one"""
  recent=[e for e in self.state['events'] if now-float(e.get('at',0))<self.WINDOW_SECONDS]
  out=[];n=len(text.split())
  for e in reversed(recent):
   k=len(e['text'].split())
   if n+k>self.WINDOW_WORDS:break
   out.insert(0,e);n+=k
  return out
 def heard_with(self,text,recent):
  """each phrase is scored on its own, then the scores are averaged, the newest words counting most,
  so the kind follows the passage without topic leaking between different passages"""
  v,s,fired,sg=self.classify(text)
  acc=s*len(text.split());wsum=float(len(text.split()));age=len(text.split());vec=v*len(text.split())
  weights=[{'id':None,'text':text,'w':float(len(text.split()))}]
  for e in reversed(recent):
   k=len(e['text'].split());w=np.exp(-age/self.RECENCY)*k
   ps=self.phrase_scores.get(e['id'])
   if ps is None:continue
   acc=acc+w*ps;wsum+=w;vec=vec+w*self.phrase_vecs[e['id']];age+=k
   weights.insert(0,{'id':e['id'],'text':e['text'],'w':float(w)})
  # each phrase's share of the verdict, oldest first, this phrase last
  self.last_weights=[{**x,'w':round(x['w']/wsum,3)} for x in weights]
  vec=vec/(np.linalg.norm(vec)+1e-9)
  return v,s,acc/wsum,vec,fired
 def reset(self):
  self.state={'session':str(uuid.uuid4()),'started':time.time(),'revision':0,'status':'Ready for speech.','form':'thinking aloud','world':'scrolls','scores':[], 'topics':[],'events':[],'words':{},'active_topic':None,'speaker_words':{'A':0,'B':0},'speaker':'A','conclusion_at':0,'radius':.85,'gate_at':0,'gate_from':'','error':'','model':'MiniLM, nearest examples over the last minute','source':'Ready','processing':False,'map':{'forms':self.form_xy,'ideas':[]}}
  self.vectors={};self.phrase_scores={};self.phrase_vecs={};self.phrase_heat={};self.last_match={};self.candidate=None;self.candidate_count=0;self.seen=set()
 def ingest(self,text,speaker='A',source='Typed',event_id=None,start=None,end=None,form_override=None):
  text=text.strip()
  if not text:return
  event_id=event_id or str(uuid.uuid4())
  if event_id in self.seen:return
  self.seen.add(event_id)
  now=time.time()
  recent=self.window(text,now)
  passage=' '.join([e['text'] for e in recent]+[text])
  vector,own,scores,wvec,fired=self.heard_with(text,recent)
  self.phrase_scores[event_id]=own;self.phrase_vecs[event_id]=vector
  ranked=sorted(zip(self.labels,map(float,scores)),key=lambda x:-x[1]);candidate=ranked[0][0]
  old=self.state['form'];margin=ranked[0][1]-ranked[1][1]
  if candidate==self.candidate:self.candidate_count+=1
  else:self.candidate=candidate;self.candidate_count=1
  nwords=len(passage.split())
  if form_override in KINDS:new=form_override;why='the speaker named the kind'
  elif not self.state['events']:new=candidate;why='the first phrase sets the kind'
  elif candidate==old:new=old;why='the last minute of talk still reads as %s'%old
  elif margin>.03:new=candidate;why='over the last %d words it leads by %.2f'%(nwords,margin)
  elif self.candidate_count>=2:new=candidate;why='it has led for two phrases in a row'
  else:new=old;why='held at %s until %s leads again (margin only %.2f)'%(old,candidate,margin)
  if new!=old:
   self.state.update(gate_from=old,gate_at=now)
  # a very short phrase is matched to an idea together with the phrase before it
  prev=self.state['events'][-1]['text'] if self.state['events'] else ''
  idea_text=text if len(text.split())>=10 or not prev else prev+' '+text
  idea_vec=vector if idea_text==text else self.model.encode([idea_text],normalize_embeddings=True)[0]
  topic=self.match_topic(idea_text,idea_vec)
  idea=dict(self.last_match)
  event={'id':event_id,'text':text,'speaker':speaker,'source':source,'topic':topic['id'],'form':new,'at':now,'start':start,'end':end,
   'why':{'scores':[{'form':k,'similarity':round(v,3)} for k,v in ranked],'cues':fired,'candidate':candidate,'margin':round(margin,3),
          'held':self.candidate_count,'from':old,'form':new,'reason':why,'idea':idea,'window':passage,'window_words':nwords,
          'own':{k:round(float(v),3) for k,v in zip(self.labels,own)},'weights':self.last_weights,
          'parts':self.parts(ranked),'signals':{k:round(float(v),3) for k,v in self.last_parts['sg'].items()}}}
  topic['events'].append(event_id);topic['words']+=len(words(text));topic['updated']=now
  self.state['events'].append(event)
  self.state['words']=dict(Counter(self.state['words'])+Counter(words(text)))
  self.state['speaker_words'][speaker]=self.state['speaker_words'].get(speaker,0)+len(words(text))
  conclusion=bool(re.search(r'\b(the point of (all of )?this is|in conclusion|my central point|what it comes down to|the answer is)\b',text,re.I))
  if conclusion:self.state['conclusion_at']=now
  # the rings: how far the talk has come from where it began, closing at a stated conclusion
  anchor=self.state['events'][0]['text']
  anchor_vector=self.model.encode([anchor],normalize_embeddings=True)[0]
  radius=0 if conclusion else max(.12,min(.95,1-cos(vector,anchor_vector)))
  self.state.update(form=new,world=CATALOG.get(new,('scrolls',))[0],scores=[{'form':k,'similarity':round(v,3)} for k,v in ranked],active_topic=topic['id'],speaker=speaker,source=source,radius=radius,revision=self.state['revision']+1,status='Following your speech.',error='')
  # where the passage lands on the map, and where every idea stands now
  event['why']['xy']=self.xy(wvec)
  self.state['map']={'forms':self.form_xy,'ideas':[{'id':t['id'],**self.xy(self.vectors[t['id']])} for t in self.state['topics']]}
  own_heat=self.saliency(text,new)
  self.phrase_heat[event_id]=own_heat
  event['why']['saliency']=[w for e in recent for w in self.phrase_heat.get(e['id'],[[t,0.0] for t in e['text'].split()])]+own_heat
  return event
 def parts(self,ranked):
  """how this phrase's own score was built for the leading kinds: nearest examples, less the kind's general pull, plus its signals"""
  P=self.last_parts;out={}
  for k,_ in ranked[:5]:
   i=self.labels.index(k)
   out[k]={'match':round(float(P['match'][i]),3),'bias':round(float(-self.bias[i]),3),'signals':round(float(P['signals'][i]),3)}
  return out
 def xy(self,v):
  f=(v-self.mean)@self.axes.T/self.scale
  return {'x':round(float(max(-1.4,min(1.4,f[0]))),3),'y':round(float(max(-1.4,min(1.4,f[1]))),3)}
 def saliency(self,text,form):
  """how much each word of the passage pulled it toward the chosen kind: take the word away and see the score fall"""
  toks=text.split()
  if len(toks)<2 or len(toks)>64:return [[t,0.0] for t in toks]
  i=self.labels.index(form)
  base=self.kind_scores(self.model.encode([text],normalize_embeddings=True)[0])[i]
  vecs=self.model.encode([' '.join(toks[:j]+toks[j+1:]) for j in range(len(toks))],normalize_embeddings=True,batch_size=64)
  drops=[base-self.kind_scores(v)[i] for v in vecs]
  top=max(max(drops),1e-6)
  return [[t,round(max(0.0,float(d))/top,3)] for t,d in zip(toks,drops)]
 def match_topic(self,text,vector):
  kw=set(keywords(text));candidates=[]
  for t in self.state['topics']:
   overlap=len(kw & set(t['keywords']))/max(1,min(len(kw),len(t['keywords'])))
   score=max(cos(vector,self.vectors[t['id']]),.5*overlap+.5*cos(vector,self.vectors[t['id']]))
   candidates.append((score,t))
  candidates.sort(key=lambda x:-x[0])
  returning=bool(re.search(r'\b(returning to|back to|as i said|again about)\b',text,re.I))
  threshold=.40 if returning else .47
  best=candidates[0] if candidates else (0,None)
  self.last_match={'best':round(float(best[0]),3),'threshold':threshold,'returning_cue':returning,
   'best_title':best[1]['title'] if best[1] else None}
  if candidates and candidates[0][0]>=threshold:
   topic=candidates[0][1];self.last_match.update(result='returns to "%s"'%topic['title'],id=topic['id'])
   topic['returns']+=int(topic['id']!=self.state['active_topic'])
   v=self.vectors[topic['id']]*.8+vector*.2;self.vectors[topic['id']]=v/(np.linalg.norm(v)+1e-9)
   topic['keywords']=list(dict.fromkeys(topic['keywords']+keywords(text)))[:40]
   return topic
  ident=str(uuid.uuid4())[:8]
  title=' '.join(list(dict.fromkeys(keywords(text)))[:4]).capitalize() or 'A new thought'
  topic={'id':ident,'title':title,'keywords':keywords(text)[:40],'events':[],'words':0,'returns':0,'updated':time.time()}
  self.state['topics'].append(topic);self.vectors[ident]=vector
  self.last_match.update(result='a new idea: "%s"'%title,id=ident)
  return topic
 def read_passage(self,text):
  """any stretch of text, read on its own: split into phrases and heard one after another, as if spoken,
  without touching the live session"""
  keep=(self.state,self.vectors,self.phrase_scores,self.phrase_vecs,self.phrase_heat,self.last_match,self.candidate,self.candidate_count,self.seen)
  self.reset();events=[]
  try:
   parts=[x.strip() for x in re.split(r'(?<=[.!?;])\s+|\n+',text) if x.strip()]
   phrases=[]
   for x in parts:
    w=x.split()
    while len(w)>30:phrases.append(' '.join(w[:24]));w=w[24:]
    if w:phrases.append(' '.join(w))
   for x in phrases[:80]:
    e=self.ingest(x,'A','Section')
    if e:events.append(e)
   return {'events':events,'topics':[{'id':t['id'],'title':t['title'],'words':t['words'],'returns':t['returns'],'n':len(t['events'])} for t in self.state['topics']]}
  finally:
   (self.state,self.vectors,self.phrase_scores,self.phrase_vecs,self.phrase_heat,self.last_match,self.candidate,self.candidate_count,self.seen)=keep
 def reassign(self,event_id,topic_id):
  topic=next(t for t in self.state['topics'] if t['id']==topic_id)
  event=next(e for e in self.state['events'] if e['id']==event_id)
  old=next(t for t in self.state['topics'] if t['id']==event['topic'])
  old['events'].remove(event_id);old['words']-=len(words(event['text']))
  topic['events'].append(event_id);topic['words']+=len(words(event['text']))
  event['topic']=topic_id;self.state['revision']+=1
