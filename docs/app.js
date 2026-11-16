/* Investeringstracker – dashboard
 * Haalt JSON op van de Apps Script web-app (zie apps-script/Code.gs, functie doGet)
 * en tekent het overzicht. De toegangscode staat alleen in localStorage van deze browser.
 */
(function () {
  'use strict';

  const CFG = window.TRACKER_CONFIG || {};
  const LS_TOKEN = 'tracker.token';
  const LS_URL = 'tracker.url';
  const $ = (id) => document.getElementById(id);

  const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
  const eur0 = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const pct = new Intl.NumberFormat('nl-NL', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dtFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const signed = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '') + f.format(Math.abs(v));
  const cls = (v) => (v > 0 ? 'gain' : v < 0 ? 'loss' : '');
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  let data = null;
  let demo = false;
  let refreshTimer = null;
  const charts = {};
  let detailTicker = null;
  let detailRange = 'intraday';

  // ---------- Kleuren uit CSS ----------
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function theme() {
    return {
      ink: css('--ink'), ink2: css('--ink-2'), rule: css('--rule'), track: css('--track'),
      accent: css('--accent'), accentSoft: css('--accent-soft'), gain: css('--gain'), loss: css('--loss'),
      orange: '#eb6834', surface: css('--surface'),
    };
  }

  // ---------- Instellingen ----------
  const getToken = () => localStorage.getItem(LS_TOKEN) || '';
  const WEBAPP_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  const getUrl = () => {
    const saved = localStorage.getItem(LS_URL) || '';
    if (saved && !WEBAPP_RE.test(saved)) localStorage.removeItem(LS_URL);
    return (WEBAPP_RE.test(saved) ? saved : '') || CFG.apiUrl || '';
  };

  function openSettings() {
    $('in-token').value = getToken();
    $('in-url').value = localStorage.getItem(LS_URL) || '';
    $('dlg-settings').showModal();
  }

  $('form-settings').addEventListener('submit', (e) => {
    const action = e.submitter && e.submitter.value;
    if (action === 'save') {
      const t = $('in-token').value.trim();
      const u = $('in-url').value.trim();
      if (t) localStorage.setItem(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN);
      if (u && !WEBAPP_RE.test(u)) {
        e.preventDefault();
        alertUrl();
        return;
      }
      if (u) localStorage.setItem(LS_URL, u); else localStorage.removeItem(LS_URL);
      demo = false;
      load();
    } else if (action === 'forget') {
      localStorage.removeItem(LS_TOKEN);
      data = null;
      showWelcome();
    }
  });

  function alertUrl() {
    const el = $('url-hint');
    el.textContent = 'Dit is geen web-app-adres. Het moet beginnen met https://script.google.com/macros/s/ en eindigen op /exec. Laat het veld leeg om het standaardadres te gebruiken.';
    el.classList.add('loss');
    $('in-url').focus();
  }

  $('btn-settings').addEventListener('click', openSettings);
  $('btn-welcome-settings').addEventListener('click', openSettings);
  $('btn-refresh').addEventListener('click', () => load());
  $('btn-demo').addEventListener('click', () => { demo = true; load(); });
  $('btn-demo-exit').addEventListener('click', () => { demo = false; getToken() ? load() : showWelcome(); });

  // ---------- Laden ----------
  function showError(msg) {
    const el = $('error');
    el.textContent = msg;
    el.hidden = !msg;
  }

  function showWelcome() {
    $('app').hidden = true;
    $('demo-banner').hidden = true;
    $('welcome').hidden = false;
    $('updated').textContent = '';
  }

  async function load() {
    clearTimeout(refreshTimer);
    showError('');
    if (demo) {
      data = makeDemoData();
      render();
      return;
    }
    const token = getToken();
    const url = getUrl();
    if (!token) { showWelcome(); return; }
    if (!url) {
      showWelcome();
      showError('Er is nog geen adres van de web-app ingesteld. Vul het in bij Instellingen of zet het in config.js.');
      return;
    }
    $('updated').textContent = 'Laden…';
    try {
      const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token), { cache: 'no-store' });
      if (!res.ok) throw new Error('de web-app gaf status ' + res.status);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'onbekende fout');
      data = json;
      render();
      const mins = Number(CFG.refreshMinutes) || 5;
      refreshTimer = setTimeout(load, mins * 60000);
    } catch (err) {
      $('updated').textContent = '';
      showError('De gegevens konden niet worden geladen: ' + err.message + '. Controleer de toegangscode en het adres bij Instellingen.');
      if (!data) showWelcome();
    }
  }

  // ---------- Tekenen ----------
  function render() {
    $('welcome').hidden = true;
    $('app').hidden = false;
    $('demo-banner').hidden = !demo;
    const gen = data.generated ? new Date(data.generated) : new Date();
    $('updated').textContent = 'Bijgewerkt ' + dtFmt.format(gen);
    renderHero();
    renderLadder();
    renderWeeks();
    renderAlloc();
    renderWeekResult();
    if (detailTicker && $('dlg-detail').open) renderDetail();
  }

  function totalRow() {
    return (data.today || []).find((r) => r.ticker === 'TOTAAL');
  }

  function renderHero() {
    const tot = totalRow();
    const lastWeek = (data.weeks || []).filter((w) => isNum(w.accountValue)).slice(-1)[0];
    const posSum = (data.positions || []).reduce((s, p) => s + (p.value || 0), 0);
    const value = tot && isNum(tot.current) ? tot.current : posSum;
    $('hero-value').textContent = eur.format(value);

    const ch = $('hero-change');
    if (tot && isNum(tot.change)) {
      ch.textContent = signed(tot.change, eur) + ' (' + signed(tot.changePct || 0, pct) + ') sinds de opening vandaag';
      ch.className = 'hero-change ' + cls(tot.change);
    } else {
      ch.textContent = 'Nog geen metingen van vandaag';
      ch.className = 'hero-change muted';
    }

    const set = (id, txt, c) => { const el = $(id); el.textContent = txt; el.className = c || ''; };
    if (lastWeek) {
      set('f-account', eur.format(lastWeek.accountValue));
      set('f-deposits', eur.format(lastWeek.netDeposits));
      set('f-result', signed(lastWeek.totalResult, eur) + ' (' + signed(lastWeek.totalResultPct || 0, pct) + ')', cls(lastWeek.totalResult));
    } else {
      ['f-account', 'f-deposits', 'f-result'].forEach((id) => set(id, '–'));
    }
    const unreal = (data.positions || []).reduce((s, p) => s + (p.unrealized || 0), 0);
    set('f-unreal', signed(unreal, eur), cls(unreal));

    const pts = (data.intraday && data.intraday.rows || [])
      .filter((r) => r[1] === 'TOTAAL' && isNum(r[2]))
      .map((r) => ({ x: new Date(r[0]), y: r[2] }));
    drawLine('chart-today', [{ label: 'Totaal', data: pts }], { time: true, compact: true });
  }

  function renderLadder() {
    const body = $('ladder-body');
    body.innerHTML = '';
    const rows = (data.today || []).slice();
    if (!rows.length) {
      body.innerHTML = '<div class="ladder-row"><span class="muted">Nog geen metingen. Zet in de sheet Live tracking aan of doe een testmeting.</span></div>';
      return;
    }
    rows.forEach((r) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ladder-row' + (r.ticker === 'TOTAAL' ? ' total' : '');
      btn.setAttribute('aria-label', (r.name || r.ticker) + ', huidige waarde ' + eur.format(r.current || 0) + ', details openen');

      let lo = Math.min(r.allTimeLow ?? r.low, r.low);
      let hi = Math.max(r.allTimeHigh ?? r.high, r.high);
      if (!(hi > lo)) { const pad = Math.max(Math.abs(hi) * 0.005, 0.01); lo -= pad; hi += pad; }
      const pos = (v) => ((v - lo) / (hi - lo) * 100).toFixed(2) + '%';
      const bandL = pos(r.low), bandW = ((r.high - r.low) / (hi - lo) * 100).toFixed(2) + '%';

      btn.innerHTML =
        '<span class="pos-name"><b></b><span></span></span>' +
        '<span class="strip-cell"><span class="strip">' +
          '<span class="hist"></span>' +
          '<span class="band" style="left:' + bandL + ';width:' + bandW + '"></span>' +
          (isNum(r.avg) ? '<span class="avg" style="left:' + pos(r.avg) + '"></span>' : '') +
          (isNum(r.current) ? '<span class="now" style="left:' + pos(r.current) + '"></span>' : '') +
        '</span><span class="strip-labels"><span></span><span></span></span></span>' +
        '<span class="num"></span>' +
        '<span class="delta"></span>';

      btn.querySelector('.pos-name b').textContent = r.ticker === 'TOTAAL' ? 'Totaal' : r.ticker;
      btn.querySelector('.pos-name span').textContent = r.ticker === 'TOTAAL' ? 'alle posities samen' : (r.name || '');
      const labels = btn.querySelectorAll('.strip-labels span');
      labels[0].textContent = 'Vandaag ' + eur.format(r.low) + ' – ' + eur.format(r.high);
      labels[1].textContent = isNum(r.allTimeLow) && isNum(r.allTimeHigh) && r.days > 0
        ? 'Historie ' + eur.format(r.allTimeLow) + ' – ' + eur.format(r.allTimeHigh)
        : 'Nog geen historie';
      btn.querySelector('.num').textContent = eur.format(r.current);
      const d = btn.querySelector('.delta');
      d.innerHTML = '<span></span><small></small>';
      d.firstChild.textContent = signed(r.change || 0, eur);
      d.lastChild.textContent = signed(r.changePct || 0, pct);
      d.className = 'delta ' + cls(r.change);

      btn.addEventListener('click', () => openDetail(r.ticker));
      body.appendChild(btn);
    });
  }

  function renderWeeks() {
    const w = (data.weeks || []).filter((x) => isNum(x.accountValue));
    const t = theme();
    drawLine('chart-weeks', [
      { label: 'Accountwaarde', data: w.map((x) => ({ x: new Date(x.date), y: x.accountValue })), color: t.accent },
      { label: 'Netto gestort', data: w.map((x) => ({ x: new Date(x.date), y: x.netDeposits })), color: t.orange, dashed: true },
    ], { time: true, legend: true });
  }

  function renderAlloc() {
    const pos = (data.positions || []).filter((p) => isNum(p.value) && p.value > 0).sort((a, b) => b.value - a.value);
    const total = pos.reduce((s, p) => s + p.value, 0) || 1;
    const t = theme();
    destroy('chart-alloc');
    charts['chart-alloc'] = new Chart($('chart-alloc'), {
      type: 'bar',
      data: {
        labels: pos.map((p) => p.ticker + '  ' + pct.format(p.value / total).replace(',00', '')),
        datasets: [{ data: pos.map((p) => p.value), backgroundColor: t.accent, borderRadius: 4, borderSkipped: false, barPercentage: 0.75 }],
      },
      options: baseOptions({
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + eur.format(c.parsed.x) + ', ' + pos[c.dataIndex].name } } },
        scales: {
          x: { grid: { color: t.track }, ticks: { color: t.ink2, callback: (v) => eur0.format(v) }, border: { display: false } },
          y: { grid: { display: false }, ticks: { color: t.ink, font: { weight: 500 } }, border: { display: false } },
        },
      }),
    });
  }

  function renderWeekResult() {
    const w = (data.weeks || []).filter((x) => isNum(x.weekResult));
    const t = theme();
    destroy('chart-weekres');
    charts['chart-weekres'] = new Chart($('chart-weekres'), {
      type: 'bar',
      data: {
        labels: w.map((x) => new Date(x.date)),
        datasets: [{
          label: 'Beleggingsresultaat',
          data: w.map((x) => x.weekResult),
          backgroundColor: w.map((x) => (x.weekResult >= 0 ? t.gain : t.loss)),
          borderRadius: 4, borderSkipped: false, barPercentage: 0.7,
        }],
      },
      options: baseOptions({
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: (c) => 'Week tot ' + new Date(w[c[0].dataIndex].date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' }),
          label: (c) => ' ' + signed(c.parsed.y, eur) + ' (' + signed(w[c.dataIndex].weekResultPct || 0, pct) + ')',
        } } },
        scales: {
          x: { type: 'time', time: { unit: 'week' }, grid: { display: false }, ticks: { color: t.ink2, callback: (v) => nlTick(v, false) }, border: { color: t.rule } },
          y: { grid: { color: t.track }, ticks: { color: t.ink2, callback: (v) => eur0.format(v) }, border: { display: false } },
        },
      }),
    });
  }

  // ---------- Detail per positie ----------
  function openDetail(ticker) {
    detailTicker = ticker;
    detailRange = 'intraday';
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.range === detailRange)));
    $('dlg-detail').showModal();
    renderDetail();
  }

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    detailRange = b.dataset.range;
    document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderDetail();
  }));
  $('btn-detail-close').addEventListener('click', () => $('dlg-detail').close());

  function renderDetail() {
    const r = (data.today || []).find((x) => x.ticker === detailTicker) || { ticker: detailTicker };
    $('detail-title').textContent = detailTicker === 'TOTAAL' ? 'Totaal beleggingen' : (r.name ? r.name + ' (' + detailTicker + ')' : detailTicker);
    const t = theme();
    let sets = [];
    if (detailRange === 'intraday') {
      const pts = (data.intraday.rows || []).filter((x) => x[1] === detailTicker).map((x) => ({ x: new Date(x[0]), y: x[2] }));
      sets = [{ label: 'Waarde', data: pts, color: t.accent }];
    } else {
      const src = detailRange === 'hours' ? data.hours : data.days;
      const rows = (src.rows || []).filter((x) => x[1] === detailTicker);
      const at = (x) => new Date(x[0]);
      sets = [
        { label: 'Hoogste', data: rows.map((x) => ({ x: at(x), y: x[5] })), color: t.accentSoft, fillTo: '+1', thin: true },
        { label: 'Laagste', data: rows.map((x) => ({ x: at(x), y: x[4] })), color: t.accentSoft, thin: true },
        { label: 'Gemiddelde', data: rows.map((x) => ({ x: at(x), y: x[6] })), color: t.accent },
      ];
    }
    const empty = !sets.some((s) => s.data.length);
    drawLine('chart-detail', sets, { time: true, legend: detailRange !== 'intraday', compact: detailRange === 'intraday', empty: empty });

    const stats = [
      ['Nu', r.current, eur], ['Laagste vandaag', r.low, eur], ['Hoogste vandaag', r.high, eur],
      ['Gemiddelde vandaag', r.avg, eur], ['Hoogste ooit', r.allTimeHigh, eur], ['Laagste ooit', r.allTimeLow, eur],
      ['Gem. dagrange', r.avgRange, eur], ['Gem. dagrange %', r.avgRangePct, pct], ['Dagen in historie', r.days, { format: (v) => String(v) }],
    ];
    const dl = $('detail-stats');
    dl.innerHTML = '';
    stats.forEach(([k, v, f]) => {
      const div = document.createElement('div');
      div.innerHTML = '<dt></dt><dd></dd>';
      div.firstChild.textContent = k;
      div.lastChild.textContent = isNum(v) ? f.format(v) : '–';
      dl.appendChild(div);
    });
  }

  // ---------- Chart-hulp ----------
  function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

  function baseOptions(extra) {
    const t = theme();
    const o = {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { labels: { color: t.ink, usePointStyle: true, pointStyle: 'line', boxWidth: 24 } },
        tooltip: { backgroundColor: t.ink, titleColor: t.surface, bodyColor: t.surface, padding: 10, displayColors: false },
      },
    };
    return deepMerge(o, extra || {});
  }

  function drawLine(id, sets, opt) {
    const t = theme();
    destroy(id);
    const many = sets.some((s) => s.data.length > 60);
    charts[id] = new Chart($(id), {
      type: 'line',
      data: {
        datasets: sets.map((s) => ({
          label: s.label, data: s.data,
          borderColor: s.color || t.accent, backgroundColor: s.fillTo ? (s.color || t.accentSoft) : 'transparent',
          borderWidth: s.thin ? 1 : 2, borderDash: s.dashed ? [6, 4] : [],
          pointRadius: many || s.thin ? 0 : 3, pointHoverRadius: 5, tension: 0.15,
          fill: s.fillTo || false, spanGaps: false,
        })),
      },
      options: baseOptions({
        plugins: {
          legend: { display: !!opt.legend },
          tooltip: { callbacks: {
            title: (c) => c.length ? dtFmt.format(new Date(c[0].parsed.x)) : '',
            label: (c) => ' ' + c.dataset.label + ': ' + eur.format(c.parsed.y),
          } },
        },
        scales: {
          x: opt.time ? {
            type: 'time', time: { tooltipFormat: 'd MMM HH:mm', displayFormats: { hour: 'HH:mm', day: 'd MMM', week: 'd MMM', month: 'MMM yyyy' } },
            grid: { display: false }, border: { color: t.rule },
            ticks: { color: t.ink2, maxTicksLimit: opt.compact ? 5 : 8, callback: (v) => nlTick(v, opt.compact) },
          } : {},
          y: { grid: { color: t.track }, ticks: { color: t.ink2, maxTicksLimit: 5, callback: (v) => eur0.format(v) }, border: { display: false } },
        },
      }),
    });
  }

  function nlTick(v, intraday) {
    const d = new Date(v);
    if (intraday) return d.toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  }

  function deepMerge(a, b) {
    Object.keys(b).forEach((k) => {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && !(b[k] instanceof Date)) {
        a[k] = deepMerge(a[k] && typeof a[k] === 'object' ? a[k] : {}, b[k]);
      } else a[k] = b[k];
    });
    return a;
  }

  // ---------- Voorbeeldgegevens ----------
  function makeDemoData() {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const book = [
      ['VUAG', 'Vanguard S&P 500 (Acc)', 255], ['KO', 'Coca-Cola', 214], ['SXRV', 'iShares NASDAQ 100 (Acc)', 148],
      ['PLTR', 'Palantir', 133], ['TTWO', 'Take-Two Interactive', 121], ['GOOGL', 'Alphabet (Class A)', 110],
      ['LLY', 'Eli Lilly', 95], ['TSM', 'Taiwan Semiconductor', 82], ['AAPL', 'Apple', 68], ['ASML', 'ASML', 65],
      ['MSFT', 'Microsoft', 50], ['AMZN', 'Amazon', 34], ['SPCX', 'SpaceX', 26], ['META', 'Meta Platforms', 22],
    ];
    const now = new Date();
    now.setMinutes(Math.floor(now.getMinutes() / 10) * 10, 0, 0);
    const intraday = [], hours = [], days = [], today = [];
    const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    const walk = (base, n, vol) => { const out = []; let v = base; for (let i = 0; i < n; i++) { v *= 1 + (rnd() - 0.5) * vol; out.push(+v.toFixed(2)); } return out; };

    const totals = {};
    book.forEach(([tk, name, base]) => {
      const series = walk(base * 0.98, 3 * 88, 0.004);
      const daily = walk(base * 0.9, 60, 0.02);
      series.forEach((v, i) => {
        const day = Math.floor(i / 88), slot = i % 88;
        const d = new Date(now); d.setDate(d.getDate() - (2 - day)); d.setHours(8, slot * 10, 0, 0);
        if (d > now) return;
        intraday.push([iso(d), tk, v]);
        totals[iso(d)] = (totals[iso(d)] || 0) + v;
      });
      for (let h = 0; h < 30 * 15; h++) {
        const d = new Date(now); d.setDate(d.getDate() - 30 + Math.floor(h / 15)); d.setHours(8 + (h % 15), 0, 0, 0);
        const avg = base * (0.92 + 0.08 * h / 450) * (1 + (rnd() - 0.5) * 0.02);
        hours.push([iso(d), tk, avg, avg, avg * 0.995, avg * 1.005, avg]);
      }
      daily.forEach((avg, i) => {
        const d = new Date(now); d.setDate(d.getDate() - 60 + i); d.setHours(0, 0, 0, 0);
        const rg = avg * (0.01 + rnd() * 0.02);
        days.push([iso(d), tk, avg, avg, avg - rg / 2, avg + rg / 2, avg, rg, rg / avg]);
      });
      const todayVals = series.slice(2 * 88).filter((_, i) => i <= (now.getHours() - 8) * 6 + now.getMinutes() / 10);
      const tv = todayVals.length ? todayVals : [series[series.length - 1]];
      const lo = Math.min(...tv), hi = Math.max(...tv), avg = tv.reduce((s, x) => s + x, 0) / tv.length;
      today.push({ ticker: tk, name: name, current: tv[tv.length - 1], low: lo, high: hi, avg: avg, open: tv[0],
        change: tv[tv.length - 1] - tv[0], changePct: (tv[tv.length - 1] - tv[0]) / tv[0],
        allTimeHigh: hi * 1.08, allTimeLow: lo * 0.86, avgRange: base * 0.018, avgRangePct: 0.018, days: 60 });
    });
    Object.keys(totals).sort().forEach((k) => intraday.push([k, 'TOTAAL', +totals[k].toFixed(2)]));
    const tsum = (f) => today.reduce((s, r) => s + r[f], 0);
    const tot = { ticker: 'TOTAAL', name: 'Totaal beleggingen', current: tsum('current'), low: tsum('low'), high: tsum('high'),
      avg: tsum('avg'), open: tsum('open'), allTimeHigh: tsum('high') * 1.06, allTimeLow: tsum('low') * 0.9, avgRange: 26, avgRangePct: 0.017, days: 60 };
    tot.change = tot.current - tot.open; tot.changePct = tot.change / tot.open;
    today.sort((a, b) => a.ticker.localeCompare(b.ticker)).unshift(tot);

    const weeks = [];
    let acc = 1000, dep = 1000;
    for (let i = 0; i < 12; i++) {
      const d = new Date(now); d.setDate(d.getDate() - (11 - i) * 7); d.setHours(0, 0, 0, 0);
      const add = i === 1 ? 400 : i === 5 ? 100 : i === 10 ? 150 : 0;
      const res = (rnd() - 0.45) * 40;
      const prev = acc;
      acc += add + res; dep += add;
      weeks.push({ date: iso(d), accountValue: +acc.toFixed(2), netDeposits: dep, totalResult: +(acc - dep).toFixed(2),
        totalResultPct: (acc - dep) / dep, weekChange: i ? acc - prev : null, newDeposits: i ? add : null,
        weekResult: i ? +res.toFixed(2) : null, weekResultPct: i ? res / prev : null, source: 'Voorbeeld' });
    }
    return {
      ok: true, generated: iso(new Date()), currency: 'EUR', weeks: weeks,
      positions: today.filter((r) => r.ticker !== 'TOTAAL').map((r) => ({ ticker: r.ticker, name: r.name, value: r.current, unrealized: r.current * (rnd() - 0.45) * 0.2 })),
      today: today,
      intraday: { columns: ['time', 'ticker', 'value'], rows: intraday },
      hours: { columns: ['hour', 'ticker', 'open', 'close', 'low', 'high', 'avg'], rows: hours },
      days: { columns: ['date', 'ticker', 'open', 'close', 'low', 'high', 'avg', 'range', 'rangePct'], rows: days },
    };
  }

  // Herteken bij wisselen licht/donker
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (data) render(); });

  // Start
  if (new URLSearchParams(location.search).has('demo')) demo = true;
  load();
})();
