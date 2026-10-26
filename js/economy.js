// All the exponential curves of the game live here.
// Calibrated with tools/balance.mjs (weapon power) and tools/pacing.mjs (prices).
export const ECON = {
  D0: 42,              // effective DPS of a level-1 weapon
  DPS_GROWTH: 1.05,    // +5% DPS per weapon level
  RATE_LEVELS: 30,     // the first 30 upgrades also shorten the pulse interval ...
  RATE_MIN: 0.5,       // ... down to 50% of the base interval
  H1: 18,              // big slime HP on level 1 (medium = 1/3, small = 1/9)
  HP_GROWTH: 2,        // slime HP multiplier per level
  C0: 140,             // cost of the first upgrade (level 1 -> 2)
  COST_GROWTH: 1.0507, // upgrade cost multiplier per level (a bit faster than DPS)
  P1: 12023,           // price of weapon #2 (fitted by tools/pacing.mjs)
  PG0: 5.8535,         // price ratio between consecutive weapons ...
  PG1: 0.00538,        // ... whose log grows by this per weapon (5 min early, ~10 min late)
};

export const effDps = (lvl) => ECON.D0 * ECON.DPS_GROWTH ** (lvl - 1);

// Multiplier on pulse interval & pulse length (1 at level 1, RATE_MIN from level 31 on).
export const rateFactor = (lvl) =>
  ECON.RATE_MIN ** (Math.min(lvl - 1, ECON.RATE_LEVELS) / ECON.RATE_LEVELS);

export const slimeHp = (level) => ECON.H1 * ECON.HP_GROWTH ** (level - 1);

// Round to 3 significant digits so prices look tidy.
export function nice(x) {
  if (x < 100) return Math.ceil(x);
  const p = 10 ** (Math.floor(Math.log10(x)) - 2);
  return Math.ceil(x / p) * p;
}

// Cost to go from `lvl` to `lvl + 1`.
export const upgradeCost = (lvl) => nice(ECON.C0 * ECON.COST_GROWTH ** (lvl - 1));

// Price of weapon with index k (k = 0 is the free starter weapon).
export function weaponPrice(k) {
  if (k <= 0) return 0;
  const j = k - 1;
  const lnRatio = Math.log(ECON.PG0) * j + ECON.PG1 * j * (j - 1) / 2;
  return nice(ECON.P1 * Math.exp(lnRatio));
}
