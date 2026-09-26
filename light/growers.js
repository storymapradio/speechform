/* Speechform Light: the ten images, grown and drawn in the page.
 *
 * The same rules as imagery/growers.py, which TouchDesigner draws: each image grows with the
 * words spoken in its kind, and the newest shape swells from nothing so growth can be seen.
 * Here the shapes are drawn on a canvas: additive light, a canvas that keeps fading trails,
 * and one soft glow. The image in front takes the square; earlier images stand as tiles below.
 */
(function (root) {
  'use strict';
  const REGISTERS = ['bloom', 'path', 'land', 'hive', 'orrery', 'rings', 'stack', 'kelp', 'tide', 'waves'];
  const PALETTE = {
    bloom: [[.62, .52, 1], [1, .46, .62]], path: [[.55, .8, 1], [1, .72, .3]], land: [[.4, .75, .85], [.95, .62, .36]],
    hive: [[.45, 1, .55], [1, .85, .3]], orrery: [[.6, .72, 1], [1, .8, .55]], rings: [[.35, .95, .95], [1, .45, .35]],
    stack: [[.5, .95, .7], [1, .78, .4]], kelp: [[.35, .95, .7], [.85, .95, .4]], tide: [[.45, .7, 1], [1, .55, .45]],
    waves: [[.7, .6, 1], [1, .6, .85]],
  };
  const SHAPE = { bloom: 'petal', path: 'dot', land: 'grain', hive: 'hex', orrery: 'dot', rings: 'dot', stack: 'stone', kelp: 'blade', tide: 'grain', waves: 'dot' };
  const MAX = 900;
  const h = (i, k = 0) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const mix = (r, w) => { const [a, b] = PALETTE[r]; return [0, 1, 2].map(j => a[j] + (b[j] - a[j]) * Math.min(1, Math.max(0, w))); };
  const born = (i, n) => Math.max(0, Math.min(1, n - i));

  /* each grower returns shapes: [x, y, size, turn in degrees, [r, g, b], alpha] in a square from -1 to 1 */
  const G = {
    bloom(c, g) {
      const n = Math.min(MAX, 6 + g * 1.6 * c.density), out = [], turn = c.t * .03 * c.speed;
      for (let i = 0; i < Math.ceil(n); i++) {
        const a = i * 2.399963 + turn, r = .052 * Math.sqrt(i + 1); if (r > 1.05) break;
        const k = i / Math.max(n, 1);
        out.push([r * Math.cos(a), r * Math.sin(a), (.016 + .026 * (1 - k)) * born(i, n) * (1 + .35 * c.e), a * 57.2958 - 90, mix('bloom', c.warm + .5 * k), .55 + .45 * k]);
      }
      return out;
    },
    path(c, g) {
      const n = Math.min(MAX, 10 + g * 2.2 * c.density), out = [];
      for (let i = 0; i < Math.ceil(n); i++) {
        const far = 1 - Math.exp(-i / 420 * 1.6), y = -.95 + 1.55 * far;
        const x = (.55 * Math.sin(i * .045 + c.seed) + .2 * Math.sin(i * .013 + 1.7)) * (1 - .8 * far);
        let s = .028 * (1 - .75 * far) * born(i, n); const lantern = i % 23 === 11;
        if (lantern) s *= 2.6 + .8 * Math.sin(c.t * 2 + i);
        out.push([x, y, s, 0, mix('path', c.warm + (lantern ? .6 : 0)), lantern ? 1 : .7]);
      }
      return out;
    },
    land(c, g) {
      const per = 56, n = Math.min(MAX, per * 2 + g * 3 * c.density), out = [], lines = Math.ceil(n / per);
      for (let j = 0; j < lines; j++) {
        const rise = j === lines - 1 ? born(j * per, n) : 1, depth = j / Math.max(lines, 1), base = .55 - 1.35 * (j / Math.max(lines + 2, 6));
        for (let k = 0; k < per; k++) {
          if (j * per + k >= n) break;
          const x = -1.05 + 2.1 * k / (per - 1);
          const ridge = Math.sin(x * 3.1 + j * 1.7 + c.seed) * .5 + Math.sin(x * 7.3 - j * .9) * .22 + Math.sin(x * 13 + j) * .08;
          out.push([x, base + ridge * (.16 + .1 * depth) * rise + .02 * Math.sin(c.t * .4 + j), .022 * (.6 + .8 * depth), 0, mix('land', c.warm + .4 * depth), .35 + .65 * depth]);
        }
      }
      return out;
    },
    hive(c, g) {
      const n = Math.min(MAX, 7 + g * 1.2 * c.density), out = [], step = .105;
      const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]], cells = [[0, 0]];
      for (let ring = 1; cells.length < n && ring < 14; ring++) {
        let q = -ring, r = ring;
        for (let d = 0; d < 6; d++) for (let s = 0; s < ring; s++) { cells.push([q, r]); q += dirs[d][0]; r += dirs[d][1]; }
      }
      cells.slice(0, Math.ceil(n)).forEach(([q, r], i) => {
        const x = step * (q + r / 2), y = step * r * .8660254, dist = Math.hypot(x, y);
        out.push([x, y, step * .43 * born(i, n) * (1 + .12 * Math.sin(c.t * 1.3 - dist * 6)), 30, mix('hive', c.warm + dist * .6), .95 - .35 * Math.min(1, dist)]);
      });
      return out;
    },
    orrery(c, g) {
      const n = Math.min(MAX, 1 + g * .9 * c.density), out = [[0, 0, .09 * (1 + .3 * c.e), 0, mix('orrery', 1), 1]];
      for (let i = 1; i < Math.ceil(n); i++) {
        const orbit = 1 + Math.floor(Math.sqrt(i * 1.3)); let rad = .11 * orbit; if (rad > 1) rad = .2 + rad % .8;
        const a = h(i) * 6.2832 + c.t * (.9 / orbit ** 1.5) * c.speed, tilt = .55 + .25 * h(i, 3);
        out.push([rad * Math.cos(a), rad * Math.sin(a) * tilt, (.012 + .03 * h(i, 2) ** 3) * born(i, n), 0, mix('orrery', h(i, 5) * .7 + c.warm * .3), .9]);
      }
      return out;
    },
    rings(c, g) {
      const per = 64, n = Math.min(MAX, per + g * 2.4 * c.density), out = [], count = Math.ceil(n / per);
      for (let j = 0; j < count; j++) {
        const phase = (c.t * .12 * c.speed + j / count) % 1, r = (1 - phase) * (.25 + .8 * c.radius);
        for (let k = 0; k < per; k++) {
          if (j * per + k >= n) break;
          const a = k / per * 6.2832 + j * .3;
          out.push([r * Math.cos(a), r * Math.sin(a), .012 + .01 * (1 - phase), 0, mix('rings', c.warm + (1 - phase) * .3), phase * .9]);
        }
      }
      const blink = c.point ? .5 + .5 * Math.sin(c.t * 9) : .25;
      out.push([0, 0, .05 + .05 * blink, 0, mix('rings', 1), blink]);
      return out;
    },
    stack(c, g) {
      const n = Math.min(MAX, 3 + g * .8 * c.density), out = [], cols = 7, tops = Array(cols).fill(-.92), w = 1.8 / cols;
      for (let i = 0; i < Math.ceil(n); i++) {
        let k = Math.min(cols - 1, Math.floor(Math.abs(h(i, 7) + h(i, 9) - 1) * cols * .999));
        k = ((Math.floor(cols / 2) + (i % 2 ? k : -k)) % cols + cols) % cols;
        const hg = w * (.28 + .3 * h(i, 4)), y = tops[k] + hg * .5; tops[k] += hg * 1.05;
        if (y > .95) continue;
        out.push([-.9 + w * (k + .5) + (h(i, 11) - .5) * w * .22, y, w * .2 * (.8 + .4 * h(i, 13)) * born(i, n), (h(i, 17) - .5) * 8, mix('stack', c.warm + (y + 1) * .3), .8]);
      }
      return out;
    },
    kelp(c, g) {
      const topics = c.ideas.slice(), out = [];
      const total = topics.reduce((a, t) => a + t.words, 0) || g;
      const steps = Math.floor(Math.min(1.85, .25 + total * .006 * c.density) / .014), raw = [];
      let x = 0, y = -.98;
      for (let k = 0; k < steps; k++) { const ang = Math.PI / 2 + .18 * Math.sin(k * .021 + c.seed); x += .014 * Math.cos(ang); y += .014 * Math.sin(ang); raw.push([x, y, ang]); }
      if (!raw.length) return out;
      const mid = (Math.min(...raw.map(p => p[0])) + Math.max(...raw.map(p => p[0]))) / 2;
      const pts = raw.map(([px, py, a]) => [px - mid, py, a]);
      const cs = mix('kelp', c.warm * .6);
      pts.forEach(([px, py, a], k) => out.push([px, py, .024 * (1 - .55 * k / steps), a * 57.2958 - 90, cs, .9]));
      topics.slice(0, 18).forEach((tp, i) => {
        const [bx, by, bang] = pts[Math.min(pts.length - 1, Math.floor(pts.length * (.12 + .8 * (i + .5) / Math.max(topics.length, 1))))];
        const side = i % 2 === 0 ? 1 : -1, length = Math.min(90, 6 + tp.words * .9 * c.density);
        const col = mix('kelp', c.warm + .25 + (tp.id === c.activeIdea ? .35 : 0));
        let ang = bang - side * (.95 + .25 * h(i, 3)), px = bx, py = by;
        for (let k = 0; k < Math.ceil(length); k++) {
          ang += side * .018 * (k > length * .3 ? 1 : -.2); px += .011 * Math.cos(ang); py += .011 * Math.sin(ang);
          out.push([px, py, .015 * (1 - .6 * k / length) * born(k, length), ang * 57.2958 - 90, col, .85]);
          if (tp.returns && k > 4 && k % Math.max(5, Math.floor(length / (tp.returns + 1))) === 0)
            for (let j = 0; j < 5; j++) { const fa = ang + side * .9; out.push([px + .012 * j * Math.cos(fa), py + .012 * j * Math.sin(fa), .011 * (1 - j / 6), fa * 57.2958 - 90, col, .7]); }
        }
      });
      return out;
    },
    tide(c, g) {
      const share = c.speakers.A / Math.max(c.speakers.A + c.speakers.B, 1), front = (share - .5) * 1.2;
      const n = Math.min(MAX, 80 + g * 2 * c.density), out = [], per = 40, lines = Math.ceil(n / per);
      for (let j = 0; j < lines; j++) {
        const side = j % 2 === 0 ? -1 : 1, y = -.9 + 1.8 * (Math.floor(j / 2) + .5) / Math.max(1, Math.floor((lines + 1) / 2));
        for (let k = 0; k < per; k++) {
          if (j * per + k >= n) break;
          const f = k / (per - 1), reach = side < 0 ? front + 1 : 1 - front;
          out.push([side * (1.02 - f * reach), y + .05 * Math.sin(f * 7 + c.t * 1.2 * c.speed + j), .014 * (.4 + f), 0, mix('tide', side < 0 ? .15 : .9), .3 + .7 * f]);
        }
      }
      return out;
    },
    waves(c, g) {
      const n = Math.min(MAX, 100 + g * 3 * c.density), out = [], per = 90, lines = Math.ceil(n / per);
      for (let j = 0; j < lines; j++) {
        const base = -.7 + 1.4 * (j + .5) / Math.max(lines, 1);
        for (let k = 0; k < per; k++) {
          if (j * per + k >= n) break;
          const x = -1.05 + 2.1 * k / (per - 1), amp = (.08 + .18 * c.e) * (1 + .4 * Math.sin(j));
          out.push([x, base + amp * Math.sin(x * (3 + j * .7) + c.t * (1.4 + j * .2) * c.speed), .016, 0, mix('waves', c.warm + j * .08), .8]);
        }
      }
      return out;
    },
  };

  /* where each image stands: the one in front takes the square, earlier ones are tiles along the bottom */
  const TILES = 4;
  function layout(order, lead) {
    const before = order.filter(r => r !== lead).slice(-TILES);
    if (!before.length) return { [lead]: [0, 0, 1] };
    const place = { [lead]: [0, .2, .78] }, n = before.length;
    before.forEach((r, i) => place[r] = [-1 + (i + .5) * 2 / TILES + (TILES - n) / TILES, -.8, .19]);
    return place;
  }

  /* the canvas: shapes in additive light over a fading trail, with a soft glow laid over them */
  function Renderer(canvas, size) {
    const S = size || 480;
    canvas.width = canvas.height = S;
    const out = canvas.getContext('2d');
    const layer = document.createElement('canvas'); layer.width = layer.height = S;
    const ctx = layer.getContext('2d');
    const at = {}, weight = {};
    let last = 0;
    const toPx = v => (v / 2.15 + .5) * S;
    function shape(kind, x, y, s, rot, col, a) {
      const r = s * S / 2.15; if (r < .3 || a < .01) return;
      ctx.fillStyle = `rgba(${col[0] * 255 | 0},${col[1] * 255 | 0},${col[2] * 255 | 0},${Math.min(1, a * .42).toFixed(3)})`;
      const px = toPx(x), py = S - toPx(y);
      ctx.beginPath();
      if (kind === 'petal') { ctx.ellipse(px + Math.cos((rot + 90) / 57.3) * r * .9, py - Math.sin((rot + 90) / 57.3) * r * .9, r * .55, r * 1.3, -(rot) / 57.3, 0, 7); }
      else if (kind === 'grain') ctx.ellipse(px, py, r * 1.6, r, 0, 0, 7);
      else if (kind === 'hex') { for (let k = 0; k < 6; k++) { const q = (60 * k + 30) / 57.3; ctx.lineTo(px + r * Math.cos(q), py + r * Math.sin(q)); } }
      else if (kind === 'stone') { ctx.save(); ctx.translate(px, py); ctx.rotate(-rot / 57.3); ctx.rect(-r, -r * .6, 2 * r, 1.2 * r); ctx.restore(); }
      else if (kind === 'blade') { ctx.save(); ctx.translate(px, py); ctx.rotate(-rot / 57.3); ctx.ellipse(0, 0, r * .45, r * 1.1, 0, 0, 7); ctx.restore(); }
      else ctx.arc(px, py, r, 0, 7);
      ctx.fill();
    }
    function draw(ctxState) {
      const now = ctxState.now ?? performance.now(); const dt = ctxState.dt ?? Math.min(.1, (now - (last || now)) / 1000); last = now;
      /* the trail: the last frame fades, so what moved leaves a faint wake */
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(0,0,0,${(.34 - .16 * ctxState.c.memory).toFixed(3)})`; ctx.fillRect(0, 0, S, S);
      ctx.globalCompositeOperation = 'lighter';
      const place = layout(ctxState.order, ctxState.lead);
      for (const r of REGISTERS) {
        const target = place[r] ? (r === ctxState.lead ? 1 : .8) : 0;
        weight[r] = (weight[r] || 0) + (target - (weight[r] || 0)) * Math.min(1, dt * 1.6);
        if (weight[r] < .004) { delete at[r]; continue; }
        const goal = place[r] || at[r] || [0, 0, 1];
        const cur = at[r] || (at[r] = goal.slice());
        for (let j = 0; j < 3; j++) cur[j] += (goal[j] - cur[j]) * Math.min(1, dt * 2.5);
        const w = weight[r], ease = w * w * (3 - 2 * w), k = cur[2] * (.6 + .4 * ease);
        for (const [x, y, s, rot, col, a] of G[r](ctxState.c, ctxState.growth[r] || 0))
          shape(SHAPE[r], cur[0] + x * k, cur[1] + y * k, s * cur[2] * ease, rot, col, a * ease);
      }
      /* the omega gate: a passage of light opens when the image in front changes */
      const age = (now - ctxState.gateAt) / 1000;
      if (age < 3.2) {
        const kk = age / 3.2, grow = .25 + 1.9 * (1 - (1 - kk) ** 3), fade = .7 * (1 - kk) ** 1.5;
        for (let i = 0; i < 160; i++) { const a = (-50 + 280 * i / 159) / 57.3 + Math.PI / 2; shape('dot', Math.cos(a) * .55 * grow, (Math.sin(a) * .55 + .1) * grow, .0065, 0, [1, .93, .7], fade); }
      }
      /* the glow: a soft copy under the sharp one */
      out.globalCompositeOperation = 'source-over'; out.fillStyle = '#000'; out.fillRect(0, 0, S, S);
      out.globalCompositeOperation = 'lighter';
      out.filter = `blur(${Math.round(S / 60)}px)`; out.globalAlpha = .75; out.drawImage(layer, 0, 0);
      out.filter = 'none'; out.globalAlpha = 1; out.drawImage(layer, 0, 0);
    }
    return { draw };
  }

  const api = { REGISTERS, G, layout, Renderer };
  if (typeof module !== 'undefined') module.exports = api; else root.SpeechformGrowers = api;
})(this);
