// Faded pixel landscape: dithered sky, drifting clouds and three parallax layers
// (snowy mountains, hills, grass) scrolling from left to right. Always the same (seeded).
import { W, H, MAX_EXTRA } from './config.js';
import { RNG } from './rng.js';
import { makeCanvas, mix } from './sprites.js';

const TILE = W * 2; // layers repeat every 432 px

// Periodic value noise in [0,1] over one tile.
function pnoise(n, rng) {
  const pts = Array.from({ length: n }, () => rng.next());
  return (x) => {
    const f = (((x / TILE) % 1) + 1) % 1 * n;
    const i = Math.floor(f);
    const t = f - i;
    const s = t * t * (3 - 2 * t);
    return pts[i % n] + (pts[(i + 1) % n] - pts[i % n]) * s;
  };
}

const HAZE = '#d9eef6';
const fade = (c, t = 0.45) => mix(c, HAZE, t);

// Covers the playfield plus MAX_EXTRA rows above it (y from -MAX_EXTRA to H).
// Flat bands of blue with sharp, gently wavy boundaries.
function buildSky(rng) {
  const c = makeCanvas(W, H + MAX_EXTRA);
  const g = c.getContext('2d');
  const stops = ['#62afe6', '#70baeb', '#7fc4ee', '#93cff1', '#a8d9f3', '#bde3f5', '#cfeaf6', '#dcf0f7'];
  const bandH = (260 + MAX_EXTRA) / stops.length;
  const waves = stops.slice(1).map((_, k) => ({
    y: (k + 1) * bandH,
    a1: rng.range(2, 4), f1: rng.int(1, 3), p1: rng.range(0, Math.PI * 2),
    a2: rng.range(0.8, 1.6), f2: rng.int(4, 7), p2: rng.range(0, Math.PI * 2),
  }));
  for (let x = 0; x < W; x++) {
    const ph = (x / W) * Math.PI * 2;
    let y0 = 0;
    for (let k = 0; k <= waves.length; k++) {
      const w = waves[k];
      const y1 = w ? Math.round(w.y + w.a1 * Math.sin(ph * w.f1 + w.p1) + w.a2 * Math.sin(ph * w.f2 + w.p2)) : H + MAX_EXTRA;
      g.fillStyle = stops[k];
      g.fillRect(x, y0, 1, Math.max(0, y1 - y0));
      y0 = Math.max(y0, y1);
    }
  }
  return c;
}

function buildCloud(rng) {
  const w = Math.round(rng.range(34, 74));
  const h = Math.round(w * rng.range(0.32, 0.45));
  const c = makeCanvas(w, h + 2);
  const g = c.getContext('2d');
  const blobs = [];
  const n = Math.round(rng.range(4, 7));
  for (let i = 0; i < n; i++) {
    const r = rng.range(h * 0.35, h * 0.62);
    blobs.push([rng.range(r, w - r), h - r * rng.range(0.6, 0.95), r]);
  }
  const inside = (x, y) => y < h && blobs.some(([bx, by, r]) => (x - bx) ** 2 + (y - by) ** 2 <= r * r);
  for (let y = 0; y < h + 2; y++) for (let x = 0; x < w; x++) {
    if (!inside(x + 0.5, y + 0.5)) continue;
    const below = inside(x + 0.5, y + 3.5);
    let col = '#ffffff';
    if (!below || y > h * 0.72) col = '#dfe9f6';
    if (!inside(x + 0.5, y - 1.5) && y < h * 0.6) col = '#ffffff';
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  }
  return c;
}

function buildMountains(rng) {
  const top0 = 180, hgt = 180;
  const c = makeCanvas(TILE, hgt);
  const g = c.getContext('2d');
  const n1 = pnoise(5, rng), n2 = pnoise(11, rng), n3 = pnoise(36, rng), ns = pnoise(60, rng);
  const ridge = (f) => 1 - Math.abs(2 * f - 1);
  const top = (x) => 300 - (0.62 * ridge(n1(x)) + 0.28 * ridge(n2(x)) + 0.1 * n3(x)) * 100;
  const rock = fade('#8b8fc0', 0.42), rockD = fade('#6f72a6', 0.42);
  const snow = fade('#ffffff', 0.15), snowD = fade('#c6d2ee', 0.25);
  for (let x = 0; x < TILE; x++) {
    const t = Math.round(top(x));
    const lit = top(x + 2) < top(x - 2);
    const snowLine = 236 + ns(x) * 12;
    for (let y = t; y < top0 + hgt; y++) {
      let col = lit ? rock : rockD;
      if (y < snowLine && y < t + 16 + ns(x * 3) * 6) col = lit ? snow : snowD;
      g.fillStyle = col;
      g.fillRect(x, y - top0, 1, 1);
    }
  }
  return { c, y: top0 };
}

function buildHills(rng) {
  const top0 = 270, hgt = 110;
  const c = makeCanvas(TILE, hgt);
  const g = c.getContext('2d');
  const n1 = pnoise(3, rng), n2 = pnoise(8, rng), n3 = pnoise(40, rng);
  const top = (x) => 314 - (0.65 * n1(x) + 0.35 * n2(x)) * 32;
  const base = fade('#7cc96f', 0.42), dark = fade('#5faa5a', 0.42), tree = fade('#3e8e4c', 0.4), treeL = fade('#58a85e', 0.4);
  for (let x = 0; x < TILE; x++) {
    const t = Math.round(top(x));
    for (let y = t; y < top0 + hgt; y++) {
      const stripe = ((y - t) > 6 && n3(x + y * 7) > 0.62) || (y - t) % 11 === 10;
      g.fillStyle = stripe ? dark : base;
      g.fillRect(x, y - top0, 1, 1);
    }
  }
  // round trees and pines
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rng.range(0, TILE));
    const ty = Math.round(top(x)) - top0;
    if (rng.next() < 0.5) {
      const r = Math.round(rng.range(3, 6));
      for (let y = -r; y <= r; y++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + y * y > r * r) continue;
        g.fillStyle = dx + y < -r * 0.4 ? treeL : tree;
        g.fillRect((x + dx + TILE) % TILE, ty - r - 2 + y, 1, 1);
      }
      g.fillStyle = fade('#6b4a2a', 0.45);
      g.fillRect(x, ty - 2, 1, 3);
    } else {
      const h = Math.round(rng.range(8, 14));
      for (let y = 0; y < h; y++) {
        const w = Math.round((y / h) * 4);
        for (let dx = -w; dx <= w; dx++) {
          g.fillStyle = dx < 0 ? treeL : tree;
          g.fillRect((x + dx + TILE) % TILE, ty - h + y, 1, 1);
        }
      }
    }
  }
  return { c, y: top0 };
}

function buildGrass(rng) {
  const top0 = 316, hgt = 40;
  const c = makeCanvas(TILE, hgt);
  const g = c.getContext('2d');
  const n1 = pnoise(6, rng), n2 = pnoise(54, rng);
  const top = (x) => 330 - n1(x) * 7 - n2(x) * 2;
  const base = fade('#7fd667', 0.35), dark = fade('#63bb52', 0.35), light = fade('#a8ee86', 0.3);
  const flowers = ['#ff7aa8', '#ffe46a', '#ffffff', '#b98cff'].map((f) => fade(f, 0.35));
  for (let x = 0; x < TILE; x++) {
    const t = Math.round(top(x));
    for (let y = t; y < top0 + hgt; y++) {
      const d = y - t;
      g.fillStyle = d === 0 ? light : (d % 7 === 4 && (x + y) % 3 === 0) ? dark : base;
      g.fillRect(x, y - top0, 1, 1);
    }
    // grass tufts
    if (rng.next() < 0.35) {
      g.fillStyle = light;
      g.fillRect(x, t - 1 - top0, 1, 1);
      if (rng.next() < 0.4) g.fillRect(x, t - 2 - top0, 1, 1);
    }
    if (rng.next() < 0.05) {
      g.fillStyle = rng.pick(flowers);
      g.fillRect(x, Math.round(t + rng.range(3, 20)) - top0, 1, 1);
    }
  }
  return { c, y: top0 };
}

export class Background {
  constructor() {
    const rng = new RNG(4242);
    this.sky = buildSky(new RNG(77)); // own seed: the other layers stay as they were
    this.layers = [
      { ...buildMountains(rng), speed: 3, off: 0 },
      { ...buildHills(rng), speed: 9, off: 0 },
      { ...buildGrass(rng), speed: 28, off: 0 },
    ];
    this.clouds = [];
    for (let i = 0; i < 12; i++) {
      const c = buildCloud(rng);
      const y = rng.range(-MAX_EXTRA + 10, 220);
      // higher clouds are further away: slower
      this.clouds.push({ c, x: rng.range(-60, W), y, speed: 2 + ((y + MAX_EXTRA) / (220 + MAX_EXTRA)) * 6 });
    }
  }

  update(dt) {
    for (const l of this.layers) l.off = (l.off + l.speed * dt) % TILE;
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x > W + 4) c.x = -c.c.width - 4;
    }
  }

  // oy: rows of extra sky above the playfield
  draw(g, oy = 0) {
    g.drawImage(this.sky, 0, oy - MAX_EXTRA);
    g.globalAlpha = 0.85;
    for (const c of this.clouds) g.drawImage(c.c, Math.round(c.x), Math.round(c.y) + oy);
    g.globalAlpha = 1;
    for (const l of this.layers) {
      const x = Math.round(l.off) - TILE;
      g.drawImage(l.c, x, l.y + oy);
      g.drawImage(l.c, x + TILE, l.y + oy);
    }
  }
}
