/* Investeringstracker – Basis: opmaak van getallen, thema, animaties, toestand van de site
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Basis ----------
const CFG = window.TRACKER_CONFIG || {};
const LS_TOKEN = 'tracker.token';
const LS_URL = 'tracker.url';
const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const TOTAL = 'TOTAAL';
const MAX_DAY_MOVE = 0.25;   // grotere dagbeweging = vrijwel zeker een aankoop of verkoop
const MAX_STEP_MOVE = 0.15;  // idem voor één stap in een vergelijkingsgrafiek
const MIN_DAYS_BEST = 3;     // minimaal aantal dagen voor beste/slechtste dag
const MIN_DAYS_SD = 5;       // voor beweeglijkheid
const MIN_DAYS_CORR = 10;    // voor samenhang met de portefeuille
const ZOOM_MS = 450;
const HOUR = 3600e3;
const DAY = 864e5;

// Taal: Nederlands (standaard) of Engels; getallen en datums volgen de gekozen taal
// Taal: Nederlands (standaard), Engels, Duits of Frans; getallen en datums volgen de gekozen taal
const LANG = (() => { try { const l = localStorage.getItem('tracker.lang'); return ['en', 'de', 'fr'].includes(l) ? l : 'nl'; } catch (e) { return 'nl'; } })();
const LOCALE = { en: 'en-GB', de: 'de-DE', fr: 'fr-FR' }[LANG] || 'nl-NL';
const VERSION = 'v78';
const nf = (o) => new Intl.NumberFormat(LOCALE, o);
// Getallen: per apparaat te kiezen bij Instellingen > Weergave (zie js/15-ui.js).
// numFmtKort: bedragen vanaf duizend afgekort (€ 12,3K) in plaats van volledig (€ 12.345,60).
// numFmtDec: aantal decimalen voor bedragen en procenten (0, 1 of 2).
let numFmtKort = (() => { try { return localStorage.getItem('tracker.num') === 'kort'; } catch (e) { return false; } })();
let numFmtDec = (() => { try { const v = localStorage.getItem('tracker.dec'); return v === '0' ? 0 : v === '1' ? 1 : 2; } catch (e) { return 2; } })();
const NUM_KORT_VAN = 1000; // vanaf dit bedrag afkorten
let EUR, EURK, P2, P1;
function buildNumFmt() {
  const d = numFmtDec;
  EUR = nf({ style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d });
  EURK = nf({ style: 'currency', currency: 'EUR', notation: 'compact', compactDisplay: 'short', minimumFractionDigits: 0, maximumFractionDigits: 1 });
  P2 = nf({ style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d });
  P1 = nf({ style: 'percent', minimumFractionDigits: Math.min(d, 1), maximumFractionDigits: Math.min(d, 1) });
}
buildNumFmt();
// Opmaker voor bedragen: kiest zelf tussen volledig en afgekort
const EURF = { format: (v) => (numFmtKort && Math.abs(v) >= NUM_KORT_VAN ? EURK.format(v) : EUR.format(v)) };
const N2 = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const N4 = nf({ maximumFractionDigits: 4 });
const N1 = nf({ maximumFractionDigits: 1 });
const NI = nf({ maximumFractionDigits: 0 });
const fDT = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fD = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
const fDM = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const fHM = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const fWH = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

const isNum = (v) => typeof v === 'number' && isFinite(v);
// Bedragen verbergen (privacyknop): alle euro's in de weergave worden puntjes
let hideAmounts = (() => { try { return localStorage.getItem('tracker.hide') === '1'; } catch (e) { return false; } })();
const HIDDEN = '€ ••••';
// v === 0 vangt ook −0: anders zou Intl "€ -0,00" maken (zie tools/test-reken.mjs)
const eur = (v) => (!isNum(v) ? '–' : hideAmounts ? HIDDEN : EURF.format(v === 0 ? 0 : v));
const sgn = (v, f) => (!isNum(v) ? '–' : (v > 0 ? '+\u2060' : v < 0 ? '−\u2060' : '') + f.format(Math.abs(v)));
const seur = (v) => (hideAmounts && isNum(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + HIDDEN : sgn(v, EURF));
const spct = (v) => sgn(v, P2);
const spct1 = (v) => sgn(v, P1);
const tone = (v) => (!isNum(v) || v === 0 ? '' : v > 0 ? 'gain' : 'loss');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const stdev = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };
const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const hourStart = (t) => Math.floor(t / HOUR) * HOUR;
const days = (n) => n + (n === 1 ? ' dag' : ' dagen');
// Animaties: automatisch (volgt "minder beweging" van het apparaat), altijd aan of uit
const MOTION_MQ = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionPref = () => { try { return localStorage.getItem('tracker.motion') || 'auto'; } catch (e) { return 'auto'; } };
const reduceMotion = () => { const p = motionPref(); return p === 'off' || (p === 'auto' && MOTION_MQ.matches); };
function applyMotion() { document.documentElement.dataset.motion = reduceMotion() ? 'off' : 'on'; }
applyMotion();
MOTION_MQ.addEventListener('change', () => { applyMotion(); if (typeof syncMotionButtons === 'function') syncMotionButtons(); });
let freshTimer = null;
// Kort na laden, een paginawissel of inzoomen groeien balken en meters op (html.fresh)
function markFresh() {
  if (reduceMotion()) return;
  const r = document.documentElement;
  r.classList.remove('fresh'); void r.offsetWidth; r.classList.add('fresh');
  clearTimeout(freshTimer); freshTimer = setTimeout(() => r.classList.remove('fresh'), 1900);
}
// Getal laten oplopen naar de nieuwe waarde
function countTo(el, v, fmt) {
  if (!el) return;
  const prevStr = el.dataset.v || '';
  const prev = Number(prevStr);
  el.dataset.v = isNum(v) ? String(v) : '';
  if (!isNum(v) || reduceMotion() || hideAmounts) { el.textContent = fmt(v); return; }
  const from = prevStr && isNum(prev) ? prev : v * 0.92;
  if (Math.abs(from - v) < 0.005) { el.textContent = fmt(v); return; }
  const t0 = performance.now(), dur = 900;
  cancelAnimationFrame(el._raf);
  if (!(el.firstChild && el.firstChild.nodeType === 3)) el.textContent = fmt(from);
  const step = (now) => { const k = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - k, 3); el.firstChild.nodeValue = fmt(from + (v - from) * e); if (k < 1) el._raf = requestAnimationFrame(step); };
  el._raf = requestAnimationFrame(step);
}
const C = { accent: '#2B5BD7', gain: '#0B7A4B', loss: '#B4311F', ink2: '#5B6472', soft: '#8FAEF0', ink: '#14181F', grid: '#9AA3B5' };
// Thema: licht, donker, amoled of automatisch (volgt het apparaat tussen licht en donker); accentkleur per apparaat.
// setThemeAttrs() en accentVars() staan in js/00-vroeg.js (die draait al vóór de eerste tekening).
// Grafieken lezen hun kleuren uit C: na een wissel van thema of accent dus opnieuw tekenen (rerenderAll).
const THEME_MQ = window.matchMedia('(prefers-color-scheme: dark)');
const themePref = () => { try { const t = localStorage.getItem('tracker.theme'); return ['light', 'dark', 'amoled'].includes(t) ? t : 'auto'; } catch (e) { return 'auto'; } };
function applyTheme() {
  setThemeAttrs();
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
  C.accent = v('--accent', '#2B5BD7'); C.gain = v('--gain', '#0B7A4B'); C.loss = v('--loss', '#B4311F'); C.ink2 = v('--ink-2', '#5B6472'); C.ink = v('--ink', '#14181F'); C.soft = v('--accent-soft', '#8FAEF0');
  C.grid = v('--grid', '#9AA3B5'); // hulplijnen in grafieken (donker lichter, zodat ze zichtbaar blijven)
}
applyTheme();
const toneColor = (v) => (isNum(v) && v < 0 ? C.loss : C.gain);

const MQ = window.matchMedia('(max-width: 700px)');
let mode = MQ.matches ? 'm' : 'd';
/** Gegevens van de Worker, zoals /api/data ze stuurt (zie types.d.ts). @type {TrackerData} */
let data = null;
/** Afgeleid model voor de tegels, gemaakt door derive() (zie types.d.ts). @type {Model} */
let M = null;
let demo = false;
let refreshTimer = null;
let pushedDetail = false;
let firstRender = true;
const ui = {
  page: 'home', heroRange: '3d',
  listSort: 'move', listFilter: 'all', listSpan: 'today', listQuery: '', listDir: 'desc', listGroup: true, listPane: 'pos',
  detail: null, detailRange: '3d', compare: false, origin: null, mTab: 'pos',
};
const RANGES = [['today', 'Vandaag'], ['3d', '3 dagen'], ['1m', '30 dagen'], ['ytd', 'Dit jaar'], ['1y', '1 jaar'], ['all', 'Alles']];
