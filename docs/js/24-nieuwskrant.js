/* Investeringstracker – Nieuws als ochtendkrant (stap 4 van het nieuwe uiterlijk, v76)
 * Bovenaan de nieuwspagina: stemmingsbalk, een strook kerncijfers, het belangrijkste bericht met de koers van dat
 * aandeel en de berichten als stipjes erop, "wat heb ik gemist" ernaast, en vier kolommen (officieel, geruchten,
 * markt, cijfers). Daaronder de bestaande onderdelen in secties met de titel links (zie nkSec).
 * Alles is HTML-tekst, zodat de componentenversie (js/nieuws-preact.js) en de gewone versie (js/12-nieuws.js)
 * dezelfde voorpagina tonen.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

const NK_WEEKDAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const nkFresh = (n) => !!n.breaking && Date.now() - n.t < DAY;
const nkToneIcon = (t) => tpl`<i class="${'nk-ic ' + (t || 'neu')}" aria-hidden="true"></i>`;

// Stemming over de koppen van je aandelen en volglijst (zoals newsMood op Overzicht, maar over de hele lijst)
function nkMood(items) {
  const c = { pos: 0, neg: 0, neu: 0 };
  items.forEach((n) => { c[newsTone(n)]++; });
  const n = c.pos + c.neg + c.neu;
  const word = !n ? 'nog geen koppen' : c.pos > 0 && c.pos >= c.neg * 2 ? 'overwegend positief' : c.neg > 0 && c.neg >= c.pos * 2 ? 'overwegend negatief'
    : c.pos > c.neg ? 'iets vaker positief' : c.neg > c.pos ? 'iets vaker negatief' : 'gemengd';
  return Object.assign(c, { n, word, tone: /positief/.test(word) ? 'gain' : /negatief/.test(word) ? 'loss' : '' });
}

// Stemmingsbalk over de volle breedte: groen, grijs en rood naar het aantal koppen
function nkMoodBar(items) {
  const m = nkMood(items);
  if (!m.n) return '';
  return String(tpl`<div class="nk-bar" role="img" aria-label="${m.pos + ' positief, ' + m.neu + ' neutraal, ' + m.neg + ' negatief van ' + m.n + ' koppen'}">
    <i class="pos" style="${'flex:' + m.pos}"></i><i class="neu" style="${'flex:' + m.neu}"></i><i class="neg" style="${'flex:' + m.neg}"></i></div>`);
}

// Kwartaalcijfers in de komende 7 dagen, voor de strook en de kolom Cijfers
function nkEarnWeek() {
  const S = typeof earnSeasonRows === 'function' ? earnSeasonRows() : { soon: [], done: [] };
  const end = dayStart(Date.now()) + 7 * DAY;
  return { S, week: S.soon.filter((x) => x.t <= end) };
}

// Strook met vijf kerncijfers
function nkKpis(items, flash) {
  const X = missedModel();
  const m = nkMood(items.filter((n) => n.tk));
  const fresh = flash.filter(nkFresh);
  const offi = flash.filter((n) => n.kind === 'official').length, rum = flash.filter((n) => n.kind === 'rumour').length;
  const { week } = nkEarnWeek();
  const freshTk = [...new Set(fresh.map((n) => n.tk))];
  const cell = (k, v, sub, cls) => tpl`<div class="nk-k"><span class="k">${k}</span><b class="${cls || ''}">${v}</b><span class="sub">${sub}</span></div>`;
  return String(tpl`<div class="nk-kpis">
    ${cell('Sinds je vorige bezoek', X.news.length + (X.news.length === 1 ? ' bericht' : ' berichten'), X.first ? 'eerste bezoek op dit apparaat: de laatste week' : fDT.format(X.since))}
    ${cell('Stemming', m.word, m.n ? m.pos + ' positief · ' + m.neg + ' negatief van ' + m.n + ' koppen' : 'nog geen nieuws over je aandelen', m.tone)}
    ${cell('Breaking', String(fresh.length), fresh.length ? freshTk.slice(0, 3).join(' en ') + ', laatste etmaal' : 'niets in het laatste etmaal', fresh.length ? 'loss' : '')}
    ${cell('Officieel en geruchten', offi + ' · ' + rum, 'laatste twee weken')}
    ${cell('Cijfers deze week', String(week.length), week.length ? week.slice(0, 4).map((x) => x.tk + ' ' + NK_WEEKDAY.format(x.t)).join(' · ') : 'geen kwartaalcijfers van je aandelen')}
  </div>`);
}

// Het belangrijkste bericht: verse breaking eerst, dan belangrijk officieel nieuws, dan het bericht over je
// eigen aandelen met de meeste bronnen, en anders gewoon het nieuwste
function nkLeadPick(items, flash) {
  const fresh = flash.filter(nkFresh);
  if (fresh.length) return { n: fresh[0], src: 1, fresh: true };
  const big = flash.find((n) => n.breaking);
  if (big) return { n: big, src: 1, fresh: false };
  const mine = items.filter((n) => n.kind === 'mine');
  const cls = typeof newsClusters === 'function' ? newsClusters(mine.length ? mine : items) : [];
  const best = cls.slice(0, 12).sort((a, b) => b.sources.length - a.sources.length || b.lead.t - a.lead.t)[0];
  if (best) return { n: best.lead, src: best.sources.length, fresh: false };
  return items[0] ? { n: items[0], src: 1, fresh: false } : null;
}

// Koers van één aandeel over 14 dagen met de berichten als stipjes op de lijn
function nkPricePts(tk) {
  const from = Date.now() - 14 * DAY;
  const held = M.byTk.has(tk);
  const pts = held ? marketSeries(tk, '1m') : (M.mk.ok ? M.mk.prices(tk) : []);
  return (pts || []).filter((p) => p.t >= from && isNum(p.v));
}
function nkChart(tk, items) {
  const pts = nkPricePts(tk);
  if (pts.length < 3) return '';
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const X = (t) => (t1 > t0 ? (t - t0) / (t1 - t0) * 100 : 50);
  const Y = (v) => (hi > lo ? 12 + (hi - v) / (hi - lo) * 76 : 50);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + (X(p.t) * 6).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join('');
  const dots = items.filter((n) => n.tk === tk && n.t >= t0 && n.t <= t1 + DAY).slice(0, 8).map((n) => {
    const p = pts[nearestIdx(pts, n.t)];
    return tpl`<span class="${'nk-dot ' + newsTone(n)}" style="${'left:' + X(p.t).toFixed(1) + '%;top:' + Y(p.v).toFixed(1) + '%'}" title="${fDT.format(n.t) + ': ' + n.headline}"></span>`;
  });
  return String(tpl`<div class="nk-plot"><svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>${dots}</div>`);
}

function nkLead(items, flash) {
  const L = nkLeadPick(items, flash);
  if (!L) return String(tpl`<article class="nk-lead"><p class="muted">Nog geen nieuws over je aandelen. ${FEAT().has.finnhub || demo ? '' : 'Met een gratis Finnhub-sleutel haalt de Worker per aandeel het nieuws op.'}</p></article>`);
  const n = L.n, tk = n.tk;
  const c = tk ? M.byTk.get(tk) : null;
  const kind = n.kind === 'official' ? 'Officieel' : n.kind === 'rumour' ? 'Gerucht' : null;
  const chart = tk ? nkChart(tk, items.concat(flash)) : '';
  const chg = c && isNum(c.changePct) ? c.changePct : null;
  const forYou = c ? tk + ' is ' + (isNum(c.weight) ? P1.format(c.weight) + ' van je beleggingen' : 'een van je posities') + (isNum(chg) ? ' en ' + (chg >= 0 ? 'steeg ' : 'daalde ') + M.dayWord + ' ' + P2.format(Math.abs(chg)) : '') + '.'
    : tk && watchSyms().includes(tk) ? tk + ' staat op je volglijst; je hebt het aandeel niet.' : '';
  return String(tpl`<article class="nk-lead">
    <p class="nk-meta">${L.fresh ? tpl`<span class="nk-brk">Breaking</span>` : null}${nkToneIcon(newsTone(n))}${[tk || 'Markt', (n.source === 'SEC' ? fD : fDT).format(n.t), n.source, L.src > 1 ? L.src + ' bronnen' : null, kind].filter(Boolean).join(' · ')}</p>
    <h2 class="nk-h"><a href="${safeUrl(n.url)}" target="_blank" rel="noopener">${n.headline}</a></h2>
    ${n.summary ? tpl`<p class="nk-sum">${n.summary}</p>` : null}
    ${chart || forYou ? tpl`<div class="nk-box">
      ${chart ? tpl`<p class="nk-box-h"><span><b>${tk}</b> · koers, 14 dagen, met de berichten</span>${isNum(chg) ? tpl`<b class="${tone(chg)}">${spct(chg) + ' ' + M.dayWord}</b>` : null}</p>${raw(chart)}` : null}
      ${forYou ? tpl`<p class="nk-you"><b>Voor jou.</b> ${forYou}</p>` : null}</div>` : null}
  </article>`);
}

// Wat heb ik gemist: in korte zinnen, met een knop naar de hele pagina (#gemist)
function nkMissed(flash) {
  const X = missedModel();
  const lines = [];
  const brk = flash.filter((n) => n.breaking && n.t > X.since).length;
  if (X.news.length) lines.push(X.news.length + (X.news.length === 1 ? ' bericht' : ' berichten') + ' sinds ' + (X.first ? 'een week geleden' : fHM.format(X.since) + (Date.now() - X.since > DAY ? ' op ' + fD.format(X.since) : '')) + (brk ? ', ' + brk + ' daarvan breaking' : '') + '.');
  X.moves.filter((m) => Math.abs(m.pct) >= 0.03).slice(0, 2).forEach((m) => lines.push(m.name + (m.pct < 0 ? ' daalde ' : ' steeg ') + P2.format(Math.abs(m.pct)) + (m.held ? '' : ' (volglijst)') + '.'));
  X.anal.slice(0, 2).forEach((a) => lines.push(a.tk + ': ' + a.txt + '.'));
  X.divs.slice(0, 1).forEach((d) => lines.push('Dividend van ' + d.ticker + ' ontvangen: ' + eur(d.amount) + '.'));
  if (isNum(X.tot)) lines.push('Je beleggingen samen: ' + spct1(X.tot) + '.');
  return String(tpl`<aside class="nk-missed" aria-labelledby="nk-missed-h"><h3 id="nk-missed-h">Wat heb ik gemist</h3>
    ${lines.length ? tpl`<ul>${lines.map((l) => tpl`<li>${l}</li>`)}</ul>` : tpl`<p class="muted">Niets nieuws sinds je vorige bezoek.</p>`}
    <p><a class="link" href="#gemist">Alles bekijken</a></p>
    <p class="sub">Het tijdstip van je vorige bezoek staat alleen op dit apparaat, niet in je Worker.</p></aside>`);
}

// Vier kolommen met de drie nieuwste berichten per soort
function nkCols(items, flash) {
  const row = (x) => {
    const inner = tpl`${nkToneIcon(x.tone)}<span><b>${x.title}</b><span class="sub">${x.meta}</span></span>`;
    return x.url ? tpl`<a class="nk-row" href="${safeUrl(x.url)}" target="_blank" rel="noopener">${inner}</a>`
      : tpl`<button type="button" class="nk-row" data-ticker="${x.ticker}">${inner}</button>`;
  };
  const fromNews = (n) => ({ tone: newsTone(n), title: n.headline, meta: (n.tk || 'Markt') + ' · ' + (n.source === 'SEC' ? fD : fDT).format(n.t), url: n.url });
  const { S } = nkEarnWeek();
  const earn = S.soon.slice(0, 1).map((x) => ({ tone: 'neu', title: x.name + ': kwartaalcijfers op ' + fD.format(x.t), meta: x.tk + (x.held ? '' : ' · volglijst'), ticker: x.held ? x.tk : '~' + x.tk }))
    .concat(S.done.slice(0, 2).map((x) => ({ tone: isNum(x.eps.pct) ? (x.eps.pct > 0 ? 'pos' : x.eps.pct < 0 ? 'neg' : 'neu') : 'neu', title: x.name + ': ' + epsVsText(x.eps), meta: x.tk + ' · ' + fD.format(x.t), ticker: x.held ? x.tk : '~' + x.tk })));
  const col = (key, title, list, empty) => tpl`<section class="${'nk-col ' + key}"><h3>${title}</h3>${list.length ? list.map(row) : tpl`<p class="muted small">${empty}</p>`}</section>`;
  return String(tpl`<div class="nk-cols">
    ${col('off', 'Officieel', flash.filter((n) => n.kind === 'official').slice(0, 3).map(fromNews), 'Geen officiële berichten in de laatste twee weken.')}
    ${col('rum', 'Geruchten', flash.filter((n) => n.kind === 'rumour').slice(0, 3).map(fromNews), 'Geen geruchten over je aandelen gevonden.')}
    ${col('mkt', 'Markt', items.filter((n) => n.kind === 'market').slice(0, 3).map(fromNews), 'Marktnieuws komt van Finnhub en wordt buiten de handelsuren opgehaald.')}
    ${col('cij', 'Cijfers', earn, 'Geen kwartaalcijfers in de komende vier weken.')}
  </div>`);
}

// De hele voorpagina in één keer (de gewone versie en de componentenversie gebruiken dit allebei)
function nkFrontParts() {
  const items = newsItems(), flash = flashItems();
  return { bar: nkMoodBar(items.filter((n) => n.tk)), kpis: nkKpis(items, flash), lead: nkLead(items, flash), missed: nkMissed(flash), cols: nkCols(items, flash) };
}
// Een sectie met de titel links en de inhoud rechts (zoals Overzicht)
const nkSec = (id, title, sub, inner) => '<section class="nk-sec" id="nk-' + id + '"><div class="nk-sh"><h2>' + esc(title) + '</h2>' + (sub ? '<p class="muted small">' + esc(sub) + '</p>' : '') + '</div><div class="nk-sb">' + inner + '</div></section>';
// Naar een sectie schuiven. Tegels buiten beeld hebben content-visibility: auto en krijgen hun echte hoogte pas
// als ze in beeld komen; daardoor verschuift het doel tijdens het schuiven. Na afloop zetten we het recht.
function nkGo(el) {
  if (!el) return;
  const smooth = !reduceMotion();
  el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  let n = 0;
  const fix = () => {
    const top = el.getBoundingClientRect().top;
    if (Math.abs(top - 72) > 24 && n++ < 4) { el.scrollIntoView({ block: 'start' }); requestAnimationFrame(() => requestAnimationFrame(fix)); }
  };
  if (smooth && 'onscrollend' in window) window.addEventListener('scrollend', fix, { once: true });
  else setTimeout(fix, smooth ? 900 : 60);
}
// Tabbladen op de computer springen naar de sectie
document.addEventListener('click', (e) => {
  const b = e.target && e.target.closest ? e.target.closest('[data-nk-go]') : null;
  if (b) nkGo($(b.dataset.nkGo === 'news' ? 'news-body' : 'nk-' + b.dataset.nkGo));
});
