// Canvas and colour helpers shared by all the pixel art modules.
export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && !globalThis.document) return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}

export function hsv(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return rgbToHex([f(5) * 255, f(3) * 255, f(1) * 255]);
}

// ---------------------------------------------------------------- pixel buffers
// Sprites are built pixel by pixel in plain memory and uploaded in one go (much faster than
// one fillRect per pixel). The pixels of sprites that get rotated are kept, so rotating them
// never has to read pixels back from the GPU.
const rgbaCache = new Map();
export function rgba(col) {
  let v = rgbaCache.get(col);
  if (v) return v;
  if (/^#[0-9a-f]{3}$/i.test(col)) v = [...hexToRgb('#' + col[1] + col[1] + col[2] + col[2] + col[3] + col[3]), 255];
  else if (/^#[0-9a-f]{6}$/i.test(col)) v = [...hexToRgb(col), 255];
  else {
    const g = makeCanvas(1, 1).getContext('2d');
    g.fillStyle = col;
    g.fillRect(0, 0, 1, 1);
    v = [...g.getImageData(0, 0, 1, 1).data];
  }
  rgbaCache.set(col, v);
  return v;
}

export class PixBuf {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(Math.max(1, w * h) * 4);
  }

  // like fillRect(x, y, 1, 1) with an opaque colour
  set(x, y, col) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const c = rgba(col), d = this.data, i = (y * this.w + x) * 4;
    if (c[3] === 255) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; return; }
    // source-over for translucent colours
    const a = c[3] / 255, b = (d[i + 3] / 255) * (1 - a), o = a + b;
    if (o <= 0) return;
    d[i] = (c[0] * a + d[i] * b) / o; d[i + 1] = (c[1] * a + d[i + 1] * b) / o; d[i + 2] = (c[2] * a + d[i + 2] * b) / o;
    d[i + 3] = o * 255;
  }

  rect(x, y, w, h, col) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, col);
  }

  canvas(keep = false) { return canvasFromPixels(this.w, this.h, this.data, keep); }
}

const kept = new WeakMap();
export function canvasFromPixels(w, h, data, keep = false) {
  const c = makeCanvas(w, h);
  if (w > 0 && h > 0) c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  if (keep) kept.set(c, data);
  return c;
}

// RGBA pixels of a canvas (kept ones without a read-back)
export function pixelsOf(c) {
  let d = kept.get(c);
  if (!d) { d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; kept.set(c, d); }
  return d;
}
