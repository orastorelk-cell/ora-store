const CACHE = 'ora-store-shell-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icons/ora-192.png', '/icons/ora-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((cache) => cache.put(req, res.clone())).catch(() => undefined);
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = { body: event.data ? event.data.text() : 'A new O-RA Store update is available.' };
    }
    const title = String(payload.title || 'O-RA Store');
    const body = String(payload.body || 'A new store update is available.');
    const rawTarget = String(payload.url || '/');
    let target = '/';
    try {
      const url = new URL(rawTarget, self.location.origin);
      if (url.protocol === 'https:' || url.origin === self.location.origin) target = url.href;
    } catch {}
    await self.registration.showNotification(title, {
      body,
      icon: payload.icon || '/icons/ora-192.png',
      badge: payload.badge || '/icons/ora-192.png',
      tag: payload.tag || 'ora-store-update',
      data: { url: target },
    });
  })());
});


self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          try { client.navigate(target); } catch {}
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })
  );
});
