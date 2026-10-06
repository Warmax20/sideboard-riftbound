const SHELL = 'sb-shell-v2';
const IMAGES = 'sb-images-v1';
const FILES = ['./', 'index.html', 'styles.css', 'legends.js', 'cards.js', 'pdf.js', 'app.js', 'manifest.json', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Portraits and card images: cache first, a given URL never changes.
  const portrait = url.hostname === 'ddragon.leagueoflegends.com' && url.pathname.includes('/img/');
  if (portrait || url.hostname === 'cmsassets.rgpub.io') {
    e.respondWith(caches.open(IMAGES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // App shell: network first so updates show up, cache when offline.
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
