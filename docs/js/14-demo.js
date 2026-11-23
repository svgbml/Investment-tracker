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
  // De 25 grootste Amerikaanse bedrijven uit de S&P 500, naar gewicht in de index, samen 9600 euro ingelegd.
  // ticker, naam, gewicht in de S&P 500 (%), beweeglijkheid per dag, rendement sinds aankoop, koers in euro
  const INVEST = 9600;
  /** @type {[string, string, number, number, number, number][]} */
  const sp25 = [
    ['NVDA', 'NVIDIA', 7.9, 0.022, 0.142, 159], ['MSFT', 'Microsoft', 6.6, 0.012, -0.022, 438], ['AAPL', 'Apple', 6.4, 0.012, -0.014, 233],
    ['GOOGL', 'Alphabet (Class A)', 4.3, 0.015, 0.068, 251], ['AMZN', 'Amazon', 4.1, 0.016, -0.041, 205], ['META', 'Meta Platforms', 2.6, 0.017, -0.063, 612],
    ['AVGO', 'Broadcom', 2.5, 0.021, 0.096, 302], ['TSLA', 'Tesla', 2.0, 0.03, -0.087, 371], ['BRKB', 'Berkshire Hathaway (Class B)', 1.6, 0.008, 0.024, 427],
    ['JPM', 'JPMorgan Chase', 1.5, 0.011, 0.051, 263], ['LLY', 'Eli Lilly', 1.3, 0.016, -0.098, 701], ['V', 'Visa (Class A)', 1.0, 0.009, 0.018, 293],
    ['XOM', 'Exxon Mobil', 0.9, 0.012, -0.031, 99], ['ORCL', 'Oracle', 0.9, 0.022, 0.113, 198], ['WMT', 'Walmart', 0.9, 0.009, 0.047, 88],
    ['MA', 'Mastercard (Class A)', 0.8, 0.009, 0.022, 483], ['NFLX', 'Netflix', 0.8, 0.018, 0.064, 95], ['JNJ', 'Johnson & Johnson', 0.7, 0.008, 0.012, 168],
    ['PLTR', 'Palantir', 0.7, 0.03, 0.127, 152], ['COST', 'Costco', 0.7, 0.01, -0.016, 793], ['AMD', 'Advanced Micro Devices', 0.6, 0.026, 0.083, 207],
    ['ABBV', 'AbbVie', 0.6, 0.011, 0.029, 194], ['HD', 'Home Depot', 0.6, 0.011, -0.027, 319], ['BAC', 'Bank of America', 0.6, 0.012, 0.035, 45],
    ['PG', 'Procter & Gamble', 0.6, 0.007, 0.006, 129],
  ];
  const spW = sum(sp25.map((b) => b[2]));
  // waarde nu = inleg × (1 + rendement), zodat de kostprijs van alle posities samen INVEST is
  /** @type {[string, string, number, number, number, number][]} */
  const book = sp25.map(([tk, nm, w, vol, ret, price]) => [tk, nm, Math.round(INVEST * w / spW * (1 + ret) * 100) / 100, vol, ret, price]);
  book.push(['INTC', 'Intel', 110, 0.02, -0.05, 22]);   // vandaag verkocht, telt niet mee in de 25
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
  /** @type {{ t: Date, net: number } | null} */
  let aaplBuy = null;
  /** @type {{ t: Date, net: number, qty: number } | null} */
  let intcSell = null;

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
      // AAPL: bijgekocht eergisteren rond 13:00, zodat de detailgrafiek laat zien dat de aankoop niet als sprong in de lijn staat
      const aaplPre = (s) => tk === 'AAPL' && (di < nD - 2 || (di === nD - 2 && s < 30));
      // NVDA: vandaag rond 10:00 bijgekocht, nog zonder order in de geschiedenis (die komt later binnen);
      // het aantal stuks per meting laat zien dat de sprong een aankoop is en geen koersstijging
      const nvdaPre = (s) => tk === 'NVDA' && di === nD - 1 && lastSlots > 14 && s < 12;
      const fac = (s) => (tk === 'PG' && (di < buyDay || (di === buyDay && s < 30)) ? 0.5 : aaplPre(s) ? 0.85 : nvdaPre(s) ? 0.6 : 1);
      // INTC: vandaag om ± 10:40 helemaal verkocht; daarna komt hij niet meer in de metingen voor
      const sold = tk === 'INTC' && di === nD - 1 && lastSlots > 18;
      const vals = pts.map((x, s) => r2(x * scale * fac(s))).filter((_, s) => !sold || s < 16);
      if (sold) { const t = new Date(day); t.setHours(10, 40, 0, 0); intcSell = { t, net: vals[vals.length - 1], qty: +(Number(target) / Number(price)).toFixed(6) }; }
      if (tk === 'AAPL' && di === nD - 2) { const t = new Date(day); t.setHours(12, 55, 0, 0); aaplBuy = { t, net: r2(pts[30] * scale * 0.15) }; }
      vals.forEach((x) => { ath = Math.max(ath, x); atl = Math.min(atl, x); });
      if (di >= nD - 3) vals.forEach((x, s) => { const t = new Date(day); t.setHours(8, s * 10, 0, 0); const k = iso(t); intraday.push([k, tk, x, +(Number(target) / Number(price) * fac(s)).toFixed(6)]); add(tot.intra, k, { v: x }); });
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
        if (!sold) positions.push({ ticker: tk, name, value: o.close, unrealized: r2(o.close - cost), cost, resultPct: ret, quantity: +(o.close / price).toFixed(6) });
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
    if (wi === 3 || wi === 7 || wi === 11) { newDep = 50; cash += 50; }
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
  // Inleg zo verschuiven dat er nu INVEST in aandelen zit plus het vrije saldo; de weekverschillen blijven gelijk
  const depShift = weeks.length ? r2(INVEST + cash - weeks[weeks.length - 1].netDeposits) : 0;
  weeks.forEach((w) => { w.netDeposits = r2(w.netDeposits + depShift); w.totalResult = r2(w.accountValue - w.netDeposits); w.totalResultPct = w.totalResult / w.netDeposits; });

  // Agenda: datums ten opzichte van vandaag
  const dIn = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return iso(d).slice(0, 10); };
  const events = {
    updated: iso(now), fmp: true, errors: [],
    // ticker, dagen geleden, bruto per aandeel (dollar), aantal; netto = na 15% bronbelasting, omgerekend naar euro
    received: [
      ['PG', -375, 1.01, 0.44], ['PG', -320, 1.01, 0.44], ['PG', -229, 1.06, 0.44], ['PG', -138, 1.06, 0.44], ['PG', -47, 1.06, 0.87],
      ['MSFT', -341, 0.75, 2.8], ['MSFT', -250, 0.75, 2.8], ['MSFT', -160, 0.83, 2.8], ['MSFT', -68, 0.83, 2.8],
      ['AAPL', -372, 0.24, 5.2], ['AAPL', -190, 0.25, 5.2], ['AAPL', -99, 0.25, 5.2], ['AAPL', -8, 0.26, 5.2],
      ['JNJ', -370, 1.24, 0.78], ['JNJ', -120, 1.3, 0.78], ['JNJ', -30, 1.3, 0.78],
    ].map(([ticker, n, perShare, qty]) => ({ ticker, date: dIn(n), amount: Math.round(perShare * qty * 0.85 / 1.09 * 100) / 100, perShare, qty })),
    earnings: [['AAPL', 6, 2.35], ['MSFT', 9, 3.1], ['META', 12, 6.7], ['GOOGL', 15, 2.6], ['AMZN', 19, 1.9], ['NVDA', 23, 1.31], ['AVGO', 27, 1.95], ['PLTR', 34, 0.21], ['PG', 41, 1.9]]
      .map(([ticker, n, epsEst]) => ({ ticker, symbol: ticker, date: dIn(n), epsEst, revEst: null })),
    lastEarnings: [{ ticker: 'AAPL', date: dIn(-84), eps: 1.85, epsEst: 1.77 }, { ticker: 'MSFT', date: dIn(-81), eps: 3.46, epsEst: 3.66 }],
    dividends: [{ ticker: 'PG', exDate: dIn(10), payDate: dIn(29), perShare: 1.06, estEur: 0.68, announced: true },
      { ticker: 'JPM', exDate: dIn(4), payDate: dIn(16), perShare: 1.5, estEur: 1.18, announced: true }],
  };

  // Markt: sectoren, branches en vergelijkbare bedrijven
  const META_INFO = {
    NVDA: ['Technology', 'Semiconductors', ['AMD', 'AVGO', 'INTC', 'TSM']], MSFT: ['Technology', 'Software - Infrastructure', ['ORCL', 'GOOGL', 'CRM', 'PLTR']],
    AAPL: ['Technology', 'Consumer Electronics', ['MSFT', 'SONY', 'DELL', 'HPQ']], GOOGL: ['Communication Services', 'Internet Content & Information', ['META', 'MSFT', 'AMZN', 'NFLX']],
    AMZN: ['Consumer Cyclical', 'Internet Retail', ['WMT', 'BABA', 'EBAY', 'SHOP']], META: ['Communication Services', 'Internet Content & Information', ['GOOGL', 'SNAP', 'PINS', 'RDDT']],
    AVGO: ['Technology', 'Semiconductors', ['NVDA', 'QCOM', 'MRVL', 'TXN']], TSLA: ['Consumer Cyclical', 'Auto - Manufacturers', ['GM', 'F', 'RIVN', 'TM']],
    BRKB: ['Financial Services', 'Insurance - Diversified', ['MKL', 'CB', 'AIG', 'L']], JPM: ['Financial Services', 'Banks - Diversified', ['BAC', 'WFC', 'C', 'GS']],
    LLY: ['Healthcare', 'Drug Manufacturers - General', ['JNJ', 'ABBV', 'MRK', 'NVO', 'AZN']], V: ['Financial Services', 'Credit Services', ['MA', 'AXP', 'PYPL']],
    XOM: ['Energy', 'Oil & Gas Integrated', ['CVX', 'SHEL', 'TTE', 'COP']], ORCL: ['Technology', 'Software - Infrastructure', ['MSFT', 'SAP', 'CRM', 'IBM']],
    WMT: ['Consumer Defensive', 'Discount Stores', ['COST', 'TGT', 'DG', 'AMZN']], MA: ['Financial Services', 'Credit Services', ['V', 'AXP', 'PYPL']],
    NFLX: ['Communication Services', 'Entertainment', ['DIS', 'WBD', 'SPOT', 'ROKU']], JNJ: ['Healthcare', 'Drug Manufacturers - General', ['PFE', 'MRK', 'ABBV', 'LLY']],
    PLTR: ['Technology', 'Software - Infrastructure', ['SNOW', 'CRWD', 'MSFT', 'ORCL']], COST: ['Consumer Defensive', 'Discount Stores', ['WMT', 'TGT', 'BJ']],
    AMD: ['Technology', 'Semiconductors', ['NVDA', 'INTC', 'QCOM', 'ARM']], ABBV: ['Healthcare', 'Drug Manufacturers - General', ['JNJ', 'MRK', 'PFE', 'BMY']],
    HD: ['Consumer Cyclical', 'Home Improvement Retail', ['LOW', 'FND', 'TSCO']], BAC: ['Financial Services', 'Banks - Diversified', ['JPM', 'WFC', 'C', 'USB']],
    PG: ['Consumer Defensive', 'Household & Personal Products', ['KO', 'PEP', 'CL', 'KMB']],
  };
  const mDays = [];
  const md = new Date(now); md.setDate(md.getDate() - 1);
  while (mDays.length < 25) { if (md.getDay() % 6) mDays.unshift(iso(md).slice(0, 10)); md.setDate(md.getDate() - 1); }
  // Land per voorbeeldbedrijf, zodat de doorkijk per land iets te laten zien heeft
  const CTRY = { ASML: 'NL', TSM: 'TW', SONY: 'JP', NVO: 'DK', AZN: 'GB', BABA: 'CN', SHOP: 'CA', NTES: 'CN', EBAY: 'US', SPCX: 'US' };
  const profiles = {}, prices = {}, peersMk = {}, symbols = {};
  const sectorOfSym = {};
  Object.entries(META_INFO).forEach(([tk, [sec, ind, prs]]) => { symbols[tk] = tk; peersMk[tk] = prs; sectorOfSym[tk] = [sec, ind]; prs.forEach((x) => { if (!sectorOfSym[x]) sectorOfSym[x] = [sec, ind]; }); });
  // Volglijst: niet in bezit, wel een profiel
  Object.assign(sectorOfSym, { ASML: ['Technology', 'Semiconductor Equipment & Materials'], LMT: ['Industrials', 'Aerospace & Defense'] });
  Object.entries(sectorOfSym).forEach(([sym, [sec, ind]], i) => {
    const price = 40 + rnd() * 600, lo = price * (0.55 + rnd() * 0.3), hi = price * (1.02 + rnd() * 0.4);
    profiles[sym] = { symbol: sym, name: (book.find((b) => b[0] === sym) || [0, sym + ' Corporation'])[1], price: +price.toFixed(2), currency: 'USD',
      marketCap: Math.round((0.02 + rnd() * 3) * 1e12), beta: +(0.4 + rnd() * 1.6).toFixed(2), range: lo.toFixed(2) + '-' + hi.toFixed(2),
      change: +(gauss() * 1.4).toFixed(2), sector: sec, industry: ind, exchange: i % 2 ? 'NYSE' : 'NASDAQ', country: CTRY[sym] || 'US', ipoDate: (1980 + Math.floor(rnd() * 40)) + '-06-15' };
    let v = price;
    const hist = i % 3 === 2 ? mDays.slice(-1) : mDays;
    prices[sym] = hist.slice().reverse().map((d) => { const out = [d, +v.toFixed(2)]; v /= 1 + gauss() * 0.015; return out; }).reverse();
  });
  // Sectorrotatie (idee 51) heeft een half jaar dagveranderingen nodig, dus een langere reeks dagen
  const rotDays = [];
  const rd = new Date(now); rd.setDate(rd.getDate() - 1);
  while (rotDays.length < 190) { if (rd.getDay() % 6) rotDays.unshift(iso(rd).slice(0, 10)); rd.setDate(rd.getDate() - 1); }
  const sectorsMk = {}, industriesMk = {};
  ['Technology', 'Healthcare', 'Industrials', 'Communication Services', 'Consumer Cyclical', 'Consumer Defensive', 'Financial Services', 'Energy', 'Basic Materials', 'Real Estate', 'Utilities']
    .forEach((sec) => { const drift = gauss() * 0.15; sectorsMk[sec] = { NASDAQ: rotDays.map((d) => [d, +(drift + gauss() * 0.8).toFixed(3)]), NYSE: rotDays.map((d) => [d, +(drift + gauss() * 0.7).toFixed(3)]) }; });
  new Set(Object.values(sectorOfSym).map((x) => x[1])).forEach((ind) => { const drift = gauss() * 0.2; industriesMk[ind] = { NASDAQ: mDays.map((d) => [d, +(drift + gauss() * 1.1).toFixed(3)]), NYSE: mDays.map((d) => [d, +(drift + gauss() * 1).toFixed(3)]) }; });
  // Waardering: koers-winstverhouding en dividendrendement, nu en per jaar (voorbeelden)
  const valuation = {};
  const DIV_DEMO = { PG: 0.025, JNJ: 0.031, ABBV: 0.032, XOM: 0.035, HD: 0.025, BAC: 0.022, JPM: 0.02, AVGO: 0.012, WMT: 0.01, ORCL: 0.009, V: 0.008,
    MSFT: 0.007, LLY: 0.007, MA: 0.005, COST: 0.005, AAPL: 0.0045, GOOGL: 0.004, META: 0.003, NVDA: 0.0003, ASML: 0.009 };
  Object.keys(profiles).forEach((sym) => {
    const base = 14 + rnd() * 40, dy = DIV_DEMO[sym] || 0;
    const yrs = [2021, 2022, 2023, 2024, 2025];
    // PLTR maakte tot 2022 verlies: dan geen koers-winstverhouding
    valuation[sym] = { updated: dIn(sym === 'PG' ? -14 : -3), pe: +(base * (0.85 + rnd() * 0.4)).toFixed(1), dy: dy || null,
      hist: yrs.map((y) => [String(y), sym === 'PLTR' && y < 2023 ? null : +(base * (0.7 + rnd() * 0.6)).toFixed(1), dy ? +(dy * (0.8 + rnd() * 0.4)).toFixed(4) : null]) };
  });
  const sectorPe = { date: mDays[mDays.length - 1], sectors: { Technology: 38.5, 'Communication Services': 24.1, Healthcare: 27.3, Industrials: 26.8, 'Consumer Cyclical': 29.9, 'Consumer Defensive': 22.4, 'Financial Services': 17.2, Energy: 13.1 } };
  const market = { symbols, peers: peersMk, profiles, prices, sectors: sectorsMk, industries: industriesMk, updated: mDays[mDays.length - 1], watch: ['ASML', 'LMT'], valuation, sectorPe };

  // Transacties, valuta en fondssamenstelling
  const orders = [], posExtra = {};
  const curOf = (tk) => (['VUAG', 'SXRV'].includes(tk) ? 'GBX' : tk === 'ASML' ? 'EUR' : 'USD');
  positions.forEach((pp, i) => {
    const cur = curOf(pp.ticker);
    const fxr = cur === 'USD' ? 1.08 + rnd() * 0.06 : 1;
    const nativeNow = cur === 'USD' ? pp.value / pp.quantity * 1.16 : cur === 'GBX' ? pp.value / pp.quantity * 85 : pp.value / pp.quantity;
    const fxImp = cur === 'USD' ? +(-pp.cost * (0.01 + rnd() * 0.03)).toFixed(2) : cur === 'GBX' ? +(pp.cost * (rnd() - 0.5) * 0.02).toFixed(2) : null;
    posExtra[pp.ticker] = { avg: +(nativeNow / (1 + pp.resultPct) * (cur === 'USD' ? 1.02 : 1)).toFixed(2), price: +nativeNow.toFixed(2), cur, fx: fxImp, cost: pp.cost };
    // Noteringen zoals OpenFIGI ze geeft (beurscodes); ASML noteert in Amsterdam en de VS, de fondsen alleen in Europa
    const FX_EX = { ASML: ['NA', 'US', 'UW', 'GY'], VUAG: ['LN', 'GY'], SXRV: ['GY', 'LN'] };
    posExtra[pp.ticker].figi = FX_EX[pp.ticker] ? { us: pp.ticker === 'ASML' ? 'ASML' : null, fund: pp.ticker !== 'ASML', type: pp.ticker === 'ASML' ? 'Common Stock' : 'Mutual Fund', ex: FX_EX[pp.ticker] }
      : { us: pp.ticker, fund: false, type: 'Common Stock', ex: ['US', 'UN', 'GY'] };
    const nBuys = 1 + (i % 3);
    for (let k = 0; k < nBuys; k++) {
      const d = new Date(dates[Math.max(0, nD - 60 + k * 17 + i)]); d.setHours(15, 30 + i, 0, 0);
      // Idee 55: de eerste aankoop van PG ligt ruim een half jaar terug, zodat de vraag "klopt je reden nog?" te zien is
      if (pp.ticker === 'PG' && k === 0) d.setDate(d.getDate() - 190);
      const q = pp.quantity / nBuys, net = +(pp.cost / nBuys).toFixed(2);
      orders.push([iso(d), pp.ticker, pp.name, 'BUY', +q.toFixed(6), +(posExtra[pp.ticker].avg).toFixed(2), cur, fxr, net, 0, cur === 'USD' ? +(net * 0.0015).toFixed(2) : 0, 0, 'TRADE']);
    }
  });
  const dSell = new Date(dates[nD - 20]); dSell.setHours(16, 5, 0, 0);
  orders.push([iso(new Date(dates[nD - 58])), 'CRM', 'Salesforce', 'BUY', 0.4, 252.5, 'USD', 1.09, 92.66, 0, 0.14, 0, 'TRADE']);
  orders.push([iso(dSell), 'CRM', 'Salesforce', 'SELL', 0.4, 279.6, 'USD', 1.12, 99.86, 7.2, 0.15, 0, 'TRADE']);
  const dSell2 = new Date(dates[nD - 9]); dSell2.setHours(17, 40, 0, 0);
  orders.push([iso(dSell2), 'PLTR', 'Palantir', 'SELL', 0.05, 158.2, 'USD', 1.15, 6.88, 0.71, 0.01, 0, 'TRADE']);
  if (aaplBuy && posExtra.AAPL) orders.push([iso(aaplBuy.t), 'AAPL', 'Apple', 'BUY', +(aaplBuy.net * 1.16 / posExtra.AAPL.price).toFixed(6), posExtra.AAPL.price, 'USD', 1.16, aaplBuy.net, 0, +(aaplBuy.net * 0.0015).toFixed(2), 0, 'TRADE']);
  if (intcSell) {
    const dBuy = new Date(dates[nD - 40]); dBuy.setHours(15, 45, 0, 0);
    orders.push([iso(dBuy), 'INTC', 'Intel', 'BUY', intcSell.qty, 25.1, 'USD', 1.1, 118.4, 0, 0.18, 0, 'TRADE']);
    orders.push([iso(intcSell.t), 'INTC', 'Intel', 'SELL', intcSell.qty, +(intcSell.net / intcSell.qty * 1.16).toFixed(2), 'USD', 1.16, intcSell.net, +(intcSell.net - 118.4).toFixed(2), 0.17, 0, 'TRADE']);
  }
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
    const topic = ['stijgt na sterke cijfers', 'daalt na verlaagde verwachting', 'kondigt nieuw product aan', 'krijgt opwaardering van analist'];
    // Vier gewone berichten, en over het eerste onderwerp schrijven meteen drie bronnen (zo is het bundelen te zien)
    const sameEvent = ['Reuters', 'Bloomberg', 'CNBC'].map((src, k) => ({ t: day(1) - (k + 1) * 2.5 * HOUR,
      headline: 'Voorbeeld: ' + name + ' ' + topic[i % 4] + ' (geen echt nieuws)', source: src, url: '#bundel-' + tk + '-' + k,
      summary: 'Voorbeeldtekst van ' + src + ' over hetzelfde bericht.' }));
    research[tk] = {
      updated: tk === 'PG' ? dIn(-3) : iso(now),
      news: [1, 2, 4, 7].map((n, k) => ({ t: day(n), headline: 'Voorbeeld: ' + name + ' ' + topic[(k + i) % 4] + ' (geen echt nieuws)', source: 'Voorbeeldbron', url: '#' })).concat(sameEvent),
      rec: [0, 1, 2, 3].map((k) => ({ period: dIn(-30 * k).slice(0, 8) + '01', sb: 6 + ((i + k) % 5), b: 12 + ((i * 3 + k) % 7), h: 6 + (i % 6), s: (i + k) % 3, ss: (i % 4 === 0) ? 1 : 0 })),
      eps: [0, 1, 2, 3].map((k) => { const est = +(1 + rnd() * 3).toFixed(2); const pct = +((rnd() - 0.35) * 14).toFixed(1); return { period: dIn(-91 * k - 4 - (i % 25)), actual: +(est * (1 + pct / 100)).toFixed(2), estimate: est, pct }; }),
      insider: [3, 11, 25, 48, 77].map((n, k) => ({ name: ['Voorbeeld, A.', 'Voorbeeld, B.', 'Voorbeeld, C.'][k % 3], date: dIn(-n), code: ['S', 'M', 'S', 'P', 'F'][(k + i) % 5], change: (k + i) % 5 === 3 ? 800 : -1200 - k * 300, price: +(50 + rnd() * 300).toFixed(2), shares: 10000 })),
    };
    const base = (5 + rnd() * 300) * 1e9, margin = 0.05 + rnd() * 0.3;
    const yrs = [2020, 2021, 2022, 2023, 2024, 2025];
    let r = base;
    const rows = yrs.map((y) => { r *= 1 + (rnd() * 0.25 - 0.02); return [y, Math.round(r)]; });
    fin[tk] = { updated: tk === 'PG' ? dIn(-40) : dIn(-2), series: {
      rev: { unit: tk === 'TSM' ? 'TWD' : 'USD', rows: rows.map(([y, v]) => [y, tk === 'TSM' ? v * 30 : v]) },
      net: { unit: tk === 'TSM' ? 'TWD' : 'USD', rows: rows.map(([y, v], k) => [y, Math.round((tk === 'TSM' ? v * 30 : v) * (margin + (rnd() - 0.5) * 0.06) * (tk === 'PLTR' && k < 3 ? -0.4 : 1))]) },
      op: { unit: 'USD', rows: rows.map(([y, v]) => [y, Math.round(v * (margin + 0.05))]) },
      eps: { unit: 'USD/shares', rows: rows.map(([y], k) => [y, +(1 + k * 0.6 + rnd()).toFixed(2)]) },
    } };
  });
  // Koersdoel en nieuwsstemming, ook voor de volglijst (ASML, LMT)
  ['ASML', 'LMT'].forEach((tk, i) => { research[tk] = Object.assign({}, research.AAPL, { news: research.AAPL.news.map((n) => Object.assign({}, n, { headline: n.headline.replace('Apple', tk) })) }); fin[tk] = fin.MSFT; });
  fin.ASML = { updated: dIn(-2), none: 'Voorbeeld: geen SEC-gegevens voor dit bedrijf.' };
  Object.keys(research).forEach((tk) => {
    // Zelfde koers als de positie zelf, zodat koersdoel en koers bij elkaar passen
    const pr = (posExtra[tk] && posExtra[tk].price) || (profiles[tk] && profiles[tk].price) || (100 + rnd() * 300);
    research[tk].target = { mean: +(pr * (0.95 + rnd() * 0.3)).toFixed(2), median: +(pr * 1.05).toFixed(2), high: +(pr * 1.45).toFixed(2), low: +(pr * 0.7).toFixed(2), updated: dIn(-5) };
    // LMT (volglijst, defensie) positief, zodat de risicopagina een bedrijf toont dat de spreiding verbreedt
    const bull = tk === 'LMT' ? 0.68 : +(0.3 + rnd() * 0.5).toFixed(2);
    research[tk].sent = { bull, bear: +(1 - bull).toFixed(2), score: +(0.4 + rnd() * 0.5).toFixed(2), sector: 0.55, articles: Math.round(10 + rnd() * 80), buzz: 1 };
    // Koersen een jaar terug aanvullen (de voorbeeldmarkt heeft maar een paar weken), zodat de tijdlijn van
    // analisten en het scorebord van koersdoelen iets te tonen hebben
    const ph = prices[tk] || [];
    if (ph.length > 5) {
      const older = [];
      const d = new Date(ph[0][0]);
      let v = ph[0][1];
      for (let k = 0; k < 300; k++) {
        d.setDate(d.getDate() - 1);
        if (!(d.getDay() % 6)) continue;
        v /= 1 + gauss() * 0.013 + 0.0006;
        older.push([iso(d).slice(0, 10), +v.toFixed(2)]);
      }
      prices[tk] = older.reverse().concat(ph);
    }
    // Koersdoel-geschiedenis per week, voor de betrouwbaarheid en het scorebord van analisten
    const pl = prices[tk] || [];
    research[tk].targetHist = pl.length > 5 ? pl.filter((p, k) => k % 5 === 0).map(([d, v]) => ({ d, mean: +(v * (0.92 + rnd() * 0.26)).toFixed(2) })) : [];
    // Mening per dag (alleen dagen met een verandering), terug vanaf nu: [dag, sb, b, h, s, ss, koersdoel]
    const R0 = research[tk].rec[0], cur = [R0.sb, R0.b, R0.h, R0.s, R0.ss, research[tk].target.mean], rh = [];
    for (let n = tk.length % 3; n <= 110; n += 2 + Math.floor(rnd() * 8)) {
      rh.push([dIn(-n)].concat(cur));
      const k = Math.floor(rnd() * 4);
      if (k === 3) cur[5] = +(cur[5] * (1 + (rnd() - 0.4) * 0.06)).toFixed(2);
      else { const j = [0, 1, 2][k]; cur[j] = Math.max(0, cur[j] + (rnd() < 0.55 ? -1 : 1)); }
    }
    research[tk].recHist = rh.reverse();
  });
  // LMT laat zien hoe een aanvulling van Alpha Vantage eruitziet (koersdoel zonder bandbreedte, verkregen/afgestaan)
  if (research.LMT) {
    const L = research.LMT;
    L.target = { mean: L.target.mean, median: null, high: null, low: null, updated: dIn(-1) };
    L.insider = [{ name: 'Voorbeeld bestuurder', date: dIn(-12), code: 'DS', change: -1200, price: 470, shares: null }, { name: 'Voorbeeld directeur', date: dIn(-40), code: 'AQ', change: 3000, price: 0, shares: null }];
    L.src = { target: 'av', insider: 'av', news: 'av' };
  }
  // PLTR laat de reserves zonder Alpha Vantage zien: nieuws van Polygon, kwartaalwinst (zonder verwachting) en Form 4 van de SEC
  if (research.PLTR) {
    const P = research.PLTR;
    P.eps = P.eps.map((x, k) => ({ period: x.period, actual: +(0.21 - k * 0.03).toFixed(2), estimate: null, pct: null }));
    P.insider = [{ name: 'Voorbeeld, D.', date: dIn(-5), code: 'S', change: -15000, price: 148.2, shares: 420000 }, { name: 'Voorbeeld, E.', date: dIn(-19), code: 'P', change: 2000, price: 131.5, shares: 26000 },
      { name: 'Voorbeeld, D.', date: dIn(-33), code: 'M', change: 15000, price: 12.4, shares: 435000 }];
    P.src = { news: 'polygon', sent: 'polygon', eps: 'sec', insider: 'sec' };
  }
  // ASML laat het nieuws van GDELT zien (geen sleutel, geen stemming)
  if (research.ASML) research.ASML.src = Object.assign({}, research.ASML.src || {}, { news: 'gdelt' });
  const marketNews = { updated: iso(now), items: [1, 3, 5, 8, 12, 20, 26, 30].map((h, k) => ({ t: now.getTime() - h * HOUR,
    headline: ['Voorbeeld: centrale bank houdt rente gelijk', 'Voorbeeld: techaandelen stijgen na sterke cijfers', 'Voorbeeld: olieprijs daalt', 'Voorbeeld: euro sterker tegenover dollar',
      'Voorbeeld: chipmakers onder druk', 'Voorbeeld: inflatie in de VS lager dan verwacht', 'Voorbeeld: beurzen in Azië gemengd', 'Voorbeeld: overname in de zorgsector'][k] + ' (geen echt nieuws)',
    summary: 'Voorbeeldtekst; met een Finnhub-sleutel staat hier echt marktnieuws.', source: 'Voorbeeldbron', url: '#', related: '' })) };
  // Hetzelfde marktbericht bij meer bronnen, zodat het bundelen ook bij marktnieuws te zien is
  ['Reuters', 'Bloomberg', 'CNBC', 'FD', 'AP'].forEach((src, k) => marketNews.items.push({ t: now.getTime() - (1 + k) * 2 * HOUR,
    headline: 'Voorbeeld: centrale bank houdt rente gelijk (geen echt nieuws)', summary: 'Voorbeeldtekst van ' + src + ' over hetzelfde bericht.', source: src, url: '#bundel-markt-' + k, related: '' }));
  marketNews.items.sort((a, b) => b.t - a.t);
  events.earnings.push({ ticker: 'ASML', symbol: 'ASML', date: dIn(9), epsEst: 5.6 }, { ticker: 'LMT', symbol: 'LMT', date: dIn(17), epsEst: 6.8 });
  events.lastEarnings.push({ ticker: 'NVDA', date: dIn(-6), eps: 1.3, epsEst: 1.25 }, { ticker: 'PLTR', date: dIn(-13), eps: 0.19, epsEst: 0.21 });
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
    features: { flags: { fx: true, inflation: true, sec: true, etfAuto: true, openfigi: true, gdelt: true }, has: { fmp: true, finnhub: true, sec: true, tiingo: true, polygon: true, t212: true } },
  };

  // Marktoverzicht, maatstaven, deponeringen, 13F, economische agenda, pies, cijferdata en rente (voorbeelden)
  Object.assign(extraDemo.idx.series, { VIXCLS: idxSer(17, 0, 0).map(([d], k) => [d, +(16 + 4 * Math.sin(k / 9) + rnd() * 2).toFixed(2)]), DGS10: idxSer(4.3, 0, 0.006), ECBDFR: idxSer(2, 0, 0).map(([d]) => [d, 2]) });
  [['URTH', 160, 0.0003], ['VT', 125, 0.0003], ['VGK', 72, 0.0002], ['EWN', 52, 0.0002]].forEach(([sym, v0, dr]) => { market.prices[sym] = idxSer(v0, dr, 0.009); });
  const demoSyms = Object.keys(META_INFO);
  const forms = [['10-Q', '', -9], ['8-K', '2.02', -10], ['8-K', '5.02', -34], ['DEF 14A', '', -60], ['10-K', '', -110]];
  const filingsPer = {};
  demoSyms.slice(0, 5).forEach((tk, i) => { filingsPer[tk] = { checked: dIn(0), list: forms.map(([f, it, d], k) => ({ date: dIn(d - i * 3 - k), form: f, desc: f, items: it, url: 'https://www.sec.gov/' })) }; });
  const f13top = (names) => names.map(([nm, pct, chg], k) => ({ name: nm, value: Math.round(pct * 2.6e11), shares: 1e6 * (20 - k), pct, chg, isNew: chg === null && k === names.length - 1 }));
  // Twee bestuurders die kort na elkaar zelf kopen (voor 'Insiders die samen kopen')
  if (research.MSFT) research.MSFT.insider = [{ name: 'Voorbeeld, D.', date: dIn(-6), code: 'P', change: 800, price: 410, shares: null }, { name: 'Voorbeeld, E.', date: dIn(-15), code: 'P', change: 1500, price: 402, shares: null }].concat(research.MSFT.insider || []);
  extraDemo.ext2 = {
    filings: { updated: iso(now), per: filingsPer },
    f13: { updated: dIn(-2), funds: [
      { cik: 1067983, label: 'Berkshire Hathaway (Warren Buffett)', period: (new Date().getFullYear()) + '-09-30', filed: dIn(-3), total: 2.6e11, n: 41, top: f13top([['APPLE INC', 0.22, -0.13], ['AMERICAN EXPRESS CO', 0.16, 0], ['BANK AMER CORP', 0.11, -0.07], ['COCA COLA CO', 0.1, 0], ['CHEVRON CORP NEW', 0.07, 0.04], ['OCCIDENTAL PETE CORP', 0.05, 0], ['MOODYS CORP', 0.04, 0], ['KRAFT HEINZ CO', 0.03, 0], ['CHUBB LIMITED', 0.03, 0.12], ['ALPHABET INC', 0.02, null]]), names: ['APPLE INC', 'COCA COLA CO', 'ALPHABET INC', 'AMERICAN EXPRESS CO', 'BANK OF AMERICA CORP'] },
      { cik: 1336528, label: 'Pershing Square (Bill Ackman)', period: (new Date().getFullYear()) + '-09-30', filed: dIn(-4), total: 1.4e10, n: 11, top: f13top([['UBER TECHNOLOGIES INC', 0.2, 0.05], ['BROOKFIELD CORP', 0.17, 0], ['ALPHABET INC', 0.15, -0.02], ['RESTAURANT BRANDS INTL INC', 0.13, 0], ['HILTON WORLDWIDE HLDGS INC', 0.11, -0.1], ['AMAZON COM INC', 0.08, null]]), names: ['ALPHABET INC', 'AMAZON COM INC', 'UBER TECHNOLOGIES INC'] }] },
    econ: { updated: iso(now), source: 'Voorbeeld', items: [[6, 'Consumer Price Index'], [9, 'Employment Situation'], [16, 'Gross Domestic Product'], [22, 'FOMC Press Release'], [30, 'Personal Income and Outlays']].map(([d, n]) => ({ date: dIn(d), name: n })) },
    pies: { updated: iso(now), list: [
      { id: 1, name: 'Dividend', invested: 330, value: 352.4, result: 22.4, resultPct: 0.0679, cash: 0.42, divGained: 9.8, progress: 0.35, goal: 1000, instruments: [{ tk: 'PG', target: 0.33, share: 0.32 }, { tk: 'JNJ', target: 0.34, share: 0.36 }, { tk: 'ABBV', target: 0.33, share: 0.32 }] },
      { id: 2, name: 'Chips', invested: 1700, value: 1873.1, result: 173.1, resultPct: 0.1018, cash: 0, divGained: 0.6, progress: null, goal: null, instruments: [{ tk: 'NVDA', target: 0.6, share: 0.61 }, { tk: 'AVGO', target: 0.3, share: 0.31 }, { tk: 'AMD', target: 0.1, share: 0.08 }] }] },
    earnHist: Object.fromEntries(demoSyms.slice(0, 6).map((tk, i) => [tk, [dIn(-12 - i * 2), dIn(-102 - i * 2), dIn(-193 - i * 2), dIn(-284 - i * 2)]])),
    interest: Array.from({ length: 10 }, (_, k) => ({ date: dIn(-30 * k - 2), amount: +(0.08 + rnd() * 0.12).toFixed(2) })).reverse(),
  };

  // Aankoopdagboek en andere rekeningen (voorbeelden)
  const demoNotes = {};
  const firstBuy = (tk) => orders.find((o) => o[1] === tk && o[3] === 'BUY');
  [['NVDA', 'Grootste bedrijf in de S&P 500; gewogen naar marktwaarde, net als de index.'], ['PG', 'Rustig dividendaandeel als tegenwicht voor techniek.'],
    ['PLTR', 'Gok op groei in software voor overheden; klein gehouden.'], ['CRM', 'Korte termijn na de cijfers, verkocht met winst.'], ['MSFT', 'Cloud en kantoorsoftware, voor de lange termijn.']]
    .forEach(([tk, txt]) => { const o = firstBuy(tk); if (o) demoNotes[tk + '|' + new Date(o[0]).getTime()] = txt; });
  const demoAccounts = [{ id: 'demo1', name: 'Pensioenrekening', broker: 'Voorbeeldbroker', cash: 35.2, updated: dIn(-6),
    holdings: [{ name: 'iShares Core MSCI World', tk: 'IWDA', isin: 'IE00B4L5Y983', qty: 9, value: 912.4, cost: 801 },
      { name: 'Vanguard FTSE All-World', tk: 'VWRL', isin: 'IE00B3RBWM25', qty: 4, value: 488.1, cost: 452 },
      { name: 'ASML Holding', tk: 'ASML', isin: 'NL0010273215', qty: 0.5, value: 318, cost: 290 }] }];
  // Voorbeeldvoorkeuren voor de extra onderdelen op Plannen (gebeurtenissen, spaargeld, potjes per doel)
  const yNow0 = new Date().getFullYear();
  const demoPrefs = {
    lifeEvents: [
      { id: 'dev1', name: 'Eigen bijdrage huis', date: (yNow0 + 6) + '-06', amount: 8000, pause: 0 },
      { id: 'dev2', name: 'Studie: even geen inleg', date: (yNow0 + 2) + '-09', amount: 0, pause: 12 },
      { id: 'dev3', name: 'Tweedehands auto', date: (yNow0 + 3) + '-04', amount: 2500, pause: 0 },
    ],
    banks: [
      { id: 'dbk1', name: 'Spaarrekening', kind: 'spaar', amount: 4200, rate: 1.7, updated: dIn(-70) },
      { id: 'dbk2', name: 'Betaalrekening', kind: 'betaal', amount: 680, rate: 0, updated: dIn(-2) },
      { id: 'dbk3', name: 'Contant (voorbeeld)', kind: 'contant', amount: 120, rate: null, updated: dIn(-95) },
    ],
    goalPos: { NVDA: 'huis', MSFT: 'huis', AAPL: 'huis', PG: 'buffer', JNJ: 'buffer' },
    rebDone: {},
    realProj: false,
  };
  // Hoe vaak een bedrijfspagina is geopend (normaal per apparaat bijgehouden; hier een voorbeeld)
  const demoViews = {};
  demoViews[String(yNow0)] = { ASML: 23, NVDA: 17, MSFT: 12, PLTR: 9, PG: 5, AVGO: 4 };
  // Ideeën 56, 74 en 75: oefenboek, antwoorden op de vragenlijst en notities in het beslisdagboek
  const nvdaPr = (profiles.NVDA && profiles.NVDA.price) || 180;   // koersen uit de demo zelf, anders klopt het oefenresultaat niet
  const asmlPr = (posExtra.ASML && posExtra.ASML.price) || 636;
  const oefTrade = (id, dag, key, label, side, qty, pr, usd) => ({ id, t: dIn(dag) + (side === 'SELL' ? 'T11:30' : 'T10:12'), key, label, side, qty,
    eur: +(qty * pr / (usd ? 1.16 : 1)).toFixed(2), price: +pr.toFixed(2), cur: usd ? 'USD' : 'EUR' });
  const oefTrades = [oefTrade('oef1', -24, '~NVDA', 'NVDA', 'BUY', 1.2, nvdaPr * 0.94, true),
    oefTrade('oef2', -11, 'ASML', 'ASML', 'BUY', 0.3, asmlPr * 0.98, false),
    oefTrade('oef3', -4, '~NVDA', 'NVDA', 'SELL', 0.4, nvdaPr * 1.01, true)];
  const oefSaldo = oefTrades.reduce((v, x) => v + (x.side === 'SELL' ? x.eur : -x.eur), 1000);
  const demoTrade = {
    paper: { on: false, start: 1000, cash: +oefSaldo.toFixed(2), trades: oefTrades },
    sellCheck: { PG: { d: dIn(-9), a: { reden: 'ja', koop: 'ja', groot: 'ja', plan: 'weet', kosten: 'nee' } } },
    decisions: [
      { id: 'dec1', d: dIn(-6), key: 'PLTR', text: 'Een deel verkocht: de positie werd groter dan ik wilde en de waardering is hoog.' },
      { id: 'dec2', d: dIn(-52), key: 'MSFT', text: 'Bijgekocht na de daling; de reden van de eerste aankoop staat nog.' },
      { id: 'dec3', d: dIn(-400), key: '', text: 'Besloten elke maand hetzelfde bedrag in te leggen en niet meer op het nieuws te reageren.' },
    ],
  };
  const yNow = new Date().getFullYear();
  const peilDemo = [{ date: yNow + '-01-01', total: 8710.4, investments: 8661.05, cash: 49.35, positions: [] }, { date: (yNow - 1) + '-01-01', total: 6120.8, investments: 6079.1, cash: 41.7, positions: [] }];
  // Privacy en veiligheid: voorbeelden voor het meldingslogboek, het logboek, de apparaten en de vergelijking
  const demoPriv = {
    alerts: {
      rules: { move: 5, earnings: true, insider: true, drift: 5, quietFrom: 23, quietTo: 7, digest: false, digestHour: 18 },
      queue: [{ at: dIn(0), title: 'Voorbeeld: PLTR +6,1% vandaag' }],
      log: [
        { at: dIn(0), title: 'Voorbeeld: PLTR +6,1% vandaag', body: 'Palantir stijgt +6,1% sinds het slot van de vorige handelsdag.', mode: 'stille uren', devices: 0 },
        { at: dIn(-1), title: 'Voorbeeld: 3 meldingen van je tracker', body: '\u2022 AVGO +5,4% vandaag \u2022 MSFT: morgen kwartaalcijfers \u2022 Je verdeling wijkt af van je doel', mode: 'bundel', devices: 2, items: 3 },
        { at: dIn(-2), title: 'Voorbeeld: NVDA: morgen kwartaalcijfers', body: 'Verwachte winst per aandeel 1,31.', mode: 'direct', devices: 2 },
        { at: dIn(-5), title: 'Voorbeeld: MSFT boven 440', body: 'Je koersalarm ging af.', mode: 'direct', devices: 1 },
      ],
    },
    audit: { log: [
      { at: dIn(0), kind: 'inloggen', msg: 'ingelogd met de Trading 212-sleutel' },
      { at: dIn(0), kind: 'apparaat', msg: 'eigen code gemaakt voor iPhone/iPad' },
      { at: dIn(-1), kind: 'order', msg: 'order geplaatst: BUY AAPL' },
      { at: dIn(-3), kind: 'link', msg: 'deel-link gemaakt' },
      { at: dIn(-3), kind: 'link', msg: 'deel-link verloopt op ' + dIn(27).slice(0, 10) },
      { at: dIn(-9), kind: 'sleutel', msg: 'ingevuld of vervangen: FINNHUB_KEY' },
      { at: dIn(-12), kind: 'inloggen', msg: 'mislukte poging met een Trading 212-sleutel (1e deze keer)' },
    ] },
    devices: { master: false, current: 'demo1', devices: [
      { id: 'demo1', label: 'Mac', at: dIn(-30), seen: dIn(0), until: null },
      { id: 'demo2', label: 'iPhone/iPad', at: dIn(-12), seen: dIn(-1), until: null },
    ] },
    friend: { pct: { week: 0.0062, month: 0.0184, ytd: 0.1142, total: 0.0917 }, since: dIn(-60), generated: dIn(0), weeks: 40 },
  };
  // Officieel en geruchten (js/21-nieuwsplus.js): verzonnen berichten met de vorm die de Worker levert
  const newsFlash = [
    [40 / 60, 'NVDA', 'official', true, 'Business Wire', 'Voorbeeld: Nvidia benoemt een nieuwe financieel directeur'],
    [3, 'AAPL', 'rumour', true, 'Bloomberg', 'Voorbeeld: Apple zou in gesprek zijn over de overname van een chipontwerper, zeggen ingewijden'],
    [20, 'MSFT', 'official', false, 'PR Newswire', 'Voorbeeld: Microsoft presenteert op een investeerdersconferentie'],
    [44, 'AMZN', 'rumour', false, 'Reuters', 'Voorbeeld: Amazon overweegt naar verluidt de verkoop van een dochterbedrijf'],
    [70, 'TSLA', null, true, 'Reuters', 'Voorbeeld: toezichthouder opent onderzoek naar Tesla'],
  ].map(([h, tk, kind, breaking, source, headline], k) => Object.assign({ t: now.getTime() - Number(h) * HOUR, tk, source, headline: headline + ' (geen echt nieuws)', url: '#flash-' + k }, kind ? { kind } : {}, breaking ? { breaking } : {}));
  return Object.assign({
    ok: true, generated: iso(now), currency: 'EUR', weeks, positionsDate: iso(now), positions, today, events, market, marketNews, newsFlash, demoNotes, demoAccounts, demoPrefs, demoViews, demoPriv,
    orders: { columns: ['time', 'ticker', 'name', 'side', 'qty', 'price', 'currency', 'fxRate', 'net', 'realised', 'feeFx', 'feeOther', 'kind'], rows: orders },
    posExtra, etf, peil: peilDemo, settings: {}, demoTrade,
    intraday: { columns: ['time', 'ticker', 'value', 'qty'], rows: intraday },
    hours: { columns: ['hour', 'ticker', 'open', 'close', 'low', 'high', 'avg'], rows: hours },
    days: { columns: ['date', 'ticker', 'open', 'close', 'low', 'high', 'avg', 'range', 'rangePct'], rows: days },
  }, extraDemo);
}
