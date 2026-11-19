/* Investeringstracker – Nieuws, analisten, insiders, volgsuggesties en klikken voor de uitbreidingen
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Nieuws, analisten en insiders ----------
// Betrouwbaarheid: hoe dicht winstverwachtingen bij de uitkomst lagen, hoeveel analisten, hoe eens ze zijn, spreiding van koersdoelen
// en (zodra er genoeg geschiedenis is) of eerdere koersdoelen de goede kant op wezen.
function targetHits(tk) {
  const r = (data.research || {})[tk];
  if (!r || !r.targetHist || !M.mk.ok) return null;
  const sym = M.mk.sym(tk) || tk;
  const pr = M.mk.prices(watchSyms().includes(tk) ? tk : sym);
  if (pr.length < 60) return null;
  const now = pr[pr.length - 1].v;
  let n = 0, hit = 0;
  r.targetHist.forEach((h) => {
    const t = ymd(h.d); if (t == null || Date.now() - t < 90 * DAY) return;
    const p0 = priceOn(pr, t); if (!p0 || !(p0.v > 0)) return;
    n++; if (Math.sign(h.mean - p0.v) === Math.sign(now - p0.v)) hit++;
  });
  return n ? { n, rate: hit / n } : null;
}
function analystReliability(tk) {
  const r = (data.research || {})[tk];
  if (!r) return null;
  const rc = recOf(tk), T = r.target, eps = (r.eps || []).filter((x) => isNum(x.pct));
  let score = 0, max = 0; const why = [];
  if (eps.length >= 2) {
    max += 3; const m = mean(eps.map((x) => Math.abs(x.pct)));
    score += m < 3 ? 3 : m < 7 ? 2 : m < 15 ? 1 : 0;
    why.push('winstverwachting gemiddeld ' + N1.format(m) + '% naast de uitkomst (' + eps.length + ' kwartalen)');
  }
  if (rc) {
    max += 4; score += rc.tot >= 20 ? 2 : rc.tot >= 8 ? 1 : 0;
    const rec = rc.rec; const camps = [(rec.sb || 0) + (rec.b || 0), rec.h || 0, (rec.s || 0) + (rec.ss || 0)]; const dom = Math.max(...camps) / rc.tot;
    score += dom >= 0.75 ? 2 : dom >= 0.55 ? 1 : 0;
    why.push(rc.tot + ' analisten, ' + P1.format(dom) + ' in hetzelfde kamp');
  }
  if (T && isNum(T.high) && isNum(T.low) && T.mean > 0) {
    max += 2; const sp = (T.high - T.low) / T.mean; score += sp <= 0.5 ? 2 : sp <= 1 ? 1 : 0;
    why.push('koersdoelen liggen ' + P1.format(sp) + ' uit elkaar');
  }
  const h = targetHits(tk);
  if (h && h.n >= 3) { max += 3; score += Math.round(3 * h.rate); why.push('eerdere koersdoelen wezen ' + h.n + ' keer de ' + (h.rate >= 0.5 ? 'goede' : 'verkeerde') + ' kant op (' + P1.format(h.rate) + ' raak)'); }
  if (!max) return null;
  const s10 = Math.round(score / max * 10);
  return { score: s10, word: s10 >= 7 ? 'hoog' : s10 >= 4 ? 'gemiddeld' : 'laag', why, hits: h };
}
function analystRows() {
  const keys = M.companies.filter((c) => !isFundC(c)).map((c) => ({ o: c, held: true })).concat(watchSyms().map((s) => ({ o: watchPseudo(s), held: false })));
  return keys.map(({ o, held }) => {
    const rc = recOf(o.tk); const r = (data.research || {})[o.tk];
    if (!rc && !(r && r.target)) return null;
    return { o, held, rc, up: upsideOf(o), rel: analystReliability(o.tk), sent: r && r.sent };
  }).filter(Boolean);
}
function analystSuggestions() {
  const rows = analystRows();
  const sc = (x) => (x.rc ? x.rc.buy : 0.5) + Math.max(-0.3, Math.min(0.5, x.up || 0)) + (x.rel ? x.rel.score / 20 : 0);
  const pos = rows.filter((x) => x.rc && x.rc.buy >= 0.6 && (!isNum(x.up) || x.up > 0.05) && (!x.rel || x.rel.score >= 5)).sort((a, b) => sc(b) - sc(a)).slice(0, 5);
  const warn = rows.filter((x) => x.held && ((x.rc && (x.rc.buy < 0.4 || x.rc.sell >= 0.2 || (isNum(x.rc.trend) && x.rc.trend <= -0.1))) || (isNum(x.up) && x.up < -0.05))).slice(0, 5);
  return { pos, warn };
}
function analystLine(x) {
  return (x.rc ? P1.format(x.rc.buy) + ' kopen (' + x.rc.tot + ' analisten' + (isNum(x.rc.trend) && Math.abs(x.rc.trend) >= 0.01 ? ', ' + (x.rc.trend > 0 ? 'stijgend' : 'dalend') : '') + ')' : 'geen aanbevelingen') +
    (isNum(x.up) ? ', koersdoel ' + spct1(x.up) : '') + (x.rel ? ', betrouwbaarheid ' + x.rel.word : '');
}
function suggestTile() {
  const S = analystSuggestions();
  const item = (x, warn) => '<button type="button" class="alt" data-ticker="' + esc(x.held ? x.o.tk : '~' + x.o.tk) + '"><b>' + esc(x.o.tk) + ' <span class="muted small">' + esc(x.o.name) + '</span></b>' +
    '<span class="small">' + esc(analystLine(x)) + '</span><span class="small ' + (warn ? 'loss' : 'muted') + '">' + esc(warn ? 'In bezit: analisten zijn hier minder positief' : x.held ? 'In bezit, ' + P1.format(x.o.weight || 0) + ' van je beleggingen' : 'Op je volglijst') + '</span></button>';
  return '<section class="tile pad"><h3>Suggesties volgens analisten</h3>' +
    (S.pos.length ? '<p class="small" style="margin-top:4px"><b>Meest positief, met redelijke betrouwbaarheid</b></p><div class="alt-list">' + S.pos.map((x) => item(x, false)).join('') + '</div>' : '<p class="muted">Geen aandelen waar analisten duidelijk positief over zijn met voldoende betrouwbaarheid.</p>') +
    (S.warn.length ? '<p class="small" style="margin-top:12px"><b>Om op te letten</b></p><div class="alt-list">' + S.warn.map((x) => item(x, true)).join('') + '</div>' : '') +
    '<p class="sub" style="margin-top:8px">Gekozen uit je posities en volglijst: veel analisten positief, koersdoel boven de koers en een redelijke betrouwbaarheid. Analisten zitten er vaak naast; dit is geen beleggingsadvies.</p></section>';
}
// ---------- Meningen van analisten door de tijd en per sector ----------
// Finnhub geeft aanbevelingen per maand en de Worker bewaart het koersdoel per week; sinds v57 bewaart de Worker ook elke dag
// de stand als die verandert (research.recHist: [dag, sb, b, h, s, ss, koersdoel]). Zo zijn ook verschillen tussen dagen te zien.
const OP_PERIODS = [['1', '1 dag'], ['7', '1 week'], ['30', '1 maand'], ['91', '3 maanden']];
const isoDayOf = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const recShare = (sb, b, h, s, ss) => { const t = (sb || 0) + (b || 0) + (h || 0) + (s || 0) + (ss || 0); return t ? { buy: ((sb || 0) + (b || 0)) / t, tot: t } : null; };
// Stand op tijdstip t. Maandcijfers tellen pas vanaf een maand terug en weekkoersdoelen vanaf een week, anders lijkt er niets veranderd.
function opinionAt(tk, t, days) {
  const r = (data.research || {})[tk];
  if (!r) return null;
  const day = isoDayOf(t);
  const H = (r.recHist || []).filter((x) => Array.isArray(x) && x[0] <= day);
  let rec = null, target = null, src = null;
  if (H.length) { const x = H[H.length - 1]; rec = recShare(x[1], x[2], x[3], x[4], x[5]); target = isNum(x[6]) ? x[6] : null; src = 'dag'; }
  if (!rec && days >= 28 && Array.isArray(r.rec)) { const x = r.rec.find((p) => p.period && p.period <= day); if (x && x !== r.rec[0]) { rec = recShare(x.sb, x.b, x.h, x.s, x.ss); src = src || 'maand'; } }
  if (target == null && days >= 7 && Array.isArray(r.targetHist)) { const th = r.targetHist.filter((h) => h.d <= day); if (th.length) target = th[th.length - 1].mean; }
  return rec || isNum(target) ? { rec, target, src } : null;
}
function opinionShifts(days) {
  const then = Date.now() - days * DAY;
  const total = M.totalValue || 0;
  const rows = analystRows().map((x) => {
    const r = (data.research || {})[x.o.tk];
    const T = r && r.target && isNum(r.target.mean) ? r.target.mean : null;
    const p = opinionAt(x.o.tk, then, days);
    const prof = M.mk.ok ? (x.held ? M.mk.profOf(x.o.tk) : M.mk.prof(x.o.tk)) : null;
    const sector = x.held && M.mk.ok ? M.mk.sectorOf(x.o) : (prof && prof.sector) || 'Onbekend';
    return Object.assign({}, x, {
      then: p, T, sector, cur: (prof && prof.currency) || x.o.cur || 'USD',
      dBuy: x.rc && p && p.rec ? x.rc.buy - p.rec.buy : null,
      dTot: x.rc && p && p.rec ? x.rc.tot - p.rec.tot : null,
      dT: T && p && isNum(p.target) && p.target > 0 ? T / p.target - 1 : null,
    });
  });
  const groups = new Map();
  rows.forEach((x) => { if (!groups.has(x.sector)) groups.set(x.sector, []); groups.get(x.sector).push(x); });
  const sectors = [...groups].map(([s, L]) => {
    const R = L.filter((x) => x.rc);
    const tot = R.reduce((a, x) => a + x.rc.tot, 0);
    const camp = { sb: 0, b: 0, h: 0, s: 0, ss: 0 };
    R.forEach((x) => Object.keys(camp).forEach((k) => { camp[k] += x.rc.rec[k] || 0; }));
    // Verschil: dezelfde bedrijven nu en toen, zodat een nieuw gevolgd bedrijf het sectorcijfer niet verschuift
    const P = R.filter((x) => x.then && x.then.rec);
    const wNow = P.reduce((a, x) => a + x.rc.tot, 0), wThen = P.reduce((a, x) => a + x.then.rec.tot, 0);
    const dBuy = wNow && wThen ? P.reduce((a, x) => a + x.rc.buy * x.rc.tot, 0) / wNow - P.reduce((a, x) => a + x.then.rec.buy * x.then.rec.tot, 0) / wThen : null;
    const ups = L.filter((x) => isNum(x.up)).map((x) => x.up), dTs = L.filter((x) => isNum(x.dT)).map((x) => x.dT);
    const byBuy = R.slice().sort((a, b) => b.rc.buy - a.rc.buy);
    const w = total ? L.filter((x) => x.held).reduce((a, x) => a + (x.o.value || 0), 0) / total : 0;
    return { s, L, tot, camp, buy: tot ? R.reduce((a, x) => a + x.rc.buy * x.rc.tot, 0) / tot : null, dBuy, up: ups.length ? mean(ups) : null, dT: dTs.length ? mean(dTs) : null,
      hi: byBuy.length >= 2 ? byBuy[0] : null, lo: byBuy.length >= 2 ? byBuy[byBuy.length - 1] : null, w };
  }).sort((a, b) => (isNum(b.buy) ? b.buy : -1) - (isNum(a.buy) ? a.buy : -1));
  const size = (x) => Math.abs(x.dBuy || 0) + Math.abs(x.dT || 0) / 2 + Math.abs(x.dTot || 0) / 100;
  const moves = rows.filter((x) => (isNum(x.dBuy) && Math.abs(x.dBuy) >= 0.005) || (isNum(x.dT) && Math.abs(x.dT) >= 0.005) || (isNum(x.dTot) && x.dTot !== 0)).sort((a, b) => size(b) - size(a));
  const firstDay = rows.map((x) => { const H = ((data.research || {})[x.o.tk] || {}).recHist; return Array.isArray(H) && H.length ? H[0][0] : null; }).filter(Boolean).sort()[0] || null;
  return { rows, sectors, moves: moves.slice(0, 8), known: rows.some((x) => x.then), then, firstDay };
}
const ppTxt = (d) => sgn(d * 100, N1) + ' pp';
function opinionBody(days) {
  const S = opinionShifts(days);
  if (!S.rows.length) return '<p class="muted">Nog geen aanbevelingen van analisten opgehaald. ' + fixBtn('FINNHUB_KEY') + '</p>';
  const per = (OP_PERIODS.find((p) => Number(p[0]) === days) || ['', days + ' dagen'])[1];
  const bar = (c) => '<div class="rec-bar mini">' + [[c.sb, '#0B7A4B'], [c.b, '#5FB58A'], [c.h, '#C9CED6'], [c.s, '#E3A79C'], [c.ss, '#B4311F']].filter((p) => p[0]).map((p) => '<i style="flex:' + p[0] + ';background:' + p[1] + '"></i>').join('') + '</div>';
  const table = '<div class="tbl-wrap"><table class="tbl op-tbl"><thead><tr><th>Sector</th><th>Aanbevelingen</th><th class="num">Kopen</th><th class="num">Verschil</th><th class="num">Koersdoel</th><th class="num">Koersdoel verschil</th><th>Meest en minst positief</th></tr></thead><tbody>' +
    S.sectors.map((g) => '<tr><td class="co"><b>' + esc(sectorNl(g.s)) + '</b><span class="nm">' + esc(g.L.map((x) => x.o.tk).slice(0, 5).join(', ') + (g.L.length > 5 ? ' en ' + (g.L.length - 5) + ' meer' : '')) + '</span>' + (g.w >= 0.005 ? '<span class="sub">' + esc(P1.format(g.w) + ' van je beleggingen') + '</span>' : '') + '</td>' +
      '<td>' + (g.tot ? bar(g.camp) : '–') + '</td>' +
      '<td class="num">' + esc(isNum(g.buy) ? P1.format(g.buy) : '–') + (g.tot ? '<span class="sub">' + g.tot + ' analisten</span>' : '') + '</td>' +
      '<td class="num ' + tone(g.dBuy) + '">' + esc(isNum(g.dBuy) ? ppTxt(g.dBuy) : '–') + '</td>' +
      '<td class="num ' + tone(g.up) + '">' + esc(isNum(g.up) ? spct1(g.up) : '–') + '</td>' +
      '<td class="num ' + tone(g.dT) + '">' + esc(isNum(g.dT) ? spct1(g.dT) : '–') + '</td>' +
      '<td>' + (g.hi ? esc(g.hi.o.tk + ' ' + PCT0.format(g.hi.rc.buy) + ' · ' + g.lo.o.tk + ' ' + PCT0.format(g.lo.rc.buy)) + '<span class="sub">' + esc(Math.round((g.hi.rc.buy - g.lo.rc.buy) * 100) + ' pp uit elkaar') + '</span>' : '<span class="muted">één bedrijf</span>') + '</td></tr>').join('') +
    '</tbody></table></div>';
  const line = (x) => {
    const bits = [];
    if (isNum(x.dBuy) && x.then.rec) bits.push('kopen ' + PCT0.format(x.then.rec.buy) + ' → ' + PCT0.format(x.rc.buy) + ' (' + ppTxt(x.dBuy) + ')');
    if (isNum(x.dTot) && x.dTot) bits.push(sgn(x.dTot, NI) + ' analist' + (Math.abs(x.dTot) === 1 ? '' : 'en'));
    if (isNum(x.dT) && Math.abs(x.dT) >= 0.0005) bits.push('koersdoel ' + money(x.then.target, x.cur) + ' → ' + money(x.T, x.cur) + ' (' + spct1(x.dT) + ')');
    return bits.join(' · ');
  };
  const dir = (x) => (x.dBuy || 0) + (x.dT || 0) / 2;
  const moves = S.moves.length
    ? '<div class="alt-list">' + S.moves.map((x) => '<button type="button" class="alt" data-ticker="' + esc(x.held ? x.o.tk : '~' + x.o.tk) + '"><b>' + esc(x.o.tk) + ' <span class="muted small">' + esc(x.o.name) + ' · ' + esc(sectorNl(x.sector)) + '</span></b>' +
      '<span class="small ' + (dir(x) > 0 ? 'gain' : dir(x) < 0 ? 'loss' : '') + '">' + esc(line(x)) + '</span></button>').join('') + '</div>'
    : '<p class="muted">' + esc(S.known ? 'Geen veranderingen in de meningen in deze periode.'
      : days < 28 ? 'Nog niet genoeg dagen bewaard. De Worker houdt de mening van analisten sinds kort per dag bij' + (S.firstDay ? ' (vanaf ' + fD.format(ymd(S.firstDay)) + ')' : '') + '; kies tot die tijd 1 maand of 3 maanden.'
        : 'Voor deze periode zijn nog geen eerdere cijfers bekend.') + '</p>';
  return '<p class="small muted" style="margin-top:2px">Alle analisten van je posities en volglijst samen per sector, en wat er sinds ' + esc(fD.format(S.then)) + ' (' + esc(per) + ' terug) veranderde.</p>' + table +
    '<p class="small" style="margin-top:14px"><b>Grootste verschuivingen in ' + esc(per) + '</b></p>' + moves +
    '<p class="sub" style="margin-top:10px">Kopen: deel van alle analisten in die sector met koop of sterk kopen (bedrijven met meer analisten tellen zwaarder). Verschil: dezelfde bedrijven nu tegenover toen, in procentpunten. Meest en minst positief: hoe ver de bedrijven in één sector uit elkaar liggen. Finnhub ververst aanbevelingen per maand en koersdoelen vaker; verschillen per dag zie je pas als de Worker een paar dagen heeft bijgehouden. Geen beleggingsadvies.</p>';
}
function opinionTile() {
  const days = Number(xs.opPer || 30);
  return '<section class="tile pad full op-tile"><div class="plan-head"><h3>Meningen per sector en door de tijd</h3>' + segX('opPer', OP_PERIODS, String(days), 'Periode') + '</div>' + opinionBody(days) + '</section>';
}
function newsItems() {
  const held = new Set(M.companies.map((c) => c.tk)), watch = new Set(watchSyms()), out = [], seen = new Set();
  Object.entries(data.research || {}).forEach(([tk, r]) => (r.news || []).forEach((n) => { const kind = held.has(tk) ? 'mine' : watch.has(tk) ? 'watch' : null; if (kind) out.push(Object.assign({ tk, kind }, n)); }));
  ((data.marketNews && data.marketNews.items) || []).forEach((n) => out.push(Object.assign({ tk: null, kind: 'market' }, n)));
  return out.filter((n) => { const k = (n.url && n.url !== '#' ? n.url : n.headline) + '|' + n.tk; if (seen.has(k) || newsMuted(n)) return false; seen.add(k); return true; }).sort((a, b) => b.t - a.t);
}
// Toon van een artikel: de schatting zelf staat in js/15-toon.js (woordenlijst met gewichten, Engels en Nederlands).
// Het label vertelt in de tooltip welke woorden de toon bepaalden.
const toneTag = (n) => { const t = newsTone(n); return '<span class="ntone ' + t + '" title="' + esc(toneTitle(n)) + '">' + (t === 'pos' ? '\u25b2 Positief' : t === 'neg' ? '\u25bc Negatief' : '\u25cf Neutraal') + '</span>'; };
const newsTkTag = (n) => (n.tk ? '<span class="tag' + (n.kind === 'watch' ? '' : ' gain') + '">' + esc(n.tk) + '</span> ' : '<span class="tag">Markt</span> ');
const newsItemHtml = (n) => '<a class="news-i" href="' + esc(n.url) + '" target="_blank" rel="noopener"><span class="news-m">' + newsTkTag(n) + toneTag(n) + esc(fDT.format(n.t) + (n.source ? ', ' + n.source : '')) + '</span>' +
  '<span class="news-t">' + esc(n.headline) + '</span>' + (n.summary ? '<span class="news-s">' + esc(n.summary) + '</span>' : '') + '</a>';
function newsListTile() {
  const f = xs.newsF;
  const all = newsItems().filter((n) => f === 'all' || n.kind === f);
  // Eerst berichten over hetzelfde onderwerp samenvoegen (js/21-nieuwsplus.js), dan hoogstens 40 bundels tonen
  const cls = (typeof newsClusters === 'function' ? newsClusters(all) : all.map((n) => ({ lead: n, items: [n], sources: [n.source] }))).slice(0, 40);
  const items = cls.flatMap((c) => c.items);
  const bundled = items.length - cls.length;
  return '<section class="tile pad span-2 news-tile"><div class="plan-head"><h3>Nieuws</h3>' + segX('newsF', [['all', 'Alles'], ['mine', 'Mijn aandelen'], ['watch', 'Volglijst'], ['market', 'Markt']], f, 'Nieuws filteren') + '</div>' +
    (items.length ? '<p class="small muted" style="margin:2px 0 6px">' + (() => { const c = { pos: 0, neg: 0, neu: 0 }; items.forEach((n) => { c[newsTone(n)]++; }); return esc(c.pos + ' positief, ' + c.neg + ' negatief, ' + c.neu + ' neutraal' + (bundled > 0 ? ', ' + bundled + ' gebundeld' : '')); })() + '</p>' +
      '<div class="news">' + cls.map((c) => newsClusterHtml(c, newsItemHtml)).join('') + '</div>'
      : '<p class="muted">' + (f === 'market' && !data.marketNews ? 'Marktnieuws komt van Finnhub en wordt buiten de meettijden opgehaald.' : 'Geen nieuws in deze selectie.') + '</p>') +
    '<p class="sub" style="margin-top:8px">Koppen en links van Finnhub (of als reserve Polygon, Marketaux of Alpha Vantage): per aandeel de laatste tien dagen, en algemeen marktnieuws. Het artikel opent bij de bron. Berichten met bijna dezelfde kop staan samen onder "x bronnen". Positief of negatief is een schatting uit woorden in de kop en samenvatting (zoals "stijgt", "beats", "daalt", "downgrade"), geen oordeel van de bron; lees bij twijfel het artikel.</p></section>';
}
function analystTableTile() {
  const rows = analystRows().sort((a, b) => (b.rc ? b.rc.buy : 0) - (a.rc ? a.rc.buy : 0));
  if (!rows.length) return fullT('Analisten per bedrijf', '<p class="muted">Nog geen aanbevelingen van analisten opgehaald. ' + fixBtn('FINNHUB_KEY') + '</p>');
  return '<section class="tile pad full"><h3>Analisten per bedrijf</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bedrijf</th><th>Aanbevelingen</th><th class="num">Kopen</th><th class="num">Trend</th><th class="num">Koersdoel</th><th class="num">Betrouwbaarheid</th><th class="num">Nieuws</th></tr></thead><tbody>' +
    rows.map((x) => { const rec = x.rc && x.rc.rec;
      const bar = rec ? '<div class="rec-bar mini">' + [[rec.sb, '#0B7A4B'], [rec.b, '#5FB58A'], [rec.h, '#C9CED6'], [rec.s, '#E3A79C'], [rec.ss, '#B4311F']].filter((p) => p[0]).map((p) => '<i style="flex:' + p[0] + ';background:' + p[1] + '"></i>').join('') + '</div>' : '–';
      return '<tr class="rowlink" data-ticker="' + esc(x.held ? x.o.tk : '~' + x.o.tk) + '"><td class="co"><b>' + esc(x.o.tk) + '</b> ' + (x.held ? '' : '<span class="tag">Volglijst</span>') + '<span class="nm">' + esc(x.o.name) + '</span></td><td>' + bar + '</td>' +
        '<td class="num">' + esc(x.rc ? P1.format(x.rc.buy) : '–') + (x.rc ? '<span class="sub">' + x.rc.tot + ' analisten</span>' : '') + '</td>' +
        '<td class="num ' + tone(x.rc && x.rc.trend) + '">' + esc(x.rc && isNum(x.rc.trend) ? sgn(x.rc.trend * 100, N1) + ' pp' : '–') + '</td>' +
        '<td class="num ' + tone(x.up) + '">' + esc(isNum(x.up) ? spct1(x.up) : '–') + '</td>' +
        '<td class="num">' + (x.rel ? '<span class="lvl" style="--k:' + Math.max(1, Math.min(7, 8 - Math.round(x.rel.score * 0.7))) + '">' + x.rel.score + '</span><span class="sub">' + esc(x.rel.word) + '</span>' : '–') + '</td>' +
        '<td class="num">' + esc(x.sent && isNum(x.sent.bull) ? P1.format(x.sent.bull) + ' positief' : '–') + '</td></tr>'; }).join('') +
    '</tbody></table></div><p class="sub" style="margin-top:8px">Kopen: deel van de analisten met koop of sterk kopen. Trend: verschil met enkele maanden eerder. Koersdoel: gemiddeld koersdoel tegenover de koers nu. Betrouwbaarheid (0–10): zie de uitleg hiernaast.</p></section>';
}
function reliabilityTile() {
  const rows = analystRows().filter((x) => x.rel).sort((a, b) => b.rel.score - a.rel.score);
  return '<section class="tile pad"><h3>Hoe betrouwbaar zijn de analisten?</h3>' +
    (rows.length ? '<div class="why-list">' + rows.slice(0, 8).map((x) => '<details class="why-d"><summary><span class="lvl" style="--k:' + Math.max(1, Math.min(7, 8 - Math.round(x.rel.score * 0.7))) + '">' + x.rel.score + '</span><span class="nm"><b>' + esc(x.o.tk) + '</b> ' + esc(x.rel.word) + '</span><span></span></summary>' +
      '<div class="why-in"><ul class="why">' + x.rel.why.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' + (x.rel.hits ? '' : '<p class="sub" style="margin-top:6px">Of koersdoelen uitkomen, meet de tracker zodra er drie maanden koersdoelgeschiedenis is.</p>') + '</div></details>').join('') + '</div>' : '<p class="muted">Nog geen gegevens van analisten.</p>') +
    '<p class="sub" style="margin-top:8px">Score van 0 tot 10 uit: hoe dicht de winstverwachtingen bij de werkelijke kwartaalcijfers lagen, hoeveel analisten het bedrijf volgen, hoe eens ze het zijn, hoe ver koersdoelen uiteenlopen en of eerdere koersdoelen de goede kant op wezen. Een hoge score betekent dat de verwachtingen goed onderbouwd lijken, niet dat ze uitkomen.</p></section>';
}
function insiderTile() {
  const keys = M.companies.filter((c) => !isFundC(c)).map((c) => c.tk).concat(watchSyms());
  const all = [];
  const per = keys.map((tk) => {
    const r = (data.research || {})[tk]; const ins = (r && r.insider) || [];
    ins.forEach((x) => all.push(Object.assign({ tk }, x)));
    const ps = ins.filter((x) => x.code === 'P' || x.code === 'S');
    if (!ins.length) return null;
    return { tk, net: sum(ps.map((x) => (x.change || 0) * (x.price || 0))), buys: ps.filter((x) => x.code === 'P').length, sells: ps.filter((x) => x.code === 'S').length, last: ins[0] };
  }).filter(Boolean).sort((a, b) => b.net - a.net);
  if (!per.length) return fullT('Insiderhandel', '<p class="muted">Nog geen meldingen van insiderhandel opgehaald (Finnhub, Amerikaanse bedrijven). ' + fixBtn('FINNHUB_KEY') + '</p>');
  const mx = Math.max(1, ...per.map((x) => Math.abs(x.net)));
  all.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return '<section class="tile pad full"><h3>Insiderhandel, laatste 6 maanden</h3><div class="ins-grid"><div class="hbars cmp">' + per.map((x) =>
    '<button type="button" class="r" data-ticker="' + esc(M.byTk.has(x.tk) ? x.tk : '~' + x.tk) + '" data-tip="' + esc(x.tk + ': ' + x.buys + ' kopen, ' + x.sells + ' verkopen') + '"><span class="tk">' + esc(x.tk) + '</span><span class="track"><span class="mid"></span>' +
    (x.net ? '<span class="' + (x.net < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(x.net) / mx * 50).toFixed(1) + '%"></span>' : '') + '</span><span class="' + tone(x.net) + '" style="text-align:right;font-weight:600">' + esc(x.net ? bigNum(x.net, 'USD') : '–') + '</span></button>').join('') + '</div>' +
    '<div class="tx-list">' + all.slice(0, 10).map((x) => '<div class="tx"><span class="tag' + (x.code === 'P' ? ' gain' : x.code === 'S' ? ' loss' : '') + '">' + esc(INSIDER_CODES[x.code] || x.code || '?') + '</span><span class="tx-m"><b>' + esc(x.tk + ' · ' + (x.name || '')) + '</b><span class="sub">' + esc(x.date || '') + '</span></span>' +
      '<span class="tx-v">' + esc(isNum(x.change) ? sgn(x.change, NI) + ' st.' : '') + '</span></div>').join('') + '</div></div>' +
    '<p class="sub" style="margin-top:8px">Balk: waarde van aankopen min verkopen door bestuurders (in dollars). Verkopen gebeuren vaak volgens vaste plannen of voor belasting; kopen met eigen geld zegt meestal meer.</p></section>';
}
function renderNews() {
  const host = mode === 'm' ? $('m-news-body') : $('news-body');
  if (!host) return;
  const F = FEAT();
  const off = !F.has.finnhub && !F.has.av && !demo;
  // Componentenversie (js/nieuws-preact.js) als die geladen is; anders deze HTML-versie
  if (window.NewsView && window.NewsView.ok && !off) { window.NewsView.draw(host); return; }
  if (window.NewsView && window.NewsView.ok) window.NewsView.clear(host);
  if (off) { host.innerHTML = '<div class="grid wide">' + offTile('Nieuws en analisten', 'Zet Finnhub aan (gratis sleutel) bij Koppelingen voor nieuws per aandeel, marktnieuws, analisten en insiderhandel.', 'FINNHUB_KEY') + '</div>'; return; }
  host.innerHTML = '<div class="grid wide">' + newsListTile() + missedTile() + '</div>' +
    '<div class="grid wide" style="margin-top:16px">' + suggestTile() + newsToolsTile() + '</div>' +
    '<div class="section-head"><h2>Analisten</h2><p class="muted small">Aanbevelingen, koersdoelen en hoe betrouwbaar ze zijn</p></div><div class="grid wide">' + analystTableTile() + reliabilityTile() + opinionTile() + earnSeasonTile() + analystScoreTile() + '</div>' +
    '<div class="section-head"><h2>Insiders</h2><p class="muted small">Kopen en verkopen bestuurders zelf?</p></div><div class="grid wide">' + insiderTile() + '</div>';
}

// ---------- Volglijst: suggesties om te volgen ----------
function watchSuggestions() {
  const have = new Set(M.companies.map((c) => normTk(c.tk)).concat(watchSyms(), M.mk.ok ? Object.values((data.market && data.market.symbols) || {}) : []));
  const cand = new Map();
  const add = (sym, why, w, name) => { if (!sym || have.has(sym) || !/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(sym)) return; const o = cand.get(sym) || { sym, why: new Set(), w: 0, name: name || '' }; o.why.add(why); o.w += w; if (!o.name && name) o.name = name; cand.set(sym, o); };
  if (M.mk.ok) M.companies.forEach((c) => M.mk.peersOf(c.tk).forEach((s) => { const p = M.mk.prof(s); add(s, 'lijkt op ' + c.tk, 2 + (c.weight || 0) * 5, p && p.name); }));
  const O = overlapModel();
  O.per.forEach((list, tk) => { const eurV = sum(list.map((x) => x.eur)); if (eurV > 0) add(tk, 'zit al voor ' + eur(eurV) + ' in je fondsen', eurV / Math.max(1, M.totalValue || 1) * 40, ''); });
  (data.etf ? Object.values(data.etf) : []).forEach((E) => (E.rows || []).forEach((r) => { const k = normTk(r[0]); if (cand.has(k) && !cand.get(k).name) cand.get(k).name = String(r[1] || '').replace(/\b(INC|CORP|CLASS [A-C]|LTD)\b\.?/g, '').trim(); }));
  return [...cand.values()].sort((a, b) => b.w - a.w);
}
function watchSuggestTile() {
  if (!M) return '';
  const all = watchSuggestions();
  if (!all.length) return '';
  const n = xs.suggN || 10;
  const off = all.length > n ? (xs.suggOff || 0) % all.length : 0;
  const L = all.slice(off, off + n).concat(off + n > all.length && all.length > n ? all.slice(0, Math.min(n, off + n - all.length)) : []);
  const item = (o) => {
    const p = M.mk.ok ? M.mk.prof(o.sym) : null;
    return tpl`<div class="alt"><b>${o.sym} <span class="muted small">${(p && p.name) || o.name || ''}</span></b>
      <span class="small muted">${[...o.why].slice(0, 2).join('; ')}</span>
      ${p && isNum(p.change) ? tpl`<span class="small ${tone(p.change)}">${spct(p.change / 100)} laatste dag</span>` : null}
      <button type="button" class="btn ghost" data-xa="watch-add" data-k="${o.sym}">Volgen</button></div>`;
  };
  return String(tpl`<section class="tile pad watch-sugg"><div class="plan-head"><h3>Suggesties om te volgen</h3>
      <span class="plan-actions">${all.length > n ? tpl`<button type="button" class="btn ghost" data-xa="watch-next">Andere suggesties</button>` : null}
      ${all.length > 10 ? tpl`<button type="button" class="btn ghost" data-xa="watch-more">${n === 20 ? 'Minder tonen' : 'Meer tonen'}</button>` : null}</span></div>
    <p class="small muted">${L.length} van ${all.length} suggesties</p><p class="small watch-status" role="status" aria-live="polite"></p><div class="alt-list">${L.map(item)}</div>
    <p class="sub" style="margin-top:8px">Vergelijkbare bedrijven van je posities (FMP) en de grootste bedrijven in je indexfondsen die je nog niet los volgt. Volgen is gratis en verandert niets aan je portefeuille.</p></section>`);
}

// ---------- Klikken en invoer voor de uitbreidingen ----------
function rerenderAfterX() {
  refresh('plan', 'news', 'valuation');
  if (ui.detail && hasView(ui.detail)) renderDetail(false);
}
document.addEventListener('click', async (e) => {
  if (!e.target.closest) return;
  const seg = e.target.closest('[data-x] button[data-k]');
  if (seg) {
    const key = seg.parentElement.dataset.x, k = seg.dataset.k;
    if (key === 'amt') plan.amount = Number(k); else if (key === 'taxYear') xs.taxYear = Number(k); else xs[key] = k;
    markFresh(); rerenderAfterX(); return;
  }
  const b = e.target.closest('[data-xa]');
  if (!b || b.tagName === 'INPUT') return;
  const a = b.dataset.xa;
  if (a === 'note-edit') { const box = b.closest('.note'); box.querySelector('.note-ed').hidden = false; b.hidden = true; box.querySelector('textarea').focus(); return; }
  if (a === 'note-cancel') { const box = b.closest('.note'); box.querySelector('.note-ed').hidden = true; box.querySelector('[data-xa="note-edit"]').hidden = false; return; }
  if (a === 'note-save') {
    const box = b.closest('.note'); const st = box.querySelector('.note-st'); const txt = box.querySelector('textarea').value.trim().slice(0, 500);
    const next = Object.assign({}, notesMap()); if (txt) next[b.dataset.k] = txt; else delete next[b.dataset.k];
    st.textContent = 'Bezig met opslaan…';
    try { await saveSettings({ notes: next }); toastOk(txt ? 'Notitie opgeslagen.' : 'Notitie verwijderd.'); rerenderAll(); }
    catch (err) { const t = foutTekst('De notitie kon niet worden opgeslagen', err, 'Je notities staan in je Worker; controleer bij Instellingen je toegangscode en probeer het opnieuw.'); st.textContent = t; st.className = 'small note-st loss'; toastErr(t); }
    return;
  }
  if (a === 'box3-copy' || a === 'box3-csv') {
    const B = box3Model(xs.taxYear); const st = $('box3-status');
    if (a === 'box3-copy') {
      try { await navigator.clipboard.writeText(box3Text(B)); if (st) st.textContent = 'Gekopieerd.'; toastOk('De cijfers voor box 3 staan op je klembord.'); }
      catch (err) { const t = 'Kopiëren lukte niet: deze browser geeft de site geen toegang tot het klembord. Selecteer de tekst hieronder en kopieer hem zelf.'; if (st) st.textContent = t; toastErr(t); }
    } else {
      download('dividend-' + B.Y + '.csv', csvOf(['datum', 'ticker', 'netto_eur', 'bruto_eur', 'bronbelasting_eur', 'valuta', 'methode'], B.divs.map((x) => [x.d.date, x.d.ticker, x.d.amount, x.gross.toFixed(2), x.tax.toFixed(2), x.cur, x.how])));
      toastOk('dividend-' + B.Y + '.csv is gedownload.');
    }
    return;
  }
  if (a === 'ws-share' || a === 'ws-png' || a === 'ws-mail') { shareWeek(a.slice(3), b); return; }
  if (a === 'watch-add') {
    const sym = b.dataset.k, tile = b.closest('.watch-sugg'), st = tile && tile.querySelector('.watch-status');
    if (watchSyms().includes(sym)) return;
    if (watchSyms().length >= 30) { if (st) { st.textContent = 'Je volglijst zit vol (maximaal 30 aandelen).'; st.className = 'small watch-status loss'; } return; }
    b.disabled = true; b.textContent = 'Bezig…';
    setWatchlist((cur) => (cur.includes(sym) || cur.length >= 30 ? cur : cur.concat([sym])), st, sym + ' staat op je volglijst.')
      .catch(() => { b.disabled = false; b.textContent = 'Opnieuw'; });
    return;
  }
  if (a === 'acct-add') { const id = Math.random().toString(36).slice(2, 10); saveAccounts(accts().concat([{ id, name: 'Nieuwe rekening', broker: '', cash: 0, updated: new Date().toISOString().slice(0, 10), holdings: [] }]), null); return; }
  const f = b.closest('.acct-form');
  if (!f) return;
  const st = f.querySelector('.acct-st');
  if (a === 'acct-addrow') { f.querySelector('.h-rows').insertAdjacentHTML('beforeend', hRow({})); f.querySelector('.h-rows .h-row:last-child input').focus(); }
  else if (a === 'acct-rmrow') b.closest('.h-row').remove();
  else if (a === 'acct-save') { const o = readAcctForm(f); saveAccounts(accts().map((x) => (x.id === o.id ? o : x)), st); }
  else if (a === 'acct-del') { if (confirm('Deze rekening uit het overzicht verwijderen?')) saveAccounts(accts().filter((x) => x.id !== f.dataset.acct), st); }
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.matches && el.matches('input[data-xa="ws-hide"]')) { xs.wsHide = el.checked; const h = el.closest('.wshare'); if (h) drawWeekShare(h.parentElement); return; }
  if (el.matches && el.matches('input[type="file"][data-xa="acct-csv"]') && el.files[0]) {
    const f = el.closest('.acct-form'); const st = f.querySelector('.acct-st');
    try {
      const P = parseAccountCsv(await el.files[0].text());
      f.querySelector('.h-rows').innerHTML = P.holdings.map(hRow).join('');
      if (P.cash) f.querySelector('[data-a="cash"]').value = Math.round(P.cash * 100) / 100;
      f.querySelector('[data-a="updated"]').value = new Date().toISOString().slice(0, 10);
      st.textContent = P.holdings.length + ' posities ingelezen. Controleer ze en kies Opslaan.'; st.className = 'small plan-status acct-st gain';
    } catch (err) { st.textContent = foutTekst('Het CSV-bestand kon niet worden ingelezen', err, 'Exporteer de posities opnieuw bij je broker en kies het onbewerkte CSV-bestand.'); st.className = 'small plan-status acct-st loss'; }
    el.value = '';
  }
});
