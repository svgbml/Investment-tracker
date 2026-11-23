/* Investeringstracker – Nieuws en analisten, tweede deel:
 * berichten over hetzelfde onderwerp bundelen, analisten door de tijd per bedrijf, stemming per sector op het
 * overzicht, scorebord van koersdoelen, kwartaalcijfers die eraan komen en "wat heb ik gemist".
 *
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html).
 * De toonschatting staat in js/15-toon.js, de rest van de nieuwspagina in js/12-nieuws.js en js/nieuws-preact.js.
 */
'use strict';

// =====================================================================
// ---------- Berichten over hetzelfde onderwerp bundelen ----------
// Bronnen schrijven over hetzelfde bericht met bijna dezelfde kop. Koppen met genoeg dezelfde woorden,
// over hetzelfde aandeel en binnen anderhalve dag, worden één item met "x bronnen".
const NEWS_STOP = new Set(('de het een en van voor door naar over met te bij uit zijn wordt worden werd was is als dat die deze dit maar ook nog meer minder dan ' +
  'onder boven tegen zonder vanaf sinds tot aan niet geen weer heeft hebben hun haar zich bedrijf aandeel aandelen koers procent miljoen miljard ' +
  'the and for with from after into than that this these those has have had was were will would says said about more less over under against ' +
  'its their his her them they stock stocks shares share company percent million billion').split(' '));

const newsKeyWords = (n) => new Set(toneTokens(n && n.headline).filter((w) => w.length >= 4 && !NEWS_STOP.has(w)));
const wordOverlap = (a, b) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  a.forEach((w) => { if (b.has(w)) n++; });
  return n / Math.min(a.size, b.size);
};
const NEWS_CL_WINDOW = 36 * HOUR;   // koppen verder dan dit uit elkaar horen niet bij hetzelfde bericht
const NEWS_CL_MIN = 0.6;            // deel van de woorden dat gelijk moet zijn

/**
 * Berichten bundelen. Geeft per bundel de nieuwste kop (lead), alle berichten en de bronnen.
 * @param {any[]} items nieuwste eerst
 */
function newsClusters(items) {
  const out = [];
  (items || []).forEach((n) => {
    const w = newsKeyWords(n);
    let best = null, score = 0;
    for (const c of out) {
      if ((c.lead.tk || null) !== (n.tk || null) || Math.abs(c.lead.t - n.t) > NEWS_CL_WINDOW) continue;
      const s = wordOverlap(c.w, w);
      if (s > score) { score = s; best = c; }
    }
    if (best && score >= NEWS_CL_MIN) best.items.push(n);
    else out.push({ lead: n, items: [n], w });
  });
  out.forEach((c) => {
    c.items.sort((a, b) => b.t - a.t);
    c.sources = [...new Set(c.items.map((n) => n.source).filter(Boolean))];
  });
  return out;
}
const clusterLabel = (c) => (c.sources.length > 1 ? c.sources.length + ' bronnen' : c.items.length + ' berichten');
// Bundel als HTML (de componentenversie in js/nieuws-preact.js tekent hetzelfde met Preact)
function newsClusterHtml(c, itemHtml) {
  if (c.items.length < 2) return itemHtml(c.lead);
  return '<div class="news-g">' + itemHtml(c.lead) +
    '<details class="news-src"><summary>' + esc(clusterLabel(c)) + ' over hetzelfde bericht</summary><div class="news-sub">' +
    c.items.slice(1).map((n) => '<a href="' + esc(n.url) + '" target="_blank" rel="noopener"><span class="s">' + esc(n.source || 'bron') + '</span><span class="t">' + esc(n.headline) + '</span></a>').join('') +
    '</div></details></div>';
}

// =====================================================================
// ---------- Analisten door de tijd, per bedrijf ----------
// research[tk].recHist: [dag, sterk kopen, kopen, aanhouden, verkopen, sterk verkopen, koersdoel].
// De Worker schrijft alleen een regel als er iets verandert; de stand op een dag is de laatste regel ervoor.
const REC_PARTS = [['sb', 'Sterk kopen', '#0B7A4B'], ['b', 'Kopen', '#5FB58A'], ['h', 'Aanhouden', '#C9CED6'], ['s', 'Verkopen', '#E3A79C'], ['ss', 'Sterk verkopen', '#B4311F']];
function recHistRows(tk) {
  const r = (data.research || {})[tk];
  const H = (r && Array.isArray(r.recHist) ? r.recHist : []).filter((x) => Array.isArray(x) && x[0]);
  return H.map((x) => {
    const rec = { sb: x[1] || 0, b: x[2] || 0, h: x[3] || 0, s: x[4] || 0, ss: x[5] || 0 };
    const tot = rec.sb + rec.b + rec.h + rec.s + rec.ss;
    return { day: x[0], t: ymd(x[0]), rec, tot, buy: tot ? (rec.sb + rec.b) / tot : null, target: isNum(x[6]) ? x[6] : null };
  }).filter((x) => x.t != null).sort((a, b) => a.t - b.t);
}
// Koersdoel door de tijd: uit de dagregels en uit de weekgeschiedenis samen
function targetSeries(tk) {
  const r = (data.research || {})[tk] || {};
  const m = new Map();
  (Array.isArray(r.targetHist) ? r.targetHist : []).forEach((h) => { const t = ymd(h.d); if (t != null && isNum(h.mean)) m.set(h.d, { t, v: h.mean }); });
  recHistRows(tk).forEach((x) => { if (isNum(x.target)) m.set(x.day, { t: x.t, v: x.target }); });
  return [...m.values()].sort((a, b) => a.t - b.t);
}
// Wat er tussen twee standen veranderde, in woorden
function recChangeText(a, b, cur) {
  const bits = [];
  REC_PARTS.forEach(([k, label]) => { const d = (b.rec[k] || 0) - (a.rec[k] || 0); if (d) bits.push(sgn(d, NI) + ' ' + label.toLowerCase()); });
  if (isNum(a.target) && isNum(b.target) && a.target !== b.target) bits.push('koersdoel ' + money(a.target, cur) + ' → ' + money(b.target, cur));
  return bits.join(', ');
}
function revisionTile(o) {
  const tk = o.tk;
  const rows = recHistRows(tk);
  const ts = targetSeries(tk);
  const cur = o.cur || 'USD';
  const head = '<section class="tile pad rev-tile"><h3>Analisten door de tijd</h3>';
  const foot = '<p class="sub" style="margin-top:8px">De Worker bewaart elke dag de stand van de aanbevelingen als die verandert, en het koersdoel per week. Hoe langer de tracker meet, hoe verder deze tijdlijn teruggaat. Meningen van analisten, geen voorspelling.</p></section>';
  if (rows.length < 2 && ts.length < 2) {
    return head + '<p class="muted">Nog te weinig geschiedenis. Zodra de Worker een paar dagen de aanbevelingen en koersdoelen heeft bijgehouden, staat hier hoe die veranderden.</p>' + foot;
  }
  const show = thin(rows, 30);
  const strip = rows.length >= 2 ? '<div class="rev-strip" role="img" aria-label="' + esc('Aanbevelingen van ' + tk + ' door de tijd') + '">' + show.map((x) => {
    const parts = REC_PARTS.filter(([k]) => x.rec[k]);
    return '<div class="rev-c" data-tip="' + esc(fD.format(x.t) + ': ' + P1.format(x.buy) + ' kopen, ' + x.tot + ' analisten') + '">' +
      parts.map(([k, , c]) => '<i style="height:' + (x.rec[k] / x.tot * 100).toFixed(1) + '%;background:' + c + '"></i>').join('') + '</div>';
  }).join('') + '</div>' +
    '<div class="range-labels"><span>' + esc(fDM.format(rows[0].t)) + '</span><span>' + esc(fDM.format(rows[rows.length - 1].t)) + '</span></div>' +
    '<div class="rec-leg" style="margin-top:6px">' + REC_PARTS.map(([, label, c]) => '<span><i style="background:' + c + '"></i>' + esc(label) + '</span>').join('') + '</div>' : '';
  const first = rows[0], last = rows[rows.length - 1];
  const dBuy = rows.length >= 2 && isNum(first.buy) && isNum(last.buy) ? last.buy - first.buy : null;
  const t0 = ts.length >= 2 ? ts[0] : null, t1 = ts.length ? ts[ts.length - 1] : null;
  const dT = t0 && t1 && t0.v > 0 ? t1.v / t0.v - 1 : null;
  const facts = kvList([
    ['Kopen nu', last && isNum(last.buy) ? P1.format(last.buy) + ' van ' + last.tot + ' analisten' : '–'],
    ['Verschil met ' + (first ? fDM.format(first.t) : 'de start'), isNum(dBuy) ? sgn(dBuy * 100, N1) + ' pp' : '–', tone(dBuy)],
    ['Analisten erbij of eraf', first && last ? sgn(last.tot - first.tot, NI) : '–', tone(first && last ? last.tot - first.tot : null)],
    ['Koersdoel', t1 ? money(t1.v, cur) + (t0 && t0 !== t1 ? ' (was ' + money(t0.v, cur) + ')' : '') : '–'],
    ['Koersdoel verschil', isNum(dT) ? spct1(dT) : '–', tone(dT)],
  ]);
  const spk = ts.length >= 2 ? '<p class="small muted" style="margin:10px 0 2px">Gemiddeld koersdoel</p>' + spark(ts, isNum(dT) && dT < 0 ? C.loss : C.gain, 'spark tall') : '';
  const changes = [];
  for (let i = rows.length - 1; i > 0 && changes.length < 5; i--) {
    const txt = recChangeText(rows[i - 1], rows[i], cur);
    if (txt) changes.push({ t: rows[i].t, txt });
  }
  const list = changes.length ? '<p class="small" style="margin-top:12px"><b>Laatste wijzigingen</b></p><div class="tx-list">' + changes.map((c) =>
    '<div class="tx"><span class="tag">' + esc(fDM.format(c.t)) + '</span><span class="tx-m"><b>' + esc(c.txt) + '</b></span></div>').join('') + '</div>' : '';
  return head + strip + spk + '<div style="margin-top:10px">' + facts + '</div>' + list + foot;
}

// =====================================================================
// ---------- Kwartaalcijfers die eraan komen (per bedrijf en als overzicht) ----------
function earnEventsOf(tk, held) {
  const ev = data.events || {};
  const sym = held && M.mk.ok ? M.mk.sym(tk) : tk;
  const hit = (e) => e.ticker === tk || e.ticker === sym || e.symbol === sym;
  const today = dayStart(Date.now());
  const next = (ev.earnings || []).filter((e) => hit(e) && ymd(e.date) != null && ymd(e.date) >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
  const R = (data.research || {})[tk] || {};
  const eps = (R.eps || []).filter((x) => isNum(x.pct)).slice(0, 4);
  const lastEv = (ev.lastEarnings || []).filter(hit)[0] || null;
  const lastEps = (R.eps || []).map((x) => Object.assign({}, x, { t: ymd(x.period) })).filter((x) => x.t != null).sort((a, b) => b.t - a.t)[0] || null;
  const mv = typeof earningsMoves === 'function' ? earningsMoves(tk) : [];
  const usual = mv.length ? mean(mv.map((m) => Math.abs(m.move))) : null;
  return { next, eps, lastEv, lastEps, moves: mv, usual };
}
const epsSurprise = (x) => (isNum(x.pct) ? spct1(x.pct / 100) : '–');
// Tekst bij gerapporteerde cijfers; de SEC geeft alleen de werkelijke winst, zonder verwachting
const epsVsText = (x) => (isNum(x.pct) ? epsSurprise(x) + (x.pct > 0 ? ' boven' : x.pct < 0 ? ' onder' : ' gelijk aan') + ' verwachting'
  : isNum(x.actual) ? 'winst per aandeel $' + N2.format(x.actual) + ', verwachting onbekend' : 'verwachting onbekend');
// Verrassingen als kleine staafjes, zoals op de bedrijfspagina
function epsBars(eps) {
  const list = eps.slice().reverse();
  const mx = Math.max(1e-9, ...list.map((x) => Math.abs(x.pct || 0)));
  return '<div class="eps">' + list.map((x) => '<div class="eps-i"><span class="muted small">' + esc(x.period ? fMonY.format(ymd(x.period)) : '') + '</span>' +
    '<span class="eps-b"><i class="' + ((x.pct || 0) < 0 ? 'neg' : 'pos') + '" style="height:' + (Math.abs(x.pct || 0) / mx * 50).toFixed(0) + '%"></i></span>' +
    '<b class="' + tone(x.pct) + '">' + esc(epsSurprise(x)) + '</b></div>').join('') + '</div>';
}
function earnPreviewTile(o) {
  const E = earnEventsOf(o.tk, !o.watch);
  if (!E.next) return '';
  const t = ymd(E.next.date);
  const cur = o.cur || 'USD';
  const beats = E.eps.filter((x) => x.pct > 0).length;
  const near = E.moves.slice(-4).reverse();
  return '<section class="tile pad earn-prev"><h3>Kwartaalcijfers komen eraan</h3>' +
    '<div class="fx-head"><span class="v big">' + esc(fD.format(t)) + '</span><span class="muted small">' + esc(whenText(t)) + '</span></div>' +
    kvList([
      ['Verwachte winst per aandeel', isNum(E.next.epsEst) ? N2.format(E.next.epsEst) + (cur === 'EUR' ? ' €' : ' $') : 'nog niet bekend'],
      ['Laatste vier keer boven verwachting', E.eps.length ? beats + ' van ' + E.eps.length : E.lastEps ? 'verwachting onbekend' : 'nog geen gegevens'],
      ['Koers beweegt rond cijfers meestal', isNum(E.usual) ? P1.format(E.usual) + ' (op of neer)' : 'nog niet gemeten'],
      ['Vorige cijfers', E.lastEps ? fDM.format(E.lastEps.t) + ', ' + epsVsText(E.lastEps) : '–'],
    ]) +
    (E.eps.length ? '<p class="small" style="margin-top:10px"><b>Verrassingen per kwartaal</b></p>' + epsBars(E.eps) : '') +
    (near.length ? '<p class="small muted" style="margin-top:8px">Koersreactie vorige keren: ' + near.map((m) => '<span class="' + tone(m.move) + '">' + esc(fDM.format(m.t) + ' ' + spct1(m.move)) + '</span>').join(' · ') + '</p>' : '') +
    '<p class="sub" style="margin-top:8px">Datum en verwachting komen van Financial Modeling Prep, de verrassingen van Finnhub. De gewone sprong is het verschil tussen de slotkoers vlak voor en vlak na eerdere cijfers. Geen voorspelling en geen beleggingsadvies.</p></section>';
}

// Overzicht: alles wat de komende vier weken met cijfers komt, en wat er net is gerapporteerd
function earnSeasonRows() {
  const today = dayStart(Date.now());
  const keys = M.companies.filter((c) => !isFundC(c)).map((c) => ({ tk: c.tk, name: c.name, held: true, cur: c.cur }))
    .concat(watchSyms().map((s) => { const p = M.mk.ok ? M.mk.prof(s) : null; return { tk: s, name: (p && p.name) || s, held: false, cur: (p && p.currency) || 'USD' }; }));
  const soon = [], done = [];
  keys.forEach((k) => {
    const E = earnEventsOf(k.tk, k.held);
    const t = E.next ? ymd(E.next.date) : null;
    if (t != null && t <= today + 28 * DAY) soon.push(Object.assign({}, k, { t, epsEst: E.next.epsEst, usual: E.usual, last: E.lastEps }));
    const rep = E.lastEps && E.lastEps.t >= today - 28 * DAY ? E.lastEps : null;
    if (rep) done.push(Object.assign({}, k, { t: rep.t, eps: rep }));
  });
  soon.sort((a, b) => a.t - b.t);
  done.sort((a, b) => b.t - a.t);
  return { soon, done };
}
function earnSeasonTile() {
  const S = earnSeasonRows();
  const row = (x) => '<tr class="rowlink" data-ticker="' + esc(x.held ? x.tk : '~' + x.tk) + '"><td class="co"><b>' + esc(x.tk) + '</b>' + (x.held ? '' : ' <span class="tag">Volglijst</span>') + '<span class="nm">' + esc(x.name) + '</span></td>' +
    '<td>' + esc(fD.format(x.t)) + '<span class="sub">' + esc(whenText(x.t)) + '</span></td>' +
    '<td class="num">' + esc(isNum(x.epsEst) ? N2.format(x.epsEst) : '–') + '</td>' +
    '<td class="num">' + esc(isNum(x.usual) ? P1.format(x.usual) : '–') + '</td>' +
    '<td class="num ' + tone(x.last && x.last.pct) + '">' + esc(x.last ? epsSurprise(x.last) : '–') + (x.last ? '<span class="sub">' + esc(fDM.format(x.last.t)) + '</span>' : '') + '</td></tr>';
  const table = S.soon.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bedrijf</th><th>Cijfers op</th><th class="num">Verwachte wpa</th><th class="num">Gewone sprong</th><th class="num">Vorige verrassing</th></tr></thead><tbody>' +
    S.soon.map(row).join('') + '</tbody></table></div>'
    : '<p class="muted">Geen aangekondigde kwartaalcijfers in de komende vier weken voor je posities en volglijst.</p>';
  const after = S.done.length ? '<p class="small" style="margin-top:14px"><b>Net gerapporteerd</b></p><div class="alt-list">' + S.done.slice(0, 8).map((x) =>
    '<button type="button" class="alt" data-ticker="' + esc(x.held ? x.tk : '~' + x.tk) + '"><b>' + esc(x.tk) + ' <span class="muted small">' + esc(fDM.format(x.t)) + '</span></b>' +
    '<span class="small ' + tone(x.eps.pct) + '">' + esc(epsVsText(x.eps)) + '</span>' +
    '<span class="small muted">' + esc(isNum(x.eps.actual) && isNum(x.eps.estimate) ? N2.format(x.eps.actual) + ' tegenover ' + N2.format(x.eps.estimate) + ' verwacht' : '') + '</span></button>').join('') + '</div>' : '';
  return '<section class="tile pad full earn-season"><h3>Cijferseizoen</h3>' +
    '<p class="small muted" style="margin-top:2px">' + esc(S.soon.length ? S.soon.length + (S.soon.length === 1 ? ' bedrijf komt' : ' bedrijven komen') + ' de komende vier weken met kwartaalcijfers.' : 'Niets aangekondigd voor de komende vier weken.') + '</p>' +
    table + after +
    '<p class="sub" style="margin-top:8px">Verwachte wpa: winst per aandeel die analisten verwachten. Gewone sprong: hoeveel de koers rond eerdere cijfers gemiddeld op of neer ging. Agenda van Financial Modeling Prep, verwachtingen en verrassingen van Finnhub.</p></section>';
}

// =====================================================================
// ---------- Scorebord: wezen eerdere koersdoelen de goede kant op? ----------
function targetScoreRows() {
  const groups = new Map();
  analystRows().forEach((x) => {
    const h = targetHits(x.o.tk);
    if (!h || !h.n) return;
    const prof = M.mk.ok ? (x.held ? M.mk.profOf(x.o.tk) : M.mk.prof(x.o.tk)) : null;
    const s = x.held && M.mk.ok ? M.mk.sectorOf(x.o) : (prof && prof.sector) || 'Onbekend';
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push({ o: x.o, held: x.held, n: h.n, rate: h.rate });
  });
  const sectors = [...groups].map(([s, L]) => {
    const n = sum(L.map((x) => x.n));
    return { s, L: L.slice().sort((a, b) => b.rate - a.rate), n, rate: n ? sum(L.map((x) => x.n * x.rate)) / n : null };
  }).sort((a, b) => (b.rate || 0) - (a.rate || 0));
  const n = sum(sectors.map((g) => g.n));
  return { sectors, n, rate: n ? sum(sectors.map((g) => g.n * g.rate)) / n : null };
}
function analystScoreTile() {
  const S = targetScoreRows();
  const head = '<section class="tile pad full an-score"><h3>Analisten tegenover de uitkomst</h3>';
  const foot = '<p class="sub" style="margin-top:8px">Per bewaard koersdoel van minstens drie maanden oud: lag het boven of onder de koers van toen, en ging de koers daarna die kant op? Dat zegt alleen iets over de richting, niet of het koersdoel werd gehaald. Met weinig metingen is het toeval; geen beleggingsadvies.</p></section>';
  if (!S.n) return head + '<p class="muted">Hiervoor zijn koersdoelen van minstens drie maanden oud en genoeg koersgeschiedenis nodig. De Worker bewaart het koersdoel elke week; na drie maanden staat hier het eerste scorebord.</p>' + foot;
  const rows = S.sectors.map((g) => '<tr><td class="co"><b>' + esc(sectorNl(g.s)) + '</b><span class="nm">' + esc(g.L.map((x) => x.o.tk).slice(0, 6).join(', ')) + '</span></td>' +
    '<td class="num">' + g.n + '</td>' +
    '<td>' + split(Math.round(g.rate * 100), Math.round((1 - g.rate) * 100)) + '</td>' +
    '<td class="num ' + (g.rate >= 0.6 ? 'gain' : g.rate < 0.4 ? 'loss' : '') + '">' + esc(P1.format(g.rate)) + '</td>' +
    '<td>' + (g.L.length ? esc(g.L[0].o.tk + ' ' + P1.format(g.L[0].rate)) + (g.L.length > 1 ? '<span class="sub">' + esc('zwakste: ' + g.L[g.L.length - 1].o.tk + ' ' + P1.format(g.L[g.L.length - 1].rate)) + '</span>' : '') : '–') + '</td></tr>').join('');
  return head +
    '<div class="fx-head"><span class="v big ' + (S.rate >= 0.5 ? 'gain' : 'loss') + '">' + esc(P1.format(S.rate)) + '</span><span class="muted small">' + esc('van de ' + S.n + ' bewaarde koersdoelen wees de goede kant op') + '</span></div>' +
    '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Sector</th><th class="num">Koersdoelen</th><th>Goede richting</th><th class="num">Deel goed</th><th>Beste en zwakste</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + foot;
}

// =====================================================================
// ---------- Stemming van analisten per sector, als strook op het overzicht ----------
const opHeatCls = (d) => (!isNum(d) ? '' : heatCls(d / 2));
function opinionHeatTile() {
  if (!data.research || !Object.keys(data.research).length) return '';
  const S = opinionShifts(30);
  const sectors = S.sectors.filter((g) => g.tot);
  if (!sectors.length) return '';
  const strip = '<div class="op-heat" role="img" aria-label="Stemming van analisten per sector, laatste maand">' + sectors.map((g) =>
    '<a class="cell ' + opHeatCls(g.dBuy) + '" href="#nieuws" style="flex:' + Math.max(1, Math.sqrt(g.tot)).toFixed(2) + '" data-tip="' + esc(sectorNl(g.s) + ': ' + (isNum(g.buy) ? P1.format(g.buy) + ' kopen, ' : '') + g.tot + ' analisten' + (isNum(g.dBuy) ? ', ' + ppTxt(g.dBuy) + ' in een maand' : '')) + '">' +
    '<span class="s">' + esc(sectorNl(g.s)) + '</span><span class="d">' + esc(isNum(g.dBuy) ? ppTxt(g.dBuy) : isNum(g.buy) ? P1.format(g.buy) : '') + '</span></a>').join('') + '</div>';
  const mv = S.moves[0];
  return '<section class="tile pad op-heat-tile"><h3>Stemming van analisten per sector</h3>' +
    '<p class="small muted" style="margin:2px 0 8px">Verandering in het deel analisten dat kopen zegt, laatste maand. Breder = meer analisten.</p>' + strip +
    '<div class="heat-key" aria-hidden="true">minder positief <i class="heat-l3"></i><i class="heat-l2"></i><i class="heat-l1"></i><i class="heat-g1"></i><i class="heat-g2"></i><i class="heat-g3"></i> positiever</div>' +
    (mv ? '<p class="small" style="margin-top:8px">Grootste verschuiving: <b>' + esc(mv.o.tk) + '</b> ' + esc(sectorNl(mv.sector)) + (isNum(mv.dBuy) ? ', kopen ' + esc(ppTxt(mv.dBuy)) : '') + (isNum(mv.dT) ? ', koersdoel ' + esc(spct1(mv.dT)) : '') + '</p>' : '') +
    '<p class="sub" style="margin-top:8px">Alle analisten van je posities en volglijst samen per sector. Op Nieuws staat de hele tabel. Geen beleggingsadvies.</p></section>';
}
defineView('opheat', () => {
  const key = mode === 'm' ? 'm-home' : 'home';
  const host = $(mode === 'm' ? 'm-op-heat' : 'op-heat');
  if (!host) return;
  host.innerHTML = M ? opinionHeatTile() : '';
  // Leeg (nog geen analisten): de hele sectie weg; anders volgt hij de keuze van de gebruiker
  const sec = /** @type {HTMLElement} */ (host.closest('.dash-sec'));
  if (sec) sec.hidden = !host.innerHTML || ((dashPrefs()[key] || {}).hidden || []).includes(sec.dataset.sec);
});
if (PAGE_VIEWS.home && !PAGE_VIEWS.home.includes('opheat')) PAGE_VIEWS.home.push('opheat');

// =====================================================================
// ---------- "Wat heb ik gemist": sinds je vorige bezoek, per apparaat ----------
const LS_SEEN_AT = 'tracker.seenAt';
const MISSED_GAP = 30 * 60e3;   // binnen een half uur opnieuw openen verschuift het venster niet
const missedFrom = (() => { try { const v = Number(localStorage.getItem(LS_SEEN_AT)); return v > 0 ? v : null; } catch (e) { return null; } })();
(function markVisit() {
  if (missedFrom && Date.now() - missedFrom < MISSED_GAP) return;
  try { localStorage.setItem(LS_SEEN_AT, String(Date.now())); } catch (e) { /* niet erg */ }
})();

function missedModel() {
  const since = missedFrom || Date.now() - 7 * DAY;
  const moveOf = (pts) => {
    const a = pts.filter((p) => p.t <= since).pop(), b = pts.length ? pts[pts.length - 1] : null;
    return a && b && a !== b && a.v > 0 ? b.v / a.v - 1 : null;
  };
  const moves = [];
  M.companies.forEach((c) => { const p = moveOf(twrSeries(c.tk)); if (isNum(p)) moves.push({ tk: c.tk, name: c.name, held: true, pct: p, value: c.value }); });
  watchSyms().forEach((s) => {
    const pr = M.mk.ok ? M.mk.prices(s) : [];
    const p = moveOf(pr);
    if (isNum(p)) { const pf = M.mk.ok ? M.mk.prof(s) : null; moves.push({ tk: s, name: (pf && pf.name) || s, held: false, pct: p, value: null }); }
  });
  moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const tot = moveOf(twrSeries(TOTAL));
  const news = newsItems().filter((n) => n.t > since);
  const anal = [];
  Object.keys(data.research || {}).forEach((tk) => {
    const held = M.byTk.has(tk);
    if (!held && !watchSyms().includes(tk)) return;
    const rows = recHistRows(tk);
    const cur = (held ? (M.byTk.get(tk) || {}).cur : ((M.mk.ok && M.mk.prof(tk)) || {}).currency) || 'USD';
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].t <= since) continue;
      const txt = recChangeText(rows[i - 1], rows[i], cur);
      if (txt) anal.push({ tk, held, t: rows[i].t, txt, dBuy: isNum(rows[i].buy) && isNum(rows[i - 1].buy) ? rows[i].buy - rows[i - 1].buy : null });
    }
  });
  anal.sort((a, b) => b.t - a.t);
  const divs = (M.ev.received || []).filter((d) => d.t != null && d.t > since).sort((a, b) => b.t - a.t);
  const alerts = ((M.settings && M.settings.priceAlerts) || []).filter((a) => a.hit && Date.parse(a.hit) > since);
  const n = news.length + anal.length + divs.length + alerts.length + moves.filter((m) => Math.abs(m.pct) >= 0.03).length;
  return { since, first: !missedFrom, moves, tot, news, anal, divs, alerts, n };
}

// Compacte tegel op de nieuwspagina, met een knop naar de hele pagina
// ---------- Officieel en geruchten ----------
// Van de Worker (data.newsFlash): persberichten, geruchten en belangrijk nieuws over je aandelen en volglijst, de
// laatste 7 dagen. Daarbij de deponeringen 8-K en 6-K bij de SEC (data.ext2.filings), want die zijn altijd officieel.
// Breaking: belangrijk (bestuur, overname, onderzoek ...) en van het afgelopen etmaal.
const FORM8K = { '1.01': 'belangrijke overeenkomst', '1.02': 'overeenkomst beëindigd', '1.03': 'faillissement', '2.01': 'overname of verkoop afgerond',
  '2.02': 'resultaten', '2.05': 'reorganisatie', '2.06': 'afwaardering', '3.01': 'beursnotering', '4.02': 'eerdere cijfers niet meer betrouwbaar',
  '5.02': 'wisseling in het bestuur', '5.03': 'statuten', '5.07': 'stemming van aandeelhouders', '7.01': 'mededeling aan beleggers', '8.01': 'overige gebeurtenis' };
const FLASH_BIG_ITEMS = /1\.03|2\.01|4\.02|5\.02/;
function flashItems() {
  const since = Date.now() - 14 * DAY;
  const out = (data.newsFlash || []).filter((n) => n && n.t >= since && !newsMuted(n)).map((n) => Object.assign({}, n));
  const per = (data.ext2 && data.ext2.filings && data.ext2.filings.per) || {};
  Object.entries(per).forEach(([tk, f]) => ((f && f.list) || []).forEach((x) => {
    if (!/^(8-K|6-K)$/.test(x.form)) return;
    const t = ymd(x.date);
    if (!isNum(t) || t < since) return;
    const its = String(x.items || '').split(',').map((s) => FORM8K[s.trim()]).filter(Boolean);
    out.push({ t, tk, kind: 'official', source: 'SEC', url: x.url, headline: x.form + ' bij de SEC' + (its.length ? ': ' + its.join(', ') : ''), breaking: FLASH_BIG_ITEMS.test(x.items || '') });
  }));
  return out.sort((a, b) => b.t - a.t);
}
function officialTile() {
  if (!M) return '';
  const f = xs.flashF || 'all';
  const all = flashItems();
  const list = all.filter((n) => f === 'all' || n.kind === f).slice(0, 25);
  const fresh = (n) => n.breaking && Date.now() - n.t < DAY;
  const item = (n) => tpl`<a class="news-i" href="${n.url}" target="_blank" rel="noopener"><span class="news-m">
      <span class="${'tag' + (M.byTk.has(n.tk) ? ' gain' : '')}">${n.tk}</span>
      ${n.kind === 'official' ? tpl`<span class="tag flash-off">${T('Officieel')}</span>` : n.kind === 'rumour' ? tpl`<span class="tag flash-rum">${T('Gerucht')}</span>` : null}
      ${fresh(n) ? tpl`<span class="tag loss">Breaking</span>` : n.breaking ? tpl`<span class="tag">${T('Belangrijk')}</span>` : null}
      ${(n.source === 'SEC' ? fD.format(n.t) : fDT.format(n.t)) + (n.source ? ', ' + n.source : '')}</span><span class="news-t">${n.headline}</span></a>`;
  const c = { official: 0, rumour: 0 };
  all.forEach((n) => { if (c[n.kind] != null) c[n.kind]++; });
  return String(tpl`<section class="${'tile pad flash-tile' + (mode === 'm' ? '' : ' span-2')}"><div class="plan-head"><h3>${T('Officieel en geruchten')}</h3>${raw(segX('flashF', [['all', 'Alles'], ['official', 'Officieel'], ['rumour', 'Geruchten']], f, 'Berichten filteren'))}</div>
    <p class="small muted" style="margin:2px 0 6px">${c.official + ' officieel, ' + c.rumour + ' geruchten' + (all.filter(fresh).length ? ', ' + all.filter(fresh).length + ' breaking' : '') + ' in de laatste twee weken'}</p>
    ${list.length ? tpl`<div class="news">${list.map(item)}</div>` : tpl`<p class="muted">${f === 'rumour' ? 'Geen geruchten over je aandelen gevonden.' : f === 'official' ? 'Geen officiële berichten gevonden.' : 'Nog niets gevonden.'}${FEAT().has.finnhub || demo ? '' : ' Met een gratis Finnhub-sleutel kijkt de Worker elke 10 minuten naar het nieuws van je aandelen.'}</p>`}
    <p class="sub" style="margin-top:8px">Officieel: persberichten van het bedrijf zelf (via Business Wire, PR Newswire, GlobeNewswire en dergelijke) en deponeringen bij de SEC (8-K, 6-K). Gerucht: een bericht dat zich baseert op niet genoemde bronnen ("reportedly", "people familiar", "in talks"); dat is niet bevestigd en kan onjuist zijn. Breaking: over bestuur, overnames, onderzoeken en dergelijke, van het afgelopen etmaal. De herkenning gaat op woorden in de kop en de bron, dus lees bij twijfel het bericht zelf. De Worker kijkt elke 10 minuten bij een paar van je aandelen om de beurt; een melding bij breaking nieuws stel je in bij Instellingen, Meldingen. Geen beleggingsadvies.</p></section>`);
}

function missedTile() {
  const X = missedModel();
  const bits = [];
  if (X.news.length) bits.push(X.news.length + (X.news.length === 1 ? ' nieuwsbericht' : ' nieuwsberichten'));
  if (X.anal.length) bits.push(X.anal.length + (X.anal.length === 1 ? ' analistenwijziging' : ' analistenwijzigingen'));
  if (X.divs.length) bits.push(X.divs.length + ' dividend' + (X.divs.length === 1 ? '' : 'en'));
  const big = X.moves.filter((m) => Math.abs(m.pct) >= 0.03).slice(0, 3);
  return '<section class="tile pad missed-tile"><h3>Wat heb ik gemist?</h3>' +
    '<p class="small muted" style="margin:2px 0 8px">' + esc(X.first ? 'Eerste keer op dit apparaat: hieronder de laatste week.' : 'Sinds je vorige bezoek, ' + fDT.format(X.since) + '.') + '</p>' +
    (bits.length || big.length
      ? kvList([
        ['Nieuws en analisten', bits.length ? bits.join(', ') : 'niets nieuws'],
        ['Je beleggingen samen', isNum(X.tot) ? spct1(X.tot) : 'nog niet te meten', tone(X.tot)],
        ['Grootste bewegingen', big.length ? big.map((m) => m.tk + ' ' + spct1(m.pct)).join(', ') : 'geen beweging boven 3%'],
      ])
      : '<p class="muted">Niets nieuws sinds je vorige bezoek.</p>') +
    '<p style="margin-top:10px"><a class="btn ghost" href="#gemist">Alles bekijken</a></p>' +
    '<p class="sub" style="margin-top:8px">Het tijdstip van je vorige bezoek staat alleen op dit apparaat, niet in je Worker.</p></section>';
}

function renderMissedView() {
  const X = missedModel();
  const title = 'Wat heb ik gemist?';
  const head = pseudoHead(X.first ? 'Laatste week' : 'Sinds ' + fDT.format(X.since), X.n ? X.n + (X.n === 1 ? ' ding' : ' dingen') : 'Niets nieuws',
    X.first ? 'Dit apparaat houdt vanaf nu bij wanneer je de tracker opende.' : 'Nieuws, analisten, koersen en dividend sinds je vorige bezoek.');
  const mx = Math.max(0.001, ...X.moves.map((m) => Math.abs(m.pct)));
  const movesTile = '<section class="tile pad"><h3>Koersen</h3>' +
    (X.moves.length ? '<div class="hbars cmp">' + X.moves.slice(0, 12).map((m) =>
      '<button type="button" class="r" data-ticker="' + esc(m.held ? m.tk : '~' + m.tk) + '" data-tip="' + esc(m.tk + ': ' + spct1(m.pct) + (m.held && isNum(m.value) ? ', nu ' + eur(m.value) : '')) + '">' +
      '<span class="tk">' + esc(m.tk) + '</span><span class="track"><span class="mid"></span><span class="' + (m.pct < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(m.pct) / mx * 50).toFixed(1) + '%"></span></span>' +
      '<span class="' + tone(m.pct) + '" style="text-align:right;font-weight:600">' + esc(spct1(m.pct)) + '</span></button>').join('') + '</div>' +
      '<p class="sub" style="margin-top:8px">Verandering van de koers sinds je vorige bezoek. Voor je posities zonder aan- en verkopen gerekend, voor je volglijst de slotkoersen.</p>'
      : '<p class="muted">Nog geen metingen sinds je vorige bezoek.</p>') +
    (isNum(X.tot) ? '<p class="small" style="margin-top:8px">Je beleggingen samen: <b class="' + tone(X.tot) + '">' + esc(spct1(X.tot)) + '</b></p>' : '') + '</section>';
  const newsTile = '<section class="tile pad span-2"><h3>Nieuws</h3>' +
    (X.news.length ? '<div class="news">' + newsClusters(X.news).slice(0, 12).map((c) => newsClusterHtml(c, newsItemHtml)).join('') + '</div>' +
      (X.news.length > 12 ? '<p class="small muted" style="margin-top:8px">' + esc('en nog ' + (X.news.length - 12) + ' berichten op de nieuwspagina') + '</p>' : '')
      : '<p class="muted">Geen nieuws sinds je vorige bezoek.</p>') + '</section>';
  const analTile = '<section class="tile pad"><h3>Analisten</h3>' +
    (X.anal.length ? '<div class="tx-list">' + X.anal.slice(0, 10).map((a) =>
      '<div class="tx rowlink" role="button" tabindex="0" data-ticker="' + esc(a.held ? a.tk : '~' + a.tk) + '"><span class="tag' + (isNum(a.dBuy) && a.dBuy > 0 ? ' gain' : isNum(a.dBuy) && a.dBuy < 0 ? ' loss' : '') + '">' + esc(a.tk) + '</span>' +
      '<span class="tx-m"><b>' + esc(a.txt) + '</b><span class="sub">' + esc(fD.format(a.t)) + '</span></span></div>').join('') + '</div>'
      : '<p class="muted">Geen wijzigingen in aanbevelingen of koersdoelen.</p>') +
    '<p class="sub" style="margin-top:8px">Uit de dagelijkse stand die de Worker bewaart.</p></section>';
  const divTile = '<section class="tile pad"><h3>Dividend en alarmen</h3>' +
    (X.divs.length ? kvList(X.divs.slice(0, 6).map((d) => [d.ticker + ', ' + fD.format(d.t), eur(d.amount)])) : '<p class="muted">Geen dividend ontvangen sinds je vorige bezoek.</p>') +
    (X.alerts.length ? '<p class="small" style="margin-top:8px"><b>Koersalarmen afgegaan</b></p><div class="alt-list">' + X.alerts.slice(0, 6).map((a) =>
      '<div class="alt"><b>' + esc(a.sym || '') + '</b><span class="small muted">' + esc((a.op === 'below' ? 'onder ' : 'boven ') + (a.price != null ? N2.format(a.price) : '')) + '</span></div>').join('') + '</div>' : '') + '</section>';
  const tiles = [[newsTile, movesTile], [analTile, divTile]];
  return pseudoPage(title, head, tiles, [movesTile, newsTile, analTile, divTile]);
}
