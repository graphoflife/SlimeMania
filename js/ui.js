// HUD, banners and the weapon shop ("Armory").
import { WEAPONS, shownDps } from './weapons.js';
import { upgradeCost, weaponPrice, ECON } from './economy.js';
import { MAX_EQUIPPED } from './config.js';
import { fmt } from './format.js';
import { sprite, makeCanvas } from './sprites.js';
import { sfx, upgradeBlip } from './audio.js';

const $ = (id) => document.getElementById(id);

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

    $('btnShop').addEventListener('click', () => { sfx('click'); game.openShop(); });
    $('shopClose').addEventListener('click', () => { sfx('click'); game.closeShop(); });
    if (document.fullscreenEnabled) $('btnFull').addEventListener('click', () => { sfx('click'); game.toggleFullscreen(); });
    else $('btnFull').classList.add('hidden'); // e.g. iPhone: use "Add to Home Screen" instead
    this.shop.addEventListener('pointerdown', (e) => { if (e.target === this.shop) game.closeShop(); });
    $('lvPrev').addEventListener('click', () => { sfx('click'); game.setLevel(game.state.level - 1); });
    $('lvNext').addEventListener('click', () => { sfx('click'); game.setLevel(game.state.level + 1); });
    $('btnMute').addEventListener('click', () => game.toggleMute());
    $('confirmNo').addEventListener('click', () => { sfx('click'); $('confirm').classList.add('hidden'); });
    $('confirmYes').addEventListener('click', () => game.resetProgress());
    this.buildShop();
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
    if (this.gainDirty) {
      this.gainDirty = false;
      this.gain.textContent = '+' + fmt(this.gainSum);
      this.gain.classList.remove('bump');
      void this.gain.offsetWidth;
      this.gain.classList.add('bump');
    }
    this.gain.classList.toggle('show', this.gainIdle < 0.8);
  }

  tick(dt) {
    this.flushGains(dt);
    const s = this.game.state;
    const target = s.money;
    if (this.shownMoney !== target) {
      const d = target - this.shownMoney;
      if (Math.abs(d) <= Math.max(1, Math.abs(target) * 1e-4)) this.shownMoney = target;
      else this.shownMoney += d * Math.min(1, dt * 12);
      this.moneyEl.textContent = fmt(this.shownMoney);
    }
    const w = this.game.world;
    const wave = `WAVE ${w.waveNum}`;
    if (this.waveCache !== wave) { this.waveCache = wave; $('waveText').textContent = wave; }
  }

  bumpMoney() {
    this.moneyPill.classList.remove('bump');
    void this.moneyPill.offsetWidth;
    this.moneyPill.classList.add('bump');
    clearTimeout(this.bumpT);
    this.bumpT = setTimeout(() => this.moneyPill.classList.remove('bump'), 90);
  }

  updateHud() {
    const s = this.game.state;
    $('lvText').textContent = `LEVEL ${s.level}`;
    $('lvPrev').disabled = s.level <= 1;
    $('lvNext').disabled = s.level >= s.maxLevel;
    $('lvNext').classList.toggle('glow', s.level === s.maxLevel - 1);
    $('btnMute').classList.toggle('muted', s.muted);
    const next = this.nextWeapon();
    $('btnShop').classList.toggle('attn', next >= 0 && s.money >= weaponPrice(next));
  }

  showHud(on) { this.hud.classList.toggle('hidden', !on); }

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
    const lv = this.game.state.levels;
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
          <div class="wdesc"></div>
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
        desc: el.querySelector('.wdesc'),
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
    const foot = document.createElement('div');
    foot.className = 'list-foot';
    foot.innerHTML = `
      <div class="sky-set"><span>SKY</span><button data-sky="auto">AUTO</button><button data-sky="day">DAY</button><button data-sky="night">NIGHT</button></div>
      <button class="btn danger">RESET GAME</button>`;
    for (const b of foot.querySelectorAll('[data-sky]')) {
      b.addEventListener('click', () => { sfx('click'); this.game.setSky(b.dataset.sky); });
    }
    foot.querySelector('.danger').addEventListener('click', () => { sfx('click'); $('confirm').classList.remove('hidden'); });
    this.skyButtons = foot.querySelectorAll('[data-sky]');
    this.list.appendChild(foot);
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
    const card = this.cards[Math.max(...this.game.state.equipped)].el;
    const gap = card.offsetHeight * 0.15;
    this.list.scrollTop = Math.max(0, card.offsetTop + card.offsetHeight + gap - this.list.clientHeight);
  }

  closeShop() {
    this.shop.classList.add('hidden');
    $('confirm').classList.add('hidden');
  }
  get shopOpen() { return !this.shop.classList.contains('hidden'); }

  refreshSky() {
    for (const b of this.skyButtons) b.classList.toggle('on', b.dataset.sky === this.game.state.sky);
  }

  refreshShop() {
    this.refreshSky();
    const s = this.game.state;
    $('shopMoney').textContent = fmt(s.money);
    $('eqCount').textContent = `${s.equipped.length}/${MAX_EQUIPPED}`;
    let total = 0;
    for (const i of s.equipped) total += shownDps(WEAPONS[i], s.levels[i]);
    $('totalDps').textContent = fmt(total);
    const slots = $('slots');
    slots.innerHTML = '';
    for (let k = 0; k < MAX_EQUIPPED; k++) {
      const d = document.createElement('div');
      const wi = s.equipped[k];
      d.className = 'slot' + (wi !== undefined ? ' on' : '');
      if (wi !== undefined) {
        d.appendChild(iconCanvas(WEAPONS[wi]));
        const t = document.createElement('span');
        t.textContent = 'LV ' + s.levels[wi];
        d.appendChild(t);
      } else d.textContent = 'EMPTY';
      slots.appendChild(d);
    }
    const next = this.nextWeapon();
    for (const c of this.cards) this.updateCard(c, next);
    this.updateHud();
  }

  updateCard(c, next) {
    const s = this.game.state;
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
    c.desc.textContent = owned || isNext ? c.def.desc : 'Unlock the weapon above first.';
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
    const s = this.game.state;
    $('shopMoney').textContent = fmt(s.money);
    const next = this.nextWeapon();
    for (const c of this.cards) {
      if (s.levels[c.i] > 0 || c.i === next) this.updateCard(c, next);
    }
    let total = 0;
    for (const k of s.equipped) total += shownDps(WEAPONS[k], s.levels[k]);
    $('totalDps').textContent = fmt(total);
    const slots = $('slots').children;
    s.equipped.forEach((wi, k) => { const t = slots[k]?.querySelector('span'); if (t) t.textContent = 'LV ' + s.levels[wi]; });
  }

  upgraded() { upgradeBlip(); }
}
