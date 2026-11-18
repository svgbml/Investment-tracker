/* Investeringstracker – Instellingen, koppelingen, bedragen verbergen, thema, agenda-link, weergave en laden
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Instellingen ----------
const getToken = () => localStorage.getItem(LS_TOKEN) || '';
const WEBAPP_RE = /^(https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec|https:\/\/[A-Za-z0-9.-]+\/api\/data)$/;
const SHEET_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const getUrl = () => {
  const saved = localStorage.getItem(LS_URL) || '';
  if (saved && !WEBAPP_RE.test(saved)) localStorage.removeItem(LS_URL);
  return (WEBAPP_RE.test(saved) ? saved : '') || CFG.apiUrl || '';
};
const isWorker = () => /\/api\/data$/.test(getUrl());

// Gedeelde weergave (?gedeeld=<adres van de Worker, base64url>.<code>): alleen lezen, zonder toegangscode
const sharedView = (() => {
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{20,80})$/.exec(new URLSearchParams(location.search).get('gedeeld') || '');
  if (!m) return null;
  try {
    let t = m[1].replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '=';
    const origin = atob(t);
    return /^https:\/\/[A-Za-z0-9.-]+$/.test(origin) ? { origin, token: m[2] } : null;
  } catch (e) { return null; }
})();

function openSettings(showImport) {
  $('in-token').value = getToken();
  $('in-url').value = localStorage.getItem(LS_URL) || '';
  const box = $('import-box');
  const ready = isWorker() && !!getToken();
  $('btn-import').disabled = !ready;
  $('import-status').textContent = ready ? '' : 'Werkt alleen met de Cloudflare Worker. Vul eerst hierboven je toegangscode in (en zo nodig bij “Ander adres” het adres van de Worker) en kies Opslaan en laden.';
  $('import-status').className = 'small muted';
  if (showImport === true || (M && M.canImport && !M.weeks.length)) box.open = true;
  if (!$('in-sheet-url').value) $('in-sheet-url').value = SHEET_RE.test(CFG.sheetUrl || '') ? CFG.sheetUrl : SHEET_RE.test(CFG.apiUrl || '') ? CFG.apiUrl : '';
  if (!getToken()) $('url-box').open = true;
  const F = data && data.features && data.features.has;
  if (F && (!F.t212 || !F.fmp || !F.finnhub || !F.sec)) $('links-box').open = true;
  loadLinks();
  if (typeof renderPush === 'function') { renderPush(); renderShare(); }
  $('dlg-settings').showModal();
  if (!getToken() && !demo) setGo('account');
  else if (showImport === true) setGo('import');
  else if (matchMedia('(max-width: 760px)').matches) setList();
  else setGo(setCur || 'links');
}

// ---------- Instellingen als pagina: een lijst met onderdelen, één onderdeel tegelijk ----------
let setCur = null;
function setGo(k) {
  setCur = k;
  $$('#form-settings .set-sec').forEach((el) => { const s = /** @type {HTMLElement} */ (el); s.hidden = s.dataset.set !== k; });
  $$('#form-settings [data-set-go]').forEach((b) => b.setAttribute('aria-current', String(/** @type {HTMLElement} */ (b).dataset.setGo === k)));
  $('form-settings').dataset.view = 'sec';
  $('dlg-settings').scrollTop = 0;
  setSums();
}
function setList() {
  $('form-settings').dataset.view = 'list';
  $$('#form-settings [data-set-go]').forEach((b) => b.setAttribute('aria-current', 'false'));
  setSums();
}
function setSums() {
  const put = (k, t) => { const el = document.querySelector('[data-set-sum="' + k + '"]'); if (el) el.textContent = t; };
  const th = (() => { try { return localStorage.getItem('tracker.theme') || 'auto'; } catch (e) { return 'auto'; } })();
  const L = linkState;
  const on = L ? LINKS.filter((x) => { const ks = (x.keys || []).filter((k) => !k[2]).map((k) => L.keys[String(k[0])]); return x.flag ? L.flags[String(x.flag)] !== false && (!x.keys || x.optKeys || ks.every(Boolean)) : ks.every(Boolean); }).length : null;
  put('links', demo ? 'alles aan met voorbeeldgegevens' : on == null ? 'je bronnen en extra functies' : on + ' van ' + LINKS.length + ' aan');
  put('account', getToken() ? 'gekoppeld · code in deze browser' : 'nog niet gekoppeld');
  put('view', ({ light: 'Licht', dark: 'Donker', auto: 'Automatisch' })[th] + ' · ' + ({ nl: 'Nederlands', en: 'English', de: 'Deutsch', fr: 'Français' })[LANG]);
  put('push', 'koersbewegingen, cijfers en insiders');
  put('share', 'een link om mee te kijken');
  put('install', 'op je beginscherm, met meldingen');
  put('backup', 'meetstatus en reservekopie');
  put('update', ($('app-version') && $('app-version').textContent) || '');
  put('import', 'optioneel, eenmalig');
}
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  if (!t || !t.closest) return;
  const go = /** @type {HTMLElement|null} */ (t.closest('[data-set-go]'));
  if (go) { setGo(go.dataset.setGo); return; }
  if (t.closest('[data-set-back]')) { setList(); return; }
  if (t.closest('[data-set-close]')) /** @type {HTMLDialogElement} */ ($('dlg-settings')).close();
});

$('form-settings').addEventListener('submit', (e) => {
  const action = e.submitter && e.submitter.value;
  if (action === 'save') {
    const t = $('in-token').value.trim();
    const u = $('in-url').value.trim();
    if (u && !WEBAPP_RE.test(u)) {
      e.preventDefault();
      const el = $('url-hint');
      el.textContent = 'Dit adres wordt niet herkend. Gebruik het adres van je Cloudflare Worker (eindigt op /api/data) of van de Apps Script web-app (eindigt op /exec). Laat het veld leeg voor het standaardadres.';
      el.classList.add('loss');
      $('in-url').focus();
      return;
    }
    if (t) localStorage.setItem(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN);
    if (u) localStorage.setItem(LS_URL, u); else localStorage.removeItem(LS_URL);
    demo = false;
    load();
  } else if (action === 'forget') {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_LAST);
    idbDel('last');
    data = null;
    showWelcome();
  }
});

// Enter in een veld mag nooit "Code vergeten" uitvoeren
$('form-settings').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  e.preventDefault();
  if (e.target.closest('#import-box')) $('btn-import').click();
  else if (e.target.dataset.key) { const b = document.querySelector('[data-savekey="' + e.target.dataset.key + '"]'); if (b) b.click(); }
  else $('form-settings').requestSubmit($('btn-save'));
});

$('btn-import').addEventListener('click', async () => {
  const st = $('import-status');
  const btn = $('btn-import');
  const u = $('in-sheet-url').value.trim();
  const tk = $('in-sheet-token').value.trim();
  const say = (txt, cls) => { st.textContent = txt; st.className = 'small ' + (cls || 'muted'); };
  if (!SHEET_RE.test(u)) { say('Vul het adres van de sheet-web-app in; het eindigt op /exec.', 'loss'); return; }
  if (!tk) { say('Vul de toegangscode van de sheet in.', 'loss'); return; }
  say('Bezig met overnemen. Dit kan een halve minuut duren…');
  btn.disabled = true;
  try {
    const res = await fetch(getUrl().replace(/\/api\/data$/, '/api/import'), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: u, token: tk }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'de Worker gaf status ' + res.status);
    const im = j.imported || {};
    say('Overgenomen: ' + NI.format(im.weeks || 0) + ' weken, ' + NI.format(im.days || 0) + ' dagregels, ' + NI.format(im.hours || 0) +
      ' uurregels en ' + NI.format(im.intraday || 0) + ' metingen. De gegevens worden opnieuw geladen.', 'gain');
    $('in-sheet-token').value = '';
    load();
  } catch (err) {
    say('Overnemen is mislukt: ' + err.message + '.', 'loss');
  } finally {
    btn.disabled = false;
  }
});


// ---------- Koppelingen en functies (sleutels voor extra bronnen) ----------
const LINKS = [
  { id: 't212', title: 'Trading 212', need: 'vereist', what: 'Je posities, orders, dividenden en saldo. Sleutel aanmaken in de Trading 212-app: Instellingen > API. Alleen-lezen is genoeg, tenzij je ook wilt kopen en verkopen via de app (dan ook het recht om orders te plaatsen).',
    keys: [['T212_KEY', 'API-sleutel'], ['T212_SECRET', 'API-secret']], href: 'https://docs.trading212.com/api' },
  { id: 'fmp', title: 'Financial Modeling Prep', need: 'gratis sleutel', what: 'Agenda (kwartaalcijfers, dividenden), sector en branche, vergelijkbare bedrijven.',
    keys: [['FMP_KEY', 'API-sleutel']], href: 'https://site.financialmodelingprep.com/register' },
  { id: 'finnhub', title: 'Finnhub', need: 'gratis sleutel', what: 'Nieuws per aandeel, wat analisten vinden, verrassingen bij kwartaalcijfers en insiderhandel (Amerikaanse aandelen).',
    keys: [['FINNHUB_KEY', 'API-sleutel']], href: 'https://finnhub.io/register' },
  { id: 'av', title: 'Alpha Vantage', need: 'gratis sleutel (reserve)', what: 'Reserve voor Finnhub: vult nieuws, nieuwsstemming, analisten, koersdoel, kwartaalcijfers en insiderhandel aan als Finnhub ze niet levert. Gratis zijn 25 verzoeken per dag, dus een paar aandelen per dag.',
    keys: [['ALPHAVANTAGE_KEY', 'API-sleutel']], href: 'https://www.alphavantage.co/support/#api-key' },
  { id: 'sec', title: 'SEC EDGAR', need: 'e-mailadres', what: 'Bedrijfscijfers over meerdere jaren (omzet, winst, marge) uit de officiële jaarverslagen. De SEC vraagt een contactadres bij elk verzoek; dat blijft in je Worker.',
    keys: [['SEC_CONTACT', 'Je e-mailadres']], flag: 'sec', href: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces' },
  { id: 'fx', title: 'Euro-dollarkoers (ECB)', need: 'geen sleutel', what: 'Referentiekoersen van de Europese Centrale Bank via Frankfurter, voor het valuta-overzicht.', flag: 'fx', href: 'https://frankfurter.dev/' },
  { id: 'inflation', title: 'Inflatie (ECB)', need: 'geen sleutel', what: 'De HICP-prijsindex voor Nederland en de eurozone, voor je rendement na inflatie.', flag: 'inflation', href: 'https://data.ecb.europa.eu/main-figures/inflation' },
  { id: 'indices', title: 'Indexen (FRED)', need: 'geen sleutel nodig', what: 'Dagkoersen van de S&P 500 en de Nasdaq-100 voor "wat als alles in de index had gezeten" en voor het risico van je indexfondsen. Weigert FRED de gewone download, vul dan een gratis FRED-sleutel in.',
    keys: [['FRED_KEY', 'FRED-sleutel (optioneel)']], optKeys: true, flag: 'indices', href: 'https://fred.stlouisfed.org/docs/api/api_key.html' },
  { id: 'etfAuto', title: 'Fondssamenstelling automatisch (iShares)', need: 'geen sleutel', what: 'Probeert wekelijks de samenstelling van je indexfondsen op te halen. Lukt dat niet, dan kun je het bestand zelf toevoegen op Plannen.', flag: 'etfAuto' },
  { id: 'twelvedata', title: 'Twelve Data (koersgeschiedenis, reserve)', need: 'gratis sleutel', what: 'Dagkoersen van het afgelopen jaar voor aandelen waarvoor het gratis FMP-abonnement geen geschiedenis geeft, zodat ook die een grafiek krijgen. Gratis tot 800 verzoeken per dag.',
    keys: [['TWELVEDATA_KEY', 'API-sleutel']], href: 'https://twelvedata.com/register' },
  { id: 'mail', title: 'Weekoverzicht per e-mail (optioneel)', need: 'gratis sleutel', what: 'Elke zaterdag na de weekmeting een korte mail met je weekrendement en de grootste stijgers en dalers, via Resend (gratis tot 3000 mails per maand). Zonder eigen domein kan Resend alleen mailen naar het adres van je Resend-account. Lukt mailen niet, dan komt het overzicht als melding (als meldingen aanstaan).',
    keys: [['RESEND_KEY', 'Resend API-sleutel'], ['MAIL_TO', 'Naar (je e-mailadres)'], ['MAIL_FROM', 'Afzender (optioneel, met eigen domein)', true]], flag: 'weeklyMail', href: 'https://resend.com/signup' },
  { id: 'trading', title: 'Kopen en verkopen (optioneel)', need: 'sleutel met orderrecht', what: 'Orders plaatsen vanuit de app: markt- en limietorders voor je posities en je volglijst. Elke order zie je eerst en bevestig je zelf; de Worker houdt je grens per order en per dag aan en verstuurt dezelfde order nooit twee keer. Je Trading 212-sleutel moet orders mogen plaatsen. Staat standaard uit.', flag: 'trading', href: 'https://docs.trading212.com/api/equity-orders' },
];
// Welke bronnen bij een koppeling horen (voor de melding "reserve in gebruik")
const LINK_SOURCES = { twelvedata: ['twelvedata'], fmp: ['fmp'], finnhub: ['finnhub'], fx: ['frankfurter'], inflation: ['ecb_hicp'], indices: ['fred'], mail: ['resend'] };
const SOURCE_NAMES = { twelvedata: 'Twelve Data', fmp: 'FMP', finnhub: 'Finnhub', frankfurter: 'Frankfurter', ecb_hicp: 'de ECB', fred: 'FRED', resend: 'Resend' };
function healthLine(id, H) {
  return (LINK_SOURCES[id] || []).map((src) => {
    const h = H && H[src];
    if (!h) return '';
    const down = h.until && h.until > Date.now();
    const parts = [];
    if (down) parts.push(SOURCE_NAMES[src] + ' tijdelijk uit tot ' + fDT.format(h.until) + (h.msg ? ' (' + h.msg + ')' : ''));
    if (h.backup) parts.push('reserve in gebruik: ' + h.backup + (h.backupAt ? ', laatst ' + fDT.format(new Date(h.backupAt)) : ''));
    return parts.length ? '<p class="small src-health">' + esc(parts.join('; ')) + '.</p>' : '';
  }).join('');
}
// Sleutels die de Worker kan testen met één proefvraag, zonder op te slaan (idee 62); zie js/15-bronnen.js
const KEY_TEST_OK = ['T212_KEY', 'T212_SECRET', 'FMP_KEY', 'FINNHUB_KEY', 'ALPHAVANTAGE_KEY', 'TWELVEDATA_KEY', 'FRED_KEY', 'SEC_CONTACT', 'RESEND_KEY'];
let linkState = null;

async function workerCall(path, init) {
  const res = await fetch(getUrl().replace(/\/api\/data$/, path), Object.assign({ headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' } }, init || {}));
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || !j.ok) throw new Error((j && (j.error || j.message)) || 'de Worker gaf status ' + res.status);
  return j;
}

function renderLinks(msg) {
  const box = $('links-body');
  if (!box) return;
  if (demo) { box.innerHTML = '<p class="muted small">In de voorbeeldweergave staan alle functies aan met voorbeeldgegevens.</p>'; return; }
  if (!isWorker() || !getToken()) { box.innerHTML = '<p class="muted small">Koppelingen werken met de Cloudflare Worker. Vul hierboven het adres van je Worker en je toegangscode in en kies Opslaan en laden.</p>'; return; }
  if (!linkState) { box.innerHTML = '<p class="muted small">Bezig met laden…</p>'; return; }
  const F = linkState;
  const errFor = (id) => F.errors && F.errors[id === 'inflation' ? 'inflation' : id];
  box.innerHTML = '<p class="muted small">De basis heeft alleen Trading 212 nodig. Extra functies zet je aan met een gratis sleutel of een schakelaar. Sleutels gaan naar je eigen Worker en worden nooit teruggestuurd naar de browser.</p>' +
    LINKS.map((L) => {
      const keysSet = (L.keys || []).filter((k) => !k[2]).map(([k]) => F.keys[k]);
      const on = L.flag ? F.flags[L.flag] !== false && (!L.keys || L.optKeys || keysSet.every(Boolean)) : keysSet.every(Boolean);
      const err = errFor(L.id);
      const st = err ? '<span class="tag loss">Fout</span>' : on ? '<span class="tag gain">Aan</span>' : '<span class="tag">Uit</span>';
      return '<div class="link-row" data-link="' + L.id + '"><div class="link-h"><b>' + esc(L.title) + '</b><span class="muted small">' + esc(L.need) + '</span>' + st + '</div>' +
        '<p class="small muted">' + esc(L.what) + (L.href ? ' <a href="' + esc(L.href) + '" target="_blank" rel="noopener">Meer</a>' : '') + '</p>' +
        (err ? '<p class="small loss">' + esc(err.msg) + '</p>' : '') + healthLine(L.id, F.health) +
        (L.keys || []).map(([k, lbl]) => {
          const where = F.keys[k];
          return '<div class="key-row"><label class="small" for="key-' + k + '">' + esc(lbl) + '</label>' +
            (where === 'cloudflare' ? '<span class="small muted">Ingesteld als geheim bij Cloudflare. Vul hieronder in om hem via de site te vervangen.</span>' : '') +
            (where === 'override' ? '<span class="small muted">Vervangen via de site; het geheim bij Cloudflare wordt niet gebruikt. Met Terug naar Cloudflare geldt het geheim weer.</span>' : '') +
              '<span class="key-in"><input id="key-' + k + '" data-key="' + k + '" type="' + (/SEC_CONTACT|MAIL_/.test(k) ? 'email' : 'password') + '" autocomplete="off" spellcheck="false" placeholder="' + (where ? 'Ingesteld; vul in om te vervangen' : 'Niet ingesteld') + '">' +
                '<button type="button" class="btn ghost" data-savekey="' + k + '">Opslaan</button>' +
                (KEY_TEST_OK.includes(String(k)) ? '<button type="button" class="btn ghost" data-testkey="' + k + '">Testen</button>' : '') +
                (where === 'site' || where === 'override' ? '<button type="button" class="btn ghost danger" data-delkey="' + k + '">' + (where === 'override' ? 'Terug naar Cloudflare' : 'Wissen') + '</button>' : '') + '</span>' +
              (KEY_TEST_OK.includes(String(k)) ? '<span class="small key-test muted" data-keytest-out="' + k + '"></span>' : '') + '</div>';
        }).join('') +
        (L.flag ? '<label class="check small"><input type="checkbox" data-flag="' + L.flag + '"' + (F.flags[L.flag] ? ' checked' : '') + '> Gebruiken</label>' : '') +
        (L.id === 'trading' && F.flags.trading ? tradeLimitsRow() : '') +
        (L.id === 'mail' ? '<label class="check small"><input type="checkbox" data-mail-amounts' + (M && M.settings && M.settings.mailAmounts === false ? '' : ' checked') + '> Met bedragen</label> <button type="button" class="btn ghost" data-mail-test>Testmail sturen</button>' : '') + '</div>';
    }).join('') + calendarRow(calUrl || (() => { try { return localStorage.getItem('tracker.cal'); } catch (e) { return null; } })()) +
    '<p class="small plan-status" id="links-status" role="status">' + esc(msg || '') + '</p>';
}

async function loadLinks() {
  if (demo || !isWorker() || !getToken()) { renderLinks(); return; }
  linkState = null; renderLinks();
  try { linkState = (await workerCall('/api/features', { method: 'GET' })).features; renderLinks(); }
  catch (err) { $('links-body').innerHTML = '<p class="small loss">Koppelingen konden niet worden geladen: ' + esc(err.message) + '.</p>'; }
}

async function afterLinkChange(note) {
  renderLinks(note + ' Bezig met ophalen…');
  try {
    await workerCall('/api/market?plan=1', { method: 'POST' });
    renderLinks(note + ' De eerste gegevens zijn opgehaald; de rest volgt binnen een uur buiten de meettijden.');
    load();
  } catch (err) { renderLinks(note + ' Ophalen lukte nog niet: ' + err.message + '. De Worker probeert het later opnieuw.'); }
}

$('links-body').addEventListener('click', async (e) => {
  const sv = e.target.closest('[data-savekey]'), dl = e.target.closest('[data-delkey]');
  if (!sv && !dl) return;
  const name = (sv || dl).dataset[sv ? 'savekey' : 'delkey'];
  const value = sv ? ($('key-' + name).value || '').trim() : '';
  if (sv && !value) { renderLinks('Vul eerst een waarde in.'); return; }
  try {
    linkState = (await workerCall('/api/keys', { method: 'POST', body: JSON.stringify({ name, value }) })).features;
    if (name.startsWith('T212')) { renderLinks(sv ? 'Opgeslagen.' : 'Gewist.'); if (linkState.keys.T212_KEY && linkState.keys.T212_SECRET) { try { await workerCall('/api/run', { method: 'POST' }); } catch (err) { renderLinks('Opgeslagen, maar de eerste meting lukte niet: ' + err.message + '.'); return; } load(); } }
    else await afterLinkChange(sv ? 'Opgeslagen.' : 'Gewist.');
  } catch (err) { renderLinks('Mislukt: ' + err.message); }
});
$('links-body').addEventListener('change', async (e) => {
  const cb = e.target.closest('input[data-flag]');
  if (!cb) return;
  try {
    linkState = (await workerCall('/api/features', { method: 'POST', body: JSON.stringify({ features: { [cb.dataset.flag]: cb.checked } }) })).features;
    if (cb.checked) await afterLinkChange('Aangezet.'); else { renderLinks('Uitgezet.'); load(); }
  } catch (err) { renderLinks('Mislukt: ' + err.message); }
});


// ---------- Bedragen verbergen en thema ----------
function rerenderAll() {
  if (!M) return;
  renderAll();
  if (ui.detail && hasView(ui.detail)) renderDetail(false);
}
function syncHideButtons() {
  $$('.btn-hide').forEach((b) => {
    b.setAttribute('aria-pressed', String(hideAmounts));
    b.setAttribute('aria-label', hideAmounts ? 'Bedragen tonen' : 'Bedragen verbergen');
    b.title = hideAmounts ? 'Bedragen tonen' : 'Bedragen verbergen';
  });
}
$$('.btn-hide').forEach((b) => b.addEventListener('click', () => {
  hideAmounts = !hideAmounts;
  try { localStorage.setItem('tracker.hide', hideAmounts ? '1' : '0'); } catch (e) { /* niet erg */ }
  syncHideButtons();
  rerenderAll();
}));
syncHideButtons();

function syncThemeButtons() {
  const pref = themePref();
  $$('[data-theme-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themePick === pref)));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-theme-pick]');
  if (!b) return;
  try { localStorage.setItem('tracker.theme', b.dataset.themePick); } catch (err) { /* niet erg */ }
  applyTheme(); syncThemeButtons(); rerenderAll(); if (M) showPage(ui.page, false);
});
THEME_MQ.addEventListener('change', () => { if (themePref() === 'auto') { applyTheme(); rerenderAll(); } });
syncThemeButtons();

// ---------- Agenda-abonnement (.ics) ----------
function calendarRow(url) {
  return '<div class="link-row" data-link="calendar"><div class="link-h"><b>Agenda in Google Agenda</b><span class="muted small">geen sleutel</span>' + (url ? '<span class="tag gain">Aan</span>' : '<span class="tag">Uit</span>') + '</div>' +
    '<p class="small muted">Een agenda-link met je kwartaalcijfers, ex-dividenddata en uitbetalingen. Google Agenda haalt hem zelf op en werkt hem een paar keer per dag bij.</p>' +
    (url ? '<div class="key-in" style="margin-top:8px"><input id="cal-url" type="text" readonly value="' + esc(url) + '" aria-label="Agenda-link"><button type="button" class="btn ghost" data-cal="copy">Kopiëren</button></div>' +
      '<p class="small muted" style="margin-top:6px">Google Agenda op de computer: <b>Andere agenda\'s</b> → <b>+</b> → <b>Via URL</b>, plak de link en kies Agenda toevoegen. Iedereen met deze link ziet je agenda (geen bedragen van je portefeuille, wel welke aandelen); maak een nieuwe link als je hem wilt intrekken.</p>' +
      '<div class="key-in" style="margin-top:6px"><button type="button" class="btn ghost" data-cal="rotate">Nieuwe link maken</button><button type="button" class="btn ghost danger" data-cal="off">Uitzetten</button></div>'
      : '<div class="key-in" style="margin-top:8px"><button type="button" class="btn ghost" data-cal="make">Agenda-link maken</button></div>') + '</div>';
}
let calUrl = null;
$('links-body').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cal]');
  if (!b) return;
  const act = b.dataset.cal;
  if (act === 'copy') { const i = $('cal-url'); i.select(); try { await navigator.clipboard.writeText(i.value); b.textContent = 'Gekopieerd'; } catch (err) { document.execCommand && document.execCommand('copy'); } return; }
  try {
    const j = await workerCall('/api/calendar', { method: 'POST', body: JSON.stringify(act === 'off' ? { off: true } : act === 'rotate' ? { rotate: true } : {}) });
    calUrl = j.url;
    try { if (calUrl) localStorage.setItem('tracker.cal', calUrl); else localStorage.removeItem('tracker.cal'); } catch (err) { /* niet erg */ }
    renderLinks(act === 'off' ? 'Agenda-link uitgezet.' : act === 'rotate' ? 'Nieuwe link gemaakt; de oude werkt niet meer.' : 'Agenda-link gemaakt.');
  } catch (err) { renderLinks('Mislukt: ' + err.message); }
});

$$('.btn-settings').forEach((b) => b.addEventListener('click', () => openSettings(false)));
$('btn-welcome-settings').addEventListener('click', () => openSettings(false));
$$('.btn-refresh').forEach((b) => b.addEventListener('click', () => load()));
$('btn-demo').addEventListener('click', () => { demo = true; load(); });
$('btn-demo-exit').addEventListener('click', () => { demo = false; if (getToken()) load(); else showWelcome(); });

// ---------- Weergave kiezen ----------
function applyMode() {
  $('shell').hidden = mode !== 'd';
  $('mshell').hidden = mode !== 'm';
  $(mode === 'd' ? 'd-notices' : 'm-notices').appendChild($('notices'));
  { const cs = getComputedStyle(document.documentElement); document.querySelector('meta[name="theme-color"]').content = (mode === 'm' && ui.page !== 'home' ? cs.getPropertyValue('--bg') : cs.getPropertyValue('--band')).trim(); }
  setMtop();
}
function setMtop() {
  const h = document.querySelector('.m-top');
  if (h && mode === 'm') document.documentElement.style.setProperty('--mtop', h.offsetHeight + 'px');
}

MQ.addEventListener('change', () => {
  const nm = MQ.matches ? 'm' : 'd';
  if (nm === mode) return;
  if (ui.detail) instantClose();
  mode = nm;
  if (mode === 'd' && ui.page === 'stats') ui.page = 'home';
  applyMode();
  if (data && M) { renderAll(); showPage(ui.page, false, true); }
});

// ---------- Laden ----------
function showError(msg) { const el = $('error'); el.textContent = msg; el.hidden = !msg; }

function showWelcome() {
  $('app').hidden = true;
  $('m-main').hidden = true;
  $('demo-banner').hidden = true;
  $('welcome').hidden = false;
  document.body.classList.add('welcoming');
  $$('.updated').forEach((e) => { e.textContent = ''; });
}

// Laatste stand in deze browser, zodat de site direct (en zonder verbinding) iets laat zien
// In IndexedDB (ruimte voor vele megabytes); localStorage (zo'n 5 MB) alleen als reserve
const LS_LAST = 'tracker.last';
const IDB_NAME = 'tracker', IDB_STORE = 'kv';
let idbConn = null;
function idbOpen() {
  if (idbConn) return idbConn;
  idbConn = new Promise((ok, no) => {
    if (!('indexedDB' in window)) { no(new Error('geen IndexedDB')); return; }
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error || new Error('IndexedDB'));
  });
  idbConn.catch(() => { idbConn = null; });
  return idbConn;
}
async function idbGet(k) { const db = await idbOpen(); return new Promise((ok, no) => { const q = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(k); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); }
async function idbSet(k, v) { const db = await idbOpen(); return new Promise((ok, no) => { const t = db.transaction(IDB_STORE, 'readwrite'); t.objectStore(IDB_STORE).put(v, k); t.oncomplete = () => ok(); t.onerror = () => no(t.error); t.onabort = () => no(t.error); }); }
async function idbDel(k) { try { const db = await idbOpen(); await new Promise((ok) => { const t = db.transaction(IDB_STORE, 'readwrite'); t.objectStore(IDB_STORE).delete(k); t.oncomplete = ok; t.onerror = ok; }); } catch (e) { /* niet erg */ } }
async function readLast(url) {
  try { const o = await idbGet('last'); if (o && o.url === url && o.data && o.data.ok) return o; } catch (e) { /* valt terug op localStorage */ }
  try { const o = JSON.parse(localStorage.getItem(LS_LAST) || 'null'); return o && o.url === url && o.data && o.data.ok ? o : null; } catch (e) { return null; }
}
async function saveLast(url, d) {
  const o = { url, saved: Date.now(), data: d, tags: Object.assign({}, dataParts.tags), seriesTs: dataParts.seriesTs || 0 };
  try { await idbSet('last', o); try { localStorage.removeItem(LS_LAST); } catch (e) { /* niet erg */ } }
  catch (e) { try { localStorage.setItem(LS_LAST, JSON.stringify(o)); } catch (e2) { /* vol of geblokkeerd: niet erg */ } }
}

// Gegevens van de Worker in twee delen: 'core' (metingen, posities; elke 10 minuten anders) en 'extra'
// (markt, onderzoek, koersen; een paar keer per dag). Een deel dat niet veranderde, stuurt de Worker niet
// opnieuw (304). De toegangscode gaat in de Authorization-kop, niet in het adres.
// Een derde deel, 'series' (metingen per 10 minuten, uren en dagen), komt na de eerste keer alleen nog
// met de regels die erbij kwamen (?since=).
const dataParts = { core: null, extra: null, series: null, tags: {}, seriesTs: 0 };
async function fetchPart(url, token, part, query) {
  const h = { Authorization: 'Bearer ' + token };
  if (dataParts.tags[part] && dataParts[part]) h['If-None-Match'] = dataParts.tags[part];
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'part=' + part + (query || ''), { cache: 'no-store', headers: h });
  if (res.status === 304) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error((json && json.error) || 'de web-app gaf status ' + res.status);
  if (!json.ok) throw new Error(json.error || 'onbekende fout');
  if (json.part !== part) {
    // Een oudere Worker kent geen delen en stuurt alles in één keer; kent hij alleen geen 'series', dan negeren
    if (part === 'core') { dataParts.core = json; dataParts.extra = {}; dataParts.series = null; dataParts.tags = {}; return 'full'; }
    return 'none';
  }
  dataParts[part] = json;
  dataParts.tags[part] = res.headers.get('ETag') || null;
  if (part === 'series') dataParts.seriesTs = json.seriesTs || 0;
  return part;
}
// Nieuwe reeksregels samenvoegen met wat er al is (zelfde tijd en ticker = vervangen), oude regels opruimen
function mergeRows(old, add, keepFrom) {
  const m = new Map((old || []).map((r) => [r[0] + '|' + r[1], r]));
  (add || []).forEach((r) => m.set(r[0] + '|' + r[1], r));
  return [...m.values()].filter((r) => !keepFrom || r[0] >= keepFrom).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
async function fetchSeries(url, token) {
  const S = dataParts.series;
  if (S && dataParts.seriesTs && S.intraday) {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'part=series&since=' + dataParts.seriesTs, { cache: 'no-store', headers: { Authorization: 'Bearer ' + token } });
    const json = await res.json().catch(() => null);
    if (res.ok && json && json.ok && json.delta) {
      const n = json.intraday.rows.length + json.hours.rows.length + json.days.rows.length;
      if (!n) return null;
      const last = json.intraday.rows.length ? json.intraday.rows[json.intraday.rows.length - 1][0] : null;
      const iso = (t) => { const d = new Date(t); const p = (x) => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':00'; };
      const lastT = last ? new Date(last).getTime() : Date.now();
      S.intraday = Object.assign({}, S.intraday, { rows: mergeRows(S.intraday.rows, json.intraday.rows, iso(lastT - 4 * DAY)) });
      S.hours = Object.assign({}, S.hours, { rows: mergeRows(S.hours.rows, json.hours.rows, iso(lastT - 31 * DAY)) });
      S.days = Object.assign({}, S.days, { rows: mergeRows(S.days.rows, json.days.rows, null) });
      dataParts.seriesTs = json.seriesTs || dataParts.seriesTs;
      dataParts.tags.series = null;
      return 'series';
    }
  }
  return fetchPart(url, token, 'series');
}
async function fetchWorkerData(url, token) {
  const a = await fetchPart(url, token, 'core', '&split=1');
  if (a === 'full') { const d = Object.assign({}, dataParts.core); d.ok = true; delete d.part; return d; }
  const b = await fetchPart(url, token, 'extra');
  const c = await fetchSeries(url, token);
  if (!a && !b && (!c || c === 'none')) return null; // niets veranderd
  const d = Object.assign({}, dataParts.series || {}, dataParts.core, dataParts.extra);
  d.ok = true; delete d.part; delete d.seriesTs;
  return d;
}

// Voorbeeldgegevens staan in een eigen bestand dat alleen in de voorbeeldweergave wordt geladen
function loadDemoScript() {
  if (typeof makeDemoData === 'function') return Promise.resolve();
  return new Promise((ok, no) => {
    const el = document.createElement('script');
    el.src = 'js/14-demo.js?v=' + VERSION.replace(/^v/, '');
    el.onload = ok;
    el.onerror = () => no(new Error('de voorbeeldgegevens konden niet worden geladen'));
    document.head.appendChild(el);
  });
}

async function load() {
  clearTimeout(refreshTimer);
  showError('');
  if (sharedView) {
    $$('.btn-refresh').forEach((b) => b.classList.add('busy'));
    try {
      const res = await fetch(sharedView.origin + '/share/' + sharedView.token, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.ok) throw new Error((json && json.error) || 'de link gaf status ' + res.status);
      data = json;
      if (!json.shared || !json.shared.amounts) { hideAmounts = true; syncHideButtons(); }
      $('share-banner').hidden = false;
      render();
      refreshTimer = setTimeout(load, 15 * 60000);
    } catch (err) { showError('Deze gedeelde weergave kon niet worden geladen: ' + err.message + '.'); }
    finally { $$('.btn-refresh').forEach((b) => b.classList.remove('busy')); }
    return;
  }
  if (demo) {
    try { await loadDemoScript(); } catch (err) { showError('Voorbeeldweergave: ' + err.message + '.'); return; }
    data = makeDemoData(); render(); return;
  }
  const token = getToken();
  const url = getUrl();
  if (!token) { showWelcome(); return; }
  if (!url) { showWelcome(); showError('Er is nog geen adres van de web-app ingesteld. Vul het in bij Instellingen of zet het in config.js.'); return; }
  if (!data) {
    const last = await readLast(url);
    if (last && !data) {
      data = last.data; render();
      // Met de vingerafdrukken van de vorige keer hoeft er na een herstart vaak niets opnieuw te komen
      if (last.tags && last.tags.core) {
        dataParts.core = last.data; dataParts.extra = {}; dataParts.tags = { core: last.tags.core };
        if (last.tags.extra) { dataParts.extra = last.data; dataParts.tags.extra = last.tags.extra; }
        if (last.seriesTs && last.data.intraday) { dataParts.series = { intraday: last.data.intraday, hours: last.data.hours, days: last.data.days }; dataParts.seriesTs = last.seriesTs; }
      }
    }
  }
  $$('.btn-refresh').forEach((b) => b.classList.add('busy'));
  try {
    let json;
    if (isWorker()) {
      json = await fetchWorkerData(url, token);
    } else {
      // De oude Apps Script-web-app leest geen kopregels; daar blijft de code in het adres
      const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token), { cache: 'no-store' });
      json = await res.json().catch(() => null);
      if (!res.ok || !json) throw new Error((json && json.error) || 'de web-app gaf status ' + res.status);
      if (!json.ok) throw new Error(json.error || 'onbekende fout');
    }
    if (json) {
      data = json;
      saveLast(url, json);
      render();
    } else if (data) {
      // Niets veranderd: alleen de tijd bijwerken
      $$('.updated').forEach((e) => { e.textContent = (mode === 'm' ? '' : 'Bijgewerkt ') + fDT.format(new Date()); });
    }
    refreshTimer = setTimeout(load, (Number(CFG.refreshMinutes) || 5) * 60000);
  } catch (err) {
    const offline = !navigator.onLine || err instanceof TypeError;
    if (data && offline) {
      showError('Geen verbinding. Je ziet de laatst geladen stand van ' + fDT.format(new Date(data.generated)) + '.');
      refreshTimer = setTimeout(load, 60000);
    } else {
      showError('De gegevens konden niet worden geladen: ' + err.message + '. Controleer de toegangscode en het adres bij Instellingen.');
    }
    if (!data) showWelcome();
  } finally {
    $$('.btn-refresh').forEach((b) => b.classList.remove('busy'));
  }
}
