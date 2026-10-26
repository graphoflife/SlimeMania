// Detailed projectile sprites, drawn at their final size from simple signed-distance shapes.
// Every shape gets a dark outline, a highlight band on the side facing the light (top-left)
// and a shade band on the other side. 'dir' sprites point up.
import { makeCanvas, mix } from './pixelart.js';

const LX = -0.6, LY = -0.8; // light direction
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- signed distance shapes
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const ellipse = (cx, cy, rx, ry) => (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
const ring = (cx, cy, r, t) => (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) - t;
const box = (cx, cy, hw, hh, r = 0) => (x, y) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const seg = (ax, ay, bx, by, r) => (x, y) => {
  const px = x - ax, py = y - ay, ex = bx - ax, ey = by - ay;
  const t = clamp((px * ex + py * ey) / (ex * ex + ey * ey || 1), 0, 1);
  return Math.hypot(px - ex * t, py - ey * t) - r;
};
function poly(pts) {
  return (x, y) => {
    let d = (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2;
    let s = 1;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i++) {
      const ex = pts[j][0] - pts[i][0], ey = pts[j][1] - pts[i][1];
      const wx = x - pts[i][0], wy = y - pts[i][1];
      const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
      const bx = wx - ex * t, by = wy - ey * t;
      d = Math.min(d, bx * bx + by * by);
      const c1 = y >= pts[i][1], c2 = y < pts[j][1], c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * Math.sqrt(d);
  };
}
const starPts = (cx, cy, n, ro, ri, rot = -Math.PI / 2) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = rot + (i * Math.PI) / n, r = i % 2 ? ri : ro;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
const star = (cx, cy, n, ro, ri, rot) => poly(starPts(cx, cy, n, ro, ri, rot));
const union = (...fs) => (x, y) => { let d = Infinity; for (const f of fs) d = Math.min(d, f(x, y)); return d; };
const cut = (a, b) => (x, y) => Math.max(a(x, y), -b(x, y));
const both = (a, b) => (x, y) => Math.max(a(x, y), b(x, y));
const mirrorX = (cx, f) => (x, y) => Math.min(f(x, y), f(2 * cx - x, y));

// ---------------------------------------------------------------- palettes
const P = (fill, light, shade, line) => ({ fill, light, shade, line });
const tintP = (t) => P(t, mix(t, '#ffffff', 0.55), mix(t, '#000000', 0.35), mix(t, '#000000', 0.75));
const STEEL = P('#c9d1de', '#ffffff', '#7f8a9c', '#1c2028');
const DARKSTEEL = P('#5a6375', '#9aa3b8', '#2a2f3a', '#0c0e12');
const BRASS = P('#ffd23a', '#fff6b0', '#d08a10', '#4a2a06');
const WOOD = P('#b06a30', '#e0a060', '#6a3a14', '#2a1404');
const RED = P('#ff3a3a', '#ff9a9a', '#b0102a', '#3a0008');
const GREEN = P('#3fbf3a', '#9aeb7a', '#1e6a1e', '#0a2a0a');
const ICE = P('#c4f4ff', '#ffffff', '#58bce8', '#0f4a78');
const GOLD = P('#ffcc33', '#fff3a0', '#c88a00', '#4a3000');
const ORANGE = P('#ff8c1a', '#ffd27a', '#c0500a', '#4a1a00');
const YELLOW = P('#ffe23a', '#fff7b0', '#e0a000', '#5a3a00');
const BOMB = P('#2f3340', '#727a92', '#16181f', '#000000');
const ROCK = P('#a8642c', '#d9965a', '#5e3416', '#241004');
const flat = (fill) => ({ fill });

// ---------------------------------------------------------------- canvas builder
class Art {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Array(w * h).fill(null);
  }

  // f: signed distance, negative inside. o: { fill, light, shade, line, band }
  shape(f, o) {
    const { w, h, px } = this;
    const band = o.band ?? 1.4;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const X = x + 0.5, Y = y + 0.5, i = y * w + x;
        const d = f(X, Y);
        if (d <= 0) {
          let col = o.paint ? o.paint(X, Y) : o.fill;
          if (d > -band && (o.light || o.shade)) {
            const nx = f(X + 0.5, Y) - f(X - 0.5, Y), ny = f(X, Y + 0.5) - f(X, Y - 0.5);
            const dot = (nx * LX + ny * LY) / (Math.hypot(nx, ny) || 1);
            if (dot > 0.3 && o.light) col = o.light;
            else if (dot < -0.3 && o.shade) col = o.shade;
          }
          px[i] = col;
        } else if (o.line && d <= 1 && px[i] === null) px[i] = o.line;
      }
    }
    return this;
  }

  dot(x, y, col) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = col;
    return this;
  }

  dots(list, col) { for (const [x, y] of list) this.dot(x, y, col); return this; }

  canvas() {
    const c = makeCanvas(this.w, this.h);
    const g = c.getContext('2d');
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const col = this.px[y * this.w + x];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }
}

const A = (w, h) => new Art(w, h);

// ---------------------------------------------------------------- sprites
function grenadeArt(w, h, pal) {
  const cx = w / 2;
  const body = ellipse(cx, h * 0.6, w / 2 - 1, h * 0.38);
  const a = A(w, h)
    .shape(box(cx, h * 0.17, 1.6, 1.2), STEEL)
    .shape(body, pal);
  // pineapple grid
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (body(x + 0.5, y + 0.5) > -1.2) continue;
    if (y === Math.round(h * 0.6) || x === Math.floor(cx)) a.dot(x, y, pal.shade);
  }
  return a.shape(ring(cx + 2.2, h * 0.12, 1.3, 0.45), flat('#9aa3b8'));
}

function bombArt(w, h, r) {
  const cx = w / 2, cy = h - r - 1.5;
  return A(w, h)
    .shape(circle(cx, cy, r), BOMB)
    .shape(box(cx, cy - r + 0.5, r * 0.35, 1.2), DARKSTEEL)
    .shape(seg(cx + 0.5, cy - r - 0.5, cx + r * 0.5, cy - r - 2.6, 0.6), flat('#8a5a2a'))
    .dots([[Math.round(cx + r * 0.5) + 1, Math.round(cy - r - 3.6)]], '#ffe23a')
    .dots([[Math.round(cx + r * 0.5) + 1, Math.round(cy - r - 2.6)], [Math.round(cx + r * 0.5) + 2, Math.round(cy - r - 3.6)]], '#ff8c1a')
    .dots([[Math.round(cx - r * 0.45), Math.round(cy - r * 0.45)]], '#ffffff');
}

// upside-down flame: round head in front (up), flickering tip trailing below
function flameArt(w, h, outer, mid, core) {
  const cx = w / 2, cy = h * 0.38, r = w / 2 - 0.6;
  const drop = (rr, tip) => union(circle(cx, cy, rr), poly([[cx, tip], [cx - rr * 0.95, cy + rr * 0.2], [cx + rr * 0.95, cy + rr * 0.2]]));
  const a = A(w, h).shape(drop(r, h - 0.3), flat(outer)).shape(drop(r * 0.68, h * 0.75), flat(mid));
  if (core) a.shape(drop(r * 0.36, h * 0.52), flat(core));
  return a;
}

function plasmaArt(d, outer, inner) {
  const c = d / 2;
  return A(d, d)
    .shape(circle(c, c, c - 0.6), P(outer, mix(outer, '#ffffff', 0.45), mix(outer, '#000000', 0.35), mix(outer, '#000000', 0.7)))
    .shape(circle(c, c, c * 0.62), flat(inner))
    .shape(circle(c, c, c * 0.3), flat('#ffffff'));
}

function sawArt(d, teethN) {
  const c = d / 2, teeth = [];
  for (let k = 0; k < teethN; k++) {
    const a = (k * TAU) / teethN;
    teeth.push([c + Math.cos(a) * (c - 0.3), c + Math.sin(a) * (c - 0.3)], [c + Math.cos(a + 0.42) * c * 0.72, c + Math.sin(a + 0.42) * c * 0.72]);
  }
  const hole = circle(c, c, Math.max(1, d * 0.09));
  return A(d, d)
    .shape(cut(union(poly(teeth), circle(c, c, c * 0.74)), hole), STEEL)
    .shape(cut(ring(c, c, c * 0.45, 0.5), hole), flat('#8f99ab'));
}

// pastel rainbow, in this order across the projectile
const PASTEL = ['#fff59a', '#ffcc8a', '#ff9aa8', '#a8f0a8', '#9ad0ff', '#d4a8ff'];
export { PASTEL };

const DEFS = {
  // a small black slug: round nose, tapered tail
  bullet: () => A(7, 12)
    .shape(union(circle(3.5, 4, 2.7), poly([[0.9, 4.4], [6.1, 4.4], [3.5, 11.4]])), BOMB)
    .dots([[2, 3], [2, 2]], '#b8c0d0'),

  pellet: () => A(7, 7).shape(circle(3.5, 3.5, 2.7), ORANGE).dot(2, 2, '#ffffff'),

  // round end first, pointy end at the bottom
  drop: () => A(9, 12)
    .shape(union(circle(4.5, 4.4, 3.4), poly([[4.5, 11.4], [1.3, 5.4], [7.7, 5.4]])), P('#3ab8ff', '#c4f0ff', '#1a6ad0', '#0a2a6a'))
    .dots([[3, 3], [3, 4]], '#ffffff'),

  shuriken: () => A(15, 15)
    .shape(cut(star(7.5, 7.5, 4, 7, 2.3, -Math.PI / 4 + 0.35), circle(7.5, 7.5, 1.2)), STEEL),

  arrow: () => A(7, 19)
    .shape(mirrorX(3.5, poly([[3.5, 13], [0.5, 17.6], [0.5, 15], [3.5, 11.6]])), RED)
    .shape(box(3.5, 11, 0.7, 6.8), WOOD)
    .shape(poly([[3.5, 0.4], [0.6, 5.2], [6.4, 5.2]]), STEEL),

  leaf: () => {
    const a = A(11, 15)
      .shape(seg(5.5, 12.5, 5.5, 14.3, 0.6), flat('#6a3a14'))
      .shape(both(circle(3.05, 7, 6.95), circle(7.95, 7, 6.95)), P('#3ee35a', '#a8ff9a', '#16943a', '#0a3a16'));
    for (let y = 2; y < 13; y++) a.dot(5, y, '#bfff9a');
    return a.dots([[4, 5], [3, 4], [6, 7], [7, 6], [4, 9], [3, 8], [6, 10], [7, 9]], '#7fe870');
  },

  laser: () => A(5, 17)
    .shape(seg(2.5, 2.5, 2.5, 14.5, 2.1), P('#ff2a3c', '#ff8a96', '#c0102a', '#6a0010'))
    .shape(seg(2.5, 3, 2.5, 14, 0.7), flat('#ffffff')),

  bomb: () => bombArt(13, 16, 5.6),
  bigbomb: () => bombArt(19, 22, 8.3),

  frag: () => A(5, 5).shape(poly([[2.5, 0.3], [4.6, 1.8], [3.8, 4.6], [0.8, 4.2], [0.4, 1.6]]), ORANGE),
  frag_big: () => A(7, 7).shape(poly([[3.6, 0.3], [6.6, 2.4], [5.4, 6.6], [1.6, 6.2], [0.4, 2.4]]), ORANGE).dot(3, 2, '#fff3a0'),

  banana: () => {
    // lower half of a thick ring: a proper crescent
    const body = both(ring(8.5, 0.5, 7.2, 2.3), box(8.5, 7, 9, 4.6));
    return A(17, 11)
      .shape(body, P('#ffe23a', '#fff7b0', '#d9a20a', '#5a3a00'))
      .shape(both(body, union(box(1.2, 3.4, 1.6, 1.4), box(15.8, 3.4, 1.6, 1.4))), flat('#6a4210'));
  },

  dagger: () => A(9, 19)
    .shape(poly([[4.5, 0.4], [1.8, 4.2], [1.8, 11.6], [7.2, 11.6], [7.2, 4.2]]), STEEL)
    .shape(box(4.5, 7.5, 0.5, 4), flat('#ffffff'))
    .shape(box(4.5, 12.6, 4, 0.9), GOLD)
    .shape(box(4.5, 15.6, 1.2, 2.2), WOOD)
    .shape(circle(4.5, 18, 1.2), GOLD),

  flake: () => {
    const arms = [];
    for (let k = 0; k < 6; k++) {
      const a = (k * TAU) / 6 - Math.PI / 2, ex = 7.5 + Math.cos(a) * 6.4, ey = 7.5 + Math.sin(a) * 6.4;
      arms.push(seg(7.5, 7.5, ex, ey, 0.8));
      const bx = 7.5 + Math.cos(a) * 4, by = 7.5 + Math.sin(a) * 4;
      for (const s of [-1, 1]) arms.push(seg(bx, by, bx + Math.cos(a + s * 0.9) * 2.4, by + Math.sin(a + s * 0.9) * 2.4, 0.6));
    }
    return A(15, 15).shape(union(...arms, circle(7.5, 7.5, 1.8)), ICE).dot(7, 7, '#ffffff');
  },
  flake_s: () => {
    const arms = [];
    for (let k = 0; k < 6; k++) {
      const a = (k * TAU) / 6 - Math.PI / 2;
      arms.push(seg(4.5, 4.5, 4.5 + Math.cos(a) * 3.6, 4.5 + Math.sin(a) * 3.6, 0.7));
    }
    return A(9, 9).shape(union(...arms, circle(4.5, 4.5, 1.2)), ICE);
  },

  kernel: () => A(7, 8)
    .shape(ellipse(3.5, 4, 2.4, 3), P('#ffd98a', '#fff3c8', '#d9a24a', '#6a4010'))
    .shape(both(ellipse(3.5, 4, 2.4, 3), box(3.5, 6.6, 3, 1)), flat('#b07a2a')),

  popcorn: () => A(12, 11)
    .shape(union(circle(4.2, 4.4, 2.7), circle(7.6, 3.8, 2.7), circle(6, 7, 3), circle(8.8, 7, 2.3), circle(3, 7.4, 2.1)),
      P('#fffaf0', '#ffffff', '#efcf7a', '#8a6020'))
    .dots([[5, 9], [6, 9], [7, 9]], '#e0a040'),

  bolt: () => A(9, 9)
    .shape(star(4.5, 4.5, 6, 4.3, 2.2, 0.2), P('#fff27a', '#ffffff', '#e0b000', '#8a6a00'))
    .shape(circle(4.5, 4.5, 1.4), flat('#ffffff')),

  flame0: () => flameArt(9, 12, '#ffd21a', '#fff27a', '#ffffff'),
  flame1: () => flameArt(11, 13, '#ff8c1a', '#ffd21a', '#fff7b0'),
  flame2: () => flameArt(11, 12, '#e8301a', '#ff8c1a', '#ffd21a'),
  flame3: () => A(9, 8).shape(union(circle(3.5, 4.5, 2.6), circle(5.8, 3.6, 2.4), circle(5.6, 5.6, 2)), P('#8a8f9c', '#b8bcc6', '#5a5f6c')),

  nail: () => A(5, 15)
    .shape(poly([[2.5, 0.3], [1.2, 3.4], [3.8, 3.4]]), STEEL)
    .shape(box(2.5, 8, 1.1, 5), STEEL)
    .shape(box(2.5, 13.6, 2.4, 0.9), DARKSTEEL),

  grenade: () => grenadeArt(11, 14, GREEN),
  grenade_mini: () => grenadeArt(8, 10, GREEN),

  plasma_m0: () => plasmaArt(11, '#a64dff', '#ff6ad5'),
  plasma_m1: () => plasmaArt(11, '#ff2ef0', '#ff9ae6'),
  plasma_s0: () => plasmaArt(8, '#a64dff', '#ff6ad5'),
  plasma_s1: () => plasmaArt(8, '#ff2ef0', '#ff9ae6'),
  plasma0: () => A(15, 15)
    .shape(circle(7.5, 7.5, 6.6), P('#a64dff', '#d29aff', '#6a1fc0', '#2a0a5a'))
    .shape(circle(7.5, 7.5, 4.4), flat('#ff6ad5'))
    .shape(circle(7.5, 7.5, 2.3), flat('#ffffff'))
    .dots([[3, 5], [11, 9], [5, 11], [10, 4]], '#ffd0f4'),
  plasma1: () => A(15, 15)
    .shape(circle(7.5, 7.5, 6.2), P('#ff2ef0', '#ff9af6', '#a010a8', '#3a0040'))
    .shape(circle(7.5, 7.5, 4.8), flat('#ff9ae6'))
    .shape(circle(7.5, 7.5, 2.8), flat('#ffffff'))
    .dots([[4, 10], [10, 3], [12, 8], [3, 6]], '#ffffff'),

  bubble: () => A(8, 8)
    .shape(ring(4, 4, 2.9, 0.6), P('#7fe8ff', '#ffffff', '#2aa8d8', '#0a4a7a'))
    .dots([[2, 2], [3, 2]], '#ffffff'),
  bubble_s: () => A(5, 5)
    .shape(ring(2.5, 2.5, 1.6, 0.55), P('#7fe8ff', '#ffffff', '#2aa8d8', '#0a4a7a')),

  rainbow: () => A(8, 13)
    .shape(seg(4, 4, 4, 9, 3.3), { paint: (x) => PASTEL[clamp(Math.floor(x - 1), 0, 5)], line: '#5a5070' })
    .dots([[2, 2], [2, 3]], '#ffffff'),

  saw: () => sawArt(19, 12),
  saw_m: () => sawArt(13, 9),
  saw_s: () => sawArt(9, 7),

  icicle: () => A(7, 19)
    .shape(poly([[3.5, 0.3], [0.6, 14.6], [3.5, 18.7], [6.4, 14.6]]), ICE)
    .shape(poly([[3.5, 2], [2.9, 14.6], [3.5, 17], [4.1, 14.6]]), flat('#ffffff')),

  rocket: () => A(9, 21)
    .shape(mirrorX(4.5, poly([[1.6, 12], [0.2, 16.5], [0.2, 18], [2.4, 16]])), RED)
    .shape(seg(4.5, 6, 4.5, 15.5, 2.9), P('#f4f4f4', '#ffffff', '#aab2c4', '#1c2028'))
    .shape(poly([[4.5, 0.3], [1.7, 5], [7.3, 5]]), RED)
    .shape(circle(4.5, 9, 1.4), P('#3ab8ff', '#c4f0ff', '#1a6ad0', '#0a2a6a'))
    .shape(box(4.5, 19.2, 1.4, 1), flat('#ffd21a'))
    .dots([[4, 20]], '#ff8c1a'),

  spark: (t) => A(7, 7).shape(star(3.5, 3.5, 4, 3.4, 1.2), P(t, mix(t, '#ffffff', 0.6), t, mix(t, '#000000', 0.5))).dot(3, 3, '#ffffff'),
  twinkle: (t) => A(5, 5).shape(star(2.5, 2.5, 4, 2.4, 0.9), flat(t)).dot(2, 2, '#ffffff'),

  note: (t) => A(13, 15)
    .shape(union(
      ellipse(3.4, 12.4, 2.7, 2), ellipse(10, 11, 2.7, 2),
      box(5.4, 7.6, 0.7, 5), box(12, 6.2, 0.7, 5),
      poly([[4.7, 2.2], [12.7, 0.6], [12.7, 3.2], [4.7, 4.8]]),
    ), tintP(t)),

  duck: () => A(17, 15)
    .shape(poly([[13.5, 4.4], [16.8, 5.2], [16.8, 6.6], [13.5, 6.8]]), ORANGE)
    .shape(union(ellipse(8, 10.4, 7.2, 4.2), circle(11.4, 5.2, 3.7), poly([[0.4, 7], [3.5, 9], [1.2, 10.5]])), YELLOW)
    .shape(ellipse(6.5, 10.2, 3.2, 2), P('#ffe23a', '#fff7b0', '#e0a000'))
    .dots([[12, 4]], '#000000')
    .dot(11, 4, '#ffffff'),

  rock: () => A(11, 10)
    .shape(poly([[3, 0.6], [8, 0.8], [10.4, 4], [9, 9], [3.4, 9.4], [0.5, 5.4]]), ROCK)
    .dots([[6, 4], [3, 6], [7, 7]], '#5e3416'),
  pebble: () => A(5, 5).shape(poly([[1.4, 0.4], [4.4, 1], [4.6, 4], [1.6, 4.6], [0.4, 2.4]]), ROCK),

  meteor: () => {
    // flame tail below the rock (the meteor flies upwards)
    const fl = (r) => poly([[7.5 - r, 10], [7.5, 20.6 - (5 - r)], [7.5 + r, 10]]);
    return A(15, 21)
      .shape(fl(5), flat('#ff4a1a'))
      .shape(fl(3.4), flat('#ff9a1a'))
      .shape(fl(1.8), flat('#ffe23a'))
      .shape(circle(7.5, 7.4, 6.4), ROCK)
      .shape(circle(9.2, 8.6, 1.5), flat('#6a3a14'))
      .shape(circle(5.4, 9.6, 1), flat('#6a3a14'))
      .shape(circle(8.4, 4.4, 0.9), flat('#6a3a14'))
      .dots([[5, 4]], '#f0c090');
  },

  star: () => A(11, 11).shape(star(5.5, 5.8, 5, 5.2, 2.2), YELLOW).dot(4, 4, '#ffffff'),
  star_big: () => A(19, 19)
    .shape(star(9.5, 10, 5, 9.2, 3.9), YELLOW)
    .shape(star(9.5, 10, 5, 4.6, 1.9), flat('#fff3a0'))
    .dots([[7, 7], [8, 7]], '#ffffff'),
  spark_w: () => A(5, 5).shape(star(2.5, 2.5, 4, 2.4, 0.9), flat('#fff7b0')).dot(2, 2, '#ffffff'),
};

export function drawProjectile(name, tint) {
  const def = DEFS[name] || DEFS.bullet;
  return def(tint || '#ffffff').canvas();
}
