// A layer of small things (the gun, projectiles and their tails, pops, hit sparks, droplets),
// drawn into plain memory and put on the canvas in one go. On the GPU every fillRect and
// drawImage is a draw call of its own, and a busy frame made over a thousand of them for these.
// It speaks the little bit of the canvas API the code drawing them uses, so the same code draws
// onto either: fillStyle, strokeStyle, globalAlpha, lineWidth, fillRect, drawImage (whole
// picture, optionally scaled) and a stroke of one straight segment with round ends.
// Coordinates are the playfield's; row 0 of the layer is `top` rows above the playfield.
import { makeCanvas, rgba, pixelsOf } from './pixelart.js';

// the pixels of a picture as whole 32-bit values (RGBA bytes, little-endian)
const words = new WeakMap();
function wordsOf(img) {
  const d = pixelsOf(img);
  let w = words.get(d);
  if (!w) words.set(d, (w = new Uint32Array(d.buffer, d.byteOffset, d.length >> 2)));
  return w;
}

export class PixLayer {
  constructor() {
    this.w = 0;
    this.h = 0;
    this.top = 0;
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.globalAlpha = 1;
    this.lineWidth = 1;
    this.lineCap = 'round'; // the only kind there is here
    this.y0 = Infinity; // rows drawn on since the layer was last put on the canvas
    this.y1 = -1;
    this.p0 = 0;        // rows put on the canvas last time (cleared since)
    this.p1 = 0;
    this.path = null;
  }

  resize(w, h, top) {
    if (w === this.w && h === this.h && top === this.top) return;
    this.w = w; this.h = h; this.top = top;
    this.img = new ImageData(w, h);
    this.data = this.img.data;
    this.px = new Uint32Array(this.data.buffer);
    this.canvas = makeCanvas(w, h);
    this.cg = this.canvas.getContext('2d');
    this.y0 = Infinity; this.y1 = -1; this.p0 = 0; this.p1 = h;
  }

  // the colour is looked up once when it is set, not for every rect
  get fillStyle() { return this.fillName; }
  set fillStyle(c) { if (c !== this.fillName) { this.fillName = c; this.fill = rgba(c); } }

  // ---------------------------------------------------------------- pixels
  dirty(r0, r1) {
    if (r0 < this.y0) this.y0 = r0;
    if (r1 > this.y1) this.y1 = r1;
  }

  // source-over of one pixel, a in [0, 1]
  blend(i, r, g, b, a) {
    const v = this.px[i], da = (v >>> 24) / 255;
    if (a >= 1 || da === 0) { this.px[i] = ((a * 255 + 0.5) << 24) | (b << 16) | (g << 8) | r; return; }
    const rest = da * (1 - a), oa = a + rest;
    this.px[i] = ((oa * 255 + 0.5) << 24)
      | (((b * a + ((v >>> 16) & 255) * rest) / oa + 0.5) << 16)
      | (((g * a + ((v >>> 8) & 255) * rest) / oa + 0.5) << 8)
      | ((r * a + (v & 255) * rest) / oa + 0.5);
  }

  fillRect(x, y, w, h) {
    const W = this.w;
    const x0 = Math.max(0, Math.round(x)), x1 = Math.min(W, Math.round(x + w));
    const y0 = Math.max(0, Math.round(y) + this.top), y1 = Math.min(this.h, Math.round(y + h) + this.top);
    if (x0 >= x1 || y0 >= y1) return;
    this.dirty(y0, y1);
    const c = this.fill, a = (c[3] / 255) * this.globalAlpha;
    if (a >= 1) {
      const v = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]; // RGBA bytes, little-endian
      for (let y = y0; y < y1; y++) this.px.fill(v, y * W + x0, y * W + x1);
    } else if (a > 0) {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.blend(y * W + x, c[0], c[1], c[2], a);
    }
  }

  // drawImage(img, x, y) or drawImage(img, x, y, w, h): a whole picture, scaled with
  // nearest-neighbour sampling like the canvas does with smoothing off
  drawImage(img, x, y, w = img.width, h = img.height) {
    const sw = img.width, sh = img.height;
    if (!sw || !sh || w <= 0 || h <= 0) return;
    const src = wordsOf(img), W = this.w, top = this.top, px = this.px;
    const x0 = Math.max(0, Math.round(x)), x1 = Math.min(W, Math.round(x + w));
    const y0 = Math.max(-top, Math.round(y)), y1 = Math.min(this.h - top, Math.round(y + h));
    if (x0 >= x1 || y0 >= y1) return;
    this.dirty(y0 + top, y1 + top);
    const kx = sw / w, ky = sh / h, alpha = this.globalAlpha;
    const cols = this.cols || (this.cols = new Int32Array(1024));
    for (let i = x0; i < x1; i++) cols[i - x0] = Math.min(sw - 1, Math.floor((i + 0.5 - x) * kx)); // source column of each pixel
    for (let py = y0; py < y1; py++) {
      const sy = Math.min(sh - 1, Math.floor((py + 0.5 - y) * ky));
      if (sy < 0) continue;
      const srow = sy * sw, row = (py + top) * W;
      for (let i = x0; i < x1; i++) {
        const sx = cols[i - x0];
        if (sx < 0) continue;
        const v = src[srow + sx], a = v >>> 24;
        if (a === 0) continue;
        if (a === 255 && alpha >= 1) px[row + i] = v;
        else this.blend(row + i, v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (a / 255) * alpha);
      }
    }
  }

  // ---------------------------------------------------------------- one stroked segment
  beginPath() { this.path = null; }
  moveTo(x, y) { this.path = [x, y, x, y]; }
  lineTo(x, y) { if (this.path) { this.path[2] = x; this.path[3] = y; } }

  // Round-capped line with soft edges: every pixel is covered by how far its centre lies
  // inside the line (about what the canvas antialiasing gives).
  stroke() {
    if (!this.path) return;
    const [ax, ay, bx, by] = this.path;
    const c = rgba(this.strokeStyle), alpha = (c[3] / 255) * this.globalAlpha;
    if (alpha <= 0) return;
    const hw = this.lineWidth / 2, r = hw + 0.5, in2 = Math.max(0, hw - 0.5) ** 2, W = this.w, top = this.top;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    const yStart = Math.max(-top, Math.floor(Math.min(ay, by) - r)), yEnd = Math.min(this.h - top - 1, Math.ceil(Math.max(ay, by) + r));
    if (yStart > yEnd) return;
    this.dirty(yStart + top, yEnd + top + 1);
    for (let py = yStart; py <= yEnd; py++) {
      const cy = py + 0.5;
      // the part of the segment within reach of this row, widened by the line width
      let t0 = 0, t1 = 1;
      if (dy !== 0) {
        t0 = (cy - r - ay) / dy; t1 = (cy + r - ay) / dy;
        if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
        t0 = Math.max(0, Math.min(1, t0)); t1 = Math.max(0, Math.min(1, t1));
      }
      const xa = ax + dx * t0, xb = ax + dx * t1;
      const xs = Math.max(0, Math.floor(Math.min(xa, xb) - r)), xe = Math.min(W - 1, Math.ceil(Math.max(xa, xb) + r));
      const row = (py + top) * W;
      for (let px = xs; px <= xe; px++) {
        const cx = px + 0.5;
        const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / l2));
        const ex = cx - ax - dx * t, ey = cy - ay - dy * t, d2 = ex * ex + ey * ey;
        if (d2 >= r * r) continue;
        // fully inside (no square root needed), or partly covered at the edge
        this.blend(row + px, c[0], c[1], c[2], d2 <= in2 ? alpha : alpha * Math.min(1, r - Math.sqrt(d2)));
      }
    }
  }

  // ---------------------------------------------------------------- onto the canvas
  // Puts what was drawn since last time on g (drawn in playfield coordinates) and starts over.
  draw(g) {
    const y0 = this.y0, y1 = this.y1;
    // the rows drawn last time were cleared in memory: put them too, so they are cleared on the canvas
    const u0 = Math.min(y0, this.p0), u1 = Math.max(y1, this.p1);
    if (u1 > u0) this.cg.putImageData(this.img, 0, 0, 0, u0, this.w, u1 - u0);
    if (y1 > y0) {
      g.drawImage(this.canvas, 0, y0, this.w, y1 - y0, 0, y0 - this.top, this.w, y1 - y0);
      this.px.fill(0, y0 * this.w, y1 * this.w);
      this.p0 = y0; this.p1 = y1;
    } else { this.p0 = 0; this.p1 = 0; }
    this.y0 = Infinity; this.y1 = -1;
  }
}
