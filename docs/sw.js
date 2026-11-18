/* Investeringstracker – service worker
 * Bewaart de bestanden van de website, zodat hij ook zonder verbinding opent.
 * Eerst het netwerk (zodat updates direct binnenkomen), bij geen verbinding de bewaarde versie.
 * Gegevens van de Worker (/api/data) gaan ook via het netwerk, maar worden apart bewaard: zonder verbinding
 * komt de laatst binnengekomen stand uit die opslag, met de kop X-Tracker-Cached erbij. De site bewaart
 * de laatste stand daarnaast zelf in IndexedDB.
 */
const CACHE = 'tracker-v57';
// Aparte opslag voor de gegevens van je Worker: die blijft staan als de site zelf een nieuwe versie krijgt
const API_CACHE = 'tracker-api-v1';
const FILES = ['./', './index.html', './style.css?v=57', './config.js?v=57', './manifest.webmanifest',
  './js/00-kern.js?v=57', './js/01-basis.js?v=57', './js/02-instellingen.js?v=57', './js/03-model.js?v=57', './js/04-grafieken.js?v=57', './js/05-portefeuille.js?v=57', './js/06-plannen.js?v=57', './js/07-onderzoek.js?v=57', './js/08-risico.js?v=57', './js/09-weergaven.js?v=57', './js/10-navigatie.js?v=57', './js/11-uitbreidingen.js?v=57', './js/12-nieuws.js?v=57', './js/13-app.js?v=57', './js/14-demo.js?v=57', './js/15-prestaties.js?v=57', './js/16-analyse.js?v=57', './js/17-markt.js?v=57', './js/18-gemak.js?v=57', './js/20-handel.js?v=57', './js/19-start.js?v=57',
  './js/nieuws-preact.js?v=57', './js/plannen-preact.js?v=57', './vendor/preact-htm.js', './fonts/figtree-latin.woff2', './fonts/figtree-latin-ext.woff2',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './icon-monochrome-512.png', './apple-touch-icon.png', './favicon.png'];

// Een nieuwe versie wacht tot de gebruiker op de site "Nu bijwerken" kiest (of alle vensters sluit)
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// ---------- Gegevens van je Worker: eerst het netwerk, zonder verbinding de laatst binnengekomen stand ----------
// De sleutel van de opslag bevat een korte vingerafdruk van de toegangscode, zodat een andere code op
// hetzelfde apparaat nooit de gegevens van de vorige te zien krijgt. De code zelf wordt niet bewaard.
// Komt het antwoord uit de opslag, dan staat er X-Tracker-Cached: 1 bij; de site zet dan de melding
// "geen verbinding, je ziet de laatst geladen stand" erbij in plaats van te doen alsof het verse gegevens zijn.
function apiCacheKey(req) {
  const t = req.headers.get('Authorization') || '';
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return req.url + (req.url.includes('?') ? '&' : '?') + 'swk=' + (h >>> 0).toString(36);
}
async function apiData(req) {
  const key = apiCacheKey(req);
  const delta = new URL(req.url).searchParams.has('since'); // alleen de nieuwe regels: offline waardeloos
  try {
    const res = await fetch(req);
    if (res.ok && !delta) { const copy = res.clone(); caches.open(API_CACHE).then((c) => c.put(key, copy)).catch(() => {}); }
    return res;
  } catch (err) {
    const hit = await caches.open(API_CACHE).then((c) => c.match(key)).catch(() => null);
    if (!hit || delta) throw err;
    const h = new Headers(hit.headers);
    h.set('X-Tracker-Cached', '1');
    return new Response(await hit.blob(), { status: 200, statusText: 'OK (bewaard)', headers: h });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/\/api\/data$/.test(url.pathname)) { e.respondWith(apiData(req)); return; }
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit || caches.match('./index.html')))
  );
});

// Meldingen van je Worker (Web Push): tonen, en bij een klik de tracker op de juiste pagina openen
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { body: e.data ? e.data.text() : '' }; }
  // Stip op het app-icoon tot je de app opent
  try { if (self.navigator && self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => {}); } catch (err) { /* niet ondersteund */ }
  e.waitUntil(self.registration.showNotification(m.title || 'Investeringstracker', {
    body: m.body || '', tag: m.tag || undefined, icon: './icon-192.png', badge: './favicon.png', data: { url: m.url || '' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL('./' + (e.notification.data && e.notification.data.url ? e.notification.data.url : ''), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (open) { open.focus(); return open.navigate ? open.navigate(target) : null; }
    return self.clients.openWindow(target);
  }));
});
