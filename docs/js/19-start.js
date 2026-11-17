/* Investeringstracker – Installeren als app en starten
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

planEvents($('plan-body'));
planEvents($('m-plan-body'));

// ---------- Installeren als app ----------
let installEvt = null, installOffered = false;
const installBtns = () => [$('btn-install')].concat($$('.btn-install-top'));
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; installOffered = true; installBtns().forEach((b) => { b.hidden = false; }); });
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

// ---------- Controle voor installeren: wat de browser op dit apparaat over de app zegt ----------
// Geen gegevens van je portefeuille; alleen browser, service worker, manifest en meldingen, om te kunnen zien waarom installeren niet lukt.
let installCheckText = '';
// Sommige filters (adblockers met een VPN, zoals AdGuard) halen de manifest-verwijzing uit de pagina; zonder die verwijzing
// kan Chrome de app niet installeren. Ontbreekt hij, dan zetten we hem zelf terug.
let manifestRestored = false;
function ensureManifest() {
  if (document.querySelector('link[rel="manifest"]')) return;
  const l = document.createElement('link');
  l.rel = 'manifest'; l.href = 'manifest.webmanifest';
  document.head.appendChild(l);
  manifestRestored = true;
}
ensureManifest();
new MutationObserver(ensureManifest).observe(document.head, { childList: true });
async function installCheck() {
  const rows = [];
  const add = (k, v, ok) => rows.push([k, v, ok == null ? '' : ok ? 'gain' : 'loss']);
  const ua = navigator.userAgent;
  const chrome = /Chrome\/(\d+)/.exec(ua), android = /Android ([\d.]+)/.exec(ua);
  add('Browser', (chrome ? 'Chrome ' + chrome[1] : /Safari/.test(ua) ? 'Safari' : 'onbekend') + (android ? ' op Android ' + android[1] : /iPhone|iPad/.test(ua) ? ' op iOS' : ''), null);
  add('Beveiligde verbinding (https)', location.protocol === 'https:' || location.hostname === 'localhost' ? 'ja' : 'nee', location.protocol === 'https:' || location.hostname === 'localhost');
  add('Al als app geopend', matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'ja' : 'nee', null);
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    add('Service worker', !reg ? 'niet geregistreerd' : (reg.active ? 'actief' : 'nog niet actief') + (reg.waiting ? ', update wacht' : '') + (navigator.serviceWorker.controller ? ', bestuurt deze pagina' : ', bestuurt deze pagina nog niet'), !!(reg && reg.active));
  } catch (e) { add('Service worker', 'fout: ' + e.message, false); }
  try {
    const link = /** @type {HTMLLinkElement} */ (document.querySelector('link[rel="manifest"]'));
    add('Manifest-verwijzing in de pagina', link ? (manifestRestored ? 'was weggehaald, door de site teruggezet' : 'aanwezig') : 'ontbreekt', !!link);
    const href = link ? link.href : new URL('manifest.webmanifest', location.href).href;
    const m = await (await fetch(href, { cache: 'no-store' })).json();
    const icons = (m.icons || []).map((i) => i.sizes + (i.purpose && i.purpose !== 'any' ? ' ' + i.purpose : ''));
    const okIcons = (m.icons || []).some((i) => /192/.test(i.sizes)) && (m.icons || []).some((i) => /512/.test(i.sizes));
    add('Manifest', (m.name ? 'naam, ' : 'GEEN naam, ') + 'weergave ' + m.display + ', start ' + m.start_url + ', id ' + (m.id || '–'), !!m.name && /standalone|fullscreen|minimal-ui/.test(m.display));
    const res = await Promise.all((m.icons || []).map((i) => fetch(new URL(i.src, href)).then((r) => r.ok).catch(() => false)));
    add('Iconen', icons.join(', ') + (res.every(Boolean) ? ', alle bereikbaar' : ', NIET alle bereikbaar'), okIcons && res.every(Boolean));
  } catch (e) { add('Manifest', 'niet te lezen: ' + e.message, false); }
  const filters = [...document.querySelectorAll('script[src], style, link[rel="stylesheet"]')].map((x) => /** @type {any} */ (x).src || /** @type {any} */ (x).href || x.textContent.slice(0, 200)).filter((t) => /adguard|ublock|adblock/i.test(t || ''));
  add('Adblocker of filter in de pagina', filters.length ? 'ja (' + (/adguard/i.test(filters.join(' ')) ? 'AdGuard' : 'onbekend') + ')' : 'niet gezien', filters.length ? false : null);
  add('Chrome bood installeren aan', installOffered ? 'ja (knop Installeren hierboven)' : 'nee (nog niet)', installOffered ? true : null);
  add('Meldingen', !('Notification' in window) ? 'niet ondersteund in deze weergave' : Notification.permission === 'granted' ? 'toegestaan' : Notification.permission === 'denied' ? 'geweigerd (zet ze aan in de site-instellingen van je browser)' : 'nog niet gevraagd', 'Notification' in window ? Notification.permission !== 'denied' : null);
  add('Push', 'PushManager' in window ? 'ondersteund' : 'niet ondersteund', 'PushManager' in window);
  add('Versie van de site', VERSION, null);
  const host = $('install-check-body');
  if (host) host.innerHTML = kvList(rows) + '<p class="muted small" style="margin-top:6px">Ziet alles er groen uit en zegt Chrome toch "kan niet worden geïnstalleerd", dan ligt het aan de telefoon: Chrome bijwerken, Google Play-services, of toestemming voor Chrome om apps te installeren.</p>';
  installCheckText = rows.map((r) => r[0] + ': ' + r[1]).join('\n');
}
const ic = /** @type {HTMLDetailsElement} */ ($('install-check'));
if (ic) ic.addEventListener('toggle', () => { if (ic.open) installCheck(); });
document.addEventListener('click', async (e) => {
  const t = /** @type {Element} */ (e.target);
  const b = t.closest && t.closest('[data-install-copy]');
  if (!b) return;
  if (!installCheckText) await installCheck();
  try { await navigator.clipboard.writeText(installCheckText); b.textContent = 'Gekopieerd'; } catch (err) { b.textContent = 'Kopiëren lukte niet'; }
});

// ---------- Start ----------
if (new URLSearchParams(location.search).has('demo')) demo = true;
applyMode();
placeIndicators();
load();
