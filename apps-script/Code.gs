/**
 * Trading 212 → Google Sheets weektracker
 * Plak dit in: Extensies > Apps Script (in de sheet "Investeringstracker Trading212").
 *
 * Menu "Trading 212" in de sheet:
 *   - API-sleutel instellen           eigen API key + secret (alleen leesrechten).
 *   - Nu snapshot toevoegen           huidige stand ophalen en wegschrijven.
 *   - Oude weken toevoegen            weken vóór je eerste snapshot terugrekenen uit je geschiedenis.
 *   - Openstaande opname invoeren     correctie voor opnames die nog "Pending" zijn.
 *   - Wekelijkse update aan/uit       elke zaterdag rond 09:00 automatisch een snapshot.
 *
 * De sleutel wordt opgeslagen in je eigen gebruikersinstellingen van dit script
 * (PropertiesService.getUserProperties), niet in de sheet en niet in deze code.
 *
 * API-documentatie: https://docs.trading212.com
 */

const T212_BASE = 'https://live.trading212.com';
const TZ = 'Europe/Amsterdam';
const SHEET_WEEK = 'Weekoverzicht';
const SHEET_POS = 'Posities';
const SHEET_SYM = 'Koerssymbolen';
const SRC_API = 'API';
const SRC_RECON = 'Reconstructie';

// Kolommen (1-based)
const W_INPUT_COLS = 5;   // Weekoverzicht A–E
const W_SRC_COL = 15;     // Weekoverzicht O: Bron
const P_INPUT_COLS = 5;   // Posities A–E
const P_QTY_COL = 13;     // Posities M: Aantal
const P_SRC_COL = 14;     // Posities N: Bron

// ---------- Menu ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Trading 212')
    .addItem('API-sleutel instellen', 'setApiKey')
    .addItem('API-verbinding testen', 'testConnection')
    .addSeparator()
    .addItem('Nu snapshot toevoegen', 'snapshotManual')
    .addItem('Oude weken toevoegen', 'backfillHistory')
    .addSeparator()
    .addItem('Openstaande opname invoeren', 'addPendingWithdrawal')
    .addItem('Openstaande opnames bekijken/wissen', 'managePendingWithdrawals')
    .addSeparator()
    .addItem('Wekelijkse update aanzetten', 'enableWeeklyTrigger')
    .addItem('Wekelijkse update uitzetten', 'disableWeeklyTrigger')
    .addSeparator()
    .addItem('Live tracking (elke 10 min) aanzetten', 'enableIntradayTrigger')
    .addItem('Live tracking uitzetten', 'disableIntradayTrigger')
    .addItem('Nu een meting doen (test)', 'intradayManual')
    .addSeparator()
    .addItem('Website-toegangscode maken', 'createWebToken')
    .addToUi();
}

function setApiKey() {
  const ui = SpreadsheetApp.getUi();
  const k = ui.prompt('Trading 212 API key', 'Plak je API key:', ui.ButtonSet.OK_CANCEL);
  if (k.getSelectedButton() !== ui.Button.OK) return;
  const s = ui.prompt('Trading 212 API secret', 'Plak je API secret:', ui.ButtonSet.OK_CANCEL);
  if (s.getSelectedButton() !== ui.Button.OK) return;
  PropertiesService.getUserProperties().setProperties({
    T212_KEY: k.getResponseText().trim(),
    T212_SECRET: s.getResponseText().trim(),
  });
  ui.alert('Opgeslagen. Kies nu "API-verbinding testen".');
}

function testConnection() {
  const ui = SpreadsheetApp.getUi();
  try {
    const sum = t212Get_('/api/v0/equity/account/summary');
    ui.alert('Verbinding werkt.\n\nValuta: ' + sum.currency +
      '\nWaarde beleggingen: ' + sum.investments.currentValue +
      '\nVrije cash: ' + sum.cash.availableToTrade);
  } catch (e) {
    ui.alert('Fout: ' + e.message);
  }
}

// ---------- Triggers ----------

function enableWeeklyTrigger() {
  disableWeeklyTrigger_(true);
  ScriptApp.newTrigger('snapshotScheduled')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(9)
    .inTimezone(TZ)
    .create();
  SpreadsheetApp.getUi().alert('Wekelijkse update staat aan: elke zaterdag tussen 09:00 en 10:00.');
}

function disableWeeklyTrigger() { disableWeeklyTrigger_(false); }

function disableWeeklyTrigger_(silent) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'snapshotScheduled')
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (!silent) SpreadsheetApp.getUi().alert('Wekelijkse update staat uit.');
}

// ---------- Snapshot (huidige stand) ----------

function snapshotManual() {
  const ui = SpreadsheetApp.getUi();
  try {
    ui.alert(takeSnapshot_(true));
  } catch (e) {
    ui.alert('Fout: ' + e.message);
  }
}

function snapshotScheduled() {
  // Bij een fout stuurt Google automatisch een mail naar de eigenaar van het script.
  takeSnapshot_(false);
}

function takeSnapshot_(overwriteToday) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const shWeek = mustSheet_(ss, SHEET_WEEK);
    const shPos = mustSheet_(ss, SHEET_POS);
    ensureExtraHeaders_(ss);

    const todayStr = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

    const sum = t212Get_('/api/v0/equity/account/summary');
    if (sum.currency !== 'EUR') throw new Error('Account-valuta is ' + sum.currency + ', de sheet verwacht EUR.');
    Utilities.sleep(1100);
    const positions = t212Get_('/api/v0/equity/positions');
    const netDeposits = getNetDeposits_();

    // Waarde en kostprijs uit de posities zelf: investments.currentValue en totalCost van
    // Trading 212 bevatten ook cash (bijv. in pies), dus die optellen bij de cash telt dubbel.
    const cash = liveCash_(sum);
    const posValue = positions.reduce((s, p) => s + num_(p.walletImpact.currentValue), 0);
    const posCost = positions.reduce((s, p) => s + num_(p.walletImpact.totalCost), 0);
    const accountValue = round2_(posValue + cash);

    // Weekoverzicht
    const weekRow = findRowForDate_(shWeek, todayStr);
    if (weekRow.exists && !overwriteToday) return 'Snapshot van ' + todayStr + ' bestond al; niets toegevoegd.';
    shWeek.getRange(weekRow.row, 1, 1, W_INPUT_COLS).setValues([[
      todayStr, accountValue, round2_(netDeposits), round2_(cash), round2_(posCost),
    ]]);
    shWeek.getRange(weekRow.row, W_SRC_COL).setValue(SRC_API);

    // Posities
    const rows = positions
      .map(p => ({
        main: [todayStr, normTicker_(p.instrument.ticker), p.instrument.name,
          round2_(num_(p.walletImpact.currentValue)), round2_(num_(p.walletImpact.unrealizedProfitLoss))],
        extra: [num_(p.quantity), SRC_API],
      }))
      .sort((a, b) => b.main[3] - a.main[3]);

    const startRow = clearPositionsForDate_(shPos, todayStr);
    if (rows.length) {
      shPos.getRange(startRow, 1, rows.length, P_INPUT_COLS).setValues(rows.map(r => r.main));
      shPos.getRange(startRow, P_QTY_COL, rows.length, 2).setValues(rows.map(r => r.extra));
    }
    updateSymbolTable_(ss, positions.map(p => p.instrument));

    SpreadsheetApp.flush();
    return 'Snapshot ' + todayStr + ' opgeslagen.\n\n' +
      'Accountwaarde: €' + accountValue.toFixed(2) + '\n' +
      'Netto stortingen: €' + netDeposits.toFixed(2) + '\n' +
      'Posities: ' + rows.length;
  } finally {
    lock.releaseLock();
  }
}

// ---------- Oude weken terugrekenen ----------
//
// Trading 212 levert geen historische koersen. Het script rekent per zaterdag
// (stand aan het eind van die dag) uit de API-geschiedenis terug:
//   - aantal en kostprijs per positie (orders, gemiddelde-kostprijsmethode)
//   - vrije cash en netto stortingen (transacties, orders, dividenden)
// De waarde per positie komt uit een GOOGLEFINANCE-formule (slotkoers van de
// laatste handelsdag tot en met die zaterdag, omgerekend naar EUR). Welk
// Google Finance-symbool bij welk aandeel hoort staat op tabblad "Koerssymbolen"
// en kun je daar aanpassen; de formules rekenen dan vanzelf opnieuw.

function backfillHistory() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const shWeek = mustSheet_(ss, SHEET_WEEK);
  const shPos = mustSheet_(ss, SHEET_POS);
  ensureExtraHeaders_(ss);

  const keepWeek = readRows_(shWeek, W_INPUT_COLS, W_SRC_COL, 1).filter(r => r.src !== SRC_RECON);
  const firstKept = keepWeek.length ? keepWeek.map(r => r.date).sort()[0] : null;

  const go = ui.alert('Oude weken toevoegen',
    'Het script rekent elke zaterdag terug vanaf je eerste storting' +
    (firstKept ? ' tot vóór ' + firstKept : '') + '.\n\n' +
    'Eerder teruggerekende weken worden opnieuw opgebouwd; snapshots uit de API blijven staan.\n' +
    'Dit kan een paar minuten duren. Doorgaan?', ui.ButtonSet.YES_NO);
  if (go !== ui.Button.YES) return;

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    // 1. Geschiedenis ophalen
    const transactions = fetchAll_('/api/v0/equity/history/transactions?limit=50');
    const orders = fetchAll_('/api/v0/equity/history/orders?limit=50');
    const dividends = fetchAll_('/api/v0/equity/history/dividends?limit=50');
    const sum = t212Get_('/api/v0/equity/account/summary');
    Utilities.sleep(1100);
    const livePositions = t212Get_('/api/v0/equity/positions');

    // 2. Gebeurtenissen op tijd sorteren
    const events = buildEvents_(transactions, orders, dividends);
    if (!events.length) { ui.alert('Geen geschiedenis gevonden.'); return; }

    // 3. Controle: alles afspelen tot nu en vergelijken met de huidige stand
    const nowState = replay_(events, null);
    const check = compareWithLive_(nowState, sum, livePositions);

    // 4. Zaterdagen bepalen
    const firstDay = Utilities.formatDate(events[0].time, TZ, 'yyyy-MM-dd');
    const todayStr = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    const endExclusive = firstKept || addDays_(todayStr, 1);
    const saturdays = saturdaysBetween_(firstDay, endExclusive);
    if (!saturdays.length) {
      ui.alert('Er zijn geen hele weken vóór ' + endExclusive + ' om terug te rekenen.\n\n' + check.text);
      return;
    }

    // 5. Stand per zaterdag
    const weeks = saturdays.map(sat => {
      const cutoff = Utilities.parseDate(sat + ' 23:59:59', TZ, 'yyyy-MM-dd HH:mm:ss');
      return { date: sat, state: replay_(events, cutoff) };
    });

    // 6. Koerssymbolen bijwerken met alle instrumenten uit de geschiedenis
    updateSymbolTable_(ss, Object.values(nowState.instruments));

    // 7. Wegschrijven: teruggerekende weken eerst, daarna de bestaande API-rijen
    writeBackfill_(shWeek, shPos, weeks, keepWeek);

    SpreadsheetApp.flush();
    ui.alert(weeks.length + ' weken toegevoegd (' + saturdays[0] + ' t/m ' + saturdays[saturdays.length - 1] + ').\n\n' +
      check.text + '\n\nControleer op tabblad "' + SHEET_SYM + '" of elk symbool een koers geeft ' +
      '(kolom G). Zo niet: pas het symbool in kolom E aan.');
  } catch (e) {
    ui.alert('Fout: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

function buildEvents_(transactions, orders, dividends) {
  const ev = [];
  transactions.forEach(tx => {
    const amt = num_(tx.amount);
    const t = new Date(tx.dateTime);
    if (tx.type === 'DEPOSIT') ev.push({ time: t, kind: 'cash', cash: Math.abs(amt), dep: Math.abs(amt) });
    else if (tx.type === 'WITHDRAW') ev.push({ time: t, kind: 'cash', cash: -Math.abs(amt), dep: -Math.abs(amt) });
    else if (tx.type === 'TRANSFER') ev.push({ time: t, kind: 'cash', cash: amt, dep: amt });
    else if (tx.type === 'FEE') ev.push({ time: t, kind: 'cash', cash: -Math.abs(amt), dep: 0 });
    else if (tx.type === 'INTEREST_ON_FREE_CASH' || tx.type === 'LENDING_INTEREST')
      ev.push({ time: t, kind: 'cash', cash: Math.abs(amt), dep: 0 });
  });
  dividends.forEach(d => {
    ev.push({ time: new Date(d.paidOn), kind: 'cash', cash: num_(d.amount), dep: 0 });
  });
  orders.forEach(it => {
    const f = it.fill, o = it.order;
    if (!f || !o || !num_(f.quantity)) return;
    const net = Math.abs(num_(f.walletImpact && f.walletImpact.netValue));
    ev.push({
      time: new Date(f.filledAt || o.createdAt),
      kind: 'fill',
      ticker: o.ticker || (o.instrument && o.instrument.ticker),
      instrument: o.instrument,
      side: o.side,
      qty: Math.abs(num_(f.quantity)),
      net: net,
      trade: f.type === 'TRADE',
    });
  });
  return ev.filter(e => !isNaN(e.time.getTime())).sort((a, b) => a.time - b.time);
}

// Speelt alle gebeurtenissen af tot en met 'cutoff' (null = alles).
function replay_(events, cutoff) {
  const st = { cash: 0, netDeposits: 0, pos: {}, instruments: {} };
  for (const e of events) {
    if (cutoff && e.time > cutoff) break;
    if (e.kind === 'cash') {
      st.cash += e.cash;
      st.netDeposits += e.dep;
      continue;
    }
    if (e.instrument && e.ticker) st.instruments[e.ticker] = e.instrument;
    const p = st.pos[e.ticker] || (st.pos[e.ticker] = { qty: 0, cost: 0 });
    if (e.side === 'BUY') {
      p.qty += e.qty;
      if (e.trade) { p.cost += e.net; st.cash -= e.net; }
    } else {
      const before = p.qty;
      p.qty -= e.qty;
      if (before > 0) p.cost -= p.cost * Math.min(e.qty / before, 1);
      if (e.trade) st.cash += e.net;
    }
    if (Math.abs(p.qty) < 1e-9) { p.qty = 0; p.cost = 0; }
  }
  return st;
}

function compareWithLive_(st, sum, livePositions) {
  const lines = [];
  const pending = getPending_().reduce((s, p) => s + p.amount, 0);
  const cashDiff = (st.cash - pending) - liveCash_(sum);
  if (Math.abs(cashDiff) > 1) lines.push('Cash wijkt €' + cashDiff.toFixed(2) + ' af van de huidige stand.');
  const live = {};
  livePositions.forEach(p => { live[p.instrument.ticker] = p; });
  const all = new Set(Object.keys(live).concat(Object.keys(st.pos).filter(k => st.pos[k].qty > 0)));
  all.forEach(t => {
    const r = st.pos[t] || { qty: 0, cost: 0 };
    const l = live[t];
    const lq = l ? num_(l.quantity) : 0;
    const lc = l ? num_(l.walletImpact.totalCost) : 0;
    if (Math.abs(r.qty - lq) > 1e-6 * Math.max(1, lq)) {
      lines.push(normTicker_(t) + ': aantal ' + r.qty.toFixed(6) + ' teruggerekend, ' + lq.toFixed(6) + ' nu.');
    } else if (Math.abs(r.cost - lc) > 0.5) {
      lines.push(normTicker_(t) + ': kostprijs €' + r.cost.toFixed(2) + ' teruggerekend, €' + lc.toFixed(2) + ' nu.');
    }
  });
  return {
    ok: !lines.length,
    text: lines.length
      ? 'Let op, de terugrekening klopt niet helemaal met je huidige stand:\n- ' + lines.join('\n- ')
      : 'Controle: aantallen, kostprijs en cash kloppen met je huidige stand.',
  };
}

function writeBackfill_(shWeek, shPos, weeks, keepWeek) {
  const keepPos = readRows_(shPos, P_INPUT_COLS, P_QTY_COL, 2).filter(r => r.src !== SRC_RECON);

  // Oude invoer leegmaken (alleen invoerkolommen; formules in F en verder blijven staan)
  clearInputs_(shWeek, [[1, W_INPUT_COLS], [W_SRC_COL, 1]]);
  clearInputs_(shPos, [[1, P_INPUT_COLS], [P_QTY_COL, 2]]);

  // --- Posities ---
  const posRecon = [];
  weeks.forEach(w => {
    Object.keys(w.state.pos)
      .filter(t => w.state.pos[t].qty > 0)
      .sort()
      .forEach(t => {
        const inst = w.state.instruments[t] || {};
        posRecon.push({ date: w.date, ticker: normTicker_(t), name: inst.name || t,
          qty: w.state.pos[t].qty, cost: w.state.pos[t].cost });
      });
  });
  let row = 2;
  ensureRows_(shPos, row + posRecon.length + keepPos.length + 60);
  if (posRecon.length) {
    shPos.getRange(row, 1, posRecon.length, 3).setValues(posRecon.map(r => [r.date, r.ticker, r.name]));
    shPos.getRange(row, 4, posRecon.length, 2).setFormulas(posRecon.map((r, i) => {
      const n = row + i;
      return [loc_(valueFormula_(n)), loc_('=ROUND($D' + n + '-' + r.cost.toFixed(2) + ',2)')];
    }));
    shPos.getRange(row, P_QTY_COL, posRecon.length, 2).setValues(posRecon.map(r => [round6_(r.qty), SRC_RECON]));
    row += posRecon.length;
  }
  if (keepPos.length) {
    shPos.getRange(row, 1, keepPos.length, P_INPUT_COLS).setValues(keepPos.map(r => r.vals));
    shPos.getRange(row, P_QTY_COL, keepPos.length, 2).setValues(keepPos.map(r => [r.extra[0], r.extra[1] || SRC_API]));
  }

  // --- Weekoverzicht ---
  row = 2;
  ensureRows_(shWeek, row + weeks.length + keepWeek.length + 10);
  shWeek.getRange(row, 1, weeks.length, 1).setValues(weeks.map(w => [w.date]));
  shWeek.getRange(row, 2, weeks.length, 1).setFormulas(weeks.map((w, i) => {
    const n = row + i;
    return [loc_('=$D' + n + '+SUMIFS(' + SHEET_POS + '!$D:$D,' + SHEET_POS + '!$A:$A,$A' + n + ')')];
  }));
  shWeek.getRange(row, 3, weeks.length, 3).setValues(weeks.map(w => {
    const cost = Object.keys(w.state.pos).reduce((s, t) => s + (w.state.pos[t].qty > 0 ? w.state.pos[t].cost : 0), 0);
    return [round2_(w.state.netDeposits), round2_(w.state.cash), round2_(cost)];
  }));
  shWeek.getRange(row, W_SRC_COL, weeks.length, 1).setValues(weeks.map(() => [SRC_RECON]));
  row += weeks.length;
  if (keepWeek.length) {
    shWeek.getRange(row, 1, keepWeek.length, W_INPUT_COLS).setValues(keepWeek.map(r => r.vals));
    shWeek.getRange(row, W_SRC_COL, keepWeek.length, 1).setValues(keepWeek.map(r => [r.extra[0] || SRC_API]));
  }
}

// Waarde = aantal × slotkoers (laatste handelsdag t/m de datum) × wisselkoers naar EUR.
function valueFormula_(n) {
  const sym = "XLOOKUP($B" + n + "," + SHEET_SYM + "!$B:$B," + SHEET_SYM + "!$E:$E)";
  const cur = "XLOOKUP($B" + n + "," + SHEET_SYM + "!$B:$B," + SHEET_SYM + "!$F:$F)";
  return '=LET(s,' + sym + ',v,' + cur + ',d,$A' + n + ',' +
    't,GOOGLEFINANCE(s,"close",d-7,d),p,INDEX(t,ROWS(t),2),' +
    'fx,IF(v="EUR",1,LET(g,GOOGLEFINANCE("CURRENCY:"&IF(v="GBX","GBP",v)&"EUR","close",d-7,d),INDEX(g,ROWS(g),2)))' +
    '*IF(v="GBX",0.01,1),' +
    'ROUND($M' + n + '*p*fx,2))';
}

// ---------- Koerssymbolen ----------

function updateSymbolTable_(ss, instruments) {
  const sh = ss.getSheetByName(SHEET_SYM) || createSymbolSheet_(ss);
  const last = Math.max(sh.getLastRow(), 1);
  const existing = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])) : [];
  const seen = new Set(existing);
  const add = [];
  instruments.forEach(inst => {
    if (!inst || !inst.ticker || seen.has(inst.ticker)) return;
    seen.add(inst.ticker);
    add.push(inst);
  });
  if (!add.length) return;
  const start = last + 1;
  sh.getRange(start, 1, add.length, 5).setValues(add.map(inst => [
    inst.ticker, normTicker_(inst.ticker), inst.name || '', inst.currency || '', googleSymbol_(inst.ticker),
  ]));
  // Valuta van de koers vraagt het script aan Google Finance zelf: Londense koersen
  // zijn soms in GBP en soms in GBX (pence), los van wat Trading 212 aangeeft.
  sh.getRange(start, 6, add.length, 2).setFormulas(add.map((_, i) => {
    const r = start + i;
    return [
      loc_('=IF($E' + r + '="","",IFERROR(GOOGLEFINANCE($E' + r + ',"currency"),$D' + r + '))'),
      loc_('=IF($E' + r + '="","",IFERROR(GOOGLEFINANCE($E' + r + '),"symbool klopt niet"))'),
    ];
  }));
}

function createSymbolSheet_(ss) {
  const sh = ss.insertSheet(SHEET_SYM);
  sh.getRange(1, 1, 1, 7).setValues([[
    'T212-ticker', 'Ticker', 'Naam', 'Valuta (Trading 212)', 'Google Finance-symbool',
    'Valuta van de koers', 'Huidige koers (controle)',
  ]]);
  return sh;
}

// "AAPL_US_EQ" -> "AAPL", "BRK_B_US_EQ" -> "BRK.B", "VUAGl_EQ" -> "LON:VUAG", "RHMd_EQ" -> "ETR:RHM"
function googleSymbol_(t) {
  t = String(t);
  if (/_US_EQ$/.test(t)) return t.replace(/_US_EQ$/, '').replace(/_/g, '.');
  // Amerikaanse aandelen via een andere beurs (bv. GPRO_AT_EQ in Wenen): gebruik de Amerikaanse notering.
  if (/^[A-Z.]+_[A-Z]{2}_EQ$/.test(t)) return t.split('_')[0];
  const m = t.split('_')[0].match(/^(.*?)([a-z]+)$/);
  if (!m) return '';
  const ex = { l: 'LON', d: 'ETR', a: 'AMS', p: 'EPA', m: 'BIT', e: 'BME', s: 'SWX', b: 'EBR' }[m[2]];
  return ex ? ex + ':' + m[1] : '';
}

// ---------- Netto stortingen + openstaande opnames ----------
//
// Trading 212 telt een opname die nog "Pending" is al mee in de netto stortingen,
// maar de API toont hem pas als WITHDRAW-transactie zodra hij is afgerond.

function getNetDeposits_() {
  const tx = fetchTransactionTotals_();
  const pending = settlePendingWithdrawals_(tx.withdrawCounts);
  return tx.total - pending.reduce((s, p) => s + p.amount, 0);
}

function fetchTransactionTotals_() {
  let total = 0;
  const withdrawCounts = {};
  fetchAll_('/api/v0/equity/history/transactions?limit=50').forEach(tx => {
    const amt = num_(tx.amount);
    if (tx.type === 'DEPOSIT') total += Math.abs(amt);
    else if (tx.type === 'WITHDRAW') {
      total -= Math.abs(amt);
      const k = amountKey_(amt);
      withdrawCounts[k] = (withdrawCounts[k] || 0) + 1;
    }
    else if (tx.type === 'TRANSFER') total += amt;
  });
  return { total: total, withdrawCounts: withdrawCounts };
}

function settlePendingWithdrawals_(withdrawCounts) {
  const list = getPending_();
  const used = {};
  const still = list.filter(p => {
    const k = amountKey_(p.amount);
    used[k] = (used[k] || 0) + 1;
    return (withdrawCounts[k] || 0) < p.countAtEntry + used[k];
  });
  if (still.length !== list.length) savePending_(still);
  return still;
}

function addPendingWithdrawal() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Openstaande opname',
    'Bedrag van de opname die in Trading 212 nog op "Pending" staat (bv. 154,65):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const amount = parseAmount_(r.getResponseText());
  if (!(amount > 0)) { ui.alert('Geen geldig bedrag.'); return; }
  try {
    const tx = fetchTransactionTotals_();
    const list = getPending_();
    list.push({ amount: round2_(amount), countAtEntry: tx.withdrawCounts[amountKey_(amount)] || 0,
      added: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd') });
    savePending_(list);
    ui.alert('Opname van €' + amount.toFixed(2) + ' opgeslagen. Hij wordt afgetrokken van de netto stortingen ' +
      'tot Trading 212 hem heeft afgerond.\n\nKies nu "Nu snapshot toevoegen" om de cijfers van vandaag bij te werken.');
  } catch (e) {
    ui.alert('Fout: ' + e.message);
  }
}

function managePendingWithdrawals() {
  const ui = SpreadsheetApp.getUi();
  const list = getPending_();
  if (!list.length) { ui.alert('Er staan geen openstaande opnames.'); return; }
  const txt = list.map(p => '€' + p.amount.toFixed(2) + ' (ingevoerd ' + p.added + ')').join('\n');
  if (ui.alert('Openstaande opnames', txt + '\n\nAlles wissen?', ui.ButtonSet.YES_NO) === ui.Button.YES) {
    savePending_([]);
    ui.alert('Gewist.');
  }
}

function getPending_() {
  const raw = PropertiesService.getDocumentProperties().getProperty('T212_PENDING_WITHDRAWALS');
  return raw ? JSON.parse(raw) : [];
}

function savePending_(list) {
  PropertiesService.getDocumentProperties().setProperty('T212_PENDING_WITHDRAWALS', JSON.stringify(list));
}

// ---------- API ----------

function fetchAll_(firstPath) {
  const out = [];
  let path = firstPath, pages = 0;
  while (path) {
    if (pages > 0) Utilities.sleep(3100); // geschiedenis: 20 verzoeken per minuut
    const res = t212Get_(path);
    (res.items || []).forEach(x => out.push(x));
    path = res.nextPagePath || null;
    if (++pages > 80) throw new Error('Te veel pagina\'s voor ' + firstPath.split('?')[0] + '; gestopt vanwege de tijdslimiet.');
  }
  return out;
}

function t212Get_(path) {
  const props = PropertiesService.getUserProperties();
  const key = props.getProperty('T212_KEY');
  const secret = props.getProperty('T212_SECRET');
  if (!key || !secret) throw new Error('Geen API-sleutel ingesteld. Kies Trading 212 > API-sleutel instellen.');
  const url = path.indexOf('http') === 0 ? path : T212_BASE + path;
  const opts = {
    method: 'get',
    muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(key + ':' + secret) },
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = UrlFetchApp.fetch(url, opts);
    const code = resp.getResponseCode();
    if (code === 200) return JSON.parse(resp.getContentText());
    if (code === 429) {
      const h = resp.getHeaders();
      const reset = Number(h['x-ratelimit-reset'] || h['X-Ratelimit-Reset'] || 0) * 1000;
      Utilities.sleep(Math.min(Math.max(reset - Date.now(), 3000), 60000));
      continue;
    }
    if (code === 401) throw new Error('API-sleutel ongeldig (401).');
    if (code === 403) throw new Error('API-sleutel mist een recht (403) voor ' + path.split('?')[0] + '.');
    throw new Error('Trading 212 API gaf ' + code + ' voor ' + path.split('?')[0] + ': ' + resp.getContentText().slice(0, 200));
  }
  throw new Error('Rate limit bleef geraakt voor ' + path.split('?')[0]);
}

// ---------- Sheet-hulpfuncties ----------

function mustSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Tabblad "' + name + '" niet gevonden.');
  return sh;
}

function ensureExtraHeaders_(ss) {
  const w = ss.getSheetByName(SHEET_WEEK), p = ss.getSheetByName(SHEET_POS);
  if (w && !w.getRange(1, W_SRC_COL).getValue()) w.getRange(1, W_SRC_COL).setValue('Bron');
  if (p && !p.getRange(1, P_QTY_COL).getValue()) p.getRange(1, P_QTY_COL, 1, 2).setValues([['Aantal', 'Bron']]);
}

// Leest gevulde rijen: datum (kolom A als tekst), invoerwaarden en extra kolommen.
function readRows_(sh, nInput, extraCol, nExtra) {
  const n = lastDataRow_(sh) - 1;
  if (n < 1) return [];
  const vals = sh.getRange(2, 1, n, nInput).getValues();
  const extra = sh.getRange(2, extraCol, n, nExtra).getValues();
  const out = [];
  for (let i = 0; i < n; i++) {
    if (vals[i][0] === '' || vals[i][0] === null) continue;
    const date = fmt_(vals[i][0]);
    const v = vals[i].slice();
    v[0] = date;
    out.push({ date: date, vals: v, extra: extra[i], src: String(extra[i][nExtra - 1] || '') });
  }
  return out;
}

function clearInputs_(sh, colSpans) {
  const n = lastDataRow_(sh) - 1;
  if (n < 1) return;
  colSpans.forEach(c => sh.getRange(2, c[0], n, c[1]).clearContent());
}

function lastDataRow_(sh) {
  const vals = sh.getRange(1, 1, sh.getMaxRows(), 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i][0] !== '' && vals[i][0] !== null) return i + 1;
  return 1;
}

function findRowForDate_(sh, dateStr) {
  const last = lastDataRow_(sh);
  if (last > 1) {
    const vals = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) if (fmt_(vals[i][0]) === dateStr) return { row: i + 2, exists: true };
  }
  ensureRows_(sh, last + 1);
  return { row: last + 1, exists: false };
}

// Wist alleen de invoerkolommen van de rijen met deze datum en geeft de startrij terug.
function clearPositionsForDate_(sh, dateStr) {
  const last = lastDataRow_(sh);
  let first = -1;
  if (last > 1) {
    const vals = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (fmt_(vals[i][0]) !== dateStr) continue;
      if (first === -1) first = i + 2;
      sh.getRange(i + 2, 1, 1, P_INPUT_COLS).clearContent();
      sh.getRange(i + 2, P_QTY_COL, 1, 2).clearContent();
    }
  }
  const start = first !== -1 ? first : last + 1;
  ensureRows_(sh, start + 60);
  return start;
}

function ensureRows_(sh, needed) {
  const max = sh.getMaxRows();
  if (needed > max) sh.insertRowsAfter(max, needed - max + 100);
}

// ---------- Live tracking: elke 10 minuten ----------
//
// Elke 10 minuten (werkdagen 08:00–22:30, Amsterdamse tijd) slaat het script per positie
// de waarde in euro, de koers en het aantal op in het verborgen tabblad IntradayData,
// plus een regel TOTAAL (som van alle posities, zonder vrije cash).
// Eén keer per uur:
//   - elk afgerond uur wordt samengevat in UurData (open, slot, laagste, hoogste, gemiddelde);
//   - elke afgeronde dag wordt samengevat in DagData (idem, plus dagrange);
//   - metingen ouder dan 3 dagen worden uit IntradayData verwijderd (alleen als hun uur al
//     in UurData staat, zodat er niets verloren gaat).
// Het tabblad Dagoverzicht rekent met formules op deze drie tabbladen.

const SHEET_INTRA = 'IntradayData';
const SHEET_HOUR = 'UurData';
const SHEET_DAYD = 'DagData';
const INTRA_KEEP_DAYS = 3;
const LIVE_WEEKDAYS = ['1', '2', '3', '4', '5'];  // ma t/m vr
const LIVE_START = '08:00';
const LIVE_END = '22:30';
const LIVE_INTERVAL_MIN = 10;                     // Apps Script staat 1, 5, 10, 15 of 30 toe
const TOTAL_TICKER = 'TOTAAL';

function enableIntradayTrigger() {
  disableIntradayTrigger_(true);
  ensureDataSheets_(SpreadsheetApp.getActive());
  ScriptApp.newTrigger('intradayTick').timeBased().everyMinutes(LIVE_INTERVAL_MIN).create();
  SpreadsheetApp.getUi().alert('Live tracking staat aan: elke ' + LIVE_INTERVAL_MIN +
    ' minuten op werkdagen van ' + LIVE_START + ' tot ' + LIVE_END + '.');
}

function disableIntradayTrigger() { disableIntradayTrigger_(false); }

function disableIntradayTrigger_(silent) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'intradayTick')
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (!silent) SpreadsheetApp.getUi().alert('Live tracking staat uit.');
}

function intradayManual() {
  const ui = SpreadsheetApp.getUi();
  try {
    ui.alert(intradayRun_(true));
  } catch (e) {
    ui.alert('Fout: ' + e.message);
  }
}

function intradayTick() {
  intradayRun_(false);
}

function intradayRun_(force) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return 'Er liep al een andere run; deze meting is overgeslagen.';
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ensureDataSheets_(ss);
    const now = new Date();
    const parts = [];

    if (force || isLiveWindow_(now)) {
      const positions = t212Get_('/api/v0/equity/positions');
      const ts = new Date(Math.floor(now.getTime() / 60000) * 60000);
      const rows = positions.map(p => [
        ts, normTicker_(p.instrument.ticker), p.instrument.name,
        round2_(num_(p.walletImpact.currentValue)), num_(p.currentPrice), num_(p.quantity),
      ]);
      const total = rows.reduce((s, r) => s + r[3], 0);
      rows.push([ts, TOTAL_TICKER, 'Totaal beleggingen', round2_(total), '', '']);
      appendRows_(sh.intra, rows);
      parts.push(positions.length + ' posities gemeten om ' + Utilities.formatDate(ts, TZ, 'HH:mm') +
        ' (totaal €' + total.toFixed(2) + ').');
    } else {
      parts.push('Buiten de meettijden (werkdagen ' + LIVE_START + '–' + LIVE_END + '); geen meting.');
    }

    const hk = housekeeping_(sh, now, force);
    if (hk) parts.push(hk);
    return parts.join('\n');
  } finally {
    lock.releaseLock();
  }
}

function isLiveWindow_(d) {
  if (LIVE_WEEKDAYS.indexOf(Utilities.formatDate(d, TZ, 'u')) === -1) return false;
  const hm = Utilities.formatDate(d, TZ, 'HH:mm');
  return hm >= LIVE_START && hm <= LIVE_END;
}

function hourKey_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH'); }
function dayKey_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }

// Eens per uur: uren en dagen samenvatten, oude 10-minutenmetingen opruimen.
function housekeeping_(sh, now, force) {
  const props = PropertiesService.getDocumentProperties();
  const curHour = hourKey_(now);
  if (!force && props.getProperty('T212_HK_HOUR') === curHour) return '';

  const msgs = [];

  // 1. Afgeronde uren -> UurData
  const lastHour = props.getProperty('T212_LAST_HOUR') || '';
  const intra = readBlock_(sh.intra, 6);
  const hourRows = aggregateHours_(intra, lastHour, curHour);
  if (hourRows.rows.length) {
    appendRows_(sh.hour, hourRows.rows);
    props.setProperty('T212_LAST_HOUR', hourRows.maxKey);
    msgs.push(hourRows.rows.length + ' uurregels toegevoegd.');
  }
  const doneHour = hourRows.maxKey || lastHour;

  // 2. Afgeronde dagen -> DagData
  const lastDay = props.getProperty('T212_LAST_DAY') || '';
  const today = dayKey_(now);
  const recentHours = readTailUntil_(sh.hour, 10, r => dayKey_(r[0]) <= lastDay);
  const dayRows = aggregateDays_(recentHours, lastDay, today);
  if (dayRows.rows.length) {
    appendRows_(sh.day, dayRows.rows);
    props.setProperty('T212_LAST_DAY', dayRows.maxKey);
    msgs.push(dayRows.rows.length + ' dagregels toegevoegd.');
  }

  // 3. 10-minutenmetingen ouder dan 3 dagen verwijderen (alleen als het uur al samengevat is)
  const cutoff = new Date(now.getTime() - INTRA_KEEP_DAYS * 864e5);
  let k = 0;
  while (k < intra.length && intra[k][0] instanceof Date && intra[k][0] < cutoff &&
         doneHour && hourKey_(intra[k][0]) <= doneHour) k++;
  if (k > 0) {
    if (sh.intra.getMaxRows() - k <= 1) sh.intra.insertRowsAfter(sh.intra.getMaxRows(), 200);
    sh.intra.deleteRows(2, k);
    msgs.push(k + ' oude metingen verwijderd.');
  }

  props.setProperty('T212_HK_HOUR', curHour);
  return msgs.join(' ');
}

// rows: [tijdstip, ticker, naam, waarde, koers, aantal]
function aggregateHours_(rows, afterKey, beforeKey) {
  const groups = {};
  rows.forEach(r => {
    if (!(r[0] instanceof Date) || r[1] === '') return;
    const hk = hourKey_(r[0]);
    if (hk <= afterKey || hk >= beforeKey) return;
    const g = groups[hk + '|' + r[1]] || (groups[hk + '|' + r[1]] = { hk: hk, ticker: r[1], pts: [] });
    g.pts.push(r);
  });
  let maxKey = '';
  const out = Object.keys(groups).sort().map(k => {
    const g = groups[k];
    g.pts.sort((a, b) => a[0] - b[0]);
    const v = g.pts.map(p => num_(p[3]));
    const last = g.pts[g.pts.length - 1];
    if (g.hk > maxKey) maxKey = g.hk;
    return [
      Utilities.parseDate(g.hk + ':00:00', TZ, 'yyyy-MM-dd HH:mm:ss'), g.ticker, last[2],
      v[0], v[v.length - 1], Math.min.apply(null, v), Math.max.apply(null, v),
      round2_(v.reduce((s, x) => s + x, 0) / v.length), v.length, last[4],
    ];
  });
  return { rows: out, maxKey: maxKey };
}

// rows: [uur, ticker, naam, open, slot, laagste, hoogste, gemiddelde, metingen, slotkoers]
function aggregateDays_(rows, afterKey, beforeKey) {
  const groups = {};
  rows.forEach(r => {
    if (!(r[0] instanceof Date) || r[1] === '') return;
    const dk = dayKey_(r[0]);
    if (dk <= afterKey || dk >= beforeKey) return;
    const g = groups[dk + '|' + r[1]] || (groups[dk + '|' + r[1]] = { dk: dk, ticker: r[1], hrs: [] });
    g.hrs.push(r);
  });
  let maxKey = '';
  const out = Object.keys(groups).sort().map(k => {
    const g = groups[k];
    g.hrs.sort((a, b) => a[0] - b[0]);
    const first = g.hrs[0], last = g.hrs[g.hrs.length - 1];
    const lo = Math.min.apply(null, g.hrs.map(h => num_(h[5])));
    const hi = Math.max.apply(null, g.hrs.map(h => num_(h[6])));
    const n = g.hrs.reduce((s, h) => s + num_(h[8]), 0);
    const avg = n ? g.hrs.reduce((s, h) => s + num_(h[7]) * num_(h[8]), 0) / n : 0;
    if (g.dk > maxKey) maxKey = g.dk;
    return [
      g.dk, g.ticker, last[2], num_(first[3]), num_(last[4]), lo, hi, round2_(avg),
      round2_(hi - lo), avg ? Math.round((hi - lo) / avg * 1e6) / 1e6 : 0, n, last[9],
    ];
  });
  return { rows: out, maxKey: maxKey };
}

function ensureDataSheets_(ss) {
  const mk = (name, headers) => {
    let s = ss.getSheetByName(name);
    if (!s) {
      s = ss.insertSheet(name);
      s.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      s.setFrozenRows(1);
      s.hideSheet();
    }
    return s;
  };
  return {
    intra: mk(SHEET_INTRA, ['Tijdstip', 'Ticker', 'Naam', 'Waarde (€)', 'Koers (valuta instrument)', 'Aantal']),
    hour: mk(SHEET_HOUR, ['Uur', 'Ticker', 'Naam', 'Open (€)', 'Slot (€)', 'Laagste (€)', 'Hoogste (€)',
      'Gemiddelde (€)', 'Metingen', 'Slotkoers (valuta instrument)']),
    day: mk(SHEET_DAYD, ['Datum', 'Ticker', 'Naam', 'Open (€)', 'Slot (€)', 'Laagste (€)', 'Hoogste (€)',
      'Gemiddelde (€)', 'Dagrange (€)', 'Dagrange %', 'Metingen', 'Slotkoers (valuta instrument)']),
  };
}

function appendRows_(sh, rows) {
  if (!rows.length) return;
  const start = lastDataRow_(sh) + 1;
  ensureRows_(sh, start + rows.length);
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

function readBlock_(sh, nCols) {
  const last = lastDataRow_(sh);
  return last > 1 ? sh.getRange(2, 1, last - 1, nCols).getValues() : [];
}

// Leest de laatste rijen van een tabblad, steeds meer, tot de bovenste gelezen rij aan stop() voldoet.
function readTailUntil_(sh, nCols, stop) {
  const last = lastDataRow_(sh);
  if (last < 2) return [];
  let n = Math.min(last - 1, 1500);
  for (;;) {
    const rows = sh.getRange(last - n + 1, 1, n, nCols).getValues();
    if (n >= last - 1 || stop(rows[0])) return rows;
    n = Math.min(last - 1, n * 2);
  }
}

// ---------- Website-koppeling (JSON) ----------
//
// Als dit script als web-app is geïmplementeerd (Implementeren > Nieuwe implementatie >
// Web-app, uitvoeren als: ik, toegang: iedereen), geeft de URL je gegevens als JSON,
// maar alleen met de juiste toegangscode: .../exec?token=JOUW_CODE
// De code staat alleen in de scripteigenschappen en in je eigen browser, nooit in de website-code.

function createWebToken() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('T212_WEB_TOKEN')) {
    const r = ui.alert('Toegangscode bestaat al',
      'Er is al een toegangscode. Een nieuwe maken maakt de oude ongeldig. Doorgaan?', ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
  }
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  props.setProperty('T212_WEB_TOKEN', token);
  ui.alert('Website-toegangscode',
    'Kopieer deze code en vul hem één keer in op je website:\n\n' + token +
    '\n\nDeel hem met niemand. Wie de code heeft, kan je portefeuillegegevens zien.', ui.ButtonSet.OK);
}

function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('T212_WEB_TOKEN');
  const given = e && e.parameter ? String(e.parameter.token || '') : '';
  if (!token || given.length !== token.length || given !== token) {
    return json_({ ok: false, error: 'Ongeldige of ontbrekende toegangscode.' });
  }
  try {
    return json_(buildWebData_());
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function buildWebData_() {
  const ss = SpreadsheetApp.getActive();
  const iso = v => v instanceof Date ? Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm:ss") : (v === '' ? null : v);
  const n = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 1e6) / 1e6 : null;
  const read = (name, nCols) => {
    const sh = ss.getSheetByName(name);
    if (!sh) return [];
    const last = lastDataRow_(sh);
    return last > 1 ? sh.getRange(2, 1, last - 1, nCols).getValues() : [];
  };

  const weeks = read(SHEET_WEEK, 15).filter(r => r[0] !== '').map(r => ({
    date: iso(r[0]), accountValue: n(r[1]), netDeposits: n(r[2]), cash: n(r[3]), costBasis: n(r[4]),
    investmentsValue: n(r[5]), unrealized: n(r[6]), totalResult: n(r[7]), totalResultPct: n(r[8]),
    weekChange: n(r[10]), newDeposits: n(r[11]), weekResult: n(r[12]), weekResultPct: n(r[13]),
    source: r[14] || null,
  }));

  const posAll = read(SHEET_POS, 14).filter(r => r[0] !== '');
  const lastPosDate = posAll.reduce((m, r) => (r[0] > m ? r[0] : m), '');
  const positions = posAll.filter(r => +r[0] === +lastPosDate).map(r => ({
    ticker: r[1], name: r[2], value: n(r[3]), unrealized: n(r[4]), cost: n(r[5]), resultPct: n(r[6]),
    quantity: n(r[12]),
  }));

  const dagSh = ss.getSheetByName('Dagoverzicht');
  let today = [];
  if (dagSh) {
    today = dagSh.getRange(5, 1, 56, 14).getValues().filter(r => r[0] !== '' && typeof r[0] === 'string')
      .map(r => ({
        ticker: r[0], name: r[1], current: n(r[2]), low: n(r[3]), high: n(r[4]), avg: n(r[5]), open: n(r[6]),
        change: n(r[7]), changePct: n(r[8]), allTimeHigh: n(r[9]), allTimeLow: n(r[10]),
        avgRange: n(r[11]), avgRangePct: n(r[12]), days: n(r[13]),
      }));
  }

  const intraday = read(SHEET_INTRA, 4).filter(r => r[0] instanceof Date).map(r => [iso(r[0]), r[1], n(r[3])]);

  const since = new Date(Date.now() - 31 * 864e5);
  const hours = read(SHEET_HOUR, 8).filter(r => r[0] instanceof Date && r[0] >= since)
    .map(r => [iso(r[0]), r[1], n(r[3]), n(r[4]), n(r[5]), n(r[6]), n(r[7])]);

  const days = read(SHEET_DAYD, 10).filter(r => r[0] !== '')
    .map(r => [iso(r[0]), r[1], n(r[3]), n(r[4]), n(r[5]), n(r[6]), n(r[7]), n(r[8]), n(r[9])]);

  return {
    ok: true,
    generated: iso(new Date()),
    currency: 'EUR',
    weeks: weeks,
    positionsDate: iso(lastPosDate),
    positions: positions,
    today: today,
    intraday: { columns: ['time', 'ticker', 'value'], rows: intraday },
    hours: { columns: ['hour', 'ticker', 'open', 'close', 'low', 'high', 'avg'], rows: hours },
    days: { columns: ['date', 'ticker', 'open', 'close', 'low', 'high', 'avg', 'range', 'rangePct'], rows: days },
  };
}

// ---------- Formules in de notatie van de sheet ----------
//
// Apps Script schrijft formules in de taalinstelling van de spreadsheet. In een
// Nederlandse sheet moeten argumenten met ';' gescheiden worden en decimalen met ','.
// De formules in dit script staan in Engelse notatie; loc_() zet ze zo nodig om.

let FORMULA_SEP_ = null;

function formulaSep_() {
  if (FORMULA_SEP_) return FORMULA_SEP_;
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_SYM) || ss.getSheets()[0];
  const cell = sh.getRange(1, sh.getMaxColumns());
  const before = cell.getFormula() || cell.getValue();
  cell.setFormula('=SUM(1,2)');
  SpreadsheetApp.flush();
  const ok = cell.getValue() === 3;
  if (before) cell.setValue(before); else cell.clearContent();
  FORMULA_SEP_ = ok ? ',' : ';';
  return FORMULA_SEP_;
}

function loc_(f) {
  if (formulaSep_() === ',') return f;
  return f.replace(/,/g, ';').replace(/(\d)\.(\d)/g, '$1,$2');
}

// ---------- Algemene hulpfuncties ----------

function liveCash_(sum) {
  return num_(sum.cash.availableToTrade) + num_(sum.cash.inPies) + num_(sum.cash.reservedForOrders);
}

// "AAPL_US_EQ" -> "AAPL", "VUAGl_EQ" -> "VUAG", "RHMd_EQ" -> "RHM"
function normTicker_(t) {
  const base = String(t).split('_')[0];
  return base.replace(/[a-z]+$/, '') || base;
}

function saturdaysBetween_(fromStr, toExclusiveStr) {
  const out = [];
  let d = Utilities.parseDate(fromStr + ' 12:00:00', TZ, 'yyyy-MM-dd HH:mm:ss');
  while (Utilities.formatDate(d, TZ, 'u') !== '6') d = new Date(d.getTime() + 864e5);
  let s = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  while (s < toExclusiveStr) {
    out.push(s);
    d = new Date(d.getTime() + 7 * 864e5);
    s = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  }
  return out;
}

function addDays_(dateStr, n) {
  const d = Utilities.parseDate(dateStr + ' 12:00:00', TZ, 'yyyy-MM-dd HH:mm:ss');
  return Utilities.formatDate(new Date(d.getTime() + n * 864e5), TZ, 'yyyy-MM-dd');
}

function fmt_(v) {
  if (v === '' || v === null) return '';
  return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v).slice(0, 10);
}

function parseAmount_(s) {
  return Number(String(s).replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
}

function amountKey_(x) { return Math.abs(num_(x)).toFixed(2); }
function num_(x) { return typeof x === 'number' ? x : Number(x || 0); }
function round2_(x) { return Math.round(x * 100) / 100; }
function round6_(x) { return Math.round(x * 1e6) / 1e6; }
