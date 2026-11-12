// What campaign slime kinds need beyond the plain slime: the soap bubble around a Bubble slime,
// and a warm-up that builds a level's kinds (bodies in their colours and shapes, faces) ahead.
import { SLIME_R, BOSS } from './config.js';
import { PixBuf } from './pixelart.js';
import { SQUASH, slimeBody, slimeFace, rotated, ROT_STEPS } from './sprites.js';

const cache = new Map();
const cached = (key, build) => {
  let c = cache.get(key);
  if (c === undefined) cache.set(key, (c = build()));
  return c;
};

// Bubble: a soap bubble around the slime (gone once it has soaked up its share of hits).
export function bubbleSprite(size) {
  return cached(`bubble${size}`, () => {
    const R = SLIME_R[size] + 4, dim = Math.ceil(R) * 2 + 4, c = dim / 2, b = new PixBuf(dim, dim);
    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      if (Math.abs(d - R) < 0.75) b.set(x, y, '#d8f6ff');
      else if (d < R - 0.75 && d > R - 3 && a > -2.6 && a < -1.9) b.set(x, y, '#ffffff'); // shine, top left
      else if (d < R) b.set(x, y, 'rgba(190, 236, 255, 0.16)');
    }
    return b.canvas();
  });
}

// ---------------------------------------------------------------- warm-up
// Bodies (every squash step, with and without flash) and the turned faces a level's kinds need,
// built a little at a time before they are needed.
export function* warmKinds(kinds) {
  for (const kind of new Set(kinds)) {
    const sizes = kind.boss ? [BOSS] : kind.swarm ? [2] : [0, 1, 2];
    for (const size of sizes) {
      // kinds in the level's colours have their bodies built with the level (warmSlimes)
      const colors = kind.rainbow ?? (kind.colors ? [kind.colors[kind.boss ? 0 : size]] : []);
      for (let sqi = 0; sqi < SQUASH.length; sqi++) {
        for (const color of colors) for (const flash of [false, true]) { slimeBody(color, size, sqi, flash, kind.aspect ?? 1); yield; }
      }
      if (kind.shield) { bubbleSprite(size); yield; }
      for (const mode of kind.boss ? ['normal', 'hurt', 'blink'] : kind.rage ? ['angry'] : []) {
        for (let k = 1; k < ROT_STEPS; k++) { rotated(slimeFace(size, mode), (k / ROT_STEPS) * Math.PI * 2); yield; }
      }
    }
  }
}
