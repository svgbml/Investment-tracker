// Tests voor het rekenwerk en de opmaak van getallen, met bekende antwoorden.
// De site bestaat uit gewone scripts die één bereik delen; losse functies zijn daardoor niet uit Node te
// importeren. Daarom draaien deze tests in de pagina zelf (?demo, zonder netwerk), waar alle functies bestaan.
// Zo blijft de code waar hij staat (AGENTS.md: niets verplaatsen) en wordt toch precies gerekend.
//
// Wat getest wordt:
//   XIRR, TWR, drawdown, risicoklasse (srri), samenhang (correlatie), kwantiel,
//   Monte Carlo (mcSimulate), box 3, eigenschappen met 500 willekeurige gevallen (XIRR, TWR, FIFO) en de opmaakhulpjes eur, seur, spct, spct1, money, PCT0, P1, esc en tpl.
//
// Draaien: node tools/test-reken.mjs
//          node tools/test-reken.mjs --alles    ook de geslaagde tests tonen
import { serveDocs, playwright, openSite, realErrors } from './lib-browser.mjs';

const showAll = process.argv.includes('--alles');
const { chromium } = playwright();
const { base, close } = await serveDocs();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const { page, ctx, errors } = await openSite(browser, base, { size: 'desktop', theme: 'light' });

const results = await page.evaluate(() => {
  const out = [];
  const near = (a, b, eps) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= (eps == null ? 1e-9 : eps);
  // Intl zet een vast spatieteken tussen munt en getal; voor het vergelijken maken we dat een gewone spatie
  const nb = (v) => (typeof v === 'string' ? v.replace(/[\u00a0\u202f\u2060]/g, ' ').replace(/\s+/g, ' ') : v);
  const T = (naam, got, want, eps) => {
    const ok = typeof want === 'number' && typeof got === 'number' ? near(got, want, eps) : JSON.stringify(nb(got)) === JSON.stringify(nb(want));
    out.push({ naam, ok, got: String(got), want: String(want) });
  };
  const OK = (naam, cond, uitleg) => out.push({ naam, ok: !!cond, got: cond ? 'ja' : 'nee', want: uitleg || 'ja' });
  // Overgeslagen: de voorbeeldgegevens hebben hier niet genoeg voor. Geen fout, wel een melding.
  const SKIP = (naam, waarom) => out.push({ naam, ok: true, skip: waarom, got: '-', want: '-' });

  // ================= XIRR (geldgewogen rendement) =================
  const Y = YEAR_MS;
  T('xirr: 1000 inleg, 1100 na een jaar = 10% per jaar', xirrOf([{ t: 0, v: -1000 }, { t: Y, v: 1100 }]), 0.10, 1e-6);
  T('xirr: 1000 inleg, 1210 na twee jaar = 10% per jaar', xirrOf([{ t: 0, v: -1000 }, { t: 2 * Y, v: 1210 }]), 0.10, 1e-6);
  T('xirr: verlies, 1000 inleg en 900 na een jaar = −10%', xirrOf([{ t: 0, v: -1000 }, { t: Y, v: 900 }]), -0.10, 1e-6);
  // Meerdere stortingen: de netto contante waarde bij het gevonden rendement hoort nul te zijn
  const flows = [{ t: 0, v: -1000 }, { t: Y / 2, v: -500 }, { t: Y, v: 1650 }];
  const r3 = xirrOf(flows);
  const npv = (r) => flows.reduce((s, x) => s + x.v / Math.pow(1 + r, (x.t - flows[0].t) / Y), 0);
  OK('xirr: meerdere stortingen geven netto contante waarde nul', Math.abs(npv(r3)) < 1e-4, 'npv ≈ 0 (' + npv(r3).toFixed(8) + ')');
  T('xirr: alleen stortingen (geen opbrengst) kan niet', xirrOf([{ t: 0, v: -100 }, { t: Y, v: -100 }]), null);
  T('xirr: één stroom kan niet', xirrOf([{ t: 0, v: -100 }]), null);
  T('xirr: lege lijst kan niet', xirrOf([]), null);
  T('xirr: NaN-stromen worden overgeslagen', xirrOf([{ t: 0, v: -1000 }, { t: Y / 2, v: NaN }, { t: Y, v: 1100 }]), 0.10, 1e-6);

  // ================= TWR (tijdgewogen rendement) =================
  T('perYear: 21% over twee jaar is 10% per jaar', perYear(0.21, 2), 0.1, 1e-12);
  T('perYear: onder een jaar geeft niets', perYear(0.21, 0.5), null);
  const tw = accountTwr();
  if (tw) {
    // Zelfde som, los nagerekend: stortingen tellen niet als rendement
    const W = M.weeks.filter((w) => isNum(w.accountValue));
    let idx = 1;
    W.slice(1).forEach((w, i) => {
      const prev = W[i].accountValue, dep = isNum(w.newDeposits) ? w.newDeposits : 0;
      if (prev > 0) { const r = (w.accountValue - dep) / prev - 1; if (Math.abs(r) < 0.5) idx *= 1 + r; }
    });
    const last = W[W.length - 1];
    if (last.accountValue > 0 && M.accountNow > 0) { const r = M.accountNow / last.accountValue - 1; if (Math.abs(r) < 0.5) idx *= 1 + r; }
    T('twr account: gelijk aan de los nagerekende reeks', tw.total, idx - 1, 1e-12);
    OK('twr account: periode is een positief aantal jaren', tw.years > 0, '> 0');
  } else SKIP('twr account', 'te weinig weekmetingen in de voorbeeldgegevens');
  const ts = twrSeries(TOTAL);
  OK('twr reeks: begint op 1', ts.length > 1 && ts[0].v === 1, 'eerste waarde 1');
  OK('twr reeks: index is het product van de dagrendementen', (() => {
    let p = 1; ts.forEach((x) => { if (isNum(x.r)) p *= 1 + x.r; });
    return Math.abs(p - ts[ts.length - 1].v) < 1e-9;
  })(), 'product klopt');
  OK('twr reeks: eerste dag heeft geen rendement', ts[0].r === null, 'null');

  // ================= Drawdown (grootste daling vanaf een top) =================
  const D = drawdownModel(TOTAL);
  if (D) {
    let peak = -Infinity, worst = 0;
    twrSeries(TOTAL).forEach((p) => { peak = Math.max(peak, p.v); worst = Math.min(worst, p.v / peak - 1); });
    T('drawdown: gelijk aan de los nagerekende grootste daling', D.maxDd, worst, 1e-12);
    OK('drawdown: nooit positief', D.maxDd <= 0 && D.dd.every((x) => x.v <= 1e-12), '≤ 0');
    OK('drawdown: huidige daling niet erger dan de grootste', D.cur >= D.maxDd - 1e-12, 'cur ≥ maxDd');
    OK('drawdown: langste periode onder de top is een geheel aantal dagen', Number.isInteger(D.longest) && D.longest >= 0, 'geheel getal');
  } else SKIP('drawdown', 'te weinig dagen metingen in de voorbeeldgegevens');

  // ================= Risicoklasse (SRRI, CESR/10-673) =================
  [[0, 1], [0.004, 1], [0.005, 2], [0.0199, 2], [0.02, 3], [0.049, 3], [0.05, 4], [0.0999, 4], [0.10, 5], [0.1499, 5], [0.15, 6], [0.2499, 6], [0.25, 7], [1.5, 7]]
    .forEach(([vol, cls]) => T('srri: beweeglijkheid ' + vol + ' is klasse ' + cls, srri(vol), cls));
  T('srri: zonder beweeglijkheid geen klasse', srri(null), null);
  T('srri: NaN geeft geen klasse', srri(NaN), null);

  // ================= Kwantiel en spreidingsmaten =================
  T('kwantiel: midden van 1,2,3,4 is 2,5', quantile([1, 2, 3, 4], 0.5), 2.5);
  T('kwantiel: 0 geeft de laagste', quantile([3, 1, 2], 0), 1);
  T('kwantiel: 1 geeft de hoogste', quantile([3, 1, 2], 1), 3);
  T('kwantiel: lege lijst geeft niets', quantile([], 0.5), null);
  T('gemiddelde van 1..4', mean([1, 2, 3, 4]), 2.5);
  T('gemiddelde van niets', mean([]), null);
  T('standaardafwijking (steekproef) van 2,4,4,4,5,5,7,9', stdev([2, 4, 4, 4, 5, 5, 7, 9]), 2.13808993529939, 1e-12);
  T('standaardafwijking: één waarde geeft niets', stdev([5]), null);

  // ================= Samenhang (correlatie en beta) =================
  const tk = (M.companies.find((c) => statsFor(c.tk).corr != null) || {}).tk;
  if (tk) {
    const s = statsFor(tk);
    const tm = new Map(dailyReturns(TOTAL).map((d) => [dayKey(d.t), d.pct]));
    const pairs = dailyReturns(tk).map((d) => [d.pct, tm.get(dayKey(d.t))]).filter((p) => isNum(p[1]));
    const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
    let sxy = 0, sxx = 0, syy = 0;
    pairs.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
    T('correlatie ' + tk + ': gelijk aan de los nagerekende Pearson', s.corr, sxy / Math.sqrt(sxx * syy), 1e-12);
    T('beta ' + tk + ': gelijk aan covariantie gedeeld door variantie', s.beta, sxy / syy, 1e-12);
    OK('correlatie ligt tussen −1 en 1', s.corr >= -1 && s.corr <= 1, '−1…1');
  } else SKIP('correlatie', 'geen positie met genoeg dagen in de voorbeeldgegevens');
  T('correlatie van de hele portefeuille met zichzelf wordt niet gegeven', statsFor(TOTAL).corr, null);
  T('corrText: 0,8 is sterk', corrText(0.8, 99).split(' ')[0], 'sterk');
  T('corrText: 0,5 is matig', corrText(0.5, 99).split(' ')[0], 'matig');
  T('corrText: 0,2 is zwak', corrText(0.2, 99).split(' ')[0], 'zwak');
  T('corrText: 0 is geen', corrText(0, 99).split(' ')[0], 'geen');
  T('corrText: −0,5 is tegengesteld', corrText(-0.5, 99).split(' ')[0], 'tegengesteld');

  // ================= Monte Carlo (mcSimulate) =================
  // Zonder beweeglijkheid is de uitkomst de gewone samengestelde groei: dat is de bekende waarde.
  const mc1 = mcSimulate({ seed: 1, start: 1000, monthly: 0, months: 12, mu: 0.07, sigma: 0, runs: 10, targets: [] });
  T('monte carlo: zonder beweeglijkheid 1000 euro naar 1070 na een jaar', mc1.band[mc1.band.length - 1].p50, 1070, 1e-6);
  T('monte carlo: band houdt elke drie maanden een punt', mc1.band.length, 5);
  T('monte carlo: start staat vooraan', mc1.band[0].p50, 1000, 1e-9);
  OK('monte carlo: zonder beweeglijkheid liggen p10, p50 en p90 gelijk',
    near(mc1.band[4].p10, mc1.band[4].p90, 1e-6), 'p10 = p90');
  const mc2 = mcSimulate({ seed: 2, start: 0, monthly: 100, months: 24, mu: 0, sigma: 0, runs: 5, targets: [] });
  T('monte carlo: alleen inleg van 100 per maand geeft 2400 na twee jaar', mc2.band[mc2.band.length - 1].p50, 2400, 1e-6);
  const mc3 = mcSimulate({ seed: 3, start: 1000, monthly: 0, months: 12, mu: 0.07, sigma: 0, runs: 10,
    targets: [{ name: 'haalbaar', amount: 1050, share: 1, month: 12 }, { name: 'onhaalbaar', amount: 5000, share: 1, month: 12 }] });
  T('monte carlo: haalbaar doel krijgt kans 1', mc3.probs[0], 1);
  T('monte carlo: onhaalbaar doel krijgt kans 0', mc3.probs[1], 0);
  const mc4a = mcSimulate({ seed: 42, start: 1000, monthly: 50, months: 60, mu: 0.07, sigma: 0.18, runs: 300, targets: [] });
  const mc4b = mcSimulate({ seed: 42, start: 1000, monthly: 50, months: 60, mu: 0.07, sigma: 0.18, runs: 300, targets: [] });
  T('monte carlo: zelfde beginwaarde geeft precies dezelfde uitkomst', mc4a.band[20].p50, mc4b.band[20].p50, 0);
  OK('monte carlo: p10 ≤ p50 ≤ p90 in elk punt', mc4a.band.every((b) => b.p10 <= b.p50 + 1e-9 && b.p50 <= b.p90 + 1e-9), 'oplopend');
  OK('monte carlo: met beweeglijkheid lopen p10 en p90 uiteen', mc4a.band[20].p90 > mc4a.band[20].p10, 'spreiding');

  // ================= Box 3 =================
  const bp = box3Params();
  OK('box 3: standaardwaarden zijn gevuld', isNum(bp.forfait) && isNum(bp.hv) && isNum(bp.tarief) && isNum(bp.hvRes), 'getallen');
  const jaar = box3Years().find((y) => box3Compare(y)) || box3Years()[0];
  const B = box3Compare(jaar);
  if (B) {
    const p = B.p;
    T('box 3 ' + jaar + ': forfaitaire heffing los nagerekend', B.nowTax, Math.max(0, B.start - p.hv) * p.forfait / 100 * p.tarief / 100, 1e-9);
    T('box 3 ' + jaar + ': heffing over werkelijk rendement los nagerekend', B.newTax, Math.max(0, B.actual - p.hvRes) * p.tarief / 100, 1e-9);
    T('box 3 ' + jaar + ': werkelijk rendement is eind − begin − stortingen', B.actual, B.end - B.start - B.dep, 1e-9);
    OK('box 3: heffing is nooit negatief', B.nowTax >= 0 && B.newTax >= 0, '≥ 0');
    // Met fiscaal partner verdubbelt het heffingsvrije vermogen
    anState.b3Partner = true;
    const B2 = box3Compare(jaar);
    anState.b3Partner = false;
    T('box 3: met partner verdubbelt het heffingsvrije vermogen', B2.nowTax, Math.max(0, B.start - p.hv * 2) * p.forfait / 100 * p.tarief / 100, 1e-9);
    OK('box 3: met partner is de heffing niet hoger', B2.nowTax <= B.nowTax + 1e-9, '≤ zonder partner');
  } else SKIP('box 3', 'geen jaar met begin- en eindstand in de voorbeeldgegevens');

  // ================= Eigenschappen met willekeurige gevallen (idee 60) =================
  // Een vaste reeks willekeurige orders en koersen (zaadwaarde ZAAD, dus een fout is herhaalbaar). Per eigenschap
  // komt hooguit het eerste mislukte geval in de uitvoer, met het nummer om het na te rekenen.
  const ZAAD = 20261124, GEVALLEN = 500;
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const sign = (x) => (x > 1e-9 ? 1 : x < -1e-9 ? -1 : 0);
  const geen = (v) => v === undefined || (typeof v === 'number' && !isFinite(v));
  const eigenschap = (naam, fn) => {
    let fout = null;
    for (let i = 0; i < GEVALLEN && !fout; i++) {
      try { const r = fn(rng(ZAAD + i * 7919), i); if (r !== true) fout = 'geval ' + i + ': ' + r; }
      catch (e) { fout = 'geval ' + i + ': ' + (e && e.message || e); }
    }
    out.push({ naam: naam + ' (' + GEVALLEN + ' gevallen)', ok: !fout, got: fout || 'alles klopt', want: 'alles klopt' });
  };
  const echtM = M;
  try {
    // Weekstanden: een koers per week (stappen tot ±8%) en stortingen die tegen die koers stukken kopen
    const weekReeks = (R) => {
      const WK = 7 * DAY, n = 3 + Math.floor(R() * 150), t0 = Date.now() - (n + 1) * WK;
      let p = 10 + R() * 90, units = 0, inleg = 0;
      const weeks = [], prices = [];
      const geenStort = R() < 0.25;
      for (let i = 0; i < n; i++) {
        if (i) p *= 1 + (R() - 0.5) * 0.16;
        const dep = i === 0 ? 100 + R() * 5000 : !geenStort && R() < 0.3 ? Math.round(R() * 2000) : 0;
        units += dep / p; inleg += dep;
        prices.push(p);
        weeks.push({ t: t0 + i * WK, accountValue: units * p, newDeposits: i ? dep : null });
      }
      return { weeks, prices, inleg, eind: units * p, geenStort };
    };
    eigenschap('xirr: zelfde teken als het resultaat (eind − inleg), nooit NaN', (R) => {
      const w = weekReeks(R);
      M = { weeks: w.weeks, accountNow: w.eind };
      const f = accountFlows(), x = xirrOf(f);
      if (geen(x)) return 'xirr is ' + x;
      const res = w.eind - w.inleg;
      if (Math.abs(res) < 0.01 * w.inleg) return true;   // vrijwel nul: teken zegt dan niets
      return x === null ? 'geen xirr bij resultaat ' + res.toFixed(2) : sign(x) === sign(res) || 'xirr ' + x + ' bij resultaat ' + res.toFixed(2);
    });
    eigenschap('twr: gelijk aan het koersrendement, wat je ook stort; zonder stortingen zelfde teken als het resultaat', (R) => {
      const w = weekReeks(R);
      M = { weeks: w.weeks, accountNow: w.eind };
      const tw = accountTwr();
      if (!tw || geen(tw.total)) return 'twr is ' + (tw && tw.total);
      const koers = w.prices[w.prices.length - 1] / w.prices[0] - 1;
      if (Math.abs(tw.total - koers) > 1e-9) return 'twr ' + tw.total + ', koersrendement ' + koers;
      if (w.geenStort && Math.abs(w.eind - w.inleg) > 1e-6 && sign(tw.total) !== sign(w.eind - w.inleg)) return 'teken twr ' + tw.total + ' tegen resultaat ' + (w.eind - w.inleg);
      return true;
    });
    // Orders: aankopen tegen wisselende prijzen en verkopen van hooguit wat je hebt; soms alles verkopen
    const orderReeks = (R) => {
      const n = 1 + Math.floor(R() * 40), t0 = Date.now() - 400 * DAY;
      const list = [];
      let held = 0, p = 20 + R() * 200;
      const zelfdePrijs = R() < 0.2;
      for (let i = 0; i < n; i++) {
        if (!zelfdePrijs) p *= 1 + (R() - 0.5) * 0.3;
        const t = t0 + i * DAY * (1 + Math.floor(R() * 5));
        if (held > 1e-6 && R() < 0.3) {
          const qty = R() < 0.3 ? held : Math.round(held * R() * 1e6) / 1e6;
          if (qty > 0) { list.push({ t, side: 'SELL', qty, price: p, cur: 'USD', net: qty * p, kind: 'TRADE' }); held -= qty; }
        } else {
          const qty = Math.round((0.01 + R() * 10) * 1e6) / 1e6;
          list.push({ t, side: 'BUY', qty, price: p, cur: 'USD', net: qty * p * (1 + R() * 0.002), kind: 'TRADE' });
          held += qty;
        }
      }
      if (R() < 0.25 && held > 0) { list.push({ t: t0 + 300 * DAY, side: 'SELL', qty: held, price: p, cur: 'USD', net: held * p, kind: 'TRADE' }); held = 0; }
      return { list, held, zelfdePrijs };
    };
    // Los nagerekend: een rij aankopen, verkopen nemen de oudste eerst
    const fifoRef = (list) => {
      const q = [];
      list.forEach((x) => {
        if (x.side === 'BUY') q.push({ left: x.qty, per: x.net / x.qty });
        else { let rest = x.qty; while (rest > 1e-12 && q.length) { const take = Math.min(q[0].left, rest); q[0].left -= take; rest -= take; if (q[0].left <= 1e-12) q.shift(); } }
      });
      return { qty: sum(q.map((o) => o.left)), cost: sum(q.map((o) => o.left * o.per)) };
    };
    eigenschap('lotsModel: FIFO gelijk aan een losse berekening, aantallen kloppen, nooit NaN', (R) => {
      const o = orderReeks(R);
      M = { tx: { byTk: new Map([['PROEF', o.list]]) } };
      const L = lotsModel({ tk: 'PROEF' });
      if (!L) return 'geen model bij ' + o.list.length + ' orders';
      for (const k of ['sold', 'totQty', 'totNet', 'openQty', 'fifoCost', 'avgEur', 'fifoEur']) if (geen(L[k])) return k + ' is ' + L[k];
      const ref = fifoRef(o.list);
      if (Math.abs(L.openQty - o.held) > 1e-6) return 'aantal ' + L.openQty + ', verwacht ' + o.held;
      if (Math.abs(L.fifoCost - ref.cost) > 1e-6 * Math.max(1, ref.cost)) return 'FIFO-kostprijs ' + L.fifoCost + ', los nagerekend ' + ref.cost;
      if (L.fifoCost < -1e-9 || L.fifoCost > L.totNet + 1e-6) return 'FIFO-kostprijs ' + L.fifoCost + ' buiten 0…' + L.totNet;
      // Alles verkocht: van geen van beide methoden blijft kostprijs over
      if (o.held <= 1e-9 && (Math.abs(L.fifoCost) > 1e-6 || L.fifoEur !== null)) return 'alles verkocht, toch FIFO-kostprijs ' + L.fifoCost;
      // Elke aankoop tegen dezelfde prijs per stuk: beide methoden geven dezelfde kostprijs per stuk
      const perStuk = o.list.filter((x) => x.side === 'BUY').map((x) => x.net / x.qty);
      if (o.held > 1e-6 && Math.max(...perStuk) - Math.min(...perStuk) < 1e-9 && Math.abs(L.fifoEur - L.avgEur) > 1e-6) return 'zelfde prijs, toch FIFO ' + L.fifoEur + ' en gemiddeld ' + L.avgEur;
      return true;
    });
  } finally { M = echtM; }

  // ================= Opmaak van getallen =================
  // Deze hulpjes staan in docs/js/01-basis.js (eur, seur, spct, spct1, P1, P2, N2, NI),
  // 05-portefeuille.js (money) en 09-weergaven.js (PCT0). Zie tools/README.md voor de tabel.
  const hadHide = hideAmounts;
  hideAmounts = false;
  T('eur: NaN geeft een streepje', eur(NaN), '–');
  T('eur: null geeft een streepje', eur(null), '–');
  T('eur: undefined geeft een streepje', eur(undefined), '–');
  T('eur: Infinity geeft een streepje', eur(Infinity), '–');
  T('eur: tekst geeft een streepje', eur('1000'), '–');
  T('eur: nul', eur(0), '€ 0,00');
  T('eur: min nul toont geen minteken', eur(-0), '€ 0,00');
  T('eur: afronden op centen', eur(1234.567), '€ 1.234,57');
  T('eur: negatief bedrag', eur(-12.5), '€ -12,50');
  T('eur: miljard blijft leesbaar', eur(1e9), '€ 1.000.000.000,00');
  OK('eur: heel groot getal geeft geen fout', /^€\s[\d.]+,\d\d$/.test(eur(1e15)), 'getal met centen (' + eur(1e15).slice(0, 24) + '…)');
  T('seur: positief krijgt een plus', seur(2.5).replace(/⁠/g, ''), '+€ 2,50');
  T('seur: negatief krijgt een minteken', seur(-2.5).replace(/⁠/g, ''), '−€ 2,50');
  T('seur: nul krijgt geen teken', seur(0).replace(/⁠/g, ''), '€ 0,00');
  T('seur: min nul krijgt geen teken', seur(-0).replace(/⁠/g, ''), '€ 0,00');
  T('seur: NaN geeft een streepje', seur(NaN), '–');
  T('spct: 12,34%', spct(0.1234).replace(/⁠/g, ''), '+12,34%');
  T('spct: negatief', spct(-0.005).replace(/⁠/g, ''), '−0,50%');
  T('spct: nul', spct(0).replace(/⁠/g, ''), '0,00%');
  T('spct: NaN geeft een streepje', spct(NaN), '–');
  T('spct1: één decimaal', spct1(0.1234).replace(/⁠/g, ''), '+12,3%');
  T('PCT0: hele procenten', PCT0.format(0.1234), '12%');
  T('P1: één decimaal', P1.format(0.1234), '12,3%');
  T('N2: twee decimalen', N2.format(1234.5), '1.234,50');
  T('NI: hele getallen', NI.format(1234.5), '1.235');
  T('money: euro gaat via eur', money(12.5, 'EUR'), eur(12.5));
  T('money: zonder munt gaat via eur', money(12.5, null), eur(12.5));
  T('money: dollar krijgt het dollarteken', money(12.5, 'USD'), '$12,50');
  T('money: NaN geeft een streepje', money(NaN, 'USD'), '–');
  T('money: min nul toont geen minteken', money(-0, 'USD'), '$0,00');
  T('tone: positief, negatief, nul', [tone(1), tone(-1), tone(0), tone(NaN)].join(','), 'gain,loss,,');
  T('days: enkelvoud en meervoud', [days(1), days(2)].join(' / '), '1 dag / 2 dagen');
  // Bedragen verbergen (privacyknop) moet door eur en seur heen werken
  hideAmounts = true;
  T('bedragen verbergen: eur toont puntjes', eur(1234), HIDDEN);
  T('bedragen verbergen: seur houdt het teken', seur(-1234), '−' + HIDDEN);
  T('bedragen verbergen: NaN blijft een streepje', eur(NaN), '–');
  T('bedragen verbergen: procenten blijven zichtbaar', spct(0.1234).replace(/⁠/g, ''), '+12,34%');
  hideAmounts = hadHide;

  // ================= Tekst veilig invoegen =================
  T('esc: haakjes en aanhalingstekens', esc('<b>"a"&\'b\'</b>'), '&lt;b&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/b&gt;');
  T('esc: null wordt leeg', esc(null), '');
  T('escHtml doet hetzelfde als esc', escHtml('<a>&'), esc('<a>&'));
  T('tpl: ingevoegde waarde wordt ontsnapt', String(tpl`<p>${'<script>'}</p>`), '<p>&lt;script&gt;</p>');
  T('tpl: raw blijft staan', String(tpl`<p>${raw('<b>x</b>')}</p>`), '<p><b>x</b></p>');
  T('tpl: null en false worden leeg', String(tpl`a${null}b${false}c`), 'abc');
  T('tpl: een lijst wordt aan elkaar geplakt', String(tpl`${['a', 'b']}`), 'ab');

  return out;
});

const errs = realErrors(errors);
await ctx.close();
await browser.close();
await close();

let failed = 0, skipped = 0;
results.forEach((r) => {
  if (r.skip) { skipped++; console.log('  over ' + r.naam + ': ' + r.skip); return; }
  if (r.ok) { if (showAll) console.log('  ok  ' + r.naam); return; }
  failed++;
  console.log('  FOUT ' + r.naam + '\n       verwacht: ' + r.want + '\n       gekregen: ' + r.got);
});
errs.slice(0, 5).forEach((e) => { failed++; console.log('  FOUT console: ' + e.text.split('\n')[0].slice(0, 200)); });
console.log(failed ? failed + ' van ' + results.length + ' tests mislukt' : 'Rekenwerk en opmaak in orde: ' + (results.length - skipped) + ' tests geslaagd' + (skipped ? ', ' + skipped + ' overgeslagen' : '') + '.');
process.exit(failed ? 1 : 0);
