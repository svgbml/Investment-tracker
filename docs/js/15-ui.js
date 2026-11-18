/* Investeringstracker – UI-bouwstenen: meldingen (toasts), skeletons, kruimelpad, getalweergave,
 * foutteksten in gewone taal en de startchecklist.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html).
 *
 * Alles hier is bedoeld om hergebruikt te worden:
 *  - toast(tekst, soort): één vorm voor "gelukt" en "mislukt", met role="status" / aria-live.
 *  - skelTile() en showSkeleton(): grijze plaatshouders zolang de gegevens nog komen.
 *  - crumbNav(titel): kruimelpad bovenaan een detailpagina (computer en telefoon).
 *  - foutTekst(wat, fout): wat er gebeurde, waarom, en wat je kunt doen.
 *  - numFmtOptions(): keuze tussen volledige en afgekorte bedragen, en het aantal decimalen.
 */
'use strict';

// ---------- Meldingen (toasts) ----------
// Eén component voor korte terugkoppeling. De houder staat in index.html en is een live-gebied,
// zodat een schermlezer de melding voorleest zonder dat de aandacht wordt weggehaald.
const TOAST_MAX = 3;
const toastTimers = new WeakMap();
const TOAST_MS = { ok: 3600, err: 7000, '': 4200 };
function toast(text, kind) {
  const host = $('toasts');
  const msg = String(text == null ? '' : text).trim();
  if (!host || !msg) return null;
  const k = kind === 'ok' || kind === 'err' ? kind : '';
  // Zelfde melding nog zichtbaar: alleen de tijd opnieuw starten (geen stapel dezelfde regels)
  const same = [...host.children].find((el) => /** @type {HTMLElement} */ (el).dataset.msg === msg);
  const el = /** @type {HTMLElement} */ (same || document.createElement('div'));
  if (!same) {
    el.className = 'toast';
    el.dataset.msg = msg;
    el.innerHTML = '<span class="t"></span><button type="button" class="x" aria-label="Melding sluiten">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    el.querySelector('.t').textContent = msg;
    host.appendChild(el);
    while (host.children.length > TOAST_MAX) host.firstElementChild.remove();
  }
  el.classList.remove('ok', 'err');
  if (k) el.classList.add(k);
  if (k === 'err') el.setAttribute('role', 'alert'); else el.removeAttribute('role');
  clearTimeout(toastTimers.get(el));
  toastTimers.set(el, setTimeout(() => closeToast(el), TOAST_MS[k]));
  return el;
}
function closeToast(el) {
  if (!el || !el.isConnected) return;
  clearTimeout(toastTimers.get(el));
  toastTimers.delete(el);
  if (reduceMotion()) { el.remove(); return; }
  el.classList.add('out');
  setTimeout(() => el.remove(), 220);
}
const toastOk = (t) => toast(t, 'ok');
const toastErr = (t) => toast(t, 'err');
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  const x = t && t.closest ? t.closest('#toasts .x') : null;
  if (x) closeToast(/** @type {HTMLElement} */ (x.closest('.toast')));
});

// ---------- Skeletons: plaatshouders zolang de gegevens nog komen ----------
const skelBlock = (cls) => '<span class="skel ' + (cls || '') + '"></span>';
// Tegel met een kop en een paar regels, in de maat van een echte tegel
function skelTile(lines, chart) {
  const n = lines || 3;
  let out = '<section class="tile pad skel-tile" aria-hidden="true">' + skelBlock('skel-h');
  if (chart) out += skelBlock('skel-chart');
  for (let i = 0; i < n; i++) out += skelBlock('skel-line' + (i === n - 1 ? ' short' : ''));
  return out + '</section>';
}
// Rijen voor een lijst (telefoon)
function skelRows(n) {
  let out = '<div class="skel-rows" aria-hidden="true">';
  for (let i = 0; i < (n || 3); i++) out += '<div class="skel-row">' + skelBlock('skel-line') + skelBlock('skel-line short') + '</div>';
  return out + '</div>';
}
let skeletonOn = false;
// Eerste keer laden: de pagina alvast in zijn vorm tonen in plaats van een leeg scherm
function showSkeleton() {
  if (M || skeletonOn) return;
  skeletonOn = true;
  document.body.classList.add('skeleton');
  $('welcome').hidden = true;
  document.body.classList.remove('welcoming');
  $('app').hidden = false;
  $('m-main').hidden = false;
  const tiles = (n, cls) => Array.from({ length: n }, () => skelTile(cls === 'chart' ? 2 : 3, cls === 'chart')).join('');
  const put = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  ['hero-value', 'm-hero-value'].forEach((id) => put(id, skelBlock('skel-value')));
  ['hero-change', 'm-hero-change'].forEach((id) => put(id, skelBlock('skel-line')));
  ['hero-chart', 'm-hero-chart'].forEach((id) => put(id, skelBlock('skel-chart tall')));
  ['kpis', 'm-kpis'].forEach((id) => put(id, tiles(4)));
  put('movers', tiles(3));
  put('m-movers', skelRows(4));
  ['agenda', 'm-agenda'].forEach((id) => put(id, tiles(2, 'chart')));
  $$('.updated').forEach((e) => { e.textContent = ''; });
}
function clearSkeleton() {
  if (!skeletonOn) return;
  skeletonOn = false;
  document.body.classList.remove('skeleton');
  $$('.skel, .skel-tile, .skel-rows').forEach((el) => el.remove());
}

// ---------- Kruimelpad op detailpagina's ----------
// Een detailpagina opent over de lijst heen; het kruimelpad laat zien waar je bent en waar je heen teruggaat.
function crumbParent(k) {
  if (k === CMP || !isPseudo(k)) return { hash: 'bedrijven', label: 'Bedrijven' };
  return { hash: 'overzicht', label: 'Overzicht' };
}
// Label voor de terugknop op de telefoon ("‹ Bedrijven")
const crumbBack = (k) => '‹ ' + crumbParent(k || ui.detail).label;
function crumbNav(title) {
  const p = crumbParent(ui.detail);
  const parts = [{ hash: 'overzicht', label: 'Overzicht' }];
  if (p.hash !== 'overzicht') parts.push(p);
  return '<nav class="crumbs" aria-label="Kruimelpad"><ol>' +
    parts.map((x) => '<li><a href="#' + esc(x.hash) + '">' + esc(x.label) + '</a></li>').join('') +
    '<li><span aria-current="page">' + esc(title || '') + '</span></li></ol></nav>';
}

// ---------- Foutteksten: wat gebeurde er, waarom, en wat kun je doen ----------
/** @type {[RegExp, string][]} */
const FOUT_REGELS = [
  [/\b(401|403)\b|unauthorized|forbidden/i, 'Je toegangscode werd niet geaccepteerd. Vul hem opnieuw in bij Instellingen, onder Toegang en Worker.'],
  [/\b404\b/, 'Op dit adres staat geen tracker. Controleer bij Instellingen het adres van je Worker; het eindigt op /api/data.'],
  [/\b429\b|rate.?limit/i, 'De bron heeft zijn limiet voor nu bereikt. Wacht een kwartier; zolang gebruikt de tracker de reservebron of de vorige gegevens.'],
  [/\b5\d\d\b|internal error|worker threw|exceeded cpu/i, 'De Worker liep vast. Kijk bij Instellingen onder Status en reservekopie wat er misging en probeer het daarna opnieuw.'],
  [/failed to fetch|networkerror|load failed|network ?error/i, 'Je apparaat kon de Worker niet bereiken. Controleer je internetverbinding en probeer het opnieuw.'],
  [/timeout|timed out|aborted/i, 'Het duurde te lang. Probeer het opnieuw; bij de eerste meting is de Worker soms nog bezig.'],
  [/json|unexpected token|unexpected end/i, 'Het antwoord waren geen tracker-gegevens. Controleer of het adres naar je eigen Worker wijst.'],
  [/alleen lezen|gedeelde weergave/i, 'Dit is een gedeelde weergave: wijzigen kan alleen in je eigen tracker.'],
];
// Geeft het advies bij een foutmelding, of '' als er geen passend advies is
function foutUitleg(msg) {
  const t = String(msg == null ? '' : msg);
  const hit = FOUT_REGELS.find(([re]) => re.test(t));
  return hit ? hit[1] : '';
}
// "Wat lukte niet (waarom). Wat je kunt doen." — zo leest elke foutmelding hetzelfde.
function foutTekst(wat, err, advies) {
  const msg = (err && err.message ? err.message : String(err == null ? '' : err)).replace(/\.$/, '');
  const hint = foutUitleg(msg) || advies || 'Probeer het opnieuw; blijft het misgaan, kijk dan bij Instellingen onder Status en reservekopie.';
  return wat + (msg ? ' (' + msg + ')' : '') + '. ' + hint;
}

// ---------- Getalweergave: volledige of afgekorte bedragen, en het aantal decimalen ----------
// Per apparaat (localStorage), net als de andere weergavekeuzes. eur(), seur() en de procentopmakers
// volgen de keuze; zie buildNumFmt in js/01-basis.js.
function numFmtOptions() {
  const dec = numFmtDec;
  const opt = (v, l) => '<option value="' + v + '"' + (dec === v ? ' selected' : '') + '>' + esc(l) + '</option>';
  return '<h3 style="margin-top:14px">Getallen</h3>' +
    '<label class="check"><input type="checkbox" data-numfmt="kort"' + (numFmtKort ? ' checked' : '') + '> Grote bedragen afkorten (€ 12,3K)</label>' +
    '<label class="num-dec">Decimalen bij bedragen en procenten ' +
      '<select data-numfmt="dec">' + opt(0, 'geen (€ 12)') + opt(1, 'één (€ 12,3)') + opt(2, 'twee (€ 12,34)') + '</select></label>';
}
function applyNumFmt() {
  try { localStorage.setItem('tracker.num', numFmtKort ? 'kort' : 'vol'); localStorage.setItem('tracker.dec', String(numFmtDec)); } catch (e) { /* niet erg */ }
  buildNumFmt();
  if (typeof rerenderAll === 'function') rerenderAll();
}
document.addEventListener('change', (e) => {
  const t = /** @type {Element} */ (e.target);
  const el = /** @type {HTMLInputElement|HTMLSelectElement|null} */ (t && t.closest ? t.closest('[data-numfmt]') : null);
  if (!el) return;
  if (el.dataset.numfmt === 'kort') numFmtKort = /** @type {HTMLInputElement} */ (el).checked;
  else { const d = Number(el.value); numFmtDec = d === 0 || d === 1 ? d : 2; }
  applyNumFmt();
});

// ---------- Startchecklist: wat staat er al, en wat nog niet ----------
const LS_ONB = 'tracker.onboard';
const onbOff = () => { try { return localStorage.getItem(LS_ONB) === 'off'; } catch (e) { return false; } };
function onbSteps() {
  const S = (M && M.settings) || {};
  const research = data && data.research ? Object.keys(data.research).length : 0;
  const standalone = matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
  const alerts = ((S.priceAlerts || []).length > 0) || (typeof Notification !== 'undefined' && Notification.permission === 'granted');
  return [
    { t: 'Trading 212 gekoppeld', done: demo || (!!getToken() && !!(M && M.companies.length)), why: 'De basis: je posities, orders en saldo.', set: 'links' },
    { t: 'Nieuws en analisten aan', done: research > 0, why: 'Een gratis Finnhub-sleutel geeft nieuws, koersdoelen en insiderhandel.', set: 'links' },
    { t: 'Volglijst gevuld', done: (typeof watchSyms === 'function' ? watchSyms().length : 0) > 0, why: 'Volg een aandeel dat je nog niet hebt.', hash: 'bedrijven' },
    { t: 'Doel ingesteld', done: (S.goals || []).length > 0, why: 'Op Plannen zie je dan hoe ver je bent en wat er nog nodig is.', hash: 'plannen' },
    { t: 'Koersalarm of meldingen', done: alerts, why: 'Een bericht bij een koersgrens, kwartaalcijfers of insiderhandel.', set: 'push' },
    { t: 'App op je beginscherm', done: standalone, why: 'Opent sneller en werkt zonder verbinding met de laatste stand.', set: 'install' },
  ];
}
function onbHtml() {
  const steps = onbSteps();
  const done = steps.filter((s) => s.done).length;
  const open = steps.filter((s) => !s.done);
  if (onbOff() || !open.length) return '';
  const pct = Math.round((done / steps.length) * 100);
  const row = (s) => '<li class="' + (s.done ? 'done' : '') + '">' +
    '<span class="onb-mark" aria-hidden="true">' + (s.done ? '✓' : '') + '</span>' +
    (s.done ? '<span class="onb-t">' + esc(s.t) + '</span>'
      : '<button type="button" class="onb-t" ' + (s.set ? 'data-onb-set="' + esc(s.set) + '"' : 'data-onb-go="' + esc(s.hash || '') + '"') + '>' +
        esc(s.t) + '<span class="sub">' + esc(s.why) + '</span></button>') + '</li>';
  return '<section class="tile pad onb">' +
    '<div class="onb-head"><h3>' + esc(done + ' van ' + steps.length + ' stappen klaar') + '</h3>' +
      '<button type="button" class="btn ghost small" data-onb-off>Niet meer tonen</button></div>' +
    '<div class="meter" aria-hidden="true"><div style="width:' + pct + '%"></div></div>' +
    '<p class="sub">Zo haal je alles uit de tracker. Elke stap is optioneel; de basis werkt met Trading 212 alleen.</p>' +
    '<ol class="onb-list">' + steps.map(row).join('') + '</ol></section>';
}
function renderOnboard() {
  const html = M ? onbHtml() : '';
  const now = mode === 'm' ? 'm-onboard' : 'onboard'; // alleen de weergave die aanstaat
  ['onboard', 'm-onboard'].forEach((id) => { const el = $(id); if (el) el.innerHTML = id === now ? html : ''; });
}
defineView('onboard', renderOnboard);
if (typeof PAGE_VIEWS === 'object' && PAGE_VIEWS.home) PAGE_VIEWS.home.push('onboard');
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  if (!t || !t.closest) return;
  if (t.closest('[data-onb-off]')) {
    try { localStorage.setItem(LS_ONB, 'off'); } catch (err) { /* niet erg */ }
    refresh('onboard');
    toastOk('De checklist is weggehaald. Via Instellingen, Weergave kun je hem terugzetten.');
    return;
  }
  const s = /** @type {HTMLElement|null} */ (t.closest('[data-onb-set]'));
  if (s) { openSettings(false); setGo(s.dataset.onbSet || 'links'); return; }
  const g = /** @type {HTMLElement|null} */ (t.closest('[data-onb-go]'));
  if (g) { location.hash = '#' + (g.dataset.onbGo || 'overzicht'); }
});
// Terugzetten vanuit Instellingen > Weergave
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  if (!t || !t.closest || !t.closest('[data-onb-on]')) return;
  try { localStorage.removeItem(LS_ONB); } catch (err) { /* niet erg */ }
  refresh('onboard');
  toastOk('De checklist staat weer op het overzicht.');
});
