/* Investeringstracker – Transacties, agenda (dividend en cijfers) en markt (sector, vergelijkbare bedrijven)
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Aan- en verkopen, gerealiseerd resultaat en kosten ----------
const CUR_SYM = { USD: '$', EUR: '€', GBP: '£', GBX: 'p', CHF: 'CHF ', DKK: 'kr ', SEK: 'kr ', NOK: 'kr ', JPY: '¥', CAD: 'C$', HKD: 'HK$' };
const money = (v, cur) => (!isNum(v) ? '–' : cur === 'EUR' || !cur ? eur(v) : (CUR_SYM[cur] || cur + ' ') + N2.format(v));

function deriveOrders(o, m) {
  const T = { list: [], byTk: new Map() };
  ((o && o.rows) || []).forEach((r) => {
    const t = new Date(r[0]).getTime();
    if (!isNum(t)) return;
    const x = { t, tk: r[1], name: r[2], side: r[3], qty: r[4], price: r[5], cur: r[6], fxRate: r[7], net: r[8], realised: r[9] || 0, feeFx: r[10] || 0, feeOther: r[11] || 0, kind: r[12] };
    T.list.push(x);
    if (!T.byTk.has(x.tk)) T.byTk.set(x.tk, []);
    T.byTk.get(x.tk).push(x);
  });
  T.list.sort((a, b) => a.t - b.t);
  T.trades = T.list.filter((x) => !x.kind || x.kind === 'TRADE');
  T.realised = sum(T.list.map((x) => x.realised || 0));
  T.fees = sum(T.list.map((x) => (x.feeFx || 0) + (x.feeOther || 0)));
  T.sells = T.trades.filter((x) => x.side === 'SELL');
  T.buys = T.trades.filter((x) => x.side === 'BUY');
  T.fx = m.companies.some((c) => isNum(c.fx)) ? sum(m.companies.map((c) => (isNum(c.fx) ? c.fx : 0))) : null;
  T.has = T.list.length > 0;
  // Gerealiseerd per aandeel, ook voor posities die je niet meer hebt
  const per = new Map();
  T.list.forEach((x) => {
    const o2 = per.get(x.tk) || { tk: x.tk, name: x.name || x.tk, realised: 0, fees: 0, sells: 0, held: m.byTk.has(x.tk) };
    o2.realised += x.realised || 0; o2.fees += (x.feeFx || 0) + (x.feeOther || 0); if (x.side === 'SELL') o2.sells++;
    per.set(x.tk, o2);
  });
  T.perTk = [...per.values()];
  return T;
}

function tradeMarkers(tk, pts) {
  const T = M.tx;
  if (!T.has || pts.length < 2) return [];
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  return (T.byTk.get(tk) || []).filter((x) => (!x.kind || x.kind === 'TRADE') && x.t >= t0 && x.t <= t1 + HOUR).slice(-4)
    .map((x) => { const nt = x.side === 'BUY' ? notesMap()[noteKey(x)] : null; return { i: nearestIdx(pts, x.t), label: (x.side === 'SELL' ? 'verkoop ' : 'koop ') + eur(x.net) + (nt ? ' – ' + (nt.length > 38 ? nt.slice(0, 36) + '…' : nt) : '') }; });
}

// Valuta-effect en transacties van één bedrijf
function companyTrades(c) {
  const T = M.tx;
  const list = (T.byTk.get(c.tk) || []).filter((x) => !x.kind || x.kind === 'TRADE');
  const fxRows = [];
  if (isNum(c.fx) && isNum(c.unreal)) {
    fxRows.push(['Koerseffect', seur(c.unreal - c.fx), tone(c.unreal - c.fx)]);
    fxRows.push(['Valuta-effect' + (c.cur && c.cur !== 'EUR' ? ' (' + c.cur + ' t.o.v. euro)' : ''), seur(c.fx), tone(c.fx)]);
  }
  if (isNum(c.avgNative) && c.cur) {
    fxRows.push(['Gemiddelde aankoopprijs in ' + c.cur, money(c.avgNative, c.cur)]);
    if (isNum(c.priceNative)) fxRows.push(['Koers nu in ' + c.cur, money(c.priceNative, c.cur) + ' (' + spct1(c.priceNative / c.avgNative - 1) + ')', tone(c.priceNative - c.avgNative)]);
  }
  if (!list.length && !fxRows.length) return '';
  const buys = list.filter((x) => x.side === 'BUY'), sells = list.filter((x) => x.side === 'SELL');
  const allTk = T.byTk.get(c.tk) || [];
  const realised = sum(allTk.map((x) => x.realised || 0)), fees = sum(allTk.map((x) => (x.feeFx || 0) + (x.feeOther || 0)));
  const rows = fxRows.concat(list.length ? [
    ['Eerste aankoop', buys.length ? fD.format(buys[0].t) + ' ' + new Date(buys[0].t).getFullYear() : '–'],
    ['Aankopen en verkopen', buys.length + ' en ' + sells.length],
    ['Gekocht voor', eur(sum(buys.map((x) => x.net)))],
    ['Verkocht voor', sells.length ? eur(sum(sells.map((x) => x.net))) : '–'],
    ['Gerealiseerd resultaat', sells.length ? seur(realised) : 'nog niets verkocht', sells.length ? tone(realised) : ''],
    ['Betaalde kosten', eur(fees)],
  ] : []);
  const recent = list.slice(-6).reverse();
  const txList = recent.length ? '<div class="tx-list">' + recent.map((x) =>
    '<div class="tx"><span class="tag' + (x.side === 'SELL' ? ' loss' : ' gain') + '">' + (x.side === 'SELL' ? 'Verkoop' : 'Koop') + '</span>' +
    '<span class="tx-m"><b>' + esc(N4.format(x.qty)) + ' × ' + esc(money(x.price, x.cur)) + '</b><span class="sub">' + esc(fD.format(x.t) + ' ' + new Date(x.t).getFullYear()) + '</span></span>' +
    '<span class="tx-v">' + esc(eur(x.net)) + (x.realised ? '<span class="sub ' + tone(x.realised) + '">' + esc(seur(x.realised)) + '</span>' : '') + '</span></div>' +
    (x.side === 'BUY' ? noteBlock(x) : '')).join('') + '</div>' : '';
  return '<section class="tile pad"><h3>Aankoop, valuta en transacties</h3>' + kvList(rows) +
    (txList ? '<h3 style="margin-top:16px">Laatste transacties</h3>' + txList : '') +
    (isNum(c.fx) ? '<p class="sub" style="margin-top:8px">Valuta-effect volgens Trading 212: het deel van je ongerealiseerde resultaat dat komt door de wisselkoers sinds je aankopen. Koerseffect is de rest.</p>' : '') + '</section>';
}

// Gerealiseerd per aandeel, ook voor posities die je niet meer hebt
function realisedTile() {
  const T = M.tx;
  if (!T.has) return '';
  const per = T.perTk.filter((x) => x.sells || x.realised).sort((a, b) => b.realised - a.realised);
  const mx = Math.max(1e-9, ...per.map((x) => Math.abs(x.realised)));
  return '<section class="tile pad"><h3>Gerealiseerd en kosten</h3>' + kvList([
    ['Gerealiseerd resultaat', seur(T.realised), tone(T.realised)],
    ['Aankopen en verkopen', T.buys.length + ' en ' + T.sells.length],
    ['Betaalde kosten', eur(T.fees) + (T.list.length ? ' (' + P2.format(T.fees / Math.max(1, sum(T.trades.map((x) => x.net)))) + ' van je orders)' : '')],
    ['Valuta-effect op open posities', isNum(T.fx) ? seur(T.fx) : '–', tone(T.fx)],
  ]) + (per.length ? '<div class="hbars" style="margin-top:12px">' + per.map((x) =>
    '<' + (x.held ? 'button type="button" data-open="' + esc(x.tk) + '"' : 'div') + ' class="r" data-tip="' + esc(x.name + ': ' + seur(x.realised) + (x.held ? '' : ' (positie gesloten)')) + '">' +
    '<span class="tk">' + esc(x.tk) + '</span><span class="track"><span class="mid"></span><span class="' + (x.realised < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(x.realised) / mx * 50).toFixed(1) + '%"></span></span>' +
    '<span class="' + tone(x.realised) + '" style="text-align:right;font-weight:600">' + esc(seur(x.realised)) + '</span></' + (x.held ? 'button' : 'div') + '>').join('') + '</div>' : '') +
    '<p class="sub" style="margin-top:8px">Gerealiseerd resultaat en kosten volgens Trading 212, per uitgevoerde order. Kosten zijn vooral wisselkosten.</p></section>';
}

// ---------- Agenda: dividenden en kwartaalcijfers ----------
const ymd = (s) => { const a = String(s || '').slice(0, 10).split('-').map(Number); return a.length === 3 && a.every(isNum) ? new Date(a[0], a[1] - 1, a[2]).getTime() : null; };
const fDay = new Intl.DateTimeFormat(LOCALE, { day: 'numeric' });
const fMon = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
const fMonY = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit' });
const FREQ_DAYS = { monthly: 30.4, quarterly: 91.3, 'semi-annual': 182.6, semiannual: 182.6, annual: 365.25, yearly: 365.25 };

function whenText(t) {
  const n = Math.round((t - dayStart(Date.now())) / DAY);
  if (n === 0) return 'vandaag';
  if (n === 1) return 'morgen';
  if (n < 0) return Math.abs(n) + ' dagen geleden';
  return n < 14 ? 'over ' + n + ' dagen' : 'over ' + Math.round(n / 7) + ' weken';
}

// Zet de ruwe gegevens van de Worker om: ontvangen, aangekondigd en (op basis van eerdere uitkeringen) verwacht
function deriveEvents(ev, m) {
  const today = dayStart(Date.now());
  const E = { loaded: !!ev, fmp: !!(ev && ev.fmp), updated: ev && ev.updated ? new Date(ev.updated).getTime() : null, errors: (ev && ev.errors) || [] };
  const held = (tk) => m.byTk.get(tk);
  E.received = ((ev && ev.received) || []).map((d) => Object.assign({}, d, { t: ymd(d.date) }))
    .filter((d) => d.t != null && isNum(d.amount)).sort((a, b) => a.t - b.t);
  E.total = sum(E.received.map((d) => d.amount));
  E.last12 = sum(E.received.filter((d) => d.t > today - 365 * DAY).map((d) => d.amount));
  const first = new Date(today); first.setDate(1);
  E.months = [];
  for (let i = 11; i >= 0; i--) {
    const s = new Date(first.getFullYear(), first.getMonth() - i, 1).getTime();
    const e = new Date(first.getFullYear(), first.getMonth() - i + 1, 1).getTime();
    E.months.push({ t: s, v: sum(E.received.filter((d) => d.t >= s && d.t < e).map((d) => d.amount)) });
  }
  E.byTk = new Map();
  E.received.forEach((d) => E.byTk.set(d.ticker, (E.byTk.get(d.ticker) || 0) + d.amount));

  const up = [];
  ((ev && ev.dividends) || []).forEach((d) => {
    if (!held(d.ticker) || !d.announced) return;
    const pay = ymd(d.payDate), ex = ymd(d.exDate);
    const t = pay != null ? pay : ex;
    if (t == null || t < today) return;
    up.push({ tk: d.ticker, t, ex, pay, eur: d.estEur, perShare: d.perShare, kind: 'Aangekondigd', gross: true });
  });
  // Verwacht uit je eigen uitkeringen: zelfde tussenpoos, bedrag geschaald naar je huidige aantal
  const hist = new Map();
  E.received.forEach((d) => { if (!hist.has(d.ticker)) hist.set(d.ticker, []); hist.get(d.ticker).push(d); });
  hist.forEach((list, tk) => {
    if (!held(tk) || up.some((u) => u.tk === tk) || list.length < 2) return;
    const gaps = list.slice(1).map((d, i) => d.t - list[i].t).filter((g) => g > 20 * DAY && g < 400 * DAY).sort((a, b) => a - b);
    if (!gaps.length) return;
    const gap = gaps[Math.floor(gaps.length / 2)];
    const last = list[list.length - 1];
    let t = last.t + gap;
    while (t < today) t += gap;
    if (t - today > 200 * DAY) return;
    const q = held(tk).qty;
    up.push({ tk, t, pay: t, eur: last.qty && q ? last.amount * q / last.qty : last.amount, kind: 'Verwacht', gross: false });
  });
  // Verwacht uit de laatste uitkering bij FMP, als je dit aandeel nog geen dividend hebt ontvangen
  ((ev && ev.dividends) || []).forEach((d) => {
    if (!held(d.ticker) || d.announced || up.some((u) => u.tk === d.ticker)) return;
    const per = FREQ_DAYS[String(d.frequency || '').toLowerCase()];
    const lastEx = ymd(d.lastEx);
    if (!per || lastEx == null) return;
    let t = lastEx + per * DAY;
    while (t < today) t += per * DAY;
    if (t - today > 200 * DAY) return;
    up.push({ tk: d.ticker, t, ex: t, eur: d.estEur, perShare: d.perShare, kind: 'Verwacht', gross: true, exOnly: true });
  });
  E.divs = up.sort((a, b) => a.t - b.t);
  E.next90 = sum(E.divs.filter((u) => u.t <= today + 90 * DAY && isNum(u.eur)).map((u) => u.eur));
  E.earn = ((ev && ev.earnings) || []).filter((e) => held(e.ticker)).map((e) => ({ tk: e.ticker, t: ymd(e.date), epsEst: e.epsEst, revEst: e.revEst }))
    .filter((e) => e.t != null && e.t >= today).sort((a, b) => a.t - b.t);
  E.lastEarn = new Map(((ev && ev.lastEarnings) || []).map((e) => [e.ticker, Object.assign({}, e, { t: ymd(e.date) })]));
  const cost = sum(m.companies.map((c) => (isNum(c.cost) ? c.cost : 0)));
  E.yieldOnCost = cost > 0 && E.received.length ? E.last12 / cost : null;
  return E;
}

function agRow(tk, t, title, sub, amt, tag) {
  const c = M.byTk.get(tk);
  return '<button type="button" class="ag-row" data-ticker="' + esc(tk) + '" aria-label="' + esc((c ? c.name : tk) + ', ' + fD.format(t) + ', ' + sub) + '">' +
    '<span class="ag-date"><b>' + esc(fDay.format(t)) + '</b><span>' + esc(fMon.format(t).replace('.', '')) + '</span></span>' +
    '<span class="ag-main"><span class="ag-t">' + esc(title) + '</span>' +
    '<span class="ag-s">' + (tag ? '<span class="tag' + (tag === 'Aangekondigd' ? ' gain' : '') + '">' + esc(tag) + '</span> ' : '') + esc(sub) + '</span></span>' + (amt ? '<span class="ag-amt">' + esc(amt) + '</span>' : '') + '</button>';
}

function surpriseText(le) {
  if (!le || !isNum(le.eps) || !isNum(le.epsEst) || !le.epsEst) return '';
  const d = (le.eps - le.epsEst) / Math.abs(le.epsEst);
  return Math.abs(d) < 0.005 ? 'gelijk aan de verwachting' : spct1(d) + (d > 0 ? ' boven' : ' onder') + ' de verwachting';
}

function agendaTiles() {
  const E = M.ev;
  if (!E.loaded) {
    return ['<p class="empty">De agenda met dividenden en kwartaalcijfers wordt één keer per dag opgehaald door de Worker (rond 06:15). ' +
      'Dat is nog niet gebeurd; na de eerste keer staat hier wat eraan komt.</p>'];
  }
  const nameOf = (tk) => { const c = M.byTk.get(tk); return c ? c.name : tk; };
  const earn = E.earn.slice(0, 6);
  const earnBody = !E.fmp
    ? '<p class="muted">Data van kwartaalcijfers komen van Financial Modeling Prep. Daarvoor is een gratis sleutel nodig; de README legt uit hoe je die toevoegt.</p>'
    : earn.length ? '<div class="ag-list">' + earn.map((e) => agRow(e.tk, e.t, e.tk + ' ' + nameOf(e.tk),
        whenText(e.t) + (isNum(e.epsEst) ? ', verwachte winst per aandeel ' + N2.format(e.epsEst) : ''), '', '')).join('') + '</div>' +
        (E.earn.length > earn.length ? '<p class="sub" style="margin-top:8px">En nog ' + (E.earn.length - earn.length) + ' later.</p>' : '')
      : '<p class="muted">Geen aangekondigde kwartaalcijfers gevonden voor je aandelen.</p>';
  const divs = E.divs.slice(0, 6);
  const divBody = divs.length
    ? '<div class="ag-list">' + divs.map((d) => agRow(d.tk, d.t, d.tk + ' ' + nameOf(d.tk),
        (d.exOnly ? 'ex-dividend ' : d.pay ? 'uitbetaling ' : 'ex-dividend ') + whenText(d.t) +
        (d.ex && d.pay && d.ex !== d.pay ? ', ex-dividend ' + fDM.format(d.ex) : ''),
        isNum(d.eur) ? '≈ ' + eur(d.eur) : '', d.kind)).join('') + '</div>' +
        '<p class="sub" style="margin-top:8px">Komende 90 dagen ongeveer ' + esc(eur(E.next90)) + '. Aangekondigde bedragen zijn bruto (voor bronbelasting); verwachte bedragen volgen je eerdere netto uitkeringen.</p>'
    : '<p class="muted">' + (E.fmp ? 'Geen aangekondigde of verwachte dividenden in de komende maanden.' : (E.received.length ? 'Voor een verwachting zijn per aandeel minstens 2 eerdere uitkeringen nodig.' : 'Nog geen dividend ontvangen om een verwachting op te baseren.') + ' Met een FMP-sleutel zie je ook aangekondigde dividenden.') + '</p>';
  const top = [...E.byTk.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const recBody = E.received.length
    ? '<p class="v big">' + esc(eur(E.last12)) + '</p><p class="sub">ontvangen in de laatste 12 maanden' + (isNum(E.yieldOnCost) ? ', ' + esc(P2.format(E.yieldOnCost)) + ' op je inleg' : '') + '</p>' +
      '<div style="margin-top:12px">' + bars(E.months.map((x) => ({ v: x.v, color: C.gain, tip: fMonY.format(x.t) + ': ' + eur(x.v) })), true) +
      barLabels(E.months.map((x, i) => (i % 3 === 0 ? fMon.format(x.t).replace('.', '') : ''))) + '</div>' +
      '<p class="sub" style="margin-top:8px">Sinds de eerste uitkering ' + esc(eur(E.total)) + '. Meeste van ' + esc(top.map(([tk, v]) => tk + ' (' + eur(v) + ')').join(', ')) + '.</p>'
    : '<p class="muted">Nog geen dividend ontvangen.</p>';
  const upd = E.updated ? '<p class="sub" style="margin-top:10px">Opgehaald ' + esc(fDT.format(E.updated)) + (E.errors.length ? '. ' + E.errors.length + ' onderdelen gaven een fout.' : '.') + '</p>' : '';
  return [
    '<section class="tile pad"><h3>Kwartaalcijfers</h3>' + earnBody + (E.fmp ? upd : '') + '</section>',
    '<section class="tile pad"><h3>Dividend dat eraan komt</h3>' + divBody + '</section>',
    '<section class="tile pad"><h3>Ontvangen dividend</h3>' + recBody + (E.fmp ? '' : upd) + '</section>',
  ];
}

// Agenda van één bedrijf
function companyAgenda(c) {
  const E = M.ev;
  if (!E.loaded) return '';
  const e = E.earn.find((x) => x.tk === c.tk);
  const le = E.lastEarn.get(c.tk);
  const d = E.divs.find((x) => x.tk === c.tk);
  const rec = E.received.filter((x) => x.ticker === c.tk);
  const isFund = ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk));
  const rows = [];
  if (!isFund) {
    rows.push(['Volgende kwartaalcijfers', e ? fD.format(e.t) + ', ' + whenText(e.t) : E.fmp ? 'nog niet aangekondigd' : 'vraagt een FMP-sleutel']);
    if (e && isNum(e.epsEst)) rows.push(['Verwachte winst per aandeel', N2.format(e.epsEst)]);
    if (le) rows.push(['Vorige cijfers', fDM.format(le.t) + (isNum(le.eps) ? ', winst per aandeel ' + N2.format(le.eps) : '')]);
    if (le && surpriseText(le)) rows.push(['Ten opzichte van verwachting', surpriseText(le), le.eps >= le.epsEst ? 'gain' : 'loss']);
  }
  rows.push(['Volgend dividend', d ? fD.format(d.t) + (isNum(d.eur) ? ', ≈ ' + eur(d.eur) : '') + (d.kind === 'Verwacht' ? ' (verwacht)' : '') : isFund ? 'fonds herbelegt of keert niet uit' : 'geen bekend']);
  rows.push(['Ontvangen dividend', rec.length ? eur(sum(rec.map((x) => x.amount))) + ' in ' + rec.length + (rec.length === 1 ? ' uitkering' : ' uitkeringen') : 'nog niets']);
  if (rec.length && isNum(c.cost) && c.cost > 0) {
    const y = sum(rec.filter((x) => x.t > dayStart(Date.now()) - 365 * DAY).map((x) => x.amount)) / c.cost;
    rows.push(['Dividendrendement op inleg', P2.format(y) + ' per jaar']);
  }
  return '<section class="tile pad"><h3>Agenda</h3>' + kvList(rows) + '</section>';
}


// ---------- Markt: sector, branche en vergelijkbare bedrijven ----------
const SECTOR_NL = {
  'Technology': 'Technologie', 'Healthcare': 'Gezondheidszorg', 'Industrials': 'Industrie', 'Communication Services': 'Communicatie en media',
  'Consumer Cyclical': 'Luxe en cyclische consumptie', 'Consumer Defensive': 'Basisconsumptie', 'Financial Services': 'Financiële diensten',
  'Energy': 'Energie', 'Basic Materials': 'Grondstoffen', 'Real Estate': 'Vastgoed', 'Utilities': 'Nutsbedrijven',
};
const INDUSTRY_NL = {
  'Aerospace & Defense': 'Lucht- en ruimtevaart en defensie', 'Drug Manufacturers - General': 'Farmacie', 'Drug Manufacturers - Specialty & Generic': 'Farmacie (specialistisch en generiek)',
  'Biotechnology': 'Biotechnologie', 'Medical - Devices': 'Medische apparatuur', 'Semiconductors': 'Halfgeleiders (chips)',
  'Semiconductor Equipment & Materials': 'Chipmachines en -materialen', 'Software - Infrastructure': 'Software (infrastructuur)',
  'Software - Application': 'Software (toepassingen)', 'Software - Services': 'Software (diensten)', 'Internet Content & Information': 'Internet en informatie',
  'Consumer Electronics': 'Consumentenelektronica', 'Specialty Retail': 'Detailhandel (gespecialiseerd)', 'Internet Retail': 'Internetwinkels',
  'Beverages - Non-Alcoholic': 'Frisdranken', 'Beverages - Alcoholic': 'Alcoholische dranken', 'Electronic Gaming & Multimedia': 'Games en multimedia',
  'Information Technology Services': 'IT-dienstverlening', 'Communication Equipment': 'Communicatieapparatuur', 'Computer Hardware': 'Computerhardware',
  'Entertainment': 'Entertainment', 'Banks - Diversified': 'Banken', 'Banks - Regional': 'Regionale banken', 'Auto - Manufacturers': 'Autofabrikanten',
  'Oil & Gas Integrated': 'Olie en gas', 'Packaged Foods': 'Verpakte voeding', 'Household & Personal Products': 'Huishoud- en verzorgingsproducten',
  'Discount Stores': 'Discountwinkels', 'Healthcare Plans': 'Zorgverzekeraars', 'Medical - Diagnostics & Research': 'Diagnostiek en onderzoek',
  'Electronic Components': 'Elektronische componenten', 'Hardware, Equipment & Parts': 'Hardware en onderdelen', 'Advertising Agencies': 'Reclamebureaus',
};
const sectorNl = (x) => SECTOR_NL[x] || x || 'Onbekend';
const industryNl = (x) => INDUSTRY_NL[x] || x || 'Onbekend';
const FUNDS = 'Fondsen (breed gespreid)';
const SECTOR_COLORS = ['#1E3A8A', '#2B5BD7', '#5B86E5', '#8FAEF0', '#0E7490', '#4FB3C8', '#6D28D9', '#A78BFA', '#B45309', '#F59E0B', '#475569'];

function mcap(v, cur) {
  if (!isNum(v)) return '–';
  const u = cur && cur !== 'USD' ? ' ' + cur : ' $';
  if (v >= 1e12) return N1.format(v / 1e12) + ' bln' + u;
  if (v >= 1e9) return NI.format(v / 1e9) + ' mld' + u;
  return NI.format(v / 1e6) + ' mln' + u;
}

function deriveMarket(mk, m) {
  const X = { ok: !!(mk && mk.profiles && Object.keys(mk.profiles).length), updated: mk && mk.updated };
  if (!X.ok) return X;
  X.sym = (tk) => (mk.symbols && mk.symbols[tk]) || tk;
  X.prof = (sym) => mk.profiles[sym] || null;
  X.profOf = (tk) => X.prof(X.sym(tk));
  X.peersOf = (tk) => (mk.peers && mk.peers[tk]) || [];
  X.heldBySym = new Map(Object.entries(mk.symbols || {}).map(([tk, sym]) => [sym, tk]));
  X.prices = (sym) => ((mk.prices && mk.prices[sym]) || []).map(([d, v]) => ({ day: d, t: ymd(d), v })).filter((p) => p.t != null && isNum(p.v));
  // Dagveranderingen per sector of branche; per beurs of het gemiddelde van de beurzen
  const perfMap = (kind, name, exch) => {
    const src = ((kind === 'sector' ? mk.sectors : mk.industries) || {})[name];
    if (!src) return new Map();
    const lists = exch && src[exch] ? [src[exch]] : Object.values(src);
    const acc = new Map();
    lists.forEach((l) => l.forEach(([d, v]) => { const o = acc.get(d) || []; o.push(v); acc.set(d, o); }));
    return new Map([...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, a]) => [d, mean(a) / 100]));
  };
  X.perf = perfMap;
  const days = new Set();
  Object.values(mk.sectors || {}).forEach((ex) => Object.values(ex).forEach((l) => l.forEach(([d]) => days.add(d))));
  X.days = [...days].sort();
  X.lastDay = X.days[X.days.length - 1] || null;
  X.sectorNames = Object.keys(mk.sectors || {});
  X.sectorOf = (c) => {
    if (ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk))) return FUNDS;
    const p = X.profOf(c.tk);
    return p && p.sector ? p.sector : 'Onbekend';
  };
  return X;
}

// Groei sinds de startdag, voor koersen of voor dagveranderingen van een sector of branche
function growthFromPrices(pts, startDay) {
  const from = pts.filter((p) => p.day >= startDay);
  if (from.length < 2) return null;
  const p0 = from[0].v;
  return new Map(from.map((p) => [p.day, p.v / p0 - 1]));
}
function growthFromPerf(map, startDay) {
  let idx = 1;
  const out = new Map();
  for (const [d, r] of map) {
    if (d < startDay) continue;
    if (out.size) idx *= 1 + r; // de eerste dag is het startpunt
    out.set(d, idx - 1);
  }
  return out.size >= 2 ? out : null;
}

function rangeBar(p) {
  const m = /^\s*([\d.]+)\s*-\s*([\d.]+)/.exec(p && p.range || '');
  if (!m || !isNum(p.price)) return { html: '<span class="muted">–</span>', off: null };
  const lo = Number(m[1]), hi = Number(m[2]);
  if (!(hi > lo)) return { html: '<span class="muted">–</span>', off: null };
  const x = Math.max(0, Math.min(1, (p.price - lo) / (hi - lo)));
  return {
    html: '<span class="yr" data-tip="' + esc('52 weken: ' + N2.format(lo) + ' – ' + N2.format(hi) + ' ' + (p.currency || '') + ', nu ' + N2.format(p.price)) + '"><span class="yr-rail"></span><span class="yr-dot" style="left:' + (x * 100).toFixed(1) + '%"></span></span>',
    off: p.price / hi - 1,
  };
}

// Sectorvergelijking en vergelijkbare bedrijven voor één bedrijf
function companyMarket(c) {
  const X = M.mk;
  const isFund = ETF_RE.test(c.name) || BENCHES.some((b) => b[1].test(c.tk));
  if (isFund) return { tiles: ['<section class="tile pad"><h3>Sector</h3><p class="muted">Dit is een fonds dat over veel bedrijven en sectoren is gespreid; een vergelijking met één sector past daar niet bij.</p></section>'], table: '' };
  if (!X.ok) return { tiles: ['<section class="tile pad"><h3>Sector en vergelijkbare bedrijven</h3><p class="muted">Deze gegevens komen van Financial Modeling Prep en worden elke ochtend opgehaald. Ze zijn er nog niet.</p></section>'], table: '' };
  const sym = X.sym(c.tk);
  const p = X.prof(sym);
  if (!p) return { tiles: ['<section class="tile pad"><h3>Sector en vergelijkbare bedrijven</h3><p class="muted">Nog geen profiel van ' + esc(sym) + ' opgehaald.</p></section>'], table: '' };
  const exch = p.exchange;
  const secMap = X.perf('sector', p.sector, exch), indMap = X.perf('industry', p.industry, exch);
  const lastD = X.lastDay;
  const own = X.prices(sym);
  // Startdag: eerste dag waarop zowel de sectorreeks als (zo mogelijk) een koers bestaat
  const window = X.days.slice(-260);
  const startCandidates = window.filter((d) => own.some((q) => q.day === d));
  const startDay = startCandidates.length >= 2 ? startCandidates[0] : window[0];
  const gOwn = growthFromPrices(own, startDay);
  const gSec = growthFromPerf(secMap, startDay), gInd = growthFromPerf(indMap, startDay);
  const lastOf = (g) => (g ? [...g.values()].pop() : null);
  const nDays = window.filter((d) => d >= startDay).length;

  const peers = X.peersOf(c.tk).map((s2) => X.prof(s2)).filter(Boolean);
  const betas = peers.map((q) => q.beta).filter((b) => isNum(b) && b > 0);
  const dayRows = [
    [c.tk, p.change, C.accent],
    [industryNl(p.industry), indMap.get(lastD) != null ? indMap.get(lastD) * 100 : null, C.ink2],
    [sectorNl(p.sector), secMap.get(lastD) != null ? secMap.get(lastD) * 100 : null, '#9AA3B5'],
  ];
  const mx = Math.max(0.5, ...dayRows.map((r) => (isNum(r[1]) ? Math.abs(r[1]) : 0)));
  const dayBars = '<div class="hbars cmp">' + dayRows.map(([lbl, v]) =>
    '<div class="r"><span class="tk" title="' + esc(lbl) + '">' + esc(lbl) + '</span><span class="track"><span class="mid"></span>' +
    (isNum(v) ? '<span class="' + (v < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(v) / mx * 50).toFixed(1) + '%"></span>' : '') + '</span>' +
    '<span class="' + tone(v) + '" style="text-align:right;font-weight:600">' + esc(isNum(v) ? spct(v / 100) : '–') + '</span></div>').join('') + '</div>';

  const info = '<section class="tile pad"><h3>Sector en branche</h3>' + kvList([
    ['Sector', sectorNl(p.sector)],
    ['Branche', industryNl(p.industry)],
    ['Beurswaarde', mcap(p.marketCap, p.currency)],
    ['Beta (beweeglijkheid t.o.v. de markt)', isNum(p.beta) && p.beta > 0 ? N2.format(p.beta) + (betas.length ? ', branchegenoten gemiddeld ' + N2.format(mean(betas)) : '') : '–'],
    ['Land en beurs', [p.country, p.exchange].filter(Boolean).join(', ') || '–'],
    ['Beursgang', p.ipoDate ? fDM.format(ymd(p.ipoDate)) + ' ' + p.ipoDate.slice(0, 4) : '–'],
  ]) + '<h3 style="margin-top:16px">Laatste handelsdag in de VS</h3>' + dayBars +
    '<p class="sub" style="margin-top:8px">Koersverandering' + (lastD ? ' op ' + esc(fD.format(ymd(lastD))) : '') + ', in dollars. Branche en sector zijn het gemiddelde van alle bedrijven op ' + esc(exch || 'de beurs') + '.</p></section>';

  const chartTile = '<section class="tile pad"><h3>Tegenover branche en sector</h3>' +
    (gSec ? '<div class="chart" data-chart="sector" data-tk="' + esc(c.tk) + '" style="height:170px"></div><div class="xlabels" data-x="sector"></div>' +
      '<div class="legend chart-legend" style="margin-top:8px">' +
        (gOwn ? '<span><i style="background:' + C.accent + '"></i>' + esc(c.tk) + ' ' + esc(spct1(lastOf(gOwn))) + '</span>' : '') +
        (gInd ? '<span><i class="dash"></i>' + esc(industryNl(p.industry)) + ' ' + esc(spct1(lastOf(gInd))) + '</span>' : '') +
        '<span><i style="background:#9AA3B5"></i>' + esc(sectorNl(p.sector)) + ' ' + esc(spct1(lastOf(gSec))) + '</span></div>' +
      '<p class="sub" style="margin-top:8px">' + esc(nDays + ' handelsdagen sinds ' + fD.format(ymd(startDay)) + '.') +
        (gOwn ? '' : ' Voor ' + esc(c.tk) + ' geeft het gratis abonnement geen koershistorie; die bouwt de tracker vanaf nu elke dag op.') + '</p>'
      : '<p class="muted">Nog te weinig handelsdagen opgehaald voor een vergelijking.</p>') + '</section>';

  // Tabel met vergelijkbare bedrijven
  const rows = [p].concat(peers);
  const periodHead = 'Sinds ' + fDM.format(ymd(startDay));
  const rowHtml = (q, i) => {
    const heldTk = X.heldBySym.get(q.symbol);
    const g = lastOf(growthFromPrices(X.prices(q.symbol), startDay));
    const rb = rangeBar(q);
    const tag = i === 0 ? '<span class="tag">Dit bedrijf</span>' : heldTk ? '<span class="tag gain">In bezit</span>' : '';
    const open = i > 0 && heldTk ? ' data-open="' + esc(heldTk) + '" tabindex="0" role="button"' : '';
    return '<tr class="' + (i === 0 ? 'me' : '') + (open ? ' rowlink' : '') + '"' + open + '>' +
      '<td class="co"><b>' + esc(q.symbol) + '</b> ' + tag + '<span class="nm">' + esc(q.name || '') + '</span></td>' +
      '<td class="num ' + tone(q.change) + '">' + esc(isNum(q.change) ? spct(q.change / 100) : '–') + '</td>' +
      '<td class="num ' + tone(g) + '">' + esc(isNum(g) ? spct1(g) : '–') + '</td>' +
      '<td class="yrc">' + rb.html + '<span class="sub">' + esc(isNum(rb.off) ? (rb.off > -0.005 ? 'bij de top' : P1.format(-rb.off) + ' onder top') : '') + '</span></td>' +
      '<td class="num">' + esc(mcap(q.marketCap, q.currency)) + '</td>' +
      '<td class="num">' + esc(isNum(q.beta) && q.beta > 0 ? N2.format(q.beta) : '–') + '</td></tr>';
  };
  const table = peers.length
    ? '<section class="tile pad peers"><h3>Vergelijkbare bedrijven</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bedrijf</th><th class="num">Laatste dag</th><th class="num">' + esc(periodHead) + '</th><th>Jaarbereik</th><th class="num">Beurswaarde</th><th class="num">Beta</th></tr></thead><tbody>' +
      rows.map(rowHtml).join('') + '</tbody></table></div>' +
      '<p class="sub" style="margin-top:8px">Bedrijven die FMP als vergelijkbaar aanmerkt (zelfde branche, vergelijkbare omvang). Jaarbereik: laagste tot hoogste koers van de afgelopen 52 weken, met de stip op de koers nu. “–” bij de periode betekent dat er nog geen koershistorie is.</p></section>'
    : '';
  return { tiles: [info, chartTile], table, startDay, gOwn, gSec, gInd };
}

function drawSectorChart(root) {
  const host = root.querySelector('[data-chart="sector"]');
  if (!host) return;
  const c = M.byTk.get(host.dataset.tk) || (watchSyms().includes(host.dataset.tk) ? watchPseudo(host.dataset.tk) : null);
  const R = c && companyMarket(c);
  if (!R || !R.gSec) return;
  const days = [...R.gSec.keys()];
  const toPts = (g) => days.map((d) => ({ t: ymd(d), v: g && g.has(d) ? g.get(d) : null }));
  const sets = [];
  if (R.gOwn) sets.push({ pts: toPts(R.gOwn), color: C.accent, width: 3, label: c.tk, fmt: spct1 });
  if (R.gInd) sets.push({ pts: toPts(R.gInd), color: C.ink2, dash: true, width: 2, label: 'Branche', fmt: spct1 });
  sets.push({ pts: toPts(R.gSec), color: '#9AA3B5', width: 2, label: 'Sector', fmt: spct1 });
  lineChart(host, sets, { zero: true, top: 0.08, bottom: 0.08, xl: root.querySelector('[data-x="sector"]'), xcount: 3, xfmt: (t) => fDM.format(t), tfmt: (t) => fD.format(t) });
}

// Portefeuille per sector
function sectorTiles() {
  const X = M.mk;
  if (!X.ok) return ['<p class="empty">Sectorgegevens komen van Financial Modeling Prep en worden elke ochtend opgehaald. Ze zijn er nog niet.</p>'];
  const groups = new Map();
  M.companies.forEach((c) => { const s = X.sectorOf(c); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(c); });
  const list = [...groups.entries()].map(([s, cs]) => ({ s, cs, v: sum(cs.map((c) => c.value)) })).sort((a, b) => b.v - a.v);
  const pctOf = (v) => (M.totalValue ? P1.format(v / M.totalValue) : '–');
  const colorOf = (s, i) => (s === FUNDS ? '#C9CED6' : SECTOR_COLORS[i % SECTOR_COLORS.length]);
  const slices = list.map((g, i) => ({ label: g.s === FUNDS ? FUNDS : sectorNl(g.s), v: g.v, color: colorOf(g.s, i) }));
  const stocksOnly = list.filter((g) => g.s !== FUNDS && g.s !== 'Onbekend');
  const legend = '<div class="legend-list">' + list.map((g, i) =>
    '<div class="legend-row"><i style="background:' + colorOf(g.s, i) + '"></i><span class="nm">' + esc(g.s === FUNDS ? FUNDS : sectorNl(g.s)) +
    ' <span class="muted small">' + esc(g.cs.map((c) => c.tk).join(', ')) + '</span></span><b style="min-width:52px;text-align:right">' + esc(pctOf(g.v)) + '</b></div>').join('') + '</div>';
  const pie = '<section class="tile pad"><h3>Verdeling per sector</h3>' + donut(slices, String(stocksOnly.length), stocksOnly.length === 1 ? 'sector' : 'sectoren', 'Verdeling van je beleggingen over sectoren') + legend + '</section>';

  // Laatste handelsdag: jouw aandelen per sector tegenover het sectorgemiddelde
  const lastD = X.lastDay;
  const cmp = stocksOnly.map((g) => {
    const w = g.cs.filter((c) => { const p = X.profOf(c.tk); return p && isNum(p.change); });
    const tv = sum(w.map((c) => c.value));
    const mine = tv ? sum(w.map((c) => c.value * X.profOf(c.tk).change)) / tv / 100 : null;
    const sec = X.perf('sector', g.s).get(lastD);
    return { g, mine, sec: isNum(sec) ? sec : null };
  });
  const mx = Math.max(0.005, ...cmp.flatMap((x) => [x.mine, x.sec]).filter(isNum).map(Math.abs));
  const bar = (v, cls) => '<span class="track"><span class="mid"></span>' + (isNum(v) ? '<span class="' + (v < 0 ? 'neg' : 'pos') + ' ' + cls + '" style="width:' + (Math.abs(v) / mx * 50).toFixed(1) + '%"></span>' : '') + '</span>';
  const cmpTile = '<section class="tile pad"><h3>Jij tegenover de sector</h3>' +
    (cmp.length ? '<div class="sec-cmp">' + cmp.map((x) =>
      '<div class="sc"><div class="sc-h"><b>' + esc(sectorNl(x.g.s)) + '</b><span class="muted small">' + esc(x.g.cs.map((c) => c.tk).join(', ')) + '</span></div>' +
      '<div class="hbars cmp"><div class="r"><span class="tk">Jij</span>' + bar(x.mine, '') + '<span class="' + tone(x.mine) + '" style="text-align:right;font-weight:600">' + esc(spct(x.mine)) + '</span></div>' +
      '<div class="r"><span class="tk muted">Sector</span>' + bar(x.sec, 'soft') + '<span class="' + tone(x.sec) + '" style="text-align:right">' + esc(spct(x.sec)) + '</span></div></div></div>').join('') + '</div>' +
      '<p class="sub" style="margin-top:8px">Laatste handelsdag in de VS' + (lastD ? ' (' + esc(fD.format(ymd(lastD))) + ')' : '') + ', in dollars. “Jij” is het gewogen gemiddelde van je aandelen in die sector.</p>'
      : '<p class="muted">Geen losse aandelen met sectorgegevens.</p>') + '</section>';

  // Alle sectoren in de markt over de opgehaalde periode
  const startDay = X.days[0];
  const perf = X.sectorNames.map((s) => { const g = growthFromPerf(X.perf('sector', s), startDay); return { s, v: g ? [...g.values()].pop() : null }; })
    .filter((x) => isNum(x.v)).sort((a, b) => b.v - a.v);
  const mine = new Set(stocksOnly.map((g) => g.s));
  const mx2 = Math.max(0.005, ...perf.map((x) => Math.abs(x.v)));
  const mktTile = '<section class="tile pad"><h3>Sectoren in de markt</h3>' +
    (perf.length ? '<div class="hbars cmp wide">' + perf.map((x) =>
      '<div class="r' + (mine.has(x.s) ? ' mine' : '') + '"><span class="tk" title="' + esc(sectorNl(x.s)) + '">' + esc(sectorNl(x.s)) + '</span><span class="track"><span class="mid"></span><span class="' + (x.v < 0 ? 'neg' : 'pos') + '" style="width:' + (Math.abs(x.v) / mx2 * 50).toFixed(1) + '%"></span></span>' +
      '<span class="' + tone(x.v) + '" style="text-align:right;font-weight:600">' + esc(spct1(x.v)) + '</span></div>').join('') + '</div>' +
      '<p class="sub" style="margin-top:8px">Gemiddelde koersverandering per sector over ' + esc(days(X.days.length).replace('dag', 'handelsdag')) + ' sinds ' + esc(fD.format(ymd(startDay))) + '. Vetgedrukt: sectoren waarin je aandelen hebt.</p>'
      : '<p class="muted">Nog geen handelsdagen opgehaald.</p>') + '</section>';
  return [pie, cmpTile, mktTile];
}
