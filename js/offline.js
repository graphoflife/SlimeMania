// Makes the game playable without internet: a service worker (sw.js) keeps a copy of every
// file on the device. Once the page has loaded, it hands the worker the list of files it used.
export function playOffline() {
  if (!('serviceWorker' in navigator)) return;
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      const here = location.origin;
      const used = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(here));
      (reg.active || navigator.serviceWorker.controller)?.postMessage({ store: [...new Set(used)] });
    } catch { /* e.g. private mode: the game simply needs the internet then */ }
  });
  // Installed as an app, the progress (localStorage) is kept even when the phone runs low on
  // space. Only asked for there: elsewhere some browsers would show a permission prompt.
  if (matchMedia('(display-mode: standalone)').matches) navigator.storage?.persist?.().catch(() => {});
}
