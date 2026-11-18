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

(function vroegeVoorkeuren() {
  try {
    var t = localStorage.getItem('tracker.theme') || 'auto';
    document.documentElement.dataset.theme = (t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)) ? 'dark' : 'light';
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
