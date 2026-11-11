// Draws the world onto the low-res canvas and owns all visual-only effects.
import {
  W, H, BOTTOM_BAR, CHAIN_Y, SPROCKET_R, SPROCKET_LX, SPROCKET_RX, MUZZLE_Y, LOSE_Y, SLOT_OFFSETS, BOSS,
} from './config.js';
import { KINDS } from './kinds.js';
import { kindOverlays, bubbleSprite } from './kind-art.js';
import { Background } from './background.js';
import {
  sprite, rotated, slimeBody, slimeFace, slimePalette, hitFrame, HIT_FRAMES, ring, makeCanvas, mix, blit, blitScaled,
} from './sprites.js';
import { slimeScale } from './world.js';
import { PixLayer } from './pixlayer.js';
import { LASER_COLS } from './projectile-art.js';

const TAU = Math.PI * 2;
// explosions get the hit sprite at a bigger scale: [scale, screen shake]
const BOOMS = { boom: [2.2, 0.8], boom_s: [1.4, 0.3], bigboom: [3.4, 1.8], nova: [3, 1.4], popcorn: [1.3, 0], bubblepop: [1.1, 0] };
const NIGHT_TINT = '#101848';
const NIGHT_TINT_ALPHA = 0.25;
const PARTY = ['#ff3a7c', '#3ad7ff', '#ffe23a', '#7dff3a', '#c04dff', '#ff8c1a', '#ffffff'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const HIT_LIFE = HIT_FRAMES * 0.05;
const RING_LIFE = 0.22;
// Fast weapons land a thousand hits a second. A hit right next to a spark that has only just
// appeared adds nothing to see, so it shows no spark of its own (each spark costs a draw call).
const MERGE_R = 8;
const MERGE_T = 0.1;
const MAX_SPARKS = 160;
const SIZE_ORDER = [BOSS, 0, 1, 2];
// half the length of a laser segment's own sprite: its beam starts this far ahead of it
const LASER_HALF = 8;

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
// The landscape moves at most 28 px/s, so at 60 frames a second it only moves every other
// frame: it is painted into one picture about 30 times a second (this often at most).
const LAND_DT = 0.025;
const SIDE_EDGE = [[1, 0.35], [3, 0.16], [6, 0.1], [10, 0.06]];
const SHADE = '#140f24';

export class Renderer {
  constructor(canvas, backdrop) {
    this.canvas = canvas;
    // Opaque: the browser can copy it onto the screen instead of blending it, and does not have
    // to draw the side strips behind it (that matters without a graphics card).
    this.main = this.g = canvas.getContext('2d', { alpha: false });
    this.g.imageSmoothingEnabled = false;
    this.front = makeCanvas(1, 1); // at night: the things in front of the landscape, to be tinted
    this.frontG = this.front.getContext('2d');
    this.backdrop = backdrop; // wide screens: the landscape beside the playfield
    this.bd = backdrop?.getContext('2d');
    this.side = 0;            // columns of landscape on each side
    this.land = makeCanvas(1, 1); // the landscape, playfield and side strips in one picture
    this.landG = this.land.getContext('2d');
    this.landAt = -1;         // when it was painted (-1: paint it now)
    this.bdDim = -1;          // the dimming the side strips were drawn with
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
    // Everything in front of the belt (gun, projectiles and their tails, pops and hit sparks)
    // is drawn into memory and put on the canvas in one go: hundreds of small draw calls less.
    this.layer = new PixLayer();
  }

  // extra rows of sky above the playfield on tall screens
  setExtra(extra) {
    if (extra === this.extra && this.canvas.height === H + extra + BOTTOM_BAR) return;
    this.extra = extra;
    this.canvas.height = H + extra + BOTTOM_BAR;
    this.main.imageSmoothingEnabled = false;
  }

  // columns of landscape beside the playfield on screens wider than it
  setSide(side) {
    if (!this.backdrop) return;
    this.side = side;
    this.bg.wide = side > 0;
    this.landAt = -1;
    this.bdDim = -1;
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
      const hits = this.hits;
      if (hits.length >= MAX_SPARKS) return;
      // the youngest sparks are at the end
      for (let i = hits.length - 1; i >= 0 && hits[i].t < MERGE_T; i--) {
        const dx = hits[i].x - e.x, dy = hits[i].y - e.y;
        if (dx * dx + dy * dy < MERGE_R * MERGE_R) return;
      }
      hits.push({ x: e.x, y: e.y, t: 0, rot: Math.random() * TAU, sc: 0.8 + Math.random() * 0.4 });
    } else if (e.type === 'pop') {
      this.burst(e.x, e.y, e.r, e.size, e.kind, KINDS[e.k]);
      if (e.size === 0) this.shake = Math.max(this.shake, 1.2);
      else if (e.size === BOSS) { this.shake = Math.max(this.shake, 3); this.flash = 0.5; this.flashColor = '#ffffff'; }
    } else if (e.type === 'escape') {
      // it splats against the belt
      this.burst(e.x, e.y, e.r, e.size, e.kind, KINDS[e.k]);
      if (e.hearts) { this.flash = 0.6; this.flashColor = '#ff2a3c'; this.shake = Math.max(this.shake, 2); }
    } else if (e.type === 'shieldPop') {
      this.rings.push({ x: e.x, y: e.y, r: e.r + 4, t: 0, color: '#d8f6ff' });
      this.sparkle(e.x, e.y, 14, ['#ffffff', '#bdeeff', '#8fd8ff'], 50, 110);
    } else if (e.type === 'summon') {
      this.rings.push({ x: e.x, y: e.y, r: 10, t: 0, color: '#c9a0ff' });
    } else if (e.type === 'hop') {
      this.sparkle(e.x, e.y, 6, ['#ffffff', '#e8e0d0'], 30, 60); // a puff of dust
    } else if (e.type === 'heal') {
      if (this.parts.length < 480) this.parts.push({ x: e.x + (Math.random() * 2 - 1) * 6, y: e.y, vx: 0, vy: -45, t: 0, life: 0.7, color: '#3aff7a', size: 1, plus: true });
    } else if (e.type === 'spit') {
      this.sparkle(e.x, e.y, 5, ['#7dff3a', '#d0ff8a'], 20, 50);
    } else if (e.type === 'jam' || e.type === 'gooSplat') {
      this.sparkle(e.x, e.y, e.type === 'jam' ? 12 : 7, ['#7dff3a', '#d0ff8a', '#3aa01a'], 30, 90);
      if (e.type === 'jam') this.shake = Math.max(this.shake, 1);
    } else if (e.type === 'phase') {
      // a boss loses a plate (rocks fly) or sheds its young (a gooey ring)
      if (e.k === 'golem') { this.sparkle(e.x, e.y, 22, ['#a3a9ba', '#5d6376', '#2a2d38'], 60, 150); this.shake = Math.max(this.shake, 2); }
      else this.rings.push({ x: e.x, y: e.y, r: e.r * 0.8, t: 0, color: '#9aeb7a' });
    } else if (e.type === 'teleport') {
      this.rings.push({ x: e.x, y: e.y, r: e.r * 0.7, t: 0, color: '#e2dcff' });
    } else if (e.type === 'levelClear') {
      this.flash = 0.45;
      this.flashColor = '#ffffff';
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

  // a slime's colour: its kind's own, or the level's for its type
  colorOf(type, size, kind) {
    const c = kind?.colors ?? this.colors[type];
    return c[size === BOSS ? 0 : size];
  }

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
  burst(x, y, r, size, type, kind) {
    const color = this.colorOf(type, size, kind);
    const pal = slimePalette(color);
    this.rings.push({ x, y, r, t: 0, color: pal.light });
    const n = [16, 10, 7, 30][size];
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
  // The landscape first, then everything in front of it. At night the things in front get a
  // moonlight tint that must not touch the landscape, so they are drawn on a canvas of their
  // own first, tinted there and then put over the landscape.
  draw(world, opts = {}) {
    if (this.canvas.height !== H + this.extra + BOTTOM_BAR) this.setExtra(this.extra);
    const main = this.main;
    const ex = this.extra, height = this.canvas.height;
    this.layer.resize(W, height, ex);
    const painted = this.paintLand(); // false, true (all of it) or the rows painted again
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.drawImage(this.land, this.side, 0, W, height, 0, 0, W, height);
    const night = this.night > 0;
    const g = (this.g = night ? this.frontG : main); // the drawing code below draws on this.g
    if (night) {
      if (this.front.width !== W || this.front.height !== height) {
        this.front.width = W; this.front.height = height; g.imageSmoothingEnabled = false;
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, height);
    }
    const sx = Math.round((Math.random() * 2 - 1) * this.shake);
    const sy = Math.round((Math.random() * 2 - 1) * this.shake);
    g.setTransform(1, 0, 0, 1, sx, sy + ex);

    // danger line when a slime gets close to the bottom
    let lowest = -1e9;
    for (const s of world.slimes) lowest = Math.max(lowest, s.y + s.r);
    if (lowest > LOSE_Y - 60 && Math.floor(this.time * 6) % 2 === 0) g.drawImage(dangerLine(), 0, LOSE_Y - 2);

    this.drawSlimes(world);
    const gx = Math.round(world.gun.x); // gun and chain move together in whole pixels
    this.drawBelt(gx);
    this.drawGun(gx, world.gun, world.emitters);
    this.drawProjectiles(world);
    if (world.goo.length) this.drawGoo(world.goo);
    this.drawEffects();
    this.layer.draw(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.g = main;
    if (night) {
      // at night everything in front gets a slightly darker, bluish moonlight tint
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = NIGHT_TINT_ALPHA * this.night;
      g.fillStyle = NIGHT_TINT;
      g.fillRect(0, 0, W, height);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      main.drawImage(this.front, 0, 0);
    }
    if (this.flash > 0) {
      main.globalAlpha = this.flash * 0.45;
      main.fillStyle = this.flashColor;
      main.fillRect(0, 0, W, height);
      main.globalAlpha = 1;
    }
    if (opts.dim) {
      main.globalAlpha = opts.dim;
      main.fillStyle = SHADE;
      main.fillRect(0, 0, W, height);
      main.globalAlpha = 1;
    }
    // the side strips only change with the landscape picture: redrawing them every frame would
    // make the browser put the whole screen together again every frame
    const dim = opts.dim || 0;
    if (this.side > 0 && (painted || dim !== this.bdDim)) this.drawBackdrop(dim, dim !== this.bdDim || painted);
  }

  // Paints the landscape picture if it is due: false if nothing changed, true if all of it was
  // painted, or the row ranges painted again. Only the rows where something moved are painted
  // again (mostly the grass, sometimes a cloud or the hills).
  paintLand() {
    const s = this.side, w = W + 2 * s, h = this.canvas.height, c = this.land;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.landAt = -1; }
    if (this.landAt >= 0 && this.time - this.landAt < LAND_DT) return false;
    const rows = this.bg.changedRows(this.night);
    const all = this.landAt < 0 || !rows;
    this.landAt = this.time;
    if (!all && !rows.length) return false;
    const g = this.landG, ex = this.extra;
    g.setTransform(1, 0, 0, 1, s, 0); // x = 0 is the left edge of the playfield
    g.save();
    if (!all) {
      g.beginPath();
      for (const [y0, y1] of rows) g.rect(-s, y0 + ex, w, y1 - y0);
      g.clip();
    }
    g.clearRect(-s, 0, w, h);
    g.globalCompositeOperation = 'destination-over'; // the landscape is drawn from front to back
    this.bg.draw(g, ex, this.night, -s, W + s);
    g.restore();
    return all || rows;
  }

  // The landscape beside the playfield, in step with the one behind it (the game canvas covers
  // the middle, so only the two side strips are drawn): all of it, or the given row ranges.
  drawBackdrop(dim, rows) {
    this.bdDim = dim;
    const g = this.bd, s = this.side, height = this.canvas.height;
    if (this.backdrop.height !== height) { this.setSide(s); rows = true; }
    g.setTransform(1, 0, 0, 1, s, 0); // x = 0 is the left edge of the playfield
    g.save();
    g.beginPath();
    g.rect(-s, 0, s, height);
    g.rect(W, 0, s, height);
    g.clip();
    if (rows !== true) {
      g.beginPath();
      for (const [y0, y1] of rows) g.rect(-s, y0 + this.extra, W + 2 * s, y1 - y0);
      g.clip();
    }
    g.clearRect(-s, 0, W + 2 * s, height);
    g.drawImage(this.land, -s, 0);
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
    // big ones first so the small ones are drawn on top (a boss first of all)
    for (const size of SIZE_ORDER) {
      for (const s of world.slimes) {
        if (s.size !== size) continue;
        const sqi = clamp(Math.round(s.sq / 0.05) + 2, 0, 4);
        const body = slimeBody(this.colorOf(s.type, size, s.kind), size, sqi, s.flash > 0);
        const mode = s.hurt > 0 ? 'hurt' : s.blink < 0 ? 'blink' : s.kind?.rage ? 'angry' : 'normal';
        if (s.kind?.ghost) g.globalAlpha = 0.18 + 0.62 * s.fade; // ghosts are see-through, and fade
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
        if (s.kind && sc > 0.02) this.drawKind(s, size, sqi, sc);
        g.globalAlpha = 1;
      }
    }
  }

  // what a campaign kind wears or carries on top of its body
  drawKind(s, size, sqi, sc) {
    const g = this.g, k = s.kind;
    for (const over of kindOverlays(s, size, sqi)) {
      if (!over) continue; // e.g. a golem without plates left
      if (sc === 1) blit(g, over, s.x, s.y); else blitScaled(g, over, s.x, s.y, sc);
    }
    if (s.shield > 0) { const b = bubbleSprite(size); if (sc === 1) blit(g, b, s.x, s.y); else blitScaled(g, b, s.x, s.y, sc); }
    if (k.zigzag) {
      // golden: a twinkle here and there around it
      const t = Math.floor(this.time * 9), a = ((s.id * 2.3 + t * 1.7) % 6.283), d = s.r * (0.6 + ((t * 7 + s.id) % 5) / 10);
      const x = Math.round(s.x + Math.cos(a) * d), y = Math.round(s.y + Math.sin(a) * d);
      g.fillStyle = t % 2 ? '#ffffff' : '#fff7b0';
      g.fillRect(x - 1, y, 3, 1);
      g.fillRect(x, y - 1, 1, 3);
    }
  }

  drawProjectiles(world) {
    const g = this.layer;
    for (const p of world.projs) {
      const st = p.s;
      if (p.trail) this.drawBolt(p.trail);
      else if (st.trail) this.drawTail(p, st);
      if (st.trail === 'laser') continue; // its tail is the whole segment, the sprite part included
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
      if (name === 'flame3') { g.globalAlpha = 0.6; blit(g, img, p.x, p.y); g.globalAlpha = 1; }
      else blit(g, img, p.x, p.y);
    }
  }

  // Straight tails behind a projectile, as long as the way it has flown so far.
  drawTail(p, st) {
    const g = this.layer;
    const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp;
    const nx = -uy, ny = ux;
    const len = st.trailFrac ? p.dist * st.trailFrac : Math.min(st.trailLen, p.dist);
    if (st.trail === 'laser') {
      // One straight bar with flat ends that looks the same all along, from the top of its
      // sprite to the end of its tail: the segments of a pulse fly on one line and join into
      // one beam.
      bar(g, p.x, p.y, ux, uy, LASER_HALF, Math.max(len, LASER_HALF), LASER_COLS);
      return;
    }
    if (len < 2) return;
    const x1 = p.x - ux * 3, y1 = p.y - uy * 3;           // start just behind the sprite centre
    const ex = p.x - ux * len, ey = p.y - uy * len;       // end of the tail
    const x = p.x, y = p.y;
    switch (st.trail) {
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
    const g = this.layer;
    for (let i = 0; i + 3 < tr.length; i += 2) {
      const x0 = tr[i], y0 = tr[i + 1], x1 = tr[i + 2], y1 = tr[i + 3];
      const mx = (x0 + x1) / 2 + (Math.random() * 2 - 1) * 3, my = (y0 + y1) / 2 + (Math.random() * 2 - 1) * 3;
      pixLine(g, x0, y0, mx, my, '#ffe23a', 5);
      pixLine(g, mx, my, x1, y1, '#ffe23a', 5);
      pixLine(g, x0, y0, mx, my, '#ffffff', 2);
      pixLine(g, mx, my, x1, y1, '#ffffff', 2);
    }
  }

  // goo blobs spat at the gun
  drawGoo(goo) {
    const g = this.layer;
    for (const b of goo) {
      const x = Math.round(b.x), y = Math.round(b.y);
      g.fillStyle = '#000000'; g.fillRect(x - 2, y - 3, 5, 7); g.fillRect(x - 1, y - 5, 3, 2);
      g.fillStyle = '#7dff3a'; g.fillRect(x - 1, y - 2, 3, 5); g.fillRect(x, y - 4, 1, 2);
      g.fillStyle = '#d0ff8a'; g.fillRect(x - 1, y - 2, 1, 2);
    }
  }

  drawEffects() {
    const g = this.layer;
    for (const r of this.rings) {
      const img = ring(r.r * (1 + r.t * 2.4), r.color);
      g.globalAlpha = 1 - r.t / RING_LIFE;
      g.drawImage(img, Math.round(r.x - img.width / 2), Math.round(r.y - img.height / 2));
    }
    g.globalAlpha = 1;
    for (const p of this.parts) {
      g.fillStyle = p.t > p.life * 0.7 && Math.floor(p.t * 30) % 2 ? '#000000' : p.color;
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.plus) { g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); } // a healing plus
      else g.fillRect(x, y, p.size, p.size);
    }
    for (const h of this.hits) {
      const f = Math.min(HIT_FRAMES - 1, Math.floor(h.t / 0.05));
      blitScaled(g, rotated(hitFrame(f), h.rot), h.x, h.y, h.sc);
    }
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

  drawGun(x, gun, emitters) {
    const g = this.layer, slots = emitters.length;
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
      if (active && emitters[s].jam > 0) {
        // goo stuck in the muzzle, dripping down the barrel
        g.fillStyle = '#000000'; g.fillRect(lx - 2, y0 - 3, w + 4, 6);
        g.fillStyle = '#7dff3a'; g.fillRect(lx - 1, y0 - 2, w + 2, 4); g.fillRect(bx, y0 + 2, 1, 3 + Math.round(emitters[s].jam * 2));
        g.fillStyle = '#d0ff8a'; g.fillRect(lx - 1, y0 - 2, 2, 1);
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

// A bar of 1-px wide stripes in the colours `cols`, along the line through (x, y) in direction
// (ux, uy), from `ahead` in front of (x, y) to `behind` it, with flat ends. Every row (every
// column, for lines flatter than 45 degrees) takes its pixel position from the line alone, not
// from where the bar starts, so bars on the same line always line up exactly.
function bar(g, x, y, ux, uy, ahead, behind, cols) {
  const vert = Math.abs(uy) >= Math.abs(ux);
  const m = vert ? y : x, c = vert ? x : y, um = vert ? uy : ux, k = (vert ? ux : uy) / um;
  const a = m + um * ahead, b = m - um * behind;
  const m0 = Math.round(Math.min(a, b)), m1 = Math.round(Math.max(a, b));
  const at = (i) => Math.round(c + (i + 0.5 - m) * k) - (cols.length >> 1); // first stripe of row i
  let i0 = m0, c0 = at(m0);
  for (let i = m0 + 1; i <= m1; i++) {
    const ci = i < m1 ? at(i) : NaN;
    if (ci === c0) continue;
    for (let j = 0; j < cols.length; j++) {
      g.fillStyle = cols[j];
      if (vert) g.fillRect(c0 + j, i0, 1, i - i0);
      else g.fillRect(i0, c0 + j, i - i0, 1);
    }
    i0 = i; c0 = ci;
  }
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

// The danger line as one picture: one drawImage instead of 36 fillRects.
let danger = null;
function dangerLine() { // dashes across the playfield
  if (!danger) {
    danger = makeCanvas(W, 2);
    const g = danger.getContext('2d');
    g.fillStyle = '#ff2a3c';
    for (let x = 0; x < W; x += 6) g.fillRect(x, 0, 3, 2);
  }
  return danger;
}


function discFill(g, cx, cy, r, color) {
  g.fillStyle = color;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    const half = Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
    const x0 = Math.round(cx - half), x1 = Math.round(cx + half);
    if (x1 >= x0) g.fillRect(x0, y, x1 - x0 + 1, 1);
  }
}

