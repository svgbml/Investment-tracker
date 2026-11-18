/* Investeringstracker – Volglijst: een lijst beurssymbolen invoeren (CSV of geplakt) met een voorbeeld,
 * en het eigen koersdoel met een alarm erbij. Labels, notitie en koopzone staan in 17-markt.js.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

// ---------- Een lijst symbolen invoeren, eerst bekijken, dan toevoegen ----------
const WIMP_MAX = 25;
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
    const room = Math.max(0, 30 - watchSyms().length);
    const add = (wimp.rows || []).filter((r) => r.state === 'new' || r.state === 'unknown').map((r) => r.sym).slice(0, room);
    if (!add.length) { wimp.note = room ? 'Niets om toe te voegen.' : 'Maximaal 30 aandelen op je volglijst.'; renderWatchImport(); return; }
    wimp.busy = true; wimp.note = 'Bezig met opslaan…';
    renderWatchImport();
    try {
      await setWatchlist((cur) => cur.concat(add.filter((s) => !cur.includes(s))).slice(0, 30), null, '');
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
