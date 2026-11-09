const cacheName = 'hallway-shell-v1';
const shell = '/';
const icons = ['/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const response = await fetch(shell, { cache: 'reload' });
    if (!response.ok) throw new Error('App shell is unavailable');
    const html = await response.clone().text();
    const assets = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g), match => match[1]);
    await cache.addAll([...icons, ...assets]);
    await cache.put(shell, response);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('hallway-shell-') && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match(shell)) || Response.error()));
    return;
  }
  if (!url.pathname.startsWith('/assets/') && !icons.includes(url.pathname)) return;
  event.respondWith((async () => {
    const hit = await caches.match(event.request);
    if (hit) return hit;
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(event.request, response.clone());
    }
    return response;
  })());
});
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  event.waitUntil(self.registration.showNotification(data.title || 'Hallway Quest', {
    body: data.body || 'You have a conference reminder.',
    icon: '/icon-192.png', tag: 'hallway-reminder',
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows[0]) await windows[0].focus();
    else await self.clients.openWindow('/');
  })());
});
