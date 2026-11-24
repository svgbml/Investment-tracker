// Stijlcontrole van de CSS met stylelint (.stylelintrc.json), maar alleen over wat je zelf veranderde:
// nieuwe bestanden helemaal, bestaande bestanden alleen de regels die in deze tak zijn gewijzigd.
// Zo komt er geen enkele melding over de duizend regels CSS die er al stonden, en wordt niets opnieuw opgemaakt.
//
// Draaien:
//   npm i --no-save stylelint
//   node tools/check-stijl.mjs                 vergelijk met origin/main (of main)
//   node tools/check-stijl.mjs --basis <ref>   vergelijk met een andere tak of commit
//   node tools/check-stijl.mjs --alles         het hele bestand nakijken (alleen om te kijken)
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Eerst als module (dat is de aanbevolen manier), anders via require (zo wordt een globale installatie ook gevonden)
let stylelint = null;
try { stylelint = (await import('stylelint')).default; } catch (e) {
  try { stylelint = require('stylelint'); } catch (e2) {
    console.error('stylelint ontbreekt. Installeer het eenmalig: npm i --no-save stylelint');
    process.exit(2);
  }
}
const root = fileURLToPath(new URL('..', import.meta.url));
const alles = process.argv.includes('--alles');
const basisArg = process.argv.indexOf('--basis') > 0 ? process.argv[process.argv.indexOf('--basis') + 1] : null;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

// Welke tak gebruiken we als vergelijking?
function basis() {
  if (basisArg) return basisArg;
  for (const ref of ['origin/main', 'main']) {
    try { git('rev-parse', '--verify', '--quiet', ref); return ref; } catch (e) { /* volgende */ }
  }
  return null;
}

// Gewijzigde regelnummers per bestand uit git diff (-U0 geeft alleen de regels zelf)
let diffGelukt = true;
function changedLines(ref) {
  const per = new Map();
  let diff = '';
  // Eerst vanaf de gemeenschappelijke voorouder (...); lukt dat niet, dan gewoon het verschil (..).
  // Bij een ondiepe kloon bestaat die voorouder niet; dan zeggen we dat er niet vergeleken kon worden.
  try { diff = git('diff', '-U0', ref + '...HEAD', '--', '*.css'); } catch (e) {
    try { diff = git('diff', '-U0', ref, 'HEAD', '--', '*.css'); } catch (e2) { diff = ''; diffGelukt = false; }
  }
  let extra = '';
  try { extra = git('diff', '-U0', '--', '*.css'); } catch (e) { extra = ''; }   // ook wat nog niet vastgelegd is
  let file = null;
  (diff + '\n' + extra).split('\n').forEach((line) => {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) { file = f[1]; if (!per.has(file)) per.set(file, new Set()); return; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) { const start = Number(h[1]), n = h[2] === undefined ? 1 : Number(h[2]); for (let i = 0; i < n; i++) per.get(file).add(start + i); }
  });
  return per;
}

const ref = basis();
let changed = alles || !ref ? null : changedLines(ref);
if (!alles && !ref) console.log('Geen main gevonden om mee te vergelijken; het hele bestand wordt nagekeken.');
if (!diffGelukt) {
  // Niet stilletjes "in orde" zeggen terwijl er niets is nagekeken
  console.log('LET OP: er kon niet met ' + ref + ' vergeleken worden (geen gemeenschappelijke geschiedenis; bij een ondiepe kloon: fetch-depth: 0).');
  console.log('        Er is daarom niets nagekeken. Lokaal: node tools/check-stijl.mjs --basis <tak>, of --alles voor het hele bestand.');
  process.exit(0);
}
const files = ['docs/style.css', 'docs/ontwerp.css'];
const res = await stylelint.lint({ files: files.map((f) => root + f), configFile: root + '.stylelintrc.json' });
let shown = 0, total = 0;
res.results.forEach((r) => {
  const rel = r.source.replace(root, '');
  const lines = changed ? changed.get(rel) : null;
  r.warnings.forEach((w) => {
    total++;
    if (changed && lines && !lines.has(w.line)) return;      // bestaande regel: niet van jou
    if (changed && !lines) return;                            // bestand niet gewijzigd
    shown++;
    console.log('  ' + (w.severity === 'error' ? 'FOUT' : 'let op') + ' ' + rel + ':' + w.line + ':' + w.column + ' ' + w.text);
    if (process.env.GITHUB_ACTIONS) console.log('::error file=' + rel + ',line=' + w.line + '::' + w.text);
  });
});
console.log(shown ? shown + ' melding(en) op gewijzigde regels (' + total + ' in het hele bestand).'
  : 'CSS in orde: geen meldingen op ' + (changed ? 'gewijzigde regels' : 'het hele bestand') + (total ? ' (' + total + ' bestaande meldingen elders, niet blokkerend).' : '.'));
process.exit(shown ? 1 : 0);
