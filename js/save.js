// Progress is stored in localStorage.
import { WEAPONS } from './weapons.js';
import { weaponStart, effDps, slimeHp, levelCost } from './economy.js';

const KEY = 'slimemania.save.v1';

export function freshSave() {
  return {
    v: 2,
    money: 0,
    level: 1,       // level being played
    maxLevel: 1,    // highest unlocked level
    levels: WEAPONS.map((_, i) => (i === 0 ? 1 : 0)), // 0 = not owned yet
    equipped: [0],
    muted: false,
    hinted: false,
    kills: 0,
  };
}

export function loadSave() {
  const s = freshSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return s;
    const d = JSON.parse(raw);
    if (!d || (d.v !== 1 && d.v !== 2)) return s;
    // v1 levels were positions on the old per-weapon curve; v2 weapons enter the shared
    // ladder higher up, so keep at least the old DPS
    if (d.v === 1) {
      d.levels = d.levels.map((l, k) => (k === 0 || l <= 0 ? l : Math.max(1, l - weaponStart(k) + 1)));
      d.v = 2;
    }
    Object.assign(s, d);
    // tolerate added weapons in later versions
    while (s.levels.length < WEAPONS.length) s.levels.push(0);
    s.equipped = s.equipped.filter((i) => s.levels[i] > 0).slice(0, 3);
    if (!s.equipped.length) s.equipped = [0];
    if (!isFinite(s.money) || s.money < 0) s.money = 0;
  } catch { /* corrupted or blocked storage: start fresh */ }
  return s;
}

// Test save (?testall): every weapon owned and on the same rung of the cost ladder as the
// last weapon at level 30, so they all deal the same DPS (Dollar Bills still 30%).
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
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
