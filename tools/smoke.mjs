// Snelle test van de hele website in een echte browser, met voorbeeldgegevens (?demo).
// Opent elke pagina op bureaublad- en telefoonformaat en faalt bij een fout in de console of bij
// een tegel die buiten het venster uitsteekt.
//
// Draaien:
//   node tools/smoke.mjs              alle pagina's, beide formaten
//   node tools/smoke.mjs --licht      alleen het lichte thema (sneller)
//   node tools/smoke.mjs --houd       de browser niet sluiten (voor zelf kijken)
import { serveDocs, playwright, PAGES, openSite, gotoPage, realErrors, overflow } from './lib-browser.mjs';

const only = process.argv.includes('--licht') ? ['light'] : ['light', 'dark'];
const { chromium } = playwright();
const { base, close } = await serveDocs();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
let failed = 0, checked = 0;
const fail = (msg) => { failed++; console.log('  FOUT ' + msg); };

for (const size of ['desktop', 'telefoon']) {
  for (const theme of only) {
    const { page, ctx, errors } = await openSite(browser, base, { size, theme });
    for (const p of PAGES) {
      try {
        const sel = await gotoPage(page, size, p);
        checked++;
        const ov = await overflow(page);
        if (ov) fail(size + '/' + theme + ' ' + p.key + ': ' + ov.over + 'px te breed (' + ov.wide.join(', ') + ')');
        // Is er echt iets getekend?
        const empty = await page.evaluate((s) => { const el = document.querySelector(s); return !el || el.textContent.trim().length < 20; }, sel);
        if (empty) fail(size + '/' + theme + ' ' + p.key + ': pagina blijft leeg');
        else console.log('  ok  ' + size + '/' + theme + ' ' + p.key);
      } catch (e) {
        fail(size + '/' + theme + ' ' + p.key + ': ' + (e.message || e).split('\n')[0]);
      }
    }
    // Ook een detailpagina van een bedrijf: dat is de meest gebruikte zoom
    try {
      await gotoPage(page, size, PAGES[1]);
      const opened = await page.evaluate(() => {
        // Een echt bedrijf, geen pseudopagina (@account, @risk, @compare …)
        const row = /** @type {HTMLElement} */ ([...document.querySelectorAll('[data-ticker]')].find((el) => !/^[@]/.test(el.getAttribute('data-ticker') || '')));
        if (!row) return null;
        row.click();
        return row.getAttribute('data-ticker');
      });
      if (!opened) fail(size + '/' + theme + ': geen bedrijf om te openen');
      else {
        await page.waitForFunction(() => { const d = document.getElementById('detail'); return d && !d.hidden; }, null, { timeout: 8000 });
        await page.waitForTimeout(600);
        checked++;
        const ov = await overflow(page);
        if (ov) fail(size + '/' + theme + ' detail ' + opened + ': ' + ov.over + 'px te breed (' + ov.wide.join(', ') + ')');
        else console.log('  ok  ' + size + '/' + theme + ' detail ' + opened);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } catch (e) {
      fail(size + '/' + theme + ' detailpagina: ' + (e.message || e).split('\n')[0]);
    }
    const errs = realErrors(errors);
    if (errs.length) errs.slice(0, 6).forEach((e) => fail(size + '/' + theme + ' console: ' + e.text.split('\n')[0].slice(0, 200)));
    await ctx.close();
  }
}
await browser.close();
await close();
console.log(failed ? failed + ' fouten (' + checked + ' paginaweergaven)' : 'Website in orde: ' + checked + ' paginaweergaven zonder fouten in de console en zonder overloop.');
process.exit(failed ? 1 : 0);
