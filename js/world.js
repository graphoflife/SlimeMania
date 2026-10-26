// The game simulation: gun, slimes, waves, projectiles, hits.
// Pure logic without DOM access, so tools/*.mjs can run it headless in Node.
import {
  W, H, SLIME_R, MUZZLE_Y, LOSE_Y, GUN_MIN_X, GUN_MAX_X,
  GUN_MAX_SPEED, GUN_ACCEL, SLOT_OFFSETS,
} from './config.js';
import { RNG, sample } from './rng.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const DOWN = Math.PI / 2;
const MAX_FACE_DEV = 50 * DEG;   // how far a slime may look away from its travel direction
const MAX_KICK = 70 * DEG;       // extra rotation hits can add on top of that
const SPEED_MUL = [0.85, 0.95, 1.05];
const DAMP = 2.6;                // slime velocity decay per second
const INTERMISSION = 2.2;        // pause between waves
const FF_GAP = 0.35;             // empty field: next slime arrives after at most this
const CELL = 24;
const COLS = Math.ceil(W / CELL);

export const WAVE_SIZE = 20;

// The wave is always the same: fixed spawn times and positions.
export const WAVE = (() => {
  const rng = new RNG(20251026);
  const r = SLIME_R[0];
  const list = [];
  let t = 0.4;
  let lastX = W / 2;
  for (let i = 0; i < WAVE_SIZE; i++) {
    let x;
    do { x = rng.range(r + 2, W - r - 2); } while (Math.abs(x - lastX) < 28);
    list.push({ t, x });
    lastX = x;
    t += i < 15 ? rng.range(0.75, 1.75) : rng.range(0.3, 0.6);
  }
  return list;
})();

function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function compact(arr) {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (!arr[i].dead) arr[j++] = arr[i];
  arr.length = j;
}

// Earliest t in [0,1] where segment p0->p1 enters the circle, or -1.
function segCircle(x0, y0, x1, y1, cx, cy, r) {
  const fx = x0 - cx, fy = y0 - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const dx = x1 - x0, dy = y1 - y0;
  const a = dx * dx + dy * dy;
  if (a === 0) return -1;
  const b = 2 * (fx * dx + fy * dy);
  if (b >= 0) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t <= 1 ? t : -1;
}

const range = (r, rng) => r[0] + (r[1] - r[0]) * rng.next();

export class World {
  constructor(rng = new RNG(), opts = {}) {
    this.rng = rng;
    this.recordEvents = opts.events !== false;
    this.events = [];
    this.slimes = [];
    this.pending = [];
    this.projs = [];
    this.emitters = [];
    this.gun = { x: W / 2, vx: 0, targetX: W / 2, kick: [0, 0, 0] };
    this.grid = Array.from({ length: COLS }, () => []);
    this.stamp = 0;
    this.nextId = 1;
    this.loadLevel(1, 18);
  }

  ev(type, data) {
    if (!this.recordEvents) return;
    data.type = type;
    this.events.push(data);
  }

  loadLevel(level, bigHp) {
    this.level = level;
    this.bigHp = bigHp;
    this.slimes.length = 0;
    this.pending.length = 0;
    this.projs.length = 0;
    this.waveNum = 1;
    this.waveT = 0;
    this.spawnIdx = 0;
    this.waveState = 'run';
    this.interT = 0;
    this.lost = false;
    this.earned = 0;
    this.dealt = 0;
    this.time = 0;
    for (const em of this.emitters) { em.pulse = null; em.cd = this.rng.range(0.05, 0.25); }
    this.ev('waveStart', { n: 1, level });
  }

  // stats: array of buildStats() results, one per equipped slot
  setLoadout(stats) {
    const old = this.emitters;
    this.emitters = stats.map((st, slot) => {
      const prev = old.find((e) => e.st.id === st.id);
      return { st, slot, cd: prev ? Math.min(prev.cd, st.interval.mean) : this.rng.range(0.05, 0.3), pulse: null };
    });
  }

  update(dt) {
    if (this.lost) return;
    this.time += dt;
    this.updateGun(dt);
    this.updateEmitters(dt);
    this.updateSlimes(dt);
    this.buildGrid();
    this.updateProjectiles(dt);
    compact(this.slimes);
    if (this.pending.length) { for (const s of this.pending) this.slimes.push(s); this.pending.length = 0; }
    compact(this.projs);
    this.updateWave(dt);
    for (const s of this.slimes) {
      if (s.y >= LOSE_Y) { this.lost = true; this.ev('lose', { x: s.x, y: s.y }); break; }
    }
  }

  // ---------------------------------------------------------------- gun
  updateGun(dt) {
    const g = this.gun;
    const tx = clamp(g.targetX, GUN_MIN_X, GUN_MAX_X);
    const dx = tx - g.x;
    // time-optimal approach: full speed, then brake just in time
    const desired = Math.sign(dx) * Math.min(GUN_MAX_SPEED, Math.sqrt(2 * GUN_ACCEL * Math.abs(dx)) * 0.9);
    const maxDv = GUN_ACCEL * dt;
    g.vx += clamp(desired - g.vx, -maxDv, maxDv);
    g.x += g.vx * dt;
    if (g.x < GUN_MIN_X) { g.x = GUN_MIN_X; g.vx = 0; }
    if (g.x > GUN_MAX_X) { g.x = GUN_MAX_X; g.vx = 0; }
    for (let i = 0; i < 3; i++) g.kick[i] = Math.max(0, g.kick[i] - dt * 12);
  }

  // ---------------------------------------------------------------- firing
  updateEmitters(dt) {
    const rng = this.rng;
    for (const em of this.emitters) {
      if (em.pulse) { em.pulse.t += dt; this.emitPulse(em); }
      em.cd -= dt;
      if (em.cd <= 0) {
        const st = em.st;
        if (em.pulse) { em.pulse.t = 1e9; this.emitPulse(em); }
        const iv = Math.max(0.02, sample(st.interval, rng));
        em.cd = Math.max(0, em.cd + iv);
        const L = clamp(sample(st.pulse, rng), 0, iv * 0.9);
        em.pulse = { t: 0, L, i: 0 };
        if (st.sfxPer === 'pulse') this.ev('pulse', { slot: em.slot, wid: st.id });
        this.emitPulse(em);
      }
    }
  }

  emitPulse(em) {
    const p = em.pulse;
    const n = em.st.count;
    while (p.i < n && (n === 1 ? 0 : (p.i * p.L) / (n - 1)) <= p.t) {
      this.fire(em, p.i, n);
      p.i++;
    }
    if (p.i >= n) em.pulse = null;
  }

  fire(em, i, n) {
    const st = em.st;
    const rng = this.rng;
    let a;
    if (st.fan && n > 1) a = st.angle.mean + st.angle.spread * ((2 * i) / (n - 1) - 1) + rng.range(-1.5, 1.5);
    else a = sample(st.angle, rng);
    const v = Math.max(20, sample(st.speed, rng));
    const rad = a * DEG;
    const x = this.gun.x + SLOT_OFFSETS[em.slot];
    this.spawnProj(st, 0, x, MUZZLE_Y, Math.sin(rad) * v, -Math.cos(rad) * v, -1, i, null);
    this.gun.kick[em.slot] = 1;
    if (st.sfxPer === 'shot') this.ev('shot', { slot: em.slot, wid: st.id, i });
  }

  spawnProj(w, stage, x, y, vx, vy, ignore, index, tint) {
    const s = w.stages[stage];
    const rng = this.rng;
    const sp = s.split;
    const life = range(s.life, rng);
    if (s.tints && !tint) tint = rng.pick(s.tints);
    this.projs.push({
      w, stage, s, x, y, vx, vy,
      hits: s.hits, rest: 0, life, life0: life,
      splitT: sp && sp.when.includes('time') ? range(sp.time, rng) : Infinity,
      ang: Math.atan2(vy, vx),
      spin: s.orient === 'spin' ? range(s.spin, rng) * rng.sign() : 0,
      ignore, tint, age: 0, dead: false,
      trail: s.trail ? [x, y] : null,
    });
  }

  split(p, x, y, ignore) {
    const sp = p.s.split;
    const child = p.w.stages[p.stage + 1];
    const rng = this.rng;
    const n = sp.count;
    const base = Math.atan2(p.vy, p.vx);
    const rot = rng.next() * TAU;
    const pSpeed = Math.hypot(p.vx, p.vy);
    for (let i = 0; i < n; i++) {
      let a;
      if (sp.mode === 'radial') a = rot + (i * TAU) / n + rng.range(-0.5, 0.5) * (Math.PI / n);
      else if (sp.mode === 'fan') a = base + sp.angle * DEG * (n === 1 ? 0 : (2 * i) / (n - 1) - 1);
      else a = base + rng.range(-1, 1) * sp.angle * DEG;
      const v = sp.speed ? range(sp.speed, rng) : pSpeed * range(sp.speedFactor, rng);
      let tint = p.tint;
      if (sp.tint === 'index') tint = child.tints[i % child.tints.length];
      else if (sp.tint === 'random') tint = rng.pick(child.tints);
      this.spawnProj(p.w, p.stage + 1, x, y, Math.cos(a) * v, Math.sin(a) * v, ignore, i, tint);
    }
    if (sp.sfx) this.ev('split', { x, y, sfx: sp.sfx });
  }

  // ---------------------------------------------------------------- slimes
  makeSlime(size, x, y, hp, color) {
    return {
      id: this.nextId++, size, r: SLIME_R[size], x, y, vx: 0, vy: 0,
      hp, maxHp: hp, color,
      heading: DOWN, face: DOWN, faceTarget: DOWN, kick: 0,
      hopT: this.rng.range(0.1, 0.5),
      sq: 0, sqv: 0, flash: 0, hurt: 0, blink: this.rng.range(1, 4), age: 0,
      dead: false, stamp: 0,
    };
  }

  spawnFromWave(i) {
    const e = WAVE[i];
    const s = this.makeSlime(0, e.x, -SLIME_R[0], this.bigHp, i);
    s.vy = 22;
    this.slimes.push(s);
    this.ev('spawn', { x: s.x });
  }

  hop(s) {
    const rng = this.rng;
    const roll = rng.next();
    let ang = null, spd = 0;
    if (roll < 0.55) { ang = DOWN + rng.range(-0.6, 0.6); spd = rng.range(26, 46); }          // normal hop
    else if (roll < 0.75) { ang = DOWN + rng.sign() * rng.range(0.6, 1.4); spd = rng.range(20, 38); } // sideways
    else if (roll < 0.87) { ang = DOWN + rng.range(-0.35, 0.35); spd = rng.range(52, 72); }    // lunge
    // else: pause
    if (ang !== null) {
      const c = Math.cos(ang);
      if ((s.x < s.r + 14 && c < 0) || (s.x > W - s.r - 14 && c > 0)) ang = Math.PI - ang;
      spd *= SPEED_MUL[s.size];
      s.vx += Math.cos(ang) * spd;
      s.vy += Math.sin(ang) * spd;
      s.heading = ang;
      s.faceTarget = ang + rng.range(-0.45, 0.45);
      s.sqv -= 1.4;
    }
    s.hopT = rng.range(0.45, 1.15);
  }

  updateSlimes(dt) {
    const damp = Math.exp(-DAMP * dt);
    const faceK = 1 - Math.exp(-5 * dt);
    const kickK = Math.exp(-3 * dt);
    for (const s of this.slimes) {
      s.age += dt;
      s.hopT -= dt;
      if (s.hopT <= 0) this.hop(s);
      s.vx *= damp;
      s.vy *= damp;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < s.r) { s.x = s.r; s.vx = Math.abs(s.vx) * 0.5; }
      else if (s.x > W - s.r) { s.x = W - s.r; s.vx = -Math.abs(s.vx) * 0.5; }
      if (s.y < -s.r) { s.y = -s.r; if (s.vy < 0) s.vy = 0; }
      // facing: follows the travel direction, but never looks too far off
      s.face += angDiff(s.faceTarget, s.face) * faceK;
      const dev = angDiff(s.face, s.heading);
      if (Math.abs(dev) > MAX_FACE_DEV) s.face = s.heading + Math.sign(dev) * MAX_FACE_DEV;
      s.kick *= kickK;
      // jelly squash spring
      s.sqv += (-180 * s.sq - 11 * s.sqv) * dt;
      s.sq += s.sqv * dt;
      if (s.flash > 0) s.flash -= dt;
      if (s.hurt > 0) s.hurt -= dt;
      s.blink -= dt;
      if (s.blink < -0.12) s.blink = this.rng.range(1.5, 5);
    }
  }

  killSlime(s) {
    s.dead = true;
    this.earned += s.maxHp;
    this.ev('pop', { x: s.x, y: s.y, r: s.r, size: s.size, color: s.color, value: s.maxHp });
    if (s.size >= 2) return;
    const rng = this.rng;
    const base = rng.next() * TAU;
    for (let k = 0; k < 3; k++) {
      const a = base + (k * TAU) / 3 + rng.range(-0.3, 0.3);
      const c = this.makeSlime(s.size + 1, s.x + Math.cos(a) * s.r * 0.42, s.y + Math.sin(a) * s.r * 0.42, s.maxHp / 3, s.color);
      c.vx = s.vx * 0.3 + Math.cos(a) * 55;
      c.vy = s.vy * 0.3 + Math.sin(a) * 55;
      c.heading = s.heading;
      c.face = c.faceTarget = s.face + rng.range(-0.6, 0.6);
      c.sq = 0.15;
      c.sqv = 3;
      c.hopT = rng.range(0.25, 0.6);
      this.pending.push(c);
    }
  }

  buildGrid() {
    const g = this.grid;
    for (let c = 0; c < COLS; c++) g[c].length = 0;
    for (const s of this.slimes) {
      const c0 = clamp(Math.floor((s.x - s.r) / CELL), 0, COLS - 1);
      const c1 = clamp(Math.floor((s.x + s.r) / CELL), 0, COLS - 1);
      for (let c = c0; c <= c1; c++) g[c].push(s);
    }
  }

  // ---------------------------------------------------------------- projectiles
  updateProjectiles(dt) {
    const n = this.projs.length; // children spawned this step start moving next step
    for (let i = 0; i < n; i++) {
      const p = this.projs[i];
      if (p.dead) continue;
      const s = p.s;
      p.age += dt;
      p.life -= dt;
      if (s.drag) { const k = Math.exp(-s.drag * dt); p.vx *= k; p.vy *= k; }
      const px = p.x, py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.spin) p.ang += p.spin * dt;
      if (p.trail) { p.trail.push(p.x, p.y); if (p.trail.length > 10) p.trail.splice(0, 2); }
      if (p.rest > 0) p.rest -= dt;
      if (p.rest <= 0) this.collide(p, px, py);
      if (p.dead) continue;
      if (p.splitT !== Infinity) {
        p.splitT -= dt;
        if (p.splitT <= 0) { this.split(p, p.x, p.y, -1); p.dead = true; continue; }
      }
      if (p.life <= 0) {
        if (s.split && s.split.when.includes('expire')) this.split(p, p.x, p.y, -1);
        p.dead = true;
        continue;
      }
      if (p.x < -16 || p.x > W + 16 || p.y < -130 || p.y > H + 16) p.dead = true;
    }
  }

  collide(p, px, py) {
    const x0 = Math.min(px, p.x), x1 = Math.max(px, p.x);
    if (x1 < 0 || x0 >= W) return;
    const c0 = clamp(Math.floor(x0 / CELL), 0, COLS - 1);
    const c1 = clamp(Math.floor(x1 / CELL), 0, COLS - 1);
    const stamp = ++this.stamp;
    let best = null, bestT = 2;
    for (let c = c0; c <= c1; c++) {
      const cell = this.grid[c];
      for (let k = 0; k < cell.length; k++) {
        const sl = cell[k];
        if (sl.stamp === stamp) continue;
        sl.stamp = stamp;
        if (sl.dead || sl.id === p.ignore) continue;
        const t = segCircle(px, py, p.x, p.y, sl.x, sl.y, sl.r);
        if (t < 0) continue;
        // ties (already inside several): the smaller slime is on top, it gets hit
        if (t < bestT - 1e-6 || (t < bestT + 1e-6 && sl.size > best.size)) { best = sl; bestT = t; }
      }
    }
    if (best) this.hit(p, best, px + (p.x - px) * bestT, py + (p.y - py) * bestT);
  }

  hit(p, sl, hx, hy) {
    const s = p.s;
    const rng = this.rng;
    const before = sl.hp;
    sl.hp -= s.dmg;                    // overkill is simply wasted
    this.dealt += Math.min(s.dmg, before);
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const k = s.recoil * (SLIME_R[0] / sl.r);
    sl.vx += (p.vx / sp) * k;
    sl.vy += (p.vy / sp) * k;
    sl.kick = clamp(sl.kick + rng.range(-1, 1) * s.rotKick * DEG, -MAX_KICK, MAX_KICK);
    sl.sqv += 1.2 + Math.min(3, s.recoil * 0.08);
    sl.flash = 0.05;
    sl.hurt = 0.18;
    this.ev('hit', { x: hx, y: hy });
    if (sl.hp <= 1e-9 * sl.maxHp) this.killSlime(sl);
    p.hits--;
    p.rest = s.rest;
    if (s.slowOnHit !== 1) { p.vx *= s.slowOnHit; p.vy *= s.slowOnHit; }
    if (p.hits <= 0) {
      if (s.split && s.split.when.includes('hit')) this.split(p, hx, hy, sl.id);
      p.dead = true;
    }
  }

  // ---------------------------------------------------------------- waves
  updateWave(dt) {
    if (this.waveState === 'inter') {
      this.interT -= dt;
      if (this.interT <= 0) {
        this.waveState = 'run';
        this.waveNum++;
        this.waveT = 0;
        this.spawnIdx = 0;
        this.ev('waveStart', { n: this.waveNum, level: this.level });
      }
      return;
    }
    // A nearly empty field makes the wave clock run faster, so a strong
    // player is never starved of slimes and income keeps up with DPS.
    let fieldHp = 0;
    for (const s of this.slimes) fieldHp += s.hp;
    this.waveT += dt * (1 + 2 * clamp(1 - fieldHp / (1.5 * this.bigHp), 0, 1));
    if (this.slimes.length === 0 && this.spawnIdx < WAVE_SIZE) {
      const nt = WAVE[this.spawnIdx].t;
      if (nt - this.waveT > FF_GAP) this.waveT = nt - FF_GAP;
    }
    while (this.spawnIdx < WAVE_SIZE && WAVE[this.spawnIdx].t <= this.waveT) this.spawnFromWave(this.spawnIdx++);
    if (this.spawnIdx >= WAVE_SIZE && this.slimes.length === 0) {
      this.waveState = 'inter';
      this.interT = INTERMISSION;
      this.ev('waveClear', { n: this.waveNum, level: this.level });
    }
  }
}
