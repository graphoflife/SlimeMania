// Economy pacing model. Income is roughly LAMBDA * effective DPS (measured by balance.mjs).
// 1) Construct the weapon prices so that weapon k gets unlocked at the target time
//    (5 minutes after the previous one at the start, 10 minutes for the last one).
// 2) Fit the smooth price formula of economy.js to that and print it.
// 3) Re-simulate with the fitted formula and print the resulting timeline.
//
//   node tools/pacing.mjs
import { ECON, effDps, upgradeCost, slimeHp, weaponPrice } from '../js/economy.js';
import { WEAPONS } from '../js/weapons.js';

const LAMBDA = 0.55;      // income per effective DPS when playing near your best level
const HUMAN_RHO = 1.6;    // DPS / big-slime-HP a human needs to clear a level (autopilot: 1.39)
const SAVE_S = 60;        // the player saves up to a minute of income for the next weapon
const NW = WEAPONS.length;

const gapMin = (k) => 5 + (5 * (k - 1)) / (NW - 2); // minutes between weapon k-1 and k
const targets = [0];
for (let k = 1; k < NW; k++) targets.push(targets[k - 1] + gapMin(k) * 60);

function bestLevel(p) {
  let L = 1;
  while (p >= HUMAN_RHO * slimeHp(L + 1)) L++;
  return p >= HUMAN_RHO * slimeHp(1) ? L : 0;
}

function simulate(priceOf, { construct = false, log = false } = {}) {
  const lv = [1];
  let equipped = [0];
  let owned = 1;
  let money = 0;
  const prices = [0];
  const buyTimes = [0];
  const dt = 1;
  let t = 0;
  const power = () => equipped.reduce((s, i) => s + effDps(lv[i]) * WEAPONS[i].quality, 0);
  while (owned < NW && t < 8 * 3600) {
    const inc = LAMBDA * power();
    money += inc * dt;
    t += dt;
    let saving = false;
    let buy = false;
    if (construct) {
      if (t >= targets[owned] - SAVE_S) saving = true;
      if (t >= targets[owned]) { prices.push(money); buy = true; }
    } else {
      const price = priceOf(owned);
      if (price <= money + inc * SAVE_S) saving = true;
      if (money >= price) { money -= price; buy = true; }
    }
    if (buy) {
      if (construct) money = 0;
      lv.push(1);
      const k = owned++;
      buyTimes.push(t);
      if (equipped.length < 3) equipped.push(k);
      else {
        let worst = 0;
        for (let j = 1; j < 3; j++) if (WEAPONS[equipped[j]].quality * effDps(lv[equipped[j]]) < WEAPONS[equipped[worst]].quality * effDps(lv[equipped[worst]])) worst = j;
        // the dollar bills are a joke: nobody keeps them equipped
        if (WEAPONS[k].quality >= 1) equipped[worst] = k;
      }
      saving = false;
    }
    if (!saving) {
      for (;;) {
        let ci = equipped[0];
        for (const i of equipped) if (lv[i] < lv[ci]) ci = i;
        const c = upgradeCost(lv[ci]);
        if (c > money) break;
        money -= c;
        lv[ci]++;
      }
    }
    if (log && (t % 600 === 0 || buy)) {
      const p = power();
      console.log(`${(t / 60).toFixed(1).padStart(6)} min  weapons ${String(owned).padStart(2)}  levels ${equipped.map((i) => lv[i]).join('/')}  dps ${p.toExponential(2)}  best slime level ${bestLevel(p)}${buy ? '  <- bought ' + WEAPONS[owned - 1].name : ''}`);
    }
  }
  return { prices, buyTimes };
}

// 1) construct
const { prices } = simulate(null, { construct: true });
// 2) fit ln(price_k) = a + b*j + c*j*(j-1)/2 with j = k-1 (least squares)
const rows = [];
for (let k = 1; k < NW; k++) { const j = k - 1; rows.push([1, j, (j * (j - 1)) / 2, Math.log(prices[k])]); }
const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0];
for (const r of rows) for (let i = 0; i < 3; i++) { B[i] += r[i] * r[3]; for (let j = 0; j < 3; j++) A[i][j] += r[i] * r[j]; }
// solve 3x3
function solve(M, v) {
  const m = M.map((r, i) => [...r, v[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    [m[i], m[p]] = [m[p], m[i]];
    for (let r = 0; r < 3; r++) if (r !== i) { const f = m[r][i] / m[i][i]; for (let c = i; c < 4; c++) m[r][c] -= f * m[i][c]; }
  }
  return m.map((r, i) => r[3] / r[i]);
}
const [a, b, c] = solve(A, B);
ECON.P1 = Math.round(Math.exp(a));
ECON.PG0 = +Math.exp(b).toFixed(4);
ECON.PG1 = +c.toFixed(5);
console.log(`constructed prices: ${prices.slice(1, 6).map((p) => p.toExponential(2)).join(', ')} ... ${prices[NW - 1].toExponential(2)}`);
console.log(`fit:  P1: ${ECON.P1}, PG0: ${ECON.PG0}, PG1: ${ECON.PG1}`);

// 3) verify with the formula
console.log('\ntimeline with fitted prices:');
const res = simulate(weaponPrice, { log: true });
console.log('\ngaps (min):', res.buyTimes.slice(1).map((t, i) => ((t - res.buyTimes[i]) / 60).toFixed(1)).join(' '));
