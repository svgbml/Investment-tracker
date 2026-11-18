// Leest de uitvoer van Lighthouse CI (manifest.json in de rapportmap) en vergelijkt twee metingen,
// zodat bij een pull request te zien is wat er aan snelheid, toegankelijkheid en grootte verandert.
//
// Draaien:
//   node tools/lh-score.mjs --lees .lighthouseci-report > nieuw.json
//   node tools/lh-score.mjs --vergelijk oud.json nieuw.json           tabel in Markdown
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const arg = (naam) => { const i = process.argv.indexOf(naam); return i > 0 ? process.argv[i + 1] : null; };
const NAMEN = { performance: 'Snelheid', accessibility: 'Toegankelijkheid', 'best-practices': 'Goede gewoonten', seo: 'Vindbaarheid', pwa: 'App' };
const MAAT = { 'first-contentful-paint': 'Eerste tekst (ms)', 'largest-contentful-paint': 'Grootste blok (ms)', 'total-blocking-time': 'Blokkeertijd (ms)',
  'cumulative-layout-shift': 'Verschuiving', 'speed-index': 'Snelheidsindex (ms)', 'interactive': 'Klaar voor gebruik (ms)' };

// De score van de representatieve meting per adres uit manifest.json, plus een paar maten uit het rapport
function lees(dir) {
  const mf = join(dir, 'manifest.json');
  if (!existsSync(mf)) {
    const los = readdirSync(dir).filter((f) => /^lhr-.*\.json$/.test(f));
    if (!los.length) { console.error('Geen Lighthouse-rapport in ' + dir); process.exit(2); }
    return [rapport(JSON.parse(readFileSync(join(dir, los[0]), 'utf8')))];
  }
  const man = JSON.parse(readFileSync(mf, 'utf8'));
  return man.filter((m) => m.isRepresentativeRun).map((m) => {
    const lhr = existsSync(m.jsonPath) ? JSON.parse(readFileSync(m.jsonPath, 'utf8')) : null;
    return lhr ? rapport(lhr) : { url: m.url, scores: m.summary, maten: {} };
  });
}
function rapport(lhr) {
  const scores = {};
  Object.entries(lhr.categories || {}).forEach(([k, v]) => { if (v.score != null) scores[k] = v.score; });
  const maten = {};
  Object.keys(MAAT).forEach((k) => { const a = lhr.audits && lhr.audits[k]; if (a && a.numericValue != null) maten[k] = a.numericValue; });
  const bytes = (lhr.audits && lhr.audits['resource-summary'] && lhr.audits['resource-summary'].details && lhr.audits['resource-summary'].details.items) || [];
  const tot = bytes.find((x) => x.resourceType === 'total');
  if (tot) maten.bytes = tot.transferSize;
  return { url: lhr.finalDisplayedUrl || lhr.requestedUrl, scores, maten };
}

if (process.argv.includes('--lees')) {
  const out = lees(arg('--lees'));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

if (process.argv.includes('--vergelijk')) {
  const i = process.argv.indexOf('--vergelijk');
  const oud = JSON.parse(readFileSync(process.argv[i + 1], 'utf8'))[0] || { scores: {}, maten: {} };
  const nieuw = JSON.parse(readFileSync(process.argv[i + 2], 'utf8'))[0] || { scores: {}, maten: {} };
  const pijl = (d, omlaagIsBeter) => (Math.abs(d) < 1e-9 ? '→' : (d > 0) === !omlaagIsBeter ? '🟢 ↑' : '🔴 ↓');
  const regels = [];
  regels.push('| Onderdeel | main | deze tak | verschil |', '| --- | ---: | ---: | :--- |');
  Object.keys(NAMEN).forEach((k) => {
    if (oud.scores[k] == null && nieuw.scores[k] == null) return;
    const a = oud.scores[k] == null ? null : Math.round(oud.scores[k] * 100);
    const b = nieuw.scores[k] == null ? null : Math.round(nieuw.scores[k] * 100);
    const d = a == null || b == null ? null : b - a;
    regels.push('| ' + NAMEN[k] + ' | ' + (a == null ? '–' : a) + ' | ' + (b == null ? '–' : b) + ' | ' + (d == null ? '–' : (d > 0 ? '+' : '') + d + ' ' + pijl(d, false)) + ' |');
  });
  const mm = Object.assign({}, MAAT, { bytes: 'Totale grootte (kB)' });
  Object.keys(mm).forEach((k) => {
    const a = oud.maten[k], b = nieuw.maten[k];
    if (a == null && b == null) return;
    const deel = k === 'bytes' ? 1024 : 1;
    const f = (v) => (v == null ? '–' : k === 'cumulative-layout-shift' ? v.toFixed(3) : Math.round(v / deel));
    const d = a == null || b == null ? null : (b - a) / deel;
    regels.push('| ' + mm[k] + ' | ' + f(a) + ' | ' + f(b) + ' | ' + (d == null ? '–' : (d > 0 ? '+' : '') + (k === 'cumulative-layout-shift' ? d.toFixed(3) : Math.round(d)) + ' ' + pijl(d, true)) + ' |');
  });
  const tekst = regels.join('\n');
  console.log(tekst);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, 'tabel<<EOF\n' + tekst + '\nEOF\n', { flag: 'a' });
  process.exit(0);
}

console.error('Gebruik: node tools/lh-score.mjs --lees <map>  of  --vergelijk <oud.json> <nieuw.json>');
process.exit(2);
