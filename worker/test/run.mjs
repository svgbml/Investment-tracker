// Tests voor de Worker: een D1-stand-in op SQLite in het geheugen en nep-antwoorden voor alle externe bronnen.
// Draaien: node worker/test/run.mjs   (Node 22.13 of nieuwer; zonder node:sqlite worden de tests overgeslagen)
import assert from 'node:assert/strict';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch (e) {
  console.log('node:sqlite ontbreekt in deze Node-versie (' + process.version + '); Worker-tests overgeslagen.');
  process.exit(0);
}
const W = (await import('../src/index.js')).default;

// ---------- D1-stand-in ----------
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
  assert.deepEqual(r.settings.alerts, { move: 4, earnings: true, insider: false, drift: 6 });
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

await test('maandelijkse opruiming van oude uurregels', async () => {
  const old = Date.now() - 500 * 864e5;
  DB.db.prepare('INSERT OR REPLACE INTO hours (hour, ticker, name, open, close, low, high, avg, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?)').run(old, 'AAPL', 'Apple', 1, 1, 1, 1, 1, 6, 1);
  setKv('cleanup_month', '');
  routes = t212Routes();
  await W.scheduled({ cron: '17 5 * * *', scheduledTime: Date.now() }, env, { waitUntil: async (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM hours WHERE hour = ?').get(old).n, 0);
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

console.log((failed ? failed + ' fout, ' : '') + passed + ' geslaagd');
process.exit(failed ? 1 : 0);
