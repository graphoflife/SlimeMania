// Progress is stored in localStorage.
import { WEAPONS } from './weapons.js';
import { weaponStart, effDps, slimeHp, levelCost, ECON } from './economy.js';

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
// Before v5 the slimes got twice as strong per level (now ECON.HP_GROWTH): an old level becomes
// the highest new one whose slimes are no stronger, so a save never lands on a level out of reach.
const fromV4Level = (l) => 1 + Math.floor(((l - 1) * Math.log(2)) / Math.log(ECON.HP_GROWTH) + 1e-9);

// The Zen progress sits at the top level of the save, the campaign's in `campaign` and the test
// lab's picks in `lab`; all have money, level, maxLevel, levels (weapon levels) and equipped.
// Since v6.
export function freshSave() {
  return {
    v: 6,
    money: 0,
    level: 1,       // level being played
    maxLevel: 1,    // highest unlocked level
    levels: WEAPONS.map((_, i) => (i === 0 ? 1 : 0)), // 0 = not owned yet
    equipped: [0],
    muted: false,
    hinted: false,
    sky: 'auto',    // 'auto' (night 20:00-06:00 by the clock) | 'day' | 'night'
    kills: 0,
    mode: 'zen',    // the mode played last: 'zen' | 'campaign' | 'lab'
    campaign: freshCampaign(),
    lab: freshLab(),
  };
}

export function freshCampaign() {
  return {
    money: 0, level: 1, maxLevel: 1,
    levels: WEAPONS.map((_, i) => (i === 0 ? 1 : 0)),
    equipped: [0],
    stars: {},      // level -> best stars
    seen: [],       // slime kinds already introduced
  };
}

// The test lab: every weapon, at any level; the slime it spawns and how.
export function freshLab() {
  return {
    money: 0, level: 1, maxLevel: 1,
    levels: WEAPONS.map(() => 1),
    equipped: [0],
    kind: 'blob',   // slime kind it spawns
    size: 0,        // its size (bosses and swarms have their own)
    count: 1,       // how many come per spawn
    pop: 2,         // big slime HP: seconds the equipped weapons take to pop one
    auto: false,    // keeps spawning on its own
    speed: 1,       // game speed (slow motion below 1)
  };
}

// weapons on disk are stored by id
function weaponsFrom(p, byId, equippedIds) {
  p.levels = WEAPONS.map((w) => byId[w.id] || 0);
  if (p.levels[0] < 1) p.levels[0] = 1;
  p.equipped = [...new Set(equippedIds.map((id) => WEAPONS.findIndex((w) => w.id === id)))]
    .filter((i) => i >= 0 && p.levels[i] > 0).slice(0, 3);
  if (!p.equipped.length) p.equipped = [0];
  if (!isFinite(p.money) || p.money < 0) p.money = 0;
}

function weaponsTo(p) {
  const { levels, equipped, ...rest } = p;
  return {
    ...rest,
    weapons: Object.fromEntries(WEAPONS.map((w, i) => [w.id, levels[i]]).filter(([, l]) => l > 0)),
    equippedIds: equipped.map((i) => WEAPONS[i].id),
  };
}

export function loadSave() {
  const s = freshSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return s;
    const d = JSON.parse(raw);
    if (!d || ![1, 2, 3, 4, 5, 6].includes(d.v)) return s;
    let byId, equippedIds;
    if (d.v >= 4) {
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
    for (const key of ['money', 'level', 'maxLevel', 'muted', 'hinted', 'sky', 'kills', 'mode']) if (key in d) s[key] = d[key];
    if (d.v < 5) { s.level = fromV4Level(s.level); s.maxLevel = fromV4Level(s.maxLevel); }
    weaponsFrom(s, byId, equippedIds);
    const c = d.campaign;
    if (c) {
      for (const key of ['money', 'level', 'maxLevel', 'stars', 'seen']) if (key in c) s.campaign[key] = c[key];
      weaponsFrom(s.campaign, c.weapons || {}, c.equippedIds || []);
    }
    const l = d.lab;
    if (l) {
      for (const key of ['kind', 'size', 'count', 'pop', 'auto', 'speed']) if (key in l) s.lab[key] = l[key];
      weaponsFrom(s.lab, { ...Object.fromEntries(WEAPONS.map((w) => [w.id, 1])), ...l.weapons }, l.equippedIds || []);
    }
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
  const out = { ...weaponsTo(s), v: 6, campaign: weaponsTo(s.campaign), lab: weaponsTo(s.lab) };
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* storage unavailable */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
