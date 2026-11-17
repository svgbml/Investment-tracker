/* Investeringstracker – service worker
 * Bewaart de bestanden van de website, zodat hij ook zonder verbinding opent.
 * Eerst het netwerk (zodat updates direct binnenkomen), bij geen verbinding de bewaarde versie.
 * Gegevens van de Worker gaan hier niet doorheen; de laatste stand bewaart de site zelf in de browser.
 */
const CACHE = 'tracker-v36';
const FILES = ['./', './index.html', './style.css?v=36', './config.js?v=36', './manifest.webmanifest',
  './js/00-kern.js?v=36', './js/01-basis.js?v=36', './js/02-instellingen.js?v=36', './js/03-model.js?v=36', './js/04-grafieken.js?v=36', './js/05-portefeuille.js?v=36', './js/06-plannen.js?v=36', './js/07-onderzoek.js?v=36', './js/08-risico.js?v=36', './js/09-weergaven.js?v=36', './js/10-navigatie.js?v=36', './js/11-uitbreidingen.js?v=36', './js/12-nieuws.js?v=36', './js/13-app.js?v=36', './js/14-demo.js?v=36', './js/15-start.js?v=36',
  './js/nieuws-preact.js?v=36', './vendor/preact-htm.js',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon.png'];

// Een nieuwe versie wacht tot de gebruiker op de site "Nu bijwerken" kiest (of alle vensters sluit)
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit || caches.match('./index.html')))
  );
});
