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
  const HOUR = 3600e3;
  const DAY = 864e5;

  const nf = (o) => new Intl.NumberFormat('nl-NL', o);
  const EUR = nf({ style: 'currency', currency: 'EUR' });
  const P2 = nf({ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const P1 = nf({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const N2 = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const N4 = nf({ maximumFractionDigits: 4 });
  const N1 = nf({ maximumFractionDigits: 1 });
  const NI = nf({ maximumFractionDigits: 0 });
  const fDT = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fD = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
  const fDM = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });
  const fHM = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const fWH = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const eur = (v) => (isNum(v) ? EUR.format(v) : '–');
  const sgn = (v, f) => (!isNum(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + f.format(Math.abs(v)));
  const seur = (v) => sgn(v, EUR);
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
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C = { accent: '#2B5BD7', gain: '#0B7A4B', loss: '#B4311F', ink2: '#5B6472', soft: '#8FAEF0', ink: '#14181F' };
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
    document.querySelector('meta[name="theme-color"]').content = mode === 'm' && ui.page !== 'home' ? '#F6F7F9' : '#E8EDFA';
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
    return '<div class="bars">' + items.map((it) => {
      const v = it.v;
      return '<div class="col" data-tip="' + esc(it.tip) + '">' +
        '<div class="half up"><div class="b' + (isNum(v) && v > 0 ? '' : ' none') + '" style="height:' + (v > 0 ? h(v) : 0) + '%"></div></div>' +
        '<div class="half down"><div class="b' + (isNum(v) && v < 0 ? '' : ' none') + '" style="height:' + (v < 0 ? h(v) : 0) + '%"></div></div></div>';
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
      stat('Netto gestort', last ? eur(last.netDeposits) : '–', last ? (isNum(last.newDeposits) && last.newDeposits ? seur(last.newDeposits) + ' in de laatste week' : 'geen storting in de laatste week') : none, '', spark(wk('netDeposits'), C.ink2)),
      stat('Totaal resultaat', last ? seur(last.totalResult) : '–', last ? spct(last.totalResultPct) + ' op je inleg' : none, last ? tone(last.totalResult) : '', spark(wk('totalResult'), toneColor(last && last.totalResult))),
      stat('Ongerealiseerd', seur(unreal), 'open posities, nu', tone(unreal), spark(wk('unrealized'), toneColor(unreal))),
    ];
  }

  // Maak van een kaart een knop die inzoomt
  function clickable(html, key, label) {
    return html.replace(/^<section class="([^"]*)">/, '<button type="button" class="$1 clickable" data-ticker="' + key + '" aria-label="' + esc(label) + '">')
      .replace(/<\/section>$/, '<span class="more" aria-hidden="true">Verdeling ›</span></button>');
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
      stat('Beweeglijkheid', isNum(S.sd) ? '± ' + P1.format(S.sd) + ' per dag' : '–', isNum(S.sd) ? 'gemiddelde afwijking van het dagresultaat' : tooFew(S.n, MIN_DAYS_SD)),
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
    ]) + '</section>';
    return { S, kpis, rangeTile, posTile, histTile, agendaTile: companyAgenda(c), tradeTile: companyTrades(c), market: companyMarket(c), patterns: patternTiles(c.tk, S) };
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
      '<span class="tx-v">' + esc(eur(x.net)) + (x.realised ? '<span class="sub ' + tone(x.realised) + '">' + esc(seur(x.realised)) + '</span>' : '') + '</span></div>').join('') + '</div>' : '';
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
  const fDay = new Intl.DateTimeFormat('nl-NL', { day: 'numeric' });
  const fMon = new Intl.DateTimeFormat('nl-NL', { month: 'short' });
  const fMonY = new Intl.DateTimeFormat('nl-NL', { month: 'short', year: '2-digit' });
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
    const c = M.byTk.get(host.dataset.tk);
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
  const demoSettings = () => { try { return JSON.parse(localStorage.getItem(LS_DEMO_SET) || '{}'); } catch (e) { return {}; } };
  const plan = { mode: null, draft: null, amount: 100, years: 10, monthly: null, goal: null, status: '' };

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
      '<h3 style="margin-top:18px">Nieuwe inleg verdelen</h3>' +
      '<div class="plan-amount"><label for="plan-amount">Bedrag</label><span class="eur-in">€<input id="plan-amount" type="number" inputmode="decimal" min="0" step="10" value="' + esc(plan.amount) + '"></span></div>' +
      (advice.length ? '<div class="legend-list advice">' + advice.map((o) =>
        '<div class="legend-row"><span class="nm"><b>' + esc(o.x.label) + '</b> <span class="muted small">' + esc(plan.mode === 'sector' ? o.x.sub : o.x.sub) + '</span></span><b>' + esc(eur(o.a)) + '</b></div>').join('') + '</div>' +
        '<p class="sub" style="margin-top:8px">Zo kom je zo dicht mogelijk bij je doelen zonder iets te verkopen. Eerst gaat geld naar wat het verst onder het doel zit; wat overblijft volgens je doelen.</p>'
        : '<p class="muted">Vul hierboven doelen in om te zien waar nieuwe inleg het best heen kan.</p>') + '</section>';
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
    host.innerHTML = '<div class="plan-grid">' + targetTile() + forecastTile() + exposureTile() + peilTile() + exportTile() + '</div>';
    drawForecast(host);
    if (focus && $(focus)) { const el = $(focus); el.focus(); const v = el.value; el.value = ''; el.value = v; }
  }

  function planEvents(host) {
    host.addEventListener('click', async (e) => {
      const seg = e.target.closest('[data-plan="mode"] button[data-k], [data-plan="years"] button[data-k]');
      if (seg) {
        const g = seg.parentElement.dataset.plan;
        if (g === 'mode') { plan.mode = seg.dataset.k; plan.draft = null; } else plan.years = Number(seg.dataset.k);
        plan.status = ''; renderPlan(); return;
      }
      const exp = e.target.closest('[data-export]');
      if (exp) { const k = exp.dataset.export; download('investeringstracker-' + k + '-' + new Date().toISOString().slice(0, 10) + '.csv', EXPORTS[k]()); return; }
      const tr = e.target.closest('tr[data-ticker]');
      if (tr) return; // document-handler opent het bedrijf
      const act = e.target.closest('[data-plan]');
      if (!act) return;
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

  // ---------- Desktop ----------
  function renderHome() {
    const T = M.tot;
    $('hero-label').textContent = 'Waarde beleggingen, ' + (M.lastT ? fDT.format(M.lastT) : 'laatste meting');
    $('hero-value').textContent = eur(M.totalValue);
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
          '<div class="d-nav"><button type="button" class="btn line" data-act="prev" aria-label="Vorige: ' + esc(prev.name) + '">← ' + esc(prev.tk) + '</button>' +
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
        '<div class="grid wide" style="margin-top:16px">' + I.rangeTile + I.posTile + I.tradeTile + I.histTile + I.agendaTile + '</div>' +
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
    $('m-hero-value').textContent = eur(M.totalValue);
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
    fill('m-patterns', patternTiles(TOTAL, S));
  }

  function renderDetailMobile(c, swapDir) {
    const { prev, next } = detailNav(c);
    const I = companyInfo(c);
    const sw = swapDir ? ' swap-' + swapDir : '';
    const tabs = [['pos', 'Positie'], ['cmp', 'Vergelijk'], ['hist', 'Historie'], ['pat', 'Patronen']];
    const panel = ui.mTab === 'hist' ? I.histTile : ui.mTab === 'pat' ? '<div class="m-stack">' + I.patterns.join('') + '</div>'
      : ui.mTab === 'cmp' ? I.market.tiles.join('') + I.market.table : I.rangeTile + I.posTile + I.tradeTile + I.agendaTile;
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
  const hasView = (k) => k === ACC || (M && M.byTk.has(k));
  const viewHash = (k) => (k === ACC ? '#accountwaarde' : '#bedrijf/' + encodeURIComponent(k));
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

    const secTile = M.mk.ok ? sectorTiles()[0] : '';
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

  // ---------- Bedrijfspagina (beide weergaven) ----------
  function renderDetail(animate, swapDir) {
    if (ui.detail === ACC) { $('detail-inner').innerHTML = renderAccount(); return; }
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
    const op = e.target.closest('[data-open]');
    if (op) { switchDetail(op.dataset.open, 'r'); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { ui.mTab = tab.dataset.tab; renderDetail(false); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') closeDetail();
    else if (act === 'prev' || act === 'next') stepDetail(act === 'next' ? 1 : -1);
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
    if (ui.detail === ACC) { ui.detailRange = '3d'; ui.compare = false; ui.mTab = 'pos'; } else ui.origin = tk;
    ui.detail = tk;
    history.replaceState({ detail: tk }, '', viewHash(tk));
    ov.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
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
    if (!e.target.closest || ov.contains(e.target)) return;
    const imp = e.target.closest('[data-act="import"]');
    if (imp) { openSettings(true); return; }
    if (!e.target.closest('#app, #m-main')) return;
    const go = e.target.closest('[data-goto]');
    if (go) { location.hash = go.dataset.goto; return; }
    const el = e.target.closest('[data-ticker]');
    if (el) openDetail(el.dataset.ticker, el, true);
  });

  // ---------- Pagina's en adresbalk ----------
  const ORDER = { home: 0, list: 1, stats: 2, plan: 3 };
  const TITLES = { home: 'Overzicht', list: 'Bedrijven', stats: 'Statistieken', plan: 'Plannen' };
  const pageId = (p) => (mode === 'm' ? 'm-' + p : 'page-' + p);
  const pageHash = (p) => (p === 'list' ? 'bedrijven' : p === 'stats' ? 'statistieken' : 'overzicht');

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
    document.body.dataset.page = p;
    $$('.pillnav a, .m-tabs a').forEach((a) => {
      if (a.dataset.page === p) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('m-title').textContent = TITLES[p];
    document.querySelector('meta[name="theme-color"]').content = mode === 'm' && p !== 'home' ? '#F6F7F9' : '#E8EDFA';
    placeIndicators();
    const ids = mode === 'm' ? ['home', 'list', 'stats', 'plan'] : ['home', 'list', 'plan'];
    ids.forEach((k) => { $(pageId(k)).hidden = k !== p; });
    const el = $(pageId(p));
    if (animate && !reduceMotion()) {
      el.classList.remove('in-r', 'in-l', 'enter');
      void el.offsetWidth;
      if (prev !== p) el.classList.add(ORDER[p] > ORDER[prev] ? 'in-r' : 'in-l');
      el.classList.add('enter');
      setTimeout(() => el.classList.remove('in-r', 'in-l', 'enter'), 1400);
    }
    if (prev !== p || force) window.scrollTo(0, 0);
  }

  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h.indexOf('bedrijf/') === 0) return { tk: h.slice(8) };
    if (h === 'accountwaarde') return { tk: '@account' };
    return { page: h === 'bedrijven' ? 'list' : h === 'statistieken' ? 'stats' : h === 'plannen' ? 'plan' : 'home' };
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
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placeIndicators(); setMtop(); });

  // ---------- Tekenen ----------
  function renderAll() {
    if (mode === 'm') { renderMHome(); renderMList(); renderMStats(); }
    else { renderHome(); renderList(); }
    renderPlan();
  }

  function render() {
    $('welcome').hidden = true;
    $('app').hidden = false;
    $('m-main').hidden = false;
    $('demo-banner').hidden = !demo;
    M = derive();
    const upd = M.lastT ? 'Bijgewerkt ' + fDT.format(data.generated ? new Date(data.generated) : new Date()) : '';
    $$('.updated').forEach((e) => { e.textContent = mode === 'm' ? upd.replace('Bijgewerkt ', '') : upd; });
    renderAll();
    if (ui.detail) {
      if (hasView(ui.detail)) renderDetail(false);
      else closeDetail();
    }
    if (firstRender) { firstRender = false; route(true); }
  }

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
      received: [
        ['KO', -320, 0.41], ['KO', -229, 0.43], ['KO', -138, 0.43], ['KO', -47, 0.86], ['MSFT', -250, 0.12], ['MSFT', -160, 0.13], ['MSFT', -68, 0.13],
        ['AAPL', -190, 0.05], ['AAPL', -99, 0.05], ['AAPL', -8, 0.05], ['TSM', -120, 0.16], ['TSM', -30, 0.17],
      ].map(([ticker, n, amount]) => ({ ticker, date: dIn(n), amount, perShare: null, qty: null })),
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
    const market = { symbols, peers: peersMk, profiles, prices, sectors: sectorsMk, industries: industriesMk, updated: mDays[mDays.length - 1] };

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

    return {
      ok: true, generated: iso(now), currency: 'EUR', weeks, positionsDate: iso(now), positions, today, events, market,
      orders: { columns: ['time', 'ticker', 'name', 'side', 'qty', 'price', 'currency', 'fxRate', 'net', 'realised', 'feeFx', 'feeOther', 'kind'], rows: orders },
      posExtra, etf, peil: [], settings: {},
      intraday: { columns: ['time', 'ticker', 'value'], rows: intraday },
      hours: { columns: ['hour', 'ticker', 'open', 'close', 'low', 'high', 'avg'], rows: hours },
      days: { columns: ['date', 'ticker', 'open', 'close', 'low', 'high', 'avg', 'range', 'rangePct'], rows: days },
    };
  }


  planEvents($('plan-body'));
  planEvents($('m-plan-body'));

  // ---------- Installeren als app ----------
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('btn-install').hidden = false; });
  window.addEventListener('appinstalled', () => { installEvt = null; $('btn-install').hidden = true; $('install-text').textContent = 'De tracker staat als app op dit apparaat.'; });
  $('btn-install').addEventListener('click', async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice.catch(() => null);
    installEvt = null; $('btn-install').hidden = true;
  });
  (function installHint() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) $('install-text').textContent = 'Je gebruikt de tracker nu als app.';
    else if (ios) $('install-text').textContent = 'Op iPhone of iPad: tik in Safari op de deelknop en kies “Zet op beginscherm”. De app toont zonder verbinding de laatst geladen stand.';
  })();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  // ---------- Start ----------
  if (new URLSearchParams(location.search).has('demo')) demo = true;
  applyMode();
  placeIndicators();
  load();
})();
