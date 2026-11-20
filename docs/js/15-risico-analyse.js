/* Investeringstracker – Risico en Analyse: wat als-schuiven, stresstests, valuta, overlap in fondsen,
 * bijdrage per sector en munt, rollend rendement, herstel na een daling, kostenrem, doorkijk en wisselkosten vooruit.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// e.target als element, voor de klik- en invoerluisteraars
const raHit = (e, sel) => { const t = e.target; return t instanceof Element ? t.closest(sel) : null; };
// Het brede indexfonds waar een positie op lijkt (naam of ticker), met de regels uit BENCHES
const raBench = (c) => BENCHES.find((x) => /** @type {RegExp} */ (x[1]).test(c.tk) || /** @type {RegExp} */ (x[2]).test(c.name));
const raBenchKey = (c) => { const b = raBench(c); return b ? (b[0] === 'S&P 500' ? 'SP500' : b[0] === 'Nasdaq 100' ? 'NDX' : null) : null; };

// Keuzes op deze tegels (niet opgeslagen; per apparaat en per sessie)
const raState = { wiFrom: '', wiTo: '', wiPct: 0, lookTab: 'sector', ddMin: 2, rollN: 0, fcMonthly: null, fcShare: null };

// ---------- 33. Wat als: gewicht verschuiven van de ene positie naar de andere ----------
// Deze functie draait in een Web Worker en mag dus niets van buiten gebruiken
function covJob(inp) {
  const maps = inp.series.map((a) => { const m = new Map(); a.forEach((p) => m.set(p[0], p[1])); return m; });
  const n = maps.length;
  const cov = [];
  for (let i = 0; i < n; i++) cov.push(new Array(n).fill(null));
  const varOf = [];
  for (let i = 0; i < n; i++) {
    const a = [];
    maps[i].forEach((r) => a.push(r));
    const m = a.reduce((s, x) => s + x, 0) / a.length;
    varOf.push(a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, a.length - 1));
  }
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const A = [], B = [];
      maps[i].forEach((r, d) => { const q = maps[j].get(d); if (typeof q === 'number') { A.push(r); B.push(q); } });
      let c = null;
      if (A.length >= 30) {
        const ma = A.reduce((s, x) => s + x, 0) / A.length, mb = B.reduce((s, x) => s + x, 0) / B.length;
        let s = 0;
        for (let k = 0; k < A.length; k++) s += (A[k] - ma) * (B[k] - mb);
        c = s / (A.length - 1);
      } else c = 0.5 * Math.sqrt(Math.max(0, varOf[i]) * Math.max(0, varOf[j])); // geen overlap: middelmatige samenhang aangenomen
      cov[i][j] = c; cov[j][i] = c;
    }
  }
  return { cov };
}

let raCov = null; // { key, cov, tks }

// Beweeglijkheid per jaar bij gewichten ws (opgeteld 1 over de gemodelleerde posities)
function raVol(ws) {
  if (!raCov) return null;
  const cov = raCov.cov;
  let v = 0;
  for (let i = 0; i < ws.length; i++) for (let j = 0; j < ws.length; j++) v += ws[i] * ws[j] * (cov[i][j] || 0);
  return Math.sqrt(Math.max(0, v) * 252);
}

// Gewichten van alle posities, met pct van je beleggingen verschoven van → naar
function raShifted(from, to, pct) {
  const total = M.totalValue || 0;
  const shift = Math.max(0, pct) / 100;
  return M.companies.map((c) => {
    let w = total ? c.value / total : 0;
    if (c.tk === from) w = Math.max(0, w - shift);
    if (c.tk === to) w += shift;
    return { tk: c.tk, w };
  });
}
const raEffN = (ws) => { const q = sum(ws.map((x) => x.w * x.w)); return q > 0 ? 1 / q : null; };

function riskWhatIfTile() {
  const R = riskModel();
  const items = R.mat;
  if (items.length < 2) {
    return '<section class="tile pad"><h3>Wat als je anders verdeelt</h3><p class="muted">Hiervoor is van minstens twee posities koershistorie nodig. Die komt van FMP (koersen), FRED (indexen) of de eigen metingen van de tracker.</p></section>';
  }
  const tks = items.map((x) => x.c.tk);
  if (!tks.includes(raState.wiFrom)) raState.wiFrom = tks[0];
  if (!tks.includes(raState.wiTo) || raState.wiTo === raState.wiFrom) raState.wiTo = tks.find((t) => t !== raState.wiFrom) || tks[0];
  const opt = (sel) => items.map((x) => '<option value="' + esc(x.c.tk) + '"' + (x.c.tk === sel ? ' selected' : '') + '>' + esc(x.c.tk + ' – ' + x.c.name) + '</option>').join('');
  const maxPct = Math.max(0.5, (items.find((x) => x.c.tk === raState.wiFrom) || { w: 0 }).w * 100);
  if (raState.wiPct > maxPct) raState.wiPct = Math.round(maxPct * 10) / 10;
  return '<section class="tile pad whatif span-2"><h3>Wat als je anders verdeelt</h3>' +
    '<p class="small muted" style="margin-top:4px">Schuif een deel van je beleggingen van de ene positie naar de andere en zie wat dat met het risico doet. Dit verandert niets: er wordt niets gekocht of verkocht.</p>' +
    '<div class="plan-inputs wi-in" style="margin-top:10px">' +
    '<label>Van<select data-wi="from">' + opt(raState.wiFrom) + '</select></label>' +
    '<label>Naar<select data-wi="to">' + opt(raState.wiTo) + '</select></label>' +
    '<label>Hoeveel verschuiven<span class="wi-slide"><input type="range" min="0" max="' + maxPct.toFixed(1) + '" step="0.5" value="' + raState.wiPct + '" data-wi="pct" aria-label="Hoeveel procent van je beleggingen verschuiven"><output class="wi-out">' + esc(P1.format(raState.wiPct / 100)) + '</output></span></label>' +
    '<button type="button" class="btn ghost" data-wi="reset">Terug naar nu</button></div>' +
    '<div class="wi-res" data-wi-res>' + raBusy() + '</div>' +
    '<p class="sub" style="margin-top:10px">Gerekend met de dagkoersen in euro van het laatste jaar (' + NI.format(R.nDays || 0) + ' handelsdagen, ' + esc(P1.format(R.coverage)) + ' van je beleggingen). ' +
    'Paren zonder genoeg gemeenschappelijke dagen krijgen een middelmatige samenhang. Verleden zegt niets over de toekomst; dit is een rekenvoorbeeld en geen beleggingsadvies.</p></section>';
}
const raBusy = () => '<p class="muted small">Rekenen…</p>';

function paintWhatIf() {
  // Beide indelingen (desktop en telefoon) staan in de pagina; alleen de zichtbare is te zien, dus vul ze allebei
  const hosts = [...document.querySelectorAll('[data-wi-res]')];
  if (!hosts.length) return;
  if (!raCov) { hosts.forEach((h) => { h.innerHTML = raBusy(); }); return; }
  const R = riskModel();
  const items = R.mat;
  const total = M.totalValue || 0;
  const cov = R.coverage || 1;
  const base = items.map((x) => x.w / cov);
  const vol0 = raVol(base);
  const shift = (raState.wiPct / 100) / cov;
  const after = items.map((x, i) => {
    let w = base[i];
    if (x.c.tk === raState.wiFrom) w = Math.max(0, w - shift);
    if (x.c.tk === raState.wiTo) w += shift;
    return w;
  });
  const s2 = sum(after) || 1;
  const vol1 = raVol(after.map((w) => w / s2));
  const ws0 = raShifted('', '', 0), ws1 = raShifted(raState.wiFrom, raState.wiTo, raState.wiPct);
  const eurAmt = total * raState.wiPct / 100;
  const c0 = srri(vol0), c1 = srri(vol1);
  const lvl = (k) => (k ? '<span class="lvl" style="--k:' + k + '">' + k + '</span>' : '–');
  const row = (label, a, b, better) => '<div class="wi-row"><span class="k">' + esc(label) + '</span><span class="a">' + a + '</span><span class="arr" aria-hidden="true">→</span><span class="b ' + (better || '') + '">' + b + '</span></div>';
  const dVol = isNum(vol0) && isNum(vol1) ? vol1 - vol0 : null;
  const e0 = raEffN(ws0), e1 = raEffN(ws1);
  const top0 = Math.max(0, ...ws0.map((x) => x.w)), top1 = Math.max(0, ...ws1.map((x) => x.w));
  const html = '<p class="small" style="margin:0 0 8px">' + esc(raState.wiPct > 0
    ? eur(eurAmt) + ' van ' + raState.wiFrom + ' naar ' + raState.wiTo
    : 'Nog niets verschoven: hieronder staat je huidige verdeling.') + '</p>' +
    '<div class="wi-rows">' +
    row('Risicoklasse', lvl(c0), lvl(c1), isNum(c0) && isNum(c1) ? (c1 < c0 ? 'gain' : c1 > c0 ? 'loss' : '') : '') +
    row('Beweeglijkheid per jaar', esc(isNum(vol0) ? P1.format(vol0) : '–'), esc(isNum(vol1) ? P1.format(vol1) : '–'), isNum(dVol) ? (dVol < -0.0005 ? 'gain' : dVol > 0.0005 ? 'loss' : '') : '') +
    row('Spreiding (even grote posities)', esc(isNum(e0) ? N1.format(e0) : '–'), esc(isNum(e1) ? N1.format(e1) : '–'), isNum(e0) && isNum(e1) ? (e1 > e0 + 0.05 ? 'gain' : e1 < e0 - 0.05 ? 'loss' : '') : '') +
    row('Grootste positie', esc(P1.format(top0)), esc(P1.format(top1)), top1 < top0 - 0.002 ? 'gain' : top1 > top0 + 0.002 ? 'loss' : '') +
    row('Slechte dag (1 op 20)', esc(isNum(vol0) ? seur(-1.645 * vol0 / Math.sqrt(252) * total) : '–'), esc(isNum(vol1) ? seur(-1.645 * vol1 / Math.sqrt(252) * total) : '–'), isNum(dVol) ? (dVol < 0 ? 'gain' : dVol > 0 ? 'loss' : '') : '') +
    '</div>';
  hosts.forEach((h) => { h.innerHTML = html; });
}

async function mountWhatIf() {
  if (!document.querySelector('[data-wi-res]') || !M) return;
  const R = riskModel();
  const items = R.mat;
  if (items.length < 2) return;
  const key = items.map((x) => x.c.tk + ':' + x.n).join(',');
  if (!raCov || raCov.key !== key) {
    const series = items.map((x) => [...x.rets.entries()]);
    const out = await runOffThread(covJob, { series });
    raCov = { key, cov: (out && out.cov) || [], tks: items.map((x) => x.c.tk) };
  }
  paintWhatIf();
}

document.addEventListener('input', (e) => {
  const el = /** @type {HTMLInputElement|HTMLSelectElement|null} */ (raHit(e, '[data-wi]'));
  if (!el || el.dataset.wi === 'reset') return;
  const k = el.dataset.wi;
  if (k === 'pct') { raState.wiPct = Number(el.value) || 0; const o = el.parentElement && el.parentElement.querySelector('.wi-out'); if (o) o.textContent = P1.format(raState.wiPct / 100); }
  if (k === 'from') { raState.wiFrom = el.value; if (raState.wiTo === raState.wiFrom) { const R = riskModel(); const alt = R.mat.map((x) => x.c.tk).find((t) => t !== raState.wiFrom); if (alt) raState.wiTo = alt; } refresh('risk-extra'); return; }
  if (k === 'to') { raState.wiTo = el.value; if (raState.wiFrom === raState.wiTo) { const R = riskModel(); const alt = R.mat.map((x) => x.c.tk).find((t) => t !== raState.wiTo); if (alt) raState.wiFrom = alt; } refresh('risk-extra'); return; }
  paintWhatIf();
});
document.addEventListener('click', (e) => {
  const b = raHit(e, '[data-wi="reset"]');
  if (!b) return;
  raState.wiPct = 0;
  document.querySelectorAll('[data-wi="pct"]').forEach((sl) => {
    /** @type {HTMLInputElement} */ (sl).value = '0';
    const o = sl.parentElement && sl.parentElement.querySelector('.wi-out');
    if (o) o.textContent = P1.format(0);
  });
  paintWhatIf();
});

// ---------- 34. Stresstests: ruwe voorbeelden uit 2008, 2020 en 2022 ----------
// Benadering van de daling van top tot dal per sector in de S&P 500. Ruwe voorbeelden, geen voorspelling.
const STRESS = [
  { key: '2008', label: '2008–2009', sub: 'kredietcrisis, okt 2007 – mrt 2009', market: -0.55, per: {
    'Financial Services': -0.80, 'Real Estate': -0.70, Industrials: -0.60, 'Basic Materials': -0.56, 'Consumer Cyclical': -0.55, Energy: -0.50, Technology: -0.50,
    'Communication Services': -0.50, Utilities: -0.45, Healthcare: -0.38, 'Consumer Defensive': -0.30 } },
  { key: '2020', label: '2020', sub: 'coronacrash, feb – mrt 2020', market: -0.34, per: {
    Energy: -0.55, 'Financial Services': -0.42, 'Real Estate': -0.40, Industrials: -0.40, Utilities: -0.36, 'Basic Materials': -0.36, 'Consumer Cyclical': -0.35,
    Technology: -0.30, 'Communication Services': -0.28, Healthcare: -0.26, 'Consumer Defensive': -0.25 } },
  { key: '2022', label: '2022', sub: 'rente en inflatie, jan – okt 2022', market: -0.25, per: {
    'Communication Services': -0.40, 'Consumer Cyclical': -0.36, Technology: -0.33, 'Real Estate': -0.30, 'Basic Materials': -0.20, 'Financial Services': -0.22,
    Industrials: -0.19, Healthcare: -0.15, Utilities: -0.12, 'Consumer Defensive': -0.10, Energy: 0.30 } },
];
function stressModel() {
  const total = M.totalValue || 0;
  const rows = M.companies.map((c) => {
    const sct = M.mk.ok ? M.mk.sectorOf(c) : (isFundC(c) ? FUNDS : 'Onbekend');
    const known = sct !== FUNDS && sct !== 'Onbekend';
    return { c, sct, label: known ? sectorNl(sct) : (sct === FUNDS ? 'Brede fondsen' : 'Onbekende sector'), known };
  });
  const scen = STRESS.map((s) => {
    const per = rows.map((r) => ({ r, d: r.known && isNum(s.per[r.sct]) ? s.per[r.sct] : s.market }));
    const impact = sum(per.map((x) => x.r.c.value * x.d));
    return { s, per, impact, pct: total ? impact / total : null, worst: per.slice().sort((a, b) => a.r.c.value * a.d - b.r.c.value * b.d).slice(0, 3) };
  });
  // Per sector optellen, voor de tabel
  const bySec = new Map();
  rows.forEach((r) => { const o = bySec.get(r.label) || { label: r.label, v: 0, sct: r.sct, known: r.known }; o.v += r.c.value; bySec.set(r.label, o); });
  const secs = [...bySec.values()].sort((a, b) => b.v - a.v);
  return { scen, secs, total };
}
function stressTile() {
  const S = stressModel();
  if (!S.total) return '';
  const col = (x) => '<div><span class="muted small">' + esc(x.s.label) + '</span><b class="v big loss">' + esc(spct1(x.pct)) + '</b>' +
    '<span class="muted small">' + esc(seur(x.impact) + ', dan nog ' + eur(S.total + x.impact)) + '</span><span class="muted small">' + esc(x.s.sub) + '</span></div>';
  const dcell = (d) => '<td class="num ' + (d > 0 ? 'gain' : 'loss') + '">' + esc(spct1(d)) + '</td>';
  return '<section class="tile pad stress span-2"><h3>Stresstests: wat deden sectoren in slechte jaren</h3>' +
    '<div class="scen-res">' + S.scen.map(col).join('') + '</div>' +
    '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Sector</th><th class="num">Waarde</th>' + STRESS.map((s) => '<th class="num">' + esc(s.label) + '</th>').join('') + '<th class="num">Effect 2008</th></tr></thead><tbody>' +
    S.secs.map((o) => { const d08 = o.known && isNum(STRESS[0].per[o.sct]) ? STRESS[0].per[o.sct] : STRESS[0].market;
      return '<tr><td>' + esc(o.label) + '</td><td class="num">' + esc(eur(o.v)) + '</td>' +
        STRESS.map((s) => dcell(o.known && isNum(s.per[o.sct]) ? s.per[o.sct] : s.market)).join('') +
        '<td class="num loss">' + esc(seur(o.v * d08)) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    '<p class="small" style="margin-top:10px"><b>Hardst geraakt in 2008:</b> ' + esc(S.scen[0].worst.map((x) => x.r.c.tk + ' ' + seur(x.r.c.value * x.d)).join(', ')) + '</p>' +
    '<p class="sub" style="margin-top:8px">Dit zijn <b>ruwe historische voorbeelden</b>: benaderingen van de daling van top tot dal per sector in de Amerikaanse markt in 2008–2009, 2020 en 2022, toegepast op je huidige verdeling. ' +
    'Je eigen posities bewogen anders, en een volgende daling verloopt weer anders. Brede fondsen en posities zonder bekende sector krijgen de daling van de hele markt. Geen voorspelling en geen beleggingsadvies.</p></section>';
}

// ---------- 35. Valuta: in welke munt zit je geld, en wat doet een dollar die 10% zakt ----------
// Welke munt zit er achter een positie? Fondsen volgen hun index, los van de munt waarin ze noteren.
const FUND_CUR = { 'S&P 500': { USD: 1 }, 'Nasdaq 100': { USD: 1 }, 'MSCI World': { USD: 0.71, EUR: 0.11, JPY: 0.06, GBP: 0.04, Overig: 0.08 } };
const curName = (k) => ({ USD: 'Amerikaanse dollar', EUR: 'Euro', GBP: 'Brits pond', GBX: 'Brits pond', JPY: 'Japanse yen', CHF: 'Zwitserse frank', Overig: 'Overige munten' }[k] || k);
function curExpModel() {
  const total = M.totalValue || 0;
  const m = new Map();
  const add = (cur, v, viaFund) => { const k = cur === 'GBX' ? 'GBP' : (cur || 'EUR'); const o = m.get(k) || { cur: k, v: 0, via: 0 }; o.v += v; if (viaFund) o.via += v; m.set(k, o); };
  M.companies.forEach((c) => {
    const b = raBench(c);
    const mix = b && FUND_CUR[String(b[0])];
    if (mix) Object.entries(mix).forEach(([k, w]) => add(k, c.value * w, true));
    else add(c.cur || 'EUR', c.value, false);
  });
  const list = [...m.values()].map((o) => Object.assign(o, { w: total ? o.v / total : 0 })).sort((a, b) => b.v - a.v);
  const usd = m.get('USD');
  const nonEur = sum(list.filter((o) => o.cur !== 'EUR').map((o) => o.v));
  const world = M.companies.some((c) => { const b = raBench(c); return b && b[0] === 'MSCI World'; });
  return { list, total, usd: usd ? usd.v : 0, nonEur, world };
}
const CUR_COLORS = { USD: '#2B5BD7', EUR: '#0E7490', GBP: '#6D28D9', JPY: '#B45309', CHF: '#4FB3C8', Overig: '#C9CED6' };
function curExpTile() {
  const E = curExpModel();
  if (!E.total) return '';
  const drop = E.usd * (1 - 1 / 1.1); // 10% zwakkere dollar: de waarde in euro wordt gedeeld door 1,1
  const bar = '<div class="cur-bar" role="img" aria-label="' + esc('Verdeling over munten: ' + E.list.map((o) => curName(o.cur) + ' ' + P1.format(o.w)).join(', ')) + '">' +
    E.list.map((o) => '<i style="flex:' + o.w.toFixed(4) + ';background:' + (CUR_COLORS[o.cur] || '#8FAEF0') + '" data-tip="' + esc(curName(o.cur) + ': ' + P1.format(o.w) + ' (' + eur(o.v) + ')') + '"></i>').join('') + '</div>';
  return '<section class="tile pad cur-exp"><h3>In welke munt zit je geld</h3>' + bar +
    '<div class="cur-key">' + E.list.map((o) => '<span><i style="background:' + (CUR_COLORS[o.cur] || '#8FAEF0') + '"></i>' + esc(o.cur + ' ' + P1.format(o.w)) + '</span>').join('') + '</div>' +
    '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Munt</th><th class="num">Waarde</th><th class="num">Deel</th><th class="num">Via fondsen</th></tr></thead><tbody>' +
    E.list.map((o) => '<tr><td>' + esc(o.cur) + ' <span class="muted small">' + esc(curName(o.cur)) + '</span></td><td class="num">' + esc(eur(o.v)) + '</td><td class="num">' + esc(P1.format(o.w)) + '</td><td class="num">' + esc(o.via >= 0.005 ? eur(o.via) : '–') + '</td></tr>').join('') +
    '</tbody></table></div>' +
    '<div style="margin-top:10px">' + kvList([
      ['Niet in euro', eur(E.nonEur) + ' (' + P1.format(E.total ? E.nonEur / E.total : 0) + ')'],
      ['Als de dollar 10% minder waard wordt', seur(-drop) + ' (' + spct1(E.total ? -drop / E.total : 0) + ' van je beleggingen)', 'loss'],
      ['Als de dollar 10% meer waard wordt', seur(E.usd * 0.1) + ' (' + spct1(E.total ? E.usd * 0.1 / E.total : 0) + ')', 'gain'],
    ]) + '</div>' +
    '<p class="sub" style="margin-top:8px">De munt waarin een fonds noteert zegt niets: wat telt is waarin de bedrijven eronder verdienen. Fondsen op een Amerikaanse index rekenen daarom als dollar' +
    (E.world ? ', een wereldfonds volgens de ongeveer-verdeling van de index (' + esc(P1.format(FUND_CUR['MSCI World'].USD)) + ' dollar)' : '') +
    '. Wisselkoersen gaan beide kanten op; dit is een rekenvoorbeeld.</p></section>';
}

// ---------- 36. Samenhang per paar: details bij een vakje in de warmtekaart ----------
function pairDetail(i, j) {
  const R = riskModel();
  const a = R.mat[i], b = R.mat[j];
  if (!a || !b) return '<p class="muted small">Dat paar is niet meer bekend; open de pagina opnieuw.</p>';
  if (a === b) {
    return '<p class="small"><b>' + esc(a.c.tk + ' – ' + a.c.name) + '</b></p>' + kvList([
      ['Deel van je beleggingen', P1.format(a.w)],
      ['Beweeglijkheid per jaar', isNum(a.vol) ? P1.format(a.vol) + ' (klasse ' + a.cls + ')' : '–'],
      ['Gegevens', NI.format(a.n) + ' dagen, ' + (a.basis || '–')],
    ]);
  }
  const c = R.C2[i][j];
  const days = (() => { let n = 0; a.rets.forEach((_, d) => { if (b.rets.has(d)) n++; }); return n; })();
  // Beweeglijkheid van de twee samen, in verhouding tot hun gewicht
  const wa = a.w / (a.w + b.w), wb = 1 - wa;
  const both = isNum(c) && isNum(a.vol) && isNum(b.vol) ? Math.sqrt(wa * wa * a.vol * a.vol + wb * wb * b.vol * b.vol + 2 * wa * wb * c * a.vol * b.vol) : null;
  const apart = isNum(a.vol) && isNum(b.vol) ? wa * a.vol + wb * b.vol : null;
  const pa = M.mk.ok ? M.mk.profOf(a.c.tk) : null, pb = M.mk.ok ? M.mk.profOf(b.c.tk) : null;
  const sameSec = pa && pb && pa.sector && pa.sector === pb.sector;
  return '<p class="small"><b>' + esc(a.c.tk + ' en ' + b.c.tk) + '</b> ' + esc('(' + a.c.name + ' en ' + b.c.name + ')') + '</p>' + kvList([
    ['Samenhang', isNum(c) ? N2.format(c) + (c >= 0.7 ? ', sterk samen' : c >= 0.4 ? ', deels samen' : c >= 0.1 ? ', weinig samen' : ', los van elkaar') : 'te weinig gegevens', isNum(c) ? (c >= 0.7 ? 'loss' : c < 0.3 ? 'gain' : '') : ''],
    ['Samen in je portefeuille', eur(a.c.value + b.c.value) + ' (' + P1.format(a.w + b.w) + ')'],
    ['Beweeglijkheid los', (isNum(a.vol) ? a.c.tk + ' ' + P1.format(a.vol) : a.c.tk + ' –') + ', ' + (isNum(b.vol) ? b.c.tk + ' ' + P1.format(b.vol) : b.c.tk + ' –')],
    ['Samen als paar', isNum(both) ? P1.format(both) + (isNum(apart) ? ', spreiding levert ' + P1.format(Math.max(0, apart - both)) + ' minder beweging op' : '') : '–', isNum(both) && isNum(apart) && apart - both > 0.002 ? 'gain' : ''],
    ['Zelfde sector', sameSec ? 'ja, ' + sectorNl(pa.sector) : pa && pb && pa.sector && pb.sector ? 'nee (' + sectorNl(pa.sector) + ' en ' + sectorNl(pb.sector) + ')' : 'onbekend', sameSec ? 'loss' : ''],
    ['Gemeenschappelijke dagen', NI.format(days)],
  ]);
}
document.addEventListener('click', (e) => {
  const cell = /** @type {HTMLElement|null} */ (raHit(e, '[data-pair]'));
  if (!cell) return;
  const box = cell.closest('.corr-tile');
  const panel = /** @type {HTMLElement|null} */ (box && box.querySelector('[data-pair-detail]'));
  if (!panel) return;
  const [i, j] = cell.dataset.pair.split('-').map(Number);
  const open = panel.dataset.open === cell.dataset.pair;
  box.querySelectorAll('[data-pair].picked').forEach((el) => el.classList.remove('picked'));
  if (open) { panel.innerHTML = ''; panel.dataset.open = ''; return; }
  cell.classList.add('picked');
  panel.dataset.open = cell.dataset.pair;
  panel.innerHTML = pairDetail(i, j);
});

// ---------- 38. Overlap tussen je fondsen (en met je losse aandelen) ----------
function fundOverlapModel() {
  const etf = data.etf || {};
  const keyFor = raBenchKey;
  const norm = (tk) => ({ FB: 'META', GOOG: 'GOOGL', 'BRK.B': 'BRK', BRKB: 'BRK' }[tk] || tk);
  const funds = [];
  M.companies.forEach((c) => { const k = keyFor(c); if (k && etf[k]) funds.push({ c, k, src: etf[k] }); });
  const total = M.totalValue || 0;
  const direct = new Map();
  M.companies.forEach((c) => { if (!keyFor(c)) direct.set(norm(c.tk), c); });
  // Per bedrijf: hoeveel euro via elk fonds, en hoeveel je er los van hebt
  const per = new Map();
  funds.forEach((f) => {
    f.src.rows.forEach(([tk, nm, , w]) => {
      const k = norm(tk);
      const o = per.get(k) || { tk: k, name: nm, via: {}, viaTot: 0, direct: 0 };
      const v = f.c.value * w / 100;
      o.via[f.c.tk] = (o.via[f.c.tk] || 0) + v;
      o.viaTot += v;
      if (!o.name) o.name = nm;
      per.set(k, o);
    });
  });
  per.forEach((o, k) => { const d = direct.get(k); if (d) o.direct = d.value; });
  const list = [...per.values()].map((o) => Object.assign(o, { total: o.viaTot + o.direct })).sort((a, b) => b.total - a.total);
  // Paren fondsen: hoeveel van beide fondsen zit in dezelfde bedrijven
  const pairs = [];
  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      const A = new Map(funds[i].src.rows.map(([tk, , , w]) => [norm(tk), w]));
      const shared = funds[j].src.rows.map(([tk, nm, , w]) => ({ tk: norm(tk), nm, w: Math.min(w, A.get(norm(tk)) || 0) })).filter((x) => x.w > 0);
      pairs.push({ a: funds[i], b: funds[j], shared: shared.sort((x, y) => y.w - x.w), w: sum(shared.map((x) => x.w)) / 100 });
    }
  }
  const doubled = list.filter((o) => o.direct > 0 && o.viaTot > 0);
  return { funds, list, pairs, doubled, total, viaDouble: sum(doubled.map((o) => o.viaTot)), fundValue: sum(funds.map((f) => f.c.value)) };
}
function fundOverlapTile() {
  const O = fundOverlapModel();
  if (!O.funds.length) {
    const anyFund = M.companies.some((c) => isFundC(c));
    return '<section class="tile pad"><h3>Overlap in je fondsen</h3><p class="muted">' +
      esc(anyFund ? 'Hiervoor is de samenstelling van je indexfondsen nodig. Die voeg je toe op Plannen, onder "Werkelijke spreiding".' : 'Je hebt geen brede indexfondsen, dus er is geen overlap tussen fondsen.') + '</p></section>';
  }
  const top = O.list.slice(0, 10);
  const warn = O.pairs.filter((p) => p.w >= 0.3);
  return '<section class="tile pad overlap span-2"><h3>Overlap in je fondsen</h3>' +
    (warn.length ? '<p class="small loss" style="margin-top:4px"><b>Let op:</b> ' + esc(warn.map((p) => p.a.c.tk + ' en ' + p.b.c.tk + ' zitten voor ongeveer ' + P1.format(p.w) + ' in dezelfde bedrijven').join('; ')) + '.</p>'
      : '<p class="small gain" style="margin-top:4px">Je fondsen overlappen weinig met elkaar.</p>') +
    (O.doubled.length ? '<p class="small" style="margin-top:8px">' + esc('Je hebt ' + O.doubled.length + ' ' + (O.doubled.length === 1 ? 'bedrijf' : 'bedrijven') + ' los én via een fonds: ' + eur(O.viaDouble) + ' extra via fondsen (' + P1.format(O.total ? O.viaDouble / O.total : 0) + ' van je beleggingen).') + '</p>' : '') +
    '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Bedrijf</th>' + O.funds.map((f) => '<th class="num">Via ' + esc(f.c.tk) + '</th>').join('') + '<th class="num">Los</th><th class="num">Samen</th><th class="num">Deel</th></tr></thead><tbody>' +
    top.map((o) => '<tr' + (M.byTk.has(o.tk) ? ' class="rowlink" data-ticker="' + esc(o.tk) + '"' : '') + '><td class="co"><b>' + esc(o.tk) + '</b><span class="nm">' + esc(o.name) + '</span></td>' +
      O.funds.map((f) => '<td class="num">' + esc(o.via[f.c.tk] >= 0.005 ? eur(o.via[f.c.tk]) : '–') + '</td>').join('') +
      '<td class="num">' + esc(o.direct ? eur(o.direct) : '–') + '</td><td class="num">' + esc(eur(o.total)) + '</td>' +
      '<td class="num' + (O.total && o.total / O.total > 0.1 ? ' loss' : '') + '">' + esc(P1.format(O.total ? o.total / O.total : 0)) + '</td></tr>').join('') +
    '</tbody></table></div>' +
    (O.pairs.length ? '<div style="margin-top:10px">' + kvList(O.pairs.map((p) => [p.a.c.tk + ' en ' + p.b.c.tk + ': zelfde bedrijven',
      P1.format(p.w) + (p.shared.length ? ' – grootste: ' + p.shared.slice(0, 3).map((x) => x.tk).join(', ') : ''), p.w >= 0.3 ? 'loss' : ''])) + '</div>' : '') +
    '<p class="sub" style="margin-top:8px">Samenstelling volgens ' + esc(O.funds.map((f) => f.src.fund + (f.src.asOf ? ', ' + f.src.asOf : '')).join(' en ')) +
      ', alleen de grootste posities per fonds. Twee fondsen met veel dezelfde bedrijven spreiden samen minder dan het lijkt. Alphabet A en C zijn samengeteld.</p></section>';
}

// ---------- 39. Waar je resultaat vandaan komt: per sector en per munt ----------
function attribModel() {
  const bySec = new Map(), byCur = new Map();
  M.companies.forEach((c) => {
    const sct = M.mk.ok ? M.mk.sectorOf(c) : (isFundC(c) ? FUNDS : 'Onbekend');
    const label = sct === FUNDS ? 'Brede fondsen' : sct === 'Onbekend' ? 'Onbekend' : sectorNl(sct);
    const s = bySec.get(label) || { label, v: 0, res: 0, n: 0 };
    s.v += c.value; s.res += isNum(c.unreal) ? c.unreal : 0; s.n++; bySec.set(label, s);
    const cur = (c.cur === 'GBX' ? 'GBP' : c.cur) || 'EUR';
    const k = byCur.get(cur) || { cur, v: 0, res: 0, fx: 0, fxKnown: false };
    k.v += c.value; k.res += isNum(c.unreal) ? c.unreal : 0;
    if (isNum(c.fx)) { k.fx += c.fx; k.fxKnown = true; }
    byCur.set(cur, k);
  });
  const res = sum(M.companies.map((c) => (isNum(c.unreal) ? c.unreal : 0)));
  const fxTot = sum(M.companies.map((c) => (isNum(c.fx) ? c.fx : 0)));
  return { secs: [...bySec.values()].sort((a, b) => b.res - a.res), curs: [...byCur.values()].sort((a, b) => b.v - a.v), res, fxTot, anyFx: M.companies.some((c) => isNum(c.fx)) };
}
function attribTile() {
  const A = attribModel();
  if (!M.companies.length) return '';
  const share = (v) => (A.res ? v / Math.abs(A.res) : null);
  return '<section class="tile pad full attrib"><h3>Waar je resultaat vandaan komt</h3>' +
    '<div class="scen-res"><div><span class="muted small">Ongerealiseerd resultaat</span><b class="v big ' + tone(A.res) + '">' + esc(seur(A.res)) + '</b><span class="muted small">open posities, nu</span></div>' +
    '<div><span class="muted small">Waarvan door de koersen</span><b class="v big ' + tone(A.res - A.fxTot) + '">' + esc(seur(A.res - A.fxTot)) + '</b><span class="muted small">' + esc(A.anyFx ? 'resultaat min het valuta-effect' : 'geen valuta-effect bekend') + '</span></div>' +
    '<div><span class="muted small">Waarvan door de wisselkoers</span><b class="v big ' + tone(A.fxTot) + '">' + esc(A.anyFx ? seur(A.fxTot) : '–') + '</b><span class="muted small">' + esc(A.anyFx ? 'volgens Trading 212' : 'alleen bij posities in een andere munt') + '</span></div></div>' +
    '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Sector</th><th class="num">Posities</th><th class="num">Waarde</th><th class="num">Resultaat</th><th class="num">Deel van het resultaat</th></tr></thead><tbody>' +
    A.secs.map((s) => '<tr><td>' + esc(s.label) + '</td><td class="num">' + s.n + '</td><td class="num">' + esc(eur(s.v)) + '</td>' +
      '<td class="num ' + tone(s.res) + '">' + esc(seur(s.res)) + '</td><td class="num">' + esc(isNum(share(s.res)) ? spct1(share(s.res)) : '–') + '</td></tr>').join('') + '</tbody></table></div>' +
    '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Munt</th><th class="num">Waarde</th><th class="num">Resultaat</th><th class="num">Door de wisselkoers</th><th class="num">Door de koers</th></tr></thead><tbody>' +
    A.curs.map((k) => '<tr><td>' + esc(k.cur) + ' <span class="muted small">' + esc(curName(k.cur)) + '</span></td><td class="num">' + esc(eur(k.v)) + '</td>' +
      '<td class="num ' + tone(k.res) + '">' + esc(seur(k.res)) + '</td><td class="num ' + tone(k.fx) + '">' + esc(k.fxKnown ? seur(k.fx) : '–') + '</td>' +
      '<td class="num ' + tone(k.res - k.fx) + '">' + esc(k.fxKnown ? seur(k.res - k.fx) : seur(k.res)) + '</td></tr>').join('') + '</tbody></table></div>' +
    '<p class="sub" style="margin-top:8px">Het resultaat van je open posities, uitgesplitst naar sector en naar de munt waarin ze noteren. Het valuta-effect komt van Trading 212 (het verschil tussen de koers in de eigen munt en in euro); verkochte posities en dividend staan er niet in. Een deel groter dan 100% kan: winst in de ene sector kan verlies in de andere opheffen.</p></section>';
}

// ---------- 40. Rollend rendement ----------
const ROLL_WINS = [{ n: 252, label: '12 maanden' }, { n: 126, label: '6 maanden' }, { n: 63, label: '3 maanden' }, { n: 21, label: '1 maand' }];
function rollingModel(n) {
  const T = twrSeries(TOTAL).filter((p) => isNum(p.v));
  if (T.length < 12) return null;
  const avail = ROLL_WINS.filter((w) => T.length > w.n + 3);
  if (!avail.length) return { T, avail, win: null };
  const pick = avail.find((w) => w.n === n) || avail[0];
  const win = pick.n;
  const pts = [];
  for (let i = win; i < T.length; i++) pts.push({ t: T[i].t, v: T[i].v / T[i - win].v - 1 });
  const vals = pts.map((p) => p.v);
  return { T, avail, win, label: pick.label, pts, best: Math.max(...vals), worst: Math.min(...vals), avg: mean(vals), posShare: vals.filter((v) => v > 0).length / vals.length };
}
function rollingTile() {
  const R = rollingModel(raState.rollN);
  if (!R) return '<section class="tile pad"><h3>Rollend rendement</h3><p class="muted">Hiervoor zijn minstens twaalf meetdagen nodig.</p></section>';
  if (!R.win) return '<section class="tile pad"><h3>Rollend rendement</h3><p class="muted">Je meet nog geen maand; na ongeveer 25 meetdagen verschijnt hier het rendement over elke voorbije maand.</p></section>';
  return '<section class="tile pad roll"><h3>Rollend rendement over ' + esc(R.label) + '</h3>' +
    (R.avail.length > 1 ? '<div class="raseg" role="group" aria-label="Periode">' + R.avail.map((w) =>
      '<button type="button" data-roll="' + w.n + '" aria-pressed="' + (w.n === R.win) + '">' + esc(w.label) + '</button>').join('') + '</div>' : '') +
    '<div class="chart" data-chart="roll" style="height:150px;margin-top:8px"></div><div class="xlabels" data-x="roll"></div>' +
    '<div style="margin-top:10px">' + kvList([
      ['Nu', spct1(R.pts[R.pts.length - 1].v), tone(R.pts[R.pts.length - 1].v)],
      ['Beste periode', spct1(R.best), tone(R.best)],
      ['Slechtste periode', spct1(R.worst), tone(R.worst)],
      ['Gemiddeld', spct1(R.avg), tone(R.avg)],
      ['Periodes met winst', P1.format(R.posShare) + ' van ' + NI.format(R.pts.length)],
    ]) + '</div>' +
    '<p class="sub" style="margin-top:8px">Elk punt is het tijdgewogen rendement over de ' + esc(R.label) + ' die eraan voorafgingen; stortingen tellen niet als rendement. ' +
    (R.win < 252 ? 'Zodra je een jaar meet, kun je hier ook 12 maanden kiezen.' : '') + '</p></section>';
}
function drawRolling(root) {
  const host = root.querySelector('[data-chart="roll"]');
  if (!host) return;
  const R = rollingModel(raState.rollN);
  if (!R || !R.win) return;
  lineChart(host, [{ pts: R.pts, color: C.accent, width: 2.5, fmt: spct1 }], { zero: true, top: 0.08, bottom: 0.08,
    xl: root.querySelector('[data-x="roll"]'), xcount: 3, xfmt: (t) => fDM.format(t), tfmt: (t) => fD.format(t), fmt: spct1 });
}
document.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement|null} */ (raHit(e, '[data-roll]'));
  if (!b) return;
  raState.rollN = Number(b.dataset.roll) || 0;
  refresh('analyse');
});

// ---------- 41. Dalingen en hoe lang het herstel duurde ----------
function ddEpisodes(minPct) {
  const T = twrSeries(TOTAL).filter((p) => isNum(p.v));
  if (T.length < 10) return null;
  const out = [];
  let peak = T[0];
  /** @type {{ t: number, v: number } | null} */
  let trough = null;
  T.forEach((p) => {
    if (p.v >= peak.v) {
      if (trough) {
        const depth = trough.v / peak.v - 1;
        if (depth <= -minPct) out.push({ from: peak.t, at: trough.t, depth, back: p.t, days: Math.round((p.t - trough.t) / DAY), down: Math.round((trough.t - peak.t) / DAY) });
        trough = null;
      }
      peak = p;
    } else if (!trough || p.v < trough.v) trough = p;
  });
  if (trough) {
    const depth = trough.v / peak.v - 1;
    if (depth <= -minPct) out.push({ from: peak.t, at: trough.t, depth, back: null, days: null, down: Math.round((trough.t - peak.t) / DAY), open: true });
  }
  const done = out.filter((x) => x.back);
  return { list: out.sort((a, b) => a.depth - b.depth), nDays: T.length, from: T[0].t, medianDays: done.length ? [...done.map((x) => x.days)].sort((a, b) => a - b)[Math.floor(done.length / 2)] : null };
}
const DD_STEPS = [[1, '1%'], [2, '2%'], [5, '5%'], [10, '10%']];
function ddRecoveryTile() {
  const minPct = raState.ddMin / 100;
  const D = ddEpisodes(minPct);
  if (!D) return '<section class="tile pad"><h3>Dalingen en herstel</h3><p class="muted">Hiervoor zijn minstens tien meetdagen nodig.</p></section>';
  const dt = (t) => fDM.format(t) + ' ' + fYear(t);
  return '<section class="tile pad dd-rec"><h3>Dalingen en herstel</h3>' +
    '<div class="raseg" role="group" aria-label="Vanaf welke daling">' + DD_STEPS.map(([v, l]) =>
      '<button type="button" data-ddmin="' + v + '" aria-pressed="' + (v === raState.ddMin) + '">vanaf ' + esc(l) + '</button>').join('') + '</div>' +
    (D.list.length ? '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Vanaf de top</th><th class="num">Diepste punt</th><th class="num">Daling</th><th class="num">Dagen omlaag</th><th>Hersteld</th><th class="num">Dagen herstel</th></tr></thead><tbody>' +
      D.list.map((x) => '<tr><td>' + esc(dt(x.from)) + '</td><td class="num">' + esc(dt(x.at)) + '</td><td class="num loss">' + esc(spct1(x.depth)) + '</td>' +
        '<td class="num">' + esc(NI.format(x.down)) + '</td><td>' + esc(x.back ? dt(x.back) : 'nog niet') + '</td>' +
        '<td class="num">' + esc(x.back ? NI.format(x.days) : '–') + '</td></tr>').join('') + '</tbody></table></div>' +
      '<div style="margin-top:10px">' + kvList([
        ['Aantal dalingen', NI.format(D.list.length) + ' vanaf ' + raState.ddMin + '%'],
        ['Nog niet hersteld', D.list.some((x) => x.open) ? 'ja, de laatste daling loopt nog' : 'nee, alle dalingen zijn ingelopen'],
        ['Herstel duurde meestal', isNum(D.medianDays) ? NI.format(D.medianDays) + ' dagen (middelste)' : '–'],
      ]) + '</div>'
      : '<p class="muted" style="margin-top:10px">Geen daling van ' + raState.ddMin + '% of meer in je ' + NI.format(D.nDays) + ' meetdagen. Kies een lagere grens om kleinere dalingen te zien.</p>') +
    '<p class="sub" style="margin-top:8px">Tijdgewogen vanaf ' + esc(dt(D.from)) + ': aankopen en verkopen tellen niet als stijging of daling. "Dagen" zijn kalenderdagen tussen de metingen. Hoe lang een herstel duurde zegt niets over een volgende keer.</p></section>';
}
document.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement|null} */ (raHit(e, '[data-ddmin]'));
  if (!b) return;
  raState.ddMin = Number(b.dataset.ddmin) || 2;
  refresh('analyse');
});

// ---------- 42. Kostenrem: wat kosten je af van je resultaat ----------
function feeDragModel() {
  const tr = M.tx.trades.filter((x) => isNum(x.net));
  const fee = (x) => (isNum(x.feeFx) ? x.feeFx : 0) + (isNum(x.feeOther) ? x.feeOther : 0);
  const totFee = sum(tr.map(fee)), totFx = sum(tr.map((x) => (isNum(x.feeFx) ? x.feeFx : 0)));
  const byYear = new Map();
  tr.forEach((x) => { const y = new Date(x.t).getFullYear(); const o = byYear.get(y) || { y, fee: 0, fx: 0, vol: 0, n: 0 }; o.fee += fee(x); o.fx += isNum(x.feeFx) ? x.feeFx : 0; o.vol += x.net; o.n++; byYear.set(y, o); });
  let acc = 0;
  const cum = tr.slice().sort((a, b) => a.t - b.t).map((x) => { acc += fee(x); return { t: x.t, v: acc }; });
  const W = M.weeks.filter((w) => isNum(w.totalResult));
  const result = W.length ? W[W.length - 1].totalResult : null;
  const dep = W.length && isNum(W[W.length - 1].netDeposits) ? W[W.length - 1].netDeposits : null;
  const years = tr.length ? Math.max(0.25, (Date.now() - Math.min(...tr.map((x) => x.t))) / (365.25 * DAY)) : null;
  return { tr, totFee, totFx, byYear: [...byYear.values()].sort((a, b) => b.y - a.y), cum, result, dep, years,
    perYear: isNum(years) && years > 0 ? totFee / years : null, dragPct: isNum(dep) && dep > 0 && isNum(years) && years > 0 ? (totFee / years) / dep : null };
}
function feeDragTile() {
  const F = feeDragModel();
  if (!F.tr.length) return '';
  const vsRes = isNum(F.result) && F.result !== 0 ? F.totFee / Math.abs(F.result) : null;
  return '<section class="tile pad fee-drag"><h3>Kostenrem</h3>' +
    '<div class="fx-head"><span class="v big">' + esc(eur(F.totFee)) + '</span><span class="muted small">kosten in totaal, waarvan ' + esc(eur(F.totFx)) + ' ' + trm('wisselkosten', 'fxfee') + '</span></div>' +
    (F.cum.length > 2 ? '<div class="chart" data-chart="fee" style="height:120px;margin-top:8px"></div><div class="xlabels" data-x="fee"></div>' : '') +
    '<div style="margin-top:10px">' + kvList([
      ['Tegenover je resultaat', isNum(vsRes) ? P1.format(vsRes) + ' van ' + eur(Math.abs(F.result)) + (F.result < 0 ? ' verlies' : ' winst') : '–', isNum(vsRes) && vsRes > 0.1 ? 'loss' : ''],
      ['Kosten per jaar', isNum(F.perYear) ? eur(F.perYear) + (F.years < 1 ? ', doorgerekend vanaf ' + N1.format(F.years * 12) + ' maanden orders' : '') : '–'],
      ['Als deel van je inleg per jaar', isNum(F.dragPct) ? P2.format(F.dragPct) : '–', isNum(F.dragPct) && F.dragPct > 0.005 ? 'loss' : 'gain'],
      ['Orders', NI.format(F.tr.length) + ', gemiddeld ' + eur(F.totFee / F.tr.length) + ' kosten'],
    ]) + '</div>' +
    '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Jaar</th><th class="num">Orders</th><th class="num">Omgezet</th><th class="num">Kosten</th><th class="num">Deel van de omzet</th></tr></thead><tbody>' +
    F.byYear.map((o) => '<tr><td>' + o.y + '</td><td class="num">' + o.n + '</td><td class="num">' + esc(eur(o.vol)) + '</td><td class="num">' + esc(eur(o.fee)) + '</td>' +
      '<td class="num">' + esc(o.vol ? P2.format(o.fee / o.vol) : '–') + '</td></tr>').join('') + '</tbody></table></div>' +
    '<p class="sub" style="margin-top:8px">Alle kosten uit je ordergeschiedenis: wisselkosten (0,15% bij Trading 212 buiten de euro) plus overige kosten. Trading 212 rekent geen aankoopkosten; de lopende kosten van fondsen zitten hier niet in, die worden uit de koers van het fonds betaald.</p></section>';
}
function drawFeeDrag(root) {
  const host = root.querySelector('[data-chart="fee"]');
  if (!host) return;
  const F = feeDragModel();
  if (F.cum.length < 3) return;
  lineChart(host, [{ pts: F.cum, color: C.loss, width: 2.5, fmt: eur }], { top: 0.1, bottom: 0.06,
    xl: root.querySelector('[data-x="fee"]'), xcount: 3, xfmt: (t) => fDM.format(t), tfmt: (t) => fD.format(t), fmt: eur });
}

// ---------- 79. Doorkijk: werkelijke blootstelling per bedrijf, sector en land ----------
const ETF_SECTOR = { 'Information Technology': 'Technology', Communication: 'Communication Services', 'Communication Services': 'Communication Services',
  'Consumer Discretionary': 'Consumer Cyclical', 'Consumer Staples': 'Consumer Defensive', 'Health Care': 'Healthcare', Financials: 'Financial Services',
  Materials: 'Basic Materials', Industrials: 'Industrials', Energy: 'Energy', Utilities: 'Utilities', 'Real Estate': 'Real Estate' };
const COUNTRY_NL = { US: 'Verenigde Staten', NL: 'Nederland', DE: 'Duitsland', FR: 'Frankrijk', GB: 'Verenigd Koninkrijk', CH: 'Zwitserland', IE: 'Ierland', DK: 'Denemarken',
  SE: 'Zweden', ES: 'Spanje', IT: 'Italië', BE: 'België', JP: 'Japan', TW: 'Taiwan', KR: 'Zuid-Korea', CN: 'China', HK: 'Hongkong', CA: 'Canada', IN: 'India', BR: 'Brazilië', AU: 'Australië' };
const landNl = (k) => (k ? COUNTRY_NL[k] || k : 'Onbekend');
function lookAllModel() {
  const etf = data.etf || {};
  const keyFor = raBenchKey;
  const norm = (tk) => ({ FB: 'META', GOOG: 'GOOGL', 'BRK.B': 'BRK', BRKB: 'BRK' }[tk] || tk);
  const total = M.totalValue || 0;
  const comp = new Map(), sec = new Map(), land = new Map();
  const addTo = (map, key, label, v) => { const o = map.get(key) || { key, label, v: 0 }; o.v += v; map.set(key, o); };
  let covered = 0, rest = 0, fundValue = 0, usedFunds = [];
  M.companies.forEach((c) => {
    const k = keyFor(c);
    const src = k && etf[k];
    if (k) fundValue += c.value;
    if (src) {
      if (!usedFunds.includes(src)) usedFunds.push(src);
      const inRows = sum(src.rows.map(([, , , w]) => w)) / 100;
      src.rows.forEach(([tk, nm, s, w]) => {
        const v = c.value * w / 100;
        const key = norm(tk);
        const o = comp.get(key) || { key, name: nm, direct: 0, via: 0 };
        o.via += v; if (!o.name) o.name = nm; comp.set(key, o);
        const sKey = ETF_SECTOR[s] || s || 'Onbekend';
        addTo(sec, sKey, sectorNl(sKey), v);
        // Een fonds op een Amerikaanse index: de bedrijven staan in de Verenigde Staten
        const prof = M.mk.ok ? M.mk.prof(key) : null;
        addTo(land, (prof && prof.country) || 'US', landNl((prof && prof.country) || 'US'), v);
      });
      covered += c.value * inRows;
      rest += c.value * (1 - inRows);
    } else {
      const key = norm(c.tk);
      const o = comp.get(key) || { key, name: c.name, direct: 0, via: 0 };
      o.direct += c.value; comp.set(key, o);
      const p = M.mk.ok ? M.mk.profOf(c.tk) : null;
      const sKey = p && p.sector ? p.sector : (isFundC(c) ? '@fund' : 'Onbekend');
      addTo(sec, sKey, sKey === '@fund' ? 'Fondsen zonder samenstelling' : sectorNl(sKey), c.value);
      const ct = p && p.country ? p.country : null;
      addTo(land, ct || '@unknown', ct ? landNl(ct) : 'Onbekend', c.value);
    }
  });
  if (rest > 0.5) { addTo(sec, '@rest', 'Rest van de fondsen', rest); addTo(land, '@rest', 'Rest van de fondsen', rest); }
  const fin = (map) => [...map.values()].map((o) => Object.assign(o, { w: total ? o.v / total : 0 })).sort((a, b) => b.v - a.v);
  const comps = [...comp.values()].map((o) => Object.assign(o, { v: o.direct + o.via, w: total ? (o.direct + o.via) / total : 0 })).sort((a, b) => b.v - a.v);
  return { comps, secs: fin(sec), lands: fin(land), total, covered, rest, fundValue, usedFunds, hasEtf: usedFunds.length > 0 };
}
const LOOK_TABS = [['sector', 'Per sector'], ['land', 'Per land'], ['bedrijf', 'Per bedrijf']];
function lookAllTile() {
  const L = lookAllModel();
  if (!L.total) return '';
  const tab = LOOK_TABS.some(([k]) => k === raState.lookTab) ? raState.lookTab : 'sector';
  const list = tab === 'sector' ? L.secs : tab === 'land' ? L.lands : L.comps.slice(0, 20);
  const mx = Math.max(1e-9, ...list.map((o) => o.v));
  const head = tab === 'bedrijf' ? '<tr><th>Bedrijf</th><th class="num">Los</th><th class="num">Via fondsen</th><th class="num">Samen</th><th class="num">Deel</th><th></th></tr>'
    : '<tr><th>' + (tab === 'land' ? 'Land' : 'Sector') + '</th><th class="num">Waarde</th><th class="num">Deel</th><th></th></tr>';
  const bar = (v) => '<td class="barc"><span class="bar-mini wide"><i style="width:' + (v / mx * 100).toFixed(1) + '%"></i></span></td>';
  const rows = list.map((o) => (tab === 'bedrijf'
    ? '<tr' + (M.byTk.has(o.key) ? ' class="rowlink" data-ticker="' + esc(o.key) + '"' : '') + '><td class="co"><b>' + esc(o.key) + '</b><span class="nm">' + esc(o.name) + '</span></td>' +
      '<td class="num">' + esc(o.direct >= 0.005 ? eur(o.direct) : '–') + '</td><td class="num">' + esc(o.via >= 0.005 ? eur(o.via) : '–') + '</td>' +
      '<td class="num">' + esc(eur(o.v)) + '</td><td class="num">' + esc(P1.format(o.w)) + '</td>' + bar(o.v) + '</tr>'
    : '<tr><td>' + esc(o.label) + '</td><td class="num">' + esc(eur(o.v)) + '</td><td class="num">' + esc(P1.format(o.w)) + '</td>' + bar(o.v) + '</tr>')).join('');
  const top10 = sum(L.comps.slice(0, 10).map((o) => o.v));
  return '<section class="tile pad full look-all"><h3>Doorkijk: waar je geld werkelijk in zit</h3>' +
    '<div class="raseg" role="group" aria-label="Indeling">' + LOOK_TABS.map(([k, l]) =>
      '<button type="button" data-look="' + k + '" aria-pressed="' + (k === tab) + '">' + esc(l) + '</button>').join('') + '</div>' +
    (L.hasEtf ? '' : '<p class="small muted" style="margin-top:8px">Nog zonder de samenstelling van je indexfondsen: die voeg je toe op Plannen, onder "Werkelijke spreiding". Nu staan de fondsen als één post.</p>') +
    '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
    '<div style="margin-top:12px">' + kvList([
      ['Grootste 10 bedrijven samen', P1.format(L.total ? top10 / L.total : 0), L.total && top10 / L.total > 0.5 ? 'loss' : ''],
      ['Aantal bedrijven', NI.format(L.comps.length) + (L.hasEtf ? ' (de grootste posities van je fondsen meegerekend)' : '')],
      ['Via fondsen doorgerekend', L.hasEtf ? eur(L.covered) + ' van ' + eur(L.fundValue) : '–'],
      ['Grootste sector', L.secs[0] ? L.secs[0].label + ' ' + P1.format(L.secs[0].w) : '–', L.secs[0] && L.secs[0].w > 0.4 ? 'loss' : ''],
      ['Grootste land', L.lands[0] ? L.lands[0].label + ' ' + P1.format(L.lands[0].w) : '–', L.lands[0] && L.lands[0].w > 0.7 ? 'loss' : ''],
    ]) + '</div>' +
    '<p class="sub" style="margin-top:8px">Je losse aandelen plus wat er via je indexfondsen in zit' + (L.hasEtf ? ', volgens ' + esc(L.usedFunds.map((f) => f.fund + (f.asOf ? ', ' + f.asOf : '')).join(' en ')) : '') + '. ' +
    'Een fonds geeft alleen zijn grootste posities; het deel dat daarbuiten valt staat als "Rest van de fondsen". Het land komt van FMP waar bekend, en anders van de index van het fonds. Alphabet A en C zijn samengeteld.</p></section>';
}
document.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement|null} */ (raHit(e, '[data-look]'));
  if (!b) return;
  raState.lookTab = b.dataset.look;
  refresh('analyse');
});

// ---------- 80. Wisselkosten vooruit: wat kost omwisselen per jaar bij je huidige tempo ----------
const FX_RATE = 0.0015; // Trading 212: 0,15% bij kopen en verkopen buiten de euro
function fxCalcModel() {
  const yearAgo = Date.now() - 365 * DAY;
  const tr = M.tx.trades.filter((x) => isNum(x.net) && x.t >= yearAgo);
  const vol = sum(tr.map((x) => Math.abs(x.net)));
  const foreign = sum(tr.filter((x) => (x.cur || 'EUR') !== 'EUR').map((x) => Math.abs(x.net)));
  const paid = sum(tr.map((x) => (isNum(x.feeFx) ? x.feeFx : 0)));
  const monthlyPace = vol / 12;
  const monthly = isNum(raState.fcMonthly) ? raState.fcMonthly
    : isNum(M.settings.monthly) && Number(M.settings.monthly) > 0 ? Number(M.settings.monthly)
      : monthlyPace > 0 ? Math.round(monthlyPace) : 100;
  const share = isNum(raState.fcShare) ? raState.fcShare : vol > 0 ? Math.round(foreign / vol * 100) : 70;
  const perYear = monthly * 12 * (share / 100) * FX_RATE;
  return { tr, vol, foreign, paid, monthly, share, perYear, tenYear: perYear * 10, actualShare: vol > 0 ? foreign / vol : null, n: tr.length };
}
function fxCalcTile() {
  const F = fxCalcModel();
  return '<section class="tile pad fx-calc"><h3>Wisselkosten vooruit</h3>' +
    '<p class="small muted" style="margin-top:4px">Wat kost het omwisselen je per jaar als je in dit tempo blijft kopen?</p>' +
    '<div class="plan-inputs" style="margin-top:8px">' +
    '<label>Ik koop per maand<span class="eur-in">€<input type="number" min="0" step="10" value="' + F.monthly + '" data-fc="monthly"></span></label>' +
    '<label>Daarvan niet in euro<span class="eur-in"><input type="number" min="0" max="100" step="5" value="' + F.share + '" data-fc="share">%</span></label></div>' +
    '<div class="fc-res" data-fc-res>' + fxCalcRes(F) + '</div>' +
    '<div style="margin-top:10px">' + kvList([
      ['Je tempo, laatste 12 maanden', F.n ? eur(F.vol) + ' omgezet in ' + NI.format(F.n) + ' orders' : 'nog geen orders in het laatste jaar'],
      ['Daarvan niet in euro', F.n ? eur(F.foreign) + (isNum(F.actualShare) ? ' (' + P1.format(F.actualShare) + ')' : '') : '–'],
      ['Werkelijk betaald, laatste 12 maanden', F.n ? eur(F.paid) : '–'],
    ]) + '</div>' +
    '<p class="sub" style="margin-top:8px">Trading 212 rekent ' + esc(P2.format(FX_RATE)) + ' over het bedrag bij kopen en verkopen in een andere munt dan euro. Een fonds of aandeel dat in euro noteert (Xetra, Euronext) kost die wisselkosten niet; de koers van de onderliggende bedrijven beweegt wel nog met de dollar mee. Een rekenvoorbeeld bij gelijk tempo, geen beleggingsadvies.</p></section>';
}
function fxCalcRes(F) {
  return '<div class="scen-res"><div><span class="muted small">Per jaar</span><b class="v big loss">' + esc(eur(F.perYear)) + '</b><span class="muted small">' + esc('bij ' + eur(F.monthly) + ' per maand, ' + F.share + '% buiten de euro') + '</span></div>' +
    '<div><span class="muted small">Over 10 jaar</span><b class="v big loss">' + esc(eur(F.tenYear)) + '</b><span class="muted small">zonder rendement op dat geld</span></div>' +
    '<div><span class="muted small">Alles in euro gekocht</span><b class="v big gain">' + esc(eur(0)) + '</b><span class="muted small">dan bespaar je ' + esc(eur(F.perYear)) + ' per jaar</span></div></div>';
}
document.addEventListener('input', (e) => {
  const el = /** @type {HTMLInputElement|null} */ (raHit(e, '[data-fc]'));
  if (!el) return;
  const v = Number(el.value);
  if (el.dataset.fc === 'monthly') raState.fcMonthly = isNum(v) && v >= 0 ? v : null;
  if (el.dataset.fc === 'share') raState.fcShare = isNum(v) ? Math.max(0, Math.min(100, v)) : null;
  const html = fxCalcRes(fxCalcModel());
  document.querySelectorAll('[data-fc-res]').forEach((h) => { h.innerHTML = html; });
});

// ---------- 43. Analyse als rapport afdrukken (de browser maakt er een pdf van) ----------
function reportHead() {
  const W = M.weeks.filter((w) => isNum(w.accountValue));
  const last = W.length ? W[W.length - 1] : null;
  return '<div class="report-head" aria-hidden="true">' +
    '<p><b>' + esc('Rapport van ' + new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }).format(Date.now())) + '</b></p>' +
    '<p>' + esc('Accountwaarde ' + eur(M.accountNow) + (last && isNum(last.totalResult) ? ' · totaal resultaat ' + seur(last.totalResult) : '') + ' · ' + M.companies.length + ' posities') + '</p>' +
    '<p class="report-note">Eigen overzicht uit de Investeringstracker. Getallen komen van Trading 212 en de gekoppelde bronnen en kunnen afwijken van je jaaroverzicht. Geen beleggingsadvies.</p></div>';
}
function startReport() {
  const root = document.documentElement;
  root.dataset.report = '1';
  // Op de telefoon tekent Analyse alleen het open tabblad; voor het rapport tijdelijk alle onderdelen
  const full = mode === 'm' && typeof analyseAll === 'boolean' && !analyseAll;
  if (full) { analyseAll = true; refresh('analyse'); }
  let over = false;
  const done = () => {
    if (over) return; over = true;
    delete root.dataset.report; window.removeEventListener('afterprint', done);
    if (full) { analyseAll = false; refresh('analyse'); }
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => { try { window.print(); } catch (err) { done(); } }, 60);
  setTimeout(done, 30000); // valnet: als afterprint niet komt (sommige browsers)
}
document.addEventListener('click', (e) => {
  if (raHit(e, '[data-report-print]')) startReport();
});

// ---------- Tekenen en inhangen ----------
// De risicopagina krijgt geen tekenstap van de router; daarom haalt de weergave zichzelf op na het invoegen
function riskExtraTiles() {
  return [riskWhatIfTile(), curExpTile(), stressTile(), fundOverlapTile()];
}
function mountRiskExtra() {
  mountWhatIf();
}
defineView('risk-extra', () => { if (ui.detail === RISK) renderDetail(false); });

function analyseExtraTiles() {
  return [rollingTile(), ddRecoveryTile(), attribTile(), feeDragTile()];
}
function mountAnalyseExtra(root) {
  if (!root) return;
  drawRolling(root);
  drawFeeDrag(root);
}
