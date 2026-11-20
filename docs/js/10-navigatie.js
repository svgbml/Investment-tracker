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
  if (typeof ensureResearch === 'function') ensureResearch(tk);   // onderzoek van dit aandeel zo nodig losbijhalen
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
  if (typeof ensureResearch === 'function') ensureResearch(tk);
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
// Geeft true terug als de balk verplaatst is
function placeDeskNav() {
  const bar = /** @type {HTMLElement|null} */ (document.querySelector('#shell .topbar'));
  if (!bar || mode !== 'd') return false;
  const band = document.querySelector('#page-home > .band');
  if (ui.page === 'home' && band) { if (band.nextElementSibling !== bar) { band.after(bar); return true; } }
  else { const shell = $('shell'); if (shell && shell.firstElementChild !== bar) { shell.prepend(bar); return true; } }
  return false;
}
let pillLast = null;
function placeIndicators() {
  const pill = /** @type {HTMLElement|null} */ (document.querySelector('.pill'));
  placeDeskNav();
  const a = /** @type {HTMLElement|null} */ (document.querySelector('.pillnav a[aria-current="page"]'));
  if (a && pill && mode === 'd' && a.offsetWidth) {
    const w = Math.round(a.offsetWidth * 0.5);
    const t = 'translateX(' + (a.offsetLeft + (a.offsetWidth - w) / 2) + 'px)';
    pill.style.width = w + 'px'; pill.style.transform = t;
    // Zelf laten schuiven (geen CSS-overgang): die start niet als de balk net verplaatst is (van of naar Overzicht)
    if (pillLast && pillLast.t !== t && !reduceMotion() && pill.animate) {
      pill.getAnimations().forEach((x) => x.cancel());
      pill.animate([{ transform: pillLast.t, width: pillLast.w }, { transform: t, width: w + 'px' }], { duration: 350, easing: 'cubic-bezier(.2, .7, .2, 1)' });
    }
    pillLast = { t, w: w + 'px' };
  }
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
    // Van of naar Overzicht verhuist de balk (onder de grafiek of bovenaan): dan schuift hij mee met zijn pagina
    if (mode === 'd' && (prev === 'home' || p === 'home')) root.dataset.bar = 'move'; else delete root.dataset.bar;
    let vt;
    try { vt = document.startViewTransition(() => { swap(); el.classList.add('enter'); }); } catch (e) { vt = null; }
    if (vt) {
      const clean = () => { if (showPage.vt === vt) { delete root.dataset.nav; delete root.dataset.bar; } };
      showPage.vt = vt;
      vt.finished.then(clean, clean);
      if (vt.ready) vt.ready.catch(() => {}); // een snel volgende wissel breekt deze af; dat is geen fout
      showPage.timer = setTimeout(() => el.classList.remove('enter'), 1400);
      return;
    }
    delete root.dataset.nav; delete root.dataset.bar;
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
  // Stond de bewaarde tekening er al (snelle start)? Dan komt de eerste pagina niet nog eens binnenwandelen
  if (r.page !== ui.page || first) showPage(r.page, !(first && typeof snapTookOver === 'function' && snapTookOver()));
}

window.addEventListener('hashchange', () => route(false));
onResize(() => { placeIndicators(); setMtop(); }, { lead: true, key: 'balk' });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placeIndicators(); setMtop(); foldAll(); });

// ---------- Tekenen ----------
// Weergaven (zie js/00-kern.js): renderAll() tekent ze allemaal, refresh('naam') alleen dat stuk
defineView('home', () => { if (mode === 'm') renderMHome(); else renderHome(); renderDriftNote(); });
// Start onder de vouw; op de telefoon zijn dat de statistieken (renderMStats), die ook op Start staan
defineView('home-rest', () => { if (mode === 'm') renderMStats(); else renderHomeRest(); });
defineView('list', () => { if (mode === 'm') renderMList(); else renderList(); });
defineView('plan', () => renderPlan());
defineView('watch', () => renderWatch());
defineView('news', () => renderNews());
defineView('valuation', () => renderValuationList());

// Alleen de zichtbare pagina tekenen; de andere worden bijgewerkt zodra je ze opent
const PAGE_VIEWS = { home: ['home', 'home-rest'], list: ['list', 'watch', 'valuation'], news: ['news'], stats: [], plan: ['plan'] };

// Scripts die alleen één pagina nodig heeft, laden pas als je die pagina opent (niet bij het starten). Ze staan
// niet in index.html, wel in de cachelijst van sw.js, zodat ze ook zonder verbinding werken.
// Sleutel: de weergave die erop wacht; waarde: de scripts.
const VIEW_SCRIPTS = { plan: ['js/29-plannen-extra.js'] };
const viewScriptsOk = new Set();
const viewScriptsBusy = new Map();
function loadViewScripts(n) {
  if (viewScriptsBusy.has(n)) return viewScriptsBusy.get(n);
  const one = (src) => new Promise((ok, no) => {
    const el = document.createElement('script');
    el.src = src + '?v=' + VERSION.replace(/^v/, '');
    el.onload = () => ok(true);
    el.onerror = () => no(new Error(src + ' kon niet worden geladen'));
    document.head.appendChild(el);
  });
  // Op volgorde laden: een later script mag namen uit een eerder gebruiken
  const p = VIEW_SCRIPTS[n].reduce((acc, src) => acc.then(() => one(src)), Promise.resolve(true))
    .then(() => yieldNow())                // inlezen en tekenen in twee taken, niet in één lange
    .then(() => {
      viewScriptsOk.add(n);
      if (M) { refresh(n); foldSoon(); }   // tekent alleen als de pagina nog open is; anders blijft hij verouderd
    })
    .catch((err) => {
      viewScriptsBusy.delete(n);           // bij de volgende keer openen opnieuw proberen
      console.error('Onderdeel "' + n + '" kon niet worden geladen:', err);
      if (typeof toastErr === 'function') toastErr('Dit onderdeel kon niet worden geladen. Vernieuw de pagina of probeer het later opnieuw.');
    });
  viewScriptsBusy.set(n, p);
  return p;
}
// Een weergave die op een script wacht, kan nog niet getekend worden: begin met laden
const viewNeedsScripts = (n) => !!VIEW_SCRIPTS[n] && !viewScriptsOk.has(n) && (loadViewScripts(n), true);

// Een weergave die alleen bij andere pagina's hoort, is buiten beeld: refresh() slaat hem dan over en
// onthoudt hem als verouderd. Weergaven die bij geen pagina horen (zoals de detailpagina's) tekent hij altijd.
// Wacht een weergave op zijn script (VIEW_SCRIPTS), dan geldt hij ook als nog niet te tekenen.
viewOffscreen = (n) => {
  let mine = false;
  for (const p in PAGE_VIEWS) {
    if (!PAGE_VIEWS[p].includes(n)) continue;
    if (p === ui.page) return viewNeedsScripts(n);
    mine = true;
  }
  return mine;
};
// renderAll() tekent de weergaven van de open pagina na elkaar. Duurt het samen langer dan RENDER_SLICE ms,
// dan laat hij de browser tussendoor even reageren (yieldNow): tikken en scrollen blijven dan werken, ook op
// een trage telefoon. De bovenste weergave komt altijd eerst. Geeft een belofte die klaar is als alles staat.
const RENDER_SLICE = 40;
let renderGen = 0;
let renderBusy = null;   // de pagina waarvoor renderAll() nog bezig is
async function renderAll() {
  const gen = ++renderGen;
  const page = ui.page;
  const now = PAGE_VIEWS[page] || [];
  renderBusy = page;
  [...VIEWS.keys()].forEach((n) => staleViews.add(n));   // alles verouderd tot het opnieuw getekend is
  let t0 = performance.now();
  for (const n of now) {
    if (!staleViews.has(n)) continue;                    // intussen al getekend (pagina geopend)
    if (performance.now() - t0 > RENDER_SLICE) {
      rafWork('fold', foldAll);                          // wat er al staat vóór de volgende tekening opvouwen
      await yieldNow();
      if (gen !== renderGen) return;                     // een nieuwere tekenbeurt heeft het overgenomen
      t0 = performance.now();
    }
    refresh(n);
  }
  renderBusy = null;
  foldSoon();
}
// Pagina openen: eerst bijwerken wat sinds de laatste gegevens nog niet getekend is
function ensurePage(p) {
  if (renderBusy === p) return;   // renderAll() is deze pagina al in stukken aan het tekenen
  const want = (PAGE_VIEWS[p] || []).filter((n) => staleViews.has(n));
  if (!want.length) return;
  want.forEach((n) => staleViews.delete(n));
  refresh(...want);
}

// ---------- Panelen inklappen: lange tegels op de beginpagina's starten compact ----------
// Tegels in dezelfde rij krijgen ingeklapt dezelfde hoogte; een klik op een leeg stuk van de tegel klapt hem uit of in.
function foldSoon() {
  // Vóór de volgende tekening van het scherm (requestAnimationFrame), niet meteen: dan rekent de browser de
  // opmaak één keer uit voor opvouwen én tekenen, in plaats van midden in het werk een extra keer
  rafWork('fold', foldAll);
  // Nog één keer als de browser alles heeft neergezet (webfont, afbeeldingen); samengevoegd, dus hoogstens één keer per frame
  cancelAnimationFrame(foldTimer);
  foldTimer = requestAnimationFrame(() => rafWork('fold', foldAll));
}
// Eerst alles meten, daarna alles aanpassen: om en om meten en wijzigen dwingt de browser telkens de hele
// opmaak opnieuw uit te rekenen (bij ± 25 tegels op Start was dat 25 keer per opvouwbeurt, nu drie keer).
function foldAll() {
  const H = mode === 'm' ? 300 : 320;
  // 1. Lezen: welke wortels zijn zichtbaar en niet midden in een animatie
  const roots = FOLD_ROOTS.map((rid) => ({ rid, root: $(rid), tiles: [], info: [] }))
    .filter((x) => x.root && !x.root.hidden && x.root.offsetParent && !x.root.querySelector('.fold-anim'));
  if (!roots.length) return;
  // 2. Schrijven: alles terug naar de natuurlijke hoogte, zonder overgangen (anders "ademen" de grafieken)
  roots.forEach((x) => {
    x.root.classList.add('no-tr');
    x.tiles = [...x.root.querySelectorAll('.tile.pad, .m-stack > .tile')].filter((t) => !t.closest(FOLD_SKIP) && !t.classList.contains('fold-anim'));
    x.tiles.forEach((t) => { t.classList.remove('folded', 'fit'); t.style.minHeight = ''; t.style.maxHeight = ''; t.querySelectorAll('.fit-chart').forEach((c) => c.classList.remove('fit-chart')); });
  });
  // 3. Lezen: hoogtes, rijen en waar de grafiek staat (één keer opmaak uitrekenen voor alles)
  roots.forEach((x) => {
    x.info = x.tiles.map((t, i) => {
      const h3 = t.querySelector('h3');
      const full = t.scrollHeight;
      return { t, key: x.rid + ':' + (h3 ? h3.textContent : i), full, row: (t.parentElement.id || '') + ':' + t.offsetTop, fit: full > H + 24 ? fitMeasure(t, H) : null };
    });
  });
  // 4. Schrijven: opvouwen, gelijke hoogte per rij, grafieken passend maken
  roots.forEach((x) => {
    const rows = new Map();
    x.info.forEach((o) => { const r = rows.get(o.row) || []; r.push(o); rows.set(o.row, r); });
    rows.forEach((row) => {
      const even = row.length > 1 ? Math.min(H, Math.max(...row.map((o) => o.full))) : 0;
      row.forEach((o) => {
        const t = o.t;
        t.style.setProperty('--fold-h', H + 'px');
        if (even) t.style.minHeight = even + 'px';
        if (o.full <= H + 24) { t.classList.remove('fold'); t.removeAttribute('data-fold'); const b = t.querySelector(':scope > .fold-btn'); if (b) b.remove(); return; }
        t.classList.add('fold');
        t.dataset.fold = o.key;
        const open = unfolded.has(o.key);
        fitApply(t, o.fit);
        t.classList.toggle('folded', !open);
        if (t.tagName === 'BUTTON') return; // een klikbare tegel opent zijn eigen pagina met alles
        let b = t.querySelector(':scope > .fold-btn');
        if (!b) { b = Object.assign(document.createElement('button'), { type: 'button', className: 'fold-btn' }); t.appendChild(b); }
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        b.textContent = open ? 'Minder tonen' : 'Meer tonen';
      });
    });
  });
  // 5. De nieuwe stand vastleggen zonder overgangen, daarna mogen ze weer
  void roots[0].root.offsetHeight;
  roots.forEach((x) => x.root.classList.remove('no-tr'));
}
// Ingeklapt moet een grafiek met zijn labels helemaal zichtbaar zijn: maak hem zo nodig lager (de y-as wordt dan samengedrukt)
const CHART_SEL = '.bars, .chart, svg.dual, .donut, .fin-bars';
// Alleen meten (in de natuurlijke stand van de tegel); fitApply zet het daarna
function fitMeasure(t, H) {
  const ch = t.querySelector(CHART_SEL);
  if (!ch) return null;
  const tr = t.getBoundingClientRect(), cr = ch.getBoundingClientRect();
  if (cr.top - tr.top > H - 120 || cr.height < 40) return null;
  let end = ch, sib = ch.nextElementSibling;
  while (sib && sib.matches('.bar-labels, .xlabels, .legend, .heat-key, .srri-l')) { end = sib; sib = sib.nextElementSibling; }
  if (end === ch && ch.parentElement !== t) { // labels kunnen naast de omhullende staan
    let w = ch.parentElement.nextElementSibling;
    while (w && w.matches('.bar-labels, .xlabels, .legend')) { end = w; w = w.nextElementSibling; }
  }
  const bottom = end.getBoundingClientRect().bottom - tr.top;
  const limit = H - 44;
  return { ch, h: bottom <= limit ? null : Math.floor(Math.max(48, cr.height - (bottom - limit))) };
}
function fitApply(t, f) {
  if (!f) return;
  t.classList.add('fit');
  if (f.h == null) return;
  f.ch.style.setProperty('--fit-h', f.h + 'px');
  f.ch.classList.add('fit-chart');
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
onResize(foldAll, { key: 'fold' });

function render() {
  clearSkeleton();
  if (typeof snapClear === 'function') snapClear();   // een bewaarde tekening (snelle start) maakt nu plaats voor de echte
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
  if (typeof snapSoon === 'function') snapSoon();     // deze tekening bewaren voor de volgende start
}
