/* Investeringstracker – Model: gegevens van de Worker omzetten, reeksen en statistiek
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

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
  // Vrij saldo: van de laatste meting als die er is, anders uit de weekmeting
  const cn = data.cashNow;
  const cnT = cn && cn.at ? new Date(cn.at).getTime() : null;
  if (cn && isNum(cn.cash) && isNum(cnT) && (!lw || cnT >= lw.t)) { m.cash = cn.cash; m.cashAt = cnT; }
  else { m.cash = lw && isNum(lw.cash) ? lw.cash : null; m.cashAt = lw ? lw.t : null; }
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
  if (range === '1w') { const from = (M.lastT || Date.now()) - 7 * DAY; const h = s.hourly.filter((p) => p.t >= from); return h.length >= 3 ? h : intra; }
  if (range === '1m') { const from = (M.lastT || Date.now()) - 30 * DAY; const h = s.hourly.filter((p) => p.t >= from); return h.length >= 3 ? h : intra; }
  if (range === 'ytd' || range === '1y') {
    const from = range === 'ytd' ? new Date(new Date(M.lastT || Date.now()).getFullYear(), 0, 1).getTime() : (M.lastT || Date.now()) - 365 * DAY;
    const d = s.daily.filter((x) => x.t >= from).map((x) => ({ t: x.t, v: x.close }));
    if (d.length >= 3) return d;
  }
  if (s.daily.length >= 3) return s.daily.map((d) => ({ t: d.t, v: d.close }));
  return s.hourly.length >= 3 ? s.hourly : intra;
}

function coverageNote(range, pts) {
  if (!pts.length || M.lastT == null) return '';
  const first = pts[0].t;
  let short;
  if (range === 'today') short = first > dayStart(M.lastT) + (8 * 60 + 40) * 60000;
  else if (range === '3d') short = M.intraDays < 3;
  else if (range === '1w') short = first > M.lastT - 6 * DAY;
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
