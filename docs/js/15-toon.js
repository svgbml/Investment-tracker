/* Investeringstracker – Toon van een nieuwsbericht: positief, negatief of neutraal
 *
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html).
 * Dit bestand staat op zichzelf: het gebruikt geen andere functies van de site, zodat de schatting ook los te
 * controleren is (node tools/check-toon.mjs).
 *
 * Hoe het werkt: twee kleine woordenlijsten met gewichten (1 = zwak, 3 = sterk) in het Engels en Nederlands.
 * Woorden die alleen een onderwerp noemen ("winst", "dividend", "omzet") staan er niet in: "winst daalt" moet
 * negatief zijn, niet neutraal.
 * Een woord dat wordt ontkend door "niet", "geen", "no", "fails" en dergelijke telt omgekeerd en halve kracht
 * ("not strong" is dus licht negatief, "geen groei" ook). Woordcombinaties ("onder druk", "beats estimates")
 * tellen als één geheel, zodat de losse woorden erin niet nog eens meetellen.
 *
 * Dit is een schatting uit de woorden in de kop en samenvatting, geen oordeel van de bron.
 */
'use strict';

// Hele woorden die positief wegen (gewicht 1 tot 3)
const TONE_POS = {
  // Engels
  beat: 2, beats: 2, beating: 2, surge: 3, surges: 3, surged: 3, soar: 3, soars: 3, soared: 3, jump: 2, jumps: 2, jumped: 2,
  rally: 2, rallies: 2, rallied: 2, gain: 1, gains: 1, gained: 1, rise: 1, rises: 1, rose: 1, climb: 1, climbs: 1, climbed: 1,
  record: 2, upgrade: 3, upgrades: 3, upgraded: 3, outperform: 2, outperforms: 2, strong: 2, stronger: 2, strength: 1,
  growth: 2, grows: 1, profitable: 2, tops: 2, topped: 2, raises: 2, raised: 1, boost: 2, boosts: 2,
  bullish: 3, approval: 2, approved: 2, approves: 2, win: 1, wins: 2, won: 1, expands: 1, expansion: 1, buyback: 2,
  optimistic: 2, rebound: 2, rebounds: 2, recovery: 2, breakthrough: 3,
  // Nederlands
  positief: 2, herstel: 2, hersteld: 2, overtreft: 2, overtrof: 2, doorbraak: 3, goedkeuring: 2, goedgekeurd: 2,
  meevaller: 2, winstgevend: 2, hoger: 1, beter: 1, sterkste: 2, kooptip: 2, omhoog: 2, vooruitzichten: 1,
};

// Hele woorden die negatief wegen
const TONE_NEG = {
  // Engels
  miss: 2, misses: 2, missed: 2, plunge: 3, plunges: 3, plunged: 3, sink: 2, sinks: 2, sank: 2, tumble: 3, tumbles: 3, tumbled: 3,
  drop: 2, drops: 2, dropped: 2, fall: 2, falls: 2, fell: 2, slump: 3, slumps: 3, slumped: 3, slide: 2, slides: 2,
  loss: 2, losses: 2, downgrade: 3, downgrades: 3, downgraded: 3, cut: 2, cuts: 2, slash: 3, slashes: 3, slashed: 3,
  weak: 2, weaker: 2, weakness: 2, warn: 3, warns: 3, warned: 3, warning: 2, lawsuit: 2, sues: 2, sued: 2, probe: 2,
  investigation: 2, scrutiny: 1, recall: 2, layoff: 3, layoffs: 3, bearish: 3, fraud: 3, decline: 2, declines: 2, declined: 2,
  crash: 3, crashes: 3, halt: 2, halts: 2, delay: 2, delays: 2, delayed: 2, resigns: 2, resigned: 2, bankruptcy: 3,
  shortfall: 2, concerns: 1, risks: 1, selloff: 3, tariff: 2, tariffs: 2, outage: 2, fined: 2, breach: 2,
  // Nederlands
  negatief: 2, ontslagen: 3, rechtszaak: 2, tekort: 2, boete: 2, miljoenenboete: 3, fraude: 3, terugroepactie: 2,
  uitstel: 2, schrapt: 2, geschrapt: 2, winstwaarschuwing: 3, lager: 1, slechter: 1, zwakste: 2, misser: 2, omlaag: 2,
  verkooptip: 2, staking: 1, storing: 2, afboeking: 2, tegenvaller: 2, teleurstellend: 3, faillissement: 3,
};

// Woordbegin, voor Nederlandse vervoegingen en samenstellingen (stijgt, stijging, stijgende, ...)
/** @type {[string, number][]} */
const TONE_STEMS = [
  ['stijg', 2], ['steeg', 2], ['groei', 2], ['sterk', 2], ['verhoog', 2], ['verhog', 2], ['opwaarder', 3], ['uitbrei', 1],
  ['winstsprong', 3], ['topresultaat', 3],
  ['daal', -2], ['daling', -2], ['dalend', -2], ['daalde', -2], ['verlies', -2], ['verliez', -2], ['zwak', -2],
  ['verlaag', -2], ['verlag', -2], ['afwaarder', -3], ['ontslag', -3], ['waarschuw', -3], ['terugroep', -2],
  ['teleurstel', -3], ['afschrijv', -2], ['koersval', -3], ['winstdaling', -3],
];

// Woordcombinaties: tellen als één geheel (de losse woorden erin tellen dan niet meer mee)
/** @type {[string, number][]} */
const TONE_PHRASES = [
  ['beats estimates', 3], ['beat estimates', 3], ['better than expected', 3], ['raises guidance', 3], ['raised guidance', 3],
  ['record high', 3], ['all time high', 2], ['buy rating', 2], ['price target raised', 3], ['strong demand', 2],
  ['misses estimates', -3], ['missed estimates', -3], ['worse than expected', -3], ['lower than expected', -2],
  ['profit warning', -3], ['cuts guidance', -3], ['cut guidance', -3], ['sell rating', -2], ['price target cut', -3],
  ['short seller', -2], ['class action', -2], ['record low', -2],
  ['beter dan verwacht', 3], ['boven verwachting', 2], ['verhoogt verwachting', 3], ['verhoogt koersdoel', 3],
  ['in de lift', 2], ['meer winst', 2],
  ['slechter dan verwacht', -3], ['onder verwachting', -2], ['verlaagt verwachting', -3], ['verlaagt koersdoel', -3],
  ['onder druk', -2], ['onderzoek naar', -2], ['in het rood', -3], ['rode cijfers', -3], ['minder winst', -2],
];

// Ontkenningen: een van deze woorden tot drie woorden eerder draait het gewicht om en halveert het
const TONE_NEGATORS = new Set(['not', 'no', 'never', 'without', 'neither', 'nor', 'hardly', 'barely', 'fails', 'failed', 'fail',
  'geen', 'niet', 'nauwelijks', 'zonder', 'noch', 'nergens', 'mislukt']);

const TONE_MIN = 1;            // vanaf dit gewicht heet een bericht positief of negatief
const TONE_LEX = new Map();
Object.keys(TONE_POS).forEach((w) => TONE_LEX.set(w, Math.abs(TONE_POS[w])));
Object.keys(TONE_NEG).forEach((w) => TONE_LEX.set(w, -Math.abs(TONE_NEG[w])));
const toneCache = new WeakMap();

// Kop en samenvatting in losse woorden, zonder accenten en leestekens
function toneTokens(txt) {
  return String(txt == null ? '' : txt).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) || [];
}

const toneNegated = (toks, i) => {
  for (let k = Math.max(0, i - 3); k < i; k++) if (TONE_NEGATORS.has(toks[k])) return true;
  return false;
};

// Gewicht van één woord: eerst de woordenlijst, dan het woordbegin
function toneWeight(w) {
  if (TONE_LEX.has(w)) return TONE_LEX.get(w);
  for (const [stem, v] of TONE_STEMS) if (w.length >= stem.length && w.startsWith(stem)) return v;
  return 0;
}

/**
 * Toon van een bericht, met de woorden die dat bepaalden.
 * @param {{headline?: string, summary?: string}} n
 * @returns {{tone: string, score: number, hits: {w: string, v: number}[]}}
 */
function newsToneInfo(n) {
  if (n && typeof n === 'object') { const c = toneCache.get(n); if (c) return c; }
  const toks = toneTokens((n && n.headline ? n.headline : '') + ' ' + (n && n.summary ? n.summary : ''));
  const used = new Array(toks.length).fill(false);
  const hits = [];
  let score = 0;
  const add = (w, v) => { score += v; hits.push({ w, v: Math.round(v * 10) / 10 }); };
  // Eerst de combinaties, zodat "onder druk" niet ook nog als losse woorden telt
  for (let i = 0; i < toks.length; i++) {
    for (const [p, v] of TONE_PHRASES) {
      const pw = p.split(' ');
      if (i + pw.length > toks.length) continue;
      let ok = true;
      for (let k = 0; k < pw.length; k++) if (toks[i + k] !== pw[k] || used[i + k]) { ok = false; break; }
      if (!ok) continue;
      for (let k = 0; k < pw.length; k++) used[i + k] = true;
      add(p, toneNegated(toks, i) ? -v / 2 : v);
      break;
    }
  }
  toks.forEach((w, i) => {
    if (used[i]) return;
    const v = toneWeight(w);
    if (!v) return;
    add(w, toneNegated(toks, i) ? -v / 2 : v);
  });
  const out = { tone: score >= TONE_MIN ? 'pos' : score <= -TONE_MIN ? 'neg' : 'neu', score: Math.round(score * 10) / 10, hits };
  if (n && typeof n === 'object') toneCache.set(n, out);
  return out;
}

const newsTone = (n) => newsToneInfo(n).tone;

// Uitleg bij het ▲/▼-label: welke woorden de toon bepaalden
function toneTitle(n) {
  const info = newsToneInfo(n);
  const pos = [...new Set(info.hits.filter((h) => h.v > 0).map((h) => h.w))].slice(0, 6);
  const neg = [...new Set(info.hits.filter((h) => h.v < 0).map((h) => h.w))].slice(0, 6);
  const tail = 'Schatting uit de woorden in kop en samenvatting, geen oordeel van de bron.';
  if (!pos.length && !neg.length) return 'Geen woorden gevonden die iets over de toon zeggen. ' + tail;
  const parts = [];
  if (pos.length) parts.push('positief door: ' + pos.join(', '));
  if (neg.length) parts.push('negatief door: ' + neg.join(', '));
  return parts.join(' · ') + '. ' + tail;
}
