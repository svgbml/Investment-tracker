// Controle van de meegeleverde bibliotheek (docs/vendor/): is het bestand nog hetzelfde, en is er iets
// bekend over de versie? De site laadt niets van een CDN, dus een bibliotheek blijft staan tot iemand hem
// bijwerkt. Dit script leest docs/vendor/versions.json, vergelijkt de vingerafdruk (SHA-256) en vraagt de
// waarschuwingsdienst van het npm-register of er voor deze versies iets bekend is.
//
// Draaien: node tools/check-vendor.mjs            (controleren)
//          node tools/check-vendor.mjs --update   (vingerafdruk opnieuw vastleggen na het bijwerken)
//
// Zonder internet slaat het script het vragen over en meldt dat; de vingerafdruk wordt altijd gecontroleerd.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const listPath = root + 'docs/vendor/versions.json';
const conf = JSON.parse(readFileSync(listPath, 'utf8'));
const update = process.argv.includes('--update');
let errors = 0;
const fail = (msg) => { errors++; console.log('  FOUT ' + msg); };

// 1. Vingerafdruk: is het bestand nog precies wat er is binnengehaald?
for (const v of conf.vendored) {
  // Windows-regeleinden (git met autocrlf) tellen niet mee, anders verschilt de vingerafdruk per computer
  const text = readFileSync(root + 'docs/vendor/' + v.file, 'utf8').replace(/\r\n/g, '\n');
  // De eerste regels zijn onze eigen uitleg boven het bestand; die tellen niet mee
  const body = text.split('\n').slice(v.skipLines || 0).join('\n');
  const sha = createHash('sha256').update(body).digest('hex');
  if (update) { v.sha256 = sha; console.log('  vastgelegd ' + v.file + ': ' + sha.slice(0, 16) + '…'); continue; }
  if (!v.sha256) fail(v.file + ' heeft nog geen vingerafdruk. Draai: node tools/check-vendor.mjs --update');
  else if (v.sha256 !== sha) fail(v.file + ' is gewijzigd (' + sha.slice(0, 16) + '… in plaats van ' + v.sha256.slice(0, 16) + '…). Klopt dat? Werk dan versions.json bij met --update.');
  else console.log('  ok  ' + v.file + ' (' + v.from + ')');
}
if (update) {
  writeFileSync(listPath, JSON.stringify(conf, null, 2) + '\n');
  process.exit(0);
}

// 2. Bekende kwetsbaarheden: dezelfde dienst die "npm audit" gebruikt
const want = {};
conf.vendored.forEach((v) => (v.check || []).forEach((c) => { want[c.name] = [...new Set((want[c.name] || []).concat(c.versions))]; }));
let advisories = null;
try {
  const res = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(want),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('status ' + res.status);
  advisories = await res.json();
} catch (e) {
  console.log('  (geen antwoord van het npm-register: ' + String(e.message || e) + '. Alleen de vingerafdruk is gecontroleerd.)');
}
if (advisories) {
  const names = Object.keys(advisories);
  if (!names.length) console.log('  ok  geen bekende kwetsbaarheden voor ' + Object.keys(want).join(', '));
  names.forEach((n) => (advisories[n] || []).forEach((a) => {
    fail(n + ': ' + a.title + ' (' + a.severity + ', geldt voor ' + a.vulnerable_versions + ') ' + a.url);
  }));
}

console.log(errors ? errors + ' fouten' : 'Meegeleverde bibliotheken in orde.');
process.exit(errors ? 1 : 0);
