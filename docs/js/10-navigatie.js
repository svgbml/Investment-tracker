/* Investeringstracker – Inzoomen, pagina's en adresbalk, tekenen, panelen inklappen
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Inzoomen ----------
const ov = $('detail');
const shellEl = () => $(mode === 'm' ? 'mshell' : 'shell');
const inView = (r) => r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
const setRect = (r) => Object.assign(ov.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
const setFull = () => Object.assign(ov.style, { left: '0px', top: '0px', width: '100%', height: '100%' });
let zoomTimer = null;

function setOrigin(sh, r) {
  const s = sh.getBoundingClientRect();
  sh.style.transformOrigin = (r.left + r.width / 2 - s.left) + 'px ' + (r.top + r.height / 2 - s.top) + 'px';
}

function ghostOf(el, r) {
  const g = el.cloneNode(true);
  g.removeAttribute('data-ticker');
  g.removeAttribute('aria-label');
  g.setAttribute('aria-hidden', 'true');
  g.classList.add('tile', 'ghost');
  g.style.width = r.width + 'px';
  g.style.height = r.height + 'px';
  g.style.padding = getComputedStyle(el).padding;
  g.style.borderRadius = getComputedStyle(el).borderRadius;
  return g;
}

function openDetail(tk, originEl, push) {
  if (!M || !hasView(tk)) return;
  clearTimeout(zoomTimer);
  hideTip();
  const sh = shellEl();
  ui.detail = tk;
  ui.detailRange = '3d';
  ui.compare = false;
  ui.mTab = 'pos';
  ui.origin = tk;
  if (push) { history.pushState({ detail: tk }, '', viewHash(tk)); pushedDetail = true; }
  markFresh();
  renderDetail(true);
  ov.querySelectorAll('.tile.ghost').forEach((g) => g.remove());
  ov.classList.remove('anim', 'open', 'pop', 'fade-out');
  ov.hidden = false;
  ov.scrollTop = 0;
  document.documentElement.classList.add('locked');
  sh.inert = true;

  const r = originEl && originEl.getBoundingClientRect();
  if (reduceMotion() || !r || !inView(r)) {
    setFull();
    ov.classList.add('open');
    if (!reduceMotion()) ov.classList.add('pop');
    sh.classList.add('zoomed');
    focusDetail();
    return;
  }
  setRect(r);
  const g = ghostOf(originEl, r);
  ov.appendChild(g);
  setOrigin(sh, r);
  ov.classList.add('zooming');
  void ov.offsetWidth;
  ov.classList.add('anim');
  sh.classList.add('zoom-anim');
  requestAnimationFrame(() => {
    setFull();
    ov.classList.add('open');
    sh.classList.add('zoomed');
    g.style.opacity = '0';
  });
  zoomTimer = setTimeout(() => { g.remove(); sh.classList.remove('zoom-anim'); ov.classList.remove('zooming'); focusDetail(); }, ZOOM_MS + 20);
}

function focusDetail() {
  const b = ov.querySelector('[data-act="back"]');
  if (b) b.focus({ preventScroll: true });
}

function switchDetail(tk, dir) {
  if (!hasView(tk)) return;
  if (isPseudo(ui.detail)) { ui.detailRange = '3d'; ui.compare = false; ui.mTab = 'pos'; } else ui.origin = tk;
  ui.detail = tk;
  history.replaceState({ detail: tk }, '', viewHash(tk));
  ov.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  markFresh();
  renderDetail(false, reduceMotion() ? null : dir);
}

function closeDetail() {
  if (!ui.detail) return;
  if (pushedDetail) { history.back(); return; }   // de hashchange sluit daarna de pagina
  history.replaceState(null, '', '#' + pageHash(ui.page));
  finishDetail();
}

function cleanupDetail(sh) {
  ov.hidden = true;
  ov.classList.remove('anim', 'open', 'pop', 'fade-out', 'zooming');
  ov.removeAttribute('style');
  ov.querySelectorAll('.tile.ghost').forEach((g) => g.remove());
  [$('shell'), $('mshell')].forEach((s) => { s.classList.remove('zoom-anim', 'zoomed'); s.style.transformOrigin = ''; s.inert = false; });
  document.documentElement.classList.remove('locked');
  void sh;
}

function instantClose() {
  clearTimeout(zoomTimer);
  ui.detail = null;
  pushedDetail = false;
  cleanupDetail();
}

function finishDetail() {
  if (!ui.detail) return;
  const tk = ui.origin || ui.detail;
  ui.detail = null;
  pushedDetail = false;
  clearTimeout(zoomTimer);
  hideTip();
  const sh = shellEl();
  sh.inert = false;
  const page = $(pageId(ui.page));
  const el = page && page.querySelector('[data-ticker="' + (window.CSS && CSS.escape ? CSS.escape(tk) : tk) + '"]');
  const done = () => { cleanupDetail(sh); if (el) el.focus({ preventScroll: true }); };

  if (reduceMotion()) { done(); return; }
  if (!el) {
    sh.classList.add('zoom-anim');
    sh.classList.remove('zoomed');
    ov.classList.add('fade-out');
    zoomTimer = setTimeout(done, 220);
    return;
  }
  // Pagina eerst zonder zoom meten, zo nodig de tegel in beeld schuiven
  sh.classList.remove('zoom-anim', 'zoomed');
  let r = el.getBoundingClientRect();
  const bottomBar = mode === 'm' ? 80 : 0;
  if (!inView(r) || r.top < 0 || r.bottom > window.innerHeight - bottomBar) {
    window.scrollBy(0, r.top - (window.innerHeight - r.height) / 2);
    r = el.getBoundingClientRect();
  }
  setOrigin(sh, r);
  sh.classList.add('zoomed');
  void sh.offsetWidth;
  sh.classList.add('zoom-anim');
  sh.classList.remove('zoomed');

  const g = ghostOf(el, r);
  g.style.opacity = '0';
  g.style.transition = 'opacity .2s .22s';
  ov.appendChild(g);
  ov.classList.add('zooming', 'anim');
  ov.classList.remove('open', 'pop');
  ov.scrollTop = 0;
  setRect(r);
  requestAnimationFrame(() => { g.style.opacity = '1'; });
  zoomTimer = setTimeout(done, ZOOM_MS + 30);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.detail && !$('dlg-settings').open) { e.preventDefault(); closeDetail(); }
});

// Klik op een tegel, rij of legenda-regel met een ticker: inzoomen
document.addEventListener('click', (e) => {
  if (!e.target.closest) return;
  if (e.target.closest('[data-act="links"]')) { openSettings(false); setGo('links'); return; }
  if (ov.contains(e.target)) return;
  const imp = e.target.closest('[data-act="import"]');
  if (imp) { openSettings(true); return; }
  if (!e.target.closest('#app, #m-main')) return;
  const go = e.target.closest('[data-goto]');
  if (go) { location.hash = go.dataset.goto; return; }
  const el = e.target.closest('[data-ticker]');
  if (el) openDetail(el.dataset.ticker, el, true);
});

// ---------- Pagina's en adresbalk ----------
const ORDER = { home: 0, list: 1, news: 2, stats: 3, plan: 4 };
const TITLES = { home: 'Overzicht', list: 'Bedrijven', news: 'Nieuws', stats: 'Analyse', plan: 'Plannen' };
const pageId = (p) => (mode === 'm' ? 'm-' + p : 'page-' + p);
const pageHash = (p) => (p === 'list' ? 'bedrijven' : p === 'stats' ? 'analyse' : p === 'news' ? 'nieuws' : p === 'plan' ? 'plannen' : 'overzicht');

// Balk op de computer (menu plus knoppen, één rij): op Overzicht tussen de grote grafiek en de tegels
// (blijft bij scrollen bovenaan staan), op de andere pagina's bovenaan
function placeDeskNav() {
  const bar = /** @type {HTMLElement|null} */ (document.querySelector('#shell .topbar'));
  if (!bar || mode !== 'd') return;
  const band = document.querySelector('#page-home > .band');
  if (ui.page === 'home' && band) { if (band.nextElementSibling !== bar) band.after(bar); }
  else { const shell = $('shell'); if (shell && shell.firstElementChild !== bar) shell.prepend(bar); }
}
function placeIndicators() {
  placeDeskNav();
  const a = /** @type {HTMLElement|null} */ (document.querySelector('.pillnav a[aria-current="page"]'));
  const pill = /** @type {HTMLElement|null} */ (document.querySelector('.pill'));
  if (a && pill && mode === 'd') { const w = Math.round(a.offsetWidth * 0.5); pill.style.width = w + 'px'; pill.style.transform = 'translateX(' + (a.offsetLeft + (a.offsetWidth - w) / 2) + 'px)'; }
  const t = document.querySelector('.m-tabs a[aria-current="page"]');
  const ind = document.querySelector('.m-tab-ind');
  if (t && ind && mode === 'm') { const w = t.offsetWidth * 0.5; ind.style.width = w + 'px'; ind.style.transform = 'translateX(' + (t.offsetLeft + (t.offsetWidth - w) / 2) + 'px)'; }
}

function showPage(p, animate, force) {
  const prev = ui.page;
  ui.page = p;
  if (M) ensurePage(p);
  const ids = ['home', 'list', 'news', 'stats', 'plan'];
  const el = $(pageId(p));
  const move = animate && !reduceMotion();
  const swap = () => {
    document.body.dataset.page = p;
    $$('.pillnav a, .m-tabs a').forEach((a) => {
      if (a.dataset.page === p) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('m-title').textContent = TITLES[p];
    { const cs = getComputedStyle(document.documentElement); document.querySelector('meta[name="theme-color"]').content = (mode === 'm' && p !== 'home' ? cs.getPropertyValue('--bg') : cs.getPropertyValue('--band')).trim(); }
    ids.forEach((k) => { $(pageId(k)).hidden = k !== p; });
    placeIndicators();
    if (prev !== p || force) window.scrollTo(0, 0);
    foldAll(); // meteen in de juiste (ingeklapte) vorm, vóór de eerste keer tekenen
  };
  clearTimeout(showPage.timer);
  if (move) markFresh();
  $$('.page, .m-view').forEach((x) => x.classList.remove('in-r', 'in-l', 'enter'));
  const dir = ORDER[p] > ORDER[prev] ? 'f' : 'b';
  // Browsers met view transitions: de oude pagina schuift weg terwijl de nieuwe binnenkomt
  if (move && prev !== p && document.startViewTransition && !ui.detail) {
    const root = document.documentElement;
    root.dataset.nav = dir;
    let vt;
    try { vt = document.startViewTransition(() => { swap(); el.classList.add('enter'); }); } catch (e) { vt = null; }
    if (vt) {
      const clean = () => { if (showPage.vt === vt) delete root.dataset.nav; };
      showPage.vt = vt;
      vt.finished.then(clean, clean);
      if (vt.ready) vt.ready.catch(() => {}); // een snel volgende wissel breekt deze af; dat is geen fout
      showPage.timer = setTimeout(() => el.classList.remove('enter'), 1400);
      return;
    }
    delete root.dataset.nav;
  }
  swap();
  if (move) {
    void el.offsetWidth;
    if (prev !== p) el.classList.add(dir === 'f' ? 'in-r' : 'in-l');
    el.classList.add('enter');
    showPage.timer = setTimeout(() => el.classList.remove('in-r', 'in-l', 'enter'), 1400);
  }
}

function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (h.indexOf('bedrijf/') === 0) return { tk: h.slice(8) };
  const pk = Object.keys(PSEUDO).find((k) => PSEUDO[k] === h);
  if (pk) return { tk: pk };
  if (h.indexOf('volg/') === 0) return { tk: '~' + h.slice(5).toUpperCase() };
  return { page: h === 'bedrijven' ? 'list' : h === 'statistieken' || h === 'analyse' ? 'stats' : h === 'plannen' ? 'plan' : h === 'nieuws' ? 'news' : 'home' };
}

function route(first) {
  const r = parseHash();
  if (r.tk) {
    if (first) showPage('list', true, true);
    if (!M) return;
    if (!ui.detail) openDetail(r.tk, null, false);
    else if (ui.detail !== r.tk) switchDetail(r.tk, 'r');
    return;
  }
  if (ui.detail) { pushedDetail = false; finishDetail(); }
  if (r.page !== ui.page || first) showPage(r.page, true);
}

window.addEventListener('hashchange', () => route(false));
window.addEventListener('resize', () => { placeIndicators(); setMtop(); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placeIndicators(); setMtop(); foldAll(); });

// ---------- Tekenen ----------
// Weergaven (zie js/00-kern.js): renderAll() tekent ze allemaal, refresh('naam') alleen dat stuk
defineView('home', () => { if (mode === 'm') renderMHome(); else renderHome(); renderDriftNote(); });
defineView('list', () => { if (mode === 'm') renderMList(); else renderList(); });
defineView('stats', () => { if (mode === 'm') renderMStats(); });
defineView('plan', () => renderPlan());
defineView('watch', () => renderWatch());
defineView('news', () => renderNews());
defineView('valuation', () => renderValuationList());

// Alleen de zichtbare pagina tekenen; de andere worden bijgewerkt zodra je ze opent
const PAGE_VIEWS = { home: ['home'], list: ['list', 'watch', 'valuation'], news: ['news'], stats: ['stats'], plan: ['plan'] };
const staleViews = new Set();
function renderAll() {
  const now = PAGE_VIEWS[ui.page] || [];
  [...VIEWS.keys()].forEach((n) => { if (now.includes(n)) staleViews.delete(n); else staleViews.add(n); });
  refresh(...now);
  foldSoon();
}
// Pagina openen: eerst bijwerken wat sinds de laatste gegevens nog niet getekend is
function ensurePage(p) {
  const want = (PAGE_VIEWS[p] || []).filter((n) => staleViews.has(n));
  if (!want.length) return;
  want.forEach((n) => staleViews.delete(n));
  refresh(...want);
}

// ---------- Panelen inklappen: lange tegels op de beginpagina's starten compact ----------
// Tegels in dezelfde rij krijgen ingeklapt dezelfde hoogte; een klik op een leeg stuk van de tegel klapt hem uit of in.
function foldSoon() { foldAll(); cancelAnimationFrame(foldTimer); foldTimer = requestAnimationFrame(() => requestAnimationFrame(foldAll)); }
function foldAll() {
  const H = mode === 'm' ? 300 : 320;
  FOLD_ROOTS.forEach((rid) => {
    const root = $(rid);
    if (!root || root.hidden || !root.offsetParent) return;
    if (root.querySelector('.fold-anim')) return; // midden in een animatie: niet opnieuw meten
    root.classList.add('no-tr'); // meten en instellen zonder overgangen, anders "ademen" de grafieken bij elke meting
    const tiles = [...root.querySelectorAll('.tile.pad, .m-stack > .tile')].filter((t) => !t.closest(FOLD_SKIP) && !t.classList.contains('fold-anim'));
    // Eerst alles op natuurlijke hoogte meten
    tiles.forEach((t) => { t.classList.remove('folded', 'fit'); t.style.minHeight = ''; t.style.maxHeight = ''; t.querySelectorAll('.fit-chart').forEach((c) => c.classList.remove('fit-chart')); });
    const info = tiles.map((t, i) => {
      const h3 = t.querySelector('h3');
      return { t, key: rid + ':' + (h3 ? h3.textContent : i), full: t.scrollHeight, row: (t.parentElement.id || '') + ':' + t.offsetTop };
    });
    const rows = new Map();
    info.forEach((x) => { const r = rows.get(x.row) || []; r.push(x); rows.set(x.row, r); });
    rows.forEach((row) => {
      const even = row.length > 1 ? Math.min(H, Math.max(...row.map((x) => x.full))) : 0;
      row.forEach((x) => {
        const t = x.t;
        t.style.setProperty('--fold-h', H + 'px');
        if (even) t.style.minHeight = even + 'px';
        if (x.full <= H + 24) { t.classList.remove('fold'); t.removeAttribute('data-fold'); const b = t.querySelector(':scope > .fold-btn'); if (b) b.remove(); return; }
        t.classList.add('fold');
        t.dataset.fold = x.key;
        const open = unfolded.has(x.key);
        fitChart(t, H);
        t.classList.toggle('folded', !open);
        if (t.tagName === 'BUTTON') return; // een klikbare tegel opent zijn eigen pagina met alles
        let b = t.querySelector(':scope > .fold-btn');
        if (!b) { b = Object.assign(document.createElement('button'), { type: 'button', className: 'fold-btn' }); t.appendChild(b); }
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        b.textContent = open ? 'Minder tonen' : 'Meer tonen';
      });
    });
    void root.offsetHeight;
    root.classList.remove('no-tr');
  });
}
// Ingeklapt moet een grafiek met zijn labels helemaal zichtbaar zijn: maak hem zo nodig lager (de y-as wordt dan samengedrukt)
const CHART_SEL = '.bars, .chart, svg.dual, .donut, .fin-bars';
function fitChart(t, H) {
  const ch = t.querySelector(CHART_SEL);
  if (!ch) return;
  const tr = t.getBoundingClientRect(), cr = ch.getBoundingClientRect();
  if (cr.top - tr.top > H - 120 || cr.height < 40) return;
  let end = ch, sib = ch.nextElementSibling;
  while (sib && sib.matches('.bar-labels, .xlabels, .legend, .heat-key, .srri-l')) { end = sib; sib = sib.nextElementSibling; }
  if (end === ch && ch.parentElement !== t) { // labels kunnen naast de omhullende staan
    let w = ch.parentElement.nextElementSibling;
    while (w && w.matches('.bar-labels, .xlabels, .legend')) { end = w; w = w.nextElementSibling; }
  }
  const bottom = end.getBoundingClientRect().bottom - tr.top;
  const limit = H - 44;
  t.classList.add('fit');
  if (bottom <= limit) return;
  const nh = Math.max(48, cr.height - (bottom - limit));
  ch.style.setProperty('--fit-h', Math.floor(nh) + 'px');
  ch.classList.add('fit-chart');
}
function toggleFold(t) {
  if (t.classList.contains('fold-anim')) return;
  const key = t.dataset.fold;
  const open = !unfolded.has(key);
  if (open) unfolded.add(key); else unfolded.delete(key);
  const b = t.querySelector(':scope > .fold-btn');
  if (b) { b.textContent = open ? 'Minder tonen' : 'Meer tonen'; b.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  if (reduceMotion()) { t.classList.toggle('folded', !open); return; }
  // 1. Meet de eindhoogte in de eindtoestand, zonder overgangen (anders meet je een half gegroeide grafiek)
  const from = t.getBoundingClientRect().height;
  t.classList.add('no-tr');
  t.classList.toggle('folded', !open);
  t.style.maxHeight = '';
  const to = t.getBoundingClientRect().height;
  // 2. Terug naar de begintoestand, vastgezet op de beginhoogte
  t.classList.toggle('folded', open);
  t.style.maxHeight = from + 'px';
  void t.offsetHeight;
  t.classList.remove('no-tr');
  // 3. Animeren: tegel en grafiek bewegen met dezelfde duur en curve
  t.classList.add('fold-anim');
  t.classList.toggle('folded', !open);
  t.style.maxHeight = to + 'px';
  let fin = false;
  const done = (e) => {
    if (e && (e.target !== t || e.propertyName !== 'max-height')) return; // overgangen van onderdelen in de tegel tellen niet
    if (fin) return; fin = true;
    t.removeEventListener('transitionend', done);
    t.classList.add('no-tr'); t.classList.remove('fold-anim'); t.style.maxHeight = ''; void t.offsetHeight; t.classList.remove('no-tr');
  };
  t.addEventListener('transitionend', done);
  setTimeout(() => done(), 520);
  if (Math.abs(to - from) < 1) done();
  if (!open) { const r = t.getBoundingClientRect(); const topbar = mode === 'm' ? 64 : 96; if (r.top < topbar) window.scrollBy({ top: r.top - topbar - 12, behavior: 'smooth' }); }
}
// Klik op een leeg stuk van de tegel (niet op een knop, link, invoerveld of regel die zelf iets opent)
const FOLD_IGNORE = 'a, input, select, textarea, label, summary, details, [data-open], [data-ticker]:not(.tile), [data-act], [data-plan], [data-cal], [data-export], [data-seg], .seg, [contenteditable]';
document.addEventListener('click', (e) => {
  const t = e.target.closest('.tile.fold[data-fold]');
  if (!t || t.tagName === 'BUTTON') return;
  const fb = e.target.closest('.fold-btn');
  if (!fb) {
    const hit = e.target.closest(FOLD_IGNORE);
    if (hit && t.contains(hit)) return;
    const btn = e.target.closest('button');
    if (btn && btn !== t && t.contains(btn)) return;
    if (window.getSelection && String(window.getSelection()).length) return;
  }
  toggleFold(t);
});
let foldResize = null;
window.addEventListener('resize', () => { clearTimeout(foldResize); foldResize = setTimeout(foldAll, 200); });

function render() {
  $('welcome').hidden = true;
  document.body.classList.remove('welcoming');
  $('app').hidden = false;
  $('m-main').hidden = false;
  $('demo-banner').hidden = !demo;
  M = derive();
  if (firstRender) markFresh();
  const upd = M.lastT ? 'Bijgewerkt ' + fDT.format(data.generated ? new Date(data.generated) : new Date()) : '';
  $$('.updated').forEach((e) => { e.textContent = mode === 'm' ? upd.replace('Bijgewerkt ', '') : upd; });
  renderAll();
  if (ui.detail) {
    if (hasView(ui.detail)) renderDetail(false);
    else closeDetail();
  }
  if (firstRender) { firstRender = false; route(true); }
}
