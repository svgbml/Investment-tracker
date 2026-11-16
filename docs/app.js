/* Investeringstracker – dashboard (ontwerp F4)
 *
 * Haalt JSON op van de Cloudflare Worker (/api/data) of de Apps Script web-app (/exec)
 * en tekent drie weergaven: Overzicht, Bedrijven en een bedrijfspagina waarop vanuit
 * de aangeklikte tegel wordt ingezoomd. De toegangscode staat alleen in localStorage.
 */
(function () {
  'use strict';

  // ---------- Basis ----------
  const CFG = window.TRACKER_CONFIG || {};
  const LS_TOKEN = 'tracker.token';
  const LS_URL = 'tracker.url';
  const $ = (id) => document.getElementById(id);
  const TOTAL = 'TOTAAL';
  const MAX_DAY_MOVE = 0.25;   // grotere dagbeweging = vrijwel zeker een aankoop of verkoop
  const MAX_STEP_MOVE = 0.15;  // idem voor één stap in een vergelijkingsgrafiek
  const ZOOM_MS = 450;

  const nf = (o) => new Intl.NumberFormat('nl-NL', o);
  const EUR = nf({ style: 'currency', currency: 'EUR' });
  const P2 = nf({ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const P1 = nf({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const N2 = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const N4 = nf({ maximumFractionDigits: 4 });
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
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C = { accent: '#2B5BD7', gain: '#0B7A4B', loss: '#B4311F', ink2: '#5B6472', soft: '#8FAEF0', ink: '#14181F' };
  const toneColor = (v) => (isNum(v) && v < 0 ? C.loss : C.gain);

  let data = null;
  let M = null;
  let demo = false;
  let refreshTimer = null;
  let pushedDetail = false;
  const ui = {
    page: 'home', heroRange: '3d',
    listSort: 'move', listFilter: 'all', listSpan: 'today', listQuery: '',
    detail: null, detailRange: '3d', compare: false, origin: null,
  };

  const RANGES = [['today', 'Vandaag'], ['3d', '3 dagen'], ['1m', '30 dagen'], ['all', 'Alles']];

  // ---------- Instellingen ----------
  const getToken = () => localStorage.getItem(LS_TOKEN) || '';
  const WEBAPP_RE = /^(https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec|https:\/\/[A-Za-z0-9.-]+\/api\/data)$/;
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
      data = null;
      showWelcome();
    }
  });

  $('btn-settings').addEventListener('click', openSettings);
  $('btn-welcome-settings').addEventListener('click', openSettings);
  $('btn-refresh').addEventListener('click', () => load());
  $('btn-demo').addEventListener('click', () => { demo = true; load(); });
  $('btn-demo-exit').addEventListener('click', () => { demo = false; if (getToken()) load(); else showWelcome(); });

  // ---------- Laden ----------
  function showError(msg) { const el = $('error'); el.textContent = msg; el.hidden = !msg; }

  function showWelcome() {
    $('app').hidden = true;
    $('demo-banner').hidden = true;
    $('welcome').hidden = false;
    $('updated').textContent = '';
  }

  async function load() {
    clearTimeout(refreshTimer);
    showError('');
    if (demo) { data = makeDemoData(); render(); return; }
    const token = getToken();
    const url = getUrl();
    if (!token) { showWelcome(); return; }
    if (!url) { showWelcome(); showError('Er is nog geen adres van de web-app ingesteld. Vul het in bij Instellingen of zet het in config.js.'); return; }
    $('btn-refresh').classList.add('busy');
    try {
      const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token), { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) throw new Error((json && json.error) || 'de web-app gaf status ' + res.status);
      if (!json.ok) throw new Error(json.error || 'onbekende fout');
      data = json;
      render();
      refreshTimer = setTimeout(load, (Number(CFG.refreshMinutes) || 5) * 60000);
    } catch (err) {
      showError('De gegevens konden niet worden geladen: ' + err.message + '. Controleer de toegangscode en het adres bij Instellingen.');
      if (!data) showWelcome();
    } finally {
      $('btn-refresh').classList.remove('busy');
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
    m.days = group(data.days && data.days.rows, (r) => { const o = ohlc(r); if (o) { o.range = r[7]; o.rangePct = r[8]; } return o; });

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

    const todayMap = new Map((data.today || []).map((r) => [r.ticker, r]));
    m.total = todayMap.get(TOTAL) || null;
    const posMap = new Map((data.positions || []).map((p) => [p.ticker, p]));
    const tks = new Set([...todayMap.keys(), ...posMap.keys()]);
    tks.delete(TOTAL);

    m.companies = [...tks].map((tk) => {
      const t = todayMap.get(tk) || {};
      const p = posMap.get(tk) || {};
      const value = isNum(t.current) ? t.current : isNum(p.value) ? p.value : null;
      const cost = isNum(p.cost) ? p.cost : (isNum(p.value) && isNum(p.unrealized) ? p.value - p.unrealized : null);
      const unreal = isNum(cost) && isNum(value) ? value - cost : isNum(p.unrealized) ? p.unrealized : null;
      return {
        tk, name: t.name || p.name || tk, value,
        change: t.change, changePct: t.changePct, open: t.open, low: t.low, high: t.high, avg: t.avg,
        ath: t.allTimeHigh, atl: t.allTimeLow, avgRange: t.avgRange, avgRangePct: t.avgRangePct, histDays: t.days,
        cost, unreal, qty: isNum(p.quantity) && p.quantity > 0 ? p.quantity : null,
        resultPct: isNum(cost) && cost > 0 && isNum(unreal) ? unreal / cost : isNum(p.resultPct) ? p.resultPct : null,
      };
    }).filter((c) => isNum(c.value));

    m.totalValue = m.total && isNum(m.total.current) ? m.total.current : sum(m.companies.map((c) => c.value));
    m.companies.forEach((c) => { c.weight = m.totalValue ? c.value / m.totalValue : null; });
    m.byTk = new Map(m.companies.map((c) => [c.tk, c]));
    m.weeks = (data.weeks || []).filter((w) => isNum(w.accountValue)).map((w) => Object.assign({}, w, { t: parse(w.date) }));

    const ti = m.intra.get(TOTAL) || [];
    m.lastT = ti.length ? ti[ti.length - 1].t : null;
    m.isToday = m.lastT != null && dayKey(m.lastT) === dayKey(Date.now());
    m.dayWord = m.lastT == null ? 'vandaag' : m.isToday ? 'vandaag' : 'op ' + fD.format(m.lastT);
    return m;
  }

  const todayOf = (tk) => (tk === TOTAL ? M.total : M.byTk.get(tk));

  // Punten voor een grafiek over een periode
  function seriesFor(tk, range) {
    const intra = M.intra.get(tk) || [];
    if (range === 'today' || range === '3d') {
      if (range === 'today' && intra.length) { const k = dayKey(intra[intra.length - 1].t); return intra.filter((p) => dayKey(p.t) === k); }
      return intra;
    }
    const base = ((range === '1m' ? M.hours : M.days).get(tk) || []).map((p) => ({ t: p.t, v: p.close }));
    const lp = intra[intra.length - 1];
    if (lp && (!base.length || lp.t > base[base.length - 1].t)) {
      if (range === 'all' && base.length && dayKey(base[base.length - 1].t) === dayKey(lp.t)) base.pop();
      base.push({ t: lp.t, v: lp.v });
    }
    return base;
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
    const out = (M.days.get(tk) || [])
      .filter((d) => isNum(d.open) && d.open > 0 && isNum(d.close))
      .map((d) => ({ t: d.t, pct: (d.close - d.open) / d.open, open: d.open, close: d.close }));
    const td = todayOf(tk);
    if (td && isNum(td.changePct) && M.lastT != null) {
      const k = dayKey(M.lastT);
      if (!out.length || dayKey(out[out.length - 1].t) !== k) out.push({ t: dayStart(M.lastT), pct: td.changePct, today: true });
    }
    return out.filter((d) => Math.abs(d.pct) <= MAX_DAY_MOVE);
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
    const best = r.reduce((b, d) => (!b || d.pct > b.pct ? d : b), null);
    const worst = r.reduce((b, d) => (!b || d.pct < b.pct ? d : b), null);
    let corr = null, beta = null;
    if (tk !== TOTAL) {
      const tm = new Map(dailyReturns(TOTAL).map((d) => [dayKey(d.t), d.pct]));
      const pairs = r.map((d) => [d.pct, tm.get(dayKey(d.t))]).filter((p) => isNum(p[1]));
      if (pairs.length >= 5) {
        const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
        let sxy = 0, sxx = 0, syy = 0;
        pairs.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
        if (sxx > 0 && syy > 0) { corr = sxy / Math.sqrt(sxx * syy); beta = sxy / syy; }
      }
    }
    return {
      returns: r, n: r.length, up: ps.filter((p) => p > 0).length, down: ps.filter((p) => p < 0).length,
      streak, dir, best, worst, mean: mean(ps), sd: stdev(ps), corr, beta,
    };
  }

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

  function corrText(c) {
    if (!isNum(c)) return '–';
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

  const xFmt = (range) => (t) => (range === 'today' ? fHM : range === '3d' ? fWH : fDM).format(t);
  const tFmt = (range) => (t) => (range === 'all' ? fD : fDT).format(t);

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

  function patternTiles(tk, s) {
    const hp = hourPattern(tk);
    const wp = weekdayPattern(s.returns);
    const edges = [-Infinity, -0.03, -0.02, -0.01, -0.005, 0, 0.005, 0.01, 0.02, 0.03, Infinity];
    const names = ['< −3%', '−3 tot −2%', '−2 tot −1%', '−1 tot −0,5%', '−0,5 tot 0%', '0 tot 0,5%', '0,5 tot 1%', '1 tot 2%', '2 tot 3%', '> 3%'];
    const hist = names.map((nm, i) => {
      const c = s.returns.filter((d) => d.pct >= edges[i] && d.pct < edges[i + 1]).length;
      return { v: c, color: i < 5 ? C.loss : C.gain, tip: nm + ': ' + c + (c === 1 ? ' dag' : ' dagen') };
    });
    const hasHours = hp.some((h) => h.n);
    return [
      '<section class="tile pad"><h3>Resultaat per dag</h3>' + (s.n ? calendar(s.returns) : '<p class="muted">Nog geen dagen gemeten.</p>') + '</section>',
      '<section class="tile pad"><h3>Wanneer beweegt het?</h3>' +
        (hasHours ? bars(hp.map((h) => ({ v: h.v, tip: h.hr + ':00–' + (h.hr + 1) + ':00: ' + (h.n ? spct(h.v) + ' gemiddeld (' + h.n + ' uur)' : 'geen metingen') }))) +
          barLabels(hp.map((h) => (h.hr % 2 === 0 ? String(h.hr) : ''))) + '<p class="sub" style="margin-top:8px">Gemiddelde verandering per uur, laatste 30 dagen.</p>'
          : '<p class="muted">Nog geen uurgegevens.</p>') + '</section>',
      '<section class="tile pad"><h3>Per weekdag</h3>' +
        (s.n ? bars(wp.map((d) => ({ v: d.v, tip: d.nm + ': ' + (d.n ? spct(d.v) + ' gemiddeld over ' + d.n + (d.n === 1 ? ' dag' : ' dagen') : 'nog geen metingen') }))) +
          barLabels(wp.map((d) => d.short)) + '<p class="sub" style="margin-top:8px">Gemiddeld resultaat van opening tot slot.</p>' : '<p class="muted">Nog geen dagen gemeten.</p>') + '</section>',
      '<section class="tile pad"><h3>Hoe groot zijn de dagbewegingen?</h3>' +
        (s.n ? bars(hist, true) + barLabels(['−3%', '', '', '', '', '0', '', '', '', '+3%']) + '<p class="sub" style="margin-top:8px">Aantal dagen per grootte van de beweging.</p>' : '<p class="muted">Nog geen dagen gemeten.</p>') + '</section>',
    ];
  }

  const stag = (html, i) => html.replace(/^<(\w+)/, '<$1 style="--i:' + i + '"');
  const fill = (id, tiles) => { $(id).innerHTML = tiles.map(stag).join(''); };

  function kvList(rows) {
    return '<dl class="kv">' + rows.map(([k, v, c]) => '<div><dt>' + esc(k) + '</dt><dd' + (c ? ' class="' + c + '"' : '') + '>' + esc(v) + '</dd></div>').join('') + '</dl>';
  }

  function rangeStrip(c) {
    let lo = Math.min(isNum(c.atl) ? c.atl : c.low, c.low);
    let hi = Math.max(isNum(c.ath) ? c.ath : c.high, c.high);
    if (!isNum(lo) || !isNum(hi)) return '<p class="muted">Nog geen metingen van vandaag.</p>';
    if (!(hi > lo)) { const pad = Math.max(Math.abs(hi) * 0.005, 0.01); lo -= pad; hi += pad; }
    const p = (v) => (((v - lo) / (hi - lo)) * 100).toFixed(2) + '%';
    return '<div class="range" role="img" aria-label="' + esc('Vandaag tussen ' + eur(c.low) + ' en ' + eur(c.high) + ', nu ' + eur(c.value ?? c.current) + '. Laagste ooit ' + eur(lo) + ', hoogste ooit ' + eur(hi)) + '">' +
      '<div class="rail"></div><div class="today" style="left:' + p(c.low) + ';width:calc(' + p(c.high) + ' - ' + p(c.low) + ')"></div>' +
      (isNum(c.avg) ? '<div class="avg" style="left:' + p(c.avg) + '"></div>' : '') +
      '<div class="now" style="left:' + p(c.value ?? c.current) + '"></div></div>' +
      '<div class="range-labels"><span>Laagste ooit ' + esc(eur(lo)) + '</span><span>Hoogste ooit ' + esc(eur(hi)) + '</span></div>';
  }

  // ---------- Overzicht ----------
  function render() {
    $('welcome').hidden = true;
    $('app').hidden = false;
    $('demo-banner').hidden = !demo;
    M = derive();
    $('updated').textContent = 'Bijgewerkt ' + fDT.format(data.generated ? new Date(data.generated) : new Date());
    renderHome();
    renderList();
    if (ui.detail) {
      if (M.byTk.has(ui.detail)) renderDetail(false);
      else closeDetail();
    }
    if (firstRender) { firstRender = false; route(true); }
  }
  let firstRender = true;

  function renderHeroChart(animate) {
    const r = ui.heroRange;
    segButtons($('hero-ranges'), RANGES, r, (k) => { ui.heroRange = k; renderHeroChart(true); });
    const pts = seriesFor(TOTAL, r);
    const markers = [];
    if (pts.length > 2) {
      let mi = 0;
      pts.forEach((p, i) => { if (p.v > pts[mi].v) mi = i; });
      markers.push({ i: mi, label: 'hoogste ' + eur(pts[mi].v) });
      if (r === 'all' || r === '1m') {
        M.weeks.filter((w) => isNum(w.newDeposits) && w.newDeposits > 0 && w.t >= pts[0].t && w.t <= pts[pts.length - 1].t + 864e5)
          .slice(-3).forEach((w) => { const i = nearestIdx(pts, w.t); if (i !== mi) markers.push({ i, label: 'storting ' + eur(w.newDeposits) }); });
      }
    }
    lineChart($('hero-chart'), [{ pts, color: C.accent, area: true, width: 3 }], {
      animate, markers, xl: $('hero-x'), xfmt: xFmt(r), tfmt: tFmt(r),
      empty: 'Nog geen metingen voor deze periode. De tracker meet op werkdagen tussen 08:00 en 22:30.',
    });
  }

  function segButtons(host, opts, current, onPick) {
    host.innerHTML = opts.map(([k, l]) => '<button type="button" data-k="' + k + '" aria-pressed="' + (k === current) + '">' + esc(l) + '</button>').join('');
    host.onclick = (e) => { const b = e.target.closest('button[data-k]'); if (b) onPick(b.dataset.k); };
  }

  function renderHome() {
    const tot = M.total;
    $('hero-label').textContent = 'Waarde beleggingen, ' + (M.lastT ? fDT.format(M.lastT) : 'laatste meting');
    $('hero-value').textContent = eur(M.totalValue);
    const ch = $('hero-change');
    if (tot && isNum(tot.change)) {
      ch.textContent = seur(tot.change) + ' (' + spct(tot.changePct) + ') ' + M.dayWord;
      ch.className = 'hero-change ' + tone(tot.change);
    } else {
      ch.textContent = 'Nog geen metingen van vandaag';
      ch.className = 'hero-change muted';
    }
    renderHeroChart(false);

    // Kerncijfers
    const W = M.weeks, last = W[W.length - 1];
    const wk = (f) => W.filter((w) => isNum(w[f])).map((w) => ({ t: w.t, v: w[f] }));
    const unreal = sum(M.companies.map((c) => (isNum(c.unreal) ? c.unreal : 0)));
    const none = 'De eerste weekmeting volgt zaterdag';
    fill('kpis', [
      tileStat('Accountwaarde', last ? eur(last.accountValue) : '–', last ? (isNum(last.cash) ? 'incl. ' + eur(last.cash) + ' vrij saldo, ' : '') + 'stand ' + fDM.format(last.t) : none, '', spark(wk('accountValue'), C.accent)),
      tileStat('Netto gestort', last ? eur(last.netDeposits) : '–', last ? (isNum(last.newDeposits) && last.newDeposits ? seur(last.newDeposits) + ' in de laatste week' : 'geen storting in de laatste week') : none, '', spark(wk('netDeposits'), C.ink2)),
      tileStat('Totaal resultaat', last ? seur(last.totalResult) : '–', last ? spct(last.totalResultPct) + ' op je inleg' : none, last ? tone(last.totalResult) : '', spark(wk('totalResult'), toneColor(last && last.totalResult))),
      tileStat('Ongerealiseerd', seur(unreal), 'open posities, nu', tone(unreal), spark(wk('unrealized'), toneColor(unreal))),
    ]);

    // Grootste veranderingen
    const withChange = M.companies.filter((c) => isNum(c.change));
    const up = withChange.filter((c) => c.change > 0).length, down = withChange.filter((c) => c.change < 0).length;
    $('breadth').innerHTML = withChange.length
      ? '<span class="meter split" aria-hidden="true"><div style="flex:' + up + ';background:' + C.gain + '"></div><div style="flex:' + down + ';background:' + C.loss + '"></div></span>' +
        esc(up + ' gestegen, ' + down + ' gedaald')
      : '';
    $('link-all').textContent = 'Alle ' + M.companies.length + ' bedrijven bekijken';
    $('movers-title').textContent = 'Grootste veranderingen ' + M.dayWord;
    const top = withChange.slice().sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5);
    fill('movers', top.length ? top.map((c) =>
      '<button type="button" class="tile" data-ticker="' + esc(c.tk) + '" aria-label="' + esc(c.name + ', ' + seur(c.change) + ' ' + M.dayWord + '. Inzoomen') + '">' +
        '<span class="row"><span class="tk">' + esc(c.tk) + '</span><span class="sub">' + esc(eur(c.value)) + '</span></span>' +
        '<span class="nm">' + esc(c.name) + '</span>' +
        '<span class="v big ' + tone(c.change) + '">' + esc(seur(c.change)) + '</span>' +
        '<span class="' + tone(c.change) + '" style="font-weight:600">' + esc(spct(c.changePct)) + '</span>' +
        spark(seriesFor(c.tk, 'today'), toneColor(c.change), 'spark tall') + '</button>')
      : ['<p class="empty">Nog geen metingen van vandaag.</p>']);

    renderWeeks();
    const S = statsFor(TOTAL);
    fill('patterns', patternTiles(TOTAL, S));
    renderStats(S);
  }

  function tileStat(k, v, sub, cls, extra) {
    const flush = !!extra && extra.indexOf('spark') !== -1;
    return '<section class="tile' + (flush ? '' : ' pad') + '"><span class="k">' + esc(k) + '</span>' +
      '<span class="v ' + (cls || '') + '">' + esc(v) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + (extra || '') + '</section>';
  }

  function renderWeeks() {
    const W = M.weeks;
    if (!W.length) {
      fill('weeks', ['<p class="empty">Nog geen weekmetingen. De eerste volgt zaterdag rond 09:00.</p>']);
      return;
    }
    const wr = W.filter((w) => isNum(w.weekResult));
    const best = wr.reduce((b, w) => (!b || w.weekResult > b.weekResult ? w : b), null);
    const worst = wr.reduce((b, w) => (!b || w.weekResult < b.weekResult ? w : b), null);
    const sorted = M.companies.slice().sort((a, b) => b.value - a.value);
    const shades = ['#1E3A8A', '#2B5BD7', '#5B86E5', '#8FAEF0', '#BFD0F7'];
    const topN = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    const restVal = sum(rest.map((c) => c.value));
    const pctOf = (v) => (M.totalValue ? P1.format(v / M.totalValue) : '–');

    fill('weeks', [
      '<section class="tile pad"><h3>Accountwaarde en inleg</h3><div class="chart" id="wk-chart" style="height:150px"></div>' +
        '<div class="xlabels" id="wk-x"></div><div class="legend" style="margin-top:8px"><span><i style="background:' + C.accent + '"></i>Accountwaarde</span><span><i class="dash"></i>Netto gestort</span></div></section>',
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
    ]);
    lineChart($('wk-chart'), [
      { pts: W.map((w) => ({ t: w.t, v: w.accountValue })), color: C.accent, area: true, label: 'Accountwaarde' },
      { pts: W.filter((w) => isNum(w.netDeposits)).map((w) => ({ t: w.t, v: w.netDeposits })), color: C.ink2, dash: true, width: 2, label: 'Netto gestort' },
    ], { top: 0.08, bottom: 0.08, xl: $('wk-x'), xcount: 2, xfmt: (t) => fDM.format(t), tfmt: (t) => 'Week tot ' + fDM.format(t), empty: 'Na de tweede weekmeting zie je hier het verloop.' });
  }

  function renderStats(S) {
    const W = M.weeks, last = W[W.length - 1];
    const wr = W.filter((w) => isNum(w.weekResultPct));
    let idx = 1;
    const chain = wr.map((w) => { idx *= 1 + w.weekResultPct; return { t: w.t, v: idx - 1 }; });
    const twr = wr.length ? idx - 1 : null;
    const posW = wr.filter((w) => w.weekResultPct > 0).length;
    const tot = M.total || {};
    const dd = isNum(tot.allTimeHigh) && tot.allTimeHigh > 0 ? (M.totalValue - tot.allTimeHigh) / tot.allTimeHigh : null;
    const sorted = M.companies.slice().sort((a, b) => b.value - a.value);
    const top3 = sorted.slice(0, 3);
    const top3w = sum(top3.map((c) => c.weight || 0));
    const split = (a, b) => '<div class="meter split" aria-hidden="true"><div style="flex:' + a + ';background:' + C.gain + '"></div><div style="flex:' + b + ';background:' + C.loss + '"></div></div>';

    fill('stats', [
      tileStat('Rendement zonder stortingen', twr == null ? '–' : spct1(twr), wr.length ? 'tijdgewogen, over ' + wr.length + (wr.length === 1 ? ' week' : ' weken') : 'na de tweede weekmeting', tone(twr), chain.length > 1 ? spark([{ t: 0, v: 0 }].concat(chain), toneColor(twr)) : ''),
      tileStat('Weken met winst', wr.length ? posW + ' van ' + wr.length : '–', wr.length ? P1.format(posW / wr.length) + ' van de weken' : 'nog geen weken', '', wr.length ? split(posW, wr.length - posW) : ''),
      tileStat('Dagen gestegen', S.n ? S.up + ' van ' + S.n : '–', streakText(S), '', S.n ? split(S.up, S.down) : ''),
      tileStat('Beste dag', S.best ? spct(S.best.pct) : '–', S.best ? fD.format(S.best.t) + (S.worst ? '. Slechtste: ' + spct(S.worst.pct) + ' op ' + fD.format(S.worst.t) : '') : 'nog geen dagen', tone(S.best && S.best.pct)),
      tileStat('Beweeglijkheid', isNum(S.sd) ? '± ' + P1.format(S.sd) + ' per dag' : '–', isNum(tot.avgRange) ? 'Gemiddeld dagbereik ' + eur(tot.avgRange) + ' (' + P1.format(tot.avgRangePct || 0) + ')' : 'standaardafwijking van de dagresultaten'),
      tileStat('Tot hoogste ooit', dd == null ? '–' : dd >= -0.0005 ? 'Op het hoogste punt' : spct1(dd), isNum(tot.allTimeHigh) ? 'Hoogste ooit ' + eur(tot.allTimeHigh) : '', dd != null && dd < -0.0005 ? 'loss' : ''),
      tileStat('Grootste 3 posities', top3.length ? P1.format(top3w) : '–', top3.map((c) => c.tk).join(', ') + ' samen', '', '<div class="meter" aria-hidden="true"><div style="width:' + (top3w * 100).toFixed(1) + '%"></div></div>'),
      tileStat('Vrij saldo', last && isNum(last.cash) ? eur(last.cash) : '–', last && isNum(last.cash) && last.accountValue ? P1.format(last.cash / last.accountValue) + ' van je accountwaarde' : 'uit de laatste weekmeting'),
    ]);
  }

  // ---------- Bedrijven ----------
  const SORTS = [['move', 'Verandering'], ['value', 'Waarde'], ['result', 'Sinds aankoop'], ['name', 'Naam']];
  const FILTERS = [['all', 'Alle'], ['up', 'Gestegen'], ['down', 'Gedaald']];
  const SPANS = [['today', 'Vandaag'], ['1m', '30 dagen'], ['all', 'Alles']];

  function sortedCompanies() {
    const a = M.companies.slice();
    const by = {
      move: (x, y) => Math.abs(y.change || 0) - Math.abs(x.change || 0),
      value: (x, y) => y.value - x.value,
      result: (x, y) => (y.resultPct ?? -9) - (x.resultPct ?? -9),
      name: (x, y) => x.tk.localeCompare(y.tk),
    }[ui.listSort];
    return a.sort(by);
  }

  function renderList() {
    const all = M.companies;
    const up = all.filter((c) => c.change > 0).length, down = all.filter((c) => c.change < 0).length;
    $('list-sub').textContent = all.length + ' posities, samen ' + eur(M.totalValue) + '. ' + up + ' gestegen en ' + down + ' gedaald ' + M.dayWord + '.';
    segButtons($('list-filter'), FILTERS, ui.listFilter, (k) => { ui.listFilter = k; renderList(); });
    segButtons($('list-sort'), SORTS, ui.listSort, (k) => { ui.listSort = k; renderList(); });
    segButtons($('list-span'), SPANS, ui.listSpan, (k) => { ui.listSpan = k; renderList(); });
    const q = ui.listQuery.trim().toLowerCase();
    const items = sortedCompanies().filter((c) =>
      (ui.listFilter === 'all' || (ui.listFilter === 'up' ? c.change > 0 : c.change < 0)) &&
      (!q || c.tk.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)));
    fill('list-grid', items.length ? items.map((c) => {
      const pts = seriesFor(c.tk, ui.listSpan);
      const delta = ui.listSpan === 'today' ? c.change : pts.length > 1 ? pts[pts.length - 1].v - pts[0].v : c.change;
      return '<button type="button" class="tile" data-ticker="' + esc(c.tk) + '" aria-label="' + esc(c.name + ', ' + eur(c.value) + ', ' + spct(c.changePct) + ' ' + M.dayWord + '. Inzoomen') + '">' +
        '<span class="row"><span class="tk">' + esc(c.tk) + '</span><b class="' + tone(c.change) + '">' + esc(spct(c.changePct)) + '</b></span>' +
        '<span class="nm">' + esc(c.name) + '</span>' +
        '<span class="row" style="margin-top:8px"><span class="v" style="font-size:22px">' + esc(eur(c.value)) + '</span><span class="sub">' + esc(isNum(c.weight) ? P1.format(c.weight) + ' van totaal' : '') + '</span></span>' +
        '<span class="sub">Sinds aankoop <b class="' + tone(c.resultPct) + '">' + esc(spct1(c.resultPct)) + '</b></span>' +
        spark(pts, toneColor(delta)) + '</button>';
    }) : ['<p class="empty">Geen bedrijven gevonden' + (q ? ' voor “' + esc(ui.listQuery) + '”' : '') + '.</p>']);
  }

  $('list-search').addEventListener('input', (e) => { ui.listQuery = e.target.value; if (M) renderList(); });

  // ---------- Bedrijfspagina ----------
  function renderDetail(animate, swapDir) {
    const c = M.byTk.get(ui.detail);
    if (!c) return;
    const order = sortedCompanies();
    const i = order.findIndex((x) => x.tk === c.tk);
    const prev = order[(i - 1 + order.length) % order.length], next = order[(i + 1) % order.length];
    const S = statsFor(c.tk);
    const tot = M.total || {};

    // Weging door de tijd en afstand tot de top, uit de dagreeksen
    const dAll = seriesFor(c.tk, 'all');
    const tMap = new Map(seriesFor(TOTAL, 'all').map((p) => [dayKey(p.t), p.v]));
    const weightHist = dAll.map((p) => { const t = tMap.get(dayKey(p.t)); return t ? { t: p.t, v: p.v / t } : null; }).filter(Boolean);
    const monthAgo = weightHist.filter((p) => p.t <= Date.now() - 30 * 864e5).pop();
    let runMax = -Infinity;
    const ddHist = dAll.map((p) => { runMax = Math.max(runMax, p.v); return { t: p.t, v: p.v / runMax - 1 }; });
    const dd = isNum(c.ath) && c.ath > 0 ? (c.value - c.ath) / c.ath : null;
    const price = c.qty ? c.value / c.qty : null;
    const avgBuy = c.qty && isNum(c.cost) ? c.cost / c.qty : null;
    const todayRangePct = isNum(c.high) && isNum(c.low) && c.avg ? (c.high - c.low) / c.avg : null;
    let rangeNote = '';
    if (isNum(todayRangePct) && isNum(c.avgRangePct) && c.avgRangePct > 0) {
      const ratio = todayRangePct / c.avgRangePct;
      rangeNote = 'Vandaag ' + P1.format(todayRangePct) + ' tussen laag en hoog, ' +
        (ratio > 1.3 ? 'drukker dan' : ratio < 0.7 ? 'rustiger dan' : 'ongeveer zoals') + ' gemiddeld (' + P1.format(c.avgRangePct) + ').';
    }
    const contrib = isNum(c.change) && isNum(tot.change) ? seur(c.change) + ' van ' + seur(tot.change) : '–';

    const kpis = [
      tileStat(M.isToday ? 'Vandaag' : 'Laatste handelsdag', seur(c.change), spct(c.changePct) + ' sinds opening', tone(c.change), spark(seriesFor(c.tk, 'today'), toneColor(c.change))),
      tileStat('Sinds aankoop', spct1(c.resultPct), isNum(c.unreal) ? seur(c.unreal) + ' op ' + eur(c.cost) + ' inleg' : 'geen aankoopgegevens', tone(c.resultPct), spark(dAll, toneColor(c.resultPct))),
      tileStat('Deel van portefeuille', isNum(c.weight) ? P1.format(c.weight) : '–', monthAgo ? 'was ' + P1.format(monthAgo.v) + ' op ' + fDM.format(monthAgo.t) : 'van ' + eur(M.totalValue), '', spark(weightHist, C.accent)),
      tileStat('Tot hoogste ooit', dd == null ? '–' : dd >= -0.0005 ? 'Op het hoogste punt' : spct1(dd), isNum(c.ath) ? 'hoogste ooit ' + eur(c.ath) + (dd < -0.0005 ? ', nog ' + eur(c.ath - c.value) : '') : '', dd != null && dd < -0.0005 ? 'loss' : '', spark(ddHist, C.loss)),
    ];

    const html =
      '<div class="band">' +
        '<div class="d-top"><button type="button" class="btn dark" data-act="back">← Terug</button>' +
          '<div class="d-nav"><button type="button" class="btn line" data-act="prev" aria-label="Vorige: ' + esc(prev.name) + '">← ' + esc(prev.tk) + '</button>' +
          '<button type="button" class="btn line" data-act="next" aria-label="Volgende: ' + esc(next.name) + '">' + esc(next.tk) + ' →</button></div></div>' +
        '<div class="hero-head ' + (swapDir ? 'swap-' + swapDir : '') + '"><div><p class="hero-label">' + esc(c.name) + '</p>' +
          '<h2 id="d-title" class="hero-value">' + esc(c.tk) + ' ' + esc(eur(c.value)) + '</h2>' +
          '<p class="hero-change ' + tone(c.change) + '">' + esc(seur(c.change) + ' (' + spct(c.changePct) + ') ' + M.dayWord) + '</p></div>' +
          '<div class="hero-ctrl"><div id="d-ranges" class="seg" role="group" aria-label="Periode van de grafiek"></div>' +
          '<label class="check"><input type="checkbox" id="d-compare"' + (ui.compare ? ' checked' : '') + '> Vergelijk met portefeuille</label></div></div>' +
        '<div id="d-chart" class="chart hero-chart" role="img" aria-label="' + esc('Verloop van ' + c.name) + '"></div>' +
        '<div id="d-legend"></div><div id="d-x" class="xlabels"></div>' +
      '</div>' +
      '<div class="wrap ' + (swapDir ? 'swap-' + swapDir : '') + '">' +
        '<div class="grid">' + kpis.join('') + '</div>' +
        '<div class="grid wide" style="margin-top:16px">' +
          '<section class="tile pad"><h3>Dagbereik binnen de historie</h3>' + rangeStrip(c) +
            '<p class="sub" style="margin-top:10px">Balk: laag tot hoog ' + esc(M.dayWord) + '. Streep: gemiddelde. Punt: nu. ' + esc(rangeNote) + '</p>' +
            '<div style="margin-top:12px">' + kvList([
              ['Opening', eur(c.open)],
              ['Laagste en hoogste', isNum(c.low) ? eur(c.low) + ' – ' + eur(c.high) : '–'],
              ['Gemiddelde', eur(c.avg)],
              ['Vanaf laagste ooit', isNum(c.atl) && c.atl > 0 ? spct1((c.value - c.atl) / c.atl) : '–', 'gain'],
            ]) + '</div></section>' +
          '<section class="tile pad"><h3>Positie</h3>' + kvList([
            ['Waarde nu', eur(c.value)],
            ['Aantal', c.qty ? N4.format(c.qty) : '–'],
            ['Koers in euro', eur(price)],
            ['Gemiddelde aankoopprijs', eur(avgBuy)],
            ['Ingelegd', eur(c.cost)],
            ['Ongerealiseerd', isNum(c.unreal) ? seur(c.unreal) + ' (' + spct1(c.resultPct) + ')' : '–', tone(c.unreal)],
            ['Bijdrage aan dagresultaat', contrib, tone(c.change)],
          ]) + '</section>' +
          '<section class="tile pad"><h3>Historie</h3>' + kvList([
            ['Gemeten dagen', S.n ? S.n + (S.returns[0] ? ' sinds ' + fDM.format(S.returns[0].t) : '') : '–'],
            ['Gestegen en gedaald', S.n ? S.up + ' en ' + S.down + ' dagen' : '–'],
            ['Huidige reeks', streakText(S)],
            ['Beste dag', S.best ? spct(S.best.pct) + ', ' + fD.format(S.best.t) : '–', 'gain'],
            ['Slechtste dag', S.worst ? spct(S.worst.pct) + ', ' + fD.format(S.worst.t) : '–', 'loss'],
            ['Gemiddeld dagbereik', isNum(c.avgRange) ? eur(c.avgRange) + ' (' + P1.format(c.avgRangePct || 0) + ')' : '–'],
            ['Beweeglijkheid', isNum(S.sd) ? '± ' + P1.format(S.sd) + ' per dag' : '–'],
            ['Beweegt mee met portefeuille', corrText(S.corr)],
            ['Gevoeligheid', isNum(S.beta) ? N2.format(S.beta) + '× de portefeuille' : '–'],
          ]) + '</section>' +
        '</div>' +
        '<div class="section-head"><h2>Patronen</h2></div>' +
        '<div class="grid">' + patternTiles(c.tk, S).join('') + '</div>' +
        '<p class="foot">Dagresultaten zijn de verandering tussen de eerste en de laatste meting van een dag. Dagen die meer dan 25% bewegen, tellen niet mee: dat is bijna altijd een aankoop of verkoop. ' +
          'Koers en aankoopprijs zijn in euro en volgen uit waarde, inleg en aantal. “Beweegt mee” is de correlatie van de dagresultaten met die van je hele portefeuille; “gevoeligheid” geeft aan hoeveel sterker of zwakker het bedrijf meestal beweegt.</p>' +
      '</div>';

    const inner = $('detail-inner');
    const keepScroll = !animate && !swapDir ? $('detail').scrollTop : 0;
    inner.innerHTML = html;
    if (!animate && !swapDir) $('detail').scrollTop = keepScroll;
    $('d-compare').addEventListener('change', (e) => { ui.compare = e.target.checked; renderDetailChart(true); });
    renderDetailChart(animate || !!swapDir);
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
        { pts: mine, color: C.accent, area: false, width: 3, label: c.tk, fmt: spct },
        { pts: port, color: C.ink2, dash: true, width: 2, label: 'Portefeuille', fmt: spct },
      ], { animate, zero: true, xl: $('d-x'), xfmt: xFmt(r), tfmt: tFmt(r) });
      const a = mine.length ? mine[mine.length - 1].v : null, b = port.length ? port[port.length - 1].v : null;
      legend.innerHTML = '<div class="hero-head" style="padding-top:4px"><div class="legend"><span><i style="background:' + C.accent + '"></i>' + esc(c.tk) + ' ' + esc(spct(a)) + '</span><span><i class="dash"></i>Portefeuille ' + esc(spct(b)) + '</span></div></div>';
    } else {
      let mi = 0;
      pts.forEach((p, i) => { if (p.v > pts[mi].v) mi = i; });
      lineChart($('d-chart'), [{ pts, color: C.accent, area: true, width: 3 }], {
        animate, markers: pts.length > 2 ? [{ i: mi, label: 'hoogste ' + eur(pts[mi].v) }] : [],
        xl: $('d-x'), xfmt: xFmt(r), tfmt: tFmt(r),
      });
      legend.innerHTML = '';
    }
  }

  $('detail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') closeDetail();
    else {
      const order = sortedCompanies();
      const i = order.findIndex((x) => x.tk === ui.detail);
      const n = order[(i + (act === 'next' ? 1 : -1) + order.length) % order.length];
      switchDetail(n.tk, act === 'next' ? 'r' : 'l');
    }
  });

  // ---------- Inzoomen ----------
  const ov = $('detail');
  const shell = $('shell');
  const inView = (r) => r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
  const setRect = (r) => Object.assign(ov.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  const setFull = () => Object.assign(ov.style, { left: '0px', top: '0px', width: '100%', height: '100%' });
  let zoomTimer = null;

  function setOrigin(r) {
    const s = shell.getBoundingClientRect();
    shell.style.transformOrigin = (r.left + r.width / 2 - s.left) + 'px ' + (r.top + r.height / 2 - s.top) + 'px';
  }

  function ghostOf(el, r) {
    const g = el.cloneNode(true);
    g.removeAttribute('data-ticker');
    g.removeAttribute('aria-label');
    g.setAttribute('aria-hidden', 'true');
    g.classList.add('ghost');
    g.style.width = r.width + 'px';
    g.style.height = r.height + 'px';
    return g;
  }

  function openDetail(tk, originEl, push) {
    if (!M || !M.byTk.has(tk)) return;
    clearTimeout(zoomTimer);
    hideTip();
    ui.detail = tk;
    ui.detailRange = '3d';
    ui.compare = false;
    ui.origin = tk;
    if (push) { history.pushState({ detail: tk }, '', '#bedrijf/' + encodeURIComponent(tk)); pushedDetail = true; }
    renderDetail(true);
    ov.querySelectorAll('.ghost').forEach((g) => g.remove());
    ov.classList.remove('anim', 'open', 'pop', 'fade-out');
    ov.hidden = false;
    ov.scrollTop = 0;
    document.documentElement.classList.add('locked');
    shell.inert = true;

    const r = originEl && originEl.getBoundingClientRect();
    if (reduceMotion() || !r || !inView(r)) {
      setFull();
      ov.classList.add('open');
      if (!reduceMotion()) ov.classList.add('pop');
      shell.classList.add('zoomed');
      focusDetail();
      return;
    }
    setRect(r);
    const g = ghostOf(originEl, r);
    ov.appendChild(g);
    setOrigin(r);
    void ov.offsetWidth;
    ov.classList.add('anim');
    shell.classList.add('zoom-anim');
    requestAnimationFrame(() => {
      setFull();
      ov.classList.add('open');
      shell.classList.add('zoomed');
      g.style.opacity = '0';
    });
    zoomTimer = setTimeout(() => { g.remove(); shell.classList.remove('zoom-anim'); focusDetail(); }, ZOOM_MS + 20);
  }

  function focusDetail() {
    const b = ov.querySelector('[data-act="back"]');
    if (b) b.focus({ preventScroll: true });
  }

  function switchDetail(tk, dir) {
    if (!M.byTk.has(tk)) return;
    ui.detail = tk;
    ui.origin = tk;
    history.replaceState({ detail: tk }, '', '#bedrijf/' + encodeURIComponent(tk));
    ov.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    renderDetail(false, reduceMotion() ? null : dir);
    focusDetail();
  }

  function closeDetail() {
    if (!ui.detail) return;
    if (pushedDetail) { history.back(); return; }   // de hashchange sluit daarna de pagina
    history.replaceState(null, '', '#' + (ui.page === 'list' ? 'bedrijven' : 'overzicht'));
    finishDetail();
  }

  function finishDetail() {
    if (!ui.detail) return;
    const tk = ui.origin || ui.detail;
    ui.detail = null;
    pushedDetail = false;
    clearTimeout(zoomTimer);
    hideTip();
    shell.inert = false;
    const sel = '#page-' + ui.page + ' [data-ticker="' + (window.CSS && CSS.escape ? CSS.escape(tk) : tk) + '"]';
    const el = document.querySelector(sel);

    const done = () => {
      ov.hidden = true;
      ov.classList.remove('anim', 'open', 'pop', 'fade-out');
      ov.removeAttribute('style');
      ov.querySelectorAll('.ghost').forEach((g) => g.remove());
      shell.classList.remove('zoom-anim', 'zoomed');
      shell.style.transformOrigin = '';
      document.documentElement.classList.remove('locked');
      if (el) el.focus({ preventScroll: true });
    };

    if (reduceMotion()) { done(); return; }
    if (!el) {
      shell.classList.add('zoom-anim');
      shell.classList.remove('zoomed');
      ov.classList.add('fade-out');
      zoomTimer = setTimeout(done, 220);
      return;
    }
    // Pagina eerst zonder zoom meten, zo nodig de tegel in beeld schuiven
    shell.classList.remove('zoom-anim', 'zoomed');
    let r = el.getBoundingClientRect();
    if (!inView(r) || r.top < 0 || r.bottom > window.innerHeight) {
      window.scrollBy(0, r.top - (window.innerHeight - r.height) / 2);
      r = el.getBoundingClientRect();
    }
    setOrigin(r);
    shell.classList.add('zoomed');
    void shell.offsetWidth;
    shell.classList.add('zoom-anim');
    shell.classList.remove('zoomed');

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

  // Klik op een tegel of legenda-regel met een ticker: inzoomen
  document.getElementById('app').addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) { location.hash = go.dataset.goto; return; }
    const el = e.target.closest('[data-ticker]');
    if (el) openDetail(el.dataset.ticker, el, true);
  });

  // ---------- Pagina's en adresbalk ----------
  const ORDER = { home: 0, list: 1 };

  function placePill() {
    const a = document.querySelector('.pillnav a[aria-current="page"]');
    const pill = document.querySelector('.pill');
    if (!a || !pill) return;
    pill.style.width = a.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + a.offsetLeft + 'px)';
  }

  function showPage(p, animate) {
    const prev = ui.page;
    ui.page = p;
    document.body.dataset.page = p;
    document.querySelectorAll('.pillnav a').forEach((a) => {
      if (a.dataset.page === p) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    placePill();
    Object.keys(ORDER).forEach((k) => { $('page-' + k).hidden = k !== p; });
    const el = $('page-' + p);
    if (animate && !reduceMotion()) {
      el.classList.remove('in-r', 'in-l', 'enter');
      void el.offsetWidth;
      if (prev !== p) el.classList.add(ORDER[p] > ORDER[prev] ? 'in-r' : 'in-l');
      el.classList.add('enter');
      setTimeout(() => el.classList.remove('in-r', 'in-l', 'enter'), 1400);
    }
    if (prev !== p) window.scrollTo(0, 0);
  }

  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h.indexOf('bedrijf/') === 0) return { tk: h.slice(8) };
    return { page: h === 'bedrijven' ? 'list' : 'home' };
  }

  function route(first) {
    const r = parseHash();
    if (r.tk) {
      if (first || !$('page-' + ui.page)) showPage('list', first);
      if (!M) return;
      if (!ui.detail) openDetail(r.tk, null, false);
      else if (ui.detail !== r.tk) switchDetail(r.tk, 'r');
      return;
    }
    if (ui.detail) { pushedDetail = false; finishDetail(); }
    if (r.page !== ui.page || first) showPage(r.page, true);
  }

  window.addEventListener('hashchange', () => route(false));
  window.addEventListener('resize', placePill);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placePill);

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

    return {
      ok: true, generated: iso(now), currency: 'EUR', weeks, positionsDate: iso(now), positions, today,
      intraday: { columns: ['time', 'ticker', 'value'], rows: intraday },
      hours: { columns: ['hour', 'ticker', 'open', 'close', 'low', 'high', 'avg'], rows: hours },
      days: { columns: ['date', 'ticker', 'open', 'close', 'low', 'high', 'avg', 'range', 'rangePct'], rows: days },
    };
  }

  // ---------- Start ----------

  if (new URLSearchParams(location.search).has('demo')) demo = true;
  placePill();
  load();
})();
