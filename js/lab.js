// Test lab: every weapon at any level and every slime kind on demand, to try them out and design
// new ones. Slimes come only when asked for and splat harmlessly at the bottom. The lab's picks
// are kept in the save (`lab`); Zen and the campaign are not touched.
import { W, SLIME_R, BOSS, MAX_EQUIPPED } from './config.js';
import { KINDS, KIND_LIST } from './kinds.js';
import { WEAPONS, buildStats, balance } from './weapons.js';
import { ECON } from './economy.js';
import { BOSS_HP, levelKinds } from './campaign.js';
import { slimeBody, slimeFace, makeCanvas, blit } from './sprites.js';
import { bubbleSprite, warmKinds } from './kind-art.js';
import { iconCanvas } from './ui.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const MAX_LEVEL = ECON.RATE_LEVELS + 1; // from here on upgrades only add damage (and HP follows it)
const DPS = 100;                        // every weapon deals the same (balanced) DPS here
const POP = [0.5, 2, 5, 15];            // big slime HP: seconds the equipped weapons take to pop one
const COUNTS = [1, 3, 5, 10];
const SPEEDS = [0.25, 0.5, 1];
const SIZES = ['BIG', 'MED', 'SMALL'];
const BATCH_GAP = 0.35; // the slimes of one spawn come one after another, this far apart (s)
const AUTO_GAP = 1.5;   // AUTO: checks this often whether to send more...
const AUTO_HP = 3;      // ...and does while the field holds less than this many big slimes' HP
const MAX_SLIMES = 60;
const RARITY = { common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', veryRare: 'VERY RARE', boss: 'BOSS' };
// in the order the campaign brings them, bosses last
const ORDER = [...KIND_LIST].sort((a, b) => !!a.boss - !!b.boss || a.from - b.from);

// HP of one slime of a kind, in big slimes (as the campaign has it)
const hpOf = (k, size) => (k.boss ? BOSS_HP[0] * (k.hp ?? 1) : k.swarm ? k.hp : (k.hp ?? 1) / 3 ** size);

// A small slime of the kind, as it looks on the field (plain ones in green).
function kindIcon(k) {
  const c = makeCanvas(38, 34), g = c.getContext('2d');
  const color = k.rainbow?.[0] ?? k.colors?.[k.boss ? 0 : 2] ?? '#9dff1a';
  if (k.ghost) g.globalAlpha = 0.6;
  blit(g, slimeBody(color, 2, 2, false, k.aspect ?? 1), 19, 17);
  blit(g, slimeFace(2, k.sleepy ? 'blink' : k.rage ? 'angry' : 'normal'), 19, 17);
  g.globalAlpha = 1;
  if (k.shield) blit(g, bubbleSprite(2), 19, 17);
  return c;
}

// What sets a kind apart, in numbers.
function traits(k) {
  const t = [`HP X${+hpOf(k, 0).toFixed(2)}`];
  if ((k.speed ?? 1) !== 1) t.push(`SPEED X${k.speed}`);
  if (k.value) t.push(`COINS X${k.value}`);
  if (k.children) t.push(`POPS INTO ${k.children}`);
  const h = k.hearts ?? 1;
  t.push(h === 1 ? '1 HEART' : `${h} HEARTS`);
  return t.join(' · ');
}

export class Lab {
  constructor(game) {
    this.game = game;
    this.el = $('lab');
    this.batch = 0;  // slimes of the last spawn still to come
    this.batchT = 0;
    this.autoT = 0;
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) game.closeShop(); });
    for (const b of this.el.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { sfx('click'); this.showTab(b.dataset.tab); });
    for (const b of this.el.querySelectorAll('[data-lab]')) b.addEventListener('click', () => this.action(b.dataset.lab));
    this.segs = [
      this.seg('labSize', SIZES.map((t, i) => [t, i]), 'size'),
      this.seg('labCount', COUNTS.map((n) => [String(n), n]), 'count'),
      this.seg('labAuto', [['OFF', false], ['ON', true]], 'auto'),
      this.seg('labPop', POP.map((t) => [t + 'S', t]), 'pop'),
      this.seg('labSpeed', SPEEDS.map((v) => [v === 1 ? '1X' : `1/${1 / v}`, v]), 'speed'),
    ];
    this.buildKinds();
    this.buildWeapons();
    this.showTab('slimes');
    $('btnLabPanel').addEventListener('click', () => { sfx('click'); game.openShop(); });
    $('btnSpawn').addEventListener('click', () => { sfx('click'); this.spawn(this.p.count); });
  }

  get p() { return this.game.state.lab; }
  get kind() { return KINDS[this.p.kind] ?? KINDS.blob; }
  get speed() { return this.p.speed; }
  // A weapon's stats at its lab level. Every weapon deals the same DPS, so they compare fairly
  // whatever their place in the shop.
  stats(i) {
    const def = WEAPONS[i], lvl = this.p.levels[i];
    return buildStats(def, lvl, DPS * def.quality * balance(def.id, lvl));
  }
  // big slime HP for these weapons
  bigHp(stats) { return this.p.pop * stats.reduce((a, s) => a + s.dps, 0); }

  // ---------------------------------------------------------------- play
  begin() {
    this.game.world.loadLab(1); // the HP follows from the weapons (applyLoadout)
    this.batch = 0;
    this.autoT = 0;
    this.warm();
  }

  // one world step
  step(dt) {
    if (this.batch > 0 && (this.batchT -= dt) <= 0) {
      this.batch--;
      this.batchT = BATCH_GAP;
      this.spawnOne();
    }
    if (this.p.auto && (this.autoT -= dt) <= 0) {
      this.autoT = AUTO_GAP;
      const w = this.game.world;
      let hp = 0;
      for (const s of w.slimes) hp += s.hp;
      if (!this.batch && hp < AUTO_HP * w.bigHp) this.spawn(this.p.count);
    }
  }

  spawn(n) {
    if (!this.batch) this.batchT = 0;
    this.batch = Math.min(30, this.batch + n);
  }

  spawnOne() {
    const w = this.game.world, k = this.kind, size = k.boss ? BOSS : k.swarm ? 2 : this.p.size;
    if (w.slimes.length >= MAX_SLIMES) return;
    const r = SLIME_R[k.swarm ? 0 : size]; // a swarm spreads around its middle
    const x = k.boss ? W / 2 : r + 2 + Math.random() * (W - 2 * r - 4);
    w.spawnFromScript({ x, kind: k.id, size, hp: hpOf(k, size), type: Math.random() < 0.5 ? 0 : 1 });
  }

  // everything on the field bursts (no money)
  clear() {
    const w = this.game.world;
    for (const s of w.slimes) this.game.renderer.burst(s.x, s.y, s.r, s.size, s.type, s.kind);
    w.slimes.length = 0;
    w.pending.length = 0;
    w.goo.length = 0;
    w.boss = null;
    this.batch = 0;
  }

  select(k) {
    this.p.kind = k.id;
    this.warm();
    this.refresh();
  }

  // the HUD arrows go through the kinds
  cycle(d) {
    const i = ORDER.indexOf(this.kind);
    this.select(ORDER[(i + d + ORDER.length) % ORDER.length]);
  }

  // sprites of the kind and of what it pops into, calls for or sheds
  warm() {
    this.game.queueWarm('kinds', warmKinds(levelKinds({ script: [{ kind: this.kind.id }] })));
  }

  setLevel(i, lvl) {
    const p = this.p, l = Math.max(1, Math.min(MAX_LEVEL, lvl));
    if (l === p.levels[i]) return false;
    p.levels[i] = l;
    this.game.ui.upgraded();
    if (p.equipped.includes(i)) this.game.applyLoadout();
    this.refreshWeapon(this.rows[i]);
    return true;
  }

  // ---------------------------------------------------------------- HUD
  updateHud() {
    $('lvText').textContent = this.kind.name;
    $('lvPrev').disabled = $('lvNext').disabled = false;
    $('lvNext').classList.remove('glow');
  }

  // the line under the kind's name
  get sub() {
    const k = this.kind, p = this.p;
    return `${k.boss ? 'BOSS' : k.swarm ? 'SWARM' : SIZES[p.size]} X${p.count}${p.auto ? ' · AUTO' : ''}`;
  }

  // ---------------------------------------------------------------- panel
  get isOpen() { return !this.el.classList.contains('hidden'); }
  open() { this.el.classList.remove('hidden'); this.refresh(); }
  close() { this.el.classList.add('hidden'); }

  action(a) {
    sfx('click');
    if (a === 'menu') { this.game.toMenu(); return; }
    if (a === 'clear') this.clear();
    this.game.closeShop();
    if (a === 'spawn') this.spawn(this.p.count);
  }

  showTab(tab) {
    for (const b of this.el.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const el of this.el.querySelectorAll('[data-page]')) el.classList.toggle('hidden', el.dataset.page !== tab);
  }

  // a row of buttons that sets p[key] to one of the values
  seg(id, options, key) {
    const box = $(id);
    const btns = options.map(([text, v]) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', () => {
        sfx('click');
        this.p[key] = v;
        if (key === 'pop') this.game.applyLoadout(); // the HP follows
        if (key === 'auto') this.autoT = 0;
        this.refresh();
      });
      box.appendChild(b);
      return [b, v];
    });
    return { key, btns };
  }

  buildKinds() {
    const box = $('labKinds');
    this.tiles = ORDER.map((k) => {
      const el = document.createElement('button');
      el.className = 'ktile';
      el.appendChild(kindIcon(k));
      el.insertAdjacentHTML('beforeend', `<span>${k.name.replace(/ SLIME$/, '')}</span>`);
      el.addEventListener('click', () => { sfx('click'); this.select(k); });
      box.appendChild(el);
      return { el, k };
    });
  }

  buildWeapons() {
    const box = $('labWeapons');
    this.rows = WEAPONS.map((def, i) => {
      const el = document.createElement('div');
      el.className = 'card owned';
      el.innerHTML = `
        <div class="icon-box"></div>
        <div class="info">
          <div class="wname"><span class="nm">${def.name}</span><span class="eq">ON</span></div>
          <div class="wstat"></div>
        </div>
        <div class="lab-lv"><button class="lvb" aria-label="Lower level">-</button><span class="lv"></span><button class="lvb" aria-label="Higher level">+</button></div>`;
      el.querySelector('.icon-box').appendChild(iconCanvas(def));
      // the card equips; its level buttons do not (hold them to go faster)
      el.addEventListener('click', () => this.game.toggleEquip(i));
      el.querySelectorAll('.lvb').forEach((b, k) => {
        b.addEventListener('click', (e) => e.stopPropagation());
        this.game.ui.bindHold(b, () => this.setLevel(i, this.p.levels[i] + (k ? 1 : -1)));
      });
      box.appendChild(el);
      return { el, i, stat: el.querySelector('.wstat'), lv: el.querySelector('.lv') };
    });
  }

  refresh() {
    const p = this.p, k = this.kind;
    for (const s of this.segs) for (const [b, v] of s.btns) b.classList.toggle('on', p[s.key] === v);
    for (const [b] of this.segs[0].btns) b.disabled = !!(k.boss || k.swarm); // they have their own size
    $('labName').textContent = k.name;
    $('labMeta').textContent = k.boss ? `BOSS · LV ${k.from}` : `${RARITY[k.rarity]} · LV ${k.from}`;
    $('labTip').textContent = k.tip || 'THE PLAIN SLIME';
    $('labStats').textContent = traits(k);
    for (const t of this.tiles) t.el.classList.toggle('on', t.k === k);
    $('labEq').textContent = `${p.equipped.length}/${MAX_EQUIPPED}`;
    for (const r of this.rows) this.refreshWeapon(r);
    this.game.ui.updateHud();
  }

  refreshWeapon(r) {
    const p = this.p, st = this.stats(r.i), hits = st.stages[0].hits;
    r.el.classList.toggle('equipped', p.equipped.includes(r.i));
    r.lv.textContent = 'LV ' + st.level;
    r.stat.textContent = `${st.count} PER ${st.interval.mean.toFixed(2)}S · ${hits} HIT${hits > 1 ? 'S' : ''}`;
  }
}
