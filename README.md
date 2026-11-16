# Investment tracker

Persoonlijke beleggingstracker voor Trading 212: een Google Sheet die via de Trading 212 API wordt gevuld, met een eigen dashboardwebsite.

**Website openen:** [svgbml.github.io/Investment-tracker](https://svgbml.github.io/Investment-tracker/)

- `apps-script/Code.gs`: het Apps Script dat aan de Google Sheet hangt (wekelijkse snapshots, metingen elke 10 minuten, terugrekenen van oude weken, JSON-koppeling voor de website).
- `docs/`: de website (GitHub Pages), zonder externe bibliotheken. Drie weergaven:
  - **Overzicht**: grafiek van de totale waarde (vandaag, 3 dagen, 30 dagen, alles), kerncijfers (klik op Accountwaarde voor de verdeling in cirkeldiagrammen), 2 stijgers, de markt (S&P 500 via je ETF) en 2 dalers, een agenda met aankomende kwartaalcijfers en dividenden, ontvangen dividend, weekoverzicht, patronen en statistieken (onder meer grootste terugval, jij tegenover de markt, spreiding, beste week en dividendrendement).
  - **Bedrijven**: alle posities als tegels met grafiek, zoeken, filteren en sorteren.
  - **Bedrijfspagina**: klik op een tegel en de pagina zoomt erop in. Met grafiek (ook tegen de hele portefeuille), positie, dagbereik, historie en patronen per bedrijf. Het adres `#bedrijf/TICKER` werkt ook als link.
  - Op een telefoon (smaller dan 700 pixels) toont de site een eigen app-indeling: tabbalk onderin (Overzicht, Bedrijven, Statistieken, Instellingen), lijsten in plaats van tegels, en een bedrijfspagina met tabbladen. Veeg over naam en waarde naar het vorige of volgende bedrijf.
  - Bij de Cloudflare Worker kun je via Instellingen je geschiedenis uit de Google Sheet overnemen.
  - Probeer het met voorbeeldgegevens via `?demo`.
- `worker/`: dezelfde tracker als Cloudflare Worker, zonder Google Sheets. Zie [worker/README.md](worker/README.md).

Er staan geen sleutels of portefeuillegegevens in deze repository. De Trading 212 API-sleutel staat alleen in de scripteigenschappen van Apps Script of als geheim bij Cloudflare; de website vraagt een eigen toegangscode die alleen in je browser wordt bewaard.
