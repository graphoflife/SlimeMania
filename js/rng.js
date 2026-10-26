// Small seedable PRNG (mulberry32) with a few helpers.
export class RNG {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.s = seed >>> 0;
    this.spare = null;
  }

  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  gauss() {
    if (this.spare !== null) { const s = this.spare; this.spare = null; return s; }
    let u, v, s;
    do { u = this.next() * 2 - 1; v = this.next() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this.spare = v * m;
    return u * m;
  }
}

// Sample a parameter range: {mean, spread, dist:'u'|'n'}.
// 'u' = uniform in [mean - spread, mean + spread], 'n' = normal with std = spread.
export function sample(r, rng) {
  if (r.dist === 'n') return r.mean + r.spread * rng.gauss();
  return r.mean + r.spread * (2 * rng.next() - 1);
}
