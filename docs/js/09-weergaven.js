/* Investeringstracker – Weergaven: desktop, telefoon, accountwaarde, uitklapweergaven, bedrijfspagina
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Desktop ----------
function renderHome() {
  const T = M.tot;
  $('hero-label').textContent = 'Waarde beleggingen, ' + (M.lastT ? fDT.format(M.lastT) : 'laatste meting');
  countTo($('hero-value'), M.totalValue, eur);
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
  fill('macro', [fxTile(), inflationTile()]);
  drawMacro($('macro'));
  fill('risk', riskTiles());
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
        '<div class="d-nav"><button type="button" class="btn line" data-act="compare">Vergelijken</button><button type="button" class="btn line" data-act="prev" aria-label="Vorige: ' + esc(prev.name) + '">← ' + esc(prev.tk) + '</button>' +
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
      '<div class="grid wide" style="margin-top:16px">' + I.rangeTile + I.posTile + I.tradeTile + I.histTile + I.agendaTile + I.riskTile + valuationTile(c) + overlapTileC(c) + priceAlertTile(c.tk, c.priceNative, c.cur) + '</div>' +
      '<div class="section-head"><h2>Nieuws, analisten en cijfers</h2></div>' +
      '<div class="grid wide">' + I.research.join('') + '</div>' +
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
  countTo($('m-hero-value'), M.totalValue, eur);
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
  fill('m-macro', [fxTile(), inflationTile()]);
  drawMacro($('m-macro'));
  fill('m-risk', riskTiles());
  fill('m-patterns', patternTiles(TOTAL, S));
}

function renderDetailMobile(c, swapDir) {
  const { prev, next } = detailNav(c);
  const I = companyInfo(c);
  const sw = swapDir ? ' swap-' + swapDir : '';
  const tabs = [['pos', 'Positie'], ['res', 'Onderzoek'], ['cmp', 'Vergelijk'], ['hist', 'Historie'], ['pat', 'Patronen']];
  const panel = ui.mTab === 'hist' ? I.histTile : ui.mTab === 'pat' ? '<div class="m-stack">' + I.patterns.join('') + '</div>'
    : ui.mTab === 'cmp' ? I.riskTile + valuationTile(c) + overlapTileC(c) + '<button type="button" class="btn ghost" data-act="compare">Naast een ander aandeel zetten</button>' + I.market.tiles.join('') + I.market.table
    : ui.mTab === 'res' ? I.research.join('') : I.rangeTile + I.posTile + I.tradeTile + I.agendaTile + priceAlertTile(c.tk, c.priceNative, c.cur);
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
const RISK = '@risk', RES = '@result', DEP = '@deposits';
const CMP = '@compare';
const STATUS = '@status';
const PSEUDO = { '@account': 'accountwaarde', '@risk': 'risico', '@result': 'resultaat', '@deposits': 'stortingen', '@compare': 'vergelijken', '@status': 'status' };
const isPseudo = (k) => Object.prototype.hasOwnProperty.call(PSEUDO, k);
const hasView = (k) => isPseudo(k) || (M && M.byTk.has(k)) || (isWatchKey(k) && M && watchSyms().includes(k.slice(1)));
const viewHash = (k) => (isPseudo(k) ? '#' + PSEUDO[k] : isWatchKey(k) ? '#volg/' + encodeURIComponent(k.slice(1)) : '#bedrijf/' + encodeURIComponent(k));
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

  const secTile = (M.mk.ok ? sectorTiles()[0] : '') + accountsSummaryTile();
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

// ---------- Uitklapweergaven: risico, resultaat, stortingen ----------
function pseudoPage(title, head, desk, mob) {
  if (mode === 'm') {
    return '<div class="md"><div class="m-dtop"><button type="button" class="m-back" data-act="back">‹ Terug</button><span class="t">' + esc(title) + '</span><span></span></div>' +
      '<div class="m-hero"><div class="m-swipe">' + head + '</div></div>' +
      '<div class="m-body"><div class="m-stack">' + (mob || desk.flat()).join('') + '</div></div></div>';
  }
  return '<div class="band" style="padding-bottom:24px"><div class="d-top"><button type="button" class="btn dark" data-act="back">← Terug</button></div>' +
    '<div class="hero-head"><div>' + head + '</div></div></div>' +
    '<div class="wrap">' + desk.map((row) => '<div class="grid wide" style="margin-top:16px">' + row.join('') + '</div>').join('') + '</div>';
}
function pseudoHead(label, value, sub, cls) {
  return '<p class="hero-label">' + esc(label) + '</p><h2 id="d-title" class="' + (mode === 'm' ? 'm-value' : 'hero-value') + (cls ? ' ' + cls : '') + '">' + esc(value) + '</h2>' +
    '<p class="' + (mode === 'm' ? 'base' : 'hero-change muted') + '" style="' + (mode === 'm' ? 'padding:6px 0 0' : '') + '">' + esc(sub) + '</p>';
}

const isFundC = (c) => ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk));

// Rekenvoorbeelden: hoe verandert de beweeglijkheid als de verdeling anders is (koersen van het laatste jaar)
function riskIdeas(R) {
  const total = M.totalValue || 0;
  const out = [];
  const hist = R.items.filter((x) => x.n >= 60);
  // Bestemming in de voorbeelden: een breed indexfonds dat je al hebt, anders de S&P 500 (FRED) in euro
  const ownIdx = hist.find((x) => BENCHES.some((b) => b[1].test(x.c.tk) || b[2].test(x.c.name)) && !/nasdaq/i.test(x.c.name) && !BENCHES[1][1].test(x.c.tk));
  let idxR = ownIdx ? ownIdx.rets : null, idxName = ownIdx ? ownIdx.c.tk : 'een breed indexfonds (S&P 500)';
  if (!idxR && data.idx && data.idx.series && data.idx.series.SP500) {
    const days = [...R.fx.keys()].sort(); let j = 0, last = null, prev = null; idxR = new Map();
    data.idx.series.SP500.forEach(([d, v]) => { while (j < days.length && days[j] <= d) { last = R.fx.get(days[j]); j++; } if (!last) return; const e = v / last; if (prev) { const r = e / prev - 1; if (Math.abs(r) < 0.5) idxR.set(d, r); } prev = e; });
    if (idxR.size < 60) idxR = null;
  }
  const sim = (wOf, wIdx) => {
    const ws = hist.map((x) => [x, wOf(x)]);
    const totW = sum(ws.map((p) => p[1])) + (idxR && wIdx ? wIdx : 0);
    const rs = [];
    R.days.forEach((d) => {
      let sw = 0, sr = 0;
      ws.forEach(([x, w]) => { if (!w) return; const r = x.rets.get(d); if (isNum(r)) { sw += w; sr += w * r; } });
      if (idxR && wIdx) { const r = idxR.get(d); if (isNum(r)) { sw += wIdx; sr += wIdx * r; } }
      if (sw > 0 && sw >= totW * 0.8) rs.push(sr / sw);
    });
    return rs.length >= 60 ? stdev(rs) * Math.sqrt(252) : null;
  };
  const base = R.days && R.days.length >= 60 ? sim((x) => x.w, 0) : null;
  const canIdx = !!idxR && isNum(base);
  const monthly = isNum(M.settings && M.settings.monthly) && M.settings.monthly > 0 ? M.settings.monthly : (typeof monthlyGuess === 'function' ? monthlyGuess() : null);
  const viaInleg = (D, where) => (D > 0 ? ' Zonder te verkopen: ongeveer ' + eur(D) + ' nieuwe inleg ' + (where || 'in andere posities') + (isNum(monthly) && monthly > 0 ? ', ' + Math.max(1, Math.ceil(D / monthly)) + ' maanden bij ' + eur(monthly) + ' per maand' : '') + '.' : '');
  const stocks = M.companies.filter((c) => !isFundC(c));

  // 1. Grootste aanjager van het risico
  const drv = R.items.filter((x) => isNum(x.contrib) && !isFundC(x.c) && x.w >= 0.04).sort((a, b) => (b.contrib - b.w / (R.coverage || 1)) - (a.contrib - a.w / (R.coverage || 1)))[0];
  if (drv && drv.contrib > (drv.w / (R.coverage || 1)) * 1.2) {
    out.push({ title: 'De grootste risicobron kleiner maken: ' + drv.c.tk,
      text: drv.c.tk + ' is ' + P1.format(drv.w) + ' van je beleggingen, maar ' + P1.format(drv.contrib) + ' van het risico' + (isNum(drv.vol) ? ' (zelf ' + P1.format(drv.vol) + ' per jaar)' : '') + '. In het voorbeeld gaat de helft naar ' + idxName + '.',
      to: canIdx ? sim((x) => (x === drv ? x.w / 2 : x.w), drv.w / 2) : null, tk: drv.c.tk });
  }
  // 2. Geen los aandeel boven de 10%
  const big = stocks.filter((c) => (c.weight || 0) > 0.10).sort((a, b) => b.weight - a.weight);
  if (big.length) {
    const excess = sum(hist.filter((x) => !isFundC(x.c) && x.w > 0.10).map((x) => x.w - 0.10));
    out.push({ title: 'Geen los aandeel groter dan 10%',
      text: big.map((c) => c.tk + ' ' + P1.format(c.weight)).join(', ') + '. Valt één bedrijf tegen, dan raakt dat je hele portefeuille. In het voorbeeld gaat alles boven de 10% naar ' + idxName + '.' + viaInleg(big[0].value / 0.10 - total),
      to: canIdx && excess > 0 ? sim((x) => (!isFundC(x.c) && x.w > 0.10 ? 0.10 : x.w), excess) : null });
  }
  // 3. Meer in brede fondsen
  if (isNum(R.fundsW) && R.fundsW < 0.5 && stocks.length) {
    const k = (1 - 0.5) / Math.max(1e-9, 1 - R.fundsW);
    out.push({ title: 'De helft in brede indexfondsen',
      text: 'Nu ' + P1.format(R.fundsW) + ' in fondsen. Een indexfonds spreidt over honderden bedrijven, waardoor tegenvallers van één bedrijf weinig uitmaken. In het voorbeeld gaat ' + P1.format(0.5 - R.fundsW) + ' van je losse aandelen (naar verhouding) naar ' + idxName + '.' + viaInleg(total * (1 - 2 * R.fundsW), 'in brede fondsen'),
      to: canIdx ? sim((x) => (isFundC(x.c) ? x.w : x.w * k), 0.5 - R.fundsW) : null });
  }
  // 4. Eén sector
  if (M.mk.ok) {
    const sec = new Map();
    stocks.forEach((c) => { const p = M.mk.profOf(c.tk); const nm = p && p.sector ? sectorNl(p.sector) : null; if (!nm) return; const e = sec.get(nm) || { w: 0, tks: [] }; e.w += c.weight || 0; e.tks.push(c.tk); sec.set(nm, e); });
    const topS = [...sec.entries()].sort((a, b) => b[1].w - a[1].w)[0];
    if (topS && topS[1].w > 0.4) {
      const sw = topS[1].w, k = 0.3 / sw;
      out.push({ title: 'Minder in één sector: ' + topS[0],
        text: P1.format(sw) + ' van je beleggingen zit in losse aandelen uit ' + topS[0].toLowerCase() + ' (' + topS[1].tks.join(', ') + '). Die reageren vaak op hetzelfde nieuws. In het voorbeeld gaat de sector naar 30% en de rest naar ' + idxName + '.',
        to: canIdx ? sim((x) => (topS[1].tks.includes(x.c.tk) ? x.w * k : x.w), sw - 0.3) : null });
    }
  }
  // 5. Posities die samen bewegen
  if (R.mat && R.mat.length >= 3) {
    let best = null;
    R.mat.forEach((a, i) => R.mat.forEach((b, j) => { const v = R.C2[i][j]; if (j > i && isNum(v) && v >= 0.6 && !isFundC(a.c) && !isFundC(b.c) && (!best || v > best[2])) best = [a, b, v]; }));
    if (best) out.push({ title: best[0].c.tk + ' en ' + best[1].c.tk + ' bewegen bijna samen',
      text: 'Samenhang ' + N2.format(best[2]) + '. Samen ' + P1.format(best[0].w + best[1].w) + ' van je beleggingen; voor het risico tellen ze bijna als één positie. Iets wat los daarvan beweegt, spreidt meer.' });
  }
  // 6. Dollar
  if (isNum(R.usd) && R.usd > 0.7) {
    const days = [...R.fx.keys()].sort().slice(-261); const fr = [];
    for (let i = 1; i < days.length; i++) fr.push(R.fx.get(days[i]) / R.fx.get(days[i - 1]) - 1);
    const fv = fr.length >= 60 ? stdev(fr) * Math.sqrt(252) : null;
    out.push({ title: 'Minder afhankelijk van de dollar',
      text: P1.format(R.usd) + ' van je beleggingen staat in dollars' + (isNum(fv) ? '; de dollar zelf schommelde het laatste jaar ' + P1.format(fv) + ' tegenover de euro' : '') + '. Dat zit bovenop de koersbewegingen. Beleggingen in euro of een fonds met valuta-afdekking (in de naam vaak "EUR Hedged") halen dat deel weg.' });
  }
  // 7. Geld als buffer
  if (isNum(R.vol) && M.cash != null && M.accountNow > 0) {
    out.push({ title: 'Een deel in geld',
      text: 'Met je vrije saldo (' + eur(M.cash) + ') meegerekend schommelt je hele account ongeveer ' + P1.format(R.vol * (M.totalValue / M.accountNow)) + ' per jaar. Geld schommelt niet, maar levert ook weinig op. Geld dat je binnen een paar jaar nodig hebt, staat vaak beter buiten de beurs.' });
  }
  return { ideas: out, base, idxName, canIdx };
}

// ---------- Risico per bedrijf: waarom hoger of lager, en rustigere alternatieven ----------
const SECTOR_RISK = {
  'Technology': [1, 'Technologie: de koers hangt sterk af van groeiverwachtingen en de rente, dus verwachtingen die bijstellen geven grote uitslagen.'],
  'Communication Services': [1, 'Communicatie en media: advertentie-inkomsten dalen snel als de economie afkoelt.'],
  'Consumer Cyclical': [1, 'Cyclische consumptie: als consumenten minder uitgeven, dalen omzet en winst snel.'],
  'Energy': [1, 'Energie: winst hangt af van olie- en gasprijzen, die sterk schommelen.'],
  'Basic Materials': [1, 'Grondstoffen: winst volgt grondstofprijzen en de wereldeconomie.'],
  'Financial Services': [0, 'Financiële diensten: gevoelig voor rente en kredietzorgen, maar vaak met stabiele inkomsten.'],
  'Industrials': [0, 'Industrie: volgt de economische cyclus, met orders die per jaar kunnen verschillen.'],
  'Real Estate': [0, 'Vastgoed: gevoelig voor de rente, maar met vaste huurinkomsten.'],
  'Healthcare': [-1, 'Gezondheidszorg: de vraag naar zorg hangt weinig af van de economie.'],
  'Consumer Defensive': [-1, 'Basisconsumptie: mensen blijven deze producten kopen, ook in een slechte economie.'],
  'Utilities': [-1, 'Nutsbedrijven: stabiele, vaak gereguleerde inkomsten.'],
};
const INDUSTRY_RISK = {
  'Semiconductors': [1, 'Chips: een sterk cyclische branche; vraag en prijzen wisselen snel, met grote koersuitslagen.'],
  'Semiconductor Equipment & Materials': [1, 'Chipmachines: orders hangen af van investeringen van chipmakers en wisselen sterk per jaar.'],
  'Biotechnology': [1, 'Biotechnologie: de koers hangt af van onderzoeksresultaten en goedkeuringen, die alles-of-niets kunnen zijn.'],
  'Aerospace & Defense': [0, 'Defensie en ruimtevaart: lange contracten, maar afhankelijk van overheidsbudgetten en grote projecten.'],
};

// Dagrendementen van de S&P 500 in euro: eigen fonds of FRED
function spRets(R) {
  const own = R.items.find((x) => x.n >= 60 && BENCHES[0][1].test(x.c.tk));
  if (own) return { rets: own.rets, vol: own.vol, name: own.c.tk };
  if (!(data.idx && data.idx.series && data.idx.series.SP500)) return null;
  const days = [...R.fx.keys()].sort(); let j = 0, last = null, prev = null; const rets = new Map();
  data.idx.series.SP500.forEach(([d, v]) => { while (j < days.length && days[j] <= d) { last = R.fx.get(days[j]); j++; } if (!last) return; const e = v / last; if (prev) { const r = e / prev - 1; if (Math.abs(r) < 0.5) rets.set(d, r); } prev = e; });
  const arr = [...rets.values()].slice(-260);
  return rets.size >= 60 ? { rets, vol: stdev(arr) * Math.sqrt(252), name: 'de S&P 500' } : null;
}

function riskWhy(c) {
  const R = riskModel();
  const x = R.items.find((i) => i.c.tk === c.tk) || { w: c.weight || 0 };
  const p = M.mk.ok ? M.mk.profOf(c.tk) : null;
  const isFund = isFundC(c);
  const sp = spRets(R);
  const mktVol = sp && isNum(sp.vol) ? sp.vol : 0.17;
  const up = [], down = [];
  const add = (d, t) => (d > 0 ? up : down).push(t);
  if (isNum(x.vol)) {
    const ratio = x.vol / mktVol;
    if (ratio >= 1.25) add(1, 'Schommelde het laatste jaar ' + P1.format(x.vol) + ' per jaar, ongeveer ' + N1.format(ratio) + ' keer zo veel als ' + (sp ? sp.name : 'de brede markt') + ' (' + P1.format(mktVol) + ').');
    else if (ratio <= 0.85) add(-1, 'Schommelde het laatste jaar ' + P1.format(x.vol) + ' per jaar, minder dan ' + (sp ? sp.name : 'de brede markt') + ' (' + P1.format(mktVol) + ').');
  }
  if (isFund) {
    if (BENCHES[1][1].test(c.tk) || /nasdaq/i.test(c.name)) { add(-1, 'Een fonds met 100 bedrijven: een tegenvaller bij één bedrijf weegt weinig.'); add(1, 'Wel geconcentreerd in grote technologiebedrijven, daardoor beweeglijker dan een breed fonds.'); }
    else add(-1, 'Een breed indexfonds met honderden bedrijven uit allerlei sectoren: tegenvallers bij één bedrijf middelen uit.');
  } else if (p) {
    if (isNum(p.beta) && p.beta >= 1.3) add(1, 'Reageert sterk op de markt (beta ' + N2.format(p.beta) + '): daalt de markt 10%, dan daalt dit aandeel gemiddeld zo\'n ' + Math.round(p.beta * 10) + '%.');
    else if (isNum(p.beta) && p.beta > 0 && p.beta <= 0.8) add(-1, 'Rustiger dan de markt (beta ' + N2.format(p.beta) + '): beweegt gemiddeld minder mee met dalingen en stijgingen.');
    if (isNum(p.marketCap) && p.marketCap < 10e9) add(1, 'Kleiner bedrijf (beurswaarde ' + mcap(p.marketCap, p.currency) + '): nieuws heeft meer invloed op de koers.');
    else if (isNum(p.marketCap) && p.marketCap > 200e9) add(-1, 'Een van de grootste bedrijven ter wereld (beurswaarde ' + mcap(p.marketCap, p.currency) + '): gevestigd en veel gevolgd.');
    const ind = p.industry && INDUSTRY_RISK[p.industry], sec = p.sector && SECTOR_RISK[p.sector];
    if (ind) { if (ind[0]) add(ind[0], ind[1]); } else if (sec && sec[0]) add(sec[0], sec[1]);
    if (p.ipoDate && Date.now() - ymd(p.ipoDate) < 5 * 365 * DAY) add(1, 'Pas sinds ' + new Date(ymd(p.ipoDate)).getFullYear() + ' op de beurs: weinig koersgeschiedenis en vaak sterke reacties op cijfers.');
  }
  const Fin = (data.fin || {})[c.tk];
  if (Fin && Fin.series) {
    const rev = new Map((Fin.series.rev && Fin.series.rev.rows) || []), net = new Map((Fin.series.net && Fin.series.net.rows) || []);
    const ys = [...net.keys()].sort((a, b) => a - b), ly = ys[ys.length - 1];
    if (ly && net.get(ly) < 0) add(1, 'Maakte in ' + ly + ' verlies: de koers leunt op verwachtingen voor later.');
    else if (ly && rev.get(ly) && net.get(ly) / rev.get(ly) > 0.2) add(-1, 'Zeer winstgevend (nettomarge ' + P1.format(net.get(ly) / rev.get(ly)) + ' in ' + ly + ').');
  }
  if ((c.weight || 0) > 0.1) add(1, 'Groot deel van je portefeuille (' + P1.format(c.weight) + '): een daling hier raakt je totaal direct.');
  if (isNum(x.contrib) && x.contrib > (x.w / (R.coverage || 1)) * 1.5) add(1, 'Levert ' + P1.format(x.contrib) + ' van je totale risico bij ' + P1.format(x.w) + ' van je waarde.');
  else if (isNum(x.contrib) && x.contrib < (x.w / (R.coverage || 1)) * 0.5) add(-1, 'Beweegt anders dan de rest van je portefeuille en spreidt daardoor (' + P1.format(x.contrib) + ' van het risico bij ' + P1.format(x.w) + ' van de waarde).');
  if (p && p.currency && p.currency !== 'USD' && p.currency !== 'EUR') add(1, 'Noteert in ' + p.currency + ': ook die wisselkoers telt mee.');
  if (p && p.currency === 'EUR') add(-1, 'Noteert in euro: geen wisselkoersrisico.');
  const verdict = isNum(x.vol) ? (x.vol / mktVol >= 1.25 ? 'hoger dan de markt' : x.vol / mktVol <= 0.85 ? 'lager dan de markt' : 'ongeveer als de markt')
    : up.length > down.length ? 'waarschijnlijk hoger dan de markt' : down.length > up.length ? 'waarschijnlijk lager dan de markt' : 'onbekend';

  // Rustigere alternatieven: vergelijkbare bedrijven met een lagere beta, en fondsen
  const alts = [];
  if (!isFund && M.mk.ok && p) {
    const myB = isNum(p.beta) ? p.beta : null;
    M.mk.peersOf(c.tk).map((s2) => M.mk.prof(s2)).filter(Boolean)
      .filter((q) => isNum(q.beta) && q.beta > 0 && (myB == null ? q.beta < 1 : q.beta <= myB - 0.15))
      .sort((a, b) => a.beta - b.beta).slice(0, 3)
      .forEach((q) => {
        const held = M.mk.heldBySym.get(q.symbol);
        const bits = ['beta ' + N2.format(q.beta)];
        if (isNum(q.marketCap)) bits.push('beurswaarde ' + mcap(q.marketCap, q.currency));
        if (q.industry && p.industry && q.industry === p.industry) bits.push('zelfde branche'); else if (q.sector) bits.push(sectorNl(q.sector));
        alts.push({ sym: q.symbol, name: q.name || q.symbol, held, text: bits.join(', ') + (held ? '; heb je al' : '') });
      });
  }
  const funds = [];
  const ownBroad = M.companies.find((d) => BENCHES[0][1].test(d.tk) || BENCHES[2][1].test(d.tk));
  if (isFund) {
    if (BENCHES[1][1].test(c.tk) || /nasdaq/i.test(c.name)) funds.push('Een breed S&P 500- of wereldfonds: minder afhankelijk van technologie, daardoor meestal minder beweeglijk.');
    else if (BENCHES[0][1].test(c.tk)) funds.push('Een wereldfonds (MSCI World of FTSE All-World) spreidt ook over Europa, Japan en andere landen, en minder over de dollar.');
    funds.push('Een obligatiefonds of geld schommelt veel minder, maar levert op lange termijn meestal ook minder op.');
  } else {
    if (p && p.sector) funds.push('Een sectorfonds voor ' + sectorNl(p.sector).toLowerCase() + ': dezelfde sector, maar verspreid over tientallen bedrijven.');
    funds.push(ownBroad ? 'Meer in je brede fonds (' + ownBroad.tk + '): honderden bedrijven in één keer.' : 'Een breed indexfonds (S&P 500 of wereld): honderden bedrijven in één keer.');
    if (p && SECTOR_RISK[p.sector] && SECTOR_RISK[p.sector][0] > 0) funds.push('Bedrijven uit rustigere sectoren (basisconsumptie, nutsbedrijven, gezondheidszorg) schommelen meestal minder.');
  }
  return { x, p, up, down, verdict, alts, funds, cls: x.cls, vol: x.vol };
}

function whyBody(c, W) {
  const li = (arr, cls) => arr.map((t) => '<li class="' + cls + '">' + esc(t) + '</li>').join('');
  return (W.up.length || W.down.length ? '<ul class="why">' + li(W.up, 'up') + li(W.down, 'down') + '</ul>' : '<p class="small muted">Nog te weinig gegevens om het risico te verklaren.</p>') +
    '<p class="why-h">Minder risicovolle alternatieven</p>' +
    (W.alts.length ? '<div class="alt-list">' + W.alts.map((a) => '<' + (a.held ? 'button type="button" data-open="' + esc(a.held) + '"' : 'div') + ' class="alt"><b>' + esc(a.sym) + '</b><span>' + esc(a.name) + '</span><span class="muted small">' + esc(a.text) + '</span></' + (a.held ? 'button' : 'div') + '>').join('') + '</div>' : '') +
    '<ul class="why alt-f">' + W.funds.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
}

function companyWhyTile(c) {
  const W = riskWhy(c);
  return '<section class="tile pad"><h3>Risico van ' + esc(c.tk) + '</h3>' +
    '<div class="why-top">' + (W.cls ? '<span class="lvl" style="--k:' + W.cls + '">' + W.cls + '</span>' : '') + '<span>Risico <b>' + esc(W.verdict) + '</b>' + (isNum(W.vol) ? ', ' + esc(P1.format(W.vol)) + ' per jaar' : '') + '</span></div>' +
    whyBody(c, W) + '<p class="sub" style="margin-top:8px">Alternatieven: vergelijkbare bedrijven met een lagere beta (FMP) en soorten fondsen. Minder risico betekent meestal ook minder verwacht rendement; dit is geen beleggingsadvies.</p></section>';
}

function whyListTile() {
  const R = riskModel();
  const list = M.companies.slice().sort((a, b) => {
    const xa = R.items.find((i) => i.c === a), xb = R.items.find((i) => i.c === b);
    return ((xb && isNum(xb.contrib) ? xb.contrib : 0) - (xa && isNum(xa.contrib) ? xa.contrib : 0)) || b.value - a.value;
  });
  return '<section class="tile pad span-2 why-list"><h3>Per bedrijf: waarom dit risico, en rustigere alternatieven</h3>' +
    list.map((c) => {
      const W = riskWhy(c);
      return '<details class="why-d"><summary>' + (W.cls ? '<span class="lvl" style="--k:' + W.cls + '">' + W.cls + '</span>' : '<span class="lvl na">–</span>') +
        '<span class="nm"><b>' + esc(c.tk) + '</b> <span class="muted">' + esc(c.name) + '</span></span><span class="small ' + (/hoger/.test(W.verdict) ? 'loss' : /lager/.test(W.verdict) ? 'gain' : 'muted') + '">' + esc(W.verdict) + '</span></summary>' +
        '<div class="why-in">' + whyBody(c, W) + '</div></details>';
    }).join('') +
    '<p class="sub" style="margin-top:10px">Gesorteerd op aandeel in je risico. Rood: redenen voor meer risico, groen: voor minder. Alternatieven zijn vergelijkbare bedrijven met een lagere beta (FMP) en soorten fondsen; minder risico betekent meestal ook minder verwacht rendement. Geen beleggingsadvies.</p></section>';
}

function renderRiskView() {
  const R = riskModel();
  const total = M.totalValue || 0;
  const I = riskIdeas(R);
  const effect = (x) => {
    if (!isNum(x.to) || !isNum(I.base)) return '';
    const c0 = srri(I.base), c1 = srri(x.to), d = x.to - I.base;
    return '<div class="sug-eff"><span class="lvl" style="--k:' + c0 + '">' + c0 + '</span><span class="arr" aria-hidden="true">→</span><span class="lvl" style="--k:' + c1 + '">' + c1 + '</span>' +
      '<span class="small">met je huidige verdeling: ' + esc(P1.format(I.base)) + ' → <b class="' + (d < 0 ? 'gain' : 'loss') + '">' + esc(P1.format(x.to)) + '</b> per jaar</span></div>';
  };
  const ranked = I.ideas.slice().sort((a, b) => (isNum(a.to) ? a.to : 9) - (isNum(b.to) ? b.to : 9));
  const sugg = '<section class="tile pad sugg span-2"><h3>Wat het risico verlaagt</h3>' +
    (R.cls ? riskScale(R.cls) : '') +
    (ranked.length ? '<ol class="sug-list">' + ranked.map((x) => '<li><b>' + esc(x.title) + '</b><p class="small">' + esc(x.text) + '</p>' + effect(x) + '</li>').join('') + '</ol>'
      : '<p class="muted" style="margin-top:12px">Geen duidelijke punten gevonden: je spreiding over posities, sectoren en munten is redelijk.</p>') +
    '<p class="sub" style="margin-top:10px">Rekenvoorbeelden met de koersen van het laatste jaar' + (I.canIdx ? ', met ' + esc(I.idxName) + ' als bestemming' : '; voor de getallen is koershistorie van een breed indexfonds nodig (FRED-sleutel of een eigen S&P 500-fonds)') +
    '. Verkopen kost bij dollaraandelen wisselkosten; nieuwe inleg anders verdelen kost niets extra. Dit is geen beleggingsadvies en zegt niets over toekomstige rendementen.</p></section>';

  // Slecht jaar
  const badYear = isNum(R.vol) ? -1.645 * R.vol : null;
  const year = '<section class="tile pad"><h3>Wat een slecht jaar kan betekenen</h3>' + kvList([
    ['Beweeglijkheid per jaar', isNum(R.vol) ? P1.format(R.vol) : '–'],
    ['Slecht jaar (ongeveer 1 op 20)', isNum(badYear) ? spct1(badYear) + ', nu ' + seur(badYear * total) : '–', 'loss'],
    ['Slechte week (ongeveer 1 op 20)', isNum(R.vol) ? spct1(-1.645 * R.vol / Math.sqrt(52)) + ', nu ' + seur(-1.645 * R.vol / Math.sqrt(52) * total) : '–', 'loss'],
    ['Slechte dag (1 op 20, gemeten)', isNum(R.badDay) ? spct(R.badDay) + ', nu ' + seur(R.badDay * total) : '–', 'loss'],
  ]) + '<p class="sub" style="margin-top:8px">Benadering met een normale verdeling rond nul; echte dalingen komen vaker in clusters en kunnen groter zijn. Over langere periodes middelt veel uit, daarom geldt: hoe hoger de klasse, hoe langer de horizon die erbij past.</p></section>';

  // Per positie
  const rows = R.items.slice().sort((a, b) => b.w - a.w);
  const per = '<section class="tile pad span-2"><h3>Per positie</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Positie</th><th class="num">Gewicht</th><th class="num">Beweeglijkheid</th><th class="num">Klasse</th><th class="num">Deel van het risico</th><th class="num">Beta</th></tr></thead><tbody>' +
    rows.map((x) => { const p = M.mk.ok ? M.mk.profOf(x.c.tk) : null;
      return '<tr data-open="' + esc(x.c.tk) + '" class="rowlink"><td><b>' + esc(x.c.tk) + '</b> <span class="muted small">' + esc(x.c.name) + '</span></td><td class="num">' + esc(P1.format(x.w)) + '</td>' +
        '<td class="num">' + esc(isNum(x.vol) ? P1.format(x.vol) : '–') + '</td><td class="num">' + (x.cls ? '<span class="lvl" style="--k:' + x.cls + '">' + x.cls + '</span>' : '–') + '</td>' +
        '<td class="num' + (isNum(x.contrib) && x.contrib > x.w / (R.coverage || 1) * 1.2 ? ' loss' : '') + '">' + esc(isNum(x.contrib) ? P1.format(x.contrib) : '–') + '</td><td class="num">' + esc(p && isNum(p.beta) ? N2.format(p.beta) : '–') + '</td></tr>'; }).join('') +
    '</tbody></table></div><p class="sub" style="margin-top:8px">Beweeglijkheid per jaar uit de dagkoersen in euro (' + esc([...new Set(R.items.map((x) => x.basis).filter(Boolean))].join(', ')) + '). Rood: meer risico dan gewicht. Beta van FMP.</p></section>';

  const t = riskTiles(true);
  const head = pseudoHead('Risico-indicatie', R.cls ? R.cls + ' van 7' : 'Nog geen indicatie', R.cls ? RISK_WORDS[R.cls] + ', beweeglijkheid ongeveer ' + P1.format(R.vol) + ' per jaar' : 'Er zijn nog te weinig gegevens.');
  const why = whyListTile();
  return pseudoPage('Risico', head, [[sugg, year], [why], [t[0], t[1], t[2]], [per]], [sugg, why, year, t[0], t[1], t[2], per]);
}

function plTile() {
  const pl = M.companies.filter((c) => isNum(c.unreal)).sort((a, b) => b.unreal - a.unreal);
  const mx = Math.max(1e-9, ...pl.map((c) => Math.abs(c.unreal)));
  return '<section class="tile pad"><h3>Winst en verlies per positie</h3><div class="hbars">' + pl.map((c) => {
    const w = (Math.abs(c.unreal) / mx * 50).toFixed(1) + '%';
    return '<button type="button" class="r" data-open="' + esc(c.tk) + '" data-tip="' + esc(c.name + ': ' + seur(c.unreal) + ' (' + spct1(c.resultPct) + ')') + '">' +
      '<span class="tk">' + esc(c.tk) + '</span><span class="track"><span class="mid"></span><span class="' + (c.unreal < 0 ? 'neg' : 'pos') + '" style="width:' + w + '"></span></span>' +
      '<span class="' + tone(c.unreal) + '" style="text-align:right;font-weight:600">' + esc(seur(c.unreal)) + '</span></button>';
  }).join('') + '</div><p class="sub" style="margin-top:10px">Ongerealiseerd resultaat ten opzichte van wat je erin hebt gestoken. Klik op een positie voor de details.</p></section>';
}

function signedBars(parts) {
  const mx = Math.max(1e-9, ...parts.filter((p) => isNum(p[1])).map((p) => Math.abs(p[1])));
  return '<div class="hbars">' + parts.filter((p) => isNum(p[1])).map(([k, v, tip]) =>
    '<div class="r wide-l" data-tip="' + esc(tip || k) + '"><span class="tk">' + esc(k) + '</span><span class="track"><span class="mid"></span><span class="' + (v < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(v) / mx * 50).toFixed(1) + '%"></span></span>' +
    '<span class="' + tone(v) + '" style="text-align:right;font-weight:600">' + esc(seur(v)) + '</span></div>').join('') + '</div>';
}

function renderResultView() {
  const lw = M.lastWeek, total = M.accountNow;
  const res = lw && isNum(lw.netDeposits) ? total - lw.netDeposits : null;
  const unreal = sum(M.companies.map((c) => (isNum(c.unreal) ? c.unreal : 0)));
  const T = M.tx;
  const fxE = T.has && isNum(T.fx) ? T.fx : null;
  const real = T.has && isNum(T.realised) ? T.realised : 0;
  const divs = (M.ev && M.ev.received) || [];
  const div = sum(divs.map((d) => (isNum(d.amount) ? d.amount : 0)));
  const rest = isNum(res) ? res - unreal - real - div : null;
  const parts = [
    ['Koers', unreal - (fxE || 0), 'Koerswinst of -verlies van je open posities, zonder het valuta-effect'],
    ['Valuta', fxE, 'Effect van de euro-dollarkoers op je open posities sinds aankoop'],
    ['Verkocht', T.has ? real : null, 'Gerealiseerd resultaat bij verkopen'],
    ['Dividend', divs.length ? div : null, 'Ontvangen dividend (' + divs.length + ' uitkeringen)'],
    ['Overig', rest, 'Wat overblijft: resultaat van vóór je orderhistorie, rente op je saldo en afronding'],
  ];
  const build = '<section class="tile pad span-2"><h3>Waar je resultaat vandaan komt</h3>' + signedBars(parts) +
    '<div style="margin-top:12px">' + kvList([
      ['Accountwaarde nu', eur(total)],
      ['Netto gestort', lw ? eur(lw.netDeposits) : '–'],
      ['Totaal resultaat', isNum(res) ? seur(res) + ' (' + spct1(res / lw.netDeposits) + ')' : '–', tone(res)],
      ['Waarvan open posities', seur(unreal), tone(unreal)],
      ['Betaalde kosten (zitten al in de bedragen)', T.has ? eur(T.fees) : '–'],
    ]) + '</div><p class="sub" style="margin-top:8px">Koers en valuta uit je posities, verkopen en kosten uit je orders, dividend uit Trading 212. "Overig" is wat overblijft: resultaat van vóór je orderhistorie, rente op je saldo en afronding.</p></section>';
  const W = M.weeks.filter((w) => isNum(w.weekResultPct));
  let idx = 1; W.forEach((w) => { idx *= 1 + w.weekResultPct; });
  const bestW = W.slice().sort((a, b) => b.weekResult - a.weekResult)[0], worstW = W.slice().sort((a, b) => a.weekResult - b.weekResult)[0];
  const perf = '<section class="tile pad"><h3>Rendement</h3><div class="inset">' +
    spark(M.weeks.filter((w) => isNum(w.totalResult)).map((w) => ({ t: w.t, v: w.totalResult })), toneColor(res), 'spark tall') + '</div>' + kvList([
      ['Op je inleg', isNum(res) && lw.netDeposits ? spct1(res / lw.netDeposits) : '–', tone(res)],
      ['Zonder stortingen (tijdgewogen)', W.length ? spct1(idx - 1) + ' over ' + W.length + ' weken' : '–', tone(idx - 1)],
      ['Weken met winst', W.length ? W.filter((w) => w.weekResultPct > 0).length + ' van ' + W.length : '–'],
      ['Beste week', bestW ? seur(bestW.weekResult) + ', tot ' + fDM.format(bestW.t) : '–', 'gain'],
      ['Slechtste week', worstW ? seur(worstW.weekResult) + ', tot ' + fDM.format(worstW.t) : '–', 'loss'],
    ]) + '<p class="sub" style="margin-top:8px">Lijn: totaal resultaat per week. Tijdgewogen rendement telt stortingen niet mee, zodat je het kunt vergelijken met een fonds.</p></section>';
  const head = pseudoHead('Totaal resultaat', isNum(res) ? seur(res) : '–', isNum(res) ? spct1(res / lw.netDeposits) + ' op ' + eur(lw.netDeposits) + ' netto gestort' : 'Na de eerste weekmeting.', tone(res));
  const extra = [realisedTile(), fxTile(), inflationTile()].filter(Boolean);
  return pseudoPage('Resultaat', head, [[build, perf], [plTile()].concat(extra)], [build, perf, plTile()].concat(extra));
}

function renderDepositView() {
  const lw = M.lastWeek;
  const W = M.weeks.filter((w) => isNum(w.newDeposits));
  const dep = W.filter((w) => Math.abs(w.newDeposits) >= 0.01);
  const ins = sum(dep.filter((w) => w.newDeposits > 0).map((w) => w.newDeposits)), outs = sum(dep.filter((w) => w.newDeposits < 0).map((w) => w.newDeposits));
  const first = M.weeks[0];
  const months = first && lw ? Math.max(1, (lw.t - first.t) / (30.44 * DAY)) : null;
  const monthly = isNum(M.settings && M.settings.monthly) ? M.settings.monthly : null;
  const guess = typeof monthlyGuess === 'function' ? monthlyGuess() : null;
  const facts = '<section class="tile pad"><h3>In cijfers</h3>' + kvList([
    ['Netto gestort nu', lw ? eur(lw.netDeposits) : '–'],
    ['Bij de start van de tracker', first ? eur(first.netDeposits) + ' (' + fDM.format(first.t) + ')' : '–'],
    ['Sindsdien gestort', seur(ins), 'gain'],
    ['Sindsdien opgenomen', outs ? seur(outs) : 'niets', outs ? 'loss' : ''],
    ['Gemiddeld per maand', months ? seur((ins + outs) / months) : '–'],
    ['Weken met een storting', dep.length + ' van ' + W.length],
    ['Laatste storting', dep.length ? seur(dep[dep.length - 1].newDeposits) + ', week tot ' + fDM.format(dep[dep.length - 1].t) : '–'],
    ['Maandbedrag op Plannen', isNum(monthly) ? eur(monthly) : isNum(guess) && guess > 0 ? 'niet ingesteld (geschat ' + eur(guess) + ')' : 'niet ingesteld'],
  ]) + '</section>';
  // Per maand
  const byM = new Map();
  dep.forEach((w) => { const d = new Date(w.t); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); byM.set(k, (byM.get(k) || 0) + w.newDeposits); });
  const mk = []; if (first && lw) { const d = new Date(first.t); d.setDate(1); while (d.getTime() <= lw.t) { mk.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); d.setMonth(d.getMonth() + 1); } }
  const fMonL = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
  const anyNeg = mk.some((k) => (byM.get(k) || 0) < 0);
  const perM = '<section class="tile pad"><h3>Per maand</h3>' + (mk.length ? bars(mk.map((k) => ({ v: byM.get(k) || 0, color: C.gain, tip: fMonL.format(new Date(k + '-15')) + ': ' + seur(byM.get(k) || 0) })), !anyNeg) +
    barLabels(mk.map((k) => fMonL.format(new Date(k + '-15')))) : '<p class="muted">Nog geen weken gemeten.</p>') + '<p class="sub" style="margin-top:8px">Stortingen min opnames per kalendermaand, uit je weekmetingen.</p></section>';
  // Inleg tegenover waarde
  const pts = M.weeks.filter((w) => isNum(w.netDeposits) && isNum(w.accountValue));
  let lines = '';
  if (pts.length >= 2) {
    const lo = Math.min(...pts.map((w) => Math.min(w.netDeposits, w.accountValue))), hi = Math.max(...pts.map((w) => Math.max(w.netDeposits, w.accountValue)));
    const X = (i) => (i / (pts.length - 1) * 300).toFixed(1), Y = (v) => (8 + (hi - v) / Math.max(1e-9, hi - lo) * 104).toFixed(1);
    const path = (f) => pts.map((w, i) => (i ? 'L' : 'M') + X(i) + ' ' + Y(f(w))).join('');
    lines = '<svg class="dual" viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true"><path d="' + path((w) => w.accountValue) + '" fill="none" stroke="' + C.accent + '" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + path((w) => w.netDeposits) + '" fill="none" stroke="' + C.ink2 + '" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/></svg>' +
      '<div class="xlabels"><span>' + esc(fDM.format(pts[0].t)) + '</span><span>' + esc(fDM.format(pts[pts.length - 1].t)) + '</span></div>' +
      '<div class="legend"><span><i style="background:' + C.accent + '"></i>Accountwaarde</span><span><i class="dash" style="border-color:' + C.ink2 + '"></i>Netto gestort</span></div>';
  }
  const dual = '<section class="tile pad"><h3>Inleg tegenover waarde</h3>' + (lines || '<p class="muted">Na twee weekmetingen.</p>') +
    '<p class="sub" style="margin-top:8px">De ruimte tussen de lijnen is je resultaat.</p></section>';
  const list = '<section class="tile pad"><h3>Alle stortingen en opnames</h3>' + (dep.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Week tot</th><th class="num">Bedrag</th><th class="num">Netto gestort daarna</th></tr></thead><tbody>' +
    dep.slice().reverse().map((w) => '<tr><td>' + esc(fD.format(w.t)) + '</td><td class="num ' + tone(w.newDeposits) + '">' + esc(seur(w.newDeposits)) + '</td><td class="num">' + esc(eur(w.netDeposits)) + '</td></tr>').join('') + '</tbody></table></div>'
    : '<p class="muted">Nog geen stortingen sinds de start van de tracker.</p>') + '<p class="sub" style="margin-top:8px">Per week, het verschil in netto gestort tussen twee weekmetingen.</p></section>';
  const head = pseudoHead('Netto gestort', lw ? eur(lw.netDeposits) : '–', dep.length ? seur(ins + outs) + ' sinds de start van de tracker, ' + dep.length + (dep.length === 1 ? ' storting' : ' stortingen') + '.' : 'Nog geen stortingen sinds de start van de tracker.');
  return pseudoPage('Stortingen', head, [[dual, perM, facts], [list]], [facts, dual, perM, list]);
}

// ---------- Bedrijfspagina (beide weergaven) ----------
function renderDetail(animate, swapDir) {
  if (ui.detail === ACC) { $('detail-inner').innerHTML = renderAccount(); return; }
  if (ui.detail === RISK) { $('detail-inner').innerHTML = renderRiskView(); return; }
  if (ui.detail === RES) { const inner = $('detail-inner'); inner.innerHTML = renderResultView(); drawMacro(inner); return; }
  if (ui.detail === DEP) { $('detail-inner').innerHTML = renderDepositView(); return; }
  if (ui.detail === STATUS) { $('detail-inner').innerHTML = renderStatusView(); return; }
  if (ui.detail === CMP) { const inner = $('detail-inner'); inner.innerHTML = renderCompareView(); drawCompare(inner); return; }
  if (isWatchKey(ui.detail)) { const inner = $('detail-inner'); inner.innerHTML = renderWatchDetail(ui.detail.slice(1)); drawWatchChart(inner); drawSectorChart(inner); return; }
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
  const uw = e.target.closest('[data-unwatch]');
  if (uw) { const sym = uw.dataset.unwatch; closeDetail(); setWatchlist(watchSyms().filter((x) => x !== sym), null, sym + ' is van je volglijst gehaald.'); return; }
  const op = e.target.closest('[data-open]');
  if (op) { switchDetail(op.dataset.open, 'r'); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) { ui.mTab = tab.dataset.tab; renderDetail(false); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'back') closeDetail();
  else if (act === 'prev' || act === 'next') stepDetail(act === 'next' ? 1 : -1);
  else if (act === 'compare') { if (ui.detail && !isPseudo(ui.detail)) { xs.cmpA = ui.detail; if (xs.cmpB === xs.cmpA) xs.cmpB = null; } switchDetail(CMP, 'r'); }
});
$('detail').addEventListener('change', (e) => {
  const s = e.target.closest && e.target.closest('select[data-cmp]');
  if (!s) return;
  xs[s.dataset.cmp] = s.value;
  if (xs.cmpA === xs.cmpB) xs[s.dataset.cmp === 'cmpA' ? 'cmpB' : 'cmpA'] = null;
  markFresh();
  renderDetail(false);
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
