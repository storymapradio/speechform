"""Local semantic routing. Immutable utterances, stable topics, explicit provenance."""
import re, time, uuid, math
from collections import Counter
import numpy as np
from catalog import FORMS
STOP=set('a an the this that these those is are was were be been being to of and or in on at for with as i you he she it we they my your our their me us them but if then so from by have has had do does did will would can could should just very all some about into how what when where which who its let not'.split())
def words(text): return re.findall(r"[\w]+(?:['’][\w]+)?",text.lower())
def keywords(text): return [w for w in words(text) if w not in STOP and len(w)>2]
def cos(a,b): return float(np.dot(a,b)/(np.linalg.norm(a)*np.linalg.norm(b)+1e-9))
class Engine:
 def __init__(self,model):
  self.model=model;self.labels=list(FORMS)
  self.prototypes=model.encode([FORMS[k][1] for k in self.labels],normalize_embeddings=True)
  # the map of speech: the twenty prototypes laid flat by their two strongest directions
  self.mean=self.prototypes.mean(axis=0)
  _,_,vt=np.linalg.svd(self.prototypes-self.mean,full_matrices=False)
  self.axes=vt[:2]
  flat=(self.prototypes-self.mean)@self.axes.T
  self.scale=float(np.abs(flat).max()) or 1.0
  self.form_xy=[{'form':k,'x':round(float(x/self.scale),3),'y':round(float(y/self.scale),3)} for k,(x,y) in zip(self.labels,flat)]
  self.reset()
 def reset(self):
  self.state={'session':str(uuid.uuid4()),'started':time.time(),'revision':0,'status':'Ready for speech.','form':'thinking aloud','world':'scrolls','scores':[], 'topics':[],'events':[],'words':{},'active_topic':None,'speaker_words':{'A':0,'B':0},'speaker':'A','conclusion_at':0,'radius':.85,'gate_at':0,'gate_from':'','error':'','model':'MiniLM semantic prototype classifier','source':'Ready','processing':False,'map':{'forms':self.form_xy,'ideas':[]}}
  self.vectors={};self.last_match={};self.candidate=None;self.candidate_count=0;self.seen=set()
 def ingest(self,text,speaker='A',source='Typed',event_id=None,start=None,end=None,form_override=None):
  text=text.strip()
  if not text:return
  event_id=event_id or str(uuid.uuid4())
  if event_id in self.seen:return
  self.seen.add(event_id)
  vector=self.model.encode([text],normalize_embeddings=True)[0]
  scores=self.prototypes@vector
  # Cues supplement the semantic model; scores remain similarities, not probabilities.
  cue={
   'instruction':r'\b(first|step one|next step|follow these|make sure|place each)\b',
   'thinking aloud':r'\b(let me think|what if|maybe i|wait,|think this through)\b',
   'reflective monologue':r'\b(looking back|i realize|i remember|returning to|i felt)\b',
   'dialogue':r'\b(you said|i agree|what do you think|let me respond|your question)\b',
   'argument':r'\b(the point of all|my central point|in conclusion|what i mean is|therefore)\b'}
  fired=[]
  for label,pattern in cue.items():
   m=re.search(pattern,text,re.I)
   if m:scores[self.labels.index(label)]+=.16;fired.append({'form':label,'cue':m.group(0)})
  ranked=sorted(zip(self.labels,map(float,scores)),key=lambda x:-x[1]);candidate=ranked[0][0]
  old=self.state['form'];margin=ranked[0][1]-ranked[1][1]
  if candidate==self.candidate:self.candidate_count+=1
  else:self.candidate=candidate;self.candidate_count=1
  if form_override in FORMS:new=form_override;why='the speaker named the form'
  elif not self.state['events']:new=candidate;why='the first phrase sets the form'
  elif candidate==old:new=old;why='it continues the same form'
  elif margin>.07:new=candidate;why='a clear margin of %.2f over the next form'%margin
  elif self.candidate_count>=2:new=candidate;why='heard for two phrases in a row'
  else:new=old;why='held at %s until %s is heard again (margin only %.2f)'%(old,candidate,margin)
  if new!=old:
   self.state.update(gate_from=old,gate_at=time.time())
  topic=self.match_topic(text,vector)
  idea=dict(self.last_match)
  event={'id':event_id,'text':text,'speaker':speaker,'source':source,'topic':topic['id'],'form':new,'at':time.time(),'start':start,'end':end,
   'why':{'scores':[{'form':k,'similarity':round(v,3)} for k,v in ranked],'cues':fired,'candidate':candidate,'margin':round(margin,3),
          'held':self.candidate_count,'from':old,'form':new,'reason':why,'idea':idea}}
  topic['events'].append(event_id);topic['words']+=len(words(text));topic['updated']=time.time()
  self.state['events'].append(event)
  self.state['words']=dict(Counter(self.state['words'])+Counter(words(text)))
  self.state['speaker_words'][speaker]=self.state['speaker_words'].get(speaker,0)+len(words(text))
  conclusion=bool(re.search(r'\b(the point of (all of )?this is|in conclusion|my central point|what it comes down to|the answer is)\b',text,re.I))
  if conclusion:self.state['conclusion_at']=time.time()
  # Radar distance is semantic distance to the first utterance, with an explicit conclusion cue.
  anchor=self.state['events'][0]['text']
  anchor_vector=self.model.encode([anchor],normalize_embeddings=True)[0]
  radius=0 if conclusion else max(.12,min(.95,1-cos(vector,anchor_vector)))
  self.state.update(form=new,world=FORMS[new][0],scores=[{'form':k,'similarity':round(v,3)} for k,v in ranked],active_topic=topic['id'],speaker=speaker,source=source,radius=radius,revision=self.state['revision']+1,status='Following your speech.',error='')
  # where this phrase lands on the map, and where every idea stands now
  event['why']['xy']=self.xy(vector)
  self.state['map']={'forms':self.form_xy,'ideas':[{'id':t['id'],**self.xy(self.vectors[t['id']])} for t in self.state['topics']]}
  event['why']['saliency']=self.saliency(text,new,scores[self.labels.index(new)])
  return event
 def xy(self,v):
  f=(v-self.mean)@self.axes.T/self.scale
  return {'x':round(float(max(-1.4,min(1.4,f[0]))),3),'y':round(float(max(-1.4,min(1.4,f[1]))),3)}
 def saliency(self,text,form,base):
  """how much each word pushed the phrase toward the chosen form: take it away and see the score fall"""
  toks=text.split()
  if len(toks)<2 or len(toks)>48:return [[t,0.0] for t in toks]
  proto=self.prototypes[self.labels.index(form)]
  without=[' '.join(toks[:i]+toks[i+1:]) for i in range(len(toks))]
  vecs=self.model.encode(without,normalize_embeddings=True,batch_size=48)
  base=float(np.dot(self.model.encode([text],normalize_embeddings=True)[0],proto))
  drops=[base-float(np.dot(v,proto)) for v in vecs]
  top=max(max(drops),1e-6)
  return [[t,round(max(0.0,d)/top,3)] for t,d in zip(toks,drops)]
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
 def reassign(self,event_id,topic_id):
  topic=next(t for t in self.state['topics'] if t['id']==topic_id)
  event=next(e for e in self.state['events'] if e['id']==event_id)
  old=next(t for t in self.state['topics'] if t['id']==event['topic'])
  old['events'].remove(event_id);old['words']-=len(words(event['text']))
  topic['events'].append(event_id);topic['words']+=len(words(event['text']))
  event['topic']=topic_id;self.state['revision']+=1
