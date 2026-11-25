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
