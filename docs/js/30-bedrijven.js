/* Investeringstracker – Bedrijven (ontwerp 2026, variant B-F "combi"): kerncijfers bovenaan, een lijst per sector
 * met grafiekjes en ernaast een detailvak van het gekozen bedrijf. Op de telefoon dezelfde kop en kerncijfers.
 * De bedrijfspagina zelf staat in js/09-weergaven.js, de snelle modus in js/23-live.js.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// Het gekozen bedrijf in het detailvak (alleen deze sessie; standaard het grootste in de lijst)
const bcState = { sel: /** @type {string|null} */ (null) };

// Verschil in procentpunten, als "+0,30 pp"
const bcPp = (v) => (isNum(v) ? spct(v).replace('%', ' pp') : '–');

// "25 posities, 2 op je volglijst. Het grootste deel zit in technologie."
function bcSummary() {
  const cs = M.companies;
  const wn = typeof watchSyms === 'function' ? watchSyms().length : 0;
  const sec = new Map();
  cs.forEach((c) => { const k = listSectorOf(c); sec.set(k, (sec.get(k) || 0) + (c.value || 0)); });
  const top = [...sec.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = top && M.totalValue ? top[1] / M.totalValue : 0;
  const where = top && top[0] !== 'Onbekend' && share >= 0.25
    ? ' ' + (share >= 0.5 ? 'Het grootste deel' : 'Het meeste') + ' zit in ' + (top[0] === 'Fondsen' ? 'fondsen' : top[0].toLowerCase()) + '.' : '';
  return cs.length + (cs.length === 1 ? ' positie' : ' posities') + (wn ? ', ' + wn + ' op je volglijst' : '') + '.' + where;
}

// Vijf kerncijfers in één strook: waarde, vandaag, tegenover de markt, sinds aankoop en de grootste positie
function bcKpis() {
  const cs = M.companies, T0 = M.tot;
  const up = cs.filter((c) => c.change > 0).length, down = cs.filter((c) => c.change < 0).length;
  const mv = moversModel();
  const unreal = cs.filter((c) => isNum(c.unreal));
  const un = unreal.length ? sum(unreal.map((c) => c.unreal)) : null;
  const byV = cs.slice().sort((a, b) => b.value - a.value);
  const big = byV[0];
  const top3 = M.totalValue ? sum(byV.slice(0, 3).map((c) => c.value)) / M.totalValue : null;
  const day = M.dayWord === 'vandaag' ? 'Vandaag' : 'Laatste handelsdag';
  const cell = (k, v, sub, cls) => tpl`<div class="bc-k"><span class="k">${k}</span><b class="v ${cls || ''}">${v}</b><span class="sub">${sub}</span></div>`;
  return String(tpl`<div class="bc-kpis" role="group" aria-label="Kerncijfers van je posities">${[
    cell('Waarde', eur(M.totalValue), cs.length + (cs.length === 1 ? ' positie' : ' posities')),
    cell(day, isNum(T0.change) ? seur(T0.change) : '–', (isNum(T0.changePct) ? spct(T0.changePct) + ', ' : '') + up + ' omhoog en ' + down + ' omlaag', tone(T0.change)),
    mv.bench && isNum(mv.diff)
      ? cell('Tegenover de markt', bcPp(mv.diff), mv.bench.label + ' ' + spct(mv.bench.c.changePct) + ' in euro', tone(mv.diff))
      : cell('Tegenover de markt', '–', 'geen indexfonds gevonden om mee te meten'),
    cell('Sinds aankoop', isNum(un) ? seur(un) : '–', isNum(un) ? 'ongerealiseerd, open posities' : 'geen aankoopgegevens', tone(un)),
    big ? cell('Grootste positie', big.tk + ' ' + (isNum(big.weight) ? P1.format(big.weight) : ''), isNum(top3) && byV.length > 3 ? 'drie grootste samen ' + P1.format(top3) : big.name) : '',
  ]}</div>`);
}

// Kop van Bedrijven: samenvatting, verdeling en kerncijfers (computer en telefoon)
function bcHead() {
  const sub = $(mode === 'm' ? 'm-list-sub' : 'list-sub');
  if (sub) sub.textContent = bcSummary();
  const k = $(mode === 'm' ? 'm-list-kpis' : 'list-kpis');
  if (k) k.innerHTML = bcKpis();
  listWeights(mode === 'm' ? 'm-list-weights' : 'list-weights');
}

// ---------- Computer: lijst per sector met ernaast het detailvak ----------
function bcRow(c, sel) {
  const pts = marketSeries(c.tk, ui.listSpan);
  const sp = spanPct(c, pts);
  return tpl`<button type="button" class="bc-row" data-bc-sel="${c.tk}" aria-pressed="${String(c.tk === sel)}" aria-label="${c.name + ', ' + eur(c.value) + ', ' + (isNum(sp) ? spct(sp) : '–') + '. Tonen in het vak ernaast'}">
    <span class="n"><b>${c.tk}</b><small>${c.name}${isNum(c.weight) ? ' · ' + P1.format(c.weight) : ''}</small></span>
    ${raw(spark(pts, toneColor(sp), 'tspark'))}
    <span class="r"><b class="${tone(sp)}">${isNum(sp) ? spct(sp) : '–'}</b><small>${eur(c.value)}</small></span></button>`;
}
function bcCombiHtml(items) {
  const groups = new Map();
  items.forEach((c) => { const k = listSectorOf(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
  const gs = [...groups.entries()].map(([k, cs]) => ({ k, cs, v: sum(cs.map((c) => c.value)) })).sort((a, b) => b.v - a.v);
  const sel = bcSelected(items);
  return String(tpl`<div class="bc">
    <div class="bc-list">${gs.map((g) => tpl`<div class="bc-g">
      <div class="bc-gh"><b>${g.k}</b><span>${g.cs.length + (g.cs.length === 1 ? ' positie' : ' posities')} · <b>${M.totalValue ? P1.format(g.v / M.totalValue) : '–'}</b></span></div>
      ${g.cs.map((c) => bcRow(c, sel))}</div>`)}</div>
    <aside class="bc-side" id="bc-side" aria-live="polite">${raw(sel ? bcPanel(M.byTk.get(sel)) : '')}</aside>
  </div>`);
}
// Het gekozen bedrijf, als het nog in de (gefilterde) lijst staat; anders het grootste
function bcSelected(items) {
  if (bcState.sel && items.some((c) => c.tk === bcState.sel)) return bcState.sel;
  const big = items.slice().sort((a, b) => b.value - a.value)[0];
  return big ? big.tk : null;
}
// Volgende kwartaalcijfers, anders de vorige
function bcEarn(c) {
  const E = M.ev;
  if (!E || !E.loaded) return null;
  const e = E.earn.find((x) => x.tk === c.tk);
  if (e) return ['Volgende cijfers', fD.format(e.t)];
  const le = E.lastEarn.get(c.tk);
  return le ? ['Laatste cijfers', fD.format(le.t)] : null;
}
// Berichten van één bedrijf (nieuws met toon), hoogstens n
function bcNews(tk, n) {
  const R = (data.research || {})[tk];
  // Hetzelfde bericht van meerdere bronnen maar één keer
  const seen = new Set();
  return ((R && R.news) || []).slice().sort((a, b) => b.t - a.t)
    .filter((x) => { const k = String(x.headline || '').toLowerCase().replace(/\W+/g, ' ').trim(); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n);
}
function bcNewsHtml(tk, n) {
  const list = bcNews(tk, n);
  if (!list.length) return '';
  return String(tpl`<ul class="bc-news">${list.map((x) => {
    const t = typeof newsTone === 'function' ? newsTone(x) : '';
    return tpl`<li><i class="bc-dot ${t}" aria-hidden="true">${t === 'pos' ? '+' : t === 'neg' ? '−' : '·'}</i><a href="${x.url || '#'}" target="_blank" rel="noopener"><b>${x.headline}</b><small>${(x.source || 'bron') + ' · ' + fD.format(x.t)}</small></a></li>`;
  })}</ul>`);
}
// Analisten als één balk: kopen, houden, verkopen
function bcRecHtml(tk) {
  const r = typeof recOf === 'function' ? recOf(tk) : null;
  if (!r) return '';
  const hold = Math.max(0, 1 - r.buy - r.sell);
  return String(tpl`<div class="bc-rec" role="img" aria-label="${P1.format(r.buy) + ' kopen, ' + P1.format(hold) + ' houden, ' + P1.format(r.sell) + ' verkopen'}">
    <i class="b" style="flex:${r.buy.toFixed(3)}"></i><i class="h" style="flex:${hold.toFixed(3)}"></i><i class="s" style="flex:${r.sell.toFixed(3)}"></i></div>
    <p class="sub">${P1.format(r.buy) + ' kopen, ' + P1.format(hold) + ' houden, ' + P1.format(r.sell) + ' verkopen · ' + r.tot + ' analisten'}</p>`);
}
function bcPanel(c) {
  if (!c) return '';
  const pts = marketSeries(c.tk, ui.listSpan);
  const sp = spanPct(c, pts);
  const mv = moversModel();
  const rel = mv.bench && isNum(c.changePct) && isNum(mv.bench.c.changePct) ? c.changePct - mv.bench.c.changePct : null;
  const er = bcEarn(c);
  const news = bcNewsHtml(c.tk, 3), rec = bcRecHtml(c.tk);
  const fund = isFundC(c);
  const cell = (k, v, cls) => tpl`<div><span class="k">${k}</span><b class="${cls || ''}">${v}</b></div>`;
  return String(tpl`<div class="bc-p" data-bc-panel="${c.tk}">
    <p class="bc-meta">${listSectorOf(c)}${isNum(c.weight) ? ' · ' + P1.format(c.weight) + ' van je beleggingen' : ''}</p>
    <div class="bc-ph"><h3><b>${c.tk}</b> <span>${c.name}</span></h3><p><b>${eur(c.value)}</b> <span class="${tone(sp)}">${isNum(sp) ? spct(sp) : ''}</span></p></div>
    <div class="chart bc-chart" id="bc-chart" role="img" aria-label="${'Verloop van ' + c.name + ', ' + posSpanLabel().toLowerCase()}"></div>
    <div class="bc-cells">${[
      cell(M.dayWord === 'vandaag' ? 'Vandaag' : 'Laatste dag', seur(c.change), tone(c.change)),
      mv.bench ? cell('Tegenover markt', bcPp(rel), tone(rel)) : cell('Koers', money(c.priceNative, c.cur)),
      cell('Sinds aankoop', isNum(c.resultPct) ? spct1(c.resultPct) : '–', tone(c.resultPct)),
      er ? cell(er[0], er[1]) : mv.bench ? cell('Koers', money(c.priceNative, c.cur)) : cell('Deel', isNum(c.weight) ? P1.format(c.weight) : '–'),
    ]}</div>
    ${fund ? tpl`<p class="sub">Een fonds: geen eigen nieuws, analisten of kwartaalcijfers.</p>` : ''}
    ${news ? tpl`<h4>Berichten en cijfers</h4>${raw(news)}` : ''}
    ${rec ? tpl`<h4>Analisten</h4>${raw(rec)}` : ''}
    <div class="bc-acts"><button type="button" class="btn dark" data-ticker="${c.tk}">Bedrijfspagina openen</button>
      <button type="button" class="btn ghost" data-alarm="${c.tk}">Koersalarm</button>
      <button type="button" class="btn ghost" data-bc-cmp="${c.tk}">Vergelijken</button></div>
  </div>`);
}
// Grafiek in het detailvak: de koers van het gekozen bedrijf over de gekozen periode
function bcPanelChart() {
  const host = $('bc-chart'), p = host && host.closest('[data-bc-panel]');
  if (!host || !p) return;
  const tk = /** @type {HTMLElement} */ (p).dataset.bcPanel, c = M.byTk.get(tk);
  if (!c) return;
  const pts = marketSeries(tk, ui.listSpan);
  const sp = spanPct(c, pts);
  lineChart(host, [{ pts, color: toneColor(sp), width: 2.2 }], { zoom: false, table: false, empty: 'Nog te weinig metingen voor deze periode.' });
}
function bcPick(tk) {
  bcState.sel = tk;
  $$('.bc-row[data-bc-sel]').forEach((b) => b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.bcSel === tk)));
  const side = $('bc-side');
  if (!side) return;
  side.innerHTML = bcPanel(M.byTk.get(tk));
  bcPanelChart();
  if (!reduceMotion()) { side.classList.remove('bc-in'); void side.offsetWidth; side.classList.add('bc-in'); }
}

document.addEventListener('click', (e) => {
  const s = near(e, '[data-bc-sel]');
  if (s) { bcPick(s.dataset.bcSel); return; }
  const cmp = near(e, '[data-bc-cmp]');
  if (cmp) { xs.cmpA = cmp.dataset.bcCmp; if (xs.cmpB === xs.cmpA) xs.cmpB = null; openDetail(CMP, cmp, true); return; }
  const f = near(e, '[data-bc-follow]');
  if (f) {
    if (mode === 'm') { ui.listPane = 'watch'; renderMList(); }
    const inp = $(mode === 'm' ? 'm-watch-in' : 'watch-in');
    const host = $(mode === 'm' ? 'm-watch-add' : 'watch-add');
    if (host) host.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    if (inp) setTimeout(() => inp.focus({ preventScroll: true }), reduceMotion() ? 0 : 350);
  }
});
// Dubbelklik op een rij opent meteen de bedrijfspagina
document.addEventListener('dblclick', (e) => {
  const s = near(e, '[data-bc-sel]');
  if (s) openDetail(s.dataset.bcSel, s, true);
});
