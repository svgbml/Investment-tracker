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
| Gegevens voor de website | `GET /api/data` |
| Nu een meting doen (test) | `POST /api/run` |
| Nu een weeksnapshot maken | `POST /api/snapshot` |
| Openstaande opname invoeren | `POST /api/pending` met `{"amount": 154.65}` |
| Openstaande opnames bekijken / wissen | `GET` / `DELETE /api/pending` |
| Agenda nu bijwerken (dividenden, kwartaalcijfers) | `POST /api/events` |
| Orders (aan- en verkopen) nu ophalen | `POST /api/orders` |
| Samenstelling van de indexfondsen nu ophalen / zelf toevoegen | `POST /api/etf` / `POST /api/etf-upload` met `{"key": "SP500" of "NDX", "csv": "…"}` |
| Instellingen van de site (streefverdeling, inleg, doel) | `GET` / `POST /api/settings` |
| Status van koppelingen en functies | `GET /api/features` (alleen waar een sleutel staat, nooit de sleutel zelf) |
| Sleutel opslaan of wissen | `POST /api/keys` met `{"name": "FINNHUB_KEY", "value": "…"}` (lege waarde wist) |
| Functie zonder sleutel aan/uit | `POST /api/features` met `{"features": {"fx": true, "inflation": true, "sec": true, "etfAuto": true}}` |
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

## Grenzen

- Cloudflare Workers (gratis) is ruim genoeg: ongeveer 88 korte runs per werkdag.
- De Worker kan oude weken niet terugrekenen met historische koersen, zoals de sheet met Google Finance doet. Neem die weken eenmalig over met `/api/import`.
- De uurgegevens die via `/api/import` binnenkomen zijn die van de laatste 31 dagen, zoals de sheet ze aanbiedt.
