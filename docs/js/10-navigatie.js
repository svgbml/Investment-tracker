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

// Het lichte pilletje achter het actieve menu-item (computer) en achter de actieve tab (telefoon).
// Het schuift met een CSS-overgang op transform; de breedte volgt de knop en verandert alleen bij een andere schermmaat.
// Bij Instellingen is geen menu-item actief: dan vervaagt het pilletje (body.set-open, zie js/02-instellingen.js).
function placeIndicators() {
  const pill = /** @type {HTMLElement|null} */ (document.querySelector('.pill'));
  const a = /** @type {HTMLElement|null} */ (document.querySelector('.pillnav a[aria-current="page"]'));
  if (a && pill && mode === 'd' && a.offsetWidth) {
    pill.style.width = a.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + a.offsetLeft + 'px)';
  }
  const t = /** @type {HTMLElement|null} */ (document.querySelector('.m-tabs a[aria-current="page"]'));
  const ind = /** @type {HTMLElement|null} */ (document.querySelector('.m-tab-ind'));
  if (t && ind && mode === 'm' && t.offsetWidth) { ind.style.width = t.offsetWidth + 'px'; ind.style.transform = 'translateX(' + t.offsetLeft + 'px)'; }
}

// Paginawissel: de oude pagina vervaagt en schuift ± 170 ms weg, de nieuwe komt binnen vanuit de richting van
// het menu (verder naar rechts = van rechts, terug = van links). Alleen transform en opacity, en animaties met
// fill-mode backwards: een transform die blijft staan, maakt van de pagina een nieuw kader voor position: fixed.
const PAGE_OUT_MS = 170;
function showPage(p, animate, force) {
  const prev = ui.page;
  ui.page = p;
  if (M) ensurePage(p);
  const ids = ['home', 'list', 'news', 'stats', 'plan'];
  const el = $(pageId(p));
  const old = prev !== p ? $(pageId(prev)) : null;
  const move = animate && !reduceMotion() && !ui.detail;
  const dir = prev === p ? '' : ORDER[p] > ORDER[prev] ? 'r' : 'l';
  // Menu en titel meteen: het pilletje schuift al terwijl de oude pagina weggaat
  document.body.dataset.page = p;
  $$('.pillnav a, .m-tabs a').forEach((a) => {
    if (a.dataset.page === p) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const mt = $('m-title');
  mt.textContent = TITLES[p];
  if (move && prev !== p) { mt.classList.remove('t-in'); void mt.offsetWidth; mt.classList.add('t-in'); }
  placeIndicators();
  const swap = () => {
    ids.forEach((k) => { $(pageId(k)).hidden = k !== p; });
    if (prev !== p || force) window.scrollTo(0, 0);
    if (typeof heroPast === 'function') heroPast();
  };
  clearTimeout(showPage.timer);
  $$('.page, .m-view').forEach((x) => { x.classList.remove('pg-out', 'pg-in', 'enter'); delete x.dataset.dir; });
  if (!move) { swap(); return; }
  markFresh();
  const enter = () => {
    swap();
    void el.offsetWidth;
    if (dir) el.dataset.dir = dir;
    el.classList.add('pg-in', 'enter');
    showPage.timer = setTimeout(() => { el.classList.remove('pg-in', 'enter'); delete el.dataset.dir; }, 1400);
  };
  if (!old || old.hidden) { enter(); return; }
  old.dataset.dir = dir;
  old.classList.add('pg-out');
  showPage.timer = setTimeout(() => { old.classList.remove('pg-out'); delete old.dataset.dir; enter(); }, PAGE_OUT_MS);
}

function parseHash() {
  // Na een vraagteken staat de weergave (idee 37): #bedrijven?groep=sector&sort=waarde, #overzicht?periode=1m
  const raw0 = location.hash.replace(/^#/, ''), qi = raw0.indexOf('?');
  const h = decodeURIComponent(qi < 0 ? raw0 : raw0.slice(0, qi));
  const q = qi < 0 ? null : new URLSearchParams(raw0.slice(qi + 1));
  if (h.indexOf('bedrijf/') === 0) return { tk: h.slice(8) };
  const pk = Object.keys(PSEUDO).find((k) => PSEUDO[k] === h);
  if (pk) return { tk: pk };
  if (h.indexOf('volg/') === 0) return { tk: '~' + h.slice(5).toUpperCase() };
  return { q, page: h === 'bedrijven' ? 'list' : h === 'statistieken' || h === 'analyse' ? 'stats' : h === 'plannen' ? 'plan' : h === 'nieuws' ? 'news' : 'home' };
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
  // Weergave uit de link eerst, anders de bewaarde keuze (idee 37)
  const viewChanged = applyHashView(r.page, r.q);
  hvReady = true;
  // Stond de bewaarde tekening er al (snelle start)? Dan komt de eerste pagina niet nog eens binnenwandelen
  if (r.page !== ui.page || first) showPage(r.page, !(first && typeof snapTookOver === 'function' && snapTookOver()));
  if (viewChanged && M) refresh(r.page);
  viewHashSync();
}

// ---------- Weergave in de link (idee 37) ----------
// Groep, sortering, filter en zoekterm van Bedrijven en de periode van de grote grafiek staan in de link, zodat je een
// weergave kunt bewaren of delen. Bij openen telt de link; zonder link de bewaarde keuze. Bij elke wijziging past de
// site de link aan zonder extra stap in de geschiedenis (replaceState geeft ook geen hashchange).
const HV_GROEP = { combi: 'detail', tiles: 'tegels', none: 'lijst', sector: 'sector', country: 'land', cur: 'munt', pie: 'pie' };
const HV_SORT = { move: 'verandering', value: 'waarde', result: 'resultaat', name: 'naam' };
const HV_FILTER = { up: 'gestegen', down: 'gedaald' };
const HV_PERIODE = { today: 'vandaag', '1w': '1w', '1m': '30d', ytd: 'ditjaar', '1y': '1j', all: 'alles' };
const hvKey = (map, v) => Object.keys(map).find((k) => map[k] === v);
// Pas na de eerste route de link bijwerken: anders schrijft de eerste tekening de bewaarde keuze over de link heen
let hvReady = false;
function applyHashView(page, q) {
  if (!q) return false;
  let changed = false;
  if (page === 'list') {
    const g = hvKey(HV_GROEP, q.get('groep'));
    if (g && typeof posState === 'object') { if (mode === 'm') posState.m = g === 'tiles' ? 'none' : g === 'combi' ? 'sector' : g; else posState.d = g; changed = true; }
    const so = hvKey(HV_SORT, q.get('sort'));
    if (so) { ui.listSort = so; ui.listDir = q.get('richting') === 'op' ? 'asc' : 'desc'; changed = true; }
    if (q.has('filter')) { ui.listFilter = hvKey(HV_FILTER, q.get('filter')) || 'all'; changed = true; }
    if (q.has('zoek')) {
      ui.listQuery = String(q.get('zoek')).slice(0, 60);
      ['list-search', 'm-search'].forEach((id) => { const el = /** @type {HTMLInputElement|null} */ ($(id)); if (el) el.value = ui.listQuery; });
      changed = true;
    }
  } else if (page === 'home') {
    const pr = hvKey(HV_PERIODE, q.get('periode'));
    if (pr && typeof heroRangeList === 'function' && heroRangeList().some(([k]) => k === pr)) { ui.heroRange = pr; changed = true; }
  }
  return changed;
}
function viewHashSync() {
  if (!hvReady || ui.detail || sharedView || (ui.page !== 'list' && ui.page !== 'home')) return;
  const raw0 = location.hash.replace(/^#/, ''), base = decodeURIComponent(raw0.split('?')[0]), want = pageHash(ui.page);
  if (base && base !== want) return;   // een ander adres (bedrijf, detailpagina): niet aanraken
  const q = new URLSearchParams();
  if (ui.page === 'list') {
    if (typeof posGroupBy === 'function' && HV_GROEP[posGroupBy()]) q.set('groep', HV_GROEP[posGroupBy()]);
    q.set('sort', HV_SORT[ui.listSort] || 'verandering');
    if (ui.listDir === 'asc') q.set('richting', 'op');
    if (HV_FILTER[ui.listFilter]) q.set('filter', HV_FILTER[ui.listFilter]);
    if (ui.listQuery.trim()) q.set('zoek', ui.listQuery.trim());
  } else q.set('periode', HV_PERIODE[typeof heroRangeNow === 'function' ? heroRangeNow() : ui.heroRange] || '1w');
  const h = '#' + want + '?' + q.toString();
  if (location.hash !== h) { try { history.replaceState(history.state, '', h); } catch (e) { /* niet erg */ } }
}

window.addEventListener('hashchange', () => route(false));
onResize(() => { placeIndicators(); setMtop(); }, { lead: true, key: 'balk' });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placeIndicators(); setMtop(); });

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
const VIEW_SCRIPTS = { plan: ['js/29-plannen-extra.js'], analyse: ['js/33-geschiedenis.js'] };
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
      if (M) refresh(n);                   // tekent alleen als de pagina nog open is; anders blijft hij verouderd
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
      await yieldNow();
      if (gen !== renderGen) return;                     // een nieuwere tekenbeurt heeft het overgenomen
      t0 = performance.now();
    }
    refresh(n);
  }
  renderBusy = null;
}
// Pagina openen: eerst bijwerken wat sinds de laatste gegevens nog niet getekend is
function ensurePage(p) {
  if (renderBusy === p) return;   // renderAll() is deze pagina al in stukken aan het tekenen
  const want = (PAGE_VIEWS[p] || []).filter((n) => staleViews.has(n));
  if (!want.length) return;
  want.forEach((n) => staleViews.delete(n));
  refresh(...want);
}


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
  liveKick();   // live koersen er weer overheen (zie js/23-live.js)
}
