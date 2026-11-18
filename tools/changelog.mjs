// Bouwt CHANGELOG.md uit de commitberichten van git.
// Elke commit is één regel die beschrijft wat er voor de gebruiker veranderde; veel regels noemen de versie
// ("(v57)" of "versie 52"). Commits zonder versie horen bij de eerstvolgende versie die daarna uitkwam.
// Draaien: node tools/changelog.mjs          (schrijft CHANGELOG.md)
//          node tools/changelog.mjs --stdout (alleen tonen)
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = [];
const log = execFileSync('git', ['log', '--no-merges', '--date=short', '--format=%H%x09%ad%x09%s'], { cwd: root, encoding: 'utf8' });

// Versie uit een commitbericht halen: "(v57)", "; versie 52", "versie 51"
function versionOf(subject) {
  const m = /\(v(\d+)\)\s*$/.exec(subject) || /\bversie\s+(\d+)\b/i.exec(subject) || /\bv(\d+)\b/.exec(subject);
  return m ? 'v' + m[1] : null;
}
// De versie uit de regel halen, zodat de regel zelf leesbaar blijft
function cleanSubject(subject) {
  return subject.replace(/\s*\(v\d+\)\s*$/, '').replace(/[;,]?\s*versie\s+\d+\s*$/i, '').trim();
}

const rows = log.trim().split('\n').filter(Boolean).map((line) => {
  const [hash, date, ...rest] = line.split('\t');
  const subject = rest.join('\t');
  return { hash, date, subject, version: versionOf(subject) };
});

// Van nieuw naar oud: een commit zonder versie hoort bij de laatst geziene (dus latere) versie
const groups = [];
let cur = null;
rows.forEach((r) => {
  const v = r.version || (cur ? cur.version : 'onbekend');
  if (!cur || cur.version !== v) { cur = { version: v, date: r.date, items: [] }; groups.push(cur); }
  cur.items.push(cleanSubject(r.subject) || r.subject);
  if (r.date < cur.date) cur.date = r.date;
});

out.push('# Wat er veranderde');
out.push('');
out.push('Per versie, in de woorden van de commits. Dit bestand wordt gemaakt met `node tools/changelog.mjs`; pas het niet met de hand aan.');
out.push('');
groups.forEach((g) => {
  out.push('## ' + g.version + ' — ' + g.date);
  out.push('');
  g.items.forEach((t) => out.push('- ' + t));
  out.push('');
});

const text = out.join('\n');
if (process.argv.includes('--stdout')) process.stdout.write(text);
else {
  writeFileSync(new URL('../CHANGELOG.md', import.meta.url), text);
  console.log('CHANGELOG.md bijgewerkt: ' + groups.length + ' versies, ' + rows.length + ' commits.');
}
