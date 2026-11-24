/* Investeringstracker – Plannen als rapport met geldagenda (ontwerp 2026, variant P-E): kerncijfers in één strook, een
 * geldagenda voor de komende vier maanden (inleg, dividend, belasting), een hoofdstukbalk die blijft staan en per
 * hoofdstuk een opening met nummer en titel. De hoofdstukken en hun tegels staan in plChapters (gebruikt door
 * renderPlan in js/06-plannen.js en PlanPage in js/plannen-preact.js); de opmaak deelt Plannen met Analyse.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// Tegels uit de extra onderdelen (js/16-analyse.js en het lui geladen js/29-plannen-extra.js), op titel en plaats
function plExtra(title, i) {
  const all = (typeof planExtraSections === 'function' ? planExtraSections() : []).concat(typeof planExtraSections2 === 'function' ? planExtraSections2() : []);
  const s = all.find((x) => x.title === title);
  return s ? (i == null ? s.tiles : [s.tiles[i]]) : [];
}
// De zes hoofdstukken: id, titel, uitleg en de tegels (als HTML). De componentenversie vervangt de eerste drie
// tegels (streefverdeling, inleg, vooruitblik) door haar eigen componenten; zie 'own'.
function plChapters() {
  return [
    { id: 'pl-inleg', title: 'Inleg en doelen', sub: 'Streefverdeling, wat je met nieuwe inleg koopt, je doelen en mijlpalen', own: ['target', 'inleg'],
      tiles: () => [goalsTile(), depositTile(), milestoneTile()].concat(plExtra('Doelen en terugkijken', 0)) },
    { id: 'pl-vooruit', title: 'Vooruitblik', sub: 'Waar je naartoe groeit, met kansen, financiële onafhankelijkheid en twee plannen naast elkaar', own: ['forecast'],
      tiles: () => plExtra('Vooruit rekenen').concat(plExtra('Plannen vergelijken'), plExtra('Doelen en terugkijken', 1)) },
    { id: 'pl-watals', title: 'Wat als', sub: 'Je portefeuille bij tegenvallers en tegenover de index', own: [],
      tiles: () => [scenarioTile(), whatIfTile()] },
    { id: 'pl-div', title: 'Dividend en inkomen', sub: 'Verwacht dividend per maand en wat het oplevert', own: [],
      tiles: () => [divCalendarTile()].concat(plExtra('Inkomen en belastinghulp', 0)) },
    { id: 'pl-tax', title: 'Belasting en jaaroverzicht', sub: 'Box 3, de peildatum, het jaaroverzicht en rente over je saldo', own: [],
      tiles: () => [box3Tile(), yearTile()].concat(plExtra('Belasting, herbalanceren en rente', 0), plExtra('Inkomen en belastinghulp', 1), plExtra('Belasting, herbalanceren en rente', 2)) },
    { id: 'pl-kosten', title: 'Kosten, herbalanceren en rekeningen', sub: 'Kosten, terug naar je streefverdeling, spreiding, je andere rekeningen en exporteren', own: [],
      tiles: () => [costTile(), terTile(), journalTile()].concat(plExtra('Belasting, herbalanceren en rente', 1), plExtra('Inkomen en belastinghulp', 2),
        [overlapTile(), exposureTile(), accountsTile()], plExtra('Vermogen buiten de tracker'), [weekShareTile(), exportTile()]) },
  ];
}

// ---------- Cijfers die de strook en de openingen delen ----------
const fMonthYear = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });
function plCore() {
  const P = projection();
  const G = goalsOf();
  const total = M.accountNow || 0;
  const goals = G.map((g) => { const have = total * (g.share || 0) / 100; return { g, have, pct: g.target > 0 ? have / g.target : null, done: have >= g.target }; });
  const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  // Gestort deze maand: de stortingen uit de weekmetingen sinds het begin van de maand
  const dep = sum(M.weeks.filter((w) => w.t >= m0 && isNum(w.newDeposits) && w.newDeposits > 0).map((w) => w.newDeposits));
  let F = { total: 0, months: [], info: [], pays: [] };
  try { F = divForecast(); } catch (e) { /* geen dividendgegevens */ }
  const D = typeof driftModel === 'function' ? driftModel() : null;
  const hasTargets = !!Object.keys((M.settings && M.settings.targets) || {}).length;
  const lim = M.settings && M.settings.alerts && isNum(M.settings.alerts.drift) && M.settings.alerts.drift > 0 ? M.settings.alerts.drift : 5;
  return { P, goals, dep, F, D, hasTargets, lim };
}
function plKpis(K) {
  const cell = (k, v, sub, cls) => tpl`<div class="bc-k"><span class="k">${k}</span><b class="v ${cls || ''}">${v}</b><span class="sub">${sub}</span></div>`;
  const done = K.goals.filter((x) => x.done).length;
  const open = K.goals.filter((x) => !x.done).sort((a, b) => (b.pct || 0) - (a.pct || 0))[0];
  return String(tpl`<div class="bc-kpis pl-kpis" role="group" aria-label="Kerncijfers van je plan">${[
    cell('Accountwaarde', eur(M.accountNow), 'start van elke berekening'),
    cell('Inleg per maand', eur(K.P.monthly), K.dep > 0 ? 'deze maand ' + eur(K.dep) + ' gestort' : 'deze maand nog niets gestort'),
    K.goals.length ? cell('Doelen', done + ' van ' + K.goals.length + ' gehaald', open ? open.g.name + ' ' + PCT0.format(Math.min(1, open.pct || 0)) : 'alles gehaald', done ? 'gain' : '')
      : cell('Doelen', 'nog geen', 'stel een doel in bij Inleg en doelen'),
    cell('Dividend 12 mnd', eur(K.F.total), K.F.total ? 'verwacht, ongeveer ' + eur(K.F.total / 12) + ' per maand' : 'nog niets verwacht', K.F.total ? 'gain' : ''),
    !K.hasTargets ? cell('Te doen', '–', 'geen streefverdeling ingesteld')
      : K.D ? cell('Te doen', K.D.big.length + (K.D.big.length === 1 ? ' afwijking' : ' afwijkingen'), 'meer dan ' + K.D.lim + ' pp van je streefverdeling', 'loss')
        : cell('Te doen', 'niets', 'geen positie meer dan ' + K.lim + ' pp van je doel', 'gain'),
  ]}</div>`);
}

// ---------- Geldagenda: inleg, dividend en belasting in de komende maanden ----------
const PL_AG_MONTHS = 4;
const plInlegDag = () => { const d = Number(userPrefs().inlegDag); return d >= 1 && d <= 28 ? Math.round(d) : null; };
// Alle gebeurtenissen vanaf vandaag tot het einde van de laatste maand (n maanden), gesorteerd
function plEvents(K, n) {
  const now = new Date(), t0 = dayStart(Date.now());
  const end = new Date(now.getFullYear(), now.getMonth() + n, 1).getTime();
  const ev = [];
  const day = plInlegDag();
  if (day && K.P.monthly > 0) {
    for (let i = 0; i < n; i++) { const t = new Date(now.getFullYear(), now.getMonth() + i, day).getTime(); if (t >= t0 && t < end) ev.push({ t, kind: 'inleg', label: 'inleg', v: K.P.monthly }); }
  }
  (K.F.pays || []).forEach((p) => { if (p.t >= t0 && p.t < end) ev.push({ t: dayStart(p.t), kind: 'dividend', label: 'dividend ' + p.tk + (p.kind === 'Verwacht' ? ' (verwacht)' : ''), v: p.eur }); });
  for (let y = now.getFullYear(); y <= new Date(end).getFullYear(); y++) {
    const pd = new Date(y, 0, 1).getTime();
    if (pd >= t0 && pd < end) ev.push({ t: pd, kind: 'belasting', label: 'peildatum box 3', v: null });
    const ag = new Date(y, 4, 1).getTime();
    if (ag >= t0 && ag < end) ev.push({ t: ag, kind: 'belasting', label: 'aangifte inkomstenbelasting (uiterlijk)', v: null });
  }
  return ev.sort((a, b) => a.t - b.t);
}
const PL_DOW = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
function plMonthHtml(y, mo, ev) {
  const first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const today = dayStart(Date.now());
  const inM = ev.filter((e) => { const d = new Date(e.t); return d.getFullYear() === y && d.getMonth() === mo; });
  const byDay = new Map();
  inM.forEach((e) => { const d = new Date(e.t).getDate(); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(e); });
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(tpl`<span></span>`);
  for (let d = 1; d <= days; d++) {
    const es = byDay.get(d) || [], t = new Date(y, mo, d).getTime();
    const kind = es.length ? (es.some((e) => e.kind === 'inleg') ? 'inleg' : es.some((e) => e.kind === 'belasting') ? 'belasting' : 'dividend') : '';
    const tip = es.map((e) => e.label + (isNum(e.v) ? ' ' + eur(e.v) : '')).join(', ');
    cells.push(tpl`<span class="${'pl-d' + (kind ? ' ' + kind : '') + (t === today ? ' now' : '')}" ${raw(tip ? 'title="' + esc(tip) + '"' : '')}>${d}</span>`);
  }
  // Onder de maand: elke dag met iets, en wat er gebeurt (per soort samengevoegd)
  const rows = [...byDay.entries()].map(([d, es]) => tpl`<li><i class="${'pl-dot ' + es[0].kind}" aria-hidden="true"></i><b>${d}</b> ${es.map((e) => e.label + (isNum(e.v) ? ' ' + eur(e.v) : '')).join(', ')}</li>`);
  return tpl`<div class="pl-m"><h3>${new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(first)}</h3>
    <div class="pl-cal" role="presentation">${PL_DOW.map((w) => tpl`<span class="h">${w}</span>`)}${cells}</div>
    ${rows.length ? tpl`<ul class="pl-ev">${rows}</ul>` : tpl`<p class="sub">Niets gepland.</p>`}</div>`;
}
function plAgenda(K) {
  const now = new Date();
  const ev = plEvents(K, PL_AG_MONTHS);
  const day = plInlegDag();
  const months = [];
  for (let i = 0; i < PL_AG_MONTHS; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); months.push(plMonthHtml(d.getFullYear(), d.getMonth(), ev)); }
  return String(tpl`<section class="pl-ag" aria-labelledby="pl-ag-t"><div class="pl-ag-h"><h2 id="pl-ag-t">Geldagenda</h2>
      <span class="pl-leg"><span><i class="pl-dot inleg"></i>inleg</span><span><i class="pl-dot dividend"></i>dividend</span><span><i class="pl-dot belasting"></i>belasting</span></span>
      <label class="pl-day">Inlegdag <select data-pl-day aria-label="Dag van de maand waarop je inlegt"><option value="">geen</option>${Array.from({ length: 28 }, (_, i) => tpl`<option value="${i + 1}" ${raw(day === i + 1 ? 'selected' : '')}>${i + 1}</option>`)}</select></label>
      <button type="button" class="btn ghost" data-pl-ics>In mijn agenda zetten</button></div>
    <div class="pl-months">${months}</div>
    <p class="sub">${(day ? 'Inleg op de ' + day + 'e van de maand (' + eur(K.P.monthly) + '). ' : 'Kies je inlegdag om je inleg in de agenda te zien. ') +
      'Dividend: aangekondigd of verwacht uit je eerdere uitkeringen. De knop maakt een agendabestand (.ics) van de komende twaalf maanden; er gaat niets naar buiten.'}</p></section>`);
}
// Agendabestand voor de komende twaalf maanden, hier in de browser gemaakt
function plIcs() {
  const K = plCore();
  const ev = plEvents(K, 12);
  const d8 = (t) => { const d = new Date(t); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); };
  const clean = (s) => String(s).replace(/[\\,;]/g, (c) => '\\' + c).replace(/\n/g, ' ');
  // Bedragen alleen als ze zichtbaar zijn (bij "bedragen verbergen" geeft eur() puntjes)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Investeringstracker//Geldagenda//NL', 'CALSCALE:GREGORIAN'];
  ev.forEach((e, i) => lines.push('BEGIN:VEVENT', 'UID:geldagenda-' + d8(e.t) + '-' + i + '@investeringstracker', 'DTSTAMP:' + d8(Date.now()) + 'T000000Z',
    'DTSTART;VALUE=DATE:' + d8(e.t), 'DTEND;VALUE=DATE:' + d8(e.t + DAY + 2 * HOUR), 'SUMMARY:' + clean(e.label + (isNum(e.v) ? ' ' + eur(e.v) : '')), 'END:VEVENT'));
  lines.push('END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'geldagenda.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(ev.length + (ev.length === 1 ? ' afspraak' : ' afspraken') + ' in geldagenda.ics; open het bestand om ze aan je agenda toe te voegen.');
}

// ---------- Hoofdstukbalk en openingen ----------
function plNavHtml(chs) {
  return String(tpl`<nav class="an-nav pl-nav" aria-label="Hoofdstukken van je plan"><div class="an-nav-in">
    <ol>${chs.map((c, i) => tpl`<li><a href="#${c.id}" data-an-ch="${c.id}"><span class="no">${anNo(i)}</span> ${c.title}</a></li>`)}</ol>
    <span class="an-date">${eur(K0monthly()) + ' per maand · 7% per jaar'}</span></div><i class="an-prog" aria-hidden="true"></i></nav>`);
}
const K0monthly = () => { try { return projection().monthly; } catch (e) { return null; } };
// Opening: groot nummer, titel en aantal onderdelen; de eerste twee met de kern in één zin en vier cijfers
function plOpener(i, c, count, K) {
  const head = tpl`<div class="an-oh"><span class="an-big" aria-hidden="true">${anNo(i)}</span><h2>${c.title}</h2>${isNum(count) ? tpl`<p class="an-cnt">${count + (count === 1 ? ' onderdeel' : ' onderdelen')}</p>` : ''}</div>`;
  const fig = (k, v, cls) => tpl`<div><span class="k">${k}</span><b class="${cls || ''}">${v}</b></div>`;
  let lead = c.sub, figs = null;
  if (K && i === 0) {
    const open = K.goals.filter((x) => !x.done), done = K.goals.filter((x) => x.done);
    const bits = [K.dep > 0 ? 'Je legde deze maand ' + eur(K.dep) + ' in, bij een plan van ' + eur(K.P.monthly) + ' per maand.' : 'Je plan is ' + eur(K.P.monthly) + ' per maand; deze maand is er nog niets gestort.'];
    if (done.length) bits.push((done.length === 1 ? 'Je doel ' + done[0].g.name + ' is gehaald' : done.length + ' doelen zijn gehaald') + (open.length ? ',' : '.'));
    if (open.length) bits.push((done.length ? 'voor ' : 'Voor ') + open.map((x) => x.g.name.toLowerCase() + ' heb je ' + PCT0.format(Math.min(1, x.pct || 0))).join(' en voor ') + '.');
    lead = bits.join(' ');
    figs = [fig('Inleg deze maand', eur(K.dep) + ' van ' + eur(K.P.monthly)), fig('Doelen', K.goals.length ? done.length + ' van ' + K.goals.length + ' gehaald' : 'nog geen', done.length ? 'gain' : ''),
      fig('Streefverdeling', !K.hasTargets ? 'niet ingesteld' : K.D ? K.D.big.length + ' te ver af' : 'binnen ' + K.lim + ' pp', K.D ? 'loss' : K.hasTargets ? 'gain' : ''),
      fig('Dividend 12 mnd', eur(K.F.total), K.F.total ? 'gain' : '')];
  } else if (K && i === 1) {
    const g = K.P.sets.find((s) => s.label === 'Gemiddeld'), v = K.P.sets.find((s) => s.label === 'Voorzichtig'), b = K.P.sets.find((s) => s.label === 'Gunstig');
    if (g && v) {
      lead = 'Met ' + eur(K.P.monthly) + ' per maand en ' + PCT0.format(g.r) + ' per jaar sta je na ' + K.P.years + ' jaar rond ' + eur(g.end) + '; voorzichtig gerekend (' + PCT0.format(v.r) + ') rond ' + eur(v.end) + '. Rekenvoorbeeld, geen belofte.';
      figs = [fig('Gemiddeld, ' + K.P.years + ' jaar', eur(g.end)), fig('Voorzichtig', eur(v.end)), fig('Gunstig', b ? eur(b.end) : '–'),
        fig(K.P.goal ? 'Doel van ' + eur(K.P.goal) : 'Alleen inleg', K.P.goal ? (g.reached ? fMonthYear.format(g.reached) : 'niet binnen 60 jaar') : eur(K.P.dep[K.P.dep.length - 1].v))];
    }
  }
  return String(tpl`<div class="${'an-open' + (figs ? ' an-first' : '')}">${head}<div class="an-ob"><p class="an-lead">${lead}</p>${figs ? tpl`<div class="an-figs">${figs}</div>` : ''}</div></div>`);
}

// Kop van Plannen: kerncijfers, geldagenda en hoofdstukbalk. Geeft de gedeelde cijfers terug voor de openingen.
function plHead() {
  if (!M) return null;
  const K = plCore();
  const host = $(mode === 'm' ? 'm-pl-head' : 'pl-head');
  if (host) host.innerHTML = plKpis(K) + '<div class="' + (mode === 'm' ? 'pl-agwrap' : 'wrap pl-agwrap') + '">' + plAgenda(K) + '</div>' + (mode === 'm' ? '' : plNavHtml(plChapters()));
  return K;
}
// Eén hoofdstuk als HTML (de gewone versie van de pagina); de componentenversie bouwt hetzelfde in Preact
function plChapterHtml(c, i, ownHtml, K) {
  const tiles = ownHtml.concat(c.tiles()).filter(Boolean);
  return '<div class="dash-sec an-ch pl-ch" data-sec="' + c.id + '" id="' + c.id + '"><div class="section-head"><h2>' + esc(c.title) + '</h2><p class="muted small">' + esc(c.sub) + '</p></div>' +
    plOpener(i, c, tiles.length, K) + '<div class="plan-grid">' + tiles.join('') + '</div></div>';
}

document.addEventListener('change', (e) => {
  const s = near(e, '[data-pl-day]');
  if (!s) return;
  const v = s.value ? Number(s.value) : null;
  savePrefsSafe({ inlegDag: v }).then(() => refresh('plan')).catch((err) => toast('Opslaan mislukt: ' + String(err && err.message || err).slice(0, 120)));
});
document.addEventListener('click', (e) => { if (near(e, '[data-pl-ics]')) plIcs(); });
