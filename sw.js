// Service worker: keeps a copy of the game on the device, so it also starts without internet.
// Online, every file still comes fresh from the server (and the copy is updated); only when the
// server cannot be reached, or does not answer within NET_WAIT, the stored copy is used.
// The page tells this worker which files it loaded (js/offline.js), so new modules are stored
// without a list to keep up to date here. Listed are only files the page itself does not load.
const CACHE = 'slimemania';
const NET_WAIT = 4000; // ms
const CORE = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'favicon.svg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/icon-180.png',
];

const ours = (url) => url.startsWith(self.registration.scope);

// fetches and stores the files (all of them, or only the ones not stored yet)
async function store(urls, all) {
  const cache = await caches.open(CACHE);
  await Promise.all(urls.filter(ours).map(async (url) => {
    try {
      if (!all && (await cache.match(url))) return;
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) await cache.put(url, res);
    } catch { /* offline right now: stored on a later visit */ }
  }));
}

self.addEventListener('install', (e) => {
  e.waitUntil(store(CORE.map((u) => new URL(u, self.registration.scope).href), true).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  if (e.data?.store) e.waitUntil(store(e.data.store));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !ours(req.url)) return;
  e.respondWith(fresh(req));
});

async function fresh(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  net.catch(() => {});
  try {
    const res = await Promise.race([net, new Promise((r) => setTimeout(r, NET_WAIT))]);
    if (res) return res;
  } catch { /* no connection */ }
  // the stored copy (the game's address may carry ?autoplay or similar)
  return (await cache.match(req, { ignoreSearch: true })) || net;
}
