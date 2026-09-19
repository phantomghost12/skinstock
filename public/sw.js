// sw.js
// Self-destructing. An earlier version of this file cached the app shell
// (index.html, app.js, styles.css) and served it back on every visit even
// after updates — meaning updates could get permanently stuck invisible.
// That's worse than no caching at all for an app that only ever runs
// against your own local server, so this version removes itself entirely:
// it deletes every cache it created, unregisters itself, and forces an
// immediate reload so you're guaranteed to see the real, current files
// straight from the server from now on.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.navigate(client.url));
    })()
  );
});
