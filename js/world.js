// The game simulation: gun, slimes, waves, projectiles, hits.
// Pure logic without DOM access, so tools/*.mjs can run it headless in Node.
import {
  W, H, SLIME_R, BOSS, MUZZLE_Y, LOSE_Y, GUN_MIN_X, GUN_MAX_X, GUN_HALF, CHAIN_TOP,
  GUN_MAX_SPEED, GUN_ACCEL, SLOT_OFFSETS,
} from './config.js';
import { KINDS, ARMOR_KEEP, GOO } from './kinds.js';

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
const SPEED_MUL = [0.87, 0.94, 1.01, 0.87];  // drift speed per size (~28 s from the top to the bottom)
// Big slimes grow in at the very top of the screen. On tall screens the view reaches above
// the playfield (topY < 0); slimes then drift faster so the way down takes just as long.
const BASE_PATH = LOSE_Y - 2 * SLIME_R[0] - 4;
const STEER = 1.4;               // how quickly a slime eases into its new drift (1/s)
const KICK_DAMP = 3;             // how quickly recoil fades (1/s)
const CORE = 0.65;               // big and medium slimes have a soft core of 65 % of their size...
const PUSH = 2;                  // ...and overlapping cores drift apart at this rate (1/s),
const PUSH_MAX = 40;             // never faster than this (px/s),
const PUSH_EASE = 7;             // easing into and out of that speed (1/s)
const MAX_CORE = SLIME_R[0] * CORE;
const BOSS_CORE = SLIME_R[BOSS] * CORE;
const GROW_T = 0.5;              // spawn: grow from nothing
const CHILD_GROW_T = 0.2;        // children grow from CHILD_G0 to full size
const CHILD_G0 = 0.55;
const INTERMISSION = 2.2;        // pause between waves
const FF_GAP = 0.35;             // empty field: next slime arrives after at most this
const FADE_T = 0.25;             // ghosts fade out and in over this long
const SLOW_T = 1.5;              // ice: a hit slime drifts slower for this long
const BURN_T = 0.5;              // flames: burning damage fades in with this time constant (s)
const ARC_R = 80;                // lightning: arcs to a slime within this distance
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
    this.goo = [];      // campaign: goo spat at the gun
    this.emitters = [];
    this.gun = { x: W / 2, vx: 0, targetX: W / 2, kick: [0, 0, 0] };
    this.grid = Array.from({ length: COLS }, () => []);
    this.cores = [];    // big and medium slimes, sorted by x
    this.coreStep = 0;
    this.stamp = 0;
    this.topY = 0; // top edge of the visible sky, set by the game on tall screens
    this.nextId = 1;
    this.projSeq = 0;   // numbers the projectiles (for looks that come every n-th shot)
    this.loadLevel(1, 18);
  }

  ev(type, data) {
    if (!this.recordEvents) return;
    data.type = type;
    this.events.push(data);
  }

  // script (campaign): the level's spawns [{ t, x, kind, size, hp (x bigHp), type }], played
  // once; the level is cleared when all have spawned and the field is empty. Without a script
  // (Zen) the one fixed wave repeats.
  loadLevel(level, bigHp, script = null) {
    this.level = level;
    this.bigHp = bigHp;
    this.script = script;
    this.boss = null;
    this.slimes.length = 0;
    this.pending.length = 0;
    this.projs.length = 0;
    this.goo.length = 0;
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
    if (this.goo.length) this.updateGoo(dt);
    this.buildGrid();
    this.updateProjectiles(dt);
    compact(this.slimes);
    if (this.pending.length) { for (const s of this.pending) if (!s.dead) this.slimes.push(s); this.pending.length = 0; }
    compact(this.projs);
    if (this.script) this.updateScript(dt);
    else this.updateWave(dt);
    let escaped = false;
    for (const s of this.slimes) {
      if (s.y + s.r < LOSE_Y) continue;
      if (!this.script) { this.lost = true; this.ev('lose', { x: s.x, y: s.y }); break; }
      this.escape(s);
      escaped = true;
    }
    if (escaped) compact(this.slimes);
  }

  // Campaign: a slime that reaches the bottom splats there and costs hearts (no money, no children).
  escape(s) {
    s.dead = true;
    if (s === this.boss) this.boss = null;
    this.ev('escape', { id: s.id, x: s.x, y: s.y, r: s.r, size: s.size, kind: s.type, k: s.kind.id, hearts: s.kind.hearts ?? 1 });
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
      if (em.jam > 0) { em.jam -= dt; continue; } // goo in the barrel (campaign)
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
    this.ev('fire', { w: st.id, slot: em.slot, x, i });
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
      ignore, tint, age: 0, dist: 0, dead: false, lastHit: null, k: this.projSeq++,
      trail: s.trail === 'bolt' ? [x, y] : null,
      spr: null, sprName: null, // sprite cache of the renderer
    };
    if (s.aim && !this.canHitAgain(p, null, x, y)) this.aimAtClosest(p);
    this.projs.push(p);
  }

  // A shot that would obviously miss turns towards the closest slime, in any direction,
  // aiming where that slime will be when the shot gets there.
  aimAtClosest(p) {
    const v = Math.hypot(p.vx, p.vy);
    let target = null, bd = Infinity;
    for (const list of [this.slimes, this.pending]) {
      for (const o of list) {
        if (o.dead || o.id === p.ignore || o.ghost) continue;
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bd) { bd = d; target = o; }
      }
    }
    if (target === null) return;
    const o = target, t = bd / v;
    const best = Math.atan2(o.y + (o.vy + o.ky + o.py) * t - p.y, o.x + (o.vx + o.kx + o.px) * t - p.x);
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
  makeSlime(size, x, y, hp, type, kind = null) {
    const s = {
      id: this.nextId++, size, type, kind, r: SLIME_R[size], x, y,
      vx: 0, vy: 0,          // steering drift
      kx: 0, ky: 0,          // recoil, fades out
      px: 0, py: 0,          // pushed by overlapping neighbours, eases in and out
      tpx: 0, tpy: 0, cr: 0, coreStep: 0, // pushApart() bookkeeping
      tvx: 0, tvy: 0,        // drift the slime is easing into
      hp, maxHp: hp,
      heading: DOWN, face: DOWN, faceTarget: DOWN, kick: 0,
      wanderT: 0,
      g0: 0, growT: GROW_T,
      sq: 0, sqv: 0, phase: this.rng.range(0, TAU),
      flash: 0, flashCd: 0, hurt: 0, blink: this.rng.range(1, 4), age: 0,
      dead: false, stamp: 0,
    };
    if (kind) {
      const rng = this.rng;
      s.shield = kind.shield ? hp * kind.shield : 0;
      s.summonT = kind.summon ? kind.summon.every * 0.6 : 0;
      s.hopT = kind.hop ? range(kind.hop.every, rng) : 0;
      s.ghostT = kind.ghost ? rng.range(0, kind.ghost.on) : 0;
      s.fade = 1;
      s.ghost = false;
      s.healT = kind.heal ? rng.range(0.3, kind.heal.every) : 0;
      s.spitT = kind.spit ? range(kind.spit.every, rng) * 0.6 : 0;
      s.stage = 0; // boss phases passed (75 / 50 / 25 % HP)
      s.loopA = rng.range(0, TAU);  // prism: heading and how fast it turns
      s.loopW = 0;
      s.loopT = 0;
      s.fleeing = false;
      s.snakeP = rng.range(0, TAU); // wiggler: where in its curve it is
      s.blinkT = kind.blink ? range(kind.blink.every, rng) : 0;
      s.asleep = !!kind.sleepy;
    }
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
    const k = s.kind;
    if (k?.zigzag) { ang = DOWN + rng.sign() * rng.range(0.9, 1.35); spd = rng.range(22, 34); }  // dart from side to side
    if (k?.straight || k?.snake) { ang = DOWN + rng.range(-0.06, 0.06); spd = rng.range(10, 13); }  // straight down (a wiggler's curve comes on top)
    if ((s.x < minX(s) + 10 && Math.cos(ang) < 0) || (s.x > maxX(s) - 10 && Math.cos(ang) > 0)) ang = Math.PI - ang;
    spd *= SPEED_MUL[s.size] * ((BASE_PATH - this.topY) / BASE_PATH);
    if (k?.speed) spd *= k.speed;
    if (k?.rage) spd *= 1 + k.rage * (1 - s.hp / s.maxHp);
    if (k?.sleepy) spd *= s.asleep ? 0.35 : k.sleepy;
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
      const m = s.slowT > 0 ? 1 - s.slowF : 1; // frozen by ice: drifts slower
      if (s.slowT > 0) s.slowT -= dt;
      s.x += (s.vx * m + s.kx) * dt;
      s.y += (s.vy * m + s.ky) * dt;
      if (s.x < minX(s)) { s.x = minX(s); s.kx = Math.abs(s.kx) * 0.5; if (s.tvx < 0) s.tvx = -s.tvx; }
      else if (s.x > maxX(s)) { s.x = maxX(s); s.kx = -Math.abs(s.kx) * 0.5; if (s.tvx > 0) s.tvx = -s.tvx; }
      if (s.y < this.topY + s.r + 4 && !s.fleeing) { s.y = this.topY + s.r + 4; if (s.ky < 0) s.ky = 0; } // never pushed off the top
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
      if (s.kind) this.kindStep(s, dt);
      if (s.burn > 0) this.burnStep(s, dt);
    }
    this.pushApart(dt);
  }

  // Big and medium slimes may overlap a bit, but their cores (65 % of their size) do not stay
  // overlapped: they drift apart, the faster the more they overlap. The push speed eases in
  // and out, so nothing ever jerks (not even when a neighbour pops). The bigger slime gives
  // way less. Small slimes have no core: they are never pushed.
  pushApart(dt) {
    const list = this.cores, step = ++this.coreStep;
    for (const s of this.slimes) {
      if (s.dead || s.size === 2) continue;
      if (s.coreStep === 0) list.push(s); // new
      s.coreStep = step;
      s.cr = s.r * CORE * (s.age >= s.growT ? 1 : Math.min(1, slimeScale(s)));
      s.tpx = 0; s.tpy = 0; // push speed it should have
    }
    // the list is kept between steps: drop popped slimes (and all of them after a new level),
    // then sort by x (insertion sort: quick, as the order hardly changes from step to step)
    let n = 0;
    for (let i = 0; i < list.length; i++) if (list[i].coreStep === step) list[n++] = list[i];
    list.length = n;
    for (let i = 1; i < n; i++) {
      const s = list[i], x = s.x;
      let j = i - 1;
      while (j >= 0 && list[j].x > x) { list[j + 1] = list[j]; j--; }
      list[j + 1] = s;
    }
    // sorted by x, each slime only looks at the next ones until they are out of reach
    const maxCore = this.boss ? BOSS_CORE : MAX_CORE;
    for (let i = 0; i < n; i++) {
      const a = list[i], ax = a.x, ay = a.y, ar = a.cr, reach = ar + maxCore;
      for (let j = i + 1; j < n; j++) {
        const b = list[j];
        const dx = b.x - ax;
        if (dx >= reach) break;
        const min = ar + b.cr, dy = b.y - ay;
        if (dx >= min || dy >= min || dy <= -min) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
        const v = (min - d) * PUSH;
        const ma = a.r * a.r, mb = b.r * b.r, va = (v * mb) / (ma + mb), vb = v - va;
        a.tpx -= nx * va; a.tpy -= ny * va;
        b.tpx += nx * vb; b.tpy += ny * vb;
      }
    }
    const ease = 1 - Math.exp(-PUSH_EASE * dt);
    for (let i = 0; i < n; i++) {
      const s = list[i];
      if (s.tpx === 0 && s.tpy === 0 && s.px === 0 && s.py === 0) continue; // not being pushed
      const v2 = s.tpx * s.tpx + s.tpy * s.tpy, cap = v2 > PUSH_MAX * PUSH_MAX ? PUSH_MAX / Math.sqrt(v2) : 1;
      s.px += (s.tpx * cap - s.px) * ease;
      s.py += (s.tpy * cap - s.py) * ease;
      // the last bit of a push that has faded out is dropped, so resting slimes are skipped
      if (s.tpx === 0 && s.tpy === 0 && s.px * s.px + s.py * s.py < 1e-4) { s.px = 0; s.py = 0; continue; }
      s.x += s.px * dt;
      s.y += s.py * dt;
      if (s.x < minX(s)) { s.x = minX(s); if (s.px < 0) s.px = 0; }
      else if (s.x > maxX(s)) { s.x = maxX(s); if (s.px > 0) s.px = 0; }
      if (s.y < this.topY + s.r + 4 && !s.fleeing) { s.y = this.topY + s.r + 4; if (s.py < 0) s.py = 0; }
    }
  }

  killSlime(s) {
    s.dead = true;
    const kind = s.kind;
    const value = kind?.value ? s.maxHp * kind.value : s.maxHp;
    this.earned += value;
    if (s === this.boss) this.boss = null;
    this.ev('pop', { id: s.id, x: s.x, y: s.y, r: s.r, size: s.size, kind: s.type, k: kind?.id, value });
    if (kind?.blast) this.blast(s);
    if (s.size === 2) return;
    const rng = this.rng;
    const base = rng.next() * TAU;
    // a boss pops into big slimes of the level's strength
    const n = kind?.children ?? 3, size = s.size === BOSS ? 0 : s.size + 1, hp = s.size === BOSS ? this.bigHp : s.maxHp / 3;
    const ck = kind ? KINDS[kind.childKind ?? kind.id] : null;
    for (let k = 0; k < n; k++) {
      const a = base + (k * TAU) / n + rng.range(-0.3, 0.3);
      const c = this.makeSlime(size, s.x + Math.cos(a) * s.r * 0.42, s.y + Math.sin(a) * s.r * 0.42, hp, s.type, ck);
      c.kx = s.kx * 0.3 + Math.cos(a) * 50;
      c.ky = s.ky * 0.3 + Math.sin(a) * 50;
      c.face = c.faceTarget = s.face + rng.range(-0.6, 0.6);
      c.g0 = CHILD_G0;
      c.growT = CHILD_GROW_T;
      c.sqv = 2.5;
      if (ck?.sleepy) { c.asleep = false; c.wanderT = 0.05; } // woken up by now
      this.pending.push(c);
    }
  }

  // A projectile's damage on a slime: ice slows it, part of a flame's damage burns off later.
  strike(s, sl, dmg, hits) {
    if (s.burn) { sl.burn = (sl.burn || 0) + dmg * s.burn; dmg *= 1 - s.burn; }
    if (s.slow) { sl.slowT = SLOW_T; sl.slowF = s.slow; }
    this.hurt(sl, dmg, hits);
  }

  // Burning: the damage left to burn comes off little by little (armour and softness do not
  // stop fire), and may pop the slime.
  burnStep(s, dt) {
    let d = s.burn * (1 - Math.exp(-dt / BURN_T));
    s.burn -= d;
    if (s.burn < s.maxHp * 1e-4) { d += s.burn; s.burn = 0; }
    this.hurt(s, d, 0);
    if (!s.dead && s.hp <= 1e-9 * s.maxHp) this.killSlime(s);
  }

  // Lightning: part of the last bolt's damage arcs to the nearest other slime (to the one it
  // hit, if there is none near).
  arc(s, sl, x, y) {
    let best = null, bd = ARC_R * ARC_R;
    for (const o of this.slimes) {
      if (o === sl || o.dead || o.ghost) continue;
      const d = (o.x - x) ** 2 + (o.y - y) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    const to = best ?? (sl && !sl.dead ? sl : null);
    if (!to) return;
    this.hurt(to, s.arc, 1);
    this.ev('arc', { x0: x, y0: y, x1: to.x, y1: to.y });
    if (to.hp <= 1e-9 * to.maxHp) this.killSlime(to);
  }

  // Takes HP off a slime: whatever the armour, softness and bubble of a campaign kind let
  // through. hits: how many hits the damage stands for (each meets the armour on its own; none
  // for burning).
  hurt(sl, dmg, hits) {
    const k = sl.kind;
    if (k) {
      const base = sl.size === BOSS ? this.bigHp : sl.maxHp;
      if (k.armor && hits) dmg = Math.max(dmg - k.armor * base * hits * (k.plates ? (3 - sl.stage) / 3 : 1), dmg * ARMOR_KEEP);
      if (k.cap && hits) dmg = Math.min(dmg, k.cap * this.bigHp * hits); // the small ones are no softer
      if (k.rage) sl.wanderT = Math.min(sl.wanderT, 0.15); // off it goes, faster
      if (sl.asleep) { sl.asleep = false; sl.wanderT = 0.05; this.ev('wake', { x: sl.x, y: sl.y - sl.r }); }
      if (sl.shield > 0) {
        const soak = Math.min(sl.shield, dmg);
        sl.shield -= soak;
        dmg -= soak;
        if (sl.shield <= 0) this.ev('shieldPop', { x: sl.x, y: sl.y, r: sl.r });
      }
    }
    const before = sl.hp;
    sl.hp -= dmg;                      // overkill is simply wasted
    this.dealt += Math.min(dmg, before);
  }

  // ---------------------------------------------------------------- campaign kinds
  // What a campaign kind does besides drifting down.
  kindStep(s, dt) {
    const k = s.kind, rng = this.rng;
    if (k.summon && (s.summonT -= dt) <= 0) this.summon(s);
    if (k.hop) {
      const before = s.hopT;
      s.hopT -= dt;
      if (s.hopT <= 0) {
        // a leap, mostly towards the side with more room
        s.hopT = range(k.hop.every, rng);
        const room = s.x - minX(s) < maxX(s) - s.x ? 1 : -1;
        s.kx += (rng.next() < 0.75 ? room : -room) * k.hop.push;
        s.ky -= 20;
        s.sqv = -3.5;
        this.ev('hop', { x: s.x, y: s.y + s.r });
      } else if (before > 0.3 && s.hopT <= 0.3) s.sqv = 2.5; // crouch first
    }
    if (k.ghost) this.ghostStep(s, dt);
    if (k.loop) this.loopStep(s, dt);
    if (k.snake) {
      // the S-curve: its sideways drift follows a sine
      const sn = k.snake, w = TAU / sn.period;
      s.snakeP += w * dt;
      s.vx = s.tvx = sn.amp * w * Math.cos(s.snakeP);
    }
    if (k.blink && (s.blinkT -= dt) <= 0) {
      // gone, and back a little to the side
      s.blinkT = range(k.blink.every, rng);
      const d = range(k.blink.dist, rng), room = s.x - minX(s) < maxX(s) - s.x ? 1 : -1;
      this.ev('teleport', { x: s.x, y: s.y, r: s.r });
      s.x = clamp(s.x + (rng.next() < 0.7 ? room : -room) * d, minX(s), maxX(s));
      s.flash = 0.06;
      this.ev('teleport', { x: s.x, y: s.y, r: s.r });
    }
    if (k.heal && (s.healT -= dt) <= 0) this.heal(s);
    if (k.spit && (s.spitT -= dt) <= 0) this.spit(s);
    if (k.plates || k.shed) {
      while (s.stage < 3 && s.hp < s.maxHp * (0.75 - 0.25 * s.stage)) {
        s.stage++;
        if (k.shed) this.shed(s);
        this.ev('phase', { x: s.x, y: s.y, r: s.r, k: k.id });
      }
    }
  }

  // A prism flies loops, turning one way and then the other, up as well as down; never too low.
  // After a while it flies off the top (and takes its coins with it).
  loopStep(s, dt) {
    const lp = s.kind.loop, rng = this.rng;
    if (!s.fleeing && s.age > lp.flee) s.fleeing = true;
    if ((s.loopT -= dt) <= 0) {
      s.loopT = rng.range(0.5, 1.3);
      s.loopW = rng.sign() * rng.range(2.5, 5.5);
    }
    s.loopA += s.loopW * dt;
    if (s.fleeing || s.y + s.r > LOSE_Y - 70) s.loopA += angDiff(UP, s.loopA) * Math.min(1, 6 * dt); // head up
    const v = lp.speed * (s.fleeing ? 1.6 : 1);
    s.vx = s.tvx = Math.cos(s.loopA) * v;
    s.vy = s.tvy = Math.sin(s.loopA) * v + (s.fleeing ? 0 : lp.drift); // the loops drift down
    if (s.fleeing && s.y < this.topY - s.r) { s.dead = true; this.ev('flee', { x: s.x, y: this.topY + 4 }); }
  }

  // Bomber: when it pops, the slimes around it are blown down and apart.
  blast(s) {
    const b = s.kind.blast, k = s.r / SLIME_R[0], R = b.r * (0.5 + 0.5 * k);
    for (const o of this.slimes) {
      if (o === s || o.dead) continue;
      const dx = o.x - s.x, dy = o.y - s.y, d = Math.hypot(dx, dy);
      if (d > R + o.r) continue;
      const f = b.push * k * (1 - d / (R + o.r) * 0.5) * (SLIME_R[0] / o.r) ** 0.5;
      o.kx += (dx / (d || 1)) * f * 0.5;
      o.ky += f; // mostly down
    }
    this.ev('blast', { x: s.x, y: s.y, r: R });
  }

  // Ghosts are there for a while, then fade out; shots pass through them while they are faded.
  ghostStep(s, dt) {
    const gh = s.kind.ghost, T = gh.on + gh.off + 2 * FADE_T;
    const t = (s.ghostT = (s.ghostT + dt) % T);
    s.fade = t < gh.on ? 1 : t < gh.on + FADE_T ? 1 - (t - gh.on) / FADE_T
      : t < gh.on + FADE_T + gh.off ? 0 : (t - gh.on - FADE_T - gh.off) / FADE_T;
    const was = s.ghost;
    s.ghost = s.fade < 0.5;
    if (s.kind.teleport && s.ghost && !was) {
      // the phantom comes back somewhere else
      this.ev('teleport', { x: s.x, y: s.y, r: s.r });
      s.x = this.rng.range(minX(s), maxX(s));
      s.y = Math.max(this.topY + s.r + 4, s.y - 24);
    }
  }

  heal(s) {
    const h = s.kind.heal;
    s.healT = h.every;
    for (const o of this.slimes) {
      if (o.dead || o.hp >= o.maxHp) continue;
      const dx = o.x - s.x, dy = o.y - s.y, reach = h.range + o.r;
      if (dx * dx + dy * dy > reach * reach) continue;
      o.hp = Math.min(o.maxHp, o.hp + o.maxHp * h.amount);
      this.ev('heal', { x: o.x, y: o.y - o.r * 0.6 });
    }
  }

  // Goo falls straight down (or towards the gun, from the tank).
  spit(s) {
    const sp = s.kind.spit;
    s.spitT = range(sp.every, this.rng);
    const x = s.x, y = s.y + s.r * 0.7;
    for (let i = 0; i < sp.n; i++) {
      let vx = (i - (sp.n - 1) / 2) * 28;
      if (sp.aim) vx += (this.gun.x - x) / Math.max(0.4, (MUZZLE_Y - y) / GOO.speed);
      this.goo.push({ x, y, vx, vy: GOO.speed, dead: false });
    }
    this.ev('spit', { x, y });
  }

  // Goo on the gun jams one of its barrels for a moment; the rest splats on the belt.
  updateGoo(dt) {
    const gun = this.gun;
    for (const b of this.goo) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y >= MUZZLE_Y - 2 && Math.abs(b.x - gun.x) < GUN_HALF) {
        b.dead = true;
        const free = this.emitters.filter((em) => !(em.jam > 0));
        const em = free.length ? this.rng.pick(free) : null;
        if (em) { em.jam = GOO.jam; em.pulse = null; }
        this.ev('jam', { x: b.x, y: b.y, slot: em ? em.slot : -1 });
      } else if (b.y > CHAIN_TOP) {
        b.dead = true;
        this.ev('gooSplat', { x: b.x, y: CHAIN_TOP });
      }
    }
    compact(this.goo);
  }

  // A boss sheds two of its young when it passes 75, 50 and 25 % HP.
  shed(s) {
    const kind = KINDS[s.kind.shed];
    for (const side of [-1, 1]) {
      const c = this.makeSlime(0, s.x + side * s.r * 0.6, s.y + s.r * 0.3, this.bigHp * (kind.hp ?? 1), side > 0 ? 1 : 0, kind);
      c.kx = side * 60;
      c.ky = 30;
      c.g0 = 0.3;
      c.growT = 0.4;
      c.sqv = 2.5;
      this.pending.push(c);
    }
  }

  // A boss calls for help: slimes drop out from below it.
  summon(s) {
    const sm = s.kind.summon, kind = KINDS[sm.kind];
    s.summonT = sm.every;
    for (let i = 0; i < sm.n; i++) {
      const c = this.makeSlime(0, s.x + (i - (sm.n - 1) / 2) * 56, s.y + s.r * 0.5, this.bigHp * (kind.hp ?? 1), i % 2, kind);
      c.ky = 50;
      c.g0 = 0.3;
      c.growT = 0.4;
      c.sqv = 2.5;
      this.pending.push(c);
    }
    this.ev('summon', { x: s.x, y: s.y + s.r * 0.5 });
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
    const y0 = Math.min(py, p.y), y1 = Math.max(py, p.y);
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
        if (sl.dead || sl.ghost || sl.id === p.ignore || sl.y + sl.hr < y0 || sl.y - sl.hr > y1) continue;
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
    const dmg = p.hits === s.hits ? s.first : s.dmg;
    this.strike(s, sl, dmg, 1);
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const k = s.recoil * (SLIME_R[0] / sl.r);
    sl.kx += (p.vx / sp) * k;
    sl.ky += (p.vy / sp) * k;
    sl.kick = clamp(sl.kick + rng.range(-1, 1) * s.rotKick * DEG, -MAX_KICK, MAX_KICK);
    sl.sqv += 1.2 + Math.min(3, s.recoil * 0.08);
    if (sl.flashCd <= 0) { sl.flash = 0.035; sl.flashCd = 0.12; } // short white flash, not too often
    sl.hurt = 0.18;
    this.ev('hit', { x: hx, y: hy, p, sl, last: p.hits === 1 }); // (p and sl: for the looks of some weapons)
    const killed = sl.hp <= 1e-9 * sl.maxHp;
    if (killed) this.killSlime(sl);
    p.hits--;
    this.usedHits++;
    p.rest = Array.isArray(s.rest) ? range(s.rest, rng) : s.rest;
    p.lastHit = killed ? this.nearestChild(hx, hy) : sl;
    // No wasted hits: unless the projectile is sure to land another hit, the remaining hits
    // land right now (on this slime, or on one of its children if this hit popped it).
    if (p.hits > 0 && !this.canHitAgain(p, killed ? null : sl, hx, hy)) {
      this.deliverRest(p, p.lastHit, hx, hy, sl.id);
      return;
    }
    if (p.hits <= 0) {
      if (s.arc) this.arc(s, sl, hx, hy);
      if (s.split) this.split(p, hx, hy, sl.id);
      p.dead = true;
    }
  }

  // All remaining hits of a projectile land on one slime at once; then it is used up.
  deliverRest(p, into, x, y, ignore = -1) {
    // with dumpFamily the sub-projectiles do not split off: their damage lands here as well
    const family = p.w.dumpFamily && p.s.split && into;
    if (into && (p.hits > 0 || family)) {
      const own = p.hits === p.s.hits ? p.s.total : p.s.dmg * p.hits;
      const extra = own + (family ? p.s.below : 0);
      this.strike(p.s, into, extra, Math.max(1, p.hits));
      this.usedHits += p.hits;
      into.flash = 0.035;
      // show the hit on the slime's edge facing the projectile
      const dx = x - into.x, dy = y - into.y, d = Math.hypot(dx, dy) || 1, k = Math.min(1, (into.r * 0.85) / d);
      this.ev('hit', { x: into.x + dx * k, y: into.y + dy * k, p, sl: into, last: true });
      if (into.hp <= 1e-9 * into.maxHp) this.killSlime(into);
      if (p.s.arc) this.arc(p.s, into, x, y);
    }
    p.hits = 0;
    if (family) { if (p.s.split.fx) this.ev('split', { x, y, fx: p.s.split.fx }); }
    else if (p.s.split) this.split(p, x, y, ignore);
    p.dead = true;
  }

  // A careful estimate, erring on the side of "no": will the projectile land another hit?
  // Either it is still well inside the slime it just hit when its rest is over (allowing
  // for that slime drifting), or a slime lies squarely ahead: its predicted position is
  // crossed through the middle, and the projectile is still inside it after the rest.
  canHitAgain(p, cur, hx, hy) {
    const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp;
    const rest = p.rest, rx = hx + ux * sp * rest, ry = hy + uy * sp * rest;
    if (cur && !cur.ghost) {
      const cvx = cur.vx + cur.kx + cur.px, cvy = cur.vy + cur.ky + cur.py;
      const cx = cur.x + cvx * rest, cy = cur.y + cvy * rest;
      if (Math.hypot(rx - cx, ry - cy) < cur.hr - 3 - Math.hypot(cvx, cvy) * rest) return true;
    }
    return this.slimeAhead(this.slimes, p, cur, rx, ry, ux, uy, sp) || this.slimeAhead(this.pending, p, cur, rx, ry, ux, uy, sp);
  }

  // Does a slime of the list lie squarely ahead of the ray from (rx, ry)?
  slimeAhead(list, p, cur, rx, ry, ux, uy, sp) {
    const rest = p.rest, ignore = p.ignore;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o.dead || o.ghost || o === cur || o.id === ignore) continue;
      const vx = o.vx + o.kx + o.px, vy = o.vy + o.ky + o.py;
      const t = Math.max(0, ((o.x - rx) * ux + (o.y - ry) * uy) / sp) + rest;
      const ox = o.x + vx * t - rx, oy = o.y + vy * t - ry;
      const r = (o.hr || o.r * 0.55) * 0.65;
      const across = Math.abs(ox * uy - oy * ux);
      if (across > r) continue;
      if (ox * ux + oy * uy + Math.sqrt(r * r - across * across) > 4) return true; // still inside after the rest
    }
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

  // ---------------------------------------------------------------- campaign levels
  // Like a wave, but played once from the level's script; then the level is cleared.
  updateScript(dt) {
    if (this.waveState === 'done') return;
    const list = this.script;
    let fieldHp = 0;
    for (const s of this.slimes) fieldHp += s.hp;
    this.waveT += dt * (1 + 2 * clamp(1 - fieldHp / (1.5 * this.bigHp), 0, 1));
    if (this.slimes.length === 0 && this.spawnIdx < list.length) {
      const nt = list[this.spawnIdx].t;
      if (nt - this.waveT > FF_GAP) this.waveT = nt - FF_GAP;
    }
    while (this.spawnIdx < list.length && list[this.spawnIdx].t <= this.waveT) this.spawnFromScript(list[this.spawnIdx++]);
    if (this.spawnIdx >= list.length && this.slimes.length === 0 && this.pending.length === 0) {
      this.waveState = 'done';
      this.ev('levelClear', { level: this.level });
    }
  }

  spawnFromScript(e) {
    const kind = KINDS[e.kind], size = e.size ?? 0;
    if (kind.swarm) {
      // a cluster of small ones, which soon go their own ways
      for (let i = 0; i < kind.swarm; i++) {
        const a = (i / (kind.swarm - 1)) * TAU, d = i ? 21 : 0;
        const c = this.makeSlime(size, e.x + Math.cos(a) * d, this.topY + 34 + Math.sin(a) * d * 0.7, this.bigHp * e.hp, e.type, kind);
        c.sqv = -2;
        this.slimes.push(c);
      }
      this.ev('spawn', { x: e.x, y: this.topY + 34, k: kind.id, boss: false });
      return;
    }
    // a boss starts a little lower, so its HP bar does not cover it
    const s = this.makeSlime(size, e.x, this.topY + SLIME_R[size] + (size === BOSS ? 20 : 4), this.bigHp * e.hp, e.type, kind);
    s.sqv = -2;
    if (size === BOSS) this.boss = s;
    this.slimes.push(s);
    this.ev('spawn', { x: s.x, y: s.y, k: kind.id, boss: size === BOSS });
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
