# Investment tracker

Persoonlijke beleggingstracker voor Trading 212: een Google Sheet die via de Trading 212 API wordt gevuld, met een eigen dashboardwebsite.

- `apps-script/Code.gs`: het Apps Script dat aan de Google Sheet hangt (wekelijkse snapshots, metingen elke 10 minuten, terugrekenen van oude weken, JSON-koppeling voor de website).
- `docs/`: de website (GitHub Pages).

Er staan geen sleutels of portefeuillegegevens in deze repository. De Trading 212 API-sleutel staat alleen in de scripteigenschappen van Apps Script; de website vraagt een eigen toegangscode die alleen in je browser wordt bewaard.
