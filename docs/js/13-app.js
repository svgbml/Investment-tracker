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
const EN_RE = [
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
  'Grootste veranderingen': 'Biggest changes', 'Alle bedrijven bekijken': 'View all companies', 'Zoek op naam of ticker': 'Search by name or ticker', 'Nog geen metingen van vandaag': 'No measurements today yet',
});
const T = (s) => (LANG === 'en' ? EN[s] || s : s);
function trText(s) {
  const t = s.trim();
  if (!t) return null;
  if (EN[t]) return s.replace(t, EN[t]);
  for (const [re, rep] of EN_RE) if (re.test(t)) return s.replace(t, t.replace(re, rep));
  return null;
}
function translateTree(root) {
  if (LANG !== 'en' || !root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  nodes.forEach((n) => { if (n.parentElement && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentElement.tagName)) return; const r = trText(n.nodeValue); if (r != null && r !== n.nodeValue) n.nodeValue = r; });
  (root.querySelectorAll ? root.querySelectorAll('[aria-label],[placeholder],[title]') : []).forEach((el) => ['aria-label', 'placeholder', 'title'].forEach((a) => { const v = el.getAttribute(a); if (v) { const r = trText(v); if (r != null && r !== v) el.setAttribute(a, r); } }));
}
if (LANG === 'en') {
  document.documentElement.lang = 'en';
  document.title = 'Investment tracker';
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
    const res = await fetch(url.replace(/\/api\/data$/, '/api/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: v('key'), secret: v('secret') }) });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok || !j.token) throw new Error((j && j.error) || (res.status === 404 ? 'deze Worker kent inloggen met een sleutel nog niet; werk hem bij (Sync fork)' : 'de Worker gaf status ' + res.status));
    localStorage.setItem(LS_TOKEN, j.token);
    if (url !== CFG.apiUrl) localStorage.setItem(LS_URL, url); else localStorage.removeItem(LS_URL);
    f.querySelectorAll('[data-l="key"],[data-l="secret"]').forEach((i) => { i.value = ''; });
    const K = (j.features && j.features.keys) || {};
    const on = [['FMP_KEY', 'FMP'], ['FINNHUB_KEY', 'Finnhub'], ['SEC_CONTACT', 'SEC'], ['FRED_KEY', 'FRED']].filter(([k]) => K[k]).map(([, n]) => n);
    say('Ingelogd. ' + (on.length ? 'Al gekoppeld: Trading 212, ' + on.join(', ') + '.' : 'Trading 212 is gekoppeld.'), 'gain');
    demo = false;
    if ($('dlg-settings').open) $('dlg-settings').close();
    load();
  } catch (err) { say('Inloggen is mislukt: ' + err.message + '.', 'loss'); }
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
    setTimeout(() => { if (st) st.textContent = swReg.waiting || swReg.installing ? 'Er is een nieuwe versie. Kies Nu bijwerken.' : 'Je hebt de nieuwste versie (' + VERSION + ').'; if (swReg.waiting) showUpdate(true); }, 1500);
  }
});
if ($('app-version')) $('app-version').textContent = VERSION;
