// What makes a campaign slime kind recognisable at a glance: a sweatband, cracks, a bow, a
// crown, a soap bubble. Overlays are drawn in the same frame as the slime body (same size and
// squash step), so they sit exactly on it; the bubble goes around it.
import { SLIME_R, BOSS } from './config.js';
import { PixBuf } from './pixelart.js';
import { RNG } from './rng.js';
import { SQUASH, OUTLINE, slimeBody, slimeFace, rotated, ROT_STEPS } from './sprites.js';

const cache = new Map();
const cached = (key, build) => {
  let c = cache.get(key);
  if (c === undefined) cache.set(key, (c = build()));
  return c;
};

// The body's frame: canvas size and the ellipse inside its comic outline.
function frame(size, sqi) {
  const r = SLIME_R[size], sq = SQUASH[sqi];
  const rx = r * (1 + sq), ry = r / (1 + sq);
  const dim = Math.ceil(r * 1.15) * 2 + 2;
  const c = dim / 2, ol = OUTLINE;
  const inner = (x, y) => ((x + 0.5 - c) / (rx - ol)) ** 2 + ((y + 0.5 - c) / (ry - ol)) ** 2 <= 1;
  return { r, rx, ry, dim, c, inner };
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

// ---------------------------------------------------------------- overlays
// Zippy: a red sweatband round its forehead, with the knot's ends flying out at the side.
function band(size, sqi) {
  const f = frame(size, sqi), b = new PixBuf(f.dim, f.dim), ry = f.ry - OUTLINE;
  const y0 = Math.round(f.c - ry * 0.68), y1 = Math.round(f.c - ry * 0.42);
  for (let y = y0; y <= y1; y++) for (let x = 0; x < f.dim; x++) {
    if (!f.inner(x, y)) continue;
    const edge = size < 2 && (y === y0 || y === y1);
    b.set(x, y, edge ? '#000000' : size === 0 && y === Math.round((y0 + y1) / 2) ? '#ffffff' : '#ff3a5c');
  }
  if (size < 2) {
    // the knot's two ends flutter out at the side
    const x = f.c + f.rx - OUTLINE - 1, y = (y0 + y1) / 2 + 0.5, L = size === 0 ? 7 : 5, t = size === 0 ? 1.3 : 0.9;
    const seg = (dx, dy) => (px, py) => {
      const k = Math.max(0, Math.min(1, ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(px - x - dx * k, py - y - dy * k) <= t;
    };
    const a = seg(L, -L * 0.25), c = seg(L * 0.8, L * 0.55);
    shape(b, (px, py) => px > x + 1 && (a(px, py) || c(px, py)), '#ff3a5c');
  }
  return b.canvas();
}

// Stone: speckles, and cracks that grow as it gets hurt (stage 0..3).
function cracks(size, sqi, stage) {
  const f = frame(size, sqi), b = new PixBuf(f.dim, f.dim), rng = new RNG(size * 131 + 7);
  for (let i = 0; i < f.r * 0.6; i++) {
    const x = Math.floor(rng.range(0, f.dim)), y = Math.floor(rng.range(0, f.dim));
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
  return b.canvas();
}

// Mama: a big pink bow on the side of her head.
function bow(size, sqi) {
  const f = frame(size, sqi), b = new PixBuf(f.dim, f.dim);
  const s = f.r * 0.24, bx = f.c + f.rx * 0.36, by = f.c - f.ry + f.r * 0.14;
  const loop = (sx) => (x, y) => ((x - (bx + sx * s * 0.95)) / (s * 0.95)) ** 2 + ((y - by + sx * (x - bx) * 0.12) / (s * 0.62)) ** 2 <= 1;
  const knot = (x, y) => (x - bx) ** 2 + (y - by) ** 2 <= (s * 0.42) ** 2;
  const light = (x, y) => (y < by - s * 0.15 ? '#ff9ac8' : '#ff2f8e');
  shape(b, (x, y) => loop(-1)(x, y) || loop(1)(x, y) || knot(x, y), (x, y) => (knot(x, y) ? '#d81670' : light(x, y)));
  return b.canvas();
}

// King: a golden crown with three points and gems.
function crown(size, sqi) {
  const f = frame(size, sqi), b = new PixBuf(f.dim, f.dim);
  const w = f.r * 0.62, h = f.r * 0.4, x0 = f.c - w / 2, base = f.c - f.ry + f.r * 0.2, top = base - h;
  const pts = [[x0, base], [x0, top + h * 0.25], [x0 + w * 0.22, top + h * 0.58], [x0 + w * 0.5, top], [x0 + w * 0.78, top + h * 0.58], [x0 + w, top + h * 0.25], [x0 + w, base]];
  const body = inPoly(pts);
  shape(b, body, (x, y) => (y > base - h * 0.3 ? '#e09a10' : x < f.c - w * 0.15 ? '#fff3a0' : '#ffd23a'));
  // a band of gems along the bottom, and balls on the points
  const gems = [['#ff2a3c', 0.25], ['#2f8cff', 0.5], ['#1ee05a', 0.75]];
  for (const [col, t] of gems) shape(b, (x, y) => (x - (x0 + w * t)) ** 2 + (y - (base - h * 0.16)) ** 2 <= 4.2, col, null);
  for (const [px, py] of [pts[1], pts[3], pts[5]]) shape(b, (x, y) => (x - px) ** 2 + (y - py) ** 2 <= 6, '#fff3a0');
  return b.canvas();
}

// The overlay of a slime kind for a size, squash step and how hurt it is (null: none).
export function kindOverlay(kind, size, sqi, hpFrac) {
  switch (kind.id) {
    case 'zippy': return cached(`band${size}${sqi}`, () => band(size, sqi));
    case 'stone': {
      const stage = hpFrac > 0.75 ? 0 : hpFrac > 0.5 ? 1 : hpFrac > 0.25 ? 2 : 3;
      return cached(`crack${size}${sqi}${stage}`, () => cracks(size, sqi, stage));
    }
    case 'mama': return cached(`bow${size}${sqi}`, () => bow(size, sqi));
    case 'king': return cached(`crown${size}${sqi}`, () => crown(size, sqi));
    default: return null;
  }
}

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
// Bodies (every squash step, with and without flash), overlays and, for bosses, the turned faces
// of the kinds a level brings, built a little at a time before they are needed.
export function* warmKinds(kinds) {
  for (const kind of new Set(kinds)) {
    const sizes = kind.boss ? [BOSS] : [0, 1, 2];
    for (const size of sizes) {
      // kinds in the level's colours have their bodies built with the level (warmSlimes)
      const color = kind.colors?.[kind.boss ? 0 : size];
      for (let sqi = 0; sqi < SQUASH.length; sqi++) {
        if (color) for (const flash of [false, true]) { slimeBody(color, size, sqi, flash); yield; }
        for (const hp of kind.armor ? [1, 0.7, 0.4, 0.1] : [1]) { kindOverlay(kind, size, sqi, hp); yield; }
      }
      if (kind.shield) { bubbleSprite(size); yield; }
      if (kind.boss) {
        for (const mode of ['normal', 'hurt', 'blink']) {
          for (let k = 1; k < ROT_STEPS; k++) { rotated(slimeFace(size, mode), (k / ROT_STEPS) * Math.PI * 2); yield; }
        }
      }
    }
  }
}
