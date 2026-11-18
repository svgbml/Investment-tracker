/* Investeringstracker – App en apparaat: de weergave Vandaag (en de widget op het beginscherm), snelkoppelingen,
 * een melding als je de bewaarde stand ziet, voorkeuren die wachten op verbinding, één teller voor ongelezen
 * meldingen, delen naar je volglijst, trilling op de telefoon en vergrendelen met vingerafdruk of gezicht.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// Niet-standaard onderdelen van de browser (trillen, app-teller, widgets, WebAuthn) via één losse verwijzing,
// zodat de typecontrole niet over ontbrekende namen valt en een browser zonder die onderdelen gewoon doorgaat.
const nav2 = /** @type {any} */ (navigator);
const win2 = /** @type {any} */ (window);

// ---------- Trilling op de telefoon (staat standaard uit) ----------
const LS_HAPTIC = 'tracker.trillen';
const HAPTIC_PAT = { tik: 8, aan: 14, order: [16, 40, 24], fout: [30, 60, 30] };
const hapticAble = () => typeof nav2.vibrate === 'function';
const hapticOn = () => { try { return localStorage.getItem(LS_HAPTIC) === '1'; } catch (e) { return false; } };
// Korte trilling; uit bij "minder beweging" en als de instelling uit staat
function haptic(kind) {
  if (!hapticOn() || reduceMotion() || !hapticAble()) return;
  try { nav2.vibrate(HAPTIC_PAT[kind] || HAPTIC_PAT.tik); } catch (e) { /* niet ondersteund */ }
}
const HAPTIC_SEL = '.btn-hide, .seg button, .m-seg button, [data-sectab], [data-lpane], .fold-btn, [data-theme-pick], [data-motion-pick], [data-disp], .m-tabs a, .pillnav a, [data-icon-pick]';
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  if (t && t.closest && t.closest(HAPTIC_SEL)) haptic('tik');
}, true);
document.addEventListener('change', (e) => {
  const t = /** @type {any} */ (e.target);
  if (t && t.matches && t.matches('input[type="checkbox"], input[type="radio"]')) haptic('tik');
}, true);

// ---------- Ongelezen meldingen: één teller voor het app-pictogram en het menu ----------
// Nieuw nieuws over je posities en volglijst, plus koersalarmen die afgingen sinds je het nieuws las.
function unreadCount(seen) {
  if (!M || !data) return 0;
  const keys = new Set(M.companies.map((c) => c.tk).concat(watchSyms()));
  let n = 0;
  Object.keys(data.research || {}).forEach((tk) => {
    if (!keys.has(tk)) return;
    const r = data.research[tk];
    ((r && r.news) || []).forEach((x) => { if (x.t > seen && !newsMuted(x)) n++; });
  });
  n += ((M.settings && M.settings.priceAlerts) || []).filter((a) => a.hit && Date.parse(a.hit) > seen).length;
  return n;
}
function syncUnread() {
  if (!M) return 0;
  let seen = 0;
  try { seen = Number(localStorage.getItem(LS_SEEN) || 0); } catch (e) { seen = 0; }
  if (ui.page === 'news' || !seen) {
    const now = Date.now();
    // In de voorbeeldweergave twee dagen terugkijken, zodat je de teller ook zonder eigen gegevens ziet werken
    seen = demo && ui.page !== 'news' ? now - 2 * DAY : now;
    if (!demo) { try { localStorage.setItem(LS_SEEN, String(seen)); } catch (e) { /* niet erg */ } }
  }
  const n = Math.min(99, unreadCount(seen));
  $$('.pillnav a[data-page="news"], .m-tabs a[data-page="news"]').forEach((a) => {
    if (n) { a.dataset.unread = String(n); a.setAttribute('aria-label', 'Nieuws, ' + n + ' ongelezen'); }
    else { delete a.dataset.unread; a.removeAttribute('aria-label'); }
  });
  try { if (nav2.setAppBadge) (n ? nav2.setAppBadge(n) : nav2.clearAppBadge()).catch(() => {}); } catch (e) { /* niet ondersteund */ }
  return n;
}

// ---------- Zonder verbinding: melding met de ouderdom van de stand ----------
let cacheStand = null;    // moment waarop de stand die je ziet is bewaard (null = net geladen van de Worker)
let noticeOff = false;    // melding weggeklikt
function agoText(t) {
  if (!isNum(t)) return 'onbekend hoe oud';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'van net';
  if (m < 60) return 'van ' + m + (m === 1 ? ' minuut' : ' minuten') + ' geleden';
  const h = Math.round(m / 60);
  if (h < 24) return 'van ' + h + (h === 1 ? ' uur' : ' uur') + ' geleden';
  const d = Math.round(h / 24);
  return 'van ' + d + (d === 1 ? ' dag' : ' dagen') + ' geleden';
}
const dataStamp = () => (data && data.generated ? Date.parse(data.generated) : cacheStand);
function offlineNote() {
  const el = $('offline-banner');
  if (!el) return;
  const off = !nav2.onLine;
  if (noticeOff || sharedView || !data || (!off && cacheStand == null && !prefsWait)) { el.hidden = true; return; }
  const stamp = dataStamp();
  el.innerHTML = String(tpl`<b>${demo ? 'Voorbeeld: bewaarde stand' : off ? 'Geen verbinding' : 'Bewaarde stand'}</b> Je ziet de laatst bewaarde stand, ${agoText(stamp)}${isNum(stamp) ? ' (' + fDT.format(stamp) + ')' : ''}.${prefsWait ? ' ' + (prefsWait === 1 ? 'Eén instelling wacht op verbinding.' : prefsWait + ' instellingen wachten op verbinding.') : ''}
    <button type="button" class="btn primary" data-off="retry">Opnieuw proberen</button><button type="button" class="linklike" data-off="hide">Verbergen</button>`);
  el.hidden = false;
}
// De stand komt uit de bewaarde kopie in deze browser
function noteCacheData(saved) { cacheStand = isNum(saved) ? saved : Date.now(); offlineNote(); }
// Er zijn net nieuwe gegevens van de Worker binnengekomen
function noteLiveData() { cacheStand = null; noticeOff = false; offlineNote(); flushPrefsQueue(); }
function noteOffline() { offlineNote(); }
document.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement|null} */ ((/** @type {Element} */ (e.target)).closest ? /** @type {Element} */ (e.target).closest('[data-off]') : null);
  if (!b) return;
  if (b.dataset.off === 'hide') { noticeOff = true; offlineNote(); return; }
  noticeOff = false;
  if (demo) cacheStand = null;   // in de voorbeeldweergave is er niets op te halen
  load();
});
window.addEventListener('online', () => { offlineNote(); flushPrefsQueue(); load(); });
window.addEventListener('offline', () => offlineNote());
setInterval(() => { if (!$('offline-banner').hidden) offlineNote(); }, 30000);

// ---------- Voorkeuren die je zonder verbinding opslaat, gaan later alsnog naar de Worker ----------
const IDB_PREFS_Q = 'prefsQueue';
let prefsWait = 0;
let prefsBusy = false;
async function prefsQueue() { try { const q = await idbGet(IDB_PREFS_Q); return Array.isArray(q) ? q : []; } catch (e) { return []; } }
// Geeft true als de wijziging in de wachtrij staat; dan hoeft de aanroeper geen fout te laten zien
async function queuePrefsOffline(patch, err) {
  if (demo || sharedView) return false;
  if (nav2.onLine && !(err instanceof TypeError)) return false;
  const q = await prefsQueue();
  q.push({ at: Date.now(), patch });
  try { await idbSet(IDB_PREFS_Q, q.slice(-40)); } catch (e) { return false; }
  prefsWait = q.length;
  // De keuze alvast in de weergave zetten, zodat hij niet terugspringt
  if (M) M.settings = Object.assign({}, M.settings, { prefs: Object.assign({}, userPrefs(), patch) });
  offlineNote();
  try { const reg = await navigator.serviceWorker.ready; if (/** @type {any} */ (reg).sync) await /** @type {any} */ (reg).sync.register('tracker-prefs'); } catch (e) { /* geen achtergrondsync: dan bij de volgende verbinding */ }
  return true;
}
async function flushPrefsQueue() {
  if (prefsBusy || demo || sharedView || !M || !nav2.onLine) return;
  const q = await prefsQueue();
  prefsWait = q.length;
  if (!q.length) { offlineNote(); return; }
  prefsBusy = true;
  try {
    const merged = q.reduce((acc, x) => Object.assign(acc, x.patch), Object.assign({}, userPrefs()));
    await saveSettings({ prefs: merged });
    await idbSet(IDB_PREFS_Q, []);
    prefsWait = 0;
    offlineNote();
    rerenderAll();
  } catch (e) { /* blijft staan tot de volgende poging */ }
  finally { prefsBusy = false; }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = /** @type {any} */ (e.data) || {};
    if (m.type === 'flush-prefs') flushPrefsQueue();
  });
}

// ---------- Vandaag: korte weergave voor het beginscherm, en de widget ----------
// Pseudo-detailpagina's uit dit bestand (renderDetail in js/09-weergaven.js kijkt hier)
const PSEUDO_VIEWS = {};
const TODAY_KEY = '@today';
PSEUDO['@today'] = 'vandaag';

function todayLines() {
  const T = M.tot;
  const day = dayStart(Date.now());
  const movers = M.companies.filter((c) => isNum(c.change)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 4);
  // Eerst wat binnen twee weken komt; is er niets, dan toch de eerstvolgende, zodat de tegel niet leeg blijft
  const soon = (list) => { const near = list.filter((x) => x.t <= day + 14 * DAY); return near.length ? near : list.slice(0, 2); };
  const earn = soon(M.ev.earn || []);
  const divs = soon(M.ev.divs || []);
  return { T, movers, earn, divs };
}
function renderTodayView() {
  const { T, movers, earn, divs } = todayLines();
  const n = syncUnread();
  const head = pseudoHead('Vandaag, ' + (M.lastT ? fDT.format(M.lastT) : 'nog geen meting'), eur(M.totalValue),
    isNum(T.change) ? seur(T.change) + ' ' + M.dayWord + ' · ' + spct(T.changePct) : 'Nog geen meting van vandaag.', isNum(T.change) ? tone(T.change) : '');
  const kerncijfers = '<section class="tile pad"><h3>In één oogopslag</h3>' + kvList([
    ['Beleggingen', eur(M.totalValue)],
    ['Resultaat ' + M.dayWord, isNum(T.change) ? seur(T.change) + ' (' + spct(T.changePct) + ')' : '–', isNum(T.change) ? tone(T.change) : ''],
    ['Vrij saldo', M.cash != null ? eur(M.cash) : '–'],
    ['Accountwaarde', eur(M.accountNow)],
    ['Ongelezen nieuws en alarmen', n ? String(n) : 'geen'],
  ]) + '</section>';
  const rows = movers.length
    ? '<div class="today-rows">' + movers.map((c) => tpl`<button type="button" class="today-row" data-ticker="${c.tk}"><span class="l"><b>${c.tk}</b><span class="nm">${c.name}</span></span><span class="r ${tone(c.change)}"><b>${seur(c.change)}</b><span>${spct(c.changePct)}</span></span></button>`).join('')
    : '<p class="muted">Nog geen bewegingen gemeten vandaag.</p>';
  const beweging = '<section class="tile pad"><h3>Grootste bewegingen</h3>' + rows + '</section>';
  const agendaRows = earn.map((e) => [((M.byTk.get(e.tk) || {}).name || e.tk) + ', kwartaalcijfers', fD.format(e.t)])
    .concat(divs.slice(0, 4).map((d) => [((M.byTk.get(d.tk) || {}).name || d.tk) + ', dividend', fD.format(d.t) + (isNum(d.eur) ? ', ' + eur(d.eur) : '')]));
  const agenda = '<section class="tile pad"><h3>Komt eraan</h3>' + (agendaRows.length ? kvList(agendaRows.slice(0, 6)) : '<p class="muted">Nog geen kwartaalcijfers of dividenden bekend.</p>') + '</section>';
  const widgetTile = '<section class="tile pad"><h3>Op je beginscherm</h3><p class="sub">' +
    esc(win2.isSecureContext && 'widgets' in nav2 ? 'Je apparaat ondersteunt widgets: voeg de widget “Vandaag” toe via het beginscherm of de widgetlijst. De bedragen volgen de knop “bedragen verbergen”.'
      : 'Zet deze pagina op je beginscherm (snelkoppeling “Vandaag” van de app) voor een snelle blik. Ondersteunt je apparaat widgets, dan verschijnt de widget “Vandaag” in de widgetlijst.') + '</p>' +
    '<p class="sub">Deze pagina bewaart niets extra: hij rekent met de stand die de tracker al heeft, dus hij werkt ook zonder verbinding.</p></section>';
  return pseudoPage('Vandaag', head, [[kerncijfers, beweging], [agenda, widgetTile]], [kerncijfers, beweging, agenda, widgetTile]);
}
PSEUDO_VIEWS[TODAY_KEY] = renderTodayView;

// Wat de widget laat zien: alleen al opgemaakte tekst (dus mét de keuze "bedragen verbergen")
function widgetPayload() {
  const T = M.tot;
  const { movers } = todayLines();
  return {
    value: eur(M.totalValue),
    change: isNum(T.change) ? seur(T.change) + ' · ' + spct(T.changePct) : 'nog niet gemeten',
    tone: isNum(T.change) ? (T.change < 0 ? 'attention' : 'good') : 'default',
    updated: M.lastT ? 'Bijgewerkt ' + fDT.format(M.lastT) : 'Nog geen meting',
    movers: movers.slice(0, 3).map((c) => c.tk + ' ' + spct(c.changePct)).join(' · ') || '–',
  };
}
function widgetPush() {
  if (!M || !('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
  try { navigator.serviceWorker.controller.postMessage({ type: 'widget', data: widgetPayload() }); } catch (e) { /* niet erg */ }
}

// ---------- Order plaatsen uit een snelkoppeling of het snelzoeken ----------
function openOrderPicker() {
  if (!M) return;
  const dlg = document.createElement('div');
  dlg.className = 'overlay-dlg';
  const able = typeof tradingOn === 'function' && tradingOn() && !sharedView;
  const list = M.companies.slice().sort((a, b) => b.value - a.value);
  dlg.innerHTML = String(tpl`<div class="dlg-card" role="dialog" aria-modal="true" aria-label="Order plaatsen"><h3>Order plaatsen</h3>
    ${able ? raw('<p class="small muted">Kies het aandeel; je ziet daarna een overzicht en bevestigt zelf. Dit is geen beleggingsadvies.</p>')
    : raw('<p class="small muted">Kopen en verkopen staat uit. Zet het aan bij Instellingen, Koppelingen, als je het wilt gebruiken.</p>')}
    ${able ? raw('<ul class="pick-list" role="list">' + list.map((c) => String(tpl`<li><button type="button" data-pick-order="${c.tk}"><span><b>${c.tk}</b> <span class="muted">${c.name}</span></span><span class="muted small">${eur(c.value)}</span></button></li>`)).join('') + '</ul>') : ''}
    <div class="dlg-actions">${able ? '' : raw('<button type="button" class="btn ghost" data-pick-links>Naar Koppelingen</button>')}<button type="button" class="btn primary" data-pick-close>Sluiten</button></div></div>`);
  document.body.appendChild(dlg);
  const close = () => dlg.remove();
  dlg.addEventListener('click', (e) => {
    const t = /** @type {Element} */ (e.target);
    if (e.target === dlg || (t.closest && t.closest('[data-pick-close]'))) { close(); return; }
    if (t.closest && t.closest('[data-pick-links]')) { close(); openSettings(false); setGo('links'); return; }
    const b = /** @type {HTMLElement|null} */ (t.closest ? t.closest('[data-pick-order]') : null);
    if (!b) return;
    close();
    const fake = document.createElement('button');
    fake.dataset.trade = 'BUY';
    fake.dataset.tk = b.dataset.pickOrder || '';
    openTradeDialog(fake);
  });
  const first = /** @type {HTMLElement|null} */ (dlg.querySelector('[data-pick-order], [data-pick-close]'));
  if (first) first.focus();
}

// ---------- Delen vanuit een andere app: een ticker of artikel op je volglijst zetten ----------
let shareDone = false;
function sharedText() {
  const q = new URLSearchParams(location.search);
  const parts = ['share_title', 'share_text', 'share_url'].map((k) => q.get(k) || '').filter(Boolean);
  return parts.join(' ');
}
// Kandidaat-symbolen uit de gedeelde tekst: $NVDA, NASDAQ:NVDA of een los hoofdlettersymbool
function shareSymbols(text) {
  const out = [];
  const add = (s) => { const k = s.toUpperCase(); if (/^[A-Z][A-Z0-9.\-]{0,11}$/.test(k) && !out.includes(k)) out.push(k); };
  (text.match(/\$[A-Za-z][A-Za-z0-9.\-]{0,11}/g) || []).forEach((s) => add(s.slice(1)));
  (text.match(/\b(?:NASDAQ|NYSE|AMEX|EURONEXT|XETRA|LSE)[:\s]([A-Za-z][A-Za-z0-9.\-]{0,11})/g) || []).forEach((s) => add(s.split(/[:\s]/).pop() || ''));
  (text.match(/\b[A-Z]{2,5}\b/g) || []).forEach(add);
  const skip = new Set(['DE', 'HET', 'EEN', 'VAN', 'THE', 'AND', 'FOR', 'NEWS', 'EUR', 'USD', 'CEO', 'ETF', 'AI', 'IPO', 'EU', 'VS', 'US', 'UK']);
  return out.filter((s) => !skip.has(s)).slice(0, 8);
}
async function shareIntake() {
  if (shareDone || !M) return;
  const text = sharedText();
  if (!text) return;
  shareDone = true;
  // De gedeelde tekst uit het adres halen, zodat vernieuwen niet opnieuw vraagt
  try { history.replaceState(history.state, '', location.pathname + (demo ? '?demo' : '') + location.hash); } catch (e) { /* niet erg */ }
  const have = new Set(M.companies.map((c) => c.tk).concat(watchSyms()));
  let cands = shareSymbols(text).map((sym) => ({ sym, name: '', known: false }));
  const res = await searchCompaniesSite(text.split(/\s+/).slice(0, 6).join(' ')).catch(() => []);
  res.slice(0, 6).forEach((r) => { const at = cands.find((c) => c.sym === r.sym); if (at) { at.name = r.name; at.known = true; } else cands.push({ sym: r.sym, name: r.name, known: true }); });
  cands = cands.filter((c) => !have.has(c.sym)).slice(0, 8);
  const dlg = document.createElement('div');
  dlg.className = 'overlay-dlg';
  dlg.innerHTML = String(tpl`<div class="dlg-card" role="dialog" aria-modal="true" aria-label="Toevoegen aan volglijst"><h3>Toevoegen aan volglijst</h3>
    <p class="small muted">Gedeeld met de tracker: ${text.slice(0, 200)}</p>
    ${cands.length ? raw('<ul class="pick-list" role="list">' + cands.map((c) => String(tpl`<li><button type="button" data-share-add="${c.sym}"><span><b>${c.sym}</b> <span class="muted">${c.name || (c.known ? '' : 'symbool uit de tekst')}</span></span><span class="muted small">Volgen</span></button></li>`)).join('') + '</ul>')
    : raw('<p class="small">Geen beurssymbool gevonden in wat je deelde. Zoek het bedrijf op de pagina Bedrijven, tabblad Volglijst.</p>')}
    <p class="small share-st" role="status"></p>
    <div class="dlg-actions"><button type="button" class="btn ghost" data-share-watch>Naar de volglijst</button><button type="button" class="btn primary" data-share-close>Sluiten</button></div></div>`);
  document.body.appendChild(dlg);
  const st = /** @type {HTMLElement} */ (dlg.querySelector('.share-st'));
  dlg.addEventListener('click', (e) => {
    const t = /** @type {Element} */ (e.target);
    if (e.target === dlg || (t.closest && t.closest('[data-share-close]'))) { dlg.remove(); return; }
    if (t.closest && t.closest('[data-share-watch]')) { dlg.remove(); location.hash = '#bedrijven'; ui.listPane = 'watch'; refresh('list', 'watch'); return; }
    const b = /** @type {HTMLElement|null} */ (t.closest ? t.closest('[data-share-add]') : null);
    if (!b) return;
    const sym = b.dataset.shareAdd || '';
    if (watchSyms().length >= 30) { st.textContent = 'Je volglijst zit vol (maximaal 30 aandelen).'; st.className = 'small share-st loss'; return; }
    b.setAttribute('disabled', 'disabled');
    setWatchlist((cur) => (cur.includes(sym) ? cur : cur.concat([sym])), st, sym + ' staat op je volglijst.')
      .catch(() => { b.removeAttribute('disabled'); });
  });
  const f = /** @type {HTMLElement|null} */ (dlg.querySelector('[data-share-add], [data-share-close]'));
  if (f) f.focus();
}

// ---------- Vergrendelen met vingerafdruk of gezicht (WebAuthn, alleen op dit apparaat) ----------
// Dit is een slot vóór de weergave, geen versleuteling: het houdt meekijkers tegen, geen apparaat in verkeerde handen.
const LS_LOCK = 'tracker.lock';
const lockAble = () => !!(win2.PublicKeyCredential && navigator.credentials && win2.isSecureContext);
function lockCred() { try { return JSON.parse(localStorage.getItem(LS_LOCK) || 'null'); } catch (e) { return null; } }
const lockActive = () => !!(lockCred() && lockAble() && !sharedView);
let locked = false;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function lockShow(on) {
  const el = $('lock');
  if (!el) return;
  locked = on;
  el.hidden = !on;
  document.documentElement.classList.toggle('applocked', on);
  [$('shell'), $('mshell'), $('detail')].forEach((s) => { if (s) s.inert = on; });
  if (on) { const b = $('lock-go'); if (b) b.focus(); }
}
function lockSay(t, cls) { const el = $('lock-st'); if (el) { el.textContent = t; el.className = 'small ' + (cls || ''); } }
async function lockAsk() {
  const cred = lockCred();
  if (!cred) { lockShow(false); return; }
  if (!lockAble()) { lockSay('Deze browser kan niet ontgrendelen met vingerafdruk of gezicht. Zet de vergrendeling uit bij Instellingen op een apparaat dat het wel kan, of wis de gegevens van deze site.', 'loss'); return; }
  lockSay('Bezig met ontgrendelen…');
  try {
    const ch = new Uint8Array(32);
    crypto.getRandomValues(ch);
    const got = await navigator.credentials.get({ publicKey: {
      challenge: ch, timeout: 60000, userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: unb64(cred.id) }],
    } });
    if (!got) throw new Error('geen antwoord');
    lockSay('');
    lockShow(false);
    haptic('aan');
  } catch (err) {
    lockSay('Ontgrendelen lukte niet: ' + (err && err.message ? err.message : 'afgebroken') + '.', 'loss');
    haptic('fout');
    const esc2 = $('lock-escape');
    if (esc2) esc2.hidden = false;
  }
}
// Noodweg: lukt ontgrendelen niet meer (nieuwe telefoon, vingerafdruk verwijderd), dan kun je de tracker van dit
// apparaat wissen. Dat geeft geen toegang: het haalt juist de toegangscode en het slot weg, je logt daarna opnieuw in.
function lockWipe() {
  if (!confirm('De tracker van dit apparaat wissen? Je toegangscode en de vergrendeling worden verwijderd; je kunt daarna opnieuw inloggen met je Trading 212-sleutel.')) return;
  try { localStorage.removeItem(LS_LOCK); localStorage.removeItem(LS_TOKEN); } catch (e) { /* niet erg */ }
  idbDel('last');
  setTimeout(() => location.reload(), 150);
}
async function lockEnable(say) {
  if (!lockAble()) { say('Deze browser of dit apparaat ondersteunt geen vingerafdruk of gezicht (WebAuthn met een ingebouwde sleutel).', 'loss'); return; }
  say('Volg wat je apparaat vraagt…');
  try {
    const ch = new Uint8Array(32), uid = new Uint8Array(16);
    crypto.getRandomValues(ch); crypto.getRandomValues(uid);
    const c = /** @type {any} */ (await navigator.credentials.create({ publicKey: {
      challenge: ch,
      rp: { name: 'Investeringstracker' },
      user: { id: uid, name: 'tracker', displayName: 'Investeringstracker' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none',
    } }));
    if (!c) throw new Error('geen sleutel gemaakt');
    localStorage.setItem(LS_LOCK, JSON.stringify({ id: b64(c.rawId), at: Date.now() }));
    say('Aan. Bij het openen van de tracker vraagt dit apparaat om je vingerafdruk, gezicht of pincode.', 'gain');
    renderLockBox();
  } catch (err) { say('Aanzetten lukte niet: ' + (err && err.message ? err.message : 'afgebroken') + '.', 'loss'); }
}
function lockDisable(say) {
  try { localStorage.removeItem(LS_LOCK); } catch (e) { /* niet erg */ }
  say('Uit. De tracker opent weer direct.', '');
  renderLockBox();
}
function renderLockBox() {
  const box = $('lock-box');
  if (!box) return;
  const on = !!lockCred();
  box.innerHTML = String(tpl`<h3 style="margin-top:14px">Vergrendelen met vingerafdruk of gezicht</h3>
    <p class="muted small">Optioneel slot vóór de tracker op dít apparaat. Je apparaat controleert je vingerafdruk, gezicht of pincode (WebAuthn); er gaat niets naar een server en er wordt niets extra bewaard.
    Het houdt meekijkers tegen; het versleutelt je gegevens niet. Wis je de gegevens van deze site, dan is het slot weg (en je toegangscode ook).</p>
    <div class="exp" style="margin-top:8px">${on ? raw('<button type="button" class="btn ghost danger" data-lock="off">Vergrendeling uitzetten</button><span class="tag gain">Aan</span>')
    : raw('<button type="button" class="btn ghost" data-lock="on"' + (lockAble() ? '' : ' disabled') + '>Vergrendeling aanzetten</button><span class="tag">Uit</span>')}</div>
    <p class="small lock-set-st" role="status">${lockAble() ? '' : 'Niet beschikbaar: dit vraagt https en een apparaat met vingerafdruk, gezicht of pincode.'}</p>`);
}
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  const b = /** @type {HTMLElement|null} */ (t.closest ? t.closest('[data-lock]') : null);
  if (!b) return;
  const box = $('lock-box');
  const say = (m, cls) => { const el = box && box.querySelector('.lock-set-st'); if (el) { el.textContent = m; el.className = 'small lock-set-st ' + (cls || ''); } };
  if (b.dataset.lock === 'on') lockEnable(say); else lockDisable(say);
});
{
  const go = $('lock-go');
  if (go) go.addEventListener('click', () => lockAsk());
  const esc3 = $('lock-escape');
  if (esc3) esc3.addEventListener('click', () => lockWipe());
}
// Opnieuw vergrendelen als de app langer dan twee minuten op de achtergrond stond
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (lockActive() && !locked && hiddenAt && Date.now() - hiddenAt > 2 * 60000) { lockShow(true); lockAsk(); }
  if (!document.hidden) { flushPrefsQueue(); offlineNote(); }
});
if (lockActive()) { lockShow(true); setTimeout(() => lockAsk(), 300); }

// ---------- Instellingen: trilling, vergrendeling en de weergave Vandaag ----------
(function deviceSettings() {
  const view = document.querySelector('.set-sec[data-set="view"] .install-box');
  if (view && !view.querySelector('[data-disp-haptic]')) {
    const div = document.createElement('div');
    div.className = 'disp-opts';
    div.innerHTML = String(tpl`<h3 style="margin-top:14px">Telefoon</h3>
      <label class="check"><input type="checkbox" data-disp-haptic ${raw(hapticOn() ? 'checked' : '')}> Korte trilling bij bevestigen en wisselen</label>
      <p class="muted small">${hapticAble() ? 'Alleen op apparaten die trillen; staat uit als je animaties uit hebt staan.' : 'Dit apparaat of deze browser kan niet trillen.'}</p>`);
    view.appendChild(div);
  }
  const acc = document.querySelector('.set-sec[data-set="account"]');
  if (acc && !$('lock-box')) {
    const box = document.createElement('div');
    box.id = 'lock-box';
    const acts = acc.querySelector('.set-actions');
    if (acts) acc.insertBefore(box, acts); else acc.appendChild(box);
    renderLockBox();
  }
  const inst = $('install-box');
  if (inst && !inst.querySelector('[data-today-go]')) {
    const div = document.createElement('div');
    div.innerHTML = String(tpl`<h3 style="margin-top:14px">Vandaag en widgets</h3>
      <p class="muted small">De weergave Vandaag laat in één blik de waarde, het resultaat van vandaag en wat eraan komt zien. De app heeft er een snelkoppeling voor (houd het app-pictogram ingedrukt); op apparaten die widgets ondersteunen staat “Vandaag” ook in de widgetlijst.</p>
      <div class="exp" style="margin-top:8px"><button type="button" class="btn ghost" data-today-go>Vandaag bekijken</button></div>`);
    inst.appendChild(div);
  }
}());
document.addEventListener('change', (e) => {
  const el = /** @type {HTMLInputElement|null} */ ((/** @type {Element} */ (e.target)).closest ? /** @type {Element} */ (e.target).closest('[data-disp-haptic]') : null);
  if (!el) return;
  try { localStorage.setItem(LS_HAPTIC, el.checked ? '1' : '0'); } catch (err) { /* niet erg */ }
  if (el.checked) haptic('aan');
});
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  if (t.closest && t.closest('[data-today-go]')) { const d = document.querySelector('dialog[open]'); if (d && /** @type {HTMLDialogElement} */ (d).close) /** @type {HTMLDialogElement} */ (d).close(); location.hash = '#vandaag'; }
});

// ---------- Snelkoppelingen uit het adres: #order ----------
function hashAction() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (h !== 'order') return;
  try { history.replaceState(null, '', '#' + pageHash(ui.page)); } catch (e) { /* niet erg */ }
  openOrderPicker();
}
window.addEventListener('hashchange', () => hashAction());

// ---------- Bij elke tekenronde: teller, melding, widget en wat gedeeld is ----------
defineView('apparaat', () => {
  syncUnread();
  offlineNote();
  widgetPush();
  shareIntake();
  hashAction();
  flushPrefsQueue();
});
Object.keys(PAGE_VIEWS).forEach((p) => { if (!PAGE_VIEWS[p].includes('apparaat')) PAGE_VIEWS[p].push('apparaat'); });
// In de voorbeeldweergave is er geen Worker; de melding "bewaarde stand" is dan een voorbeeld dat je weg kunt klikken
if (new URLSearchParams(location.search).has('demo')) cacheStand = Date.now() - 23 * 60000;
