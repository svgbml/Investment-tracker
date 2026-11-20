/* Investeringstracker – Inleg-assistent, scenario's, dividendkalender, box 3, kosten, dagboek, vergelijken, waardering, overlap, delen, rekeningen
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

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
    (P.hasT && isNum(P.d0) && isNum(P.d1) ? '<p class="small" style="margin-top:6px">Afstand tot je streefverdeling: ' + esc(N1.format(P.d0 * 100)) + ' → <b class="gain">' + esc(N1.format(P.d1 * 100)) + '</b> procentpunt</p>'
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
  if (!F.info.length) return fullT('Dividendkalender', '<p class="muted">Nog geen dividend ontvangen of aangekondigd voor je posities. Na de eerste uitkeringen (of met een FMP-sleutel) zie je hier per maand wat er komt. ' + fixBtn('FMP_KEY') + '</p>');
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
  // Uit de export van Trading 212: de werkelijk ingehouden bronbelasting
  if (isNum(d.wht) && d.wht >= 0) {
    const wr = fxOn(d.whtCur || cur, d.t) || 1;
    const tax = d.wht / wr;
    return { cur, gross: d.amount + tax, tax, how: 'uit Trading 212-export' };
  }
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
  const L = moreRows('journal', show.map((x) => { const r = sinceBuy(x);
    return '<div class="tx"><span class="tag gain">Koop</span><span class="tx-m"><b>' + esc(x.tk) + ' · ' + esc(eur(x.net)) + '</b><span class="sub">' + esc(fD.format(x.t) + ' ' + new Date(x.t).getFullYear()) + ' · ' + esc(N4.format(x.qty)) + ' × ' + esc(money(x.price, x.cur)) + '</span></span>' +
      '<span class="tx-v ' + tone(r) + '">' + esc(isNum(r) ? spct1(r) : M.byTk.has(x.tk) ? '–' : 'verkocht') + '<span class="sub">sinds aankoop</span></span></div>' + noteBlock(x); }), 8, 'plan');
  return '<section class="tile pad full journal"><h3>Aankoopdagboek</h3>' +
    '<p class="small">' + withN.length + ' van ' + buys.length + ' aankopen hebben een notitie' + (res.length ? '; die staan gemiddeld <b class="' + tone(mean(res)) + '">' + esc(spct1(mean(res))) + '</b> sinds aankoop' : '') + '.</p>' +
    '<div class="tx-list" style="margin-top:8px">' + L.rows + '</div>' + L.btn +
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
  const table = '<section class="tile pad full"><h3>Naast elkaar</h3><div class="tbl-wrap"><table class="tbl cmp-tbl"><thead><tr><th><span class="sr-only">Kenmerk</span></th><th class="num">' + esc(A.tk) + '</th><th class="num">' + esc(B.tk) + '</th></tr></thead><tbody>' +
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
  const out = { pe: null, dy: null, hist: [], avgPe: null, avgDy: null, secPe: null, src: null, sector: null, at: null };
  if (isFundC(o)) return out;
  const mk = data.market || {};
  const sym = o.watch ? o.tk : M.mk.ok ? M.mk.sym(o.tk) : o.tk;
  const p = M.mk.ok ? M.mk.prof(sym) : null;
  const V = (mk.valuation || {})[sym] || null;
  if (V) { out.pe = isNum(V.pe) ? V.pe : null; out.dy = isNum(V.dy) ? V.dy : null; out.src = 'FMP'; out.at = V.updated || null; }
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
    return offTile('Waardering', (data.market && data.market.valDenied) ? 'Waarderingscijfers zitten niet in je FMP-abonnement; met SEC-cijfers rekent de tracker de koers-winstverhouding zelf uit zodra die er zijn.' : FEAT().has.fmp || demo ? 'Nog geen waarderingscijfers opgehaald; ze komen wekelijks van Financial Modeling Prep.' : 'Waardering vraagt een gratis FMP-sleutel (Financial Modeling Prep).', 'FMP_KEY');
  }
  const loss = isNum(V.pe) && V.pe <= 0;
  const vsOwn = !loss && isNum(V.pe) && isNum(V.avgPe) ? V.pe / V.avgPe - 1 : null;
  const vsSec = !loss && isNum(V.pe) && isNum(V.secPe) ? V.pe / V.secPe - 1 : null;
  const said = [relWord(vsOwn, 'het eigen gemiddelde'), relWord(vsSec, 'de sector')].filter(Boolean).join(' en ');
  const peBars = V.hist.length ? '<div style="margin-top:10px">' + bars(V.hist.map((r) => ({ v: r[1], color: C.soft, tip: r[0] + ': ' + N1.format(r[1]) })).concat(isNum(V.pe) && !loss ? [{ v: V.pe, color: C.accent, tip: 'Nu: ' + N1.format(V.pe) }] : []), true) +
    barLabels(V.hist.map((r) => r[0]).concat(isNum(V.pe) && !loss ? ['nu'] : [])) + '</div>' : '';
  return '<section class="tile pad"><h3>Waardering' + ageTag(V.at, AGE_LIMIT.weekly) + '</h3>' + (said ? '<p class="small"><b>Koers-winstverhouding ' + esc(said) + '.</b></p>' : '') + peBars +
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
    : '<p class="empty">Waarderingscijfers komen wekelijks van Financial Modeling Prep (gratis sleutel). Ze zijn er nog niet. ' + fixBtn('FMP_KEY') + '</p>';
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
  catch (err) { const t = foutTekst('De rekening kon niet worden opgeslagen', err, 'Andere rekeningen staan in je Worker; controleer bij Instellingen je toegangscode en probeer het opnieuw.'); if (st) { st.textContent = t; st.className = 'small plan-status acct-st loss'; } toastErr(t); }
}

// =====================================================================
// ---------- Doelen (potjes) ----------
// Elk doel krijgt een deel van je accountwaarde en van je maandinleg; de tracker rekent uit wanneer je het haalt bij 7% per jaar.
const goalsOf = () => ((M.settings && M.settings.goals) || []);
function goalEta(have, monthly, target) {
  if (have >= target) return 0;
  const rm = Math.pow(1.07, 1 / 12) - 1;
  let v = have, k = 0;
  while (v < target && k < 720) { v = v * (1 + rm) + monthly; k++; }
  return k < 720 ? k : null;
}
function goalsTile() {
  const G = goalsOf();
  const monthly = isNum(M.settings.monthly) ? M.settings.monthly : monthlyGuess();
  const total = M.accountNow || 0;
  const shareSum = sum(G.map((g) => g.share || 0));
  const now = new Date();
  const row = (g) => {
    const have = total * (g.share || 0) / 100, m = monthly * (g.share || 0) / 100;
    const k = goalEta(have, m, g.target);
    const eta = k == null ? null : new Date(now.getFullYear(), now.getMonth() + k, 1);
    const due = g.date ? new Date(g.date.length === 7 ? g.date + '-01' : g.date) : null;
    const onTrack = due && eta ? eta <= due : null;
    return '<div class="goal"><div class="goal-h"><b>' + esc(g.name) + '</b><span class="muted small">' + esc(eur(have)) + ' van ' + esc(eur(g.target)) + ' · ' + esc(N1.format(g.share || 0)) + '% van je account</span></div>' +
      '<div class="meter"><div style="width:' + Math.min(100, have / g.target * 100).toFixed(1) + '%"></div></div>' +
      '<p class="small" style="margin-top:4px">' + (k === 0 ? 'Gehaald.' : eta ? 'Rond ' + esc(new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(eta)) + ' bij ' + esc(eur(m)) + ' per maand en 7% per jaar' : 'Niet binnen 60 jaar bij deze inleg') +
        (onTrack === true ? ' · <b class="gain">op schema</b> voor ' + esc(new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(due)) : onTrack === false ? ' · <b class="loss">later dan</b> ' + esc(new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(due)) : '') + '</p></div>';
  };
  const edit = '<details class="acct goals-edit"><summary><b>Doelen bewerken</b><span></span><span></span></summary><div class="goal-form">' +
    G.concat([{ id: '', name: '', target: '', share: '', date: '' }]).map((g) => '<div class="h-row goal-row" data-goal="' + esc(g.id) + '"><input aria-label="Naam" data-g="name" maxlength="40" value="' + esc(g.name) + '" placeholder="Bijv. Huis">' +
      '<input aria-label="Doelbedrag" data-g="target" type="number" min="0" step="100" value="' + esc(g.target) + '" placeholder="Bedrag €"><input aria-label="Deel van je account in procent" data-g="share" type="number" min="0" max="100" step="1" value="' + esc(g.share) + '" placeholder="% account">' +
      '<input aria-label="Wanneer" data-g="date" type="month" value="' + esc(g.date ? g.date.slice(0, 7) : '') + '"><span></span><button type="button" class="icon-x" data-goal-del aria-label="Doel verwijderen">×</button></div>').join('') +
    '<div class="plan-actions" style="margin-top:8px"><button type="button" class="btn primary" data-goals-save>Doelen opslaan</button><span class="small plan-status" id="goals-status" role="status"></span></div></div></details>';
  return '<section class="tile pad full goals"><h3>Doelen</h3>' +
    (G.length ? G.map(row).join('') + (shareSum > 100 ? '<p class="small loss">Samen ' + esc(N1.format(shareSum)) + '% van je account; dat is meer dan je hebt.</p>' : '')
      : '<p class="muted">Verdeel je account over doelen, zoals een huis of je pensioen. Per doel zie je hoe ver je bent en wanneer je het bij je huidige inleg haalt.</p>') +
    edit + '<p class="sub" style="margin-top:8px">Elk doel krijgt het opgegeven deel van je accountwaarde en van je maandinleg (' + esc(eur(monthly)) + '). Rekenvoorbeeld met 7% per jaar, geen belofte.</p></section>';
}
document.addEventListener('click', async (e) => {
  const del = e.target.closest && e.target.closest('[data-goal-del]');
  if (del) { del.closest('.goal-row').remove(); return; }
  const b = e.target.closest && e.target.closest('[data-goals-save]');
  if (!b) return;
  const form = b.closest('.goal-form'), st = $('goals-status');
  const goals = [...form.querySelectorAll('.goal-row')].map((r) => {
    const v = (k) => r.querySelector('[data-g="' + k + '"]').value.trim();
    return { id: r.dataset.goal || undefined, name: v('name'), target: Number(v('target')), share: Number(v('share')) || 0, date: v('date') || null };
  }).filter((g) => g.name && g.target > 0);
  try { await saveSettings({ goals }); toastOk(goals.length === 1 ? 'Je doel is opgeslagen.' : goals.length + ' doelen zijn opgeslagen.'); rerenderAll(); }
  catch (err) { const t = foutTekst('De doelen konden niet worden opgeslagen', err, 'Je doelen staan in je Worker; controleer bij Instellingen je toegangscode en probeer het opnieuw.'); if (st) { st.textContent = t; st.className = 'small plan-status loss'; } toastErr(t); }
});

// =====================================================================
// ---------- Inleg per maand: gestort tegenover je plan ----------
function depositMonths() {
  const W = M.weeks.filter((w) => isNum(w.newDeposits));
  const by = new Map();
  W.forEach((w) => { const d = new Date(w.t); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); by.set(k, (by.get(k) || 0) + w.newDeposits); });
  const out = [];
  const d = new Date(); d.setDate(1);
  for (let i = 5; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); const k = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); out.push({ k, t: x.getTime(), v: by.get(k) || 0 }); }
  return out;
}
function depositTile() {
  const monthly = isNum(M.settings.monthly) && M.settings.monthly > 0 ? M.settings.monthly : null;
  const ms = depositMonths();
  const cur = ms[ms.length - 1];
  const remind = M.settings.depositReminder !== false;
  return '<section class="tile pad"><h3>Inleg per maand</h3>' +
    (monthly ? '<div class="fx-head"><span class="v big">' + esc(eur(cur.v)) + '</span><span class="muted small">van ' + esc(eur(monthly)) + ' deze maand' + (cur.v >= monthly * 0.9 ? ', gelukt' : '') + '</span></div>' +
      '<div class="meter"><div style="width:' + Math.min(100, cur.v / monthly * 100).toFixed(1) + '%"></div></div>'
      : '<p class="muted small">Stel bij Vooruitblik je inleg per maand in om hem hier te volgen.</p>') +
    '<div style="margin-top:12px">' + bars(ms.map((m) => ({ v: m.v, color: monthly && m.v >= monthly * 0.9 ? C.gain : C.soft, tip: fMonY.format(m.t) + ': ' + eur(m.v) + (monthly ? ' van ' + eur(monthly) : '') })), true) +
    barLabels(ms.map((m) => fMon.format(m.t).replace('.', ''))) + '</div>' +
    '<label class="check small" style="margin-top:6px"><input type="checkbox" data-deposit-remind' + (remind ? ' checked' : '') + '> Herinnering op de 25e als ik nog niet genoeg heb ingelegd (melding)</label>' +
    '<p class="sub">Uit je weekmetingen: stortingen min opnames per kalendermaand. Een storting telt mee vanaf de zaterdag erna.</p></section>';
}
document.addEventListener('change', async (e) => {
  const cb = e.target.closest && e.target.closest('input[data-deposit-remind]');
  if (!cb) return;
  try { await saveSettings({ depositReminder: cb.checked }); } catch (err) { cb.checked = !cb.checked; }
});

// =====================================================================
// ---------- Fondskosten (TER) en goedkopere fondsen op dezelfde index ----------
// Lopende kosten per jaar volgens de aanbieders (indicatief; controleer het actuele percentage bij de aanbieder).
const FUND_TER = [
  [/^(VUAG|VUSA)$/, 'S&P 500', 0.07], [/^(CSPX|SXR8|IUSA)$/, 'S&P 500', 0.07], [/^SPY5$/, 'S&P 500', 0.03], [/^(SPXS|SPXP)$/, 'S&P 500', 0.05],
  [/^(SXRV|CNDX)$/, 'Nasdaq-100', 0.30], [/^(EQQQ|EQAC)$/, 'Nasdaq-100', 0.30], [/^(XNAS|XNAQ)$/, 'Nasdaq-100', 0.20],
  [/^(IWDA|SWDA|EUNL)$/, 'MSCI World', 0.20], [/^(SPPW)$/, 'MSCI World', 0.12], [/^(XDWD)$/, 'MSCI World', 0.19],
  [/^(VWRL|VWCE|VWRA)$/, 'FTSE All-World', 0.19], [/^(SSAC)$/, 'MSCI ACWI', 0.20],
];
const CHEAPEST = { 'S&P 500': ['SPY5', 'SPDR S&P 500 UCITS ETF', 0.03], 'Nasdaq-100': ['XNAS', 'Xtrackers Nasdaq 100 UCITS ETF', 0.20], 'MSCI World': ['SPPW', 'SPDR MSCI World UCITS ETF', 0.12], 'FTSE All-World': ['VWCE', 'Vanguard FTSE All-World UCITS ETF', 0.19] };
function terTile() {
  const funds = M.companies.filter(isFundC).map((c) => { const f = FUND_TER.find((x) => x[0].test(c.tk)); return { c, idx: f && f[1], ter: f && f[2] }; });
  if (!funds.length) return '';
  const years = [10, 20], r = 0.07;
  const fv = (v, ter, n) => v * Math.pow(1 + r - ter / 100, n);
  const rows = funds.map((f) => {
    const alt = f.idx && CHEAPEST[f.idx];
    const better = alt && isNum(f.ter) && alt[2] < f.ter - 0.005 && alt[0] !== f.c.tk ? alt : null;
    return '<tr><td class="co"><b>' + esc(f.c.tk) + '</b><span class="nm">' + esc(f.c.name) + '</span></td><td>' + esc(f.idx || '–') + '</td>' +
      '<td class="num">' + esc(isNum(f.ter) ? N2.format(f.ter) + '%' : 'onbekend') + '</td><td class="num">' + esc(isNum(f.ter) ? eur(f.c.value * f.ter / 100) : '–') + '</td>' +
      '<td>' + (better ? '<b>' + esc(better[0]) + '</b> <span class="muted small">' + esc(better[1]) + ', ' + esc(N2.format(better[2])) + '%</span><span class="sub">' + years.map((n) => n + ' jaar: ' + esc(eur(fv(f.c.value, better[2], n) - fv(f.c.value, f.ter, n))) + ' meer').join(' · ') + '</span>' : isNum(f.ter) ? '<span class="muted small">al een van de goedkoopste</span>' : '') + '</td></tr>';
  }).join('');
  const yearCost = sum(funds.map((f) => (isNum(f.ter) ? f.c.value * f.ter / 100 : 0)));
  return '<section class="tile pad full"><h3>Fondskosten</h3><p class="small">Je betaalt ongeveer <b>' + esc(eur(yearCost)) + ' per jaar</b> aan lopende kosten van je fondsen (zit al in de koers verwerkt).</p>' +
    '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Fonds</th><th>Index</th><th class="num">Kosten per jaar</th><th class="num">Nu ongeveer</th><th>Goedkoper op dezelfde index</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p class="sub" style="margin-top:8px">Verschil bij je huidige waarde, 7% per jaar en geen extra inleg. Fondsen op dezelfde index volgen vrijwel dezelfde bedrijven; let ook op valuta, herbeleggen (Acc) of uitkeren (Dist) en of je broker het fonds aanbiedt. Overstappen betekent verkopen en kan belasting- of wisselkosten geven. Kostenpercentages zijn indicatief; controleer ze bij de aanbieder. Geen beleggingsadvies.</p></section>';
}

// ---------- Dividend herbeleggen: wat het oplevert in de vooruitblik ----------
function snowball(P) {
  const value = M.totalValue || 0;
  const dy = value > 0 && M.ev && M.ev.last12 > 0 ? M.ev.last12 / value : null;
  if (!isNum(dy) || dy <= 0) return null;
  const S = P.sets.find((x) => x.label === 'Gemiddeld') || P.sets[0];
  const rm = Math.pow(1 + S.r, 1 / 12) - 1, rmOut = Math.pow(1 + S.r - dy, 1 / 12) - 1;
  let a = P.start, b = P.start, paid = 0;
  for (let k = 1; k <= P.years * 12; k++) { a = a * (1 + rm) + P.monthly; paid += b * (Math.pow(1 + dy, 1 / 12) - 1); b = b * (1 + rmOut) + P.monthly; }
  return { dy, extra: a - b, paid, withDiv: a, without: b };
}
function snowballLine(P) {
  const B = snowball(P);
  if (!B) return '';
  return '<p class="small" style="margin-top:8px"><b>Dividend herbeleggen:</b> met je dividendrendement van ' + esc(P2.format(B.dy)) + ' levert herbeleggen na ' + P.years + ' jaar ongeveer <b class="gain">' + esc(eur(B.extra)) + '</b> meer op dan het laten uitkeren (dan ontvang je onderweg zo’n ' + esc(eur(B.paid)) + ' aan dividend). Gemiddeld scenario.</p>';
}
