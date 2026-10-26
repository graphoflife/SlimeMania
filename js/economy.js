// All the exponential curves of the game live here.
// Calibrated with tools/balance.mjs (weapon power) and tools/pacing.mjs (weapon entry levels).
//
// Every weapon sits on one shared ladder of "effective levels". DPS and upgrade cost both
// depend only on the effective level, so two weapons whose next upgrade costs the same deal
// the same DPS. Buying weapon k costs exactly the price of its entry rung on the ladder and
// gives it level 1 there; its level 2 costs the next rung, and so on.
import { WEAPON_STARTS } from './ladder.js';

export const ECON = {
  D0: 42,              // DPS at effective level 1 (the starting machine gun)
  DPS_GROWTH: 1.05,    // +5% DPS per effective level
  RATE_LEVELS: 30,     // the first 30 upgrades of a weapon also shorten its pulse interval ...
  RATE_MIN: 0.5,       // ... down to 50% of the base interval
  H1: 18,              // big slime HP on level 1 (medium = 1/3, small = 1/9)
  HP_GROWTH: 2,        // slime HP multiplier per level
  C0: 140,             // price of effective level 2 (the machine gun's first upgrade)
  COST_GROWTH: 1.0507, // price multiplier per effective level (a bit faster than DPS)
};

export const effDps = (eff) => ECON.D0 * ECON.DPS_GROWTH ** (eff - 1);

// Multiplier on pulse interval & pulse length (1 at level 1, RATE_MIN from level 31 on).
// Uses the weapon's own level, not the effective one.
export const rateFactor = (lvl) =>
  ECON.RATE_MIN ** (Math.min(lvl - 1, ECON.RATE_LEVELS) / ECON.RATE_LEVELS);

export const slimeHp = (level) => ECON.H1 * ECON.HP_GROWTH ** (level - 1);

// Round to 3 significant digits so prices look tidy.
export function nice(x) {
  if (x < 100) return Math.ceil(x);
  const p = 10 ** (Math.floor(Math.log10(x)) - 2);
  return Math.ceil(x / p) * p;
}

// Price of one rung of the ladder: what it costs to reach effective level `eff`.
export const levelCost = (eff) => nice(ECON.C0 * ECON.COST_GROWTH ** (eff - 2));

// Effective level at which weapon k (k = 0 is the free starter weapon) enters the ladder.
// Spaced so the next weapon takes ~5 minutes early on and ~10 minutes at the end.
export const weaponStart = (k) => WEAPON_STARTS[k] ?? 1;

export const effLevel = (k, lvl) => weaponStart(k) + lvl - 1;

// Buying weapon k = paying for its level 1.
export const weaponPrice = (k) => (k <= 0 ? 0 : levelCost(weaponStart(k)));

// Cost to go from level `lvl` to `lvl + 1` on weapon k.
export const upgradeCost = (k, lvl) => levelCost(effLevel(k, lvl) + 1);
