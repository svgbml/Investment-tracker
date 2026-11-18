// Zoekt code die nergens meer gebruikt wordt: namen op het hoogste niveau in docs/js/*.js en in
// worker/src/index.js waar geen enkel ander bestand (en index.html, sw.js, de tests) naar verwijst.
//
// Het is een hulpmiddel, geen bewijs: een naam kan ook via window[...] of uit HTML worden aangeroepen.
// Lees het resultaat dus na voordat je iets weghaalt. Het script stopt altijd met 0.
//
// Draaien: node tools/check-dood.mjs
//          node tools/check-dood.mjs --worker   ook de Worker nakijken
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const jsDir = join(root, 'docs/js');
const withWorker = process.argv.includes('--worker');

const siteFiles = readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort().map((f) => ['docs/js/' + f, readFileSync(join(jsDir, f), 'utf8')]);
const extra = [
  ['docs/index.html', readFileSync(join(root, 'docs/index.html'), 'utf8')],
  ['docs/sw.js', readFileSync(join(root, 'docs/sw.js'), 'utf8')],
  ['docs/config.js', readFileSync(join(root, 'docs/config.js'), 'utf8')],
];
const toolFiles = readdirSync(join(root, 'tools')).filter((f) => f.endsWith('.mjs')).map((f) => ['tools/' + f, readFileSync(join(root, 'tools', f), 'utf8')]);
const workerFiles = [['worker/src/index.js', readFileSync(join(root, 'worker/src/index.js'), 'utf8')], ['worker/test/run.mjs', readFileSync(join(root, 'worker/test/run.mjs'), 'utf8')]];

// Namen op het hoogste niveau (zelfde patroon als tools/check-site.mjs)
const DECL = /^(?:async function|function|const|let|class|var) ([A-Za-z_$][\w$]*)/gm;
function declarations(files) {
  const out = [];
  files.forEach(([file, src]) => { for (const m of src.matchAll(DECL)) out.push({ naam: m[1], file }); });
  return out;
}
// Hoe vaak komt de naam voor als woord, buiten de eigen regel met de verklaring?
function uses(naam, files, eigen) {
  const re = new RegExp('(?<![\\w$.])' + naam.replace(/[$]/g, '\\$') + '(?![\\w$])', 'g');
  let n = 0;
  files.forEach(([file, src]) => {
    src.split('\n').forEach((line) => {
      const decl = new RegExp('^(?:async function|function|const|let|class|var) ' + naam.replace(/[$]/g, '\\$') + '(?![\\w$])');
      if (file === eigen && decl.test(line)) return;
      n += (line.match(re) || []).length;
    });
  });
  return n;
}

function report(titel, declFiles, zoekIn) {
  const decls = declarations(declFiles);
  const dood = decls.filter((d) => uses(d.naam, zoekIn, d.file) === 0).sort((a, b) => a.file.localeCompare(b.file) || a.naam.localeCompare(b.naam));
  console.log(titel + ': ' + decls.length + ' namen, ' + dood.length + ' zonder verwijzing.');
  const per = new Map();
  dood.forEach((d) => { const a = per.get(d.file) || []; a.push(d.naam); per.set(d.file, a); });
  [...per.entries()].forEach(([f, namen]) => console.log('  ' + f + ': ' + namen.join(', ')));
  return dood;
}

report('Website', siteFiles, siteFiles.concat(extra, toolFiles));
if (withWorker) report('Worker', [workerFiles[0]], workerFiles);
console.log('Let op: namen die alleen via window[...] of uit HTML worden aangeroepen, lijken hier dood.');
