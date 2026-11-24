/* Investeringstracker – Handel extra: wat een order met je portefeuille doet, tweede bevestiging bij grote orders,
 * extra controle na stilte, oefenmodus (er wordt nooit iets naar Trading 212 gestuurd), vragenlijst bij verkopen,
 * orders met hun reden (en de vraag of die nog klopt) en een beslisdagboek met jaaroverzicht.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- 52. Wat deze order met je portefeuille doet ----------
// Dagrendementen uit de koersreeks van een symbool (in de munt van het aandeel)
function retsForSym(sym) {
  const m = new Map();
  const pts = M.mk.ok ? M.mk.prices(sym) : [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].v, b = pts[i].v;
    if (a > 0 && b > 0) { const r = b / a - 1; if (Math.abs(r) < 0.5) m.set(pts[i].day, r); }
  }
  return m;
}
// Beweeglijkheid van de portefeuille bij andere gewichten, met dezelfde rekenwijze als de risicopagina
function simVolFor(weights, extra) {
  const R = riskModel();
  const parts = R.items.filter((x) => x.n >= 60).map((x) => ({ w: weights.get(x.c.tk) || 0, rets: x.rets }));
  if (extra && extra.rets && extra.rets.size >= 60 && extra.w > 0) parts.push({ w: extra.w, rets: extra.rets });
  const cov = sum(parts.map((p) => p.w));
  if (!(cov >= 0.6)) return null;
  const daySet = new Set();
  parts.forEach((p) => p.rets.forEach((_, d) => daySet.add(d)));
  const dayList = [...daySet].sort().slice(-260);
  const rs = [];
  dayList.forEach((d) => {
    let sw = 0, sr = 0;
    parts.forEach((p) => { const r = p.rets.get(d); if (isNum(r)) { sw += p.w; sr += p.w * r; } });
    if (sw >= cov * 0.8 && sw > 0) rs.push(sr / sw);
  });
  return rs.length >= 60 ? stdev(rs) * Math.sqrt(252) : null;
}
// Gewicht, sector en risicoklasse voor en na de order
function tradeAfter(I, side, amountEur) {
  const tot = M.totalValue || 0;
  if (!(tot > 0) || !(amountEur > 0)) return null;
  const held = I.tk ? M.byTk.get(I.tk) : null;
  const value = held && isNum(held.value) ? held.value : 0;
  const delta = side === 'SELL' ? -Math.min(amountEur, value) : amountEur;
  const newTot = tot + delta;
  if (!(newTot > 0)) return null;
  const newVal = Math.max(0, value + delta);
  const sector = held ? M.mk.sectorOf(held) : (M.mk.ok && M.mk.prof(I.sym) && M.mk.prof(I.sym).sector) || 'Onbekend';
  const secOld = sum(M.companies.filter((c) => M.mk.sectorOf(c) === sector).map((c) => c.value));
  const weights = new Map();
  M.companies.forEach((c) => weights.set(c.tk, (c.tk === (I.tk || '') ? newVal : c.value) / newTot));
  const R = riskModel();
  const extra = !held && I.sym ? { w: newVal / newTot, rets: retsForSym(I.sym) } : null;
  const volAfter = simVolFor(weights, extra);
  return {
    oldW: value / tot, newW: newVal / newTot,
    sector, oldSecW: secOld / tot, newSecW: (secOld + delta) / newTot,
    oldCls: R.cls, newCls: srri(volAfter), volAfter,
    estimate: !!extra,
  };
}
// Regels voor het orderscherm (gaan in dezelfde lijst als de rest van de gegevens)
function tradeAfterRows(I, side, amountEur) {
  const A = tradeAfter(I, side, amountEur);
  if (!A) return '';
  const name = I.label;
  // In de oefenmodus verandert je echte portefeuille niet; dat zegt het kopje er dan bij
  const head = paperOn() ? 'Als je dit echt zou doen' : 'Na deze order';
  const rows = ['<div><dt>' + head + '</dt><dd>' + esc(name + ' is dan ' + P1.format(A.newW) + ' van je beleggingen (nu ' + P1.format(A.oldW) + ')') + '</dd></div>'];
  if (A.sector && A.sector !== 'Onbekend') {
    rows.push('<div><dt>Sector daarna</dt><dd>' + esc(sectorNl(A.sector) + ' ' + P1.format(Math.max(0, A.newSecW)) + ' (nu ' + P1.format(A.oldSecW) + ')') + '</dd></div>');
  }
  const cls = A.newCls && A.oldCls ? (A.newCls === A.oldCls ? 'blijft ' + A.oldCls + ' van 7 (' + RISK_WORDS[A.oldCls] + ')' : 'van ' + A.oldCls + ' naar ' + A.newCls + ' van 7 (' + RISK_WORDS[A.newCls] + ')') : null;
  rows.push('<div><dt>Risicoklasse portefeuille</dt><dd' + (A.newCls && A.oldCls && A.newCls > A.oldCls ? ' class="loss"' : '') + '>' +
    (cls ? esc(cls + (isNum(A.volAfter) ? ', schommelt dan ± ' + PCT0.format(A.volAfter) + ' per jaar' : '')) : '<span class="muted">nog te weinig koershistorie</span>') + '</dd></div>');
  if (A.estimate) rows.push('<div><dt>Let op</dt><dd class="muted">' + esc('De klasse is een schatting: van ' + name + ' gebruikt de tracker de koers in de eigen munt, zonder wisselkoerseffect.') + '</dd></div>');
  return rows.join('');
}

// ---------- 53. Tweede bevestiging bij een grote order ----------
const BIG_SHARE = 0.1;    // vanaf dit deel van je beleggingen vraagt de tracker het bedrag nog eens
const bigShareOf = (amountEur) => (M && M.totalValue > 0 && amountEur > 0 ? amountEur / M.totalValue : 0);
const bigOrder = (amountEur) => bigShareOf(amountEur) >= BIG_SHARE;
const bigWanted = (amountEur) => Math.round(amountEur);
function bigOrderOk(st, amountEur) {
  if (!bigOrder(amountEur)) return true;
  return Number(String(st.big || '').replace(',', '.')) === bigWanted(amountEur);
}
function bigOrderBlock(st, amountEur) {
  if (!bigOrder(amountEur)) return '';
  const want = bigWanted(amountEur);
  const typed = String(st.big || '').trim();
  const ok = bigOrderOk(st, amountEur);
  return '<div class="ord-big"><p class="small"><b>Grote order.</b> Dit is ongeveer ' + esc(P1.format(bigShareOf(amountEur))) + ' van je beleggingen' +
    (M.accountNow > 0 ? ' (' + esc(P1.format(amountEur / M.accountNow)) + ' van je accountwaarde)' : '') + '. Typ het bedrag in hele euro\'s (' + esc(NI.format(want)) + ') om te bevestigen.</p>' +
    '<label class="wm-l">Bedrag ter bevestiging<span class="eur-in">€<input type="text" inputmode="numeric" autocomplete="off" data-t="big" value="' + esc(typed) + '" placeholder="' + esc(String(want)) + '"></span></label>' +
    // Altijd dezelfde opbouw (ook zonder melding), zodat het veld bij het typen niet vervangen wordt
    '<p class="small ' + (ok ? 'gain' : typed ? 'loss' : '') + '">' + (typed && !ok ? 'Dat is niet hetzelfde bedrag.' : ok ? 'Bedrag bevestigd.' : '') + '</p></div>';
}

// ---------- 158. Extra controle na een tijd zonder bevestiging ----------
const LS_ORDLOCK = 'tracker.ordlock';     // per apparaat: wachttijd en (optioneel) een PIN
const SS_ORDOK = 'tracker.ordok';         // tijdstip van de laatste bevestiging, alleen in dit tabblad
const ORD_MINS = [5, 15, 60];
function ordLock() {
  try { const o = JSON.parse(localStorage.getItem(LS_ORDLOCK) || '{}'); return { mins: ORD_MINS.includes(Number(o.mins)) ? Number(o.mins) : 15, salt: o.salt || '', hash: o.hash || '' }; }
  catch (e) { return { mins: 15, salt: '', hash: '' }; }
}
function ordLockSave(o) { try { localStorage.setItem(LS_ORDLOCK, JSON.stringify(Object.assign(ordLock(), o))); } catch (e) { /* niet erg */ } }
const ordOkAt = () => { try { return Number(sessionStorage.getItem(SS_ORDOK)) || 0; } catch (e) { return 0; } };
const ordOkNow = () => { try { sessionStorage.setItem(SS_ORDOK, String(Date.now())); } catch (e) { /* niet erg */ } };
const ordHasPin = () => !!ordLock().hash;
// Alleen bij echte orders: in de demo en in de oefenmodus gaat er niets naar Trading 212
const ordLockNeeded = () => !demo && !sharedView && !paperOn() && Date.now() - ordOkAt() > ordLock().mins * 60000;
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function pinMatches(pin) {
  const L = ordLock();
  if (!L.hash || !L.salt || !crypto.subtle) return false;
  return (await sha256Hex(L.salt + ':' + pin)) === L.hash;
}
function orderLockBlock(st) {
  if (demo) return '<p class="small muted" style="margin-top:8px">Buiten de demo vraagt de tracker hier je PIN als je een tijd geen order bevestigd hebt. Heb je nog geen PIN, dan stel je er hier een in. Zie Instellingen, Koppelingen of Analyse, Orderbeveiliging.</p>';
  if (!ordLockNeeded()) return '';
  const mins = ordLock().mins;
  const pin = ordHasPin();
  return '<div class="ord-lock"><p class="small"><b>Extra controle.</b> Je hebt op dit apparaat ' + mins + ' minuten of langer geen order bevestigd. ' +
    (pin ? 'Vul je PIN in om deze order te kunnen plaatsen.' : 'Stel een PIN in voor orders op dit apparaat (4 tot 12 cijfers). Daarna vraagt de tracker deze PIN voor je volgende orders.') + '</p>' +
    (pin ? '<label class="wm-l">PIN<input type="password" inputmode="numeric" autocomplete="off" maxlength="12" data-t="pin"></label>'
      : '<div class="plan-inputs"><label>Nieuwe PIN<input type="password" inputmode="numeric" autocomplete="new-password" maxlength="12" data-t="pinnew"></label>' +
        '<label>Nog een keer<input type="password" inputmode="numeric" autocomplete="new-password" maxlength="12" data-t="pinnew2"></label></div>') +
    '<div class="exp"><button type="button" class="btn ghost" data-t="unlock">' + (pin ? 'Ontgrendelen' : 'PIN instellen en doorgaan') + '</button><span class="small ord-lock-st" role="status"></span></div></div>';
}
// Een nieuwe PIN controleren en bewaren; geeft een foutmelding terug of '' als het gelukt is
async function ordPinSet(pin, pin2) {
  if (!/^\d{4,12}$/.test(pin)) return 'Een PIN van 4 tot 12 cijfers.';
  if (pin !== pin2) return 'De twee invoervelden zijn niet gelijk.';
  if (!window.crypto || !crypto.subtle) return 'Deze browser kan geen PIN bewaren.';
  const salt = randHex(16);
  ordLockSave({ salt, hash: await sha256Hex(salt + ':' + pin) });
  return '';
}
// Ontgrendelen met de PIN van dit apparaat, of eerst een PIN instellen als die er nog niet is
async function orderUnlockRun(dlg, after) {
  const st = /** @type {HTMLElement} */ (dlg.querySelector('.ord-lock-st'));
  const val = (k) => { const el = /** @type {HTMLInputElement} */ (dlg.querySelector('[data-t="' + k + '"]')); return el ? el.value.trim() : ''; };
  const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'small ord-lock-st ' + (cls || ''); } };
  if (ordHasPin()) {
    if (!val('pin')) { say('Vul je PIN in.', 'loss'); return; }
    say('Bezig met controleren…');
    if (await pinMatches(val('pin'))) { ordOkNow(); after(); return; }
    say('Die PIN klopt niet.', 'loss');
    return;
  }
  const err = await ordPinSet(val('pinnew'), val('pinnew2'));
  if (err) { say(err, 'loss'); return; }
  ordOkNow();
  after();
}
// Opnieuw tekenen waar de PIN-instellingen staan (Analyse en Instellingen, Koppelingen)
function ordRedraw() {
  refresh('analyse');
  if (linkState && $('links-body')) renderLinks();
}
// Wachttijd en PIN; staat op Analyse (Orderbeveiliging) en bij Instellingen, Koppelingen
function ordPinBox() {
  const L = ordLock();
  const has = !!L.hash;
  return '<div class="ord-safety">' +
    '<p class="small" style="margin:8px 0 4px"><b>Order-PIN</b> · ' + esc(has ? 'ingesteld op dit apparaat' : 'nog niet ingesteld; de eerste order vraagt je er een in te stellen') + '</p>' +
    '<div class="seg light" role="group" aria-label="Wachttijd">' + ORD_MINS.map((m) => '<button type="button" data-ord-mins="' + m + '" aria-pressed="' + (m === L.mins) + '">' + m + ' min</button>').join('') + '</div>' +
    '<div class="plan-inputs" style="margin-top:10px">' +
    (has ? '<label>Huidige PIN<input type="password" inputmode="numeric" autocomplete="current-password" maxlength="12" data-ord-pin0></label>' : '') +
    '<label>' + (has ? 'Nieuwe PIN' : 'PIN (4 tot 12 cijfers)') + '<input type="password" inputmode="numeric" autocomplete="new-password" maxlength="12" data-ord-pin></label>' +
    '<label>Nog een keer<input type="password" inputmode="numeric" autocomplete="new-password" maxlength="12" data-ord-pin2></label>' +
    '<button type="button" class="btn primary" data-ord-set>' + (has ? 'PIN wijzigen' : 'PIN bewaren') + '</button>' + (has ? '<button type="button" class="btn ghost danger" data-ord-clear>PIN wissen</button>' : '') + '</div>' +
    '<span class="small plan-status ord-st" role="status"></span>' +
    (has ? '<p class="small muted" style="margin-top:6px">Wijzigen en wissen vragen je huidige PIN. PIN vergeten? Wis de sitegegevens van deze browser; daarna stel je bij de volgende order een nieuwe in.</p>' : '') +
    '</div>';
}
function orderSafetyTile() {
  if (!tradingOn() || sharedView) return '';
  const L = ordLock();
  const left = Math.max(0, L.mins * 60000 - (Date.now() - ordOkAt()));
  return '<section class="tile pad"><h3>Orderbeveiliging</h3>' +
    kvList([
      ['Extra controle na', L.mins + ' minuten zonder bevestiging'],
      ['Controle met', L.hash ? 'PIN op dit apparaat' : 'nog geen PIN: de eerste order vraagt je er een in te stellen'],
      ['Nu', demo ? 'in de demo vraagt de tracker geen extra controle' : ordLockNeeded() ? 'de volgende order vraagt een extra controle' : 'bevestigd, nog ' + Math.ceil(left / 60000) + ' minuten geldig', demo || ordLockNeeded() ? '' : 'gain'],
    ]) + ordPinBox() +
    '<p class="sub" style="margin-top:8px">De PIN blijft op dit apparaat (in de browser) en versleutelt niets: hij voorkomt vooral een order per ongeluk of door iemand die je telefoon even in handen heeft. Je Trading 212-sleutel is er niet voor nodig. Deze controle geldt niet in de oefenmodus en niet in de demo, want daar gaat er niets naar Trading 212.</p></section>';
}
document.addEventListener('click', async (e) => {
  const m = near(e, '[data-ord-mins]');
  if (m) { ordLockSave({ mins: Number(m.dataset.ordMins) }); ordRedraw(); return; }
  const box = near(e, '.ord-safety');
  if (!box) return;
  const st = /** @type {HTMLElement} */ (box.querySelector('.ord-st'));
  const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'small plan-status ord-st ' + (cls || ''); } };
  const v = (sel) => { const el = /** @type {HTMLInputElement} */ (box.querySelector(sel)); return el ? el.value.trim() : ''; };
  const clear = near(e, '[data-ord-clear]'), set = near(e, '[data-ord-set]');
  if (!clear && !set) return;
  // Wijzigen of wissen kan alleen met de huidige PIN
  if (ordHasPin() && !(await pinMatches(v('[data-ord-pin0]')))) { say(v('[data-ord-pin0]') ? 'De huidige PIN klopt niet.' : 'Vul je huidige PIN in.', 'loss'); return; }
  if (clear) { ordLockSave({ salt: '', hash: '' }); ordRedraw(); return; }
  const err = await ordPinSet(v('[data-ord-pin]'), v('[data-ord-pin2]'));
  if (err) { say(err, 'loss'); return; }
  ordRedraw();
});

// ---------- 56. Oefenmodus: orders tegen de echte koers, in een eigen schaduwboek ----------
const PAPER_START = 1000;
function paperState() {
  const p = userPrefs().paper || {};
  return { on: !!p.on, start: isNum(p.start) && p.start > 0 ? p.start : PAPER_START, cash: isNum(p.cash) ? p.cash : (isNum(p.start) ? p.start : PAPER_START), trades: Array.isArray(p.trades) ? p.trades : [] };
}
const paperOn = () => !sharedView && paperState().on;
async function paperSave(patch) {
  const next = Object.assign(paperState(), patch);
  next.trades = next.trades.slice(-80);
  await savePrefs({ paper: next });
}
// Koers in euro per stuk: van je eigen positie, anders uit het bedrijfsprofiel via de wisselkoers
function paperPrice(key) {
  const watch = isWatchKey(key);
  if (!watch) {
    const c = M.byTk.get(key);
    if (c && isNum(c.value) && c.qty > 0) return c.value / c.qty;
  }
  if (!M.mk.ok) return null;
  const p = M.mk.prof(watch ? key.slice(1) : M.mk.sym(key));
  if (!p || !isNum(p.price)) return null;
  const fx = fxOn(p.currency || 'USD', Date.now());
  return fx ? p.price / fx : null;
}
function paperPositions() {
  const m = new Map();
  paperState().trades.forEach((x) => {
    const o = m.get(x.key) || { key: x.key, label: x.label, qty: 0, cost: 0 };
    if (x.side === 'SELL') { const part = o.qty > 0 ? Math.min(1, x.qty / o.qty) : 0; o.cost -= o.cost * part; o.qty = Math.max(0, o.qty - x.qty); }
    else { o.qty += x.qty; o.cost += x.eur; }
    m.set(x.key, o);
  });
  return [...m.values()].filter((o) => o.qty > 1e-9).map((o) => {
    const pr = paperPrice(o.key);
    return Object.assign({}, o, { price: pr, value: isNum(pr) ? pr * o.qty : null });
  });
}
function paperTotals() {
  const P = paperState();
  const pos = paperPositions();
  const known = pos.filter((o) => isNum(o.value));
  const value = sum(known.map((o) => o.value));
  return { cash: P.cash, start: P.start, value, total: P.cash + value, result: P.cash + value - P.start, n: pos.length, unknown: pos.length - known.length, pos };
}
// Een oefenorder bijschrijven; er gaat niets naar Trading 212
async function paperExec(I, side, qty, amountEur) {
  const key = I.tk || ('~' + I.sym);
  const P = paperState();
  if (side === 'BUY' && amountEur > P.cash + 0.005) throw new Error('Je oefensaldo is ' + EUR.format(P.cash) + '; maak de order kleiner of vul het oefensaldo aan.');
  if (side === 'SELL') {
    const have = paperPositions().find((o) => o.key === key);
    if (!have || qty > have.qty + 1e-9) throw new Error('Zoveel heb je in je oefenboek niet.');
  }
  const trades = P.trades.concat([{ id: newOrderId().slice(0, 12), t: new Date().toISOString().slice(0, 16), key, label: I.label, side, qty: Math.round(qty * 1e6) / 1e6, eur: Math.round(amountEur * 100) / 100, price: isNum(I.price) ? I.price : null, cur: I.cur || 'EUR' }]);
  await paperSave({ trades, cash: Math.round((P.cash + (side === 'SELL' ? amountEur : -amountEur)) * 100) / 100 });
}
function paperTile() {
  if (sharedView) return '';
  const P = paperState();
  const T = paperTotals();
  return '<section class="tile pad paper-tile' + (P.on ? ' on' : '') + '"><div class="plan-head"><h3>Oefenmodus</h3>' + (P.on ? '<span class="paper-badge">Oefenmodus aan</span>' : '') + '</div>' +
    '<label class="check"><input type="checkbox" data-paper-on' + (P.on ? ' checked' : '') + '> Oefenmodus aan: elke order uit de app gaat naar dit oefenboek en nooit naar Trading 212</label>' +
    (P.on ? '<p class="small paper-warn" style="margin-top:8px">Zolang dit aan staat plaats je geen echte orders. Het orderscherm is dan oranje en de knop zegt “Oefenorder plaatsen”.</p>' : '') +
    '<div style="margin-top:10px">' + kvList([
      ['Oefensaldo vrij', eur(T.cash)],
      ['Oefenposities', T.n ? T.n + (T.n === 1 ? ' positie, samen ' : ' posities, samen ') + eur(T.value) : 'nog geen'],
      ['Totaal oefenboek', eur(T.total)],
      ['Resultaat', seur(T.result) + (T.start > 0 ? ' (' + spct1(T.result / T.start) + ')' : ''), tone(T.result)],
    ]) + '</div>' +
    (T.pos.length ? '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Aandeel</th><th class="num">Aantal</th><th class="num">Ingelegd</th><th class="num">Waarde nu</th><th class="num">Resultaat</th></tr></thead><tbody>' +
      T.pos.map((o) => { const r = isNum(o.value) && o.cost > 0 ? o.value / o.cost - 1 : null;
        return '<tr><td class="co"><b>' + esc(o.label) + '</b></td><td class="num">' + esc(N4.format(o.qty)) + '</td><td class="num">' + esc(eur(o.cost)) + '</td>' +
          '<td class="num">' + esc(isNum(o.value) ? eur(o.value) : '–') + '</td><td class="num ' + tone(r) + '">' + esc(isNum(r) ? spct1(r) : '–') + '</td></tr>'; }).join('') +
      '</tbody></table></div>' : '') +
    (P.trades.length ? '<h3 style="margin-top:14px">Oefenorders</h3><div class="tx-list">' + P.trades.slice().reverse().slice(0, 8).map((x) =>
      '<div class="tx"><span class="tag ' + (x.side === 'SELL' ? 'loss' : 'gain') + '">' + (x.side === 'SELL' ? 'Verkoop' : 'Koop') + '</span><span class="tx-m"><b>' + esc(x.label + ' ' + N4.format(x.qty)) + '</b><span class="sub">' + esc(String(x.t).replace('T', ' ') + ' · oefening') + '</span></span><span class="tx-v">' + esc(eur(x.eur)) + '</span></div>').join('') + '</div>' : '') +
    '<div class="plan-inputs" style="margin-top:10px"><label>Oefensaldo bij opnieuw beginnen<span class="eur-in">€<input type="number" min="1" step="50" data-paper-start value="' + esc(String(P.start)) + '"></span></label>' +
    '<button type="button" class="btn ghost" data-paper-reset>Oefenboek leegmaken</button></div><span class="small plan-status paper-st" role="status"></span>' +
    '<p class="sub" style="margin-top:8px">Oefenorders rekenen met de koers die de tracker kent (laatste meting of bedrijfsprofiel), zonder kosten, spread en belasting; een echte order loopt dus anders. Het oefenboek staat bij je eigen instellingen in de Worker. Geen beleggingsadvies.</p></section>';
}
document.addEventListener('change', async (e) => {
  const el = near(e, '[data-paper-on]');
  if (!el) return;
  const want = /** @type {HTMLInputElement} */ (el).checked;
  try { await paperSave({ on: want }); refresh('analyse'); }
  catch (err) { /** @type {HTMLInputElement} */ (el).checked = !want; }
});
document.addEventListener('click', async (e) => {
  const b = near(e, '[data-paper-reset]');
  if (!b) return;
  const box = b.closest('.paper-tile');
  const inp = /** @type {HTMLInputElement} */ (box.querySelector('[data-paper-start]'));
  const start = Math.max(1, Number(inp && inp.value) || PAPER_START);
  if (!confirm('Het oefenboek leegmaken en opnieuw beginnen met ' + EUR.format(start) + '?')) return;
  const st = /** @type {HTMLElement} */ (box.querySelector('.paper-st'));
  try { await paperSave({ trades: [], cash: start, start }); refresh('analyse'); }
  catch (err) { if (st) { st.textContent = 'Opslaan is mislukt: ' + err.message + '.'; st.className = 'small plan-status paper-st loss'; } }
});
// Teksten in het orderscherm die van de modus afhangen
const tradeSureText = () => (paperOn() ? 'Ik weet dat dit een oefenorder is: er wordt niets naar Trading 212 gestuurd.' : 'Ik begrijp dat dit een echte order met echt geld is.');
function tradeModeBanner() {
  if (paperOn()) return '<p class="paper-banner" role="status"><b>Oefenmodus</b> — deze order gaat naar je oefenboek, niet naar Trading 212.</p>';
  if (demo) return '<p class="demo-banner-dlg" role="status"><b>Voorbeeld</b> — in de demo wordt niets verstuurd.</p>';
  return '';
}

// ---------- 74. Vragenlijst bij verkopen (alleen vragen, geen advies) ----------
const SELL_Q = [
  ['reden', 'Is de reden waarom je dit kocht nog geldig?'],
  ['koop', 'Zou je dit aandeel vandaag opnieuw kopen voor dit bedrag?'],
  ['groot', 'Weet je hoe groot deze positie in je beleggingen is?'],
  ['plan', 'Weet je wat je met de opbrengst gaat doen?'],
  ['kosten', 'Heb je gekeken wat verkopen kost (wisselkosten, koersverschil, belasting)?'],
];
const sellCheckState = { key: '' };
const sellChecks = () => userPrefs().sellCheck || {};
// Korte versie in het orderscherm: dezelfde vragen, zonder antwoorden op te slaan
function sellQuestions(I, side) {
  if (side !== 'SELL') return '';
  const c = I.tk ? M.byTk.get(I.tk) : null;
  const w = c && isNum(c.weight) ? ' (' + P1.format(c.weight) + ' van je beleggingen)' : '';
  return '<details class="sell-check"><summary>Vragen om eerst na te lopen</summary><ul class="small">' +
    SELL_Q.map(([k, q]) => '<li>' + esc(q + (k === 'groot' ? w : '')) + '</li>').join('') +
    '</ul><p class="small muted">Alleen vragen: de tracker geeft geen advies en rekent geen score uit.</p></details>';
}
function sellCheckTile() {
  if (sharedView) return '';
  const opts = M.companies.slice().sort((a, b) => b.value - a.value);
  if (!opts.length) return '<section class="tile pad"><h3>Moet ik verkopen?</h3><p class="muted">Na je eerste aankoop staan hier vragen om langs te lopen voordat je verkoopt.</p></section>';
  const key = opts.some((c) => c.tk === sellCheckState.key) ? sellCheckState.key : opts[0].tk;
  const c = M.byTk.get(key);
  const saved = sellChecks()[key] || {};
  const A = saved.a || {};
  const buys = M.tx.buys.filter((x) => x.tk === key);
  const why = buys.map((x) => notesMap()[noteKey(x)]).filter(Boolean).pop();
  const pr = positionReturn(key);
  return '<section class="tile pad full sell-check-tile" data-sc><div class="plan-head"><h3>Moet ik verkopen?</h3></div>' +
    '<label class="wm-l">Positie<select data-sc-key>' + opts.map((o) => '<option value="' + esc(o.tk) + '"' + (o.tk === key ? ' selected' : '') + '>' + esc(o.tk + ' · ' + o.name) + '</option>').join('') + '</select></label>' +
    kvList([
      ['Deel van je beleggingen', isNum(c.weight) ? P1.format(c.weight) + ' (' + eur(c.value) + ')' : '–'],
      ['Resultaat sinds aankoop', isNum(c.resultPct) ? spct1(c.resultPct) + ' (' + seur(c.unreal) + ')' : '–', tone(c.unreal)],
      ['Rendement los van stortingen', pr && isNum(pr.twr) ? spct1(pr.twr) : '–'],
      ['Je reden bij het kopen', why ? '“' + why + '”' : 'niets genoteerd in het aankoopdagboek'],
    ]) +
    '<div class="sc-qs">' + SELL_Q.map(([k, q]) => '<div class="sc-q"><p class="small"><b>' + esc(q) + '</b></p>' +
      '<div class="seg light" role="group" aria-label="' + esc(q) + '">' + [['ja', 'Ja'], ['nee', 'Nee'], ['weet', 'Weet ik niet']].map(([v, l]) =>
        '<button type="button" data-sc-a="' + k + '" data-v="' + v + '" aria-pressed="' + (A[k] === v) + '">' + l + '</button>').join('') + '</div></div>').join('') + '</div>' +
    '<div class="plan-actions" style="margin-top:10px"><button type="button" class="btn primary" data-sc-save>Antwoorden bewaren</button>' +
    '<button type="button" class="btn ghost" data-sc-note>Als notitie in je beslisdagboek</button><span class="small plan-status sc-st" role="status">' +
    (saved.d ? 'Laatst bewaard op ' + esc(saved.d) : '') + '</span></div>' +
    '<p class="sub" style="margin-top:8px">Dit is een vragenlijst, geen advies: er komt geen uitkomst of score uit. De antwoorden staan bij je eigen instellingen, zodat je later ziet wat je dacht.</p></section>';
}
document.addEventListener('change', (e) => {
  const el = near(e, '[data-sc-key]');
  if (!el) return;
  sellCheckState.key = el.value;
  refresh('analyse');
});
document.addEventListener('click', async (e) => {
  const box = near(e, '[data-sc]');
  if (!box) return;
  const key = sellCheckState.key || (/** @type {HTMLSelectElement} */ (box.querySelector('[data-sc-key]')) || { value: '' }).value;
  const st = /** @type {HTMLElement} */ (box.querySelector('.sc-st'));
  const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'small plan-status sc-st ' + (cls || ''); } };
  const a = near(e, '[data-sc-a]');
  if (a) {
    box.querySelectorAll('[data-sc-a="' + a.dataset.scA + '"]').forEach((b) => b.setAttribute('aria-pressed', String(b === a)));
    return;
  }
  const answers = () => {
    const o = {};
    SELL_Q.forEach(([k]) => { const on = box.querySelector('[data-sc-a="' + k + '"][aria-pressed="true"]'); if (on) o[k] = /** @type {HTMLElement} */ (on).dataset.v; });
    return o;
  };
  if (near(e, '[data-sc-save]')) {
    const next = Object.assign({}, sellChecks());
    next[key] = { d: new Date().toISOString().slice(0, 10), a: answers() };
    say('Bezig met opslaan…');
    try { await savePrefs({ sellCheck: next }); refresh('analyse'); } catch (err) { say('Opslaan is mislukt: ' + err.message + '.', 'loss'); }
    return;
  }
  if (near(e, '[data-sc-note]')) {
    const A = answers();
    const txt = 'Vragenlijst verkopen: ' + SELL_Q.map(([k, q]) => q.replace(/\?$/, '') + ': ' + (A[k] || 'niet geantwoord')).join('; ');
    say('Bezig met opslaan…');
    try { await decAdd(new Date().toISOString().slice(0, 10), key, txt.slice(0, 400)); say('In je beslisdagboek gezet.', 'gain'); refresh('analyse'); }
    catch (err) { say('Opslaan is mislukt: ' + err.message + '.', 'loss'); }
  }
});

// ---------- 55. Orders met hun reden, en de vraag of die nog klopt ----------
const WHY_DAYS = 183;                       // na ongeveer een half jaar vraagt de tracker of je reden nog klopt
const whyOkMap = () => userPrefs().whyOk || {};
// Laatste bevestiging of, als die er niet is, de orderdatum
const whyLast = (x) => { const d = whyOkMap()[noteKey(x)]; const t = d ? ymd(d) : null; return isNum(t) ? Math.max(t, x.t) : x.t; };
const whyStale = (x) => !!notesMap()[noteKey(x)] && Date.now() - whyLast(x) > WHY_DAYS * DAY && M.byTk.has(x.tk);
// Dezelfde notitievelden als het aankoopdagboek (handlers in 12-nieuws.js), maar met tekst voor koop én verkoop
function whyNote(x) {
  const k = noteKey(x), n = notesMap()[k];
  return '<div class="note" data-note="' + esc(k) + '">' + (n ? '<p class="note-t">“' + esc(n) + '”</p>' : '') +
    '<button type="button" class="linklike small" data-xa="note-edit" data-k="' + esc(k) + '">' + (n ? 'Reden bewerken' : 'Reden toevoegen') + '</button>' +
    '<div class="note-ed" hidden><label class="sr-only" for="why-' + esc(k.replace(/[^A-Za-z0-9]/g, '')) + '">Reden bij deze order</label>' +
    '<textarea id="why-' + esc(k.replace(/[^A-Za-z0-9]/g, '')) + '" maxlength="500" rows="3" placeholder="Waarom deed je deze order? Wat verwachtte je?">' + esc(n || '') + '</textarea>' +
    '<span class="note-acts"><button type="button" class="btn primary" data-xa="note-save" data-k="' + esc(k) + '">Opslaan</button><button type="button" class="btn ghost" data-xa="note-cancel">Annuleren</button><span class="small note-st" role="status"></span></span></div></div>';
}
function orderHistoryTile() {
  const list = M.tx.trades.slice().sort((a, b) => b.t - a.t);
  if (!list.length) return '<section class="tile pad full"><h3>Orders met hun reden</h3><p class="muted">Zodra je eerste order in de tracker staat, kun je er hier een reden bij zetten.</p></section>';
  const stale = list.filter(whyStale);
  const show = stale.concat(list.filter((x) => !whyStale(x))).slice(0, 12);
  const withWhy = list.filter((x) => notesMap()[noteKey(x)]).length;
  return '<section class="tile pad full order-why"><div class="plan-head"><h3>Orders met hun reden</h3></div>' +
    '<p class="small">' + withWhy + ' van ' + list.length + ' orders hebben een reden.' +
    (stale.length ? ' Bij <b>' + stale.length + '</b> daarvan is die reden ouder dan een half jaar.' : '') + '</p>' +
    '<div class="tx-list" style="margin-top:8px">' + show.map((x) => {
      const old = whyStale(x);
      const ok = whyOkMap()[noteKey(x)];
      return '<div class="tx-why' + (old ? ' stale' : '') + '"><div class="tx"><span class="tag ' + (x.side === 'SELL' ? 'loss' : 'gain') + '">' + (x.side === 'SELL' ? 'Verkoop' : 'Koop') + '</span>' +
        '<span class="tx-m"><b>' + esc(x.tk + ' · ' + eur(x.net)) + '</b><span class="sub">' + esc(fD.format(x.t) + ' ' + new Date(x.t).getFullYear() + ' · ' + N4.format(x.qty) + ' × ' + money(x.price, x.cur) + (ok ? ' · reden bevestigd op ' + ok : '')) + '</span></span>' +
        '<span class="tx-v small">' + esc(M.byTk.has(x.tk) ? 'in bezit' : 'niet meer in bezit') + '</span></div>' +
        whyNote(x) +
        (old ? '<div class="why-ask"><p class="small"><b>Klopt je reden nog?</b> Je schreef die meer dan een half jaar geleden. Als er niets veranderd is, bevestig je het; anders pas je de reden aan.</p>' +
          '<div class="exp"><button type="button" class="btn ghost" data-why-ok="' + esc(noteKey(x)) + '">Ja, nog geldig</button>' +
          '<button type="button" class="btn ghost" data-why-edit="' + esc(noteKey(x)) + '">Reden bijwerken</button></div></div>' : '') + '</div>';
    }).join('') + '</div>' +
    '<p class="sub" style="margin-top:8px">Orders komen uit je Trading 212-geschiedenis; de redenen staan bij je eigen instellingen in de Worker (dezelfde notities als het aankoopdagboek). Na een half jaar vraagt de tracker of de reden nog klopt. Geen beleggingsadvies.</p></section>';
}
document.addEventListener('click', async (e) => {
  const ed = near(e, '[data-why-edit]');
  if (ed) {
    const box = ed.closest('.tx-why');
    const link = /** @type {HTMLElement} */ (box.querySelector('[data-xa="note-edit"]'));
    if (link) link.click();
    return;
  }
  const b = near(e, '[data-why-ok]');
  if (!b) return;
  /** @type {HTMLButtonElement} */ (b).disabled = true;
  const next = Object.assign({}, whyOkMap());
  next[b.dataset.whyOk] = new Date().toISOString().slice(0, 10);
  const keys = Object.keys(next).slice(-60);
  try { await savePrefs({ whyOk: Object.fromEntries(keys.map((k) => [k, next[k]])) }); refresh('analyse'); }
  catch (err) { /** @type {HTMLButtonElement} */ (b).disabled = false; b.textContent = 'Opnieuw'; }
});

// ---------- 75. Beslisdagboek met jaaroverzicht ----------
const decState = { year: null, key: '' };
const decList = () => (Array.isArray(userPrefs().decisions) ? userPrefs().decisions : []).slice().sort((a, b) => String(b.d).localeCompare(String(a.d)));
async function decAdd(d, key, text) {
  const item = { id: Math.random().toString(36).slice(2, 10), d: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10), key: String(key || '').slice(0, 20), text: String(text || '').slice(0, 400) };
  await savePrefs({ decisions: decList().concat([item]).slice(-60) });
}
// Keuzelijst: je posities, je volglijst en "algemeen"
function decOptions() {
  return [['', 'Algemeen (geen aandeel)']].concat(M.companies.slice().sort((a, b) => b.value - a.value).map((c) => [c.tk, c.tk + ' · ' + c.name]))
    .concat(watchSyms().map((s) => ['~' + s, s + ' (volglijst)']));
}
const decLabel = (key) => (!key ? 'Algemeen' : isWatchKey(key) ? key.slice(1) + ' (volglijst)' : key);
// Rendement van het aandeel sinds de datum van de notitie (los van je aan- en verkopen)
function sinceDateRet(key, t) {
  if (!key) return null;
  if (!isWatchKey(key) && M.byTk.has(key)) {
    const T = twrSeries(key);
    const a = T.filter((p) => p.t <= t + DAY).pop(), b = T[T.length - 1];
    if (a && b && a.v > 0 && b.t > a.t) return b.v / a.v - 1;
  }
  const sym = isWatchKey(key) ? key.slice(1) : (M.mk.ok ? M.mk.sym(key) : key);
  const pts = M.mk.ok ? M.mk.prices(sym) : [];
  const a2 = pts.filter((p) => p.t <= t + DAY).pop(), b2 = pts[pts.length - 1];
  return a2 && b2 && a2.v > 0 && b2.t > a2.t ? b2.v / a2.v - 1 : null;
}
function decJournalTile() {
  if (sharedView) return '';
  const L = decList();
  const today = new Date().toISOString().slice(0, 10);
  return '<section class="tile pad full dec-journal" data-dec><div class="plan-head"><h3>Beslisdagboek</h3></div>' +
    '<p class="small muted">Kort opschrijven wat je besloot en waarom, met een datum. Later lees je terug wat je dacht, los van hoe het uitpakte.</p>' +
    '<div class="plan-inputs" style="margin-top:8px"><label>Datum<input type="date" data-dec-d value="' + esc(today) + '" max="' + esc(today) + '"></label>' +
    '<label>Aandeel<select data-dec-key>' + decOptions().map(([k, l]) => '<option value="' + esc(k) + '"' + (k === decState.key ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label></div>' +
    '<label class="wm-l">Notitie<textarea data-dec-t maxlength="400" rows="3" placeholder="Bijvoorbeeld: helft verkocht omdat de positie 20% van mijn beleggingen werd."></textarea></label>' +
    '<div class="plan-actions"><button type="button" class="btn primary" data-dec-add>Notitie bewaren</button><span class="small plan-status dec-st" role="status"></span></div>' +
    (L.length ? '<div class="tx-list" style="margin-top:12px">' + L.slice(0, 10).map((x) => {
      const r = sinceDateRet(x.key, ymd(x.d));
      return '<div class="tx"><span class="tag">' + esc(decLabel(x.key)) + '</span><span class="tx-m"><b>' + esc(x.text) + '</b><span class="sub">' + esc(x.d) + '</span></span>' +
        '<span class="tx-v ' + tone(r) + '">' + esc(isNum(r) ? spct1(r) : '–') + '<span class="sub">sindsdien</span>' +
        '<button type="button" class="icon-x" data-dec-del="' + esc(x.id) + '" aria-label="Notitie verwijderen">×</button></span></div>';
    }).join('') + '</div>' : '<p class="muted" style="margin-top:12px">Nog geen notities.</p>') +
    '<p class="sub" style="margin-top:8px">“Sindsdien” is het rendement van het aandeel los van je aan- en verkopen (voor je volglijst: de koers in de eigen munt). Maximaal 60 notities; ze staan bij je eigen instellingen in de Worker.</p></section>';
}
function decYearTile() {
  const L = decList();
  const buys = M.tx.trades.filter((x) => notesMap()[noteKey(x)]);
  const years = [...new Set(L.map((x) => String(x.d).slice(0, 4)).concat(buys.map((x) => String(new Date(x.t).getFullYear()))))].sort().reverse();
  if (!years.length) return '<section class="tile pad full"><h3>Jaaroverzicht van je beslissingen</h3><p class="muted">Zodra je notities of redenen bij orders hebt, staat hier per jaar wat je besloot en hoe het sindsdien liep.</p></section>';
  const Y = years.includes(decState.year) ? decState.year : years[0];
  const notes = L.filter((x) => String(x.d).slice(0, 4) === Y);
  const ords = buys.filter((x) => String(new Date(x.t).getFullYear()) === Y).sort((a, b) => a.t - b.t);
  const rets = notes.map((x) => sinceDateRet(x.key, ymd(x.d))).filter(isNum);
  const stale = M.tx.trades.filter(whyStale).length;
  return '<section class="tile pad full dec-year"><div class="plan-head"><h3>Jaaroverzicht van je beslissingen</h3></div>' +
    '<div class="seg light wrap" role="group" aria-label="Jaar">' + years.slice(0, 6).map((y) => '<button type="button" data-dec-year="' + esc(y) + '" aria-pressed="' + (y === Y) + '">' + esc(y) + '</button>').join('') + '</div>' +
    '<div style="margin-top:10px">' + kvList([
      ['Notities in ' + Y, notes.length ? notes.length + (notes.length === 1 ? ' notitie' : ' notities') : 'geen'],
      ['Orders met een reden in ' + Y, ords.length ? ords.length + (ords.length === 1 ? ' order' : ' orders') : 'geen'],
      ['Gemiddeld sinds je notities', rets.length ? spct1(mean(rets)) + ' over ' + rets.length + (rets.length === 1 ? ' notitie' : ' notities') : '–', rets.length ? tone(mean(rets)) : ''],
      ['Redenen ouder dan een half jaar', stale ? stale + ' te bevestigen' : 'geen', stale ? 'loss' : 'gain'],
    ]) + '</div>' +
    (notes.length || ords.length ? '<div class="tx-list" style="margin-top:10px">' +
      notes.map((x) => { const r = sinceDateRet(x.key, ymd(x.d));
        return '<div class="tx"><span class="tag">' + esc(decLabel(x.key)) + '</span><span class="tx-m"><b>' + esc(x.text) + '</b><span class="sub">' + esc(x.d + ' · notitie') + '</span></span><span class="tx-v ' + tone(r) + '">' + esc(isNum(r) ? spct1(r) : '–') + '</span></div>'; }).join('') +
      ords.map((x) => { const r = sinceDateRet(x.tk, x.t);
        return '<div class="tx"><span class="tag ' + (x.side === 'SELL' ? 'loss' : 'gain') + '">' + esc(x.tk) + '</span><span class="tx-m"><b>' + esc('“' + notesMap()[noteKey(x)] + '”') + '</b><span class="sub">' + esc(fD.format(x.t) + ' ' + Y + ' · ' + (x.side === 'SELL' ? 'verkoop ' : 'koop ') + eur(x.net)) + '</span></span><span class="tx-v ' + tone(r) + '">' + esc(isNum(r) ? spct1(r) : '–') + '</span></div>'; }).join('') +
      '</div>' : '<p class="muted" style="margin-top:10px">Niets in dit jaar.</p>') +
    '<p class="sub" style="margin-top:8px">Terugkijken op je eigen redenering: wat schreef je op, en hoe liep het aandeel daarna (los van je aan- en verkopen). Dat het goed of slecht uitpakte, zegt niet of de beslissing verstandig was. Geen beleggingsadvies.</p></section>';
}
document.addEventListener('click', async (e) => {
  const y = near(e, '[data-dec-year]');
  if (y) { decState.year = y.dataset.decYear; refresh('analyse'); return; }
  const box = near(e, '[data-dec]');
  if (!box) return;
  const st = /** @type {HTMLElement} */ (box.querySelector('.dec-st'));
  const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'small plan-status dec-st ' + (cls || ''); } };
  const del = near(e, '[data-dec-del]');
  if (del) {
    const gone = decList().find((x) => x.id === del.dataset.decDel);
    try {
      await savePrefs({ decisions: decList().filter((x) => x.id !== del.dataset.decDel) });
      refresh('analyse');
      if (gone) toastUndo(T('Regel uit je beslisdagboek verwijderd.'), async () => { await savePrefs({ decisions: decList().filter((x) => x.id !== gone.id).concat([gone]) }); refresh('analyse'); });
    }
    catch (err) { say('Verwijderen is mislukt: ' + err.message + '.', 'loss'); }
    return;
  }
  if (!near(e, '[data-dec-add]')) return;
  const v = (sel) => { const el = /** @type {HTMLInputElement} */ (box.querySelector(sel)); return el ? el.value.trim() : ''; };
  if (!v('[data-dec-t]')) { say('Schrijf eerst een notitie.', 'loss'); return; }
  if (decList().length >= 60) { say('Je dagboek zit vol (60 notities); verwijder er een.', 'loss'); return; }
  say('Bezig met opslaan…');
  try { await decAdd(v('[data-dec-d]'), v('[data-dec-key]'), v('[data-dec-t]')); refresh('analyse'); }
  catch (err) { say('Opslaan is mislukt: ' + err.message + '.', 'loss'); }
});
document.addEventListener('change', (e) => {
  const el = near(e, '[data-dec-key]');
  if (el) decState.key = el.value;
});
