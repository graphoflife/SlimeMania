// Draws the world onto the low-res canvas and owns all visual-only effects.
import {
  W, H, CHAIN_Y, SPROCKET_R, SPROCKET_LX, SPROCKET_RX, MUZZLE_Y, LOSE_Y, SLOT_OFFSETS,
} from './config.js';
import { Background } from './background.js';
import {
  sprite, rotated, slimeBody, slimeFace, slimePalette, hitFrame, HIT_FRAMES, ring, makeCanvas,
} from './sprites.js';
import { slimeScale } from './world.js';

const TAU = Math.PI * 2;
// explosions get the hit sprite at a bigger scale: [scale, screen shake]
const BOOMS = { boom: [2.2, 0.8], bigboom: [3.4, 1.8], rumble: [2.6, 1.2], nova: [2.8, 1], popcorn: [1.3, 0], bubblepop: [1.1, 0] };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Bright, saturated, clearly different colours (plus black and white).
const SLIME_COLORS = [
  '#ff2a3c', '#ff8c1a', '#ffe21a', '#9dff1a', '#1ee05a', '#1ae8e0',
  '#2f8cff', '#7a3dff', '#d22eff', '#ff3aa8', '#111111', '#ffffff',
];

// Two slime types per level, each with its own colour for big, medium and small.
// All six colours are different, so no colour repeats inside a type or between
// the two types. Returns colors[type][size].
export function randomSlimeColors(rng = Math.random) {
  const pool = [...SLIME_COLORS];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return [pool.slice(0, 3), pool.slice(3, 6)];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    this.bg = new Background();
    this.colors = randomSlimeColors();
    this.hits = [];
    this.rings = [];
    this.parts = [];
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#ff2a3c';
    this.time = 0;
    this.extra = 0;
    this.gunSprite = buildGunSprite();
  }

  // extra rows of sky above the playfield on tall screens
  setExtra(extra) {
    if (extra === this.extra && this.canvas.height === H + extra) return;
    this.extra = extra;
    this.canvas.height = H + extra;
    this.g.imageSmoothingEnabled = false;
  }

  reset() {
    this.hits.length = 0;
    this.rings.length = 0;
    this.parts.length = 0;
  }

  // ---------------------------------------------------------------- events -> effects
  onEvent(e) {
    if (e.type === 'hit') {
      if (this.hits.length < 220) {
        this.hits.push({ x: e.x, y: e.y, t: 0, rot: Math.random() * TAU, sc: 0.8 + Math.random() * 0.4 });
      }
    } else if (e.type === 'pop') {
      this.burst(e.x, e.y, e.r, e.size, e.kind);
      if (e.size === 0) this.shake = Math.max(this.shake, 1.2);
    } else if (e.type === 'split') {
      const big = BOOMS[e.fx];
      if (big) {
        this.hits.push({ x: e.x, y: e.y, t: 0, rot: Math.random() * TAU, sc: big[0] });
        this.shake = Math.max(this.shake, big[1]);
      }
    } else if (e.type === 'lose') {
      this.flash = 1;
      this.flashColor = '#ff2a3c';
      this.shake = 3;
    } else if (e.type === 'waveClear') {
      this.flash = 0.35;
      this.flashColor = '#ffffff';
    }
  }

  colorOf(type, size) { return this.colors[type][size]; }

  // ring + droplets in the slime colour
  burst(x, y, r, size, kind) {
    const color = this.colorOf(kind, size);
    const pal = slimePalette(color);
    this.rings.push({ x, y, r, t: 0, color: pal.light });
    const n = [16, 10, 7][size];
    for (let i = 0; i < n && this.parts.length < 400; i++) {
      const a = Math.random() * TAU;
      const v = (40 + Math.random() * 90) * (size === 2 ? 1.2 : 1);
      this.parts.push({
        x: x + Math.cos(a) * r * 0.6, y: y + Math.sin(a) * r * 0.6,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.3 + Math.random() * 0.35,
        color: Math.random() < 0.3 ? pal.light : Math.random() < 0.5 ? pal.shade : pal.base,
        size: Math.random() < 0.3 ? 2 : 1,
      });
    }
  }

  update(dt) {
    this.time += dt;
    this.bg.update(dt);
    for (const h of this.hits) h.t += dt;
    this.hits = this.hits.filter((h) => h.t < HIT_FRAMES * 0.05);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < 0.22);
    for (const p of this.parts) {
      p.t += dt;
      const k = Math.exp(-4 * dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.t < p.life);
    this.shake = Math.max(0, this.shake - dt * 8);
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  // ---------------------------------------------------------------- drawing
  draw(world, opts = {}) {
    const g = this.g;
    const ex = this.extra;
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.bg.draw(g, ex);
    const sx = Math.round((Math.random() * 2 - 1) * this.shake);
    const sy = Math.round((Math.random() * 2 - 1) * this.shake);
    g.setTransform(1, 0, 0, 1, sx, sy + ex);

    // danger line when a slime gets close to the bottom
    let lowest = -1e9;
    for (const s of world.slimes) lowest = Math.max(lowest, s.y + s.r);
    if (lowest > LOSE_Y - 60 && Math.floor(this.time * 6) % 2 === 0) {
      g.fillStyle = '#ff2a3c';
      for (let x = 0; x < W; x += 6) g.fillRect(x, LOSE_Y - 2, 3, 2);
    }

    this.drawSlimes(world);
    this.drawHousing();
    const gx = Math.round(world.gun.x); // gun and chain move together in whole pixels
    this.drawChain(gx);
    this.drawGun(gx, world.gun, world.emitters.length);
    this.drawProjectiles(world);
    this.drawEffects();
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.flash > 0) {
      g.globalAlpha = this.flash * 0.45;
      g.fillStyle = this.flashColor;
      g.fillRect(0, 0, W, H + ex);
      g.globalAlpha = 1;
    }
    if (opts.dim) {
      g.globalAlpha = opts.dim;
      g.fillStyle = '#140f24';
      g.fillRect(0, 0, W, H + ex);
      g.globalAlpha = 1;
    }
  }

  drawSlimes(world) {
    const g = this.g;
    // big ones first so the small ones are drawn on top
    for (let size = 0; size < 3; size++) {
      for (const s of world.slimes) {
        if (s.size !== size) continue;
        const sqi = clamp(Math.round(s.sq / 0.05) + 2, 0, 4);
        const body = slimeBody(this.colorOf(s.type, size), size, sqi, s.flash > 0);
        const mode = s.hurt > 0 ? 'hurt' : s.blink < 0 ? 'blink' : 'normal';
        const face = rotated(slimeFace(size, mode), s.face + s.kick - Math.PI / 2);
        const sc = slimeScale(s);
        if (sc === 1) {
          g.drawImage(body, Math.round(s.x - body.width / 2), Math.round(s.y - body.height / 2));
          g.drawImage(face, Math.round(s.x - face.width / 2), Math.round(s.y - face.height / 2));
        } else if (sc > 0.02) {
          // growing into existence
          for (const img of [body, face]) {
            const w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
            g.drawImage(img, Math.round(s.x - w / 2), Math.round(s.y - h / 2), w, h);
          }
        }
      }
    }
  }

  drawProjectiles(world) {
    const g = this.g;
    for (const p of world.projs) {
      const st = p.s;
      if (p.trail) this.drawBolt(p.trail);
      let name = st.sprite;
      if (Array.isArray(name)) {
        let f;
        if (st.anim === 'age') f = Math.floor(p.age / 0.09);
        else f = Math.floor(p.age * st.anim);
        name = name[clamp(f, 0, name.length - 1) % name.length];
      }
      let img = sprite(name, p.tint);
      if (st.orient === 'dir') img = rotated(img, Math.atan2(p.vy, p.vx) + Math.PI / 2);
      else if (st.orient === 'spin') img = rotated(img, p.ang);
      if (name === 'flame3') g.globalAlpha = 0.6;
      g.drawImage(img, Math.round(p.x - img.width / 2), Math.round(p.y - img.height / 2));
      g.globalAlpha = 1;
    }
  }

  drawBolt(tr) {
    const g = this.g;
    for (let i = 0; i + 3 < tr.length; i += 2) {
      const x0 = tr[i], y0 = tr[i + 1], x1 = tr[i + 2], y1 = tr[i + 3];
      const mx = (x0 + x1) / 2 + (Math.random() * 2 - 1) * 3, my = (y0 + y1) / 2 + (Math.random() * 2 - 1) * 3;
      pixLine(g, x0, y0, mx, my, '#b89400', 5);
      pixLine(g, mx, my, x1, y1, '#b89400', 5);
      pixLine(g, x0, y0, mx, my, '#e8c84a', 2);
      pixLine(g, mx, my, x1, y1, '#e8c84a', 2);
    }
  }

  drawEffects() {
    const g = this.g;
    for (const r of this.rings) {
      const img = ring(r.r * (1 + r.t * 2.4), r.color);
      g.globalAlpha = 1 - r.t / 0.22;
      g.drawImage(img, Math.round(r.x - img.width / 2), Math.round(r.y - img.height / 2));
    }
    g.globalAlpha = 1;
    for (const p of this.parts) {
      g.fillStyle = p.t > p.life * 0.7 && Math.floor(p.t * 30) % 2 ? '#000000' : p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    for (const h of this.hits) {
      const f = Math.min(HIT_FRAMES - 1, Math.floor(h.t / 0.05));
      const img = rotated(hitFrame(f), h.rot);
      const w = Math.round(img.width * h.sc), hh = Math.round(img.height * h.sc);
      g.drawImage(img, Math.round(h.x - w / 2), Math.round(h.y - hh / 2), w, hh);
    }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- chain belt & gun
  drawHousing() {
    const g = this.g;
    const top = CHAIN_Y - SPROCKET_R - 5;
    g.fillStyle = '#2b3042';
    g.fillRect(-4, top, W + 8, H - top + 4);
    g.fillStyle = '#4a5370';
    g.fillRect(-4, top, W + 8, 1);
    g.fillStyle = '#1a1d2a';
    g.fillRect(SPROCKET_LX, CHAIN_Y - SPROCKET_R + 1, SPROCKET_RX - SPROCKET_LX, SPROCKET_R * 2 - 1);
    g.fillStyle = '#20243a';
    g.fillRect(-4, CHAIN_Y + SPROCKET_R + 4, W + 8, 1);
    g.fillStyle = '#4a5370';
    for (let x = 6; x < W; x += 24) g.fillRect(x, H - 6, 2, 2);
  }

  drawChain(offset) {
    const g = this.g;
    const L = SPROCKET_LX, R = SPROCKET_RX, CY = CHAIN_Y, RR = SPROCKET_R;
    // Links sit exactly 4 px apart on the straight runs, so a 1 px gun move shifts every link
    // by exactly 1 px (no jitter). The arcs around the sprockets absorb the remainder.
    const PITCH = 4;
    const straight = R - L;
    const N = Math.round((2 * straight + 2 * Math.PI * RR) / PITCH / 2) * 2;
    const total = N * PITCH;
    const half = (total - 2 * straight) / 2;
    const pos = (s) => {
      s = ((s % total) + total) % total;
      if (s < straight) return [L + s, CY - RR];
      if ((s -= straight) < half) { const a = -Math.PI / 2 + (s / half) * Math.PI; return [R + Math.cos(a) * RR, CY + Math.sin(a) * RR]; }
      if ((s -= half) < straight) return [R - s, CY + RR];
      s -= straight;
      const a = Math.PI / 2 + (s / half) * Math.PI;
      return [L + Math.cos(a) * RR, CY + Math.sin(a) * RR];
    };
    // toothed sprockets turn exactly as fast as the chain runs around them
    const rot = (offset / half) * Math.PI;
    for (const cx of [L, R]) {
      discFill(g, cx, CY, RR + 0.5, '#14161d');
      discFill(g, cx, CY, RR - 0.5, '#4b5368');
      for (let k = 0; k < 8; k++) {
        const a = rot + (k * TAU) / 8;
        g.fillStyle = '#14161d';
        g.fillRect(Math.round(cx + Math.cos(a) * (RR + 0.5)) - 1, Math.round(CY + Math.sin(a) * (RR + 0.5)) - 1, 2, 2);
      }
      for (let k = 0; k < 4; k++) {
        const a = rot + (k * TAU) / 4;
        pixLine(g, cx, CY, cx + Math.cos(a) * (RR - 2), CY + Math.sin(a) * (RR - 2), '#7f8aa3');
      }
      discFill(g, cx, CY, 1.6, '#c3cbd9');
      g.fillStyle = '#ffffff';
      g.fillRect(cx - 1, CY - 1, 1, 1);
    }
    // inner links first, outer plates on top
    for (const parity of [1, 0]) {
      for (let i = parity; i < N; i += 2) {
        let [x, y] = pos(i * PITCH + offset);
        x = Math.round(x); y = Math.round(y);
        if (parity) {
          g.fillStyle = '#14161d'; g.fillRect(x - 2, y - 2, 5, 4);
          g.fillStyle = '#5d6578'; g.fillRect(x - 2, y - 1, 5, 2);
        } else {
          g.fillStyle = '#14161d'; g.fillRect(x - 2, y - 3, 5, 6);
          g.fillStyle = '#aeb7c8'; g.fillRect(x - 1, y - 2, 3, 4);
          g.fillStyle = '#eef2f7'; g.fillRect(x - 1, y - 2, 3, 1);
          g.fillStyle = '#737c90'; g.fillRect(x - 1, y + 1, 3, 1);
          g.fillStyle = '#2a2f3a'; g.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  drawGun(x, gun, slots) {
    const g = this.g;
    const base = CHAIN_Y - SPROCKET_R - 2; // rides on the top run
    const spr = this.gunSprite;
    // barrels: side ones first
    for (const s of [1, 2, 0]) {
      const bx = x + SLOT_OFFSETS[s];
      const active = s < slots;
      const kick = gun.kick[s] > 0.6 ? 2 : gun.kick[s] > 0.25 ? 1 : 0;
      // odd widths so every barrel is exactly centred; shaded like a cylinder (mirror-symmetric)
      const w = s === 0 ? 5 : 3;
      const y0 = MUZZLE_Y + (s === 0 ? 0 : 3) + (active ? kick : 2);
      const len = base - 9 - y0;
      const lx = bx - (w - 1) / 2;
      g.fillStyle = '#000000'; g.fillRect(lx - 1, y0 - 1, w + 2, len + 2);
      g.fillStyle = active ? '#8f99ab' : '#6a7486'; g.fillRect(lx, y0, w, len);
      g.fillStyle = active ? '#c9d1de' : '#8f99ab'; g.fillRect(lx + (w > 3 ? 1 : 0), y0, w > 3 ? w - 2 : w, len);
      g.fillStyle = active ? '#ffffff' : '#a5aebd'; g.fillRect(bx, y0, 1, len);
      g.fillStyle = '#20232c'; g.fillRect(lx, y0, w, 1);
      g.fillStyle = active ? '#ff3a7c' : '#7a3a50'; g.fillRect(lx, y0 + 2, w, 1);
      if (active && gun.kick[s] > 0.8) {
        g.fillStyle = '#ffe23a'; g.fillRect(bx - 2, y0 - 3, 5, 2);
        g.fillStyle = '#ffffff'; g.fillRect(bx - 1, y0 - 4, 3, 2);
      }
    }
    g.drawImage(spr, x - Math.floor(spr.width / 2), base - spr.height + 2);
  }
}

// Turret body: dome on a carriage with hazard stripes, comic outline.
function buildGunSprite() {
  const w = 29, h = 17;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const cx = 14.5, cy = 10;
  const R = 9;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const d2 = dx * dx + dy * dy;
    const inDome = dy <= 0.5 && d2 <= R * R;
    const inBase = y >= 9 && y <= 15 && x >= 1 && x <= w - 2;
    const clamp = y === 16 && x % 5 >= 1 && x % 5 <= 2 && x > 2 && x < w - 3;
    if (!inDome && !inBase && !clamp) continue;
    let col;
    if (clamp) col = '#14161d';
    else if (inBase) {
      if (y === 9 || y === 15 || x === 1 || x === w - 2) col = '#000000';
      else if (y === 10) col = '#fff3a8';
      else if (y >= 12 && y <= 14) col = ((Math.abs(x - 14) + y) % 6) < 3 ? '#ffd21a' : '#1a1a22'; // hazard chevrons
      else col = '#ffb02e';
    } else {
      if (d2 > (R - 1.1) ** 2) col = '#000000';
      else {
        col = '#ff9f1a';
        if (dx + dy * 1.2 < -5.5) col = '#ffd56a';
        else if (dx > 3.5) col = '#d86a08';
        if ((dx + 3.5) ** 2 + (dy + 4.5) ** 2 < 1.6) col = '#ffffff';
      }
    }
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  }
  // pink porthole
  g.fillStyle = '#000'; g.fillRect(12, 4, 5, 4);
  g.fillStyle = '#ff3a7c'; g.fillRect(13, 5, 3, 2);
  g.fillStyle = '#ffd0e0'; g.fillRect(13, 5, 1, 1);
  return c;
}

function pixLine(g, x0, y0, x1, y1, color, w = 1) {
  g.fillStyle = color;
  const o = Math.floor(w / 2);
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 200; n++) {
    g.fillRect(x0 - o, y0 - o, w, w);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function discFill(g, cx, cy, r, color) {
  g.fillStyle = color;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    const half = Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
    const x0 = Math.round(cx - half), x1 = Math.round(cx + half);
    if (x1 >= x0) g.fillRect(x0, y, x1 - x0 + 1, 1);
  }
}

