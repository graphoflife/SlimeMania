// Procedural pixel art: projectile sprites, slime bodies & faces, hit explosion, tiny font.
// Every sprite is a small canvas; rotated versions are cached in 32 steps with
// nearest-neighbour sampling so they stay crisp.
import { SLIME_R } from './config.js';

const PAL = {
  k: '#000000', w: '#ffffff', y: '#ffe23a', Y: '#fff7b0', o: '#ff8c1a', O: '#c85a00',
  r: '#ff2a3c', R: '#a8102a', p: '#ff6ad5', m: '#ff2ef0', v: '#a64dff', V: '#5a1fb0',
  b: '#2f7dff', B: '#1a3a9e', c: '#3ff0ff', C: '#c4fbff', g: '#3ee35a', G: '#16943a',
  l: '#c0ff3a', s: '#d4dbe6', S: '#7f8a9c', d: '#3a3f4c', D: '#20232c', n: '#a8642c',
  N: '#5e3416', e: '#ffd98a', E: '#d9a24a',
};

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && !globalThis.document) return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---------------------------------------------------------------- colour helpers
export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}
export function hsv(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return rgbToHex([f(5) * 255, f(3) * 255, f(1) * 255]);
}

// ---------------------------------------------------------------- ascii sprites
// 't' = tint colour, 'T' = darker tint.
const ASCII = {
  bullet: ['.Y.', 'yYy', 'yyy', 'ooo', '.O.'],
  pellet: ['.o.', 'oYo', '.o.'],
  drop: ['.C.', 'cCc', 'ccb', '.b.'],
  shuriken: ['...w...', '...S...', '..SsS..', 'wSsdsSw', '..SsS..', '...S...', '...w...'],
  arrow: ['.S.', 'SsS', '.n.', '.n.', '.n.', '.n.', '.n.', 'rnr', 'r.r'],
  leaf: ['..g..', '.glg.', '.glg.', 'gglgG', '.GlG.', '..N..'],
  laser: ['.r.', 'rwr', 'rwr', 'rwr', 'rwr', 'rwr', 'rwr', 'rwr', '.r.'],
  bomb: ['....y.', '...o..', '..kk..', '.kddk.', 'kdwddk', 'kdddDk', 'kddddk', '.kkkk.'],
  frag: ['yo', 'oy'],
  frag_big: ['.o.', 'oyo', '.o.'],
  banana: ['N.......N', 'ky.....yk', 'kyy...yyk', '.kyYYYyk.', '..kkkkk..'],
  dagger: ['..w..', '.sws.', '.sws.', '.sws.', '.SsS.', 'nnnnn', '..N..', '..N..'],
  flake: ['...c...', '.c.c.c.', '..cwc..', 'cccwccc', '..cwc..', '.c.c.c.', '...c...'],
  flake_s: ['..c..', '.cwc.', 'cwwwc', '.cwc.', '..c..'],
  kernel: ['.E.', 'EeE', '.E.'],
  popcorn: ['.wwe.', 'wwYwe', 'ewwwe', '.eYe.'],
  bolt: ['.Y.', 'YwY', '.Y.'],
  flame0: ['.yYy.', 'yYwYy', 'yYwYy', '.yYy.', '..y..'],
  flame1: ['.oyo.', 'oyYyo', 'oyyyo', '.ooo.', '..o..'],
  flame2: ['..r..', '.ror.', 'rooor', '.rrr.'],
  flame3: ['.SS.', 'SddS', '.SS.'],
  nail: ['.s.', '.s.', '.s.', '.S.', '.S.', 'SSS'],
  grenade: ['..S..', '.kSk.', 'kGgGk', 'kgGgk', 'kGgGk', '.kkk.'],
  grenade_red: ['..S..', '.kSk.', 'kRrRk', 'krRrk', 'kRrRk', '.kkk.'],
  grenade_mini: ['.S.', 'rRr', 'RrR', '.R.'],
  plasma0: ['..vvv..', '.vmmmv.', 'vmpwpmv', 'vmwwwmv', 'vmpwpmv', '.vmmmv.', '..vvv..'],
  plasma1: ['..mmm..', '.mpppm.', 'mpwwwpm', 'mpwwwpm', 'mpwwwpm', '.mpppm.', '..mmm..'],
  bubble: ['.ccc.', 'cw..c', 'c...c', 'c..Cc', '.ccc.'],
  bubble_s: ['.c.', 'cwc', '.c.'],
  cannonball: ['.kkkk.', 'kdSddk', 'kSdddk', 'kddddk', 'kdddDk', '.kkkk.'],
  dollar: ['GGGGGGG', 'GlllllG', 'GlGwGlG', 'GlllllG', 'GGGGGGG'],
  icicle: ['.w.', '.C.', '.C.', 'CwC', 'CCc', 'cCc', 'cCc', 'ccc'],
  rocket: ['.r.', 'rrr', 'wbw', 'www', 'www', 'rwr', 'r.r', '.y.'],
  spark: ['.t.', 'twt', '.t.'],
  twinkle: ['tw', 'wt'],
  note: ['..ttttt', '..t...t', '..t...t', '..t...t', 'ttt.ttt', 'tTt.tTt', '.t...t.'],
  duck: ['....yy..', '...yyky.', '...yyyoo', 'y..yyy..', 'yyyyyyy.', 'yyyyyyy.', '.yyyyy..'],
  rock: ['.nnn.', 'nNnnn', 'nnnNn', 'nNnnn', '.nnn.'],
  pebble: ['nN', 'Nn'],
  prism: ['..w..', '.wCw.', 'wCwCw', 'CwCwC', '.CwC.', '..C..'],
  beam: ['.t.', 'twt', 'twt', 'twt', 'twt', 'twt', '.t.'],
  star: ['..y..', '.yYy.', 'yYwYy', '.yYy.', '.y.y.'],
  spark_w: ['wY', 'Yw'],
};

function fromAscii(rows, tint) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const dark = tint ? mix(tint, '#000000', 0.35) : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      g.fillStyle = ch === 't' ? (tint || '#ffffff') : ch === 'T' ? (dark || '#888888') : PAL[ch];
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// pixel disc helper used by procedural sprites
function disc(g, cx, cy, r, color) {
  g.fillStyle = color;
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) g.fillRect(x, y, 1, 1);
    }
  }
}

function procedural(name) {
  if (name === 'saw') {
    const c = makeCanvas(11, 11), g = c.getContext('2d');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.fillStyle = PAL.S;
      g.fillRect(Math.round(5 + Math.cos(a) * 4.6), Math.round(5 + Math.sin(a) * 4.6), 1, 1);
      g.fillStyle = PAL.k;
      g.fillRect(Math.round(5 + Math.cos(a + 0.25) * 5.2), Math.round(5 + Math.sin(a + 0.25) * 5.2), 1, 1);
    }
    disc(g, 5.5, 5.5, 4.2, PAL.S);
    disc(g, 5.5, 5.5, 3.4, PAL.s);
    disc(g, 5.5, 5.5, 1.3, PAL.d);
    g.fillStyle = PAL.w; g.fillRect(3, 3, 1, 1);
    return c;
  }
  if (name === 'bigbomb') {
    const c = makeCanvas(13, 14), g = c.getContext('2d');
    disc(g, 6.5, 7.5, 6, PAL.k);
    disc(g, 6.5, 7.5, 5, PAL.d);
    disc(g, 5, 6, 2, '#5a6070');
    g.fillStyle = PAL.w; g.fillRect(4, 5, 1, 1);
    g.fillStyle = PAL.N; g.fillRect(6, 1, 1, 2); g.fillRect(7, 0, 1, 1);
    g.fillStyle = PAL.y; g.fillRect(8, 0, 1, 1);
    return c;
  }
  if (name === 'star_big') {
    const c = makeCanvas(13, 13), g = c.getContext('2d');
    const pts = (r1, r2, x, y) => {
      for (let py = 0; py < 13; py++) for (let px = 0; px < 13; px++) {
        const dx = px + 0.5 - 6.5, dy = py + 0.5 - 6.5;
        const a = Math.atan2(dy, dx) + Math.PI / 2;
        const k = Math.abs(((a / (Math.PI * 2 / 5)) % 1 + 1) % 1 - 0.5) * 2; // 0 at tips
        const rr = r2 + (r1 - r2) * (1 - k);
        if (Math.hypot(dx, dy) <= rr) { g.fillStyle = x; g.fillRect(px, py, 1, 1); }
      }
    };
    pts(6.5, 3, PAL.O);
    pts(5.3, 2.4, PAL.y);
    pts(3, 1.6, PAL.Y);
    g.fillStyle = PAL.w; g.fillRect(6, 6, 1, 1);
    return c;
  }
  if (name === 'meteor') {
    const c = makeCanvas(11, 15), g = c.getContext('2d');
    // flame tail below (meteor flies upward)
    for (let y = 9; y < 15; y++) {
      const w = Math.max(0, 4 - (y - 9) * 0.7);
      g.fillStyle = y < 11 ? PAL.y : y < 13 ? PAL.o : PAL.r;
      g.fillRect(Math.round(5.5 - w), y, Math.round(w * 2), 1);
    }
    disc(g, 5.5, 5.5, 5, PAL.k);
    disc(g, 5.5, 5.5, 4.2, PAL.n);
    disc(g, 4, 4, 1.2, PAL.e);
    g.fillStyle = PAL.N; g.fillRect(6, 6, 2, 2); g.fillRect(3, 7, 1, 1); g.fillRect(7, 3, 1, 1);
    return c;
  }
  return null;
}

// Projectiles are drawn 50% larger than their pixel maps (nearest neighbour).
export const PROJECTILE_SCALE = 1.5;

function upscale(src, k) {
  const w = Math.round(src.width * k), h = Math.round(src.height * k);
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, w, h);
  return c;
}

const baseCache = new Map();
export function sprite(name, tint = null) {
  const key = tint ? name + tint : name;
  let c = baseCache.get(key);
  if (!c) {
    c = upscale(procedural(name) || fromAscii(ASCII[name] || ASCII.bullet, tint), PROJECTILE_SCALE);
    baseCache.set(key, c);
  }
  return c;
}

// ---------------------------------------------------------------- rotation
export const ROT_STEPS = 32;
const rotCache = new WeakMap();

function rotate(src, ang) {
  const sw = src.width, sh = src.height;
  const size = Math.ceil(Math.hypot(sw, sh)) + 1;
  const sctx = src.getContext('2d');
  const sd = sctx.getImageData(0, 0, sw, sh).data;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const cs = Math.cos(-ang), sn = Math.sin(-ang);
  const cx = size / 2, cy = size / 2, scx = sw / 2, scy = sh / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const sx = Math.floor(dx * cs - dy * sn + scx), sy = Math.floor(dx * sn + dy * cs + scy);
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
      const si = (sy * sw + sx) * 4, di = (y * size + x) * 4;
      if (sd[si + 3] === 0) continue;
      d[di] = sd[si]; d[di + 1] = sd[si + 1]; d[di + 2] = sd[si + 2]; d[di + 3] = sd[si + 3];
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function rotated(src, ang) {
  let step = Math.round((ang / (Math.PI * 2)) * ROT_STEPS) % ROT_STEPS;
  if (step < 0) step += ROT_STEPS;
  if (step === 0) return src;
  let arr = rotCache.get(src);
  if (!arr) { arr = new Array(ROT_STEPS); rotCache.set(src, arr); }
  return arr[step] || (arr[step] = rotate(src, (step / ROT_STEPS) * Math.PI * 2));
}

// ---------------------------------------------------------------- slimes
export function slimePalette(base) {
  if (base === '#111111') return { base: '#2a2a38', shade: '#191922', deep: '#0b0b10', light: '#5c5c78', spec: '#b0b0d0' };
  if (base === '#ffffff') return { base: '#f2f4f8', shade: '#cdd4e6', deep: '#a3aecb', light: '#ffffff', spec: '#ffffff' };
  const shade = mix(mix(base, '#000000', 0.28), '#3020a0', 0.15);
  return {
    base,
    shade,
    deep: mix(mix(base, '#000000', 0.5), '#3020a0', 0.2),
    light: mix(base, '#ffffff', 0.5),
    spec: '#ffffff',
  };
}

export const SQUASH = [-0.1, -0.05, 0, 0.05, 0.1];
export const OUTLINE = 3; // comic outline, the same for every slime size
const bodyCache = new Map();

// size: 0..2, sqi: index into SQUASH, flash: white silhouette
export function slimeBody(color, size, sqi, flash) {
  const key = color + size + sqi + (flash ? 'f' : '');
  let c = bodyCache.get(key);
  if (c) return c;
  const r = SLIME_R[size];
  const sq = SQUASH[sqi];
  const rx = r * (1 + sq), ry = r / (1 + sq);
  const dim = Math.ceil(r * 1.15) * 2 + 2;
  c = makeCanvas(dim, dim);
  const g = c.getContext('2d');
  const cx = dim / 2, cy = dim / 2;
  const ol = OUTLINE;
  const pal = slimePalette(color);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
      const d = u * u + v * v;
      if (d > 1) continue;
      const ui = (x + 0.5 - cx) / (rx - ol), vi = (y + 0.5 - cy) / (ry - ol);
      let col;
      if (ui * ui + vi * vi > 1) col = '#000000';
      else if (flash) col = '#ffffff';
      else {
        // clean bands of flat colour that follow the round body: the lit part is a circle
        // shifted towards the light (top-left), everything outside it is a shade crescent
        const lit = (cu, cv, r) => (u - cu) ** 2 + (v - cv) ** 2 <= r * r;
        col = pal.base;
        if (!lit(-0.14, -0.18, 0.92)) col = pal.shade;
        if (!lit(-0.07, -0.09, 0.98)) col = pal.deep;
        const hx = u + 0.38, hy = v + 0.42;
        if (hx * hx * 1.3 + hy * hy < 0.085) col = pal.light;
        const sx = u + 0.5, sy = v + 0.5;
        if (size < 2 && sx * sx + sy * sy < 0.012) col = pal.spec; // no white dot on the smallest
        if (d > 0.62 && u + v < -0.75 && d < 0.78) col = pal.light; // rim light top-left
      }
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  bodyCache.set(key, c);
  return c;
}

// Face sprites, drawn facing DOWN and scaled to the slime radius;
// rotated at draw time around the slime centre. mode: normal | hurt | blink
const faceBase = new Map();
export function slimeFace(size, mode) {
  const key = size + mode;
  let c = faceBase.get(key);
  if (c) return c;
  const r = SLIME_R[size];
  const dim = Math.ceil(r) * 2 + 2;
  c = makeCanvas(dim, dim);
  const g = c.getContext('2d');
  const cx = dim / 2, cy = dim / 2;
  const ellipse = (ex, ey, rx, ry, col) => {
    g.fillStyle = col;
    for (let y = Math.floor(cy + ey - ry); y <= Math.ceil(cy + ey + ry); y++) {
      for (let x = Math.floor(cx + ex - rx); x <= Math.ceil(cx + ex + rx); x++) {
        const u = (x + 0.5 - cx - ex) / rx, v = (y + 0.5 - cy - ey) / ry;
        if (u * u + v * v <= 1) g.fillRect(x, y, 1, 1);
      }
    }
  };
  const dot = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(cx + x), Math.round(cy + y), w, h); };
  const line = (x0, y0, x1, y1, t) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      dot(x - t / 2, y - t / 2, t, t, '#000');
    }
  };
  const t = size === 2 ? 1 : 2;            // stroke width of lids and mouths
  const sep = r * 0.3, ey = r * 0.1;
  const erx = Math.max(1.6, r * 0.14), ery = Math.max(2.2, r * 0.19);
  for (const s of [-1, 1]) {
    const ex = s * sep;
    if (mode === 'hurt') {
      // squeezed eyes: > <
      const d = -s;
      line(ex - d * erx, ey - ery * 0.8, ex + d * erx * 0.6, ey, t);
      line(ex + d * erx * 0.6, ey, ex - d * erx, ey + ery * 0.8, t);
    } else if (mode === 'blink') {
      line(ex - erx, ey + ery * 0.3, ex + erx, ey + ery * 0.3, t);
    } else if (size === 2) {
      ellipse(ex, ey, erx, ery, '#000');
    } else {
      ellipse(ex, ey, erx + 1.2, ery + 1.2, '#000');
      ellipse(ex, ey, erx, ery, '#fff');
      ellipse(ex, ey + ery * 0.32, erx * 0.62, ery * 0.6, '#000'); // pupil looks forward
    }
  }
  const my = r * 0.5, mw = r * 0.16;
  if (mode === 'hurt') {
    ellipse(0, my, Math.max(1.5, r * 0.09), Math.max(1.5, r * 0.11), '#000');
    if (size < 2) ellipse(0, my + r * 0.03, r * 0.05, r * 0.05, '#c0103a');
  } else {
    // smile: lower half of a circle
    const mr = mw;
    for (let a = 0.15; a <= Math.PI - 0.15; a += 0.08) dot(Math.cos(a) * mr - t / 2, my - mr * 0.5 + Math.sin(a) * mr * 0.8 - t / 2, t, t, '#000');
  }
  faceBase.set(key, c);
  return c;
}

// ---------------------------------------------------------------- hit explosion
// Same sprite for every hit: a round burst, orange/brown with yellow highlights.
export const HIT_FRAMES = 5;
const hitCache = [];
function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function hitFrame(f) {
  if (hitCache[f]) return hitCache[f];
  const dim = 15, c = makeCanvas(dim, dim), g = c.getContext('2d');
  const R = [3, 5, 6.5, 7, 7][f];
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    const dx = x + 0.5 - 7.5, dy = y + 0.5 - 7.5;
    const n = hash(x, y, 7);
    const d = Math.hypot(dx, dy) / (R + (n - 0.5) * 1.6);
    if (d > 1) continue;
    let col = null;
    if (f === 0) col = d < 0.6 ? '#ffffff' : '#fff2a0';
    else if (f === 1) col = d < 0.35 ? '#ffffff' : d < 0.68 ? '#ffd23a' : '#ff8a1a';
    else if (f === 2) col = d < 0.25 ? '#fff2a0' : d < 0.55 ? (n > 0.5 ? '#ffb02a' : '#ff8a1a') : d < 0.85 ? '#d0601a' : '#8a4a20';
    else if (f === 3) { if (d < 0.35) col = n > 0.6 ? '#8a4a20' : null; else if (d < 0.75) col = n > 0.75 ? '#ff9a2a' : '#8a4a20'; else col = n > 0.45 ? '#5e3416' : null; }
    else col = d > 0.55 && n > 0.62 ? '#6a3a18' : null;
    if (!col) continue;
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  }
  return (hitCache[f] = c);
}

// Pre-builds the rotated faces and hit frames a few at a time (call next() in idle time).
export function* warmJobs() {
  for (let f = 0; f < HIT_FRAMES; f++) {
    for (let k = 1; k < ROT_STEPS; k++) { rotated(hitFrame(f), (k / ROT_STEPS) * Math.PI * 2); yield; }
  }
  for (let size = 0; size < 3; size++) {
    for (const mode of ['normal', 'hurt', 'blink']) {
      for (let k = 1; k < ROT_STEPS; k++) { rotated(slimeFace(size, mode), (k / ROT_STEPS) * Math.PI * 2); yield; }
    }
  }
}

// ---------------------------------------------------------------- pixel rings
const ringCache = new Map();
export function ring(r, color) {
  r = Math.max(1, Math.round(r));
  const key = r + color;
  let c = ringCache.get(key);
  if (c) return c;
  const dim = r * 2 + 3;
  c = makeCanvas(dim, dim);
  const g = c.getContext('2d');
  g.fillStyle = color;
  const cx = dim / 2, cy = dim / 2;
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d <= r + 0.5 && d > r - 0.7) g.fillRect(x, y, 1, 1);
  }
  ringCache.set(key, c);
  return c;
}
