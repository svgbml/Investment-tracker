/* Investeringstracker – Geschiedenismodel: per dag per aandeel de waarde, het gewicht, het aantal en de inleg.
 * Gewoon script (geen module), lui geladen via VIEW_SCRIPTS in js/10-navigatie.js: alleen Analyse (en straks de
 * tijdmachine) heeft het nodig. Bouwsteen voor de terugblikken in fase 3 van de roadmap (ideeën 10–23, 66).
 *
 * histModel() geeft { t, total, tk, v, q, i } of null (nog aan het rekenen):
 *   t      dagen (tijdstip van de dagregel), oplopend; alleen dagen met standen per positie
 *   total  de waarde van alle posities samen per dag (gelijk aan de totaalreeks)
 *   tk     de aandelen die ergens in de periode in bezit waren
 *   v[tk]  waarde in euro per dag (null = die dag niet in bezit)
 *   q[tk]  aantal stuks per dag uit de orders (null als er geen orders zijn)
 *   i[tk]  inleg per dag: netto gekocht min netto verkocht, opgeteld tot en met die dag
 * Het gewicht is v[tk][d] / total[d]; histWeight() rekent het uit.
 */
'use strict';

// Losse rekenfunctie (ook bruikbaar in een Web Worker via runOffThread): geen namen van buiten
function histCompute(inp) {
  const days = new Set();
  const pos = inp.pos || {};
  Object.keys(pos).forEach((tk) => pos[tk].forEach((p) => days.add(p[0])));
  const t = [...days].sort((a, b) => a - b);
  const at = new Map(t.map((x, k) => [x, k]));
  const tks = Object.keys(pos).filter((tk) => pos[tk].length).sort();
  const v = {}, q = {}, i = {};
  const total = t.map(() => 0);
  tks.forEach((tk) => {
    const row = t.map(() => null);
    pos[tk].forEach((p) => { const k = at.get(p[0]); if (k != null && typeof p[1] === 'number' && isFinite(p[1])) { row[k] = p[1]; total[k] += p[1]; } });
    v[tk] = row;
  });
  // Aantal en inleg uit de orders: alles tot het eind van die dag telt mee
  const ord = (inp.ord || []).slice().sort((a, b) => a[0] - b[0]);
  const hasOrd = ord.length > 0;
  const dayMs = inp.dayMs || 864e5;
  tks.forEach((tk) => { q[tk] = t.map(() => null); i[tk] = t.map(() => null); });
  const cumQ = {}, cumI = {};
  let o = 0;
  t.forEach((d, k) => {
    while (o < ord.length && ord[o][0] < d + dayMs) {
      const [, tk, side, qty, net] = ord[o];
      const s = side === 'SELL' ? -1 : 1;
      cumQ[tk] = (cumQ[tk] || 0) + s * (Number(qty) || 0);
      cumI[tk] = (cumI[tk] || 0) + s * (Number(net) || 0);
      o++;
    }
    if (!hasOrd) return;
    tks.forEach((tk) => {
      if (tk in cumQ) { q[tk][k] = Math.round(cumQ[tk] * 1e6) / 1e6; i[tk][k] = Math.round(cumI[tk] * 100) / 100; }
    });
  });
  return { t, total: total.map((x) => Math.round(x * 100) / 100), tk: tks, v, q, i };
}

const histState = { key: null, res: null, busy: null };
// Invoer uit het model: de dagstanden per positie (niet TOTAAL) en de transacties
function histInput() {
  const pos = {};
  M.days.forEach((a, tk) => { if (tk !== TOTAL && a.length) pos[tk] = a.map((x) => [x.t, x.close]); });
  const ord = ((M.tx && M.tx.trades) || []).map((x) => [x.t, x.tk, x.side, x.qty, x.net]);
  return { pos, ord, dayMs: DAY };
}
// Het model, onthouden tot er nieuwe dagen of orders bijkomen. Veel rekenwerk gaat naar een Web Worker; dan geeft
// histModel() eerst null en tekent hij Analyse opnieuw zodra het klaar is.
const HIST_SYNC_MAX = 60000;
function histModel() {
  if (!M || !M.days) return null;
  const tot = M.days.get(TOTAL) || [];
  let n = 0;
  M.days.forEach((a, tk) => { if (tk !== TOTAL) n += a.length; });
  const trades = (M.tx && M.tx.trades) || [];
  const key = n + ':' + (tot.length ? tot[tot.length - 1].t : 0) + ':' + trades.length + ':' + (trades.length ? trades[trades.length - 1].t : 0);
  if (histState.key === key && histState.res) return histState.res;
  if (n <= HIST_SYNC_MAX || typeof runOffThread !== 'function') {
    histState.key = key; histState.res = histCompute(histInput());
    return histState.res;
  }
  if (histState.busy !== key) {
    histState.busy = key;
    runOffThread(histCompute, histInput(), 'hist', key).then((res) => {
      histState.busy = null; histState.key = key; histState.res = res;
      if (M) refresh('analyse', 'plan');
    });
  }
  return null;
}
// Gewicht van een aandeel op dag k (0…1), of null
function histWeight(H, tk, k) {
  const v = H.v[tk] && H.v[tk][k];
  return v != null && H.total[k] > 0 ? v / H.total[k] : null;
}

// ---------- Concentratie door de tijd (idee 13) ----------
// Per maand (de laatste dag met standen) het gewicht van de vijf grootste posities en de HHI: de som van de
// kwadraten van alle gewichten. 1/HHI is het "effectieve aantal" posities. In Analyse, hoofdstuk Doorkijk.
function concMonths(H) {
  const out = [];
  H.t.forEach((t, k) => {
    if (!(H.total[k] > 0)) return;
    const ym = new Date(t).getFullYear() * 12 + new Date(t).getMonth();
    const ws = H.tk.map((tk) => histWeight(H, tk, k)).filter((w) => w != null && w > 0).sort((a, b) => b - a);
    const row = { t, top5: ws.slice(0, 5).reduce((a, w) => a + w, 0), hhi: ws.reduce((a, w) => a + w * w, 0), n: ws.length };
    if (out.length && out[out.length - 1].ym === ym) out[out.length - 1] = Object.assign(row, { ym }); else out.push(Object.assign(row, { ym }));
  });
  return out;
}
const fMonYr = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit' });
function concTimeTile() {
  const H = histModel();
  const head = '<section class="tile pad conc-time"><h3>' + esc(T('Concentratie door de tijd')) + '</h3>';
  if (!H) return head + '<p class="sub">Bezig met uitrekenen…</p></section>';
  const C2 = concMonths(H);
  if (C2.length < 2) return head + '<p class="sub">Zodra je posities twee maanden meet, staat hier hoe geconcentreerd je beleggingen per maand waren.</p></section>';
  const now = C2[C2.length - 1], ago = C2.find((x) => x.t >= now.t - 365 * DAY) || C2[0];
  return head + '<p class="sub">De vijf grootste posities waren ' + esc(PCT0.format(now.top5)) + ' van je beleggingen' +
    (ago !== now ? ' (in ' + esc(fMonLong.format(ago.t) + ' ' + new Date(ago.t).getFullYear()) + ' ' + esc(PCT0.format(ago.top5)) + ')' : '') + '.</p>' +
    '<div class="chart" data-chart="conc-time" style="height:200px"></div><div class="xlabels" data-x="conc-time"></div>' +
    '<p class="sub">Doorgetrokken: de vijf grootste posities samen. Gestippeld: de HHI.</p>' +
    '<div style="margin-top:10px">' + rawKv([
      ['Vijf grootste posities', PCT0.format(now.top5)],
      [trm('HHI', 'hhi'), N2.format(now.hhi)],
      ['Effectief aantal posities', now.hhi > 0 ? N1.format(1 / now.hhi) + ' van ' + now.n : '–'],
    ]) + '</div>' +
    '<p class="sub" style="margin-top:8px">Een hoge HHI betekent dat een paar posities de dienst uitmaken. Dit is een terugblik, geen advies over spreiding.</p></section>';
}
function drawConcTime(root) {
  const host = root.querySelector('[data-chart="conc-time"]');
  const H = host ? histModel() : null;
  if (!host || !H) return;
  const C2 = concMonths(H);
  lineChart(host, [
    { pts: C2.map((x) => ({ t: x.t, v: x.top5 })), color: C.accent, width: 3, label: 'Vijf grootste', fmt: (v) => PCT0.format(v) },
    { pts: C2.map((x) => ({ t: x.t, v: x.hhi })), color: C.ink2, dash: true, width: 2, label: 'HHI', fmt: (v) => N2.format(v) },
  ], { top: 0.22, bottom: 0.08, zoom: false, xl: root.querySelector('[data-x="conc-time"]'), xcount: 3, xfmt: (t) => fMonYr.format(t), tfmt: (t) => fMonLong.format(t) + ' ' + new Date(t).getFullYear() });
}

// ---------- Houdduur en omloop (idee 14) ----------
// Uit de orders, met FIFO-loten per aandeel: hoe lang verkochte stukken in bezit waren en hoe oud wat je nu hebt is
// (beide gewogen naar het ingelegde bedrag), de omzet over de laatste twaalf maanden (het kleinste van gekocht en
// verkocht, gedeeld door de gemiddelde waarde) en de kosten die daarbij hoorden.
function holdModel() {
  const trades = (M.tx && M.tx.trades) || [];
  if (!trades.length) return null;
  const lots = new Map();
  let soldW = 0, soldWD = 0;
  trades.forEach((x) => {
    if (!isNum(x.qty) || !(x.qty > 0)) return;
    if (!lots.has(x.tk)) lots.set(x.tk, []);
    const L = lots.get(x.tk);
    if (x.side === 'BUY') { L.push({ t: x.t, q: x.qty, per: (isNum(x.net) ? x.net : 0) / x.qty }); return; }
    let q = x.qty;
    while (q > 1e-9 && L.length) {
      const o = L[0], take = Math.min(o.q, q), w = take * o.per;
      soldW += w; soldWD += w * (x.t - o.t) / DAY;
      o.q -= take; q -= take;
      if (o.q <= 1e-9) L.shift();
    }
  });
  const end = M.lastT || Date.now();
  let openW = 0, openWD = 0;
  lots.forEach((L, tk) => { if (!M.byTk.has(tk)) return; L.forEach((o) => { const w = o.q * o.per; openW += w; openWD += w * (end - o.t) / DAY; }); });
  const from = end - 365 * DAY;
  const yr = trades.filter((x) => x.t >= from);
  const bought = sum(yr.filter((x) => x.side === 'BUY').map((x) => x.net || 0));
  const sold = sum(yr.filter((x) => x.side === 'SELL').map((x) => x.net || 0));
  const fees = sum(((M.tx && M.tx.list) || []).filter((x) => x.t >= from).map((x) => (x.feeFx || 0) + (x.feeOther || 0)));
  const vals = seriesOf(TOTAL).daily.filter((d) => d.t >= from && isNum(d.close)).map((d) => d.close);
  const avg = vals.length ? sum(vals) / vals.length : null;
  return { soldDays: soldW > 0 ? soldWD / soldW : null, openDays: openW > 0 ? openWD / openW : null, soldW, bought, sold, fees,
    turnover: isNum(avg) && avg > 0 ? Math.min(bought, sold) / avg : null, avg, months: Math.min(12, Math.max(1, Math.round((end - Math.max(from, trades[0].t)) / (30.44 * DAY)))) };
}
const daysText = (d) => (d >= 730 ? N1.format(d / 365) + ' jaar' : d >= 60 ? NI.format(d / 30.44) + ' maanden' : NI.format(d) + (Math.round(d) === 1 ? ' dag' : ' dagen'));
function holdTile() {
  const H = holdModel();
  const head = '<section class="tile pad hold-tile"><h3>' + esc(T('Houdduur en omloop')) + '</h3>';
  if (!H) return head + '<p class="sub">Zodra je orders zijn opgehaald (of je de CSV-export hebt ingelezen), staat hier hoe lang je aandelen gemiddeld houdt en hoeveel je wisselt.</p></section>';
  return head + rawKv([
    ['Verkochte stukken gemiddeld in bezit', isNum(H.soldDays) ? daysText(H.soldDays) : 'je hebt nog niets verkocht'],
    ['Wat je nu hebt, gemiddeld gekocht', isNum(H.openDays) ? daysText(H.openDays) + ' geleden' : '–'],
    [trm('Omloop', 'omloop') + ' (laatste ' + H.months + (H.months === 1 ? ' maand' : ' maanden') + ')', isNum(H.turnover) ? PCT0.format(H.turnover) + ' van de gemiddelde waarde' : '–'],
    ['Gekocht en verkocht in die periode', eur(H.bought) + ' en ' + eur(H.sold)],
    ['Kosten in die periode', eur(H.fees) + (H.fees > 0 && H.bought + H.sold > 0 ? ' (' + P2.format(H.fees / (H.bought + H.sold)) + ' van wat je wisselde)' : '')],
  ]) + '<p class="sub" style="margin-top:8px">Gewogen naar het ingelegde bedrag; verkopen halen de oudste aankopen eerst weg (FIFO). Een terugblik op je eigen gedrag, geen oordeel.</p></section>';
}

// ---------- Verdeling door de tijd (idee 12) ----------
// Per maand (de laatste dag met standen) je beleggingen naar sector, land of munt, als balk van 100%. Een aandeel
// zonder profiel valt onder "Onbekend", zodat elke balk optelt tot 100%. Met een tabel en een zin voor wie de
// balken niet ziet. In Analyse, hoofdstuk Doorkijk. De keuze sector, land of munt geldt per apparaat.
const DIST_BY = [['sector', 'Sector'], ['country', 'Land'], ['cur', 'Munt']];
const LS_DIST_BY = 'tracker.distBy';
let distBy = (() => { try { const k = localStorage.getItem(LS_DIST_BY); return DIST_BY.some((x) => x[0] === k) ? k : 'sector'; } catch (e) { return 'sector'; } })();
function distKeyOf(tk, by) {
  const tx = (M.tx && M.tx.byTk.get(tk)) || [];
  const c = M.byTk.get(tk) || { tk, name: (tx[0] && tx[0].name) || tk };
  if (by === 'sector') return listSectorOf(c);
  const p = M.mk && M.mk.ok ? M.mk.profOf(tk) : null;
  if (by === 'country') { const k = p && p.country; return k ? (POS_COUNTRY_NL[k] || k) : isFundC(c) ? 'Fondsen' : 'Onbekend'; }
  const cur = c.cur || (p && p.currency);
  return cur || 'Onbekend';
}
function distMonths(H, by) {
  const key = new Map(H.tk.map((tk) => [tk, distKeyOf(tk, by)]));
  const rows = [];
  H.t.forEach((t, k) => {
    if (!(H.total[k] > 0)) return;
    const ym = new Date(t).getFullYear() * 12 + new Date(t).getMonth();
    const g = {};
    H.tk.forEach((tk) => { const w = histWeight(H, tk, k); if (w) g[key.get(tk)] = (g[key.get(tk)] || 0) + w; });
    const row = { t, ym, g };
    if (rows.length && rows[rows.length - 1].ym === ym) rows[rows.length - 1] = row; else rows.push(row);
  });
  const last = rows.length ? rows[rows.length - 1].g : {};
  // Volgorde en kleur naar het gewicht nu; meer dan acht groepen: de rest als "Overig"
  const all = new Set();
  rows.forEach((r) => Object.keys(r.g).forEach((x) => all.add(x)));
  const order = [...all].sort((a, b) => Number(a === 'Onbekend') - Number(b === 'Onbekend') || (last[b] || 0) - (last[a] || 0));
  const groups = order.slice(0, 8).concat(order.length > 8 ? ['Overig'] : []);
  if (order.length > 8) rows.forEach((r) => { r.g.Overig = order.slice(8).reduce((a, x) => a + (r.g[x] || 0), 0); });
  return { rows: rows.slice(-24), groups };
}
function distTile() {
  const H = histModel();
  const head = '<section class="tile pad dist-time"><h3>' + esc(T('Verdeling door de tijd')) + '</h3>' +
    '<div class="seg light" role="group" aria-label="' + esc(T('Verdeling naar')) + '">' + DIST_BY.map(([k, l]) =>
      '<button type="button" data-dist-by="' + k + '" aria-pressed="' + (k === distBy) + '">' + esc(T(l)) + '</button>').join('') + '</div>';
  if (!H) return head + '<p class="sub">Bezig met uitrekenen…</p></section>';
  const D = distMonths(H, distBy);
  if (D.rows.length < 2) return head + '<p class="sub" style="margin-top:10px">Zodra je posities twee maanden meet, staat hier per maand hoe je beleggingen verdeeld waren.</p></section>';
  const col = (gname, i) => (gname === 'Onbekend' || gname === 'Overig' ? '#C9CED6' : SECTOR_COLORS[i % SECTOR_COLORS.length]);
  const mon = (t) => fMonLong.format(t) + ' ' + new Date(t).getFullYear();
  const top = (r) => D.groups.filter((gname) => r.g[gname] > 0).sort((a, b) => r.g[b] - r.g[a]).slice(0, 3).map((gname) => gname + ' ' + PCT0.format(r.g[gname])).join(', ');
  const first = D.rows[0], now = D.rows[D.rows.length - 1];
  const bars = D.rows.map((r) => '<div class="dist-row"><span class="dist-m">' + esc(fMonYr.format(r.t)) + '</span><span class="dist-bar" role="img" aria-label="' + esc(mon(r.t) + ': ' + top(r)) + '">' +
    D.groups.map((gname, i) => (r.g[gname] > 0.0005 ? '<i style="width:' + (r.g[gname] * 100).toFixed(2) + '%;background:' + col(gname, i) + '" title="' + esc(gname + ' ' + P1.format(r.g[gname])) + '"></i>' : '')).join('') + '</span></div>').join('');
  const legend = '<div class="dist-leg">' + D.groups.map((gname, i) => '<span><i style="background:' + col(gname, i) + '"></i>' + esc(gname) + '</span>').join('') + '</div>';
  const table = '<details class="dist-tbl"><summary>' + esc(T('Tabel')) + '</summary><div class="tbl-wrap"><table><thead><tr><th>Maand</th>' + D.groups.map((gname) => '<th class="num">' + esc(gname) + '</th>').join('') + '</tr></thead><tbody>' +
    D.rows.map((r) => '<tr><td>' + esc(mon(r.t)) + '</td>' + D.groups.map((gname) => '<td class="num">' + esc(r.g[gname] ? P1.format(r.g[gname]) : '–') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></details>';
  return head + '<p class="sub" style="margin-top:10px">' + esc('Nu: ' + top(now) + '. In ' + mon(first.t) + ': ' + top(first) + '.') + '</p>' + bars + legend + table +
    '<p class="sub" style="margin-top:8px">Sector en land komen uit de bedrijfsprofielen; zonder profiel telt een aandeel als onbekend. Een terugblik, geen advies.</p></section>';
}
document.addEventListener('click', (e) => {
  const b = near(e, '[data-dist-by]');
  if (!b) return;
  distBy = DIST_BY.some((x) => x[0] === b.dataset.distBy) ? b.dataset.distBy : 'sector';
  try { localStorage.setItem(LS_DIST_BY, distBy); } catch (err) { /* niet erg */ }
  refresh('analyse');
});
