// Typecontrole van de website met TypeScript (checkJs), zonder build-stap.
// De bestaande meldingen staan per bestand in tools/types-baseline.json; de controle faalt alleen als een bestand
// er meer krijgt dan daar staat. Zo komen er geen nieuwe typefouten bij en mag het aantal stap voor stap omlaag.
//   node tools/check-types.mjs            controleren
//   node tools/check-types.mjs --update   de basislijn bijwerken (na het oplossen van meldingen)
// TypeScript: de versie in TSC (pad naar tsc), anders via npx typescript@5.6.3.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const basePath = new URL('tools/types-baseline.json', root);
const cmd = process.env.TSC ? [process.env.TSC, ['-p', '.']] : ['npx', ['--yes', '-p', 'typescript@5.6.3', 'tsc', '-p', '.']];
const r = spawnSync(cmd[0], cmd[1], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
if (r.error) { console.error('TypeScript kon niet starten: ' + r.error.message); process.exit(2); }
const out = (r.stdout || '') + (r.stderr || '');
const errs = out.split(/\r?\n/).filter((l) => /error TS\d+/.test(l));
if (r.status !== 0 && !errs.length) { console.error(out.trim() || 'TypeScript stopte zonder uitleg.'); process.exit(2); }
const per = {};
errs.forEach((l) => { const f = l.replace(/\\/g, '/').match(/^(docs\/[^(]+)\(/); if (f) per[f[1]] = (per[f[1]] || 0) + 1; });

if (process.argv.includes('--update')) {
  writeFileSync(basePath, JSON.stringify(Object.fromEntries(Object.entries(per).sort()), null, 2) + '\n');
  console.log('Basislijn bijgewerkt: ' + errs.length + ' meldingen.');
  process.exit(0);
}
const base = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : {};
let bad = 0;
Object.entries(per).forEach(([f, n]) => {
  const b = base[f] || 0;
  if (n > b) {
    bad++;
    console.log('  FOUT ' + f + ': ' + n + ' typemeldingen, was ' + b + '. Nieuw:');
    errs.filter((l) => l.replace(/\\/g, '/').startsWith(f)).slice(0, 12).forEach((l) => console.log('       ' + l.trim()));
  }
});
const total = errs.length, baseTotal = Object.values(base).reduce((a, n) => a + n, 0);
if (bad) { console.log(bad + ' bestand(en) met nieuwe typemeldingen.'); process.exit(1); }
console.log('Types in orde: ' + total + ' bekende meldingen (basislijn ' + baseTotal + ')' + (total < baseTotal ? '; werk de basislijn bij met --update.' : '.'));
