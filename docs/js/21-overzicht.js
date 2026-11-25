/* Investeringstracker – Overzicht: periode en vergelijkingslijn van de grote grafiek, dagsamenvatting,
 * stijgers en dalers in één strook, dividend dat eraan komt, mijlpalen, stortingsreeks en de rustige modus
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Periode van de grote grafiek (per apparaat bewaard) ----------
const HERO_RANGES = [['today', 'Vandaag'], ['1w', '1 week'], ['1m', '30 dagen'], ['ytd', 'Dit jaar'], ['1y', '1 jaar'], ['all', 'Alles']];
const LS_HERO_RANGE = 'tracker.heroRange';
const LS_HERO_CMP = 'tracker.heroCmp';
const LS_CALM = 'tracker.calm';
const LS_MILES = 'tracker.mijlpalen';

function savedHeroRange() {
  try { const k = localStorage.getItem(LS_HERO_RANGE); return HERO_RANGES.some((x) => x[0] === k) ? k : null; } catch (e) { return null; }
}
function saveHeroRange(k) { try { localStorage.setItem(LS_HERO_RANGE, k); } catch (e) { /* niet erg */ } }
// Keuze van de vorige keer meteen overnemen (dit bestand laadt voordat de site tekent)
{ const r = savedHeroRange(); if (r) ui.heroRange = r; else ui.heroRange = '1w'; }

// In de rustige modus vervalt de periode "Vandaag": die gaat over één dag
function heroRangeList() { return calmMode() ? HERO_RANGES.filter(([k]) => k !== 'today') : HERO_RANGES; }
function heroRangeNow() { return calmMode() && ui.heroRange === 'today' ? '1w' : ui.heroRange; }

// ---------- Vergelijkingslijn: niets, je maatstaf of je eigen inleg ----------
const HERO_CMP = [['none', 'Alleen waarde'], ['bench', 'Maatstaf'], ['dep', 'Netto gestort']];
let heroCmp = (() => { try { const k = localStorage.getItem(LS_HERO_CMP); return HERO_CMP.some((x) => x[0] === k) ? k : 'none'; } catch (e) { return 'none'; } })();

function heroCmpButtons(p) {
  const host = $(p + 'hero-cmp');
  if (!host) return;
  segButtons(host, HERO_CMP, heroCmp, (k) => {
    heroCmp = k;
    try { localStorage.setItem(LS_HERO_CMP, k); } catch (e) { /* niet erg */ }
    // Een vergelijkingslijn heeft minstens 30 dagen nodig: bij Vandaag of 1 week meteen naar 30 dagen, anders lijkt de knop niets te doen
    if (k !== 'none' && SHORT_RANGES.includes(heroRangeNow())) { ui.heroRange = '1m'; saveHeroRange('1m'); }
    drawHero(p, true);
  });
}
const SHORT_RANGES = ['today', '1w'];
// Kies je zelf een korte periode, dan vervalt de vergelijking (en staat de knop weer op "Alleen waarde")
function heroCmpFitRange(k) {
  if (heroCmp === 'none' || !SHORT_RANGES.includes(k)) return;
  heroCmp = 'none';
  try { localStorage.setItem(LS_HERO_CMP, 'none'); } catch (e) { /* niet erg */ }
}

const MIN_CMP_MS = 20 * DAY;   // korter dan dit heeft geen zin: maatstaf en stortingen komen één keer per dag binnen

// Extra lijnen voor de grote grafiek. De punten krijgen dezelfde tijdstippen als de hoofdlijn,
// want lineChart legt alle reeksen op de tijdas van de eerste reeks.
function heroCmpSets(pts) {
  if (heroCmp === 'none' || pts.length < 2) return { sets: [], note: '' };
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  if (t1 - t0 < MIN_CMP_MS) return { sets: [], note: 'De vergelijkingslijn werkt vanaf de periode “30 dagen”: je maatstaf en je stortingen worden één keer per dag bijgewerkt.' };
  if (heroCmp === 'dep') {
    const W = M.weeks.filter((w) => isNum(w.netDeposits) && w.t <= t1 + DAY).map((w) => ({ t: w.t, v: w.netDeposits }));
    if (W.filter((w) => w.t >= t0 - 10 * DAY).length < 2) return { sets: [], note: 'Nog te weinig weekmetingen om je inleg over deze periode te tekenen.' };
    const line = pts.map((p) => { const w = priceOn(W, p.t); return { t: p.t, v: w ? w.v : null }; });
    return {
      sets: [{ pts: line, color: C.ink2, dash: true, width: 2, label: 'Netto gestort' }],
      note: 'Streeplijn: netto gestort op je hele rekening (dus inclusief vrij saldo), uit je weekmetingen. De ruimte tussen de lijnen is grofweg wat de markt heeft gedaan.',
    };
  }
  const k = typeof benchPick === 'function' ? benchPick() : null;
  const bp = k ? benchPts(k) : [];
  const start = bp.length ? priceOn(bp, t0) : null;
  if (!start || !(start.v > 0)) {
    return { sets: [], note: 'Nog geen koersen van je maatstaf voor deze periode. Je kiest de maatstaf op Analyse; de koersen worden één keer per dag opgehaald.' };
  }
  const f = pts[0].v / start.v;
  const line = pts.map((p) => { const x = priceOn(bp, p.t); return { t: p.t, v: x ? x.v * f : null }; });
  if (line.filter((p) => isNum(p.v)).length < 3) return { sets: [], note: 'Nog te weinig koersen van je maatstaf voor deze periode.' };
  return {
    sets: [{ pts: line, color: C.ink2, dash: true, width: 2, label: benchLabel(k) }],
    note: 'Streeplijn: ' + benchLabel(k) + ', op ' + fDM.format(t0) + ' gelijkgezet aan jouw waarde (koersen zonder dividend, omgerekend naar euro). Je kiest je maatstaf op Analyse.',
  };
}

// ---------- Rustige modus: geen dagveranderingen, alleen maandresultaten ----------
function calmMode() { try { return localStorage.getItem(LS_CALM) === '1'; } catch (e) { return false; } }
function applyCalm() {
  if (calmMode()) document.documentElement.dataset.calm = '1';
  else delete document.documentElement.dataset.calm;
}
applyCalm();

// Keuzevakje bij Instellingen → Weergave (per apparaat, net als de andere weergavekeuzes)
(function calmOption() {
  const box = document.querySelector('[data-theme-pick]') && document.querySelector('[data-theme-pick]').closest('.install-box');
  if (!box || box.querySelector('[data-calm-opt]')) return;
  const div = document.createElement('div');
  div.className = 'calm-opt';
  div.innerHTML = '<h3 style="margin-top:14px">Rustig kijken</h3>' +
    '<label class="check"><input type="checkbox" data-calm-opt' + (calmMode() ? ' checked' : '') + '> Rustige modus: geen dagveranderingen, alleen maandresultaten</label>' +
    '<p class="muted small" style="margin-top:6px">Op het overzicht verdwijnen de dagcijfers: stijgers en dalers van vandaag, de dagsamenvatting en de verandering bovenaan. In plaats daarvan zie je het resultaat per maand uit je weekmetingen. Je grafieken en de andere pagina’s blijven gewoon werken.</p>';
  const disp = box.querySelector('.disp-opts');
  if (disp) disp.before(div); else box.appendChild(div);
})();
document.addEventListener('change', (e) => {
  const t = /** @type {Element} */ (e.target);
  const el = /** @type {HTMLInputElement|null} */ (t && t.closest ? t.closest('[data-calm-opt]') : null);
  if (!el) return;
  try { localStorage.setItem(LS_CALM, el.checked ? '1' : '0'); } catch (err) { /* niet erg */ }
  applyCalm();
  if (typeof rerenderAll === 'function') rerenderAll();
});

// ---------- Resultaat per kalendermaand, uit de weekmetingen (zonder stortingen) ----------
const monKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
function monthResults() {
  const W = M.weeks;
  const by = new Map();
  W.forEach((w, i) => {
    if (!isNum(w.weekResult)) return;
    const k = monKey(w.t);
    const d = new Date(w.t);
    let o = by.get(k);
    if (!o) {
      const prev = W[i - 1];
      const base = prev && isNum(prev.accountValue) ? prev.accountValue : (isNum(w.accountValue) ? w.accountValue - w.weekResult : null);
      o = { k, t: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), v: 0, weeks: 0, base, lastT: w.t };
      by.set(k, o);
    }
    o.v += w.weekResult;
    o.weeks++;
    o.lastT = w.t;
  });
  const list = [...by.values()].sort((a, b) => a.t - b.t);
  list.forEach((o) => { o.pct = o.base > 0 ? o.v / o.base : null; });
  return list;
}
function monthNow() {
  const list = monthResults();
  const k = monKey(Date.now());
  return { list, cur: list.find((x) => x.k === k) || null, prev: list.filter((x) => x.k !== k).pop() || null };
}
const fMonLong = new Intl.DateTimeFormat(LOCALE, { month: 'long' });

// Tekst bovenaan in de rustige modus, in plaats van de dagverandering
function calmChangeLine() {
  const m = monthNow();
  if (m.cur) return 'Deze maand ' + seur(m.cur.v) + (isNum(m.cur.pct) ? ' (' + spct(m.cur.pct) + ')' : '') + ', tot de weekmeting van ' + fD.format(m.cur.lastT);
  if (m.prev) return 'Nog geen weekmeting deze maand. ' + fMonLong.format(m.prev.t) + ': ' + seur(m.prev.v);
  return 'Nog geen maandresultaat; dat volgt na twee weekmetingen.';
}
function calmChangeValue() { const m = monthNow(); return m.cur ? m.cur.v : m.prev ? m.prev.v : null; }

// ---------- Eén regel in gewoon Nederlands over vandaag ----------
// Toon van het nieuws over je eigen aandelen, geschat uit de koppen (zie 12-nieuws.js)
function newsMood(hours) {
  if (typeof newsTone !== 'function') return null;
  const held = new Set(M.companies.map((c) => c.tk));
  const from = Date.now() - (hours || 48) * HOUR;
  let pos = 0, neg = 0, neu = 0;
  Object.entries(data.research || {}).forEach(([tk, r]) => {
    if (!held.has(tk)) return;
    (r.news || []).forEach((n) => {
      if (!isNum(n.t) || n.t < from) return;
      if (typeof newsMuted === 'function' && newsMuted(n)) return;
      const t = newsTone(n);
      if (t === 'pos') pos++; else if (t === 'neg') neg++; else neu++;
    });
  });
  const n = pos + neg + neu;
  if (!n) return null;
  const word = pos > 0 && pos >= neg * 2 ? 'overwegend positief' : neg > 0 && neg >= pos * 2 ? 'overwegend negatief'
    : pos > neg ? 'iets vaker positief dan negatief' : neg > pos ? 'iets vaker negatief dan positief' : 'gemengd';
  return { n, pos, neg, neu, word };
}
function newsMoodSentence() {
  const mood = newsMood(48);
  if (!mood) return '';
  return 'Het nieuws over je aandelen was ' + mood.word + ' (' + mood.pos + ' positief, ' + mood.neg + ' negatief van ' + mood.n + ' koppen, geschat uit de woorden in de kop).';
}

// ---------- Op deze dag (idee 2) ----------
// De dagverandering van het totaal op deze datum een en twee jaar geleden, uit de dagreeks (aan- en verkopen tellen
// niet mee, zie dailyReturns). In het weekend of op een dag zonder meting de handelsdag ervoor; zonder een jaar
// geschiedenis niets. 29 februari wordt in een gewoon jaar 28 februari.
function onThisDay() {
  if (!M) return [];
  const d = seriesOf(TOTAL).daily;
  if (!d.length) return [];
  const rets = new Map(dailyReturns(TOTAL).map((x) => [dayKey(x.t), x]));
  const prevClose = new Map(d.map((x, i) => [dayKey(x.t), i ? d[i - 1].close : null]));
  const now = new Date(M.lastT || Date.now());
  const out = [];
  [1, 2].forEach((n) => {
    const t = new Date(now.getFullYear() - n, now.getMonth(), now.getDate(), 12);
    if (t.getMonth() !== now.getMonth()) t.setDate(0);
    if (t.getTime() < d[0].t - 4 * DAY) return;   // zo ver gaat de geschiedenis niet terug
    for (let k = 0; k < 5; k++, t.setDate(t.getDate() - 1)) {
      const r = rets.get(dayKey(t.getTime()));
      if (!r) continue;
      const pc = prevClose.get(dayKey(r.t));
      out.push({ n, t: r.t, pct: r.pct, amt: isNum(pc) ? r.pct * pc : null });
      return;
    }
  });
  return out;
}
const onThisDayWord = (o) => (o.n === 1 ? 'vorig jaar' : o.n + ' jaar geleden');
function onThisDayText() {
  const L = calmMode() ? [] : onThisDay();
  if (!L.length) return '';
  return 'Op deze dag ' + L.map((o) => onThisDayWord(o) + ' ' + spct(o.pct) + (isNum(o.amt) ? ' (' + seur(o.amt) + ')' : '')).join(', ') + '.';
}

function dayLineText() {
  if (!M) return '';
  if (calmMode()) {
    const m = monthNow();
    const txt = m.cur
      ? 'Deze maand ' + seur(m.cur.v) + (isNum(m.cur.pct) ? ' (' + spct(m.cur.pct) + ')' : '') + ', over ' + m.cur.weeks + (m.cur.weeks === 1 ? ' weekmeting' : ' weekmetingen') + '.'
      : m.prev ? 'Nog geen weekmeting deze maand. ' + fMonLong.format(m.prev.t) + ': ' + seur(m.prev.v) + '.'
        : 'Nog geen maandresultaat; dat volgt na twee weekmetingen.';
    return [txt, newsMoodSentence(), 'Rustige modus staat aan: dagveranderingen blijven verborgen.'].filter(Boolean).join(' ');
  }
  const T = M.tot;
  if (!isNum(T.change)) return 'Nog geen metingen van ' + (M.isToday ? 'vandaag' : 'deze handelsdag') + '. De tracker meet op werkdagen de hele dag, elke 10 minuten.';
  const word = M.dayWord.charAt(0).toUpperCase() + M.dayWord.slice(1);
  const withChange = M.companies.filter((c) => isNum(c.change));
  const up = withChange.filter((c) => c.change > 0).length, down = withChange.filter((c) => c.change < 0).length;
  const dir = Math.abs(T.change) < 0.005 ? 0 : T.change > 0 ? 1 : -1;
  const same = withChange.filter((c) => (dir >= 0 ? c.change > 0 : c.change < 0)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
  let txt;
  if (!dir) txt = word + ' bleef je waarde vrijwel gelijk (' + seur(T.change) + ').';
  else txt = word + ' ' + (dir > 0 ? 'staat er ' : 'ging er ') + seur(T.change).replace(/^[+−]⁠?/, '') + ' ' + (dir > 0 ? 'bij' : 'af') + ' (' + spct(T.changePct) + ')' +
    (same && Math.abs(same.change) >= Math.abs(T.change) * 0.25 ? ', vooral door ' + same.tk + ' (' + seur(same.change) + ')' : '') + '.';
  const breadth = withChange.length ? ' ' + up + ' van je ' + withChange.length + ' posities ' + (up === 1 ? 'steeg' : 'stegen') + ', ' + down + (down === 1 ? ' daalde' : ' daalden') + '.' : '';
  return txt + breadth + (newsMoodSentence() ? ' ' + newsMoodSentence() : '') + (onThisDayText() ? ' ' + onThisDayText() : '');
}

// Samenvatting als blokken over de hele breedte: verandering, grootste stijger en daler, en de toon van het nieuws
function daySumItems() {
  if (!M) return [];
  const mood = newsMood(48);
  const news = mood ? { k: 'Nieuws over je aandelen', v: mood.word.charAt(0).toUpperCase() + mood.word.slice(1),
    s: mood.pos + ' positief · ' + mood.neg + ' negatief van ' + mood.n + ' koppen', t: mood.pos > mood.neg ? 'gain' : mood.neg > mood.pos ? 'loss' : '' } : null;
  if (calmMode()) {
    const m = monthNow();
    const cur = m.cur || m.prev;
    return [
      cur ? { k: m.cur ? 'Deze maand' : fMonLong.format(cur.t), v: seur(cur.v), s: (isNum(cur.pct) ? spct(cur.pct) + ', ' : '') + cur.weeks + (cur.weeks === 1 ? ' weekmeting' : ' weekmetingen'), t: tone(cur.v) }
        : { k: 'Deze maand', v: '–', s: 'Volgt na twee weekmetingen' },
      news,
      { k: 'Rustige modus', v: 'Aan', s: 'Dagveranderingen blijven verborgen' },
    ].filter(Boolean);
  }
  const T = M.tot;
  if (!isNum(T.change)) return [{ k: M.dayWord.charAt(0).toUpperCase() + M.dayWord.slice(1), v: 'Nog geen metingen', s: 'De tracker meet op werkdagen de hele dag, elke 10 minuten' }].concat(news ? [news] : []);
  const withChange = M.companies.filter((c) => isNum(c.change));
  const by = withChange.slice().sort((x, y) => y.change - x.change);
  const best = by[0] && by[0].change > 0 ? by[0] : null;
  const worst = by.length && by[by.length - 1].change < 0 ? by[by.length - 1] : null;
  const share = (c) => (Math.abs(T.change) >= 0.01 && Math.sign(c.change) === Math.sign(T.change) ? ', ' + PCT0.format(Math.min(1, c.change / T.change)) + ' van de ' + (T.change > 0 ? 'winst' : 'daling') : '');
  const pos = (c, k) => ({ k, v: c.tk, s: spct(c.changePct) + ' · ' + seur(c.change) + share(c), t: tone(c.change), tk: c.tk, name: c.name });
  return [
    { k: M.dayWord.charAt(0).toUpperCase() + M.dayWord.slice(1), v: seur(T.change), s: spct(T.changePct) + ' · ' + withChange.filter((c) => c.change > 0).length + ' van ' + withChange.length + ' posities omhoog', t: tone(T.change) },
    best ? pos(best, 'Grootste stijger') : { k: 'Grootste stijger', v: '–', s: 'Geen positie steeg' },
    worst ? pos(worst, 'Grootste daler') : { k: 'Grootste daler', v: '–', s: 'Geen positie daalde' },
    news,
    onThisDayItem(),
  ].filter(Boolean);
}
function onThisDayItem() {
  const L = onThisDay();
  if (!L.length) return null;
  const [a, b] = L;
  return { k: T('Op deze dag'), v: spct(a.pct), t: tone(a.pct), cls: 'ds-otd',
    s: onThisDayWord(a) + ' (' + fD.format(a.t) + ')' + (isNum(a.amt) ? ', ' + seur(a.amt) : '') + (b ? ' · ' + onThisDayWord(b) + ' ' + spct(b.pct) : '') };
}
function daySumHtml() {
  const items = daySumItems();
  if (!items.length) return '';
  const cell = (x) => {
    const inner = '<span class="ds-k">' + esc(x.k) + '</span><span class="ds-v ' + (x.t || '') + '">' + esc(x.v) + '</span><span class="ds-s">' + esc(x.s || '') + '</span>';
    return x.tk ? '<button type="button" class="ds-c" data-ticker="' + esc(x.tk) + '" aria-label="' + esc(x.k + ': ' + (x.name || x.v) + ', ' + x.s + '. Openen') + '">' + inner + '</button>'
      : '<div class="ds-c' + (x.cls ? ' ' + x.cls : '') + '">' + inner + '</div>';
  };
  return items.map(cell).join('');
}

// ---------- Dividend dat eraan komt: hoeveel dagen, welk bedrag ----------
function divCountTile() {
  const E = M.ev;
  const nameOf = (tk) => { const c = M.byTk.get(tk); return c ? c.name : tk; };
  let body;
  if (!E.loaded) {
    body = '<p class="muted">De agenda met dividenden wordt één keer per dag door de Worker opgehaald (rond 06:15). Na die eerste ronde staat hier wat eraan komt.</p>';
  } else if (!E.divs.length) {
    body = '<p class="muted">' + (E.received.length ? 'Nog geen aangekondigd of verwacht dividend. Voor een verwachting zijn per aandeel minstens twee eerdere uitkeringen nodig.'
      : 'Nog geen dividend ontvangen of aangekondigd om een verwachting op te baseren.') + ' Met een FMP-sleutel ziet de tracker ook aangekondigde dividenden.</p>';
  } else {
    const d = E.divs[0];
    const n = Math.round((dayStart(d.t) - dayStart(Date.now())) / DAY);
    const when = n <= 0 ? 'vandaag' : n === 1 ? 'morgen' : 'over ' + days(n);
    body = '<p class="v big">' + esc(isNum(d.eur) ? '≈ ' + eur(d.eur) : when) + '</p>' +
      '<p class="sub">' + esc(d.tk + ' ' + nameOf(d.tk) + ' · ' + (d.exOnly ? 'ex-dividend ' : d.pay ? 'uitbetaling ' : 'ex-dividend ') + fD.format(d.t) + (isNum(d.eur) ? ', ' + when : '')) + '</p>' +
      '<div class="dv-bar" aria-hidden="true"><div style="width:' + Math.max(4, Math.min(100, 100 - (Math.max(0, n) / 90) * 100)).toFixed(1) + '%"></div></div>' +
      '<p class="sub">' + esc(d.kind === 'Aangekondigd' ? 'Aangekondigd bedrag, bruto (voor bronbelasting).' : 'Verwacht uit je eerdere uitkeringen en je huidige aantal.') + '</p>' +
      (E.divs.length > 1 ? '<div style="margin-top:10px">' + kvList(E.divs.slice(1, 4).map((x) => [x.tk + ' · ' + fDM.format(x.t), (isNum(x.eur) ? '≈ ' + eur(x.eur) : '–') + ' (' + x.kind.toLowerCase() + ')'])) + '</div>' : '') +
      '<p class="sub" style="margin-top:8px">Komende 90 dagen samen ongeveer ' + esc(eur(E.next90)) + '.</p>';
  }
  return '<section class="tile pad"><h3>Volgend dividend</h3>' + body + '</section>';
}

// ---------- Mijlpalen op het overzicht, met een eenmalig feestje ----------
function investStart() {
  const ts = [];
  if (M.tx.list.length) ts.push(M.tx.list[0].t);
  if (M.ev.received[0]) ts.push(M.ev.received[0].t);
  if (M.weeks[0]) ts.push(M.weeks[0].t);
  if (isNum(M.since)) ts.push(M.since);
  M.companies.forEach((c) => { if (isNum(c.since)) ts.push(c.since); });
  return ts.length ? Math.min(...ts) : null;
}

// Maanden met een storting, en hoeveel maanden op rij (de lopende maand mag nog komen)
function depositStreak() {
  const by = new Map();
  M.weeks.forEach((w) => {
    if (!isNum(w.newDeposits) || w.newDeposits <= 0.009) return;
    const k = monKey(w.t);
    by.set(k, (by.get(k) || 0) + w.newDeposits);
  });
  const now = new Date();
  let cur = new Date(now.getFullYear(), now.getMonth(), 1);
  if (!by.has(monKey(cur.getTime()))) cur = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  let streak = 0, lastT = null;
  while (by.has(monKey(cur.getTime()))) {
    if (!streak) lastT = cur.getTime();
    streak++;
    cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1);
  }
  const vals = [...by.values()];
  // Laatste twaalf maanden voor het staafje
  const bars12 = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); bars12.push({ t: d.getTime(), v: by.get(monKey(d.getTime())) || 0 }); }
  return { by, streak, lastT, months: vals.length, total: sum(vals), avg: vals.length ? sum(vals) / vals.length : null, bars12 };
}

function homeMilestones() {
  const W = M.weeks, E = M.ev;
  const out = [];
  const hit1k = W.find((w) => isNum(w.accountValue) && w.accountValue >= 1000);
  out.push({ key: 'k1000', title: 'Eerste € 1.000', t: hit1k ? hit1k.t : null, done: !!hit1k,
    sub: hit1k ? 'bereikt in de week tot ' + fDM.format(hit1k.t) : isNum(M.accountNow) && M.accountNow > 0 ? 'nu ' + eur(M.accountNow) + ', nog ' + eur(Math.max(0, 1000 - M.accountNow)) + ' te gaan' : 'volgt na de eerste weekmeting' });
  const d0 = E.received[0];
  out.push({ key: 'div1', title: 'Eerste dividend', t: d0 ? d0.t : null, done: !!d0,
    sub: d0 ? d0.ticker + ', ' + eur(d0.amount) + ' op ' + fDM.format(d0.t) : E.loaded ? 'nog geen uitkering ontvangen' : 'volgt na de eerste ophaalronde' });
  const start = investStart();
  const t1y = start ? start + 365 * DAY : null;
  const got1y = !!(t1y && t1y <= Date.now());
  out.push({ key: 'jaar1', title: 'Eén jaar beleggen', t: got1y ? t1y : null, done: got1y,
    sub: !start ? 'volgt zodra er gegevens zijn' : got1y ? 'je eerste gegevens zijn van ' + fDM.format(start) + ' ' + new Date(start).getFullYear()
      : 'nog ' + days(Math.max(1, Math.ceil((t1y - Date.now()) / DAY))) + ', gerekend vanaf ' + fDM.format(start) });
  const S = depositStreak();
  out.push({ key: 'storten12', title: '12 maanden storten op rij', t: S.streak >= 12 ? S.lastT : null, done: S.streak >= 12,
    sub: S.streak ? S.streak + ' van de 12 maanden op rij' : S.months ? 'laatste reeks onderbroken; ' + S.months + ' maanden met een storting' : 'nog geen maand met een storting' });
  return out;
}

// Eenmalig: bij een nieuw bereikte mijlpaal één keer een klein feestje (en nooit bij "minder beweging")
const milesParty = new Set();
let milesFresh = null;
function freshMilestones(list) {
  if (milesFresh) return milesFresh;
  let seen = null;
  try { const raw = localStorage.getItem(LS_MILES); seen = raw ? JSON.parse(raw) : null; } catch (e) { seen = null; }
  const done = list.filter((x) => x.done);
  const keys = done.map((x) => x.key);
  const first = !Array.isArray(seen);
  const known = Array.isArray(seen) ? seen : [];
  // Eerste keer openen: alleen feesten voor wat de laatste 30 dagen is bereikt, niet voor je hele geschiedenis
  const fresh = done.filter((x) => !known.includes(x.key)).filter((x) => !first || (isNum(x.t) && Date.now() - x.t <= 30 * DAY));
  try { localStorage.setItem(LS_MILES, JSON.stringify(keys)); } catch (e) { /* niet erg */ }
  milesFresh = new Set(fresh.map((x) => x.key));
  return milesFresh;
}

function mileTile() {
  const list = homeMilestones();
  const fresh = freshMilestones(list);
  const doneN = list.filter((x) => x.done).length;
  const next = list.find((x) => !x.done);
  const row = (x) => {
    const isNew = fresh.has(x.key);
    const party = isNew && !milesParty.has(x.key) && !reduceMotion();
    if (isNew) milesParty.add(x.key);
    return '<li class="mile-i' + (x.done ? ' ok' : '') + (isNew ? ' mile-new' : '') + (party ? ' mile-party' : '') + '">' +
      '<span class="mile-ic" aria-hidden="true">' + (x.done ? '✓' : '○') + '</span>' +
      '<span class="mile-t">' + esc(x.title) + (isNew ? ' <span class="tag gain">Net bereikt</span>' : '') + '</span>' +
      '<span class="mile-s">' + esc(x.sub) + '</span>' +
      (party ? '<span class="mile-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' : '') + '</li>';
  };
  // Ook ingeklapt zichtbaar: wat je net hebt bereikt staat bovenaan de tegel
  const freshTitles = list.filter((x) => fresh.has(x.key)).map((x) => x.title);
  const sub = (freshTitles.length ? '<span class="tag gain">Net bereikt</span> ' + esc(freshTitles.join(', ')) + '. ' : '') +
    esc(next ? 'Hierna: ' + next.title.toLowerCase() : 'Alle vier gehaald.');
  return '<section class="tile pad"><h3>Mijlpalen</h3>' +
    '<p class="v big">' + doneN + ' van ' + list.length + '</p>' +
    '<p class="sub">' + sub + '</p>' +
    '<ul class="mile-list">' + list.map(row).join('') + '</ul>' +
    '<p class="sub" style="margin-top:8px">Mijlpalen komen uit je weekmetingen, je orders en je dividenden. Ze zeggen niets over wat een goede belegging is.</p></section>';
}

// ---------- Stortingen op rij, in een rustige toon (geen aanmoediging om te handelen) ----------
function streakTile() {
  const S = depositStreak();
  const fMonS = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
  const body = S.months
    ? '<p class="v big">' + S.streak + (S.streak === 1 ? ' maand' : ' maanden') + ' op rij</p>' +
      '<p class="sub">' + esc(S.streak ? 'laatste storting in ' + fMonLong.format(S.lastT) : 'deze maand nog geen storting') + '</p>' +
      bars(S.bars12.map((x) => ({ v: x.v, color: C.accent, tip: fMonLong.format(x.t) + ': ' + (x.v ? eur(x.v) : 'geen storting') })), true) +
      barLabels(S.bars12.map((x, i) => (i % 3 === 0 ? fMonS.format(x.t).replace('.', '') : ''))) +
      '<div style="margin-top:10px">' + kvList([
        ['Maanden met een storting', S.months + ' sinds de eerste weekmeting'],
        ['Gemiddeld per storting', eur(S.avg)],
        ['Samen gestort', eur(S.total)],
      ]) + '</div>' +
      '<p class="sub" style="margin-top:8px">Dit gaat alleen over je stortingen, niet over kopen of verkopen. Een maand zonder storting breekt de reeks, maar zegt niets over je resultaat.</p>'
    : '<p class="muted">Nog geen storting gezien in je weekmetingen. De Worker leest je netto inleg elke zaterdag uit Trading 212.</p>';
  return '<section class="tile pad"><h3>Stortingen op rij</h3>' + body + '</section>';
}

// ---------- Maandresultaten (altijd zichtbaar in de rustige modus) ----------
function monthTile() {
  const m = monthNow();
  const list = m.list.slice(-12);
  const fMonS = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
  const cur = m.cur || m.prev;
  const body = list.length
    ? '<p class="v big ' + tone(cur ? cur.v : null) + '">' + esc(cur ? seur(cur.v) : '–') + '</p>' +
      '<p class="sub">' + esc(cur ? (m.cur ? 'deze maand' : fMonLong.format(cur.t)) + (isNum(cur.pct) ? ', ' + spct(cur.pct) : '') + ', tot de weekmeting van ' + fDM.format(cur.lastT) : '') + '</p>' +
      bars(list.map((x) => ({ v: x.v, tip: fMonLong.format(x.t) + ': ' + seur(x.v) }))) +
      barLabels(list.map((x) => fMonS.format(x.t).replace('.', ''))) +
      '<p class="sub" style="margin-top:8px">Resultaat per kalendermaand uit je weekmetingen, zonder stortingen. De lopende maand is nog niet af.</p>'
    : '<p class="muted">Na twee weekmetingen staat hier je resultaat per maand.</p>';
  return '<section class="tile pad"><h3>Maandresultaten</h3>' + body + '</section>';
}

// Tegels onder "Je ritme en mijlpalen", voor desktop en telefoon
function homeExtraTiles() {
  return (calmMode() ? [monthTile()] : []).concat([divCountTile(), mileTile(), streakTile()]);
}

// Dagsamenvatting en extra tegels tekenen (aangeroepen vanuit renderHome en renderMHome)
function renderHomeExtra(p) {
  const sum = $(p + 'day-line');
  if (sum) { sum.innerHTML = daySumHtml(); sum.setAttribute('aria-label', dayLineText()); }
  if ($(p + 'home-extra')) fill(p + 'home-extra', homeExtraTiles());
}

// ---------- Aantekeningen in de grote grafiek (idee 21) ----------
// prefs.chartNotes = [{ id, day: 'JJJJ-MM-DD', tekst }], hoogstens 100 van 80 tekens (prefs mag 40 kB zijn).
// Toevoegen met een rechtsklik (of lang drukken) op de grote grafiek, of bij Instellingen > Weergave. Op de computer
// staan ze als speldje op de grafiek; de telefoon toont de kale lijn.
const NOTE_MAX = 100, NOTE_LEN = 80;
const chartNotes = () => (Array.isArray(userPrefs().chartNotes) ? userPrefs().chartNotes : [])
  .filter((n) => n && /^\d{4}-\d{2}-\d{2}$/.test(String(n.day)) && n.tekst);
const noteDayT = (day) => { const [y, m, d] = String(day).split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };
const noteIso = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function chartNoteMarkers(pts) {
  const t0 = dayStart(pts[0].t), t1 = dayStart(pts[pts.length - 1].t) + DAY;
  return chartNotes().map((n) => ({ t: noteDayT(n.day), label: String(n.tekst) }))
    .filter((n) => n.t >= t0 && n.t < t1).sort((a, b) => a.t - b.t).slice(-12);
}
async function saveChartNotes(list) {
  await savePrefs({ chartNotes: list.slice(-NOTE_MAX) });
  refresh('home');
  renderChartNotes();
}
let noteEditId = null;
function openNoteDlg(day, id) {
  const dlg = /** @type {HTMLDialogElement|null} */ ($('dlg-note'));
  if (!dlg || sharedView || !M) return;
  const n = id ? chartNotes().find((x) => x.id === id) : null;
  noteEditId = n ? n.id : null;
  /** @type {HTMLInputElement} */ ($('note-day')).value = n ? n.day : day;
  /** @type {HTMLInputElement} */ ($('note-txt')).value = n ? n.tekst : '';
  $('note-st').textContent = '';
  $('note-del').hidden = !n;
  $('dlg-note-title').textContent = T(n ? 'Aantekening wijzigen' : 'Aantekening toevoegen');
  if (!dlg.open) dlg.showModal();
  $('note-txt').focus();
}
function renderChartNotes() {
  const box = $('chart-notes');
  if (!box) return;
  const L = chartNotes().slice().sort((a, b) => String(b.day).localeCompare(String(a.day)));
  const when = (day) => fD.format(noteDayT(day)) + ' ' + String(day).slice(0, 4);
  box.innerHTML = String(tpl`${L.length ? tpl`<ul class="note-list">${L.map((n) => tpl`<li><span class="note-d">${when(n.day)}</span><span class="note-t">${n.tekst}</span><button type="button" class="btn ghost" data-note-edit="${n.id}">${T('Wijzigen')}</button></li>`)}</ul>`
    : tpl`<p class="muted small">Er staan geen aantekeningen in je grafiek.</p>`}<button type="button" class="btn ghost" data-note-new${L.length >= NOTE_MAX ? raw(' disabled') : ''}>${T('Aantekening toevoegen')}</button>`);
}
// Rechtsklik of lang drukken op de grote grafiek: aantekening bij de dag die je aanwijst
document.addEventListener('contextmenu', (e) => {
  const host = /** @type {HTMLElement|null} */ (e.target && e.target.closest ? e.target.closest('#hero-chart, #m-hero-chart') : null);
  if (!host || sharedView || !M) return;
  const t = Number(host.dataset.hoverT);
  if (!t) return;
  e.preventDefault();
  openNoteDlg(noteIso(t));
});
document.addEventListener('click', (e) => {
  const ed = near(e, '[data-note-edit]');
  if (ed) { openNoteDlg(null, ed.dataset.noteEdit); return; }
  if (near(e, '[data-note-new]')) { openNoteDlg(noteIso(M && M.lastT ? M.lastT : Date.now())); return; }
  if (near(e, '[data-note-close]')) { /** @type {HTMLDialogElement} */ ($('dlg-note')).close(); return; }
  if (near(e, '#note-del') && noteEditId) {
    const gone = chartNotes().find((x) => x.id === noteEditId);
    if (!gone) return;
    /** @type {HTMLDialogElement} */ ($('dlg-note')).close();
    saveChartNotes(chartNotes().filter((x) => x.id !== gone.id))
      .then(() => toastUndo(T('Aantekening verwijderd.'), () => saveChartNotes(chartNotes().filter((x) => x.id !== gone.id).concat([gone]))))
      .catch((err) => toastErr(foutTekst('De aantekening kon niet worden verwijderd', err, 'Probeer het opnieuw.')));
  }
});
document.addEventListener('submit', async (e) => {
  const f = e.target && e.target.closest ? e.target.closest('#form-note') : null;
  if (!f) return;
  e.preventDefault();
  const st = $('note-st');
  const day = /** @type {HTMLInputElement} */ ($('note-day')).value;
  const tekst = /** @type {HTMLInputElement} */ ($('note-txt')).value.replace(/\s+/g, ' ').trim().slice(0, NOTE_LEN);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { st.textContent = 'Kies een dag.'; st.className = 'small plan-status loss'; return; }
  if (!tekst) { st.textContent = 'Typ een korte tekst.'; st.className = 'small plan-status loss'; return; }
  const list = chartNotes();
  if (!noteEditId && list.length >= NOTE_MAX) { st.textContent = 'Hoogstens ' + NOTE_MAX + ' aantekeningen.'; st.className = 'small plan-status loss'; return; }
  const next = noteEditId ? list.map((x) => (x.id === noteEditId ? { id: x.id, day, tekst } : x))
    : list.concat([{ id: Math.random().toString(36).slice(2, 10), day, tekst }]);
  try {
    await saveChartNotes(next);
    /** @type {HTMLDialogElement} */ ($('dlg-note')).close();
    toastOk(T('Aantekening bewaard.'));
  } catch (err) { st.textContent = foutTekst('De aantekening kon niet worden bewaard', err, 'Probeer het opnieuw.'); st.className = 'small plan-status loss'; }
});

// ---------- Uurpunten bij inzoomen (idee 49) ----------
// Zoom je op de grote grafiek in tot een venster van hooguit 45 dagen, dan toont hij uurpunten. De laatste 60 dagen
// staan al op het apparaat (M.hours); oudere maanden haalt de site één keer op uit R2 (/api/uren, alleen het totaal).
const hourArch = new Map();   // 'JJJJ-MM' -> punten, of 'bezig' / 'geen'
const archMonth = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
function heroFine(a, b, p) {
  const hrs = (M && M.hours && M.hours.get(TOTAL)) || [];
  const first = hrs.length ? hrs[0].t : Infinity;
  const local = hrs.filter((x) => x.t >= a && x.t <= b).map((x) => ({ t: x.t, v: x.v }));
  let arch = [];
  if (a < first) {
    const months = [];
    for (let d = new Date(new Date(a).getFullYear(), new Date(a).getMonth(), 1); d.getTime() <= Math.min(b, first); d.setMonth(d.getMonth() + 1)) months.push(archMonth(d.getTime()));
    months.forEach((m) => { const h = hourArch.get(m); if (Array.isArray(h)) arch = arch.concat(h); else if (!h) hourArchLoad(m, p); });
  }
  return arch.filter((x) => x.t >= a && x.t <= b && x.t < first).concat(local).sort((x, y) => x.t - y.t);
}
async function hourArchLoad(m, p) {
  hourArch.set(m, 'bezig');
  try {
    let pts = [];
    if (demo) pts = demoHourArch(m);
    else if (isWorker() && getToken() && !sharedView) {
      const r = await workerCall('/api/uren?maand=' + m + '&tk=' + encodeURIComponent(TOTAL), { method: 'GET' });
      pts = (r.rows || []).map((x) => ({ t: new Date(x[0]).getTime(), v: x[3] })).filter((x) => isNum(x.t) && isNum(x.v));
    }
    hourArch.set(m, pts.length ? pts : 'geen');
    // Na de lopende tekenbeurt opnieuw tekenen (in de demo komen de punten meteen, midden in die beurt)
    if (pts.length) setTimeout(() => drawHero(p, false), 0);
  } catch (e) { hourArch.set(m, 'geen'); }
}
// Voorbeeld: uurpunten verzonnen uit de dagstanden van die maand, zodat inzoomen ook zonder Worker iets laat zien
function demoHourArch(m) {
  const dys = ((M && M.days && M.days.get(TOTAL)) || []).filter((d) => archMonth(d.t) === m);
  const out = [];
  dys.forEach((d) => {
    for (let h = 0; h < 15; h++) {
      const f = h / 14, t = new Date(d.t); t.setHours(8 + h, 0, 0, 0);
      out.push({ t: t.getTime(), v: Math.round((d.open + (d.close - d.open) * f + Math.sin(h * 1.7 + d.t / 864e5) * (d.high - d.low) * 0.3) * 100) / 100 });
    }
  });
  return out;
}
