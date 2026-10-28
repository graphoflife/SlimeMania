// Draws the world onto the low-res canvas and owns all visual-only effects.
import {
  W, H, BOTTOM_BAR, CHAIN_Y, SPROCKET_R, SPROCKET_LX, SPROCKET_RX, MUZZLE_Y, LOSE_Y, SLOT_OFFSETS,
} from './config.js';
import { Background } from './background.js';
import {
  sprite, rotated, slimeBody, slimeFace, slimePalette, hitFrame, HIT_FRAMES, ring, makeCanvas, mix, blit, blitScaled,
} from './sprites.js';
import { slimeScale } from './world.js';

const TAU = Math.PI * 2;
// explosions get the hit sprite at a bigger scale: [scale, screen shake]
const BOOMS = { boom: [2.2, 0.8], boom_s: [1.4, 0.3], bigboom: [3.4, 1.8], nova: [3, 1.4], popcorn: [1.3, 0], bubblepop: [1.1, 0] };
const NIGHT_TINT = '#101848';
const NIGHT_TINT_ALPHA = 0.25;
const PARTY = ['#ff3a7c', '#3ad7ff', '#ffe23a', '#7dff3a', '#c04dff', '#ff8c1a', '#ffffff'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const HIT_LIFE = HIT_FRAMES * 0.05;
const RING_LIFE = 0.22;

// Chain belt geometry. Links sit exactly PITCH px apart on the straight runs.
const PITCH = 4;
const STRAIGHT = SPROCKET_RX - SPROCKET_LX;
const LINKS = Math.round((2 * STRAIGHT + 2 * Math.PI * SPROCKET_R) / PITCH / 2) * 2;
const LOOP = LINKS * PITCH;
const ARC = (LOOP - 2 * STRAIGHT) / 2; // chain length around one sprocket
// The belt looks the same again after two links, and the sprockets (4 spokes, 8 teeth) after
// a quarter turn, so there are only BELT_PERIOD different pictures of it; each is drawn once.
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const BELT_PERIOD = Number.isInteger(ARC / 2) ? (2 * PITCH * (ARC / 2)) / gcd(2 * PITCH, ARC / 2) : 0;
const BELT_TOP = CHAIN_Y - SPROCKET_R - 5;  // top of the housing
const BELT_H = H + BOTTOM_BAR + 4 - BELT_TOP;

// removes the entries that are done, without making a new array
function prune(arr, alive) {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (alive(arr[i])) arr[j++] = arr[i];
  arr.length = j;
}
const hitAlive = (h) => h.t < HIT_LIFE;
const ringAlive = (r) => r.t < RING_LIFE;
const partAlive = (p) => p.t < p.life;
const byColor = (a, b) => (a.color < b.color ? -1 : a.color > b.color ? 1 : 0);

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

// Beside the playfield the landscape is a little darker, with a stepped shadow along the
// edges: [distance from the edge, darkness] (the steps add up).
const SIDE_DIM = 0.3;
const SIDE_EDGE = [[1, 0.35], [3, 0.16], [6, 0.1], [10, 0.06]];
const SHADE = '#140f24';

export class Renderer {
  constructor(canvas, backdrop) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    this.backdrop = backdrop; // wide screens: the landscape beside the playfield
    this.bd = backdrop?.getContext('2d');
    this.side = 0;            // columns of landscape on each side
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
    this.night = 0;        // 0 = day, 1 = night; eases towards nightTarget
    this.nightTarget = 0;
    this.gunSprite = buildGunSprite();
    this.belt = [];        // cached pictures of housing + chain, by phase
  }

  // extra rows of sky above the playfield on tall screens
  setExtra(extra) {
    if (extra === this.extra && this.canvas.height === H + extra + BOTTOM_BAR) return;
    this.extra = extra;
    this.canvas.height = H + extra + BOTTOM_BAR;
    this.g.imageSmoothingEnabled = false;
  }

  // columns of landscape beside the playfield on screens wider than it
  setSide(side) {
    if (!this.backdrop) return;
    this.side = side;
    this.bg.wide = side > 0;
    this.backdrop.style.display = side > 0 ? '' : 'none';
    if (side > 0) {
      this.backdrop.width = W + 2 * side;
      this.backdrop.height = H + this.extra + BOTTOM_BAR;
      this.bd.imageSmoothingEnabled = false;
    }
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
      if (e.fx === 'nova') this.rings.push({ x: e.x, y: e.y, r: 10, t: 0, color: '#fff7b0' });
      else if (e.fx === 'plasma') this.rings.push({ x: e.x, y: e.y, r: 5, t: 0, color: '#ff9af6' });
      else if (e.fx === 'firework') this.sparkle(e.x, e.y, 26, PARTY, 70, 150);
      else if (e.fx === 'firework_s') this.sparkle(e.x, e.y, 8, PARTY, 40, 90);
      else if (e.fx === 'sparks') this.sparkle(e.x, e.y, 8, ['#ffffff', '#ffe23a', '#ff9a1a'], 60, 120);
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

  // radial burst of coloured particles (fireworks, saw sparks)
  sparkle(x, y, n, colors, v0, v1) {
    const list = [];
    for (let i = 0; i < n && this.parts.length + i < 500; i++) {
      const a = (i / n) * TAU + Math.random() * 0.3;
      const v = v0 + Math.random() * (v1 - v0);
      list.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.4 + Math.random() * 0.35,
        color: colors[Math.floor(Math.random() * colors.length)], size: Math.random() < 0.4 ? 2 : 1,
      });
    }
    this.addParts(list);
  }

  // grouped by colour, so drawing them needs only a few colour changes
  addParts(list) {
    list.sort(byColor);
    for (const p of list) this.parts.push(p);
  }

  // ring + droplets in the slime colour
  burst(x, y, r, size, kind) {
    const color = this.colorOf(kind, size);
    const pal = slimePalette(color);
    this.rings.push({ x, y, r, t: 0, color: pal.light });
    const n = [16, 10, 7][size];
    const list = [];
    for (let i = 0; i < n && this.parts.length + i < 400; i++) {
      const a = Math.random() * TAU;
      const v = (40 + Math.random() * 90) * (size === 2 ? 1.2 : 1);
      list.push({
        x: x + Math.cos(a) * r * 0.6, y: y + Math.sin(a) * r * 0.6,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.3 + Math.random() * 0.35,
        color: Math.random() < 0.3 ? pal.light : Math.random() < 0.5 ? pal.shade : pal.base,
        size: Math.random() < 0.3 ? 2 : 1,
      });
    }
    this.addParts(list);
  }

  update(dt) {
    this.time += dt;
    this.bg.update(dt);
    const step = dt * 0.6; // ~1.7 s cross-fade
    this.night += Math.max(-step, Math.min(step, this.nightTarget - this.night));
    for (const h of this.hits) h.t += dt;
    prune(this.hits, hitAlive);
    for (const r of this.rings) r.t += dt;
    prune(this.rings, ringAlive);
    const k = Math.exp(-4 * dt);
    for (const p of this.parts) {
      p.t += dt;
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    prune(this.parts, partAlive);
    this.shake = Math.max(0, this.shake - dt * 8);
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  // ---------------------------------------------------------------- drawing
  // The scene is drawn first onto the empty canvas, the landscape last, behind it. So the
  // night tint can be laid over the scene alone, without a separate layer.
  draw(world, opts = {}) {
    if (this.canvas.height !== H + this.extra + BOTTOM_BAR) this.setExtra(this.extra);
    const g = this.g;
    const ex = this.extra, height = this.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, height);
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
    const gx = Math.round(world.gun.x); // gun and chain move together in whole pixels
    this.drawBelt(gx);
    this.drawGun(gx, world.gun, world.emitters.length);
    this.drawProjectiles(world);
    this.drawEffects();
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.night > 0) {
      // at night everything in front gets a slightly darker, bluish moonlight tint
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = NIGHT_TINT_ALPHA * this.night;
      g.fillStyle = NIGHT_TINT;
      g.fillRect(0, 0, W, height);
      g.globalAlpha = 1;
    }
    // the landscape goes behind everything drawn so far
    g.globalCompositeOperation = 'destination-over';
    this.bg.draw(g, ex, this.night);
    g.globalCompositeOperation = 'source-over';
    if (this.flash > 0) {
      g.globalAlpha = this.flash * 0.45;
      g.fillStyle = this.flashColor;
      g.fillRect(0, 0, W, height);
      g.globalAlpha = 1;
    }
    if (opts.dim) {
      g.globalAlpha = opts.dim;
      g.fillStyle = SHADE;
      g.fillRect(0, 0, W, height);
      g.globalAlpha = 1;
    }
    if (this.side > 0) this.drawBackdrop(opts.dim || 0);
  }

  // The landscape beside the playfield, in step with the one behind it (the game canvas covers
  // the middle, so only the two side strips are drawn).
  drawBackdrop(dim) {
    const g = this.bd, s = this.side, ex = this.extra, height = H + ex + BOTTOM_BAR;
    if (this.backdrop.height !== height) this.setSide(s);
    g.setTransform(1, 0, 0, 1, s, 0); // x = 0 is the left edge of the playfield
    g.clearRect(-s, 0, W + 2 * s, height);
    g.save();
    g.beginPath();
    g.rect(-s, 0, s, height);
    g.rect(W, 0, s, height);
    g.clip();
    g.globalCompositeOperation = 'destination-over';
    this.bg.draw(g, ex, this.night, -s, W + s);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = SHADE;
    g.globalAlpha = 1 - (1 - SIDE_DIM) * (1 - dim);
    g.fillRect(-s, 0, W + 2 * s, height);
    for (const [d, a] of SIDE_EDGE) {
      g.globalAlpha = a;
      g.fillRect(-d, 0, d, height);
      g.fillRect(W, 0, d, height);
    }
    g.restore();
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
          blit(g, body, s.x, s.y);
          blit(g, face, s.x, s.y);
        } else if (sc > 0.02) {
          // growing into existence
          blitScaled(g, body, s.x, s.y, sc);
          blitScaled(g, face, s.x, s.y, sc);
        }
      }
    }
  }

  drawProjectiles(world) {
    const g = this.g;
    for (const p of world.projs) {
      const st = p.s;
      if (p.trail) this.drawBolt(p.trail);
      else if (st.trail) this.drawTail(p, st);
      let name = st.sprite;
      if (Array.isArray(name)) {
        let f;
        if (st.anim === 'age') f = Math.floor(p.age / 0.09);
        else f = Math.floor(p.age * st.anim);
        name = name[clamp(f, 0, name.length - 1) % name.length];
      }
      // the sprite is looked up once per projectile (and again when its animation frame changes)
      if (p.sprName !== name) { p.sprName = name; p.spr = sprite(name, p.tint); }
      let img = p.spr;
      if (st.orient === 'dir') img = rotated(img, Math.atan2(p.vy, p.vx) + Math.PI / 2);
      else if (st.orient === 'spin') img = rotated(img, p.ang);
      if (name === 'flame3') g.globalAlpha = 0.6;
      blit(g, img, p.x, p.y);
      g.globalAlpha = 1;
    }
  }

  // Straight tails behind a projectile, as long as the way it has flown so far.
  drawTail(p, st) {
    const g = this.g;
    const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp;
    const nx = -uy, ny = ux;
    const len = st.trailFrac ? p.dist * st.trailFrac : Math.min(st.trailLen, p.dist);
    if (len < 2) return;
    const x1 = p.x - ux * 3, y1 = p.y - uy * 3;           // start just behind the sprite centre
    const ex = p.x - ux * len, ey = p.y - uy * len;       // end of the tail
    const x = p.x, y = p.y;
    switch (st.trail) {
      case 'laser':
        pixLine(g, x1, y1, ex, ey, '#ff2a3c', 3);
        pixLine(g, x1, y1, ex, ey, '#ffd0d6', 1);
        break;
      case 'tint':
        pixLine(g, x1, y1, ex, ey, p.tint || '#ffffff', 5);
        pixLine(g, x1, y1, x - ux * len * 0.6, y - uy * len * 0.6, '#ffffff', 1);
        break;
      case 'staff':
        g.globalAlpha = 0.8;
        for (let i = 0; i < 5; i++) tailLine(g, x, y, ux, uy, len, 0.15, 1, (i - 2) * 2, '#2a2d38', 1);
        g.globalAlpha = 1;
        break;
      case 'wind':
        g.globalAlpha = 0.75;
        tailLine(g, x, y, ux, uy, len, 0.25, 0.75, 2, '#ffffff', 1);
        tailLine(g, x, y, ux, uy, len, 0.4, 1, -2, '#ffffff', 1);
        tailLine(g, x, y, ux, uy, len, 0.55, 0.9, 0, '#e8f4ff', 1);
        g.globalAlpha = 1;
        break;
      case 'fire':
        tailLine(g, x, y, ux, uy, len, 0.1, 0.45, 0, '#ffe23a', 4);
        tailLine(g, x, y, ux, uy, len, 0.45, 0.75, 0, '#ff8c1a', 3);
        tailLine(g, x, y, ux, uy, len, 0.75, 1, 0, '#e8301a', 2);
        break;
      case 'smoke':
        g.globalAlpha = 0.7;
        for (let k = 0.25; k <= 1; k += 0.25) discFill(g, x - ux * len * k, y - uy * len * k, 1.2 + k, '#c8ccd6');
        g.globalAlpha = 1;
        break;
      case 'star': {
        // shooting star in the star's colour: a soft wide glow around a crisp bright core,
        // with little stars twinkling around it
        const t = p.tint || '#ffd23a', light = lighter(t);
        const mx = x - ux * len * 0.6, my = y - uy * len * 0.6;
        g.lineCap = 'round';
        g.strokeStyle = t;
        g.globalAlpha = 0.22;
        g.lineWidth = 11;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(ex, ey); g.stroke();
        g.globalAlpha = 0.4;
        g.lineWidth = 6;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(mx, my); g.stroke();
        g.globalAlpha = 1;
        tailLine(g, x, y, ux, uy, len, 0.05, 0.45, 0, light, 3);
        tailLine(g, x, y, ux, uy, len, 0.45, 0.8, 0, t, 2);
        tailLine(g, x, y, ux, uy, len, 0.05, 0.3, 0, '#ffffff', 1);
        for (let k = 0.12; k <= 1; k += 0.12) {
          if (Math.random() < 0.3) continue;
          const off = (Math.random() * 2 - 1) * 5;
          const X = Math.round(x - ux * len * k + nx * off), Y = Math.round(y - uy * len * k + ny * off);
          g.fillStyle = Math.random() < 0.5 ? '#ffffff' : light;
          g.fillRect(X, Y - 1, 1, 3);
          g.fillRect(X - 1, Y, 3, 1);
        }
        break;
      }
    }
  }

  drawBolt(tr) {
    const g = this.g;
    for (let i = 0; i + 3 < tr.length; i += 2) {
      const x0 = tr[i], y0 = tr[i + 1], x1 = tr[i + 2], y1 = tr[i + 3];
      const mx = (x0 + x1) / 2 + (Math.random() * 2 - 1) * 3, my = (y0 + y1) / 2 + (Math.random() * 2 - 1) * 3;
      pixLine(g, x0, y0, mx, my, '#ffe23a', 5);
      pixLine(g, mx, my, x1, y1, '#ffe23a', 5);
      pixLine(g, x0, y0, mx, my, '#ffffff', 2);
      pixLine(g, mx, my, x1, y1, '#ffffff', 2);
    }
  }

  drawEffects() {
    const g = this.g;
    for (const r of this.rings) {
      const img = ring(r.r * (1 + r.t * 2.4), r.color);
      g.globalAlpha = 1 - r.t / RING_LIFE;
      g.drawImage(img, Math.round(r.x - img.width / 2), Math.round(r.y - img.height / 2));
    }
    g.globalAlpha = 1;
    let last = null;
    for (const p of this.parts) {
      const col = p.t > p.life * 0.7 && Math.floor(p.t * 30) % 2 ? '#000000' : p.color;
      if (col !== last) { g.fillStyle = col; last = col; }
      g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    for (const h of this.hits) {
      const f = Math.min(HIT_FRAMES - 1, Math.floor(h.t / 0.05));
      blitScaled(g, rotated(hitFrame(f), h.rot), h.x, h.y, h.sc);
    }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- chain belt & gun
  // Housing, chain and sprockets: one cached picture per phase of the belt.
  drawBelt(offset) {
    if (!BELT_PERIOD) { this.drawHousing(); this.drawChain(offset); return; }
    const k = ((offset % BELT_PERIOD) + BELT_PERIOD) % BELT_PERIOD;
    this.g.drawImage(this.belt[k] || this.beltPicture(k), -4, BELT_TOP);
  }

  beltPicture(k) {
    const c = makeCanvas(W + 8, BELT_H);
    const keep = this.g;
    this.g = c.getContext('2d');
    this.g.translate(4, -BELT_TOP);
    this.drawHousing();
    this.drawChain(k);
    this.g = keep;
    return (this.belt[k] = c);
  }

  // builds the belt pictures ahead of time (warm-up job)
  *warmBelt() {
    for (let k = 0; k < BELT_PERIOD; k++) { if (!this.belt[k]) this.beltPicture(k); yield; }
  }

  drawHousing() {
    const g = this.g;
    const top = CHAIN_Y - SPROCKET_R - 5;
    g.fillStyle = '#2b3042';
    g.fillRect(-4, top, W + 8, H + BOTTOM_BAR - top + 4);
    g.fillStyle = '#4a5370';
    g.fillRect(-4, top, W + 8, 1);
    g.fillStyle = '#1a1d2a';
    g.fillRect(SPROCKET_LX, CHAIN_Y - SPROCKET_R + 1, SPROCKET_RX - SPROCKET_LX, SPROCKET_R * 2 - 1);
    g.fillStyle = '#20243a';
    g.fillRect(-4, CHAIN_Y + SPROCKET_R + 4, W + 8, 1);
    g.fillStyle = '#4a5370';
    for (let x = 6; x < W; x += 24) g.fillRect(x, H - 6, 2, 2);
    // menu bar strip
    g.fillStyle = '#1c2030';
    g.fillRect(-4, H, W + 8, BOTTOM_BAR + 4);
    g.fillStyle = '#3a4258';
    g.fillRect(-4, H, W + 8, 1);
  }

  drawChain(offset) {
    const g = this.g;
    const L = SPROCKET_LX, R = SPROCKET_RX, CY = CHAIN_Y, RR = SPROCKET_R;
    // Links sit exactly 4 px apart on the straight runs, so a 1 px gun move shifts every link
    // by exactly 1 px (no jitter). The arcs around the sprockets absorb the remainder.
    const straight = STRAIGHT, N = LINKS, total = LOOP, half = ARC;
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

// Pixel line of w x w squares (Bresenham, at most 200 squares). Squares in a straight row are
// filled as one rectangle: the same pixels with far fewer draw calls.
function pixLine(g, x0, y0, x1, y1, color, w = 1) {
  g.fillStyle = color;
  const o = Math.floor(w / 2);
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  const steep = -dy > dx;
  let err = dx + dy;
  let rx = x0, ry = y0; // first square of the current row
  for (let n = 1; n < 200 && (x0 !== x1 || y0 !== y1); n++) {
    const e2 = 2 * err;
    let nx = x0, ny = y0;
    if (e2 >= dy) { err += dy; nx += sx; }
    if (e2 <= dx) { err += dx; ny += sy; }
    if (steep ? nx !== rx : ny !== ry) {
      g.fillRect(Math.min(rx, x0) - o, Math.min(ry, y0) - o, Math.abs(x0 - rx) + w, Math.abs(y0 - ry) + w);
      rx = nx; ry = ny;
    }
    x0 = nx; y0 = ny;
  }
  g.fillRect(Math.min(rx, x0) - o, Math.min(ry, y0) - o, Math.abs(x0 - rx) + w, Math.abs(y0 - ry) + w);
}

// line along a projectile's tail, from fraction k0 to k1 of its length, off px to the side
function tailLine(g, x, y, ux, uy, len, k0, k1, off, color, w) {
  const ox = -uy * off, oy = ux * off;
  pixLine(g, x - ux * len * k0 + ox, y - uy * len * k0 + oy, x - ux * len * k1 + ox, y - uy * len * k1 + oy, color, w);
}

const lightCache = new Map();
function lighter(c) {
  let l = lightCache.get(c);
  if (!l) lightCache.set(c, (l = mix(c, '#ffffff', 0.55)));
  return l;
}


function discFill(g, cx, cy, r, color) {
  g.fillStyle = color;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    const half = Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
    const x0 = Math.round(cx - half), x1 = Math.round(cx + half);
    if (x1 >= x0) g.fillRect(x0, y, x1 - x0 + 1, 1);
  }
}

