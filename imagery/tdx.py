#!/usr/bin/env python3
"""tdx: run a Python script inside the open TouchDesigner project through runtime/exec. Usage: tdx.py file.py | tdx.py -c 'code'"""
import sys,time,uuid,json,pathlib
EX=pathlib.Path(__file__).resolve().parent.parent/'runtime'/'exec'
code=sys.argv[2] if sys.argv[1]=='-c' else pathlib.Path(sys.argv[1]).read_text()
name=f'{time.time_ns()}-{uuid.uuid4().hex[:6]}'
tmp=EX/(name+'.tmp_in');tmp.write_text(code);tmp.replace(EX/(name+'.py'))
out=EX/(name+'.out');t=time.time()
while time.time()-t<float(sys.argv[3] if len(sys.argv)>3 else 60):
 if out.exists():
  r=json.loads(out.read_text());out.unlink()
  print(json.dumps(r['result'],indent=1,default=str) if r['ok'] else r['error']);sys.exit(0 if r['ok'] else 1)
 time.sleep(.1)
print('timeout: TouchDesigner did not pick the job up');sys.exit(2)
