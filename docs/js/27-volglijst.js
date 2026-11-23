/* Investeringstracker – Volglijst: een lijst beurssymbolen invoeren (CSV of geplakt) met een voorbeeld,
 * en het eigen koersdoel met een alarm erbij. Labels, notitie en koopzone staan in 17-markt.js.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// Hoeveel aandelen er op de volglijst mogen (de Worker houdt dezelfde grens aan, zie WATCH_MAX in worker/src/index.js)
const WATCH_MAX = 100;

// Grote beursbedrijven als extra suggesties om te volgen (Amerikaanse noteringen, ook van bedrijven van buiten de VS,
// zodat alle bronnen van de Worker ze kennen). Ruwweg op grootte; geen advies, alleen een keuzelijst.
const BIG_COMPANIES = [
  ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'Nvidia'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet'], ['META', 'Meta Platforms'],
  ['BRK-B', 'Berkshire Hathaway'], ['AVGO', 'Broadcom'], ['TSLA', 'Tesla'], ['LLY', 'Eli Lilly'], ['JPM', 'JPMorgan Chase'], ['V', 'Visa'],
  ['TSM', 'TSMC'], ['UNH', 'UnitedHealth'], ['XOM', 'Exxon Mobil'], ['MA', 'Mastercard'], ['COST', 'Costco'], ['WMT', 'Walmart'],
  ['NFLX', 'Netflix'], ['HD', 'Home Depot'], ['PG', 'Procter & Gamble'], ['JNJ', 'Johnson & Johnson'], ['ORCL', 'Oracle'], ['ABBV', 'AbbVie'],
  ['BAC', 'Bank of America'], ['ASML', 'ASML'], ['CRM', 'Salesforce'], ['KO', 'Coca-Cola'], ['CVX', 'Chevron'], ['NVO', 'Novo Nordisk'],
  ['MRK', 'Merck & Co.'], ['AMD', 'AMD'], ['PEP', 'PepsiCo'], ['SAP', 'SAP'], ['TM', 'Toyota'], ['ADBE', 'Adobe'], ['TMO', 'Thermo Fisher'],
  ['LIN', 'Linde'], ['CSCO', 'Cisco'], ['ACN', 'Accenture'], ['MCD', "McDonald's"], ['AZN', 'AstraZeneca'], ['ABT', 'Abbott'], ['WFC', 'Wells Fargo'],
  ['IBM', 'IBM'], ['GE', 'GE Aerospace'], ['PM', 'Philip Morris'], ['NVS', 'Novartis'], ['SHEL', 'Shell'], ['INTU', 'Intuit'], ['QCOM', 'Qualcomm'],
  ['TXN', 'Texas Instruments'], ['DIS', 'Disney'], ['CAT', 'Caterpillar'], ['NOW', 'ServiceNow'], ['AMGN', 'Amgen'], ['ISRG', 'Intuitive Surgical'],
  ['VZ', 'Verizon'], ['GS', 'Goldman Sachs'], ['UBER', 'Uber'], ['PFE', 'Pfizer'], ['AXP', 'American Express'], ['SPGI', 'S&P Global'],
  ['MS', 'Morgan Stanley'], ['T', 'AT&T'], ['BKNG', 'Booking Holdings'], ['RTX', 'RTX'], ['LOW', "Lowe's"], ['NEE', 'NextEra Energy'],
  ['HON', 'Honeywell'], ['UNP', 'Union Pacific'], ['BLK', 'BlackRock'], ['AMAT', 'Applied Materials'], ['PLTR', 'Palantir'], ['SONY', 'Sony'],
  ['UL', 'Unilever'], ['TTE', 'TotalEnergies'], ['HSBC', 'HSBC'], ['BHP', 'BHP'], ['SBUX', 'Starbucks'], ['NKE', 'Nike'], ['BA', 'Boeing'],
  ['DE', 'Deere'], ['LMT', 'Lockheed Martin'], ['MU', 'Micron'], ['INTC', 'Intel'], ['PANW', 'Palo Alto Networks'], ['ADP', 'ADP'],
  ['GILD', 'Gilead'], ['MDT', 'Medtronic'], ['SCHW', 'Charles Schwab'], ['ANET', 'Arista Networks'], ['CRWD', 'CrowdStrike'], ['SHOP', 'Shopify'],
  ['RIO', 'Rio Tinto'], ['BABA', 'Alibaba'], ['ARM', 'Arm'], ['SPOT', 'Spotify'], ['MELI', 'MercadoLibre'], ['ABNB', 'Airbnb'], ['PYPL', 'PayPal'],
  ['COIN', 'Coinbase'], ['BP', 'BP'], ['GSK', 'GSK'], ['SNY', 'Sanofi'], ['DEO', 'Diageo'], ['BTI', 'British American Tobacco'], ['ING', 'ING'],
  ['PHG', 'Philips'], ['NU', 'Nu Holdings'], ['SNOW', 'Snowflake'],
];
// Bedrijven van buiten de VS krijgen een eigen reden bij de suggestie
const BIG_WHY = Object.fromEntries(['TSM', 'ASML', 'NVO', 'SAP', 'TM', 'AZN', 'NVS', 'SHEL', 'SONY', 'UL', 'TTE', 'HSBC', 'BHP', 'RIO', 'BABA', 'ARM', 'SPOT', 'MELI', 'BP', 'GSK', 'SNY', 'DEO', 'BTI', 'ING', 'PHG', 'NU', 'SHOP'].map((s) => [s, 'groot bedrijf van buiten de VS, met een notering in New York']));

// ---------- Volgorde van de volglijst ----------
// De volglijst staat in de volgorde van settings.watchlist. Met 'Volgorde wijzigen' toont renderWatch rijen met
// knoppen om een aandeel bovenaan te zetten of een plek te verschuiven; elke klik slaat de nieuwe volgorde op.
const wOrder = { on: false };
function watchMove(list, sym, how) {
  const out = list.slice(), i = out.indexOf(sym);
  if (i < 0) return out;
  const j = how === 'top' ? 0 : how === 'up' ? Math.max(0, i - 1) : Math.min(out.length - 1, i + 1);
  out.splice(i, 1);
  out.splice(j, 0, sym);
  return out;
}
function watchOrderHtml() {
  const list = watchSyms(), last = list.length - 1;
  const btn = (how, s, i, label, aria) => tpl`<button type="button" class="btn ghost" data-wo="${how}" data-k="${s}" aria-label="${aria}"${(how === 'down' ? i === last : i === 0) ? raw(' disabled') : null}>${label}</button>`;
  return String(tpl`<section class="tile pad watch-order"><div class="plan-head"><h3>${T('Volgorde van je volglijst')}</h3>
      <button type="button" class="btn primary" data-wo="done">${T('Klaar')}</button></div>
    <p class="small muted">Zet een aandeel bovenaan of schuif het een plek op of neer. Elke wijziging wordt meteen bewaard.</p>
    <ol class="wo-list">${list.map((s, i) => {
      const nm = watchPseudo(s).name;
      return tpl`<li><span class="wo-n">${i + 1}</span><span class="wo-t"><b>${s}</b> <span class="muted small">${nm !== s ? nm : ''}</span></span>
        <span class="wo-b">${btn('top', s, i, T('Bovenaan'), s + ' bovenaan zetten')}${btn('up', s, i, '↑', s + ' een plek omhoog')}${btn('down', s, i, '↓', s + ' een plek omlaag')}</span></li>`;
    })}</ol><p class="small watch-status wo-st" role="status" aria-live="polite"></p></section>`);
}
document.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest ? /** @type {Element} */ (e.target).closest('[data-wo]') : null);
  if (!b) return;
  const how = b.dataset.wo;
  if (how === 'start' || how === 'done') {
    wOrder.on = how === 'start';
    renderWatch();
    const f = /** @type {HTMLElement|null} */ (document.querySelector(wOrder.on ? '.watch-order [data-wo="done"]' : '[data-wo="start"]'));
    if (f && f.offsetParent) f.focus();
    return;
  }
  const sym = b.dataset.k;
  setWatchlist((cur) => watchMove(cur, sym, how), null, '').then(() => {
    // Na het opnieuw tekenen de focus terug op dezelfde knop (of op de andere pijl als deze nu uit staat)
    const sel = (h) => '.watch-order [data-wo="' + h + '"][data-k="' + CSS.escape(sym) + '"]';
    const f = /** @type {HTMLButtonElement|null} */ ([...document.querySelectorAll(sel(how) + ',' + sel(how === 'down' ? 'up' : 'down'))].find((x) => /** @type {HTMLButtonElement} */ (x).offsetParent && !/** @type {HTMLButtonElement} */ (x).disabled) || null);
    if (f) f.focus();
    const st = [...document.querySelectorAll('.wo-st')].find((x) => /** @type {HTMLElement} */ (x).offsetParent);
    if (st) st.textContent = sym + ' staat nu op plek ' + (watchSyms().indexOf(sym) + 1) + '.';
  }).catch(() => {});
});

// ---------- Een lijst symbolen invoeren, eerst bekijken, dan toevoegen ----------
const WIMP_MAX = 50;
const WIMP_SKIP = new Set(['TICKER', 'TICKERS', 'SYMBOL', 'SYMBOOL', 'NAME', 'NAAM', 'AANDEEL', 'STOCK', 'QTY', 'QUANTITY', 'AANTAL',
  'PRICE', 'KOERS', 'VALUE', 'WAARDE', 'EUR', 'USD', 'ISIN', 'SECTOR', 'EXCHANGE', 'BEURS', 'NOTE', 'NOTITIE', 'DATE', 'DATUM', 'TOTAL', 'TOTAAL']);
const wimp = { open: false, text: '', rows: null, busy: false, note: '' };

// Uit een CSV-regel of geplakte tekst de beurssymbolen halen: eerste veld per regel, anders alles wat op een symbool lijkt
function wimpParse(text) {
  const out = [];
  const seen = new Set();
  String(text || '').split(/[\r\n]+/).slice(0, 200).forEach((line) => {
    const fields = line.split(/[,;\t|]/).map((f) => f.replace(/^["'\s]+|["'\s]+$/g, ''));
    const cands = (fields.length > 1 ? [fields[0]] : line.split(/\s+/)).map((f) => f.replace(/^["'\s]+|["'\s]+$/g, '').toUpperCase());
    cands.forEach((s) => {
      if (!s || WIMP_SKIP.has(s) || seen.has(s)) return;
      if (!/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(s)) return;
      seen.add(s);
      out.push(s);
    });
  });
  return out.slice(0, WIMP_MAX);
}
// Van elk symbool opzoeken of het bestaat; per vijf tegelijk, zodat de Worker niet overvraagd wordt
async function wimpLookup(syms) {
  const held = new Set([...M.byTk.keys()].concat(M.mk && M.mk.ok ? Object.values((data.market || {}).symbols || {}) : []));
  const on = new Set(watchSyms());
  const out = [];
  for (let i = 0; i < syms.length; i += 5) {
    const part = syms.slice(i, i + 5);
    const res = await Promise.all(part.map((s) => searchCompaniesSite(s).catch(() => [])));
    part.forEach((sym, k) => {
      const hit = (res[k] || []).find((r) => r.sym === sym);
      const p = M.mk && M.mk.ok ? M.mk.prof(sym) : null;
      out.push({ sym, name: (hit && hit.name) || (p && p.name) || '',
        state: held.has(sym) ? 'held' : on.has(sym) ? 'on' : hit || p ? 'new' : 'unknown' });
    });
  }
  return out;
}
function wimpHtml() {
  if (!wimp.open) {
    return '<div class="wimp"><button type="button" class="linklike" data-wi="open">' + esc(T('Lijst met symbolen invoeren')) + '</button></div>';
  }
  const rows = wimp.rows;
  const pick = rows ? rows.filter((r) => r.state === 'new' || r.state === 'unknown') : [];
  const room = Math.max(0, 30 - watchSyms().length);
  const label = (r) => (r.state === 'held' ? 'heb je al' : r.state === 'on' ? 'staat al op je volglijst' : r.state === 'unknown' ? 'niet gevonden; wordt als symbool toegevoegd' : (r.name || 'nieuw'));
  return '<div class="wimp open">' +
    '<div class="wimp-top"><b>' + esc(T('Lijst met symbolen invoeren')) + '</b><button type="button" class="linklike" data-wi="close">Sluiten</button></div>' +
    '<label class="sr-only" for="wimp-' + (mode === 'm' ? 'm' : 'd') + '">Beurssymbolen</label>' +
    '<textarea id="wimp-' + (mode === 'm' ? 'm' : 'd') + '" data-wi-f="text" rows="4" maxlength="2000" spellcheck="false" ' +
      'placeholder="NVDA, ASML, KO&#10;of een CSV-regel per aandeel: symbool in de eerste kolom">' + esc(wimp.text) + '</textarea>' +
    '<div class="plan-actions"><button type="button" class="btn ghost" data-wi="check"' + (wimp.busy ? ' disabled' : '') + '>' + (wimp.busy ? 'Bezig…' : 'Bekijken') + '</button>' +
      (pick.length ? '<button type="button" class="btn primary" data-wi="add"' + (wimp.busy || !room ? ' disabled' : '') + '>' + esc('Toevoegen (' + Math.min(pick.length, room) + ')') + '</button>' : '') +
      '<span class="small plan-status' + (/mislukt|fout|vol|Maximaal/.test(wimp.note) ? ' loss' : wimp.note ? ' gain' : '') + '" role="status">' + esc(wimp.note) + '</span></div>' +
    (rows ? (rows.length ? '<div class="wimp-list">' + rows.map((r) =>
      '<div class="wimp-r ' + r.state + '"><b>' + esc(r.sym) + '</b><span>' + esc(label(r)) + '</span>' +
      '<i>' + esc(r.state === 'new' ? 'toevoegen' : r.state === 'unknown' ? 'onzeker' : 'overslaan') + '</i></div>').join('') + '</div>'
      : '<p class="small loss">Geen beurssymbolen gevonden in die tekst.</p>') : '') +
    '<p class="sub" style="margin-top:6px">Komma\'s, nieuwe regels of een CSV-export: van elke regel wordt de eerste kolom als symbool gelezen, maximaal ' + WIMP_MAX + ' per keer. ' +
      'Je volglijst heeft ruimte voor ' + room + ' ' + (room === 1 ? 'aandeel' : 'aandelen') + '. Namen worden opgezocht; wat niet gevonden wordt, kun je alsnog toevoegen.</p></div>';
}
function renderWatchImport() {
  ['watch-add', 'm-watch-add'].forEach((id) => {
    const host = $(id);
    if (!host) return;
    const old = host.querySelector('.wimp');
    if (old) old.remove();
    host.insertAdjacentHTML('beforeend', wimpHtml());
  });
}
// De weergave 'watch' opnieuw vastleggen: de volglijst zoals altijd, plus het invoerblok
defineView('watch', () => { renderWatch(); renderWatchImport(); });

document.addEventListener('click', async (e) => {
  const b = near(e, '[data-wi]');
  if (!b) return;
  const box = b.closest('.wimp');
  const act = b.dataset.wi;
  const ta = /** @type {HTMLTextAreaElement|null} */ (box && box.querySelector('[data-wi-f="text"]'));
  if (ta) wimp.text = ta.value;
  if (act === 'open' || act === 'close') {
    wimp.open = act === 'open';
    wimp.rows = null; wimp.note = '';
    renderWatchImport();
    if (wimp.open) { const t = document.querySelector('.wimp.open textarea'); if (t) /** @type {HTMLTextAreaElement} */ (t).focus(); }
    return;
  }
  if (act === 'check') {
    const syms = wimpParse(wimp.text);
    if (!syms.length) { wimp.rows = []; wimp.note = ''; renderWatchImport(); return; }
    wimp.busy = true; wimp.note = 'Bezig met opzoeken…'; wimp.rows = null;
    renderWatchImport();
    try { wimp.rows = await wimpLookup(syms); wimp.note = wimp.rows.length + (wimp.rows.length === 1 ? ' symbool' : ' symbolen') + ' gelezen.'; }
    catch (err) { wimp.rows = []; wimp.note = 'Opzoeken is mislukt: ' + err.message + '.'; }
    wimp.busy = false;
    renderWatchImport();
    return;
  }
  if (act === 'add') {
    const room = Math.max(0, WATCH_MAX - watchSyms().length);
    const add = (wimp.rows || []).filter((r) => r.state === 'new' || r.state === 'unknown').map((r) => r.sym).slice(0, room);
    if (!add.length) { wimp.note = room ? 'Niets om toe te voegen.' : 'Maximaal ' + WATCH_MAX + ' aandelen op je volglijst.'; renderWatchImport(); return; }
    wimp.busy = true; wimp.note = 'Bezig met opslaan…';
    renderWatchImport();
    try {
      await setWatchlist((cur) => cur.concat(add.filter((s) => !cur.includes(s))).slice(0, WATCH_MAX), null, '');
      wimp.busy = false; wimp.rows = null; wimp.text = '';
      wimp.note = add.length + (add.length === 1 ? ' aandeel' : ' aandelen') + ' toegevoegd: ' + add.join(', ') + '.';
    } catch (err) { wimp.busy = false; wimp.note = 'Opslaan is mislukt: ' + err.message + '.'; }
    renderWatchImport();
  }
});
document.addEventListener('input', (e) => {
  const t = near(e, '[data-wi-f="text"]');
  if (t) wimp.text = t.value;
});
