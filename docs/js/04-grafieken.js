/* Investeringstracker – Tooltip, grafieken en bouwstenen (tegels, lijsten, kerncijfers)
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Tooltip ----------
const tip = $('tip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x - w / 2, top = y - h - 14;
  left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
  if (top < 8) top = y + 18;
  tip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
}
function hideTip() { tip.hidden = true; }
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (!el || !el.dataset.tip) return;
  const r = el.getBoundingClientRect();
  showTip(esc(el.dataset.tip).replace(/\n/g, '<br>'), r.left + r.width / 2, r.top);
});
document.addEventListener('pointerout', (e) => { if (e.target.closest && e.target.closest('[data-tip]')) hideTip(); });
window.addEventListener('scroll', hideTip, { passive: true, capture: true });

// ---------- Grafieken ----------
function nearestIdx(pts, t) {
  if (!pts.length) return null;
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].t < t) lo = mid + 1; else hi = mid; }
  if (lo > 0 && Math.abs(pts[lo - 1].t - t) < Math.abs(pts[lo].t - t)) lo--;
  return lo;
}

const xFmt = (range, pts) => { const span = pts && pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : DAY * 9; return (t) => (span < 20 * HOUR ? fHM : span < 6 * DAY ? fWH : fDM).format(t); };
const tFmt = (range, pts) => { const daily = pts && pts.length > 1 && (pts[1].t - pts[0].t) >= 20 * HOUR; return (t) => (daily ? fD : fDT).format(t); };

/* Lijngrafiek op een vaste 1000×100-schaal die meerekt met de breedte.
 * sets: [{ pts: [{t, v}], color, area, dash, label, fmt }]; de eerste reeks bepaalt de tijdas. */
// Lange reeksen uitdunnen tot wat het scherm kan tonen; per stukje blijven het hoogste en laagste punt
// (en punten met een markering) behouden, zodat de vorm van de lijn gelijk blijft
function thinSets(host, sets, o) {
  const main = (sets[0] && sets[0].pts) || [];
  const max = Math.max(200, Math.min(900, Math.round((host.clientWidth || 600) * 1.5)));
  if (main.length <= max) return { sets, o };
  const keep = new Set([0, main.length - 1]);
  const buckets = Math.floor(max / 2), size = main.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size), to = Math.min(main.length, Math.floor((b + 1) * size));
    let lo = -1, hi = -1;
    for (let i = from; i < to; i++) { const v = main[i].v; if (!isNum(v)) continue; if (lo < 0 || v < main[lo].v) lo = i; if (hi < 0 || v > main[hi].v) hi = i; }
    if (lo >= 0) keep.add(lo); if (hi >= 0) keep.add(hi);
  }
  (o.markers || []).forEach((m) => { if (m.i != null) keep.add(m.i); });
  const idx = [...keep].sort((a, b) => a - b);
  const remap = new Map(idx.map((i, j) => [i, j]));
  const ts = new Set(idx.map((i) => main[i].t));
  return {
    sets: sets.map((s) => Object.assign({}, s, { pts: s.pts.filter((p) => ts.has(p.t)) })),
    o: Object.assign({}, o, { markers: (o.markers || []).map((m) => (m.i != null ? Object.assign({}, m, { i: remap.get(m.i) }) : m)) }),
  };
}

function lineChart(host, sets, o) {
  o = o || {};
  // Inzoomen: de volledige reeks blijft bewaard, getekend wordt alleen het gekozen stuk
  if (o.zoom !== false) {
    host._lc = { sets, o };
    // Andere reeks (andere periode of nieuwe gegevens): niet ingezoomd beginnen
    const key = sets[0] && sets[0].pts.length ? sets[0].pts[0].t + ':' + sets.length : '';
    if (host._zoomFor !== key) host._zoom = null;
    host._zoomFor = key;
    const z = host._zoom;
    if (z && sets[0] && sets[0].pts.length) {
      const full = sets[0].pts;
      const cut = sets.map((s) => Object.assign({}, s, { pts: s.pts.filter((p) => p.t >= z[0] && p.t <= z[1]) }));
      if (cut[0].pts.length >= 3) {
        sets = cut;
        o = Object.assign({}, o, { markers: (o.markers || []).map((mk) => (mk.i != null ? { t: full[mk.i] && full[mk.i].t, label: mk.label } : mk)).filter((mk) => mk.t >= z[0] && mk.t <= z[1]) });
      } else host._zoom = null;
    }
  }
  ({ sets, o } = thinSets(host, sets, o));
  host.innerHTML = '';
  const main = (sets[0] && sets[0].pts) || [];
  if (main.length < 2) {
    host.innerHTML = '<p class="chart-empty">' + esc(o.empty || 'Nog te weinig metingen voor deze periode.') + '</p>';
    if (o.xl) o.xl.innerHTML = '';
    return;
  }
  const n = main.length;
  const pos = new Map(main.map((p, i) => [p.t, i]));
  let lo = Infinity, hi = -Infinity;
  const ser = sets.map((s) => {
    const m = new Map();
    s.pts.forEach((p) => { if (isNum(p.v) && pos.has(p.t)) { m.set(pos.get(p.t), p.v); lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); } });
    return m;
  });
  if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (!(hi > lo)) { const pad = Math.abs(hi) * 0.01 || 1; hi += pad; lo -= pad; }
  const top = o.top == null ? 0.16 : o.top, bot = o.bottom == null ? 0.06 : o.bottom;
  const X = (i) => (i / (n - 1)) * 1000;
  const Y = (v) => 100 * (top + (1 - top - bot) * (hi - v) / (hi - lo));

  let svg = '<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"' + (o.animate && !reduceMotion() ? ' class="reveal"' : '') + '>';
  if (o.zero) svg += '<line x1="0" x2="1000" y1="' + Y(0).toFixed(2) + '" y2="' + Y(0).toFixed(2) + '" stroke="#9AA3B5" stroke-width="1" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>';
  sets.forEach((s, k) => {
    const idx = [...ser[k].keys()].sort((a, b) => a - b);
    if (idx.length < 2) return;
    const d = idx.map((i, j) => (j ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(ser[k].get(i)).toFixed(2)).join('');
    // Geen gekleurde vlakken onder lijnen meer (rustig ontwerp); 'area' wordt genegeerd
    svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.width || 2.5) + '" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"' + (s.dash ? ' stroke-dasharray="6 5"' : '') + '/>';
  });
  host.innerHTML = svg + '</svg>';

  (o.markers || []).forEach((mk) => {
    const i = mk.i != null ? mk.i : nearestIdx(main, mk.t);
    const v = i == null ? null : ser[0].get(i);
    if (!isNum(v)) return;
    const el = document.createElement('div');
    const xp = X(i) / 10;
    el.className = 'marker' + (xp > 82 ? ' r' : xp < 18 ? ' l' : '');
    el.style.left = xp + '%';
    el.style.top = Y(v) + '%';
    el.innerHTML = '<span></span><i></i>';
    el.firstChild.textContent = mk.label;
    host.appendChild(el);
  });

  if (o.hover !== false) {
    const lay = document.createElement('div');
    lay.className = 'chart-hover';
    const cur = document.createElement('div');
    cur.className = 'cursor';
    cur.hidden = true;
    lay.appendChild(cur);
    const curH = document.createElement('div');
    curH.className = 'cursor-h';
    curH.hidden = true;
    lay.appendChild(curH);
    const dots = sets.map((s) => { const d = document.createElement('div'); d.className = 'cursor-dot'; d.style.background = s.color; d.hidden = true; lay.appendChild(d); return d; });
    const move = (e) => {
      const r = lay.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
      const x = X(i) / 10;
      cur.hidden = false;
      cur.style.left = x + '%';
      let html = '<b>' + esc(o.tfmt ? o.tfmt(main[i].t) : '') + '</b>', yTop = null;
      sets.forEach((s, k) => {
        const v = ser[k].get(i), d = dots[k];
        if (!isNum(v)) { d.hidden = true; return; }
        d.hidden = false; d.style.left = x + '%'; d.style.top = Y(v) + '%';
        if (yTop == null) yTop = Y(v);
        html += '<br>' + (sets.length > 1 ? esc(s.label) + ': ' : '') + esc((s.fmt || o.fmt || eur)(v));
      });
      if (yTop != null) { curH.hidden = false; curH.style.top = yTop + '%'; } else curH.hidden = true;
      showTip(html, r.left + (x / 100) * r.width, r.top + ((yTop || 0) / 100) * r.height);
    };
    lay.addEventListener('pointermove', move);
    lay.addEventListener('pointerdown', move);
    lay.addEventListener('pointerleave', () => { cur.hidden = true; curH.hidden = true; dots.forEach((d) => { d.hidden = true; }); hideTip(); });
    host.appendChild(lay);
    if (o.zoom !== false && host._lc) chartZoom(host, lay, main);
  }

  if (o.xl && o.xfmt) {
    const k = Math.min(o.xcount || 4, n);
    const labs = [];
    for (let j = 0; j < k; j++) labs.push('<span>' + esc(o.xfmt(main[Math.round((j * (n - 1)) / (k - 1))].t)) + '</span>');
    o.xl.innerHTML = labs.join('');
  }
}

// Knijpen (twee vingers), Ctrl + scrollen of knijpen op het touchpad om in te zoomen; dubbelklik of de knop om terug te gaan
function chartZoom(host, lay, main) {
  const redraw = () => { hideTip(); lineChart(host, host._lc.sets, host._lc.o); };
  const zoomTo = (cx, f) => {
    const full = host._lc.sets[0].pts;
    if (!full || full.length < 4) return;
    const r = lay.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (cx - r.left) / (r.width || 1)));
    const t0 = main[0].t, t1 = main[main.length - 1].t, c = t0 + frac * (t1 - t0);
    const a = c - (c - t0) * f, b = c + (t1 - c) * f;
    const fa = full[0].t, fb = full[full.length - 1].t;
    host._zoom = b - a >= (fb - fa) * 0.98 ? null : [Math.max(fa, a), Math.min(fb, b)];
    redraw();
  };
  lay.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); zoomTo(e.clientX, e.deltaY < 0 ? 0.75 : 1.33); }, { passive: false });
  lay.addEventListener('dblclick', () => { if (host._zoom) { host._zoom = null; redraw(); } });
  const ptrs = new Map();
  let d0 = 0, scale = 1, mid = 0;
  const spread = () => { const v = [...ptrs.values()]; return [Math.abs(v[0] - v[1]), (v[0] + v[1]) / 2]; };
  lay.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; ptrs.set(e.pointerId, e.clientX); if (ptrs.size === 2) { [d0, mid] = spread(); scale = 1; } });
  lay.addEventListener('pointermove', (e) => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, e.clientX); if (ptrs.size === 2 && d0 > 20) { const [d, m] = spread(); scale = d0 / Math.max(10, d); mid = m; } });
  const up = (e) => { if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); if (d0 && Math.abs(scale - 1) > 0.15) { const s = scale; d0 = 0; scale = 1; zoomTo(mid, Math.max(0.2, Math.min(5, s))); } else if (ptrs.size < 2) d0 = 0; };
  lay.addEventListener('pointerup', up);
  lay.addEventListener('pointercancel', up);
  if (host._zoom) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'zoom-reset'; b.textContent = 'Zoom terug';
    b.addEventListener('click', (e) => { e.stopPropagation(); host._zoom = null; redraw(); });
    host.appendChild(b);
  }
}

function thin(a, max) {
  if (a.length <= max) return a;
  const out = [], step = (a.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(a[Math.round(i * step)]);
  return out;
}

function spark(pts, color, cls) {
  const a = thin((pts || []).filter((p) => isNum(p.v)), 140);
  cls = cls || 'spark';
  if (a.length < 2) return '<div class="' + cls + '"></div>';
  let lo = Infinity, hi = -Infinity;
  a.forEach((p) => { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); });
  if (!(hi > lo)) { hi += 1; lo -= 1; }
  const X = (i) => ((i / (a.length - 1)) * 200).toFixed(1);
  const Y = (v) => (6 + ((hi - v) / (hi - lo)) * 50).toFixed(2);
  const d = a.map((p, i) => (i ? 'L' : 'M') + X(i) + ' ' + Y(p.v)).join('');
  return '<svg class="' + cls + '" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">' +
    '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
}

function bars(items, single) {
  const mx = Math.max(1e-12, ...items.map((it) => (isNum(it.v) ? Math.abs(it.v) : 0)));
  const h = (v) => (isNum(v) ? ((Math.abs(v) / mx) * 100).toFixed(1) : 0);
  if (single) {
    return '<div class="bars single">' + items.map((it) =>
      '<div class="col" data-tip="' + esc(it.tip) + '"><div class="b" style="height:' + h(it.v) + '%;background:' + it.color + '"></div></div>').join('') + '</div>';
  }
  // Boven en onder de nullijn krijgen ruimte naar verhouding, zodat er geen lege helft overblijft
  const mxP = Math.max(0, ...items.map((it) => (isNum(it.v) && it.v > 0 ? it.v : 0)));
  const mxN = Math.max(0, ...items.map((it) => (isNum(it.v) && it.v < 0 ? -it.v : 0)));
  const fu = Math.max(0.08, mxP / mx), fd = Math.max(0.08, mxN / mx);
  const hu = (v) => (mxP ? (v / mxP * 100).toFixed(1) : 0), hd = (v) => (mxN ? (-v / mxN * 100).toFixed(1) : 0);
  return '<div class="bars">' + items.map((it) => {
    const v = it.v;
    return '<div class="col" data-tip="' + esc(it.tip) + '">' +
      '<div class="half up" style="flex:' + fu.toFixed(3) + '"><div class="b' + (isNum(v) && v > 0 ? '' : ' none') + '" style="height:' + (v > 0 ? hu(v) : 0) + '%"></div></div>' +
      '<div class="half down" style="flex:' + fd.toFixed(3) + '"><div class="b' + (isNum(v) && v < 0 ? '' : ' none') + '" style="height:' + (v < 0 ? hd(v) : 0) + '%"></div></div></div>';
  }).join('') + '</div>';
}

const barLabels = (labels) => '<div class="bar-labels">' + labels.map((l) => '<span>' + esc(l) + '</span>').join('') + '</div>';

function heatCls(p) {
  const a = Math.abs(p);
  return (p >= 0 ? 'heat-g' : 'heat-l') + (a < 0.005 ? 1 : a < 0.015 ? 2 : 3);
}

function calendar(returns) {
  const map = new Map(returns.map((d) => [dayKey(d.t), d]));
  const end = returns.length ? new Date(returns[returns.length - 1].t) : new Date();
  const mon = new Date(end); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const start = new Date(mon); start.setDate(start.getDate() - 7 * 12);
  let cells = '';
  for (let w = 0; w < 13; w++) {
    for (let d = 0; d < 5; d++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
      const r = map.get(dayKey(day.getTime()));
      if (r) cells += '<span class="' + heatCls(r.pct) + '" data-tip="' + esc(fD.format(day) + ': ' + spct(r.pct)) + '"></span>';
      else if (day > end) cells += '<span style="visibility:hidden"></span>';
      else cells += '<span data-tip="' + esc(fD.format(day) + ': geen meting') + '"></span>';
    }
  }
  return '<div class="cal-wrap"><div class="cal-days" aria-hidden="true"><span>ma</span><span>di</span><span>wo</span><span>do</span><span>vr</span></div>' +
    '<div class="cal" role="img" aria-label="Resultaat per dag over de laatste 13 weken">' + cells + '</div></div>' +
    '<div class="heat-key" aria-hidden="true">gedaald <i class="heat-l3"></i><i class="heat-l2"></i><i class="heat-l1"></i><i class="heat-g1"></i><i class="heat-g2"></i><i class="heat-g3"></i> gestegen</div>';
}

// ---------- Bouwstenen ----------
const stag = (html, i) => html.replace(/^<(\w+)/, '<$1 style="--i:' + i + '"');
const fill = (id, items) => { $(id).innerHTML = items.map(stag).join(''); };

// Kerncijfer als tegel (desktop) of kaart (telefoon)
function stat(k, v, sub, cls, extra) {
  const flush = !!extra && extra.indexOf('spark') !== -1;
  const base = mode === 'm' ? 'm-stat' : 'tile';
  return '<section class="' + base + (flush ? '' : ' pad') + '"><span class="k">' + esc(k) + '</span>' +
    '<span class="v ' + (cls || '') + '">' + esc(v) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + (extra || '') + '</section>';
}

const split = (a, b) => '<div class="meter split" aria-hidden="true"><div style="flex:' + a + ';background:' + C.gain + '"></div><div style="flex:' + b + ';background:' + C.loss + '"></div></div>';

function kvList(rows) {
  return '<dl class="kv">' + rows.map(([k, v, c]) => '<div><dt>' + esc(k) + '</dt><dd' + (c ? ' class="' + c + '"' : '') + '>' + esc(v) + '</dd></div>').join('') + '</dl>';
}

function rangeStrip(c) {
  let lo = Math.min(isNum(c.atl) ? c.atl : c.low, c.low);
  let hi = Math.max(isNum(c.ath) ? c.ath : c.high, c.high);
  if (!isNum(lo) || !isNum(hi)) return '<p class="muted">Nog geen metingen van vandaag.</p>';
  if (!(hi > lo)) { const pad = Math.max(Math.abs(hi) * 0.005, 0.01); lo -= pad; hi += pad; }
  const p = (v) => (((v - lo) / (hi - lo)) * 100).toFixed(2) + '%';
  return '<div class="range" role="img" aria-label="' + esc('Vandaag tussen ' + eur(c.low) + ' en ' + eur(c.high) + ', nu ' + eur(c.value) + '. Laagste gemeten ' + eur(lo) + ', hoogste gemeten ' + eur(hi)) + '">' +
    '<div class="rail"></div><div class="today" style="left:' + p(c.low) + ';width:calc(' + p(c.high) + ' - ' + p(c.low) + ')"></div>' +
    (isNum(c.avg) ? '<div class="avg" style="left:' + p(c.avg) + '"></div>' : '') +
    '<div class="now" style="left:' + p(c.value) + '"></div></div>' +
    '<div class="range-labels"><span>Laagste gemeten ' + esc(eur(lo)) + '</span><span>Hoogste gemeten ' + esc(eur(hi)) + '</span></div>';
}

function patternTiles(tk, s) {
  const hp = hourPattern(tk);
  const wp = weekdayPattern(s.returns);
  const edges = [-Infinity, -0.03, -0.02, -0.01, -0.005, 0, 0.005, 0.01, 0.02, 0.03, Infinity];
  const names = ['< −3%', '−3 tot −2%', '−2 tot −1%', '−1 tot −0,5%', '−0,5 tot 0%', '0 tot 0,5%', '0,5 tot 1%', '1 tot 2%', '2 tot 3%', '> 3%'];
  const hist = names.map((nm, i) => {
    const c = s.returns.filter((d) => d.pct >= edges[i] && d.pct < edges[i + 1]).length;
    return { v: c, color: i < 5 ? C.loss : C.gain, tip: nm + ': ' + days(c) };
  });
  const hoursN = sum(hp.map((h) => h.n));
  const note = (t) => '<p class="sub" style="margin-top:8px">' + esc(t) + '</p>';
  const few = (min) => '<p class="muted">' + esc(tooFew(s.n, min)) + '.</p>';
  return [
    '<section class="tile pad"><h3>Resultaat per dag</h3>' + (s.n ? calendar(s.returns) : '<p class="muted">Nog geen dagen gemeten.</p>') + '</section>',
    '<section class="tile pad"><h3>Wanneer beweegt het?</h3>' +
      (hoursN >= 3 ? bars(hp.map((h) => ({ v: h.v, tip: h.hr + ':00–' + (h.hr + 1) + ':00: ' + (h.n ? spct(h.v) + ' gemiddeld (' + h.n + ' uur)' : 'geen metingen') }))) +
        barLabels(hp.map((h) => (h.hr % 2 === 0 ? String(h.hr) : ''))) + note('Gemiddelde verandering per uur van de dag, op basis van ' + hoursN + ' afgeronde uren.')
        : '<p class="muted">Nog te weinig afgeronde uren gemeten.</p>') + '</section>',
    '<section class="tile pad"><h3>Per weekdag</h3>' +
      (s.n >= MIN_DAYS_SD ? bars(wp.map((d) => ({ v: d.v, tip: d.nm + ': ' + (d.n ? spct(d.v) + ' gemiddeld over ' + days(d.n) : 'nog geen metingen') }))) +
        barLabels(wp.map((d) => d.short)) + note('Gemiddeld dagresultaat per weekdag.') : few(MIN_DAYS_SD)) + '</section>',
    '<section class="tile pad"><h3>Hoe groot zijn de dagbewegingen?</h3>' +
      (s.n >= MIN_DAYS_SD ? bars(hist, true) + barLabels(['−3%', '', '', '', '', '0', '', '', '', '+3%']) + note('Aantal dagen per grootte van de beweging.') : few(MIN_DAYS_SD)) + '</section>',
  ];
}

// Kerncijfers van de portefeuille (kaarten), gedeeld door desktop en telefoon
function kpiCards() {
  const W = M.weeks, last = W[W.length - 1];
  const wk = (f) => W.filter((w) => isNum(w[f])).map((w) => ({ t: w.t, v: w[f] }));
  const unreal = sum(M.companies.map((c) => (isNum(c.unreal) ? c.unreal : 0)));
  const none = M.canImport ? 'Nog geen weekmeting' : 'De eerste weekmeting volgt zaterdag';
  return [
    clickable(stat('Accountwaarde', eur(M.accountNow), M.cash != null ? 'beleggingen ' + eur(M.totalValue) + ' + ' + eur(M.cash) + ' vrij saldo' : 'alleen beleggingen; vrij saldo volgt na een weekmeting', '',
      spark(wk('accountValue').concat(M.lastT ? [{ t: M.lastT, v: M.accountNow }] : []), C.accent)), '@account', 'Accountwaarde: bekijk waar je geld zit'),
    last ? clickable(stat('Netto gestort', eur(last.netDeposits), isNum(last.newDeposits) && last.newDeposits ? seur(last.newDeposits) + ' in de laatste week' : 'geen storting in de laatste week', '', spark(wk('netDeposits'), C.ink2)), DEP, 'Netto gestort: bekijk je stortingen', 'Stortingen')
      : stat('Netto gestort', '–', none, '', ''),
    last ? clickable(stat('Totaal resultaat', seur(last.totalResult), spct(last.totalResultPct) + ' op je inleg', tone(last.totalResult), spark(wk('totalResult'), toneColor(last.totalResult))), RES, 'Totaal resultaat: bekijk waar het vandaan komt', 'Opbouw')
      : stat('Totaal resultaat', '–', none, '', ''),
    clickable(stat('Ongerealiseerd', seur(unreal), 'open posities, nu', tone(unreal), spark(wk('unrealized'), toneColor(unreal))), RES, 'Ongerealiseerd: bekijk het per positie', 'Per positie'),
  ];
}

// Maak van een kaart een knop die inzoomt
function clickable(html, key, label, more) {
  return html.replace(/^<section class="([^"]*)">/, '<button type="button" class="$1 clickable" data-ticker="' + key + '" aria-label="' + esc(label) + '">')
    .replace(/<\/section>$/, '<span class="more" aria-hidden="true">' + esc(more || 'Verdeling') + ' ›</span></button>');
}

function statCards(S) {
  const W = M.weeks, last = W[W.length - 1];
  const wr = W.filter((w) => isNum(w.weekResultPct));
  let idx = 1;
  const chain = wr.map((w) => { idx *= 1 + w.weekResultPct; return { t: w.t, v: idx - 1 }; });
  const twr = wr.length ? idx - 1 : null;
  const posW = wr.filter((w) => w.weekResultPct > 0).length;
  const T = M.tot;
  const dd = isNum(T.ath) && T.ath > 0 ? (T.value - T.ath) / T.ath : null;
  const top3 = M.companies.slice().sort((a, b) => b.value - a.value).slice(0, 3);
  const top3w = sum(top3.map((c) => c.weight || 0));
  const noWeeks = M.canImport ? 'Neem je weken over via Instellingen' : 'Na de tweede weekmeting';
  return [
    stat('Rendement zonder stortingen', twr == null ? '–' : spct1(twr), wr.length ? 'tijdgewogen, over ' + wr.length + (wr.length === 1 ? ' week' : ' weken') : noWeeks, tone(twr), chain.length > 1 ? spark([{ t: 0, v: 0 }].concat(chain), toneColor(twr)) : ''),
    stat('Weken met winst', wr.length ? posW + ' van ' + wr.length : '–', wr.length ? P1.format(posW / wr.length) + ' van de weken' : noWeeks, '', wr.length ? split(posW, wr.length - posW) : ''),
    stat('Dagen gestegen', S.n ? S.up + ' van ' + S.n : '–', S.n ? streakText(S) : 'Nog geen dagen gemeten', '', S.n ? split(S.up, S.down) : ''),
    stat('Beste dag', S.best ? spct(S.best.pct) : '–', S.best ? fD.format(S.best.t) + '. Slechtste: ' + spct(S.worst.pct) + ' op ' + fD.format(S.worst.t) : tooFew(S.n, MIN_DAYS_BEST), tone(S.best && S.best.pct)),
    clickable(stat('Beweeglijkheid', isNum(S.sd) ? '± ' + P1.format(S.sd) + ' per dag' : '–', isNum(S.sd) ? 'gemiddelde afwijking van het dagresultaat' : tooFew(S.n, MIN_DAYS_SD)), RISK, 'Beweeglijkheid: bekijk je risico en wat het verlaagt', 'Risico'),
    stat('Tot hoogste gemeten', dd == null ? '–' : dd >= -0.0005 ? 'Op het hoogste punt' : spct1(dd), isNum(T.ath) ? 'hoogste ' + eur(T.ath) + ' sinds ' + fDM.format(M.since) : '', dd != null && dd < -0.0005 ? 'loss' : ''),
    stat('Grootste 3 posities', top3.length ? P1.format(top3w) : '–', top3.map((c) => c.tk).join(', ') + ' samen', '', '<div class="meter" aria-hidden="true"><div style="width:' + (top3w * 100).toFixed(1) + '%"></div></div>'),
    stat('Vrij saldo', last && isNum(last.cash) ? eur(last.cash) : '–', last && isNum(last.cash) && last.accountValue ? P1.format(last.cash / last.accountValue) + ' van je accountwaarde' : noWeeks),
  ].concat(moreStatCards(S, wr));
}

// Extra kerncijfers: terugval, markt, spreiding, weken en dividend
function moreStatCards(S, wr) {
  const out = [];
  // Grootste terugval: van een piek naar het laagste punt daarna, op de dagresultaten (aankopen tellen niet mee)
  let idx = 1, peak = 1, mdd = 0, peakT = null, ddFrom = null, ddTo = null;
  const ddPts = [];
  S.returns.forEach((d) => {
    idx *= 1 + d.pct;
    if (idx > peak) { peak = idx; peakT = d.t; }
    const dd = idx / peak - 1;
    if (dd < mdd) { mdd = dd; ddFrom = peakT; ddTo = d.t; }
    ddPts.push({ t: d.t, v: dd });
  });
  out.push(stat('Grootste terugval', S.n >= MIN_DAYS_SD ? (mdd < -0.0005 ? spct1(mdd) : 'Geen') : '–',
    S.n < MIN_DAYS_SD ? tooFew(S.n, MIN_DAYS_SD) : mdd < -0.0005 ? 'van piek tot dal' + (ddFrom ? ', ' + fDM.format(ddFrom) + ' tot ' + fDM.format(ddTo) : ' vanaf de start') : 'nog geen daling na een piek',
    S.n >= MIN_DAYS_SD && mdd < -0.0005 ? 'loss' : '', S.n >= MIN_DAYS_SD ? spark(ddPts, C.loss) : ''));

  // Jij tegenover de markt over dezelfde dagen
  const b = M.bench;
  if (b) {
    const bm = new Map(dailyReturns(b.c.tk).map((d) => [dayKey(d.t), d.pct]));
    const pairs = S.returns.filter((d) => bm.has(dayKey(d.t)));
    let mine = 1, mkt = 1;
    const diffPts = pairs.map((d) => { mine *= 1 + d.pct; mkt *= 1 + bm.get(dayKey(d.t)); return { t: d.t, v: mine - mkt }; });
    const diff = mine - mkt;
    out.push(stat('Jij tegenover de markt', pairs.length >= MIN_DAYS_BEST ? sgn(diff * 100, N2) + ' pp' : '–',
      pairs.length >= MIN_DAYS_BEST ? 'jij ' + spct1(mine - 1) + ', ' + b.label + ' ' + spct1(mkt - 1) + ' over ' + days(pairs.length) : tooFew(pairs.length, MIN_DAYS_BEST),
      pairs.length >= MIN_DAYS_BEST ? tone(diff) : '', pairs.length >= MIN_DAYS_BEST ? spark([{ t: pairs[0].t - DAY, v: 0 }].concat(diffPts), toneColor(diff)) : ''));
  }

  // Spreiding: met hoeveel even grote posities je portefeuille overeenkomt
  const ws = M.companies.map((c) => c.weight || 0);
  const hhi = sum(ws.map((w) => w * w));
  const eff = hhi > 0 ? 1 / hhi : null;
  out.push(stat('Spreiding', eff ? '≈ ' + N1.format(eff) + ' posities' : '–',
    eff ? 'zo gespreid als ' + Math.round(eff) + ' even grote posities; je hebt er ' + M.companies.length : '', '',
    eff ? '<div class="meter" aria-hidden="true"><div style="width:' + Math.min(100, (eff / M.companies.length) * 100).toFixed(1) + '%"></div></div>' : ''));

  // Posities in de plus
  const withRes = M.companies.filter((c) => isNum(c.unreal));
  const plus = withRes.filter((c) => c.unreal > 0).length;
  const bestP = withRes.slice().sort((x, y) => (y.resultPct || 0) - (x.resultPct || 0))[0];
  out.push(stat('Posities in de plus', withRes.length ? plus + ' van ' + withRes.length : '–',
    bestP ? 'beste ' + bestP.tk + ' ' + spct1(bestP.resultPct) : '', '', withRes.length ? split(plus, withRes.length - plus) : ''));

  // Beste en slechtste week in euro
  const best = wr.reduce((x, w) => (!x || w.weekResult > x.weekResult ? w : x), null);
  const worst = wr.reduce((x, w) => (!x || w.weekResult < x.weekResult ? w : x), null);
  out.push(stat('Beste week', best ? seur(best.weekResult) : '–',
    best ? 'tot ' + fDM.format(best.t) + '. Slechtste ' + seur(worst.weekResult) + ' tot ' + fDM.format(worst.t) : 'Na de tweede weekmeting', best ? tone(best.weekResult) : ''));

  // Gemiddelde dag
  const avg = S.n >= MIN_DAYS_BEST ? mean(S.returns.map((d) => d.pct)) : null;
  out.push(stat('Gemiddelde dag', isNum(avg) ? spct(avg) : '–', isNum(avg) ? '≈ ' + seur(avg * M.totalValue) + ' bij je huidige waarde, over ' + days(S.n) : tooFew(S.n, MIN_DAYS_BEST), tone(avg)));

  // Dividend
  const E = M.ev;
  out.push(stat('Dividend, 12 maanden', E.loaded ? eur(E.last12) : '–',
    !E.loaded ? 'na de eerste dagelijkse ophaalronde' : E.received.length ? (isNum(E.yieldOnCost) ? P2.format(E.yieldOnCost) + ' op je inleg' : '') : 'nog geen uitkering ontvangen', E.last12 > 0 ? 'gain' : ''));
  const T = M.tx;
  out.push(stat('Gerealiseerd resultaat', T.has ? seur(T.realised) : '–', T.has ? T.sells.length + ' verkopen, ' + eur(T.fees) + ' kosten betaald' : 'na het ophalen van je orders', T.has ? tone(T.realised) : ''));
  out.push(stat('Valuta-effect', isNum(T.fx) ? seur(T.fx) : '–', isNum(T.fx) ? 'door de wisselkoers, in je ongerealiseerde resultaat' : 'volgt bij de volgende meting', tone(T.fx)));
  out.push(stat('Dividend komende 90 dagen', E.loaded ? '≈ ' + eur(E.next90) : '–',
    E.loaded ? E.divs.filter((d) => d.t <= dayStart(Date.now()) + 90 * DAY).length + ' uitkeringen aangekondigd of verwacht' : 'na de eerste dagelijkse ophaalronde'));
  return out;
}

function statsNote(S) {
  return S.n ? 'Op basis van ' + days(S.n) + ' sinds ' + fD.format(S.returns[0].t) + '.' : '';
}

function weekCards() {
  const W = M.weeks;
  if (!W.length) {
    return ['<p class="empty">Nog geen weekmetingen. ' + (M.canImport
      ? '<button type="button" class="linklike" data-act="import">Neem je weken over uit de Google Sheet</button>, of wacht op de eerste meting zaterdag.'
      : 'De eerste volgt zaterdag rond 09:00.') + '</p>'];
  }
  const wr = W.filter((w) => isNum(w.weekResult));
  const best = wr.reduce((b, w) => (!b || w.weekResult > b.weekResult ? w : b), null);
  const worst = wr.reduce((b, w) => (!b || w.weekResult < b.weekResult ? w : b), null);
  const sorted = M.companies.slice().sort((a, b) => b.value - a.value);
  const shades = ['#1E3A8A', '#2B5BD7', '#5B86E5', '#8FAEF0', '#BFD0F7'];
  const topN = sorted.slice(0, 5), rest = sorted.slice(5);
  const restVal = sum(rest.map((c) => c.value));
  const pctOf = (v) => (M.totalValue ? P1.format(v / M.totalValue) : '–');
  return [
    '<section class="tile pad"><h3>Accountwaarde en inleg</h3><div class="chart" data-chart="weeks" style="height:150px"></div>' +
      '<div class="xlabels" data-x="weeks"></div><div class="legend" style="margin-top:8px"><span><i style="background:' + C.accent + '"></i>Accountwaarde</span><span><i class="dash"></i>Netto gestort</span></div></section>',
    '<section class="tile pad"><h3>Resultaat per week</h3>' +
      (wr.length ? bars(wr.map((w) => ({ v: w.weekResult, tip: 'Week tot ' + fDM.format(w.t) + ': ' + seur(w.weekResult) + ' (' + spct(w.weekResultPct) + ')' }))) +
        '<div class="bar-labels"><span style="text-align:left">' + esc(fDM.format(wr[0].t)) + '</span><span style="text-align:right">' + esc(fDM.format(wr[wr.length - 1].t)) + '</span></div>' +
        '<p class="sub" style="margin-top:8px">Zonder stortingen. Beste week ' + esc(seur(best.weekResult)) + ', slechtste ' + esc(seur(worst.weekResult)) + '.</p>'
        : '<p class="muted">Na de tweede weekmeting zie je hier het resultaat per week.</p>') + '</section>',
    '<section class="tile pad"><h3>Verdeling</h3><div class="stack" role="img" aria-label="Verdeling van de portefeuille">' +
      topN.map((c, i) => '<div style="flex:' + c.value + ';background:' + shades[i] + '" data-tip="' + esc(c.tk + ': ' + pctOf(c.value)) + '"></div>').join('') +
      (rest.length ? '<div style="flex:' + restVal + ';background:#CDD3DD" data-tip="' + esc('Overig: ' + pctOf(restVal)) + '"></div>' : '') + '</div>' +
      '<div class="legend-list">' + topN.map((c, i) =>
        '<button type="button" data-ticker="' + esc(c.tk) + '"><i style="background:' + shades[i] + '"></i><span class="nm">' + esc(c.tk) + ' <span class="muted">' + esc(c.name) + '</span></span><b>' + esc(pctOf(c.value)) + '</b></button>').join('') +
      (rest.length ? '<button type="button" data-goto="bedrijven"><i style="background:#CDD3DD"></i><span class="nm">Overig (' + rest.length + ')</span><b>' + esc(pctOf(restVal)) + '</b></button>' : '') + '</div></section>',
  ];
}

function drawWeekChart(root) {
  const host = root.querySelector('[data-chart="weeks"]');
  if (!host) return;
  const W = M.weeks;
  lineChart(host, [
    { pts: W.map((w) => ({ t: w.t, v: w.accountValue })), color: C.accent, area: true, label: 'Accountwaarde' },
    { pts: W.filter((w) => isNum(w.netDeposits)).map((w) => ({ t: w.t, v: w.netDeposits })), color: C.ink2, dash: true, width: 2, label: 'Netto gestort' },
  ], { top: 0.08, bottom: 0.08, xl: root.querySelector('[data-x="weeks"]'), xcount: 2, xfmt: (t) => fDM.format(t), tfmt: (t) => 'Week tot ' + fDM.format(t), empty: 'Na de tweede weekmeting zie je hier het verloop.' });
}

function heroMarkers(pts, range) {
  const markers = [];
  if (pts.length > 2) {
    let mi = 0;
    pts.forEach((p, i) => { if (p.v > pts[mi].v) mi = i; });
    markers.push({ i: mi, label: 'hoogste ' + eur(pts[mi].v) });
    if (range === 'all' || range === '1m') {
      M.weeks.filter((w) => isNum(w.newDeposits) && w.newDeposits > 0 && w.t >= pts[0].t && w.t <= pts[pts.length - 1].t + DAY)
        .slice(-3).forEach((w) => { const i = nearestIdx(pts, w.t); if (i !== mi) markers.push({ i, label: 'storting ' + eur(w.newDeposits) }); });
    }
  }
  return markers;
}

function segButtons(host, opts, current, onPick) {
  host.innerHTML = opts.map(([k, l]) => '<button type="button" data-k="' + k + '" aria-pressed="' + (k === current) + '">' + esc(l) + '</button>').join('');
  host.onclick = (e) => { const b = e.target.closest('button[data-k]'); if (b) onPick(b.dataset.k); };
}

function drawHero(p, animate) {
  const r = ui.heroRange;
  const pts = seriesFor(TOTAL, r);
  segButtons($(p + 'hero-ranges'), RANGES, r, (k) => { ui.heroRange = k; drawHero(p, true); });
  lineChart($(p + 'hero-chart'), [{ pts, color: C.accent, width: 2.5 }], {
    animate, markers: heroMarkers(pts, r), xl: $(p + 'hero-x'), xfmt: xFmt(r, pts), tfmt: tFmt(r, pts),
    empty: 'Nog te weinig metingen voor deze periode. De tracker meet op werkdagen tussen 08:00 en 22:30.',
  });
  $(p + 'hero-note').textContent = coverageNote(r, pts);
  setMini();
}

function changeLine(o) {
  if (!isNum(o.change)) return 'Nog geen metingen van vandaag';
  return seur(o.change) + ' (' + spct(o.changePct) + ') ' + M.dayWord;
}

// Kerncijfers van één bedrijf
function companyInfo(c) {
  const S = statsFor(c.tk);
  const dAll = seriesFor(c.tk, 'all');
  const tMap = new Map(seriesFor(TOTAL, 'all').map((p) => [dayKey(p.t), p.v]));
  const weightHist = dAll.map((p) => { const t = tMap.get(dayKey(p.t)); return t ? { t: p.t, v: p.v / t } : null; }).filter(Boolean);
  const monthAgo = weightHist.filter((p) => p.t <= (M.lastT || Date.now()) - 30 * DAY).pop();
  let runMax = -Infinity;
  const ddHist = dAll.map((p) => { runMax = Math.max(runMax, p.v); return { t: p.t, v: p.v / runMax - 1 }; });
  const dd = isNum(c.ath) && c.ath > 0 ? (c.value - c.ath) / c.ath : null;
  const price = c.qty ? c.value / c.qty : null;
  const avgBuy = c.qty && isNum(c.cost) ? c.cost / c.qty : null;
  const todayRangePct = isNum(c.high) && isNum(c.low) && c.avg ? (c.high - c.low) / c.avg : null;
  let rangeNote = '';
  if (isNum(todayRangePct) && isNum(c.avgRangePct) && c.avgRangePct > 0 && c.histDays > 2) {
    const ratio = todayRangePct / c.avgRangePct;
    rangeNote = M.dayWord.charAt(0).toUpperCase() + M.dayWord.slice(1) + ' ' + P1.format(todayRangePct) + ' tussen laag en hoog, ' +
      (ratio > 1.3 ? 'drukker dan' : ratio < 0.7 ? 'rustiger dan' : 'ongeveer zoals') + ' gemiddeld (' + P1.format(c.avgRangePct) + ').';
  }
  const T = M.tot;
  const contrib = isNum(c.change) && isNum(T.change) ? seur(c.change) + ' van ' + seur(T.change) : '–';
  const kpis = [
    stat(M.isToday ? 'Vandaag' : 'Laatste handelsdag', seur(c.change), spct(c.changePct) + ' ' + baseText(c), tone(c.change), spark(seriesFor(c.tk, 'today'), toneColor(c.change))),
    stat('Sinds aankoop', spct1(c.resultPct), isNum(c.unreal) ? seur(c.unreal) + ' op ' + eur(c.cost) + ' inleg' : 'geen aankoopgegevens', tone(c.resultPct), spark(dAll, toneColor(c.resultPct))),
    stat('Deel van portefeuille', isNum(c.weight) ? P1.format(c.weight) : '–', monthAgo ? 'was ' + P1.format(monthAgo.v) + ' op ' + fDM.format(monthAgo.t) : 'van ' + eur(M.totalValue), '', spark(weightHist, C.accent)),
    stat('Tot hoogste gemeten', dd == null ? '–' : dd >= -0.0005 ? 'Op het hoogste punt' : spct1(dd), isNum(c.ath) ? 'hoogste ' + eur(c.ath) + ' sinds ' + fDM.format(M.since) : '', dd != null && dd < -0.0005 ? 'loss' : '', spark(ddHist, C.loss)),
  ];
  const rangeTile = '<section class="tile pad"><h3>Dagbereik binnen de historie</h3>' + rangeStrip(c) +
    '<p class="sub" style="margin-top:10px">Balk: laag tot hoog ' + esc(M.dayWord) + '. Streep: gemiddelde. Punt: nu. ' + esc(rangeNote) + '</p>' +
    '<div style="margin-top:12px">' + kvList([
      ['Opening', eur(c.open)],
      ['Laagste en hoogste', isNum(c.low) ? eur(c.low) + ' – ' + eur(c.high) : '–'],
      ['Gemiddelde', eur(c.avg)],
      ['Boven laagste gemeten', isNum(c.atl) && c.atl > 0 ? spct1((c.value - c.atl) / c.atl) : '–'],
    ]) + '</div></section>';
  const posTile = '<section class="tile pad"><h3>Positie</h3>' + kvList([
    ['Waarde nu', eur(c.value)],
    ['Aantal', c.qty ? N4.format(c.qty) : '–'],
    ['Koers in euro', eur(price)],
    ['Gemiddelde aankoopprijs', eur(avgBuy)],
    ['Ingelegd', eur(c.cost)],
    ['Ongerealiseerd', isNum(c.unreal) ? seur(c.unreal) + ' (' + spct1(c.resultPct) + ')' : '–', tone(c.unreal)],
    ['Bijdrage aan dagresultaat', contrib, tone(c.change)],
  ]) + tradeButtons(c) + '</section>';
  const histTile = '<section class="tile pad"><h3>Historie</h3>' + kvList([
    ['Gemeten dagen', S.n ? S.n + ' sinds ' + fDM.format(S.returns[0].t) : '–'],
    ['Gestegen en gedaald', S.n ? S.up + ' en ' + days(S.down) : '–'],
    ['Huidige reeks', streakText(S)],
    ['Beste dag', S.best ? spct(S.best.pct) + ', ' + fD.format(S.best.t) : 'na ' + MIN_DAYS_BEST + ' dagen', S.best ? 'gain' : ''],
    ['Slechtste dag', S.worst ? spct(S.worst.pct) + ', ' + fD.format(S.worst.t) : 'na ' + MIN_DAYS_BEST + ' dagen', S.worst ? 'loss' : ''],
    ['Gemiddeld dagbereik', isNum(c.avgRange) && c.histDays > 1 ? eur(c.avgRange) + ' (' + P1.format(c.avgRangePct || 0) + ')' : 'na 2 dagen'],
    ['Beweeglijkheid', isNum(S.sd) ? '± ' + P1.format(S.sd) + ' per dag' : 'na ' + MIN_DAYS_SD + ' dagen'],
    ['Beweegt mee met portefeuille', corrText(S.corr, S.n)],
    ['Gevoeligheid', isNum(S.beta) ? N2.format(S.beta) + '× de portefeuille' : 'na ' + MIN_DAYS_CORR + ' dagen'],
  ].concat((() => { const r = companyRisk(c); return r ? [['Risicoklasse (1–7)', r.cls + ', ' + RISK_WORDS[r.cls] + ' (' + P1.format(r.vol) + ' per jaar)', r.cls >= 6 ? 'loss' : r.cls <= 4 ? 'gain' : ''],
    ['Aandeel in je risico', isNum(r.contrib) ? P1.format(r.contrib) + ' bij ' + P1.format(c.weight || 0) + ' van de waarde' : '–']] : [['Risicoklasse (1–7)', 'te weinig koershistorie']]; })())) + '</section>';
  return { S, kpis, rangeTile, posTile, histTile, riskTile: companyWhyTile(c), agendaTile: companyAgenda(c), tradeTile: companyTrades(c), market: companyMarket(c), research: companyResearch(c), patterns: patternTiles(c.tk, S) };
}

const FOOT = 'Dagresultaten zijn de verandering ten opzichte van het slot van de vorige handelsdag (of de eerste meting als die er niet is). Dagen die meer dan 25% bewegen, tellen niet mee: dat is bijna altijd een aankoop of verkoop. ' +
  '“Hoogste” en “laagste” zijn gemeten sinds de tracker meet. Koers en aankoopprijs zijn in euro en volgen uit waarde, inleg en aantal. “Beweegt mee” is de correlatie van de dagresultaten met die van je hele portefeuille; “gevoeligheid” geeft aan hoeveel sterker of zwakker het bedrijf meestal beweegt.';
