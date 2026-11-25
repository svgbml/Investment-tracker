/* Investeringstracker – Gemak: de pagina Analyse, uitleg van begrippen, pagina's aanpassen, snel zoeken (Ctrl+K) en sneltoetsen,
 * vegen en omlaag trekken op de telefoon, teller op het app-icoon, weergave-opties, rondleiding, alle transacties (virtuele lijst)
 * en exporteren naar Excel of JSON
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Uitleg van begrippen ----------
const GLOSS = {
  xirr: ['XIRR (geldgewogen rendement)', 'Je rendement per jaar, rekening houdend met wanneer je geld stortte. Stort je vlak voor een daling, dan telt die zwaarder mee. Dit is wat jij echt verdiende.'],
  twr: ['TWR (tijdgewogen rendement)', 'Het rendement van je beleggingen los van stortingen en opnames, zoals fondsen het rapporteren. Handig om met een index te vergelijken.'],
  drawdown: ['Drawdown', 'Hoeveel je beleggingen vanaf een eerdere top zijn gedaald. De grootste drawdown laat zien wat je in een slechte periode moest verdragen.'],
  vol: ['Beweeglijkheid (volatiliteit)', 'Hoe sterk de waarde van dag tot dag schommelt, omgerekend naar een jaar. 15% betekent: in twee van de drie jaren ligt het rendement ongeveer binnen 15 procentpunt van het gemiddelde.'],
  sharpe: ['Sharpe-ratio', 'Rendement boven de risicovrije rente, gedeeld door de beweeglijkheid. Hoger is beter: meer rendement per eenheid risico. Boven 1 is goed.'],
  hhi: ['HHI (Herfindahl-index)', 'De som van de kwadraten van alle gewichten. Eén positie geeft 1, tien even grote posities geven 0,1. Hoe lager, hoe meer je geld gespreid is. 1 gedeeld door de HHI is het effectieve aantal posities.'],
  sortino: ['Sortino-ratio', 'Zoals de Sharpe-ratio, maar alleen dalingen tellen als risico. Stijgingen zijn immers geen probleem.'],
  calmar: ['Calmar-ratio', 'Rendement per jaar gedeeld door de grootste daling. Laat zien hoeveel rendement je kreeg voor de pijn van de diepste dip.'],
  beta: ['Beta', 'Hoe sterk je beleggingen meebewegen met de markt. Beta 1,2: als de S&P 500 1% stijgt, stijg jij gemiddeld 1,2%.'],
  unreal: ['Ongerealiseerd', 'Winst of verlies op wat je nog bezit: de waarde nu min wat je ervoor betaalde. Pas bij verkopen wordt het gerealiseerd.'],
  real: ['Gerealiseerd', 'Winst of verlies die vaststaat omdat je (een deel) verkocht.'],
  fxfee: ['Wisselkosten', 'Kosten voor het omwisselen van euro naar dollar of een andere munt bij kopen en verkopen. Bij Trading 212 0,15%.'],
  montecarlo: ['Monte Carlo-berekening', 'Duizenden willekeurige toekomsten doorrekenen met een gemiddeld rendement en schommelingen. Zo zie je niet één uitkomst, maar hoe groot de kans is dat je je doel haalt.'],
  fire: ['FIRE', 'Financial Independence, Retire Early: genoeg vermogen om van te leven. Vaak gerekend als 25 tot 33 keer je jaaruitgaven (3 tot 4% opnemen per jaar).'],
  rebalance: ['Herbalanceren', 'Je verdeling terugbrengen naar je doel door te verkopen wat te groot is geworden en te kopen wat te klein is.'],
  box3: ['Box 3', 'De Nederlandse belasting op sparen en beleggen. Nu op een fictief rendement over je vermogen op 1 januari; straks (voorstel) op je werkelijke rendement.'],
  pe: ['K/W (koers-winstverhouding)', 'De koers gedeeld door de winst per aandeel. 20 betekent: je betaalt 20 jaar winst voor het aandeel. Lager is goedkoper, maar groeibedrijven hebben vaak een hoge K/W.'],
  ter: ['TER (lopende kosten)', 'Wat een fonds per jaar aan kosten rekent, als percentage van je inleg. Het zit in de koers verwerkt; je betaalt het dus ongemerkt.'],
  insider: ['Insiders', 'Bestuurders en grootaandeelhouders van een bedrijf. In de VS moeten ze hun aan- en verkopen melden.'],
  dividend: ['Dividendrendement', 'Het dividend van een jaar gedeeld door de koers.'],
  etf: ['ETF (indexfonds)', 'Een fonds dat op de beurs verhandeld wordt en een index volgt, zoals de S&P 500. Eén aankoop geeft je honderden bedrijven.'],
};
const trm = (label, key) => (GLOSS[key] ? '<button type="button" class="term" data-term="' + key + '">' + esc(label) + '</button>' : esc(label));
// kvList, maar het label is al veilige HTML (bijv. met een begrip)
const rawKv = (rows) => '<dl class="kv">' + rows.map(([k, v, c]) => '<div><dt>' + k + '</dt><dd' + (c ? ' class="' + c + '"' : '') + '>' + esc(v) + '</dd></div>').join('') + '</dl>';
function glossaryTile() {
  return '<section class="tile pad full"><h3>Begrippen</h3><dl class="gloss">' + Object.values(GLOSS).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>' +
    '<p class="sub" style="margin-top:8px">Overal op de site kun je op een onderstreept begrip tikken voor deze uitleg.</p></section>';
}
let termPop = null;
function closeTerm() { if (termPop) { termPop.remove(); termPop = null; } }
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-term]');
  if (!b) { if (termPop && !(e.target.closest && e.target.closest('.term-pop'))) closeTerm(); return; }
  e.preventDefault(); e.stopPropagation();
  const g = GLOSS[b.dataset.term];
  if (!g) return;
  closeTerm();
  termPop = document.createElement('div');
  termPop.className = 'term-pop';
  termPop.setAttribute('role', 'dialog');
  termPop.innerHTML = '<b>' + esc(g[0]) + '</b><p>' + esc(g[1]) + '</p><button type="button" class="btn ghost" data-term-close>Sluiten</button>';
  document.body.appendChild(termPop);
  const r = b.getBoundingClientRect(), w = Math.min(320, innerWidth - 32);
  termPop.style.width = w + 'px';
  termPop.style.left = Math.max(16, Math.min(innerWidth - w - 16, r.left)) + 'px';
  const below = r.bottom + 8 + termPop.offsetHeight < innerHeight;
  termPop.style.top = (below ? r.bottom + 8 : Math.max(8, r.top - termPop.offsetHeight - 8)) + 'px';
  termPop.querySelector('[data-term-close]').addEventListener('click', closeTerm);
}, true);
window.addEventListener('scroll', closeTerm, { passive: true });

// ---------- Alle transacties: één lijst met virtueel scrollen ----------
function ledgerItems() {
  const out = [];
  M.tx.list.forEach((x) => out.push({ t: x.t, kind: x.side === 'SELL' ? 'verkoop' : x.kind && x.kind !== 'TRADE' ? 'overig' : 'koop', tk: x.tk, text: (x.qty ? N4.format(x.qty) + ' × ' + money(x.price, x.cur) : x.name || ''), v: x.side === 'SELL' ? x.net : -x.net, fee: (x.feeFx || 0) + (x.feeOther || 0) }));
  M.ev.received.forEach((d) => out.push({ t: d.t, kind: 'dividend', tk: d.ticker, text: d.perShare ? money(d.perShare, curOfTk(d.ticker)) + ' per aandeel' : 'dividend', v: d.amount }));
  ((data.ext2 && data.ext2.interest) || []).forEach((d) => { const t = ymd(d.date); if (t != null) out.push({ t, kind: 'rente', tk: '', text: 'rente over vrij saldo', v: d.amount }); });
  M.weeks.forEach((w) => { if (isNum(w.newDeposits) && Math.abs(w.newDeposits) >= 0.01) out.push({ t: w.t, kind: w.newDeposits > 0 ? 'storting' : 'opname', tk: '', text: 'netto in de week tot ' + fDM.format(w.t), v: w.newDeposits }); });
  return out.sort((a, b) => b.t - a.t);
}
function ledgerFiltered() {
  const q = anState.txQuery.trim().toLowerCase(), k = anState.txKind;
  return ledgerItems().filter((x) => (k === 'all' || x.kind === k || (k === 'storting' && x.kind === 'opname')) && (!q || (x.tk + ' ' + x.text + ' ' + x.kind).toLowerCase().includes(q)));
}
function ledgerTile() {
  return '<section class="tile pad full ledger"><div class="plan-head"><h3>Alle transacties</h3>' +
    segX('anTxKind', [['all', 'Alles'], ['koop', 'Koop'], ['verkoop', 'Verkoop'], ['dividend', 'Dividend'], ['storting', 'Storten'], ['rente', 'Rente']], anState.txKind, 'Soort') + '</div>' +
    '<input class="search" type="search" data-ledger-q placeholder="Zoek op ticker of omschrijving" value="' + esc(anState.txQuery) + '" aria-label="Transacties doorzoeken">' +
    '<p class="small muted ledger-n" style="margin:6px 0"></p><div class="vlist" data-vlist="ledger" role="list"></div></section>';
}
const LEDGER_ROW = 52;
function ledgerRow(x) {
  const tagCls = x.kind === 'koop' || x.kind === 'storting' ? 'gain' : x.kind === 'verkoop' || x.kind === 'opname' ? 'loss' : '';
  return '<div class="tx vrow" role="listitem"><span class="tag ' + tagCls + '">' + esc(x.kind) + '</span><span class="tx-m"><b>' + esc((x.tk ? x.tk + ' ' : '') + x.text) + '</b><span class="sub">' + esc(fD.format(x.t) + ' ' + new Date(x.t).getFullYear()) + (x.fee ? ' · kosten ' + esc(eur(x.fee)) : '') + '</span></span><span class="tx-v ' + tone(x.v) + '">' + esc(seur(x.v)) + '</span></div>';
}
// Alleen de zichtbare regels tekenen; de rest is lege ruimte van de juiste hoogte
function virtualList(host, items, rowH, render) {
  host.innerHTML = '<div class="vspace" style="height:' + items.length * rowH + 'px"></div><div class="vrows"></div>';
  const rows = host.querySelector('.vrows');
  let last = '';
  const draw = () => {
    const top = host.scrollTop, h = host.clientHeight || 420;
    const a = Math.max(0, Math.floor(top / rowH) - 6), b = Math.min(items.length, Math.ceil((top + h) / rowH) + 6);
    const key = a + ':' + b;
    if (key === last) return;
    last = key;
    rows.style.transform = 'translateY(' + a * rowH + 'px)';
    rows.innerHTML = items.slice(a, b).map(render).join('');
  };
  let raf = 0;
  host.onscroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  draw();
}
function mountLedger(root) {
  const host = root.querySelector('[data-vlist="ledger"]');
  if (!host) return;
  const items = ledgerFiltered();
  const n = root.querySelector('.ledger-n');
  if (n) n.textContent = NI.format(items.length) + (items.length === 1 ? ' regel' : ' regels');
  if (!items.length) { host.innerHTML = '<p class="muted" style="padding:12px">Niets gevonden.</p>'; return; }
  virtualList(host, items, LEDGER_ROW, ledgerRow);
}
document.addEventListener('input', (e) => {
  const el = e.target.closest && e.target.closest('[data-ledger-q]');
  if (!el) return;
  anState.txQuery = el.value;
  mountLedger(el.closest('.tile'));
});

// ---------- De pagina Analyse ----------
// Op de telefoon staat Analyse in tabbladen (secTabs) en is maar één onderdeel tegelijk te zien. Alleen dat
// onderdeel wordt dan echt gevuld; de andere krijgen alleen hun kop (voor de tabbladen en "Pagina aanpassen").
// Voor het rapport (pdf) zet analyseAll alles tijdelijk aan.
let analyseAll = false;
function renderAnalyse() {
  const host = mode === 'm' ? $('m-analyse-body') : $('analyse-body');
  if (!host || !M) return;
  // Elk onderdeel is een hoofdstuk van het rapport (js/31-analyse-rapport.js): kop voor de tabbladen en "Pagina
  // aanpassen" (verborgen op het scherm), een opening met nummer en titel, en daaronder de tegels.
  let K = null;
  const sec = (id, title, sub, tiles, i, full) => {
    const t = tiles.filter(Boolean);
    return '<div class="dash-sec an-ch" data-sec="' + id + '" id="' + id + '"><div class="section-head"><h2>' + esc(title) + '</h2>' + (sub ? '<p class="muted small">' + esc(sub) + '</p>' : '') + '</div>' +
      (typeof anOpener === 'function' ? anOpener(i, title, sub, full ? t.length : null, K) : '') +
      '<div class="plan-grid">' + t.join('') + '</div></div>';
  };
  const AX = () => (typeof analyseExtraTiles === 'function' ? analyseExtraTiles() : []);
  /** @type {[string, string, string, () => string[]][]} */
  const SECS = [
    ['an-ret', 'Rendement', 'Wat je echt verdiende, tegenover een maatstaf, en met welk risico', () => { const X = AX(); return [returnsTile(), benchTile(), ratiosTile(), drawdownTile(), X[0], X[1], contribTile(), X[2], concTile(), periodCmpTile(), yearHeatTile(), realUnrealTile(), fxFeeTile(), X[3], piesTile(), wrappedTile()]; }],
    ['an-exp', 'Doorkijk en kosten', 'Waar je geld werkelijk in zit, en wat het omwisselen kost', () => [typeof lookAllTile === 'function' ? lookAllTile() : '', typeof concTimeTile === 'function' ? concTimeTile() : '', typeof fxCalcTile === 'function' ? fxCalcTile() : '']],
    ['an-mkt', 'Markt en onderzoek', 'Indexen, rentes, agenda, en wat insiders en grote beleggers doen', () => [mkOverviewTile(), econTile(), heatmapTile(), sectorRotTile(), insiderClusterTile(), earningsMoveTile(), filingsTile(), screenerTile(), etfFinderTile(), f13Tile()]],
    ['an-trade', 'Kopen, verkopen en dagboek', 'Oefenen, beveiliging, vragen voor je verkoopt en wat je besloot', () => [paperTile(), orderSafetyTile(), sellCheckTile(), orderHistoryTile(), decJournalTile(), decYearTile()]],
    ['an-tx', 'Transacties en begrippen', 'Alles wat er op je rekening gebeurde, en uitleg van de termen', () => [openOrdersTile(), ledgerTile(), glossaryTile()]],
  ];
  const lazy = mode === 'm' && !analyseAll;
  if (typeof anHead === 'function') K = anHead(SECS);
  host.innerHTML = (typeof reportHead === 'function' ? reportHead() : '') +
    SECS.map(([id, title, sub, tiles], i) => sec(id, title, sub, lazy ? [] : tiles(), i, !lazy)).join('') +
    '<div class="dash-foot"><button type="button" class="btn ghost" data-dash-edit="analyse">Pagina aanpassen</button>' +
    '<button type="button" class="btn ghost" data-report-print title="Afdrukken of opslaan als pdf; in het rapport staan alle secties, ook de verborgen">Rapport (pdf)</button></div>';
  dashApply(host, 'analyse');
  if (lazy) {
    // Hetzelfde onderdeel als secTabs kiest: het gekozen tabblad, anders het eerste in de volgorde van de gebruiker
    const first = /** @type {HTMLElement|null} */ (host.querySelector(':scope > .dash-sec'));
    const pick = SECS.find((x) => x[1] === secPick.analyse) || SECS.find((x) => first && x[0] === first.dataset.sec) || SECS[0];
    const grid = host.querySelector('.dash-sec[data-sec="' + pick[0] + '"] .plan-grid');
    if (grid) grid.innerHTML = pick[3]().filter(Boolean).join('');
  }
  drawBench(host); drawDrawdown(host); drawPeriodCmp(host); mountLedger(host);
  if (typeof drawConcTime === 'function') drawConcTime(host);
  if (typeof drawAnLead === 'function') { drawAnLead(host); anNavTrack(); }
  if (typeof mountAnalyseExtra === 'function') mountAnalyseExtra(host);
  secTabs('analyse');
}

// ---------- Telefoon: lange pagina's (Analyse, Plannen) als tabbladen per onderdeel ----------
const SEC_SHORT = { 'Inleg en doelen': 'Inleg', 'Wat als': 'Wat als', 'Dividend en belasting': 'Dividend', 'Kosten en aankopen': 'Kosten', 'Spreiding en rekeningen': 'Spreiding', 'Delen en exporteren': 'Delen',
  'Vooruit rekenen': 'Vooruit', 'Belasting, herbalanceren en rente': 'Belasting', 'Rendement': 'Rendement', 'Markt en onderzoek': 'Markt', 'Transacties en begrippen': 'Transacties', 'Doorkijk en kosten': 'Doorkijk',
  'Kopen, verkopen en dagboek': 'Handel',
  'Vooruitblik': 'Vooruit', 'Dividend en inkomen': 'Dividend', 'Belasting en jaaroverzicht': 'Belasting', 'Kosten, herbalanceren en rekeningen': 'Kosten' };
const secPick = {};
function secTabs(key) {
  const host = $(key === 'plan' ? 'm-plan-body' : 'm-analyse-body'), bar = $(key === 'plan' ? 'm-plan-tabs' : 'm-analyse-tabs');
  if (!host || !bar) return;
  const groups = mode !== 'm' ? [] : [...host.querySelectorAll('.section-head')].map((h) => {
    const w = h.closest('.dash-sec');
    /** @type {HTMLElement[]} */
    const els = /** @type {any[]} */ (w ? [w] : [h, h.nextElementSibling].filter(Boolean));
    return { title: (h.querySelector('h2') || h).textContent.trim(), els };
  }).filter((g) => g.title);
  if (groups.length < 2) { bar.hidden = true; groups.forEach((g) => g.els.forEach((el) => { el.hidden = false; })); return; }
  let cur = secPick[key];
  if (!groups.some((g) => g.title === cur)) cur = groups[0].title;
  secPick[key] = cur;
  bar.hidden = false;
  bar.innerHTML = groups.map((g, i) => '<button type="button" data-sectab="' + esc(g.title) + '" aria-pressed="' + (g.title === cur) + '">' + (key === 'analyse' || key === 'plan' ? '<span class="no">' + String(i + 1).padStart(2, '0') + '</span> ' : '') + esc(SEC_SHORT[g.title] || g.title) + '</button>').join('');
  groups.forEach((g) => g.els.forEach((el) => { el.hidden = g.title !== cur; }));
  const on = /** @type {HTMLElement|null} */ (bar.querySelector('[aria-pressed="true"]'));
  if (on) bar.scrollLeft = Math.max(0, on.offsetLeft - 16);
  bar.onclick = (e) => {
    const b = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('[data-sectab]'));
    if (!b) return;
    secPick[key] = b.dataset.sectab;
    window.scrollTo(0, 0);
    // Opnieuw tekenen, zodat grafieken in het zichtbare onderdeel de juiste breedte krijgen
    refresh(key === 'plan' ? 'plan' : 'analyse');
  };
}
defineView('analyse', () => renderAnalyse());
defineView('badge', () => { updateBadge(); maybeTour(); });
Object.keys(PAGE_VIEWS).forEach((p) => { if (!PAGE_VIEWS[p].includes('badge')) PAGE_VIEWS[p].push('badge'); });
PAGE_VIEWS.stats = ['analyse', 'badge'];

// ---------- Pagina's aanpassen: secties verplaatsen, vastzetten of verbergen ----------
const LS_DASH = 'tracker.dash';
const dashPrefs = () => { try { return JSON.parse(localStorage.getItem(LS_DASH) || '{}'); } catch (e) { return {}; } };
function dashSave(all) { try { localStorage.setItem(LS_DASH, JSON.stringify(all)); } catch (e) { /* niet erg */ } }
// Koppen met de tegels eronder samen in een blok zetten (één keer per pagina)
function dashWrap(root, key) {
  if (!root || root.dataset.dash) return;
  [...root.children].forEach((h) => {
    if (!h.matches('.section-head, .m-head')) return;
    // Alles tussen deze kop en de volgende hoort bij de sectie (soms meer dan één blok, zoals een strook boven de tegels)
    const members = [];
    for (let n = h.nextElementSibling; n && !n.matches('.section-head, .m-head, .dash-foot'); n = n.nextElementSibling) members.push(n);
    const main = members.filter((x) => x.id).pop();
    if (!main) return;
    const w = document.createElement('div');
    w.className = 'dash-sec';
    w.dataset.sec = main.id.replace(/^m-/, '');
    h.before(w); w.append(h, ...members);
  });
  root.dataset.dash = key;
  const foot = document.createElement('div');
  foot.className = 'dash-foot';
  foot.innerHTML = '<button type="button" class="btn ghost" data-dash-edit="' + key + '">Pagina aanpassen</button>';
  root.appendChild(foot);
  dashApply(root, key);
}
function dashApply(root, key) {
  const P = dashPrefs()[key] || {};
  const secs = [...root.querySelectorAll(':scope > .dash-sec')];
  const order = P.order || [];
  secs.slice().sort((a, b) => { const ia = order.indexOf(a.dataset.sec), ib = order.indexOf(b.dataset.sec); return (ia < 0 ? 999 + secs.indexOf(a) : ia) - (ib < 0 ? 999 + secs.indexOf(b) : ib); })
    .forEach((s) => { const foot = root.querySelector(':scope > .dash-foot'); if (foot) root.insertBefore(s, foot); else root.appendChild(s); });
  const sizes = P.sizes || {};
  secs.forEach((el) => {
    const sec = /** @type {HTMLElement} */ (el);
    sec.hidden = (P.hidden || []).includes(sec.dataset.sec);
    const z = sizes[sec.dataset.sec];
    if (z === 's' || z === 'l') sec.dataset.size = z; else delete sec.dataset.size;
  });
}
const DASH_SIZES = [['s', 'Klein'], ['m', 'Normaal'], ['l', 'Groot']];
// Slepen om een sectie te verplaatsen (werkt met de muis en met een vinger)
function dashDrag(list, save) {
  let li = null, y0 = 0;
  const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  const stop = () => { if (!li) return; li.classList.remove('dragging'); li.style.transform = ''; li = null; save(); };
  list.addEventListener('pointerdown', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const g = t.closest ? t.closest('[data-grip]') : null;
    if (!g) return;
    li = g.closest('li');
    if (!li) return;
    y0 = e.clientY;
    li.classList.add('dragging');
    try { /** @type {HTMLElement} */ (g).setPointerCapture(e.pointerId); } catch (err) { /* niet erg */ }
    e.preventDefault();
  });
  list.addEventListener('pointermove', (e) => {
    if (!li) return;
    const prev = li.previousElementSibling, next = li.nextElementSibling;
    if (prev && e.clientY < mid(prev)) { prev.before(li); y0 = e.clientY; li.style.transform = ''; return; }
    if (next && e.clientY > mid(next)) { next.after(li); y0 = e.clientY; li.style.transform = ''; return; }
    li.style.transform = 'translateY(' + (e.clientY - y0) + 'px)';
  });
  list.addEventListener('pointerup', stop);
  list.addEventListener('pointercancel', stop);
}
const dashTitle = (s) => { const h = s.querySelector('h2'); return h ? h.textContent.trim() : s.dataset.sec; };
function dashEditor(key) {
  const root = document.querySelector('[data-dash="' + key + '"]') || (key === 'analyse' ? (mode === 'm' ? $('m-analyse-body') : $('analyse-body')) : null);
  if (!root) return;
  const secs = [...root.querySelectorAll(':scope > .dash-sec')];
  const dlg = document.createElement('div');
  dlg.className = 'overlay-dlg';
  const P0 = dashPrefs()[key] || {};
  const sizeOf = (k) => ((P0.sizes || {})[k] || 'm');
  dlg.innerHTML = '<div class="dlg-card" role="dialog" aria-modal="true" aria-label="Pagina aanpassen"><h3>Pagina aanpassen</h3><p class="small muted">Sleep met ⠿ om de volgorde te wijzigen (of gebruik de pijlen), vink uit om te verbergen en kies hoe groot de tegels zijn. Alleen op dit apparaat.</p><ol class="dash-list">' +
    secs.map((s) => '<li data-k="' + esc(s.dataset.sec) + '"><button type="button" class="dash-grip" data-grip aria-label="Verplaatsen" title="Slepen om te verplaatsen">⠿</button>' +
      '<label class="check"><input type="checkbox"' + (s.hidden ? '' : ' checked') + '> ' + esc(dashTitle(s)) + '</label>' +
      '<select class="dash-size" data-size aria-label="Grootte van de tegels in ' + esc(dashTitle(s)) + '">' +
      DASH_SIZES.map(([v, l]) => '<option value="' + v + '"' + (sizeOf(s.dataset.sec) === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>' +
      '<span><button type="button" class="icon-sm" data-mv="top" aria-label="Bovenaan vastzetten">⤒</button><button type="button" class="icon-sm" data-mv="up" aria-label="Omhoog">↑</button><button type="button" class="icon-sm" data-mv="down" aria-label="Omlaag">↓</button></span></li>').join('') +
    '</ol><div class="dlg-actions"><button type="button" class="btn ghost" data-dash-reset>Standaard</button><button type="button" class="btn primary" data-dash-done>Klaar</button></div></div>';
  document.body.appendChild(dlg);
  const list = dlg.querySelector('.dash-list');
  const save = () => {
    const all = dashPrefs();
    const sizes = {};
    const rows = /** @type {HTMLElement[]} */ ([...list.children]);
    rows.forEach((li) => { const sel = /** @type {HTMLSelectElement|null} */ (li.querySelector('[data-size]')); if (sel && sel.value !== 'm') sizes[li.dataset.k] = sel.value; });
    all[key] = { order: rows.map((li) => li.dataset.k), hidden: rows.filter((li) => !(/** @type {HTMLInputElement} */ (li.querySelector('input[type="checkbox"]'))).checked).map((li) => li.dataset.k), sizes };
    dashSave(all); dashApply(root, key);
  };
  dashDrag(list, save);
  dlg.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-mv]');
    if (mv) { const li = mv.closest('li'); if (mv.dataset.mv === 'top') list.prepend(li); else if (mv.dataset.mv === 'up' && li.previousElementSibling) li.previousElementSibling.before(li); else if (mv.dataset.mv === 'down' && li.nextElementSibling) li.nextElementSibling.after(li); save(); return; }
    if (e.target.closest('[data-dash-reset]')) { const all = dashPrefs(); delete all[key]; dashSave(all); dlg.remove(); location.reload(); return; }
    if (e.target.closest('[data-dash-done]') || e.target === dlg) { save(); dlg.remove(); }
  });
  dlg.addEventListener('change', save);
  dlg.querySelector('[data-dash-done]').focus();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-dash-edit]');
  if (b) dashEditor(b.dataset.dashEdit);
});
dashWrap(document.querySelector('#page-home .wrap'), 'home');
dashWrap(document.querySelector('#m-home .m-body'), 'm-home');
dashWrap(document.querySelector('#m-stats .m-body'), 'm-stats');

// ---------- Snel zoeken (Ctrl+K) en sneltoetsen ----------
// Sneltoetsen (idee 38): één lijst met een standaardtoets per actie. Een eigen keuze geldt per apparaat
// (localStorage tracker.keys). 'g o' betekent: eerst g, dan o. Ctrl+K blijft vast.
const LS_KEYS = 'tracker.keys';
const goPage = (pg) => () => { location.hash = '#' + pageHash(pg); };
const KEY_ACTIONS = [
  { id: 'zoek', label: 'snel zoeken', def: '/', run: () => openCmd() },
  { id: 'hulp', label: 'deze lijst', def: '?', run: () => showKeys() },
  { id: 'verberg', label: 'bedragen verbergen of tonen', def: 'h', run: () => { const b = $$('.btn-hide')[0]; if (b) b.click(); } },
  { id: 'overzicht', label: 'Overzicht', def: 'g o', run: goPage('home') },
  { id: 'bedrijven', label: 'Bedrijven', def: 'g b', run: goPage('list') },
  { id: 'nieuws', label: 'Nieuws', def: 'g n', run: goPage('news') },
  { id: 'analyse', label: 'Analyse', def: 'g a', run: goPage('stats') },
  { id: 'plannen', label: 'Plannen', def: 'g p', run: goPage('plan') },
  { id: 'status', label: 'Status', def: 'g s', run: () => { location.hash = '#status'; } },
  { id: 'instellingen', label: 'Instellingen', def: 'g i', run: () => openSettings(false) },
  { id: 'vernieuw', label: 'gegevens vernieuwen', def: '', run: () => load() },
  { id: 'thema', label: 'licht of donker thema', def: '', run: () => { const dk = document.documentElement.dataset.theme === 'dark'; try { localStorage.setItem('tracker.theme', dk ? 'light' : 'dark'); } catch (e) { /* niet erg */ } applyTheme(); if (typeof themeChanged === 'function') themeChanged(); } },
  { id: 'aantekening', label: 'aantekening toevoegen', def: '', run: () => { if (typeof openNoteDlg === 'function') openNoteDlg(noteIso(M && M.lastT ? M.lastT : Date.now())); } },
];
// Toetsen die een eigen toets niet mag zijn: de browser of de site heeft ze nodig
const KEY_NEVER = new Set(['g', 'tab', 'enter', 'escape', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'backspace', 'delete', 'home', 'end', 'pageup', 'pagedown', 'f5', 'f11', 'f12', 'contextmenu']);
const keyNorm = (k) => { const s = String(k || ''); return s.length === 1 ? s.toLowerCase() : s.toLowerCase().replace(/^spacebar$/, ' '); };
function keyOwn() { try { const o = JSON.parse(localStorage.getItem(LS_KEYS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
function keyOf(id) { const own = keyOwn(); const a = KEY_ACTIONS.find((x) => x.id === id); return Object.prototype.hasOwnProperty.call(own, id) ? String(own[id] || '') : a ? a.def : ''; }
const keyLabel = (k) => (k ? k.replace(/^g (.)$/, 'g dan $1') : '–');
// Mag deze toets voor deze actie? Geeft een uitleg terug als het niet mag, anders ''
function keyRefuse(id, ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return 'Combinaties met Ctrl, Alt of Cmd gebruikt de browser zelf (zoals Ctrl+W of Ctrl+T). Kies één toets.';
  const k = keyNorm(ev.key);
  if (!k || ev.key === 'Shift' || ev.key === 'Control' || ev.key === 'Alt' || ev.key === 'Meta' || ev.key === 'CapsLock') return 'Kies een letter, cijfer of teken.';
  if (KEY_NEVER.has(k) || /^f\d+$/.test(k)) return (k === 'g' ? 'De g start de tweestapstoetsen (g dan o).' : 'Deze toets heeft de browser of de site nodig.') + ' Kies een andere.';
  if (k.length !== 1) return 'Kies een letter, cijfer of teken.';
  const other = KEY_ACTIONS.find((x) => x.id !== id && keyOf(x.id) === k);
  if (other) return 'Deze toets hoort al bij ' + other.label + '. Kies een andere, of geef eerst die actie een andere toets.';
  return '';
}
function keySet(id, key) {
  const own = keyOwn();
  const a = KEY_ACTIONS.find((x) => x.id === id);
  if (a && key === a.def) delete own[id]; else own[id] = key;
  try { if (Object.keys(own).length) localStorage.setItem(LS_KEYS, JSON.stringify(own)); else localStorage.removeItem(LS_KEYS); } catch (e) { /* niet erg */ }
}
// Bij Instellingen > Weergave: per actie de toets, klik om een andere te kiezen
let keyCapture = null;
function renderKeyPrefs() {
  const box = $('key-prefs');
  if (!box) return;
  const own = keyOwn();
  box.innerHTML = String(tpl`<ul class="key-list">${KEY_ACTIONS.map((a) => tpl`<li><span class="key-l">${a.label.charAt(0).toUpperCase() + a.label.slice(1)}</span>
      <button type="button" class="btn ghost key-b" data-key-pick="${a.id}" aria-label="${'Toets voor ' + a.label + ': ' + keyLabel(keyOf(a.id)) + '. Klik om te wijzigen'}">${keyCapture === a.id ? T('Druk op een toets…') : raw('<kbd>' + esc(keyLabel(keyOf(a.id))) + '</kbd>')}</button>
      ${keyOf(a.id) ? tpl`<button type="button" class="linklike small" data-key-clear="${a.id}">${T('Geen toets')}</button>` : ''}</li>`)}</ul>
    <p class="small key-st" role="status" aria-live="polite"></p>
    ${Object.keys(own).length ? tpl`<button type="button" class="btn ghost" data-key-reset>${T('Standaardtoetsen')}</button>` : ''}`);
}
const keySay = (t, cls) => { const st = document.querySelector('#key-prefs .key-st'); if (st) { st.textContent = t; st.className = 'small key-st ' + (cls || ''); } };
document.addEventListener('click', (e) => {
  const b = near(e, '[data-key-pick]');
  if (b) { keyCapture = keyCapture === b.dataset.keyPick ? null : b.dataset.keyPick; renderKeyPrefs(); const nb = /** @type {HTMLElement|null} */ (document.querySelector('[data-key-pick="' + b.dataset.keyPick + '"]')); if (nb) nb.focus(); if (keyCapture) keySay('Druk op de toets die je wilt gebruiken. Escape om te stoppen.'); return; }
  const c = near(e, '[data-key-clear]');
  if (c) { keySet(c.dataset.keyClear, ''); keyCapture = null; renderKeyPrefs(); keySay('Toets weggehaald.', 'gain'); return; }
  if (near(e, '[data-key-reset]')) { try { localStorage.removeItem(LS_KEYS); } catch (err) { /* niet erg */ } keyCapture = null; renderKeyPrefs(); keySay('De standaardtoetsen staan weer.', 'gain'); }
});
document.addEventListener('keydown', (e) => {
  if (!keyCapture) return;
  e.preventDefault();
  e.stopPropagation();
  const id = keyCapture;
  if (e.key === 'Escape') { keyCapture = null; renderKeyPrefs(); keySay('Niets gewijzigd.'); }
  else {
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;   // wacht op de echte toets
    const why = keyRefuse(id, e);
    if (why) { keySay(why, 'loss'); return; }
    keySet(id, keyNorm(e.key));
    keyCapture = null;
    renderKeyPrefs();
    keySay('Bewaard: ' + keyNorm(e.key) + '.', 'gain');
  }
  const nb = /** @type {HTMLElement|null} */ (document.querySelector('[data-key-pick="' + id + '"]'));
  if (nb) nb.focus();
}, true);
function cmdItems() {
  const go = (h) => () => { location.hash = h; };
  const items = [
    ['Overzicht', 'pagina', go('#overzicht')], ['Bedrijven', 'pagina', go('#bedrijven')], ['Nieuws', 'pagina', go('#nieuws')], ['Analyse', 'pagina', go('#analyse')], ['Plannen', 'pagina', go('#plannen')],
    ['Status van je tracker', 'pagina', go('#status')], ['Instellingen', 'pagina', () => openSettings(false)],
    ['Vandaag in een oogopslag', 'pagina', go('#vandaag')],
    ['Ga naar risico', 'pagina', go('#risico')], ['Ga naar accountwaarde', 'pagina', go('#accountwaarde')], ['Ga naar resultaat', 'pagina', go('#resultaat')],
    ['Ga naar stortingen', 'pagina', go('#stortingen')], ['Twee aandelen vergelijken', 'pagina', go('#vergelijken')],
    ['Order plaatsen', 'actie', () => openOrderPicker()],
    ['Donker of licht thema wisselen', 'actie', () => { const d = document.documentElement.dataset.theme === 'dark'; try { localStorage.setItem('tracker.theme', d ? 'light' : 'dark'); } catch (e) { /* niet erg */ } applyTheme(); rerenderAll(); }],
    ['Toon bedragen (of verberg ze)', 'actie', () => { const b = $$('.btn-hide')[0]; if (b) b.click(); }],
    ['Gegevens vernieuwen', 'actie', () => load()], ['Rondleiding starten', 'actie', () => startTour()], ['Sneltoetsen tonen', 'actie', () => showKeys()],
    ['Pagina aanpassen (overzicht)', 'actie', () => { location.hash = '#overzicht'; setTimeout(() => dashEditor(mode === 'm' ? 'm-home' : 'home'), 300); }],
    ['Pagina aanpassen (analyse)', 'actie', () => { location.hash = '#analyse'; setTimeout(() => dashEditor('analyse'), 500); }],
    ['Reservekopie downloaden', 'actie', () => { openSettings(false); setGo('backup'); }],
  ];
  // Onderdelen van de instellingen
  [['Koppelingen en sleutels', 'links'], ['Toegang en Worker', 'account'], ['Vergrendelen met vingerafdruk of gezicht', 'account'], ['Weergave, taal en animaties', 'view'],
    ['Trilling op de telefoon', 'view'], ['Meldingen (push)', 'push'], ['Delen (alleen lezen)', 'share'], ['Als app installeren', 'install'], ['Status en reservekopie', 'backup'],
    ['Updates', 'update'], ['Geschiedenis uit Google Sheet', 'import']]
    .forEach(([t, k]) => items.push([t, 'instelling', () => { openSettings(false); setGo(k); }]));
  // Weergave-opties aan- of uitzetten
  DISP.forEach(([k, l]) => items.push([l + ' aan of uit', 'weergave', () => { try { localStorage.setItem('tracker.' + k, dispOn(k) ? '0' : '1'); } catch (e) { /* niet erg */ } applyDisplay(); rerenderAll(); }]));
  items.push(['Animaties aan of uit', 'weergave', () => { try { localStorage.setItem('tracker.motion', reduceMotion() ? 'on' : 'off'); } catch (e) { /* niet erg */ } applyMotion(); if (typeof syncMotionButtons === 'function') syncMotionButtons(); }]);
  items.push(['Trilling aan of uit', 'weergave', () => { try { localStorage.setItem(LS_HAPTIC, hapticOn() ? '0' : '1'); } catch (e) { /* niet erg */ } haptic('aan'); }]);
  [['Echt rendement', 'analyse'], ['Jij tegenover je maatstaf', 'analyse'], ['Grootste daling', 'analyse'], ['Screener', 'analyse'], ['ETF-zoeker', 'analyse'], ['Wat grote beleggers bezitten', 'analyse'], ['Economische agenda', 'analyse'], ['Alle transacties', 'analyse'],
    ['Kans om je doelen te halen', 'plannen'], ['Financieel onafhankelijk (FIRE)', 'plannen'], ['Box 3: nu tegenover werkelijk rendement', 'plannen'], ['Herbalanceren met verkopen', 'plannen'], ['Doelen', 'plannen'], ['Kostenoverzicht', 'plannen'], ['Exporteren', 'plannen']]
    .forEach(([t, pg]) => items.push([t, 'tegel op ' + (pg === 'analyse' ? 'Analyse' : 'Plannen'), () => { location.hash = '#' + pg; setTimeout(() => { const h = [...document.querySelectorAll('.page:not([hidden]) h3, .m-view:not([hidden]) h3')].find((x) => x.textContent.trim().startsWith(t)); if (h) h.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' }); }, 450); }]));
  if (M) {
    M.companies.forEach((c) => items.push([c.tk + ' – ' + c.name, 'positie', go('#bedrijf/' + encodeURIComponent(c.tk))]));
    watchSyms().forEach((s) => items.push([s + ' – ' + ((M.mk.ok && M.mk.prof(s) && M.mk.prof(s).name) || 'volglijst'), 'volglijst', go('#volg/' + encodeURIComponent(s))]));
  }
  return items;
}
let cmdEl = null;
function openCmd() {
  if (cmdEl) return;
  const all = cmdItems();
  cmdEl = document.createElement('div');
  cmdEl.className = 'overlay-dlg cmdk';
  cmdEl.innerHTML = '<div class="dlg-card" role="dialog" aria-modal="true" aria-label="Snel zoeken"><input class="search" type="search" placeholder="Zoek een pagina, aandeel of actie" aria-label="Snel zoeken" autocomplete="off"><ul class="cmd-list" role="listbox"></ul><p class="small muted">↑ ↓ kiezen · Enter openen · Esc sluiten</p></div>';
  document.body.appendChild(cmdEl);
  const inp = cmdEl.querySelector('input'), ul = cmdEl.querySelector('ul');
  let shown = [], sel = 0;
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    const hits = all.filter((x) => !q || q.split(/\s+/).every((w) => (x[0] + ' ' + x[1]).toLowerCase().includes(w)));
    // Wat met de getypte tekst begint, staat bovenaan
    if (q) hits.sort((a, b) => Number(String(b[0]).toLowerCase().startsWith(q)) - Number(String(a[0]).toLowerCase().startsWith(q)));
    shown = hits.slice(0, 12);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    ul.innerHTML = shown.map((x, i) => '<li role="option" data-i="' + i + '" aria-selected="' + (i === sel) + '"><span>' + esc(x[0]) + '</span><span class="muted small">' + esc(x[1]) + '</span></li>').join('') || '<li class="muted">Niets gevonden</li>';
  };
  const run = (i) => { const x = shown[i]; closeCmd(); if (x) x[2](); };
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { run(sel); e.preventDefault(); }
    else if (e.key === 'Escape') closeCmd();
  });
  ul.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) run(Number(li.dataset.i)); });
  cmdEl.addEventListener('click', (e) => { if (e.target === cmdEl) closeCmd(); });
  draw();
  inp.focus();
}
function closeCmd() { if (cmdEl) { cmdEl.remove(); cmdEl = null; } }
function showKeys() {
  const d = document.createElement('div');
  d.className = 'overlay-dlg';
  const rows = [['Ctrl+K', 'snel zoeken']].concat(KEY_ACTIONS.filter((a) => keyOf(a.id)).map((a) => [keyLabel(keyOf(a.id)), a.label]), [['Esc', 'sluiten of terug']]);
  d.innerHTML = '<div class="dlg-card" role="dialog" aria-modal="true" aria-label="Sneltoetsen"><h3>Sneltoetsen</h3><dl class="kv">' +
    rows.map(([k, v]) => '<div><dt><kbd>' + esc(k) + '</kbd></dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>' +
    '<p class="muted small">Eigen toetsen kies je bij Instellingen, Weergave.</p><div class="dlg-actions"><button type="button" class="btn primary">Sluiten</button></div></div>';
  document.body.appendChild(d);
  const close = () => d.remove();
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('button')) close(); });
  d.querySelector('button').focus();
}
let gWait = 0;
document.addEventListener('keydown', (e) => {
  if (keyCapture) return;   // bij Weergave wordt net een toets gekozen
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (cmdEl) closeCmd(); else openCmd(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = keyNorm(e.key);
  if (!k) return;
  // Tweede toets na g (g dan o …)
  if (gWait && Date.now() - gWait < 1200) {
    gWait = 0;
    const a = KEY_ACTIONS.find((x) => keyOf(x.id) === 'g ' + k);
    if (a) { e.preventDefault(); a.run(); }
    return;
  }
  const a = KEY_ACTIONS.find((x) => keyOf(x.id) === k);
  if (a) { e.preventDefault(); a.run(); return; }
  if (k === 'g' && KEY_ACTIONS.some((x) => (keyOf(x.id) || '').startsWith('g '))) gWait = Date.now();
});

// ---------- Telefoon: omlaag trekken om te vernieuwen, vegen tussen pagina's ----------
// Trekken werkt alleen bovenaan de pagina; vegen alleen als de beweging duidelijk horizontaal is en er
// niets anders onder je vinger zit dat zelf zijwaarts beweegt (grafiek met zoom, tabel, keuzebalk).
const SWIPE_ORDER = ['home', 'list', 'news', 'stats', 'plan'];
const NO_SWIPE = '.chart, .tbl-wrap, input, textarea, select, .m-chips, .seg, .m-seg, .vlist, .yheat-wrap, .mk-grid, [data-noswipe], .detail, .m-ptabs, .pick-list, .overlay-dlg';
const PULL_ON = 72;      // zover omlaag trekken om te vernieuwen
const SWIPE_MIN = 70;    // minimale veeg om van pagina te wisselen
// Zit er iets onder je vinger dat zelf zijwaarts schuift?
function scrollsSideways(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 4) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return true; }
  }
  return false;
}
(function gestures() {
  const main = $('m-main');
  if (!main) return;
  let x0 = 0, y0 = 0, t0 = 0, pull = false, swipe = false, dy = 0, busy = false;
  const ptr = document.createElement('div');
  ptr.className = 'ptr'; ptr.setAttribute('aria-hidden', 'true'); ptr.innerHTML = '<span>↓</span>';
  const ptrTxt = document.createElement('div');
  ptrTxt.className = 'ptr-txt'; ptrTxt.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ptr);
  document.body.appendChild(ptrTxt);
  const setPtr = (d) => {
    ptr.style.transform = 'translate(-50%,' + Math.min(96, d) * 0.8 + 'px)';
    ptr.style.opacity = String(Math.min(1, d / PULL_ON));
    ptr.classList.toggle('ready', d > PULL_ON);
    ptrTxt.style.transform = 'translate(-50%,' + Math.min(96, d) * 0.8 + 'px)';
    ptrTxt.style.opacity = String(Math.min(1, Math.max(0, (d - 20) / PULL_ON)));
    ptrTxt.textContent = busy ? 'Bezig met vernieuwen…' : d > PULL_ON ? 'Laat los om te vernieuwen' : 'Trek omlaag om te vernieuwen';
  };
  const done = () => { busy = false; ptr.classList.remove('spin'); setPtr(0); };
  main.addEventListener('touchstart', (e) => {
    if (mode !== 'm' || ui.detail || e.touches.length !== 1 || busy) { pull = swipe = false; return; }
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); dy = 0;
    pull = window.scrollY <= 0;
    const el = /** @type {HTMLElement} */ (e.target);
    swipe = !(el.closest && el.closest(NO_SWIPE)) && !scrollsSideways(el);
  }, { passive: true });
  main.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) { pull = swipe = false; setPtr(0); return; }
    const t = e.touches[0];
    const dx = t.clientX - x0;
    dy = t.clientY - y0;
    // Duidelijk horizontaal: niet meer trekken; duidelijk verticaal: niet meer vegen
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) { if (pull) { pull = false; setPtr(0); } }
    else if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) swipe = false;
    if (pull && dy > 0) setPtr(dy); else if (pull) setPtr(0);
  }, { passive: true });
  main.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dyy = t.clientY - y0;
    if (pull && dy > PULL_ON && Math.abs(dx) < dy) {
      busy = true; ptr.classList.add('spin'); setPtr(PULL_ON);
      haptic('tik');
      Promise.resolve(load()).finally(done);
    } else setPtr(0);
    if (swipe && Date.now() - t0 < 700 && Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > 1.8 * Math.abs(dyy)) {
      const i = SWIPE_ORDER.indexOf(ui.page);
      const next = SWIPE_ORDER[i + (dx < 0 ? 1 : -1)];
      // Via de adresbalk, zodat de paginawissel dezelfde richting en animatie krijgt als een tik op de balk
      if (i >= 0 && next) { haptic('tik'); location.hash = '#' + pageHash(next); }
    }
    pull = swipe = false;
  }, { passive: true });
})();

// ---------- Teller op het app-icoon en in het menu: nieuw nieuws over je aandelen en afgegane koersalarmen ----------
// Eén teller voor alles (pictogram en de stip bij Nieuws); het rekenwerk staat in js/21-pwa.js
const LS_SEEN = 'tracker.newsSeen';
function updateBadge() {
  if (!M) return;
  syncUnread();
}

// ---------- Weergave: compact, grotere tekst, kleurenblindvriendelijk ----------
const DISP = [['compact', 'Compact'], ['big', 'Grotere tekst'], ['cb', 'Kleurenblindvriendelijk (blauw en oranje)']];
function dispOn(k) { try { return localStorage.getItem('tracker.' + k) === '1'; } catch (e) { return false; } }
function applyDisplay() { DISP.forEach(([k]) => { if (dispOn(k)) document.documentElement.dataset[k] = '1'; else delete document.documentElement.dataset[k]; }); applyTheme(); }
(function displayOptions() {
  const box = document.querySelector('[data-theme-pick]') && document.querySelector('[data-theme-pick]').closest('.install-box');
  if (!box || box.querySelector('.disp-opts')) return;
  const div = document.createElement('div');
  div.className = 'disp-opts';
  div.innerHTML = '<h3 style="margin-top:14px">Leesbaarheid</h3>' + DISP.map(([k, l]) => '<label class="check"><input type="checkbox" data-disp="' + k + '"' + (dispOn(k) ? ' checked' : '') + '> ' + esc(l) + '</label>').join('') +
    numFmtOptions() +
    '<h3 style="margin-top:14px">Hulp</h3><div class="exp"><button type="button" class="btn ghost" data-tour-start>Rondleiding opnieuw</button><button type="button" class="btn ghost" data-keys>Sneltoetsen</button>' +
      '<button type="button" class="btn ghost" data-onb-on>Startchecklist terugzetten</button></div>';
  const lang = box.querySelector('[data-lang-pick]');
  const h = lang ? lang.closest('.seg').previousElementSibling : null;
  if (h) h.before(div); else box.appendChild(div);
})();
document.addEventListener('change', (e) => {
  const el = e.target.closest && e.target.closest('[data-disp]');
  if (!el) return;
  try { localStorage.setItem('tracker.' + el.dataset.disp, el.checked ? '1' : '0'); } catch (err) { /* niet erg */ }
  applyDisplay(); rerenderAll();
});
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('[data-tour-start]')) { closeSettingsIfOpen(); startTour(); }
  if (e.target.closest && e.target.closest('[data-keys]')) showKeys();
});
function closeSettingsIfOpen() { const d = document.querySelector('dialog[open]'); if (d && d.close) d.close(); }
applyDisplay();

// ---------- Rondleiding voor nieuwe gebruikers ----------
const LS_TOUR = 'tracker.tour';
function tourSteps() {
  return mode === 'm' ? [
    ['#m-hero-chart', 'Het verloop van je beleggingen. Leg je vinger op de lijn voor de waarde op dat moment; knijp om in te zoomen.'],
    ['#m-kpis', 'Je kerncijfers. Tik op een tegel voor meer uitleg.'],
    ['.m-tabs', 'Hier wissel je tussen de pagina’s. Je kunt ook naar links of rechts vegen; trek bovenaan omlaag om te vernieuwen.'],
    ['.m-icon.btn-hide', 'Bedragen verbergen, bijvoorbeeld in de trein. Procenten blijven zichtbaar.'],
    [null, 'Op Analyse vind je je echte rendement, risico en marktgegevens; op Plannen je doelen. Tik op een onderstreept begrip voor uitleg. Veel plezier!'],
  ] : [
    ['.pillnav', 'Hier wissel je tussen de pagina’s: overzicht, bedrijven, nieuws, analyse en plannen.'],
    ['#hero-chart', 'Het verloop van je beleggingen. Wijs de lijn aan voor waarden; knijp op je touchpad of gebruik Ctrl en scrollen om in te zoomen, dubbelklik om terug te gaan.'],
    ['#kpis', 'Je kerncijfers. Klik op een tegel om in te zoomen.'],
    ['.icon-btn.btn-hide', 'Bedragen verbergen. Procenten blijven zichtbaar.'],
    ['.icon-btn.btn-settings', 'Instellingen: koppelingen, weergave, taal, meldingen en deze rondleiding.'],
    [null, 'Druk op Ctrl+K of / om snel iets te zoeken en op ? voor alle sneltoetsen. Klik op een onderstreept begrip voor uitleg. Veel plezier!'],
  ];
}
function maybeTour() {
  if (sharedView) return;
  let done = true;
  try { done = !!localStorage.getItem(LS_TOUR); } catch (e) { done = true; }
  // Alleen vanaf het overzicht; wie via een link op een andere pagina binnenkomt, krijgt de rondleiding later
  if (!done && ui.page === 'home' && !ui.detail) setTimeout(() => { if (ui.page === 'home' && !ui.detail && !document.querySelector('.tour')) startTour(); }, 900);
}
function startTour() {
  try { localStorage.setItem(LS_TOUR, '1'); } catch (e) { /* niet erg */ }
  if (ui.page !== 'home') location.hash = '#overzicht';
  const steps = tourSteps().filter(([sel]) => !sel || (document.querySelector(sel) && document.querySelector(sel).getBoundingClientRect().width));
  let i = 0;
  const el = document.createElement('div');
  el.className = 'tour';
  el.innerHTML = '<div class="tour-ring"></div><div class="tour-card" role="dialog" aria-modal="true" aria-label="Rondleiding"><p></p><div class="dlg-actions"><span class="small muted"></span><button type="button" class="btn ghost" data-t="skip">Overslaan</button><button type="button" class="btn primary" data-t="next">Volgende</button></div></div>';
  document.body.appendChild(el);
  const ring = el.querySelector('.tour-ring'), card = el.querySelector('.tour-card');
  const show = () => {
    const [sel, txt] = steps[i];
    card.querySelector('p').textContent = txt;
    card.querySelector('.small').textContent = (i + 1) + ' van ' + steps.length;
    card.querySelector('[data-t="next"]').textContent = i === steps.length - 1 ? 'Klaar' : 'Volgende';
    const t = sel && document.querySelector(sel);
    if (t) {
      t.scrollIntoView({ block: 'center', behavior: 'auto' });
      const r = t.getBoundingClientRect();
      ring.hidden = false;
      Object.assign(ring.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' });
      const below = r.bottom + 180 < innerHeight;
      card.style.top = (below ? r.bottom + 14 : Math.max(12, r.top - card.offsetHeight - 14)) + 'px';
      card.style.left = Math.max(12, Math.min(innerWidth - card.offsetWidth - 12, r.left)) + 'px';
    } else {
      ring.hidden = true;
      card.style.top = Math.max(12, innerHeight / 2 - 80) + 'px';
      card.style.left = Math.max(12, innerWidth / 2 - card.offsetWidth / 2) + 'px';
    }
    card.querySelector('[data-t="next"]').focus();
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    if (b.dataset.t === 'skip' || i >= steps.length - 1) { el.remove(); return; }
    i++; show();
  });
  document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape' && el.isConnected) { el.remove(); document.removeEventListener('keydown', esc2); } });
  setTimeout(show, ui.page === 'home' ? 0 : 500);
}

// ---------- Exporteren: Excel-werkmap (.xlsx) en JSON ----------
// Een .xlsx is een zip met XML-bestanden; hier zonder compressie, met de CRC32-controle die zip vraagt
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  files.forEach(([name, text]) => {
    const nb = enc.encode(name), db = enc.encode(text), crc = crc32(db);
    const head = [0x50, 0x4B, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0)];
    parts.push(new Uint8Array(head), nb, db);
    central.push(new Uint8Array([0x50, 0x4B, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off += head.length + nb.length + db.length;
  });
  const cSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array([0x50, 0x4B, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cSize), ...u32(off), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xmlEsc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function colName(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function sheetXml(rows) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (isNum(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
      if (v == null || v === '') return '';
      return '<c r="' + ref + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t>' + xmlEsc(v) + '</t></is></c>';
    }).join('') + '</row>').join('') + '</sheetData></worksheet>';
}
function xlsxBlob(sheets) {
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s, i) => '<sheet name="' + xmlEsc(s[0]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>'],
  ].concat(sheets.map((s, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s[1])]));
  return zipStore(files);
}
function exportSheets() {
  const d = (t) => new Date(t).toISOString().slice(0, 10);
  return [
    ['Posities', [['Ticker', 'Naam', 'Aantal', 'Waarde (EUR)', 'Kostprijs (EUR)', 'Ongerealiseerd (EUR)', 'Deel']].concat(M.companies.map((c) => [c.tk, c.name, c.qty, c.value, c.cost, c.unreal, c.weight]))],
    ['Weken', [['Datum', 'Accountwaarde', 'Netto gestort', 'Vrij saldo', 'Gestort deze week', 'Weekresultaat']].concat(M.weeks.map((w) => [d(w.t), w.accountValue, w.netDeposits, w.cash, w.newDeposits, w.weekResult]))],
    ['Transacties', [['Datum', 'Ticker', 'Naam', 'Soort', 'Aantal', 'Koers', 'Munt', 'Bedrag (EUR)', 'Gerealiseerd (EUR)', 'Wisselkosten', 'Overige kosten']].concat(M.tx.list.map((x) => [d(x.t), x.tk, x.name, x.side, x.qty, x.price, x.cur, x.net, x.realised, x.feeFx, x.feeOther]))],
    ['Dividend', [['Datum', 'Ticker', 'Bedrag (EUR)', 'Per aandeel', 'Aantal']].concat(M.ev.received.map((x) => [d(x.t), x.ticker, x.amount, x.perShare, x.qty]))],
    ['Rente', [['Datum', 'Bedrag (EUR)']].concat(((data.ext2 && data.ext2.interest) || []).map((x) => [x.date, x.amount]))],
  ];
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-xlsx], [data-json-export]');
  if (!b || !M) return;
  const day = new Date().toISOString().slice(0, 10);
  let blob, name;
  if (b.dataset.xlsx !== undefined) { blob = xlsxBlob(exportSheets()); name = 'investeringstracker-' + day + '.xlsx'; }
  else {
    const out = { exported: new Date().toISOString(), positions: M.companies.map((c) => ({ ticker: c.tk, name: c.name, qty: c.qty, value: c.value, cost: c.cost })), weeks: data.weeks, orders: data.orders, dividends: M.ev.received.map((x) => ({ date: x.date, ticker: x.ticker, amount: x.amount })), interest: (data.ext2 && data.ext2.interest) || [] };
    blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }); name = 'investeringstracker-' + day + '.json';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

// ---------- Telefoon: schuifbare keuzebalken ----------
// Een balk die niet past, krijgt een vervaagde rand (zodat je ziet dat er meer is) en schuift de gekozen knop in beeld.
function segFit(root) {
  if (mode !== 'm') return;
  (root || document).querySelectorAll('.seg').forEach((s) => {
    const over = s.scrollWidth > s.clientWidth + 2;
    s.classList.toggle('scrolls', over);
    if (!over) return;
    const on = s.querySelector('[aria-pressed="true"]');
    if (on && !s.dataset.fitted) { s.scrollLeft = Math.max(0, on.offsetLeft - 16); s.dataset.fitted = '1'; }
    s.classList.toggle('at-end', s.scrollLeft + s.clientWidth >= s.scrollWidth - 2);
    if (!s.dataset.segScroll) { s.dataset.segScroll = '1'; s.addEventListener('scroll', () => s.classList.toggle('at-end', s.scrollLeft + s.clientWidth >= s.scrollWidth - 2), { passive: true }); }
  });
}
let segTimer = 0;
new MutationObserver(() => { clearTimeout(segTimer); segTimer = setTimeout(() => segFit(), 120); }).observe(document.body, { childList: true, subtree: true });
onResize(() => segFit(), { key: 'seg' });
window.addEventListener('scroll', () => { clearTimeout(segTimer); segTimer = setTimeout(() => segFit(), 200); }, { passive: true });
