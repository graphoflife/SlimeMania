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
//   armor        every hit loses this fraction of the slime's full HP (at least ARMOR_KEEP stays)
//   shield       a bubble with this fraction of its HP soaks up the first hits
//   zigzag       quick sideways moves instead of ambling down
//   boss         size 3, with an HP bar
//   summon       { every: s, n, kind }: drops slimes from below itself now and then
export const ARMOR_KEEP = 0.15;

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
  mama: {
    name: 'MAMA SLIME', tip: 'POPS INTO FIVE', from: 10, rarity: 'uncommon',
    colors: ['#ff7ab0', '#ff9ac4', '#ffbad8'], children: 5, childKind: 'blob',
  },
  // ---------------------------------------------------------------- bosses
  king: {
    name: 'KING BLOB', tip: 'IT CALLS FOR HELP', from: 5, rarity: 'boss', boss: true,
    colors: ['#7a3dff', '#7a3dff', '#7a3dff'], speed: 0.4, hearts: 3, childKind: 'blob',
    summon: { every: 5, n: 2, kind: 'blob' },
  },
};

for (const [id, k] of Object.entries(KINDS)) k.id = id;
export const KIND_LIST = Object.values(KINDS);
export const BOSSES = KIND_LIST.filter((k) => k.boss);
