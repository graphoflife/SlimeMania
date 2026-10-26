// Quick sanity probe: how long does a slime need to reach the bottom, how fast does the sim run,
// and what DPS/HP ratio does the machine gun need to clear a wave.
import { World, WAVE } from '../js/world.js';
import { WEAPONS, buildStats } from '../js/weapons.js';
import { RNG } from '../js/rng.js';
import { botUpdate } from '../js/bot.js';
import { LOSE_Y } from '../js/config.js';

// 1) descent time without shooting
{
  const times = [];
  for (let seed = 1; seed <= 20; seed++) {
    const w = new World(new RNG(seed), { events: false });
    w.loadLevel(1, 1e12);
    w.setLoadout([]);
    let t = 0;
    while (!w.lost && t < 200) { w.update(1 / 60); t += 1 / 60; }
    times.push(t - WAVE[0].t);
  }
  times.sort((a, b) => a - b);
  console.log('first slime reaches bottom after', times.map((t) => t.toFixed(1)).join(' '));
  console.log('wave spawn duration', WAVE[WAVE.length - 1].t.toFixed(1), 's, LOSE_Y', LOSE_Y);
}

// 2) speed + threshold for one weapon
const id = process.argv[2] || 'mg';
const level = +(process.argv[3] || 31);
const def = WEAPONS.find((w) => w.id === id);
function run(rho, seed) {
  const w = new World(new RNG(seed), { events: false });
  w.loadLevel(1, 1000);
  w.setLoadout([buildStats(def, level, rho * 1000)]);
  const bot = {};
  const dt = 1 / 60;
  for (let t = 0; t < 150; t += dt) {
    botUpdate(w, bot, dt);
    w.update(dt);
    if (w.lost) return { ok: false, t, eff: w.dealt / (rho * 1000 * t) };
    if (w.waveState === 'inter') return { ok: true, t, eff: w.dealt / (rho * 1000 * t) };
  }
  return { ok: false, t: 150 };
}
const t0 = Date.now();
for (const rho of [1, 1.5, 2, 2.5, 3, 4, 5, 6]) {
  const rs = [1, 2, 3, 4, 5, 6].map((s) => run(rho, s));
  console.log(`rho ${rho}: ok ${rs.filter((r) => r.ok).length}/6  t ${rs.map((r) => r.t.toFixed(0)).join(',')}  eff ${rs.map((r) => (r.eff ?? 0).toFixed(2)).join(',')}`);
}
console.log('elapsed', Date.now() - t0, 'ms');
