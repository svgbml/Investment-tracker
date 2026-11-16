# Investment tracker

Persoonlijke beleggingstracker voor Trading 212. Een Cloudflare Worker haalt je portefeuille op via de Trading 212 API en bewaart de geschiedenis; een website laat alles zien, ook als app op je telefoon.

**Website openen:** [svgbml.github.io/Investment-tracker](https://svgbml.github.io/Investment-tracker/) (probeer het zonder account met [voorbeeldgegevens](https://svgbml.github.io/Investment-tracker/?demo)).

## Zelf installeren

Voor de basis heb je alleen een **gratis Cloudflare-account** en een **Trading 212 API-sleutel** nodig. Een Google Sheet is niet nodig.

1. **Worker aanmaken.** Klik op de knop hieronder en log in bij Cloudflare (of maak een gratis account). Cloudflare maakt een kopie van de Worker in je eigen GitHub-account, maakt de database aan en zet de Worker online.

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/svgbml/Investment-tracker/tree/main/worker)

2. **Toegangscode.** Cloudflare vraagt om `WEB_TOKEN`: kies een lange willekeurige code. Dat is je wachtwoord voor de website. Vergeten in te vullen? Voeg hem later toe bij je Worker onder *Settings → Variables and Secrets* als type *Secret*.
3. **Website koppelen.** Open de [website](https://svgbml.github.io/Investment-tracker/), kies *Worker en toegangscode invullen*, vul het adres van je Worker in (`https://investment-tracker.JOUWNAAM.workers.dev/api/data`, te vinden bovenaan de Worker in Cloudflare) en je toegangscode.
4. **Trading 212.** Maak in de Trading 212-app een API-sleutel met alleen leesrechten (*Instellingen → API*). Vul sleutel en secret in op de website onder *Instellingen → Koppelingen en functies*. De Worker doet direct een eerste meting.

Daarna meet de Worker op werkdagen elke 10 minuten (08:00–22:30), maakt hij elke zaterdag een weekoverzicht en haalt hij je orders en dividenden op. De tabellen in de database maakt hij zelf aan.

Lukt de knop niet? Dan kan het ook met de hand: zie [worker/README.md](worker/README.md).

## Extra functies aanzetten

Zet ze aan op de website onder *Instellingen → Koppelingen en functies*. Sleutels gaan naar je eigen Worker en worden nooit teruggestuurd naar de browser. Wie ze liever bij Cloudflare bewaart, zet ze daar als *Secret* met dezelfde naam; die gaan dan voor.

| Functie | Bron | Wat je nodig hebt |
|---|---|---|
| Posities, weken, orders, dividend, valuta-effect, statistieken, plannen | Trading 212 | API-sleutel en secret (vereist) |
| Risico-indicatie (1 tot 7), wat beweegt samen, jaaroverzicht (ook als PDF), mijlpalen, bedragen verbergen, donkere modus | Trading 212 (berekend op de site) | niets extra |
| Agenda (kwartaalcijfers, dividenden), sector en branche, vergelijkbare bedrijven | [Financial Modeling Prep](https://site.financialmodelingprep.com/register) | gratis sleutel (`FMP_KEY`) |
| Volglijst (aandelen die je niet hebt), agenda in Google Agenda | Financial Modeling Prep | gratis sleutel (`FMP_KEY`) |
| Nieuws per aandeel, wat analisten vinden, koersdoel, nieuwsstemming, kwartaalverrassingen, insiderhandel | [Finnhub](https://finnhub.io/register) | gratis sleutel (`FINNHUB_KEY`); koersdoel en stemming alleen als je abonnement ze toestaat |
| Bedrijfscijfers over meerdere jaren (omzet, winst, marge) | [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | je e-mailadres als contact (`SEC_CONTACT`) |
| Euro-dollarkoers en dollar-blootstelling | ECB via [Frankfurter](https://frankfurter.dev/) | niets (staat standaard aan) |
| Rendement na inflatie | [ECB Data Portal](https://data.ecb.europa.eu/main-figures/inflation) (HICP) | niets (staat standaard aan) |
| Wat als alles in de S&P 500 of Nasdaq-100 had gezeten; risico van indexfondsen | [FRED](https://fred.stlouisfed.org/) (SP500, NASDAQ100) | niets (staat standaard aan) |
| Werkelijke spreiding via de samenstelling van indexfondsen | iShares holdings-CSV | niets; als iShares het bestand niet aan de Worker geeft, voeg je het zelf toe op *Plannen* |

## Wat er in de repository staat

- `worker/`: de Cloudflare Worker (meten, opslaan, externe bronnen, `/api/data` voor de website). Zie [worker/README.md](worker/README.md).
- `docs/`: de website (GitHub Pages), zonder externe bibliotheken:
  - **Overzicht**: grafiek van de totale waarde, kerncijfers (klik op Accountwaarde voor de verdeling), 2 stijgers, de markt en 2 dalers, agenda, sectoren, valuta en koopkracht, weken, patronen en statistieken.
  - **Bedrijven**: alle posities als tegels met grafiek, zoeken, filteren en sorteren.
  - **Bedrijfspagina** (`#bedrijf/TICKER`): grafiek, positie, valuta-effect, transacties, historie, agenda, nieuws, analisten, insiderhandel, bedrijfscijfers, sector en vergelijkbare bedrijven, patronen.
  - **Plannen**: streefverdeling met inlegadvies, vooruitblik, werkelijke spreiding, stand op 1 januari, export naar CSV.
  - Eigen indeling op de telefoon, installeerbaar als app, en zonder verbinding de laatst geladen stand.
- `apps-script/`: de oudere versie als Google Sheet (optioneel). Via de website kun je die geschiedenis eenmalig overnemen in de Worker.

Er staan geen sleutels of portefeuillegegevens in deze repository. Alles staat in je eigen Cloudflare-account; de toegangscode voor de website alleen in je eigen browser.
