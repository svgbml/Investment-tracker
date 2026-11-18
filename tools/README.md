# Gereedschap en controles

Alles in deze map draait met Node (24 of nieuwer) en zonder build-stap. In GitHub Actions draaien ze in
`.github/workflows/checks.yml` (blokkerend) en `kwaliteit.yml`, `lighthouse.yml`, `preview.yml` (niet blokkerend).

## In één keer alles

```bash
# eenmalig, voor de browsercontroles en de stijlcontrole
npm i --no-save playwright axe-core pixelmatch pngjs stylelint
npx playwright install chromium
```

```bash
node tools/check-site.mjs        # syntaxis, dubbele of botsende namen, cacheversie, scriptlijst
node tools/check-types.mjs       # TypeScript (checkJs) tegen tools/types-baseline.json
node worker/test/run.mjs         # Worker tegen nep-API's en een D1 in het geheugen
node worker/test/contract.mjs    # bronnen: bewaarde voorbeeldantwoorden (worker/test/fixtures/)
node tools/check-demo.mjs        # ?demo in een echte browser: geen lege tegels, geen NaN
node tools/smoke.mjs             # elke pagina openen op 1360×900 en 390×844, licht en donker
node tools/test-reken.mjs        # XIRR, TWR, drawdown, risicoklasse, correlatie, Monte Carlo, box 3, opmaak
node tools/check-i18n.mjs        # Nederlandse koppen en knoppen zonder Engelse vertaling (waarschuwing)
node tools/check-stijl.mjs       # stylelint op de CSS-regels die jij veranderde
node tools/check-dood.mjs        # namen waar niets naar verwijst
node tools/a11y.mjs              # axe-core op alle pagina's (niet blokkerend)
node tools/visual.mjs --uit map  # schermafbeeldingen; vergelijken met --vergelijk mapOud mapNieuw
node tools/lh-score.mjs --lees .lighthouseci-report   # scores uit een Lighthouse-rapport
```

## Wat elk script doet

| Script | Waarvoor | Blokkeert? |
|---|---|---|
| `check-site.mjs` | Syntaxis van elk script, dubbele namen in het gedeelde bereik, namen die met de browser botsen, cacheversie en de scriptlijst | ja |
| `check-types.mjs` | TypeScript met `checkJs`; faalt als een bestand méér meldingen krijgt dan in `types-baseline.json` staat. Met `--update` werk je de basislijn bij nadat je meldingen hebt opgelost. De typen van `data`, `M`, onderzoek en instellingen staan in `docs/js/types.d.ts` | ja |
| `check-demo.mjs` | Opent `?demo` en kijkt in elke tegel naar "nog geen …", `NaN`, `undefined` of `[object Object]`. Een nieuwe functie zonder voorbeeldgegevens valt hier om | ja |
| `smoke.mjs` | Opent elke pagina en een bedrijfspagina op bureaublad- en telefoonformaat, licht en donker: fouten in de console en zijwaarts schuiven | ja |
| `test-reken.mjs` | Rekentests met bekende antwoorden, in de pagina zelf (de site is één gedeeld bereik, dus los importeren kan niet) | ja |
| `check-i18n.mjs` | Koppen en knopteksten die nog niet in `EN` staan in `docs/js/13-app.js` | nee (waarschuwing) |
| `check-stijl.mjs` | stylelint (`.stylelintrc.json`) op alleen de CSS-regels die in deze tak veranderden; bestaande CSS wordt niet opnieuw opgemaakt | ja, voor jouw regels |
| `check-dood.mjs` | Namen op het hoogste niveau waar nergens naar verwezen wordt (lees na voor je iets weghaalt) | nee |
| `a11y.mjs` | axe-core, WCAG 2.1 A en AA, op alle pagina's in beide thema's en formaten | nee |
| `visual.mjs` | Schermafbeeldingen met een vaste klok, en het aantal veranderde beeldpunten tegenover een andere versie | nee |
| `lh-score.mjs` | Leest een Lighthouse-rapport en zet twee metingen naast elkaar in een tabel | nee |
| `lib-browser.mjs` | Gedeelde hulp: `docs/` uitserveren, een pagina openen, naar een pagina gaan, overloop meten | – |

De browsercontroles gebruiken Playwright met Chromium. `visual.mjs` en de schermafbeeldingen zetten de klok
vast op `VAST_MOMENT`, want de voorbeeldgegevens worden rond "nu" gemaakt; zonder vaste tijd verschuift elke
grafiek en is vergelijken zinloos.

## Opmaak van getallen: welke functie waarvoor

Deze hulpjes staan in de site zelf (niet verplaatsen; `tools/test-reken.mjs` test ze allemaal, inclusief
NaN, min nul en hele grote getallen).

| Functie | Bestand | Wat het doet | Voorbeeld |
|---|---|---|---|
| `eur(v)` | `01-basis.js` | Bedrag in euro. Geen getal → `–`. Staat "bedragen verbergen" aan, dan `€ ••••`. Min nul toont geen minteken | `eur(1234.567)` → `€ 1.234,57` |
| `seur(v)` | `01-basis.js` | Bedrag met teken ervoor (`+` of `−`), nul zonder teken; werkt ook met bedragen verbergen | `seur(-2.5)` → `−€ 2,50` |
| `money(v, cur)` | `05-portefeuille.js` | Bedrag in een andere munt; euro gaat via `eur` | `money(12.5, 'USD')` → `$12,50` |
| `spct(v)` | `01-basis.js` | Percentage met teken, twee decimalen (`P2`) | `spct(0.1234)` → `+12,34%` |
| `spct1(v)` | `01-basis.js` | Percentage met teken, één decimaal (`P1`) | `spct1(0.1234)` → `+12,3%` |
| `P1`, `P2` | `01-basis.js` | `Intl.NumberFormat` voor percentages met één of twee decimalen (zonder teken) | `P1.format(0.1234)` → `12,3%` |
| `PCT0` | `09-weergaven.js` | Percentage zonder decimalen, voor verdelingen en wegingen | `PCT0.format(0.1234)` → `12%` |
| `N1`, `N2`, `N4`, `NI` | `01-basis.js` | Gewone getallen met 1, 2, 4 of 0 decimalen | `N2.format(1234.5)` → `1.234,50` |
| `sgn(v, f)` | `01-basis.js` | Zet er een `+` of `−` voor en maakt het getal positief; basis onder `seur`, `spct` en `spct1` | – |
| `tone(v)` | `01-basis.js` | `gain`, `loss` of leeg, voor de kleur | `tone(-1)` → `loss` |
| `isNum(v)` | `01-basis.js` | Echt een getal (geen NaN, geen oneindig, geen tekst) | `isNum('1')` → `false` |
| `days(n)` | `01-basis.js` | `1 dag` of `n dagen` | `days(2)` → `2 dagen` |
| `esc(s)` / `escHtml(s)` | `01-basis.js` / `00-kern.js` | Tekst veilig in HTML zetten | `esc('<b>')` → `&lt;b&gt;` |
| `tpl\`…\`` / `raw(html)` | `00-kern.js` | Sjabloon dat ingevoegde waarden zelf ontsnapt; `raw` voor HTML die al veilig is | `` tpl`<p>${'<x>'}</p>` `` → `<p>&lt;x&gt;</p>` |

Regels die altijd gelden:

- Een bedrag in de pagina gaat door `eur` of `seur`, nooit door `Intl` rechtstreeks: anders werkt de knop
  "bedragen verbergen" niet meer.
- Geen getal (null, undefined, NaN, oneindig, tekst) wordt overal `–`, nooit `NaN` of `undefined`.
- De opmaak volgt de gekozen taal (`LOCALE`): in het Nederlands een punt voor duizendtallen en een komma
  voor decimalen; `tools/test-reken.mjs` vergelijkt daarom met vaste spaties ongevoelig.

## Galerij

`docs/index.html?gallery` toont elke tegel en elk bedieningselement met voorbeeldgegevens, met een knop voor
licht en donker en een zoekveld. Handig tijdens het bouwen en bij het nakijken van een wijziging. De galerij
wordt pas geladen als `?gallery` in het adres staat (`docs/js/21-galerij.js`), dus gewone bezoekers
downloaden hem niet.
