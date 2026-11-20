/* Investeringstracker – Plannen, deel 2: het deel dat altijd nodig is. De toestand van de extra onderdelen op
 * Plannen, hun vertalingen en begrippen, en de extra's voor "jouw jaar in beeld" (ook op Analyse, en het bijhouden
 * welke bedrijfspagina's je opent). De onderdelen zelf (twee plannen vergelijken, gebeurtenissen, herbalanceren,
 * box 3 per jaar, spaargeld, netto vermogen, potjes per doel …) staan in js/29-plannen-extra.js, dat pas laadt
 * als je Plannen opent.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Toestand van deze onderdelen (keuzes die niet worden opgeslagen) ----------
const plx = { cmpA: null, cmpB: null, cmpRa: 0.07, cmpRb: 0.07, taxYear: null, dcaSym: 'SP500', dcaAmt: 100, dcaYears: 3,
  fanKey: '', fanRes: null, fanBusy: false, say: {}, lastView: '' };

// Korte namen voor de tabbladen op de telefoon en de Engelse koppen
Object.assign(SEC_SHORT, { 'Plannen vergelijken': 'Vergelijken', 'Inkomen en belastinghulp': 'Inkomen', 'Vermogen buiten de tracker': 'Vermogen', 'Doelen en terugkijken': 'Doelen' });
const PLX_EN = {
  'Plannen vergelijken': 'Compare plans', 'Inkomen en belastinghulp': 'Income and tax help', 'Vermogen buiten de tracker': 'Wealth outside the tracker', 'Doelen en terugkijken': 'Goals and looking back',
  'Twee plannen naast elkaar': 'Two plans side by side', 'Gebeurtenissen in je tijdlijn': 'Life events on your timeline', 'Wat betekent 90% kans?': 'What does a 90% chance mean?',
  'Herbalanceren als afvinklijst': 'Rebalancing as a checklist', 'Dividendinkomen per maand': 'Dividend income per month', 'Box 3 per jaar': 'Box 3 per year',
  'Spaargeld en contant': 'Savings and cash', 'Netto vermogen door de tijd': 'Net worth over time', 'Potjes per doel': 'Buckets per goal',
  'Maandelijks inleggen vanaf een datum': 'Monthly investing from a date', 'Beste beslissing': 'Best decision', 'Meest bekeken aandeel': 'Most viewed stock', 'Drukste maand': 'Busiest month',
  'Plan A': 'Plan A', 'Plan B': 'Plan B', 'Verschil': 'Difference', 'Gebeurtenis': 'Event', 'Wanneer': 'When', 'Opname': 'Withdrawal', 'Inleg pauzeren': 'Pause deposits',
  'Rekening': 'Account', 'Soort': 'Type', 'Stand': 'Balance', 'Rente': 'Interest', 'Doel': 'Goal', 'Toegewezen': 'Assigned', 'Niet toegewezen': 'Unassigned',
  'Rendement op inleg': 'Yield on cost', 'Verwacht per jaar': 'Expected per year', 'Afvinken': 'Tick off', 'Opnieuw beginnen': 'Start again',
};
Object.assign(EN, PLX_EN);
// DICT is bij het laden al gemaakt; nieuwe koppen daar ook in zetten (Duits en Frans vallen terug op het Engels)
if (LANG !== 'nl') Object.assign(DICT, PLX_EN);
Object.assign(GLOSS, {
  yoc: ['Rendement op inleg (yield on cost)', 'Het dividend van een jaar gedeeld door wat je voor het aandeel betaalde, niet door de koers van nu. Stijgt de koers, dan blijft dit percentage gelijk; verhoogt het bedrijf het dividend, dan stijgt het.'],
  peildatum: ['Peildatum', 'De dag waarop de Belastingdienst naar je vermogen kijkt: 1 januari van het belastingjaar. Wat je daarna stort of opneemt, telt voor dat jaar niet mee in box 3.'],
  reeel: ['Na inflatie (reëel)', 'Bedragen omgerekend naar wat ze vandaag waard zouden zijn. € 10.000 over 20 jaar voelt bij 2% inflatie als ongeveer € 6.700 nu.'],
});

// ---------- 178. Extra's voor "jouw jaar in beeld" ----------
const LS_VIEWS = 'tracker.views';
function plxViewsAll() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(LS_VIEWS) || '{}'); } catch (e) { o = {}; }
  if (demo && data && data.demoViews && !Object.keys(o).length) return data.demoViews;
  return o;
}
// Hoe vaak je een bedrijfspagina opende, per jaar (alleen op dit apparaat)
function plxTrackView() {
  const h = String(location.hash || '');
  if (h === plx.lastView) return;
  plx.lastView = h;
  const m = /^#bedrijf\/(.+)$/.exec(h);
  if (!m) return;
  let tk = '';
  try { tk = decodeURIComponent(m[1]); } catch (e) { tk = m[1]; }
  if (!tk) return;
  const Y = String(new Date().getFullYear());
  let all = {};
  try { all = JSON.parse(localStorage.getItem(LS_VIEWS) || '{}'); } catch (e) { all = {}; }
  const y = all[Y] || {};
  y[tk] = (y[tk] || 0) + 1;
  all[Y] = y;
  try { localStorage.setItem(LS_VIEWS, JSON.stringify(all)); } catch (e) { /* niet erg */ }
}
window.addEventListener('hashchange', plxTrackView);
plxTrackView();

function plxWrapExtras(Y) {
  const a = new Date(Y, 0, 1).getTime(), b = new Date(Y + 1, 0, 1).getTime();
  // Beste beslissing: de verkoop met het hoogste gerealiseerde resultaat of de aankoop die sindsdien het meest opleverde
  let best = null;
  M.tx.sells.filter((x) => x.t >= a && x.t < b && isNum(x.realised) && x.realised !== 0).forEach((x) => {
    if (!best || x.realised > best.v) best = { v: x.realised, tk: x.tk, kind: 'verkoop', t: x.t, sub: 'verkocht op ' + fDM.format(x.t) };
  });
  M.tx.buys.filter((x) => x.t >= a && x.t < b && isNum(x.net) && x.net > 0).forEach((x) => {
    const T = typeof twrSeries === 'function' ? twrSeries(x.tk) : [];
    if (T.length < 2) return;
    const at = typeof priceOn === 'function' ? priceOn(T, x.t) : null;
    const now = T[T.length - 1];
    if (!at || !(at.v > 0)) return;
    const gain = x.net * (now.v / at.v - 1);
    if (!best || gain > best.v) best = { v: gain, tk: x.tk, kind: 'aankoop', t: x.t, sub: 'gekocht op ' + fDM.format(x.t) + ', sindsdien ' + spct1(now.v / at.v - 1) };
  });
  // Meest bekeken aandeel (alleen op dit apparaat)
  const views = plxViewsAll()[String(Y)] || {};
  const top = Object.keys(views).map((tk) => ({ tk, n: views[tk] })).sort((x, y) => y.n - x.n)[0] || null;
  // Drukste maand: de maand met de meeste aan- en verkopen
  const months = new Array(12).fill(0);
  M.tx.trades.filter((x) => x.t >= a && x.t < b).forEach((x) => { months[new Date(x.t).getMonth()]++; });
  const mx = Math.max(...months);
  const mi = months.indexOf(mx);
  const busiest = mx > 0 ? { t: new Date(Y, mi, 1).getTime(), n: mx } : null;
  return { Y, best, top, busiest };
}
// Drie kaarten die aan de bestaande tegel "Jouw jaar in beeld" worden toegevoegd (zie 16-analyse.js)
function plxWrapCards(Y) {
  const X = plxWrapExtras(Y);
  const card = (k, v, s, cls) => '<div class="wr-c"><span class="muted small">' + esc(k) + '</span><b class="' + (cls || '') + '">' + esc(v) + '</b>' + (s ? '<span class="small muted">' + esc(s) + '</span>' : '') + '</div>';
  return card('Beste beslissing', X.best ? X.best.tk + ' (' + X.best.kind + ')' : '–', X.best ? seur(X.best.v) + ' · ' + X.best.sub : 'nog geen aan- of verkopen in ' + Y, X.best ? tone(X.best.v) : '') +
    card('Meest bekeken aandeel', X.top ? X.top.tk : '–', X.top ? X.top.n + ' keer geopend op dit apparaat' : 'nog geen bedrijfspagina geopend') +
    card('Drukste maand', X.busiest ? fMonY.format(X.busiest.t) : '–', X.busiest ? X.busiest.n + (X.busiest.n === 1 ? ' order' : ' orders') : 'geen orders in ' + Y);
}
