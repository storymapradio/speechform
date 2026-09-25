"""Native TouchDesigner operator construction. No Script TOP/SOP image or geometry generation."""
import math
ROOT=str(__import__('pathlib').Path(__file__).resolve().parent)
b=op('/project1/speech_gates')
old=b.op('modules')
if old:old.destroy()
modules=b.create(baseCOMP,'modules');modules.nodeX=100;modules.nodeY=-600
errors=[]
def node(parent,typ,name,**pars):
 n=parent.create(typ,name)
 for k,v in pars.items():setattr(n.par,k,v)
 return n
def expr(n,par,value):n.par[par].expr=value

def connect(n,*inputs):
 for i,v in enumerate(inputs):
  if i<len(n.inputConnectors):n.inputConnectors[i].connect(v)
  else:v.outputConnectors[0].connect(n)
 return n

def sopout(n):n.display=True;n.render=True;return n

def scene(name):
 s=node(modules,baseCOMP,name)
 c=node(s,cameraCOMP,'camera',tz=20,projection='ortho',orthowidth=16)
 key=node(s,lightCOMP,'key_light',tx=-5,ty=6,tz=9)
 fill=node(s,lightCOMP,'fill_light',tx=6,ty=-3,tz=7)
 r=node(s,renderTOP,'render',camera=c.path,lights=key.path+' '+fill.path,resolutionw=1280,resolutionh=720)
 r.par.geometry='';r.par.bgcolora=0
 bloom=connect(node(s,bloomTOP,'optical_bloom',bloomintensity=.18,preblacklevel=.15),r)
 out=connect(node(s,outTOP,'out1'),bloom)
 return s,r

def material(s,name,color,unlit=False):
 m=node(s,constantMAT if unlit else phongMAT,name)
 for ch,v in zip('rgb',color):setattr(m.par,('color' if unlit else 'diff')+ch,v)
 return m

def geo(s,name,mat,render):
 g=node(s,geometryCOMP,name,material=mat.path)
 render.par.geometry=s.path+'/*'
 return g

def text(s,name,content,size=18,w=1280,h=720):
 t=node(s,textTOP,name,text=content,resolutionw=w,resolutionh=h,fontsizex=size,fontsizey=size,font='Helvetica',alignx='left',aligny='top',positionx=24,positiony=-24,wordwrap=True)
 return t
COLORS=[(.3,.95,.65),(.59,.67,1),(.95,.8,.4),(.95,.42,.65),(.3,.85,1),(.95,.58,.3),(.7,.95,.4)]
# 01. GPU-instanced word city with separate luminous edge geometry.
s,r=scene('word_city')
instances=node(s,tableDAT,'word_instances');instances.appendRow(['x','y','z','r','g','b','scale'])
mat=material(s,'jade_ceramic',(.3,.85,.54));wiremat=material(s,'luminous_edges',(.35,1,.62),True);wiremat.par.wireframe='topology';wiremat.par.wirewidth=1.2
for name,ma,scale in [('blocks',mat,1),('edge_cages',wiremat,1.012)]:
 g=geo(s,name,ma,r);cube=node(g,boxSOP,'unit_box',sizex=.58,sizey=.34,sizez=.58);sopout(cube)
 g.par.instance=True;g.par.instanceop=instances.path
 for ax in 'xyz':g.par['instancet'+ax]=ax
 for ch in 'rgb':g.par['instance'+ch]=ch
 for ax in 'xyz':g.par['instances'+ax]='scale'
 g.par.rx=19;g.par.ry=-12;g.par.ty=-.5
 for ax in 'xyz':g.par['s'+ax]=scale
floor=geo(s,'foundation_grid',material(s,'foundation_lines',(.08,.22,.15),True),r)
grid=node(floor,gridSOP,'city_grid',sizex=13,sizey=5,rows=3,cols=11,orient='xz');sopout(grid);floor.par.ty=-2.6;floor.par.rx=19
labels=text(s,'word_legend','The word city grows as words return.',14);labels.par.aligny='bottom';labels.par.positiony=135
final=connect(node(s,compositeTOP,'legend_over_city',operand='over'),labels,s.op('optical_bloom'));s.op('out1').inputConnectors[0].connect(final)
# 02. A bank of native L-system plants, deformed by native Noise and Twist SOPs.
s,r=scene('idea_garden')
rootmat=material(s,'arch_metal',(.15,.45,.3))
g=geo(s,'parabolic_root',rootmat,r)
arc=node(g,circleSOP,'root_arc',radx=7,rady=.55,arc='open',beginangle=0,endangle=180,divs=120)
profile=node(g,circleSOP,'arch_profile',radx=.025,rady=.025,divs=8)
arch=connect(node(g,sweepSOP,'swept_arch',skin='on'),profile,arc);sopout(arch);g.par.ty=-2.75
for i in range(14):
 plant=geo(s,'idea_'+str(i+1).zfill(2),material(s,'chlorophyll_'+str(i),COLORS[i%7]),r)
 plant.par.tx=-6.4+i*(12.8/13);plant.par.ty=-2.75+.55*math.sqrt(max(0,1-(plant.par.tx.eval()/7)**2))
 ls=node(plant,lsystemSOP,'branch_grammar',type='tube',generations=3,stepinit=.16,stepscale=.84,thickinit=.055,thickscale=.78,angleinit=24,rows=4,cols=5)
 ls.par.rules.eval().text='premise: A\nA=F[+B][-B]A\nB=F[+F]F\n'
 noise=connect(node(plant,noiseSOP,'water_current',amp=.06,period=1.3,harmon=2),ls);expr(noise,'tz','absTime.seconds * 0.16')
 twist=connect(node(plant,twistSOP,'frond_curl',paxis='y',strength=9),noise)
 smooth=connect(node(plant,facetSOP,'surface_normals',postnml=True),twist);sopout(smooth)
 plant.par.render=False
# 03. Four native textured scroll surfaces, with native text and bent paper geometry.
s,r=scene('four_scrolls')
for i in range(4):
 ink=text(s,'scroll_text_'+str(i+1),f'SCROLL {i+1}\n\nA new idea will find a place here.',21,w=512,h=768)
 ink.par.fontcolorr=.1;ink.par.fontcolorg=.15;ink.par.fontcolorb=.12
 ink.par.bgcolorr=.91;ink.par.bgcolorg=.90;ink.par.bgcolorb=.77;ink.par.bgalpha=1
 paper=material(s,'paper_'+str(i),(.95,.94,.84),True);paper.par.colormap=ink.path
 g=geo(s,'scroll_'+str(i+1),paper,r);g.par.tx=-5.6+i*3.73;g.par.ty=-.4
 grid=node(g,gridSOP,'paper_mesh',sizex=3.25,sizey=4.8,rows=48,cols=24)
 bend=connect(node(g,twistSOP,'paper_curl',op='bend',paxis='y',saxis='x',strength=7),grid)
 uv=connect(node(g,textureSOP,'printed_words',type='xy',axis='z'),bend);sopout(uv)
 for j,y in enumerate([-2.45,2.45]):
  rail=geo(s,f'scroll_{i+1}_roller_{j}',material(s,f'roller_mat_{i}_{j}',(.47,.33,.18)),r)
  tube=node(rail,tubeSOP,'wooden_roller',orient='x',rad1=.10,rad2=.10,height=3.5);sopout(tube);rail.par.tx=g.par.tx;rail.par.ty=y-.4
# 04. GPU-instanced idea constellation with native polygon relationships and orbital rings.
s,r=scene('narrative_constellation')
points=node(s,tableDAT,'idea_instances');points.appendRow(['x','y','z','r','g','b','scale'])
mat=material(s,'story_crystal',(.68,.72,1));g=geo(s,'idea_crystals',mat,r)
shape=node(g,sphereSOP,'crystal',type='poly',radx=.18,rady=.18,radz=.18,rows=6,cols=6);sopout(shape)
g.par.instance=True;g.par.instanceop=points.path
for ax in 'xyz':g.par['instancet'+ax]=ax;g.par['instances'+ax]='scale'
for ch in 'rgb':g.par['instance'+ch]=ch
edgepoints=node(s,tableDAT,'relationship_points');edgepolys=node(s,tableDAT,'relationship_polygons')
e=geo(s,'semantic_relationships',material(s,'relationship_light',(.23,.39,.48),True),r)
add=node(e,addSOP,'connect_ideas',pointdat=edgepoints.path,polydat=edgepolys.path);sopout(add)
for i in range(3):
 ring=geo(s,'cosmic_orbit_'+str(i),material(s,'orbit_mat_'+str(i),(.11,.24,.32),True),r)
 arc=node(ring,circleSOP,'orbit',radx=2.0+i*.9,rady=2.0+i*.9,divs=160,arc='open',endangle=359.9);sopout(arc);ring.par.rx=65+i*8;ring.par.rz=i*35;ring.par.ty=-.3
 expr(ring,'ry',f'absTime.seconds * {1+i}')
# 05. Native radar geometry; CHOP lag drives the target toward the conclusion point.
s,r=scene('convergence_radar')
mat=material(s,'phosphor',(.28,.94,.56),True)
for i in range(1,5):
 g=geo(s,'range_ring_'+str(i),material(s,'range_mat_'+str(i),(.07,.27,.17),True),r)
 ring=node(g,circleSOP,'circle',radx=i*.62,rady=i*.62,arc='open',endangle=359.9,divs=160);sopout(ring);g.par.ty=-.3
sweep=geo(s,'sweep_hand',mat,r);line=node(sweep,lineSOP,'scan_ray',pax=0,pay=0,pbx=2.48,pby=0);sopout(line);sweep.par.ty=-.3;expr(sweep,'rz','-absTime.seconds * 32')
for i in range(24):
 g=geo(s,'bearing_'+str(i),material(s,'bearing_mat_'+str(i),(.14,.32,.23),True),r)
 ray=node(g,lineSOP,'bearing_mark',pax=2.54,pay=0,pbx=2.65,pby=0);sopout(ray);g.par.rz=i*15;g.par.ty=-.3
radius=node(s,selectCHOP,'semantic_distance',chops=b.op('controls').path,channames='radar_distance')
lag=connect(node(s,lagCHOP,'arrival_easing',lag1=1.6,lag2=1.6),radius)
target=geo(s,'thought_signal',mat,r);sphere=node(target,sphereSOP,'signal',radx=.10,rady=.10,radz=.10);sopout(sphere)
expr(target,'tx',f"op('{lag.path}')[0] * 2.4 * math.cos(absTime.seconds * 0.08)");expr(target,'ty',f"-.3 + op('{lag.path}')[0] * 2.4 * math.sin(absTime.seconds * 0.08)")
center=geo(s,'conclusion_beacon',mat,r);beacon=node(center,sphereSOP,'beacon',radx=.08,rady=.08,radz=.08);sopout(beacon);center.par.ty=-.3
for ax in 'xyz':expr(center,'s'+ax,f"1 + op('{b.path}/controls')['point_found'] * (1.5 + math.sin(absTime.seconds * 11))")
# 06. Native tectonic terrain meshes, stratified layers, and CHOP-controlled subduction.
s,r=scene('dialogue_tectonics')
share=node(s,selectCHOP,'speaking_share',chops=b.op('controls').path,channames='speaker_balance')
slow=connect(node(s,lagCHOP,'tectonic_timescale',lag1=25,lag2=25),share)
for i in range(2):
 side=-1 if i==0 else 1;col=COLORS[i]
 for layer in range(5):
  g=geo(s,f'plate_{"A" if i==0 else "B"}_stratum_{layer}',material(s,f'rock_{i}_{layer}',tuple(v*(.45+layer*.1) for v in col)),r)
  grid=node(g,gridSOP,'terrain_mesh',sizex=8,sizey=3.2,rows=38,cols=54)
  noise=connect(node(g,noiseSOP,'geological_relief',amp=.13+layer*.012,period=1.1,harmon=3,seed=i*7+3),grid)
  bend=connect(node(g,twistSOP,'subduction_curve',op='bend',paxis='x',strength=side*12),noise)
  normals=connect(node(g,facetSOP,'terrain_normals',postnml=True),bend);sopout(normals)
  g.par.rx=49;g.par.ry=side*9;g.par.ty=-.6-layer*.16;g.par.tz=-layer*.12
  expr(g,'tx',f"{side*3.1} + (op('{slow.path}')[0] - .5) * 4")
  expr(g,'rz',f"{side*-3} + (op('{slow.path}')[0] - .5) * {side*9}")
# 07. Native swept ribbon surfaces modulated by live vocal energy.
s,r=scene('vocal_ribbons')
energy=node(s,selectCHOP,'vocal_energy',chops=b.op('controls').path,channames='audio_rms')
lag=connect(node(s,lagCHOP,'breath_envelope',lag1=.08,lag2=.6),energy)
for i in range(12):
 g=geo(s,'ribbon_'+str(i).zfill(2),material(s,'silk_'+str(i),COLORS[i%7]),r);g.par.ty=-.8+i*.09
 line=node(g,lineSOP,'spine',pax=-6.6,pbx=6.6,pay=0,pby=0,points=140)
 noise=connect(node(g,noiseSOP,'harmonic_motion',period=3.7,harmon=2,seed=1),line)
 expr(noise,'amp',f".34 + op('{lag.path}')[0] * 7")
 expr(noise,'tz',f'absTime.seconds * .22 + {i*.045}')
 profile=node(g,lineSOP,'silk_width',pax=0,pay=-.024,pbx=0,pby=.024,points=2)
 sweep=connect(node(g,sweepSOP,'woven_surface',skin='on'),profile,noise)
 normals=connect(node(g,facetSOP,'silk_normals',postnml=True),sweep);sopout(normals)
# Shared native omega passage with an emissive tube, feet, and a CHOP-driven zoom.
s,r=scene('omega_passage');mat=material(s,'gate_phosphor',(.34,1,.58),True)
g=geo(s,'omega_tube',mat,r)
arc=node(g,circleSOP,'omega_arc',radx=1.7,rady=1.9,arc='open',beginangle=-40,endangle=220,divs=160)
profile=node(g,circleSOP,'gate_profile',radx=.045,rady=.045,divs=10)
swept=connect(node(g,sweepSOP,'solid_gate',skin='on'),profile,arc);sopout(swept)
for side in [-1,1]:
 foot=geo(s,'foot_left' if side<0 else 'foot_right',mat,r);cube=node(foot,boxSOP,'threshold',sizex=.66,sizey=.085,sizez=.085);sopout(cube);foot.par.tx=side*1.62;foot.par.ty=-1.22
# Root composition uses native TOPs exclusively.
for name in ['native_background','native_frame','native_title','native_status','native_subtitle','native_footer','scene_over_background','portal_over_scene','native_hud','native_output']:
 n=b.op(name)
 if n:n.destroy()
bg=node(b,constantTOP,'native_background',resolutionw=1280,resolutionh=720)
for ch,dark,light in [('r',.012,.93),('g',.026,.945),('b',.025,.89)]:expr(bg,'color'+ch,f"{light} if parent().par.Light else {dark}")
frame=node(b,rectangleTOP,'native_frame',resolutionw=1280,resolutionh=720,sizex=.977,sizey=.958,sizeunit='fraction',fillalpha=0,borderwidth=2,borderwidthunit='pixels',borderr=.22,borderg=.9,borderb=.12,cornerradius=24)
title=text(b,'native_title','Ω  SPEECH GATES',27);title.par.positionx=40;title.par.positiony=-28
subtitle=text(b,'native_subtitle','Native TouchDesigner speech instrument.',18);subtitle.par.positionx=42;subtitle.par.positiony=-88
status=text(b,'native_status','LOCAL MAC TRANSCRIPTION',12);status.par.alignx='right';status.par.positionx=-42;status.par.positiony=-36
footer=text(b,'native_footer','Start the microphone or choose a recording.',16);footer.par.aligny='bottom';footer.par.positionx=42;footer.par.positiony=32
for t in [title,subtitle,status,footer]:
 for ch,dark,light in [('r',.85,.08),('g',.95,.15),('b',.87,.10)]:expr(t,'fontcolor'+ch,f"{light} if parent().par.Light else {dark}")
# Switch all seven complete native modules.
switch=b.op('world_switch')
for c in switch.inputConnectors:c.disconnect()
for i,name in enumerate(['word_city','idea_garden','four_scrolls','narrative_constellation','convergence_radar','dialogue_tectonics','vocal_ribbons']):
 out=b.op('module_'+name) or node(b,selectTOP,'module_'+name)
 out.par.top=modules.op(name+'/out1')
 if i<len(switch.inputConnectors):switch.inputConnectors[i].connect(out)
 else:out.outputConnectors[0].connect(switch)
base=connect(node(b,compositeTOP,'scene_over_background',operand='over'),switch,bg)
omega=b.op('module_omega') or node(b,selectTOP,'module_omega');omega.par.top=modules.op('omega_passage/out1')
portal=connect(node(b,compositeTOP,'portal_over_scene',operand='over'),omega,base)
hud=connect(node(b,compositeTOP,'native_hud',operand='over'),title,subtitle,status,footer,frame,portal)
b.op('final').inputConnectors[0].connect(hud)
# Remove the superseded raster art modules and temporary probes.
for name in ['blocks','seaweed','scrolls','nodes','radar','plates','ribbons','native_geometry','operator_probe']:
 n=b.op(name)
 if n:n.destroy()
# Place modules and their internal nodes in readable operator networks.
for i,s in enumerate(modules.children):
 s.nodeX=(i%4)*450;s.nodeY=-(i//4)*350
 for j,n in enumerate(s.children):n.nodeX=(j%5)*200;n.nodeY=-(j//5)*140
for i,n in enumerate([bg,switch,base,portal,hud,b.op('final'),b.op('out1')]):n.nodeX=i*210;n.nodeY=400
print('Created',len(b.findChildren()),'native instrument operators')
