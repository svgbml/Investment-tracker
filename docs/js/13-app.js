/* Investeringstracker – Engels, inloggen met de Trading 212-sleutel, animaties, updates
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Engels (vertaling van menu's, koppen, knoppen en labels) ----------
const EN = {
  'Overzicht': 'Overview', 'Bedrijven': 'Companies', 'Plannen': 'Plans', 'Nieuws': 'News', 'Statistieken': 'Statistics', 'Instellingen': 'Settings',
  'Investeringstracker': 'Investment tracker', 'Waarde beleggingen': 'Investments value', 'Agenda': 'Calendar', 'Sectoren': 'Sectors', 'Valuta en koopkracht': 'Currency and purchasing power',
  'Risico': 'Risk', 'Weken': 'Weeks', 'Patronen': 'Patterns', 'Volglijst': 'Watchlist', 'Vandaag': 'Today', '3 dagen': '3 days', '30 dagen': '30 days', 'Alles': 'All', 'Alle': 'All',
  'Gestegen': 'Up', 'Gedaald': 'Down', 'Verandering': 'Change', 'Waarde': 'Value', 'Sinds aankoop': 'Since purchase', 'Naam': 'Name', 'Toon': 'Show', 'Sorteer': 'Sort', 'Grafiek': 'Chart',
  'Accountwaarde': 'Account value', 'Netto gestort': 'Net deposited', 'Totaal resultaat': 'Total result', 'Ongerealiseerd': 'Unrealised', 'Stortingen': 'Deposits', 'Opbouw': 'Breakdown', 'Per positie': 'Per position', 'Verdeling': 'Allocation',
  'Kwartaalcijfers': 'Earnings', 'Dividend dat eraan komt': 'Upcoming dividends', 'Ontvangen dividend': 'Dividends received', 'Verdeling per sector': 'Allocation by sector', 'Jij tegenover de sector': 'You versus the sector', 'Sectoren in de markt': 'Sectors in the market',
  'Euro en dollar': 'Euro and dollar', 'Na inflatie': 'After inflation', 'Risico-indicatie': 'Risk indicator', 'Waar het risico vandaan komt': 'Where the risk comes from', 'Wat beweegt samen': 'What moves together',
  'Resultaat per dag': 'Result per day', 'Wanneer beweegt het?': 'When does it move?', 'Per weekdag': 'By weekday', 'Hoe groot zijn de dagbewegingen?': 'How big are the daily moves?',
  'Streefverdeling': 'Target allocation', 'Vooruitblik': 'Outlook', 'Mijlpalen': 'Milestones', 'Jaaroverzicht': 'Annual overview', 'Werkelijke spreiding': 'True diversification', 'Exporteren': 'Export', 'Stand op 1 januari': 'Value on 1 January',
  'Wat als alles in de index had gezeten': 'What if everything had been in the index',
  'Maandelijkse inleg-assistent': 'Monthly deposit assistant', "Scenario's": 'Scenarios', 'Dividendkalender, komende 12 maanden': 'Dividend calendar, next 12 months', 'Dividendkalender': 'Dividend calendar', 'Belastinghulp box 3': 'Tax helper (box 3)',
  'Kostenoverzicht': 'Cost overview', 'Minder vaak, grotere aankopen': 'Fewer, larger purchases', 'Laatste orders': 'Latest orders', 'Aankoopdagboek': 'Purchase journal', 'Overlap met je fondsen': 'Overlap with your funds', 'Ook in je fondsen': 'Also in your funds',
  'Weekoverzicht delen': 'Share weekly overview', 'Weekoverzicht': 'Weekly overview', 'Andere rekeningen en brokers': 'Other accounts and brokers', 'Alle rekeningen samen': 'All accounts together', 'Waardering': 'Valuation',
  'Vergelijken': 'Compare', 'Kies twee aandelen': 'Pick two stocks', 'Koers, laatste jaar': 'Price, last year', 'Naast elkaar': 'Side by side', 'Twee aandelen vergelijken': 'Compare two stocks',
  'Suggesties volgens analisten': 'Suggestions based on analysts', 'Analisten per bedrijf': 'Analysts per company', 'Hoe betrouwbaar zijn de analisten?': 'How reliable are the analysts?', 'Insiderhandel, laatste 6 maanden': 'Insider trading, last 6 months', 'Insiderhandel': 'Insider trading',
  'Analisten': 'Analysts', 'Insiders': 'Insiders', 'Suggesties om te volgen': 'Suggestions to follow', 'Volgen': 'Follow', 'Wat analisten vinden': 'What analysts think', 'Koersdoel': 'Price target', 'Stemming in het nieuws': 'News sentiment', 'Bedrijfscijfers per jaar': 'Financials per year', 'Bedrijfscijfers': 'Financials',
  'Positie': 'Position', 'Historie': 'History', 'Onderzoek': 'Research', 'Vergelijk': 'Compare', 'Dagbereik binnen de historie': 'Daily range within history', 'Aankoop, valuta en transacties': 'Purchase, currency and transactions', 'Laatste transacties': 'Latest transactions',
  'Sector en branche': 'Sector and industry', 'Tegenover branche en sector': 'Versus industry and sector', 'Vergelijkbare bedrijven': 'Comparable companies', 'Nieuws, analisten en cijfers': 'News, analysts and financials', 'Sector en vergelijkbare bedrijven': 'Sector and comparable companies',
  '← Terug': '← Back', '‹ Terug': '‹ Back', 'Terug': 'Back', 'Opslaan': 'Save', 'Annuleren': 'Cancel', 'Kopiëren': 'Copy', 'Delen': 'Share', 'Afbeelding opslaan': 'Save image', 'Per e-mail': 'By email', 'Rekening toevoegen': 'Add account', 'Regel toevoegen': 'Add row',
  'CSV inlezen': 'Import CSV', 'Rekening verwijderen': 'Delete account', 'Doelen opslaan': 'Save targets', 'Gelijk verdelen': 'Split evenly', 'Huidige verdeling als doel': 'Use current allocation', 'Bewaren': 'Save', 'Bewaren als PDF': 'Save as PDF', 'Installeren': 'Install',
  'Meer tonen': 'Show more', 'Minder tonen': 'Show less', 'Mijn aandelen': 'My stocks', 'Markt': 'Market', 'Per sector': 'By sector', 'Ik stort': 'I deposit', 'Bedrag': 'Amount', 'Inleg per maand': 'Monthly deposit', 'Doelbedrag (optioneel)': 'Goal amount (optional)',
  'Notitie bewerken': 'Edit note', 'Waarom gekocht? Notitie toevoegen': 'Why did you buy? Add a note', 'Koop': 'Buy', 'Verkoop': 'Sell', 'Stijger': 'Riser', 'Daler': 'Faller', 'Stijgers': 'Risers', 'Dalers': 'Fallers', 'Beste': 'Best', 'Zwakste': 'Weakest',
  'Aangekondigd': 'Announced', 'Verwacht': 'Expected', 'In bezit': 'Held', 'Dit bedrijf': 'This company', 'Fout': 'Error', 'Aan': 'On', 'Uit': 'Off', 'Licht': 'Light', 'Donker': 'Dark', 'Automatisch': 'Automatic', 'Weergave': 'Display', 'Animaties': 'Animations', 'Taal': 'Language',
  'Toegangscode': 'Access code', 'Adres van je Worker': 'Your Worker address', 'Koppelingen en functies': 'Connections and features', 'Code vergeten': 'Forget code', 'Opslaan en laden': 'Save and load', 'Als app op je telefoon of computer': 'As an app on your phone or computer',
  'Updates': 'Updates', 'Controleren op updates': 'Check for updates', 'Nu bijwerken': 'Update now', 'Later': 'Later', 'Gebruiken': 'Use', 'Wissen': 'Clear', 'Meer': 'More',
  'Sector': 'Sector', 'Branche': 'Industry', 'Beurswaarde': 'Market cap', 'Koers': 'Price', 'Beta': 'Beta', 'Dividendrendement': 'Dividend yield', 'Koers-winstverhouding': 'Price/earnings ratio', 'Koers-winstverhouding nu': 'P/E now', 'Eigen gemiddelde': 'Own average',
  'Dividendrendement nu': 'Dividend yield now', 'Dividendrendement gemiddeld': 'Average dividend yield', 'Nettomarge': 'Net margin', 'Omzetgroei, laatste jaar': 'Revenue growth, last year', 'Beweeglijkheid per jaar': 'Volatility per year', 'Risicoklasse (1–7)': 'Risk class (1–7)',
  'Grootste daling, laatste jaar': 'Largest drop, last year', 'Analisten: kopen': 'Analysts: buy', 'Koersdoel tegenover koers': 'Target versus price', 'Betrouwbaarheid analisten': 'Analyst reliability', 'Los in bezit': 'Held directly', 'Samen': 'Together', 'Deel via fondsen': 'Share via funds',
  'Beleggingen nu': 'Investments now', 'Vrij saldo': 'Free cash', 'Resultaat nu': 'Result now', 'Posities': 'Positions', 'Grootste positie': 'Largest position', 'In cijfers': 'In numbers', 'Verdeling over posities': 'Allocation over positions', 'Soort belegging': 'Type of investment',
  'Winst en verlies per positie': 'Profit and loss per position', 'Gerealiseerd en kosten': 'Realised and costs', 'Waar je resultaat vandaan komt': 'Where your result comes from', 'Rendement': 'Return', 'Per maand': 'Per month', 'Inleg tegenover waarde': 'Deposits versus value',
  'Alle stortingen en opnames': 'All deposits and withdrawals', 'Wat het risico verlaagt': 'What lowers the risk', 'Wat een slecht jaar kan betekenen': 'What a bad year can mean',
  'Inleg en doelen': 'Deposits and goals', 'Wat als': 'What if', 'Dividend en belasting': 'Dividends and tax', 'Kosten en aankopen': 'Costs and purchases', 'Spreiding en rekeningen': 'Diversification and accounts', 'Delen en exporteren': 'Share and export',
  'Aandeel': 'Stock', 'Uitkering': 'Payout', 'Volgende': 'Next', 'Komende 12 mnd': 'Next 12 months', 'Groei per aandeel': 'Growth per share', 'Land': 'Country', 'Netto': 'Net', 'Bruto': 'Gross', 'Bronbelasting': 'Withholding tax', 'Jaar': 'Year', 'Orders': 'Orders',
  'Omgezet': 'Traded', 'Kosten': 'Costs', 'Per order': 'Per order', 'Bedrijf': 'Company', 'Los': 'Direct', 'Aanbevelingen': 'Recommendations', 'Kopen': 'Buy', 'Trend': 'Trend', 'Betrouwbaarheid': 'Reliability', 'K/W nu': 'P/E now', 'Dividend nu': 'Dividend now', 'Gemiddeld': 'Average',
  'per maand': 'monthly', 'per kwartaal': 'quarterly', 'per halfjaar': 'semi-annual', 'per jaar': 'annual', 'hoog': 'high', 'gemiddeld': 'average', 'laag': 'low', 'verkocht': 'sold', 'geschat': 'estimated', 'sinds aankoop': 'since purchase', 'volglijst': 'watchlist',
  'Zonder bedragen (alleen procenten)': 'Without amounts (percentages only)', 'Effect op je beleggingen': 'Effect on your investments', 'Waarde daarna': 'Value afterwards', 'Laatste 12 maanden': 'Last 12 months', 'Per order gemiddeld': 'Average per order', 'Waarvan wisselkosten': 'Of which FX fees',
  'rendement deze week': 'return this week', 'accountwaarde': 'account value', 'Eerste aandeel': 'First stock', 'Tweede aandeel': 'Second stock', 'Naast een ander aandeel zetten': 'Compare with another stock',
  'Nieuws en analisten': 'News and analysts', '▲ Positief': '▲ Positive', '▼ Negatief': '▼ Negative', '● Neutraal': '● Neutral', 'Mijn tracker koppelen': 'Connect my tracker', 'Functies bekijken met voorbeeldgetallen': 'Explore with sample data',
};
// Nieuw in js/21-handig.js: naar inhoud, wat er nieuw is, ouderdom van gegevens, lege tegels, kopiëren
Object.assign(EN, {
  // Risico en Analyse: wat als, stresstests, valuta, overlap, bijdrage, rollend rendement, herstel, kosten en doorkijk
  'Wat als je anders verdeelt': 'What if you allocate differently', 'Van': 'From', 'Naar': 'To', 'Hoeveel verschuiven': 'How much to shift', 'Terug naar nu': 'Back to now',
  'Risicoklasse': 'Risk class', 'Spreiding (even grote posities)': 'Diversification (equally sized positions)', 'Slechte dag (1 op 20)': 'Bad day (1 in 20)',
  'Stresstests: wat deden sectoren in slechte jaren': 'Stress tests: how sectors fared in bad years', 'Effect 2008': 'Impact 2008', 'In welke munt zit je geld': 'Which currency your money is in',
  'Munt': 'Currency', 'Niet in euro': 'Not in euro', 'Als de dollar 10% minder waard wordt': 'If the dollar loses 10%', 'Als de dollar 10% meer waard wordt': 'If the dollar gains 10%',
  'Overlap in je fondsen': 'Overlap within your funds', 'Samen': 'Together', 'Deel': 'Share', 'Waar je resultaat vandaan komt': 'Where your result comes from',
  'Ongerealiseerd resultaat': 'Unrealised result', 'Waarvan door de koersen': 'Of which from prices', 'Waarvan door de wisselkoers': 'Of which from the exchange rate',
  'Door de wisselkoers': 'From the exchange rate', 'Door de koers': 'From the price', 'Deel van het resultaat': 'Share of the result',
  'Rollend rendement': 'Rolling return', 'Beste periode': 'Best period', 'Slechtste periode': 'Worst period', 'Periodes met winst': 'Periods with a gain',
  'Dalingen en herstel': 'Drops and recovery', 'Vanaf de top': 'From the peak', 'Diepste punt': 'Lowest point', 'Daling': 'Drop', 'Dagen omlaag': 'Days down',
  'Hersteld': 'Recovered', 'Dagen herstel': 'Days to recover', 'Aantal dalingen': 'Number of drops', 'Nog niet hersteld': 'Not yet recovered', 'Herstel duurde meestal': 'Recovery usually took',
  'Kostenrem': 'Cost drag', 'Tegenover je resultaat': 'Versus your result', 'Kosten per jaar': 'Costs per year', 'Als deel van je inleg per jaar': 'As a share of your deposits per year',
  'Deel van de omzet': 'Share of turnover', 'Doorkijk: waar je geld werkelijk in zit': 'Look-through: what your money is really in',
  'Per sector': 'By sector', 'Per land': 'By country', 'Per bedrijf': 'By company', 'Grootste 10 bedrijven samen': 'Largest 10 companies together', 'Aantal bedrijven': 'Number of companies',
  'Via fondsen doorgerekend': 'Looked through via funds', 'Grootste sector': 'Largest sector', 'Grootste land': 'Largest country',
  'Wisselkosten vooruit': 'FX costs ahead', 'Ik koop per maand': 'I buy per month', 'Daarvan niet in euro': 'Of which not in euro', 'Per jaar': 'Per year', 'Over 10 jaar': 'Over 10 years',
  'Alles in euro gekocht': 'All bought in euro', 'Je tempo, laatste 12 maanden': 'Your pace, last 12 months', 'Werkelijk betaald, laatste 12 maanden': 'Actually paid, last 12 months',
  'Doorkijk en kosten': 'Look-through and costs', 'Doorkijk': 'Look-through', 'Rapport (pdf)': 'Report (pdf)', 'Analyse': 'Analysis',
  'Samenhang': 'Correlation', 'Samen in je portefeuille': 'Together in your portfolio', 'Beweeglijkheid los': 'Volatility separately', 'Samen als paar': 'Together as a pair',
  'Zelfde sector': 'Same sector', 'Gemeenschappelijke dagen': 'Days in common', 'Indeling': 'Breakdown', 'Periode': 'Period', 'Vanaf welke daling': 'From which drop',
  'Naar inhoud': 'Skip to content', 'Wat is er nieuw': "What's new", 'Begrepen': 'Got it',
  'Openen': 'Opening', 'Laatst bekeken pagina opnieuw openen': 'Reopen the last page you viewed',
  'Staat dit uit, dan begint de tracker altijd op Overzicht. Deze keuze geldt alleen op dit apparaat.':
    'With this off, the tracker always starts on Overview. This choice applies to this device only.',
  'Bedragen staan verborgen': 'Amounts are hidden', 'Kopiëren lukte niet': 'Copying failed',
  'Finnhub-sleutel invullen': 'Enter Finnhub key', 'FMP-sleutel invullen': 'Enter FMP key',
  'Alpha Vantage-sleutel invullen': 'Enter Alpha Vantage key', 'Twelve Data-sleutel invullen': 'Enter Twelve Data key',
  'FRED-sleutel invullen': 'Enter FRED key', 'E-mailadres voor SEC invullen': 'Enter email address for SEC',
  'Trading 212-sleutel invullen': 'Enter Trading 212 key', 'Valuta aanzetten': 'Turn on currencies',
  'Inflatie aanzetten': 'Turn on inflation', 'Indexen aanzetten': 'Turn on indices', 'SEC EDGAR aanzetten': 'Turn on SEC EDGAR',
  'Kopen en verkopen aanzetten': 'Turn on buying and selling', 'Geschiedenis overnemen': 'Import history',
  'Toegang en Worker openen': 'Open access and Worker',
});
// Vertalingen die na het samenvoegen van versie 58 nog ontbraken (tools/check-i18n.mjs)
Object.assign(EN, {
  '12 maanden': '12 months', 'Accountwaarde en inleg': 'Account value and deposits', 'Agenda-link maken': 'Create calendar link', 'Alarm toevoegen': 'Add alert',
  'Alles als Excel-werkmap (.xlsx)': 'Everything as Excel workbook (.xlsx)', 'Alles als JSON': 'Everything as JSON', 'Alles verkopen': 'Sell everything', 'Als afbeelding opslaan': 'Save as image',
  'Andere suggesties': 'Other suggestions', 'bedragen verbergen of tonen': 'hide or show amounts', 'Betaalrekening': 'Current account', 'Bijdrage per positie': 'Contribution per position',
  'Box 3 per jaar': 'Box 3 per year', 'Contant geld': 'Cash', 'Database': 'Database', 'De code die je in de sheet hebt gemaakt': 'The code you created in the sheet',
  'Deel-link maken': 'Create share link', 'Deposito': 'Fixed-term deposit', 'Deze maand': 'This month', 'dividend': 'dividend',
  'Dividend en bronbelasting als CSV': 'Dividends and withholding tax as CSV', 'Dividend herbeleggen': 'Reinvest dividends', 'Dividendinkomen per maand': 'Dividend income per month', 'Dollar −10%': 'Dollar −10%',
  'Fed': 'Fed', 'Filter': 'Filter', 'Filteren en indelen': 'Filter and group', 'Gebeurtenis toevoegen': 'Add event',
  'Gebeurtenissen in je tijdlijn': 'Events in your timeline', 'Geen inleg': 'No deposits', 'Gegevens vernieuwen': 'Refresh data', 'Gerealiseerd en ongerealiseerd per positie': 'Realised and unrealised per position',
  'Geschiedenis inlezen': 'Import history', 'Grenzen opslaan': 'Save limits', 'Grootste': 'Largest', 'Herbalanceren als afvinklijst': 'Rebalancing as a checklist',
  'Hoofdmenu': 'Main menu', 'Hoogste dividend': 'Highest dividend', 'In één oogopslag': 'At a glance', 'Indeling van de lijst': 'List grouping',
  'Installeren als app': 'Install as app', 'Is de reden waarom je dit kocht nog geldig?': 'Is the reason you bought this still valid?', 'Je toegangscode': 'Your access code', 'Kleurenblindvriendelijk (blauw en oranje)': 'Colour-blind friendly (blue and orange)',
  'Koppelingen openen': 'Open connections', 'Kwartaalcijfers tegenover verwachting': 'Quarterly results versus expectations', 'Laagste K/W': 'Lowest P/E', 'Laatste handelsdag in de VS': 'Last trading day in the US',
  'Laatste orders via de app': 'Latest orders via the app', 'Labels, notitie en koopzone': 'Labels, note and buy zone', 'Lijst kopiëren': 'Copy list', 'Limiet': 'Limit',
  'Maandelijks inleggen vanaf een datum': 'Monthly investing from a date', 'Meeste kopen': 'Most buy ratings', 'Meldingen aanzetten': 'Turn on notifications', 'Metingen': 'Measurements',
  'Metingen, laatste 30 dagen': 'Measurements, last 30 days', 'Neem je weken over uit de Google Sheet': 'Import your weeks from the Google Sheet', 'Netto vermogen door de tijd': 'Net worth over time', 'Nieuwe link maken': 'Create new link',
  'Nieuws en cijfers': 'News and financials', 'Nieuws en stemming': 'News and sentiment', 'Onderdeel': 'Section', 'Onderdelen': 'Sections',
  'Ongeldige verwijderen': 'Remove invalid', 'Openstaande orders': 'Open orders', 'Opnieuw beginnen': 'Start over', 'Overig': 'Other',
  'Overzicht kopiëren': 'Copy overview', 'Peildatum als CSV': 'Reference date as CSV', 'Per bedrijf: waarom dit risico, en rustigere alternatieven': 'Per company: why this risk, and calmer alternatives', 'Periode van de grafiek': 'Chart period',
  'Periode van de grafiek in de tegels': 'Chart period in the tiles', 'Posities nu': 'Positions now', 'Potjes per doel': 'Pots per goal', 'Regels opslaan': 'Save rules',
  'Rente': 'Interest', 'Reservekopie downloaden': 'Download backup', 'Reservekopie in de cloud': 'Backup in the cloud', 'Resultaat per week': 'Result per week',
  "Scenario's": 'Scenarios', 'Sorteren': 'Sort', 'Spaargeld en contant': 'Savings and cash', 'Spaarrekening': 'Savings account',
  'Standaard': 'Default', 'Status bekijken': 'View status', 'Storten': 'Deposit', 'Taal / Language': 'Language',
  'te duur': 'too expensive', 'Tech −20%': 'Tech −20%', 'Testmail sturen': 'Send test email', 'Testmelding': 'Test notification',
  'Thema': 'Theme', 'Toch toevoegen': 'Add anyway', 'Tot je annuleert': 'Until you cancel', 'Twee plannen naast elkaar': 'Two plans side by side',
  'Uitzetten': 'Turn off', 'Uitzetten op dit apparaat': 'Turn off on this device', 'Van volglijst halen': 'Remove from watchlist', 'Verdeling van je posities': 'Breakdown of your positions',
  'Vergrendeling kwijt? Tracker van dit apparaat wissen': 'Lost the lock? Erase the tracker from this device', 'Verkopen': 'Sell', 'Verloop van de totale waarde': 'Total value over time', 'Vernieuwen': 'Refresh',
  'Verst onder jaartop': 'Furthest below 52-week high', 'Verwijderen': 'Delete', 'Vorig jaar': 'Last year', 'Wat betekent 90% kans?': 'What does a 90% chance mean?',
  'Weet je hoe groot deze positie in je beleggingen is?': 'Do you know how large this position is in your investments?', 'Weet je wat je met de opbrengst gaat doen?': 'Do you know what you will do with the proceeds?', 'Zou je dit aandeel vandaag opnieuw kopen voor dit bedrag?': 'Would you buy this stock again today for this amount?',
});
const EN_RE = [
  [/^Wat is er nieuw in (.+)$/, "What's new in $1"], [/^(\d+) u oud$/, '$1 h old'], [/^(\d+) d oud$/, '$1 d old'],
  [/^Gekopieerd: (.+)$/, 'Copied: $1'],
  [/^Alle (\d+) bedrijven bekijken$/, 'View all $1 companies'], [/^Alle (\d+) bedrijven$/, 'All $1 companies'], [/^(\d+) van 7$/, '$1 of 7'], [/^Via (.+)$/, 'Via $1'],
  [/^Stijgers, markt en dalers (.*)$/, 'Risers, market and fallers $1'], [/^(\d+) dagen$/, '$1 days'], [/^(\d+) jaar$/, '$1 years'], [/^Waarde beleggingen, (.+)$/, 'Investments value, $1'],
  [/^Bijgewerkt (.+)$/, 'Updated $1'], [/^vandaag$/, 'today'], [/^Nieuwe versie (.+)$/, 'New version $1'],
  [/^(.+) vandaag$/, '$1 today'], [/^sinds het slot van (.+)$/, 'since the close of $1'], [/^(.+) sinds het slot van (.+)$/, '$1 since the close of $2'],
  [/^sinds de opening(.*)$/, 'since the open$1'], [/^Sinds aankoop (.+)$/, 'Since purchase $1'], [/^(\d+) posities, samen (.+)$/, '$1 positions, together $2'],
];
Object.assign(EN, {
  'Vergelijk met portefeuille': 'Compare with portfolio', 'Deel van portefeuille': 'Share of portfolio', 'Tot hoogste gemeten': 'From highest measured', 'Laatste handelsdag': 'Last trading day',
  'Positie': 'Position', 'Waarde nu': 'Value now', 'Aantal': 'Quantity', 'Koers in euro': 'Price in euro', 'Gemiddelde aankoopprijs': 'Average purchase price', 'Ingelegd': 'Invested',
  'Bijdrage aan dagresultaat': 'Contribution to daily result', 'Volgende kwartaalcijfers': 'Next earnings', 'Volgend dividend': 'Next dividend', 'Opening': 'Open', 'Laagste en hoogste': 'Low and high',
  'Gemeten dagen': 'Days measured', 'Huidige reeks': 'Current streak', 'Beste dag': 'Best day', 'Slechtste dag': 'Worst day', 'Beste week': 'Best week', 'Slechtste week': 'Worst week',
  'Bronnen, laatste 30 dagen': 'Sources, last 30 days', 'Budget per bron': 'Budget per source', 'Ruimte in de database': 'Database space',
  'Reservekopieën in de cloud': 'Cloud backups', 'Controle op rare gegevens': 'Odd data check', 'Splitsingen en nieuwe tickers': 'Splits and renamed tickers',
  'Dag en tijdzone': 'Day and time zone', 'Testen': 'Test', 'Voorbeeld': 'Preview', 'Nu een kopie maken': 'Make a copy now', 'Bronnen': 'Sources',
  'Grootste veranderingen': 'Biggest changes', 'Alle bedrijven bekijken': 'View all companies', 'Zoek op naam of ticker': 'Search by name or ticker', 'Nog geen metingen van vandaag': 'No measurements today yet',
});
// Markt en handel: warmtekaart, sectorrotatie, oefenmodus, orderbeveiliging, vragenlijst en beslisdagboek
// Bedrijven en volglijst: indeling, aankopen per keer, dagboek, eigen koersdoel en de tickerkaart
Object.assign(EN, {
  'Warmtekaart': 'Heatmap', 'Mijn posities': 'My positions', 'Sectorrotatie': 'Sector rotation', 'Jouw deel': 'Your share',
  '1 maand': '1 month', '3 maanden': '3 months', '6 maanden': '6 months', 'Alleen wat mijn munten of landen raakt': 'Only what affects my currencies or countries',
  'Kopen, verkopen en dagboek': 'Buying, selling and journal', 'Handel': 'Trading',
  'Oefenmodus': 'Practice mode', 'Oefenmodus aan': 'Practice mode on', 'Oefenorders': 'Practice orders', 'Oefensaldo': 'Practice balance',
  'Oefenorder plaatsen': 'Place practice order', 'Oefenboek leegmaken': 'Clear practice book', 'Oefensaldo bij opnieuw beginnen': 'Practice balance when starting over',
  'Oefenposities': 'Practice positions', 'Totaal oefenboek': 'Practice book total', 'Oefensaldo vrij': 'Practice cash free',
  'Orderbeveiliging': 'Order security', 'Ontgrendelen': 'Unlock', 'PIN bewaren': 'Save PIN', 'PIN wissen': 'Clear PIN', 'Extra controle na': 'Extra check after', 'Controle met': 'Check with',
  'Moet ik verkopen?': 'Should I sell?', 'Vragen om eerst na te lopen': 'Questions to run through first', 'Antwoorden bewaren': 'Save answers',
  'Als notitie in je beslisdagboek': 'Save as a note in your decision journal', 'Ja': 'Yes', 'Nee': 'No', 'Weet ik niet': 'Not sure',
  'Orders met hun reden': 'Orders and your reasons', 'Reden toevoegen': 'Add reason', 'Reden bewerken': 'Edit reason', 'Reden bijwerken': 'Update reason', 'Ja, nog geldig': 'Yes, still valid',
  'Beslisdagboek': 'Decision journal', 'Notitie bewaren': 'Save note', 'Jaaroverzicht van je beslissingen': 'Annual review of your decisions',
  'Datum': 'Date', 'Notitie': 'Note', 'Aandeel': 'Stock', 'Na deze order': 'After this order', 'Als je dit echt zou doen': 'If you really did this', 'Sector daarna': 'Sector afterwards', 'Risicoklasse portefeuille': 'Portfolio risk class',
  'Bedrag ter bevestiging': 'Amount to confirm', 'Grote order.': 'Large order.', 'Extra controle.': 'Extra check.',
  'Indeling': 'Grouping', 'Tegels': 'Tiles', 'Lijst': 'List', 'Eén lijst': 'One list', 'Munt': 'Currency', 'Pie': 'Pie', 'Deel': 'Share',
  'Koersalarm': 'Price alert', 'Aankopen per keer': 'Purchases one by one', 'Kostprijsmethode': 'Cost basis method', 'FIFO': 'FIFO',
  'Aantal nu': 'Quantity now', 'Kostprijs per stuk': 'Cost per share', 'Ingelegd in wat je nog hebt': 'Invested in what you still hold',
  'Ongerealiseerd resultaat': 'Unrealised result', 'Verschil met de andere methode': 'Difference with the other method',
  'Mijn koersdoel': 'My price target', 'Alarm bij dit koersdoel': 'Alert at this target', 'Mijn koersdoel en dagboek': 'My price target and journal',
  'Dagboek': 'Journal', 'Toevoegen': 'Add', 'Openen': 'Open', 'Bekijken': 'Preview', 'Sluiten': 'Close',
  'Lijst met symbolen invoeren': 'Import a list of tickers', 'Zonder label': 'Without a label', 'Waarom volg je dit?': 'Why are you watching this?',
});

// Duits en Frans: dezelfde sleutels als EN; wat hier ontbreekt, valt terug op het Engels
const DE = {
  'Overzicht': 'Übersicht', 'Bedrijven': 'Firmen', 'Plannen': 'Planen', 'Nieuws': 'News', 'Statistieken': 'Statistiken', 'Instellingen': 'Einstellungen', 'Analyse': 'Analyse',
  'Investeringstracker': 'Investment-Tracker', 'Waarde beleggingen': 'Wert der Anlagen', 'Agenda': 'Kalender', 'Sectoren': 'Sektoren', 'Valuta en koopkracht': 'Währung und Kaufkraft',
  'Risico': 'Risiko', 'Weken': 'Wochen', 'Patronen': 'Muster', 'Volglijst': 'Beobachtungsliste', 'Vandaag': 'Heute', '3 dagen': '3 Tage', '30 dagen': '30 Tage', 'Dit jaar': 'Dieses Jahr', '1 jaar': '1 Jahr', 'Alles': 'Alles', 'Alle': 'Alle',
  'Gestegen': 'Gestiegen', 'Gedaald': 'Gefallen', 'Verandering': 'Veränderung', 'Waarde': 'Wert', 'Sinds aankoop': 'Seit Kauf', 'Naam': 'Name', 'Toon': 'Zeigen', 'Sorteer': 'Sortieren', 'Grafiek': 'Diagramm',
  'Accountwaarde': 'Kontowert', 'Netto gestort': 'Netto eingezahlt', 'Totaal resultaat': 'Gesamtergebnis', 'Ongerealiseerd': 'Unrealisiert', 'Gerealiseerd': 'Realisiert', 'Stortingen': 'Einzahlungen', 'Verdeling': 'Aufteilung',
  'Kwartaalcijfers': 'Quartalszahlen', 'Ontvangen dividend': 'Erhaltene Dividenden', 'Dividend': 'Dividende', 'Euro en dollar': 'Euro und Dollar', 'Na inflatie': 'Nach Inflation', 'Risico-indicatie': 'Risikoindikator',
  'Streefverdeling': 'Zielaufteilung', 'Vooruitblik': 'Ausblick', 'Mijlpalen': 'Meilensteine', 'Jaaroverzicht': 'Jahresübersicht', 'Exporteren': 'Exportieren', 'Doelen': 'Ziele',
  'Inleg en doelen': 'Einzahlungen und Ziele', 'Wat als': 'Was wäre wenn', 'Dividend en belasting': 'Dividenden und Steuern', 'Kosten en aankopen': 'Kosten und Käufe', 'Spreiding en rekeningen': 'Streuung und Konten', 'Delen en exporteren': 'Teilen und exportieren',
  'Vooruit rekenen': 'Vorausrechnen', 'Belasting, herbalanceren en rente': 'Steuern, Rebalancing und Zinsen', 'Rendement': 'Rendite', 'Markt en onderzoek': 'Markt und Recherche', 'Transacties en begrippen': 'Transaktionen und Begriffe',
  'Echt rendement': 'Tatsächliche Rendite', 'Jij tegenover je maatstaf': 'Du im Vergleich zur Benchmark', 'Risico en rendement': 'Risiko und Rendite', 'Grootste daling': 'Größter Rückgang', 'Wie dreef je resultaat?': 'Was trieb dein Ergebnis?',
  'Concentratie': 'Konzentration', 'Twee periodes vergelijken': 'Zwei Zeiträume vergleichen', 'Wisselkosten': 'Wechselkosten', 'Je pies': 'Deine Pies', 'Marktoverzicht': 'Marktübersicht', 'Economische agenda': 'Wirtschaftskalender',
  'Screener': 'Screener', 'ETF-zoeker': 'ETF-Suche', 'Deponeringen bij de SEC': 'SEC-Einreichungen', 'Wat grote beleggers bezitten': 'Was große Investoren besitzen', 'Insiders die samen kopen': 'Insider, die gemeinsam kaufen',
  'Koersreactie op kwartaalcijfers': 'Kursreaktion auf Quartalszahlen', 'Alle transacties': 'Alle Transaktionen', 'Begrippen': 'Begriffe', 'Kans om je doelen te halen': 'Chance, deine Ziele zu erreichen',
  'Financieel onafhankelijk (FIRE)': 'Finanziell unabhängig (FIRE)', 'Elke maand inleggen, teruggerekend': 'Monatlich investieren, zurückgerechnet', 'Had je je dividend herbelegd?': 'Hättest du deine Dividende reinvestiert?',
  'Herbalanceren met verkopen': 'Rebalancing mit Verkäufen', 'Rente over je vrije saldo': 'Zinsen auf dein freies Guthaben', 'Kostenoverzicht': 'Kostenübersicht', 'Aankoopdagboek': 'Kauftagebuch', 'Fondskosten': 'Fondskosten',
  'Nieuws instellen': 'Nachrichten einstellen', 'Bronnen': 'Quellen', 'Analisten': 'Analysten', 'Insiders': 'Insider', 'Suggesties om te volgen': 'Vorschläge zum Beobachten', 'Volgen': 'Beobachten', 'Waardering': 'Bewertung',
  'Positie': 'Position', 'Historie': 'Verlauf', 'Onderzoek': 'Recherche', 'Vergelijk': 'Vergleichen', 'Posities': 'Positionen', 'Koop': 'Kauf', 'Verkoop': 'Verkauf', 'Jaar': 'Jahr', 'Kosten': 'Kosten', 'Bedrijf': 'Unternehmen',
  '← Terug': '← Zurück', '‹ Terug': '‹ Zurück', 'Terug': 'Zurück', 'Opslaan': 'Speichern', 'Annuleren': 'Abbrechen', 'Bewaren': 'Speichern', 'Sluiten': 'Schließen', 'Volgende': 'Weiter', 'Overslaan': 'Überspringen', 'Klaar': 'Fertig',
  'Meer tonen': 'Mehr zeigen', 'Minder tonen': 'Weniger zeigen', 'Mijn aandelen': 'Meine Aktien', 'Markt': 'Markt', 'Pagina aanpassen': 'Seite anpassen', 'Snel zoeken': 'Schnellsuche', 'Gebruiken': 'Verwenden',
  'Licht': 'Hell', 'Donker': 'Dunkel', 'Automatisch': 'Automatisch', 'Aan': 'An', 'Uit': 'Aus', 'Weergave': 'Darstellung', 'Animaties': 'Animationen', 'Taal': 'Sprache', 'Leesbaarheid': 'Lesbarkeit', 'Hulp': 'Hilfe',
  'Compact': 'Kompakt', 'Grotere tekst': 'Größere Schrift', 'Rondleiding opnieuw': 'Rundgang erneut', 'Sneltoetsen': 'Tastenkürzel', 'Koppelingen en functies': 'Verbindungen und Funktionen', 'Updates': 'Updates',
  'Sector': 'Sektor', 'Branche': 'Branche', 'Beurswaarde': 'Marktkapitalisierung', 'Koers': 'Kurs', 'Dividendrendement': 'Dividendenrendite', 'Koers-winstverhouding': 'Kurs-Gewinn-Verhältnis',
  'Beleggingen nu': 'Anlagen jetzt', 'Vrij saldo': 'Freies Guthaben', 'Resultaat nu': 'Ergebnis jetzt', 'Grootste positie': 'Größte Position', 'Grootste veranderingen': 'Größte Veränderungen', 'Alle bedrijven bekijken': 'Alle Unternehmen ansehen',
  'Zoek op naam of ticker': 'Nach Name oder Ticker suchen', 'Beste dag': 'Bester Tag', 'Slechtste dag': 'Schlechtester Tag', 'Mijn tracker koppelen': 'Meinen Tracker verbinden', 'Functies bekijken met voorbeeldgetallen': 'Funktionen mit Beispieldaten ansehen',
  '▲ Positief': '▲ Positiv', '▼ Negatief': '▼ Negativ', '● Neutraal': '● Neutral', 'Status van je tracker': 'Status deines Trackers', 'Verbruik per bron': 'Verbrauch pro Quelle', 'Fouten op de website': 'Fehler auf der Website',
};
const FR = {
  'Overzicht': 'Aperçu', 'Bedrijven': 'Sociétés', 'Plannen': 'Plans', 'Nieuws': 'Actus', 'Statistieken': 'Statistiques', 'Instellingen': 'Paramètres', 'Analyse': 'Analyse',
  'Investeringstracker': 'Suivi des investissements', 'Waarde beleggingen': 'Valeur des placements', 'Agenda': 'Agenda', 'Sectoren': 'Secteurs', 'Valuta en koopkracht': 'Devises et pouvoir d’achat',
  'Risico': 'Risque', 'Weken': 'Semaines', 'Patronen': 'Tendances', 'Volglijst': 'Liste de suivi', 'Vandaag': 'Aujourd’hui', '3 dagen': '3 jours', '30 dagen': '30 jours', 'Dit jaar': 'Cette année', '1 jaar': '1 an', 'Alles': 'Tout', 'Alle': 'Tous',
  'Gestegen': 'En hausse', 'Gedaald': 'En baisse', 'Verandering': 'Variation', 'Waarde': 'Valeur', 'Sinds aankoop': 'Depuis l’achat', 'Naam': 'Nom', 'Toon': 'Afficher', 'Sorteer': 'Trier', 'Grafiek': 'Graphique',
  'Accountwaarde': 'Valeur du compte', 'Netto gestort': 'Versé net', 'Totaal resultaat': 'Résultat total', 'Ongerealiseerd': 'Latent', 'Gerealiseerd': 'Réalisé', 'Stortingen': 'Versements', 'Verdeling': 'Répartition',
  'Kwartaalcijfers': 'Résultats trimestriels', 'Ontvangen dividend': 'Dividendes reçus', 'Dividend': 'Dividende', 'Euro en dollar': 'Euro et dollar', 'Na inflatie': 'Après inflation', 'Risico-indicatie': 'Indicateur de risque',
  'Streefverdeling': 'Répartition cible', 'Vooruitblik': 'Projection', 'Mijlpalen': 'Étapes', 'Jaaroverzicht': 'Bilan annuel', 'Exporteren': 'Exporter', 'Doelen': 'Objectifs',
  'Inleg en doelen': 'Versements et objectifs', 'Wat als': 'Et si', 'Dividend en belasting': 'Dividendes et impôts', 'Kosten en aankopen': 'Frais et achats', 'Spreiding en rekeningen': 'Diversification et comptes', 'Delen en exporteren': 'Partager et exporter',
  'Vooruit rekenen': 'Projections', 'Belasting, herbalanceren en rente': 'Impôts, rééquilibrage et intérêts', 'Rendement': 'Rendement', 'Markt en onderzoek': 'Marché et recherche', 'Transacties en begrippen': 'Transactions et notions',
  'Echt rendement': 'Rendement réel', 'Jij tegenover je maatstaf': 'Toi face à ton indice de référence', 'Risico en rendement': 'Risque et rendement', 'Grootste daling': 'Plus forte baisse', 'Wie dreef je resultaat?': 'Qui a porté ton résultat ?',
  'Concentratie': 'Concentration', 'Twee periodes vergelijken': 'Comparer deux périodes', 'Wisselkosten': 'Frais de change', 'Je pies': 'Tes pies', 'Marktoverzicht': 'Aperçu du marché', 'Economische agenda': 'Agenda économique',
  'Screener': 'Filtre', 'ETF-zoeker': 'Recherche d’ETF', 'Deponeringen bij de SEC': 'Dépôts auprès de la SEC', 'Wat grote beleggers bezitten': 'Ce que détiennent les grands investisseurs', 'Insiders die samen kopen': 'Initiés qui achètent ensemble',
  'Koersreactie op kwartaalcijfers': 'Réaction du cours aux résultats', 'Alle transacties': 'Toutes les transactions', 'Begrippen': 'Notions', 'Kans om je doelen te halen': 'Chance d’atteindre tes objectifs',
  'Financieel onafhankelijk (FIRE)': 'Indépendance financière (FIRE)', 'Elke maand inleggen, teruggerekend': 'Investir chaque mois, en rétrospective', 'Had je je dividend herbelegd?': 'Et si tu avais réinvesti tes dividendes ?',
  'Herbalanceren met verkopen': 'Rééquilibrer en vendant', 'Rente over je vrije saldo': 'Intérêts sur ton solde libre', 'Kostenoverzicht': 'Aperçu des frais', 'Aankoopdagboek': 'Journal d’achats', 'Fondskosten': 'Frais des fonds',
  'Nieuws instellen': 'Réglages des actualités', 'Bronnen': 'Sources', 'Analisten': 'Analystes', 'Insiders': 'Initiés', 'Suggesties om te volgen': 'Suggestions à suivre', 'Volgen': 'Suivre', 'Waardering': 'Valorisation',
  'Positie': 'Position', 'Historie': 'Historique', 'Onderzoek': 'Recherche', 'Vergelijk': 'Comparer', 'Posities': 'Positions', 'Koop': 'Achat', 'Verkoop': 'Vente', 'Jaar': 'Année', 'Kosten': 'Frais', 'Bedrijf': 'Entreprise',
  '← Terug': '← Retour', '‹ Terug': '‹ Retour', 'Terug': 'Retour', 'Opslaan': 'Enregistrer', 'Annuleren': 'Annuler', 'Bewaren': 'Enregistrer', 'Sluiten': 'Fermer', 'Volgende': 'Suivant', 'Overslaan': 'Passer', 'Klaar': 'Terminé',
  'Meer tonen': 'Afficher plus', 'Minder tonen': 'Afficher moins', 'Mijn aandelen': 'Mes actions', 'Markt': 'Marché', 'Pagina aanpassen': 'Personnaliser la page', 'Snel zoeken': 'Recherche rapide', 'Gebruiken': 'Utiliser',
  'Licht': 'Clair', 'Donker': 'Sombre', 'Automatisch': 'Automatique', 'Aan': 'Activé', 'Uit': 'Désactivé', 'Weergave': 'Affichage', 'Animaties': 'Animations', 'Taal': 'Langue', 'Leesbaarheid': 'Lisibilité', 'Hulp': 'Aide',
  'Compact': 'Compact', 'Grotere tekst': 'Texte plus grand', 'Rondleiding opnieuw': 'Revoir la visite', 'Sneltoetsen': 'Raccourcis', 'Koppelingen en functies': 'Connexions et fonctions', 'Updates': 'Mises à jour',
  'Sector': 'Secteur', 'Branche': 'Industrie', 'Beurswaarde': 'Capitalisation', 'Koers': 'Cours', 'Dividendrendement': 'Rendement du dividende', 'Koers-winstverhouding': 'PER',
  'Beleggingen nu': 'Placements actuels', 'Vrij saldo': 'Solde libre', 'Resultaat nu': 'Résultat actuel', 'Grootste positie': 'Plus grande position', 'Grootste veranderingen': 'Plus fortes variations', 'Alle bedrijven bekijken': 'Voir toutes les entreprises',
  'Zoek op naam of ticker': 'Chercher par nom ou symbole', 'Beste dag': 'Meilleur jour', 'Slechtste dag': 'Pire jour', 'Mijn tracker koppelen': 'Connecter mon suivi', 'Functies bekijken met voorbeeldgetallen': 'Découvrir avec des données d’exemple',
  '▲ Positief': '▲ Positif', '▼ Negatief': '▼ Négatif', '● Neutraal': '● Neutre', 'Status van je tracker': 'État de ton suivi', 'Verbruik per bron': 'Utilisation par source', 'Fouten op de website': 'Erreurs sur le site',
};
// Nieuwe koppen ook in het Engels
Object.assign(EN, {
  'Analyse': 'Analysis', 'Dit jaar': 'This year', '1 jaar': '1 year', 'Doelen': 'Goals', 'Vooruit rekenen': 'Projections', 'Belasting, herbalanceren en rente': 'Tax, rebalancing and interest', 'Markt en onderzoek': 'Market and research',
  'Transacties en begrippen': 'Transactions and terms', 'Echt rendement': 'Actual return', 'Jij tegenover je maatstaf': 'You versus your benchmark', 'Risico en rendement': 'Risk and return', 'Grootste daling': 'Largest drop',
  'Wie dreef je resultaat?': 'What drove your result?', 'Concentratie': 'Concentration', 'Twee periodes vergelijken': 'Compare two periods', 'Wisselkosten': 'Currency fees', 'Je pies': 'Your pies', 'Marktoverzicht': 'Market overview',
  'Economische agenda': 'Economic calendar', 'Screener': 'Screener', 'ETF-zoeker': 'ETF finder', 'Deponeringen bij de SEC': 'SEC filings', 'Wat grote beleggers bezitten': 'What big investors hold', 'Insiders die samen kopen': 'Insiders buying together',
  'Koersreactie op kwartaalcijfers': 'Price reaction to earnings', 'Alle transacties': 'All transactions', 'Begrippen': 'Terms', 'Kans om je doelen te halen': 'Chance of reaching your goals', 'Financieel onafhankelijk (FIRE)': 'Financial independence (FIRE)',
  'Elke maand inleggen, teruggerekend': 'Monthly investing, back-tested', 'Had je je dividend herbelegd?': 'Had you reinvested your dividends?', 'Herbalanceren met verkopen': 'Rebalancing with selling', 'Rente over je vrije saldo': 'Interest on your free cash',
  'Nieuws instellen': 'News settings', 'Bronnen': 'Sources', 'Pagina aanpassen': 'Customise page', 'Snel zoeken': 'Quick search', 'Leesbaarheid': 'Readability', 'Hulp': 'Help', 'Compact': 'Compact', 'Grotere tekst': 'Larger text',
  'Rondleiding opnieuw': 'Replay tour', 'Sneltoetsen': 'Keyboard shortcuts', 'Sluiten': 'Close', 'Overslaan': 'Skip', 'Klaar': 'Done', 'Gerealiseerd': 'Realised', 'Status van je tracker': 'Status of your tracker',
  'Verbruik per bron': 'Usage per source', 'Fouten op de website': 'Errors on the website', 'Fondskosten': 'Fund costs', 'Dividend': 'Dividend',
});
// Startscherm (voor er een tracker gekoppeld is)
Object.assign(EN, {
  'Je beleggingen in één oogopslag': 'Your investments at a glance',
  'Deze site toont je Trading 212-portefeuille, opgehaald door je eigen Cloudflare Worker. Geen sleutel? Kijk dan eerst rond met voorbeeldgetallen: alles werkt, alleen de bedragen zijn verzonnen.': 'This site shows your Trading 212 portfolio, fetched by your own Cloudflare Worker. No key yet? Look around with sample figures first: everything works, only the amounts are made up.',
  'Functies bekijken met voorbeeldgetallen': 'Explore with sample figures', 'Mijn tracker koppelen': 'Connect my tracker', 'Je beleggingen': 'Your investments', 'Voorbeeldgetallen': 'Sample figures',
  'Al een tracker? Inloggen met je Trading 212-sleutel': 'Already have a tracker? Sign in with your Trading 212 key',
  'Op een nieuwe browser of telefoon. Je Worker herkent de sleutel en geeft dit apparaat toegang; je andere koppelingen (FMP, Finnhub, SEC en de rest) staan al in de Worker en werken meteen. De sleutel wordt niet bewaard.': 'On a new browser or phone. Your Worker recognises the key and gives this device access; your other connections (FMP, Finnhub, SEC and the rest) are already in the Worker and work right away. The key is not stored.',
  'Adres van je Worker': 'Your Worker address', 'Trading 212 API-sleutel': 'Trading 212 API key', 'API-secret': 'API secret', 'Inloggen': 'Sign in', 'Bezig met inloggen…': 'Signing in…',
  'Vul het adres van je Cloudflare Worker in; het eindigt op /api/data.': 'Enter the address of your Cloudflare Worker; it ends in /api/data.', 'Vul je API-sleutel en secret van Trading 212 in.': 'Enter your Trading 212 API key and secret.',
  'Waarde, resultaat en grafieken per dag, week en positie.': 'Value, result and charts per day, week and position.', 'Klasse 1 tot 7, wat samen beweegt en wat het risico verlaagt.': 'Class 1 to 7, what moves together and what lowers the risk.',
  'Streefverdeling, vooruitblik, jaaroverzicht en mijlpalen.': 'Target allocation, projection, annual overview and milestones.', 'Agenda en sectoren': 'Calendar and sectors', 'Kwartaalcijfers, dividenden en vergelijkbare bedrijven.': 'Earnings, dividends and similar companies.',
  'Nieuws en analisten': 'News and analysts', 'Nieuws, koersdoelen, stemming en insiderhandel.': 'News, price targets, sentiment and insider trading.', 'Valuta en inflatie': 'Currency and inflation',
  'Euro-dollarkoers, rendement na inflatie, vergelijking met de index.': 'Euro-dollar rate, return after inflation, comparison with the index.', 'gratis FMP-sleutel': 'free FMP key', 'gratis Finnhub-sleutel': 'free Finnhub key', 'geen sleutel': 'no key',
  'Zo zet je je eigen tracker op': 'How to set up your own tracker', ': een gratis Cloudflare-account en een Trading 212 API-sleutel zijn genoeg voor de basis.': ': a free Cloudflare account and a Trading 212 API key are enough for the basics.',
  'Je bekijkt de functies met voorbeeldgetallen.': 'You are viewing the features with sample figures.', 'Eigen tracker opzetten': 'Set up your own tracker', 'of': 'or', 'mijn eigen gegevens laden': 'load my own data',
  'Je bekijkt een gedeelde portefeuille (alleen lezen).': 'You are viewing a shared portfolio (read only).', 'Zelf een tracker opzetten': 'Set up a tracker yourself', 'Er is een nieuwe versie van de tracker.': 'There is a new version of the tracker.', 'Nu bijwerken': 'Update now', 'Later': 'Later',
});
Object.assign(EN, {
  'Stemmingskaart': 'Sentiment map', 'klik op een stip': 'click a dot', 'beide positief': 'both positive', 'beide negatief': 'both negative', 'analisten wel, nieuws niet': 'analysts yes, news no',
  'nieuws wel, analisten niet': 'news yes, analysts no', '← minder analisten zeggen kopen': '← fewer analysts say buy', 'meer →': 'more →', 'in bezit': 'held', 'volglijst': 'watchlist',
  // Nieuws en analisten, tweede deel (bundelen, tijdlijn, cijferseizoen, scorebord, gemist)
  'Analisten door de tijd': 'Analysts over time', 'Laatste wijzigingen': 'Latest changes', 'Kopen nu': 'Saying buy now', 'Analisten erbij of eraf': 'Analysts added or gone',
  'Gemiddeld koersdoel': 'Average price target', 'Kwartaalcijfers komen eraan': 'Earnings coming up', 'Verwachte winst per aandeel': 'Expected earnings per share',
  'Laatste vier keer boven verwachting': 'Above expectations in the last four', 'Koers beweegt rond cijfers meestal': 'Price usually moves around earnings',
  'Vorige cijfers': 'Previous earnings', 'Verrassingen per kwartaal': 'Surprises per quarter', 'Cijferseizoen': 'Earnings season', 'Net gerapporteerd': 'Just reported',
  'Cijfers op': 'Reporting on', 'Verwachte wpa': 'Expected EPS', 'Gewone sprong': 'Usual move', 'Vorige verrassing': 'Previous surprise',
  'Analisten tegenover de uitkomst': 'Analysts versus the outcome', 'Koersdoelen': 'Price targets', 'Goede richting': 'Right direction', 'Deel goed': 'Share correct',
  'Beste en zwakste': 'Best and weakest', 'Stemming van analisten per sector': 'Analyst mood by sector', 'minder positief': 'less positive', 'positiever': 'more positive',
  'Wat heb ik gemist?': 'What did I miss?', 'Alles bekijken': 'See everything', 'Nieuws en analisten': 'News and analysts', 'Je beleggingen samen': 'Your investments together',
  'Grootste bewegingen': 'Biggest moves', 'Koersen': 'Prices', 'Dividend en alarmen': 'Dividends and alerts', 'Koersalarmen afgegaan': 'Price alerts triggered',
  'Nieuws instellen': 'News settings', 'Bronnen': 'Sources', 'Aandelen': 'Stocks', 'Woorden': 'Words', 'Dempen': 'Mute',
  'hoger = positiever nieuws': 'higher = more positive news', 'Ouder nieuws laden': 'Load older news', 'Meningen per sector en door de tijd': 'Opinions by sector and over time', 'Koersdoel verschil': 'Target change', 'Meest en minst positief': 'Most and least positive', 'één bedrijf': 'one company', '1 dag': '1 day', '1 maand': '1 month', '3 maanden': '3 months', 'Verschil': 'Change', 'Bedrijven die je spreiding verbreden': 'Companies that broaden your diversification', 'Sectoren die je weinig of niet hebt: volg er een': 'Sectors you hold little or none of: follow one', 'Koersdoel analisten': 'Analyst price target', 'volgt na de volgende meting': 'follows after the next measurement', 'Geen ouder nieuws meer.': 'No older news.', 'namen die niet passen: tik op de stip': 'names that do not fit: tap the dot', 'Pictogram op je beginscherm': 'Home screen icon', 'Glas': 'Glass', 'Doorzichtig, witte lijn': 'Transparent, white line', 'Donker': 'Dark', 'Blauw': 'Blue', 'Licht': 'Light', 'Installeren': 'Install', 'Toegang en Worker': 'Access and Worker', 'Koppelingen': 'Connections', 'Als app installeren': 'Install as app', 'Status en reservekopie': 'Status and backup', 'Geschiedenis uit Google Sheet': 'History from Google Sheet', 'Delen (alleen lezen)': 'Sharing (read only)', 'Meldingen': 'Notifications', 'Opslaan en laden': 'Save and load', 'Code vergeten': 'Forget code', 'Toegangscode': 'Access code', 'je bronnen en extra functies': 'your sources and extra features', 'gekoppeld · code in deze browser': 'connected · code in this browser', 'nog niet gekoppeld': 'not connected yet', 'koersbewegingen, cijfers en insiders': 'price moves, earnings and insiders', 'een link om mee te kijken': 'a read-only link to share', 'op je beginscherm, met meldingen': 'on your home screen, with notifications', 'meetstatus en reservekopie': 'measurement status and backup', 'optioneel, eenmalig': 'optional, one time', 'alles aan met voorbeeldgegevens': 'everything on with sample data', 'Inleg': 'Contributions', 'Wat als': 'What if', 'Spreiding': 'Diversification', 'Delen': 'Sharing', 'Vooruit': 'Ahead', 'Belasting': 'Tax', 'Rendement': 'Return', 'Transacties': 'Transactions', 'Toon alles': 'Show all', 'Per sector': 'By sector', 'Eén lijst': 'One list', 'Toon': 'Show', 'Periode': 'Period', 'Indeling': 'Layout', 'Totaal': 'Total', 'Waarde': 'Value',
});
// Toegankelijkheid: grafiek als tabel, eenvoudige taal, dyslexievriendelijk en de leermodus
// Prestaties: snelle start, nieuwsarchief per 30 koppen en het meetpaneel (?perf)
// Overzicht: periode en vergelijkingslijn, dagsamenvatting, stijgers en dalers, mijlpalen, rustige modus
Object.assign(EN, {
  'Tabel': 'Table', 'Dezelfde cijfers als tabel': 'The same figures as a table', 'Terug naar de grafiek': 'Back to the chart', 'Moment': 'Moment',
  'Eenvoudige taal (minder vaktermen en tegels met veel jargon verbergen)': 'Plain language (fewer technical terms, hide jargon-heavy tiles)',
  'Dyslexievriendelijk (meer ruimte tussen regels, woorden en letters)': 'Dyslexia-friendly (more space between lines, words and letters)',
  'Leermodus (uitleg bij een begrip de eerste keer, met een korte quiz)': 'Learning mode (an explanation the first time a term appears, with a short quiz)',
  'Begrepen': 'Got it', 'Quiz over begrippen': 'Quiz on terms', 'Welk begrip is dit?': 'Which term is this?', 'Quiz afgerond': 'Quiz finished',
  'Nog een ronde': 'Another round', 'Stoppen': 'Stop', 'Uitslag': 'Result', 'Goed.': 'Correct.',
  'De uitleg van alle begrippen staat op Analyse, bij Begrippen.': 'All terms are explained on Analysis, under Terms.',
  'Gegevens worden opgehaald…': 'Fetching data…', 'Uitleg afgevinkt.': 'Explanation marked as read.',
  'Eenvoudige taal staat uit.': 'Plain language is off.', 'Leermodus staat uit.': 'Learning mode is off.',
  'Leermodus staat aan: bij een begrip komt een korte uitleg.': 'Learning mode is on: a short explanation appears with a term.',
  'De samenhang tussen je posities wordt berekend…': 'Working out how your positions move together…',
  'Prestaties': 'Performance', 'Opnieuw meten': 'Measure again', 'laatst': 'last', 'gem.': 'avg', 'keer': 'times',
  'Eerste tekening na': 'First render after', 'Snelle start na': 'Quick start after', 'niet gebruikt': 'not used',
  'Pagina gereed na': 'Page ready after', 'DOM-knopen': 'DOM nodes', 'Nog niets getekend.': 'Nothing rendered yet.',
  'desktop': 'desktop', 'telefoon': 'phone',
  'Tijd in milliseconden per tekening van een weergave. Alleen zichtbaar met ?perf in het adres.': 'Milliseconds per render of a view. Only visible with ?perf in the address.',
  '1 week': '1 week', 'Alleen waarde': 'Value only', 'Maatstaf': 'Benchmark', 'Vergelijken met': 'Compare with', 'Jouw beleggingen': 'Your investments',
  'Je ritme en mijlpalen': 'Your rhythm and milestones', 'Dividend dat eraan komt, wat je hebt bereikt en je stortingen': 'Upcoming dividend, what you reached and your deposits',
  'Volgend dividend': 'Next dividend', 'Stortingen op rij': 'Deposits in a row', 'Maandresultaten': 'Monthly results', 'Net bereikt': 'Just reached',
  'Eerste € 1.000': 'First € 1,000', 'Eerste dividend': 'First dividend', 'Eén jaar beleggen': 'One year of investing', '12 maanden storten op rij': '12 months of deposits in a row',
  'Rustig kijken': 'Calm view', 'Rustige modus: geen dagveranderingen, alleen maandresultaten': 'Calm mode: no daily changes, monthly results only',
  'Grootste stijger': 'Biggest riser', 'Cloudflare (je Worker en database)': 'Cloudflare (your Worker and database)', 'gratis abonnement': 'free plan', 'Bijna op': 'Almost used up', 'Let op': 'Watch out', 'Ruim': 'Plenty left', 'Grootste daler': 'Biggest faller', 'Nieuws over je aandelen': 'News about your stocks', 'Rustige modus': 'Calm mode',
});
EN_RE.push([/^Vraag (\d+) van (\d+)$/, 'Question $1 of $2'], [/^(\d+) van (\d+) goed\.$/, '$1 of $2 correct.'],
  [/^Dat was: (.*)\.$/, 'That was: $1.'], [/^Gegevens bijgewerkt, (.*)$/, 'Data updated, $1'],
  [/^Leermodus · (.*)$/, 'Learning mode · $1'], [/^(\d+) van (\d+) metingen, gelijkmatig verdeeld\.$/, '$1 of $2 measurements, evenly spread.'],
  [/^Eenvoudige taal staat aan, (\d+) tegels met veel vaktermen zijn verborgen\.$/, 'Plain language is on, $1 jargon-heavy tiles are hidden.']);
EN_RE.push([/^Nog (\d+) koppen: scrol verder\.$/, 'Another $1 headlines: keep scrolling.'], [/^Nog 1 kop: scrol verder\.$/, 'Another headline: keep scrolling.']);
EN_RE.push([/^Alleen (.+)$/, 'Only $1'], [/^Posities (\d+)$/, 'Positions $1'], [/^Volglijst (\d+)$/, 'Watchlist $1']);
// Kruimelpad, getalweergave, meldingen en de startchecklist
Object.assign(EN, {
  'Kruimelpad': 'Breadcrumb', '\u2039 Overzicht': '\u2039 Overview', '\u2039 Bedrijven': '\u2039 Companies', 'Melding sluiten': 'Close message',
  'Getallen': 'Numbers', 'Grote bedragen afkorten (\u20ac 12,3K)': 'Abbreviate large amounts (\u20ac 12.3K)',
  'Decimalen bij bedragen en procenten': 'Decimals for amounts and percentages',
  'geen (\u20ac 12)': 'none (\u20ac 12)', '\u00e9\u00e9n (\u20ac 12,3)': 'one (\u20ac 12.3)', 'twee (\u20ac 12,34)': 'two (\u20ac 12.34)',
  'Niet meer tonen': 'Hide this', 'Startchecklist terugzetten': 'Restore the checklist',
  'Zo haal je alles uit de tracker. Elke stap is optioneel; de basis werkt met Trading 212 alleen.':
    'This is how you get everything out of the tracker. Every step is optional; the basics work with Trading 212 alone.',
  'Trading 212 gekoppeld': 'Trading 212 connected', 'Nieuws en analisten aan': 'News and analysts on', 'Volglijst gevuld': 'Watchlist filled',
  'Doel ingesteld': 'Goal set', 'Koersalarm of meldingen': 'Price alert or notifications', 'App op je beginscherm': 'App on your home screen',
  'De basis: je posities, orders en saldo.': 'The basics: your positions, orders and cash.',
  'Een gratis Finnhub-sleutel geeft nieuws, koersdoelen en insiderhandel.': 'A free Finnhub key adds news, price targets and insider trading.',
  'Volg een aandeel dat je nog niet hebt.': 'Follow a stock you do not own yet.',
  'Op Plannen zie je dan hoe ver je bent en wat er nog nodig is.': 'Plans then shows how far along you are and what is still needed.',
  'Een bericht bij een koersgrens, kwartaalcijfers of insiderhandel.': 'A message on a price limit, earnings or insider trading.',
  'Opent sneller en werkt zonder verbinding met de laatste stand.': 'Opens faster and works offline with the last known state.',
});
EN_RE.push([/^(\d+) van (\d+) stappen klaar$/, '$1 of $2 steps done']);

EN_RE.push([/^Inloggen is mislukt: (.*)$/, 'Sign-in failed: $1'], [/^Ingelogd\. Al gekoppeld: (.*)$/, 'Signed in. Already connected: $1'], [/^Ingelogd\. Trading 212 is gekoppeld\.$/, 'Signed in. Trading 212 is connected.']);
// App en apparaat: vandaag, widget, vergrendeling, trilling, delen en de offline-melding
Object.assign(EN, {
  'Vandaag': 'Today', 'Vergrendeld': 'Locked', 'Ontgrendelen': 'Unlock', 'In een oogopslag': 'At a glance', 'Grootste bewegingen': 'Biggest moves',
  'Komt eraan': 'Coming up', 'Op je beginscherm': 'On your home screen', 'Beleggingen': 'Investments', 'Order plaatsen': 'Place order',
  'Toevoegen aan volglijst': 'Add to watchlist', 'Naar de volglijst': 'To the watchlist', 'Naar Koppelingen': 'To connections',
  'Opnieuw proberen': 'Try again', 'Verbergen': 'Hide', 'Geen verbinding': 'No connection', 'Bewaarde stand': 'Saved snapshot',
  'Vandaag en widgets': 'Today and widgets', 'Vandaag bekijken': 'View today', 'Telefoon': 'Phone',
  'Korte trilling bij bevestigen en wisselen': 'Short vibration when confirming and switching',
  'Vergrendelen met vingerafdruk of gezicht': 'Lock with fingerprint or face', 'Vergrendeling aanzetten': 'Turn on lock', 'Vergrendeling uitzetten': 'Turn off lock',
  'Ontgrendel met je vingerafdruk, gezicht of de pincode van dit apparaat.': 'Unlock with your fingerprint, face or this device\u2019s PIN.',
  'Verplaatsen': 'Move', 'Klein': 'Small', 'Normaal': 'Normal', 'Groot': 'Large', 'Ongelezen nieuws en alarmen': 'Unread news and alerts',
  'Trek omlaag om te vernieuwen': 'Pull down to refresh', 'Laat los om te vernieuwen': 'Release to refresh', 'Bezig met vernieuwen\u2026': 'Refreshing\u2026',
  'Ga naar risico': 'Go to risk', 'Ga naar accountwaarde': 'Go to account value', 'Ga naar resultaat': 'Go to result', 'Ga naar stortingen': 'Go to deposits',
  'Toon bedragen (of verberg ze)': 'Show amounts (or hide them)', 'Vandaag in een oogopslag': 'Today at a glance',
});
const DICT = LANG === 'de' ? Object.assign({}, EN, DE) : LANG === 'fr' ? Object.assign({}, EN, FR) : EN;
const T = (s) => (LANG !== 'nl' ? DICT[s] || s : s);
function trText(s) {
  const t = s.trim();
  if (!t) return null;
  if (DICT[t]) return s.replace(t, DICT[t]);
  for (const [re, rep] of EN_RE) if (re.test(t)) return s.replace(t, t.replace(re, rep));
  return null;
}
function translateTree(root) {
  if (LANG === 'nl' || !root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  nodes.forEach((n) => { if (n.parentElement && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentElement.tagName)) return; const r = trText(n.nodeValue); if (r != null && r !== n.nodeValue) n.nodeValue = r; });
  (root.querySelectorAll ? root.querySelectorAll('[aria-label],[placeholder],[title]') : []).forEach((el) => ['aria-label', 'placeholder', 'title'].forEach((a) => { const v = el.getAttribute(a); if (v) { const r = trText(v); if (r != null && r !== v) el.setAttribute(a, r); } }));
}
if (LANG !== 'nl') {
  document.documentElement.lang = LANG;
  document.title = DICT['Investeringstracker'] || 'Investment tracker';
  // Alleen de stukken die veranderden, meteen (geen wachten op een volgend beeld: dat stopt in een tab op de achtergrond)
  const TR_OPTS = { childList: true, characterData: true, subtree: true };
  const mo = new MutationObserver((recs) => {
    mo.disconnect();
    const roots = new Set();
    recs.forEach((r) => {
      if (r.type === 'characterData') { if (r.target.parentElement) roots.add(r.target.parentElement); }
      else r.addedNodes.forEach((n) => { if (n.nodeType === 1) roots.add(n); else if (n.nodeType === 3 && n.parentElement) roots.add(n.parentElement); });
    });
    try { roots.forEach((el) => { if (el.isConnected) translateTree(el); }); }
    finally { mo.observe(document.body, TR_OPTS); }
  });
  translateTree(document.body);
  mo.observe(document.body, TR_OPTS);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-lang-pick]');
  if (!b) return;
  try { localStorage.setItem('tracker.lang', b.dataset.langPick); } catch (err) { /* niet erg */ }
  location.reload();
});
$$('[data-lang-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.langPick === LANG)));

// ---------- Inloggen met de Trading 212-sleutel (nieuw apparaat) ----------
// De Worker vergelijkt sleutel en secret met wat hij al heeft en geeft dan de toegangscode terug.
// Alle andere koppelingen staan in de Worker, dus die werken op dit apparaat meteen. De sleutel zelf wordt niet bewaard.
document.querySelectorAll('[data-login-form] [data-l="url"]').forEach((i) => { i.value = localStorage.getItem(LS_URL) || CFG.apiUrl || ''; });
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-login-go]');
  if (!b) return;
  const f = b.closest('[data-login-form]');
  const st = f.querySelector('.login-st');
  const say = (t, cls) => { st.textContent = t; st.className = 'small login-st ' + (cls || 'muted'); };
  const v = (k) => { const i = f.querySelector('[data-l="' + k + '"]'); return i ? i.value.trim() : ''; };
  const urlIn = f.querySelector('[data-l="url"]') ? v('url') : ($('in-url').value.trim() || getUrl());
  const url = urlIn || CFG.apiUrl || '';
  if (!/^https:\/\/[A-Za-z0-9.-]+\/api\/data$/.test(url)) { say('Vul het adres van je Cloudflare Worker in; het eindigt op /api/data.', 'loss'); return; }
  if (!v('key') || !v('secret')) { say('Vul je API-sleutel en secret van Trading 212 in.', 'loss'); return; }
  b.disabled = true; say('Bezig met inloggen…');
  try {
    const res = await fetch(url.replace(/\/api\/data$/, '/api/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: v('key'), secret: v('secret'), label: /android/i.test(navigator.userAgent) ? 'Android' : /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone/iPad' : /windows/i.test(navigator.userAgent) ? 'Windows' : /mac os/i.test(navigator.userAgent) ? 'Mac' : 'Apparaat' }) });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok || !j.token) throw new Error((j && j.error) || (res.status === 404 ? 'deze Worker kent inloggen met een sleutel nog niet; werk hem bij (Sync fork)' : 'de Worker antwoordde met status ' + res.status));
    localStorage.setItem(LS_TOKEN, j.token);
    if (!res.ok || !j || !j.ok || !j.token) throw new Error((j && j.error) || (res.status === 404 ? 'deze Worker kent inloggen met een sleutel nog niet; werk hem bij (Sync fork)' : 'de Worker gaf status ' + res.status));
    // Liever de eigen code van dit apparaat dan de toegangscode zelf (zie Privacy en veiligheid)
    localStorage.setItem(LS_TOKEN, j.session || j.token);
    if (url !== CFG.apiUrl) localStorage.setItem(LS_URL, url); else localStorage.removeItem(LS_URL);
    f.querySelectorAll('[data-l="key"],[data-l="secret"]').forEach((i) => { i.value = ''; });
    const K = (j.features && j.features.keys) || {};
    const on = [['FMP_KEY', 'FMP'], ['FINNHUB_KEY', 'Finnhub'], ['SEC_CONTACT', 'SEC'], ['FRED_KEY', 'FRED']].filter(([k]) => K[k]).map(([, n]) => n);
    say('Ingelogd. ' + (on.length ? 'Al gekoppeld: Trading 212, ' + on.join(', ') + '.' : 'Trading 212 is gekoppeld.'), 'gain');
    demo = false;
    if ($('dlg-settings').open) $('dlg-settings').close();
    load();
  } catch (err) { say(foutTekst('Inloggen is niet gelukt', err, 'Controleer het adres van je Worker en of je dezelfde Trading 212-sleutel en secret gebruikt als in de Worker.'), 'loss'); }
  finally { b.disabled = false; }
});

// ---------- Animaties aan of uit ----------
function syncMotionButtons() {
  const p = motionPref();
  $$('[data-motion-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.motionPick === p)));
  const n = $('motion-note');
  if (n) n.textContent = MOTION_MQ.matches ? 'Je apparaat vraagt om minder beweging (bij Windows: Instellingen > Toegankelijkheid > Visuele effecten > Animatie-effecten). Bij Automatisch staan animaties daarom uit; kies Aan om ze toch te tonen.' : 'Animaties volgen je apparaat; kies Uit als je liever geen beweging hebt.';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-motion-pick]');
  if (!b) return;
  try { localStorage.setItem('tracker.motion', b.dataset.motionPick); } catch (err) { /* niet erg */ }
  applyMotion(); syncMotionButtons(); markFresh();
});
syncMotionButtons();

// ---------- Updates van de site en app ----------
let swReg = null, swReload = false;
function showUpdate(on) {
  const el = $('update-banner');
  if (el) el.hidden = !on;
  if (typeof syncVersionText === 'function') syncVersionText();
}
function watchSw(reg) {
  swReg = reg;
  if (reg.waiting && navigator.serviceWorker.controller) showUpdate(true);
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing; if (!nw) return;
    nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(true); });
  });
  setInterval(() => reg.update().catch(() => {}), 30 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => { if (swReload) location.reload(); });
function applyUpdate() {
  swReload = true;
  if (swReg && swReg.waiting) swReg.waiting.postMessage('skip'); else location.reload();
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-upd]');
  if (!b) return;
  const st = $('upd-status');
  if (b.dataset.upd === 'now') { applyUpdate(); return; }
  if (b.dataset.upd === 'later') { showUpdate(false); return; }
  if (b.dataset.upd === 'check') {
    if (!swReg) { if (st) st.textContent = 'Updates controleren kan alleen op de website zelf (https).'; return; }
    if (st) st.textContent = 'Bezig met controleren…';
    try { await swReg.update(); } catch (err) { /* geen verbinding */ }
    setTimeout(() => { if (st) st.textContent = swReg.waiting || swReg.installing ? 'Er is een nieuwe versie. Kies Nu bijwerken.' : 'Je hebt de nieuwste versie.'; if (swReg.waiting) showUpdate(true); }, 1500);
  }
});
// Geen versienummer tonen: alleen of je de nieuwste versie hebt (bijgewerkt zodra er een nieuwe klaarstaat)
function syncVersionText() { const el = $('app-version'); if (el) el.textContent = swReg && swReg.waiting ? 'Er is een nieuwe versie.' : 'Je hebt de nieuwste versie.'; }
syncVersionText();

// ---------- Meldingen op dit apparaat (Web Push via je eigen Worker) ----------
// De Worker stuurt meldingen over grote koersbewegingen, kwartaalcijfers van morgen, aankopen door bestuurders
// en een verdeling die te veel afwijkt van je doel. Op iPhone en iPad werkt dit alleen in de geïnstalleerde app.
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && (location.protocol === 'https:' || location.hostname === 'localhost');
const keyBytes = (s) => { let t = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return Uint8Array.from(atob(t), (c) => c.charCodeAt(0)); };
let pushInfo = null;
async function currentSub() {
  if (!pushOk()) return null;
  const reg = swReg || (await navigator.serviceWorker.ready);
  return reg.pushManager.getSubscription();
}
async function renderPush(msg) {
  const box = $('push-body');
  if (!box) return;
  const say = (html) => { box.innerHTML = html + (msg ? '<p class="small plan-status" role="status">' + esc(msg) + '</p>' : ''); };
  if (sharedView) { say('<p class="muted small">Niet beschikbaar in een gedeelde weergave.</p>'); return; }
  if (demo) { say('<p class="muted small">In de voorbeeldweergave staan meldingen uit. Met je eigen tracker krijg je ze op je telefoon of computer.</p>'); return; }
  if (!isWorker() || !getToken()) { say('<p class="muted small">Meldingen werken met je eigen Cloudflare Worker. Sla eerst hierboven je toegangscode op.</p>'); return; }
  if (!pushOk()) {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    say('<p class="muted small">' + (ios ? 'Op iPhone en iPad werken meldingen alleen in de geïnstalleerde app: zet de tracker op je beginscherm (deelknop, Zet op beginscherm) en open hem daarvandaan.' : 'Deze browser ondersteunt geen pushmeldingen.') + '</p>');
    return;
  }
  try { pushInfo = await workerCall('/api/push/key', { method: 'GET' }); } catch (err) { say('<p class="small loss">Meldingen konden niet worden geladen: ' + esc(err.message) + '. Werk je Worker bij als dit blijft.</p>'); return; }
  const sub = await currentSub();
  const R = pushInfo.rules || {};
  const blocked = Notification.permission === 'denied';
  say('<p class="small">' + (sub ? '<span class="tag gain">Aan</span> op dit apparaat' : '<span class="tag">Uit</span> op dit apparaat') + (pushInfo.devices ? ' · ' + pushInfo.devices + (pushInfo.devices === 1 ? ' apparaat' : ' apparaten') + ' aangemeld' : '') + '</p>' +
    (blocked ? '<p class="small loss">Je browser blokkeert meldingen voor deze site. Sta ze toe via het slotje naast het adres en probeer het opnieuw.</p>' : '') +
    '<div class="alert-rules">' +
      '<label class="small">Koersbeweging vanaf<span class="eur-in"><input type="number" min="0" max="50" step="0.5" data-rule="move" value="' + esc(R.move != null ? R.move : 5) + '">%</span></label>' +
      '<label class="small">Afwijking van je doel vanaf<span class="eur-in"><input type="number" min="0" max="50" step="0.5" data-rule="drift" value="' + esc(R.drift != null ? R.drift : 5) + '">pp</span></label>' +
      '<label class="check small"><input type="checkbox" data-rule="earnings"' + (R.earnings !== false ? ' checked' : '') + '> Kwartaalcijfers van morgen</label>' +
      '<label class="check small"><input type="checkbox" data-rule="insider"' + (R.insider !== false ? ' checked' : '') + '> Bestuurders en grote beleggers die kopen of verkopen</label>' +
      '<label class="check small"><input type="checkbox" data-rule="ratings"' + (R.ratings !== false ? ' checked' : '') + '> Analisten die van mening veranderen</label>' +
    '</div>' +
    '<div class="dlg-actions" style="justify-content:flex-start;margin-top:8px">' +
      (sub ? '<button type="button" class="btn ghost" data-push="off">Uitzetten op dit apparaat</button><button type="button" class="btn ghost" data-push="test">Testmelding</button>'
        : '<button type="button" class="btn primary" data-push="on"' + (blocked ? ' disabled' : '') + '>Meldingen aanzetten</button>') +
      '<button type="button" class="btn ghost" data-push="rules">Regels opslaan</button></div>' +
    '<p class="muted small" style="margin-top:6px">Koersbewegingen tegenover het slot van de vorige handelsdag, tijdens de meettijden; het totaal van je portefeuille vanaf de helft van de drempel. Elke melding komt hoogstens één keer per dag.</p>');
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-push]');
  if (!b) return;
  const act = b.dataset.push;
  b.disabled = true;
  try {
    if (act === 'on') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { await renderPush('Zonder toestemming kan de browser geen meldingen tonen.'); return; }
      const reg = swReg || (await navigator.serviceWorker.ready);
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(pushInfo.key) });
      const label = /android/i.test(navigator.userAgent) ? 'Android' : /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone/iPad' : /windows/i.test(navigator.userAgent) ? 'Windows' : /mac os/i.test(navigator.userAgent) ? 'Mac' : 'Apparaat';
      await workerCall('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ sub: sub.toJSON(), label }) });
      await renderPush('Meldingen staan aan op dit apparaat.');
    } else if (act === 'off') {
      const sub = await currentSub();
      if (sub) { await workerCall('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      await renderPush('Meldingen staan uit op dit apparaat.');
    } else if (act === 'test') {
      const r = await workerCall('/api/push/test', { method: 'POST' });
      await renderPush(r.sent ? 'Testmelding verstuurd naar ' + r.sent + (r.sent === 1 ? ' apparaat.' : ' apparaten.') : 'Er ging geen melding uit; zet meldingen opnieuw aan.');
    } else if (act === 'rules') {
      const v = (k) => /** @type {HTMLInputElement} */ (document.querySelector('#push-body [data-rule="' + k + '"]'));
      await saveSettings({ alerts: { move: Number(v('move').value) || 0, drift: Number(v('drift').value) || 0, earnings: v('earnings').checked, insider: v('insider').checked, ratings: v('ratings').checked } });
      await renderPush('Regels opgeslagen.');
    }
  } catch (err) { await renderPush(foutTekst('Meldingen aanzetten is niet gelukt', err, 'Sta meldingen toe in de site-instellingen van je browser en probeer het opnieuw.')); }
  finally { b.disabled = false; }
});

// Weekmail: met of zonder bedragen, en een testmail (de rij staat bij Koppelingen)
document.addEventListener('change', async (e) => {
  const cb = e.target.closest && e.target.closest('input[data-mail-amounts]');
  if (!cb) return;
  try { await saveSettings({ mailAmounts: cb.checked }); renderLinks(cb.checked ? 'De weekmail bevat bedragen.' : 'De weekmail bevat alleen procenten.'); }
  catch (err) { renderLinks(foutTekst('De instelling kon niet worden opgeslagen', err)); }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-mail-test]');
  if (!b) return;
  b.disabled = true;
  try { const r = await workerCall('/api/mail/test', { method: 'POST' }); renderLinks(r.message || 'Testmail verstuurd.'); }
  catch (err) { renderLinks(foutTekst('De testmail is niet verstuurd', err, 'Controleer je Resend-sleutel en of het ontvangstadres bij je Resend-account hoort.')); }
  finally { b.disabled = false; }
});

// ---------- Deel-link (alleen lezen) ----------
const workerOrigin = () => getUrl().replace(/\/api\/data$/, '');
const b64uStr = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const shareLink = (token) => location.origin + location.pathname + '?gedeeld=' + b64uStr(workerOrigin()) + '.' + token;
async function renderShare(msg) {
  const box = $('share-body');
  if (!box) return;
  const say = (html) => { box.innerHTML = html + (msg ? '<p class="small plan-status" role="status">' + esc(msg) + '</p>' : ''); };
  if (sharedView) { say('<p class="muted small">Je bekijkt zelf een gedeelde weergave.</p>'); return; }
  if (demo || !isWorker() || !getToken()) { say('<p class="muted small">Delen werkt met je eigen Cloudflare Worker.</p>'); return; }
  let st;
  try { st = await workerCall('/api/share', { method: 'GET' }); } catch (err) { say('<p class="small loss">Kon de deel-link niet laden: ' + esc(err.message) + '.</p>'); return; }
  if (!st.on) {
    say('<p class="muted small">Maak een link waarmee iemand anders je portefeuille kan bekijken, zonder je toegangscode en zonder iets te kunnen wijzigen. Notities, andere rekeningen en sleutels worden nooit gedeeld.</p>' +
      '<label class="check small"><input type="checkbox" id="share-amounts"> Met bedragen (anders alleen procenten en verhoudingen)</label>' +
      '<div class="dlg-actions" style="justify-content:flex-start;margin-top:6px"><button type="button" class="btn ghost" data-share="on">Deel-link maken</button></div>');
    return;
  }
  say('<div class="key-in"><input id="share-url" type="text" readonly value="' + esc(shareLink(st.token)) + '" aria-label="Deel-link"><button type="button" class="btn ghost" data-share="copy">Kopiëren</button></div>' +
    '<label class="check small"><input type="checkbox" id="share-amounts"' + (st.amounts ? ' checked' : '') + ' data-share-amounts> Met bedragen</label>' +
    '<p class="muted small">Iedereen met deze link ziet je portefeuille' + (st.amounts ? ' met bedragen' : ', zonder echte bedragen') + '. Maak een nieuwe link om de oude in te trekken.</p>' +
    '<div class="dlg-actions" style="justify-content:flex-start;margin-top:6px"><button type="button" class="btn ghost" data-share="rotate">Nieuwe link maken</button><button type="button" class="btn ghost danger" data-share="off">Uitzetten</button></div>');
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-share]');
  if (!b) return;
  const act = b.dataset.share;
  if (act === 'copy') { const i = $('share-url'); i.select(); try { await navigator.clipboard.writeText(i.value); b.textContent = 'Gekopieerd'; } catch (err) { /* geselecteerd om zelf te kopiëren */ } return; }
  b.disabled = true;
  try {
    const amounts = $('share-amounts') ? $('share-amounts').checked : false;
    await workerCall('/api/share', { method: 'POST', body: JSON.stringify({ action: act, amounts }) });
    await renderShare(act === 'off' ? 'Deel-link uitgezet; de oude link werkt niet meer.' : act === 'rotate' ? 'Nieuwe link gemaakt; de oude werkt niet meer.' : 'Deel-link gemaakt.');
  } catch (err) { await renderShare(foutTekst('De deel-link kon niet worden gewijzigd', err)); }
  finally { b.disabled = false; }
});
document.addEventListener('change', async (e) => {
  const cb = e.target.closest && e.target.closest('input[data-share-amounts]');
  if (!cb) return;
  try { await workerCall('/api/share', { method: 'POST', body: JSON.stringify({ action: 'update', amounts: cb.checked }) }); await renderShare(cb.checked ? 'De link toont nu bedragen.' : 'De link toont nu alleen procenten.'); }
  catch (err) { await renderShare(foutTekst('De deel-link kon niet worden bijgewerkt', err)); }
});

// ---------- Geschiedenis inlezen uit een Trading 212-export (CSV) ----------
// In de app: Geschiedenis > exporteren. Orders en dividenden gaan naar je Worker; wat er al was, wordt overgeslagen.
function parseT212Csv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('het bestand is leeg');
  const head = parseCsvLine(lines[0], ',').map((h) => h.toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const I = { act: col(/^action$/), time: col(/^time$/), tk: col(/^ticker$/), name: col(/^name$/), qty: col(/^no\. of shares$/), price: col(/^price \/ share$/), cur: col(/^currency \(price \/ share\)$/),
    fx: col(/^exchange rate$/), res: col(/^result$/), total: col(/^total$/), totalCur: col(/^currency \(total\)$/), wht: col(/^withholding tax$/), whtCur: col(/^currency \(withholding tax\)$/),
    feeFx: col(/^currency conversion fee$/), stamp: col(/stamp duty/), ftt: col(/french transaction tax/), id: col(/^id$/) };
  if (I.act < 0 || I.time < 0 || I.tk < 0) throw new Error('dit lijkt geen export van Trading 212 (kolommen Action, Time en Ticker ontbreken)');
  const orders = [], dividends = [], interest = [];
  lines.slice(1).forEach((l, n) => {
    const c = parseCsvLine(l, ',');
    const act = c[I.act] || '', ts = Date.parse(String(c[I.time] || '').replace(' ', 'T') + 'Z');
    const v = (i) => (i >= 0 ? parseNum(c[i]) : null);
    if (!isNum(ts)) return;
    if (/buy|sell/i.test(act)) {
      orders.push({ id: c[I.id] || ('r' + n + '-' + ts), ts, tk: c[I.tk], name: c[I.name], side: /sell/i.test(act) ? 'SELL' : 'BUY', qty: v(I.qty), price: v(I.price), cur: c[I.cur],
        fx: v(I.fx), net: v(I.total), realised: v(I.res), feeFx: v(I.feeFx), feeOther: (v(I.stamp) || 0) + (v(I.ftt) || 0) });
    } else if (/interest/i.test(act)) {
      interest.push({ date: new Date(ts).toISOString().slice(0, 10), amount: v(I.total) });
    } else if (/^dividend/i.test(act)) {
      dividends.push({ tk: c[I.tk], date: new Date(ts).toISOString().slice(0, 10), amount: v(I.total), perShare: v(I.price), qty: v(I.qty), wht: v(I.wht), whtCur: I.whtCur >= 0 ? c[I.whtCur] : null });
    }
  });
  if (!orders.length && !dividends.length && !interest.length) throw new Error('geen aankopen, verkopen, dividenden of rente gevonden');
  return { orders, dividends, interest };
}
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (!(el.matches && el.matches('input[type="file"][data-t212csv]')) || !el.files[0]) return;
  const st = $('t212csv-status');
  const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'small plan-status ' + (cls || ''); } };
  try {
    if (demo || sharedView) throw new Error('dit kan alleen met je eigen tracker');
    if (!isWorker()) throw new Error('dit kan alleen met de Cloudflare Worker');
    say('Bezig met inlezen…');
    const P = parseT212Csv(await el.files[0].text());
    let o = 0, sk = 0, dv = 0, it = 0;
    for (let i = 0; i < Math.max(P.orders.length, 1); i += 1000) {
      const r = await workerCall('/api/import-csv', { method: 'POST', body: JSON.stringify({ orders: P.orders.slice(i, i + 1000), dividends: i ? [] : P.dividends, interest: i ? [] : P.interest }) });
      o += r.orders; sk += r.skipped; dv += r.dividends; it += r.interest || 0;
    }
    say(o + ' orders, ' + dv + ' dividenden en ' + it + ' rentebetalingen toegevoegd' + (sk ? '; ' + sk + ' orders stonden er al' : '') + '. De gegevens worden opnieuw geladen.', 'gain');
    load();
  } catch (err) { say(foutTekst('Het bestand kon niet worden ingelezen', err, 'Kies het JSON-bestand dat je met Reservekopie downloaden hebt opgeslagen.'), 'loss'); }
  el.value = '';
});

// ---------- Herbalanceren: melding op het overzicht als je verdeling te ver van je doel ligt ----------
function driftModel() {
  const S = M.settings || {};
  const t = S.targets || {};
  if (!Object.keys(t).length) return null;
  const items = allocItems(S.targetMode || 'position');
  const lim = S.alerts && isNum(S.alerts.drift) && S.alerts.drift > 0 ? S.alerts.drift : 5;
  const diffs = items.filter((x) => isNum(t[x.key]) && t[x.key] > 0).map((x) => ({ x, d: x.w * 100 - t[x.key] })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const big = diffs.filter((o) => Math.abs(o.d) >= lim);
  return big.length ? { big, lim } : null;
}
function renderDriftNote() {
  const html = (() => {
    if (!M || sharedView) return '';
    const D = driftModel();
    if (!D) return '';
    return '<a class="drift-note" href="#plannen"><b>Je verdeling wijkt af van je doel</b><span>' + esc(D.big.slice(0, 3).map((o) => o.x.label + ' ' + sgn(o.d, N1) + ' pp').join(', ')) +
      '. Op Plannen zie je wat je met nieuwe inleg kunt kopen om weer dichter bij je doel te komen.</span><span class="more" aria-hidden="true">Naar Plannen ›</span></a>';
  })();
  const all = html + (typeof concNote === 'function' ? concNote() : '');
  ['drift-note', 'm-drift-note'].forEach((id) => { if ($(id)) $(id).innerHTML = all; });
}

// =====================================================================
// ---------- Status van je tracker (#status) ----------
let statusCache = null;
function demoStatus() {
  return { now: new Date().toISOString(), lastMeasurement: M && M.lastT ? new Date(M.lastT).toISOString() : null, live: true, lastCron: new Date().toISOString(), lastError: null, tickFails: 0,
    lastWeek: M && M.lastWeek ? new Date(M.lastWeek.t).toISOString().slice(0, 10) : null, ordersSynced: new Date().toISOString().slice(0, 10), marketPlanned: new Date().toISOString().slice(0, 10),
    queue: 12, fmpCalls: { n: 84 }, avCalls: { n: 6 }, errors: {}, health: { fmp: { backup: 'Finnhub', backupAt: new Date().toISOString() } },
    rows: { intraday: 3960, hours: 6420, days: 980, weeks: 13, orders: 31 }, sizes: { data_core: 41200, data_extra: 188000, data_series: 712000 }, devices: 2,
    companies: '{"n":10412,"updated":"' + new Date().toISOString().slice(0, 10) + '","source":"SEC"}',
    keys: { T212_KEY: true, FMP_KEY: true, FINNHUB_KEY: true, SEC_CONTACT: true, ALPHAVANTAGE_KEY: false, TWELVEDATA_KEY: false, RESEND_KEY: false } };
}
async function loadStatus() {
  if (demo) { statusCache = demoStatus(); return statusCache; }
  if (!isWorker() || !getToken()) throw new Error('de status komt van je eigen Cloudflare Worker');
  statusCache = (await workerCall('/api/status', { method: 'GET' })).status;
  return statusCache;
}
const kb = (n) => (isNum(n) ? (n >= 1e6 ? N1.format(n / 1e6) + ' MB' : NI.format(n / 1e3) + ' kB') : '–');
const ago = (s) => { if (!s) return 'nog nooit'; const t = new Date(s).getTime(); const m = Math.round((Date.now() - t) / 60000); return fDT.format(t) + ' (' + (m < 1 ? 'net' : m < 90 ? m + ' min geleden' : m < 2880 ? Math.round(m / 60) + ' uur geleden' : Math.round(m / 1440) + ' dagen geleden') + ')'; };
function renderStatusView() {
  const S = statusCache;
  if (!S) {
    loadStatus().then(() => { if (ui.detail === STATUS) renderDetail(false); }).catch((err) => { statusCache = { error: err.message }; if (ui.detail === STATUS) renderDetail(false); });
    return pseudoPage('Status', pseudoHead('Status van je tracker', 'Bezig met laden…', ''), [[]], []);
  }
  if (S.error) return pseudoPage('Status', pseudoHead('Status van je tracker', 'Niet beschikbaar', foutTekst('De status kon niet worden opgehaald', S.error, 'Controleer bij Instellingen je toegangscode en het adres van je Worker.')), [[]], []);
  const lastM = S.lastMeasurement ? new Date(S.lastMeasurement).getTime() : null;
  const stale = S.live && lastM && Date.now() - lastM > 2 * HOUR;
  const ok = !stale && !(S.tickFails >= 3);
  const H = S.health || {};
  const healthRows = Object.entries(H).map(([src, h]) => [SOURCE_NAMES[src] || src, (h.until && h.until > Date.now() ? 'tijdelijk uit tot ' + fDT.format(h.until) + '. ' : '') + (h.backup ? 'reserve: ' + h.backup : h.msg || 'fouten: ' + h.fails), h.until && h.until > Date.now() ? 'loss' : '']);
  const errRows = Object.entries(S.errors || {}).map(([src, e]) => [src, e.msg + ' (' + fDT.format(new Date(e.at)) + ')', 'loss']);
  const meas = '<section class="tile pad"><h3>Metingen</h3>' + kvList([
    ['Laatste meting', ago(S.lastMeasurement), stale ? 'loss' : ''],
    ['Meettijden nu', S.live ? 'ja (werkdagen 08:00–22:30)' : 'nee'],
    ['Laatste geplande run', ago(S.lastCron)],
    ['Mislukte metingen op rij', String(S.tickFails || 0), S.tickFails >= 3 ? 'loss' : ''],
    ['Laatste fout', S.lastError || 'geen', S.lastError ? 'loss' : ''],
    ['Laatste weekmeting', S.lastWeek || '–'],
    ['Orders opgehaald', S.ordersSynced || '–'],
  ]) + '</section>';
  const src = '<section class="tile pad"><h3>Bronnen</h3>' + kvList([
    ['Marktgegevens ingepland', S.marketPlanned || '–'],
    ['Taken in de wachtrij', String(S.queue)],
    ['FMP-verzoeken vandaag', S.fmpCalls && isNum(S.fmpCalls.n) ? S.fmpCalls.n + ' van 250' : '–'],
    ['Alpha Vantage vandaag', S.avCalls && isNum(S.avCalls.n) ? S.avCalls.n + ' van 25' : '–'],
    ['Bedrijvenlijst om te zoeken', (() => { try { const c = JSON.parse(S.companies || 'null'); return c ? NI.format(c.n) + ' bedrijven, ' + c.updated : 'nog niet (vraagt het SEC-e-mailadres)'; } catch (e) { return '–'; } })()],
    ['Meldingen', S.devices ? S.devices + (S.devices === 1 ? ' apparaat' : ' apparaten') : 'geen apparaat aangemeld'],
  ].concat(healthRows, errRows)) + '</section>';
  const db = '<section class="tile pad"><h3>Database</h3>' + kvList([
    ['Metingen per 10 minuten', NI.format(S.rows.intraday || 0) + ' (laatste 3 dagen)'],
    ['Uurregels', NI.format(S.rows.hours || 0)],
    ['Dagregels', NI.format(S.rows.days || 0)],
    ['Weken', NI.format(S.rows.weeks || 0)],
    ['Orders', NI.format(S.rows.orders || 0)],
    ['Overzicht voor de site', kb(S.sizes.data_core) + ' + ' + kb(S.sizes.data_extra) + ' + ' + kb(S.sizes.data_series)],
  ]) + '<p class="sub" style="margin-top:8px">Na drie dagen worden metingen per 10 minuten uurregels; elke maand ruimt de Worker uurregels ouder dan 180 dagen op (de dagregels blijven). Een reservekopie maak je bij Instellingen.</p></section>';
  const keys = '<section class="tile pad"><h3>Koppelingen</h3>' + kvList(Object.entries(S.keys || {}).map(([k, v]) => [k.replace(/_KEY|_CONTACT/g, '').replace('T212', 'Trading 212').replace('_', ' '), v ? 'ingesteld' : 'niet ingesteld', v ? 'gain' : ''])) + '</section>';
  const head = pseudoHead('Status van je tracker', ok ? 'Alles werkt' : stale ? 'Geen nieuwe metingen' : 'Er gaat iets mis', ok ? 'Laatste meting ' + ago(S.lastMeasurement) + '.' : 'Bekijk hieronder de laatste fout. Een melding volgt na drie mislukte metingen.', ok ? 'gain' : 'loss');
  const extra = statusExtraRows(S).concat(typeof bronnenRows === 'function' ? bronnenRows(S) : []);
  return pseudoPage('Status', head, [[meas, src], [db, keys]].concat(extra), [meas, src, db, keys].concat(...extra));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-goto-status]');
  if (!b) return;
  if ($('dlg-settings').open) $('dlg-settings').close();
  statusCache = null;
  location.hash = '#status';
});

// =====================================================================
// ---------- Reservekopie downloaden en terugzetten ----------
async function makeBackup(say) {
  const man = await workerCall('/api/backup', { method: 'GET' });
  const out = { format: man.format, version: man.version, created: man.created, tables: {} };
  for (const t of Object.keys(man.tables)) {
    const rows = [];
    for (let off = 0; ; off += man.page) {
      say('Bezig: ' + t + ' (' + NI.format(rows.length) + ' van ' + NI.format(man.tables[t]) + ')…');
      const r = await workerCall('/api/backup?table=' + t + '&offset=' + off, { method: 'GET' });
      r.rows.forEach((x) => rows.push(x));
      if (r.rows.length < man.page) break;
    }
    out.tables[t] = rows;
  }
  return out;
}
async function restoreBackup(b, say) {
  if (!b || b.format !== 'investeringstracker-backup' || !b.tables) throw new Error('dit is geen reservekopie van de tracker');
  const names = Object.keys(b.tables);
  for (let k = 0; k < names.length; k++) {
    const t = names[k], rows = b.tables[t] || [];
    for (let off = 0; off < Math.max(rows.length, 1); off += 2000) {
      say('Bezig: ' + t + ' (' + NI.format(Math.min(off + 2000, rows.length)) + ' van ' + NI.format(rows.length) + ')…');
      await workerCall('/api/restore', { method: 'POST', body: JSON.stringify({ table: t, rows: rows.slice(off, off + 2000), done: k === names.length - 1 && off + 2000 >= rows.length }) });
    }
  }
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-backup]');
  if (!b) return;
  const st = $('backup-status');
  const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'small plan-status ' + (cls || ''); } };
  if (demo || sharedView || !isWorker()) { say('Een reservekopie kan alleen van je eigen tracker.', 'loss'); return; }
  b.disabled = true;
  try {
    const out = await makeBackup(say);
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'investeringstracker-reservekopie-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    say('Reservekopie gedownload (' + kb(blob.size) + '). Bewaar hem op een veilige plek; er staan geen sleutels in.', 'gain');
  } catch (err) { say(foutTekst('De reservekopie kon niet worden gemaakt', err, 'Probeer het opnieuw; bij een grote database kan het even duren.'), 'loss'); }
  finally { b.disabled = false; }
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (!(el.matches && el.matches('input[type="file"][data-restore]')) || !el.files[0]) return;
  const st = $('backup-status');
  const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'small plan-status ' + (cls || ''); } };
  try {
    if (demo || sharedView || !isWorker()) throw new Error('terugzetten kan alleen in je eigen tracker');
    const b = JSON.parse(await el.files[0].text());
    const n = Object.values(b.tables || {}).reduce((s, r) => s + (r ? r.length : 0), 0);
    if (!confirm('Reservekopie van ' + (b.created || '?') + ' terugzetten (' + NI.format(n) + ' regels)? Bestaande regels met dezelfde datum of hetzelfde id worden overschreven; de rest blijft staan.')) { el.value = ''; return; }
    await restoreBackup(b, say);
    say('Teruggezet. De gegevens worden opnieuw geladen.', 'gain');
    load();
  } catch (err) { say(foutTekst('Terugzetten is niet gelukt', err, 'De gegevens in je Worker zijn niet veranderd. Probeer het opnieuw met hetzelfde bestand.'), 'loss'); }
  el.value = '';
});

// =====================================================================
// ---------- Volglijst: bedrijven zoeken, ongeldige symbolen opruimen ----------
const DEMO_COMPANIES = [['NVDA', 'NVIDIA Corp'], ['LMT', 'Lockheed Martin Corp'], ['NOC', 'Northrop Grumman Corp'], ['BA', 'Boeing Co'], ['RTX', 'RTX Corp'], ['GD', 'General Dynamics Corp'],
  ['AIR', 'AAR Corp'], ['TCEHY', 'Tencent Holdings Ltd (ADR)'], ['PEP', 'PepsiCo Inc'], ['MNST', 'Monster Beverage Corp'], ['KDP', 'Keurig Dr Pepper Inc'], ['COST', 'Costco Wholesale Corp'],
  ['AVGO', 'Broadcom Inc'], ['NFLX', 'Netflix Inc'], ['JPM', 'JPMorgan Chase & Co'], ['V', 'Visa Inc'], ['MA', 'Mastercard Inc'], ['ADBE', 'Adobe Inc'], ['AMD', 'Advanced Micro Devices Inc'], ['INTC', 'Intel Corp'],
  ['ASML.AS', 'ASML Holding NV (Amsterdam)'], ['ADYEN.AS', 'Adyen NV (Amsterdam)'], ['SHELL.AS', 'Shell plc (Amsterdam)'], ['BRK.B', 'Berkshire Hathaway Inc'], ['UNH', 'UnitedHealth Group Inc'], ['XOM', 'Exxon Mobil Corp']];
async function searchCompaniesSite(q) {
  const Q = q.trim().toUpperCase();
  if (Q.length < 1) return [];
  if (!demo && isWorker() && getToken()) {
    try { return (await workerCall('/api/search?q=' + encodeURIComponent(q.trim()), { method: 'GET' })).results || []; } catch (e) { /* oudere Worker: hieronder lokaal zoeken */ }
  }
  const list = DEMO_COMPANIES.slice();
  if (M && M.mk.ok) Object.values((data.market && data.market.profiles) || {}).forEach((p) => list.push([p.symbol, p.name || '']));
  Object.values(data.etf || {}).forEach((E) => (E.rows || []).forEach((r) => list.push([normTk(String(r[0])), String(r[1] || '')])));
  const seen = new Set();
  return list.filter(([s, n]) => (s.startsWith(Q) || n.toUpperCase().includes(Q)) && !seen.has(s) && seen.add(s))
    .sort((a, b) => (b[0] === Q) - (a[0] === Q) || (b[0].startsWith(Q)) - (a[0].startsWith(Q))).slice(0, 12).map(([sym, name]) => ({ sym, name, exchange: '' }));
}
let searchTimer = null, searchSeq = 0;
document.addEventListener('input', (e) => {
  const inp = e.target.closest && e.target.closest('[data-watchform] input');
  if (!inp) return;
  const box = inp.closest('[data-watchform]').querySelector('.ws-results');
  clearTimeout(searchTimer);
  if (!inp.value.trim()) { box.innerHTML = ''; box.hidden = true; return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    const res = await searchCompaniesSite(inp.value);
    if (seq !== searchSeq) return;
    const held = new Set([...M.byTk.keys()].concat(M.mk.ok ? Object.values(data.market.symbols || {}) : []));
    const on = new Set(watchSyms());
    box.innerHTML = res.length ? res.map((r) => '<button type="button" class="ws-hit" data-xa="watch-pick" data-k="' + esc(r.sym) + '"' + (held.has(r.sym) || on.has(r.sym) ? ' disabled' : '') + '><b>' + esc(r.sym) + '</b><span>' + esc(r.name) + '</span>' +
      '<span class="muted small">' + esc(held.has(r.sym) ? 'in bezit' : on.has(r.sym) ? 'volg je al' : r.exchange || '') + '</span></button>').join('')
      : '<p class="small muted" style="padding:8px 12px">Niets gevonden. Probeer de naam of het beurssymbool.</p>';
    box.hidden = false;
  }, 220);
});
document.addEventListener('click', (e) => {
  if (e.target.closest && !e.target.closest('[data-watchform]')) $$('.ws-results').forEach((b) => { b.hidden = true; });
});
function unknownSyms() { return M && M.mk ? watchSyms().filter((s) => !(M.mk.ok && M.mk.prof(s)) && ((data.market && data.market.unknown) || []).includes(s)) : []; }
// Klikken in de volglijst: kiezen uit de zoekresultaten, toch toevoegen, verwijderen, ongeldige opruimen
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-xa^="watch-"]');
  if (!b || b.dataset.xa === 'watch-add') return;
  const f = b.closest('[data-watchform]') || document.querySelector('[data-watchform]');
  const st = f ? f.querySelector('.watch-status') : null;
  const act = b.dataset.xa, sym = b.dataset.k;
  if (act === 'watch-pick' || act === 'watch-force') {
    const list = watchSyms().slice();
    if (list.includes(sym)) return;
    if (list.length >= 30) { if (st) { st.textContent = 'Maximaal 30 aandelen.'; st.className = 'small watch-status loss'; } return; }
    if (f) { f.querySelector('input').value = ''; const r = f.querySelector('.ws-results'); r.innerHTML = ''; r.hidden = true; }
    setWatchlist((cur) => (cur.includes(sym) ? cur : cur.concat([sym])), st, sym + ' staat op je volglijst.').catch(() => {});
  } else if (act === 'watch-remove') {
    setWatchlist((cur) => cur.filter((x) => x !== sym), st, sym + ' is van je volglijst gehaald.').catch(() => {});
  } else if (act === 'watch-clean') {
    const bad = new Set(unknownSyms());
    setWatchlist((cur) => cur.filter((x) => !bad.has(x)), st, bad.size + (bad.size === 1 ? ' ongeldig symbool' : ' ongeldige symbolen') + ' verwijderd.').catch(() => {});
  } else if (act === 'watch-more') { xs.suggN = xs.suggN === 20 ? 10 : 20; renderWatch(); }
  else if (act === 'watch-next') { xs.suggOff = (xs.suggOff || 0) + (xs.suggN || 10); renderWatch(); }
});

// =====================================================================
// ---------- Koersalarm per aandeel ----------
const alertsOf = (sym) => ((M.settings && M.settings.priceAlerts) || []).filter((a) => a.sym === sym);
function priceAlertTile(sym, price, cur) {
  const list = alertsOf(sym);
  const pf = (v) => (isNum(v) ? money(v, cur || 'USD') : '–');
  return '<section class="tile pad price-alerts" data-alert-sym="' + esc(sym) + '"><h3>Koersalarm</h3>' +
    (list.length ? '<div class="tx-list">' + list.map((a) => '<div class="tx"><span class="tag' + (a.on ? ' gain' : '') + '">' + (a.on ? 'Aan' : a.hit ? 'Afgegaan' : 'Uit') + '</span>' +
      '<span class="tx-m"><b>' + esc((a.op === 'below' ? 'Onder ' : 'Boven ') + pf(a.price)) + '</b><span class="sub">' + esc(a.hit ? 'afgegaan ' + fDT.format(new Date(a.hit)) + (isNum(a.hitPrice) ? ' bij ' + pf(a.hitPrice) : '') : isNum(price) ? (a.op === 'below' ? 'nog ' + P1.format(Math.max(0, price / a.price - 1)) + ' erboven' : 'nog ' + P1.format(Math.max(0, a.price / price - 1)) + ' eronder') : '') + '</span></span>' +
      '<span class="tx-v"><button type="button" class="linklike small" data-palert="toggle" data-id="' + esc(a.id) + '">' + (a.on ? 'Uitzetten' : 'Aanzetten') + '</button> <button type="button" class="linklike small danger" data-palert="del" data-id="' + esc(a.id) + '">Wissen</button></span></div>').join('') + '</div>'
      : '<p class="muted small">Krijg een melding als de koers onder of boven een bedrag komt.</p>') +
    '<div class="palert-add"><label class="sr-only" for="pa-op-' + esc(sym) + '">Richting</label><select id="pa-op-' + esc(sym) + '" data-pa="op"><option value="below">onder</option><option value="above">boven</option></select>' +
    '<span class="eur-in">' + esc(CUR_SYM[cur] || (cur ? cur + ' ' : '$')) + '<input type="number" inputmode="decimal" min="0" step="any" data-pa="price" value="' + (isNum(price) ? Math.round(price * 0.95 * 100) / 100 : '') + '" aria-label="Koers voor het alarm"></span>' +
    '<button type="button" class="btn ghost" data-palert="add">Alarm toevoegen</button></div>' +
    '<p class="sub" style="margin-top:8px">Koers ' + (isNum(price) ? 'nu ' + esc(pf(price)) + ', ' : '') + 'in de munt van het aandeel. Tijdens de meettijden kijkt de Worker elke 10 minuten; na een melding gaat het alarm uit.' +
      (pushOk() && Notification.permission !== 'granted' && !demo ? ' Zet meldingen aan bij Instellingen.' : '') + '</p><p class="small plan-status palert-st" role="status"></p></section>';
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-palert]');
  if (!b) return;
  const box = b.closest('[data-alert-sym]');
  const sym = box.dataset.alertSym, st = box.querySelector('.palert-st');
  const all = ((M.settings && M.settings.priceAlerts) || []).map((a) => Object.assign({}, a));
  let next = all;
  if (b.dataset.palert === 'add') {
    const price = Number(box.querySelector('[data-pa="price"]').value);
    if (!(price > 0)) { st.textContent = 'Vul een koers in.'; st.className = 'small plan-status palert-st loss'; return; }
    if (all.length >= 30) { st.textContent = 'Maximaal 30 alarmen.'; st.className = 'small plan-status palert-st loss'; return; }
    next = all.concat([{ id: Math.random().toString(36).slice(2, 10), sym, op: box.querySelector('[data-pa="op"]').value, price, on: true }]);
  } else if (b.dataset.palert === 'toggle') next = all.map((a) => (a.id === b.dataset.id ? Object.assign(a, { on: !a.on, hit: a.on ? a.hit : null }) : a));
  else if (b.dataset.palert === 'del') next = all.filter((a) => a.id !== b.dataset.id);
  b.disabled = true;
  try { await saveSettings({ priceAlerts: next }); rerenderAll(); }
  catch (err) { const t = foutTekst('Het koersalarm kon niet worden opgeslagen', err, 'Alarmen staan in je Worker; controleer bij Instellingen je toegangscode en probeer het opnieuw.'); st.textContent = t; st.className = 'small plan-status palert-st loss'; b.disabled = false; toastErr(t); }
});
