// Bouwt de gepubliceerde site: een kopie van docs/ waarin
//  - de gewone scripts onderaan index.html samen één verkleind bestand zijn (js/app.js, met source map),
//  - de overige scripts (lui geladen, modules), style.css en ontwerp.css los verkleind zijn.
// De bron in docs/ blijft zoals hij is: zonder deze stap werkt de site precies zo, alleen groter.
// Gebruik: node tools/bouw-site.mjs [--uit _site]   (esbuild nodig: npm i --no-save esbuild@0.28.2)
import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';

const SRC = 'docs';
const OUT = process.argv.includes('--uit') ? process.argv[process.argv.indexOf('--uit') + 1] : '_site';
const rd = (f) => fs.readFileSync(path.join(OUT, f), 'utf8');
const wr = (f, s) => fs.writeFileSync(path.join(OUT, f), s);
const kb = (n) => Math.round(n / 1024) + ' kB';
// Niets lager zetten: de site draait alleen in moderne browsers, en zo blijft de code zoals hij was
const OPTS = { minify: true, target: 'esnext', charset: 'utf8', legalComments: 'none' };

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

// 1. De gewone scripts in <body> (niet 00-vroeg.js in <head>, die moet vóór het tekenen draaien), in hun volgorde
let html = rd('index.html');
const body = html.indexOf('<body');
const tags = [...html.matchAll(/[ \t]*<script src="(js\/[^"?]+\.js)\?v=(\d+)"><\/script>[ \t]*\r?\n?/g)].filter((m) => m.index > body);
if (tags.length < 2) throw new Error('Geen scripts gevonden in index.html');
const ver = tags[0][2];
let code = '', lines = 0, before = 0;
const sections = [];
for (const m of tags) {
  const file = m[1], src = rd(file);
  // Samen in één bestand geldt 'use strict' van het eerste bestand voor alles: dan moet elk bestand al strict zijn
  if (!/^\s*(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*'use strict'/.test(src)) throw new Error(file + " begint niet met 'use strict'");
  const r = await transform(src, { ...OPTS, loader: 'js', sourcemap: 'external', sourcefile: file });
  sections.push({ offset: { line: lines, column: 0 }, map: JSON.parse(r.map) });
  code += r.code;
  lines += r.code.split('\n').length - 1;
  before += src.length;
  fs.rmSync(path.join(OUT, file));
}
wr('js/app.js', code + '//# sourceMappingURL=app.js.map\n');
wr('js/app.js.map', JSON.stringify({ version: 3, file: 'app.js', sections }));
html = html.replace(tags[0][0], '  <script src="js/app.js?v=' + ver + '"></script>\n');
tags.slice(1).forEach((m) => { html = html.replace(m[0], ''); });
wr('index.html', html);
console.log(tags.length + ' scripts → js/app.js: ' + kb(before) + ' → ' + kb(code.length));

// 2. De service worker bewaart nu js/app.js in plaats van de losse bestanden
let sw = rd('sw.js');
tags.forEach((m) => { sw = sw.replace(new RegExp("'\\./" + m[1].replace(/[.]/g, '\\.') + '\\?v=' + ver + "',[ \\t]*"), ''); });
if (tags.some((m) => sw.includes("'./" + m[1] + '?v='))) throw new Error('sw.js noemt nog een samengevoegd script');
sw = sw.replace("'./config.js?v=" + ver + "', ", "'./config.js?v=" + ver + "', './js/app.js?v=" + ver + "', ");
if (!sw.includes("'./js/app.js?v=" + ver + "'")) throw new Error('js/app.js niet in de lijst van sw.js gezet');
wr('sw.js', sw);

// 3. De rest los verkleinen: lui geladen scripts, modules en de stylesheet
const rest = fs.readdirSync(path.join(OUT, 'js')).filter((f) => f.endsWith('.js') && f !== 'app.js').map((f) => 'js/' + f).concat(['config.js']);
let a = 0, b = 0;
for (const file of rest) {
  const src = rd(file);
  const module = /^\s*import\s|^export\s/m.test(src);
  const r = await transform(src, { ...OPTS, loader: 'js', format: module ? 'esm' : undefined });
  wr(file, r.code);
  a += src.length; b += r.code.length;
}
let c0 = 0, c1 = 0;
for (const file of ['style.css', 'ontwerp.css']) {
  const css = rd(file);
  const rc = await transform(css, { ...OPTS, loader: 'css' });
  wr(file, rc.code);
  c0 += css.length; c1 += rc.code.length;
}
console.log(rest.length + ' losse scripts: ' + kb(a) + ' → ' + kb(b) + '; style.css en ontwerp.css: ' + kb(c0) + ' → ' + kb(c1));
