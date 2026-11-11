// Slime kinds of the campaign. Every kind is the same jelly slime with its own colours, a little
// accessory and one twist in how it behaves. The world only looks at these fields for slimes
// that have a kind: Zen slimes have none and behave exactly as always.
//
//   name, tip    shown when the kind first appears in the campaign
//   from         first campaign level it can appear on
//   rarity       common | uncommon | rare | veryRare (how often it is picked)
//   colors       body colour per size [big, medium, small]; null: the level's own colours
//   hp           HP multiplier
//   speed        drift speed multiplier
//   value        money multiplier of its pops
//   children     how many slimes it pops into (default 3)
//   childKind    kind of those (default: its own)
//   hearts       hearts lost if it reaches the bottom (default 1)
//   armor        every hit loses this fraction of the slime's full HP (at least ARMOR_KEEP stays;
//                for bosses: of a big slime's HP)
//   shield       a bubble with this fraction of its HP soaks up the first hits
//   zigzag       quick sideways moves instead of ambling down
//   cap          soft: one hit takes at most this fraction of a big slime's HP (any size)
//   hop          { every: [s, s], push: px/s }: now and then it squats and leaps sideways
//   rage         gets up to this much faster the more it is hurt (angry face)
//   ghost        { on, off } seconds: fades out for `off` every cycle; shots pass through then
//   heal         { every, range, amount }: heals slimes near it by a fraction of their HP
//   spit         { every: [s, s], n, aim }: spits goo at the gun; goo on the gun jams a barrel
//   swarm        n: comes as a cluster of n small slimes
//   boss         size 3, with an HP bar
//   summon       { every: s, n, kind }: drops slimes from below itself now and then
//   plates       (boss) its armour is in 3 plates that break off at 75 / 50 / 25 % HP
//   shed         (boss) kind it sheds 2 of at 75 / 50 / 25 % HP
//   teleport     (boss, with ghost) reappears somewhere else
export const ARMOR_KEEP = 0.15;
export const GOO = { speed: 115, jam: 1.6 }; // spat goo: falls at px/s, jams a barrel for s

export const KINDS = {
  blob: {
    name: 'BLOB', tip: '', from: 1, rarity: 'common', colors: null,
  },
  zippy: {
    name: 'ZIPPY', tip: 'FAST, BUT EASY TO POP', from: 2, rarity: 'common',
    colors: ['#1ae8e0', '#2f8cff', '#9dff1a'], hp: 0.6, speed: 1.8,
  },
  golden: {
    name: 'GOLDEN SLIME', tip: 'CATCH IT: 10X COINS', from: 3, rarity: 'veryRare',
    colors: ['#ffc21a', '#ffd84a', '#ffe98a'], hp: 0.8, speed: 1.25, value: 10, hearts: 0, zigzag: true,
  },
  bubble: {
    name: 'BUBBLE SLIME', tip: 'POP THE BUBBLE FIRST', from: 4, rarity: 'uncommon',
    colors: null, shield: 0.6, childKind: 'blob',
  },
  stone: {
    name: 'STONE SLIME', tip: 'BIG HITS CRACK IT', from: 8, rarity: 'uncommon',
    colors: ['#8d93a6', '#a3a9ba', '#b9bfcd'], armor: 0.03,
  },
  hopper: {
    name: 'HOPPER', tip: 'IT LEAPS ASIDE NOW AND THEN', from: 6, rarity: 'uncommon',
    colors: ['#ff8c1a', '#ffa64a', '#ffc27a'], hop: { every: [1.8, 3], push: 110 },
  },
  mama: {
    name: 'MAMA SLIME', tip: 'POPS INTO FIVE', from: 10, rarity: 'uncommon',
    colors: ['#ff7ab0', '#ff9ac4', '#ffbad8'], children: 5, childKind: 'blob',
  },
  gloop: {
    name: 'GLOOP', tip: 'SOFT: MANY SMALL HITS WIN', from: 12, rarity: 'uncommon',
    colors: ['#5ac83c', '#7ad85a', '#9aeb7a'], cap: 0.04,
  },
  grumpy: {
    name: 'GRUMPY', tip: 'HURT IT AND IT HURRIES', from: 13, rarity: 'uncommon',
    colors: ['#b05aff', '#c47aff', '#d79cff'], rage: 1.6,
  },
  ghost: {
    name: 'GHOST SLIME', tip: 'SHOTS PASS THROUGH WHILE IT FADES', from: 15, rarity: 'rare',
    colors: ['#d8d0ff', '#e2dcff', '#ece8ff'], ghost: { on: 2.2, off: 0.9 },
  },
  medic: {
    name: 'MEDIC', tip: 'IT HEALS ITS FRIENDS: POP IT FIRST', from: 17, rarity: 'rare',
    colors: ['#5ae0b4', '#7aeac4', '#9af2d6'], heal: { every: 1, range: 64, amount: 0.05 },
  },
  spitter: {
    name: 'SPITTER', tip: 'DODGE THE GOO OR A BARREL JAMS', from: 19, rarity: 'rare',
    colors: ['#9dff1a', '#b8ff5a', '#d0ff8a'], spit: { every: [2.5, 4], n: 1, aim: false },
  },
  swarm: {
    name: 'SWARM', tip: 'TINY, FAST AND MANY', from: 22, rarity: 'common',
    colors: ['#ffe21a', '#ffe21a', '#ffe21a'], swarm: 7, hp: 0.13, speed: 1.35, hearts: 0.25,
  },
  // ---------------------------------------------------------------- bosses
  king: {
    name: 'KING BLOB', tip: 'IT CALLS FOR HELP', from: 5, rarity: 'boss', boss: true,
    colors: ['#7a3dff'], speed: 0.4, hearts: 3, childKind: 'blob',
    summon: { every: 5, n: 2, kind: 'blob' },
  },
  golem: {
    name: 'ROCK GOLEM', tip: 'BREAK ITS PLATES', from: 10, rarity: 'boss', boss: true,
    colors: ['#7a8094'], speed: 0.35, hearts: 3, childKind: 'stone', armor: 0.03, plates: true,
  },
  phantom: {
    name: 'PHANTOM', tip: 'NOW YOU SEE IT', from: 15, rarity: 'boss', boss: true,
    colors: ['#cfc4ff'], speed: 0.4, hearts: 3, childKind: 'ghost', ghost: { on: 2.6, off: 1.1 }, teleport: true,
  },
  gloopMother: {
    name: 'GLOOP MOTHER', tip: 'SHE SHEDS HER YOUNG', from: 20, rarity: 'boss', boss: true,
    colors: ['#3fae2a'], speed: 0.4, hearts: 3, childKind: 'gloop', cap: 0.04, shed: 'gloop',
  },
  spitTank: {
    name: 'SPITTER TANK', tip: 'GOO EVERYWHERE', from: 25, rarity: 'boss', boss: true,
    colors: ['#8ae01a'], speed: 0.4, hearts: 3, childKind: 'spitter', spit: { every: [2.4, 3.2], n: 3, aim: true },
  },
};

for (const [id, k] of Object.entries(KINDS)) k.id = id;
export const KIND_LIST = Object.values(KINDS);
export const BOSSES = KIND_LIST.filter((k) => k.boss);
