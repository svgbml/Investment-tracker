/* Investeringstracker – Bedrijven: indeling in groepen met subtotalen en een grafiekkolom,
 * aankopen per keer (lots), kostprijsmethode, dagboek per aandeel, eigen koersdoel en een koersalarm vanaf de rij.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Indeling: tegels, één lijst, of groepen per sector, land, munt of pie ----------
const POS_GROUPS = [['tiles', 'Tegels'], ['none', 'Lijst'], ['sector', 'Sector'], ['country', 'Land'], ['cur', 'Munt'], ['pie', 'Pie']];
const LS_POS_GROUP = 'tracker.posGroup';
const LS_POS_SHUT = 'tracker.posShut';
const LS_POS_BASIS = 'tracker.posBasis';
// Indeling en ingeklapte groepen zijn keuzes per apparaat: die blijven in localStorage
const posState = { d: 'tiles', m: 'sector', shut: new Set(), basis: 'avg' };
try {
  const o = JSON.parse(localStorage.getItem(LS_POS_GROUP) || '{}');
  if (POS_GROUPS.some((g) => g[0] === o.d)) posState.d = o.d;
  if (POS_GROUPS.some((g) => g[0] === o.m && g[0] !== 'tiles')) posState.m = o.m;
  const s = JSON.parse(localStorage.getItem(LS_POS_SHUT) || '[]');
  if (Array.isArray(s)) s.slice(0, 80).forEach((k) => posState.shut.add(String(k)));
  const b = localStorage.getItem(LS_POS_BASIS);
  if (b === 'fifo' || b === 'avg') posState.basis = b;
} catch (e) { /* dan de standaardindeling */ }

const posGroupBy = () => (mode === 'm' ? posState.m : posState.d);
function setPosGroup(k) {
  if (mode === 'm') posState.m = k === 'tiles' ? 'none' : k;
  else posState.d = k;
  try { localStorage.setItem(LS_POS_GROUP, JSON.stringify({ d: posState.d, m: posState.m })); } catch (e) { /* niet erg */ }
}
const posShutKey = (g) => posGroupBy() + '|' + g;
const posShut = (g) => posState.shut.has(posShutKey(g));
function togglePosShut(g) {
  const k = posShutKey(g);
  if (posState.shut.has(k)) posState.shut.delete(k); else posState.shut.add(k);
  try { localStorage.setItem(LS_POS_SHUT, JSON.stringify([...posState.shut].slice(-80))); } catch (e) { /* niet erg */ }
}

const POS_COUNTRY_NL = { US: 'Verenigde Staten', NL: 'Nederland', DE: 'Duitsland', FR: 'Frankrijk', GB: 'Verenigd Koninkrijk', IE: 'Ierland',
  CH: 'Zwitserland', BE: 'België', ES: 'Spanje', IT: 'Italië', SE: 'Zweden', DK: 'Denemarken', NO: 'Noorwegen', FI: 'Finland', AT: 'Oostenrijk',
  LU: 'Luxemburg', PT: 'Portugal', PL: 'Polen', JP: 'Japan', CN: 'China', HK: 'Hongkong', TW: 'Taiwan', KR: 'Zuid-Korea', IN: 'India',
  CA: 'Canada', AU: 'Australië', BR: 'Brazilië', MX: 'Mexico', IL: 'Israël', SG: 'Singapore', ZA: 'Zuid-Afrika' };
const posPies = () => ((ext2().pies && ext2().pies.list) || []);
function posPieOf(tk) {
  const hit = posPies().find((p) => (p.instruments || []).some((i) => i.tk === tk));
  return hit ? (hit.name || 'Pie') : 'Buiten een pie';
}
function posGroupOf(c) {
  const g = posGroupBy();
  if (g === 'sector') return listSectorOf(c);
  if (g === 'country') {
    const p = M.mk && M.mk.ok ? M.mk.profOf(c.tk) : null;
    const k = p && p.country;
    return k ? (POS_COUNTRY_NL[k] || k) : isFundC(c) ? 'Fondsen' : 'Onbekend';
  }
  if (g === 'cur') return c.cur ? (c.cur === 'GBX' ? 'Britse pence (GBX)' : c.cur) : 'Onbekend';
  if (g === 'pie') return posPieOf(c.tk);
  return '';
}
// Alleen indelingen aanbieden die iets te zeggen hebben
function posGroupOpts(phone) {
  const pies = posPies().length > 0;
  return POS_GROUPS.filter((g) => (g[0] !== 'pie' || pies) && (g[0] !== 'tiles' || !phone));
}
function posGroups(items) {
  const g = new Map();
  items.forEach((c) => { const k = posGroupOf(c) || 'Onbekend'; if (!g.has(k)) g.set(k, []); g.get(k).push(c); });
  return [...g.entries()].map(([k, cs]) => ({ k, cs, v: sum(cs.map((c) => c.value)), d: sum(cs.map((c) => c.change || 0)) }))
    .sort((a, b) => b.v - a.v);
}
const posGroupPct = (grp) => (grp.v - grp.d > 0 ? grp.d / (grp.v - grp.d) : null);
const posSpanLabel = () => (ui.listSpan === 'today' ? (M.dayWord === 'vandaag' ? 'Vandaag' : 'Laatste dag') : ui.listSpan === '1m' ? '30 dagen' : 'Alles');

// ---------- Telefoon: dezelfde indeling als chips, en groepen die in- en uitklappen ----------
function posChipsHtml() {
  const opts = posGroupOpts(true);
  const cur = posGroupBy();
  return '<span class="lbl">' + esc(T('Indeling')) + '</span>' + opts.map((o) =>
    '<button type="button" data-g="group" data-k="' + o[0] + '" aria-pressed="' + (o[0] === cur) + '">' + esc(T(o[1] === 'Lijst' ? 'Eén lijst' : o[1])) + '</button>').join('');
}
function posGroupHeadM(grp) {
  const shut = posShut(grp.k);
  const pct = posGroupPct(grp);
  return '<button type="button" class="m-tgroup pg-tog' + (shut ? ' shut' : '') + '" data-pgroup="' + esc(grp.k) + '" aria-expanded="' + (!shut) + '">' +
    '<span><svg class="pg-c" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg>' +
    esc(grp.k.toUpperCase() + ' · ' + (M.totalValue ? PCT0.format(grp.v / M.totalValue) : '–')) + '</span>' +
    '<span>' + esc(eur(grp.v)) + ' · <b class="' + tone(grp.d) + '">' + esc(isNum(pct) ? spct(pct) : '–') + '</b>' +
    (shut ? ' <span class="muted">' + grp.cs.length + '</span>' : '') + '</span></button>';
}

// ---------- Computer: lijst met rijen, grafiekkolom en subtotalen ----------
const BELL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/></svg>';
function posRow(c) {
  const pts = seriesFor(c.tk, '1m');
  const sp = ui.listSpan === 'today' ? c.changePct : spanPct(c, seriesFor(c.tk, ui.listSpan));
  const delta = pts.length > 1 ? pts[pts.length - 1].v - pts[0].v : (c.change || 0);
  const alarms = alertsOf(c.tk).filter((a) => a.on).length;
  return '<div class="prow" role="button" tabindex="0" data-ticker="' + esc(c.tk) + '" aria-label="' + esc(c.name + ', ' + eur(c.value) + ', ' + (isNum(sp) ? spct(sp) : '') + ', sinds aankoop ' + (isNum(c.resultPct) ? spct1(c.resultPct) : '–') + '. Openen') + '">' +
    '<span class="n"><span class="tk">' + esc(c.tk) + '</span><span class="nm">' + esc(c.name) + '</span></span>' +
    '<span class="sp">' + spark(pts, toneColor(delta), 'tspark') + '</span>' +
    '<span class="v">' + esc(eur(c.value)) + '</span>' +
    '<span class="p ' + tone(sp) + '">' + esc(isNum(sp) ? spct(sp) : '–') + '</span>' +
    '<span class="t ' + tone(c.resultPct) + '">' + esc(isNum(c.resultPct) ? spct1(c.resultPct) : '–') + '</span>' +
    '<span class="w">' + esc(isNum(c.weight) ? PCT0.format(c.weight) : '–') + '</span>' +
    '<span class="a"><button type="button" class="prow-bell' + (alarms ? ' on' : '') + '" data-alarm="' + esc(c.tk) + '" aria-label="' + esc('Koersalarm voor ' + c.tk + (alarms ? ' (' + alarms + ' aan)' : '')) + '" title="' + esc(T('Koersalarm')) + '">' + BELL_SVG + '</button></span></div>';
}
function posGroupHtmlD(grp) {
  const shut = posShut(grp.k);
  const pct = posGroupPct(grp);
  return '<div class="pgroup' + (shut ? ' shut' : '') + '">' +
    '<button type="button" class="pg-h" data-pgroup="' + esc(grp.k) + '" aria-expanded="' + (!shut) + '">' +
      '<span class="pg-l"><svg class="pg-c" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg>' +
      '<span class="pg-n">' + esc(grp.k) + '</span><span class="pg-k">' + grp.cs.length + '</span></span>' +
      '<span></span><span class="pg-v">' + esc(eur(grp.v)) + '</span>' +
      '<span class="pg-p ' + tone(grp.d) + '">' + esc(isNum(pct) ? spct(pct) : '–') + '</span>' +
      '<span></span><span class="pg-w">' + esc(M.totalValue ? PCT0.format(grp.v / M.totalValue) : '–') + '</span><span></span>' +
    '</button>' + (shut ? '' : grp.cs.map(posRow).join('')) + '</div>';
}
function posListHtml(items) {
  const head = '<div class="phead"><span class="n">' + esc(T('Bedrijf')) + '</span><span class="sp">' + esc(T('30 dagen')) + '</span>' +
    '<span class="v">' + esc(T('Waarde')) + '</span><span class="p">' + esc(posSpanLabel()) + '</span>' +
    '<span class="t">' + esc(T('Sinds aankoop')) + '</span><span class="w">' + esc(T('Deel')) + '</span><span class="a"></span></div>';
  if (posGroupBy() === 'none') return head + items.map(posRow).join('');
  return head + posGroups(items).map(posGroupHtmlD).join('');
}
function posSegButtons() {
  const host = $('list-group');
  if (!host) return;
  segButtons(host, posGroupOpts(false), posGroupBy(), (k) => { setPosGroup(k); refresh('list'); });
}
// De weergave 'list' opnieuw vastleggen: bij 'Tegels' de oude tegels, anders rijen met groepen
defineView('list', () => {
  if (mode === 'm') { renderMList(); return; }
  renderList();
  posSegButtons();
  const host = $('list-grid');
  if (!host) return;
  const rows = posGroupBy() !== 'tiles';
  host.classList.toggle('plist', rows);
  if (!rows) return;
  const items = filteredCompanies();
  host.innerHTML = items.length ? posListHtml(items)
    : '<p class="empty">Geen bedrijven gevonden' + (ui.listQuery ? ' voor “' + esc(ui.listQuery) + '”' : '') + '.</p>';
});

// Groep in- of uitklappen (computer en telefoon)
document.addEventListener('click', (e) => {
  const b = near(e, '[data-pgroup]');
  if (!b) return;
  togglePosShut(b.dataset.pgroup);
  refresh('list');
});
// Rijen zijn geen knoppen (er zit een knop in), dus Enter en spatie zelf afhandelen
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const r = near(e, '.prow[data-ticker]');
  if (!r) return;
  e.preventDefault();
  openDetail(r.dataset.ticker, r, true);
});

// ---------- Aankopen per keer (lots) en kostprijsmethode ----------
// Elke aankoop apart, met het resultaat sinds die aankoop. FIFO: verkopen halen de oudste aankopen eerst weg.
function lotsModel(c) {
  const list = (M.tx.byTk.get(c.tk) || []).filter((x) => !x.kind || x.kind === 'TRADE');
  const buys = list.filter((x) => x.side === 'BUY' && isNum(x.qty) && x.qty > 0);
  if (!buys.length) return null;
  const lots = buys.map((b) => ({ t: b.t, qty: b.qty, price: b.price, cur: b.cur, net: b.net || 0, left: b.qty }));
  let sold = 0;
  list.filter((x) => x.side === 'SELL' && isNum(x.qty) && x.qty > 0).forEach((s) => {
    sold += s.qty;
    let q = s.qty;
    for (const o of lots) {
      if (q <= 0) break;
      const take = Math.min(o.left, q);
      o.left -= take; q -= take;
    }
  });
  const totQty = sum(buys.map((b) => b.qty));
  const totNet = sum(lots.map((o) => o.net));
  const openQty = sum(lots.map((o) => o.left));
  const fifoCost = sum(lots.map((o) => (o.qty ? o.net * (o.left / o.qty) : 0)));
  return { lots, sold, totQty, totNet, openQty, fifoCost,
    avgEur: totQty ? totNet / totQty : null, fifoEur: openQty ? fifoCost / openQty : null };
}
function lotsTile(c) {
  const L = lotsModel(c);
  if (!L) return '';
  const nowEur = c.qty ? c.value / c.qty : null;
  const lotPct = (o) => (o.cur === c.cur && isNum(c.priceNative) && isNum(o.price) && o.price > 0 ? c.priceNative / o.price - 1
    : isNum(nowEur) && o.qty && o.net ? nowEur / (o.net / o.qty) - 1 : null);
  const rows = L.lots.slice().reverse().map((o) => {
    const pct = lotPct(o);
    const val = isNum(nowEur) ? o.left * nowEur : null;
    const part = o.left < o.qty - 1e-9;
    return '<div class="tx"><span class="tag' + (o.left <= 1e-9 ? '' : ' gain') + '">' + esc(fDM.format(o.t) + ' ’' + String(new Date(o.t).getFullYear()).slice(2)) + '</span>' +
      '<span class="tx-m"><b>' + esc(N4.format(o.qty) + ' × ' + money(o.price, o.cur)) + '</b>' +
      '<span class="sub">' + esc(eur(o.net) + ' inleg' + (part ? ', nog ' + N4.format(o.left) + ' van ' + N4.format(o.qty) + ' in bezit' : '')) + '</span></span>' +
      '<span class="tx-v">' + esc(isNum(val) ? eur(val) : '–') + '<span class="sub ' + tone(pct) + '">' + esc(isNum(pct) ? spct1(pct) : '–') + '</span></span></div>';
  }).join('');
  const fifoUnreal = isNum(c.value) ? c.value - L.fifoCost : null;
  const avgUnreal = isNum(c.value) && isNum(c.cost) ? c.value - c.cost : null;
  const pick = posState.basis;
  const seg = '<div class="seg light basis-seg" role="group" aria-label="' + esc(T('Kostprijsmethode')) + '">' +
    [['avg', 'Gemiddeld'], ['fifo', 'FIFO']].map(([k, l]) =>
      '<button type="button" data-basis="' + k + '" aria-pressed="' + (pick === k) + '">' + esc(T(l)) + '</button>').join('') + '</div>';
  return '<section class="tile pad lots-tile"><h3>Aankopen per keer</h3>' +
    '<div class="tx-list">' + rows + '</div>' +
    '<h3 style="margin-top:16px">' + esc(T('Kostprijsmethode')) + '</h3>' + seg +
    '<div style="margin-top:10px">' + kvList([
      ['Aantal nu', isNum(L.openQty) ? N4.format(L.openQty) + (L.sold ? ' (' + N4.format(L.sold) + ' verkocht)' : '') : '–'],
      ['Kostprijs per stuk', eur(pick === 'avg' ? L.avgEur : L.fifoEur)],
      ['Ingelegd in wat je nog hebt', eur(pick === 'avg' ? c.cost : L.fifoCost)],
      ['Ongerealiseerd resultaat', isNum(pick === 'avg' ? avgUnreal : fifoUnreal) ? seur(pick === 'avg' ? avgUnreal : fifoUnreal) : '–', tone(pick === 'avg' ? avgUnreal : fifoUnreal)],
      ['Verschil met de andere methode', isNum(avgUnreal) && isNum(fifoUnreal) ? seur((pick === 'avg' ? avgUnreal : fifoUnreal) - (pick === 'avg' ? fifoUnreal : avgUnreal)) : '–'],
    ]) + '</div>' +
    '<p class="sub" style="margin-top:8px">Trading 212 rekent met de gemiddelde kostprijs; FIFO (eerst gekocht, eerst verkocht) staat er alleen ter informatie bij en verandert niets aan je positie of je belasting. ' +
    'Het resultaat per aankoop is de koers nu tegenover de koers die je toen betaalde' + (c.cur && c.cur !== 'EUR' ? ', in ' + esc(c.cur) + ' (dus zonder het effect van de wisselkoers)' : '') + '.</p></section>';
}
document.addEventListener('click', (e) => {
  const b = near(e, '[data-basis]');
  if (!b) return;
  posState.basis = b.dataset.basis === 'fifo' ? 'fifo' : 'avg';
  try { localStorage.setItem(LS_POS_BASIS, posState.basis); } catch (err) { /* niet erg */ }
  if (ui.detail && hasView(ui.detail)) renderDetail(false);
});

// ---------- Eigen koersdoel (ook voor volgaandelen) ----------
const myTargets = () => (userPrefs().myTarget || {});
const myTargetOf = (sym) => { const v = myTargets()[sym]; return isNum(v) ? v : null; };
// Koers en munt van een aandeel: uit je positie, anders uit het profiel van de volglijst
function symPrice(sym) {
  const c = M && M.byTk.get(sym);
  if (c && isNum(c.priceNative)) return { price: c.priceNative, cur: c.cur || 'EUR' };
  if (c && isNum(c.value) && c.qty) return { price: c.value / c.qty, cur: 'EUR' };
  const p = M && M.mk && M.mk.ok ? M.mk.prof(sym) : null;
  return { price: p && isNum(p.price) ? p.price : null, cur: (p && p.currency) || 'USD' };
}
let mtSaved = null;   // laat na het opslaan kort zien dat het gelukt is (de tegel wordt opnieuw getekend)
function myTargetTile(sym) {
  const { price, cur } = symPrice(sym);
  const saved = mtSaved === sym;
  mtSaved = null;
  const t = myTargetOf(sym);
  const up = isNum(t) && isNum(price) && price > 0 ? t / price - 1 : null;
  return '<section class="tile pad my-target" data-mt="' + esc(sym) + '"><h3>' + esc(T('Mijn koersdoel')) + '</h3>' +
    '<div class="plan-inputs"><label>Koersdoel<span class="eur-in">' + esc(CUR_SYM[cur] || (cur ? cur + ' ' : '$')) +
      '<input type="number" min="0" step="0.01" data-mt-f="target" value="' + esc(isNum(t) ? t : '') + '" aria-label="Mijn koersdoel"></span></label></div>' +
    (isNum(up) ? '<p class="small ' + tone(up) + '">' + esc(money(t, cur) + ' is ' + spct1(up) + ' ten opzichte van de koers nu (' + money(price, cur) + ')') + '.</p>'
      : '<p class="muted small">Zet je eigen koersdoel; het staat dan naast het gemiddelde koersdoel van analisten.</p>') +
    '<div class="plan-actions"><button type="button" class="btn primary" data-mt-save>Bewaren</button>' +
    (isNum(t) ? '<button type="button" class="btn ghost" data-alarm="' + esc(sym) + '" data-alarm-price="' + esc(t) + '">' + esc(T('Alarm bij dit koersdoel')) + '</button>' : '') +
    '<span class="small plan-status' + (saved ? ' gain' : '') + '" role="status">' + (saved ? 'Bewaard.' : '') + '</span></div>' +
    '<p class="sub" style="margin-top:6px">Je eigen koersdoel is een aanname van jou, geen advies en geen voorspelling.</p></section>';
}
document.addEventListener('click', async (e) => {
  const b = near(e, '[data-mt-save]');
  if (!b) return;
  const box = /** @type {HTMLElement} */ (b.closest('[data-mt]'));
  const sym = box.dataset.mt, st = box.querySelector('.plan-status');
  const raw = /** @type {HTMLInputElement} */ (box.querySelector('[data-mt-f="target"]')).value.trim();
  const v = raw === '' ? null : Number(raw);
  if (v != null && !(v > 0)) { st.textContent = 'Vul een koers boven nul in, of laat het veld leeg.'; st.className = 'small plan-status loss'; return; }
  const next = Object.assign({}, myTargets());
  if (v == null) delete next[sym]; else next[sym] = Math.round(v * 10000) / 10000;
  b.disabled = true;
  try {
    await savePrefsSafe({ myTarget: next });
    mtSaved = sym;
    st.textContent = v == null ? 'Koersdoel gewist.' : 'Bewaard.';
    st.className = 'small plan-status gain';
    rerenderAll();   // tekent ook de bedrijfs- of volgpagina opnieuw, met het nieuwe koersdoel erin
  } catch (err) {
    st.textContent = 'Opslaan is mislukt: ' + err.message + '.';
    st.className = 'small plan-status loss';
    b.disabled = false;
  }
});

// ---------- Dagboek per aandeel: korte notities met een datum ----------
// prefs.posDiary = { TICKER: [[jjjj-mm-dd, tekst], …] }, kort gehouden zodat de voorkeuren klein blijven
const DIARY_MAX = 20;
const posDiaryAll = () => (userPrefs().posDiary || {});
const posDiaryOf = (tk) => (Array.isArray(posDiaryAll()[tk]) ? posDiaryAll()[tk].filter((x) => Array.isArray(x) && x[1]) : []);
const today10 = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// Voorkeuren opslaan met een grens: de Worker bewaart maximaal 40 kB
async function savePrefsSafe(patch) {
  const next = Object.assign({}, userPrefs(), patch);
  if (JSON.stringify(next).length > 38000) throw new Error('je voorkeuren zijn vol (40 kB); haal eerst oude notities weg');
  return savePrefs(patch);
}
function diaryTile(tk) {
  const list = posDiaryOf(tk);
  const rows = list.slice().sort((a, b) => String(b[0]).localeCompare(String(a[0]))).map(([d, txt]) =>
    '<div class="dg-i"><span class="dg-d">' + esc(ymd(d) ? fD.format(ymd(d)) + ' ' + String(d).slice(0, 4) : d) + '</span>' +
    '<span class="dg-t">' + esc(txt) + '</span>' +
    '<button type="button" class="linklike small danger" data-dg-del="1" data-dg-k="' + esc(String(d) + '|' + txt.slice(0, 20)) + '">Wissen</button></div>').join('');
  return '<section class="tile pad diary-tile" data-dg="' + esc(tk) + '"><h3>' + esc(T('Dagboek')) + '</h3>' +
    (list.length ? '<div class="dg-list">' + rows + '</div>' : '<p class="muted small">Schrijf op waarom je kocht, wat je denkt en wat je afwacht. Alleen jij ziet dit.</p>') +
    '<div class="dg-add"><label class="sr-only" for="dg-d-' + esc(tk) + '">Datum</label>' +
    '<input id="dg-d-' + esc(tk) + '" type="date" data-dg-f="date" value="' + esc(today10()) + '">' +
    '<label class="sr-only" for="dg-t-' + esc(tk) + '">Notitie</label>' +
    '<textarea id="dg-t-' + esc(tk) + '" data-dg-f="text" rows="2" maxlength="240" placeholder="Wat wil je over dit aandeel onthouden?"></textarea>' +
    '<div class="plan-actions"><button type="button" class="btn primary" data-dg-add>Toevoegen</button><span class="small plan-status" role="status"></span></div></div>' +
    '<p class="sub" style="margin-top:6px">Maximaal ' + DIARY_MAX + ' notities per aandeel, elk 240 tekens. Ze worden bij je instellingen in de Worker bewaard, niet bij Trading 212.</p></section>';
}
async function saveDiary(tk, list, st) {
  const all = Object.assign({}, posDiaryAll());
  if (!list.length) delete all[tk]; else all[tk] = list.slice(0, DIARY_MAX);
  try {
    await savePrefsSafe({ posDiary: all });
    if (st) { st.textContent = 'Bewaard.'; st.className = 'small plan-status gain'; }
    if (ui.detail && hasView(ui.detail)) renderDetail(false);
  } catch (err) {
    if (st) { st.textContent = 'Opslaan is mislukt: ' + err.message + '.'; st.className = 'small plan-status loss'; }
  }
}
document.addEventListener('click', async (e) => {
  const box = near(e, '[data-dg]');
  if (!box) return;
  const tk = box.dataset.dg, st = box.querySelector('.plan-status');
  const add = near(e, '[data-dg-add]');
  if (add) {
    const d = /** @type {HTMLInputElement} */ (box.querySelector('[data-dg-f="date"]')).value || today10();
    const el = /** @type {HTMLTextAreaElement} */ (box.querySelector('[data-dg-f="text"]'));
    const txt = el.value.trim().replace(/\s+/g, ' ').slice(0, 240);
    if (!txt) { st.textContent = 'Typ eerst een notitie.'; st.className = 'small plan-status loss'; return; }
    const list = posDiaryOf(tk).concat([[d.slice(0, 10), txt]]);
    if (list.length > DIARY_MAX) { st.textContent = 'Maximaal ' + DIARY_MAX + ' notities; wis er eerst een.'; st.className = 'small plan-status loss'; return; }
    el.value = '';
    await saveDiary(tk, list, st);
    return;
  }
  const del = near(e, '[data-dg-del]');
  if (del) {
    const key = del.dataset.dgK;
    await saveDiary(tk, posDiaryOf(tk).filter(([d, txt]) => String(d) + '|' + String(txt).slice(0, 20) !== key), st);
  }
});

// ---------- Koersalarm vanaf een rij: hetzelfde alarm, al ingevuld ----------
let alarmSym = null;
let alarmPre = null;
function alarmBody() {
  const sym = alarmSym;
  const { price, cur } = symPrice(sym);
  const list = alertsOf(sym);
  const t = myTargetOf(sym);
  const pre = isNum(alarmPre) ? alarmPre : isNum(t) ? t : isNum(price) ? Math.round(price * 0.95 * 100) / 100 : '';
  const op = isNum(pre) && isNum(price) && pre > price ? 'above' : 'below';
  const pf = (v) => (isNum(v) ? money(v, cur) : '–');
  return '<p class="muted small">' + esc((M && M.byTk.has(sym) ? 'Je positie ' : 'Volglijst ') + sym + (isNum(price) ? ', koers nu ' + pf(price) : ', nog geen koers')) + '.</p>' +
    (list.length ? '<div class="tx-list">' + list.map((a) => '<div class="tx"><span class="tag' + (a.on ? ' gain' : '') + '">' + (a.on ? 'Aan' : a.hit ? 'Afgegaan' : 'Uit') + '</span>' +
      '<span class="tx-m"><b>' + esc((a.op === 'below' ? 'Onder ' : 'Boven ') + pf(a.price)) + '</b><span class="sub">' + esc(a.hit ? 'afgegaan ' + fDT.format(new Date(a.hit)) : '') + '</span></span>' +
      '<span class="tx-v"><button type="button" class="linklike small" data-ad="toggle" data-id="' + esc(a.id) + '">' + (a.on ? 'Uitzetten' : 'Aanzetten') + '</button> ' +
      '<button type="button" class="linklike small danger" data-ad="del" data-id="' + esc(a.id) + '">Wissen</button></span></div>').join('') + '</div>'
      : '<p class="muted small">Nog geen alarm voor dit aandeel.</p>') +
    '<div class="palert-add"><label class="sr-only" for="ad-op">Richting</label><select id="ad-op" data-ad-f="op">' +
      '<option value="below"' + (op === 'below' ? ' selected' : '') + '>onder</option><option value="above"' + (op === 'above' ? ' selected' : '') + '>boven</option></select>' +
    '<span class="eur-in">' + esc(CUR_SYM[cur] || (cur ? cur + ' ' : '$')) + '<input type="number" inputmode="decimal" min="0" step="any" data-ad-f="price" value="' + esc(pre) + '" aria-label="Koers voor het alarm"></span>' +
    '<button type="button" class="btn primary" data-ad="add">Alarm toevoegen</button></div>' +
    '<p class="sub" style="margin-top:8px">Tijdens de meettijden kijkt je Worker elke tien minuten; na een melding gaat het alarm uit. De koers is in de munt van het aandeel.' +
      (pushOk() && Notification.permission !== 'granted' && !demo ? ' Zet meldingen aan bij Instellingen.' : '') + '</p>' +
    '<p class="small plan-status ad-st" role="status"></p>';
}
function renderAlarmDlg() {
  const body = $('alarm-body');
  if (!body || !alarmSym) return;
  const ttl = $('dlg-alarm-title');
  if (ttl) ttl.textContent = T('Koersalarm') + ' · ' + alarmSym;
  body.innerHTML = alarmBody();
}
function openAlarmDlg(sym, pre) {
  const dlg = /** @type {HTMLDialogElement|null} */ ($('dlg-alarm'));
  if (!dlg || !sym) return;
  alarmSym = sym;
  alarmPre = isNum(pre) ? pre : null;
  renderAlarmDlg();
  if (!dlg.open) dlg.showModal();
}
// In de opvangfase: een klik op de bel mag de rij er niet onder niet openen
document.addEventListener('click', (e) => {
  const b = near(e, '[data-alarm]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  const pre = Number(b.dataset.alarmPrice);
  openAlarmDlg(b.dataset.alarm, isFinite(pre) && pre > 0 ? pre : null);
}, true);
document.addEventListener('click', async (e) => {
  const dlg = /** @type {HTMLDialogElement|null} */ ($('dlg-alarm'));
  if (!dlg) return;
  if (near(e, '[data-alarm-close]')) { dlg.close(); return; }
  const b = near(e, '[data-ad]');
  if (!b || !dlg.contains(b)) return;
  const st = dlg.querySelector('.ad-st');
  const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'small plan-status ad-st ' + (cls || ''); } };
  const all = ((M.settings && M.settings.priceAlerts) || []).map((a) => Object.assign({}, a));
  let next = all;
  if (b.dataset.ad === 'add') {
    const price = Number(/** @type {HTMLInputElement} */ (dlg.querySelector('[data-ad-f="price"]')).value);
    if (!(price > 0)) { say('Vul een koers in.', 'loss'); return; }
    if (all.length >= 30) { say('Maximaal 30 alarmen.', 'loss'); return; }
    next = all.concat([{ id: Math.random().toString(36).slice(2, 10), sym: alarmSym,
      op: /** @type {HTMLSelectElement} */ (dlg.querySelector('[data-ad-f="op"]')).value === 'above' ? 'above' : 'below', price, on: true }]);
  } else if (b.dataset.ad === 'toggle') next = all.map((a) => (a.id === b.dataset.id ? Object.assign(a, { on: !a.on, hit: a.on ? a.hit : null }) : a));
  else if (b.dataset.ad === 'del') next = all.filter((a) => a.id !== b.dataset.id);
  b.disabled = true;
  try {
    await saveSettings({ priceAlerts: next });
    alarmPre = null;
    rerenderAll();
    renderAlarmDlg();
  } catch (err) {
    say('Opslaan is mislukt: ' + err.message + '.', 'loss');
    b.disabled = false;
  }
});
