// Number formatting in steps of 10^3: K, M, G, T, P, E, Z, Y, R, Q (10^30).
// Past Q the prefixes repeat with an extra Q: KQ = 10^33, MQ = 10^36 ... QQ = 10^60.
const SI = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q'];

function suffix(g) {
  if (g < SI.length) return SI[g];
  return SI[g % 10] + 'Q'.repeat(Math.floor(g / 10));
}

// mode: 'floor' (money you have), 'ceil' (prices), 'round'
export function fmt(n, mode = 'floor') {
  if (!isFinite(n)) return 'INF';
  if (n < 0) return '-' + fmt(-n, mode);
  const op = Math[mode];
  if (n < 1000) {
    if (n < 10 && Math.abs(n - Math.round(n)) > 1e-9) return String(op(n * 10) / 10);
    return String(op(n + (mode === 'ceil' ? -1e-9 : 1e-9)));
  }
  let g = Math.floor(Math.log10(n) / 3 + 1e-12);
  let v = n / 10 ** (3 * g);
  let digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  let p = 10 ** digits;
  v = op(v * p + (mode === 'ceil' ? -1e-7 : 1e-7)) / p;
  if (v >= 1000) { g++; v = v / 1000; digits = 2; }
  let s = v.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s + suffix(g);
}
