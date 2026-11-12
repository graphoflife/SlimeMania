// What makes a campaign slime kind recognisable at a glance: a sweatband, cracks, a bow, feet,
// drips, a nurse's cap, a crown... Overlays are drawn around the same centre as the slime body,
// for the same size and squash step, so they sit exactly on it. They have a little room around
// the body for what sticks out (feet, drips, hats, antennae); the bubble goes around it all.
import { SLIME_R, BOSS } from './config.js';
import { PixBuf, canvasFromPixels } from './pixelart.js';
import { RNG } from './rng.js';
import { SQUASH, OUTLINE, slimeBody, slimeFace, slimePalette, rotated, ROT_STEPS } from './sprites.js';

const cache = new Map();
const cached = (key, build) => {
  let c = cache.get(key);
  if (c === undefined) cache.set(key, (c = build()));
  return c;
};

// The body's frame: canvas size (the body's plus room around it), its centre, the radii, the
// ellipse inside the comic outline and the body's lower edge.
function frame(size, sqi, aspect = 1) {
  const r = SLIME_R[size], sq = SQUASH[sqi];
  const rx = r * (1 + sq) * aspect, ry = r / (1 + sq) / aspect;
  const dim = (Math.ceil(r * 1.15 * aspect) + Math.ceil(r * 0.5)) * 2 + 2; // the body's canvas, plus room
  const c = dim / 2, ol = OUTLINE;
  const inner = (x, y) => ((x + 0.5 - c) / (rx - ol)) ** 2 + ((y + 0.5 - c) / (ry - ol)) ** 2 <= 1;
  const bottom = (x) => c + ry * Math.sqrt(Math.max(0, 1 - ((x - c) / rx) ** 2)); // lower edge at x
  return { r, rx, ry, dim, c, inner, bottom, b: new PixBuf(dim, dim) };
}

// The overlay as a picture cropped to its pixels (most of the frame is empty), placed by its
// centre like the turned faces are (see blit / blitScaled).
function crop(f) {
  const { w, h, data } = f.b;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] === 0) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, d = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) d.set(data.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x1 + 1) * 4), y * cw * 4);
  return Object.assign(canvasFromPixels(cw, ch, d), { fullW: w, fullH: h, bx: x0, by: y0, ax: f.c - x0, ay: f.c - y0 });
}

// Fills a shape (inside(x, y) for pixel centres) and gives it a 1 px dark outline.
function shape(b, inside, fill, line = '#000000') {
  const { w, h } = b, mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x + 0.5, y + 0.5)) { mask[y * w + x] = 1; b.set(x, y, typeof fill === 'function' ? fill(x + 0.5, y + 0.5) : fill); }
  if (!line) return;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mask[y * w + x]) continue;
    const near = (x > 0 && mask[y * w + x - 1]) || (x < w - 1 && mask[y * w + x + 1]) || (y > 0 && mask[(y - 1) * w + x]) || (y < h - 1 && mask[(y + 1) * w + x]);
    if (near) b.set(x, y, line);
  }
}

const inPoly = (pts) => (px, py) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const inEllipse = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const inSeg = (ax, ay, bx, by, t) => (x, y) => {
  const dx = bx - ax, dy = by - ay, k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - dx * k, y - ay - dy * k) <= t;
};

// a band across the head (sweatband, nurse's cap), from v0 to v1 of the inner height
function headBand(f, v0, v1, col, mid) {
  const ry = f.ry - OUTLINE, y0 = Math.round(f.c + ry * v0), y1 = Math.round(f.c + ry * v1);
  for (let y = y0; y <= y1; y++) for (let x = 0; x < f.dim; x++) {
    if (!f.inner(x, y)) continue;
    const edge = f.r > 15 && (y === y0 || y === y1);
    f.b.set(x, y, edge ? '#000000' : mid && f.r > 30 && y === Math.round((y0 + y1) / 2) ? mid : col);
  }
  return [y0, y1];
}

// ---------------------------------------------------------------- overlays
// Zippy: a red sweatband round its forehead, the knot's ends flying out at the side.
function band(size, sqi) {
  const f = frame(size, sqi);
  const [y0, y1] = headBand(f, -0.68, -0.42, '#ff3a5c', '#ffffff');
  if (size < 2) {
    const x = f.c + f.rx - OUTLINE - 1, y = (y0 + y1) / 2 + 0.5, L = size === 0 ? 7 : 5, t = size === 0 ? 1.3 : 0.9;
    const a = inSeg(x, y, x + L, y - L * 0.25, t), c = inSeg(x, y, x + L * 0.8, y + L * 0.55, t);
    shape(f.b, (px, py) => px > x + 1 && (a(px, py) || c(px, py)), '#ff3a5c');
  }
  return crop(f);
}

// Stone: speckles, and cracks that grow as it gets hurt (stage 0..3).
function cracks(size, sqi, stage) {
  const f = frame(size, sqi), b = f.b, rng = new RNG(size * 131 + 7);
  for (let i = 0; i < f.r * 0.6; i++) {
    const x = Math.floor(f.c + rng.range(-f.rx, f.rx)), y = Math.floor(f.c + rng.range(-f.ry, f.ry));
    if (f.inner(x, y)) b.set(x, y, rng.next() < 0.5 ? '#6f7588' : '#c3c8d6');
  }
  for (let k = 0; k < stage; k++) {
    // a jagged line from the edge towards the middle
    const a = rng.range(0, Math.PI * 2) + k * 2.1;
    let x = f.c + Math.cos(a) * (f.rx - OUTLINE - 1), y = f.c + Math.sin(a) * (f.ry - OUTLINE - 1);
    let dir = a + Math.PI;
    const n = Math.round(f.r * (0.55 + k * 0.12));
    for (let i = 0; i < n; i++) {
      dir += rng.range(-0.7, 0.7);
      x += Math.cos(dir); y += Math.sin(dir);
      const X = Math.round(x), Y = Math.round(y);
      if (!f.inner(X, Y)) break;
      b.set(X, Y, '#1e2028');
      if (size === 0) b.set(X + 1, Y, '#1e2028');
      else if (size === 1 && i % 2 === 0) b.set(X, Y + 1, '#1e2028');
    }
  }
  return crop(f);
}

// Mama: a big pink bow on the side of her head.
function bow(size, sqi) {
  const f = frame(size, sqi);
  const s = f.r * 0.24, bx = f.c + f.rx * 0.36, by = f.c - f.ry + f.r * 0.14;
  const loop = (sx) => (x, y) => ((x - (bx + sx * s * 0.95)) / (s * 0.95)) ** 2 + ((y - by + sx * (x - bx) * 0.12) / (s * 0.62)) ** 2 <= 1;
  const knot = (x, y) => (x - bx) ** 2 + (y - by) ** 2 <= (s * 0.42) ** 2;
  shape(f.b, (x, y) => loop(-1)(x, y) || loop(1)(x, y) || knot(x, y), (x, y) => (knot(x, y) ? '#d81670' : y < by - s * 0.15 ? '#ff9ac8' : '#ff2f8e'));
  return crop(f);
}

// Hopper: two springy feet under it.
function feet(size, sqi) {
  const f = frame(size, sqi);
  for (const side of [-1, 1]) {
    const x = f.c + side * f.rx * 0.42, y = f.bottom(x) - 1;
    shape(f.b, inEllipse(x, y, f.r * 0.26, Math.max(2, f.r * 0.13)), (px, py) => (py < y - f.r * 0.04 ? '#ff9a3a' : '#c0500a'));
  }
  return crop(f);
}

// Gloop: drips hanging from its lower edge.
function drips(size, sqi, base) {
  const f = frame(size, sqi), pal = slimePalette(base);
  for (const [u, len] of [[-0.45, 0.24], [0.08, 0.36], [0.52, 0.18]]) {
    const x = f.c + u * f.rx, y = f.bottom(x) - 2, L = f.r * len, t = Math.max(1, f.r * 0.08);
    const stem = inSeg(x, y, x, y + L, t), end = inEllipse(x, y + L, t * 1.6, t * 1.7);
    shape(f.b, (px, py) => py > y - 1 && (stem(px, py) || end(px, py)), (px) => (px < x - t * 0.3 ? pal.light : base));
  }
  return crop(f);
}

// Grumpy: an anger mark once it is hurt.
function vein(size, sqi) {
  const f = frame(size, sqi), k = size === 0 ? 2 : 1;
  const x0 = Math.round(f.c + f.rx * 0.42), y0 = Math.round(f.c - f.ry * 0.62);
  const rows = ['.X.X.', 'XX.XX', '.....', 'XX.XX', '.X.X.'];
  shape(f.b, (x, y) => {
    const i = Math.floor((x - x0) / k), j = Math.floor((y - y0) / k);
    return rows[j]?.[i] === 'X';
  }, '#ff2a3c');
  return crop(f);
}

// Ghost: a wavy hem under it, like a sheet.
function wisps(size, sqi, base) {
  const f = frame(size, sqi), light = slimePalette(base).light, n = 4, w = (f.rx * 1.5) / n;
  for (let i = 0; i < n; i++) {
    const x = f.c - f.rx * 0.75 + w * (i + 0.5), y = f.bottom(x) - 2;
    shape(f.b, (px, py) => py > y - 1 && inEllipse(x, y, w * 0.48, f.r * 0.22)(px, py), light);
  }
  return crop(f);
}

// Medic: a white nurse's cap with a red cross.
function nurse(size, sqi) {
  const f = frame(size, sqi);
  const [y0, y1] = headBand(f, -0.86, -0.5, '#ffffff');
  const cy = (y0 + y1) / 2 + 0.5, a = Math.max(1, (y1 - y0) * 0.38), t = Math.max(0.6, a * 0.38);
  shape(f.b, (x, y) => (Math.abs(x - f.c) <= t && Math.abs(y - cy) <= a) || (Math.abs(y - cy) <= t && Math.abs(x - f.c) <= a), '#ff2a3c', null);
  return crop(f);
}

// Spitter: puffed cheeks.
function cheeks(f) {
  for (const side of [-1, 1]) {
    const x = f.c + side * f.rx * 0.6, y = f.c + f.ry * 0.2, r = f.r * 0.2;
    shape(f.b, inEllipse(x, y, r, r * 0.8), (px, py) => (px < x - r * 0.3 && py < y - r * 0.2 ? '#ffd0dc' : '#ff8aa8'), null);
  }
}

// Swarm: bee stripes and two antennae.
function bee(size, sqi) {
  const f = frame(size, sqi), ry = f.ry - OUTLINE;
  for (const [v0, v1] of [[-0.12, 0.12], [0.42, 0.66]]) {
    for (let y = Math.round(f.c + ry * v0); y <= Math.round(f.c + ry * v1); y++) for (let x = 0; x < f.dim; x++) if (f.inner(x, y)) f.b.set(x, y, '#2a2a38');
  }
  for (const side of [-1, 1]) {
    const x = f.c + side * 3, y = f.c - f.ry + 1;
    shape(f.b, (px, py) => inSeg(x, y, x + side * 3, y - 5, 0.6)(px, py) || inEllipse(x + side * 3.5, y - 5.5, 1.3, 1.3)(px, py), '#2a2a38', null);
  }
  return crop(f);
}

// King: a golden crown with three points and gems.
function crown(size, sqi) {
  const f = frame(size, sqi), b = f.b;
  const w = f.r * 0.62, h = f.r * 0.4, x0 = f.c - w / 2, base = f.c - f.ry + f.r * 0.2, top = base - h;
  const pts = [[x0, base], [x0, top + h * 0.25], [x0 + w * 0.22, top + h * 0.58], [x0 + w * 0.5, top], [x0 + w * 0.78, top + h * 0.58], [x0 + w, top + h * 0.25], [x0 + w, base]];
  shape(b, inPoly(pts), (x, y) => (y > base - h * 0.3 ? '#e09a10' : x < f.c - w * 0.15 ? '#fff3a0' : '#ffd23a'));
  for (const [col, t] of [['#ff2a3c', 0.25], ['#2f8cff', 0.5], ['#1ee05a', 0.75]]) shape(b, inEllipse(x0 + w * t, base - h * 0.16, 2.05, 2.05), col, null);
  for (const [px, py] of [pts[1], pts[3], pts[5]]) shape(b, inEllipse(px, py, 2.45, 2.45), '#fff3a0');
  return crop(f);
}

// Rock golem: stone plates on its head and shoulders (clear of the face), breaking off one by
// one (stage 0..3).
function plates(size, sqi, stage) {
  const f = frame(size, sqi), r = f.r;
  const fill = (top) => (x, y) => (y < top + 3 ? '#a3a9ba' : '#5d6376');
  const parts = [
    [2, inEllipse(f.c, f.c - f.ry * 0.66, r * 0.34, r * 0.2), f.c - f.ry * 0.66 - r * 0.2],
    [1, inEllipse(f.c - f.rx * 0.62, f.c - f.ry * 0.3, r * 0.26, r * 0.22), f.c - f.ry * 0.3 - r * 0.22],
    [0, inEllipse(f.c + f.rx * 0.62, f.c - f.ry * 0.3, r * 0.26, r * 0.22), f.c - f.ry * 0.3 - r * 0.22],
  ];
  for (const [k, inside, top] of parts) if (stage <= k) shape(f.b, (x, y) => f.inner(x, y) && inside(x, y), fill(top));
  return crop(f);
}

// Phantom: a tall wizard's hat (and the ghost's wavy hem, a separate overlay).
function hat(size, sqi) {
  const f = frame(size, sqi), r = f.r, top = f.c - f.ry + r * 0.18;
  shape(f.b, inPoly([[f.c - r * 0.42, top], [f.c + r * 0.42, top], [f.c + r * 0.18, top - r * 0.38], [f.c + r * 0.34, top - r * 0.62], [f.c - r * 0.02, top - r * 0.44]]),
    (x, y) => (y > top - r * 0.1 ? '#ffd23a' : x < f.c - r * 0.1 ? '#6a4ab0' : '#3a2a6a'));
  return crop(f);
}

// Sinker: the handle of a kettlebell on top. Heavy!
function handle(size, sqi) {
  const f = frame(size, sqi), r = f.r, cx = f.c, cy = f.c - f.ry + r * 0.12, R = r * 0.3, t = Math.max(1.2, r * 0.09);
  shape(f.b, (x, y) => y < cy + 1 && Math.abs(Math.hypot(x - cx, y - cy) - R) <= t, (x, y) => (x < cx - R * 0.3 && y < cy - R * 0.5 ? '#e0e6f0' : '#8f99ab'));
  return crop(f);
}

// Wiggler: dark diamonds along its oval body, like a snake's back.
function diamonds(size, sqi, aspect) {
  const f = frame(size, sqi, aspect), s = f.r * 0.13;
  for (let k = -2; k <= 2; k++) {
    const x = f.c + k * f.rx * 0.33, y = f.c - f.ry * 0.38;
    shape(f.b, (px, py) => f.inner(px, py) && Math.abs(px - x) / (s * 1.3) + Math.abs(py - y) / s <= 1, '#4a7a10', null);
  }
  return crop(f);
}

// Blinker: an antenna with a glowing ball.
function antenna(size, sqi) {
  const f = frame(size, sqi), r = f.r, x = f.c + r * 0.12, y0 = f.c - f.ry + 1, y1 = y0 - r * 0.42;
  shape(f.b, (px, py) => inSeg(x, y0, x + r * 0.08, y1, Math.max(0.6, r * 0.04))(px, py) || inEllipse(x + r * 0.08, y1, r * 0.13, r * 0.13)(px, py),
    (px, py) => (py < y1 + r * 0.14 ? (px < x + r * 0.05 ? '#fff7b0' : '#ffe23a') : '#2a2a38'));
  return crop(f);
}

// Bomber: a fuse coming out of the top (its spark is drawn live).
function fuse(size, sqi) {
  const f = frame(size, sqi), r = f.r, x0 = f.c + r * 0.1, y0 = f.c - f.ry + 2;
  const a = inSeg(x0, y0, x0 + r * 0.12, y0 - r * 0.22, Math.max(0.7, r * 0.05)), b = inSeg(x0 + r * 0.12, y0 - r * 0.22, x0 + r * 0.3, y0 - r * 0.32, Math.max(0.7, r * 0.05));
  shape(f.b, (px, py) => a(px, py) || b(px, py), '#c8a070');
  shape(f.b, inEllipse(x0, y0 + 1, r * 0.16, r * 0.08), '#5c5c70'); // its cap
  return crop(f);
}

// Sleepy: a "z z" while it sleeps.
function zzz(size, sqi) {
  const f = frame(size, sqi), k = size === 0 ? 2 : 1;
  const Z = ['XXXX', '..X.', '.X..', 'XXXX'];
  for (const [ox, oy, kk] of [[0.45, -0.95, k], [0.75, -1.25, Math.max(1, k - 1)]]) {
    const x0 = Math.round(f.c + f.rx * ox), y0 = Math.round(f.c + f.ry * oy);
    shape(f.b, (x, y) => Z[Math.floor((y - y0) / kk)]?.[Math.floor((x - x0) / kk)] === 'X', '#ffffff');
  }
  return crop(f);
}

// Spitter tank: a riveted iron helmet, and the cheeks of course.
function helmet(size, sqi) {
  const f = frame(size, sqi), r = f.r, cy = f.c - f.ry + r * 0.32;
  cheeks(f);
  shape(f.b, (x, y) => y < cy + r * 0.06 && inEllipse(f.c, cy, r * 0.66, r * 0.4)(x, y), (x, y) => (x < f.c - r * 0.25 && y < cy - r * 0.15 ? '#c9d1de' : '#8f99ab'));
  for (let i = -2; i <= 2; i++) f.b.set(Math.round(f.c + i * r * 0.22), Math.round(cy), '#4a5370');
  return crop(f);
}

const stageOf = (s) => (s.stage !== undefined && s.kind.plates ? s.stage : s.hp > s.maxHp * 0.75 ? 0 : s.hp > s.maxHp * 0.5 ? 1 : s.hp > s.maxHp * 0.25 ? 2 : 3);

// The overlays a slime of a kind wears (for its size, squash step and how hurt it is).
export function kindOverlays(s, size, sqi) {
  const k = s.kind, base = k.colors?.[size === BOSS ? 0 : size];
  switch (k.id) {
    case 'zippy': return [cached(`band${size}${sqi}`, () => band(size, sqi))];
    case 'stone': { const st = stageOf(s); return [cached(`crack${size}${sqi}${st}`, () => cracks(size, sqi, st))]; }
    case 'mama': return [cached(`bow${size}${sqi}`, () => bow(size, sqi))];
    case 'hopper': return [cached(`feet${size}${sqi}`, () => feet(size, sqi))];
    case 'gloop': case 'gloopMother': return [cached(`drip${k.id}${size}${sqi}`, () => drips(size, sqi, base))];
    case 'grumpy': return s.hp < s.maxHp * 0.75 ? [cached(`vein${size}${sqi}`, () => vein(size, sqi))] : NONE;
    case 'ghost': return [cached(`wisp${k.id}${size}${sqi}`, () => wisps(size, sqi, base))];
    case 'phantom': return [cached(`wisp${k.id}${size}${sqi}`, () => wisps(size, sqi, base)), cached(`hat${size}${sqi}`, () => hat(size, sqi))];
    case 'medic': return [cached(`nurse${size}${sqi}`, () => nurse(size, sqi))];
    case 'spitter': return [cached(`cheeks${size}${sqi}`, () => { const f = frame(size, sqi); cheeks(f); return crop(f); })];
    case 'swarm': return [cached(`bee${size}${sqi}`, () => bee(size, sqi))];
    case 'king': return [cached(`crown${size}${sqi}`, () => crown(size, sqi))];
    case 'golem': { const st = stageOf(s); return [cached(`plates${size}${sqi}${st}`, () => plates(size, sqi, st)), cached(`crack${size}${sqi}${st}`, () => cracks(size, sqi, st))]; }
    case 'spitTank': return [cached(`helmet${size}${sqi}`, () => helmet(size, sqi))];
    case 'sinker': return [cached(`handle${size}${sqi}`, () => handle(size, sqi))];
    case 'wiggler': return [cached(`diamonds${size}${sqi}`, () => diamonds(size, sqi, k.aspect))];
    case 'blinker': return [cached(`antenna${size}${sqi}`, () => antenna(size, sqi))];
    case 'bomber': return [cached(`fuse${size}${sqi}`, () => fuse(size, sqi))];
    case 'sleepy': return s.asleep ? [cached(`zzz${size}${sqi}`, () => zzz(size, sqi))] : NONE;
    default: return NONE;
  }
}
const NONE = [];

// Bubble: a soap bubble around the slime (gone once it has soaked up its share of hits).
export function bubbleSprite(size) {
  return cached(`bubble${size}`, () => {
    const R = SLIME_R[size] + 4, dim = Math.ceil(R) * 2 + 4, c = dim / 2, b = new PixBuf(dim, dim);
    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      if (Math.abs(d - R) < 0.75) b.set(x, y, '#d8f6ff');
      else if (d < R - 0.75 && d > R - 3 && a > -2.6 && a < -1.9) b.set(x, y, '#ffffff'); // shine, top left
      else if (d < R) b.set(x, y, 'rgba(190, 236, 255, 0.16)');
    }
    return b.canvas();
  });
}

// ---------------------------------------------------------------- warm-up
// Bodies (every squash step, with and without flash), overlays and the turned faces a level's
// kinds need, built a little at a time before they are needed.
export function* warmKinds(kinds) {
  for (const kind of new Set(kinds)) {
    const sizes = kind.boss ? [BOSS] : kind.swarm ? [2] : [0, 1, 2];
    for (const size of sizes) {
      // kinds in the level's colours have their bodies built with the level (warmSlimes)
      const colors = kind.rainbow ?? (kind.colors ? [kind.colors[kind.boss ? 0 : size]] : []);
      for (let sqi = 0; sqi < SQUASH.length; sqi++) {
        for (const color of colors) for (const flash of [false, true]) { slimeBody(color, size, sqi, flash, kind.aspect ?? 1); yield; }
        for (const hp of [1, 0.7, 0.4, 0.1]) { kindOverlays({ kind, hp, maxHp: 1, stage: Math.round((1 - hp) * 3.4), asleep: true }, size, sqi); yield; }
      }
      if (kind.shield) { bubbleSprite(size); yield; }
      for (const mode of kind.boss ? ['normal', 'hurt', 'blink'] : kind.rage ? ['angry'] : []) {
        for (let k = 1; k < ROT_STEPS; k++) { rotated(slimeFace(size, mode), (k / ROT_STEPS) * Math.PI * 2); yield; }
      }
    }
  }
}
