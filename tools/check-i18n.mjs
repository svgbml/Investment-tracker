// Vertaalcontrole: welke Nederlandse koppen en knopteksten nog niet in EN staan (docs/js/13-app.js).
// De site is Nederlands; EN (en daarop DE en FR) vertaalt de tekst in de pagina. Een kop die niet in EN staat,
// blijft bij Engels, Duits of Frans in het Nederlands staan. Dit script zoekt die gevallen op.
//
// Draaien:
//   node tools/check-i18n.mjs            lijst met wat ontbreekt (stopt altijd met 0: het is een waarschuwing)
//   node tools/check-i18n.mjs --strict    stopt met 1 als er iets ontbreekt (niet gebruikt in CI)
//   node tools/check-i18n.mjs --json      dezelfde lijst als JSON
//
// Het zoekt in docs/index.html en docs/js/*.js naar tekst in <h1>…<h4>, <button>, .btn en tabkoppen,
// en in index.html ook naar aria-label en placeholder. Teksten met ${…} of + erin worden overgeslagen:
// die zijn samengesteld en horen bij EN_RE (de patronen).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../docs/', import.meta.url));
const jsDir = join(root, 'js');
const strict = process.argv.includes('--strict');
const asJson = process.argv.includes('--json');

// ---------- EN en EN_RE uit 13-app.js halen ----------
// De blokken zijn letterlijke objecten en lijsten; die lezen we uit de tekst en voeren we los uit.
function blockAt(src, startIdx, open, close) {
  let depth = 0, quote = null;
  for (let i = startIdx; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (!depth) return src.slice(startIdx, i + 1); }
  }
  return null;
}
function readDict() {
  // EN staat in 13-app.js; een enkel bestand vult hem later aan met Object.assign(EN, { … }),
  // dus we lezen alle scripts.
  const src = readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort().map((f) => readFileSync(join(jsDir, f), 'utf8')).join('\n');
  const keys = new Set();
  const regexes = [];
  const starts = [];
  for (const m of src.matchAll(/const EN = \{/g)) starts.push(m.index + m[0].length - 1);
  for (const m of src.matchAll(/Object\.assign\(EN, \{/g)) starts.push(m.index + m[0].length - 1);
  starts.forEach((i) => {
    const text = blockAt(src, i, '{', '}');
    if (!text) return;
    let obj = null;
    try { obj = new Function('return (' + text + ')')(); } catch (e) { return; }
    Object.keys(obj).forEach((k) => keys.add(k));
  });
  const lists = [];
  for (const m of src.matchAll(/const EN_RE = \[/g)) {
    const t = blockAt(src, m.index + m[0].length - 1, '[', ']');
    if (t) lists.push(t);
  }
  for (const m of src.matchAll(/EN_RE\.push\(/g)) {
    const t = blockAt(src, m.index + m[0].length - 1, '(', ')');
    if (t) lists.push('[' + t.slice(1, -1) + ']');
  }
  lists.forEach((text) => {
    let arr = null;
    try { arr = new Function('return (' + text + ')')(); } catch (e) { return; }
    (Array.isArray(arr) ? arr : []).forEach((p) => { if (Array.isArray(p) && p[0] instanceof RegExp) regexes.push(p[0]); });
  });
  return { keys, regexes };
}

// ---------- Teksten uit de site halen ----------
const SKIP_RE = [
  /[${]/, /\+/, /^[\s\d.,:%€$–—·•…|/\\()[\]{}<>+-]*$/, /^[A-Z0-9][A-Z0-9.\-]{0,11}$/, // samengesteld, alleen cijfers/tekens, of een ticker
  /^(ok|OK|nl|en|de|fr|NL|EN|DE|FR)$/,
  /^#[0-9A-Fa-f]{3,8}$/,                    // kleuren uit een lijst met paren
  /:\/\/|^www\.|\.(com|nl|org|dev)\b/,      // adressen
  /^(English|Deutsch|Fran\u00e7ais|Nederlands)$/, // taalnamen blijven in hun eigen taal
];
const clean = (s) => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const interesting = (s) => s.length >= 2 && s.length <= 90 && /[a-zA-Z]/.test(s) && !SKIP_RE.some((re) => re.test(s));

function textsIn(src, file) {
  const out = [];
  const add = (raw, kind) => { const s = clean(raw); if (interesting(s)) out.push({ text: s, file, kind }); };
  // Koppen en knoppen, met alleen platte tekst ertussen
  for (const m of src.matchAll(/<(h[1-4])\b[^>]*>([^<>]+)<\/\1>/g)) add(m[2], m[1]);
  for (const m of src.matchAll(/<button\b[^>]*>([^<>]+)<\/button>/g)) add(m[1], 'knop');
  // Knoppen met een pictogram ervoor: alleen de tekst in de laatste <span>
  for (const m of src.matchAll(/<button\b[^>]*>(?:[^]*?)<span[^>]*>([^<>]+)<\/span>\s*<\/button>/g)) add(m[1], 'knop');
  // Tabs en segmenten in de site worden uit lijsten gebouwd: ['sleutel', 'Label']
  for (const m of src.matchAll(/\[\s*'[a-z0-9_-]{1,20}'\s*,\s*'([^']{2,60})'\s*\]/g)) add(m[1], 'label');
  if (/\.html$/.test(file)) {
    for (const m of src.matchAll(/(?:aria-label|placeholder|title)="([^"]{2,80})"/g)) add(m[1], 'attribuut');
  }
  return out;
}

const { keys, regexes } = readDict();
const covered = (s) => keys.has(s) || regexes.some((re) => re.test(s));

const files = [['index.html', readFileSync(join(root, 'index.html'), 'utf8')]]
  .concat(readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort().map((f) => ['js/' + f, readFileSync(join(jsDir, f), 'utf8')]));

const missing = new Map();
files.forEach(([file, src]) => {
  textsIn(src, file).forEach((t) => {
    if (covered(t.text)) return;
    const o = missing.get(t.text) || { text: t.text, kind: t.kind, files: new Set() };
    o.files.add(t.file);
    missing.set(t.text, o);
  });
});
const list = [...missing.values()].map((o) => ({ text: o.text, kind: o.kind, files: [...o.files] })).sort((a, b) => a.text.localeCompare(b.text));

if (asJson) { console.log(JSON.stringify(list, null, 2)); process.exit(0); }
console.log('Vertaalcontrole: ' + keys.size + ' teksten in EN, ' + regexes.length + ' patronen.');
if (!list.length) { console.log('Alle gevonden koppen en knoppen staan in EN.'); process.exit(0); }
console.log(list.length + ' tekst(en) zonder Engelse vertaling (voeg ze toe aan EN in docs/js/13-app.js):');
list.forEach((o) => {
  console.log('  ' + o.kind.padEnd(9) + ' "' + o.text + '"  (' + o.files.join(', ') + ')');
  // In GitHub Actions ook als waarschuwing bij de bestanden
  if (process.env.GITHUB_ACTIONS) console.log('::warning file=docs/' + o.files[0] + '::Geen Engelse vertaling voor "' + o.text.replace(/[\r\n]/g, ' ') + '"');
});
process.exit(strict ? 1 : 0);
