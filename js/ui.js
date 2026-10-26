// HUD, banners and the weapon shop ("Armory").
import { WEAPONS, shownDps } from './weapons.js';
import { upgradeCost, weaponPrice, ECON } from './economy.js';
import { MAX_EQUIPPED } from './config.js';
import { fmt } from './format.js';
import { spriteRaw, makeCanvas } from './sprites.js';
import { sfx, upgradeBlip } from './audio.js';

const $ = (id) => document.getElementById(id);

function iconCanvas(def, silhouette) {
  const st = def.stages[0];
  const name = Array.isArray(st.sprite) ? st.sprite[0] : st.sprite;
  const img = spriteRaw(name, st.tints ? st.tints[0] : null);
  // integer upscale so tiny projectiles still read as icons
  const k = Math.max(1, Math.floor(12 / Math.max(img.width, img.height)));
  const S = 14;
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
    this.gains = $('gains');
    this.gainAcc = 0;
    this.gainBig = false;
    this.gainT = 0;

    $('btnShop').addEventListener('click', () => { sfx('click'); game.openShop(); });
    $('shopClose').addEventListener('click', () => { sfx('click'); game.closeShop(); });
    this.shop.addEventListener('pointerdown', (e) => { if (e.target === this.shop) game.closeShop(); });
    $('lvPrev').addEventListener('click', () => { sfx('click'); game.setLevel(game.state.level - 1); });
    $('lvNext').addEventListener('click', () => { sfx('click'); game.setLevel(game.state.level + 1); });
    $('btnMute').addEventListener('click', () => game.toggleMute());
    $('btnReset').addEventListener('click', () => {
      if (confirm('Reset ALL progress? This cannot be undone.')) game.resetProgress();
    });
    this.buildShop();
  }

  // ---------------------------------------------------------------- HUD
  // money from kills is collected for a moment, then shown under the money counter
  addGain(value, big) {
    this.gainAcc += value;
    this.gainBig ||= big;
  }

  flushGains(dt) {
    this.gainT -= dt;
    if (this.gainT > 0 || this.gainAcc <= 0) return;
    this.gainT = 0.12;
    const el = document.createElement('div');
    el.className = 'gain' + (this.gainBig ? ' big' : '');
    el.textContent = '+' + fmt(this.gainAcc);
    el.addEventListener('animationend', () => el.remove());
    this.gains.prepend(el); // newest right under the money counter
    while (this.gains.childElementCount > 5) this.gains.lastElementChild.remove();
    this.gainAcc = 0;
    this.gainBig = false;
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
          <button class="btn buy">BUY <span class="price"></span></button>
        </div>`;
      const card = {
        el, def, i,
        icon: el.querySelector('.icon-box'),
        nm: el.querySelector('.nm'),
        uplv: el.querySelector('.uplv'),
        desc: el.querySelector('.wdesc'),
        stat: el.querySelector('.wstat'),
        up: el.querySelector('.upsq'),
        cost: el.querySelector('.cost'),
        buy: el.querySelector('.buy'),
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
    // scroll the "next weapon" card into view
    const next = this.nextWeapon();
    const target = this.cards[next >= 0 ? Math.max(0, next - 1) : WEAPONS.length - 1];
    if (target) this.list.scrollTop = target.el.offsetTop - this.list.offsetTop - 4;
  }

  closeShop() { this.shop.classList.add('hidden'); }
  get shopOpen() { return !this.shop.classList.contains('hidden'); }

  refreshShop() {
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
