// Controle van de website zonder browser: syntaxis van alle scripts, en geen dubbele of botsende namen.
// De bestanden in docs/js/NN-*.js delen één bereik; een naam die twee keer voorkomt of al van de browser is, breekt de site.
// Draaien: node tools/check-site.mjs
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = new URL('../docs/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const js = join(root, 'js');
const files = readdirSync(js).filter((f) => f.endsWith('.js'));
const classic = files.filter((f) => /^\d\d-/.test(f)).sort();
const modules = files.filter((f) => !/^\d\d-/.test(f));
let errors = 0;
const fail = (msg) => { errors++; console.log('  FOUT ' + msg); };

// 1. Syntaxis: gewone scripts direct, modules als .mjs-kopie
const tmp = mkdtempSync(join(tmpdir(), 'tracker-check-'));
const check = (file, label) => { try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); } catch (e) { fail(label + ': ' + String(e.stderr || e.message).split('\n').slice(0, 4).join(' ')); } };
classic.forEach((f) => check(join(js, f), f));
check(join(root, 'sw.js'), 'sw.js');
check(join(root, 'config.js'), 'config.js');
modules.forEach((f) => { const p = join(tmp, f.replace(/\.js$/, '.mjs')); writeFileSync(p, readFileSync(join(js, f), 'utf8').replace(/from '\.\.\/vendor\/[^']+'/g, "from 'data:text/javascript,export const html=0,render=0,useState=0,useMemo=0,useEffect=0,useRef=0;'")); check(p, f); });
rmSync(tmp, { recursive: true, force: true });

// 2. Namen: elke naam op het hoogste niveau maar één keer, en niet van de browser
const BROWSER = new Set(('name status print open close stop find focus blur scroll scrollTo length top parent self origin event history location screen frames opener closed ' +
  'external alert confirm prompt fetch crypto performance navigator document window caches indexedDB localStorage sessionStorage Notification Image Audio Option ' +
  'URL Request Response Headers Event Map Set Date Math JSON Number String Array Object Promise Symbol Error RegExp Intl console setTimeout setInterval ' +
  'requestAnimationFrame matchMedia getComputedStyle atob btoa structuredClone queueMicrotask toolbar menubar statusbar personalbar scrollbars visualViewport').split(' '));
const seen = new Map();
classic.forEach((f) => {
  const src = readFileSync(join(js, f), 'utf8');
  for (const m of src.matchAll(/^(?:async function|function|const|let|class|var) ([A-Za-z_$][\w$]*)/gm)) {
    const n = m[1];
    if (seen.has(n)) fail('naam "' + n + '" staat in ' + seen.get(n) + ' en in ' + f);
    else seen.set(n, f);
    if (BROWSER.has(n)) fail('naam "' + n + '" in ' + f + ' botst met de browser');
  }
});

// 3. Elk script in index.html bestaat, en de cacheversie is overal gelijk
const index = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const vers = new Set([...index.matchAll(/\?v=(\d+)/g), ...sw.matchAll(/\?v=(\d+)/g)].map((m) => m[1]));
const cache = /tracker-v(\d+)/.exec(sw);
const ver = /const VERSION = 'v(\d+)'/.exec(readFileSync(join(js, '01-basis.js'), 'utf8'));
if (vers.size !== 1 || !cache || !vers.has(cache[1]) || !ver || ver[1] !== cache[1]) fail('cacheversie niet overal gelijk: ?v=' + [...vers].join('/') + ', CACHE ' + (cache && cache[1]) + ', VERSION ' + (ver && ver[1]));
for (const m of index.matchAll(/src="(js\/[^"?]+)/g)) if (!files.includes(m[1].slice(3))) fail('index.html laadt ' + m[1] + ', dat bestand bestaat niet');
files.forEach((f) => { if (!sw.includes('./js/' + f)) fail('js/' + f + ' staat niet in de cachelijst van sw.js'); });

console.log(errors ? errors + ' fouten' : 'Site in orde: ' + classic.length + ' scripts, ' + modules.length + ' modules, ' + seen.size + ' namen.');
process.exit(errors ? 1 : 0);
