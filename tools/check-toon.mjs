// Controle van de toonschatting in docs/js/15-toon.js (positief, negatief, neutraal).
// Het bestand staat op zichzelf, dus het wordt hier ingelezen en in een eigen bereik uitgevoerd.
// Draaien: node tools/check-toon.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../docs/js/15-toon.js', import.meta.url)), 'utf8');
// eslint-disable-next-line no-new-func
const { newsTone, newsToneInfo, toneTitle } = new Function(src + '\nreturn { newsTone, newsToneInfo, toneTitle };')();

let failed = 0, passed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed++; return; }
  failed++;
  console.log('  FOUT ' + name + (extra ? ': ' + extra : ''));
};
const tone = (headline, summary) => newsTone({ headline, summary });
const is = (headline, want, summary) => {
  const got = tone(headline, summary);
  check('"' + headline + '" → ' + want, got === want, 'kreeg ' + got + ' (' + newsToneInfo({ headline, summary }).score + ')');
};

// Duidelijk positief en negatief, Engels en Nederlands
is('Apple beats estimates and raises guidance', 'pos');
is('Nvidia shares surge to record high', 'pos');
is('ASML stijgt na sterke cijfers', 'pos');
is('Analisten verhogen koersdoel van Shell', 'pos');
is('Tesla misses estimates, shares plunge', 'neg');
is('Boeing warns of weaker demand after recall', 'neg');
is('Koers van Philips daalt na winstwaarschuwing', 'neg');
is('Chipmakers staan onder druk', 'neg');

// Ontkenningen: het woord zelf is positief, de ontkenning draait het om
is('Demand is not strong, company says', 'neg');
is('Geen groei voor het concern dit kwartaal', 'neg');
is('Results were not weak', 'pos');
is('Bedrijf ziet geen verlies meer', 'pos');

// Neutraal: geen woorden uit de lijst, of positief en negatief in evenwicht
is('Apple houdt jaarvergadering in Cupertino', 'neu');
is('Company appoints new chief financial officer', 'neu');
is('Omzet stijgt, winst daalt', 'neu');
is('Winst daalt door afboeking', 'neg');

// Combinaties tellen één keer: "onder druk" niet ook als los woord, "record low" niet als positief "record"
check('"onder druk" telt als één geheel', newsToneInfo({ headline: 'Aandeel onder druk' }).hits.length === 1);
is('Oil hits record low', 'neg');

// De uitleg noemt de woorden die de toon bepaalden (voor het label op de nieuwspagina)
const t = toneTitle({ headline: 'Apple beats estimates and shares surge' });
check('uitleg noemt de woorden', /beats estimates/.test(t) && /surge/.test(t), t);
check('uitleg zonder woorden blijft leesbaar', /Geen woorden/.test(toneTitle({ headline: 'Jaarvergadering' })));

// Lege en rare invoer mag nooit een fout geven
['', null, undefined].forEach((h) => check('lege invoer', newsTone({ headline: h }) === 'neu'));
check('zonder object', newsTone(null) === 'neu');
check('samenvatting telt mee', tone('Kwartaalcijfers bekend', 'De winst daalt sterk door een afboeking') === 'neg');

console.log(failed ? failed + ' fouten (' + passed + ' goed)' : 'Toonschatting in orde: ' + passed + ' controles.');
process.exit(failed ? 1 : 0);
