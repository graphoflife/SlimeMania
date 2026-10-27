// Every weapon is the same class of thing: a set of numbers.
//
// Weapon level parameters
//   interval  time between pulses            (range)
//   count     projectiles per pulse          (constant)
//   pulse     pulse length; the projectiles are emitted evenly over it (range)
//   speed     projectile speed in px/s       (range; every projectile is fast)
//   angle     launch angle in degrees, 0 = straight up (range). fan: spread evenly.
//             sweep: a fan that goes left to right, then back right to left, without a break
//             (the pulse fills the interval). tintByFan: colour each shot by its fan position.
//             beam: the shots of a pulse share one angle and get evenly stepped speeds.
//   (trailFrac: tail length as a fraction of the distance flown, instead of trailLen)
//
// Stage parameters (stage 0 = the projectile, 1 = sub projectiles, 2 = sub-sub)
//   share     fraction of the total damage carried by this stage
//   hits      how many times it can hit; each hit deals 1/hits of its damage
//   rest      resting time between two hits
//   recoil    push on the slime per hit (px/s for a big slime)
//   rotKick   max random instant rotation of the slime per hit (degrees)
//   trail     tail look: bolt | laser | wind | staff | fire | tint | star | smoke (trailLen px)
//   aim       a shot that would obviously miss when it appears turns towards the closest slime
//             (in any direction, the only exception to "always upwards")
//   split     sub projectiles released where the last hit lands:
//             { count, mode: 'burst' (spread around straight up) | 'cone' | 'fan' (around the
//               parent), angle, speed | speedFactor, tint, fx (explosion look) }
//
// Projectiles never slow down, time out or explode early: they fly upwards in a straight line
// until their last hit lands on a slime (then they may split) or until they leave the screen.
// A projectile that could not hit anything again gives all its remaining hits to the slime it
// is in, so no hits are wasted.
// Weapons make no sound; only hits and pops do.
//
// Ranges: U(mean, spread) is uniform in [mean - spread, mean + spread], N(mean, std) normal.
import { effDps, effLevel, rateFactor } from './economy.js';
import { BALANCE, BALANCE_LEVELS } from './balance.js';

const U = (mean, spread = 0) => ({ mean, spread, dist: 'u' });
const N = (mean, spread) => ({ mean, spread, dist: 'n' });

export const TINTS = {
  party: ['#ff3a7c', '#3ad7ff', '#ffe23a', '#7dff3a', '#c04dff', '#ff8c1a'],
  // pastel rainbow, from the left of the fan to the right
  pastel: ['#ff8f9f', '#ffc27a', '#fff27a', '#93ec93', '#8cc8ff', '#c99cff'],
};

export const WEAPONS = [
  {
    id: 'mg', name: 'Machine Gun', desc: 'A steady stream of hot lead.',
    interval: U(0.08, 0.008), count: 1, pulse: U(0),
    speed: U(780, 45), angle: U(0, 2.5),
    stages: [{ sprite: 'bullet', recoil: 1.7, rotKick: 6 }],
  },
  {
    id: 'shotgun', name: 'Shotgun', desc: 'One pump, eight pellets.',
    interval: U(0.9, 0.08), count: 8, pulse: U(0),
    speed: U(720, 90), angle: U(0, 15),
    stages: [{ sprite: 'pellet', orient: 'none', recoil: 2.7, rotKick: 12 }],
  },
  {
    id: 'water', name: 'Water Droplets', desc: 'A splashy burst of ten drops.',
    interval: U(0.4, 0.04), count: 10, pulse: U(0.2, 0.02),
    speed: U(660, 75), angle: N(0, 4),
    stages: [{ sprite: 'drop', recoil: 0.7, rotKick: 4 }],
  },
  {
    id: 'shuriken', name: 'Ninja Stars', desc: 'Spinning stars that slice five times.',
    interval: U(0.55, 0.1), count: 4, pulse: U(0.18, 0.03), fan: true,
    speed: U(645, 30), angle: U(0, 10),
    stages: [{ sprite: 'shuriken', orient: 'spin', spin: [16, 24], hits: 5, rest: 0.033, recoil: 1.7, rotKick: 15 }],
  },
  {
    id: 'arrows', name: 'Arrows', desc: 'Fast, piercing and punchy.',
    interval: U(0.5, 0.1), count: 3, pulse: U(0.15, 0.03),
    speed: U(930, 60), angle: U(0, 2),
    stages: [{ sprite: 'arrow', trail: 'wind', trailLen: 22, hits: 3, rest: 0.04, recoil: 4, rotKick: 10 }],
  },
  {
    id: 'leaves', name: 'Plant Leaves', desc: 'A swirling gust of razor leaves.',
    interval: N(0.45, 0.12), count: 6, pulse: U(0.3, 0.05),
    speed: U(600, 75), angle: U(0, 25),
    stages: [{ sprite: 'leaf', orient: 'spin', spin: [6, 12], hits: 2, rest: 0.04, recoil: 1, rotKick: 20 }],
  },
  {
    id: 'laser', name: 'Laser', desc: 'One long, solid beam that pierces everything.',
    // 8 segments leave together, each a step faster than the one behind: they stretch out
    // along one line, and their tails fill the gaps, so it looks like one long beam
    interval: U(0.45, 0.05), count: 8, pulse: U(0), beam: true,
    speed: U(1050, 350), angle: U(0, 1),
    stages: [{ sprite: 'laser', trail: 'laser', trailFrac: 0.17, hits: 15, rest: 0.017, recoil: 1, rotKick: 5 }],
  },
  {
    id: 'bomb', name: 'Small Bomb', desc: 'A bomb that bursts into shrapnel.',
    interval: U(0.8, 0.15), count: 2, pulse: U(0.2, 0.04),
    speed: U(600, 30), angle: U(0, 6),
    stages: [
      { sprite: 'bomb', orient: 'spin', spin: [3, 6], share: 0.35, recoil: 4, rotKick: 14,
        split: { count: 14, mode: 'burst', angle: 75, speed: [600, 750], fx: 'boom' } },
      { sprite: 'frag', orient: 'none', share: 0.65, recoil: 2, rotKick: 10 },
    ],
  },
  {
    id: 'banana', name: 'Banana', desc: 'Slippery. Makes slimes spin.',
    interval: U(0.7, 0.2), count: 2, pulse: U(0.25, 0.05),
    speed: U(630, 60), angle: U(0, 12),
    stages: [{ sprite: 'banana', orient: 'spin', spin: [10, 15], hits: 5, rest: 0.027, recoil: 1.3, rotKick: 45 }],
  },
  {
    id: 'daggers', name: 'Daggers', desc: 'A never-ending fan of blades, sweeping back and forth.',
    interval: U(0.55), count: 5, pulse: U(0), sweep: true,
    speed: U(840, 30), angle: U(0, 16),
    stages: [{ sprite: 'dagger', recoil: 2.7, rotKick: 10 }],
  },
  {
    id: 'snow', name: 'Snowflakes', desc: 'Flakes that shatter into more flakes.',
    interval: U(0.7, 0.15), count: 3, pulse: U(0.3, 0.05),
    speed: U(600, 45), angle: U(0, 12),
    stages: [
      { sprite: 'flake', orient: 'spin', spin: [2, 4], share: 0.4, hits: 3, rest: 0.04, recoil: 0.7, rotKick: 6,
        split: { count: 3, mode: 'burst', angle: 40, speed: [570, 675] } },
      { sprite: 'flake_s', orient: 'spin', spin: [3, 5], share: 0.6, hits: 2, rest: 0.04, recoil: 0.7, rotKick: 6 },
    ],
  },
  {
    id: 'popcorn', name: 'Popcorn', desc: 'Hot kernels that pop on impact.',
    interval: U(0.6, 0.15), count: 4, pulse: U(0.25, 0.05),
    speed: U(630, 60), angle: U(0, 10),
    stages: [
      { sprite: 'kernel', orient: 'none', share: 0.3, recoil: 1, rotKick: 8,
        split: { count: 3, mode: 'burst', angle: 50, speed: [570, 690], fx: 'popcorn' } },
      { sprite: 'popcorn', orient: 'spin', spin: [4, 9], share: 0.7, hits: 2, rest: 0.033, recoil: 1.3, rotKick: 12 },
    ],
  },
  {
    id: 'lightning', name: 'Lightning', desc: 'Forking bolts of pure zap.',
    interval: N(0.5, 0.12), count: 1, pulse: U(0),
    speed: U(1350), angle: U(0, 8),
    stages: [
      { sprite: 'bolt', orient: 'none', trail: 'bolt', share: 0.2, hits: 2, rest: 0.02, recoil: 1.3, rotKick: 10,
        split: { count: 2, mode: 'cone', angle: 35, speedFactor: [0.9, 1.1] } },
      { sprite: 'bolt', orient: 'none', trail: 'bolt', share: 0.35, hits: 2, rest: 0.02, recoil: 1.3, rotKick: 10,
        split: { count: 2, mode: 'cone', angle: 35, speedFactor: [0.9, 1.1] } },
      { sprite: 'bolt', orient: 'none', trail: 'bolt', share: 0.45, hits: 2, rest: 0.02, recoil: 1.3, rotKick: 10 },
    ],
  },
  {
    id: 'flames', name: 'Flames', desc: 'A roaring, endless stream of fire.',
    interval: U(0.12, 0.03), count: 5, pulse: U(0.1, 0.02),
    speed: U(630, 90), angle: N(0, 7),
    stages: [{ sprite: ['flame0', 'flame1', 'flame2', 'flame3'], anim: 'age', orient: 'none', hits: 3, rest: 0.033, recoil: 0.3, rotKick: 3 }],
  },
  {
    id: 'nails', name: 'Nail Gun', desc: 'Tack tack tack tack tack.',
    interval: U(0.12, 0.04), count: 1, pulse: U(0),
    speed: U(1050, 45), angle: U(0, 4),
    stages: [{ sprite: 'nail', recoil: 1.3, rotKick: 5 }],
  },
  {
    id: 'grenade', name: 'Grenade', desc: 'Explodes into grenades that explode.',
    interval: U(1.0, 0.15), count: 2, pulse: U(0.3, 0.05),
    speed: U(600, 30), angle: U(0, 6),
    stages: [
      { sprite: 'grenade', orient: 'spin', spin: [6, 9], share: 0.15, recoil: 3.3, rotKick: 12,
        split: { count: 4, mode: 'cone', angle: 40, speed: [600, 690], fx: 'boom' } },
      { sprite: 'grenade_mini', orient: 'spin', spin: [7, 11], share: 0.3, recoil: 2.7, rotKick: 10,
        split: { count: 8, mode: 'burst', angle: 60, speed: [570, 720], fx: 'boom_s' } },
      { sprite: 'frag', orient: 'none', share: 0.55, hits: 2, rest: 0.027, recoil: 1.7, rotKick: 8 },
    ],
  },
  {
    id: 'plasma', name: 'Plasma', desc: 'Orbs that chew five times, then divide: 2, 4, 8.',
    interval: U(0.9, 0.2), count: 2, pulse: U(0.3, 0.05),
    speed: U(570, 30), angle: U(0, 6),
    stages: [
      { sprite: ['plasma0', 'plasma1'], anim: 8, orient: 'none', share: 0.25, hits: 5, rest: 0.03, recoil: 1.3, rotKick: 6,
        split: { count: 2, mode: 'cone', angle: 30, speedFactor: [0.95, 1.05], fx: 'plasma' } },
      { sprite: ['plasma_m0', 'plasma_m1'], anim: 8, orient: 'none', share: 0.35, hits: 5, rest: 0.03, recoil: 1, rotKick: 6,
        split: { count: 2, mode: 'cone', angle: 30, speedFactor: [0.95, 1.05], fx: 'plasma' } },
      { sprite: ['plasma_s0', 'plasma_s1'], anim: 8, orient: 'none', share: 0.4, hits: 5, rest: 0.03, recoil: 0.7, rotKick: 6 },
    ],
  },
  {
    id: 'bubbles', name: 'Bubbles', desc: 'Clouds of little bubbles that pop into tinier ones.',
    interval: N(0.3, 0.06), count: 8, pulse: U(0.25, 0.04),
    speed: U(585, 60), angle: U(0, 20),
    stages: [
      { sprite: 'bubble', orient: 'none', share: 0.5, recoil: 0.7, rotKick: 8,
        split: { count: 3, mode: 'burst', angle: 50, speed: [570, 660], fx: 'bubblepop' } },
      { sprite: 'bubble_s', orient: 'none', share: 0.5, recoil: 0.5, rotKick: 6 },
    ],
  },
  {
    id: 'saw', name: 'Saw Blades', desc: 'Blades that grind, then shatter into smaller blades.',
    interval: U(1.0, 0.2), count: 2, pulse: U(0.4, 0.05),
    speed: U(570, 30), angle: U(0, 10),
    stages: [
      { sprite: 'saw', orient: 'spin', spin: [24, 30], share: 0.3, hits: 6, rest: 0.017, recoil: 0.7, rotKick: 10,
        split: { count: 2, mode: 'cone', angle: 35, speedFactor: [0.95, 1.05], fx: 'sparks' } },
      { sprite: 'saw_m', orient: 'spin', spin: [26, 32], share: 0.35, hits: 6, rest: 0.017, recoil: 0.5, rotKick: 8,
        split: { count: 2, mode: 'cone', angle: 35, speedFactor: [0.95, 1.05], fx: 'sparks' } },
      { sprite: 'saw_s', orient: 'spin', spin: [28, 34], share: 0.35, hits: 6, rest: 0.017, recoil: 0.4, rotKick: 6 },
    ],
  },
  {
    id: 'bigbomb', name: 'Bigger Bomb', desc: 'Like the small one. But bigger.',
    interval: U(1.2, 0.2), count: 1, pulse: U(0),
    speed: U(570), angle: U(0, 4),
    stages: [
      { sprite: 'bigbomb', orient: 'spin', spin: [2, 3.5], share: 0.3, recoil: 6, rotKick: 16,
        split: { count: 18, mode: 'burst', angle: 80, speed: [600, 780], fx: 'bigboom' } },
      { sprite: 'frag_big', orient: 'none', share: 0.4, hits: 2, rest: 0.027, recoil: 2.7, rotKick: 10,
        split: { count: 3, mode: 'cone', angle: 30, speed: [570, 690], fx: 'boom_s' } },
      { sprite: 'frag', orient: 'none', share: 0.3, recoil: 1.7, rotKick: 8 },
    ],
  },
  {
    id: 'ice', name: 'Ice Shards', desc: 'Frozen spikes that pierce three deep.',
    interval: U(0.45, 0.1), count: 4, pulse: U(0.1, 0.02), fan: true,
    speed: U(900, 60), angle: U(0, 8),
    stages: [{ sprite: 'icicle', hits: 3, rest: 0.027, recoil: 2, rotKick: 8 }],
  },
  {
    id: 'fireworks', name: 'Fireworks', desc: 'Rockets that burst into fireworks.',
    interval: U(0.8, 0.2), count: 2, pulse: U(0.35, 0.05),
    speed: U(630, 45), angle: U(0, 10),
    stages: [
      { sprite: 'rocket', trail: 'smoke', trailLen: 20, share: 0.15, recoil: 2, rotKick: 8,
        split: { count: 10, mode: 'burst', angle: 70, speed: [570, 690], tint: 'random', fx: 'firework' } },
      { sprite: 'spark', orient: 'none', tints: TINTS.party, share: 0.5, recoil: 1.3, rotKick: 8,
        split: { count: 2, mode: 'cone', angle: 25, speed: [570, 660], fx: 'firework_s' } },
      { sprite: 'twinkle', orient: 'none', tints: TINTS.party, share: 0.35, recoil: 1, rotKick: 6 },
    ],
  },
  {
    id: 'notes', name: 'Music Notes', desc: 'Notes flying on their own sheet music.',
    interval: U(0.4, 0.1), count: 3, pulse: U(0.3, 0.05),
    speed: U(630, 45), angle: U(0, 15),
    stages: [{ sprite: 'note', orient: 'none', tints: TINTS.party, trail: 'staff', trailLen: 30, hits: 2, rest: 0.04, recoil: 1.7, rotKick: 25 }],
  },
  {
    id: 'ducks', name: 'Rubber Ducks', desc: 'Squeaky, bouncy, surprisingly heavy.',
    interval: U(0.8, 0.2), count: 2, pulse: U(0.3, 0.05),
    speed: U(630, 60), angle: U(0, 12),
    stages: [{ sprite: 'duck', orient: 'spin', spin: [5, 8], hits: 4, rest: 0.033, recoil: 7.3, rotKick: 35 }],
  },
  {
    id: 'meteor', name: 'Meteor', desc: 'A burning rock that explodes, and explodes, and explodes.',
    interval: U(1.0, 0.2), count: 1, pulse: U(0),
    speed: U(570, 15), angle: U(0, 6),
    stages: [
      { sprite: 'meteor', trail: 'fire', trailLen: 26, share: 0.3, hits: 3, rest: 0.033, recoil: 5.3, rotKick: 14,
        split: { count: 5, mode: 'cone', angle: 50, speed: [570, 690], fx: 'bigboom' } },
      { sprite: 'rock', orient: 'spin', spin: [3, 6], trail: 'fire', trailLen: 14, share: 0.35, hits: 2, rest: 0.033, recoil: 2.7, rotKick: 10,
        split: { count: 4, mode: 'burst', angle: 50, speed: [570, 660], fx: 'boom' } },
      { sprite: 'pebble', orient: 'none', trail: 'fire', trailLen: 8, share: 0.35, recoil: 1.3, rotKick: 8 },
    ],
  },
  {
    id: 'rainbow', name: 'Rainbow', desc: 'A super fast fan, back and forth: together the shots paint a rainbow.',
    interval: U(0.2), count: 6, pulse: U(0), sweep: true, tintByFan: true,
    speed: U(840), angle: U(0, 12),
    stages: [{ sprite: 'rainbow', tints: TINTS.pastel, trail: 'tint', trailLen: 42, hits: 3, rest: 0.03, recoil: 1.3, rotKick: 8 }],
  },
  {
    id: 'nova', name: 'Supernova', desc: 'A star that explodes into stars that explode.',
    interval: U(1.0, 0.2), count: 1, pulse: U(0),
    speed: U(600), angle: U(0, 4),
    stages: [
      { sprite: 'star_big', orient: 'spin', spin: [4, 6], trail: 'star', trailLen: 44, share: 0.2, hits: 8, rest: 0.033, recoil: 3.3, rotKick: 14,
        split: { count: 8, mode: 'burst', angle: 75, speed: [570, 690], fx: 'nova' } },
      { sprite: 'star', orient: 'spin', spin: [6, 10], trail: 'star', trailLen: 22, aim: true, share: 0.4, hits: 4, rest: 0.033, recoil: 2, rotKick: 10,
        split: { count: 5, mode: 'burst', angle: 60, speed: [570, 690], fx: 'boom_s' } },
      { sprite: 'spark_w', orient: 'none', aim: true, share: 0.4, hits: 4, rest: 0.027, recoil: 1.3, rotKick: 8 },
    ],
  },
];

// Balance factors (nominal DPS multiplier) come from tools/balance.mjs, measured at a few
// weapon levels up to 31 (after that the pulse stops shrinking); log-interpolated in between.
function balance(id, level) {
  const b = BALANCE[id];
  if (!b) return 1;
  const L = BALANCE_LEVELS;
  if (level >= L[L.length - 1]) return b[b.length - 1];
  let i = 0;
  while (level > L[i + 1]) i++;
  const t = (level - L[i]) / (L[i + 1] - L[i]);
  return Math.exp(Math.log(b[i]) * (1 - t) + Math.log(b[i + 1]) * t);
}

const STAGE_DEFAULTS = {
  orient: 'dir', spin: [0, 0], share: 1, hits: 1, rest: 0.033, recoil: 1.7, rotKick: 8,
  split: null, trail: null, tints: null, anim: null,
};

WEAPONS.forEach((w, i) => { w.index = i; });

for (const w of WEAPONS) {
  w.quality ??= 1;
  w.fan ??= false;
  w.stages = w.stages.map((s) => ({ ...STAGE_DEFAULTS, ...s }));
}

// Build the runtime stats of a weapon at its own level. DPS follows the effective level on
// the shared ladder; pulse speed and balance follow the weapon's own level.
// nominalDps overrides the DPS (used by the balancing tool).
export function buildStats(def, level, nominalDps) {
  const dps = nominalDps ?? shownDps(def, level) * balance(def.id, level);
  const f = rateFactor(level);
  const interval = { ...def.interval, mean: def.interval.mean * f, spread: def.interval.spread * f };
  const pulse = { ...def.pulse, mean: def.pulse.mean * f, spread: def.pulse.spread * f };
  const family = dps * interval.mean / def.count; // total damage of one projectile incl. its children
  let mult = 1;
  const stages = def.stages.map((s, i) => {
    if (i > 0) mult *= def.stages[i - 1].split.count;
    return { ...s, dmg: family * s.share / mult / s.hits };
  });
  return {
    id: def.id, def, level, dps, interval, pulse, stages,
    count: def.count, speed: def.speed, angle: def.angle, fan: def.fan, sweep: def.sweep, tintByFan: def.tintByFan,
    beam: def.beam,
  };
}

// DPS shown in the shop (what the weapon effectively deals).
export function shownDps(def, level) {
  return effDps(effLevel(def.index, level)) * def.quality;
}
