/* Investeringstracker – Plannen: streefverdeling, vooruitblik, spreiding, export
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

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
