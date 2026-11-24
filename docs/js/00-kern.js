/* Investeringstracker – kern: kleine eigen bouwstenen voor de rest van de site
 *
 * De site bestaat uit gewone scripts in docs/js/, die op volgorde laden en één bereik delen
 * (functies en constanten uit het ene bestand zijn in het volgende te gebruiken). Er is geen build-stap.
 *
 * Twee hulpmiddelen:
 *  - weergaven: een stuk van de pagina met een eigen tekenfunctie. renderAll() tekent ze allemaal,
 *    refresh('plan') alleen dat stuk. Een fout in één weergave breekt de rest van de pagina niet.
 *  - tpl`...`: HTML-sjabloon dat ingevoegde waarden automatisch ontsnapt (tegen kapotte opmaak en
 *    ingevoegde code). Voor HTML die je zelf al veilig hebt gemaakt: raw(html).
 *
 * Nieuwe pagina's kunnen ook met Preact als componenten worden gebouwd (zie js/nieuws-preact.js).
 */
'use strict';

// ---------- Weergaven ----------
const VIEWS = new Map();

// name: korte naam; draw: tekent het stuk (mag zelf bepalen of het voor desktop of telefoon is)
function defineView(name, draw) {
  VIEWS.set(name, draw);
}

// Weergaven die nu niet in beeld zijn (een andere pagina dan de open pagina) worden niet getekend maar als
// verouderd onthouden; bij het openen van hun pagina worden ze alsnog bijgewerkt (zie ensurePage in
// js/10-navigatie.js). viewOffscreen(naam) zegt of een weergave nu buiten beeld is; tot de navigatie
// geladen is, telt alles als zichtbaar.
const staleViews = new Set();
let viewOffscreen = (name) => false;

// Teken de genoemde weergaven opnieuw, of alle als er geen namen zijn
function refresh(...names) {
  const list = names.length ? names : [...VIEWS.keys()];
  list.forEach((n) => {
    const draw = VIEWS.get(n);
    if (!draw) return;
    if (viewOffscreen(n)) { staleViews.add(n); return; }
    staleViews.delete(n);
    const t0 = performance.now();
    try { draw(); }
    catch (err) { console.error('Weergave "' + n + '" kon niet worden getekend:', err); }
    perfNote(n, performance.now() - t0);
  });
}

// ---------- Tekentijd per weergave (zichtbaar met ?perf, zie js/15-prestaties.js) ----------
// Altijd meten (een tijdstempel per weergave kost niets); het paneel toont het alleen met ?perf.
const PERF = new Map();
function perfNote(name, ms) {
  const r = PERF.get(name) || { n: 0, last: 0, tot: 0, max: 0 };
  r.n++; r.last = ms; r.tot += ms; r.max = Math.max(r.max, ms);
  PERF.set(name, r);
  if (typeof perfPanelSoon === 'function') perfPanelSoon();
}

// ---------- De browser even laten reageren tussen stukken werk ----------
// Lang werk (meer dan ± 50 ms) in één keer laat de pagina haperen: tikken en scrollen wachten tot het klaar is.
// await yieldNow() geeft de browser tussendoor de beurt. scheduler.yield() (Chrome, Firefox) laat het werk
// daarna voorrang houden; Safari kent dat niet en krijgt setTimeout(0).
function yieldNow() {
  const sch = /** @type {any} */ (window).scheduler;
  if (sch && typeof sch.yield === 'function') return sch.yield();
  return new Promise((ok) => setTimeout(ok, 0));
}

// ---------- Werk samenvoegen: meten en zetten één keer per frame ----------
// rafWork('balk', fn) met dezelfde sleutel in hetzelfde frame doet het werk één keer, in plaats van
// bij elke gebeurtenis opnieuw te meten en te zetten (dat dwingt de browser telkens tot herberekenen).
const rafJobs = new Map();
let rafJobId = 0;
function rafWork(key, fn) {
  rafJobs.set(key, fn);
  if (rafJobId) return;
  rafJobId = requestAnimationFrame(() => {
    rafJobId = 0;
    const jobs = [...rafJobs.values()];
    rafJobs.clear();
    jobs.forEach((j) => { try { j(); } catch (err) { console.error('Werk in dit frame mislukte:', err); } });
  });
}

// ---------- Schermmaat: één luisteraar voor de hele site, met wachttijd ----------
// onResize(fn) doet het werk pas als het slepen even stilligt; met { lead: true } ook meteen bij de
// eerste gebeurtenis (voor goedkoop werk dat direct moet meebewegen).
const RESIZE_WAIT = 140;
const resizeJobs = [];
let resizeTimer = 0;
function onResize(fn, opts) {
  const o = opts || {};
  resizeJobs.push({ fn, lead: !!o.lead, key: o.key || 'r' + resizeJobs.length });
}
function runResizeJobs(leadOnly) {
  resizeJobs.forEach((j) => { if (!leadOnly || j.lead) rafWork('resize:' + j.key, j.fn); });
}
window.addEventListener('resize', () => {
  if (!resizeTimer) runResizeJobs(true);
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { resizeTimer = 0; runResizeJobs(false); }, RESIZE_WAIT);
}, { passive: true });

// Een element in de gaten houden met een ResizeObserver, maar het werk samengevoegd per frame
function observeSize(el, fn, key) {
  if (!el || typeof ResizeObserver !== 'function') return null;
  const ro = new ResizeObserver(() => rafWork((key || 'size') + ':' + (el.id || ''), fn));
  ro.observe(el);
  return ro;
}

// ---------- HTML-sjablonen ----------
// Gemarkeerde HTML die niet opnieuw ontsnapt moet worden
class RawHtml {
  constructor(s) { this.s = String(s == null ? '' : s); }
  toString() { return this.s; }
}
const raw = (s) => new RawHtml(s);
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// tpl`<b>${naam}</b>` -> "<b>naam, ontsnapt</b>". Lijsten worden aan elkaar geplakt; null en false worden leeg.
function tplValue(v) {
  if (v == null || v === false) return '';
  if (v instanceof RawHtml) return v.s;
  if (Array.isArray(v)) return v.map(tplValue).join('');
  return escHtml(v);
}
function tpl(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += tplValue(vals[i]) + strings[i + 1];
  return raw(out);
}
