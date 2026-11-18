# Voorbeeldantwoorden van de externe bronnen

Deze bestanden zijn **nagemaakte** antwoorden in de vorm die de bronnen volgens hun documentatie teruggeven:
Trading 212, Finnhub, Financial Modeling Prep en Alpha Vantage. `worker/test/contract.mjs` voert ze aan de
Worker en controleert of hij ze nog goed leest. Verandert een bron de naam van een veld, dan valt die test om
in plaats van dat de site stilletjes lege tegels toont.

- Alle getallen, namen en datums zijn verzonnen. Er staan **geen sleutels, tokens of eigen gegevens** in.
- De tickers zijn bekende, openbare fondsen; de aantallen en bedragen horen bij niemand.
- Bijwerken doe je met de hand: kijk in de documentatie van de bron wat er verandert, pas het veld hier aan
  en laat de test zien dat de Worker het nog leest.
