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
    drawHero(p, true);
  });
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
  if (!isNum(T.change)) return 'Nog geen metingen van ' + (M.isToday ? 'vandaag' : 'deze handelsdag') + '. De tracker meet op werkdagen tussen 08:00 en 22:30.';
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
  return txt + breadth + (newsMoodSentence() ? ' ' + newsMoodSentence() : '');
}

// ---------- Strook met de drie grootste stijgers en dalers van vandaag ----------
function moversStrip() {
  if (calmMode()) return '';
  const pool = M.companies.filter((c) => isNum(c.changePct));
  if (pool.length < 2) return '';
  const by = pool.slice().sort((a, b) => b.changePct - a.changePct);
  const up = by.slice(0, 3);
  const down = by.slice(-3).reverse().filter((c) => !up.includes(c));
  const chip = (c) => '<button type="button" class="mv-chip" data-ticker="' + esc(c.tk) + '" aria-label="' +
    esc(c.name + ', ' + spct(c.changePct) + ' ' + M.dayWord + ', ' + seur(c.change) + '. Openen') + '">' +
    '<span class="mv-tk">' + esc(c.tk) + '</span>' +
    '<span class="mv-p ' + tone(c.changePct) + '">' + esc(spct(c.changePct)) + '</span>' +
    '<span class="mv-e">' + esc(seur(c.change)) + '</span></button>';
  return '<div class="mv-strip" role="group" aria-label="' + esc('Drie grootste stijgers en dalers ' + M.dayWord) + '">' +
    up.map(chip).join('') + (down.length ? '<span class="mv-sep" aria-hidden="true"></span>' + down.map(chip).join('') : '') + '</div>';
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

// Dagsamenvatting, strook en extra tegels tekenen (aangeroepen vanuit renderHome en renderMHome)
function renderHomeExtra(p) {
  const line = $(p + 'day-line');
  if (line) line.textContent = dayLineText();
  const strip = $(p + 'movers-strip');
  if (strip) { const html = moversStrip(); strip.innerHTML = html; strip.hidden = !html; }
  if ($(p + 'home-extra')) fill(p + 'home-extra', homeExtraTiles());
}
