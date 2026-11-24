/* Investeringstracker – Analyse als jaarrapport (ontwerp 2026, variant AN-B2): kerncijfers in één strook, een balk met
 * de vijf hoofdstukken (blijft staan bij het scrollen) en per hoofdstuk een opening met nummer, titel en het aantal
 * onderdelen; het eerste hoofdstuk opent met de kern in één zin, vier cijfers en een grafiek. De onderdelen zelf staan
 * in js/16-analyse.js en verder; de pagina wordt opgebouwd in renderAnalyse (js/18-gemak.js).
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

const fRapport = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
const anNo = (i) => String(i + 1).padStart(2, '0');

// Alle kosten van orders (wissel- en andere kosten), en de cijfers die de strook en hoofdstuk 01 delen
function anCore() {
  const fees = sum(M.tx.trades.map((x) => (x.feeFx || 0) + (x.feeOther || 0)));
  const twr = accountTwr();
  const B = benchModel(benchPick());
  const D = drawdownModel(TOTAL);
  return { fees, twr, B, D, vsB: B && B.now > 0 ? M.accountNow / B.now - 1 : null };
}

// Vijf kerncijfers in één strook (dezelfde opmaak als op Bedrijven)
function anKpis(K) {
  const cell = (k, v, sub, cls) => tpl`<div class="bc-k"><span class="k">${k}</span><b class="v ${cls || ''}">${v}</b><span class="sub">${sub}</span></div>`;
  const { fees, twr, B, D, vsB } = K;
  return String(tpl`<div class="bc-kpis an-kpis" role="group" aria-label="Kerncijfers van het rapport">${[
    cell('Accountwaarde', eur(M.accountNow), M.companies.length + (M.companies.length === 1 ? ' positie' : ' posities')),
    cell('Tijdgewogen rendement', twr ? spct1(twr.total) : '–', twr ? 'sinds ' + fDM.format(twr.from) : 'na twee weekmetingen', twr ? tone(twr.total) : ''),
    cell('Tegenover ' + (B ? B.label : benchLabel(benchPick())), isNum(vsB) ? spct1(vsB) : '–', B ? seur(M.accountNow - B.now) + ' verschil' : 'nog geen koersen van de maatstaf', tone(vsB)),
    cell('Grootste daling', D ? spct1(D.maxDd) : '–', D ? (D.recovered ? 'hersteld na ' + Math.round((D.recovered - D.maxAt.t) / DAY) + ' dagen' : D.maxDd < -0.001 ? 'nog niet hersteld' : 'geen daling') : 'na tien meetdagen', D && D.maxDd < -0.0005 ? 'loss' : ''),
    cell('Kosten', eur(K.fees), fees ? 'wissel- en orderkosten samen' : 'nog geen kosten betaald'),
  ]}</div>`);
}

// De balk met hoofdstukken: springen naar een hoofdstuk, het huidige oplichten en een streep die meeloopt
function anNavHtml(secs) {
  return String(tpl`<nav class="an-nav" aria-label="Hoofdstukken van het rapport"><div class="an-nav-in">
    <ol>${secs.map((s, i) => tpl`<li><a href="#${s[0]}" data-an-ch="${s[0]}"><span class="no">${anNo(i)}</span> ${s[1]}</a></li>`)}</ol>
    <span class="an-date">${'Rapport van ' + fRapport.format(Date.now())}</span></div><i class="an-prog" aria-hidden="true"></i></nav>`);
}

// Opening van een hoofdstuk. Het eerste krijgt de kern in één zin, vier cijfers en een grafiek (jij tegenover de maatstaf).
function anOpener(i, title, sub, count, K) {
  const head = tpl`<div class="an-oh"><span class="an-big" aria-hidden="true">${anNo(i)}</span><h2>${title}</h2>${isNum(count) ? tpl`<p class="an-cnt">${count + (count === 1 ? ' onderdeel' : ' onderdelen')}</p>` : ''}</div>`;
  if (i !== 0 || !K) return String(tpl`<div class="an-open">${head}<div class="an-ob"><p class="an-lead">${sub}</p></div></div>`);
  const { twr, B, D, vsB } = K;
  const bits = [];
  if (twr) bits.push('Sinds ' + fDM.format(twr.from) + ' ' + spct1(twr.total) + ' tijdgewogen.');
  if (B) bits.push('Met dezelfde stortingen in de ' + B.label + ' had je nu ' + eur(B.now) + ', ' + (M.accountNow >= B.now ? 'dus ' + eur(M.accountNow - B.now) + ' minder' : 'dus ' + eur(B.now - M.accountNow) + ' meer') + ' dan nu.');
  if (D && D.maxDd < -0.0005) bits.push('De grootste daling was ' + spct1(D.maxDd) + '.');
  const fig = (k, v, cls) => tpl`<div><span class="k">${k}</span><b class="${cls || ''}">${v}</b></div>`;
  return String(tpl`<div class="an-open an-first">${head}<div class="an-ob">
    <p class="an-lead">${bits.length ? bits.join(' ') : sub}</p>
    <div class="an-figs">${[
      fig('Tijdgewogen', twr ? spct1(twr.total) : '–', twr ? tone(twr.total) : ''),
      fig('Tegenover ' + (B ? B.label : 'maatstaf'), isNum(vsB) ? spct1(vsB) : '–', tone(vsB)),
      fig('Grootste daling', D ? spct1(D.maxDd) : '–', D && D.maxDd < -0.0005 ? 'loss' : ''),
      fig('Kosten', eur(K.fees)),
    ]}</div>
    <div class="chart an-chart" data-chart="an-lead" role="img" aria-label="${B ? 'Jij tegenover ' + B.label : 'Verloop van je beleggingen'}"></div>
    ${B ? tpl`<div class="legend chart-legend"><span><i style="background:${C.accent}"></i>Jij</span><span><i class="dash"></i>${B.label}</span></div>` : ''}
  </div></div>`);
}
function drawAnLead(root) {
  const host = /** @type {HTMLElement|null} */ (root.querySelector('[data-chart="an-lead"]'));
  if (!host) return;
  const B = benchModel(benchPick());
  if (B) {
    const bl = B.mine.map((p) => { const q = priceOn(B.line, p.t); return { t: p.t, v: q ? q.v : null }; });
    lineChart(host, [{ pts: B.mine, color: C.accent, width: 2.5, label: 'Jij' }, { pts: bl, color: C.ink2, dash: true, width: 2, label: B.label }], { zoom: false, table: false, top: 0.08, bottom: 0.08 });
  } else {
    lineChart(host, [{ pts: seriesFor(TOTAL, 'all'), color: C.accent, width: 2.5 }], { zoom: false, table: false, empty: 'Nog te weinig metingen voor een grafiek.' });
  }
}

// Kop van de pagina: kerncijfers en de hoofdstukbalk (computer en telefoon)
function anHead(secs) {
  const K = anCore();
  const host = $(mode === 'm' ? 'm-an-head' : 'an-head');
  if (host) host.innerHTML = anKpis(K) + (mode === 'm' ? '' : anNavHtml(secs));
  return K;
}

// Welk hoofdstuk is in beeld, en hoe ver ben je in het rapport (alleen op de computer; Analyse en Plannen)
const AN_BODY = { stats: 'analyse-body', plan: 'plan-body' };
let anNavRaf = 0;
function anNavTrack() {
  if (anNavRaf) return;
  anNavRaf = requestAnimationFrame(() => {
    anNavRaf = 0;
    const bid = AN_BODY[ui.page];
    const nav = bid ? document.querySelector('#page-' + ui.page + ' .an-nav') : null;
    if (!nav || mode === 'm') return;
    const secs = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('#' + bid + ' .an-ch:not([hidden])')]);
    const line = nav.getBoundingClientRect().bottom + 24;
    let cur = secs[0];
    secs.forEach((s) => { if (s.getBoundingClientRect().top <= line) cur = s; });
    nav.querySelectorAll('[data-an-ch]').forEach((a) => a.toggleAttribute('aria-current', !!cur && /** @type {HTMLElement} */ (a).dataset.anCh === cur.dataset.sec));
    const body = $(bid);
    const r = body ? body.getBoundingClientRect() : null;
    const p = r && r.height > innerHeight ? Math.min(1, Math.max(0, (line - r.top) / (r.height - innerHeight + line))) : 0;
    const bar = /** @type {HTMLElement|null} */ (nav.querySelector('.an-prog'));
    if (bar) bar.style.transform = 'scaleX(' + p.toFixed(3) + ')';
  });
}
addEventListener('scroll', anNavTrack, { passive: true });
document.addEventListener('click', (e) => {
  const a = near(e, '[data-an-ch]');
  if (!a) return;
  e.preventDefault();
  const sec = document.querySelector('.an-ch[data-sec="' + CSS.escape(a.dataset.anCh || '') + '"]');
  if (sec) sec.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
});
