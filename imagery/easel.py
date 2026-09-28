#!/usr/bin/env python3
"""The easel: a small image model on this Mac, for the clear side of a card.

It runs SDXL Turbo on the Mac's GPU (Metal), apart from the speech worker, and answers one request:
redraw a picture (the image the talk grew) toward a prompt. Nothing leaves the Mac.

  GET  /status  -> {"ready": bool, "model": ..., "error": ...}
  POST /draw    {"prompt", "negative", "init": "data:image/...;base64,...", "strength": 0.65, "steps": 4, "seed": 7}
                -> {"image": "data:image/png;base64,...", "seconds": 3.1}

Started by the Speechform server when a card first needs it (.art/bin/python imagery/easel.py).
"""
import base64, io, json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')
PORT = int(os.environ.get('EASEL_PORT', '9996'))
MODEL = os.environ.get('EASEL_MODEL', 'stabilityai/sdxl-turbo')
SIZE = 512                                   # SDXL Turbo was trained at 512 by 512
state = {'ready': False, 'model': MODEL, 'error': '', 'loading': True}
pipes = {}
paint = threading.Lock()                     # one picture at a time on the GPU

def load():
    try:
        import torch
        from diffusers import AutoPipelineForImage2Image, AutoPipelineForText2Image
        device = 'mps' if torch.backends.mps.is_available() else 'cpu'
        dtype = torch.float16 if device == 'mps' else torch.float32
        t2i = AutoPipelineForText2Image.from_pretrained(MODEL, torch_dtype=dtype, variant='fp16' if device == 'mps' else None)
        t2i.to(device)
        t2i.set_progress_bar_config(disable=True)
        pipes['t2i'] = t2i
        pipes['i2i'] = AutoPipelineForImage2Image.from_pipe(t2i)
        pipes['device'] = device
        state.update(ready=True, loading=False, device=device)
    except Exception as e:                   # the card keeps its abstract side
        state.update(ready=False, loading=False, error=str(e)[:300])

def draw(d):
    import torch
    from PIL import Image
    prompt = str(d.get('prompt', ''))[:600]
    negative = str(d.get('negative', ''))[:300]
    steps = max(1, min(8, int(d.get('steps', 4))))
    gen = torch.Generator('cpu').manual_seed(int(d.get('seed', 7)) % (2 ** 31))
    init = d.get('init')
    t0 = time.time()
    with paint:
        img = None
        if init:
            from PIL import ImageStat
            img = Image.open(io.BytesIO(base64.b64decode(init.split(',', 1)[-1]))).convert('RGB').resize((SIZE, SIZE))
            if ImageStat.Stat(img.convert('L')).mean[0] / 255 < .015:
                img = None                                  # nothing grown yet: the prompt alone draws the scene
        if img is not None:
            strength = max(.3, min(.95, float(d.get('strength', .65))))
            # a grown image that is still mostly dark gives the scene little to hold; the easel then leans on the prompt
            lit = sum(ImageStat.Stat(img.convert('L')).mean) / 255
            if lit < .06:
                strength = max(strength, .95)
            steps = max(steps, int(1 / strength) + 1)          # Turbo needs steps x strength of at least one
            out = pipes['i2i'](prompt=prompt, negative_prompt=negative or None, image=img, strength=strength,
                               num_inference_steps=steps, guidance_scale=0.0, generator=gen).images[0]
        else:
            out = pipes['t2i'](prompt=prompt, negative_prompt=negative or None, num_inference_steps=steps,
                               guidance_scale=0.0, width=SIZE, height=SIZE, generator=gen).images[0]
        if pipes.get('device') == 'mps':
            torch.mps.empty_cache()                        # give the GPU back to the browser between pictures
    buf = io.BytesIO(); out.save(buf, 'PNG')
    return {'image': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode(), 'seconds': round(time.time() - t0, 1)}

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/status'):
            return self._send(200, state)
        return self._send(404, {'error': 'not here'})

    def do_POST(self):
        if not self.path.startswith('/draw'):
            return self._send(404, {'error': 'not here'})
        if not state['ready']:
            return self._send(503, {'error': state['error'] or 'the model is still loading'})
        try:
            d = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            return self._send(200, draw(d))
        except Exception as e:
            return self._send(500, {'error': str(e)[:300]})

    def log_message(self, *a):
        pass

if __name__ == '__main__':
    threading.Thread(target=load, daemon=True).start()
    print(f'the easel on http://127.0.0.1:{PORT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
