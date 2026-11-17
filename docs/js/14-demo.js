/* Investeringstracker – Voorbeeldgegevens (?demo)
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Voorbeeldgegevens ----------
function makeDemoData() {
  let seed = 20261116;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const gauss = () => { let s = 0; for (let i = 0; i < 12; i++) s += rnd(); return s - 6; };
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00';
  // ticker, naam, waarde nu, beweeglijkheid per dag, rendement sinds aankoop, koers in euro
  const book = [
    ['VUAG', 'Vanguard S&P 500 UCITS ETF (Acc)', 412, 0.008, 0.031, 104.2], ['SXRV', 'iShares Nasdaq 100 UCITS ETF (Acc)', 268, 0.011, 0.054, 1180],
    ['ASML', 'ASML Holding', 96, 0.018, 0.040, 636], ['MSFT', 'Microsoft', 88, 0.012, -0.022, 438], ['GOOGL', 'Alphabet (Class A)', 75, 0.015, 0.068, 251],
    ['TSM', 'Taiwan Semiconductor', 72, 0.019, 0.029, 262], ['SPCX', 'Voorbeeld Ruimtevaart', 71, 0.03, -0.116, 48], ['AAPL', 'Apple', 68, 0.012, -0.014, 233],
    ['META', 'Meta Platforms', 61, 0.017, -0.063, 612], ['LLY', 'Eli Lilly', 59, 0.016, -0.098, 701], ['PLTR', 'Palantir', 50, 0.03, 0.127, 152],
    ['KO', 'Coca-Cola', 41, 0.007, 0.006, 63], ['TTWO', 'Take-Two Interactive', 39, 0.015, -0.035, 212], ['AMZN', 'Amazon', 34, 0.016, -0.041, 205],
  ];
  const SLOTS = 88;
  const now = new Date(); now.setSeconds(0, 0); now.setMinutes(Math.floor(now.getMinutes() / 10) * 10);
  const last = new Date(now); last.setHours(0, 0, 0, 0);
  while (last.getDay() === 0 || last.getDay() === 6) last.setDate(last.getDate() - 1);
  let lastSlots = SLOTS;
  if (dayKey(last.getTime()) === dayKey(now.getTime())) {
    const mins = (now.getHours() - 8) * 60 + now.getMinutes();
    lastSlots = mins < 0 ? 1 : Math.min(SLOTS, Math.floor(mins / 10) + 1);
  }
  const dates = [];
  const d0 = new Date(last);
  while (dates.length < 64) { if (d0.getDay() % 6) dates.unshift(new Date(d0)); d0.setDate(d0.getDate() - 1); }
  const nD = dates.length, buyDay = nD - 25;
  const cutoffH = new Date(last); cutoffH.setDate(cutoffH.getDate() - 30);
  const intraday = [], hours = [], days = [], today = [], positions = [];
  const tot = { intra: new Map(), hours: new Map(), days: new Map() };
  const add = (map, key, o) => { const x = map.get(key); if (!x) map.set(key, Object.assign({}, o)); else Object.keys(o).forEach((k) => { x[k] += o[k]; }); };
  const agg = (a) => ({ open: a[0], close: a[a.length - 1], low: Math.min(...a), high: Math.max(...a), avg: sum(a) / a.length });
  const r2 = (x) => Math.round(x * 100) / 100;

  book.forEach(([tk, name, target, vol, ret, price]) => {
    const path = [];
    let v = 1;
    const step = vol / Math.sqrt(SLOTS) * 1.2;
    dates.forEach((day, di) => {
      v *= 1 + gauss() * vol * 0.2;
      const n = di === nD - 1 ? lastSlots : SLOTS;
      const pts = [];
      for (let s = 0; s < n; s++) { v *= 1 + gauss() * step + 0.00004; pts.push(v); }
      path.push(pts);
    });
    const endV = path[nD - 1][path[nD - 1].length - 1];
    const scale = target / endV;
    let ath = -Infinity, atl = Infinity;
    const ranges = [];
    path.forEach((pts, di) => {
      const day = dates[di];
      const vals = pts.map((x, s) => r2(x * scale * (tk === 'KO' && (di < buyDay || (di === buyDay && s < 30)) ? 0.5 : 1)));
      vals.forEach((x) => { ath = Math.max(ath, x); atl = Math.min(atl, x); });
      if (di >= nD - 3) vals.forEach((x, s) => { const t = new Date(day); t.setHours(8, s * 10, 0, 0); const k = iso(t); intraday.push([k, tk, x]); add(tot.intra, k, { v: x }); });
      if (day >= cutoffH) {
        for (let h = 0; h < 15; h++) {
          const seg = vals.slice(h * 6, h * 6 + 7);
          if (seg.length < 7 && !(h === 14 && seg.length >= 2)) break;
          const t = new Date(day); t.setHours(8 + h, 0, 0, 0);
          const o = agg(seg);
          hours.push([iso(t), tk, o.open, o.close, o.low, o.high, r2(o.avg)]);
          add(tot.hours, iso(t), o);
        }
      }
      if (di < nD - 1) {
        const o = agg(vals);
        ranges.push([o.high - o.low, (o.high - o.low) / o.avg]);
        days.push([iso(day), tk, o.open, o.close, o.low, o.high, r2(o.avg), r2(o.high - o.low), (o.high - o.low) / o.avg]);
        add(tot.days, iso(day), o);
      } else {
        const o = agg(vals);
        today.push({ ticker: tk, name, current: o.close, low: o.low, high: o.high, avg: r2(o.avg), open: o.open,
          change: r2(o.close - o.open), changePct: (o.close - o.open) / o.open, allTimeHigh: ath, allTimeLow: atl,
          avgRange: r2(mean(ranges.map((x) => x[0]))), avgRangePct: mean(ranges.map((x) => x[1])), days: ranges.length });
        const cost = r2(o.close / (1 + ret));
        positions.push({ ticker: tk, name, value: o.close, unrealized: r2(o.close - cost), cost, resultPct: ret, quantity: +(o.close / price).toFixed(6) });
      }
    });
  });

  const rows = (map, tk, f) => [...map.keys()].sort().map((k) => f(k, map.get(k)));
  rows(tot.intra, TOTAL, (k, o) => intraday.push([k, TOTAL, r2(o.v)]));
  rows(tot.hours, TOTAL, (k, o) => hours.push([k, TOTAL, r2(o.open), r2(o.close), r2(o.low), r2(o.high), r2(o.avg)]));
  rows(tot.days, TOTAL, (k, o) => days.push([k, TOTAL, r2(o.open), r2(o.close), r2(o.low), r2(o.high), r2(o.avg), r2(o.high - o.low), (o.high - o.low) / o.avg]));

  const lastKey = dayKey(last.getTime());
  const tSeries = intraday.filter((r) => r[1] === TOTAL && dayKey(new Date(r[0]).getTime()) === lastKey).map((r) => r[2]);
  const tDays = days.filter((r) => r[1] === TOTAL);
  const to = agg(tSeries);
  today.sort((a, b) => a.ticker.localeCompare(b.ticker));
  today.unshift({ ticker: TOTAL, name: 'Totaal beleggingen', current: to.close, low: to.low, high: to.high, avg: r2(to.avg), open: to.open,
    change: r2(to.close - to.open), changePct: (to.close - to.open) / to.open,
    allTimeHigh: Math.max(to.high, ...tDays.map((r) => r[5])), allTimeLow: Math.min(to.low, ...tDays.map((r) => r[4])),
    avgRange: r2(mean(tDays.map((r) => r[7]))), avgRangePct: mean(tDays.map((r) => r[8])), days: tDays.length });

  // Weken: zaterdag, met de slotwaarde van vrijdag
  const weeks = [];
  let cash = 50.37, deposits = null, prev = null;
  tDays.forEach((r, i) => {
    const day = new Date(r[0]);
    if (day.getDay() !== 5) return;
    const sat = new Date(day); sat.setDate(sat.getDate() + 1);
    const wi = weeks.length;
    let newDep = 0;
    if (wi === 3 || wi === 7) { newDep = 50; cash += 50; }
    if (prev && day.getTime() > dates[buyDay].getTime() && !weeks.some((w) => w.boughtKO)) { newDep += 20; }
    const acc = r2(r[3] + cash);
    if (deposits == null) deposits = r2(acc + 12);
    else deposits = r2(deposits + newDep);
    const w = { date: iso(sat), accountValue: acc, netDeposits: deposits, cash: r2(cash), costBasis: null,
      totalResult: r2(acc - deposits), totalResultPct: (acc - deposits) / deposits, source: 'Voorbeeld' };
    if (prev) {
      w.weekChange = r2(acc - prev.accountValue);
      w.newDeposits = r2(deposits - prev.netDeposits);
      w.weekResult = r2(w.weekChange - w.newDeposits);
      w.weekResultPct = w.weekResult / prev.accountValue;
    } else { w.weekChange = null; w.newDeposits = null; w.weekResult = null; w.weekResultPct = null; }
    if (newDep >= 20 && day.getTime() > dates[buyDay].getTime()) w.boughtKO = true;
    weeks.push(w);
    prev = w;
  });
  const unrealSum = sum(positions.map((p) => p.unrealized));
  weeks.forEach((w, i) => { w.unrealized = r2(unrealSum * (0.6 + 0.4 * (i + 1) / weeks.length)); delete w.boughtKO; });

  // Agenda: datums ten opzichte van vandaag
  const dIn = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return iso(d).slice(0, 10); };
  const events = {
    updated: iso(now), fmp: true, errors: [],
    // ticker, dagen geleden, bruto per aandeel (dollar), aantal; netto = na 15% bronbelasting, omgerekend naar euro
    received: [
      ['KO', -411, 0.485, 0.9], ['KO', -320, 0.485, 0.9], ['KO', -229, 0.485, 0.9], ['KO', -138, 0.51, 0.9], ['KO', -47, 0.51, 1.8],
      ['MSFT', -341, 0.75, 0.2], ['MSFT', -250, 0.75, 0.2], ['MSFT', -160, 0.83, 0.2], ['MSFT', -68, 0.83, 0.2],
      ['AAPL', -372, 0.24, 0.29], ['AAPL', -190, 0.25, 0.29], ['AAPL', -99, 0.25, 0.29], ['AAPL', -8, 0.26, 0.29],
      ['TSM', -395, 0.6, 0.3], ['TSM', -120, 0.7, 0.3], ['TSM', -30, 0.83, 0.3],
    ].map(([ticker, n, perShare, qty]) => ({ ticker, date: dIn(n), amount: Math.round(perShare * qty * 0.85 / 1.09 * 100) / 100, perShare, qty })),
    earnings: [['AAPL', 6, 2.35], ['MSFT', 9, 3.1], ['META', 12, 6.7], ['GOOGL', 15, 2.6], ['AMZN', 19, 1.9], ['ASML', 23, 5.6], ['TSM', 27, 2.7], ['PLTR', 34, 0.21], ['KO', 41, 0.6]]
      .map(([ticker, n, epsEst]) => ({ ticker, symbol: ticker, date: dIn(n), epsEst, revEst: null })),
    lastEarnings: [{ ticker: 'AAPL', date: dIn(-84), eps: 1.85, epsEst: 1.77 }, { ticker: 'MSFT', date: dIn(-81), eps: 3.46, epsEst: 3.66 }],
    dividends: [{ ticker: 'KO', exDate: dIn(10), payDate: dIn(29), perShare: 0.51, estEur: 0.92, announced: true },
      { ticker: 'ASML', exDate: dIn(4), payDate: dIn(16), perShare: 1.6, estEur: 0.24, announced: true }],
  };

  // Markt: sectoren, branches en vergelijkbare bedrijven
  const META_INFO = {
    ASML: ['Technology', 'Semiconductor Equipment & Materials', ['AMAT', 'LRCX', 'KLAC', 'TSM']], MSFT: ['Technology', 'Software - Infrastructure', ['ORCL', 'GOOGL', 'CRM', 'PLTR']],
    GOOGL: ['Communication Services', 'Internet Content & Information', ['META', 'MSFT', 'AMZN', 'NFLX']], TSM: ['Technology', 'Semiconductors', ['NVDA', 'AVGO', 'AMD', 'INTC']],
    SPCX: ['Industrials', 'Aerospace & Defense', ['LMT', 'RTX', 'NOC', 'GD', 'BA']], AAPL: ['Technology', 'Consumer Electronics', ['MSFT', 'SONY', 'DELL', 'HPQ']],
    META: ['Communication Services', 'Internet Content & Information', ['GOOGL', 'SNAP', 'PINS', 'RDDT']], LLY: ['Healthcare', 'Drug Manufacturers - General', ['JNJ', 'ABBV', 'MRK', 'NVO', 'AZN']],
    PLTR: ['Technology', 'Software - Infrastructure', ['SNOW', 'CRWD', 'MSFT', 'ORCL']], KO: ['Consumer Defensive', 'Beverages - Non-Alcoholic', ['PEP', 'KDP', 'MNST']],
    TTWO: ['Communication Services', 'Electronic Gaming & Multimedia', ['EA', 'RBLX', 'NTES']], AMZN: ['Consumer Cyclical', 'Internet Retail', ['WMT', 'BABA', 'EBAY', 'SHOP']],
  };
  const mDays = [];
  const md = new Date(now); md.setDate(md.getDate() - 1);
  while (mDays.length < 25) { if (md.getDay() % 6) mDays.unshift(iso(md).slice(0, 10)); md.setDate(md.getDate() - 1); }
  const profiles = {}, prices = {}, peersMk = {}, symbols = {};
  const sectorOfSym = {};
  Object.entries(META_INFO).forEach(([tk, [sec, ind, prs]]) => { symbols[tk] = tk; peersMk[tk] = prs; sectorOfSym[tk] = [sec, ind]; prs.forEach((x) => { if (!sectorOfSym[x]) sectorOfSym[x] = [sec, ind]; }); });
  Object.entries(sectorOfSym).forEach(([sym, [sec, ind]], i) => {
    const price = 40 + rnd() * 600, lo = price * (0.55 + rnd() * 0.3), hi = price * (1.02 + rnd() * 0.4);
    profiles[sym] = { symbol: sym, name: (book.find((b) => b[0] === sym) || [0, sym + ' Corporation'])[1], price: +price.toFixed(2), currency: 'USD',
      marketCap: Math.round((0.02 + rnd() * 3) * 1e12), beta: +(0.4 + rnd() * 1.6).toFixed(2), range: lo.toFixed(2) + '-' + hi.toFixed(2),
      change: +(gauss() * 1.4).toFixed(2), sector: sec, industry: ind, exchange: i % 2 ? 'NYSE' : 'NASDAQ', country: 'US', ipoDate: (1980 + Math.floor(rnd() * 40)) + '-06-15' };
    let v = price;
    const hist = i % 3 === 2 ? mDays.slice(-1) : mDays;
    prices[sym] = hist.slice().reverse().map((d) => { const out = [d, +v.toFixed(2)]; v /= 1 + gauss() * 0.015; return out; }).reverse();
  });
  const sectorsMk = {}, industriesMk = {};
  ['Technology', 'Healthcare', 'Industrials', 'Communication Services', 'Consumer Cyclical', 'Consumer Defensive', 'Financial Services', 'Energy', 'Basic Materials', 'Real Estate', 'Utilities']
    .forEach((sec) => { const drift = gauss() * 0.15; sectorsMk[sec] = { NASDAQ: mDays.map((d) => [d, +(drift + gauss() * 0.8).toFixed(3)]), NYSE: mDays.map((d) => [d, +(drift + gauss() * 0.7).toFixed(3)]) }; });
  new Set(Object.values(sectorOfSym).map((x) => x[1])).forEach((ind) => { const drift = gauss() * 0.2; industriesMk[ind] = { NASDAQ: mDays.map((d) => [d, +(drift + gauss() * 1.1).toFixed(3)]), NYSE: mDays.map((d) => [d, +(drift + gauss() * 1).toFixed(3)]) }; });
  // Waardering: koers-winstverhouding en dividendrendement, nu en per jaar (voorbeelden)
  const valuation = {};
  const DIV_DEMO = { KO: 0.029, MSFT: 0.007, AAPL: 0.0045, TSM: 0.013, LLY: 0.007, GOOGL: 0.004, META: 0.003, ASML: 0.009 };
  Object.keys(profiles).forEach((sym) => {
    const base = 14 + rnd() * 40, dy = DIV_DEMO[sym] || 0;
    const yrs = [2021, 2022, 2023, 2024, 2025];
    valuation[sym] = { updated: dIn(-3), pe: sym === 'SPCX' ? null : +(base * (0.85 + rnd() * 0.4)).toFixed(1), dy: dy || null,
      hist: yrs.map((y) => [String(y), sym === 'SPCX' ? null : +(base * (0.7 + rnd() * 0.6)).toFixed(1), dy ? +(dy * (0.8 + rnd() * 0.4)).toFixed(4) : null]) };
  });
  const sectorPe = { date: mDays[mDays.length - 1], sectors: { Technology: 38.5, 'Communication Services': 24.1, Healthcare: 27.3, Industrials: 26.8, 'Consumer Cyclical': 29.9, 'Consumer Defensive': 22.4, 'Financial Services': 17.2, Energy: 13.1 } };
  const market = { symbols, peers: peersMk, profiles, prices, sectors: sectorsMk, industries: industriesMk, updated: mDays[mDays.length - 1], watch: ['NVDA', 'LMT'], valuation, sectorPe };

  // Transacties, valuta en fondssamenstelling
  const orders = [], posExtra = {};
  const curOf = (tk) => (['VUAG', 'SXRV'].includes(tk) ? 'GBX' : tk === 'ASML' ? 'EUR' : 'USD');
  positions.forEach((pp, i) => {
    const cur = curOf(pp.ticker);
    const fxr = cur === 'USD' ? 1.08 + rnd() * 0.06 : 1;
    const nativeNow = cur === 'USD' ? pp.value / pp.quantity * 1.16 : cur === 'GBX' ? pp.value / pp.quantity * 85 : pp.value / pp.quantity;
    const fxImp = cur === 'USD' ? +(-pp.cost * (0.01 + rnd() * 0.03)).toFixed(2) : cur === 'GBX' ? +(pp.cost * (rnd() - 0.5) * 0.02).toFixed(2) : null;
    posExtra[pp.ticker] = { avg: +(nativeNow / (1 + pp.resultPct) * (cur === 'USD' ? 1.02 : 1)).toFixed(2), price: +nativeNow.toFixed(2), cur, fx: fxImp, cost: pp.cost };
    const nBuys = 1 + (i % 3);
    for (let k = 0; k < nBuys; k++) {
      const d = new Date(dates[Math.max(0, nD - 60 + k * 17 + i)]); d.setHours(15, 30 + i, 0, 0);
      const q = pp.quantity / nBuys, net = +(pp.cost / nBuys).toFixed(2);
      orders.push([iso(d), pp.ticker, pp.name, 'BUY', +q.toFixed(6), +(posExtra[pp.ticker].avg).toFixed(2), cur, fxr, net, 0, cur === 'USD' ? +(net * 0.0015).toFixed(2) : 0, 0, 'TRADE']);
    }
  });
  const dSell = new Date(dates[nD - 20]); dSell.setHours(16, 5, 0, 0);
  orders.push([iso(new Date(dates[nD - 58])), 'NVDA', 'NVIDIA', 'BUY', 0.4, 172.5, 'USD', 1.09, 63.3, 0, 0.09, 0, 'TRADE']);
  orders.push([iso(dSell), 'NVDA', 'NVIDIA', 'SELL', 0.4, 191.2, 'USD', 1.12, 68.29, 4.99, 0.1, 0, 'TRADE']);
  const dSell2 = new Date(dates[nD - 9]); dSell2.setHours(17, 40, 0, 0);
  orders.push([iso(dSell2), 'PLTR', 'Palantir', 'SELL', 0.05, 158.2, 'USD', 1.15, 6.88, 0.71, 0.01, 0, 'TRADE']);
  orders.sort((a, b) => a[0].localeCompare(b[0]));
  const etfRows = (list) => list.map(([tk, nm, sec, w]) => [tk, nm, sec, w]);
  const etf = {
    SP500: { label: 'S&P 500', fund: 'iShares Core S&P 500 UCITS ETF (CSPX)', asOf: '13/Nov/2026', count: 503, rows: etfRows([
      ['NVDA', 'NVIDIA CORP', 'Information Technology', 7.9], ['MSFT', 'MICROSOFT CORP', 'Information Technology', 6.6], ['AAPL', 'APPLE INC', 'Information Technology', 6.4],
      ['AMZN', 'AMAZON COM INC', 'Consumer Discretionary', 4.1], ['GOOGL', 'ALPHABET INC CLASS A', 'Communication', 2.4], ['META', 'META PLATFORMS INC CLASS A', 'Communication', 2.6],
      ['AVGO', 'BROADCOM INC', 'Information Technology', 2.5], ['GOOG', 'ALPHABET INC CLASS C', 'Communication', 1.9], ['TSLA', 'TESLA INC', 'Consumer Discretionary', 2.0],
      ['BRKB', 'BERKSHIRE HATHAWAY INC CLASS B', 'Financials', 1.6], ['JPM', 'JPMORGAN CHASE & CO', 'Financials', 1.5], ['LLY', 'ELI LILLY', 'Health Care', 1.3],
      ['V', 'VISA INC CLASS A', 'Financials', 1.0], ['XOM', 'EXXON MOBIL CORP', 'Energy', 0.9], ['PLTR', 'PALANTIR TECHNOLOGIES INC CLASS A', 'Information Technology', 0.7], ['KO', 'COCA-COLA', 'Consumer Staples', 0.4]]) },
    NDX: { label: 'Nasdaq-100', fund: 'iShares Nasdaq 100 UCITS ETF (CNDX)', asOf: '13/Nov/2026', count: 101, rows: etfRows([
      ['NVDA', 'NVIDIA CORP', 'Information Technology', 9.4], ['MSFT', 'MICROSOFT CORP', 'Information Technology', 8.2], ['AAPL', 'APPLE INC', 'Information Technology', 7.8],
      ['AMZN', 'AMAZON COM INC', 'Consumer Discretionary', 5.3], ['AVGO', 'BROADCOM INC', 'Information Technology', 4.9], ['META', 'META PLATFORMS INC CLASS A', 'Communication', 3.6],
      ['GOOGL', 'ALPHABET INC CLASS A', 'Communication', 3.1], ['GOOG', 'ALPHABET INC CLASS C', 'Communication', 2.9], ['TSLA', 'TESLA INC', 'Consumer Discretionary', 2.7],
      ['NFLX', 'NETFLIX INC', 'Communication', 1.6], ['COST', 'COSTCO WHOLESALE CORP', 'Consumer Staples', 1.9], ['PLTR', 'PALANTIR TECHNOLOGIES INC CLASS A', 'Information Technology', 1.7],
      ['ASML', 'ASML HOLDING ADR', 'Information Technology', 0.9], ['TTWO', 'TAKE TWO INTERACTIVE SOFTWARE INC', 'Communication', 0.3]]) },
  };

  // Onderzoek, bedrijfscijfers, wisselkoers en inflatie (voorbeelden)
  const research = {}, fin = {};
  book.filter((x) => !['VUAG', 'SXRV'].includes(x[0])).forEach(([tk, name], i) => {
    const day = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d.getTime(); };
    research[tk] = {
      news: [1, 2, 4, 7].map((n, k) => ({ t: day(n), headline: 'Voorbeeld: ' + name + ' ' + ['stijgt na sterke cijfers', 'daalt na verlaagde verwachting', 'kondigt nieuw product aan', 'krijgt opwaardering van analist'][(k + i) % 4] + ' (geen echt nieuws)', source: 'Voorbeeldbron', url: '#' })),
      rec: [0, 1, 2, 3].map((k) => ({ period: dIn(-30 * k).slice(0, 8) + '01', sb: 6 + ((i + k) % 5), b: 12 + ((i * 3 + k) % 7), h: 6 + (i % 6), s: (i + k) % 3, ss: (i % 4 === 0) ? 1 : 0 })),
      eps: [0, 1, 2, 3].map((k) => { const est = +(1 + rnd() * 3).toFixed(2); const pct = +((rnd() - 0.35) * 14).toFixed(1); return { period: dIn(-91 * k - 40), actual: +(est * (1 + pct / 100)).toFixed(2), estimate: est, pct }; }),
      insider: [3, 11, 25, 48, 77].map((n, k) => ({ name: ['Voorbeeld, A.', 'Voorbeeld, B.', 'Voorbeeld, C.'][k % 3], date: dIn(-n), code: ['S', 'M', 'S', 'P', 'F'][(k + i) % 5], change: (k + i) % 5 === 3 ? 800 : -1200 - k * 300, price: +(50 + rnd() * 300).toFixed(2), shares: 10000 })),
    };
    const base = (5 + rnd() * 300) * 1e9, margin = 0.05 + rnd() * 0.3;
    const yrs = [2020, 2021, 2022, 2023, 2024, 2025];
    let r = base;
    const rows = yrs.map((y) => { r *= 1 + (rnd() * 0.25 - 0.02); return [y, Math.round(r)]; });
    fin[tk] = { updated: dIn(-2), series: {
      rev: { unit: tk === 'TSM' ? 'TWD' : 'USD', rows: rows.map(([y, v]) => [y, tk === 'TSM' ? v * 30 : v]) },
      net: { unit: tk === 'TSM' ? 'TWD' : 'USD', rows: rows.map(([y, v], k) => [y, Math.round((tk === 'TSM' ? v * 30 : v) * (margin + (rnd() - 0.5) * 0.06) * (tk === 'SPCX' && k < 3 ? -0.4 : 1))]) },
      op: { unit: 'USD', rows: rows.map(([y, v]) => [y, Math.round(v * (margin + 0.05))]) },
      eps: { unit: 'USD/shares', rows: rows.map(([y], k) => [y, +(1 + k * 0.6 + rnd()).toFixed(2)]) },
    } };
  });
  fin.ASML = { updated: dIn(-2), none: 'Voorbeeld: geen SEC-gegevens voor dit bedrijf.' };
  // Koersdoel en nieuwsstemming, ook voor de volglijst (NVDA, LMT)
  ['NVDA', 'LMT'].forEach((tk, i) => { research[tk] = Object.assign({}, research.AAPL, { news: research.AAPL.news.map((n) => Object.assign({}, n, { headline: n.headline.replace('Apple', tk) })) }); fin[tk] = fin.MSFT; });
  Object.keys(research).forEach((tk) => {
    // Zelfde koers als de positie zelf, zodat koersdoel en koers bij elkaar passen
    const pr = (posExtra[tk] && posExtra[tk].price) || (profiles[tk] && profiles[tk].price) || (100 + rnd() * 300);
    research[tk].target = { mean: +(pr * (0.95 + rnd() * 0.3)).toFixed(2), median: +(pr * 1.05).toFixed(2), high: +(pr * 1.45).toFixed(2), low: +(pr * 0.7).toFixed(2), updated: dIn(-5) };
    const bull = +(0.3 + rnd() * 0.5).toFixed(2);
    research[tk].sent = { bull, bear: +(1 - bull).toFixed(2), score: +(0.4 + rnd() * 0.5).toFixed(2), sector: 0.55, articles: Math.round(10 + rnd() * 80), buzz: 1 };
    // Koersdoel-geschiedenis per week, voor de betrouwbaarheid van analisten
    const ph = prices[tk] || [];
    research[tk].targetHist = ph.length > 5 ? ph.filter((p, k) => k % 5 === 0).map(([d, v]) => ({ d, mean: +(v * (0.9 + rnd() * 0.3)).toFixed(2) })) : [];
  });
  // LMT laat zien hoe een aanvulling van Alpha Vantage eruitziet (koersdoel zonder bandbreedte, verkregen/afgestaan)
  if (research.LMT) {
    const L = research.LMT;
    L.target = { mean: L.target.mean, median: null, high: null, low: null, updated: dIn(-1) };
    L.insider = [{ name: 'Voorbeeld bestuurder', date: dIn(-12), code: 'DS', change: -1200, price: 470, shares: null }, { name: 'Voorbeeld directeur', date: dIn(-40), code: 'AQ', change: 3000, price: 0, shares: null }];
    L.src = { target: 'av', insider: 'av', news: 'av' };
  }
  const marketNews = { updated: iso(now), items: [1, 3, 5, 8, 12, 20, 26, 30].map((h, k) => ({ t: now.getTime() - h * HOUR,
    headline: ['Voorbeeld: centrale bank houdt rente gelijk', 'Voorbeeld: techaandelen stijgen na sterke cijfers', 'Voorbeeld: olieprijs daalt', 'Voorbeeld: euro sterker tegenover dollar',
      'Voorbeeld: chipmakers onder druk', 'Voorbeeld: inflatie in de VS lager dan verwacht', 'Voorbeeld: beurzen in Azië gemengd', 'Voorbeeld: overname in de zorgsector'][k] + ' (geen echt nieuws)',
    summary: 'Voorbeeldtekst; met een Finnhub-sleutel staat hier echt marktnieuws.', source: 'Voorbeeldbron', url: '#', related: '' })) };
  events.earnings.push({ ticker: 'NVDA', symbol: 'NVDA', date: dIn(9), epsEst: 1.31 });
  // Indexen (koersindex in dollars), 400 dagen
  const idxSer = (start, drift, vol) => { const out = []; let v = start; for (let k = 400; k >= 0; k--) { const d = new Date(now); d.setDate(d.getDate() - k); if (!(d.getDay() % 6)) continue; v *= 1 + drift + gauss() * vol; out.push([iso(d).slice(0, 10), +v.toFixed(2)]); } return out; };
  const fxRates = { USD: [], GBP: [] };
  let rU = 1.06, rG = 0.84;
  for (let k = 400; k >= 0; k--) { const d = new Date(now); d.setDate(d.getDate() - k); if (!(d.getDay() % 6)) continue; rU *= 1 + gauss() * 0.003 + 0.00012; rG *= 1 + gauss() * 0.002; fxRates.USD.push([iso(d).slice(0, 10), +rU.toFixed(4)]); fxRates.GBP.push([iso(d).slice(0, 10), +rG.toFixed(4)]); }
  const hser = (rate, end) => { const out = []; let v = end; const d = new Date(now); d.setDate(1); d.setMonth(d.getMonth() - 1); for (let k = 0; k < 72; k++) { out.unshift([d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), +v.toFixed(2)]); v /= 1 + rate / 12 + gauss() * 0.002; d.setMonth(d.getMonth() - 1); } return out; };
  const extraDemo = {
    research, fin,
    fx: { updated: iso(now), source: 'Voorbeeld', rates: fxRates },
    hicp: { updated: iso(now), source: 'Voorbeeld', series: { NL: hser(0.034, 101.9), U2: hser(0.026, 101.3) } },
    idx: { updated: iso(now), source: 'Voorbeeld', series: { SP500: idxSer(6100, 0.0004, 0.009), NASDAQ100: idxSer(21000, 0.0005, 0.012) } },
    features: { flags: { fx: true, inflation: true, sec: true, etfAuto: true }, has: { fmp: true, finnhub: true, sec: true, t212: true } },
  };

  // Marktoverzicht, maatstaven, deponeringen, 13F, economische agenda, pies, cijferdata en rente (voorbeelden)
  Object.assign(extraDemo.idx.series, { VIXCLS: idxSer(17, 0, 0).map(([d], k) => [d, +(16 + 4 * Math.sin(k / 9) + rnd() * 2).toFixed(2)]), DGS10: idxSer(4.3, 0, 0.006), ECBDFR: idxSer(2, 0, 0).map(([d]) => [d, 2]) });
  [['URTH', 160, 0.0003], ['VT', 125, 0.0003], ['VGK', 72, 0.0002], ['EWN', 52, 0.0002]].forEach(([sym, v0, dr]) => { market.prices[sym] = idxSer(v0, dr, 0.009); });
  const demoSyms = Object.keys(META_INFO).filter((tk) => !/^(VUAG|SXRV|SPCX)$/.test(tk));
  const forms = [['10-Q', '', -9], ['8-K', '2.02', -10], ['8-K', '5.02', -34], ['DEF 14A', '', -60], ['10-K', '', -110]];
  const filingsPer = {};
  demoSyms.slice(0, 5).forEach((tk, i) => { filingsPer[tk] = { checked: dIn(0), list: forms.map(([f, it, d], k) => ({ date: dIn(d - i * 3 - k), form: f, desc: f, items: it, url: 'https://www.sec.gov/' })) }; });
  const f13top = (names) => names.map(([nm, pct, chg], k) => ({ name: nm, value: Math.round(pct * 2.6e11), shares: 1e6 * (20 - k), pct, chg, isNew: chg === null && k === names.length - 1 }));
  // Twee bestuurders die kort na elkaar zelf kopen (voor 'Insiders die samen kopen')
  if (research.MSFT) research.MSFT.insider = [{ name: 'Voorbeeld, D.', date: dIn(-6), code: 'P', change: 800, price: 410, shares: null }, { name: 'Voorbeeld, E.', date: dIn(-15), code: 'P', change: 1500, price: 402, shares: null }].concat(research.MSFT.insider || []);
  extraDemo.ext2 = {
    filings: { updated: iso(now), per: filingsPer },
    f13: { updated: dIn(-2), funds: [
      { cik: 1067983, label: 'Berkshire Hathaway (Warren Buffett)', period: (new Date().getFullYear()) + '-09-30', filed: dIn(-3), total: 2.6e11, n: 41, top: f13top([['APPLE INC', 0.22, -0.13], ['AMERICAN EXPRESS CO', 0.16, 0], ['BANK AMER CORP', 0.11, -0.07], ['COCA COLA CO', 0.1, 0], ['CHEVRON CORP NEW', 0.07, 0.04], ['OCCIDENTAL PETE CORP', 0.05, 0], ['MOODYS CORP', 0.04, 0], ['KRAFT HEINZ CO', 0.03, 0], ['CHUBB LIMITED', 0.03, 0.12], ['ALPHABET INC', 0.02, null]]), names: ['APPLE INC', 'COCA COLA CO', 'ALPHABET INC', 'AMERICAN EXPRESS CO'] },
      { cik: 1336528, label: 'Pershing Square (Bill Ackman)', period: (new Date().getFullYear()) + '-09-30', filed: dIn(-4), total: 1.4e10, n: 11, top: f13top([['UBER TECHNOLOGIES INC', 0.2, 0.05], ['BROOKFIELD CORP', 0.17, 0], ['ALPHABET INC', 0.15, -0.02], ['RESTAURANT BRANDS INTL INC', 0.13, 0], ['HILTON WORLDWIDE HLDGS INC', 0.11, -0.1], ['AMAZON COM INC', 0.08, null]]), names: ['ALPHABET INC', 'AMAZON COM INC', 'UBER TECHNOLOGIES INC'] }] },
    econ: { updated: iso(now), source: 'Voorbeeld', items: [[6, 'Consumer Price Index'], [9, 'Employment Situation'], [16, 'Gross Domestic Product'], [22, 'FOMC Press Release'], [30, 'Personal Income and Outlays']].map(([d, n]) => ({ date: dIn(d), name: n })) },
    pies: { updated: iso(now), list: [
      { id: 1, name: 'Dividend', invested: 420, value: 451.3, result: 31.3, resultPct: 0.0745, cash: 0.42, divGained: 9.8, progress: 0.45, goal: 1000, instruments: [{ tk: 'KO', target: 0.4, share: 0.41 }, { tk: 'MSFT', target: 0.3, share: 0.31 }, { tk: 'ASML', target: 0.3, share: 0.28 }] },
      { id: 2, name: 'Chips', invested: 250, value: 238.9, result: -11.1, resultPct: -0.0444, cash: 0, divGained: 0.6, progress: null, goal: null, instruments: [{ tk: 'TSM', target: 0.5, share: 0.47 }, { tk: 'NVDA', target: 0.5, share: 0.53 }] }] },
    earnHist: Object.fromEntries(demoSyms.slice(0, 6).map((tk, i) => [tk, [dIn(-12 - i * 2), dIn(-102 - i * 2), dIn(-193 - i * 2), dIn(-284 - i * 2)]])),
    interest: Array.from({ length: 10 }, (_, k) => ({ date: dIn(-30 * k - 2), amount: +(0.08 + rnd() * 0.12).toFixed(2) })).reverse(),
  };

  // Aankoopdagboek en andere rekeningen (voorbeelden)
  const demoNotes = {};
  const firstBuy = (tk) => orders.find((o) => o[1] === tk && o[3] === 'BUY');
  [['ASML', 'Marktleider in chipmachines; wil meer Europa in mijn portefeuille.'], ['KO', 'Rustig dividendaandeel als tegenwicht voor techniek.'],
    ['PLTR', 'Gok op groei in software voor overheden; klein gehouden.'], ['NVDA', 'Korte termijn na de cijfers, verkocht met winst.'], ['MSFT', 'Cloud en kantoorsoftware, voor de lange termijn.']]
    .forEach(([tk, txt]) => { const o = firstBuy(tk); if (o) demoNotes[tk + '|' + new Date(o[0]).getTime()] = txt; });
  const demoAccounts = [{ id: 'demo1', name: 'Pensioenrekening', broker: 'Voorbeeldbroker', cash: 35.2, updated: dIn(-6),
    holdings: [{ name: 'iShares Core MSCI World', tk: 'IWDA', isin: 'IE00B4L5Y983', qty: 9, value: 912.4, cost: 801 },
      { name: 'Vanguard FTSE All-World', tk: 'VWRL', isin: 'IE00B3RBWM25', qty: 4, value: 488.1, cost: 452 },
      { name: 'ASML Holding', tk: 'ASML', isin: 'NL0010273215', qty: 0.5, value: 318, cost: 290 }] }];
  const yNow = new Date().getFullYear();
  const peilDemo = [{ date: yNow + '-01-01', total: 1180.55, investments: 1131.2, cash: 49.35, positions: [] }, { date: (yNow - 1) + '-01-01', total: 742.1, investments: 700.4, cash: 41.7, positions: [] }];
  return Object.assign({
    ok: true, generated: iso(now), currency: 'EUR', weeks, positionsDate: iso(now), positions, today, events, market, marketNews, demoNotes, demoAccounts,
    orders: { columns: ['time', 'ticker', 'name', 'side', 'qty', 'price', 'currency', 'fxRate', 'net', 'realised', 'feeFx', 'feeOther', 'kind'], rows: orders },
    posExtra, etf, peil: peilDemo, settings: {},
    intraday: { columns: ['time', 'ticker', 'value'], rows: intraday },
    hours: { columns: ['hour', 'ticker', 'open', 'close', 'low', 'high', 'avg'], rows: hours },
    days: { columns: ['date', 'ticker', 'open', 'close', 'low', 'high', 'avg', 'range', 'rangePct'], rows: days },
  }, extraDemo);
}
