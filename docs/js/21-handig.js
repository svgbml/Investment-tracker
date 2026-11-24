/* Investeringstracker – Handig: wat er nieuw is, ouderdom van gegevens, naar inhoud,
 * knoppen bij lege tegels, getallen kopiëren en de laatst bekeken pagina onthouden.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Wat er nieuw is (idee 2) ----------
// Korte lijst per versie, in gewone woorden. CHANGELOG.md in de map hierboven heeft het volledige verhaal
// (gemaakt met node tools/changelog.mjs); hieronder staat alleen wat de gebruiker merkt.
// Bij een nieuwe versie: zet de regels van die versie bovenaan, met VERSION uit js/01-basis.js als sleutel.
const WHATS_NEW = {
  v79: [
    'Nieuw uiterlijk, stap 6: Plannen begint met een geldagenda voor de komende vier maanden: je inlegdag, verwacht en aangekondigd dividend en de belastingdata. Met één knop zet je de komende twaalf maanden als .ics-bestand in je eigen agenda.',
    'Daarboven je kerncijfers (inleg, doelen, dividend en wat er te doen is) en daaronder zes hoofdstukken met een balk die blijft staan; Inleg en doelen en Vooruitblik openen met de kern in één zin en vier cijfers.',
  ],
  v78: [
    'Analyse: ook de hoofdstukken Doorkijk, Markt, Kopen en verkopen en Transacties openen nu met de kern in één zin, vier cijfers en een grafiek: de verdeling over sectoren, de S&P 500 van het laatste halfjaar en staafjes per maand.',
  ],
  v77: [
    'Nieuw uiterlijk, stap 5: Analyse als jaarrapport. Bovenaan je kerncijfers in één strook en een balk met de vijf hoofdstukken die blijft staan terwijl je scrolt, met een streep die laat zien hoe ver je bent.',
    'Elk hoofdstuk opent met een groot nummer; Rendement begint met de kern in één zin, vier cijfers en een grafiek van jou tegenover je maatstaf. De onderdelen hebben links hun titel. Op de telefoon dragen de tabbladen hun nummer.',
  ],
  v76: [
    'Nieuw uiterlijk, stap 4: Nieuws als ochtendkrant. Bovenaan de stemming, een strook met kerncijfers en het belangrijkste bericht met de koers van dat aandeel en de berichten als stipjes erop.',
    'Ernaast wat je hebt gemist, daaronder officieel nieuws, geruchten, marktnieuws en kwartaalcijfers in vier kolommen. Alle berichten, de stemmingskaart, analisten en insiders staan in secties met de titel links.',
  ],
  v75: [
    'Nieuw uiterlijk, stap 3: Bedrijven. Bovenaan je kerncijfers in één strook en een verdeling in je eigen accentkleur; daaronder je posities per sector met ernaast het gekozen bedrijf: grafiek, berichten, analisten en knoppen naar de bedrijfspagina, een koersalarm en vergelijken.',
    'De bedrijfspagina heeft een nieuwe kop met de koers per aandeel en je positie, een grote grafiek met een knoppenbalk eronder, en onderdelen met links hun titel. Op de telefoon staat een terugpijl in de kop.',
    'De snelle modus vult nu het hele scherm: kaarsen van 30 seconden tot 15 minuten met het aantal trades per kaars, en ernaast je positie, de laatste trades en het laatste nieuws. Sluiten kan ook met Escape.',
  ],
  v74: [
    'Nieuw uiterlijk, stap 2: Overzicht. De grote waarde staat nu over een grafiek die de hele breedte vult, met speldjes voor het hoogste punt, stortingen en je eigen aan- en verkopen (op de computer).',
    'Onder de grafiek een strook met je kerncijfers. Elke sectie heeft links haar titel en rechts de inhoud; meldingen staan op één vaste plek en stijgers en dalers staan als twee lijstjes onder Vandaag.',
    'Secties schuiven zacht in beeld tijdens het scrollen, behalve als je minder beweging hebt gekozen.',
  ],
  v73: [
    'Nieuw uiterlijk, stap 1: elke pagina is één rustig geheel met dunne lijnen in plaats van losse tegels, met een nieuwe kop en menu op de computer en een nieuwe tabbalk op de telefoon.',
    'Vier thema\'s: licht, donker, amoled (zwart) en automatisch, en een accentkleur naar keuze bij Instellingen, Weergave.',
    'Tegels klappen niet meer in: je ziet meteen alles. Grafieken op de telefoon tonen alleen de lijn, zonder speldjes.',
  ],
  v69: [
    'De Worker meet op werkdagen nu de hele dag elke 10 minuten, ook in de nacht en vroeg in de ochtend. Orders en marktgegevens haalt hij nog steeds buiten de handelsuren op.',
    'Het grote bedrag toont de accountwaarde met het vrije saldo erbij, net als Trading 212.',
  ],
  v68: [
    'De site start sneller en reageert eerder op tikken en scrollen: pagina\'s die je niet ziet, worden pas getekend als je ze opent, en Start wordt in stukken getekend.',
    'Analyse op de telefoon tekent alleen het tabblad dat open staat; het rapport (pdf) bevat nog steeds alle onderdelen.',
    'Tegels opvouwen kost minder rekenwerk, en de extra onderdelen van Plannen laden pas als je Plannen opent.',
    'Lange lijsten, zoals het aankoopdagboek en de economische agenda, tonen eerst een deel met een knop Meer tonen.',
  ],
  v67: [
    'Nieuwe gratis reserves bij Koppelingen: Tiingo en Polygon (Massive) voor koersgeschiedenis, Polygon en Marketaux voor nieuws.',
    'Met een SEC-e-mailadres komen de winst per aandeel per kwartaal en insiderhandel (Form 4) rechtstreeks van de SEC; FMP vult analisten en koersdoel aan.',
    'OpenFIGI zoekt per ISIN op op welke beurzen een effect noteert; Amerikaanse bronnen worden alleen nog gevraagd naar effecten die in de VS noteren. De bedrijfspagina toont de noteringen.',
    'GDELT is een nieuwe reserve voor nieuws, zonder sleutel. Beide staan aan en zijn bij Koppelingen uit te zetten.',
    'De Worker leest elk uur minder uit zijn database: het opruimen van oude metingen laat de dagen van eerdere jaren nu met rust.',
    'Alpha Vantage is nu de laatste reserve en vult alleen aan wat de andere bronnen niet leveren, zodat zijn 25 verzoeken per dag langer meegaan.',
  ],
  v64: [
    'Spaarstand: raakt de database van je Worker 85% van zijn gratis daglimiet, dan blijft hij meten maar ververst hij minder vaak tot middernacht (UTC). Bij 70% krijg je een melding.',
    'Als er niets nieuws is, leest de Worker nu één rij in plaats van het hele overzicht.',
    'De Worker bewaart wat zelden verandert en leest elke 10 minuten alleen de nieuwste metingen: met een jaar aan gegevens ongeveer 8% van de daglimiet.',
    'Instellingen > Koppelingen: het databasegebruik van de laatste 14 dagen, met hoe lang het bij deze groei duurt tot de limiet.',
    'Op de achtergrond ververst de tracker niet meer; zodra je hem weer opent wel. Meldingen komen gewoon door.',
    'Uurgegevens worden na 60 dagen opgeruimd (ze staan dan al in de dagtabel).',
    'Grote gegevens staan in stukken in de database, zodat ook na jaren gebruik niets te groot wordt om op te slaan. Je orders worden alleen opnieuw gelezen als er nieuwe zijn.',
  ],
  v63: [
    'De Worker leest veel minder uit zijn database, zodat de gratis daglimiet van Cloudflare niet meer opraakt.',
    'Instellingen > Koppelingen: bij elke bron zie je hoe dicht hij bij zijn limiet zit, en voor je Worker en database hoeveel van de gratis daglimiet er gebruikt is.',
    'Raakt de database toch zijn daglimiet, dan zegt de melding dat duidelijk en hoe laat het weer werkt.',
    'Reserves per functie: zit een bron aan zijn limiet, dan neemt een andere het over (ook voor vergelijkbare bedrijven, koersalarmen en zoeken). Bij Koppelingen zie je per functie welke bron nu werkt.',
  ],
  v60: [
    'Grafieken: wijs een punt aan en je ziet weer het tijdstip van de meting en de waarde.',
    'Maatstaf en Netto gestort bij de grote grafiek schakelen zelf naar 30 dagen; korter heeft die vergelijking geen zin.',
    'Het kaartje "Wat is er nieuw" verschijnt weer na een update.',
  ],
  v59: [
    'Overzicht: de samenvatting van vandaag staat in vier blokken over de hele breedte (verandering, grootste stijger en daler, nieuws); de kleine strook met stijgers en dalers is weg.',
    'Telefoon: een bedrijfspagina valt niet meer deels buiten beeld.',
    'De knop Tabel bij grafieken is weer een klein knopje en ligt niet meer op de lijn.',
    'Brede schermen: rijen met één of twee tegels vullen de hele breedte.',
  ],
  v58: [
    'Overzicht: kies de periode van de grote grafiek, vergelijk met een maatstaf, zie de stijgers en dalers van vandaag, mijlpalen en een rustige modus.',
    'Bedrijven en volglijst: indelen per sector, land of munt, elke aankoop apart, een dagboek en eigen koersdoel per aandeel, labels en een lijst importeren.',
    'Nieuws en analisten: berichten van meer bronnen gebundeld, betere toonschatting, analisten door de tijd, het cijferseizoen en "wat heb ik gemist".',
    'Risico en Analyse: wat als-schuiven, stresstests, valuta, fondsoverlap, doorkijk, rollend rendement, herstel na dalingen en een rapport om af te drukken.',
    'Plannen: twee plannen vergelijken, bedragen na inflatie, gebeurtenissen, dividendkalender, box 3 per jaar, spaargeld en netto vermogen.',
    'Kopen en verkopen: wat een order met je portefeuille doet, extra bevestiging bij grote orders, een oefenmodus en een beslisdagboek.',
    'Instellingen: zoeken, stille uren en een dagbundel voor meldingen, deel-links met einddatum, uitloggen op alle apparaten en een logboek.',
    'Sneller en toegankelijker: de beginpagina staat er meteen, alles werkt met het toetsenbord, grafieken ook als tabel, en een eenvoudige-taalmodus.',
    'Een kaartje als dit bij een nieuwe versie, labels bij oude gegevens, knoppen bij lege tegels en vastgezette tabelkoppen.',
  ],
  v57: ['Nieuws: wat analisten vinden per sector en door de tijd.'],
  v56: ['Animaties hersteld bij het wisselen van pagina, en op de risicopagina suggesties die je spreiding verbreden.'],
  v55: ['Kopen en verkopen: je vrije saldo, het risico van het aandeel en wat analisten ervan vinden in het orderscherm.'],
  v54: ['Computer: menu en knoppen in één balk, en de site gebruikt de volle breedte van je scherm.'],
};
const LS_SEEN_VER = 'tracker.seenVersion';
const demoUrl = new URLSearchParams(location.search).has('demo');
const seenVersion = () => { try { return localStorage.getItem(LS_SEEN_VER) || ''; } catch (e) { return VERSION; } };
const markVersionSeen = () => { try { localStorage.setItem(LS_SEEN_VER, VERSION); } catch (e) { /* niet erg */ } };

let newsCardDone = false;
// Kaartje tonen: alleen als dit apparaat de tracker al eerder opende, de versie veranderde en er iets te melden is
function maybeWhatsNew() {
  if (newsCardDone || sharedView) return;
  const card = $('whatsnew');
  if (!card) return;
  const seen = seenVersion();
  const items = WHATS_NEW[VERSION];
  if (!items || !items.length) { newsCardDone = true; markVersionSeen(); return; }
  // Eerste keer op dit apparaat (en niet de voorbeeldweergave): niets tonen, alleen onthouden
  if (!seen && !demoUrl) { newsCardDone = true; markVersionSeen(); return; }
  if (seen === VERSION && !demoUrl) { newsCardDone = true; return; }
  newsCardDone = true;
  // Eén keer per apparaat: meteen onthouden, ook als de gebruiker het kaartje laat staan
  if (!demoUrl) markVersionSeen();
  $('whatsnew-title').textContent = 'Wat is er nieuw in ' + VERSION;
  $('whatsnew-list').innerHTML = items.map((t) => '<li>' + esc(t) + '</li>').join('');
  card.hidden = false;
  if (typeof translateTree === 'function') translateTree(card);
}
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  if (!t || !t.closest || !t.closest('[data-wn-close]')) return;
  markVersionSeen();
  const card = $('whatsnew');
  if (card) card.hidden = true;
});

// ---------- Ouderdom van gegevens (idee 3) ----------
// Alleen een label als gegevens echt oud zijn; de grens hangt af van hoe vaak de bron verandert.
const AGE_LIMIT = { news: 14, research: 36, market: 48, daily: 72, weekly: 10 * 24, sec: 21 * 24 };
function stampMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v);
  if (!s) return null;
  // Datum zonder tijd (2026-11-14): tel vanaf het einde van die dag, anders lijkt hij een dag ouder
  const ms = Date.parse(/^\d{4}-\d\d-\d\d$/.test(s) ? s + 'T23:59:59' : s);
  return isFinite(ms) ? ms : null;
}
const ageWords = (h) => (h < 48 ? Math.round(h) + ' u oud' : Math.round(h / 24) + ' d oud');
// Klein label achter een kop: ageTag(stempel, grens in uren)
function ageTag(stamp, limitH) {
  const t = stampMs(stamp);
  if (t == null) return '';
  const h = (Date.now() - t) / HOUR;
  const lim = isNum(limitH) ? limitH : AGE_LIMIT.market;
  if (!(h > lim)) return '';
  return '<span class="age" title="' + esc('Deze gegevens zijn van ' + fDT.format(t) + '. De Worker haalt ze opnieuw op buiten de handelsuren.') + '">' + esc(ageWords(h)) + '</span>';
}
// Jongste van meerdere stempels (bijvoorbeeld Finnhub en Alpha Vantage voor hetzelfde aandeel)
function ageTagOf(obj, limitH, keys) {
  if (!obj) return '';
  const list = (keys || ['updated', 'avAt']).map((k) => stampMs(obj[k])).filter((x) => x != null);
  return list.length ? ageTag(Math.max.apply(null, list), limitH) : '';
}

// ---------- Naar inhoud (idee 5) ----------
function focusMain() {
  const w = $('welcome');
  const el = w && !w.hidden ? w : $(mode === 'm' ? 'm-main' : 'app');
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  el.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
}
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  if (t && t.closest && t.closest('[data-skip]')) focusMain();
});

// ---------- Knoppen bij lege tegels (idee 6) ----------
// Elke tegel die zegt dat er nog geen gegevens zijn, wijst naar de instelling of sleutel die dat oplost.
const FIX_LABEL = {
  FINNHUB_KEY: 'Finnhub-sleutel invullen',
  FMP_KEY: 'FMP-sleutel invullen',
  ALPHAVANTAGE_KEY: 'Alpha Vantage-sleutel invullen',
  TWELVEDATA_KEY: 'Twelve Data-sleutel invullen',
  TIINGO_KEY: 'Tiingo-sleutel invullen',
  POLYGON_KEY: 'Polygon-sleutel invullen',
  MARKETAUX_KEY: 'Marketaux-sleutel invullen',
  FRED_KEY: 'FRED-sleutel invullen',
  SEC_CONTACT: 'E-mailadres voor SEC invullen',
  T212_KEY: 'Trading 212-sleutel invullen',
  'flag:fx': 'Valuta aanzetten',
  'flag:inflation': 'Inflatie aanzetten',
  'flag:indices': 'Indexen aanzetten',
  'flag:sec': 'SEC EDGAR aanzetten',
  'flag:gdelt': 'GDELT aanzetten',
  'flag:openfigi': 'OpenFIGI aanzetten',
  'flag:trading': 'Kopen en verkopen aanzetten',
  'sec:import': 'Geschiedenis overnemen',
  'sec:account': 'Toegang en Worker openen',
  'sec:links': 'Koppelingen openen',
};
// Bij welke sleutel hoort welke functie: staat die al aan, dan is er niets op te lossen
const FIX_HAS = { FMP_KEY: 'fmp', FINNHUB_KEY: 'finnhub', ALPHAVANTAGE_KEY: 'av', TWELVEDATA_KEY: 'td', TIINGO_KEY: 'tiingo', POLYGON_KEY: 'polygon', MARKETAUX_KEY: 'mx', SEC_CONTACT: 'sec', T212_KEY: 't212' };
// Heeft een knop zin? Niet in de voorbeeldweergave, en niet als de sleutel of schakelaar al aanstaat
function fixShow(fix) {
  if (demo || !fix) return false;
  const h = FIX_HAS[fix];
  if (h && FEAT().has[h]) return false;
  const fl = fix.indexOf('flag:') === 0 ? fix.slice(5) : null;
  if (fl && FEAT().flags[fl]) return false;
  return true;
}
const fixLabel = (fix) => FIX_LABEL[fix] || 'Koppelingen openen';
// Knop naar de plek die deze tegel vult (ook te gebruiken in een Preact-module via data-fix)
function fixBtn(fix) {
  if (!fixShow(fix)) return '';
  return '<button type="button" class="linklike small" data-fix="' + esc(fix) + '">' + esc(fixLabel(fix)) + '</button>';
}
// Wachten tot Koppelingen geladen is (dat gaat via de Worker) en dan het juiste veld aanwijzen
function fixWait(get, tries) {
  const el = get();
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    try { /** @type {HTMLElement} */ (el).focus({ preventScroll: true }); } catch (e) { /** @type {HTMLElement} */ (el).focus(); }
    const row = el.closest('.key-row, .link-row') || el;
    row.classList.add('fix-hit');
    setTimeout(() => row.classList.remove('fix-hit'), 2400);
    return;
  }
  if ((tries || 0) > 24) return;
  setTimeout(() => fixWait(get, (tries || 0) + 1), 120);
}
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  const b = /** @type {HTMLElement|null} */ (t && t.closest ? t.closest('[data-fix]') : null);
  if (!b) return;
  const fix = b.dataset.fix || '';
  openSettings(false);
  if (fix.indexOf('sec:') === 0) { setGo(fix.slice(4)); return; }
  setGo('links');
  if (fix.indexOf('flag:') === 0) fixWait(() => document.querySelector('#links-body input[data-flag="' + fix.slice(5) + '"]'));
  else fixWait(() => $('key-' + fix));
});

// ---------- Getallen kopiëren (idee 8) ----------
// Rechtsklik op de computer, lang indrukken op de telefoon. Verborgen bedragen worden nooit gekopieerd.
const COPY_SEL = '.hero-value, .hero-change, .m-stat .v, .tile .v, .kv dd, td.num, .tx-v, .pill-chg, [data-v]';
const COPY_ROOTS = '#app, #m-main, #detail';
let copyBlock = 0;
function toastMsg(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('gone'), 1500);
  setTimeout(() => el.remove(), 2000);
}
// De tekst van het getal zelf: toelichtingen eronder (naam, "29 analisten", labels) tellen niet mee
function copyText(el) {
  const c = /** @type {Element} */ (el.cloneNode(true));
  c.querySelectorAll('.sub, .nm, .tag, .k, .muted, small').forEach((x) => x.remove());
  return (c.textContent || '').trim().replace(/\s+/g, ' ');
}
// De waarde zonder opmaak: liefst het ruwe getal dat de site al bewaarde, anders het getal uit de tekst
function plainNumber(el) {
  const raw = el.dataset ? el.dataset.v : '';
  if (raw && raw !== '' && isFinite(Number(raw))) return String(Number(raw));
  const txt = copyText(el);
  if (!/\d/.test(txt)) return null;
  let s = txt.replace(/[⁠  \s]/g, '').replace(/[−–]/g, '-').replace(/[€$£%]/g, '');
  const dec = LANG === 'nl' || LANG === 'de' || LANG === 'fr' ? ',' : '.';
  const thou = dec === ',' ? '.' : ',';
  s = s.split(thou).join('');
  if (dec === ',') s = s.replace(',', '.');
  const m = /-?\d+(\.\d+)?/.exec(s);
  if (!m) return txt;
  const n = Number(m[0]);
  return isFinite(n) ? String(n) : txt;
}
async function copyNumber(el) {
  // Verborgen bedragen worden nooit gekopieerd, ook niet het getal dat eronder zit
  if (hideAmounts && (el.textContent || '').indexOf('•') !== -1) { toastMsg('Bedragen staan verborgen'); return; }
  const v = plainNumber(el);
  if (v == null) return;
  try { await navigator.clipboard.writeText(v); toastMsg('Gekopieerd: ' + v); }
  catch (err) { toastMsg('Kopiëren lukte niet'); }
}
const copyTarget = (t) => (t && t.closest && t.closest(COPY_ROOTS) ? t.closest(COPY_SEL) : null);
document.addEventListener('contextmenu', (e) => {
  const el = copyTarget(/** @type {Element} */ (e.target));
  if (!el || !/\d/.test(el.textContent || '')) return;
  e.preventDefault();
  copyNumber(el);
});
// Lang indrukken: na een halve seconde kopiëren, en de klik daarna niet laten doorwerken (geen inzoomen)
let pressTimer = null, pressFrom = null;
const pressStop = () => { clearTimeout(pressTimer); pressTimer = null; pressFrom = null; };
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const el = copyTarget(/** @type {Element} */ (e.target));
  if (!el || !/\d/.test(el.textContent || '')) return;
  pressFrom = { x: e.clientX, y: e.clientY };
  pressTimer = setTimeout(() => {
    pressStop();
    copyBlock = Date.now();
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* niet ondersteund */ }
    copyNumber(el);
  }, 520);
}, { passive: true });
document.addEventListener('pointermove', (e) => {
  if (!pressFrom) return;
  if (Math.abs(e.clientX - pressFrom.x) > 8 || Math.abs(e.clientY - pressFrom.y) > 8) pressStop();
}, { passive: true });
['pointerup', 'pointercancel', 'scroll'].forEach((n) => document.addEventListener(n, pressStop, { passive: true, capture: true }));
document.addEventListener('click', (e) => {
  if (Date.now() - copyBlock < 700) { e.preventDefault(); e.stopPropagation(); }
}, true);

// ---------- Laatst bekeken pagina onthouden (idee 9) ----------
const LS_RESUME = 'tracker.resume';
const LS_LAST_PAGE = 'tracker.lastPage';
const resumeOn = () => { try { return localStorage.getItem(LS_RESUME) !== '0'; } catch (e) { return true; } };
function rememberPage() {
  if (!resumeOn() || ui.detail) return;
  // Pas opslaan als de routering klaar is; bij het laden tekent de site eerst Overzicht
  const want = parseHash().page;
  if (want && want !== ui.page) return;
  try { localStorage.setItem(LS_LAST_PAGE, ui.page); } catch (e) { /* niet erg */ }
}
// Bij het openen zonder adres achter het hekje: terug naar de pagina van de vorige keer
(function resumeLastPage() {
  if (!resumeOn() || location.hash || sharedView) return;
  let p = '';
  try { p = localStorage.getItem(LS_LAST_PAGE) || ''; } catch (e) { p = ''; }
  if (!p || p === 'home' || !(p in ORDER)) return;
  try { history.replaceState(null, '', location.pathname + location.search + '#' + pageHash(p)); } catch (e) { /* niet erg */ }
})();
window.addEventListener('hashchange', rememberPage);
document.addEventListener('change', (e) => {
  const t = /** @type {Element} */ (e.target);
  const el = /** @type {HTMLInputElement|null} */ (t && t.closest ? t.closest('[data-resume]') : null);
  if (!el) return;
  try { localStorage.setItem(LS_RESUME, el.checked ? '1' : '0'); } catch (err) { /* niet erg */ }
  if (el.checked) rememberPage();
});
(function syncResumeBox() {
  const el = /** @type {HTMLInputElement|null} */ (document.querySelector('[data-resume]'));
  if (el) el.checked = resumeOn();
})();

// ---------- Lange tabellen: kop in beeld houden (idee 7) ----------
// De kop blijft staan zolang de tabel zelf schuift; dat gebeurt pas vanaf een flink aantal rijen.
const TALL_ROWS = 10;
function stickyTables() {
  document.querySelectorAll('.tbl-wrap').forEach((w) => {
    const rows = w.querySelectorAll('tbody tr').length;
    if (rows > TALL_ROWS) w.classList.add('tall'); else w.classList.remove('tall');
  });
}
// Tabellen worden op allerlei momenten opnieuw getekend (pagina openen, sorteren, filteren, Preact):
// na elke wijziging een keer kijken, in het volgende beeld.
let stickyWait = 0;
function stickySoon() {
  cancelAnimationFrame(stickyWait);
  stickyWait = requestAnimationFrame(() => { stickyWait = requestAnimationFrame(stickyTables); });
}
['app', 'm-main', 'detail'].forEach((id) => {
  const el = $(id);
  if (el) new MutationObserver(stickySoon).observe(el, { childList: true, subtree: true });
});

// ---------- Meeliften op het tekenen van elke pagina ----------
defineView('handig', () => { maybeWhatsNew(); rememberPage(); stickySoon(); });
Object.keys(PAGE_VIEWS).forEach((p) => { if (!PAGE_VIEWS[p].includes('handig')) PAGE_VIEWS[p].push('handig'); });
