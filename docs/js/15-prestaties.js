/* Investeringstracker – Prestaties: snelle start (laatst getekende beginpagina direct tonen) en een
 * verborgen meetpaneel met de tekentijd per weergave (adres met ?perf).
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Snelle start ----------
// Na een geslaagde tekening bewaart de site de HTML van de beginpagina in IndexedDB. Bij de volgende start
// staat die er meteen, nog voordat de gegevens zijn geladen en doorgerekend; zodra de echte tekening klaar is,
// vervangt die hem. De bewaarde HTML hoort bij één bron én toegangscode, één weergave (desktop of telefoon),
// één taal, één thema en één stand van "bedragen verbergen"; past iets daarvan niet, dan wordt hij niet gebruikt.
const SNAP_KEY = 'home-snap';
// De voorbeeldweergave zet demo pas aan in js/19-start.js; hier lezen we het adres zelf
const SNAP_DEMO = new URLSearchParams(location.search).has('demo');
const snapDemo = () => demo || SNAP_DEMO;
const SNAP_MAX_AGE = 14 * DAY;
let snapShown = false;      // er staat nu een bewaarde tekening op het scherm
let snapClearTimer = null;
let snapSaveTimer = null;
let snapPaintAt = null;     // hoe snel de bewaarde tekening op het scherm stond (ms na start)
let snapFirstPaint = false; // de beginpagina stond er al: hij hoeft niet nog een keer binnen te komen
// Eenmalig antwoord voor js/10-navigatie.js: moet de eerste pagina nog met een animatie binnenkomen?
function snapTookOver() { const v = snapFirstPaint; snapFirstPaint = false; return v; }

// Korte vingerafdruk van bron en toegangscode: zo komt de tekening van de ene tracker nooit bij een andere
// (of bij iemand anders die daarna op hetzelfde apparaat inlogt) in beeld. De code zelf wordt niet bewaard.
function snapFingerprint() {
  const src = snapDemo() ? 'demo' : (getUrl() || '-') + '|' + (getToken() || '-');
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function snapStamp() {
  const r = document.documentElement;
  return [VERSION, snapFingerprint(), mode, hideAmounts ? 'verborgen' : 'zichtbaar', LANG, r.dataset.theme || '',
    ['compact', 'big', 'cb'].map((k) => (r.getAttribute('data-' + k) === '1' ? k : '')).join('')].join('|');
}
const snapHost = () => (mode === 'm' ? $('m-home') : $('page-home'));

// Mag er een bewaarde tekening worden getoond? Niet bij een gedeelde weergave, niet zonder koppeling,
// en niet als het adres meteen een andere pagina of een bedrijf opent.
function snapUsable() {
  if (sharedView || data) return false;
  if (!snapDemo() && !getToken()) return false;
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  return h === '' || h === 'overzicht';
}

async function paintSnap() {
  if (!snapUsable()) return;
  let o = null;
  // index.html begint het ophalen al in de kop; is dat gelukt, dan staat de tekening hier meteen klaar
  try { o = window.__snapRead ? await window.__snapRead : await idbGet(SNAP_KEY); } catch (e) { return; }
  if (!o || o.stamp !== snapStamp() || !o.html) return;
  if (Date.now() - (o.saved || 0) > SNAP_MAX_AGE) return;
  if (!snapUsable()) return;  // in de tussentijd kwamen de echte gegevens al binnen
  const host = snapHost();
  if (!host) return;
  $('welcome').hidden = true;
  document.body.classList.remove('welcoming');
  $('app').hidden = false;
  $('m-main').hidden = false;
  $('demo-banner').hidden = !snapDemo();
  // De balk met knoppen (instellingen, vernieuwen, bedragen verbergen) staat op de computer in de beginpagina.
  // Eerst eruit halen: de bewaarde tekening zou hem anders vervangen door een kopie zonder werkende knoppen.
  const bar = document.querySelector('#shell .topbar');
  if (bar && host.contains(bar)) $('shell').prepend(bar);
  host.innerHTML = o.html;
  host.querySelectorAll('.topbar').forEach((x) => x.remove());   // oudere tekeningen bevatten nog zo'n kopie
  if (typeof placeDeskNav === 'function') placeDeskNav();
  host.dataset.snap = '1';
  host.setAttribute('aria-busy', 'true');
  snapShown = true;
  snapFirstPaint = true;
  snapPaintAt = performance.now();
  // Mocht het laden mislukken, dan blijft de tekening niet eeuwig "bezig"
  clearTimeout(snapClearTimer);
  snapClearTimer = setTimeout(snapClear, 2500);
  if (typeof perfPanelSoon === 'function') perfPanelSoon();
}

// De echte tekening staat er: de bewaarde tekening is geen tussenstand meer
function snapClear() {
  clearTimeout(snapClearTimer);
  if (!snapShown) return;
  snapShown = false;
  ['page-home', 'm-home'].forEach((id) => { const el = $(id); if (!el) return; delete el.dataset.snap; el.removeAttribute('aria-busy'); });
}

// Na een tekening de beginpagina bewaren, maar pas als het inklappen klaar is (anders bewaren we halve hoogtes)
function snapSoon() {
  if (sharedView) return;
  if (!snapDemo() && !getToken()) return;
  clearTimeout(snapSaveTimer);
  snapSaveTimer = setTimeout(saveSnap, 1200);
}
async function saveSnap() {
  if (ui.page !== 'home' || ui.detail) return;   // alleen de beginpagina, en niet terwijl een bedrijf open staat
  const host = snapHost();
  if (!host || host.hidden || !host.innerHTML) return;
  // Zonder de balk met knoppen: die moet bij de volgende start de echte blijven
  const copy = /** @type {Element} */ (host.cloneNode(true));
  copy.querySelectorAll('.topbar').forEach((x) => x.remove());
  try { await idbSet(SNAP_KEY, { stamp: snapStamp(), saved: Date.now(), html: copy.innerHTML }); }
  catch (e) { /* geen IndexedDB of vol: dan gewoon zonder snelle start */ }
}
function snapForget() { snapShown = false; idbDel(SNAP_KEY); }

paintSnap();

// ---------- Meetpaneel (?perf): tekentijd per weergave ----------
// Verborgen hulpmiddel om te zien of een wijziging het tekenen sneller of langzamer maakt.
const PERF_ON = new URLSearchParams(location.search).has('perf');
let perfFirstAt = null, perfBox = null, perfTimer = null;
function perfPanelSoon() {
  if (perfFirstAt == null) perfFirstAt = performance.now();
  if (!PERF_ON) return;
  clearTimeout(perfTimer);
  perfTimer = setTimeout(drawPerf, 120);
}
function perfRows() {
  const nav = /** @type {PerformanceNavigationTiming} */ (performance.getEntriesByType('navigation')[0]);
  const res = /** @type {PerformanceResourceTiming[]} */ (performance.getEntriesByType('resource')).filter((x) => /\.js(\?|$)/.test(x.name));
  const ms = (v) => (v == null ? '–' : N1.format(v) + ' ms');
  return [
    ['Eerste tekening na', ms(perfFirstAt)],
    ['Snelle start na', snapPaintAt == null ? 'niet gebruikt' : ms(snapPaintAt)],
    ['Pagina gereed na', ms(nav ? nav.domContentLoadedEventEnd : null)],
    ['Scripts', Math.round(res.reduce((s, x) => s + (x.transferSize || x.encodedBodySize || 0), 0) / 1024) + ' kB in ' + res.length + ' bestanden'],
    ['DOM-knopen', NI.format(document.querySelectorAll('*').length)],
  ];
}
function drawPerf() {
  if (!PERF_ON) return;
  if (!perfBox) {
    perfBox = document.createElement('aside');
    perfBox.className = 'perf-panel';
    perfBox.setAttribute('role', 'status');
    document.body.appendChild(perfBox);
  }
  const rows = [...PERF.entries()].sort((a, b) => b[1].last - a[1].last);
  perfBox.innerHTML = '<div class="perf-head"><b>Prestaties</b><span>' + esc(mode === 'm' ? 'telefoon' : 'desktop') + '</span>' +
    '<button type="button" class="linklike" data-perf="again">Opnieuw meten</button><button type="button" class="linklike" data-perf="off">Sluiten</button></div>' +
    '<table><thead><tr><th>Weergave</th><th class="num">laatst</th><th class="num">gem.</th><th class="num">max</th><th class="num">keer</th></tr></thead><tbody>' +
    (rows.length ? rows.map(([n, r]) => '<tr><td>' + esc(n) + '</td><td class="num">' + esc(N1.format(r.last)) + '</td><td class="num">' + esc(N1.format(r.tot / r.n)) +
      '</td><td class="num">' + esc(N1.format(r.max)) + '</td><td class="num">' + r.n + '</td></tr>').join('') : '<tr><td colspan="5">Nog niets getekend.</td></tr>') +
    '</tbody></table><dl class="perf-kv">' + perfRows().map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>' +
    '<p class="perf-note">Tijd in milliseconden per tekening van een weergave. Alleen zichtbaar met ?perf in het adres.</p>';
}
if (PERF_ON) {
  document.addEventListener('click', (e) => {
    const t = /** @type {Element} */ (e.target);
    const b = t && t.closest ? t.closest('[data-perf]') : null;
    if (!b) return;
    if (/** @type {HTMLElement} */ (b).dataset.perf === 'off') { if (perfBox) { perfBox.remove(); perfBox = null; } return; }
    PERF.clear();
    const t0 = performance.now();
    renderAll();
    perfNote('renderAll', performance.now() - t0);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'P' && e.shiftKey && e.ctrlKey) drawPerf(); });
  drawPerf();
}
