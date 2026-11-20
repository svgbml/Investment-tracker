// Vaste meetlat voor de snelheid van de site (roadmap.md, punt 9).
//
// Opent de demo (?demo) in Chromium op desktopformaat (1360×900) en op telefoonformaat (390×844) met een
// vier keer tragere processor (ongeveer een middenklasse telefoon) en meet:
//  - wanneer alle scripts zijn ingelezen en uitgevoerd (DOMContentLoaded);
//  - de langste blokkerende taak bij het laden en het aantal taken boven 50 ms in de eerste 4 seconden;
//  - hoe lang renderAll(), alleen Start, alleen Analyse en foldAll() duren (mediaan van een paar keer);
//  - het aantal elementen in de pagina, in totaal en per pagina;
//  - de langste taak bij de eerste keer openen van elke andere pagina.
// Een taak is "blokkerend" als de browser er langer dan 50 ms niet door kan reageren (Long Tasks API).
//
// Draaien:  node tools/meetlat.mjs                      tabel in de terminal
//           node tools/meetlat.mjs --keer 5             vaker laden (mediaan; standaard 3)
//           node tools/meetlat.mjs --json uit.json      ook als JSON bewaren
//           node tools/meetlat.mjs --map ../oud/docs    een andere uitgecheckte versie meten
//           node tools/meetlat.mjs --grens              faalt boven de grenzen in GRENZEN (voor de Lighthouse-werkstroom)
//
// De getallen schommelen per machine en per meting; vergelijk alleen metingen van dezelfde machine.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveDocs, playwright, VAST_MOMENT, DOCS } from './lib-browser.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const KEER = Math.max(1, Number(arg('--keer', 3)) || 3);
const JSON_UIT = arg('--json', '');
const MAP = arg('--map', '');
const GRENS = process.argv.includes('--grens');

// Grenzen voor --grens: ruim boven de huidige stand, zodat alleen een duidelijke verslechtering opvalt
const GRENZEN = {
  desktop: { langsteLaden: 250, elementen: 6000 },
  telefoon: { langsteLaden: 900, elementen: 5000 },
};

const FORMATEN = {
  desktop: { viewport: { width: 1360, height: 900 }, isMobile: false, cpu: 1 },
  telefoon: { viewport: { width: 390, height: 844 }, isMobile: true, cpu: 4 },
};
const PAGINAS = [
  { key: 'home', hash: 'overzicht', d: 'page-home', m: 'm-home' },
  { key: 'list', hash: 'bedrijven', d: 'page-list', m: 'm-list' },
  { key: 'news', hash: 'nieuws', d: 'page-news', m: 'm-news' },
  { key: 'stats', hash: 'analyse', d: 'page-stats', m: 'm-stats' },
  { key: 'plan', hash: 'plannen', d: 'page-plan', m: 'm-plan' },
];

const mediaan = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

// Vóór de scripts van de site: lange taken verzamelen
function initScript() {
  /** @type {any} */ (window).__lt = [];
  try {
    const neem = (lijst) => { for (const e of lijst) /** @type {any} */ (window).__lt.push([e.startTime, e.duration]); };
    const po = new PerformanceObserver((l) => neem(l.getEntries()));
    po.observe({ type: 'longtask', buffered: true });
    // Wat al gemeten is maar nog niet aan de waarnemer is doorgegeven, meteen ophalen
    /** @type {any} */ (window).__ltNu = () => neem(po.takeRecords());
  } catch (e) { /* oude browser */ }
  try { localStorage.setItem('tracker.theme', 'light'); } catch (e) { /* niets */ }
  // Alle gewone scripts en de modules zijn ingelezen en uitgevoerd (de vaste klok van Playwright laat performance.now heel)
  document.addEventListener('DOMContentLoaded', () => { /** @type {any} */ (window).__dcl = performance.now(); });
}

async function openPagina(browser, base, fmt) {
  const f = FORMATEN[fmt];
  const ctx = await browser.newContext({ viewport: f.viewport, isMobile: f.isMobile, hasTouch: f.isMobile, deviceScaleFactor: 1, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', colorScheme: 'light' });
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });
  await page.clock.setFixedTime(new Date(VAST_MOMENT));
  await page.addInitScript(initScript);
  if (f.cpu > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: f.cpu });
  }
  await page.goto(base + '/index.html?demo', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof M !== 'undefined' && M && !document.getElementById('app').hidden, null, { timeout: 60000 });
  // Laten uitlopen tot 6 s na de start, zodat ook uitgesteld werk is gedaan
  await page.waitForFunction(() => performance.now() > 6000, null, { timeout: 60000, polling: 200 });
  return { ctx, page, fouten };
}

// Een actie in de pagina een paar keer doen; geeft de mediane duur en de langste taak in dat venster
async function tijd(page, code, n = 5) {
  return page.evaluate(async ([src, n]) => {
    const fn = new Function('return (async () => { ' + src + ' })()');
    const W = /** @type {any} */ (window);
    const duur = [];
    let langst = 0;
    for (let i = 0; i < n; i++) {
      await new Promise((r) => setTimeout(r, 60));
      const van = W.__lt.length;
      // In een gewone taak van de pagina zelf starten (via setTimeout): werk dat vanuit page.evaluate draait,
      // telt de Long Tasks API niet mee
      const t0 = await new Promise((ok) => setTimeout(async () => { const t = performance.now(); await fn(); duur.push(performance.now() - t); ok(t); }, 0));
      await new Promise((r) => setTimeout(r, 80));
      W.__ltNu();
      W.__lt.slice(van).forEach((x) => { if (x[0] + x[1] > t0) langst = Math.max(langst, x[1]); });   // taken die na de start nog liepen
    }
    duur.sort((a, b) => a - b);
    return { ms: duur[Math.floor((duur.length - 1) / 2)], langst };
  }, [code, n]);
}

async function wachtOpPagina(page, fmt, p) {
  const id = fmt === 'telefoon' ? p.m : p.d;
  await page.waitForFunction((s) => { const el = document.getElementById(s); return el && !el.hidden && el.offsetParent !== null; }, id, { timeout: 30000 });
}

async function meetEenKeer(browser, base, fmt) {
  const { ctx, page, fouten } = await openPagina(browser, base, fmt);
  const r = {};
  const laden = await page.evaluate(() => {
    /** @type {any} */ (window).__ltNu();
    const lt = /** @type {any} */ (window).__lt;
    const eerste = lt.filter((x) => x[0] < 4000);
    return {
      gereed: /** @type {any} */ (window).__dcl,
      langsteLaden: Math.max(0, ...lt.filter((x) => x[0] < 6000).map((x) => x[1])),
      takenLaden: eerste.length,
      blokkeertijd: eerste.reduce((s, x) => s + Math.max(0, x[1] - 50), 0),
    };
  });
  Object.assign(r, laden);
  // Elementen direct na het laden, op Start
  Object.assign(r, await page.evaluate((pag) => {
    const m = document.getElementById('mshell') && document.getElementById('mshell').offsetParent !== null;
    const per = {};
    pag.forEach((p) => { const el = document.getElementById(m ? p.m : p.d); per[p.key] = el ? el.querySelectorAll('*').length : 0; });
    return { elementen: document.querySelectorAll('*').length, perPagina: per };
  }, PAGINAS));
  // Tekenen op Start
  r.renderAll = await tijd(page, 'await renderAll();');
  r.start = await tijd(page, 'await refresh(...PAGE_VIEWS.home);');
  r.foldAll = await tijd(page, 'foldAll();');
  // Elke andere pagina voor het eerst openen: hoe lang blokkeert dat?
  r.openen = {};
  for (const p of PAGINAS.slice(1)) {
    const van = await page.evaluate(() => /** @type {any} */ (window).__lt.length);
    const t0 = await page.evaluate((h) => { const t = performance.now(); location.hash = h; return t; }, p.hash);
    await wachtOpPagina(page, fmt, p);
    await page.waitForTimeout(fmt === 'telefoon' ? 1500 : 600);
    r.openen[p.key] = await page.evaluate(([van, t0]) => {
      /** @type {any} */ (window).__ltNu();
      const lt = /** @type {any} */ (window).__lt.slice(van).filter((x) => x[0] + x[1] > t0);
      return Math.max(0, ...lt.map((x) => x[1]));
    }, [van, t0]);
    if (p.key === 'stats') r.analyse = await tijd(page, 'await refresh(...PAGE_VIEWS.stats);');
  }
  // Elementen na het openen van alle pagina's
  r.elementenNaAlles = await page.evaluate(() => document.querySelectorAll('*').length);
  r.fouten = fouten;
  await ctx.close();
  return r;
}

function samen(runs) {
  const m = (f) => mediaan(runs.map(f));
  const out = {
    gereed: m((r) => r.gereed), langsteLaden: m((r) => r.langsteLaden), takenLaden: m((r) => r.takenLaden), blokkeertijd: m((r) => r.blokkeertijd),
    renderAll: m((r) => r.renderAll.ms), renderAllLangst: m((r) => r.renderAll.langst),
    analyse: m((r) => r.analyse && r.analyse.ms), analyseLangst: m((r) => r.analyse && r.analyse.langst),
    start: m((r) => r.start.ms), foldAll: m((r) => r.foldAll.ms),
    elementen: m((r) => r.elementen), elementenNaAlles: m((r) => r.elementenNaAlles),
    perPagina: {}, openen: {},
    fouten: [...new Set(runs.flatMap((r) => r.fouten))],
  };
  PAGINAS.forEach((p) => { out.perPagina[p.key] = m((r) => r.perPagina[p.key]); });
  PAGINAS.slice(1).forEach((p) => { out.openen[p.key] = m((r) => r.openen[p.key]); });
  return out;
}

const getal = (v, eenheid = '') => (v == null ? '–' : Math.round(v).toLocaleString('nl-NL') + eenheid);

const { chromium } = playwright();
const { base, close } = await serveDocs(MAP ? resolve(MAP) : DOCS);
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const uitslag = {};
try {
  for (const fmt of Object.keys(FORMATEN)) {
    const runs = [];
    for (let i = 0; i < KEER; i++) runs.push(await meetEenKeer(browser, base, fmt));
    uitslag[fmt] = samen(runs);
    process.stderr.write('.');
  }
} finally {
  await browser.close();
  await close();
}
process.stderr.write('\n');

const d = uitslag.desktop, t = uitslag.telefoon;
const rij = (k, a, b) => '| ' + k + ' | ' + a + ' | ' + b + ' |';
const regels = [
  '| Meting | Desktop | Telefoon (4× trager) |',
  '|---|---|---|',
  rij('Scripts ingelezen en uitgevoerd (DOMContentLoaded)', getal(d.gereed, ' ms'), getal(t.gereed, ' ms')),
  rij('Langste blokkerende taak bij het laden', getal(d.langsteLaden, ' ms'), getal(t.langsteLaden, ' ms')),
  rij('Blokkerende taken (> 50 ms) in de eerste 4 seconden', getal(d.takenLaden), getal(t.takenLaden)),
  rij('Blokkeertijd in de eerste 4 seconden (som boven 50 ms)', getal(d.blokkeertijd, ' ms'), getal(t.blokkeertijd, ' ms')),
  rij('Alles opnieuw tekenen (`renderAll`)', getal(d.renderAll, ' ms'), getal(t.renderAll, ' ms')),
  rij('… waarvan langste taak', getal(d.renderAllLangst, ' ms'), getal(t.renderAllLangst, ' ms')),
  rij('Alleen Analyse opnieuw tekenen', getal(d.analyse, ' ms'), getal(t.analyse, ' ms')),
  rij('… waarvan langste taak', getal(d.analyseLangst, ' ms'), getal(t.analyseLangst, ' ms')),
  rij('Alleen Start (home) opnieuw tekenen', getal(d.start, ' ms'), getal(t.start, ' ms')),
  rij('Tegels opvouwen (`foldAll`)', getal(d.foldAll, ' ms'), getal(t.foldAll, ' ms')),
  rij('Elementen in de pagina (na laden, op Start)', getal(d.elementen), getal(t.elementen)),
  ...PAGINAS.map((p) => rij('… waarvan pagina ' + p.key, getal(d.perPagina[p.key]), getal(t.perPagina[p.key]))),
  rij('Elementen na het openen van alle pagina\'s', getal(d.elementenNaAlles), getal(t.elementenNaAlles)),
  ...PAGINAS.slice(1).map((p) => rij('Langste taak bij eerste keer openen: ' + p.key, getal(d.openen[p.key], ' ms'), getal(t.openen[p.key], ' ms'))),
];
console.log(regels.join('\n'));
console.log('\n' + KEER + ' keer geladen per formaat, mediaan. "0 ms" bij een langste taak betekent: geen taak boven 50 ms.');
const fouten = [...d.fouten, ...t.fouten];
if (fouten.length) console.log('\nFouten in de console:\n- ' + fouten.join('\n- '));
if (JSON_UIT) await writeFile(JSON_UIT, JSON.stringify({ gemeten: new Date().toISOString(), keer: KEER, uitslag }, null, 2));

if (GRENS) {
  const over = [];
  for (const fmt of Object.keys(GRENZEN)) {
    const g = GRENZEN[fmt], u = uitslag[fmt];
    if (u.langsteLaden > g.langsteLaden) over.push(fmt + ': langste taak bij laden ' + Math.round(u.langsteLaden) + ' ms (grens ' + g.langsteLaden + ' ms)');
    if (u.elementen > g.elementen) over.push(fmt + ': ' + u.elementen + ' elementen (grens ' + g.elementen + ')');
  }
  if (fouten.length) over.push('fouten in de console');
  if (over.length) { console.log('\nBoven de grens:\n- ' + over.join('\n- ')); process.exit(1); }
  console.log('\nBinnen de grenzen.');
}
