// Every weapon is the same class of thing: a set of numbers.
//
// Weapon level parameters
//   interval  time between pulses            (range)
//   count     projectiles per pulse          (constant)
//   pulse     pulse length; the projectiles are emitted evenly over it (range)
//   speed     projectile speed in px/s       (range)
//   angle     launch angle in degrees, 0 = straight up (range). fan: spread evenly.
//
// Stage parameters (stage 0 = the projectile, 1 = sub projectiles, 2 = sub-sub)
//   share     fraction of the total damage carried by this stage
//   hits      how many times it can hit; each hit deals 1/hits of its damage
//   rest      resting time between two hits
//   recoil    push on the slime per hit (px/s for a big slime)
//   rotKick   max random instant rotation of the slime per hit (degrees)
//   slowOnHit speed multiplier per hit, drag = speed decay per second
//   life      lifetime range in seconds
//   split     { when: 'hit' | 'time' | 'expire' combined with '|', time, count,
//               mode: 'radial' | 'cone' | 'fan', angle, speed | speedFactor, tint }
//
// Ranges: U(mean, spread) is uniform in [mean - spread, mean + spread], N(mean, std) normal.
// `bal` is the balance factor from tools/balance.mjs that makes all weapons equally strong.
import { effDps, rateFactor } from './economy.js';
import { BALANCE, BALANCE_LEVELS } from './balance.js';

const U = (mean, spread = 0) => ({ mean, spread, dist: 'u' });
const N = (mean, spread) => ({ mean, spread, dist: 'n' });

export const TINTS = {
  party: ['#ff3a7c', '#3ad7ff', '#ffe23a', '#7dff3a', '#c04dff', '#ff8c1a'],
  rainbow: ['#ff2a3c', '#ff8c1a', '#ffe23a', '#3ee35a', '#2f9dff', '#5a4bff', '#d04dff'],
};

export const WEAPONS = [
  {
    id: 'mg', name: 'Machine Gun', desc: 'Rattling bursts of hot lead.',
    interval: U(0.32, 0.04), count: 4, pulse: U(0.16, 0.02),
    speed: U(430, 30), angle: U(0, 2.5), sfx: 'mg', sfxPer: 'shot',
    stages: [{ sprite: 'bullet', recoil: 5, rotKick: 6 }],
  },
  {
    id: 'shotgun', name: 'Shotgun', desc: 'One pump, eight pellets.',
    interval: U(0.9, 0.08), count: 8, pulse: U(0),
    speed: U(380, 60), angle: U(0, 15), sfx: 'shotgun', sfxPer: 'pulse',
    stages: [{ sprite: 'pellet', orient: 'none', recoil: 8, rotKick: 12 }],
  },
  {
    id: 'water', name: 'Water Droplets', desc: 'A splashy stream of tiny drops.',
    interval: U(0.5, 0.1), count: 14, pulse: U(0.4, 0.05),
    speed: U(270, 50), angle: N(0, 4), sfx: 'drop', sfxPer: 'shot',
    stages: [{ sprite: 'drop', recoil: 2, rotKick: 4 }],
  },
  {
    id: 'shuriken', name: 'Ninja Stars', desc: 'Spinning stars that slice three times.',
    interval: U(0.55, 0.1), count: 3, pulse: U(0.18, 0.03), fan: true,
    speed: U(320, 20), angle: U(0, 9), sfx: 'shing', sfxPer: 'shot',
    stages: [{ sprite: 'shuriken', orient: 'spin', spin: [14, 22], hits: 3, rest: 0.1, slowOnHit: 0.8, recoil: 5, rotKick: 15 }],
  },
  {
    id: 'arrows', name: 'Arrows', desc: 'Fast, piercing and punchy.',
    interval: U(0.5, 0.1), count: 3, pulse: U(0.15, 0.03),
    speed: U(520, 40), angle: U(0, 2), sfx: 'thwip', sfxPer: 'shot',
    stages: [{ sprite: 'arrow', hits: 3, rest: 0.12, recoil: 12, rotKick: 10 }],
  },
  {
    id: 'leaves', name: 'Plant Leaves', desc: 'A gentle, swirling gust of leaves.',
    interval: N(0.45, 0.12), count: 6, pulse: U(0.3, 0.05),
    speed: U(170, 60), angle: U(0, 25), sfx: 'rustle', sfxPer: 'pulse',
    stages: [{ sprite: 'leaf', orient: 'spin', spin: [3, 9], hits: 2, rest: 0.2, drag: 0.1, recoil: 3, rotKick: 20 }],
  },
  {
    id: 'laser', name: 'Laser', desc: 'Pew pew. Pierces like butter.',
    interval: U(0.4, 0.05), count: 3, pulse: U(0.12, 0.02),
    speed: U(700), angle: U(0, 1), sfx: 'pew', sfxPer: 'shot',
    stages: [{ sprite: 'laser', hits: 4, rest: 0.04, recoil: 3, rotKick: 5 }],
  },
  {
    id: 'bomb', name: 'Small Bomb', desc: 'A bomb that bursts into shrapnel.',
    interval: U(0.8, 0.15), count: 2, pulse: U(0.2, 0.04),
    speed: U(200, 20), angle: U(0, 6), sfx: 'launch', sfxPer: 'shot',
    stages: [
      { sprite: 'bomb', orient: 'spin', spin: [2, 4], share: 0.35, recoil: 12, rotKick: 14,
        split: { when: 'hit', count: 14, mode: 'radial', speed: [140, 220], sfx: 'boom' } },
      { sprite: 'frag', orient: 'none', share: 0.65, life: [0.14, 0.24], recoil: 6, rotKick: 10 },
    ],
  },
  {
    id: 'banana', name: 'Banana', desc: 'Slippery. Makes slimes spin.',
    interval: U(0.7, 0.2), count: 2, pulse: U(0.25, 0.05),
    speed: U(230, 40), angle: U(0, 12), sfx: 'boing', sfxPer: 'shot',
    stages: [{ sprite: 'banana', orient: 'spin', spin: [8, 13], hits: 5, rest: 0.12, slowOnHit: 0.9, recoil: 4, rotKick: 45 }],
  },
  {
    id: 'daggers', name: 'Daggers', desc: 'A fan of five flying blades.',
    interval: U(0.65, 0.1), count: 5, pulse: U(0), fan: true,
    speed: U(450, 20), angle: U(0, 14), sfx: 'swish', sfxPer: 'pulse',
    stages: [{ sprite: 'dagger', recoil: 8, rotKick: 10 }],
  },
  {
    id: 'snow', name: 'Snowflakes', desc: 'Drifting flakes that crumble into more flakes.',
    interval: U(0.7, 0.15), count: 3, pulse: U(0.3, 0.05),
    speed: U(150, 30), angle: U(0, 12), sfx: 'chime', sfxPer: 'shot',
    stages: [
      { sprite: 'flake', orient: 'spin', spin: [1, 3], share: 0.4, hits: 2, rest: 0.2, recoil: 2, rotKick: 6,
        split: { when: 'hit|time', time: [0.7, 1.2], count: 3, mode: 'radial', speed: [100, 160] } },
      { sprite: 'flake_s', orient: 'spin', spin: [2, 4], share: 0.6, hits: 2, rest: 0.2, life: [1.5, 2.5], drag: 0.2, recoil: 2, rotKick: 6 },
    ],
  },
  {
    id: 'popcorn', name: 'Popcorn', desc: 'Hot kernels that pop mid-air.',
    interval: U(0.6, 0.15), count: 4, pulse: U(0.25, 0.05),
    speed: U(260, 40), angle: U(0, 10), sfx: 'tick', sfxPer: 'shot',
    stages: [
      { sprite: 'kernel', orient: 'none', share: 0.3, recoil: 3, rotKick: 8,
        split: { when: 'hit|time', time: [0.35, 0.75], count: 3, mode: 'radial', speed: [80, 160], sfx: 'popcorn' } },
      { sprite: 'popcorn', orient: 'spin', spin: [3, 8], share: 0.7, hits: 2, rest: 0.1, drag: 1.0, life: [1.2, 1.8], recoil: 4, rotKick: 12 },
    ],
  },
  {
    id: 'lightning', name: 'Lightning', desc: 'Forking bolts of pure zap.',
    interval: N(0.5, 0.12), count: 1, pulse: U(0),
    speed: U(900), angle: U(0, 8), sfx: 'zap', sfxPer: 'shot',
    stages: [
      { sprite: 'bolt', orient: 'none', trail: 'bolt', share: 0.2, hits: 2, rest: 0.03, life: [0.1, 0.14], recoil: 4, rotKick: 10,
        split: { when: 'hit|expire', count: 2, mode: 'cone', angle: 35, speedFactor: [0.9, 1.1] } },
      { sprite: 'bolt', orient: 'none', trail: 'bolt', share: 0.35, hits: 2, rest: 0.03, life: [0.1, 0.14], recoil: 4, rotKick: 10,
        split: { when: 'hit|expire', count: 2, mode: 'cone', angle: 35, speedFactor: [0.9, 1.1] } },
      { sprite: 'bolt', orient: 'none', trail: 'bolt', share: 0.45, hits: 2, rest: 0.03, life: [0.15, 0.25], recoil: 4, rotKick: 10 },
    ],
  },
  {
    id: 'flames', name: 'Flames', desc: 'Short range, endless fire.',
    interval: U(0.12, 0.03), count: 5, pulse: U(0.1, 0.02),
    speed: U(240, 60), angle: N(0, 6), sfx: 'flame', sfxPer: 'pulse',
    stages: [{ sprite: ['flame0', 'flame1', 'flame2', 'flame3'], anim: 'life', orient: 'none', hits: 3, rest: 0.12, drag: 0.8, life: [1.4, 1.8], recoil: 1, rotKick: 3 }],
  },
  {
    id: 'nails', name: 'Nail Gun', desc: 'Tack tack tack tack tack.',
    interval: U(0.12, 0.04), count: 1, pulse: U(0),
    speed: U(600, 30), angle: U(0, 4), sfx: 'nail', sfxPer: 'shot',
    stages: [{ sprite: 'nail', recoil: 4, rotKick: 5 }],
  },
  {
    id: 'grenade', name: 'Grenade', desc: 'Pull pin, throw, enjoy.',
    interval: U(0.9, 0.15), count: 2, pulse: U(0.3, 0.05),
    speed: U(230, 30), angle: U(0, 8), sfx: 'tunk', sfxPer: 'shot',
    stages: [
      { sprite: 'grenade', orient: 'spin', spin: [5, 8], share: 0.25, drag: 0.6, recoil: 10, rotKick: 12,
        split: { when: 'hit|time', time: [0.9, 1.3], count: 14, mode: 'radial', speed: [140, 260], sfx: 'boom' } },
      { sprite: 'frag', orient: 'none', share: 0.75, life: [0.15, 0.25], recoil: 6, rotKick: 10 },
    ],
  },
  {
    id: 'plasma', name: 'Plasma', desc: 'A slow orb that chews through everything.',
    interval: U(0.9, 0.2), count: 2, pulse: U(0.3, 0.05),
    speed: U(140, 20), angle: U(0, 6), sfx: 'plasma', sfxPer: 'shot',
    stages: [{ sprite: ['plasma0', 'plasma1'], anim: 8, orient: 'none', hits: 14, rest: 0.06, slowOnHit: 0.94, recoil: 4, rotKick: 6 }],
  },
  {
    id: 'bubbles', name: 'Bubbles', desc: 'Bubbles that pop into smaller bubbles.',
    interval: N(0.35, 0.1), count: 3, pulse: U(0.2, 0.05),
    speed: U(120, 50), angle: U(0, 18), sfx: 'bubble', sfxPer: 'shot',
    stages: [
      { sprite: 'bubble', orient: 'none', share: 0.5, recoil: 3, rotKick: 8,
        split: { when: 'hit', count: 4, mode: 'radial', speed: [60, 120], sfx: 'bubblepop' } },
      { sprite: 'bubble_s', orient: 'none', share: 0.5, life: [0.3, 0.5], drag: 1, recoil: 2, rotKick: 6 },
    ],
  },
  {
    id: 'cannon', name: 'Cannon', desc: 'Heavy iron. Shoves slimes back.',
    interval: U(0.7, 0.1), count: 2, pulse: U(0.15, 0.03),
    speed: U(300, 15), angle: U(0, 3), sfx: 'cannon', sfxPer: 'shot',
    stages: [{ sprite: 'cannonball', orient: 'none', hits: 4, rest: 0.06, slowOnHit: 0.8, recoil: 26, rotKick: 18 }],
  },
  {
    id: 'saw', name: 'Saw Blades', desc: 'Whirring blades that grind and grind.',
    interval: U(1.0, 0.2), count: 2, pulse: U(0.4, 0.05),
    speed: U(160, 20), angle: U(0, 10), sfx: 'saw', sfxPer: 'shot',
    stages: [{ sprite: 'saw', orient: 'spin', spin: [22, 28], hits: 16, rest: 0.05, slowOnHit: 0.94, recoil: 2, rotKick: 10 }],
  },
  {
    id: 'dollar', name: 'Dollar Bills', desc: 'Make it rain! (It does not help much.)', quality: 0.3,
    interval: U(0.45, 0.15), count: 5, pulse: U(0.3, 0.05),
    speed: U(110, 40), angle: U(0, 25), sfx: 'cash', sfxPer: 'pulse',
    stages: [{ sprite: 'dollar', orient: 'spin', spin: [2, 6], hits: 2, rest: 0.15, drag: 0.3, recoil: 1, rotKick: 6 }],
  },
  {
    id: 'bigbomb', name: 'Bigger Bomb', desc: 'Like the small one. But bigger.',
    interval: U(1.2, 0.2), count: 1, pulse: U(0),
    speed: U(150), angle: U(0, 4), sfx: 'launch', sfxPer: 'shot',
    stages: [
      { sprite: 'bigbomb', orient: 'spin', spin: [1.5, 2.5], share: 0.3, recoil: 18, rotKick: 16,
        split: { when: 'hit', count: 18, mode: 'radial', speed: [160, 280], sfx: 'bigboom' } },
      { sprite: 'frag_big', orient: 'none', share: 0.4, hits: 2, rest: 0.05, life: [0.15, 0.3], recoil: 8, rotKick: 10,
        split: { when: 'hit|expire', count: 3, mode: 'radial', speed: [80, 140] } },
      { sprite: 'frag', orient: 'none', share: 0.3, life: [0.1, 0.18], recoil: 5, rotKick: 8 },
    ],
  },
  {
    id: 'ice', name: 'Ice Shards', desc: 'Frozen spikes that pierce three deep.',
    interval: U(0.45, 0.1), count: 4, pulse: U(0.1, 0.02), fan: true,
    speed: U(480, 40), angle: U(0, 8), sfx: 'ice', sfxPer: 'shot',
    stages: [{ sprite: 'icicle', hits: 3, rest: 0.06, recoil: 6, rotKick: 8 }],
  },
  {
    id: 'fireworks', name: 'Fireworks', desc: 'Rockets that burst into colourful sparks.',
    interval: U(0.8, 0.2), count: 2, pulse: U(0.35, 0.05),
    speed: U(280, 30), angle: U(0, 10), sfx: 'whistle', sfxPer: 'shot',
    stages: [
      { sprite: 'rocket', share: 0.15, recoil: 6, rotKick: 8,
        split: { when: 'hit|time', time: [0.5, 0.9], count: 10, mode: 'radial', speed: [120, 200], tint: 'random', sfx: 'crackle' } },
      { sprite: 'spark', orient: 'none', tints: TINTS.party, share: 0.5, life: [0.3, 0.45], drag: 1.5, recoil: 4, rotKick: 8,
        split: { when: 'hit|expire', count: 2, mode: 'radial', speed: [40, 80] } },
      { sprite: 'twinkle', orient: 'none', tints: TINTS.party, share: 0.35, life: [0.2, 0.3], drag: 2, recoil: 3, rotKick: 6 },
    ],
  },
  {
    id: 'splitter', name: 'Splitter Grenade', desc: 'A grenade full of grenades.',
    interval: U(1.0, 0.2), count: 1, pulse: U(0),
    speed: U(230), angle: U(0, 5), sfx: 'tunk', sfxPer: 'shot',
    stages: [
      { sprite: 'grenade_red', orient: 'spin', spin: [5, 8], share: 0.15, drag: 0.5, recoil: 10, rotKick: 12,
        split: { when: 'hit|time', time: [0.6, 0.9], count: 4, mode: 'cone', angle: 40, speed: [130, 190], sfx: 'boom' } },
      { sprite: 'grenade_mini', orient: 'spin', spin: [6, 10], share: 0.3, drag: 0.8, recoil: 8, rotKick: 10,
        split: { when: 'hit|time', time: [0.3, 0.5], count: 10, mode: 'radial', speed: [140, 220], sfx: 'boom' } },
      { sprite: 'frag', orient: 'none', share: 0.55, hits: 2, rest: 0.05, life: [0.12, 0.2], recoil: 5, rotKick: 8 },
    ],
  },
  {
    id: 'notes', name: 'Music Notes', desc: 'Every shot plays a tune.',
    interval: U(0.4, 0.1), count: 3, pulse: U(0.3, 0.05),
    speed: U(200, 30), angle: U(0, 15), sfx: 'note', sfxPer: 'shot',
    stages: [{ sprite: 'note', orient: 'none', tints: TINTS.party, hits: 2, rest: 0.15, recoil: 5, rotKick: 25 }],
  },
  {
    id: 'ducks', name: 'Rubber Ducks', desc: 'Squeaky, bouncy, surprisingly heavy.',
    interval: U(0.8, 0.2), count: 2, pulse: U(0.3, 0.05),
    speed: U(210, 40), angle: U(0, 12), sfx: 'squeak', sfxPer: 'shot',
    stages: [{ sprite: 'duck', orient: 'spin', spin: [4, 7], hits: 4, rest: 0.12, slowOnHit: 0.85, recoil: 22, rotKick: 35 }],
  },
  {
    id: 'meteor', name: 'Meteor', desc: 'Rock, then rocks, then pebbles.',
    interval: U(1.0, 0.2), count: 1, pulse: U(0),
    speed: U(130, 10), angle: U(0, 6), sfx: 'meteor', sfxPer: 'shot',
    stages: [
      { sprite: 'meteor', share: 0.3, hits: 2, rest: 0.08, recoil: 16, rotKick: 14,
        split: { when: 'hit', count: 6, mode: 'cone', angle: 60, speed: [110, 190], sfx: 'rumble' } },
      { sprite: 'rock', orient: 'spin', spin: [3, 6], share: 0.35, hits: 2, rest: 0.08, life: [0.7, 1.1], recoil: 8, rotKick: 10,
        split: { when: 'hit|expire', count: 4, mode: 'radial', speed: [90, 150] } },
      { sprite: 'pebble', orient: 'none', share: 0.35, life: [0.15, 0.25], recoil: 4, rotKick: 8 },
    ],
  },
  {
    id: 'prism', name: 'Rainbow Prism', desc: 'One crystal, seven beams.',
    interval: U(0.8, 0.15), count: 1, pulse: U(0),
    speed: U(500), angle: U(0, 3), sfx: 'prism', sfxPer: 'shot',
    stages: [
      { sprite: 'prism', orient: 'none', share: 0.1, recoil: 4, rotKick: 6,
        split: { when: 'hit|time', time: [0.15, 0.25], count: 7, mode: 'fan', angle: 24, speedFactor: [1.1, 1.2], tint: 'index', sfx: 'shimmer' } },
      { sprite: 'beam', tints: TINTS.rainbow, share: 0.9, hits: 3, rest: 0.05, recoil: 4, rotKick: 8 },
    ],
  },
  {
    id: 'nova', name: 'Supernova', desc: 'A star that explodes into stars that explode.',
    interval: U(1.0, 0.2), count: 1, pulse: U(0),
    speed: U(170), angle: U(0, 4), sfx: 'novaShot', sfxPer: 'shot',
    stages: [
      { sprite: 'star_big', orient: 'spin', spin: [3, 5], share: 0.2, hits: 2, rest: 0.1, recoil: 10, rotKick: 14,
        split: { when: 'hit|time', time: [0.6, 0.9], count: 8, mode: 'radial', speed: [160, 240], sfx: 'nova' } },
      { sprite: 'star', orient: 'spin', spin: [5, 9], share: 0.4, hits: 2, rest: 0.1, recoil: 6, rotKick: 10,
        split: { when: 'hit|time', time: [0.25, 0.4], count: 5, mode: 'radial', speed: [120, 200], sfx: 'crackle' } },
      { sprite: 'spark_w', orient: 'none', share: 0.4, hits: 2, rest: 0.06, life: [0.3, 0.45], drag: 1, recoil: 4, rotKick: 8 },
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
  orient: 'dir', spin: [0, 0], share: 1, hits: 1, rest: 0.08, recoil: 5, rotKick: 8,
  slowOnHit: 1, drag: 0, life: [4, 4], split: null, trail: null, tints: null, anim: null,
};

for (const w of WEAPONS) {
  w.quality ??= 1;
  w.fan ??= false;
  w.stages = w.stages.map((s) => ({ ...STAGE_DEFAULTS, ...s }));
}

// Build the runtime stats of a weapon at a level. nominalDps overrides the DPS
// (used by the balancing tool); otherwise it follows the level curve.
export function buildStats(def, level, nominalDps) {
  const dps = nominalDps ?? effDps(level) * def.quality * balance(def.id, level);
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
    count: def.count, speed: def.speed, angle: def.angle, fan: def.fan,
    sfx: def.sfx, sfxPer: def.sfxPer,
  };
}

// DPS shown in the shop (what the weapon effectively deals).
export const shownDps = (def, level) => effDps(level) * def.quality;
