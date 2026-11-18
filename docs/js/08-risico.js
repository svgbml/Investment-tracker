/* Investeringstracker – Risico: indicatie 1 tot 7, bijdrage per positie, wat beweegt samen
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

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
        (() => { const tip = i === j ? a.c.tk : a.c.tk + ' en ' + b2.c.tk + ': ' + (isNum(R.C2[i][j]) ? N2.format(R.C2[i][j]) : 'te weinig gegevens');
          return '<button type="button" class="cell ' + (i === j ? 'self' : cellCls(R.C2[i][j])) + '" data-pair="' + i + '-' + j + '" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '"></button>'; })()).join('')).join('') + '</div>' +
      '<div class="heat-key" style="margin-top:10px">los van elkaar <i class="c0"></i><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i> sterk samen</div>' +
      '<p class="small muted" style="margin-top:8px">Klik op een vakje voor de details van dat paar.</p><div class="corr-detail" data-pair-detail></div>' +
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
