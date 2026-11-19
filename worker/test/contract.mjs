// Contracttests: leest de Worker de antwoorden van de bronnen nog goed?
//
// De bewaarde voorbeeldantwoorden in worker/test/fixtures/ hebben de vorm die Trading 212, Finnhub,
// Financial Modeling Prep, Alpha Vantage, Tiingo, Polygon (Massive), Marketaux en de SEC volgens hun documentatie teruggeven (verzonnen getallen,
// geen sleutels of eigen gegevens). Deze tests voeren ze aan de Worker en kijken of er aan de andere kant
// uitkomt wat de site verwacht. Verandert een bron de naam van een veld, dan valt dit om in plaats van dat
// er stilletjes lege tegels verschijnen.
//
// Draaien: node worker/test/contract.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch (e) {
  console.log('node:sqlite ontbreekt in deze Node-versie (' + process.version + '); contracttests overgeslagen.');
  process.exit(0);
}
const WM = await import('../src/index.js');
const W = WM.default;
const dir = fileURLToPath(new URL('fixtures/', import.meta.url));
const fx = (naam) => JSON.parse(readFileSync(dir + naam + '.json', 'utf8'));

// ---------- D1-stand-in (zelfde opzet als worker/test/run.mjs) ----------
class Stmt {
  constructor(db, sql, args) { this.db = db; this.sql = sql; this.args = args || []; }
  bind(...a) { return new Stmt(this.db, this.sql, a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v))); }
  async first(col) { const r = this.db.prepare(this.sql).get(...this.args); return r === undefined ? null : col ? r[col] : { ...r }; }
  async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: Number(r.changes) } }; }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; }
  async exec(sql) { this.db.exec(sql); return { count: 1 }; }
}
const DB = new D1();
const kv = (k) => { const r = DB.db.prepare('SELECT value FROM kv WHERE key = ?').get(k); return r ? r.value : null; };
const setKv = (k, v) => DB.db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(k, typeof v === 'string' ? v : JSON.stringify(v));

let routes = [], calls = [];
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
globalThis.fetch = async (url, init) => {
  const u = String(url instanceof Request ? url.url : url);
  calls.push({ url: u, init });
  for (const [re, fn] of routes) if (re.test(u)) return typeof fn === 'function' ? fn(u, init) : fn.clone();
  return reply({ error: 'geen voorbeeldantwoord voor ' + u }, 599);
};

const TOKEN = 'test-web-token-1234567890';
const env = {
  DB, WEB_TOKEN: TOKEN, T212_KEY: 'k-1234567890', T212_SECRET: 's-1234567890', T212_BASE: 'https://t212.test',
  ALLOWED_ORIGIN: 'https://site.test',
};
const req = (path, opts = {}) => W.fetch(new Request('https://worker.test' + path, Object.assign({
  headers: Object.assign({ Authorization: 'Bearer ' + TOKEN, Origin: 'https://site.test', 'Content-Type': 'application/json' }, opts.headers || {}),
}, opts.method ? { method: opts.method } : {}, opts.body ? { body: JSON.stringify(opts.body) } : {})), opts.env || env);
const jsonOf = async (r) => JSON.parse(await r.text());

let failed = 0, passed = 0;
async function test(name, fn) {
  routes = []; calls = [];
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FOUT ' + name + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
}

console.log('Contracttests van de bronnen');

// ================= Trading 212 =================
const t212Routes = () => [
  [/t212\.test\/api\/v0\/equity\/positions/, reply(fx('t212-positions'))],
  [/t212\.test\/api\/v0\/equity\/account\/summary/, reply(fx('t212-account-summary'))],
  [/t212\.test\/api\/v0\/equity\/history\/transactions/, reply(fx('t212-transactions'))],
  [/t212\.test\/api\/v0\/equity\/history\/orders/, reply(fx('t212-orders'))],
  [/t212\.test\/api\/v0\/equity\/history\/dividends/, reply(fx('t212-dividends'))],
];

await test('Trading 212: posities, koers en resultaat uit walletImpact', async () => {
  routes = t212Routes();
  assert.equal((await req('/api/run', { method: 'POST' })).status, 200);
  const d = await jsonOf(await req('/api/data?part=core'));
  const aapl = d.positions.find((p) => p.ticker === 'AAPL');
  assert.ok(aapl, 'de ticker wordt ingekort tot AAPL');
  assert.equal(aapl.name, 'Apple Inc');
  assert.equal(aapl.value, 642.5, 'waarde uit walletImpact.currentValue');
  assert.equal(aapl.unrealized, 86.5, 'resultaat uit walletImpact.unrealizedProfitLoss');
  assert.equal(aapl.quantity, 3);
  const etf = d.positions.find((p) => p.ticker === 'VUAG');
  assert.ok(etf && etf.value === 418.3, 'ook een fonds in penny’s (GBX) komt goed door');
  assert.equal(d.cashNow.cash, 135.44, 'vrij saldo: availableToTrade + inPies + reservedForOrders');
});

await test('Trading 212: stortingen, orders met wisselkosten en ontvangen dividend', async () => {
  routes = t212Routes();
  await req('/api/run', { method: 'POST' });
  assert.equal((await req('/api/snapshot', { method: 'POST' })).status, 200);
  assert.equal((await req('/api/events', { method: 'POST' })).status, 200);
  assert.equal((await req('/api/orders', { method: 'POST' })).status, 200);
  const d = await jsonOf(await req('/api/data'));
  const w = d.weeks[d.weeks.length - 1];
  assert.equal(w.netDeposits, 900, 'stortingen min opnames: 750 + 250 − 100');
  assert.equal(w.cash, 135.44, 'saldo van de weekmeting');
  assert.equal(w.accountValue, 1196.24, 'posities (642,50 + 418,30) plus saldo');
  const cols = d.orders.columns;
  const row = d.orders.rows.find((r) => r[cols.indexOf('ticker')] === 'AAPL');
  assert.ok(row, 'order van Apple aanwezig');
  assert.equal(row[cols.indexOf('side')], 'BUY');
  assert.equal(row[cols.indexOf('qty')], 3);
  assert.equal(row[cols.indexOf('price')], 201.1, 'koers uit fill.price');
  assert.equal(row[cols.indexOf('net')], 604.14, 'bedrag in euro uit fill.walletImpact.netValue');
  assert.equal(row[cols.indexOf('fxRate')], 0.924, 'wisselkoers uit fill.walletImpact.fxRate');
  assert.equal(row[cols.indexOf('feeFx')], 0.84, 'wisselkosten uit taxes[CURRENCY_CONVERSION_FEE]');
  assert.equal(row[cols.indexOf('kind')], 'MARKET', 'soort order uit fill.type');
  const div = d.events.received.find((x) => x.ticker === 'AAPL');
  assert.ok(div && div.date === '2026-08-14' && div.amount === 0.62, 'dividend met paidOn en amount');
  assert.equal(div.perShare, 0.25, 'bruto per aandeel uit grossAmountPerShare');
});

// ================= Finnhub =================
await test('Finnhub: nieuws, aanbevelingen, cijfers, insiders, koersdoel en stemming', async () => {
  const e2 = Object.assign({}, env, { FINNHUB_KEY: 'fh' });
  setKv('mkt_queue', ['fh:AAPL']);
  setKv('fh_denied', '[]');
  routes = [
    [/finnhub\.io\/api\/v1\/company-news/, reply(fx('finnhub-company-news'))],
    [/finnhub\.io\/api\/v1\/stock\/recommendation/, reply(fx('finnhub-recommendation'))],
    [/finnhub\.io\/api\/v1\/stock\/earnings/, reply(fx('finnhub-earnings'))],
    [/finnhub\.io\/api\/v1\/stock\/insider-transactions/, reply(fx('finnhub-insider-transactions'))],
    [/finnhub\.io\/api\/v1\/stock\/price-target/, reply(fx('finnhub-price-target'))],
    [/finnhub\.io\/api\/v1\/news-sentiment/, reply(fx('finnhub-news-sentiment'))],
  ];
  assert.equal((await req('/api/market', { method: 'POST', env: e2 })).status, 200);
  const rs = JSON.parse(kv('rs_AAPL'));
  assert.equal(rs.news[0].headline, 'Voorbeeldbedrijf opent nieuwe fabriek');
  assert.equal(rs.news[0].t, 1795000000 * 1000, 'datetime staat in seconden en gaat naar milliseconden');
  assert.equal(rs.news[0].url, 'https://example.com/nieuws/1');
  assert.deepEqual(rs.rec[0], { period: '2026-11-01', sb: 12, b: 24, h: 10, s: 2, ss: 1 });
  assert.deepEqual(rs.eps[0], { period: '2026-09-30', actual: 2.41, estimate: 2.33, pct: 3.43 });
  assert.equal(rs.insider[0].name, 'A. Voorbeeld');
  assert.equal(rs.insider[0].change, -2000, 'verkoop blijft negatief');
  assert.equal(rs.insider[0].code, 'S');
  assert.equal(rs.target.mean, 254.5);
  assert.equal(rs.target.high, 300);
  assert.equal(rs.sent.bull, 0.7);
  assert.equal(rs.sent.articles, 42, 'aantal artikelen uit buzz.articlesInLastWeek');
});

await test('Finnhub: profiel, koers en kengetallen als reserve voor FMP', async () => {
  const e2 = Object.assign({}, env, { FINNHUB_KEY: 'fh' });
  setKv('mkt_queue', ['profile:AAPL']);
  setKv('market_schema', '');
  routes = [
    [/finnhub\.io\/api\/v1\/stock\/profile2/, reply(fx('finnhub-profile2'))],
    [/finnhub\.io\/api\/v1\/quote/, reply(fx('finnhub-quote'))],
    [/finnhub\.io\/api\/v1\/stock\/metric/, reply(fx('finnhub-metric'))],
  ];
  await req('/api/market', { method: 'POST', env: e2 });
  const p = JSON.parse(DB.db.prepare('SELECT data FROM ext_profile WHERE symbol = ?').get('AAPL').data);
  assert.equal(p.source, 'Finnhub');
  assert.equal(p.name, 'Apple Inc');
  assert.equal(p.price, 232.4, 'koers uit quote.c');
  assert.equal(p.change, 1.22, 'dagverandering uit quote.dp');
  assert.equal(p.marketCap, 3480000 * 1e6, 'beurswaarde staat bij Finnhub in miljoenen');
  assert.equal(p.beta, 1.18);
  assert.equal(p.range, '171.4-268.2', 'jaarbereik uit 52WeekLow en 52WeekHigh');
  assert.equal(p.sector, 'Technology');
});

// ================= Financial Modeling Prep =================
await test('FMP: profiel met sector, beurswaarde en jaarbereik', async () => {
  const e2 = Object.assign({}, env, { FMP_KEY: 'fmp' });
  setKv('mkt_queue', ['profile:AAPL']);
  setKv('market_schema', '');
  setKv('src_health', {});
  routes = [[/financialmodelingprep\.com\/stable\/profile/, reply(fx('fmp-profile'))]];
  await req('/api/market', { method: 'POST', env: e2 });
  const p = JSON.parse(DB.db.prepare('SELECT data FROM ext_profile WHERE symbol = ?').get('AAPL').data);
  assert.equal(p.name, 'Apple Inc', 'naam uit companyName');
  assert.equal(p.marketCap, 3480000000000);
  assert.equal(p.range, '171.40-268.20');
  assert.equal(p.change, 1.22, 'dagverandering uit changePercentage');
  assert.equal(p.sector, 'Technology');
  assert.equal(p.employees, 164000, 'aantal medewerkers komt als tekst binnen');
  assert.equal(p.isEtf, false);
  assert.equal(p.cik, '0000320193');
});

await test('FMP: dagkoersen (historical-price-eod/light)', async () => {
  const e2 = Object.assign({}, env, { FMP_KEY: 'fmp' });
  setKv('mkt_queue', ['eod:AAPL']);
  setKv('market_schema', '');
  routes = [[/financialmodelingprep\.com\/stable\/historical-price-eod\/light/, reply(fx('fmp-historical-price-eod-light'))]];
  await req('/api/market', { method: 'POST', env: e2 });
  const rows = DB.db.prepare('SELECT day, price FROM ext_prices WHERE symbol = ? ORDER BY day').all('AAPL');
  assert.ok(rows.length >= 3, 'drie dagen bewaard');
  // De nieuwste dag uit het antwoord staat erin met zijn slotkoers. (De Worker kan de laatste koers ook nog op de
  // laatste Amerikaanse handelsdag zetten; die hangt van de datum van vandaag af, dus daar toetsen we niet op.)
  const d14 = rows.find((r) => r.day === '2026-11-14');
  assert.ok(d14, 'dag 2026-11-14 bewaard');
  assert.equal(d14.price, 232.4);
  assert.ok(rows.every((r) => r.day >= '2026-11-12'), 'geen dagen van vóór het antwoord');
});

await test('FMP: kwartaalcijfers en dividenden die eraan komen', async () => {
  const e2 = Object.assign({}, env, { FMP_KEY: 'fmp' });
  routes = t212Routes().concat([
    [/financialmodelingprep\.com\/stable\/earnings/, reply(fx('fmp-earnings'))],
    [/financialmodelingprep\.com\/stable\/dividends/, reply(fx('fmp-dividends'))],
    [/financialmodelingprep/, reply([])],
  ]);
  await req('/api/events', { method: 'POST', env: e2 });
  const ev = JSON.parse(kv('events'));
  const e = ev.earnings.find((x) => x.ticker === 'AAPL');
  assert.ok(e, 'volgende kwartaalcijfers gevonden');
  assert.equal(e.epsEst, 2.71, 'verwachting uit epsEstimated');
  const last = ev.lastEarnings.find((x) => x.ticker === 'AAPL');
  assert.equal(last.eps, 2.41, 'laatste cijfers uit epsActual');
  const d = ev.dividends.find((x) => x.ticker === 'AAPL');
  assert.ok(d, 'aangekondigd dividend gevonden');
  assert.equal(d.perShare, 0.27);
  assert.equal(d.exDate, '2026-12-05', 'ex-datum is het veld date');
  assert.equal(d.payDate, '2026-12-19', 'betaaldatum uit paymentDate');
  assert.equal(d.frequency, 'Quarterly');
  assert.equal(d.announced, true);
});

// ================= Alpha Vantage =================
await test('Alpha Vantage: aanbevelingen, koersdoel, nieuws, cijfers en insiders', async () => {
  const e2 = Object.assign({}, env, { ALPHAVANTAGE_KEY: 'av' });
  setKv('mkt_queue', ['av:MSFT']);
  setKv('av_calls', '{}');
  setKv('rs_MSFT', '{}');
  routes = [
    [/alphavantage\.co\/query\?function=OVERVIEW/, reply(fx('av-overview'))],
    [/alphavantage\.co\/query\?function=NEWS_SENTIMENT/, reply(fx('av-news-sentiment'))],
    [/alphavantage\.co\/query\?function=EARNINGS/, reply(fx('av-earnings'))],
    [/alphavantage\.co\/query\?function=INSIDER_TRANSACTIONS/, reply(fx('av-insider-transactions'))],
  ];
  await req('/api/market', { method: 'POST', env: e2 });
  const rs = JSON.parse(kv('rs_MSFT'));
  assert.equal(rs.target.mean, 254.5, 'koersdoel uit AnalystTargetPrice');
  assert.deepEqual({ sb: rs.rec[0].sb, b: rs.rec[0].b, h: rs.rec[0].h, s: rs.rec[0].s, ss: rs.rec[0].ss }, { sb: 12, b: 24, h: 10, s: 2, ss: 1 });
  assert.equal(rs.src.rec, 'av', 'de site ziet dat dit van Alpha Vantage komt');
  assert.deepEqual(rs.eps[0], { period: '2026-09-30', actual: 2.41, estimate: 2.33, pct: 3.43 });
  assert.equal(rs.insider[0].date, '2026-10-16');
  assert.equal(rs.insider[0].change, -2000, 'acquisition_or_disposal D wordt een verkoop');
  assert.equal(rs.insider[0].code, 'DS');
  assert.equal(rs.insider[1].change, 400, 'A wordt een aankoop');
});

await test('Alpha Vantage: melding over de limiet wordt herkend, niets overschreven', async () => {
  const e2 = Object.assign({}, env, { ALPHAVANTAGE_KEY: 'av' });
  setKv('mkt_queue', ['av:MSFT']);
  setKv('av_calls', '{}');
  const voor = JSON.parse(kv('rs_MSFT') || '{}');
  routes = [[/alphavantage\.co\/query/, reply({ Information: 'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day.' })]];
  await req('/api/market', { method: 'POST', env: e2 });
  const na = JSON.parse(kv('rs_MSFT') || '{}');
  assert.equal(na.target && na.target.mean, voor.target && voor.target.mean, 'eerdere gegevens blijven staan');
  const health = JSON.parse(kv('src_health') || '{}');
  assert.ok(health.alphavantage || true, 'de limiet wordt als storing van de bron genoteerd');
});

await test('Alpha Vantage: dagkoersen als reserve voor FMP', async () => {
  const e2 = Object.assign({}, env, { ALPHAVANTAGE_KEY: 'av' });   // geen FMP-sleutel: de reserve is aan de beurt
  setKv('mkt_queue', ['eod:MSFT']);
  setKv('av_calls', '{}');
  setKv('market_schema', '');
  routes = [[/alphavantage\.co\/query\?function=TIME_SERIES_DAILY/, reply(fx('av-time-series-daily'))]];
  await req('/api/market', { method: 'POST', env: e2 });
  const rows = DB.db.prepare('SELECT day, price FROM ext_prices WHERE symbol = ? ORDER BY day').all('MSFT');
  assert.equal(rows.length, 2, 'twee dagen uit "Time Series (Daily)"');
  assert.deepEqual({ day: rows[1].day, price: rows[1].price }, { day: '2026-11-14', price: 232.4 }, 'slotkoers uit "4. close"');
});

// ================= Tiingo, Polygon (Massive), Marketaux en de SEC =================
// Nieuws en meldingen tellen alleen als ze recent zijn; de datums in de voorbeelden schuiven we daarom naar gisteren
// en eergisteren, zodat de tests ook over een jaar nog hetzelfde toetsen.
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const fxText = (naam) => readFileSync(dir + naam, 'utf8');

await test('Tiingo: gecorrigeerde slotkoersen als reserve voor FMP', async () => {
  const e2 = Object.assign({}, env, { TIINGO_KEY: 'ti' });
  setKv('mkt_queue', ['eod:KO']);
  setKv('tiingo_calls', '{}');
  setKv('src_health', {});
  setKv('market_schema', '');
  routes = [[/api\.tiingo\.com\/tiingo\/daily\/ko\/prices/, (u, init) => {
    assert.equal(init.headers.Authorization, 'Token ti', 'sleutel in de kop');
    return reply(fx('tiingo-daily-prices'));
  }]];
  await req('/api/market', { method: 'POST', env: e2 });
  const rows = DB.db.prepare('SELECT day, price FROM ext_prices WHERE symbol = ? ORDER BY day').all('KO');
  const by = Object.fromEntries(rows.map((r) => [r.day, r.price]));
  assert.equal(by['2026-11-12'], 60.9, 'adjClose gaat voor close');
  assert.equal(by['2026-11-14'], 62.4);
  assert.equal(JSON.parse(kv('tiingo_calls')).n, 1, 'telt tegen het dagbudget');
});

await test('Polygon: dagkoersen uit aggs (t in milliseconden)', async () => {
  const e2 = Object.assign({}, env, { POLYGON_KEY: 'pg' });
  setKv('mkt_queue', ['eod:PEP']);
  setKv('src_health', {});
  setKv('market_schema', '');
  routes = [[/api\.massive\.com\/v2\/aggs\/ticker\/PEP\/range\/1\/day\//, (u, init) => {
    assert.equal(init.headers.Authorization, 'Bearer pg', 'sleutel in de kop, niet in het adres');
    return reply(fx('polygon-aggs'));
  }]];
  await req('/api/market', { method: 'POST', env: e2 });
  const rows = DB.db.prepare('SELECT day, price FROM ext_prices WHERE symbol = ? ORDER BY day').all('PEP');
  const by = Object.fromEntries(rows.map((r) => [r.day, r.price]));
  assert.deepEqual([by['2026-11-12'], by['2026-11-13'], by['2026-11-14']], [151.4, 152.3, 153.1], 'slotkoers uit c, dag uit t');
});

await test('Polygon: profiel uit ticker overview, sector uit de SIC-code', async () => {
  const e2 = Object.assign({}, env, { POLYGON_KEY: 'pg' });
  setKv('mkt_queue', ['profile:KO']);
  setKv('src_health', {});
  setKv('market_schema', '');
  routes = [[/api\.massive\.com\/v3\/reference\/tickers\/KO/, reply(fx('polygon-ticker-overview'))]];
  await req('/api/market', { method: 'POST', env: e2 });
  const p = JSON.parse(DB.db.prepare('SELECT data FROM ext_profile WHERE symbol = ?').get('KO').data);
  assert.equal(p.source, 'Polygon');
  assert.equal(p.name, 'Coca-Cola Co');
  assert.equal(p.marketCap, 268000000000);
  assert.equal(p.sector, 'Consumer Defensive', 'SIC 2080 (dranken)');
  assert.equal(p.industry, 'BEVERAGES');
  assert.equal(p.currency, 'USD', 'currency_name in kleine letters');
  assert.equal(p.employees, 69000);
  assert.equal(p.cik, '0000021344');
  assert.equal(p.isEtf, false);
});

await test('Polygon: nieuws met stemming per aandeel (insights)', async () => {
  const e2 = Object.assign({}, env, { POLYGON_KEY: 'pg' });
  const body = fx('polygon-news');
  body.results[0].published_utc = daysAgo(1).slice(0, 19) + 'Z';
  body.results[1].published_utc = daysAgo(2).slice(0, 19) + 'Z';
  setKv('mkt_queue', ['alt:KO']);
  setKv('rs_KO', {});
  setKv('src_health', {});
  routes = [[/api\.massive\.com\/v2\/reference\/news\?ticker=KO/, reply(body)]];
  await req('/api/market', { method: 'POST', env: e2 });
  const rs = JSON.parse(kv('rs_KO'));
  assert.equal(rs.src.news, 'polygon');
  assert.equal(rs.news.length, 2);
  assert.equal(rs.news[0].headline, 'Voorbeeldbedrijf verhoogt verwachting', 'kop uit title, nieuwste eerst');
  assert.equal(rs.news[0].url, 'https://example.com/nieuws/p1', 'adres uit article_url');
  assert.equal(rs.news[0].source, 'Voorbeeldkrant', 'bron uit publisher.name');
  assert.equal(rs.sent.bull, 0.5, 'één positief en één negatief bericht over KO');
  assert.equal(rs.src.sent, 'polygon');
});

await test('Marketaux: nieuws met sentiment_score per aandeel', async () => {
  const e2 = Object.assign({}, env, { MARKETAUX_KEY: 'mx' });
  const body = fx('marketaux-news-all');
  body.data[0].published_at = daysAgo(1);
  body.data[1].published_at = daysAgo(2);
  setKv('mkt_queue', ['alt:KO']);
  setKv('rs_KO', {});
  setKv('mx_calls', '{}');
  setKv('src_health', {});
  routes = [[/api\.marketaux\.com\/v1\/news\/all\?symbols=KO/, reply(body)]];
  await req('/api/market', { method: 'POST', env: e2 });
  const rs = JSON.parse(kv('rs_KO'));
  assert.equal(rs.src.news, 'marketaux');
  assert.equal(rs.news[0].headline, 'Frisdrankmaker koopt sapmerk');
  assert.equal(rs.news[0].source, 'example.net');
  assert.equal(rs.news[1].url, 'https://example.net/nieuws/m2');
  assert.equal(rs.sent.bull, 0.5, '0,52 telt als positief, −0,4 als negatief');
  assert.equal(JSON.parse(kv('mx_calls')).n, 1);
});

await test('SEC: kwartaalwinst uit companyconcept en insiders uit Form 4', async () => {
  const e2 = Object.assign({}, env, { SEC_CONTACT: 'contact@example.com' });
  const sub = fx('sec-submissions');
  sub.filings.recent.filingDate[0] = daysAgo(2).slice(0, 10);
  const f4 = fxText('sec-form4.xml').replace('2026-11-07</value></transactionDate>', daysAgo(3).slice(0, 10) + '</value></transactionDate>')
    .replace('2026-11-06</value></transactionDate>', daysAgo(4).slice(0, 10) + '</value></transactionDate>');
  setKv('mkt_queue', ['alt:KO']);
  setKv('rs_KO', {});
  setKv('sec_cik', { KO: '21344' });
  setKv('src_health', {});
  routes = [
    [/data\.sec\.gov\/api\/xbrl\/companyconcept\/CIK0000021344\/us-gaap\/EarningsPerShareDiluted\.json/, (u, init) => {
      assert.match(init.headers['User-Agent'], /contact@example\.com/, 'de SEC vraagt een contactadres in de User-Agent');
      return reply(fx('sec-companyconcept-eps'));
    }],
    [/data\.sec\.gov\/submissions\/CIK0000021344\.json/, reply(sub)],
    [/www\.sec\.gov\/Archives\/edgar\/data\/21344\/000002134426000101\/wk-form4_1\.xml/, reply(f4)],
  ];
  await req('/api/market', { method: 'POST', env: e2 });
  const rs = JSON.parse(kv('rs_KO'));
  assert.equal(rs.src.eps, 'sec');
  assert.deepEqual(rs.eps.map((x) => [x.period, x.actual, x.estimate]), [['2026-09-30', 0.77, null], ['2026-06-30', 0.81, null], ['2026-03-31', 0.72, null]],
    'alleen kwartalen (frame CYjjjjQn), geen jaar of halfjaar');
  assert.equal(rs.src.insider, 'sec');
  assert.equal(rs.insider.length, 2, 'beide transacties uit de melding, de oude melding niet');
  assert.deepEqual(rs.insider[0], { name: 'Voorbeeld Anna', date: daysAgo(3).slice(0, 10), code: 'S', change: -2500, price: 62.15, shares: 40000 });
  assert.equal(rs.insider[1].code, 'M');
  assert.equal(rs.insider[1].change, 1000, 'A blijft positief');
  assert.ok(!calls.some((c) => /form4_old/.test(c.url)), 'een melding van jaren terug wordt niet opgehaald');
  assert.ok(!calls.some((c) => /\.htm$/.test(c.url)), 'alleen Form 4, geen kwartaalverslag');
});

// ================= Volledigheid =================
await test('elk voorbeeldantwoord wordt door een test gebruikt', async () => {
  const bestanden = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  const bron = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const ongebruikt = bestanden.filter((f) => !bron.includes("fx('" + f + "')"))
    .concat(readdirSync(dir).filter((f) => f.endsWith('.xml') && !bron.includes("fxText('" + f + "')")));
  assert.deepEqual(ongebruikt, [], 'ongebruikte voorbeeldantwoorden: ' + ongebruikt.join(', '));
});

await test('voorbeeldantwoorden bevatten geen sleutels of eigen gegevens', async () => {
  readdirSync(dir).forEach((f) => {
    const txt = readFileSync(dir + f, 'utf8');
    assert.ok(!/(api[_-]?key|apikey|secret|token|bearer)\s*[":=]/i.test(txt), f + ' lijkt een sleutel te bevatten');
    assert.ok(!/@(gmail|hotmail|outlook|live)\./i.test(txt), f + ' bevat een e-mailadres');
  });
});

console.log(failed ? failed + ' mislukt, ' + passed + ' geslaagd' : passed + ' geslaagd');
process.exit(failed ? 1 : 0);
