# Roadmap: de site sneller maken

Ideeën om de webapp minder traag te laten aanvoelen, voor later. Nog niets hiervan is gebouwd.

## Wat er nu gemeten is

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

### 2. Lange taken opknippen

`renderAll` en het opstarten in stukken doen en tussendoor de browser even laten reageren. In Chrome en Firefox kan dat met `scheduler.yield()`, met `setTimeout(0)` als terugval voor Safari. Eerst de tegels boven in beeld, de rest daarna.

- Winst: de 1,6 seconde bij het starten op een telefoon wordt een reeks korte stappen; tikken en scrollen werken meteen.
- Waar: `refresh()` in `00-kern.js` (na elke weergave even wachten als er al meer dan ± 40 ms voorbij is), de opstart in `19-start.js`.

### 3. Alleen tekenen wat veranderde

Veel acties (een knop indrukken, een filter kiezen) roepen `renderAll()` aan terwijl maar één weergave verandert. Die vervangen door `refresh('naam')`. Binnen een weergave kan de kleine `morphDom` uit `20-handel.js` (gebruikt in het orderscherm) alleen de gewijzigde stukken vervangen in plaats van alles via `innerHTML`; dat houdt ook de focus en scrollpositie vast.

- Winst: kleinere, kortere tekenbeurten; minder geknipper.
- Waar: de 27 aanroepen van `renderAll()`; `morphDom` naar `00-kern.js` verhuizen als die vaker gebruikt wordt.

### 4. Analyse sneller maken

Analyse is op een telefoon met 350 ms de duurste weergave. Uitzoeken welke tegels het meeste kosten (het `?perf`-paneel meet al per weergave) en de zware berekeningen (risico, correlaties, simulaties) cachen zolang de gegevens niet veranderen, of via `runOffThread` naar een Web Worker sturen. Tegels onder de vouw pas berekenen als ze in beeld komen (`IntersectionObserver`).

### 5. `content-visibility: auto` voor lange pagina's

Secties onder de vouw (`.dash-sec`) krijgen `content-visibility: auto` met een `contain-intrinsic-size`. De browser slaat dan opmaak en tekenen over voor wat buiten beeld is.

- Winst: goedkoop om te proberen, alleen CSS.
- Let op: `foldAll` meet tegelhoogtes; voor secties buiten beeld geeft de browser dan een geschatte hoogte. Ook kan de pagina verspringen als de geschatte hoogte niet klopt. Meten voor en na.

### 6. Meten en wijzigen scheiden bij het opvouwen

`foldAll` en `fitChart` eerst alle hoogtes laten meten en daarna pas alles aanpassen (niet om en om). Eventueel met een `ResizeObserver` in plaats van zelf meten na elke verversing.

### 7. Minder JavaScript bij het starten

- Scripts die pas nodig zijn op een andere pagina (plannen, onderzoek, handel, nieuws-extra) pas laden als je die pagina opent.
- Of de 40 scripts bij het publiceren samenvoegen en verkleinen. Dat vraagt een bouwstap, terwijl de site nu bewust zonder bouwstap werkt; eerst kijken hoeveel het lui laden al oplevert.
- De service worker bewaart alles al offline, dus het gaat hier om uitvoeren, niet om downloaden.

### 8. Lange lijsten beperken

Lijsten met veel regels (transacties, nieuws, orders, dagboek) eerst 20 tot 50 regels tonen met een knop "Meer tonen", of virtualiseren.

### 9. Een vaste meetlat

- Bovenstaande metingen als script in `tools/` zetten (Playwright, demo, telefoonformaat met tragere processor) en in de Lighthouse-workflow een grens opnemen voor de langste taak en het aantal elementen.
- Het bestaande `?perf`-paneel uitbreiden met het aantal elementen per pagina en de langste taak.

## Bronnen

- [Use scheduler.yield() to break up long tasks](https://developer.chrome.com/blog/use-scheduler-yield) (Chrome)
- [Optimize long tasks](https://web.dev/articles/optimize-long-tasks) (web.dev)
- [The CSS content-visibility property is now Baseline Newly available](https://web.dev/blog/css-content-visibility-baseline?hl=en) (web.dev)
- [content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility) (MDN)
- [Optimizing interactions in complex layouts](https://developer.chrome.com/docs/modern-web-guidance/guides/performance/interactions-in-complex-layouts) (Chrome)
- [Lazy DOM rendering](https://shopify.dev/docs/storefronts/themes/best-practices/performance/lazy-dom-rendering) (Shopify)
- [Field testing CSS containment](https://www.speedkit.com/blog/field-testing-css-containment-for-web-performance-optimization) (Speed Kit)
