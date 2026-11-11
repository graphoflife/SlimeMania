// Weapon signatures: what makes every weapon look and feel like itself, on top of its
// projectiles and tails (render.js). Brass casings from the machine gun, a blast and smoke from
// the shotgun, splashes, stuck arrows, ricocheting stars, slash marks, a comic POP!, lightning
// arcs, frost and fire on the slimes... All of it is drawn into the pixel layer and capped, so a
// busy fight never piles up effects.
import { MUZZLE_Y, CHAIN_TOP, SLIME_R } from './config.js';
import { sprite, rotated, blit, SQUASH } from './sprites.js';
import { PixBuf } from './pixelart.js';

const TAU = Math.PI * 2;
const MAX_BITS = 260;    // flying bits (casings, drops, embers, debris, smoke...)
const MAX_STUCK = 80;    // arrows and nails stuck in slimes
const MAX_MARKS = 40;    // slash marks, fizz, arcs, flashes
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;

// a few letters for the comic POP!
const POP = ['XXX..XXX..XXX..X', 'X.X..X.X..X.X..X', 'XXX..X.X..XXX..X', 'X....X.X..X.....', 'X....XXX..X.....'];
let popSprite = null;
function popText() {
  if (popSprite) return popSprite;
  const w = POP[0].length + 2, h = POP.length + 2, b = new PixBuf(w, h);
  POP.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== 'X') return;
    for (const [dx, dy] of [[0, 0], [2, 0], [1, -1], [1, 1], [0, 1], [2, 1], [0, -1], [2, -1]]) b.set(x + dx, y + dy + 1, '#000000');
  }));
  POP.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') b.set(x + 1, y + 1, y < 2 ? '#fff3a0' : '#ffd23a'); }));
  return (popSprite = b.canvas(true));
}

// frost on a slime hit by ice, and the glow of a burning one: one picture per size
const frostCache = [], glowCache = [];
function frost(size) {
  if (frostCache[size]) return frostCache[size];
  const r = SLIME_R[size], dim = Math.ceil(r * 1.15) * 2 + 2, c = dim / 2, b = new PixBuf(dim, dim);
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / (r - 3);
    if (d > 1) continue;
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1;
    if (d > 0.82 || Math.abs(n) > 0.93) b.set(x, y, Math.abs(n) > 0.96 ? '#ffffff' : 'rgba(200, 240, 255, 0.75)');
    else b.set(x, y, 'rgba(170, 225, 255, 0.28)');
  }
  return (frostCache[size] = b.canvas());
}
function glow(size) {
  if (glowCache[size]) return glowCache[size];
  const r = SLIME_R[size], dim = Math.ceil(r * 1.3) * 2 + 2, c = dim / 2, b = new PixBuf(dim, dim);
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    if (d > r - 2 && d < r + 3) b.set(x, y, d < r + 0.5 ? 'rgba(255, 140, 26, 0.55)' : 'rgba(255, 210, 60, 0.3)');
  }
  return (glowCache[size] = b.canvas());
}

export class WeaponFx {
  constructor(renderer) {
    this.r = renderer;
    this.bits = [];
    this.stuck = [];
    this.marks = [];
    this.bounce = new Map(); // slime id -> until when it bounces to the music
    this.time = 0;
  }

  reset() {
    this.bits.length = 0;
    this.stuck.length = 0;
    this.marks.length = 0;
    this.bounce.clear();
  }

  // ---------------------------------------------------------------- spawning
  // bit: { x, y, vx, vy, g (gravity), life, color | spr (+ ang, va), w, h, delay, blink, floor }
  bit(b) {
    if (this.bits.length >= MAX_BITS) return;
    b.t = b.delay ? -b.delay : 0;
    b.g ??= 0;
    b.w ??= 1;
    b.h ??= b.w;
    this.bits.push(b);
  }

  burst(x, y, n, colors, v0, v1, g, life, up = 0, w = 1) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), v = rnd(v0, v1);
      this.bit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, g, life: life * rnd(0.7, 1.2), color: pick(colors), w: chance(0.3) ? w + 1 : w });
    }
  }

  mark(m) {
    if (this.marks.length >= MAX_MARKS) return;
    m.t = 0;
    this.marks.push(m);
  }

  // ---------------------------------------------------------------- world events
  onEvent(e) {
    switch (e.type) {
      case 'fire': this.onFire(e); break;
      case 'hit': if (e.p) this.onHit(e); break;
      case 'split': this.onSplit(e); break;
      case 'arc': this.mark({ kind: 'arc', x: e.x0, y: e.y0, x1: e.x1, y1: e.y1, life: 0.14 }); break;
      case 'pop': this.dropStuck(e.id); this.bounce.delete(e.id); break;
      case 'escape': this.dropStuck(e.id); break;
    }
  }

  onFire(e) {
    const x = e.x;
    if (e.w === 'mg') {
      // a brass casing flies out to the side and tumbles down onto the belt
      const side = x < 108 ? 1 : -1;
      this.bit({ x: x + side * 3, y: MUZZLE_Y + 12, vx: side * rnd(40, 90), vy: rnd(-110, -60), g: 520, life: 0.9, color: '#ffd23a', w: 2, h: 1, tumble: true, floor: CHAIN_TOP - 1 });
    } else if (e.w === 'shotgun' && e.i === 0) {
      // muzzle blast and a puff of smoke
      this.mark({ kind: 'blast', x, y: MUZZLE_Y - 2, life: 0.07 });
      for (let i = 0; i < 5; i++) this.bit({ x: x + rnd(-3, 3), y: MUZZLE_Y - rnd(2, 8), vx: rnd(-18, 18), vy: rnd(-35, -15), g: -8, life: rnd(0.4, 0.7), color: pick(['#e8e8f0', '#c8c8d6', '#a8a8b8']), w: 2 });
      this.r.shake = Math.max(this.r.shake, 0.6);
    }
  }

  onHit(e) {
    const p = e.p, id = p.w.id, x = e.x, y = e.y;
    switch (id) {
      case 'water':
        if (chance(0.45)) this.burst(x, y, 3, ['#5ab4ff', '#bfe8ff', '#ffffff'], 40, 90, 320, 0.45, 50);
        break;
      case 'banana':
        if (chance(0.35)) this.burst(x, y, 2, ['#ffe23a', '#fff3a0', '#c8a020'], 40, 80, 300, 0.6, 40, 2);
        break;
      case 'leaves':
        if (chance(0.3)) this.burst(x, y, 2, ['#3ee35a', '#a8ff9a', '#16943a'], 20, 50, 40, 0.9, 10, 2);
        break;
      case 'daggers': {
        const a = rnd(0.5, 1.1) * (chance(0.5) ? 1 : -1) - Math.PI / 2;
        this.mark({ kind: 'slash', x, y, a, life: 0.16 });
        break;
      }
      case 'plasma':
        if (chance(0.5)) this.mark({ kind: 'fizz', x, y, life: 0.1 });
        break;
      case 'saw':
        if (chance(0.35)) this.burst(x, y, 3, ['#ffffff', '#ffe23a', '#ff9a1a'], 60, 140, 260, 0.35, 30);
        break;
      case 'meteor':
        if (p.stage < 2) this.burst(x, y, 3, ['#ffe23a', '#ff8c1a', '#e8301a'], 40, 110, 200, 0.55, 40);
        break;
      case 'ice':
        if (chance(0.4)) this.burst(x, y, 2, ['#ffffff', '#c4f4ff', '#58bce8'], 30, 70, 250, 0.4, 20);
        break;
      case 'notes':
        this.bounce.set(e.sl.id, this.time + 0.7);
        break;
      case 'arrows': case 'nails':
        if (e.last && !e.sl.dead) this.stick(e, p);
        break;
      case 'shuriken':
        if (e.last) {
          // it ricochets off and tumbles away
          const side = chance(0.5) ? 1 : -1;
          this.bit({ x, y, vx: side * rnd(70, 130), vy: rnd(-90, -40), g: 420, life: 0.8, spr: sprite('shuriken'), ang: rnd(0, TAU), va: side * 18 });
        }
        break;
    }
  }

  // an arrow or nail stays in the slime it last hit, until that pops
  stick(e, p) {
    if (this.stuck.length >= MAX_STUCK) this.stuck.shift();
    const a = Math.atan2(p.vy, p.vx), name = p.w.id === 'arrows' ? 'arrow' : 'nail';
    this.stuck.push({
      sid: e.sl.id, dx: e.x - e.sl.x + Math.cos(a) * 4, dy: e.y - e.sl.y + Math.sin(a) * 4,
      img: rotated(sprite(name), a + Math.PI / 2), name, a,
    });
  }

  dropStuck(id) {
    if (!this.stuck.length) return;
    let j = 0;
    for (const s of this.stuck) {
      if (s.sid !== id) { this.stuck[j++] = s; continue; }
      if (s.x === undefined) continue; // never drawn: nowhere to fall from
      this.bit({ x: s.x, y: s.y, vx: rnd(-40, 40), vy: rnd(-60, -20), g: 420, life: 0.7, spr: sprite(s.name), ang: s.a + Math.PI / 2, va: rnd(-10, 10) });
    }
    this.stuck.length = j;
  }

  // explosions and bursts of the splitting weapons
  onSplit(e) {
    const x = e.x, y = e.y;
    switch (e.fx) {
      case 'boom': case 'boom_s': case 'bigboom': {
        const big = e.fx === 'bigboom' ? 2 : e.fx === 'boom' ? 1 : 0.5;
        this.r.rings.push({ x, y, r: 6 + 6 * big, t: 0, color: '#fff3c0' }); // shockwave
        for (let i = 0; i < 2 + 2 * big; i++) this.bit({ x: x + rnd(-6, 6) * big, y: y + rnd(-6, 6) * big, vx: rnd(-15, 15), vy: rnd(-30, -10), g: -6, life: rnd(0.5, 0.9), color: pick(['#5a5a68', '#7a7a88', '#3a3a46']), w: 2 + (big > 1 ? 1 : 0), delay: 0.08 });
        this.burst(x, y, Math.round(3 * big), ['#2a2a30', '#5e3416', '#8a4a20'], 60, 150, 320, 0.6, 50);
        if (e.fx === 'bigboom') { this.r.flash = Math.max(this.r.flash, 0.22); this.r.flashColor = '#ff8c1a'; } // heat flash
        break;
      }
      case 'popcorn':
        this.bit({ x: x - 9, y: y - 10, vx: 0, vy: -28, g: 20, life: 0.55, spr: popText(), ang: 0 });
        this.burst(x, y, 6, ['#fff3a0', '#ffe23a', '#ffffff'], 30, 80, 60, 0.45);
        break;
      case 'bubblepop':
        this.r.rings.push({ x, y, r: 4, t: 0, color: '#d8f6ff' });
        this.burst(x, y, 5, ['#bfe8ff', '#ffffff', '#8fd8ff'], 40, 100, 200, 0.4, 30);
        break;
      case 'firework':
        // crackling glitter a moment after the burst
        for (let i = 0; i < 12; i++) {
          const a = rnd(0, TAU), d = rnd(6, 26);
          this.bit({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: 0, vy: 15, g: 0, life: rnd(0.2, 0.35), color: pick(['#ffffff', '#fff3a0']), delay: rnd(0.15, 0.45), blink: true });
        }
        break;
      case 'sparks':
        this.burst(x, y, 6, ['#ffffff', '#ffe23a', '#ff9a1a'], 70, 160, 300, 0.4, 40);
        break;
    }
  }

  // a burning slime gives off embers now and then
  ember(s) {
    if (chance(0.25)) this.bit({ x: s.x + rnd(-0.6, 0.6) * s.r, y: s.y - s.r * rnd(0.2, 0.8), vx: rnd(-10, 10), vy: rnd(-50, -25), g: -10, life: rnd(0.3, 0.6), color: pick(['#ffe23a', '#ff8c1a', '#ff4a1a']) });
  }

  // ---------------------------------------------------------------- time
  update(dt) {
    this.time += dt;
    let j = 0;
    for (const b of this.bits) {
      b.t += dt;
      if (b.t >= b.life) continue;
      if (b.t > 0) {
        b.vy += b.g * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.va) b.ang += b.va * dt;
        if (b.floor !== undefined && b.y >= b.floor) { b.y = b.floor; b.vy = 0; b.vx *= 0.8; b.va = 0; }
      }
      this.bits[j++] = b;
    }
    this.bits.length = j;
    j = 0;
    for (const m of this.marks) { m.t += dt; if (m.t < m.life) this.marks[j++] = m; }
    this.marks.length = j;
    if (this.bounce.size > 40) for (const [id, until] of this.bounce) if (until < this.time) this.bounce.delete(id);
  }

  // music notes: a slime that was hit just now squashes to the beat
  squashOf(s, sqi) {
    const until = this.bounce.get(s.id);
    if (until === undefined || until < this.time) return sqi;
    return Math.floor(this.time * 8) % 2 ? 0 : SQUASH.length - 1;
  }

  // frost and fire on a slime (drawn with the slimes)
  drawOn(g, s) {
    if (s.slowT > 0) blit(g, frost(s.size), s.x, s.y);
    if (s.burn > 0) {
      g.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 30 + s.id);
      blit(g, glow(s.size), s.x, s.y);
      g.globalAlpha = 1;
      this.ember(s);
    }
  }

  // ---------------------------------------------------------------- drawing (pixel layer)
  draw(g, slimes) {
    if (this.stuck.length) {
      const byId = new Map();
      for (const s of slimes) byId.set(s.id, s);
      for (const st of this.stuck) {
        const s = byId.get(st.sid);
        if (!s) continue;
        st.x = s.x + st.dx;
        st.y = s.y + st.dy;
        blit(g, st.img, st.x, st.y);
      }
    }
    for (const b of this.bits) {
      if (b.t < 0) continue;
      const x = Math.round(b.x), y = Math.round(b.y);
      if (b.spr) { blit(g, b.ang ? rotated(b.spr, b.ang) : b.spr, x, y); continue; }
      if (b.blink && Math.floor(b.t * 30) % 2) continue;
      g.fillStyle = b.t > b.life * 0.75 && Math.floor(b.t * 30) % 2 ? '#000000' : b.color;
      if (b.tumble) { const k = Math.floor(b.t * 20) % 2; g.fillRect(x, y, k ? 2 : 1, k ? 1 : 2); }
      else g.fillRect(x, y, b.w, b.h);
    }
    for (const m of this.marks) {
      const f = 1 - m.t / m.life;
      if (m.kind === 'slash') {
        // a white cut that shrinks away
        const L = 9 * f, cx = Math.cos(m.a) * L, cy = Math.sin(m.a) * L;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(m.x - cx, m.y - cy); g.lineTo(m.x + cx, m.y + cy); g.stroke();
        g.lineWidth = 1;
      } else if (m.kind === 'fizz' || m.kind === 'arc') {
        // a jagged electric line (fizz: a short one around the hit)
        const x1 = m.kind === 'arc' ? m.x1 : m.x + rnd(-7, 7), y1 = m.kind === 'arc' ? m.y1 : m.y + rnd(-7, 7);
        const n = m.kind === 'arc' ? 5 : 2;
        let px = m.x, py = m.y;
        g.strokeStyle = m.kind === 'arc' ? '#fff7a0' : '#ff9af6';
        g.lineWidth = m.kind === 'arc' ? 2 : 1;
        for (let i = 1; i <= n; i++) {
          const k = i / n, jx = i < n ? rnd(-5, 5) : 0, jy = i < n ? rnd(-5, 5) : 0;
          const nx = m.x + (x1 - m.x) * k + jx, ny = m.y + (y1 - m.y) * k + jy;
          g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
          px = nx; py = ny;
        }
        g.lineWidth = 1;
      } else if (m.kind === 'blast') {
        // shotgun: a short cone of fire above the muzzle
        g.fillStyle = '#ffffff'; g.fillRect(m.x - 1, m.y - 6, 3, 6);
        g.fillStyle = '#ffe23a'; g.fillRect(m.x - 3, m.y - 4, 2, 4); g.fillRect(m.x + 2, m.y - 4, 2, 4); g.fillRect(m.x - 5, m.y - 2, 2, 2); g.fillRect(m.x + 4, m.y - 2, 2, 2);
      }
    }
  }

  // ---------------------------------------------------------------- flying projectiles
  // Looks of a projectile in flight beyond its sprite. Returns true if it drew the sprite itself.
  drawProjectile(g, p, img) {
    switch (p.w.id) {
      case 'mg':
        if (p.k % 5 === 0) { g.fillStyle = '#ffe23a'; g.fillRect(Math.round(p.x), Math.round(p.y) + 3, 1, 7); } // tracer
        return false;
      case 'shotgun':
        g.fillStyle = '#c8c8d6';
        g.fillRect(Math.round(p.x - p.vx * 0.006), Math.round(p.y - p.vy * 0.006), 1, 1); // a short streak
        g.fillRect(Math.round(p.x - p.vx * 0.003), Math.round(p.y - p.vy * 0.003), 1, 1);
        return false;
      case 'leaves':
        blit(g, img, p.x + Math.sin(p.age * 14 + p.k) * 2.5, p.y); // fluttering
        return true;
      case 'bubbles': {
        const k = 1 + Math.sin(p.age * 22 + p.k) * 0.12; // wobbling
        const w = Math.round(img.width * k), h = Math.round(img.height / k);
        g.drawImage(img, Math.round(p.x - w / 2), Math.round(p.y - h / 2), w, h);
        return true;
      }
      case 'ducks':
        if (p.rest > 0) { // squeezed right after a hit
          const w = Math.round(img.width * 1.3), h = Math.round(img.height * 0.7);
          g.drawImage(img, Math.round(p.x - w / 2), Math.round(p.y - h / 2), w, h);
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  // a glint now and then on bladed things (after the sprite)
  glint(g, p) {
    const id = p.w.id;
    if ((id !== 'shuriken' && id !== 'daggers') || Math.floor(p.age * 10 + p.k) % 5) return;
    const x = Math.round(p.x) + 1, y = Math.round(p.y) - 2;
    g.fillStyle = '#ffffff';
    g.fillRect(x - 1, y, 3, 1);
    g.fillRect(x, y - 1, 1, 3);
  }
}
