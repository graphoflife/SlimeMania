// A simple autopilot: keeps the gun under the slime that is closest to the bottom.
// Used for the title-screen demo and for headless balancing.
export function botUpdate(world, st, dt) {
  st.t = (st.t ?? 0) - dt;
  if (st.t <= 0) {
    st.t = 0.25;
    st.noise = world.rng.gauss() * (st.aimNoise ?? 4);
  }
  let best = null;
  let bestY = -1e9;
  for (const s of world.slimes) {
    if (s.dead) continue;
    const v = s.y + s.r * 0.6;
    if (v > bestY) { bestY = v; best = s; }
  }
  if (best) world.gun.targetX = best.x + st.noise;
}
