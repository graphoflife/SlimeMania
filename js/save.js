// Progress is stored in localStorage.
import { WEAPONS } from './weapons.js';

const KEY = 'slimemania.save.v1';

export function freshSave() {
  return {
    v: 1,
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
    if (!d || d.v !== 1) return s;
    Object.assign(s, d);
    // tolerate added weapons in later versions
    while (s.levels.length < WEAPONS.length) s.levels.push(0);
    s.equipped = s.equipped.filter((i) => s.levels[i] > 0).slice(0, 3);
    if (!s.equipped.length) s.equipped = [0];
    if (!isFinite(s.money) || s.money < 0) s.money = 0;
  } catch { /* corrupted or blocked storage: start fresh */ }
  return s;
}

export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
