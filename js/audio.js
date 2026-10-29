// Procedural sound effects with WebAudio. No audio files: everything is synthesised.
// Weapons are silent on purpose: only slime hits and pops (plus a few UI jingles) make sound.
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
let voices = 0;
const MAX_VOICES = 48;
const last = {};
// Hits and pops come many times a second. Each is synthesised once, in a few variants, into a
// buffer and played back from there: building the oscillators and filters for every single
// hit costs a lot on phones (on the page and on the audio thread).
const BAKED = ['hit', 'pop0', 'pop1', 'pop2'];
const VARIANTS = 6;
const BAKE_LEN = 0.16; // seconds, longer than any of them
const BAKE_STEP = 2;   // variants set up per task: setting up audio nodes is slow on phones
const baked = {};
let baking = false;
let at = 0; // start of the sound being baked: all variants are rendered one after the other

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
  bakeAll();
}

// Renders the variants of the frequent sounds in one offline pass, each in its own slot of
// BAKE_LEN, and cuts them apart. They are set up a few at a time, so the page never stalls.
// Until they are ready (or if the browser cannot render offline) the sounds are synthesised
// live as before.
function bakeAll() {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return;
  const rate = ctx.sampleRate, len = Math.ceil(rate * BAKE_LEN), n = BAKED.length * VARIANTS;
  const oc = new OAC(1, len * n, rate);
  let k = 0;
  const next = () => {
    const live = [ctx, master];
    [ctx, master] = [oc, oc.destination]; // the synth functions play into the offline context
    baking = true;
    try {
      for (const end = Math.min(n, k + BAKE_STEP); k < end; k++) {
        at = (k * len) / rate;
        SFX[BAKED[Math.floor(k / VARIANTS)]][1](rnd(0.9, 1.1));
      }
    } finally {
      [ctx, master] = live;
      baking = false;
      at = 0;
    }
    if (k < n) { setTimeout(next, 20); return; }
    const done = oc.startRendering();
    if (!done?.then) return; // old callback-only version: keep synthesising live
    done.then((all) => {
      const data = all.getChannelData(0);
      BAKED.forEach((name, j) => {
        baked[name] = Array.from({ length: VARIANTS }, (_, i) => {
          const b = ctx.createBuffer(1, len, rate), s = j * VARIANTS + i;
          b.getChannelData(0).set(data.subarray(s * len, (s + 1) * len));
          return b;
        });
      });
    }, () => {});
  };
  setTimeout(next, 20);
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.02);
}
export const isMuted = () => muted;
export function suspendAudio() { if (ctx && ctx.state === 'running') ctx.suspend(); }
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

function voice(node, dur) {
  if (baking) return dur;
  voices++;
  node.onended = () => { voices--; };
  return dur;
}

// oscillator with pitch sweep and a quick envelope
function tone({ f0, f1 = f0, dur = 0.1, type = 'sine', vol = 0.2, a = 0.003, t = 0, lp = 0 }) {
  const now = ctx.currentTime + at + t;
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
  const now = ctx.currentTime + at + t;
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

const rnd = (a, b) => a + Math.random() * (b - a);

// name -> [min gap in seconds, player(pitch)]
const SFX = {
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
  const bufs = baked[name];
  if (!bufs) { e[1](pitch * rnd(0.9, 1.1)); return; }
  const src = ctx.createBufferSource();
  src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
  src.playbackRate.value = pitch;
  src.connect(master);
  src.start(now);
  voice(src);
}
