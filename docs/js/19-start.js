/* Investeringstracker – Installeren als app en starten
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

planEvents($('plan-body'));
planEvents($('m-plan-body'));

// ---------- Installeren als app ----------
let installEvt = null;
const installBtns = () => [$('btn-install')].concat($$('.btn-install-top'));
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; installBtns().forEach((b) => { b.hidden = false; }); });
window.addEventListener('appinstalled', () => { installEvt = null; installBtns().forEach((b) => { b.hidden = true; }); $('install-text').textContent = 'De tracker staat als app op dit apparaat.'; });
installBtns().forEach((btn) => btn.addEventListener('click', async () => {
  if (!installEvt) { openSettings(false); $('install-box').scrollIntoView({ block: 'nearest' }); return; }
  installEvt.prompt();
  await installEvt.userChoice.catch(() => null);
  installEvt = null; installBtns().forEach((b) => { b.hidden = true; });
}));
(function installHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) $('install-text').textContent = 'Je gebruikt de tracker nu als app.';
  else if (ios) $('install-text').textContent = 'Op iPhone of iPad: tik in Safari op de deelknop en kies “Zet op beginscherm”. De app toont zonder verbinding de laatst geladen stand.';
})();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').then(watchSw).catch(() => {}); });
}

// ---------- Start ----------
if (new URLSearchParams(location.search).has('demo')) demo = true;
applyMode();
placeIndicators();
load();
