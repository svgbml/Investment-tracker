/* Investeringstracker – vroeg: wat al vóór de eerste tekening klaar moet zijn
 *
 * Dit bestand staat in <head>, meteen na config.js. Het doet twee dingen:
 *  1. Thema, animaties, taal, leesbaarheid en pictogram uit deze browser toepassen. Dat stond eerst als
 *     script in index.html zelf, maar inline scripts mogen niet meer: de site heeft een veiligheidsbeleid
 *     (Content-Security-Policy) dat alleen bestanden van de site zelf toestaat.
 *  2. Het deel van dat beleid dat van jouw adressen afhangt: verbindingen alleen naar deze site en naar
 *     je eigen Worker (uit config.js of uit deze browser) en, bij een gedeelde weergave, naar de Worker
 *     van de ander. De vaste regels (geen scripts van buiten) staan als <meta> in index.html.
 *
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde.
 */
'use strict';

// Snelle start: de laatst getekende beginpagina alvast uit de browser halen, zodat js/15-prestaties.js hem meteen kan tonen.
// (Stond als inline script in index.html; dat mag niet meer door het veiligheidsbeleid.)
window.__snapRead=new Promise(function(ok){try{var r=indexedDB.open('tracker',1);r.onupgradeneeded=function(){try{r.result.createObjectStore('kv');}catch(e){}};r.onerror=function(){ok(null);};r.onsuccess=function(){try{var q=r.result.transaction('kv').objectStore('kv').get('home-snap');q.onsuccess=function(){ok(q.result);};q.onerror=function(){ok(null);};}catch(e){ok(null);}};}catch(e){ok(null);}});

// ---------- Thema en accentkleur (per apparaat) ----------
// tracker.theme: 'light', 'dark', 'amoled' of 'auto' (volgt het apparaat tussen licht en donker).
// Amoled is het donkere thema met een paar eigen kleuren: <html data-theme="dark" data-amoled="1">, zodat
// alle regels voor :root[data-theme="dark"] blijven gelden en style.css alleen het verschil hoeft te noemen.
// tracker.accent: een kleur als #RRGGBB (een van ACCENTS of een eigen kleur). De site leidt daar per thema
// de kleuren van af die op de pagina staan (zie accentVars).
var ACCENTS = [['blauw', '#2B5BD7'], ['petrol', '#0F766E'], ['paars', '#7C3AED'], ['oranje', '#C2410C'], ['cyaan', '#0E7490'], ['roze', '#DB2777']];
var ACCENT_BASIS = '#2B5BD7';
// Achtergronden waartegen de accentkleur leesbaar moet zijn (dezelfde als --page en --bg in style.css)
var THEME_GROUND = { light: ['#FFFFFF', '#F6F7F9'], dark: ['#14181F', '#0E1116'], amoled: ['#000000', '#0B0C0F'] };
function hexRgb(h) {
  var m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) return null;
  var n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbHex(c) { return '#' + c.map(function (x) { var s = Math.round(Math.max(0, Math.min(255, x))).toString(16); return s.length < 2 ? '0' + s : s; }).join('').toUpperCase(); }
function rgbMix(a, b, t) { return [0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * t; }); }
// Relatieve helderheid en contrast volgens WCAG 2.1
function rgbLum(c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
function rgbContrast(a, b) { var x = rgbLum(a), y = rgbLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
// De afgeleide kleuren voor één thema:
//  --accent       tekst, lijnen en knoppen; minstens 4,6:1 tegen de pagina en de lichte vlakken (WCAG AA)
//  --accent-dark  bij aanwijzen (in licht donkerder, in donker en amoled lichter)
//  --accent-soft  zachte variant voor balkjes en tweede lijnen
//  --accent-tint  heel licht vlak, zoals het pilletje achter het actieve menu-item
//  --on-accent    tekst op een vlak in de accentkleur (wit of bijna zwart, wat het best leest)
function accentVars(hex, theme) {
  var base = hexRgb(hex) || hexRgb(ACCENT_BASIS);
  var ground = (THEME_GROUND[theme] || THEME_GROUND.light).map(hexRgb);
  var dark = theme !== 'light';
  var to = dark ? [255, 255, 255] : [0, 0, 0];
  var ok = function (c) { return ground.every(function (g) { return rgbContrast(c, g) >= (dark ? 4.8 : 4.6); }); };
  var a = base;
  for (var i = 1; i <= 30 && !ok(a); i++) a = rgbMix(base, to, i * 0.03);
  var ink = [15, 18, 23], white = [255, 255, 255];
  return {
    '--accent': rgbHex(a),
    '--accent-dark': rgbHex(rgbMix(a, to, dark ? 0.3 : 0.25)),
    '--accent-soft': rgbHex(dark ? rgbMix(a, ground[0], 0.42) : rgbMix(a, white, 0.48)),
    '--accent-tint': 'rgba(' + a.map(Math.round).join(', ') + ', ' + (dark ? 0.18 : 0.1) + ')',
    '--on-accent': rgbContrast(white, a) >= rgbContrast(ink, a) ? '#FFFFFF' : '#0F1217',
  };
}
function accentPref() {
  var a = null;
  try { a = localStorage.getItem('tracker.accent'); } catch (e) { /* geen opslag */ }
  return hexRgb(a) ? '#' + String(a).replace('#', '').toUpperCase() : ACCENT_BASIS;
}
// Welk thema er nu echt staat: licht, donker of amoled (automatisch kiest licht of donker)
function themeNow() {
  var t = 'auto';
  try { t = localStorage.getItem('tracker.theme') || 'auto'; } catch (e) { /* geen opslag */ }
  if (t === 'light' || t === 'dark' || t === 'amoled') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
// Thema en accent op <html> zetten; ook gebruikt door applyTheme() in js/01-basis.js
function setThemeAttrs() {
  var r = document.documentElement, th = themeNow(), v = accentVars(accentPref(), th);
  r.dataset.theme = th === 'light' ? 'light' : 'dark';
  if (th === 'amoled') r.dataset.amoled = '1'; else delete r.dataset.amoled;
  for (var k in v) r.style.setProperty(k, v[k]);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_GROUND[th][0]);
  return th;
}

(function vroegeVoorkeuren() {
  try {
    setThemeAttrs();
    var m = localStorage.getItem('tracker.motion') || 'auto';
    document.documentElement.dataset.motion = (m === 'off' || (m === 'auto' && matchMedia('(prefers-reduced-motion: reduce)').matches)) ? 'off' : 'on';
    var l = localStorage.getItem('tracker.lang');
    if (l === 'en' || l === 'de' || l === 'fr') document.documentElement.lang = l;
    ['compact', 'big', 'cb'].forEach(function (k) { if (localStorage.getItem('tracker.' + k) === '1') document.documentElement.setAttribute('data-' + k, '1'); });
  } catch (e) { /* geen opslag: standaardweergave */ }
  try {
    var k = localStorage.getItem('tracker.icon');
    if (/^(lijn|donker|blauw|licht)$/.test(k || '')) {
      /** @type {HTMLLinkElement} */ (document.querySelector('link[rel="manifest"]')).href = 'manifest-' + k + '.webmanifest';
      /** @type {HTMLLinkElement} */ (document.querySelector('link[rel="apple-touch-icon"]')).href = 'icons/' + k + '-apple.png';
    }
  } catch (e) { /* niet erg */ }
})();

// Verbindingen beperken tot deze site en je eigen Worker. Browsers die een <meta> met het beleid pas
// accepteren tijdens het inlezen van de pagina, negeren dit stuk; de vaste regels in index.html gelden dan nog.
(function verbindingsbeleid() {
  try {
    var origins = [];
    var add = function (u) {
      if (!u) return;
      try {
        var o = new URL(String(u), location.href).origin;
        if (/^https:\/\//.test(o) && origins.indexOf(o) < 0) origins.push(o);
      } catch (e) { /* geen geldig adres */ }
    };
    var C = window.TRACKER_CONFIG || {};
    add(C.apiUrl);
    add(C.sheetUrl);
    try { add(localStorage.getItem('tracker.url')); } catch (e) { /* niet erg */ }
    // Gedeelde weergave: het adres van de Worker van de ander staat in het webadres (base64url)
    try {
      var g = new URLSearchParams(location.search).get('gedeeld') || '';
      var mm = /^([A-Za-z0-9_-]+)\./.exec(g);
      if (mm) {
        var b = mm[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b.length % 4) b += '=';
        add(atob(b));
      }
    } catch (e) { /* niet erg */ }
    var el = document.createElement('meta');
    el.setAttribute('http-equiv', 'Content-Security-Policy');
    el.setAttribute('content', "connect-src 'self' " + origins.join(' '));
    document.head.appendChild(el);
  } catch (e) { /* zonder dit beleid werkt de site gewoon, alleen minder streng */ }
})();
