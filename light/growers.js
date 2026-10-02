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
  const MAX = 1400;
  const h = (i, k = 0) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const mix = (r, w) => { const [a, b] = PALETTE[r]; return [0, 1, 2].map(j => a[j] + (b[j] - a[j]) * Math.min(1, Math.max(0, w))); };
  const born = (i, n) => Math.max(0, Math.min(1, n - i));

  /* steering, never in words (Studio passes c.cues and c.threads: {ideaId: {state, active, curl}}):
     an open thread's tip glows at the pulse of the talk, a dormant branch dims and slowly curls,
     a thread ready to close swells into a bud, and a closed one opens into a frond */
  const cueOf = (c, idea) => (c.cues && c.threads && idea && c.threads[idea.id]) || null;
  const dimOf = (c, idea) => { const t = cueOf(c, idea); return t && t.state === 'dormant' ? .3 : 1; };
  const curlOf = (c, idea) => { const t = cueOf(c, idea); return t && t.state === 'dormant' ? (t.curl || .3) : 0; };
  function tip(out, c, idea, x, y, ang, scale = 1) {
    const t = cueOf(c, idea); if (!t) return;
    const beat = .5 + .5 * Math.sin(c.t * Math.PI * (c.pulse || .8)), deg = ang * 57.2958 - 90;
    if (t.state === 'ready') {                                           // a bud, swelling
      const b = (.03 + .01 * beat) * scale;
      out.push([x, y, b, deg, [1, .8, .32], .95, 'petal'], [x, y, b * .85, deg + 22, [1, .9, .5], .8, 'petal'], [x, y, b * .85, deg - 22, [1, .9, .5], .8, 'petal']);
    } else if (t.state === 'closed') {                                   // a frond, opened
      for (let k = 0; k < 7; k++) { const a = ang + (k - 3) * .36, r = .04 * scale; out.push([x + r * Math.cos(a), y + r * Math.sin(a), .024 * scale, a * 57.2958 - 90, [.55, 1, .5], .85, 'blade']); }
      out.push([x, y, .008 * scale, 0, [1, .95, .6], .9, 'dot']);
    } else if (t.state !== 'dormant') {                                  // the tip glows, at the talk's pulse
      out.push([x, y, (.012 + .016 * beat * (t.active ? 1 : .45)) * scale * (1 + (t.want || 0)), 0, [1, 1, .85], Math.min(1, (t.active ? .6 : .35) + .35 * beat + .3 * (t.want || 0)), 'dot']);
    }
    if (t.want > .05 && t.state !== 'closed')                           // the room wants more of it: a cool halo, brighter as it asks
      out.push([x, y, (.03 + .02 * beat) * scale * (1 + t.want), 0, [.45, .75, 1], .25 + .45 * t.want, 'dot']);
  }
  /* for the images with no branch of their own per idea: a sprig per thread rising from the foot of the square */
  function sprigs(out, c) {
    if (!c.cues || !c.threads) return;
    const I = c.ideas.slice(0, 9);
    I.forEach((idea, i) => {
      const dim = dimOf(c, idea), curl = curlOf(c, idea); let x = -.8 + 1.6 * (i + .5) / Math.max(I.length, 1), y = -1, ang = Math.PI / 2;
      const len = Math.min(34, 8 + idea.words * .5);
      for (let k = 0; k < len; k++) { ang += (i % 2 ? 1 : -1) * (.01 + curl * .05); x += .01 * Math.cos(ang); y += .01 * Math.sin(ang); out.push([x, y, .007, ang * 57.2958 - 90, [.6, 1, .7], .5 * dim, 'blade']); }
      tip(out, c, idea, x, y, ang, .8);
    });
  }

  /* each grower returns shapes: [x, y, size, turn in degrees, [r, g, b], alpha] in a square from -1 to 1 */
  const G = {
    /* poetry: a flower in a golden spiral, an outer ring and stamens; each new idea opens a smaller flower around it */
    bloom(c, g) {
      const out = [], turn = c.t * .03 * c.speed;
      const flower = (cx, cy, n, scale, warmBias, spin, dim = 1) => {
        for (let i = 0; i < Math.ceil(n); i++) {
          const a = i * 2.399963 + turn * spin, r = .052 * Math.sqrt(i + 1) * scale; if (r > .62 * (scale < 1 ? 1 : 1.7) * scale) break;
          const k = i / Math.max(n, 1), outer = i % 7 === 3;
          out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), (.016 + .026 * (1 - k)) * scale * (outer ? 1.6 : 1) * born(i, n) * (1 + .35 * c.e), a * 57.2958 - 90, mix('bloom', c.warm + .5 * k + warmBias), (outer ? .35 + .3 * k : .55 + .45 * k) * dim]);
        }
        for (let j = 0; j < Math.min(24, n / 6); j++) {                 // stamens at the heart
          const a = j * 2.4 + turn * 3, r = .02 * scale * Math.sqrt(j + 1);
          out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), .007 * scale, 0, [1, .9, .55], .9, 'dot']);
        }
      };
      const ring = c.ideas.length > 1, main = ring ? .66 : 1;
      flower(0, 0, Math.min(MAX, 6 + g * 1.6 * c.density), main, 0, 1);
      c.ideas.slice(1, 7).forEach((idea, i) => {
        const a = i / Math.min(6, c.ideas.length - 1) * 6.2832 + .4, r = .8;
        flower(r * Math.cos(a), r * Math.sin(a), Math.min(160, 4 + idea.words * 1.4), .28 + Math.min(.12, idea.returns * .04), .2, -1, dimOf(c, idea));
        tip(out, c, idea, r * Math.cos(a), r * Math.sin(a), a, 1);
      });
      if (c.ideas[0]) tip(out, c, c.ideas[0], 0, 0, Math.PI / 2, 1.4);
      return out;
    },
    /* story: a winding trail toward the horizon; each new idea forks a path off it, returns light lanterns, footprints run along */
    path(c, g) {
      const n = Math.min(MAX, 10 + g * 2.2 * c.density), out = [], trail = [];
      for (let i = 0; i < Math.ceil(n); i++) {
        const far = 1 - Math.exp(-i / 420 * 1.6), y = -.95 + 1.55 * far;
        const x = (.55 * Math.sin(i * .045 + c.seed) + .2 * Math.sin(i * .013 + 1.7)) * (1 - .8 * far);
        trail.push([x, y, far]);
        let s = .028 * (1 - .75 * far) * born(i, n); const lantern = i % 23 === 11;
        if (lantern) s *= 2.6 + .8 * Math.sin(c.t * 2 + i);
        out.push([x, y, s, 0, mix('path', c.warm + (lantern ? .6 : 0)), lantern ? 1 : .7]);
        if (i % 5 === 2) for (const side of [-1, 1]) out.push([x + side * .035 * (1 - .8 * far), y + .004, .006 * (1 - .7 * far), 0, mix('path', c.warm * .5), .4, 'dot']);   // footprints
      }
      c.ideas.slice(1, 9).forEach((idea, i) => {                        // forks
        const at = trail[Math.min(trail.length - 1, Math.floor(trail.length * (.15 + .75 * (i + .5) / Math.max(c.ideas.length - 1, 1))))];
        if (!at) return;
        const side = i % 2 ? 1 : -1, len = Math.min(120, 8 + idea.words * 1.6);
        let [x, y, far] = at, ang = side > 0 ? .25 + .2 * h(i, 5) : Math.PI - .25 - .2 * h(i, 5);   // a fork sets off sideways
        const dim = dimOf(c, idea), curl = curlOf(c, idea);
        for (let k = 0; k < len; k++) {
          ang += side * (.012 + curl * .03 * k / len); x += .016 * Math.cos(ang) * (1 - .5 * far); y += .016 * Math.sin(ang) * (1 - .5 * far);   // and bends up toward the horizon
          const lamp = idea.returns && k % Math.max(8, Math.floor(len / (idea.returns + 1))) === 5;
          if (Math.abs(x) > 1.05 || y > .95) break;
          out.push([x, y, (lamp ? .05 : .026) * (1 - .5 * far) * born(k, len), 0, mix('path', c.warm + (lamp ? .7 : .45) + (idea.id === c.activeIdea ? .2 : 0)), (lamp ? .95 : .7) * dim]);
        }
        tip(out, c, idea, x, y, ang, 1);
      });
      return out;
    },
    /* scenery: ridgelines one behind another, a river winding down from the horizon, stars over the peaks */
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
      const river = Math.min(220, g * 1.2);                             // the river
      for (let i = 0; i < river; i++) {
        const u = i / 220, y = .5 - 1.45 * u, x = .25 * Math.sin(u * 7 + c.seed) * (.3 + u);
        out.push([x, y, .006 + .02 * u, 0, [.55, .8, 1], .35 + .4 * u + .15 * Math.sin(c.t * 2 - i * .2), 'grain']);
      }
      for (let i = 0; i < Math.min(80, g * .5); i++)                    // stars
        out.push([h(i, 21) * 2 - 1, .62 + h(i, 22) * .38, .004 + .006 * h(i, 23), 0, [1, 1, .9], .3 + .5 * Math.abs(Math.sin(c.t * (.5 + h(i, 24)) + i)), 'dot']);
      sprigs(out, c);
      return out;
    },
    /* lore and myth: a comb laid ring by ring; each idea buds a small comb of its own, and the one in play glows */
    hive(c, g) {
      const out = [], step = .105;
      const comb = (cx, cy, n, scale, lit) => {
        const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]], cells = [[0, 0]];
        for (let ring = 1; cells.length < n && ring < 14; ring++) { let q = -ring, r = ring;
          for (let d = 0; d < 6; d++) for (let s = 0; s < ring; s++) { cells.push([q, r]); q += dirs[d][0]; r += dirs[d][1]; } }
        cells.slice(0, Math.ceil(n)).forEach(([q, r], i) => {
          const x = step * scale * (q + r / 2), y = step * scale * r * .8660254, dist = Math.hypot(x, y) / scale;
          const honey = lit ? .25 + .2 * Math.sin(c.t * 2 - dist * 8) : 0;
          out.push([cx + x, cy + y, step * scale * .43 * born(i, n) * (1 + .12 * Math.sin(c.t * 1.3 - dist * 6)), 30, mix('hive', c.warm + dist * .6 + honey), .95 - .35 * Math.min(1, dist) + honey]);
        });
      };
      const buds = c.ideas.length > 1;
      comb(0, 0, Math.min(buds ? 127 : MAX, 7 + g * 1.2 * c.density), buds ? .72 : 1, !c.ideas[0] || c.ideas[0].id === c.activeIdea);
      c.ideas.slice(1, 7).forEach((idea, i) => { const a = i / 6 * 6.2832 + .5, n0 = out.length; comb(.86 * Math.cos(a), .86 * Math.sin(a), Math.min(37, 1 + idea.words * .6), .45, idea.id === c.activeIdea);
        const dim = dimOf(c, idea); if (dim < 1) for (let k = n0; k < out.length; k++) out[k][5] *= dim;
        tip(out, c, idea, .86 * Math.cos(a), .86 * Math.sin(a), a, 1.2); });
      if (c.ideas[0]) tip(out, c, c.ideas[0], 0, 0, Math.PI / 2, 1.4);
      return out;
    },
    /* cosmology: bodies join a sun; each idea is a planet with a moon for every return, tracing its orbit */
    orrery(c, g) {
      const n = Math.min(MAX, 1 + g * .9 * c.density), out = [[0, 0, .09 * (1 + .3 * c.e), 0, mix('orrery', 1), 1]];
      for (let i = 1; i < Math.ceil(n); i++) {
        const orbit = 1 + Math.floor(Math.sqrt(i * 1.3)); let rad = .11 * orbit; if (rad > 1) rad = .2 + rad % .8;
        const a = h(i) * 6.2832 + c.t * (.9 / orbit ** 1.5) * c.speed, tilt = .55 + .25 * h(i, 3);
        out.push([rad * Math.cos(a), rad * Math.sin(a) * tilt, (.008 + .02 * h(i, 2) ** 3) * born(i, n), 0, mix('orrery', h(i, 5) * .7 + c.warm * .3), .7]);
      }
      c.ideas.slice(0, 7).forEach((idea, i) => {
        const rad = .25 + .11 * i, spd = .5 / (1 + i) ** .8 * c.speed, a = i * 2.1 + c.t * spd, tilt = .6;
        for (let k = 0; k < 60; k++) { const q = k / 60 * 6.2832; out.push([rad * Math.cos(q), rad * Math.sin(q) * tilt, .003, 0, mix('orrery', .3), .25, 'dot']); }   // its orbit
        const px = rad * Math.cos(a), py = rad * Math.sin(a) * tilt, size = .025 + Math.min(.04, idea.words * .0008);
        out.push([px, py, size, 0, mix('orrery', c.warm + .5 + (idea.id === c.activeIdea ? .3 : 0)), dimOf(c, idea)]);
        tip(out, c, idea, px, py + size, Math.PI / 2, 1);
        for (let m = 0; m < Math.min(6, idea.returns + (idea.n > 3 ? 1 : 0)); m++) { const mq = c.t * (2 + m) + m * 2; out.push([px + (size + .03 + m * .012) * Math.cos(mq), py + (size + .03 + m * .012) * Math.sin(mq), .008, 0, [.9, .95, 1], .9, 'dot']); }
      });
      return out;
    },
    /* mystery and argument: ripples close in on a point; each idea is a centre of its own, and the ripples cross */
    rings(c, g) {
      const out = [], centres = c.ideas.length ? c.ideas.slice(0, 5) : [{ id: 0 }];
      const per = 48, total = Math.min(MAX, per + g * 2.4 * c.density), each = total / centres.length;
      centres.forEach((idea, ci) => {
        const cx = ci ? .55 * Math.cos(ci * 2.4) : 0, cy = ci ? .55 * Math.sin(ci * 2.4) : 0, count = Math.ceil(each / per);
        for (let j = 0; j < count; j++) {
          const phase = (c.t * .12 * c.speed + j / count + ci * .21) % 1, r = (1 - phase) * (.25 + .8 * c.radius) * (ci ? .6 : 1);
          for (let k = 0; k < per; k++) {
            const a = k / per * 6.2832 + j * .3;
            out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), .01 + .01 * (1 - phase), 0, mix('rings', c.warm + (1 - phase) * .3 + (idea.id === c.activeIdea ? .3 : 0)), phase * (ci ? .6 : .9) * dimOf(c, idea)]);
          }
        }
        tip(out, c, idea, cx, cy, Math.PI / 2, ci ? 1 : 1.3);
      });
      const blink = c.point ? .5 + .5 * Math.sin(c.t * 9) : .25;
      out.push([0, 0, .05 + .05 * blink, 0, mix('rings', 1), blink]);
      return out;
    },
    /* instruction: a cairn of uneven towers, with arched bridges laid between neighbours as they rise */
    stack(c, g) {
      const n = Math.min(MAX, 3 + g * .8 * c.density), out = [], cols = 7, tops = Array(cols).fill(-.92), w = 1.8 / cols;
      const colX = k => -.9 + w * (k + .5);
      for (let i = 0; i < Math.ceil(n); i++) {
        let k = Math.min(cols - 1, Math.floor(Math.abs(h(i, 7) + h(i, 9) - 1) * cols * .999));
        k = ((Math.floor(cols / 2) + (i % 2 ? k : -k)) % cols + cols) % cols;
        const hg = w * (.28 + .3 * h(i, 4)), y = tops[k] + hg * .5; tops[k] += hg * 1.05;
        if (y > .95) continue;
        out.push([colX(k) + (h(i, 11) - .5) * w * .22, y, w * .2 * (.8 + .4 * h(i, 13)) * born(i, n), (h(i, 17) - .5) * 8, mix('stack', c.warm + (y + 1) * .3), .8]);
      }
      for (let k = 0; k + 1 < cols; k++) {                               // bridges
        const top = Math.min(tops[k], tops[k + 1], .9), x0 = colX(k), x1 = colX(k + 1);
        for (let y = -.6 + (k % 2) * .18; y <= top - .04; y += .36)      // a bridge at every level both towers reach
          for (let j = 0; j <= 10; j++) { const u = j / 10; out.push([x0 + (x1 - x0) * u, y + .06 * Math.sin(u * Math.PI), w * .07, (u - .5) * 40, mix('stack', c.warm + .5), .75]); }
      }
      sprigs(out, c);
      return out;
    },
    /* reflection: one still kelp; a branch per idea, a fork for every return, a bud for every phrase, bubbles rising */
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
      const branch = (sx, sy, ang, side, length, col, depth, seed, dim = 1, curl = 0) => {
        let px = sx, py = sy; const end = [];
        for (let k = 0; k < Math.ceil(length); k++) {
          ang += side * (.018 * (k > length * .3 ? 1 : -.2) + curl * .05 * k / length); px += .011 * Math.cos(ang); py += .011 * Math.sin(ang);   // a dormant branch slowly curls
          out.push([px, py, (.015 - depth * .004) * (1 - .6 * k / length) * born(k, length), ang * 57.2958 - 90, col, (.85 - depth * .15) * dim]);
          end.push([px, py, ang]);
        }
        return end;
      };
      topics.slice(0, 18).forEach((tp, i) => {
        const [bx, by, bang] = pts[Math.min(pts.length - 1, Math.floor(pts.length * (.12 + .8 * (i + .5) / Math.max(topics.length, 1))))];
        const side = i % 2 === 0 ? 1 : -1, length = Math.min(90, 6 + tp.words * .9 * c.density);
        const col = mix('kelp', c.warm + .25 + (tp.id === c.activeIdea ? .35 : 0));
        const along = branch(bx, by, bang - side * (.95 + .25 * h(i, 3)), side, length, col, 0, i, dimOf(c, tp), curlOf(c, tp));
        if (along.length) { const e = along[along.length - 1]; tip(out, c, tp, e[0], e[1], e[2], 1); }
        for (let r = 0; r < Math.min(5, tp.returns); r++) {              // a fork for every return
          const at = along[Math.floor(along.length * (.35 + .5 * (r + .5) / Math.max(tp.returns, 1)))]; if (!at) continue;
          branch(at[0], at[1], at[2] + side * .8, -side, length * .45, mix('kelp', c.warm + .45), 1, i * 7 + r);
        }
        for (let b = 0; b < Math.min(12, tp.n || 1); b++) {               // a bud for every phrase
          const at = along[Math.floor(along.length * (b + .5) / Math.min(12, tp.n || 1))]; if (!at) continue;
          out.push([at[0] + side * .012, at[1] + .01, .008, 0, [1, .95, .6], .8, 'dot']);
        }
      });
      for (let i = 0; i < Math.min(40, total * .2); i++) {              // bubbles
        const u = (c.t * .05 * (.5 + h(i, 31)) + h(i, 32)) % 1;
        out.push([(h(i, 33) - .5) * 1.2 + .03 * Math.sin(c.t + i), -1 + 2 * u, .006 + .006 * h(i, 34), 0, [.8, 1, .95], .35 * (1 - u), 'dot']);
      }
      return out;
    },
    /* dialogue: two tides meeting where the speakers' share of the talk balances, foam gathering at the line */
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
      for (let i = 0; i < Math.min(160, g * 1.2); i++) {                 // foam at the meeting line
        const y = -.95 + 1.9 * h(i, 41), jitter = (h(i, 42) - .5) * .12 + .03 * Math.sin(c.t * 3 + i);
        out.push([front + jitter, y, .005 + .006 * h(i, 43), 0, [.95, .98, 1], .4 + .4 * Math.abs(Math.sin(c.t * 2 + i)), 'dot']);
      }
      sprigs(out, c);
      return out;
    },
    /* song: ribbons swelling with the voice; each idea adds a ribbon with a rhythm of its own */
    waves(c, g) {
      const n = Math.min(MAX, 100 + g * 3 * c.density), out = [], per = 90, lines = Math.ceil(n / per) + Math.min(4, Math.max(0, c.ideas.length - 1));
      for (let j = 0; j < lines; j++) {
        const base = -.75 + 1.5 * (j + .5) / Math.max(lines, 1), own = j >= Math.ceil(n / per);
        for (let k = 0; k < per; k++) {
          if (!own && j * per + k >= n) break;
          const x = -1.05 + 2.1 * k / (per - 1), amp = (.08 + .18 * c.e) * (1 + .4 * Math.sin(j)) * (own ? .7 : 1);
          const f = own ? 2 + j * 1.3 : 3 + j * .7;
          const y = base + amp * Math.sin(x * f + c.t * (1.4 + j * .2) * c.speed) + (own ? .03 * Math.sin(x * f * 3 + c.t * 4) : 0);
          out.push([x, y, own ? .011 : .016, 0, mix('waves', c.warm + j * .08 + (own ? .3 : 0)), own ? .6 : .8]);
        }
      }
      sprigs(out, c);
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
  /* opts.transparent: draw over whatever lies beneath (a camera feed) instead of over black */
  /* made for long talks: an image takes about half an hour of speech to fill, and the image in front
     holds the square for at least half a minute before another kind may take it */
  const PACE = .2, DWELL = 30;
  function Renderer(canvas, size, opts) {
    const S = size || 480, clear = !!(opts && opts.transparent);
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
      if (clear) ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${(.34 - .16 * ctxState.c.memory).toFixed(3)})`; ctx.fillRect(0, 0, S, S);
      ctx.globalCompositeOperation = 'lighter';
      const place = layout(ctxState.order, ctxState.lead);
      const slow = { ...ctxState.c, ideas: (ctxState.c.ideas || []).map(i => ({ ...i, words: (i.words || 0) * PACE })) };
      for (const r of REGISTERS) {
        const target = place[r] ? (r === ctxState.lead ? 1 : .8) : 0;
        weight[r] = (weight[r] || 0) + (target - (weight[r] || 0)) * Math.min(1, dt * .5);
        if (weight[r] < .004) { delete at[r]; continue; }
        const goal = place[r] || at[r] || [0, 0, 1];
        const cur = at[r] || (at[r] = goal.slice());
        for (let j = 0; j < 3; j++) cur[j] += (goal[j] - cur[j]) * Math.min(1, dt * .8);
        const w = weight[r], ease = w * w * (3 - 2 * w), k = cur[2] * (.6 + .4 * ease);
        for (const [x, y, s, rot, col, a, form] of G[r](slow, (ctxState.growth[r] || 0) * PACE))
          shape(form || SHAPE[r], cur[0] + x * k, cur[1] + y * k, s * cur[2] * ease, rot, col, a * ease);
      }
      /* the omega gate: a passage of light opens when the image in front changes */
      const age = (now - ctxState.gateAt) / 1000;
      if (age < 3.2) {
        const kk = age / 3.2, grow = .25 + 1.9 * (1 - (1 - kk) ** 3), fade = .7 * (1 - kk) ** 1.5;
        for (let i = 0; i < 160; i++) { const a = (-50 + 280 * i / 159) / 57.3 + Math.PI / 2; shape('dot', Math.cos(a) * .55 * grow, (Math.sin(a) * .55 + .1) * grow, .0065, 0, [1, .93, .7], fade); }
      }
      /* the glow: a soft copy under the sharp one */
      out.globalCompositeOperation = 'source-over';
      if (clear) out.clearRect(0, 0, S, S); else { out.fillStyle = '#000'; out.fillRect(0, 0, S, S); }
      out.globalCompositeOperation = 'lighter';
      out.filter = `blur(${Math.round(S / 60)}px)`; out.globalAlpha = .75; out.drawImage(layer, 0, 0);
      out.filter = 'none'; out.globalAlpha = 1; out.drawImage(layer, 0, 0);
    }
    return { draw };
  }

  const api = { REGISTERS, G, layout, Renderer, PACE, DWELL };
  if (typeof module !== 'undefined') module.exports = api; else root.SpeechformGrowers = api;
})(this);
