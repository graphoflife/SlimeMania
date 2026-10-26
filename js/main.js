// Boots the game: main loop, input, level flow and the economy actions used by the UI.
import { W, GUN_MIN_X, GUN_MAX_X, MAX_EQUIPPED, MAX_EXTRA, BOTTOM_BAR } from './config.js';
import { World } from './world.js';
import { RNG } from './rng.js';
import { WEAPONS, buildStats } from './weapons.js';
import { slimeHp, upgradeCost, weaponPrice } from './economy.js';
import { Renderer, randomSlimeColors } from './render.js';
import { UI } from './ui.js';
import { loadSave, writeSave, clearSave, freshSave, testAllSave } from './save.js';
import { initAudio, sfx, setMuted, suspendAudio, resumeAudio } from './audio.js';
import { botUpdate } from './bot.js';
import { fmt } from './format.js';
import { warmJobs } from './sprites.js';

const STEP = 1 / 60;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

class Game {
  constructor() {
    this.canvas = document.getElementById('screen');
    this.root = document.getElementById('game');
    this.renderer = new Renderer(this.canvas);
    this.world = new World(new RNG());
    const params = new URLSearchParams(location.search);
    if (params.has('testall')) {
      // build the test save once, then drop the parameter so a reload keeps playing it
      writeSave(testAllSave());
      params.delete('testall');
      history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
    }
    this.state = loadSave();
    this.mode = 'title';
    this.bot = { aimNoise: 6 };
    this.autoplay = params.has('autoplay'); // for testing
    this.keys = { left: false, right: false };
    this.drag = null;
    this.loseT = 0;
    this.acc = 0;
    this.last = 0;
    this.saveT = 0;
    this.hudT = 0;
    this.ui = new UI(this);
    this.warm = warmJobs();
    setMuted(this.state.muted);
    if (this.state.maxLevel > 1 || this.state.money > 0) {
      document.getElementById('tapText').textContent = `TAP TO CONTINUE - LEVEL ${this.state.level}`;
    }

    // title screen demo: the autopilot plays level 1
    this.world.loadLevel(1, slimeHp(1));
    this.world.setLoadout([buildStats(WEAPONS[0], 31)]);

    this.fit();
    addEventListener('resize', () => this.fit());
    window.visualViewport?.addEventListener('resize', () => this.fit());
    this.bindInput();
    document.getElementById('title').addEventListener('pointerup', () => this.start(), { once: true });
    // iOS only unlocks audio on certain gestures; any of these will do
    for (const ev of ['touchend', 'click', 'keydown']) addEventListener(ev, () => initAudio(), { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { writeSave(this.state); suspendAudio(); } else resumeAudio();
    });
    addEventListener('pagehide', () => writeSave(this.state));
    requestAnimationFrame((t) => this.loop(t));
  }

  fit() {
    const vw = window.visualViewport?.width ?? innerWidth;
    const vh = window.visualViewport?.height ?? innerHeight;
    const base = 384 + BOTTOM_BAR;
    const u = Math.min(vw / 216, vh / base);
    const extra = clamp(Math.floor(vh / u - base), 0, MAX_EXTRA);
    document.documentElement.style.setProperty('--u', u + 'px');
    document.documentElement.style.setProperty('--gh', base + extra);
    this.renderer.setExtra(extra);
  }

  toGameX(clientX) {
    const r = this.canvas.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * W;
  }

  bindInput() {
    const el = this.root;
    const playing = () => this.mode === 'play' && !this.ui.shopOpen;
    el.addEventListener('pointerdown', (e) => {
      if (!playing() || e.target.closest('button, #hud')) return;
      this.drag = { id: e.pointerId };
      this.world.gun.targetX = this.toGameX(e.clientX); // the gun goes where you press
      this.moved();
    });
    el.addEventListener('pointermove', (e) => {
      if (!playing()) return;
      // the gun follows the mouse, or the finger while it is down
      if (e.pointerType === 'mouse' || (this.drag && this.drag.id === e.pointerId)) {
        this.world.gun.targetX = this.toGameX(e.clientX);
        this.moved();
      }
    });
    const end = (e) => { if (this.drag && this.drag.id === e.pointerId) this.drag = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    const key = (e, down) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') this.keys.left = down;
      else if (k === 'arrowright' || k === 'd') this.keys.right = down;
      else if (down && (k === 'e' || k === 'tab') && this.mode === 'play') {
        e.preventDefault();
        this.ui.shopOpen ? this.closeShop() : this.openShop();
      } else if (down && k === 'escape' && this.ui.shopOpen) this.closeShop();
      else return;
      if (down && (k.startsWith('arrow') || k === 'a' || k === 'd')) this.moved();
    };
    addEventListener('keydown', (e) => key(e, true));
    addEventListener('keyup', (e) => key(e, false));
  }

  moved() {
    if (!this.state.hinted) {
      this.state.hinted = true;
      document.getElementById('hint').classList.add('hidden');
    }
  }

  // ---------------------------------------------------------------- flow
  // Fullscreen (and portrait lock where the browser allows it).
  toggleFullscreen(on = !document.fullscreenElement) {
    const el = document.documentElement;
    if (on && !document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation?.lock?.('portrait').catch(() => {}))
        .catch(() => {});
    } else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  start() {
    initAudio();
    sfx('click');
    if (matchMedia('(pointer: coarse)').matches) this.toggleFullscreen(true); // phones and tablets
    this.mode = 'play';
    document.getElementById('title').classList.add('hidden');
    this.ui.showHud(true);
    this.startLevel(this.state.level);
    if (!this.state.hinted) {
      const hint = document.getElementById('hint');
      hint.textContent = matchMedia('(pointer: coarse)').matches ? '< DRAG TO MOVE >' : '< MOUSE OR ARROW KEYS >';
      hint.classList.remove('hidden');
    }
  }

  startLevel(L) {
    const s = this.state;
    s.level = clamp(L, 1, s.maxLevel);
    this.loseT = 0;
    this.renderer.colors = randomSlimeColors();
    this.renderer.reset();
    this.world.loadLevel(s.level, slimeHp(s.level));
    this.applyLoadout();
    this.world.events.length = 0;
    this.ui.updateHud();
    this.ui.showBanner(`LEVEL ${s.level}`, `SLIME HP ${fmt(slimeHp(s.level))}`, '#ffffff', 1.8);
  }

  setLevel(L) {
    if (L < 1 || L > this.state.maxLevel || L === this.state.level) return;
    this.startLevel(L);
    writeSave(this.state);
  }

  applyLoadout() {
    const s = this.state;
    this.world.setLoadout(s.equipped.map((i) => buildStats(WEAPONS[i], s.levels[i])));
  }

  handleEvents() {
    const evs = this.world.events;
    const play = this.mode === 'play';
    for (const e of evs) {
      this.renderer.onEvent(e);
      if (!play) continue;
      switch (e.type) {
        case 'hit': sfx('hit'); break;
        case 'pop':
          this.state.money += e.value;
          this.state.kills++;
          this.ui.addGain(e.value, e.size === 0);
          sfx('pop' + e.size);
          if (e.size === 0) this.ui.bumpMoney();
          break;
        case 'waveStart': if (e.n > 1) this.ui.showBanner(`WAVE ${e.n}`, '', '#ffffff', 1.2, true); break;
        case 'waveClear': this.onWaveClear(e); break;
        case 'lose': this.onLose(); break;
      }
    }
    evs.length = 0;
  }

  onWaveClear(e) {
    const s = this.state;
    if (e.level === s.maxLevel) {
      s.maxLevel++;
      sfx('unlock');
      this.ui.showBanner(`LEVEL ${s.maxLevel} UNLOCKED!`, 'TAP > TO GO ON, OR KEEP FARMING', '#7dff3a', 2.8);
      writeSave(s);
    } else {
      sfx('waveClear');
      this.ui.showBanner('WAVE CLEARED!', '', '#ffe23a', 1.4, true);
    }
    this.ui.updateHud();
  }

  onLose() {
    if (this.mode !== 'play') return;
    sfx('lose');
    this.ui.showBanner('LEVEL FAILED', 'UPGRADE AND TRY AGAIN!', '#ff3a7c', 2.2);
    this.loseT = 2.2;
    // everything on screen bursts (no money for these)
    for (const s of this.world.slimes) this.renderer.burst(s.x, s.y, s.r, s.size, s.type);
    this.world.slimes.length = 0;
    this.world.projs.length = 0;
    writeSave(this.state);
  }

  // ---------------------------------------------------------------- shop actions
  openShop() {
    if (this.mode !== 'play') return;
    this.drag = null;
    this.ui.openShop();
  }

  closeShop() {
    this.ui.closeShop();
    writeSave(this.state);
  }

  upgrade(i, turbo) {
    const s = this.state;
    const cost = upgradeCost(i, s.levels[i]);
    if (s.money < cost) { if (!turbo) sfx('deny'); return false; }
    s.money -= cost;
    s.levels[i]++;
    this.ui.upgraded();
    if (s.equipped.includes(i)) this.applyLoadout();
    this.ui.refreshCard(i);
    return true;
  }

  buyWeapon(i) {
    const s = this.state;
    const price = weaponPrice(i);
    if (s.levels[i] > 0 || s.money < price) { sfx('deny'); return; }
    s.money -= price;
    s.levels[i] = 1;
    this.equip(i);
    sfx('buy');
    this.applyLoadout();
    this.ui.refreshShop();
    this.ui.showBanner('NEW WEAPON!', WEAPONS[i].name.toUpperCase(), '#3ad7ff', 1.8);
    writeSave(s);
  }

  // Equipping always works: with 3 already equipped, the one equipped longest ago goes.
  equip(i) {
    const s = this.state;
    if (s.equipped.includes(i)) return;
    s.equipped.push(i);
    if (s.equipped.length > MAX_EQUIPPED) s.equipped.shift();
  }

  // Tapping a weapon card: equip it, or unequip it if it is on (one always stays).
  toggleEquip(i) {
    const s = this.state;
    if (s.levels[i] <= 0) return;
    const k = s.equipped.indexOf(i);
    if (k >= 0) {
      if (s.equipped.length === 1) { sfx('deny'); return; }
      s.equipped.splice(k, 1);
    } else this.equip(i);
    sfx('click');
    this.applyLoadout();
    this.ui.refreshShop();
  }

  toggleMute() {
    this.state.muted = !this.state.muted;
    setMuted(this.state.muted);
    if (!this.state.muted) { initAudio(); sfx('click'); }
    this.ui.updateHud();
    writeSave(this.state);
  }

  // Wipe the save and start over from the title screen.
  resetProgress() {
    clearSave();
    this.state = freshSave();
    writeSave(this.state);
    location.reload();
  }

  // ---------------------------------------------------------------- loop
  loop(ts) {
    const dt = Math.min(0.1, (ts - this.last) / 1000 || 0);
    this.last = ts;
    const paused = this.ui.shopOpen || document.hidden;
    if (!paused) {
      if (this.keys.left !== this.keys.right) {
        const g = this.world.gun;
        g.targetX = clamp(g.x + (this.keys.left ? -60 : 60), GUN_MIN_X, GUN_MAX_X);
      }
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 6) {
        if (this.mode === 'title' || this.autoplay) botUpdate(this.world, this.bot, STEP);
        this.world.update(STEP);
        this.handleEvents();
        this.acc -= STEP;
        n++;
      }
      if (n === 6) this.acc = 0;
      this.renderer.update(dt);
      if (this.world.lost && this.mode === 'title') {
        this.world.loadLevel(1, slimeHp(1));
        this.renderer.reset();
      }
      if (this.loseT > 0) {
        this.loseT -= dt;
        if (this.loseT <= 0) this.startLevel(this.state.level);
      }
      if (this.mode === 'play') {
        this.saveT += dt;
        if (this.saveT > 5) { this.saveT = 0; writeSave(this.state); }
      }
    }
    if (this.warm) {
      const t0 = performance.now();
      while (performance.now() - t0 < 4) if (this.warm.next().done) { this.warm = null; break; }
    }
    const vw = innerWidth, vh = innerHeight;
    if (vw !== this.vw || vh !== this.vh) { this.vw = vw; this.vh = vh; this.fit(); }
    this.renderer.draw(this.world, { dim: this.mode === 'title' ? 0.35 : 0 });
    this.ui.tick(dt);
    this.hudT += dt;
    if (this.hudT > 0.25 && this.mode === 'play') { this.hudT = 0; this.ui.updateHud(); }
    requestAnimationFrame((t) => this.loop(t));
  }
}

window.game = new Game();
