/* Investeringstracker – bronnen: hoe het met je koppelingen gaat (tijdlijn per bron), de budgetten per dag,
 * de grootte van de database, de reservekopieën in de cloud en wat de Worker aan rare gegevens tegenhield.
 *
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html).
 * De gegevens komen van /api/health uit je eigen Worker; zonder Worker (voorbeeldweergave) staan er voorbeeldcijfers.
 */
'use strict';

// ---------- Handelsdag (idee 154) ----------
// Dezelfde regels als in de Worker (worker/src/index.js: dayOf, tradingDay): de dag komt uit de Amsterdamse
// tijdzone zelf, dus zomer- en wintertijd kloppen zonder eigen rekenwerk. In het weekend geldt de vrijdag ervoor.
const nlDayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
const nlDay = (ms) => nlDayFmt.format(new Date(ms == null ? Date.now() : ms));
const nlShiftDay = (day, n) => { const d = new Date(String(day).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nlWeekday = (day) => { const n = new Date(String(day).slice(0, 10) + 'T12:00:00Z').getUTCDay(); return n === 0 ? 7 : n; };
function tradingDayNL(ms) {
  const d = nlDay(ms);
  const w = nlWeekday(d);
  return w <= 5 ? d : nlShiftDay(d, w === 6 ? -1 : -2);
}
// De laatste 30 kalenderdagen, oudste eerst
function lastDaysNL(n, until) {
  const end = until || nlDay();
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(nlShiftDay(end, -i));
  return out;
}

// ---------- Gegevens van /api/health ----------
let healthCache = null;
const bronNaam = (src) => (typeof API_NAMES === 'object' && API_NAMES[src]) || (typeof SOURCE_NAMES === 'object' && SOURCE_NAMES[src]) || src;

function demoHealth() {
  const days = lastDaysNL(30);
  const mk = (bad) => Object.fromEntries(days.map((d, i) => [d, bad.includes(i) ? (i === 18 ? [2, 1, 0] : [3, 0, 1]) : [4, 0, 0]]));
  const now = Date.now();
  return {
    now: new Date(now).toISOString(), day: nlDay(), tradingDay: tradingDayNL(), usDay: nlShiftDay(tradingDayNL(), -1),
    sources: { finnhub: { fails: 1, msg: 'Finnhub gaf 429', at: new Date(now - 3 * HOUR).toISOString(), backup: 'Alpha Vantage (marktnieuws)', backupAt: new Date(now - 3 * HOUR).toISOString() },
      twelvedata: { fails: 3, msg: 'Twelve Data-limiet', until: now + 55 * 60e3, next: new Date(now + 55 * 60e3).toISOString() } },
    hist: { finnhub: Object.assign({ days: mk([18]) }, { lastLimit: { at: new Date(now - 3 * HOUR).toISOString(), msg: 'Finnhub gaf 429' } }),
      fmp: { days: mk([]), lastOk: new Date(now - HOUR).toISOString() },
      twelvedata: { days: mk([22, 27]), lastErr: { at: new Date(now - 26 * HOUR).toISOString(), msg: 'Twelve Data-limiet' } },
      frankfurter: { days: mk([]), lastOk: new Date(now - 2 * HOUR).toISOString() } },
    errors: {},
    budgets: { day: nlDay(), sources: [
      { src: 'fmp', name: 'Financial Modeling Prep', used: 96, limit: 250, per: 'dag', own: 230, pct: 96 / 230 },
      { src: 'alphavantage', name: 'Alpha Vantage', used: 6, limit: 25, per: 'dag', own: 24, pct: 6 / 24 },
      { src: 'twelvedata', name: 'Twelve Data', used: 120, limit: 800, per: 'dag', own: null, pct: 0.15 },
      { src: 'finnhub', name: 'Finnhub', used: 140, limit: 60, per: 'minuut', own: null, pct: null },
      { src: 'sec', name: 'SEC EDGAR', used: 18, limit: 10, per: 'seconde', own: null, pct: null },
    ] },
    db: { checked: new Date(now).toISOString(), bytes: 41e6, limit: 500e6, pct: 0.082, newsKeep: 40000,
      tables: { intraday: { rows: 3960, bytes: 277200 }, hours: { rows: 6420, bytes: 706200 }, days: { rows: 980, bytes: 127400 },
        weeks: { rows: 13, bytes: 910 }, positions: { rows: 160, bytes: 11200 }, orders: { rows: 31, bytes: 4650 },
        kv: { rows: 180, bytes: 2.1e6 }, news_hist: { rows: 24800, bytes: 37e6 } } },
    rejects: [{ at: new Date(now - 26 * HOUR).toISOString(), ticker: 'VOW', name: 'Voorbeeld nv', why: 'koerssprong van 92 naar 310 (237%) zonder splitsing' }],
    actions: [{ kind: 'split', ticker: 'NVDA', ratio: 10, day: nlShiftDay(nlDay(), -40), at: new Date(now - 40 * 24 * HOUR).toISOString() },
      { kind: 'naam', from: 'FB', to: 'META', day: nlShiftDay(nlDay(), -120), at: new Date(now - 120 * 24 * HOUR).toISOString() }],
    tickerMap: { FB: { to: 'META', at: new Date(now - 120 * 24 * HOUR).toISOString() } },
    r2: { on: true, keep: { daily: 7, weekly: 4 }, last: nlDay(), copies: lastDaysNL(7).reverse().map((d) => ({ key: 'dag/' + d + '.json', kind: 'dag', bytes: 1.4e6, at: d + 'T05:20:00Z' }))
      .concat(lastDaysNL(22).filter((d) => nlWeekday(d) === 7).map((d) => ({ key: 'week/' + d + '.json', kind: 'week', bytes: 1.4e6, at: d + 'T05:20:00Z' }))) },
    backoff: [15, 60, 240, 720, 1440],
    keys: { T212_KEY: true, FMP_KEY: true, FINNHUB_KEY: true, ALPHAVANTAGE_KEY: false, TWELVEDATA_KEY: true, FRED_KEY: false, SEC_CONTACT: true, RESEND_KEY: false },
  };
}

async function loadHealth() {
  if (demo || sharedView) { healthCache = demoHealth(); return healthCache; }
  if (!isWorker() || !getToken()) throw new Error('de bronnenpagina komt van je eigen Cloudflare Worker');
  healthCache = (await workerCall('/api/health', { method: 'GET' })).health;
  return healthCache;
}
function reloadHealth() {
  healthCache = null;
  loadHealth().then(() => { if (ui.detail === STATUS) renderDetail(false); }).catch((err) => { healthCache = { error: err.message }; if (ui.detail === STATUS) renderDetail(false); });
}

// ---------- Tijdlijn per bron (ideeën 61 en 145) ----------
function bronStrip(h, days) {
  const d = (h && h.days) || {};
  const tekst = { ok: 'in orde', limiet: 'limiet geraakt', fout: 'fout', geen: 'niets opgehaald' };
  return '<span class="bron-strip">' + days.map((day) => {
    const v = d[day];
    const cls = !v ? 'geen' : v[2] ? 'fout' : v[1] ? 'limiet' : 'ok';
    return '<i class="' + cls + '" data-tip="' + esc(day + ': ' + tekst[cls]) + '"></i>';
  }).join('') + '</span>';
}
// "14 dagen in orde, laatste limiet op di 12 nov 14:03 (Finnhub gaf 429)"
function bronRegel(h) {
  const d = (h && h.days) || {};
  const keys = Object.keys(d).sort();
  let streak = 0, stop = false;
  for (let i = keys.length - 1; i >= 0 && !stop; i--) {
    const v = d[keys[i]];
    if (v[1] || v[2]) stop = true; else if (v[0]) streak++;
  }
  const out = [streak ? streak + (streak === 1 ? ' dag' : ' dagen') + ' in orde' : 'nog geen volle dag zonder fout'];
  const when = (x) => fDT.format(new Date(x.at)) + (x.msg ? ' (' + x.msg + ')' : '');
  if (h && h.lastLimit) out.push('laatste limiet op ' + when(h.lastLimit));
  if (h && h.lastErr) out.push('laatste fout op ' + when(h.lastErr));
  return out.join(', ') + '.';
}
function bronnenTile(H) {
  const days = lastDaysNL(30, H.day);
  const hist = H.hist || {};
  const namen = [...new Set(Object.keys(hist).concat(Object.keys(H.sources || {})))].sort((a, b) => bronNaam(a).localeCompare(bronNaam(b)));
  if (!namen.length) {
    return '<section class="tile pad"><h3>Bronnen, laatste 30 dagen</h3><p class="muted">Nog niets te melden: vanaf deze versie houdt de Worker per bron per dag bij of het goed ging, of er een limiet was en of er fouten waren.</p></section>';
  }
  const rows = namen.map((src) => {
    const st = (H.sources || {})[src];
    const uit = st && st.until && st.until > Date.now();
    return '<div class="bron-row' + (uit ? ' uit' : '') + '"><div class="bron-h"><b>' + esc(bronNaam(src)) + '</b>' +
      (uit ? '<span class="tag loss">Tijdelijk uit</span>' : st ? '<span class="tag">Let op</span>' : '<span class="tag gain">In orde</span>') + '</div>' +
      bronStrip(hist[src], days) +
      '<p class="small muted">' + esc(bronRegel(hist[src])) + '</p>' +
      (uit ? '<p class="small loss">Volgende poging om ' + esc(fDT.format(new Date(st.until))) + (st.msg ? '. Reden: ' + esc(st.msg) : '') + '.</p>' : '') +
      (st && st.backup ? '<p class="small">Reserve in gebruik: ' + esc(st.backup) + (st.backupAt ? ', laatst ' + esc(fDT.format(new Date(st.backupAt))) : '') + '.</p>' : '') + '</div>';
  }).join('');
  const ladder = (H.backoff || []).map((m) => (m < 60 ? m + ' min' : m / 60 + ' uur')).join(', ');
  return '<section class="tile pad"><h3>Bronnen, laatste 30 dagen</h3><div class="bron-list">' + rows + '</div>' +
    '<p class="bron-uitleg sub">Groen is een dag waarop de bron gewoon antwoordde, oranje een dag met een limiet, rood een dag met fouten en grijs een dag waarop de Worker niets bij die bron ophaalde. ' +
    'Na een fout wacht de Worker steeds langer voordat hij het opnieuw probeert' + (ladder ? ' (' + esc(ladder) + ')' : '') + '; een bron die weigert wordt nooit in een lus opnieuw gevraagd. Bij een limiet wacht hij tot na middernacht.</p></section>';
}

// ---------- Budget per bron (idee 152) ----------
function budgetTile(H) {
  const B = (H.budgets && H.budgets.sources) || [];
  if (!B.length) return '<section class="tile pad"><h3>Budget per bron</h3><p class="muted">Nog geen tellingen van vandaag.</p></section>';
  const meter = (pct, cls) => '<span class="bron-meter"><i class="' + cls + '" style="width:' + Math.round(Math.min(1, Math.max(0, pct)) * 100) + '%"></i></span>';
  const rows = B.map((b) => {
    const dag = b.per === 'dag';
    const cap = b.own || b.limit;
    const cls = dag && b.pct >= 0.9 ? 'loss' : dag && b.pct >= 0.7 ? 'warn' : 'ok';
    return '<div class="bron-bud"><div class="bron-h"><b>' + esc(b.name) + '</b><span class="muted small">' +
      esc(dag ? NI.format(b.used) + ' van ' + NI.format(cap) + ' vandaag' : NI.format(b.used) + ' verzoeken vandaag') + '</span></div>' +
      (dag ? meter(b.pct, cls) + '<p class="small ' + (cls === 'loss' ? 'loss' : 'muted') + '">' + esc(P1.format(b.pct || 0) + ' van het dagbudget' +
        (b.own && b.own !== b.limit ? ' (de Worker houdt ' + NI.format(b.own) + ' aan van de ' + NI.format(b.limit) + ' die de bron toestaat)' : '')) + '</p>'
        : '<p class="small muted">' + esc('Geen dagbudget, maar een grens van ' + b.limit + ' per ' + b.per + '; de Worker verdeelt zijn verzoeken daarom over de dag.') + '</p>') + '</div>';
  }).join('');
  return '<section class="tile pad"><h3>Budget per bron</h3><div class="bron-list">' + rows + '</div>' +
    '<p class="sub" style="margin-top:8px">Verzoeken van vandaag (' + esc((H.budgets && H.budgets.day) || '') + '). Raakt een dagbudget op, dan stopt de Worker met die bron en gaat hij morgen verder; wat al binnen is blijft staan.</p></section>';
}

// ---------- Databasegrootte (idee 151) ----------
function dbTile(H) {
  const D = H.db;
  if (!D) return '';
  const rows = Object.entries(D.tables || {}).sort((a, b) => b[1].bytes - a[1].bytes)
    .map(([t, v]) => [t === 'news_hist' ? 'Nieuwsarchief' : t === 'kv' ? 'Instellingen en opgehaalde gegevens' : t === 'intraday' ? 'Metingen per 10 minuten' : t === 'hours' ? 'Uurregels' : t === 'days' ? 'Dagregels' : t === 'weeks' ? 'Weken' : t === 'positions' ? 'Posities per week' : t === 'orders' ? 'Orders' : t,
      NI.format(v.rows) + ' regels, ' + kb(v.bytes)]);
  const vol = D.pct >= 0.85 ? 'loss' : D.pct >= 0.7 ? 'warn' : 'gain';
  return '<section class="tile pad"><h3>Ruimte in de database</h3>' +
    '<div class="fx-head"><span class="v big ' + (vol === 'loss' ? 'loss' : '') + '">' + esc(P1.format(D.pct || 0)) + '</span><span class="muted small">' + esc(kb(D.bytes) + ' van ' + kb(D.limit) + ' (schatting)') + '</span></div>' +
    '<span class="bron-meter big"><i class="' + (vol === 'gain' ? 'ok' : vol) + '" style="width:' + Math.round(Math.min(1, D.pct || 0) * 100) + '%"></i></span>' +
    kvList(rows) +
    '<p class="sub" style="margin-top:8px">' + esc('D1 geeft zijn grootte niet terug, dus dit is een schatting (regels maal een gemiddelde regel, plus de echte lengte van de instellingen en het nieuwsarchief). Boven 70% ruimt de Worker het nieuwsarchief op tot ' + NI.format(D.newsKeep || 40000) + ' berichten; boven 85% krijg je een melding. Je dag- en weekregels blijven altijd bewaard.') + '</p></section>';
}

// ---------- Reservekopieën in R2 (idee 150) ----------
function r2Tile(H) {
  const R = H.r2 || { on: false, copies: [] };
  if (!R.on) {
    return '<section class="tile pad"><h3>Reservekopieën in de cloud</h3><p class="muted">Er is geen R2-bucket gekoppeld. Met een bucket onder de naam BACKUP (zie worker/README.md) zet de Worker elke dag een volledige kopie zonder sleutels weg: ' +
      esc(((R.keep && R.keep.daily) || 7) + ' dagkopieën en ' + ((R.keep && R.keep.weekly) || 4) + ' weekkopieën') + '. Zonder bucket werkt de rest gewoon; een kopie kun je altijd zelf downloaden bij Instellingen.</p></section>';
  }
  const list = (R.copies || []).slice().sort((a, c) => String(c.key).localeCompare(String(a.key))).map((c) => '<div class="tx"><span class="tag' + (c.kind === 'week' ? '' : ' gain') + '">' + esc(c.kind) + '</span><span class="tx-m"><b>' + esc(c.key.replace(/^(dag|week)\//, '').replace('.json', '')) + '</b>' +
    '<span class="sub">' + esc(kb(c.bytes) + (c.at ? ' · ' + fDT.format(new Date(c.at)) : '')) + '</span></span>' +
    '<button type="button" class="btn ghost" data-r2-preview="' + esc(c.key) + '">Voorbeeld</button></div>').join('');
  return '<section class="tile pad"><h3>Reservekopieën in de cloud</h3>' +
    kvList([['Laatste kopie', R.last || '–'], ['Bewaren', ((R.keep && R.keep.daily) || 7) + ' dagen en ' + ((R.keep && R.keep.weekly) || 4) + ' weken']]) +
    '<div class="tx-list" style="margin-top:8px">' + (list || '<p class="muted">Nog geen kopieën.</p>') + '</div>' +
    '<div class="row-btn" style="margin-top:10px"><button type="button" class="btn ghost" data-r2-now>Nu een kopie maken</button></div>' +
    '<div id="bron-r2-out" class="small" role="status"></div>' +
    '<p class="sub" style="margin-top:8px">Een voorbeeld laat zien wat er in een kopie zit en wat dat zou betekenen tegenover wat er nu in de database staat. Er wordt niets teruggezet: terugzetten doe je bewust bij Instellingen.</p></section>';
}

// ---------- Geweigerde waarden, splitsingen en nieuwe tickers (ideeën 148 en 149) ----------
function controleTile(H) {
  const R = H.rejects || [], A = H.actions || [];
  const rej = R.length ? '<div class="tx-list">' + R.slice(0, 6).map((x) => '<div class="tx"><span class="tag' + (x.kept ? '' : ' loss') + '">' + (x.kept ? 'deels bewaard' : 'niet bewaard') + '</span><span class="tx-m"><b>' + esc(x.ticker + (x.name ? ' – ' + x.name : '')) + '</b><span class="sub">' + esc(x.why + ' · ' + fDT.format(new Date(x.at))) + '</span></span></div>').join('') + '</div>'
    : '<p class="small gain">Geen rare waarden tegengehouden.</p>';
  const act = A.length ? '<div class="tx-list">' + A.slice(0, 6).map((x) => '<div class="tx"><span class="tag">' + esc(x.kind === 'split' ? 'splitsing' : 'nieuwe ticker') + '</span><span class="tx-m"><b>' +
    esc(x.kind === 'split' ? x.ticker + ' ' + (x.ratio >= 1 ? x.ratio + ':1' : '1:' + Math.round(1 / x.ratio)) : x.from + ' → ' + x.to) + '</b><span class="sub">' + esc('verwerkt op ' + (x.day || '') ) + '</span></span></div>').join('') + '</div>'
    : '<p class="small muted">Nog geen splitsingen of naamswijzigingen gezien.</p>';
  return '<section class="tile pad"><h3>Controle op rare gegevens</h3>' + rej +
    '<h3 style="margin-top:14px">Splitsingen en nieuwe tickers</h3>' + act +
    '<p class="sub" style="margin-top:8px">Een koers van 0, een negatief aantal of een koerssprong van meer dan 80% zonder splitsing komt niet in je geschiedenis; de vorige waarde blijft dan staan. ' +
    'Een echte splitsing rekent de Worker wél door in de oude koersen, zodat je grafiek doorloopt, en bij een nieuwe ticker (hetzelfde ISIN) verhuist de geschiedenis mee.</p></section>';
}

// ---------- De stukken voor de statuspagina ----------
function bronnenRows(S) {
  if (healthCache === null) {
    reloadHealth();
    return [['<section class="tile pad"><h3>Bronnen</h3><p class="muted">Bezig met laden…</p></section>']];
  }
  if (healthCache.error) {
    return [['<section class="tile pad"><h3>Bronnen</h3><p class="small loss">Niet beschikbaar: ' + esc(healthCache.error) + '.</p></section>']];
  }
  const H = healthCache;
  const dag = '<section class="tile pad"><h3>Dag en tijdzone</h3>' + kvList([
    ['Vandaag (Amsterdam)', H.day || nlDay()],
    ['Handelsdag', H.tradingDay || tradingDayNL()],
    ['Laatste Amerikaanse beursdag', H.usDay || '–'],
    ['Metingen vandaag', S && S.tickHist && S.tickHist[H.day] ? S.tickHist[H.day][0] + ' gelukt, ' + S.tickHist[H.day][1] + ' mislukt' : '–'],
  ]) + '<p class="sub" style="margin-top:8px">De Worker en de site rekenen met dezelfde handelsdag: de dag komt uit de tijdzone Europe/Amsterdam (dus met zomer- en wintertijd), en in het weekend geldt de vrijdag ervoor.</p></section>';
  return [[bronnenTile(H), budgetTile(H)], [dbTile(H), r2Tile(H)], [controleTile(H), dag]];
}

// ---------- Knoppen: reservekopie en voorbeeld ----------
document.addEventListener('click', async (e) => {
  const el = /** @type {Element} */ (e.target);
  const pv = /** @type {HTMLButtonElement|null} */ (el && el.closest ? el.closest('[data-r2-preview]') : null);
  const nu = /** @type {HTMLButtonElement|null} */ (el && el.closest ? el.closest('[data-r2-now]') : null);
  if (!pv && !nu) return;
  const out = $('bron-r2-out');
  const say = (html, cls) => { if (out) out.innerHTML = '<p class="small ' + (cls || '') + '">' + html + '</p>'; };
  if (demo || sharedView) { say('In de voorbeeldweergave staan voorbeeldkopieën; met je eigen Worker en een R2-bucket zie je hier de echte.', 'muted'); return; }
  (pv || nu).disabled = true;
  try {
    if (nu) {
      const r = await workerCall('/api/r2', { method: 'POST' });
      say('Kopie gemaakt' + (r.made ? ' voor ' + esc(r.made) : '') + '.', 'gain');
      reloadHealth();
    } else {
      const r = await workerCall('/api/r2?preview=' + encodeURIComponent(pv.dataset.r2Preview), { method: 'GET' });
      const p = r.preview || {};
      const rows = (p.tables || []).map((t) => [t.table, NI.format(t.inBackup) + ' in de kopie, ' + NI.format(t.inDatabase) + ' nu' + (t.diff ? ' (' + (t.diff > 0 ? '+' : '−') + NI.format(Math.abs(t.diff)) + ')' : ''), t.diff < 0 ? 'loss' : '']);
      if (out) {
        out.innerHTML = '<p class="small"><b>' + esc(p.key) + '</b> · ' + esc(kb(p.bytes) + (p.created ? ' · gemaakt ' + p.created : '') + (p.weeksFrom ? ' · weken ' + p.weeksFrom + ' t/m ' + p.weeksTo : '')) + '</p>' +
          kvList(rows) + '<p class="sub">Een min betekent dat de kopie minder regels heeft dan je database nu; terugzetten voegt alleen toe en overschrijft gelijke regels, het verwijdert niets.</p>';
      }
    }
  } catch (err) {
    say('Mislukt: ' + esc(err.message) + '.', 'loss');
  } finally {
    (pv || nu).disabled = false;
  }
});

// ---------- Sleutel testen (idee 62) ----------
document.addEventListener('click', async (e) => {
  const el = /** @type {Element} */ (e.target);
  const b = /** @type {HTMLButtonElement|null} */ (el && el.closest ? el.closest('[data-testkey]') : null);
  if (!b) return;
  const name = b.dataset.testkey;
  const out = document.querySelector('[data-keytest-out="' + name + '"]');
  const say = (text, cls) => { if (out) { out.className = 'small key-test ' + (cls || ''); out.textContent = text; } };
  if (demo) { say('In de voorbeeldweergave staan alle koppelingen aan; met je eigen Worker doet deze knop één proefvraag aan de bron.', 'muted'); return; }
  const field = /** @type {HTMLInputElement|null} */ ($('key-' + name));
  const value = field && field.value ? field.value.trim() : '';
  b.disabled = true;
  say('Bezig met testen…', 'muted');
  try {
    const r = await workerCall('/api/keytest', { method: 'POST', body: JSON.stringify({ name, value }) });
    const st = (r.result && r.result.state) || 'onbekend';
    say((st === 'ok' ? 'Werkt: ' : st === 'limiet' ? 'Limiet: ' : st === 'fout' ? 'Niet goed: ' : st === 'leeg' ? '' : 'Onduidelijk: ') + ((r.result && r.result.message) || ''),
      st === 'ok' ? 'gain' : st === 'fout' ? 'loss' : 'muted');
  } catch (err) {
    say('Testen lukte niet: ' + err.message + '.', 'loss');
  } finally {
    b.disabled = false;
  }
});
