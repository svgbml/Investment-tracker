# Investeringstracker zonder Google Sheets (Cloudflare Worker)

Deze Worker doet hetzelfde als het Apps Script, maar zonder Google Sheet:

- elke 10 minuten op werkdagen van 08:00 tot 22:30 (Amsterdamse tijd) je posities ophalen uit de Trading 212 API;
- per uur en per dag open, slot, laagste, hoogste en gemiddelde waarde bewaren;
- metingen per 10 minuten na 3 dagen verwijderen (pas nadat ze per uur zijn samengevat);
- elke zaterdag rond 09:00 een weeksnapshot: accountwaarde, netto stortingen, cash en kostprijs;
- de gegevens via `/api/data` aan de website leveren, alleen met je toegangscode.

De gegevens staan in een eigen Cloudflare D1-database. Je Trading 212-sleutel en je toegangscode staan als geheimen bij Cloudflare, niet in deze repository.

## Installeren

De makkelijkste weg is de knop *Deploy to Cloudflare* in de [hoofd-README](../README.md#zelf-installeren). Met de hand gaat het zo:

1. **Account:** maak een gratis account aan op [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Database:** ga naar *Storage & databases → D1* en maak een database met de naam `investment-tracker`. Zet het **Database ID** in [`wrangler.toml`](wrangler.toml) bij `database_id` (het ID is niet geheim). De tabellen maakt de Worker zelf aan.
3. **Worker koppelen aan GitHub:** ga naar *Workers & Pages → Create → Import a repository*, kies je kopie van deze repository en zet de *root directory* op `worker`. Cloudflare bouwt en publiceert de Worker bij elke push.
4. **Toegangscode:** open de Worker, ga naar *Settings → Variables and Secrets* en voeg `WEB_TOKEN` toe als type *Secret* (niet onder *Build*). Dat is het enige geheim dat bij Cloudflare moet staan.
5. **Website:** open de website, vul bij *Instellingen* het adres van de Worker (eindigt op `/api/data`) en je `WEB_TOKEN` in, en vul daarna onder *Koppelingen en functies* je Trading 212-sleutel in.

Sleutels die je via de website invult, bewaart de Worker in de tabel `kv` van je eigen database en stuurt hij nooit terug. Liever bij Cloudflare? Zet ze daar als *Secret* met dezelfde naam (`T212_KEY`, `T212_SECRET`, `FMP_KEY`, `FINNHUB_KEY`, `SEC_CONTACT`); die gaan altijd voor. Let op: een nieuw geheim bij Cloudflare wordt bij een Worker die vanuit GitHub wordt gebouwd pas actief bij de volgende build.

## Handige adressen

Alle adressen vragen je toegangscode, als `?token=…` of als header `Authorization: Bearer …`.

| Wat | Methode en adres |
|---|---|
| Gegevens voor de website, in delen met vingerafdruk (ETag): `core` (posities, weken), `extra` (markt, onderzoek, koersen) en `series` (metingen). Met `If-None-Match` geeft de Worker 304 als er niets veranderd is. `part=core&split=1` laat de metingen weg; `part=series&since=<ms>` geeft alleen metingen na dat moment (de site bewaart de rest in IndexedDB). Zonder `part` alles samen. De toegangscode gaat in de kop `Authorization: Bearer …` | `GET /api/data?part=core&split=1` / `?part=extra` / `?part=series&since=…` |
| Status: laatste meting, mislukte metingen op rij, gezondheid van de bronnen | `GET /api/status` |
| Reservekopie (zonder sleutels of toegangscodes), per tabel in pagina's van 2000 rijen; zonder `table` het overzicht | `GET /api/backup?table=weeks&offset=0` |
| Reservekopie terugzetten, per pagina; `done: true` bij de laatste pagina bouwt de gegevens opnieuw op | `POST /api/restore` met `{"table": "weeks", "rows": [[…]], "done": false}` |
| Bedrijf zoeken op naam of symbool (SEC-lijst, ETF's, Finnhub) | `GET /api/search?q=apple` |
| Order plaatsen (alleen als *Kopen en verkopen* aanstaat): markt of limiet, met eigen id tegen dubbel versturen; de Worker controleert je grens per order en per dag en of je genoeg stuks hebt om te verkopen | `POST /api/trade/order` met `{"side": "BUY" \| "SELL", "type": "market" \| "limit", "ticker": "AAPL_US_EQ", "quantity": 0.5, "limitPrice": 210, "validity": "DAY" \| "GTC", "estEur": 100, "clientId": "…"}` |
| Openstaande orders, de laatste orders via de app en je gebruik van vandaag | `GET /api/trade/orders` |
| Openstaande order annuleren | `POST /api/trade/cancel` met `{"id": 123}` |
| Instrument van Trading 212 zoeken (voor aandelen die je nog niet hebt) | `GET /api/trade/instruments?q=nvda` |
| Fout op de website melden (de site doet dit zelf; hoogstens 30 bewaard, zonder bedragen) | `POST /api/log` met `{"msg": "…", "src": "js/16-analyse.js", "line": 12, "ver": "v41"}` |
| Nu een meting doen (test) | `POST /api/run` |
| Nu een weeksnapshot maken | `POST /api/snapshot` |
| Openstaande opname invoeren | `POST /api/pending` met `{"amount": 154.65}` |
| Openstaande opnames bekijken / wissen | `GET` / `DELETE /api/pending` |
| Agenda nu bijwerken (dividenden, kwartaalcijfers) | `POST /api/events` |
| Orders (aan- en verkopen) nu ophalen | `POST /api/orders` |
| Samenstelling van de indexfondsen nu ophalen / zelf toevoegen | `POST /api/etf` / `POST /api/etf-upload` met `{"key": "SP500" of "NDX", "csv": "…"}` |
| Inloggen op een nieuw apparaat met de Trading 212-sleutel en -secret die al in de Worker staan; geeft de toegangscode terug (zonder toegangscode, max. 10 mislukte pogingen per uur) | `POST /api/login` |
| Instellingen van de site (streefverdeling, inleg, doelen `goals`, volglijst, koersalarmen `priceAlerts`, herinnering inleg `depositReminder`, notities bij aankopen `notes`, andere rekeningen `accounts`) | `GET` / `POST /api/settings` |
| Status van koppelingen en functies, met `health`: welke bron tijdelijk uit staat en welke reserve het werk doet | `GET /api/features` (alleen waar een sleutel staat, nooit de sleutel zelf) |
| Meldingen: openbare sleutel en regels, apparaat aan- of afmelden, testmelding | `GET /api/push/key`, `POST /api/push/subscribe` met `{"sub": …}`, `POST /api/push/unsubscribe`, `POST /api/push/test` |
| Weekmail nu als test sturen (optioneel, Resend) | `POST /api/mail/test` |
| Deel-link (alleen lezen) maken, vernieuwen, met of zonder bedragen, uitzetten | `GET` / `POST /api/share` met `{"action": "on" \| "rotate" \| "off" \| "update", "amounts": false}` |
| Gedeelde weergave (zonder toegangscode, met geheime link) | `GET /share/<token>` |
| Geschiedenis uit een Trading 212-export inlezen (de site leest de CSV) | `POST /api/import-csv` met `{"orders": […], "dividends": […]}` |
| Sleutel opslaan of wissen | `POST /api/keys` met `{"name": "FINNHUB_KEY", "value": "…"}` (lege waarde wist) |
| Functie aan/uit | `POST /api/features` met `{"features": {"fx": true, "inflation": true, "sec": true, "etfAuto": true, "indices": true, "weeklyMail": false}}` (`weeklyMail` staat standaard uit) |
| Agenda-link (iCal) maken, vernieuwen of uitzetten | `POST /api/calendar` met `{}`, `{"rotate": true}` of `{"off": true}` |
| Agenda als iCal-bestand (zonder toegangscode, met geheime link) | `GET /cal/<token>.ics` |
| Sector- en vergelijkingsgegevens: taken klaarzetten en afwerken | `POST /api/market?plan=1&steps=3` (zonder `plan` alleen afwerken) |
| Eenmalig gegevens uit de sheet overnemen | `POST /api/import` met `{"url": "<Apps Script /exec-adres>", "token": "<code van de sheet>"}` |

Voorbeeld in PowerShell:

```powershell
$h = @{ Authorization = "Bearer JOUW_WEB_TOKEN" }
Invoke-RestMethod -Method Post -Headers $h -Uri "https://investment-tracker.JOUWNAAM.workers.dev/api/run"
```

## Agenda: dividenden en kwartaalcijfers

Eén keer per dag (05:17 UTC, tweede cron in `wrangler.toml`) haalt de Worker:

- je ontvangen dividenden uit Trading 212 (`/api/v0/equity/history/dividends`);
- als `FMP_KEY` is ingesteld: per aandeel (fondsen overgeslagen) de volgende datum van kwartaalcijfers met de verwachte winst per aandeel, de vorige cijfers, en aangekondigde dividenden (`/stable/earnings` en `/stable/dividends` van FMP). Dat zijn 2 verzoeken per aandeel; het gratis abonnement staat 250 verzoeken per dag toe.

De website rekent daaruit een verwacht volgend dividend (zelfde tussenpoos als je eerdere uitkeringen, bedrag geschaald naar je huidige aantal). Tickers die bij FMP anders heten staan in `SYMBOL_MAP` in `src/index.js` (bijvoorbeeld `FB` → `META`).

Sleutel toevoegen: maak een gratis account bij FMP, kopieer je API-sleutel uit het dashboard en voeg hem in Cloudflare toe als *Secret* met de naam `FMP_KEY` (*Settings → Variables and Secrets*, type Secret, niet onder Build). Bijwerken zonder te wachten: `POST /api/events`. Let op: bij een Worker die vanuit GitHub wordt gebouwd, wordt een nieuw geheim pas actief bij de volgende build (of als je in *Deployments* de versie met het geheim uitrolt).

## Sector en vergelijkbare bedrijven

Na de agenda zet de Worker elke ochtend taken klaar die hij buiten de meettijden (per 10 minuten maximaal 30 verzoeken) afwerkt:

- per aandeel het profiel bij FMP (sector, branche, beurswaarde, beta, jaarbereik, koers) en, één keer per week, tot 5 vergelijkbare bedrijven met hun profiel;
- de gemiddelde koersverandering per sector en per branche (eerste keer 20 handelsdagen terug, daarna 1 per dag);
- koershistorie van een jaar voor aandelen waar het gratis abonnement die geeft; voor de rest bouwt de Worker die dag voor dag op uit het profiel.

Gegevens staan in de tabellen `ext_profile`, `ext_peers`, `ext_prices` en `ext_perf` (maakt de Worker zelf aan). Alle FMP-verzoeken samen blijven onder 230 per dag (`fmp_calls` in de tabel `kv`).

## Orders, valuta, peildatum en fondssamenstelling

- **Orders:** buiten de meettijden haalt de Worker één keer per dag de uitgevoerde orders op (de eerste keer de hele geschiedenis, daarna de nieuwste 100). Per order: aantal, prijs, wisselkoers, bedrag, gerealiseerd resultaat en kosten (tabel `orders`).
- **Valuta-effect:** bij elke meting bewaart de Worker per positie de gemiddelde aankoopprijs, de valuta en het valuta-effect (`fxImpact`) van Trading 212 (`pos_extra` in `kv`).
- **Peildatum:** op 1 januari legt de Worker de stand van beleggingen en vrij saldo vast (`peil_JAAR` in `kv`).
- **Werkelijke spreiding:** de samenstelling van de S&P 500 en de Nasdaq-100 komt uit de holdings-CSV van iShares (CSPX en CNDX); ETF's op dezelfde index (zoals VUAG en SXRV) worden daarmee doorgerekend. De Worker probeert het bestand wekelijks op te halen; weigert iShares dat, voeg het dan zelf toe op de pagina Plannen (`POST /api/etf-upload`).

## Nieuws, analisten, bedrijfscijfers, valuta en inflatie

Na de agenda zet de Worker elke ochtend taken klaar die hij buiten de meettijden afwerkt (per 10 minuten maximaal 30 externe verzoeken):

- **Finnhub** (`FINNHUB_KEY`), per aandeel: nieuws van de laatste 10 dagen, aanbevelingen van analisten, de laatste 4 kwartaalverrassingen en insiderhandel van de laatste 6 maanden. Onderdelen die niet in je abonnement zitten (status 403) slaat hij daarna over.
- **SEC EDGAR** (`SEC_CONTACT`, wekelijks): omzet, nettowinst, bedrijfsresultaat en winst per aandeel per kalenderjaar uit de XBRL-gegevens (`companyconcept`). Elk verzoek draagt `investment-tracker (jouw e-mailadres)` als User-Agent, zoals de SEC vraagt. Alleen bedrijven die bij de SEC rapporteren.
- **Euro-dollarkoers** (geen sleutel): ECB-referentiekoersen van 400 dagen via Frankfurter.
- **Inflatie** (geen sleutel): HICP-index (2025 = 100) van de ECB voor Nederland en de eurozone.
- **Indexen**: S&P 500 en Nasdaq-100 (koersindex, zonder dividend) van FRED, zonder sleutel via de downloadlink of met `FRED_KEY` via de officiële API, voor "wat als alles in de index had gezeten" en als koershistorie voor de risicoberekening van indexfondsen.
- **Koersdoel en nieuwsstemming** (Finnhub `price-target` en `news-sentiment`), als je abonnement ze toestaat.
- **Alpha Vantage** (`ALPHAVANTAGE_KEY`, optioneel), reserve voor Finnhub: per aandeel `OVERVIEW` (analisten, gemiddeld koersdoel), `NEWS_SENTIMENT`, `EARNINGS` en `INSIDER_TRANSACTIONS`, alleen voor onderdelen die Finnhub niet levert (geen sleutel, ongeldige sleutel, niet in het abonnement of al twee dagen niet bijgewerkt). Dagbudget 24 verzoeken (`av_calls` in `kv`), één aandeel per stap. Welke onderdelen van Alpha Vantage komen staat in `src` per aandeel.
- **SEC EDGAR, deponeringen en 13F** (met `SEC_CONTACT`): elke dag per stap hoogstens 5 bedrijven uit `data.sec.gov/submissions` (jaar- en kwartaalverslagen, 8-K), en één keer per week de laatste 13F-opgave van vier bekende beleggers (Berkshire Hathaway, Pershing Square, Scion, Bridgewater). Het CIK-nummer komt uit de bedrijvenlijst.
- **FRED, extra reeksen**: naast de S&P 500 en de Nasdaq-100 ook de VIX (`VIXCLS`), de Amerikaanse 10-jaarsrente (`DGS10`) en de ECB-depositorente (`ECBDFR`). Met `FRED_KEY` ook de publicatiedata van inflatie, banen, groei en de Fed voor de economische agenda.
- **Trading 212-pies**: één keer per dag de lijst, en per keer van 4 pies de naam en verdeling (Trading 212 staat 1 verzoek per 5 seconden toe).
- **Maatstaf**: het symbool dat je op de site kiest (`settings.benchmark`) krijgt koershistorie en een profiel zoals een volgaandeel, maar geen meldingen.
- **Rente over je vrije saldo** komt alleen uit de CSV-export (`POST /api/import-csv` met `interest`), want de API geeft die niet.
- **Verbruik**: elk extern verzoek telt per bron en per dag (14 dagen); de statuspagina toont het naast de grenzen van de gratis abonnementen. De Worker houdt ook per dag bij hoeveel metingen lukten (30 dagen).
- **Ochtendmelding**: zet je die op de nieuwspagina aan, dan stuurt de Worker op werkdagen rond 08:00 één melding met het nieuws van de afgelopen dag over je aandelen.
- **Uurgegevens** blijven 180 dagen bewaard (daarna alleen de dagregels); metingen per 10 minuten worden na 3 dagen uren.
- **Twelve Data** (`TWELVEDATA_KEY`, optioneel), reserve voor koershistorie: geeft FMP een 402 (niet in het gratis plan), dan haalt de Worker de dagkoersen bij Twelve Data (hoogstens 6 per stap), zonder sleutel bij Alpha Vantage. Wekelijks haalt de Worker ook de bedrijvenlijst van de SEC op voor het zoeken op de volglijst.
- **Marktnieuws** (Finnhub `news?category=general`), één keer per dag, voor de nieuwspagina (`marketNews` in `/api/data`). Per aandeel bewaart de Worker ook wekelijks het gemiddelde koersdoel (`targetHist`), zodat de site later kan nagaan of koersdoelen uitkwamen.
- **Waardering** (FMP `ratios-ttm` en `ratios`, per aandeel één keer per week; `sector-pe-snapshot` één keer per dag): koers-winstverhouding en dividendrendement, in `market.valuation` en `market.sectorPe`. Geeft FMP 402 (niet in het abonnement), dan stopt de Worker ermee (`val_denied`) en rekent de site de K/W uit SEC-cijfers.
- **Reservebronnen**: lukt een bron niet of zit hij aan zijn limiet, dan schakelt de Worker over en houdt hij dat bij in `kv` `src_health` (de site toont het bij Koppelingen). Wisselkoersen: Frankfurter, anders het ECB Data Portal. Inflatie: ECB, anders Eurostat. Indexen: FRED, anders FMP. Profielen (koers, branche, beta, jaarbereik): FMP, anders Finnhub. Koersgeschiedenis: FMP, anders Alpha Vantage. Kwartaalcijfers: FMP, anders Finnhub. Nieuws en analisten: Finnhub, anders Alpha Vantage. Weekmail: Resend, anders een pushmelding. Na een limiet blijft de bron tot middernacht (UTC) uit; na drie andere fouten zes uur.
- **Meldingen** (Web Push, zonder externe dienst): de Worker maakt zijn eigen sleutelpaar (VAPID, `kv` `vapid`) en versleutelt elke melding (RFC 8291). Regels in `settings.alerts`: koersbeweging vanaf `move` % (het totaal vanaf de helft), kwartaalcijfers van morgen, aankopen door bestuurders, afwijking van je streefverdeling vanaf `drift` procentpunt (na de weeksnapshot). Elke melding één keer per dag of gebeurtenis.
- **Weekmail** (optioneel): zaterdag na de weeksnapshot, via Resend (`RESEND_KEY`, `MAIL_TO`, optioneel `MAIL_FROM`). Zonder eigen domein mailt Resend alleen naar het adres van je Resend-account. `settings.mailAmounts = false` stuurt alleen procenten.
- **Opruimen**: op de eerste dagelijkse cron van elke maand verdwijnen uurregels ouder dan 400 dagen en koersen en sectordagen ouder dan 420 dagen. Dagregels, weken, posities en orders blijven.
- **Tests**: `npm test` (of `node test/run.mjs`) test de Worker met nep-API's en een database in het geheugen; Cloudflare draait ze vóór elke deploy (`[build]` in `wrangler.toml`).
- **Volglijst**: symbolen uit `settings.watchlist` (maximaal 20) krijgen dezelfde gegevens als je posities: profiel, koersen, agenda en Finnhub/SEC.

## Agenda in Google Agenda

`POST /api/calendar` maakt een geheime link `…/cal/<token>.ics` met kwartaalcijfers en aangekondigde dividenddata. Voeg hem in Google Agenda toe via *Andere agenda's → Via URL*. Google haalt zo'n agenda zelf op, meestal een paar keer per dag. Met `{"rotate": true}` werkt de oude link niet meer.

## Risico-indicatie

De site rekent de indicatie zelf uit. De indeling volgt de Europese SRRI-klassen (1 tot 7) op basis van de jaarlijkse beweeglijkheid (volatiliteit): onder 0,5%, 2%, 5%, 10%, 15% en 25% en daarboven. Gebruikt worden de dagrendementen in euro van je huidige verdeling over het laatste jaar (koersen van FMP, FRED voor indexfondsen, anders je eigen metingen); is er voor minder dan 60% van je waarde koershistorie, dan je eigen weekrendementen. Het is een indicatie, geen officiële SRRI (die gebruikt 5 jaar weekrendementen).

## Kopen en verkopen (optioneel)

Staat standaard uit. Zet het aan bij *Instellingen, Koppelingen, Kopen en verkopen* en stel daar je grens per order en per dag in (standaard € 500 en € 1.000). Je Trading 212-sleutel moet het recht hebben om orders te plaatsen; maak daarvoor in de Trading 212-app een nieuwe sleutel en sla die op bij Koppelingen.

- Elke order zie je eerst met aantal, geschatte prijs en wisselkosten, en je bevestigt hem zelf. Er zijn geen automatische orders.
- De Worker verstuurt een order nooit twee keer (eigen id per order, geen automatische nieuwe poging bij een fout) en logt elke order (laatste 50).
- Volgens de documentatie van Trading 212 ondersteunt de echte omgeving via de API mogelijk alleen marktorders; een limietorder geeft dan een foutmelding van Trading 212.
- Oefenen kan met een sleutel van de oefenomgeving en `T212_BASE = "https://demo.trading212.com"` in `wrangler.toml` (dan meet de tracker ook die oefenrekening).

## Reservekopie naar Cloudflare R2 (optioneel)

Maak in Cloudflare een R2-bucket (bijvoorbeeld `tracker-backup`) en voeg in `wrangler.toml` toe:

```toml
[[r2_buckets]]
binding = "BACKUP"
bucket_name = "tracker-backup"
```

Elke zondag zet de Worker dan een volledige kopie (zonder sleutels of toegangscodes) in de bucket als `backup-JJJJ-MM-DD.json`; de laatste acht blijven bewaard. Zo'n bestand kun je op de website terugzetten bij Instellingen. Zonder binding gebeurt er niets. Voeg de binding pas toe als de bucket bestaat, anders mislukt de deploy.

## Grenzen

- Cloudflare Workers (gratis) is ruim genoeg: ongeveer 88 korte runs per werkdag.
- De Worker kan oude weken niet terugrekenen met historische koersen, zoals de sheet met Google Finance doet. Neem die weken eenmalig over met `/api/import`.
- De uurgegevens die via `/api/import` binnenkomen zijn die van de laatste 31 dagen, zoals de sheet ze aanbiedt.
