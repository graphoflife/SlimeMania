// Procedural sound effects with WebAudio. No audio files: everything is synthesised.
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
let voices = 0;
const MAX_VOICES = 48;
const last = {};

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(comp);
  comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.02);
}
export const isMuted = () => muted;
export function suspendAudio() { if (ctx && ctx.state === 'running') ctx.suspend(); }
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

function voice(node, dur) {
  voices++;
  node.onended = () => { voices--; };
  return dur;
}

// oscillator with pitch sweep and a quick envelope
function tone({ f0, f1 = f0, dur = 0.1, type = 'sine', vol = 0.2, a = 0.003, t = 0, lp = 0 }) {
  const now = ctx.currentTime + t;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, f0), now);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(vol, now + a);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  let out = o;
  if (lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    o.connect(f);
    out = f;
  }
  out.connect(g);
  g.connect(master);
  o.start(now);
  o.stop(now + dur + 0.02);
  voice(o, dur);
}

// filtered noise burst with a filter sweep
function noise({ dur = 0.1, vol = 0.2, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, a = 0.002, t = 0 }) {
  const now = ctx.currentTime + t;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, now);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(vol, now + a);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  s.connect(f);
  f.connect(g);
  g.connect(master);
  s.start(now, Math.random() * 0.5);
  s.stop(now + dur + 0.02);
  voice(s, dur);
}

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
let noteIdx = 0;
const rnd = (a, b) => a + Math.random() * (b - a);

// name -> [min gap in seconds, player(pitch)]
const SFX = {
  // weapons
  mg: [0.045, (p) => { noise({ dur: 0.04, vol: 0.16, f0: 2600 * p, f1: 700, q: 0.8 }); tone({ f0: 190 * p, f1: 80, dur: 0.05, type: 'square', vol: 0.05 }); }],
  shotgun: [0.08, (p) => { noise({ dur: 0.22, vol: 0.4, type: 'lowpass', f0: 3500 * p, f1: 200 }); tone({ f0: 130 * p, f1: 40, dur: 0.18, vol: 0.3 }); }],
  drop: [0.035, (p) => tone({ f0: 700 * p, f1: 1500 * p, dur: 0.06, vol: 0.09 })],
  shing: [0.06, (p) => { tone({ f0: 1900 * p, f1: 2900 * p, dur: 0.09, type: 'triangle', vol: 0.06 }); noise({ dur: 0.05, vol: 0.05, type: 'highpass', f0: 6000 }); }],
  thwip: [0.05, (p) => { noise({ dur: 0.07, vol: 0.12, f0: 1500 * p, f1: 4500, q: 2 }); tone({ f0: 600 * p, f1: 280, dur: 0.05, type: 'triangle', vol: 0.05 }); }],
  rustle: [0.08, (p) => noise({ dur: 0.12, vol: 0.08, f0: 3500 * p, f1: 2500, q: 1.5 })],
  pew: [0.05, (p) => tone({ f0: 1500 * p, f1: 260, dur: 0.12, type: 'square', vol: 0.06 })],
  launch: [0.08, (p) => { tone({ f0: 240 * p, f1: 90, dur: 0.12, vol: 0.25 }); noise({ dur: 0.08, vol: 0.1, type: 'lowpass', f0: 1200, f1: 300 }); }],
  boing: [0.06, (p) => tone({ f0: 280 * p, f1: 700 * p, dur: 0.13, type: 'triangle', vol: 0.12 })],
  swish: [0.08, (p) => noise({ dur: 0.1, vol: 0.14, f0: 900 * p, f1: 3500, q: 1.2 })],
  chime: [0.07, (p) => { const f = 1200 * 2 ** (PENTA[Math.floor(Math.random() * 6)] / 12); tone({ f0: f, dur: 0.3, vol: 0.05 }); tone({ f0: f * 2.01, dur: 0.2, vol: 0.02 }); }],
  tick: [0.05, (p) => tone({ f0: 900 * p, f1: 600, dur: 0.03, type: 'square', vol: 0.03 })],
  popcorn: [0.04, (p) => { tone({ f0: 500 * p, f1: 1300 * p, dur: 0.04, vol: 0.12 }); noise({ dur: 0.02, vol: 0.06, type: 'highpass', f0: 3000 }); }],
  zap: [0.06, (p) => { tone({ f0: 1300 * p, f1: 180, dur: 0.11, type: 'sawtooth', vol: 0.06 }); noise({ dur: 0.08, vol: 0.12, type: 'highpass', f0: 2500 }); }],
  flame: [0.09, (p) => noise({ dur: 0.14, vol: 0.09, type: 'lowpass', f0: 900 * p, f1: 350 })],
  nail: [0.045, (p) => { tone({ f0: 2600 * p, f1: 1200, dur: 0.025, type: 'square', vol: 0.03 }); noise({ dur: 0.02, vol: 0.06, f0: 5000 }); }],
  tunk: [0.07, (p) => { tone({ f0: 420 * p, f1: 200, dur: 0.07, vol: 0.18 }); noise({ dur: 0.03, vol: 0.05, f0: 2000 }); }],
  plasma: [0.08, (p) => tone({ f0: 330 * p, f1: 110, dur: 0.28, type: 'sawtooth', vol: 0.09, lp: 1400 })],
  bubble: [0.05, (p) => tone({ f0: 300 * p, f1: 950 * p, dur: 0.08, vol: 0.09 })],
  bubblepop: [0.04, (p) => tone({ f0: 900 * p, f1: 1800 * p, dur: 0.035, vol: 0.08 })],
  cannon: [0.09, (p) => { noise({ dur: 0.35, vol: 0.4, type: 'lowpass', f0: 900 * p, f1: 70 }); tone({ f0: 80 * p, f1: 32, dur: 0.35, vol: 0.4 }); }],
  saw: [0.08, (p) => { tone({ f0: 950 * p, f1: 1150 * p, dur: 0.2, type: 'sawtooth', vol: 0.03, lp: 3000 }); noise({ dur: 0.15, vol: 0.04, f0: 4000, q: 4 }); }],
  cash: [0.12, (p) => { tone({ f0: 1320 * p, dur: 0.06, type: 'square', vol: 0.04 }); tone({ f0: 1980 * p, dur: 0.22, type: 'square', vol: 0.04, t: 0.06 }); noise({ dur: 0.05, vol: 0.05, type: 'highpass', f0: 5000, t: 0.06 }); }],
  ice: [0.05, (p) => { tone({ f0: 2800 * p, f1: 3300 * p, dur: 0.08, type: 'triangle', vol: 0.04 }); tone({ f0: 4200 * p, dur: 0.05, vol: 0.02 }); }],
  whistle: [0.1, (p) => tone({ f0: 700 * p, f1: 2100 * p, dur: 0.35, vol: 0.05 })],
  crackle: [0.06, () => { for (let i = 0; i < 5; i++) noise({ dur: 0.025, vol: 0.12, type: 'highpass', f0: 2500 + Math.random() * 3000, t: i * 0.03 + Math.random() * 0.02 }); }],
  note: [0.05, () => { const f = 523 * 2 ** (PENTA[noteIdx++ % PENTA.length] / 12); tone({ f0: f, dur: 0.18, type: 'triangle', vol: 0.09 }); tone({ f0: f * 2, dur: 0.1, type: 'sine', vol: 0.025 }); }],
  squeak: [0.07, (p) => { tone({ f0: 900 * p, f1: 1500 * p, dur: 0.06, type: 'square', vol: 0.035, lp: 2500 }); tone({ f0: 1500 * p, f1: 850 * p, dur: 0.07, type: 'square', vol: 0.035, lp: 2500, t: 0.06 }); }],
  meteor: [0.1, (p) => noise({ dur: 0.4, vol: 0.12, type: 'lowpass', f0: 500 * p, f1: 1500 })],
  rumble: [0.08, (p) => { noise({ dur: 0.35, vol: 0.35, type: 'lowpass', f0: 500 * p, f1: 60 }); tone({ f0: 70, f1: 35, dur: 0.3, vol: 0.25 }); }],
  prism: [0.08, (p) => tone({ f0: 1600 * p, f1: 2400 * p, dur: 0.1, vol: 0.05 })],
  shimmer: [0.08, (p) => { for (let i = 0; i < 4; i++) tone({ f0: 1200 * p * 2 ** (PENTA[i * 2] / 12), dur: 0.22, vol: 0.035, t: i * 0.03 }); }],
  novaShot: [0.1, (p) => tone({ f0: 300 * p, f1: 900 * p, dur: 0.25, type: 'triangle', vol: 0.08 })],
  nova: [0.08, (p) => { noise({ dur: 0.3, vol: 0.25, type: 'lowpass', f0: 3000 * p, f1: 200 }); tone({ f0: 900 * p, f1: 200, dur: 0.3, type: 'triangle', vol: 0.1 }); }],
  boom: [0.06, (p) => { noise({ dur: 0.3, vol: 0.35, type: 'lowpass', f0: 1600 * p, f1: 90 }); tone({ f0: 110 * p, f1: 38, dur: 0.28, vol: 0.3 }); }],
  bigboom: [0.1, (p) => { noise({ dur: 0.55, vol: 0.5, type: 'lowpass', f0: 1400 * p, f1: 50 }); tone({ f0: 80 * p, f1: 28, dur: 0.5, vol: 0.45 }); }],
  // impacts
  hit: [0.028, (p) => { noise({ dur: 0.04, vol: 0.14, f0: 1300 * p, f1: 500, q: 1.2 }); tone({ f0: 230 * p, f1: 85, dur: 0.05, vol: 0.12 }); }],
  pop0: [0.03, (p) => { tone({ f0: 170 * p, f1: 560 * p, dur: 0.11, vol: 0.32 }); noise({ dur: 0.12, vol: 0.18, type: 'lowpass', f0: 900, f1: 150 }); tone({ f0: 90 * p, f1: 45, dur: 0.12, vol: 0.2 }); }],
  pop1: [0.03, (p) => { tone({ f0: 300 * p, f1: 860 * p, dur: 0.08, vol: 0.24 }); noise({ dur: 0.05, vol: 0.08, type: 'lowpass', f0: 1500, f1: 300 }); }],
  pop2: [0.025, (p) => { tone({ f0: 520 * p, f1: 1400 * p, dur: 0.055, vol: 0.18 }); noise({ dur: 0.03, vol: 0.06, type: 'highpass', f0: 2500 }); }],
  // ui & game
  click: [0.03, () => tone({ f0: 900, f1: 700, dur: 0.04, type: 'square', vol: 0.05 })],
  waveClear: [0.5, () => { [0, 4, 7, 12].forEach((n, i) => tone({ f0: 523 * 2 ** (n / 12), dur: 0.14, type: 'square', vol: 0.06, lp: 3000, t: i * 0.08 })); }],
  unlock: [0.5, () => { [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => tone({ f0: 523 * 2 ** (n / 12), dur: 0.18, type: 'square', vol: 0.06, lp: 3500, t: i * 0.07 })); tone({ f0: 2093, dur: 0.6, vol: 0.04, t: 0.5 }); }],
  lose: [0.5, () => { [7, 4, 0, -5].forEach((n, i) => tone({ f0: 392 * 2 ** (n / 12), f1: 392 * 2 ** ((n - 1) / 12), dur: 0.22, type: 'square', vol: 0.07, lp: 1800, t: i * 0.16 })); }],
  buy: [0.3, () => { [0, 7, 12, 16, 19, 24].forEach((n, i) => tone({ f0: 392 * 2 ** (n / 12), dur: 0.2, type: 'triangle', vol: 0.09, t: i * 0.06 })); }],
  deny: [0.15, () => tone({ f0: 180, f1: 120, dur: 0.15, type: 'square', vol: 0.06, lp: 1200 })],
};

// rising pitch while holding the upgrade button
let upStreak = 0, upLast = 0;
export function upgradeBlip() {
  if (!ctx || muted) return;
  const now = ctx.currentTime;
  if (now - upLast > 0.6) upStreak = 0;
  if (now - upLast < 0.03) return;
  upLast = now;
  const n = Math.min(upStreak++, 36);
  tone({ f0: 440 * 2 ** (n / 12), f1: 660 * 2 ** (n / 12), dur: 0.07, type: 'square', vol: 0.05, lp: 4000 });
}

export function sfx(name, pitch = 1) {
  if (!ctx || muted || ctx.state !== 'running') return;
  const e = SFX[name];
  if (!e) return;
  const now = ctx.currentTime;
  if (now - (last[name] ?? -1) < e[0]) return;
  if (voices > MAX_VOICES) return;
  last[name] = now;
  e[1](pitch * rnd(0.9, 1.1));
}
