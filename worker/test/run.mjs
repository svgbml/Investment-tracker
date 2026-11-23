// Tests voor de Worker: een D1-stand-in op SQLite in het geheugen en nep-antwoorden voor alle externe bronnen.
// Draaien: node worker/test/run.mjs   (Node 22.13 of nieuwer; zonder node:sqlite worden de tests overgeslagen)
import assert from 'node:assert/strict';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch (e) {
  console.log('node:sqlite ontbreekt in deze Node-versie (' + process.version + '); Worker-tests overgeslagen.');
  process.exit(0);
}
const WM = await import('../src/index.js');
const W = WM.default;

// ---------- D1-stand-in ----------
const MEASURE = { on: false };
function measureMeta(st, n) {
  if (!MEASURE.on) return {};
  let read = 0;
  try {
    const plan = st.db.prepare('EXPLAIN QUERY PLAN ' + st.sql).all(...st.args);
    for (const p of plan) {
      const m = /^(SCAN|SEARCH) (\w+)/.exec(p.detail || '');
      if (!m) continue;
      if (m[1] === 'SCAN') read += Number(st.db.prepare('SELECT COUNT(*) AS n FROM ' + m[2]).get().n) || 0;
      else read += Math.max(1, n);
    }
  } catch (e) { /* geen plan (bijvoorbeeld CREATE) */ }
  if (MEASURE.log) MEASURE.log.push([read, st.sql.replace(/\s+/g, ' ').slice(0, 90)]);
  return { rows_read: read, rows_written: /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(st.sql) ? n : 0 };
}
class Stmt {
  constructor(db, sql, args) { this.db = db; this.sql = sql; this.args = args || []; }
  bind(...a) { return new Stmt(this.db, this.sql, a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v))); }
  async first(col) { const r = this.db.prepare(this.sql).get(...this.args); return r === undefined ? null : col ? r[col] : { ...r }; }
  async all() { const results = this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })); return { success: true, results, meta: measureMeta(this, results.length) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: Object.assign({ changes: Number(r.changes) }, measureMeta(this, Number(r.changes))) }; }
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

// ---------- Nep-fetch: per test een lijst [patroon, antwoord] ----------
let routes = [], calls = [];
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
globalThis.fetch = async (url, init) => {
  const u = String(url instanceof Request ? url.url : url);
  calls.push({ url: u, init });
  for (const [re, fn] of routes) if (re.test(u)) return typeof fn === 'function' ? fn(u, init) : fn.clone();
  return reply({ error: 'geen nep-antwoord voor ' + u }, 599);
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

// Basis: posities en een paar dagen geschiedenis
const T212_POS = [
  { instrument: { ticker: 'AAPL_US_EQ', name: 'Apple', currency: 'USD', isin: 'US0378331005' }, quantity: 2, currentPrice: 230, averagePricePaid: 200, createdAt: '2026-01-02T10:00:00Z', walletImpact: { currentValue: 400, unrealizedProfitLoss: 50, totalCost: 350, fxImpact: -3 } },
  { instrument: { ticker: 'VUAGl_EQ', name: 'Vanguard S&P 500 UCITS ETF (Acc)', currency: 'GBX', isin: 'IE00BFMXXD54' }, quantity: 5, currentPrice: 9000, averagePricePaid: 8500, createdAt: '2026-01-02T10:00:00Z', walletImpact: { currentValue: 520, unrealizedProfitLoss: 20, totalCost: 500, fxImpact: 1 } },
];
const t212Routes = () => [
  [/t212\.test\/api\/v0\/equity\/positions/, reply(T212_POS)],
  [/t212\.test\/api\/v0\/equity\/account\/summary/, reply({ currency: 'EUR', cash: { availableToTrade: 80, inPies: 0, reservedForOrders: 0 } })],
  [/t212\.test\/api\/v0\/equity\/history\/transactions/, reply({ items: [{ type: 'DEPOSIT', amount: 900 }], nextPagePath: null })],
  [/t212\.test\/api\/v0\/equity\/history\/orders/, reply({ items: [], nextPagePath: null })],
  [/t212\.test\/api\/v0\/equity\/history\/dividends/, reply({ items: [], nextPagePath: null })],
];

console.log('Worker-tests');

await test('meting via /api/run en gegevens in twee delen met ETag', async () => {
  routes = t212Routes();
  const r = await req('/api/run', { method: 'POST' });
  assert.equal(r.status, 200, await r.clone().text());
  const core = await req('/api/data?part=core');
  assert.equal(core.status, 200);
  const tag = core.headers.get('ETag');
  assert.ok(tag, 'ETag ontbreekt');
  const c = await jsonOf(core);
  assert.equal(c.part, 'core');
  assert.equal(c.cashNow && c.cashNow.cash, 80, 'vrij saldo bij elke meting');
  assert.ok(c.positions.length === 2 && !('market' in c));
  const again = await req('/api/data?part=core', { headers: { 'If-None-Match': tag } });
  assert.equal(again.status, 304);
  const extra = await jsonOf(await req('/api/data?part=extra'));
  assert.equal(extra.part, 'extra');
  const full = await jsonOf(await req('/api/data'));
  assert.ok(full.positions && 'research' in full, 'zonder part beide delen samen');
  const cors = (await req('/api/data?part=core')).headers.get('Access-Control-Expose-Headers');
  assert.match(cors, /ETag/);
});

await test('zonder toegangscode geen gegevens; token in de kop werkt', async () => {
  const r = await W.fetch(new Request('https://worker.test/api/data?part=core'), env);
  assert.equal(r.status, 401);
});

await test('inloggen met de Trading 212-sleutel, met limiet per verbinding', async () => {
  const login = (key, ip) => W.fetch(new Request('https://worker.test/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ key, secret: env.T212_SECRET }) }), env);
  let r = await login(env.T212_KEY, '1.1.1.1');
  assert.equal(r.status, 200);
  assert.equal((await jsonOf(r)).token, TOKEN);
  for (let i = 0; i < 10; i++) await login('fout-1234567890', '2.2.2.2');
  assert.equal((await login(env.T212_KEY, '2.2.2.2')).status, 429, 'dit adres is geblokkeerd');
  assert.equal((await login(env.T212_KEY, '3.3.3.3')).status, 200, 'een ander adres niet');
});

await test('instellingen: meldingsregels, notities en rekeningen', async () => {
  const r = await jsonOf(await req('/api/settings', { method: 'POST', body: { alerts: { move: 4, earnings: true, insider: false, drift: 6 }, mailAmounts: false, notes: { 'AAPL|1767348000000': 'Waarom' }, accounts: [{ name: 'Broker', cash: 10, holdings: [{ name: 'X', value: 5 }] }] } }));
  assert.deepEqual(r.settings.alerts, { move: 4, earnings: true, insider: false, drift: 6, quietFrom: 0, quietTo: 0, digest: false, digestHour: 18, ratings: true, news: 'all' });
  assert.equal(r.settings.mailAmounts, false);
  assert.equal(r.settings.accounts[0].holdings[0].value, 5);
});

await test('deel-link: alleen lezen, geschaalde bedragen, zonder notities', async () => {
  const on = await jsonOf(await req('/api/share', { method: 'POST', body: { action: 'on', amounts: false } }));
  assert.ok(on.token && on.on);
  const pub = await W.fetch(new Request('https://worker.test/share/' + on.token, { headers: { Origin: 'https://site.test' } }), env);
  assert.equal(pub.status, 200);
  const d = await jsonOf(pub);
  assert.equal(d.shared.amounts, false);
  assert.ok(!d.settings.notes && !d.settings.accounts, 'geen notities of rekeningen');
  const tot = d.positions.reduce((s, p) => s + p.value, 0);
  assert.ok(Math.abs(tot - 920 * 10000 / (d.weeks.length ? d.weeks[d.weeks.length - 1].accountValue : 920)) < 1 || tot > 0, 'bedragen geschaald');
  assert.notEqual(Math.round(tot), 920, 'echte bedragen zijn niet te zien');
  assert.equal((await W.fetch(new Request('https://worker.test/share/' + 'x'.repeat(32)), env)).status, 404);
  await req('/api/share', { method: 'POST', body: { action: 'off' } });
  assert.equal((await W.fetch(new Request('https://worker.test/share/' + on.token), env)).status, 404, 'uitgezet');
});

await test('CSV-import: orders zonder dubbelen, dividend met bronbelasting', async () => {
  DB.db.exec('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, ts INTEGER, ticker TEXT, name TEXT, side TEXT, qty REAL, price REAL, currency TEXT, fx_rate REAL, net REAL, realised REAL, fee_fx REAL, fee_other REAL, kind TEXT)');
  DB.db.prepare('INSERT OR REPLACE INTO orders (id, ts, ticker, name, side, qty, price, currency, fx_rate, net, realised, fee_fx, fee_other, kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('api1', 1767348000000, 'AAPL', 'Apple', 'BUY', 1, 200, 'USD', 1.1, 181.8, 0, 0.27, 0, 'TRADE');
  setKv('events', { received: [{ ticker: 'AAPL', date: '2026-02-14', amount: 0.35, perShare: 0.25, qty: 2 }], earnings: [], dividends: [], lastEarnings: [] });
  const r = await jsonOf(await req('/api/import-csv', { method: 'POST', body: {
    orders: [{ id: 'EOF1', ts: 1767348060000, tk: 'AAPL', side: 'BUY', qty: 1, price: 200, cur: 'USD', net: 181.8 },
      { id: 'EOF2', ts: 1767000000000, tk: 'MSFT', side: 'BUY', qty: 0.5, price: 400, cur: 'USD', net: 182, feeFx: 0.27 }],
    dividends: [{ tk: 'AAPL', date: '2026-02-14', amount: 0.35, wht: 0.08, whtCur: 'USD' }, { tk: 'KO', date: '2025-12-01', amount: 0.4, wht: 0.07 }],
  } }));
  assert.equal(r.orders, 1, 'de AAPL-order bestond al via de API');
  assert.equal(r.skipped, 1);
  assert.equal(r.dividends, 2);
  const ev = JSON.parse(kv('events'));
  const a = ev.received.find((d) => d.ticker === 'AAPL');
  assert.equal(a.wht, 0.08);
  assert.ok(ev.received.some((d) => d.ticker === 'KO' && d.src === 'csv'));
});

await test('wisselkoersen: Frankfurter stuk, dan de ECB', async () => {
  routes = [
    [/frankfurter/, reply('kapot', 500)],
    [/data-api\.ecb\.europa\.eu\/service\/data\/EXR/, reply('KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-13,1.0812\nEXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-11-13,0.8401\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-12,1.0790\n')],
    [/data-api\.ecb\.europa\.eu\/service\/data\/HICP/, reply('', 503)],
    [/eurostat/, reply({ dimension: { time: { category: { index: { '2026-08': 0, '2026-09': 1 } } } }, value: { 0: 129.1, 1: 129.6 } })],
    [/fred|stlouisfed/, reply('', 403)],
  ];
  setKv('mkt_queue', '[]');
  await req('/api/market?plan=1', { method: 'POST' });
  const fx = JSON.parse(kv('fx'));
  assert.match(fx.source, /ECB Data Portal/);
  assert.deepEqual(fx.rates.USD[0], ['2026-11-12', 1.079]);
  const h = JSON.parse(kv('hicp'));
  assert.match(h.source, /Eurostat/);
  assert.equal(h.series.NL[1][1], 129.6);
  const health = JSON.parse(kv('src_health'));
  assert.equal(health.frankfurter.backup, 'ECB Data Portal');
  const f = await jsonOf(await req('/api/features'));
  assert.ok(f.features.health.frankfurter, 'status zichtbaar voor de site');
});

await test('profielen: FMP aan zijn limiet, dan Finnhub', async () => {
  const e2 = Object.assign({}, env, { FMP_KEY: 'fmp', FINNHUB_KEY: 'fh' });
  setKv('src_health', {});
  setKv('mkt_queue', ['profile:AAPL', 'profile:MSFT']);
  setKv('market_schema', '');
  routes = [
    [/financialmodelingprep/, reply({ 'Error Message': 'Limit Reach' }, 429)],
    [/finnhub\.io\/api\/v1\/stock\/profile2/, (u) => reply({ name: u.includes('AAPL') ? 'Apple Inc' : 'Microsoft', currency: 'USD', finnhubIndustry: 'Technology', marketCapitalization: 3500000, exchange: 'NASDAQ' })],
    [/finnhub\.io\/api\/v1\/quote/, reply({ c: 231.5, dp: 1.2 })],
    [/finnhub\.io\/api\/v1\/stock\/metric/, reply({ metric: { beta: 1.21, '52WeekHigh': 260, '52WeekLow': 165 } })],
  ];
  const r = await req('/api/market', { method: 'POST', env: e2 });
  assert.equal(r.status, 200, await r.clone().text());
  const p = JSON.parse(DB.db.prepare('SELECT data FROM ext_profile WHERE symbol = ?').get('AAPL').data);
  assert.equal(p.source, 'Finnhub');
  assert.equal(p.sector, 'Technology');
  assert.equal(p.range, '165-260');
  assert.ok(DB.db.prepare('SELECT data FROM ext_profile WHERE symbol = ?').get('MSFT'), 'ook de volgende via Finnhub');
  assert.equal(calls.filter((c) => /financialmodelingprep/.test(c.url)).length, 1, 'na de limiet niet opnieuw bij FMP');
  assert.equal(JSON.parse(kv('src_health')).fmp.backup, 'Finnhub');
});

// ---------- Meldingen: versleuteling controleren door als ontvanger te ontsleutelen ----------
const sub = { kp: await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']), auth: crypto.getRandomValues(new Uint8Array(16)) };
const b64u = (b) => Buffer.from(b).toString('base64url');
const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', sub.kp.publicKey));
async function hmac(key, data) { const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, data)); }
const cat = (...a) => Buffer.concat(a.map((x) => Buffer.from(x)));
async function decryptPush(body) {
  const b = new Uint8Array(body);
  const salt = b.slice(0, 16), idlen = b[20], asPub = b.slice(21, 21 + idlen), ct = b.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, sub.kp.privateKey, 256));
  const te = new TextEncoder();
  const ikm = (await hmac(await hmac(sub.auth, shared), cat(te.encode('WebPush: info\0'), pubRaw, asPub, [1]))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  assert.equal(pt[pt.length - 1], 2, 'laatste record');
  return JSON.parse(new TextDecoder().decode(pt.slice(0, -1)));
}

await test('meldingen: aanmelden, testmelding versleuteld en ondertekend', async () => {
  const k = await jsonOf(await req('/api/push/key'));
  assert.equal(Buffer.from(k.key, 'base64url').length, 65);
  const s = await jsonOf(await req('/api/push/subscribe', { method: 'POST', body: { sub: { endpoint: 'https://push.test/abc', keys: { p256dh: b64u(pubRaw), auth: b64u(sub.auth) } } } }));
  assert.equal(s.devices, 1);
  let got = null;
  routes = [[/push\.test/, (u, init) => { got = init; return reply('', 201); }]];
  const t = await jsonOf(await req('/api/push/test', { method: 'POST' }));
  assert.equal(t.sent, 1);
  assert.equal(got.headers['Content-Encoding'], 'aes128gcm');
  assert.match(got.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  const jwt = got.headers.Authorization.slice(8).split(',')[0].split('.');
  const pub = await crypto.subtle.importKey('raw', Buffer.from(k.key, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(jwt[2], 'base64url'), new TextEncoder().encode(jwt[0] + '.' + jwt[1])), 'handtekening klopt');
  assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).aud, 'https://push.test');
  const msg = await decryptPush(got.body);
  assert.equal(msg.title, 'Testmelding');
  routes = [[/push\.test/, reply('', 410)]];
  await req('/api/push/test', { method: 'POST' });
  assert.equal((await jsonOf(await req('/api/push/key'))).devices, 0, 'verlopen abonnement opgeruimd');
});

await test('melding bij een grote koersbeweging, één keer per dag', async () => {
  await req('/api/push/subscribe', { method: 'POST', body: { sub: { endpoint: 'https://push.test/abc', keys: { p256dh: b64u(pubRaw), auth: b64u(sub.auth) } } } });
  await req('/api/settings', { method: 'POST', body: { alerts: { move: 5, earnings: true, insider: true, drift: 5 } } });
  // Gisteren sloot AAPL op 360, nu 400: +11%
  const now = new Date('2026-11-17T14:00:00Z');
  const y = '2026-11-16';
  DB.db.prepare("INSERT OR REPLACE INTO days (day, ticker, name, open, close, low, high, avg, range, range_pct, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(y, 'AAPL', 'Apple', 360, 360, 355, 362, 359, 7, 0.02, 80, 200);
  DB.db.prepare("INSERT OR REPLACE INTO days (day, ticker, name, open, close, low, high, avg, range, range_pct, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(y, 'VUAG', 'Vanguard', 518, 518, 515, 520, 517, 5, 0.01, 80, 9000);
  const pushes = [];
  routes = t212Routes().concat([[/push\.test/, async (u, init) => { pushes.push(await decryptPush(init.body)); return reply('', 201); }]]);
  await W.scheduled({ cron: '*/10 * * * *', scheduledTime: now.getTime() }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  await W.scheduled({ cron: '*/10 * * * *', scheduledTime: now.getTime() + 600000 }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  const aapl = pushes.filter((p) => /AAPL/.test(p.title));
  assert.equal(aapl.length, 1, 'één melding voor AAPL: ' + JSON.stringify(pushes));
  assert.match(aapl[0].title, /\+11,1%/);
  assert.ok(!pushes.some((p) => /VUAG/.test(p.title)), 'VUAG bewoog minder dan 5%');
});

await test('bijkopen is geen koersbeweging: geen melding, en het aantal stuks gaat mee naar de site', async () => {
  await req('/api/push/subscribe', { method: 'POST', body: { sub: { endpoint: 'https://push.test/abc', keys: { p256dh: b64u(pubRaw), auth: b64u(sub.auth) } } } });
  await req('/api/settings', { method: 'POST', body: { alerts: { move: 5, earnings: true, insider: true, drift: 5 } } });
  // Gisteravond: 1,8 AAPL voor € 360 (€ 200 per stuk). Vandaag 2 stuks voor € 400: bijgekocht, de koers is gelijk
  const now = new Date('2026-11-18T14:00:00Z');
  DB.db.prepare("INSERT OR REPLACE INTO days (day, ticker, name, open, close, low, high, avg, range, range_pct, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run('2026-11-17', 'AAPL', 'Apple', 360, 360, 355, 362, 359, 7, 0.02, 80, 200);
  DB.db.prepare("INSERT OR REPLACE INTO days (day, ticker, name, open, close, low, high, avg, range, range_pct, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run('2026-11-17', 'VUAG', 'Vanguard', 518, 518, 515, 520, 517, 5, 0.01, 80, 9000);
  const yTs = Date.parse('2026-11-17T20:00:00Z');
  const ins = DB.db.prepare('INSERT OR REPLACE INTO intraday (ts, ticker, name, value, unrealized, price, qty) VALUES (?,?,?,?,?,?,?)');
  ins.run(yTs, 'AAPL', 'Apple', 360, 0, 230, 1.8);
  ins.run(yTs, 'VUAG', 'Vanguard', 518, 0, 9000, 5);
  ins.run(yTs, 'TOTAAL', 'Totaal', 878, 0, null, null);
  const pushes = [];
  routes = t212Routes().concat([[/push\.test/, async (u, init) => { pushes.push(await decryptPush(init.body)); return reply('', 201); }]]);
  await W.scheduled({ cron: '*/10 * * * *', scheduledTime: now.getTime() }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!pushes.some((p) => /AAPL/.test(p.title)), 'bijkopen gaf toch een melding: ' + JSON.stringify(pushes));
  assert.ok(!pushes.some((p) => /portefeuille/i.test(p.title)), 'ook het totaal telt de aankoop niet: ' + JSON.stringify(pushes));
  // De site krijgt per meting het aantal stuks (volledig en als aanvulling)
  // Deze meting ligt vóór een latere meting van een eerdere test; in het echt kan dat niet, dus de bewaarde
  // volledige reeksen hier vergeten (zoals op een nieuw apparaat na een nieuwe meting)
  setKv('data_etags', Object.assign(JSON.parse(kv('data_etags') || '{}'), { seriesStamp: '' }));
  const s = await jsonOf(await req('/api/data?part=series'));
  assert.deepEqual(s.intraday.columns, ['time', 'ticker', 'value', 'qty']);
  const row = s.intraday.rows.find((r) => r[1] === 'AAPL' && r[0].startsWith('2026-11-18'));
  assert.ok(row && row[3] === 2, 'aantal stuks in de meting: ' + JSON.stringify(row));
  const d = await jsonOf(await req('/api/data?part=series&since=' + (now.getTime() - 60000)));
  assert.ok(d.delta && d.intraday.rows.some((r) => r[1] === 'AAPL' && r[3] === 2), 'ook in de aanvulling');
});

await test('weekmail staat standaard uit; test via Resend; bij een fout als melding', async () => {
  const e2 = Object.assign({}, env, { RESEND_KEY: 're_test', MAIL_TO: 'iemand@example.com' });
  DB.db.prepare("INSERT OR REPLACE INTO weeks (date, account_value, net_deposits, cash, cost_basis, source) VALUES (?,?,?,?,?,?)").run('2026-11-07', 900, 850, 50, 800, 'API');
  DB.db.prepare("INSERT OR REPLACE INTO weeks (date, account_value, net_deposits, cash, cost_basis, source) VALUES (?,?,?,?,?,?)").run('2026-11-14', 1000, 900, 80, 850, 'API');
  const f = await jsonOf(await req('/api/features', { env: e2 }));
  assert.equal(f.features.flags.weeklyMail, false, 'standaard uit');
  let sent = null;
  routes = [[/api\.resend\.com/, (u, init) => { sent = JSON.parse(init.body); return reply({ id: 'x' }); }]];
  const r = await jsonOf(await req('/api/mail/test', { method: 'POST', env: e2 }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(sent.to, ['iemand@example.com']);
  assert.match(sent.subject, /Weekoverzicht 2026-11-14: \+5,6%/);
  const pushes = [];
  routes = [[/api\.resend\.com/, reply({ message: 'kapot' }, 500)], [/push\.test/, async (u, init) => { pushes.push(await decryptPush(init.body)); return reply('', 201); }]];
  const bad = await req('/api/mail/test', { method: 'POST', env: e2 });
  assert.equal(bad.status, 500);
  assert.equal(pushes.length, 1, 'reserve: als melding');
  assert.match(pushes[0].title, /Weekoverzicht/);
});

await test('dagelijkse opruiming: uurregels ouder dan 60 dagen weg, recente blijven', async () => {
  const old = Date.now() - 61 * 864e5, recent = Date.now() - 40 * 864e5;
  const ins = DB.db.prepare('INSERT OR REPLACE INTO hours (hour, ticker, name, open, close, low, high, avg, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?)');
  ins.run(old, 'AAPL', 'Apple', 1, 1, 1, 1, 1, 6, 1);
  ins.run(recent, 'AAPL', 'Apple', 1, 1, 1, 1, 1, 6, 1);
  setKv('cleanup_day', '');
  routes = t212Routes();
  await W.scheduled({ cron: '17 5 * * *', scheduledTime: Date.now() }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM hours WHERE hour = ?').get(old).n, 0);
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM hours WHERE hour = ?').get(recent).n, 1, '40 dagen oud blijft staan');
  DB.db.prepare('DELETE FROM hours WHERE hour = ?').run(recent);
});

await test('reeksen los: core zonder reeksen, oude core met reeksen, alleen nieuwe regels', async () => {
  routes = t212Routes();
  await req('/api/run', { method: 'POST' });
  const split = await jsonOf(await req('/api/data?part=core&split=1'));
  assert.ok(!('intraday' in split) && split.positions, 'core zonder reeksen');
  const legacy = await jsonOf(await req('/api/data?part=core'));
  assert.equal(legacy.part, 'core');
  assert.ok(legacy.intraday && legacy.intraday.rows.length, 'oude site krijgt reeksen mee');
  const ser = await req('/api/data?part=series');
  const s = await jsonOf(ser.clone());
  assert.ok(s.seriesTs > 0 && s.intraday.rows.length);
  assert.equal((await req('/api/data?part=series', { headers: { 'If-None-Match': ser.headers.get('ETag') } })).status, 304);
  const d0 = await jsonOf(await req('/api/data?part=series&since=' + s.seriesTs));
  assert.ok(d0.delta && d0.intraday.rows.length === 0, 'niets nieuws');
  const d1 = await jsonOf(await req('/api/data?part=series&since=' + (s.seriesTs - 1)));
  assert.ok(d1.intraday.rows.length >= 3, 'de laatste meting (3 regels)');
});

await test('status', async () => {
  const st = (await jsonOf(await req('/api/status'))).status;
  assert.ok(st.lastMeasurement && st.rows.intraday > 0 && 'tickFails' in st && st.keys.T212_KEY === true);
  assert.ok(!JSON.stringify(st).includes(env.T212_KEY), 'geen sleutels in de status');
});

await test('reservekopie en terugzetten, zonder sleutels', async () => {
  await req('/api/keys', { method: 'POST', body: { name: 'FINNHUB_KEY', value: 'geheim-finnhub-123' } });
  const man = await jsonOf(await req('/api/backup'));
  assert.equal(man.format, 'investeringstracker-backup');
  assert.ok(man.tables.weeks >= 2);
  const parts = {};
  for (const t of Object.keys(man.tables)) parts[t] = (await jsonOf(await req('/api/backup?table=' + t))).rows;
  const all = JSON.stringify(parts);
  assert.ok(!all.includes('geheim-finnhub-123') && !all.includes('vapid') && !all.includes(TOKEN), 'geen sleutels of codes in de kopie');
  assert.ok(parts.kv.some((r) => r[0] === 'settings'));
  DB.db.prepare('DELETE FROM weeks').run();
  const r = await jsonOf(await req('/api/restore', { method: 'POST', body: { table: 'weeks', rows: parts.weeks, done: true } }));
  assert.equal(r.restored, parts.weeks.length);
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM weeks').get().n, parts.weeks.length);
  const bad = await jsonOf(await req('/api/restore', { method: 'POST', body: { table: 'kv', rows: [['keys', '{"T212_KEY":"x"}'], ['settings', '{}']] } }));
  assert.equal(bad.skipped, 1, 'sleutels terugzetten mag niet');
});

await test('waakhond: melding na drie mislukte metingen tijdens de meettijden', async () => {
  const pushes = [];
  routes = [[/t212\.test/, reply({ code: 'x' }, 401)], [/push\.test/, async (u, init) => { pushes.push(await decryptPush(init.body)); return reply('', 201); }]];
  const at = new Date('2026-11-18T10:00:00Z').getTime();
  for (let i = 0; i < 3; i++) { await W.scheduled({ cron: '*/10 * * * *', scheduledTime: at + i * 600000 }, env, { waitUntil: async (p) => p }); await new Promise((r) => setTimeout(r, 30)); }
  assert.equal(pushes.length, 1, JSON.stringify(pushes));
  assert.match(pushes[0].body, /Trading 212-sleutel/);
  routes = t212Routes();
  await W.scheduled({ cron: '*/10 * * * *', scheduledTime: at + 4 * 600000 }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(kv('tick_fail'), '0', 'weer goed');
});

await test('koersalarm gaat af en zet zichzelf uit', async () => {
  await req('/api/settings', { method: 'POST', body: { priceAlerts: [{ sym: 'AAPL', op: 'above', price: 220, on: true }, { sym: 'AAPL', op: 'below', price: 100, on: true }] } });
  const pushes = [];
  routes = t212Routes().concat([[/push\.test/, async (u, init) => { pushes.push(await decryptPush(init.body)); return reply('', 201); }]]);
  await W.scheduled({ cron: '*/10 * * * *', scheduledTime: new Date('2026-11-19T10:00:00Z').getTime() }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 30));
  const pa = pushes.filter((p) => /boven 220/.test(p.title));
  assert.equal(pa.length, 1, JSON.stringify(pushes));
  const s = JSON.parse(kv('settings'));
  assert.equal(s.priceAlerts.find((a) => a.op === 'above').on, false);
  assert.equal(s.priceAlerts.find((a) => a.op === 'below').on, true);
});

await test('zoeken: bedrijvenlijst van de SEC en Finnhub', async () => {
  const e2 = Object.assign({}, env, { SEC_CONTACT: 'iemand@example.com', FINNHUB_KEY: 'fh' });
  setKv('src_health', {});
  setKv('companies_meta', '');
  setKv('mkt_queue', ['companies']);
  routes = [[/sec\.gov\/files\/company_tickers/, (u, init) => { assert.match(init.headers['User-Agent'], /iemand@example\.com/); return reply({ 0: { cik_str: 1, ticker: 'NOC', title: 'NORTHROP GRUMMAN CORP' }, 1: { cik_str: 2, ticker: 'NVDA', title: 'NVIDIA CORP' }, 2: { cik_str: 3, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' } }); }],
    [/finnhub\.io\/api\/v1\/search/, reply({ result: [{ symbol: 'ASML.AS', displaySymbol: 'ASML.AS', description: 'ASML HOLDING NV', type: 'Common Stock' }, { symbol: 'XYZ', description: 'warrant', type: 'Warrant' }] })]];
  await req('/api/market', { method: 'POST', env: e2 });
  assert.equal(JSON.parse(kv('companies_meta')).n, 3);
  const r1 = (await jsonOf(await req('/api/search?q=northrop', { env: e2 }))).results;
  assert.equal(r1[0].sym, 'NOC');
  const r2 = (await jsonOf(await req('/api/search?q=BRK', { env: e2 }))).results;
  assert.ok(r2.some((x) => x.sym === 'BRK.B'));
  const r3 = (await jsonOf(await req('/api/search?q=asml', { env: e2 }))).results;
  assert.ok(r3.some((x) => x.sym === 'ASML.AS') && !r3.some((x) => x.sym === 'XYZ'), JSON.stringify(r3));
});

await test('koershistorie: FMP geeft 402, dan Twelve Data', async () => {
  const e2 = Object.assign({}, env, { FMP_KEY: 'fmp', TWELVEDATA_KEY: 'td' });
  setKv('src_health', {});
  setKv('eod_unavailable', []);
  setKv('mkt_queue', ['eod:NOC']);
  routes = [[/financialmodelingprep/, reply({ 'Error Message': 'Premium' }, 402)],
    [/api\.twelvedata\.com\/time_series/, reply({ status: 'ok', values: [{ datetime: '2026-11-14', close: '545.65' }, { datetime: '2026-11-13', close: '550.10' }] })]];
  await req('/api/market', { method: 'POST', env: e2 });
  const rows = DB.db.prepare('SELECT day, price FROM ext_prices WHERE symbol = ? ORDER BY day').all('NOC');
  assert.equal(rows.length, 2, JSON.stringify(rows));
  assert.equal(rows[1].price, 545.65);
  assert.match(JSON.parse(kv('src_health')).fmp.backup, /Twelve Data/);
});

await test('doelen en herinnering inleg in de instellingen', async () => {
  const r = await jsonOf(await req('/api/settings', { method: 'POST', body: { goals: [{ name: 'Huis', target: 30000, share: 60, date: '2030-06' }, { name: 'x', target: -1 }], depositReminder: false } }));
  assert.equal(r.settings.goals.length, 1);
  assert.equal(r.settings.goals[0].share, 60);
  assert.equal(r.settings.depositReminder, false);
});

await test('voorkeuren en maatstaf in de instellingen', async () => {
  const r = await jsonOf(await req('/api/settings', { method: 'POST', body: { benchmark: ' urth ', prefs: { watchMeta: { NVDA: { tags: ['chips'], note: 'kopen onder 100' } }, morningPush: true } } }));
  assert.equal(r.settings.benchmark, 'URTH');
  assert.deepEqual(r.settings.prefs.watchMeta.NVDA.tags, ['chips']);
  const big = await jsonOf(await req('/api/settings', { method: 'POST', body: { benchmark: 'x y', prefs: { blob: 'a'.repeat(50000) } } }));
  assert.equal(big.settings.benchmark, '');
  assert.equal(big.settings.prefs.morningPush, true, 'te groot: vorige voorkeuren blijven');
});

await test('deponeringen bij de SEC en 13F van grote beleggers', async () => {
  const e2 = Object.assign({}, env, { SEC_CONTACT: 'iemand@example.com' });
  setKv('companies', [['AAPL', 'APPLE INC', 320193], ['VUAG', 'x', 0]]);
  setKv('filings', {}); setKv('f13', {});
  setKv('mkt_queue', ['filings', 'f13']);
  const recent = { form: ['4', '10-Q', '8-K'], accessionNumber: ['0001-26-000001', '0000320193-26-000010', '0000320193-26-000011'], filingDate: ['2026-11-01', '2026-10-31', '2026-10-30'],
    primaryDocument: ['x.xml', 'aapl-10q.htm', 'aapl-8k.htm'], primaryDocDescription: ['', '10-Q', '8-K'], items: ['', '', '2.02'] };
  const fund = { form: ['13F-HR'], accessionNumber: ['0000950123-26-000999'], filingDate: ['2026-11-14'], reportDate: ['2026-09-30'] };
  routes = [[/submissions\/CIK0000320193/, reply({ filings: { recent } })],
    [/submissions\/CIK/, reply({ filings: { recent: fund } })],
    [/index\.json$/, reply({ directory: { item: [{ name: 'primary_doc.xml' }, { name: 'infotable.xml' }] } })],
    [/infotable\.xml$/, reply('<informationTable><infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><value>600</value><shrsOrPrnAmt><sshPrnamt>10</sshPrnamt></shrsOrPrnAmt></infoTable>' +
      '<infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><value>400</value><shrsOrPrnAmt><sshPrnamt>5</sshPrnamt></shrsOrPrnAmt></infoTable>' +
      '<infoTable><nameOfIssuer>COCA COLA CO</nameOfIssuer><value>500</value><shrsOrPrnAmt><sshPrnamt>50</sshPrnamt></shrsOrPrnAmt><putCall>Put</putCall></infoTable></informationTable>')]];
  await req('/api/market', { method: 'POST', env: e2 });
  const f = JSON.parse(kv('filings'));
  assert.equal(f.per.AAPL.list.length, 2, JSON.stringify(f));
  assert.match(f.per.AAPL.list[0].url, /edgar\/data\/320193\/000032019326000010\/aapl-10q\.htm$/);
  const g = JSON.parse(kv('f13'));
  assert.equal(g.funds.length, 4);
  assert.equal(g.funds[0].top[0].name, 'APPLE INC');
  assert.equal(g.funds[0].top[0].value, 1000);
  assert.equal(g.funds[0].n, 1, 'opties tellen niet mee');
  const d = await jsonOf(await req('/api/data?part=extra', { env: e2 }));
  assert.ok(d.ext2 && d.ext2.filings && d.ext2.f13, 'in de gegevens voor de site');
  const st = (await jsonOf(await req('/api/status', { env: e2 }))).status;
  assert.ok(Object.values(st.usage).some((u) => u.sec >= 6), JSON.stringify(st.usage));
});

await test('economische agenda via FRED', async () => {
  const e2 = Object.assign({}, env, { FRED_KEY: 'fred' });
  setKv('mkt_queue', ['econ']);
  routes = [[/fred\/releases\/dates/, reply({ release_dates: [{ release_id: 10, release_name: 'Consumer Price Index', date: '2099-12-10' }, { release_id: 9, release_name: 'Advance Monthly Sales', date: '2099-12-11' }] })]];
  await req('/api/market', { method: 'POST', env: e2 });
  const e = JSON.parse(kv('econ'));
  assert.equal(e.items.length, 1);
  assert.equal(e.items[0].name, 'Consumer Price Index');
});

await test('Trading 212-pies met namen', async () => {
  WM._setPieWait(0);
  setKv('mkt_queue', ['pies']); setKv('pies', {});
  routes = [[/equity\/pies\/77$/, reply({ settings: { name: 'Dividend', goal: 5000 }, instruments: [{ ticker: 'KO_US_EQ', expectedShare: 0.5, currentShare: 0.55, result: { priceAvgValue: 110, priceAvgResult: 10 } }] })],
    [/equity\/pies$/, reply([{ id: 77, cash: 1.5, progress: 0.2, status: 'AHEAD', result: { priceAvgInvestedValue: 200, priceAvgValue: 220, priceAvgResult: 20, priceAvgResultCoef: 0.1 }, dividendDetails: { gained: 3 } }])]];
  await req('/api/market', { method: 'POST' });
  const p = JSON.parse(kv('pies'));
  assert.equal(p.list[0].name, 'Dividend');
  assert.equal(p.list[0].resultPct, 0.1);
  assert.equal(p.list[0].instruments[0].tk, 'KO');
});

await test('foutmeldingen van de site op de statuspagina', async () => {
  for (let i = 0; i < 2; i++) await req('/api/log', { method: 'POST', body: { msg: 'TypeError: x is undefined', src: 'js/16-analyse.js', line: 12, ver: 'v41' } });
  const st = (await jsonOf(await req('/api/status'))).status;
  assert.equal(st.siteErrors.length, 1);
  assert.equal(st.siteErrors[0].n, 2);
  const noTok = await W.fetch(new Request('https://worker.test/api/log', { method: 'POST', body: '{}' }), env);
  assert.equal(noTok.status, 401);
});

await test('kopen en verkopen: uit, grenzen, dubbel, verkopen, sleutelrecht, annuleren', async () => {
  // Uit: niets naar Trading 212
  setKv('settings', {});
  routes = [];
  let r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'BUY', type: 'market', ticker: 'AAPL_US_EQ', quantity: 1, estEur: 200, clientId: 'abcdefgh-1' } }));
  assert.equal(r.ok, false); assert.match(r.error, /staat uit/);
  assert.equal(calls.length, 0);
  await req('/api/features', { method: 'POST', body: { features: { trading: true } } });
  await req('/api/settings', { method: 'POST', body: { tradeLimits: { perOrder: 300, perDay: 400 } } });
  setKv('pos_extra', { AAPL: { t212: 'AAPL_US_EQ', cur: 'USD', price: 230 } });
  setKv('trade_day', {}); setKv('trade_ids', {}); setKv('trade_log', []);
  const sent = [];
  routes = [[/t212\.test\/api\/v0\/equity\/orders\/market/, async (u, init) => { sent.push(JSON.parse(init.body)); return reply({ id: 9001, status: 'NEW', ticker: 'AAPL_US_EQ' }); }],
    [/t212\.test\/api\/v0\/equity\/orders\/limit/, async (u, init) => { sent.push(JSON.parse(init.body)); return reply({ id: 9002, status: 'NEW' }); }],
    [/t212\.test\/api\/v0\/equity\/orders\/9002$/, (u, init) => { assert.equal(init.method, 'DELETE'); return reply('', 200); }],
    [/t212\.test\/api\/v0\/equity\/orders$/, reply([{ id: 9002, ticker: 'AAPL_US_EQ', type: 'LIMIT', status: 'NEW', quantity: 1, filledQuantity: 0.25, limitPrice: 200, creationTime: '2026-11-18T10:00:00Z' }])]];
  // Boven de grens per order
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'BUY', type: 'market', ticker: 'AAPL_US_EQ', quantity: 2, estEur: 350, clientId: 'abcdefgh-2' } }));
  assert.equal(r.ok, false); assert.match(r.error, /grens per order/);
  // Goed: koop
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'BUY', type: 'market', ticker: 'AAPL_US_EQ', quantity: 1, estEur: 200, clientId: 'abcdefgh-3' } }));
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.order.id, 9001);
  assert.deepEqual(sent[0], { ticker: 'AAPL_US_EQ', quantity: 1 });
  // Hetzelfde id nog eens: geweigerd zonder te versturen
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'BUY', type: 'market', ticker: 'AAPL_US_EQ', quantity: 1, estEur: 200, clientId: 'abcdefgh-3' } }));
  assert.equal(r.ok, false); assert.match(r.error, /al verstuurd/); assert.equal(sent.length, 1);
  // Boven de grens per dag (200 al gebruikt, grens 400)
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'BUY', type: 'market', ticker: 'AAPL_US_EQ', quantity: 1, estEur: 250, clientId: 'abcdefgh-4' } }));
  assert.equal(r.ok, false); assert.match(r.error, /per dag/);
  // Verkopen: meer dan je hebt, en een limietorder (negatief aantal)
  const held = DB.db.prepare("SELECT qty FROM intraday WHERE ticker = 'AAPL' ORDER BY ts DESC LIMIT 1").get();
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'SELL', type: 'market', ticker: 'AAPL_US_EQ', quantity: (held ? held.qty : 0) + 5, estEur: 50, clientId: 'abcdefgh-5' } }));
  assert.equal(r.ok, false); assert.match(r.error, /maar|niet/);
  setKv('trade_day', {});
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'SELL', type: 'limit', ticker: 'AAPL_US_EQ', quantity: 0.5, limitPrice: 250, validity: 'GTC', estEur: 100, clientId: 'abcdefgh-6' } }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(sent[1], { ticker: 'AAPL_US_EQ', quantity: -0.5, limitPrice: 250, timeValidity: 'GOOD_TILL_CANCEL' });
  // Openstaande orders en annuleren
  const o = await jsonOf(await req('/api/trade/orders'));
  assert.equal(o.open[0].id, 9002); assert.ok(o.log.length >= 2);
  // De lijst met openstaande orders geeft ook door wat er al uitgevoerd is en wanneer de order is ingelegd
  assert.equal(o.open[0].filled, 0.25);
  assert.equal(o.open[0].created, '2026-11-18T10:00:00Z');
  assert.equal(o.open[0].limitPrice, 200);
  r = await jsonOf(await req('/api/trade/cancel', { method: 'POST', body: { id: 9002 } }));
  assert.equal(r.ok, true, JSON.stringify(r));
  // Sleutel zonder orderrecht: duidelijke uitleg
  routes = [[/t212\.test\/api\/v0\/equity\/orders\/market/, reply({ code: 'Forbidden' }, 403)]];
  setKv('trade_day', {});
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'BUY', type: 'market', ticker: 'AAPL_US_EQ', quantity: 0.1, estEur: 20, clientId: 'abcdefgh-7' } }));
  assert.equal(r.ok, false); assert.match(r.error, /recht om orders/);
  // Instrumenten zoeken
  routes = [[/t212\.test\/api\/v0\/equity\/metadata\/instruments/, reply([{ ticker: 'NVDA_US_EQ', shortName: 'NVDA', name: 'Nvidia', currencyCode: 'USD', type: 'STOCK' }, { ticker: 'VUAGl_EQ', shortName: 'VUAG', name: 'Vanguard S&P 500 (Acc)', currencyCode: 'GBP', type: 'ETF' }])]];
  setKv('instruments', 'null');
  const f = await jsonOf(await req('/api/trade/instruments?q=nvda'));
  assert.equal(f.results[0].ticker, 'NVDA_US_EQ');
  await req('/api/features', { method: 'POST', body: { features: { trading: false } } });
});

await test('nu controleren en verkopen naar de stand van dit moment (deel of vast bedrag)', async () => {
  await req('/api/features', { method: 'POST', body: { features: { trading: true } } });
  await req('/api/settings', { method: 'POST', body: { tradeLimits: { perOrder: 5000, perDay: 10000 } } });
  setKv('pos_extra', { AAPL: { t212: 'AAPL_US_EQ', cur: 'USD', price: 230 } });
  setKv('trade_day', {}); setKv('trade_ids', {}); setKv('trade_log', []);
  // Trading 212 zegt nu: 3 stuks, € 660 (de meting kan iets anders zeggen)
  const LIVE = [{ instrument: { ticker: 'AAPL_US_EQ', name: 'Apple', currency: 'USD' }, quantity: 3, quantityAvailableForTrading: 3, currentPrice: 240, walletImpact: { currentValue: 660 } }];
  const sent = [];
  routes = [[/t212\.test\/api\/v0\/equity\/positions/, () => reply(LIVE)],
    [/t212\.test\/api\/v0\/equity\/account\/summary/, () => reply({ currency: 'EUR', cash: { availableToTrade: 125.44, inPies: 0, reservedForOrders: 0 } })],
    [/t212\.test\/api\/v0\/equity\/orders\/market/, async (u, init) => { sent.push(JSON.parse(init.body)); return reply({ id: 9100 + sent.length, status: 'NEW' }); }]];
  // Nu controleren: positie op korte of volledige ticker, en het vrije saldo
  let r = await jsonOf(await req('/api/live?tk=AAPL'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.position.qty, 3); assert.equal(r.position.value, 660); assert.equal(r.cash, 125.44);
  r = await jsonOf(await req('/api/live'));
  assert.equal(r.position, null); assert.equal(r.cash, 125.44);
  r = await jsonOf(await req('/api/live?tk=MSFT'));
  assert.equal(r.position, null); assert.equal(r.held, false);
  assert.equal((await req('/api/live?tk=%3Cx%3E')).status, 400);
  // Deel van je positie: 100% verkoopt alles wat je nu echt hebt, ook als de site minder dacht
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'SELL', type: 'market', ticker: 'AAPL_US_EQ', quantity: 2, fraction: 1, estEur: 400, clientId: 'live-sell-1' } }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(sent[0], { ticker: 'AAPL_US_EQ', quantity: -3 });
  assert.equal(r.basis, 'live');
  assert.equal(r.entry.estEur, 660, 'het bedrag komt uit de stand van dit moment');
  // Half: de helft van de echte positie
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'SELL', type: 'market', ticker: 'AAPL_US_EQ', quantity: 1, fraction: 0.5, estEur: 200, clientId: 'live-sell-2' } }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(sent[1].quantity, -1.5);
  // Vast bedrag: € 110 bij € 220 per stuk is 0,5 stuks, wat de site ook dacht
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'SELL', type: 'market', ticker: 'AAPL_US_EQ', quantity: 0.6, valueEur: 110, estEur: 110, clientId: 'live-sell-3' } }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(sent[2].quantity, -0.5);
  // Vast bedrag groter dan wat je hebt: nooit meer dan je hebt
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'SELL', type: 'market', ticker: 'AAPL_US_EQ', quantity: 3, valueEur: 2000, estEur: 2000, clientId: 'live-sell-4' } }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(sent[3].quantity, -3);
  // Ongeldig deel
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'SELL', type: 'market', ticker: 'AAPL_US_EQ', quantity: 1, fraction: 1.5, estEur: 200, clientId: 'live-sell-5' } }));
  assert.equal(r.ok, false); assert.match(r.error, /deel/);
  // Trading 212 meldt de positie niet meer: verkopen kan niet
  LIVE.length = 0;
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'SELL', type: 'market', ticker: 'AAPL_US_EQ', quantity: 1, fraction: 1, estEur: 200, clientId: 'live-sell-6' } }));
  assert.equal(r.ok, false); assert.match(r.error, /niet/);
  assert.equal(sent.length, 4);
  await req('/api/features', { method: 'POST', body: { features: { trading: false } } });
});

await test('live koersen: alle posities nu, kort in het geheugen, Finnhub alleen voor Amerikaanse aandelen', async () => {
  WM._test.QUOTES.t = 0; WM._test.QUOTES.out = null;
  const savedKeys = kv('keys');   // een eerdere test bewaarde een Finnhub-sleutel via de site
  DB.db.prepare("DELETE FROM kv WHERE key = 'keys'").run();
  let n = 0;
  routes = [[/t212\.test\/api\/v0\/equity\/positions/, () => { n++; return reply(T212_POS); }]];
  let r = await jsonOf(await req('/api/quotes'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.total, 920); assert.equal(r.positions.length, 2);
  assert.deepEqual(r.positions[0], { tk: 'AAPL', t212: 'AAPL_US_EQ', cur: 'USD', price: 230, qty: 2, value: 400 }, JSON.stringify(r.positions[0]));
  assert.equal(r.fast, undefined, 'zonder fast geen sleutel');
  // Binnen twee seconden: uit het geheugen, geen tweede verzoek bij Trading 212
  await req('/api/quotes'); assert.equal(n, 1);
  // Snelle modus: sleutel en symbool alleen voor een dollaraandeel op een Amerikaanse beurs
  const fenv = Object.assign({}, env, { FINNHUB_KEY: 'fh-test-key' });
  r = await jsonOf(await req('/api/quotes?fast=AAPL', { env: fenv }));
  assert.deepEqual(r.fast, { sym: 'AAPL', key: 'fh-test-key', held: true }, JSON.stringify(r.fast));
  r = await jsonOf(await req('/api/quotes?fast=VUAG', { env: fenv }));
  assert.deepEqual(r.fast, { sym: null, key: null, held: true }, JSON.stringify(r.fast));
  r = await jsonOf(await req('/api/quotes?fast=AAPL'));
  assert.deepEqual(r.fast, { sym: 'AAPL', key: null, held: true }, 'zonder Finnhub-sleutel geen sleutel: ' + JSON.stringify(r.fast));
  assert.equal((await req('/api/quotes?fast=%3Cx%3E')).status, 400);
  // Limiet bij Trading 212: de vorige stand, gemarkeerd als oud
  WM._test.QUOTES.t = 0;
  routes = [[/t212\.test\/api\/v0\/equity\/positions/, () => reply({ code: 'TooManyRequests' }, 429)]];
  r = await jsonOf(await req('/api/quotes'));
  assert.equal(r.ok, true); assert.equal(r.stale, true); assert.equal(r.total, 920);
  // Zonder eerdere stand: een duidelijke fout, geen herhaalpogingen
  WM._test.QUOTES.out = null; calls = [];
  r = await jsonOf(await req('/api/quotes'));
  assert.equal(r.ok, false); assert.match(r.error, /wachten/); assert.equal(calls.length, 1);
  // Tellingen van live koersen hoogstens eens per minuut wegschrijven
  WM._test.QUOTES.out = { at: 1, positions: [], total: 0 }; WM._test.QUOTES.t = Date.now();
  let flushes = 0;
  const ctx = { waitUntil: () => { flushes++; } };
  const hdr = { headers: { Authorization: 'Bearer ' + TOKEN, Origin: 'https://site.test' } };
  await W.fetch(new Request('https://worker.test/api/quotes', hdr), env, ctx);
  await W.fetch(new Request('https://worker.test/api/quotes', hdr), env, ctx);
  assert.equal(flushes, 1);
  WM._test.QUOTES.t = 0; WM._test.QUOTES.out = null;
  if (savedKeys != null) setKv('keys', savedKeys);
});

await test('volglijst: tot 100 aandelen, dubbele en ongeldige symbolen eruit', async () => {
  const before = kv('settings');
  const list = Array.from({ length: 120 }, (_, i) => 'W' + i).concat(['W1', 'geen symbool!']);
  await req('/api/settings', { method: 'POST', body: { watchlist: list } });
  const saved = JSON.parse(kv('settings')).watchlist;
  assert.equal(saved.length, 100);
  assert.equal(saved[0], 'W0'); assert.equal(saved[99], 'W99');
  if (before != null) setKv('settings', before);
});

await test('order met te veel decimalen: met minder decimalen opnieuw, en de reden van Trading 212 in de melding', async () => {
  await req('/api/features', { method: 'POST', body: { features: { trading: true } } });
  await req('/api/settings', { method: 'POST', body: { tradeLimits: { perOrder: 5000, perDay: 10000 } } });
  setKv('trade_day', {}); setKv('trade_ids', {}); setKv('trade_log', []);
  // Trading 212 staat voor dit instrument hoogstens 2 decimalen toe
  const sent = [];
  const PREC = { type: '/api-errors/quantity-precision-mismatch', title: 'Quantity precision mismatch', detail: 'invalid quantity precision 4', status: 400 };
  routes = [[/t212\.test\/api\/v0\/equity\/orders\/market/, async (u, init) => {
    const q = JSON.parse(init.body).quantity; sent.push(q);
    return String(Math.abs(q)).split('.')[1] && String(Math.abs(q)).split('.')[1].length > 2 ? reply(PREC, 400) : reply({ id: 9300, status: 'NEW' });
  }]];
  let r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'BUY', type: 'market', ticker: 'VUAGl_EQ', quantity: 1.6168, estEur: 209.53, clientId: 'prec-buy-1' } }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(sent, [1.6168, 1.616, 1.61], 'telkens één decimaal minder, nooit naar boven');
  assert.equal(r.qty, 1.61); assert.equal(r.rounded, true);
  assert.ok(Math.abs(r.entry.estEur - 209.53 * 1.61 / 1.6168) < 0.02, 'bedrag naar het verstuurde aantal');
  // Een andere weigering: niet opnieuw proberen, wel de reden tonen
  sent.length = 0;
  routes = [[/t212\.test\/api\/v0\/equity\/orders\/market/, async (u, init) => { sent.push(JSON.parse(init.body).quantity); return reply({ type: '/api-errors/insufficient-funds', detail: 'Not enough free funds' }, 400); }]];
  r = await jsonOf(await req('/api/trade/order', { method: 'POST', body: { side: 'BUY', type: 'market', ticker: 'VUAGl_EQ', quantity: 1.5, estEur: 200, clientId: 'prec-buy-2' } }));
  assert.equal(r.ok, false);
  assert.equal(sent.length, 1, 'geen tweede poging bij een andere fout');
  assert.match(r.error, /Not enough free funds/); assert.match(r.error, /vrij saldo/);
  await req('/api/features', { method: 'POST', body: { features: { trading: false } } });
});

await test('Trading 212-sleutel vervangen terwijl hij als Cloudflare-geheim staat', async () => {
  setKv('keys', {}); setKv('login_fail', {});
  // env heeft T212_KEY en T212_SECRET als 'geheim'; via de site een nieuwe sleutel opslaan
  let r = await jsonOf(await req('/api/keys', { method: 'POST', body: { name: 'T212_KEY', value: 'nieuwe-sleutel-123456' } }));
  assert.equal(r.ok, true, JSON.stringify(r));
  r = await jsonOf(await req('/api/keys', { method: 'POST', body: { name: 'T212_SECRET', value: 'nieuw-secret-1234567' } }));
  assert.equal(r.features.keys.T212_KEY, 'override');
  // Inloggen werkt nu met de nieuwe sleutel, niet meer met de oude
  const login = (key, secret) => W.fetch(new Request('https://worker.test/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.9.9' }, body: JSON.stringify({ key, secret }) }), env);
  assert.equal((await jsonOf(await login('nieuwe-sleutel-123456', 'nieuw-secret-1234567'))).ok, true);
  assert.equal((await jsonOf(await login(env.T212_KEY, env.T212_SECRET))).ok, false);
  // De metingen gebruiken de nieuwe sleutel
  const seen = [];
  routes = t212Routes().map(([re, fn]) => [re, (u, init) => { seen.push(init && init.headers && init.headers.Authorization); return typeof fn === 'function' ? fn(u, init) : fn.clone(); }]);
  await req('/api/run', { method: 'POST' });
  assert.ok(seen.length && seen.every((a) => a === 'Basic ' + btoa('nieuwe-sleutel-123456:nieuw-secret-1234567')), JSON.stringify(seen.slice(0, 2)));
  // Wissen: terug naar het geheim
  await req('/api/keys', { method: 'POST', body: { name: 'T212_KEY', value: '' } });
  r = await jsonOf(await req('/api/keys', { method: 'POST', body: { name: 'T212_SECRET', value: '' } }));
  assert.equal(r.features.keys.T212_KEY, 'cloudflare');
  setKv('login_fail', {});
});

await test('nieuwsarchief: ouder nieuws aanvullen en per blok ophalen', async () => {
  const day = 864e5;
  const mk = (tk, n, from) => Array.from({ length: n }, (_, i) => ({ datetime: Math.floor((from - i * day / 3) / 1000), headline: tk + ' bericht ' + i, source: 'Test', url: 'https://nieuws.test/' + tk + '/' + from + '/' + i, summary: 'samenvatting' }));
  routes = [[/finnhub\.io\/api\/v1\/company-news/, (u) => reply(mk('AAPL', 40, Date.parse(new URL(u).searchParams.get('to') + 'T12:00:00Z')))]];
  const e = Object.assign(Object.create(env), { FINNHUB_KEY: 'fh-test' });
  for (let i = 0; i < 14; i++) await WM._test.newsHistTask(e, 'AAPL');
  const cur = JSON.parse(kv('news_hist_cur'));
  assert.equal(cur.AAPL, 'klaar', 'na een jaar klaar');
  const n = DB.db.prepare("SELECT COUNT(*) AS n FROM news_hist WHERE tk = 'AAPL'").get().n;
  assert.ok(n >= 12 * 40, 'berichten bewaard: ' + n);
  let r = await jsonOf(await req('/api/news?tk=AAPL&limit=30'));
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 30);
  assert.equal(r.more, true);
  assert.ok(r.items[0].t >= r.items[29].t, 'nieuwste eerst');
  const r2 = await jsonOf(await req('/api/news?tk=AAPL&limit=30&before=' + r.items[29].t));
  assert.ok(r2.items.every((x) => x.t < r.items[29].t), 'volgende blok is ouder');
  // Zonder sleutel: niets ophalen
  assert.equal(await WM._test.newsHistTask(Object.assign(Object.create(env), { FINNHUB_KEY: '' }), 'MSFT'), 0);
  routes = [];
});

await test('mening van analisten: alleen een regel bij een verandering', async () => {
  const f = WM._test.noteOpinionDay;
  const rec = (b) => [{ period: '2026-11-01', sb: 5, b, h: 4, s: 1, ss: 0 }];
  let prev = {}, out = { rec: rec(10), target: { mean: 200 } };
  f(prev, out, '2026-11-10');
  assert.deepEqual(out.recHist, [['2026-11-10', 5, 10, 4, 1, 0, 200]]);
  prev = out; out = { rec: rec(10), target: { mean: 200 } }; f(prev, out, '2026-11-11');
  assert.equal(out.recHist.length, 1, 'zelfde mening: geen nieuwe regel');
  prev = out; out = { rec: rec(11), target: { mean: 205 } }; f(prev, out, '2026-11-12');
  assert.equal(out.recHist.length, 2);
  assert.deepEqual(out.recHist[1], ['2026-11-12', 5, 11, 4, 1, 0, 205]);
  // Twee keer op dezelfde dag: de regel van vandaag wordt vervangen
  prev = out; out = { rec: rec(12), target: { mean: 205 } }; f(prev, out, '2026-11-12');
  assert.equal(out.recHist.length, 2);
  assert.equal(out.recHist[1][2], 12);
  // Geen gegevens meer: geschiedenis blijft staan
  prev = out; out = {}; f(prev, out, '2026-11-13');
  assert.equal(out.recHist.length, 2);
});

// ---------- Bronnen, controle en reservekopieën (ideeën 61, 62, 145–155) ----------

await test('handelsdag: zomer- en wintertijd, weekend en de Amerikaanse beurs (idee 154)', async () => {
  const T = WM._test;
  // Winter: 00:30 UTC is 01:30 in Amsterdam, dus dezelfde dag
  assert.equal(T.dayOf(Date.parse('2026-01-05T00:30:00Z')), '2026-01-05');
  // Winter: 23:30 UTC is 00:30 de volgende dag in Amsterdam
  assert.equal(T.dayOf(Date.parse('2026-01-05T23:30:00Z')), '2026-01-06');
  // Zomertijd begint zondag 29 maart 2026 om 01:00 UTC: 22:30 UTC op 28 maart is al 29 maart (23:30 CET)
  assert.equal(T.dayOf(Date.parse('2026-03-28T22:30:00Z')), '2026-03-28');
  assert.equal(T.dayOf(Date.parse('2026-03-28T23:30:00Z')), '2026-03-29');
  assert.equal(T.dayOf(Date.parse('2026-03-29T01:30:00Z')), '2026-03-29'); // 03:30 CEST
  // Zomertijd eindigt zondag 25 oktober 2026 om 01:00 UTC
  assert.equal(T.dayOf(Date.parse('2026-10-24T22:30:00Z')), '2026-10-25'); // 00:30 CEST
  assert.equal(T.dayOf(Date.parse('2026-10-25T22:30:00Z')), '2026-10-25'); // 23:30 CET
  assert.equal(T.isDst('2026-03-29T03:30:00'), true);
  assert.equal(T.isDst('2026-10-25T04:30:00'), false, '04:30 na de overgang is wintertijd');
  // Meten: werkdagen de hele dag; orders en marktgegevens alleen buiten de handelsuren (08:00–22:30)
  assert.equal(T.isLive(new Date('2026-11-24T05:00:00Z')), true, 'dinsdag 06:00 wordt gemeten');
  assert.equal(T.marketHours(new Date('2026-11-24T05:00:00Z')), false);
  assert.equal(T.marketHours(new Date('2026-11-24T12:00:00Z')), true);
  assert.equal(T.isLive(new Date('2026-11-22T12:00:00Z')), false, 'zondag niet');
  // Handelsdag: in het weekend de vrijdag ervoor
  assert.equal(T.tradingDay(Date.parse('2026-11-18T12:00:00Z')), '2026-11-18'); // woensdag
  assert.equal(T.tradingDay(Date.parse('2026-11-21T12:00:00Z')), '2026-11-20'); // zaterdag -> vrijdag
  assert.equal(T.tradingDay(Date.parse('2026-11-22T12:00:00Z')), '2026-11-20'); // zondag -> vrijdag
  // Amerikaanse beurs: voor 22:30 Amsterdamse tijd is vandaag nog niet afgesloten
  assert.equal(T.usTradingDay(Date.parse('2026-11-18T20:00:00Z')), '2026-11-17'); // 21:00 in Amsterdam
  assert.equal(T.usTradingDay(Date.parse('2026-11-18T22:00:00Z')), '2026-11-18'); // 23:00 in Amsterdam
  assert.equal(T.usTradingDay(Date.parse('2026-11-23T08:00:00Z')), '2026-11-20'); // maandagochtend -> vrijdag
  assert.equal(T.shiftDay('2026-03-29', -1), '2026-03-28');
  assert.equal(T.weekdayOf('2026-11-22'), 7);
});

await test('bronstatus: oplopende pauze, geschiedenis van 30 dagen en /api/health (ideeën 61, 145, 147)', async () => {
  const T = WM._test;
  assert.equal(T.srcPause(1), 0, 'eerste fout geeft nog geen pauze');
  assert.equal(T.srcPause(2), 15 * 60e3);
  assert.equal(T.srcPause(3), 60 * 60e3);
  assert.equal(T.srcPause(9), 24 * 3600e3, 'ten hoogste 24 uur');
  setKv('src_health', '{}');
  setKv('src_hist', '{}');
  await T.srcFail(env, 'finnhub', 'Finnhub gaf 500');
  let st = await T.srcState(env);
  assert.equal(st.finnhub.fails, 1);
  assert.ok(!st.finnhub.until, 'na één fout nog geen pauze');
  await T.srcFail(env, 'finnhub', 'Finnhub gaf 500');
  st = await T.srcState(env);
  assert.ok(st.finnhub.until > Date.now() && st.finnhub.until <= Date.now() + 16 * 60e3, 'nu 15 minuten uit');
  assert.ok(st.finnhub.next, 'volgende poging staat erbij');
  await T.srcFail(env, 'fmp', 'FMP-limiet bereikt', true);
  const h = (await jsonOf(await req('/api/health'))).health;
  assert.equal(h.hist.finnhub.days[h.day][2], 2, 'twee fouten vandaag');
  assert.equal(h.hist.fmp.days[h.day][1], 1, 'één limiet vandaag');
  assert.match(h.hist.finnhub.lastErr.msg, /500/);
  assert.ok(h.sources.fmp.until > Date.now(), 'limiet: tot na middernacht uit');
  assert.deepEqual(h.backoff, [15, 60, 240, 720, 1440]);
  // Weer in orde: de bron valt uit de lijst, de goede dag staat in de geschiedenis
  await T.srcOk(env, 'finnhub');
  const h2 = (await jsonOf(await req('/api/health'))).health;
  assert.ok(!h2.sources.finnhub, 'bron weer in orde');
  assert.ok(h2.hist.finnhub.days[h2.day][0] >= 1, 'dag in orde geteld');
  // Oude dagen vallen weg (hoogstens 30)
  const hist = await T.srcHistState(env);
  hist.finnhub.days = {};
  for (let i = 0; i < 40; i++) hist.finnhub.days['2026-0' + (1 + Math.floor(i / 28)) + '-' + String((i % 28) + 1).padStart(2, '0')] = [1, 0, 0];
  setKv('src_hist', JSON.stringify(hist));
  await T.srcFail(env, 'finnhub', 'nog een fout');
  const days = Object.keys((await T.srcHistState(env)).finnhub.days);
  assert.ok(days.length <= 30, '30 dagen bewaard, nu ' + days.length);
  setKv('src_health', '{}');
});

await test('sleutel testen zonder opslaan en zonder hem te laten zien (idee 62)', async () => {
  routes = [[/finnhub\.io\/api\/v1\/quote/, (u) => (/goed-geheim/.test(u) ? reply({ c: 190 }) : reply({ error: 'bad' }, 401))]];
  const keysBefore = kv('keys');
  let r = await jsonOf(await req('/api/keytest', { method: 'POST', body: { name: 'FINNHUB_KEY', value: 'goed-geheim' } }));
  assert.equal(r.ok, true);
  assert.equal(r.result.state, 'ok', JSON.stringify(r.result));
  assert.ok(!JSON.stringify(r).includes('goed-geheim'), 'de sleutel staat niet in het antwoord');
  assert.equal(kv('keys'), keysBefore, 'testen slaat niets op');
  r = await jsonOf(await req('/api/keytest', { method: 'POST', body: { name: 'FINNHUB_KEY', value: 'fout-geheim' } }));
  assert.equal(r.result.state, 'fout');
  assert.ok(!JSON.stringify(r).includes('fout-geheim'));
  // Zonder waarde en zonder opgeslagen sleutel: leeg
  r = await jsonOf(await req('/api/keytest', { method: 'POST', body: { name: 'ALPHAVANTAGE_KEY' } }));
  assert.equal(r.result.state, 'leeg');
  // Trading 212: de sleutel in de Worker werkt
  routes = [[/t212\.test\/api\/v0\/equity\/account\/summary/, reply({ currency: 'EUR', cash: { availableToTrade: 1 } })]];
  r = await jsonOf(await req('/api/keytest', { method: 'POST', body: { name: 'T212_KEY' } }));
  assert.equal(r.result.state, 'ok');
  assert.match(r.result.message, /EUR/);
  // Een onbekende naam wordt geweigerd
  const bad = await req('/api/keytest', { method: 'POST', body: { name: 'WEB_TOKEN', value: 'x' } });
  assert.equal(bad.status, 400);
  routes = [];
});

await test('onmogelijke waarden worden geweigerd en vastgelegd (idee 148)', async () => {
  const T = WM._test;
  const prev = { AAA: { price: 100, qty: 1 }, BBB: { price: 10, qty: 2 } };
  const chk = T.checkPositions([
    { ticker: 'AAA', price: 101, qty: 1, value: 101 },
    { ticker: 'CCC', price: 5, qty: -3, value: 15 },
    { ticker: 'DDD', price: 1000, qty: 1, value: 1000 },
    { ticker: 'BBB', price: 0, qty: 2, value: 20 },
  ], Object.assign({}, prev, { DDD: { price: 100, qty: 1 } }));
  assert.deepEqual(chk.rows.map((r) => r.ticker), ['AAA', 'BBB'], 'zonder koers blijft de waarde bewaard');
  assert.equal(chk.rows[1].price, null, 'de onbruikbare koers wordt niet bewaard');
  assert.equal(chk.bad.length, 3);
  assert.match(chk.bad[0].why, /aantal -3/);
  assert.equal(chk.bad[0].kept, false);
  assert.match(chk.bad[1].why, /koerssprong/);
  assert.match(chk.bad[2].why, /koers 0/);
  assert.equal(chk.bad[2].kept, true);
  // Via een meting: de goede positie wordt bewaard, de rare niet, en de vorige gegevens blijven staan
  setKv('pos_extra', JSON.stringify({ GOED: { price: 50, qty: 2, isin: 'NL0000GOED1' }, RAAR: { price: 10, qty: 5, isin: 'NL0000RAAR1' } }));
  setKv('data_rejects', '[]');
  const rt = t212Routes();
  rt[0] = [/t212\.test\/api\/v0\/equity\/positions/, reply([
    { instrument: { ticker: 'GOED_EQ', name: 'Goede nv', currency: 'EUR', isin: 'NL0000GOED1' }, quantity: 2, currentPrice: 51, averagePricePaid: 40, walletImpact: { currentValue: 102, unrealizedProfitLoss: 22, totalCost: 80, fxImpact: 0 } },
    { instrument: { ticker: 'RAAR_EQ', name: 'Rare nv', currency: 'EUR', isin: 'NL0000RAAR1' }, quantity: 5, currentPrice: 90, averagePricePaid: 10, walletImpact: { currentValue: 450, unrealizedProfitLoss: 400, totalCost: 50, fxImpact: 0 } },
  ])];
  routes = rt;
  const r = await jsonOf(await req('/api/run', { method: 'POST' }));
  assert.match(r.message, /1 afwijkende waarde\(n\) tegengehouden/);
  assert.equal(DB.db.prepare("SELECT COUNT(*) AS n FROM intraday WHERE ticker = 'GOED'").get().n, 1, 'de goede positie is bewaard');
  assert.equal(DB.db.prepare("SELECT COUNT(*) AS n FROM intraday WHERE ticker = 'RAAR'").get().n, 0, 'de rare koers is niet bewaard');
  const extra = JSON.parse(kv('pos_extra'));
  assert.equal(extra.RAAR.price, 10, 'de vorige koers blijft de maatstaf');
  const rejects = JSON.parse(kv('data_rejects'));
  assert.equal(rejects[rejects.length - 1].ticker, 'RAAR');
  const health = (await jsonOf(await req('/api/health'))).health;
  assert.equal(health.rejects[0].ticker, 'RAAR');
  routes = [];
});

await test('splitsing en nieuwe ticker: geschiedenis mee aangepast, en niet twee keer (ideeën 149, 155)', async () => {
  const T = WM._test;
  assert.equal(T.splitRatio(10, 100, 20, 50), 2, '2:1');
  assert.equal(T.splitRatio(10, 10, 1, 100), 0.1, '1:10');
  assert.equal(T.splitRatio(10, 100, 20, 100), null, 'bijkoop is geen splitsing');
  assert.equal(T.splitRatio(10, 100, 10, 50), null, 'alleen koers gehalveerd is geen splitsing');
  const ts0 = Math.floor((Date.now() - 2 * 3600e3) / 60000) * 60000;
  DB.db.prepare('INSERT OR REPLACE INTO intraday (ts, ticker, name, value, unrealized, price, qty) VALUES (?,?,?,?,?,?,?)').run(ts0, 'SPLT', 'Splitser', 1000, 0, 100, 10);
  DB.db.prepare('INSERT OR REPLACE INTO days (day, ticker, name, open, close, low, high, avg, range, range_pct, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('2026-11-02', 'SPLT', 'Splitser', 1000, 1000, 1000, 1000, 1000, 0, 0, 1, 100);
  DB.db.prepare('INSERT OR REPLACE INTO positions (date, ticker, name, value, unrealized, qty) VALUES (?,?,?,?,?,?)').run('2026-11-02', 'SPLT', 'Splitser', 1000, 0, 10);
  const before = JSON.stringify({ SPLT: { price: 100, qty: 10, avg: 90, isin: 'NL0000SPLT1' }, OLDT: { price: 20, qty: 5, avg: 18, isin: 'NL0000NAAM1' } });
  setKv('pos_extra', before);
  setKv('corp_actions', '[]');
  const payload = [
    { instrument: { ticker: 'SPLT_EQ', name: 'Splitser', currency: 'EUR', isin: 'NL0000SPLT1' }, quantity: 20, currentPrice: 50, averagePricePaid: 45, walletImpact: { currentValue: 1000, unrealizedProfitLoss: 100, totalCost: 900, fxImpact: 0 } },
    { instrument: { ticker: 'NEWT_EQ', name: 'Nieuwe naam nv', currency: 'EUR', isin: 'NL0000NAAM1' }, quantity: 5, currentPrice: 21, averagePricePaid: 18, walletImpact: { currentValue: 105, unrealizedProfitLoss: 15, totalCost: 90, fxImpact: 0 } },
  ];
  const rt = t212Routes();
  rt[0] = [/t212\.test\/api\/v0\/equity\/positions/, reply(payload)];
  routes = rt;
  // Geschiedenis van de oude ticker, om de verhuizing te kunnen zien
  DB.db.prepare('INSERT OR REPLACE INTO intraday (ts, ticker, name, value, unrealized, price, qty) VALUES (?,?,?,?,?,?,?)').run(ts0, 'OLDT', 'Oude naam nv', 100, 0, 20, 5);
  setKv('rs_OLDT', JSON.stringify({ symbol: 'OLDT', updated: '2026-11-01T10:00:00' }));
  const r = await jsonOf(await req('/api/run', { method: 'POST' }));
  assert.match(r.message, /Splitsing SPLT 2:1/);
  assert.match(r.message, /OLDT heet nu NEWT/);
  const row = DB.db.prepare('SELECT price, qty FROM intraday WHERE ts = ? AND ticker = ?').get(ts0, 'SPLT');
  assert.equal(row.price, 50, 'oude koers gehalveerd');
  assert.equal(row.qty, 20, 'oud aantal verdubbeld');
  assert.equal(DB.db.prepare("SELECT close_price AS p FROM days WHERE ticker = 'SPLT'").get().p, 50);
  assert.equal(DB.db.prepare("SELECT qty AS q FROM positions WHERE ticker = 'SPLT' AND date = '2026-11-02'").get().q, 20);
  assert.equal(DB.db.prepare("SELECT COUNT(*) AS n FROM intraday WHERE ticker = 'OLDT'").get().n, 0, 'oude ticker weg');
  assert.ok(DB.db.prepare("SELECT COUNT(*) AS n FROM intraday WHERE ticker = 'NEWT'").get().n > 0, 'onder de nieuwe ticker');
  assert.ok(kv('rs_NEWT') && !kv('rs_OLDT'), 'onderzoek mee verhuisd');
  assert.equal(JSON.parse(kv('ticker_map')).OLDT.to, 'NEWT');
  // Nog een keer met dezelfde beginstand: niets wordt opnieuw aangepast
  setKv('pos_extra', before);
  const r2 = await jsonOf(await req('/api/run', { method: 'POST' }));
  assert.ok(!/Splitsing/.test(r2.message), 'splitsing niet twee keer: ' + r2.message);
  assert.equal(DB.db.prepare('SELECT price FROM intraday WHERE ts = ? AND ticker = ?').get(ts0, 'SPLT').price, 50, 'koers niet nog eens gehalveerd');
  routes = [];
});

await test('slimmer plannen: bezit vaker dan de volglijst, cijferdagen vooraan (idee 146)', async () => {
  const T = WM._test;
  const held = [{ ticker: 'AAPL', symbol: 'AAPL' }, { ticker: 'ASML', symbol: 'ASML' }];
  const watch = [{ ticker: 'MSFT', symbol: 'MSFT' }, { ticker: 'NVDA', symbol: 'NVDA' }];
  const rs = new Map([['MSFT', { updated: '2026-11-17T09:00:00' }], ['NVDA', { updated: '2026-11-10T09:00:00' }]]);
  const events = { earnings: [{ ticker: 'ASML', date: '2026-11-20' }, { ticker: 'MSFT', date: '2026-11-19' }], lastEarnings: [{ ticker: 'AAPL', date: '2026-11-01' }] };
  const p = T.planResearch(held, watch, rs, events, '2026-11-18');
  assert.deepEqual(p.order.slice(0, 2).sort(), ['ASML', 'MSFT'], 'cijfers binnenkort gaan voor');
  assert.ok(p.order.includes('NVDA'), 'volglijst die lang niet is bijgewerkt gaat mee');
  assert.deepEqual(p.skipped, [], 'MSFT staat vooraan, dus niet overgeslagen');
  assert.deepEqual(p.order.length, 4);
  // Zonder cijfers in de buurt: een volgaandeel van gisteren wordt overgeslagen
  const p2 = T.planResearch(held, watch, rs, { earnings: [], lastEarnings: [] }, '2026-11-18');
  assert.deepEqual(p2.skipped, ['MSFT']);
  assert.deepEqual(p2.order, ['AAPL', 'ASML', 'NVDA']);
  // Net na de cijfers blijft een aandeel vooraan
  const p3 = T.planResearch(held, [], new Map(), { lastEarnings: [{ ticker: 'ASML', date: '2026-11-17' }] }, '2026-11-18');
  assert.deepEqual(p3.order, ['ASML', 'AAPL']);
  assert.deepEqual(T.uniqTasks(['a', 'b', 'a']), ['a', 'b']);
});

await test('marktnieuws: Finnhub aan zijn limiet, dan Alpha Vantage (idee 153)', async () => {
  setKv('src_health', '{}');
  setKv('av_calls', '{}');
  setKv('mkt_queue', JSON.stringify(['fhnews']));
  routes = [
    [/finnhub\.io\/api\/v1\/news/, reply({ error: 'limit' }, 429)],
    [/alphavantage\.co\/query/, (u) => {
      assert.match(u, /function=NEWS_SENTIMENT/);
      return reply({ feed: [{ title: 'Beurzen hoger', url: 'https://nieuws.test/1', time_published: '20261118T090000', source: 'AV', summary: 'Kort', ticker_sentiment: [{ ticker: 'AAPL' }] }] });
    }],
  ];
  const e = Object.assign(Object.create(env), { FINNHUB_KEY: 'fh', ALPHAVANTAGE_KEY: 'av' });
  const r = await jsonOf(await req('/api/market', { method: 'POST', env: e }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const news = JSON.parse(kv('market_news'));
  assert.match(news.source, /Alpha Vantage/);
  assert.equal(news.items[0].headline, 'Beurzen hoger');
  assert.equal(news.items[0].related, 'AAPL');
  const hp = (await jsonOf(await req('/api/health'))).health;
  assert.match(hp.sources.finnhub.backup, /Alpha Vantage/);
  // Zonder reserve-sleutel blijft het bij een uitleg bij de bron
  setKv('mkt_queue', JSON.stringify(['fhnews']));
  setKv('src_health', '{}');
  await req('/api/market', { method: 'POST', env: Object.assign(Object.create(env), { FINNHUB_KEY: 'fh' }) });
  assert.match(JSON.parse(kv('ext_errors')).marketnews.msg, /Polygon|Marketaux/);
  routes = [];
  setKv('mkt_queue', '[]');
});

await test('marktnieuws: Finnhub aan zijn limiet, dan Polygon, dan Marketaux; Alpha Vantage blijft over', async () => {
  setKv('src_health', '{}');
  setKv('av_calls', '{}');
  setKv('mx_calls', '{}');
  setKv('mkt_queue', ['fhnews']);
  const d1 = new Date(Date.now() - 864e5).toISOString().slice(0, 19) + 'Z';
  routes = [
    [/finnhub\.io\/api\/v1\/news/, reply({ error: 'limit' }, 429)],
    [/api\.massive\.com\/v2\/reference\/news/, (u, init) => {
      assert.equal(init.headers.Authorization, 'Bearer pg', 'sleutel in de kop, niet in het adres');
      assert.ok(!/apiKey=/.test(u));
      return reply({ status: 'OK', results: [{ title: 'Markt stijgt', article_url: 'https://nieuws.test/p1', published_utc: d1, publisher: { name: 'Polygon-bron' }, description: 'Kort', tickers: ['AAPL', 'MSFT'] }] });
    }],
  ];
  const e = Object.assign(Object.create(env), { FINNHUB_KEY: 'fh', POLYGON_KEY: 'pg', MARKETAUX_KEY: 'mx', ALPHAVANTAGE_KEY: 'av' });
  await req('/api/market', { method: 'POST', env: e });
  let news = JSON.parse(kv('market_news'));
  assert.match(news.source, /Polygon/);
  assert.equal(news.items[0].related, 'AAPL,MSFT');
  assert.equal(news.items[0].source, 'Polygon-bron');
  assert.ok(!calls.some((c) => /alphavantage|marketaux/.test(c.url)), 'de volgende reserves zijn niet nodig');
  assert.match(JSON.parse(kv('src_health')).finnhub.backup, /Polygon/);
  // Polygon ook stuk: Marketaux (3 berichten per verzoek, binnen het eigen dagbudget)
  setKv('src_health', '{}');
  setKv('mkt_queue', ['fhnews']);
  routes = [
    [/finnhub\.io\/api\/v1\/news/, reply({ error: 'limit' }, 429)],
    [/api\.massive\.com/, reply({ status: 'ERROR' }, 500)],
    [/api\.marketaux\.com\/v1\/news\/all/, (u) => {
      assert.match(u, /countries=us/);
      return reply({ meta: { found: 1, returned: 1 }, data: [{ title: 'Rente daalt', url: 'https://nieuws.test/m1', published_at: d1, source: 'nieuws.test', description: 'Kort', entities: [{ symbol: 'JPM', sentiment_score: 0.4 }] }] });
    }],
  ];
  await req('/api/market', { method: 'POST', env: e });
  news = JSON.parse(kv('market_news'));
  assert.match(news.source, /Marketaux/);
  assert.equal(news.items[0].related, 'JPM');
  assert.equal(JSON.parse(kv('mx_calls')).n, 1);
  assert.ok(!calls.some((c) => /alphavantage/.test(c.url)));
  routes = [];
  setKv('mkt_queue', '[]');
  setKv('src_health', '{}');
});

await test('koershistorie: Twelve Data uit, dan Tiingo; anders Polygon; Europese symbolen niet', async () => {
  const e2 = Object.assign({}, env, { FMP_KEY: 'fmp', TWELVEDATA_KEY: 'td', TIINGO_KEY: 'ti', POLYGON_KEY: 'pg', ALPHAVANTAGE_KEY: 'av' });
  setKv('src_health', { twelvedata: { fails: 3, until: Date.now() + 3600e3 } });
  setKv('eod_unavailable', []);
  setKv('tiingo_calls', '{}');
  setKv('mkt_queue', ['eod:LMT']);
  routes = [[/financialmodelingprep/, reply({ 'Error Message': 'Premium' }, 402)],
    [/api\.tiingo\.com\/tiingo\/daily\/lmt\/prices/, (u, init) => {
      assert.equal(init.headers.Authorization, 'Token ti');
      assert.match(u, /startDate=\d{4}-\d{2}-\d{2}/);
      return reply([{ date: '2026-11-13T00:00:00.000Z', close: 470, adjClose: 469.5 }, { date: '2026-11-14T00:00:00.000Z', close: 472, adjClose: 472 }]);
    }]];
  await req('/api/market', { method: 'POST', env: e2 });
  const rows = DB.db.prepare('SELECT day, price FROM ext_prices WHERE symbol = ? ORDER BY day').all('LMT');
  assert.equal(rows.length, 2, JSON.stringify(rows));
  assert.equal(rows[0].price, 469.5, 'gecorrigeerde slotkoers');
  assert.match(JSON.parse(kv('src_health')).fmp.backup, /Tiingo/);
  assert.ok(!calls.some((c) => /twelvedata|alphavantage|massive/.test(c.url)), 'Twelve Data staat uit, de rest is niet nodig');
  assert.equal(JSON.parse(kv('tiingo_calls')).n, 1);
  // Alleen Polygon: de aandelenklasse gaat met een punt (BRK.B)
  setKv('src_health', {});
  setKv('mkt_queue', ['eod2:BRK-B']);
  routes = [[/api\.massive\.com\/v2\/aggs\/ticker\/BRK\.B\/range\/1\/day\//, reply({ status: 'OK', results: [{ t: Date.UTC(2026, 10, 13, 5), c: 480.5 }, { t: Date.UTC(2026, 10, 14, 5), c: 482 }] })]];
  const e3 = Object.assign({}, env, { POLYGON_KEY: 'pg' });
  await req('/api/market', { method: 'POST', env: e3 });
  const r2 = DB.db.prepare('SELECT day, price FROM ext_prices WHERE symbol = ? ORDER BY day').all('BRK-B');
  assert.deepEqual(r2.map((r) => r.day), ['2026-11-13', '2026-11-14']);
  assert.match(JSON.parse(kv('src_health')).fmp.backup, /Polygon/);
  // Een Europees symbool kennen Tiingo en Polygon niet: dan geen verzoek
  setKv('mkt_queue', ['eod2:ASML.AS']);
  calls = [];
  routes = [];
  await req('/api/market', { method: 'POST', env: Object.assign({}, e3, { TIINGO_KEY: 'ti' }) });
  assert.ok(!calls.some((c) => /massive|tiingo/.test(c.url)), JSON.stringify(calls.map((c) => c.url)));
  assert.equal(JSON.parse(kv('mkt_queue')).length, 0, 'taak afgerond, niet eindeloos opnieuw');
  setKv('src_health', {});
});

await test('aanvulling zonder Alpha Vantage: nieuws van Polygon, kwartaalwinst en Form 4 van de SEC, analisten van FMP', async () => {
  const e2 = Object.assign({}, env, { POLYGON_KEY: 'pg', SEC_CONTACT: 'iemand@example.com', FMP_KEY: 'fmp', ALPHAVANTAGE_KEY: 'av' });
  setKv('src_health', {});
  setKv('fmp_opinion_denied', '');
  setKv('av_calls', '{}');
  setKv('rs_NOC', {});
  setKv('sec_cik', { NOC: '0001133421' });
  setKv('mkt_queue', ['alt:NOC', 'av:NOC']);
  const d1 = new Date(Date.now() - 864e5).toISOString().slice(0, 19) + 'Z', day1 = d1.slice(0, 10);
  const art = (n, s) => ({ title: 'NOC bericht ' + n, article_url: 'https://nieuws.test/noc' + n, published_utc: d1, publisher: { name: 'Bron' }, tickers: ['NOC'], insights: [{ ticker: 'NOC', sentiment: s }] });
  const f4 = '<?xml version="1.0"?><ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerCik>1</rptOwnerCik><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId></reportingOwner>' +
    '<nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>' + day1 + '</value></transactionDate>' +
    '<transactionCoding><transactionFormType>4</transactionFormType><transactionCode>P</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>100</value></transactionShares>' +
    '<transactionPricePerShare><value>500.25</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>' +
    '<postTransactionAmounts><sharesOwnedFollowingTransaction><value>1100</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>';
  routes = [
    [/api\.massive\.com\/v2\/reference\/news\?ticker=NOC/, reply({ status: 'OK', results: [art(1, 'positive'), art(2, 'negative'), art(3, 'positive')] })],
    [/companyconcept\/CIK0001133421\/us-gaap\/EarningsPerShareDiluted/, (u, init) => {
      assert.match(init.headers['User-Agent'], /iemand@example\.com/);
      return reply({ units: { 'USD/shares': [{ end: '2026-06-30', val: 6.1, frame: 'CY2026Q2' }, { end: '2026-09-30', val: 7, frame: 'CY2026Q3' }, { end: '2025-12-31', val: 25, frame: 'CY2025', fp: 'FY' }] } });
    }],
    [/submissions\/CIK0001133421\.json/, reply({ filings: { recent: { form: ['4', '10-Q', '4'], filingDate: [day1, day1, '2020-01-01'], accessionNumber: ['0001-26-000001', '0001-26-000002', '0001-20-000003'], primaryDocument: ['xslF345X05/form4.xml', 'q.htm', 'old.xml'] } } })],
    [/Archives\/edgar\/data\/1133421\/000126000001\/form4\.xml/, reply(f4)],
    [/financialmodelingprep.*grades-consensus/, reply([{ symbol: 'NOC', strongBuy: 2, buy: 8, hold: 6, sell: 1, strongSell: 0 }])],
    [/financialmodelingprep.*price-target-consensus/, reply([{ symbol: 'NOC', targetHigh: 700, targetLow: 450, targetConsensus: 610, targetMedian: 600 }])],
  ];
  const r = await jsonOf(await req('/api/market', { method: 'POST', env: e2 }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const R = JSON.parse(kv('rs_NOC'));
  assert.deepEqual(R.src, { news: 'polygon', sent: 'polygon', eps: 'sec', insider: 'sec', rec: 'fmp', target: 'fmp' }, JSON.stringify(R.src));
  assert.equal(R.news.length, 3);
  assert.ok(Math.abs(R.sent.bull - 2 / 3) < 1e-9);
  assert.deepEqual(R.eps.map((x) => [x.period, x.actual, x.estimate]), [['2026-09-30', 7, null], ['2026-06-30', 6.1, null]]);
  assert.deepEqual(R.insider[0], { name: 'Doe Jane', date: day1, code: 'P', change: 100, price: 500.25, shares: 1100 });
  assert.equal(R.insider.length, 1, 'oude meldingen niet opgehaald');
  assert.equal(R.rec[0].b, 8);
  assert.equal(R.target.mean, 610);
  assert.equal(R.target.low, 450);
  assert.ok(!calls.some((c) => /alphavantage/.test(c.url)), 'Alpha Vantage hoeft niets meer');
  assert.ok(!calls.some((c) => /old\.xml/.test(c.url)), 'meldingen ouder dan een half jaar niet');
  // Nogmaals vandaag: niets meer te doen, en FMP pas over een week weer
  calls = [];
  setKv('mkt_queue', ['alt:NOC']);
  await req('/api/market', { method: 'POST', env: e2 });
  assert.equal(calls.filter((c) => !/t212/.test(c.url)).length, 0, JSON.stringify(calls.map((c) => c.url)));
  routes = [];
  setKv('mkt_queue', '[]');
});

await test('profiel en planning zonder FMP en Finnhub: Polygon, met de reserves in de rij', async () => {
  setKv('src_health', {});
  setKv('mkt_queue', ['profile:NOC']);
  routes = [[/api\.massive\.com\/v3\/reference\/tickers\/NOC/, reply({ status: 'OK', results: { name: 'Northrop Grumman', market_cap: 7e10, sic_code: '3812', sic_description: 'Search, detection and navigation systems', primary_exchange: 'XNYS', currency_name: 'usd', locale: 'us', type: 'CS', cik: '0001133421', total_employees: 100000, list_date: '1981-01-01' } })]];
  const e2 = Object.assign({}, env, { POLYGON_KEY: 'pg' });
  await req('/api/market', { method: 'POST', env: e2 });
  const p = JSON.parse(DB.db.prepare('SELECT data FROM ext_profile WHERE symbol = ?').get('NOC').data);
  assert.equal(p.source, 'Polygon');
  assert.equal(p.sector, 'Industrials');
  assert.equal(p.currency, 'USD');
  assert.equal(p.marketCap, 7e10);
  const T = WM._test;
  assert.equal(T.usSym('BRK-B'), true);
  assert.equal(T.usSym('AAPL'), true);
  assert.equal(T.usSym('ASML.AS'), false);
  assert.equal(T.usSym('VOD.L'), false);
  assert.equal(T.sicSector(7372), 'Technology');
  assert.equal(T.sicSector(2834), 'Healthcare');
  assert.equal(T.sicSector(9999), null);
  // Planning: zonder FMP en Finnhub komen profiel, koershistorie, marktnieuws en de aanvulling via de reserves
  const e3 = Object.assign({}, env, { POLYGON_KEY: 'pg', TIINGO_KEY: 'ti', MARKETAUX_KEY: 'mx' });
  setKv('mkt_planned', '');
  await T.planMarket(e3);
  const q = JSON.parse(kv('mkt_queue'));
  assert.ok(q.includes('fhnews'), JSON.stringify(q));
  assert.ok(q.includes('profile:GOED') && q.includes('eod:AAPL') && q.includes('alt:AAPL'), JSON.stringify(q));
  assert.ok(!q.some((t) => t.startsWith('av:')), 'zonder Alpha Vantage-sleutel geen av-taken');
  routes = [];
  setKv('mkt_queue', '[]');
  setKv('src_health', {});
});

await test('sleutels van Tiingo, Polygon en Marketaux testen zonder ze te laten zien', async () => {
  routes = [
    [/api\.tiingo\.com\/tiingo\/daily\/aapl/, (u, init) => (init.headers.Authorization === 'Token goed-ti' ? reply({ ticker: 'AAPL', name: 'Apple' }) : reply({ detail: 'Invalid token.' }, 401))],
    [/api\.massive\.com\/v2\/aggs\/ticker\/AAPL\/prev/, (u, init) => (init.headers.Authorization === 'Bearer goed-pg' ? reply({ status: 'OK', results: [{ c: 230 }] }) : reply({ status: 'ERROR' }, 401))],
    [/api\.marketaux\.com/, (u) => (/goed-mx/.test(u) ? reply({ meta: {}, data: [] }) : reply({ error: { code: 'invalid_api_token' } }, 401))],
  ];
  for (const [name, good] of [['TIINGO_KEY', 'goed-ti'], ['POLYGON_KEY', 'goed-pg'], ['MARKETAUX_KEY', 'goed-mx']]) {
    let r = await jsonOf(await req('/api/keytest', { method: 'POST', body: { name, value: good } }));
    assert.equal(r.result.state, 'ok', name + ': ' + JSON.stringify(r.result));
    assert.ok(!JSON.stringify(r).includes(good));
    r = await jsonOf(await req('/api/keytest', { method: 'POST', body: { name, value: 'fout-' + name } }));
    assert.equal(r.result.state, 'fout', name + ': ' + JSON.stringify(r.result));
  }
  // De Worker telt Tiingo en Marketaux tegen hun eigen dagbudget
  const day = WM._test.parts(new Date()).day;
  setKv('tiingo_calls', { day, n: 450, hour: 'x', h: 0 });
  setKv('mx_calls', { day, n: 90 });
  const b = await WM._test.budgetInfo(env);
  const byId = Object.fromEntries(b.sources.map((x) => [x.src, x]));
  assert.equal(byId.tiingo.used, 450);
  assert.equal(byId.tiingo.pct, 0.5);
  assert.equal(byId.marketaux.pct, 1);
  assert.equal(byId.polygon.per, 'minuut');
  routes = [];
});

await test('OpenFIGI: ISIN naar beurzen; Amerikaanse bronnen alleen voor effecten die in de VS noteren', async () => {
  const T = WM._test;
  setKv('src_health', {});
  setKv('figi', {});
  setKv('pos_extra', { AAPL: { isin: 'US0378331005', t212: 'AAPL_US_EQ' }, RAND: { isin: 'NL0000379121', t212: 'RANDa_EQ' }, VUAG: { isin: 'IE00BFMXXD54', t212: 'VUAGl_EQ' }, ONB: { isin: 'XS0000000001' } });
  setKv('mkt_queue', ['figi']);
  routes = [[/api\.openfigi\.com\/v3\/mapping/, (u, init) => {
    assert.equal(init.method, 'POST');
    assert.ok(!init.headers['X-OPENFIGI-APIKEY'], 'zonder sleutel geen sleutelkop');
    const jobs = JSON.parse(init.body);
    assert.ok(jobs.every((j) => j.idType === 'ID_ISIN'));
    return reply(jobs.map((j) => ({
      US0378331005: { data: [{ figi: 'BBG000B9XRY4', name: 'APPLE INC', ticker: 'AAPL', exchCode: 'US', securityType: 'Common Stock', securityType2: 'Common Stock' }, { ticker: 'APC', exchCode: 'GY', name: 'APPLE INC', securityType: 'Common Stock' }] },
      NL0000379121: { data: [{ name: 'RANDSTAD NV', ticker: 'RAND', exchCode: 'NA', securityType: 'Common Stock', securityType2: 'Common Stock' }] },
      IE00BFMXXD54: { data: [{ name: 'VANGUARD S&P 500 UCITS ETF', ticker: 'VUAG', exchCode: 'LN', securityType: 'ETP', securityType2: 'Mutual Fund' }] },
      XS0000000001: { warning: 'No identifier found.' },
    })[j.idValue]));
  }]];
  await req('/api/market', { method: 'POST' });
  const map = JSON.parse(kv('figi'));
  assert.equal(map.US0378331005.us, 'AAPL');
  assert.deepEqual(map.US0378331005.ex, [['US', 'AAPL'], ['GY', 'APC']]);
  assert.equal(map.NL0000379121.us, null, 'Randstad noteert niet in de VS');
  assert.equal(map.IE00BFMXXD54.fund, true, 'ETP is een fonds');
  assert.equal(map.XS0000000001.none, true);
  const fs = JSON.parse(kv('figi_sym'));
  assert.equal(fs.RAND.us, null);
  assert.equal(fs.VUAG.fund, true);
  assert.deepEqual(fs.AAPL.ex, ['US', 'GY']);
  const e2 = Object.create(env);
  assert.equal(await T.usTicker(e2, 'AAPL'), 'AAPL');
  assert.equal(await T.usTicker(e2, 'RAND'), null, 'geen Amerikaanse bron voor Randstad');
  assert.equal(await T.usTicker(e2, 'ONB'), 'ONB', 'onbekend bij OpenFIGI: de oude regel');
  assert.equal(await T.usTicker(e2, 'WATCH'), 'WATCH', 'volglijst zonder ISIN: de oude regel');
  // Tiingo vraagt niet naar Randstad (anders kreeg je een Amerikaans bedrijf met dezelfde letters)
  calls = [];
  routes = [];
  setKv('mkt_queue', ['eod2:RAND']);
  await req('/api/market', { method: 'POST', env: Object.assign({}, env, { TIINGO_KEY: 'ti', POLYGON_KEY: 'pg' }) });
  assert.ok(!calls.some((c) => /tiingo|massive/.test(c.url)), JSON.stringify(calls.map((c) => c.url)));
  // Een tweede keer vandaag: niets te doen
  calls = [];
  setKv('mkt_queue', ['figi']);
  await req('/api/market', { method: 'POST' });
  assert.ok(!calls.some((c) => /openfigi/.test(c.url)), 'binnen 30 dagen niet opnieuw');
  // Te veel verzoeken: korte pauze, niets overschreven
  setKv('figi', {});
  setKv('mkt_queue', ['figi']);
  routes = [[/api\.openfigi\.com/, reply({ error: 'Too many requests' }, 429)]];
  await req('/api/market', { method: 'POST' });
  const h = JSON.parse(kv('src_health')).openfigi;
  assert.ok(h && h.minute === true && h.until > Date.now(), JSON.stringify(h));
  assert.equal(JSON.parse(kv('figi_sym')).RAND.us, null, 'de vorige korte vorm blijft staan');
  // Met sleutel: grotere partij en de sleutel in de kop
  setKv('src_health', {});
  setKv('mkt_queue', ['figi']);
  routes = [[/api\.openfigi\.com/, (u, init) => { assert.equal(init.headers['X-OPENFIGI-APIKEY'], 'of'); return reply(JSON.parse(init.body).map(() => ({ warning: 'No identifier found.' }))); }]];
  await req('/api/market', { method: 'POST', env: Object.assign({}, env, { OPENFIGI_KEY: 'of' }) });
  assert.ok(calls.some((c) => /openfigi/.test(c.url)));
  routes = [];
  setKv('figi', {}); setKv('figi_sym', {}); setKv('pos_extra', {}); setKv('src_health', {}); setKv('mkt_queue', '[]');
});

await test('GDELT: nieuws per aandeel op bedrijfsnaam en marktnieuws, zonder sleutel; uit te zetten', async () => {
  const T = WM._test;
  assert.equal(T.gdeltName('Randstad N.V.'), 'Randstad');
  assert.equal(T.gdeltName('Apple Inc.'), 'Apple');
  assert.equal(T.gdeltName('The Coca-Cola Company'), 'Coca-Cola');
  assert.equal(T.gdeltName('Co'), null, 'te kort: geen zoekvraag');
  await T.ensureMarketTables(env);
  DB.db.prepare('INSERT OR REPLACE INTO ext_profile (symbol, data, updated) VALUES (?,?,?)').run('RAND', JSON.stringify({ name: 'Randstad N.V.' }), '2026-01-01');
  setKv('figi_sym', { RAND: { us: null, fund: false, ex: ['NA'] } });
  setKv('src_health', {});
  setKv('settings', {});
  setKv('rs_RAND', {});
  const seen = (d) => new Date(Date.now() - d * 864e5).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  routes = [[/api\.gdeltproject\.org\/api\/v2\/doc\/doc/, (u) => {
    const q = decodeURIComponent(new URL(u).searchParams.get('query'));
    assert.match(q, /"Randstad"/);
    assert.match(u, /mode=ArtList/);
    assert.match(u, /format=json/);
    return reply({ articles: [
      { url: 'https://nieuws.test/r1', title: 'Randstad ziet minder vraag naar uitzendkrachten', seendate: seen(1), domain: 'nieuws.test', language: 'Dutch', sourcecountry: 'Netherlands' },
      { url: 'http://onveilig.test/r2', title: 'Zonder https', seendate: seen(1), domain: 'onveilig.test' },
      { url: 'https://nieuws.test/r3', title: 'Randstad koopt bureau', seendate: seen(3), domain: 'nieuws.test' },
    ] });
  }]];
  setKv('mkt_queue', ['alt:RAND']);
  await req('/api/market', { method: 'POST', env: Object.assign({}, env, { POLYGON_KEY: 'pg' }) });
  const R = JSON.parse(kv('rs_RAND'));
  assert.equal(R.src.news, 'gdelt');
  assert.equal(R.news.length, 2, 'alleen https-links');
  assert.equal(R.news[0].headline, 'Randstad ziet minder vraag naar uitzendkrachten');
  assert.equal(R.news[0].source, 'nieuws.test');
  assert.ok(!R.sent, 'GDELT geeft geen stemming per aandeel');
  assert.ok(!calls.some((c) => /massive/.test(c.url)), 'Polygon niet gevraagd: Randstad noteert niet in de VS');
  // Marktnieuws: Finnhub aan zijn limiet, geen andere sleutels: GDELT met het thema aandelenmarkt
  setKv('mkt_queue', ['fhnews']);
  routes = [
    [/finnhub\.io\/api\/v1\/news/, reply({ error: 'limit' }, 429)],
    [/api\.gdeltproject\.org/, (u) => { assert.match(decodeURIComponent(u), /theme:ECON_STOCKMARKET/); return reply({ articles: [{ url: 'https://nieuws.test/m1', title: 'Beurzen hoger', seendate: seen(0.2), domain: 'nieuws.test' }] }); }],
  ];
  await req('/api/market', { method: 'POST', env: Object.assign({}, env, { FINNHUB_KEY: 'fh' }) });
  const mn = JSON.parse(kv('market_news'));
  assert.match(mn.source, /GDELT/);
  assert.equal(mn.items[0].headline, 'Beurzen hoger');
  assert.match(JSON.parse(kv('src_health')).finnhub.backup, /GDELT/);
  // GDELT vraagt om rustiger aan te doen (platte tekst): korte pauze, geen fout op de site
  setKv('src_health', {});
  setKv('mkt_queue', ['fhnews']);
  routes = [[/api\.gdeltproject\.org/, reply('Please limit requests to one every 5 seconds.')]];
  await req('/api/market', { method: 'POST' });
  assert.equal(JSON.parse(kv('src_health')).gdelt.minute, true);
  // Uitgezet in de instellingen: geen verzoek naar GDELT
  setKv('src_health', {});
  setKv('settings', { features: { gdelt: false } });
  setKv('rs_RAND', {});
  setKv('mkt_queue', ['alt:RAND', 'fhnews']);
  calls = [];
  routes = [];
  await req('/api/market', { method: 'POST' });
  assert.ok(!calls.some((c) => /gdeltproject/.test(c.url)), JSON.stringify(calls.map((c) => c.url)));
  setKv('settings', {}); setKv('figi_sym', {}); setKv('src_health', {}); setKv('mkt_queue', '[]');
  routes = [];
});

await test('sleutel van OpenFIGI testen', async () => {
  routes = [[/api\.openfigi\.com/, (u, init) => (init.headers['X-OPENFIGI-APIKEY'] === 'goed-of' ? reply([{ data: [{ ticker: 'AAPL', exchCode: 'US' }] }]) : reply({ error: 'Invalid API key.' }, 401))]];
  let r = await jsonOf(await req('/api/keytest', { method: 'POST', body: { name: 'OPENFIGI_KEY', value: 'goed-of' } }));
  assert.equal(r.result.state, 'ok', JSON.stringify(r));
  r = await jsonOf(await req('/api/keytest', { method: 'POST', body: { name: 'OPENFIGI_KEY', value: 'fout-of' } }));
  assert.equal(r.result.state, 'fout');
  routes = [];
});

await test('budget per bron en databasegrootte (ideeën 151, 152)', async () => {
  const T = WM._test;
  const day = T.parts(new Date()).day;
  setKv('api_calls', JSON.stringify({ [day]: { finnhub: 42, sec: 3 } }));
  setKv('fmp_calls', JSON.stringify({ day, n: 200 }));
  setKv('av_calls', JSON.stringify({ day, n: 25 }));
  const b = await T.budgetInfo(env);
  const byId = Object.fromEntries(b.sources.map((x) => [x.src, x]));
  assert.equal(byId.fmp.used, 200);
  assert.equal(byId.fmp.limit, 250);
  assert.ok(byId.fmp.pct > 0.8 && byId.fmp.pct <= 1);
  assert.equal(byId.alphavantage.used, 25);
  assert.equal(byId.alphavantage.pct, 1);
  assert.equal(byId.finnhub.used, 42);
  assert.equal(byId.finnhub.pct, null, 'per minuut: geen dagdeel');
  // Databasegrootte: schatting plus opruimen van oud nieuws
  DB.db.prepare('INSERT OR IGNORE INTO news_hist (tk, t, headline, source, url, summary) VALUES (?,?,?,?,?,?)')
    .run('OUDX', Date.now() - 500 * 864e5, 'Heel oud bericht', 'Test', 'https://nieuws.test/oud', 'oud');
  const before = DB.db.prepare("SELECT COUNT(*) AS n FROM news_hist WHERE tk = 'OUDX'").get().n;
  assert.equal(before, 1);
  const d = await T.dbWatch(env, true);
  assert.ok(d.bytes > 0 && d.limit === 500e6 && d.pct >= 0);
  assert.ok(d.tables.intraday.rows > 0);
  assert.equal(DB.db.prepare("SELECT COUNT(*) AS n FROM news_hist WHERE tk = 'OUDX'").get().n, 0, 'nieuws ouder dan 400 dagen is opgeruimd');
  assert.match(d.cleaned, /nieuwsregels/);
  const st = (await jsonOf(await req('/api/status'))).status;
  assert.ok(st.db.bytes > 0, 'statuspagina kent de grootte');
  assert.ok(st.budgets.sources.length >= 5);
});

await test('reservekopie in R2: dag en week, bewaartermijn en voorbeeld (idee 150)', async () => {
  const T = WM._test;
  const store = new Map();
  const R2 = {
    put: async (k, v) => { store.set(k, { body: String(v), size: String(v).length, uploaded: new Date() }); },
    get: async (k) => (store.has(k) ? { text: async () => store.get(k).body } : null),
    delete: async (k) => { store.delete(k); },
    list: async (o) => ({ objects: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || '')).sort().map((k) => ({ key: k, size: store.get(k).size, uploaded: store.get(k).uploaded })) }),
  };
  // Zonder binding gebeurt er niets
  assert.equal(await T.r2Backup(env, new Date('2026-11-18T05:17:00Z')), null);
  assert.equal((await T.r2Info(env)).on, false);
  const e = Object.assign(Object.create(env), { BACKUP: R2 });
  setKv('r2_last', '');
  // Een zondag: dag- én weekkopie
  assert.equal(await T.r2Backup(e, new Date('2026-11-22T05:17:00Z')), '2026-11-22');
  assert.ok(store.has('dag/2026-11-22.json') && store.has('week/2026-11-22.json'));
  // Dezelfde dag nog eens: niets nieuws
  assert.equal(await T.r2Backup(e, new Date('2026-11-22T06:17:00Z')), null);
  assert.equal(store.size, 2);
  // Tien dagen achter elkaar: 7 dagkopieën blijven over
  for (let i = 1; i <= 10; i++) { setKv('r2_last', ''); await T.r2Backup(e, new Date('2026-12-' + String(i).padStart(2, '0') + 'T05:17:00Z')); }
  const info = await T.r2Info(e);
  assert.equal(info.on, true);
  assert.equal(info.copies.filter((c) => c.kind === 'dag').length, 7, 'zeven dagkopieën');
  assert.ok(info.copies.filter((c) => c.kind === 'week').length <= 4);
  // Voorbeeld: wat zit erin, zonder iets terug te zetten
  const key = info.copies.find((c) => c.kind === 'dag').key;
  const weeksNow = DB.db.prepare('SELECT COUNT(*) AS n FROM weeks').get().n;
  const pv = (await T.r2Preview(e, key)).preview;
  assert.equal(pv.key, key);
  assert.ok(pv.bytes > 10);
  const wk = pv.tables.find((t) => t.table === 'weeks');
  assert.equal(wk.inDatabase, weeksNow);
  assert.equal(wk.diff, wk.inBackup - weeksNow);
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM weeks').get().n, weeksNow, 'een voorbeeld verandert niets');
  await assert.rejects(() => T.r2Preview(e, 'dag/../geheim.json'), /Onbekende reservekopie/);
  await assert.rejects(() => T.r2Preview(e, 'dag/2001-01-01.json'), /niet \(meer\)/);
  // Via de API, met en zonder bucket
  const r = await jsonOf(await req('/api/r2', { env: e }));
  assert.equal(r.on, true);
  const r0 = await jsonOf(await req('/api/r2'));
  assert.equal(r0.on, false);
});

await test('taken kunnen twee keer draaien zonder schade (idee 155)', async () => {
  const snap = () => JSON.stringify({
    prices: DB.db.prepare('SELECT symbol, day, price FROM ext_prices ORDER BY symbol, day').all(),
    profiles: DB.db.prepare('SELECT symbol, data FROM ext_profile ORDER BY symbol').all(),
    perf: DB.db.prepare('SELECT day, kind, name, change FROM ext_perf ORDER BY day, kind, name').all(),
    news: DB.db.prepare('SELECT COUNT(*) AS n FROM news_hist').get(),
  });
  routes = [
    [/financialmodelingprep.*\/profile/, reply([{ symbol: 'AAPL', companyName: 'Apple', price: 230, currency: 'USD', sector: 'Technology', industry: 'Consumer Electronics', exchange: 'NASDAQ' }])],
    [/financialmodelingprep.*historical-price-eod/, reply([{ date: '2026-11-17', price: 229 }, { date: '2026-11-16', price: 228 }])],
    [/financialmodelingprep.*sector-performance-snapshot/, reply([{ sector: 'Technology', exchange: 'NASDAQ', averageChange: 0.4 }])],
    [/financialmodelingprep.*industry-performance-snapshot/, reply([{ industry: 'Consumer Electronics', exchange: 'NASDAQ', averageChange: 0.2 }])],
    [/finnhub\.io\/api\/v1\/company-news/, reply([{ datetime: Math.floor(Date.parse('2026-11-17T10:00:00Z') / 1000), headline: 'Apple bericht', source: 'Test', url: 'https://nieuws.test/idem/1', summary: 's' }])],
  ];
  const queue = ['profile:AAPL', 'eod:AAPL', 'perf:2026-11-17', 'fh:AAPL'];
  const e = Object.assign(Object.create(env), { FMP_KEY: 'fmp', FINNHUB_KEY: 'fh' });
  setKv('fmp_calls', '{}');
  setKv('src_health', '{}');
  setKv('mkt_queue', JSON.stringify(queue));
  await req('/api/market', { method: 'POST', env: e });
  const a = snap();
  setKv('mkt_queue', JSON.stringify(queue));
  await req('/api/market', { method: 'POST', env: e });
  assert.equal(snap(), a, 'tweede keer dezelfde taken geeft dezelfde gegevens');
  // Dezelfde taak staat nooit twee keer in de rij
  setKv('settings', JSON.stringify(Object.assign(JSON.parse(kv('settings') || '{}'), { watchlist: ['AAPL', 'AAPL', 'MSFT'] })));
  await req('/api/market?plan=1', { method: 'POST', env: e });
  const q = JSON.parse(kv('mkt_queue'));
  assert.equal(q.length, new Set(q).size, 'geen dubbele taken: ' + q.join(', '));
  routes = [];
  setKv('mkt_queue', '[]');
});

await test('meldingen over analisten, insiders en 13F: alleen voor je eigen posities', async () => {
  const e2 = Object.assign({}, env, { FINNHUB_KEY: 'fh', SEC_CONTACT: 'iemand@example.com' });
  await req('/api/push/subscribe', { method: 'POST', body: { sub: { endpoint: 'https://push.test/abc', keys: { p256dh: b64u(pubRaw), auth: b64u(sub.auth) } } } });
  await req('/api/settings', { method: 'POST', body: { alerts: { move: 0, earnings: false, insider: true, drift: 0, ratings: true } } });
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  // Tien dagen geschiedenis: toen zeiden 13 van de 18 analisten kopen
  const hist = [[day(-10), 5, 8, 4, 1, 0, 200]];
  setKv('rs_AAPL', { recHist: hist });
  setKv('rs_NVDA', { recHist: hist });
  const fh = (sym) => [
    [/finnhub\.io\/api\/v1\/company-news/, reply([])],
    [/finnhub\.io\/api\/v1\/stock\/recommendation/, reply([{ period: day(0), strongBuy: 5, buy: 11, hold: 4, sell: 1, strongSell: 0 }])],
    [/finnhub\.io\/api\/v1\/stock\/earnings/, reply([{ period: day(-20), actual: 2.1, estimate: 2, surprisePercent: 5 }])],
    [/finnhub\.io\/api\/v1\/stock\/insider-transactions/, reply({ data: [{ name: 'Voorbeeld, A.', transactionDate: day(-2), transactionCode: 'P', change: 900, transactionPrice: 210, share: 5000 }] })],
    [/finnhub\.io\/api\/v1\/stock\/price-target/, reply({ targetMean: 230, targetMedian: 232, targetHigh: 280, targetLow: 190, lastUpdated: day(0) })],
    [/finnhub\.io\/api\/v1\/news-sentiment/, reply({ sentiment: { bullishPercent: 0.6, bearishPercent: 0.4 }, companyNewsScore: 0.7, buzz: { articlesInLastWeek: 20, buzz: 1 } })],
  ];
  let pushes = [];
  const catchPush = [[/push\.test/, async (u, init) => { pushes.push(await decryptPush(init.body)); return reply('', 201); }]];
  // AAPL zit in de portefeuille: melding over de analisten en over de bestuurder die koopt
  setKv('mkt_queue', ['fh:AAPL']);
  routes = fh('AAPL').concat(catchPush);
  await req('/api/market', { method: 'POST', env: e2 });
  const rat = pushes.filter((p) => /analist/.test(p.title));
  assert.equal(rat.length, 1, JSON.stringify(pushes));
  assert.match(rat[0].title, /AAPL: 3 analisten meer positief deze week/);
  assert.match(rat[0].body, /16 van de 21 analisten kopen/);
  assert.equal(pushes.filter((p) => /bestuurder koopt/.test(p.title)).length, 1, JSON.stringify(pushes));
  // Tweede ronde dezelfde week: geen tweede melding
  pushes = [];
  setKv('mkt_queue', ['fh:AAPL']);
  routes = fh('AAPL').concat(catchPush);
  await req('/api/market', { method: 'POST', env: e2 });
  assert.equal(pushes.length, 0, 'één melding per week per aandeel: ' + JSON.stringify(pushes));
  // NVDA staat alleen op de volglijst: geen meldingen over insiders of analisten
  pushes = [];
  setKv('mkt_queue', ['fh:NVDA']);
  routes = fh('NVDA').concat(catchPush);
  await req('/api/market', { method: 'POST', env: e2 });
  assert.equal(pushes.length, 0, 'volglijst geeft geen meldingen: ' + JSON.stringify(pushes));
  assert.ok(JSON.parse(kv('rs_NVDA')).recHist.length >= 2, 'de geschiedenis wordt wel bijgehouden');
  // 13F: een grote belegger koopt bij in een aandeel dat je hebt
  pushes = [];
  setKv('mkt_queue', ['f13']);
  const fund = { form: ['13F-HR'], accessionNumber: ['0000950123-26-001234'], filingDate: [day(-1)], reportDate: [day(-40)] };
  routes = [[/submissions\/CIK/, reply({ filings: { recent: fund } })],
    [/index\.json$/, reply({ directory: { item: [{ name: 'primary_doc.xml' }, { name: 'infotable.xml' }] } })],
    [/infotable\.xml$/, reply('<informationTable><infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><value>900</value><shrsOrPrnAmt><sshPrnamt>40</sshPrnamt></shrsOrPrnAmt></infoTable></informationTable>')]].concat(catchPush);
  await req('/api/market', { method: 'POST', env: e2 });
  const f13 = pushes.filter((p) => /AAPL/.test(p.title));
  assert.ok(f13.length >= 1, 'melding over de 13F: ' + JSON.stringify(pushes));
  assert.match(f13[0].title, /Berkshire Hathaway/);
  assert.match(f13[0].body, /kwartaalopgave bij de SEC/);
});

await test('stille uren: melding in de wachtrij, daarna gebundeld verstuurd', async () => {
  ['alerts_sent', 'alert_queue', 'alert_log', 'digest_day'].forEach((k) => setKv(k, k === 'alert_queue' || k === 'alert_log' ? '[]' : '{}'));
  await req('/api/settings', { method: 'POST', body: { priceAlerts: [] } });
  await req('/api/push/subscribe', { method: 'POST', body: { sub: { endpoint: 'https://push.test/abc', keys: { p256dh: b64u(pubRaw), auth: b64u(sub.auth) } } } });
  // Stil van 14 tot 17 uur (Amsterdamse tijd); 14:00 UTC is 15:00 plaatselijk
  await req('/api/settings', { method: 'POST', body: { alerts: { move: 5, earnings: true, insider: true, drift: 5, quietFrom: 14, quietTo: 17 } } });
  const y = '2026-11-16';
  DB.db.prepare("INSERT OR REPLACE INTO days (day, ticker, name, open, close, low, high, avg, range, range_pct, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(y, 'AAPL', 'Apple', 360, 360, 355, 362, 359, 7, 0.02, 80, 200);
  const pushes = [];
  routes = t212Routes().concat([[/push\.test/, async (u, init) => { pushes.push(await decryptPush(init.body)); return reply('', 201); }]]);
  await W.scheduled({ cron: '*/10 * * * *', scheduledTime: Date.parse('2026-11-17T14:00:00Z') }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(pushes.length, 0, 'tijdens de stille uren gaat er niets uit: ' + JSON.stringify(pushes));
  const a1 = await jsonOf(await req('/api/alerts'));
  assert.equal(a1.queue.length, 1, 'melding staat in de wachtrij');
  assert.equal(a1.log[0].mode, 'stille uren');
  assert.match(a1.log[0].title, /AAPL/);
  // Na de stille uren (17:30 UTC = 18:30 plaatselijk) gaat de wachtrij in één melding
  await W.scheduled({ cron: '*/10 * * * *', scheduledTime: Date.parse('2026-11-17T17:30:00Z') }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(pushes.length, 1, 'één gebundelde melding: ' + JSON.stringify(pushes));
  assert.match(pushes[0].title, /AAPL/);
  assert.equal((await jsonOf(await req('/api/alerts'))).queue.length, 0, 'wachtrij is leeg');
  await req('/api/settings', { method: 'POST', body: { alerts: { move: 5, earnings: true, insider: true, drift: 5 } } });
  setKv('alerts_sent', '{}');
  setKv('alert_log', '[]');
});

await test('dagbundel: alles samen, één keer per dag vanaf het gekozen uur', async () => {
  ['alerts_sent', 'alert_queue', 'alert_log', 'digest_day'].forEach((k) => setKv(k, k === 'alert_queue' || k === 'alert_log' ? '[]' : '{}'));
  await req('/api/settings', { method: 'POST', body: { priceAlerts: [] } });
  await req('/api/push/subscribe', { method: 'POST', body: { sub: { endpoint: 'https://push.test/abc', keys: { p256dh: b64u(pubRaw), auth: b64u(sub.auth) } } } });
  await req('/api/settings', { method: 'POST', body: { alerts: { move: 5, earnings: true, insider: true, drift: 5, digest: true, digestHour: 20 } } });
  const y = '2026-11-18';
  DB.db.prepare("INSERT OR REPLACE INTO days (day, ticker, name, open, close, low, high, avg, range, range_pct, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(y, 'AAPL', 'Apple', 360, 360, 355, 362, 359, 7, 0.02, 80, 200);
  // Laatste meting van gisteren: dezelfde 2 stuks voor € 360, dus vandaag (€ 400) is echt een koersstijging
  DB.db.prepare('INSERT OR REPLACE INTO intraday (ts, ticker, name, value, unrealized, price, qty) VALUES (?,?,?,?,?,?,?)').run(Date.parse('2026-11-18T20:00:00Z'), 'AAPL', 'Apple', 360, 0, 207, 2);
  const pushes = [];
  routes = t212Routes().concat([[/push\.test/, async (u, init) => { pushes.push(await decryptPush(init.body)); return reply('', 201); }]]);
  // 14:00 UTC = 15:00 plaatselijk: nog voor het bundeluur
  await W.scheduled({ cron: '*/10 * * * *', scheduledTime: Date.parse('2026-11-19T14:00:00Z') }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(pushes.length, 0, 'voor het bundeluur gaat er niets uit: ' + JSON.stringify(pushes));
  assert.equal((await jsonOf(await req('/api/alerts'))).queue.length, 1);
  // 19:10 UTC = 20:10 plaatselijk
  await W.scheduled({ cron: '*/10 * * * *', scheduledTime: Date.parse('2026-11-19T19:10:00Z') }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(pushes.length, 1, 'de dagbundel gaat één keer uit');
  // Nog een melding op dezelfde dag wacht tot morgen
  setKv('alerts_sent', '{}');
  await W.scheduled({ cron: '*/10 * * * *', scheduledTime: Date.parse('2026-11-19T19:40:00Z') }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(pushes.length, 1, 'niet twee bundels op één dag');
  assert.equal((await jsonOf(await req('/api/alerts'))).queue.length, 1, 'de nieuwe melding wacht');
  await req('/api/settings', { method: 'POST', body: { alerts: { move: 5, earnings: true, insider: true, drift: 5 } } });
  setKv('alert_queue', '[]');
  setKv('alerts_sent', '{}');
});

await test('apparaatcodes: eigen code per apparaat, en uitloggen op alle apparaten', async () => {
  setKv('sessions', '[]');
  const made = await jsonOf(await req('/api/sessions', { method: 'POST', body: { label: 'Testtelefoon' } }));
  assert.ok(made.session && made.session.length > 20, 'er komt een code terug');
  assert.notEqual(made.session, TOKEN, 'niet dezelfde code als de toegangscode');
  // De code zelf staat niet in de Worker, alleen de SHA-256
  assert.ok(!String(kv('sessions')).includes(made.session), 'alleen de versleutelde vorm wordt bewaard');
  const asDevice = (path, opts = {}) => req(path, Object.assign({}, opts, { headers: { Authorization: 'Bearer ' + made.session } }));
  assert.equal((await asDevice('/api/status')).status, 200, 'de apparaatcode geeft toegang');
  const list = await jsonOf(await asDevice('/api/sessions'));
  assert.equal(list.devices.length, 1);
  assert.equal(list.devices[0].label, 'Testtelefoon');
  assert.equal(list.current, list.devices[0].id, 'dit apparaat is te herkennen');
  assert.equal(list.master, false);
  assert.equal((await jsonOf(await req('/api/sessions'))).master, true, 'met de toegangscode zelf');
  // Uitloggen op alle apparaten: de apparaatcode werkt niet meer, de toegangscode wel
  const rev = await jsonOf(await req('/api/revoke', { method: 'POST', body: { devices: true } }));
  assert.equal(rev.devices, 1);
  assert.equal((await asDevice('/api/status')).status, 401, 'ingetrokken code geeft geen toegang');
  assert.equal((await req('/api/status')).status, 200);
  // Een verlopen code werkt niet
  const kort = await jsonOf(await req('/api/sessions', { method: 'POST', body: { label: 'Kort', days: 1 } }));
  const ses = JSON.parse(kv('sessions'));
  ses[0].until = '2020-01-01T00:00:00';
  setKv('sessions', ses);
  assert.equal((await req('/api/status', { headers: { Authorization: 'Bearer ' + kort.session } })).status, 401, 'verlopen');
  setKv('sessions', '[]');
});

await test('deel-link met einddatum, en alle links intrekken', async () => {
  const on = await jsonOf(await req('/api/share', { method: 'POST', body: { action: 'on', amounts: false, days: 7 } }));
  assert.ok(on.until && on.until > '2026-', 'einddatum ingesteld: ' + on.until);
  assert.equal((await W.fetch(new Request('https://worker.test/share/' + on.token), env)).status, 200);
  // Verlopen: de link geeft 410 met uitleg
  const c = JSON.parse(kv('share'));
  c.until = '2020-01-01T00:00:00';
  setKv('share', c);
  const gone = await W.fetch(new Request('https://worker.test/share/' + on.token), env);
  assert.equal(gone.status, 410);
  assert.match((await jsonOf(gone)).error, /verlopen/);
  // Einddatum weghalen en daarna alles intrekken (deel-link én agenda-link)
  await req('/api/share', { method: 'POST', body: { action: 'update', days: 0 } });
  assert.equal(JSON.parse(kv('share')).until, null);
  await req('/api/calendar', { method: 'POST', body: {} });
  assert.ok(kv('cal_token'), 'agenda-link bestaat');
  const rev = await jsonOf(await req('/api/revoke', { method: 'POST', body: { links: true } }));
  assert.deepEqual(rev.links, ['deel-link', 'agenda-link']);
  assert.equal((await W.fetch(new Request('https://worker.test/share/' + on.token), env)).status, 404);
  assert.equal((await W.fetch(new Request('https://worker.test/cal/' + 'x'.repeat(24) + '.ics'), env)).status, 404);
});

await test('gedeelde weergave laat niets persoonlijks zien', async () => {
  routes = t212Routes();
  await req('/api/keys', { method: 'POST', body: { name: 'SEC_CONTACT', value: 'prive@voorbeeld.nl' } });
  await req('/api/settings', { method: 'POST', body: {
    notes: { 'AAPL|1767348000000': 'Geheime notitie' },
    accounts: [{ name: 'Pensioenrekening', cash: 10, holdings: [{ name: 'IWDA', value: 5 }] }],
    prefs: { watchMeta: { AAPL: { note: 'Prive gedachte' } } },
    priceAlerts: [{ id: 'a1', sym: 'AAPL', op: 'above', price: 999 }],
  } });
  const on = await jsonOf(await req('/api/share', { method: 'POST', body: { action: 'on', amounts: false } }));
  const pub = await W.fetch(new Request('https://worker.test/share/' + on.token), env);
  const text = await pub.clone().text();
  const d = await jsonOf(pub);
  ['Geheime notitie', 'Pensioenrekening', 'Prive gedachte', 'prive@voorbeeld.nl', TOKEN, env.T212_KEY, env.T212_SECRET, on.token]
    .forEach((x) => assert.ok(!text.includes(x), 'staat niet in de gedeelde kopie: ' + x));
  ['notes', 'accounts', 'prefs', 'priceAlerts', 'alerts', 'goals', 'tradeLimits'].forEach((k) => assert.ok(!(k in d.settings), 'settings.' + k + ' gaat niet mee'));
  assert.ok(!('keys' in d.features), 'geen sleutelstatus');
  assert.ok(!('pies' in (d.ext2 || {})), 'geen pies met eigen namen');
  assert.ok(!('audit' in d) && !('log' in d) && !('status' in d) && !('sessions' in d), 'geen logboeken');
  // Bedragen zijn geschaald: het vrije saldo van 80 euro is niet te zien
  assert.ok(!d.cashNow || Math.round(d.cashNow.cash) !== 80, 'vrij saldo geschaald: ' + JSON.stringify(d.cashNow));
  // Wat de gedeelde weergave wel nodig heeft, zit er nog in
  ['weeks', 'positions', 'today', 'orders', 'intraday', 'days'].forEach((k) => assert.ok(d[k], k + ' hoort er wel in te zitten'));
  await req('/api/share', { method: 'POST', body: { action: 'off' } });
  await req('/api/keys', { method: 'POST', body: { name: 'SEC_CONTACT', value: '' } });
});

await test('vergelijken met een gedeelde link: alleen percentages', async () => {
  const weeks = [
    { date: '2026-01-02T00:00:00', accountValue: 8000, netDeposits: 8000, weekResultPct: 0, totalResultPct: 0 },
    { date: '2026-10-30T00:00:00', accountValue: 9500, netDeposits: 8500, weekResultPct: 0.004, totalResultPct: 0.1176 },
    { date: '2026-11-13T00:00:00', accountValue: 12345.67, netDeposits: 9000, weekResultPct: 0.0123, totalResultPct: 0.3717 },
  ];
  routes = [[/vriend\.test\/share\//, reply({ ok: true, generated: '2026-11-17T12:00:00', weeks, shared: { amounts: true, since: '2026-02-01T00:00:00' } })]];
  const r = await jsonOf(await req('/api/friend', { method: 'POST', body: { url: 'https://vriend.test/share/' + 'a'.repeat(24) } }));
  assert.equal(r.pct.week, 0.0123);
  assert.equal(r.pct.total, 0.3717);
  assert.ok(r.pct.ytd > 0.4 && r.pct.ytd < 0.5, 'dit jaar: ' + r.pct.ytd);
  assert.ok(!JSON.stringify(r).includes('12345'), 'geen bedragen in het antwoord');
  const bad = await req('/api/friend', { method: 'POST', body: { url: 'https://vriend.test/api/data' } });
  assert.equal(bad.status, 400);
  assert.match((await jsonOf(bad)).error, /deel-link/);
  routes = [[/vriend\.test/, reply({ ok: false }, 404)]];
  assert.equal((await req('/api/friend', { method: 'POST', body: { url: 'https://vriend.test/share/' + 'b'.repeat(24) } })).status, 400);
});

await test('logboek: sleutels, inloggen, orders en links, zonder waarden', async () => {
  setKv('audit', '[]');
  routes = t212Routes();
  await req('/api/keys', { method: 'POST', body: { name: 'FMP_KEY', value: 'geheim-fmp-1234' } });
  await req('/api/login', { method: 'POST', body: { key: 'fout-fout-fout', secret: 'fout-fout-fout' } });
  await req('/api/share', { method: 'POST', body: { action: 'on', amounts: false } });
  await req('/api/share', { method: 'POST', body: { action: 'off' } });
  const log = (await jsonOf(await req('/api/audit'))).log;
  const kinds = log.map((x) => x.kind);
  ['sleutel', 'inloggen', 'link'].forEach((k) => assert.ok(kinds.includes(k), 'logboek bevat ' + k + ': ' + JSON.stringify(kinds)));
  assert.ok(!JSON.stringify(log).includes('geheim-fmp-1234'), 'de sleutel zelf staat niet in het logboek');
  assert.ok(log[0].at && log[0].msg, 'tijd en beschrijving');
  await req('/api/keys', { method: 'POST', body: { name: 'FMP_KEY', value: '' } });
});

await test('inloggen geeft dit apparaat zijn eigen code', async () => {
  setKv('sessions', '[]');
  routes = t212Routes();
  const r = await jsonOf(await req('/api/login', { method: 'POST', body: { key: env.T212_KEY, secret: env.T212_SECRET, label: 'Mac' } }));
  assert.equal(r.token, TOKEN, 'oude versies van de site blijven werken');
  assert.ok(r.session && r.session !== TOKEN, 'en er komt een eigen code voor dit apparaat bij');
  assert.equal(r.device.label, 'Mac');
  assert.equal((await req('/api/status', { headers: { Authorization: 'Bearer ' + r.session } })).status, 200);
  setKv('sessions', '[]');
});

await test('onderzoek per aandeel: part=research&tk= geeft alleen dat aandeel, met ETag', async () => {
  routes = t212Routes();
  setKv('rs_AAPL', { prof: { name: 'Apple', sector: 'Technology' }, target: { mean: 260 } });
  setKv('fin_AAPL', { pe: 30 });
  setKv('rs_MSFT', { prof: { name: 'Microsoft' }, target: { mean: 500 } });
  await req('/api/run', { method: 'POST' });
  const r = await req('/api/data?part=research&tk=AAPL');
  assert.equal(r.status, 200);
  const tag = r.headers.get('ETag');
  assert.ok(tag, 'ETag ontbreekt');
  const j = await jsonOf(r.clone());
  assert.equal(j.part, 'research');
  assert.equal(j.tk, 'AAPL');
  assert.equal(j.research.target.mean, 260);
  assert.equal(j.fin.pe, 30);
  assert.ok(!JSON.stringify(j).includes('Microsoft'), 'alleen het gevraagde aandeel');
  const whole = await (await req('/api/data?part=extra')).text();
  const one = await r.text();
  assert.ok(one.length < whole.length, 'kleiner dan het hele extra-deel');
  // Onveranderd: 304
  const again = await req('/api/data?part=research&tk=AAPL', { headers: { 'If-None-Match': tag } });
  assert.equal(again.status, 304);
  // Onbekend aandeel: leeg, geen fout
  const none = await jsonOf(await req('/api/data?part=research&tk=TSLA'));
  assert.equal(none.ok, true);
  assert.equal(none.research, null);
  // Zonder of met een onmogelijke ticker: nette fout
  assert.equal((await req('/api/data?part=research')).status, 400);
  assert.equal((await req('/api/data?part=research&tk=' + encodeURIComponent('a b'))).status, 400);
});

await test('agenda, orders en peildatum zitten in het extra-deel, niet in core', async () => {
  routes = t212Routes();
  setKv('events', { updated: '2026-11-18T10:00:00', earnings: [{ tk: 'AAPL', date: '2026-12-01' }], dividends: [], received: [], lastEarnings: [], errors: [] });
  setKv('peil_2026', { date: '2026-01-01', total: 1000, investments: 900, cash: 100, positions: [] });
  await req('/api/run', { method: 'POST' });
  const core = await jsonOf(await req('/api/data?part=core&split=1'));
  const extra = await jsonOf(await req('/api/data?part=extra'));
  assert.equal(core.events, undefined, 'events hoort niet meer in core');
  assert.equal(core.orders, undefined, 'orders hoort niet meer in core');
  assert.equal(core.peil, undefined, 'peil hoort niet meer in core');
  assert.ok(extra.events && extra.events.earnings.length === 1, 'events in extra');
  assert.ok(extra.orders && Array.isArray(extra.orders.rows), 'orders in extra');
  assert.ok(extra.peil && extra.peil.length === 1, 'peil in extra');
  // De site plakt de delen aan elkaar; samen is alles er nog
  const all = Object.assign({}, extra, core);
  assert.ok(all.events && all.positions && all.weeks, 'samengevoegd is alles aanwezig');
  // Zonder part (oude versies van de site) blijft alles in één antwoord komen
  const whole = await jsonOf(await req('/api/data'));
  assert.ok(whole.events && whole.orders && whole.positions, 'alles samen zonder part');
});

await test('database: indexen op de tijdkolommen en de marktgegevens niet bij elke opbouw opnieuw lezen', async () => {
  const T = WM._test;
  await T.ensureMarketTables(env);
  setKv('index_v', '');
  await T.ensureIndexes(env);   // bij elk nieuw Worker-proces via ensureSchema, ook in een bestaande database
  const idx = DB.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
  ['idx_intraday_ts', 'idx_hours_hour', 'idx_days_day', 'idx_ext_prices_day'].forEach((n) => assert.ok(idx.includes(n), 'index ' + n));
  assert.equal(kv('index_v'), '2');
  // MAX(ts) en tijdvensters gebruiken de index in plaats van de hele tabel te lezen
  const plan = DB.db.prepare('EXPLAIN QUERY PLAN SELECT MAX(ts) AS ts FROM intraday').all().map((r) => r.detail).join(' ');
  assert.match(plan, /idx_intraday_ts|COVERING INDEX/i, plan);
  const plan2 = DB.db.prepare('EXPLAIN QUERY PLAN SELECT hour FROM hours WHERE hour >= ?').all(0).map((r) => r.detail).join(' ');
  assert.match(plan2, /idx_hours_hour/, plan2);
  // Opbouw met een teller op de SQL: de tweede keer wordt ext_prices niet gelezen, na nieuwe koersen wel
  const seen = [];
  const e = Object.create(env);
  e.DB = { prepare: (sql) => { seen.push(sql); return DB.prepare(sql); }, batch: (l) => DB.batch(l), exec: (x) => DB.exec(x) };
  setKv('market_cache', '');
  const reads = () => seen.filter((q) => /FROM ext_prices/.test(q)).length;
  await T.buildData(e);
  assert.ok(reads() >= 1, 'eerste opbouw leest de koersen');
  seen.length = 0;
  await T.buildData(e);
  assert.equal(reads(), 0, 'tweede opbouw gebruikt de bewaarde marktgegevens');
  assert.equal(seen.filter((q) => /FROM days GROUP BY/.test(q)).length, 0, 'geen GROUP BY over de hele dagtabel');
  assert.ok(seen.filter((q) => /FROM days/.test(q)).length <= 1, 'dagtabel hooguit één keer');
  await T.bumpMarket(env);
  seen.length = 0;
  await T.buildData(e);
  assert.ok(reads() >= 1, 'na nieuwe koersen opnieuw opbouwen');
  // Status: de tellingen per tabel komen uit de bewaarde telling, niet uit COUNT(*) per bezoek
  await T.dbWatch(env, false, true);
  seen.length = 0;
  await T.dbWatch(e, false);
  assert.equal(seen.filter((q) => /COUNT\(\*\)/.test(q)).length, 0, 'statuspagina telt niet opnieuw');
});

await test('Cloudflare-limieten: gelezen en geschreven D1-rijen tellen mee in het budget', async () => {
  const T = WM._test;
  setKv('cf_usage', '');
  const stmt = { bind() { return stmt; }, all: async () => ({ results: [{ n: 4 }], meta: { rows_read: 7, rows_written: 0 } }), run: async () => ({ meta: { rows_read: 1, rows_written: 2 } }) };
  const fake = { prepare: () => stmt, batch: async (l) => l.map(() => ({ meta: { rows_read: 3, rows_written: 1 } })) };
  const c = T.countingDb(fake);
  assert.equal(await c.prepare('SELECT n').first('n'), 4, 'first() geeft dezelfde waarde terug');
  assert.deepEqual(await c.prepare('SELECT n').first(), { n: 4 });
  await c.prepare('INSERT').bind(1).run();
  await c.batch([c.prepare('a'), c.prepare('b')]);
  await T.flushCalls(env);
  const u = JSON.parse(kv('cf_usage'));
  assert.equal(u.d1_read, 7 + 7 + 1 + 6);
  assert.equal(u.d1_write, 2 + 2);
  const b = await T.budgetInfo(env);
  const r = b.cloudflare.find((x) => x.src === 'd1_read');
  assert.equal(r.used, 21);
  assert.equal(r.limit, 5e6);
  assert.ok(r.pct > 0 && r.pct < 0.001);
  // De instellingen krijgen het budget mee
  const f = await jsonOf(await req('/api/features', { method: 'GET' }));
  assert.ok(f.features.budgets && Array.isArray(f.features.budgets.cloudflare), 'budget in /api/features');
});

await test('reserves bij een limiet: minuutlimiet kort, vergelijkbare bedrijven en zoeken via een andere bron', async () => {
  const T = WM._test;
  // Finnhub: limiet per minuut -> 10 minuten pauze; na drie keer op rij tot middernacht
  setKv('src_health', {});
  await T.srcFail(env, 'finnhub', 'Finnhub-limiet', true);
  let st = JSON.parse(kv('src_health')).finnhub;
  assert.equal(st.minute, true);
  assert.ok(st.until - Date.now() <= 10 * 60e3 + 1000 && st.until > Date.now(), 'korte pauze');
  await T.srcFail(env, 'finnhub', 'Finnhub-limiet', true);
  await T.srcFail(env, 'finnhub', 'Finnhub-limiet', true);
  st = JSON.parse(kv('src_health')).finnhub;
  assert.equal(st.minute, false, 'derde keer: rest van de dag');
  assert.ok(st.until - Date.now() > 10 * 60e3 || new Date().getUTCHours() === 23, 'tot middernacht');
  // Een daglimiet (FMP) gaat meteen tot middernacht
  await T.srcFail(env, 'fmp', 'FMP-limiet', true);
  assert.notEqual(JSON.parse(kv('src_health')).fmp.minute, true);

  // Vergelijkbare bedrijven: FMP aan zijn limiet -> Finnhub stock/peers
  setKv('src_health', { fmp: { fails: 1, until: Date.now() + 3600e3, minute: false } });
  setKv('mkt_queue', ['peers:AAPL']);
  setKv('market_schema', '');
  routes = [[/finnhub\.io\/api\/v1\/stock\/peers/, reply(['AAPL', 'MSFT', 'GOOGL', 'DELL', 'HPQ.DE'])], [/./, reply({}, 404)]];
  const e2 = Object.assign(Object.create(env), { FMP_KEY: 'fmp', FINNHUB_KEY: 'fh' });
  await req('/api/market', { method: 'POST', env: e2 });
  const pr = DB.db.prepare('SELECT peers FROM ext_peers WHERE symbol = ?').get('AAPL');
  assert.ok(pr, 'peers bewaard');
  assert.deepEqual(JSON.parse(pr.peers), ['MSFT', 'GOOGL', 'DELL'], 'zonder zichzelf en zonder buitenlandse notering');
  assert.match(JSON.parse(kv('src_health')).fmp.backup, /Finnhub/);

  // Zoeken: geen Finnhub -> Twelve Data
  setKv('companies', []);
  routes = [[/api\.twelvedata\.com\/symbol_search/, reply({ data: [{ symbol: 'ZEDX', instrument_name: 'Zed Corp', exchange: 'NASDAQ', instrument_type: 'Common Stock' }, { symbol: 'ZEDW', instrument_name: 'Zed Warrant', exchange: 'NASDAQ', instrument_type: 'Warrant' }] })]];
  const e3 = Object.assign(Object.create(env), { TWELVEDATA_KEY: 'td' });
  const found = await T.searchCompanies(e3, 'zed');
  assert.ok(found.some((x) => x.sym === 'ZEDX' && x.src === 'Twelve Data'), JSON.stringify(found));
  assert.ok(!found.some((x) => x.sym === 'ZEDW'), 'geen warrants');
  routes = [];
  setKv('src_health', {});
});

await test('spaarstand bij de D1-daglimiet en antwoorden zonder de gegevens te lezen', async () => {
  const T = WM._test;
  const day = new Date().toISOString().slice(0, 10);
  // Waarschuwing bij 70%: één keer per dag genoteerd
  setKv('cf_usage', { day, d1_read: 3.6e6 });
  const fake = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [], meta: { rows_read: 1 } }), run: async () => ({ meta: {} }) }), batch: async () => [] };
  await T.countingDb(fake).prepare('x').all();
  await T.flushCalls(env);
  assert.equal(JSON.parse(kv('cf_usage')).noted, 'warn');
  assert.equal(await T.saveMode(env), false, 'bij 72% nog geen spaarstand');
  // Spaarstand vanaf 85%: opbouwen hoogstens eens per half uur
  setKv('cf_usage', { day, d1_read: 4.4e6 });
  assert.equal(await T.saveMode(env), true);
  const tags = JSON.parse(kv('data_etags') || '{}');
  setKv('data_etags', Object.assign({}, tags, { at: Date.now() - 10 * 60e3 }));
  assert.equal(await T.buildAllowed(env), false, '10 minuten na de vorige opbouw: wachten');
  setKv('data_etags', Object.assign({}, tags, { at: Date.now() - 31 * 60e3 }));
  assert.equal(await T.buildAllowed(env), true, 'na een half uur wel');
  // Een cf_usage van gisteren telt niet
  setKv('cf_usage', { day: '2000-01-01', d1_read: 4.9e6 });
  assert.equal(await T.saveMode(env), false);

  // /api/data met If-None-Match: 304 zonder data_core, data_extra en data_series te lezen
  setKv('cf_usage', { day, d1_read: 4.4e6 });
  const r1 = await req('/api/data?part=core&split=1');
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('X-Tracker-Save'), '1', 'site hoort van de spaarstand');
  const tag = r1.headers.get('ETag');
  assert.ok(tag, 'ETag');
  const seen = [];
  const e = Object.create(env);
  e.DB = { prepare: (sql) => { seen.push(sql); return DB.prepare(sql); }, batch: (l) => DB.batch(l), exec: (x) => DB.exec(x) };
  const r2 = await req('/api/data?part=core&split=1', { headers: { 'If-None-Match': tag }, env: e });
  assert.equal(r2.status, 304);
  const dataReads = seen.filter((q) => /SELECT value FROM kv/.test(q)).length;
  assert.ok(dataReads <= 3, 'hooguit vingerafdrukken, spaarstand en schema gelezen (' + dataReads + ')');
  setKv('cf_usage', {});
});

await test('trend van het D1-gebruik: 14 dagen bewaard, groei en dagen tot de limiet', async () => {
  const T = WM._test;
  const hist = {};
  for (let i = 0; i < 7; i++) hist['2026-11-0' + (i + 1)] = { d1_read: 1e6 + i * 5e5, d1_write: 100, worker_req: 50 };
  const t = T.cfTrend({ hist });
  assert.equal(t.days.length, 7);
  assert.equal(Math.round(t.growth), 5e5, 'groei per dag');
  assert.equal(t.daysToLimit, 2, '4 miljoen nu, 500.000 erbij per dag: over 2 dagen aan de 5 miljoen');
  const flat = T.cfTrend({ hist: Object.fromEntries(Object.keys(hist).map((k) => [k, { d1_read: 2e6 }])) });
  assert.equal(flat.daysToLimit, null, 'geen groei, geen voorspelling');
  // Een nieuwe UTC-dag: de vorige dag schuift in de geschiedenis, hoogstens 14 dagen
  const old = {}; for (let i = 1; i <= 20; i++) old['2026-10-' + String(i).padStart(2, '0')] = { d1_read: i };
  setKv('cf_usage', { day: '2026-10-21', d1_read: 777, hist: old });
  const fake = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [], meta: { rows_read: 1 } }), run: async () => ({ meta: {} }) }), batch: async () => [] };
  await T.countingDb(fake).prepare('x').all();
  await T.flushCalls(env);
  const u = JSON.parse(kv('cf_usage'));
  assert.equal(u.day, new Date().toISOString().slice(0, 10));
  assert.equal(u.hist['2026-10-21'].d1_read, 777, 'vorige dag bewaard');
  assert.equal(Object.keys(u.hist).length, 14, 'hoogstens 14 dagen');
  const b = await T.budgetInfo(env);
  assert.ok(b.trend && b.trend.days.length === 14, 'trend in het budget voor de site');
  setKv('cf_usage', {});
});

// ---------- Volle tabelscans (D1 telt elke doorlopen rij mee voor de daglimiet) ----------
// Elke vaste query in de Worker gaat door de query-planner van SQLite. Leest hij een hele groeiende tabel, dan
// faalt deze test, tenzij de query hieronder staat met de reden waarom dat geen kwaad kan (zelden, of een kleine tabel).
const BIG_TABLES = ['intraday', 'hours', 'days', 'ext_prices', 'ext_perf', 'news_hist'];
const SCAN_OK = {
  'SELECT day, ticker, open, close, low, high, avg, range, range_pct FROM days ORDER BY day': 'reekscache: hooguit eens per uur opnieuw (seriesRows)',
  'SELECT symbol, COUNT(*) AS n FROM ext_prices GROUP BY symbol': 'planMarket: eens per dag, en maar één keer per planning',
  "SELECT DISTINCT day FROM ext_perf WHERE kind = 'sector'": 'planMarket: eens per dag; ext_perf heeft een tiental rijen per dag',
  "SELECT day, kind, name, exchange, change FROM ext_perf WHERE name != '-' ORDER BY day": 'marketData: alleen bij nieuwe marktgegevens (marketDataCached)',
  'SELECT COUNT(*) AS n FROM news_hist': 'dbWatch: eens per dag (de status- en bronnenpagina gebruiken de bewaarde telling)',
  "SELECT SUM(LENGTH(tk) + LENGTH(headline) + LENGTH(IFNULL(source, '')) + LENGTH(url) + LENGTH(IFNULL(summary, '')) + 24) AS n FROM news_hist": 'dbWatch: eens per dag',
  'DELETE FROM news_hist WHERE t < (SELECT t FROM news_hist ORDER BY t DESC LIMIT 1 OFFSET ?)': 'dbWatch: eens per dag, alleen boven het maximum',
};
await test('geen volle tabelscans op groeiende tabellen (behalve de bekende, zeldzame)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const sqls = new Set();
  // Elke tekst in de broncode die met SELECT, DELETE of UPDATE begint (ook als hij via een hulpfunctie naar prepare gaat)
  for (const m of src.matchAll(/(['"`])((?:SELECT|DELETE|UPDATE) (?:\\.|(?!\1)[^\n])*?)\1/g)) {
    const q = m[2].replace(/\\\\/g, '\\').replace(/\\'/g, "'");
    if (!q.includes('${') && /\b(FROM|SET)\b/.test(q)) sqls.add(q.replace(/\s+/g, ' ').trim());
  }
  assert.ok(sqls.size > 40, 'genoeg queries gevonden: ' + sqls.size);
  const bad = [], skipped = [];
  for (const q of sqls) {
    const args = (q.match(/\?/g) || []).map(() => null);
    let plan;
    try { plan = DB.db.prepare('EXPLAIN QUERY PLAN ' + q).all(...args); } catch (e) { skipped.push(q.slice(0, 60) + ' (' + e.message + ')'); continue; }
    const scans = plan.map((p) => /^SCAN (\w+)/.exec(p.detail || '')).filter(Boolean).map((m) => m[1]).filter((t) => BIG_TABLES.includes(t));
    if (scans.length && !SCAN_OK[q]) bad.push('[' + scans.join(', ') + '] ' + q);
  }
  // De testhulp toont maar vier regels van een fout: de volledige lijst daarom hier
  if (bad.length) console.log('       volle scans:\n         ' + bad.join('\n         '));
  if (process.env.SCAN_DEBUG) console.log('       queries: ' + sqls.size + ', overgeslagen: ' + skipped.length);
  if (skipped.length && process.env.SCAN_DEBUG) console.log('       overgeslagen:\n         ' + skipped.join('\n         '));
  assert.equal(bad.length, 0, 'volle tabelscan(s); voeg een index toe of zet de query met een reden in SCAN_OK:\n         ' + bad.join('\n         '));
});

// ---------- Vijf jaar aan gegevens: hoeveel rijen leest de Worker per ronde, en past alles in een D1-rij? ----------
// Met een bijna lege database valt een dure query niet op. Deze test vult de database zoals na vijf jaar met 30
// posities (met echte, lange namen) en 1500 orders, en meet (via rows_read, zoals D1 telt) wat een gewone ronde, een
// ronde met samenvatten en een ververs-vraag kosten. Ook mag geen enkele kv-regel groter zijn dan D1 toestaat (2 MB).
const ROUND_MAX = 3000;          // gewone ronde van 10 minuten (vijf jaar, 30 posities)
const HOURLY_MAX = 5000;         // ronde waarin het afgelopen uur wordt samengevat (de opbouw leest geen geschiedenis meer)
const RARE_MAX = 150000;         // zelden: alle jaren dagen opnieuw (splitsing, import, jaarwisseling)
const DAY_BUDGET = 4e5;          // geschat per dag: 8% van de gratis 5 miljoen
const FULL_MAX = 80000;          // een nieuw apparaat haalt één keer alle reeksen op
await test('vijf jaar, 30 posities: een ronde blijft ruim binnen de D1-daglimiet en elke kv-regel past', async () => {
  const T = WM._test;
  const HOUR = 3600e3, DAYMS = 864e5, YEARS = 5;
  const now = Date.now();
  const tks = Array.from({ length: 30 }, (_, i) => 'TK' + i);
  const NAMES = ['Taiwan Semiconductor Manufacturing Company Limited (ADR)', 'Alphabet Inc. Class A Common Stock', 'Vanguard S&P 500 UCITS ETF (USD) Accumulating',
    'iShares Core MSCI World UCITS ETF USD (Acc)', 'Berkshire Hathaway Inc. Class B', 'Novo Nordisk A/S (Sponsored ADR)'];
  const nameOf = (tk) => NAMES[Number(tk.slice(2)) % NAMES.length] + ' ' + tk;
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  DB.db.exec('BEGIN');
  const dIns = DB.db.prepare('INSERT OR REPLACE INTO days (day, ticker, name, open, close, low, high, avg, range, range_pct) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (let d = 1; d <= YEARS * 365; d++) { const t = now - d * DAYMS; const wd = new Date(t).getUTCDay(); if (wd === 0 || wd === 6) continue; tks.forEach((tk) => dIns.run(day(t), tk, nameOf(tk), 100, 101, 99, 102, 100, 3, 0.03)); }
  const hIns = DB.db.prepare('INSERT OR REPLACE INTO hours (hour, ticker, name, open, close, low, high, avg, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (let d = 1; d <= 60; d++) for (let h = 8; h <= 21; h++) { const t = Math.floor((now - d * DAYMS) / HOUR) * HOUR - (new Date(now).getUTCHours() - h) * HOUR; tks.forEach((tk) => hIns.run(t, tk, nameOf(tk), 1, 1, 1, 1, 1, 6, 1)); }
  const iIns = DB.db.prepare('INSERT OR REPLACE INTO intraday (ts, ticker, name, value, unrealized, price, qty) VALUES (?,?,?,?,?,?,?)');
  for (let k = 1; k <= 3 * 144; k++) { const t = Math.floor((now - k * 10 * 60e3) / 60000) * 60000; tks.forEach((tk) => iIns.run(t, tk, nameOf(tk), 100, 1, 10, 10)); }
  await T.ensureMarketTables(env);
  const pIns = DB.db.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)');
  for (let n = 0; n < 120; n++) for (let d = 1; d <= 390; d++) pIns.run('SYM' + n, day(now - d * DAYMS), 50);
  const fIns = DB.db.prepare('INSERT OR REPLACE INTO ext_perf (day, kind, name, exchange, change) VALUES (?,?,?,?,?)');
  for (let d = 1; d <= 380; d++) for (let n = 0; n < 11; n++) fIns.run(day(now - d * DAYMS), 'sector', 'Sector ' + n, 'NYSE', 0.1);
  try {
    const nIns = DB.db.prepare('INSERT OR IGNORE INTO news_hist (tk, t, headline, source, url, summary) VALUES (?,?,?,?,?,?)');
    for (let k = 0; k < 20000; k++) nIns.run(tks[k % 15], now - k * 1200e3, 'Kop ' + k, 'Test', 'https://nieuws.test/' + k, '');
  } catch (e) { /* geen nieuwsarchief in deze database */ }
  // 1500 orders verspreid over vijf jaar
  try {
    const oIns = DB.db.prepare('INSERT OR REPLACE INTO orders (id, ts, ticker, name, side, qty, price, currency, fx_rate, net, realised, fee_fx, fee_other, kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (let k = 0; k < 1500; k++) oIns.run('load-' + k, now - k * DAYMS * YEARS * 365 / 1500, tks[k % 30], nameOf(tks[k % 30]), k % 3 ? 'BUY' : 'SELL', 1.5, 100, 'USD', 1.08, 150, 0, 0.15, 0, 'TRADE');
  } catch (e) { /* geen orderstabel in deze database */ }
  DB.db.exec('COMMIT');
  setKv('orders_schema', '1');
  await T.invalidateOrders(env);
  await T.invalidateSeries(env);

  const measure = async (fn) => {
    setKv('cf_usage', {});
    MEASURE.on = true;
    try { await fn(); } finally { MEASURE.on = false; }
    await WM._test.flushCalls(env);
    const u = JSON.parse(kv('cf_usage') || '{}');
    WRITES.push(Number(u.d1_write) || 0);
    return Number(u.d1_read) || 0;
  };
  const WRITES = [];
  // Een tijdstip binnen de meettijden, zo dicht mogelijk bij nu
  let at = Math.floor(now / 600e3) * 600e3;
  // (met ruimte voor de rondes erna: alle vier binnen de meettijden)
  for (let i = 0; i < 1000 && !(T.isLive(new Date(at)) && T.isLive(new Date(at + 5 * 60e3))); i++) at -= 600e3;
  assert.ok(T.isLive(new Date(at)), 'meettijd gevonden');
  const round = async (t, hourly) => {
    setKv('hk_hour', hourly ? '' : String(T.hourStart(t)));
    const pending = [];
    await W.scheduled({ cron: '*/10 * * * *', scheduledTime: t }, env, { waitUntil: (p) => { pending.push(p); } });
    await Promise.all(pending);
  };
  routes = t212Routes();
  await round(at, false);                                   // eerste ronde: vult de caches
  const normal = await measure(() => round(at + 60e3, false));
  // Ronde waarin uren worden samengevat en de reekscache van dit jaar opnieuw wordt opgebouwd (eens per uur)
  const hourly = await measure(async () => { setKv('series_cache', ''); await round(at + 120e3, true); });
  // Zeldzaam: ook de dagen van eerdere jaren opnieuw (splitsing, naamswijziging, import, herstel, jaarwisseling)
  const rare = await measure(async () => { await WM._test.invalidateSeries(env); await round(at + 150e3, true); });
  if (process.env.LOAD_DEBUG) { MEASURE.log = []; MEASURE.on = true; await WM._test.invalidateSeries(env); await round(at + 180e3, true); MEASURE.on = false; console.log(MEASURE.log.sort((a, b) => b[0] - a[0]).slice(0, 15).map((x) => '         ' + x[0] + '  ' + x[1]).join('\n')); MEASURE.log = null; }
  // Ververs-vraag van de site: niets veranderd (If-None-Match) en "wat is er nieuw sinds"
  const r1 = await req('/api/data?part=core&split=1');
  const tag = r1.headers.get('ETag');
  const ser = await jsonOf(await req('/api/data?part=series'));
  const poll = await measure(async () => {
    await req('/api/data?part=core&split=1', { headers: { 'If-None-Match': tag } });
    await req('/api/data?part=series&since=' + ser.seriesTs);
  });
  // Een nieuw apparaat (of een gewist apparaat) haalt één keer alle reeksen op; een tweede apparaat daarna leest ze uit de cache
  await WM._test.invalidateSeries(env);
  const full1 = await measure(() => req('/api/data?part=series'));
  const full2 = await measure(() => req('/api/data?part=series'));
  console.log('       nieuw apparaat: alle reeksen ' + full1 + ' rijen, nog een apparaat ' + full2);
  assert.ok(full1 <= FULL_MAX, 'alle reeksen lazen ' + full1 + ' rijen (grens ' + FULL_MAX + ')');
  assert.ok(full2 <= 50, 'tweede keer uit de cache: ' + full2);
  // Per dag: 144 rondes, waarvan 24 met samenvatten, plus twee apparaten die elke 5 minuten verversen
  const perDay = 120 * normal + 24 * hourly + 2 * 288 * poll;
  console.log('       geschreven rijen: gewone ronde ' + WRITES[0] + ', met samenvatten ' + WRITES[1] + ', zelden ' + WRITES[2] + ', ververs-vraag ' + WRITES[3]);
  console.log('       gelezen rijen: gewone ronde ' + normal + ', met samenvatten ' + hourly + ', zelden (alle jaren) ' + rare + ', ververs-vraag ' + poll + '; geschat per dag ' + Math.round(perDay));
  assert.ok(rare <= RARE_MAX, 'ronde met alle jaren opnieuw las ' + rare + ' rijen (grens ' + RARE_MAX + ')');
  assert.ok(normal <= ROUND_MAX, 'gewone ronde las ' + normal + ' rijen (grens ' + ROUND_MAX + ')');
  assert.ok(hourly <= HOURLY_MAX, 'ronde met samenvatten las ' + hourly + ' rijen (grens ' + HOURLY_MAX + ')');
  assert.ok(perDay <= DAY_BUDGET, 'geschat per dag ' + Math.round(perDay) + ' rijen (grens ' + DAY_BUDGET + ')');
  // Geen enkele kv-regel groter dan D1 toestaat (2 MB per rij); grote waarden staan in stukken (setBig)
  const big = DB.db.prepare('SELECT key, LENGTH(CAST(value AS BLOB)) AS b FROM kv ORDER BY b DESC LIMIT 3').all();
  console.log('       grootste kv-regels: ' + big.map((r) => r.key + ' ' + Math.round(r.b / 1000) + ' kB').join(', '));
  assert.ok(big[0].b < 2e6, 'kv-regel ' + big[0].key + ' is ' + big[0].b + ' bytes (D1: hoogstens 2 MB per rij)');
  // Het overzicht voor de site komt heel terug, ook als het in stukken staat
  const full = await jsonOf(await req('/api/data?part=series'));
  assert.ok(full.days && full.days.rows.length >= YEARS * 250 * 30 * 0.9, 'alle dagen terug: ' + (full.days && full.days.rows.length));
  routes = [];
  setKv('cf_usage', {});
});

await test('grote waarde in stukken: de verwijzing bevat geen NUL-teken en komt heel terug', async () => {
  const T = WM._test;
  const v = JSON.stringify({ x: 'é'.repeat(2e6) });
  await T.setBig(env, 'test_groot', v);
  const mark = kv('test_groot');
  assert.match(mark, /^~stukken:\d+$/, 'de verwijzing overleeft elke SQLite-koppeling: ' + JSON.stringify(String(mark).slice(0, 20)));
  assert.equal(await T.getBig(env, 'test_groot'), v);
  await T.setBig(env, 'test_groot', '{"klein":1}');
  assert.equal(await T.getBig(env, 'test_groot'), '{"klein":1}');
  assert.equal(DB.db.prepare("SELECT COUNT(*) AS n FROM kv WHERE key LIKE 'test_groot#%'").get().n, 0, 'oude stukken opgeruimd');
  DB.db.prepare("DELETE FROM kv WHERE key = 'test_groot'").run();
});

await test('vandaag per positie: bijgehouden met alleen nieuwe metingen, ook als een meting vervangen wordt of de dag wisselt', async () => {
  const T = WM._test;
  const base = Date.UTC(2031, 0, 7, 10, 0);   // een dinsdag, na alle andere metingen in deze tests
  const ins = DB.db.prepare('INSERT OR REPLACE INTO intraday (ts, ticker, name, value, unrealized, price, qty) VALUES (?,?,?,?,?,?,?)');
  const put = (ts, v) => { ins.run(ts, 'ZZZ', 'Test', v, 1, v / 2, 2); ins.run(ts, 'TOTAAL', 'Totaal', v, 1, null, null); };
  setKv('today_state', '');
  put(base, 100);
  let st = await T.todayState(env);
  assert.equal(st.t.ZZZ.o, 100); assert.equal(st.pos.length, 1); assert.equal(st.pos[0].ticker, 'ZZZ');
  put(base + 600e3, 120);
  put(base + 1200e3, 110);
  st = await T.todayState(env);
  assert.deepEqual([st.t.ZZZ.o, st.t.ZZZ.l, st.t.ZZZ.h, st.t.ZZZ.c, st.t.ZZZ.n], [100, 100, 120, 110, 3]);
  assert.equal(st.t.ZZZ.s / st.t.ZZZ.n, 110, 'gemiddelde');
  // Dezelfde meting opnieuw (zelfde tijdstip, andere waarde): vervangen, niet dubbel geteld
  put(base + 1200e3, 80);
  st = await T.todayState(env);
  assert.deepEqual([st.t.ZZZ.l, st.t.ZZZ.c, st.t.ZZZ.n], [80, 80, 3]);
  assert.equal(st.t.ZZZ.s, 300);
  assert.equal(st.pos[0].value, 80, 'positie van de laatste meting');
  // Niets nieuw: niets schrijven
  const before = kv('today_state');
  await T.todayState(env);
  assert.equal(kv('today_state'), before);
  // Een nieuwe dag begint opnieuw
  put(base + 864e5, 90);
  st = await T.todayState(env);
  assert.deepEqual([st.t.ZZZ.o, st.t.ZZZ.l, st.t.ZZZ.h, st.t.ZZZ.n], [90, 90, 90, 1]);
  // Hetzelfde in het overzicht voor de site
  const data = await T.buildData(env);
  const z = data.today.find((r) => r.ticker === 'ZZZ');
  assert.equal(z.current, 90); assert.equal(z.open, 90);
  assert.equal(data.intraday, undefined, 'het overzicht heeft geen reeksen meer');
  // Na een splitsing of import (invalidateSeries) begint hij opnieuw
  await T.invalidateSeries(env);
  assert.equal(kv('today_state'), '');
  DB.db.prepare('DELETE FROM intraday WHERE ts >= ?').run(base);
  setKv('today_state', '');
});

await test('marktgegevens: na een marktstap alleen de koersen van de gewijzigde symbolen opnieuw lezen', async () => {
  const T = WM._test;
  await T.ensureMarketTables(env);
  setKv('market_schema', '1');
  const before = kv('settings');
  setKv('settings', Object.assign(JSON.parse(before || '{}'), { watchlist: ['MKA', 'MKB'] }));
  const ins = DB.db.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)');
  const day = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  for (let d = 1; d <= 300; d++) { ins.run('MKA', day(d), 10); ins.run('MKB', day(d), 20); }
  const ce = Object.create(env); ce.DB = T.countingDb(DB);   // telt de gelezen rijen zoals de Worker zelf
  const reads = async (fn) => { setKv('cf_usage', {}); MEASURE.on = true; let out; try { out = await fn(); } finally { MEASURE.on = false; } await T.flushCalls(env); return [out, Number(JSON.parse(kv('cf_usage') || '{}').d1_read) || 0]; };
  await T.bumpMarket(env);
  const [full, rFull] = await reads(() => T.marketDataCached(ce));
  assert.equal(full.prices.MKA.length, 300); assert.equal(full.prices.MKB.length, 300);
  // Een marktstap gaf MKA een nieuwe slotkoers
  ins.run('MKA', day(0), 11);
  await T.bumpMarket(env, ['MKA']);
  const [inc, rInc] = await reads(() => T.marketDataCached(ce));
  assert.equal(inc.prices.MKA.length, 301); assert.equal(inc.prices.MKA[300][1], 11, 'nieuwe koers van MKA');
  assert.equal(inc.prices.MKB.length, 300, 'MKB uit de vorige versie');
  console.log('       marktgegevens: alles ' + rFull + ' rijen, na een marktstap ' + rInc);
  assert.ok(rInc < rFull - 250, 'de koersen van MKB niet opnieuw gelezen (' + rInc + ' tegen ' + rFull + ')');
  // Een andere wijziging (zonder symbolen): alles opnieuw
  await T.bumpMarket(env);
  assert.equal(kv('mkt_px_dirty'), '"all"');
  const [, rAll] = await reads(() => T.marketDataCached(ce));
  assert.ok(rAll >= rFull - 5, 'alles opnieuw: ' + rAll);
  DB.db.prepare("DELETE FROM ext_prices WHERE symbol IN ('MKA', 'MKB')").run();
  if (before != null) setKv('settings', before);
  setKv('market_cache', '');
  setKv('cf_usage', {});
});

await test('officieel, geruchten en belangrijk nieuws: herkennen, bewaren en één melding per bericht', async () => {
  const T = WM._test;
  // Herkennen
  assert.equal(T.newsKind({ source: 'Business Wire', headline: 'Acme announces third quarter results' }), 'official');
  assert.equal(T.newsKind({ source: 'GlobeNewswire', headline: 'Acme to present at conference' }), 'official');
  assert.equal(T.newsKind({ source: 'Reuters', headline: 'Acme in talks to buy Beta, people familiar with the matter say' }), 'rumour');
  assert.equal(T.newsKind({ source: 'Bloomberg', headline: 'Acme reportedly weighs sale of cloud unit' }), 'rumour');
  assert.equal(T.newsKind({ source: 'Reuters', headline: 'Acme shares rise after strong demand' }), null);
  assert.equal(T.newsBreaking({ headline: 'Nvidia reinstated Jensen Huang as CEO after board review' }), true);
  assert.equal(T.newsBreaking({ headline: 'Acme files for Chapter 11 bankruptcy' }), true);
  assert.equal(T.newsBreaking({ headline: 'Acme shares rise after strong demand' }), false);
  // Elke ronde een paar aandelen; alleen officieel, gerucht of belangrijk komt in de lijst
  const at = Date.parse('2026-11-23T15:20:00Z'), sec = (ms) => Math.floor(ms / 1000);
  const NEWS = [
    { datetime: sec(at - 20 * 60e3), headline: 'Apple reinstates chief executive after board review', source: 'Reuters', url: 'https://n.test/1', summary: '' },
    { datetime: sec(at - 50 * 60e3), headline: 'Apple reportedly in talks to buy a chip designer', source: 'Bloomberg', url: 'https://n.test/2', summary: '' },
    { datetime: sec(at - 30 * 60e3), headline: 'Apple to present at investor conference', source: 'Business Wire', url: 'https://n.test/3', summary: '' },
    { datetime: sec(at - 40 * 60e3), headline: 'Apple shares edge higher', source: 'Reuters', url: 'https://n.test/4', summary: '' },
    { datetime: sec(at - 26 * 3600e3), headline: 'Apple CEO resigns', source: 'Reuters', url: 'https://n.test/5', summary: '' },
  ];
  const pushes = [];
  let asked = 0;
  routes = t212Routes().concat([[/finnhub\.io\/api\/v1\/company-news/, () => { asked++; return reply(NEWS); }],
    [/push\.test/, async (u, init) => { pushes.push(await decryptPush(init.body)); return reply('', 201); }]]);
  await req('/api/push/subscribe', { method: 'POST', body: { sub: { endpoint: 'https://push.test/news', keys: { p256dh: b64u(pubRaw), auth: b64u(sub.auth) } } } });
  setKv('news_flash', '');
  await req('/api/settings', { method: 'POST', body: { alerts: { move: 5, earnings: true, insider: true, drift: 5, news: 'all' } } });
  const fenv = Object.assign(Object.create(env), { FINNHUB_KEY: 'fh-test' });
  const calls = await T.newsWatch(fenv, at);
  assert.ok(calls >= 1 && asked === calls, 'Finnhub gevraagd: ' + asked);
  const fl = JSON.parse(kv('news_flash'));
  const urls = fl.items.map((x) => x.url).sort();
  assert.deepEqual(urls, ['https://n.test/1', 'https://n.test/2', 'https://n.test/3', 'https://n.test/5'], 'gewoon nieuws niet in de lijst');
  assert.equal(fl.items.find((x) => x.url === 'https://n.test/2').kind, 'rumour');
  assert.equal(fl.items.find((x) => x.url === 'https://n.test/3').kind, 'official');
  assert.equal(fl.items.find((x) => x.url === 'https://n.test/1').breaking, true);
  // Eén melding: het verse belangrijke bericht; het oude (26 uur) en de niet-belangrijke niet
  // (Elk aangemeld testapparaat krijgt dezelfde melding: tel unieke berichten)
  const uniq = () => [...new Map(pushes.filter((p) => /^news-/.test(p.tag || '')).map((p) => [p.body, p])).values()];
  const news = uniq();
  assert.equal(news.length, 1, JSON.stringify(pushes));
  assert.match(news[0].title, /belangrijk nieuws/);
  assert.match(news[0].body, /reinstates/);
  // Nog een ronde: dezelfde berichten geven geen tweede melding
  await T.newsWatch(fenv, at + 600e3);
  assert.equal(uniq().length, 1);
  // Alleen officieel: een vers belangrijk gerucht geeft geen melding
  await req('/api/settings', { method: 'POST', body: { alerts: { move: 5, earnings: true, insider: true, drift: 5, news: 'official' } } });
  NEWS.push({ datetime: sec(at), headline: 'Apple reportedly plans takeover of a streaming firm', source: 'Bloomberg', url: 'https://n.test/6', summary: '' });
  await T.newsWatch(fenv, at + 1200e3);
  assert.equal(uniq().length, 1, 'gerucht niet gemeld bij "alleen officieel"');
  assert.ok(JSON.parse(kv('news_flash')).items.some((x) => x.url === 'https://n.test/6'), 'wel in de lijst');
  // De site krijgt de lijst mee
  const data = await T.buildData(env);
  assert.ok(Array.isArray(data.newsFlash) && data.newsFlash.length >= 5);
  await req('/api/settings', { method: 'POST', body: { alerts: { move: 5, earnings: true, insider: true, drift: 5, news: 'all' } } });
  setKv('news_flash', '');
  routes = [];
});

console.log((failed ? failed + ' fout, ' : '') + passed + ' geslaagd');
process.exit(failed ? 1 : 0);
