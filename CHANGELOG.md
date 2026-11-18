# Wat er veranderde

Per versie, in de woorden van de commits. Dit bestand wordt gemaakt met `node tools/changelog.mjs`; pas het niet met de hand aan.

## v57 — 2026-11-18

- Analisten per sector en door de tijd

## v56 — 2026-11-17

- Animaties hersteld (balk schuift mee bij paginawissel, streepje onder het menu schuift weer), volglijstkop compacter en op de risicopagina suggesties die de spreiding verbreden met positieve analisten en nieuws

## v55 — 2026-11-17

- Orderscherm toont vrij saldo (met waarschuwing bij te weinig geld), risico van het aandeel op de schaal 1–7 en wat analisten vinden, met hun koersdoel

## v54 — 2026-11-17

- Computer: menu en knoppen in één witte balk (op Overzicht onder de grafiek, blijft bij scrollen staan) en de site gebruikt de volle schermbreedte

## v53 — 2026-11-17

- Menu op de computer als witte balk onder de grafiek, alles gecentreerd, geen gloed onder grafieken, leesbare stemmingskaart en ouder nieuws laden

## v52 — 2026-11-17

- App-pictogram voor Android: alleen de witte lijn op een doorzichtige achtergrond, zodat startschermen met een eigen thema (glazen bellen) de lijn tonen in plaats van een grijs blok
- Analyse en Plannen: vraagteken bij elk begrip, knoppen − en + bij streefverdeling, inleg en vooruitblik, en de streefverdeling per positie onder elkaar op de telefoon
- Bedrijfspagina in de nieuwe indeling: op de telefoon één doorlopende pagina met kop per onderdeel en knoppen onder de grafiek; kopen en verkopen ook in de kop op de computer
- Figtree-lettertype in de site zelf (met licentie) in plaats van via Google Fonts; werkt ook offline
- Pictogram op het beginscherm kiezen: glas, doorzichtig met witte lijn, donker, blauw of licht (geldt na opnieuw installeren)
- Bedrijfspagina en volglijst: rustige grafiek zonder vulling; knoppen vorige en volgende passend in beide thema's
- Nieuw ontwerp: typemeldingen opgelost en basislijn bijgewerkt

## v51 — 2026-11-17

- Instellingen als volledige pagina: lijst met onderdelen en per onderdeel een eigen scherm
- Analyse en Plannen: op de telefoon tabbladen per onderdeel in plaats van één lange pagina
- Nieuws: stemmingskaart (analisten tegenover nieuws) die de nieuwslijst filtert, en tabbladen Nieuws, Analisten en Insiders op de telefoon
- Bedrijven: compacte tabel per sector met grafiekjes en sorteerbare kolommen en tabbladen op de telefoon; verdelingsbalk op de computer
- Nieuw startscherm met taalkeuze en voorbeeldkaart; alle teksten van het startscherm vertaald
- Nieuw ontwerp, deel 1: witte bovenkant, rustige grafiek, kleine balk bij scrollen en alle blokken op Overzicht op de telefoon

## v50 — 2026-11-17

- Sleutels die als Cloudflare-geheim staan zijn nu via de site te vervangen (en terug te zetten)

## v49 — 2026-11-17

- Alle transacties op de telefoon: regels even hoog en tekst afgekapt in plaats van over elkaar

## v48 — 2026-11-17

- Kopen en verkopen vanuit de app (optioneel, standaard uit) met bevestiging, grenzen per order en per dag en annuleren

## v47 — 2026-11-17

- App-icoon in glasstijl (met eenkleurige versie) en keuzebalken op de telefoon op één regel

## v46 — 2026-11-17

- Manifest-verwijzing terugzetten als een filter die weghaalt, en dat tonen in de installatiecontrole
- Typecontrole: installatiepaneel zonder nieuwe typemeldingen (basislijn 330)

## v45 — 2026-11-17

- Vrij saldo bij elke meting in plaats van alleen in de weekmeting, zodat de accountwaarde klopt na een aankoop

## v44 — 2026-11-17

- Instellingen: controle voor installeren (browser, service worker, manifest, meldingen)

## v43 — 2026-11-17

- App-manifest: vaste app-id en icoondoel voor installeren op Android

## v42 — 2026-11-17

- Instellingen-knop toont nu een tandwiel in plaats van een zonnetje

## v41 — 2026-11-17

- Analyse-pagina, rekenhulpen, marktonderzoek en gemak
- Worker: maatstaf, SEC-deponeringen, 13F, economische agenda, pies, verbruik per bron, foutlog, meetgeschiedenis, R2-kopie en ochtendmelding

## v40 — 2026-11-17

- Herstel: volgen vanuit de suggesties bleef op "Bezig…" hangen
- Site: zoeken, statuspagina, reservekopie, koersalarmen, doelen en vloeiender animaties

## v38 — 2026-11-16

- Herstel: gegevens laden met je eigen Worker liep vast (knoppen niet gevonden)
- Worker: reeksen los met alleen nieuwe regels, status, reservekopie, waakhond, koersalarmen, herinnering inleg, doelen, bedrijven zoeken en koershistorie via Twelve Data
- Sneller laden (twee delen, alleen wat veranderde, alleen de zichtbare pagina), meldingen, optionele weekmail, deel-link, geschiedenis uit CSV, herbalanceren, Plannen als componenten, reservebronnen en automatische controles
- Worker-tests met nep-API's en een database in het geheugen; draaien voor elke deploy
- WIP: Worker-upgrades (nog niet af, niet live)
- Site opgesplitst in genummerde bestanden met eigen bouwstenen (weergaven, veilige sjablonen); nieuwspagina gebouwd met Preact-componenten
- Volglijst: tien suggesties om te volgen in plaats van zes
- Alpha Vantage als reserve voor Finnhub: nieuws, stemming, analisten, koersdoel, kwartaalcijfers en insiderhandel worden aangevuld als Finnhub ze niet levert
- Volglijst: koersen van nieuwe volgaandelen worden meteen opgehaald in plaats van achteraan de wachtrij; onbekend symbool krijgt een melding
- Inloggen op een nieuw apparaat met je Trading 212-sleutel: de Worker herkent de sleutel en alle koppelingen werken meteen
- Nieuwspagina, analisten en volgsuggesties, inleg-assistent, scenario's, dividendkalender, box 3, kosten, aankoopdagboek, vergelijken, waardering, overlap met fondsen, weekoverzicht delen, andere rekeningen, Engels, updates en instelbare animaties
- AGENTS.md: werkafspraken voor AI-agents in deze repository
- Animaties: tegels klappen zonder sprong uit en in, pagina's lopen in elkaar over; kleine tekstfouten hersteld
- Ingeklapte tegels: grafiek en labels altijd volledig zichtbaar, y-as zo nodig samengedrukt
- Panelen: gelijke hoogte per rij, uitklappen door op de tegel te klikken met animatie, hoekjes als hint; risico per bedrijf met uitleg en rustigere alternatieven
- Functies bekijken zonder sleutel, inklapbare panelen op de beginpagina en minder lege ruimte
- README: uitklapweergaven
- Uitklapweergaven: duidelijker tekst bij Overig en inleg in fondsen
- Uitklapweergaven: risico met rekenvoorbeelden om het te verlagen, opbouw van het resultaat en stortingen

## v24 — 2026-11-16

- Cache-
