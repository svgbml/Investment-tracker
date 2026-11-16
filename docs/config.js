// Standaardadres van de gegevens. Dit adres is niet geheim: zonder de toegangscode geeft het niets terug.
// De Cloudflare Worker (…/api/data) is de hoofdbron; sheetUrl is de Apps Script web-app van de Google Sheet,
// die alleen nog gebruikt wordt om eenmalig de geschiedenis over te nemen.
window.TRACKER_CONFIG = {
  apiUrl: 'https://investment-tracker.stijn28082006vg.workers.dev/api/data',
  sheetUrl: 'https://script.google.com/macros/s/AKfycbx5nSWf8H1M_a2kK_hwXXabJVVwCqKGceVP1ahEJYWexK_Z0V-rI-Hs38UokGEbf_TN/exec',
  refreshMinutes: 5,
};
