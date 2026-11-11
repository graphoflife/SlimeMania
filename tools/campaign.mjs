// Campaign calibration: how strong may the slimes of every campaign level be?
//
// A model player goes through the levels in order. Before each level it has the weapons and
// upgrades bought from what the levels so far paid (bought greedily, like tools/pacing.mjs).
// For each level the autopilot measures the clear threshold: the least DPS per big-slime HP
// with which it clears the level losing at most one heart (2 seeds). The level's HP is then
//   HP = player's DPS / (threshold x MARGIN)
// MARGIN is the room a human gets on top of the autopilot: much at the start, less later.
// From world 2 on the model also replays a level now and then (REPLAY), which pays more and
// takes longer: later levels need some farming.
//
//   node tools/campaign.mjs [--write] [--levels N]
import { writeFileSync } from 'node:fs';
import { World } from '../js/world.js';
import { WEAPONS, buildStats } from '../js/weapons.js';
import { weaponPrice, upgradeCost, weaponStart } from '../js/economy.js';
import { RNG } from '../js/rng.js';
import { botUpdate } from '../js/bot.js';
import { campaignLevel, clearBonus } from '../js/campaign.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? +args[i + 1] : def; };
const WRITE = args.includes('--write');
const LEVELS = opt('--levels', 100);
const HP = 1000; // the fight does not depend on the scale: armour and all are fractions of HP
const DT = 1 / 60;
const MARGIN = (n) => 1.15 + 0.5 * Math.exp(-(n - 1) / 15);
const REPLAY = (n) => Math.min(1, Math.max(0, (n - 10) / 40)); // extra plays of a level

// One play of level n with the loadout (relative DPS shares) at power rho (DPS / big-slime HP).
function play(lv, defs, shares, rho, seed) {
  const script = lv.script;
  const w = new World(new RNG(seed * 7919 + lv.n), { events: true });
  w.loadLevel(lv.n, HP, script);
  w.setLoadout(defs.map(([def, lvl], i) => buildStats(def, lvl, shares[i] * rho * HP)));
  const bot = {};
  let hearts = 3, t = 0;
  while (t < 400) {
    botUpdate(w, bot, DT);
    w.update(DT);
    t += DT;
    for (const e of w.events) if (e.type === 'escape') hearts -= e.hearts;
    const clear = w.events.some((e) => e.type === 'levelClear');
    w.events.length = 0;
    if (hearts < 2) return { ok: false, t, earned: w.earned };
    if (clear) return { ok: true, t, earned: w.earned };
  }
  return { ok: false, t, earned: w.earned };
}

// least power (DPS / big-slime HP) that clears level n with at most one heart lost
function threshold(lv, defs, shares) {
  let lo = 0.1, hi = 30;
  for (let it = 0; it < 10; it++) {
    const mid = Math.sqrt(lo * hi);
    if ([1, 2].every((s) => play(lv, defs, shares, mid, s).ok)) hi = mid; else lo = mid;
  }
  return hi;
}

// ---------------------------------------------------------------- the model player
const levels = WEAPONS.map((_, i) => (i === 0 ? 1 : 0));
let equipped = [0], money = 0, time = 0;
const stats = (i) => buildStats(WEAPONS[i], levels[i]);
const power = () => equipped.reduce((s, i) => s + stats(i).dps, 0);
const eff = (i) => weaponStart(i) + levels[i] - 1;

// spend like a player: the next weapon as soon as it is affordable (saving up for it when one
// more level would pay for it), otherwise upgrade the weakest equipped weapon
function spend(nextIncome) {
  for (;;) {
    const k = levels.indexOf(0);
    if (k > 0 && money >= weaponPrice(k)) {
      money -= weaponPrice(k);
      levels[k] = 1;
      equipped.push(k);
      if (equipped.length > 3) equipped = equipped.sort((a, b) => stats(b).dps - stats(a).dps).slice(0, 3);
      continue;
    }
    if (k > 0 && weaponPrice(k) <= money + nextIncome) return; // saving up
    let ci = equipped[0];
    for (const i of equipped) if (eff(i) < eff(ci)) ci = i;
    const c = upgradeCost(ci, levels[ci]);
    if (c > money) return;
    money -= c;
    levels[ci]++;
  }
}

const table = [];
const t0 = Date.now();
console.log(' lvl   min  weapons  equipped (level)            DPS       rho*  margin   big HP   secs  kinds');
for (let n = 1; n <= LEVELS; n++) {
  const lv = campaignLevel(n);
  const defs = equipped.map((i) => [WEAPONS[i], levels[i]]);
  const dps = equipped.map((i) => stats(i).dps), p = dps.reduce((a, b) => a + b, 0);
  const shares = dps.map((d) => d / p);
  const rho = threshold(lv, defs, shares);
  const hp = +(p / (rho * MARGIN(n))).toPrecision(3);
  table.push(hp);
  // play it at that strength: pops plus the clear bonus (3 stars), replays on top
  const r = play(lv, defs, shares, p / hp, 3);
  const lvAt = { ...lv, value: (lv.value / lv.hp) * hp };
  const income = (r.earned / HP) * hp + clearBonus(lvAt, 3);
  const plays = 1 + REPLAY(n);
  money += income * plays;
  time += r.t * plays;
  spend(income);
  if (n <= 12 || n % 5 === 0) {
    const kinds = [...new Set(lv.script.map((e) => e.kind))].join(',');
    console.log(`${String(n).padStart(4)} ${(time / 60).toFixed(1).padStart(5)}  ${String(levels.filter((l) => l > 0).length).padStart(7)}  ${equipped.map((i) => `${WEAPONS[i].id}(${levels[i]})`).join(' ').padEnd(26)} ${p.toExponential(2).padStart(9)} ${rho.toFixed(2).padStart(6)} ${MARGIN(n).toFixed(2).padStart(7)} ${hp.toExponential(2).padStart(9)} ${r.t.toFixed(0).padStart(5)}  ${kinds}`);
  }
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s; HP growth per level, world by world:`,
  Array.from({ length: Math.floor(LEVELS / 10) }, (_, w) => (table[w * 10 + 9] / table[w * 10]) ** (1 / 9)).map((g) => g.toFixed(2)).join(' '));
if (WRITE) {
  writeFileSync(new URL('../js/campaign-table.js', import.meta.url), `// Generated by tools/campaign.mjs --write. Do not edit by hand.
// HP of a big slime on campaign level 1, 2, 3, ...
export const CAMPAIGN_HP = ${JSON.stringify(table)};
`);
  console.log('wrote js/campaign-table.js');
}
