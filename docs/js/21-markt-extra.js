/* Investeringstracker – Markt extra: warmtekaart van je bezit en volglijst, filter op de economische agenda
 * en sectorrotatie over 1, 3 en 6 maanden
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- 49. Warmtekaart: tegels zo groot als hun gewicht, gekleurd naar de beweging ----------
const hmState = { what: 'pos', span: 'day' };

// Tegels: je posities (grootte = gewicht) of je volglijst (even groot, want daar heb je geen gewicht)
function heatItems() {
  if (hmState.what === 'watch') {
    return watchSyms().map((sym) => {
      const p = M.mk.ok ? M.mk.prof(sym) : null;
      return { key: '~' + sym, label: sym, name: (p && p.name) || sym, size: 1, pct: p && isNum(p.change) ? p.change / 100 : null, extra: p && isNum(p.price) ? money(p.price, p.currency || 'USD') : '' };
    }).filter((x) => x.size > 0);
  }
  return M.companies.filter((c) => isNum(c.value) && c.value > 0).map((c) => ({
    key: c.tk, label: c.tk, name: c.name, size: c.value,
    pct: hmState.span === 'buy' ? c.resultPct : c.changePct,
    extra: eur(c.value) + (isNum(c.weight) ? ' · ' + P1.format(c.weight) : ''),
  }));
}

// Vlakverdeling (squarified treemap): elke waarde krijgt een vlak zo groot als zijn deel, zo vierkant mogelijk
function treeRects(vals, w, h) {
  const out = [];
  const total = sum(vals.filter(isNum));
  if (!(total > 0)) return out;
  const items = vals.map((v, i) => ({ i, a: (isNum(v) && v > 0 ? v : 0) * (w * h) / total })).filter((o) => o.a > 0);
  let rx = 0, ry = 0, rw = w, rh = h;
  while (items.length) {
    const horiz = rw >= rh;          // een rij langs de kortste kant: dat geeft de vierkantste vlakken
    const side = horiz ? rh : rw;
    const row = [];
    let best = Infinity;
    while (items.length) {
      const cand = row.concat([items[0]]);
      const len = sum(cand.map((o) => o.a)) / side;
      const worst = Math.max(...cand.map((o) => { const s = o.a / len; return Math.max(len / s, s / len); }));
      if (row.length && worst > best) break;
      best = worst;
      row.push(items.shift());
    }
    const len = sum(row.map((o) => o.a)) / side;
    let off = horiz ? ry : rx;
    row.forEach((o) => {
      const s = o.a / len;
      out[o.i] = horiz ? { x: rx, y: off, w: len, h: s } : { x: off, y: ry, w: s, h: len };
      off += s;
    });
    if (horiz) { rx += len; rw -= len; } else { ry += len; rh -= len; }
  }
  return out;
}

// Kleur in zeven stappen; dezelfde klassen als de kalender (heat-g1 … heat-l3), dus ook goed in kleurblindmodus
const HM_STEPS = { day: [0.0025, 0.01, 0.025], buy: [0.02, 0.08, 0.2] };
const hmCls = (p, span) => {
  if (!isNum(p)) return 'hm-na';
  const s = HM_STEPS[span] || HM_STEPS.day;
  const a = Math.abs(p);
  const k = a < s[0] ? 0 : a < s[1] ? 1 : a < s[2] ? 2 : 3;
  return k === 0 ? 'hm-0' : (p > 0 ? 'heat-g' : 'heat-l') + k;
};

function heatmapTile() {
  const items = heatItems();
  const W = 16, H = 9;
  const rects = treeRects(items.map((x) => x.size), W, H);
  const spanWord = hmState.span === 'buy' ? 'sinds aankoop' : 'vandaag';
  const segWhat = tpl`<div class="seg light" role="group" aria-label="Wat je wilt zien">${[['pos', 'Mijn posities'], ['watch', 'Volglijst']].map(([k, l]) =>
    tpl`<button type="button" data-hm-what="${k}" aria-pressed="${String(k === hmState.what)}">${l}</button>`)}</div>`;
  const segSpan = tpl`<div class="seg light" role="group" aria-label="Periode" style="margin-top:8px">${[['day', 'Vandaag'], ['buy', 'Sinds aankoop']].map(([k, l]) =>
    tpl`<button type="button" data-hm-span="${k}" aria-pressed="${String(k === hmState.span)}">${l}</button>`)}</div>`;
  const cells = items.map((x, i) => {
    const r = rects[i];
    if (!r) return '';
    const small = r.w / W < 0.085 || r.h / H < 0.11;
    const lab = x.label + (isNum(x.pct) ? ' ' + spct1(x.pct) : '');
    return tpl`<button type="button" class="hm-c ${raw(hmCls(x.pct, hmState.what === 'watch' ? 'day' : hmState.span))}${raw(small ? ' hm-s' : '')}" data-ticker="${x.key}"
      style="left:${raw((r.x / W * 100).toFixed(3))}%;top:${raw((r.y / H * 100).toFixed(3))}%;width:${raw((r.w / W * 100).toFixed(3))}%;height:${raw((r.h / H * 100).toFixed(3))}%"
      aria-label="${x.name + ': ' + (isNum(x.pct) ? spct1(x.pct) + ' ' + spanWord : 'geen beweging bekend') + (x.extra ? ', ' + x.extra : '')}"
      data-tip="${x.name + (x.extra ? ' · ' + x.extra : '') + (isNum(x.pct) ? ' · ' + spct1(x.pct) + ' ' + spanWord : '')}"><b>${x.label}</b><i>${isNum(x.pct) ? spct1(x.pct) : '–'}</i></button>`;
  });
  const legend = raw('<div class="heat-key" aria-hidden="true">daalt <i class="heat-l3"></i><i class="heat-l2"></i><i class="heat-l1"></i><i class="hm-0"></i><i class="heat-g1"></i><i class="heat-g2"></i><i class="heat-g3"></i> stijgt</div>');
  return String(tpl`<section class="tile pad full heatmap-tile"><div class="plan-head"><h3>Warmtekaart</h3></div>
    ${segWhat}
    ${hmState.what === 'pos' ? segSpan : ''}
    ${items.length ? tpl`<div class="heatmap" role="group" aria-label="${'Warmtekaart, ' + spanWord}">${cells}</div>${legend}` :
    tpl`<p class="muted">${hmState.what === 'watch' ? 'Je volglijst is leeg. Voeg aandelen toe bij Bedrijven, Volglijst.' : 'Nog geen posities om te tonen.'}</p>`}
    <p class="sub" style="margin-top:8px">${hmState.what === 'watch'
    ? 'Elk aandeel op je volglijst even groot, gekleurd naar de dagverandering uit het bedrijfsprofiel (FMP of Finnhub). Tik op een tegel voor de pagina van het aandeel.'
    : 'Vlakgrootte is het gewicht in je beleggingen, de kleur is ' + (hmState.span === 'buy' ? 'het resultaat sinds aankoop' : 'de verandering van ' + M.dayWord) + '. Tik op een tegel voor de pagina van het aandeel.'}</p></section>`);
}
document.addEventListener('click', (e) => {
  const t = near(e, '[data-hm-what], [data-hm-span]');
  if (!t) return;
  if (t.dataset.hmWhat) { hmState.what = t.dataset.hmWhat; if (hmState.what === 'watch') hmState.span = 'day'; }
  else hmState.span = t.dataset.hmSpan;
  markFresh();
  refresh('analyse');
});

// ---------- 50. Economische agenda: alleen wat jouw munten of landen raakt ----------
// Deel van je beleggingen per munt (de munt waarin het aandeel noteert)
function curShares() {
  const tot = M.totalValue || 0;
  const m = new Map();
  if (!tot) return m;
  M.companies.forEach((c) => {
    const cur = c.cur || (M.mk.ok && M.mk.profOf(c.tk) && M.mk.profOf(c.tk).currency) || null;
    const k = cur === 'GBX' ? 'GBP' : cur;
    if (!k) return;
    m.set(k, (m.get(k) || 0) + c.value / tot);
  });
  return m;
}
// Deel van je beleggingen in bedrijven uit één land (uit het bedrijfsprofiel)
function countryShare(code) {
  const tot = M.totalValue || 0;
  if (!tot || !M.mk.ok) return 0;
  return sum(M.companies.map((c) => { const p = M.mk.profOf(c.tk); return p && p.country === code ? c.value / tot : 0; }));
}
// Welk deel van je beleggingen een gebeurtenis raakt: de munt, en voor Amerikaanse cijfers ook het land
function econImpact(o) {
  const C2 = curShares();
  if (o.who === 'ECB') return { share: C2.get('EUR') || 0, what: 'euro' };
  const usd = C2.get('USD') || 0;
  return { share: Math.max(usd, countryShare('US')), what: 'dollar en Amerikaanse aandelen' };
}
const econMineOn = () => !!userPrefs().econMine;
const ECON_MIN = 0.1;   // onder dit deel van je beleggingen valt een gebeurtenis buiten het filter
// Regel onder een gebeurtenis: welk deel van je beleggingen eraan hangt
function econShareText(o) {
  const I = econImpact(o);
  if (!(M.totalValue > 0)) return '';
  return I.share >= 0.005 ? 'raakt ± ' + P1.format(I.share) + ' van je beleggingen (' + I.what + ')' : 'je hebt bijna niets in ' + I.what;
}
document.addEventListener('change', async (e) => {
  const el = near(e, '[data-econ-mine]');
  if (!el) return;
  const want = /** @type {HTMLInputElement} */ (el).checked;
  try { await savePrefs({ econMine: want }); refresh('analyse'); }
  catch (err) { /** @type {HTMLInputElement} */ (el).checked = !want; }
});

// ---------- 51. Sectorrotatie: wie liep voorop over 1, 3 en 6 maanden ----------
// [handelsdagen voor de sectorreeks, kalenderdagen voor de koersen, naam]
const ROT_W = [[21, 31, '1 maand'], [63, 92, '3 maanden'], [126, 183, '6 maanden']];
const rotState = { sort: 1 };   // 0, 1 of 2: sorteren op 1, 3 of 6 maanden

// Rendement uit de dagveranderingen per sector (FMP, gemiddelde van de beurzen)
function sectorPerfRet(name, nDays) {
  if (!M.mk.ok || !M.mk.perf) return null;
  const vals = [...M.mk.perf('sector', name).entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map((x) => x[1]);
  if (vals.length < nDays) return null;
  let v = 1;
  vals.slice(-nDays).forEach((r) => { if (isNum(r) && Math.abs(r) < 0.25) v *= 1 + r; });
  return v - 1;
}
// Terugval: gelijk gewogen gemiddelde van de bedrijven die de Worker in deze sector kent, in hun eigen munt
function sectorPriceRet(name, calDays) {
  if (!M.mk.ok) return null;
  const profs = (data.market && data.market.profiles) || {};
  const rs = [];
  Object.keys(profs).forEach((sym) => {
    if (profs[sym].sector !== name) return;
    const pts = M.mk.prices(sym);
    if (pts.length < 5) return;
    const last = pts[pts.length - 1];
    const base = pts.filter((p) => p.t <= last.t - calDays * DAY).pop();
    if (base && base.v > 0 && isNum(last.v)) rs.push(last.v / base.v - 1);
  });
  return rs.length >= 3 ? mean(rs) : null;
}
function sectorRotRows() {
  if (!M.mk.ok) return [];
  const names = M.mk.sectorNames && M.mk.sectorNames.length ? M.mk.sectorNames
    : [...new Set(Object.values((data.market && data.market.profiles) || {}).map((p) => p.sector).filter(Boolean))];
  const tot = M.totalValue || 0;
  const mine = new Map();
  M.companies.forEach((c) => { const s = M.mk.sectorOf(c); if (tot) mine.set(s, (mine.get(s) || 0) + c.value / tot); });
  return names.map((name) => ({
    name,
    cells: ROT_W.map(([nd, cal]) => {
      const p = sectorPerfRet(name, nd);
      if (isNum(p)) return { v: p, own: false };
      const q = sectorPriceRet(name, cal);
      return { v: isNum(q) ? q : null, own: isNum(q) };
    }),
    w: mine.get(name) || 0,
  })).filter((r) => r.cells.some((c) => isNum(c.v)));
}
function sectorRotTile() {
  const rows = sectorRotRows();
  if (!rows.length) {
    return String(tpl`<section class="tile pad full"><h3>Sectorrotatie</h3><p class="muted">Hiervoor zijn sectorcijfers of koershistorie nodig. Die komen van FMP; de Worker haalt ze elke dag op en bouwt de reeks op.</p></section>`);
  }
  const k = rotState.sort;
  const val = (r, i) => (isNum(r.cells[i].v) ? r.cells[i].v : -Infinity);
  const sorted = rows.slice().sort((a, b) => val(b, k) - val(a, k));
  const ranked = sorted.filter((r) => isNum(r.cells[k].v));
  const lead = ranked.slice(0, 2).map((r) => sectorNl(r.name));
  const lag = ranked.slice(-2).map((r) => sectorNl(r.name));
  const anyOwn = rows.some((r) => r.cells.some((c) => c.own));
  const mx = Math.max(0.01, ...ranked.map((r) => Math.abs(r.cells[k].v)));
  const cell = (c) => tpl`<td class="num ${raw(tone(c.v))}">${isNum(c.v) ? spct1(c.v) : '–'}${c.own ? raw('<span class="rot-own" aria-hidden="true">*</span>') : ''}</td>`;
  return String(tpl`<section class="tile pad full sector-rot"><div class="plan-head"><h3>Sectorrotatie</h3></div>
    <div class="seg light" role="group" aria-label="Periode om op te sorteren">${ROT_W.map(([, , label], i) => tpl`<button type="button" data-rot-sort="${String(i)}" aria-pressed="${String(i === k)}">${label}</button>`)}</div>
    ${ranked.length >= 3 ? tpl`<p class="small" style="margin-top:8px">Over ${ROT_W[k][2]} liepen <b>${lead.join(' en ')}</b> voorop; <b>${lag.join(' en ')}</b> bleven achter.</p>` : ''}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Sector</th>${ROT_W.map(([, , label]) => tpl`<th class="num">${label}</th>`)}<th class="num">Jouw deel</th><th>${ROT_W[k][2]}</th></tr></thead><tbody>
    ${sorted.map((r) => tpl`<tr${raw(r.w > 0 ? ' class="mine"' : '')}><td class="co"><b>${sectorNl(r.name)}</b>${r.w > 0 ? raw('<span class="nm">in bezit</span>') : ''}</td>
      ${r.cells.map(cell)}
      <td class="num">${r.w > 0 ? P1.format(r.w) : '–'}</td>
      <td><span class="rot-bar"><i class="${raw(isNum(r.cells[k].v) && r.cells[k].v < 0 ? 'neg' : 'pos')}" style="width:${raw((Math.min(1, Math.abs(isNum(r.cells[k].v) ? r.cells[k].v : 0) / mx) * 100).toFixed(1))}%"></i></span></td></tr>`)}
    </tbody></table></div>
    <p class="sub" style="margin-top:8px">Sectorrendement uit de dagveranderingen per sector die FMP publiceert (alle beurzen samen), opgeteld over 21, 63 en 126 handelsdagen.${anyOwn ? ' Een cel met * is zelf berekend uit de koersen van de bedrijven die de Worker in die sector kent (gelijk gewogen, in de munt van het aandeel): dat is geen sectorindex.' : ''} Welke sector vooropliep zegt niets over wat de volgende maanden doen. Geen beleggingsadvies.</p></section>`);
}
document.addEventListener('click', (e) => {
  const b = near(e, '[data-rot-sort]');
  if (!b) return;
  rotState.sort = Number(b.dataset.rotSort) || 0;
  markFresh();
  refresh('analyse');
});
