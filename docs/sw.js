/* Investeringstracker – service worker
 * Bewaart de bestanden van de website, zodat hij ook zonder verbinding opent.
 * Eerst het netwerk (zodat updates direct binnenkomen), bij geen verbinding de bewaarde versie.
 * Gegevens van de Worker (/api/data) gaan ook via het netwerk, maar worden apart bewaard: zonder verbinding
 * komt de laatst binnengekomen stand uit die opslag, met de kop X-Tracker-Cached erbij. De site bewaart
 * de laatste stand daarnaast zelf in IndexedDB.
 */
const CACHE = 'tracker-v58';
// Aparte opslag voor de gegevens van je Worker: die blijft staan als de site zelf een nieuwe versie krijgt
const API_CACHE = 'tracker-api-v1';
const FILES = ['./', './index.html', './style.css?v=58', './config.js?v=58', './manifest.webmanifest',
  './js/00-vroeg.js?v=58', './js/00-kern.js?v=58', './js/01-basis.js?v=58', './js/02-instellingen.js?v=58', './js/03-model.js?v=58', './js/04-grafieken.js?v=58', './js/05-portefeuille.js?v=58', './js/06-plannen.js?v=58', './js/07-onderzoek.js?v=58', './js/08-risico.js?v=58', './js/09-weergaven.js?v=58', './js/10-navigatie.js?v=58', './js/11-uitbreidingen.js?v=58', './js/12-nieuws.js?v=58', './js/13-app.js?v=58', './js/14-demo.js?v=58', './js/15-prestaties.js?v=58', './js/15-ui.js?v=58', './js/15-risico-analyse.js?v=58', './js/15-toon.js?v=58', './js/15-bronnen.js?v=58', './js/16-analyse.js?v=58', './js/17-markt.js?v=58', './js/18-gemak.js?v=58', './js/20-handel.js?v=58', './js/21-toegankelijk.js?v=58', './js/21-privacy.js?v=58', './js/21-markt-extra.js?v=58', './js/22-handel-extra.js?v=58', './js/21-plannen2.js?v=58', './js/21-nieuwsplus.js?v=58', './js/26-posities.js?v=58', './js/27-volglijst.js?v=58', './js/28-tickerkaart.js?v=58', './js/21-overzicht.js?v=58', './js/21-handig.js?v=58', './js/19-start.js?v=58', './js/21-galerij.js?v=58', './js/21-pwa.js?v=58',
  './js/nieuws-preact.js?v=58', './js/plannen-preact.js?v=58', './vendor/preact-htm.js', './fonts/figtree-latin.woff2', './fonts/figtree-latin-ext.woff2',
  './widget-vandaag.json', './widget-vandaag-data.json',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './icon-monochrome-512.png', './apple-touch-icon.png', './favicon.png'];

// Een nieuwe versie wacht tot de gebruiker op de site "Nu bijwerken" kiest (of alle vensters sluit)
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip') self.skipWaiting();
  const m = e.data && typeof e.data === 'object' ? e.data : null;
  if (m && m.type === 'widget') e.waitUntil(saveWidget(m.data).then(() => widgetPush()));
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


// ---------- Widget "Vandaag" op het beginscherm (waar de browser widgets ondersteunt) ----------
// De site stuurt hier al opgemaakte tekst naartoe (dus met de keuze "bedragen verbergen" erin verwerkt);
// die bewaren we in dezelfde IndexedDB als de laatste stand, zodat de widget ook zonder open venster iets toont.
const WIDGET_TAG = 'vandaag';
function swIdb(fn) {
  return new Promise((ok, no) => {
    if (!self.indexedDB) { no(new Error('geen IndexedDB')); return; }
    const r = self.indexedDB.open('tracker', 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore('kv'); } catch (e) { /* bestaat al */ } };
    r.onsuccess = () => { try { fn(r.result, ok, no); } catch (e) { no(e); } };
    r.onerror = () => no(r.error);
  });
}
const saveWidget = (d) => swIdb((db, ok, no) => {
  const t = db.transaction('kv', 'readwrite');
  t.objectStore('kv').put(d, 'widget');
  t.oncomplete = () => ok();
  t.onerror = () => no(t.error);
}).catch(() => {});
const readWidget = () => swIdb((db, ok, no) => {
  const q = db.transaction('kv').objectStore('kv').get('widget');
  q.onsuccess = () => ok(q.result || null);
  q.onerror = () => no(q.error);
}).catch(() => null);

async function widgetPush() {
  const w = self.widgets;
  if (!w) return;
  try {
    const inst = await w.getByTag(WIDGET_TAG);
    if (!inst) return;
    const d = await readWidget();
    if (!d) return;
    await w.updateByTag(WIDGET_TAG, { data: JSON.stringify(d) });
  } catch (e) { /* widget nog niet geplaatst of niet ondersteund */ }
}
self.addEventListener('widgetinstall', (e) => e.waitUntil(widgetPush()));
self.addEventListener('widgetresume', (e) => e.waitUntil(widgetPush()));
self.addEventListener('widgetclick', (e) => {
  const target = new URL('./#vandaag', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (open) { open.focus(); return open.navigate ? open.navigate(target) : null; }
    return self.clients.openWindow(target);
  }));
});

// ---------- Achtergrondsync: instellingen die zonder verbinding zijn opgeslagen ----------
// De service worker heeft zelf geen toegangscode, dus hij kan niet opslaan; hij maakt een open venster wakker
// dat het alsnog naar de Worker stuurt. Is er geen venster, dan gebeurt het bij de volgende keer openen.
self.addEventListener('sync', (e) => {
  if (e.tag !== 'tracker-prefs') return;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => { list.forEach((c) => c.postMessage({ type: 'flush-prefs' })); }));
});
