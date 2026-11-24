/* Investeringstracker – Onderzoek per bedrijf, volglijst, wat als, jaaroverzicht, mijlpalen, valuta en inflatie
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Onderzoek per bedrijf: nieuws, analisten, insiders, bedrijfscijfers ----------
const FEAT = () => (data && data.features) || { flags: {}, has: {} };
// fix: de sleutel of schakelaar die deze tegel vult (zie fixBtn in js/21-handig.js); zonder fix een knop naar Koppelingen
const offTile = (title, text, fix) => '<section class="tile pad"><h3>' + esc(title) + '</h3><p class="muted">' + esc(text) + '</p>' +
  (demo ? '' : fix ? fixBtn(fix) : '<button type="button" class="linklike small" data-act="links">Koppelingen openen</button>') + '</section>';
const srcOf = (R, k) => (R && R.src && R.src[k]) || 'finnhub';
// Namen van de bronnen die de Worker in R.src zet (zie altTask en avTask in de Worker)
const RS_SRC_NAMES = { finnhub: 'Finnhub', av: 'Alpha Vantage', polygon: 'Polygon (Massive)', marketaux: 'Marketaux', sec: 'de SEC', fmp: 'FMP', gdelt: 'GDELT' };
const srcNameOf = (R, k) => RS_SRC_NAMES[srcOf(R, k)] || 'Finnhub';
const INSIDER_CODES = { AQ: 'Verkregen', DS: 'Afgestaan', P: 'Koop', S: 'Verkoop', M: 'Opties omgezet', A: 'Toegekend', F: 'Ingehouden (belasting)', G: 'Geschonken', D: 'Teruggegeven', C: 'Omgezet', X: 'Opties omgezet' };
const bigNum = (v, unit) => {
  if (!isNum(v)) return '–';
  const cur = unit && unit !== 'USD' ? ' ' + unit : ' $';
  const a = Math.abs(v), sg = v < 0 ? '−' : '';
  if (a >= 1e12) return sg + N1.format(a / 1e12) + ' bln' + cur;
  if (a >= 1e9) return sg + N1.format(a / 1e9) + ' mld' + cur;
  if (a >= 1e6) return sg + NI.format(a / 1e6) + ' mln' + cur;
  return sg + NI.format(a) + cur;
};

function companyResearch(c) {
  const F = FEAT();
  const isFund = ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk));
  if (isFund) return ['<section class="tile pad"><h3>Nieuws en cijfers</h3><p class="muted">Voor fondsen zijn er geen bedrijfsnieuws, analisten of jaarcijfers; kijk bij de bedrijven erin (Plannen > Werkelijke spreiding).</p></section>'];
  const R = (data.research || {})[c.tk];
  const tiles = [];
  // Nieuws komt van Finnhub, Polygon, Marketaux of Alpha Vantage; analisten ook van FMP; kwartaalwinst en insiders ook van de SEC
  const newsOff = !F.has.finnhub && !F.has.polygon && !F.has.mx && !F.has.av && !(F.flags && F.flags.gdelt !== false) && !demo;
  const opinionOff = newsOff && !F.has.fmp && !F.has.sec;
  const insiderOff = !F.has.finnhub && !F.has.av && !F.has.sec && !demo;
  const wait = 'De gegevens worden opgehaald buiten de handelsuren; kom straks terug.';
  // Nieuws
  if (newsOff) tiles.push(offTile('Nieuws', 'Zet Finnhub aan (gratis sleutel) om het laatste nieuws per aandeel te zien. Polygon en Marketaux werken ook, als reserve.', 'FINNHUB_KEY'));
  else if (!R) tiles.push(offTile('Nieuws', wait));
  else {
    const news = R.news || [];
    tiles.push('<section class="tile pad"><h3>Nieuws' + ageTagOf(R, AGE_LIMIT.news) + '</h3>' + (news.length ? '<div class="news">' + news.map((n) =>
      '<a class="news-i" href="' + esc(safeUrl(n.url)) + '" target="_blank" rel="noopener"><span class="news-m">' + toneTag(n) + esc(fD.format(n.t) + (n.source ? ', ' + n.source : '')) + '</span><span class="news-t">' + esc(n.headline) + '</span></a>').join('') + '</div>'
      : '<p class="muted">Geen nieuws in de afgelopen tien dagen' + (c.cur && c.cur !== 'USD' ? ' (de nieuwsbronnen hebben vooral Noord-Amerikaanse bedrijven)' : '') + '.</p>') +
      '<p class="sub" style="margin-top:8px">Koppen en links van ' + srcNameOf(R, 'news') + '; het artikel opent bij de bron.</p></section>');
  }
  // Analisten
  if (opinionOff) tiles.push(offTile('Wat analisten vinden', 'Zet Finnhub aan (gratis sleutel) om aanbevelingen van analisten en kwartaalverrassingen te zien.', 'FINNHUB_KEY'));
  else if (R) {
    const rec = (R.rec || [])[0], old = (R.rec || [])[3] || (R.rec || [])[R.rec ? R.rec.length - 1 : 0];
    const parts = rec ? [['Sterk kopen', rec.sb, '#0B7A4B'], ['Kopen', rec.b, '#5FB58A'], ['Houden', rec.h, '#C9CED6'], ['Verkopen', rec.s, '#E3A79C'], ['Sterk verkopen', rec.ss, '#B4311F']] : [];
    const tot = sum(parts.map((x) => x[1] || 0));
    const buyShare = (r) => { const t = (r.sb || 0) + (r.b || 0) + (r.h || 0) + (r.s || 0) + (r.ss || 0); return t ? ((r.sb || 0) + (r.b || 0)) / t : null; };
    const trend = rec && old && old !== rec && isNum(buyShare(old)) ? buyShare(rec) - buyShare(old) : null;
    const eps = (R.eps || []).slice().reverse();
    // De SEC geeft alleen de werkelijke winst per aandeel, zonder verwachting: dan tonen we de winst zelf
    const epsOnly = eps.length > 0 && eps.every((x) => !isNum(x.estimate));
    const epsV = (x) => (epsOnly ? x.actual : x.pct) || 0;
    const mx = Math.max(1e-9, ...eps.map((x) => Math.abs(epsV(x))));
    tiles.push('<section class="tile pad"><h3>Wat analisten vinden' + ageTagOf(R, AGE_LIMIT.research) + '</h3>' +
      (rec && tot ? '<div class="rec-bar" role="img" aria-label="' + esc(parts.map((x) => x[0] + ' ' + x[1]).join(', ')) + '">' + parts.filter((x) => x[1]).map((x) =>
          '<i style="flex:' + x[1] + ';background:' + x[2] + '" data-tip="' + esc(x[0] + ': ' + x[1]) + '"></i>').join('') + '</div>' +
        '<div class="rec-leg">' + parts.map((x) => '<span><i style="background:' + x[2] + '"></i>' + esc(x[0]) + ' <b>' + (x[1] || 0) + '</b></span>').join('') + '</div>' +
        '<p class="sub" style="margin-top:6px">' + esc(P1.format(buyShare(rec)) + ' van ' + tot + ' analisten adviseert kopen (' + fMonY.format(ymd(rec.period)) + ')') +
        (isNum(trend) ? esc(Math.abs(trend) < 0.01 ? ', gelijk aan enkele maanden eerder.' : ', ' + (trend > 0 ? 'meer' : 'minder') + ' dan enkele maanden eerder (' + spct1(trend).replace('%', ' pp').replace('+', '+') + ').') : '.') + '</p>'
        : '<p class="muted">Geen aanbevelingen gevonden.</p>') +
      targetBlock(R, c) + sentBlock(R) +
      (eps.length ? '<h3 style="margin-top:14px">' + (epsOnly ? 'Winst per aandeel per kwartaal' : 'Kwartaalcijfers tegenover verwachting') + '</h3><div class="eps">' + eps.map((x) =>
        '<div class="eps-i"><span class="muted small">' + esc(x.period ? fMonY.format(ymd(x.period)) : '') + '</span>' +
        '<span class="eps-b"><i class="' + (epsV(x) < 0 ? 'neg' : 'pos') + '" style="height:' + (Math.abs(epsV(x)) / mx * 50).toFixed(0) + '%"></i></span>' +
        (epsOnly
          ? '<b class="' + tone(x.actual) + '">' + esc(isNum(x.actual) ? '$' + N2.format(x.actual) : '–') + '</b><span class="muted small"></span>'
          : '<b class="' + tone(x.pct) + '">' + esc(isNum(x.pct) ? spct1(x.pct / 100) : '–') + '</b><span class="muted small">' + esc(isNum(x.actual) ? N2.format(x.actual) + (isNum(x.estimate) ? ' / ' + N2.format(x.estimate) : '') : '') + '</span>') + '</div>').join('') + '</div>' +
        '<p class="sub" style="margin-top:6px">' + esc(epsOnly ? 'Verwaterde winst per aandeel uit de kwartaalverslagen, via ' + srcNameOf(R, 'eps') + '; deze bron geeft geen verwachting van analisten.' : 'Winst per aandeel: werkelijk / verwacht, en het verschil.') + '</p>' : '') + '</section>');
  }
  // Analisten door de tijd en kwartaalcijfers die eraan komen (js/21-nieuwsplus.js)
  if (R && typeof revisionTile === 'function') tiles.push(revisionTile(c));
  if (typeof earnPreviewTile === 'function') { const ep = earnPreviewTile(c); if (ep) tiles.push(ep); }
  // Insiders
  if (insiderOff) tiles.push(offTile('Insiderhandel', 'Zet Finnhub aan (gratis sleutel) of vul bij Koppelingen een e-mailadres in voor SEC EDGAR om te zien of bestuurders zelf aandelen kopen of verkopen.', 'FINNHUB_KEY'));
  else if (R) {
    if ((R.denied || []).includes('insider')) tiles.push(offTile('Insiderhandel', 'Insiderhandel zit niet in je Finnhub-abonnement. De SEC kan het aanvullen (gratis, alleen een e-mailadres).', 'SEC_CONTACT'));
    else {
      const ins = R.insider || [];
      // Alpha Vantage kent alleen verkregen en afgestaan; kopen en toekenning zijn daar niet te scheiden
      const avIns = srcOf(R, 'insider') === 'av';
      const BUY = avIns ? 'AQ' : 'P', SELL = avIns ? 'DS' : 'S';
      const ps = ins.filter((x) => x.code === BUY || x.code === SELL);
      const netSh = sum(ps.map((x) => x.change || 0));
      const netVal = sum(ps.map((x) => (x.change || 0) * (x.price || 0)));
      const buyers = new Set(ins.filter((x) => x.code === BUY).map((x) => x.name)).size, sellers = new Set(ins.filter((x) => x.code === SELL).map((x) => x.name)).size;
      tiles.push('<section class="tile pad"><h3>Insiderhandel' + ageTagOf(R, AGE_LIMIT.research) + '</h3>' + (ins.length ? kvList([
          [avIns ? 'Laatste 6 maanden, verkregen en afgestaan' : 'Laatste 6 maanden, kopen en verkopen', ps.length ? (netSh >= 0 ? (avIns ? 'per saldo verkregen' : 'per saldo gekocht') : (avIns ? 'per saldo afgestaan' : 'per saldo verkocht')) : 'geen', ps.length ? (netSh >= 0 ? 'gain' : 'loss') : ''],
          ['Waarde (koop min verkoop)', ps.length ? bigNum(netVal, 'USD') : '–', tone(netVal)],
          ['Kopers en verkopers', buyers + ' en ' + sellers],
        ]) + '<div class="tx-list" style="margin-top:8px">' + ins.slice(0, 6).map((x) =>
          '<div class="tx"><span class="tag' + (x.code === BUY ? ' gain' : x.code === SELL ? ' loss' : '') + '">' + esc(INSIDER_CODES[x.code] || x.code || '?') + '</span>' +
          '<span class="tx-m"><b>' + esc(x.name || '') + '</b><span class="sub">' + esc(x.date ? fD.format(ymd(x.date)) + ' ' + x.date.slice(0, 4) : '') + '</span></span>' +
          '<span class="tx-v">' + esc(isNum(x.change) ? sgn(x.change, NI) + ' st.' : '') + (isNum(x.price) && x.price > 0 ? '<span class="sub">à $' + esc(N2.format(x.price)) + '</span>' : '') + '</span></div>').join('') + '</div>' +
        '<p class="sub" style="margin-top:8px">Uit meldingen bij de toezichthouder' + (srcOf(R, 'insider') === 'sec' ? ' (Form 4, rechtstreeks van de SEC)' : '') + (avIns ? ', via Alpha Vantage. Verkregen omvat ook toegekende aandelen en opties, dus niet alleen kopen met eigen geld' : '') + '. Verkopen gebeuren vaak volgens vaste plannen of voor belasting; kopen met eigen geld zegt meestal meer.</p>'
        : '<p class="muted">Geen meldingen in de afgelopen 6 maanden.</p>') + '</section>');
    }
  }
  // Bedrijfscijfers
  const Fin = (data.fin || {})[c.tk];
  if (!F.has.sec && !demo) tiles.push(offTile('Bedrijfscijfers', 'Vul bij Koppelingen een e-mailadres in voor SEC EDGAR (gratis) om omzet en winst over meerdere jaren te zien.', 'SEC_CONTACT'));
  else if (!Fin) tiles.push(offTile('Bedrijfscijfers', wait));
  else if (Fin.none) tiles.push('<section class="tile pad"><h3>Bedrijfscijfers</h3><p class="muted">' + esc(Fin.none) + '</p></section>');
  else tiles.push(finTile(Fin));
  const fl = companyFilingsTile(String(M.mk.ok ? M.mk.sym(c.tk) : c.tk).replace(/^~/, ''));
  if (fl) tiles.push(fl);
  return tiles;
}

function finTile(Fin) {
  const S = Fin.series || {};
  const rev = new Map((S.rev && S.rev.rows) || []), net = new Map((S.net && S.net.rows) || []), op = new Map((S.op && S.op.rows) || []), eps = new Map((S.eps && S.eps.rows) || []);
  const years = [...new Set([...rev.keys(), ...net.keys()])].sort((a, b) => a - b).slice(-6);
  const unit = (S.rev && S.rev.unit) || (S.net && S.net.unit) || 'USD';
  const mx = Math.max(1, ...years.map((y) => Math.max(Math.abs(rev.get(y) || 0), Math.abs(net.get(y) || 0))));
  const ly = years[years.length - 1], py = years[years.length - 2];
  const growth = ly && py && rev.get(py) ? rev.get(ly) / rev.get(py) - 1 : null;
  const margin = ly && rev.get(ly) && isNum(net.get(ly)) ? net.get(ly) / rev.get(ly) : null;
  return '<section class="tile pad"><h3>Bedrijfscijfers per jaar' + ageTagOf(Fin, AGE_LIMIT.sec) + '</h3>' +
    '<div class="fin-bars" role="img" aria-label="Omzet en winst per jaar">' + years.map((y) => {
      const r = rev.get(y), n = net.get(y);
      return '<div class="fin-y" data-tip="' + esc(y + ': omzet ' + bigNum(r, unit) + ', winst ' + bigNum(n, unit) + (isNum(r) && isNum(n) && r ? ' (marge ' + P1.format(n / r) + ')' : '')) + '">' +
        '<span class="fin-c"><i class="rev" style="height:' + (Math.abs(r || 0) / mx * 100).toFixed(1) + '%"></i><i class="' + ((n || 0) < 0 ? 'neg' : 'net') + '" style="height:' + (Math.abs(n || 0) / mx * 100).toFixed(1) + '%"></i></span>' +
        '<span class="muted small">' + y + '</span></div>';
    }).join('') + '</div>' +
    '<div class="legend" style="margin-top:8px"><span><i style="background:#8FAEF0"></i>Omzet</span><span><i style="background:' + C.gain + '"></i>Nettowinst</span></div>' +
    '<div style="margin-top:10px">' + kvList([
      ['Omzet ' + (ly || ''), bigNum(rev.get(ly), unit)],
      ['Groei omzet t.o.v. ' + (py || 'vorig jaar'), isNum(growth) ? spct1(growth) : '–', tone(growth)],
      ['Nettowinst en marge', ly ? bigNum(net.get(ly), unit) + (isNum(margin) ? ' (' + P1.format(margin) + ')' : '') : '–', tone(net.get(ly))],
      ['Bedrijfsresultaat', ly && isNum(op.get(ly)) ? bigNum(op.get(ly), unit) : '–'],
      ['Winst per aandeel (verwaterd)', ly && isNum(eps.get(ly)) ? N2.format(eps.get(ly)) + (unit === 'USD' ? ' $' : ' ' + unit) : '–'],
    ]) + '</div><p class="sub" style="margin-top:8px">Kalenderjaren uit de jaarverslagen bij de SEC (' + esc(unit) + '). Bijgewerkt ' + esc(Fin.updated || '') + '.</p></section>';
}


// Koersdoel van analisten tegenover de koers nu
function targetBlock(R, c) {
  const T = R.target;
  const price = isNum(c.priceNative) ? c.priceNative : null;
  const cur = c.cur || 'USD';
  // Eigen koersdoel (zie 26-posities.js) ernaast, zodat je je eigen aanname naast die van analisten ziet
  const mine = typeof myTargetOf === 'function' ? myTargetOf(c.tk) : null;
  const mineTxt = isNum(mine) ? 'Jouw koersdoel is ' + money(mine, cur) + (isNum(price) && price > 0 ? ', ' + spct1(mine / price - 1) + ' ten opzichte van de koers nu' : '') + '.' : '';
  if (!T || !isNum(T.mean)) {
    return ((R.denied || []).includes('target') ? '<p class="sub" style="margin-top:8px">Koersdoelen zitten niet in je Finnhub-abonnement.</p>' : '') +
      (mineTxt ? '<p class="sub" style="margin-top:8px">' + esc(mineTxt) + '</p>' : '');
  }
  const span = isNum(T.low) && isNum(T.high);
  const pts = [T.low, T.high, T.mean, price, mine].filter(isNum);
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const pos = (v) => (hi > lo ? ((v - lo) / (hi - lo) * 100).toFixed(1) + '%' : '50%');
  const up = price ? T.mean / price - 1 : null;
  return '<h3 style="margin-top:14px">Koersdoel</h3>' +
    '<div class="tgt"><span class="tgt-rail"></span>' + (span ? '<span class="tgt-band" style="left:' + pos(T.low) + ';width:calc(' + pos(T.high) + ' - ' + pos(T.low) + ')"></span>' : '') +
      '<span class="tgt-mean" style="left:' + pos(T.mean) + '" data-tip="' + esc('Gemiddeld koersdoel ' + money(T.mean, cur)) + '"></span>' +
      (price ? '<span class="tgt-now" style="left:' + pos(price) + '" data-tip="' + esc('Koers nu ' + money(price, cur)) + '"></span>' : '') +
      (isNum(mine) ? '<span class="tgt-mine" style="left:' + pos(mine) + '" data-tip="' + esc('Mijn koersdoel ' + money(mine, cur)) + '"></span>' : '') + '</div>' +
    (span ? '<div class="range-labels"><span>laagste ' + esc(money(T.low, cur)) + '</span><span>hoogste ' + esc(money(T.high, cur)) + '</span></div>' : '') +
    '<p class="sub" style="margin-top:6px">Gemiddeld koersdoel ' + esc(money(T.mean, cur)) + (isNum(up) ? ', ' + esc(spct1(up)) + ' ten opzichte van de koers nu' : '') +
      '. Streep: gemiddelde, stip: koers nu' + (isNum(mine) ? ', ruit: jouw koersdoel' : '') + (srcOf(R, 'target') === 'av' ? ' (Alpha Vantage, zonder hoogste en laagste)' : '') +
      '. Koersdoelen zijn meningen van analisten, geen voorspelling.' + (mineTxt ? ' ' + esc(mineTxt) : '') + '</p>';
}

// Stemming in het nieuws (Finnhub, alleen Amerikaanse bedrijven)
function sentBlock(R) {
  const S = R.sent;
  if (!S || !isNum(S.bull)) return (R.denied || []).includes('sent') ? '<p class="sub" style="margin-top:8px">Nieuwsstemming zit niet in je Finnhub-abonnement.</p>' : '';
  const word = S.bull >= 0.65 ? 'vooral positief' : S.bull >= 0.55 ? 'eerder positief' : S.bull > 0.45 ? 'gemengd' : S.bull > 0.35 ? 'eerder negatief' : 'vooral negatief';
  return '<h3 style="margin-top:14px">Stemming in het nieuws</h3>' +
    '<div class="rec-bar"><i style="flex:' + S.bull + ';background:' + C.gain + '" data-tip="' + esc('Positief ' + P1.format(S.bull)) + '"></i><i style="flex:' + (S.bear || 0) + ';background:' + C.loss + '" data-tip="' + esc('Negatief ' + P1.format(S.bear || 0)) + '"></i></div>' +
    '<p class="sub" style="margin-top:6px">' + esc('Afgelopen week ' + word + ' (' + P1.format(S.bull) + ' positief' + (isNum(S.articles) ? ', ' + S.articles + ' artikelen' : '') + ')' +
      (isNum(S.score) && isNum(S.sector) ? '. Nieuwsscore ' + N2.format(S.score) + ' tegenover ' + N2.format(S.sector) + ' gemiddeld in de sector' : '') + '.') + '</p>';
}

// ---------- Volglijst ----------
const isWatchKey = (k) => typeof k === 'string' && k[0] === '~';
const watchSyms = () => ((M && M.settings && M.settings.watchlist) || []);
function watchPseudo(sym) {
  const p = M.mk.ok ? M.mk.prof(sym) : null;
  return { tk: sym, name: (p && p.name) || sym, cur: (p && p.currency) || 'USD', priceNative: p && p.price, watch: true, value: null, weight: null };
}
function watchEvents(sym) {
  const ev = data.events || {};
  const today = dayStart(Date.now());
  const earn = (ev.earnings || []).filter((e) => e.ticker === sym && ymd(e.date) >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const div = (ev.dividends || []).filter((d) => d.ticker === sym && d.announced).sort((a, b) => String(a.exDate).localeCompare(String(b.exDate)))[0];
  const last = (ev.lastEarnings || []).find((e) => e.ticker === sym);
  return { earn, div, last };
}

function watchTile(sym, phone) {
  const c = watchPseudo(sym);
  const p = M.mk.ok ? M.mk.prof(sym) : null;
  const W = watchEvents(sym);
  const pts = M.mk.ok ? M.mk.prices(sym).slice(-60).map((x) => ({ t: x.t, v: x.v })) : [];
  const rb = p ? rangeBar(p) : { html: '', off: null };
  const ch = p && isNum(p.change) ? p.change / 100 : null;
  const unknown = !p && ((data.market && data.market.unknown) || []).includes(sym);
  const sub = W.earn ? 'cijfers ' + fDM.format(ymd(W.earn.date)) : p && p.sector ? sectorNl(p.sector) : p ? '' :
    unknown ? 'symbool niet gevonden; controleer het beurssymbool' : (!demo && !FEAT().has.fmp) ? 'koers vraagt een FMP-sleutel' : 'gegevens worden opgehaald';
  // Ongeldig symbool: geen klikbare tegel, wel een knop om het weg te halen
  if (unknown) {
    return phone
      ? '<div class="m-row bad"><span class="l"><span class="tk">' + esc(sym) + '</span><span class="nm">' + esc(sub) + '</span></span><span class="rt"><button type="button" class="btn ghost" data-xa="watch-remove" data-k="' + esc(sym) + '">Verwijderen</button></span></div>'
      : '<section class="tile watch bad"><span class="row"><span class="tk">' + esc(sym) + '</span><span class="tag loss">Niet gevonden</span></span><span class="sub" style="margin-top:8px">' + esc(sub) + '</span>' +
        '<span style="margin-top:10px"><button type="button" class="btn ghost" data-xa="watch-remove" data-k="' + esc(sym) + '">Verwijderen</button></span></section>';
  }
  const noChart = pts.length < 2 ? '<span class="spark-empty">' + esc(FEAT().has.td || FEAT().has.av ? 'Koersgeschiedenis wordt opgehaald' : 'Grafiek bouwt zich dag voor dag op; met een gratis Twelve Data-sleutel meteen') + '</span>' : '';
  if (phone) {
    return '<button type="button" class="m-row" data-ticker="~' + esc(sym) + '" aria-label="' + esc(c.name + ', volglijst. Openen') + '">' +
      '<span class="l"><span class="tk">' + esc(sym) + '</span><span class="nm">' + esc(c.name !== sym ? c.name : sub) + '</span>' + watchBadges(sym, p) + '</span>' +
      spark(pts, toneColor(ch), 'mspark') +
      '<span class="rt"><b>' + esc(p && isNum(p.price) ? money(p.price, p.currency) : '–') + '</b><span class="chip-chg ' + tone(ch) + '">' + esc(isNum(ch) ? spct(ch) : 'volglijst') + '</span></span></button>';
  }
  return '<button type="button" class="tile watch" data-ticker="~' + esc(sym) + '" aria-label="' + esc(c.name + ', volglijst. Inzoomen') + '">' +
    '<span class="row"><span class="tk">' + esc(sym) + '</span><span class="tag">Volglijst</span></span>' +
    '<span class="nm">' + esc(c.name) + '</span>' +
    '<span class="row" style="margin-top:8px"><span class="v" style="font-size:22px">' + esc(p && isNum(p.price) ? money(p.price, p.currency) : '–') + '</span><b class="' + tone(ch) + '">' + esc(isNum(ch) ? spct(ch) : '') + '</b></span>' +
    (rb.html && p && p.range ? '<span class="sub" style="display:block;margin-top:6px">' + rb.html + '</span><span class="sub">' + esc(isNum(rb.off) ? (rb.off > -0.005 ? 'bij de jaartop' : P1.format(-rb.off) + ' onder de jaartop') : '') + '</span>' : '') +
    '<span class="sub">' + esc(sub) + '</span>' + watchBadges(sym, p) + (noChart || spark(pts, toneColor(ch))) + '</button>';
}

function watchAddForm(id) {
  return '<form class="watch-add" data-watchform="' + id + '" autocomplete="off"><label class="sr-only" for="' + id + '">Bedrijf zoeken</label>' +
    '<span class="ws-wrap"><input id="' + id + '" class="search" type="search" spellcheck="false" maxlength="40" placeholder="Zoek een bedrijf of beurssymbool" aria-autocomplete="list">' +
    '<span class="ws-results" role="listbox" hidden></span></span>' +
    '<button type="submit" class="btn primary">Volgen</button><span class="small muted watch-status" role="status"></span></form>';
}

function renderWatch() {
  // Volgorde wijzigen (js/27-volglijst.js): dan de hele lijst als rijen met knoppen, zonder labelfilter
  const ordering = wOrder.on && watchSyms().length > 1;
  // Meerdere tegelijk kiezen (idee 36, js/27-volglijst.js)
  const picking = !ordering && wPick.on && watchSyms().length > 0;
  const syms = ordering ? watchSyms() : watchSyms().filter(watchTagFilter);
  const empty = '<p class="empty">Nog niets op je volglijst. Voeg een beurssymbool toe (zoals NVDA of LMT) om koers, agenda, nieuws en cijfers te volgen zonder het aandeel te hebben.</p>';
  if ($('watch-grid')) { if (!$('watch-in')) $('watch-add').innerHTML = watchAddForm('watch-in'); fill('watch-grid', ordering ? [watchOrderHtml()] : picking ? [watchPickHtml()] : syms.length ? syms.map((x) => watchTile(x, false)) : [empty]); }
  if ($('m-watch-rows')) { if (!$('m-watch-in')) $('m-watch-add').innerHTML = watchAddForm('m-watch-in'); fill('m-watch-rows', ordering ? [watchOrderHtml()] : picking ? [watchPickHtml()] : syms.length ? syms.map((x) => watchTile(x, true)) : ['<p class="m-sub" style="padding:16px">Nog niets op je volglijst.</p>']); }
  const bad = unknownSyms();
  const clean = bad.length ? '<p class="small loss watch-clean">' + esc(bad.length + (bad.length === 1 ? ' symbool wordt' : ' symbolen worden') + ' niet gevonden: ' + bad.join(', ') + '.') + ' <button type="button" class="linklike" data-xa="watch-clean">Ongeldige verwijderen</button></p>' : '';
  ['watch-add', 'm-watch-add'].forEach((id) => { const host = $(id); if (!host) return; const old = host.querySelector('.watch-clean'); if (old) old.remove(); if (clean) host.insertAdjacentHTML('beforeend', clean); const oc = host.querySelector('.watch-tags'); if (oc) oc.remove(); host.insertAdjacentHTML('beforeend', watchTagChips());
    const ob = host.querySelector('.wo-start'); if (ob) ob.remove(); if (!ordering && !picking && watchSyms().length && !sharedView) host.insertAdjacentHTML('beforeend', '<p class="wo-start">' + (watchSyms().length > 1 ? '<button type="button" class="btn ghost" data-wo="start">' + esc(T('Volgorde wijzigen')) + '</button> ' : '') + '<button type="button" class="btn ghost" data-wp="start">' + esc(T('Kiezen')) + '</button></p>'); });
  const sg = watchSuggestTile();
  if ($('watch-sugg')) $('watch-sugg').innerHTML = sg;
  if ($('m-watch-sugg')) $('m-watch-sugg').innerHTML = sg;
}

// Wijzigingen in de volglijst gaan een voor een, zodat twee snelle klikken elkaar niet overschrijven.
// `next` is een lijst of een functie die de nieuwe lijst maakt uit de huidige.
let watchQueue = Promise.resolve();
let watchFetchTimer = null;
// Symbolen van de volglijst halen, met Ongedaan maken: ze komen terug op hun oude plek
function unwatchUndo(syms, statusEl, note) {
  const before = watchSyms().slice(), gone = new Set(syms);
  return setWatchlist((cur) => cur.filter((x) => !gone.has(x)), statusEl, note).then(() => {
    toastUndo(note, () => setWatchlist((cur) => {
      const keep = new Set(cur);
      // De oude volgorde, plus wat er intussen bij kwam
      return before.filter((x) => gone.has(x) || keep.has(x)).concat(cur.filter((x) => !before.includes(x))).slice(0, WATCH_MAX);
    }, null, ''));
  });
}
function setWatchlist(next, statusEl, note) {
  const say = (t, cls) => { if (statusEl) { statusEl.textContent = t; statusEl.className = 'small watch-status ' + (cls || 'muted'); } };
  const run = async () => {
    try {
      say('Bezig met opslaan…');
      const list = typeof next === 'function' ? next(watchSyms().slice()) : next;
      await saveSettings({ watchlist: list });
      await renderAll();   // klaar met tekenen, zodat wie hierna de focus zet de nieuwe knoppen vindt
      say(note, 'gain');
      // Koersen en profielen van nieuwe symbolen op de achtergrond ophalen; niet wachten, de lijst staat al goed
      if (!demo && isWorker()) {
        clearTimeout(watchFetchTimer);
        watchFetchTimer = setTimeout(fetchWatchData, 1500);
      }
      return true;
    } catch (err) { say(foutTekst('De volglijst kon niet worden opgeslagen', err, 'Je volglijst staat in je Worker; controleer bij Instellingen je toegangscode en probeer het opnieuw.'), 'loss'); throw err; }
  };
  const p = watchQueue.then(run, run);
  watchQueue = p.catch(() => {});
  return p;
}
async function fetchWatchData() {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const stop = ctl ? setTimeout(() => ctl.abort(), 30000) : null;
  try { await workerCall('/api/market?plan=1', { method: 'POST', signal: ctl ? ctl.signal : undefined }); } catch (e) { /* de Worker probeert het later opnieuw */ }
  clearTimeout(stop);
  try { await load(); } catch (e) { /* volgende keer */ }
}

// Volgen met Enter of de knop: eerst kijken of het symbool bestaat (bedrijvenlijst en Finnhub)
document.addEventListener('submit', async (e) => {
  const f = e.target.closest && e.target.closest('[data-watchform]');
  if (!f) return;
  e.preventDefault();
  const inp = f.querySelector('input');
  const q = (inp.value || '').trim();
  const sym = q.toUpperCase();
  const st = f.querySelector('.watch-status');
  const bad = (t, html) => { st.innerHTML = esc(t) + (html || ''); st.className = 'small watch-status loss'; };
  if (!q) { bad('Typ een naam of beurssymbool.'); return; }
  const res = await searchCompaniesSite(q);
  const hit = res.find((r) => r.sym === sym) || (res.length === 1 ? res[0] : null);
  if (!hit) {
    if (res.length) { bad('Kies een bedrijf uit de lijst.'); const box = f.querySelector('.ws-results'); if (box) box.hidden = false; return; }
    if (/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(sym)) { bad(sym + ' is niet gevonden. ', '<button type="button" class="linklike" data-xa="watch-force" data-k="' + esc(sym) + '">Toch toevoegen</button>'); return; }
    bad('Niets gevonden voor "' + q + '".'); return;
  }
  const heldSyms = new Set([...M.byTk.keys()].concat(M.mk.ok ? Object.values(data.market.symbols || {}) : []));
  if (heldSyms.has(hit.sym)) { bad('Dit aandeel heb je al.'); return; }
  const list = watchSyms().slice();
  if (list.includes(hit.sym)) { bad('Staat al op je volglijst.'); return; }
  if (list.length >= WATCH_MAX) { bad('Maximaal ' + WATCH_MAX + ' aandelen.'); return; }
  inp.value = ''; const box = f.querySelector('.ws-results'); if (box) { box.innerHTML = ''; box.hidden = true; }
  setWatchlist((cur) => (cur.includes(hit.sym) ? cur : cur.concat([hit.sym])), st, hit.sym + (hit.name ? ' (' + hit.name + ')' : '') + ' staat op je volglijst.');
});

function renderWatchDetail(sym) {
  const c = watchPseudo(sym);
  const p = M.mk.ok ? M.mk.prof(sym) : null;
  const W = watchEvents(sym);
  const ch = p && isNum(p.change) ? p.change / 100 : null;
  const research = companyResearch(c);
  const market = p ? companyMarket(c) : { tiles: [], table: '' };
  const agenda = '<section class="tile pad"><h3>Agenda</h3>' + kvList([
    ['Volgende kwartaalcijfers', W.earn ? fD.format(ymd(W.earn.date)) + ', ' + whenText(ymd(W.earn.date)) : (FEAT().has.fmp || demo) ? 'nog niet bekend' : 'vraagt een FMP-sleutel'],
    ['Verwachte winst per aandeel', W.earn && isNum(W.earn.epsEst) ? N2.format(W.earn.epsEst) : '–'],
    ['Vorige cijfers', W.last ? fDM.format(ymd(W.last.date)) + (surpriseText(W.last) ? ', ' + surpriseText(W.last) : '') : '–'],
    ['Volgend dividend', W.div ? [W.div.exDate ? 'ex-dividend ' + fDM.format(ymd(W.div.exDate)) : '', W.div.perShare ? money(W.div.perShare, c.cur) + ' per aandeel' : ''].filter(Boolean).join(', ') : '–'],
  ]) + '<p class="sub" style="margin-top:8px">De agenda van volgaandelen wordt elke ochtend bijgewerkt.</p></section>';
  const head = '<p class="hero-label">' + esc(c.name) + ', volglijst</p><h2 id="d-title" class="' + (mode === 'm' ? 'm-value' : 'hero-value') + '">' + esc(sym) + ' ' + esc(p && isNum(p.price) ? money(p.price, p.currency) : '') + '</h2>' +
    (mode === 'm' ? (isNum(ch) ? '<p><span class="pill-chg ' + tone(ch) + '">' + esc(spct(ch)) + '</span></p><span class="base" style="padding:6px 0 0">op de laatste handelsdag in de VS</span>' : '<span class="base" style="padding:6px 0 0">Nog geen koers; die wordt de volgende ochtend opgehaald.</span>')
      : '<p class="hero-change ' + tone(ch) + '">' + esc(isNum(ch) ? spct(ch) + ' op de laatste handelsdag' : 'Nog geen koers; die wordt de volgende ochtend opgehaald.') + '</p>');
  const chart = '<div class="chart ' + (mode === 'm' ? 'm-chart' : 'hero-chart') + '" data-chart="watch" data-sym="' + esc(sym) + '" role="img" aria-label="' + esc('Koers van ' + c.name) + '"></div><div class="xlabels" data-x="watch"></div>';
  const remove = '<button type="button" class="btn ghost danger" data-unwatch="' + esc(sym) + '">Van volglijst halen</button>';
  // Snelle modus (js/23-live.js): live grafiek van gettex en, met een Finnhub-sleutel, elke trade
  const fast = typeof fastTile === 'function' ? fastTile(c) : '';
  if (mode === 'm') {
    return '<div class="md"><div class="m-dtop"><button type="button" class="m-back" data-act="back">' + esc(crumbBack()) + '</button><span class="t">' + esc(sym) + '</span><span></span></div>' + crumbNav(sym + ' · volglijst') +
      '<div class="m-hero"><div class="m-swipe">' + head + '</div>' + chart + '</div>' +
      '<div class="m-body"><div class="m-stack">' + fast + agenda + priceAlertTile(sym, p && p.price, (p && p.currency) || 'USD') + myTargetTile(sym) + watchMetaTile(sym, p) + watchTradeTile(sym, p) + research.join('') + market.tiles.join('') + market.table + '<div style="padding:8px 0">' + remove + '</div></div></div></div>';
  }
  return '<div class="band">' + crumbNav(sym + ' · volglijst') + '<div class="d-top"><button type="button" class="btn dark" data-act="back">← Terug</button>' + remove + '</div>' +
    '<div class="hero-head"><div>' + head + '</div></div>' + chart + '</div>' +
    '<div class="wrap">' + (fast ? '<div class="grid wide" style="margin-bottom:16px">' + fast + '</div>' : '') + '<div class="grid wide">' + agenda + priceAlertTile(sym, p && p.price, (p && p.currency) || 'USD') + myTargetTile(sym) + watchMetaTile(sym, p) + watchTradeTile(sym, p) + market.tiles.join('') + '</div>' +
    '<div class="section-head"><h2>Nieuws, analisten en cijfers</h2></div><div class="grid wide">' + research.join('') + '</div>' +
    (market.table ? '<div style="margin-top:16px">' + market.table + '</div>' : '') + '</div>';
}

function drawWatchChart(root) {
  const host = root.querySelector('[data-chart="watch"]');
  if (!host) return;
  const sym = host.dataset.sym;
  const pts = M.mk.ok ? M.mk.prices(sym).map((x) => ({ t: x.t, v: x.v })) : [];
  const cur = ((M.mk.ok && M.mk.prof(sym)) || {}).currency || 'USD';
  lineChart(host, [{ pts, color: C.accent, width: 2.5, fmt: (v) => money(v, cur) }], {
    animate: true, xl: root.querySelector('[data-x="watch"]'), xcount: 4, xfmt: (t) => fDM.format(t), tfmt: (t) => fD.format(t),
    empty: 'Nog geen koershistorie. Het gratis FMP-abonnement geeft die alleen voor een deel van de aandelen; anders bouwt de tracker hem dag voor dag op.',
  });
}


// ---------- Wat als: dezelfde stortingen in een indexfonds ----------
// Index (FRED, in dollars) omgerekend naar euro met de ECB-koers van dezelfde dag
function indexEur(id) {
  const ser = data.idx && data.idx.series && data.idx.series[id];
  if (!ser || !ser.length) return [];
  const fx = fxMap();
  const fxDays = [...fx.keys()].sort();
  let j = 0, last = null;
  return ser.map(([d, v]) => { while (j < fxDays.length && fxDays[j] <= d) { last = fx.get(fxDays[j]); j++; } return last ? { day: d, t: ymd(d), v: v / last } : null; }).filter(Boolean);
}
const priceOn = (pts, t) => { let p = null; for (const x of pts) { if (x.t <= t + 12 * HOUR) p = x; else break; } return p; };

function whatIf(id) {
  const pts = indexEur(id);
  const W = M.weeks.filter((w) => isNum(w.netDeposits));
  if (pts.length < 20 || W.length < 2) return null;
  let units = 0;
  const line = [];
  W.forEach((w, i) => {
    const dep = i === 0 ? w.accountValue : (isNum(w.newDeposits) ? w.newDeposits : 0); // start: wat je toen had, daarna de stortingen
    const p = priceOn(pts, w.t);
    if (!p) return;
    units += dep / p.v;
    line.push({ t: w.t, v: units * p.v });
  });
  const lastP = pts[pts.length - 1];
  const now = units * lastP.v;
  return { id, label: id === 'SP500' ? 'S&P 500' : 'Nasdaq-100', now, line: line.concat([{ t: Math.max(lastP.t, line.length ? line[line.length - 1].t + HOUR : lastP.t), v: now }]), lastDay: lastP.day };
}

function whatIfTile() {
  if (!(data.idx && data.idx.series)) return '<section class="tile pad"><h3>Wat als alles in de index had gezeten</h3><p class="muted">De koersen van de S&P 500 en de Nasdaq-100 worden één keer per dag opgehaald bij FRED. Dat is nog niet gebeurd.</p></section>';
  const A = whatIf('SP500'), B = whatIf('NASDAQ100');
  if (!A) return '<section class="tile pad"><h3>Wat als alles in de index had gezeten</h3><p class="muted">Hiervoor zijn minstens twee weekmetingen en wisselkoersen nodig.</p></section>';
  const mine = M.accountNow;
  const diff = (x) => mine - x.now;
  return '<section class="tile pad whatif"><h3>Wat als alles in de index had gezeten</h3>' +
    '<div class="chart" data-chart="whatif" style="height:180px"></div><div class="xlabels" data-x="whatif"></div>' +
    '<div class="legend chart-legend" style="margin-top:8px"><span><i style="background:' + C.accent + '"></i>Jij ' + esc(eur(mine)) + '</span>' +
      '<span><i class="dash"></i>S&amp;P 500 ' + esc(eur(A.now)) + '</span>' + (B ? '<span><i style="background:#9AA3B5"></i>Nasdaq-100 ' + esc(eur(B.now)) + '</span>' : '') + '</div>' +
    '<div style="margin-top:10px">' + kvList([
      ['Jij tegenover de S&P 500', seur(diff(A)) + (A.now ? ' (' + spct1(mine / A.now - 1) + ')' : ''), tone(diff(A))],
      ['Jij tegenover de Nasdaq-100', B ? seur(diff(B)) + (B.now ? ' (' + spct1(mine / B.now - 1) + ')' : '') : '–', B ? tone(diff(B)) : ''],
    ]) + '</div>' +
    '<p class="sub" style="margin-top:8px">Alsof je bij de eerste weekmeting (' + esc(fDM.format(M.weeks[0].t)) + ') je hele accountwaarde in de index had gezet en daarna elke storting ook. Koersindex zonder dividend en zonder kosten, omgerekend naar euro met de ECB-koers. Bron: FRED.</p></section>';
}

function drawWhatIf(root) {
  const host = root.querySelector('[data-chart="whatif"]');
  if (!host) return;
  const A = whatIf('SP500'), B = whatIf('NASDAQ100');
  if (!A) return;
  const mine = M.weeks.map((w) => ({ t: w.t, v: w.accountValue })).concat([{ t: A.line[A.line.length - 1].t, v: M.accountNow }]);
  const base = mine.map((p) => p.t);
  const onBase = (line) => base.map((t) => { const p = priceOn(line, t); return { t, v: p ? p.v : null }; });
  const sets = [{ pts: mine, color: C.accent, width: 3, label: 'Jij' }, { pts: onBase(A.line), color: C.ink2, dash: true, width: 2, label: 'S&P 500' }];
  if (B) sets.push({ pts: onBase(B.line), color: '#9AA3B5', width: 2, label: 'Nasdaq-100' });
  lineChart(host, sets, { top: 0.08, bottom: 0.08, xl: root.querySelector('[data-x="whatif"]'), xcount: 3, xfmt: (t) => fDM.format(t), tfmt: (t) => fD.format(t) });
}

// ---------- Jaaroverzicht ----------
function yearList() {
  const ys = new Set(M.weeks.map((w) => new Date(w.t).getFullYear()));
  ys.add(new Date().getFullYear());
  return [...ys].sort((a, b) => b - a);
}

function yearStats(Y) {
  const W = M.weeks;
  const inY = W.filter((w) => new Date(w.t).getFullYear() === Y);
  const prev = W.filter((w) => new Date(w.t).getFullYear() < Y).pop();
  const startW = prev || inY[0];
  if (!startW) return null;
  const isNow = Y === new Date().getFullYear();
  const endW = inY[inY.length - 1];
  const endV = isNow ? M.accountNow : endW ? endW.accountValue : null;
  const endDep = endW ? endW.netDeposits : startW.netDeposits;
  const dep = isNum(endDep) && isNum(startW.netDeposits) ? endDep - startW.netDeposits : null;
  const res = isNum(endV) && isNum(dep) ? endV - startW.accountValue - dep : null;
  let idx = 1; inY.filter((w) => w !== startW && isNum(w.weekResultPct)).forEach((w) => { idx *= 1 + w.weekResultPct; });
  const wr = inY.filter((w) => isNum(w.weekResult) && w !== startW);
  const best = wr.reduce((b, w) => (!b || w.weekResult > b.weekResult ? w : b), null);
  const worst = wr.reduce((b, w) => (!b || w.weekResult < b.weekResult ? w : b), null);
  const inYear = (t) => new Date(t).getFullYear() === Y;
  const divs = M.ev.received.filter((d) => inYear(d.t));
  const tx = M.tx.list.filter((x) => inYear(x.t));
  const sp = indexEur('SP500');
  const spA = priceOn(sp, startW.t), spB = sp.length ? (isNow ? sp[sp.length - 1] : priceOn(sp, endW ? endW.t : startW.t)) : null;
  const comp = M.companies.filter((c) => isNum(c.resultPct)).sort((a, b) => b.resultPct - a.resultPct);
  return {
    Y, isNow, from: startW.t, to: isNow ? M.lastT || Date.now() : endW ? endW.t : startW.t, startV: startW.accountValue, endV, dep, res,
    twr: inY.length > 1 ? idx - 1 : null, best, worst, weeks: wr.length,
    div: sum(divs.map((d) => d.amount)), nDiv: divs.length,
    fees: sum(tx.map((x) => (x.feeFx || 0) + (x.feeOther || 0))), realised: sum(tx.map((x) => x.realised || 0)),
    buys: tx.filter((x) => x.side === 'BUY').length, sells: tx.filter((x) => x.side === 'SELL').length,
    market: spA && spB ? spB.v / spA.v - 1 : null,
    top: comp[0] || null, flop: comp[comp.length - 1] || null,
  };
}

function yearRows(R) {
  return [
    ['Periode', fD.format(R.from) + ' ' + new Date(R.from).getFullYear() + ' tot ' + fD.format(R.to) + (R.isNow ? ' (lopend jaar)' : '')],
    ['Accountwaarde begin en eind', eur(R.startV) + ' → ' + eur(R.endV)],
    ['Netto ingelegd', isNum(R.dep) ? seur(R.dep) : '–'],
    ['Resultaat', isNum(R.res) ? seur(R.res) : '–', tone(R.res)],
    ['Rendement zonder stortingen', isNum(R.twr) ? spct1(R.twr) : '–', tone(R.twr)],
    ['S&P 500 in euro, zelfde periode', isNum(R.market) ? spct1(R.market) : '–', tone(R.market)],
    ['Beste week', R.best ? seur(R.best.weekResult) + ', tot ' + fDM.format(R.best.t) : '–', R.best ? tone(R.best.weekResult) : ''],
    ['Slechtste week', R.worst ? seur(R.worst.weekResult) + ', tot ' + fDM.format(R.worst.t) : '–', R.worst ? tone(R.worst.weekResult) : ''],
    ['Dividend ontvangen', eur(R.div) + ' (' + R.nDiv + (R.nDiv === 1 ? ' uitkering)' : ' uitkeringen)')],
    ['Gerealiseerd resultaat', seur(R.realised), tone(R.realised)],
    ['Kosten', eur(R.fees)],
    ['Aankopen en verkopen', R.buys + ' en ' + R.sells],
    ['Beste positie nu (sinds aankoop)', R.top ? R.top.tk + ' ' + spct1(R.top.resultPct) : '–', R.top ? tone(R.top.resultPct) : ''],
    ['Zwakste positie nu (sinds aankoop)', R.flop ? R.flop.tk + ' ' + spct1(R.flop.resultPct) : '–', R.flop ? tone(R.flop.resultPct) : ''],
  ];
}

function yearTile() {
  const ys = yearList();
  if (!plan.year || !ys.includes(plan.year)) plan.year = ys[0];
  const R = yearStats(plan.year);
  return '<section class="tile pad"><div class="plan-head"><h3>Jaaroverzicht</h3>' +
    '<div class="seg light" role="group" aria-label="Jaar" data-plan="year">' + ys.map((y) => '<button type="button" data-k="' + y + '" aria-pressed="' + (y === plan.year) + '">' + y + '</button>').join('') + '</div></div>' +
    (R ? kvList(yearRows(R)) + '<div class="plan-actions" style="margin-top:12px"><button type="button" class="btn ghost" data-plan="print-year">Bewaren als PDF</button></div>' +
      '<p class="sub" style="margin-top:8px">Uit je weekmetingen, orders en dividenden. Bij "Bewaren als PDF" kies je in het afdrukvenster "Opslaan als PDF".</p>'
      : '<p class="muted">Geen weekmetingen in ' + plan.year + '.</p>') + '</section>';
}

function printYear() {
  const R = yearStats(plan.year);
  if (!R) return;
  const area = $('print-area');
  area.innerHTML = '<div class="print-doc"><p class="print-k">Investeringstracker</p><h1>Jaaroverzicht ' + R.Y + '</h1>' +
    '<p class="print-sub">Gemaakt op ' + esc(fD.format(Date.now()) + ' ' + new Date().getFullYear()) + '. Bedragen in euro.</p>' + kvList(yearRows(R)) +
    '<h2>Posities nu</h2><table class="tbl"><thead><tr><th>Positie</th><th class="num">Waarde</th><th class="num">Ingelegd</th><th class="num">Resultaat</th></tr></thead><tbody>' +
    M.companies.slice().sort((a, b) => b.value - a.value).map((c) => '<tr><td>' + esc(c.tk + ' ' + c.name) + '</td><td class="num">' + esc(eur(c.value)) + '</td><td class="num">' + esc(eur(c.cost)) + '</td><td class="num ' + tone(c.unreal) + '">' + esc(isNum(c.unreal) ? seur(c.unreal) + ' (' + spct1(c.resultPct) + ')' : '–') + '</td></tr>').join('') +
    '</tbody></table><p class="print-sub">Bronnen: Trading 212 (posities, orders, dividend), ECB en FRED (S&P 500 in euro). Dit overzicht is geen fiscaal document.</p></div>';
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); }, 50);
}
window.addEventListener('afterprint', () => { document.body.classList.remove('printing'); const a = $('print-area'); if (a) a.innerHTML = ''; });

// ---------- Mijlpalen ----------
const MILESTONES = [250, 500, 1000, 1500, 2000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 75000, 100000, 250000];
function milestones() {
  const W = M.weeks;
  const list = [];
  if (W.length) list.push({ t: W[0].t, title: 'Start van de tracker', sub: 'accountwaarde ' + eur(W[0].accountValue) });
  MILESTONES.forEach((m) => {
    const hit = W.find((w) => w.accountValue >= m);
    if (hit && hit !== W[0]) list.push({ t: hit.t, title: 'Over de ' + eur(m).replace(',00', ''), sub: 'week tot ' + fDM.format(hit.t) });
  });
  if (M.tx.buys[0]) list.push({ t: M.tx.buys[0].t, title: 'Eerste aankoop in de geschiedenis', sub: M.tx.buys[0].tk + ', ' + eur(M.tx.buys[0].net) });
  if (M.tx.sells[0]) list.push({ t: M.tx.sells[0].t, title: 'Eerste verkoop', sub: M.tx.sells[0].tk + (M.tx.sells[0].realised ? ', ' + seur(M.tx.sells[0].realised) + ' resultaat' : '') });
  if (M.ev.received[0]) list.push({ t: M.ev.received[0].t, title: 'Eerste dividend', sub: M.ev.received[0].ticker + ', ' + eur(M.ev.received[0].amount) });
  const wr = W.filter((w) => isNum(w.weekResult));
  const best = wr.reduce((b, w) => (!b || w.weekResult > b.weekResult ? w : b), null);
  if (best && best.weekResult > 0) list.push({ t: best.t, title: 'Beste week tot nu toe', sub: seur(best.weekResult) });
  const top = W.reduce((b, w) => (!b || w.accountValue > b.accountValue ? w : b), null);
  if (top) list.push({ t: top.t, title: 'Hoogste weekstand', sub: eur(top.accountValue) });
  return list.sort((a, b) => a.t - b.t);
}

function milestoneTile() {
  const list = milestones();
  const now = M.accountNow || 0;
  const next = MILESTONES.find((m) => m > now);
  let eta = null;
  if (next) {
    const monthly = isNum(M.settings.monthly) ? M.settings.monthly : monthlyGuess();
    const rm = Math.pow(1.07, 1 / 12) - 1;
    let v = now, k = 0;
    while (v < next && k < 600) { v = v * (1 + rm) + monthly; k++; }
    eta = k < 600 ? new Date(new Date().getFullYear(), new Date().getMonth() + k, 1).getTime() : null;
  }
  return '<section class="tile pad"><h3>Mijlpalen</h3>' +
    (next ? '<div class="ms-next"><span class="muted small">Volgende</span><b>' + esc(eur(next).replace(',00', '')) + '</b><span class="muted small">nog ' + esc(eur(next - now)) +
      (eta ? ', rond ' + esc(new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(eta)) + ' bij je huidige inleg en 7% per jaar' : '') + '</span><div class="meter"><div style="width:' + Math.min(100, now / next * 100).toFixed(1) + '%"></div></div></div>' : '') +
    (list.length ? '<ol class="ms">' + list.slice().reverse().map((m) => '<li><span class="ms-d">' + esc(fDM.format(m.t) + ' ' + String(new Date(m.t).getFullYear()).slice(2)) + '</span><span class="ms-t"><b>' + esc(m.title) + '</b><span class="muted small">' + esc(m.sub) + '</span></span></li>').join('') + '</ol>'
      : '<p class="muted">Na de eerste weekmeting verschijnen hier je mijlpalen.</p>') + '</section>';
}

// ---------- Valuta en koopkracht ----------
function usdExposure() {
  let direct = 0, viaFunds = 0;
  M.companies.forEach((c) => {
    if (BENCHES.slice(0, 2).some((b) => b[1].test(c.tk) || b[2].test(c.name))) viaFunds += c.value;
    else if (c.cur === 'USD') direct += c.value;
  });
  return { direct, viaFunds, total: direct + viaFunds };
}

function fxTile() {
  const F = FEAT();
  if (!demo && F.flags.fx === false) return offTile('Euro en dollar', 'Het valuta-overzicht staat uit. Zet het aan bij Koppelingen (geen sleutel nodig).', 'flag:fx');
  const fx = data.fx;
  if (!fx || !fx.rates || !(fx.rates.USD || []).length) return offTile('Euro en dollar', 'De koersen van de ECB worden één keer per dag opgehaald; dat is nog niet gebeurd.');
  const pts = fx.rates.USD.map(([d, v]) => ({ t: ymd(d), v }));
  const now = pts[pts.length - 1];
  const at = (days) => { const t = now.t - days * DAY; return pts.filter((p) => p.t <= t).pop() || pts[0]; };
  const m1 = at(30), y1 = at(365);
  const usdBuys = M.tx.trades.filter((x) => x.side === 'BUY' && x.cur === 'USD' && isNum(x.fxRate) && x.fxRate > 0.5);
  const avgRate = usdBuys.length ? sum(usdBuys.map((x) => x.fxRate * x.net)) / sum(usdBuys.map((x) => x.net)) : null;
  const E = usdExposure();
  const scen = E.total * (1 - 1 / 1.1);
  return '<section class="tile pad"><h3>Euro en dollar' + ageTagOf(fx, AGE_LIMIT.daily) + '</h3>' +
    '<div class="fx-head"><span class="v big">' + esc(N4.format(now.v)) + '</span><span class="muted small">dollar per euro, ' + esc(fD.format(now.t)) + '</span></div>' +
    '<div class="chart" data-chart="fx" style="height:120px"></div><div class="xlabels" data-x="fx"></div>' +
    kvList([
      ['Afgelopen maand', spct((now.v / m1.v) - 1) + ' ' + (now.v > m1.v ? '(euro duurder)' : now.v < m1.v ? '(dollar duurder)' : '')],
      ['Afgelopen jaar', spct((now.v / y1.v) - 1)],
      ['Jouw gemiddelde aankoopkoers', isNum(avgRate) ? N4.format(avgRate) + ' (' + (now.v > avgRate ? 'dollar nu goedkoper: kost je geld' : 'dollar nu duurder: levert je geld op') + ')' : '–', isNum(avgRate) ? (now.v > avgRate ? 'loss' : 'gain') : ''],
      ['Dollar-blootstelling', eur(E.total) + ' (' + (M.totalValue ? P1.format(E.total / M.totalValue) : '–') + ' van je beleggingen)'],
      ['Als de dollar 10% minder waard wordt', '≈ −' + eur(scen), 'loss'],
    ]) +
    '<p class="sub" style="margin-top:8px">Een hogere koers betekent een duurdere euro: je Amerikaanse beleggingen zijn dan minder euro waard. Blootstelling: aandelen in dollar plus je fondsen op Amerikaanse indexen. ECB-referentiekoersen via Frankfurter.</p></section>';
}

function hicpSeries(area) {
  const h = data.hicp && data.hicp.series && data.hicp.series[area];
  return (h || []).map(([ym, v]) => ({ ym, t: ymd(ym + '-15'), v })).filter((p) => p.t != null);
}

function inflationTile() {
  const F = FEAT();
  if (!demo && F.flags.inflation === false) return offTile('Na inflatie', 'Inflatie staat uit. Zet het aan bij Koppelingen (geen sleutel nodig).', 'flag:inflation');
  const nl = hicpSeries('NL'), ez = hicpSeries('U2');
  if (nl.length < 13) return offTile('Na inflatie', 'De inflatiecijfers van de ECB worden één keer per dag opgehaald; dat is nog niet gebeurd.');
  const last = nl[nl.length - 1];
  const yearAgo = nl.find((p) => p.ym === (Number(last.ym.slice(0, 4)) - 1) + last.ym.slice(4));
  const infl = yearAgo ? last.v / yearAgo.v - 1 : null;
  const ezLast = ez[ez.length - 1], ezYear = ez.find((p) => ezLast && p.ym === (Number(ezLast.ym.slice(0, 4)) - 1) + ezLast.ym.slice(4));
  // Rendement zonder stortingen sinds de eerste weekmeting, tegenover de prijsstijging in dezelfde periode
  const W = M.weeks.filter((w) => isNum(w.weekResultPct));
  let idx = 1; W.forEach((w) => { idx *= 1 + w.weekResultPct; });
  const start = M.weeks[0];
  const startIdx = start ? nl.filter((p) => p.t <= start.t).pop() : null;
  const priceRise = startIdx ? last.v / startIdx.v - 1 : null;
  const nominal = W.length ? idx - 1 : null;
  const real = isNum(nominal) && isNum(priceRise) ? (1 + nominal) / (1 + priceRise) - 1 : null;
  const dep = M.lastWeek && isNum(M.lastWeek.netDeposits) ? M.lastWeek.netDeposits : null;
  return '<section class="tile pad"><h3>Na inflatie' + ageTagOf(data.hicp, AGE_LIMIT.daily) + '</h3>' +
    '<div class="fx-head"><span class="v big">' + esc(isNum(infl) ? P1.format(infl) : '–') + '</span><span class="muted small">inflatie Nederland, 12 maanden tot ' + esc(fMonY.format(last.t)) + '</span></div>' +
    '<div class="chart" data-chart="hicp" style="height:110px"></div><div class="xlabels" data-x="hicp"></div>' +
    kvList([
      ['Eurozone', ezYear ? P1.format(ezLast.v / ezYear.v - 1) : '–'],
      ['Jouw rendement zonder stortingen', isNum(nominal) ? spct1(nominal) + ' sinds ' + fDM.format(start.t) : 'na de tweede weekmeting', tone(nominal)],
      ['Prijsstijging in die periode', isNum(priceRise) ? spct1(priceRise) : '–'],
      ['Rendement na inflatie', isNum(real) ? spct1(real) : '–', tone(real)],
      ['Je netto inleg na inflatie', isNum(dep) && isNum(priceRise) ? eur(dep / (1 + priceRise)) + ' koopkracht (van ' + eur(dep) + ')' : '–'],
    ]) +
    '<p class="sub" style="margin-top:8px">HICP-prijsindex (2025 = 100) van de ECB. De nieuwste maand kan ontbreken tot de ECB hem publiceert.</p></section>';
}

function drawMacro(root) {
  const fh = root.querySelector('[data-chart="fx"]');
  if (fh && data.fx) {
    const pts = data.fx.rates.USD.map(([d, v]) => ({ t: ymd(d), v }));
    lineChart(fh, [{ pts, color: C.accent, width: 2.5, area: true, alpha: 0.08, fmt: (v) => N4.format(v) + ' $' }], { top: 0.1, bottom: 0.1, xl: root.querySelector('[data-x="fx"]'), xcount: 3, xfmt: (t) => fMonY.format(t), tfmt: (t) => fD.format(t) });
  }
  const hh = root.querySelector('[data-chart="hicp"]');
  if (hh) {
    const nl = hicpSeries('NL').slice(-37), ez = hicpSeries('U2').slice(-37);
    if (nl.length > 1) lineChart(hh, [{ pts: nl, color: C.loss, width: 2.5, label: 'Nederland', fmt: (v) => N1.format(v) }, { pts: ez, color: C.ink2, dash: true, width: 2, label: 'Eurozone', fmt: (v) => N1.format(v) }],
      { top: 0.1, bottom: 0.1, xl: root.querySelector('[data-x="hicp"]'), xcount: 3, xfmt: (t) => fMonY.format(t), tfmt: (t) => fMonY.format(t) });
  }
}

// ---------- Onderzoek van één aandeel los bijhalen ----------
// Het hele 'extra'-deel van de Worker (markt, onderzoek, koersen) is groot. Mist het onderzoek van een
// bedrijf dat je opent – bijvoorbeeld een naam die net op je volglijst kwam – dan halen we alleen dat
// ene aandeel op: /api/data?part=research&tk=… Mislukt het, dan blijft de pagina gewoon werken.
const researchAsked = new Set();
async function ensureResearch(tk) {
  const sym = String(tk || '').replace(/^~/, '').toUpperCase();
  if (!sym || sym.startsWith('@') || !/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(sym)) return;
  if (demo || sharedView || !data || !isWorker() || !getToken()) return;
  if ((data.research || {})[sym] || researchAsked.has(sym)) return;
  researchAsked.add(sym);
  try {
    const j = await workerCall('/api/data?part=research&tk=' + encodeURIComponent(sym), { method: 'GET' });
    if (!j.research && !j.fin) return;
    if (j.research) data.research = Object.assign({}, data.research, { [sym]: j.research });
    if (j.fin) data.fin = Object.assign({}, data.fin, { [sym]: j.fin });
    if (ui.detail && String(ui.detail).replace(/^~/, '').toUpperCase() === sym) renderDetail(false);
    else refresh();
  } catch (err) { /* geen onderzoek: de pagina laat gewoon zien wat er wel is */ }
}
