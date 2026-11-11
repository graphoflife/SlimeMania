// HUD, banners and the weapon shop ("Armory").
import { WEAPONS, shownDps } from './weapons.js';
import { upgradeCost, weaponPrice, ECON } from './economy.js';
import { MAX_EQUIPPED } from './config.js';
import { HEARTS } from './campaign.js';
import { fmt } from './format.js';
import { sprite, makeCanvas } from './sprites.js';
import { sfx, upgradeBlip } from './audio.js';

const $ = (id) => document.getElementById(id);
// The running numbers (money, kill streak) are rewritten at most this often: every new text
// has to be laid out and painted again, which is slow on phones during a big fight.
const TEXT_DT = 1 / 15;

// Small pixel icons for buttons, drawn as crisp SVG from ascii maps.
const ICONS = {
  cart: ['XX..........', '.X..........', '.XXXXXXXXXXX', '.X.X.X.X.X.X', '..XXXXXXXXX.', '..X.X.X.X.X.',
    '...XXXXXXX..', '...X.....X..', '..XXX...XXX.', '...X.....X..'],
  gear: ['....XX....', '.X.XXXX.X.', '..XXXXXX..', '.XXX..XXX.', 'XXX....XXX', 'XXX....XXX', '.XXX..XXX.',
    '..XXXXXX..', '.X.XXXX.X.', '....XX....'],
  full: ['XXXX..XXXX', 'X........X', 'X........X', 'X........X', '..........', '..........', 'X........X',
    'X........X', 'X........X', 'XXXX..XXXX'],
  heart: ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'],
  cross: ['XX......XX', 'XXX....XXX', '.XXX..XXX.', '..XXXXXX..', '...XXXX...', '...XXXX...', '..XXXXXX..',
    '.XXX..XXX.', 'XXX....XXX', 'XX......XX'],
};
function pixIcon(rows) {
  let rects = '';
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'X') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
  return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" fill="currentColor">${rects}</svg>`;
}

function iconCanvas(def, silhouette) {
  const st = def.stages[0];
  const name = Array.isArray(st.sprite) ? st.sprite[0] : st.sprite;
  const img = sprite(name, st.tints ? st.tints[0] : null);
  // integer upscale so small projectiles still read as icons
  const S = 24;
  const k = Math.max(1, Math.floor(22 / Math.max(img.width, img.height)));
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const w = img.width * k, h = img.height * k;
  g.drawImage(img, Math.floor((S - w) / 2), Math.floor((S - h) / 2), w, h);
  if (silhouette) {
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
  }
  return c;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.shownMoney = 0;
    this.cards = [];
    this.hud = $('hud');
    this.moneyEl = $('moneyVal');
    this.moneyPill = $('money');
    this.shop = $('shop');
    this.list = $('shopList');
    this.banner = $('banner');
    this.bannerUntil = 0;
    this.gain = $('gain');
    this.gainSum = 0;
    this.gainIdle = 0;
    this.textT = TEXT_DT; // time since a running number was last rewritten

    for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = pixIcon(ICONS[el.dataset.icon]);
    $('btnShop').addEventListener('click', () => { sfx('click'); game.openShop(); });
    $('shopClose').addEventListener('click', () => { sfx('click'); game.closeShop(); });
    if (document.fullscreenEnabled) $('btnFull').addEventListener('click', () => { sfx('click'); game.toggleFullscreen(); });
    else $('btnFull').classList.add('hidden'); // e.g. iPhone: use "Add to Home Screen" instead
    this.shop.addEventListener('pointerdown', (e) => { if (e.target === this.shop) game.closeShop(); });
    $('lvPrev').addEventListener('click', () => { sfx('click'); game.setLevel(game.prog.level - 1); });
    $('lvNext').addEventListener('click', () => { sfx('click'); game.setLevel(game.prog.level + 1); });
    $('btnSettings').addEventListener('click', () => { sfx('click'); this.refreshSettings(); $('settings').classList.remove('hidden'); });
    $('settingsClose').addEventListener('click', () => { sfx('click'); $('settings').classList.add('hidden'); });
    $('btnReset').addEventListener('click', () => { sfx('click'); $('confirm').classList.remove('hidden'); });
    for (const b of document.querySelectorAll('[data-sky]')) {
      b.addEventListener('click', () => { sfx('click'); game.setSky(b.dataset.sky); });
    }
    for (const b of document.querySelectorAll('[data-sound]')) {
      b.addEventListener('click', () => game.setSound(b.dataset.sound === 'on'));
    }
    $('confirmNo').addEventListener('click', () => { sfx('click'); $('confirm').classList.add('hidden'); });
    $('confirmYes').addEventListener('click', () => game.resetProgress());
    $('btnZen').addEventListener('click', () => game.start('zen'));
    $('btnCampaign').addEventListener('click', () => game.start('campaign'));
    $('btnMenu').addEventListener('click', () => { sfx('click'); game.toMenu(); });
    this.panel = $('panel');
    for (const b of this.panel.querySelectorAll('[data-act]')) b.addEventListener('click', () => game.panelAction(b.dataset.act));
    this.top = $('top');
    this.bossBar = $('bossBar');
    this.bossFill = this.bossBar.querySelector('i');
    $('hearts').innerHTML = Array.from({ length: HEARTS }, () => `<i class="px heart">${pixIcon(ICONS.heart)}</i>`).join('');
    this.buildShop();
    this.buildSlots();
  }

  // ---------------------------------------------------------------- HUD
  // money from kills is collected for a moment, then shown under the money counter
  // One number right above the money counter: the running total of the current killing
  // streak. It resets after a short pause without kills and then fades out.
  addGain(value) {
    if (this.gainIdle > 0.8) this.gainSum = 0;
    this.gainSum += value;
    this.gainIdle = 0;
    this.gainDirty = true;
  }

  flushGains(dt) {
    this.gainIdle += dt;
    if (this.gainDirty && this.textT >= TEXT_DT) {
      this.gainDirty = false;
      this.textT = 0;
      const text = '+' + fmt(this.gainSum);
      if (text !== this.gainText) { this.gainText = text; this.gain.textContent = text; }
      // restart the little bump (an animation object: no forced page layout)
      this.gainAnim?.cancel();
      this.gainAnim = this.gain.animate([{ transform: 'scale(1.25)' }, { transform: 'none' }], { duration: 120, easing: 'steps(3)' });
    }
    const show = this.gainIdle < 0.8;
    if (show !== this.gainShown) { this.gainShown = show; this.gain.classList.toggle('show', show); }
  }

  tick(dt) {
    this.textT += dt;
    const write = this.textT >= TEXT_DT;
    this.flushGains(dt);
    const s = this.game.prog;
    const target = s.money;
    if (this.shownMoney !== target) {
      const d = target - this.shownMoney;
      if (Math.abs(d) <= Math.max(1, Math.abs(target) * 1e-4)) this.shownMoney = target;
      else this.shownMoney += d * Math.min(1, dt * 12);
    }
    if (write && this.shownMoney !== this.moneyAt) {
      this.moneyAt = this.shownMoney;
      const text = fmt(this.shownMoney);
      if (text !== this.moneyText) { this.moneyText = text; this.moneyEl.textContent = text; this.textT = 0; }
    }
    const w = this.game.world;
    const wave = w.script ? `${w.spawnIdx}/${w.script.length}` : `WAVE ${w.waveNum}`;
    if (this.waveCache !== wave) { this.waveCache = wave; $('waveText').textContent = wave; }
    // the boss's HP bar (its width changes without laying out the page again)
    const boss = this.game.mode === 'play' ? w.boss : null;
    if (boss !== this.shownBoss) {
      this.shownBoss = boss;
      this.bossBar.classList.toggle('hidden', !boss);
      if (boss) this.bossBar.querySelector('.bb-name').textContent = boss.kind.name;
    }
    if (boss && write) {
      const f = Math.max(0, boss.hp / boss.maxHp);
      if (f !== this.bossF) { this.bossF = f; this.bossFill.style.transform = `scaleX(${f})`; }
    }
  }

  bumpMoney() {
    this.moneyPill.classList.add('bump');
    clearTimeout(this.bumpT);
    this.bumpT = setTimeout(() => this.moneyPill.classList.remove('bump'), 90);
  }

  updateHud() {
    const s = this.game.prog;
    const camp = this.game.inCampaign;
    this.top.classList.toggle('hidden', !camp);
    if (camp) this.updateHearts(this.game.hearts);
    $('lvText').textContent = `LEVEL ${s.level}`;
    $('lvPrev').disabled = s.level <= 1;
    $('lvNext').disabled = s.level >= s.maxLevel;
    $('lvNext').classList.toggle('glow', s.level === s.maxLevel - 1);
    const next = this.nextWeapon();
    $('btnShop').classList.toggle('attn', next >= 0 && s.money >= weaponPrice(next));
  }

  showHud(on) {
    this.hud.classList.toggle('hidden', !on);
    if (!on) this.top.classList.add('hidden');
    this.shownMoney = this.game.prog.money; // no counting from the other mode's money
    this.moneyAt = null;
  }

  updateHearts(n) {
    $('hearts').querySelectorAll('.heart').forEach((h, i) => h.classList.toggle('lost', i >= n));
  }

  // The two modes on the title screen, each with where it stands.
  refreshTitle() {
    const s = this.game.state, c = s.campaign;
    $('zenSub').textContent = s.maxLevel > 1 || s.money > 0 ? `LEVEL ${s.level}` : 'ENDLESS';
    const stars = Object.values(c.stars).reduce((a, b) => a + b, 0);
    $('campSub').textContent = c.maxLevel > 1 ? `LEVEL ${c.maxLevel} - ${stars}*` : 'LEVEL 1';
  }

  // Campaign level result: 'clear' { stars, bonus } | 'fail' | null (hide).
  showPanel(kind, data = {}) {
    const p = this.panel;
    p.classList.toggle('hidden', !kind);
    if (!kind) return;
    const clear = kind === 'clear';
    this.banner.classList.remove('show'); // the result says it all
    this.bannerUntil = 0;
    p.classList.toggle('fail', !clear);
    p.querySelector('.p-title').textContent = clear ? 'LEVEL CLEAR!' : 'LEVEL FAILED';
    p.querySelector('.p-stars').innerHTML = clear
      ? Array.from({ length: HEARTS }, (_, i) => `<i class="star${i < data.stars ? ' on' : ''}" style="--d:${0.25 + i * 0.25}s"></i>`).join('')
      : '';
    p.querySelector('.p-text').textContent = clear ? `BONUS +${fmt(data.bonus)}` : 'UPGRADE YOUR WEAPONS AND TRY AGAIN!';
    p.querySelector('[data-act=next]').classList.toggle('hidden', !clear);
    p.querySelector('[data-act=replay]').textContent = clear ? 'REPLAY' : 'RETRY';
  }

  // soft banners never interrupt a banner that is still showing
  showBanner(main, sub = '', color = '#ffffff', dur = 1.6, soft = false) {
    const now = performance.now();
    if (soft && now < this.bannerUntil) return;
    this.bannerUntil = now + dur * 1000;
    const b = this.banner;
    b.querySelector('.b-main').textContent = main;
    b.querySelector('.b-sub').textContent = sub;
    b.style.setProperty('--bc', color);
    b.style.setProperty('--dur', dur + 's');
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  // ---------------------------------------------------------------- shop
  nextWeapon() {
    const lv = this.game.prog.levels;
    const i = lv.findIndex((l) => l === 0);
    return i;
  }

  buildShop() {
    this.list.innerHTML = '';
    this.cards = WEAPONS.map((def, i) => {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `
        <div class="icon-box"></div>
        <div class="info">
          <div class="wname"><span class="nm"></span><span class="eq">ON</span></div>
          <div class="wstat"></div>
        </div>
        <div class="btns">
          <button class="upsq" aria-label="Upgrade"><span class="uplv"></span><i class="uparrow"></i><span class="cost"></span></button>
          <button class="upsq buysq" aria-label="Buy"><span class="uplv">LV 0</span><i class="uparrow"></i><span class="cost price"></span></button>
        </div>`;
      const card = {
        el, def, i,
        icon: el.querySelector('.icon-box'),
        nm: el.querySelector('.nm'),
        uplv: el.querySelector('.uplv'),
        stat: el.querySelector('.wstat'),
        up: el.querySelector('.upsq:not(.buysq)'),
        cost: el.querySelector('.cost'),
        buy: el.querySelector('.buysq'),
        price: el.querySelector('.price'),
        iconState: null,
      };
      // the whole card is the equip button; its own buttons do not equip
      el.addEventListener('click', () => this.game.toggleEquip(i));
      card.buy.addEventListener('click', (e) => { e.stopPropagation(); this.game.buyWeapon(i); });
      card.up.addEventListener('click', (e) => e.stopPropagation());
      this.bindHold(card.up, () => this.game.upgrade(i));
      this.list.appendChild(el);
      return card;
    });
  }

  // The equipped weapons below the list, each with its own upgrade button (works like the one
  // on its card), so upgrading them never needs scrolling.
  buildSlots() {
    const box = $('slots');
    box.innerHTML = '';
    this.slots = Array.from({ length: MAX_EQUIPPED }, (_, k) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `
        <div class="slot-top"><span class="slot-icon"></span><span class="slot-lv"></span></div>
        <button class="upbar" aria-label="Upgrade"><i class="uparrow"></i><span class="cost"></span></button>`;
      const slot = { el, icon: el.querySelector('.slot-icon'), lv: el.querySelector('.slot-lv'), up: el.querySelector('.upbar'), cost: el.querySelector('.cost'), wi: -1 };
      this.bindHold(slot.up, (turbo) => {
        const wi = this.game.prog.equipped[k];
        return wi !== undefined && this.game.upgrade(wi, turbo);
      });
      box.appendChild(el);
      return slot;
    });
  }

  updateSlots() {
    const s = this.game.prog;
    this.slots.forEach((slot, k) => {
      const wi = s.equipped[k] ?? -1;
      if (slot.wi !== wi) {
        slot.wi = wi;
        slot.el.classList.toggle('on', wi >= 0);
        slot.icon.innerHTML = '';
        if (wi >= 0) slot.icon.appendChild(iconCanvas(WEAPONS[wi]));
      }
      if (wi < 0) { slot.lv.textContent = 'EMPTY'; return; }
      const lvl = s.levels[wi], cost = upgradeCost(wi, lvl);
      slot.lv.textContent = 'LV ' + lvl;
      slot.cost.textContent = fmt(cost, 'ceil');
      slot.up.classList.toggle('poor', s.money < cost);
    });
  }

  bindHold(btn, action) {
    let timer = null, start = 0;
    const stop = () => { clearTimeout(timer); timer = null; };
    const step = () => {
      const held = performance.now() - start;
      const n = held > 4000 ? 10 : held > 2500 ? 4 : 1;
      let ok = true;
      for (let k = 0; k < n && ok; k++) ok = action(true);
      if (!ok) { stop(); return; }
      timer = setTimeout(step, Math.max(16, 110 - held / 10));
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      stop();
      start = performance.now();
      if (!action(false)) return;
      timer = setTimeout(step, 450);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, stop);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  openShop() {
    this.shop.classList.remove('hidden');
    this.refreshShop();
    // start with the lowest equipped weapon of the list at the bottom of the view
    // (layout offsets, not screen rects: the shop pops in with a scale animation)
    const card = this.cards[Math.max(...this.game.prog.equipped)].el;
    const gap = card.offsetHeight * 0.15;
    this.list.scrollTop = Math.max(0, card.offsetTop + card.offsetHeight + gap - this.list.clientHeight);
  }

  closeShop() {
    this.shop.classList.add('hidden');
    $('confirm').classList.add('hidden');
    $('settings').classList.add('hidden');
  }
  get shopOpen() { return !this.shop.classList.contains('hidden'); }

  refreshSettings() {
    const s = this.game.state;
    for (const b of document.querySelectorAll('[data-sky]')) b.classList.toggle('on', b.dataset.sky === s.sky);
    for (const b of document.querySelectorAll('[data-sound]')) b.classList.toggle('on', (b.dataset.sound === 'off') === !!s.muted);
  }

  refreshShop() {
    const s = this.game.prog;
    $('shopMoney').textContent = fmt(s.money);
    $('eqCount').textContent = `${s.equipped.length}/${MAX_EQUIPPED}`;
    let total = 0;
    for (const i of s.equipped) total += shownDps(WEAPONS[i], s.levels[i]);
    $('totalDps').textContent = fmt(total);
    this.updateSlots();
    const next = this.nextWeapon();
    for (const c of this.cards) this.updateCard(c, next);
    this.updateHud();
  }

  updateCard(c, next) {
    const s = this.game.prog;
    const lvl = s.levels[c.i];
    const owned = lvl > 0;
    const isNext = c.i === next;
    const iconState = owned || isNext ? 'show' : 'sil';
    if (c.iconState !== iconState) {
      c.icon.innerHTML = '';
      c.icon.appendChild(iconCanvas(c.def, iconState === 'sil'));
      c.iconState = iconState;
    }
    const eq = s.equipped.includes(c.i);
    c.el.className = 'card' + (owned ? ' owned' : '') + (eq ? ' equipped' : '') + (isNext ? ' next' : '') + (!owned && !isNext ? ' locked' : '');
    c.nm.textContent = owned || isNext ? c.def.name : '???';
    if (owned) {
      const rate = Math.min(lvl - 1, ECON.RATE_LEVELS);
      c.stat.innerHTML = `DPS ${fmt(shownDps(c.def, lvl))}` +
        (rate < ECON.RATE_LEVELS ? ` <span class="rate">RATE ${rate}/${ECON.RATE_LEVELS}</span>` : ' <span class="rate">MAX RATE</span>');
    } else if (isNext) c.stat.textContent = `DPS ${fmt(shownDps(c.def, 1))} AT LV 1`;
    else c.stat.textContent = '';
    c.up.classList.toggle('hidden', !owned);
    c.buy.classList.toggle('hidden', !isNext);
    if (owned) {
      c.uplv.textContent = `LV ${lvl}`;
      const cost = upgradeCost(c.i, lvl);
      c.cost.textContent = fmt(cost, 'ceil');
      c.up.classList.toggle('poor', s.money < cost);
    }
    if (isNext) {
      const price = weaponPrice(c.i);
      c.price.textContent = fmt(price, 'ceil');
      c.buy.classList.toggle('poor', s.money < price);
    }
  }

  // cheap refresh during turbo upgrades
  refreshCard(i) {
    const s = this.game.prog;
    $('shopMoney').textContent = fmt(s.money);
    const next = this.nextWeapon();
    for (const c of this.cards) {
      if (s.levels[c.i] > 0 || c.i === next) this.updateCard(c, next);
    }
    let total = 0;
    for (const k of s.equipped) total += shownDps(WEAPONS[k], s.levels[k]);
    $('totalDps').textContent = fmt(total);
    this.updateSlots();
  }

  upgraded() { upgradeBlip(); }
}
