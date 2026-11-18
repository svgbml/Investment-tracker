// Toegankelijkheidscontrole met axe-core op de voorbeeldweergave: elke pagina, licht en donker,
// op bureaublad- en telefoonformaat. Voorlopig niet blokkerend (zie .github/workflows/kwaliteit.yml):
// het geeft een lijst met bevindingen zodat ze stap voor stap opgelost kunnen worden.
//
// Draaien:  npm i --no-save axe-core && node tools/a11y.mjs
//           node tools/a11y.mjs --strict       stop met 1 bij ernstige bevindingen
//           node tools/a11y.mjs --json bestand schrijf de bevindingen weg
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { serveDocs, playwright, PAGES, openSite, gotoPage } from './lib-browser.mjs';

const require = createRequire(import.meta.url);
let axePath = null;
try { axePath = require.resolve('axe-core/axe.min.js'); } catch (e) {
  console.error('axe-core ontbreekt. Installeer het eenmalig: npm i --no-save axe-core');
  process.exit(2);
}
const strict = process.argv.includes('--strict');
const jsonAt = process.argv.indexOf('--json');

const { chromium } = playwright();
const { base, close } = await serveDocs();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const all = [];

for (const size of ['desktop', 'telefoon']) {
  for (const theme of ['light', 'dark']) {
    const { page, ctx } = await openSite(browser, base, { size, theme });
    await page.addScriptTag({ path: axePath });
    for (const p of PAGES) {
      const sel = await gotoPage(page, size, p);
      const res = await page.evaluate(async (s) => {
        // Alleen de zichtbare pagina; de verborgen weergaven zijn niet te gebruiken en tellen niet mee
        const r = await window.axe.run(s, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, waar: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
      }, sel);
      res.forEach((v) => all.push(Object.assign({ size, theme, pagina: p.key }, v)));
    }
    await ctx.close();
  }
}
await browser.close();
await close();

// Dezelfde bevinding op meerdere pagina's één keer tonen
const per = new Map();
all.forEach((v) => {
  const o = per.get(v.id) || { id: v.id, impact: v.impact, help: v.help, n: 0, waar: new Set(), pagina: new Set() };
  o.n += v.n; v.waar.forEach((w) => o.waar.add(w)); o.pagina.add(v.pagina + '/' + v.size + '/' + v.theme);
  per.set(v.id, o);
});
const RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const list = [...per.values()].sort((a, b) => (RANK[a.impact] || 9) - (RANK[b.impact] || 9));
if (jsonAt > 0 && process.argv[jsonAt + 1]) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(list.map((o) => ({ ...o, waar: [...o.waar], pagina: [...o.pagina] })), null, 2) + '\n');

console.log('Toegankelijkheid (axe-core, WCAG 2.1 A en AA) op ' + PAGES.length + ' pagina\'s, 2 formaten, 2 thema\'s:');
if (!list.length) console.log('Geen bevindingen.');
list.forEach((o) => {
  console.log('  ' + String(o.impact || 'onbekend').padEnd(8) + ' ' + o.id + ': ' + o.help + ' (' + o.n + 'x, bijv. ' + [...o.waar].slice(0, 2).join(' | ') + ')');
  console.log('           pagina\'s: ' + [...o.pagina].join(', '));
  if (process.env.GITHUB_ACTIONS) console.log('::warning::axe ' + o.id + ' (' + o.impact + '): ' + o.help + ' — ' + o.n + ' plekken');
});
const ernstig = list.filter((o) => o.impact === 'critical' || o.impact === 'serious').length;
console.log(list.length + ' soort(en) bevindingen, waarvan ' + ernstig + ' ernstig.');
process.exit(strict && ernstig ? 1 : 0);
