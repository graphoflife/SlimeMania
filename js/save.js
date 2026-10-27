// Progress is stored in localStorage.
import { WEAPONS } from './weapons.js';
import { weaponStart, effDps, slimeHp, levelCost } from './economy.js';

const KEY = 'slimemania.save.v1';

// On disk, weapons are stored by id ({ id: level }), so removing or reordering weapons never
// mixes up progress. In memory the game uses arrays indexed like WEAPONS.
// Older saves stored arrays in the weapon order of their time:
const V2_IDS = ['mg', 'shotgun', 'water', 'shuriken', 'arrows', 'leaves', 'laser', 'bomb', 'banana',
  'daggers', 'snow', 'popcorn', 'lightning', 'flames', 'nails', 'grenade', 'plasma', 'bubbles', 'cannon',
  'saw', 'dollar', 'bigbomb', 'ice', 'fireworks', 'splitter', 'notes', 'ducks', 'meteor', 'prism', 'nova'];
const V3_IDS = ['mg', 'shotgun', 'water', 'shuriken', 'arrows', 'leaves', 'laser', 'bomb', 'banana',
  'daggers', 'snow', 'popcorn', 'lightning', 'flames', 'nails', 'grenade', 'plasma', 'bubbles', 'saw',
  'bigbomb', 'ice', 'fireworks', 'notes', 'ducks', 'meteor', 'rainbow', 'nova'];
const RENAMED = { prism: 'rainbow', splitter: 'grenade' };

export function freshSave() {
  return {
    v: 4,
    money: 0,
    level: 1,       // level being played
    maxLevel: 1,    // highest unlocked level
    levels: WEAPONS.map((_, i) => (i === 0 ? 1 : 0)), // 0 = not owned yet
    equipped: [0],
    muted: false,
    hinted: false,
    sky: 'auto',    // 'auto' (night 20:00-06:00 by the clock) | 'day' | 'night'
    kills: 0,
  };
}

export function loadSave() {
  const s = freshSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return s;
    const d = JSON.parse(raw);
    if (!d || ![1, 2, 3, 4].includes(d.v)) return s;
    let byId, equippedIds;
    if (d.v === 4) {
      byId = d.weapons || {};
      equippedIds = d.equippedIds || [];
    } else {
      const ids = d.v === 3 ? V3_IDS : V2_IDS;
      byId = {};
      d.levels.forEach((l, k) => {
        const id = RENAMED[ids[k]] || ids[k];
        if (id && l > 0) byId[id] = Math.max(byId[id] || 0, l);
      });
      equippedIds = d.equipped.map((k) => RENAMED[ids[k]] || ids[k]);
    }
    for (const key of ['money', 'level', 'maxLevel', 'muted', 'hinted', 'sky', 'kills']) if (key in d) s[key] = d[key];
    s.levels = WEAPONS.map((w) => byId[w.id] || 0);
    if (s.levels[0] < 1) s.levels[0] = 1;
    s.equipped = [...new Set(equippedIds.map((id) => WEAPONS.findIndex((w) => w.id === id)))]
      .filter((i) => i >= 0 && s.levels[i] > 0).slice(0, 3);
    if (!s.equipped.length) s.equipped = [0];
    if (!isFinite(s.money) || s.money < 0) s.money = 0;
  } catch { /* corrupted or blocked storage: start fresh */ }
  return s;
}

// Test save (?testall): every weapon owned and on the same rung of the cost ladder as the
// last weapon at level 30, so they all deal the same DPS.
// Starts on a level one weapon clears comfortably; unlocked up to what three can clear.
export function testAllSave() {
  const s = freshSave();
  const last = WEAPONS.length - 1;
  const eff = weaponStart(last) + 29;
  s.levels = WEAPONS.map((_, k) => eff - weaponStart(k) + 1);
  s.equipped = [last, last - 1, last - 2];
  const beatable = (dps, margin) => {
    let L = 1;
    while (dps >= margin * 1.4 * slimeHp(L + 1)) L++;
    return L;
  };
  s.level = beatable(effDps(eff), 2);
  s.maxLevel = beatable(3 * effDps(eff), 1);
  s.money = levelCost(eff + 1) * 100;
  s.hinted = true;
  return s;
}

export function writeSave(s) {
  const { levels, equipped, ...rest } = s;
  const out = {
    ...rest,
    v: 4,
    weapons: Object.fromEntries(WEAPONS.map((w, i) => [w.id, levels[i]]).filter(([, l]) => l > 0)),
    equippedIds: equipped.map((i) => WEAPONS[i].id),
  };
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* storage unavailable */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
