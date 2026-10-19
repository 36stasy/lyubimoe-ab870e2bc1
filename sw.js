/* Любимое тело: сначала сеть (обновления приходят сразу), без сети — последняя сохранённая копия. Версия 19.10.2026, 21:22 */
var CACHE = 'telo-v1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var fonts = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== self.location.origin && !fonts) return;
  var opts = (req.mode === 'navigate' || /\.(html|js|json|txt)$/.test(url.pathname)) ? { cache: 'reload' } : undefined;
  e.respondWith(
    fetch(req, opts).then(function (res) {
      if (res && (res.ok || res.type === 'opaque')) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./').then(function (r) { return r || caches.match('index.html'); });
        return Response.error();
      });
    })
  );
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) if ('focus' in list[i]) return list[i].focus();
    return clients.openWindow('./');
  }));
});
/* напоминания с Worker'а: вода, еда, «встать», утро и вечер */
self.addEventListener('push', function (e) {
  var d = { title: 'Любимое тело 🌿', body: 'Минутка для тебя', tag: 'telo' };
  try { if (e.data) d = Object.assign(d, e.data.json()); } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, tag: d.tag || 'telo', renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './' } }));
});
