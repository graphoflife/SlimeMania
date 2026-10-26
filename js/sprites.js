// Procedural pixel art: projectile sprites, slime bodies & faces, hit explosion.
// Every sprite is a small canvas; rotated versions are cached in 32 steps with
// nearest-neighbour sampling so they stay crisp.
import { SLIME_R } from './config.js';
import { makeCanvas, hexToRgb, rgbToHex, mix, hsv } from './pixelart.js';
import { drawProjectile } from './projectile-art.js';

export { makeCanvas, hexToRgb, rgbToHex, mix, hsv };

// ---------------------------------------------------------------- projectiles
const projCache = new Map();
export function sprite(name, tint = null) {
  const key = tint ? name + tint : name;
  let c = projCache.get(key);
  if (!c) {
    c = drawProjectile(name, tint);
    projCache.set(key, c);
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
