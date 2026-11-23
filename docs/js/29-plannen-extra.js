/* Investeringstracker – Plannen, deel 2, het deel dat alleen de pagina Plannen nodig heeft: twee plannen
 * vergelijken, bedragen na inflatie, gebeurtenissen in je tijdlijn, uitleg bij de kansberekening, herbalanceren
 * als afvinklijst, dividendinkomen en rendement op inleg, box 3 per jaar met peildatum-export, spaargeld met de
 * hand, netto vermogen, potjes per doel en maandelijks inleggen vanaf een datum.
 *
 * Wordt pas geladen als je Plannen opent (PAGE_SCRIPTS in js/10-navigatie.js), niet bij het starten. Het deel dat
 * altijd nodig is (toestand, vertalingen, begrippen en "jouw jaar in beeld") staat in js/21-plannen2.js.
 * Gewoon script (geen module): het deelt het bereik met de andere bestanden in docs/js/. */
'use strict';
// ---------- Kleine hulpjes ----------
const plxHit = (e, sel) => { const t = /** @type {any} */ (e.target); return t && t.closest ? t.closest(sel) : null; };
const plxEl = (el) => /** @type {any} */ (el);
const plxVal = (el) => (el ? String(plxEl(el).value == null ? '' : plxEl(el).value) : '');
function plxNum(el) { const n = Number(plxVal(el).replace(',', '.')); return isFinite(n) ? n : null; }
const plxSeg = (key, opts, cur, label) => '<div class="seg light" role="group" aria-label="' + esc(label) + '" data-plx-seg="' + esc(key) + '">' +
  opts.map(([k, l]) => '<button type="button" data-k="' + esc(k) + '" aria-pressed="' + (String(cur) === String(k)) + '">' + esc(l) + '</button>').join('') + '</div>';
const plxRid = () => 'x' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
const plxSay = (key, text, cls) => '<span class="small plan-status ' + (cls || '') + '" data-plx-say="' + esc(key) + '" role="status">' + esc(plx.say[key] || text || '') + '</span>';
function plxTell(key, text, cls) {
  plx.say[key] = text;
  const el = document.querySelector('[data-plx-say="' + key + '"]');
  if (el) { el.textContent = text; el.className = 'small plan-status ' + (cls || ''); }
}
// Eerste van deze maand, en het begin van maand k daarna
const plxBase = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; };
const plxTAt = (k) => { const b = plxBase(); return new Date(b.getFullYear(), b.getMonth() + k, 1).getTime(); };
const plxMon = (t) => new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(t);
// Maandnummer vanaf nu voor 'JJJJ-MM'
function plxMonthNr(ym) {
  const a = String(ym || '').slice(0, 7).split('-').map(Number);
  if (a.length < 2 || !isNum(a[0]) || !isNum(a[1])) return null;
  const b = plxBase();
  return (a[0] - b.getFullYear()) * 12 + (a[1] - 1 - b.getMonth());
}

// ---------- 45. Bedragen na inflatie ----------
// Prijsstijging per jaar uit de HICP-reeks van de ECB (laatste twaalf maanden); zonder cijfers een aanname van 2%
function plxInflation() {
  const nl = typeof hicpSeries === 'function' ? hicpSeries('NL') : [];
  if (nl.length >= 13) {
    const last = nl[nl.length - 1];
    const back = nl.find((p) => p.ym === (Number(last.ym.slice(0, 4)) - 1) + last.ym.slice(4));
    if (back && back.v > 0) {
      const r = last.v / back.v - 1;
      if (r > -0.05 && r < 0.3) return { r, src: 'inflatie ' + P1.format(r) + ' per jaar (ECB, twaalf maanden tot ' + fMonY.format(last.t) + ')' };
    }
  }
  return { r: 0.02, src: 'aanname: 2% inflatie per jaar (de cijfers van de ECB zijn nog niet opgehaald)' };
}
const plxRealOn = () => !!userPrefs().realProj;
// Punten omrekenen naar euro's van vandaag (punt k is maand k)
const plxDeflate = (pts, i) => pts.map((p, k) => ({ t: p.t, v: p.v / Math.pow(1 + i, k / 12) }));

// De vooruitblik van Plannen omrekenen als de knop aanstaat (aangeroepen door projection() in 06-plannen.js)
function planRealView(P) {
  const I = plxInflation();
  if (!plxRealOn()) return Object.assign({}, P, { real: false, infl: I.r, inflSrc: I.src });
  const f = (k) => Math.pow(1 + I.r, k / 12);
  const sets = P.sets.map((x) => {
    const pts = plxDeflate(x.pts, I.r);
    let reached = null;
    if (P.goal) {
      const hit = pts.find((p) => p.v >= P.goal);
      if (hit) reached = hit.t;
      else {
        const rm = Math.pow(1 + x.r, 1 / 12) - 1;
        let v = x.pts[x.pts.length - 1].v;
        for (let k = pts.length; k <= 720; k++) { v = v * (1 + rm) + P.monthly; if (v / f(k) >= P.goal) { reached = plxTAt(k); break; } }
      }
    }
    return Object.assign({}, x, { pts, end: pts[pts.length - 1].v, reached });
  });
  return Object.assign({}, P, { sets, dep: plxDeflate(P.dep, I.r), real: true, infl: I.r, inflSrc: I.src });
}
// Knop bij de vooruitblik (zowel de HTML- als de componentenversie gebruikt deze)
function plxRealToggle() {
  return '<label class="check small plx-real"><input type="checkbox" data-plx-real' + (plxRealOn() ? ' checked' : '') + '> ' +
    'Bedragen in euro’s van vandaag (' + (plxRealOn() ? '' : 'na ') + 'inflatie)</label>';
}
function plxRealNote(P) {
  const I = plxInflation();
  return P && P.real
    ? 'Alle bedragen hierboven zijn omgerekend naar euro’s van vandaag: ' + I.src + '. Kosten en belasting zijn niet meegenomen.'
    : 'Kosten, belasting en inflatie zijn niet meegenomen. Zet de knop aan om de bedragen in euro’s van vandaag te zien (' + I.src + ').';
}

// ---------- Pad vooruit rekenen, met gebeurtenissen ----------
// o: { start, monthly, r, months, events: [{ m, amount, pause }] }
function plxPath(o) {
  const rm = Math.pow(1 + o.r, 1 / 12) - 1;
  const ev = o.events || [];
  let v = o.start;
  const pts = [{ t: plxTAt(0), v }];
  for (let k = 1; k <= o.months; k++) {
    let add = o.monthly;
    ev.forEach((e) => { if (e.pause > 0 && k > e.m && k <= e.m + e.pause) add = 0; });
    v = v * (1 + rm) + add;
    ev.forEach((e) => {
      if (!(e.amount > 0) || e.m !== k) return;
      const take = Math.min(v, e.amount);
      if (o.hits) o.hits.push({ id: e.id, m: k, before: v, taken: take, short: e.amount - take });
      v -= take;
    });
    pts.push({ t: plxTAt(k), v });
  }
  return pts;
}
const plxEnd = (pts) => (pts.length ? pts[pts.length - 1].v : 0);
const plxMaybeReal = (pts) => (plxRealOn() ? plxDeflate(pts, plxInflation().r) : pts);
const plxMonthlyNow = () => {
  const m = isNum(plan.monthly) ? plan.monthly : isNum(M.settings.monthly) ? M.settings.monthly : monthlyGuess();
  return Math.max(0, Math.round(m));
};

// ---------- 44. Twee plannen naast elkaar ----------
function plxCmpModel() {
  const base = plxMonthlyNow();
  const years = Math.max(1, Math.min(40, plan.years || 10));
  const a = isNum(plx.cmpA) ? plx.cmpA : base;
  const b = isNum(plx.cmpB) ? plx.cmpB : base + 100;
  const start = M.accountNow || 0;
  const mk = (monthly, r) => {
    const pts = plxMaybeReal(plxPath({ start, monthly, r, months: years * 12 }));
    return { monthly, r, pts, end: plxEnd(pts), paid: monthly * years * 12 };
  };
  return { A: mk(a, plx.cmpRa), B: mk(b, plx.cmpRb), years, start, real: plxRealOn() };
}
function plxCmpTile() {
  const K = plxCmpModel();
  const steps = [5, 10, 20, 30].filter((y) => y <= K.years);
  if (!steps.length || steps[steps.length - 1] !== K.years) steps.push(K.years);
  const at = (P, y) => (P.pts[y * 12] ? P.pts[y * 12].v : plxEnd(P.pts));
  const dEnd = K.B.end - K.A.end, dPaid = K.B.paid - K.A.paid;
  const col = (P, label, color, key) => '<div><span class="muted small"><i class="plx-dot" style="background:' + color + '"></i>' + esc(label) + '</span>' +
    '<label class="plx-inl">Inleg per maand<span class="eur-in">€<input type="number" inputmode="decimal" min="0" step="25" value="' + esc(String(Math.round(P.monthly))) + '" data-plx-cmp="' + key + '" aria-label="' + esc('Inleg per maand voor ' + label) + '"></span></label>' +
    plxSeg('cmpR' + key, [[0.04, '4%'], [0.07, '7%'], [0.1, '10%']], P.r, 'Rendement per jaar voor ' + label) +
    '<b class="v big">' + esc(eur(P.end)) + '</b><span class="muted small">na ' + K.years + ' jaar, zelf ingelegd ' + esc(eur(P.paid)) + '</span></div>';
  return '<section class="tile pad full plx-cmp"><div class="plan-head"><h3>Twee plannen naast elkaar</h3>' +
    plxSeg('cmpYears', [5, 10, 20, 30].map((y) => [y, y + ' jaar']), K.years, 'Aantal jaren') + '</div>' +
    '<p class="sub">Vergelijk bijvoorbeeld € 200 per maand met € 300 per maand. Beide plannen beginnen bij je accountwaarde nu (' + esc(eur(K.start)) + ').</p>' +
    '<div class="plx-cols">' + col(K.A, 'Plan A', C.accent, 'a') + col(K.B, 'Plan B', C.gain, 'b') + '</div>' +
    '<div class="chart" data-chart="plxcmp" style="height:200px"></div><div class="xlabels" data-x="plxcmp"></div>' +
    '<div class="legend chart-legend" style="margin-top:6px"><span><i style="background:' + C.accent + '"></i>Plan A</span><span><i style="background:' + C.gain + '"></i>Plan B</span></div>' +
    '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Na</th><th class="num">Plan A</th><th class="num">Plan B</th><th class="num">Verschil</th></tr></thead><tbody>' +
    steps.map((y) => '<tr><td>' + y + ' jaar</td><td class="num">' + esc(eur(at(K.A, y))) + '</td><td class="num">' + esc(eur(at(K.B, y))) + '</td>' +
      '<td class="num ' + tone(at(K.B, y) - at(K.A, y)) + '">' + esc(seur(at(K.B, y) - at(K.A, y))) + '</td></tr>').join('') + '</tbody></table></div>' +
    kvList([
      ['Verschil na ' + K.years + ' jaar', seur(dEnd), tone(dEnd)],
      ['Verschil in eigen inleg', seur(dPaid)],
      ['Per extra ingelegde euro', Math.abs(dPaid) > 1 ? eur(dEnd / dPaid) + ' eindwaarde' : '–'],
    ]) +
    plxRealToggle() +
    '<p class="sub" style="margin-top:8px">Vaste rendementen als rekenvoorbeeld: in werkelijkheid schommelt het rendement per jaar en kan het ook negatief zijn. ' + esc(plxRealNote(K.real ? { real: true } : null)) + ' Geen beleggingsadvies.</p></section>';
}
function plxDrawCmp(root) {
  const host = root.querySelector('[data-chart="plxcmp"]');
  if (!host) return;
  const K = plxCmpModel();
  lineChart(host, [{ pts: K.A.pts, color: C.accent, width: 3, label: 'Plan A' }, { pts: K.B.pts, color: C.gain, width: 3, label: 'Plan B' }],
    { top: 0.06, bottom: 0.04, xl: root.querySelector('[data-x="plxcmp"]'), xcount: 4, xfmt: (t) => fYear(t), tfmt: (t) => fMonY.format(t) });
}

// ---------- 46. Gebeurtenissen in je tijdlijn ----------
const plxEvents = () => (userPrefs().lifeEvents || []).filter((e) => e && e.name && plxMonthNr(e.date) != null)
  .map((e) => ({ id: e.id || plxRid(), name: String(e.name), date: String(e.date).slice(0, 7), amount: Math.max(0, Number(e.amount) || 0), pause: Math.max(0, Math.min(120, Math.round(Number(e.pause) || 0))) }));
function plxEventModel() {
  const years = Math.max(1, Math.min(40, plan.years || 10));
  const months = years * 12;
  const start = M.accountNow || 0, monthly = plxMonthlyNow(), r = 0.07;
  const list = plxEvents().map((e) => Object.assign({}, e, { m: plxMonthNr(e.date) })).filter((e) => e.m >= 1 && e.m <= months).sort((a, b) => a.m - b.m);
  const hits = [];
  const basePts = plxMaybeReal(plxPath({ start, monthly, r, months }));
  const withPts = plxMaybeReal(plxPath({ start, monthly, r, months, events: list, hits }));
  const each = list.map((e) => {
    const only = plxMaybeReal(plxPath({ start, monthly, r, months, events: [e] }));
    const hit = hits.find((h) => h.id === e.id) || null;
    return Object.assign({}, e, { cost: plxEnd(basePts) - plxEnd(only), short: hit ? hit.short : 0, before: hit ? hit.before : null });
  });
  return { years, months, list: each, basePts, withPts, base: plxEnd(basePts), after: plxEnd(withPts), all: plxEvents(), r, monthly };
}
function plxEventRow(e) {
  return '<div class="h-row plx-ev-row" data-plx-ev="' + esc(e.id || '') + '">' +
    '<input aria-label="Naam van de gebeurtenis" data-e="name" maxlength="40" value="' + esc(e.name || '') + '" placeholder="Bijv. huis, studie, auto">' +
    '<input aria-label="Wanneer" data-e="date" type="month" value="' + esc(e.date ? String(e.date).slice(0, 7) : '') + '">' +
    '<input aria-label="Opname in euro" data-e="amount" type="number" min="0" step="500" value="' + esc(isNum(e.amount) && e.amount ? String(e.amount) : '') + '" placeholder="Opname €">' +
    '<input aria-label="Inleg pauzeren, aantal maanden" data-e="pause" type="number" min="0" max="120" step="1" value="' + esc(isNum(e.pause) && e.pause ? String(e.pause) : '') + '" placeholder="Pauze mnd">' +
    '<span></span><button type="button" class="icon-x" data-plx="ev-rm" aria-label="Gebeurtenis verwijderen">×</button></div>';
}
function plxEventTile() {
  const E = plxEventModel();
  const diff = E.after - E.base;
  return '<section class="tile pad full plx-ev"><h3>Gebeurtenissen in je tijdlijn</h3>' +
    '<p class="sub">Zet grote uitgaven in je vooruitblik: een huis, een studie of een auto. Je kunt een bedrag opnemen en je inleg een tijd pauzeren, en zo zien wat dat op lange termijn kost.</p>' +
    (E.list.length ? '<div class="chart" data-chart="plxev" style="height:190px"></div><div class="xlabels" data-x="plxev"></div>' +
      '<div class="legend chart-legend" style="margin-top:6px"><span><i style="background:' + C.ink2 + '"></i>Zonder gebeurtenissen</span><span><i style="background:' + C.accent + '"></i>Met gebeurtenissen</span></div>' +
      '<div class="scen-res" style="margin-top:10px"><div><span class="muted small">Na ' + E.years + ' jaar zonder</span><b class="v big">' + esc(eur(E.base)) + '</b></div>' +
      '<div><span class="muted small">Met jouw gebeurtenissen</span><b class="v big">' + esc(eur(E.after)) + '</b></div>' +
      '<div><span class="muted small">Verschil</span><b class="v big ' + tone(diff) + '">' + esc(seur(diff)) + '</b><span class="muted small">inclusief het rendement dat je misloopt</span></div></div>' +
      '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Gebeurtenis</th><th>Wanneer</th><th class="num">Opname</th><th class="num">Inleg pauzeren</th><th class="num">Kost je na ' + E.years + ' jaar</th></tr></thead><tbody>' +
      E.list.map((e) => '<tr><td><b>' + esc(e.name) + '</b>' + (e.short > 1 ? '<span class="sub loss">' + esc(eur(e.short)) + ' meer dan je dan hebt</span>' : '') + '</td>' +
        '<td>' + esc(plxMon(plxTAt(e.m))) + '</td><td class="num">' + esc(e.amount ? eur(e.amount) : '–') + '</td>' +
        '<td class="num">' + esc(e.pause ? e.pause + (e.pause === 1 ? ' maand' : ' maanden') : '–') + '</td><td class="num loss">' + esc(eur(e.cost)) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      (E.list.some((e) => e.short > 1) ? '<p class="small loss" style="margin-top:6px">Een opname kan niet groter zijn dan wat er dan staat: wat erboven zit, is hierboven niet meegerekend. Een echte opname zou je dan uit ander geld moeten halen.</p>' : '') +
      (E.list.length > 1 ? '<p class="small muted" style="margin-top:6px">De bedragen in de laatste kolom gelden per gebeurtenis los van de andere; bij elkaar optellen kan niet, omdat ze over hetzelfde geld gaan.</p>' : '')
      : '<p class="muted">Nog geen gebeurtenissen. Voeg er een toe om het effect te zien.</p>') +
    '<details class="acct plx-evform"' + (E.list.length ? '' : ' open') + '><summary><b>Gebeurtenissen bewerken</b><span></span><span></span></summary><div class="goal-form" data-plx-evform>' +
    '<div class="plx-ev-rows">' + E.all.concat([{ id: '', name: '', date: '', amount: 0, pause: 0 }]).map(plxEventRow).join('') + '</div>' +
    '<div class="plan-actions" style="margin-top:8px"><button type="button" class="btn ghost" data-plx="ev-add">Gebeurtenis toevoegen</button>' +
    '<button type="button" class="btn primary" data-plx="ev-save">Opslaan</button>' + plxSay('ev', '') + '</div></div></details>' +
    plxRealToggle() +
    '<p class="sub" style="margin-top:8px">Gerekend met 7% per jaar en ' + esc(eur(E.monthly)) + ' inleg per maand (het gemiddelde scenario van de vooruitblik). Een opname wordt in die maand van je waarde afgehaald; bij een pauze stort je die maanden niets. Rekenvoorbeeld, geen beleggingsadvies.</p></section>';
}
function plxDrawEvents(root) {
  const host = root.querySelector('[data-chart="plxev"]');
  if (!host) return;
  const E = plxEventModel();
  lineChart(host, [{ pts: E.basePts, color: C.ink2, dash: true, width: 2, label: 'Zonder' }, { pts: E.withPts, color: C.accent, width: 3, label: 'Met gebeurtenissen' }],
    { top: 0.06, bottom: 0.04, xl: root.querySelector('[data-x="plxev"]'), xcount: 4, xfmt: (t) => fYear(t), tfmt: (t) => fMonY.format(t) });
}

// ---------- 47. Wat betekent 90% kans? (fan-grafiek met uitleg) ----------
// Deze functie draait in een Web Worker (runOffThread) en mag dus niets van buiten gebruiken
function plxFanSim(o) {
  let s = o.seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const mu = Math.log(1 + o.mu) / 12, sig = o.sigma / Math.sqrt(12);
  const step = 3, keep = Math.floor(o.months / step) + 1;
  const paths = Array.from({ length: keep }, () => new Float64Array(o.runs));
  const dep = o.start + o.monthly * o.months;
  let above = 0, goalHit = 0, loss = 0;
  for (let r = 0; r < o.runs; r++) {
    let v = o.start, hit = false;
    paths[0][r] = v;
    for (let m = 1; m <= o.months; m++) {
      v = v * Math.exp(mu - sig * sig / 2 + sig * gauss()) + o.monthly;
      if (o.goal > 0 && !hit && v >= o.goal) hit = true;
      if (m % step === 0) paths[m / step][r] = v;
    }
    if (v >= dep) above++;
    if (v < o.start) loss++;
    if (hit) goalHit++;
  }
  const pct = (a, q) => { const b = Array.from(a).sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };
  const band = paths.map((a, i) => ({ m: i * step, q5: pct(a, 0.05), q10: pct(a, 0.1), q25: pct(a, 0.25), q50: pct(a, 0.5), q75: pct(a, 0.75), q90: pct(a, 0.9), q95: pct(a, 0.95) }));
  return { band, above: above / o.runs, loss: loss / o.runs, goalProb: o.goal > 0 ? goalHit / o.runs : null, dep, runs: o.runs };
}
function plxFanInput() {
  const R = typeof ratiosFor === 'function' ? ratiosFor(TOTAL) : null;
  const sigma = R && isNum(R.vol) ? Math.max(0.08, Math.min(0.35, R.vol)) : 0.16;
  const years = Math.max(1, Math.min(40, plan.years || 10));
  const goal = isNum(plan.goal) && plan.goal > 0 ? plan.goal : isNum(M.settings.goal) && M.settings.goal > 0 ? M.settings.goal : 0;
  return { start: M.accountNow || 0, monthly: plxMonthlyNow(), months: years * 12, mu: 0.07, sigma: Math.round(sigma * 1000) / 1000, runs: 2000, seed: 20261118, goal, own: !!(R && isNum(R.vol)) };
}
function plxFanBand(R) {
  if (!plxRealOn()) return R.band;
  const i = plxInflation().r;
  return R.band.map((b) => { const f = Math.pow(1 + i, b.m / 12); return { m: b.m, q5: b.q5 / f, q10: b.q10 / f, q25: b.q25 / f, q50: b.q50 / f, q75: b.q75 / f, q90: b.q90 / f, q95: b.q95 / f }; });
}
function plxFanTile() {
  const I = plxFanInput();
  const key = JSON.stringify(I);
  if (plx.fanKey !== key && !plx.fanBusy) {
    plx.fanBusy = true;
    runOffThread(plxFanSim, I, 'fan', key).then((res) => { plx.fanRes = res; plx.fanKey = key; plx.fanBusy = false; refresh('plan'); });
  }
  const R = plx.fanKey === key ? plx.fanRes : null;
  const years = Math.round(I.months / 12);
  const dots = R ? Math.max(0, Math.min(100, Math.round(R.above * 100))) : 0;
  const band = R ? plxFanBand(R) : null;
  const end = band ? band[band.length - 1] : null;
  return '<section class="tile pad full plx-fan"><h3>Wat betekent 90% kans?</h3>' +
    (R ? '<div class="chart" data-chart="plxfan" style="height:200px"></div><div class="xlabels" data-x="plxfan"></div>' +
      '<div class="legend chart-legend" style="margin-top:6px"><span><i style="background:' + C.accent + '"></i>Middelste uitkomst</span><span><i style="background:' + C.soft + '"></i>Helft van de uitkomsten</span><span><i class="dash"></i>9 van de 10 uitkomsten</span></div>' +
      '<p class="small" style="margin-top:8px">Na ' + years + ' jaar eindigde de middelste van de ' + NI.format(R.runs) + ' doorgerekende toekomsten op <b>' + esc(eur(end.q50)) + '</b>. ' +
      'De helft kwam uit tussen ' + esc(eur(end.q25)) + ' en ' + esc(eur(end.q75)) + '; negen van de tien tussen <b>' + esc(eur(end.q5)) + '</b> en <b>' + esc(eur(end.q95)) + '</b>.</p>' +
      '<div class="plx-dots" role="img" aria-label="' + esc(dots + ' van de 100 doorgerekende toekomsten eindigden boven je totale inleg') + '">' +
      Array.from({ length: 100 }, (unused, k) => '<i class="' + (k < dots ? 'on' : '') + '"></i>').join('') + '</div>' +
      '<p class="small">In <b>' + dots + ' van de 100</b> toekomsten was je eindwaarde hoger dan je totale inleg van ' + esc(eur(R.dep)) + '. In ' + esc(NI.format(R.loss * 100)) + ' van de 100 stond je na ' + years + ' jaar lager dan je nu staat.</p>' +
      (isNum(R.goalProb) ? '<p class="small">Je doelbedrag van ' + esc(eur(I.goal)) + ' werd in <b>' + esc(NI.format(R.goalProb * 100)) + ' van de 100</b> toekomsten gehaald.</p>' : '')
      : '<p class="muted">Bezig met rekenen (2.000 mogelijke toekomsten)…</p>') +
    '<details class="acct" style="margin-top:10px"><summary><b>Wat zegt zo’n percentage wel en niet?</b><span></span><span></span></summary>' +
    '<div class="plx-uitleg"><p class="small">De tracker rekent ' + NI.format(I.runs) + ' keer een toekomst door. Elke maand krijgt een willekeurig rendement rond gemiddeld 7% per jaar, met de schommeling van ' +
    esc(P1.format(I.sigma)) + ' per jaar ' + (I.own ? '(gemeten aan je eigen portefeuille)' : '(aangenomen)') + '. Daarna worden de uitkomsten op een rij gezet.</p>' +
    '<p class="small"><b>“90% kans” betekent:</b> in 9 van de 10 doorgerekende toekomsten lukte het, in 1 van de 10 niet. Het is geen garantie en ook geen voorspelling: het is de uitkomst van dit rekenmodel.</p>' +
    '<p class="small"><b>Wat het model niet weet:</b> echte beurzen dalen soms jaren achter elkaar en bewegingen hangen samen (een slecht jaar volgt vaker op een slecht jaar). Zulke reeksen komen er in dit model te weinig uit, dus de slechtste uitkomsten zijn in het echt nog wat slechter. Kosten, belasting' + (plxRealOn() ? '' : ' en inflatie') + ' zitten er niet in.</p>' +
    '<p class="small"><b>Wat je er wél mee kunt:</b> zien hoe breed de uitkomsten uiteenlopen, en wat meer inleggen of langer doorgaan met die breedte doet. Niet: er een bedrag aan vastpinnen.</p></div></details>' +
    plxRealToggle() +
    '<p class="sub" style="margin-top:8px">Rekenvoorbeeld, geen belofte en geen beleggingsadvies.' + (plxRealOn() ? ' Bedragen in euro’s van vandaag (' + esc(plxInflation().src) + ').' : '') + '</p></section>';
}
function plxDrawFan(root) {
  const host = root.querySelector('[data-chart="plxfan"]');
  const R = plx.fanRes;
  if (!host || !R) return;
  const band = plxFanBand(R);
  const pick = (k) => band.map((b) => ({ t: plxTAt(b.m), v: b[k] }));
  lineChart(host, [{ pts: pick('q95'), color: C.ink2, dash: true, width: 1.5, label: 'Gunstig (1 op 20)' },
    { pts: pick('q75'), color: C.soft, width: 2, label: 'Boven de helft' },
    { pts: pick('q50'), color: C.accent, width: 3, label: 'Midden' },
    { pts: pick('q25'), color: C.soft, width: 2, label: 'Onder de helft' },
    { pts: pick('q5'), color: C.ink2, dash: true, width: 1.5, label: 'Ongunstig (1 op 20)' }],
  { top: 0.06, bottom: 0.04, xl: root.querySelector('[data-x="plxfan"]'), xcount: 4, xfmt: (t) => fYear(t), tfmt: (t) => fMonY.format(t) });
}

// ---------- 48. Herbalanceren als afvinklijst ----------
const plxRebKey = (R, r) => R.mode + '|' + r.x.key + '|' + (r.d < 0 ? 'v' : 'k') + Math.round(Math.abs(r.d));
const plxRebDone = () => userPrefs().rebDone || {};
function plxRebText(R) {
  const L = ['Herbalanceren (Investeringstracker, geen beleggingsadvies)'];
  R.rows.forEach((r) => L.push((r.d < 0 ? 'Verkoop ' : 'Koop ') + eur(Math.abs(r.d)) + ' ' + r.x.label + ' (nu ' + eur(r.x.v) + ', doel ' + eur(r.want) + ')'));
  if (R.short > 1) L.push('Nog nodig voor de aankopen: ' + eur(R.short));
  L.push('Zelf invoeren bij je broker; deze lijst plaatst geen orders.');
  return L.join('\n');
}
function plxRebalTile() {
  const R = typeof rebalanceModel === 'function' ? rebalanceModel() : null;
  if (!R) return '<section class="tile pad"><h3>Herbalanceren als afvinklijst</h3><p class="muted">Stel eerst een streefverdeling in (bovenaan Plannen); daarna staan hier de stappen om af te vinken.</p></section>';
  const done = plxRebDone();
  const rows = R.rows;
  const n = rows.filter((r) => done[plxRebKey(R, r)]).length;
  return '<section class="tile pad plx-reb"><h3>Herbalanceren als afvinklijst</h3>' +
    (rows.length
      ? '<p class="sub">Vink af wat je bij je broker hebt ingevoerd. De lijst onthoudt wat je al deed, ook op je andere apparaten.</p>' +
        '<div class="meter"><div style="width:' + (rows.length ? (n / rows.length * 100).toFixed(1) : 0) + '%"></div></div>' +
        '<p class="small" style="margin-top:4px">' + n + ' van ' + rows.length + ' stappen gedaan' + (n === rows.length ? ': klaar.' : '.') + '</p>' +
        '<ol class="plx-steps">' + rows.map((r) => { const k = plxRebKey(R, r); const on = !!done[k];
          return '<li class="' + (on ? 'done' : '') + '"><label class="check"><input type="checkbox" data-plx-reb="' + esc(k) + '"' + (on ? ' checked' : '') + '>' +
            '<span class="tag ' + (r.d < 0 ? 'loss' : 'gain') + '">' + (r.d < 0 ? 'Verkoop' : 'Koop') + '</span> <b>' + esc(eur(Math.abs(r.d))) + '</b> ' + esc(r.x.label) +
            '<span class="sub">nu ' + esc(eur(r.x.v)) + ', doel ' + esc(eur(r.want)) + (r.fee ? ' · ± ' + esc(eur(r.fee)) + ' wisselkosten' : '') + '</span></label></li>'; }).join('') + '</ol>' +
        (R.short > 1 ? '<p class="small">Voor de aankopen is nog <b>' + esc(eur(R.short)) + '</b> nodig: nieuwe inleg, je vrije saldo, of eerst de verkopen laten afrekenen.</p>' : '') +
        '<div class="plan-actions" style="margin-top:10px"><button type="button" class="btn ghost" data-plx="reb-copy">Lijst kopiëren</button>' +
        '<button type="button" class="btn ghost" data-plx="reb-reset">Opnieuw beginnen</button>' + plxSay('reb', '') + '</div>'
      : '<p class="small gain">Je zit binnen 1 procentpunt van je streefverdeling: er is niets af te vinken.</p>') +
    '<p class="sub" style="margin-top:8px"><b>Deze lijst plaatst nooit zelf orders.</b> De tracker kijkt alleen mee; je voert elke order zelf in bij Trading 212. De stappen volgen uit je streefverdeling en de instellingen bij “Herbalanceren met verkopen”. Rekenvoorbeeld, geen beleggingsadvies.</p></section>';
}

// ---------- 70. Dividendinkomen per maand en rendement op inleg ----------
function plxDivIncome() {
  const F = typeof divForecast === 'function' ? divForecast() : null;
  if (!F) return null;
  const rows = F.info.map((x) => {
    const c = x.c;
    const cost = isNum(c.cost) && c.cost > 0 ? c.cost : null;
    return { tk: c.tk, name: c.name, total: x.total, gap: x.gap, next: x.next, cost, value: c.value,
      yoc: cost ? x.total / cost : null, yov: isNum(c.value) && c.value > 0 ? x.total / c.value : null };
  }).filter((x) => x.total > 0.004).sort((a, b) => (b.yoc || 0) - (a.yoc || 0));
  const cost = sum(M.companies.map((c) => (isNum(c.cost) ? c.cost : 0)));
  const months = F.months;
  const best = months.reduce((b, m) => (!b || m.v > b.v ? m : b), null);
  return { rows, months, total: F.total, cost, yoc: cost > 0 ? F.total / cost : null, yov: M.totalValue ? F.total / M.totalValue : null, best, received12: (M.ev && M.ev.last12) || 0 };
}
function plxDivIncomeTile() {
  const D = plxDivIncome();
  if (!D || !D.rows.length) return '<section class="tile pad full"><h3>Dividendinkomen per maand</h3><p class="muted">Nog geen dividend ontvangen of aangekondigd. Zodra je eerste uitkeringen binnen zijn, staat hier wat je per maand kunt verwachten en wat dat is op je inleg.</p></section>';
  const half = Math.ceil(D.months.length / 2);
  return '<section class="tile pad full plx-div"><h3>Dividendinkomen per maand</h3>' +
    '<div class="scen-res"><div><span class="muted small">Verwacht komende 12 maanden</span><b class="v big">' + esc(eur(D.total)) + '</b><span class="muted small">ongeveer ' + esc(eur(D.total / 12)) + ' per maand</span></div>' +
    '<div><span class="muted small">' + trm('Rendement op inleg', 'yoc') + '</span><b class="v big">' + esc(isNum(D.yoc) ? P2.format(D.yoc) : '–') + '</b><span class="muted small">op ' + esc(eur(D.cost)) + ' inleg</span></div>' +
    '<div><span class="muted small">Op je huidige waarde</span><b class="v big">' + esc(isNum(D.yov) ? P2.format(D.yov) : '–') + '</b><span class="muted small">laatste 12 maanden ontvangen: ' + esc(eur(D.received12)) + '</span></div></div>' +
    '<div style="margin-top:12px">' + bars(D.months.map((m) => ({ v: m.v, color: C.gain, tip: fMonY.format(m.t) + ': ' + eur(m.v) + (m.tks.length ? ' (' + m.tks.join(', ') + ')' : '') })), true) +
    barLabels(D.months.map((m) => fMon.format(m.t).replace('.', ''))) + '</div>' +
    '<div class="plx-months">' + [0, 1].map((half2) => '<ul class="plx-mlist">' + D.months.slice(half2 * half, half2 * half + half).map((m) =>
      '<li><span>' + esc(fMonY.format(m.t)) + '</span><b>' + esc(eur(m.v)) + '</b><span class="muted small">' + esc(m.tks.join(', ') || '–') + '</span></li>').join('') + '</ul>').join('') + '</div>' +
    '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Aandeel</th><th>Uitkering</th><th class="num">Komende 12 mnd</th><th class="num">Op inleg</th><th class="num">Op waarde</th></tr></thead><tbody>' +
    D.rows.map((x) => '<tr class="rowlink" data-ticker="' + esc(x.tk) + '"><td class="co"><b>' + esc(x.tk) + '</b><span class="nm">' + esc(x.name) + '</span></td>' +
      '<td>' + esc(freqWord(x.gap)) + '</td><td class="num">' + esc(eur(x.total)) + '</td>' +
      '<td class="num">' + esc(isNum(x.yoc) ? P2.format(x.yoc) : '–') + '</td><td class="num">' + esc(isNum(x.yov) ? P2.format(x.yov) : '–') + '</td></tr>').join('') +
    '</tbody></table></div>' +
    (D.best ? '<p class="small" style="margin-top:8px">Je drukste maand is ' + esc(fMonY.format(D.best.t)) + ' met ongeveer ' + esc(eur(D.best.v)) + '.</p>' : '') +
    '<p class="sub" style="margin-top:6px">Verwacht uit je eerdere uitkeringen (zelfde tussenpoos, bedrag naar je huidige aantal) en aangekondigde dividenden; netto zoals je ze ontving. Rendement op inleg rekent met wat je voor de aandelen betaalde, niet met de koers van nu. Een bedrijf kan het dividend altijd verlagen of overslaan.</p></section>';
}

// ---------- 71. Box 3 per jaar: peildatum-export en ingehouden bronbelasting ----------
function plxTaxModel(Y) {
  const B = typeof box3Model === 'function' ? box3Model(Y) : null;
  if (!B) return null;
  const jan = new Date(Y, 0, 1).getTime();
  const other = (typeof accts === 'function' ? accts() : []).map((a) => ({ name: a.name + (a.broker ? ' (' + a.broker + ')' : ''), v: acctTotal(a), updated: a.updated || null }));
  const banks = plxBanks().map((b) => ({ name: b.name, v: b.amount, updated: b.updated || null }));
  const value = B.peil ? B.peil.total : B.near ? B.near.accountValue : null;
  return { Y, B, jan, other, banks, value, exact: !!B.peil,
    positions: (B.peil && B.peil.positions) || [], tax: B.tax, gross: B.gross, net: B.net, byCur: B.byCur, est: B.est };
}
function plxTaxText(X) {
  const L = ['Peildatum-overzicht 1 januari ' + X.Y + ' (Investeringstracker; hulpmiddel, geen fiscaal document)'];
  L.push('Trading 212 totaal: ' + (isNum(X.value) ? eur(X.value) : 'onbekend') + (X.exact ? ' (vastgelegd op de peildatum)' : ' (geschat uit de weekmeting rond 1 januari)'));
  if (X.B.peil) { L.push('  beleggingen: ' + eur(X.B.peil.investments)); L.push('  vrij saldo: ' + eur(X.B.peil.cash)); }
  X.other.forEach((a) => L.push('Andere rekening (eigen invoer) ' + a.name + ': ' + eur(a.v) + (a.updated ? ' (stand ' + a.updated + ')' : '')));
  X.banks.forEach((b) => L.push('Spaar- of betaalrekening (eigen invoer) ' + b.name + ': ' + eur(b.v) + (b.updated ? ' (stand ' + b.updated + ')' : '')));
  L.push('Ontvangen dividend ' + X.Y + ' (netto): ' + eur(X.net));
  L.push('Bruto dividend' + (X.est ? ' (deels geschat)' : '') + ': ' + eur(X.gross));
  L.push('Ingehouden buitenlandse bronbelasting' + (X.est ? ' (deels geschat)' : '') + ': ' + eur(X.tax));
  X.byCur.forEach((v, cur) => { if (v > 0.004) L.push('  waarvan ' + (CUR_LAND[cur] || cur) + ': ' + eur(v)); });
  L.push('Voor de aangifte: gebruik het jaaroverzicht van Trading 212. Dit overzicht is geen belastingadvies.');
  return L.join('\n');
}
function plxTaxTile() {
  const ys = typeof box3Years === 'function' ? box3Years() : [new Date().getFullYear()];
  if (!plx.taxYear || !ys.includes(plx.taxYear)) plx.taxYear = ys.includes(new Date().getFullYear() - 1) ? new Date().getFullYear() - 1 : ys[0];
  const X = plxTaxModel(plx.taxYear);
  if (!X) return '';
  const cur = [];
  X.byCur.forEach((v, c) => { if (v > 0.004) cur.push([c, v]); });
  cur.sort((a, b) => b[1] - a[1]);
  const extra = X.other.concat(X.banks);
  return '<section class="tile pad full plx-tax"><div class="plan-head"><h3>Box 3 per jaar</h3>' +
    plxSeg('taxYear', ys.map((y) => [y, String(y)]), plx.taxYear, 'Belastingjaar') + '</div>' +
    '<p class="sub">Alles bij elkaar wat je voor de aangifte over dit jaar nodig hebt: je stand op de ' + trm('peildatum', 'peildatum') + ' van 1 januari en de buitenlandse bronbelasting die van je dividend is afgehaald.</p>' +
    '<div class="scen-res"><div><span class="muted small">Trading 212 op 1 januari ' + X.Y + '</span><b class="v big">' + esc(isNum(X.value) ? eur(X.value) : '–') + '</b>' +
    '<span class="muted small">' + esc(X.exact ? 'vastgelegd door de Worker op de peildatum' : X.B.near ? 'geschat uit de weekmeting van ' + fD.format(X.B.near.t) : 'geen meting rond 1 januari ' + X.Y) + '</span></div>' +
    '<div><span class="muted small">Ontvangen dividend ' + X.Y + '</span><b class="v big">' + esc(eur(X.net)) + '</b><span class="muted small">netto, bruto ' + esc(eur(X.gross)) + '</span></div>' +
    '<div><span class="muted small">Ingehouden bronbelasting</span><b class="v big">' + esc(eur(X.tax)) + '</b><span class="muted small">' + (X.est ? 'deels geschat' : 'uit je gegevens') + '</span></div></div>' +
    (cur.length ? '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Land</th><th class="num">Ingehouden bronbelasting</th></tr></thead><tbody>' +
      cur.map(([c, v]) => '<tr><td>' + esc(CUR_LAND[c] || c) + '</td><td class="num">' + esc(eur(v)) + '</td></tr>').join('') + '</tbody></table></div>'
      : '<p class="small muted" style="margin-top:10px">Geen bronbelasting gevonden voor ' + X.Y + '.</p>') +
    (X.positions.length ? '<p class="small" style="margin-top:8px">De peildatum-export bevat ook de ' + X.positions.length + ' posities van die dag.</p>' : '') +
    (extra.length ? '<div style="margin-top:10px">' + kvList(extra.map((a) => [a.name + (a.updated ? ' (stand ' + a.updated + ')' : ''), eur(a.v)])) +
      '<p class="small muted">Deze rekeningen zijn je eigen invoer en worden niet automatisch bijgewerkt: vul zelf de stand van 1 januari in voordat je exporteert.</p></div>'
      : '<p class="small muted" style="margin-top:8px">Heb je spaargeld of een andere broker? Vul die hieronder in bij “Spaargeld en contant”; ze tellen in box 3 ook mee.</p>') +
    '<div class="plan-actions" style="margin-top:12px"><button type="button" class="btn ghost" data-plx="tax-copy">Overzicht kopiëren</button>' +
    '<button type="button" class="btn ghost" data-plx="tax-csv">Peildatum als CSV</button><button type="button" class="btn ghost" data-plx="tax-div">Dividend en bronbelasting als CSV</button>' + plxSay('tax', '') + '</div>' +
    '<p class="sub" style="margin-top:8px"><b>Dit is een hulpmiddel, geen belastingadvies.</b> Box 3 kijkt naar al je vermogen op 1 januari, dus ook naar spaargeld en beleggingen buiten deze tracker, en naar schulden. Bruto dividend en bronbelasting komen uit je Trading 212-gegevens en de ECB-koers van die dag; waar die ontbreken is gerekend met het gebruikelijke tarief. Of je buitenlandse bronbelasting kunt verrekenen, hangt van je situatie af. Gebruik voor de aangifte het jaaroverzicht van Trading 212 en controleer de regels bij de Belastingdienst.</p></section>';
}

// ---------- 72. Spaargeld en contant (eigen invoer) ----------
const PLX_BANK_KINDS = [['spaar', 'Spaarrekening'], ['deposito', 'Deposito'], ['betaal', 'Betaalrekening'], ['contant', 'Contant geld'], ['overig', 'Overig']];
const plxBanks = () => (userPrefs().banks || []).filter((b) => b && b.name).map((b) => ({ id: b.id || plxRid(), name: String(b.name), kind: String(b.kind || 'spaar'),
  amount: Math.max(0, Number(b.amount) || 0), rate: isNum(Number(b.rate)) ? Number(b.rate) : null, updated: b.updated || null }));
function plxBankRow(b) {
  return '<div class="h-row plx-bank-row" data-plx-bank="' + esc(b.id || '') + '">' +
    '<input aria-label="Naam" data-b="name" maxlength="40" value="' + esc(b.name || '') + '" placeholder="Bijv. spaarrekening">' +
    '<select aria-label="Soort" data-b="kind">' + PLX_BANK_KINDS.map(([k, l]) => '<option value="' + k + '"' + (String(b.kind || 'spaar') === k ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>' +
    '<input aria-label="Stand in euro" data-b="amount" type="number" min="0" step="50" value="' + esc(isNum(b.amount) && b.amount ? String(b.amount) : '') + '" placeholder="Stand €">' +
    '<input aria-label="Rente in procent per jaar" data-b="rate" type="number" min="0" max="20" step="0.05" value="' + esc(isNum(b.rate) && b.rate ? String(b.rate) : '') + '" placeholder="Rente %">' +
    '<input aria-label="Stand van" data-b="updated" type="date" value="' + esc(b.updated || '') + '">' +
    '<button type="button" class="icon-x" data-plx="bank-rm" aria-label="Rekening verwijderen">×</button></div>';
}
function plxBankTile() {
  const B = plxBanks();
  const tot = sum(B.map((b) => b.amount));
  const interest = sum(B.map((b) => (isNum(b.rate) ? b.amount * b.rate / 100 : 0)));
  const per = PLX_BANK_KINDS.map(([k, l]) => ({ k, l, v: sum(B.filter((b) => b.kind === k).map((b) => b.amount)) })).filter((x) => x.v > 0);
  return '<section class="tile pad full plx-bank"><h3>Spaargeld en contant</h3>' +
    '<p class="sub">Vul hier met de hand je spaargeld, deposito’s, betaalrekening of contant geld in. Zo zie je bij het netto vermogen en de belastinghulp je hele plaatje, niet alleen je beleggingen. Trading 212 heeft hier niets mee te maken; dit blijft je eigen invoer.</p>' +
    (B.length ? '<div class="fx-head"><span class="v big">' + esc(eur(tot)) + '</span><span class="muted small">op ' + B.length + (B.length === 1 ? ' rekening' : ' rekeningen') + ', samen met je beleggingen ' + esc(eur(tot + (M.accountNow || 0))) + '</span></div>' +
      (per.length ? '<div class="legend-list" style="margin-top:8px">' + per.map((x) => '<div class="legend-row"><span class="nm">' + esc(x.l) + '</span><b>' + esc(eur(x.v)) + '</b></div>').join('') + '</div>' : '') +
      kvList([['Geschatte rente per jaar', interest > 0 ? eur(interest) : 'geen rente ingevuld'], ['Deel van je vermogen dat niet belegd is', tot + (M.accountNow || 0) > 0 ? P1.format(tot / (tot + (M.accountNow || 0))) : '–']])
      : '<p class="muted">Nog geen rekeningen ingevuld.</p>') +
    '<div class="goal-form" data-plx-bankform><div class="plx-bank-rows">' + B.concat([{ id: '', name: '', kind: 'spaar', amount: 0, rate: null, updated: new Date().toISOString().slice(0, 10) }]).map(plxBankRow).join('') + '</div>' +
    '<div class="plan-actions" style="margin-top:8px"><button type="button" class="btn ghost" data-plx="bank-add">Rekening toevoegen</button>' +
    '<button type="button" class="btn primary" data-plx="bank-save">Opslaan</button>' + plxSay('bank', '') + '</div></div>' +
    '<p class="sub" style="margin-top:8px">De standen blijven staan tot je ze zelf bijwerkt; de datum erachter laat zien hoe oud een stand is. Rente is een schatting: stand maal het percentage dat je invult.</p></section>';
}

// ---------- 73. Netto vermogen door de tijd ----------
function plxWorthParts() {
  const A = typeof accts === 'function' ? accts() : [];
  return A.map((a) => ({ name: a.name + (a.broker ? ' (' + a.broker + ')' : ''), v: acctTotal(a), t: ymd(a.updated), kind: 'Broker (eigen invoer)' }))
    .concat(plxBanks().map((b) => ({ name: b.name, v: b.amount, t: ymd(b.updated), kind: (PLX_BANK_KINDS.find((k) => k[0] === b.kind) || ['', 'Overig'])[1] + ' (eigen invoer)' })))
    .filter((p) => isNum(p.v) && p.v > 0);
}
function plxWorthModel() {
  const parts = plxWorthParts();
  const W = M.weeks.filter((w) => isNum(w.accountValue));
  const extraAt = (t) => sum(parts.map((p) => (p.t == null || p.t <= t ? p.v : 0)));
  const line = W.map((w) => ({ t: w.t, v: w.accountValue + extraAt(w.t) }));
  const t212 = W.map((w) => ({ t: w.t, v: w.accountValue }));
  const nowT = Date.now();
  if (W.length) {
    line.push({ t: nowT, v: (M.accountNow || 0) + extraAt(nowT) });
    t212.push({ t: nowT, v: M.accountNow || 0 });
  }
  const extraNow = sum(parts.map((p) => p.v));
  const first = line.length ? line[0] : null;
  const ago = line.filter((p) => p.t <= nowT - 365 * DAY).pop();
  return { parts, line, t212, now: (M.accountNow || 0) + extraNow, extraNow, first, ago, hasHistory: line.length >= 2, undated: parts.some((p) => p.t == null) };
}
function plxWorthTile() {
  const N = plxWorthModel();
  if (!N.parts.length && !N.hasHistory) return '<section class="tile pad full"><h3>Netto vermogen door de tijd</h3><p class="muted">Na de eerste weekmetingen staat hier je vermogen door de tijd. Vul bij “Spaargeld en contant” je andere rekeningen in om ze mee te tellen.</p></section>';
  const grow = N.ago ? N.now - N.ago.v : null;
  return '<section class="tile pad full plx-worth"><h3>Netto vermogen door de tijd</h3>' +
    '<div class="fx-head"><span class="v big">' + esc(eur(N.now)) + '</span><span class="muted small">beleggingen ' + esc(eur(M.accountNow)) + (N.extraNow ? ' plus ' + esc(eur(N.extraNow)) + ' eigen invoer' : '') + '</span></div>' +
    (N.hasHistory ? '<div class="chart" data-chart="plxworth" style="height:200px"></div><div class="xlabels" data-x="plxworth"></div>' +
      '<div class="legend chart-legend" style="margin-top:6px"><span><i style="background:' + C.accent + '"></i>Alles samen</span><span><i class="dash"></i>Alleen Trading 212</span></div>'
      : '<p class="small muted">Nog te weinig weekmetingen voor een lijn.</p>') +
    kvList([
      ['Trading 212', eur(M.accountNow)],
      ['Andere rekeningen en spaargeld', N.extraNow ? eur(N.extraNow) : 'niets ingevuld'],
      ['Een jaar eerder', N.ago ? eur(N.ago.v) : 'nog geen meting van een jaar terug'],
      ['Groei in een jaar', isNum(grow) ? seur(grow) : '–', tone(grow)],
    ]) +
    (N.parts.length ? '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Onderdeel</th><th>Soort</th><th>Stand van</th><th class="num">Waarde</th></tr></thead><tbody>' +
      [{ name: 'Trading 212 (deze tracker)', kind: 'Automatisch gemeten', t: M.lastT, v: M.accountNow }].concat(N.parts).map((p) => '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.kind) + '</td>' +
        '<td>' + esc(p.t ? fD.format(p.t) : 'geen datum') + '</td><td class="num">' + esc(eur(p.v)) + '</td></tr>').join('') + '</tbody></table></div>' : '') +
    '<p class="sub" style="margin-top:8px">De lijn gebruikt je weekmetingen van Trading 212. Rekeningen die je zelf invult, tellen mee vanaf de datum die je erbij zet en blijven daarna gelijk; ze hebben geen geschiedenis.' +
    (N.undated ? ' Een rekening zonder datum telt over de hele lijn mee.' : '') + ' Schulden (zoals een hypotheek of studieschuld) staan er niet in: dit is wat je hebt, niet wat je netto overhoudt.</p></section>';
}
function plxDrawWorth(root) {
  const host = root.querySelector('[data-chart="plxworth"]');
  if (!host) return;
  const N = plxWorthModel();
  if (!N.hasHistory) return;
  lineChart(host, [{ pts: N.line, color: C.accent, width: 3, label: 'Alles samen' }, { pts: N.t212, color: C.ink2, dash: true, width: 2, label: 'Trading 212' }],
    { top: 0.08, bottom: 0.06, xl: root.querySelector('[data-x="plxworth"]'), xcount: 4, xfmt: (t) => fMonY.format(t), tfmt: (t) => fD.format(t) });
}

// ---------- 82. Potjes per doel ----------
const plxGoalPos = () => userPrefs().goalPos || {};
function plxBucketModel() {
  const G = (typeof goalsOf === 'function' ? goalsOf() : []).map((g, i) => Object.assign({}, g, { id: g.id || 'doel' + (i + 1) }));
  const map = plxGoalPos();
  const monthly = plxMonthlyNow();
  const used = new Map();
  M.companies.forEach((c) => { const id = map[c.tk]; if (id && G.some((g) => g.id === id)) used.set(c.tk, id); });
  const shareSum = sum(G.map((g) => Number(g.share) || 0));
  const now = new Date();
  const rows = G.map((g) => {
    const list = M.companies.filter((c) => used.get(c.tk) === g.id);
    const have = sum(list.map((c) => c.value));
    const cost = sum(list.map((c) => (isNum(c.cost) ? c.cost : 0)));
    const m = shareSum > 0 ? monthly * (Number(g.share) || 0) / shareSum : G.length ? monthly / G.length : 0;
    const k = g.target > 0 ? goalEta(have, m, g.target) : null;
    const due = g.date ? ymd(String(g.date).length === 7 ? g.date + '-01' : g.date) : null;
    const eta = k == null ? null : plxTAt(k);
    return { g, list, have, cost, m, k, eta, due, onTrack: due && eta ? eta <= due : null };
  });
  const free = M.companies.filter((c) => !used.has(c.tk));
  return { rows, free, freeValue: sum(free.map((c) => c.value)), monthly, cash: M.cash || 0, goals: G };
}
function plxBucketTile() {
  const B = plxBucketModel();
  if (!B.goals.length) return '<section class="tile pad full"><h3>Potjes per doel</h3><p class="muted">Maak eerst doelen aan bij “Doelen” hierboven (bijvoorbeeld huis en pensioen). Daarna kun je hier per positie kiezen bij welk doel die hoort.</p></section>';
  const sel = (c) => '<select data-plx-bucket="' + esc(c.tk) + '" aria-label="' + esc('Doel voor ' + c.tk) + '"><option value="">Niet toegewezen</option>' +
    B.goals.map((g) => '<option value="' + esc(g.id) + '"' + (plxGoalPos()[c.tk] === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') + '</select>';
  return '<section class="tile pad full plx-bucket"><h3>Potjes per doel</h3>' +
    '<p class="sub">Wijs je posities toe aan een doel, zoals huis of pensioen. Per doel zie je dan de echte waarde van dat potje en wanneer je het haalt, in plaats van een percentage van je hele account.</p>' +
    B.rows.map((r) => '<div class="goal"><div class="goal-h"><b>' + esc(r.g.name) + '</b><span class="muted small">' + esc(eur(r.have)) + ' van ' + esc(eur(r.g.target)) +
      ' · ' + r.list.length + (r.list.length === 1 ? ' positie' : ' posities') + (r.list.length ? ': ' + esc(r.list.map((c) => c.tk).join(', ')) : '') + '</span></div>' +
      '<div class="meter"><div style="width:' + (r.g.target > 0 ? Math.min(100, r.have / r.g.target * 100).toFixed(1) : 0) + '%"></div></div>' +
      '<p class="small" style="margin-top:4px">' + (r.k === 0 ? 'Gehaald.' : r.eta ? 'Rond ' + esc(plxMon(r.eta)) + ' bij ' + esc(eur(r.m)) + ' per maand naar dit doel en 7% per jaar' : 'Niet binnen 60 jaar bij deze inleg') +
      (r.onTrack === true ? ' · <b class="gain">op schema</b> voor ' + esc(plxMon(r.due)) : r.onTrack === false ? ' · <b class="loss">later dan</b> ' + esc(plxMon(r.due)) : '') +
      (r.cost > 0 ? ' · resultaat ' + '<b class="' + tone(r.have - r.cost) + '">' + esc(seur(r.have - r.cost)) + '</b>' : '') + '</p></div>').join('') +
    '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Positie</th><th class="num">Waarde</th><th>Doel</th></tr></thead><tbody>' +
    M.companies.slice().sort((a, b) => b.value - a.value).map((c) => '<tr><td class="co"><b>' + esc(c.tk) + '</b><span class="nm">' + esc(c.name) + '</span></td>' +
      '<td class="num">' + esc(eur(c.value)) + '</td><td>' + sel(c) + '</td></tr>').join('') + '</tbody></table></div>' +
    plxSay('bucket', '') +
    kvList([['Niet toegewezen', eur(B.freeValue) + (B.free.length ? ' (' + B.free.length + (B.free.length === 1 ? ' positie' : ' posities') + ')' : '')], ['Vrij saldo (hoort bij geen doel)', eur(B.cash)]]) +
    '<p class="sub" style="margin-top:8px">De maandinleg wordt over de doelen verdeeld volgens het percentage dat je bij “Doelen” per doel invulde; staat daar niets, dan gelijk over alle doelen. Een keuze wordt meteen opgeslagen en geldt ook op je andere apparaten. Rekenvoorbeeld met 7% per jaar, geen beleggingsadvies.</p></section>';
}

// ---------- 85. Maandelijks inleggen vanaf een datum, teruggerekend ----------
function plxDcaPts(sym) {
  if (sym === 'SP500' || sym === 'NASDAQ100') return typeof indexEur === 'function' ? indexEur(sym) : [];
  return typeof benchPts === 'function' ? benchPts(sym) : [];
}
function plxDcaChoices() {
  const out = [];
  if (plxDcaPts('SP500').length > 30) out.push(['SP500', 'S&P 500']);
  if (plxDcaPts('NASDAQ100').length > 30) out.push(['NASDAQ100', 'Nasdaq-100']);
  if (M.mk.ok) {
    const seen = new Set();
    M.companies.forEach((c) => { const s = M.mk.sym(c.tk); if (s && !seen.has(s) && M.mk.prices(s).length > 120) { seen.add(s); out.push([s, c.tk]); } });
  }
  return out.length ? out : [['SP500', 'S&P 500']];
}
function plxDcaModel(sym, amt, years) {
  const pts = plxDcaPts(sym);
  if (pts.length < 24) return { pts, none: true };
  const last = pts[pts.length - 1], firstT = pts[0].t;
  const wanted = new Date(last.t); wanted.setMonth(wanted.getMonth() - years * 12 + 1); wanted.setDate(1);
  const start = new Date(Math.max(wanted.getTime(), firstT));
  start.setDate(1);
  let units = 0, inv = 0;
  const line = [], flows = [];
  for (let k = 0; k < 600; k++) {
    const d = new Date(start.getFullYear(), start.getMonth() + k, 1).getTime();
    if (d > last.t) break;
    const p = pts.find((x) => x.t >= d);
    if (!p || p.t > last.t) break;
    units += amt / p.v; inv += amt;
    flows.push({ t: p.t, v: -amt });
    line.push({ t: p.t, v: units * p.v, inv });
  }
  if (line.length < 2) return { pts, none: true };
  const now = units * last.v;
  const firstP = pts.find((x) => x.t >= line[0].t) || pts[0];
  return { pts, none: false, now, inv, n: line.length, from: line[0].t, firstAvail: firstT,
    lump: inv / firstP.v * last.v, line: line.concat([{ t: last.t + HOUR, v: now, inv }]),
    x: typeof xirrOf === 'function' ? xirrOf(flows.concat([{ t: last.t + HOUR, v: now }])) : null, short: wanted.getTime() < firstT };
}
function plxDcaTile() {
  const ch = plxDcaChoices();
  if (!ch.some((c) => c[0] === plx.dcaSym)) plx.dcaSym = ch[0][0];
  const D = plxDcaModel(plx.dcaSym, plx.dcaAmt, plx.dcaYears);
  const name = (ch.find((c) => c[0] === plx.dcaSym) || ['', plx.dcaSym])[1];
  return '<section class="tile pad full plx-dca"><h3>Maandelijks inleggen vanaf een datum</h3>' +
    '<p class="sub">Wat als je elke maand hetzelfde bedrag in één belegging had gestopt? De tracker rekent het terug met de koersen die de bronnen geven.</p>' +
    '<div class="seg light wrap" role="group" aria-label="Belegging" data-plx-seg="dcaSym">' + ch.map((c) => '<button type="button" data-k="' + esc(c[0]) + '" aria-pressed="' + (c[0] === plx.dcaSym) + '">' + esc(c[1]) + '</button>').join('') + '</div>' +
    '<div class="plan-inputs" style="margin-top:8px"><label>Per maand<span class="eur-in">€<input type="number" min="10" step="10" value="' + esc(String(plx.dcaAmt)) + '" data-plx-dca-amt aria-label="Bedrag per maand"></span></label>' +
    plxSeg('dcaYears', [[1, '1 jaar'], [3, '3 jaar'], [5, '5 jaar'], [20, 'Zo lang mogelijk']], plx.dcaYears, 'Periode') + '</div>' +
    (D.none ? '<p class="muted" style="margin-top:10px">Voor ' + esc(name) + ' is nog te weinig koersgeschiedenis opgehaald.</p>'
      : '<div class="chart" data-chart="plxdca" style="height:180px;margin-top:10px"></div><div class="xlabels" data-x="plxdca"></div>' +
        kvList([
          ['Periode', fMonY.format(D.from) + ' tot nu, ' + D.n + (D.n === 1 ? ' aankoop' : ' aankopen')],
          ['Zelf ingelegd', eur(D.inv)],
          ['Waarde nu', eur(D.now) + ' (' + spct1(D.now / D.inv - 1) + ')', tone(D.now - D.inv)],
          ['Rendement per jaar (XIRR)', isNum(D.x) ? spct1(D.x) : '–', tone(D.x)],
          ['Alles in één keer aan het begin', eur(D.lump) + ' (' + seur(D.lump - D.now) + ' tegenover maandelijks)', tone(D.lump - D.now)],
        ]) +
        (D.short ? '<p class="small" style="margin-top:6px">Verder terug lukt niet: de koershistorie van deze bron begint bij ' + esc(fMonY.format(D.firstAvail)) + '. Voor een berekening vanaf bijvoorbeeld 2020 is meer historie nodig dan de gratis bronnen geven; de Worker bouwt die dag voor dag verder op.</p>' : '')) +
    '<p class="sub" style="margin-top:8px">Aankoop op de eerste handelsdag van elke maand, in euro, zonder kosten en zonder dividend. ' +
    (plx.dcaSym === 'SP500' || plx.dcaSym === 'NASDAQ100' ? 'Index van FRED, omgerekend met de ECB-koers van dezelfde dag. ' : 'Koersen via de marktbron van de tracker. ') +
    'Wat in het verleden gebeurde, zegt niets over de toekomst. Geen beleggingsadvies.</p></section>';
}
function plxDrawDca(root) {
  const host = root.querySelector('[data-chart="plxdca"]');
  if (!host) return;
  const D = plxDcaModel(plx.dcaSym, plx.dcaAmt, plx.dcaYears);
  if (D.none) return;
  lineChart(host, [{ pts: D.line.map((p) => ({ t: p.t, v: p.v })), color: C.accent, width: 3, label: 'Waarde' },
    { pts: D.line.map((p) => ({ t: p.t, v: p.inv })), color: C.ink2, dash: true, width: 2, label: 'Ingelegd' }],
  { top: 0.06, bottom: 0.04, xl: root.querySelector('[data-x="plxdca"]'), xcount: 3, xfmt: (t) => fMonY.format(t), tfmt: (t) => fD.format(t) });
}

// ---------- Extra onderdelen op Plannen ----------
function planExtraSections2() {
  if (!M) return [];
  return [
    { title: 'Plannen vergelijken', sub: 'Twee plannen naast elkaar, bedragen na inflatie, gebeurtenissen en kansen', tiles: [plxCmpTile(), plxEventTile(), plxFanTile()] },
    { title: 'Inkomen en belastinghulp', sub: 'Verwacht dividend per maand, box 3 per jaar en herbalanceren stap voor stap', tiles: [plxDivIncomeTile(), plxTaxTile(), plxRebalTile()] },
    { title: 'Vermogen buiten de tracker', sub: 'Spaargeld en andere rekeningen, en je vermogen door de tijd', tiles: [plxBankTile(), plxWorthTile()] },
    { title: 'Doelen en terugkijken', sub: 'Potjes per doel en maandelijks inleggen teruggerekend', tiles: [plxBucketTile(), plxDcaTile()] },
  ];
}
function drawPlanExtra2(root) {
  if (!root) return;
  plxDrawCmp(root); plxDrawEvents(root); plxDrawFan(root); plxDrawWorth(root); plxDrawDca(root);
}

// ---------- Klikken, kiezen en opslaan ----------
// Keuzeknoppen van deze onderdelen
document.addEventListener('click', (e) => {
  const seg = plxHit(e, '[data-plx-seg] button[data-k]');
  if (!seg) return;
  e.stopImmediatePropagation();
  const key = seg.parentElement.dataset.plxSeg, k = seg.dataset.k;
  if (key === 'cmpYears') plan.years = Number(k);
  else if (key === 'cmpRa') plx.cmpRa = Number(k);
  else if (key === 'cmpRb') plx.cmpRb = Number(k);
  else if (key === 'taxYear') plx.taxYear = Number(k);
  else if (key === 'dcaSym') plx.dcaSym = k;
  else if (key === 'dcaYears') plx.dcaYears = Number(k);
  refresh('plan');
}, true);

// Bedragen na inflatie aan of uit
document.addEventListener('change', async (e) => {
  const cb = plxHit(e, '[data-plx-real]');
  if (!cb) return;
  const on = !!plxEl(cb).checked;
  try { await savePrefs({ realProj: on }); refresh('plan', 'analyse'); }
  catch (err) { plxEl(cb).checked = !on; }
});

// Afvinklijst herbalanceren
document.addEventListener('change', async (e) => {
  const cb = plxHit(e, '[data-plx-reb]');
  if (!cb) return;
  const key = cb.dataset.plxReb, on = !!plxEl(cb).checked;
  const done = Object.assign({}, plxRebDone());
  if (on) done[key] = true; else delete done[key];
  try { await savePrefs({ rebDone: done }); refresh('plan'); }
  catch (err) { plxTell('reb', 'Opslaan is mislukt: ' + err.message + '.', 'loss'); }
});

// Positie aan een doel toewijzen
document.addEventListener('change', async (e) => {
  const sel = plxHit(e, '[data-plx-bucket]');
  if (!sel) return;
  const tk = sel.dataset.plxBucket, id = plxVal(sel);
  const map = Object.assign({}, plxGoalPos());
  if (id) map[tk] = id; else delete map[tk];
  plxTell('bucket', 'Bezig met opslaan…');
  try { await savePrefs({ goalPos: map }); refresh('plan'); }
  catch (err) { plxTell('bucket', 'Opslaan is mislukt: ' + err.message + '.', 'loss'); }
});

// Bedrag per maand in de terugrekening
document.addEventListener('change', (e) => {
  const el = plxHit(e, '[data-plx-dca-amt]');
  if (!el) return;
  const v = plxNum(el);
  if (isNum(v) && v > 0) { plx.dcaAmt = Math.round(v); refresh('plan'); }
});

// Inleg per maand in de vergelijking
document.addEventListener('change', (e) => {
  const el = plxHit(e, '[data-plx-cmp]');
  if (!el) return;
  const v = plxNum(el);
  if (isNum(v) && v >= 0) { if (el.dataset.plxCmp === 'a') plx.cmpA = Math.round(v); else plx.cmpB = Math.round(v); refresh('plan'); }
});

// Knoppen: rijen toevoegen of verwijderen, opslaan, kopiëren en exporteren
document.addEventListener('click', async (e) => {
  const b = plxHit(e, '[data-plx]');
  if (!b) return;
  const act = b.dataset.plx;
  if (act === 'ev-add') { const box = document.querySelector('.plx-ev-rows'); if (box) box.insertAdjacentHTML('beforeend', plxEventRow({ id: '', name: '', date: '', amount: 0, pause: 0 })); return; }
  if (act === 'ev-rm') { const row = b.closest('.plx-ev-row'); if (row) row.remove(); return; }
  if (act === 'bank-add') { const box = document.querySelector('.plx-bank-rows'); if (box) box.insertAdjacentHTML('beforeend', plxBankRow({ id: '', name: '', kind: 'spaar', amount: 0, rate: null, updated: new Date().toISOString().slice(0, 10) })); return; }
  if (act === 'bank-rm') { const row = b.closest('.plx-bank-row'); if (row) row.remove(); return; }
  if (act === 'ev-save') {
    const rows = Array.from(document.querySelectorAll('.plx-ev-row'));
    const list = rows.map((r) => {
      const g = (k) => plxVal(r.querySelector('[data-e="' + k + '"]'));
      return { id: plxEl(r).dataset.plxEv || plxRid(), name: g('name').slice(0, 40), date: g('date').slice(0, 7), amount: Math.max(0, Number(g('amount')) || 0), pause: Math.max(0, Math.min(120, Math.round(Number(g('pause')) || 0))) };
    }).filter((x) => x.name && x.date && (x.amount > 0 || x.pause > 0));
    plxTell('ev', 'Bezig met opslaan…');
    try { await savePrefs({ lifeEvents: list }); plxTell('ev', 'Opgeslagen.', 'gain'); refresh('plan'); }
    catch (err) { plxTell('ev', 'Opslaan is mislukt: ' + err.message + '.', 'loss'); }
    return;
  }
  if (act === 'bank-save') {
    const rows = Array.from(document.querySelectorAll('.plx-bank-row'));
    const list = rows.map((r) => {
      const g = (k) => plxVal(r.querySelector('[data-b="' + k + '"]'));
      const rate = Number(g('rate'));
      return { id: plxEl(r).dataset.plxBank || plxRid(), name: g('name').slice(0, 40), kind: g('kind') || 'spaar', amount: Math.max(0, Number(g('amount')) || 0),
        rate: isFinite(rate) && rate > 0 ? rate : null, updated: g('updated') || null };
    }).filter((x) => x.name && x.amount >= 0);
    plxTell('bank', 'Bezig met opslaan…');
    try { await savePrefs({ banks: list }); plxTell('bank', 'Opgeslagen.', 'gain'); refresh('plan'); }
    catch (err) { plxTell('bank', 'Opslaan is mislukt: ' + err.message + '.', 'loss'); }
    return;
  }
  if (act === 'reb-copy') {
    const R = rebalanceModel();
    if (!R) return;
    try { await navigator.clipboard.writeText(plxRebText(R)); plxTell('reb', 'Lijst gekopieerd.', 'gain'); }
    catch (err) { plxTell('reb', 'Kopiëren lukte niet in deze browser.', 'loss'); }
    return;
  }
  if (act === 'reb-reset') {
    plxTell('reb', 'Bezig met opslaan…');
    try { await savePrefs({ rebDone: {} }); refresh('plan'); }
    catch (err) { plxTell('reb', 'Opslaan is mislukt: ' + err.message + '.', 'loss'); }
    return;
  }
  if (act === 'tax-copy' || act === 'tax-csv' || act === 'tax-div') {
    const X = plxTaxModel(plx.taxYear);
    if (!X) return;
    if (act === 'tax-copy') {
      try { await navigator.clipboard.writeText(plxTaxText(X)); plxTell('tax', 'Overzicht gekopieerd.', 'gain'); }
      catch (err) { plxTell('tax', 'Kopiëren lukte niet in deze browser.', 'loss'); }
      return;
    }
    if (act === 'tax-csv') {
      const rows = [['Trading 212 totaal', isNum(X.value) ? X.value : '', X.exact ? 'peildatum' : 'geschat uit weekmeting', '']];
      if (X.B.peil) { rows.push(['Trading 212 beleggingen', X.B.peil.investments, 'peildatum', '']); rows.push(['Trading 212 vrij saldo', X.B.peil.cash, 'peildatum', '']); }
      X.other.forEach((a) => rows.push([a.name, a.v, 'eigen invoer (broker)', a.updated || '']));
      X.banks.forEach((a) => rows.push([a.name, a.v, 'eigen invoer (spaargeld)', a.updated || '']));
      X.positions.forEach((p) => rows.push([(p.ticker || p.tk || 'positie') + ' (positie op de peildatum)', isNum(p.value) ? p.value : '', 'peildatum', '']));
      rows.push(['Ingehouden buitenlandse bronbelasting ' + X.Y, X.tax, X.est ? 'deels geschat' : 'uit je gegevens', '']);
      download('peildatum-' + X.Y + '.csv', csvOf(['onderdeel', 'waarde_eur', 'bron', 'stand_van'], rows));
      plxTell('tax', 'Peildatum-bestand opgeslagen.', 'gain');
      return;
    }
    download('bronbelasting-' + X.Y + '.csv', csvOf(['datum', 'ticker', 'land', 'netto_eur', 'bruto_eur', 'bronbelasting_eur', 'methode'],
      X.B.divs.map((d) => [d.d.date, d.d.ticker, CUR_LAND[d.cur] || d.cur, d.d.amount, d.gross.toFixed(2), d.tax.toFixed(2), d.how])));
    plxTell('tax', 'Dividendbestand opgeslagen.', 'gain');
  }
});
