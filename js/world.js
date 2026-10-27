// The game simulation: gun, slimes, waves, projectiles, hits.
// Pure logic without DOM access, so tools/*.mjs can run it headless in Node.
import {
  W, H, SLIME_R, MUZZLE_Y, LOSE_Y, GUN_MIN_X, GUN_MAX_X,
  GUN_MAX_SPEED, GUN_ACCEL, SLOT_OFFSETS,
} from './config.js';

// slime centres stay within the gun's reach, so no slime can hide at the edges
const minX = (s) => Math.max(s.r, GUN_MIN_X);
const maxX = (s) => Math.min(W - s.r, GUN_MAX_X);
import { RNG, sample } from './rng.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;
const MAX_FACE_DEV = 50 * DEG;   // how far a slime may look away from its travel direction
const MAX_KICK = 70 * DEG;       // extra rotation hits can add on top of that
const MAX_UP_DEV = 80 * DEG;     // every projectile flies upwards, at most this far from vertical
const SPEED_MUL = [0.87, 0.94, 1.01];  // drift speed per size (~28 s from the top to the bottom)
// Big slimes grow in at the very top of the screen. On tall screens the view reaches above
// the playfield (topY < 0); slimes then drift faster so the way down takes just as long.
const BASE_PATH = LOSE_Y - 2 * SLIME_R[0] - 4;
const STEER = 1.4;               // how quickly a slime eases into its new drift (1/s)
const KICK_DAMP = 3;             // how quickly recoil fades (1/s)
const GROW_T = 0.5;              // spawn: grow from nothing
const CHILD_GROW_T = 0.2;        // children grow from CHILD_G0 to full size
const CHILD_G0 = 0.55;
const INTERMISSION = 2.2;        // pause between waves
const FF_GAP = 0.35;             // empty field: next slime arrives after at most this
const CELL = 24;
const COLS = Math.ceil(W / CELL);

export const WAVE_SIZE = 20;

// The wave is always the same: fixed spawn times, positions and slime types (0 or 1, half each).
export const WAVE = (() => {
  const rng = new RNG(20251026);
  const r = SLIME_R[0];
  const types = Array.from({ length: WAVE_SIZE }, (_, i) => i % 2);
  for (let i = types.length - 1; i > 0; i--) { const j = rng.int(0, i); [types[i], types[j]] = [types[j], types[i]]; }
  const list = [];
  let t = 0.4;
  let lastX = W / 2;
  for (let i = 0; i < WAVE_SIZE; i++) {
    let x;
    do { x = rng.range(r + 2, W - r - 2); } while (Math.abs(x - lastX) < 40);
    list.push({ t, x, type: types[i] });
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

function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

// Current visual scale of a slime (overshoots a little while growing in).
export function slimeScale(s) {
  if (s.age >= s.growT) return 1;
  return s.g0 + (1 - s.g0) * easeOutBack(s.age / s.growT);
}

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
    this.topY = 0; // top edge of the visible sky, set by the game on tall screens
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
    this.lostHits = 0;  // hits flown off screen by projectiles that had already hit (stats)
    this.usedHits = 0;
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
    if (this.pending.length) { for (const s of this.pending) if (!s.dead) this.slimes.push(s); this.pending.length = 0; }
    compact(this.projs);
    this.updateWave(dt);
    for (const s of this.slimes) {
      if (s.y + s.r >= LOSE_Y) { this.lost = true; this.ev('lose', { x: s.x, y: s.y }); break; }
    }
  }

  // ---------------------------------------------------------------- gun
  updateGun(dt) {
    const g = this.gun;
    const tx = clamp(g.targetX, GUN_MIN_X, GUN_MAX_X);
    const dx = tx - g.x;
    if (Math.abs(dx) < 0.5 && Math.abs(g.vx) < 80) {
      // close enough: sit exactly on the target instead of wobbling around it
      g.x = tx;
      g.vx = 0;
    } else {
      // time-optimal approach: full speed, then brake just in time, never past the target
      const desired = Math.sign(dx) * Math.min(GUN_MAX_SPEED, Math.sqrt(2 * GUN_ACCEL * Math.abs(dx)) * 0.9, Math.abs(dx) / dt);
      const maxDv = GUN_ACCEL * dt;
      g.vx += clamp(desired - g.vx, -maxDv, maxDv);
      g.x += g.vx * dt;
    }
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
        // a sweeping fan spreads its shots over the whole interval, so pulses join seamlessly
        const L = st.sweep ? (iv * (st.count - 1)) / st.count : clamp(sample(st.pulse, rng), 0, iv * 0.9);
        em.back = !em.back;
        em.pulse = { t: 0, L, i: 0 };
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
    let a, tint = null;
    if ((st.fan || st.sweep) && n > 1) {
      // fan position from the left; a sweep runs back from the right every other pulse
      const pos = st.sweep && em.back ? n - 1 - i : st.fanOrder ? st.fanOrder[i] : i;
      a = st.angle.mean + st.angle.spread * ((2 * pos) / (n - 1) - 1) + (st.sweep ? 0 : rng.range(-1.5, 1.5));
      if (st.tintByFan) tint = st.stages[0].tints[pos % st.stages[0].tints.length];
    } else if (st.beam) {
      a = em.beamAngle = i === 0 ? sample(st.angle, rng) : em.beamAngle; // one line for the whole pulse
    } else a = sample(st.angle, rng);
    const v = st.beam && n > 1
      ? st.speed.mean + st.speed.spread * ((2 * i) / (n - 1) - 1)    // evenly stepped speeds
      : Math.max(20, sample(st.speed, rng));
    const rad = UP + a * DEG;
    const x = this.gun.x + SLOT_OFFSETS[em.slot];
    this.spawnProj(st, 0, x, MUZZLE_Y, rad, v, -1, tint);
    this.gun.kick[em.slot] = 1;
  }

  // Projectiles fly in a straight line, always upwards. They only disappear when they
  // leave the screen or when their last hit lands (where they may split).
  spawnProj(w, stage, x, y, ang, v, ignore, tint) {
    const s = w.stages[stage];
    const rng = this.rng;
    ang = UP + clamp(angDiff(ang, UP), -MAX_UP_DEV, MAX_UP_DEV);
    if (s.tints && !tint) tint = rng.pick(s.tints);
    const p = {
      w, stage, s, x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
      hits: s.hits, rest: 0,
      ang,
      spin: s.orient === 'spin' ? range(s.spin, rng) * rng.sign() : 0,
      ignore, tint, age: 0, dist: 0, dead: false, lastHit: null,
      trail: s.trail === 'bolt' ? [x, y] : null,
    };
    if (s.aim && !this.canHitAgain(p, null, x, y)) this.aimAtClosest(p);
    this.projs.push(p);
  }

  // A shot that would obviously miss turns towards the closest slime, in any direction,
  // aiming where that slime will be when the shot gets there.
  aimAtClosest(p) {
    const v = Math.hypot(p.vx, p.vy);
    let best = null, bd = Infinity;
    for (const list of [this.slimes, this.pending]) {
      for (const o of list) {
        if (o.dead || o.id === p.ignore) continue;
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        const t = d / v;
        const tx = o.x + (o.vx + o.kx) * t, ty = o.y + (o.vy + o.ky) * t;
        const a = Math.atan2(ty - p.y, tx - p.x);
        if (d >= bd) continue;
        bd = d;
        best = a;
      }
    }
    if (best === null) return;
    p.vx = Math.cos(best) * v;
    p.vy = Math.sin(best) * v;
    if (p.s.orient !== 'spin') p.ang = best;
  }

  split(p, x, y, ignore) {
    const sp = p.s.split;
    const child = p.w.stages[p.stage + 1];
    const rng = this.rng;
    const n = sp.count;
    const base = Math.atan2(p.vy, p.vx);
    const pSpeed = Math.hypot(p.vx, p.vy);
    for (let i = 0; i < n; i++) {
      let a;
      const k = n === 1 ? 0 : (2 * i) / (n - 1) - 1; // -1 .. 1
      if (sp.mode === 'burst') a = UP + sp.angle * DEG * k + rng.range(-0.5, 0.5) * ((sp.angle * DEG) / n);
      else if (sp.mode === 'fan') a = base + sp.angle * DEG * k;
      else a = base + rng.range(-1, 1) * sp.angle * DEG;
      const v = sp.speed ? range(sp.speed, rng) : pSpeed * range(sp.speedFactor, rng);
      let tint = p.tint;
      if (sp.tint === 'index') tint = child.tints[i % child.tints.length];
      else if (sp.tint === 'random') tint = rng.pick(child.tints);
      this.spawnProj(p.w, p.stage + 1, x, y, a, v, ignore, tint);
    }
    if (sp.fx) this.ev('split', { x, y, fx: sp.fx });
  }

  // ---------------------------------------------------------------- slimes
  makeSlime(size, x, y, hp, type) {
    const s = {
      id: this.nextId++, size, type, r: SLIME_R[size], x, y,
      vx: 0, vy: 0,          // steering drift
      kx: 0, ky: 0,          // recoil, fades out
      tvx: 0, tvy: 0,        // drift the slime is easing into
      hp, maxHp: hp,
      heading: DOWN, face: DOWN, faceTarget: DOWN, kick: 0,
      wanderT: 0,
      g0: 0, growT: GROW_T,
      sq: 0, sqv: 0, phase: this.rng.range(0, TAU),
      flash: 0, flashCd: 0, hurt: 0, blink: this.rng.range(1, 4), age: 0,
      dead: false, stamp: 0,
    };
    this.wander(s);
    s.vx = s.tvx;
    s.vy = s.tvy;
    return s;
  }

  spawnFromWave(i) {
    const s = this.makeSlime(0, WAVE[i].x, this.topY + SLIME_R[0] + 4, this.bigHp, WAVE[i].type);
    s.sqv = -2;
    this.slimes.push(s);
    this.ev('spawn', { x: s.x, y: s.y });
  }

  // Pick a new drift to ease into. A few kinds of moves with different odds.
  wander(s) {
    const rng = this.rng;
    const roll = rng.next();
    let ang, spd;
    if (roll < 0.55) { ang = DOWN + rng.range(-0.5, 0.5); spd = rng.range(8, 14); }               // amble down
    else if (roll < 0.75) { ang = DOWN + rng.sign() * rng.range(0.6, 1.3); spd = rng.range(7, 12); } // drift sideways
    else if (roll < 0.87) { ang = DOWN + rng.range(-0.3, 0.3); spd = rng.range(15, 22); }          // hurry
    else { ang = DOWN + rng.range(-0.8, 0.8); spd = rng.range(1, 4); }                               // dawdle
    const c = Math.cos(ang);
    if ((s.x < minX(s) + 10 && c < 0) || (s.x > maxX(s) - 10 && c > 0)) ang = Math.PI - ang;
    spd *= SPEED_MUL[s.size] * ((BASE_PATH - this.topY) / BASE_PATH);
    s.tvx = Math.cos(ang) * spd;
    s.tvy = Math.sin(ang) * spd;
    s.faceTarget = ang + rng.range(-0.45, 0.45);
    s.wanderT = rng.range(0.8, 2.0);
  }

  updateSlimes(dt) {
    const steer = 1 - Math.exp(-STEER * dt);
    const kdamp = Math.exp(-KICK_DAMP * dt);
    const faceK = 1 - Math.exp(-3 * dt);
    const kickK = Math.exp(-3 * dt);
    for (const s of this.slimes) {
      s.age += dt;
      s.wanderT -= dt;
      if (s.wanderT <= 0) this.wander(s);
      s.vx += (s.tvx - s.vx) * steer;
      s.vy += (s.tvy - s.vy) * steer;
      s.kx *= kdamp;
      s.ky *= kdamp;
      s.x += (s.vx + s.kx) * dt;
      s.y += (s.vy + s.ky) * dt;
      if (s.x < minX(s)) { s.x = minX(s); s.kx = Math.abs(s.kx) * 0.5; if (s.tvx < 0) s.tvx = -s.tvx; }
      else if (s.x > maxX(s)) { s.x = maxX(s); s.kx = -Math.abs(s.kx) * 0.5; if (s.tvx > 0) s.tvx = -s.tvx; }
      if (s.y < this.topY + s.r + 4) { s.y = this.topY + s.r + 4; if (s.ky < 0) s.ky = 0; } // never pushed off the top
      // facing: follows the travel direction, but never looks too far off
      s.heading = Math.atan2(s.vy, s.vx);
      s.face += angDiff(s.faceTarget, s.face) * faceK;
      const dev = angDiff(s.face, s.heading);
      if (Math.abs(dev) > MAX_FACE_DEV) s.face = s.heading + Math.sign(dev) * MAX_FACE_DEV;
      s.kick *= kickK;
      // jelly squash spring around a gentle breathing wobble
      const rest = 0.03 * Math.sin(s.age * 3.2 + s.phase);
      s.sqv += (-120 * (s.sq - rest) - 9 * s.sqv) * dt;
      s.sq += s.sqv * dt;
      if (s.flash > 0) s.flash -= dt;
      if (s.flashCd > 0) s.flashCd -= dt;
      if (s.hurt > 0) s.hurt -= dt;
      s.blink -= dt;
      if (s.blink < -0.12) s.blink = this.rng.range(1.5, 5);
    }
  }

  killSlime(s) {
    s.dead = true;
    this.earned += s.maxHp;
    this.ev('pop', { x: s.x, y: s.y, r: s.r, size: s.size, kind: s.type, value: s.maxHp });
    if (s.size >= 2) return;
    const rng = this.rng;
    const base = rng.next() * TAU;
    for (let k = 0; k < 3; k++) {
      const a = base + (k * TAU) / 3 + rng.range(-0.3, 0.3);
      const c = this.makeSlime(s.size + 1, s.x + Math.cos(a) * s.r * 0.42, s.y + Math.sin(a) * s.r * 0.42, s.maxHp / 3, s.type);
      c.kx = s.kx * 0.3 + Math.cos(a) * 50;
      c.ky = s.ky * 0.3 + Math.sin(a) * 50;
      c.face = c.faceTarget = s.face + rng.range(-0.6, 0.6);
      c.g0 = CHILD_G0;
      c.growT = CHILD_GROW_T;
      c.sqv = 2.5;
      this.pending.push(c);
    }
  }

  buildGrid() {
    const g = this.grid;
    for (let c = 0; c < COLS; c++) g[c].length = 0;
    for (const s of this.slimes) {
      s.hr = s.r * Math.min(1, slimeScale(s)); // hit radius, smaller while growing in
      const c0 = clamp(Math.floor((s.x - s.hr) / CELL), 0, COLS - 1);
      const c1 = clamp(Math.floor((s.x + s.hr) / CELL), 0, COLS - 1);
      for (let c = c0; c <= c1; c++) g[c].push(s);
    }
  }

  // ---------------------------------------------------------------- projectiles
  updateProjectiles(dt) {
    const n = this.projs.length; // children spawned this step start moving next step
    for (let i = 0; i < n; i++) {
      const p = this.projs[i];
      if (p.dead) continue;
      p.age += dt;
      const px = p.x, py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.dist += Math.hypot(p.vx, p.vy) * dt;
      if (p.spin) p.ang += p.spin * dt;
      if (p.trail) { p.trail.push(p.x, p.y); if (p.trail.length > 10) p.trail.splice(0, 2); }
      if (p.rest > 0) p.rest -= dt;
      if (p.rest <= 0) this.collide(p, px, py);
      if (p.dead) continue;
      // Already hit something, nothing reliably ahead any more (e.g. the slime it aimed for
      // was popped by other shots): the slime it hit last gets the remaining hits now.
      if (p.lastHit && p.rest <= 0 && !this.canHitAgain(p, null, p.x, p.y)) {
        this.deliverRest(p, p.lastHit.dead ? null : p.lastHit, p.x, p.y);
        continue;
      }
      if (p.x < -16 || p.x > W + 16 || p.y < this.topY - 40 || p.y > H + 16) {
        p.dead = true;
        if (p.hits < p.s.hits) this.lostHits += p.hits;
      }
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
        const t = segCircle(px, py, p.x, p.y, sl.x, sl.y, sl.hr);
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
    sl.kx += (p.vx / sp) * k;
    sl.ky += (p.vy / sp) * k;
    sl.kick = clamp(sl.kick + rng.range(-1, 1) * s.rotKick * DEG, -MAX_KICK, MAX_KICK);
    sl.sqv += 1.2 + Math.min(3, s.recoil * 0.08);
    if (sl.flashCd <= 0) { sl.flash = 0.035; sl.flashCd = 0.12; } // short white flash, not too often
    sl.hurt = 0.18;
    this.ev('hit', { x: hx, y: hy });
    const killed = sl.hp <= 1e-9 * sl.maxHp;
    if (killed) this.killSlime(sl);
    p.hits--;
    this.usedHits++;
    p.rest = s.rest;
    p.lastHit = killed ? this.nearestChild(hx, hy) : sl;
    // No wasted hits: unless the projectile is sure to land another hit, the remaining hits
    // land right now (on this slime, or on one of its children if this hit popped it).
    if (p.hits > 0 && !this.canHitAgain(p, killed ? null : sl, hx, hy)) {
      this.deliverRest(p, p.lastHit, hx, hy, sl.id);
      return;
    }
    if (p.hits <= 0) {
      if (s.split) this.split(p, hx, hy, sl.id);
      p.dead = true;
    }
  }

  // All remaining hits of a projectile land on one slime at once; then it is used up.
  deliverRest(p, into, x, y, ignore = -1) {
    if (into && p.hits > 0) {
      const extra = p.s.dmg * p.hits;
      const left = into.hp;
      into.hp -= extra;
      this.dealt += Math.min(extra, left);
      this.usedHits += p.hits;
      into.flash = 0.035;
      // show the hit on the slime's edge facing the projectile
      const dx = x - into.x, dy = y - into.y, d = Math.hypot(dx, dy) || 1, k = Math.min(1, (into.r * 0.85) / d);
      this.ev('hit', { x: into.x + dx * k, y: into.y + dy * k });
      if (into.hp <= 1e-9 * into.maxHp) this.killSlime(into);
    }
    p.hits = 0;
    if (p.s.split) this.split(p, x, y, ignore);
    p.dead = true;
  }

  // A careful estimate, erring on the side of "no": will the projectile land another hit?
  // Either it is still well inside the slime it just hit when its rest is over (allowing
  // for that slime drifting), or a slime lies squarely ahead: its predicted position is
  // crossed through the middle, and the projectile is still inside it after the rest.
  canHitAgain(p, cur, hx, hy) {
    const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp;
    const rx = hx + ux * sp * p.rest, ry = hy + uy * sp * p.rest;
    const drift = (o, t) => Math.hypot(o.vx + o.kx, o.vy + o.ky) * t;
    if (cur) {
      const cx = cur.x + (cur.vx + cur.kx) * p.rest, cy = cur.y + (cur.vy + cur.ky) * p.rest;
      if (Math.hypot(rx - cx, ry - cy) < cur.hr - 3 - drift(cur, p.rest)) return true;
    }
    const ahead = (o) => {
      if (o.dead || o === cur || o.id === p.ignore) return false;
      const t = Math.max(0, ((o.x - rx) * ux + (o.y - ry) * uy) / sp) + p.rest;
      const ox = o.x + (o.vx + o.kx) * t - rx, oy = o.y + (o.vy + o.ky) * t - ry;
      const along = ox * ux + oy * uy;
      const across = Math.abs(ox * uy - oy * ux);
      const r = (o.hr || o.r * 0.55) * 0.65;
      if (across > r) return false;
      return along + Math.sqrt(r * r - across * across) > 4; // still inside after the rest
    };
    for (const o of this.slimes) if (ahead(o)) return true;
    for (const o of this.pending) if (ahead(o)) return true;
    return false;
  }

  // the child slime (just popped out this step) closest to a point
  nearestChild(x, y) {
    let best = null, bd = Infinity;
    for (const c of this.pending) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
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
