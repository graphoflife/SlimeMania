// Keeps the screen on while the game is open (Screen Wake Lock API).
// The browser drops the lock whenever the page is hidden, so it is asked for again on return.
let lock = null;
let asking = false;

async function request() {
  if (lock || asking || document.hidden || !navigator.wakeLock) return;
  asking = true;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch {
    // refused for now (e.g. battery saver, or no tap yet): the next tap tries again
  } finally {
    asking = false;
  }
}

export function keepScreenOn() {
  request();
  document.addEventListener('visibilitychange', request);
  // some browsers only grant the lock after a tap
  addEventListener('pointerup', request);
}
