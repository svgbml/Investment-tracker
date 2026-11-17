/**
 * Investeringstracker – Cloudflare Worker (versie zonder Google Sheets)
 *
 * Wat hij doet:
 *  - Elke 10 minuten op werkdagen 08:00–22:30 (Amsterdam): posities ophalen uit de Trading 212 API
 *    en opslaan in de tabel `intraday` (plus een regel TOTAAL).
 *  - Eén keer per uur: afgeronde uren samenvatten in `hours`, afgeronde dagen in `days`,
 *    en metingen ouder dan 3 dagen verwijderen (pas als hun uur in `hours` staat).
 *  - Zaterdag rond 09:00: weeksnapshot (accountwaarde, netto stortingen, cash, kostprijs, posities).
 *  - GET /api/data levert dezelfde JSON als de Apps Script-versie, zodat de website ongewijzigd werkt.
 *
 *  - Eén keer per dag (aparte cron): ontvangen dividenden uit Trading 212 en, als FMP_KEY is ingesteld,
 *    aankomende kwartaalcijfers en dividenden van Financial Modeling Prep (kv 'events').
 *
 * Nodig: alleen WEB_TOKEN als geheim bij Cloudflare. De Trading 212-sleutel en de sleutels voor extra functies
 * (FMP_KEY, FINNHUB_KEY, SEC_CONTACT) kunnen ook als geheim bij Cloudflare staan, of via de website worden ingevuld
 * (Instellingen > Koppelingen); ze worden dan in de database van de Worker bewaard en nooit teruggestuurd.
 * De tabellen maakt de Worker zelf aan.
 */

const TZ = 'Europe/Amsterdam';
const LIVE_WEEKDAYS = [1, 2, 3, 4, 5];
const LIVE_START = '08:00';
const LIVE_END = '22:30';
const KEEP_INTRADAY_MS = 3 * 864e5;
const HOUR_MS = 3600e3;
const TOTAL = 'TOTAAL';
const EVENTS_CRON = '17 5 * * *';

// ---------- Verbruik per bron: elk extern verzoek telt mee (zie /api/status) ----------
// Deze functie overschaduwt de globale fetch binnen dit bestand; de echte staat in globalThis.fetch.
const CALL_COUNTS = new Map();
const CALL_HOSTS = [
  [/financialmodelingprep/, 'fmp'], [/finnhub/, 'finnhub'], [/alphavantage/, 'alphavantage'], [/twelvedata/, 'twelvedata'],
  [/sec\.gov/, 'sec'], [/stlouisfed/, 'fred'], [/frankfurter|ecb\.europa/, 'ecb'], [/eurostat/, 'eurostat'], [/trading212/, 't212'],
  [/ishares|blackrock/, 'ishares'], [/resend/, 'resend'],
];
function fetch(input, init) {
  try {
    const u = typeof input === 'string' ? input : (input && input.url) || '';
    const hit = CALL_HOSTS.find((h) => h[0].test(u));
    if (hit) CALL_COUNTS.set(hit[1], (CALL_COUNTS.get(hit[1]) || 0) + 1);
  } catch (e) { /* tellen is bijzaak */ }
  return globalThis.fetch(input, init);
}
// Schrijf de tellingen van deze aanroep weg (één schrijfactie), per dag, 14 dagen bewaard
async function flushCalls(env) {
  if (!CALL_COUNTS.size) return;
  const add = Object.fromEntries(CALL_COUNTS);
  CALL_COUNTS.clear();
  try {
    const day = parts(new Date()).day;
    let u = {};
    try { u = JSON.parse((await getKv(env, 'api_calls')) || '{}'); } catch (e) { u = {}; }
    const d = u[day] || {};
    Object.entries(add).forEach(([k, n]) => { d[k] = (d[k] || 0) + n; });
    u[day] = d;
    Object.keys(u).sort().slice(0, -14).forEach((k) => { delete u[k]; });
    await setKv(env, 'api_calls', JSON.stringify(u));
  } catch (e) { /* niet erg */ }
}
const FMP_BASE = 'https://financialmodelingprep.com/stable';
const ETF_RE = /\b(ETF|UCITS|iShares|Vanguard|SPDR|Xtrackers|Amundi|Invesco|WisdomTree|Lyxor)\b|\((Acc|Dist)\)/i;
// Trading 212-ticker -> beurssymbool bij FMP, waar die afwijken
const SYMBOL_MAP = { FB: 'META' };

export default {
  async scheduled(event, envIn, ctx) {
    await ensureSchema(envIn);
    const env = await withKeys(envIn);
    if (event.cron === EVENTS_CRON) {
      const fail = async (what, e) => {
        console.error(what, e);
        try { await setKv(env, 'last_error', new Date().toISOString() + ' ' + what + ': ' + String(e && e.message || e)); } catch (_) {}
      };
      ctx.waitUntil((async () => {
        if (env.T212_KEY && env.T212_SECRET) { try { await refreshEvents(env); } catch (e) { await fail('events', e); } }
        try { await planMarket(env); } catch (e) { await fail('plan', e); }
        try { await cleanupOld(env, new Date(event.scheduledTime)); } catch (e) { await fail('opruimen', e); }
        try { await alertEarnings(env); } catch (e) { await fail('meldingen', e); }
        try { await r2Backup(env, new Date(event.scheduledTime)); } catch (e) { await fail('reservekopie', e); }
        await flushCalls(env);
      })());
      return;
    }
    const at = new Date(event.scheduledTime);
    ctx.waitUntil(tick(env, at, false)
      .then(() => tickOk(env))
      .then(() => setKv(env, 'last_cron', new Date().toISOString()))
      .then(() => morningPush(env, at).catch((e) => console.error('ochtend', e)))
      .then(async () => {
        if (isLive(at)) return null;
        // Buiten de meettijden: eerst (1x per dag) de orders, anders een portie marktgegevens
        if (env.T212_KEY && (await getKv(env, 'orders_synced')) !== parts(at).day) return syncOrders(env);
        return marketStep(env);
      })
      .catch(async (e) => {
        console.error('tick', e);
        try { await setKv(env, 'last_error', new Date().toISOString() + ' ' + String(e && e.message || e)); } catch (_) {}
        try { await tickFailed(env, at, e); } catch (_) {}
      })
      .finally(() => flushCalls(env)));
  },

  async fetch(request, envIn) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, envIn);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    // Agenda-abonnement: eigen code in het adres (Google Agenda kan geen kopregels meesturen)
    const cal = /^\/cal\/([A-Za-z0-9_-]{20,80})\.ics$/.exec(url.pathname);
    if (cal && request.method === 'GET') {
      await ensureSchema(envIn);
      const want = (await getKv(envIn, 'cal_token')) || '';
      if (!want || !safeEqual(want, cal[1])) return new Response('Niet gevonden', { status: 404 });
      return new Response(await buildIcs(envIn), { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'max-age=3600' } });
    }
    const shr = /^\/share\/([A-Za-z0-9_-]{20,80})$/.exec(url.pathname);
    if (shr && request.method === 'GET') {
      await ensureSchema(envIn);
      const c = await shareConf(envIn);
      if (!c || !c.token || !safeEqual(c.token, shr[1])) return json({ ok: false, error: 'Deze deel-link werkt niet (meer).' }, 404, cors);
      let body = await getKv(envIn, 'data_share');
      if (!body) { await saveDataCache(envIn, await buildData(await withKeys(envIn))); body = await getKv(envIn, 'data_share'); }
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
    }
    if (!envIn.WEB_TOKEN) {
      return json({ ok: false, error: 'De Worker heeft nog geen WEB_TOKEN. Voeg die toe als geheim bij Cloudflare (Settings > Variables and Secrets).' }, 401, cors);
    }
    // Inloggen op een nieuw apparaat met de Trading 212-sleutel die al in deze Worker staat
    if (url.pathname === '/api/login' && request.method === 'POST') {
      try { return await loginWithT212(request, envIn, cors); }
      catch (err) { return json({ ok: false, error: String(err && err.message || err) }, 500, cors); }
    }

    if (!authorized(request, url, envIn)) {
      return json({ ok: false, error: 'Ongeldige of ontbrekende toegangscode.' }, 401, cors);
    }
    try {
      await ensureSchema(envIn);
      const env = await withKeys(envIn);
      if (url.pathname === '/api/calendar' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        let tok = await getKv(env, 'cal_token');
        if (!tok || (body && body.rotate)) {
          const bytes = crypto.getRandomValues(new Uint8Array(24));
          tok = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          await setKv(env, 'cal_token', tok);
        }
        if (body && body.off) { await setKv(env, 'cal_token', ''); return json({ ok: true, url: null }, 200, cors); }
        return json({ ok: true, url: url.origin + '/cal/' + tok + '.ics' }, 200, cors);
      }
      // Eigen adres onthouden (voor meldingen en de link in de weekmail)
      if (url.pathname === '/api/features' || url.pathname === '/api/push/subscribe') {
        if ((await getKv(env, 'self_origin')) !== url.origin) await setKv(env, 'self_origin', url.origin);
        // Adres van de website (voor de link in de weekmail), uit de Referer: alles tot en met de laatste /
        const base = /^https:\/\/[^/?#]+\/[^?#]*/.exec(request.headers.get('Referer') || '');
        const site = base ? base[0].replace(/[^/]*$/, '') : null;
        if (site && (await getKv(env, 'site_origin')) !== site) await setKv(env, 'site_origin', site);
      }
      if (url.pathname === '/api/status' && request.method === 'GET') {
        return json({ ok: true, status: await statusInfo(env, envIn) }, 200, cors);
      }
      if (url.pathname === '/api/backup' && request.method === 'GET') {
        return json(Object.assign({ ok: true }, await backupPart(env, url.searchParams.get('table'), url.searchParams.get('offset'))), 200, cors);
      }
      if (url.pathname === '/api/restore' && request.method === 'POST') {
        return json(Object.assign({ ok: true }, await restorePart(env, await request.json().catch(() => ({})))), 200, cors);
      }
      if (url.pathname === '/api/search' && request.method === 'GET') {
        const results = await searchCompanies(env, url.searchParams.get('q'), url);
        await flushCalls(env);
        return json({ ok: true, results }, 200, cors);
      }
      if (url.pathname === '/api/log' && request.method === 'POST') {
        return json({ ok: true, kept: await logSiteError(env, await request.json().catch(() => ({}))) }, 200, cors);
      }
      if (url.pathname === '/api/push/key' && request.method === 'GET') {
        return json({ ok: true, key: (await vapidKeys(env)).pub, devices: (await pushSubs(env)).length, rules: await alertRules(env) }, 200, cors);
      }
      if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const sub = b && b.sub;
        if (!sub || !/^https:\/\//.test(sub.endpoint || '') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ ok: false, error: 'Ongeldig abonnement.' }, 400, cors);
        const list = (await pushSubs(env)).filter((x) => x.endpoint !== sub.endpoint);
        list.push({ endpoint: String(sub.endpoint).slice(0, 600), keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 60) }, added: isoLocal(Date.now()), label: String((b && b.label) || '').slice(0, 60) });
        await setKv(env, 'push_subs', JSON.stringify(list.slice(-10)));
        return json({ ok: true, devices: Math.min(list.length, 10) }, 200, cors);
      }
      if (url.pathname === '/api/push/unsubscribe' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const list = (await pushSubs(env)).filter((x) => !b || !b.endpoint || x.endpoint !== b.endpoint);
        await setKv(env, 'push_subs', JSON.stringify(b && b.endpoint ? list : []));
        return json({ ok: true, devices: b && b.endpoint ? list.length : 0 }, 200, cors);
      }
      if (url.pathname === '/api/push/test' && request.method === 'POST') {
        const n = await sendPush(env, { title: 'Testmelding', body: 'Meldingen van je Investeringstracker werken.', url: '#overzicht', tag: 'test' });
        return json({ ok: true, sent: n }, 200, cors);
      }
      if (url.pathname === '/api/mail/test' && request.method === 'POST') {
        return json({ ok: true, message: await weeklyMail(env, true) }, 200, cors);
      }
      if (url.pathname === '/api/share' && request.method === 'GET') {
        const c = await shareConf(env);
        return json({ ok: true, on: !!(c && c.token), token: c && c.token, amounts: !!(c && c.amounts), since: c && c.since }, 200, cors);
      }
      if (url.pathname === '/api/share' && request.method === 'POST') {
        return json(Object.assign({ ok: true }, await shareAction(env, await request.json().catch(() => ({})))), 200, cors);
      }
      if (url.pathname === '/api/import-csv' && request.method === 'POST') {
        return json(Object.assign({ ok: true }, await importCsv(env, await request.json().catch(() => ({})))), 200, cors);
      }
      if (url.pathname === '/api/features' && request.method === 'GET') {
        return json({ ok: true, features: await featureStatus(env, envIn) }, 200, cors);
      }
      if (url.pathname === '/api/keys' && request.method === 'POST') {
        const body = await request.json();
        await saveKey(envIn, body && body.name, body && body.value);
        return json({ ok: true, features: await featureStatus(await withKeys(envIn), envIn) }, 200, cors);
      }
      if (url.pathname === '/api/features' && request.method === 'POST') {
        const body = await request.json();
        await saveSettings(env, { features: body && body.features });
        return json({ ok: true, features: await featureStatus(env, envIn) }, 200, cors);
      }
      if (url.pathname === '/api/data' && request.method === 'GET') {
        // Het overzicht wordt na elke meting opgebouwd en bewaard, in twee delen: 'core' (metingen, posities, weken;
        // verandert elke 10 minuten) en 'extra' (markt, onderzoek, koersen; verandert een paar keer per dag).
        // Met ?part=core of ?part=extra en If-None-Match geeft de Worker 304 als er niets veranderd is.
        const part = url.searchParams.get('part');
        const jh = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ...cors };
        // Alleen de reeksregels die na ?since= zijn bijgekomen (rechtstreeks uit de database)
        if (part === 'series' && url.searchParams.has('since')) {
          const d = await seriesDelta(env, url.searchParams.get('since'));
          if (d) return new Response(JSON.stringify(d), { status: 200, headers: jh });
        }
        let core = await getKv(env, 'data_core'), extra = await getKv(env, 'data_extra'), series = await getKv(env, 'data_series');
        if (!core || !extra || !series || url.searchParams.has('fresh')) {
          await saveDataCache(env, await buildData(env));
          core = await getKv(env, 'data_core'); extra = await getKv(env, 'data_extra'); series = await getKv(env, 'data_series');
        }
        const glue = (a, b) => a.slice(0, -1) + ',' + b.slice(1);
        // De site vanaf versie 38 vraagt core zonder reeksen (split=1); oudere versies krijgen core met reeksen
        const split = url.searchParams.get('split') === '1';
        if (part === 'core' || part === 'extra' || part === 'series') {
          let tags = {};
          try { tags = JSON.parse((await getKv(env, 'data_etags')) || '{}'); } catch (e) { tags = {}; }
          const tag = part === 'core' && !split ? (tags.core && tags.series ? '"' + tags.core.slice(1, 13) + tags.series.slice(1, 13) + '"' : null) : tags[part];
          const h = { ...jh, ...(tag ? { ETag: tag } : {}) };
          if (tag && request.headers.get('If-None-Match') === tag) return new Response(null, { status: 304, headers: h });
          const body = part === 'extra' ? extra : part === 'series' ? series : split ? core : glue(series, core);
          return new Response(body, { status: 200, headers: h });
        }
        // Zonder part (oudere versies van de site): alles samen
        return new Response(glue(glue(series, core), extra), { status: 200, headers: { ...jh, 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/api/run' && request.method === 'POST') {
        return json({ ok: true, message: await tick(env, new Date(), true) }, 200, cors);
      }
      if (url.pathname === '/api/snapshot' && request.method === 'POST') {
        return json({ ok: true, message: await weeklySnapshot(env, new Date(), true) }, 200, cors);
      }
      if (url.pathname === '/api/pending') {
        if (request.method === 'GET') return json({ ok: true, pending: await getPending(env) }, 200, cors);
        if (request.method === 'DELETE') { await setKv(env, 'pending', '[]'); return json({ ok: true }, 200, cors); }
        if (request.method === 'POST') {
          const body = await request.json();
          return json({ ok: true, pending: await addPending(env, Number(body.amount)) }, 200, cors);
        }
      }
      if (url.pathname === '/api/etf' && request.method === 'POST') {
        const errs = await refreshEtf(env);
        await saveDataCache(env, await buildData(env));
        return json({ ok: !errs.length, message: errs.length ? errs.join(' ') : 'Samenstelling van de fondsen bijgewerkt.' }, 200, cors);
      }
      if (url.pathname === '/api/etf-upload' && request.method === 'POST') {
        const body = await request.json();
        return json({ ok: true, message: await uploadEtf(env, body && body.key, body && body.csv) }, 200, cors);
      }
      if (url.pathname === '/api/orders' && request.method === 'POST') {
        return json({ ok: true, message: await syncOrders(env) }, 200, cors);
      }
      if (url.pathname === '/api/settings') {
        if (request.method === 'GET') return json({ ok: true, settings: await getSettings(env) }, 200, cors);
        if (request.method === 'POST') {
          const body = await request.json();
          const saved = await saveSettings(env, body);
          return json({ ok: true, settings: saved }, 200, cors);
        }
      }
      if (url.pathname === '/api/market' && request.method === 'POST') {
        // Eén stap per aanroep: Cloudflare staat 50 externe verzoeken per aanroep toe
        const msgs = [];
        if (url.searchParams.has('plan')) msgs.push(await planMarket(env));
        msgs.push(await marketStep(env));
        await flushCalls(env);
        return json({ ok: true, message: msgs.join(' ') }, 200, cors);
      }
      if (url.pathname === '/api/events' && request.method === 'POST') {
        return json({ ok: true, message: await refreshEvents(env) }, 200, cors);
      }
      if (url.pathname === '/api/import' && request.method === 'POST') {
        const body = await request.json();
        return json({ ok: true, imported: await importFromSheet(env, body.url, body.token) }, 200, cors);
      }
      return json({ ok: false, error: 'Onbekend adres.' }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: String(err && err.message || err) }, 500, cors);
    }
  },
};


// ---------- Opzet: tabellen, sleutels en functies ----------
const SCHEMA_SQL = `-- Database voor de Investeringstracker (Cloudflare D1)
CREATE TABLE IF NOT EXISTS intraday (
  ts INTEGER NOT NULL,          -- tijdstip in ms sinds 1970 (UTC)
  ticker TEXT NOT NULL,
  name TEXT,
  value REAL,                   -- waarde van de positie in EUR
  unrealized REAL,              -- ongerealiseerd resultaat in EUR
  price REAL,                   -- koers in de valuta van het instrument
  qty REAL,
  PRIMARY KEY (ts, ticker)
);
CREATE TABLE IF NOT EXISTS hours (
  hour INTEGER NOT NULL,        -- begin van het uur in ms sinds 1970 (UTC)
  ticker TEXT NOT NULL,
  name TEXT,
  open REAL, close REAL, low REAL, high REAL, avg REAL,
  n INTEGER,
  close_price REAL,
  PRIMARY KEY (hour, ticker)
);
CREATE TABLE IF NOT EXISTS days (
  day TEXT NOT NULL,            -- datum in Amsterdamse tijd, JJJJ-MM-DD
  ticker TEXT NOT NULL,
  name TEXT,
  open REAL, close REAL, low REAL, high REAL, avg REAL,
  range REAL, range_pct REAL,
  n INTEGER,
  close_price REAL,
  PRIMARY KEY (day, ticker)
);
CREATE TABLE IF NOT EXISTS weeks (
  date TEXT PRIMARY KEY,        -- datum van de snapshot, JJJJ-MM-DD
  account_value REAL,
  net_deposits REAL,
  cash REAL,
  cost_basis REAL,
  source TEXT
);
CREATE TABLE IF NOT EXISTS positions (
  date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT,
  value REAL,
  unrealized REAL,
  qty REAL,
  PRIMARY KEY (date, ticker)
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_intraday_ticker ON intraday (ticker, ts);
CREATE INDEX IF NOT EXISTS idx_hours_ticker ON hours (ticker, hour);
CREATE INDEX IF NOT EXISTS idx_days_ticker ON days (ticker, day);
`;
let schemaOk = false;

async function ensureSchema(env) {
  if (schemaOk) return;
  try { await env.DB.prepare('SELECT 1 FROM kv LIMIT 1').first(); schemaOk = true; return; } catch (e) { /* nog geen tabellen */ }
  const stmts = SCHEMA_SQL.split(';').map((x) => x.replace(/--[^\n]*/g, '').trim()).filter(Boolean);
  await env.DB.batch(stmts.map((x) => env.DB.prepare(x)));
  schemaOk = true;
}

// Sleutels die via de website zijn ingevuld; een geheim bij Cloudflare gaat altijd voor
const KEY_NAMES = ['T212_KEY', 'T212_SECRET', 'FMP_KEY', 'FINNHUB_KEY', 'SEC_CONTACT', 'FRED_KEY', 'ALPHAVANTAGE_KEY', 'RESEND_KEY', 'MAIL_TO', 'MAIL_FROM', 'TWELVEDATA_KEY'];

async function withKeys(env) {
  let stored = {};
  try { stored = JSON.parse((await getKv(env, 'keys')) || '{}'); } catch (e) { stored = {}; }
  const e = Object.create(env);
  KEY_NAMES.forEach((k) => { if (!env[k] && stored[k]) e[k] = stored[k]; });
  return e;
}

async function saveKey(env, name, value) {
  if (!KEY_NAMES.includes(name)) throw new Error('Onbekende sleutel.');
  if (env[name]) throw new Error(name + ' staat als geheim bij Cloudflare; pas hem daar aan.');
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length > 300) throw new Error('Deze waarde is te lang.');
  if (name === 'SEC_CONTACT' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('Vul een e-mailadres in; de SEC vraagt dat als contact.');
  let stored = {};
  try { stored = JSON.parse((await getKv(env, 'keys')) || '{}'); } catch (e) { stored = {}; }
  if (v) stored[name] = v; else delete stored[name];
  await setKv(env, 'keys', JSON.stringify(stored));
  // Nieuwe sleutel: de externe gegevens van vandaag opnieuw plannen
  await setKv(env, 'mkt_planned', '');
}

// weeklyMail staat standaard uit: het weekoverzicht per e-mail is optioneel
const FEATURE_DEFAULTS = { fx: true, inflation: true, sec: true, etfAuto: true, indices: true, weeklyMail: false };
async function featureFlags(env) {
  const s = await getSettings(env);
  return Object.assign({}, FEATURE_DEFAULTS, (s && s.features) || {});
}

async function featureStatus(env, raw) {
  const f = await featureFlags(env);
  let stored = {};
  try { stored = JSON.parse((await getKv(env, 'keys')) || '{}'); } catch (e) { stored = {}; }
  const where = (k) => (raw[k] ? 'cloudflare' : stored[k] ? 'site' : null);
  const errs = JSON.parse((await getKv(env, 'ext_errors')) || '{}');
  return {
    keys: Object.fromEntries(KEY_NAMES.map((k) => [k, where(k)])),
    flags: f,
    lastCron: await getKv(env, 'last_cron'),
    lastError: await getKv(env, 'last_error'),
    errors: errs,
    health: await srcState(env),
  };
}

// ---------- Bronstatus: na herhaalde fouten of een limiet tijdelijk naar een reservebron ----------
// kv 'src_health' = { bron: { fails, until (ms), msg, at, backup, backupAt } }
async function srcState(env) { try { return JSON.parse((await getKv(env, 'src_health')) || '{}'); } catch (e) { return {}; } }
async function srcDown(env, src) { const o = (await srcState(env))[src]; return !!(o && o.until && o.until > Date.now()); }
// Een limiet: tot middernacht (UTC) uit; andere fouten: na 3 keer 6 uur uit
async function srcFail(env, src, msg, limit) {
  const st = await srcState(env);
  const o = st[src] || { fails: 0 };
  o.fails = (o.fails || 0) + 1; o.msg = String(msg || '').slice(0, 160); o.at = isoLocal(Date.now());
  if (limit) { const d = new Date(); d.setUTCHours(24, 5, 0, 0); o.until = d.getTime(); }
  else if (o.fails >= 3) o.until = Date.now() + 6 * HOUR_MS;
  st[src] = o;
  await setKv(env, 'src_health', JSON.stringify(st));
}
async function srcOk(env, src) {
  const st = await srcState(env);
  if (!st[src]) return;
  delete st[src];
  await setKv(env, 'src_health', JSON.stringify(st));
}
// Noteer welke reservebron het werk deed (voor de site, bij Koppelingen)
async function srcBackup(env, src, backup) {
  const st = await srcState(env);
  const o = st[src] || { fails: 0 };
  o.backup = backup; o.backupAt = isoLocal(Date.now());
  st[src] = o;
  await setKv(env, 'src_health', JSON.stringify(st));
}

async function noteExtError(env, source, msg) {
  let errs = {};
  try { errs = JSON.parse((await getKv(env, 'ext_errors')) || '{}'); } catch (e) { errs = {}; }
  if (msg) errs[source] = { at: isoLocal(Date.now()), msg: String(msg).slice(0, 200) }; else delete errs[source];
  await setKv(env, 'ext_errors', JSON.stringify(errs));
}

// ---------- HTTP-hulp ----------

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
  const allow = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag',
    'Vary': 'Origin',
  };
}

// ---------- Opgebouwde gegevens bewaren (in twee delen, met een vingerafdruk per deel) ----------
const EXTRA_KEYS = ['market', 'research', 'fin', 'idx', 'hicp', 'fx', 'marketNews', 'etf', 'ext2'];

async function sha256Hex(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function saveDataCache(env, data) {
  const core = {}, extra = { ok: true, part: 'extra' }, series = { ok: true, part: 'series' };
  Object.keys(data).forEach((k) => { if (EXTRA_KEYS.includes(k)) extra[k] = data[k]; else if (SERIES_KEYS.includes(k)) series[k] = data[k]; else core[k] = data[k]; });
  core.part = 'core';
  const last = await env.DB.prepare('SELECT MAX(ts) AS ts FROM intraday').first().catch(() => null);
  series.seriesTs = (last && last.ts) || 0;
  const cs = JSON.stringify(core), es = JSON.stringify(extra), ss = JSON.stringify(series);
  // generated verandert bij elke opbouw; zonder dat veld is de vingerafdruk alleen anders als de inhoud anders is
  const tagOf = async (o) => '"' + (await sha256Hex(JSON.stringify(Object.assign({}, o, { generated: null })))).slice(0, 24) + '"';
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').bind('data_core', cs),
    env.DB.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').bind('data_extra', es),
    env.DB.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').bind('data_series', ss),
    env.DB.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').bind('data_etags', JSON.stringify({ core: await tagOf(core), extra: await tagOf(extra), series: await tagOf(series) })),
    env.DB.prepare('DELETE FROM kv WHERE key = ?').bind('data_cache'),
  ]);
  try { await saveShareCache(env, data); } catch (e) { console.error('share', e); }
  return data;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(headers || {}) },
  });
}

// Geeft de toegangscode terug als sleutel én secret gelijk zijn aan die van Trading 212 in deze Worker.
// Zo hoef je op een nieuw apparaat de toegangscode niet te weten: alle andere koppelingen staan al in de Worker.
// Maximaal 10 mislukte pogingen per uur per verbinding (IP-adres, alleen als vingerafdruk bewaard) en 100 voor de
// hele Worker samen, tegen raden vanaf veel adressen. De sleutel wordt nergens bewaard.
async function loginWithT212(request, envIn, cors) {
  await ensureSchema(envIn);
  const body = await request.json().catch(() => ({}));
  const key = String((body && body.key) || '').trim(), secret = String((body && body.secret) || '').trim();
  const hour = new Date().toISOString().slice(0, 13);
  const who = (await sha256Hex('ip:' + (request.headers.get('CF-Connecting-IP') || 'onbekend'))).slice(0, 16);
  let lim = {};
  try { lim = JSON.parse((await getKv(envIn, 'login_fail')) || '{}'); } catch (e) { lim = {}; }
  if (lim.h !== hour) lim = { h: hour, total: 0, ips: {} };
  lim.ips = lim.ips || {}; lim.total = lim.total || 0;
  const fails = lim.ips[who] || 0;
  if (fails >= 10 || lim.total >= 100) return json({ ok: false, error: 'Te veel mislukte pogingen. Probeer het over een uur opnieuw, of gebruik je toegangscode.' }, 429, cors);
  const env = await withKeys(envIn);
  if (!env.T212_KEY || !env.T212_SECRET) return json({ ok: false, error: 'In deze Worker staat nog geen Trading 212-sleutel. Log in met je toegangscode en voeg de sleutel toe bij Koppelingen.' }, 409, cors);
  const ok = key.length > 8 && secret.length > 8 && safeEqual(String(env.T212_KEY), key) && safeEqual(String(env.T212_SECRET), secret);
  if (!ok) {
    lim.ips[who] = fails + 1; lim.total++;
    await setKv(envIn, 'login_fail', JSON.stringify(lim));
    return json({ ok: false, error: 'Deze sleutel en secret horen niet bij deze Worker. Controleer ze, en het adres van de Worker.' }, 401, cors);
  }
  return json({ ok: true, token: envIn.WEB_TOKEN, features: await featureStatus(env, envIn) }, 200, cors);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Agenda met kwartaalcijfers en dividenden (aangekondigd) als iCalendar-bestand
async function buildIcs(env) {
  let ev = null;
  try { ev = JSON.parse((await getKv(env, 'events')) || 'null'); } catch (e) { ev = null; }
  const esc2 = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const d8 = (s) => String(s).slice(0, 10).replace(/-/g, '');
  const next = (s) => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//investment-tracker//NL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Beleggingen', 'X-WR-TIMEZONE:Europe/Amsterdam', 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'];
  const add = (uid, date, summary, desc) => {
    lines.push('BEGIN:VEVENT', 'UID:' + uid + '@investment-tracker', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + d8(date), 'DTEND;VALUE=DATE:' + next(date),
      'SUMMARY:' + esc2(summary), 'DESCRIPTION:' + esc2(desc), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  };
  if (ev) {
    (ev.earnings || []).forEach((e) => add('earn-' + e.ticker + '-' + e.date, e.date, 'Kwartaalcijfers ' + e.ticker,
      'Verwachte winst per aandeel: ' + (e.epsEst != null ? e.epsEst : 'onbekend') + '. Bron: Financial Modeling Prep.'));
    (ev.dividends || []).filter((d) => d.announced).forEach((d) => {
      if (d.exDate) add('exdiv-' + d.ticker + '-' + d.exDate, d.exDate, 'Ex-dividend ' + d.ticker, 'Wie het aandeel vóór deze dag heeft, krijgt het dividend' + (d.estEur != null ? ' (ongeveer €' + d.estEur.toFixed(2) + ' bruto).' : '.'));
      if (d.payDate) add('pay-' + d.ticker + '-' + d.payDate, d.payDate, 'Dividend ' + d.ticker + (d.estEur != null ? ' ≈ €' + d.estEur.toFixed(2) : ''), 'Uitbetaling van het dividend. Bron: Financial Modeling Prep.');
    });
  }
  lines.push('END:VCALENDAR');
  // Regels van max. 75 tekens (iCalendar)
  return lines.map((l) => { let out = '', rest = l; while (rest.length > 74) { out += rest.slice(0, 74) + '\r\n '; rest = rest.slice(74); } return out + rest; }).join('\r\n') + '\r\n';
}

function authorized(request, url, env) {
  const want = env.WEB_TOKEN || '';
  if (!want) return false;
  const h = request.headers.get('Authorization') || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : (url.searchParams.get('token') || '');
  if (given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// ---------- Tijd ----------

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
});

function parts(d) {
  const o = {};
  partsFmt.formatToParts(d).forEach((p) => { o[p.type] = p.value; });
  if (o.hour === '24') o.hour = '00';
  return {
    day: `${o.year}-${o.month}-${o.day}`,
    hm: `${o.hour}:${o.minute}`,
    hour: Number(o.hour),
    minute: Number(o.minute),
    weekday: { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[o.weekday],
  };
}

const dayOf = (ms) => parts(new Date(ms)).day;
const hourStart = (ms) => Math.floor(ms / HOUR_MS) * HOUR_MS; // Amsterdam wijkt hele uren af van UTC

function isLive(d) {
  const p = parts(d);
  return LIVE_WEEKDAYS.includes(p.weekday) && p.hm >= LIVE_START && p.hm <= LIVE_END;
}

function isoLocal(ms) {
  const d = new Date(ms);
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d);
  return f.replace(' ', 'T');
}

// ---------- Trading 212 API ----------

async function t212(env, path) {
  if (!env.T212_KEY || !env.T212_SECRET) throw new Error('De Trading 212-sleutel is nog niet ingesteld. Vul hem in op de website bij Instellingen > Koppelingen.');
  const url = path.startsWith('http') ? path : (env.T212_BASE || 'https://live.trading212.com') + path;
  const auth = 'Basic ' + btoa(env.T212_KEY + ':' + env.T212_SECRET);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { Authorization: auth } });
    if (res.status === 200) return res.json();
    if (res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      await sleep(Math.min(Math.max(reset - Date.now(), 3000), 60000));
      continue;
    }
    if (res.status === 401) throw new Error('Trading 212-sleutel ongeldig (401).');
    if (res.status === 403) throw new Error('Trading 212-sleutel mist een recht (403) voor ' + path.split('?')[0] + '.');
    throw new Error('Trading 212 gaf ' + res.status + ' voor ' + path.split('?')[0]);
  }
  throw new Error('Rate limit bleef geraakt voor ' + path.split('?')[0]);
}

async function t212All(env, firstPath) {
  const out = [];
  let path = firstPath, pages = 0;
  while (path) {
    if (pages > 0) await sleep(3100); // geschiedenis: 20 verzoeken per minuut
    const res = await t212(env, path);
    (res.items || []).forEach((x) => out.push(x));
    path = res.nextPagePath || null;
    if (++pages > 100) break;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (x) => (typeof x === 'number' ? x : Number(x || 0));
const r2 = (x) => Math.round(x * 100) / 100;

// "AAPL_US_EQ" -> "AAPL", "VUAGl_EQ" -> "VUAG"
function shortTicker(t) {
  const base = String(t).split('_')[0];
  return base.replace(/[a-z]+$/, '') || base;
}

// ---------- Elke 10 minuten ----------

async function tick(env, now, force) {
  const msgs = [];
  if (!env.T212_KEY || !env.T212_SECRET) {
    if (force) throw new Error('De Trading 212-sleutel is nog niet ingesteld. Vul hem in op de website bij Instellingen > Koppelingen.');
    return '';
  }
  if (force || isLive(now)) {
    const positions = await t212(env, '/api/v0/equity/positions');
    const ts = Math.floor(now.getTime() / 60000) * 60000;
    const rows = positions.map((p) => ({
      ticker: shortTicker(p.instrument.ticker), name: p.instrument.name,
      value: r2(num(p.walletImpact.currentValue)), unrealized: r2(num(p.walletImpact.unrealizedProfitLoss)),
      price: num(p.currentPrice), qty: num(p.quantity),
    }));
    const total = rows.reduce((s, r) => s + r.value, 0);
    const totalUnreal = rows.reduce((s, r) => s + r.unrealized, 0);
    rows.push({ ticker: TOTAL, name: 'Totaal beleggingen', value: r2(total), unrealized: r2(totalUnreal), price: null, qty: null });
    const stmt = env.DB.prepare('INSERT OR REPLACE INTO intraday (ts, ticker, name, value, unrealized, price, qty) VALUES (?,?,?,?,?,?,?)');
    await env.DB.batch(rows.map((r) => stmt.bind(ts, r.ticker, r.name, r.value, r.unrealized, r.price, r.qty)));
    await setKv(env, 'pos_extra', JSON.stringify(posExtra(positions)));
    msgs.push(`${positions.length} posities gemeten (totaal €${total.toFixed(2)}).`);
    try { const m = await alertMoves(env, rows, now); if (m) msgs.push(m); } catch (e) { console.error('meldingen', e); }
    try { const m = await checkPriceAlerts(env, rows); if (m) msgs.push(m); } catch (e) { console.error('koersalarm', e); }
    try { const m = await depositReminder(env, now); if (m) msgs.push(m); } catch (e) { console.error('inleg', e); }
  }

  const p = parts(now);
  // Peildatum 1 januari (vermogen voor de belastingaangifte): één keer op nieuwjaarsdag
  if (p.day.endsWith('-01-01')) {
    const year = p.day.slice(0, 4);
    if (!(await getKv(env, 'peil_' + year))) msgs.push(await takePeildatum(env, year));
  }
  const lastHk = await getKv(env, 'hk_hour');
  const curHour = String(hourStart(now.getTime()));
  if (force || lastHk !== curHour) {
    msgs.push(await housekeeping(env, now));
    await setKv(env, 'hk_hour', curHour);
  }

  if (p.weekday === 6 && p.hour === 9) {
    const last = await getKv(env, 'last_week_snapshot');
    if (last !== p.day) {
      msgs.push(await weeklySnapshot(env, now, false));
      try { msgs.push(await alertDrift(env, p.day)); } catch (e) { console.error('meldingen', e); }
      try { msgs.push(await weeklyMail(env, false)); } catch (e) { console.error('weekmail', e); }
    }
  }
  const text = msgs.filter(Boolean).join(' ');
  if (text) await saveDataCache(env, await buildData(env));
  return text;
}

// Extra per positie: gemiddelde aankoopprijs, valuta en valuta-effect (fxImpact) van Trading 212
function posExtra(positions) {
  const out = {};
  positions.forEach((p) => {
    out[shortTicker(p.instrument.ticker)] = {
      avg: numOrNull(p.averagePricePaid), price: numOrNull(p.currentPrice), cur: p.instrument.currency || null,
      fx: numOrNull(p.walletImpact && p.walletImpact.fxImpact), cost: numOrNull(p.walletImpact && p.walletImpact.totalCost),
      isin: p.instrument.isin || null, since: p.createdAt || null,
    };
  });
  return out;
}

async function takePeildatum(env, year) {
  const sum = await t212(env, '/api/v0/equity/account/summary');
  await sleep(1100);
  const positions = await t212(env, '/api/v0/equity/positions');
  const cash = num(sum.cash && sum.cash.availableToTrade) + num(sum.cash && sum.cash.inPies) + num(sum.cash && sum.cash.reservedForOrders);
  const inv = positions.reduce((s, x) => s + num(x.walletImpact.currentValue), 0);
  const rec = {
    date: year + '-01-01', taken: isoLocal(Date.now()), cash: r2(cash), investments: r2(inv), total: r2(inv + cash),
    positions: positions.map((x) => ({ ticker: shortTicker(x.instrument.ticker), name: x.instrument.name, isin: x.instrument.isin || null,
      qty: num(x.quantity), value: r2(num(x.walletImpact.currentValue)) })),
  };
  await setKv(env, 'peil_' + year, JSON.stringify(rec));
  return `Peildatum ${year}: €${rec.total.toFixed(2)}.`;
}

async function housekeeping(env, now) {
  const msgs = [];
  const curHour = hourStart(now.getTime());

  // 1. Afgeronde uren -> hours
  const lastHour = Number(await getKv(env, 'last_hour') || 0);
  const { results: pts } = await env.DB.prepare(
    'SELECT ts, ticker, name, value, price FROM intraday WHERE ts >= ? AND ts < ? ORDER BY ts'
  ).bind(lastHour ? lastHour + HOUR_MS : 0, curHour).all();
  const groups = new Map();
  for (const r of pts) {
    const k = hourStart(r.ts) + '|' + r.ticker;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  let maxHour = lastHour;
  const hStmt = env.DB.prepare('INSERT OR REPLACE INTO hours (hour, ticker, name, open, close, low, high, avg, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const hRows = [];
  for (const [k, list] of groups) {
    const hour = Number(k.split('|')[0]);
    const v = list.map((x) => x.value);
    const last = list[list.length - 1];
    hRows.push(hStmt.bind(hour, last.ticker, last.name, v[0], v[v.length - 1], Math.min(...v), Math.max(...v),
      r2(v.reduce((s, x) => s + x, 0) / v.length), v.length, last.price));
    if (hour > maxHour) maxHour = hour;
  }
  if (hRows.length) {
    await batchChunks(env, hRows);
    await setKv(env, 'last_hour', String(maxHour));
    msgs.push(hRows.length + ' uurregels.');
  }

  // 2. Afgeronde dagen -> days
  const today = parts(now).day;
  const lastDay = (await getKv(env, 'last_day')) || '';
  const since = lastDay ? Date.parse(lastDay + 'T00:00:00Z') - 2 * HOUR_MS : 0;
  const { results: hrs } = await env.DB.prepare(
    'SELECT hour, ticker, name, open, close, low, high, avg, n, close_price FROM hours WHERE hour >= ? ORDER BY hour'
  ).bind(since).all();
  const dGroups = new Map();
  for (const h of hrs) {
    const d = dayOf(h.hour);
    if (d <= lastDay || d >= today) continue;
    const k = d + '|' + h.ticker;
    if (!dGroups.has(k)) dGroups.set(k, []);
    dGroups.get(k).push(h);
  }
  let maxDay = lastDay;
  const dStmt = env.DB.prepare('INSERT OR REPLACE INTO days (day, ticker, name, open, close, low, high, avg, range, range_pct, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const dRows = [];
  for (const [k, list] of dGroups) {
    const day = k.split('|')[0];
    const first = list[0], last = list[list.length - 1];
    const lo = Math.min(...list.map((x) => x.low));
    const hi = Math.max(...list.map((x) => x.high));
    const n = list.reduce((s, x) => s + x.n, 0);
    const avg = n ? list.reduce((s, x) => s + x.avg * x.n, 0) / n : 0;
    dRows.push(dStmt.bind(day, last.ticker, last.name, first.open, last.close, lo, hi, r2(avg), r2(hi - lo),
      avg ? Math.round((hi - lo) / avg * 1e6) / 1e6 : 0, n, last.close_price));
    if (day > maxDay) maxDay = day;
  }
  if (dRows.length) {
    await batchChunks(env, dRows);
    await setKv(env, 'last_day', maxDay);
    msgs.push(dRows.length + ' dagregels.');
  }

  // 3. Metingen ouder dan 3 dagen weg, alleen als hun uur al samengevat is
  const doneUntil = maxHour ? maxHour + HOUR_MS : 0;
  const cutoff = Math.min(now.getTime() - KEEP_INTRADAY_MS, doneUntil);
  if (cutoff > 0) {
    const res = await env.DB.prepare('DELETE FROM intraday WHERE ts < ?').bind(cutoff).run();
    const changes = res.meta && res.meta.changes;
    if (changes) msgs.push(changes + ' oude metingen verwijderd.');
  }
  return msgs.join(' ');
}

// Eén keer per maand: oude uurregels, koersen van vergelijkbare bedrijven en sectordagen opruimen.
// Dagregels, weken, posities en orders blijven altijd bewaard (daar draaien grafieken en jaaroverzichten op).
// Na 3 dagen worden metingen per 10 minuten uren; uren blijven 180 dagen, daarna alleen de dagregels
const KEEP_HOURS_DAYS = 180, KEEP_EXT_DAYS = 420;
async function cleanupOld(env, now) {
  const month = parts(now).day.slice(0, 7);
  if ((await getKv(env, 'cleanup_month')) === month) return '';
  const day = (n) => new Date(now.getTime() - n * 864e5).toISOString().slice(0, 10);
  const out = [];
  const run = async (sql, arg, what) => { try { const r = await env.DB.prepare(sql).bind(arg).run(); const n = r.meta && r.meta.changes; if (n) out.push(n + ' ' + what); } catch (e) { /* tabel bestaat (nog) niet */ } };
  await run('DELETE FROM hours WHERE hour < ?', now.getTime() - KEEP_HOURS_DAYS * 864e5, 'uurregels');
  await run('DELETE FROM ext_prices WHERE day < ?', day(KEEP_EXT_DAYS), 'koersen');
  await run('DELETE FROM ext_perf WHERE day < ?', day(KEEP_EXT_DAYS), 'sectordagen');
  await setKv(env, 'cleanup_month', month);
  return out.length ? 'Opgeruimd: ' + out.join(', ') + '.' : '';
}

async function batchChunks(env, stmts) {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

// ---------- Weeksnapshot ----------

async function weeklySnapshot(env, now, force) {
  const day = parts(now).day;
  const sum = await t212(env, '/api/v0/equity/account/summary');
  if (sum.currency && sum.currency !== 'EUR') throw new Error('Account-valuta is ' + sum.currency + ', verwacht EUR.');
  await sleep(1100);
  const positions = await t212(env, '/api/v0/equity/positions');
  const netDeposits = await netDepositsNow(env);
  const cash = num(sum.cash && sum.cash.availableToTrade) + num(sum.cash && sum.cash.inPies) + num(sum.cash && sum.cash.reservedForOrders);
  // Waarde en kostprijs uit de posities zelf: investments.currentValue en totalCost van
  // Trading 212 bevatten ook cash (bijv. in pies), dus die optellen bij de cash telt dubbel.
  const posValue = positions.reduce((s, p) => s + num(p.walletImpact.currentValue), 0);
  const posCost = positions.reduce((s, p) => s + num(p.walletImpact.totalCost), 0);
  const account = r2(posValue + cash);

  const stmts = [env.DB.prepare('INSERT OR REPLACE INTO weeks (date, account_value, net_deposits, cash, cost_basis, source) VALUES (?,?,?,?,?,?)')
    .bind(day, account, r2(netDeposits), r2(cash), r2(posCost), 'API')];
  const pStmt = env.DB.prepare('INSERT OR REPLACE INTO positions (date, ticker, name, value, unrealized, qty) VALUES (?,?,?,?,?,?)');
  positions.forEach((p) => stmts.push(pStmt.bind(day, shortTicker(p.instrument.ticker), p.instrument.name,
    r2(num(p.walletImpact.currentValue)), r2(num(p.walletImpact.unrealizedProfitLoss)), num(p.quantity))));
  await batchChunks(env, stmts);
  await setKv(env, 'last_week_snapshot', day);
  await saveDataCache(env, await buildData(env));
  return `Weeksnapshot ${day}: accountwaarde €${account.toFixed(2)}, netto gestort €${netDeposits.toFixed(2)}.`;
}

// Netto stortingen uit de transacties, met correctie voor opnames die nog "Pending" zijn.
async function netDepositsNow(env) {
  const tx = await t212All(env, '/api/v0/equity/history/transactions?limit=50');
  let total = 0;
  const withdrawCounts = {};
  for (const t of tx) {
    const a = num(t.amount);
    if (t.type === 'DEPOSIT') total += Math.abs(a);
    else if (t.type === 'WITHDRAW') {
      total -= Math.abs(a);
      const k = Math.abs(a).toFixed(2);
      withdrawCounts[k] = (withdrawCounts[k] || 0) + 1;
    } else if (t.type === 'TRANSFER') total += a;
  }
  const pending = await getPending(env);
  const used = {};
  const still = pending.filter((p) => {
    const k = p.amount.toFixed(2);
    used[k] = (used[k] || 0) + 1;
    return (withdrawCounts[k] || 0) < p.countAtEntry + used[k];
  });
  if (still.length !== pending.length) await setKv(env, 'pending', JSON.stringify(still));
  return total - still.reduce((s, p) => s + p.amount, 0);
}

async function getPending(env) {
  try { return JSON.parse((await getKv(env, 'pending')) || '[]'); } catch (e) { return []; }
}

async function addPending(env, amount) {
  if (!(amount > 0)) throw new Error('Geen geldig bedrag.');
  const tx = await t212All(env, '/api/v0/equity/history/transactions?limit=50');
  const k = amount.toFixed(2);
  const count = tx.filter((t) => t.type === 'WITHDRAW' && Math.abs(num(t.amount)).toFixed(2) === k).length;
  const list = await getPending(env);
  list.push({ amount: r2(amount), countAtEntry: count, added: parts(new Date()).day });
  await setKv(env, 'pending', JSON.stringify(list));
  return list;
}

// ---------- Opslag van instellingen ----------

async function getKv(env, key) {
  const row = await env.DB.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

async function setKv(env, key, value) {
  await env.DB.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').bind(key, value).run();
}

// ---------- Gegevens voor de website ----------

async function buildData(env) {
  const now = Date.now();

  const { results: wk } = await env.DB.prepare('SELECT * FROM weeks ORDER BY date').all();
  const weeks = [];
  wk.forEach((w, i) => {
    const prev = wk[i - 1];
    const inv = w.account_value - w.cash;
    const total = w.account_value - w.net_deposits;
    const change = prev ? w.account_value - prev.account_value : null;
    const newDep = prev ? w.net_deposits - prev.net_deposits : null;
    const weekRes = prev ? change - newDep : null;
    weeks.push({
      date: w.date + 'T00:00:00', accountValue: w.account_value, netDeposits: w.net_deposits, cash: w.cash,
      costBasis: w.cost_basis, investmentsValue: r2(inv), unrealized: r2(inv - w.cost_basis),
      totalResult: r2(total), totalResultPct: w.net_deposits ? total / w.net_deposits : 0,
      weekChange: change === null ? null : r2(change), newDeposits: newDep === null ? null : r2(newDep),
      weekResult: weekRes === null ? null : r2(weekRes),
      weekResultPct: prev && prev.account_value ? weekRes / prev.account_value : null,
      source: w.source,
    });
  });

  const { results: intra } = await env.DB.prepare(
    'SELECT ts, ticker, name, value, unrealized, qty, price FROM intraday ORDER BY ts'
  ).all();

  // Posities: laatste meting, anders laatste weeksnapshot
  let positions = [], positionsDate = null;
  if (intra.length) {
    const lastTs = intra[intra.length - 1].ts;
    positionsDate = isoLocal(lastTs);
    positions = intra.filter((r) => r.ts === lastTs && r.ticker !== TOTAL).map((r) => ({
      ticker: r.ticker, name: r.name, value: r.value, unrealized: r.unrealized,
      cost: r2(r.value - r.unrealized), resultPct: r.value - r.unrealized ? r.unrealized / (r.value - r.unrealized) : 0,
      quantity: r.qty, price: r.price,
    }));
  } else {
    const last = await env.DB.prepare('SELECT MAX(date) AS d FROM positions').first();
    if (last && last.d) {
      positionsDate = last.d + 'T00:00:00';
      const { results } = await env.DB.prepare('SELECT * FROM positions WHERE date = ?').bind(last.d).all();
      positions = results.map((r) => ({ ticker: r.ticker, name: r.name, value: r.value, unrealized: r.unrealized,
        cost: r2(r.value - r.unrealized), quantity: r.qty }));
    }
  }

  // Vandaag per positie (laatste handelsdag in de metingen)
  const today = [];
  if (intra.length) {
    const lastDay = dayOf(intra[intra.length - 1].ts);
    const dayRows = intra.filter((r) => dayOf(r.ts) === lastDay);
    const byT = new Map();
    dayRows.forEach((r) => { if (!byT.has(r.ticker)) byT.set(r.ticker, []); byT.get(r.ticker).push(r); });
    // Hoogste/laagste ooit: uit de dagtabel, plus uren die nog niet in een dag zijn samengevat
    const lastDayDone = (await getKv(env, 'last_day')) || '';
    const sinceHour = lastDayDone ? Date.parse(lastDayDone + 'T00:00:00Z') + 22 * HOUR_MS : 0;
    const { results: histD } = await env.DB.prepare(
      'SELECT ticker, MAX(high) AS hi, MIN(low) AS lo FROM days GROUP BY ticker'
    ).all();
    const { results: histH } = await env.DB.prepare(
      'SELECT ticker, MAX(high) AS hi, MIN(low) AS lo FROM hours WHERE hour >= ? GROUP BY ticker'
    ).bind(sinceHour).all();
    const histMap = new Map();
    [...histD, ...histH].forEach((h) => {
      const o = histMap.get(h.ticker);
      histMap.set(h.ticker, o ? { hi: Math.max(o.hi, h.hi), lo: Math.min(o.lo, h.lo) } : { hi: h.hi, lo: h.lo });
    });
    const { results: ranges } = await env.DB.prepare(
      'SELECT ticker, AVG(range) AS ar, AVG(range_pct) AS arp, COUNT(*) AS n FROM days GROUP BY ticker'
    ).all();
    const rangeMap = new Map(ranges.map((h) => [h.ticker, h]));
    for (const [t, list] of byT) {
      const v = list.map((x) => x.value);
      const lo = Math.min(...v), hi = Math.max(...v), avg = v.reduce((s, x) => s + x, 0) / v.length;
      const open = v[0], cur = v[v.length - 1];
      const h = histMap.get(t), rg = rangeMap.get(t);
      today.push({
        ticker: t, name: list[list.length - 1].name, current: cur, low: lo, high: hi, avg: r2(avg), open: open,
        change: r2(cur - open), changePct: open ? (cur - open) / open : 0,
        allTimeHigh: h ? Math.max(h.hi, hi) : hi, allTimeLow: h ? Math.min(h.lo, lo) : lo,
        avgRange: rg ? r2(rg.ar) : r2(hi - lo), avgRangePct: rg ? rg.arp : (avg ? (hi - lo) / avg : 0),
        days: rg ? rg.n : 0,
      });
    }
    today.sort((a, b) => (a.ticker === TOTAL ? -1 : b.ticker === TOTAL ? 1 : a.ticker.localeCompare(b.ticker)));
  }

  const { results: hrs } = await env.DB.prepare(
    'SELECT hour, ticker, open, close, low, high, avg FROM hours WHERE hour >= ? ORDER BY hour'
  ).bind(now - 31 * 864e5).all();
  const { results: dys } = await env.DB.prepare(
    'SELECT day, ticker, open, close, low, high, avg, range, range_pct FROM days ORDER BY day'
  ).all();

  let events = null;
  try { events = JSON.parse((await getKv(env, 'events')) || 'null'); } catch (e) { events = null; }

  let market = null;
  try { market = await marketData(env); } catch (e) { console.error('market', e); }
  let extra = {};
  try { extra = await extraData(env); } catch (e) { console.error('extra', e); }

  return {
    ok: true,
    generated: isoLocal(now),
    events,
    market,
    orders: { columns: ['time', 'ticker', 'name', 'side', 'qty', 'price', 'currency', 'fxRate', 'net', 'realised', 'feeFx', 'feeOther', 'kind'], rows: extra.orders || [] },
    posExtra: extra.posExtra || {},
    peil: extra.peil || [],
    settings: extra.settings || {},
    etf: extra.etf || {},
    research: extra.research || {},
    fin: extra.fin || {},
    fx: extra.fx || null,
    hicp: extra.hicp || null,
    idx: extra.idx || null,
    ext2: extra.ext2 || {},
    marketNews: extra.marketNews || null,
    features: { flags: extra.flags || {}, has: extra.has || {} },
    currency: 'EUR',
    weeks,
    positionsDate,
    positions,
    today,
    intraday: { columns: ['time', 'ticker', 'value'], rows: intra.map((r) => [isoLocal(r.ts), r.ticker, r.value]) },
    hours: { columns: ['hour', 'ticker', 'open', 'close', 'low', 'high', 'avg'],
      rows: hrs.map((r) => [isoLocal(r.hour), r.ticker, r.open, r.close, r.low, r.high, r.avg]) },
    days: { columns: ['date', 'ticker', 'open', 'close', 'low', 'high', 'avg', 'range', 'rangePct'],
      rows: dys.map((r) => [r.day + 'T00:00:00', r.ticker, r.open, r.close, r.low, r.high, r.avg, r.range, r.range_pct]) },
  };
}

// ---------- Eenmalig overnemen uit de Google Sheet ----------

// ---------- Aankomende gebeurtenissen (1x per dag) ----------

// Ontvangen dividenden komen uit Trading 212. Aankomende kwartaalcijfers en dividenden komen van
// Financial Modeling Prep (gratis sleutel, 250 verzoeken per dag); per aandeel 2 verzoeken.
async function refreshEvents(env) {
  const today = parts(new Date()).day;
  const out = { updated: isoLocal(Date.now()), fmp: !!env.FMP_KEY, errors: [], received: [], earnings: [], dividends: [], lastEarnings: [] };

  const positions = await t212(env, '/api/v0/equity/positions');
  const held = positions.map((p) => {
    const qty = num(p.quantity), price = num(p.currentPrice), value = num(p.walletImpact.currentValue);
    return {
      ticker: shortTicker(p.instrument.ticker), raw: p.instrument.ticker, name: p.instrument.name, qty, value,
      eurPerUnit: qty && price ? value / (qty * price) : null, // koers in eigen munt -> euro
      etf: ETF_RE.test(p.instrument.name || ''),
    };
  });

  try {
    const divs = await t212All(env, '/api/v0/equity/history/dividends?limit=50');
    out.received = divs.map((d) => ({
      ticker: shortTicker(d.ticker || (d.instrument && d.instrument.ticker) || ''),
      date: String(d.paidOn || '').slice(0, 10), amount: r2(num(d.amount)),
      perShare: num(d.grossAmountPerShare) || null, qty: num(d.quantity) || null,
    })).filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) { out.errors.push('Dividendgeschiedenis: ' + e.message); }
  try { const dc = JSON.parse((await getKv(env, 'div_csv')) || '[]'); if (dc.length) out.received = mergeCsvDividends(out.received, dc); } catch (e) { /* geen CSV-dividenden */ }

  let prev = null;
  try { prev = JSON.parse((await getKv(env, 'events')) || 'null'); } catch (e) { prev = null; }
  const failed = new Set();
  const watchList = (await watchStocks(env)).filter((w) => !held.some((h) => (SYMBOL_MAP[h.ticker] || h.ticker) === w.symbol))
    .map((w) => ({ ticker: w.ticker, name: w.symbol, qty: 0, value: 0, eurPerUnit: null, etf: false, watch: true }));
  if (env.FMP_KEY) {
    for (const h of held.filter((x) => !x.etf).concat(watchList)) {
      const sym = SYMBOL_MAP[h.ticker] || h.ticker;
      try {
        const er = await fmp(env, '/earnings?symbol=' + encodeURIComponent(sym));
        const fut = er.filter((x) => x.date && x.date >= today).sort((a, b) => a.date.localeCompare(b.date));
        const past = er.filter((x) => x.date && x.date < today && x.epsActual != null).sort((a, b) => b.date.localeCompare(a.date));
        if (fut[0]) out.earnings.push({ ticker: h.ticker, symbol: sym, date: fut[0].date,
          epsEst: numOrNull(fut[0].epsEstimated), revEst: numOrNull(fut[0].revenueEstimated) });
        if (past[0]) out.lastEarnings.push({ ticker: h.ticker, date: past[0].date, eps: numOrNull(past[0].epsActual),
          epsEst: numOrNull(past[0].epsEstimated), rev: numOrNull(past[0].revenueActual), revEst: numOrNull(past[0].revenueEstimated) });
      } catch (e) { out.errors.push(sym + ' cijfers: ' + e.message); failed.add(h.ticker); if (/limiet|401|403/.test(e.message)) { held.forEach((x) => failed.add(x.ticker)); break; } }
      try {
        const dv = await fmp(env, '/dividends?symbol=' + encodeURIComponent(sym));
        const per = (x) => numOrNull(x.dividend != null ? x.dividend : x.adjDividend);
        const up = dv.filter((x) => (x.paymentDate || x.date) >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const last = dv.filter((x) => x.date && x.date < today).sort((a, b) => b.date.localeCompare(a.date))[0];
        for (const x of up.slice(0, 2)) {
          const ps = per(x);
          out.dividends.push({ ticker: h.ticker, symbol: sym, exDate: x.date || null, payDate: x.paymentDate || null,
            perShare: ps, frequency: x.frequency || null,
            estEur: ps != null && h.eurPerUnit ? r2(ps * h.qty * h.eurPerUnit) : null, announced: true });
        }
        if (!up.length && last && per(last) != null) {
          out.dividends.push({ ticker: h.ticker, symbol: sym, exDate: null, payDate: null, lastEx: last.date,
            perShare: per(last), frequency: last.frequency || null,
            estEur: h.eurPerUnit ? r2(per(last) * h.qty * h.eurPerUnit) : null, announced: false });
        }
      } catch (e) { out.errors.push(sym + ' dividend: ' + e.message); failed.add(h.ticker); if (/limiet|401|403/.test(e.message)) { held.forEach((x) => failed.add(x.ticker)); break; } }
    }
  }
  // Reserve: datum en verwachting van de volgende kwartaalcijfers van Finnhub, voor aandelen waarvoor FMP niets gaf
  if (env.FINNHUB_KEY) {
    const need = held.filter((x) => !x.etf).concat(watchList).filter((h) => (!env.FMP_KEY || failed.has(h.ticker)) && !out.earnings.some((e) => e.ticker === h.ticker)).slice(0, 15);
    const to = new Date(Date.now() + 100 * 864e5).toISOString().slice(0, 10);
    let used = 0;
    for (const h of need) {
      const sym = SYMBOL_MAP[h.ticker] || h.ticker;
      const r = await getJson(FINNHUB_BASE + '/calendar/earnings?from=' + today + '&to=' + to + '&symbol=' + encodeURIComponent(sym) + '&token=' + encodeURIComponent(env.FINNHUB_KEY));
      if (r.status === 429) break;
      const list = ((r.ok && r.body && r.body.earningsCalendar) || []).filter((x) => x.date && x.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      if (list[0]) {
        out.earnings.push({ ticker: h.ticker, symbol: sym, date: list[0].date, epsEst: numOrNull(list[0].epsEstimate), revEst: numOrNull(list[0].revenueEstimate), src: 'finnhub' });
        failed.delete(h.ticker); used++;
      }
    }
    if (used) await srcBackup(env, 'fmp', 'Finnhub (kwartaalcijfers)');
  }
  // Mislukt bij FMP (limiet of tijdelijke fout): houd de vorige gegevens van dat aandeel
  if (prev && failed.size) {
    ['earnings', 'dividends', 'lastEarnings'].forEach((k) => {
      (prev[k] || []).forEach((x) => { if (failed.has(x.ticker) && !out[k].some((y) => y.ticker === x.ticker && y.date === x.date)) out[k].push(x); });
    });
  }
  out.earnings.sort((a, b) => a.date.localeCompare(b.date));
  try {
    const last = (await getKv(env, 'etf_updated')) || '';
    // Fouten hier niet in de agenda tonen; de site legt bij de spreiding uit hoe je het bestand zelf toevoegt
    if ((await featureFlags(env)).etfAuto && last < new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)) {
      const errs = await refreshEtf(env);
      await setKv(env, 'etf_updated', new Date().toISOString().slice(0, 10)); // hoe dan ook pas over een week opnieuw
      await setKv(env, 'etf_error', errs.join(' '));
    }
  } catch (e) { await setKv(env, 'etf_error', String(e.message || e)); }
  await flushFmp(env);
  await setKv(env, 'events', JSON.stringify(out));
  // Data van eerdere kwartaalcijfers bewaren (FMP en Finnhub geven alleen de laatste), voor de koersreactie op de site
  try {
    const eh = JSON.parse((await getKv(env, 'earn_hist')) || '{}');
    (out.lastEarnings || []).forEach((e) => {
      if (!e || !e.ticker || !/^\d{4}-\d{2}-\d{2}/.test(e.date || '')) return;
      const l = eh[e.ticker] || [];
      const d = e.date.slice(0, 10);
      if (!l.includes(d)) { l.push(d); l.sort(); }
      eh[e.ticker] = l.slice(-12);
    });
    await setKv(env, 'earn_hist', JSON.stringify(eh));
  } catch (e) { /* niet erg */ }
  await saveDataCache(env, await buildData(env));
  return `Gebeurtenissen bijgewerkt: ${out.earnings.length} cijferdata, ${out.dividends.length} dividenden, ` +
    `${out.received.length} ontvangen dividenden${out.errors.length ? ' (' + out.errors.length + ' fouten)' : ''}.`;
}

async function fmp(env, path) {
  await countFmp(env);
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(FMP_BASE + path + sep + 'apikey=' + encodeURIComponent(env.FMP_KEY));
  if (res.status === 429) throw new Error('FMP-limiet bereikt');
  if (res.status === 402) throw new Error('FMP gaf 402 (niet in het gratis abonnement)');
  if (res.status === 401 || res.status === 403) throw new Error('FMP gaf ' + res.status + ' (sleutel of abonnement)');
  if (!res.ok) throw new Error('FMP gaf ' + res.status);
  const j = await res.json();
  if (j && !Array.isArray(j)) {
    const msg = j['Error Message'] || j.error || j.message;
    if (msg) throw new Error(/limit/i.test(msg) ? 'FMP-limiet bereikt' : String(msg).slice(0, 120));
    return [];
  }
  return j || [];
}



// ---------- Orders: aan- en verkopen, gerealiseerd resultaat en kosten ----------
async function ensureOrdersTable(env) {
  if ((await getKv(env, 'orders_schema')) === '1') return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, ts INTEGER, ticker TEXT, name TEXT, side TEXT, qty REAL, price REAL, currency TEXT, fx_rate REAL, net REAL, realised REAL, fee_fx REAL, fee_other REAL, kind TEXT)').run();
  await setKv(env, 'orders_schema', '1');
}

// Eerste keer de hele geschiedenis (max. 30 pagina's van 50), daarna dagelijks de nieuwste 2 pagina's
async function syncOrders(env) {
  await ensureOrdersTable(env);
  const full = (await getKv(env, 'orders_full')) !== '1';
  const cap = full ? 30 : 2;
  let path = '/api/v0/equity/history/orders?limit=50', pages = 0;
  const items = [];
  while (path && pages < cap) {
    if (pages) await sleep(3100); // 20 verzoeken per minuut
    const res = await t212(env, path);
    (res.items || []).forEach((x) => items.push(x));
    path = res.nextPagePath || null;
    pages++;
  }
  const st = env.DB.prepare('INSERT OR REPLACE INTO orders (id, ts, ticker, name, side, qty, price, currency, fx_rate, net, realised, fee_fx, fee_other, kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const stmts = [];
  for (const it of items) {
    const f = it.fill, o = it.order;
    if (!f || !o || !num(f.quantity)) continue;
    const ts = Date.parse(f.filledAt || o.createdAt);
    if (!isFinite(ts)) continue;
    const wi = f.walletImpact || {};
    let feeFx = 0, feeOther = 0;
    (wi.taxes || []).forEach((t) => { const q = Math.abs(num(t.quantity)); if (t.name === 'CURRENCY_CONVERSION_FEE') feeFx += q; else feeOther += q; });
    const tick = o.ticker || (o.instrument && o.instrument.ticker) || '';
    stmts.push(st.bind(String(f.id || o.id), ts, shortTicker(tick), (o.instrument && o.instrument.name) || null, o.side || null,
      Math.abs(num(f.quantity)), numOrNull(f.price), (o.instrument && o.instrument.currency) || o.currency || null, numOrNull(wi.fxRate),
      r2(Math.abs(num(wi.netValue))), numOrNull(wi.realisedProfitLoss), r2(feeFx), r2(feeOther), f.type || null));
  }
  await batchChunks(env, stmts);
  if (full) await setKv(env, 'orders_full', '1');
  await setKv(env, 'orders_synced', parts(new Date()).day);
  await saveDataCache(env, await buildData(env));
  return `Orders: ${stmts.length} uitvoeringen bijgewerkt (${pages} pagina's).`;
}

// ---------- Instellingen van de website (streefverdeling, inleg, doel) ----------
async function getSettings(env) {
  try { return JSON.parse((await getKv(env, 'settings')) || '{}'); } catch (e) { return {}; }
}

async function saveSettings(env, body) {
  const cur = await getSettings(env);
  const clean = {};
  if (body && typeof body.targets === 'object' && body.targets) {
    clean.targets = {};
    Object.entries(body.targets).slice(0, 100).forEach(([k, v]) => {
      const n = Number(v);
      if (/^[A-Za-z0-9.@ _-]{1,40}$/.test(k) && isFinite(n) && n >= 0 && n <= 100) clean.targets[k] = Math.round(n * 10) / 10;
    });
  }
  ['monthly', 'goal', 'years'].forEach((k) => {
    if (body && body[k] !== undefined) { const n = Number(body[k]); if (isFinite(n) && n >= 0 && n < 1e9) clean[k] = n; }
  });
  if (body && typeof body.targetMode === 'string' && /^(position|sector)$/.test(body.targetMode)) clean.targetMode = body.targetMode;
  if (body && Array.isArray(body.watchlist)) {
    clean.watchlist = [...new Set(body.watchlist.map((x) => String(x || '').trim().toUpperCase()).filter((x) => /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(x)))].slice(0, 30);
  }
  // Aankoopdagboek: korte notitie per aankoop (sleutel = ticker|tijdstip in ms)
  if (body && body.notes && typeof body.notes === 'object') {
    clean.notes = {};
    Object.entries(body.notes).slice(0, 400).forEach(([k, v]) => {
      const txt = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500);
      if (/^[A-Za-z0-9.@_-]{1,20}\|\d{9,14}$/.test(k) && txt) clean.notes[k] = txt;
    });
  }
  // Andere rekeningen of brokers, met de hand of uit een CSV ingevoerd
  if (body && Array.isArray(body.accounts)) {
    const n = (x, lo, hi) => { const v = Number(x); return isFinite(v) && v >= lo && v < hi ? Math.round(v * 1e6) / 1e6 : null; };
    const s = (x, len) => String(x == null ? '' : x).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, len);
    clean.accounts = body.accounts.slice(0, 10).map((a) => ({
      id: /^[a-z0-9]{1,16}$/.test(a && a.id) ? a.id : Math.random().toString(36).slice(2, 10),
      name: s(a && a.name, 40) || 'Rekening', broker: s(a && a.broker, 40), cash: n(a && a.cash, -1e9, 1e9) || 0,
      updated: /^\d{4}-\d{2}-\d{2}$/.test(a && a.updated) ? a.updated : null,
      holdings: (Array.isArray(a && a.holdings) ? a.holdings : []).slice(0, 80).map((h) => ({
        name: s(h && h.name, 60), tk: s(h && h.tk, 20).toUpperCase(), isin: s(h && h.isin, 12).toUpperCase(),
        qty: n(h && h.qty, 0, 1e9), value: n(h && h.value, 0, 1e9), cost: n(h && h.cost, 0, 1e9),
      })).filter((h) => h.name && h.value != null),
    }));
  }
  if (body && body.alerts && typeof body.alerts === 'object') {
    const a = body.alerts, num2 = (x, lo, hi) => { const v = Number(x); return isFinite(v) && v >= lo && v <= hi ? v : null; };
    clean.alerts = { move: num2(a.move, 0, 50), earnings: !!a.earnings, insider: !!a.insider, drift: num2(a.drift, 0, 50) };
  }
  if (body && typeof body.mailAmounts === 'boolean') clean.mailAmounts = body.mailAmounts;
  if (body && typeof body.depositReminder === 'boolean') clean.depositReminder = body.depositReminder;
  // Maatstaf om mee te vergelijken: een beurssymbool (koersen via dezelfde weg als de volglijst), leeg = geen
  if (body && typeof body.benchmark === 'string') {
    const b = body.benchmark.trim().toUpperCase();
    clean.benchmark = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(b) ? b : '';
  }
  // Voorkeuren van de site (labels en notities op de volglijst, bezittingen, grenzen, nieuwsfilters …):
  // alleen gegevens, nooit uitgevoerd; maximaal 40 kB
  if (body && body.prefs && typeof body.prefs === 'object' && !Array.isArray(body.prefs)) {
    const txt = JSON.stringify(body.prefs);
    if (txt.length <= 40000) clean.prefs = JSON.parse(txt);
  }
  if (body && Array.isArray(body.priceAlerts)) {
    clean.priceAlerts = body.priceAlerts.slice(0, 30).map((a) => ({
      id: /^[a-z0-9]{1,16}$/.test(a && a.id) ? a.id : Math.random().toString(36).slice(2, 10),
      sym: String((a && a.sym) || '').toUpperCase().slice(0, 12), op: a && a.op === 'above' ? 'above' : 'below',
      price: Number(a && a.price), on: !!(a && a.on), hit: a && typeof a.hit === 'string' ? a.hit.slice(0, 25) : null,
      hitPrice: isFinite(Number(a && a.hitPrice)) ? Number(a.hitPrice) : null,
    })).filter((a) => /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(a.sym) && isFinite(a.price) && a.price > 0);
  }
  if (body && Array.isArray(body.goals)) {
    clean.goals = body.goals.slice(0, 8).map((g) => ({
      id: /^[a-z0-9]{1,16}$/.test(g && g.id) ? g.id : Math.random().toString(36).slice(2, 10),
      name: String((g && g.name) || 'Doel').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40) || 'Doel',
      target: Number(g && g.target), share: Math.max(0, Math.min(100, Number(g && g.share) || 0)),
      date: /^\d{4}-\d{2}(-\d{2})?$/.test(g && g.date) ? g.date : null,
    })).filter((g) => isFinite(g.target) && g.target > 0);
  }
  if (body && body.features && typeof body.features === 'object') {
    clean.features = Object.assign({}, cur.features || {});
    Object.keys(FEATURE_DEFAULTS).forEach((k) => { if (typeof body.features[k] === 'boolean') clean.features[k] = body.features[k]; });
  }
  const next = Object.assign({}, cur, clean, { updated: isoLocal(Date.now()) });
  await setKv(env, 'settings', JSON.stringify(next));
  await saveDataCache(env, await buildData(env));
  return next;
}

// ---------- Samenstelling van indexfondsen (iShares publiceert de volledige lijst) ----------
// Voor ETF's op de S&P 500 en de Nasdaq-100 gebruiken we de lijst van het iShares-fonds op dezelfde index.
const ETF_SOURCES = {
  SP500: { label: 'S&P 500', fund: 'iShares Core S&P 500 UCITS ETF (CSPX)',
    page: 'https://www.ishares.com/uk/individual/en/products/253743/ishares-core-sp-500-ucits-etf-acc-fund',
    url: 'https://www.ishares.com/uk/individual/en/products/253743/ishares-core-sp-500-ucits-etf-acc-fund/latest-holdings.csv' },
  NDX: { label: 'Nasdaq-100', fund: 'iShares Nasdaq 100 UCITS ETF (CNDX)',
    page: 'https://www.ishares.com/uk/individual/en/products/253741/ishares-nasdaq-100-ucits-etf',
    url: 'https://www.ishares.com/uk/individual/en/products/253741/ishares-nasdaq-100-ucits-etf/latest-holdings.csv' },
};

function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function parseHoldings(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let asOf = null;
  const hIdx = lines.findIndex((l) => /^"?Ticker"?,/.test(l));
  if (hIdx < 0) return null;
  for (let i = 0; i < hIdx; i++) { const m = /as of[",\s]*"?([^",]+)/i.exec(lines[i]); if (m) { asOf = m[1].trim(); break; } }
  const head = parseCsvLine(lines[hIdx]).map((h) => h.toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const iT = col(/^ticker/), iN = col(/^name/), iS = col(/^sector/), iW = col(/^weight/), iC = col(/asset class/);
  const rows = [];
  for (let i = hIdx + 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if (c.length < head.length - 2 || !c[iT]) break;
    if (iC >= 0 && c[iC] && !/equity/i.test(c[iC])) continue;
    const w = Number(String(c[iW]).replace(/,/g, ''));
    if (!isFinite(w) || w <= 0) continue;
    rows.push([c[iT], c[iN] || '', iS >= 0 ? c[iS] : '', Math.round(w * 1000) / 1000]);
  }
  rows.sort((a, b) => b[3] - a[3]);
  return rows.length ? { asOf, rows: rows.slice(0, 150), count: rows.length } : null;
}

async function refreshEtf(env) {
  const errs = [];
  for (const [key, src] of Object.entries(ETF_SOURCES)) {
    try {
      const res = await fetch(src.url, { headers: { 'User-Agent': 'Mozilla/5.0 (investment-tracker; persoonlijk gebruik)', Accept: 'text/csv,*/*' } });
      if (!res.ok) throw new Error('status ' + res.status);
      const text = await res.text();
      const parsed = parseHoldings(text);
      if (!parsed) throw new Error('geen lijst in het bestand (' + (res.headers.get('content-type') || '?') + ', ' + text.length + ' tekens, begint met: ' + text.slice(0, 160).replace(/\s+/g, ' ') + ')');
      await setKv(env, 'etf_' + key, JSON.stringify(Object.assign({ label: src.label, fund: src.fund }, parsed)));
    } catch (e) { errs.push('ETF ' + src.label + ': ' + e.message); }
  }
  if (!errs.length) await setKv(env, 'etf_updated', new Date().toISOString().slice(0, 10));
  return errs;
}

// Zelf gedownload bestand van de iShares-site (knop "Download latest fund holdings CSV data")
async function uploadEtf(env, key, csv) {
  const src = ETF_SOURCES[key];
  if (!src) throw new Error('Onbekend fonds.');
  if (typeof csv !== 'string' || csv.length > 3e6) throw new Error('Geen geldig bestand.');
  const parsed = parseHoldings(csv);
  if (!parsed) throw new Error('In dit bestand staat geen lijst met Ticker en Weight (%). Gebruik de holdings-CSV van iShares.');
  await setKv(env, 'etf_' + key, JSON.stringify(Object.assign({ label: src.label, fund: src.fund, uploaded: true }, parsed)));
  await setKv(env, 'etf_error', '');
  await saveDataCache(env, await buildData(env));
  return `${src.label}: ${parsed.count} bedrijven ingelezen (stand ${parsed.asOf || 'onbekend'}).`;
}

async function extraData(env) {
  const out = { orders: [], posExtra: {}, peil: [], settings: {}, etf: {} };
  try { out.posExtra = JSON.parse((await getKv(env, 'pos_extra')) || '{}'); } catch (e) { /* leeg */ }
  out.settings = await getSettings(env);
  if ((await getKv(env, 'orders_schema')) === '1') {
    const { results } = await env.DB.prepare('SELECT ts, ticker, name, side, qty, price, currency, fx_rate, net, realised, fee_fx, fee_other, kind FROM orders ORDER BY ts').all();
    out.orders = results.map((r) => [isoLocal(r.ts), r.ticker, r.name, r.side, r.qty, r.price, r.currency, r.fx_rate, r.net, r.realised, r.fee_fx, r.fee_other, r.kind]);
  }
  out.research = {}; out.fin = {}; out.fx = null; out.hicp = null;
  // Deponeringen, 13F, economische agenda, pies en kwartaalcijferdata
  out.ext2 = {};
  try {
    const { results: e2 } = await env.DB.prepare("SELECT key, value FROM kv WHERE key IN ('filings', 'f13', 'econ', 'pies', 'earn_hist')").all();
    e2.forEach((r) => { try { out.ext2[r.key === 'earn_hist' ? 'earnHist' : r.key] = JSON.parse(r.value); } catch (e) { /* overslaan */ } });
  } catch (e) { /* leeg */ }
  const { results: ext } = await env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'rs\\_%' ESCAPE '\\' OR key LIKE 'fin\\_%' ESCAPE '\\' OR key IN ('fx', 'hicp', 'idx', 'market_news')").all();
  ext.forEach((r) => {
    try {
      const v = JSON.parse(r.value);
      if (r.key === 'market_news') out.marketNews = v;
      else if (r.key === 'fx') out.fx = v; else if (r.key === 'hicp') out.hicp = v; else if (r.key === 'idx') out.idx = v;
      else if (r.key.startsWith('rs_')) out.research[r.key.slice(3)] = v; else out.fin[r.key.slice(4)] = v;
    } catch (e) { /* overslaan */ }
  });
  out.flags = await featureFlags(env);
  out.has = { fmp: !!env.FMP_KEY, finnhub: !!env.FINNHUB_KEY, av: !!env.ALPHAVANTAGE_KEY, td: !!env.TWELVEDATA_KEY, sec: !!env.SEC_CONTACT, t212: !!(env.T212_KEY && env.T212_SECRET) };
  const { results: kvs } = await env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'peil_%' OR key LIKE 'etf\\_%' ESCAPE '\\'").all();
  kvs.forEach((r) => {
    try {
      if (r.key.startsWith('peil_')) out.peil.push(JSON.parse(r.value));
      else if (r.key !== 'etf_updated' && r.key !== 'etf_error') out.etf[r.key.slice(4)] = JSON.parse(r.value);
    } catch (e) { /* overslaan */ }
  });
  out.peil.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}


// ---------- Extra bronnen: wisselkoers, inflatie, nieuws/analisten/insiders, bedrijfscijfers ----------
const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const ymdUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

async function getJson(url, headers) {
  const res = await fetch(url, { headers: headers || {} });
  if (!res.ok) return { status: res.status, ok: false, body: await res.text().catch(() => '') };
  try { return { status: res.status, ok: true, body: await res.json() }; } catch (e) { return { status: res.status, ok: false, body: '' }; }
}

// Geeft het aantal gebruikte externe verzoeken terug
async function externalTask(env, kind, arg) {
  if (kind === 'fx') {
    // ECB-referentiekoersen via Frankfurter, 400 dagen terug
    const since = ymdUTC(Date.now() - 400 * 864e5);
    const rates = { USD: [], GBP: [] };
    let source = 'ECB via Frankfurter';
    const r = (await srcDown(env, 'frankfurter')) ? { ok: false, status: 'reserve' } : await getJson('https://api.frankfurter.dev/v1/' + since + '..?from=EUR&to=USD,GBP');
    if (r.ok && r.body && r.body.rates) {
      Object.keys(r.body.rates).sort().forEach((d) => { const o = r.body.rates[d]; if (o.USD) rates.USD.push([d, o.USD]); if (o.GBP) rates.GBP.push([d, o.GBP]); });
      await srcOk(env, 'frankfurter');
    } else {
      // Reserve: dezelfde referentiekoersen rechtstreeks van het ECB Data Portal
      if (r.status !== 'reserve') await srcFail(env, 'frankfurter', 'Frankfurter gaf ' + r.status);
      const res = await fetch('https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP.EUR.SP00.A?format=csvdata&startPeriod=' + since);
      if (!res.ok) { await noteExtError(env, 'fx', 'Frankfurter en het ECB Data Portal gaven geen koersen (' + r.status + ', ' + res.status + ')'); return 2; }
      const lines = (await res.text()).trim().split(/\r?\n/);
      const head = lines[0].split(',');
      const iC = head.indexOf('CURRENCY'), iT = head.indexOf('TIME_PERIOD'), iV = head.indexOf('OBS_VALUE');
      lines.slice(1).map((l) => l.split(',')).filter((c) => rates[c[iC]] && c[iT] && c[iV] !== '' && isFinite(Number(c[iV])))
        .sort((a, b) => a[iT].localeCompare(b[iT])).forEach((c) => rates[c[iC]].push([c[iT], Number(c[iV])]));
      source = 'ECB Data Portal (reserve voor Frankfurter)';
      await srcBackup(env, 'frankfurter', 'ECB Data Portal');
    }
    if (!rates.USD.length) { await noteExtError(env, 'fx', 'Geen koersen ontvangen.'); return 2; }
    await setKv(env, 'fx', JSON.stringify({ updated: isoLocal(Date.now()), source, rates }));
    await noteExtError(env, 'fx', null);
    return 1;
  }
  if (kind === 'hicp') {
    // HICP-index van de ECB (2025 = 100), Nederland en eurozone
    const start = new Date(); start.setFullYear(start.getFullYear() - 6);
    const out = { updated: isoLocal(Date.now()), source: 'ECB Data Portal, HICP', series: {} };
    for (const area of ['NL', 'U2']) {
      const url = 'https://data-api.ecb.europa.eu/service/data/HICP/M.' + area + '.N.000000.4D0.INX?format=csvdata&startPeriod=' + start.toISOString().slice(0, 7);
      const res = await fetch(url);
      if (res.ok) {
        const lines = (await res.text()).trim().split(/\r?\n/);
        const head = lines[0].split(',');
        const iT = head.indexOf('TIME_PERIOD'), iV = head.indexOf('OBS_VALUE');
        out.series[area] = lines.slice(1).map((l) => l.split(',')).filter((c) => c[iT] && isFinite(Number(c[iV]))).map((c) => [c[iT], Number(c[iV])]);
        if (out.series[area].length) continue;
      }
      // Reserve: dezelfde HICP-index bij Eurostat (andere basis, 2015 = 100; de site rekent alleen met verhoudingen)
      const geo = area === 'U2' ? 'EA' : area;
      const es = await getJson('https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_midx?format=JSON&lang=EN&geo=' + geo + '&coicop=CP00&unit=I15&sinceTimePeriod=' + start.toISOString().slice(0, 7));
      const ti = es.ok && es.body && es.body.dimension && es.body.dimension.time && es.body.dimension.time.category && es.body.dimension.time.category.index;
      if (!ti) { await noteExtError(env, 'inflation', 'ECB gaf ' + res.status + ' en Eurostat gaf ' + es.status); continue; }
      out.series[area] = Object.entries(ti).sort((a, b) => a[1] - b[1]).map(([p, i]) => [p, numOrNull(es.body.value[i])]).filter((x) => x[1] != null);
      out.source = 'Eurostat (reserve voor de ECB), HICP 2015 = 100';
      await srcBackup(env, 'ecb_hicp', 'Eurostat');
    }
    if (Object.keys(out.series).length) { await setKv(env, 'hicp', JSON.stringify(out)); await noteExtError(env, 'inflation', null); }
    return 2;
  }
  if (kind === 'idx') {
    // Dagkoersen van de S&P 500 en de Nasdaq-100 (koersindex, in dollars) uit FRED van de Federal Reserve Bank of St. Louis
    const out = { updated: isoLocal(Date.now()), source: 'FRED (Federal Reserve Bank of St. Louis)', series: {} };
    const since = ymdUTC(Date.now() - 400 * 864e5);
    // Ook de VIX, de Amerikaanse 10-jaarsrente en de ECB-depositorente, voor het marktoverzicht
    for (const id of ['SP500', 'NASDAQ100', 'VIXCLS', 'DGS10', 'ECBDFR']) {
      if (env.FRED_KEY) {
        // Officiële FRED-API (gratis sleutel)
        const res = await fetch('https://api.stlouisfed.org/fred/series/observations?series_id=' + id + '&observation_start=' + since + '&file_type=json&api_key=' + encodeURIComponent(env.FRED_KEY));
        if (!res.ok) { await noteExtError(env, 'indices', 'FRED-API gaf ' + res.status + (res.status === 400 ? ' (controleer de sleutel)' : '')); continue; }
        const j = await res.json().catch(() => null);
        out.series[id] = ((j && j.observations) || []).filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.value !== '.' && isFinite(Number(o.value))).map((o) => [o.date, Number(o.value)]);
        continue;
      }
      const res = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + id + '&cosd=' + since,
        { headers: { 'User-Agent': 'investment-tracker (persoonlijke beleggingstracker)' } });
      if (!res.ok) { await noteExtError(env, 'indices', 'FRED gaf ' + res.status + ' op de downloadlink. Met een gratis FRED-sleutel (FRED_KEY) gebruikt de Worker de officiële API.'); break; }
      out.series[id] = (await res.text()).trim().split(/\r?\n/).slice(1).map((l) => l.split(','))
        .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c[0]) && isFinite(Number(c[1])) && c[1] !== '').map((c) => [c[0], Number(c[1])]);
    }
    // Reserve: dezelfde indexen bij FMP (^GSPC en ^NDX), als FRED niets gaf en er een FMP-sleutel is
    const missing = ['SP500', 'NASDAQ100'].filter((id) => !(out.series[id] && out.series[id].length));
    if (missing.length && env.FMP_KEY && !(await srcDown(env, 'fmp'))) {
      for (const id of missing) {
        try {
          const rows = await fmp(env, '/historical-price-eod/light?symbol=' + (id === 'SP500' ? '%5EGSPC' : '%5ENDX') + '&from=' + since);
          out.series[id] = rows.filter((x) => x.date && isFinite(Number(x.price))).map((x) => [x.date, Number(x.price)]).sort((a, b) => a[0].localeCompare(b[0]));
        } catch (e) { /* ook FMP lukt niet: dan blijft de vorige reeks staan */ }
      }
      if (missing.some((id) => out.series[id] && out.series[id].length)) { out.source = 'FMP (reserve voor FRED)'; await srcBackup(env, 'fred', 'FMP'); }
    }
    if (!Object.keys(out.series).some((id) => out.series[id] && out.series[id].length)) return 5;
    // Lege extra reeksen (VIX, rentes) niet bewaren; de vorige blijven dan staan
    let prevIdx = null; try { prevIdx = JSON.parse((await getKv(env, 'idx')) || 'null'); } catch (e) { prevIdx = null; }
    ['VIXCLS', 'DGS10', 'ECBDFR'].forEach((id) => { if (!(out.series[id] && out.series[id].length) && prevIdx && prevIdx.series && prevIdx.series[id]) out.series[id] = prevIdx.series[id]; });
    if (Object.keys(out.series).length) { await setKv(env, 'idx', JSON.stringify(out)); await noteExtError(env, 'indices', null); }
    return 5;
  }
  if (kind === 'filings') return secFilings(env);
  if (kind === 'f13') return fetch13F(env);
  if (kind === 'econ') return econCalendar(env);
  if (kind === 'pies') return fetchPies(env);
  if (kind === 'fhnews') {
    // Algemeen marktnieuws van Finnhub (gratis sleutel), voor de nieuwspagina
    if (!env.FINNHUB_KEY) return 0;
    const r = await getJson(FINNHUB_BASE + '/news?category=general&token=' + encodeURIComponent(env.FINNHUB_KEY));
    if (r.status === 401) { await noteExtError(env, 'finnhub', 'Finnhub-sleutel ongeldig (401).'); return 1; }
    if (!r.ok) return 1;
    const items = (Array.isArray(r.body) ? r.body : []).filter((n) => n.headline && /^https:\/\//.test(n.url || '')).sort((a, c) => c.datetime - a.datetime).slice(0, 30)
      .map((n) => ({ t: n.datetime * 1000, headline: String(n.headline).slice(0, 220), summary: String(n.summary || '').slice(0, 300), source: n.source || '', url: n.url, related: String(n.related || '').slice(0, 60) }));
    await setKv(env, 'market_news', JSON.stringify({ updated: isoLocal(Date.now()), items }));
    return 1;
  }
  if (kind === 'companies') return refreshCompanies(env);
  if (kind === 'fh') return finnhubTask(env, arg);
  if (kind === 'av') return avTask(env, arg);
  if (kind === 'sec') return secTask(env, arg);
  return 0;
}

// ---------- Alpha Vantage: reserve voor Finnhub ----------
// Gratis sleutel: 25 verzoeken per dag en 5 per minuut. Vult alleen aan wat Finnhub niet levert
// (geen sleutel, limiet, ontbrekend onderdeel in het abonnement of al dagen geen nieuwe gegevens).
const AV_BASE = 'https://www.alphavantage.co/query';
const AV_DAY_BUDGET = 24;
const AV_PARTS = ['rec', 'target', 'news', 'sent', 'eps', 'insider'];

async function avCount(env, n) {
  const day = parts(new Date()).day;
  let c = {};
  try { c = JSON.parse((await getKv(env, 'av_calls')) || '{}'); } catch (e) { c = {}; }
  const used = c.day === day ? c.n : 0;
  if (n === 0) return AV_DAY_BUDGET - used;
  await setKv(env, 'av_calls', JSON.stringify({ day, n: used + n }));
  return AV_DAY_BUDGET - used - n;
}

async function av(env, fn, params) {
  const url = AV_BASE + '?function=' + fn + '&' + params + '&apikey=' + encodeURIComponent(env.ALPHAVANTAGE_KEY);
  const r = await getJson(url);
  if (r.status === 429) throw new Error('Alpha Vantage-limiet bereikt');
  if (!r.ok) throw new Error('Alpha Vantage gaf ' + r.status);
  const b = r.body || {};
  const msg = b.Information || b.Note || b['Error Message'];
  if (msg) {
    if (/rate limit|requests per (day|minute)|frequency/i.test(msg)) throw new Error('Alpha Vantage-limiet bereikt');
    if (/premium/i.test(msg)) return { premium: true };
    if (b['Error Message']) return { unknown: true };
  }
  return b;
}

// Welke onderdelen Alpha Vantage moet aanvullen voor dit aandeel
function avNeeds(prev, finnhubOn) {
  const old = !prev.updated || prev.updated < isoLocal(Date.now() - 2 * 864e5);
  const denied = prev.denied || [];
  return AV_PARTS.filter((k) => !finnhubOn || old || denied.includes(k) || prev[k] == null);
}

async function avTask(env, tk) {
  if (!env.ALPHAVANTAGE_KEY) return 0;
  const sym = SYMBOL_MAP[tk] || tk;
  let prev = {};
  try { prev = JSON.parse((await getKv(env, 'rs_' + tk)) || '{}'); } catch (e) { prev = {}; }
  const need = avNeeds(prev, !!env.FINNHUB_KEY);
  if (!need.length) return 0;
  const calls = [];
  if (need.includes('rec') || need.includes('target')) calls.push('OVERVIEW');
  if (need.includes('news') || need.includes('sent')) calls.push('NEWS_SENTIMENT');
  if (need.includes('eps')) calls.push('EARNINGS');
  if (need.includes('insider')) calls.push('INSIDER_TRANSACTIONS');
  if ((await avCount(env, 0)) < calls.length) throw new Error('Alpha Vantage-limiet bereikt (dagbudget)');
  const out = Object.assign({}, prev, { symbol: sym });
  const src = Object.assign({}, prev.src || {});
  const set = (k, v) => { if (v != null && need.includes(k)) { out[k] = v; src[k] = 'av'; } };
  let used = 0;
  try {
    for (const fn of calls) {
      if (used) await sleep(1200);
      used++;
      if (fn === 'OVERVIEW') {
        const b = await av(env, fn, 'symbol=' + encodeURIComponent(sym));
        if (b.premium || b.unknown || !b.Symbol) continue;
        const n = (k) => numOrNull(b[k]);
        const rec = { period: parts(new Date()).day.slice(0, 7) + '-01', sb: n('AnalystRatingStrongBuy'), b: n('AnalystRatingBuy'), h: n('AnalystRatingHold'), s: n('AnalystRatingSell'), ss: n('AnalystRatingStrongSell') };
        if ([rec.sb, rec.b, rec.h, rec.s, rec.ss].some((x) => x != null)) {
          // Eén momentopname per maand bewaren, nieuwste eerst (zoals bij Finnhub)
          const hist = (src.rec === 'av' && Array.isArray(prev.rec) ? prev.rec : []).filter((r) => r.period !== rec.period);
          set('rec', [rec].concat(hist).slice(0, 6));
        }
        const t = n('AnalystTargetPrice');
        if (t != null && t > 0) set('target', { mean: t, median: null, high: null, low: null, updated: parts(new Date()).day });
      } else if (fn === 'NEWS_SENTIMENT') {
        const b = await av(env, fn, 'tickers=' + encodeURIComponent(sym) + '&sort=LATEST&limit=50');
        if (b.premium || !Array.isArray(b.feed)) continue;
        const when = (s) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(s || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; };
        const items = b.feed.map((a) => ({ a, t: when(a.time_published), ts: (a.ticker_sentiment || []).find((x) => x.ticker === sym) }))
          .filter((x) => x.t && x.a.title && x.a.url && (!x.ts || Number(x.ts.relevance_score) >= 0.2));
        set('news', items.filter((x) => x.t >= Date.now() - 10 * 864e5).slice(0, 6)
          .map((x) => ({ t: x.t, headline: String(x.a.title).slice(0, 220), source: x.a.source || '', url: x.a.url })));
        const week = items.filter((x) => x.ts && x.t >= Date.now() - 7 * 864e5);
        const pos = week.filter((x) => /bullish/i.test(x.ts.ticker_sentiment_label)).length;
        const neg = week.filter((x) => /bearish/i.test(x.ts.ticker_sentiment_label)).length;
        if (pos + neg) set('sent', { bull: pos / (pos + neg), bear: neg / (pos + neg), score: null, sector: null, articles: week.length, buzz: null });
      } else if (fn === 'EARNINGS') {
        const b = await av(env, fn, 'symbol=' + encodeURIComponent(sym));
        if (b.premium || !Array.isArray(b.quarterlyEarnings)) continue;
        set('eps', b.quarterlyEarnings.filter((x) => numOrNull(x.reportedEPS) != null).slice(0, 4)
          .map((x) => ({ period: x.fiscalDateEnding, actual: numOrNull(x.reportedEPS), estimate: numOrNull(x.estimatedEPS), pct: numOrNull(x.surprisePercentage) })));
      } else if (fn === 'INSIDER_TRANSACTIONS') {
        const b = await av(env, fn, 'symbol=' + encodeURIComponent(sym));
        if (b.premium || !Array.isArray(b.data)) continue;
        const from = ymdUTC(Date.now() - 180 * 864e5);
        // Alpha Vantage zegt alleen verkregen (A) of afgestaan (D); kopen en toekenning zijn niet te scheiden
        set('insider', b.data.filter((x) => x.transaction_date && x.transaction_date >= from)
          .sort((a, c) => c.transaction_date.localeCompare(a.transaction_date)).slice(0, 25)
          .map((x) => {
            const sh = numOrNull(x.shares), d = x.acquisition_or_disposal === 'D';
            return { name: x.executive, date: x.transaction_date, code: d ? 'DS' : 'AQ', change: sh == null ? null : (d ? -sh : sh), price: numOrNull(x.share_price), shares: null };
          }));
      }
    }
  } finally {
    await avCount(env, used);
  }
  out.src = src;
  out.avAt = isoLocal(Date.now());
  if (!prev.updated) out.updated = out.avAt;
  await setKv(env, 'rs_' + tk, JSON.stringify(out));
  await noteExtError(env, 'alphavantage', null);
  return used;
}

// Profiel in dezelfde vorm als bij FMP, uit Finnhub: profile2 (naam, branche, beurswaarde), quote (koers) en metric (beta, jaarbereik)
async function profileFromFinnhub(env, sym) {
  if (!env.FINNHUB_KEY) return null;
  const q = (path) => getJson(FINNHUB_BASE + path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(env.FINNHUB_KEY));
  const pr = await q('/stock/profile2?symbol=' + encodeURIComponent(sym));
  const qt = await q('/quote?symbol=' + encodeURIComponent(sym));
  const mt = await q('/stock/metric?symbol=' + encodeURIComponent(sym) + '&metric=all');
  if (pr.status === 429 || qt.status === 429) { await srcFail(env, 'finnhub', 'Finnhub-limiet', true); throw new Error('Finnhub-limiet bereikt'); }
  const p = pr.ok ? pr.body || {} : {}, t = qt.ok ? qt.body || {} : {}, m = (mt.ok && mt.body && mt.body.metric) || {};
  if (!p.name && !numOrNull(t.c)) return null;
  const hi = numOrNull(m['52WeekHigh']), lo = numOrNull(m['52WeekLow']);
  return {
    symbol: sym, name: p.name || sym, price: numOrNull(t.c) || null, currency: p.currency || 'USD',
    marketCap: numOrNull(p.marketCapitalization) != null ? numOrNull(p.marketCapitalization) * 1e6 : null,
    beta: numOrNull(m.beta), lastDividend: numOrNull(m.dividendPerShareAnnual), range: lo != null && hi != null ? lo + '-' + hi : null,
    change: numOrNull(t.dp), sector: FINNHUB_SECTOR[p.finnhubIndustry] || p.finnhubIndustry || null, industry: p.finnhubIndustry || null,
    exchange: p.exchange || null, country: p.country || null, employees: null, ipoDate: p.ipo || null, isEtf: false, website: p.weburl || null, cik: null,
    source: 'Finnhub',
  };
}
// Finnhub-branches naar de sectornamen die de site (en FMP) gebruikt
const FINNHUB_SECTOR = {
  Technology: 'Technology', Semiconductors: 'Technology', Software: 'Technology', Communications: 'Communication Services', Media: 'Communication Services',
  Pharmaceuticals: 'Healthcare', Biotechnology: 'Healthcare', 'Health Care': 'Healthcare', 'Life Sciences Tools & Services': 'Healthcare',
  Banking: 'Financial Services', 'Financial Services': 'Financial Services', Insurance: 'Financial Services',
  Retail: 'Consumer Cyclical', Automobiles: 'Consumer Cyclical', 'Hotels, Restaurants & Leisure': 'Consumer Cyclical', 'Textiles, Apparel & Luxury Goods': 'Consumer Cyclical',
  Beverages: 'Consumer Defensive', 'Food Products': 'Consumer Defensive', 'Consumer products': 'Consumer Defensive', Tobacco: 'Consumer Defensive',
  'Aerospace & Defense': 'Industrials', Machinery: 'Industrials', Airlines: 'Industrials', Logistics: 'Industrials', 'Electrical Equipment': 'Industrials',
  Energy: 'Energy', 'Oil & Gas': 'Energy', Utilities: 'Utilities', 'Real Estate': 'Real Estate', Chemicals: 'Basic Materials', Metals: 'Basic Materials',
};

// Dagkoersen van Alpha Vantage (gratis: de laatste 100 handelsdagen); telt mee in het dagbudget
async function avDaily(env, sym) {
  if (!env.ALPHAVANTAGE_KEY) return [];
  await avCount(env, 1);
  const b = await av(env, 'TIME_SERIES_DAILY', 'symbol=' + encodeURIComponent(sym) + '&outputsize=compact');
  const ser = b && b['Time Series (Daily)'];
  if (!ser) return [];
  return Object.entries(ser).map(([d, o]) => [d, numOrNull(o['4. close'])]).filter((x) => x[1] != null).sort((a, b2) => a[0].localeCompare(b2[0]));
}

async function finnhubTask(env, tk) {
  if (!env.FINNHUB_KEY) return 0;
  const sym = SYMBOL_MAP[tk] || tk;
  let denied = [];
  try { denied = JSON.parse((await getKv(env, 'fh_denied')) || '[]'); } catch (e) { denied = []; }
  const today = ymdUTC(Date.now());
  const q = (path) => FINNHUB_BASE + path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(env.FINNHUB_KEY);
  const parts2 = {
    news: '/company-news?symbol=' + sym + '&from=' + ymdUTC(Date.now() - 10 * 864e5) + '&to=' + today,
    rec: '/stock/recommendation?symbol=' + sym,
    eps: '/stock/earnings?symbol=' + sym + '&limit=4',
    insider: '/stock/insider-transactions?symbol=' + sym + '&from=' + ymdUTC(Date.now() - 180 * 864e5) + '&to=' + today,
    target: '/stock/price-target?symbol=' + sym,
    sent: '/news-sentiment?symbol=' + sym,
  };
  let prev = {};
  try { prev = JSON.parse((await getKv(env, 'rs_' + tk)) || '{}'); } catch (e) { prev = {}; }
  const out = Object.assign({}, prev, { symbol: sym, updated: isoLocal(Date.now()) });
  let calls = 0;
  for (const [k, path] of Object.entries(parts2)) {
    if (denied.includes(k)) continue;
    calls++;
    const r = await getJson(q(path));
    if (r.status === 401) { await noteExtError(env, 'finnhub', 'Finnhub-sleutel ongeldig (401).'); throw new Error('Finnhub-sleutel ongeldig'); }
    if (r.status === 429) throw new Error('Finnhub-limiet bereikt');
    if (r.status === 403) { denied.push(k); await setKv(env, 'fh_denied', JSON.stringify(denied)); continue; }
    if (!r.ok) continue;
    const b = r.body;
    // Finnhub levert dit onderdeel weer zelf: de aanvulling van Alpha Vantage vervalt
    if (out.src && out.src[k]) { out.src = Object.assign({}, out.src); delete out.src[k]; }
    if (k === 'news') {
      out.news = (Array.isArray(b) ? b : []).filter((n) => n.headline && n.url).sort((a, c) => c.datetime - a.datetime).slice(0, 6)
        .map((n) => ({ t: n.datetime * 1000, headline: String(n.headline).slice(0, 220), source: n.source || '', url: n.url }));
    } else if (k === 'rec') {
      out.rec = (Array.isArray(b) ? b : []).slice(0, 6).map((x) => ({ period: x.period, sb: x.strongBuy, b: x.buy, h: x.hold, s: x.sell, ss: x.strongSell }));
    } else if (k === 'eps') {
      out.eps = (Array.isArray(b) ? b : []).slice(0, 4).map((x) => ({ period: x.period, actual: numOrNull(x.actual), estimate: numOrNull(x.estimate), pct: numOrNull(x.surprisePercent) }));
    } else if (k === 'insider') {
      const list = (b && Array.isArray(b.data) ? b.data : []).filter((x) => x.transactionDate);
      list.sort((a, c) => c.transactionDate.localeCompare(a.transactionDate));
      out.insider = list.slice(0, 25).map((x) => ({ name: x.name, date: x.transactionDate, code: x.transactionCode, change: numOrNull(x.change), price: numOrNull(x.transactionPrice), shares: numOrNull(x.share) }));
      try { await alertInsider(env, tk, prev.insider, out.insider); } catch (e) { console.error('meldingen', e); }
    } else if (k === 'target') {
      out.target = b && isFinite(Number(b.targetMean)) && Number(b.targetMean) > 0 ? { mean: numOrNull(b.targetMean), median: numOrNull(b.targetMedian), high: numOrNull(b.targetHigh), low: numOrNull(b.targetLow), updated: b.lastUpdated || null } : null;
    } else if (k === 'sent') {
      out.sent = b && b.sentiment ? { bull: numOrNull(b.sentiment.bullishPercent), bear: numOrNull(b.sentiment.bearishPercent), score: numOrNull(b.companyNewsScore),
        sector: numOrNull(b.sectorAverageNewsScore), articles: b.buzz ? numOrNull(b.buzz.articlesInLastWeek) : null, buzz: b.buzz ? numOrNull(b.buzz.buzz) : null } : null;
    }
  }
  out.denied = denied;
  // Koersdoel-geschiedenis (één per week), zodat de site later kan nagaan of koersdoelen uitkwamen
  if (out.target && isFinite(out.target.mean)) {
    const th = Array.isArray(prev.targetHist) ? prev.targetHist.slice() : [];
    const last = th[th.length - 1];
    if (!last || last.d <= ymdUTC(Date.now() - 6 * 864e5)) th.push({ d: today, mean: out.target.mean });
    out.targetHist = th.slice(-60);
  }
  await setKv(env, 'rs_' + tk, JSON.stringify(out));
  await noteExtError(env, 'finnhub', null);
  return calls;
}

const SEC_TAGS = {
  rev: [['us-gaap', 'RevenueFromContractWithCustomerExcludingAssessedTax'], ['us-gaap', 'Revenues'], ['us-gaap', 'SalesRevenueNet'], ['ifrs-full', 'Revenue']],
  net: [['us-gaap', 'NetIncomeLoss'], ['ifrs-full', 'ProfitLossAttributableToOwnersOfParent'], ['ifrs-full', 'ProfitLoss']],
  op: [['us-gaap', 'OperatingIncomeLoss'], ['ifrs-full', 'ProfitLossFromOperatingActivities']],
  eps: [['us-gaap', 'EarningsPerShareDiluted'], ['ifrs-full', 'DilutedEarningsPerShare']],
};

function annualFrom(concept) {
  const units = concept && concept.units ? concept.units : {};
  const unit = units.USD ? 'USD' : units['USD/shares'] ? 'USD/shares' : Object.keys(units)[0];
  if (!unit) return null;
  const byYear = new Map();
  units[unit].forEach((x) => {
    if (!isFinite(Number(x.val))) return;
    const m = /^CY(\d{4})$/.exec(x.frame || '');
    if (m) { byYear.set(Number(m[1]), Number(x.val)); return; }
    // Zonder frame: jaarcijfer uit een jaarverslag (ongeveer 1 jaar lang)
    if (x.fp === 'FY' && /^(10-K|20-F|40-F)/.test(x.form || '') && x.start && x.end) {
      const days = (Date.parse(x.end) - Date.parse(x.start)) / 864e5;
      const y = Number(x.end.slice(0, 4));
      if (days > 330 && days < 400 && !byYear.has(y)) byYear.set(y, Number(x.val));
    }
  });
  const rows = [...byYear.entries()].sort((a, b) => a[0] - b[0]).slice(-6);
  return rows.length ? { unit, rows } : null;
}

async function secTask(env, tk) {
  if (!env.SEC_CONTACT) return 0;
  const sym = SYMBOL_MAP[tk] || tk;
  const H = { 'User-Agent': 'investment-tracker (' + env.SEC_CONTACT + ')', Accept: 'application/json' };
  let calls = 0;
  // CIK: uit het FMP-profiel, eerder opgezocht, of via EDGAR
  let ciks = {};
  try { ciks = JSON.parse((await getKv(env, 'sec_cik')) || '{}'); } catch (e) { ciks = {}; }
  let cik = ciks[sym];
  if (!cik) {
    const prof = await env.DB.prepare('SELECT data FROM ext_profile WHERE symbol = ?').bind(sym).first().catch(() => null);
    try { cik = prof && JSON.parse(prof.data).cik; } catch (e) { cik = null; }
  }
  if (!cik) {
    calls++;
    const res = await fetch('https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + encodeURIComponent(sym) + '&type=10-K&dateb=&owner=include&count=1&output=atom', { headers: H });
    const m = res.ok ? /<cik>\s*(\d+)\s*<\/cik>/i.exec(await res.text()) : null;
    cik = m ? m[1] : null;
  }
  if (!cik) { await setKv(env, 'fin_' + tk, JSON.stringify({ updated: ymdUTC(Date.now()), none: 'Geen SEC-gegevens gevonden (geen Amerikaanse jaarverslagen).' })); return calls; }
  cik = String(cik).padStart(10, '0');
  ciks[sym] = cik;
  await setKv(env, 'sec_cik', JSON.stringify(ciks));
  const out = { updated: ymdUTC(Date.now()), cik, series: {} };
  let taxonomy = null;
  for (const [k, list] of Object.entries(SEC_TAGS)) {
    for (const [tax, tag] of list) {
      if (taxonomy && tax !== taxonomy) continue;
      calls++;
      const r = await getJson('https://data.sec.gov/api/xbrl/companyconcept/CIK' + cik + '/' + tax + '/' + tag + '.json', H);
      if (r.status === 403) throw new Error('SEC weigerde (403); controleer het contactadres');
      if (!r.ok) continue;
      const a = annualFrom(r.body);
      if (a && a.rows[a.rows.length - 1][0] >= new Date().getFullYear() - 2) { out.series[k] = Object.assign({ tag }, a); taxonomy = tax; break; }
    }
  }
  if (!Object.keys(out.series).length) out.none = 'Geen jaarcijfers gevonden in de SEC-gegevens.';
  await setKv(env, 'fin_' + tk, JSON.stringify(out));
  await noteExtError(env, 'sec', null);
  return calls;
}

// ---------- Markt: sector, branche en vergelijkbare bedrijven (FMP) ----------
// Gratis bij FMP: bedrijfsprofielen (sector, branche, beurswaarde, beta, jaarbereik, koers), vergelijkbare
// bedrijven, en per dag de gemiddelde koersverandering per sector en branche. Koershistorie alleen voor een
// beperkte lijst grote namen. De Worker werkt een wachtrij af buiten de meetvensters, binnen een dagbudget.
const FMP_DAY_BUDGET = 230;
const MARKET_STEP_CALLS = 30;
const PEERS_PER_STOCK = 5;
const PERF_BACKFILL_DAYS = 20;

// Teller van FMP-verzoeken per dag; één keer gelezen en aan het eind weggeschreven (scheelt databasevragen)
async function countFmp(env) {
  const day = parts(new Date()).day;
  if (!env._fmp || env._fmp.day !== day) {
    let c = {};
    try { c = JSON.parse((await getKv(env, 'fmp_calls')) || '{}'); } catch (e) { c = {}; }
    env._fmp = { day, n: c.day === day ? c.n : 0 };
  }
  if (env._fmp.n >= FMP_DAY_BUDGET) throw new Error('FMP-limiet bereikt (dagbudget)');
  env._fmp.n++;
}

async function flushFmp(env) {
  if (env._fmp) await setKv(env, 'fmp_calls', JSON.stringify({ day: env._fmp.day, n: env._fmp.n }));
}

async function ensureMarketTables(env) {
  if ((await getKv(env, 'market_schema')) === '1') return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ext_profile (symbol TEXT PRIMARY KEY, data TEXT, updated TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ext_peers (symbol TEXT PRIMARY KEY, peers TEXT, updated TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ext_prices (symbol TEXT NOT NULL, day TEXT NOT NULL, price REAL, PRIMARY KEY (symbol, day))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ext_perf (day TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, exchange TEXT NOT NULL, change REAL, PRIMARY KEY (day, kind, name, exchange))'),
  ]);
  await setKv(env, 'market_schema', '1');
}

// Laatste afgesloten Amerikaanse handelsdag (feestdagen niet meegerekend)
function lastUsDay(now) {
  const p = parts(now);
  const d = new Date(p.day + 'T12:00:00Z');
  // Voor 22:30 Amsterdamse tijd is de beurs van vandaag nog niet dicht
  if (p.hm < '22:30') d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function prevWeekdays(day, n) {
  const out = [];
  const d = new Date(day + 'T12:00:00Z');
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

async function heldStocks(env) {
  const last = await env.DB.prepare('SELECT MAX(ts) AS ts FROM intraday').first();
  let results;
  if (last && last.ts) {
    ({ results } = await env.DB.prepare('SELECT ticker, name FROM intraday WHERE ts = ? AND ticker != ?').bind(last.ts, TOTAL).all());
  } else {
    ({ results } = await env.DB.prepare('SELECT ticker, name FROM positions WHERE date = (SELECT MAX(date) FROM positions)').all());
  }
  return results.filter((r) => !ETF_RE.test(r.name || '')).map((r) => ({ ticker: r.ticker, symbol: SYMBOL_MAP[r.ticker] || r.ticker }));
}

// Volglijst: aandelen die je niet hebt maar wel wilt volgen (ticker = beurssymbool)
async function watchStocks(env) {
  const s = await getSettings(env);
  return ((s && s.watchlist) || []).map((sym) => ({ ticker: sym, symbol: sym, watch: true }));
}
// Volglijst plus de gekozen maatstaf: voor koersgeschiedenis en profielen, niet voor meldingen
async function extraStocks(env) {
  const s = await getSettings(env);
  const list = await watchStocks(env);
  if (s && s.benchmark && !list.some((w) => w.symbol === s.benchmark)) list.push({ ticker: s.benchmark, symbol: s.benchmark, watch: true, bench: true });
  return list;
}

// Zet de taken voor vandaag klaar (1x per dag na de agenda, of handmatig)
async function planMarket(env) {
  await ensureMarketTables(env);
  const now = new Date();
  const usDay = lastUsDay(now);
  const held = await heldStocks(env);
  const watch = (await extraStocks(env)).filter((w) => !held.some((h) => h.symbol === w.symbol));
  const all = held.concat(watch);
  const tasks = [];
  const flags = await featureFlags(env);
  // Bronnen zonder sleutel eerst: wisselkoersen, inflatie en indexen (1x per dag, klein)
  if (flags.fx) tasks.push('fx');
  if (flags.inflation) tasks.push('hicp');
  if (flags.indices) tasks.push('idx');
  if (env.FINNHUB_KEY) { tasks.push('fhnews'); all.forEach((h) => tasks.push('fh:' + h.ticker)); }
  if (env.ALPHAVANTAGE_KEY) {
    // Reserve: aandelen waar Finnhub iets mist, langst niet aangevuld eerst; het dagbudget bepaalt hoeveel er lukken
    const { results: rs } = await env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'rs\\_%' ESCAPE '\\'").all();
    const rsMap = new Map(rs.map((r) => { try { return [r.key.slice(3), JSON.parse(r.value)]; } catch (e) { return [r.key.slice(3), {}]; } }));
    const today = parts(now).day;
    all.map((h) => ({ tk: h.ticker, prev: rsMap.get(h.ticker) || {} }))
      .filter((x) => (x.prev.avAt || '').slice(0, 10) < today && avNeeds(x.prev, !!env.FINNHUB_KEY).length)
      .sort((a, b) => (a.prev.avAt || '').localeCompare(b.prev.avAt || ''))
      .forEach((x) => tasks.push('av:' + x.tk));
  }
  if (env.SEC_CONTACT) {
    let cm = null; try { cm = JSON.parse((await getKv(env, 'companies_meta')) || 'null'); } catch (e) { cm = null; }
    if (!cm || cm.updated < new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)) tasks.push('companies');
  }
  // Deponeringen bij de SEC (dagelijks) en de 13F-lijsten van grote beleggers (wekelijks)
  if (env.SEC_CONTACT) {
    tasks.push('filings');
    let f13 = null;
    try { f13 = JSON.parse((await getKv(env, 'f13')) || 'null'); } catch (e) { f13 = null; }
    if (!f13 || (f13.updated || '') < new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)) tasks.push('f13');
  }
  // Economische agenda (FRED, met sleutel) en Trading 212-pies, één keer per dag
  if (env.FRED_KEY) tasks.push('econ');
  if (env.T212_KEY && env.T212_SECRET) tasks.push('pies');
  if (env.TWELVEDATA_KEY || env.ALPHAVANTAGE_KEY) {
    // Symbolen waarvoor FMP geen koershistorie geeft (gratis abonnement): via Twelve Data of Alpha Vantage
    await ensureMarketTables(env);
    const nh = JSON.parse((await getKv(env, 'eod_unavailable')) || '[]');
    const { results: hn2 } = await env.DB.prepare('SELECT symbol, COUNT(*) AS n FROM ext_prices GROUP BY symbol').all();
    const n2 = new Map(hn2.map((r) => [r.symbol, r.n]));
    const wl = new Set(watch.map((w) => w.symbol));
    nh.filter((sym) => (n2.get(sym) || 0) < 20).sort((a, b) => (wl.has(b) ? 1 : 0) - (wl.has(a) ? 1 : 0)).forEach((sym) => tasks.push('eod2:' + sym));
  }
  if (flags.sec && env.SEC_CONTACT) {
    const { results: fins } = await env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'fin\\_%' ESCAPE '\\'").all();
    const age = new Map(fins.map((r) => { try { return [r.key.slice(4), JSON.parse(r.value).updated || '']; } catch (e) { return [r.key.slice(4), '']; } }));
    const weekAgo2 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    all.forEach((h) => { if ((age.get(h.ticker) || '') < weekAgo2) tasks.push('sec:' + h.ticker); });
  }
  if (!env.FMP_KEY) {
    // Zonder FMP: profielen (koers, branche, beta) via Finnhub en koersgeschiedenis via Alpha Vantage, als die sleutels er zijn
    if (env.FINNHUB_KEY || env.ALPHAVANTAGE_KEY) {
      await ensureMarketTables(env);
      const { results: fr } = await env.DB.prepare('SELECT symbol FROM ext_profile WHERE updated = ?').bind(usDay).all();
      const freshP = new Set(fr.map((r) => r.symbol));
      const { results: hn } = await env.DB.prepare('SELECT symbol, COUNT(*) AS n FROM ext_prices GROUP BY symbol').all();
      const nMap = new Map(hn.map((r) => [r.symbol, r.n]));
      all.forEach((h) => {
        if (env.FINNHUB_KEY && !freshP.has(h.symbol)) tasks.push('profile:' + h.symbol);
        if (env.ALPHAVANTAGE_KEY && (nMap.get(h.symbol) || 0) < 20) tasks.push('eod:' + h.symbol);
      });
    }
    await setKv(env, 'mkt_queue', JSON.stringify(tasks));
    await setKv(env, 'mkt_planned', usDay);
    return `Extern: ${tasks.length} taken klaargezet (zonder FMP).`;
  }
  const { results: peerRows } = await env.DB.prepare('SELECT symbol, peers, updated FROM ext_peers').all();
  const peerMap = new Map(peerRows.map((r) => [r.symbol, r]));
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const symbols = new Set();
  const later = [];
  watch.forEach((w) => symbols.add(w.symbol));
  for (const h of held) {
    symbols.add(h.symbol);
    const pr = peerMap.get(h.symbol);
    if (!pr || pr.updated < weekAgo) tasks.push('peers:' + h.symbol);
    else JSON.parse(pr.peers || '[]').forEach((x) => symbols.add(x));
  }
  const { results: hist } = await env.DB.prepare('SELECT symbol, COUNT(*) AS n FROM ext_prices GROUP BY symbol').all();
  const histN = new Map(hist.map((r) => [r.symbol, r.n]));
  const noHist = JSON.parse((await getKv(env, 'eod_unavailable')) || '[]');
  const { results: fresh } = await env.DB.prepare('SELECT symbol FROM ext_profile WHERE updated = ?').bind(usDay).all();
  const freshSet = new Set(fresh.map((r) => r.symbol));
  // Volgaandelen eerst: anders staan nieuwe symbolen achter ruim honderd andere taken en blijven ze uren leeg
  const watchSet = new Set(watch.map((w) => w.symbol));
  const first = [];
  for (const sym of symbols) {
    const isWatch = watchSet.has(sym);
    if (!freshSet.has(sym)) (isWatch ? first : tasks).push('profile:' + sym);
    if ((histN.get(sym) || 0) < 20 && !noHist.includes(sym)) (isWatch ? first : later).push('eod:' + sym);
  }
  first.sort((a, b) => (a.startsWith('profile:') ? 0 : 1) - (b.startsWith('profile:') ? 0 : 1));
  tasks.unshift(...first);
  // Waardering (koers-winstverhouding, dividendrendement): per aandeel één keer per week, sectorgemiddelden één keer per dag
  const { results: vals } = await env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'val\\_%' ESCAPE '\\'").all();
  const valAge = new Map(vals.map((r) => { try { return [r.key.slice(4), JSON.parse(r.value).updated || '']; } catch (e) { return [r.key.slice(4), '']; } }));
  if ((await getKv(env, 'val_denied')) !== '1') {
    held.concat(watch).forEach((h) => { if ((valAge.get(h.symbol) || '') < weekAgo) later.push('ratios:' + h.symbol); });
    let spe = null; try { spe = JSON.parse((await getKv(env, 'sector_pe')) || 'null'); } catch (e) { spe = null; }
    if (!spe || spe.date < usDay) later.push('secpe:' + usDay);
  }
  const { results: have } = await env.DB.prepare("SELECT DISTINCT day FROM ext_perf WHERE kind = 'sector'").all();
  const haveDays = new Set(have.map((r) => r.day));
  for (const d of prevWeekdays(usDay, PERF_BACKFILL_DAYS)) {
    if (!haveDays.has(d)) tasks.push('perf:' + d);
  }
  tasks.push(...later);
  await setKv(env, 'mkt_queue', JSON.stringify(tasks));
  await setKv(env, 'mkt_planned', usDay);
  return `Markt: ${tasks.length} taken klaargezet.`;
}

async function marketStep(env) {
  let queue = [];
  try { queue = JSON.parse((await getKv(env, 'mkt_queue')) || '[]'); } catch (e) { queue = []; }
  if (!queue.length) return 'Markt: niets te doen.';
  await ensureMarketTables(env);
  const usDay = lastUsDay(new Date());
  let calls = 0, done = 0, stop = false;
  const writes = [];
  const errors = [];
  const noHist = JSON.parse((await getKv(env, 'eod_unavailable')) || '[]');
  const deferred = [];
  let avThisStep = false;
  let unknown = [];
  try { unknown = JSON.parse((await getKv(env, 'mkt_unknown')) || '[]'); } catch (e) { unknown = []; }
  // FMP aan zijn limiet of stuk: profielen via Finnhub, koersgeschiedenis via Alpha Vantage, de rest later
  let fmpDown = !!env.FMP_KEY && (await srcDown(env, 'fmp'));
  let eod2Step = 0;
  const putProfile = (sym, keep) => {
    writes.push(env.DB.prepare('INSERT OR REPLACE INTO ext_profile (symbol, data, updated) VALUES (?,?,?)').bind(sym, JSON.stringify(keep), usDay));
    const pn = parts(new Date());
    const inSession = pn.weekday <= 5 && pn.hm >= '15:30' && pn.hm < '22:30';
    if (keep.price != null && !inSession) writes.push(env.DB.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)').bind(sym, usDay, keep.price));
  };
  const finnhubProfile = async (sym) => {
    const keep = await profileFromFinnhub(env, sym);
    calls += 3;
    if (keep) { putProfile(sym, keep); await srcBackup(env, 'fmp', 'Finnhub'); }
    return keep;
  };
  while (queue.length && calls < MARKET_STEP_CALLS && !stop) {
    const task = queue.shift();
    // Alpha Vantage staat 5 verzoeken per minuut toe: één aandeel per stap
    if (task.startsWith('av:') && avThisStep) { deferred.push(task); continue; }
    if (task.startsWith('av:')) avThisStep = true;
    const ci = task.indexOf(':');
    const kind = ci < 0 ? task : task.slice(0, ci), arg = ci < 0 ? '' : task.slice(ci + 1);
    try {
      if (kind === 'fx' || kind === 'hicp' || kind === 'idx' || kind === 'fh' || kind === 'fhnews' || kind === 'sec' || kind === 'av' || kind === 'companies' || kind === 'filings' || kind === 'f13' || kind === 'econ' || kind === 'pies') {
        calls += await externalTask(env, kind, arg);
      } else if (kind === 'eod2') {
        // Reserve voor koershistorie: Twelve Data (8 per minuut, dus hoogstens 6 per stap), anders Alpha Vantage
        let rows = null, src = null;
        if (env.TWELVEDATA_KEY && eod2Step < 6 && !(await srcDown(env, 'twelvedata'))) { eod2Step++; calls++; rows = await twelveDaily(env, arg); src = 'Twelve Data'; }
        else if (env.ALPHAVANTAGE_KEY && !avThisStep && (await avCount(env, 0)) > 4) { avThisStep = true; calls++; rows = await avDaily(env, arg); src = 'Alpha Vantage'; }
        else { deferred.push(task); continue; }
        if (rows && rows.length) {
          const st = env.DB.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)');
          rows.forEach(([d, v]) => writes.push(st.bind(arg, d, v)));
          await srcBackup(env, 'fmp', src + ' (koershistorie)');
        }
        calls += await externalTask(env, kind, arg);
      } else if (kind === 'profile' && (!env.FMP_KEY || fmpDown)) {
        if (env.FINNHUB_KEY) await finnhubProfile(arg);
      } else if (kind === 'eod' && (!env.FMP_KEY || fmpDown)) {
        // Reserve: dagkoersen (laatste 100 handelsdagen) van Alpha Vantage, binnen het dagbudget
        if (env.ALPHAVANTAGE_KEY && !avThisStep && (await avCount(env, 0)) > 4) {
          avThisStep = true;
          const rows = await avDaily(env, arg);
          calls++;
          const st = env.DB.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)');
          rows.forEach(([d, v]) => writes.push(st.bind(arg, d, v)));
          if (rows.length) await srcBackup(env, 'fmp', 'Alpha Vantage');
        } else if (fmpDown) deferred.push(task);
      } else if (!env.FMP_KEY || fmpDown) {
        // FMP-taak zonder sleutel overslaan; met sleutel maar FMP tijdelijk uit: later opnieuw
        if (fmpDown) deferred.push(task);
      } else if (kind === 'peers') {
        calls++;
        const list = await fmp(env, '/stock-peers?symbol=' + encodeURIComponent(arg));
        // Voorkeur voor Amerikaanse noteringen (zonder beurs-achtervoegsel), grootste eerst
        // Andere aandelenklasse van hetzelfde bedrijf (GOOG bij GOOGL) telt niet als vergelijkbaar
        const other = (x) => x.symbol && !x.symbol.startsWith(arg) && !arg.startsWith(x.symbol);
        const us = list.filter((x) => other(x) && !x.symbol.includes('.'));
        const pick = (us.length >= 3 ? us : list.filter(other))
          .sort((a, b) => num(b.mktCap) - num(a.mktCap)).slice(0, PEERS_PER_STOCK).map((x) => x.symbol);
        writes.push(env.DB.prepare('INSERT OR REPLACE INTO ext_peers (symbol, peers, updated) VALUES (?,?,?)').bind(arg, JSON.stringify(pick), parts(new Date()).day));
        pick.forEach((sym) => {
          if (!queue.includes('profile:' + sym)) queue.unshift('profile:' + sym);
          if (!noHist.includes(sym) && !queue.includes('eod:' + sym)) queue.push('eod:' + sym);
        });
      } else if (kind === 'profile') {
        calls++;
        let p;
        try { p = (await fmp(env, '/profile?symbol=' + encodeURIComponent(arg)))[0]; }
        catch (e) {
          // Limiet of storing bij FMP: dit profiel (en bij een limiet ook de volgende) via Finnhub
          if (!/limiet|402|401|403|FMP gaf 5/.test(e.message) || !env.FINNHUB_KEY) throw e;
          await srcFail(env, 'fmp', e.message, /limiet/.test(e.message));
          fmpDown = /limiet/.test(e.message) || (await srcDown(env, 'fmp'));
          await finnhubProfile(arg);
          done++;
          continue;
        }
        if (!p && !unknown.includes(arg)) unknown.push(arg);
        if (p && unknown.includes(arg)) unknown.splice(unknown.indexOf(arg), 1);
        if (p) {
          const keep = {
            symbol: p.symbol, name: p.companyName, price: numOrNull(p.price), currency: p.currency, marketCap: numOrNull(p.marketCap),
            beta: numOrNull(p.beta), lastDividend: numOrNull(p.lastDividend), range: p.range || null, change: numOrNull(p.changePercentage),
            sector: p.sector || null, industry: p.industry || null, exchange: p.exchange || null, country: p.country || null,
            employees: numOrNull(p.fullTimeEmployees), ipoDate: p.ipoDate || null, isEtf: !!p.isEtf, website: p.website || null, cik: p.cik || null,
          };
          writes.push(env.DB.prepare('INSERT OR REPLACE INTO ext_profile (symbol, data, updated) VALUES (?,?,?)').bind(arg, JSON.stringify(keep), usDay));
          // Alleen als slotkoers bewaren buiten de Amerikaanse handelsuren (15:30–22:30 Amsterdamse tijd)
          const pn = parts(new Date());
          const inSession = pn.weekday <= 5 && pn.hm >= '15:30' && pn.hm < '22:30';
          if (keep.price != null && !inSession) writes.push(env.DB.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)').bind(arg, usDay, keep.price));
        }
      } else if (kind === 'eod') {
        calls++;
        await srcOk(env, 'fmp');
        const from = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
        try {
          const rows = await fmp(env, '/historical-price-eod/light?symbol=' + encodeURIComponent(arg) + '&from=' + from);
          const st = env.DB.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)');
          rows.filter((r) => r.date && isFinite(Number(r.price))).forEach((r) => writes.push(st.bind(arg, r.date, Number(r.price))));
        } catch (e) {
          if (/402/.test(e.message)) { if (!noHist.includes(arg)) noHist.push(arg); if ((env.TWELVEDATA_KEY || env.ALPHAVANTAGE_KEY) && !queue.includes('eod2:' + arg)) queue.push('eod2:' + arg); } else throw e;
        }
      } else if (kind === 'ratios') {
        // Koers-winstverhouding en dividendrendement: nu (TTM) en per boekjaar
        calls += 2;
        const pick = (o, keys) => { for (const k of keys) { const v = numOrNull(o && o[k]); if (v != null) return v; } return null; };
        let ttm = null, hist = [];
        try {
          ttm = (await fmp(env, '/ratios-ttm?symbol=' + encodeURIComponent(arg)))[0] || null;
          hist = await fmp(env, '/ratios?symbol=' + encodeURIComponent(arg) + '&limit=5');
        } catch (e) {
          if (/402/.test(e.message)) { await setKv(env, 'val_denied', '1'); queue = queue.filter((t) => !/^(ratios|secpe):/.test(t)); throw new Error('waardering zit niet in het FMP-abonnement'); }
          throw e;
        }
        const out = {
          updated: parts(new Date()).day,
          pe: ttm ? pick(ttm, ['priceToEarningsRatioTTM', 'peRatioTTM']) : null,
          dy: ttm ? pick(ttm, ['dividendYieldTTM', 'dividendYielTTM']) : null,
          hist: hist.map((r) => [String(r.fiscalYear || r.calendarYear || String(r.date || '').slice(0, 4)), pick(r, ['priceToEarningsRatio', 'priceEarningsRatio']), pick(r, ['dividendYield'])])
            .filter((r) => /^\d{4}$/.test(r[0])).sort((a, b) => a[0].localeCompare(b[0])),
        };
        writes.push(env.DB.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').bind('val_' + arg, JSON.stringify(out)));
      } else if (kind === 'secpe') {
        calls++;
        let rows = [];
        try { rows = await fmp(env, '/sector-pe-snapshot?date=' + arg); }
        catch (e) { if (/402/.test(e.message)) { rows = []; } else throw e; }
        const acc = {};
        rows.forEach((r) => { const pe = numOrNull(r.pe); if (r.sector && pe != null && pe > 0) (acc[r.sector] = acc[r.sector] || []).push(pe); });
        const avg = Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, Math.round(a.reduce((s, x) => s + x, 0) / a.length * 10) / 10]));
        writes.push(env.DB.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').bind('sector_pe', JSON.stringify({ date: arg, sectors: avg })));
      } else if (kind === 'perf') {
        calls += 2;
        const sec = await fmp(env, '/sector-performance-snapshot?date=' + arg);
        const ind = await fmp(env, '/industry-performance-snapshot?date=' + arg);
        const st = env.DB.prepare('INSERT OR REPLACE INTO ext_perf (day, kind, name, exchange, change) VALUES (?,?,?,?,?)');
        sec.forEach((r) => writes.push(st.bind(arg, 'sector', r.sector, r.exchange || '', numOrNull(r.averageChange))));
        ind.forEach((r) => writes.push(st.bind(arg, 'industry', r.industry, r.exchange || '', numOrNull(r.averageChange))));
        // Lege dag (feestdag): markeer zodat hij niet opnieuw wordt opgehaald
        if (!sec.length) writes.push(st.bind(arg, 'sector', '-', '', null));
      }
      done++;
    } catch (e) {
      errors.push(task + ': ' + e.message);
      if (/Alpha Vantage-limiet/.test(e.message)) {
        // Morgen verder: de av-taken blijven staan, achteraan
        deferred.push(task, ...queue.filter((t) => t.startsWith('av:')));
        queue = queue.filter((t) => !t.startsWith('av:'));
        if (/dagbudget|limiet bereikt$/.test(e.message)) await noteExtError(env, 'alphavantage', 'Daglimiet van Alpha Vantage bereikt; morgen verder.');
      } else if (/Finnhub-limiet/.test(e.message)) {
        // Finnhub zit aan zijn limiet: Finnhub-taken naar achteren, de rest (zoals FMP-koersen) gaat door
        const fh = [task].concat(queue.filter((t) => t.startsWith('fh:') || t === 'fhnews'));
        queue = queue.filter((t) => !(t.startsWith('fh:') || t === 'fhnews'));
        deferred.push(...fh);
      } else if (/limiet|subrequests/i.test(e.message)) { queue.unshift(task); stop = true; }
      else if (/ongeldig/i.test(e.message) && /^fh:/.test(task)) {
        // Finnhub-sleutel werkt niet: Alpha Vantage neemt het over als die sleutel er is
        const fhTasks = [task].concat(queue.filter((t) => t.startsWith('fh:')));
        queue = queue.filter((t) => !t.startsWith('fh:'));
        if (env.ALPHAVANTAGE_KEY) fhTasks.forEach((t) => { const a = 'av:' + t.slice(3); if (!queue.includes(a)) queue.push(a); });
      }
    }
  }
  queue.push(...deferred);
  for (let i = 0; i < writes.length; i += 100) await env.DB.batch(writes.slice(i, i + 100));
  await flushFmp(env);
  await setKv(env, 'mkt_queue', JSON.stringify(queue));
  await setKv(env, 'eod_unavailable', JSON.stringify(noHist));
  await setKv(env, 'mkt_unknown', JSON.stringify(unknown));
  if (errors.length) await setKv(env, 'mkt_errors', JSON.stringify(errors.slice(-20)));
  if (done) await saveDataCache(env, await buildData(env));
  return `Markt: ${done} taken gedaan, ${queue.length} over${errors.length ? ', ' + errors.length + ' fouten' : ''}.`;
}

async function marketData(env) {
  if ((await getKv(env, 'market_schema')) !== '1') return null;
  const held = await heldStocks(env);
  const { results: peerRows } = await env.DB.prepare('SELECT symbol, peers FROM ext_peers').all();
  const peers = {};
  const want = new Set();
  const heldSyms = new Map(held.map((h) => [h.symbol, h.ticker]));
  peerRows.forEach((r) => {
    if (!heldSyms.has(r.symbol)) return;
    const list = JSON.parse(r.peers || '[]').filter((x) => !x.startsWith(r.symbol) && !r.symbol.startsWith(x));
    peers[heldSyms.get(r.symbol)] = list;
    list.forEach((x) => want.add(x));
  });
  held.forEach((h) => want.add(h.symbol));
  const watch = await extraStocks(env);
  watch.forEach((w) => want.add(w.symbol));
  const { results: profRows } = await env.DB.prepare('SELECT symbol, data FROM ext_profile').all();
  const profiles = {};
  profRows.forEach((r) => { if (want.has(r.symbol)) profiles[r.symbol] = JSON.parse(r.data); });
  const since = new Date(Date.now() - 380 * 864e5).toISOString().slice(0, 10);
  const { results: pr } = await env.DB.prepare('SELECT symbol, day, price FROM ext_prices WHERE day >= ? ORDER BY day').bind(since).all();
  const prices = {};
  pr.forEach((r) => { if (!want.has(r.symbol)) return; (prices[r.symbol] = prices[r.symbol] || []).push([r.day, r.price]); });
  const industries = new Set(Object.values(profiles).map((p) => p.industry).filter(Boolean));
  const { results: perf } = await env.DB.prepare("SELECT day, kind, name, exchange, change FROM ext_perf WHERE name != '-' ORDER BY day").all();
  const sectors = {}, inds = {};
  perf.forEach((r) => {
    if (r.change == null) return;
    const tgt = r.kind === 'sector' ? sectors : industries.has(r.name) ? inds : null;
    if (!tgt) return;
    ((tgt[r.name] = tgt[r.name] || {})[r.exchange] = tgt[r.name][r.exchange] || []).push([r.day, r.change]);
  });
  const { results: valRows } = await env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'val\\_%' ESCAPE '\\'").all();
  const valuation = {};
  valRows.forEach((r) => { const sym = r.key.slice(4); if (!want.has(sym)) return; try { valuation[sym] = JSON.parse(r.value); } catch (e) { /* overslaan */ } });
  let sectorPe = null;
  try { sectorPe = JSON.parse((await getKv(env, 'sector_pe')) || 'null'); } catch (e) { sectorPe = null; }
  return {
    symbols: Object.fromEntries(held.map((h) => [h.ticker, h.symbol])),
    watch: watch.map((w) => w.symbol),
    // Symbolen waarvoor FMP geen bedrijf kent (bijvoorbeeld een index of een tikfout)
    unknown: await (async () => { try { return JSON.parse((await getKv(env, 'mkt_unknown')) || '[]'); } catch (e) { return []; } })(),
    peers, profiles, prices, sectors, industries: inds, valuation, sectorPe,
    valDenied: (await getKv(env, 'val_denied')) === '1',
    updated: await getKv(env, 'mkt_planned'),
  };
}

const numOrNull = (x) => (x === null || x === undefined || x === '' || !isFinite(Number(x)) ? null : Number(x));

async function importFromSheet(env, url, token) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url || '')) {
    throw new Error('Geef het adres van de Apps Script web-app (…/exec).');
  }
  const res = await fetch(url + '?token=' + encodeURIComponent(token || ''), { redirect: 'follow' });
  const data = await res.json();
  if (!data.ok) throw new Error('De sheet gaf: ' + (data.error || 'onbekende fout'));

  const toMs = (s) => Date.parse(s + '+01:00') - (isDst(s) ? HOUR_MS : 0);
  const stmts = [];
  const w = env.DB.prepare('INSERT OR REPLACE INTO weeks (date, account_value, net_deposits, cash, cost_basis, source) VALUES (?,?,?,?,?,?)');
  (data.weeks || []).forEach((x) => {
    if (x.accountValue == null) return;
    stmts.push(w.bind(x.date.slice(0, 10), x.accountValue, x.netDeposits, x.cash, x.costBasis, x.source || 'Sheet'));
  });
  const it = env.DB.prepare('INSERT OR REPLACE INTO intraday (ts, ticker, name, value, unrealized, price, qty) VALUES (?,?,?,?,?,?,?)');
  (data.intraday && data.intraday.rows || []).forEach((r) => stmts.push(it.bind(toMs(r[0]), r[1], null, r[2], null, null, null)));
  const h = env.DB.prepare('INSERT OR REPLACE INTO hours (hour, ticker, name, open, close, low, high, avg, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?)');
  (data.hours && data.hours.rows || []).forEach((r) => stmts.push(h.bind(toMs(r[0]), r[1], null, r[2], r[3], r[4], r[5], r[6], null, null)));
  const d = env.DB.prepare('INSERT OR REPLACE INTO days (day, ticker, name, open, close, low, high, avg, range, range_pct, n, close_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  (data.days && data.days.rows || []).forEach((r) => stmts.push(d.bind(r[0].slice(0, 10), r[1], null, r[2], r[3], r[4], r[5], r[6], r[7], r[8], null, null)));
  await batchChunks(env, stmts);

  const lastH = (data.hours && data.hours.rows || []).reduce((m, r) => Math.max(m, toMs(r[0])), 0);
  if (lastH) await setKv(env, 'last_hour', String(lastH));
  const lastD = (data.days && data.days.rows || []).reduce((m, r) => (r[0].slice(0, 10) > m ? r[0].slice(0, 10) : m), '');
  if (lastD) await setKv(env, 'last_day', lastD);
  await saveDataCache(env, await buildData(env));
  return {
    weeks: (data.weeks || []).length,
    intraday: (data.intraday && data.intraday.rows || []).length,
    hours: (data.hours && data.hours.rows || []).length,
    days: (data.days && data.days.rows || []).length,
  };
}

// Zomertijd in Amsterdam: laatste zondag van maart 01:00 UTC t/m laatste zondag van oktober 01:00 UTC.
function isDst(localIso) {
  const y = Number(localIso.slice(0, 4));
  const lastSunday = (m) => { const d = new Date(Date.UTC(y, m + 1, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d; };
  const start = lastSunday(2), end = lastSunday(9);
  const t = Date.parse(localIso + 'Z');
  return t >= start.getTime() + 2 * HOUR_MS && t < end.getTime() + 3 * HOUR_MS;
}

export const _test = { parts, isLive, shortTicker, isoLocal, isDst, hourStart, dayOf };


// =====================================================================
// ---------- Meldingen op je telefoon of computer (Web Push, zonder externe dienst) ----------
// De Worker maakt zelf een sleutelpaar (VAPID) en versleutelt elke melding volgens RFC 8291 (aes128gcm).
// Abonnementen (een adres van de pushdienst van je browser) staan in kv 'push_subs'.
const b64u = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { let t = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return Uint8Array.from(atob(t), (c) => c.charCodeAt(0)); };
const concatBytes = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; a.forEach((x) => { o.set(x, i); i += x.length; }); return o; };
async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
// HKDF met één blok (genoeg voor sleutels tot 32 bytes)
async function hkdf(salt, ikm, info, len) {
  const prk = await hmacSha256(salt, ikm);
  return (await hmacSha256(prk, concatBytes(info, new Uint8Array([1])))).slice(0, len);
}

async function vapidKeys(env) {
  let v = null;
  try { v = JSON.parse((await getKv(env, 'vapid')) || 'null'); } catch (e) { v = null; }
  if (v && v.jwk && v.pub) return v;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  v = { jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
  await setKv(env, 'vapid', JSON.stringify(v));
  return v;
}

async function vapidHeader(env, endpoint) {
  const v = await vapidKeys(env);
  const te = new TextEncoder();
  const enc = (o) => b64u(te.encode(JSON.stringify(o)));
  const sub = (await getKv(env, 'self_origin')) || 'https://github.com/svgbml/Investment-tracker';
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub });
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(unsigned));
  return 'vapid t=' + unsigned + '.' + b64u(sig) + ', k=' + v.pub;
}

// Versleutel een bericht voor één abonnement (RFC 8291, één record)
async function encryptPush(sub, text) {
  const te = new TextEncoder();
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, shared, concatBytes(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concatBytes(te.encode(text), new Uint8Array([2]))));
  return concatBytes(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, ct);
}

async function pushSubs(env) { try { return JSON.parse((await getKv(env, 'push_subs')) || '[]'); } catch (e) { return []; } }

// Stuurt een melding naar alle aangemelde apparaten; verlopen abonnementen (404/410) worden opgeruimd
async function sendPush(env, msg) {
  const subs = await pushSubs(env);
  if (!subs.length) return 0;
  const body = JSON.stringify({ title: String(msg.title || 'Investeringstracker').slice(0, 80), body: String(msg.body || '').slice(0, 300), url: msg.url || '', tag: msg.tag || '' });
  let sent = 0;
  const keep = [];
  for (const s of subs) {
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: msg.urgent ? 'high' : 'normal', Authorization: await vapidHeader(env, s.endpoint) },
        body: await encryptPush(s, body),
      });
      if (res.status === 404 || res.status === 410) continue;
      keep.push(s);
      if (res.ok) sent++; else await noteExtError(env, 'push', 'De pushdienst gaf ' + res.status + '.');
    } catch (e) { keep.push(s); await noteExtError(env, 'push', String(e.message || e)); }
  }
  if (keep.length !== subs.length) await setKv(env, 'push_subs', JSON.stringify(keep));
  if (sent) await noteExtError(env, 'push', null);
  return sent;
}

const ALERT_DEFAULTS = { move: 5, earnings: true, insider: true, drift: 5 };
async function alertRules(env) { const s = await getSettings(env); return Object.assign({}, ALERT_DEFAULTS, (s && s.alerts) || {}); }

// Eén keer per sleutel (bijvoorbeeld "move|2026-11-17|AAPL"); de laatste 400 sleutels worden onthouden
async function alertOnce(env, key, msg) {
  let sent = {};
  try { sent = JSON.parse((await getKv(env, 'alerts_sent')) || '{}'); } catch (e) { sent = {}; }
  if (sent[key]) return false;
  const n = await sendPush(env, msg);
  sent[key] = isoLocal(Date.now());
  const keys = Object.keys(sent);
  if (keys.length > 400) keys.slice(0, keys.length - 400).forEach((k) => { delete sent[k]; });
  await setKv(env, 'alerts_sent', JSON.stringify(sent));
  return n > 0;
}

// Na een meting: posities (en het totaal) die vandaag meer bewegen dan de drempel
async function alertMoves(env, rows, now) {
  if (!(await pushSubs(env)).length) return '';
  const rules = await alertRules(env);
  const lim = Number(rules.move);
  if (!(lim > 0)) return '';
  const day = parts(now).day;
  const { results } = await env.DB.prepare('SELECT ticker, close FROM days WHERE day = (SELECT MAX(day) FROM days WHERE day < ?)').bind(day).all();
  const prev = new Map(results.map((r) => [r.ticker, r.close]));
  const hits = [];
  for (const r of rows) {
    const c = prev.get(r.ticker);
    if (!(c > 0) || !(r.value > 0)) continue;
    const ch = r.value / c - 1;
    const need = r.ticker === TOTAL ? lim / 2 : lim;
    // Meer dan 25% is bijna altijd een aankoop of verkoop, geen koersbeweging
    if (Math.abs(ch) * 100 >= need && Math.abs(ch) < 0.25) hits.push({ r, ch });
  }
  for (const h of hits.slice(0, 5)) {
    const tot = h.r.ticker === TOTAL;
    const pct = (h.ch > 0 ? '+' : '−') + (Math.abs(h.ch) * 100).toFixed(1).replace('.', ',') + '%';
    await alertOnce(env, 'move|' + day + '|' + h.r.ticker + '|' + (h.ch > 0 ? 'u' : 'd'), {
      title: (tot ? 'Je portefeuille' : h.r.ticker) + ' ' + pct + ' vandaag',
      body: tot ? 'Je beleggingen bewegen vandaag meer dan gewoonlijk.' : (h.r.name || h.r.ticker) + ' ' + (h.ch > 0 ? 'stijgt' : 'daalt') + ' ' + pct + ' sinds het slot van de vorige handelsdag.',
      url: tot ? '#overzicht' : '#bedrijf/' + encodeURIComponent(h.r.ticker), tag: 'move-' + h.r.ticker, urgent: Math.abs(h.ch) >= lim * 2 / 100,
    });
  }
  return hits.length ? hits.length + ' meldingen over koersbewegingen.' : '';
}

// Elke ochtend: kwartaalcijfers van je aandelen die morgen komen
async function alertEarnings(env) {
  if (!(await pushSubs(env)).length) return '';
  const rules = await alertRules(env);
  if (!rules.earnings) return '';
  let ev = null;
  try { ev = JSON.parse((await getKv(env, 'events')) || 'null'); } catch (e) { ev = null; }
  const tomorrow = parts(new Date(Date.now() + 864e5)).day;
  const list = ((ev && ev.earnings) || []).filter((e) => e.date === tomorrow);
  for (const e of list.slice(0, 5)) {
    await alertOnce(env, 'earn|' + e.date + '|' + e.ticker, { title: e.ticker + ': morgen kwartaalcijfers', body: 'Verwachte winst per aandeel ' + (e.epsEst != null ? String(e.epsEst).replace('.', ',') : 'onbekend') + '.', url: '#bedrijf/' + encodeURIComponent(e.ticker), tag: 'earn-' + e.ticker });
  }
  return list.length ? list.length + ' meldingen over kwartaalcijfers.' : '';
}

// Na het ophalen bij Finnhub: nieuwe aankopen door bestuurders (alleen kopen met eigen geld, code P)
async function alertInsider(env, tk, prevList, newList) {
  if (!(await pushSubs(env)).length) return;
  const rules = await alertRules(env);
  if (!rules.insider) return;
  const seen = new Set((prevList || []).map((x) => x.date + '|' + x.name + '|' + x.change));
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  for (const x of (newList || []).filter((y) => y.code === 'P' && y.date >= since && !seen.has(y.date + '|' + y.name + '|' + y.change)).slice(0, 2)) {
    await alertOnce(env, 'ins|' + tk + '|' + x.date + '|' + x.name, { title: tk + ': bestuurder koopt aandelen', body: (x.name || 'Een bestuurder') + ' kocht ' + (x.change || '?') + ' aandelen' + (x.price ? ' à $' + x.price : '') + ' op ' + x.date + '.', url: '#bedrijf/' + encodeURIComponent(tk), tag: 'ins-' + tk });
  }
}

// Na de weeksnapshot: verdeling wijkt te veel af van je streefverdeling
async function alertDrift(env, day) {
  if (!(await pushSubs(env)).length) return '';
  const s = await getSettings(env);
  const rules = await alertRules(env);
  const lim = Number(rules.drift);
  const t = (s && s.targets) || {};
  if (!(lim > 0) || !Object.keys(t).length) return '';
  const { results: pos } = await env.DB.prepare('SELECT ticker, name, value FROM positions WHERE date = ?').bind(day).all();
  const total = pos.reduce((n, p) => n + (p.value || 0), 0);
  if (!total) return '';
  const g = new Map();
  if (s.targetMode === 'sector') {
    await ensureMarketTables(env);
    const { results: pr } = await env.DB.prepare('SELECT symbol, data FROM ext_profile').all();
    const sec = new Map(pr.map((r) => { try { return [r.symbol, JSON.parse(r.data).sector]; } catch (e) { return [r.symbol, null]; } }));
    pos.forEach((p) => { const k = ETF_RE.test(p.name || '') ? '@funds' : sec.get(SYMBOL_MAP[p.ticker] || p.ticker) || '@unknown'; g.set(k, (g.get(k) || 0) + p.value); });
  } else pos.forEach((p) => g.set(p.ticker, (g.get(p.ticker) || 0) + p.value));
  const diffs = Object.entries(t).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, (g.get(k) || 0) / total * 100 - Number(v)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const big = diffs.filter((d) => Math.abs(d[1]) >= lim);
  if (!big.length) return '';
  const txt = big.slice(0, 3).map(([k, d]) => (k === '@funds' ? 'fondsen' : k) + ' ' + (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1).replace('.', ',') + ' pp').join(', ');
  await alertOnce(env, 'drift|' + day, { title: 'Je verdeling wijkt af van je doel', body: txt + '. De inleg-assistent op Plannen laat zien wat je met nieuwe inleg kunt kopen.', url: '#plannen', tag: 'drift' });
  return 'Melding: verdeling wijkt af (' + txt + ').';
}

// =====================================================================
// ---------- Weekoverzicht per e-mail (optioneel, via Resend) ----------
// Staat standaard uit (functie 'weeklyMail'). Nodig: RESEND_KEY en MAIL_TO; MAIL_FROM is optioneel.
// Lukt mailen niet, dan gaat het overzicht als melding naar je telefoon (als je meldingen aan hebt).
async function weekSummary(env) {
  const { results: wk } = await env.DB.prepare('SELECT date, account_value, net_deposits FROM weeks ORDER BY date DESC LIMIT 2').all();
  if (!wk.length) return null;
  const [w1, w0] = wk;
  const res = w0 ? (w1.account_value - w0.account_value) - (w1.net_deposits - w0.net_deposits) : null;
  const pct = w0 && w0.account_value ? res / w0.account_value : null;
  const from = new Date(new Date(w1.date + 'T12:00:00Z').getTime() - 8 * 864e5).toISOString().slice(0, 10);
  const { results: dr } = await env.DB.prepare('SELECT ticker, day, close FROM days WHERE day >= ? AND day <= ? AND ticker != ? ORDER BY day').bind(from, w1.date, TOTAL).all();
  const by = new Map();
  dr.forEach((r) => { const o = by.get(r.ticker) || { a: r.close, b: r.close }; o.b = r.close; by.set(r.ticker, o); });
  const movers = [...by.entries()].map(([tk, o]) => [tk, o.a > 0 ? o.b / o.a - 1 : null]).filter((x) => x[1] != null && Math.abs(x[1]) < 0.4).sort((a, b) => b[1] - a[1]);
  return { date: w1.date, account: w1.account_value, deposits: w1.net_deposits, res, pct, up: movers.slice(0, 3), down: movers.slice(-3).reverse().filter((m) => !movers.slice(0, 3).includes(m)) };
}

const nlPct = (v) => (v == null ? '–' : (v >= 0 ? '+' : '−') + (Math.abs(v) * 100).toFixed(1).replace('.', ',') + '%');
const nlEur = (v) => (v == null ? '–' : (v < 0 ? '−' : '') + '€ ' + Math.abs(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'));

async function weeklyMail(env, test) {
  const flags = await featureFlags(env);
  if (!test && !flags.weeklyMail) return '';
  if (!env.RESEND_KEY || !env.MAIL_TO) { if (test) throw new Error('Vul bij Koppelingen een Resend-sleutel en je e-mailadres in.'); return ''; }
  const S = await weekSummary(env);
  if (!S) { if (test) throw new Error('Er is nog geen weekmeting om te versturen.'); return ''; }
  const amounts = (await getSettings(env)).mailAmounts !== false;
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lines = ['Rendement deze week: ' + nlPct(S.pct) + (amounts ? ' (' + nlEur(S.res) + ')' : '')];
  if (amounts) lines.push('Accountwaarde: ' + nlEur(S.account) + ', netto gestort ' + nlEur(S.deposits));
  if (S.up.length) lines.push('Stijgers: ' + S.up.map(([tk, v]) => tk + ' ' + nlPct(v)).join(', '));
  if (S.down.length) lines.push('Dalers: ' + S.down.map(([tk, v]) => tk + ' ' + nlPct(v)).join(', '));
  const site = (await getKv(env, 'site_origin')) || 'https://svgbml.github.io/Investment-tracker/';
  const subject = 'Weekoverzicht ' + S.date + ': ' + nlPct(S.pct);
  const text = lines.join('\n') + '\n\nBekijk alles: ' + site + '\n\nJe ontvangt deze mail omdat het weekoverzicht per e-mail aanstaat in je tracker (Instellingen > Koppelingen).';
  const html = '<div style="font-family:system-ui,sans-serif;font-size:15px;color:#14181F;max-width:520px">' +
    '<p style="color:#5B6472;margin:0">Weekoverzicht tot ' + esc(S.date) + '</p>' +
    '<p style="font-size:34px;font-weight:700;margin:6px 0;color:' + ((S.pct || 0) >= 0 ? '#0B7A4B' : '#B4311F') + '">' + esc(nlPct(S.pct)) + '</p>' +
    lines.slice(amounts ? 1 : 0).map((l) => '<p style="margin:4px 0">' + esc(l) + '</p>').join('') +
    '<p style="margin-top:16px"><a href="' + esc(site) + '" style="color:#2B5BD7">Open de tracker</a></p>' +
    '<p style="color:#5B6472;font-size:12px">Je ontvangt deze mail omdat het weekoverzicht per e-mail aanstaat in je tracker. Uitzetten: Instellingen &gt; Koppelingen.</p></div>';
  let err = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || 'Investeringstracker <onboarding@resend.dev>', to: [env.MAIL_TO], subject, html, text }),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); err = 'Resend gaf ' + res.status + (b && b.message ? ': ' + String(b.message).slice(0, 120) : ''); }
  } catch (e) { err = String(e.message || e); }
  if (err) {
    await noteExtError(env, 'mail', err);
    await srcFail(env, 'resend', err);
    // Reserve: dezelfde samenvatting als melding
    const n = await sendPush(env, { title: subject, body: lines.join(' · '), url: '#overzicht', tag: 'week' });
    if (n) await srcBackup(env, 'resend', 'pushmelding');
    if (test) throw new Error(err + (n ? '. Het overzicht is wel als melding verstuurd.' : ''));
    return 'Weekmail mislukt' + (n ? ', als melding verstuurd' : '') + '.';
  }
  await noteExtError(env, 'mail', null);
  await srcOk(env, 'resend');
  return 'Weekmail verstuurd naar ' + env.MAIL_TO.replace(/(.).*(@.*)/, '$1…$2') + '.';
}

// =====================================================================
// ---------- Deel-link: alleen-lezen weergave voor iemand anders ----------
// kv 'share' = { token, amounts, since }. Zonder bedragen worden alle euro's met dezelfde factor geschaald
// (accountwaarde = 10.000), zodat verhoudingen en procenten kloppen maar echte bedragen niet te zien zijn.
async function shareConf(env) { try { return JSON.parse((await getKv(env, 'share')) || 'null'); } catch (e) { return null; } }

function scaleMoney(d) {
  const lw = (d.weeks || [])[d.weeks.length - 1];
  const tot = (d.today || []).find((t) => t.ticker === TOTAL);
  const ref = (lw && lw.accountValue) || (tot && tot.current) || 0;
  const f = ref > 0 ? 10000 / ref : 0;
  const sc = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * f * 100) / 100 : v);
  const obj = (o, keys) => { if (o) keys.forEach((k) => { if (k in o) o[k] = sc(o[k]); }); };
  const rows = (t, idx) => { if (t && Array.isArray(t.rows)) t.rows.forEach((r) => idx.forEach((i) => { r[i] = sc(r[i]); })); };
  rows(d.intraday, [2]); rows(d.hours, [2, 3, 4, 5, 6]); rows(d.days, [2, 3, 4, 5, 6, 7]); rows(d.orders, [4, 8, 9, 10, 11]);
  (d.today || []).forEach((t) => obj(t, ['current', 'low', 'high', 'avg', 'open', 'change', 'allTimeHigh', 'allTimeLow', 'avgRange']));
  (d.positions || []).forEach((p) => obj(p, ['value', 'unrealized', 'cost', 'quantity']));
  (d.weeks || []).forEach((w) => obj(w, ['accountValue', 'netDeposits', 'cash', 'costBasis', 'investmentsValue', 'unrealized', 'totalResult', 'weekChange', 'newDeposits', 'weekResult']));
  (d.peil || []).forEach((p) => { obj(p, ['total', 'investments', 'cash']); p.positions = []; });
  Object.values(d.posExtra || {}).forEach((x) => obj(x, ['fx', 'cost']));
  if (d.events) {
    (d.events.received || []).forEach((x) => obj(x, ['amount', 'qty', 'wht']));
    (d.events.dividends || []).forEach((x) => obj(x, ['estEur']));
  }
}

function shareData(data, conf) {
  const d = JSON.parse(JSON.stringify(data));
  const s = data.settings || {};
  d.settings = { targets: s.targets, targetMode: s.targetMode, watchlist: s.watchlist };
  d.features = { flags: (data.features && data.features.flags) || {}, has: (data.features && data.features.has) || {} };
  d.shared = { amounts: !!conf.amounts, since: conf.since || null };
  delete d.part;
  if (!conf.amounts) scaleMoney(d);
  return d;
}

async function saveShareCache(env, data) {
  const c = await shareConf(env);
  if (!c || !c.token) return;
  await setKv(env, 'data_share', JSON.stringify(shareData(data, c)));
}

async function shareAction(env, body) {
  let c = (await shareConf(env)) || {};
  const act = body && body.action;
  if (act === 'off') { await setKv(env, 'share', 'null'); await setKv(env, 'data_share', ''); return { on: false }; }
  if (act === 'on' || act === 'rotate' || !c.token) {
    if (act === 'rotate' || !c.token) c.token = b64u(crypto.getRandomValues(new Uint8Array(24)));
    c.since = c.since || isoLocal(Date.now());
  }
  if (body && typeof body.amounts === 'boolean') c.amounts = body.amounts;
  c.amounts = !!c.amounts;
  await setKv(env, 'share', JSON.stringify(c));
  await saveDataCache(env, await buildData(env));
  return { on: true, token: c.token, amounts: c.amounts, since: c.since };
}

// =====================================================================
// ---------- Geschiedenis inlezen uit een Trading 212-export (CSV) ----------
// De site leest het bestand en stuurt orders en dividenden. Orders die al via de API binnenkwamen
// (zelfde aandeel, kant en aantal binnen 5 minuten) worden overgeslagen.
async function importCsv(env, body) {
  await ensureOrdersTable(env);
  const n = (x) => { const v = Number(x); return isFinite(v) ? v : null; };
  const str = (x, len) => String(x == null ? '' : x).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, len);
  const orders = (Array.isArray(body && body.orders) ? body.orders : []).slice(0, 5000)
    .map((o) => ({ id: 'csv:' + str(o.id, 60), ts: n(o.ts), tk: str(o.tk, 20).toUpperCase(), name: str(o.name, 80), side: o.side === 'SELL' ? 'SELL' : 'BUY',
      qty: Math.abs(n(o.qty) || 0), price: n(o.price), cur: str(o.cur, 5) || null, fx: n(o.fx), net: Math.abs(n(o.net) || 0), realised: n(o.realised), feeFx: Math.abs(n(o.feeFx) || 0), feeOther: Math.abs(n(o.feeOther) || 0) }))
    .filter((o) => o.ts && o.tk && o.qty > 0 && o.id.length > 4);
  const { results: have } = await env.DB.prepare('SELECT id, ts, ticker, side, qty FROM orders').all();
  const ids = new Set(have.map((h) => h.id));
  const byTk = new Map();
  have.forEach((h) => { if (!byTk.has(h.ticker)) byTk.set(h.ticker, []); byTk.get(h.ticker).push(h); });
  const dup = (o) => ids.has(o.id) || (byTk.get(o.tk) || []).some((h) => h.side === o.side && Math.abs(h.ts - o.ts) < 5 * 60000 && Math.abs((h.qty || 0) - o.qty) <= 1e-4 * Math.max(1, o.qty));
  const st = env.DB.prepare('INSERT OR IGNORE INTO orders (id, ts, ticker, name, side, qty, price, currency, fx_rate, net, realised, fee_fx, fee_other, kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const fresh = orders.filter((o) => !dup(o));
  await batchChunks(env, fresh.map((o) => st.bind(o.id, o.ts, o.tk, o.name || null, o.side, o.qty, o.price, o.cur, o.fx, r2(o.net), o.realised, r2(o.feeFx), r2(o.feeOther), 'TRADE')));

  // Dividenden: bewaard in kv 'div_csv' en samengevoegd met wat Trading 212 via de API geeft (met echte bronbelasting)
  let divCsv = [];
  try { divCsv = JSON.parse((await getKv(env, 'div_csv')) || '[]'); } catch (e) { divCsv = []; }
  const dkey = (d) => d.ticker + '|' + d.date + '|' + Number(d.amount).toFixed(2);
  const known = new Set(divCsv.map(dkey));
  let newDiv = 0;
  (Array.isArray(body && body.dividends) ? body.dividends : []).slice(0, 5000).forEach((d) => {
    const x = { ticker: str(d.tk, 20).toUpperCase(), date: str(d.date, 10), amount: n(d.amount), perShare: n(d.perShare), qty: n(d.qty), wht: n(d.wht), whtCur: str(d.whtCur, 5) || null };
    if (!x.ticker || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || x.amount == null) return;
    if (known.has(dkey(x))) return;
    known.add(dkey(x)); divCsv.push(x); newDiv++;
  });
  divCsv.sort((a, b) => a.date.localeCompare(b.date));
  await setKv(env, 'div_csv', JSON.stringify(divCsv));
  let ev = null;
  try { ev = JSON.parse((await getKv(env, 'events')) || 'null'); } catch (e) { ev = null; }
  if (ev) { ev.received = mergeCsvDividends(ev.received || [], divCsv); await setKv(env, 'events', JSON.stringify(ev)); }
  await saveDataCache(env, await buildData(env));
  return { orders: fresh.length, skipped: orders.length - fresh.length, dividends: newDiv };
}

// Voeg dividenden uit de CSV toe aan die van de API (zelfde aandeel, datum binnen 3 dagen en bedrag binnen 2 cent = dezelfde)
function mergeCsvDividends(received, divCsv) {
  const out = received.map((d) => Object.assign({}, d));
  divCsv.forEach((c) => {
    const ct = Date.parse(c.date);
    const m = out.find((d) => d.ticker === c.ticker && Math.abs(Date.parse(d.date) - ct) <= 3 * 864e5 && Math.abs((d.amount || 0) - c.amount) <= 0.02);
    if (m) { if (c.wht != null) { m.wht = c.wht; m.whtCur = c.whtCur; } if (m.perShare == null && c.perShare != null) m.perShare = c.perShare; if (m.qty == null && c.qty != null) m.qty = c.qty; }
    else out.push({ ticker: c.ticker, date: c.date, amount: c.amount, perShare: c.perShare, qty: c.qty, wht: c.wht, whtCur: c.whtCur, src: 'csv' });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}


// =====================================================================
// ---------- Reeksen (metingen, uren, dagen) los, met alleen-nieuwe-regels ----------
// De site haalt 'series' één keer helemaal en daarna met ?since=<ms> alleen wat erbij kwam.
const SERIES_KEYS = ['intraday', 'hours', 'days'];
async function seriesDelta(env, since) {
  const s = Number(since);
  if (!isFinite(s) || s <= 0) return null;
  const dayOf = (ms) => parts(new Date(ms)).day;
  const { results: intra } = await env.DB.prepare('SELECT ts, ticker, value FROM intraday WHERE ts > ? ORDER BY ts').bind(s).all();
  const { results: hrs } = await env.DB.prepare('SELECT hour, ticker, open, close, low, high, avg FROM hours WHERE hour >= ? ORDER BY hour').bind(s - 2 * HOUR_MS).all();
  const { results: dys } = await env.DB.prepare('SELECT day, ticker, open, close, low, high, avg, range, range_pct FROM days WHERE day >= ? ORDER BY day').bind(dayOf(s - 864e5)).all();
  const last = await env.DB.prepare('SELECT MAX(ts) AS ts FROM intraday').first();
  return {
    ok: true, part: 'series', delta: true, since: s, seriesTs: (last && last.ts) || s,
    intraday: { rows: intra.map((r) => [isoLocal(r.ts), r.ticker, r.value]) },
    hours: { rows: hrs.map((r) => [isoLocal(r.hour), r.ticker, r.open, r.close, r.low, r.high, r.avg]) },
    days: { rows: dys.map((r) => [r.day + 'T00:00:00', r.ticker, r.open, r.close, r.low, r.high, r.avg, r.range, r.range_pct]) },
  };
}

// =====================================================================
// ---------- Status van de tracker ----------
async function statusInfo(env, raw) {
  const one = async (sql) => { try { const r = await env.DB.prepare(sql).first(); return r ? r.n : null; } catch (e) { return null; } };
  const last = await env.DB.prepare('SELECT MAX(ts) AS ts FROM intraday').first().catch(() => null);
  let fmpCalls = null, avCalls = null, q = [];
  try { fmpCalls = JSON.parse((await getKv(env, 'fmp_calls')) || 'null'); } catch (e) { /* leeg */ }
  try { avCalls = JSON.parse((await getKv(env, 'av_calls')) || 'null'); } catch (e) { /* leeg */ }
  try { q = JSON.parse((await getKv(env, 'mkt_queue')) || '[]'); } catch (e) { q = []; }
  const sizes = {};
  for (const k of ['data_core', 'data_extra', 'data_series']) sizes[k] = ((await getKv(env, k)) || '').length;
  return {
    now: isoLocal(Date.now()), lastMeasurement: last && last.ts ? isoLocal(last.ts) : null, live: isLive(new Date()),
    lastCron: await getKv(env, 'last_cron'), lastError: await getKv(env, 'last_error'), tickFails: Number((await getKv(env, 'tick_fail')) || 0),
    lastWeek: await getKv(env, 'last_week_snapshot'), ordersSynced: await getKv(env, 'orders_synced'), marketPlanned: await getKv(env, 'mkt_planned'),
    queue: q.length, fmpCalls, avCalls, errors: JSON.parse((await getKv(env, 'ext_errors')) || '{}'), health: await srcState(env),
    rows: { intraday: await one('SELECT COUNT(*) AS n FROM intraday'), hours: await one('SELECT COUNT(*) AS n FROM hours'), days: await one('SELECT COUNT(*) AS n FROM days'),
      weeks: await one('SELECT COUNT(*) AS n FROM weeks'), orders: await one('SELECT COUNT(*) AS n FROM orders') },
    sizes, devices: (await pushSubs(env)).length, companies: ((await getKv(env, 'companies_meta')) || '').slice(0, 200) || null,
    usage: JSON.parse((await getKv(env, 'api_calls')) || '{}'), siteErrors: JSON.parse((await getKv(env, 'site_errors')) || '[]'),
    tickHist: JSON.parse((await getKv(env, 'tick_hist')) || '{}'), r2: !!env.BACKUP, r2Last: await getKv(env, 'r2_last'),
    keys: Object.fromEntries(KEY_NAMES.map((k) => [k, !!(raw[k] || env[k])])),
  };
}

// =====================================================================
// ---------- Reservekopie en terugzetten (per tabel, in porties) ----------
// Geen sleutels, toegangscodes of interne vlaggen: alleen je eigen gegevens.
const BACKUP_TABLES = {
  weeks: ['date', 'account_value', 'net_deposits', 'cash', 'cost_basis', 'source'],
  positions: ['date', 'ticker', 'name', 'value', 'unrealized', 'qty'],
  days: ['day', 'ticker', 'name', 'open', 'close', 'low', 'high', 'avg', 'range', 'range_pct', 'n', 'close_price'],
  hours: ['hour', 'ticker', 'name', 'open', 'close', 'low', 'high', 'avg', 'n', 'close_price'],
  orders: ['id', 'ts', 'ticker', 'name', 'side', 'qty', 'price', 'currency', 'fx_rate', 'net', 'realised', 'fee_fx', 'fee_other', 'kind'],
  kv: ['key', 'value'],
};
const BACKUP_KV = /^(settings|events|div_csv|pos_extra|peil_\d{4}|etf_(SP500|NDX))$/;
const BACKUP_PAGE = 2000;
async function backupPart(env, table, offset) {
  if (table === 'orders') await ensureOrdersTable(env);
  if (!table) {
    const counts = {};
    for (const t of Object.keys(BACKUP_TABLES)) {
      try {
        const r = t === 'kv' ? await env.DB.prepare('SELECT key FROM kv').all() : null;
        counts[t] = t === 'kv' ? r.results.filter((x) => BACKUP_KV.test(x.key)).length : ((await env.DB.prepare('SELECT COUNT(*) AS n FROM ' + t).first()) || {}).n || 0;
      } catch (e) { counts[t] = 0; }
    }
    return { format: 'investeringstracker-backup', version: 1, created: isoLocal(Date.now()), page: BACKUP_PAGE, tables: counts };
  }
  const cols = BACKUP_TABLES[table];
  if (!cols) throw new Error('Onbekende tabel.');
  const off = Math.max(0, Number(offset) || 0);
  let rows;
  if (table === 'kv') rows = (await env.DB.prepare('SELECT key, value FROM kv ORDER BY key').all()).results.filter((x) => BACKUP_KV.test(x.key)).slice(off, off + BACKUP_PAGE);
  else rows = (await env.DB.prepare('SELECT ' + cols.join(', ') + ' FROM ' + table + ' ORDER BY rowid LIMIT ? OFFSET ?').bind(BACKUP_PAGE, off).all()).results;
  return { table, offset: off, rows: rows.map((r) => cols.map((c) => r[c])) };
}
async function restorePart(env, body) {
  const table = body && body.table, cols = BACKUP_TABLES[table];
  if (!cols) throw new Error('Onbekende tabel.');
  if (table === 'orders') await ensureOrdersTable(env);
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, BACKUP_PAGE).filter((r) => Array.isArray(r) && r.length === cols.length);
  const ok = table === 'kv' ? rows.filter((r) => BACKUP_KV.test(String(r[0])) && typeof r[1] === 'string' && r[1].length < 3e6) : rows;
  const st = env.DB.prepare('INSERT OR REPLACE INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(',') + ')');
  await batchChunks(env, ok.map((r) => st.bind(...r.map((v) => (v === undefined ? null : v)))));
  if (body.done) await saveDataCache(env, await buildData(env));
  return { table, restored: ok.length, skipped: rows.length - ok.length };
}

// =====================================================================
// ---------- Waakhond: melding als de tracker niet meer meet ----------
async function tickFailed(env, at, err) {
  await tickHist(env, false);
  const n = Number((await getKv(env, 'tick_fail')) || 0) + 1;
  await setKv(env, 'tick_fail', String(n));
  if (n >= 3 && isLive(at)) {
    const msg = String(err && err.message || err).slice(0, 160);
    await alertOnce(env, 'watchdog|' + parts(at).day, { title: 'Je tracker meet niet meer', body: 'Al ' + n + ' metingen op rij mislukt: ' + msg + (/401|403|sleutel/i.test(msg) ? ' Controleer je Trading 212-sleutel bij Koppelingen.' : ''), url: '#status', tag: 'watchdog', urgent: true });
  }
}
async function tickOk(env) { if ((await getKv(env, 'tick_fail')) !== '0') await setKv(env, 'tick_fail', '0'); await tickHist(env, true); }
// Per dag: gelukte en mislukte metingen (30 dagen), voor de grafiek op de statuspagina
async function tickHist(env, ok) {
  try {
    const day = parts(new Date()).day;
    let h = {};
    try { h = JSON.parse((await getKv(env, 'tick_hist')) || '{}'); } catch (e) { h = {}; }
    const d = h[day] || [0, 0];
    d[ok ? 0 : 1]++;
    h[day] = d;
    Object.keys(h).sort().slice(0, -30).forEach((k) => { delete h[k]; });
    await setKv(env, 'tick_hist', JSON.stringify(h));
  } catch (e) { /* niet erg */ }
}

// =====================================================================
// ---------- Koersalarmen per aandeel ----------
// settings.priceAlerts = [{ id, sym, op: 'below' | 'above', price, on, hit }]; koers in de munt van het aandeel.
async function checkPriceAlerts(env, rows) {
  const s = await getSettings(env);
  const list = Array.isArray(s.priceAlerts) ? s.priceAlerts : [];
  const active = list.filter((a) => a.on && isFinite(a.price));
  if (!active.length || !(await pushSubs(env)).length) return '';
  const held = new Map(rows.filter((r) => r.ticker !== TOTAL && r.price).map((r) => [r.ticker, r.price]));
  const price = new Map();
  let quotes = 0;
  for (const a of active) {
    if (held.has(a.sym)) { price.set(a.sym, held.get(a.sym)); continue; }
    if (price.has(a.sym)) continue;
    if (env.FINNHUB_KEY && quotes < 10 && !(await srcDown(env, 'finnhub'))) {
      quotes++;
      const r = await getJson(FINNHUB_BASE + '/quote?symbol=' + encodeURIComponent(a.sym) + '&token=' + encodeURIComponent(env.FINNHUB_KEY));
      if (r.ok && r.body && r.body.c > 0) { price.set(a.sym, r.body.c); continue; }
    }
    const p = await env.DB.prepare('SELECT data FROM ext_profile WHERE symbol = ?').bind(a.sym).first().catch(() => null);
    try { const d = p && JSON.parse(p.data); if (d && d.price > 0) price.set(a.sym, d.price); } catch (e) { /* geen profiel */ }
  }
  let hits = 0;
  for (const a of active) {
    const p = price.get(a.sym);
    if (!(p > 0) || !(a.op === 'below' ? p <= a.price : p >= a.price)) continue;
    hits++;
    a.on = false; a.hit = isoLocal(Date.now()); a.hitPrice = p;
    await alertOnce(env, 'price|' + a.id + '|' + a.hit.slice(0, 10), { title: a.sym + (a.op === 'below' ? ' onder ' : ' boven ') + String(a.price).replace('.', ','),
      body: 'Koers nu ' + String(Math.round(p * 100) / 100).replace('.', ',') + '. Het alarm staat nu uit; zet het opnieuw aan op de pagina van het aandeel.', url: held.has(a.sym) ? '#bedrijf/' + encodeURIComponent(a.sym) : '#volg/' + encodeURIComponent(a.sym), tag: 'price-' + a.sym, urgent: true });
  }
  if (hits) { const cur = await getSettings(env); cur.priceAlerts = list; await setKv(env, 'settings', JSON.stringify(cur)); }
  return hits ? hits + ' koersalarmen.' : '';
}

// ---------- Inleg deze maand: herinnering vanaf de 25e ----------
async function depositsThisMonth(env, now) {
  const p = parts(now);
  const monthStart = p.day.slice(0, 8) + '01';
  const { results: wk } = await env.DB.prepare('SELECT date, net_deposits FROM weeks ORDER BY date').all();
  const before = wk.filter((w) => w.date < monthStart).pop();
  const last = wk[wk.length - 1];
  if (!before || !last || last.date < monthStart) return { month: p.day.slice(0, 7), deposited: 0, known: !!before };
  return { month: p.day.slice(0, 7), deposited: Math.round((last.net_deposits - before.net_deposits) * 100) / 100, known: true, asOf: last.date };
}
async function depositReminder(env, now) {
  const p = parts(now);
  if (Number(p.day.slice(8, 10)) < 25 || p.hour !== 9) return '';
  const s = await getSettings(env);
  if (!(s.monthly > 0) || s.depositReminder === false || !(await pushSubs(env)).length) return '';
  const D = await depositsThisMonth(env, now);
  if (!D.known || D.deposited >= s.monthly * 0.9) return '';
  await alertOnce(env, 'deposit|' + D.month, { title: 'Inleg deze maand', body: 'Tot nu toe ' + nlEur(D.deposited) + ' van de ' + nlEur(s.monthly) + ' die je per maand wilt inleggen (stand weekmeting ' + (D.asOf || '') + ').', url: '#plannen', tag: 'deposit' });
  return 'Herinnering inleg verstuurd.';
}

// =====================================================================
// ---------- Bedrijvenlijst om te zoeken (SEC, ruim 10.000 Amerikaanse bedrijven) ----------
// Eén keer per week; daarnaast zoekt de Worker live bij Finnhub (ook andere beurzen) als die sleutel er is.
async function refreshCompanies(env) {
  if (!env.SEC_CONTACT) return 0;
  const r = await getJson('https://www.sec.gov/files/company_tickers.json', { 'User-Agent': 'investment-tracker (' + env.SEC_CONTACT + ')', Accept: 'application/json' });
  if (!r.ok || !r.body) { await noteExtError(env, 'sec', 'Bedrijvenlijst: SEC gaf ' + r.status); return 1; }
  const list = Object.values(r.body).filter((x) => x && x.ticker && x.title).map((x) => [String(x.ticker).toUpperCase().replace('-', '.'), String(x.title).slice(0, 70), Number(x.cik_str) || 0]);
  await setKv(env, 'companies', JSON.stringify(list));
  await setKv(env, 'companies_meta', JSON.stringify({ n: list.length, updated: parts(new Date()).day, source: 'SEC' }));
  return 1;
}
async function searchCompanies(env, q, url) {
  const query = String(q || '').trim().slice(0, 40);
  if (!query) return [];
  const Q = query.toUpperCase();
  const seen = new Map();
  const add = (sym, name, ex, src) => { const k = String(sym || '').toUpperCase(); if (!k || seen.has(k) || !/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(k)) return; seen.set(k, { sym: k, name: name || '', exchange: ex || '', src }); };
  let list = [];
  try { list = JSON.parse((await getKv(env, 'companies')) || '[]'); } catch (e) { list = []; }
  // Ook de bedrijven uit je fondsen en de profielen die de Worker al heeft
  try {
    const { results } = await env.DB.prepare("SELECT key, value FROM kv WHERE key IN ('etf_SP500', 'etf_NDX')").all();
    results.forEach((r) => { try { JSON.parse(r.value).rows.forEach((x) => list.push([String(x[0]).toUpperCase(), String(x[1] || '')])); } catch (e) { /* leeg */ } });
  } catch (e) { /* geen fondsen */ }
  const exact = list.filter((x) => x[0] === Q), starts = list.filter((x) => x[0] !== Q && x[0].startsWith(Q)), named = list.filter((x) => !x[0].startsWith(Q) && x[1].toUpperCase().includes(Q));
  exact.concat(starts.slice(0, 8), named.slice(0, 12)).forEach((x) => add(x[0], x[1], 'VS', 'lijst'));
  if (seen.size < 8 && env.FINNHUB_KEY && !(await srcDown(env, 'finnhub'))) {
    const r = await getJson(FINNHUB_BASE + '/search?q=' + encodeURIComponent(query) + '&token=' + encodeURIComponent(env.FINNHUB_KEY));
    if (r.ok && r.body && Array.isArray(r.body.result)) r.body.result.filter((x) => /Common Stock|ADR|ETP|ETF/i.test(x.type || '')).slice(0, 12).forEach((x) => add(x.symbol, x.description, x.displaySymbol !== x.symbol ? x.displaySymbol : '', 'Finnhub'));
    else if (r.status === 429) await srcFail(env, 'finnhub', 'Finnhub-limiet', true);
  }
  return [...seen.values()].slice(0, 15);
}

// ---------- Koersgeschiedenis van Twelve Data (gratis sleutel: 800 verzoeken per dag, 8 per minuut) ----------
async function twelveDaily(env, sym) {
  if (!env.TWELVEDATA_KEY) return null;
  const r = await getJson('https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(sym) + '&interval=1day&outputsize=300&apikey=' + encodeURIComponent(env.TWELVEDATA_KEY));
  const b = r.body || {};
  if (r.status === 429 || b.code === 429) { await srcFail(env, 'twelvedata', 'Twelve Data-limiet', true); throw new Error('Twelve Data-limiet bereikt'); }
  if (!r.ok || b.status === 'error' || !Array.isArray(b.values)) { await srcFail(env, 'twelvedata', 'Twelve Data: ' + (b.message || r.status)); return []; }
  await srcOk(env, 'twelvedata');
  return b.values.map((v) => [String(v.datetime).slice(0, 10), numOrNull(v.close)]).filter((x) => x[1] != null).sort((a, c) => a[0].localeCompare(c[0]));
}

// =====================================================================
// ---------- Foutmeldingen van de website (voor de statuspagina) ----------
async function logSiteError(env, b) {
  const clip = (x, n) => String(x == null ? '' : x).replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
  const e = { t: isoLocal(Date.now()), msg: clip(b && b.msg, 300), src: clip(b && b.src, 120), line: Number(b && b.line) || 0, ver: clip(b && b.ver, 12), page: clip(b && b.page, 30), n: 1 };
  if (!e.msg) return 0;
  let list = [];
  try { list = JSON.parse((await getKv(env, 'site_errors')) || '[]'); } catch (x) { list = []; }
  const same = list.find((x) => x.msg === e.msg && x.src === e.src);
  if (same) { same.n = (same.n || 1) + 1; same.t = e.t; same.ver = e.ver; } else list.push(e);
  list = list.sort((a, c) => a.t.localeCompare(c.t)).slice(-30);
  await setKv(env, 'site_errors', JSON.stringify(list));
  return list.length;
}

// ---------- Ochtendmelding: nieuws over je posities van de afgelopen dag ----------
// Alleen als de site het aanzet (settings.prefs.morningPush) en er een apparaat is aangemeld; werkdagen rond 08:00.
async function morningPush(env, at) {
  const p = parts(at);
  if (p.weekday > 5 || p.hm < '08:00' || p.hm >= '08:30') return null;
  const s = await getSettings(env);
  if (!(s.prefs && s.prefs.morningPush) || !(await pushSubs(env)).length) return null;
  const mute = new Set(((s.prefs && s.prefs.newsMute) || []).map((x) => String(x).toLowerCase()));
  const { results } = await env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'rs\\_%' ESCAPE '\\'").all();
  const since = at.getTime() - 24 * 3600e3;
  const items = [];
  results.forEach((r) => {
    try { (JSON.parse(r.value).news || []).forEach((n) => { if (n.t >= since && !mute.has(String(n.source || '').toLowerCase())) items.push(Object.assign({ tk: r.key.slice(3) }, n)); }); } catch (e) { /* overslaan */ }
  });
  if (!items.length) return null;
  items.sort((a, b) => b.t - a.t);
  const tks = [...new Set(items.map((x) => x.tk))];
  const body = items.length + ' berichten over ' + tks.slice(0, 5).join(', ') + (tks.length > 5 ? ' en meer' : '') + '. Laatste: ' + items[0].tk + ' – ' + items[0].headline;
  return alertOnce(env, 'morning|' + p.day, { title: 'Nieuws over je aandelen', body: body.slice(0, 230), url: '#nieuws' });
}

// ---------- Reservekopie naar Cloudflare R2 (optioneel, wekelijks op zondag) ----------
// Zet in wrangler.toml een R2-binding met de naam BACKUP (zie worker/README.md). Zonder binding gebeurt er niets.
async function r2Backup(env, at) {
  if (!env.BACKUP || parts(at).weekday !== 7) return null;
  const day = parts(at).day;
  if ((await getKv(env, 'r2_last')) === day) return null;
  const out = await backupPart(env, null, 0);
  out.data = {};
  for (const t of Object.keys(BACKUP_TABLES)) {
    out.data[t] = [];
    for (let off = 0; off < 200000; off += BACKUP_PAGE) {
      const part = await backupPart(env, t, off);
      out.data[t].push(...part.rows);
      if (part.rows.length < BACKUP_PAGE) break;
    }
  }
  await env.BACKUP.put('backup-' + day + '.json', JSON.stringify(out), { httpMetadata: { contentType: 'application/json' } });
  // Alleen de laatste 8 kopieën bewaren
  const listed = await env.BACKUP.list({ prefix: 'backup-' });
  const keys = ((listed && listed.objects) || []).map((o) => o.key).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 8))) await env.BACKUP.delete(k);
  await setKv(env, 'r2_last', day);
  return day;
}

// ---------- Deponeringen bij de SEC per bedrijf (jaar- en kwartaalverslagen, 8-K) ----------
// CIK-nummers uit de bedrijvenlijst; per stap hoogstens 5 bedrijven, de langst niet bijgewerkte eerst.
const FILING_FORMS = /^(10-K|10-Q|8-K|20-F|6-K|40-F|S-1|DEF 14A)$/;
async function secFilings(env) {
  if (!env.SEC_CONTACT) return 0;
  let list = [];
  try { list = JSON.parse((await getKv(env, 'companies')) || '[]'); } catch (e) { list = []; }
  const cik = new Map(list.filter((x) => x[2]).map((x) => [x[0], x[2]]));
  const syms = [...new Set((await heldStocks(env)).concat(await watchStocks(env)).map((h) => h.symbol))].filter((s) => cik.has(s));
  let cur = {};
  try { cur = JSON.parse((await getKv(env, 'filings')) || '{}'); } catch (e) { cur = {}; }
  const per = cur.per || {};
  const today = parts(new Date()).day;
  const todo = syms.filter((s) => !per[s] || per[s].checked < today)
    .sort((a, b) => ((per[a] && per[a].checked) || '').localeCompare((per[b] && per[b].checked) || '')).slice(0, 5);
  let used = 0;
  for (const sym of todo) {
    const c = cik.get(sym);
    const r = await getJson('https://data.sec.gov/submissions/CIK' + String(c).padStart(10, '0') + '.json', { 'User-Agent': 'investment-tracker (' + env.SEC_CONTACT + ')', Accept: 'application/json' });
    used++;
    if (!r.ok || !r.body || !r.body.filings || !r.body.filings.recent) { await noteExtError(env, 'sec', 'Deponeringen ' + sym + ': SEC gaf ' + r.status); continue; }
    const f = r.body.filings.recent;
    const out = [];
    for (let i = 0; i < (f.form || []).length && out.length < 8; i++) {
      if (!FILING_FORMS.test(f.form[i])) continue;
      const acc = String(f.accessionNumber[i] || '').replace(/-/g, '');
      out.push({ date: f.filingDate[i], form: f.form[i], desc: String((f.primaryDocDescription && f.primaryDocDescription[i]) || '').slice(0, 80), items: String((f.items && f.items[i]) || '').slice(0, 40),
        url: 'https://www.sec.gov/Archives/edgar/data/' + c + '/' + acc + '/' + ((f.primaryDocument && f.primaryDocument[i]) || '') });
    }
    per[sym] = { checked: today, list: out };
  }
  // Symbolen die je niet meer volgt of hebt weghalen
  Object.keys(per).forEach((k) => { if (!syms.includes(k)) delete per[k]; });
  await setKv(env, 'filings', JSON.stringify({ updated: isoLocal(Date.now()), per }));
  return used;
}

// ---------- 13F: wat grote beleggers (volgens hun kwartaalopgave bij de SEC) bezitten ----------
const F13_FUNDS = [
  [1067983, 'Berkshire Hathaway (Warren Buffett)'], [1336528, 'Pershing Square (Bill Ackman)'],
  [1649339, 'Scion Asset Management (Michael Burry)'], [1350694, 'Bridgewater Associates (Ray Dalio)'],
];
const xmlTag = (block, tag) => { const m = new RegExp('<(?:\\w+:)?' + tag + '>([^<]*)</(?:\\w+:)?' + tag + '>', 'i').exec(block); return m ? m[1].trim() : ''; };
function parse13F(txt) {
  const by = new Map();
  (txt.match(/<(?:\w+:)?infoTable>[\s\S]*?<\/(?:\w+:)?infoTable>/gi) || []).forEach((b) => {
    if (xmlTag(b, 'putCall')) return; // opties niet meetellen
    const nm = xmlTag(b, 'nameOfIssuer'), v = Number(xmlTag(b, 'value')) || 0, sh = Number(xmlTag(b, 'sshPrnamt')) || 0;
    if (!nm) return;
    const o = by.get(nm) || { name: nm, value: 0, shares: 0 };
    o.value += v; o.shares += sh; by.set(nm, o);
  });
  return [...by.values()].sort((a, b) => b.value - a.value);
}
async function fetch13F(env) {
  if (!env.SEC_CONTACT) return 0;
  const H = { 'User-Agent': 'investment-tracker (' + env.SEC_CONTACT + ')', Accept: 'application/json' };
  let prev = {};
  try { prev = JSON.parse((await getKv(env, 'f13')) || '{}'); } catch (e) { prev = {}; }
  const funds = [];
  let used = 0;
  for (const [cik, label] of F13_FUNDS) {
    const old = (prev.funds || []).find((x) => x.cik === cik);
    try {
      const sub = await getJson('https://data.sec.gov/submissions/CIK' + String(cik).padStart(10, '0') + '.json', H); used++;
      const f = sub.ok && sub.body && sub.body.filings && sub.body.filings.recent;
      const i = f ? f.form.findIndex((x) => x === '13F-HR' || x === '13F-HR/A') : -1;
      if (i < 0) { if (old) funds.push(old); continue; }
      const acc = f.accessionNumber[i], period = (f.reportDate && f.reportDate[i]) || '', filed = f.filingDate[i];
      if (old && old.acc === acc) { funds.push(old); continue; }
      const base = 'https://www.sec.gov/Archives/edgar/data/' + cik + '/' + acc.replace(/-/g, '') + '/';
      const idx = await getJson(base + 'index.json', H); used++;
      const items = (idx.ok && idx.body && idx.body.directory && idx.body.directory.item) || [];
      const xml = items.map((x) => x.name).find((n) => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
      if (!xml) { if (old) funds.push(old); continue; }
      const res = await fetch(base + xml, { headers: { 'User-Agent': H['User-Agent'] } }); used++;
      if (!res.ok) { await noteExtError(env, 'sec', '13F ' + label + ': SEC gaf ' + res.status); if (old) funds.push(old); continue; }
      const all = parse13F(await res.text());
      const total = all.reduce((a, x) => a + x.value, 0);
      const before = new Map(((old && old.top) || []).map((x) => [x.name, x]));
      const top = all.slice(0, 15).map((x) => {
        const p = before.get(x.name);
        return { name: x.name, value: x.value, shares: x.shares, pct: total ? x.value / total : 0, chg: p && p.shares ? x.shares / p.shares - 1 : null, isNew: !!old && !p };
      });
      funds.push({ cik, label, acc, period, filed, total, n: all.length, top, names: all.map((x) => x.name).slice(0, 200) });
    } catch (e) {
      await noteExtError(env, 'sec', '13F ' + label + ': ' + String(e && e.message || e).slice(0, 80));
      if (old) funds.push(old);
    }
  }
  await setKv(env, 'f13', JSON.stringify({ updated: parts(new Date()).day, funds }));
  return used;
}

// ---------- Economische agenda: publicatiedata van inflatie, banen, bbp en de Fed (FRED, met sleutel) ----------
const ECON_RE = /^(Consumer Price Index|Employment Situation|Gross Domestic Product|FOMC Press Release|Personal Income and Outlays|Producer Price Index)/i;
async function econCalendar(env) {
  if (!env.FRED_KEY) return 0;
  const from = ymdUTC(Date.now()), to = ymdUTC(Date.now() + 75 * 864e5);
  const r = await getJson('https://api.stlouisfed.org/fred/releases/dates?file_type=json&include_release_dates_with_no_data=true&sort_order=asc&limit=1000&realtime_start=' + from + '&realtime_end=' + to + '&api_key=' + encodeURIComponent(env.FRED_KEY));
  if (!r.ok || !r.body) { await noteExtError(env, 'indices', 'Economische agenda: FRED gaf ' + r.status); return 1; }
  const items = (r.body.release_dates || []).filter((x) => ECON_RE.test(x.release_name || '') && x.date >= from)
    .map((x) => ({ date: x.date, name: x.release_name, id: x.release_id })).slice(0, 40);
  await setKv(env, 'econ', JSON.stringify({ updated: isoLocal(Date.now()), source: 'FRED', items }));
  return 1;
}

// ---------- Trading 212-pies: rendement per pie ----------
// De lijst geeft geen namen; die komen per pie (hoogstens 1 per 5 seconden), dus per keer 4 pies en de namen bewaren.
async function fetchPies(env) {
  let list;
  try { list = await t212(env, '/api/v0/equity/pies'); } catch (e) { await noteExtError(env, 'pies', String(e && e.message || e).slice(0, 120)); return 1; }
  let prev = {};
  try { prev = JSON.parse((await getKv(env, 'pies')) || '{}'); } catch (e) { prev = {}; }
  const old = new Map((prev.list || []).map((x) => [x.id, x]));
  const pies = (Array.isArray(list) ? list : []).slice(0, 20).map((p) => {
    const r = p.result || {};
    const o = old.get(p.id) || {};
    return { id: p.id, name: o.name || null, invested: numOrNull(r.priceAvgInvestedValue), value: numOrNull(r.priceAvgValue), result: numOrNull(r.priceAvgResult), resultPct: numOrNull(r.priceAvgResultCoef),
      cash: numOrNull(p.cash), divGained: numOrNull(p.dividendDetails && p.dividendDetails.gained), progress: numOrNull(p.progress), status: p.status || null,
      goal: o.goal || null, instruments: o.instruments || [], detailAt: o.detailAt || '' };
  });
  let used = 1;
  const todo = pies.slice().sort((a, b) => (a.detailAt || '').localeCompare(b.detailAt || '')).slice(0, 4);
  for (const p of todo) {
    try {
      await sleep(PIE_WAIT_MS);
      const d = await t212(env, '/api/v0/equity/pies/' + p.id); used++;
      p.name = (d.settings && d.settings.name) || p.name;
      p.goal = numOrNull(d.settings && d.settings.goal);
      p.instruments = (d.instruments || []).slice(0, 50).map((x) => ({ tk: String(x.ticker || '').split('_')[0], target: numOrNull(x.expectedShare), share: numOrNull(x.currentShare),
        value: numOrNull(x.result && x.result.priceAvgValue), result: numOrNull(x.result && x.result.priceAvgResult) }));
      p.detailAt = isoLocal(Date.now());
    } catch (e) { break; }
  }
  await setKv(env, 'pies', JSON.stringify({ updated: isoLocal(Date.now()), list: pies }));
  return used;
}
let PIE_WAIT_MS = 5200;
export function _setPieWait(ms) { PIE_WAIT_MS = ms; }
export { parse13F };
