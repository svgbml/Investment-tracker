# Roadmap: de site sneller maken

Ideeën om de webapp minder traag te laten aanvoelen. De punten 1 tot en met 9 zijn in versie v68 uitgevoerd; per punt staat hieronder wat er gebouwd is, wat het opleverde en wat is teruggedraaid.

## Resultaat (v68)

Gemeten op 20 november 2026 met `node tools/meetlat.mjs --keer 5` (de vaste meetlat uit punt 9): de demo (`?demo`) in Chromium, desktop 1360×900 en telefoon 390×844 met een vier keer tragere processor, vaste klok, mediaan van vijf keer laden. Links `main` (v67) op dezelfde machine, rechts deze versie (v68). De getallen schommelen per meting ongeveer 15%; vergelijk alleen metingen van dezelfde machine.

| Meting | Desktop v67 | Desktop v68 | Telefoon v67 | Telefoon v68 |
|---|---|---|---|---|
| Langste blokkerende taak bij het laden | 331 ms | 147 ms | 1.473 ms | 488 ms |
| Blokkerende taken (> 50 ms) in de eerste 4 seconden | 3 | 2 | 10 | 6 |
| Blokkeertijd in de eerste 4 seconden (som boven 50 ms) | 333 ms | 149 ms | 2.068 ms | 1.192 ms |
| Alles opnieuw tekenen (`renderAll`) | 58 ms | 27 ms | 266 ms | 104 ms |
| … waarvan langste taak | 74 ms | < 50 ms | 347 ms | < 50 ms |
| Alleen Analyse opnieuw tekenen | 58 ms | 41 ms | 448 ms | 142 ms |
| Alleen Start (home) opnieuw tekenen | 28 ms | 24 ms | 115 ms | 103 ms |
| Tegels opvouwen (`foldAll`) | 23 ms | 12 ms | 79 ms | 48 ms |
| Elementen in de pagina na het laden | 17.032 | 2.500 | 7.804 | 2.500 |
| … waarvan op de verborgen pagina's Nieuws en Plannen | 14.543 | 13 | 5.308 | 6 |
| Langste taak bij de eerste keer openen van Plannen | 459 ms | 69 ms | 329 ms | 248 ms |
| Pagina gereed (DOMContentLoaded) | 897 ms | 602 ms | 3.399 ms | 2.454 ms |

Tussenstappen (telefoon, mediaan van drie keer laden; punt 7 en de eindstand vijf keer):

| Na punt | Langste taak laden | Blokkeertijd 4 s | `renderAll` | Analyse | Start | `foldAll` | Elementen |
|---|---|---|---|---|---|---|---|
| `main` (v67) | 1.380 | 1.809 | 214 | 390 | 127 | 73 | 8.280 |
| 1. zichtbare pagina | 1.322 | 1.357 | 234 | 329 | 111 | 73 | 2.502 |
| 2. opknippen | 493 | 1.356 | 263 | 352 | 113 | 76 | 2.502 |
| 3. alleen tekenen wat veranderde | 451 | 1.293 | 264 | 332 | 118 | 78 | 2.502 |
| 4. Analyse | 491 | 1.170 | 255 | 127 | 162 | 96 | 2.502 |
| 5. `content-visibility` | 538 | 1.121 | 220 | 126 | 100 | 55 | 2.502 |
| 6. opvouwen | 490 | 1.148 | 104 | 135 | 89 | 52 | 2.502 |
| 7. lui laden | 421 | 1.026 | 166 | 124 | 91 | 53 | 2.502 |
| eindstand (v68) | 488 | 1.192 | 104 | 142 | 103 | 48 | 2.500 |

Wat bij het laden op de telefoon nog boven 50 ms blijft: het inlezen en uitvoeren van alle scripts (± 0,5 s in één taak, zie punt 7), het maken van de voorbeeldgegevens (`makeDemoData`, ± 0,5 s; alleen in de demo) en de onderste helft van Start (`home-rest`, ± 0,2 s).

## Wat er eerst gemeten is (v65)

Gemeten op 19 november 2026 met de demo (`?demo`, versie v65) in Chrome, één keer op desktopformaat en één keer op telefoonformaat met een vier keer tragere processor (ongeveer een middenklasse telefoon).

| Meting | Desktop | Telefoon (4× trager) |
|---|---|---|
| Langste blokkerende taak bij het laden | 267 ms | 1.650 ms |
| Blokkerende taken (> 50 ms) in de eerste 4 seconden | 4 | 38 |
| Alles opnieuw tekenen (`renderAll`) | 41 ms | 431 ms |
| Alleen Analyse opnieuw tekenen | 39 ms | 350 ms |
| Alleen Start (home) opnieuw tekenen | 19 ms | 138 ms |
| Tegels opvouwen (`foldAll`) | 19 ms | 84 ms |
| Elementen in de pagina | 18.951 | 8.635 |

Andere feiten uit de code:

- Op desktop staan ook de pagina's die je niet ziet volledig in de pagina: Start heeft 1.679 elementen, maar het verborgen Nieuws heeft er 4.737 en het verborgen Plannen 7.925. Die worden bij elke verversing ook opnieuw getekend.
- 1,3 MB JavaScript in 40 losse scripts, die allemaal bij het starten worden ingelezen en uitgevoerd. `style.css` is 170 kB.
- De weergaven tekenen zichzelf opnieuw met `innerHTML` (119 plekken) en 27 plekken roepen `renderAll()` aan, ook als maar één tegel veranderde.
- Ongeveer 35 plekken meten de opmaak (`getBoundingClientRect`, `offsetHeight`, `scrollHeight`), onder meer bij het opvouwen van tegels. Afwisselend meten en wijzigen dwingt de browser telkens de opmaak opnieuw uit te rekenen.

Alles boven 50 ms voelt een gebruiker als haperen (de browser reageert dan niet op tikken of scrollen). Op een telefoon zit vooral Analyse en het starten daar ruim boven.

## Ideeën, op volgorde van verwachte winst

### 1. Alleen de zichtbare pagina tekenen

Verborgen pagina's (Nieuws, Plannen, Analyse als je op Start bent) pas tekenen als je ze opent, en bij een verversing alleen de zichtbare pagina bijwerken. Een verborgen pagina krijgt een vlag "verouderd" en wordt bij openen bijgewerkt.

- Winst: het grootste deel van de 19.000 elementen hoeft niet bij elke verversing opnieuw gebouwd te worden; bij het starten scheelt het het tekenen van Nieuws en Plannen.
- Waar: `refresh()` en `renderAll()` in `00-kern.js`, het wisselen van pagina in `10-navigatie.js`.
- Let op: tegels die elkaars gegevens gebruiken, en de foldberekening (`foldAll`) moet na het openen van een pagina draaien.

**Gebouwd (v68).** `renderAll()` tekende al alleen de open pagina, maar de Preact-modules voor Nieuws en Plannen riepen bij het laden zelf `refresh('news')` en `refresh('plan')` aan, en de telefoon tekende de statistieken van Start twee keer (ook als weergave van Analyse). Nu slaat `refresh()` zelf elke weergave over die alleen bij een andere pagina hoort (`viewOffscreen` in `00-kern.js`/`10-navigatie.js`) en onthoudt hem als verouderd; `ensurePage` tekent hem bij het openen. Elementen na het laden: 17.032 → 2.500 op desktop.

### 2. Lange taken opknippen

`renderAll` en het opstarten in stukken doen en tussendoor de browser even laten reageren. In Chrome en Firefox kan dat met `scheduler.yield()`, met `setTimeout(0)` als terugval voor Safari. Eerst de tegels boven in beeld, de rest daarna.

- Winst: de 1,6 seconde bij het starten op een telefoon wordt een reeks korte stappen; tikken en scrollen werken meteen.
- Waar: `refresh()` in `00-kern.js` (na elke weergave even wachten als er al meer dan ± 40 ms voorbij is), de opstart in `19-start.js`.

**Gebouwd (v68).** `yieldNow()` in `00-kern.js` (`scheduler.yield()`, anders `setTimeout(0)`). `renderAll()` is nu async en laat de browser na een weergave even los als er al meer dan 40 ms voorbij is; Start is daarvoor gesplitst in `home` (boven de vouw) en `home-rest` (sectoren, valuta, risico, weken, patronen, statistieken). Tussen het maken van de voorbeeldgegevens en het tekenen zit een pauze, en het bewaren van de gegevens in IndexedDB gebeurt na het tekenen. Langste taak bij het laden op de telefoon: ± 1.400 → ± 490 ms.

### 3. Alleen tekenen wat veranderde

Veel acties (een knop indrukken, een filter kiezen) roepen `renderAll()` aan terwijl maar één weergave verandert. Die vervangen door `refresh('naam')`. Binnen een weergave kan de kleine `morphDom` uit `20-handel.js` (gebruikt in het orderscherm) alleen de gewijzigde stukken vervangen in plaats van alles via `innerHTML`; dat houdt ook de focus en scrollpositie vast.

- Winst: kleinere, kortere tekenbeurten; minder geknipper.
- Waar: de 27 aanroepen van `renderAll()`; `morphDom` naar `00-kern.js` verhuizen als die vaker gebruikt wordt.

**Gebouwd (v68), met weinig effect.** Na punt 1 tekent `renderAll()` al alleen de open pagina, dus het meeste was al gewonnen. Vervangen door `refresh(...)`: het herberekenen na de samenhang-berekening (die komt na het laden binnen en tekende heel Start opnieuw), het opslaan van de concentratiegrenzen en van spaarrekeningen. De andere aanroepen veranderen instellingen die op meer pagina's staan (rekeningen, doelen, notities, koersalarmen, thema, bedragen verbergen) en blijven `renderAll()`.
**Teruggedraaid:** `morphDom` in `fill()` (alleen veranderde tegels vervangen). Het tekenen werd er niet sneller van (Start 26 → 22 ms desktop, 113 → 116 ms telefoon, binnen de ruis), dus `morphDom` blijft alleen in het orderscherm.

### 4. Analyse sneller maken

Analyse is op een telefoon met 350 ms de duurste weergave. Uitzoeken welke tegels het meeste kosten (het `?perf`-paneel meet al per weergave) en de zware berekeningen (risico, correlaties, simulaties) cachen zolang de gegevens niet veranderen, of via `runOffThread` naar een Web Worker sturen. Tegels onder de vouw pas berekenen als ze in beeld komen (`IntersectionObserver`).

**Gebouwd (v68).** Gemeten per tegel: de tegels zelf rekenen samen maar ± 80 ms (telefoon); de kosten zaten in de pagina: alle vijf onderdelen werden opgebouwd terwijl de telefoon er maar één toont (tabbladen), en `dashApply` vouwde meteen op, wat de hele pagina liet opmeten. Nu vult Analyse op de telefoon alleen het open tabblad (de rest krijgt alleen de kop voor de tabbladen en "Pagina aanpassen"); het rapport (pdf) zet `analyseAll` tijdelijk aan en tekent alles. `dashApply` vouwt op vóór de volgende tekening. Analyse op de telefoon: ± 390 → ± 140 ms. `tools/check-demo.mjs` opent nu op de telefoon elk tabblad.
**Niet gedaan:** cachen of `runOffThread` voor de berekeningen (de zwaarste tegel, Risico en rendement, kost ± 16 ms op de telefoon; de samenhang en de simulaties gaan al via `runOffThread`) en `IntersectionObserver` (op desktop kost Analyse ± 40 ms, op de telefoon doen de tabbladen hetzelfde werk). Plannen op de telefoon kan op dezelfde manier alleen het open tabblad vullen; dat is nog niet gedaan.

### 5. `content-visibility: auto` voor lange pagina's

Secties onder de vouw (`.dash-sec`) krijgen `content-visibility: auto` met een `contain-intrinsic-size`. De browser slaat dan opmaak en tekenen over voor wat buiten beeld is.

- Winst: goedkoop om te proberen, alleen CSS.
- Let op: `foldAll` meet tegelhoogtes; voor secties buiten beeld geeft de browser dan een geschatte hoogte. Ook kan de pagina verspringen als de geschatte hoogte niet klopt. Meten voor en na.

**Gebouwd (v68).** `.dash-sec { content-visibility: auto; contain-intrinsic-size: auto 640px }` en in de afdruk `visible`. Het opvouwen gaf precies dezelfde uitkomst (zelfde ingeklapte tegels en hoogtes, nagemeten) en de zoom naar en van een detailpagina onderaan Start werkt. Wel knipte `content-visibility` de focusring en schaduw van een tegel aan de rand van de sectie af; `overflow-clip-margin: 40px` lost dat op. Een schermafbeelding van de hele pagina (Playwright `fullPage`) laat secties buiten beeld leeg; `tools/visual.mjs` zet daarom voor zijn afbeeldingen `content-visibility` uit. Op desktop: `renderAll` 52 → 43 ms, `foldAll` 21 → 16 ms. Start op de telefoon heeft geen `.dash-sec`, dus daar verandert niets.

### 6. Meten en wijzigen scheiden bij het opvouwen

`foldAll` en `fitChart` eerst alle hoogtes laten meten en daarna pas alles aanpassen (niet om en om). Eventueel met een `ResizeObserver` in plaats van zelf meten na elke verversing.

**Gebouwd (v68).** `foldAll` werkt nu in vijf stappen: lezen (welke pagina), schrijven (alles terug naar de natuurlijke hoogte), lezen (alle hoogtes, rijen en grafiekposities via `fitMeasure`), schrijven (opvouwen, `fitApply`), en één keer vastleggen. Eerst dwong elke tegel met een grafiek een eigen opmaakberekening af. `foldSoon()` vouwt nu op vlak vóór de volgende tekening (`requestAnimationFrame`) in plaats van meteen, zodat de opmaak één keer wordt uitgerekend voor opvouwen én tekenen. `renderAll` op de telefoon: ± 220 → ± 104 ms, zonder taak boven 50 ms. Geen `ResizeObserver`: de bestaande aanroepen (na tekenen, bij een andere schermmaat en na het laden van het lettertype) zijn genoeg.

### 7. Minder JavaScript bij het starten

- Scripts die pas nodig zijn op een andere pagina (plannen, onderzoek, handel, nieuws-extra) pas laden als je die pagina opent.
- Of de 40 scripts bij het publiceren samenvoegen en verkleinen. Dat vraagt een bouwstap, terwijl de site nu bewust zonder bouwstap werkt; eerst kijken hoeveel het lui laden al oplevert.
- De service worker bewaart alles al offline, dus het gaat hier om uitvoeren, niet om downloaden.

**Gebouwd (v68), alleen lui laden, geen bouwstap.** De meeste scripts worden op meer pagina's gebruikt (Analyse-tegels op de detailpagina's, handelen vanuit elke bedrijfspagina, nieuws op Start). Alleen het tweede deel van Plannen was los genoeg: `21-plannen2.js` is gesplitst in een klein vast deel (toestand, vertalingen, begrippen, "jouw jaar in beeld" en het tellen van bekeken bedrijfspagina's) en `29-plannen-extra.js` (62 kB, 4,7% van de JavaScript), dat `VIEW_SCRIPTS` in `10-navigatie.js` pas laadt als je Plannen opent. Het script staat in de cachelijst van de service worker, dus het werkt ook zonder verbinding.
Opbrengst (vijf keer laden, telefoon): pagina gereed (DOMContentLoaded) 2.425 → 2.304 ms, langste taak bij het laden 484 → 421 ms; op desktop binnen de ruis. Het eerste openen van Plannen kost daardoor één extra korte taak (inlezen van het script); inlezen en tekenen zijn twee aparte taken. Samenvoegen en verkleinen met een bouwstap is bewust niet gedaan.

### 8. Lange lijsten beperken

Lijsten met veel regels (transacties, nieuws, orders, dagboek) eerst 20 tot 50 regels tonen met een knop "Meer tonen", of virtualiseren.

**Gebouwd (v68).** De meeste lijsten waren al beperkt (orders 12, beslisdagboek 10, nieuws per 30 koppen, alle transacties gevirtualiseerd). Onbeperkt waren nog het aankoopdagboek (elke aankoop met een notitie, elk met een invoerveld) en de economische agenda. Die tonen nu eerst 8 en 5 regels met een knop "Meer tonen" (`moreRows` in `04-grafieken.js`; de knop tekent alleen zijn eigen weergave opnieuw en houdt de focus). In de demo is het verschil klein omdat de lijsten kort zijn; het helpt bij veel notities.

### 9. Een vaste meetlat

- Bovenstaande metingen als script in `tools/` zetten (Playwright, demo, telefoonformaat met tragere processor) en in de Lighthouse-workflow een grens opnemen voor de langste taak en het aantal elementen.
- Het bestaande `?perf`-paneel uitbreiden met het aantal elementen per pagina en de langste taak.

**Gebouwd (v68).** `tools/meetlat.mjs` meet alle waarden uit de tabel (desktop en telefoon met `Emulation.setCPUThrottlingRate` 4, Long Tasks API, vaste klok), plus de elementen per pagina, de langste taak bij het eerste openen van elke pagina en DOMContentLoaded. Met `--map` meet het een andere uitgecheckte versie, met `--grens` faalt het boven de grenzen. De Lighthouse-werkstroom draait het met `--grens` (niet blokkerend) en zet de tabel in de samenvatting; `lighthouserc.json` waarschuwt boven 6.000 elementen (`dom-size`). Het `?perf`-paneel toont nu ook de langste taak, het aantal taken boven 50 ms en de elementen per pagina.

## Bronnen

- [Use scheduler.yield() to break up long tasks](https://developer.chrome.com/blog/use-scheduler-yield) (Chrome)
- [Optimize long tasks](https://web.dev/articles/optimize-long-tasks) (web.dev)
- [The CSS content-visibility property is now Baseline Newly available](https://web.dev/blog/css-content-visibility-baseline?hl=en) (web.dev)
- [content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility) (MDN)
- [Optimizing interactions in complex layouts](https://developer.chrome.com/docs/modern-web-guidance/guides/performance/interactions-in-complex-layouts) (Chrome)
- [Lazy DOM rendering](https://shopify.dev/docs/storefronts/themes/best-practices/performance/lazy-dom-rendering) (Shopify)
- [Field testing CSS containment](https://www.speedkit.com/blog/field-testing-css-containment-for-web-performance-optimization) (Speed Kit)
