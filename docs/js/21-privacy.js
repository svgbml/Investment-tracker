/* Investeringstracker – Instellingen zoeken, privacy en veiligheid
 *
 * In dit bestand:
 *  - zoeken in de instellingen
 *  - voorkeuren meenemen naar een ander apparaat (uitvoeren en inlezen, zonder sleutels)
 *  - meldingen: stille uren, bundelen per dag en wat er verstuurd is
 *  - deel-link met einddatum, alle links intrekken, deelplaatje en vergelijken met iemand anders
 *  - functies in ontwikkeling op één plek
 *  - privacyscherm (waas als de app naar de achtergrond gaat) en snel verbergen met een gebaar of toets
 *  - apparaten met toegang (eigen code per apparaat) en het logboek van je tracker
 *
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html).
 */
'use strict';

// Het element waarop is geklikt, als het binnen de gevraagde selector valt (met het juiste type voor de typecontrole)
/** @param {Event} e @param {string} sel @returns {HTMLButtonElement|null} */
function privHit(e, sel) {
  const t = /** @type {Element|null} */ (e.target);
  return t && t.closest ? /** @type {HTMLButtonElement|null} */ (t.closest(sel)) : null;
}
/** @param {string} id @returns {HTMLInputElement} */
const privIn = (id) => /** @type {HTMLInputElement} */ ($(id));
/** @param {string} sel @returns {HTMLInputElement} */
const privQ = (sel) => /** @type {HTMLInputElement} */ (document.querySelector(sel));

// ---------- Functies in ontwikkeling: één lijst met naam, standaard en uitleg (idee 140) ----------
// Een keuze gaat naar settings.prefs.flags (dus op al je apparaten) en wordt hier ook in deze browser
// bewaard, zodat het privacyscherm al werkt voordat de gegevens binnen zijn.
const SITE_FLAGS = [
  { id: 'privacyBlur', name: 'Privacyscherm', def: true, exp: false,
    what: 'Legt een waas over de app zodra je naar een andere app of tab gaat, zodat je bedragen niet in het overzicht van open apps staan.' },
  { id: 'quickHide', name: 'Snel verbergen', def: true, exp: false,
    what: 'Bedragen verbergen of tonen met twee vingers tikken op de telefoon, of met Ctrl+Shift+H (ook terwijl je in een veld typt).' },
  { id: 'shareCard', name: 'Deelplaatje van je maand', def: true, exp: false,
    what: 'Maakt een plaatje van je maandrendement in procenten, zonder bedragen, om te delen.' },
  { id: 'friendCompare', name: 'Vergelijken met iemand anders', def: false, exp: true,
    what: 'Plak de deel-link van een andere tracker en vergelijk alleen percentages. De link gaat naar je eigen Worker en wordt niet bewaard.' },
  { id: 'blurIdle', name: 'Verbergen na twee minuten stilte', def: false, exp: true,
    what: 'Legt de waas er ook over als je twee minuten niets doet. Tik of klik om de bedragen weer te zien.' },
];
const FLAG_LS = 'tracker.flags';
function flagMap() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(FLAG_LS) || '{}'); } catch (e) { o = {}; }
  const p = (M && M.settings && M.settings.prefs && M.settings.prefs.flags) || null;
  return p && typeof p === 'object' ? Object.assign(o, p) : o;
}
function flagOn(id) {
  const f = SITE_FLAGS.find((x) => x.id === id);
  if (!f) return false;
  const v = flagMap()[id];
  return typeof v === 'boolean' ? v : f.def;
}
async function flagSave(id, on) {
  const next = Object.assign({}, flagMap(), { [id]: !!on });
  try { localStorage.setItem(FLAG_LS, JSON.stringify(next)); } catch (e) { /* niet erg */ }
  if (!demo && !sharedView && isWorker() && getToken()) { try { await savePrefs({ flags: next }); } catch (e) { /* blijft in deze browser */ } }
  else if (demo) { try { await savePrefs({ flags: next }); } catch (e) { /* niet erg */ } }
}
function renderFlags() {
  const box = $('flags-body');
  if (!box) return;
  box.innerHTML = '<p class="muted small">Nieuwe functies die je zelf aan of uit kunt zetten. Wat “in ontwikkeling” heet, kan nog veranderen.</p>' +
    SITE_FLAGS.map((f) => '<div class="flag-row"><label class="check small"><input type="checkbox" data-flagpick="' + f.id + '"' + (flagOn(f.id) ? ' checked' : '') + '> <b>' + esc(f.name) + '</b></label>' +
      (f.exp ? '<span class="tag">in ontwikkeling</span>' : '') +
      '<p class="small muted">' + esc(f.what) + ' Standaard: ' + (f.def ? 'aan' : 'uit') + '.</p></div>').join('') +
    '<p class="small plan-status" id="flags-status" role="status"></p>';
}
document.addEventListener('change', async (e) => {
  const cb = /** @type {HTMLInputElement|null} */ (privHit(e, '[data-flagpick]'));
  if (!cb) return;
  await flagSave(cb.dataset.flagpick, cb.checked);
  const st = $('flags-status');
  if (st) st.textContent = cb.checked ? 'Aangezet.' : 'Uitgezet.';
  privApplyFlags();
  renderPrivacy();
});

// ---------- Zoeken in de instellingen (idee 63) ----------
// Per regel: onderdeel, wat je ziet, woorden om op te zoeken en eventueel het blok om naartoe te schuiven
const SET_INDEX = [
  ['links', 'Koppelingen en sleutels', 'bronnen sleutel api trading 212 fmp finnhub sec edgar alpha vantage fred twelve data resend weekmail e-mail agenda ics kopen verkopen orders'],
  ['account', 'Toegangscode en adres van je Worker', 'token code worker adres url inloggen vergeten'],
  ['view', 'Thema, animaties en taal', 'thema licht donker amoled zwart automatisch beweging animaties taal engels duits frans'],
  ['view', 'Accentkleur', 'accent accentkleur kleur blauw groen paars oranje eigen kleur', 'accent-pick'],
  ['view', 'Leesbaarheid en hulp', 'compact grotere tekst kleurenblind rondleiding sneltoetsen'],
  ['push', 'Meldingen op dit apparaat', 'push melding koersbeweging kwartaalcijfers insiders afwijking drempel'],
  ['push', 'Stille uren en bundelen', 'stil nachtrust slapen rustig dagbundel samenvatting uur', 'quiet-box'],
  ['push', 'Verstuurde meldingen', 'logboek geschiedenis wachtrij verstuurd', 'alertlog-box'],
  ['share', 'Deel-link (alleen lezen)', 'delen link meekijken bedragen procenten'],
  ['share', 'Einddatum en links intrekken', 'verlopen einddatum intrekken revoke links', 'sharex-box'],
  ['share', 'Deelplaatje van je maand', 'plaatje afbeelding png maand procenten delen', 'card-box'],
  ['share', 'Vergelijken met iemand anders', 'vriend vergelijken anoniem percentages', 'friend-box'],
  ['privacy', 'Bedragen verbergen', 'privacy verbergen waas blur gebaar sneltoets'],
  ['privacy', 'Functies in ontwikkeling', 'functies vlaggen experimenteel nieuw', 'flags-body'],
  ['privacy', 'Apparaten met toegang', 'apparaat code sessie uitloggen alle apparaten', 'dev-body'],
  ['privacy', 'Voorkeuren meenemen', 'voorkeuren exporteren importeren verhuizen nieuw apparaat bestand', 'prefsio-body'],
  ['privacy', 'Logboek', 'logboek audit wijzigingen inloggen orders', 'audit-body'],
  ['install', 'Als app installeren', 'pwa beginscherm pictogram icoon offline installeren'],
  ['backup', 'Status en reservekopie', 'status meten bronnen reservekopie back-up terugzetten'],
  ['update', 'Updates', 'versie bijwerken nieuwe versie'],
  ['import', 'Geschiedenis uit Google Sheet', 'sheet apps script overnemen geschiedenis'],
];
const SET_TITLES = { links: 'Koppelingen', account: 'Toegang en Worker', view: 'Weergave', push: 'Meldingen', share: 'Delen', privacy: 'Privacy en veiligheid', install: 'Als app installeren', backup: 'Status en reservekopie', update: 'Updates', import: 'Geschiedenis uit Google Sheet' };
function setSearch(q) {
  const box = $('set-hits');
  if (!box) return;
  const words = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) { box.hidden = true; box.innerHTML = ''; return; }
  const hits = SET_INDEX.filter((r) => words.every((w) => (r[1] + ' ' + r[2] + ' ' + (SET_TITLES[r[0]] || '')).toLowerCase().includes(w))).slice(0, 8);
  box.hidden = false;
  box.innerHTML = hits.length
    ? hits.map((r, i) => '<li role="option" aria-selected="false"><button type="button" data-set-hit="' + i + '"><span>' + esc(r[1]) + '</span><span class="muted small">' + esc(SET_TITLES[r[0]] || r[0]) + '</span></button></li>').join('')
    : '<li class="muted small">Niets gevonden. Zoek bijvoorbeeld op “sleutel”, “melding” of “delen”.</li>';
  box.dataset.hits = JSON.stringify(hits);
}
function setSearchOpen(i) {
  const box = $('set-hits');
  let hits = [];
  try { hits = JSON.parse((box && box.dataset.hits) || '[]'); } catch (e) { hits = []; }
  const r = hits[i];
  if (!r) return;
  setGo(r[0]);
  if ($('set-q')) privIn('set-q').value = '';
  setSearch('');
  if (r[3]) {
    const el = $(r[3]);
    if (el) { el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' }); el.classList.add('set-found'); setTimeout(() => el.classList.remove('set-found'), 1600); }
  }
}
if ($('set-q')) {
  privIn('set-q').addEventListener('input', () => setSearch(privIn('set-q').value));
  privIn('set-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); setSearchOpen(0); }
    else if (e.key === 'Escape') { privIn('set-q').value = ''; setSearch(''); }
  });
  $('set-hits').addEventListener('click', (e) => {
    const b = privHit(e, '[data-set-hit]');
    if (b) setSearchOpen(Number(b.dataset.setHit));
  });
}

// ---------- Voorkeuren meenemen naar een ander apparaat (idee 64) ----------
// Alleen voorkeuren: nooit de toegangscode, de deel-link, de agenda-link of sleutels.
const DEVICE_PREF_KEYS = ['theme', 'motion', 'lang', 'icon', 'compact', 'big', 'cb', 'dash', 'hide', 'tour', 'flags'];
function prefsBundle() {
  const device = {};
  DEVICE_PREF_KEYS.forEach((k) => {
    try { const v = localStorage.getItem('tracker.' + k); if (v != null) device[k] = String(v).slice(0, 20000); } catch (e) { /* niet erg */ }
  });
  return { kind: 'investeringstracker-voorkeuren', version: 1, created: new Date().toISOString(), prefs: userPrefs(), device };
}
async function prefsApply(bundle) {
  if (!bundle || bundle.kind !== 'investeringstracker-voorkeuren') throw new Error('dit is geen bestand met voorkeuren van de tracker');
  const dev = bundle.device && typeof bundle.device === 'object' ? bundle.device : {};
  DEVICE_PREF_KEYS.forEach((k) => {
    if (typeof dev[k] !== 'string') return;
    try { localStorage.setItem('tracker.' + k, dev[k].slice(0, 20000)); } catch (e) { /* vol of geblokkeerd */ }
  });
  const p = bundle.prefs;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    if (JSON.stringify(p).length > 40000) throw new Error('de voorkeuren in dit bestand zijn te groot');
    if (!sharedView && (demo || isWorker())) await savePrefs(p);
  }
}
function renderPrefsIO() {
  const box = $('prefsio-body');
  if (!box) return;
  box.innerHTML = '<p class="muted small">Zet je instellingen van de site (volglijstlabels, nieuwsfilters, grenzen, FIRE-kosten, box 3, functies in ontwikkeling) en je keuzes op dit apparaat (thema, taal, paginaopmaak, leesbaarheid) in één bestand. Er gaan geen sleutels, codes of links in; je bedragen ook niet.</p>' +
    '<div class="dlg-actions" style="justify-content:flex-start"><button type="button" class="btn ghost" data-prefs="out">Voorkeuren opslaan in een bestand</button>' +
    '<label class="btn ghost">Voorkeuren inlezen<input type="file" accept=".json,application/json" data-prefs-in hidden></label></div>' +
    '<p class="small plan-status" id="prefsio-status" role="status"></p>';
}
document.addEventListener('click', (e) => {
  if (!privHit(e, '[data-prefs="out"]')) return;
  const st = $('prefsio-status');
  try {
    const blob = new Blob([JSON.stringify(prefsBundle(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'investeringstracker-voorkeuren-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    if (st) { st.textContent = 'Opgeslagen. Open dit bestand op je andere apparaat bij Voorkeuren inlezen.'; st.className = 'small plan-status gain'; }
  } catch (err) { if (st) { st.textContent = 'Mislukt: ' + err.message + '.'; st.className = 'small plan-status loss'; } }
});
document.addEventListener('change', async (e) => {
  const el = /** @type {HTMLInputElement} */ (e.target);
  if (!(el.matches && el.matches('input[type="file"][data-prefs-in]')) || !el.files || !el.files[0]) return;
  const st = $('prefsio-status');
  const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'small plan-status ' + (cls || ''); } };
  try {
    await prefsApply(JSON.parse(await el.files[0].text()));
    say('Ingelezen. De pagina wordt opnieuw geladen om alles toe te passen.', 'gain');
    setTimeout(() => location.reload(), 900);
  } catch (err) { say('Inlezen is mislukt: ' + err.message + '.', 'loss'); }
  el.value = '';
});

// ---------- Meldingen: stille uren, bundelen en wat er verstuurd is (ideeën 65, 66, 67) ----------
let alertState = null;
function quietText(r) {
  if (!r) return '';
  const q = Number(r.quietFrom) !== Number(r.quietTo) ? 'stil van ' + String(r.quietFrom).padStart(2, '0') + ':00 tot ' + String(r.quietTo).padStart(2, '0') + ':00' : 'geen stille uren';
  return q + ' · ' + (r.digest ? 'gebundeld om ' + String(r.digestHour).padStart(2, '0') + ':00' : 'los verstuurd');
}
function hourOpts(sel) {
  let out = '';
  for (let h = 0; h < 24; h++) out += '<option value="' + h + '"' + (Number(sel) === h ? ' selected' : '') + '>' + String(h).padStart(2, '0') + ':00</option>';
  return out;
}
function renderQuiet(msg) {
  const box = $('quiet-body');
  if (!box) return;
  const say = (html) => { box.innerHTML = html + (msg ? '<p class="small plan-status" role="status">' + esc(msg) + '</p>' : ''); };
  if (sharedView) { say('<p class="muted small">Niet beschikbaar in een gedeelde weergave.</p>'); return; }
  if (!alertState) { say('<p class="muted small">' + (demo || isWorker() ? 'Bezig met laden…' : 'Werkt met je eigen Cloudflare Worker.') + '</p>'); return; }
  const r = alertState.rules || {};
  say('<p class="muted small">Tijdens de stille uren gaat er niets af; wat er dan gebeurt, komt daarna als één melding. Met bundelen krijg je hoogstens één melding per dag.</p>' +
    '<div class="alert-rules">' +
      '<label class="small">Stil vanaf<select data-quiet="from">' + hourOpts(r.quietFrom) + '</select></label>' +
      '<label class="small">Stil tot<select data-quiet="to">' + hourOpts(r.quietTo) + '</select></label>' +
      '<label class="check small"><input type="checkbox" data-quiet="digest"' + (r.digest ? ' checked' : '') + '> Bundelen tot één melding per dag</label>' +
      '<label class="small">Bundel versturen om<select data-quiet="hour">' + hourOpts(r.digestHour == null ? 18 : r.digestHour) + '</select></label>' +
    '</div>' +
    '<p class="muted small">Zet “vanaf” en “tot” op hetzelfde uur om de stille uren uit te zetten.</p>' +
    '<div class="dlg-actions" style="justify-content:flex-start;margin-top:6px"><button type="button" class="btn ghost" data-quiet="save">Opslaan</button></div>' +
    (alertState.queue && alertState.queue.length ? '<p class="small">In de wachtrij: ' + alertState.queue.length + ' ' + (alertState.queue.length === 1 ? 'melding' : 'meldingen') + '.</p>' : ''));
}
function renderAlertLog(msg) {
  const box = $('alertlog-body');
  if (!box) return;
  const say = (html) => { box.innerHTML = html + (msg ? '<p class="small plan-status" role="status">' + esc(msg) + '</p>' : ''); };
  if (sharedView) { say('<p class="muted small">Niet beschikbaar in een gedeelde weergave.</p>'); return; }
  if (!alertState) { say('<p class="muted small">' + (demo || isWorker() ? 'Bezig met laden…' : 'Werkt met je eigen Cloudflare Worker.') + '</p>'); return; }
  const log = alertState.log || [];
  if (!log.length) { say('<p class="muted small">Er is nog geen melding verstuurd. Zodra er iets afgaat, staat het hier (de laatste 60).</p>'); return; }
  const mode = (m) => (m === 'direct' ? 'direct' : m === 'bundel' ? 'gebundeld' : m === 'stille uren' ? 'in de wachtrij (stille uren)' : m === 'dagbundel' ? 'in de wachtrij (dagbundel)' : String(m || ''));
  say('<ul class="log-list">' + log.slice(0, 30).map((x) => '<li><span class="log-when">' + esc(fDT.format(new Date(String(x.at).replace(' ', 'T')))) + '</span>' +
    '<b>' + esc(x.title || '') + '</b>' + (x.body ? '<span class="small muted">' + esc(x.body) + '</span>' : '') +
    '<span class="small muted">' + esc(mode(x.mode)) + (x.devices ? ' · ' + x.devices + (x.devices === 1 ? ' apparaat' : ' apparaten') : '') + (x.items ? ' · ' + x.items + ' punten' : '') + '</span></li>').join('') + '</ul>' +
    (log.length > 30 ? '<p class="muted small">Alleen de laatste 30 van ' + log.length + ' worden getoond.</p>' : ''));
}
async function loadAlertState() {
  alertState = null;
  if (sharedView) { renderQuiet(); renderAlertLog(); return; }
  if (demo) { alertState = (data && data.demoPriv && data.demoPriv.alerts) || null; renderQuiet(); renderAlertLog(); return; }
  if (!isWorker() || !getToken()) { renderQuiet(); renderAlertLog(); return; }
  renderQuiet(); renderAlertLog();
  try { alertState = await workerCall('/api/alerts', { method: 'GET' }); renderQuiet(); renderAlertLog(); }
  catch (err) { renderQuiet('Kon de meldingen niet laden: ' + err.message + '.'); renderAlertLog(); }
}
document.addEventListener('click', async (e) => {
  const b = privHit(e, '[data-quiet="save"]');
  if (!b) return;
  const v = (k) => privQ('#quiet-body [data-quiet="' + k + '"]');
  const rules = Object.assign({}, (alertState && alertState.rules) || {}, {
    quietFrom: Number(v('from').value), quietTo: Number(v('to').value),
    digest: v('digest').checked, digestHour: Number(v('hour').value),
  });
  b.disabled = true;
  try {
    await saveSettings({ alerts: rules });
    if (alertState) alertState.rules = rules;
    renderQuiet('Opgeslagen.');
    privSums();
  } catch (err) { renderQuiet('Mislukt: ' + err.message + '.'); }
  finally { b.disabled = false; }
});

// ---------- Deel-link: einddatum en alles intrekken (idee 68) ----------
let shareExtra = null;
function renderShareX(msg) {
  const box = $('sharex-body');
  if (!box) return;
  const say = (html) => { box.innerHTML = html + (msg ? '<p class="small plan-status" role="status">' + esc(msg) + '</p>' : ''); };
  if (sharedView) { say('<p class="muted small">Niet beschikbaar in een gedeelde weergave.</p>'); return; }
  if (demo) { say('<p class="muted small">In de voorbeeldweergave kun je geen links maken of intrekken. Met je eigen tracker kies je hier een einddatum en kun je in één keer alle links intrekken.</p>'); return; }
  if (!isWorker() || !getToken()) { say('<p class="muted small">Werkt met je eigen Cloudflare Worker.</p>'); return; }
  if (!shareExtra) { say('<p class="muted small">Bezig met laden…</p>'); return; }
  const days = [[0, 'Geen einddatum'], [7, 'Na 7 dagen'], [30, 'Na 30 dagen'], [90, 'Na 90 dagen']];
  const until = shareExtra.until ? new Date(String(shareExtra.until).replace(' ', 'T')) : null;
  say((shareExtra.on
    ? '<label class="small">Deel-link verloopt<select data-sharex="days">' + days.map(([d, l]) => '<option value="' + d + '"' + ((!until && d === 0) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>' +
      '<p class="small' + (until ? '' : ' muted') + '">' + (until ? 'Deze link werkt tot ' + esc(fD.format(until)) + '. Daarna geeft hij alleen nog een melding dat hij verlopen is.' : 'Deze link blijft werken tot je hem intrekt.') + '</p>' +
      '<div class="dlg-actions" style="justify-content:flex-start;margin-top:6px"><button type="button" class="btn ghost" data-sharex="save">Einddatum opslaan</button></div>'
    : '<p class="muted small">Er is nu geen deel-link. Maak er hierboven een, dan kun je hier een einddatum kiezen.</p>') +
    '<p class="muted small" style="margin-top:10px">In één keer alles intrekken: de deel-link én de agenda-link. Daarna werkt geen enkele link meer die je eerder hebt gegeven.</p>' +
    '<div class="dlg-actions" style="justify-content:flex-start"><button type="button" class="btn ghost danger" data-sharex="revoke">Alle links intrekken</button></div>');
}
async function loadShareX() {
  shareExtra = null;
  if (demo || sharedView || !isWorker() || !getToken()) { renderShareX(); return; }
  renderShareX();
  try { shareExtra = await workerCall('/api/share', { method: 'GET' }); renderShareX(); }
  catch (err) { renderShareX('Kon de deel-link niet laden: ' + err.message + '.'); }
}
document.addEventListener('click', async (e) => {
  const b = privHit(e, '[data-sharex]');
  if (!b) return;
  const act = b.dataset.sharex;
  b.disabled = true;
  try {
    if (act === 'save') {
      const sel = privQ('#sharex-body [data-sharex="days"]');
      await workerCall('/api/share', { method: 'POST', body: JSON.stringify({ action: 'update', amounts: !!(shareExtra && shareExtra.amounts), days: Number(sel.value) || 0 }) });
      await loadShareX();
      renderShareX(Number(sel.value) ? 'Einddatum opgeslagen.' : 'De einddatum is weggehaald.');
    } else if (act === 'revoke') {
      if (!confirm('Alle links intrekken? De deel-link en de agenda-link werken daarna niet meer. Je eigen toegang blijft gewoon werken.')) return;
      const r = await workerCall('/api/revoke', { method: 'POST', body: JSON.stringify({ links: true }) });
      await loadShareX();
      if (typeof renderShare === 'function') renderShare();
      renderShareX(r.links && r.links.length ? 'Ingetrokken: ' + r.links.join(' en ') + '.' : 'Er waren geen links om in te trekken.');
      privSums();
    }
  } catch (err) { renderShareX('Mislukt: ' + err.message + '.'); }
  finally { b.disabled = false; }
});

// ---------- Rendement in procenten (voor het deelplaatje en de vergelijking) ----------
// Per periode: (waardeverandering − nieuwe inleg) / waarde aan het begin, uit de weekmetingen.
function pctFromWeeks(weeks) {
  const w = (weeks || []).filter((x) => x && isNum(Number(x.accountValue)));
  const last = w[w.length - 1];
  if (!last) return { week: null, month: null, ytd: null, total: null };
  const since = (from) => {
    const i = w.findIndex((x) => String(x.date) >= from);
    const base = i > 0 ? w[i - 1] : i === 0 ? w[0] : null;
    if (!base || !(base.accountValue > 0) || base === last) return null;
    return (last.accountValue - base.accountValue - (last.netDeposits - base.netDeposits)) / base.accountValue;
  };
  const lastT = Date.parse(String(last.date).slice(0, 19)) || Date.now();
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  return {
    week: last.weekResultPct == null ? null : last.weekResultPct,
    month: since(iso(lastT - 30 * DAY)),
    ytd: since(String(last.date).slice(0, 4) + '-01-01'),
    total: last.totalResultPct == null ? null : last.totalResultPct,
  };
}
const ownPct = () => pctFromWeeks(data && data.weeks);

// ---------- Deelplaatje: je maand in procenten, zonder bedragen (idee 69) ----------
function renderCard() {
  const box = $('card-body');
  if (!box) return;
  if (!flagOn('shareCard')) { box.innerHTML = '<p class="muted small">Staat uit bij Functies in ontwikkeling (Privacy en veiligheid).</p>'; return; }
  const P = ownPct();
  if (!data || !data.weeks || data.weeks.length < 2 || P.month == null) {
    box.innerHTML = '<p class="muted small">Hiervoor zijn minstens twee weekmetingen nodig. Zodra je tracker een paar weken meet, kun je hier een plaatje maken.</p>';
    return;
  }
  box.innerHTML = '<p class="muted small">Een plaatje van je rendement in procenten: 30 dagen, dit jaar en sinds het begin. Zonder bedragen, zonder aandelen, zonder naam.</p>' +
    '<p class="small">30 dagen <b class="' + tone(P.month) + '">' + spct1(P.month) + '</b>' + (P.ytd == null ? '' : ' · dit jaar <b class="' + tone(P.ytd) + '">' + spct1(P.ytd) + '</b>') + '</p>' +
    '<div class="dlg-actions" style="justify-content:flex-start"><button type="button" class="btn ghost" data-card="png">Plaatje opslaan</button></div>' +
    '<p class="small plan-status" id="card-status" role="status"></p>';
}
function paintShareCard(P) {
  const cv = document.createElement('canvas');
  cv.width = 1080; cv.height = 1080;
  const g = cv.getContext('2d');
  const up = (P.month || 0) >= 0;
  const grd = g.createLinearGradient(0, 0, 1080, 1080);
  grd.addColorStop(0, up ? '#0A5F3B' : '#8C2718');
  grd.addColorStop(1, up ? '#0B7A4B' : '#B4311F');
  g.fillStyle = grd; g.fillRect(0, 0, 1080, 1080);
  g.fillStyle = '#fff';
  g.font = '600 42px Inter, system-ui, sans-serif';
  g.fillText('Mijn beleggingen, laatste 30 dagen', 80, 150);
  g.font = '800 200px Inter, system-ui, sans-serif';
  g.fillText(spct1(P.month), 70, 380);
  const rows = [['Dit jaar', P.ytd == null ? '–' : spct1(P.ytd)], ['Sinds het begin', P.total == null ? '–' : spct1(P.total)], ['Laatste week', P.week == null ? '–' : spct1(P.week)]];
  rows.forEach(([k, v], i) => {
    const y = 540 + i * 140;
    g.globalAlpha = 0.75; g.font = '500 36px Inter, system-ui, sans-serif'; g.fillText(k, 80, y);
    g.globalAlpha = 1; g.font = '700 64px Inter, system-ui, sans-serif'; g.fillText(v, 80, y + 70);
  });
  g.globalAlpha = 0.6;
  g.font = '400 28px Inter, system-ui, sans-serif';
  g.fillText('Alleen percentages, geen bedragen · Investeringstracker', 80, 1010);
  g.fillText('Geen beleggingsadvies', 80, 1050);
  return cv;
}
document.addEventListener('click', (e) => {
  if (!privHit(e, '[data-card="png"]')) return;
  const st = $('card-status');
  const P = ownPct();
  paintShareCard(P).toBlob((blob) => {
    if (!blob) { if (st) st.textContent = 'Het plaatje kon niet worden gemaakt.'; return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mijn-maand-' + new Date().toISOString().slice(0, 7) + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    if (st) { st.textContent = 'Opgeslagen als afbeelding.'; st.className = 'small plan-status gain'; }
  });
});

// ---------- Vergelijken met iemand anders, alleen percentages (idee 84) ----------
const FRIEND_LS = 'tracker.friend';
let friendState = null;
function renderFriend(msg) {
  const box = $('friend-body');
  if (!box) return;
  const say = (html) => { box.innerHTML = html + (msg ? '<p class="small plan-status" role="status">' + esc(msg) + '</p>' : ''); };
  if (!flagOn('friendCompare')) { say('<p class="muted small">Zet “Vergelijken met iemand anders” aan bij Functies in ontwikkeling (Privacy en veiligheid).</p>'); return; }
  if (sharedView) { say('<p class="muted small">Niet beschikbaar in een gedeelde weergave.</p>'); return; }
  let saved = '';
  try { saved = localStorage.getItem(FRIEND_LS) || ''; } catch (e) { saved = ''; }
  const mine = ownPct();
  const rows = friendState ? [['Laatste week', mine.week, friendState.pct.week], ['30 dagen', mine.month, friendState.pct.month],
    ['Dit jaar', mine.ytd, friendState.pct.ytd], ['Sinds het begin', mine.total, friendState.pct.total]] : [];
  say('<p class="muted small">Plak de deel-link van een andere tracker. Je ziet alleen percentages: geen bedragen, geen aandelen, geen naam. De link gaat naar je eigen Worker, die hem niet bewaart' + (demo ? ' (in de voorbeeldweergave zijn de getallen van de ander verzonnen)' : '') + '.</p>' +
    '<div class="key-in"><input id="friend-url" type="url" inputmode="url" spellcheck="false" placeholder="https://…/share/code" value="' + esc(saved) + '" aria-label="Deel-link van iemand anders">' +
    '<button type="button" class="btn ghost" data-friend="go">Vergelijken</button></div>' +
    (friendState ? '<table class="tbl cmp-tbl"><thead><tr><th>Periode</th><th class="num">Jij</th><th class="num">De ander</th><th class="num">Verschil</th></tr></thead><tbody>' +
      rows.map(([lbl, a, b2]) => '<tr><td>' + esc(lbl) + '</td><td class="num ' + tone(a) + '">' + (a == null ? '–' : spct1(a)) + '</td>' +
        '<td class="num ' + tone(b2) + '">' + (b2 == null ? '–' : spct1(b2)) + '</td>' +
        '<td class="num ' + (a == null || b2 == null ? '' : tone(a - b2)) + '">' + (a == null || b2 == null ? '–' : spct1(a - b2)) + '</td></tr>').join('') +
      '</tbody></table><p class="muted small">Gegevens van de ander van ' + esc(friendState.generated ? fDT.format(new Date(String(friendState.generated).replace(' ', 'T'))) : 'onbekend') + '. Percentages zeggen niets over bedragen: wie met weinig geld begint, haalt makkelijker uitschieters.</p>' : '') +
    '<p class="small plan-status" id="friend-status" role="status"></p>');
}
document.addEventListener('click', async (e) => {
  const b = privHit(e, '[data-friend="go"]');
  if (!b) return;
  const inp = privIn('friend-url');
  const url = (inp.value || '').trim();
  const st = $('friend-status');
  const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'small plan-status ' + (cls || ''); } };
  if (!/^https:\/\/[A-Za-z0-9.-]{3,80}\/share\/[A-Za-z0-9_-]{20,80}$/.test(url)) { say('Dit is geen deel-link. Een deel-link ziet eruit als https://…workers.dev/share/<code>.', 'loss'); return; }
  b.disabled = true;
  say('Bezig met ophalen…');
  try {
    if (demo) {
      friendState = (data && data.demoPriv && data.demoPriv.friend) || null;
      if (!friendState) throw new Error('geen voorbeeldgegevens');
    } else {
      if (!isWorker() || !getToken()) throw new Error('dit werkt met je eigen Cloudflare Worker');
      friendState = await workerCall('/api/friend', { method: 'POST', body: JSON.stringify({ url }) });
    }
    try { localStorage.setItem(FRIEND_LS, url); } catch (err) { /* niet erg */ }
    renderFriend('Opgehaald.');
  } catch (err) { renderFriend('Mislukt: ' + err.message + '.'); }
  finally { b.disabled = false; }
});

// ---------- Apparaten met toegang (idee 157) ----------
let devState = null;
function renderDevices(msg) {
  const box = $('dev-body');
  if (!box) return;
  const say = (html) => { box.innerHTML = html + (msg ? '<p class="small plan-status" role="status">' + esc(msg) + '</p>' : ''); };
  if (sharedView) { say('<p class="muted small">Niet beschikbaar in een gedeelde weergave.</p>'); return; }
  if (demo) { devState = (data && data.demoPriv && data.demoPriv.devices) || null; }
  else if (!isWorker() || !getToken()) { say('<p class="muted small">Werkt met je eigen Cloudflare Worker.</p>'); return; }
  if (!devState) { say('<p class="muted small">Bezig met laden…</p>'); return; }
  const list = devState.devices || [];
  const when = (s) => (s ? fDT.format(new Date(String(s).replace(' ', 'T'))) : '–');
  say('<p class="muted small">Elk apparaat kan zijn eigen code krijgen. Die staat alleen in dat apparaat; je Worker bewaart er een versleutelde afdruk van. Zo hoeft je toegangscode niet in elke browser te staan, en kun je in één keer alle apparaten uitloggen. Je toegangscode zelf blijft werken: die staat als geheim bij Cloudflare.</p>' +
    (devState.master ? '<p class="small"><span class="tag">Let op</span> Dit apparaat gebruikt de toegangscode zelf. Geef het een eigen code, dan staat de toegangscode niet meer in deze browser.</p>' : '<p class="small"><span class="tag gain">Eigen code</span> Dit apparaat gebruikt een eigen code.</p>') +
    (list.length ? '<ul class="log-list">' + list.map((d) => '<li><b>' + esc(d.label || 'Apparaat') + '</b>' + (devState.current && d.id === devState.current ? ' <span class="tag gain">dit apparaat</span>' : '') +
      '<span class="small muted">aangemeld ' + esc(when(d.at)) + ' · laatst gezien ' + esc(when(d.seen)) + (d.until ? ' · verloopt ' + esc(when(d.until)) : '') + '</span></li>').join('') + '</ul>'
      : '<p class="muted small">Nog geen apparaat met een eigen code.</p>') +
    '<div class="dlg-actions" style="justify-content:flex-start"><button type="button" class="btn ghost" data-dev="new">Dit apparaat een eigen code geven</button>' +
    (list.length ? '<button type="button" class="btn ghost danger" data-dev="revoke">Uitloggen op alle apparaten</button>' : '') + '</div>');
}
async function loadDevices() {
  devState = null;
  if (sharedView) { renderDevices(); return; }
  if (demo) { renderDevices(); return; }
  if (!isWorker() || !getToken()) { renderDevices(); return; }
  renderDevices();
  try { devState = await workerCall('/api/sessions', { method: 'GET' }); renderDevices(); }
  catch (err) { renderDevices('Kon de apparaten niet laden: ' + err.message + '. Werk je Worker bij als dit blijft.'); }
}
document.addEventListener('click', async (e) => {
  const b = privHit(e, '[data-dev]');
  if (!b) return;
  const act = b.dataset.dev;
  if (demo) { renderDevices('In de voorbeeldweergave kun je geen codes maken of intrekken.'); return; }
  b.disabled = true;
  try {
    if (act === 'new') {
      const label = /android/i.test(navigator.userAgent) ? 'Android' : /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone/iPad' : /windows/i.test(navigator.userAgent) ? 'Windows' : /mac os/i.test(navigator.userAgent) ? 'Mac' : 'Apparaat';
      const r = await workerCall('/api/sessions', { method: 'POST', body: JSON.stringify({ label }) });
      if (!r.session) throw new Error('de Worker gaf geen code terug');
      localStorage.setItem(LS_TOKEN, r.session);
      await loadDevices();
      renderDevices('Dit apparaat heeft nu zijn eigen code; je toegangscode staat niet meer in deze browser.');
    } else if (act === 'revoke') {
      if (!confirm('Op alle apparaten uitloggen? Elk apparaat met een eigen code moet daarna opnieuw inloggen, ook dit apparaat.')) return;
      await workerCall('/api/revoke', { method: 'POST', body: JSON.stringify({ devices: true }) });
      devState = null;
      renderDevices('Alle apparaatcodes zijn ingetrokken. Vul hierboven bij Toegang je toegangscode in om verder te werken.');
    }
    privSums();
  } catch (err) { renderDevices('Mislukt: ' + err.message + '.'); }
  finally { b.disabled = false; }
});

// ---------- Logboek van je tracker (idee 161) ----------
let auditState = null;
function renderAudit(msg) {
  const box = $('audit-body');
  if (!box) return;
  const say = (html) => { box.innerHTML = html + (msg ? '<p class="small plan-status" role="status">' + esc(msg) + '</p>' : ''); };
  if (sharedView) { say('<p class="muted small">Niet beschikbaar in een gedeelde weergave.</p>'); return; }
  if (demo) auditState = (data && data.demoPriv && data.demoPriv.audit) || null;
  else if (!isWorker() || !getToken()) { say('<p class="muted small">Werkt met je eigen Cloudflare Worker.</p>'); return; }
  if (!auditState) { say('<p class="muted small">Bezig met laden…</p>'); return; }
  const log = auditState.log || [];
  const KIND = { sleutel: 'Sleutel', inloggen: 'Inloggen', order: 'Order', link: 'Link', apparaat: 'Apparaat', vergelijken: 'Vergelijken' };
  if (!log.length) { say('<p class="muted small">Nog niets te melden. Hier komt te staan wanneer er een sleutel is gewijzigd, iemand inlogde, er een order liep en wanneer links of apparaatcodes zijn gemaakt of ingetrokken.</p>'); return; }
  say('<p class="muted small">De laatste honderd gebeurtenissen in je eigen Worker. Er staan nooit sleutels, codes of bedragen in.</p>' +
    '<ul class="log-list">' + log.slice(0, 40).map((x) => '<li><span class="log-when">' + esc(fDT.format(new Date(String(x.at).replace(' ', 'T')))) + '</span>' +
      '<b>' + esc(KIND[x.kind] || x.kind || '') + '</b><span class="small muted">' + esc(x.msg || '') + '</span></li>').join('') + '</ul>' +
    (log.length > 40 ? '<p class="muted small">Alleen de laatste 40 van ' + log.length + ' worden getoond.</p>' : ''));
}
async function loadAudit() {
  auditState = null;
  if (demo || sharedView) { renderAudit(); return; }
  if (!isWorker() || !getToken()) { renderAudit(); return; }
  renderAudit();
  try { auditState = await workerCall('/api/audit', { method: 'GET' }); renderAudit(); }
  catch (err) { renderAudit('Kon het logboek niet laden: ' + err.message + '. Werk je Worker bij als dit blijft.'); }
}

// ---------- Privacyscherm en snel verbergen (ideeën 159, 160) ----------
function privBlur(on) {
  document.documentElement.classList.toggle('privacy-blur', !!on);
  const el = $('priv-veil');
  if (on && !el) {
    const d = document.createElement('div');
    d.id = 'priv-veil';
    d.className = 'priv-veil';
    d.setAttribute('role', 'status');
    d.textContent = 'Tik om je bedragen weer te zien';
    document.body.appendChild(d);
  } else if (!on && el) el.remove();
}
let privIdleTimer = null;
function privIdle() {
  clearTimeout(privIdleTimer);
  if (document.documentElement.classList.contains('privacy-blur')) privBlur(false);
  if (!flagOn('blurIdle')) return;
  privIdleTimer = setTimeout(() => privBlur(true), 120000);
}
function privApplyFlags() {
  clearTimeout(privIdleTimer);
  privBlur(false);
  if (flagOn('blurIdle')) privIdle();
}
document.addEventListener('visibilitychange', () => {
  if (!flagOn('privacyBlur')) return;
  if (document.visibilityState === 'hidden') privBlur(true);
  else privIdle();
});
window.addEventListener('blur', () => { if (flagOn('privacyBlur')) privBlur(true); });
window.addEventListener('focus', () => { if (flagOn('privacyBlur') || flagOn('blurIdle')) privIdle(); });
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => {
  if (document.documentElement.classList.contains('privacy-blur') || flagOn('blurIdle')) privIdle();
}, { passive: true }));

function privToggleHide() {
  const b = $$('.btn-hide')[0];
  if (b) b.click();
}
// Toets: Ctrl+Shift+H werkt ook terwijl je in een veld typt (de losse h-toets zit in 18-gemak.js)
document.addEventListener('keydown', (e) => {
  if (!flagOn('quickHide')) return;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); privToggleHide(); }
});
// Gebaar: met twee vingers kort tikken (niet in een grafiek, want daar knijp je om te zoomen)
let privTwo = 0, privTwoXY = null;
document.addEventListener('touchstart', (e) => {
  if (!flagOn('quickHide') || e.touches.length !== 2) { privTwo = 0; return; }
  if (privHit(e, '.chart, canvas, input, textarea, select')) { privTwo = 0; return; }
  privTwo = Date.now();
  privTwoXY = [e.touches[0].clientX, e.touches[0].clientY, e.touches[1].clientX, e.touches[1].clientY];
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!privTwo || !privTwoXY || e.touches.length !== 2) return;
  const d = Math.abs(e.touches[0].clientX - privTwoXY[0]) + Math.abs(e.touches[0].clientY - privTwoXY[1]) +
    Math.abs(e.touches[1].clientX - privTwoXY[2]) + Math.abs(e.touches[1].clientY - privTwoXY[3]);
  if (d > 24) privTwo = 0;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!privTwo || e.touches.length) return;
  const quick = Date.now() - privTwo < 500;
  privTwo = 0;
  if (quick) privToggleHide();
}, { passive: true });

function renderHidePriv() {
  const box = $('hidepriv-body');
  if (!box) return;
  box.innerHTML = '<p class="muted small">Bedragen staan nu <b>' + (hideAmounts ? 'verborgen' : 'aan') + '</b>. Verbergen vervangt elk bedrag door puntjes; procenten en verhoudingen blijven staan.</p>' +
    '<div class="dlg-actions" style="justify-content:flex-start"><button type="button" class="btn ghost btn-hide-x">' + (hideAmounts ? 'Bedragen tonen' : 'Bedragen verbergen') + '</button></div>' +
    '<p class="muted small">Snel: twee vingers tikken op de telefoon, <kbd>h</kbd> op de computer, of <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> ook terwijl je typt. Dat gebaar en die toets zet je uit bij Functies in ontwikkeling.</p>';
}
document.addEventListener('click', (e) => {
  if (!privHit(e, '.btn-hide-x')) return;
  privToggleHide();
  renderHidePriv();
});

// ---------- Alles in het onderdeel Privacy en veiligheid tekenen ----------
function privSums() {
  const put = (k, t) => { const el = document.querySelector('[data-set-sum="' + k + '"]'); if (el) el.textContent = t; };
  const on = SITE_FLAGS.filter((f) => flagOn(f.id)).length;
  put('privacy', (hideAmounts ? 'bedragen verborgen · ' : '') + on + ' van ' + SITE_FLAGS.length + ' functies aan');
}
function renderPrivacy() {
  renderHidePriv();
  renderFlags();
  renderPrefsIO();
  renderCard();
  renderFriend();
  loadDevices();
  loadAudit();
  loadAlertState();
  loadShareX();
  privSums();
}

// ---------- Engels (Duits en Frans vallen terug op het Engels) ----------
Object.assign(EN, {
  'Privacy en veiligheid': 'Privacy and security', 'Zoeken in instellingen': 'Search settings', 'Bedragen verbergen': 'Hide amounts', 'Bedragen tonen': 'Show amounts',
  'Functies in ontwikkeling': 'Features in development', 'in ontwikkeling': 'in development', 'Apparaten met toegang': 'Devices with access',
  'Dit apparaat een eigen code geven': 'Give this device its own code', 'Uitloggen op alle apparaten': 'Sign out on all devices',
  'Voorkeuren meenemen naar een ander apparaat': 'Take your preferences to another device', 'Voorkeuren opslaan in een bestand': 'Save preferences to a file',
  'Voorkeuren inlezen': 'Load preferences', 'Logboek': 'Log', 'Stille uren en bundelen': 'Quiet hours and bundling', 'Stil vanaf': 'Quiet from', 'Stil tot': 'Quiet until',
  'Bundelen tot één melding per dag': 'Bundle into one notification per day', 'Bundel versturen om': 'Send bundle at', 'Verstuurde meldingen': 'Notifications sent',
  'Einddatum en links intrekken': 'Expiry and revoking links', 'Alle links intrekken': 'Revoke all links', 'Einddatum opslaan': 'Save expiry', 'Geen einddatum': 'No expiry',
  'Deelplaatje van je maand': 'Share card of your month', 'Plaatje opslaan': 'Save image', 'Vergelijken met iemand anders': 'Compare with someone else', 'Vergelijken': 'Compare',
  'Periode': 'Period', 'Jij': 'You', 'De ander': 'The other', 'Verschil': 'Difference', 'Laatste week': 'Last week', 'Sinds het begin': 'Since the start',
  'Privacyscherm': 'Privacy screen', 'Snel verbergen': 'Quick hide', 'Opslaan': 'Save',
});
