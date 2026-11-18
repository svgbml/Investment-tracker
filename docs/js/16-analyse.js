/* Investeringstracker – Analyse: echt rendement (XIRR en TWR), maatstaf, drawdown, risicomaten, bijdrage, kalender,
 * en extra rekenhulpen op Plannen (kansberekening, FIRE, maandelijks inleggen terugrekenen, herbeleggen, herbalanceren, rente, box 3)
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// Toestand van deze pagina (keuzes die niet worden opgeslagen)
const anState = { contrib: 'ytd', heatYear: null, bench: null, pA: 'ytd', pB: 'prev', mcKey: '', mcRes: null, mcBusy: false, dcaSym: 'SP500', dcaAmt: 100, dcaMonths: 12,
  fireWr: 0.035, b3Partner: false, b3Year: null, rebNew: 0, rebCash: false, wrapYear: null, txKind: 'all', txQuery: '' };
const userPrefs = () => (M && M.settings && M.settings.prefs) || {};
async function savePrefs(patch) {
  const next = Object.assign({}, userPrefs(), patch);
  await saveSettings({ prefs: next });
  return next;
}
const YEAR_MS = 365.25 * DAY;
const fYear = (t) => String(new Date(t).getFullYear());

// ---------- Geldstromen en rendement ----------
// Netto aan- en verkopen per dag (koop +, verkoop −), voor één aandeel of alles samen
function tradeFlows(tk) {
  const m = new Map();
  M.tx.trades.forEach((x) => {
    if (tk !== TOTAL && x.tk !== tk) return;
    if (!isNum(x.net)) return;
    const k = dayKey(x.t);
    m.set(k, (m.get(k) || 0) + (x.side === 'SELL' ? -x.net : x.net));
  });
  return m;
}

// Tijdgewogen index per dag: aan- en verkopen tellen niet als rendement (1 = start)
const twrCache = new WeakMap();
function twrSeries(tk) {
  let c = twrCache.get(M);
  if (!c) { c = new Map(); twrCache.set(M, c); }
  if (c.has(tk)) return c.get(tk);
  const d = seriesOf(tk).daily;
  const F = tradeFlows(tk);
  let idx = 1;
  const out = [];
  d.forEach((x, i) => {
    if (!i) { out.push({ t: x.t, v: 1, r: null }); return; }
    const prev = d[i - 1].close;
    const f = F.get(dayKey(x.t)) || 0;
    // Op een dag met een aan- of verkoop: neem de lezing met of zonder dat bedrag die de kleinste beweging geeft
    // (een order kan een dag eerder of later in de waarde zitten dan op de orderdatum)
    let r = prev > 0 ? (x.close - f) / prev - 1 : null;
    if (r != null && f) { const r0 = x.close / prev - 1; if (Math.abs(r0) < Math.abs(r)) r = r0; }
    if (r != null && Math.abs(r) > MAX_DAY_MOVE) r = null; // gat of onbekende storting: overslaan
    if (r != null) idx *= 1 + r;
    out.push({ t: x.t, v: idx, r });
  });
  c.set(tk, out);
  return out;
}
const twrReturns = (tk) => twrSeries(tk).filter((p) => isNum(p.r));

// Geldgewogen rendement per jaar (XIRR): stromen [{ t, v }], inleg negatief, opbrengst positief
function xirrOf(flows) {
  const f = flows.filter((x) => isNum(x.v) && x.v !== 0 && isNum(x.t)).sort((a, b) => a.t - b.t);
  if (f.length < 2 || !f.some((x) => x.v < 0) || !f.some((x) => x.v > 0)) return null;
  const t0 = f[0].t;
  const npv = (r) => sum(f.map((x) => x.v / Math.pow(1 + r, (x.t - t0) / YEAR_MS)));
  let lo = -0.999, hi = 20, flo = npv(lo), fhi = npv(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-8) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

// Hele account: begin met de eerste weekwaarde, dan elke storting, eind = accountwaarde nu
function accountFlows() {
  const W = M.weeks.filter((w) => isNum(w.accountValue));
  if (W.length < 2) return null;
  const f = [{ t: W[0].t, v: -W[0].accountValue }];
  W.slice(1).forEach((w) => { if (isNum(w.newDeposits) && w.newDeposits) f.push({ t: w.t, v: -w.newDeposits }); });
  f.push({ t: Math.max(Date.now(), W[W.length - 1].t + HOUR), v: M.accountNow });
  return f;
}
// Tijdgewogen rendement van de account uit de weekmetingen (stortingen tellen niet mee)
function accountTwr() {
  const W = M.weeks.filter((w) => isNum(w.accountValue));
  if (W.length < 2) return null;
  let idx = 1;
  W.slice(1).forEach((w, i) => {
    const prev = W[i].accountValue;
    const dep = isNum(w.newDeposits) ? w.newDeposits : 0;
    if (prev > 0) { const r = (w.accountValue - dep) / prev - 1; if (Math.abs(r) < 0.5) idx *= 1 + r; }
  });
  const last = W[W.length - 1];
  if (last.accountValue > 0 && M.accountNow > 0) { const r = M.accountNow / last.accountValue - 1; if (Math.abs(r) < 0.5) idx *= 1 + r; }
  return { total: idx - 1, from: W[0].t, years: (Date.now() - W[0].t) / YEAR_MS };
}
const perYear = (total, years) => (isNum(total) && years >= 1 ? Math.pow(1 + total, 1 / years) - 1 : null);

// Per positie: orders, dividenden en de waarde nu
function positionReturn(tk) {
  const c = M.byTk.get(tk);
  const tr = M.tx.trades.filter((x) => x.tk === tk && isNum(x.net));
  const divs = M.ev.received.filter((d) => d.ticker === tk);
  const flows = tr.map((x) => ({ t: x.t, v: x.side === 'SELL' ? x.net : -x.net })).concat(divs.map((d) => ({ t: d.t, v: d.amount })));
  if (c) flows.push({ t: Date.now(), v: c.value });
  const qty = sum(tr.map((x) => (x.side === 'SELL' ? -1 : 1) * (x.qty || 0)));
  const complete = !c || !isNum(c.qty) || (tr.length > 0 && Math.abs(qty - c.qty) <= Math.max(0.02 * c.qty, 1e-6));
  const T = twrSeries(tk);
  const twr = T.length > 1 ? T[T.length - 1].v - 1 : null;
  return { tk, c, xirr: complete ? xirrOf(flows) : null, complete, twr, twrFrom: T.length ? T[0].t : null, divs: sum(divs.map((d) => d.amount)) };
}

// ---------- Rendement: XIRR en TWR ----------
function returnsTile() {
  const F = accountFlows();
  const tw = accountTwr();
  const xi = F ? xirrOf(F) : null;
  const tTot = twrSeries(TOTAL);
  const twInv = tTot.length > 1 ? tTot[tTot.length - 1].v - 1 : null;
  const rows = M.companies.slice().sort((a, b) => b.value - a.value).map((c) => positionReturn(c.tk));
  const short = tw && tw.years < 1;
  return '<section class="tile pad full"><h3>Echt rendement</h3>' +
    '<div class="scen-res"><div><span class="muted small">' + trm('Geldgewogen (XIRR)', 'xirr') + '</span><b class="v big ' + tone(xi) + '">' + esc(isNum(xi) ? spct1(xi) + ' per jaar' : '–') + '</b><span class="muted small">je eigen rendement, met de timing van je stortingen</span></div>' +
    '<div><span class="muted small">' + trm('Tijdgewogen (TWR)', 'twr') + '</span><b class="v big ' + tone(tw && tw.total) + '">' + esc(tw ? spct1(tw.total) : '–') + '</b><span class="muted small">' + esc(tw ? (short ? 'sinds ' + fDM.format(tw.from) + ' ' + fYear(tw.from) : spct1(perYear(tw.total, tw.years)) + ' per jaar sinds ' + fYear(tw.from)) : 'na twee weekmetingen') + '</span></div>' +
    '<div><span class="muted small">Alleen je beleggingen (TWR)</span><b class="v big ' + tone(twInv) + '">' + esc(isNum(twInv) ? spct1(twInv) : '–') + '</b><span class="muted small">' + esc(tTot.length ? 'sinds ' + fDM.format(tTot[0].t) + ' ' + fYear(tTot[0].t) + ', zonder vrij saldo' : '') + '</span></div></div>' +
    (short && isNum(xi) ? '<p class="small muted" style="margin-top:6px">Je meet nog geen jaar: een rendement "per jaar" over een korte periode kan sterk overdreven zijn.</p>' : '') +
    '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Positie</th><th class="num">XIRR per jaar</th><th class="num">TWR sinds meting</th><th class="num">Dividend</th><th class="num">Waarde</th></tr></thead><tbody>' +
    rows.map((r) => '<tr class="rowlink" data-ticker="' + esc(r.tk) + '"><td class="co"><b>' + esc(r.tk) + '</b><span class="nm">' + esc(r.c.name) + '</span></td>' +
      '<td class="num ' + tone(r.xirr) + '">' + esc(isNum(r.xirr) ? spct1(r.xirr) : r.complete ? '–' : 'onvolledig') + '</td>' +
      '<td class="num ' + tone(r.twr) + '">' + esc(isNum(r.twr) ? spct1(r.twr) : '–') + '</td><td class="num">' + esc(r.divs ? eur(r.divs) : '–') + '</td><td class="num">' + esc(eur(r.c.value)) + '</td></tr>').join('') +
    '</tbody></table></div>' +
    '<p class="sub" style="margin-top:8px">XIRR rekent met elke storting en wanneer je die deed; TWR kijkt alleen naar hoe je beleggingen het deden, los van stortingen (zoals fondsen het rapporteren). "Onvolledig": er zijn aankopen van vóór je ordergeschiedenis; lees je volledige geschiedenis in via de CSV op Plannen.</p></section>';
}

// ---------- Maatstaf: dezelfde stortingen in een index of fonds ----------
const BENCH_OPTS = [['SP500', 'S&P 500', 'idx'], ['NASDAQ100', 'Nasdaq-100', 'idx'], ['URTH', 'MSCI World', 'sym'], ['VT', 'FTSE All-World', 'sym'], ['VGK', 'Europa', 'sym'], ['EWN', 'Nederland', 'sym']];
function benchPick() {
  const saved = M.settings.benchmark;
  return anState.bench || userPrefs().benchPick || (saved && BENCH_OPTS.some((b) => b[0] === saved) ? saved : saved || 'SP500');
}
function benchLabel(k) { const o = BENCH_OPTS.find((b) => b[0] === k); return o ? o[1] : k; }
// Koersen in euro: FRED-index of een beurssymbool (in dollars) via de ECB-koers
function benchPts(k) {
  const o = BENCH_OPTS.find((b) => b[0] === k);
  if (o && o[2] === 'idx') return indexEur(k);
  if (!M.mk.ok) return [];
  const fx = fxMap();
  const days = [...fx.keys()].sort();
  let j = 0, last = null;
  return M.mk.prices(k).map((p) => { while (j < days.length && days[j] <= p.day) { last = fx.get(days[j]); j++; } return last ? { day: p.day, t: p.t, v: p.v / last } : null; }).filter(Boolean);
}
function benchModel(k) {
  const pts = benchPts(k);
  const W = M.weeks.filter((w) => isNum(w.accountValue));
  if (pts.length < 20 || W.length < 2) return null;
  const i0 = W.findIndex((w) => w.t >= pts[0].t - 3 * DAY);
  if (i0 < 0 || i0 > W.length - 2) return null;
  let units = 0;
  const line = [], mine = [], flows = [];
  W.slice(i0).forEach((w, i) => {
    const dep = i === 0 ? w.accountValue : (isNum(w.newDeposits) ? w.newDeposits : 0);
    const p = priceOn(pts, w.t);
    if (!p) return;
    units += dep / p.v;
    flows.push({ t: w.t, v: -dep });
    line.push({ t: w.t, v: units * p.v });
    mine.push({ t: w.t, v: w.accountValue });
  });
  const lastP = pts[pts.length - 1];
  const now = units * lastP.v, tNow = Math.max(Date.now(), line[line.length - 1].t + HOUR);
  line.push({ t: tNow, v: now }); mine.push({ t: tNow, v: M.accountNow });
  return { k, label: benchLabel(k), now, mine, line, from: W[i0].t, xMine: xirrOf(flows.concat([{ t: tNow, v: M.accountNow }])), xBench: xirrOf(flows.concat([{ t: tNow, v: now }])) };
}
function benchTile() {
  const k = benchPick();
  const B = benchModel(k);
  const opts = BENCH_OPTS.concat(M.settings.benchmark && !BENCH_OPTS.some((b) => b[0] === M.settings.benchmark) ? [[M.settings.benchmark, M.settings.benchmark, 'sym']] : []);
  const pick = '<div class="seg light wrap" role="group" aria-label="Maatstaf">' + opts.map((o) => '<button type="button" data-bench="' + esc(o[0]) + '" aria-pressed="' + (o[0] === k) + '">' + esc(o[1]) + '</button>').join('') + '</div>';
  const custom = '<form class="bench-own" data-bench-form><label class="sr-only" for="bench-own">Eigen maatstaf (beurssymbool)</label><input id="bench-own" class="search" maxlength="12" placeholder="Eigen symbool, bijv. IWDA.AS" value=""><button type="submit" class="btn ghost">Gebruiken</button></form>';
  const o = BENCH_OPTS.find((b) => b[0] === k);
  const wait = !B ? (o && o[2] === 'idx' ? (data.idx ? 'Hiervoor zijn minstens twee weekmetingen nodig.' : 'De index wordt één keer per dag opgehaald bij FRED.')
    : demo ? 'Voorbeeldkoersen ontbreken.' : 'Koersen van ' + k + ' worden opgehaald (koershistorie via FMP of Twelve Data); dat kan tot een dag duren.') : '';
  const diff = B ? M.accountNow - B.now : null;
  return '<section class="tile pad full bench"><div class="plan-head"><h3>Jij tegenover je maatstaf</h3>' + pick + '</div>' +
    (B ? '<div class="chart" data-chart="bench" style="height:200px"></div><div class="xlabels" data-x="bench"></div>' +
      '<div class="legend chart-legend" style="margin-top:8px"><span><i style="background:' + C.accent + '"></i>Jij ' + esc(eur(M.accountNow)) + '</span><span><i class="dash"></i>' + esc(B.label) + ' ' + esc(eur(B.now)) + '</span></div>' +
      '<div style="margin-top:10px">' + kvList([
        ['Verschil nu', seur(diff) + (B.now ? ' (' + spct1(M.accountNow / B.now - 1) + ')' : ''), tone(diff)],
        ['Jouw XIRR in deze periode', isNum(B.xMine) ? spct1(B.xMine) + ' per jaar' : '–', tone(B.xMine)],
        ['XIRR van ' + B.label, isNum(B.xBench) ? spct1(B.xBench) + ' per jaar' : '–', tone(B.xBench)],
      ]) + '</div>' : '<p class="muted" style="margin-top:8px">' + esc(wait) + '</p>') + custom +
    '<p class="sub" style="margin-top:8px">Alsof je vanaf ' + esc(B ? fDM.format(B.from) + ' ' + fYear(B.from) : 'je eerste weekmeting') + ' je accountwaarde en daarna elke storting in de maatstaf had gestoken. Fondsen uit de VS (URTH, VT, VGK, EWN) staan model voor de index; koersen zonder dividend, omgerekend naar euro met de ECB-koers.</p></section>';
}
function drawBench(root) {
  const host = root.querySelector('[data-chart="bench"]');
  if (!host) return;
  const B = benchModel(benchPick());
  if (!B) return;
  const base = B.mine.map((p) => p.t);
  const bl = base.map((t) => { const p = priceOn(B.line, t); return { t, v: p ? p.v : null }; });
  lineChart(host, [{ pts: B.mine, color: C.accent, width: 3, label: 'Jij' }, { pts: bl, color: C.ink2, dash: true, width: 2, label: B.label }],
    { top: 0.08, bottom: 0.08, xl: root.querySelector('[data-x="bench"]'), xcount: 3, xfmt: (t) => fDM.format(t), tfmt: (t) => fD.format(t) });
}
async function setBenchmark(k) {
  anState.bench = k;
  const isIdx = BENCH_OPTS.some((b) => b[0] === k && b[2] === 'idx');
  try {
    const patch = { prefs: Object.assign({}, userPrefs(), { benchPick: k }) };
    if (!isIdx) patch.benchmark = k;
    await saveSettings(patch);
    if (!isIdx && !demo && isWorker() && benchPts(k).length < 20) fetchWatchData();
  } catch (e) { /* keuze blijft voor deze sessie */ }
  refresh('analyse');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-bench]');
  if (b) setBenchmark(b.dataset.bench);
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest && e.target.closest('[data-bench-form]');
  if (!f) return;
  e.preventDefault();
  const v = f.querySelector('input').value.trim().toUpperCase();
  if (/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(v)) setBenchmark(v);
});

// ---------- Drawdown: grootste daling vanaf een top ----------
function drawdownModel(tk) {
  const T = twrSeries(tk || TOTAL);
  if (T.length < 10) return null;
  let peak = T[0], maxDd = 0, maxAt = null, maxPeak = null, under = 0, longest = 0;
  const dd = T.map((p) => {
    if (p.v >= peak.v) { peak = p; under = 0; } else under++;
    longest = Math.max(longest, under);
    const d = p.v / peak.v - 1;
    if (d < maxDd) { maxDd = d; maxAt = p; maxPeak = peak; }
    return { t: p.t, v: d };
  });
  let recovered = null;
  if (maxAt) { const after = T.find((p) => p.t > maxAt.t && p.v >= maxPeak.v); recovered = after ? after.t : null; }
  return { dd, maxDd, maxAt, maxPeak, recovered, cur: dd[dd.length - 1].v, longest };
}
function drawdownTile() {
  const D = drawdownModel(TOTAL);
  if (!D) return '<section class="tile pad"><h3>Grootste daling</h3><p class="muted">Hiervoor zijn minstens tien dagen metingen nodig.</p></section>';
  return '<section class="tile pad"><h3>' + trm('Grootste daling (drawdown)', 'drawdown') + '</h3>' +
    '<div class="fx-head"><span class="v big loss">' + esc(spct1(D.maxDd)) + '</span><span class="muted small">' + esc(D.maxAt ? 'van ' + fDM.format(D.maxPeak.t) + ' tot ' + fDM.format(D.maxAt.t) + ' ' + fYear(D.maxAt.t) : '') + '</span></div>' +
    '<div class="chart" data-chart="dd" style="height:140px;margin-top:8px"></div><div class="xlabels" data-x="dd"></div>' +
    '<div style="margin-top:10px">' + kvList([
      ['Nu onder de top', D.cur < -0.0005 ? spct1(D.cur) : 'op de top', D.cur < -0.0005 ? 'loss' : 'gain'],
      ['Hersteld na de grootste daling', D.recovered ? 'op ' + fDM.format(D.recovered) + ' ' + fYear(D.recovered) + ' (' + Math.round((D.recovered - D.maxAt.t) / DAY) + ' dagen)' : D.maxDd < -0.001 ? 'nog niet' : '–'],
      ['Langst onder een eerdere top', D.longest + ' meetdagen'],
    ]) + '</div><p class="sub" style="margin-top:8px">Tijdgewogen: aankopen en verkopen tellen niet als stijging of daling.</p></section>';
}
function drawDrawdown(root) {
  const host = root.querySelector('[data-chart="dd"]');
  const D = host && drawdownModel(TOTAL);
  if (!D) return;
  lineChart(host, [{ pts: D.dd, color: C.loss, area: true, width: 2, fmt: spct1 }], { top: 0.04, bottom: 0.04, xl: root.querySelector('[data-x="dd"]'), xcount: 3, xfmt: (t) => fDM.format(t), tfmt: (t) => fD.format(t), fmt: spct1 });
}

// ---------- Risicomaten: beweeglijkheid, Sharpe, Sortino, beta ----------
function riskFree() {
  const s = data.idx && data.idx.series && data.idx.series.ECBDFR;
  const v = s && s.length ? s[s.length - 1][1] : null;
  return isNum(v) ? { r: v / 100, src: 'ECB-depositorente' } : { r: 0.02, src: 'aangenomen 2%' };
}
function ratiosFor(tk) {
  const T = twrSeries(tk);
  const R = T.filter((p) => isNum(p.r));
  if (R.length < 20) return null;
  const rs = R.map((p) => p.r);
  const sd = stdev(rs);
  const vol = sd * Math.sqrt(252);
  const span = (T[T.length - 1].t - T[0].t) / YEAR_MS;
  const total = T[T.length - 1].v - 1;
  const ann = span >= 0.25 ? Math.pow(1 + total, 1 / span) - 1 : null;
  const rf = riskFree().r, rfd = rf / 252;
  const down = Math.sqrt(mean(rs.map((r) => Math.min(0, r - rfd) ** 2))) * Math.sqrt(252);
  const D = drawdownModel(tk);
  let beta = null, corr = null;
  const sp = indexEur('SP500');
  if (sp.length > 30) {
    const m = new Map();
    sp.forEach((p, i) => { if (i && sp[i - 1].v > 0) m.set(dayKey(p.t), p.v / sp[i - 1].v - 1); });
    const pairs = R.map((p) => [p.r, m.get(dayKey(p.t))]).filter((x) => isNum(x[1]));
    if (pairs.length >= 20) {
      const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
      let sxy = 0, sxx = 0, syy = 0;
      pairs.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
      if (syy > 0 && sxx > 0) { beta = sxy / syy; corr = sxy / Math.sqrt(sxx * syy); }
    }
  }
  return { n: R.length, vol, ann, sharpe: isNum(ann) && vol > 0 ? (ann - rf) / vol : null, sortino: isNum(ann) && down > 0 ? (ann - rf) / down : null,
    calmar: isNum(ann) && D && D.maxDd < 0 ? ann / -D.maxDd : null, beta, corr, maxDd: D ? D.maxDd : null };
}
const ratioWord = (s) => (!isNum(s) ? '' : s >= 1 ? 'goed' : s >= 0.5 ? 'redelijk' : s >= 0 ? 'mager' : 'negatief');
function ratiosTile() {
  const R = ratiosFor(TOTAL);
  if (!R) return '<section class="tile pad"><h3>Risico en rendement</h3><p class="muted">Hiervoor zijn minstens twintig dagen metingen nodig.</p></section>';
  const rf = riskFree();
  const per = M.companies.slice().sort((a, b) => b.value - a.value).slice(0, 12).map((c) => [c, ratiosFor(c.tk)]).filter((x) => x[1]);
  return '<section class="tile pad"><h3>Risico en rendement</h3>' + rawKv([
    [trm('Beweeglijkheid per jaar', 'vol'), P1.format(R.vol)],
    ['Rendement per jaar', isNum(R.ann) ? spct1(R.ann) : 'na drie maanden', tone(R.ann)],
    [trm('Sharpe-ratio', 'sharpe'), isNum(R.sharpe) ? N2.format(R.sharpe) + ' (' + ratioWord(R.sharpe) + ')' : '–', tone(R.sharpe)],
    [trm('Sortino-ratio', 'sortino'), isNum(R.sortino) ? N2.format(R.sortino) : '–', tone(R.sortino)],
    [trm('Calmar-ratio', 'calmar'), isNum(R.calmar) ? N2.format(R.calmar) : '–'],
    [trm('Beta tegenover de S&P 500', 'beta'), isNum(R.beta) ? N2.format(R.beta) + (isNum(R.corr) ? ' (samenhang ' + N2.format(R.corr) + ')' : '') : 'vraagt de S&P 500 (FRED)'],
  ]) + (per.length ? '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Positie</th><th class="num">Beweeglijk</th><th class="num">Sharpe</th><th class="num">Beta</th></tr></thead><tbody>' +
    per.map(([c, r]) => '<tr class="rowlink" data-ticker="' + esc(c.tk) + '"><td><b>' + esc(c.tk) + '</b></td><td class="num">' + esc(P1.format(r.vol)) + '</td><td class="num ' + tone(r.sharpe) + '">' + esc(isNum(r.sharpe) ? N2.format(r.sharpe) : '–') + '</td><td class="num">' + esc(isNum(r.beta) ? N2.format(r.beta) : '–') + '</td></tr>').join('') + '</tbody></table></div>' : '') +
    '<p class="sub" style="margin-top:8px">Over ' + R.n + ' meetdagen, tijdgewogen. Risicovrije rente: ' + esc(P2.format(rf.r) + ' (' + rf.src + ')') + '. Beta 1 = beweegt gemiddeld even sterk als de S&P 500 (in euro).</p></section>';
}

// ---------- Bijdrage per positie in een periode ----------
const PERIODS = [['m', 'Deze maand'], ['ytd', 'Dit jaar'], ['1y', '12 maanden'], ['all', 'Alles']];
function periodStart(k) {
  const n = new Date();
  if (k === 'm') return new Date(n.getFullYear(), n.getMonth(), 1).getTime();
  if (k === 'ytd') return new Date(n.getFullYear(), 0, 1).getTime();
  if (k === '1y') return n.getTime() - 365 * DAY;
  return 0;
}
function contribModel(k) {
  const from = periodStart(k);
  const tks = [...M.days.keys(), ...M.byTk.keys()].filter((t, i, a) => t !== TOTAL && a.indexOf(t) === i);
  const rows = tks.map((tk) => {
    const d = seriesOf(tk).daily.filter((x) => x.t >= from - 4 * DAY);
    const F = tradeFlows(tk);
    let p = 0;
    d.forEach((x, i) => {
      if (!i || x.t < from) return;
      const f = F.get(dayKey(x.t)) || 0;
      let step = x.close - f - d[i - 1].close;
      if (f && Math.abs(x.close - d[i - 1].close) < Math.abs(step)) step = x.close - d[i - 1].close;
      if (d[i - 1].close > 0 && Math.abs(step / d[i - 1].close) <= MAX_DAY_MOVE) p += step;
    });
    const c = M.byTk.get(tk);
    const per = M.tx.perTk.find((x) => x.tk === tk);
    return { tk, name: (c && c.name) || (per && per.name) || tk, held: !!c, p };
  }).filter((r) => Math.abs(r.p) >= 0.005).sort((a, b) => b.p - a.p);
  return { rows, total: sum(rows.map((r) => r.p)) };
}
function contribTile() {
  const k = anState.contrib;
  const Cm = contribModel(k);
  const mx = Math.max(1e-9, ...Cm.rows.map((r) => Math.abs(r.p)));
  return '<section class="tile pad"><div class="plan-head"><h3>Wie dreef je resultaat?</h3>' + segX('anContrib', PERIODS, k, 'Periode') + '</div>' +
    (Cm.rows.length ? '<p class="small">Samen <b class="' + tone(Cm.total) + '">' + esc(seur(Cm.total)) + '</b> koersresultaat.</p><div class="hbars" style="margin-top:8px">' + Cm.rows.slice(0, 14).map((r) =>
      '<' + (r.held ? 'button type="button" data-open="' + esc(r.tk) + '"' : 'div') + ' class="r" data-tip="' + esc(r.name + ': ' + seur(r.p) + (Cm.total ? ' (' + P1.format(r.p / Math.abs(Cm.total)) + ' van het totaal)' : '')) + '">' +
      '<span class="tk">' + esc(r.tk) + '</span><span class="track"><span class="mid"></span><span class="' + (r.p < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(r.p) / mx * 50).toFixed(1) + '%"></span></span>' +
      '<span class="' + tone(r.p) + '" style="text-align:right;font-weight:600">' + esc(seur(r.p)) + '</span></' + (r.held ? 'button' : 'div') + '>').join('') + '</div>'
      : '<p class="muted">Nog geen koersresultaat in deze periode.</p>') +
    '<p class="sub" style="margin-top:8px">Koerswinst of -verlies per positie, zonder aan- en verkopen en zonder dividend. Ook posities die je inmiddels verkocht hebt.</p></section>';
}

// ---------- Gerealiseerd en ongerealiseerd per positie ----------
function realUnrealTile() {
  const per = new Map();
  M.companies.forEach((c) => per.set(c.tk, { tk: c.tk, name: c.name, held: true, unreal: isNum(c.unreal) ? c.unreal : 0, real: 0, div: 0, fees: 0 }));
  M.tx.perTk.forEach((x) => { const o = per.get(x.tk) || { tk: x.tk, name: x.name, held: false, unreal: 0, real: 0, div: 0, fees: 0 }; o.real += x.realised || 0; o.fees += x.fees || 0; per.set(x.tk, o); });
  M.ev.byTk.forEach((v, tk) => { const o = per.get(tk) || { tk, name: tk, held: false, unreal: 0, real: 0, div: 0, fees: 0 }; o.div += v; per.set(tk, o); });
  const rows = [...per.values()].map((o) => Object.assign(o, { tot: o.unreal + o.real + o.div })).sort((a, b) => b.tot - a.tot);
  const S = (k) => sum(rows.map((r) => r[k]));
  const cell = (v) => '<td class="num ' + tone(v) + '">' + esc(v ? seur(v) : '–') + '</td>';
  return '<section class="tile pad full"><h3>Gerealiseerd en ongerealiseerd per positie</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Positie</th><th class="num">' + trm('Ongerealiseerd', 'unreal') + '</th><th class="num">' + trm('Gerealiseerd', 'real') + '</th><th class="num">Dividend</th><th class="num">Samen</th><th class="num">Kosten</th></tr></thead><tbody>' +
    rows.map((r) => '<tr' + (r.held ? ' class="rowlink" data-ticker="' + esc(r.tk) + '"' : '') + '><td class="co"><b>' + esc(r.tk) + '</b>' + (r.held ? '' : ' <span class="tag">gesloten</span>') + '<span class="nm">' + esc(r.name) + '</span></td>' +
      cell(r.unreal) + cell(r.real) + cell(r.div) + '<td class="num ' + tone(r.tot) + '"><b>' + esc(seur(r.tot)) + '</b></td><td class="num">' + esc(r.fees ? eur(r.fees) : '–') + '</td></tr>').join('') +
    '<tr class="sum"><td><b>Totaal</b></td>' + cell(S('unreal')) + cell(S('real')) + cell(S('div')) + '<td class="num ' + tone(S('tot')) + '"><b>' + esc(seur(S('tot'))) + '</b></td><td class="num">' + esc(eur(S('fees'))) + '</td></tr>' +
    '</tbody></table></div><p class="sub" style="margin-top:8px">Trading 212 rekent met de gemiddelde aankoopprijs. Gerealiseerd en kosten per order volgens Trading 212; dividend netto zoals ontvangen.</p></section>';
}

// ---------- Kalender van een heel jaar ----------
function yearHeatTile() {
  const R = twrReturns(TOTAL);
  if (R.length < 5) return '';
  const years = [...new Set(R.map((p) => new Date(p.t).getFullYear()))].sort((a, b) => b - a);
  const Y = anState.heatYear && years.includes(anState.heatYear) ? anState.heatYear : years[0];
  const map = new Map(R.map((p) => [dayKey(p.t), p.r]));
  const start = new Date(Y, 0, 1); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  let cells = '';
  const monthAt = [];
  for (let w = 0; w < 53; w++) {
    for (let d = 0; d < 5; d++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
      if (d === 0 && day.getDate() <= 7 && day.getFullYear() === Y) monthAt.push([w, day.getMonth()]);
      const r = map.get(dayKey(day.getTime()));
      if (day.getFullYear() !== Y) cells += '<span class="off"></span>';
      else if (isNum(r)) cells += '<span class="' + heatCls(r) + '" data-tip="' + esc(fD.format(day) + ': ' + spct(r)) + '"></span>';
      else cells += '<span data-tip="' + esc(fD.format(day) + ': geen meting') + '"></span>';
    }
  }
  const months = [];
  for (let m = 0; m < 12; m++) {
    const ps = R.filter((p) => { const d = new Date(p.t); return d.getFullYear() === Y && d.getMonth() === m; });
    months.push(ps.length ? ps.reduce((a, p) => a * (1 + p.r), 1) - 1 : null);
  }
  return '<section class="tile pad full yheat-tile"><div class="plan-head"><h3>Elke dag van ' + Y + '</h3>' + segX('anHeatYear', years.slice(0, 4).map((y) => [String(y), String(y)]), String(Y), 'Jaar') + '</div>' +
    '<div class="yheat-wrap"><div class="yheat-m" aria-hidden="true">' + monthAt.map(([w, m]) => '<span style="grid-column:' + (w + 1) + '">' + esc(fMon.format(new Date(Y, m, 1)).replace('.', '')) + '</span>').join('') + '</div>' +
    '<div class="yheat" role="img" aria-label="' + esc('Resultaat per dag in ' + Y) + '">' + cells + '</div></div>' +
    '<div class="ymonths">' + months.map((v, m) => '<div><span class="muted small">' + esc(fMon.format(new Date(Y, m, 1)).replace('.', '')) + '</span><b class="' + tone(v) + '">' + esc(isNum(v) ? spct1(v) : '–') + '</b></div>').join('') + '</div>' +
    '<div class="heat-key" aria-hidden="true">gedaald <i class="heat-l3"></i><i class="heat-l2"></i><i class="heat-l1"></i><i class="heat-g1"></i><i class="heat-g2"></i><i class="heat-g3"></i> gestegen</div>' +
    '<p class="sub" style="margin-top:6px">Tijdgewogen dagresultaat van je beleggingen; per maand samengesteld.</p></section>';
}

// ---------- Twee periodes vergelijken ----------
const PCHOICES = [['1m', '30 dagen'], ['3m', '3 maanden'], ['ytd', 'Dit jaar'], ['prev', 'Vorig jaar'], ['12m', '12 maanden']];
function periodRange(k) {
  const n = new Date(), t = n.getTime();
  if (k === '1m') return [t - 30 * DAY, t, '30 dagen'];
  if (k === '3m') return [t - 91 * DAY, t, '3 maanden'];
  if (k === '12m') return [t - 365 * DAY, t, '12 maanden'];
  if (k === 'prev') return [new Date(n.getFullYear() - 1, 0, 1).getTime(), new Date(n.getFullYear(), 0, 1).getTime() - 1, String(n.getFullYear() - 1)];
  const m = /^c:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(k || '');
  if (m) return [ymd(m[1]), ymd(m[2]) + DAY - 1, fDM.format(ymd(m[1])) + ' – ' + fDM.format(ymd(m[2]))];
  return [new Date(n.getFullYear(), 0, 1).getTime(), t, 'dit jaar'];
}
function periodStats(k) {
  const [a, b, label] = periodRange(k);
  const T = twrSeries(TOTAL).filter((p) => p.t >= a - DAY && p.t <= b);
  if (T.length < 3) return { label, empty: true };
  const R = T.slice(1).filter((p) => isNum(p.r));
  let idx = 1, peak = 1, mdd = 0;
  const line = [{ i: 0, v: 0 }];
  R.forEach((p, i) => { idx *= 1 + p.r; peak = Math.max(peak, idx); mdd = Math.min(mdd, idx / peak - 1); line.push({ i: i + 1, v: idx - 1 }); });
  const best = R.reduce((x, p) => (!x || p.r > x.r ? p : x), null), worst = R.reduce((x, p) => (!x || p.r < x.r ? p : x), null);
  const dep = sum(M.weeks.filter((w) => w.t >= a && w.t <= b && isNum(w.newDeposits)).map((w) => w.newDeposits));
  const div = sum(M.ev.received.filter((d) => d.t >= a && d.t <= b).map((d) => d.amount));
  return { label, ret: idx - 1, vol: R.length > 4 ? stdev(R.map((p) => p.r)) * Math.sqrt(252) : null, mdd, best, worst, dep, div, n: R.length, line };
}
function periodCmpTile() {
  const A = periodStats(anState.pA), B = periodStats(anState.pB);
  const col = (S) => S.empty ? ['–', '–', '–', '–', '–', '–', '–'] : [spct1(S.ret), isNum(S.vol) ? P1.format(S.vol) : '–', spct1(S.mdd), S.best ? spct(S.best.r) + ' (' + fDM.format(S.best.t) + ')' : '–', S.worst ? spct(S.worst.r) + ' (' + fDM.format(S.worst.t) + ')' : '–', eur(S.dep), eur(S.div)];
  const ca = col(A), cb = col(B);
  const labels = ['Rendement (tijdgewogen)', 'Beweeglijkheid per jaar', 'Grootste daling', 'Beste dag', 'Slechtste dag', 'Gestort', 'Dividend'];
  const own = (key) => '<span class="pc-own"><input type="date" data-pc-own="' + key + '-from" aria-label="Eigen periode, van"><input type="date" data-pc-own="' + key + '-to" aria-label="Eigen periode, tot"></span>';
  return '<section class="tile pad full"><h3>Twee periodes vergelijken</h3>' +
    '<div class="pc-pick"><div><span class="muted small">Periode A</span>' + segX('anPA', PCHOICES, anState.pA, 'Periode A') + own('A') + '</div>' +
    '<div><span class="muted small">Periode B</span>' + segX('anPB', PCHOICES, anState.pB, 'Periode B') + own('B') + '</div></div>' +
    '<div class="chart" data-chart="pcmp" style="height:170px;margin-top:10px"></div>' +
    '<div class="legend chart-legend" style="margin-top:6px"><span><i style="background:' + C.accent + '"></i>A: ' + esc(A.label) + '</span><span><i class="dash"></i>B: ' + esc(B.label) + '</span></div>' +
    '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th><span class="sr-only">Kenmerk</span></th><th class="num">A: ' + esc(A.label) + '</th><th class="num">B: ' + esc(B.label) + '</th></tr></thead><tbody>' +
    labels.map((l, i) => '<tr><td>' + esc(l) + '</td><td class="num">' + esc(ca[i]) + '</td><td class="num">' + esc(cb[i]) + '</td></tr>').join('') + '</tbody></table></div>' +
    '<p class="sub" style="margin-top:8px">De grafiek legt beide periodes op dag 1 naast elkaar. Kies een eigen periode met de twee datums.</p></section>';
}
function drawPeriodCmp(root) {
  const host = root.querySelector('[data-chart="pcmp"]');
  if (!host) return;
  const A = periodStats(anState.pA), B = periodStats(anState.pB);
  if (A.empty && B.empty) { host.innerHTML = '<p class="chart-empty">Nog te weinig metingen in deze periodes.</p>'; return; }
  const n = Math.max(A.line ? A.line.length : 0, B.line ? B.line.length : 0);
  const pts = (S) => (S.line || []).map((p) => ({ t: p.i * DAY, v: p.v }));
  const base = Array.from({ length: n }, (_, i) => ({ t: i * DAY, v: null }));
  const a = pts(A), b = pts(B);
  const main = a.length >= b.length ? a : b.map((p) => ({ t: p.t, v: null })).map((p, i) => (a[i] ? a[i] : p));
  lineChart(host, [{ pts: main.length ? main : base, color: C.accent, width: 3, label: 'A', fmt: spct1 }, { pts: b, color: C.ink2, dash: true, width: 2, label: 'B', fmt: spct1 }],
    { zero: true, top: 0.08, bottom: 0.08, tfmt: (t) => 'handelsdag ' + (Math.round(t / DAY) + 1), fmt: spct1 });
}
document.addEventListener('change', (e) => {
  const el = e.target.closest && e.target.closest('[data-pc-own]');
  if (!el) return;
  const key = el.dataset.pcOwn.slice(0, 1);
  const box = el.closest('.pc-own');
  const f = box.querySelector('[data-pc-own$="from"]').value, t = box.querySelector('[data-pc-own$="to"]').value;
  if (f && t && f < t) { anState['p' + key] = 'c:' + f + ':' + t; refresh('analyse'); }
});

// ---------- Wisselkosten ----------
function fxFeeTile() {
  const tr = M.tx.trades.filter((x) => isNum(x.net) && x.net > 0);
  if (!tr.length) return '';
  const byCur = new Map(), byYear = new Map();
  tr.forEach((x) => {
    const cur = x.cur || 'EUR';
    const o = byCur.get(cur) || { cur, n: 0, vol: 0, fx: 0 }; o.n++; o.vol += x.net; o.fx += x.feeFx || 0; byCur.set(cur, o);
    const y = new Date(x.t).getFullYear();
    const p = byYear.get(y) || { y, vol: 0, fx: 0, foreign: 0 }; p.fx += x.feeFx || 0; p.vol += x.net; if (cur !== 'EUR') p.foreign += x.net; byYear.set(y, p);
  });
  const tot = sum([...byCur.values()].map((o) => o.fx));
  const foreign = sum([...byCur.values()].filter((o) => o.cur !== 'EUR').map((o) => o.vol));
  return '<section class="tile pad"><h3>Wisselkosten</h3><div class="fx-head"><span class="v big">' + esc(eur(tot)) + '</span><span class="muted small">betaald aan ' + trm('wisselkosten', 'fxfee') + ' in totaal</span></div>' +
    '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Jaar</th><th class="num">Niet in euro</th><th class="num">Wisselkosten</th><th class="num">Verwacht (0,15%)</th></tr></thead><tbody>' +
    [...byYear.values()].sort((a, b) => b.y - a.y).map((p) => '<tr><td>' + p.y + '</td><td class="num">' + esc(eur(p.foreign)) + '</td><td class="num">' + esc(eur(p.fx)) + '</td><td class="num">' + esc(eur(p.foreign * 0.0015)) + '</td></tr>').join('') + '</tbody></table></div>' +
    '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Munt</th><th class="num">Orders</th><th class="num">Omgezet</th><th class="num">Wisselkosten</th></tr></thead><tbody>' +
    [...byCur.values()].sort((a, b) => b.vol - a.vol).map((o) => '<tr><td>' + esc(o.cur) + '</td><td class="num">' + o.n + '</td><td class="num">' + esc(eur(o.vol)) + '</td><td class="num">' + esc(o.fx ? eur(o.fx) + ' (' + P2.format(o.fx / o.vol) + ')' : '–') + '</td></tr>').join('') + '</tbody></table></div>' +
    '<p class="sub" style="margin-top:8px">Trading 212 rekent 0,15% bij kopen en verkopen in een andere munt dan euro. ' + (foreign ? 'Wat scheelt: fondsen of aandelen die in euro noteren (bijv. op Xetra of Euronext).' : '') + '</p></section>';
}

// ---------- Concentratie: te veel in één aandeel of sector ----------
function concLimits() { const p = userPrefs(); return { pos: isNum(p.concPos) ? p.concPos : 20, sec: isNum(p.concSec) ? p.concSec : 40 }; }
function concModel() {
  if (!M || !M.companies.length) return [];
  const L = concLimits(), tot = M.totalValue || 0;
  if (!tot) return [];
  const out = [];
  M.companies.filter((c) => !isFundC(c)).forEach((c) => { if (c.value / tot * 100 > L.pos) out.push({ kind: 'aandeel', label: c.tk, w: c.value / tot, lim: L.pos }); });
  allocItems('sector').filter((x) => x.key !== '@funds' && x.key !== '@unknown').forEach((x) => { if (x.w * 100 > L.sec) out.push({ kind: 'sector', label: x.label, w: x.w, lim: L.sec }); });
  return out;
}
function concTile() {
  const L = concLimits(), Q = concModel();
  return '<section class="tile pad"><h3>Concentratie</h3>' +
    (Q.length ? '<ul class="conc-list">' + Q.map((q) => '<li class="loss"><b>' + esc(q.label) + '</b> (' + esc(q.kind) + '): ' + esc(P1.format(q.w)) + ' van je beleggingen, boven je grens van ' + q.lim + '%</li>').join('') + '</ul>'
      : '<p class="small gain">Geen aandeel of sector boven je grenzen.</p>') +
    '<div class="plan-inputs" style="margin-top:10px"><label>Grens per aandeel<span class="eur-in"><input type="number" min="1" max="100" step="1" data-conc="pos" value="' + L.pos + '">%</span></label>' +
    '<label>Grens per sector<span class="eur-in"><input type="number" min="1" max="100" step="1" data-conc="sec" value="' + L.sec + '">%</span></label>' +
    '<button type="button" class="btn ghost" data-conc-save>Bewaren</button></div>' +
    '<p class="sub" style="margin-top:8px">Fondsen tellen niet mee per aandeel: die zijn zelf al gespreid. Boven een grens zie je ook een melding op het overzicht. Geen beleggingsadvies.</p></section>';
}
function concNote() {
  if (!M || sharedView) return '';
  const Q = concModel();
  if (!Q.length) return '';
  return '<a class="drift-note conc-note" href="#analyse"><b>Veel in één ' + (Q[0].kind === 'sector' ? 'sector' : 'aandeel') + '</b><span>' + esc(Q.slice(0, 3).map((q) => q.label + ' ' + P1.format(q.w)).join(', ')) + ' – boven je eigen grens.</span><span class="more" aria-hidden="true">Naar Analyse ›</span></a>';
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-conc-save]');
  if (!b) return;
  const box = b.closest('.tile');
  const v = (k) => Number(box.querySelector('[data-conc="' + k + '"]').value);
  try { await savePrefs({ concPos: Math.max(1, Math.min(100, v('pos') || 20)), concSec: Math.max(1, Math.min(100, v('sec') || 40)) }); rerenderAll(); } catch (err) { /* blijft staan */ }
});

// ---------- Trading 212-pies ----------
function piesTile() {
  const P = data.ext2 && data.ext2.pies;
  if (!P || !(P.list || []).length) return '';
  return '<section class="tile pad full"><h3>Je pies</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pie</th><th class="num">Ingelegd</th><th class="num">Waarde</th><th class="num">Resultaat</th><th class="num">Dividend</th><th>Grootste delen</th></tr></thead><tbody>' +
    P.list.map((p) => '<tr><td><b>' + esc(p.name || 'Pie ' + p.id) + '</b>' + (p.goal ? '<span class="sub">doel ' + esc(eur(p.goal)) + (isNum(p.progress) ? ', ' + P1.format(p.progress) + ' bereikt' : '') + '</span>' : '') + '</td>' +
      '<td class="num">' + esc(eur(p.invested)) + '</td><td class="num">' + esc(eur(p.value)) + '</td><td class="num ' + tone(p.result) + '">' + esc(seur(p.result)) + (isNum(p.resultPct) ? '<span class="sub">' + esc(spct1(p.resultPct)) + '</span>' : '') + '</td>' +
      '<td class="num">' + esc(p.divGained ? eur(p.divGained) : '–') + '</td><td class="small">' + esc((p.instruments || []).slice().sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, 4).map((x) => x.tk + ' ' + (isNum(x.share) ? P1.format(x.share) : '') + (isNum(x.target) ? ' (doel ' + P1.format(x.target) + ')' : '')).join(', ') || 'details volgen') + '</td></tr>').join('') +
    '</tbody></table></div><p class="sub" style="margin-top:8px">Volgens Trading 212, één keer per dag bijgewerkt. Namen en verdeling per pie komen er stap voor stap bij.</p></section>';
}

// ---------- Jaar in beeld (zoals een "Wrapped") ----------
function wrappedModel(Y) {
  const a = new Date(Y, 0, 1).getTime(), b = new Date(Y + 1, 0, 1).getTime();
  const R = twrReturns(TOTAL).filter((p) => p.t >= a && p.t < b);
  if (R.length < 5) return null;
  const ret = R.reduce((x, p) => x * (1 + p.r), 1) - 1;
  const best = R.reduce((x, p) => (!x || p.r > x.r ? p : x), null), worst = R.reduce((x, p) => (!x || p.r < x.r ? p : x), null);
  const yr = Y === new Date().getFullYear() ? 'ytd' : null;
  const cm = yr ? contribModel('ytd') : null;
  const top = cm && cm.rows.length ? cm.rows[0] : null;
  const divs = sum(M.ev.received.filter((d) => d.t >= a && d.t < b).map((d) => d.amount));
  const dep = new Map();
  M.weeks.filter((w) => w.t >= a && w.t < b && isNum(w.newDeposits) && w.newDeposits > 0).forEach((w) => dep.set(new Date(w.t).getMonth(), true));
  let streak = 0, run = 0;
  for (let m = 0; m < 12; m++) { if (dep.has(m)) { run++; streak = Math.max(streak, run); } else run = 0; }
  const trades = M.tx.trades.filter((x) => x.t >= a && x.t < b).length;
  return { Y, ret, best, worst, top, divs, streak, trades, deposited: sum(M.weeks.filter((w) => w.t >= a && w.t < b && isNum(w.newDeposits)).map((w) => w.newDeposits)) };
}
function wrappedTile() {
  const ys = [...new Set(twrReturns(TOTAL).map((p) => new Date(p.t).getFullYear()))].sort((a, b) => b - a);
  if (!ys.length) return '';
  const Y = anState.wrapYear && ys.includes(anState.wrapYear) ? anState.wrapYear : ys[0];
  const W = wrappedModel(Y);
  if (!W) return '';
  const card = (k, v, s, cls) => '<div class="wr-c"><span class="muted small">' + esc(k) + '</span><b class="' + (cls || '') + '">' + esc(v) + '</b>' + (s ? '<span class="small muted">' + esc(s) + '</span>' : '') + '</div>';
  return '<section class="tile pad full wrapped"><div class="plan-head"><h3>Jouw ' + Y + ' in beeld</h3>' + segX('anWrapYear', ys.slice(0, 3).map((y) => [String(y), String(y)]), String(Y), 'Jaar') + '</div>' +
    '<div class="wr-grid">' + card('Rendement', spct1(W.ret), 'tijdgewogen', tone(W.ret)) +
    card('Beste aandeel', W.top ? W.top.tk : '–', W.top ? seur(W.top.p) : 'alleen voor dit jaar', W.top ? tone(W.top.p) : '') +
    card('Dividend ontvangen', eur(W.divs), '') + card('Langste reeks inleggen', W.streak + (W.streak === 1 ? ' maand' : ' maanden') + ' op rij', 'gestort: ' + eur(W.deposited)) +
    card('Beste dag', W.best ? spct(W.best.r) : '–', W.best ? fDM.format(W.best.t) : '', 'gain') + card('Slechtste dag', W.worst ? spct(W.worst.r) : '–', W.worst ? fDM.format(W.worst.t) : '', 'loss') +
    card('Aan- en verkopen', String(W.trades), '') + '</div>' +
    '<div class="exp" style="margin-top:10px"><button type="button" class="btn ghost" data-wrapped-png="' + Y + '">Als afbeelding opslaan</button><label class="check small"><input type="checkbox" data-wrapped-hide' + (hideAmounts ? ' checked' : '') + '> Zonder bedragen</label></div></section>';
}
function paintWrapped(W, hide) {
  const cv = document.createElement('canvas');
  cv.width = 1080; cv.height = 1350;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 1080, 1350); grd.addColorStop(0, '#1F3F99'); grd.addColorStop(1, '#2B5BD7');
  g.fillStyle = grd; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = '#fff'; g.font = '600 44px Inter, system-ui, sans-serif'; g.fillText('Mijn beleggingsjaar', 80, 140);
  g.font = '800 160px Inter, system-ui, sans-serif'; g.fillText(String(W.Y), 80, 310);
  const rows = [['Rendement', spct1(W.ret)], ['Beste aandeel', W.top ? W.top.tk : '–'], ['Dividend', hide ? '••••' : EUR.format(W.divs)],
    ['Inleggen op rij', W.streak + ' maanden'], ['Beste dag', W.best ? spct(W.best.r) : '–'], ['Aan- en verkopen', String(W.trades)]];
  rows.forEach(([k, v], i) => {
    const y = 470 + i * 140;
    g.globalAlpha = 0.75; g.font = '500 36px Inter, system-ui, sans-serif'; g.fillText(k, 80, y);
    g.globalAlpha = 1; g.font = '700 64px Inter, system-ui, sans-serif'; g.fillText(v, 80, y + 70);
  });
  g.globalAlpha = 0.6; g.font = '400 28px Inter, system-ui, sans-serif'; g.fillText('Investeringstracker · geen beleggingsadvies', 80, 1300);
  return cv;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-wrapped-png]');
  if (!b) return;
  const W = wrappedModel(Number(b.dataset.wrappedPng));
  if (!W) return;
  const hide = !!(b.closest('.tile').querySelector('[data-wrapped-hide]') || {}).checked;
  paintWrapped(W, hide).toBlob((blob) => { if (!blob) return; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mijn-jaar-' + W.Y + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); });
});

// =====================================================================
// ---------- Plannen: kans om je doelen te halen (Monte Carlo, in een aparte thread) ----------
// Deze functie draait in een Web Worker en mag dus niets van buiten gebruiken
function mcSimulate(o) {
  let s = o.seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const mu = Math.log(1 + o.mu) / 12, sig = o.sigma / Math.sqrt(12);
  const step = 3, keep = Math.floor(o.months / step) + 1;
  const paths = Array.from({ length: keep }, () => new Float64Array(o.runs));
  const hit = o.targets.map(() => 0);
  for (let r = 0; r < o.runs; r++) {
    let v = o.start;
    paths[0][r] = v;
    const got = o.targets.map(() => false);
    for (let m = 1; m <= o.months; m++) {
      v = v * Math.exp(mu - sig * sig / 2 + sig * gauss()) + o.monthly;
      o.targets.forEach((tg, i) => { if (!got[i] && m <= tg.month && v * tg.share >= tg.amount) got[i] = true; });
      if (m % step === 0) paths[m / step][r] = v;
    }
    got.forEach((g, i) => { if (g) hit[i]++; });
  }
  const pct = (a, q) => { const b = Array.from(a).sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };
  return { band: paths.map((a, i) => ({ m: i * step, p10: pct(a, 0.1), p50: pct(a, 0.5), p90: pct(a, 0.9) })), probs: hit.map((h) => h / o.runs) };
}
// Draai een losse functie in een Web Worker; zonder Workers (of bij een fout) gewoon hier
function runOffThread(fn, input) {
  return new Promise((resolve) => {
    let w = null, url = null;
    try {
      url = URL.createObjectURL(new Blob(['self.onmessage=function(e){self.postMessage((' + fn.toString() + ')(e.data));};'], { type: 'text/javascript' }));
      w = new Worker(url);
    } catch (e) { if (url) URL.revokeObjectURL(url); resolve(fn(input)); return; }
    const done = (v) => { w.terminate(); URL.revokeObjectURL(url); resolve(v); };
    w.onmessage = (e) => done(e.data);
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); w.terminate(); URL.revokeObjectURL(url); resolve(fn(input)); };
    w.postMessage(input);
  });
}
function mcInput() {
  const R = ratiosFor(TOTAL);
  const sigma = R && isNum(R.vol) ? Math.max(0.08, Math.min(0.35, R.vol)) : 0.16;
  const monthly = isNum(M.settings.monthly) ? M.settings.monthly : monthlyGuess();
  const years = Math.max(5, Math.min(40, plan.years || M.settings.years || 10));
  const now = new Date();
  const targets = goalsOf().map((g) => {
    const due = g.date ? new Date(g.date.length === 7 ? g.date + '-01' : g.date) : new Date(now.getFullYear() + years, now.getMonth(), 1);
    return { name: g.name, amount: g.target, share: (g.share || 0) / 100, month: Math.max(1, Math.round((due - now) / (30.44 * DAY))) };
  }).filter((t) => t.share > 0);
  if (M.settings.goal > 0) targets.push({ name: 'Doelbedrag vooruitblik', amount: M.settings.goal, share: 1, month: years * 12 });
  const months = Math.max(years * 12, ...targets.map((t) => t.month));
  return { start: M.accountNow || 0, monthly, months: Math.min(months, 480), mu: 0.07, sigma, runs: 2000, seed: 20261117, targets };
}
function mcTile() {
  const I = mcInput();
  const key = JSON.stringify(I);
  if (anState.mcKey !== key && !anState.mcBusy) {
    anState.mcBusy = true;
    runOffThread(mcSimulate, I).then((res) => { anState.mcRes = res; anState.mcKey = key; anState.mcBusy = false; refresh('plan'); });
  }
  const R = anState.mcKey === key ? anState.mcRes : null;
  const end = R ? R.band[R.band.length - 1] : null;
  return '<section class="tile pad mc"><h3>' + trm('Kans om je doelen te halen', 'montecarlo') + '</h3>' +
    (R ? '<div class="chart" data-chart="mc" style="height:190px"></div><div class="xlabels" data-x="mc"></div>' +
      '<div class="legend chart-legend" style="margin-top:6px"><span><i style="background:' + C.accent + '"></i>Middelste uitkomst</span><span><i style="background:' + C.soft + '"></i>8 van de 10 uitkomsten</span></div>' +
      '<p class="small" style="margin-top:8px">Na ' + Math.round(I.months / 12) + ' jaar: tussen <b>' + esc(eur(end.p10)) + '</b> en <b>' + esc(eur(end.p90)) + '</b>, middelste uitkomst <b>' + esc(eur(end.p50)) + '</b>.</p>' +
      (I.targets.length ? '<div class="goal-probs">' + I.targets.map((t, i) => '<div><span>' + esc(t.name) + ' (' + esc(eur(t.amount)) + ')</span><div class="meter"><div style="width:' + (R.probs[i] * 100).toFixed(0) + '%"></div></div><b>' + esc(NI.format(R.probs[i] * 100)) + '%</b></div>').join('') + '</div>'
        : '<p class="small muted">Stel bij Doelen of de vooruitblik een doel in om de kans te zien.</p>')
      : '<p class="muted">Bezig met rekenen (2.000 mogelijke toekomsten)…</p>') +
    '<p class="sub" style="margin-top:8px">2.000 willekeurige toekomsten met gemiddeld 7% per jaar en een beweeglijkheid van ' + esc(P1.format(I.sigma)) + ' (' + (ratiosFor(TOTAL) ? 'je eigen portefeuille, begrensd' : 'aangenomen') + '), ' + esc(eur(I.monthly)) + ' inleg per maand. Rekenvoorbeeld, geen belofte.</p></section>';
}
function drawMc(root) {
  const host = root.querySelector('[data-chart="mc"]');
  const R = anState.mcRes;
  if (!host || !R) return;
  const now = new Date();
  const t = (m) => new Date(now.getFullYear(), now.getMonth() + m, 1).getTime();
  const pick = (k) => R.band.map((b) => ({ t: t(b.m), v: b[k] }));
  lineChart(host, [{ pts: pick('p50'), color: C.accent, width: 3, label: 'Midden' }, { pts: pick('p90'), color: C.soft, width: 2, label: 'Gunstig (1 op 10)' }, { pts: pick('p10'), color: C.soft, width: 2, label: 'Ongunstig (1 op 10)' }],
    { top: 0.06, bottom: 0.04, xl: root.querySelector('[data-x="mc"]'), xcount: 4, xfmt: (x) => fYear(x), tfmt: (x) => fMonY.format(x) });
}

// ---------- FIRE: wanneer je vermogen je vaste lasten kan dragen ----------
function fireTile() {
  const P = userPrefs();
  const costs = isNum(P.fireCosts) ? P.fireCosts : 2000;
  const wr = anState.fireWr;
  const need = costs * 12 / wr;
  const have = M.accountNow || 0;
  const monthly = isNum(M.settings.monthly) ? M.settings.monthly : monthlyGuess();
  const k = goalEta(have, monthly, need);
  const value = M.totalValue || 0;
  const dy = value > 0 && M.ev.last12 > 0 ? M.ev.last12 / value : null;
  const eta = k == null ? null : new Date(new Date().getFullYear(), new Date().getMonth() + k, 1);
  return '<section class="tile pad"><h3>' + trm('Financieel onafhankelijk (FIRE)', 'fire') + '</h3>' +
    '<div class="plan-inputs"><label>Vaste lasten per maand<span class="eur-in">€<input type="number" min="0" step="50" data-fire-costs value="' + costs + '"></span></label>' +
    segX('anFireWr', [['0.03', '3%'], ['0.035', '3,5%'], ['0.04', '4%']], String(wr), 'Opnamepercentage') + '</div>' +
    '<div class="fx-head" style="margin-top:8px"><span class="v big">' + esc(eur(need)) + '</span><span class="muted small">nodig bij ' + esc(P1.format(wr)) + ' per jaar opnemen</span></div>' +
    '<div class="meter"><div style="width:' + Math.min(100, have / need * 100).toFixed(1) + '%"></div></div>' +
    kvList([
      ['Nu', eur(have) + ' (' + P1.format(have / need) + ')'],
      ['Haalbaar rond', k === 0 ? 'nu al' : eta ? new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(eta) : 'niet binnen 60 jaar'],
      ['Dividend nu per maand', eur((M.ev.last12 || 0) / 12)],
      ['Alleen van dividend', isNum(dy) ? eur(costs * 12 / dy) + ' nodig bij ' + P2.format(dy) + ' dividendrendement' : '–'],
    ]) + '<p class="sub" style="margin-top:8px">Bij ' + esc(eur(monthly)) + ' inleg per maand en 7% per jaar. De opnameregel (3 tot 4% per jaar) komt uit Amerikaans onderzoek; houd rekening met belasting en inflatie. Rekenvoorbeeld, geen advies.</p></section>';
}
document.addEventListener('change', async (e) => {
  const el = e.target.closest && e.target.closest('[data-fire-costs]');
  if (!el) return;
  const v = Number(el.value);
  if (v >= 0) { try { await savePrefs({ fireCosts: v }); refresh('plan'); } catch (err) { /* blijft */ } }
});

// ---------- Maandelijks inleggen, teruggerekend ----------
function dcaChoices() {
  const out = [['SP500', 'S&P 500'], ['NASDAQ100', 'Nasdaq-100']];
  if (M.mk.ok) {
    const seen = new Set();
    M.companies.forEach((c) => { const s = M.mk.sym(c.tk); if (!seen.has(s) && M.mk.prices(s).length > 120) { seen.add(s); out.push([s, c.tk]); } });
    BENCH_OPTS.filter((b) => b[2] === 'sym').forEach((b) => { if (!seen.has(b[0]) && M.mk.prices(b[0]).length > 120) out.push([b[0], b[1]]); });
  }
  return out;
}
function dcaModel(sym, amt, months) {
  const pts = sym === 'SP500' || sym === 'NASDAQ100' ? indexEur(sym) : benchPts(sym);
  if (pts.length < 40) return null;
  const last = pts[pts.length - 1];
  const start = new Date(last.t); start.setMonth(start.getMonth() - months + 1); start.setDate(1);
  let units = 0, inv = 0;
  const line = [], flows = [];
  for (let k = 0; k < months; k++) {
    const d = new Date(start.getFullYear(), start.getMonth() + k, 1).getTime();
    const p = pts.find((x) => x.t >= d);
    if (!p || p.t > last.t) break;
    units += amt / p.v; inv += amt; flows.push({ t: p.t, v: -amt });
    line.push({ t: p.t, v: units * p.v, inv });
  }
  if (line.length < 2) return null;
  const now = units * last.v;
  const first = pts.find((x) => x.t >= line[0].t);
  const lump = inv / first.v * last.v;
  return { now, inv, lump, line: line.concat([{ t: last.t + HOUR, v: now, inv }]), x: xirrOf(flows.concat([{ t: last.t + HOUR, v: now }])), n: line.length };
}
function dcaTile() {
  const ch = dcaChoices();
  if (!ch.some((c) => c[0] === anState.dcaSym)) anState.dcaSym = ch[0][0];
  const D = dcaModel(anState.dcaSym, anState.dcaAmt, anState.dcaMonths);
  return '<section class="tile pad"><div class="plan-head"><h3>Elke maand inleggen, teruggerekend</h3></div>' +
    '<div class="seg light wrap" role="group" aria-label="Belegging">' + ch.map((c) => '<button type="button" data-dca-sym="' + esc(c[0]) + '" aria-pressed="' + (c[0] === anState.dcaSym) + '">' + esc(c[1]) + '</button>').join('') + '</div>' +
    '<div class="plan-inputs" style="margin-top:8px"><label>Per maand<span class="eur-in">€<input type="number" min="10" step="10" data-dca-amt value="' + anState.dcaAmt + '"></span></label>' +
    segX('anDcaMonths', [['6', '6 maanden'], ['12', '12 maanden']], String(anState.dcaMonths), 'Periode') + '</div>' +
    (D ? '<div class="chart" data-chart="dca" style="height:160px;margin-top:8px"></div><div class="xlabels" data-x="dca"></div>' + kvList([
      ['Ingelegd', eur(D.inv) + ' in ' + D.n + ' keer'],
      ['Waarde nu', eur(D.now) + ' (' + spct1(D.now / D.inv - 1) + ')', tone(D.now - D.inv)],
      ['Rendement per jaar (XIRR)', isNum(D.x) ? spct1(D.x) : '–', tone(D.x)],
      ['Alles in één keer aan het begin', eur(D.lump) + ' (' + seur(D.lump - D.now) + ' tegenover maandelijks)', tone(D.lump - D.now)],
    ]) : '<p class="muted" style="margin-top:8px">Nog te weinig koersgeschiedenis voor deze belegging.</p>') +
    '<p class="sub" style="margin-top:8px">Aankoop op de eerste handelsdag van elke maand, in euro, zonder kosten en dividend. Wat in het verleden gebeurde, zegt niets over de toekomst.</p></section>';
}
function drawDca(root) {
  const host = root.querySelector('[data-chart="dca"]');
  const D = host && dcaModel(anState.dcaSym, anState.dcaAmt, anState.dcaMonths);
  if (!D) return;
  lineChart(host, [{ pts: D.line.map((p) => ({ t: p.t, v: p.v })), color: C.accent, width: 3, area: true, label: 'Waarde' }, { pts: D.line.map((p) => ({ t: p.t, v: p.inv })), color: C.ink2, dash: true, width: 2, label: 'Ingelegd' }],
    { top: 0.06, bottom: 0.04, xl: root.querySelector('[data-x="dca"]'), xcount: 3, xfmt: (t) => fMonY.format(t), tfmt: (t) => fD.format(t) });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-dca-sym]');
  if (b) { anState.dcaSym = b.dataset.dcaSym; refresh('plan'); }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest && e.target.closest('[data-dca-amt]');
  if (el && Number(el.value) > 0) { anState.dcaAmt = Number(el.value); refresh('plan'); }
});

// ---------- Dividend herbeleggen: wat je echte dividenden waard waren geweest ----------
function dripModel() {
  const rows = new Map();
  M.ev.received.forEach((d) => {
    const T = twrSeries(d.ticker);
    if (T.length < 2) return;
    const at = priceOn(T, d.t) || T[0];
    const now = T[T.length - 1].v;
    const o = rows.get(d.ticker) || { tk: d.ticker, paid: 0, worth: 0, n: 0 };
    o.paid += d.amount; o.worth += d.amount * now / at.v; o.n++;
    rows.set(d.ticker, o);
  });
  const list = [...rows.values()].sort((a, b) => b.worth - b.paid - (a.worth - a.paid));
  return { list, paid: sum(list.map((r) => r.paid)), worth: sum(list.map((r) => r.worth)) };
}
function dripTile() {
  const D = dripModel();
  if (!D.list.length) return '<section class="tile pad"><h3>Dividend herbeleggen</h3><p class="muted">Nog geen dividend ontvangen van posities die de tracker meet.</p></section>';
  return '<section class="tile pad"><h3>Had je je dividend herbelegd?</h3><div class="fx-head"><span class="v big ' + tone(D.worth - D.paid) + '">' + esc(seur(D.worth - D.paid)) + '</span><span class="muted small">verschil met ' + esc(eur(D.paid)) + ' ontvangen dividend</span></div>' +
    '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Aandeel</th><th class="num">Ontvangen</th><th class="num">Herbelegd nu</th></tr></thead><tbody>' +
    D.list.slice(0, 10).map((r) => '<tr><td><b>' + esc(r.tk) + '</b><span class="sub">' + r.n + ' keer</span></td><td class="num">' + esc(eur(r.paid)) + '</td><td class="num ' + tone(r.worth - r.paid) + '">' + esc(eur(r.worth)) + '</td></tr>').join('') + '</tbody></table></div>' +
    '<p class="sub" style="margin-top:8px">Alsof elk dividend op de dag van uitbetaling in hetzelfde aandeel was gestoken, met het tijdgewogen koersverloop sinds die dag. Zonder kosten.</p></section>';
}

// ---------- Herbalanceren met verkopen ----------
function rebalanceModel() {
  const mode = M.settings.targetMode || 'position';
  const t = M.settings.targets || {};
  const items = allocItems(mode);
  const withT = items.filter((x) => isNum(t[x.key]) && t[x.key] > 0);
  if (!withT.length) return null;
  const extra = anState.rebNew + (anState.rebCash && M.cash > 0 ? M.cash : 0);
  const total = sum(items.map((x) => x.v)) + extra;
  const band = 0.01 * total, min = 10;
  const rows = withT.map((x) => {
    const want = t[x.key] / 100 * total, d = want - x.v;
    const fee = mode === 'position' && curOfTk(x.key) !== 'EUR' ? Math.abs(d) * 0.0015 : 0;
    return { x, want, d: Math.abs(d) < Math.max(band, min) ? 0 : d, fee };
  });
  const sells = sum(rows.filter((r) => r.d < 0).map((r) => -r.d));
  const buysNeed = sum(rows.filter((r) => r.d > 0).map((r) => r.d));
  const cash = sells + extra;
  const short = Math.max(0, buysNeed - cash);
  return { mode, rows: rows.filter((r) => Math.abs(r.d) >= min).sort((a, b) => a.d - b.d), untouched: items.filter((x) => !withT.includes(x)).map((x) => x.label), fees: sum(rows.map((r) => r.fee)), extra, short };
}
function rebalanceTile() {
  const R = rebalanceModel();
  if (!R) return '<section class="tile pad"><h3>Herbalanceren met verkopen</h3><p class="muted">Stel eerst een streefverdeling in (bovenaan Plannen).</p></section>';
  return '<section class="tile pad"><h3>' + trm('Herbalanceren met verkopen', 'rebalance') + '</h3>' +
    '<div class="plan-inputs">' + segX('anRebNew', [['0', 'Geen inleg'], ['100', '€ 100'], ['500', '€ 500']], String(anState.rebNew), 'Nieuwe inleg') +
    '<label class="check small"><input type="checkbox" data-reb-cash' + (anState.rebCash ? ' checked' : '') + '> Ook mijn vrije saldo gebruiken' + (isNum(M.cash) ? ' (' + esc(eur(M.cash)) + ')' : '') + '</label></div>' +
    (R.rows.length ? '<div class="tx-list" style="margin-top:8px">' + R.rows.map((r) => '<div class="tx"><span class="tag ' + (r.d < 0 ? 'loss' : 'gain') + '">' + (r.d < 0 ? 'Verkoop' : 'Koop') + '</span><span class="tx-m"><b>' + esc(r.x.label) + '</b><span class="sub">nu ' + esc(eur(r.x.v)) + ', doel ' + esc(eur(r.want)) + '</span></span><span class="tx-v">' + esc(eur(Math.abs(r.d))) + (r.fee ? '<span class="sub">± ' + esc(eur(r.fee)) + ' wisselkosten</span>' : '') + '</span></div>').join('') + '</div>'
      : '<p class="small gain" style="margin-top:8px">Je zit binnen 1 procentpunt van je doel; niets te doen.</p>') +
    (R.short > 1 ? '<p class="small" style="margin-top:6px">Voor deze aankopen is nog <b>' + esc(eur(R.short)) + '</b> nodig: nieuwe inleg, je vrije saldo, of verkoop van posities zonder doel.</p>' : '') +
    (R.untouched.length ? '<p class="small muted" style="margin-top:6px">Zonder doel en dus ongemoeid: ' + esc(R.untouched.slice(0, 6).join(', ')) + (R.untouched.length > 6 ? ' …' : '') + '.</p>' : '') +
    '<p class="sub" style="margin-top:8px">Zo weinig mogelijk orders: alleen wat meer dan 1 procentpunt (en € 10) afwijkt. In Nederland betaal je over verkoopwinst geen aparte belasting (box 3), wel wisselkosten bij aandelen buiten de euro. Rekenvoorbeeld, geen advies.</p></section>';
}
document.addEventListener('change', (e) => {
  const el = e.target.closest && e.target.closest('[data-reb-cash]');
  if (el) { anState.rebCash = el.checked; refresh('plan'); }
});

// ---------- Rente over je vrije saldo ----------
function interestTile() {
  const I = (data.ext2 && data.ext2.interest) || [];
  const P = userPrefs();
  const rate = isNum(P.cashRate) ? P.cashRate : 2;
  const W = M.weeks.filter((w) => isNum(w.cash) && w.t > Date.now() - 365 * DAY);
  const avgCash = W.length ? mean(W.map((w) => w.cash)) : M.cash || 0;
  const list = I.map((d) => ({ t: ymd(d.date), v: d.amount })).filter((d) => d.t != null);
  const last12 = sum(list.filter((d) => d.t > Date.now() - 365 * DAY).map((d) => d.v));
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) { const s = new Date(now.getFullYear(), now.getMonth() - i, 1).getTime(), e2 = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime(); months.push({ t: s, v: sum(list.filter((d) => d.t >= s && d.t < e2).map((d) => d.v)) }); }
  return '<section class="tile pad"><h3>Rente over je vrije saldo</h3>' +
    (list.length ? '<div class="fx-head"><span class="v big">' + esc(eur(last12)) + '</span><span class="muted small">ontvangen in de laatste 12 maanden (totaal ' + esc(eur(sum(list.map((d) => d.v)))) + ')</span></div>' +
      '<div style="margin-top:8px">' + bars(months.map((m) => ({ v: m.v, color: C.soft, tip: fMonY.format(m.t) + ': ' + eur(m.v) })), true) + barLabels(months.map((m) => fMon.format(m.t).replace('.', ''))) + '</div>'
      : '<p class="small muted">Trading 212 geeft rente niet via de API. Lees je CSV-export in (Plannen, Exporteren) om de echte bedragen te zien; tot die tijd een schatting.</p>') +
    kvList([
      ['Vrij saldo nu', eur(M.cash)],
      ['Gemiddeld vrij saldo (12 maanden)', eur(avgCash)],
      ['Geschat per jaar bij ' + N2.format(rate) + '%', eur(avgCash * rate / 100)],
    ]) +
    '<div class="plan-inputs" style="margin-top:8px"><label>Rente bij je broker<span class="eur-in"><input type="number" min="0" max="10" step="0.05" data-cash-rate value="' + rate + '">%</span></label></div>' +
    '<p class="sub" style="margin-top:8px">Vul het rentepercentage in dat Trading 212 nu op je vrije saldo geeft (het verandert met de rente van de ECB).</p></section>';
}
document.addEventListener('change', async (e) => {
  const el = e.target.closest && e.target.closest('[data-cash-rate]');
  if (!el) return;
  const v = Number(el.value);
  if (v >= 0 && v <= 10) { try { await savePrefs({ cashRate: v }); refresh('plan'); } catch (err) { /* blijft */ } }
});

// ---------- Box 3: nu (forfaitair) tegenover werkelijk rendement ----------
// Bedragen zijn instelbaar: de wet verandert elk jaar en het nieuwe stelsel is nog een wetsvoorstel.
function box3Params() {
  const P = userPrefs().box3 || {};
  return { forfait: isNum(P.forfait) ? P.forfait : 6.0, hv: isNum(P.hv) ? P.hv : 57684, tarief: isNum(P.tarief) ? P.tarief : 36, hvRes: isNum(P.hvRes) ? P.hvRes : 1800 };
}
function box3Compare(Y) {
  const a = new Date(Y, 0, 1).getTime(), b = new Date(Y + 1, 0, 1).getTime();
  const peil = (data.peil || []).find((p) => p.date === Y + '-01-01');
  const wBefore = M.weeks.filter((w) => w.t <= a + 3 * DAY).pop() || M.weeks.find((w) => w.t >= a);
  const start = peil ? peil.total : wBefore ? wBefore.accountValue : null;
  const wEnd = b <= Date.now() ? (M.weeks.filter((w) => w.t <= b + 3 * DAY).pop() || null) : null;
  const end = b <= Date.now() ? (wEnd ? wEnd.accountValue : null) : M.accountNow;
  const dep = sum(M.weeks.filter((w) => w.t > a && w.t <= b && isNum(w.newDeposits)).map((w) => w.newDeposits));
  if (!isNum(start) || !isNum(end)) return null;
  const actual = end - start - dep;
  const p = box3Params(), k = anState.b3Partner ? 2 : 1;
  const nowTax = Math.max(0, start - p.hv * k) * p.forfait / 100 * p.tarief / 100;
  const newTax = Math.max(0, actual - p.hvRes * k) * p.tarief / 100;
  return { Y, start, end, dep, actual, nowTax, newTax, p, partial: b > Date.now() };
}
function box3NewTile() {
  const ys = box3Years().slice(0, 3);
  const Y = anState.b3Year && ys.includes(anState.b3Year) ? anState.b3Year : ys[0];
  const B = box3Compare(Y);
  const p = box3Params();
  const scen = [-0.1, 0, 0.07, 0.15].map((r) => {
    const v = M.accountNow || 0, k = anState.b3Partner ? 2 : 1;
    return [r, Math.max(0, v - p.hv * k) * p.forfait / 100 * p.tarief / 100, Math.max(0, v * r - p.hvRes * k) * p.tarief / 100];
  });
  return '<section class="tile pad full"><div class="plan-head"><h3>' + trm('Box 3: nu tegenover werkelijk rendement', 'box3') + '</h3>' + segX('anB3Year', ys.map((y) => [String(y), String(y)]), String(Y), 'Jaar') + '</div>' +
    '<label class="check small"><input type="checkbox" data-b3-partner' + (anState.b3Partner ? ' checked' : '') + '> Met fiscale partner (vrijstellingen dubbel)</label>' +
    (B ? '<div class="scen-res" style="margin-top:8px"><div><span class="muted small">Huidig stelsel (forfaitair)</span><b class="v big">' + esc(eur(B.nowTax)) + '</b><span class="muted small">' + esc(N2.format(p.forfait) + '% fictief rendement op ' + eur(B.start)) + '</span></div>' +
      '<div><span class="muted small">Werkelijk rendement (voorstel)</span><b class="v big">' + esc(eur(B.newTax)) + '</b><span class="muted small">' + esc(p.tarief + '% over ' + seur(B.actual) + (B.partial ? ' tot nu' : '')) + '</span></div>' +
      '<div><span class="muted small">Verschil</span><b class="v big ' + tone(B.nowTax - B.newTax) + '">' + esc(seur(B.nowTax - B.newTax)) + '</b><span class="muted small">' + esc(B.newTax < B.nowTax ? 'nieuw stelsel goedkoper' : B.newTax > B.nowTax ? 'nieuw stelsel duurder' : 'gelijk') + '</span></div></div>'
      : '<p class="muted" style="margin-top:8px">Voor ' + Y + ' ontbreekt de stand op 1 januari of aan het eind van het jaar.</p>') +
    '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Als je rendement in een jaar is</th><th class="num">Huidig stelsel</th><th class="num">Werkelijk rendement</th></tr></thead><tbody>' +
    scen.map(([r, a, b]) => '<tr><td>' + esc(spct1(r)) + '</td><td class="num">' + esc(eur(a)) + '</td><td class="num">' + esc(eur(b)) + '</td></tr>').join('') + '</tbody></table></div>' +
    '<details class="acct" style="margin-top:8px"><summary><b>Bedragen aanpassen</b><span></span><span></span></summary><div class="plan-inputs" style="padding:8px 0">' +
    '<label>Forfaitair rendement<span class="eur-in"><input type="number" step="0.01" data-b3="forfait" value="' + p.forfait + '">%</span></label>' +
    '<label>Heffingsvrij vermogen<span class="eur-in">€<input type="number" step="1" data-b3="hv" value="' + p.hv + '"></span></label>' +
    '<label>Tarief<span class="eur-in"><input type="number" step="0.5" data-b3="tarief" value="' + p.tarief + '">%</span></label>' +
    '<label>Heffingsvrij resultaat (nieuw)<span class="eur-in">€<input type="number" step="1" data-b3="hvRes" value="' + p.hvRes + '"></span></label>' +
    '<button type="button" class="btn ghost" data-b3-save>Bewaren</button></div></details>' +
    '<p class="sub" style="margin-top:8px">Alleen je Trading 212-account; je andere spaargeld en beleggingen tellen in box 3 ook mee. Het stelsel met werkelijk rendement is een wetsvoorstel (beoogd vanaf 2028) en de bedragen kunnen nog veranderen; controleer de actuele cijfers bij de Belastingdienst. Is je werkelijke rendement nu al lager dan het forfaitaire, dan kun je dat met de tegenbewijsregeling aantonen. Geen belastingadvies.</p></section>';
}
document.addEventListener('change', (e) => {
  const el = e.target.closest && e.target.closest('[data-b3-partner]');
  if (el) { anState.b3Partner = el.checked; refresh('plan'); }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-b3-save]');
  if (!b) return;
  const box = b.closest('.tile'), o = {};
  box.querySelectorAll('[data-b3]').forEach((i) => { const v = Number(i.value); if (isFinite(v) && v >= 0) o[i.dataset.b3] = v; });
  try { await savePrefs({ box3: o }); refresh('plan'); } catch (err) { /* blijft */ }
});

// Keuzeknoppen (segX) van deze pagina
document.addEventListener('click', (e) => {
  const seg = e.target.closest && e.target.closest('[data-x^="an"] button[data-k]');
  if (!seg) return;
  e.stopImmediatePropagation();
  const key = seg.parentElement.dataset.x, k = seg.dataset.k;
  if (key === 'anContrib') anState.contrib = k;
  else if (key === 'anHeatYear') anState.heatYear = Number(k);
  else if (key === 'anPA') anState.pA = k;
  else if (key === 'anPB') anState.pB = k;
  else if (key === 'anWrapYear') anState.wrapYear = Number(k);
  else if (key === 'anFireWr') anState.fireWr = Number(k);
  else if (key === 'anDcaMonths') anState.dcaMonths = Number(k);
  else if (key === 'anRebNew') anState.rebNew = Number(k);
  else if (key === 'anB3Year') anState.b3Year = Number(k);
  else if (key === 'anTxKind') anState.txKind = k;
  refresh('analyse', 'plan');
}, true);

// ---------- Extra secties op Plannen (ook gebruikt door de Preact-versie) ----------
function planExtraSections() {
  if (!M) return [];
  return [
    { title: 'Vooruit rekenen', sub: 'Kansen, financiële onafhankelijkheid en wat maandelijks inleggen had opgeleverd', tiles: [mcTile(), fireTile(), dcaTile(), dripTile()] },
    { title: 'Belasting, herbalanceren en rente', sub: 'Box 3 straks, terug naar je streefverdeling en rente over je saldo', tiles: [box3NewTile(), rebalanceTile(), interestTile()] },
  ];
}
function drawPlanExtra(root) { drawMc(root); drawDca(root); }
