/* Investeringstracker – dashboard
 *
 * Haalt JSON op van de Cloudflare Worker (/api/data) of de Apps Script web-app (/exec).
 * Twee weergaven op dezelfde gegevens:
 *  - desktop (breder dan 700 px): grafiekband, tegels, inzoomen op een bedrijf;
 *  - telefoon: app-indeling met tabbalk onderin, lijsten in plaats van tegels.
 * De toegangscode staat alleen in localStorage van deze browser.
 */
(function () {
  'use strict';

  // ---------- Basis ----------
  const CFG = window.TRACKER_CONFIG || {};
  const LS_TOKEN = 'tracker.token';
  const LS_URL = 'tracker.url';
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const TOTAL = 'TOTAAL';
  const MAX_DAY_MOVE = 0.25;   // grotere dagbeweging = vrijwel zeker een aankoop of verkoop
  const MAX_STEP_MOVE = 0.15;  // idem voor één stap in een vergelijkingsgrafiek
  const MIN_DAYS_BEST = 3;     // minimaal aantal dagen voor beste/slechtste dag
  const MIN_DAYS_SD = 5;       // voor beweeglijkheid
  const MIN_DAYS_CORR = 10;    // voor samenhang met de portefeuille
  const ZOOM_MS = 450;
  const unfolded = new Set();
  const FOLD_ROOTS = ['page-home', 'm-home', 'm-stats'];
  const FOLD_SKIP = '.grid.stats, .m-grid2, #kpis, #movers, #stats';
  let foldTimer = null;
  const HOUR = 3600e3;
  const DAY = 864e5;

  // Taal: Nederlands (standaard) of Engels; getallen en datums volgen de gekozen taal
  const LANG = (() => { try { return localStorage.getItem('tracker.lang') === 'en' ? 'en' : 'nl'; } catch (e) { return 'nl'; } })();
  const LOCALE = LANG === 'en' ? 'en-GB' : 'nl-NL';
  const VERSION = 'v33';
  const nf = (o) => new Intl.NumberFormat(LOCALE, o);
  const EUR = nf({ style: 'currency', currency: 'EUR' });
  const P2 = nf({ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const P1 = nf({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const N2 = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const N4 = nf({ maximumFractionDigits: 4 });
  const N1 = nf({ maximumFractionDigits: 1 });
  const NI = nf({ maximumFractionDigits: 0 });
  const fDT = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fD = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
  const fDM = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
  const fHM = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
  const fWH = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  // Bedragen verbergen (privacyknop): alle euro's in de weergave worden puntjes
  let hideAmounts = (() => { try { return localStorage.getItem('tracker.hide') === '1'; } catch (e) { return false; } })();
  const HIDDEN = '€ ••••';
  const eur = (v) => (!isNum(v) ? '–' : hideAmounts ? HIDDEN : EUR.format(v));
  const sgn = (v, f) => (!isNum(v) ? '–' : (v > 0 ? '+\u2060' : v < 0 ? '−\u2060' : '') + f.format(Math.abs(v)));
  const seur = (v) => (hideAmounts && isNum(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + HIDDEN : sgn(v, EUR));
  const spct = (v) => sgn(v, P2);
  const spct1 = (v) => sgn(v, P1);
  const tone = (v) => (!isNum(v) || v === 0 ? '' : v > 0 ? 'gain' : 'loss');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : null);
  const stdev = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const hourStart = (t) => Math.floor(t / HOUR) * HOUR;
  const days = (n) => n + (n === 1 ? ' dag' : ' dagen');
  // Animaties: automatisch (volgt "minder beweging" van het apparaat), altijd aan of uit
  const MOTION_MQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionPref = () => { try { return localStorage.getItem('tracker.motion') || 'auto'; } catch (e) { return 'auto'; } };
  const reduceMotion = () => { const p = motionPref(); return p === 'off' || (p === 'auto' && MOTION_MQ.matches); };
  function applyMotion() { document.documentElement.dataset.motion = reduceMotion() ? 'off' : 'on'; }
  applyMotion();
  MOTION_MQ.addEventListener('change', () => { applyMotion(); if (typeof syncMotionButtons === 'function') syncMotionButtons(); });
  let freshTimer = null;
  // Kort na laden, een paginawissel of inzoomen groeien balken en meters op (html.fresh)
  function markFresh() {
    if (reduceMotion()) return;
    const r = document.documentElement;
    r.classList.remove('fresh'); void r.offsetWidth; r.classList.add('fresh');
    clearTimeout(freshTimer); freshTimer = setTimeout(() => r.classList.remove('fresh'), 1900);
  }
  // Getal laten oplopen naar de nieuwe waarde
  function countTo(el, v, fmt) {
    if (!el) return;
    const prevStr = el.dataset.v || '';
    const prev = Number(prevStr);
    el.dataset.v = isNum(v) ? String(v) : '';
    if (!isNum(v) || reduceMotion() || hideAmounts) { el.textContent = fmt(v); return; }
    const from = prevStr && isNum(prev) ? prev : v * 0.92;
    if (Math.abs(from - v) < 0.005) { el.textContent = fmt(v); return; }
    const t0 = performance.now(), dur = 900;
    cancelAnimationFrame(el._raf);
    if (!(el.firstChild && el.firstChild.nodeType === 3)) el.textContent = fmt(from);
    const step = (now) => { const k = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - k, 3); el.firstChild.nodeValue = fmt(from + (v - from) * e); if (k < 1) el._raf = requestAnimationFrame(step); };
    el._raf = requestAnimationFrame(step);
  }
  const C = { accent: '#2B5BD7', gain: '#0B7A4B', loss: '#B4311F', ink2: '#5B6472', soft: '#8FAEF0', ink: '#14181F' };
  // Thema: licht, donker of automatisch (volgt het apparaat)
  const THEME_MQ = window.matchMedia('(prefers-color-scheme: dark)');
  const themePref = () => { try { return localStorage.getItem('tracker.theme') || 'auto'; } catch (e) { return 'auto'; } };
  function applyTheme() {
    const pref = themePref();
    const dark = pref === 'dark' || (pref === 'auto' && THEME_MQ.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
    C.accent = v('--accent', '#2B5BD7'); C.gain = v('--gain', '#0B7A4B'); C.loss = v('--loss', '#B4311F'); C.ink2 = v('--ink-2', '#5B6472'); C.ink = v('--ink', '#14181F'); C.soft = v('--accent-soft', '#8FAEF0');
  }
  applyTheme();
  const toneColor = (v) => (isNum(v) && v < 0 ? C.loss : C.gain);

  const MQ = window.matchMedia('(max-width: 700px)');
  let mode = MQ.matches ? 'm' : 'd';
  let data = null;
  let M = null;
  let demo = false;
  let refreshTimer = null;
  let pushedDetail = false;
  let firstRender = true;
  const ui = {
    page: 'home', heroRange: '3d',
    listSort: 'move', listFilter: 'all', listSpan: 'today', listQuery: '',
    detail: null, detailRange: '3d', compare: false, origin: null, mTab: 'pos',
  };
  const RANGES = [['today', 'Vandaag'], ['3d', '3 dagen'], ['1m', '30 dagen'], ['all', 'Alles']];

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

  // ---------- Model ----------
  function derive() {
    const m = {};
    const parse = (s) => new Date(s).getTime();
    const group = (rows, map) => {
      const g = new Map();
      (rows || []).forEach((r) => {
        const o = map(r);
        if (!o || !isNum(o.t)) return;
        if (!g.has(r[1])) g.set(r[1], []);
        g.get(r[1]).push(o);
      });
      g.forEach((a) => a.sort((x, y) => x.t - y.t));
      return g;
    };
    const ohlc = (r) => (isNum(r[3]) ? { t: parse(r[0]), open: r[2], close: r[3], low: r[4], high: r[5], avg: r[6], v: r[3] } : null);
    m.intra = group(data.intraday && data.intraday.rows, (r) => (isNum(r[2]) ? { t: parse(r[0]), v: r[2] } : null));
    m.hours = group(data.hours && data.hours.rows, ohlc);
    m.days = group(data.days && data.days.rows, ohlc);

    // Ontbreekt de reeks TOTAAL, tel dan de posities per tijdstip op
    ['intra', 'hours', 'days'].forEach((k) => {
      if (m[k].has(TOTAL) || !m[k].size) return;
      const acc = new Map();
      m[k].forEach((a) => a.forEach((p) => {
        const o = acc.get(p.t) || { t: p.t, v: 0, open: 0, close: 0, low: 0, high: 0, avg: 0 };
        ['v', 'open', 'close', 'low', 'high', 'avg'].forEach((f) => { if (isNum(p[f])) o[f] += p[f]; });
        acc.set(p.t, o);
      }));
      m[k].set(TOTAL, [...acc.values()].sort((a, b) => a.t - b.t));
    });

    const ti = m.intra.get(TOTAL) || [];
    const th = m.hours.get(TOTAL) || [];
    m.lastT = ti.length ? ti[ti.length - 1].t : th.length ? th[th.length - 1].t : null;
    m.isToday = m.lastT != null && dayKey(m.lastT) === dayKey(Date.now());
    m.dayWord = m.lastT == null || m.isToday ? 'vandaag' : 'op ' + fD.format(m.lastT);
    m.intraDays = new Set(ti.map((p) => dayKey(p.t))).size;
    m.series = new Map();
    M = m;   // seriesOf() hieronder gebruikt M

    const todayMap = new Map((data.today || []).map((r) => [r.ticker, r]));
    const posMap = new Map((data.positions || []).map((p) => [p.ticker, p]));
    const tks = new Set([...todayMap.keys(), ...posMap.keys()]);
    tks.delete(TOTAL);

    m.companies = [...tks].map((tk) => {
      const t = todayMap.get(tk) || {};
      const p = posMap.get(tk) || {};
      const value = isNum(t.current) ? t.current : isNum(p.value) ? p.value : null;
      const cost = isNum(p.cost) ? p.cost : (isNum(p.value) && isNum(p.unrealized) ? p.value - p.unrealized : null);
      const unreal = isNum(cost) && isNum(value) ? value - cost : isNum(p.unrealized) ? p.unrealized : null;
      const c = {
        tk, name: t.name || p.name || tk, value,
        change: t.change, changePct: t.changePct, open: t.open, low: t.low, high: t.high, avg: t.avg,
        avgRange: t.avgRange, avgRangePct: t.avgRangePct,
        cost, unreal, qty: isNum(p.quantity) && p.quantity > 0 ? p.quantity : null,
        resultPct: isNum(cost) && cost > 0 && isNum(unreal) ? unreal / cost : isNum(p.resultPct) ? p.resultPct : null,
      };
      const x = (data.posExtra || {})[tk];
      if (x) { c.fx = isNum(x.fx) ? x.fx : null; c.avgNative = x.avg; c.priceNative = x.price; c.cur = x.cur; c.since = x.since ? new Date(x.since).getTime() : null; }
      dayChange(c);
      return c;
    }).filter((c) => isNum(c.value));

    const T = todayMap.get(TOTAL) || {};
    m.tot = {
      tk: TOTAL, value: isNum(T.current) ? T.current : sum(m.companies.map((c) => c.value)),
      change: T.change, changePct: T.changePct, open: T.open, low: T.low, high: T.high, avg: T.avg,
      avgRange: T.avgRange, avgRangePct: T.avgRangePct,
    };
    dayChange(m.tot);
    m.totalValue = m.tot.value;
    m.companies.forEach((c) => { c.weight = m.totalValue ? c.value / m.totalValue : null; });
    m.byTk = new Map(m.companies.map((c) => [c.tk, c]));
    m.weeks = (data.weeks || []).filter((w) => isNum(w.accountValue)).map((w) => Object.assign({}, w, { t: parse(w.date) }));
    const lw = m.weeks[m.weeks.length - 1];
    if (m.tot.base && m.tot.base.kind === 'open' && lw && isNum(lw.cash) && m.lastT && lw.t < dayStart(m.lastT) && dayStart(m.lastT) - lw.t <= 4 * DAY) {
      const prevInv = lw.accountValue - lw.cash;
      if (prevInv > 0 && Math.abs(m.tot.value / prevInv - 1) <= MAX_DAY_MOVE) {
        m.tot.change = m.tot.value - prevInv;
        m.tot.changePct = m.tot.value / prevInv - 1;
        m.tot.base = { kind: 'week', t: lw.t };
      }
    }
    m.lastWeek = lw || null;
    m.cash = lw && isNum(lw.cash) ? lw.cash : null;
    m.accountNow = m.totalValue + (m.cash || 0);
    m.bench = findBench(m.companies);
    const allT = seriesOf(TOTAL).daily;
    m.since = allT.length ? allT[0].t : m.lastT;
    m.canImport = !demo && isWorker();
    m.ev = deriveEvents(data.events, m);
    m.tx = deriveOrders(data.orders, m);
    m.settings = demo ? demoSettings() : Object.assign({}, data.settings || {});
    m.mk = deriveMarket(data.market, m);
    return m;
  }

  // Uur- en dagreeksen uit alle bronnen samen: dagtabel, uurtabel en de metingen per 10 minuten
  function seriesOf(tk) {
    if (M.series.has(tk)) return M.series.get(tk);
    const intra = M.intra.get(tk) || [], hrs = M.hours.get(tk) || [], dys = M.days.get(tk) || [];
    const agg = (vals) => ({ open: vals[0], close: vals[vals.length - 1], low: Math.min(...vals), high: Math.max(...vals) });

    const hourly = new Map();
    hrs.forEach((h) => hourly.set(hourStart(h.t), { t: hourStart(h.t), v: h.close }));
    const fromIntra = new Map();
    intra.forEach((p) => { const k = hourStart(p.t); if (!hourly.has(k) || fromIntra.has(k)) { hourly.set(k, { t: k, v: p.v }); fromIntra.set(k, true); } });

    const daily = new Map();
    dys.forEach((d) => daily.set(dayKey(d.t), { t: dayStart(d.t), open: d.open, close: d.close, low: d.low, high: d.high }));
    const byDay = (pts, f) => { const g = new Map(); pts.forEach((p) => { const k = dayKey(p.t); if (daily.has(k)) return; if (!g.has(k)) g.set(k, []); g.get(k).push(f(p)); }); return g; };
    const iDays = byDay(intra, (p) => p.v);
    const hDays = byDay(hrs, (h) => h);
    iDays.forEach((vals, k) => { const o = agg(vals); daily.set(k, Object.assign({ t: dayStart(intra.find((p) => dayKey(p.t) === k).t) }, o)); });
    hDays.forEach((list, k) => {
      if (daily.has(k)) return;
      daily.set(k, { t: dayStart(list[0].t), open: list[0].open, close: list[list.length - 1].close, low: Math.min(...list.map((h) => h.low)), high: Math.max(...list.map((h) => h.high)) });
    });

    const s = {
      hourly: [...hourly.values()].sort((a, b) => a.t - b.t),
      daily: [...daily.values()].filter((d) => isNum(d.close)).sort((a, b) => a.t - b.t),
    };
    M.series.set(tk, s);
    return s;
  }

  // Wijziging van vandaag: tegen het slot van de vorige handelsdag als dat er is, anders sinds de eerste meting
  function dayChange(o) {
    const s = seriesOf(o.tk);
    const tk0 = M.lastT == null ? null : dayKey(M.lastT);
    const prev = s.daily.filter((d) => dayKey(d.t) !== tk0 && d.t < (M.lastT || 0)).pop();
    const todayPts = (M.intra.get(o.tk) || []).filter((p) => dayKey(p.t) === tk0);
    const allDaily = s.daily;
    o.ath = allDaily.length ? Math.max(...allDaily.map((d) => d.high)) : o.high;
    o.atl = allDaily.length ? Math.min(...allDaily.map((d) => d.low)) : o.low;
    o.histDays = allDaily.length;
    if (prev && prev.close > 0 && isNum(o.value) && Math.abs(o.value / prev.close - 1) <= MAX_DAY_MOVE) {
      o.change = o.value - prev.close;
      o.changePct = o.value / prev.close - 1;
      o.base = { kind: 'close', t: prev.t };
    } else {
      o.base = { kind: 'open', t: todayPts.length ? todayPts[0].t : null };
    }
  }

  function baseText(o) {
    if (!o.base) return '';
    if (o.base.kind === 'close') return 'sinds het slot van ' + fD.format(o.base.t);
    if (o.base.kind === 'week') return 'sinds de weekmeting van ' + fD.format(o.base.t);
    if (!o.base.t) return 'sinds de opening';
    const d = new Date(o.base.t);
    return d.getHours() * 60 + d.getMinutes() <= 8 * 60 + 30 ? 'sinds de opening om ' + fHM.format(o.base.t) : 'sinds de eerste meting om ' + fHM.format(o.base.t);
  }

  const BENCHES = [
    ['S&P 500', /^(VUAG|VUSA|CSPX|SXR8|IUSA|SPY|VOO|IVV)$/, /s&p ?500/i],
    ['Nasdaq 100', /^(SXRV|EQQQ|CNDX|EQAC|QQQ)$/, /nasdaq/i],
    ['MSCI World', /^(IWDA|SWDA|EUNL|VWRL|VWCE|VWRA)$/, /msci world|all-world|ftse all/i],
  ];
  function findBench(list) {
    for (const [label, re, nameRe] of BENCHES) {
      const c = list.find((x) => re.test(x.tk)) || list.find((x) => nameRe.test(x.name));
      if (c) return { label, c };
    }
    return null;
  }

  const itemOf = (tk) => (tk === TOTAL ? M.tot : M.byTk.get(tk));

  // Punten voor een grafiek over een periode
  function seriesFor(tk, range) {
    const intra = M.intra.get(tk) || [];
    if (range === 'today') { const k = M.lastT == null ? null : dayKey(M.lastT); return intra.filter((p) => dayKey(p.t) === k); }
    if (range === '3d') { const ks = [...new Set(intra.map((p) => dayKey(p.t)))].slice(-3); return intra.filter((p) => ks.includes(dayKey(p.t))); }
    const s = seriesOf(tk);
    // Te weinig punten op deze schaal: val terug op de fijnere metingen
    if (range === '1m') { const from = (M.lastT || Date.now()) - 30 * DAY; const h = s.hourly.filter((p) => p.t >= from); return h.length >= 3 ? h : intra; }
    if (s.daily.length >= 3) return s.daily.map((d) => ({ t: d.t, v: d.close }));
    return s.hourly.length >= 3 ? s.hourly : intra;
  }

  function coverageNote(range, pts) {
    if (!pts.length || M.lastT == null) return '';
    const first = pts[0].t;
    let short;
    if (range === 'today') short = first > dayStart(M.lastT) + (8 * 60 + 40) * 60000;
    else if (range === '3d') short = M.intraDays < 3;
    else if (range === '1m') short = first > M.lastT - 28 * DAY;
    else short = first > M.lastT - 60 * DAY;
    if (!short) return '';
    const txt = range === 'all'
      ? 'Gemeten sinds ' + fD.format(first) + '.'
      : 'Er zijn metingen vanaf ' + fDT.format(first) + ', dus deze periode is nog korter dan gekozen.';
    return txt + (M.canImport && !M.weeks.length ? ' Je eerdere gegevens uit de Google Sheet kun je overnemen via Instellingen.' : '');
  }

  // Reeks als procentuele groei, sprongen door aan- of verkopen overgeslagen
  function indexed(pts) {
    let idx = 1;
    return pts.map((p, i) => {
      if (i && pts[i - 1].v > 0) { const r = p.v / pts[i - 1].v - 1; if (Math.abs(r) <= MAX_STEP_MOVE) idx *= 1 + r; }
      return { t: p.t, v: idx - 1 };
    });
  }

  // ---------- Statistiek ----------
  function dailyReturns(tk) {
    const d = seriesOf(tk).daily;
    const k0 = M.lastT == null ? null : dayKey(M.lastT);
    const out = [];
    d.forEach((x, i) => {
      let pct = null;
      const p = d[i - 1];
      if (p && p.close > 0) { const r = x.close / p.close - 1; if (Math.abs(r) <= MAX_DAY_MOVE) pct = r; }
      if (pct == null && x.open > 0) { const r = x.close / x.open - 1; if (Math.abs(r) <= MAX_DAY_MOVE) pct = r; }
      if (pct != null) out.push({ t: x.t, pct, today: dayKey(x.t) === k0 });
    });
    // Vandaag gelijk aan de wijziging bovenaan de pagina
    const it = itemOf(tk);
    const last = out[out.length - 1];
    if (it && last && last.today && isNum(it.changePct)) last.pct = it.changePct;
    return out;
  }

  function statsFor(tk) {
    const r = dailyReturns(tk);
    const ps = r.map((d) => d.pct);
    let streak = 0, dir = 0;
    for (let i = r.length - 1; i >= 0; i--) {
      const s = Math.sign(r[i].pct);
      if (!s) break;
      if (!dir) dir = s;
      if (s !== dir) break;
      streak++;
    }
    const enough = r.length >= MIN_DAYS_BEST;
    const best = enough ? r.reduce((b, d) => (!b || d.pct > b.pct ? d : b), null) : null;
    const worst = enough ? r.reduce((b, d) => (!b || d.pct < b.pct ? d : b), null) : null;
    let corr = null, beta = null;
    if (tk !== TOTAL) {
      const tm = new Map(dailyReturns(TOTAL).map((d) => [dayKey(d.t), d.pct]));
      const pairs = r.map((d) => [d.pct, tm.get(dayKey(d.t))]).filter((p) => isNum(p[1]));
      if (pairs.length >= MIN_DAYS_CORR) {
        const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
        let sxy = 0, sxx = 0, syy = 0;
        pairs.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
        if (sxx > 0 && syy > 0) { corr = sxy / Math.sqrt(sxx * syy); beta = sxy / syy; }
      }
    }
    return {
      returns: r, n: r.length, up: ps.filter((p) => p > 0).length, down: ps.filter((p) => p < 0).length,
      streak, dir, best, worst, sd: r.length >= MIN_DAYS_SD ? stdev(ps) : null, corr, beta,
    };
  }

  const tooFew = (n, min) => 'Nog te weinig gegevens: ' + days(n) + ' gemeten, ' + min + ' nodig';

  function hourPattern(tk) {
    const by = new Map();
    (M.hours.get(tk) || []).forEach((h) => {
      if (!(h.open > 0) || !isNum(h.close)) return;
      const pct = (h.close - h.open) / h.open;
      if (Math.abs(pct) > 0.1) return;
      const hr = new Date(h.t).getHours();
      if (!by.has(hr)) by.set(hr, []);
      by.get(hr).push(pct);
    });
    const out = [];
    for (let hr = 8; hr <= 22; hr++) { const a = by.get(hr) || []; out.push({ hr, v: a.length ? mean(a) : null, n: a.length }); }
    return out;
  }

  function weekdayPattern(returns) {
    const names = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag'];
    return names.map((nm, i) => {
      const a = returns.filter((d) => new Date(d.t).getDay() === i + 1).map((d) => d.pct);
      return { nm, short: nm.slice(0, 2), v: a.length ? mean(a) : null, n: a.length };
    });
  }

  function corrText(c, n) {
    if (!isNum(c)) return n < MIN_DAYS_CORR ? 'na ' + MIN_DAYS_CORR + ' dagen' : '–';
    const w = c >= 0.7 ? 'sterk' : c >= 0.4 ? 'matig' : c >= 0.1 ? 'zwak' : c > -0.1 ? 'geen' : 'tegengesteld';
    return w + ' (' + N2.format(c) + ')';
  }

  function streakText(s) {
    if (!s.streak) return 'Nog geen reeks';
    return s.streak + (s.streak === 1 ? ' dag ' : ' dagen ') + (s.dir > 0 ? 'gestegen' : 'gedaald') + (s.streak > 1 ? ' op rij' : '');
  }

  // ---------- Tooltip ----------
  const tip = $('tip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x - w / 2, top = y - h - 14;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    if (top < 8) top = y + 18;
    tip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
  }
  function hideTip() { tip.hidden = true; }
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el || !el.dataset.tip) return;
    const r = el.getBoundingClientRect();
    showTip(esc(el.dataset.tip).replace(/\n/g, '<br>'), r.left + r.width / 2, r.top);
  });
  document.addEventListener('pointerout', (e) => { if (e.target.closest && e.target.closest('[data-tip]')) hideTip(); });
  window.addEventListener('scroll', hideTip, { passive: true, capture: true });

  // ---------- Grafieken ----------
  function nearestIdx(pts, t) {
    if (!pts.length) return null;
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].t < t) lo = mid + 1; else hi = mid; }
    if (lo > 0 && Math.abs(pts[lo - 1].t - t) < Math.abs(pts[lo].t - t)) lo--;
    return lo;
  }

  const xFmt = (range, pts) => { const span = pts && pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : DAY * 9; return (t) => (span < 20 * HOUR ? fHM : span < 6 * DAY ? fWH : fDM).format(t); };
  const tFmt = (range, pts) => { const daily = pts && pts.length > 1 && (pts[1].t - pts[0].t) >= 20 * HOUR; return (t) => (daily ? fD : fDT).format(t); };

  /* Lijngrafiek op een vaste 1000×100-schaal die meerekt met de breedte.
   * sets: [{ pts: [{t, v}], color, area, dash, label, fmt }]; de eerste reeks bepaalt de tijdas. */
  function lineChart(host, sets, o) {
    o = o || {};
    host.innerHTML = '';
    const main = (sets[0] && sets[0].pts) || [];
    if (main.length < 2) {
      host.innerHTML = '<p class="chart-empty">' + esc(o.empty || 'Nog te weinig metingen voor deze periode.') + '</p>';
      if (o.xl) o.xl.innerHTML = '';
      return;
    }
    const n = main.length;
    const pos = new Map(main.map((p, i) => [p.t, i]));
    let lo = Infinity, hi = -Infinity;
    const ser = sets.map((s) => {
      const m = new Map();
      s.pts.forEach((p) => { if (isNum(p.v) && pos.has(p.t)) { m.set(pos.get(p.t), p.v); lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); } });
      return m;
    });
    if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (!(hi > lo)) { const pad = Math.abs(hi) * 0.01 || 1; hi += pad; lo -= pad; }
    const top = o.top == null ? 0.16 : o.top, bot = o.bottom == null ? 0.06 : o.bottom;
    const X = (i) => (i / (n - 1)) * 1000;
    const Y = (v) => 100 * (top + (1 - top - bot) * (hi - v) / (hi - lo));

    let svg = '<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"' + (o.animate && !reduceMotion() ? ' class="reveal"' : '') + '>';
    if (o.zero) svg += '<line x1="0" x2="1000" y1="' + Y(0).toFixed(2) + '" y2="' + Y(0).toFixed(2) + '" stroke="#9AA3B5" stroke-width="1" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>';
    sets.forEach((s, k) => {
      const idx = [...ser[k].keys()].sort((a, b) => a - b);
      if (idx.length < 2) return;
      const d = idx.map((i, j) => (j ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(ser[k].get(i)).toFixed(2)).join('');
      if (s.area) svg += '<path d="' + d + 'L' + X(idx[idx.length - 1]).toFixed(1) + ' 100L' + X(idx[0]).toFixed(1) + ' 100Z" fill="' + s.color + '" fill-opacity="' + (s.alpha || 0.14) + '"/>';
      svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.width || 2.5) + '" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"' + (s.dash ? ' stroke-dasharray="6 5"' : '') + '/>';
    });
    host.innerHTML = svg + '</svg>';

    (o.markers || []).forEach((mk) => {
      const i = mk.i != null ? mk.i : nearestIdx(main, mk.t);
      const v = i == null ? null : ser[0].get(i);
      if (!isNum(v)) return;
      const el = document.createElement('div');
      const xp = X(i) / 10;
      el.className = 'marker' + (xp > 82 ? ' r' : xp < 18 ? ' l' : '');
      el.style.left = xp + '%';
      el.style.top = Y(v) + '%';
      el.innerHTML = '<span></span><i></i>';
      el.firstChild.textContent = mk.label;
      host.appendChild(el);
    });

    if (o.hover !== false) {
      const lay = document.createElement('div');
      lay.className = 'chart-hover';
      const cur = document.createElement('div');
      cur.className = 'cursor';
      cur.hidden = true;
      lay.appendChild(cur);
      const dots = sets.map((s) => { const d = document.createElement('div'); d.className = 'cursor-dot'; d.style.background = s.color; d.hidden = true; lay.appendChild(d); return d; });
      const move = (e) => {
        const r = lay.getBoundingClientRect();
        const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
        const x = X(i) / 10;
        cur.hidden = false;
        cur.style.left = x + '%';
        let html = '<b>' + esc(o.tfmt ? o.tfmt(main[i].t) : '') + '</b>', yTop = null;
        sets.forEach((s, k) => {
          const v = ser[k].get(i), d = dots[k];
          if (!isNum(v)) { d.hidden = true; return; }
          d.hidden = false; d.style.left = x + '%'; d.style.top = Y(v) + '%';
          if (yTop == null) yTop = Y(v);
          html += '<br>' + (sets.length > 1 ? esc(s.label) + ': ' : '') + esc((s.fmt || o.fmt || eur)(v));
        });
        showTip(html, r.left + (x / 100) * r.width, r.top + ((yTop || 0) / 100) * r.height);
      };
      lay.addEventListener('pointermove', move);
      lay.addEventListener('pointerdown', move);
      lay.addEventListener('pointerleave', () => { cur.hidden = true; dots.forEach((d) => { d.hidden = true; }); hideTip(); });
      host.appendChild(lay);
    }

    if (o.xl && o.xfmt) {
      const k = Math.min(o.xcount || 4, n);
      const labs = [];
      for (let j = 0; j < k; j++) labs.push('<span>' + esc(o.xfmt(main[Math.round((j * (n - 1)) / (k - 1))].t)) + '</span>');
      o.xl.innerHTML = labs.join('');
    }
  }

  function thin(a, max) {
    if (a.length <= max) return a;
    const out = [], step = (a.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) out.push(a[Math.round(i * step)]);
    return out;
  }

  function spark(pts, color, cls) {
    const a = thin((pts || []).filter((p) => isNum(p.v)), 140);
    cls = cls || 'spark';
    if (a.length < 2) return '<div class="' + cls + '"></div>';
    let lo = Infinity, hi = -Infinity;
    a.forEach((p) => { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); });
    if (!(hi > lo)) { hi += 1; lo -= 1; }
    const X = (i) => ((i / (a.length - 1)) * 200).toFixed(1);
    const Y = (v) => (6 + ((hi - v) / (hi - lo)) * 50).toFixed(2);
    const d = a.map((p, i) => (i ? 'L' : 'M') + X(i) + ' ' + Y(p.v)).join('');
    return '<svg class="' + cls + '" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + 'L200 60L0 60Z" fill="' + color + '" fill-opacity=".13"/>' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
  }

  function bars(items, single) {
    const mx = Math.max(1e-12, ...items.map((it) => (isNum(it.v) ? Math.abs(it.v) : 0)));
    const h = (v) => (isNum(v) ? ((Math.abs(v) / mx) * 100).toFixed(1) : 0);
    if (single) {
      return '<div class="bars single">' + items.map((it) =>
        '<div class="col" data-tip="' + esc(it.tip) + '"><div class="b" style="height:' + h(it.v) + '%;background:' + it.color + '"></div></div>').join('') + '</div>';
    }
    // Boven en onder de nullijn krijgen ruimte naar verhouding, zodat er geen lege helft overblijft
    const mxP = Math.max(0, ...items.map((it) => (isNum(it.v) && it.v > 0 ? it.v : 0)));
    const mxN = Math.max(0, ...items.map((it) => (isNum(it.v) && it.v < 0 ? -it.v : 0)));
    const fu = Math.max(0.08, mxP / mx), fd = Math.max(0.08, mxN / mx);
    const hu = (v) => (mxP ? (v / mxP * 100).toFixed(1) : 0), hd = (v) => (mxN ? (-v / mxN * 100).toFixed(1) : 0);
    return '<div class="bars">' + items.map((it) => {
      const v = it.v;
      return '<div class="col" data-tip="' + esc(it.tip) + '">' +
        '<div class="half up" style="flex:' + fu.toFixed(3) + '"><div class="b' + (isNum(v) && v > 0 ? '' : ' none') + '" style="height:' + (v > 0 ? hu(v) : 0) + '%"></div></div>' +
        '<div class="half down" style="flex:' + fd.toFixed(3) + '"><div class="b' + (isNum(v) && v < 0 ? '' : ' none') + '" style="height:' + (v < 0 ? hd(v) : 0) + '%"></div></div></div>';
    }).join('') + '</div>';
  }

  const barLabels = (labels) => '<div class="bar-labels">' + labels.map((l) => '<span>' + esc(l) + '</span>').join('') + '</div>';

  function heatCls(p) {
    const a = Math.abs(p);
    return (p >= 0 ? 'heat-g' : 'heat-l') + (a < 0.005 ? 1 : a < 0.015 ? 2 : 3);
  }

  function calendar(returns) {
    const map = new Map(returns.map((d) => [dayKey(d.t), d]));
    const end = returns.length ? new Date(returns[returns.length - 1].t) : new Date();
    const mon = new Date(end); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const start = new Date(mon); start.setDate(start.getDate() - 7 * 12);
    let cells = '';
    for (let w = 0; w < 13; w++) {
      for (let d = 0; d < 5; d++) {
        const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
        const r = map.get(dayKey(day.getTime()));
        if (r) cells += '<span class="' + heatCls(r.pct) + '" data-tip="' + esc(fD.format(day) + ': ' + spct(r.pct)) + '"></span>';
        else if (day > end) cells += '<span style="visibility:hidden"></span>';
        else cells += '<span data-tip="' + esc(fD.format(day) + ': geen meting') + '"></span>';
      }
    }
    return '<div class="cal-wrap"><div class="cal-days" aria-hidden="true"><span>ma</span><span>di</span><span>wo</span><span>do</span><span>vr</span></div>' +
      '<div class="cal" role="img" aria-label="Resultaat per dag over de laatste 13 weken">' + cells + '</div></div>' +
      '<div class="heat-key" aria-hidden="true">gedaald <i class="heat-l3"></i><i class="heat-l2"></i><i class="heat-l1"></i><i class="heat-g1"></i><i class="heat-g2"></i><i class="heat-g3"></i> gestegen</div>';
  }

  // ---------- Bouwstenen ----------
  const stag = (html, i) => html.replace(/^<(\w+)/, '<$1 style="--i:' + i + '"');
  const fill = (id, items) => { $(id).innerHTML = items.map(stag).join(''); };

  // Kerncijfer als tegel (desktop) of kaart (telefoon)
  function stat(k, v, sub, cls, extra) {
    const flush = !!extra && extra.indexOf('spark') !== -1;
    const base = mode === 'm' ? 'm-stat' : 'tile';
    return '<section class="' + base + (flush ? '' : ' pad') + '"><span class="k">' + esc(k) + '</span>' +
      '<span class="v ' + (cls || '') + '">' + esc(v) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + (extra || '') + '</section>';
  }

  const split = (a, b) => '<div class="meter split" aria-hidden="true"><div style="flex:' + a + ';background:' + C.gain + '"></div><div style="flex:' + b + ';background:' + C.loss + '"></div></div>';

  function kvList(rows) {
    return '<dl class="kv">' + rows.map(([k, v, c]) => '<div><dt>' + esc(k) + '</dt><dd' + (c ? ' class="' + c + '"' : '') + '>' + esc(v) + '</dd></div>').join('') + '</dl>';
  }

  function rangeStrip(c) {
    let lo = Math.min(isNum(c.atl) ? c.atl : c.low, c.low);
    let hi = Math.max(isNum(c.ath) ? c.ath : c.high, c.high);
    if (!isNum(lo) || !isNum(hi)) return '<p class="muted">Nog geen metingen van vandaag.</p>';
    if (!(hi > lo)) { const pad = Math.max(Math.abs(hi) * 0.005, 0.01); lo -= pad; hi += pad; }
    const p = (v) => (((v - lo) / (hi - lo)) * 100).toFixed(2) + '%';
    return '<div class="range" role="img" aria-label="' + esc('Vandaag tussen ' + eur(c.low) + ' en ' + eur(c.high) + ', nu ' + eur(c.value) + '. Laagste gemeten ' + eur(lo) + ', hoogste gemeten ' + eur(hi)) + '">' +
      '<div class="rail"></div><div class="today" style="left:' + p(c.low) + ';width:calc(' + p(c.high) + ' - ' + p(c.low) + ')"></div>' +
      (isNum(c.avg) ? '<div class="avg" style="left:' + p(c.avg) + '"></div>' : '') +
      '<div class="now" style="left:' + p(c.value) + '"></div></div>' +
      '<div class="range-labels"><span>Laagste gemeten ' + esc(eur(lo)) + '</span><span>Hoogste gemeten ' + esc(eur(hi)) + '</span></div>';
  }

  function patternTiles(tk, s) {
    const hp = hourPattern(tk);
    const wp = weekdayPattern(s.returns);
    const edges = [-Infinity, -0.03, -0.02, -0.01, -0.005, 0, 0.005, 0.01, 0.02, 0.03, Infinity];
    const names = ['< −3%', '−3 tot −2%', '−2 tot −1%', '−1 tot −0,5%', '−0,5 tot 0%', '0 tot 0,5%', '0,5 tot 1%', '1 tot 2%', '2 tot 3%', '> 3%'];
    const hist = names.map((nm, i) => {
      const c = s.returns.filter((d) => d.pct >= edges[i] && d.pct < edges[i + 1]).length;
      return { v: c, color: i < 5 ? C.loss : C.gain, tip: nm + ': ' + days(c) };
    });
    const hoursN = sum(hp.map((h) => h.n));
    const note = (t) => '<p class="sub" style="margin-top:8px">' + esc(t) + '</p>';
    const few = (min) => '<p class="muted">' + esc(tooFew(s.n, min)) + '.</p>';
    return [
      '<section class="tile pad"><h3>Resultaat per dag</h3>' + (s.n ? calendar(s.returns) : '<p class="muted">Nog geen dagen gemeten.</p>') + '</section>',
      '<section class="tile pad"><h3>Wanneer beweegt het?</h3>' +
        (hoursN >= 3 ? bars(hp.map((h) => ({ v: h.v, tip: h.hr + ':00–' + (h.hr + 1) + ':00: ' + (h.n ? spct(h.v) + ' gemiddeld (' + h.n + ' uur)' : 'geen metingen') }))) +
          barLabels(hp.map((h) => (h.hr % 2 === 0 ? String(h.hr) : ''))) + note('Gemiddelde verandering per uur van de dag, op basis van ' + hoursN + ' afgeronde uren.')
          : '<p class="muted">Nog te weinig afgeronde uren gemeten.</p>') + '</section>',
      '<section class="tile pad"><h3>Per weekdag</h3>' +
        (s.n >= MIN_DAYS_SD ? bars(wp.map((d) => ({ v: d.v, tip: d.nm + ': ' + (d.n ? spct(d.v) + ' gemiddeld over ' + days(d.n) : 'nog geen metingen') }))) +
          barLabels(wp.map((d) => d.short)) + note('Gemiddeld dagresultaat per weekdag.') : few(MIN_DAYS_SD)) + '</section>',
      '<section class="tile pad"><h3>Hoe groot zijn de dagbewegingen?</h3>' +
        (s.n >= MIN_DAYS_SD ? bars(hist, true) + barLabels(['−3%', '', '', '', '', '0', '', '', '', '+3%']) + note('Aantal dagen per grootte van de beweging.') : few(MIN_DAYS_SD)) + '</section>',
    ];
  }

  // Kerncijfers van de portefeuille (kaarten), gedeeld door desktop en telefoon
  function kpiCards() {
    const W = M.weeks, last = W[W.length - 1];
    const wk = (f) => W.filter((w) => isNum(w[f])).map((w) => ({ t: w.t, v: w[f] }));
    const unreal = sum(M.companies.map((c) => (isNum(c.unreal) ? c.unreal : 0)));
    const none = M.canImport ? 'Nog geen weekmeting' : 'De eerste weekmeting volgt zaterdag';
    return [
      clickable(stat('Accountwaarde', eur(M.accountNow), M.cash != null ? 'beleggingen ' + eur(M.totalValue) + ' + ' + eur(M.cash) + ' vrij saldo' : 'alleen beleggingen; vrij saldo volgt na een weekmeting', '',
        spark(wk('accountValue').concat(M.lastT ? [{ t: M.lastT, v: M.accountNow }] : []), C.accent)), '@account', 'Accountwaarde: bekijk waar je geld zit'),
      last ? clickable(stat('Netto gestort', eur(last.netDeposits), isNum(last.newDeposits) && last.newDeposits ? seur(last.newDeposits) + ' in de laatste week' : 'geen storting in de laatste week', '', spark(wk('netDeposits'), C.ink2)), DEP, 'Netto gestort: bekijk je stortingen', 'Stortingen')
        : stat('Netto gestort', '–', none, '', ''),
      last ? clickable(stat('Totaal resultaat', seur(last.totalResult), spct(last.totalResultPct) + ' op je inleg', tone(last.totalResult), spark(wk('totalResult'), toneColor(last.totalResult))), RES, 'Totaal resultaat: bekijk waar het vandaan komt', 'Opbouw')
        : stat('Totaal resultaat', '–', none, '', ''),
      clickable(stat('Ongerealiseerd', seur(unreal), 'open posities, nu', tone(unreal), spark(wk('unrealized'), toneColor(unreal))), RES, 'Ongerealiseerd: bekijk het per positie', 'Per positie'),
    ];
  }

  // Maak van een kaart een knop die inzoomt
  function clickable(html, key, label, more) {
    return html.replace(/^<section class="([^"]*)">/, '<button type="button" class="$1 clickable" data-ticker="' + key + '" aria-label="' + esc(label) + '">')
      .replace(/<\/section>$/, '<span class="more" aria-hidden="true">' + esc(more || 'Verdeling') + ' ›</span></button>');
  }

  function statCards(S) {
    const W = M.weeks, last = W[W.length - 1];
    const wr = W.filter((w) => isNum(w.weekResultPct));
    let idx = 1;
    const chain = wr.map((w) => { idx *= 1 + w.weekResultPct; return { t: w.t, v: idx - 1 }; });
    const twr = wr.length ? idx - 1 : null;
    const posW = wr.filter((w) => w.weekResultPct > 0).length;
    const T = M.tot;
    const dd = isNum(T.ath) && T.ath > 0 ? (T.value - T.ath) / T.ath : null;
    const top3 = M.companies.slice().sort((a, b) => b.value - a.value).slice(0, 3);
    const top3w = sum(top3.map((c) => c.weight || 0));
    const noWeeks = M.canImport ? 'Neem je weken over via Instellingen' : 'Na de tweede weekmeting';
    return [
      stat('Rendement zonder stortingen', twr == null ? '–' : spct1(twr), wr.length ? 'tijdgewogen, over ' + wr.length + (wr.length === 1 ? ' week' : ' weken') : noWeeks, tone(twr), chain.length > 1 ? spark([{ t: 0, v: 0 }].concat(chain), toneColor(twr)) : ''),
      stat('Weken met winst', wr.length ? posW + ' van ' + wr.length : '–', wr.length ? P1.format(posW / wr.length) + ' van de weken' : noWeeks, '', wr.length ? split(posW, wr.length - posW) : ''),
      stat('Dagen gestegen', S.n ? S.up + ' van ' + S.n : '–', S.n ? streakText(S) : 'Nog geen dagen gemeten', '', S.n ? split(S.up, S.down) : ''),
      stat('Beste dag', S.best ? spct(S.best.pct) : '–', S.best ? fD.format(S.best.t) + '. Slechtste: ' + spct(S.worst.pct) + ' op ' + fD.format(S.worst.t) : tooFew(S.n, MIN_DAYS_BEST), tone(S.best && S.best.pct)),
      clickable(stat('Beweeglijkheid', isNum(S.sd) ? '± ' + P1.format(S.sd) + ' per dag' : '–', isNum(S.sd) ? 'gemiddelde afwijking van het dagresultaat' : tooFew(S.n, MIN_DAYS_SD)), RISK, 'Beweeglijkheid: bekijk je risico en wat het verlaagt', 'Risico'),
      stat('Tot hoogste gemeten', dd == null ? '–' : dd >= -0.0005 ? 'Op het hoogste punt' : spct1(dd), isNum(T.ath) ? 'hoogste ' + eur(T.ath) + ' sinds ' + fDM.format(M.since) : '', dd != null && dd < -0.0005 ? 'loss' : ''),
      stat('Grootste 3 posities', top3.length ? P1.format(top3w) : '–', top3.map((c) => c.tk).join(', ') + ' samen', '', '<div class="meter" aria-hidden="true"><div style="width:' + (top3w * 100).toFixed(1) + '%"></div></div>'),
      stat('Vrij saldo', last && isNum(last.cash) ? eur(last.cash) : '–', last && isNum(last.cash) && last.accountValue ? P1.format(last.cash / last.accountValue) + ' van je accountwaarde' : noWeeks),
    ].concat(moreStatCards(S, wr));
  }

  // Extra kerncijfers: terugval, markt, spreiding, weken en dividend
  function moreStatCards(S, wr) {
    const out = [];
    // Grootste terugval: van een piek naar het laagste punt daarna, op de dagresultaten (aankopen tellen niet mee)
    let idx = 1, peak = 1, mdd = 0, peakT = null, ddFrom = null, ddTo = null;
    const ddPts = [];
    S.returns.forEach((d) => {
      idx *= 1 + d.pct;
      if (idx > peak) { peak = idx; peakT = d.t; }
      const dd = idx / peak - 1;
      if (dd < mdd) { mdd = dd; ddFrom = peakT; ddTo = d.t; }
      ddPts.push({ t: d.t, v: dd });
    });
    out.push(stat('Grootste terugval', S.n >= MIN_DAYS_SD ? (mdd < -0.0005 ? spct1(mdd) : 'Geen') : '–',
      S.n < MIN_DAYS_SD ? tooFew(S.n, MIN_DAYS_SD) : mdd < -0.0005 ? 'van piek tot dal' + (ddFrom ? ', ' + fDM.format(ddFrom) + ' tot ' + fDM.format(ddTo) : ' vanaf de start') : 'nog geen daling na een piek',
      S.n >= MIN_DAYS_SD && mdd < -0.0005 ? 'loss' : '', S.n >= MIN_DAYS_SD ? spark(ddPts, C.loss) : ''));

    // Jij tegenover de markt over dezelfde dagen
    const b = M.bench;
    if (b) {
      const bm = new Map(dailyReturns(b.c.tk).map((d) => [dayKey(d.t), d.pct]));
      const pairs = S.returns.filter((d) => bm.has(dayKey(d.t)));
      let mine = 1, mkt = 1;
      const diffPts = pairs.map((d) => { mine *= 1 + d.pct; mkt *= 1 + bm.get(dayKey(d.t)); return { t: d.t, v: mine - mkt }; });
      const diff = mine - mkt;
      out.push(stat('Jij tegenover de markt', pairs.length >= MIN_DAYS_BEST ? sgn(diff * 100, N2) + ' pp' : '–',
        pairs.length >= MIN_DAYS_BEST ? 'jij ' + spct1(mine - 1) + ', ' + b.label + ' ' + spct1(mkt - 1) + ' over ' + days(pairs.length) : tooFew(pairs.length, MIN_DAYS_BEST),
        pairs.length >= MIN_DAYS_BEST ? tone(diff) : '', pairs.length >= MIN_DAYS_BEST ? spark([{ t: pairs[0].t - DAY, v: 0 }].concat(diffPts), toneColor(diff)) : ''));
    }

    // Spreiding: met hoeveel even grote posities je portefeuille overeenkomt
    const ws = M.companies.map((c) => c.weight || 0);
    const hhi = sum(ws.map((w) => w * w));
    const eff = hhi > 0 ? 1 / hhi : null;
    out.push(stat('Spreiding', eff ? '≈ ' + N1.format(eff) + ' posities' : '–',
      eff ? 'zo gespreid als ' + Math.round(eff) + ' even grote posities; je hebt er ' + M.companies.length : '', '',
      eff ? '<div class="meter" aria-hidden="true"><div style="width:' + Math.min(100, (eff / M.companies.length) * 100).toFixed(1) + '%"></div></div>' : ''));

    // Posities in de plus
    const withRes = M.companies.filter((c) => isNum(c.unreal));
    const plus = withRes.filter((c) => c.unreal > 0).length;
    const bestP = withRes.slice().sort((x, y) => (y.resultPct || 0) - (x.resultPct || 0))[0];
    out.push(stat('Posities in de plus', withRes.length ? plus + ' van ' + withRes.length : '–',
      bestP ? 'beste ' + bestP.tk + ' ' + spct1(bestP.resultPct) : '', '', withRes.length ? split(plus, withRes.length - plus) : ''));

    // Beste en slechtste week in euro
    const best = wr.reduce((x, w) => (!x || w.weekResult > x.weekResult ? w : x), null);
    const worst = wr.reduce((x, w) => (!x || w.weekResult < x.weekResult ? w : x), null);
    out.push(stat('Beste week', best ? seur(best.weekResult) : '–',
      best ? 'tot ' + fDM.format(best.t) + '. Slechtste ' + seur(worst.weekResult) + ' tot ' + fDM.format(worst.t) : 'Na de tweede weekmeting', best ? tone(best.weekResult) : ''));

    // Gemiddelde dag
    const avg = S.n >= MIN_DAYS_BEST ? mean(S.returns.map((d) => d.pct)) : null;
    out.push(stat('Gemiddelde dag', isNum(avg) ? spct(avg) : '–', isNum(avg) ? '≈ ' + seur(avg * M.totalValue) + ' bij je huidige waarde, over ' + days(S.n) : tooFew(S.n, MIN_DAYS_BEST), tone(avg)));

    // Dividend
    const E = M.ev;
    out.push(stat('Dividend, 12 maanden', E.loaded ? eur(E.last12) : '–',
      !E.loaded ? 'na de eerste dagelijkse ophaalronde' : E.received.length ? (isNum(E.yieldOnCost) ? P2.format(E.yieldOnCost) + ' op je inleg' : '') : 'nog geen uitkering ontvangen', E.last12 > 0 ? 'gain' : ''));
    const T = M.tx;
    out.push(stat('Gerealiseerd resultaat', T.has ? seur(T.realised) : '–', T.has ? T.sells.length + ' verkopen, ' + eur(T.fees) + ' kosten betaald' : 'na het ophalen van je orders', T.has ? tone(T.realised) : ''));
    out.push(stat('Valuta-effect', isNum(T.fx) ? seur(T.fx) : '–', isNum(T.fx) ? 'door de wisselkoers, in je ongerealiseerde resultaat' : 'volgt bij de volgende meting', tone(T.fx)));
    out.push(stat('Dividend komende 90 dagen', E.loaded ? '≈ ' + eur(E.next90) : '–',
      E.loaded ? E.divs.filter((d) => d.t <= dayStart(Date.now()) + 90 * DAY).length + ' uitkeringen aangekondigd of verwacht' : 'na de eerste dagelijkse ophaalronde'));
    return out;
  }

  function statsNote(S) {
    return S.n ? 'Op basis van ' + days(S.n) + ' sinds ' + fD.format(S.returns[0].t) + '.' : '';
  }

  function weekCards() {
    const W = M.weeks;
    if (!W.length) {
      return ['<p class="empty">Nog geen weekmetingen. ' + (M.canImport
        ? '<button type="button" class="linklike" data-act="import">Neem je weken over uit de Google Sheet</button>, of wacht op de eerste meting zaterdag.'
        : 'De eerste volgt zaterdag rond 09:00.') + '</p>'];
    }
    const wr = W.filter((w) => isNum(w.weekResult));
    const best = wr.reduce((b, w) => (!b || w.weekResult > b.weekResult ? w : b), null);
    const worst = wr.reduce((b, w) => (!b || w.weekResult < b.weekResult ? w : b), null);
    const sorted = M.companies.slice().sort((a, b) => b.value - a.value);
    const shades = ['#1E3A8A', '#2B5BD7', '#5B86E5', '#8FAEF0', '#BFD0F7'];
    const topN = sorted.slice(0, 5), rest = sorted.slice(5);
    const restVal = sum(rest.map((c) => c.value));
    const pctOf = (v) => (M.totalValue ? P1.format(v / M.totalValue) : '–');
    return [
      '<section class="tile pad"><h3>Accountwaarde en inleg</h3><div class="chart" data-chart="weeks" style="height:150px"></div>' +
        '<div class="xlabels" data-x="weeks"></div><div class="legend" style="margin-top:8px"><span><i style="background:' + C.accent + '"></i>Accountwaarde</span><span><i class="dash"></i>Netto gestort</span></div></section>',
      '<section class="tile pad"><h3>Resultaat per week</h3>' +
        (wr.length ? bars(wr.map((w) => ({ v: w.weekResult, tip: 'Week tot ' + fDM.format(w.t) + ': ' + seur(w.weekResult) + ' (' + spct(w.weekResultPct) + ')' }))) +
          '<div class="bar-labels"><span style="text-align:left">' + esc(fDM.format(wr[0].t)) + '</span><span style="text-align:right">' + esc(fDM.format(wr[wr.length - 1].t)) + '</span></div>' +
          '<p class="sub" style="margin-top:8px">Zonder stortingen. Beste week ' + esc(seur(best.weekResult)) + ', slechtste ' + esc(seur(worst.weekResult)) + '.</p>'
          : '<p class="muted">Na de tweede weekmeting zie je hier het resultaat per week.</p>') + '</section>',
      '<section class="tile pad"><h3>Verdeling</h3><div class="stack" role="img" aria-label="Verdeling van de portefeuille">' +
        topN.map((c, i) => '<div style="flex:' + c.value + ';background:' + shades[i] + '" data-tip="' + esc(c.tk + ': ' + pctOf(c.value)) + '"></div>').join('') +
        (rest.length ? '<div style="flex:' + restVal + ';background:#CDD3DD" data-tip="' + esc('Overig: ' + pctOf(restVal)) + '"></div>' : '') + '</div>' +
        '<div class="legend-list">' + topN.map((c, i) =>
          '<button type="button" data-ticker="' + esc(c.tk) + '"><i style="background:' + shades[i] + '"></i><span class="nm">' + esc(c.tk) + ' <span class="muted">' + esc(c.name) + '</span></span><b>' + esc(pctOf(c.value)) + '</b></button>').join('') +
        (rest.length ? '<button type="button" data-goto="bedrijven"><i style="background:#CDD3DD"></i><span class="nm">Overig (' + rest.length + ')</span><b>' + esc(pctOf(restVal)) + '</b></button>' : '') + '</div></section>',
    ];
  }

  function drawWeekChart(root) {
    const host = root.querySelector('[data-chart="weeks"]');
    if (!host) return;
    const W = M.weeks;
    lineChart(host, [
      { pts: W.map((w) => ({ t: w.t, v: w.accountValue })), color: C.accent, area: true, label: 'Accountwaarde' },
      { pts: W.filter((w) => isNum(w.netDeposits)).map((w) => ({ t: w.t, v: w.netDeposits })), color: C.ink2, dash: true, width: 2, label: 'Netto gestort' },
    ], { top: 0.08, bottom: 0.08, xl: root.querySelector('[data-x="weeks"]'), xcount: 2, xfmt: (t) => fDM.format(t), tfmt: (t) => 'Week tot ' + fDM.format(t), empty: 'Na de tweede weekmeting zie je hier het verloop.' });
  }

  function heroMarkers(pts, range) {
    const markers = [];
    if (pts.length > 2) {
      let mi = 0;
      pts.forEach((p, i) => { if (p.v > pts[mi].v) mi = i; });
      markers.push({ i: mi, label: 'hoogste ' + eur(pts[mi].v) });
      if (range === 'all' || range === '1m') {
        M.weeks.filter((w) => isNum(w.newDeposits) && w.newDeposits > 0 && w.t >= pts[0].t && w.t <= pts[pts.length - 1].t + DAY)
          .slice(-3).forEach((w) => { const i = nearestIdx(pts, w.t); if (i !== mi) markers.push({ i, label: 'storting ' + eur(w.newDeposits) }); });
      }
    }
    return markers;
  }

  function segButtons(host, opts, current, onPick) {
    host.innerHTML = opts.map(([k, l]) => '<button type="button" data-k="' + k + '" aria-pressed="' + (k === current) + '">' + esc(l) + '</button>').join('');
    host.onclick = (e) => { const b = e.target.closest('button[data-k]'); if (b) onPick(b.dataset.k); };
  }

  function drawHero(p, animate) {
    const r = ui.heroRange;
    const pts = seriesFor(TOTAL, r);
    segButtons($(p + 'hero-ranges'), RANGES, r, (k) => { ui.heroRange = k; drawHero(p, true); });
    lineChart($(p + 'hero-chart'), [{ pts, color: C.accent, area: true, width: 3 }], {
      animate, markers: heroMarkers(pts, r), xl: $(p + 'hero-x'), xfmt: xFmt(r, pts), tfmt: tFmt(r, pts),
      empty: 'Nog te weinig metingen voor deze periode. De tracker meet op werkdagen tussen 08:00 en 22:30.',
    });
    $(p + 'hero-note').textContent = coverageNote(r, pts);
  }

  function changeLine(o) {
    if (!isNum(o.change)) return 'Nog geen metingen van vandaag';
    return seur(o.change) + ' (' + spct(o.changePct) + ') ' + M.dayWord;
  }

  // Kerncijfers van één bedrijf
  function companyInfo(c) {
    const S = statsFor(c.tk);
    const dAll = seriesFor(c.tk, 'all');
    const tMap = new Map(seriesFor(TOTAL, 'all').map((p) => [dayKey(p.t), p.v]));
    const weightHist = dAll.map((p) => { const t = tMap.get(dayKey(p.t)); return t ? { t: p.t, v: p.v / t } : null; }).filter(Boolean);
    const monthAgo = weightHist.filter((p) => p.t <= (M.lastT || Date.now()) - 30 * DAY).pop();
    let runMax = -Infinity;
    const ddHist = dAll.map((p) => { runMax = Math.max(runMax, p.v); return { t: p.t, v: p.v / runMax - 1 }; });
    const dd = isNum(c.ath) && c.ath > 0 ? (c.value - c.ath) / c.ath : null;
    const price = c.qty ? c.value / c.qty : null;
    const avgBuy = c.qty && isNum(c.cost) ? c.cost / c.qty : null;
    const todayRangePct = isNum(c.high) && isNum(c.low) && c.avg ? (c.high - c.low) / c.avg : null;
    let rangeNote = '';
    if (isNum(todayRangePct) && isNum(c.avgRangePct) && c.avgRangePct > 0 && c.histDays > 2) {
      const ratio = todayRangePct / c.avgRangePct;
      rangeNote = M.dayWord.charAt(0).toUpperCase() + M.dayWord.slice(1) + ' ' + P1.format(todayRangePct) + ' tussen laag en hoog, ' +
        (ratio > 1.3 ? 'drukker dan' : ratio < 0.7 ? 'rustiger dan' : 'ongeveer zoals') + ' gemiddeld (' + P1.format(c.avgRangePct) + ').';
    }
    const T = M.tot;
    const contrib = isNum(c.change) && isNum(T.change) ? seur(c.change) + ' van ' + seur(T.change) : '–';
    const kpis = [
      stat(M.isToday ? 'Vandaag' : 'Laatste handelsdag', seur(c.change), spct(c.changePct) + ' ' + baseText(c), tone(c.change), spark(seriesFor(c.tk, 'today'), toneColor(c.change))),
      stat('Sinds aankoop', spct1(c.resultPct), isNum(c.unreal) ? seur(c.unreal) + ' op ' + eur(c.cost) + ' inleg' : 'geen aankoopgegevens', tone(c.resultPct), spark(dAll, toneColor(c.resultPct))),
      stat('Deel van portefeuille', isNum(c.weight) ? P1.format(c.weight) : '–', monthAgo ? 'was ' + P1.format(monthAgo.v) + ' op ' + fDM.format(monthAgo.t) : 'van ' + eur(M.totalValue), '', spark(weightHist, C.accent)),
      stat('Tot hoogste gemeten', dd == null ? '–' : dd >= -0.0005 ? 'Op het hoogste punt' : spct1(dd), isNum(c.ath) ? 'hoogste ' + eur(c.ath) + ' sinds ' + fDM.format(M.since) : '', dd != null && dd < -0.0005 ? 'loss' : '', spark(ddHist, C.loss)),
    ];
    const rangeTile = '<section class="tile pad"><h3>Dagbereik binnen de historie</h3>' + rangeStrip(c) +
      '<p class="sub" style="margin-top:10px">Balk: laag tot hoog ' + esc(M.dayWord) + '. Streep: gemiddelde. Punt: nu. ' + esc(rangeNote) + '</p>' +
      '<div style="margin-top:12px">' + kvList([
        ['Opening', eur(c.open)],
        ['Laagste en hoogste', isNum(c.low) ? eur(c.low) + ' – ' + eur(c.high) : '–'],
        ['Gemiddelde', eur(c.avg)],
        ['Boven laagste gemeten', isNum(c.atl) && c.atl > 0 ? spct1((c.value - c.atl) / c.atl) : '–'],
      ]) + '</div></section>';
    const posTile = '<section class="tile pad"><h3>Positie</h3>' + kvList([
      ['Waarde nu', eur(c.value)],
      ['Aantal', c.qty ? N4.format(c.qty) : '–'],
      ['Koers in euro', eur(price)],
      ['Gemiddelde aankoopprijs', eur(avgBuy)],
      ['Ingelegd', eur(c.cost)],
      ['Ongerealiseerd', isNum(c.unreal) ? seur(c.unreal) + ' (' + spct1(c.resultPct) + ')' : '–', tone(c.unreal)],
      ['Bijdrage aan dagresultaat', contrib, tone(c.change)],
    ]) + '</section>';
    const histTile = '<section class="tile pad"><h3>Historie</h3>' + kvList([
      ['Gemeten dagen', S.n ? S.n + ' sinds ' + fDM.format(S.returns[0].t) : '–'],
      ['Gestegen en gedaald', S.n ? S.up + ' en ' + days(S.down) : '–'],
      ['Huidige reeks', streakText(S)],
      ['Beste dag', S.best ? spct(S.best.pct) + ', ' + fD.format(S.best.t) : 'na ' + MIN_DAYS_BEST + ' dagen', S.best ? 'gain' : ''],
      ['Slechtste dag', S.worst ? spct(S.worst.pct) + ', ' + fD.format(S.worst.t) : 'na ' + MIN_DAYS_BEST + ' dagen', S.worst ? 'loss' : ''],
      ['Gemiddeld dagbereik', isNum(c.avgRange) && c.histDays > 1 ? eur(c.avgRange) + ' (' + P1.format(c.avgRangePct || 0) + ')' : 'na 2 dagen'],
      ['Beweeglijkheid', isNum(S.sd) ? '± ' + P1.format(S.sd) + ' per dag' : 'na ' + MIN_DAYS_SD + ' dagen'],
      ['Beweegt mee met portefeuille', corrText(S.corr, S.n)],
      ['Gevoeligheid', isNum(S.beta) ? N2.format(S.beta) + '× de portefeuille' : 'na ' + MIN_DAYS_CORR + ' dagen'],
    ].concat((() => { const r = companyRisk(c); return r ? [['Risicoklasse (1–7)', r.cls + ', ' + RISK_WORDS[r.cls] + ' (' + P1.format(r.vol) + ' per jaar)', r.cls >= 6 ? 'loss' : r.cls <= 4 ? 'gain' : ''],
      ['Aandeel in je risico', isNum(r.contrib) ? P1.format(r.contrib) + ' bij ' + P1.format(c.weight || 0) + ' van de waarde' : '–']] : [['Risicoklasse (1–7)', 'te weinig koershistorie']]; })())) + '</section>';
    return { S, kpis, rangeTile, posTile, histTile, riskTile: companyWhyTile(c), agendaTile: companyAgenda(c), tradeTile: companyTrades(c), market: companyMarket(c), research: companyResearch(c), patterns: patternTiles(c.tk, S) };
  }

  const FOOT = 'Dagresultaten zijn de verandering ten opzichte van het slot van de vorige handelsdag (of de eerste meting als die er niet is). Dagen die meer dan 25% bewegen, tellen niet mee: dat is bijna altijd een aankoop of verkoop. ' +
    '“Hoogste” en “laagste” zijn gemeten sinds de tracker meet. Koers en aankoopprijs zijn in euro en volgen uit waarde, inleg en aantal. “Beweegt mee” is de correlatie van de dagresultaten met die van je hele portefeuille; “gevoeligheid” geeft aan hoeveel sterker of zwakker het bedrijf meestal beweegt.';



  // ---------- Aan- en verkopen, gerealiseerd resultaat en kosten ----------
  const CUR_SYM = { USD: '$', EUR: '€', GBP: '£', GBX: 'p', CHF: 'CHF ', DKK: 'kr ', SEK: 'kr ', NOK: 'kr ', JPY: '¥', CAD: 'C$', HKD: 'HK$' };
  const money = (v, cur) => (!isNum(v) ? '–' : cur === 'EUR' || !cur ? eur(v) : (CUR_SYM[cur] || cur + ' ') + N2.format(v));

  function deriveOrders(o, m) {
    const T = { list: [], byTk: new Map() };
    ((o && o.rows) || []).forEach((r) => {
      const t = new Date(r[0]).getTime();
      if (!isNum(t)) return;
      const x = { t, tk: r[1], name: r[2], side: r[3], qty: r[4], price: r[5], cur: r[6], fxRate: r[7], net: r[8], realised: r[9] || 0, feeFx: r[10] || 0, feeOther: r[11] || 0, kind: r[12] };
      T.list.push(x);
      if (!T.byTk.has(x.tk)) T.byTk.set(x.tk, []);
      T.byTk.get(x.tk).push(x);
    });
    T.list.sort((a, b) => a.t - b.t);
    T.trades = T.list.filter((x) => !x.kind || x.kind === 'TRADE');
    T.realised = sum(T.list.map((x) => x.realised || 0));
    T.fees = sum(T.list.map((x) => (x.feeFx || 0) + (x.feeOther || 0)));
    T.sells = T.trades.filter((x) => x.side === 'SELL');
    T.buys = T.trades.filter((x) => x.side === 'BUY');
    T.fx = m.companies.some((c) => isNum(c.fx)) ? sum(m.companies.map((c) => (isNum(c.fx) ? c.fx : 0))) : null;
    T.has = T.list.length > 0;
    // Gerealiseerd per aandeel, ook voor posities die je niet meer hebt
    const per = new Map();
    T.list.forEach((x) => {
      const o2 = per.get(x.tk) || { tk: x.tk, name: x.name || x.tk, realised: 0, fees: 0, sells: 0, held: m.byTk.has(x.tk) };
      o2.realised += x.realised || 0; o2.fees += (x.feeFx || 0) + (x.feeOther || 0); if (x.side === 'SELL') o2.sells++;
      per.set(x.tk, o2);
    });
    T.perTk = [...per.values()];
    return T;
  }

  function tradeMarkers(tk, pts) {
    const T = M.tx;
    if (!T.has || pts.length < 2) return [];
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    return (T.byTk.get(tk) || []).filter((x) => (!x.kind || x.kind === 'TRADE') && x.t >= t0 && x.t <= t1 + HOUR).slice(-4)
      .map((x) => ({ i: nearestIdx(pts, x.t), label: (x.side === 'SELL' ? 'verkoop ' : 'koop ') + eur(x.net) }));
  }

  // Valuta-effect en transacties van één bedrijf
  function companyTrades(c) {
    const T = M.tx;
    const list = (T.byTk.get(c.tk) || []).filter((x) => !x.kind || x.kind === 'TRADE');
    const fxRows = [];
    if (isNum(c.fx) && isNum(c.unreal)) {
      fxRows.push(['Koerseffect', seur(c.unreal - c.fx), tone(c.unreal - c.fx)]);
      fxRows.push(['Valuta-effect' + (c.cur && c.cur !== 'EUR' ? ' (' + c.cur + ' t.o.v. euro)' : ''), seur(c.fx), tone(c.fx)]);
    }
    if (isNum(c.avgNative) && c.cur) {
      fxRows.push(['Gemiddelde aankoopprijs in ' + c.cur, money(c.avgNative, c.cur)]);
      if (isNum(c.priceNative)) fxRows.push(['Koers nu in ' + c.cur, money(c.priceNative, c.cur) + ' (' + spct1(c.priceNative / c.avgNative - 1) + ')', tone(c.priceNative - c.avgNative)]);
    }
    if (!list.length && !fxRows.length) return '';
    const buys = list.filter((x) => x.side === 'BUY'), sells = list.filter((x) => x.side === 'SELL');
    const allTk = T.byTk.get(c.tk) || [];
    const realised = sum(allTk.map((x) => x.realised || 0)), fees = sum(allTk.map((x) => (x.feeFx || 0) + (x.feeOther || 0)));
    const rows = fxRows.concat(list.length ? [
      ['Eerste aankoop', buys.length ? fD.format(buys[0].t) + ' ' + new Date(buys[0].t).getFullYear() : '–'],
      ['Aankopen en verkopen', buys.length + ' en ' + sells.length],
      ['Gekocht voor', eur(sum(buys.map((x) => x.net)))],
      ['Verkocht voor', sells.length ? eur(sum(sells.map((x) => x.net))) : '–'],
      ['Gerealiseerd resultaat', sells.length ? seur(realised) : 'nog niets verkocht', sells.length ? tone(realised) : ''],
      ['Betaalde kosten', eur(fees)],
    ] : []);
    const recent = list.slice(-6).reverse();
    const txList = recent.length ? '<div class="tx-list">' + recent.map((x) =>
      '<div class="tx"><span class="tag' + (x.side === 'SELL' ? ' loss' : ' gain') + '">' + (x.side === 'SELL' ? 'Verkoop' : 'Koop') + '</span>' +
      '<span class="tx-m"><b>' + esc(N4.format(x.qty)) + ' × ' + esc(money(x.price, x.cur)) + '</b><span class="sub">' + esc(fD.format(x.t) + ' ' + new Date(x.t).getFullYear()) + '</span></span>' +
      '<span class="tx-v">' + esc(eur(x.net)) + (x.realised ? '<span class="sub ' + tone(x.realised) + '">' + esc(seur(x.realised)) + '</span>' : '') + '</span></div>' +
      (x.side === 'BUY' ? noteBlock(x) : '')).join('') + '</div>' : '';
    return '<section class="tile pad"><h3>Aankoop, valuta en transacties</h3>' + kvList(rows) +
      (txList ? '<h3 style="margin-top:16px">Laatste transacties</h3>' + txList : '') +
      (isNum(c.fx) ? '<p class="sub" style="margin-top:8px">Valuta-effect volgens Trading 212: het deel van je ongerealiseerde resultaat dat komt door de wisselkoers sinds je aankopen. Koerseffect is de rest.</p>' : '') + '</section>';
  }

  // Gerealiseerd per aandeel, ook voor posities die je niet meer hebt
  function realisedTile() {
    const T = M.tx;
    if (!T.has) return '';
    const per = T.perTk.filter((x) => x.sells || x.realised).sort((a, b) => b.realised - a.realised);
    const mx = Math.max(1e-9, ...per.map((x) => Math.abs(x.realised)));
    return '<section class="tile pad"><h3>Gerealiseerd en kosten</h3>' + kvList([
      ['Gerealiseerd resultaat', seur(T.realised), tone(T.realised)],
      ['Aankopen en verkopen', T.buys.length + ' en ' + T.sells.length],
      ['Betaalde kosten', eur(T.fees) + (T.list.length ? ' (' + P2.format(T.fees / Math.max(1, sum(T.trades.map((x) => x.net)))) + ' van je orders)' : '')],
      ['Valuta-effect op open posities', isNum(T.fx) ? seur(T.fx) : '–', tone(T.fx)],
    ]) + (per.length ? '<div class="hbars" style="margin-top:12px">' + per.map((x) =>
      '<' + (x.held ? 'button type="button" data-open="' + esc(x.tk) + '"' : 'div') + ' class="r" data-tip="' + esc(x.name + ': ' + seur(x.realised) + (x.held ? '' : ' (positie gesloten)')) + '">' +
      '<span class="tk">' + esc(x.tk) + '</span><span class="track"><span class="mid"></span><span class="' + (x.realised < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(x.realised) / mx * 50).toFixed(1) + '%"></span></span>' +
      '<span class="' + tone(x.realised) + '" style="text-align:right;font-weight:600">' + esc(seur(x.realised)) + '</span></' + (x.held ? 'button' : 'div') + '>').join('') + '</div>' : '') +
      '<p class="sub" style="margin-top:8px">Gerealiseerd resultaat en kosten volgens Trading 212, per uitgevoerde order. Kosten zijn vooral wisselkosten.</p></section>';
  }

  // ---------- Agenda: dividenden en kwartaalcijfers ----------
  const ymd = (s) => { const a = String(s || '').slice(0, 10).split('-').map(Number); return a.length === 3 && a.every(isNum) ? new Date(a[0], a[1] - 1, a[2]).getTime() : null; };
  const fDay = new Intl.DateTimeFormat(LOCALE, { day: 'numeric' });
  const fMon = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
  const fMonY = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit' });
  const FREQ_DAYS = { monthly: 30.4, quarterly: 91.3, 'semi-annual': 182.6, semiannual: 182.6, annual: 365.25, yearly: 365.25 };

  function whenText(t) {
    const n = Math.round((t - dayStart(Date.now())) / DAY);
    if (n === 0) return 'vandaag';
    if (n === 1) return 'morgen';
    if (n < 0) return Math.abs(n) + ' dagen geleden';
    return n < 14 ? 'over ' + n + ' dagen' : 'over ' + Math.round(n / 7) + ' weken';
  }

  // Zet de ruwe gegevens van de Worker om: ontvangen, aangekondigd en (op basis van eerdere uitkeringen) verwacht
  function deriveEvents(ev, m) {
    const today = dayStart(Date.now());
    const E = { loaded: !!ev, fmp: !!(ev && ev.fmp), updated: ev && ev.updated ? new Date(ev.updated).getTime() : null, errors: (ev && ev.errors) || [] };
    const held = (tk) => m.byTk.get(tk);
    E.received = ((ev && ev.received) || []).map((d) => Object.assign({}, d, { t: ymd(d.date) }))
      .filter((d) => d.t != null && isNum(d.amount)).sort((a, b) => a.t - b.t);
    E.total = sum(E.received.map((d) => d.amount));
    E.last12 = sum(E.received.filter((d) => d.t > today - 365 * DAY).map((d) => d.amount));
    const first = new Date(today); first.setDate(1);
    E.months = [];
    for (let i = 11; i >= 0; i--) {
      const s = new Date(first.getFullYear(), first.getMonth() - i, 1).getTime();
      const e = new Date(first.getFullYear(), first.getMonth() - i + 1, 1).getTime();
      E.months.push({ t: s, v: sum(E.received.filter((d) => d.t >= s && d.t < e).map((d) => d.amount)) });
    }
    E.byTk = new Map();
    E.received.forEach((d) => E.byTk.set(d.ticker, (E.byTk.get(d.ticker) || 0) + d.amount));

    const up = [];
    ((ev && ev.dividends) || []).forEach((d) => {
      if (!held(d.ticker) || !d.announced) return;
      const pay = ymd(d.payDate), ex = ymd(d.exDate);
      const t = pay != null ? pay : ex;
      if (t == null || t < today) return;
      up.push({ tk: d.ticker, t, ex, pay, eur: d.estEur, perShare: d.perShare, kind: 'Aangekondigd', gross: true });
    });
    // Verwacht uit je eigen uitkeringen: zelfde tussenpoos, bedrag geschaald naar je huidige aantal
    const hist = new Map();
    E.received.forEach((d) => { if (!hist.has(d.ticker)) hist.set(d.ticker, []); hist.get(d.ticker).push(d); });
    hist.forEach((list, tk) => {
      if (!held(tk) || up.some((u) => u.tk === tk) || list.length < 2) return;
      const gaps = list.slice(1).map((d, i) => d.t - list[i].t).filter((g) => g > 20 * DAY && g < 400 * DAY).sort((a, b) => a - b);
      if (!gaps.length) return;
      const gap = gaps[Math.floor(gaps.length / 2)];
      const last = list[list.length - 1];
      let t = last.t + gap;
      while (t < today) t += gap;
      if (t - today > 200 * DAY) return;
      const q = held(tk).qty;
      up.push({ tk, t, pay: t, eur: last.qty && q ? last.amount * q / last.qty : last.amount, kind: 'Verwacht', gross: false });
    });
    // Verwacht uit de laatste uitkering bij FMP, als je dit aandeel nog geen dividend hebt ontvangen
    ((ev && ev.dividends) || []).forEach((d) => {
      if (!held(d.ticker) || d.announced || up.some((u) => u.tk === d.ticker)) return;
      const per = FREQ_DAYS[String(d.frequency || '').toLowerCase()];
      const lastEx = ymd(d.lastEx);
      if (!per || lastEx == null) return;
      let t = lastEx + per * DAY;
      while (t < today) t += per * DAY;
      if (t - today > 200 * DAY) return;
      up.push({ tk: d.ticker, t, ex: t, eur: d.estEur, perShare: d.perShare, kind: 'Verwacht', gross: true, exOnly: true });
    });
    E.divs = up.sort((a, b) => a.t - b.t);
    E.next90 = sum(E.divs.filter((u) => u.t <= today + 90 * DAY && isNum(u.eur)).map((u) => u.eur));
    E.earn = ((ev && ev.earnings) || []).filter((e) => held(e.ticker)).map((e) => ({ tk: e.ticker, t: ymd(e.date), epsEst: e.epsEst, revEst: e.revEst }))
      .filter((e) => e.t != null && e.t >= today).sort((a, b) => a.t - b.t);
    E.lastEarn = new Map(((ev && ev.lastEarnings) || []).map((e) => [e.ticker, Object.assign({}, e, { t: ymd(e.date) })]));
    const cost = sum(m.companies.map((c) => (isNum(c.cost) ? c.cost : 0)));
    E.yieldOnCost = cost > 0 && E.received.length ? E.last12 / cost : null;
    return E;
  }

  function agRow(tk, t, title, sub, amt, tag) {
    const c = M.byTk.get(tk);
    return '<button type="button" class="ag-row" data-ticker="' + esc(tk) + '" aria-label="' + esc((c ? c.name : tk) + ', ' + fD.format(t) + ', ' + sub) + '">' +
      '<span class="ag-date"><b>' + esc(fDay.format(t)) + '</b><span>' + esc(fMon.format(t).replace('.', '')) + '</span></span>' +
      '<span class="ag-main"><span class="ag-t">' + esc(title) + '</span>' +
      '<span class="ag-s">' + (tag ? '<span class="tag' + (tag === 'Aangekondigd' ? ' gain' : '') + '">' + esc(tag) + '</span> ' : '') + esc(sub) + '</span></span>' + (amt ? '<span class="ag-amt">' + esc(amt) + '</span>' : '') + '</button>';
  }

  function surpriseText(le) {
    if (!le || !isNum(le.eps) || !isNum(le.epsEst) || !le.epsEst) return '';
    const d = (le.eps - le.epsEst) / Math.abs(le.epsEst);
    return Math.abs(d) < 0.005 ? 'gelijk aan de verwachting' : spct1(d) + (d > 0 ? ' boven' : ' onder') + ' de verwachting';
  }

  function agendaTiles() {
    const E = M.ev;
    if (!E.loaded) {
      return ['<p class="empty">De agenda met dividenden en kwartaalcijfers wordt één keer per dag opgehaald door de Worker (rond 06:15). ' +
        'Dat is nog niet gebeurd; na de eerste keer staat hier wat eraan komt.</p>'];
    }
    const nameOf = (tk) => { const c = M.byTk.get(tk); return c ? c.name : tk; };
    const earn = E.earn.slice(0, 6);
    const earnBody = !E.fmp
      ? '<p class="muted">Data van kwartaalcijfers komen van Financial Modeling Prep. Daarvoor is een gratis sleutel nodig; de README legt uit hoe je die toevoegt.</p>'
      : earn.length ? '<div class="ag-list">' + earn.map((e) => agRow(e.tk, e.t, e.tk + ' ' + nameOf(e.tk),
          whenText(e.t) + (isNum(e.epsEst) ? ', verwachte winst per aandeel ' + N2.format(e.epsEst) : ''), '', '')).join('') + '</div>' +
          (E.earn.length > earn.length ? '<p class="sub" style="margin-top:8px">En nog ' + (E.earn.length - earn.length) + ' later.</p>' : '')
        : '<p class="muted">Geen aangekondigde kwartaalcijfers gevonden voor je aandelen.</p>';
    const divs = E.divs.slice(0, 6);
    const divBody = divs.length
      ? '<div class="ag-list">' + divs.map((d) => agRow(d.tk, d.t, d.tk + ' ' + nameOf(d.tk),
          (d.exOnly ? 'ex-dividend ' : d.pay ? 'uitbetaling ' : 'ex-dividend ') + whenText(d.t) +
          (d.ex && d.pay && d.ex !== d.pay ? ', ex-dividend ' + fDM.format(d.ex) : ''),
          isNum(d.eur) ? '≈ ' + eur(d.eur) : '', d.kind)).join('') + '</div>' +
          '<p class="sub" style="margin-top:8px">Komende 90 dagen ongeveer ' + esc(eur(E.next90)) + '. Aangekondigde bedragen zijn bruto (voor bronbelasting); verwachte bedragen volgen je eerdere netto uitkeringen.</p>'
      : '<p class="muted">' + (E.fmp ? 'Geen aangekondigde of verwachte dividenden in de komende maanden.' : (E.received.length ? 'Voor een verwachting zijn per aandeel minstens 2 eerdere uitkeringen nodig.' : 'Nog geen dividend ontvangen om een verwachting op te baseren.') + ' Met een FMP-sleutel zie je ook aangekondigde dividenden.') + '</p>';
    const top = [...E.byTk.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const recBody = E.received.length
      ? '<p class="v big">' + esc(eur(E.last12)) + '</p><p class="sub">ontvangen in de laatste 12 maanden' + (isNum(E.yieldOnCost) ? ', ' + esc(P2.format(E.yieldOnCost)) + ' op je inleg' : '') + '</p>' +
        '<div style="margin-top:12px">' + bars(E.months.map((x) => ({ v: x.v, color: C.gain, tip: fMonY.format(x.t) + ': ' + eur(x.v) })), true) +
        barLabels(E.months.map((x, i) => (i % 3 === 0 ? fMon.format(x.t).replace('.', '') : ''))) + '</div>' +
        '<p class="sub" style="margin-top:8px">Sinds de eerste uitkering ' + esc(eur(E.total)) + '. Meeste van ' + esc(top.map(([tk, v]) => tk + ' (' + eur(v) + ')').join(', ')) + '.</p>'
      : '<p class="muted">Nog geen dividend ontvangen.</p>';
    const upd = E.updated ? '<p class="sub" style="margin-top:10px">Opgehaald ' + esc(fDT.format(E.updated)) + (E.errors.length ? '. ' + E.errors.length + ' onderdelen gaven een fout.' : '.') + '</p>' : '';
    return [
      '<section class="tile pad"><h3>Kwartaalcijfers</h3>' + earnBody + (E.fmp ? upd : '') + '</section>',
      '<section class="tile pad"><h3>Dividend dat eraan komt</h3>' + divBody + '</section>',
      '<section class="tile pad"><h3>Ontvangen dividend</h3>' + recBody + (E.fmp ? '' : upd) + '</section>',
    ];
  }

  // Agenda van één bedrijf
  function companyAgenda(c) {
    const E = M.ev;
    if (!E.loaded) return '';
    const e = E.earn.find((x) => x.tk === c.tk);
    const le = E.lastEarn.get(c.tk);
    const d = E.divs.find((x) => x.tk === c.tk);
    const rec = E.received.filter((x) => x.ticker === c.tk);
    const isFund = ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk));
    const rows = [];
    if (!isFund) {
      rows.push(['Volgende kwartaalcijfers', e ? fD.format(e.t) + ', ' + whenText(e.t) : E.fmp ? 'nog niet aangekondigd' : 'vraagt een FMP-sleutel']);
      if (e && isNum(e.epsEst)) rows.push(['Verwachte winst per aandeel', N2.format(e.epsEst)]);
      if (le) rows.push(['Vorige cijfers', fDM.format(le.t) + (isNum(le.eps) ? ', winst per aandeel ' + N2.format(le.eps) : '')]);
      if (le && surpriseText(le)) rows.push(['Ten opzichte van verwachting', surpriseText(le), le.eps >= le.epsEst ? 'gain' : 'loss']);
    }
    rows.push(['Volgend dividend', d ? fD.format(d.t) + (isNum(d.eur) ? ', ≈ ' + eur(d.eur) : '') + (d.kind === 'Verwacht' ? ' (verwacht)' : '') : isFund ? 'fonds herbelegt of keert niet uit' : 'geen bekend']);
    rows.push(['Ontvangen dividend', rec.length ? eur(sum(rec.map((x) => x.amount))) + ' in ' + rec.length + (rec.length === 1 ? ' uitkering' : ' uitkeringen') : 'nog niets']);
    if (rec.length && isNum(c.cost) && c.cost > 0) {
      const y = sum(rec.filter((x) => x.t > dayStart(Date.now()) - 365 * DAY).map((x) => x.amount)) / c.cost;
      rows.push(['Dividendrendement op inleg', P2.format(y) + ' per jaar']);
    }
    return '<section class="tile pad"><h3>Agenda</h3>' + kvList(rows) + '</section>';
  }


  // ---------- Markt: sector, branche en vergelijkbare bedrijven ----------
  const SECTOR_NL = {
    'Technology': 'Technologie', 'Healthcare': 'Gezondheidszorg', 'Industrials': 'Industrie', 'Communication Services': 'Communicatie en media',
    'Consumer Cyclical': 'Luxe en cyclische consumptie', 'Consumer Defensive': 'Basisconsumptie', 'Financial Services': 'Financiële diensten',
    'Energy': 'Energie', 'Basic Materials': 'Grondstoffen', 'Real Estate': 'Vastgoed', 'Utilities': 'Nutsbedrijven',
  };
  const INDUSTRY_NL = {
    'Aerospace & Defense': 'Lucht- en ruimtevaart en defensie', 'Drug Manufacturers - General': 'Farmacie', 'Drug Manufacturers - Specialty & Generic': 'Farmacie (specialistisch en generiek)',
    'Biotechnology': 'Biotechnologie', 'Medical - Devices': 'Medische apparatuur', 'Semiconductors': 'Halfgeleiders (chips)',
    'Semiconductor Equipment & Materials': 'Chipmachines en -materialen', 'Software - Infrastructure': 'Software (infrastructuur)',
    'Software - Application': 'Software (toepassingen)', 'Software - Services': 'Software (diensten)', 'Internet Content & Information': 'Internet en informatie',
    'Consumer Electronics': 'Consumentenelektronica', 'Specialty Retail': 'Detailhandel (gespecialiseerd)', 'Internet Retail': 'Internetwinkels',
    'Beverages - Non-Alcoholic': 'Frisdranken', 'Beverages - Alcoholic': 'Alcoholische dranken', 'Electronic Gaming & Multimedia': 'Games en multimedia',
    'Information Technology Services': 'IT-dienstverlening', 'Communication Equipment': 'Communicatieapparatuur', 'Computer Hardware': 'Computerhardware',
    'Entertainment': 'Entertainment', 'Banks - Diversified': 'Banken', 'Banks - Regional': 'Regionale banken', 'Auto - Manufacturers': 'Autofabrikanten',
    'Oil & Gas Integrated': 'Olie en gas', 'Packaged Foods': 'Verpakte voeding', 'Household & Personal Products': 'Huishoud- en verzorgingsproducten',
    'Discount Stores': 'Discountwinkels', 'Healthcare Plans': 'Zorgverzekeraars', 'Medical - Diagnostics & Research': 'Diagnostiek en onderzoek',
    'Electronic Components': 'Elektronische componenten', 'Hardware, Equipment & Parts': 'Hardware en onderdelen', 'Advertising Agencies': 'Reclamebureaus',
  };
  const sectorNl = (x) => SECTOR_NL[x] || x || 'Onbekend';
  const industryNl = (x) => INDUSTRY_NL[x] || x || 'Onbekend';
  const FUNDS = 'Fondsen (breed gespreid)';
  const SECTOR_COLORS = ['#1E3A8A', '#2B5BD7', '#5B86E5', '#8FAEF0', '#0E7490', '#4FB3C8', '#6D28D9', '#A78BFA', '#B45309', '#F59E0B', '#475569'];

  function mcap(v, cur) {
    if (!isNum(v)) return '–';
    const u = cur && cur !== 'USD' ? ' ' + cur : ' $';
    if (v >= 1e12) return N1.format(v / 1e12) + ' bln' + u;
    if (v >= 1e9) return NI.format(v / 1e9) + ' mld' + u;
    return NI.format(v / 1e6) + ' mln' + u;
  }

  function deriveMarket(mk, m) {
    const X = { ok: !!(mk && mk.profiles && Object.keys(mk.profiles).length), updated: mk && mk.updated };
    if (!X.ok) return X;
    X.sym = (tk) => (mk.symbols && mk.symbols[tk]) || tk;
    X.prof = (sym) => mk.profiles[sym] || null;
    X.profOf = (tk) => X.prof(X.sym(tk));
    X.peersOf = (tk) => (mk.peers && mk.peers[tk]) || [];
    X.heldBySym = new Map(Object.entries(mk.symbols || {}).map(([tk, sym]) => [sym, tk]));
    X.prices = (sym) => ((mk.prices && mk.prices[sym]) || []).map(([d, v]) => ({ day: d, t: ymd(d), v })).filter((p) => p.t != null && isNum(p.v));
    // Dagveranderingen per sector of branche; per beurs of het gemiddelde van de beurzen
    const perfMap = (kind, name, exch) => {
      const src = ((kind === 'sector' ? mk.sectors : mk.industries) || {})[name];
      if (!src) return new Map();
      const lists = exch && src[exch] ? [src[exch]] : Object.values(src);
      const acc = new Map();
      lists.forEach((l) => l.forEach(([d, v]) => { const o = acc.get(d) || []; o.push(v); acc.set(d, o); }));
      return new Map([...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, a]) => [d, mean(a) / 100]));
    };
    X.perf = perfMap;
    const days = new Set();
    Object.values(mk.sectors || {}).forEach((ex) => Object.values(ex).forEach((l) => l.forEach(([d]) => days.add(d))));
    X.days = [...days].sort();
    X.lastDay = X.days[X.days.length - 1] || null;
    X.sectorNames = Object.keys(mk.sectors || {});
    X.sectorOf = (c) => {
      if (ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk))) return FUNDS;
      const p = X.profOf(c.tk);
      return p && p.sector ? p.sector : 'Onbekend';
    };
    return X;
  }

  // Groei sinds de startdag, voor koersen of voor dagveranderingen van een sector of branche
  function growthFromPrices(pts, startDay) {
    const from = pts.filter((p) => p.day >= startDay);
    if (from.length < 2) return null;
    const p0 = from[0].v;
    return new Map(from.map((p) => [p.day, p.v / p0 - 1]));
  }
  function growthFromPerf(map, startDay) {
    let idx = 1;
    const out = new Map();
    for (const [d, r] of map) {
      if (d < startDay) continue;
      if (out.size) idx *= 1 + r; // de eerste dag is het startpunt
      out.set(d, idx - 1);
    }
    return out.size >= 2 ? out : null;
  }

  function rangeBar(p) {
    const m = /^\s*([\d.]+)\s*-\s*([\d.]+)/.exec(p && p.range || '');
    if (!m || !isNum(p.price)) return { html: '<span class="muted">–</span>', off: null };
    const lo = Number(m[1]), hi = Number(m[2]);
    if (!(hi > lo)) return { html: '<span class="muted">–</span>', off: null };
    const x = Math.max(0, Math.min(1, (p.price - lo) / (hi - lo)));
    return {
      html: '<span class="yr" data-tip="' + esc('52 weken: ' + N2.format(lo) + ' – ' + N2.format(hi) + ' ' + (p.currency || '') + ', nu ' + N2.format(p.price)) + '"><span class="yr-rail"></span><span class="yr-dot" style="left:' + (x * 100).toFixed(1) + '%"></span></span>',
      off: p.price / hi - 1,
    };
  }

  // Sectorvergelijking en vergelijkbare bedrijven voor één bedrijf
  function companyMarket(c) {
    const X = M.mk;
    const isFund = ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk));
    if (isFund) return { tiles: ['<section class="tile pad"><h3>Sector</h3><p class="muted">Dit is een fonds dat over veel bedrijven en sectoren is gespreid; een vergelijking met één sector past daar niet bij.</p></section>'], table: '' };
    if (!X.ok) return { tiles: ['<section class="tile pad"><h3>Sector en vergelijkbare bedrijven</h3><p class="muted">Deze gegevens komen van Financial Modeling Prep en worden elke ochtend opgehaald. Ze zijn er nog niet.</p></section>'], table: '' };
    const sym = X.sym(c.tk);
    const p = X.prof(sym);
    if (!p) return { tiles: ['<section class="tile pad"><h3>Sector en vergelijkbare bedrijven</h3><p class="muted">Nog geen profiel van ' + esc(sym) + ' opgehaald.</p></section>'], table: '' };
    const exch = p.exchange;
    const secMap = X.perf('sector', p.sector, exch), indMap = X.perf('industry', p.industry, exch);
    const lastD = X.lastDay;
    const own = X.prices(sym);
    // Startdag: eerste dag waarop zowel de sectorreeks als (zo mogelijk) een koers bestaat
    const window = X.days.slice(-260);
    const startCandidates = window.filter((d) => own.some((q) => q.day === d));
    const startDay = startCandidates.length >= 2 ? startCandidates[0] : window[0];
    const gOwn = growthFromPrices(own, startDay);
    const gSec = growthFromPerf(secMap, startDay), gInd = growthFromPerf(indMap, startDay);
    const lastOf = (g) => (g ? [...g.values()].pop() : null);
    const nDays = window.filter((d) => d >= startDay).length;

    const peers = X.peersOf(c.tk).map((s2) => X.prof(s2)).filter(Boolean);
    const betas = peers.map((q) => q.beta).filter((b) => isNum(b) && b > 0);
    const dayRows = [
      [c.tk, p.change, C.accent],
      [industryNl(p.industry), indMap.get(lastD) != null ? indMap.get(lastD) * 100 : null, C.ink2],
      [sectorNl(p.sector), secMap.get(lastD) != null ? secMap.get(lastD) * 100 : null, '#9AA3B5'],
    ];
    const mx = Math.max(0.5, ...dayRows.map((r) => (isNum(r[1]) ? Math.abs(r[1]) : 0)));
    const dayBars = '<div class="hbars cmp">' + dayRows.map(([lbl, v]) =>
      '<div class="r"><span class="tk" title="' + esc(lbl) + '">' + esc(lbl) + '</span><span class="track"><span class="mid"></span>' +
      (isNum(v) ? '<span class="' + (v < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(v) / mx * 50).toFixed(1) + '%"></span>' : '') + '</span>' +
      '<span class="' + tone(v) + '" style="text-align:right;font-weight:600">' + esc(isNum(v) ? spct(v / 100) : '–') + '</span></div>').join('') + '</div>';

    const info = '<section class="tile pad"><h3>Sector en branche</h3>' + kvList([
      ['Sector', sectorNl(p.sector)],
      ['Branche', industryNl(p.industry)],
      ['Beurswaarde', mcap(p.marketCap, p.currency)],
      ['Beta (beweeglijkheid t.o.v. de markt)', isNum(p.beta) && p.beta > 0 ? N2.format(p.beta) + (betas.length ? ', branchegenoten gemiddeld ' + N2.format(mean(betas)) : '') : '–'],
      ['Land en beurs', [p.country, p.exchange].filter(Boolean).join(', ') || '–'],
      ['Beursgang', p.ipoDate ? fDM.format(ymd(p.ipoDate)) + ' ' + p.ipoDate.slice(0, 4) : '–'],
    ]) + '<h3 style="margin-top:16px">Laatste handelsdag in de VS</h3>' + dayBars +
      '<p class="sub" style="margin-top:8px">Koersverandering' + (lastD ? ' op ' + esc(fD.format(ymd(lastD))) : '') + ', in dollars. Branche en sector zijn het gemiddelde van alle bedrijven op ' + esc(exch || 'de beurs') + '.</p></section>';

    const chartTile = '<section class="tile pad"><h3>Tegenover branche en sector</h3>' +
      (gSec ? '<div class="chart" data-chart="sector" data-tk="' + esc(c.tk) + '" style="height:170px"></div><div class="xlabels" data-x="sector"></div>' +
        '<div class="legend chart-legend" style="margin-top:8px">' +
          (gOwn ? '<span><i style="background:' + C.accent + '"></i>' + esc(c.tk) + ' ' + esc(spct1(lastOf(gOwn))) + '</span>' : '') +
          (gInd ? '<span><i class="dash"></i>' + esc(industryNl(p.industry)) + ' ' + esc(spct1(lastOf(gInd))) + '</span>' : '') +
          '<span><i style="background:#9AA3B5"></i>' + esc(sectorNl(p.sector)) + ' ' + esc(spct1(lastOf(gSec))) + '</span></div>' +
        '<p class="sub" style="margin-top:8px">' + esc(nDays + ' handelsdagen sinds ' + fD.format(ymd(startDay)) + '.') +
          (gOwn ? '' : ' Voor ' + esc(c.tk) + ' geeft het gratis abonnement geen koershistorie; die bouwt de tracker vanaf nu elke dag op.') + '</p>'
        : '<p class="muted">Nog te weinig handelsdagen opgehaald voor een vergelijking.</p>') + '</section>';

    // Tabel met vergelijkbare bedrijven
    const rows = [p].concat(peers);
    const periodHead = 'Sinds ' + fDM.format(ymd(startDay));
    const rowHtml = (q, i) => {
      const heldTk = X.heldBySym.get(q.symbol);
      const g = lastOf(growthFromPrices(X.prices(q.symbol), startDay));
      const rb = rangeBar(q);
      const tag = i === 0 ? '<span class="tag">Dit bedrijf</span>' : heldTk ? '<span class="tag gain">In bezit</span>' : '';
      const open = i > 0 && heldTk ? ' data-open="' + esc(heldTk) + '" tabindex="0" role="button"' : '';
      return '<tr class="' + (i === 0 ? 'me' : '') + (open ? ' rowlink' : '') + '"' + open + '>' +
        '<td class="co"><b>' + esc(q.symbol) + '</b> ' + tag + '<span class="nm">' + esc(q.name || '') + '</span></td>' +
        '<td class="num ' + tone(q.change) + '">' + esc(isNum(q.change) ? spct(q.change / 100) : '–') + '</td>' +
        '<td class="num ' + tone(g) + '">' + esc(isNum(g) ? spct1(g) : '–') + '</td>' +
        '<td class="yrc">' + rb.html + '<span class="sub">' + esc(isNum(rb.off) ? (rb.off > -0.005 ? 'bij de top' : P1.format(-rb.off) + ' onder top') : '') + '</span></td>' +
        '<td class="num">' + esc(mcap(q.marketCap, q.currency)) + '</td>' +
        '<td class="num">' + esc(isNum(q.beta) && q.beta > 0 ? N2.format(q.beta) : '–') + '</td></tr>';
    };
    const table = peers.length
      ? '<section class="tile pad peers"><h3>Vergelijkbare bedrijven</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bedrijf</th><th class="num">Laatste dag</th><th class="num">' + esc(periodHead) + '</th><th>Jaarbereik</th><th class="num">Beurswaarde</th><th class="num">Beta</th></tr></thead><tbody>' +
        rows.map(rowHtml).join('') + '</tbody></table></div>' +
        '<p class="sub" style="margin-top:8px">Bedrijven die FMP als vergelijkbaar aanmerkt (zelfde branche, vergelijkbare omvang). Jaarbereik: laagste tot hoogste koers van de afgelopen 52 weken, met de stip op de koers nu. “–” bij de periode betekent dat er nog geen koershistorie is.</p></section>'
      : '';
    return { tiles: [info, chartTile], table, startDay, gOwn, gSec, gInd };
  }

  function drawSectorChart(root) {
    const host = root.querySelector('[data-chart="sector"]');
    if (!host) return;
    const c = M.byTk.get(host.dataset.tk) || (watchSyms().includes(host.dataset.tk) ? watchPseudo(host.dataset.tk) : null);
    const R = c && companyMarket(c);
    if (!R || !R.gSec) return;
    const days = [...R.gSec.keys()];
    const toPts = (g) => days.map((d) => ({ t: ymd(d), v: g && g.has(d) ? g.get(d) : null }));
    const sets = [];
    if (R.gOwn) sets.push({ pts: toPts(R.gOwn), color: C.accent, width: 3, label: c.tk, fmt: spct1 });
    if (R.gInd) sets.push({ pts: toPts(R.gInd), color: C.ink2, dash: true, width: 2, label: 'Branche', fmt: spct1 });
    sets.push({ pts: toPts(R.gSec), color: '#9AA3B5', width: 2, label: 'Sector', fmt: spct1 });
    lineChart(host, sets, { zero: true, top: 0.08, bottom: 0.08, xl: root.querySelector('[data-x="sector"]'), xcount: 3, xfmt: (t) => fDM.format(t), tfmt: (t) => fD.format(t) });
  }

  // Portefeuille per sector
  function sectorTiles() {
    const X = M.mk;
    if (!X.ok) return ['<p class="empty">Sectorgegevens komen van Financial Modeling Prep en worden elke ochtend opgehaald. Ze zijn er nog niet.</p>'];
    const groups = new Map();
    M.companies.forEach((c) => { const s = X.sectorOf(c); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(c); });
    const list = [...groups.entries()].map(([s, cs]) => ({ s, cs, v: sum(cs.map((c) => c.value)) })).sort((a, b) => b.v - a.v);
    const pctOf = (v) => (M.totalValue ? P1.format(v / M.totalValue) : '–');
    const colorOf = (s, i) => (s === FUNDS ? '#C9CED6' : SECTOR_COLORS[i % SECTOR_COLORS.length]);
    const slices = list.map((g, i) => ({ label: g.s === FUNDS ? FUNDS : sectorNl(g.s), v: g.v, color: colorOf(g.s, i) }));
    const stocksOnly = list.filter((g) => g.s !== FUNDS && g.s !== 'Onbekend');
    const legend = '<div class="legend-list">' + list.map((g, i) =>
      '<div class="legend-row"><i style="background:' + colorOf(g.s, i) + '"></i><span class="nm">' + esc(g.s === FUNDS ? FUNDS : sectorNl(g.s)) +
      ' <span class="muted small">' + esc(g.cs.map((c) => c.tk).join(', ')) + '</span></span><b style="min-width:52px;text-align:right">' + esc(pctOf(g.v)) + '</b></div>').join('') + '</div>';
    const pie = '<section class="tile pad"><h3>Verdeling per sector</h3>' + donut(slices, String(stocksOnly.length), stocksOnly.length === 1 ? 'sector' : 'sectoren', 'Verdeling van je beleggingen over sectoren') + legend + '</section>';

    // Laatste handelsdag: jouw aandelen per sector tegenover het sectorgemiddelde
    const lastD = X.lastDay;
    const cmp = stocksOnly.map((g) => {
      const w = g.cs.filter((c) => { const p = X.profOf(c.tk); return p && isNum(p.change); });
      const tv = sum(w.map((c) => c.value));
      const mine = tv ? sum(w.map((c) => c.value * X.profOf(c.tk).change)) / tv / 100 : null;
      const sec = X.perf('sector', g.s).get(lastD);
      return { g, mine, sec: isNum(sec) ? sec : null };
    });
    const mx = Math.max(0.005, ...cmp.flatMap((x) => [x.mine, x.sec]).filter(isNum).map(Math.abs));
    const bar = (v, cls) => '<span class="track"><span class="mid"></span>' + (isNum(v) ? '<span class="' + (v < 0 ? 'neg' : 'pos') + ' ' + cls + '" style="width:' + (Math.abs(v) / mx * 50).toFixed(1) + '%"></span>' : '') + '</span>';
    const cmpTile = '<section class="tile pad"><h3>Jij tegenover de sector</h3>' +
      (cmp.length ? '<div class="sec-cmp">' + cmp.map((x) =>
        '<div class="sc"><div class="sc-h"><b>' + esc(sectorNl(x.g.s)) + '</b><span class="muted small">' + esc(x.g.cs.map((c) => c.tk).join(', ')) + '</span></div>' +
        '<div class="hbars cmp"><div class="r"><span class="tk">Jij</span>' + bar(x.mine, '') + '<span class="' + tone(x.mine) + '" style="text-align:right;font-weight:600">' + esc(spct(x.mine)) + '</span></div>' +
        '<div class="r"><span class="tk muted">Sector</span>' + bar(x.sec, 'soft') + '<span class="' + tone(x.sec) + '" style="text-align:right">' + esc(spct(x.sec)) + '</span></div></div></div>').join('') + '</div>' +
        '<p class="sub" style="margin-top:8px">Laatste handelsdag in de VS' + (lastD ? ' (' + esc(fD.format(ymd(lastD))) + ')' : '') + ', in dollars. “Jij” is het gewogen gemiddelde van je aandelen in die sector.</p>'
        : '<p class="muted">Geen losse aandelen met sectorgegevens.</p>') + '</section>';

    // Alle sectoren in de markt over de opgehaalde periode
    const startDay = X.days[0];
    const perf = X.sectorNames.map((s) => { const g = growthFromPerf(X.perf('sector', s), startDay); return { s, v: g ? [...g.values()].pop() : null }; })
      .filter((x) => isNum(x.v)).sort((a, b) => b.v - a.v);
    const mine = new Set(stocksOnly.map((g) => g.s));
    const mx2 = Math.max(0.005, ...perf.map((x) => Math.abs(x.v)));
    const mktTile = '<section class="tile pad"><h3>Sectoren in de markt</h3>' +
      (perf.length ? '<div class="hbars cmp wide">' + perf.map((x) =>
        '<div class="r' + (mine.has(x.s) ? ' mine' : '') + '"><span class="tk" title="' + esc(sectorNl(x.s)) + '">' + esc(sectorNl(x.s)) + '</span><span class="track"><span class="mid"></span><span class="' + (x.v < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(x.v) / mx2 * 50).toFixed(1) + '%"></span></span>' +
        '<span class="' + tone(x.v) + '" style="text-align:right;font-weight:600">' + esc(spct1(x.v)) + '</span></div>').join('') + '</div>' +
        '<p class="sub" style="margin-top:8px">Gemiddelde koersverandering per sector over ' + esc(days(X.days.length).replace('dag', 'handelsdag')) + ' sinds ' + esc(fD.format(ymd(startDay))) + '. Vetgedrukt: sectoren waarin je aandelen hebt.</p>'
        : '<p class="muted">Nog geen handelsdagen opgehaald.</p>') + '</section>';
    return [pie, cmpTile, mktTile];
  }


  // ---------- Plannen: streefverdeling, vooruitblik, peildatum, werkelijke spreiding, export ----------
  const LS_DEMO_SET = 'tracker.demoSettings';
  const demoSettings = () => {
    let o = {}; try { o = JSON.parse(localStorage.getItem(LS_DEMO_SET) || '{}'); } catch (e) { o = {}; }
    if (!o.watchlist) o.watchlist = ['NVDA', 'LMT'];
    if (!o.notes) o.notes = (data && data.demoNotes) || {};
    if (!o.accounts) o.accounts = (data && data.demoAccounts) || [];
    return o;
  };
  const plan = { mode: null, draft: null, amount: 100, years: 10, monthly: null, goal: null, status: '', year: null };

  async function saveSettings(patch) {
    const next = Object.assign({}, M.settings, patch);
    if (demo) { localStorage.setItem(LS_DEMO_SET, JSON.stringify(next)); M.settings = next; return next; }
    if (!isWorker()) throw new Error('opslaan kan alleen met de Cloudflare Worker');
    const res = await fetch(getUrl().replace(/\/api\/data$/, '/api/settings'), {
      method: 'POST', headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'de Worker gaf status ' + res.status);
    data.settings = j.settings; M.settings = Object.assign({}, j.settings);
    return j.settings;
  }

  function allocItems(mode) {
    const total = M.totalValue || 0;
    if (mode === 'sector') {
      const g = new Map();
      M.companies.forEach((c) => {
        const sct = M.mk.ok ? M.mk.sectorOf(c) : 'Onbekend';
        const key = sct === FUNDS ? '@funds' : sct === 'Onbekend' ? '@unknown' : sct;
        const o = g.get(key) || { key, label: key === '@funds' ? FUNDS : key === '@unknown' ? 'Onbekend' : sectorNl(key), sub: [], v: 0 };
        o.v += c.value; o.sub.push(c.tk); g.set(key, o);
      });
      return [...g.values()].map((o) => Object.assign(o, { sub: o.sub.join(', '), w: total ? o.v / total : 0 })).sort((a, b) => b.v - a.v);
    }
    return M.companies.slice().sort((a, b) => b.value - a.value).map((c) => ({ key: c.tk, label: c.tk, sub: c.name, v: c.value, w: total ? c.value / total : 0 }));
  }

  function planTargets() {
    const mode = plan.mode || M.settings.targetMode || 'position';
    plan.mode = mode;
    if (!plan.draft || plan.draft.mode !== mode) {
      const saved = (M.settings.targetMode || 'position') === mode ? (M.settings.targets || {}) : {};
      plan.draft = { mode, t: Object.assign({}, saved) };
    }
    return plan.draft.t;
  }

  function adviseInleg(items, t, amount) {
    const total = sum(items.map((x) => x.v)), newTotal = total + amount;
    const withT = items.filter((x) => isNum(t[x.key]) && t[x.key] > 0);
    if (!withT.length || !(amount > 0)) return [];
    const need = withT.map((x) => Math.max(0, (t[x.key] / 100) * newTotal - x.v));
    const needSum = sum(need);
    const tSum = sum(withT.map((x) => t[x.key]));
    const alloc = withT.map((x, i) => (needSum > 0 ? need[i] * Math.min(1, amount / needSum) : 0));
    const left = amount - sum(alloc);
    if (left > 0.005) withT.forEach((x, i) => { alloc[i] += left * t[x.key] / tSum; });
    return withT.map((x, i) => ({ x, a: alloc[i] })).filter((o) => o.a >= 0.5).sort((a, b) => b.a - a.a);
  }

  function targetTile() {
    const items = allocItems(planTargets());
    const t = plan.draft.t;
    const tSum = sum(Object.values(t).filter(isNum));
    const total = M.totalValue || 0;
    const row = (x) => {
      const tv = t[x.key];
      const diff = isNum(tv) ? x.w * 100 - tv : null;
      const eurDiff = isNum(tv) ? (tv / 100) * total - x.v : null;
      return '<tr data-key="' + esc(x.key) + '"><td class="co"><b>' + esc(x.label) + '</b><span class="nm">' + esc(x.sub) + '</span></td>' +
        '<td class="num">' + esc(P1.format(x.w)) + '<span class="bar-mini"><i style="width:' + Math.min(100, x.w * 100 * 2).toFixed(1) + '%"></i></span></td>' +
        '<td class="num"><input class="t-in" type="number" inputmode="decimal" min="0" max="100" step="0.5" value="' + (isNum(tv) ? tv : '') + '" placeholder="–" aria-label="' + esc('Doel voor ' + x.label + ' in procent') + '"></td>' +
        '<td class="num t-diff ' + (isNum(diff) && Math.abs(diff) >= 0.5 ? (diff > 0 ? 'loss' : 'gain') : '') + '">' + esc(isNum(diff) ? (Math.abs(diff) < 0.05 ? 'op doel' : sgn(diff, N1) + ' pp') : '') +
          '<span class="sub">' + esc(isNum(eurDiff) && Math.abs(eurDiff) >= 1 ? (eurDiff > 0 ? eur(eurDiff) + ' bijkopen' : eur(-eurDiff) + ' te veel') : '') + '</span></td></tr>';
    };
    const advice = adviseInleg(items, t, plan.amount);
    return '<section class="tile pad plan-target"><div class="plan-head"><h3>Streefverdeling</h3>' +
      '<div class="seg light" role="group" aria-label="Streefverdeling per positie of per sector" data-plan="mode">' +
        '<button type="button" data-k="position" aria-pressed="' + (plan.mode === 'position') + '">Per positie</button>' +
        '<button type="button" data-k="sector" aria-pressed="' + (plan.mode === 'sector') + '">Per sector</button></div></div>' +
      '<p class="sub">Vul in hoeveel procent van je beleggingen (zonder vrij saldo) je in elke ' + (plan.mode === 'sector' ? 'sector' : 'positie') + ' wilt hebben. Leeg betekent: geen doel.</p>' +
      '<div class="tbl-wrap"><table class="tbl plan-tbl"><thead><tr><th>' + (plan.mode === 'sector' ? 'Sector' : 'Positie') + '</th><th class="num">Nu</th><th class="num">Doel %</th><th class="num">Verschil</th></tr></thead><tbody>' +
        items.map(row).join('') + '</tbody></table></div>' +
      '<div class="plan-foot"><span class="t-sum ' + (Math.abs(tSum - 100) < 0.05 || !tSum ? '' : 'loss') + '">Doelen samen: ' + esc(N1.format(tSum)) + '%' + (tSum && Math.abs(tSum - 100) >= 0.05 ? ' (hoort 100% te zijn)' : '') + '</span>' +
        '<span class="plan-actions"><button type="button" class="btn ghost" data-plan="even">Gelijk verdelen</button><button type="button" class="btn ghost" data-plan="now">Huidige verdeling als doel</button>' +
        '<button type="button" class="btn primary" data-plan="save">Doelen opslaan</button></span></div>' +
      '<p class="small plan-status" role="status">' + esc(plan.status) + '</p>' +
      '<p class="sub" style="margin-top:8px">Hoe je nieuwe inleg het best verdeelt, zie je bij de inleg-assistent hieronder.</p></section>';
  }

  function monthlyGuess() {
    const W = M.weeks.filter((w) => isNum(w.netDeposits));
    if (W.length < 2) return 0;
    const last = W[W.length - 1];
    const from = W.filter((w) => w.t <= last.t - 85 * DAY).pop() || W[0];
    const months = (last.t - from.t) / (30.44 * DAY);
    return months >= 0.9 ? Math.max(0, Math.round((last.netDeposits - from.netDeposits) / months / 5) * 5) : 0;
  }

  const SCEN = [['Voorzichtig', 0.04, '#9AA3B5'], ['Gemiddeld', 0.07, '#2B5BD7'], ['Gunstig', 0.10, '#0B7A4B']];

  function projection() {
    const start = M.accountNow || 0;
    const monthly = isNum(plan.monthly) ? plan.monthly : isNum(M.settings.monthly) ? M.settings.monthly : monthlyGuess();
    const goal = isNum(plan.goal) ? plan.goal : isNum(M.settings.goal) ? M.settings.goal : null;
    const years = plan.years;
    const n = years * 12;
    const now = new Date(); now.setDate(1); now.setHours(0, 0, 0, 0);
    const tAt = (k) => new Date(now.getFullYear(), now.getMonth() + k, 1).getTime();
    const sets = SCEN.map(([label, r, color]) => {
      const rm = Math.pow(1 + r, 1 / 12) - 1;
      let v = start, reached = null;
      const pts = [{ t: tAt(0), v }];
      for (let k = 1; k <= n; k++) { v = v * (1 + rm) + monthly; pts.push({ t: tAt(k), v }); if (goal && reached == null && v >= goal) reached = tAt(k); }
      // Doel ook na de horizon zoeken (max. 60 jaar)
      if (goal && reached == null) { let w = v; for (let k = n + 1; k <= 720; k++) { w = w * (1 + rm) + monthly; if (w >= goal) { reached = tAt(k); break; } } }
      return { label, r, color, pts, end: v, reached };
    });
    const dep = []; for (let k = 0; k <= n; k++) dep.push({ t: tAt(k), v: start + monthly * k });
    return { start, monthly, goal, years, sets, dep };
  }

  function forecastTile() {
    const P = projection();
    const fY = (t) => new Date(t).getFullYear();
    return '<section class="tile pad plan-fc"><div class="plan-head"><h3>Vooruitblik</h3>' +
      '<div class="seg light" role="group" aria-label="Aantal jaren" data-plan="years">' + [5, 10, 20, 30].map((y) =>
        '<button type="button" data-k="' + y + '" aria-pressed="' + (P.years === y) + '">' + y + ' jaar</button>').join('') + '</div></div>' +
      '<div class="plan-inputs"><label>Inleg per maand<span class="eur-in">€<input id="plan-monthly" type="number" inputmode="decimal" min="0" step="10" value="' + esc(Math.round(P.monthly)) + '"></span></label>' +
        '<label>Doelbedrag (optioneel)<span class="eur-in">€<input id="plan-goal" type="number" inputmode="decimal" min="0" step="500" value="' + (P.goal ? esc(Math.round(P.goal)) : '') + '" placeholder="geen"></span></label>' +
        '<button type="button" class="btn ghost" data-plan="save-fc">Bewaren</button></div>' +
      '<div class="chart" data-chart="forecast" style="height:220px"></div><div class="xlabels" data-x="forecast"></div>' +
      '<div class="fc-res">' + P.sets.slice().reverse().map((x) =>
        '<div><span class="k"><i style="background:' + x.color + '"></i>' + esc(x.label) + ' (' + esc(P1.format(x.r)) + ' per jaar)</span><b>' + esc(eur(x.end)) + '</b>' +
        (P.goal ? '<span class="sub">' + esc(x.reached ? 'doel in ' + fY(x.reached) : 'doel niet binnen 60 jaar') + '</span>' : '') + '</div>').join('') +
        '<div><span class="k"><i class="dash"></i>Alleen inleg</span><b>' + esc(eur(P.dep[P.dep.length - 1].v)) + '</b></div></div>' +
      '<p class="sub" style="margin-top:10px">Start: je accountwaarde nu (' + esc(eur(P.start)) + '). ' + (isNum(M.settings.monthly) || isNum(plan.monthly) ? '' : 'De maandinleg is geschat uit je stortingen van de laatste drie maanden. ') +
        'De drie rendementen zijn voorbeelden, geen verwachting: werkelijke rendementen schommelen sterk per jaar en kunnen ook negatief zijn. Kosten, belasting en inflatie zijn niet meegenomen.</p></section>';
  }

  function drawForecast(root) {
    const host = root.querySelector('[data-chart="forecast"]');
    if (!host) return;
    const P = projection();
    const sets = P.sets.slice().reverse().map((x) => ({ pts: x.pts, color: x.color, width: x.label === 'Gemiddeld' ? 3 : 2, label: x.label }));
    sets.push({ pts: P.dep, color: C.ink2, dash: true, width: 2, label: 'Alleen inleg' });
    // Doellijn alleen als hij in beeld past; anders drukt hij de rest plat
    const top = Math.max(...P.sets.map((x) => x.end));
    if (P.goal && P.goal <= top * 1.25) sets.push({ pts: P.dep.map((p) => ({ t: p.t, v: P.goal })), color: '#B45309', dash: true, width: 1.5, label: 'Doel' });
    lineChart(host, sets, { top: 0.06, bottom: 0.04, xl: root.querySelector('[data-x="forecast"]'), xcount: 4, xfmt: (t) => String(new Date(t).getFullYear()), tfmt: (t) => fMonY.format(t) });
  }

  function peilTile() {
    const list = (data.peil || []).slice().reverse();
    const nextYear = new Date().getFullYear() + 1;
    const rows = list.map((p) => '<div class="peil"><div class="peil-h"><b>1 januari ' + esc(p.date.slice(0, 4)) + '</b><span class="v big">' + esc(eur(p.total)) + '</span></div>' +
      kvList([['Beleggingen', eur(p.investments)], ['Vrij saldo', eur(p.cash)], ['Posities', String((p.positions || []).length)]]) + '</div>').join('');
    return '<section class="tile pad"><h3>Stand op 1 januari</h3>' +
      (rows || '<p class="muted">Nog geen peildatum vastgelegd. Op 1 januari ' + nextYear + ' legt de Worker automatisch de stand vast van je beleggingen en je vrije saldo.</p>') +
      '<div style="margin-top:12px">' + kvList([['Ter vergelijking: nu', eur(M.accountNow)]]) + '</div>' +
      '<p class="sub" style="margin-top:8px">Dit is de stand voor je eigen overzicht (box 3 gebruikt de waarde op 1 januari). Gebruik voor de aangifte het jaaroverzicht van Trading 212; deze site berekent geen belasting.</p></section>';
  }

  // Werkelijke spreiding: posities plus wat er via indexfondsen in zit
  function lookThrough() {
    const etf = data.etf || {};
    const keyFor = (c) => { const b = BENCHES.find((x) => x[1].test(c.tk) || x[2].test(c.name)); return b ? (b[0] === 'S&P 500' ? 'SP500' : b[0] === 'Nasdaq 100' ? 'NDX' : null) : null; };
    const norm = (tk) => ({ FB: 'META', GOOG: 'GOOGL', 'BRK.B': 'BRK', 'BRKB': 'BRK' }[tk] || tk);
    const ex = new Map();
    const add = (tk, name, direct, via) => { const k = norm(tk); const o = ex.get(k) || { tk: k, name, direct: 0, via: 0 }; o.direct += direct; o.via += via; if (!o.name || direct) o.name = name || o.name; ex.set(k, o); };
    let covered = 0, funds = 0;
    const used = new Set();
    M.companies.forEach((c) => {
      const k = keyFor(c);
      if (k) funds += c.value;
      if (k && etf[k]) {
        covered += c.value; used.add(k);
        etf[k].rows.forEach(([tk, nm, , w]) => add(tk, nm, 0, c.value * w / 100));
      } else if (!k) add(c.tk, c.name, c.value, 0);
    });
    const list = [...ex.values()].map((o) => Object.assign(o, { total: o.direct + o.via })).sort((a, b) => b.total - a.total);
    const overlapVia = sum(list.filter((o) => o.direct > 0).map((o) => o.via));
    const needed = [...new Set(M.companies.map(keyFor).filter(Boolean))];
    return { list, covered, funds, used: [...used].map((k) => etf[k]), overlap: covered ? overlapVia / covered : null, needed };
  }

  const ETF_PAGES = {
    SP500: ['S&P 500', 'iShares Core S&P 500 (CSPX)', 'https://www.ishares.com/uk/individual/en/products/253743/ishares-core-sp-500-ucits-etf-acc-fund'],
    NDX: ['Nasdaq-100', 'iShares Nasdaq 100 (CNDX)', 'https://www.ishares.com/uk/individual/en/products/253741/ishares-nasdaq-100-ucits-etf'],
  };
  function etfUpload(L, open) {
    const etf = data.etf || {};
    return '<details class="etf-up"' + (open ? ' open' : '') + '><summary>' + (open ? 'Samenstelling toevoegen' : 'Samenstelling bijwerken') + '</summary>' +
      '<p class="sub">Open de pagina van het fonds bij iShares, ga naar <b>Holdings</b> en kies <b>Download latest fund holdings CSV data</b>. Kies dat bestand hier. ' +
      'Je eigen fonds hoeft niet van iShares te zijn: een fonds op dezelfde index heeft vrijwel dezelfde samenstelling.</p>' +
      '<div class="etf-btns">' + L.needed.map((k) => { const [label, fund, url] = ETF_PAGES[k]; const have = etf[k];
        return '<div class="etf-b"><b>' + esc(label) + '</b><span class="muted small">' + esc(have ? have.count + ' bedrijven, stand ' + (have.asOf || '?') : 'nog niet toegevoegd') + '</span>' +
          '<span class="etf-acts"><a class="btn ghost" href="' + esc(url) + '#holdings" target="_blank" rel="noopener">' + esc(fund) + ' ↗</a>' +
          '<label class="btn primary">Bestand kiezen<input type="file" accept=".csv,text/csv" data-etf="' + k + '" hidden></label></span></div>'; }).join('') + '</div>' +
      '<p class="small plan-status" id="etf-status" role="status"></p></details>';
  }

  function exposureTile() {
    const L = lookThrough();
    const total = M.totalValue || 0;
    if (!L.funds) return '<section class="tile pad"><h3>Werkelijke spreiding</h3><p class="muted">Je hebt geen indexfondsen, dus je spreiding is gelijk aan je posities.</p></section>';
    if (!L.covered) return '<section class="tile pad exposure"><h3>Werkelijke spreiding</h3><p class="muted">Hiervoor is de samenstelling van je indexfondsen nodig. iShares geeft het bestand niet automatisch aan de Worker, maar je kunt het zelf downloaden en hier toevoegen (een paar keer per jaar is genoeg).</p>' + etfUpload(L, true) + '</section>';
    const top = L.list.slice(0, 15);
    const top10 = sum(L.list.slice(0, 10).map((o) => o.total));
    const mx = Math.max(...top.map((o) => o.total));
    return '<section class="tile pad exposure"><h3>Werkelijke spreiding</h3>' +
      '<p class="sub">Je losse aandelen plus wat er via je indexfondsen in zit, als deel van al je beleggingen.</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bedrijf</th><th class="num">Los</th><th class="num">Via fondsen</th><th class="num">Totaal</th><th></th></tr></thead><tbody>' +
      top.map((o) => '<tr' + (M.byTk.has(o.tk) || (o.tk === 'META' && M.byTk.has('FB')) ? ' class="rowlink" data-ticker="' + esc(M.byTk.has(o.tk) ? o.tk : 'FB') + '"' : '') + '><td class="co"><b>' + esc(o.tk) + '</b><span class="nm">' + esc(o.name) + '</span></td>' +
        '<td class="num">' + esc(o.direct ? eur(o.direct) : '–') + '</td><td class="num">' + esc(o.via >= 0.005 ? eur(o.via) : '–') + '</td>' +
        '<td class="num">' + esc(P1.format(total ? o.total / total : 0)) + '</td>' +
        '<td class="barc"><span class="bar-mini wide"><i style="width:' + (o.direct / mx * 100).toFixed(1) + '%"></i><i class="via" style="width:' + (o.via / mx * 100).toFixed(1) + '%"></i></span></td></tr>').join('') +
      '</tbody></table></div>' +
      '<div style="margin-top:12px">' + kvList([
        ['Grootste 10 bedrijven samen', P1.format(total ? top10 / total : 0)],
        ['Fondsgeld in bedrijven die je ook los hebt', isNum(L.overlap) ? P1.format(L.overlap) : '–'],
        ['Aantal bedrijven via fondsen', NI.format(L.list.filter((o) => o.via > 0).length) + (L.used.some((x) => x.count > x.rows.length) ? '+ (grootste ' + L.used.map((x) => x.rows.length).join(' en ') + ' per fonds)' : '')],
      ]) + '</div>' +
      '<p class="sub" style="margin-top:8px">Samenstelling volgens ' + esc(L.used.map((x) => x.fund + (x.asOf ? ', ' + x.asOf : '')).join(' en ')) +
        '. Je eigen fonds kan iets afwijken, maar volgt dezelfde index. Alphabet A en C zijn samengeteld.</p>' + etfUpload(L, false) + '</section>';
  }

  // Exporteren naar CSV (komma's, puntkomma-vrij; Excel en Google Sheets lezen dit direct)
  function csvOf(head, rows) {
    const cell = (v) => { const x = v == null ? '' : String(v); return /[",\n;]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    return '﻿' + [head].concat(rows).map((r) => r.map(cell).join(',')).join('\r\n');
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const EXPORTS = {
    posities: () => csvOf(['ticker', 'naam', 'waarde_eur', 'inleg_eur', 'ongerealiseerd_eur', 'aantal', 'valuta', 'gem_aankoopprijs', 'valuta_effect_eur', 'aandeel_pct'],
      M.companies.map((c) => [c.tk, c.name, c.value, c.cost, c.unreal, c.qty, c.cur || '', c.avgNative, c.fx, c.weight != null ? (c.weight * 100).toFixed(2) : ''])),
    weken: () => csvOf(['datum', 'accountwaarde', 'netto_gestort', 'vrij_saldo', 'kostprijs', 'totaal_resultaat', 'weekresultaat'],
      M.weeks.map((w) => [new Date(w.t).toISOString().slice(0, 10), w.accountValue, w.netDeposits, w.cash, w.costBasis, w.totalResult, w.weekResult])),
    transacties: () => csvOf(['tijd', 'ticker', 'naam', 'soort', 'aantal', 'prijs', 'valuta', 'wisselkoers', 'bedrag_eur', 'gerealiseerd_eur', 'wisselkosten_eur', 'overige_kosten_eur'],
      M.tx.list.map((x) => [new Date(x.t).toISOString(), x.tk, x.name, x.side === 'SELL' ? 'verkoop' : 'koop', x.qty, x.price, x.cur, x.fxRate, x.net, x.realised, x.feeFx, x.feeOther])),
    dividenden: () => csvOf(['datum', 'ticker', 'bedrag_eur', 'per_aandeel', 'aantal'], M.ev.received.map((d) => [d.date, d.ticker, d.amount, d.perShare, d.qty])),
  };

  function exportTile() {
    const n = { posities: M.companies.length, weken: M.weeks.length, transacties: M.tx.list.length, dividenden: M.ev.received.length };
    const names = { posities: 'Posities', weken: 'Weken', transacties: 'Transacties', dividenden: 'Ontvangen dividend' };
    return '<section class="tile pad"><h3>Exporteren</h3><p class="sub">CSV-bestanden voor Excel of Google Sheets.</p><div class="exp">' +
      Object.keys(EXPORTS).map((k) => '<button type="button" class="btn ghost" data-export="' + k + '"' + (n[k] ? '' : ' disabled') + '>' + esc(names[k]) + ' <span class="muted small">(' + n[k] + ')</span></button>').join('') + '</div></section>';
  }

  function renderPlan() {
    const host = mode === 'm' ? $('m-plan-body') : $('plan-body');
    if (!host) return;
    const focus = document.activeElement && host.contains(document.activeElement) ? document.activeElement.id || null : null;
    const sec = (title, sub, tiles) => '<div class="section-head"><h2>' + esc(title) + '</h2>' + (sub ? '<p class="muted small">' + esc(sub) + '</p>' : '') + '</div><div class="plan-grid">' + tiles.filter(Boolean).join('') + '</div>';
    host.innerHTML =
      sec('Inleg en doelen', 'Streefverdeling, wat je met nieuwe inleg koopt en waar je naartoe groeit', [targetTile(), inlegTile(), forecastTile(), milestoneTile()]) +
      sec('Wat als', 'Je portefeuille bij tegenvallers en tegenover de index', [scenarioTile(), whatIfTile()]) +
      sec('Dividend en belasting', 'Verwacht dividend, box 3 en het jaaroverzicht', [divCalendarTile(), box3Tile(), yearTile()]) +
      sec('Kosten en aankopen', 'Wisselkosten en je aankoopdagboek', [costTile(), journalTile()]) +
      sec('Spreiding en rekeningen', 'Overlap met je fondsen en je andere rekeningen', [overlapTile(), exposureTile(), accountsTile()]) +
      sec('Delen en exporteren', '', [weekShareTile(), exportTile()]);
    drawForecast(host);
    drawWhatIf(host);
    drawWeekShare(host);
    if (focus && $(focus)) { const el = $(focus); el.focus(); const v = el.value; el.value = ''; el.value = v; }
  }

  function planEvents(host) {
    host.addEventListener('click', async (e) => {
      const seg = e.target.closest('[data-plan="mode"] button[data-k], [data-plan="years"] button[data-k], [data-plan="year"] button[data-k]');
      if (seg) {
        const g = seg.parentElement.dataset.plan;
        if (g === 'mode') { plan.mode = seg.dataset.k; plan.draft = null; } else if (g === 'year') plan.year = Number(seg.dataset.k); else plan.years = Number(seg.dataset.k);
        plan.status = ''; renderPlan(); return;
      }
      const exp = e.target.closest('[data-export]');
      if (exp) { const k = exp.dataset.export; download('investeringstracker-' + k + '-' + new Date().toISOString().slice(0, 10) + '.csv', EXPORTS[k]()); return; }
      const tr = e.target.closest('tr[data-ticker]');
      if (tr) return; // document-handler opent het bedrijf
      const act = e.target.closest('[data-plan]');
      if (!act) return;
      if (act.dataset.plan === 'print-year') { printYear(); return; }
      const items = allocItems(plan.mode);
      const t = plan.draft.t;
      if (act.dataset.plan === 'even') { items.forEach((x) => { t[x.key] = Math.round(1000 / items.length) / 10; }); renderPlan(); }
      else if (act.dataset.plan === 'now') { items.forEach((x) => { t[x.key] = Math.round(x.w * 1000) / 10; }); renderPlan(); }
      else if (act.dataset.plan === 'save' || act.dataset.plan === 'save-fc') {
        const patch = act.dataset.plan === 'save' ? { targets: t, targetMode: plan.mode }
          : { monthly: isNum(plan.monthly) ? plan.monthly : projection().monthly, goal: isNum(plan.goal) ? plan.goal : (M.settings.goal || 0) };
        plan.status = 'Bezig met opslaan…'; renderPlan();
        try { await saveSettings(patch); plan.status = act.dataset.plan === 'save' ? 'Doelen opgeslagen' + (demo ? ' (in deze browser).' : '; ze gelden ook op je andere apparaten.') : 'Inleg en doel opgeslagen.'; }
        catch (err) { plan.status = 'Opslaan is mislukt: ' + err.message + '.'; }
        renderPlan();
      }
    });
    host.addEventListener('change', async (e) => {
      const el = e.target;
      if (!el.matches('input[type="file"][data-etf]') || !el.files[0]) return;
      const st = $('etf-status');
      const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'small plan-status ' + (cls || ''); } };
      if (demo) { say('In de voorbeeldweergave is dit niet nodig.'); return; }
      if (!isWorker()) { say('Dit kan alleen met de Cloudflare Worker.', 'loss'); return; }
      try {
        say('Bezig met inlezen…');
        const csv = await el.files[0].text();
        const res = await fetch(getUrl().replace(/\/api\/data$/, '/api/etf-upload'), {
          method: 'POST', headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ key: el.dataset.etf, csv }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'de Worker gaf status ' + res.status);
        say(j.message + ' De gegevens worden opnieuw geladen.', 'gain');
        load();
      } catch (err) { say('Inlezen is mislukt: ' + err.message, 'loss'); }
    });
    host.addEventListener('input', (e) => {
      const el = e.target;
      if (el.classList.contains('t-in')) {
        const key = el.closest('tr').dataset.key;
        const v = el.value === '' ? null : Math.max(0, Math.min(100, Number(el.value)));
        if (v == null || !isNum(v)) delete plan.draft.t[key]; else plan.draft.t[key] = v;
        clearTimeout(planEvents.tm); planEvents.tm = setTimeout(renderPlan, 600);
      } else if (el.id === 'plan-amount') { plan.amount = Math.max(0, Number(el.value) || 0); clearTimeout(planEvents.tm); planEvents.tm = setTimeout(renderPlan, 500); }
      else if (el.id === 'plan-monthly') { plan.monthly = Math.max(0, Number(el.value) || 0); clearTimeout(planEvents.tm); planEvents.tm = setTimeout(renderPlan, 500); }
      else if (el.id === 'plan-goal') { plan.goal = el.value === '' ? 0 : Math.max(0, Number(el.value) || 0); clearTimeout(planEvents.tm); planEvents.tm = setTimeout(renderPlan, 600); }
    });
  }


  // ---------- Onderzoek per bedrijf: nieuws, analisten, insiders, bedrijfscijfers ----------
  const FEAT = () => (data && data.features) || { flags: {}, has: {} };
  const offTile = (title, text) => '<section class="tile pad"><h3>' + esc(title) + '</h3><p class="muted">' + esc(text) + '</p>' +
    (demo ? '' : '<button type="button" class="linklike small" data-act="links">Koppelingen openen</button>') + '</section>';
  const INSIDER_CODES = { P: 'Koop', S: 'Verkoop', M: 'Opties omgezet', A: 'Toegekend', F: 'Ingehouden (belasting)', G: 'Geschonken', D: 'Teruggegeven', C: 'Omgezet', X: 'Opties omgezet' };
  const bigNum = (v, unit) => {
    if (!isNum(v)) return '–';
    const cur = unit && unit !== 'USD' ? ' ' + unit : ' $';
    const a = Math.abs(v), sg = v < 0 ? '−' : '';
    if (a >= 1e12) return sg + N1.format(a / 1e12) + ' bln' + cur;
    if (a >= 1e9) return sg + N1.format(a / 1e9) + ' mld' + cur;
    if (a >= 1e6) return sg + NI.format(a / 1e6) + ' mln' + cur;
    return sg + NI.format(a) + cur;
  };

  function companyResearch(c) {
    const F = FEAT();
    const isFund = ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk));
    if (isFund) return ['<section class="tile pad"><h3>Nieuws en cijfers</h3><p class="muted">Voor fondsen zijn er geen bedrijfsnieuws, analisten of jaarcijfers; kijk bij de bedrijven erin (Plannen > Werkelijke spreiding).</p></section>'];
    const R = (data.research || {})[c.tk];
    const tiles = [];
    const finnhubOff = !F.has.finnhub && !demo;
    const wait = 'De gegevens worden opgehaald buiten de meettijden; kom straks terug.';
    // Nieuws
    if (finnhubOff) tiles.push(offTile('Nieuws', 'Zet Finnhub aan (gratis sleutel) om het laatste nieuws per aandeel te zien.'));
    else if (!R) tiles.push(offTile('Nieuws', wait));
    else {
      const news = R.news || [];
      tiles.push('<section class="tile pad"><h3>Nieuws</h3>' + (news.length ? '<div class="news">' + news.map((n) =>
        '<a class="news-i" href="' + esc(n.url) + '" target="_blank" rel="noopener"><span class="news-m">' + toneTag(n) + esc(fD.format(n.t) + (n.source ? ', ' + n.source : '')) + '</span><span class="news-t">' + esc(n.headline) + '</span></a>').join('') + '</div>'
        : '<p class="muted">Geen nieuws in de afgelopen tien dagen' + (c.cur && c.cur !== 'USD' ? ' (Finnhub heeft nieuws alleen voor Noord-Amerikaanse bedrijven)' : '') + '.</p>') +
        '<p class="sub" style="margin-top:8px">Koppen en links van Finnhub; het artikel opent bij de bron.</p></section>');
    }
    // Analisten
    if (finnhubOff) tiles.push(offTile('Wat analisten vinden', 'Zet Finnhub aan (gratis sleutel) om aanbevelingen van analisten en kwartaalverrassingen te zien.'));
    else if (R) {
      const rec = (R.rec || [])[0], old = (R.rec || [])[3] || (R.rec || [])[R.rec ? R.rec.length - 1 : 0];
      const parts = rec ? [['Sterk kopen', rec.sb, '#0B7A4B'], ['Kopen', rec.b, '#5FB58A'], ['Houden', rec.h, '#C9CED6'], ['Verkopen', rec.s, '#E3A79C'], ['Sterk verkopen', rec.ss, '#B4311F']] : [];
      const tot = sum(parts.map((x) => x[1] || 0));
      const buyShare = (r) => { const t = (r.sb || 0) + (r.b || 0) + (r.h || 0) + (r.s || 0) + (r.ss || 0); return t ? ((r.sb || 0) + (r.b || 0)) / t : null; };
      const trend = rec && old && old !== rec && isNum(buyShare(old)) ? buyShare(rec) - buyShare(old) : null;
      const eps = (R.eps || []).slice().reverse();
      const mx = Math.max(1e-9, ...eps.map((x) => Math.abs(x.pct || 0)));
      tiles.push('<section class="tile pad"><h3>Wat analisten vinden</h3>' +
        (rec && tot ? '<div class="rec-bar" role="img" aria-label="' + esc(parts.map((x) => x[0] + ' ' + x[1]).join(', ')) + '">' + parts.filter((x) => x[1]).map((x) =>
            '<i style="flex:' + x[1] + ';background:' + x[2] + '" data-tip="' + esc(x[0] + ': ' + x[1]) + '"></i>').join('') + '</div>' +
          '<div class="rec-leg">' + parts.map((x) => '<span><i style="background:' + x[2] + '"></i>' + esc(x[0]) + ' <b>' + (x[1] || 0) + '</b></span>').join('') + '</div>' +
          '<p class="sub" style="margin-top:6px">' + esc(P1.format(buyShare(rec)) + ' van ' + tot + ' analisten adviseert kopen (' + fMonY.format(ymd(rec.period)) + ')') +
          (isNum(trend) ? esc(Math.abs(trend) < 0.01 ? ', gelijk aan enkele maanden eerder.' : ', ' + (trend > 0 ? 'meer' : 'minder') + ' dan enkele maanden eerder (' + spct1(trend).replace('%', ' pp').replace('+', '+') + ').') : '.') + '</p>'
          : '<p class="muted">Geen aanbevelingen gevonden.</p>') +
        targetBlock(R, c) + sentBlock(R) +
        (eps.length ? '<h3 style="margin-top:14px">Kwartaalcijfers tegenover verwachting</h3><div class="eps">' + eps.map((x) =>
          '<div class="eps-i"><span class="muted small">' + esc(x.period ? fMonY.format(ymd(x.period)) : '') + '</span>' +
          '<span class="eps-b"><i class="' + ((x.pct || 0) < 0 ? 'neg' : 'pos') + '" style="height:' + (Math.abs(x.pct || 0) / mx * 50).toFixed(0) + '%"></i></span>' +
          '<b class="' + tone(x.pct) + '">' + esc(isNum(x.pct) ? spct1(x.pct / 100) : '–') + '</b><span class="muted small">' + esc(isNum(x.actual) ? N2.format(x.actual) + ' / ' + N2.format(x.estimate) : '') + '</span></div>').join('') + '</div>' +
          '<p class="sub" style="margin-top:6px">Winst per aandeel: werkelijk / verwacht, en het verschil.</p>' : '') + '</section>');
    }
    // Insiders
    if (finnhubOff) tiles.push(offTile('Insiderhandel', 'Zet Finnhub aan (gratis sleutel) om te zien of bestuurders zelf aandelen kopen of verkopen.'));
    else if (R) {
      if ((R.denied || []).includes('insider')) tiles.push(offTile('Insiderhandel', 'Insiderhandel zit niet in je Finnhub-abonnement.'));
      else {
        const ins = R.insider || [];
        const ps = ins.filter((x) => x.code === 'P' || x.code === 'S');
        const netSh = sum(ps.map((x) => x.change || 0));
        const netVal = sum(ps.map((x) => (x.change || 0) * (x.price || 0)));
        const buyers = new Set(ins.filter((x) => x.code === 'P').map((x) => x.name)).size, sellers = new Set(ins.filter((x) => x.code === 'S').map((x) => x.name)).size;
        tiles.push('<section class="tile pad"><h3>Insiderhandel</h3>' + (ins.length ? kvList([
            ['Laatste 6 maanden, kopen en verkopen', ps.length ? (netSh >= 0 ? 'per saldo gekocht' : 'per saldo verkocht') : 'geen', ps.length ? (netSh >= 0 ? 'gain' : 'loss') : ''],
            ['Waarde (koop min verkoop)', ps.length ? bigNum(netVal, 'USD') : '–', tone(netVal)],
            ['Kopers en verkopers', buyers + ' en ' + sellers],
          ]) + '<div class="tx-list" style="margin-top:8px">' + ins.slice(0, 6).map((x) =>
            '<div class="tx"><span class="tag' + (x.code === 'P' ? ' gain' : x.code === 'S' ? ' loss' : '') + '">' + esc(INSIDER_CODES[x.code] || x.code || '?') + '</span>' +
            '<span class="tx-m"><b>' + esc(x.name || '') + '</b><span class="sub">' + esc(x.date ? fD.format(ymd(x.date)) + ' ' + x.date.slice(0, 4) : '') + '</span></span>' +
            '<span class="tx-v">' + esc(isNum(x.change) ? sgn(x.change, NI) + ' st.' : '') + (isNum(x.price) && x.price > 0 ? '<span class="sub">à $' + esc(N2.format(x.price)) + '</span>' : '') + '</span></div>').join('') + '</div>' +
          '<p class="sub" style="margin-top:8px">Uit meldingen bij de toezichthouder. Verkopen gebeuren vaak volgens vaste plannen of voor belasting; kopen met eigen geld zegt meestal meer.</p>'
          : '<p class="muted">Geen meldingen in de afgelopen 6 maanden.</p>') + '</section>');
      }
    }
    // Bedrijfscijfers
    const Fin = (data.fin || {})[c.tk];
    if (!F.has.sec && !demo) tiles.push(offTile('Bedrijfscijfers', 'Vul bij Koppelingen een e-mailadres in voor SEC EDGAR (gratis) om omzet en winst over meerdere jaren te zien.'));
    else if (!Fin) tiles.push(offTile('Bedrijfscijfers', wait));
    else if (Fin.none) tiles.push('<section class="tile pad"><h3>Bedrijfscijfers</h3><p class="muted">' + esc(Fin.none) + '</p></section>');
    else tiles.push(finTile(Fin));
    return tiles;
  }

  function finTile(Fin) {
    const S = Fin.series || {};
    const rev = new Map((S.rev && S.rev.rows) || []), net = new Map((S.net && S.net.rows) || []), op = new Map((S.op && S.op.rows) || []), eps = new Map((S.eps && S.eps.rows) || []);
    const years = [...new Set([...rev.keys(), ...net.keys()])].sort((a, b) => a - b).slice(-6);
    const unit = (S.rev && S.rev.unit) || (S.net && S.net.unit) || 'USD';
    const mx = Math.max(1, ...years.map((y) => Math.max(Math.abs(rev.get(y) || 0), Math.abs(net.get(y) || 0))));
    const ly = years[years.length - 1], py = years[years.length - 2];
    const growth = ly && py && rev.get(py) ? rev.get(ly) / rev.get(py) - 1 : null;
    const margin = ly && rev.get(ly) && isNum(net.get(ly)) ? net.get(ly) / rev.get(ly) : null;
    return '<section class="tile pad"><h3>Bedrijfscijfers per jaar</h3>' +
      '<div class="fin-bars" role="img" aria-label="Omzet en winst per jaar">' + years.map((y) => {
        const r = rev.get(y), n = net.get(y);
        return '<div class="fin-y" data-tip="' + esc(y + ': omzet ' + bigNum(r, unit) + ', winst ' + bigNum(n, unit) + (isNum(r) && isNum(n) && r ? ' (marge ' + P1.format(n / r) + ')' : '')) + '">' +
          '<span class="fin-c"><i class="rev" style="height:' + (Math.abs(r || 0) / mx * 100).toFixed(1) + '%"></i><i class="' + ((n || 0) < 0 ? 'neg' : 'net') + '" style="height:' + (Math.abs(n || 0) / mx * 100).toFixed(1) + '%"></i></span>' +
          '<span class="muted small">' + y + '</span></div>';
      }).join('') + '</div>' +
      '<div class="legend" style="margin-top:8px"><span><i style="background:#8FAEF0"></i>Omzet</span><span><i style="background:' + C.gain + '"></i>Nettowinst</span></div>' +
      '<div style="margin-top:10px">' + kvList([
        ['Omzet ' + (ly || ''), bigNum(rev.get(ly), unit)],
        ['Groei omzet t.o.v. ' + (py || 'vorig jaar'), isNum(growth) ? spct1(growth) : '–', tone(growth)],
        ['Nettowinst en marge', ly ? bigNum(net.get(ly), unit) + (isNum(margin) ? ' (' + P1.format(margin) + ')' : '') : '–', tone(net.get(ly))],
        ['Bedrijfsresultaat', ly && isNum(op.get(ly)) ? bigNum(op.get(ly), unit) : '–'],
        ['Winst per aandeel (verwaterd)', ly && isNum(eps.get(ly)) ? N2.format(eps.get(ly)) + (unit === 'USD' ? ' $' : ' ' + unit) : '–'],
      ]) + '</div><p class="sub" style="margin-top:8px">Kalenderjaren uit de jaarverslagen bij de SEC (' + esc(unit) + '). Bijgewerkt ' + esc(Fin.updated || '') + '.</p></section>';
  }


  // Koersdoel van analisten tegenover de koers nu
  function targetBlock(R, c) {
    const T = R.target;
    if (!T || !isNum(T.mean)) return (R.denied || []).includes('target') ? '<p class="sub" style="margin-top:8px">Koersdoelen zitten niet in je Finnhub-abonnement.</p>' : '';
    const price = isNum(c.priceNative) ? c.priceNative : null;
    const cur = c.cur || 'USD';
    const lo = Math.min(T.low, price || T.low), hi = Math.max(T.high, price || T.high);
    const pos = (v) => (hi > lo ? ((v - lo) / (hi - lo) * 100).toFixed(1) + '%' : '50%');
    const up = price ? T.mean / price - 1 : null;
    return '<h3 style="margin-top:14px">Koersdoel</h3>' +
      '<div class="tgt"><span class="tgt-rail"></span><span class="tgt-band" style="left:' + pos(T.low) + ';width:calc(' + pos(T.high) + ' - ' + pos(T.low) + ')"></span>' +
        '<span class="tgt-mean" style="left:' + pos(T.mean) + '" data-tip="' + esc('Gemiddeld koersdoel ' + money(T.mean, cur)) + '"></span>' +
        (price ? '<span class="tgt-now" style="left:' + pos(price) + '" data-tip="' + esc('Koers nu ' + money(price, cur)) + '"></span>' : '') + '</div>' +
      '<div class="range-labels"><span>laagste ' + esc(money(T.low, cur)) + '</span><span>hoogste ' + esc(money(T.high, cur)) + '</span></div>' +
      '<p class="sub" style="margin-top:6px">Gemiddeld koersdoel ' + esc(money(T.mean, cur)) + (isNum(up) ? ', ' + esc(spct1(up)) + ' ten opzichte van de koers nu' : '') +
        '. Streep: gemiddelde, stip: koers nu. Koersdoelen zijn meningen van analisten, geen voorspelling.</p>';
  }

  // Stemming in het nieuws (Finnhub, alleen Amerikaanse bedrijven)
  function sentBlock(R) {
    const S = R.sent;
    if (!S || !isNum(S.bull)) return (R.denied || []).includes('sent') ? '<p class="sub" style="margin-top:8px">Nieuwsstemming zit niet in je Finnhub-abonnement.</p>' : '';
    const word = S.bull >= 0.65 ? 'vooral positief' : S.bull >= 0.55 ? 'eerder positief' : S.bull > 0.45 ? 'gemengd' : S.bull > 0.35 ? 'eerder negatief' : 'vooral negatief';
    return '<h3 style="margin-top:14px">Stemming in het nieuws</h3>' +
      '<div class="rec-bar"><i style="flex:' + S.bull + ';background:' + C.gain + '" data-tip="' + esc('Positief ' + P1.format(S.bull)) + '"></i><i style="flex:' + (S.bear || 0) + ';background:' + C.loss + '" data-tip="' + esc('Negatief ' + P1.format(S.bear || 0)) + '"></i></div>' +
      '<p class="sub" style="margin-top:6px">' + esc('Afgelopen week ' + word + ' (' + P1.format(S.bull) + ' positief' + (isNum(S.articles) ? ', ' + S.articles + ' artikelen' : '') + ')' +
        (isNum(S.score) && isNum(S.sector) ? '. Nieuwsscore ' + N2.format(S.score) + ' tegenover ' + N2.format(S.sector) + ' gemiddeld in de sector' : '') + '.') + '</p>';
  }

  // ---------- Volglijst ----------
  const isWatchKey = (k) => typeof k === 'string' && k[0] === '~';
  const watchSyms = () => ((M && M.settings && M.settings.watchlist) || []);
  function watchPseudo(sym) {
    const p = M.mk.ok ? M.mk.prof(sym) : null;
    return { tk: sym, name: (p && p.name) || sym, cur: (p && p.currency) || 'USD', priceNative: p && p.price, watch: true, value: null, weight: null };
  }
  function watchEvents(sym) {
    const ev = data.events || {};
    const today = dayStart(Date.now());
    const earn = (ev.earnings || []).filter((e) => e.ticker === sym && ymd(e.date) >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const div = (ev.dividends || []).filter((d) => d.ticker === sym && d.announced).sort((a, b) => String(a.exDate).localeCompare(String(b.exDate)))[0];
    const last = (ev.lastEarnings || []).find((e) => e.ticker === sym);
    return { earn, div, last };
  }

  function watchTile(sym, phone) {
    const c = watchPseudo(sym);
    const p = M.mk.ok ? M.mk.prof(sym) : null;
    const W = watchEvents(sym);
    const pts = M.mk.ok ? M.mk.prices(sym).slice(-60).map((x) => ({ t: x.t, v: x.v })) : [];
    const rb = p ? rangeBar(p) : { html: '', off: null };
    const ch = p && isNum(p.change) ? p.change / 100 : null;
    const unknown = !p && ((data.market && data.market.unknown) || []).includes(sym);
    const sub = W.earn ? 'cijfers ' + fDM.format(ymd(W.earn.date)) : p && p.sector ? sectorNl(p.sector) : p ? '' :
      unknown ? 'symbool niet gevonden; controleer het beurssymbool' : (!demo && !FEAT().has.fmp) ? 'koers vraagt een FMP-sleutel' : 'gegevens worden opgehaald';
    if (phone) {
      return '<button type="button" class="m-row" data-ticker="~' + esc(sym) + '" aria-label="' + esc(c.name + ', volglijst. Openen') + '">' +
        '<span class="l"><span class="tk">' + esc(sym) + '</span><span class="nm">' + esc(c.name !== sym ? c.name : sub) + '</span></span>' +
        spark(pts, toneColor(ch), 'mspark') +
        '<span class="rt"><b>' + esc(p && isNum(p.price) ? money(p.price, p.currency) : '–') + '</b><span class="chip-chg ' + tone(ch) + '">' + esc(isNum(ch) ? spct(ch) : 'volglijst') + '</span></span></button>';
    }
    return '<button type="button" class="tile watch" data-ticker="~' + esc(sym) + '" aria-label="' + esc(c.name + ', volglijst. Inzoomen') + '">' +
      '<span class="row"><span class="tk">' + esc(sym) + '</span><span class="tag">Volglijst</span></span>' +
      '<span class="nm">' + esc(c.name) + '</span>' +
      '<span class="row" style="margin-top:8px"><span class="v" style="font-size:22px">' + esc(p && isNum(p.price) ? money(p.price, p.currency) : '–') + '</span><b class="' + tone(ch) + '">' + esc(isNum(ch) ? spct(ch) : '') + '</b></span>' +
      (rb.html && p && p.range ? '<span class="sub" style="display:block;margin-top:6px">' + rb.html + '</span><span class="sub">' + esc(isNum(rb.off) ? (rb.off > -0.005 ? 'bij de jaartop' : P1.format(-rb.off) + ' onder de jaartop') : '') + '</span>' : '') +
      '<span class="sub">' + esc(sub) + '</span>' + spark(pts, toneColor(ch)) + '</button>';
  }

  function watchAddForm(id) {
    return '<form class="watch-add" data-watchform="' + id + '"><label class="sr-only" for="' + id + '">Symbool toevoegen</label>' +
      '<input id="' + id + '" class="search" type="text" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="Beurssymbool, bijv. NVDA">' +
      '<button type="submit" class="btn primary">Volgen</button><span class="small muted watch-status" role="status"></span></form>';
  }

  function renderWatch() {
    const syms = watchSyms();
    const empty = '<p class="empty">Nog niets op je volglijst. Voeg een beurssymbool toe (zoals NVDA of LMT) om koers, agenda, nieuws en cijfers te volgen zonder het aandeel te hebben.</p>';
    if ($('watch-grid')) { if (!$('watch-in')) $('watch-add').innerHTML = watchAddForm('watch-in'); fill('watch-grid', syms.length ? syms.map((x) => watchTile(x, false)) : [empty]); }
    if ($('m-watch-rows')) { if (!$('m-watch-in')) $('m-watch-add').innerHTML = watchAddForm('m-watch-in'); fill('m-watch-rows', syms.length ? syms.map((x) => watchTile(x, true)) : ['<p class="m-sub" style="padding:16px">Nog niets op je volglijst.</p>']); }
    const sg = watchSuggestTile();
    if ($('watch-sugg')) $('watch-sugg').innerHTML = sg;
    if ($('m-watch-sugg')) $('m-watch-sugg').innerHTML = sg;
  }

  async function setWatchlist(list, statusEl, note) {
    const say = (t, cls) => { if (statusEl) { statusEl.textContent = t; statusEl.className = 'small watch-status ' + (cls || 'muted'); } };
    try {
      say('Bezig met opslaan…');
      await saveSettings({ watchlist: list });
      if (!demo && isWorker()) {
        say(note + ' Gegevens worden opgehaald…');
        try { await workerCall('/api/market?plan=1', { method: 'POST' }); } catch (e) { /* de Worker probeert het later opnieuw */ }
        await load();
      } else renderAll();
      say(note, 'gain');
    } catch (err) { say('Mislukt: ' + err.message, 'loss'); }
  }

  document.addEventListener('submit', (e) => {
    const f = e.target.closest && e.target.closest('[data-watchform]');
    if (!f) return;
    e.preventDefault();
    const inp = f.querySelector('input');
    const sym = (inp.value || '').trim().toUpperCase();
    const st = f.querySelector('.watch-status');
    const bad = (t) => { st.textContent = t; st.className = 'small watch-status loss'; };
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(sym)) { bad('Gebruik het beurssymbool, zoals AAPL of BRK.B.'); return; }
    const heldSyms = new Set([...M.byTk.keys()].concat(M.mk.ok ? Object.values(data.market.symbols || {}) : []));
    if (heldSyms.has(sym)) { bad('Dit aandeel heb je al.'); return; }
    const list = watchSyms().slice();
    if (list.includes(sym)) { bad('Staat al op je volglijst.'); return; }
    if (list.length >= 20) { bad('Maximaal 20 aandelen.'); return; }
    list.push(sym);
    inp.value = '';
    setWatchlist(list, st, sym + ' staat op je volglijst.');
  });

  function renderWatchDetail(sym) {
    const c = watchPseudo(sym);
    const p = M.mk.ok ? M.mk.prof(sym) : null;
    const W = watchEvents(sym);
    const ch = p && isNum(p.change) ? p.change / 100 : null;
    const research = companyResearch(c);
    const market = p ? companyMarket(c) : { tiles: [], table: '' };
    const agenda = '<section class="tile pad"><h3>Agenda</h3>' + kvList([
      ['Volgende kwartaalcijfers', W.earn ? fD.format(ymd(W.earn.date)) + ', ' + whenText(ymd(W.earn.date)) : (FEAT().has.fmp || demo) ? 'nog niet bekend' : 'vraagt een FMP-sleutel'],
      ['Verwachte winst per aandeel', W.earn && isNum(W.earn.epsEst) ? N2.format(W.earn.epsEst) : '–'],
      ['Vorige cijfers', W.last ? fDM.format(ymd(W.last.date)) + (surpriseText(W.last) ? ', ' + surpriseText(W.last) : '') : '–'],
      ['Volgend dividend', W.div ? [W.div.exDate ? 'ex-dividend ' + fDM.format(ymd(W.div.exDate)) : '', W.div.perShare ? money(W.div.perShare, c.cur) + ' per aandeel' : ''].filter(Boolean).join(', ') : '–'],
    ]) + '<p class="sub" style="margin-top:8px">De agenda van volgaandelen wordt elke ochtend bijgewerkt.</p></section>';
    const head = '<p class="hero-label">' + esc(c.name) + ', volglijst</p><h2 id="d-title" class="' + (mode === 'm' ? 'm-value' : 'hero-value') + '">' + esc(sym) + ' ' + esc(p && isNum(p.price) ? money(p.price, p.currency) : '') + '</h2>' +
      (mode === 'm' ? (isNum(ch) ? '<p><span class="pill-chg ' + tone(ch) + '">' + esc(spct(ch)) + '</span></p><span class="base" style="padding:6px 0 0">op de laatste handelsdag in de VS</span>' : '<span class="base" style="padding:6px 0 0">Nog geen koers; die wordt de volgende ochtend opgehaald.</span>')
        : '<p class="hero-change ' + tone(ch) + '">' + esc(isNum(ch) ? spct(ch) + ' op de laatste handelsdag' : 'Nog geen koers; die wordt de volgende ochtend opgehaald.') + '</p>');
    const chart = '<div class="chart ' + (mode === 'm' ? 'm-chart' : 'hero-chart') + '" data-chart="watch" data-sym="' + esc(sym) + '" role="img" aria-label="' + esc('Koers van ' + c.name) + '"></div><div class="xlabels" data-x="watch"></div>';
    const remove = '<button type="button" class="btn ghost danger" data-unwatch="' + esc(sym) + '">Van volglijst halen</button>';
    if (mode === 'm') {
      return '<div class="md"><div class="m-dtop"><button type="button" class="m-back" data-act="back">‹ Terug</button><span class="t">' + esc(sym) + '</span><span></span></div>' +
        '<div class="m-hero"><div class="m-swipe">' + head + '</div>' + chart + '</div>' +
        '<div class="m-body"><div class="m-stack">' + agenda + research.join('') + market.tiles.join('') + market.table + '<div style="padding:8px 0">' + remove + '</div></div></div></div>';
    }
    return '<div class="band"><div class="d-top"><button type="button" class="btn dark" data-act="back">← Terug</button>' + remove + '</div>' +
      '<div class="hero-head"><div>' + head + '</div></div>' + chart + '</div>' +
      '<div class="wrap"><div class="grid wide">' + agenda + market.tiles.join('') + '</div>' +
      '<div class="section-head"><h2>Nieuws, analisten en cijfers</h2></div><div class="grid wide">' + research.join('') + '</div>' +
      (market.table ? '<div style="margin-top:16px">' + market.table + '</div>' : '') + '</div>';
  }

  function drawWatchChart(root) {
    const host = root.querySelector('[data-chart="watch"]');
    if (!host) return;
    const sym = host.dataset.sym;
    const pts = M.mk.ok ? M.mk.prices(sym).map((x) => ({ t: x.t, v: x.v })) : [];
    const cur = ((M.mk.ok && M.mk.prof(sym)) || {}).currency || 'USD';
    lineChart(host, [{ pts, color: C.accent, area: true, width: 3, fmt: (v) => money(v, cur) }], {
      animate: true, xl: root.querySelector('[data-x="watch"]'), xcount: 4, xfmt: (t) => fDM.format(t), tfmt: (t) => fD.format(t),
      empty: 'Nog geen koershistorie. Het gratis FMP-abonnement geeft die alleen voor een deel van de aandelen; anders bouwt de tracker hem dag voor dag op.',
    });
  }


  // ---------- Wat als: dezelfde stortingen in een indexfonds ----------
  // Index (FRED, in dollars) omgerekend naar euro met de ECB-koers van dezelfde dag
  function indexEur(id) {
    const ser = data.idx && data.idx.series && data.idx.series[id];
    if (!ser || !ser.length) return [];
    const fx = fxMap();
    const fxDays = [...fx.keys()].sort();
    let j = 0, last = null;
    return ser.map(([d, v]) => { while (j < fxDays.length && fxDays[j] <= d) { last = fx.get(fxDays[j]); j++; } return last ? { day: d, t: ymd(d), v: v / last } : null; }).filter(Boolean);
  }
  const priceOn = (pts, t) => { let p = null; for (const x of pts) { if (x.t <= t + 12 * HOUR) p = x; else break; } return p; };

  function whatIf(id) {
    const pts = indexEur(id);
    const W = M.weeks.filter((w) => isNum(w.netDeposits));
    if (pts.length < 20 || W.length < 2) return null;
    let units = 0;
    const line = [];
    W.forEach((w, i) => {
      const dep = i === 0 ? w.accountValue : (isNum(w.newDeposits) ? w.newDeposits : 0); // start: wat je toen had, daarna de stortingen
      const p = priceOn(pts, w.t);
      if (!p) return;
      units += dep / p.v;
      line.push({ t: w.t, v: units * p.v });
    });
    const lastP = pts[pts.length - 1];
    const now = units * lastP.v;
    return { id, label: id === 'SP500' ? 'S&P 500' : 'Nasdaq-100', now, line: line.concat([{ t: Math.max(lastP.t, line.length ? line[line.length - 1].t + HOUR : lastP.t), v: now }]), lastDay: lastP.day };
  }

  function whatIfTile() {
    if (!(data.idx && data.idx.series)) return '<section class="tile pad"><h3>Wat als alles in de index had gezeten</h3><p class="muted">De koersen van de S&P 500 en de Nasdaq-100 worden één keer per dag opgehaald bij FRED. Dat is nog niet gebeurd.</p></section>';
    const A = whatIf('SP500'), B = whatIf('NASDAQ100');
    if (!A) return '<section class="tile pad"><h3>Wat als alles in de index had gezeten</h3><p class="muted">Hiervoor zijn minstens twee weekmetingen en wisselkoersen nodig.</p></section>';
    const mine = M.accountNow;
    const diff = (x) => mine - x.now;
    return '<section class="tile pad whatif"><h3>Wat als alles in de index had gezeten</h3>' +
      '<div class="chart" data-chart="whatif" style="height:180px"></div><div class="xlabels" data-x="whatif"></div>' +
      '<div class="legend chart-legend" style="margin-top:8px"><span><i style="background:' + C.accent + '"></i>Jij ' + esc(eur(mine)) + '</span>' +
        '<span><i class="dash"></i>S&amp;P 500 ' + esc(eur(A.now)) + '</span>' + (B ? '<span><i style="background:#9AA3B5"></i>Nasdaq-100 ' + esc(eur(B.now)) + '</span>' : '') + '</div>' +
      '<div style="margin-top:10px">' + kvList([
        ['Jij tegenover de S&P 500', seur(diff(A)) + (A.now ? ' (' + spct1(mine / A.now - 1) + ')' : ''), tone(diff(A))],
        ['Jij tegenover de Nasdaq-100', B ? seur(diff(B)) + (B.now ? ' (' + spct1(mine / B.now - 1) + ')' : '') : '–', B ? tone(diff(B)) : ''],
      ]) + '</div>' +
      '<p class="sub" style="margin-top:8px">Alsof je bij de eerste weekmeting (' + esc(fDM.format(M.weeks[0].t)) + ') je hele accountwaarde in de index had gezet en daarna elke storting ook. Koersindex zonder dividend en zonder kosten, omgerekend naar euro met de ECB-koers. Bron: FRED.</p></section>';
  }

  function drawWhatIf(root) {
    const host = root.querySelector('[data-chart="whatif"]');
    if (!host) return;
    const A = whatIf('SP500'), B = whatIf('NASDAQ100');
    if (!A) return;
    const mine = M.weeks.map((w) => ({ t: w.t, v: w.accountValue })).concat([{ t: A.line[A.line.length - 1].t, v: M.accountNow }]);
    const base = mine.map((p) => p.t);
    const onBase = (line) => base.map((t) => { const p = priceOn(line, t); return { t, v: p ? p.v : null }; });
    const sets = [{ pts: mine, color: C.accent, width: 3, label: 'Jij' }, { pts: onBase(A.line), color: C.ink2, dash: true, width: 2, label: 'S&P 500' }];
    if (B) sets.push({ pts: onBase(B.line), color: '#9AA3B5', width: 2, label: 'Nasdaq-100' });
    lineChart(host, sets, { top: 0.08, bottom: 0.08, xl: root.querySelector('[data-x="whatif"]'), xcount: 3, xfmt: (t) => fDM.format(t), tfmt: (t) => fD.format(t) });
  }

  // ---------- Jaaroverzicht ----------
  function yearList() {
    const ys = new Set(M.weeks.map((w) => new Date(w.t).getFullYear()));
    ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => b - a);
  }

  function yearStats(Y) {
    const W = M.weeks;
    const inY = W.filter((w) => new Date(w.t).getFullYear() === Y);
    const prev = W.filter((w) => new Date(w.t).getFullYear() < Y).pop();
    const startW = prev || inY[0];
    if (!startW) return null;
    const isNow = Y === new Date().getFullYear();
    const endW = inY[inY.length - 1];
    const endV = isNow ? M.accountNow : endW ? endW.accountValue : null;
    const endDep = endW ? endW.netDeposits : startW.netDeposits;
    const dep = isNum(endDep) && isNum(startW.netDeposits) ? endDep - startW.netDeposits : null;
    const res = isNum(endV) && isNum(dep) ? endV - startW.accountValue - dep : null;
    let idx = 1; inY.filter((w) => w !== startW && isNum(w.weekResultPct)).forEach((w) => { idx *= 1 + w.weekResultPct; });
    const wr = inY.filter((w) => isNum(w.weekResult) && w !== startW);
    const best = wr.reduce((b, w) => (!b || w.weekResult > b.weekResult ? w : b), null);
    const worst = wr.reduce((b, w) => (!b || w.weekResult < b.weekResult ? w : b), null);
    const inYear = (t) => new Date(t).getFullYear() === Y;
    const divs = M.ev.received.filter((d) => inYear(d.t));
    const tx = M.tx.list.filter((x) => inYear(x.t));
    const sp = indexEur('SP500');
    const spA = priceOn(sp, startW.t), spB = sp.length ? (isNow ? sp[sp.length - 1] : priceOn(sp, endW ? endW.t : startW.t)) : null;
    const comp = M.companies.filter((c) => isNum(c.resultPct)).sort((a, b) => b.resultPct - a.resultPct);
    return {
      Y, isNow, from: startW.t, to: isNow ? M.lastT || Date.now() : endW ? endW.t : startW.t, startV: startW.accountValue, endV, dep, res,
      twr: inY.length > 1 ? idx - 1 : null, best, worst, weeks: wr.length,
      div: sum(divs.map((d) => d.amount)), nDiv: divs.length,
      fees: sum(tx.map((x) => (x.feeFx || 0) + (x.feeOther || 0))), realised: sum(tx.map((x) => x.realised || 0)),
      buys: tx.filter((x) => x.side === 'BUY').length, sells: tx.filter((x) => x.side === 'SELL').length,
      market: spA && spB ? spB.v / spA.v - 1 : null,
      top: comp[0] || null, flop: comp[comp.length - 1] || null,
    };
  }

  function yearRows(R) {
    return [
      ['Periode', fD.format(R.from) + ' ' + new Date(R.from).getFullYear() + ' tot ' + fD.format(R.to) + (R.isNow ? ' (lopend jaar)' : '')],
      ['Accountwaarde begin en eind', eur(R.startV) + ' → ' + eur(R.endV)],
      ['Netto ingelegd', isNum(R.dep) ? seur(R.dep) : '–'],
      ['Resultaat', isNum(R.res) ? seur(R.res) : '–', tone(R.res)],
      ['Rendement zonder stortingen', isNum(R.twr) ? spct1(R.twr) : '–', tone(R.twr)],
      ['S&P 500 in euro, zelfde periode', isNum(R.market) ? spct1(R.market) : '–', tone(R.market)],
      ['Beste week', R.best ? seur(R.best.weekResult) + ', tot ' + fDM.format(R.best.t) : '–', R.best ? tone(R.best.weekResult) : ''],
      ['Slechtste week', R.worst ? seur(R.worst.weekResult) + ', tot ' + fDM.format(R.worst.t) : '–', R.worst ? tone(R.worst.weekResult) : ''],
      ['Dividend ontvangen', eur(R.div) + ' (' + R.nDiv + (R.nDiv === 1 ? ' uitkering)' : ' uitkeringen)')],
      ['Gerealiseerd resultaat', seur(R.realised), tone(R.realised)],
      ['Kosten', eur(R.fees)],
      ['Aankopen en verkopen', R.buys + ' en ' + R.sells],
      ['Beste positie nu (sinds aankoop)', R.top ? R.top.tk + ' ' + spct1(R.top.resultPct) : '–', R.top ? tone(R.top.resultPct) : ''],
      ['Zwakste positie nu (sinds aankoop)', R.flop ? R.flop.tk + ' ' + spct1(R.flop.resultPct) : '–', R.flop ? tone(R.flop.resultPct) : ''],
    ];
  }

  function yearTile() {
    const ys = yearList();
    if (!plan.year || !ys.includes(plan.year)) plan.year = ys[0];
    const R = yearStats(plan.year);
    return '<section class="tile pad"><div class="plan-head"><h3>Jaaroverzicht</h3>' +
      '<div class="seg light" role="group" aria-label="Jaar" data-plan="year">' + ys.map((y) => '<button type="button" data-k="' + y + '" aria-pressed="' + (y === plan.year) + '">' + y + '</button>').join('') + '</div></div>' +
      (R ? kvList(yearRows(R)) + '<div class="plan-actions" style="margin-top:12px"><button type="button" class="btn ghost" data-plan="print-year">Bewaren als PDF</button></div>' +
        '<p class="sub" style="margin-top:8px">Uit je weekmetingen, orders en dividenden. Bij "Bewaren als PDF" kies je in het afdrukvenster "Opslaan als PDF".</p>'
        : '<p class="muted">Geen weekmetingen in ' + plan.year + '.</p>') + '</section>';
  }

  function printYear() {
    const R = yearStats(plan.year);
    if (!R) return;
    const area = $('print-area');
    area.innerHTML = '<div class="print-doc"><p class="print-k">Investeringstracker</p><h1>Jaaroverzicht ' + R.Y + '</h1>' +
      '<p class="print-sub">Gemaakt op ' + esc(fD.format(Date.now()) + ' ' + new Date().getFullYear()) + '. Bedragen in euro.</p>' + kvList(yearRows(R)) +
      '<h2>Posities nu</h2><table class="tbl"><thead><tr><th>Positie</th><th class="num">Waarde</th><th class="num">Ingelegd</th><th class="num">Resultaat</th></tr></thead><tbody>' +
      M.companies.slice().sort((a, b) => b.value - a.value).map((c) => '<tr><td>' + esc(c.tk + ' ' + c.name) + '</td><td class="num">' + esc(eur(c.value)) + '</td><td class="num">' + esc(eur(c.cost)) + '</td><td class="num ' + tone(c.unreal) + '">' + esc(isNum(c.unreal) ? seur(c.unreal) + ' (' + spct1(c.resultPct) + ')' : '–') + '</td></tr>').join('') +
      '</tbody></table><p class="print-sub">Bronnen: Trading 212 (posities, orders, dividend), ECB en FRED (S&P 500 in euro). Dit overzicht is geen fiscaal document.</p></div>';
    document.body.classList.add('printing');
    setTimeout(() => { window.print(); }, 50);
  }
  window.addEventListener('afterprint', () => { document.body.classList.remove('printing'); const a = $('print-area'); if (a) a.innerHTML = ''; });

  // ---------- Mijlpalen ----------
  const MILESTONES = [250, 500, 1000, 1500, 2000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 75000, 100000, 250000];
  function milestones() {
    const W = M.weeks;
    const list = [];
    if (W.length) list.push({ t: W[0].t, title: 'Start van de tracker', sub: 'accountwaarde ' + eur(W[0].accountValue) });
    MILESTONES.forEach((m) => {
      const hit = W.find((w) => w.accountValue >= m);
      if (hit && hit !== W[0]) list.push({ t: hit.t, title: 'Over de ' + eur(m).replace(',00', ''), sub: 'week tot ' + fDM.format(hit.t) });
    });
    if (M.tx.buys[0]) list.push({ t: M.tx.buys[0].t, title: 'Eerste aankoop in de geschiedenis', sub: M.tx.buys[0].tk + ', ' + eur(M.tx.buys[0].net) });
    if (M.tx.sells[0]) list.push({ t: M.tx.sells[0].t, title: 'Eerste verkoop', sub: M.tx.sells[0].tk + (M.tx.sells[0].realised ? ', ' + seur(M.tx.sells[0].realised) + ' resultaat' : '') });
    if (M.ev.received[0]) list.push({ t: M.ev.received[0].t, title: 'Eerste dividend', sub: M.ev.received[0].ticker + ', ' + eur(M.ev.received[0].amount) });
    const wr = W.filter((w) => isNum(w.weekResult));
    const best = wr.reduce((b, w) => (!b || w.weekResult > b.weekResult ? w : b), null);
    if (best && best.weekResult > 0) list.push({ t: best.t, title: 'Beste week tot nu toe', sub: seur(best.weekResult) });
    const top = W.reduce((b, w) => (!b || w.accountValue > b.accountValue ? w : b), null);
    if (top) list.push({ t: top.t, title: 'Hoogste weekstand', sub: eur(top.accountValue) });
    return list.sort((a, b) => a.t - b.t);
  }

  function milestoneTile() {
    const list = milestones();
    const now = M.accountNow || 0;
    const next = MILESTONES.find((m) => m > now);
    let eta = null;
    if (next) {
      const monthly = isNum(M.settings.monthly) ? M.settings.monthly : monthlyGuess();
      const rm = Math.pow(1.07, 1 / 12) - 1;
      let v = now, k = 0;
      while (v < next && k < 600) { v = v * (1 + rm) + monthly; k++; }
      eta = k < 600 ? new Date(new Date().getFullYear(), new Date().getMonth() + k, 1).getTime() : null;
    }
    return '<section class="tile pad"><h3>Mijlpalen</h3>' +
      (next ? '<div class="ms-next"><span class="muted small">Volgende</span><b>' + esc(eur(next).replace(',00', '')) + '</b><span class="muted small">nog ' + esc(eur(next - now)) +
        (eta ? ', rond ' + esc(new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(eta)) + ' bij je huidige inleg en 7% per jaar' : '') + '</span><div class="meter"><div style="width:' + Math.min(100, now / next * 100).toFixed(1) + '%"></div></div></div>' : '') +
      (list.length ? '<ol class="ms">' + list.slice().reverse().map((m) => '<li><span class="ms-d">' + esc(fDM.format(m.t) + ' ' + String(new Date(m.t).getFullYear()).slice(2)) + '</span><span class="ms-t"><b>' + esc(m.title) + '</b><span class="muted small">' + esc(m.sub) + '</span></span></li>').join('') + '</ol>'
        : '<p class="muted">Na de eerste weekmeting verschijnen hier je mijlpalen.</p>') + '</section>';
  }

  // ---------- Valuta en koopkracht ----------
  function usdExposure() {
    let direct = 0, viaFunds = 0;
    M.companies.forEach((c) => {
      if (BENCHES.slice(0, 2).some((b) => b[1].test(c.tk) || b[2].test(c.name))) viaFunds += c.value;
      else if (c.cur === 'USD') direct += c.value;
    });
    return { direct, viaFunds, total: direct + viaFunds };
  }

  function fxTile() {
    const F = FEAT();
    if (!demo && F.flags.fx === false) return offTile('Euro en dollar', 'Het valuta-overzicht staat uit. Zet het aan bij Koppelingen (geen sleutel nodig).');
    const fx = data.fx;
    if (!fx || !fx.rates || !(fx.rates.USD || []).length) return offTile('Euro en dollar', 'De koersen van de ECB worden één keer per dag opgehaald; dat is nog niet gebeurd.');
    const pts = fx.rates.USD.map(([d, v]) => ({ t: ymd(d), v }));
    const now = pts[pts.length - 1];
    const at = (days) => { const t = now.t - days * DAY; return pts.filter((p) => p.t <= t).pop() || pts[0]; };
    const m1 = at(30), y1 = at(365);
    const usdBuys = M.tx.trades.filter((x) => x.side === 'BUY' && x.cur === 'USD' && isNum(x.fxRate) && x.fxRate > 0.5);
    const avgRate = usdBuys.length ? sum(usdBuys.map((x) => x.fxRate * x.net)) / sum(usdBuys.map((x) => x.net)) : null;
    const E = usdExposure();
    const scen = E.total * (1 - 1 / 1.1);
    return '<section class="tile pad"><h3>Euro en dollar</h3>' +
      '<div class="fx-head"><span class="v big">' + esc(N4.format(now.v)) + '</span><span class="muted small">dollar per euro, ' + esc(fD.format(now.t)) + '</span></div>' +
      '<div class="chart" data-chart="fx" style="height:120px"></div><div class="xlabels" data-x="fx"></div>' +
      kvList([
        ['Afgelopen maand', spct((now.v / m1.v) - 1) + ' ' + (now.v > m1.v ? '(euro duurder)' : now.v < m1.v ? '(dollar duurder)' : '')],
        ['Afgelopen jaar', spct((now.v / y1.v) - 1)],
        ['Jouw gemiddelde aankoopkoers', isNum(avgRate) ? N4.format(avgRate) + ' (' + (now.v > avgRate ? 'dollar nu goedkoper: kost je geld' : 'dollar nu duurder: levert je geld op') + ')' : '–', isNum(avgRate) ? (now.v > avgRate ? 'loss' : 'gain') : ''],
        ['Dollar-blootstelling', eur(E.total) + ' (' + (M.totalValue ? P1.format(E.total / M.totalValue) : '–') + ' van je beleggingen)'],
        ['Als de dollar 10% minder waard wordt', '≈ −' + eur(scen), 'loss'],
      ]) +
      '<p class="sub" style="margin-top:8px">Een hogere koers betekent een duurdere euro: je Amerikaanse beleggingen zijn dan minder euro waard. Blootstelling: aandelen in dollar plus je fondsen op Amerikaanse indexen. ECB-referentiekoersen via Frankfurter.</p></section>';
  }

  function hicpSeries(area) {
    const h = data.hicp && data.hicp.series && data.hicp.series[area];
    return (h || []).map(([ym, v]) => ({ ym, t: ymd(ym + '-15'), v })).filter((p) => p.t != null);
  }

  function inflationTile() {
    const F = FEAT();
    if (!demo && F.flags.inflation === false) return offTile('Na inflatie', 'Inflatie staat uit. Zet het aan bij Koppelingen (geen sleutel nodig).');
    const nl = hicpSeries('NL'), ez = hicpSeries('U2');
    if (nl.length < 13) return offTile('Na inflatie', 'De inflatiecijfers van de ECB worden één keer per dag opgehaald; dat is nog niet gebeurd.');
    const last = nl[nl.length - 1];
    const yearAgo = nl.find((p) => p.ym === (Number(last.ym.slice(0, 4)) - 1) + last.ym.slice(4));
    const infl = yearAgo ? last.v / yearAgo.v - 1 : null;
    const ezLast = ez[ez.length - 1], ezYear = ez.find((p) => ezLast && p.ym === (Number(ezLast.ym.slice(0, 4)) - 1) + ezLast.ym.slice(4));
    // Rendement zonder stortingen sinds de eerste weekmeting, tegenover de prijsstijging in dezelfde periode
    const W = M.weeks.filter((w) => isNum(w.weekResultPct));
    let idx = 1; W.forEach((w) => { idx *= 1 + w.weekResultPct; });
    const start = M.weeks[0];
    const startIdx = start ? nl.filter((p) => p.t <= start.t).pop() : null;
    const priceRise = startIdx ? last.v / startIdx.v - 1 : null;
    const nominal = W.length ? idx - 1 : null;
    const real = isNum(nominal) && isNum(priceRise) ? (1 + nominal) / (1 + priceRise) - 1 : null;
    const dep = M.lastWeek && isNum(M.lastWeek.netDeposits) ? M.lastWeek.netDeposits : null;
    return '<section class="tile pad"><h3>Na inflatie</h3>' +
      '<div class="fx-head"><span class="v big">' + esc(isNum(infl) ? P1.format(infl) : '–') + '</span><span class="muted small">inflatie Nederland, 12 maanden tot ' + esc(fMonY.format(last.t)) + '</span></div>' +
      '<div class="chart" data-chart="hicp" style="height:110px"></div><div class="xlabels" data-x="hicp"></div>' +
      kvList([
        ['Eurozone', ezYear ? P1.format(ezLast.v / ezYear.v - 1) : '–'],
        ['Jouw rendement zonder stortingen', isNum(nominal) ? spct1(nominal) + ' sinds ' + fDM.format(start.t) : 'na de tweede weekmeting', tone(nominal)],
        ['Prijsstijging in die periode', isNum(priceRise) ? spct1(priceRise) : '–'],
        ['Rendement na inflatie', isNum(real) ? spct1(real) : '–', tone(real)],
        ['Je netto inleg na inflatie', isNum(dep) && isNum(priceRise) ? eur(dep / (1 + priceRise)) + ' koopkracht (van ' + eur(dep) + ')' : '–'],
      ]) +
      '<p class="sub" style="margin-top:8px">HICP-prijsindex (2025 = 100) van de ECB. De nieuwste maand kan ontbreken tot de ECB hem publiceert.</p></section>';
  }

  function drawMacro(root) {
    const fh = root.querySelector('[data-chart="fx"]');
    if (fh && data.fx) {
      const pts = data.fx.rates.USD.map(([d, v]) => ({ t: ymd(d), v }));
      lineChart(fh, [{ pts, color: C.accent, width: 2.5, area: true, alpha: 0.08, fmt: (v) => N4.format(v) + ' $' }], { top: 0.1, bottom: 0.1, xl: root.querySelector('[data-x="fx"]'), xcount: 3, xfmt: (t) => fMonY.format(t), tfmt: (t) => fD.format(t) });
    }
    const hh = root.querySelector('[data-chart="hicp"]');
    if (hh) {
      const nl = hicpSeries('NL').slice(-37), ez = hicpSeries('U2').slice(-37);
      if (nl.length > 1) lineChart(hh, [{ pts: nl, color: C.loss, width: 2.5, label: 'Nederland', fmt: (v) => N1.format(v) }, { pts: ez, color: C.ink2, dash: true, width: 2, label: 'Eurozone', fmt: (v) => N1.format(v) }],
        { top: 0.1, bottom: 0.1, xl: root.querySelector('[data-x="hicp"]'), xcount: 3, xfmt: (t) => fMonY.format(t), tfmt: (t) => fMonY.format(t) });
    }
  }


  // ---------- Risico: indicatie 1–7, bijdrage per positie, wat beweegt samen ----------
  // Indeling volgens de Europese SRRI-schaal (CESR/10-673) op jaarlijkse beweeglijkheid
  const SRRI = [0.005, 0.02, 0.05, 0.10, 0.15, 0.25];
  const srri = (vol) => (isNum(vol) ? 1 + SRRI.filter((b) => vol >= b).length : null);
  const RISK_WORDS = { 1: 'zeer laag', 2: 'laag', 3: 'laag tot gemiddeld', 4: 'gemiddeld', 5: 'verhoogd', 6: 'hoog', 7: 'zeer hoog' };
  const quantile = (a, q) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); const i = (b.length - 1) * q; const lo = Math.floor(i); return b[lo] + (b[Math.min(lo + 1, b.length - 1)] - b[lo]) * (i - lo); };

  // Euro per dollar per dag (ECB), om dollarkoersen naar euro om te rekenen
  function fxMap() {
    const m = new Map();
    ((data.fx && data.fx.rates && data.fx.rates.USD) || []).forEach(([d, v]) => m.set(d, v));
    return m;
  }

  // Dagkoersen van een positie in euro: eigen koershistorie (FMP), index voor fondsen (FRED), of eigen metingen
  function dailyEur(c, fx) {
    const days = [...fx.keys()].sort();
    const toEur = (pts, usd) => {
      if (!usd) return pts;
      if (!days.length) return pts; // geen wisselkoersen: in dollars laten
      let j = 0, last = null;
      return pts.map((p) => { while (j < days.length && days[j] <= p.day) { last = fx.get(days[j]); j++; } return last ? { day: p.day, v: p.v / last } : null; }).filter(Boolean);
    };
    const mk = M.mk;
    if (mk.ok) {
      const pts = mk.prices(mk.sym(c.tk));
      if (pts.length >= 120) { const prof = mk.profOf(c.tk); return { pts: toEur(pts, !prof || prof.currency === 'USD'), basis: 'koers' }; }
    }
    const b = BENCHES.find((x) => x[1].test(c.tk) || x[2].test(c.name));
    const id = b ? (b[0] === 'S&P 500' ? 'SP500' : b[0] === 'Nasdaq 100' ? 'NASDAQ100' : null) : null;
    const ser = id && data.idx && data.idx.series && data.idx.series[id];
    if (ser && ser.length >= 120) return { pts: toEur(ser.map(([d, v]) => ({ day: d, v })), true), basis: 'index ' + b[0] };
    const lday = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const own = seriesOf(c.tk).daily.map((d) => ({ day: lday(d.t), v: d.close })).filter((p) => { const g = new Date(p.day + 'T12:00:00').getDay(); return g > 0 && g < 6; });
    if (own.length >= 20) return { pts: own, basis: 'eigen metingen' };
    return null;
  }

  function riskModel() {
    if (M._risk) return M._risk;
    const fx = fxMap();
    const total = M.totalValue || 0;
    const items = M.companies.map((c) => {
      const s = dailyEur(c, fx);
      const rets = new Map();
      if (s) for (let i = 1; i < s.pts.length; i++) { const a = s.pts[i - 1].v, b2 = s.pts[i].v; if (a > 0 && b2 > 0) { const r = b2 / a - 1; if (Math.abs(r) < 0.5) rets.set(s.pts[i].day, r); } }
      const arr = [...rets.values()];
      const vol = arr.length >= 20 ? stdev(arr) * Math.sqrt(252) : null;
      return { c, w: total ? c.value / total : 0, basis: s ? s.basis : null, rets, n: arr.length, vol, cls: srri(vol) };
    });
    const withData = items.filter((x) => x.n >= 60);
    const coverage = sum(withData.map((x) => x.w));
    // Gesimuleerde portefeuille met de huidige verdeling (alleen posities met koershistorie, opnieuw gewogen)
    const daySet = new Set(); withData.forEach((x) => x.rets.forEach((_, d) => daySet.add(d)));
    const dayList = [...daySet].sort().slice(-260);
    const port = [];
    dayList.forEach((d) => {
      let sw = 0, sr = 0;
      withData.forEach((x) => { const r = x.rets.get(d); if (isNum(r)) { sw += x.w; sr += x.w * r; } });
      if (sw >= coverage * 0.8 && sw > 0) port.push({ day: d, r: sr / sw });
    });
    const pr = port.map((x) => x.r);
    const simVol = pr.length >= 60 ? stdev(pr) * Math.sqrt(252) : null;
    let idx = 1, peak = 1, mdd = 0; const simIdx = [];
    port.forEach((x) => { idx *= 1 + x.r; peak = Math.max(peak, idx); mdd = Math.min(mdd, idx / peak - 1); simIdx.push({ t: ymd(x.day), v: idx - 1 }); });
    const badDay = pr.length >= 60 ? quantile(pr, 0.05) : null;
    // Weekrendementen van je eigen portefeuille (zonder stortingen), zoals de officiële methode
    const wk = M.weeks.filter((w) => isNum(w.weekResultPct)).map((w) => w.weekResultPct);
    const wkVol = wk.length >= 4 ? stdev(wk) * Math.sqrt(52) : null;
    // Bijdrage aan het risico per positie (aandeel in de variantie van de gesimuleerde portefeuille)
    const pmap = new Map(port.map((x) => [x.day, x.r]));
    const varP = pr.length >= 60 ? stdev(pr) ** 2 : null;
    const sw0 = coverage || 1;
    items.forEach((x) => {
      if (!varP || x.n < 60) return;
      const pairs = []; x.rets.forEach((r, d) => { if (pmap.has(d)) pairs.push([r, pmap.get(d)]); });
      if (pairs.length < 40) return;
      const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
      const cov = sum(pairs.map(([a, b2]) => (a - mx) * (b2 - my))) / (pairs.length - 1);
      x.contrib = (x.w / sw0) * cov / varP;
      x.betaP = cov / varP;
    });
    // Samenhang tussen posities
    const corr = (a, b2) => {
      const pairs = []; a.rets.forEach((r, d) => { const q = b2.rets.get(d); if (isNum(q)) pairs.push([r, q]); });
      if (pairs.length < 40) return null;
      const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
      let sxy = 0, sxx = 0, syy = 0;
      pairs.forEach(([p, q]) => { sxy += (p - mx) * (q - my); sxx += (p - mx) ** 2; syy += (q - my) ** 2; });
      return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
    };
    const mat = withData.slice().sort((a, b2) => b2.w - a.w);
    const C2 = mat.map((a) => mat.map((b2) => (a === b2 ? 1 : corr(a, b2))));
    const useSim = isNum(simVol) && coverage >= 0.6;
    const vol = useSim ? simVol : isNum(wkVol) ? wkVol : simVol;
    const E = typeof usdExposure === 'function' ? usdExposure() : { total: 0 };
    const profBeta = M.mk.ok ? M.companies.map((c) => { const p = M.mk.profOf(c.tk); const isF = BENCHES.some((b) => b[1].test(c.tk) || b[2].test(c.name)); return { w: c.weight || 0, b: isF ? 1 : p && isNum(p.beta) && p.beta > 0 ? p.beta : null }; }) : [];
    const bw = sum(profBeta.filter((x) => isNum(x.b)).map((x) => x.w));
    const beta = bw > 0.5 ? sum(profBeta.filter((x) => isNum(x.b)).map((x) => x.w * x.b)) / bw : null;
    const fundsW = sum(M.companies.filter((c) => ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk))).map((c) => c.weight || 0));
    const ws = M.companies.map((c) => c.weight || 0);
    M._risk = { items, coverage, simVol, wkVol, wkN: wk.length, vol, cls: srri(vol), useSim, mdd: port.length ? mdd : null, simIdx, badDay, nDays: pr.length, days: port.map((x) => x.day), fx,
      mat, C2, usd: E.total && total ? E.total / total : null, beta, fundsW, top: Math.max(0, ...ws), effN: sum(ws.map((w) => w * w)) ? 1 / sum(ws.map((w) => w * w)) : null,
      missing: items.filter((x) => x.n < 60).map((x) => x.c.tk) };
    return M._risk;
  }

  function riskScale(cls) {
    return '<div class="srri" role="img" aria-label="' + esc('Risicoklasse ' + cls + ' van 7') + '">' + [1, 2, 3, 4, 5, 6, 7].map((k) =>
      '<span class="' + (k === cls ? 'on' : '') + '" style="--k:' + k + '">' + k + '</span>').join('') + '</div>' +
      '<div class="srri-l"><span>laag risico, meestal lager rendement</span><span>hoog risico, mogelijk hoger rendement</span></div>';
  }

  function riskTiles(plain) {
    const R = riskModel();
    const total = M.totalValue || 0;
    const ind = '<section class="tile pad risk-main"><h3>Risico-indicatie</h3>' +
      (R.cls ? '<div class="risk-head"><span class="v big">' + R.cls + '<small> van 7</small></span><span><b>' + esc(RISK_WORDS[R.cls]) + '</b><span class="muted small">beweeglijkheid ongeveer ' + esc(P1.format(R.vol)) + ' per jaar</span></span></div>' + riskScale(R.cls)
        : '<p class="muted">Nog te weinig gegevens voor een indicatie.</p>') +
      '<div style="margin-top:12px">' + kvList([
        ['Met je huidige verdeling, laatste jaar', isNum(R.simVol) ? P1.format(R.simVol) + ' per jaar (klasse ' + srri(R.simVol) + ')' : '–'],
        ['Je eigen weken (' + R.wkN + ')', isNum(R.wkVol) ? P1.format(R.wkVol) + ' per jaar (klasse ' + srri(R.wkVol) + ')' : 'na 4 weken'],
        ['Een slechte dag (1 op 20)', isNum(R.badDay) ? spct(R.badDay) + ', nu ongeveer ' + seur(R.badDay * total) : '–', 'loss'],
        ['Grootste daling in het laatste jaar', isNum(R.mdd) ? spct1(R.mdd) + ' van top tot dal' : '–', 'loss'],
      ]) + '</div>' +
      '<p class="sub" style="margin-top:8px">Indeling zoals de Europese risico-indicator voor fondsen (SRRI, 1 tot 7): hoe sterker de waarde schommelt, hoe hoger de klasse. ' +
        (R.useSim ? 'Berekend met je huidige verdeling over ' + R.nDays + ' handelsdagen, in euro.' : 'Berekend met je eigen weekrendementen; er is nog te weinig koershistorie van je posities.') +
        (R.missing.length ? ' Zonder koershistorie: ' + esc(R.missing.join(', ')) + ' (' + P1.format(1 - R.coverage) + ' van je beleggingen).' : '') +
        ' De officiële berekening gebruikt 5 jaar; dit is een indicatie, geen voorspelling.</p></section>';
    const indBtn = plain ? ind : clickable(ind, RISK, 'Risico-indicatie: bekijk wat het risico verlaagt', 'Wat het verlaagt');

    const fac = '<section class="tile pad"><h3>Waar het risico vandaan komt</h3>' + kvList([
      ['Grootste positie', R.top ? P1.format(R.top) + ' van je beleggingen' : '–', R.top > 0.3 ? 'loss' : ''],
      ['Spreiding', isNum(R.effN) ? 'als ' + N1.format(R.effN) + ' even grote posities' : '–', isNum(R.effN) && R.effN < 5 ? 'loss' : ''],
      ['In brede indexfondsen', P1.format(R.fundsW), R.fundsW < 0.3 ? 'loss' : 'gain'],
      ['Afhankelijk van de dollar', isNum(R.usd) ? P1.format(R.usd) : '–', isNum(R.usd) && R.usd > 0.8 ? 'loss' : ''],
      ['Gevoeligheid voor de markt (beta)', isNum(R.beta) ? N2.format(R.beta) + (R.beta > 1.1 ? ', sterker dan de markt' : R.beta < 0.9 ? ', rustiger dan de markt' : ', ongeveer als de markt') : '–'],
    ]) + (R.items.some((x) => isNum(x.contrib)) ? '<h3 style="margin-top:14px">Bijdrage per positie</h3><div class="hbars cmp">' +
      R.items.filter((x) => isNum(x.contrib)).sort((a, b2) => b2.contrib - a.contrib).slice(0, 8).map((x) => {
        const wd = Math.max(0, Math.min(1, x.contrib)) * 100;
        return '<div class="r" data-tip="' + esc(x.c.name + ': ' + P1.format(x.contrib) + ' van het risico bij ' + P1.format(x.w) + ' van de waarde') + '"><span class="tk">' + esc(x.c.tk) + '</span>' +
          '<span class="track solo"><span class="pos risk" style="left:0;width:' + wd.toFixed(1) + '%"></span><i class="wmark" style="left:' + (x.w / (R.coverage || 1) * 100).toFixed(1) + '%"></i></span>' +
          '<span style="text-align:right;font-weight:600">' + esc(P1.format(x.contrib)) + '</span></div>';
      }).join('') + '</div><p class="sub" style="margin-top:6px">Balk: aandeel in het totale risico. Streepje: aandeel in de waarde. Een balk voorbij het streepje betekent: meer risico dan gewicht.</p>' : '') + '</section>';

    // Wat beweegt samen
    let heat = '';
    if (R.mat.length >= 3) {
      const cellCls = (v) => (!isNum(v) ? 'na' : v >= 0.7 ? 'c4' : v >= 0.5 ? 'c3' : v >= 0.3 ? 'c2' : v >= 0.1 ? 'c1' : 'c0');
      const pairs = [];
      R.mat.forEach((a, i) => R.mat.forEach((b2, j) => { if (j > i && isNum(R.C2[i][j])) pairs.push([a.c.tk, b2.c.tk, R.C2[i][j]]); }));
      pairs.sort((a, b2) => b2[2] - a[2]);
      const avgC = R.mat.map((a, i) => ({ tk: a.c.tk, v: mean(R.C2[i].filter((v, j) => j !== i && isNum(v))) })).filter((x) => isNum(x.v)).sort((a, b2) => a.v - b2.v);
      heat = '<section class="tile pad corr-tile"><h3>Wat beweegt samen</h3><div class="corr" style="--n:' + R.mat.length + '">' +
        '<span></span>' + R.mat.map((x) => '<span class="ch">' + esc(x.c.tk) + '</span>').join('') +
        R.mat.map((a, i) => '<span class="rh">' + esc(a.c.tk) + '</span>' + R.mat.map((b2, j) =>
          '<span class="cell ' + (i === j ? 'self' : cellCls(R.C2[i][j])) + '" data-tip="' + esc(i === j ? a.c.tk : a.c.tk + ' en ' + b2.c.tk + ': ' + (isNum(R.C2[i][j]) ? N2.format(R.C2[i][j]) : 'te weinig gegevens')) + '"></span>').join('')).join('') + '</div>' +
        '<div class="heat-key" style="margin-top:10px">los van elkaar <i class="c0"></i><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i> sterk samen</div>' +
        '<div style="margin-top:10px">' + kvList([
          ['Bewegen het meest samen', pairs[0] ? pairs[0][0] + ' en ' + pairs[0][1] + ' (' + N2.format(pairs[0][2]) + ')' : '–'],
          ['Beste spreider', avgC[0] ? avgC[0].tk + ' (gemiddeld ' + N2.format(avgC[0].v) + ')' : '–', 'gain'],
          ['Gemiddelde samenhang', avgC.length ? N2.format(mean(avgC.map((x) => x.v))) : '–'],
        ]) + '</div><p class="sub" style="margin-top:8px">Correlatie van de dagrendementen in euro over het laatste jaar, van −1 (tegengesteld) tot 1 (precies samen). Posities die sterk samen bewegen, spreiden je risico weinig.</p></section>';
    } else heat = '<section class="tile pad"><h3>Wat beweegt samen</h3><p class="muted">Hiervoor is van minstens 3 posities koershistorie nodig. Die komt van FMP (koersen), FRED (indexen) of de eigen metingen van de tracker.</p></section>';
    return [indBtn, fac, heat];
  }

  function companyRisk(c) {
    const R = riskModel();
    const x = R.items.find((i) => i.c.tk === c.tk);
    if (!x || !isNum(x.vol)) return null;
    return { cls: x.cls, vol: x.vol, contrib: x.contrib, basis: x.basis };
  }

  // ---------- Desktop ----------
  function renderHome() {
    const T = M.tot;
    $('hero-label').textContent = 'Waarde beleggingen, ' + (M.lastT ? fDT.format(M.lastT) : 'laatste meting');
    countTo($('hero-value'), M.totalValue, eur);
    const ch = $('hero-change');
    ch.textContent = changeLine(T) + (isNum(T.change) ? ', ' + baseText(T) : '');
    ch.className = 'hero-change ' + (isNum(T.change) ? tone(T.change) : 'muted');
    drawHero('', false);

    fill('kpis', kpiCards());

    const withChange = M.companies.filter((c) => isNum(c.change));
    const up = withChange.filter((c) => c.change > 0).length, down = withChange.filter((c) => c.change < 0).length;
    $('breadth').innerHTML = withChange.length ? split(up, down) + esc(up + ' gestegen, ' + down + ' gedaald') : '';
    $('link-all').textContent = 'Alle ' + M.companies.length + ' bedrijven bekijken';
    $('movers-title').textContent = 'Stijgers, markt en dalers ' + M.dayWord;
    const mv = moversModel();
    const moverTile = (c, kind) =>
      '<button type="button" class="tile" data-ticker="' + esc(c.tk) + '" aria-label="' + esc(c.name + ', ' + spct(c.changePct) + ' ' + M.dayWord + '. Inzoomen') + '">' +
        '<span class="row"><span class="tk">' + esc(c.tk) + '</span><span class="tag ' + tone(c.changePct) + '">' + esc(kind) + '</span></span>' +
        '<span class="nm">' + esc(c.name) + '</span>' +
        '<span class="v big ' + tone(c.changePct) + '">' + esc(spct(c.changePct)) + '</span>' +
        '<span class="sub"><b class="' + tone(c.change) + '">' + esc(seur(c.change)) + '</b> op ' + esc(eur(c.value)) + '</span>' +
        spark(seriesFor(c.tk, 'today'), toneColor(c.changePct), 'spark tall') + '</button>';
    fill('movers', mv.up.length ? mv.up.map((c) => moverTile(c, c.changePct > 0 ? 'Stijger' : 'Beste')).concat([marketTile(mv)], mv.down.map((c) => moverTile(c, c.changePct < 0 ? 'Daler' : 'Zwakste')))
      : ['<p class="empty">Nog geen metingen van vandaag.</p>']);

    fill('agenda', agendaTiles());
    fill('sectors', sectorTiles());
    fill('macro', [fxTile(), inflationTile()]);
    drawMacro($('macro'));
    fill('risk', riskTiles());
    fill('weeks', weekCards());
    drawWeekChart($('weeks'));
    const S = statsFor(TOTAL);
    fill('patterns', patternTiles(TOTAL, S));
    $('stats-note').textContent = statsNote(S);
    fill('stats', statCards(S));
  }

  function moversModel() {
    const bench = M.bench;
    const pool = M.companies.filter((c) => isNum(c.changePct) && (!bench || c.tk !== bench.c.tk));
    const byPct = pool.slice().sort((a, b) => b.changePct - a.changePct);
    const up = byPct.slice(0, 2);
    const down = byPct.slice(-2).reverse().filter((c) => !up.includes(c));
    // Portefeuille over dezelfde periode als de marktmaatstaf
    let mine = M.tot.changePct;
    if (bench && bench.c.base && M.tot.base && bench.c.base.kind !== M.tot.base.kind) {
      const k = M.lastT == null ? null : dayKey(M.lastT);
      const pts = (M.intra.get(TOTAL) || []).filter((p) => dayKey(p.t) === k);
      mine = pts.length > 1 && pts[0].v > 0 ? pts[pts.length - 1].v / pts[0].v - 1 : null;
    }
    return { up, down, bench, mine, diff: bench && isNum(mine) && isNum(bench.c.changePct) ? mine - bench.c.changePct : null };
  }

  function vsMarket(mv) {
    if (!isNum(mv.diff)) return '';
    const pp = N2.format(Math.abs(mv.diff * 100)) + ' procentpunt';
    return 'Jouw portefeuille ' + spct(mv.mine) + ': ' + (Math.abs(mv.diff) < 0.0005 ? 'gelijk aan de markt' : pp + (mv.diff > 0 ? ' beter' : ' slechter'));
  }

  function marketTile(mv) {
    if (!mv.bench) {
      return '<section class="tile market pad"><span class="row"><span class="tk">Markt</span></span>' +
        '<span class="sub">Geen indexfonds (zoals een S&amp;P 500-ETF) in je portefeuille gevonden om de markt mee te meten.</span></section>';
    }
    const b = mv.bench.c;
    return '<button type="button" class="tile market" data-ticker="' + esc(b.tk) + '" aria-label="' + esc('Markt, ' + mv.bench.label + ', ' + spct(b.changePct) + '. Inzoomen op ' + b.name) + '">' +
      '<span class="row"><span class="tk">Markt</span><span class="tag">' + esc(mv.bench.label) + '</span></span>' +
      '<span class="nm">gemeten via ' + esc(b.tk) + ', in euro</span>' +
      '<span class="v big ' + tone(b.changePct) + '">' + esc(spct(b.changePct)) + '</span>' +
      '<span class="sub">' + esc(vsMarket(mv)) + '</span>' +
      spark(seriesFor(b.tk, 'today'), C.accent, 'spark tall') + '</button>';
  }

  const SORTS = [['move', 'Verandering'], ['value', 'Waarde'], ['result', 'Sinds aankoop'], ['name', 'Naam']];
  const FILTERS = [['all', 'Alle'], ['up', 'Gestegen'], ['down', 'Gedaald']];
  const SPANS = [['today', 'Vandaag'], ['1m', '30 dagen'], ['all', 'Alles']];

  function sortedCompanies() {
    const by = {
      move: (x, y) => Math.abs(y.change || 0) - Math.abs(x.change || 0),
      value: (x, y) => y.value - x.value,
      result: (x, y) => (y.resultPct ?? -9) - (x.resultPct ?? -9),
      name: (x, y) => x.tk.localeCompare(y.tk),
    }[ui.listSort];
    return M.companies.slice().sort(by);
  }

  function filteredCompanies() {
    const q = ui.listQuery.trim().toLowerCase();
    return sortedCompanies().filter((c) =>
      (ui.listFilter === 'all' || (ui.listFilter === 'up' ? c.change > 0 : c.change < 0)) &&
      (!q || c.tk.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)));
  }

  function listSummary() {
    const all = M.companies;
    const up = all.filter((c) => c.change > 0).length, down = all.filter((c) => c.change < 0).length;
    return all.length + ' posities, samen ' + eur(M.totalValue) + '. ' + up + ' gestegen en ' + down + ' gedaald ' + M.dayWord + '.';
  }

  function renderList() {
    $('list-sub').textContent = listSummary();
    segButtons($('list-filter'), FILTERS, ui.listFilter, (k) => { ui.listFilter = k; renderList(); });
    segButtons($('list-sort'), SORTS, ui.listSort, (k) => { ui.listSort = k; renderList(); });
    segButtons($('list-span'), SPANS, ui.listSpan, (k) => { ui.listSpan = k; renderList(); });
    const items = filteredCompanies();
    fill('list-grid', items.length ? items.map((c) => {
      const pts = seriesFor(c.tk, ui.listSpan);
      const delta = ui.listSpan === 'today' ? c.change : pts.length > 1 ? pts[pts.length - 1].v - pts[0].v : c.change;
      return '<button type="button" class="tile" data-ticker="' + esc(c.tk) + '" aria-label="' + esc(c.name + ', ' + eur(c.value) + ', ' + spct(c.changePct) + ' ' + M.dayWord + '. Inzoomen') + '">' +
        '<span class="row"><span class="tk">' + esc(c.tk) + '</span><b class="' + tone(c.change) + '">' + esc(spct(c.changePct)) + '</b></span>' +
        '<span class="nm">' + esc(c.name) + '</span>' +
        '<span class="row" style="margin-top:8px"><span class="v" style="font-size:22px">' + esc(eur(c.value)) + '</span><span class="sub">' + esc(isNum(c.weight) ? P1.format(c.weight) + ' van totaal' : '') + '</span></span>' +
        '<span class="sub">Sinds aankoop <b class="' + tone(c.resultPct) + '">' + esc(spct1(c.resultPct)) + '</b></span>' +
        spark(pts, toneColor(delta)) + '</button>';
    }) : ['<p class="empty">Geen bedrijven gevonden' + (ui.listQuery ? ' voor “' + esc(ui.listQuery) + '”' : '') + '.</p>']);
  }

  $('list-search').addEventListener('input', (e) => { ui.listQuery = e.target.value; if (M) renderList(); });

  function detailNav(c) {
    const order = sortedCompanies();
    const i = order.findIndex((x) => x.tk === c.tk);
    return { prev: order[(i - 1 + order.length) % order.length], next: order[(i + 1) % order.length] };
  }

  function renderDetailDesktop(c, swapDir) {
    const { prev, next } = detailNav(c);
    const I = companyInfo(c);
    const sw = swapDir ? ' swap-' + swapDir : '';
    return '<div class="band">' +
        '<div class="d-top"><button type="button" class="btn dark" data-act="back">← Terug</button>' +
          '<div class="d-nav"><button type="button" class="btn line" data-act="compare">Vergelijken</button><button type="button" class="btn line" data-act="prev" aria-label="Vorige: ' + esc(prev.name) + '">← ' + esc(prev.tk) + '</button>' +
          '<button type="button" class="btn line" data-act="next" aria-label="Volgende: ' + esc(next.name) + '">' + esc(next.tk) + ' →</button></div></div>' +
        '<div class="hero-head' + sw + '"><div><p class="hero-label">' + esc(c.name) + '</p>' +
          '<h2 id="d-title" class="hero-value">' + esc(c.tk) + ' ' + esc(eur(c.value)) + '</h2>' +
          '<p class="hero-change ' + tone(c.change) + '">' + esc(changeLine(c) + ', ' + baseText(c)) + '</p></div>' +
          '<div class="hero-ctrl"><div id="d-ranges" class="seg" role="group" aria-label="Periode van de grafiek"></div>' +
          '<label class="check"><input type="checkbox" id="d-compare"' + (ui.compare ? ' checked' : '') + '> Vergelijk met portefeuille</label></div></div>' +
        '<div id="d-chart" class="chart hero-chart" role="img" aria-label="' + esc('Verloop van ' + c.name) + '"></div>' +
        '<div id="d-legend"></div><div id="d-x" class="xlabels"></div><p id="d-note" class="chart-note"></p>' +
      '</div>' +
      '<div class="wrap' + sw + '">' +
        '<div class="grid">' + I.kpis.join('') + '</div>' +
        '<div class="grid wide" style="margin-top:16px">' + I.rangeTile + I.posTile + I.tradeTile + I.histTile + I.agendaTile + I.riskTile + valuationTile(c) + overlapTileC(c) + '</div>' +
        '<div class="section-head"><h2>Nieuws, analisten en cijfers</h2></div>' +
        '<div class="grid wide">' + I.research.join('') + '</div>' +
        '<div class="section-head"><h2>Sector en vergelijkbare bedrijven</h2></div>' +
        '<div class="grid wide">' + I.market.tiles.join('') + '</div>' +
        (I.market.table ? '<div style="margin-top:16px">' + I.market.table + '</div>' : '') +
        '<div class="section-head"><h2>Patronen</h2></div>' +
        '<div class="grid">' + I.patterns.join('') + '</div>' +
        '<p class="foot">' + esc(FOOT) + '</p>' +
      '</div>';
  }

  // ---------- Telefoon ----------
  function mRow(c, pts, right) {
    return '<button type="button" class="m-row" data-ticker="' + esc(c.tk) + '" aria-label="' + esc(c.name + ', ' + eur(c.value) + ', ' + spct(c.changePct) + ' ' + M.dayWord + '. Openen') + '">' +
      '<span class="l"><span class="tk">' + esc(c.tk) + '</span><span class="nm">' + esc(c.name) + '</span></span>' +
      spark(pts, toneColor(right.tone), 'mspark') +
      '<span class="rt"><b>' + esc(right.top) + '</b><span class="chip-chg ' + tone(right.tone) + '">' + esc(right.bottom) + '</span></span></button>';
  }

  function renderMHome() {
    const T = M.tot;
    $('m-hero-label').textContent = 'Waarde beleggingen, ' + (M.lastT ? fDT.format(M.lastT) : 'laatste meting');
    countTo($('m-hero-value'), M.totalValue, eur);
    $('m-hero-change').innerHTML = isNum(T.change)
      ? '<span class="pill-chg ' + tone(T.change) + '">' + esc(changeLine(T)) + '</span><span class="base" style="padding:6px 0 0">' + esc(baseText(T)) + '</span>'
      : '<span class="pill-chg">Nog geen metingen van vandaag</span>';
    drawHero('m-', false);

    fill('m-kpis', kpiCards());
    const withChange = M.companies.filter((c) => isNum(c.change));
    const up = withChange.filter((c) => c.change > 0).length, down = withChange.filter((c) => c.change < 0).length;
    $('m-breadth').innerHTML = withChange.length ? split(up, down) + esc(up + ' omhoog, ' + down + ' omlaag') : '';
    $('m-movers-title').textContent = 'Stijgers, markt en dalers';
    const mv = moversModel();
    const row = (c) => mRow(c, seriesFor(c.tk, 'today'), { top: spct(c.changePct), bottom: seur(c.change), tone: c.changePct });
    let market = '';
    if (mv.bench) {
      const b = mv.bench.c;
      market = '<button type="button" class="m-row market" data-ticker="' + esc(b.tk) + '" aria-label="' + esc('Markt, ' + mv.bench.label + ', ' + spct(b.changePct)) + '">' +
        '<span class="l"><span class="tk">Markt: ' + esc(mv.bench.label) + '</span><span class="nm">' + esc(isNum(mv.diff) ? 'Jij ' + spct(mv.mine) + ', ' + N2.format(Math.abs(mv.diff * 100)) + ' pp ' + (mv.diff >= 0 ? 'beter' : 'slechter') : 'via ' + b.tk) + '</span></span>' +
        spark(seriesFor(b.tk, 'today'), C.accent, 'mspark') +
        '<span class="rt"><b class="' + tone(b.changePct) + '">' + esc(spct(b.changePct)) + '</b><span class="chip-chg">via ' + esc(b.tk) + '</span></span></button>';
    }
    fill('m-movers', (mv.up.length ? mv.up.map(row).concat(market ? [market] : [], mv.down.map(row))
      : ['<p class="m-sub" style="padding:16px">Nog geen metingen van vandaag.</p>'])
      .concat(['<a class="m-more" href="#bedrijven">Alle ' + M.companies.length + ' bedrijven</a>']));
    fill('m-agenda', agendaTiles());
    fill('m-weeks', weekCards());
    drawWeekChart($('m-weeks'));
  }

  const M_CHIPS = [['sort', 'move', 'Verandering'], ['sort', 'value', 'Waarde'], ['sort', 'result', 'Sinds aankoop'], ['sort', 'name', 'Naam'], ['sep'],
    ['filter', 'up', 'Gestegen'], ['filter', 'down', 'Gedaald'], ['sep'], ['span', 'today', 'Vandaag'], ['span', '1m', '30 dagen'], ['span', 'all', 'Alles']];

  function renderMList() {
    $('m-list-sub').textContent = listSummary();
    const chips = $('m-chips');
    chips.innerHTML = M_CHIPS.map((ch) => {
      if (ch[0] === 'sep') return '<span class="sep" aria-hidden="true"></span>';
      const on = ch[0] === 'sort' ? ui.listSort === ch[1] : ch[0] === 'filter' ? ui.listFilter === ch[1] : ui.listSpan === ch[1];
      const lbl = ch[0] === 'span' ? 'Grafiek ' + ch[2].toLowerCase() : ch[2];
      return '<button type="button" data-g="' + ch[0] + '" data-k="' + ch[1] + '" aria-pressed="' + on + '">' + esc(lbl) + '</button>';
    }).join('');
    chips.onclick = (e) => {
      const b = e.target.closest('button[data-g]');
      if (!b) return;
      const g = b.dataset.g, k = b.dataset.k;
      if (g === 'sort') ui.listSort = k;
      else if (g === 'filter') ui.listFilter = ui.listFilter === k ? 'all' : k;
      else ui.listSpan = k;
      renderMList();
    };
    const items = filteredCompanies();
    fill('m-list-rows', items.length ? items.map((c) => {
      const pts = seriesFor(c.tk, ui.listSpan);
      const delta = ui.listSpan === 'today' ? c.change : pts.length > 1 ? pts[pts.length - 1].v - pts[0].v : c.change;
      const bottom = ui.listSort === 'result' ? spct1(c.resultPct) : spct(c.changePct);
      return mRow(c, pts, { top: eur(c.value), bottom, tone: ui.listSort === 'result' ? c.resultPct : delta });
    }) : ['<p class="m-sub" style="padding:16px">Geen bedrijven gevonden' + (ui.listQuery ? ' voor “' + esc(ui.listQuery) + '”' : '') + '.</p>']);
  }

  $('m-search').addEventListener('input', (e) => { ui.listQuery = e.target.value; if (M) renderMList(); });

  function renderMStats() {
    const S = statsFor(TOTAL);
    $('m-stats-note').textContent = statsNote(S);
    fill('m-stat-cards', statCards(S));
    fill('m-sectors', sectorTiles());
    fill('m-macro', [fxTile(), inflationTile()]);
    drawMacro($('m-macro'));
    fill('m-risk', riskTiles());
    fill('m-patterns', patternTiles(TOTAL, S));
  }

  function renderDetailMobile(c, swapDir) {
    const { prev, next } = detailNav(c);
    const I = companyInfo(c);
    const sw = swapDir ? ' swap-' + swapDir : '';
    const tabs = [['pos', 'Positie'], ['res', 'Onderzoek'], ['cmp', 'Vergelijk'], ['hist', 'Historie'], ['pat', 'Patronen']];
    const panel = ui.mTab === 'hist' ? I.histTile : ui.mTab === 'pat' ? '<div class="m-stack">' + I.patterns.join('') + '</div>'
      : ui.mTab === 'cmp' ? I.riskTile + valuationTile(c) + overlapTileC(c) + '<button type="button" class="btn ghost" data-act="compare">Naast een ander aandeel zetten</button>' + I.market.tiles.join('') + I.market.table
      : ui.mTab === 'res' ? I.research.join('') : I.rangeTile + I.posTile + I.tradeTile + I.agendaTile;
    return '<div class="md">' +
      '<div class="m-dtop"><button type="button" class="m-back" data-act="back">‹ Terug</button><span class="t">' + esc(c.tk) + '</span>' +
        '<div class="m-nav"><button type="button" data-act="prev" aria-label="Vorige: ' + esc(prev.name) + '">‹</button><button type="button" data-act="next" aria-label="Volgende: ' + esc(next.name) + '">›</button></div></div>' +
      '<div class="m-hero">' +
        '<div class="m-swipe' + sw + '"><p class="hero-label">' + esc(c.name) + '</p><h2 id="d-title" class="m-value">' + esc(eur(c.value)) + '</h2>' +
          '<p><span class="pill-chg ' + tone(c.change) + '">' + esc(changeLine(c)) + '</span></p><span class="base">' + esc(baseText(c)) + '</span></div>' +
        '<div id="d-chart" class="chart m-chart" role="img" aria-label="' + esc('Verloop van ' + c.name) + '"></div><div id="d-x" class="xlabels"></div>' +
        '<div id="d-ranges" class="m-seg" role="group" aria-label="Periode van de grafiek"></div>' +
        '<label class="check"><input type="checkbox" id="d-compare"' + (ui.compare ? ' checked' : '') + '> Vergelijk met portefeuille</label>' +
        '<div id="d-legend"></div><p id="d-note" class="chart-note"></p>' +
      '</div>' +
      '<div class="m-body' + sw + '">' +
        '<div class="m-grid2">' + I.kpis.join('') + '</div>' +
        '<div class="m-dtabs" role="tablist" aria-label="Onderdelen" style="margin-top:16px">' + tabs.map(([k, l]) =>
          '<button type="button" role="tab" data-tab="' + k + '" aria-selected="' + (ui.mTab === k) + '">' + l + '</button>').join('') + '</div>' +
        '<div class="m-stack" role="tabpanel">' + panel + '</div>' +
        '<p class="foot">' + esc(FOOT) + '</p>' +
      '</div></div>';
  }

  // ---------- Accountwaarde: waar zit je geld? ----------
  const ACC = '@account';
  const RISK = '@risk', RES = '@result', DEP = '@deposits';
  const CMP = '@compare';
  const PSEUDO = { '@account': 'accountwaarde', '@risk': 'risico', '@result': 'resultaat', '@deposits': 'stortingen', '@compare': 'vergelijken' };
  const isPseudo = (k) => Object.prototype.hasOwnProperty.call(PSEUDO, k);
  const hasView = (k) => isPseudo(k) || (M && M.byTk.has(k)) || (isWatchKey(k) && M && watchSyms().includes(k.slice(1)));
  const viewHash = (k) => (isPseudo(k) ? '#' + PSEUDO[k] : isWatchKey(k) ? '#volg/' + encodeURIComponent(k.slice(1)) : '#bedrijf/' + encodeURIComponent(k));
  const PIE = ['#1E3A8A', '#2B5BD7', '#5B86E5', '#8FAEF0', '#0E7490', '#4FB3C8', '#6D28D9', '#A78BFA'];
  const CASH = '#0B7A4B', REST = '#C9CED6';
  const ETF_RE = /\bETF\b|UCITS|\((Acc|Dist)\)|iShares|Vanguard|Xtrackers|Amundi|SPDR|Invesco|Lyxor/i;

  function donut(slices, c1, c2, label) {
    const tot = sum(slices.map((x) => x.v)) || 1;
    const gap = slices.length > 1 ? 0.5 : 0;
    let acc = 0;
    const arcs = slices.map((x) => {
      const pct = (x.v / tot) * 100;
      const len = Math.max(0.01, pct - gap);
      const off = 25 - acc;
      acc += pct;
      return '<circle r="15.915" cx="21" cy="21" fill="none" stroke="' + x.color + '" stroke-width="5.4" stroke-dasharray="' + len.toFixed(3) + ' ' + (100 - len).toFixed(3) +
        '" stroke-dashoffset="' + off.toFixed(3) + '" data-tip="' + esc(x.label + ': ' + eur(x.v) + ' (' + P1.format(x.v / tot) + ')') + '"></circle>';
    }).join('');
    return '<div class="donut"><svg viewBox="0 0 42 42" role="img" aria-label="' + esc(label) + '">' + arcs + '</svg>' +
      '<div class="donut-c"><b>' + esc(c1) + '</b><span>' + esc(c2) + '</span></div></div>';
  }

  function renderAccount() {
    const total = M.accountNow;
    const cash = M.cash || 0;
    const sorted = M.companies.slice().sort((a, b) => b.value - a.value);
    const own = sorted.slice(0, PIE.length), rest = sorted.slice(PIE.length);
    const restV = sum(rest.map((c) => c.value));
    const slices = own.map((c, i) => ({ label: c.tk + ' ' + c.name, v: c.value, color: PIE[i], tk: c.tk }));
    if (rest.length) slices.push({ label: 'Overige ' + rest.length + ' posities', v: restV, color: REST });
    if (cash > 0) slices.push({ label: 'Vrij saldo', v: cash, color: CASH });
    const pctOf = (v) => (total ? P1.format(v / total) : '–');
    const legend = '<div class="legend-list">' + sorted.map((c, i) =>
      '<button type="button" data-open="' + esc(c.tk) + '"><i style="background:' + (i < PIE.length ? PIE[i] : REST) + '"></i>' +
      '<span class="nm">' + esc(c.tk) + ' <span class="muted">' + esc(c.name) + '</span></span>' +
      '<span class="muted small">' + esc(eur(c.value)) + '</span><b style="min-width:52px;text-align:right">' + esc(pctOf(c.value)) + '</b></button>').join('') +
      (cash > 0 ? '<div class="legend-row"><i style="background:' + CASH + '"></i><span class="nm">Vrij saldo</span><span class="muted small">' + esc(eur(cash)) + '</span><b style="min-width:52px;text-align:right">' + esc(pctOf(cash)) + '</b></div>' : '') + '</div>';

    const etf = sum(M.companies.filter((c) => ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk))).map((c) => c.value));
    const stocks = M.totalValue - etf;
    const kinds = [{ label: 'Fondsen (ETF’s)', v: etf, color: '#1E3A8A' }, { label: 'Losse aandelen', v: stocks, color: '#8FAEF0' }];
    if (cash > 0) kinds.push({ label: 'Vrij saldo', v: cash, color: CASH });
    const kindLegend = '<div class="legend-list">' + kinds.filter((k) => k.v > 0).map((k) =>
      '<div class="legend-row"><i style="background:' + k.color + '"></i><span class="nm">' + esc(k.label) + '</span><span class="muted small">' + esc(eur(k.v)) + '</span><b style="min-width:52px;text-align:right">' + esc(pctOf(k.v)) + '</b></div>').join('') + '</div>';

    const pl = M.companies.filter((c) => isNum(c.unreal)).sort((a, b) => b.unreal - a.unreal);
    const mx = Math.max(1e-9, ...pl.map((c) => Math.abs(c.unreal)));
    const plBars = '<div class="hbars">' + pl.map((c) => {
      const w = (Math.abs(c.unreal) / mx * 50).toFixed(1) + '%';
      return '<button type="button" class="r" data-open="' + esc(c.tk) + '" data-tip="' + esc(c.name + ': ' + seur(c.unreal) + ' (' + spct1(c.resultPct) + ')') + '">' +
        '<span class="tk">' + esc(c.tk) + '</span><span class="track"><span class="mid"></span><span class="' + (c.unreal < 0 ? 'neg' : 'pos') + '" style="width:' + w + '"></span></span>' +
        '<span class="' + tone(c.unreal) + '" style="text-align:right;font-weight:600">' + esc(seur(c.unreal)) + '</span></button>';
    }).join('') + '</div>';

    const lw = M.lastWeek;
    const unreal = sum(pl.map((c) => c.unreal));
    const facts = kvList([
      ['Beleggingen nu', eur(M.totalValue)],
      ['Vrij saldo', M.cash != null ? eur(cash) + ' (stand ' + fDM.format(lw.t) + ')' : 'na de eerste weekmeting'],
      ['Netto gestort', lw ? eur(lw.netDeposits) : '–'],
      ['Resultaat nu', lw ? seur(total - lw.netDeposits) + ' (' + spct1((total - lw.netDeposits) / lw.netDeposits) + ')' : '–', lw ? tone(total - lw.netDeposits) : ''],
      ['Ongerealiseerd', seur(unreal), tone(unreal)],
      ['Posities', String(M.companies.length)],
      ['Grootste positie', sorted[0] ? sorted[0].tk + ', ' + pctOf(sorted[0].value) : '–'],
    ]);

    const secTile = (M.mk.ok ? sectorTiles()[0] : '') + accountsSummaryTile();
    const tiles = [
      '<section class="tile pad"><h3>Verdeling over posities</h3>' + donut(slices, eur(total), 'accountwaarde', 'Verdeling van je accountwaarde over posities en vrij saldo') + legend + '</section>',
      '<section class="tile pad"><h3>Soort belegging</h3>' + donut(kinds.filter((k) => k.v > 0), pctOf(etf), 'in fondsen', 'Verdeling over fondsen, losse aandelen en vrij saldo') + kindLegend +
        '<p class="sub" style="margin-top:10px">Fondsen herkend aan de naam (ETF, UCITS, iShares, Vanguard en dergelijke).</p></section>',
      '<section class="tile pad"><h3>Winst en verlies per positie</h3>' + plBars + '<p class="sub" style="margin-top:10px">Ongerealiseerd resultaat ten opzichte van wat je erin hebt gestoken. Klik op een positie voor de details.</p></section>',
      '<section class="tile pad"><h3>In cijfers</h3>' + facts + '</section>',
    ];
    const head = '<p class="hero-label">Accountwaarde nu</p><h2 id="d-title" class="' + (mode === 'm' ? 'm-value' : 'hero-value') + '">' + esc(eur(total)) + '</h2>' +
      '<p class="' + (mode === 'm' ? 'base' : 'hero-change muted') + '" style="' + (mode === 'm' ? 'padding:6px 0 0' : '') + '">' +
      esc(M.cash != null ? 'Beleggingen ' + eur(M.totalValue) + ' nu, plus ' + eur(cash) + ' vrij saldo uit de weekmeting van ' + fDM.format(lw.t) + '.' : 'Alleen beleggingen; het vrije saldo komt uit de weekmeting.') + '</p>';
    if (mode === 'm') {
      return '<div class="md"><div class="m-dtop"><button type="button" class="m-back" data-act="back">‹ Terug</button><span class="t">Accountwaarde</span><span></span></div>' +
        '<div class="m-hero"><div class="m-swipe">' + head + '</div></div>' +
        '<div class="m-body"><div class="m-stack">' + tiles.slice(0, 2).join('') + secTile + tiles.slice(2).join('') + realisedTile() + '</div></div></div>';
    }
    return '<div class="band" style="padding-bottom:24px"><div class="d-top"><button type="button" class="btn dark" data-act="back">← Terug</button></div>' +
      '<div class="hero-head"><div>' + head + '</div></div></div>' +
      '<div class="wrap"><div class="grid wide">' + tiles.slice(0, 2).join('') + secTile + '</div><div class="grid wide" style="margin-top:16px">' + tiles[2] + tiles[3] + realisedTile() + '</div></div>';
  }

  // ---------- Uitklapweergaven: risico, resultaat, stortingen ----------
  function pseudoPage(title, head, desk, mob) {
    if (mode === 'm') {
      return '<div class="md"><div class="m-dtop"><button type="button" class="m-back" data-act="back">‹ Terug</button><span class="t">' + esc(title) + '</span><span></span></div>' +
        '<div class="m-hero"><div class="m-swipe">' + head + '</div></div>' +
        '<div class="m-body"><div class="m-stack">' + (mob || desk.flat()).join('') + '</div></div></div>';
    }
    return '<div class="band" style="padding-bottom:24px"><div class="d-top"><button type="button" class="btn dark" data-act="back">← Terug</button></div>' +
      '<div class="hero-head"><div>' + head + '</div></div></div>' +
      '<div class="wrap">' + desk.map((row) => '<div class="grid wide" style="margin-top:16px">' + row.join('') + '</div>').join('') + '</div>';
  }
  function pseudoHead(label, value, sub, cls) {
    return '<p class="hero-label">' + esc(label) + '</p><h2 id="d-title" class="' + (mode === 'm' ? 'm-value' : 'hero-value') + (cls ? ' ' + cls : '') + '">' + esc(value) + '</h2>' +
      '<p class="' + (mode === 'm' ? 'base' : 'hero-change muted') + '" style="' + (mode === 'm' ? 'padding:6px 0 0' : '') + '">' + esc(sub) + '</p>';
  }

  const isFundC = (c) => ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk));

  // Rekenvoorbeelden: hoe verandert de beweeglijkheid als de verdeling anders is (koersen van het laatste jaar)
  function riskIdeas(R) {
    const total = M.totalValue || 0;
    const out = [];
    const hist = R.items.filter((x) => x.n >= 60);
    // Bestemming in de voorbeelden: een breed indexfonds dat je al hebt, anders de S&P 500 (FRED) in euro
    const ownIdx = hist.find((x) => BENCHES.some((b) => b[1].test(x.c.tk) || b[2].test(x.c.name)) && !/nasdaq/i.test(x.c.name) && !BENCHES[1][1].test(x.c.tk));
    let idxR = ownIdx ? ownIdx.rets : null, idxName = ownIdx ? ownIdx.c.tk : 'een breed indexfonds (S&P 500)';
    if (!idxR && data.idx && data.idx.series && data.idx.series.SP500) {
      const days = [...R.fx.keys()].sort(); let j = 0, last = null, prev = null; idxR = new Map();
      data.idx.series.SP500.forEach(([d, v]) => { while (j < days.length && days[j] <= d) { last = R.fx.get(days[j]); j++; } if (!last) return; const e = v / last; if (prev) { const r = e / prev - 1; if (Math.abs(r) < 0.5) idxR.set(d, r); } prev = e; });
      if (idxR.size < 60) idxR = null;
    }
    const sim = (wOf, wIdx) => {
      const ws = hist.map((x) => [x, wOf(x)]);
      const totW = sum(ws.map((p) => p[1])) + (idxR && wIdx ? wIdx : 0);
      const rs = [];
      R.days.forEach((d) => {
        let sw = 0, sr = 0;
        ws.forEach(([x, w]) => { if (!w) return; const r = x.rets.get(d); if (isNum(r)) { sw += w; sr += w * r; } });
        if (idxR && wIdx) { const r = idxR.get(d); if (isNum(r)) { sw += wIdx; sr += wIdx * r; } }
        if (sw > 0 && sw >= totW * 0.8) rs.push(sr / sw);
      });
      return rs.length >= 60 ? stdev(rs) * Math.sqrt(252) : null;
    };
    const base = R.days && R.days.length >= 60 ? sim((x) => x.w, 0) : null;
    const canIdx = !!idxR && isNum(base);
    const monthly = isNum(M.settings && M.settings.monthly) && M.settings.monthly > 0 ? M.settings.monthly : (typeof monthlyGuess === 'function' ? monthlyGuess() : null);
    const viaInleg = (D, where) => (D > 0 ? ' Zonder te verkopen: ongeveer ' + eur(D) + ' nieuwe inleg ' + (where || 'in andere posities') + (isNum(monthly) && monthly > 0 ? ', ' + Math.max(1, Math.ceil(D / monthly)) + ' maanden bij ' + eur(monthly) + ' per maand' : '') + '.' : '');
    const stocks = M.companies.filter((c) => !isFundC(c));

    // 1. Grootste aanjager van het risico
    const drv = R.items.filter((x) => isNum(x.contrib) && !isFundC(x.c) && x.w >= 0.04).sort((a, b) => (b.contrib - b.w / (R.coverage || 1)) - (a.contrib - a.w / (R.coverage || 1)))[0];
    if (drv && drv.contrib > (drv.w / (R.coverage || 1)) * 1.2) {
      out.push({ title: 'De grootste risicobron kleiner maken: ' + drv.c.tk,
        text: drv.c.tk + ' is ' + P1.format(drv.w) + ' van je beleggingen, maar ' + P1.format(drv.contrib) + ' van het risico' + (isNum(drv.vol) ? ' (zelf ' + P1.format(drv.vol) + ' per jaar)' : '') + '. In het voorbeeld gaat de helft naar ' + idxName + '.',
        to: canIdx ? sim((x) => (x === drv ? x.w / 2 : x.w), drv.w / 2) : null, tk: drv.c.tk });
    }
    // 2. Geen los aandeel boven de 10%
    const big = stocks.filter((c) => (c.weight || 0) > 0.10).sort((a, b) => b.weight - a.weight);
    if (big.length) {
      const excess = sum(hist.filter((x) => !isFundC(x.c) && x.w > 0.10).map((x) => x.w - 0.10));
      out.push({ title: 'Geen los aandeel groter dan 10%',
        text: big.map((c) => c.tk + ' ' + P1.format(c.weight)).join(', ') + '. Valt één bedrijf tegen, dan raakt dat je hele portefeuille. In het voorbeeld gaat alles boven de 10% naar ' + idxName + '.' + viaInleg(big[0].value / 0.10 - total),
        to: canIdx && excess > 0 ? sim((x) => (!isFundC(x.c) && x.w > 0.10 ? 0.10 : x.w), excess) : null });
    }
    // 3. Meer in brede fondsen
    if (isNum(R.fundsW) && R.fundsW < 0.5 && stocks.length) {
      const k = (1 - 0.5) / Math.max(1e-9, 1 - R.fundsW);
      out.push({ title: 'De helft in brede indexfondsen',
        text: 'Nu ' + P1.format(R.fundsW) + ' in fondsen. Een indexfonds spreidt over honderden bedrijven, waardoor tegenvallers van één bedrijf weinig uitmaken. In het voorbeeld gaat ' + P1.format(0.5 - R.fundsW) + ' van je losse aandelen (naar verhouding) naar ' + idxName + '.' + viaInleg(total * (1 - 2 * R.fundsW), 'in brede fondsen'),
        to: canIdx ? sim((x) => (isFundC(x.c) ? x.w : x.w * k), 0.5 - R.fundsW) : null });
    }
    // 4. Eén sector
    if (M.mk.ok) {
      const sec = new Map();
      stocks.forEach((c) => { const p = M.mk.profOf(c.tk); const nm = p && p.sector ? sectorNl(p.sector) : null; if (!nm) return; const e = sec.get(nm) || { w: 0, tks: [] }; e.w += c.weight || 0; e.tks.push(c.tk); sec.set(nm, e); });
      const topS = [...sec.entries()].sort((a, b) => b[1].w - a[1].w)[0];
      if (topS && topS[1].w > 0.4) {
        const sw = topS[1].w, k = 0.3 / sw;
        out.push({ title: 'Minder in één sector: ' + topS[0],
          text: P1.format(sw) + ' van je beleggingen zit in losse aandelen uit ' + topS[0].toLowerCase() + ' (' + topS[1].tks.join(', ') + '). Die reageren vaak op hetzelfde nieuws. In het voorbeeld gaat de sector naar 30% en de rest naar ' + idxName + '.',
          to: canIdx ? sim((x) => (topS[1].tks.includes(x.c.tk) ? x.w * k : x.w), sw - 0.3) : null });
      }
    }
    // 5. Posities die samen bewegen
    if (R.mat && R.mat.length >= 3) {
      let best = null;
      R.mat.forEach((a, i) => R.mat.forEach((b, j) => { const v = R.C2[i][j]; if (j > i && isNum(v) && v >= 0.6 && !isFundC(a.c) && !isFundC(b.c) && (!best || v > best[2])) best = [a, b, v]; }));
      if (best) out.push({ title: best[0].c.tk + ' en ' + best[1].c.tk + ' bewegen bijna samen',
        text: 'Samenhang ' + N2.format(best[2]) + '. Samen ' + P1.format(best[0].w + best[1].w) + ' van je beleggingen; voor het risico tellen ze bijna als één positie. Iets wat los daarvan beweegt, spreidt meer.' });
    }
    // 6. Dollar
    if (isNum(R.usd) && R.usd > 0.7) {
      const days = [...R.fx.keys()].sort().slice(-261); const fr = [];
      for (let i = 1; i < days.length; i++) fr.push(R.fx.get(days[i]) / R.fx.get(days[i - 1]) - 1);
      const fv = fr.length >= 60 ? stdev(fr) * Math.sqrt(252) : null;
      out.push({ title: 'Minder afhankelijk van de dollar',
        text: P1.format(R.usd) + ' van je beleggingen staat in dollars' + (isNum(fv) ? '; de dollar zelf schommelde het laatste jaar ' + P1.format(fv) + ' tegenover de euro' : '') + '. Dat zit bovenop de koersbewegingen. Beleggingen in euro of een fonds met valuta-afdekking (in de naam vaak "EUR Hedged") halen dat deel weg.' });
    }
    // 7. Geld als buffer
    if (isNum(R.vol) && M.cash != null && M.accountNow > 0) {
      out.push({ title: 'Een deel in geld',
        text: 'Met je vrije saldo (' + eur(M.cash) + ') meegerekend schommelt je hele account ongeveer ' + P1.format(R.vol * (M.totalValue / M.accountNow)) + ' per jaar. Geld schommelt niet, maar levert ook weinig op. Geld dat je binnen een paar jaar nodig hebt, staat vaak beter buiten de beurs.' });
    }
    return { ideas: out, base, idxName, canIdx };
  }

  // ---------- Risico per bedrijf: waarom hoger of lager, en rustigere alternatieven ----------
  const SECTOR_RISK = {
    'Technology': [1, 'Technologie: de koers hangt sterk af van groeiverwachtingen en de rente, dus verwachtingen die bijstellen geven grote uitslagen.'],
    'Communication Services': [1, 'Communicatie en media: advertentie-inkomsten dalen snel als de economie afkoelt.'],
    'Consumer Cyclical': [1, 'Cyclische consumptie: als consumenten minder uitgeven, dalen omzet en winst snel.'],
    'Energy': [1, 'Energie: winst hangt af van olie- en gasprijzen, die sterk schommelen.'],
    'Basic Materials': [1, 'Grondstoffen: winst volgt grondstofprijzen en de wereldeconomie.'],
    'Financial Services': [0, 'Financiële diensten: gevoelig voor rente en kredietzorgen, maar vaak met stabiele inkomsten.'],
    'Industrials': [0, 'Industrie: volgt de economische cyclus, met orders die per jaar kunnen verschillen.'],
    'Real Estate': [0, 'Vastgoed: gevoelig voor de rente, maar met vaste huurinkomsten.'],
    'Healthcare': [-1, 'Gezondheidszorg: de vraag naar zorg hangt weinig af van de economie.'],
    'Consumer Defensive': [-1, 'Basisconsumptie: mensen blijven deze producten kopen, ook in een slechte economie.'],
    'Utilities': [-1, 'Nutsbedrijven: stabiele, vaak gereguleerde inkomsten.'],
  };
  const INDUSTRY_RISK = {
    'Semiconductors': [1, 'Chips: een sterk cyclische branche; vraag en prijzen wisselen snel, met grote koersuitslagen.'],
    'Semiconductor Equipment & Materials': [1, 'Chipmachines: orders hangen af van investeringen van chipmakers en wisselen sterk per jaar.'],
    'Biotechnology': [1, 'Biotechnologie: de koers hangt af van onderzoeksresultaten en goedkeuringen, die alles-of-niets kunnen zijn.'],
    'Aerospace & Defense': [0, 'Defensie en ruimtevaart: lange contracten, maar afhankelijk van overheidsbudgetten en grote projecten.'],
  };

  // Dagrendementen van de S&P 500 in euro: eigen fonds of FRED
  function spRets(R) {
    const own = R.items.find((x) => x.n >= 60 && BENCHES[0][1].test(x.c.tk));
    if (own) return { rets: own.rets, vol: own.vol, name: own.c.tk };
    if (!(data.idx && data.idx.series && data.idx.series.SP500)) return null;
    const days = [...R.fx.keys()].sort(); let j = 0, last = null, prev = null; const rets = new Map();
    data.idx.series.SP500.forEach(([d, v]) => { while (j < days.length && days[j] <= d) { last = R.fx.get(days[j]); j++; } if (!last) return; const e = v / last; if (prev) { const r = e / prev - 1; if (Math.abs(r) < 0.5) rets.set(d, r); } prev = e; });
    const arr = [...rets.values()].slice(-260);
    return rets.size >= 60 ? { rets, vol: stdev(arr) * Math.sqrt(252), name: 'de S&P 500' } : null;
  }

  function riskWhy(c) {
    const R = riskModel();
    const x = R.items.find((i) => i.c.tk === c.tk) || { w: c.weight || 0 };
    const p = M.mk.ok ? M.mk.profOf(c.tk) : null;
    const isFund = isFundC(c);
    const sp = spRets(R);
    const mktVol = sp && isNum(sp.vol) ? sp.vol : 0.17;
    const up = [], down = [];
    const add = (d, t) => (d > 0 ? up : down).push(t);
    if (isNum(x.vol)) {
      const ratio = x.vol / mktVol;
      if (ratio >= 1.25) add(1, 'Schommelde het laatste jaar ' + P1.format(x.vol) + ' per jaar, ongeveer ' + N1.format(ratio) + ' keer zo veel als ' + (sp ? sp.name : 'de brede markt') + ' (' + P1.format(mktVol) + ').');
      else if (ratio <= 0.85) add(-1, 'Schommelde het laatste jaar ' + P1.format(x.vol) + ' per jaar, minder dan ' + (sp ? sp.name : 'de brede markt') + ' (' + P1.format(mktVol) + ').');
    }
    if (isFund) {
      if (BENCHES[1][1].test(c.tk) || /nasdaq/i.test(c.name)) { add(-1, 'Een fonds met 100 bedrijven: een tegenvaller bij één bedrijf weegt weinig.'); add(1, 'Wel geconcentreerd in grote technologiebedrijven, daardoor beweeglijker dan een breed fonds.'); }
      else add(-1, 'Een breed indexfonds met honderden bedrijven uit allerlei sectoren: tegenvallers bij één bedrijf middelen uit.');
    } else if (p) {
      if (isNum(p.beta) && p.beta >= 1.3) add(1, 'Reageert sterk op de markt (beta ' + N2.format(p.beta) + '): daalt de markt 10%, dan daalt dit aandeel gemiddeld zo\'n ' + Math.round(p.beta * 10) + '%.');
      else if (isNum(p.beta) && p.beta > 0 && p.beta <= 0.8) add(-1, 'Rustiger dan de markt (beta ' + N2.format(p.beta) + '): beweegt gemiddeld minder mee met dalingen en stijgingen.');
      if (isNum(p.marketCap) && p.marketCap < 10e9) add(1, 'Kleiner bedrijf (beurswaarde ' + mcap(p.marketCap, p.currency) + '): nieuws heeft meer invloed op de koers.');
      else if (isNum(p.marketCap) && p.marketCap > 200e9) add(-1, 'Een van de grootste bedrijven ter wereld (beurswaarde ' + mcap(p.marketCap, p.currency) + '): gevestigd en veel gevolgd.');
      const ind = p.industry && INDUSTRY_RISK[p.industry], sec = p.sector && SECTOR_RISK[p.sector];
      if (ind) { if (ind[0]) add(ind[0], ind[1]); } else if (sec && sec[0]) add(sec[0], sec[1]);
      if (p.ipoDate && Date.now() - ymd(p.ipoDate) < 5 * 365 * DAY) add(1, 'Pas sinds ' + new Date(ymd(p.ipoDate)).getFullYear() + ' op de beurs: weinig koersgeschiedenis en vaak sterke reacties op cijfers.');
    }
    const Fin = (data.fin || {})[c.tk];
    if (Fin && Fin.series) {
      const rev = new Map((Fin.series.rev && Fin.series.rev.rows) || []), net = new Map((Fin.series.net && Fin.series.net.rows) || []);
      const ys = [...net.keys()].sort((a, b) => a - b), ly = ys[ys.length - 1];
      if (ly && net.get(ly) < 0) add(1, 'Maakte in ' + ly + ' verlies: de koers leunt op verwachtingen voor later.');
      else if (ly && rev.get(ly) && net.get(ly) / rev.get(ly) > 0.2) add(-1, 'Zeer winstgevend (nettomarge ' + P1.format(net.get(ly) / rev.get(ly)) + ' in ' + ly + ').');
    }
    if ((c.weight || 0) > 0.1) add(1, 'Groot deel van je portefeuille (' + P1.format(c.weight) + '): een daling hier raakt je totaal direct.');
    if (isNum(x.contrib) && x.contrib > (x.w / (R.coverage || 1)) * 1.5) add(1, 'Levert ' + P1.format(x.contrib) + ' van je totale risico bij ' + P1.format(x.w) + ' van je waarde.');
    else if (isNum(x.contrib) && x.contrib < (x.w / (R.coverage || 1)) * 0.5) add(-1, 'Beweegt anders dan de rest van je portefeuille en spreidt daardoor (' + P1.format(x.contrib) + ' van het risico bij ' + P1.format(x.w) + ' van de waarde).');
    if (p && p.currency && p.currency !== 'USD' && p.currency !== 'EUR') add(1, 'Noteert in ' + p.currency + ': ook die wisselkoers telt mee.');
    if (p && p.currency === 'EUR') add(-1, 'Noteert in euro: geen wisselkoersrisico.');
    const verdict = isNum(x.vol) ? (x.vol / mktVol >= 1.25 ? 'hoger dan de markt' : x.vol / mktVol <= 0.85 ? 'lager dan de markt' : 'ongeveer als de markt')
      : up.length > down.length ? 'waarschijnlijk hoger dan de markt' : down.length > up.length ? 'waarschijnlijk lager dan de markt' : 'onbekend';

    // Rustigere alternatieven: vergelijkbare bedrijven met een lagere beta, en fondsen
    const alts = [];
    if (!isFund && M.mk.ok && p) {
      const myB = isNum(p.beta) ? p.beta : null;
      M.mk.peersOf(c.tk).map((s2) => M.mk.prof(s2)).filter(Boolean)
        .filter((q) => isNum(q.beta) && q.beta > 0 && (myB == null ? q.beta < 1 : q.beta <= myB - 0.15))
        .sort((a, b) => a.beta - b.beta).slice(0, 3)
        .forEach((q) => {
          const held = M.mk.heldBySym.get(q.symbol);
          const bits = ['beta ' + N2.format(q.beta)];
          if (isNum(q.marketCap)) bits.push('beurswaarde ' + mcap(q.marketCap, q.currency));
          if (q.industry && p.industry && q.industry === p.industry) bits.push('zelfde branche'); else if (q.sector) bits.push(sectorNl(q.sector));
          alts.push({ sym: q.symbol, name: q.name || q.symbol, held, text: bits.join(', ') + (held ? '; heb je al' : '') });
        });
    }
    const funds = [];
    const ownBroad = M.companies.find((d) => BENCHES[0][1].test(d.tk) || BENCHES[2][1].test(d.tk));
    if (isFund) {
      if (BENCHES[1][1].test(c.tk) || /nasdaq/i.test(c.name)) funds.push('Een breed S&P 500- of wereldfonds: minder afhankelijk van technologie, daardoor meestal minder beweeglijk.');
      else if (BENCHES[0][1].test(c.tk)) funds.push('Een wereldfonds (MSCI World of FTSE All-World) spreidt ook over Europa, Japan en andere landen, en minder over de dollar.');
      funds.push('Een obligatiefonds of geld schommelt veel minder, maar levert op lange termijn meestal ook minder op.');
    } else {
      if (p && p.sector) funds.push('Een sectorfonds voor ' + sectorNl(p.sector).toLowerCase() + ': dezelfde sector, maar verspreid over tientallen bedrijven.');
      funds.push(ownBroad ? 'Meer in je brede fonds (' + ownBroad.tk + '): honderden bedrijven in één keer.' : 'Een breed indexfonds (S&P 500 of wereld): honderden bedrijven in één keer.');
      if (p && SECTOR_RISK[p.sector] && SECTOR_RISK[p.sector][0] > 0) funds.push('Bedrijven uit rustigere sectoren (basisconsumptie, nutsbedrijven, gezondheidszorg) schommelen meestal minder.');
    }
    return { x, p, up, down, verdict, alts, funds, cls: x.cls, vol: x.vol };
  }

  function whyBody(c, W) {
    const li = (arr, cls) => arr.map((t) => '<li class="' + cls + '">' + esc(t) + '</li>').join('');
    return (W.up.length || W.down.length ? '<ul class="why">' + li(W.up, 'up') + li(W.down, 'down') + '</ul>' : '<p class="small muted">Nog te weinig gegevens om het risico te verklaren.</p>') +
      '<p class="why-h">Minder risicovolle alternatieven</p>' +
      (W.alts.length ? '<div class="alt-list">' + W.alts.map((a) => '<' + (a.held ? 'button type="button" data-open="' + esc(a.held) + '"' : 'div') + ' class="alt"><b>' + esc(a.sym) + '</b><span>' + esc(a.name) + '</span><span class="muted small">' + esc(a.text) + '</span></' + (a.held ? 'button' : 'div') + '>').join('') + '</div>' : '') +
      '<ul class="why alt-f">' + W.funds.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
  }

  function companyWhyTile(c) {
    const W = riskWhy(c);
    return '<section class="tile pad"><h3>Risico van ' + esc(c.tk) + '</h3>' +
      '<div class="why-top">' + (W.cls ? '<span class="lvl" style="--k:' + W.cls + '">' + W.cls + '</span>' : '') + '<span>Risico <b>' + esc(W.verdict) + '</b>' + (isNum(W.vol) ? ', ' + esc(P1.format(W.vol)) + ' per jaar' : '') + '</span></div>' +
      whyBody(c, W) + '<p class="sub" style="margin-top:8px">Alternatieven: vergelijkbare bedrijven met een lagere beta (FMP) en soorten fondsen. Minder risico betekent meestal ook minder verwacht rendement; dit is geen beleggingsadvies.</p></section>';
  }

  function whyListTile() {
    const R = riskModel();
    const list = M.companies.slice().sort((a, b) => {
      const xa = R.items.find((i) => i.c === a), xb = R.items.find((i) => i.c === b);
      return ((xb && isNum(xb.contrib) ? xb.contrib : 0) - (xa && isNum(xa.contrib) ? xa.contrib : 0)) || b.value - a.value;
    });
    return '<section class="tile pad span-2 why-list"><h3>Per bedrijf: waarom dit risico, en rustigere alternatieven</h3>' +
      list.map((c) => {
        const W = riskWhy(c);
        return '<details class="why-d"><summary>' + (W.cls ? '<span class="lvl" style="--k:' + W.cls + '">' + W.cls + '</span>' : '<span class="lvl na">–</span>') +
          '<span class="nm"><b>' + esc(c.tk) + '</b> <span class="muted">' + esc(c.name) + '</span></span><span class="small ' + (/hoger/.test(W.verdict) ? 'loss' : /lager/.test(W.verdict) ? 'gain' : 'muted') + '">' + esc(W.verdict) + '</span></summary>' +
          '<div class="why-in">' + whyBody(c, W) + '</div></details>';
      }).join('') +
      '<p class="sub" style="margin-top:10px">Gesorteerd op aandeel in je risico. Rood: redenen voor meer risico, groen: voor minder. Alternatieven zijn vergelijkbare bedrijven met een lagere beta (FMP) en soorten fondsen; minder risico betekent meestal ook minder verwacht rendement. Geen beleggingsadvies.</p></section>';
  }

  function renderRiskView() {
    const R = riskModel();
    const total = M.totalValue || 0;
    const I = riskIdeas(R);
    const effect = (x) => {
      if (!isNum(x.to) || !isNum(I.base)) return '';
      const c0 = srri(I.base), c1 = srri(x.to), d = x.to - I.base;
      return '<div class="sug-eff"><span class="lvl" style="--k:' + c0 + '">' + c0 + '</span><span class="arr" aria-hidden="true">→</span><span class="lvl" style="--k:' + c1 + '">' + c1 + '</span>' +
        '<span class="small">met je huidige verdeling: ' + esc(P1.format(I.base)) + ' → <b class="' + (d < 0 ? 'gain' : 'loss') + '">' + esc(P1.format(x.to)) + '</b> per jaar</span></div>';
    };
    const ranked = I.ideas.slice().sort((a, b) => (isNum(a.to) ? a.to : 9) - (isNum(b.to) ? b.to : 9));
    const sugg = '<section class="tile pad sugg span-2"><h3>Wat het risico verlaagt</h3>' +
      (R.cls ? riskScale(R.cls) : '') +
      (ranked.length ? '<ol class="sug-list">' + ranked.map((x) => '<li><b>' + esc(x.title) + '</b><p class="small">' + esc(x.text) + '</p>' + effect(x) + '</li>').join('') + '</ol>'
        : '<p class="muted" style="margin-top:12px">Geen duidelijke punten gevonden: je spreiding over posities, sectoren en munten is redelijk.</p>') +
      '<p class="sub" style="margin-top:10px">Rekenvoorbeelden met de koersen van het laatste jaar' + (I.canIdx ? ', met ' + esc(I.idxName) + ' als bestemming' : '; voor de getallen is koershistorie van een breed indexfonds nodig (FRED-sleutel of een eigen S&P 500-fonds)') +
      '. Verkopen kost bij dollaraandelen wisselkosten; nieuwe inleg anders verdelen kost niets extra. Dit is geen beleggingsadvies en zegt niets over toekomstige rendementen.</p></section>';

    // Slecht jaar
    const badYear = isNum(R.vol) ? -1.645 * R.vol : null;
    const year = '<section class="tile pad"><h3>Wat een slecht jaar kan betekenen</h3>' + kvList([
      ['Beweeglijkheid per jaar', isNum(R.vol) ? P1.format(R.vol) : '–'],
      ['Slecht jaar (ongeveer 1 op 20)', isNum(badYear) ? spct1(badYear) + ', nu ' + seur(badYear * total) : '–', 'loss'],
      ['Slechte week (ongeveer 1 op 20)', isNum(R.vol) ? spct1(-1.645 * R.vol / Math.sqrt(52)) + ', nu ' + seur(-1.645 * R.vol / Math.sqrt(52) * total) : '–', 'loss'],
      ['Slechte dag (1 op 20, gemeten)', isNum(R.badDay) ? spct(R.badDay) + ', nu ' + seur(R.badDay * total) : '–', 'loss'],
    ]) + '<p class="sub" style="margin-top:8px">Benadering met een normale verdeling rond nul; echte dalingen komen vaker in clusters en kunnen groter zijn. Over langere periodes middelt veel uit, daarom geldt: hoe hoger de klasse, hoe langer de horizon die erbij past.</p></section>';

    // Per positie
    const rows = R.items.slice().sort((a, b) => b.w - a.w);
    const per = '<section class="tile pad span-2"><h3>Per positie</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Positie</th><th class="num">Gewicht</th><th class="num">Beweeglijkheid</th><th class="num">Klasse</th><th class="num">Deel van het risico</th><th class="num">Beta</th></tr></thead><tbody>' +
      rows.map((x) => { const p = M.mk.ok ? M.mk.profOf(x.c.tk) : null;
        return '<tr data-open="' + esc(x.c.tk) + '" class="rowlink"><td><b>' + esc(x.c.tk) + '</b> <span class="muted small">' + esc(x.c.name) + '</span></td><td class="num">' + esc(P1.format(x.w)) + '</td>' +
          '<td class="num">' + esc(isNum(x.vol) ? P1.format(x.vol) : '–') + '</td><td class="num">' + (x.cls ? '<span class="lvl" style="--k:' + x.cls + '">' + x.cls + '</span>' : '–') + '</td>' +
          '<td class="num' + (isNum(x.contrib) && x.contrib > x.w / (R.coverage || 1) * 1.2 ? ' loss' : '') + '">' + esc(isNum(x.contrib) ? P1.format(x.contrib) : '–') + '</td><td class="num">' + esc(p && isNum(p.beta) ? N2.format(p.beta) : '–') + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="sub" style="margin-top:8px">Beweeglijkheid per jaar uit de dagkoersen in euro (' + esc([...new Set(R.items.map((x) => x.basis).filter(Boolean))].join(', ')) + '). Rood: meer risico dan gewicht. Beta van FMP.</p></section>';

    const t = riskTiles(true);
    const head = pseudoHead('Risico-indicatie', R.cls ? R.cls + ' van 7' : 'Nog geen indicatie', R.cls ? RISK_WORDS[R.cls] + ', beweeglijkheid ongeveer ' + P1.format(R.vol) + ' per jaar' : 'Er zijn nog te weinig gegevens.');
    const why = whyListTile();
    return pseudoPage('Risico', head, [[sugg, year], [why], [t[0], t[1], t[2]], [per]], [sugg, why, year, t[0], t[1], t[2], per]);
  }

  function plTile() {
    const pl = M.companies.filter((c) => isNum(c.unreal)).sort((a, b) => b.unreal - a.unreal);
    const mx = Math.max(1e-9, ...pl.map((c) => Math.abs(c.unreal)));
    return '<section class="tile pad"><h3>Winst en verlies per positie</h3><div class="hbars">' + pl.map((c) => {
      const w = (Math.abs(c.unreal) / mx * 50).toFixed(1) + '%';
      return '<button type="button" class="r" data-open="' + esc(c.tk) + '" data-tip="' + esc(c.name + ': ' + seur(c.unreal) + ' (' + spct1(c.resultPct) + ')') + '">' +
        '<span class="tk">' + esc(c.tk) + '</span><span class="track"><span class="mid"></span><span class="' + (c.unreal < 0 ? 'neg' : 'pos') + '" style="width:' + w + '"></span></span>' +
        '<span class="' + tone(c.unreal) + '" style="text-align:right;font-weight:600">' + esc(seur(c.unreal)) + '</span></button>';
    }).join('') + '</div><p class="sub" style="margin-top:10px">Ongerealiseerd resultaat ten opzichte van wat je erin hebt gestoken. Klik op een positie voor de details.</p></section>';
  }

  function signedBars(parts) {
    const mx = Math.max(1e-9, ...parts.filter((p) => isNum(p[1])).map((p) => Math.abs(p[1])));
    return '<div class="hbars">' + parts.filter((p) => isNum(p[1])).map(([k, v, tip]) =>
      '<div class="r wide-l" data-tip="' + esc(tip || k) + '"><span class="tk">' + esc(k) + '</span><span class="track"><span class="mid"></span><span class="' + (v < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(v) / mx * 50).toFixed(1) + '%"></span></span>' +
      '<span class="' + tone(v) + '" style="text-align:right;font-weight:600">' + esc(seur(v)) + '</span></div>').join('') + '</div>';
  }

  function renderResultView() {
    const lw = M.lastWeek, total = M.accountNow;
    const res = lw && isNum(lw.netDeposits) ? total - lw.netDeposits : null;
    const unreal = sum(M.companies.map((c) => (isNum(c.unreal) ? c.unreal : 0)));
    const T = M.tx;
    const fxE = T.has && isNum(T.fx) ? T.fx : null;
    const real = T.has && isNum(T.realised) ? T.realised : 0;
    const divs = (M.ev && M.ev.received) || [];
    const div = sum(divs.map((d) => (isNum(d.amount) ? d.amount : 0)));
    const rest = isNum(res) ? res - unreal - real - div : null;
    const parts = [
      ['Koers', unreal - (fxE || 0), 'Koerswinst of -verlies van je open posities, zonder het valuta-effect'],
      ['Valuta', fxE, 'Effect van de euro-dollarkoers op je open posities sinds aankoop'],
      ['Verkocht', T.has ? real : null, 'Gerealiseerd resultaat bij verkopen'],
      ['Dividend', divs.length ? div : null, 'Ontvangen dividend (' + divs.length + ' uitkeringen)'],
      ['Overig', rest, 'Wat overblijft: resultaat van vóór je orderhistorie, rente op je saldo en afronding'],
    ];
    const build = '<section class="tile pad span-2"><h3>Waar je resultaat vandaan komt</h3>' + signedBars(parts) +
      '<div style="margin-top:12px">' + kvList([
        ['Accountwaarde nu', eur(total)],
        ['Netto gestort', lw ? eur(lw.netDeposits) : '–'],
        ['Totaal resultaat', isNum(res) ? seur(res) + ' (' + spct1(res / lw.netDeposits) + ')' : '–', tone(res)],
        ['Waarvan open posities', seur(unreal), tone(unreal)],
        ['Betaalde kosten (zitten al in de bedragen)', T.has ? eur(T.fees) : '–'],
      ]) + '</div><p class="sub" style="margin-top:8px">Koers en valuta uit je posities, verkopen en kosten uit je orders, dividend uit Trading 212. "Overig" is wat overblijft: resultaat van vóór je orderhistorie, rente op je saldo en afronding.</p></section>';
    const W = M.weeks.filter((w) => isNum(w.weekResultPct));
    let idx = 1; W.forEach((w) => { idx *= 1 + w.weekResultPct; });
    const bestW = W.slice().sort((a, b) => b.weekResult - a.weekResult)[0], worstW = W.slice().sort((a, b) => a.weekResult - b.weekResult)[0];
    const perf = '<section class="tile pad"><h3>Rendement</h3><div class="inset">' +
      spark(M.weeks.filter((w) => isNum(w.totalResult)).map((w) => ({ t: w.t, v: w.totalResult })), toneColor(res), 'spark tall') + '</div>' + kvList([
        ['Op je inleg', isNum(res) && lw.netDeposits ? spct1(res / lw.netDeposits) : '–', tone(res)],
        ['Zonder stortingen (tijdgewogen)', W.length ? spct1(idx - 1) + ' over ' + W.length + ' weken' : '–', tone(idx - 1)],
        ['Weken met winst', W.length ? W.filter((w) => w.weekResultPct > 0).length + ' van ' + W.length : '–'],
        ['Beste week', bestW ? seur(bestW.weekResult) + ', tot ' + fDM.format(bestW.t) : '–', 'gain'],
        ['Slechtste week', worstW ? seur(worstW.weekResult) + ', tot ' + fDM.format(worstW.t) : '–', 'loss'],
      ]) + '<p class="sub" style="margin-top:8px">Lijn: totaal resultaat per week. Tijdgewogen rendement telt stortingen niet mee, zodat je het kunt vergelijken met een fonds.</p></section>';
    const head = pseudoHead('Totaal resultaat', isNum(res) ? seur(res) : '–', isNum(res) ? spct1(res / lw.netDeposits) + ' op ' + eur(lw.netDeposits) + ' netto gestort' : 'Na de eerste weekmeting.', tone(res));
    const extra = [realisedTile(), fxTile(), inflationTile()].filter(Boolean);
    return pseudoPage('Resultaat', head, [[build, perf], [plTile()].concat(extra)], [build, perf, plTile()].concat(extra));
  }

  function renderDepositView() {
    const lw = M.lastWeek;
    const W = M.weeks.filter((w) => isNum(w.newDeposits));
    const dep = W.filter((w) => Math.abs(w.newDeposits) >= 0.01);
    const ins = sum(dep.filter((w) => w.newDeposits > 0).map((w) => w.newDeposits)), outs = sum(dep.filter((w) => w.newDeposits < 0).map((w) => w.newDeposits));
    const first = M.weeks[0];
    const months = first && lw ? Math.max(1, (lw.t - first.t) / (30.44 * DAY)) : null;
    const monthly = isNum(M.settings && M.settings.monthly) ? M.settings.monthly : null;
    const guess = typeof monthlyGuess === 'function' ? monthlyGuess() : null;
    const facts = '<section class="tile pad"><h3>In cijfers</h3>' + kvList([
      ['Netto gestort nu', lw ? eur(lw.netDeposits) : '–'],
      ['Bij de start van de tracker', first ? eur(first.netDeposits) + ' (' + fDM.format(first.t) + ')' : '–'],
      ['Sindsdien gestort', seur(ins), 'gain'],
      ['Sindsdien opgenomen', outs ? seur(outs) : 'niets', outs ? 'loss' : ''],
      ['Gemiddeld per maand', months ? seur((ins + outs) / months) : '–'],
      ['Weken met een storting', dep.length + ' van ' + W.length],
      ['Laatste storting', dep.length ? seur(dep[dep.length - 1].newDeposits) + ', week tot ' + fDM.format(dep[dep.length - 1].t) : '–'],
      ['Maandbedrag op Plannen', isNum(monthly) ? eur(monthly) : isNum(guess) && guess > 0 ? 'niet ingesteld (geschat ' + eur(guess) + ')' : 'niet ingesteld'],
    ]) + '</section>';
    // Per maand
    const byM = new Map();
    dep.forEach((w) => { const d = new Date(w.t); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); byM.set(k, (byM.get(k) || 0) + w.newDeposits); });
    const mk = []; if (first && lw) { const d = new Date(first.t); d.setDate(1); while (d.getTime() <= lw.t) { mk.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); d.setMonth(d.getMonth() + 1); } }
    const fMonL = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
    const anyNeg = mk.some((k) => (byM.get(k) || 0) < 0);
    const perM = '<section class="tile pad"><h3>Per maand</h3>' + (mk.length ? bars(mk.map((k) => ({ v: byM.get(k) || 0, color: C.gain, tip: fMonL.format(new Date(k + '-15')) + ': ' + seur(byM.get(k) || 0) })), !anyNeg) +
      barLabels(mk.map((k) => fMonL.format(new Date(k + '-15')))) : '<p class="muted">Nog geen weken gemeten.</p>') + '<p class="sub" style="margin-top:8px">Stortingen min opnames per kalendermaand, uit je weekmetingen.</p></section>';
    // Inleg tegenover waarde
    const pts = M.weeks.filter((w) => isNum(w.netDeposits) && isNum(w.accountValue));
    let lines = '';
    if (pts.length >= 2) {
      const lo = Math.min(...pts.map((w) => Math.min(w.netDeposits, w.accountValue))), hi = Math.max(...pts.map((w) => Math.max(w.netDeposits, w.accountValue)));
      const X = (i) => (i / (pts.length - 1) * 300).toFixed(1), Y = (v) => (8 + (hi - v) / Math.max(1e-9, hi - lo) * 104).toFixed(1);
      const path = (f) => pts.map((w, i) => (i ? 'L' : 'M') + X(i) + ' ' + Y(f(w))).join('');
      lines = '<svg class="dual" viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true"><path d="' + path((w) => w.accountValue) + '" fill="none" stroke="' + C.accent + '" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
        '<path d="' + path((w) => w.netDeposits) + '" fill="none" stroke="' + C.ink2 + '" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/></svg>' +
        '<div class="xlabels"><span>' + esc(fDM.format(pts[0].t)) + '</span><span>' + esc(fDM.format(pts[pts.length - 1].t)) + '</span></div>' +
        '<div class="legend"><span><i style="background:' + C.accent + '"></i>Accountwaarde</span><span><i class="dash" style="border-color:' + C.ink2 + '"></i>Netto gestort</span></div>';
    }
    const dual = '<section class="tile pad"><h3>Inleg tegenover waarde</h3>' + (lines || '<p class="muted">Na twee weekmetingen.</p>') +
      '<p class="sub" style="margin-top:8px">De ruimte tussen de lijnen is je resultaat.</p></section>';
    const list = '<section class="tile pad"><h3>Alle stortingen en opnames</h3>' + (dep.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Week tot</th><th class="num">Bedrag</th><th class="num">Netto gestort daarna</th></tr></thead><tbody>' +
      dep.slice().reverse().map((w) => '<tr><td>' + esc(fD.format(w.t)) + '</td><td class="num ' + tone(w.newDeposits) + '">' + esc(seur(w.newDeposits)) + '</td><td class="num">' + esc(eur(w.netDeposits)) + '</td></tr>').join('') + '</tbody></table></div>'
      : '<p class="muted">Nog geen stortingen sinds de start van de tracker.</p>') + '<p class="sub" style="margin-top:8px">Per week, het verschil in netto gestort tussen twee weekmetingen.</p></section>';
    const head = pseudoHead('Netto gestort', lw ? eur(lw.netDeposits) : '–', dep.length ? seur(ins + outs) + ' sinds de start van de tracker, ' + dep.length + (dep.length === 1 ? ' storting' : ' stortingen') + '.' : 'Nog geen stortingen sinds de start van de tracker.');
    return pseudoPage('Stortingen', head, [[dual, perM, facts], [list]], [facts, dual, perM, list]);
  }

  // ---------- Bedrijfspagina (beide weergaven) ----------
  function renderDetail(animate, swapDir) {
    if (ui.detail === ACC) { $('detail-inner').innerHTML = renderAccount(); return; }
    if (ui.detail === RISK) { $('detail-inner').innerHTML = renderRiskView(); return; }
    if (ui.detail === RES) { const inner = $('detail-inner'); inner.innerHTML = renderResultView(); drawMacro(inner); return; }
    if (ui.detail === DEP) { $('detail-inner').innerHTML = renderDepositView(); return; }
    if (ui.detail === CMP) { const inner = $('detail-inner'); inner.innerHTML = renderCompareView(); drawCompare(inner); return; }
    if (isWatchKey(ui.detail)) { const inner = $('detail-inner'); inner.innerHTML = renderWatchDetail(ui.detail.slice(1)); drawWatchChart(inner); drawSectorChart(inner); return; }
    const c = M.byTk.get(ui.detail);
    if (!c) return;
    const inner = $('detail-inner');
    const keep = !animate && !swapDir ? ov.scrollTop : 0;
    inner.innerHTML = mode === 'm' ? renderDetailMobile(c, swapDir) : renderDetailDesktop(c, swapDir);
    if (!animate && !swapDir) ov.scrollTop = keep;
    $('d-compare').addEventListener('change', (e) => { ui.compare = e.target.checked; renderDetailChart(true); });
    renderDetailChart(animate || !!swapDir);
    drawSectorChart(inner);
  }

  function renderDetailChart(animate) {
    const c = M.byTk.get(ui.detail);
    if (!c) return;
    const r = ui.detailRange;
    segButtons($('d-ranges'), RANGES, r, (k) => { ui.detailRange = k; renderDetailChart(true); });
    const pts = seriesFor(c.tk, r);
    const legend = $('d-legend');
    if (ui.compare) {
      const mine = indexed(pts);
      const keys = new Set(pts.map((p) => p.t));
      const port = indexed(seriesFor(TOTAL, r).filter((p) => keys.has(p.t)));
      lineChart($('d-chart'), [
        { pts: mine, color: C.accent, width: 3, label: c.tk, fmt: spct },
        { pts: port, color: C.ink2, dash: true, width: 2, label: 'Portefeuille', fmt: spct },
      ], { animate, zero: true, xl: $('d-x'), xfmt: xFmt(r, pts), tfmt: tFmt(r, pts) });
      const a = mine.length ? mine[mine.length - 1].v : null, b = port.length ? port[port.length - 1].v : null;
      legend.innerHTML = '<div class="legend chart-legend"><span><i style="background:' + C.accent + '"></i>' + esc(c.tk) + ' ' + esc(spct(a)) + '</span><span><i class="dash"></i>Portefeuille ' + esc(spct(b)) + '</span></div>';
    } else {
      lineChart($('d-chart'), [{ pts, color: C.accent, area: true, width: 3 }], {
        animate, markers: heroMarkers(pts, 'detail').concat(tradeMarkers(c.tk, pts)).filter((mk, i, all) => all.findIndex((o) => o.i === mk.i) === i), xl: $('d-x'), xfmt: xFmt(r, pts), tfmt: tFmt(r, pts),
      });
      legend.innerHTML = '';
    }
    $('d-note').textContent = coverageNote(r, pts);
  }

  $('detail').addEventListener('click', (e) => {
    const uw = e.target.closest('[data-unwatch]');
    if (uw) { const sym = uw.dataset.unwatch; closeDetail(); setWatchlist(watchSyms().filter((x) => x !== sym), null, sym + ' is van je volglijst gehaald.'); return; }
    const op = e.target.closest('[data-open]');
    if (op) { switchDetail(op.dataset.open, 'r'); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { ui.mTab = tab.dataset.tab; renderDetail(false); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') closeDetail();
    else if (act === 'prev' || act === 'next') stepDetail(act === 'next' ? 1 : -1);
    else if (act === 'compare') { if (ui.detail && !isPseudo(ui.detail)) { xs.cmpA = ui.detail; if (xs.cmpB === xs.cmpA) xs.cmpB = null; } switchDetail(CMP, 'r'); }
  });
  $('detail').addEventListener('change', (e) => {
    const s = e.target.closest && e.target.closest('select[data-cmp]');
    if (!s) return;
    xs[s.dataset.cmp] = s.value;
    if (xs.cmpA === xs.cmpB) xs[s.dataset.cmp === 'cmpA' ? 'cmpB' : 'cmpA'] = null;
    markFresh();
    renderDetail(false);
  });

  function stepDetail(d) {
    const order = sortedCompanies();
    const i = order.findIndex((x) => x.tk === ui.detail);
    const n = order[(i + d + order.length) % order.length];
    switchDetail(n.tk, d > 0 ? 'r' : 'l');
  }

  // Vegen over naam en waarde op de telefoon: vorige of volgende bedrijf
  let swipe = null;
  $('detail').addEventListener('pointerdown', (e) => {
    if (mode !== 'm' || !e.target.closest('.m-swipe')) return;
    swipe = { x: e.clientX, y: e.clientY };
  });
  $('detail').addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) stepDetail(dx < 0 ? 1 : -1);
  });

  // ---------- Inzoomen ----------
  const ov = $('detail');
  const shellEl = () => $(mode === 'm' ? 'mshell' : 'shell');
  const inView = (r) => r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
  const setRect = (r) => Object.assign(ov.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  const setFull = () => Object.assign(ov.style, { left: '0px', top: '0px', width: '100%', height: '100%' });
  let zoomTimer = null;

  function setOrigin(sh, r) {
    const s = sh.getBoundingClientRect();
    sh.style.transformOrigin = (r.left + r.width / 2 - s.left) + 'px ' + (r.top + r.height / 2 - s.top) + 'px';
  }

  function ghostOf(el, r) {
    const g = el.cloneNode(true);
    g.removeAttribute('data-ticker');
    g.removeAttribute('aria-label');
    g.setAttribute('aria-hidden', 'true');
    g.classList.add('tile', 'ghost');
    g.style.width = r.width + 'px';
    g.style.height = r.height + 'px';
    g.style.padding = getComputedStyle(el).padding;
    g.style.borderRadius = getComputedStyle(el).borderRadius;
    return g;
  }

  function openDetail(tk, originEl, push) {
    if (!M || !hasView(tk)) return;
    clearTimeout(zoomTimer);
    hideTip();
    const sh = shellEl();
    ui.detail = tk;
    ui.detailRange = '3d';
    ui.compare = false;
    ui.mTab = 'pos';
    ui.origin = tk;
    if (push) { history.pushState({ detail: tk }, '', viewHash(tk)); pushedDetail = true; }
    markFresh();
    renderDetail(true);
    ov.querySelectorAll('.ghost').forEach((g) => g.remove());
    ov.classList.remove('anim', 'open', 'pop', 'fade-out');
    ov.hidden = false;
    ov.scrollTop = 0;
    document.documentElement.classList.add('locked');
    sh.inert = true;

    const r = originEl && originEl.getBoundingClientRect();
    if (reduceMotion() || !r || !inView(r)) {
      setFull();
      ov.classList.add('open');
      if (!reduceMotion()) ov.classList.add('pop');
      sh.classList.add('zoomed');
      focusDetail();
      return;
    }
    setRect(r);
    const g = ghostOf(originEl, r);
    ov.appendChild(g);
    setOrigin(sh, r);
    void ov.offsetWidth;
    ov.classList.add('anim');
    sh.classList.add('zoom-anim');
    requestAnimationFrame(() => {
      setFull();
      ov.classList.add('open');
      sh.classList.add('zoomed');
      g.style.opacity = '0';
    });
    zoomTimer = setTimeout(() => { g.remove(); sh.classList.remove('zoom-anim'); focusDetail(); }, ZOOM_MS + 20);
  }

  function focusDetail() {
    const b = ov.querySelector('[data-act="back"]');
    if (b) b.focus({ preventScroll: true });
  }

  function switchDetail(tk, dir) {
    if (!hasView(tk)) return;
    if (isPseudo(ui.detail)) { ui.detailRange = '3d'; ui.compare = false; ui.mTab = 'pos'; } else ui.origin = tk;
    ui.detail = tk;
    history.replaceState({ detail: tk }, '', viewHash(tk));
    ov.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    markFresh();
    renderDetail(false, reduceMotion() ? null : dir);
  }

  function closeDetail() {
    if (!ui.detail) return;
    if (pushedDetail) { history.back(); return; }   // de hashchange sluit daarna de pagina
    history.replaceState(null, '', '#' + pageHash(ui.page));
    finishDetail();
  }

  function cleanupDetail(sh) {
    ov.hidden = true;
    ov.classList.remove('anim', 'open', 'pop', 'fade-out');
    ov.removeAttribute('style');
    ov.querySelectorAll('.ghost').forEach((g) => g.remove());
    [$('shell'), $('mshell')].forEach((s) => { s.classList.remove('zoom-anim', 'zoomed'); s.style.transformOrigin = ''; s.inert = false; });
    document.documentElement.classList.remove('locked');
    void sh;
  }

  function instantClose() {
    clearTimeout(zoomTimer);
    ui.detail = null;
    pushedDetail = false;
    cleanupDetail();
  }

  function finishDetail() {
    if (!ui.detail) return;
    const tk = ui.origin || ui.detail;
    ui.detail = null;
    pushedDetail = false;
    clearTimeout(zoomTimer);
    hideTip();
    const sh = shellEl();
    sh.inert = false;
    const page = $(pageId(ui.page));
    const el = page && page.querySelector('[data-ticker="' + (window.CSS && CSS.escape ? CSS.escape(tk) : tk) + '"]');
    const done = () => { cleanupDetail(sh); if (el) el.focus({ preventScroll: true }); };

    if (reduceMotion()) { done(); return; }
    if (!el) {
      sh.classList.add('zoom-anim');
      sh.classList.remove('zoomed');
      ov.classList.add('fade-out');
      zoomTimer = setTimeout(done, 220);
      return;
    }
    // Pagina eerst zonder zoom meten, zo nodig de tegel in beeld schuiven
    sh.classList.remove('zoom-anim', 'zoomed');
    let r = el.getBoundingClientRect();
    const bottomBar = mode === 'm' ? 80 : 0;
    if (!inView(r) || r.top < 0 || r.bottom > window.innerHeight - bottomBar) {
      window.scrollBy(0, r.top - (window.innerHeight - r.height) / 2);
      r = el.getBoundingClientRect();
    }
    setOrigin(sh, r);
    sh.classList.add('zoomed');
    void sh.offsetWidth;
    sh.classList.add('zoom-anim');
    sh.classList.remove('zoomed');

    const g = ghostOf(el, r);
    g.style.opacity = '0';
    g.style.transition = 'opacity .2s .22s';
    ov.appendChild(g);
    ov.classList.add('anim');
    ov.classList.remove('open', 'pop');
    ov.scrollTop = 0;
    setRect(r);
    requestAnimationFrame(() => { g.style.opacity = '1'; });
    zoomTimer = setTimeout(done, ZOOM_MS + 30);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.detail && !$('dlg-settings').open) { e.preventDefault(); closeDetail(); }
  });

  // Klik op een tegel, rij of legenda-regel met een ticker: inzoomen
  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    if (e.target.closest('[data-act="links"]')) { openSettings(false); $('links-box').open = true; $('links-box').scrollIntoView({ block: 'nearest' }); return; }
    if (ov.contains(e.target)) return;
    const imp = e.target.closest('[data-act="import"]');
    if (imp) { openSettings(true); return; }
    if (!e.target.closest('#app, #m-main')) return;
    const go = e.target.closest('[data-goto]');
    if (go) { location.hash = go.dataset.goto; return; }
    const el = e.target.closest('[data-ticker]');
    if (el) openDetail(el.dataset.ticker, el, true);
  });

  // ---------- Pagina's en adresbalk ----------
  const ORDER = { home: 0, list: 1, news: 2, stats: 3, plan: 4 };
  const TITLES = { home: 'Overzicht', list: 'Bedrijven', news: 'Nieuws', stats: 'Statistieken', plan: 'Plannen' };
  const pageId = (p) => (mode === 'm' ? 'm-' + p : 'page-' + p);
  const pageHash = (p) => (p === 'list' ? 'bedrijven' : p === 'stats' ? 'statistieken' : p === 'news' ? 'nieuws' : p === 'plan' ? 'plannen' : 'overzicht');

  function placeIndicators() {
    const a = document.querySelector('.pillnav a[aria-current="page"]');
    const pill = document.querySelector('.pill');
    if (a && pill && mode === 'd') { pill.style.width = a.offsetWidth + 'px'; pill.style.transform = 'translateX(' + a.offsetLeft + 'px)'; }
    const t = document.querySelector('.m-tabs a[aria-current="page"]');
    const ind = document.querySelector('.m-tab-ind');
    if (t && ind && mode === 'm') { const w = t.offsetWidth * 0.5; ind.style.width = w + 'px'; ind.style.transform = 'translateX(' + (t.offsetLeft + (t.offsetWidth - w) / 2) + 'px)'; }
  }

  function showPage(p, animate, force) {
    if (mode === 'd' && p === 'stats') p = 'home';
    const prev = ui.page;
    ui.page = p;
    const ids = mode === 'm' ? ['home', 'list', 'news', 'stats', 'plan'] : ['home', 'list', 'news', 'plan'];
    const el = $(pageId(p));
    const move = animate && !reduceMotion();
    const swap = () => {
      document.body.dataset.page = p;
      $$('.pillnav a, .m-tabs a').forEach((a) => {
        if (a.dataset.page === p) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      $('m-title').textContent = TITLES[p];
      { const cs = getComputedStyle(document.documentElement); document.querySelector('meta[name="theme-color"]').content = (mode === 'm' && p !== 'home' ? cs.getPropertyValue('--bg') : cs.getPropertyValue('--band')).trim(); }
      ids.forEach((k) => { $(pageId(k)).hidden = k !== p; });
      placeIndicators();
      if (prev !== p || force) window.scrollTo(0, 0);
      foldAll(); // meteen in de juiste (ingeklapte) vorm, vóór de eerste keer tekenen
    };
    clearTimeout(showPage.timer);
    if (move) markFresh();
    $$('.page, .m-view').forEach((x) => x.classList.remove('in-r', 'in-l', 'enter'));
    const dir = ORDER[p] > ORDER[prev] ? 'f' : 'b';
    // Browsers met view transitions: de oude pagina schuift weg terwijl de nieuwe binnenkomt
    if (move && prev !== p && document.startViewTransition && !ui.detail) {
      const root = document.documentElement;
      root.dataset.nav = dir;
      let vt;
      try { vt = document.startViewTransition(() => { swap(); el.classList.add('enter'); }); } catch (e) { vt = null; }
      if (vt) {
        const clean = () => { if (showPage.vt === vt) delete root.dataset.nav; };
        showPage.vt = vt;
        vt.finished.then(clean, clean);
        if (vt.ready) vt.ready.catch(() => {}); // een snel volgende wissel breekt deze af; dat is geen fout
        showPage.timer = setTimeout(() => el.classList.remove('enter'), 1400);
        return;
      }
      delete root.dataset.nav;
    }
    swap();
    if (move) {
      void el.offsetWidth;
      if (prev !== p) el.classList.add(dir === 'f' ? 'in-r' : 'in-l');
      el.classList.add('enter');
      showPage.timer = setTimeout(() => el.classList.remove('in-r', 'in-l', 'enter'), 1400);
    }
  }

  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h.indexOf('bedrijf/') === 0) return { tk: h.slice(8) };
    const pk = Object.keys(PSEUDO).find((k) => PSEUDO[k] === h);
    if (pk) return { tk: pk };
    if (h.indexOf('volg/') === 0) return { tk: '~' + h.slice(5).toUpperCase() };
    return { page: h === 'bedrijven' ? 'list' : h === 'statistieken' ? 'stats' : h === 'plannen' ? 'plan' : h === 'nieuws' ? 'news' : 'home' };
  }

  function route(first) {
    const r = parseHash();
    if (r.tk) {
      if (first) showPage('list', true, true);
      if (!M) return;
      if (!ui.detail) openDetail(r.tk, null, false);
      else if (ui.detail !== r.tk) switchDetail(r.tk, 'r');
      return;
    }
    if (ui.detail) { pushedDetail = false; finishDetail(); }
    if (r.page !== ui.page || first) showPage(r.page, true);
  }

  window.addEventListener('hashchange', () => route(false));
  window.addEventListener('resize', () => { placeIndicators(); setMtop(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placeIndicators(); setMtop(); foldAll(); });

  // ---------- Tekenen ----------
  function renderAll() {
    if (mode === 'm') { renderMHome(); renderMList(); renderMStats(); }
    else { renderHome(); renderList(); }
    renderPlan();
    renderWatch();
    renderNews();
    renderValuationList();
    foldSoon();
  }

  // ---------- Panelen inklappen: lange tegels op de beginpagina's starten compact ----------
  // Tegels in dezelfde rij krijgen ingeklapt dezelfde hoogte; een klik op een leeg stuk van de tegel klapt hem uit of in.
  function foldSoon() { foldAll(); cancelAnimationFrame(foldTimer); foldTimer = requestAnimationFrame(() => requestAnimationFrame(foldAll)); }
  function foldAll() {
    const H = mode === 'm' ? 300 : 320;
    FOLD_ROOTS.forEach((rid) => {
      const root = $(rid);
      if (!root || root.hidden || !root.offsetParent) return;
      if (root.querySelector('.fold-anim')) return; // midden in een animatie: niet opnieuw meten
      root.classList.add('no-tr'); // meten en instellen zonder overgangen, anders "ademen" de grafieken bij elke meting
      const tiles = [...root.querySelectorAll('.tile.pad, .m-stack > .tile')].filter((t) => !t.closest(FOLD_SKIP) && !t.classList.contains('fold-anim'));
      // Eerst alles op natuurlijke hoogte meten
      tiles.forEach((t) => { t.classList.remove('folded', 'fit'); t.style.minHeight = ''; t.style.maxHeight = ''; t.querySelectorAll('.fit-chart').forEach((c) => c.classList.remove('fit-chart')); });
      const info = tiles.map((t, i) => {
        const h3 = t.querySelector('h3');
        return { t, key: rid + ':' + (h3 ? h3.textContent : i), full: t.scrollHeight, row: (t.parentElement.id || '') + ':' + t.offsetTop };
      });
      const rows = new Map();
      info.forEach((x) => { const r = rows.get(x.row) || []; r.push(x); rows.set(x.row, r); });
      rows.forEach((row) => {
        const even = row.length > 1 ? Math.min(H, Math.max(...row.map((x) => x.full))) : 0;
        row.forEach((x) => {
          const t = x.t;
          t.style.setProperty('--fold-h', H + 'px');
          if (even) t.style.minHeight = even + 'px';
          if (x.full <= H + 24) { t.classList.remove('fold'); t.removeAttribute('data-fold'); const b = t.querySelector(':scope > .fold-btn'); if (b) b.remove(); return; }
          t.classList.add('fold');
          t.dataset.fold = x.key;
          const open = unfolded.has(x.key);
          fitChart(t, H);
          t.classList.toggle('folded', !open);
          if (t.tagName === 'BUTTON') return; // een klikbare tegel opent zijn eigen pagina met alles
          let b = t.querySelector(':scope > .fold-btn');
          if (!b) { b = Object.assign(document.createElement('button'), { type: 'button', className: 'fold-btn' }); t.appendChild(b); }
          b.setAttribute('aria-expanded', open ? 'true' : 'false');
          b.textContent = open ? 'Minder tonen' : 'Meer tonen';
        });
      });
      void root.offsetHeight;
      root.classList.remove('no-tr');
    });
  }
  // Ingeklapt moet een grafiek met zijn labels helemaal zichtbaar zijn: maak hem zo nodig lager (de y-as wordt dan samengedrukt)
  const CHART_SEL = '.bars, .chart, svg.dual, .donut, .fin-bars';
  function fitChart(t, H) {
    const ch = t.querySelector(CHART_SEL);
    if (!ch) return;
    const tr = t.getBoundingClientRect(), cr = ch.getBoundingClientRect();
    if (cr.top - tr.top > H - 120 || cr.height < 40) return;
    let end = ch, sib = ch.nextElementSibling;
    while (sib && sib.matches('.bar-labels, .xlabels, .legend, .heat-key, .srri-l')) { end = sib; sib = sib.nextElementSibling; }
    if (end === ch && ch.parentElement !== t) { // labels kunnen naast de omhullende staan
      let w = ch.parentElement.nextElementSibling;
      while (w && w.matches('.bar-labels, .xlabels, .legend')) { end = w; w = w.nextElementSibling; }
    }
    const bottom = end.getBoundingClientRect().bottom - tr.top;
    const limit = H - 44;
    t.classList.add('fit');
    if (bottom <= limit) return;
    const nh = Math.max(48, cr.height - (bottom - limit));
    ch.style.setProperty('--fit-h', Math.floor(nh) + 'px');
    ch.classList.add('fit-chart');
  }
  function toggleFold(t) {
    if (t.classList.contains('fold-anim')) return;
    const key = t.dataset.fold;
    const open = !unfolded.has(key);
    if (open) unfolded.add(key); else unfolded.delete(key);
    const b = t.querySelector(':scope > .fold-btn');
    if (b) { b.textContent = open ? 'Minder tonen' : 'Meer tonen'; b.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    if (reduceMotion()) { t.classList.toggle('folded', !open); return; }
    // 1. Meet de eindhoogte in de eindtoestand, zonder overgangen (anders meet je een half gegroeide grafiek)
    const from = t.getBoundingClientRect().height;
    t.classList.add('no-tr');
    t.classList.toggle('folded', !open);
    t.style.maxHeight = '';
    const to = t.getBoundingClientRect().height;
    // 2. Terug naar de begintoestand, vastgezet op de beginhoogte
    t.classList.toggle('folded', open);
    t.style.maxHeight = from + 'px';
    void t.offsetHeight;
    t.classList.remove('no-tr');
    // 3. Animeren: tegel en grafiek bewegen met dezelfde duur en curve
    t.classList.add('fold-anim');
    t.classList.toggle('folded', !open);
    t.style.maxHeight = to + 'px';
    let fin = false;
    const done = (e) => {
      if (e && (e.target !== t || e.propertyName !== 'max-height')) return; // overgangen van onderdelen in de tegel tellen niet
      if (fin) return; fin = true;
      t.removeEventListener('transitionend', done);
      t.classList.add('no-tr'); t.classList.remove('fold-anim'); t.style.maxHeight = ''; void t.offsetHeight; t.classList.remove('no-tr');
    };
    t.addEventListener('transitionend', done);
    setTimeout(() => done(), 520);
    if (Math.abs(to - from) < 1) done();
    if (!open) { const r = t.getBoundingClientRect(); const topbar = mode === 'm' ? 64 : 96; if (r.top < topbar) window.scrollBy({ top: r.top - topbar - 12, behavior: 'smooth' }); }
  }
  // Klik op een leeg stuk van de tegel (niet op een knop, link, invoerveld of regel die zelf iets opent)
  const FOLD_IGNORE = 'a, input, select, textarea, label, summary, details, [data-open], [data-ticker]:not(.tile), [data-act], [data-plan], [data-cal], [data-export], [data-seg], .seg, [contenteditable]';
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.tile.fold[data-fold]');
    if (!t || t.tagName === 'BUTTON') return;
    const fb = e.target.closest('.fold-btn');
    if (!fb) {
      const hit = e.target.closest(FOLD_IGNORE);
      if (hit && t.contains(hit)) return;
      const btn = e.target.closest('button');
      if (btn && btn !== t && t.contains(btn)) return;
      if (window.getSelection && String(window.getSelection()).length) return;
    }
    toggleFold(t);
  });
  let foldResize = null;
  window.addEventListener('resize', () => { clearTimeout(foldResize); foldResize = setTimeout(foldAll, 200); });

  function render() {
    $('welcome').hidden = true;
    $('app').hidden = false;
    $('m-main').hidden = false;
    $('demo-banner').hidden = !demo;
    M = derive();
    if (firstRender) markFresh();
    const upd = M.lastT ? 'Bijgewerkt ' + fDT.format(data.generated ? new Date(data.generated) : new Date()) : '';
    $$('.updated').forEach((e) => { e.textContent = mode === 'm' ? upd.replace('Bijgewerkt ', '') : upd; });
    renderAll();
    if (ui.detail) {
      if (hasView(ui.detail)) renderDetail(false);
      else closeDetail();
    }
    if (firstRender) { firstRender = false; route(true); }
  }

  // =====================================================================
  // ---------- Uitbreidingen ----------
  // Inleg-assistent, scenario's, dividendkalender, box 3, kosten, aankoopdagboek, vergelijken, waardering,
  // overlap met fondsen, weekoverzicht delen, andere rekeningen, nieuws en analisten, volgsuggesties.
  const xs = { scen: 'tech', taxYear: null, cmpA: null, cmpB: null, newsF: 'all', wsHide: null };
  const fundKeyOf = (c) => { const b = BENCHES.find((x) => x[1].test(c.tk) || x[2].test(c.name || '')); return b ? (b[0] === 'S&P 500' ? 'SP500' : b[0] === 'Nasdaq 100' ? 'NDX' : null) : null; };
  const normTk = (tk) => ({ FB: 'META', GOOG: 'GOOGL', 'BRK.B': 'BRK', BRKB: 'BRK' }[tk] || tk);
  const segX = (key, opts, cur, label) => '<div class="seg light" role="group" aria-label="' + esc(label) + '" data-x="' + key + '">' +
    opts.map(([k, l]) => '<button type="button" data-k="' + esc(k) + '" aria-pressed="' + (String(cur) === String(k)) + '">' + esc(l) + '</button>').join('') + '</div>';
  const fullT = (h3, body, cls) => '<section class="tile pad full' + (cls ? ' ' + cls : '') + '"><h3>' + esc(h3) + '</h3>' + body + '</section>';
  const sectorKeyOf = (c) => { const s = M.mk.ok ? M.mk.sectorOf(c) : 'Onbekend'; return s === FUNDS ? '@funds' : s === 'Onbekend' ? '@unknown' : s; };
  const lvlOf = (v) => (isNum(v) ? '<span class="lvl" style="--k:' + srri(v) + '">' + srri(v) + '</span>' : '<span class="lvl na">?</span>');

  // Beweeglijkheid per jaar bij een andere verdeling (koersen van het laatste jaar)
  function volOfWeights(R, wOf) {
    const hist = R.items.filter((x) => x.n >= 60);
    const ws = hist.map((x) => [x, wOf(x.c.tk)]);
    const tot = sum(ws.map((p) => p[1]));
    if (!tot || !R.days || R.days.length < 60) return null;
    const rs = [];
    R.days.forEach((d) => {
      let sw = 0, sr = 0;
      ws.forEach(([x, w]) => { if (!w) return; const r = x.rets.get(d); if (isNum(r)) { sw += w; sr += w * r; } });
      if (sw > 0 && sw >= tot * 0.8) rs.push(sr / sw);
    });
    return rs.length >= 60 ? stdev(rs) * Math.sqrt(252) : null;
  }

  // ---------- 1. Maandelijkse inleg-assistent ----------
  function inlegPlan(amount) {
    const R = riskModel();
    const mode = plan.mode || M.settings.targetMode || 'position';
    const t = planTargets();
    const keyOf = (c) => (mode === 'sector' ? sectorKeyOf(c) : c.tk);
    const hasT = Object.values(t).some((v) => isNum(v) && v > 0);
    const histSet = new Set(R.items.filter((x) => x.n >= 60).map((x) => x.c.tk));
    let cands = M.companies.filter((c) => (hasT ? isNum(t[keyOf(c)]) && t[keyOf(c)] > 0 : histSet.has(c.tk)));
    if (!cands.length) cands = M.companies.slice();
    const w = new Map(M.companies.map((c) => [c.tk, c.value]));
    const dev = () => {
      if (!hasT) return 0;
      const tot = sum([...w.values()]); const g = new Map();
      M.companies.forEach((c) => { const k = keyOf(c); g.set(k, (g.get(k) || 0) + w.get(c.tk)); });
      let s = 0; Object.entries(t).forEach(([k, v]) => { if (isNum(v)) s += ((g.get(k) || 0) / tot - v / 100) ** 2; });
      return Math.sqrt(s);
    };
    const vol = () => volOfWeights(R, (tk) => w.get(tk) || 0);
    const v0 = vol(), d0 = dev();
    const steps = 10, chunk = amount / steps, cap = !hasT && cands.length >= 3 ? amount * 0.4 + 1e-9 : Infinity;
    const buy = new Map();
    if (amount > 0) {
      for (let s = 0; s < steps; s++) {
        let best = null;
        cands.forEach((c) => {
          if ((buy.get(c.tk) || 0) + chunk > cap) return;
          w.set(c.tk, w.get(c.tk) + chunk);
          const v = vol();
          const sc = (hasT ? dev() * 5 : 0) + (isNum(v) ? v : w.get(c.tk) / 1e7);
          if (!best || sc < best.sc - 1e-12) best = { c, sc };
          w.set(c.tk, w.get(c.tk) - chunk);
        });
        if (!best) break;
        w.set(best.c.tk, w.get(best.c.tk) + chunk);
        buy.set(best.c.tk, (buy.get(best.c.tk) || 0) + chunk);
      }
    }
    return { hasT, v0, v1: vol(), d0, d1: dev(), buys: [...buy.entries()].map(([tk, a]) => ({ c: M.byTk.get(tk), a })).sort((a, b) => b.a - a.a) };
  }

  function inlegTile() {
    if (!M.companies.length) return '';
    const P = inlegPlan(plan.amount);
    const rows = P.buys.length ? '<div class="legend-list advice">' + P.buys.map((o) =>
      '<button type="button" class="legend-row rowbtn" data-ticker="' + esc(o.c.tk) + '"><span class="nm"><b>' + esc(o.c.tk) + '</b> <span class="muted small">' + esc(o.c.name) + '</span></span>' +
      '<span class="muted small">' + esc(P1.format(o.a / plan.amount)) + '</span><b>' + esc(eur(o.a)) + '</b></button>').join('') + '</div>'
      : '<p class="muted">Vul een bedrag in.</p>';
    return '<section class="tile pad full inleg"><h3>Maandelijkse inleg-assistent</h3>' +
      '<div class="plan-amount"><label for="plan-amount">Ik stort</label><span class="eur-in">€<input id="plan-amount" type="number" inputmode="decimal" min="0" step="10" value="' + esc(plan.amount) + '"></span>' +
      segX('amt', [[50, '€ 50'], [100, '€ 100'], [250, '€ 250'], [500, '€ 500']], plan.amount, 'Bedrag kiezen') + '</div>' + rows +
      '<div class="sug-eff" style="margin-top:12px">' + lvlOf(P.v0) + '<span class="arr" aria-hidden="true">→</span>' + lvlOf(P.v1) + '<span class="small">' +
        (isNum(P.v0) && isNum(P.v1) ? 'beweeglijkheid ' + esc(P1.format(P.v0)) + ' → <b class="' + (P.v1 <= P.v0 + 1e-6 ? 'gain' : 'loss') + '">' + esc(P1.format(P.v1)) + '</b> per jaar' : 'risico nog niet te berekenen: te weinig koershistorie') + '</span></div>' +
      (P.hasT ? '<p class="small" style="margin-top:6px">Afstand tot je streefverdeling: ' + esc(N1.format(P.d0 * 100)) + ' → <b class="gain">' + esc(N1.format(P.d1 * 100)) + '</b> procentpunt</p>'
        : '<p class="small muted" style="margin-top:6px">Nog geen streefverdeling: de assistent kiest nu alleen wat het risico het meest verlaagt, met hoogstens 40% van het bedrag per positie. Vul hierboven doelen in om ook naar je verdeling toe te werken.</p>') +
      '<p class="sub" style="margin-top:8px">Het bedrag wordt in tien stukjes verdeeld. Elk stukje gaat naar de positie die je het dichtst bij je doelen brengt en het risico het meest verlaagt, gerekend met de koersen van het laatste jaar. Je verkoopt niets. Rekenvoorbeeld, geen beleggingsadvies.</p></section>';
  }

  // ---------- 2. Scenario's ----------
  const HIST_DROPS = {
    '2020': ['Coronacrash 2020', -0.34, -0.28, 'S&P 500 −34% in vijf weken; binnen ongeveer 5 maanden weer op het oude niveau.'],
    '2022': ['Rentestijging 2022', -0.25, -0.35, 'S&P 500 −25% en Nasdaq-100 −35% in ongeveer tien maanden; herstel duurde ongeveer 2 jaar.'],
    '2008': ['Kredietcrisis 2007–2009', -0.57, -0.54, 'S&P 500 −57% in 17 maanden; herstel duurde ruim 5 jaar.'],
    '2000': ['Internetbubbel 2000–2002', -0.49, -0.83, 'S&P 500 −49% en Nasdaq-100 −83%; de Nasdaq-100 had ongeveer 15 jaar nodig voor herstel.'],
  };
  const SCEN_OPTS = [['tech', 'Tech −20%'], ['usd', 'Dollar −10%'], ['2020', '2020'], ['2022', '2022'], ['2008', '2008'], ['2000', '2000']];
  function techShareOf(c) {
    const fk = fundKeyOf(c);
    if (fk) {
      const E = (data.etf || {})[fk];
      const cover = E ? sum(E.rows.map((r) => Number(r[3]) || 0)) : 0;
      if (E && cover >= 80) return { s: sum(E.rows.filter((r) => /information technology|technology/i.test(r[2] || '')).map((r) => Number(r[3]) || 0)) / 100, est: false };
      return { s: fk === 'NDX' ? 0.6 : 0.33, est: true };
    }
    if (isFundC(c)) return { s: 0.25, est: true };
    const p = M.mk.ok ? M.mk.profOf(c.tk) : null;
    return { s: p && p.sector === 'Technology' ? 1 : 0, est: !p };
  }
  function scenarioModel(k) {
    const D = HIST_DROPS[k];
    let est = false;
    const rows = M.companies.map((c) => {
      const fk = fundKeyOf(c);
      const p = M.mk.ok ? M.mk.profOf(c.tk) : null;
      let r = 0;
      if (k === 'tech') { const t = techShareOf(c); est = est || t.est; r = -0.2 * t.s; }
      else if (k === 'usd') { const part = fk ? 1 : c.cur === 'USD' ? 1 : isFundC(c) ? 0.7 : 0; r = -(1 - 1 / 1.1) * part; }
      else if (D) {
        if (fk === 'NDX') r = D[2]; else if (fk === 'SP500') r = D[1]; else if (isFundC(c)) r = D[1] * 0.9;
        else { const b = p && isNum(p.beta) && p.beta > 0 ? p.beta : p && p.sector === 'Technology' ? 1.3 : 1; if (!p) est = true; r = Math.max(-0.95, D[1] * b); }
      }
      return { c, r, loss: r * c.value };
    });
    const loss = sum(rows.map((x) => x.loss));
    return { rows: rows.filter((x) => x.loss < -0.005).sort((a, b) => a.loss - b.loss), loss, pct: M.totalValue ? loss / M.totalValue : null, est, D };
  }
  function scenarioTile() {
    if (!M.companies.length) return '';
    const k = xs.scen;
    const S = scenarioModel(k);
    const top = S.rows.slice(0, 6);
    const mx = Math.max(1e-9, ...top.map((x) => Math.abs(x.loss)));
    const what = k === 'tech' ? 'Alle technologiebedrijven 20% lager, ook die in je fondsen.' : k === 'usd' ? 'De dollar 10% minder waard tegenover de euro; koersen gelijk.' : S.D[3];
    return '<section class="tile pad full scen"><div class="plan-head"><h3>Scenario\'s</h3>' + segX('scen', SCEN_OPTS, k, 'Scenario kiezen') + '</div>' +
      '<p class="small">' + esc(what) + '</p>' +
      '<div class="scen-res"><div><span class="muted small">Effect op je beleggingen</span><b class="v big loss">' + esc(seur(S.loss)) + '</b><span class="loss">' + esc(spct1(S.pct)) + '</span></div>' +
      '<div><span class="muted small">Waarde daarna</span><b class="v big">' + esc(eur(M.totalValue + S.loss)) + '</b><span class="muted small">nu ' + esc(eur(M.totalValue)) + '</span></div></div>' +
      (top.length ? '<div class="hbars cmp" style="margin-top:12px">' + top.map((x) =>
        '<button type="button" class="r" data-ticker="' + esc(x.c.tk) + '" data-tip="' + esc(x.c.name + ': ' + spct1(x.r)) + '"><span class="tk">' + esc(x.c.tk) + '</span><span class="track"><span class="mid"></span><span class="neg" style="width:' + (Math.abs(x.loss) / mx * 50).toFixed(1) + '%"></span></span>' +
        '<span class="loss" style="text-align:right;font-weight:600">' + esc(seur(x.loss)) + '</span></button>').join('') + '</div>' : '<p class="muted" style="margin-top:10px">Dit scenario raakt je beleggingen nauwelijks.</p>') +
      '<p class="sub" style="margin-top:8px">' + (k.length === 4 ? 'Dalingen van toen in dollars, toegepast op je huidige verdeling: fondsen volgen hun index, losse aandelen de S&P 500 maal hun beta (gevoeligheid). ' : '') +
        (S.est ? 'Een deel is geschat omdat sector, beta of fondssamenstelling ontbreekt. ' : '') + 'Een rekenvoorbeeld; een echte daling verloopt altijd anders.</p></section>';
  }

  // ---------- 3. Dividendkalender ----------
  const freqWord = (g) => (!g ? '–' : g < 45 * DAY ? 'per maand' : g < 120 * DAY ? 'per kwartaal' : g < 250 * DAY ? 'per halfjaar' : 'per jaar');
  function divForecast() {
    const E = M.ev;
    const today = dayStart(Date.now());
    const start = new Date(today); start.setDate(1);
    const end = new Date(start); end.setMonth(end.getMonth() + 12);
    const endT = end.getTime();
    const hist = new Map();
    E.received.forEach((d) => { if (!hist.has(d.ticker)) hist.set(d.ticker, []); hist.get(d.ticker).push(d); });
    const ps = (d) => (isNum(d.perShare) && d.perShare > 0 ? d.perShare : isNum(d.qty) && d.qty > 0 ? d.amount / d.qty : null);
    const pays = [], info = [];
    M.companies.forEach((c) => {
      const list = hist.get(c.tk) || [];
      const seeds = E.divs.filter((u) => u.tk === c.tk);
      const fmp = ((data.events && data.events.dividends) || []).find((d) => d.ticker === c.tk);
      let gap = null;
      if (list.length >= 2) { const gs = list.slice(1).map((d, i) => d.t - list[i].t).filter((g) => g > 20 * DAY && g < 400 * DAY).sort((a, b) => a - b); if (gs.length) gap = gs[Math.floor(gs.length / 2)]; }
      if (!gap && fmp && FREQ_DAYS[String(fmp.frequency || '').toLowerCase()]) gap = FREQ_DAYS[String(fmp.frequency).toLowerCase()] * DAY;
      const L = list[list.length - 1];
      const base = L ? (L.qty && c.qty ? L.amount * c.qty / L.qty : L.amount) : seeds.length && isNum(seeds[0].eur) ? seeds[0].eur : null;
      const withPs = list.filter((d) => isNum(ps(d)));
      let growth = null, gSince = null;
      if (withPs.length >= 2) { const Lp = withPs[withPs.length - 1]; const ago = withPs.filter((d) => d.t <= Lp.t - 300 * DAY).pop() || withPs[0]; if (ago !== Lp) { growth = ps(Lp) / ps(ago) - 1; gSince = ago.t; } }
      const mine = [];
      seeds.forEach((u) => { const v = isNum(u.eur) ? u.eur : base; if (u.t <= endT && isNum(v)) mine.push({ tk: c.tk, t: u.t, eur: v, kind: u.kind }); });
      const t0 = mine.length ? mine[mine.length - 1].t : L && gap ? L.t : null;
      if (t0 != null && gap && isNum(base)) { let t = t0 + gap; while (t < today) t += gap; while (t <= endT) { mine.push({ tk: c.tk, t, eur: base, kind: 'Verwacht' }); t += gap; } }
      if (!mine.length && !list.length) return;
      mine.forEach((p) => pays.push(p));
      info.push({ c, gap, growth, gSince, next: mine[0] || null, total: sum(mine.map((p) => p.eur)), n: mine.length, perShare: L ? ps(L) : null });
    });
    const months = [];
    for (let i = 0; i < 12; i++) {
      const s = new Date(start.getFullYear(), start.getMonth() + i, 1).getTime(), e = new Date(start.getFullYear(), start.getMonth() + i + 1, 1).getTime();
      const inM = pays.filter((p) => p.t >= s && p.t < e);
      months.push({ t: s, v: sum(inM.map((p) => p.eur)), tks: [...new Set(inM.map((p) => p.tk))] });
    }
    return { months, info: info.sort((a, b) => b.total - a.total), total: sum(months.map((m) => m.v)) };
  }
  function divCalendarTile() {
    const F = divForecast();
    if (!F.info.length) return fullT('Dividendkalender', '<p class="muted">Nog geen dividend ontvangen of aangekondigd voor je posities. Na de eerste uitkeringen (of met een FMP-sleutel) zie je hier per maand wat er komt.</p>');
    const cost = sum(M.companies.map((c) => (isNum(c.cost) ? c.cost : 0)));
    return '<section class="tile pad full divcal"><h3>Dividendkalender, komende 12 maanden</h3>' +
      '<div class="fx-head"><span class="v big">' + esc(eur(F.total)) + '</span><span class="muted small">verwacht' + (cost > 0 ? ', ' + esc(P2.format(F.total / cost)) + ' op je inleg' : '') + ', ongeveer ' + esc(eur(F.total / 12)) + ' per maand</span></div>' +
      '<div style="margin-top:10px">' + bars(F.months.map((m) => ({ v: m.v, color: C.gain, tip: fMonY.format(m.t) + ': ' + eur(m.v) + (m.tks.length ? ' (' + m.tks.join(', ') + ')' : '') })), true) +
      barLabels(F.months.map((m) => fMon.format(m.t).replace('.', ''))) + '</div>' +
      '<div class="tbl-wrap" style="margin-top:14px"><table class="tbl"><thead><tr><th>Aandeel</th><th>Uitkering</th><th>Volgende</th><th class="num">Komende 12 mnd</th><th class="num">Groei per aandeel</th></tr></thead><tbody>' +
      F.info.map((x) => '<tr class="rowlink" data-ticker="' + esc(x.c.tk) + '"><td class="co"><b>' + esc(x.c.tk) + '</b><span class="nm">' + esc(x.c.name) + '</span></td><td>' + esc(freqWord(x.gap)) + '</td>' +
        '<td>' + esc(x.next ? fDM.format(x.next.t) + (x.next.kind === 'Aangekondigd' ? ' (aangekondigd)' : '') : '–') + '</td><td class="num">' + esc(eur(x.total)) + '</td>' +
        '<td class="num ' + tone(x.growth) + '">' + esc(isNum(x.growth) ? spct1(x.growth) : '–') + (x.gSince ? '<span class="sub">sinds ' + esc(fMonY.format(x.gSince)) + '</span>' : '') + '</td></tr>').join('') +
      '</tbody></table></div><p class="sub" style="margin-top:8px">Verwacht uit je eerdere uitkeringen (zelfde tussenpoos, bedrag naar je huidige aantal) en aangekondigde dividenden. Groei per aandeel: laatste uitkering per aandeel tegenover ongeveer een jaar eerder. Bedragen zijn netto zoals je ze ontving; aangekondigde zijn bruto. Dividend kan altijd worden verlaagd.</p></section>';
  }

  // ---------- 4. Belastinghulp box 3 ----------
  function fxOn(cur, t) {
    if (!cur || cur === 'EUR') return 1;
    const key = cur === 'GBX' ? 'GBP' : cur;
    const ser = data.fx && data.fx.rates && data.fx.rates[key];
    if (!ser || !ser.length) return null;
    let v = null;
    for (const [d, r] of ser) { if (ymd(d) <= t + 12 * HOUR) v = r; else break; }
    v = v || ser[0][1];
    return cur === 'GBX' ? v * 100 : v;
  }
  const WHT = { USD: 0.15, EUR: 0.15, GBP: 0, GBX: 0, CHF: 0.35, DKK: 0.27, CAD: 0.15 };
  const CUR_LAND = { USD: 'Verenigde Staten', EUR: 'Nederland en eurolanden', GBP: 'Verenigd Koninkrijk', GBX: 'Verenigd Koninkrijk', CHF: 'Zwitserland', DKK: 'Denemarken', CAD: 'Canada' };
  function curOfTk(tk) {
    const c = M.byTk.get(tk); if (c && c.cur) return c.cur;
    const x = M.tx.byTk.get(tk); if (x && x[0] && x[0].cur) return x[0].cur;
    return 'USD';
  }
  function divTax(d) {
    const cur = curOfTk(d.ticker);
    const rate = fxOn(cur, d.t);
    let gross = null, how = 'berekend';
    if (isNum(d.perShare) && isNum(d.qty) && d.qty > 0 && rate) gross = d.perShare * d.qty / rate;
    if (!isNum(gross) || gross < d.amount * 0.98 || gross > d.amount / 0.5) {
      const w = WHT[cur] != null ? WHT[cur] : 0.15;
      gross = d.amount / (1 - w); how = 'geschat';
    }
    return { cur, gross, tax: Math.max(0, gross - d.amount), how };
  }
  function box3Years() {
    const ys = new Set();
    (data.peil || []).forEach((p) => ys.add(Number(String(p.date).slice(0, 4))));
    M.ev.received.forEach((d) => ys.add(new Date(d.t).getFullYear()));
    M.weeks.forEach((w) => ys.add(new Date(w.t).getFullYear()));
    ys.add(new Date().getFullYear());
    return [...ys].filter(isNum).sort((a, b) => b - a).slice(0, 5);
  }
  function box3Model(Y) {
    const peil = (data.peil || []).find((p) => String(p.date).slice(0, 4) === String(Y));
    const jan = new Date(Y, 0, 1).getTime();
    const near = M.weeks.filter((w) => Math.abs(w.t - jan) <= 14 * DAY).sort((a, b) => Math.abs(a.t - jan) - Math.abs(b.t - jan))[0];
    const divs = M.ev.received.filter((d) => new Date(d.t).getFullYear() === Y).map((d) => Object.assign({ d }, divTax(d)));
    const per = new Map();
    divs.forEach((x) => { const o = per.get(x.d.ticker) || { tk: x.d.ticker, cur: x.cur, net: 0, gross: 0, tax: 0, n: 0, est: false }; o.net += x.d.amount; o.gross += x.gross; o.tax += x.tax; o.n++; o.est = o.est || x.how === 'geschat'; per.set(x.d.ticker, o); });
    const byCur = new Map();
    divs.forEach((x) => byCur.set(x.cur, (byCur.get(x.cur) || 0) + x.tax));
    return { Y, peil, near, divs, per: [...per.values()].sort((a, b) => b.net - a.net), byCur,
      net: sum(divs.map((x) => x.d.amount)), gross: sum(divs.map((x) => x.gross)), tax: sum(divs.map((x) => x.tax)), est: divs.some((x) => x.how === 'geschat') };
  }
  function box3Text(B) {
    const L = ['Overzicht voor de aangifte ' + B.Y + ' (Investeringstracker, geen fiscaal document)'];
    L.push('Waarde op 1 januari ' + B.Y + ': ' + (B.peil ? eur(B.peil.total) + ' (beleggingen ' + eur(B.peil.investments) + ', saldo ' + eur(B.peil.cash) + ')' : B.near ? eur(B.near.accountValue) + ' (geschat uit weekmeting ' + fDM.format(B.near.t) + ')' : 'onbekend'));
    L.push('Ontvangen dividend (netto): ' + eur(B.net));
    L.push('Dividend bruto' + (B.est ? ' (deels geschat)' : '') + ': ' + eur(B.gross));
    L.push('Ingehouden bronbelasting' + (B.est ? ' (deels geschat)' : '') + ': ' + eur(B.tax));
    B.byCur.forEach((v, cur) => { if (v > 0.004) L.push('  waarvan ' + (CUR_LAND[cur] || cur) + ': ' + eur(v)); });
    return L.join('\n');
  }
  function box3Tile() {
    const ys = box3Years();
    if (!xs.taxYear || !ys.includes(xs.taxYear)) xs.taxYear = ys.includes(new Date().getFullYear() - 1) ? new Date().getFullYear() - 1 : ys[0];
    const B = box3Model(xs.taxYear);
    const val = B.peil ? eur(B.peil.total) : B.near ? eur(B.near.accountValue) : '–';
    const valSub = B.peil ? 'beleggingen ' + eur(B.peil.investments) + ' en saldo ' + eur(B.peil.cash) + ', vastgelegd door de Worker' : B.near ? 'geschat uit de weekmeting van ' + fD.format(B.near.t) : 'geen meting rond 1 januari ' + B.Y;
    const other = accts();
    return '<section class="tile pad full box3"><div class="plan-head"><h3>Belastinghulp box 3</h3>' + segX('taxYear', ys.map((y) => [y, String(y)]), xs.taxYear, 'Belastingjaar') + '</div>' +
      '<div class="scen-res"><div><span class="muted small">Waarde op 1 januari ' + B.Y + '</span><b class="v big">' + esc(val) + '</b><span class="muted small">' + esc(valSub) + '</span></div>' +
      '<div><span class="muted small">Ontvangen dividend ' + B.Y + '</span><b class="v big">' + esc(eur(B.net)) + '</b><span class="muted small">netto, ' + B.divs.length + ' uitkeringen</span></div>' +
      '<div><span class="muted small">Ingehouden bronbelasting</span><b class="v big">' + esc(eur(B.tax)) + '</b><span class="muted small">' + (B.est ? 'deels geschat' : 'berekend') + ', bruto ' + esc(eur(B.gross)) + '</span></div></div>' +
      (B.per.length ? '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Aandeel</th><th>Land</th><th class="num">Netto</th><th class="num">Bruto</th><th class="num">Bronbelasting</th></tr></thead><tbody>' +
        B.per.map((o) => '<tr><td><b>' + esc(o.tk) + '</b></td><td>' + esc(CUR_LAND[o.cur] || o.cur) + '</td><td class="num">' + esc(eur(o.net)) + '</td><td class="num">' + esc(eur(o.gross)) + '</td><td class="num">' + esc(eur(o.tax)) + (o.est ? '<span class="sub">geschat</span>' : '') + '</td></tr>').join('') +
        '</tbody></table></div>' : '<p class="muted" style="margin-top:10px">Geen dividend ontvangen in ' + B.Y + '.</p>') +
      (other.length ? '<p class="small" style="margin-top:8px">Andere rekeningen (eigen invoer): ' + esc(other.map((a) => a.name + ' ' + eur(acctTotal(a)) + (a.updated ? ' per ' + a.updated : '')).join(', ')) + '. Vul daar zelf de stand op 1 januari in.</p>' : '') +
      '<div class="plan-actions" style="margin-top:12px"><button type="button" class="btn ghost" data-xa="box3-copy">Kopiëren</button><button type="button" class="btn ghost" data-xa="box3-csv">Dividend ' + B.Y + ' als CSV</button><span class="small plan-status" id="box3-status" role="status"></span></div>' +
      '<p class="sub" style="margin-top:8px">Bruto en bronbelasting volgen uit het bruto dividend per aandeel van Trading 212 en de ECB-koers van die dag; waar dat ontbreekt, is gerekend met het gebruikelijke tarief (VS 15% met W-8BEN, Nederland 15%). Nederlandse dividendbelasting en buitenlandse bronbelasting vul je in de aangifte apart in; of je ze kunt verrekenen hangt van je situatie af. Gebruik voor de aangifte het jaaroverzicht van Trading 212. Dit is geen belastingadvies.</p></section>';
  }

  // ---------- 5. Kostenoverzicht ----------
  function costModel() {
    const fee = (x) => (x.feeFx || 0) + (x.feeOther || 0);
    const tr = M.tx.trades.filter((x) => isNum(x.net) && x.net > 0);
    const years = new Map();
    tr.forEach((x) => { const y = new Date(x.t).getFullYear(); const o = years.get(y) || { y, n: 0, vol: 0, fees: 0, fx: 0 }; o.n++; o.vol += x.net; o.fees += fee(x); o.fx += x.feeFx || 0; years.set(y, o); });
    const paid = tr.filter((x) => fee(x) > 0);
    // Kosten = vast deel per order + percentage van het bedrag (kleinste kwadraten)
    let a = 0, b = 0;
    if (paid.length >= 3) {
      const mx = mean(paid.map((x) => x.net)), my = mean(paid.map(fee));
      const sxx = sum(paid.map((x) => (x.net - mx) ** 2));
      b = sxx > 0 ? sum(paid.map((x) => (x.net - mx) * (fee(x) - my))) / sxx : my / mx; a = my - b * mx;
      if (a < 0 || b < 0) { a = 0; b = sum(paid.map(fee)) / sum(paid.map((x) => x.net)); }
    } else if (paid.length) b = sum(paid.map(fee)) / sum(paid.map((x) => x.net));
    const yr = paid.filter((x) => x.t > Date.now() - 365 * DAY);
    const n12 = yr.length, vol12 = sum(yr.map((x) => x.net)), fees12 = sum(yr.map(fee));
    const alt = (k) => (n12 ? Math.min(fees12, Math.min(k, n12) * a + b * vol12) : null);
    return { tr, fee, years: [...years.values()].sort((p, q) => q.y - p.y), a, b, n12, vol12, fees12, monthly: alt(12), quarterly: alt(4),
      fx12: sum(tr.filter((x) => x.t > Date.now() - 365 * DAY).map((x) => x.feeFx || 0)), recent: tr.slice(-8).reverse() };
  }
  function costTile() {
    const K = costModel();
    if (!K.tr.length) return fullT('Kostenoverzicht', '<p class="muted">Nog geen orders opgehaald. De Worker haalt je orders één keer per dag op bij Trading 212.</p>');
    const flat = K.a < 0.01;
    return '<section class="tile pad full costs"><h3>Kostenoverzicht</h3>' +
      '<div class="scen-res"><div><span class="muted small">Laatste 12 maanden</span><b class="v big">' + esc(eur(K.fees12)) + '</b><span class="muted small">' + K.n12 + ' orders met kosten, ' + esc(eur(K.vol12)) + ' omgezet</span></div>' +
      '<div><span class="muted small">Per order gemiddeld</span><b class="v big">' + esc(eur(K.n12 ? K.fees12 / K.n12 : 0)) + '</b><span class="muted small">' + esc(K.vol12 ? P2.format(K.fees12 / K.vol12) : '–') + ' van het bedrag</span></div>' +
      '<div><span class="muted small">Waarvan wisselkosten</span><b class="v big">' + esc(eur(K.fx12)) + '</b><span class="muted small">bij aandelen in een andere munt dan euro</span></div></div>' +
      '<h3 style="margin-top:16px">Minder vaak, grotere aankopen</h3>' + kvList([
        ['Zoals nu (' + K.n12 + ' orders)', eur(K.fees12)],
        ['Eén keer per maand (12 orders)', isNum(K.monthly) ? eur(K.monthly) + ' (' + seur(K.monthly - K.fees12) + ')' : '–', isNum(K.monthly) && K.monthly < K.fees12 - 0.005 ? 'gain' : ''],
        ['Eén keer per kwartaal (4 orders)', isNum(K.quarterly) ? eur(K.quarterly) + ' (' + seur(K.quarterly - K.fees12) + ')' : '–', isNum(K.quarterly) && K.quarterly < K.fees12 - 0.005 ? 'gain' : ''],
        ['Kosten per order: vast deel en percentage', eur(K.a) + ' + ' + P2.format(K.b)],
      ]) +
      '<p class="small" style="margin-top:8px">' + esc(flat ? 'Je kosten zijn vrijwel alleen een percentage van het bedrag (bij Trading 212 vooral 0,15% wisselkosten). Grotere aankopen minder vaak scheelt daarom bijna niets. Wat wel scheelt: fondsen of aandelen die in euro noteren, zonder wisselkosten.' : 'Een deel van je kosten is een vast bedrag per order. Minder vaak, grotere aankopen scheelt dan echt geld.') + '</p>' +
      '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Jaar</th><th class="num">Orders</th><th class="num">Omgezet</th><th class="num">Kosten</th><th class="num">Per order</th></tr></thead><tbody>' +
      K.years.map((o) => '<tr><td>' + o.y + '</td><td class="num">' + o.n + '</td><td class="num">' + esc(eur(o.vol)) + '</td><td class="num">' + esc(eur(o.fees)) + '</td><td class="num">' + esc(eur(o.n ? o.fees / o.n : 0)) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<h3 style="margin-top:16px">Laatste orders</h3><div class="tx-list">' + K.recent.map((x) =>
        '<div class="tx"><span class="tag' + (x.side === 'SELL' ? ' loss' : ' gain') + '">' + (x.side === 'SELL' ? 'Verkoop' : 'Koop') + '</span><span class="tx-m"><b>' + esc(x.tk) + ' ' + esc(eur(x.net)) + '</b><span class="sub">' + esc(fD.format(x.t)) + ' · ' + esc(x.cur || '') + '</span></span>' +
        '<span class="tx-v">' + esc(eur(K.fee(x))) + '<span class="sub">' + esc(P2.format(K.fee(x) / x.net)) + '</span></span></div>').join('') + '</div>' +
      '<p class="sub" style="margin-top:8px">Kosten per order volgens Trading 212. Vast deel en percentage zijn geschat uit je eigen orders.</p></section>';
  }

  // ---------- 6. Aankoopdagboek ----------
  const notesMap = () => (M.settings && M.settings.notes) || {};
  const noteKey = (x) => x.tk + '|' + x.t;
  let noteSeq = 0;
  function noteBlock(x) {
    const k = noteKey(x), n = notesMap()[k];
    const id = 'ni-' + (++noteSeq), noteId = () => id;
    return '<div class="note" data-note="' + esc(k) + '">' + (n ? '<p class="note-t">“' + esc(n) + '”</p>' : '') +
      '<button type="button" class="linklike small" data-xa="note-edit" data-k="' + esc(k) + '">' + (n ? 'Notitie bewerken' : 'Waarom gekocht? Notitie toevoegen') + '</button>' +
      '<div class="note-ed" hidden><label class="sr-only" for="' + noteId(k) + '">Notitie bij deze aankoop</label><textarea id="' + noteId(k) + '" maxlength="500" rows="3" placeholder="Waarom kocht je dit? Wat verwacht je?">' + esc(n || '') + '</textarea>' +
      '<span class="note-acts"><button type="button" class="btn primary" data-xa="note-save" data-k="' + esc(k) + '">Opslaan</button><button type="button" class="btn ghost" data-xa="note-cancel">Annuleren</button><span class="small note-st" role="status"></span></span></div></div>';
  }
  function sinceBuy(x) {
    const c = M.byTk.get(x.tk);
    if (!c || !isNum(c.priceNative) || !(x.price > 0) || (c.cur && x.cur && c.cur !== x.cur)) return null;
    return c.priceNative / x.price - 1;
  }
  function journalTile() {
    const buys = M.tx.buys.slice().reverse();
    if (!buys.length) return fullT('Aankoopdagboek', '<p class="muted">Na je eerste aankoop kun je hier per aankoop kort noteren waarom je kocht, en later zien hoe het uitpakte.</p>');
    const N = notesMap();
    const withN = buys.filter((x) => N[noteKey(x)]);
    const show = withN.concat(buys.filter((x) => !N[noteKey(x)]).slice(0, 5)).sort((a, b) => b.t - a.t);
    const res = withN.map(sinceBuy).filter(isNum);
    return '<section class="tile pad full journal"><h3>Aankoopdagboek</h3>' +
      '<p class="small">' + withN.length + ' van ' + buys.length + ' aankopen hebben een notitie' + (res.length ? '; die staan gemiddeld <b class="' + tone(mean(res)) + '">' + esc(spct1(mean(res))) + '</b> sinds aankoop' : '') + '.</p>' +
      '<div class="tx-list" style="margin-top:8px">' + show.map((x) => { const r = sinceBuy(x);
        return '<div class="tx"><span class="tag gain">Koop</span><span class="tx-m"><b>' + esc(x.tk) + ' · ' + esc(eur(x.net)) + '</b><span class="sub">' + esc(fD.format(x.t) + ' ' + new Date(x.t).getFullYear()) + ' · ' + esc(N4.format(x.qty)) + ' × ' + esc(money(x.price, x.cur)) + '</span></span>' +
          '<span class="tx-v ' + tone(r) + '">' + esc(isNum(r) ? spct1(r) : M.byTk.has(x.tk) ? '–' : 'verkocht') + '<span class="sub">sinds aankoop</span></span></div>' + noteBlock(x); }).join('') + '</div>' +
      '<p class="sub" style="margin-top:8px">Resultaat: de koers nu tegenover je aankoopkoers, in de munt van het aandeel. Notities staan in je eigen Worker.</p></section>';
  }

  // ---------- 7. Twee aandelen vergelijken ----------
  function cmpOptions() {
    const o = M.companies.filter((c) => !isFundC(c)).sort((a, b) => b.value - a.value).map((c) => [c.tk, c.tk + ' · ' + c.name]);
    M.companies.filter(isFundC).forEach((c) => o.push([c.tk, c.tk + ' · ' + c.name]));
    watchSyms().forEach((s) => o.push(['~' + s, s + ' (volglijst)']));
    return o;
  }
  function cmpObj(k) {
    if (!k) return null;
    if (isWatchKey(k)) return watchSyms().includes(k.slice(1)) ? Object.assign(watchPseudo(k.slice(1)), { key: k }) : null;
    const c = M.byTk.get(k);
    return c ? Object.assign({}, c, { key: k }) : null;
  }
  function growthSeries(o) {
    const R = riskModel();
    const it = !o.watch && R.items.find((x) => x.c.tk === o.tk);
    if (it && it.n >= 20) { const ds = [...it.rets.keys()].sort(); let v = 1; return ds.map((d) => { v *= 1 + it.rets.get(d); return { day: d, v }; }); }
    if (M.mk.ok) return M.mk.prices(o.watch ? o.tk : M.mk.sym(o.tk)).map((p) => ({ day: p.day, v: p.v }));
    return [];
  }
  function finGrowth(Fin) {
    const S = (Fin && Fin.series) || {};
    const rev = new Map((S.rev && S.rev.rows) || []), net = new Map((S.net && S.net.rows) || []);
    const ys = [...rev.keys()].sort((a, b) => a - b); const ly = ys[ys.length - 1], py = ys[ys.length - 2];
    return { growth: ly && py && rev.get(py) ? rev.get(ly) / rev.get(py) - 1 : null, margin: ly && rev.get(ly) && isNum(net.get(ly)) ? net.get(ly) / rev.get(ly) : null };
  }
  function recOf(tk) {
    const r = (data.research || {})[tk];
    const rec = r && r.rec && r.rec[0];
    if (!rec) return null;
    const tot = (rec.sb || 0) + (rec.b || 0) + (rec.h || 0) + (rec.s || 0) + (rec.ss || 0);
    if (!tot) return null;
    const old = r.rec[3] || r.rec[r.rec.length - 1];
    const bs = (x) => { const t = (x.sb || 0) + (x.b || 0) + (x.h || 0) + (x.s || 0) + (x.ss || 0); return t ? ((x.sb || 0) + (x.b || 0)) / t : null; };
    return { tot, buy: bs(rec), sell: ((rec.s || 0) + (rec.ss || 0)) / tot, trend: old && old !== rec && isNum(bs(old)) ? bs(rec) - bs(old) : null, rec };
  }
  function upsideOf(o) {
    const r = (data.research || {})[o.tk];
    const p = M.mk.ok ? M.mk.prof(o.watch ? o.tk : M.mk.sym(o.tk)) : null;
    const price = isNum(o.priceNative) ? o.priceNative : p && p.price;
    return r && r.target && isNum(r.target.mean) && price ? r.target.mean / price - 1 : null;
  }
  function cmpFacts(o) {
    const R = riskModel();
    const it = !o.watch ? R.items.find((x) => x.c.tk === o.tk) : null;
    const p = M.mk.ok ? M.mk.prof(o.watch ? o.tk : M.mk.sym(o.tk)) : null;
    const V = valuationOf(o), g = finGrowth((data.fin || {})[o.tk]), rc = recOf(o.tk), up = upsideOf(o), rel = analystReliability(o.tk);
    let mdd = null;
    if (it && it.n >= 60) { let v = 1, pk = 1, m = 0; [...it.rets.keys()].sort().slice(-260).forEach((d) => { v *= 1 + it.rets.get(d); pk = Math.max(pk, v); m = Math.min(m, v / pk - 1); }); mdd = m; }
    const price = isNum(o.priceNative) ? o.priceNative : p && p.price;
    return [
      ['Koers', isNum(price) ? money(price, o.cur || (p && p.currency)) : '–'],
      ['In bezit', o.watch ? 'volglijst' : eur(o.value) + (isNum(o.weight) ? ' (' + P1.format(o.weight) + ')' : '')],
      ['Sinds aankoop', o.watch ? '–' : spct1(o.resultPct), o.watch ? '' : tone(o.resultPct)],
      ['Beweeglijkheid per jaar', it && isNum(it.vol) ? P1.format(it.vol) : '–'],
      ['Risicoklasse (1–7)', it && it.cls ? String(it.cls) : '–'],
      ['Grootste daling, laatste jaar', isNum(mdd) ? spct1(mdd) : '–', isNum(mdd) ? 'loss' : ''],
      ['Beta', p && isNum(p.beta) && p.beta > 0 ? N2.format(p.beta) : '–'],
      ['Sector', isFundC(o) ? 'Fonds' : p ? sectorNl(p.sector) : '–'],
      ['Beurswaarde', p ? mcap(p.marketCap, p.currency) : '–'],
      ['Omzetgroei, laatste jaar', isNum(g.growth) ? spct1(g.growth) : '–', tone(g.growth)],
      ['Nettomarge', isNum(g.margin) ? P1.format(g.margin) : '–'],
      ['Koers-winstverhouding', isNum(V.pe) && V.pe > 0 ? N1.format(V.pe) : '–'],
      ['Dividendrendement', isNum(V.dy) ? P2.format(V.dy) : '–'],
      ['Analisten: kopen', rc ? P1.format(rc.buy) + ' van ' + rc.tot : '–'],
      ['Koersdoel tegenover koers', isNum(up) ? spct1(up) : '–', tone(up)],
      ['Betrouwbaarheid analisten', rel ? rel.word + ' (' + rel.score + '/10)' : '–'],
    ];
  }
  function renderCompareView() {
    const opts = cmpOptions(), keys = opts.map((o) => o[0]);
    if (!keys.includes(xs.cmpA)) xs.cmpA = keys[0] || null;
    if (!keys.includes(xs.cmpB) || xs.cmpB === xs.cmpA) xs.cmpB = keys.find((k) => k !== xs.cmpA) || null;
    const A = cmpObj(xs.cmpA), B = cmpObj(xs.cmpB);
    const sel = (id, cur) => '<label class="cmp-sel"><span class="small muted">' + (id === 'cmpA' ? 'Eerste aandeel' : 'Tweede aandeel') + '</span><select data-cmp="' + id + '">' +
      opts.map(([k, l]) => '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>';
    if (!A || !B) return pseudoPage('Vergelijken', pseudoHead('Vergelijken', 'Twee aandelen', 'Hiervoor zijn minstens twee posities of volgaandelen nodig.'), [[]], []);
    const fa = cmpFacts(A), fb = cmpFacts(B);
    const pickers = '<section class="tile pad full"><h3>Kies twee aandelen</h3><div class="cmp-pick">' + sel('cmpA', xs.cmpA) + sel('cmpB', xs.cmpB) + '</div></section>';
    const chart = '<section class="tile pad full"><h3>Koers, laatste jaar</h3><div class="chart" data-chart="cmp" style="height:220px"></div><div class="xlabels" data-x="cmp"></div>' +
      '<div class="legend chart-legend" data-legend="cmp" style="margin-top:8px"></div><p class="sub" style="margin-top:8px">Groei vanaf dezelfde startdag. Posities in euro (met valuta-effect), volgaandelen in hun eigen munt.</p></section>';
    const table = '<section class="tile pad full"><h3>Naast elkaar</h3><div class="tbl-wrap"><table class="tbl cmp-tbl"><thead><tr><th></th><th class="num">' + esc(A.tk) + '</th><th class="num">' + esc(B.tk) + '</th></tr></thead><tbody>' +
      fa.map((r, i) => '<tr><td>' + esc(r[0]) + '</td><td class="num ' + (r[2] || '') + '">' + esc(r[1]) + '</td><td class="num ' + (fb[i][2] || '') + '">' + esc(fb[i][1]) + '</td></tr>').join('') +
      '</tbody></table></div><p class="sub" style="margin-top:8px">Bronnen: Trading 212, FMP (sector, beta, waardering), SEC (cijfers) en Finnhub (analisten). Een streepje: gegevens ontbreken.</p></section>';
    return pseudoPage('Vergelijken', pseudoHead('Vergelijken', A.tk + ' en ' + B.tk, A.name + ' tegenover ' + B.name), [[pickers], [chart], [table]], [pickers, chart, table]);
  }
  function drawCompare(root) {
    const host = root.querySelector('[data-chart="cmp"]');
    const A = cmpObj(xs.cmpA), B = cmpObj(xs.cmpB);
    if (!host || !A || !B) return;
    const a = growthSeries(A), b = growthSeries(B);
    const start = [a[0] && a[0].day, b[0] && b[0].day].filter(Boolean).sort().pop();
    const norm = (s) => { const f = s.filter((p) => p.day >= start).slice(-260); const v0 = f.length ? f[0].v : 1; return f.map((p) => ({ t: ymd(p.day), v: p.v / v0 - 1 })); };
    const pa = start ? norm(a) : [], pb = start ? norm(b) : [];
    lineChart(host, [{ pts: pa, color: C.accent, width: 3, label: A.tk, fmt: spct1 }, { pts: pb, color: '#B45309', width: 2.5, label: B.tk, fmt: spct1 }], {
      animate: true, zero: true, xl: root.querySelector('[data-x="cmp"]'), xcount: 4, xfmt: (t) => fDM.format(t), tfmt: (t) => fD.format(t),
      empty: 'Nog te weinig koershistorie van een van beide om ze naast elkaar te zetten.' });
    const lg = root.querySelector('[data-legend="cmp"]');
    const last = (p) => (p.length ? p[p.length - 1].v : null);
    if (lg) lg.innerHTML = '<span><i style="background:' + C.accent + '"></i>' + esc(A.tk) + ' ' + esc(spct1(last(pa))) + '</span><span><i style="background:#B45309"></i>' + esc(B.tk) + ' ' + esc(spct1(last(pb))) + '</span>';
  }

  // ---------- 8. Waardering ----------
  function valuationOf(o) {
    const out = { pe: null, dy: null, hist: [], avgPe: null, avgDy: null, secPe: null, src: null, sector: null };
    if (isFundC(o)) return out;
    const mk = data.market || {};
    const sym = o.watch ? o.tk : M.mk.ok ? M.mk.sym(o.tk) : o.tk;
    const p = M.mk.ok ? M.mk.prof(sym) : null;
    const V = (mk.valuation || {})[sym] || null;
    if (V) { out.pe = isNum(V.pe) ? V.pe : null; out.dy = isNum(V.dy) ? V.dy : null; out.src = 'FMP'; }
    const Fin = (data.fin || {})[o.tk];
    if (!isNum(out.pe) && p && isNum(p.price) && Fin && Fin.series && Fin.series.eps) {
      const rows = Fin.series.eps.rows || []; const L = rows[rows.length - 1];
      if (L && L[1] > 0 && String(Fin.series.eps.unit || 'USD').startsWith(p.currency || 'USD')) { out.pe = p.price / L[1]; out.src = 'berekend uit koers en winst per aandeel (SEC)'; }
    }
    if (!isNum(out.dy) && p && isNum(p.lastDividend) && isNum(p.price) && p.price > 0) out.dy = p.lastDividend / p.price;
    out.hist = ((V && V.hist) || []).filter((r) => isNum(r[1]) && r[1] > 0 && r[1] < 400);
    if (out.hist.length >= 2) out.avgPe = mean(out.hist.map((r) => r[1]));
    const dh = ((V && V.hist) || []).filter((r) => isNum(r[2]));
    if (dh.length >= 2) out.avgDy = mean(dh.map((r) => r[2]));
    out.sector = p && p.sector;
    out.secPe = p && p.sector && mk.sectorPe && mk.sectorPe.sectors ? mk.sectorPe.sectors[p.sector] || null : null;
    return out;
  }
  const relWord = (d, what) => (!isNum(d) ? '' : Math.abs(d) < 0.1 ? 'ongeveer gelijk aan ' + what : (d > 0 ? 'duurder dan ' : 'goedkoper dan ') + what + ' (' + spct1(d) + ')');
  function valuationTile(c) {
    if (isFundC(c)) return '';
    const V = valuationOf(c);
    if (!isNum(V.pe) && !isNum(V.dy) && !V.hist.length) {
      return offTile('Waardering', (data.market && data.market.valDenied) ? 'Waarderingscijfers zitten niet in je FMP-abonnement; met SEC-cijfers rekent de tracker de koers-winstverhouding zelf uit zodra die er zijn.' : FEAT().has.fmp || demo ? 'Nog geen waarderingscijfers opgehaald; ze komen wekelijks van Financial Modeling Prep.' : 'Waardering vraagt een gratis FMP-sleutel (Financial Modeling Prep).');
    }
    const loss = isNum(V.pe) && V.pe <= 0;
    const vsOwn = !loss && isNum(V.pe) && isNum(V.avgPe) ? V.pe / V.avgPe - 1 : null;
    const vsSec = !loss && isNum(V.pe) && isNum(V.secPe) ? V.pe / V.secPe - 1 : null;
    const said = [relWord(vsOwn, 'het eigen gemiddelde'), relWord(vsSec, 'de sector')].filter(Boolean).join(' en ');
    const peBars = V.hist.length ? '<div style="margin-top:10px">' + bars(V.hist.map((r) => ({ v: r[1], color: C.soft, tip: r[0] + ': ' + N1.format(r[1]) })).concat(isNum(V.pe) && !loss ? [{ v: V.pe, color: C.accent, tip: 'Nu: ' + N1.format(V.pe) }] : []), true) +
      barLabels(V.hist.map((r) => r[0]).concat(isNum(V.pe) && !loss ? ['nu'] : [])) + '</div>' : '';
    return '<section class="tile pad"><h3>Waardering</h3>' + (said ? '<p class="small"><b>Koers-winstverhouding ' + esc(said) + '.</b></p>' : '') + peBars +
      '<div style="margin-top:8px">' + kvList([
        ['Koers-winstverhouding nu', loss ? 'geen (verlies)' : isNum(V.pe) ? N1.format(V.pe) : '–'],
        ['Eigen gemiddelde', isNum(V.avgPe) ? N1.format(V.avgPe) + ' over ' + V.hist.length + ' jaar (' + N1.format(Math.min(...V.hist.map((r) => r[1]))) + '–' + N1.format(Math.max(...V.hist.map((r) => r[1]))) + ')' : '–'],
        ['Sector' + (V.sector ? ' (' + sectorNl(V.sector) + ')' : ''), isNum(V.secPe) ? N1.format(V.secPe) : '–'],
        ['Dividendrendement nu', isNum(V.dy) ? P2.format(V.dy) : 'geen dividend'],
        ['Dividendrendement gemiddeld', isNum(V.avgDy) ? P2.format(V.avgDy) : '–'],
      ]) + '</div><p class="sub" style="margin-top:8px">Koers-winstverhouding: hoeveel jaar winst je betaalt voor de koers. Hoog betekent meestal dat beleggers veel groei verwachten, niet per se dat het aandeel te duur is. Bron: ' + esc(V.src || 'FMP') + '.</p></section>';
  }
  function renderValuationList() {
    const rows = M.companies.filter((c) => !isFundC(c)).map((c) => ({ c, V: valuationOf(c) })).filter((x) => isNum(x.V.pe) || isNum(x.V.dy));
    const html = rows.length ? '<section class="tile pad"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bedrijf</th><th class="num">K/W nu</th><th class="num">Eigen gemiddelde</th><th class="num">Sector</th><th class="num">Dividend nu</th><th class="num">Gemiddeld</th></tr></thead><tbody>' +
      rows.map(({ c, V }) => { const d = isNum(V.pe) && V.pe > 0 && isNum(V.avgPe) ? V.pe / V.avgPe - 1 : null;
        return '<tr class="rowlink" data-ticker="' + esc(c.tk) + '"><td class="co"><b>' + esc(c.tk) + '</b><span class="nm">' + esc(c.name) + '</span></td>' +
          '<td class="num">' + esc(isNum(V.pe) ? (V.pe > 0 ? N1.format(V.pe) : 'verlies') : '–') + (isNum(d) ? '<span class="sub ' + (d > 0.1 ? 'loss' : d < -0.1 ? 'gain' : '') + '">' + esc(spct1(d)) + '</span>' : '') + '</td>' +
          '<td class="num">' + esc(isNum(V.avgPe) ? N1.format(V.avgPe) : '–') + '</td><td class="num">' + esc(isNum(V.secPe) ? N1.format(V.secPe) : '–') + '</td>' +
          '<td class="num">' + esc(isNum(V.dy) ? P2.format(V.dy) : '–') + '</td><td class="num">' + esc(isNum(V.avgDy) ? P2.format(V.avgDy) : '–') + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="sub" style="margin-top:8px">K/W: koers-winstverhouding. Klein getal onder K/W: tegenover het eigen gemiddelde van de laatste jaren. Bron: FMP, of berekend uit SEC-cijfers.</p></section>'
      : '<p class="empty">Waarderingscijfers komen wekelijks van Financial Modeling Prep (gratis sleutel). Ze zijn er nog niet.</p>';
    if ($('val-grid')) $('val-grid').innerHTML = html;
    if ($('m-val')) $('m-val').innerHTML = html;
  }

  // ---------- 9. Overlap met je fondsen ----------
  function overlapModel() {
    if (M._ovl) return M._ovl;
    const etf = data.etf || {};
    const funds = M.companies.filter((c) => fundKeyOf(c)).map((c) => ({ c, k: fundKeyOf(c), E: etf[fundKeyOf(c)] || null }));
    const per = new Map();
    funds.forEach((f) => {
      if (!f.E) return;
      const acc = new Map();
      f.E.rows.forEach((r) => { const k = normTk(r[0]); acc.set(k, (acc.get(k) || 0) + (Number(r[3]) || 0)); });
      acc.forEach((w, k) => { const a = per.get(k) || []; a.push({ f: f.c, w, eur: f.c.value * w / 100 }); per.set(k, a); });
    });
    M._ovl = { funds, per, missing: funds.filter((f) => !f.E) };
    return M._ovl;
  }
  function overlapTileC(c) {
    if (isFundC(c)) return '';
    const O = overlapModel();
    if (!O.funds.length) return '';
    const list = O.per.get(normTk(c.tk)) || [];
    const via = sum(list.map((x) => x.eur)), tot = c.value + via;
    return '<section class="tile pad"><h3>Ook in je fondsen</h3>' + kvList([['Los in bezit', eur(c.value)]].concat(
      O.funds.map((f) => { const x = list.find((y) => y.f === f.c); return ['Via ' + f.c.tk, !f.E ? 'samenstelling ontbreekt' : x ? eur(x.eur) + ' (' + N2.format(x.w) + '% van het fonds)' : 'niet in dit fonds']; }),
      [['Samen', eur(tot) + ' (' + (M.totalValue ? P1.format(tot / M.totalValue) : '–') + ' van je beleggingen)'], ['Deel via fondsen', tot ? P1.format(via / tot) : '–']])) +
      '<span class="bar-mini wide" style="width:100%;margin-top:10px" aria-hidden="true"><i style="width:' + (tot ? c.value / tot * 100 : 0).toFixed(1) + '%"></i><i class="via" style="width:' + (tot ? via / tot * 100 : 0).toFixed(1) + '%"></i></span>' +
      '<p class="sub" style="margin-top:8px">Donker: los gekocht. Licht: via je indexfondsen.' + (O.missing.length ? ' Voeg de samenstelling van ' + esc(O.missing.map((f) => f.c.tk).join(' en ')) + ' toe op Plannen.' : '') + '</p></section>';
  }
  function overlapTile() {
    const O = overlapModel();
    if (!O.funds.length) return '';
    const stocks = M.companies.filter((c) => !isFundC(c));
    if (!stocks.length) return '';
    if (O.missing.length === O.funds.length) return fullT('Overlap met je fondsen', '<p class="muted">Hiervoor is de samenstelling van ' + esc(O.funds.map((f) => f.c.tk).join(' en ')) + ' nodig. Voeg die toe bij Werkelijke spreiding hieronder.</p>');
    const rows = stocks.map((c) => { const list = O.per.get(normTk(c.tk)) || []; const via = sum(list.map((x) => x.eur)); return { c, list, via, tot: c.value + via }; }).sort((a, b) => b.tot - a.tot);
    return '<section class="tile pad full"><h3>Overlap met je fondsen</h3><p class="sub">Per los aandeel: hoeveel je er daarnaast al van hebt via ' + esc(O.funds.map((f) => f.c.tk).join(' en ')) + '.</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Aandeel</th><th class="num">Los</th>' + O.funds.map((f) => '<th class="num">Via ' + esc(f.c.tk) + '</th>').join('') + '<th class="num">Samen</th><th class="num">Deel via fondsen</th></tr></thead><tbody>' +
      rows.map((r) => '<tr class="rowlink" data-ticker="' + esc(r.c.tk) + '"><td class="co"><b>' + esc(r.c.tk) + '</b><span class="nm">' + esc(r.c.name) + '</span></td><td class="num">' + esc(eur(r.c.value)) + '</td>' +
        O.funds.map((f) => { const x = r.list.find((y) => y.f === f.c); return '<td class="num">' + esc(!f.E ? '?' : x ? eur(x.eur) : '–') + '</td>'; }).join('') +
        '<td class="num"><b>' + esc(eur(r.tot)) + '</b></td><td class="num">' + esc(r.tot ? P1.format(r.via / r.tot) : '–') + '</td></tr>').join('') +
      '</tbody></table></div><p class="sub" style="margin-top:8px">Uit de samenstelling van de indexfondsen (iShares-bestand per index). Een streepje: het bedrijf zit niet in het fonds (of niet bij de grootste posities in het bestand).</p></section>';
  }

  // ---------- 10. Weekoverzicht delen ----------
  function weekShareModel() {
    const W = M.weeks.filter((w) => isNum(w.weekResult));
    const lw = W[W.length - 1];
    if (!lw) return null;
    const from = lw.t - 7 * DAY;
    const movers = M.companies.map((c) => {
      const r = dailyReturns(c.tk).filter((d) => d.t > from && d.t <= lw.t + DAY);
      if (!r.length) return null; let v = 1; r.forEach((d) => { v *= 1 + d.pct; }); return { c, pct: v - 1 };
    }).filter(Boolean).sort((a, b) => b.pct - a.pct);
    const pts = seriesFor(TOTAL, 'all').filter((p) => p.t > from - DAY && p.t <= lw.t + DAY);
    const up = movers.slice(0, 3);
    return { lw, pts, up, down: movers.slice(-3).reverse().filter((m) => !up.includes(m)) };
  }
  const wsHide = () => (xs.wsHide == null ? hideAmounts : xs.wsHide);
  function weekShareText(S, hide) {
    const L = ['Weekoverzicht tot ' + fD.format(S.lw.t) + ' ' + new Date(S.lw.t).getFullYear(), 'Rendement deze week: ' + spct1(S.lw.weekResultPct) + (hide ? '' : ' (' + seur(S.lw.weekResult) + ')')];
    if (!hide) L.push('Accountwaarde: ' + EUR.format(S.lw.accountValue));
    if (S.up.length) L.push('Stijgers: ' + S.up.map((m) => m.c.tk + ' ' + spct1(m.pct)).join(', '));
    if (S.down.length) L.push('Dalers: ' + S.down.map((m) => m.c.tk + ' ' + spct1(m.pct)).join(', '));
    L.push('', 'Gemaakt met Investeringstracker');
    return L.join('\n');
  }
  function weekShareTile() {
    const S = weekShareModel();
    if (!S) return fullT('Weekoverzicht delen', '<p class="muted">Na de eerste twee weekmetingen (zaterdag) kun je hier je week delen als afbeelding of e-mail.</p>');
    return '<section class="tile pad full wshare"><h3>Weekoverzicht delen</h3><div class="ws-grid"><canvas class="ws-canvas" width="1080" height="1080" aria-label="Voorbeeld van de afbeelding"></canvas>' +
      '<div><label class="check"><input type="checkbox" data-xa="ws-hide"' + (wsHide() ? ' checked' : '') + '> Zonder bedragen (alleen procenten)</label>' +
      '<div class="plan-actions" style="margin:10px 0"><button type="button" class="btn primary" data-xa="ws-share">Delen</button><button type="button" class="btn ghost" data-xa="ws-png">Afbeelding opslaan</button><button type="button" class="btn ghost" data-xa="ws-mail">Per e-mail</button></div>' +
      '<span class="small plan-status" id="ws-status" role="status"></span>' +
      '<p class="sub" style="margin-top:8px">De afbeelding wordt in je browser gemaakt; er gaat niets naar een server. "Per e-mail" opent je eigen mailprogramma met de tekst. Automatisch elke week mailen kan de Worker niet zonder een mailservice; zet in je agenda of telefoon een wekelijkse herinnering.</p></div></div></section>';
  }
  function paintWeek(cv, S, hide) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const F = (w, s) => w + ' ' + s + 'px Figtree, system-ui, sans-serif';
    const gain = '#0B7A4B', loss = '#B4311F', ink = '#14181F', ink2 = '#5B6472', acc = '#2B5BD7';
    g.fillStyle = '#E8EDFA'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#FFFFFF'; if (g.roundRect) { g.beginPath(); g.roundRect(48, 300, W - 96, H - 396, 36); g.fill(); } else g.fillRect(48, 300, W - 96, H - 396);
    g.fillStyle = ink2; g.font = F(600, 34); g.fillText(T('Weekoverzicht') + ' · ' + fD.format(S.lw.t) + ' ' + new Date(S.lw.t).getFullYear(), 64, 96);
    const pct = S.lw.weekResultPct;
    g.fillStyle = pct >= 0 ? gain : loss; g.font = F(700, 120); g.fillText(spct1(pct), 64, 228);
    g.fillStyle = ink2; g.font = F(500, 34); g.fillText(hide ? T('rendement deze week') : seur(S.lw.weekResult) + ' · ' + T('accountwaarde') + ' ' + EUR.format(S.lw.accountValue), 64, 278);
    const pts = S.pts.filter((p) => isNum(p.v));
    if (pts.length >= 2) {
      let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v)); if (!(hi > lo)) { hi += 1; lo -= 1; }
      const X = (i) => 96 + i / (pts.length - 1) * (W - 192), Y = (v) => 360 + (hi - v) / (hi - lo) * 260;
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p.v)) : g.moveTo(X(i), Y(p.v))));
      g.strokeStyle = acc; g.lineWidth = 7; g.lineJoin = 'round'; g.stroke();
      g.lineTo(X(pts.length - 1), 640); g.lineTo(X(0), 640); g.closePath(); g.fillStyle = 'rgba(43,91,215,.10)'; g.fill();
    }
    const col = (x, title, list) => {
      g.fillStyle = ink; g.font = F(700, 36); g.fillText(T(title), x, 720);
      list.forEach((m, i) => { g.fillStyle = ink; g.font = F(600, 38); g.fillText(m.c.tk, x, 784 + i * 62); g.fillStyle = m.pct >= 0 ? gain : loss; g.textAlign = 'right'; g.fillText(spct1(m.pct), x + 400, 784 + i * 62); g.textAlign = 'left'; });
    };
    col(96, 'Stijgers', S.up); col(W / 2 + 24, 'Dalers', S.down);
    g.fillStyle = ink2; g.font = F(600, 28); g.fillText('Investeringstracker', 64, H - 44);
  }
  function drawWeekShare(root) {
    const cv = root.querySelector('.ws-canvas'); const S = weekShareModel();
    if (!cv || !S) return;
    const go = () => paintWeek(cv, S, wsHide());
    go(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(go);
  }
  async function shareWeek(kind, btn) {
    const S = weekShareModel(); if (!S) return;
    const host = btn.closest('.wshare'); const cv = host.querySelector('.ws-canvas'); const st = host.querySelector('#ws-status');
    const hide = wsHide(); paintWeek(cv, S, hide);
    const name = 'weekoverzicht-' + new Date(S.lw.t).toISOString().slice(0, 10) + '.png';
    if (kind === 'mail') { location.href = 'mailto:?subject=' + encodeURIComponent(T('Weekoverzicht') + ' ' + fD.format(S.lw.t)) + '&body=' + encodeURIComponent(weekShareText(S, hide)); return; }
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    if (!blob) return;
    const file = new File([blob], name, { type: 'image/png' });
    if (kind === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: T('Weekoverzicht'), text: weekShareText(S, hide) }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    if (st) st.textContent = kind === 'share' ? 'Delen kan hier niet; de afbeelding is opgeslagen.' : 'Afbeelding opgeslagen.';
  }

  // ---------- 11. Andere rekeningen en brokers ----------
  const accts = () => (M && M.settings && Array.isArray(M.settings.accounts) ? M.settings.accounts : []);
  const acctTotal = (a) => (Number(a.cash) || 0) + sum((a.holdings || []).map((h) => Number(h.value) || 0));
  function accountsSummaryTile() {
    const A = accts();
    if (!A.length) return '';
    const parts = [{ label: 'Trading 212 (deze tracker)', v: M.accountNow, color: PIE[1] }].concat(A.map((a, i) => ({ label: a.name + (a.broker ? ' (' + a.broker + ')' : ''), v: acctTotal(a), color: PIE[(i + 3) % PIE.length] })));
    const tot = sum(parts.map((p) => p.v));
    return '<section class="tile pad"><h3>Alle rekeningen samen</h3>' + donut(parts, eur(tot), 'samen', 'Verdeling over je rekeningen') +
      '<div class="legend-list">' + parts.map((p) => '<div class="legend-row"><i style="background:' + p.color + '"></i><span class="nm">' + esc(p.label) + '</span><span class="muted small">' + esc(eur(p.v)) + '</span><b style="min-width:52px;text-align:right">' + esc(tot ? P1.format(p.v / tot) : '–') + '</b></div>').join('') + '</div>' +
      '<p class="sub" style="margin-top:8px">Andere rekeningen zijn je eigen invoer (stand ' + esc(A.map((a) => a.updated || '?').join(', ')) + '); die worden niet automatisch bijgewerkt.</p></section>';
  }
  const hRow = (h) => '<div class="h-row"><input aria-label="Naam" data-f="name" value="' + esc(h.name || '') + '" placeholder="Naam"><input aria-label="Ticker of ISIN" data-f="tk" value="' + esc(h.tk || h.isin || '') + '" placeholder="Ticker/ISIN">' +
    '<input aria-label="Aantal" data-f="qty" type="number" step="any" value="' + (isNum(h.qty) ? h.qty : '') + '" placeholder="Aantal"><input aria-label="Waarde in euro" data-f="value" type="number" step="any" value="' + (isNum(h.value) ? h.value : '') + '" placeholder="Waarde €">' +
    '<input aria-label="Inleg in euro" data-f="cost" type="number" step="any" value="' + (isNum(h.cost) ? h.cost : '') + '" placeholder="Inleg €"><button type="button" class="icon-x" data-xa="acct-rmrow" aria-label="Regel verwijderen">×</button></div>';
  function acctForm(a, open) {
    return '<details class="acct"' + (open ? ' open' : '') + '><summary><b>' + esc(a.name) + '</b><span class="muted small">' + esc(a.broker || '') + '</span><b>' + esc(eur(acctTotal(a))) + '</b></summary>' +
      '<div class="acct-form" data-acct="' + esc(a.id) + '"><div class="acct-head"><label>Naam<input data-a="name" maxlength="40" value="' + esc(a.name) + '"></label><label>Broker<input data-a="broker" maxlength="40" value="' + esc(a.broker || '') + '"></label>' +
      '<label>Vrij saldo (€)<input data-a="cash" type="number" step="any" value="' + (Number(a.cash) || 0) + '"></label><label>Stand van<input data-a="updated" type="date" value="' + esc(a.updated || new Date().toISOString().slice(0, 10)) + '"></label></div>' +
      '<div class="h-rows">' + (a.holdings || []).map(hRow).join('') + '</div>' +
      '<div class="plan-actions" style="margin-top:8px"><button type="button" class="btn ghost" data-xa="acct-addrow">Regel toevoegen</button><label class="btn ghost">CSV inlezen<input type="file" accept=".csv,text/csv" data-xa="acct-csv" hidden></label>' +
      '<button type="button" class="btn primary" data-xa="acct-save">Opslaan</button><button type="button" class="btn ghost danger" data-xa="acct-del">Rekening verwijderen</button></div><span class="small plan-status acct-st" role="status"></span></div></details>';
  }
  function accountsTile() {
    const A = accts();
    return '<section class="tile pad full accts"><h3>Andere rekeningen en brokers</h3>' +
      '<p class="sub">Voeg een tweede account of broker toe om alles in één overzicht te zien. Vul posities met de hand in of lees een CSV-export in (bijvoorbeeld het portefeuille-overzicht van DEGIRO). De stand blijft staan tot je hem bijwerkt.</p>' +
      (A.length ? accountsSummaryTile().replace(/^<section class="tile pad">/, '<div class="acct-sum">').replace(/<\/section>$/, '</div>') : '') +
      A.map((a) => acctForm(a, false)).join('') +
      '<div class="plan-actions" style="margin-top:12px"><button type="button" class="btn ghost" data-xa="acct-add">Rekening toevoegen</button></div></section>';
  }
  function parseNum(s) {
    let x = String(s == null ? '' : s).replace(/[€$£\s]|EUR|USD/gi, '');
    if (!x) return null;
    if (x.includes(',') && x.includes('.')) x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
    else if (x.includes(',')) x = x.replace(',', '.');
    const n = Number(x); return isFinite(n) ? n : null;
  }
  function parseCsvLine(line, sep) { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); }
  function parseAccountCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error('het bestand is leeg');
    const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    const head = parseCsvLine(lines[0], sep).map((h) => h.toLowerCase());
    const find = (re) => head.findIndex((h) => re.test(h));
    const iN = find(/product|naam|name|omschrijving|instrument/), iT = find(/symbool|symbol|ticker|isin/), iQ = find(/aantal|quantity|qty|stuks|shares/);
    let iV = find(/waarde in eur|value in eur|eur value/); if (iV < 0) iV = find(/waarde|value|market/);
    const iC = find(/aankoop|kostprijs|cost|inleg|book/);
    if (iN < 0 || iV < 0) throw new Error('kolommen voor naam en waarde niet gevonden');
    let cash = 0; const holdings = [];
    lines.slice(1).forEach((l) => {
      const c = parseCsvLine(l, sep); const name = c[iN]; let v = parseNum(c[iV]);
      if (!name || !isNum(v)) { const alt = c.slice(iV).map(parseNum).filter(isNum).pop(); if (!name || !isNum(alt)) return; v = alt; }
      if (/^cash|geldmarkt|saldo/i.test(name)) { cash += v; return; }
      holdings.push({ name: name.slice(0, 60), tk: iT >= 0 ? String(c[iT] || '').slice(0, 20) : '', qty: iQ >= 0 ? parseNum(c[iQ]) : null, value: v, cost: iC >= 0 ? parseNum(c[iC]) : null });
    });
    if (!holdings.length && !cash) throw new Error('geen posities gevonden');
    return { holdings, cash };
  }
  function readAcctForm(f) {
    const a = accts().find((x) => x.id === f.dataset.acct) || { id: f.dataset.acct };
    const val = (s) => f.querySelector('[data-a="' + s + '"]').value;
    return { id: a.id, name: val('name').trim() || 'Rekening', broker: val('broker').trim(), cash: parseNum(val('cash')) || 0, updated: val('updated') || null,
      holdings: [...f.querySelectorAll('.h-row')].map((r) => { const g = (k) => r.querySelector('[data-f="' + k + '"]').value.trim(); const tk = g('tk');
        return { name: g('name'), tk: /^[A-Z]{2}[A-Z0-9]{9}\d$/i.test(tk) ? '' : tk, isin: /^[A-Z]{2}[A-Z0-9]{9}\d$/i.test(tk) ? tk.toUpperCase() : '', qty: parseNum(g('qty')), value: parseNum(g('value')), cost: parseNum(g('cost')) }; })
        .filter((h) => h.name && isNum(h.value)) };
  }
  async function saveAccounts(list, st) {
    if (st) { st.textContent = 'Bezig met opslaan…'; st.className = 'small plan-status acct-st'; }
    try { await saveSettings({ accounts: list }); rerenderAll(); }
    catch (err) { if (st) { st.textContent = 'Opslaan is mislukt: ' + err.message + '.'; st.className = 'small plan-status acct-st loss'; } }
  }

  // ---------- Nieuws, analisten en insiders ----------
  // Betrouwbaarheid: hoe dicht winstverwachtingen bij de uitkomst lagen, hoeveel analisten, hoe eens ze zijn, spreiding van koersdoelen
  // en (zodra er genoeg geschiedenis is) of eerdere koersdoelen de goede kant op wezen.
  function targetHits(tk) {
    const r = (data.research || {})[tk];
    if (!r || !r.targetHist || !M.mk.ok) return null;
    const sym = M.mk.sym(tk) || tk;
    const pr = M.mk.prices(watchSyms().includes(tk) ? tk : sym);
    if (pr.length < 60) return null;
    const now = pr[pr.length - 1].v;
    let n = 0, hit = 0;
    r.targetHist.forEach((h) => {
      const t = ymd(h.d); if (t == null || Date.now() - t < 90 * DAY) return;
      const p0 = priceOn(pr, t); if (!p0 || !(p0.v > 0)) return;
      n++; if (Math.sign(h.mean - p0.v) === Math.sign(now - p0.v)) hit++;
    });
    return n ? { n, rate: hit / n } : null;
  }
  function analystReliability(tk) {
    const r = (data.research || {})[tk];
    if (!r) return null;
    const rc = recOf(tk), T = r.target, eps = (r.eps || []).filter((x) => isNum(x.pct));
    let score = 0, max = 0; const why = [];
    if (eps.length >= 2) {
      max += 3; const m = mean(eps.map((x) => Math.abs(x.pct)));
      score += m < 3 ? 3 : m < 7 ? 2 : m < 15 ? 1 : 0;
      why.push('winstverwachting gemiddeld ' + N1.format(m) + '% naast de uitkomst (' + eps.length + ' kwartalen)');
    }
    if (rc) {
      max += 4; score += rc.tot >= 20 ? 2 : rc.tot >= 8 ? 1 : 0;
      const rec = rc.rec; const camps = [(rec.sb || 0) + (rec.b || 0), rec.h || 0, (rec.s || 0) + (rec.ss || 0)]; const dom = Math.max(...camps) / rc.tot;
      score += dom >= 0.75 ? 2 : dom >= 0.55 ? 1 : 0;
      why.push(rc.tot + ' analisten, ' + P1.format(dom) + ' in hetzelfde kamp');
    }
    if (T && isNum(T.high) && isNum(T.low) && T.mean > 0) {
      max += 2; const sp = (T.high - T.low) / T.mean; score += sp <= 0.5 ? 2 : sp <= 1 ? 1 : 0;
      why.push('koersdoelen liggen ' + P1.format(sp) + ' uit elkaar');
    }
    const h = targetHits(tk);
    if (h && h.n >= 3) { max += 3; score += Math.round(3 * h.rate); why.push('eerdere koersdoelen wezen ' + h.n + ' keer de ' + (h.rate >= 0.5 ? 'goede' : 'verkeerde') + ' kant op (' + P1.format(h.rate) + ' raak)'); }
    if (!max) return null;
    const s10 = Math.round(score / max * 10);
    return { score: s10, word: s10 >= 7 ? 'hoog' : s10 >= 4 ? 'gemiddeld' : 'laag', why, hits: h };
  }
  function analystRows() {
    const keys = M.companies.filter((c) => !isFundC(c)).map((c) => ({ o: c, held: true })).concat(watchSyms().map((s) => ({ o: watchPseudo(s), held: false })));
    return keys.map(({ o, held }) => {
      const rc = recOf(o.tk); const r = (data.research || {})[o.tk];
      if (!rc && !(r && r.target)) return null;
      return { o, held, rc, up: upsideOf(o), rel: analystReliability(o.tk), sent: r && r.sent };
    }).filter(Boolean);
  }
  function analystSuggestions() {
    const rows = analystRows();
    const sc = (x) => (x.rc ? x.rc.buy : 0.5) + Math.max(-0.3, Math.min(0.5, x.up || 0)) + (x.rel ? x.rel.score / 20 : 0);
    const pos = rows.filter((x) => x.rc && x.rc.buy >= 0.6 && (!isNum(x.up) || x.up > 0.05) && (!x.rel || x.rel.score >= 5)).sort((a, b) => sc(b) - sc(a)).slice(0, 5);
    const warn = rows.filter((x) => x.held && ((x.rc && (x.rc.buy < 0.4 || x.rc.sell >= 0.2 || (isNum(x.rc.trend) && x.rc.trend <= -0.1))) || (isNum(x.up) && x.up < -0.05))).slice(0, 5);
    return { pos, warn };
  }
  function analystLine(x) {
    return (x.rc ? P1.format(x.rc.buy) + ' kopen (' + x.rc.tot + ' analisten' + (isNum(x.rc.trend) && Math.abs(x.rc.trend) >= 0.01 ? ', ' + (x.rc.trend > 0 ? 'stijgend' : 'dalend') : '') + ')' : 'geen aanbevelingen') +
      (isNum(x.up) ? ', koersdoel ' + spct1(x.up) : '') + (x.rel ? ', betrouwbaarheid ' + x.rel.word : '');
  }
  function suggestTile() {
    const S = analystSuggestions();
    const item = (x, warn) => '<button type="button" class="alt" data-ticker="' + esc(x.held ? x.o.tk : '~' + x.o.tk) + '"><b>' + esc(x.o.tk) + ' <span class="muted small">' + esc(x.o.name) + '</span></b>' +
      '<span class="small">' + esc(analystLine(x)) + '</span><span class="small ' + (warn ? 'loss' : 'muted') + '">' + esc(warn ? 'In bezit: analisten zijn hier minder positief' : x.held ? 'In bezit, ' + P1.format(x.o.weight || 0) + ' van je beleggingen' : 'Op je volglijst') + '</span></button>';
    return '<section class="tile pad"><h3>Suggesties volgens analisten</h3>' +
      (S.pos.length ? '<p class="small" style="margin-top:4px"><b>Meest positief, met redelijke betrouwbaarheid</b></p><div class="alt-list">' + S.pos.map((x) => item(x, false)).join('') + '</div>' : '<p class="muted">Geen aandelen waar analisten duidelijk positief over zijn met voldoende betrouwbaarheid.</p>') +
      (S.warn.length ? '<p class="small" style="margin-top:12px"><b>Om op te letten</b></p><div class="alt-list">' + S.warn.map((x) => item(x, true)).join('') + '</div>' : '') +
      '<p class="sub" style="margin-top:8px">Gekozen uit je posities en volglijst: veel analisten positief, koersdoel boven de koers en een redelijke betrouwbaarheid. Analisten zitten er vaak naast; dit is geen beleggingsadvies.</p></section>';
  }
  function newsItems() {
    const held = new Set(M.companies.map((c) => c.tk)), watch = new Set(watchSyms()), out = [], seen = new Set();
    Object.entries(data.research || {}).forEach(([tk, r]) => (r.news || []).forEach((n) => { const kind = held.has(tk) ? 'mine' : watch.has(tk) ? 'watch' : null; if (kind) out.push(Object.assign({ tk, kind }, n)); }));
    ((data.marketNews && data.marketNews.items) || []).forEach((n) => out.push(Object.assign({ tk: null, kind: 'market' }, n)));
    return out.filter((n) => { const k = (n.url && n.url !== '#' ? n.url : n.headline) + '|' + n.tk; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.t - a.t);
  }
  // Toon van een artikel, geschat uit woorden in kop en samenvatting (Engels en Nederlands); geen oordeel van de bron
  const NEWS_POS = /\b(beat|beats|surge|surges|soar|soars|jump|jumps|rall(y|ies)|gain|gains|rise|rises|record|upgrade[sd]?|outperform|strong|growth|profit|tops|raises?|boost|bullish|buy rating|approv(al|ed)|wins?|expands?|stijg\w*|winst|record|sterk\w*|groei\w*|verhoog\w*|opwaarder\w*|positief|herstel\w*)\b/gi;
  const NEWS_NEG = /\b(miss|misses|plunge[sd]?|plunges|sink|sinks|tumble[sd]?|drops?|fall|falls|slump\w*|loss|losses|downgrade[sd]?|cut|cuts|weak|warns?|warning|lawsuit|probe|investigation|recall|layoffs?|bearish|sell rating|fraud|decline[sd]?|crash\w*|daal\w*|daling|verlies\w*|zwak\w*|verlaag\w*|afwaarder\w*|negatief|ontslag\w*|rechtszaak|onderzoek naar|waarschuw\w*|onder druk|pressure|tariffs?|heffing\w*)\b/gi;
  function newsTone(n) {
    const txt = (n.headline || '') + ' ' + (n.summary || '');
    const p = (txt.match(NEWS_POS) || []).length, m = (txt.match(NEWS_NEG) || []).length;
    return p > m ? 'pos' : m > p ? 'neg' : 'neu';
  }
  const toneTag = (n) => { const t = newsTone(n); return '<span class="ntone ' + t + '" title="Geschat uit de woorden in de kop">' + (t === 'pos' ? '▲ Positief' : t === 'neg' ? '▼ Negatief' : '● Neutraal') + '</span>'; };
  function newsListTile() {
    const f = xs.newsF;
    const items = newsItems().filter((n) => f === 'all' || n.kind === f).slice(0, 40);
    const tag = (n) => (n.tk ? '<span class="tag' + (n.kind === 'watch' ? '' : ' gain') + '">' + esc(n.tk) + '</span> ' : '<span class="tag">Markt</span> ');
    return '<section class="tile pad span-2 news-tile"><div class="plan-head"><h3>Nieuws</h3>' + segX('newsF', [['all', 'Alles'], ['mine', 'Mijn aandelen'], ['watch', 'Volglijst'], ['market', 'Markt']], f, 'Nieuws filteren') + '</div>' +
      (items.length ? '<p class="small muted" style="margin:2px 0 6px">' + (() => { const c = { pos: 0, neg: 0, neu: 0 }; items.forEach((n) => { c[newsTone(n)]++; }); return esc(c.pos + ' positief, ' + c.neg + ' negatief, ' + c.neu + ' neutraal'); })() + '</p>' +
        '<div class="news">' + items.map((n) => '<a class="news-i" href="' + esc(n.url) + '" target="_blank" rel="noopener"><span class="news-m">' + tag(n) + toneTag(n) + esc(fDT.format(n.t) + (n.source ? ', ' + n.source : '')) + '</span><span class="news-t">' + esc(n.headline) + '</span>' +
        (n.summary ? '<span class="news-s">' + esc(n.summary) + '</span>' : '') + '</a>').join('') + '</div>'
        : '<p class="muted">' + (f === 'market' && !data.marketNews ? 'Marktnieuws komt van Finnhub en wordt buiten de meettijden opgehaald.' : 'Geen nieuws in deze selectie.') + '</p>') +
      '<p class="sub" style="margin-top:8px">Koppen en links van Finnhub: per aandeel de laatste tien dagen, en algemeen marktnieuws. Het artikel opent bij de bron. Positief of negatief is een schatting uit woorden in de kop en samenvatting (zoals "stijgt", "beats", "daalt", "downgrade"), geen oordeel van de bron; lees bij twijfel het artikel.</p></section>';
  }
  function analystTableTile() {
    const rows = analystRows().sort((a, b) => (b.rc ? b.rc.buy : 0) - (a.rc ? a.rc.buy : 0));
    if (!rows.length) return fullT('Analisten per bedrijf', '<p class="muted">Nog geen aanbevelingen van analisten opgehaald.</p>');
    return '<section class="tile pad full"><h3>Analisten per bedrijf</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bedrijf</th><th>Aanbevelingen</th><th class="num">Kopen</th><th class="num">Trend</th><th class="num">Koersdoel</th><th class="num">Betrouwbaarheid</th><th class="num">Nieuws</th></tr></thead><tbody>' +
      rows.map((x) => { const rec = x.rc && x.rc.rec;
        const bar = rec ? '<div class="rec-bar mini">' + [[rec.sb, '#0B7A4B'], [rec.b, '#5FB58A'], [rec.h, '#C9CED6'], [rec.s, '#E3A79C'], [rec.ss, '#B4311F']].filter((p) => p[0]).map((p) => '<i style="flex:' + p[0] + ';background:' + p[1] + '"></i>').join('') + '</div>' : '–';
        return '<tr class="rowlink" data-ticker="' + esc(x.held ? x.o.tk : '~' + x.o.tk) + '"><td class="co"><b>' + esc(x.o.tk) + '</b> ' + (x.held ? '' : '<span class="tag">Volglijst</span>') + '<span class="nm">' + esc(x.o.name) + '</span></td><td>' + bar + '</td>' +
          '<td class="num">' + esc(x.rc ? P1.format(x.rc.buy) : '–') + (x.rc ? '<span class="sub">' + x.rc.tot + ' analisten</span>' : '') + '</td>' +
          '<td class="num ' + tone(x.rc && x.rc.trend) + '">' + esc(x.rc && isNum(x.rc.trend) ? sgn(x.rc.trend * 100, N1) + ' pp' : '–') + '</td>' +
          '<td class="num ' + tone(x.up) + '">' + esc(isNum(x.up) ? spct1(x.up) : '–') + '</td>' +
          '<td class="num">' + (x.rel ? '<span class="lvl" style="--k:' + Math.max(1, Math.min(7, 8 - Math.round(x.rel.score * 0.7))) + '">' + x.rel.score + '</span><span class="sub">' + esc(x.rel.word) + '</span>' : '–') + '</td>' +
          '<td class="num">' + esc(x.sent && isNum(x.sent.bull) ? P1.format(x.sent.bull) + ' positief' : '–') + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="sub" style="margin-top:8px">Kopen: deel van de analisten met koop of sterk kopen. Trend: verschil met enkele maanden eerder. Koersdoel: gemiddeld koersdoel tegenover de koers nu. Betrouwbaarheid (0–10): zie de uitleg hiernaast.</p></section>';
  }
  function reliabilityTile() {
    const rows = analystRows().filter((x) => x.rel).sort((a, b) => b.rel.score - a.rel.score);
    return '<section class="tile pad"><h3>Hoe betrouwbaar zijn de analisten?</h3>' +
      (rows.length ? '<div class="why-list">' + rows.slice(0, 8).map((x) => '<details class="why-d"><summary><span class="lvl" style="--k:' + Math.max(1, Math.min(7, 8 - Math.round(x.rel.score * 0.7))) + '">' + x.rel.score + '</span><span class="nm"><b>' + esc(x.o.tk) + '</b> ' + esc(x.rel.word) + '</span><span></span></summary>' +
        '<div class="why-in"><ul class="why">' + x.rel.why.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' + (x.rel.hits ? '' : '<p class="sub" style="margin-top:6px">Of koersdoelen uitkomen, meet de tracker zodra er drie maanden koersdoelgeschiedenis is.</p>') + '</div></details>').join('') + '</div>' : '<p class="muted">Nog geen gegevens van analisten.</p>') +
      '<p class="sub" style="margin-top:8px">Score van 0 tot 10 uit: hoe dicht de winstverwachtingen bij de werkelijke kwartaalcijfers lagen, hoeveel analisten het bedrijf volgen, hoe eens ze het zijn, hoe ver koersdoelen uiteenlopen en of eerdere koersdoelen de goede kant op wezen. Een hoge score betekent dat de verwachtingen goed onderbouwd lijken, niet dat ze uitkomen.</p></section>';
  }
  function insiderTile() {
    const keys = M.companies.filter((c) => !isFundC(c)).map((c) => c.tk).concat(watchSyms());
    const all = [];
    const per = keys.map((tk) => {
      const r = (data.research || {})[tk]; const ins = (r && r.insider) || [];
      ins.forEach((x) => all.push(Object.assign({ tk }, x)));
      const ps = ins.filter((x) => x.code === 'P' || x.code === 'S');
      if (!ins.length) return null;
      return { tk, net: sum(ps.map((x) => (x.change || 0) * (x.price || 0))), buys: ps.filter((x) => x.code === 'P').length, sells: ps.filter((x) => x.code === 'S').length, last: ins[0] };
    }).filter(Boolean).sort((a, b) => b.net - a.net);
    if (!per.length) return fullT('Insiderhandel', '<p class="muted">Nog geen meldingen van insiderhandel opgehaald (Finnhub, Amerikaanse bedrijven).</p>');
    const mx = Math.max(1, ...per.map((x) => Math.abs(x.net)));
    all.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return '<section class="tile pad full"><h3>Insiderhandel, laatste 6 maanden</h3><div class="ins-grid"><div class="hbars cmp">' + per.map((x) =>
      '<button type="button" class="r" data-ticker="' + esc(M.byTk.has(x.tk) ? x.tk : '~' + x.tk) + '" data-tip="' + esc(x.tk + ': ' + x.buys + ' kopen, ' + x.sells + ' verkopen') + '"><span class="tk">' + esc(x.tk) + '</span><span class="track"><span class="mid"></span>' +
      (x.net ? '<span class="' + (x.net < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(x.net) / mx * 50).toFixed(1) + '%"></span>' : '') + '</span><span class="' + tone(x.net) + '" style="text-align:right;font-weight:600">' + esc(x.net ? bigNum(x.net, 'USD') : '–') + '</span></button>').join('') + '</div>' +
      '<div class="tx-list">' + all.slice(0, 10).map((x) => '<div class="tx"><span class="tag' + (x.code === 'P' ? ' gain' : x.code === 'S' ? ' loss' : '') + '">' + esc(INSIDER_CODES[x.code] || x.code || '?') + '</span><span class="tx-m"><b>' + esc(x.tk + ' · ' + (x.name || '')) + '</b><span class="sub">' + esc(x.date || '') + '</span></span>' +
        '<span class="tx-v">' + esc(isNum(x.change) ? sgn(x.change, NI) + ' st.' : '') + '</span></div>').join('') + '</div></div>' +
      '<p class="sub" style="margin-top:8px">Balk: waarde van aankopen min verkopen door bestuurders (in dollars). Verkopen gebeuren vaak volgens vaste plannen of voor belasting; kopen met eigen geld zegt meestal meer.</p></section>';
  }
  function renderNews() {
    const host = mode === 'm' ? $('m-news-body') : $('news-body');
    if (!host) return;
    const F = FEAT();
    if (!F.has.finnhub && !demo) { host.innerHTML = '<div class="grid wide">' + offTile('Nieuws en analisten', 'Zet Finnhub aan (gratis sleutel) bij Koppelingen voor nieuws per aandeel, marktnieuws, analisten en insiderhandel.') + '</div>'; return; }
    host.innerHTML = '<div class="grid wide">' + newsListTile() + suggestTile() + '</div>' +
      '<div class="section-head"><h2>Analisten</h2><p class="muted small">Aanbevelingen, koersdoelen en hoe betrouwbaar ze zijn</p></div><div class="grid wide">' + analystTableTile() + reliabilityTile() + '</div>' +
      '<div class="section-head"><h2>Insiders</h2><p class="muted small">Kopen en verkopen bestuurders zelf?</p></div><div class="grid wide">' + insiderTile() + '</div>';
  }

  // ---------- Volglijst: suggesties om te volgen ----------
  function watchSuggestions() {
    const have = new Set(M.companies.map((c) => normTk(c.tk)).concat(watchSyms(), M.mk.ok ? Object.values((data.market && data.market.symbols) || {}) : []));
    const cand = new Map();
    const add = (sym, why, w, name) => { if (!sym || have.has(sym) || !/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(sym)) return; const o = cand.get(sym) || { sym, why: new Set(), w: 0, name: name || '' }; o.why.add(why); o.w += w; if (!o.name && name) o.name = name; cand.set(sym, o); };
    if (M.mk.ok) M.companies.forEach((c) => M.mk.peersOf(c.tk).forEach((s) => { const p = M.mk.prof(s); add(s, 'lijkt op ' + c.tk, 2 + (c.weight || 0) * 5, p && p.name); }));
    const O = overlapModel();
    O.per.forEach((list, tk) => { const eurV = sum(list.map((x) => x.eur)); if (eurV > 0) add(tk, 'zit al voor ' + eur(eurV) + ' in je fondsen', eurV / Math.max(1, M.totalValue || 1) * 40, ''); });
    (data.etf ? Object.values(data.etf) : []).forEach((E) => (E.rows || []).forEach((r) => { const k = normTk(r[0]); if (cand.has(k) && !cand.get(k).name) cand.get(k).name = String(r[1] || '').replace(/\b(INC|CORP|CLASS [A-C]|LTD)\b\.?/g, '').trim(); }));
    return [...cand.values()].sort((a, b) => b.w - a.w).slice(0, 6);
  }
  function watchSuggestTile() {
    if (!M) return '';
    const L = watchSuggestions();
    if (!L.length) return '';
    return '<section class="tile pad watch-sugg"><h3>Suggesties om te volgen</h3><div class="alt-list">' + L.map((o) => {
      const p = M.mk.ok ? M.mk.prof(o.sym) : null;
      return '<div class="alt"><b>' + esc(o.sym) + ' <span class="muted small">' + esc((p && p.name) || o.name || '') + '</span></b><span class="small muted">' + esc([...o.why].slice(0, 2).join('; ')) + '</span>' +
        (p && isNum(p.change) ? '<span class="small ' + tone(p.change) + '">' + esc(spct(p.change / 100)) + ' laatste dag</span>' : '') +
        '<button type="button" class="btn ghost" data-xa="watch-add" data-k="' + esc(o.sym) + '">Volgen</button></div>'; }).join('') + '</div>' +
      '<p class="sub" style="margin-top:8px">Vergelijkbare bedrijven van je posities (FMP) en de grootste bedrijven in je indexfondsen die je nog niet los volgt. Volgen is gratis en verandert niets aan je portefeuille.</p></section>';
  }

  // ---------- Klikken en invoer voor de uitbreidingen ----------
  function rerenderAfterX() {
    renderPlan(); renderNews(); renderValuationList();
    if (ui.detail && hasView(ui.detail)) renderDetail(false);
  }
  document.addEventListener('click', async (e) => {
    if (!e.target.closest) return;
    const seg = e.target.closest('[data-x] button[data-k]');
    if (seg) {
      const key = seg.parentElement.dataset.x, k = seg.dataset.k;
      if (key === 'amt') plan.amount = Number(k); else if (key === 'taxYear') xs.taxYear = Number(k); else xs[key] = k;
      markFresh(); rerenderAfterX(); return;
    }
    const b = e.target.closest('[data-xa]');
    if (!b || b.tagName === 'INPUT') return;
    const a = b.dataset.xa;
    if (a === 'note-edit') { const box = b.closest('.note'); box.querySelector('.note-ed').hidden = false; b.hidden = true; box.querySelector('textarea').focus(); return; }
    if (a === 'note-cancel') { const box = b.closest('.note'); box.querySelector('.note-ed').hidden = true; box.querySelector('[data-xa="note-edit"]').hidden = false; return; }
    if (a === 'note-save') {
      const box = b.closest('.note'); const st = box.querySelector('.note-st'); const txt = box.querySelector('textarea').value.trim().slice(0, 500);
      const next = Object.assign({}, notesMap()); if (txt) next[b.dataset.k] = txt; else delete next[b.dataset.k];
      st.textContent = 'Bezig met opslaan…';
      try { await saveSettings({ notes: next }); rerenderAll(); } catch (err) { st.textContent = 'Opslaan is mislukt: ' + err.message + '.'; st.className = 'small note-st loss'; }
      return;
    }
    if (a === 'box3-copy' || a === 'box3-csv') {
      const B = box3Model(xs.taxYear); const st = $('box3-status');
      if (a === 'box3-copy') { try { await navigator.clipboard.writeText(box3Text(B)); if (st) st.textContent = 'Gekopieerd.'; } catch (err) { if (st) st.textContent = 'Kopiëren lukte niet in deze browser.'; } }
      else download('dividend-' + B.Y + '.csv', csvOf(['datum', 'ticker', 'netto_eur', 'bruto_eur', 'bronbelasting_eur', 'valuta', 'methode'], B.divs.map((x) => [x.d.date, x.d.ticker, x.d.amount, x.gross.toFixed(2), x.tax.toFixed(2), x.cur, x.how])));
      return;
    }
    if (a === 'ws-share' || a === 'ws-png' || a === 'ws-mail') { shareWeek(a.slice(3), b); return; }
    if (a === 'watch-add') { const list = watchSyms().slice(); if (!list.includes(b.dataset.k) && list.length < 20) { b.disabled = true; b.textContent = 'Bezig…'; list.push(b.dataset.k); setWatchlist(list, null, b.dataset.k + ' staat op je volglijst.'); } return; }
    if (a === 'acct-add') { const id = Math.random().toString(36).slice(2, 10); saveAccounts(accts().concat([{ id, name: 'Nieuwe rekening', broker: '', cash: 0, updated: new Date().toISOString().slice(0, 10), holdings: [] }]), null); return; }
    const f = b.closest('.acct-form');
    if (!f) return;
    const st = f.querySelector('.acct-st');
    if (a === 'acct-addrow') { f.querySelector('.h-rows').insertAdjacentHTML('beforeend', hRow({})); f.querySelector('.h-rows .h-row:last-child input').focus(); }
    else if (a === 'acct-rmrow') b.closest('.h-row').remove();
    else if (a === 'acct-save') { const o = readAcctForm(f); saveAccounts(accts().map((x) => (x.id === o.id ? o : x)), st); }
    else if (a === 'acct-del') { if (confirm('Deze rekening uit het overzicht verwijderen?')) saveAccounts(accts().filter((x) => x.id !== f.dataset.acct), st); }
  });
  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.matches && el.matches('input[data-xa="ws-hide"]')) { xs.wsHide = el.checked; const h = el.closest('.wshare'); if (h) drawWeekShare(h.parentElement); return; }
    if (el.matches && el.matches('input[type="file"][data-xa="acct-csv"]') && el.files[0]) {
      const f = el.closest('.acct-form'); const st = f.querySelector('.acct-st');
      try {
        const P = parseAccountCsv(await el.files[0].text());
        f.querySelector('.h-rows').innerHTML = P.holdings.map(hRow).join('');
        if (P.cash) f.querySelector('[data-a="cash"]').value = Math.round(P.cash * 100) / 100;
        f.querySelector('[data-a="updated"]').value = new Date().toISOString().slice(0, 10);
        st.textContent = P.holdings.length + ' posities ingelezen. Controleer ze en kies Opslaan.'; st.className = 'small plan-status acct-st gain';
      } catch (err) { st.textContent = 'Inlezen is mislukt: ' + err.message + '.'; st.className = 'small plan-status acct-st loss'; }
      el.value = '';
    }
  });

  // ---------- Engels (vertaling van menu's, koppen, knoppen en labels) ----------
  const EN = {
    'Overzicht': 'Overview', 'Bedrijven': 'Companies', 'Plannen': 'Plans', 'Nieuws': 'News', 'Statistieken': 'Statistics', 'Instellingen': 'Settings',
    'Investeringstracker': 'Investment tracker', 'Waarde beleggingen': 'Investments value', 'Agenda': 'Calendar', 'Sectoren': 'Sectors', 'Valuta en koopkracht': 'Currency and purchasing power',
    'Risico': 'Risk', 'Weken': 'Weeks', 'Patronen': 'Patterns', 'Volglijst': 'Watchlist', 'Vandaag': 'Today', '3 dagen': '3 days', '30 dagen': '30 days', 'Alles': 'All', 'Alle': 'All',
    'Gestegen': 'Up', 'Gedaald': 'Down', 'Verandering': 'Change', 'Waarde': 'Value', 'Sinds aankoop': 'Since purchase', 'Naam': 'Name', 'Toon': 'Show', 'Sorteer': 'Sort', 'Grafiek': 'Chart',
    'Accountwaarde': 'Account value', 'Netto gestort': 'Net deposited', 'Totaal resultaat': 'Total result', 'Ongerealiseerd': 'Unrealised', 'Stortingen': 'Deposits', 'Opbouw': 'Breakdown', 'Per positie': 'Per position', 'Verdeling': 'Allocation',
    'Kwartaalcijfers': 'Earnings', 'Dividend dat eraan komt': 'Upcoming dividends', 'Ontvangen dividend': 'Dividends received', 'Verdeling per sector': 'Allocation by sector', 'Jij tegenover de sector': 'You versus the sector', 'Sectoren in de markt': 'Sectors in the market',
    'Euro en dollar': 'Euro and dollar', 'Na inflatie': 'After inflation', 'Risico-indicatie': 'Risk indicator', 'Waar het risico vandaan komt': 'Where the risk comes from', 'Wat beweegt samen': 'What moves together',
    'Resultaat per dag': 'Result per day', 'Wanneer beweegt het?': 'When does it move?', 'Per weekdag': 'By weekday', 'Hoe groot zijn de dagbewegingen?': 'How big are the daily moves?',
    'Streefverdeling': 'Target allocation', 'Vooruitblik': 'Outlook', 'Mijlpalen': 'Milestones', 'Jaaroverzicht': 'Annual overview', 'Werkelijke spreiding': 'True diversification', 'Exporteren': 'Export', 'Stand op 1 januari': 'Value on 1 January',
    'Wat als alles in de index had gezeten': 'What if everything had been in the index',
    'Maandelijkse inleg-assistent': 'Monthly deposit assistant', "Scenario's": 'Scenarios', 'Dividendkalender, komende 12 maanden': 'Dividend calendar, next 12 months', 'Dividendkalender': 'Dividend calendar', 'Belastinghulp box 3': 'Tax helper (box 3)',
    'Kostenoverzicht': 'Cost overview', 'Minder vaak, grotere aankopen': 'Fewer, larger purchases', 'Laatste orders': 'Latest orders', 'Aankoopdagboek': 'Purchase journal', 'Overlap met je fondsen': 'Overlap with your funds', 'Ook in je fondsen': 'Also in your funds',
    'Weekoverzicht delen': 'Share weekly overview', 'Weekoverzicht': 'Weekly overview', 'Andere rekeningen en brokers': 'Other accounts and brokers', 'Alle rekeningen samen': 'All accounts together', 'Waardering': 'Valuation',
    'Vergelijken': 'Compare', 'Kies twee aandelen': 'Pick two stocks', 'Koers, laatste jaar': 'Price, last year', 'Naast elkaar': 'Side by side', 'Twee aandelen vergelijken': 'Compare two stocks',
    'Suggesties volgens analisten': 'Suggestions based on analysts', 'Analisten per bedrijf': 'Analysts per company', 'Hoe betrouwbaar zijn de analisten?': 'How reliable are the analysts?', 'Insiderhandel, laatste 6 maanden': 'Insider trading, last 6 months', 'Insiderhandel': 'Insider trading',
    'Analisten': 'Analysts', 'Insiders': 'Insiders', 'Suggesties om te volgen': 'Suggestions to follow', 'Volgen': 'Follow', 'Wat analisten vinden': 'What analysts think', 'Koersdoel': 'Price target', 'Stemming in het nieuws': 'News sentiment', 'Bedrijfscijfers per jaar': 'Financials per year', 'Bedrijfscijfers': 'Financials',
    'Positie': 'Position', 'Historie': 'History', 'Onderzoek': 'Research', 'Vergelijk': 'Compare', 'Dagbereik binnen de historie': 'Daily range within history', 'Aankoop, valuta en transacties': 'Purchase, currency and transactions', 'Laatste transacties': 'Latest transactions',
    'Sector en branche': 'Sector and industry', 'Tegenover branche en sector': 'Versus industry and sector', 'Vergelijkbare bedrijven': 'Comparable companies', 'Nieuws, analisten en cijfers': 'News, analysts and financials', 'Sector en vergelijkbare bedrijven': 'Sector and comparable companies',
    '← Terug': '← Back', '‹ Terug': '‹ Back', 'Terug': 'Back', 'Opslaan': 'Save', 'Annuleren': 'Cancel', 'Kopiëren': 'Copy', 'Delen': 'Share', 'Afbeelding opslaan': 'Save image', 'Per e-mail': 'By email', 'Rekening toevoegen': 'Add account', 'Regel toevoegen': 'Add row',
    'CSV inlezen': 'Import CSV', 'Rekening verwijderen': 'Delete account', 'Doelen opslaan': 'Save targets', 'Gelijk verdelen': 'Split evenly', 'Huidige verdeling als doel': 'Use current allocation', 'Bewaren': 'Save', 'Bewaren als PDF': 'Save as PDF', 'Installeren': 'Install',
    'Meer tonen': 'Show more', 'Minder tonen': 'Show less', 'Mijn aandelen': 'My stocks', 'Markt': 'Market', 'Per sector': 'By sector', 'Ik stort': 'I deposit', 'Bedrag': 'Amount', 'Inleg per maand': 'Monthly deposit', 'Doelbedrag (optioneel)': 'Goal amount (optional)',
    'Notitie bewerken': 'Edit note', 'Waarom gekocht? Notitie toevoegen': 'Why did you buy? Add a note', 'Koop': 'Buy', 'Verkoop': 'Sell', 'Stijger': 'Riser', 'Daler': 'Faller', 'Stijgers': 'Risers', 'Dalers': 'Fallers', 'Beste': 'Best', 'Zwakste': 'Weakest',
    'Aangekondigd': 'Announced', 'Verwacht': 'Expected', 'In bezit': 'Held', 'Dit bedrijf': 'This company', 'Fout': 'Error', 'Aan': 'On', 'Uit': 'Off', 'Licht': 'Light', 'Donker': 'Dark', 'Automatisch': 'Automatic', 'Weergave': 'Display', 'Animaties': 'Animations', 'Taal': 'Language',
    'Toegangscode': 'Access code', 'Adres van je Worker': 'Your Worker address', 'Koppelingen en functies': 'Connections and features', 'Code vergeten': 'Forget code', 'Opslaan en laden': 'Save and load', 'Als app op je telefoon of computer': 'As an app on your phone or computer',
    'Updates': 'Updates', 'Controleren op updates': 'Check for updates', 'Nu bijwerken': 'Update now', 'Later': 'Later', 'Gebruiken': 'Use', 'Wissen': 'Clear', 'Meer': 'More',
    'Sector': 'Sector', 'Branche': 'Industry', 'Beurswaarde': 'Market cap', 'Koers': 'Price', 'Beta': 'Beta', 'Dividendrendement': 'Dividend yield', 'Koers-winstverhouding': 'Price/earnings ratio', 'Koers-winstverhouding nu': 'P/E now', 'Eigen gemiddelde': 'Own average',
    'Dividendrendement nu': 'Dividend yield now', 'Dividendrendement gemiddeld': 'Average dividend yield', 'Nettomarge': 'Net margin', 'Omzetgroei, laatste jaar': 'Revenue growth, last year', 'Beweeglijkheid per jaar': 'Volatility per year', 'Risicoklasse (1–7)': 'Risk class (1–7)',
    'Grootste daling, laatste jaar': 'Largest drop, last year', 'Analisten: kopen': 'Analysts: buy', 'Koersdoel tegenover koers': 'Target versus price', 'Betrouwbaarheid analisten': 'Analyst reliability', 'Los in bezit': 'Held directly', 'Samen': 'Together', 'Deel via fondsen': 'Share via funds',
    'Beleggingen nu': 'Investments now', 'Vrij saldo': 'Free cash', 'Resultaat nu': 'Result now', 'Posities': 'Positions', 'Grootste positie': 'Largest position', 'In cijfers': 'In numbers', 'Verdeling over posities': 'Allocation over positions', 'Soort belegging': 'Type of investment',
    'Winst en verlies per positie': 'Profit and loss per position', 'Gerealiseerd en kosten': 'Realised and costs', 'Waar je resultaat vandaan komt': 'Where your result comes from', 'Rendement': 'Return', 'Per maand': 'Per month', 'Inleg tegenover waarde': 'Deposits versus value',
    'Alle stortingen en opnames': 'All deposits and withdrawals', 'Wat het risico verlaagt': 'What lowers the risk', 'Wat een slecht jaar kan betekenen': 'What a bad year can mean',
    'Inleg en doelen': 'Deposits and goals', 'Wat als': 'What if', 'Dividend en belasting': 'Dividends and tax', 'Kosten en aankopen': 'Costs and purchases', 'Spreiding en rekeningen': 'Diversification and accounts', 'Delen en exporteren': 'Share and export',
    'Aandeel': 'Stock', 'Uitkering': 'Payout', 'Volgende': 'Next', 'Komende 12 mnd': 'Next 12 months', 'Groei per aandeel': 'Growth per share', 'Land': 'Country', 'Netto': 'Net', 'Bruto': 'Gross', 'Bronbelasting': 'Withholding tax', 'Jaar': 'Year', 'Orders': 'Orders',
    'Omgezet': 'Traded', 'Kosten': 'Costs', 'Per order': 'Per order', 'Bedrijf': 'Company', 'Los': 'Direct', 'Aanbevelingen': 'Recommendations', 'Kopen': 'Buy', 'Trend': 'Trend', 'Betrouwbaarheid': 'Reliability', 'K/W nu': 'P/E now', 'Dividend nu': 'Dividend now', 'Gemiddeld': 'Average',
    'per maand': 'monthly', 'per kwartaal': 'quarterly', 'per halfjaar': 'semi-annual', 'per jaar': 'annual', 'hoog': 'high', 'gemiddeld': 'average', 'laag': 'low', 'verkocht': 'sold', 'geschat': 'estimated', 'sinds aankoop': 'since purchase', 'volglijst': 'watchlist',
    'Zonder bedragen (alleen procenten)': 'Without amounts (percentages only)', 'Effect op je beleggingen': 'Effect on your investments', 'Waarde daarna': 'Value afterwards', 'Laatste 12 maanden': 'Last 12 months', 'Per order gemiddeld': 'Average per order', 'Waarvan wisselkosten': 'Of which FX fees',
    'rendement deze week': 'return this week', 'accountwaarde': 'account value', 'Eerste aandeel': 'First stock', 'Tweede aandeel': 'Second stock', 'Naast een ander aandeel zetten': 'Compare with another stock',
    'Nieuws en analisten': 'News and analysts', '▲ Positief': '▲ Positive', '▼ Negatief': '▼ Negative', '● Neutraal': '● Neutral', 'Mijn tracker koppelen': 'Connect my tracker', 'Functies bekijken met voorbeeldgetallen': 'Explore with sample data',
  };
  const EN_RE = [
    [/^Alle (\d+) bedrijven bekijken$/, 'View all $1 companies'], [/^Alle (\d+) bedrijven$/, 'All $1 companies'], [/^(\d+) van 7$/, '$1 of 7'], [/^Via (.+)$/, 'Via $1'],
    [/^Stijgers, markt en dalers (.*)$/, 'Risers, market and fallers $1'], [/^(\d+) dagen$/, '$1 days'], [/^(\d+) jaar$/, '$1 years'], [/^Waarde beleggingen, (.+)$/, 'Investments value, $1'],
    [/^Bijgewerkt (.+)$/, 'Updated $1'], [/^vandaag$/, 'today'], [/^Nieuwe versie (.+)$/, 'New version $1'],
    [/^(.+) vandaag$/, '$1 today'], [/^sinds het slot van (.+)$/, 'since the close of $1'], [/^(.+) sinds het slot van (.+)$/, '$1 since the close of $2'],
    [/^sinds de opening(.*)$/, 'since the open$1'], [/^Sinds aankoop (.+)$/, 'Since purchase $1'], [/^(\d+) posities, samen (.+)$/, '$1 positions, together $2'],
  ];
  Object.assign(EN, {
    'Vergelijk met portefeuille': 'Compare with portfolio', 'Deel van portefeuille': 'Share of portfolio', 'Tot hoogste gemeten': 'From highest measured', 'Laatste handelsdag': 'Last trading day',
    'Positie': 'Position', 'Waarde nu': 'Value now', 'Aantal': 'Quantity', 'Koers in euro': 'Price in euro', 'Gemiddelde aankoopprijs': 'Average purchase price', 'Ingelegd': 'Invested',
    'Bijdrage aan dagresultaat': 'Contribution to daily result', 'Volgende kwartaalcijfers': 'Next earnings', 'Volgend dividend': 'Next dividend', 'Opening': 'Open', 'Laagste en hoogste': 'Low and high',
    'Gemeten dagen': 'Days measured', 'Huidige reeks': 'Current streak', 'Beste dag': 'Best day', 'Slechtste dag': 'Worst day', 'Beste week': 'Best week', 'Slechtste week': 'Worst week',
    'Grootste veranderingen': 'Biggest changes', 'Alle bedrijven bekijken': 'View all companies', 'Zoek op naam of ticker': 'Search by name or ticker', 'Nog geen metingen van vandaag': 'No measurements today yet',
  });
  const T = (s) => (LANG === 'en' ? EN[s] || s : s);
  function trText(s) {
    const t = s.trim();
    if (!t) return null;
    if (EN[t]) return s.replace(t, EN[t]);
    for (const [re, rep] of EN_RE) if (re.test(t)) return s.replace(t, t.replace(re, rep));
    return null;
  }
  function translateTree(root) {
    if (LANG !== 'en' || !root) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach((n) => { if (n.parentElement && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentElement.tagName)) return; const r = trText(n.nodeValue); if (r != null && r !== n.nodeValue) n.nodeValue = r; });
    (root.querySelectorAll ? root.querySelectorAll('[aria-label],[placeholder],[title]') : []).forEach((el) => ['aria-label', 'placeholder', 'title'].forEach((a) => { const v = el.getAttribute(a); if (v) { const r = trText(v); if (r != null && r !== v) el.setAttribute(a, r); } }));
  }
  if (LANG === 'en') {
    document.documentElement.lang = 'en';
    document.title = 'Investment tracker';
    let trQueued = false;
    const mo = new MutationObserver(() => { if (trQueued) return; trQueued = true; requestAnimationFrame(() => { trQueued = false; mo.disconnect(); translateTree(document.body); mo.observe(document.body, { childList: true, subtree: true }); }); });
    translateTree(document.body);
    mo.observe(document.body, { childList: true, subtree: true });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-lang-pick]');
    if (!b) return;
    try { localStorage.setItem('tracker.lang', b.dataset.langPick); } catch (err) { /* niet erg */ }
    location.reload();
  });
  $$('[data-lang-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.langPick === LANG)));

  // ---------- Inloggen met de Trading 212-sleutel (nieuw apparaat) ----------
  // De Worker vergelijkt sleutel en secret met wat hij al heeft en geeft dan de toegangscode terug.
  // Alle andere koppelingen staan in de Worker, dus die werken op dit apparaat meteen. De sleutel zelf wordt niet bewaard.
  document.querySelectorAll('[data-login-form] [data-l="url"]').forEach((i) => { i.value = localStorage.getItem(LS_URL) || CFG.apiUrl || ''; });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('[data-login-go]');
    if (!b) return;
    const f = b.closest('[data-login-form]');
    const st = f.querySelector('.login-st');
    const say = (t, cls) => { st.textContent = t; st.className = 'small login-st ' + (cls || 'muted'); };
    const v = (k) => { const i = f.querySelector('[data-l="' + k + '"]'); return i ? i.value.trim() : ''; };
    const urlIn = f.querySelector('[data-l="url"]') ? v('url') : ($('in-url').value.trim() || getUrl());
    const url = urlIn || CFG.apiUrl || '';
    if (!/^https:\/\/[A-Za-z0-9.-]+\/api\/data$/.test(url)) { say('Vul het adres van je Cloudflare Worker in; het eindigt op /api/data.', 'loss'); return; }
    if (!v('key') || !v('secret')) { say('Vul je API-sleutel en secret van Trading 212 in.', 'loss'); return; }
    b.disabled = true; say('Bezig met inloggen…');
    try {
      const res = await fetch(url.replace(/\/api\/data$/, '/api/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: v('key'), secret: v('secret') }) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok || !j.token) throw new Error((j && j.error) || (res.status === 404 ? 'deze Worker kent inloggen met een sleutel nog niet; werk hem bij (Sync fork)' : 'de Worker gaf status ' + res.status));
      localStorage.setItem(LS_TOKEN, j.token);
      if (url !== CFG.apiUrl) localStorage.setItem(LS_URL, url); else localStorage.removeItem(LS_URL);
      f.querySelectorAll('[data-l="key"],[data-l="secret"]').forEach((i) => { i.value = ''; });
      const K = (j.features && j.features.keys) || {};
      const on = [['FMP_KEY', 'FMP'], ['FINNHUB_KEY', 'Finnhub'], ['SEC_CONTACT', 'SEC'], ['FRED_KEY', 'FRED']].filter(([k]) => K[k]).map(([, n]) => n);
      say('Ingelogd. ' + (on.length ? 'Al gekoppeld: Trading 212, ' + on.join(', ') + '.' : 'Trading 212 is gekoppeld.'), 'gain');
      demo = false;
      if ($('dlg-settings').open) $('dlg-settings').close();
      load();
    } catch (err) { say('Inloggen is mislukt: ' + err.message + '.', 'loss'); }
    finally { b.disabled = false; }
  });

  // ---------- Animaties aan of uit ----------
  function syncMotionButtons() {
    const p = motionPref();
    $$('[data-motion-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.motionPick === p)));
    const n = $('motion-note');
    if (n) n.textContent = MOTION_MQ.matches ? 'Je apparaat vraagt om minder beweging (bij Windows: Instellingen > Toegankelijkheid > Visuele effecten > Animatie-effecten). Bij Automatisch staan animaties daarom uit; kies Aan om ze toch te tonen.' : 'Animaties volgen je apparaat; kies Uit als je liever geen beweging hebt.';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-motion-pick]');
    if (!b) return;
    try { localStorage.setItem('tracker.motion', b.dataset.motionPick); } catch (err) { /* niet erg */ }
    applyMotion(); syncMotionButtons(); markFresh();
  });
  syncMotionButtons();

  // ---------- Updates van de site en app ----------
  let swReg = null, swReload = false;
  function showUpdate(on) {
    const el = $('update-banner');
    if (el) el.hidden = !on;
  }
  function watchSw(reg) {
    swReg = reg;
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(true);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(true); });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => { if (swReload) location.reload(); });
  function applyUpdate() {
    swReload = true;
    if (swReg && swReg.waiting) swReg.waiting.postMessage('skip'); else location.reload();
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('[data-upd]');
    if (!b) return;
    const st = $('upd-status');
    if (b.dataset.upd === 'now') { applyUpdate(); return; }
    if (b.dataset.upd === 'later') { showUpdate(false); return; }
    if (b.dataset.upd === 'check') {
      if (!swReg) { if (st) st.textContent = 'Updates controleren kan alleen op de website zelf (https).'; return; }
      if (st) st.textContent = 'Bezig met controleren…';
      try { await swReg.update(); } catch (err) { /* geen verbinding */ }
      setTimeout(() => { if (st) st.textContent = swReg.waiting || swReg.installing ? 'Er is een nieuwe versie. Kies Nu bijwerken.' : 'Je hebt de nieuwste versie (' + VERSION + ').'; if (swReg.waiting) showUpdate(true); }, 1500);
    }
  });
  if ($('app-version')) $('app-version').textContent = VERSION;

  // ---------- Voorbeeldgegevens ----------
  function makeDemoData() {
    let seed = 20261116;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const gauss = () => { let s = 0; for (let i = 0; i < 12; i++) s += rnd(); return s - 6; };
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00';
    // ticker, naam, waarde nu, beweeglijkheid per dag, rendement sinds aankoop, koers in euro
    const book = [
      ['VUAG', 'Vanguard S&P 500 UCITS ETF (Acc)', 412, 0.008, 0.031, 104.2], ['SXRV', 'iShares Nasdaq 100 UCITS ETF (Acc)', 268, 0.011, 0.054, 1180],
      ['ASML', 'ASML Holding', 96, 0.018, 0.040, 636], ['MSFT', 'Microsoft', 88, 0.012, -0.022, 438], ['GOOGL', 'Alphabet (Class A)', 75, 0.015, 0.068, 251],
      ['TSM', 'Taiwan Semiconductor', 72, 0.019, 0.029, 262], ['SPCX', 'Voorbeeld Ruimtevaart', 71, 0.03, -0.116, 48], ['AAPL', 'Apple', 68, 0.012, -0.014, 233],
      ['META', 'Meta Platforms', 61, 0.017, -0.063, 612], ['LLY', 'Eli Lilly', 59, 0.016, -0.098, 701], ['PLTR', 'Palantir', 50, 0.03, 0.127, 152],
      ['KO', 'Coca-Cola', 41, 0.007, 0.006, 63], ['TTWO', 'Take-Two Interactive', 39, 0.015, -0.035, 212], ['AMZN', 'Amazon', 34, 0.016, -0.041, 205],
    ];
    const SLOTS = 88;
    const now = new Date(); now.setSeconds(0, 0); now.setMinutes(Math.floor(now.getMinutes() / 10) * 10);
    const last = new Date(now); last.setHours(0, 0, 0, 0);
    while (last.getDay() === 0 || last.getDay() === 6) last.setDate(last.getDate() - 1);
    let lastSlots = SLOTS;
    if (dayKey(last.getTime()) === dayKey(now.getTime())) {
      const mins = (now.getHours() - 8) * 60 + now.getMinutes();
      lastSlots = mins < 0 ? 1 : Math.min(SLOTS, Math.floor(mins / 10) + 1);
    }
    const dates = [];
    const d0 = new Date(last);
    while (dates.length < 64) { if (d0.getDay() % 6) dates.unshift(new Date(d0)); d0.setDate(d0.getDate() - 1); }
    const nD = dates.length, buyDay = nD - 25;
    const cutoffH = new Date(last); cutoffH.setDate(cutoffH.getDate() - 30);
    const intraday = [], hours = [], days = [], today = [], positions = [];
    const tot = { intra: new Map(), hours: new Map(), days: new Map() };
    const add = (map, key, o) => { const x = map.get(key); if (!x) map.set(key, Object.assign({}, o)); else Object.keys(o).forEach((k) => { x[k] += o[k]; }); };
    const agg = (a) => ({ open: a[0], close: a[a.length - 1], low: Math.min(...a), high: Math.max(...a), avg: sum(a) / a.length });
    const r2 = (x) => Math.round(x * 100) / 100;

    book.forEach(([tk, name, target, vol, ret, price]) => {
      const path = [];
      let v = 1;
      const step = vol / Math.sqrt(SLOTS) * 1.2;
      dates.forEach((day, di) => {
        v *= 1 + gauss() * vol * 0.2;
        const n = di === nD - 1 ? lastSlots : SLOTS;
        const pts = [];
        for (let s = 0; s < n; s++) { v *= 1 + gauss() * step + 0.00004; pts.push(v); }
        path.push(pts);
      });
      const endV = path[nD - 1][path[nD - 1].length - 1];
      const scale = target / endV;
      let ath = -Infinity, atl = Infinity;
      const ranges = [];
      path.forEach((pts, di) => {
        const day = dates[di];
        const vals = pts.map((x, s) => r2(x * scale * (tk === 'KO' && (di < buyDay || (di === buyDay && s < 30)) ? 0.5 : 1)));
        vals.forEach((x) => { ath = Math.max(ath, x); atl = Math.min(atl, x); });
        if (di >= nD - 3) vals.forEach((x, s) => { const t = new Date(day); t.setHours(8, s * 10, 0, 0); const k = iso(t); intraday.push([k, tk, x]); add(tot.intra, k, { v: x }); });
        if (day >= cutoffH) {
          for (let h = 0; h < 15; h++) {
            const seg = vals.slice(h * 6, h * 6 + 7);
            if (seg.length < 7 && !(h === 14 && seg.length >= 2)) break;
            const t = new Date(day); t.setHours(8 + h, 0, 0, 0);
            const o = agg(seg);
            hours.push([iso(t), tk, o.open, o.close, o.low, o.high, r2(o.avg)]);
            add(tot.hours, iso(t), o);
          }
        }
        if (di < nD - 1) {
          const o = agg(vals);
          ranges.push([o.high - o.low, (o.high - o.low) / o.avg]);
          days.push([iso(day), tk, o.open, o.close, o.low, o.high, r2(o.avg), r2(o.high - o.low), (o.high - o.low) / o.avg]);
          add(tot.days, iso(day), o);
        } else {
          const o = agg(vals);
          today.push({ ticker: tk, name, current: o.close, low: o.low, high: o.high, avg: r2(o.avg), open: o.open,
            change: r2(o.close - o.open), changePct: (o.close - o.open) / o.open, allTimeHigh: ath, allTimeLow: atl,
            avgRange: r2(mean(ranges.map((x) => x[0]))), avgRangePct: mean(ranges.map((x) => x[1])), days: ranges.length });
          const cost = r2(o.close / (1 + ret));
          positions.push({ ticker: tk, name, value: o.close, unrealized: r2(o.close - cost), cost, resultPct: ret, quantity: +(o.close / price).toFixed(6) });
        }
      });
    });

    const rows = (map, tk, f) => [...map.keys()].sort().map((k) => f(k, map.get(k)));
    rows(tot.intra, TOTAL, (k, o) => intraday.push([k, TOTAL, r2(o.v)]));
    rows(tot.hours, TOTAL, (k, o) => hours.push([k, TOTAL, r2(o.open), r2(o.close), r2(o.low), r2(o.high), r2(o.avg)]));
    rows(tot.days, TOTAL, (k, o) => days.push([k, TOTAL, r2(o.open), r2(o.close), r2(o.low), r2(o.high), r2(o.avg), r2(o.high - o.low), (o.high - o.low) / o.avg]));

    const lastKey = dayKey(last.getTime());
    const tSeries = intraday.filter((r) => r[1] === TOTAL && dayKey(new Date(r[0]).getTime()) === lastKey).map((r) => r[2]);
    const tDays = days.filter((r) => r[1] === TOTAL);
    const to = agg(tSeries);
    today.sort((a, b) => a.ticker.localeCompare(b.ticker));
    today.unshift({ ticker: TOTAL, name: 'Totaal beleggingen', current: to.close, low: to.low, high: to.high, avg: r2(to.avg), open: to.open,
      change: r2(to.close - to.open), changePct: (to.close - to.open) / to.open,
      allTimeHigh: Math.max(to.high, ...tDays.map((r) => r[5])), allTimeLow: Math.min(to.low, ...tDays.map((r) => r[4])),
      avgRange: r2(mean(tDays.map((r) => r[7]))), avgRangePct: mean(tDays.map((r) => r[8])), days: tDays.length });

    // Weken: zaterdag, met de slotwaarde van vrijdag
    const weeks = [];
    let cash = 50.37, deposits = null, prev = null;
    tDays.forEach((r, i) => {
      const day = new Date(r[0]);
      if (day.getDay() !== 5) return;
      const sat = new Date(day); sat.setDate(sat.getDate() + 1);
      const wi = weeks.length;
      let newDep = 0;
      if (wi === 3 || wi === 7) { newDep = 50; cash += 50; }
      if (prev && day.getTime() > dates[buyDay].getTime() && !weeks.some((w) => w.boughtKO)) { newDep += 20; }
      const acc = r2(r[3] + cash);
      if (deposits == null) deposits = r2(acc + 12);
      else deposits = r2(deposits + newDep);
      const w = { date: iso(sat), accountValue: acc, netDeposits: deposits, cash: r2(cash), costBasis: null,
        totalResult: r2(acc - deposits), totalResultPct: (acc - deposits) / deposits, source: 'Voorbeeld' };
      if (prev) {
        w.weekChange = r2(acc - prev.accountValue);
        w.newDeposits = r2(deposits - prev.netDeposits);
        w.weekResult = r2(w.weekChange - w.newDeposits);
        w.weekResultPct = w.weekResult / prev.accountValue;
      } else { w.weekChange = null; w.newDeposits = null; w.weekResult = null; w.weekResultPct = null; }
      if (newDep >= 20 && day.getTime() > dates[buyDay].getTime()) w.boughtKO = true;
      weeks.push(w);
      prev = w;
    });
    const unrealSum = sum(positions.map((p) => p.unrealized));
    weeks.forEach((w, i) => { w.unrealized = r2(unrealSum * (0.6 + 0.4 * (i + 1) / weeks.length)); delete w.boughtKO; });

    // Agenda: datums ten opzichte van vandaag
    const dIn = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return iso(d).slice(0, 10); };
    const events = {
      updated: iso(now), fmp: true, errors: [],
      // ticker, dagen geleden, bruto per aandeel (dollar), aantal; netto = na 15% bronbelasting, omgerekend naar euro
      received: [
        ['KO', -411, 0.485, 0.9], ['KO', -320, 0.485, 0.9], ['KO', -229, 0.485, 0.9], ['KO', -138, 0.51, 0.9], ['KO', -47, 0.51, 1.8],
        ['MSFT', -341, 0.75, 0.2], ['MSFT', -250, 0.75, 0.2], ['MSFT', -160, 0.83, 0.2], ['MSFT', -68, 0.83, 0.2],
        ['AAPL', -372, 0.24, 0.29], ['AAPL', -190, 0.25, 0.29], ['AAPL', -99, 0.25, 0.29], ['AAPL', -8, 0.26, 0.29],
        ['TSM', -395, 0.6, 0.3], ['TSM', -120, 0.7, 0.3], ['TSM', -30, 0.83, 0.3],
      ].map(([ticker, n, perShare, qty]) => ({ ticker, date: dIn(n), amount: Math.round(perShare * qty * 0.85 / 1.09 * 100) / 100, perShare, qty })),
      earnings: [['AAPL', 6, 2.35], ['MSFT', 9, 3.1], ['META', 12, 6.7], ['GOOGL', 15, 2.6], ['AMZN', 19, 1.9], ['ASML', 23, 5.6], ['TSM', 27, 2.7], ['PLTR', 34, 0.21], ['KO', 41, 0.6]]
        .map(([ticker, n, epsEst]) => ({ ticker, symbol: ticker, date: dIn(n), epsEst, revEst: null })),
      lastEarnings: [{ ticker: 'AAPL', date: dIn(-84), eps: 1.85, epsEst: 1.77 }, { ticker: 'MSFT', date: dIn(-81), eps: 3.46, epsEst: 3.66 }],
      dividends: [{ ticker: 'KO', exDate: dIn(10), payDate: dIn(29), perShare: 0.51, estEur: 0.92, announced: true },
        { ticker: 'ASML', exDate: dIn(4), payDate: dIn(16), perShare: 1.6, estEur: 0.24, announced: true }],
    };

    // Markt: sectoren, branches en vergelijkbare bedrijven
    const META_INFO = {
      ASML: ['Technology', 'Semiconductor Equipment & Materials', ['AMAT', 'LRCX', 'KLAC', 'TSM']], MSFT: ['Technology', 'Software - Infrastructure', ['ORCL', 'GOOGL', 'CRM', 'PLTR']],
      GOOGL: ['Communication Services', 'Internet Content & Information', ['META', 'MSFT', 'AMZN', 'NFLX']], TSM: ['Technology', 'Semiconductors', ['NVDA', 'AVGO', 'AMD', 'INTC']],
      SPCX: ['Industrials', 'Aerospace & Defense', ['LMT', 'RTX', 'NOC', 'GD', 'BA']], AAPL: ['Technology', 'Consumer Electronics', ['MSFT', 'SONY', 'DELL', 'HPQ']],
      META: ['Communication Services', 'Internet Content & Information', ['GOOGL', 'SNAP', 'PINS', 'RDDT']], LLY: ['Healthcare', 'Drug Manufacturers - General', ['JNJ', 'ABBV', 'MRK', 'NVO', 'AZN']],
      PLTR: ['Technology', 'Software - Infrastructure', ['SNOW', 'CRWD', 'MSFT', 'ORCL']], KO: ['Consumer Defensive', 'Beverages - Non-Alcoholic', ['PEP', 'KDP', 'MNST']],
      TTWO: ['Communication Services', 'Electronic Gaming & Multimedia', ['EA', 'RBLX', 'NTES']], AMZN: ['Consumer Cyclical', 'Internet Retail', ['WMT', 'BABA', 'EBAY', 'SHOP']],
    };
    const mDays = [];
    const md = new Date(now); md.setDate(md.getDate() - 1);
    while (mDays.length < 25) { if (md.getDay() % 6) mDays.unshift(iso(md).slice(0, 10)); md.setDate(md.getDate() - 1); }
    const profiles = {}, prices = {}, peersMk = {}, symbols = {};
    const sectorOfSym = {};
    Object.entries(META_INFO).forEach(([tk, [sec, ind, prs]]) => { symbols[tk] = tk; peersMk[tk] = prs; sectorOfSym[tk] = [sec, ind]; prs.forEach((x) => { if (!sectorOfSym[x]) sectorOfSym[x] = [sec, ind]; }); });
    Object.entries(sectorOfSym).forEach(([sym, [sec, ind]], i) => {
      const price = 40 + rnd() * 600, lo = price * (0.55 + rnd() * 0.3), hi = price * (1.02 + rnd() * 0.4);
      profiles[sym] = { symbol: sym, name: (book.find((b) => b[0] === sym) || [0, sym + ' Corporation'])[1], price: +price.toFixed(2), currency: 'USD',
        marketCap: Math.round((0.02 + rnd() * 3) * 1e12), beta: +(0.4 + rnd() * 1.6).toFixed(2), range: lo.toFixed(2) + '-' + hi.toFixed(2),
        change: +(gauss() * 1.4).toFixed(2), sector: sec, industry: ind, exchange: i % 2 ? 'NYSE' : 'NASDAQ', country: 'US', ipoDate: (1980 + Math.floor(rnd() * 40)) + '-06-15' };
      let v = price;
      const hist = i % 3 === 2 ? mDays.slice(-1) : mDays;
      prices[sym] = hist.slice().reverse().map((d) => { const out = [d, +v.toFixed(2)]; v /= 1 + gauss() * 0.015; return out; }).reverse();
    });
    const sectorsMk = {}, industriesMk = {};
    ['Technology', 'Healthcare', 'Industrials', 'Communication Services', 'Consumer Cyclical', 'Consumer Defensive', 'Financial Services', 'Energy', 'Basic Materials', 'Real Estate', 'Utilities']
      .forEach((sec) => { const drift = gauss() * 0.15; sectorsMk[sec] = { NASDAQ: mDays.map((d) => [d, +(drift + gauss() * 0.8).toFixed(3)]), NYSE: mDays.map((d) => [d, +(drift + gauss() * 0.7).toFixed(3)]) }; });
    new Set(Object.values(sectorOfSym).map((x) => x[1])).forEach((ind) => { const drift = gauss() * 0.2; industriesMk[ind] = { NASDAQ: mDays.map((d) => [d, +(drift + gauss() * 1.1).toFixed(3)]), NYSE: mDays.map((d) => [d, +(drift + gauss() * 1).toFixed(3)]) }; });
    // Waardering: koers-winstverhouding en dividendrendement, nu en per jaar (voorbeelden)
    const valuation = {};
    const DIV_DEMO = { KO: 0.029, MSFT: 0.007, AAPL: 0.0045, TSM: 0.013, LLY: 0.007, GOOGL: 0.004, META: 0.003, ASML: 0.009 };
    Object.keys(profiles).forEach((sym) => {
      const base = 14 + rnd() * 40, dy = DIV_DEMO[sym] || 0;
      const yrs = [2021, 2022, 2023, 2024, 2025];
      valuation[sym] = { updated: dIn(-3), pe: sym === 'SPCX' ? null : +(base * (0.85 + rnd() * 0.4)).toFixed(1), dy: dy || null,
        hist: yrs.map((y) => [String(y), sym === 'SPCX' ? null : +(base * (0.7 + rnd() * 0.6)).toFixed(1), dy ? +(dy * (0.8 + rnd() * 0.4)).toFixed(4) : null]) };
    });
    const sectorPe = { date: mDays[mDays.length - 1], sectors: { Technology: 38.5, 'Communication Services': 24.1, Healthcare: 27.3, Industrials: 26.8, 'Consumer Cyclical': 29.9, 'Consumer Defensive': 22.4, 'Financial Services': 17.2, Energy: 13.1 } };
    const market = { symbols, peers: peersMk, profiles, prices, sectors: sectorsMk, industries: industriesMk, updated: mDays[mDays.length - 1], watch: ['NVDA', 'LMT'], valuation, sectorPe };

    // Transacties, valuta en fondssamenstelling
    const orders = [], posExtra = {};
    const curOf = (tk) => (['VUAG', 'SXRV'].includes(tk) ? 'GBX' : tk === 'ASML' ? 'EUR' : 'USD');
    positions.forEach((pp, i) => {
      const cur = curOf(pp.ticker);
      const fxr = cur === 'USD' ? 1.08 + rnd() * 0.06 : 1;
      const nativeNow = cur === 'USD' ? pp.value / pp.quantity * 1.16 : cur === 'GBX' ? pp.value / pp.quantity * 85 : pp.value / pp.quantity;
      const fxImp = cur === 'USD' ? +(-pp.cost * (0.01 + rnd() * 0.03)).toFixed(2) : cur === 'GBX' ? +(pp.cost * (rnd() - 0.5) * 0.02).toFixed(2) : null;
      posExtra[pp.ticker] = { avg: +(nativeNow / (1 + pp.resultPct) * (cur === 'USD' ? 1.02 : 1)).toFixed(2), price: +nativeNow.toFixed(2), cur, fx: fxImp, cost: pp.cost };
      const nBuys = 1 + (i % 3);
      for (let k = 0; k < nBuys; k++) {
        const d = new Date(dates[Math.max(0, nD - 60 + k * 17 + i)]); d.setHours(15, 30 + i, 0, 0);
        const q = pp.quantity / nBuys, net = +(pp.cost / nBuys).toFixed(2);
        orders.push([iso(d), pp.ticker, pp.name, 'BUY', +q.toFixed(6), +(posExtra[pp.ticker].avg).toFixed(2), cur, fxr, net, 0, cur === 'USD' ? +(net * 0.0015).toFixed(2) : 0, 0, 'TRADE']);
      }
    });
    const dSell = new Date(dates[nD - 20]); dSell.setHours(16, 5, 0, 0);
    orders.push([iso(new Date(dates[nD - 58])), 'NVDA', 'NVIDIA', 'BUY', 0.4, 172.5, 'USD', 1.09, 63.3, 0, 0.09, 0, 'TRADE']);
    orders.push([iso(dSell), 'NVDA', 'NVIDIA', 'SELL', 0.4, 191.2, 'USD', 1.12, 68.29, 4.99, 0.1, 0, 'TRADE']);
    const dSell2 = new Date(dates[nD - 9]); dSell2.setHours(17, 40, 0, 0);
    orders.push([iso(dSell2), 'PLTR', 'Palantir', 'SELL', 0.05, 158.2, 'USD', 1.15, 6.88, 0.71, 0.01, 0, 'TRADE']);
    orders.sort((a, b) => a[0].localeCompare(b[0]));
    const etfRows = (list) => list.map(([tk, nm, sec, w]) => [tk, nm, sec, w]);
    const etf = {
      SP500: { label: 'S&P 500', fund: 'iShares Core S&P 500 UCITS ETF (CSPX)', asOf: '13/Nov/2026', count: 503, rows: etfRows([
        ['NVDA', 'NVIDIA CORP', 'Information Technology', 7.9], ['MSFT', 'MICROSOFT CORP', 'Information Technology', 6.6], ['AAPL', 'APPLE INC', 'Information Technology', 6.4],
        ['AMZN', 'AMAZON COM INC', 'Consumer Discretionary', 4.1], ['GOOGL', 'ALPHABET INC CLASS A', 'Communication', 2.4], ['META', 'META PLATFORMS INC CLASS A', 'Communication', 2.6],
        ['AVGO', 'BROADCOM INC', 'Information Technology', 2.5], ['GOOG', 'ALPHABET INC CLASS C', 'Communication', 1.9], ['TSLA', 'TESLA INC', 'Consumer Discretionary', 2.0],
        ['BRKB', 'BERKSHIRE HATHAWAY INC CLASS B', 'Financials', 1.6], ['JPM', 'JPMORGAN CHASE & CO', 'Financials', 1.5], ['LLY', 'ELI LILLY', 'Health Care', 1.3],
        ['V', 'VISA INC CLASS A', 'Financials', 1.0], ['XOM', 'EXXON MOBIL CORP', 'Energy', 0.9], ['PLTR', 'PALANTIR TECHNOLOGIES INC CLASS A', 'Information Technology', 0.7], ['KO', 'COCA-COLA', 'Consumer Staples', 0.4]]) },
      NDX: { label: 'Nasdaq-100', fund: 'iShares Nasdaq 100 UCITS ETF (CNDX)', asOf: '13/Nov/2026', count: 101, rows: etfRows([
        ['NVDA', 'NVIDIA CORP', 'Information Technology', 9.4], ['MSFT', 'MICROSOFT CORP', 'Information Technology', 8.2], ['AAPL', 'APPLE INC', 'Information Technology', 7.8],
        ['AMZN', 'AMAZON COM INC', 'Consumer Discretionary', 5.3], ['AVGO', 'BROADCOM INC', 'Information Technology', 4.9], ['META', 'META PLATFORMS INC CLASS A', 'Communication', 3.6],
        ['GOOGL', 'ALPHABET INC CLASS A', 'Communication', 3.1], ['GOOG', 'ALPHABET INC CLASS C', 'Communication', 2.9], ['TSLA', 'TESLA INC', 'Consumer Discretionary', 2.7],
        ['NFLX', 'NETFLIX INC', 'Communication', 1.6], ['COST', 'COSTCO WHOLESALE CORP', 'Consumer Staples', 1.9], ['PLTR', 'PALANTIR TECHNOLOGIES INC CLASS A', 'Information Technology', 1.7],
        ['ASML', 'ASML HOLDING ADR', 'Information Technology', 0.9], ['TTWO', 'TAKE TWO INTERACTIVE SOFTWARE INC', 'Communication', 0.3]]) },
    };

    // Onderzoek, bedrijfscijfers, wisselkoers en inflatie (voorbeelden)
    const research = {}, fin = {};
    book.filter((x) => !['VUAG', 'SXRV'].includes(x[0])).forEach(([tk, name], i) => {
      const day = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d.getTime(); };
      research[tk] = {
        news: [1, 2, 4, 7].map((n, k) => ({ t: day(n), headline: 'Voorbeeld: ' + name + ' ' + ['stijgt na sterke cijfers', 'daalt na verlaagde verwachting', 'kondigt nieuw product aan', 'krijgt opwaardering van analist'][(k + i) % 4] + ' (geen echt nieuws)', source: 'Voorbeeldbron', url: '#' })),
        rec: [0, 1, 2, 3].map((k) => ({ period: dIn(-30 * k).slice(0, 8) + '01', sb: 6 + ((i + k) % 5), b: 12 + ((i * 3 + k) % 7), h: 6 + (i % 6), s: (i + k) % 3, ss: (i % 4 === 0) ? 1 : 0 })),
        eps: [0, 1, 2, 3].map((k) => { const est = +(1 + rnd() * 3).toFixed(2); const pct = +((rnd() - 0.35) * 14).toFixed(1); return { period: dIn(-91 * k - 40), actual: +(est * (1 + pct / 100)).toFixed(2), estimate: est, pct }; }),
        insider: [3, 11, 25, 48, 77].map((n, k) => ({ name: ['Voorbeeld, A.', 'Voorbeeld, B.', 'Voorbeeld, C.'][k % 3], date: dIn(-n), code: ['S', 'M', 'S', 'P', 'F'][(k + i) % 5], change: (k + i) % 5 === 3 ? 800 : -1200 - k * 300, price: +(50 + rnd() * 300).toFixed(2), shares: 10000 })),
      };
      const base = (5 + rnd() * 300) * 1e9, margin = 0.05 + rnd() * 0.3;
      const yrs = [2020, 2021, 2022, 2023, 2024, 2025];
      let r = base;
      const rows = yrs.map((y) => { r *= 1 + (rnd() * 0.25 - 0.02); return [y, Math.round(r)]; });
      fin[tk] = { updated: dIn(-2), series: {
        rev: { unit: tk === 'TSM' ? 'TWD' : 'USD', rows: rows.map(([y, v]) => [y, tk === 'TSM' ? v * 30 : v]) },
        net: { unit: tk === 'TSM' ? 'TWD' : 'USD', rows: rows.map(([y, v], k) => [y, Math.round((tk === 'TSM' ? v * 30 : v) * (margin + (rnd() - 0.5) * 0.06) * (tk === 'SPCX' && k < 3 ? -0.4 : 1))]) },
        op: { unit: 'USD', rows: rows.map(([y, v]) => [y, Math.round(v * (margin + 0.05))]) },
        eps: { unit: 'USD/shares', rows: rows.map(([y], k) => [y, +(1 + k * 0.6 + rnd()).toFixed(2)]) },
      } };
    });
    fin.ASML = { updated: dIn(-2), none: 'Voorbeeld: geen SEC-gegevens voor dit bedrijf.' };
    // Koersdoel en nieuwsstemming, ook voor de volglijst (NVDA, LMT)
    ['NVDA', 'LMT'].forEach((tk, i) => { research[tk] = Object.assign({}, research.AAPL, { news: research.AAPL.news.map((n) => Object.assign({}, n, { headline: n.headline.replace('Apple', tk) })) }); fin[tk] = fin.MSFT; });
    Object.keys(research).forEach((tk) => {
      const pr = (profiles[tk] && profiles[tk].price) || (100 + rnd() * 300);
      research[tk].target = { mean: +(pr * (0.95 + rnd() * 0.3)).toFixed(2), median: +(pr * 1.05).toFixed(2), high: +(pr * 1.45).toFixed(2), low: +(pr * 0.7).toFixed(2), updated: dIn(-5) };
      const bull = +(0.3 + rnd() * 0.5).toFixed(2);
      research[tk].sent = { bull, bear: +(1 - bull).toFixed(2), score: +(0.4 + rnd() * 0.5).toFixed(2), sector: 0.55, articles: Math.round(10 + rnd() * 80), buzz: 1 };
      // Koersdoel-geschiedenis per week, voor de betrouwbaarheid van analisten
      const ph = prices[tk] || [];
      research[tk].targetHist = ph.length > 5 ? ph.filter((p, k) => k % 5 === 0).map(([d, v]) => ({ d, mean: +(v * (0.9 + rnd() * 0.3)).toFixed(2) })) : [];
    });
    const marketNews = { updated: iso(now), items: [1, 3, 5, 8, 12, 20, 26, 30].map((h, k) => ({ t: now.getTime() - h * HOUR,
      headline: ['Voorbeeld: centrale bank houdt rente gelijk', 'Voorbeeld: techaandelen stijgen na sterke cijfers', 'Voorbeeld: olieprijs daalt', 'Voorbeeld: euro sterker tegenover dollar',
        'Voorbeeld: chipmakers onder druk', 'Voorbeeld: inflatie in de VS lager dan verwacht', 'Voorbeeld: beurzen in Azië gemengd', 'Voorbeeld: overname in de zorgsector'][k] + ' (geen echt nieuws)',
      summary: 'Voorbeeldtekst; met een Finnhub-sleutel staat hier echt marktnieuws.', source: 'Voorbeeldbron', url: '#', related: '' })) };
    events.earnings.push({ ticker: 'NVDA', symbol: 'NVDA', date: dIn(9), epsEst: 1.31 });
    // Indexen (koersindex in dollars), 400 dagen
    const idxSer = (start, drift, vol) => { const out = []; let v = start; for (let k = 400; k >= 0; k--) { const d = new Date(now); d.setDate(d.getDate() - k); if (!(d.getDay() % 6)) continue; v *= 1 + drift + gauss() * vol; out.push([iso(d).slice(0, 10), +v.toFixed(2)]); } return out; };
    const fxRates = { USD: [], GBP: [] };
    let rU = 1.06, rG = 0.84;
    for (let k = 400; k >= 0; k--) { const d = new Date(now); d.setDate(d.getDate() - k); if (!(d.getDay() % 6)) continue; rU *= 1 + gauss() * 0.003 + 0.00012; rG *= 1 + gauss() * 0.002; fxRates.USD.push([iso(d).slice(0, 10), +rU.toFixed(4)]); fxRates.GBP.push([iso(d).slice(0, 10), +rG.toFixed(4)]); }
    const hser = (rate, end) => { const out = []; let v = end; const d = new Date(now); d.setDate(1); d.setMonth(d.getMonth() - 1); for (let k = 0; k < 72; k++) { out.unshift([d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), +v.toFixed(2)]); v /= 1 + rate / 12 + gauss() * 0.002; d.setMonth(d.getMonth() - 1); } return out; };
    const extraDemo = {
      research, fin,
      fx: { updated: iso(now), source: 'Voorbeeld', rates: fxRates },
      hicp: { updated: iso(now), source: 'Voorbeeld', series: { NL: hser(0.034, 101.9), U2: hser(0.026, 101.3) } },
      idx: { updated: iso(now), source: 'Voorbeeld', series: { SP500: idxSer(6100, 0.0004, 0.009), NASDAQ100: idxSer(21000, 0.0005, 0.012) } },
      features: { flags: { fx: true, inflation: true, sec: true, etfAuto: true }, has: { fmp: true, finnhub: true, sec: true, t212: true } },
    };

    // Aankoopdagboek en andere rekeningen (voorbeelden)
    const demoNotes = {};
    const firstBuy = (tk) => orders.find((o) => o[1] === tk && o[3] === 'BUY');
    [['ASML', 'Marktleider in chipmachines; wil meer Europa in mijn portefeuille.'], ['KO', 'Rustig dividendaandeel als tegenwicht voor techniek.'],
      ['PLTR', 'Gok op groei in software voor overheden; klein gehouden.'], ['NVDA', 'Korte termijn na de cijfers, verkocht met winst.'], ['MSFT', 'Cloud en kantoorsoftware, voor de lange termijn.']]
      .forEach(([tk, txt]) => { const o = firstBuy(tk); if (o) demoNotes[tk + '|' + new Date(o[0]).getTime()] = txt; });
    const demoAccounts = [{ id: 'demo1', name: 'Pensioenrekening', broker: 'Voorbeeldbroker', cash: 35.2, updated: dIn(-6),
      holdings: [{ name: 'iShares Core MSCI World', tk: 'IWDA', isin: 'IE00B4L5Y983', qty: 9, value: 912.4, cost: 801 },
        { name: 'Vanguard FTSE All-World', tk: 'VWRL', isin: 'IE00B3RBWM25', qty: 4, value: 488.1, cost: 452 },
        { name: 'ASML Holding', tk: 'ASML', isin: 'NL0010273215', qty: 0.5, value: 318, cost: 290 }] }];
    const yNow = new Date().getFullYear();
    const peilDemo = [{ date: yNow + '-01-01', total: 1180.55, investments: 1131.2, cash: 49.35, positions: [] }, { date: (yNow - 1) + '-01-01', total: 742.1, investments: 700.4, cash: 41.7, positions: [] }];
    return Object.assign({
      ok: true, generated: iso(now), currency: 'EUR', weeks, positionsDate: iso(now), positions, today, events, market, marketNews, demoNotes, demoAccounts,
      orders: { columns: ['time', 'ticker', 'name', 'side', 'qty', 'price', 'currency', 'fxRate', 'net', 'realised', 'feeFx', 'feeOther', 'kind'], rows: orders },
      posExtra, etf, peil: peilDemo, settings: {},
      intraday: { columns: ['time', 'ticker', 'value'], rows: intraday },
      hours: { columns: ['hour', 'ticker', 'open', 'close', 'low', 'high', 'avg'], rows: hours },
      days: { columns: ['date', 'ticker', 'open', 'close', 'low', 'high', 'avg', 'range', 'rangePct'], rows: days },
    }, extraDemo);
  }


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
})();
