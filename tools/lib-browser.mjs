// Gedeelde hulp voor de browsertests: docs/ lokaal uitserveren en een pagina openen met Playwright.
// Gebruikt door check-demo.mjs, smoke.mjs, test-reken.mjs, a11y.mjs en visual.mjs.
//
// Playwright hoort niet bij de site zelf; het is alleen voor de controles. In deze omgeving staat het al
// globaal, in GitHub Actions wordt het door de werkstroom geïnstalleerd. createRequire vindt beide.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const DOCS = fileURLToPath(new URL('../docs/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

// Kleine statische server voor docs/ op een vrije poort. Met een eigen map kan ook een andere
// uitgecheckte versie van de site worden bekeken (zie tools/visual.mjs).
export async function serveDocs(root = DOCS) {
  const dir = root.endsWith('/') ? root : root + '/';
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(req.url.split('?')[0]);
      const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
      const file = join(dir, rel);
      if (!file.startsWith(dir)) { res.writeHead(403).end('nee'); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('niet gevonden');
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, close: () => new Promise((ok) => server.close(ok)) };
}

export function playwright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch (e) {
    try { return require('playwright-core'); } catch (e2) {
      console.error('Playwright ontbreekt. Installeer het eenmalig: npm i --no-save playwright && npx playwright install chromium');
      process.exit(2);
    }
  }
}

// Een vast moment voor schermafbeeldingen: dinsdagmiddag, markt open, zodat er intradaggegevens zijn
export const VAST_MOMENT = '2026-11-17T15:40:00+01:00';

export const SIZES = {
  desktop: { width: 1360, height: 900, isMobile: false },
  telefoon: { width: 390, height: 844, isMobile: true },
};

// De pagina's van de site: naam, anker en waar de inhoud staat (desktop en telefoon)
export const PAGES = [
  { key: 'home', hash: '#overzicht', desktop: '#page-home', telefoon: '#m-home' },
  { key: 'list', hash: '#bedrijven', desktop: '#page-list', telefoon: '#m-list' },
  { key: 'news', hash: '#nieuws', desktop: '#page-news', telefoon: '#m-news' },
  { key: 'stats', hash: '#analyse', desktop: '#page-stats', telefoon: '#m-stats' },
  { key: 'plan', hash: '#plannen', desktop: '#page-plan', telefoon: '#m-plan' },
];

// Een pagina openen met voorbeeldgegevens. Geeft de pagina terug plus de verzamelde fouten uit de console.
export async function openSite(browser, base, { size = 'desktop', theme = 'light', query = '?demo', hash = '', motion = 'off', fixedTime = null } = {}) {
  const dim = SIZES[size] || SIZES.desktop;
  const ctx = await browser.newContext({ viewport: { width: dim.width, height: dim.height }, deviceScaleFactor: 1, isMobile: dim.isMobile, hasTouch: dim.isMobile, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', colorScheme: theme === 'dark' ? 'dark' : 'light' });
  const errors = [];
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push({ type: m.type(), text: m.text() }); });
  page.on('pageerror', (e) => errors.push({ type: 'pageerror', text: String(e && e.message || e) }));
  // Thema en animaties vastzetten: anders volgt de site het apparaat en worden metingen onrustig
  // Met een vaste tijd zijn de voorbeeldgegevens elke keer gelijk (nodig om afbeeldingen te vergelijken)
  if (fixedTime) await page.clock.setFixedTime(new Date(fixedTime));
  await page.addInitScript(([t, m]) => {
    try { localStorage.setItem('tracker.theme', t); localStorage.setItem('tracker.motion', m); } catch (e) { /* niets */ }
  }, [theme, motion]);
  await page.goto(base + '/index.html' + query + hash, { waitUntil: 'load' });
  // Wachten tot de site de voorbeeldgegevens heeft getekend
  await page.waitForFunction(() => {
    const shell = document.getElementById('app'), m = document.getElementById('m-main');
    return (shell && !shell.hidden) || (m && !m.hidden);
  }, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  return { page, ctx, errors };
}

// Naar een pagina van de site gaan en wachten tot die zichtbaar is
export async function gotoPage(page, size, p) {
  await page.evaluate((h) => { location.hash = h; }, p.hash);
  const sel = size === 'telefoon' ? p.telefoon : p.desktop;
  await page.waitForFunction((s) => { const el = document.querySelector(s); return el && !el.hidden && el.offsetParent !== null; }, sel, { timeout: 10000 });
  await page.waitForTimeout(350);
  return sel;
}

// Fouten uit de console die niets met de site te maken hebben (de service worker praat niet mee op http)
const IGNORE = [/service ?worker/i, /favicon/i, /Download the React DevTools/i, /\[DOM\]/];
export const realErrors = (errors) => errors.filter((e) => e.type !== 'warning' && !IGNORE.some((re) => re.test(e.text)));

// Horizontale overloop: kan de bezoeker zijwaarts schuiven? Alleen dan steekt er echt iets uit.
// (Een tegel die alleen door een vergrotende transform breder meet, is geen overloop: die kun je niet wegschuiven.)
export async function overflow(page) {
  return page.evaluate(() => {
    const d = /** @type {HTMLElement} */ (document.scrollingElement || document.documentElement);
    const was = d.scrollLeft;
    d.scrollLeft = 9999;
    const over = d.scrollLeft;
    d.scrollLeft = was;
    if (over <= 2) return null;
    // Zoeken welk element uitsteekt, dat helpt bij het oplossen. Onzichtbare lagen tellen niet mee:
    // de weergave achter een detailpagina staat op opacity 0 en is dus niet te zien of te raken.
    const visible = (el) => {
      for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
        const cs = getComputedStyle(/** @type {Element} */ (p));
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      }
      return true;
    };
    const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const wide = [...document.querySelectorAll('body *')].filter((el) => {
      const h = /** @type {HTMLElement} */ (el);
      if (!h.offsetParent && el !== document.body) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > window.innerWidth + 2 && visible(el);
    }).slice(0, 5).map(name);
    if (!wide.length) return null;
    return { over, wide };
  });
}
