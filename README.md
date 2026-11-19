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

**Op een ander apparaat inloggen.** Al je sleutels staan in je Worker, niet in de browser. Op een nieuwe browser of telefoon kies je op de website *Inloggen met je Trading 212-sleutel*: vul je Worker-adres, API-sleutel en secret in. De Worker herkent de sleutel, geeft dat apparaat toegang en alle andere koppelingen werken meteen. De toegangscode invullen kan ook.

Daarna meet de Worker op werkdagen elke 10 minuten (08:00–22:30), maakt hij elke zaterdag een weekoverzicht en haalt hij je orders en dividenden op. De tabellen in de database maakt hij zelf aan.

Lukt de knop niet? Dan kan het ook met de hand: zie [worker/README.md](worker/README.md).

## Extra functies aanzetten

Zet ze aan op de website onder *Instellingen → Koppelingen en functies*. Sleutels gaan naar je eigen Worker en worden nooit teruggestuurd naar de browser. Wie ze liever bij Cloudflare bewaart, zet ze daar als *Secret* met dezelfde naam; die gaan dan voor.

| Functie | Bron | Wat je nodig hebt |
|---|---|---|
| Posities, weken, orders, dividend, valuta-effect, statistieken, plannen | Trading 212 | API-sleutel en secret (vereist) |
| Risico-indicatie (1 tot 7) met rekenvoorbeelden om het risico te verlagen, opbouw van je resultaat, overzicht van stortingen, wat beweegt samen, jaaroverzicht (ook als PDF), mijlpalen, bedragen verbergen, donkere modus | Trading 212 (berekend op de site) | niets extra |
| Inleg-assistent (wat kopen voor je streefverdeling en een lagere risicoklasse), scenario's (tech −20%, dollar −10%, eerdere crashes), dividendkalender per maand met groei per aandeel, belastinghulp box 3 (waarde 1 januari, dividend, bronbelasting), kostenoverzicht, aankoopdagboek, twee aandelen vergelijken, overlap met je indexfondsen, weekoverzicht delen als afbeelding of e-mail (ook zonder bedragen), andere rekeningen of brokers (met de hand of CSV), Engels, animaties aan/uit, updates binnen de app | Trading 212 (berekend op de site) | niets extra |
| Overzicht: periode van de grote grafiek (vandaag, 1 week, 30 dagen, dit jaar, 1 jaar, alles) die je apparaat onthoudt, met een vergelijkingslijn van je maatstaf of je netto inleg; één regel in gewone taal over vandaag; strook met de drie grootste stijgers en dalers; volgend dividend met aftelling; mijlpalen met een klein feestje; stortingen op rij; rustige modus (geen dagveranderingen, alleen maandresultaten) | Trading 212 (berekend op de site); maatstaf via FRED of de koershistorie van de Worker | niets extra |
| Risicopagina: schuif met "wat als" gewicht van de ene positie naar de andere en zie klasse, beweeglijkheid en spreiding meebewegen; stresstests met ruwe dalingen per sector uit 2008, 2020 en 2022; verdeling over munten met het effect van een dollar die 10% zakt; overlap tussen je indexfondsen; details per paar in de warmtekaart | Trading 212 (berekend op de site); fondssamenstelling uit de CSV van iShares | niets extra |
| Analyse: waar je resultaat vandaan komt per sector en per munt, rollend rendement, dalingen met hersteltijd, kostenrem (kosten tegenover je resultaat), doorkijk per bedrijf, sector en land, wisselkosten vooruit bij je huidige tempo, en de pagina als rapport afdrukken of opslaan als pdf | Trading 212 (berekend op de site); sector en land via FMP | niets extra |
| Meldingen op je telefoon of computer: grote koersbewegingen, kwartaalcijfers van morgen, bestuurders die kopen, verdeling die afwijkt van je doel | je eigen Worker (Web Push) | niets extra; op iPhone alleen in de geïnstalleerde app |
| Weekoverzicht per e-mail (optioneel, staat standaard uit) | [Resend](https://resend.com/signup) | gratis sleutel (`RESEND_KEY`) en je adres (`MAIL_TO`) |
| Deel-link: iemand anders bekijkt je portefeuille, alleen lezen en desgewenst zonder bedragen, eventueel met einddatum; alle links in één keer intrekken | je eigen Worker | niets extra |
| Deelplaatje van je maand (alleen percentages, geen bedragen) en vergelijken met de deel-link van iemand anders, ook alleen in percentages | Trading 212 (getekend in de browser); vergelijken via je eigen Worker | niets extra |
| Meldingen rustiger: stille uren, bundelen tot één melding per dag en een logboek van wat er verstuurd is | je eigen Worker | niets extra |
| Privacy en veiligheid: zoeken in de instellingen, privacyscherm (waas als de app naar de achtergrond gaat), snel verbergen met twee vingers of Ctrl+Shift+H, eigen code per apparaat met "uitloggen op alle apparaten", logboek van sleutelwijzigingen, inlogpogingen, orders en links, functies in ontwikkeling op één plek, en je voorkeuren meenemen naar een ander apparaat | je eigen Worker | niets extra |
| Volledige geschiedenis inlezen uit de CSV-export van Trading 212 (ook de echte bronbelasting) | Trading 212 | niets extra |
| Reservebronnen als een bron zijn limiet bereikt of hapert (ECB, Eurostat, Finnhub, Alpha Vantage, Twelve Data); bij Koppelingen zie je welke in gebruik is | diverse | werkt beter met meer sleutels |
| Statuspagina (laatste meting, welke bronnen werken) en een melding als de metingen een paar keer achter elkaar mislukken | je eigen Worker | niets extra |
| Reservekopie van je gegevens downloaden en terugzetten (zonder sleutels) | je eigen Worker | niets extra |
| Eigen koersalarmen per aandeel (boven of onder een koers), meerdere doelen, dividend-sneeuwbal, kosten (TER) van je fondsen vergeleken, inleg per maand met herinnering op de 25e | Trading 212 en je eigen Worker | niets extra |
| Bedrijven zoeken bij het toevoegen aan je volglijst; onbekende symbolen worden gemeld en zijn met één klik weg te halen | SEC-bedrijvenlijst en Finnhub | niets extra; Finnhub (`FINNHUB_KEY`) vindt ook Europese aandelen |
| Koersgrafieken voor aandelen die FMP niet gratis geeft | [Twelve Data](https://twelvedata.com/register) | gratis sleutel (`TWELVEDATA_KEY`), optioneel; anders Alpha Vantage |
| Analyse: echt rendement (XIRR en TWR, per positie en totaal), eigen maatstaf (S&P 500, Nasdaq-100, MSCI World, FTSE All-World, Europa, Nederland of een eigen symbool), grootste daling, Sharpe, Sortino, Calmar en beta, bijdrage per positie, kalender van een heel jaar, twee periodes vergelijken, gerealiseerd en ongerealiseerd, wisselkosten per jaar en munt, concentratiegrenzen met melding, jaar in beeld | Trading 212 (berekend op de site); maatstaf via FRED of de koershistorie van de Worker | niets extra |
| Plannen: kans om je doelen te halen (Monte Carlo, in een aparte thread), FIRE, maandelijks inleggen terugrekenen, dividend herbeleggen, herbalanceren met verkopen, rente over je vrije saldo, box 3 nu tegenover werkelijk rendement | Trading 212; rente uit de CSV-export | niets extra |
| Plannen, deel 2: twee plannen naast elkaar, alle vooruitblikken in euro's van vandaag (na inflatie), gebeurtenissen in je tijdlijn (huis, studie, auto), uitleg bij de kansberekening met een fan-grafiek, herbalanceren als afvinklijst (plaatst nooit zelf orders), dividendinkomen per maand met rendement op inleg, box 3 per jaar met peildatum-export en bronbelasting per land, spaargeld en contant met de hand, netto vermogen door de tijd, potjes per doel, maandelijks inleggen vanaf een datum | Trading 212, ECB (inflatie) en FRED (indexen); spaargeld is je eigen invoer | niets extra |
| Marktoverzicht (indexen, VIX, rente VS, ECB-depositorente, euro-dollar) | FRED en de ECB | niets; met `FRED_KEY` betrouwbaarder |
| Economische agenda: rentebesluiten ECB en Fed, publicaties van inflatie, banen en groei in de VS, met een filter op wat jouw munten of landen raakt | vergaderkalenders en [FRED](https://fred.stlouisfed.org/docs/api/api_key.html) | `FRED_KEY` voor de publicaties uit de VS |
| Deponeringen bij de SEC (jaar- en kwartaalverslagen, 8-K), 13F van grote beleggers, insiders die samen kopen, koersreactie op kwartaalcijfers | SEC EDGAR, Finnhub | `SEC_CONTACT`; insiders via `FINNHUB_KEY` |
| Screener en ETF-zoeker | profielen en waardering van de Worker; vaste lijst bekende fondsen | werkt beter met `FMP_KEY` of `FINNHUB_KEY` |
| Trading 212-pies met rendement per pie | Trading 212 | de sleutel moet de pies mogen lezen |
| Volglijst met labels (met aantallen en een filter), notitie met datum ("waarom volg ik dit") en koopzone; nieuws met gedempte bronnen en een ochtendmelding | je eigen Worker | niets extra |
| Bedrijvenlijst in te delen per sector, land, munt of pie, met subtotalen, in- en uitklapbare groepen en een grafiekje van 30 dagen per rij | Trading 212; land en sector via FMP | niets extra; `FMP_KEY` voor land en sector |
| Per aandeel: elke aankoop apart met het resultaat sinds die aankoop, kostprijs gemiddeld of FIFO (ter informatie), een dagboek met datums en een eigen koersdoel naast dat van analisten | Trading 212 (berekend op de site) | niets extra |
| Koersalarm vanaf een rij of vanaf je eigen koersdoel, al ingevuld; de Worker kijkt er tijdens de meettijden naar | je eigen Worker | niets extra |
| Volglijst vullen met een geplakte lijst of CSV-export, met een voorbeeld van wat erbij komt | SEC-bedrijvenlijst en Finnhub | niets extra |
| Tickerkaart: wijs een beurssymbool aan (of druk lang op een telefoon) voor koers, verandering, je deel en wat analisten vinden | Trading 212, Finnhub | niets extra |
| Alle transacties in één lijst, export naar Excel (.xlsx) en JSON, uitleg van begrippen, pagina's aanpassen, snel zoeken (Ctrl+K) en sneltoetsen, vegen en omlaag trekken op de telefoon, teller op het app-icoon, compact, grotere tekst en kleurenblindvriendelijk, rondleiding, Duits en Frans, inzoomen in grafieken | de site zelf | niets extra |
| Weergave *Vandaag* (waarde, resultaat van vandaag, grootste bewegingen en wat eraan komt) met een widget op het beginscherm waar de browser die ondersteunt; snelkoppelingen van de app naar Vandaag, Order, Nieuws en Risico | de site zelf (de service worker vult de widget met de laatste stand) | niets extra |
| Snel zoeken (Ctrl+K) vindt ook acties, instellingen en weergave-opties; pagina's aanpassen met slepen, verbergen en een tegelgrootte per sectie | de site zelf | niets extra |
| Melding als je de bewaarde stand ziet, met hoe oud die is; instellingen die je zonder verbinding wijzigt gaan later alsnog naar de Worker | de site zelf | niets extra |
| Een artikel of ticker vanuit een andere app delen met de tracker en op je volglijst zetten | de geïnstalleerde app (share target) | niets extra |
| Korte trilling bij bevestigen en wisselen (staat uit), en een optioneel slot met vingerafdruk of gezicht per apparaat (WebAuthn) | de site zelf | een apparaat met vingerafdruk, gezicht of pincode |
| Toegankelijkheid: alles met het toetsenbord (pijltjes in keuzeknoppen, rijen met Enter), elke grafiek ook als tabel en als samenvatting in woorden, meldingen voor schermlezers, eenvoudige taal, dyslexievriendelijke weergave, leermodus met uitleg en een quiz, en steun voor hoog contrast van Windows | de site zelf | niets extra |
| Statuspagina met verbruik per bron, meetgeschiedenis van 30 dagen en fouten van de website | je eigen Worker | niets extra |
| Gemak: kaartje *Wat is er nieuw* na een update, label "3 u oud" bij verouderde gegevens, knop *Naar inhoud* voor het toetsenbord, knop naar de juiste sleutel bij een lege tegel, vastgezette tabelkoppen, een getal kopiëren (rechtsklik of lang indrukken) en opnieuw openen op de laatst bekeken pagina | de site zelf | niets extra |
| Snelle start: de laatst getekende beginpagina staat er direct, nog voor de gegevens geladen zijn; zonder verbinding geeft de service worker de laatst binnengekomen stand | de site zelf | niets extra |
| Kopen en verkopen vanuit de app (markt- en limietorders, openstaande orders annuleren), standaard uit, met een grens per order en per dag. Invoer in aantal, bedrag of percentage (25, 50, 75 of 100% van je positie of je vrije saldo); verkopen gaat standaard als deel van je positie van dit moment, of als vast bedrag | Trading 212 | een sleutel met het recht om orders te plaatsen; aanzetten bij Koppelingen |
| Dagelijkse reservekopie buiten de database (7 dagkopieën en 4 weekkopieën, met een voorbeeld vóór terugzetten) | [Cloudflare R2](https://developers.cloudflare.com/r2/) | een R2-bucket met binding `BACKUP` (zie worker/README.md); zonder bucket werkt de rest gewoon |
| Bronnenpagina: per bron een tijdlijn van 30 dagen (in orde, limiet, fout), wanneer een bron weer wordt geprobeerd, het budget per bron van vandaag en de geschatte ruimte in de database | je eigen Worker | niets extra |
| Sleutel testen met één proefvraag aan de bron (*Testen* bij Koppelingen); de sleutel wordt niet opgeslagen en niet getoond | je eigen Worker | de bron waarvoor je test |
| Controle op onmogelijke waarden (koers 0, negatief aantal, koerssprong boven 80% zonder splitsing) en het verwerken van splitsingen en nieuwe tickers in je geschiedenis | Trading 212 | niets extra |
| Reserve voor het marktnieuws op de nieuwspagina als Finnhub niets geeft | Alpha Vantage (NEWS_SENTIMENT) | gratis sleutel (`ALPHAVANTAGE_KEY`), optioneel |
| Orderscherm: wat de order met je portefeuille doet (gewicht, sector en risicoklasse daarna), een tweede bevestiging bij orders vanaf 10% van je beleggingen, en een extra controle met een PIN op dit apparaat als je een tijd geen order bevestigd hebt (zonder PIN stel je er bij de eerste order een in; je Trading 212-sleutel is er niet voor nodig) |
| Nu controleren: je positie of je vrije saldo van dit moment bij Trading 212, op de bedrijfspagina, bij Accountwaarde en in het orderscherm | Trading 212 | niets extra |
| Wijziging van vandaag, stijgers en dalers, de lijn van vandaag en dagrendementen tellen alleen de koersbeweging: bijkopen of verkopen is geen stijging of daling (ook in de melding bij een grote koersbeweging) | Trading 212 | niets extra | Trading 212 (berekend op de site) | niets extra |
| Oefenmodus: orders tegen de koersen die de tracker kent in een eigen oefenboek; er gaat nooit iets naar Trading 212 en het orderscherm is dan oranje | de site en je eigen Worker | niets extra, ook zonder orderrecht |
| Orders met hun reden, met na een half jaar de vraag of die reden nog klopt; beslisdagboek met jaaroverzicht; vragenlijst "moet ik verkopen?" (alleen vragen, geen advies) | je eigen Worker | niets extra |
| Warmtekaart van je posities en volglijst (vlak zo groot als het gewicht, kleur naar de beweging) en sectorrotatie over 1, 3 en 6 maanden | sectorcijfers en koersen van de Worker | werkt beter met `FMP_KEY` |
| Wekelijkse reservekopie buiten de database | [Cloudflare R2](https://developers.cloudflare.com/r2/) | een R2-bucket met binding `BACKUP` (zie worker/README.md) |
| Waardering: koers-winstverhouding en dividendrendement tegenover de eigen geschiedenis en de sector | Financial Modeling Prep | gratis sleutel (`FMP_KEY`); zonder waarderingsdata rekent de site de K/W uit SEC-cijfers |
| Nieuwspagina met marktnieuws, analisten per bedrijf, betrouwbaarheid van analisten en suggesties, insiderhandel | Finnhub | gratis sleutel (`FINNHUB_KEY`) |
| Risicopagina: bedrijven van je volglijst die je spreiding verbreden (andere sector of anders bewegend) en waar analisten en nieuws positief over zijn | Finnhub, FMP | gratis sleutels (`FINNHUB_KEY`, `FMP_KEY`) |
| Nieuwsarchief: ouder nieuws per aandeel, elke ronde een maand verder terug tot een jaar (knop *Ouder nieuws laden*) | Finnhub | gratis sleutel (`FINNHUB_KEY`) |
| Analisten per sector en door de tijd: alle analisten per sector samen, en wat er in een dag, week, maand of drie maanden veranderde (de Worker bewaart de stand elke dag als die verandert) | Finnhub of Alpha Vantage | gratis sleutel (`FINNHUB_KEY`) |
| Limieten bij elke koppeling (Instellingen): hoe dicht elke bron bij zijn limiet zit, en hoeveel van de gratis daglimiet van je Worker en database (D1: gelezen en geschreven rijen) vandaag gebruikt is | je eigen Worker | niets extra |
| Reserves per functie: bij een limiet of storing neemt een andere bron het over (koershistorie FMP → Twelve Data → Alpha Vantage; profielen, vergelijkbare bedrijven en agenda FMP → Finnhub; nieuws en analisten en marktnieuws Finnhub → Alpha Vantage; koersalarmen Finnhub → Twelve Data; zoeken Finnhub → Twelve Data; indexen FRED → FMP; wisselkoers en inflatie ECB → reserve). Overzicht bij Instellingen > Koppelingen | de sleutels die je hebt | gratis sleutels |
| Spaarstand van de Worker: bij 70% van de gratis daglimiet van de database een melding, vanaf 85% tot middernacht (UTC) minder vaak opbouwen en verversen; metingen gaan door | je eigen Worker | niets extra |
| Nieuws van meer bronnen over hetzelfde bericht gebundeld ("4 bronnen", uitklapbaar); toon (positief, negatief, neutraal) uit een woordenlijst met gewichten in het Engels en Nederlands, met ontkenningen, en in de tooltip de woorden die de toon bepaalden | Finnhub | gratis sleutel (`FINNHUB_KEY`) |
| Nieuws dempen per bron, per aandeel of op een woord in de kop | je eigen Worker | niets extra |
| Analisten door de tijd op de bedrijfspagina: deel kopen en koersdoel per dag, met de laatste wijzigingen | Finnhub | gratis sleutel (`FINNHUB_KEY`) |
| Stemming van analisten per sector als kleurstrook op het overzicht | Finnhub | gratis sleutel (`FINNHUB_KEY`) |
| Scorebord: hoe vaak eerdere koersdoelen (minstens drie maanden oud) de goede kant op wezen, per sector | Finnhub | gratis sleutel (`FINNHUB_KEY`) |
| Cijferseizoen: posities en volglijst die de komende vier weken met kwartaalcijfers komen, met verwachting, de gewone koerssprong en de verrassingen erna | FMP (agenda), Finnhub (verwachting en verrassing) | gratis sleutels (`FMP_KEY`, `FINNHUB_KEY`) |
| "Wat heb ik gemist": sinds je vorige bezoek op dit apparaat de koersbewegingen, het nieuws, de analistenwijzigingen en het ontvangen dividend (`#gemist`) | je eigen Worker | niets extra |
| Meldingen als analisten binnen een week van mening veranderen over een aandeel dat je hebt, en als een grote belegger (13F) in zo'n aandeel stapt of afbouwt | Finnhub, SEC EDGAR | `FINNHUB_KEY`, `SEC_CONTACT` en meldingen aan |
| Suggesties om te volgen | FMP (vergelijkbare bedrijven) en de samenstelling van je indexfondsen | gratis sleutel (`FMP_KEY`) of een fondsbestand |
| Agenda (kwartaalcijfers, dividenden), sector en branche, vergelijkbare bedrijven | [Financial Modeling Prep](https://site.financialmodelingprep.com/register) | gratis sleutel (`FMP_KEY`) |
| Volglijst (aandelen die je niet hebt), agenda in Google Agenda | Financial Modeling Prep | gratis sleutel (`FMP_KEY`) |
| Nieuws per aandeel, wat analisten vinden, koersdoel, nieuwsstemming, kwartaalverrassingen, insiderhandel | [Finnhub](https://finnhub.io/register) | gratis sleutel (`FINNHUB_KEY`); koersdoel en stemming alleen als je abonnement ze toestaat |
| Reserve voor Finnhub: vult nieuws, stemming, analisten, koersdoel, kwartaalcijfers en insiderhandel aan als Finnhub ze niet levert | [Alpha Vantage](https://www.alphavantage.co/support/#api-key) | gratis sleutel (`ALPHAVANTAGE_KEY`), optioneel; 25 verzoeken per dag, dus een paar aandelen per dag |
| Bedrijfscijfers over meerdere jaren (omzet, winst, marge) | [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | je e-mailadres als contact (`SEC_CONTACT`) |
| Euro-dollarkoers en dollar-blootstelling | ECB via [Frankfurter](https://frankfurter.dev/) | niets (staat standaard aan) |
| Rendement na inflatie | [ECB Data Portal](https://data.ecb.europa.eu/main-figures/inflation) (HICP) | niets (staat standaard aan) |
| Wat als alles in de S&P 500 of Nasdaq-100 had gezeten; risico van indexfondsen | [FRED](https://fred.stlouisfed.org/) (SP500, NASDAQ100) | niets; weigert FRED de download aan je Worker, dan een [gratis FRED-sleutel](https://fred.stlouisfed.org/docs/api/api_key.html) (`FRED_KEY`) |
| Werkelijke spreiding via de samenstelling van indexfondsen | iShares holdings-CSV | niets; als iShares het bestand niet aan de Worker geeft, voeg je het zelf toe op *Plannen* |
| Startchecklist op het overzicht (sleutel, nieuws, volglijst, doel, alarm, app; weg te klikken en terug te zetten bij *Weergave*), kruimelpad op detailpagina's, meldingen bij gelukt en mislukt, foutteksten die zeggen wat je kunt doen, plaatshouders tijdens het laden, bedragen afgekort (€ 12,3K) of met 0, 1 of 2 decimalen, afdrukken op A4 (detailpagina's en *Analyse*), drie kolommen vanaf 1800 pixels | de site zelf | niets extra |

## Wat er in de repository staat

- `worker/`: de Cloudflare Worker (meten, opslaan, externe bronnen, `/api/data` voor de website). Zie [worker/README.md](worker/README.md).
- `docs/`: de website (GitHub Pages), zonder build-stap. De code staat in `docs/js/` in genummerde bestanden die op volgorde laden, met een paar eigen bouwstenen (`00-kern.js` en `15-ui.js`: meldingen, plaatshouders, kruimelpad, getalweergave, foutteksten en de startchecklist). De nieuwspagina is gebouwd met Preact-componenten; Preact staat zelf in `docs/vendor/`, zodat de app ook zonder verbinding werkt:
  - **Overzicht**: grafiek van de totale waarde, kerncijfers (klik op Accountwaarde voor de verdeling), 2 stijgers, de markt en 2 dalers, agenda, sectoren, valuta en koopkracht, weken, patronen en statistieken.
  - **Bedrijven**: alle posities als tegels met grafiek, zoeken, filteren en sorteren.
  - **Bedrijfspagina** (`#bedrijf/TICKER`): grafiek, positie, valuta-effect, transacties, historie, agenda, nieuws, analisten, insiderhandel, bedrijfscijfers, sector en vergelijkbare bedrijven, patronen.
  - **Bedrijven** heeft ook een knop om twee aandelen te vergelijken, een waarderingstabel en suggesties om te volgen.
  - **Nieuws**: nieuws over je posities, volglijst en de markt (berichten over hetzelfde onderwerp gebundeld), analisten per bedrijf met betrouwbaarheid, meningen per sector, het cijferseizoen, het scorebord van koersdoelen, suggesties volgens analisten en insiderhandel. Met een knop naar *Wat heb ik gemist* (`#gemist`).
  - **Analyse** (`#analyse`; op de telefoon het tabblad Analyse): rendement en risico, marktoverzicht, economische agenda, screener, ETF-zoeker, SEC-deponeringen, 13F, alle transacties en begrippen.
  - **Plannen**: streefverdeling, inleg-assistent, vooruitblik, scenario's, dividendkalender, belastinghulp box 3, kostenoverzicht, aankoopdagboek, overlap met fondsen, werkelijke spreiding, andere rekeningen, weekoverzicht delen, export naar CSV.
  - **Instellingen**: thema, animaties (automatisch, aan of uit; "automatisch" volgt "minder beweging" van je apparaat), taal (Nederlands, Engels, Duits of Frans), leesbaarheid (compact, grotere tekst, kleurenblindvriendelijk), rondleiding en sneltoetsen, openen op de laatst bekeken pagina, installeren als app en controleren op updates.
  - **Plannen**: streefverdeling, inleg-assistent, vooruitblik, scenario's, dividendkalender, belastinghulp box 3, kostenoverzicht, aankoopdagboek, overlap met fondsen, werkelijke spreiding, andere rekeningen, weekoverzicht delen, export naar CSV, plannen vergelijken, gebeurtenissen in je tijdlijn, herbalanceerlijst, spaargeld, netto vermogen en potjes per doel.
  - **Instellingen**: thema, animaties (automatisch, aan of uit; "automatisch" volgt "minder beweging" van je apparaat), taal (Nederlands, Engels, Duits of Frans), leesbaarheid (compact, grotere tekst, kleurenblindvriendelijk), rondleiding en sneltoetsen, installeren als app en controleren op updates.
  - Eigen indeling op de telefoon, installeerbaar als app, en zonder verbinding de laatst geladen stand.
- `CHANGELOG.md`: wat er per versie veranderde, gemaakt uit de commitberichten met `node tools/changelog.mjs`. De korte versie voor in de app staat in `WHATS_NEW` (`docs/js/21-handig.js`); die regels verschijnen na een update één keer als kaartje op het overzicht.
  - **Instellingen**: thema, animaties (automatisch, aan of uit; "automatisch" volgt "minder beweging" van je apparaat), taal (Nederlands, Engels, Duits of Frans), leesbaarheid (compact, grotere tekst, kleurenblindvriendelijk, eenvoudige taal, dyslexievriendelijk en leermodus), rondleiding en sneltoetsen, installeren als app en controleren op updates.
  - Eigen indeling op de telefoon, installeerbaar als app, en zonder verbinding de laatst geladen stand.
  - **Toegankelijkheid**: alles is met het toetsenbord te bedienen (pijltjes in keuzeknoppen, Enter op een rij, Escape sluit een venster), elke lijngrafiek heeft een samenvatting in woorden en een knop *Tabel*, de focus gaat na een paginawissel naar de kop en blijft in een dialoogvenster, en de site werkt met hoog contrast van Windows. Zie *Instellingen, Weergave* voor eenvoudige taal, de dyslexievriendelijke weergave en de leermodus.
- `tools/`: de controles die bij elke push draaien (syntaxis en namen, typen, de site in een echte browser met
  voorbeeldgegevens, rekenwerk en opmaak, toegankelijkheid, schermafbeeldingen). Zie [tools/README.md](tools/README.md)
  voor wat elk script doet en hoe je ze zelf draait. De componentengalerij op
  [`?gallery`](https://svgbml.github.io/Investment-tracker/?gallery) laat elke tegel en knop met voorbeeldgetallen zien.
- `apps-script/`: de oudere versie als Google Sheet (optioneel). Via de website kun je die geschiedenis eenmalig overnemen in de Worker.

Er staan geen sleutels of portefeuillegegevens in deze repository. Alles staat in je eigen Cloudflare-account; de toegangscode voor de website alleen in je eigen browser.
