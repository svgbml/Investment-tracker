/* Investeringstracker – Kopen en verkopen (optioneel, staat standaard uit)
 * Orders gaan via je eigen Worker naar Trading 212. Elke order krijgt eerst een overzicht en moet je bevestigen;
 * de Worker controleert je grens per order en per dag en verstuurt dezelfde order nooit twee keer.
 * Staat de oefenmodus aan (zie 22-handel-extra.js), dan gaat elke order naar het oefenboek en nooit naar Trading 212.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

const tradeState = { open: null, loading: false, err: '' };
const tradingOn = () => demo || !!(FEAT().flags && FEAT().flags.trading);
const tradeLimitsNow = () => { const t = (M && M.settings && M.settings.tradeLimits) || {}; return { perOrder: Number(t.perOrder) > 0 ? Number(t.perOrder) : 500, perDay: Number(t.perDay) > 0 ? Number(t.perDay) : 1000 }; };
const FX_FEE = 0.0015;
// Het element waarop geklikt of getypt is, als invoerelement (voor de typecontrole)
const near = (e, sel) => { const t = /** @type {Element} */ (e.target); return /** @type {HTMLInputElement} */ (t && t.closest ? t.closest(sel) : null); };

// Knoppen op de bedrijfspagina (posities) en de volglijst
function tradeButtons(c) {
  if ((!tradingOn() && !paperOn()) || sharedView || !c || !c.qty) return '';
  const oef = paperOn() ? ' (oefenen)' : '';
  return '<div class="exp trade-btns' + (paperOn() ? ' paper' : '') + '" style="margin-top:12px"><button type="button" class="btn primary" data-trade="BUY" data-tk="' + esc(c.tk) + '">Kopen' + oef + '</button>' +
    '<button type="button" class="btn ghost" data-trade="SELL" data-tk="' + esc(c.tk) + '">Verkopen' + oef + '</button></div>';
}
function watchTradeTile(sym, p) {
  if ((!tradingOn() && !paperOn()) || sharedView) return '';
  const oef = paperOn();
  return '<section class="tile pad"><h3>Kopen' + (oef ? ' (oefenen)' : '') + '</h3><p class="small muted">' +
    (oef ? 'De oefenmodus staat aan: deze order gaat naar je oefenboek en niet naar Trading 212.' : 'Koop dit aandeel via Trading 212. Je ziet eerst een overzicht en bevestigt zelf.') + '</p>' +
    '<div class="exp" style="margin-top:8px"><button type="button" class="btn primary" data-trade="BUY" data-sym="' + esc(sym) + '">Kopen' + (oef ? ' (oefenen)' : '') + '</button></div></section>';
}

// Gegevens voor het orderscherm: Trading 212-ticker, koers in de eigen munt en in euro
function tradeInfo(btn) {
  const tk = btn.dataset.tk, sym = btn.dataset.sym;
  if (tk) {
    const c = M.byTk.get(tk);
    const x = (data.posExtra || {})[tk] || {};
    const cur = c.cur || x.cur || 'EUR';
    return { tk, label: tk, name: c.name, t212: x.t212 || null, cur, price: isNum(c.priceNative) ? c.priceNative : x.price, eurPer: c.qty ? c.value / c.qty : null, held: c.qty };
  }
  const p = (M.mk.ok && M.mk.prof(sym)) || {};
  const cur = p.currency || 'USD';
  const fx = fxOn(cur, Date.now());
  return { tk: null, sym, label: sym, name: p.name || sym, t212: null, cur, price: p.price, eurPer: isNum(p.price) && fx ? p.price / fx : null, held: 0 };
}
// Achtergrond in het orderscherm: risico van dit aandeel (schaal 1–7) en wat analisten vinden
function tradeRisk(I) {
  if (I.tk) {
    const r = companyRisk(M.byTk.get(I.tk));
    if (r && r.cls) return { cls: r.cls, vol: r.vol };
  }
  if (!M.mk.ok) return null;
  const sym = I.tk ? M.mk.sym(I.tk) : I.sym;
  const pts = (M.mk.prices(sym) || []).slice(-261);
  const rs = [];
  for (let i = 1; i < pts.length; i++) { const r = pts[i].v / pts[i - 1].v - 1; if (isNum(r) && Math.abs(r) < 0.5) rs.push(r); }
  if (rs.length >= 60) { const vol = stdev(rs) * Math.sqrt(252); return { cls: srri(vol), vol }; }
  const p = I.tk ? M.mk.profOf(I.tk) : M.mk.prof(sym);
  return p && isNum(p.beta) && p.beta > 0 ? { cls: null, vol: null, beta: p.beta } : null;
}
function tradeFacts(I) {
  const rows = [];
  const R = tradeRisk(I);
  if (R && R.cls) rows.push('<div><dt>Risico</dt><dd><span class="lvl" style="--k:' + R.cls + '">' + R.cls + '</span> ' + esc(RISK_WORDS[R.cls] + ' op een schaal van 1 tot 7' + (isNum(R.vol) ? ', schommelt ± ' + PCT0.format(R.vol) + ' per jaar' : '')) + '</dd></div>');
  else if (R && R.beta) rows.push('<div><dt>Risico</dt><dd>' + esc((R.beta >= 1.3 ? 'beweeglijker dan de markt' : R.beta <= 0.8 ? 'rustiger dan de markt' : 'ongeveer als de markt') + ' (beta ' + N2.format(R.beta) + ')') + '</dd></div>');
  else rows.push('<div><dt>Risico</dt><dd class="muted">onbekend (nog geen koershistorie)</dd></div>');
  const key = I.tk || I.sym;
  const rc = recOf(key);
  if (rc) {
    const word = rc.sell >= 0.3 ? 'vaak verkopen' : rc.buy >= 0.6 ? 'meestal kopen' : rc.buy >= 0.4 ? 'kopen en aanhouden' : 'meestal aanhouden';
    const r = (data.research || {})[key];
    const T = r && r.target && isNum(r.target.mean) ? r.target.mean : null;
    const up = T && isNum(I.price) && I.price > 0 ? T / I.price - 1 : null;
    rows.push('<div><dt>Analisten</dt><dd>' + esc(word + ': ' + PCT0.format(rc.buy) + ' van ' + rc.tot + ' zegt kopen') + '</dd></div>');
    if (T) rows.push('<div><dt>Koersdoel analisten</dt><dd>' + esc(money(T, I.cur) + (isNum(up) ? ' (' + spct(up) + ')' : '')) + '</dd></div>');
  } else rows.push('<div><dt>Analisten</dt><dd class="muted">' + esc(demo || (FEAT().keys && FEAT().keys.FINNHUB_KEY) ? 'geen oordeel bekend' : 'met een Finnhub-sleutel zie je hier wat analisten vinden') + '</dd></div>');
  return rows.join('');
}

const newOrderId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// ---------- Invoer: tekstvelden met komma of punt; de cursor blijft staan ----------
// Getal uit een invoerveld: "12,5", "12.5", "1.234,56" en "€ 20" werken allemaal
function numIn(s) {
  let t = String(s == null ? '' : s).replace(/[\s€%]/g, '');
  if (!t) return 0;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const n = Number(t);
  return isFinite(n) && n > 0 ? n : 0;
}
// Getal voor in een invoerveld: met komma, zonder duizendtallen
const numOut = (x, dec) => (isNum(x) && x > 0 ? String(Math.round(x * 10 ** dec) / 10 ** dec).replace('.', ',') : '');
const floorQty = (x) => Math.floor(x * 10000 + 1e-9) / 10000;
// Een deel van het scherm opnieuw tekenen zonder het veld te vervangen waarin je typt
function morphDom(live, fresh) {
  // Alleen het tekstveld waarin je typt blijft onaangeroerd (knoppen en vinkjes volgen gewoon de stand)
  if (live === document.activeElement && live.nodeName === fresh.nodeName && (/^(TEXTAREA|SELECT)$/.test(live.nodeName) || (live.nodeName === 'INPUT' && /** @type {HTMLInputElement} */ (live).type !== 'checkbox'))) return;
  if (live.nodeType === 3 && fresh.nodeType === 3) { if (live.nodeValue !== fresh.nodeValue) live.nodeValue = fresh.nodeValue; return; }
  const a = /** @type {HTMLInputElement} */ (live), b = /** @type {HTMLInputElement} */ (fresh);
  const syncAttrs = () => {
    [...a.attributes].forEach((x) => { if (!b.hasAttribute(x.name)) a.removeAttribute(x.name); });
    [...b.attributes].forEach((x) => { if (a.getAttribute(x.name) !== x.value) a.setAttribute(x.name, x.value); });
  };
  // Invoervelden houden zelf hun waarde bij: die zetten we los van het attribuut (een PIN zonder value blijft staan)
  if (live.nodeName === 'INPUT' && fresh.nodeName === 'INPUT' && a.type === b.type) {
    syncAttrs();
    if (a.type === 'checkbox') a.checked = b.hasAttribute('checked');
    else if (b.hasAttribute('value') && a.value !== b.getAttribute('value')) a.value = b.getAttribute('value');
    return;
  }
  // Gelijke opbouw overslaan, behalve als er invoervelden in zitten: hun waarde staat niet in de attributen
  if (live.isEqualNode(fresh) && !(live.nodeType === 1 && /** @type {Element} */ (live).querySelector('input'))) return;
  if (live.nodeType !== 1 || live.nodeName !== fresh.nodeName || live.childNodes.length !== fresh.childNodes.length || /^(SELECT|TEXTAREA)$/.test(live.nodeName)) {
    live.parentNode.replaceChild(fresh, live);
    return;
  }
  syncAttrs();
  const kids = [...live.childNodes], nk = [...fresh.childNodes];
  kids.forEach((n, i) => morphDom(n, nk[i]));
}
function patchDialog(dlg, html) {
  const act = /** @type {HTMLInputElement} */ (document.activeElement);
  const key = act && act !== document.body && dlg.contains(act) && act.dataset ? act.dataset.t : null;
  const val = key ? act.value : '';
  let s0 = null, s1 = null;
  try { s0 = act.selectionStart; s1 = act.selectionEnd; } catch (e) { /* geen tekstveld */ }
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  if (dlg.children.length !== 1 || !tmp.firstElementChild || dlg.firstElementChild.className !== tmp.firstElementChild.className) dlg.innerHTML = html;
  else morphDom(dlg.firstElementChild, tmp.firstElementChild);
  // Was het veld toch vervangen (andere opbouw), dan focus, waarde en cursor terugzetten
  if (key && !dlg.contains(act)) {
    const again = /** @type {HTMLInputElement} */ (dlg.querySelector('[data-t="' + key + '"]'));
    if (again) { if (again.type !== 'checkbox') again.value = val; again.focus(); try { if (s0 != null) again.setSelectionRange(s0, s1); } catch (e) { /* geen tekstveld */ } }
  }
}

// ---------- Nu bij Trading 212 kijken (positie en vrij saldo) ----------
// De meting is tot tien minuten oud; dit vraagt de stand van dit moment op via je eigen Worker.
const liveCache = new Map();
const LIVE_WAIT = 6000;   // Trading 212 staat het saldo maar eens per paar seconden toe
async function liveFetch(tk) {
  const k = tk || '';
  const had = liveCache.get(k);
  if (had && Date.now() - had.t < LIVE_WAIT) return had;
  let r;
  if (demo) {
    await new Promise((x) => setTimeout(x, 400));
    const c = tk ? (M.byTk.get(tk) || M.byTk.get(String(tk).split('_')[0])) : null;
    const f = 1 + (Math.random() - 0.4) * 0.03;
    r = { at: new Date().toISOString(), cash: isNum(M.cash) ? Math.round(M.cash * 100) / 100 : 0, errors: [],
      position: c && c.qty ? { qty: c.qty, avail: c.qty, value: Math.round(c.value * f * 100) / 100, price: isNum(c.priceNative) ? c.priceNative * f : null } : null, held: !!(c && c.qty) };
  } else r = await workerCall('/api/live' + (tk ? '?tk=' + encodeURIComponent(tk) : ''), { method: 'GET' });
  r.t = Date.now();
  liveCache.set(k, r);
  if (k && isNum(r.cash)) liveCache.set('', Object.assign({}, r, { position: null }));
  return r;
}
const liveTime = (r) => fHM.format(r && r.t ? r.t : Date.now()) + ':' + String(new Date(r && r.t ? r.t : Date.now()).getSeconds()).padStart(2, '0');
// Knop "Nu controleren" bij een positie (tk) of bij het vrije saldo (zonder tk)
function liveCheckBlock(tk) {
  if (sharedView || (!demo && !(isWorker() && getToken()))) return '';
  const k = tk || '';
  return '<div class="live-chk" data-live-key="' + esc(k) + '"><button type="button" class="btn ghost" data-live-go="' + esc(k) + '">Nu controleren</button>' +
    '<span class="small live-out muted" role="status">' + esc(liveCache.has(k) ? liveText(k, liveCache.get(k)) : tk ? 'Vraagt je positie nu op bij Trading 212.' : 'Vraagt je vrije saldo nu op bij Trading 212.') + '</span></div>';
}
function liveText(tk, r) {
  const at = 'Bij Trading 212 om ' + liveTime(r) + ': ';
  if (!tk) return isNum(r.cash) ? at + eur(r.cash) + ' vrij saldo' + (isNum(M.cash) ? ' (tracker: ' + eur(M.cash) + ')' : '') + '.' : 'Het saldo kon niet worden opgevraagd. ' + (r.errors || []).join(' ');
  const c = M.byTk.get(tk);
  const p = r.position;
  if (!p) return (r.errors || []).length ? 'De positie kon niet worden opgevraagd. ' + r.errors.join(' ') : at + 'geen positie meer (verkocht of in een pie).';
  const diff = c && c.value > 0 ? p.value / c.value - 1 : null;
  return at + N4.format(p.qty) + ' stuks, ' + eur(p.value) + (c ? ' (tracker: ' + eur(c.value) + (isNum(diff) && Math.abs(diff) >= 0.0005 ? ', ' + spct1(diff) : '') + ')' : '') +
    (isNum(r.cash) ? '; vrij saldo ' + eur(r.cash) : '') + '.';
}
document.addEventListener('click', async (e) => {
  const b = near(e, '[data-live-go]');
  if (!b) return;
  const box = b.closest('.live-chk');
  const out = /** @type {HTMLElement} */ (box && box.querySelector('.live-out'));
  const k = b.dataset.liveGo;
  b.disabled = true;
  if (out) { out.textContent = 'Bezig met opvragen…'; out.className = 'small live-out muted'; }
  try { const r = await liveFetch(k); if (out) { out.textContent = liveText(k, r); out.className = 'small live-out'; } }
  catch (err) { if (out) { out.textContent = foutTekst('Opvragen lukte niet', err, 'Trading 212 staat maar een paar verzoeken per minuut toe; probeer het zo opnieuw.'); out.className = 'small live-out loss'; } }
  setTimeout(() => { b.disabled = false; }, 1500);
});

async function openTradeDialog(btn) {
  const I = tradeInfo(btn);
  // Oefenmodus: verkopen kan wat er in je oefenboek staat, niet wat je echt hebt
  if (paperOn()) { const pp = paperPositions().find((o) => o.key === (I.tk || ('~' + I.sym))); I.held = pp ? pp.qty : 0; }
  // last: het veld dat je het laatst invulde (aantal, bedrag of percentage); de andere twee rekent de tracker uit
  // Verkopen kan alleen als je iets hebt (in de oefenmodus: in je oefenboek); anders opent het scherm op kopen
  const st = { side: btn.dataset.trade === 'SELL' && I.held > 0 ? 'SELL' : 'BUY', type: 'market', validity: 'DAY', qty: 0, limit: I.price || 0, id: newOrderId(), busy: false, done: false, choices: null,
    last: 'qty', raw: { qty: '', eur: '', pct: '', limit: I.price ? numOut(I.price, 4) : '' }, sellMode: 'part', live: null, liveBusy: false, liveErr: '', sure: false, big: '' };
  const L = tradeLimitsNow();
  const dlg = document.createElement('div');
  dlg.className = 'overlay-dlg trade-dlg' + (paperOn() ? ' paper' : '');
  document.body.appendChild(dlg);
  const close = () => dlg.remove();
  // Ticker bij Trading 212 opzoeken voor aandelen die je nog niet hebt
  if (!I.t212 && !demo && !paperOn()) {
    dlg.innerHTML = '<div class="dlg-card" role="dialog" aria-modal="true" aria-label="Order"><p class="muted">Instrument zoeken bij Trading 212…</p></div>';
    try {
      const r = await workerCall('/api/trade/instruments?q=' + encodeURIComponent(I.sym || I.tk), { method: 'GET' });
      const hits = (r.results || []).filter((x) => x.short === String(I.sym || I.tk).toUpperCase().replace(/\..*$/, ''));
      if (!hits.length) { dlg.innerHTML = '<div class="dlg-card"><p>Dit aandeel staat niet in de lijst van Trading 212 (of de lijst is nog niet opgehaald).</p><div class="dlg-actions"><button type="button" class="btn primary" data-x>Sluiten</button></div></div>'; /** @type {HTMLElement} */ (dlg.querySelector('[data-x]')).onclick = close; return; }
      I.t212 = hits[0].ticker; st.choices = hits.length > 1 ? hits : null;
      if (hits[0].cur && hits[0].cur !== I.cur) I.cur = hits[0].cur;
    } catch (e) { dlg.innerHTML = '<div class="dlg-card"><p class="loss">' + esc(e.message) + '</p><div class="dlg-actions"><button type="button" class="btn primary" data-x>Sluiten</button></div></div>'; /** @type {HTMLElement} */ (dlg.querySelector('[data-x]')).onclick = close; return; }
  }
  if ((demo || paperOn()) && !I.t212) I.t212 = (I.sym || I.tk) + '_US_EQ';
  const fxRate = () => (I.cur !== 'EUR' ? FX_FEE : 0);
  const priceEurAt = (native) => (I.eurPer && I.price ? native * I.eurPer / I.price : null);
  const perNow = () => (st.type === 'limit' && st.limit > 0 ? priceEurAt(st.limit) : I.eurPer);
  const cashNow = () => (paperOn() ? paperState().cash : st.live && isNum(st.live.cash) ? st.live.cash : isNum(M.cash) ? M.cash : null);
  const isSell = () => st.side === 'SELL';
  // Aantal uitrekenen uit het veld dat je het laatst invulde
  const recalc = () => {
    const v = numIn(st.raw[st.last]);
    const per = perNow();
    if (st.last === 'qty') st.qty = v;
    else if (st.last === 'eur') st.qty = per && v ? floorQty(v / per) : 0;
    else if (st.last === 'pct') {
      const p = Math.min(v, 100) / 100;
      if (isSell()) st.qty = p >= 0.99995 ? I.held : floorQty(p * I.held);
      else {
        // Kopen met een deel van je saldo: 1% marge voor koersbewegingen tot de order is uitgevoerd
        const cash = cashNow();
        const use = cash > 0 ? Math.min(p * cash, cash * 0.99) : 0;
        st.qty = per && use ? floorQty(use / (per * (1 + fxRate()))) : 0;
      }
    }
    if (isSell() && st.qty > I.held && I.held > 0 && st.last !== 'qty') st.qty = I.held;
  };
  const pctOfNow = (amount, fee) => {
    if (isSell()) return I.held > 0 && st.qty > 0 ? st.qty / I.held * 100 : 0;
    const cash = cashNow();
    return cash > 0 && amount > 0 ? (amount + fee) / cash * 100 : 0;
  };
  const liveRow = () => {
    if (paperOn()) return '';
    const r = st.live;
    const txt = st.liveBusy ? 'bezig met opvragen bij Trading 212…' : st.liveErr ? st.liveErr : r ? 'live om ' + liveTime(r) : 'cijfers van de laatste meting';
    return '<div><dt>Stand</dt><dd><span class="small ' + (st.liveErr ? 'loss' : r ? 'gain' : 'muted') + '">' + esc(txt) + '</span> <button type="button" class="linklike small" data-t="live"' + (st.liveBusy ? ' disabled' : '') + '>Nu controleren</button></dd></div>';
  };
  const html = () => {
    const per = perNow();
    const amount = per && st.qty ? per * st.qty : 0;
    const fee = amount * fxRate();
    const over = !paperOn() && amount > L.perOrder;
    const canSell = I.held > 0;
    const ok = st.qty > 0 && amount > 0 && !over && (!isSell() || (canSell && st.qty <= I.held + 1e-9)) && (st.type === 'market' || st.limit > 0);
    const cash = cashNow();
    const short = !isSell() && cash != null && amount + fee > cash + 0.005;
    const fixed = isSell() && st.sellMode === 'fixed' && st.type === 'market' && !paperOn();
    const val = (k, computed) => (st.last === k ? st.raw[k] : computed);
    const pctNow = pctOfNow(amount, fee);
    const chips = [25, 50, 75, 100].map((n) => '<button type="button" data-t="pctq" data-v="' + n + '" aria-pressed="' + (st.last === 'pct' && numIn(st.raw.pct) === n) + '">' + n + '%</button>').join('');
    return '<div class="dlg-card" role="dialog" aria-modal="true" aria-label="Order plaatsen">' +
      '<h3>' + (isSell() ? 'Verkopen' : 'Kopen') + (paperOn() ? ' (oefenen)' : '') + ': ' + esc(I.label) + '</h3><p class="small muted">' + esc(I.name) + (I.t212 ? ' · ' + esc(I.t212) : '') + '</p>' + tradeModeBanner() +
      (st.choices ? '<label class="wm-l">Beurs<select data-t="choice">' + st.choices.map((h) => '<option value="' + esc(h.ticker) + '"' + (h.ticker === I.t212 ? ' selected' : '') + '>' + esc(h.ticker + ' (' + h.cur + ')') + '</option>').join('') + '</select></label>' : '') +
      '<div class="seg light" role="group" aria-label="Kopen of verkopen"><button type="button" data-t="side" data-v="BUY" aria-pressed="' + !isSell() + '">Kopen</button><button type="button" data-t="side" data-v="SELL" aria-pressed="' + isSell() + '"' + (canSell ? '' : ' disabled') + '>Verkopen</button></div>' +
      '<div class="seg light" role="group" aria-label="Soort order" style="margin-top:8px"><button type="button" data-t="type" data-v="market" aria-pressed="' + (st.type === 'market') + '">Markt</button><button type="button" data-t="type" data-v="limit" aria-pressed="' + (st.type === 'limit') + '">Limiet</button></div>' +
      '<div class="plan-inputs trade-in" style="margin-top:10px"><label>Aantal<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-t="qty" value="' + esc(val('qty', numOut(st.qty, 4))) + '" placeholder="0"></label>' +
      '<label>of bedrag<span class="eur-in">€<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-t="eur" value="' + esc(val('eur', numOut(amount, 2))) + '" placeholder="0"></span></label>' +
      '<label>of percentage<span class="eur-in pct-in"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-t="pct" value="' + esc(val('pct', numOut(pctNow, 1))) + '" placeholder="0">%</span></label>' +
      (st.type === 'limit' ? '<label>Limietprijs<span class="eur-in">' + esc(CUR_SYM[I.cur] || I.cur) + '<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-t="limit" value="' + esc(st.raw.limit) + '"></span></label>' : '') + '</div>' +
      '<div class="seg light pct-chips" role="group" aria-label="' + (isSell() ? 'Deel van je positie' : 'Deel van je vrije saldo') + '" style="margin-top:8px">' + chips + '</div>' +
      '<p class="small muted" style="margin-top:4px">' + (isSell() ? 'Percentage van je positie' + (canSell ? ' (' + esc(N4.format(I.held)) + ' stuks)' : '') : 'Percentage van je ' + (paperOn() ? 'oefensaldo' : 'vrije saldo') + (cash != null ? ' (' + esc(eur(cash)) + ')' : '') + '; bij kopen houdt de tracker 1% marge aan voor koersbewegingen en de wisselkosten') + '.</p>' +
      (st.type === 'limit' ? '<div class="seg light" role="group" aria-label="Geldig" style="margin-top:8px"><button type="button" data-t="validity" data-v="DAY" aria-pressed="' + (st.validity === 'DAY') + '">Vandaag</button><button type="button" data-t="validity" data-v="GTC" aria-pressed="' + (st.validity === 'GTC') + '">Tot je annuleert</button></div>' : '') +
      (isSell() && !paperOn() ? '<div class="seg light" role="group" aria-label="Hoe verkopen" style="margin-top:10px"><button type="button" data-t="sellMode" data-v="part" aria-pressed="' + !fixed + '">Deel van je positie</button>' +
        '<button type="button" data-t="sellMode" data-v="fixed" aria-pressed="' + fixed + '"' + (st.type === 'market' ? '' : ' disabled') + '>Vast bedrag</button></div>' +
        '<p class="small muted" style="margin-top:4px">' + esc(fixed
          ? 'Vast bedrag: bij het versturen kijkt de Worker naar de koers van dat moment en verkoopt zoveel stuks dat het ± ' + eur(amount) + ' oplevert, ongeacht hoe de koers intussen bewoog (nooit meer dan je hebt).'
          : 'Deel van je positie: je invoer telt als ' + P1.format(Math.min(1, pctNow / 100)) + ' van je positie. Bij het versturen kijkt de Worker bij Trading 212 wat je nu echt hebt en verkoopt hetzelfde deel. Is je positie intussen meer of minder waard dan de tracker toont, dan verkoop je voor die echte waarde.') + '</p>' : '') +
      '<dl class="kv" style="margin-top:10px">' + liveRow() +
      '<div><dt>' + (paperOn() ? 'Oefensaldo' : 'Vrij saldo') + '</dt><dd>' + (cash != null ? esc(eur(cash)) + (!paperOn() && !st.live && M.cashAt ? ' <span class="small muted">(stand ' + esc(fDT.format(M.cashAt)) + ')</span>' : '') : '<span class="muted">volgt na de volgende meting</span>') + '</dd></div>' +
      (canSell ? '<div><dt>Je hebt</dt><dd>' + esc(N4.format(I.held) + ' stuks' + (I.eurPer ? ', ± ' + eur(I.held * I.eurPer) : '')) + '</dd></div>' : '') +
      '<div><dt>Koers nu</dt><dd>' + esc(isNum(I.price) ? money(I.price, I.cur) : 'onbekend') + '</dd></div>' +
      '<div><dt>Geschat bedrag</dt><dd>' + esc(amount ? eur(amount) + (st.qty ? ' (' + N4.format(st.qty) + ' stuks)' : '') : '–') + '</dd></div>' +
      '<div><dt>Wisselkosten (0,15%)</dt><dd>' + esc(fee ? '± ' + eur(fee) : I.cur === 'EUR' ? 'geen' : '–') + '</dd></div>' +
      '<div><dt>Jouw grenzen</dt><dd>' + (paperOn() ? '<span class="muted">gelden niet in de oefenmodus</span>' : esc(eur(L.perOrder) + ' per order, ' + eur(L.perDay) + ' per dag')) + '</dd></div>' +
      tradeFacts(I) + tradeAfterRows(I, st.side, amount) + '</dl>' +
      (short ? '<p class="small loss">' + (paperOn() ? 'Meer dan je oefensaldo.' : 'Meer dan je vrije saldo. Trading 212 weigert de order als er niet genoeg geld op je rekening staat.') + '</p>' : '') +
      (over ? '<p class="small loss">Groter dan je grens per order. Pas die aan bij Instellingen, Koppelingen.</p>' : '') +
      (isSell() && st.qty > I.held + 1e-9 ? '<p class="small loss">Meer dan je hebt.</p>' : '') +
      (st.type === 'market' ? '<p class="small muted">Een marktorder wordt uitgevoerd tegen de koers op dat moment; buiten de beurstijden wacht hij tot de beurs opent. De echte prijs kan afwijken.</p>' : '') +
      sellQuestions(I, st.side) +
      bigOrderBlock(st, amount) +
      orderLockBlock(st) +
      '<label class="check small" style="margin-top:8px"><input type="checkbox" data-t="sure"' + (st.sure ? ' checked' : '') + '> ' + esc(tradeSureText()) + '</label>' +
      '<p class="small plan-status" data-t="msg" role="status"></p>' +
      '<div class="dlg-actions"><button type="button" class="btn ghost" data-t="cancel">' + (st.done ? 'Sluiten' : 'Annuleren') + '</button>' +
      (st.done ? '' : '<button type="button" class="btn primary" data-t="go"' + (ok && st.sure && !st.busy && bigOrderOk(st, amount) && !ordLockNeeded() ? '' : ' disabled') + '>' +
        (st.busy ? 'Bezig…' : (paperOn() ? 'Oefenorder plaatsen' : isSell() ? 'Verkopen' : 'Kopen') + (amount ? ' voor ± ' + eur(amount + (isSell() ? -fee : fee)) : '')) + '</button>') + '</div>' +
      '<p class="sub" style="margin-top:8px">Geen beleggingsadvies. ' + (paperOn() ? 'Deze order gaat naar je oefenboek; er wordt niets naar Trading 212 gestuurd.' : 'De order gaat via je eigen Worker naar Trading 212.') + '</p></div>';
  };
  // Het statusbericht blijft staan als het scherm opnieuw getekend wordt
  let msg = { t: '', cls: '' };
  const say = (t, cls) => { msg = { t, cls: cls || '' }; const m = /** @type {HTMLElement} */ (dlg.querySelector('[data-t="msg"]')); if (m) { m.textContent = t; m.className = 'small plan-status ' + msg.cls; } };
  const draw = () => { patchDialog(dlg, html()); if (msg.t) say(msg.t, msg.cls); };
  // De stand van dit moment bij Trading 212: hoeveel je hebt, wat het waard is en je vrije saldo
  const checkLive = async () => {
    if (paperOn() || st.liveBusy) return;
    st.liveBusy = true; st.liveErr = ''; draw();
    try {
      const r = await liveFetch(I.tk || I.t212);
      st.live = r;
      const p = r.position;
      if (p) {
        I.held = p.avail;
        if (p.qty > 0 && p.value > 0) I.eurPer = p.value / p.qty;
        if (isNum(p.price) && p.price > 0) I.price = p.price;
      } else if (I.tk && r.held === false && !(r.errors || []).length) I.held = 0;
      if ((r.errors || []).length && !p && I.tk) st.liveErr = 'positie niet opgevraagd, de tracker rekent met de laatste meting';
      if (!(I.held > 0) && isSell()) st.side = 'BUY';
    } catch (err) { st.liveErr = 'opvragen lukte niet; de tracker rekent met de laatste meting'; }
    st.liveBusy = false;
    if (!st.done && !st.busy) { recalc(); draw(); }
  };
  draw();
  checkLive();
  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg && !st.busy) { close(); return; }
    const b = near(e, '[data-t]');
    if (!b || b.tagName === 'INPUT') return;
    const t = b.dataset.t;
    if (t === 'cancel') { close(); return; }
    if (t === 'live') { liveCache.delete(I.tk || I.t212 || ''); await checkLive(); return; }
    if (t === 'side' || t === 'type' || t === 'validity' || t === 'sellMode') {
      st[t] = b.dataset.v; st.sure = false;
      // Een percentage blijft een percentage (nu van je positie of van je saldo); anders blijft het aantal staan
      if (t === 'side' && st.last === 'eur') { st.last = 'qty'; st.raw.qty = numOut(st.qty, 4); }
      recalc(); draw(); return;
    }
    if (t === 'pctq') { st.last = 'pct'; st.raw.pct = b.dataset.v; st.sure = false; recalc(); draw(); return; }
    if (t === 'unlock') { await orderUnlockRun(dlg, draw); return; }
    if (t !== 'go' || st.busy) return;
    st.busy = true; draw();
    const per = perNow();
    const est = Math.round(per * st.qty * 100) / 100;
    const body = { side: st.side, type: st.type, ticker: I.t212, quantity: st.qty, limitPrice: st.type === 'limit' ? st.limit : undefined, validity: st.validity, estEur: est, clientId: st.id };
    // Verkopen: de Worker rekent met wat je op dat moment echt hebt
    if (isSell() && I.held > 0) {
      if (st.sellMode === 'fixed' && st.type === 'market') body.valueEur = st.last === 'eur' ? numIn(st.raw.eur) : est;
      else body.fraction = Math.min(1, st.last === 'pct' ? numIn(st.raw.pct) / 100 : st.qty / I.held);
    }
    try {
      // Oefenmodus: alleen bijschrijven in je eigen oefenboek, nooit versturen
      if (paperOn()) {
        await paperExec(I, st.side, st.qty, est);
        st.busy = false; st.done = true; draw();
        say('Oefenorder bijgeschreven in je oefenboek. Er is niets naar Trading 212 gestuurd.', 'gain');
        refresh('analyse');
        return;
      }
      let res;
      if (demo) { await new Promise((x) => setTimeout(x, 500)); res = { order: { id: 1, status: 'NEW' }, qty: st.qty, basis: 'live' }; }
      else res = await workerCall('/api/trade/order', { method: 'POST', body: JSON.stringify(body) });
      ordOkNow();
      st.busy = false; st.done = true; draw();
      haptic('order');   // korte trilling op de telefoon, als dat aan staat (zie js/21-pwa.js)
      const q = isNum(res.qty) && Math.abs(res.qty - st.qty) > 1e-9 ? ' Verstuurd aantal: ' + N4.format(res.qty) + ' stuks' +
        (res.rounded ? ' (Trading 212 stond voor dit instrument niet zoveel decimalen toe, dus naar beneden afgerond)' : res.basis === 'live' ? ', op basis van je positie van dit moment' : '') + '.' : '';
      say((demo ? 'Voorbeeld: ' : '') + 'Order verstuurd' + (res.order && res.order.status ? ' (status ' + res.order.status + ')' : '') + '.' + q + ' Je ziet hem op Analyse bij Openstaande orders; je posities werken bij met de volgende meting.', 'gain');
      tradeState.open = null;
      liveCache.clear();
      if (!demo) setTimeout(() => load(), 20000);
    } catch (err) {
      st.busy = false; st.id = newOrderId(); draw();
      haptic('fout');
      say('Niet verstuurd: ' + err.message, 'loss');
    }
  });
  dlg.addEventListener('input', (e) => {
    const el = near(e, '[data-t]');
    if (!el) return;
    const t = el.dataset.t;
    if (t === 'qty' || t === 'eur' || t === 'pct') { st.last = t; st.raw[t] = el.value; }
    else if (t === 'limit') { st.raw.limit = el.value; st.limit = numIn(el.value); }
    else if (t === 'big') st.big = el.value;   // tweede bevestiging bij een grote order
    else return;
    if (t !== 'big') st.sure = false;
    recalc();
    draw();   // het veld waarin je typt blijft staan, met cursor en komma
  });
  dlg.addEventListener('change', (e) => {
    const el = near(e, '[data-t]');
    if (!el) return;
    if (el.dataset.t === 'sure') { st.sure = el.checked; draw(); }
    if (el.dataset.t === 'choice') { I.t212 = el.value; draw(); }
  });
}
document.addEventListener('click', (e) => {
  const b = near(e, '[data-trade]');
  if (!b || !M) return;
  e.preventDefault(); e.stopPropagation();
  openTradeDialog(b);
}, true);

// ---------- Openstaande orders en je laatste orders (Analyse) ----------
async function loadOrders() {
  if (tradeState.loading) return;
  tradeState.loading = true;
  await new Promise((r) => setTimeout(r, 0)); // eerst de pagina afmaken die deze tegel tekent
  try {
    if (demo) tradeState.open = { open: [{ id: 2, ticker: 'ASML_NL_EQ', type: 'LIMIT', status: 'NEW', quantity: 0.1, filled: 0.04, limitPrice: 600, created: new Date(Date.now() - 2 * DAY).toISOString() }], log: [{ t: new Date().toISOString().slice(0, 16), ticker: 'MSFT_US_EQ', side: 'BUY', type: 'market', qty: 0.2, estEur: 74.5, ok: true, status: 'FILLED' }], limits: tradeLimitsNow(), today: 74.5 };
    else tradeState.open = await workerCall('/api/trade/orders', { method: 'GET' });
    tradeState.err = '';
  } catch (e) { tradeState.err = e.message; tradeState.open = { open: [], log: [], limits: tradeLimitsNow(), today: 0 }; }
  tradeState.loading = false;
  refresh('analyse');
}
function openOrdersTile() {
  if (!tradingOn() || sharedView) return '';
  const O = tradeState.open;
  if (!O) { loadOrders(); return '<section class="tile pad"><h3>Openstaande orders</h3><p class="muted">Bezig met laden…</p></section>'; }
  return '<section class="tile pad"><h3>Openstaande orders</h3>' + (tradeState.err ? '<p class="small loss">' + esc(tradeState.err) + '</p>' : '') +
    (O.open.length ? '<div class="tx-list">' + O.open.map((o) => '<div class="tx"><span class="tag ' + (o.quantity < 0 ? 'loss' : 'gain') + '">' + (o.quantity < 0 ? 'Verkoop' : 'Koop') + '</span><span class="tx-m"><b>' + esc(String(o.ticker).split('_')[0] + ' ' + N4.format(Math.abs(o.quantity || 0))) + '</b><span class="sub">' + esc(String(o.type || '').toLowerCase() + (o.limitPrice ? ' tot ' + N2.format(o.limitPrice) : '') + ' · ' + (o.status || '') +
      (isNum(o.filled) && o.filled ? ' · ' + N4.format(o.filled) + ' al uitgevoerd' : '') + (o.created && ymd(o.created) ? ' · ingelegd ' + fD.format(ymd(o.created)) : '')) + '</span></span>' +
      '<span class="tx-v"><button type="button" class="btn ghost danger" data-order-cancel="' + esc(o.id) + '">Annuleren</button></span></div>').join('') + '</div>' : '<p class="small muted">Geen openstaande orders.</p>') +
    '<p class="small" style="margin-top:8px">Vandaag ± ' + esc(eur(O.today || 0)) + ' van je grens van ' + esc(eur((O.limits || tradeLimitsNow()).perDay)) + '.</p>' +
    (O.log && O.log.length ? '<h3 style="margin-top:12px">Laatste orders via de app</h3><div class="tx-list">' + O.log.slice(0, 8).map((l) => l.cancel
      ? '<div class="tx"><span class="tag">Geannuleerd</span><span class="tx-m"><b>order ' + esc(l.cancel) + '</b><span class="sub">' + esc(String(l.t).replace('T', ' ')) + '</span></span></div>'
      : '<div class="tx"><span class="tag ' + (l.ok ? (l.side === 'SELL' ? 'loss' : 'gain') : '') + '">' + (l.ok ? (l.side === 'SELL' ? 'Verkoop' : 'Koop') : 'Mislukt') + '</span><span class="tx-m"><b>' + esc(String(l.ticker).split('_')[0] + ' ' + N4.format(l.qty)) + '</b><span class="sub">' + esc(String(l.t).replace('T', ' ') + ' · ' + l.type + (l.error ? ' · ' + l.error : l.status ? ' · ' + l.status : '')) + '</span></span><span class="tx-v">' + esc(eur(l.estEur)) + '</span></div>').join('') + '</div>' : '') +
    '<div class="exp" style="margin-top:8px"><button type="button" class="btn ghost" data-orders-reload>Vernieuwen</button></div></section>';
}
document.addEventListener('click', async (e) => {
  const r = near(e, '[data-orders-reload]');
  if (r) { tradeState.open = null; refresh('analyse'); return; }
  const c = near(e, '[data-order-cancel]');
  if (!c) return;
  if (!confirm('Order ' + c.dataset.orderCancel + ' annuleren?')) return;
  c.disabled = true;
  try { if (!demo) await workerCall('/api/trade/cancel', { method: 'POST', body: JSON.stringify({ id: c.dataset.orderCancel }) }); tradeState.open = null; refresh('analyse'); }
  catch (err) { c.disabled = false; tradeState.err = foutTekst('De order kon niet worden geannuleerd', err, 'Kijk in de Trading 212-app of de order er nog staat; mogelijk is hij al uitgevoerd.'); refresh('analyse'); }
});

// ---------- Grenzen bij Koppelingen ----------
function tradeLimitsRow() {
  const L = tradeLimitsNow();
  return '<div class="plan-inputs" style="margin-top:6px"><label>Grens per order<span class="eur-in">€<input type="number" min="1" step="10" data-tl="perOrder" value="' + L.perOrder + '"></span></label>' +
    '<label>Grens per dag<span class="eur-in">€<input type="number" min="1" step="10" data-tl="perDay" value="' + L.perDay + '"></span></label>' +
    '<button type="button" class="btn ghost" data-tl-save>Grenzen opslaan</button></div>';
}
document.addEventListener('click', async (e) => {
  const b = near(e, '[data-tl-save]');
  if (!b) return;
  const box = b.closest('.plan-inputs');
  const v = (k) => Number(/** @type {HTMLInputElement} */ (box.querySelector('[data-tl="' + k + '"]')).value);
  b.disabled = true;
  try { await saveSettings({ tradeLimits: { perOrder: v('perOrder'), perDay: v('perDay') } }); b.textContent = 'Opgeslagen'; }
  catch (err) { b.textContent = foutTekst('De order is niet geplaatst', err, 'Er is niets gekocht of verkocht. Controleer je saldo en of je sleutel orders mag plaatsen.'); }
  b.disabled = false;
});
