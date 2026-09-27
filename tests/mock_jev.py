#!/usr/bin/env python3
"""A stand-in Jev for testing Speechform Heavy without a token.

It answers the same three tasks as the real one, in the same shape (see imagery/heavy.py):
  image  -> a small SVG drawn from the style and the image asked for
  choose -> the candidate sharing the most words with what was said
  direct -> a gentle direction
Run it with `python3 tests/mock_jev.py`, then set the Jev endpoint to http://127.0.0.1:9995 under the key icon.
"""
import base64, hashlib, json, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STYLE_COLOURS = {'ink': ('#f4f1ea', '#1c1c1c'), 'glass': ('#1a1033', '#ffcf4a'), 'water': ('#eef6f7', '#5aa0c8'),
                 'neon': ('#050508', '#39ff14'), 'woodcut': ('#efe4cf', '#8a2b1c'), 'cosmic': ('#07061a', '#b18cff')}

def picture(prompt, style, seed):
    bg, ink = STYLE_COLOURS.get(style, STYLE_COLOURS['ink'])
    h = hashlib.sha1((prompt + str(seed)).encode()).digest()
    shapes = []
    for i in range(14):
        x, y, r = 60 + h[i] * 2.5 % 648, 60 + h[i + 1] * 2.7 % 648, 20 + h[i + 2] % 90
        shapes.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r}" fill="none" stroke="{ink}" stroke-width="{2 + h[i] % 6}" opacity="{0.35 + (h[i] % 60) / 100:.2f}"/>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768" viewBox="0 0 768 768">'
           f'<rect width="768" height="768" fill="{bg}"/>{"".join(shapes)}</svg>')
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        task = body.get('task')
        if task == 'image':
            out = {'image': picture(body.get('prompt', ''), body.get('style', 'ink'), body.get('seed', 0))}
        elif task == 'choose':
            words = set(re.findall(r"[a-z']+", body.get('text', '').lower()))
            cands = body.get('candidates') or [{}]
            best = max(cands, key=lambda c: len(words & set(c.get('keywords', []))))
            out = {'id': best.get('id'), 'why': 'the mock picked the image sharing the most words'}
        else:
            out = {'warmth': 0.6, 'tempo': 1.0, 'why': 'the mock keeps things gentle'}
        data = json.dumps(out).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass

if __name__ == '__main__':
    print('mock Jev on http://127.0.0.1:9995')
    ThreadingHTTPServer(('127.0.0.1', 9995), Handler).serve_forever()
