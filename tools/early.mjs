// Checks the early game: can the starting machine gun clear level 1 / 2 at a given weapon level?
// A sloppier autopilot (more aim noise) stands in for a human.
import { World } from '../js/world.js';
import { WEAPONS, buildStats } from '../js/weapons.js';
import { slimeHp } from '../js/economy.js';
import { RNG } from '../js/rng.js';
import { botUpdate } from '../js/bot.js';

function trial(level, wlvl, seed, aimNoise) {
  const w = new World(new RNG(seed), { events: false });
  w.loadLevel(level, slimeHp(level));
  w.setLoadout([buildStats(WEAPONS[0], wlvl)]);
  const bot = { aimNoise };
  for (let t = 0; t < 160; t += 1 / 60) {
    botUpdate(w, bot, 1 / 60);
    w.update(1 / 60);
    if (w.lost) return false;
    if (w.waveState === 'inter') return true;
  }
  return false;
}
for (const aim of [4, 14, 24]) {
  const row = [];
  for (const [L, wl] of [[1, 1], [2, 1], [2, 3], [2, 5], [2, 8], [3, 15], [3, 20]]) {
    let ok = 0;
    for (let s = 1; s <= 20; s++) if (trial(L, wl, s, aim)) ok++;
    row.push(`L${L}/w${wl}: ${ok * 5}%`);
  }
  console.log(`aim noise ${aim}px  ` + row.join('  '));
}
