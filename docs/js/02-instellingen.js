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
  $('dlg-settings').showModal();
}

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
  { id: 't212', title: 'Trading 212', need: 'vereist', what: 'Je posities, orders, dividenden en saldo. Alleen-lezen sleutel aanmaken in de Trading 212-app: Instellingen > API.',
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
];
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
      const keysSet = (L.keys || []).map(([k]) => F.keys[k]);
      const on = L.flag ? F.flags[L.flag] !== false && (!L.keys || L.optKeys || keysSet.every(Boolean)) : keysSet.every(Boolean);
      const err = errFor(L.id);
      const st = err ? '<span class="tag loss">Fout</span>' : on ? '<span class="tag gain">Aan</span>' : '<span class="tag">Uit</span>';
      return '<div class="link-row" data-link="' + L.id + '"><div class="link-h"><b>' + esc(L.title) + '</b><span class="muted small">' + esc(L.need) + '</span>' + st + '</div>' +
        '<p class="small muted">' + esc(L.what) + (L.href ? ' <a href="' + esc(L.href) + '" target="_blank" rel="noopener">Meer</a>' : '') + '</p>' +
        (err ? '<p class="small loss">' + esc(err.msg) + '</p>' : '') +
        (L.keys || []).map(([k, lbl]) => {
          const where = F.keys[k];
          return '<div class="key-row"><label class="small" for="key-' + k + '">' + esc(lbl) + '</label>' +
            (where === 'cloudflare' ? '<span class="small muted">Ingesteld als geheim bij Cloudflare.</span>'
              : '<span class="key-in"><input id="key-' + k + '" data-key="' + k + '" type="' + (k === 'SEC_CONTACT' ? 'email' : 'password') + '" autocomplete="off" spellcheck="false" placeholder="' + (where ? 'Ingesteld; vul in om te vervangen' : 'Niet ingesteld') + '">' +
                '<button type="button" class="btn ghost" data-savekey="' + k + '">Opslaan</button>' + (where ? '<button type="button" class="btn ghost danger" data-delkey="' + k + '">Wissen</button>' : '') + '</span>') + '</div>';
        }).join('') +
        (L.flag ? '<label class="check small"><input type="checkbox" data-flag="' + L.flag + '"' + (F.flags[L.flag] !== false ? ' checked' : '') + '> Gebruiken</label>' : '') + '</div>';
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
  $$('.updated').forEach((e) => { e.textContent = ''; });
}

// Laatste stand in deze browser, zodat de site direct (en zonder verbinding) iets laat zien
const LS_LAST = 'tracker.last';
function readLast(url) {
  try { const o = JSON.parse(localStorage.getItem(LS_LAST) || 'null'); return o && o.url === url && o.data && o.data.ok ? o : null; } catch (e) { return null; }
}
function saveLast(url, d) {
  try { localStorage.setItem(LS_LAST, JSON.stringify({ url, saved: Date.now(), data: d })); } catch (e) { /* vol of geblokkeerd: niet erg */ }
}

async function load() {
  clearTimeout(refreshTimer);
  showError('');
  if (demo) { data = makeDemoData(); render(); return; }
  const token = getToken();
  const url = getUrl();
  if (!token) { showWelcome(); return; }
  if (!url) { showWelcome(); showError('Er is nog geen adres van de web-app ingesteld. Vul het in bij Instellingen of zet het in config.js.'); return; }
  if (!data) { const last = readLast(url); if (last) { data = last.data; render(); } }
  $$('.btn-refresh').forEach((b) => b.classList.add('busy'));
  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token), { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) throw new Error((json && json.error) || 'de web-app gaf status ' + res.status);
    if (!json.ok) throw new Error(json.error || 'onbekende fout');
    data = json;
    saveLast(url, json);
    render();
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
