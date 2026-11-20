// Schermafbeeldingen van de belangrijkste pagina's (licht en donker, bureaublad en telefoon) en het
// verschil met een andere versie van de site. Bedoeld om bij een pull request te zien wat er zichtbaar
// verandert; voorlopig niet blokkerend (zie .github/workflows/kwaliteit.yml).
//
// De klok staat vast (zie VAST_MOMENT) zodat de voorbeeldgegevens elke keer gelijk zijn; zonder die
// vaste tijd verschuiven alle grafieken met de echte tijd en is vergelijken zinloos.
//
// Draaien:
//   node tools/visual.mjs --uit map                      afbeeldingen maken van deze werkmap
//   node tools/visual.mjs --docs pad/docs --uit map      van een andere uitgecheckte versie
//   node tools/visual.mjs --vergelijk mapOud mapNieuw [--diff map]
//
// Vergelijken gebruikt pixelmatch en pngjs (npm i --no-save pixelmatch pngjs). Ontbreken ze, dan worden
// alleen de afbeeldingen gemaakt.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { serveDocs, playwright, PAGES, openSite, gotoPage, VAST_MOMENT } from './lib-browser.mjs';

const require = createRequire(import.meta.url);
const arg = (naam) => { const i = process.argv.indexOf(naam); return i > 0 ? process.argv[i + 1] : null; };

// ---------- Vergelijken ----------
if (process.argv.includes('--vergelijk')) {
  const i = process.argv.indexOf('--vergelijk');
  const oud = resolve(process.argv[i + 1] || ''), nieuw = resolve(process.argv[i + 2] || '');
  const diffDir = arg('--diff');
  let pixelmatch = null, PNG = null;
  try {
    const pm = require('pixelmatch');
    pixelmatch = typeof pm === 'function' ? pm : pm.default;
    PNG = require('pngjs').PNG;
  } catch (e) {
    console.log('pixelmatch/pngjs ontbreken (npm i --no-save pixelmatch pngjs); alleen de lijst met bestanden:');
  }
  if (diffDir) mkdirSync(diffDir, { recursive: true });
  const namen = [...new Set([...readdirSync(oud), ...readdirSync(nieuw)])].filter((f) => f.endsWith('.png')).sort();
  const rows = [];
  for (const f of namen) {
    const a = join(oud, f), b = join(nieuw, f);
    if (!existsSync(a)) { rows.push({ f, status: 'nieuw' }); continue; }
    if (!existsSync(b)) { rows.push({ f, status: 'weg' }); continue; }
    if (!pixelmatch) { rows.push({ f, status: 'niet vergeleken' }); continue; }
    const A = PNG.sync.read(readFileSync(a)), B = PNG.sync.read(readFileSync(b));
    if (A.width !== B.width || A.height !== B.height) { rows.push({ f, status: 'ander formaat', extra: A.width + '×' + A.height + ' → ' + B.width + '×' + B.height }); continue; }
    const out = new PNG({ width: A.width, height: A.height });
    const n = pixelmatch(A.data, B.data, out.data, A.width, A.height, { threshold: 0.1 });
    const pct = (100 * n) / (A.width * A.height);
    rows.push({ f, status: n ? 'verschil' : 'gelijk', pct, n });
    if (n && diffDir) writeFileSync(join(diffDir, f), PNG.sync.write(out));
  }
  const anders = rows.filter((r) => r.status !== 'gelijk');
  console.log('Vergelijking van ' + rows.length + ' afbeeldingen: ' + anders.length + ' anders.');
  rows.forEach((r) => {
    if (r.status === 'gelijk') return;
    console.log('  ' + r.f.padEnd(34) + r.status + (r.pct != null ? ' (' + r.pct.toFixed(2) + '% van de pixels, ' + r.n + ')' : r.extra ? ' ' + r.extra : ''));
  });
  // Korte samenvatting voor een reactie bij de pull request
  if (process.env.GITHUB_OUTPUT) {
    const sum = anders.length ? anders.map((r) => '- `' + r.f + '`: ' + r.status + (r.pct != null ? ' (' + r.pct.toFixed(2) + '%)' : '')).join('\n') : 'Geen zichtbare verschillen.';
    writeFileSync(process.env.GITHUB_OUTPUT, 'anders=' + anders.length + '\nsamenvatting<<EOF\n' + sum + '\nEOF\n', { flag: 'a' });
  }
  process.exit(0);
}

// ---------- Afbeeldingen maken ----------
const uit = arg('--uit');
if (!uit) { console.error('Gebruik: node tools/visual.mjs --uit map [--docs pad/docs]  of  --vergelijk mapOud mapNieuw'); process.exit(2); }
mkdirSync(uit, { recursive: true });
const docs = arg('--docs');
const { chromium } = playwright();
const { base, close } = await serveDocs(docs ? resolve(docs) + '/' : undefined);
const browser = await chromium.launch({ args: ['--no-sandbox'] });
let n = 0;

for (const size of ['desktop', 'telefoon']) {
  for (const theme of ['light', 'dark']) {
    const { page, ctx } = await openSite(browser, base, { size, theme, fixedTime: VAST_MOMENT });
    // Secties met content-visibility: auto tekent de browser pas als ze in beeld komen; een schermafbeelding van
    // de hele pagina zou ze leeg laten. Voor de afbeeldingen dus alles tekenen (op de site zelf verandert niets).
    await page.addStyleTag({ content: '.dash-sec { content-visibility: visible !important; }' });
    for (const p of PAGES) {
      await gotoPage(page, size, p);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(uit, [p.key, size, theme].join('-') + '.png'), fullPage: true, animations: 'disabled' });
      n++;
    }
    // Ook één detailpagina: die heeft eigen opmaak
    try {
      await gotoPage(page, size, PAGES[1]);
      const tk = await page.evaluate(() => {
        const row = /** @type {HTMLElement} */ ([...document.querySelectorAll('[data-ticker]')].find((el) => !/^[@]/.test(el.getAttribute('data-ticker') || '')));
        if (!row) return null;
        row.click();
        return row.getAttribute('data-ticker');
      });
      if (tk) {
        await page.waitForFunction(() => { const d = document.getElementById('detail'); return d && !d.hidden; }, null, { timeout: 8000 });
        await page.waitForTimeout(700);
        await page.screenshot({ path: join(uit, ['detail', size, theme].join('-') + '.png'), fullPage: true, animations: 'disabled' });
        n++;
      }
    } catch (e) { console.log('  (detailpagina overgeslagen: ' + (e.message || e).split('\n')[0] + ')'); }
    await ctx.close();
  }
}
await browser.close();
await close();
console.log(n + ' afbeeldingen in ' + uit);
