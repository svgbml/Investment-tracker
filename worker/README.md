# Investeringstracker zonder Google Sheets (Cloudflare Worker)

Deze Worker doet hetzelfde als het Apps Script, maar zonder Google Sheet:

- elke 10 minuten op werkdagen van 08:00 tot 22:30 (Amsterdamse tijd) je posities ophalen uit de Trading 212 API;
- per uur en per dag open, slot, laagste, hoogste en gemiddelde waarde bewaren;
- metingen per 10 minuten na 3 dagen verwijderen (pas nadat ze per uur zijn samengevat);
- elke zaterdag rond 09:00 een weeksnapshot: accountwaarde, netto stortingen, cash en kostprijs;
- de gegevens via `/api/data` aan de website leveren, alleen met je toegangscode.

De gegevens staan in een eigen Cloudflare D1-database. Je Trading 212-sleutel en je toegangscode staan als geheimen bij Cloudflare, niet in deze repository.

## Installeren via het Cloudflare-dashboard

1. **Account:** maak een gratis account aan op [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Database:** ga naar *Storage & databases → D1* en maak een database met de naam `investment-tracker`. Kopieer het **Database ID**.
3. **Tabellen:** open de database, ga naar *Console*, plak de inhoud van [`schema.sql`](schema.sql) en klik op *Execute*.
4. **Database ID invullen:** zet het ID in [`wrangler.toml`](wrangler.toml) op de plek van `VUL-HIER-HET-DATABASE-ID-IN` en commit dat. (Het ID is niet geheim.)
5. **Worker koppelen aan GitHub:** ga naar *Workers & Pages → Create → Import a repository*, kies `svgbml/Investment-tracker` en zet de *root directory* op `worker`. Cloudflare bouwt en publiceert de Worker bij elke push.
6. **Geheimen:** open de Worker, ga naar *Settings → Variables and Secrets* en voeg drie variabelen van het type *Secret* toe:
   - `T212_KEY`: je Trading 212 API key (alleen leesrechten);
   - `T212_SECRET`: je Trading 212 API secret;
   - `WEB_TOKEN`: een lange willekeurige code die je zelf kiest; dit wordt je toegangscode voor de website.
7. **Testen:** het adres van je Worker staat bovenaan in het dashboard, bijvoorbeeld `https://investment-tracker.JOUWNAAM.workers.dev`. Open in je browser `…/api/data?token=JOUW_WEB_TOKEN`; je ziet dan JSON met `"ok":true`.
8. **Website:** open de website, kies *Instellingen*, vul je `WEB_TOKEN` in als toegangscode en zet onder *Ander adres van de web-app gebruiken* het adres `https://investment-tracker.JOUWNAAM.workers.dev/api/data`.

## Handige adressen

Alle adressen vragen je toegangscode, als `?token=…` of als header `Authorization: Bearer …`.

| Wat | Methode en adres |
|---|---|
| Gegevens voor de website | `GET /api/data` |
| Nu een meting doen (test) | `POST /api/run` |
| Nu een weeksnapshot maken | `POST /api/snapshot` |
| Openstaande opname invoeren | `POST /api/pending` met `{"amount": 154.65}` |
| Openstaande opnames bekijken / wissen | `GET` / `DELETE /api/pending` |
| Eenmalig gegevens uit de sheet overnemen | `POST /api/import` met `{"url": "<Apps Script /exec-adres>", "token": "<code van de sheet>"}` |

Voorbeeld in PowerShell:

```powershell
$h = @{ Authorization = "Bearer JOUW_WEB_TOKEN" }
Invoke-RestMethod -Method Post -Headers $h -Uri "https://investment-tracker.JOUWNAAM.workers.dev/api/run"
```

## Grenzen

- Cloudflare Workers (gratis) is ruim genoeg: ongeveer 88 korte runs per werkdag.
- De Worker kan oude weken niet terugrekenen met historische koersen, zoals de sheet met Google Finance doet. Neem die weken eenmalig over met `/api/import`.
- De uurgegevens die via `/api/import` binnenkomen zijn die van de laatste 31 dagen, zoals de sheet ze aanbiedt.
