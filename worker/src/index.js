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
      })());
      return;
    }
    const at = new Date(event.scheduledTime);
    ctx.waitUntil(tick(env, at, false)
      .then(() => setKv(env, 'last_cron', new Date().toISOString()))
      .then(async () => {
        if (isLive(at)) return null;
        // Buiten de meettijden: eerst (1x per dag) de orders, anders een portie marktgegevens
        if (env.T212_KEY && (await getKv(env, 'orders_synced')) !== parts(at).day) return syncOrders(env);
        return marketStep(env);
      })
      .catch(async (e) => {
        console.error('tick', e);
        try { await setKv(env, 'last_error', new Date().toISOString() + ' ' + String(e && e.message || e)); } catch (_) {}
      }));
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
        // Het overzicht wordt na elke meting opgebouwd en bewaard; zo leest een websitevraag maar één rij.
        const cached = await getKv(env, 'data_cache');
        if (cached && !url.searchParams.has('fresh')) {
          return new Response(cached, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
        }
        const data = await buildData(env);
        await setKv(env, 'data_cache', JSON.stringify(data));
        return json(data, 200, cors);
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
        await setKv(env, 'data_cache', JSON.stringify(await buildData(env)));
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
const KEY_NAMES = ['T212_KEY', 'T212_SECRET', 'FMP_KEY', 'FINNHUB_KEY', 'SEC_CONTACT', 'FRED_KEY'];

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

const FEATURE_DEFAULTS = { fx: true, inflation: true, sec: true, etfAuto: true, indices: true };
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
  };
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Vary': 'Origin',
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(headers || {}) },
  });
}

// Geeft de toegangscode terug als sleutel én secret gelijk zijn aan die van Trading 212 in deze Worker.
// Zo hoef je op een nieuw apparaat de toegangscode niet te weten: alle andere koppelingen staan al in de Worker.
// Maximaal 10 mislukte pogingen per uur (voor de hele Worker); de sleutel wordt nergens bewaard.
async function loginWithT212(request, envIn, cors) {
  await ensureSchema(envIn);
  const body = await request.json().catch(() => ({}));
  const key = String((body && body.key) || '').trim(), secret = String((body && body.secret) || '').trim();
  const hour = new Date().toISOString().slice(0, 13);
  let lim = {};
  try { lim = JSON.parse((await getKv(envIn, 'login_fail')) || '{}'); } catch (e) { lim = {}; }
  const fails = lim.h === hour ? lim.n || 0 : 0;
  if (fails >= 10) return json({ ok: false, error: 'Te veel mislukte pogingen. Probeer het over een uur opnieuw, of gebruik je toegangscode.' }, 429, cors);
  const env = await withKeys(envIn);
  if (!env.T212_KEY || !env.T212_SECRET) return json({ ok: false, error: 'In deze Worker staat nog geen Trading 212-sleutel. Log in met je toegangscode en voeg de sleutel toe bij Koppelingen.' }, 409, cors);
  const ok = key.length > 8 && secret.length > 8 && safeEqual(String(env.T212_KEY), key) && safeEqual(String(env.T212_SECRET), secret);
  if (!ok) {
    await setKv(envIn, 'login_fail', JSON.stringify({ h: hour, n: fails + 1 }));
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
    if (last !== p.day) msgs.push(await weeklySnapshot(env, now, false));
  }
  const text = msgs.filter(Boolean).join(' ');
  if (text) await setKv(env, 'data_cache', JSON.stringify(await buildData(env)));
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
  await setKv(env, 'data_cache', JSON.stringify(await buildData(env)));
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
  await setKv(env, 'data_cache', JSON.stringify(await buildData(env)));
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
  await setKv(env, 'data_cache', JSON.stringify(await buildData(env)));
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
    clean.watchlist = [...new Set(body.watchlist.map((x) => String(x || '').trim().toUpperCase()).filter((x) => /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(x)))].slice(0, 20);
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
  if (body && body.features && typeof body.features === 'object') {
    clean.features = Object.assign({}, cur.features || {});
    Object.keys(FEATURE_DEFAULTS).forEach((k) => { if (typeof body.features[k] === 'boolean') clean.features[k] = body.features[k]; });
  }
  const next = Object.assign({}, cur, clean, { updated: isoLocal(Date.now()) });
  await setKv(env, 'settings', JSON.stringify(next));
  await setKv(env, 'data_cache', JSON.stringify(await buildData(env)));
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
  await setKv(env, 'data_cache', JSON.stringify(await buildData(env)));
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
  out.has = { fmp: !!env.FMP_KEY, finnhub: !!env.FINNHUB_KEY, sec: !!env.SEC_CONTACT, t212: !!(env.T212_KEY && env.T212_SECRET) };
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
    const r = await getJson('https://api.frankfurter.dev/v1/' + ymdUTC(Date.now() - 400 * 864e5) + '..?from=EUR&to=USD,GBP');
    if (!r.ok) { await noteExtError(env, 'fx', 'Frankfurter gaf ' + r.status); return 1; }
    const rates = { USD: [], GBP: [] };
    Object.keys(r.body.rates || {}).sort().forEach((d) => { const o = r.body.rates[d]; if (o.USD) rates.USD.push([d, o.USD]); if (o.GBP) rates.GBP.push([d, o.GBP]); });
    await setKv(env, 'fx', JSON.stringify({ updated: isoLocal(Date.now()), source: 'ECB via Frankfurter', rates }));
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
      if (!res.ok) { await noteExtError(env, 'inflation', 'ECB gaf ' + res.status); continue; }
      const lines = (await res.text()).trim().split(/\r?\n/);
      const head = lines[0].split(',');
      const iT = head.indexOf('TIME_PERIOD'), iV = head.indexOf('OBS_VALUE');
      out.series[area] = lines.slice(1).map((l) => l.split(',')).filter((c) => c[iT] && isFinite(Number(c[iV]))).map((c) => [c[iT], Number(c[iV])]);
    }
    if (Object.keys(out.series).length) { await setKv(env, 'hicp', JSON.stringify(out)); await noteExtError(env, 'inflation', null); }
    return 2;
  }
  if (kind === 'idx') {
    // Dagkoersen van de S&P 500 en de Nasdaq-100 (koersindex, in dollars) uit FRED van de Federal Reserve Bank of St. Louis
    const out = { updated: isoLocal(Date.now()), source: 'FRED (Federal Reserve Bank of St. Louis)', series: {} };
    const since = ymdUTC(Date.now() - 400 * 864e5);
    for (const id of ['SP500', 'NASDAQ100']) {
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
    if (Object.keys(out.series).length) { await setKv(env, 'idx', JSON.stringify(out)); await noteExtError(env, 'indices', null); }
    return 2;
  }
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
  if (kind === 'fh') return finnhubTask(env, arg);
  if (kind === 'sec') return secTask(env, arg);
  return 0;
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

// Zet de taken voor vandaag klaar (1x per dag na de agenda, of handmatig)
async function planMarket(env) {
  await ensureMarketTables(env);
  const now = new Date();
  const usDay = lastUsDay(now);
  const held = await heldStocks(env);
  const watch = (await watchStocks(env)).filter((w) => !held.some((h) => h.symbol === w.symbol));
  const all = held.concat(watch);
  const tasks = [];
  const flags = await featureFlags(env);
  // Bronnen zonder sleutel eerst: wisselkoersen, inflatie en indexen (1x per dag, klein)
  if (flags.fx) tasks.push('fx');
  if (flags.inflation) tasks.push('hicp');
  if (flags.indices) tasks.push('idx');
  if (env.FINNHUB_KEY) { tasks.push('fhnews'); all.forEach((h) => tasks.push('fh:' + h.ticker)); }
  if (flags.sec && env.SEC_CONTACT) {
    const { results: fins } = await env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'fin\\_%' ESCAPE '\\'").all();
    const age = new Map(fins.map((r) => { try { return [r.key.slice(4), JSON.parse(r.value).updated || '']; } catch (e) { return [r.key.slice(4), '']; } }));
    const weekAgo2 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    all.forEach((h) => { if ((age.get(h.ticker) || '') < weekAgo2) tasks.push('sec:' + h.ticker); });
  }
  if (!env.FMP_KEY) {
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
  let unknown = [];
  try { unknown = JSON.parse((await getKv(env, 'mkt_unknown')) || '[]'); } catch (e) { unknown = []; }
  while (queue.length && calls < MARKET_STEP_CALLS && !stop) {
    const task = queue.shift();
    const ci = task.indexOf(':');
    const kind = ci < 0 ? task : task.slice(0, ci), arg = ci < 0 ? '' : task.slice(ci + 1);
    try {
      if (kind === 'fx' || kind === 'hicp' || kind === 'idx' || kind === 'fh' || kind === 'fhnews' || kind === 'sec') {
        calls += await externalTask(env, kind, arg);
      } else if (!env.FMP_KEY) {
        // FMP-taak zonder sleutel: overslaan
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
        const p = (await fmp(env, '/profile?symbol=' + encodeURIComponent(arg)))[0];
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
        const from = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
        try {
          const rows = await fmp(env, '/historical-price-eod/light?symbol=' + encodeURIComponent(arg) + '&from=' + from);
          const st = env.DB.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)');
          rows.filter((r) => r.date && isFinite(Number(r.price))).forEach((r) => writes.push(st.bind(arg, r.date, Number(r.price))));
        } catch (e) {
          if (/402/.test(e.message)) { if (!noHist.includes(arg)) noHist.push(arg); } else throw e;
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
      if (/Finnhub-limiet/.test(e.message)) {
        // Finnhub zit aan zijn limiet: Finnhub-taken naar achteren, de rest (zoals FMP-koersen) gaat door
        const fh = [task].concat(queue.filter((t) => t.startsWith('fh:') || t === 'fhnews'));
        queue = queue.filter((t) => !(t.startsWith('fh:') || t === 'fhnews'));
        deferred.push(...fh);
      } else if (/limiet|subrequests/i.test(e.message)) { queue.unshift(task); stop = true; }
      else if (/ongeldig/i.test(e.message) && /^fh:/.test(task)) { queue = queue.filter((t) => !t.startsWith('fh:')); }
    }
  }
  queue.push(...deferred);
  for (let i = 0; i < writes.length; i += 100) await env.DB.batch(writes.slice(i, i + 100));
  await flushFmp(env);
  await setKv(env, 'mkt_queue', JSON.stringify(queue));
  await setKv(env, 'eod_unavailable', JSON.stringify(noHist));
  await setKv(env, 'mkt_unknown', JSON.stringify(unknown));
  if (errors.length) await setKv(env, 'mkt_errors', JSON.stringify(errors.slice(-20)));
  if (done) await setKv(env, 'data_cache', JSON.stringify(await buildData(env)));
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
  const watch = await watchStocks(env);
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
  await setKv(env, 'data_cache', JSON.stringify(await buildData(env)));
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
