// Controle van de voorbeeldweergave (?demo): elke tegel hoort met voorbeeldgegevens iets te laten zien.
// Faalt bij "nog geen gegevens", NaN, undefined, null of € NaN in de tekst van een tegel, op alle pagina's,
// op bureaublad- en telefoonformaat. Zo wordt een nieuwe functie zonder voorbeeldgegevens meteen gezien
// (AGENTS.md: elke nieuwe functie heeft voorbeeldgegevens nodig).
//
// Draaien: node tools/check-demo.mjs
//          node tools/check-demo.mjs --lijst    toont alle gevonden tegels per pagina
import { serveDocs, playwright, PAGES, openSite, gotoPage, realErrors } from './lib-browser.mjs';

const show = process.argv.includes('--lijst');

// Teksten die betekenen: hier is niets. "nog geen gegevens" is de standaardtekst van de site.
const EMPTY = [
  /\bnog geen [a-z]/i, /\bnog te weinig [a-z]/i, /hiervoor zijn minstens/i, /\bgeen (gegevens|metingen|koershistorie|koersgeschiedenis)\b/i,
];
// Rekenfouten die nooit in de pagina horen te staan
const BROKEN = [/\bNaN\b/, /\bundefined\b/, /\bnull\b/, /\bInfinity\b/, /€\s*NaN/, /\[object Object\]/];

// Zinnen die wel "nog geen" bevatten maar niets over ontbrekende gegevens zeggen (uitleg, geen lege tegel)
const GEEN_PROBLEEM = [/je meet nog geen jaar/i, /nog geen jaar:/i];
// Tegels waarvan het goed is dat ze in de demo leeg of uitgeschakeld zijn, met de reden.
// Hou deze lijst kort: hij is bedoeld voor dingen die zonder eigen Worker niet kunnen bestaan.
const TOEGESTAAN = [
  { bevat: 'Fouten op de website', waarom: 'in de demo zijn er geen gemelde fouten' },
];

const { chromium } = playwright();
const { base, close } = await serveDocs();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
let failed = 0, tiles = 0;
const fail = (msg) => { failed++; console.log('  FOUT ' + msg); };

for (const size of ['desktop', 'telefoon']) {
  const { page, ctx, errors } = await openSite(browser, base, { size, theme: 'light' });
  for (const p of PAGES) {
    const sel = await gotoPage(page, size, p);
    // Alle secties uitklappen: ingeklapte tegels verbergen hun inhoud
    await page.evaluate(() => { try { document.querySelectorAll('.tile.folded').forEach((t) => t.classList.remove('folded')); } catch (e) { /* niets */ } });
    const found = await page.evaluate((s) => {
      const root = document.querySelector(s);
      if (!root) return [];
      const list = [...root.querySelectorAll('.tile, .m-card, section.tile')].filter((t) => !t.querySelector('.tile'));
      return list.map((t) => {
        const h = t.querySelector('h2, h3, h4, .m-head h2');
        return { kop: (h ? h.textContent : (t.id || t.className)).trim().slice(0, 70), tekst: t.textContent.replace(/\s+/g, ' ').trim().slice(0, 600) };
      });
    }, sel);
    tiles += found.length;
    if (show) console.log('  ' + size + ' ' + p.key + ': ' + found.length + ' tegels — ' + found.map((f) => f.kop).join(' | '));
    found.forEach((f) => {
      const ok = TOEGESTAAN.find((t) => f.kop.includes(t.bevat));
      const tekst = GEEN_PROBLEEM.reduce((t, re) => t.replace(re, ''), f.tekst);
      const leeg = EMPTY.find((re) => re.test(tekst));
      if (leeg && !ok) fail(size + '/' + p.key + ' tegel "' + f.kop + '": "' + (tekst.match(leeg) || [''])[0] + '…" (voorbeeldgegevens toevoegen in docs/js/14-demo.js)');
      const stuk = BROKEN.find((re) => re.test(f.tekst));
      if (stuk) fail(size + '/' + p.key + ' tegel "' + f.kop + '": ' + f.tekst.match(stuk)[0] + ' in de tekst');
    });
  }
  const errs = realErrors(errors);
  errs.slice(0, 5).forEach((e) => fail(size + ' console: ' + e.text.split('\n')[0].slice(0, 200)));
  await ctx.close();
}
await browser.close();
await close();
console.log(failed ? failed + ' fouten in de voorbeeldweergave' : 'Voorbeeldweergave in orde: ' + tiles + ' tegels bekeken, geen lege tegels of rekenfouten.');
process.exit(failed ? 1 : 0);
