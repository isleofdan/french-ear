// French ear's service worker. It exists so that Android offers "Install" and
// with it the Share target; it keeps nothing offline and changes no request.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  // Only this site's own GET requests; YouTube's player and the fonts go
  // straight from the page, untouched.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});
