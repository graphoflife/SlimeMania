// Campaign levels. Every level is generated from its number, so it is the same every time it
// is played: a script of spawns that gets longer, denser and stranger as the levels go on,
// with a mini boss on every 5th and a big boss on every 10th level.
import { RNG } from './rng.js';
import { W, SLIME_R, BOSS } from './config.js';
import { KINDS, KIND_LIST, BOSSES } from './kinds.js';
import { CAMPAIGN_HP } from './campaign-table.js';

export const WORLD_SIZE = 10;
export const HEARTS = 3;
const RARITY = { common: 60, uncommon: 24, rare: 9, veryRare: 2.5 };
const BOSS_HP = [12, 25];  // boss HP in big slimes: mini boss, big boss
const CLEAR_BONUS = 0.5;   // clearing pays this share of all the level's slimes are worth, x stars / 3

// HP of a big slime on level n (tools/campaign.mjs fits the table; beyond it, the growth of its
// last world goes on)
export function levelHp(n) {
  const t = CAMPAIGN_HP, m = t.length;
  if (n <= m) return t[n - 1];
  return t[m - 1] * (t[m - 1] / t[m - 11]) ** ((n - m) / 10);
}

// Money a slime and everything it pops into is worth.
function worth(kind, size, hp, bigHp) {
  const v = hp * (kind.value ?? 1);
  if (size === 2) return v;
  const ck = KINDS[kind.childKind ?? kind.id];
  return v + (kind.children ?? 3) * worth(ck, size === BOSS ? 0 : size + 1, size === BOSS ? bigHp : hp / 3, bigHp);
}

export function campaignLevel(n) {
  const rng = new RNG(n * 7919 + 17);
  const boss = n % 5 === 0 ? BOSSES[(n / 5 - 1) % BOSSES.length] : null;
  const pool = KIND_LIST.filter((k) => !k.boss && k.from <= n);
  const fresh = pool.filter((k) => k.from === n);
  const count = Math.round((12 + 33 * (1 - Math.exp(-(n - 1) / 30))) * (boss ? 0.6 : 1));
  const gap = 1.5 - 0.7 * (1 - Math.exp(-(n - 1) / 20)); // mean time between two spawns
  // rarer kinds get more likely as the levels go on
  const weight = (k) => RARITY[k.rarity] * (k.rarity === 'common' ? 1 : 1 + n / 40);
  const total = pool.reduce((s, k) => s + weight(k), 0);
  const pick = () => {
    let r = rng.next() * total;
    for (const k of pool) if ((r -= weight(k)) < 0) return k;
    return pool[0];
  };
  // a new kind shows up a few times on its first level (a very rare one just once)
  const forced = new Map();
  fresh.forEach((k, j) => (k.rarity === 'veryRare' ? [4] : [2, 5, 9]).forEach((i) => forced.set(i + j, k)));
  const script = [];
  let t = 0.6, lastX = W / 2;
  for (let i = 0; i < count; i++) {
    const kind = forced.get(i) ?? pick();
    const r = SLIME_R[0];
    let x;
    do { x = rng.range(r + 2, W - r - 2); } while (Math.abs(x - lastX) < 40);
    lastX = x;
    script.push({ t, x, kind: kind.id, size: 0, hp: kind.hp ?? 1, type: i % 2 });
    t += rng.next() < 0.12 + n / 300 ? 0.2 : rng.range(0.6, 1.4) * gap; // now and then two at once
  }
  if (boss) {
    script.push({ t: t + 3, x: W / 2, kind: boss.id, size: BOSS, hp: BOSS_HP[n % 10 === 0 ? 1 : 0] * (boss.hp ?? 1), type: 0 });
  }
  const hp = levelHp(n);
  const value = script.reduce((s, e) => s + worth(KINDS[e.kind], e.size, e.hp * hp, hp), 0);
  return { n, world: Math.ceil(n / WORLD_SIZE), boss, script, fresh, hp, value };
}

// What clearing a level pays on top of its pops.
export const clearBonus = (lv, stars) => Math.round(CLEAR_BONUS * lv.value * (stars / HEARTS));
