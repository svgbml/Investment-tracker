/* Investeringstracker – Markt en onderzoek: marktoverzicht, economische agenda, screener, ETF-zoeker, deponeringen (SEC),
 * 13F van grote beleggers, insiderclusters, koersreactie op cijfers, extra's voor volglijst en nieuws, status en foutmeldingen
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

const mkState = { scrSector: 'all', scrPe: '', scrDy: '', scrDrop: '', scrSort: 'drop', etfIdx: 'all', f13: 0, watchTag: null };
const ext2 = () => (data && data.ext2) || {};

// ---------- Marktoverzicht ----------
function lastTwo(ser) { const a = (ser || []).filter((x) => isNum(x[1])); return a.length ? { v: a[a.length - 1][1], d: a[a.length - 1][0], prev: a.length > 1 ? a[a.length - 2][1] : null, m: a.length > 22 ? a[a.length - 22][1] : null, ser: a } : null; }
function mkOverviewTile() {
  const S = (data.idx && data.idx.series) || {};
  const fx = data.fx && data.fx.rates && data.fx.rates.USD;
  const items = [
    ['S&P 500', lastTwo(S.SP500), 'idx'], ['Nasdaq-100', lastTwo(S.NASDAQ100), 'idx'], ['VIX (angstindex)', lastTwo(S.VIXCLS), 'vix'],
    ['Rente VS 10 jaar', lastTwo(S.DGS10), 'rate'], ['ECB-depositorente', lastTwo(S.ECBDFR), 'rate'], ['Euro in dollar', lastTwo(fx), 'fx'],
  ].filter((x) => x[1]);
  if (!items.length) return '<section class="tile pad"><h3>Marktoverzicht</h3><p class="muted">Indexen en rentes komen één keer per dag van FRED en de ECB. Dat is nog niet gebeurd.</p></section>';
  const vixWord = (v) => (v < 15 ? 'rustig' : v < 25 ? 'normaal' : v < 35 ? 'onrustig' : 'paniek');
  const cell = ([label, o, kind]) => {
    const ch = kind === 'rate' ? (isNum(o.prev) ? o.v - o.prev : null) : isNum(o.prev) && o.prev ? o.v / o.prev - 1 : null;
    const chm = kind === 'rate' ? (isNum(o.m) ? o.v - o.m : null) : isNum(o.m) && o.m ? o.v / o.m - 1 : null;
    const val = kind === 'rate' ? N2.format(o.v) + '%' : kind === 'fx' ? '$ ' + N4.format(o.v) : kind === 'vix' ? N1.format(o.v) + ' (' + vixWord(o.v) + ')' : NI.format(o.v);
    const fmtCh = (x) => (kind === 'rate' ? sgn(x * 100, NI) + ' bp' : spct(x));
    const pts = o.ser.slice(-120).map(([d, v]) => ({ t: ymd(d), v })).filter((p) => p.t != null);
    return '<div class="mk-c"><span class="muted small">' + esc(label) + '</span><b>' + esc(val) + '</b><span class="small ' + (kind === 'vix' ? '' : tone(ch)) + '">' + esc(isNum(ch) ? fmtCh(ch) + ' dag' : '') + (isNum(chm) ? ' · ' + esc(fmtCh(chm)) + ' maand' : '') + '</span>' +
      spark(pts, kind === 'vix' ? C.ink2 : toneColor(chm)) + '</div>';
  };
  return '<section class="tile pad full"><h3>Marktoverzicht</h3><div class="mk-grid">' + items.map(cell).join('') + '</div>' +
    '<p class="sub" style="margin-top:8px">Slotkoersen van de vorige handelsdag. Bronnen: FRED (S&P 500, Nasdaq-100, VIX, rente VS, ECB-depositorente) en de ECB (wisselkoers). Een hoge VIX betekent dat beleggers grote bewegingen verwachten.</p></section>';
}

// ---------- Economische agenda ----------
// Vergaderingen van de ECB en de Fed volgens hun gepubliceerde kalenders (besluit op de laatste dag)
const CB_MEETINGS = [
  ['2026-02-05', 'ECB'], ['2026-03-19', 'ECB'], ['2026-04-30', 'ECB'], ['2026-06-11', 'ECB'], ['2026-07-23', 'ECB'], ['2026-09-10', 'ECB'], ['2026-10-29', 'ECB'], ['2026-12-17', 'ECB'],
  ['2026-01-28', 'Fed'], ['2026-03-18', 'Fed'], ['2026-04-29', 'Fed'], ['2026-06-17', 'Fed'], ['2026-07-29', 'Fed'], ['2026-09-16', 'Fed'], ['2026-10-28', 'Fed'], ['2026-12-09', 'Fed'],
];
const ECON_NL = [[/Consumer Price Index/i, 'Inflatie VS (CPI)'], [/Employment Situation/i, 'Banenrapport VS'], [/Gross Domestic Product/i, 'Economische groei VS (bbp)'],
  [/FOMC/i, 'Rentebesluit Fed'], [/Personal Income/i, 'Inkomen en uitgaven VS (PCE-inflatie)'], [/Producer Price/i, 'Producentenprijzen VS']];
function econItems() {
  const today = dayStart(Date.now());
  const out = CB_MEETINGS.map(([d, who]) => ({ t: ymd(d), name: who === 'ECB' ? 'Rentebesluit ECB' : 'Rentebesluit Fed', who, src: 'kalender' }));
  ((ext2().econ && ext2().econ.items) || []).forEach((x) => {
    const nm = (ECON_NL.find((e) => e[0].test(x.name)) || [null, x.name])[1];
    const t = ymd(x.date);
    if (t != null && !out.some((o) => o.name === nm && dayKey(o.t) === dayKey(t))) out.push({ t, name: nm, who: /FOMC/i.test(x.name) ? 'Fed' : 'VS', src: 'FRED' });
  });
  return out.filter((o) => o.t != null && o.t >= today).sort((a, b) => a.t - b.t).slice(0, 12);
}
function econTile() {
  const all = econItems();
  const has = !!(ext2().econ && ext2().econ.items);
  // Filter (idee 50): alleen gebeurtenissen die een flink deel van je beleggingen raken, via de munt of het land
  const mine = econMineOn();
  const L = mine ? all.filter((o) => econImpact(o).share >= ECON_MIN) : all;
  const hidden = all.length - L.length;
  return '<section class="tile pad"><h3>Economische agenda</h3>' +
    '<label class="check small"><input type="checkbox" data-econ-mine' + (mine ? ' checked' : '') + '> Alleen wat mijn munten of landen raakt</label>' +
    (L.length ? '<div class="tx-list" style="margin-top:8px">' + L.map((o) => '<div class="tx"><span class="tag' + (o.who === 'ECB' ? ' gain' : '') + '">' + esc(o.who) + '</span><span class="tx-m"><b>' + esc(o.name) + '</b><span class="sub">' + esc(fD.format(o.t) + ', ' + whenText(o.t) + (econShareText(o) ? ' · ' + econShareText(o) : '')) + '</span></span></div>').join('') + '</div>'
      : '<p class="muted">' + (mine && all.length ? 'Geen gebeurtenis in de komende weken die minstens ' + esc(P1.format(ECON_MIN)) + ' van je beleggingen raakt.' : 'Geen bekende data in de komende weken.') + '</p>') +
    (mine && hidden > 0 ? '<p class="small muted" style="margin-top:6px">' + hidden + (hidden === 1 ? ' gebeurtenis valt' : ' gebeurtenissen vallen') + ' buiten het filter.</p>' : '') +
    '<p class="sub" style="margin-top:8px">' + (has ? 'Publicaties uit de VS komen van FRED; ' : 'Met een gratis FRED-sleutel (FRED_KEY) zie je ook inflatie, banen en groei in de VS; ') + 'rentebesluiten volgens de vergaderkalenders van de ECB en de Fed. Op zulke dagen bewegen beurzen vaak meer. Het filter kijkt naar de munt waarin je aandelen noteren en het land uit het bedrijfsprofiel; de agenda zelf bevat geen sectorinformatie.</p></section>';
}

// ---------- Screener over de bedrijven die de Worker kent ----------
function screenerRows() {
  if (!M.mk.ok) return [];
  const mk = data.market || {};
  const val = mk.valuation || {};
  const held = new Set(M.companies.map((c) => M.mk.sym(c.tk)));
  return Object.keys(mk.profiles || {}).map((sym) => {
    const p = M.mk.prof(sym) || {};
    const rb = p.range ? String(p.range).split('-').map(Number) : null;
    const drop = rb && rb[1] > 0 && isNum(p.price) ? p.price / rb[1] - 1 : null;
    const v = val[sym] || {};
    return { sym, name: p.name || sym, sector: p.sector || '', price: p.price, cur: p.currency, change: isNum(p.change) ? p.change / 100 : null, mcap: p.marketCap, pe: isNum(v.pe) ? v.pe : null, dy: isNum(v.dy) ? v.dy : null, drop, beta: p.beta, held: held.has(sym), watch: watchSyms().includes(sym) };
  });
}
function screenerTile() {
  const all = screenerRows();
  if (!all.length) return '<section class="tile pad full"><h3>Screener</h3><p class="muted">De screener werkt met de bedrijfsprofielen die de Worker ophaalt (FMP of Finnhub). Die zijn er nog niet.</p></section>';
  const secs = [...new Set(all.map((r) => r.sector).filter(Boolean))].sort();
  const S = mkState;
  const num = (x) => (x === '' || x == null ? null : Number(x));
  const rows = all.filter((r) => (S.scrSector === 'all' || r.sector === S.scrSector) &&
    (num(S.scrPe) == null || (isNum(r.pe) && r.pe <= num(S.scrPe))) &&
    (num(S.scrDy) == null || (isNum(r.dy) && r.dy * 100 >= num(S.scrDy))) &&
    (num(S.scrDrop) == null || (isNum(r.drop) && -r.drop * 100 >= num(S.scrDrop))))
    .sort((a, b) => S.scrSort === 'pe' ? (a.pe || 1e9) - (b.pe || 1e9) : S.scrSort === 'dy' ? (b.dy || 0) - (a.dy || 0) : S.scrSort === 'mcap' ? (b.mcap || 0) - (a.mcap || 0) : (a.drop || 0) - (b.drop || 0));
  return '<section class="tile pad full screener"><h3>Screener</h3>' +
    '<div class="scr-f"><label>Sector<select data-scr="scrSector"><option value="all">Alle sectoren</option>' + secs.map((s) => '<option value="' + esc(s) + '"' + (s === S.scrSector ? ' selected' : '') + '>' + esc(sectorNl(s)) + '</option>').join('') + '</select></label>' +
    '<label>' + trm('K/W hoogstens', 'pe') + '<input type="number" min="0" step="1" data-scr="scrPe" value="' + esc(S.scrPe) + '" placeholder="geen grens"></label>' +
    '<label>Dividend minstens<span class="eur-in"><input type="number" min="0" step="0.5" data-scr="scrDy" value="' + esc(S.scrDy) + '" placeholder="0">%</span></label>' +
    '<label>Onder de jaartop minstens<span class="eur-in"><input type="number" min="0" step="5" data-scr="scrDrop" value="' + esc(S.scrDrop) + '" placeholder="0">%</span></label>' +
    '<label>Sorteer<select data-scr="scrSort">' + [['drop', 'Verst onder jaartop'], ['pe', 'Laagste K/W'], ['dy', 'Hoogste dividend'], ['mcap', 'Grootste']].map(([k, l]) => '<option value="' + k + '"' + (k === S.scrSort ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label></div>' +
    '<p class="small muted">' + rows.length + ' van ' + all.length + ' bedrijven</p>' +
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bedrijf</th><th>Sector</th><th class="num">Koers</th><th class="num">K/W</th><th class="num">Dividend</th><th class="num">Onder jaartop</th><th></th></tr></thead><tbody>' +
    rows.slice(0, 40).map((r) => '<tr><td class="co"><b>' + esc(r.sym) + '</b>' + (r.held ? ' <span class="tag gain">In bezit</span>' : r.watch ? ' <span class="tag">Volglijst</span>' : '') + '<span class="nm">' + esc(r.name) + '</span></td><td class="small">' + esc(sectorNl(r.sector)) + '</td>' +
      '<td class="num">' + esc(isNum(r.price) ? money(r.price, r.cur) : '–') + '</td><td class="num">' + esc(isNum(r.pe) ? N1.format(r.pe) : '–') + '</td><td class="num">' + esc(isNum(r.dy) ? P2.format(r.dy) : '–') + '</td>' +
      '<td class="num ' + tone(r.drop) + '">' + esc(isNum(r.drop) ? spct1(r.drop) : '–') + '</td><td>' + (r.held || r.watch ? '' : '<button type="button" class="btn ghost" data-xa="watch-add" data-k="' + esc(r.sym) + '">Volgen</button>') + '</td></tr>').join('') +
    '</tbody></table></div><p class="sub" style="margin-top:8px">Bedrijven waarvan de Worker een profiel heeft: je posities, vergelijkbare bedrijven en je volglijst. K/W en dividend alleen waar de waardering bekend is. Geen beleggingsadvies.</p></section>';
}
document.addEventListener('change', (e) => {
  const el = e.target.closest && e.target.closest('[data-scr]');
  if (!el) return;
  mkState[el.dataset.scr] = el.value;
  refresh('analyse');
});

// ---------- ETF-zoeker ----------
// Bekende fondsen (UCITS) met indicatieve lopende kosten; controleer het actuele percentage bij de aanbieder.
const ETF_LIST = [
  ['VWCE', 'Vanguard FTSE All-World (Acc)', 'FTSE All-World', 0.19, 'Acc'], ['VWRL', 'Vanguard FTSE All-World (Dist)', 'FTSE All-World', 0.19, 'Dist'],
  ['IWDA', 'iShares Core MSCI World (Acc)', 'MSCI World', 0.20, 'Acc'], ['SPPW', 'SPDR MSCI World (Acc)', 'MSCI World', 0.12, 'Acc'], ['XDWD', 'Xtrackers MSCI World (Acc)', 'MSCI World', 0.19, 'Acc'],
  ['SSAC', 'iShares MSCI ACWI (Acc)', 'MSCI ACWI', 0.20, 'Acc'],
  ['VUAA', 'Vanguard S&P 500 (Acc)', 'S&P 500', 0.07, 'Acc'], ['VUSA', 'Vanguard S&P 500 (Dist)', 'S&P 500', 0.07, 'Dist'], ['CSPX', 'iShares Core S&P 500 (Acc)', 'S&P 500', 0.07, 'Acc'], ['SPY5', 'SPDR S&P 500 (Dist)', 'S&P 500', 0.03, 'Dist'],
  ['CNDX', 'iShares Nasdaq 100 (Acc)', 'Nasdaq-100', 0.30, 'Acc'], ['EQQQ', 'Invesco EQQQ Nasdaq-100 (Dist)', 'Nasdaq-100', 0.30, 'Dist'], ['XNAS', 'Xtrackers Nasdaq 100 (Acc)', 'Nasdaq-100', 0.20, 'Acc'],
  ['EIMI', 'iShares Core MSCI EM IMI (Acc)', 'Opkomende markten', 0.18, 'Acc'], ['VFEM', 'Vanguard FTSE Emerging Markets (Dist)', 'Opkomende markten', 0.22, 'Dist'],
  ['VEUR', 'Vanguard FTSE Developed Europe (Dist)', 'Europa', 0.10, 'Dist'], ['MEUD', 'Amundi Stoxx Europe 600 (Acc)', 'Europa', 0.07, 'Acc'], ['IMAE', 'iShares Core MSCI Europe (Acc)', 'Europa', 0.12, 'Acc'],
  ['IUSN', 'iShares MSCI World Small Cap (Acc)', 'Kleine bedrijven', 0.35, 'Acc'], ['VHYL', 'Vanguard FTSE All-World High Dividend (Dist)', 'Dividend', 0.29, 'Dist'], ['TDIV', 'VanEck Developed Markets Dividend Leaders (Dist)', 'Dividend', 0.38, 'Dist'],
];
function etfFinderTile() {
  const idxs = [...new Set(ETF_LIST.map((x) => x[2]))];
  const pick = mkState.etfIdx;
  const own = new Map();
  M.companies.filter(isFundC).forEach((c) => { const f = FUND_TER.find((x) => x[0].test(c.tk)); const idx = f ? f[1].replace('Nasdaq 100', 'Nasdaq-100') : null; if (idx) own.set(idx, (own.get(idx) || 0) + c.value); });
  const tot = M.totalValue || 0;
  const list = ETF_LIST.filter((x) => pick === 'all' || x[2] === pick).sort((a, b) => a[2].localeCompare(b[2]) || a[3] - b[3]);
  const etfData = data.etf || {};
  const holdKey = pick === 'S&P 500' ? 'SP500' : pick === 'Nasdaq-100' ? 'NDX' : null;
  const hold = holdKey && etfData[holdKey] ? etfData[holdKey].rows.slice(0, 10) : null;
  const direct = new Set(M.companies.filter((c) => !isFundC(c)).map((c) => normTk(c.tk)));
  return '<section class="tile pad full"><div class="plan-head"><h3>ETF-zoeker</h3></div>' +
    '<div class="seg light wrap" role="group" aria-label="Index">' + [['all', 'Alle']].concat(idxs.map((i) => [i, i])).map(([k, l]) => '<button type="button" data-etf-idx="' + esc(k) + '" aria-pressed="' + (k === pick) + '">' + esc(l) + '</button>').join('') + '</div>' +
    '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Fonds</th><th>Index</th><th class="num">' + trm('Kosten (TER)', 'ter') + '</th><th>Dividend</th><th class="num">Al in bezit op deze index</th></tr></thead><tbody>' +
    list.map((x) => { const have = own.get(x[2]); return '<tr><td class="co"><b>' + esc(x[0]) + '</b><span class="nm">' + esc(x[1]) + '</span></td><td>' + esc(x[2]) + '</td><td class="num">' + esc(N2.format(x[3]) + '%') + '</td><td>' + esc(x[4] === 'Acc' ? 'herbeleggen' : 'uitkeren') + '</td>' +
      '<td class="num">' + esc(have ? eur(have) + (tot ? ' (' + P1.format(have / tot) + ')' : '') : '–') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    (hold ? '<h3 style="margin-top:14px">Grootste bedrijven in de ' + esc(pick) + '</h3><div class="tx-list">' + hold.map(([tk, nm, , w]) => '<div class="tx"><span class="tx-m"><b>' + esc(tk) + '</b>' + (direct.has(normTk(tk)) ? ' <span class="tag gain">heb je ook los</span>' : '') + '<span class="sub">' + esc(nm) + '</span></span><span class="tx-v">' + esc(N2.format(w) + '%') + '</span></div>').join('') + '</div>' : '') +
    '<p class="sub" style="margin-top:8px">Kosten zijn indicatief; controleer ze en of Trading 212 het fonds aanbiedt. Fondsen op dezelfde index bevatten vrijwel dezelfde bedrijven: twee daarvan kopen spreidt niet extra. Geen beleggingsadvies.</p></section>';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-etf-idx]');
  if (b) { mkState.etfIdx = b.dataset.etfIdx; refresh('analyse'); }
});

// ---------- Deponeringen bij de SEC ----------
const FORM_NL = { '10-K': 'jaarverslag', '10-Q': 'kwartaalverslag', '8-K': 'belangrijke gebeurtenis', '20-F': 'jaarverslag (buitenlands bedrijf)', '6-K': 'tussentijds bericht (buitenlands)', '40-F': 'jaarverslag (Canada)', 'S-1': 'uitgifte van aandelen', 'DEF 14A': 'stukken voor de aandeelhoudersvergadering' };
const ITEM_NL = { '2.02': 'resultaten', '5.02': 'wisseling bestuur', '1.01': 'belangrijke overeenkomst', '8.01': 'overig nieuws', '7.01': 'mededeling', '5.07': 'stemmingen', '2.01': 'overname of verkoop', '1.05': 'cyberincident' };
function filingRows(sym) {
  const per = (ext2().filings && ext2().filings.per) || {};
  const out = [];
  Object.entries(per).forEach(([s, o]) => { if (!sym || s === sym) (o.list || []).forEach((f) => out.push(Object.assign({ sym: s, t: ymd(f.date) }, f))); });
  return out.filter((f) => f.t != null).sort((a, b) => b.t - a.t);
}
function filingLine(f) {
  const items = String(f.items || '').split(',').map((x) => ITEM_NL[x.trim()]).filter(Boolean);
  return '<a class="tx" href="' + esc(f.url) + '" target="_blank" rel="noopener"><span class="tag">' + esc(f.form) + '</span><span class="tx-m"><b>' + esc(f.sym) + ' – ' + esc(FORM_NL[f.form] || f.form) + (items.length ? ': ' + esc(items.join(', ')) : '') + '</b><span class="sub">' + esc(fD.format(f.t) + ' ' + new Date(f.t).getFullYear()) + '</span></span><span class="tx-v small">SEC ›</span></a>';
}
function filingsTile() {
  const L = filingRows(null);
  return '<section class="tile pad"><h3>Deponeringen bij de SEC</h3>' + (L.length ? '<div class="tx-list">' + L.slice(0, 12).map(filingLine).join('') + '</div>'
    : '<p class="muted">Jaar- en kwartaalverslagen en belangrijke meldingen (8-K) van je Amerikaanse aandelen. ' + (FEAT().has.sec || demo ? 'De Worker haalt ze elke dag op.' : 'Vraagt je e-mailadres als contact voor de SEC (SEC_CONTACT).') + '</p>') +
    '<p class="sub" style="margin-top:8px">Rechtstreeks van SEC EDGAR; het document opent bij de SEC (Engels).</p></section>';
}
function companyFilingsTile(sym) {
  const L = filingRows(sym);
  if (!L.length) return '';
  return '<section class="tile pad"><h3>Deponeringen bij de SEC</h3><div class="tx-list">' + L.slice(0, 6).map(filingLine).join('') + '</div></section>';
}

// ---------- 13F: grote beleggers ----------
const normName = (s) => String(s || '').toUpperCase().replace(/[.,]/g, '').replace(/\b(INC|CORP|CORPORATION|CO|LTD|PLC|HOLDINGS?|GROUP|CLASS [A-C]|CL [A-C]|COM|NEW|THE|NV|SA|AG)\b/g, '').replace(/\s+/g, ' ').trim();
function f13Tile() {
  const F = (ext2().f13 && ext2().f13.funds) || [];
  if (!F.length) return '<section class="tile pad full"><h3>Wat grote beleggers bezitten</h3><p class="muted">' + (FEAT().has.sec || demo ? 'De Worker haalt de kwartaalopgaven (13F) één keer per week op.' : 'Vraagt je e-mailadres als contact voor de SEC (SEC_CONTACT).') + '</p></section>';
  const i = Math.min(mkState.f13, F.length - 1);
  const f = F[i];
  const mine = M.companies.map((c) => normName(c.name)).filter(Boolean);
  const isMine = (nm) => { const n = normName(nm); return n && mine.some((m) => m && (m.startsWith(n) || n.startsWith(m))); };
  const overlap = (f.names || []).filter(isMine).length;
  return '<section class="tile pad full f13"><div class="plan-head"><h3>Wat grote beleggers bezitten</h3></div>' +
    '<div class="seg light wrap" role="group" aria-label="Belegger">' + F.map((x, k) => '<button type="button" data-f13="' + k + '" aria-pressed="' + (k === i) + '">' + esc(x.label.replace(/ \(.+\)$/, '')) + '</button>').join('') + '</div>' +
    '<p class="small" style="margin-top:8px"><b>' + esc(f.label) + '</b>: ' + esc(NI.format(f.n)) + ' posities, samen ' + esc(bigNum(f.total)) + ', stand ' + esc(f.period ? fDM.format(ymd(f.period)) + ' ' + f.period.slice(0, 4) : '–') + ' (ingediend ' + esc(f.filed ? fDM.format(ymd(f.filed)) : '–') + ').' + (overlap ? ' Je hebt <b>' + overlap + '</b> van deze bedrijven ook.' : '') + '</p>' +
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bedrijf</th><th class="num">Deel</th><th class="num">Waarde</th><th class="num">Tegenover vorig kwartaal</th></tr></thead><tbody>' +
    f.top.map((x) => '<tr><td>' + esc(x.name) + (isMine(x.name) ? ' <span class="tag gain">heb je ook</span>' : '') + (x.isNew ? ' <span class="tag">nieuw</span>' : '') + '</td><td class="num">' + esc(P1.format(x.pct)) + '</td><td class="num">' + esc(bigNum(x.value)) + '</td>' +
      '<td class="num ' + tone(x.chg) + '">' + esc(isNum(x.chg) ? (Math.abs(x.chg) < 0.005 ? 'gelijk' : spct1(x.chg) + ' aandelen') : '–') + '</td></tr>').join('') + '</tbody></table></div>' +
    '<p class="sub" style="margin-top:8px">Uit de 13F-opgave bij de SEC: alleen Amerikaanse aandelen, tot 45 dagen na het kwartaal, zonder opties. Een momentopname, geen advies om te volgen.</p></section>';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-f13]');
  if (b) { mkState.f13 = Number(b.dataset.f13); refresh('analyse'); }
});

// ---------- Insiders die samen kopen ----------
function insiderClusters() {
  const keys = M.companies.filter((c) => !isFundC(c)).map((c) => c.tk).concat(watchSyms());
  const out = [];
  keys.forEach((tk) => {
    const buys = (((data.research || {})[tk] || {}).insider || []).filter((x) => x.code === 'P' && x.date).map((x) => Object.assign({ t: ymd(x.date) }, x)).filter((x) => x.t != null).sort((a, b) => a.t - b.t);
    for (let i = 0; i < buys.length; i++) {
      const win = buys.filter((x) => x.t >= buys[i].t && x.t <= buys[i].t + 30 * DAY);
      const names = new Set(win.map((x) => x.name));
      if (names.size >= 2) {
        out.push({ tk, from: win[0].t, to: win[win.length - 1].t, names: [...names], amount: sum(win.map((x) => Math.abs((x.change || 0) * (x.price || 0)))), held: M.byTk.has(tk) });
        break;
      }
    }
  });
  return out.sort((a, b) => b.to - a.to);
}
function insiderClusterTile() {
  const L = insiderClusters();
  return '<section class="tile pad"><h3>' + trm('Insiders die samen kopen', 'insider') + '</h3>' +
    (L.length ? '<div class="tx-list">' + L.map((x) => '<div class="tx rowlink" role="button" tabindex="0" data-ticker="' + esc(x.held ? x.tk : '~' + x.tk) + '"><span class="tag gain">' + x.names.length + ' kopers</span><span class="tx-m"><b>' + esc(x.tk) + '</b><span class="sub">' + esc(fDM.format(x.from) + ' – ' + fDM.format(x.to) + ': ' + x.names.slice(0, 3).join(', ')) + '</span></span><span class="tx-v">' + esc(bigNum(x.amount)) + '</span></div>').join('') + '</div>'
      : '<p class="muted">Geen groepjes van twee of meer bestuurders die binnen 30 dagen zelf kochten (laatste zes maanden, je aandelen en volglijst).</p>') +
    '<p class="sub" style="margin-top:8px">Aankopen op de beurs (code P) door verschillende bestuurders kort na elkaar worden vaak gezien als vertrouwen; verkopen hebben veel meer redenen. Geen advies.</p></section>';
}

// ---------- Koersreactie op kwartaalcijfers ----------
function earningsMoves(tk) {
  const sym = M.mk.ok ? M.mk.sym(tk) : tk;
  const dates = new Set(((ext2().earnHist || {})[tk] || []).concat(((ext2().earnHist || {})[sym] || [])));
  const le = M.ev.lastEarn.get(tk);
  if (le && le.date) dates.add(String(le.date).slice(0, 10));
  const pts = M.mk.ok ? M.mk.prices(sym) : [];
  const ser = pts.length > 20 ? pts.map((p) => ({ t: p.t, v: p.v })) : twrSeries(tk);
  if (ser.length < 5) return [];
  return [...dates].sort().map((d) => {
    const t = ymd(d);
    const before = ser.filter((p) => p.t < t).pop();
    const after = ser.filter((p) => p.t > t + 6 * HOUR)[0];
    if (!before || !after || after.t - before.t > 6 * DAY) return null;
    return { d, t, move: after.v / before.v - 1 };
  }).filter(Boolean);
}
function earningsMoveTile() {
  const rows = M.companies.filter((c) => !isFundC(c)).map((c) => ({ c, mv: earningsMoves(c.tk) })).filter((x) => x.mv.length);
  return '<section class="tile pad"><h3>Koersreactie op kwartaalcijfers</h3>' +
    (rows.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Aandeel</th><th class="num">Gemiddeld (op of neer)</th><th>Laatste keren</th></tr></thead><tbody>' +
      rows.map((x) => '<tr class="rowlink" data-ticker="' + esc(x.c.tk) + '"><td><b>' + esc(x.c.tk) + '</b></td><td class="num">' + esc(P1.format(mean(x.mv.map((m) => Math.abs(m.move))))) + '</td><td class="small">' +
        x.mv.slice(-4).reverse().map((m) => '<span class="' + tone(m.move) + '">' + esc(fDM.format(m.t) + ' ' + spct1(m.move)) + '</span>').join(' · ') + '</td></tr>').join('') + '</tbody></table></div>'
      : '<p class="muted">De tracker onthoudt vanaf nu elke cijferdatum; na de eerste cijfers zie je hier hoe sterk de koers reageerde.</p>') +
    '<p class="sub" style="margin-top:8px">Slotkoers van de handelsdag vóór de cijfers tegenover de eerste handelsdag erna. Zo zie je hoe groot de sprong rond cijfers meestal is.</p></section>';
}

// ---------- Volglijst: labels, notitie en koopzone ----------
const watchMeta = (sym) => ((userPrefs().watchMeta || {})[sym]) || {};
function watchTagList() { const s = new Set(); Object.values(userPrefs().watchMeta || {}).forEach((m) => (m.tags || []).forEach((t) => s.add(t))); return [...s].sort(); }
function watchTagFilter(sym) {
  const t = mkState.watchTag;
  if (!t) return true;
  const tags = watchMeta(sym).tags || [];
  return t === '*none' ? !tags.length : tags.includes(t);
}
function watchTagChips() {
  const tags = watchTagList();
  if (!tags.length) return '';
  const nOf = (t) => watchSyms().filter((s) => (watchMeta(s).tags || []).includes(t)).length;
  const zonder = watchSyms().filter((s) => !(watchMeta(s).tags || []).length).length;
  const chip = (k, label, n) => '<button type="button" data-watch-tag="' + esc(k) + '" aria-pressed="' + ((k || null) === (mkState.watchTag || null)) + '">' +
    esc(label) + (isNum(n) ? ' <span class="wt-n">' + n + '</span>' : '') + '</button>';
  return '<div class="watch-tags" role="group" aria-label="Volglijst filteren op label">' + chip('', 'Alle', watchSyms().length) +
    tags.map((t) => chip(t, t, nOf(t))).join('') + (zonder ? chip('*none', 'Zonder label', zonder) : '') + '</div>';
}
function inZone(sym, price) { const m = watchMeta(sym); return isNum(price) && (isNum(m.lo) || isNum(m.hi)) && (!isNum(m.lo) || price >= m.lo) && (!isNum(m.hi) || price <= m.hi); }
function watchBadges(sym, p) {
  const m = watchMeta(sym);
  const cur = (p && p.currency) || 'USD';
  const out = (m.tags || []).slice(0, 3).map((t) => '<span class="tag">' + esc(t) + '</span>');
  if (p && inZone(sym, p.price)) out.unshift('<span class="tag gain">in koopzone</span>');
  // Eigen koersdoel (26-posities.js) en de reden waarom je dit volgt, met de datum van de notitie
  const tg = typeof myTargetOf === 'function' ? myTargetOf(sym) : null;
  if (isNum(tg)) out.push('<span class="tag">doel ' + esc(money(tg, cur)) + (p && isNum(p.price) && p.price > 0 ? ' · ' + esc(spct1(tg / p.price - 1)) : '') + '</span>');
  const note = m.note ? '<span class="wnote">' + esc(m.note.length > 72 ? m.note.slice(0, 70) + '…' : m.note) +
    (m.d ? ' <i>' + esc(ymd(m.d) ? fDM.format(ymd(m.d)) : String(m.d)) + '</i>' : '') + '</span>' : '';
  if (!out.length && !note) return '';
  return (out.length ? '<span class="wbadges">' + out.join('') + '</span>' : '') + note;
}
function watchMetaTile(sym, p) {
  const m = watchMeta(sym);
  const cur = (p && p.currency) || 'USD';
  return '<section class="tile pad watch-meta" data-wm="' + esc(sym) + '"><h3>Labels, notitie en koopzone</h3>' +
    '<label class="wm-l">Labels (komma ertussen)<input data-wm-f="tags" maxlength="80" value="' + esc((m.tags || []).join(', ')) + '" placeholder="bijv. chips, dividend"></label>' +
    '<label class="wm-l">Waarom volg je dit?<textarea data-wm-f="note" maxlength="300" rows="2" placeholder="Bijvoorbeeld: wachten op een lagere koers na de cijfers">' + esc(m.note || '') + '</textarea></label>' +
    (m.note && m.d ? '<p class="small muted">Notitie van ' + esc(ymd(m.d) ? fD.format(ymd(m.d)) + ' ' + String(m.d).slice(0, 4) : String(m.d)) + '; bij een nieuwe tekst komt de datum van vandaag erbij.</p>' : '') +
    '<div class="plan-inputs"><label>Koopzone vanaf<span class="eur-in">' + esc(CUR_SYM[cur] || cur) + '<input type="number" min="0" step="0.01" data-wm-f="lo" value="' + esc(isNum(m.lo) ? m.lo : '') + '"></span></label>' +
    '<label>tot<span class="eur-in">' + esc(CUR_SYM[cur] || cur) + '<input type="number" min="0" step="0.01" data-wm-f="hi" value="' + esc(isNum(m.hi) ? m.hi : '') + '"></span></label></div>' +
    (p && isNum(p.price) && (isNum(m.lo) || isNum(m.hi)) ? '<p class="small ' + (inZone(sym, p.price) ? 'gain' : 'muted') + '">' + esc(inZone(sym, p.price) ? 'De koers (' + money(p.price, cur) + ') ligt in je koopzone.' : 'De koers (' + money(p.price, cur) + ') ligt buiten je koopzone.') + '</p>' : '') +
    '<div class="plan-actions"><button type="button" class="btn primary" data-wm-save>Bewaren</button><span class="small plan-status" role="status"></span></div>' +
    '<p class="sub" style="margin-top:6px">Wil je een melding als de koers in de zone komt, zet dan hierboven een koersalarm.</p></section>';
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest && e.target.closest('[data-watch-tag]');
  if (t) { mkState.watchTag = t.dataset.watchTag || null; renderWatch(); return; }
  const b = e.target.closest && e.target.closest('[data-wm-save]');
  if (!b) return;
  const box = b.closest('[data-wm]'), sym = box.dataset.wm, st = box.querySelector('.plan-status');
  const v = (k) => box.querySelector('[data-wm-f="' + k + '"]').value.trim();
  const n = (x) => (x === '' ? null : Number(x));
  const meta = Object.assign({}, userPrefs().watchMeta || {});
  const prev = watchMeta(sym);
  const o = { tags: v('tags').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6).map((x) => x.slice(0, 20)), note: v('note').slice(0, 300), lo: n(v('lo')), hi: n(v('hi')) };
  // Datum bij de notitie: blijft staan zolang de tekst niet verandert
  if (o.note) o.d = o.note === prev.note && prev.d ? prev.d : today10();
  if (!o.tags.length && !o.note && o.lo == null && o.hi == null) delete meta[sym]; else meta[sym] = o;
  try { await savePrefs({ watchMeta: meta }); if (st) { st.textContent = 'Bewaard.'; st.className = 'small plan-status gain'; } renderWatch(); }
  catch (err) { if (st) { st.textContent = 'Opslaan is mislukt: ' + err.message + '.'; st.className = 'small plan-status loss'; } }
});

// ---------- Nieuws: bronnen dempen en ochtendmelding ----------
// Dempen kan op drie manieren: een bron, een aandeel of een woord in de kop. Alles staat in settings.prefs.
const mutedSources = () => (userPrefs().newsMute || []).map((x) => String(x).toLowerCase());
const mutedTickers = () => (userPrefs().newsMuteTk || []).map((x) => String(x).toUpperCase());
const mutedWords = () => (userPrefs().newsMuteWord || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
function newsMuted(n) {
  if (n.source && mutedSources().includes(String(n.source).toLowerCase())) return true;
  if (n.tk && mutedTickers().includes(String(n.tk).toUpperCase())) return true;
  const w = mutedWords();
  if (!w.length) return false;
  const txt = ((n.headline || '') + ' ' + (n.summary || '')).toLowerCase();
  return w.some((x) => txt.includes(x));
}
const muteKey = () => mutedSources().join('|') + '#' + mutedTickers().join('|') + '#' + mutedWords().join('|');
function newsToolsTile() {
  const srcs = new Map(), tks = new Map();
  Object.entries(data.research || {}).forEach(([tk, r]) => (r.news || []).forEach((n) => {
    if (n.source) srcs.set(n.source, (srcs.get(n.source) || 0) + 1);
    tks.set(tk, (tks.get(tk) || 0) + 1);
  }));
  ((data.marketNews && data.marketNews.items) || []).forEach((n) => { if (n.source) srcs.set(n.source, (srcs.get(n.source) || 0) + 1); });
  const muted = mutedSources(), mtk = mutedTickers(), words = mutedWords();
  const known = new Set(M.companies.map((c) => c.tk).concat(watchSyms()));
  const P = userPrefs();
  return '<section class="tile pad news-tools"><h3>Nieuws instellen</h3>' +
    '<label class="check"><input type="checkbox" data-morning' + (P.morningPush ? ' checked' : '') + '> Elke werkdag om 08:00 een melding met het nieuws over je aandelen</label>' +
    '<p class="small muted" style="margin:4px 0 10px">Vraagt meldingen op dit apparaat (Instellingen, Meldingen).</p>' +
    '<h3>Bronnen</h3><div class="src-chips">' + [...srcs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([s, k]) => { const on = muted.includes(s.toLowerCase()); return '<button type="button" class="chip' + (on ? ' off' : '') + '" data-mute="' + esc(s) + '" aria-pressed="' + on + '">' + esc(s) + ' <span class="muted">' + k + '</span></button>'; }).join('') + '</div>' +
    '<h3 style="margin-top:14px">Aandelen</h3><div class="src-chips">' + [...tks.entries()].filter(([tk]) => known.has(tk)).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([tk, k]) => { const on = mtk.includes(tk); return '<button type="button" class="chip' + (on ? ' off' : '') + '" data-mute-tk="' + esc(tk) + '" aria-pressed="' + on + '">' + esc(tk) + ' <span class="muted">' + k + '</span></button>'; }).join('') + '</div>' +
    '<h3 style="margin-top:14px">Woorden</h3>' +
    '<form class="mute-form" data-mute-form autocomplete="off"><label class="sr-only" for="mute-word">Woord om te dempen</label>' +
    '<input id="mute-word" class="search" type="text" maxlength="30" placeholder="bijv. kort geding"><button type="submit" class="btn ghost">Dempen</button></form>' +
    (words.length ? '<div class="src-chips" style="margin-top:8px">' + words.map((w) => '<button type="button" class="chip off" data-mute-word="' + esc(w) + '" aria-label="' + esc(w + ' niet meer dempen') + '">' + esc(w) + ' \u00d7</button>').join('') + '</div>' : '') +
    '<p class="sub" style="margin-top:8px">Tik op een bron of aandeel om die te dempen, of demp een woord dat in de kop of samenvatting staat. Gedempt nieuws verdwijnt uit de lijst, uit de teller op het app-icoon en uit de ochtendmelding. Dit geldt op al je apparaten.</p></section>';
}
// Dempen bewaren: bron, aandeel of woord erbij of eraf
async function saveMute(key, value, max) {
  const list = (userPrefs()[key] || []).slice();
  const i = list.findIndex((x) => String(x).toLowerCase() === String(value).toLowerCase());
  if (i >= 0) list.splice(i, 1); else list.push(value);
  try { await savePrefs({ [key]: list.slice(0, max || 40) }); refresh('news', 'badge'); } catch (err) { /* blijft staan */ }
}
document.addEventListener('click', (e) => {
  const el = /** @type {HTMLElement} */ (e.target);
  if (!el.closest) return;
  const b = /** @type {HTMLElement} */ (el.closest('[data-mute]'));
  if (b) { saveMute('newsMute', b.dataset.mute); return; }
  const t = /** @type {HTMLElement} */ (el.closest('[data-mute-tk]'));
  if (t) { saveMute('newsMuteTk', t.dataset.muteTk, 30); return; }
  const w = /** @type {HTMLElement} */ (el.closest('[data-mute-word]'));
  if (w) saveMute('newsMuteWord', w.dataset.muteWord, 20);
});
document.addEventListener('submit', (e) => {
  const el = /** @type {HTMLElement} */ (e.target);
  const f = el.closest && el.closest('[data-mute-form]');
  if (!f) return;
  e.preventDefault();
  const inp = /** @type {HTMLInputElement} */ (f.querySelector('input'));
  const v = (inp.value || '').trim().slice(0, 30);
  if (v.length < 3) { inp.focus(); return; }
  inp.value = '';
  saveMute('newsMuteWord', v, 20);
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest && e.target.closest('[data-morning]');
  if (!el) return;
  try { await savePrefs({ morningPush: el.checked }); } catch (err) { el.checked = !el.checked; }
});

// ---------- Statuspagina: verbruik, geschiedenis, fouten van de site en R2 ----------
const API_LIMITS = { fmp: [250, 'per dag'], alphavantage: [25, 'per dag'], twelvedata: [800, 'per dag'], finnhub: [60, 'per minuut'], fred: [120, 'per minuut'], sec: [10, 'per seconde'] };
const API_NAMES = { fmp: 'Financial Modeling Prep', finnhub: 'Finnhub', alphavantage: 'Alpha Vantage', twelvedata: 'Twelve Data', sec: 'SEC', fred: 'FRED', ecb: 'ECB', eurostat: 'Eurostat', t212: 'Trading 212', ishares: 'iShares', resend: 'Resend' };
function statusExtraRows(S) {
  if (demo && !S.usage) {
    const d = new Date().toISOString().slice(0, 10);
    S = Object.assign({}, S, { usage: { [d]: { t212: 212, fmp: 96, finnhub: 140, sec: 18, fred: 5, ecb: 2 } }, tickHist: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [new Date(Date.now() - (29 - i) * DAY).toISOString().slice(0, 10), [i % 7 === 5 || i % 7 === 6 ? 0 : 84, i === 12 ? 3 : 0]])), siteErrors: [], r2: false });
  }
  const U = S.usage || {};
  const days = Object.keys(U).sort();
  const today = U[days[days.length - 1]] || {};
  const usage = '<section class="tile pad"><h3>Verbruik per bron</h3>' + (days.length ? kvList(Object.entries(today).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
    const L = API_LIMITS[k];
    return [API_NAMES[k] || k, NI.format(n) + ' verzoeken vandaag' + (L ? ' (grens ' + L[0] + ' ' + L[1] + ')' : ''), L && L[1] === 'per dag' && n > L[0] * 0.8 ? 'loss' : ''];
  })) + '<div style="margin-top:10px">' + bars(days.slice(-14).map((d) => ({ v: sum(Object.values(U[d])), color: C.soft, tip: d + ': ' + NI.format(sum(Object.values(U[d]))) + ' verzoeken' })), true) + '</div>'
    : '<p class="muted">Nog geen tellingen; de Worker telt vanaf deze versie elk extern verzoek.</p>') + '</section>';
  const H = S.tickHist || {};
  const hd = Object.keys(H).sort().slice(-30);
  const okSum = sum(hd.map((d) => H[d][0])), failSum = sum(hd.map((d) => H[d][1]));
  const hist = '<section class="tile pad"><h3>Metingen, laatste 30 dagen</h3>' + (hd.length ? '<div class="fx-head"><span class="v big">' + esc(P1.format(okSum / Math.max(1, okSum + failSum))) + '</span><span class="muted small">gelukt (' + NI.format(okSum) + ' goed, ' + NI.format(failSum) + ' mislukt)</span></div>' +
    '<div style="margin-top:8px">' + bars(hd.map((d) => ({ v: H[d][0] + H[d][1], color: H[d][1] ? C.loss : C.gain, tip: d + ': ' + H[d][0] + ' goed, ' + H[d][1] + ' mislukt' })), true) + '</div>'
    : '<p class="muted">Vanaf deze versie houdt de Worker per dag bij hoeveel metingen lukken.</p>') + '</section>';
  const E = S.siteErrors || [];
  const errs = '<section class="tile pad"><h3>Fouten op de website</h3>' + (E.length ? '<div class="tx-list">' + E.slice().reverse().slice(0, 8).map((x) => '<div class="tx"><span class="tag loss">' + esc(x.n > 1 ? x.n + '×' : 'fout') + '</span><span class="tx-m"><b>' + esc(x.msg) + '</b><span class="sub">' + esc((x.src || '') + (x.line ? ':' + x.line : '') + ' · ' + (x.ver || '') + ' · ' + x.t.replace('T', ' ').slice(0, 16)) + '</span></span></div>').join('') + '</div>'
    : '<p class="small gain">Geen fouten gemeld.</p>') + '<p class="sub" style="margin-top:8px">De website stuurt onverwachte fouten (zonder bedragen of sleutels) naar je eigen Worker.</p></section>';
  const r2 = '<section class="tile pad"><h3>Reservekopie in de cloud</h3>' + kvList([['Cloudflare R2', S.r2 ? 'gekoppeld' : 'niet gekoppeld', S.r2 ? 'gain' : ''], ['Laatste kopie', S.r2Last || '–']]) +
    '<p class="sub" style="margin-top:8px">' + (S.r2 ? 'Elke zondag zet de Worker een volledige kopie (zonder sleutels) in je R2-bucket; de laatste acht blijven bewaard.' : 'Koppel een R2-bucket met de naam BACKUP (zie worker/README.md) voor een wekelijkse kopie buiten de database.') + '</p></section>';
  return [[usage, hist], [errs, r2]];
}

// ---------- Fouten op de website melden aan je eigen Worker ----------
const errSent = new Set();
function reportError(msg, src, line) {
  try {
    if (demo || sharedView || !isWorker() || errSent.size >= 5) return;
    const m = String(msg || '').slice(0, 300);
    if (!m || errSent.has(m) || /ResizeObserver|Script error\.?$/i.test(m)) return;
    errSent.add(m);
    workerCall('/api/log', { method: 'POST', body: JSON.stringify({ msg: m, src: String(src || '').replace(/^.*\/docs\//, '').replace(/^https?:\/\/[^/]+\//, '').slice(0, 120), line, ver: VERSION, page: ui.page }) }).catch(() => {});
  } catch (e) { /* nooit zelf een fout geven */ }
}
window.addEventListener('error', (e) => reportError(e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => { const r = e.reason; reportError(r && r.message ? r.message : String(r), r && r.stack ? String(r.stack).split('\n')[1] : '', 0); });
