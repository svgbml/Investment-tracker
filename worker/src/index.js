/**
 * Investeringstracker – Cloudflare Worker (versie zonder Google Sheets)
 *
 * Wat hij doet:
 *  - Elke 10 minuten op werkdagen, de hele dag (Amsterdam): posities ophalen uit de Trading 212 API
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
// Handelsuren (Europa en VS): daarbuiten haalt de Worker naast het meten ook orders en marktgegevens op
const MARKET_START = '08:00';
const MARKET_END = '22:30';
const KEEP_INTRADAY_MS = 3 * 864e5;
const HOUR_MS = 3600e3;
const TOTAL = 'TOTAAL';
const EVENTS_CRON = '17 5 * * *';

// ---------- Verbruik per bron: elk extern verzoek telt mee (zie /api/status) ----------
// Deze functie overschaduwt de globale fetch binnen dit bestand; de echte staat in globalThis.fetch.
const CALL_COUNTS = new Map();
let flushedAt = 0;
// Live koersen in het geheugen (zie liveQuotes)
const QUOTES_MS = 2000;
const QUOTES = { t: 0, out: null };
const CALL_HOSTS = [
  [/financialmodelingprep/, 'fmp'], [/finnhub/, 'finnhub'], [/alphavantage/, 'alphavantage'], [/twelvedata/, 'twelvedata'],
  [/tiingo\.com/, 'tiingo'], [/massive\.com|polygon\.io/, 'polygon'], [/marketaux\.com/, 'marketaux'], [/openfigi\.com/, 'openfigi'], [/gdeltproject\.org/, 'gdelt'],
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
// D1 telt voor de daglimiet (gratis: 5 miljoen gelezen en 100.000 geschreven rijen per UTC-dag) elke rij die een
// query doorloopt. Elk antwoord van D1 noemt die aantallen in meta; deze laag telt ze op, zodat de site kan
// laten zien hoe dicht je bij de limiet zit. first() loopt via all(), want alleen all() en run() geven meta terug.
function countingDb(db) {
  if (!db || db.__counted) return db;
  const add = (meta) => {
    if (!meta) return;
    const r = Number(meta.rows_read) || 0, w = Number(meta.rows_written) || 0;
    if (r) CALL_COUNTS.set('d1_read', (CALL_COUNTS.get('d1_read') || 0) + r);
    if (w) CALL_COUNTS.set('d1_write', (CALL_COUNTS.get('d1_write') || 0) + w);
  };
  const wrap = (st) => ({
    __inner: st,
    bind: (...a) => wrap(st.bind(...a)),
    async first(col) {
      const r = await st.all();
      add(r && r.meta);
      const row = r && r.results && r.results[0];
      return row === undefined ? null : col ? (row[col] === undefined ? null : row[col]) : row;
    },
    async all() { const r = await st.all(); add(r && r.meta); return r; },
    async run() { const r = await st.run(); add(r && r.meta); return r; },
  });
  return {
    __counted: true,
    __raw: db,
    prepare: (sql) => wrap(db.prepare(sql)),
    async batch(list) { const r = await db.batch(list.map((x) => (x && x.__inner) || x)); (r || []).forEach((x) => add(x && x.meta)); return r; },
    exec: (q) => db.exec(q),
  };
}
function countedEnv(env) {
  if (!env || !env.DB || env.DB.__counted) return env;
  const e = Object.create(env);
  e.DB = countingDb(env.DB);
  return e;
}
// Cloudflare-tellingen per UTC-dag (daar rekent Cloudflare de gratis limieten mee)
const CF_KEYS = ['d1_read', 'd1_write', 'worker_req'];
const D1_READ_LIMIT = 5e6, D1_WRITE_LIMIT = 1e5;
const CF_HIST_DAYS = 14;
// Trend van de gelezen rijen: groei per dag (rechte lijn door de laatste 7 volle dagen) en wanneer je bij deze groei
// aan de daglimiet zit. Null als er te weinig dagen zijn of het gebruik niet groeit.
function cfTrend(c) {
  const hist = (c && c.hist) || {};
  const days = Object.keys(hist).sort().map((d) => ({ day: d, d1_read: Number(hist[d].d1_read) || 0, d1_write: Number(hist[d].d1_write) || 0, worker_req: Number(hist[d].worker_req) || 0 }));
  const last7 = days.slice(-7);
  let growth = null, daysToLimit = null, avg = null;
  if (last7.length) avg = last7.reduce((a, x) => a + x.d1_read, 0) / last7.length;
  if (last7.length >= 4) {
    const n = last7.length, xs = last7.map((_, i) => i), ys = last7.map((x) => x.d1_read);
    const mx = (n - 1) / 2, my = ys.reduce((a, y) => a + y, 0) / n;
    let sxy = 0, sxx = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
    growth = sxx ? sxy / sxx : 0;
    const lastFit = my + growth * (n - 1 - mx);
    if (growth > 0) daysToLimit = Math.max(0, Math.ceil((D1_READ_LIMIT - lastFit) / growth));
  }
  return { days, avg, growth, daysToLimit };
}
const D1_WARN_AT = 0.7, D1_SAVE_AT = 0.85;
const SAVE_BUILD_MS = 30 * 60e3;   // in de spaarstand het overzicht hoogstens eens per half uur opbouwen
// Hoe ver de database vandaag (UTC) is: het hoogste van gelezen en geschreven rijen tegenover hun limiet
function cfShare(c) { return Math.max((Number(c.d1_read) || 0) / D1_READ_LIMIT, (Number(c.d1_write) || 0) / D1_WRITE_LIMIT); }
async function cfToday(env) {
  try { const c = JSON.parse((await getKv(env, 'cf_usage')) || '{}'); return c.day === new Date().toISOString().slice(0, 10) ? c : {}; } catch (e) { return {}; }
}
// Spaarstand: vanaf 85% van de daglimiet tot middernacht UTC. Metingen gaan door; opbouwen gaat langzamer,
// marktgegevens wachten en de site ververst minder vaak.
async function saveMode(env) { return cfShare(await cfToday(env)) >= D1_SAVE_AT; }

// Schrijf de tellingen van deze aanroep weg (één schrijfactie), per dag, 14 dagen bewaard
async function flushCalls(env) {
  if (!CALL_COUNTS.size) return;
  const all = Object.fromEntries(CALL_COUNTS);
  CALL_COUNTS.clear();
  const cf = {}, add = {};
  Object.entries(all).forEach(([k, n]) => { if (CF_KEYS.includes(k)) cf[k] = n; else add[k] = n; });
  if (Object.keys(cf).length) {
    try {
      const day = new Date().toISOString().slice(0, 10);
      let c = {};
      try { c = JSON.parse((await getKv(env, 'cf_usage')) || '{}'); } catch (e) { c = {}; }
      if (c.day !== day) {
        const hist = Object.assign({}, c.hist || {});
        if (c.day) hist[c.day] = { d1_read: c.d1_read || 0, d1_write: c.d1_write || 0, worker_req: c.worker_req || 0 };
        Object.keys(hist).sort().slice(0, -CF_HIST_DAYS).forEach((k) => { delete hist[k]; });
        c = { day, hist };
      }
      CF_KEYS.forEach((k) => { if (cf[k]) c[k] = (c[k] || 0) + cf[k]; });
      // Eén keer per dag melden bij 70% en bij het ingaan van de spaarstand (85%)
      const share = cfShare(c);
      const step = share >= D1_SAVE_AT ? 'save' : share >= D1_WARN_AT ? 'warn' : null;
      const fresh = step && c.noted !== step && !(c.noted === 'save' && step === 'warn');
      if (fresh) c.noted = step;
      await setKv(env, 'cf_usage', JSON.stringify(c));
      if (fresh && (await pushSubs(env)).length) {
        const pct = Math.round(share * 100);
        await alertOnce(env, 'd1|' + step + '|' + day, step === 'save'
          ? { title: 'Spaarstand: database bijna vol voor vandaag', body: 'De database van je tracker heeft ' + pct + '% van zijn gratis daglimiet gebruikt. Tot middernacht UTC meet hij gewoon door, maar ververst hij minder vaak en wachten de marktgegevens.', url: '#status', tag: 'd1' }
          : { title: 'Database op ' + pct + '% van de daglimiet', body: 'De database van je tracker heeft vandaag ' + pct + '% van zijn gratis leeslimiet gebruikt. Bij 85% gaat hij vanzelf in de spaarstand.', url: '#status', tag: 'd1' });
      }
    } catch (e) { /* niet erg */ }
  }
  if (!Object.keys(add).length) return;
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

const WORKER = {
  async scheduled(event, envIn, ctx) {
    envIn = countedEnv(envIn);
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
        try { await dbWatch(env, true); } catch (e) { await fail('database', e); }
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
      .then(() => newsWatch(env, at.getTime()).catch((e) => console.error('nieuwswacht', e)))
      .then(async () => {
        if (marketHours(at)) return null;
        // Buiten de handelsuren: eerst (1x per dag) de orders, anders een portie marktgegevens
        if (env.T212_KEY && (await getKv(env, 'orders_synced')) !== parts(at).day) return syncOrders(env);
        if (await saveMode(env)) return 'Spaarstand: marktgegevens wachten tot na middernacht (UTC).';
        return marketStep(env);
      })
      .catch(async (e) => {
        console.error('tick', e);
        try { await setKv(env, 'last_error', new Date().toISOString() + ' ' + String(e && e.message || e)); } catch (_) {}
        try { await tickFailed(env, at, e); } catch (_) {}
      })
      .finally(() => flushCalls(env)));
  },

  async fetch(request, envIn, ctx) {
    const env0 = countedEnv(envIn);
    CALL_COUNTS.set('worker_req', (CALL_COUNTS.get('worker_req') || 0) + 1);
    const res = await WORKER.handleFetch(request, env0);
    // Tellingen van dit verzoek (bronnen, D1-rijen) wegschrijven nadat het antwoord weg is. Live koersen komen elke
    // paar seconden: die tellingen hoogstens eens per minuut wegschrijven, anders kost elk verzoek een schrijfactie.
    // shortcut: tellingen van live koersen gaan verloren als Cloudflare de Worker binnen die minuut stopt; klein verschil.
    const quiet = new URL(request.url).pathname === '/api/quotes' && Date.now() - flushedAt < 60e3;
    if (!quiet && ctx && typeof ctx.waitUntil === 'function') { flushedAt = Date.now(); ctx.waitUntil(flushCalls(env0).catch(() => {})); }
    return res;
  },

  async handleFetch(request, envIn) {
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
      if (shareExpired(c)) return json({ ok: false, error: 'Deze deel-link is verlopen op ' + String(c.until).slice(0, 10) + '.' }, 410, cors);
      const body = await shareBody(envIn, c);
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

    const auth = await authCheck(request, url, envIn);
    if (!auth.ok) {
      return json({ ok: false, error: auth.error || 'Ongeldige of ontbrekende toegangscode.' }, 401, cors);
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
        if (body && body.off) { await setKv(env, 'cal_token', ''); await auditLog(env, 'link', 'agenda-link uitgezet'); return json({ ok: true, url: null }, 200, cors); }
        if (body && body.rotate) await auditLog(env, 'link', 'nieuwe agenda-link gemaakt');
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
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true, health: await healthInfo(env) }, 200, cors);
      }
      if (url.pathname === '/api/keytest' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        try { return json({ ok: true, result: await testKey(env, b && b.name, b && b.value) }, 200, cors); }
        catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 400, cors); }
      }
      if (url.pathname === '/api/r2') {
        try {
          if (request.method === 'GET') {
            const key = url.searchParams.get('preview');
            return json(Object.assign({ ok: true }, key ? await r2Preview(env, key) : await r2Info(env)), 200, cors);
          }
          if (request.method === 'POST') {
            const day = await r2Backup(env, new Date(), true);
            return json({ ok: true, made: day, list: (await r2Info(env)).copies }, 200, cors);
          }
        } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 400, cors); }
      }
      if (url.pathname === '/api/backup' && request.method === 'GET') {
        return json(Object.assign({ ok: true }, await backupPart(env, url.searchParams.get('table'), url.searchParams.get('offset'))), 200, cors);
      }
      if (url.pathname === '/api/restore' && request.method === 'POST') {
        return json(Object.assign({ ok: true }, await restorePart(env, await request.json().catch(() => ({})))), 200, cors);
      }
      if (url.pathname === '/api/news' && request.method === 'GET') {
        return json(Object.assign({ ok: true }, await newsArchive(env, url.searchParams)), 200, cors);
      }
      if (url.pathname === '/api/search' && request.method === 'GET') {
        const results = await searchCompanies(env, url.searchParams.get('q'), url);
        await flushCalls(env);
        return json({ ok: true, results }, 200, cors);
      }
      if (url.pathname === '/api/trade/order' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        try {
          const out = await placeOrder(env, b);
          await auditLog(env, 'order', 'order geplaatst: ' + String((b && b.side) || '?') + ' ' + String((b && b.ticker) || '?'));
          return json(Object.assign({ ok: true }, out), 200, cors);
        } catch (e) {
          await auditLog(env, 'order', 'order geweigerd: ' + String(e && e.message || e).slice(0, 100));
          return json({ ok: false, error: String(e && e.message || e) }, 400, cors);
        }
      }
      if (url.pathname === '/api/trade/orders' && request.method === 'GET') {
        try { return json(Object.assign({ ok: true }, await openOrders(env)), 200, cors); }
        catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 400, cors); }
      }
      if (url.pathname === '/api/trade/cancel' && request.method === 'POST') {
        try { const b = await request.json().catch(() => ({})); const out = await cancelOrder(env, b.id); await auditLog(env, 'order', 'order ingetrokken'); return json(Object.assign({ ok: true }, out), 200, cors); }
        catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 400, cors); }
      }
      if (url.pathname === '/api/live' && request.method === 'GET') {
        try { return json(Object.assign({ ok: true }, await liveCheck(env, url.searchParams.get('tk'))), 200, cors); }
        catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 400, cors); }
      }
      if (url.pathname === '/api/watchquotes' && request.method === 'GET') {
        return json(Object.assign({ ok: true }, await watchQuotes(env, url.searchParams.get('syms'))), 200, cors);
      }
      if (url.pathname === '/api/quotes' && request.method === 'GET') {
        try { return json(Object.assign({ ok: true }, await liveQuotes(env, url.searchParams.get('fast'), url.searchParams.has('us'))), 200, cors); }
        catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 400, cors); }
      }
      if (url.pathname === '/api/trade/instruments' && request.method === 'GET') {
        try { return json({ ok: true, results: await searchInstruments(env, url.searchParams.get('q')) }, 200, cors); }
        catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 400, cors); }
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
      // Meldingslogboek en wachtrij (ideeën 65, 66, 67)
      if (url.pathname === '/api/alerts' && request.method === 'GET') {
        let log = [];
        try { log = JSON.parse((await getKv(env, 'alert_log')) || '[]'); } catch (e) { log = []; }
        const q = await alertQueue(env);
        return json({ ok: true, log: log.slice(-60).reverse(), queue: q.map((x) => ({ at: x.at, title: x.title })), rules: await alertRules(env) }, 200, cors);
      }
      // Logboek van je tracker (idee 161)
      if (url.pathname === '/api/audit' && request.method === 'GET') {
        return json({ ok: true, log: (await auditList(env)).slice(-100).reverse() }, 200, cors);
      }
      // Apparaatcodes (idee 157)
      if (url.pathname === '/api/sessions' && request.method === 'GET') {
        return json({ ok: true, devices: (await sessionList(env)).map(sessionPublic), current: auth.kind === 'session' ? auth.id : null, master: auth.kind === 'master' }, 200, cors);
      }
      if (url.pathname === '/api/sessions' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const made = await newSession(env, b && b.label, b && b.days);
        return json({ ok: true, session: made.token, device: made.session }, 200, cors);
      }
      // Alles intrekken: deel-link, agenda-link en de codes van alle apparaten (ideeën 68, 157)
      if (url.pathname === '/api/revoke' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        return json(Object.assign({ ok: true }, await revokeThings(env, b)), 200, cors);
      }
      // Vergelijken met een gedeelde link van iemand anders, alleen percentages (idee 84)
      if (url.pathname === '/api/friend' && request.method === 'POST') {
        try { return json(Object.assign({ ok: true }, await friendCompare(env, await request.json().catch(() => ({})))), 200, cors); }
        catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 400, cors); }
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
        // In de spaarstand: de site ververst dan minder vaak (kop X-Tracker-Save)
        if (await saveMode(env)) jh['X-Tracker-Save'] = '1';
        // Heeft de site deze versie al (If-None-Match), dan alleen de vingerafdrukken lezen: één rij in plaats van vier
        const inm = request.headers.get('If-None-Match');
        if (inm && (part === 'core' || part === 'extra') && !url.searchParams.has('fresh')) {
          let t0 = {};
          try { t0 = JSON.parse((await getKv(env, 'data_etags')) || '{}'); } catch (e) { t0 = {}; }
          const split0 = url.searchParams.get('split') === '1';
          const tag0 = part === 'core' && !split0 ? (t0.core && t0.series ? '"' + t0.core.slice(1, 13) + t0.series.slice(1, 13) + '"' : null) : t0[part];
          if (tag0 && inm === tag0) return new Response(null, { status: 304, headers: { ...jh, ETag: tag0 } });
        }
        let core = await getBig(env, 'data_core'), extra = await getBig(env, 'data_extra');
        if (!core || !extra || url.searchParams.has('fresh')) {
          await saveDataCache(env, await buildData(env));
          core = await getBig(env, 'data_core'); extra = await getBig(env, 'data_extra');
        }
        // De volledige reeksen alleen voor wie ze vraagt (nieuw apparaat, oude versie van de site)
        const split = url.searchParams.get('split') === '1';
        const sf = part === 'series' || (part !== 'extra' && part !== 'research' && !split) ? await seriesFull(env) : null;
        const series = sf ? sf.body : '';
        const glue = (a, b) => a.slice(0, -1) + ',' + b.slice(1);
        // De site vanaf versie 38 vraagt core zonder reeksen (split=1); oudere versies krijgen core met reeksen
        // Eén aandeel uit het onderzoek (koersdoelen, profiel, cijfers), voor een bedrijfspagina:
        // veel kleiner dan het hele 'extra'-deel ophalen.
        if (part === 'research') {
          const tk = String(url.searchParams.get('tk') || '').toUpperCase();
          if (!/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(tk)) return json({ ok: false, error: 'Geef een ticker mee (?part=research&tk=…).' }, 400, cors);
          let tags0 = {};
          try { tags0 = JSON.parse((await getKv(env, 'data_etags')) || '{}'); } catch (e) { tags0 = {}; }
          const tag = tags0.extra ? '"rs-' + tk + '-' + String(tags0.extra).replace(/"/g, '') + '"' : null;
          const h = { ...jh, ...(tag ? { ETag: tag } : {}) };
          if (tag && request.headers.get('If-None-Match') === tag) return new Response(null, { status: 304, headers: h });
          let ex = {};
          try { ex = JSON.parse(extra || '{}'); } catch (e) { ex = {}; }
          const body = { ok: true, part: 'research', tk, research: (ex.research || {})[tk] || null, fin: (ex.fin || {})[tk] || null };
          return new Response(JSON.stringify(body), { status: 200, headers: h });
        }
        if (part === 'core' || part === 'extra' || part === 'series') {
          let tags = {};
          try { tags = JSON.parse((await getKv(env, 'data_etags')) || '{}'); } catch (e) { tags = {}; }
          if (sf) tags.series = sf.tag;
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
export default WORKER;


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
CREATE INDEX IF NOT EXISTS idx_intraday_ts ON intraday (ts);
CREATE INDEX IF NOT EXISTS idx_hours_hour ON hours (hour);
CREATE INDEX IF NOT EXISTS idx_days_day ON days (day);
`;
// Indexen die later zijn bijgekomen: ook in een bestaande database aanmaken (één keer, onthouden in kv)
const INDEX_VERSION = '2';
const LATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_intraday_ts ON intraday (ts)',
  'CREATE INDEX IF NOT EXISTS idx_hours_hour ON hours (hour)',
  'CREATE INDEX IF NOT EXISTS idx_days_day ON days (day)',
];
let schemaOk = false;

async function ensureSchema(env) {
  if (schemaOk) return;
  let exists = false;
  try { await env.DB.prepare('SELECT 1 FROM kv LIMIT 1').first(); exists = true; } catch (e) { /* nog geen tabellen */ }
  if (!exists) {
    const stmts = SCHEMA_SQL.split(';').map((x) => x.replace(/--[^\n]*/g, '').trim()).filter(Boolean);
    await env.DB.batch(stmts.map((x) => env.DB.prepare(x)));
  }
  await ensureIndexes(env);
  schemaOk = true;
}
async function ensureIndexes(env) {
  try {
    if ((await getKv(env, 'index_v')) === INDEX_VERSION) return;
    const stmts = LATE_INDEXES.slice();
    if ((await getKv(env, 'market_schema')) === '1') stmts.push('CREATE INDEX IF NOT EXISTS idx_ext_prices_day ON ext_prices (day)');
    await env.DB.batch(stmts.map((x) => env.DB.prepare(x)));
    await setKv(env, 'index_v', INDEX_VERSION);
  } catch (e) { console.error('indexen', e); /* volgende keer opnieuw (bijvoorbeeld als de daglimiet bereikt is) */ }
}

// Sleutels die via de website zijn ingevuld; een geheim bij Cloudflare gaat altijd voor
const KEY_NAMES = ['T212_KEY', 'T212_SECRET', 'FMP_KEY', 'FINNHUB_KEY', 'SEC_CONTACT', 'FRED_KEY', 'ALPHAVANTAGE_KEY', 'RESEND_KEY', 'MAIL_TO', 'MAIL_FROM', 'TWELVEDATA_KEY',
  'TIINGO_KEY', 'POLYGON_KEY', 'MARKETAUX_KEY', 'OPENFIGI_KEY'];

async function withKeys(env) {
  let stored = {};
  try { stored = JSON.parse((await getKv(env, 'keys')) || '{}'); } catch (e) { stored = {}; }
  const e = Object.create(env);
  // Een sleutel die via de site is opgeslagen gaat voor een geheim bij Cloudflare (zo kun je hem vervangen
  // zonder het Cloudflare-dashboard); wis je hem op de site, dan geldt het geheim weer
  KEY_NAMES.forEach((k) => { if (stored[k]) e[k] = stored[k]; });
  return e;
}

async function saveKey(env, name, value) {
  if (!KEY_NAMES.includes(name)) throw new Error('Onbekende sleutel.');
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length > 300) throw new Error('Deze waarde is te lang.');
  if (name === 'SEC_CONTACT' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('Vul een e-mailadres in; de SEC vraagt dat als contact.');
  let stored = {};
  try { stored = JSON.parse((await getKv(env, 'keys')) || '{}'); } catch (e) { stored = {}; }
  if (v) stored[name] = v; else delete stored[name];
  await setKv(env, 'keys', JSON.stringify(stored));
  await auditLog(env, 'sleutel', (v ? 'ingevuld of vervangen: ' : 'gewist: ') + name);
  // Nieuwe sleutel: de externe gegevens van vandaag opnieuw plannen
  await setKv(env, 'mkt_planned', '');
}

// weeklyMail staat standaard uit: het weekoverzicht per e-mail is optioneel
const FEATURE_DEFAULTS = { fx: true, inflation: true, sec: true, etfAuto: true, indices: true, weeklyMail: false, trading: false, openfigi: true, gdelt: true };
async function featureFlags(env) {
  const s = await getSettings(env);
  return Object.assign({}, FEATURE_DEFAULTS, (s && s.features) || {});
}

async function featureStatus(env, raw) {
  const f = await featureFlags(env);
  let stored = {};
  try { stored = JSON.parse((await getKv(env, 'keys')) || '{}'); } catch (e) { stored = {}; }
  const where = (k) => (stored[k] ? (raw[k] ? 'override' : 'site') : raw[k] ? 'cloudflare' : null);
  const errs = JSON.parse((await getKv(env, 'ext_errors')) || '{}');
  return {
    keys: Object.fromEntries(KEY_NAMES.map((k) => [k, where(k)])),
    flags: f,
    lastCron: await getKv(env, 'last_cron'),
    lastError: await getKv(env, 'last_error'),
    errors: errs,
    health: await srcState(env),
    budgets: await budgetInfo(env).catch(() => null),
  };
}

// ---------- Bronstatus: na herhaalde fouten of een limiet tijdelijk naar een reservebron ----------
// kv 'src_health' = { bron: { fails, until (ms), msg, at, backup, backupAt } }
// kv 'src_hist'   = { bron: { days: { 'JJJJ-MM-DD': [in orde, limiet, fout] }, lastOk, lastLimit: {at,msg}, lastErr: {at,msg} } }
const SRC_HIST_DAYS = 30;
// Oplopende pauze per bron (idee 147): de eerste fout nog niet, daarna 15 minuten, 1 uur, 4 uur, 12 uur en
// ten hoogste 24 uur. Een geweigerde bron wordt dus nooit in een lus opnieuw gevraagd.
const SRC_BACKOFF_MIN = [15, 60, 240, 720, 1440];
function srcPause(fails) {
  if (!(fails >= 2)) return 0;
  return SRC_BACKOFF_MIN[Math.min(fails - 2, SRC_BACKOFF_MIN.length - 1)] * 60e3;
}
async function srcState(env) { try { return JSON.parse((await getKv(env, 'src_health')) || '{}'); } catch (e) { return {}; } }
async function srcDown(env, src) { const o = (await srcState(env))[src]; return !!(o && o.until && o.until > Date.now()); }
async function srcHistState(env) { try { return JSON.parse((await getKv(env, 'src_hist')) || '{}'); } catch (e) { return {}; } }
// Een goede dag wordt per bron één keer per aanroep van de Worker vastgelegd: de statuspagina toont
// dagen in orde, geen aantallen, en zo kost het hoogstens één schrijfactie per bron.
const SRC_OK_SEEN = new Set();
async function srcNote(env, src, kind, msg) {
  const day = parts(new Date()).day;
  if (kind === 'ok') {
    if (SRC_OK_SEEN.has(src + '|' + day)) return;
    SRC_OK_SEEN.add(src + '|' + day);
  }
  const st = await srcHistState(env);
  const o = st[src] || { days: {} };
  o.days = o.days || {};
  const d = o.days[day] || [0, 0, 0];
  d[kind === 'ok' ? 0 : kind === 'limit' ? 1 : 2]++;
  o.days[day] = d;
  const at = isoLocal(Date.now());
  const text = String(msg || '').slice(0, 160);
  if (kind === 'ok') o.lastOk = at;
  else if (kind === 'limit') o.lastLimit = { at, msg: text };
  else o.lastErr = { at, msg: text };
  Object.keys(o.days).sort().slice(0, -SRC_HIST_DAYS).forEach((k) => { delete o.days[k]; });
  st[src] = o;
  await setKv(env, 'src_hist', JSON.stringify(st));
}
// Bronnen met een limiet per minuut: na een limiet even wachten, niet de hele dag
const MINUTE_LIMIT_PAUSE = { finnhub: 10 * 60e3, fred: 10 * 60e3, sec: 5 * 60e3, polygon: 10 * 60e3, openfigi: 10 * 60e3, gdelt: 10 * 60e3 };
const MINUTE_LIMIT_DAY_AFTER = 3;
// Een daglimiet: tot net na middernacht (UTC) uit; een minuutlimiet: kort (na drie keer op rij ook tot middernacht);
// andere fouten: een oplopende pauze
async function srcFail(env, src, msg, limit) {
  const st = await srcState(env);
  const o = st[src] || { fails: 0 };
  o.fails = (o.fails || 0) + 1; o.msg = String(msg || '').slice(0, 160); o.at = isoLocal(Date.now());
  if (limit && MINUTE_LIMIT_PAUSE[src] && o.fails < MINUTE_LIMIT_DAY_AFTER) { o.until = Date.now() + MINUTE_LIMIT_PAUSE[src]; o.minute = true; }
  else if (limit) { const d = new Date(); d.setUTCHours(24, 5, 0, 0); o.until = d.getTime(); o.minute = false; }
  else { const pause = srcPause(o.fails); if (pause) o.until = Date.now() + pause; }
  o.next = o.until ? isoLocal(o.until) : null;
  st[src] = o;
  await setKv(env, 'src_health', JSON.stringify(st));
  await srcNote(env, src, limit ? 'limit' : 'err', msg);
}
async function srcOk(env, src) {
  await srcNote(env, src, 'ok');
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
    'Access-Control-Expose-Headers': 'ETag, X-Tracker-Save',
    'Vary': 'Origin',
  };
}

// ---------- Opgebouwde gegevens bewaren (in twee delen, met een vingerafdruk per deel) ----------
// 'core' haalt de site elke paar minuten op, 'extra' alleen als het veranderde (ETag, anders 304).
// Alles wat hoogstens een keer per dag verandert hoort daarom in 'extra': events (1x per dag),
// orders (alleen bij een aankoop of verkoop) en peil (1x per jaar, voor box 3).
const EXTRA_KEYS = ['market', 'research', 'fin', 'idx', 'hicp', 'fx', 'marketNews', 'etf', 'ext2', 'events', 'orders', 'peil'];

async function sha256Hex(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Het overzicht bewaren in twee delen (core en extra). De reeksen staan apart (seriesFull) en worden niet bij elke
// opbouw opnieuw geschreven; hun vingerafdruk blijft staan. De deel-link wordt pas opgebouwd als iemand hem opent.
async function saveDataCache(env, data) {
  const core = {}, extra = { ok: true, part: 'extra' };
  Object.keys(data).forEach((k) => { if (EXTRA_KEYS.includes(k)) extra[k] = data[k]; else if (!SERIES_KEYS.includes(k)) core[k] = data[k]; });
  core.part = 'core';
  const cs = JSON.stringify(core), es = JSON.stringify(extra);
  // generated verandert bij elke opbouw; zonder dat veld is de vingerafdruk alleen anders als de inhoud anders is
  const tagOf = async (o) => '"' + (await sha256Hex(JSON.stringify(Object.assign({}, o, { generated: null })))).slice(0, 24) + '"';
  let old = {};
  try { old = JSON.parse((await getKv(env, 'data_etags')) || '{}'); } catch (e) { old = {}; }
  await env.DB.batch([
    ...bigStmts(env, 'data_core', cs),
    ...bigStmts(env, 'data_extra', es),
    env.DB.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').bind('data_etags', JSON.stringify({ core: await tagOf(core), extra: await tagOf(extra), series: old.series || null, seriesStamp: old.seriesStamp || '', at: Date.now() })),
    env.DB.prepare('DELETE FROM kv WHERE key = ?').bind('data_cache'),
  ]);
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
    await auditLog(envIn, 'inloggen', 'mislukte poging met een Trading 212-sleutel (' + (fails + 1) + 'e deze keer)');
    return json({ ok: false, error: 'Deze sleutel en secret horen niet bij deze Worker. Controleer ze, en het adres van de Worker.' }, 401, cors);
  }
  await auditLog(envIn, 'inloggen', 'ingelogd met de Trading 212-sleutel');
  // Dit apparaat krijgt zijn eigen code, zodat de toegangscode zelf niet in de browser hoeft (idee 157).
  // Oudere versies van de site gebruiken 'token'; die blijft werken.
  // Oudere versies van de site lezen 'token'; ook daar staat de code van dit apparaat, nooit de toegangscode zelf.
  // Anders kon iemand met alleen een apparaatcode via een eigen Trading 212-sleutel (Koppelingen) de vaste
  // toegangscode ophalen, die Alles intrekken niet ongeldig maakt.
  let device = null;
  try { device = await newSession(envIn, (body && body.label) || 'Nieuw apparaat', (body && body.days) || 0); } catch (e) { console.error('apparaatcode', e); }
  if (!device) return json({ ok: false, error: 'De sleutel klopt, maar dit apparaat kon geen eigen code krijgen. Probeer het opnieuw.' }, 500, cors);
  return json({ ok: true, token: device.token, session: device.token, device: device.session, features: await featureStatus(env, envIn) }, 200, cors);
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

// De meegestuurde code: bij voorkeur in de Authorization-kop, ?token= blijft voor oude clients
function givenToken(request, url) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : (url.searchParams.get('token') || '');
}

function authorized(request, url, env) {
  const want = env.WEB_TOKEN || '';
  if (!want) return false;
  const given = givenToken(request, url);
  if (given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// Toegang: de toegangscode (WEB_TOKEN, geheim bij Cloudflare) of een apparaatcode die via de site is
// gemaakt. Van een apparaatcode bewaart de Worker alleen de SHA-256, dus de code zelf staat nergens.
async function authCheck(request, url, envIn) {
  if (authorized(request, url, envIn)) return { ok: true, kind: 'master' };
  const given = givenToken(request, url);
  if (given.length < 20 || given.length > 120) return { ok: false };
  try {
    await ensureSchema(envIn);
    const list = await sessionList(envIn);
    if (!list.length) return { ok: false };
    const hash = await sha256Hex(given);
    const i = list.findIndex((x) => x && typeof x.hash === 'string' && safeEqual(x.hash, hash));
    if (i < 0) return { ok: false };
    const s = list[i];
    const now = Date.now();
    if (s.until && Date.parse(s.until) < now) {
      list.splice(i, 1);
      await setKv(envIn, 'sessions', JSON.stringify(list));
      return { ok: false, error: 'De code van dit apparaat is verlopen. Log opnieuw in.' };
    }
    // Laatst gezien hoogstens één keer per uur wegschrijven
    if (!s.seen || now - Date.parse(s.seen) > HOUR_MS) { s.seen = isoLocal(now); await setKv(envIn, 'sessions', JSON.stringify(list)); }
    return { ok: true, kind: 'session', id: s.id };
  } catch (e) { return { ok: false }; }
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

// ---------- Handelsdag (idee 154) ----------
// Eén plek die bepaalt bij welke dag een tijdstip hoort. dayOf geeft de Amsterdamse kalenderdag
// (zomer- en wintertijd komen uit de tijdzone zelf, niet uit een eigen berekening); tradingDay geeft
// de handelsdag: in het weekend de vrijdag ervoor. De site rekent met dezelfde regels (js/15-bronnen.js).
function shiftDay(day, n) {
  const d = new Date(String(day).slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(day) {
  const n = new Date(String(day).slice(0, 10) + 'T12:00:00Z').getUTCDay();
  return n === 0 ? 7 : n;
}
function tradingDay(ms) {
  const day = dayOf(ms);
  const wd = weekdayOf(day);
  return wd <= 5 ? day : shiftDay(day, wd === 6 ? -1 : -2);
}
// Laatste afgesloten Amerikaanse handelsdag: voor 22:30 Amsterdamse tijd is de beurs van vandaag nog open
function usTradingDay(ms) {
  const p = parts(new Date(ms));
  let day = p.hm < '22:30' ? shiftDay(p.day, -1) : p.day;
  while (weekdayOf(day) > 5) day = shiftDay(day, -1);
  return day;
}

function isLive(d) {
  return LIVE_WEEKDAYS.includes(parts(d).weekday);
}
function marketHours(d) {
  const p = parts(d);
  return isLive(d) && p.hm >= MARKET_START && p.hm <= MARKET_END;
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
    let prevExtra = {};
    try { prevExtra = JSON.parse((await getKv(env, 'pos_extra')) || '{}'); } catch (e) { prevExtra = {}; }
    // Splitsingen en nieuwe tickers (idee 149): eerst de geschiedenis bijwerken, daarna de controle
    let acts = { splits: [], renames: [] };
    try { acts = await corporateActions(env, positions, prevExtra); } catch (e) { console.error('splitsing', e); }
    if (acts.renames.length) prevExtra = renamedExtra(prevExtra, acts.renames);
    if (acts.splits.length) prevExtra = splitExtra(prevExtra, acts.splits);
    const actText = actionsText(acts);
    if (actText) msgs.push(actText);
    const measured = positions.map((p) => ({
      ticker: shortTicker(p.instrument.ticker), name: p.instrument.name,
      value: r2(num(p.walletImpact.currentValue)), unrealized: r2(num(p.walletImpact.unrealizedProfitLoss)),
      price: num(p.currentPrice), qty: num(p.quantity),
    }));
    // Onmogelijke waarden weigeren en vastleggen (idee 148)
    const chk = checkPositions(measured, prevExtra);
    if (chk.bad.length) { await logRejects(env, chk.bad); msgs.push(chk.bad.length + ' afwijkende waarde(n) tegengehouden.'); }
    const rows = chk.rows;
    if (!rows.length && positions.length) {
      msgs.push('Geen bruikbare koersen ontvangen; deze meting is overgeslagen.');
    } else {
      const total = rows.reduce((s, r) => s + r.value, 0);
      const totalUnreal = rows.reduce((s, r) => s + r.unrealized, 0);
      // Geen dubbele metingen (idee 45): een positie die sinds de vorige meting niet veranderde, krijgt geen nieuwe regel.
      // De totaalregel komt er altijd, en alle posities bij de eerste meting van elk uur en als er een positie bij komt
      // of verdwijnt. Zo heeft elk uur per positie minstens één regel (uur- en dagregels hoeven niets door te zetten) en
      // staat elke positie in het uur van de laatste meting (lastRows). De totaalregel bewaart in price het aantal
      // posities, zodat todayState een volledige meting herkent; die kolom wordt verder nergens gebruikt.
      let measLast = null;
      try { measLast = JSON.parse((await getKv(env, 'meas_last')) || 'null'); } catch (e) { measLast = null; }
      const hr = hourStart(ts), sig = (r) => [r.value, r.unrealized, r.price, r.qty].join('|');
      const sNext = Object.fromEntries(rows.map((r) => [r.ticker, sig(r)]));
      const sameSet = !!(measLast && measLast.h === hr && measLast.s && Object.keys(measLast.s).length === rows.length && rows.every((r) => r.ticker in measLast.s));
      const toWrite = sameSet ? rows.filter((r) => measLast.s[r.ticker] !== sNext[r.ticker]) : rows.slice();
      const nPos = rows.length;
      rows.push({ ticker: TOTAL, name: 'Totaal beleggingen', value: r2(total), unrealized: r2(totalUnreal), price: null, qty: null });
      const stmt = env.DB.prepare('INSERT OR REPLACE INTO intraday (ts, ticker, name, value, unrealized, price, qty) VALUES (?,?,?,?,?,?,?)');
      await env.DB.batch(toWrite.map((r) => stmt.bind(ts, r.ticker, r.name, r.value, r.unrealized, r.price, r.qty))
        .concat([stmt.bind(ts, TOTAL, 'Totaal beleggingen', r2(total), r2(totalUnreal), nPos, null)]));
      if (!sameSet || toWrite.length) await setKv(env, 'meas_last', JSON.stringify({ h: hr, s: sNext }));
      // Een geweigerde positie houdt zijn vorige gegevens, zodat een foute koers geen nieuwe maatstaf wordt
      const extra = posExtra(positions);
      chk.bad.forEach((b) => { if (prevExtra[b.ticker]) extra[b.ticker] = prevExtra[b.ticker]; else delete extra[b.ticker]; });
      await setKv(env, 'pos_extra', JSON.stringify(extra));
      msgs.push(`${rows.length - 1} posities gemeten (totaal €${total.toFixed(2)}).`);
      // Vrij saldo bij elke meting (anders alleen in de weeksnapshot, en dan klopt de accountwaarde niet na een aankoop)
      try {
        const sum = await t212(env, '/api/v0/equity/account/summary');
        const cash = num(sum.cash && sum.cash.availableToTrade) + num(sum.cash && sum.cash.inPies) + num(sum.cash && sum.cash.reservedForOrders);
        // Geld dat stilstaat (idee 6): sinds wanneer staat er minstens CASH_IDLE_MIN vrij, en wat was de laagste stand
        // sindsdien (dat bedrag stond de hele tijd stil). Gaat mee in dezelfde kv-regel, dus geen extra schrijfactie.
        const prevCash = await cashNowOf(env), c = r2(cash);
        const was = prevCash && prevCash.idle && prevCash.idle.since ? prevCash.idle : null;
        const idle = c >= CASH_IDLE_MIN ? (was ? { since: was.since, low: Math.min(Number(was.low) || c, c) } : { since: isoLocal(ts), low: c }) : null;
        await setKv(env, 'cash_now', JSON.stringify(Object.assign({ cash: c, at: isoLocal(ts) }, idle ? { idle } : {})));
      } catch (e) { console.error('saldo', e); }
      try { const m = await alertMoves(env, rows, now); if (m) msgs.push(m); } catch (e) { console.error('meldingen', e); }
      try { const m = await checkPriceAlerts(env, rows, now); if (m) msgs.push(m); } catch (e) { console.error('koersalarm', e); }
      try { const m = await depositReminder(env, now); if (m) msgs.push(m); } catch (e) { console.error('inleg', e); }
    }
  }

  const p = parts(now);
  // Peildatum 1 januari (vermogen voor de belastingaangifte): één keer op nieuwjaarsdag
  if (p.day.endsWith('-01-01')) {
    const year = p.day.slice(0, 4);
    if (!(await getKv(env, 'peil_' + year))) msgs.push(await takePeildatum(env, year));
  }
  try { const m = await flushAlerts(env, now); if (m) msgs.push(m); } catch (e) { console.error('wachtrij', e); }

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
  if (text && (await buildAllowed(env, now))) await saveDataCache(env, await buildData(env));
  return text;
}
// Mag het overzicht nu opnieuw worden opgebouwd? Altijd, behalve in de spaarstand: dan hoogstens eens per half uur.
async function buildAllowed(env, now) {
  if (!(await saveMode(env))) return true;
  let at = 0;
  try { at = Number(JSON.parse((await getKv(env, 'data_etags')) || '{}').at) || 0; } catch (e) { at = 0; }
  return (now ? new Date(now).getTime() : Date.now()) - at >= SAVE_BUILD_MS;
}

// Extra per positie: gemiddelde aankoopprijs, valuta en valuta-effect (fxImpact) van Trading 212
function posExtra(positions) {
  const out = {};
  positions.forEach((p) => {
    out[shortTicker(p.instrument.ticker)] = {
      avg: numOrNull(p.averagePricePaid), price: numOrNull(p.currentPrice), qty: numOrNull(p.quantity), cur: p.instrument.currency || null,
      fx: numOrNull(p.walletImpact && p.walletImpact.fxImpact), cost: numOrNull(p.walletImpact && p.walletImpact.totalCost),
      isin: p.instrument.isin || null, since: p.createdAt || null, t212: p.instrument.ticker || null,
    };
  });
  return out;
}

// ---------- Controle op onmogelijke waarden (idee 148) ----------
// Een koers van 0, een negatief aantal of een koerssprong van meer dan 80% zonder splitsing is bijna
// altijd een fout van de bron. Zulke regels gaan niet de database in; ze komen in kv 'data_rejects'
// en op de bronnenpagina te staan. De vorige waarde blijft dan staan.
const MAX_JUMP = 0.8;
function checkPositions(rows, prev) {
  const bad = [], ok = [];
  const note = (r, why, kept) => bad.push({ ticker: r.ticker, name: r.name || '', why, kept: !!kept });
  rows.forEach((r) => {
    const p = prev && prev[r.ticker];
    const pp = p ? numOrNull(p.price) : null;
    if (!(r.qty >= 0) || !(r.value >= 0)) { note(r, 'aantal ' + r.qty + ' en waarde ' + r.value + ' kunnen niet'); return; }
    if (r.price > 0 && pp > 0 && Math.abs(r.price / pp - 1) > MAX_JUMP) {
      note(r, 'koerssprong van ' + pp + ' naar ' + r.price + ' (' + Math.round((r.price / pp - 1) * 100) + '%) zonder splitsing');
      return;
    }
    // Alleen de koers ontbreekt: de waarde in euro's is er wel, die bewaren we (zonder koers)
    if (!(r.price > 0)) { note(r, 'koers ' + (r.price == null ? 'ontbreekt' : r.price) + '; alleen de waarde is bewaard', true); ok.push(Object.assign({}, r, { price: null })); return; }
    ok.push(r);
  });
  return { rows: ok, bad };
}
const REJECT_KEEP = 40;
async function logRejects(env, bad) {
  let list = [];
  try { list = JSON.parse((await getKv(env, 'data_rejects')) || '[]'); } catch (e) { list = []; }
  const at = isoLocal(Date.now());
  bad.forEach((b) => list.push({ at, ticker: b.ticker, name: String(b.name || '').slice(0, 60), why: String(b.why).slice(0, 160), kept: !!b.kept }));
  await setKv(env, 'data_rejects', JSON.stringify(list.slice(-REJECT_KEEP)));
  return list.length;
}

// ---------- Splitsingen en nieuwe tickers (idee 149) ----------
// Splitsing: het aantal stukken verandert terwijl de koers omgekeerd meebeweegt (2:1 -> twee keer zo veel
// stukken voor de halve koers). Bij een aankoop blijft de koers gelijk, dus die wordt niet als splitsing gezien.
const SPLIT_TOL = 0.2;
function splitRatio(prevQty, prevPrice, qty, price) {
  if (!(prevQty > 0 && qty > 0 && prevPrice > 0 && price > 0)) return null;
  const q = qty / prevQty;
  if (Math.abs(q - 1) < 0.02) return null;
  const inv = prevPrice / price;
  if (Math.abs(inv / q - 1) > SPLIT_TOL) return null;
  // Op een ronde verhouding afronden (2:1, 3:1, 1:10); past die niet, dan is het geen splitsing
  const r = q >= 1 ? Math.round(q * 20) / 20 : 1 / (Math.round((1 / q) * 20) / 20);
  if (!(r > 0) || Math.abs(r / q - 1) > 0.05) return null;
  return r;
}
// Koersen in de geschiedenis door de verhouding delen en de aantallen ermee vermenigvuldigen,
// zodat grafieken doorlopen. De waarde in euro's verandert niet door een splitsing.
async function applySplit(env, ticker, ratio) {
  await invalidateSeries(env);
  await env.DB.batch([
    env.DB.prepare('UPDATE intraday SET price = price / ?, qty = qty * ? WHERE ticker = ? AND price IS NOT NULL').bind(ratio, ratio, ticker),
    env.DB.prepare('UPDATE hours SET close_price = close_price / ? WHERE ticker = ? AND close_price IS NOT NULL').bind(ratio, ticker),
    env.DB.prepare('UPDATE days SET close_price = close_price / ? WHERE ticker = ? AND close_price IS NOT NULL').bind(ratio, ticker),
    env.DB.prepare('UPDATE positions SET qty = qty * ? WHERE ticker = ?').bind(ratio, ticker),
  ]);
  await bumpMarket(env, [SYMBOL_MAP[ticker] || ticker]);
  try { await env.DB.prepare('UPDATE ext_prices SET price = price / ? WHERE symbol = ?').bind(ratio, SYMBOL_MAP[ticker] || ticker).run(); } catch (e) { /* tabel bestaat nog niet */ }
}
// Naamswijziging: hetzelfde ISIN onder een nieuwe ticker, terwijl de oude ticker weg is
async function renameTicker(env, from, to) {
  await invalidateSeries(env);
  const u = (sql) => env.DB.prepare(sql).bind(to, from);
  await env.DB.batch([
    u('UPDATE OR REPLACE intraday SET ticker = ? WHERE ticker = ?'),
    u('UPDATE OR REPLACE hours SET ticker = ? WHERE ticker = ?'),
    u('UPDATE OR REPLACE days SET ticker = ? WHERE ticker = ?'),
    u('UPDATE OR REPLACE positions SET ticker = ? WHERE ticker = ?'),
  ]);
  try { await u('UPDATE OR REPLACE orders SET ticker = ? WHERE ticker = ?').run(); await invalidateOrders(env); } catch (e) { /* geen orders */ }
  try { await u('UPDATE OR REPLACE news_hist SET tk = ? WHERE tk = ?').run(); } catch (e) { /* geen nieuwsarchief */ }
  // Onderzoek, cijfers en waardering mee verhuizen
  for (const pre of ['rs_', 'fin_', 'val_']) {
    const v = await getKv(env, pre + from);
    if (v == null) continue;
    await setKv(env, pre + to, v);
    await env.DB.prepare('DELETE FROM kv WHERE key = ?').bind(pre + from).run();
  }
  let map = {};
  try { map = JSON.parse((await getKv(env, 'ticker_map')) || '{}'); } catch (e) { map = {}; }
  map[from] = { to, at: isoLocal(Date.now()) };
  await setKv(env, 'ticker_map', JSON.stringify(map));
}
const ACTION_KEEP = 20;
// Eén keer uitvoeren: elke splitsing en naamswijziging staat met dag en verhouding in kv 'corp_actions',
// dus een tweede meting met dezelfde gegevens past niets opnieuw aan (idee 155).
async function corporateActions(env, positions, prevExtra) {
  const out = { splits: [], renames: [] };
  let log = [];
  try { log = JSON.parse((await getKv(env, 'corp_actions')) || '[]'); } catch (e) { log = []; }
  const seen = (k) => log.some((x) => x.key === k);
  const day = parts(new Date()).day;
  const now = positions.map((p) => ({ tk: shortTicker(p.instrument.ticker), isin: p.instrument.isin || null, qty: num(p.quantity), price: num(p.currentPrice) }));
  const nowSet = new Set(now.map((x) => x.tk));
  // 1. Naamswijzigingen
  const byIsin = new Map();
  Object.entries(prevExtra || {}).forEach(([tk, o]) => { if (o && o.isin) byIsin.set(o.isin, tk); });
  for (const x of now) {
    if (!x.isin) continue;
    const old = byIsin.get(x.isin);
    if (!old || old === x.tk || nowSet.has(old)) continue;
    const key = 'naam|' + old + '|' + x.tk;
    if (seen(key)) continue;
    await renameTicker(env, old, x.tk);
    out.renames.push({ from: old, to: x.tk, isin: x.isin });
    log.push({ key, kind: 'naam', from: old, to: x.tk, day, at: isoLocal(Date.now()) });
  }
  // 2. Splitsingen
  for (const x of now) {
    const was = (prevExtra || {})[x.tk] || (out.renames.find((r) => r.to === x.tk) ? (prevExtra || {})[out.renames.find((r) => r.to === x.tk).from] : null);
    if (!was) continue;
    const ratio = splitRatio(numOrNull(was.qty), numOrNull(was.price), x.qty, x.price);
    if (!ratio) continue;
    const key = 'split|' + x.tk + '|' + day + '|' + ratio;
    if (seen(key)) continue;
    await applySplit(env, x.tk, ratio);
    out.splits.push({ ticker: x.tk, ratio });
    log.push({ key, kind: 'split', ticker: x.tk, ratio, day, at: isoLocal(Date.now()) });
  }
  if (out.splits.length || out.renames.length) await setKv(env, 'corp_actions', JSON.stringify(log.slice(-ACTION_KEEP)));
  return out;
}
function renamedExtra(prev, renames) {
  const out = Object.assign({}, prev);
  renames.forEach((r) => { if (out[r.from]) { out[r.to] = out[r.from]; delete out[r.from]; } });
  return out;
}
function splitExtra(prev, splits) {
  const out = Object.assign({}, prev);
  splits.forEach((s) => {
    const o = out[s.ticker];
    if (!o) return;
    out[s.ticker] = Object.assign({}, o, {
      price: numOrNull(o.price) != null ? numOrNull(o.price) / s.ratio : o.price,
      avg: numOrNull(o.avg) != null ? numOrNull(o.avg) / s.ratio : o.avg,
      qty: numOrNull(o.qty) != null ? numOrNull(o.qty) * s.ratio : o.qty,
    });
  });
  return out;
}
function actionsText(acts) {
  const out = [];
  acts.splits.forEach((s) => out.push('Splitsing ' + s.ticker + ' ' + (s.ratio >= 1 ? s.ratio + ':1' : '1:' + Math.round(1 / s.ratio)) + ' verwerkt in de geschiedenis.'));
  acts.renames.forEach((r) => out.push('Ticker ' + r.from + ' heet nu ' + r.to + '; de geschiedenis is meeverhuisd.'));
  return out.join(' ');
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
      r2(v.reduce((s, x) => s + x, 0) / v.length), v.length, last.ticker === TOTAL ? null : last.price));
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
    if (changes) await invalidateRecent(env);
    if (changes) msgs.push(changes + ' oude metingen verwijderd.');
  }
  return msgs.join(' ');
}

// Eén keer per maand: oude uurregels, koersen van vergelijkbare bedrijven en sectordagen opruimen.
// Dagregels, weken, posities en orders blijven altijd bewaard (daar draaien grafieken en jaaroverzichten op).
// Na 3 dagen worden metingen per 10 minuten uren; uren blijven 180 dagen, daarna alleen de dagregels
// Uren worden elke dag samengevat in de dagtabel en de site gebruikt ze alleen voor de laatste 31 dagen;
// de koershistorie leest marketData tot 380 dagen terug. Kleinere tabellen = minder gelezen rijen (D1-daglimiet).
const KEEP_HOURS_DAYS = 60, KEEP_EXT_DAYS = 390;
async function cleanupOld(env, now) {
  // Elke dag (was: elke maand): met de indexen op hour en day leest het verwijderen alleen de rijen die weg moeten
  const today = parts(now).day;
  if ((await getKv(env, 'cleanup_day')) === today) return '';
  const day = (n) => new Date(now.getTime() - n * 864e5).toISOString().slice(0, 10);
  const out = [];
  const run = async (sql, arg, what) => { try { const r = await env.DB.prepare(sql).bind(arg).run(); const n = r.meta && r.meta.changes; if (n) out.push(n + ' ' + what); } catch (e) { /* tabel bestaat (nog) niet */ } };
  await run('DELETE FROM hours WHERE hour < ?', now.getTime() - KEEP_HOURS_DAYS * 864e5, 'uurregels');
  await invalidateRecent(env);
  await run('DELETE FROM ext_prices WHERE day < ?', day(KEEP_EXT_DAYS), 'koersen');
  await bumpMarket(env, []);   // de marktcache laat oude dagen zelf al weg
  await run('DELETE FROM ext_perf WHERE day < ?', day(KEEP_EXT_DAYS), 'sectordagen');
  await setKv(env, 'cleanup_day', today);
  return out.length ? 'Opgeruimd: ' + out.join(', ') + '.' : '';
}

async function batchChunks(env, stmts) {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

// Laatst gemeten vrij saldo (bij elke meting bijgewerkt), met idle: sinds wanneer het minstens CASH_IDLE_MIN is
const CASH_IDLE_MIN = 100;
async function cashNowOf(env) {
  try { const c = JSON.parse((await getKv(env, 'cash_now')) || 'null'); return c && isFinite(Number(c.cash)) ? c : null; } catch (e) { return null; }
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

// Voorwaardelijk ophalen: met de ETag en Last-Modified van de vorige keer antwoordt een bron 304 als er niets veranderde.
// Alleen bij bronnen die ze meesturen (ECB, iShares); de SEC en de dagelijkse Frankfurter-reeks (adres verandert elke dag) niet.
function condHeaders(prev, h = {}) {
  if (prev && prev.etag) h['If-None-Match'] = prev.etag;
  if (prev && prev.lm) h['If-Modified-Since'] = prev.lm;
  return h;
}
const condOf = (res) => ({ etag: res.headers.get('ETag') || null, lm: res.headers.get('Last-Modified') || null });

// Sessies en sleutels leest elk verzoek (live koersen elke paar seconden): 30 seconden in het geheugen van deze isolate.
// shortcut: een andere isolate ziet een wijziging (zoals een ingetrokken apparaat) pas na hoogstens 30 s; KV_MEMO_MS korter maken als dat te lang is.
const KV_MEMO_MS = 30e3, KV_MEMO_KEYS = new Set(['keys', 'sessions']);
let kvMemo = new WeakMap();
const kvMemoOf = (env) => { const db = env.DB.__raw || env.DB; let m = kvMemo.get(db); if (!m) kvMemo.set(db, (m = new Map())); return m; };

async function getKv(env, key) {
  const memo = KV_MEMO_KEYS.has(key) ? kvMemoOf(env) : null, hit = memo && memo.get(key);
  if (hit && Date.now() - hit.t < KV_MEMO_MS) return hit.v;
  const row = await env.DB.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first();
  const v = row ? row.value : null;
  if (memo) memo.set(key, { v, t: Date.now() });
  return v;
}

async function setKv(env, key, value) {
  await env.DB.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').bind(key, value).run();
  if (KV_MEMO_KEYS.has(key)) kvMemoOf(env).set(key, { v: value, t: Date.now() });
}
// Grote waarden (het overzicht, de deel-link, caches) in stukken opslaan: D1 staat hoogstens 2 MB per rij toe,
// en met jaren aan dagen per positie of veel gevolgde aandelen wordt één rij te groot. Een waarde van één stuk
// staat gewoon onder zijn eigen sleutel; anders staat daar een verwijzing ('~stukken:N') en volgen
// sleutel#1 … sleutel#N. 900.000 tekens per stuk blijft ook bij veel speciale tekens (tot 2 bytes) onder de grens.
// De verwijzing begon eerst met een NUL-teken; sommige SQLite-koppelingen kappen tekst daar af (de verwijzing
// wordt dan leeg), dus nu een gewoon teken. Een JSON-waarde begint nooit met '~'. De oude vorm lezen we nog.
const KV_PART = 900000;
const KV_PART_MARK = '~stukken:';
const KV_PART_MARK_OLD = '\u0000stukken:';
function bigStmts(env, key, value) {
  const v = String(value == null ? '' : value);
  const put = (k, x) => env.DB.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').bind(k, x);
  if (v.length <= KV_PART) return [put(key, v), env.DB.prepare("DELETE FROM kv WHERE key > ? AND key < ?").bind(key + '#', key + '#~')];
  const n = Math.ceil(v.length / KV_PART);
  const out = [put(key, KV_PART_MARK + n)];
  for (let i = 0; i < n; i++) out.push(put(key + '#' + (i + 1), v.slice(i * KV_PART, (i + 1) * KV_PART)));
  // Stukken van een eerdere, langere waarde opruimen (sleutel#N+1 en verder)
  out.push(env.DB.prepare("DELETE FROM kv WHERE key > ? AND key < ? AND key NOT IN (" + Array.from({ length: n }, () => '?').join(',') + ')')
    .bind(key + '#', key + '#~', ...Array.from({ length: n }, (_, i) => key + '#' + (i + 1))));
  return out;
}
async function setBig(env, key, value) { await env.DB.batch(bigStmts(env, key, value)); }
async function getBig(env, key) {
  const v = await getKv(env, key);
  const mark = v && (v.startsWith(KV_PART_MARK) ? KV_PART_MARK : v.startsWith(KV_PART_MARK_OLD) ? KV_PART_MARK_OLD : null);
  if (!mark) return v;
  const n = Number(v.slice(mark.length)) || 0;
  const keys = Array.from({ length: n }, (_, i) => key + '#' + (i + 1));
  const { results } = await env.DB.prepare('SELECT key, value FROM kv WHERE key IN (' + keys.map(() => '?').join(',') + ')').bind(...keys).all();
  const map = new Map(results.map((r) => [r.key, r.value]));
  if (keys.some((k) => !map.has(k))) return null;   // onvolledig: de lezer bouwt opnieuw op
  return keys.map((k) => map.get(k)).join('');
}

// ---------- Gegevens voor de website ----------

// ---------- Reeksen voor de opbouw, zuinig gelezen ----------
// De opbouw gebeurt elke 10 minuten, maar uren en dagen veranderen hooguit eens per uur (housekeeping) en metingen
// van vóór de vorige opbouw veranderen niet meer. Die staan daarom in een cache in kv; elke 10 minuten leest de Worker
// alleen de metingen die er sindsdien bij kwamen. Elke schrijver van intraday/hours/days roept invalidateSeries aan.
async function invalidateOrders(env) { try { await setKv(env, 'orders_ver', String(Date.now())); } catch (e) { /* niet erg */ } }
async function invalidateSeries(env) {
  try { await setKv(env, 'series_ver', String(Date.now())); await setKv(env, 'today_state', ''); } catch (e) { /* niet erg */ }
}
// Alleen metingen of uren veranderd (opruimen van oude metingen en uren): de dagen van eerdere jaren blijven geldig,
// dus alleen de cache van dit jaar opnieuw. Anders las elk uur de hele dagtabel van eerdere jaren opnieuw.
async function invalidateRecent(env) { try { await setKv(env, 'series_recent', String(Date.now())); } catch (e) { /* niet erg */ } }
// Twee caches (elk in stukken opgeslagen, zie setBig):
//  - series_cache: metingen, uren en de dagen van dit jaar; opnieuw zodra er een uur is samengevat (eens per uur);
//  - series_old: de dagen van eerdere jaren; die veranderen niet meer, behalve bij een splitsing, naamswijziging,
//    import of herstel (dan verandert series_ver) en bij de jaarwisseling. Zo groeit wat elk uur gelezen wordt niet
//    met elk jaar historie mee.
async function seriesRows(env, now) {
  const ver = (await getKv(env, 'series_ver')) || '';
  const yearStart = new Date(now).getUTCFullYear() + '-01-01';
  let old = null;
  try { old = JSON.parse((await getBig(env, 'series_old')) || 'null'); } catch (e) { old = null; }
  if (!old || old.v !== 1 || old.ver !== ver || old.before !== yearStart) {
    old = { v: 1, ver, before: yearStart, dys: (await env.DB.prepare('SELECT day, ticker, open, close, low, high, avg, range, range_pct FROM days WHERE day < ? ORDER BY day').bind(yearStart).all()).results };
    try { await setBig(env, 'series_old', JSON.stringify(old)); } catch (e) { console.error('reekscache (oude dagen)', e); }
  }
  const hk = [(await getKv(env, 'last_hour')) || '', (await getKv(env, 'last_day')) || '', ver, yearStart, (await getKv(env, 'series_recent')) || ''].join('|');
  let c = null;
  try { c = JSON.parse((await getBig(env, 'series_cache')) || 'null'); } catch (e) { c = null; }
  if (!c || c.v !== 2 || c.hk !== hk || now - c.at > 6 * 3600e3) {
    const intra = (await env.DB.prepare('SELECT ts, ticker, name, value, unrealized, qty, price FROM intraday WHERE ts < ? ORDER BY ts').bind(now).all()).results;
    const hrs = (await env.DB.prepare('SELECT hour, ticker, open, close, low, high, avg FROM hours WHERE hour >= ? ORDER BY hour').bind(now - 32 * 864e5).all()).results;
    const dys = (await env.DB.prepare('SELECT day, ticker, open, close, low, high, avg, range, range_pct FROM days WHERE day >= ? ORDER BY day').bind(yearStart).all()).results;
    c = { v: 2, hk, at: now, until: now, intra, hrs, dys };
    try { await setBig(env, 'series_cache', JSON.stringify(c)); } catch (e) { console.error('reekscache', e); }
  }
  const fresh = (await env.DB.prepare('SELECT ts, ticker, name, value, unrealized, qty, price FROM intraday WHERE ts >= ? ORDER BY ts').bind(c.until).all()).results;
  return { intra: c.intra.concat(fresh), hrs: c.hrs.filter((h) => h.hour >= now - 31 * 864e5), dys: old.dys.concat(c.dys) };
}

// Vandaag per positie (open, laag, hoog, gemiddelde, nu) en de posities van de laatste meting, bijgehouden met alleen
// de metingen die sinds de vorige keer zijn bijgekomen (kv 'today_state'). Zo leest een opbouw een paar dozijn rijen
// in plaats van elk uur de hele geschiedenis. Hoogste en laagste ooit en het gemiddelde dagbereik rekent de site zelf
// uit zijn eigen reeksen uit; de volledige reeksen bouwt de Worker alleen als een apparaat ze vraagt (seriesFull).
async function todayState(env) {
  let st = null;
  try { st = JSON.parse((await getKv(env, 'today_state')) || 'null'); } catch (e) { st = null; }
  if (!st || st.v !== 2) {
    const last = await env.DB.prepare('SELECT MAX(ts) AS ts FROM intraday').first().catch(() => null);
    st = { v: 2, day: null, until: last && last.ts ? last.ts - 864e5 : 0, lastTs: 0, t: {}, pos: [] };
  }
  // Vanaf de laatste meting (die opnieuw): een meting die vervangen is (zelfde tijdstip), telt zo ook mee
  const { results } = await env.DB.prepare('SELECT ts, ticker, name, value, unrealized, qty, price FROM intraday WHERE ts >= ? ORDER BY ts').bind(st.until).all();
  const lastDay = results.length ? dayOf(results[results.length - 1].ts) : st.day;
  let changed = false;
  // Een meting schrijft alleen de posities die veranderden (idee 45). De totaalregel draagt in price het aantal
  // posities; zijn er op dat tijdstip evenveel positieregels, dan was het een volledige meting en vallen posities
  // zonder regel (verkocht) weg. Een totaalregel zonder aantal is van vóór idee 45: toen was elke meting volledig.
  const cnt = new Map(), full = new Map();
  results.forEach((r) => {
    const d = dayOf(r.ts);
    if (d !== lastDay) return;
    if (d !== st.day) { st.day = d; st.t = {}; st.pos = []; st.lastTs = 0; }
    const a = st.t[r.ticker], v = r.value;
    if (!a) { st.t[r.ticker] = { o: v, l: v, h: v, s: v, n: 1, c: v, lt: r.ts, name: r.name }; changed = true; }
    else if (r.ts > a.lt || (r.ts === a.lt && v !== a.c)) {
      if (r.ts > a.lt) { a.s += v; a.n++; a.lt = r.ts; } else a.s += v - a.c;
      a.c = v; a.l = Math.min(a.l, v); a.h = Math.max(a.h, v); a.name = r.name;
      changed = true;
    }
    if (r.ts > st.lastTs) { st.lastTs = r.ts; changed = true; }
    if (r.ticker === TOTAL) { full.set(r.ts, r.price > 0 ? r.price : -1); return; }
    cnt.set(r.ts, (cnt.get(r.ts) || 0) + 1);
    const row = { ticker: r.ticker, name: r.name, value: r.value, unrealized: r.unrealized, qty: r.qty, price: r.price, lt: r.ts };
    const i = st.pos.findIndex((x) => x.ticker === r.ticker);
    if (i < 0) { st.pos.push(row); changed = true; }
    else if (r.ts >= (st.pos[i].lt || 0) && JSON.stringify(st.pos[i]) !== JSON.stringify(row)) { st.pos[i] = row; changed = true; }
  });
  let fullTs = 0;
  full.forEach((n, ts) => { if ((n === -1 || cnt.get(ts) === n) && ts > fullTs) fullTs = ts; });
  if (fullTs) {
    const keep = st.pos.filter((x) => (x.lt || 0) >= fullTs);
    if (keep.length !== st.pos.length) { st.pos = keep; changed = true; }
  }
  if (st.lastTs) st.until = st.lastTs;
  if (changed) await setKv(env, 'today_state', JSON.stringify(st));
  return st;
}

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

  const st = await todayState(env);

  // Posities: laatste meting, anders laatste weeksnapshot
  let positions = [], positionsDate = null;
  if (st.lastTs) {
    positionsDate = isoLocal(st.lastTs);
    positions = st.pos.map((r) => ({
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
  const today = Object.entries(st.t).map(([ticker, a]) => ({
    ticker, name: a.name, current: a.c, low: a.l, high: a.h, avg: r2(a.s / a.n), open: a.o,
    change: r2(a.c - a.o), changePct: a.o ? (a.c - a.o) / a.o : 0,
  }));
  today.sort((a, b) => (a.ticker === TOTAL ? -1 : b.ticker === TOTAL ? 1 : a.ticker.localeCompare(b.ticker)));

  let events = null;
  try { events = JSON.parse((await getKv(env, 'events')) || 'null'); } catch (e) { events = null; }

  let market = null;
  try { market = await marketDataCached(env); } catch (e) { console.error('market', e); }
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
    cashNow: await cashNowOf(env),
    today,
    newsFlash: await (async () => { try { return JSON.parse((await getKv(env, 'news_flash')) || '{}').items || []; } catch (e) { return []; } })(),
  };
}

// De volledige reeksen (metingen, uren, alle dagen) voor een apparaat zonder eigen kopie, een oude versie van de site
// of de deel-link. Gewone verversingen vragen alleen wat er sinds ?since= bijkwam (seriesDelta). Opnieuw opgebouwd
// als er sinds de vorige keer een meting bij is gekomen; seriesRows houdt daarvoor zijn eigen caches bij.
function seriesJson(S, ts) {
  return {
    ok: true, part: 'series', seriesTs: ts,
    // Met het aantal stuks per meting, zodat de site aan- en verkopen uit koersbewegingen kan halen
    intraday: { columns: ['time', 'ticker', 'value', 'qty'], rows: S.intra.map((r) => [isoLocal(r.ts), r.ticker, r.value, r.qty == null ? null : r.qty]) },
    hours: { columns: ['hour', 'ticker', 'open', 'close', 'low', 'high', 'avg'],
      rows: S.hrs.map((r) => [isoLocal(r.hour), r.ticker, r.open, r.close, r.low, r.high, r.avg]) },
    days: { columns: ['date', 'ticker', 'open', 'close', 'low', 'high', 'avg', 'range', 'rangePct'],
      rows: S.dys.map((r) => [r.day + 'T00:00:00', r.ticker, r.open, r.close, r.low, r.high, r.avg, r.range, r.range_pct]) },
  };
}
async function seriesFull(env) {
  const last = await env.DB.prepare('SELECT MAX(ts) AS ts FROM intraday').first().catch(() => null);
  const ts = (last && last.ts) || 0;
  // Ook opnieuw na een splitsing, import of herstel (series_ver) en na het samenvatten van een uur of dag
  const stamp = [ts, (await getKv(env, 'series_ver')) || '', (await getKv(env, 'last_hour')) || '', (await getKv(env, 'last_day')) || ''].join('|');
  let tags = {};
  try { tags = JSON.parse((await getKv(env, 'data_etags')) || '{}'); } catch (e) { tags = {}; }
  let body = tags.series && tags.seriesStamp === stamp ? await getBig(env, 'data_series') : null;
  if (!body) {
    body = JSON.stringify(seriesJson(await seriesRows(env, Date.now()), ts));
    const tag = '"' + (await sha256Hex(body)).slice(0, 24) + '"';
    await setBig(env, 'data_series', body);
    // De vingerafdrukken opnieuw lezen: een opbouw kan intussen core en extra hebben vernieuwd
    try { tags = JSON.parse((await getKv(env, 'data_etags')) || '{}'); } catch (e) { tags = {}; }
    tags.series = tag; tags.seriesStamp = stamp;
    await setKv(env, 'data_etags', JSON.stringify(tags));
  }
  return { body, tag: tags.series };
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
  if (stmts.length) await invalidateOrders(env);
  if (full) await setKv(env, 'orders_full', '1');
  await setKv(env, 'orders_synced', parts(new Date()).day);
  let ledger = '';
  try { ledger = await ledgerCheck(env, false); } catch (e) { console.error('boekhouding', e); }
  await saveDataCache(env, await buildData(env));
  return `Orders: ${stmts.length} uitvoeringen bijgewerkt (${pages} pagina's).` + (ledger ? ' ' + ledger : '');
}

// Alle orders als rijen [tijd, ticker, naam, kant, aantal, koers, munt, wisselkoers, netto, gerealiseerd, kosten fx,
// overige kosten, soort]. De orders veranderen hooguit eens per dag (syncOrders) of bij een import; tot dan uit de cache.
async function ordersCached(env) {
  const ver = (await getKv(env, 'orders_ver')) || '';
  let c = null;
  try { c = JSON.parse((await getBig(env, 'orders_cache')) || 'null'); } catch (e) { c = null; }
  if (c && c.ver === ver && Array.isArray(c.rows)) return c.rows;
  const { results } = await env.DB.prepare('SELECT ts, ticker, name, side, qty, price, currency, fx_rate, net, realised, fee_fx, fee_other, kind FROM orders ORDER BY ts').all();
  const rows = results.map((r) => [isoLocal(r.ts), r.ticker, r.name, r.side, r.qty, r.price, r.currency, r.fx_rate, r.net, r.realised, r.fee_fx, r.fee_other, r.kind]);
  try { await setBig(env, 'orders_cache', JSON.stringify({ ver, rows })); } catch (e) { console.error('orderscache', e); }
  return rows;
}

// ---------- Boekhouding nakijken (idee 47) ----------
// Eén keer per week, na het ophalen van de orders: de aantallen per aandeel opnieuw optellen uit alle orders (ook uit
// de CSV-import) en vergelijken met de laatste meting. Splitsingen en nieuwe tickers uit corp_actions tellen mee.
// Ontbreken de orders van vóór de koppeling (de eerste order is later dan de aankoopdatum van de positie), dan zegt
// de controle dat in plaats van een verschil te melden. Het resultaat staat in kv 'ledger_check'.
const LEDGER_TOL = 0.0005, LEDGER_DAYS = 7;
async function ledgerCheck(env, force) {
  let prev = null;
  try { prev = JSON.parse((await getKv(env, 'ledger_check')) || 'null'); } catch (e) { prev = null; }
  if (!force && prev && prev.at && Date.now() - Date.parse(prev.at) < LEDGER_DAYS * 864e5 - 3600e3) return '';
  const held = await lastRows(env);
  if (!held || !held.length) return '';
  const rows = await ordersCached(env);
  let log = [], extra = {};
  try { log = JSON.parse((await getKv(env, 'corp_actions')) || '[]'); } catch (e) { log = []; }
  try { extra = JSON.parse((await getKv(env, 'pos_extra')) || '{}'); } catch (e) { extra = {}; }
  const csv = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE id >= 'csv:' AND id < 'csv;'").first().catch(() => null);
  // Nieuwe tickers volgen (een naamswijziging kan op een eerdere volgen)
  const ren = new Map(log.filter((a) => a.kind === 'naam' && a.from && a.to).map((a) => [a.from, a.to]));
  const now = (tk) => { let t = tk; for (let i = 0; i < 5 && ren.has(t); i++) t = ren.get(t); return t; };
  const splits = log.filter((a) => a.kind === 'split' && a.ticker && a.ratio > 0);
  const sum = new Map(), first = new Map();
  rows.forEach((o) => {
    const kind = o[12];
    if (kind && kind !== 'TRADE') return;
    const tk = now(o[1]), day = String(o[0]).slice(0, 10);
    let q = Number(o[4]) || 0;
    splits.forEach((sp) => { if (sp.ticker === tk && sp.day > day) q *= sp.ratio; });
    sum.set(tk, (sum.get(tk) || 0) + (o[3] === 'SELL' ? -q : q));
    if (!first.has(tk) || day < first.get(tk)) first.set(tk, day);
  });
  const items = [];
  held.forEach((h) => {
    const want = Number(h.qty) || 0, got = sum.get(h.ticker) || 0, diff = want - got;
    if (Math.abs(diff) <= Math.max(LEDGER_TOL, want * 1e-5)) return;
    const since = extra[h.ticker] && extra[h.ticker].since ? String(extra[h.ticker].since).slice(0, 10) : null;
    const missing = !first.has(h.ticker) || (since && first.get(h.ticker) > since);
    items.push({ tk: h.ticker, held: want, orders: Math.round(got * 1e6) / 1e6, diff: Math.round(diff * 1e6) / 1e6, why: missing ? 'orders_missing' : 'diff' });
  });
  // Volgens de orders nog in bezit, maar niet in de laatste meting
  const heldSet = new Set(held.map((h) => h.ticker));
  sum.forEach((q, tk) => { if (!heldSet.has(tk) && q > LEDGER_TOL) items.push({ tk, held: 0, orders: Math.round(q * 1e6) / 1e6, diff: -Math.round(q * 1e6) / 1e6, why: 'not_held' }); });
  const res = { at: new Date().toISOString(), n: held.length, ok: held.length - items.filter((x) => x.why !== 'not_held').length, csv: !!(csv && csv.n), orders: rows.length, items: items.slice(0, 40) };
  await setKv(env, 'ledger_check', JSON.stringify(res));
  return 'Boekhouding nagekeken: ' + res.ok + ' van ' + res.n + ' posities kloppen met de orders.';
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
    clean.watchlist = [...new Set(body.watchlist.map((x) => String(x || '').trim().toUpperCase()).filter((x) => /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(x)))].slice(0, WATCH_MAX);
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
    const hr = (x) => { const v = Math.floor(Number(x)); return isFinite(v) && v >= 0 && v <= 23 ? v : 0; };
    clean.alerts = { move: num2(a.move, 0, 50), earnings: !!a.earnings, insider: !!a.insider, drift: num2(a.drift, 0, 50),
      quietFrom: hr(a.quietFrom), quietTo: hr(a.quietTo), digest: !!a.digest, digestHour: a.digestHour === undefined ? 18 : hr(a.digestHour), ratings: a.ratings !== false,
      news: ['all', 'official', 'off'].includes(a.news) ? a.news : 'all' };
  }
  if (body && typeof body.mailAmounts === 'boolean') clean.mailAmounts = body.mailAmounts;
  if (body && typeof body.depositReminder === 'boolean') clean.depositReminder = body.depositReminder;
  // Grenzen voor kopen en verkopen (euro per order en per dag)
  if (body && body.tradeLimits && typeof body.tradeLimits === 'object') {
    const n = (x, d) => { const v = Number(x); return isFinite(v) && v > 0 && v <= 1e6 ? Math.round(v * 100) / 100 : d; };
    clean.tradeLimits = { perOrder: n(body.tradeLimits.perOrder, TRADE_DEFAULTS.perOrder), perDay: n(body.tradeLimits.perDay, TRADE_DEFAULTS.perDay) };
  }
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
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
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
      let old = null;
      try { old = JSON.parse((await getKv(env, 'etf_' + key)) || 'null'); } catch (e) { old = null; }
      const prev = old && old.cond && old.cond.url === src.url ? old.cond : null;
      const res = await fetch(src.url, { headers: condHeaders(prev, { 'User-Agent': 'Mozilla/5.0 (investment-tracker; persoonlijk gebruik)', Accept: 'text/csv,*/*' }) });
      if (res.status === 304 && prev) continue;   // zelfde lijst als de vorige keer: niets schrijven
      if (!res.ok) throw new Error('status ' + res.status);
      const text = await res.text();
      const parsed = parseHoldings(text);
      if (!parsed) throw new Error('geen lijst in het bestand (' + (res.headers.get('content-type') || '?') + ', ' + text.length + ' tekens, begint met: ' + text.slice(0, 160).replace(/\s+/g, ' ') + ')');
      await setKv(env, 'etf_' + key, JSON.stringify(Object.assign({ label: src.label, fund: src.fund, cond: Object.assign({ url: src.url }, condOf(res)) }, parsed)));
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
  // Noteringen per positie van OpenFIGI (beurzen, Amerikaanse ticker, fonds of aandeel), voor de bedrijfspagina
  try {
    const fs = JSON.parse((await getKv(env, 'figi_sym')) || '{}');
    Object.keys(out.posExtra).forEach((tk) => { const f = fs[tk]; if (f && !f.none) out.posExtra[tk].figi = { us: f.us || null, de: f.de || null, fund: !!f.fund, type: f.type || null, ex: f.ex || [] }; });
  } catch (e) { /* geen OpenFIGI-gegevens */ }
  out.settings = await getSettings(env);
  if ((await getKv(env, 'orders_schema')) === '1') out.orders = await ordersCached(env);
  out.research = {}; out.fin = {}; out.fx = null; out.hicp = null;
  // Deponeringen, 13F, economische agenda, pies en kwartaalcijferdata
  out.ext2 = {};
  try {
    const { results: e2 } = await env.DB.prepare("SELECT key, value FROM kv WHERE key IN ('filings', 'f13', 'econ', 'pies', 'earn_hist', 'interest_csv')").all();
    e2.forEach((r) => { try { out.ext2[r.key === 'earn_hist' ? 'earnHist' : r.key === 'interest_csv' ? 'interest' : r.key] = JSON.parse(r.value); } catch (e) { /* overslaan */ } });
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
  out.has = { fmp: !!env.FMP_KEY, finnhub: !!env.FINNHUB_KEY, av: !!env.ALPHAVANTAGE_KEY, td: !!env.TWELVEDATA_KEY, tiingo: !!env.TIINGO_KEY, polygon: !!env.POLYGON_KEY, mx: !!env.MARKETAUX_KEY, sec: !!env.SEC_CONTACT, t212: !!(env.T212_KEY && env.T212_SECRET) };
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
    const out = { updated: isoLocal(Date.now()), source: 'ECB Data Portal, HICP', series: {}, cond: {} };
    let old = null;
    try { old = JSON.parse((await getKv(env, 'hicp')) || 'null'); } catch (e) { old = null; }
    let same = 0;
    for (const area of ['NL', 'U2']) {
      const url = 'https://data-api.ecb.europa.eu/service/data/HICP/M.' + area + '.N.000000.4D0.INX?format=csvdata&startPeriod=' + start.toISOString().slice(0, 7);
      // De index komt één keer per maand: met Last-Modified van de vorige keer antwoordt de ECB meestal 304 (niets nieuws)
      const prev = old && old.cond && old.cond[area] && old.cond[area].url === url && old.series && old.series[area] ? old.cond[area] : null;
      const res = await fetch(url, { headers: condHeaders(prev) });
      if (res.status === 304 && prev) { out.series[area] = old.series[area]; out.cond[area] = prev; same++; continue; }
      if (res.ok) {
        out.cond[area] = Object.assign({ url }, condOf(res));
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
    if (same === 2) { await noteExtError(env, 'inflation', null); return 2; }   // niets nieuws: niets schrijven
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
  if (kind === 'instr') return fetchInstruments(env);
  if (kind === 'figi') return figiTask(env);
  if (kind === 'fhnews') {
    // Algemeen marktnieuws voor de nieuwspagina. Eerst Finnhub (gratis sleutel); lukt dat niet, dan de reserves:
    // Polygon, Marketaux, GDELT (geen sleutel) en als laatste Alpha Vantage NEWS_SENTIMENT (klein dagbudget) (idee 153).
    const store = async (items, source) => {
      if (!items.length) return;
      await setKv(env, 'market_news', JSON.stringify({ updated: isoLocal(Date.now()), source, items }));
    };
    let calls = 0;
    if (env.FINNHUB_KEY && !(await srcDown(env, 'finnhub'))) {
      calls++;
      const r = await getJson(FINNHUB_BASE + '/news?category=general&token=' + encodeURIComponent(env.FINNHUB_KEY));
      if (r.status === 401) { await noteExtError(env, 'finnhub', 'Finnhub-sleutel ongeldig (401).'); }
      else if (r.status === 429) { await srcFail(env, 'finnhub', 'Finnhub-limiet (marktnieuws)', true); }
      else if (r.ok) {
        const items = (Array.isArray(r.body) ? r.body : []).filter((n) => n.headline && /^https:\/\//.test(n.url || '')).sort((a, c) => c.datetime - a.datetime).slice(0, 30)
          .map((n) => ({ t: n.datetime * 1000, headline: String(n.headline).slice(0, 220), summary: String(n.summary || '').slice(0, 300), source: n.source || '', url: n.url, related: String(n.related || '').slice(0, 60) }));
        if (items.length) { await store(items, 'Finnhub'); await noteExtError(env, 'marketnews', null); return calls; }
      } else await srcFail(env, 'finnhub', 'Finnhub gaf ' + r.status + ' (marktnieuws)');
    }
    // Reserves met ruimere limieten: Polygon (algemeen marktnieuws), dan Marketaux (3 berichten per verzoek)
    const backupName = env.FINNHUB_KEY ? 'reserve voor Finnhub' : 'zonder Finnhub';
    if (env.POLYGON_KEY && !(await srcDown(env, 'polygon'))) {
      const r = await polyGet(env, '/v2/reference/news?order=desc&sort=published_utc&limit=40');
      if (r.body) calls++;
      const items = r.body ? polyNewsItems(r.body.results).slice(0, 30).map((x) => ({ t: x.t, headline: x.headline, summary: x.summary, source: x.source, url: x.url, related: x.related })) : [];
      if (items.length) {
        await store(items, 'Polygon (' + backupName + ')');
        if (env.FINNHUB_KEY) await srcBackup(env, 'finnhub', 'Polygon (marktnieuws)');
        await noteExtError(env, 'marketnews', null);
        return calls;
      }
    }
    if (env.MARKETAUX_KEY) {
      const list = await mxNews(env, null);
      if (list) calls++;
      const items = (list || []).slice(0, 30).map((x) => ({ t: x.t, headline: x.headline, summary: x.summary, source: x.source, url: x.url, related: x.related }));
      if (items.length) {
        await store(items, 'Marketaux (' + backupName + ')');
        if (env.FINNHUB_KEY) await srcBackup(env, 'finnhub', 'Marketaux (marktnieuws)');
        await noteExtError(env, 'marketnews', null);
        return calls;
      }
    }
    // GDELT (geen sleutel): berichten over de aandelenmarkt
    if (env._gdelt) {
      const list = await gdeltNews(env, 'theme:ECON_STOCKMARKET sourcelang:english');
      if (list && !list.busy) calls++;
      const items = list && !list.busy ? list.slice(0, 30).map((x) => ({ t: x.t, headline: x.headline, summary: x.summary, source: x.source, url: x.url, related: x.related })) : [];
      if (items.length) {
        await store(items, 'GDELT (' + backupName + ')');
        if (env.FINNHUB_KEY) await srcBackup(env, 'finnhub', 'GDELT (marktnieuws)');
        await noteExtError(env, 'marketnews', null);
        return calls;
      }
    }
    if (!env.ALPHAVANTAGE_KEY) {
      if (!env.FINNHUB_KEY && !env.POLYGON_KEY && !env.MARKETAUX_KEY && !env._gdelt) return calls;
      await noteExtError(env, 'marketnews', 'Geen marktnieuws ontvangen. Met een gratis sleutel van Polygon of Marketaux heeft de Worker een reserve.');
      return calls;
    }
    if ((await avCount(env, 0)) < 1) { await noteExtError(env, 'marketnews', 'Geen marktnieuws ontvangen en het dagbudget van Alpha Vantage is op.'); return calls; }
    calls++;
    await avCount(env, 1);
    let b = {};
    try { b = await av(env, 'NEWS_SENTIMENT', 'topics=financial_markets&sort=LATEST&limit=50'); }
    catch (e) { await noteExtError(env, 'marketnews', 'Reservebron: ' + e.message); return calls; }
    if (b.premium || !Array.isArray(b.feed)) { await noteExtError(env, 'marketnews', 'De reservebron gaf geen nieuws terug.'); return calls; }
    const when = (x) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(x || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; };
    const items = b.feed.map((a) => ({ t: when(a.time_published), a })).filter((x) => x.t && x.a.title && /^https?:\/\//.test(x.a.url || ''))
      .sort((x, y) => y.t - x.t).slice(0, 30)
      .map((x) => ({ t: x.t, headline: String(x.a.title).slice(0, 220), summary: String(x.a.summary || '').slice(0, 300), source: x.a.source || 'Alpha Vantage', url: x.a.url,
        related: String((x.a.ticker_sentiment || []).map((y) => y.ticker).slice(0, 4).join(',')).slice(0, 60) }));
    if (!items.length) { await noteExtError(env, 'marketnews', 'De reservebron gaf geen nieuws terug.'); return calls; }
    await store(items, 'Alpha Vantage (reserve voor Finnhub)');
    await srcBackup(env, 'finnhub', 'Alpha Vantage (marktnieuws)');
    await noteExtError(env, 'marketnews', null);
    return calls;
  }
  if (kind === 'companies') return refreshCompanies(env);
  if (kind === 'fh') return finnhubTask(env, arg);
  if (kind === 'fhhist') return newsHistTask(env, arg);
  if (kind === 'av') return avTask(env, arg);
  if (kind === 'alt') return altTask(env, arg);
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
  // Wat Polygon, Marketaux, de SEC of FMP vandaag al aanvulden, hoeft Alpha Vantage niet meer te doen
  const need = avNeeds(prev, !!env.FINNHUB_KEY && !(await srcDown(env, 'finnhub'))).filter((k) => !altFresh(prev, k));
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
          .filter((x) => x.t && x.a.title && /^https:\/\//.test(String(x.a.url || '')) && (!x.ts || Number(x.ts.relevance_score) >= 0.2));
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
  noteOpinionDay(prev, out, ymdUTC(Date.now()));
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

// ---------- Ruimere gratis bronnen: Tiingo, Polygon (Massive) en Marketaux ----------
// Tiingo (gratis: 50 verzoeken per uur, 1000 per dag, 500 verschillende symbolen per maand): dagkoersen, ook ver terug.
// Polygon, sinds 2025 Massive (gratis Stocks Basic: 5 verzoeken per minuut, slotkoersen, 2 jaar terug): dagkoersen,
//   nieuws met stemming per aandeel, marktnieuws en bedrijfsprofielen.
// Marketaux (gratis: 100 verzoeken per dag, 3 berichten per verzoek): nieuws met stemming per aandeel.
// Alle drie zijn optioneel en vallen zacht weg: zonder sleutel, bij een limiet of een fout neemt de volgende bron het over.
const TIINGO_BASE = 'https://api.tiingo.com';
const POLYGON_BASE = 'https://api.massive.com';
const MARKETAUX_BASE = 'https://api.marketaux.com/v1';
const TIINGO_DAY_BUDGET = 900, TIINGO_HOUR_BUDGET = 45;
const MX_DAY_BUDGET = 90;
// Polygon staat 5 verzoeken per minuut toe; een stap van de Worker duurt seconden en komt elke 10 minuten
const POLY_STEP_MAX = 4;

// Teller per dag (en eventueel per uur) in kv: { day, n, hour, h }. n = 0 vraagt alleen wat er over is.
async function quota(env, key, n, dayCap, hourCap) {
  const now = new Date();
  const day = parts(now).day, hour = now.toISOString().slice(0, 13);
  let c = {};
  try { c = JSON.parse((await getKv(env, key)) || '{}'); } catch (e) { c = {}; }
  const d = c.day === day ? Number(c.n) || 0 : 0, h = c.hour === hour ? Number(c.h) || 0 : 0;
  if (n) await setKv(env, key, JSON.stringify({ day, n: d + n, hour, h: h + n }));
  return Math.min(dayCap - d - n, hourCap ? hourCap - h - n : Infinity);
}

// Alleen Amerikaanse noteringen (eventueel met een aandelenklasse, BRK-B of BRK.B). Een beurs-achtervoegsel
// zoals ASML.AS of VOD.L kennen Tiingo en Polygon niet; daar vragen we dan ook niet naar.
const usSym = (sym) => /^[A-Z0-9]{1,6}([.-][A-C])?$/.test(String(sym || ''));
const tiingoSym = (sym) => String(sym).replace('.', '-').toLowerCase();
const polySym = (sym) => String(sym).replace('-', '.');

// Dagkoersen van Tiingo (gecorrigeerd voor splitsingen en dividend). null = niet geprobeerd of mislukt, [] = onbekend symbool.
async function tiingoDaily(env, sym) {
  const us = env.TIINGO_KEY ? await usTicker(env, sym) : null;
  if (!us || (await srcDown(env, 'tiingo'))) return null;
  if ((await quota(env, 'tiingo_calls', 0, TIINGO_DAY_BUDGET, TIINGO_HOUR_BUDGET)) < 1) return null;
  await quota(env, 'tiingo_calls', 1, TIINGO_DAY_BUDGET, TIINGO_HOUR_BUDGET);
  const r = await getJson(TIINGO_BASE + '/tiingo/daily/' + encodeURIComponent(tiingoSym(us)) + '/prices?startDate=' + ymdUTC(Date.now() - 400 * 864e5),
    { Authorization: 'Token ' + env.TIINGO_KEY, Accept: 'application/json' });
  const detail = String((r.body && r.body.detail) || (typeof r.body === 'string' ? r.body : '')).slice(0, 120);
  if (r.status === 429 || /limit|exceeded/i.test(detail)) { await srcFail(env, 'tiingo', 'Tiingo-limiet', true); return null; }
  if (r.status === 401 || r.status === 403) { await srcFail(env, 'tiingo', 'Tiingo weigert de sleutel (' + r.status + ')'); await noteExtError(env, 'tiingo', 'Tiingo weigert de sleutel (' + r.status + ').'); return null; }
  if (r.status === 404) return [];
  if (!r.ok || !Array.isArray(r.body)) { await srcFail(env, 'tiingo', 'Tiingo gaf ' + r.status + (detail ? ': ' + detail : '')); return null; }
  await srcOk(env, 'tiingo');
  await noteExtError(env, 'tiingo', null);
  return r.body.map((x) => [String(x.date || '').slice(0, 10), numOrNull(x.adjClose != null ? x.adjClose : x.close)])
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x[0]) && x[1] != null).sort((a, c) => a[0].localeCompare(c[0]));
}

// Eén verzoek bij Polygon, met de teller per stap. { busy } = stap vol, { body } = gelukt, anders mislukt.
async function polyGet(env, path) {
  if (!env.POLYGON_KEY) return { off: true };
  if ((env._polyN || 0) >= POLY_STEP_MAX) return { busy: true };
  env._polyN = (env._polyN || 0) + 1;
  const r = await getJson(POLYGON_BASE + path, { Authorization: 'Bearer ' + env.POLYGON_KEY, Accept: 'application/json' });
  if (r.status === 429) { await srcFail(env, 'polygon', 'Polygon-limiet (5 per minuut)', true); return { limit: true }; }
  if (r.status === 401 || r.status === 403) {
    await srcFail(env, 'polygon', 'Polygon weigert dit verzoek (' + r.status + ')');
    await noteExtError(env, 'polygon', 'Polygon weigert de sleutel of dit onderdeel zit niet in je abonnement (' + r.status + ').');
    return { denied: true };
  }
  if (!r.ok || !r.body) { await srcFail(env, 'polygon', 'Polygon gaf ' + r.status); return { fail: true }; }
  await srcOk(env, 'polygon');
  await noteExtError(env, 'polygon', null);
  return { body: r.body };
}

// Dagkoersen van Polygon (2 jaar terug in het gratis plan)
async function polyDaily(env, sym) {
  const us = env.POLYGON_KEY ? await usTicker(env, sym) : null;
  if (!us || (await srcDown(env, 'polygon'))) return null;
  const r = await polyGet(env, '/v2/aggs/ticker/' + encodeURIComponent(polySym(us)) + '/range/1/day/' + ymdUTC(Date.now() - 400 * 864e5) + '/' + ymdUTC(Date.now()) + '?adjusted=true&sort=asc&limit=500');
  if (!r.body) return r.busy ? { busy: true } : null;
  return (Array.isArray(r.body.results) ? r.body.results : []).map((x) => [ymdUTC(Number(x.t)), numOrNull(x.c)])
    .filter((x) => x[1] != null && /^\d{4}-\d{2}-\d{2}$/.test(x[0]));
}

// Nieuws van Polygon in één vorm: { t, headline, summary, source, url, related, tone (-1, 0, 1 of null) }
function polyNewsItems(list, sym) {
  const T = { positive: 1, negative: -1, neutral: 0 };
  return (Array.isArray(list) ? list : []).map((a) => {
    const ins = sym ? (a.insights || []).find((x) => x && x.ticker === sym) : null;
    return { t: Date.parse(a.published_utc || ''), headline: String(a.title || '').slice(0, 220), summary: String(a.description || '').slice(0, 300),
      source: String((a.publisher && a.publisher.name) || '').slice(0, 60), url: a.article_url || '', related: (a.tickers || []).slice(0, 4).join(',').slice(0, 60),
      tone: ins && ins.sentiment in T ? T[ins.sentiment] : null };
  }).filter((x) => isFinite(x.t) && x.headline && /^https:\/\//.test(x.url)).sort((a, c) => c.t - a.t);
}

// Nieuws van Marketaux (3 berichten per verzoek); stemming per aandeel van -1 tot 1
async function mxNews(env, sym) {
  if (!env.MARKETAUX_KEY || (await srcDown(env, 'marketaux'))) return null;
  if ((await quota(env, 'mx_calls', 0, MX_DAY_BUDGET)) < 1) return null;
  await quota(env, 'mx_calls', 1, MX_DAY_BUDGET);
  const q = sym ? 'symbols=' + encodeURIComponent(polySym(sym)) + '&filter_entities=true&must_have_entities=true' : 'countries=us&filter_entities=true';
  const r = await getJson(MARKETAUX_BASE + '/news/all?' + q + '&language=en&published_after=' + ymdUTC(Date.now() - 10 * 864e5) + '&api_token=' + encodeURIComponent(env.MARKETAUX_KEY));
  if (r.status === 402) { await srcFail(env, 'marketaux', 'Marketaux-daglimiet', true); return null; }
  if (r.status === 429) { await srcFail(env, 'marketaux', 'Marketaux: te veel verzoeken per minuut'); return null; }
  if (r.status === 401 || r.status === 403) { await srcFail(env, 'marketaux', 'Marketaux weigert de sleutel (' + r.status + ')'); await noteExtError(env, 'marketaux', 'Marketaux weigert de sleutel (' + r.status + ').'); return null; }
  if (!r.ok || !r.body || !Array.isArray(r.body.data)) { await srcFail(env, 'marketaux', 'Marketaux gaf ' + r.status); return null; }
  await srcOk(env, 'marketaux');
  await noteExtError(env, 'marketaux', null);
  const want = sym ? polySym(sym) : null;
  return r.body.data.map((a) => {
    const ent = want ? (a.entities || []).find((x) => x && x.symbol === want) : null;
    const sc = ent ? numOrNull(ent.sentiment_score) : null;
    return { t: Date.parse(a.published_at || ''), headline: String(a.title || '').slice(0, 220), summary: String(a.description || a.snippet || '').slice(0, 300),
      source: String(a.source || '').slice(0, 60), url: a.url || '', related: (a.entities || []).map((x) => x.symbol).filter(Boolean).slice(0, 4).join(',').slice(0, 60),
      tone: sc == null ? null : sc > 0.15 ? 1 : sc < -0.15 ? -1 : 0 };
  }).filter((x) => isFinite(x.t) && x.headline && /^https:\/\//.test(x.url)).sort((a, c) => c.t - a.t);
}

// ---------- OpenFIGI: welk beurssymbool hoort bij een ISIN (geen sleutel nodig) ----------
// Trading 212 geeft per positie een ISIN, maar een kale ticker zonder beurs. OpenFIGI (van Bloomberg, gratis) zegt per
// ISIN op welke beurzen het effect onder welke ticker noteert en of het een fonds is. Daarmee vraagt de Worker de
// Amerikaanse bronnen (Tiingo, Polygon, de SEC) alleen naar effecten die echt in de VS noteren, met de juiste ticker,
// in plaats van naar een Amerikaans bedrijf dat toevallig dezelfde letters heeft. Zonder sleutel: 25 verzoeken per
// minuut met 10 ISIN's per verzoek; met OPENFIGI_KEY (gratis) meer. Eén verzoek per stap; een ISIN eens per 30 dagen.
const OPENFIGI_URL = 'https://api.openfigi.com/v3/mapping';
const FIGI_MAX_AGE_DAYS = 30;
// Beurscodes van OpenFIGI voor de VS: US is het samengestelde symbool, de rest losse handelsplaatsen
const FIGI_US = new Set(['US', 'UN', 'UW', 'UQ', 'UA', 'UR', 'UP', 'UV', 'UF', 'UD', 'UT', 'UX', 'UB', 'UC', 'UM']);
const figiIsFund = (d) => /ETP|ETF|Fund|Unit/i.test(String((d && d.securityType) || '') + ' ' + String((d && d.securityType2) || ''));
async function figiMap(key, jobs) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (key) h['X-OPENFIGI-APIKEY'] = key;
  const res = await fetch(OPENFIGI_URL, { method: 'POST', headers: h, body: JSON.stringify(jobs) });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, ok: res.ok, body };
}
// Eén regel per ISIN: { d: dag, name, type, fund, us: Amerikaanse ticker of null, de: Duitse ticker of null, ex: [[beurscode, ticker], …] }
// of { d, none: true }. De Duitse ticker (samengesteld GR, anders Xetra, Frankfurt of München) is ook die van gettex: de site
// toont daarmee de live grafiek van TradingView in de snelle modus.
function figiRecord(item, day) {
  const data = item && Array.isArray(item.data) ? item.data : null;
  if (!data || !data.length) return { d: day, none: true };
  const seen = new Set(), ex = [];
  data.forEach((x) => { const k = x.exchCode + ':' + x.ticker; if (x.exchCode && x.ticker && !seen.has(k) && ex.length < 16) { seen.add(k); ex.push([String(x.exchCode), String(x.ticker)]); } });
  const usRow = data.find((x) => x.exchCode === 'US') || data.find((x) => FIGI_US.has(x.exchCode));
  const deRow = ['GR', 'GY', 'GF', 'GM'].map((c) => data.find((x) => x.exchCode === c && x.ticker)).find(Boolean);
  return { d: day, de: deRow && /^[A-Z0-9]{1,8}$/i.test(deRow.ticker) ? String(deRow.ticker).toUpperCase() : null, name: String(data[0].name || '').slice(0, 80) || null, type: String(data[0].securityType2 || data[0].securityType || '').slice(0, 40) || null,
    fund: data.some(figiIsFund), us: usRow && usRow.ticker ? String(usRow.ticker).replace('/', '-').toUpperCase() : null, ex };
}
async function figiTask(env) {
  let pe = {}, map = {};
  try { pe = JSON.parse((await getKv(env, 'pos_extra')) || '{}'); } catch (e) { pe = {}; }
  try { map = JSON.parse((await getKv(env, 'figi')) || '{}'); } catch (e) { map = {}; }
  const today = parts(new Date()).day;
  const isins = [...new Set(Object.values(pe).map((x) => x && x.isin).filter((x) => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(String(x || ''))))];
  const todo = isins.filter((i) => figiStale(map[i], today)).sort((a, b) => (map[a] ? 1 : 0) - (map[b] ? 1 : 0));
  let calls = 0;
  if (todo.length && !(await srcDown(env, 'openfigi'))) {
    const batch = todo.slice(0, env.OPENFIGI_KEY ? 100 : 10);
    calls = 1;
    const r = await figiMap(env.OPENFIGI_KEY, batch.map((i) => ({ idType: 'ID_ISIN', idValue: i })));
    if (r.status === 429) { await srcFail(env, 'openfigi', 'OpenFIGI-limiet (per minuut)', true); return calls; }
    if (r.status === 401 || r.status === 403) {
      await srcFail(env, 'openfigi', 'OpenFIGI weigert de sleutel (' + r.status + ')');
      await noteExtError(env, 'openfigi', 'OpenFIGI weigert de sleutel (' + r.status + '); zonder sleutel werkt het ook, alleen trager.');
      return calls;
    }
    if (!r.ok || !Array.isArray(r.body)) { await srcFail(env, 'openfigi', 'OpenFIGI gaf ' + r.status); return calls; }
    await srcOk(env, 'openfigi');
    await noteExtError(env, 'openfigi', null);
    batch.forEach((i, k) => { map[i] = figiRecord(r.body[k], today); });
    // ISIN's die je niet meer hebt, na een half jaar opruimen
    Object.keys(map).forEach((i) => { if (!isins.includes(i) && dayGap(today, map[i].d) > 180) delete map[i]; });
    await setKv(env, 'figi', JSON.stringify(map));
  }
  // Per ticker (en het symbool dat de bronnen gebruiken) de korte vorm voor de rest van de Worker en de site
  const bySym = {};
  Object.entries(pe).forEach(([tk, x]) => {
    const f = x && x.isin && map[x.isin];
    if (!f) return;
    const v = f.none ? { none: true } : { us: f.us, de: f.de || null, fund: !!f.fund, type: f.type, name: f.name, ex: f.ex.map((e) => e[0]).filter((c, k, a) => a.indexOf(c) === k).slice(0, 8) };
    bySym[tk] = v;
    if (SYMBOL_MAP[tk]) bySym[SYMBOL_MAP[tk]] = v;
  });
  await setKv(env, 'figi_sym', JSON.stringify(bySym));
  return calls;
}
// Moet de figi-taak vandaag draaien? (een ISIN zonder regel of met een regel van 30 dagen of ouder)
async function figiDue(env) {
  let pe = {}, map = {};
  try { pe = JSON.parse((await getKv(env, 'pos_extra')) || '{}'); } catch (e) { pe = {}; }
  try { map = JSON.parse((await getKv(env, 'figi')) || '{}'); } catch (e) { map = {}; }
  const today = parts(new Date()).day;
  return Object.values(pe).some((x) => x && x.isin && figiStale(map[x.isin], today));
}
// Opnieuw vragen: geen regel, een regel van 30 dagen of ouder, of een oude regel van voor de Duitse ticker
const figiStale = (f, today) => !f || dayGap(today, f.d) >= FIGI_MAX_AGE_DAYS || (!f.none && !('de' in f));
async function figiSyms(env) {
  if (env._figiSym) return env._figiSym;
  let m = {};
  try { m = JSON.parse((await getKv(env, 'figi_sym')) || '{}'); } catch (e) { m = {}; }
  env._figiSym = m;
  return m;
}
// Amerikaanse ticker voor de Amerikaanse bronnen, of null als het effect (volgens OpenFIGI) niet in de VS noteert.
// Zonder OpenFIGI-gegevens (volglijst, nieuwe positie, schakelaar uit) blijft de oude regel: alleen de vorm van het symbool.
async function usTicker(env, sym) {
  if (!usSym(sym)) return null;
  const f = (await figiSyms(env))[sym];
  if (!f || f.none) return sym;
  return f.us && usSym(f.us) ? f.us : null;
}

// Bedrijfsnaam voor een zoekvraag: uit het profiel (FMP, Finnhub of Polygon), anders uit OpenFIGI
async function nameOf(env, tk, sym) {
  const prof = await env.DB.prepare('SELECT data FROM ext_profile WHERE symbol = ?').bind(sym).first().catch(() => null);
  try { const n = prof && JSON.parse(prof.data).name; if (n) return n; } catch (e) { /* geen profiel */ }
  const f = (await figiSyms(env))[tk] || (await figiSyms(env))[sym];
  return f && f.name ? f.name : null;
}

// ---------- GDELT DOC 2.0: nieuws zonder sleutel, als laatste reserve vóór Alpha Vantage ----------
// GDELT volgt nieuwssites wereldwijd en is vrij te gebruiken; het vraagt hoogstens één verzoek per 5 seconden. De Worker
// doet er daarom hoogstens één per stap. Geen stemming per aandeel: alleen koppen, bron en link.
const GDELT_DOC = 'https://api.gdeltproject.org/api/v2/doc/doc';
// Zoekterm voor een bedrijf: de naam zonder rechtsvorm, als vaste woordgroep (een ticker alleen geeft te veel ruis)
function gdeltName(name) {
  const n = String(name || '').replace(/\([^)]*\)/g, ' ')
    .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|n\.?v|s\.?a|a\.?g|se|holdings?|group|class\s+[a-c]|the|adr|ord|shares?)\b\.?/gi, ' ')
    .replace(/[^\p{L}\p{N}&' .-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return n.length >= 4 ? n.slice(0, 60) : null;
}
const gdeltWhen = (x) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(x || '')); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN; };
// null = niet geprobeerd of mislukt, { busy } = deze stap al een verzoek, anders een lijst (mogelijk leeg)
async function gdeltNews(env, query) {
  if (env._gdelt === false) return null;
  if (env._gdeltN) return { busy: true };
  if (await srcDown(env, 'gdelt')) return null;
  env._gdeltN = 1;
  const res = await fetch(GDELT_DOC + '?query=' + encodeURIComponent(query) + '&mode=ArtList&format=json&maxrecords=50&timespan=10d&sort=DateDesc', { headers: { Accept: 'application/json' } });
  const txt = await res.text().catch(() => '');
  if (res.status === 429 || /limit requests|one every \d+ seconds/i.test(txt.slice(0, 300))) { await srcFail(env, 'gdelt', 'GDELT: te veel verzoeken', true); return null; }
  if (!res.ok) { await srcFail(env, 'gdelt', 'GDELT gaf ' + res.status); return null; }
  let b = null;
  try { b = JSON.parse(txt || '{}'); } catch (e) { await srcFail(env, 'gdelt', 'GDELT: ' + txt.replace(/\s+/g, ' ').slice(0, 100)); return null; }
  await srcOk(env, 'gdelt');
  await noteExtError(env, 'gdelt', null);
  return (Array.isArray(b && b.articles) ? b.articles : []).map((a) => ({ t: gdeltWhen(a.seendate), headline: String(a.title || '').slice(0, 220), summary: '',
    source: String(a.domain || '').slice(0, 60), url: a.url || '', related: '', tone: null }))
    .filter((x) => isFinite(x.t) && x.headline && /^https:\/\//.test(x.url)).sort((a, c) => c.t - a.t);
}

// Branche (SIC-code van de SEC) naar de sectornamen die de site gebruikt; grof, alleen voor de reserve
function sicSector(code) {
  const c = Number(code);
  if (!c) return null;
  const inR = (a, b) => c >= a && c <= b;
  if (inR(1311, 1389) || inR(2900, 2999)) return 'Energy';
  if (inR(2830, 2836) || inR(3841, 3851) || inR(8000, 8099)) return 'Healthcare';
  if (inR(3570, 3579) || inR(3600, 3699) || inR(7370, 7379)) return 'Technology';
  if (inR(4800, 4899) || inR(2710, 2799) || inR(7810, 7819)) return 'Communication Services';
  if (inR(4900, 4999)) return 'Utilities';
  if (inR(6500, 6553) || c === 6798) return 'Real Estate';
  if (inR(6000, 6799)) return 'Financial Services';
  if (inR(2000, 2199) || inR(5400, 5499)) return 'Consumer Defensive';
  if (inR(2200, 2399) || inR(3710, 3716) || inR(5200, 5999) || inR(7000, 7099)) return 'Consumer Cyclical';
  if (inR(1000, 1299) || inR(1400, 1499) || inR(2800, 2899) || inR(3300, 3399)) return 'Basic Materials';
  if (inR(1500, 1799) || inR(3400, 3569) || inR(3720, 3729) || inR(3810, 3829) || inR(4000, 4799) || inR(5000, 5199)) return 'Industrials';
  return null;
}
// Profiel in dezelfde vorm als bij FMP, uit Polygon (ticker overview); zonder koers, beta en jaarbereik
async function profileFromPolygon(env, sym) {
  const us = env.POLYGON_KEY ? await usTicker(env, sym) : null;
  if (!us || (await srcDown(env, 'polygon'))) return null;
  const r = await polyGet(env, '/v3/reference/tickers/' + encodeURIComponent(polySym(us)));
  const p = r.body && r.body.results;
  if (!p || !p.name) return r.busy ? { busy: true } : null;
  return {
    symbol: sym, name: p.name, price: null, currency: String(p.currency_name || 'usd').toUpperCase(), marketCap: numOrNull(p.market_cap),
    beta: null, lastDividend: null, range: null, change: null, sector: sicSector(p.sic_code), industry: p.sic_description || null,
    exchange: p.primary_exchange || null, country: p.locale === 'us' ? 'US' : null, employees: numOrNull(p.total_employees), ipoDate: p.list_date || null,
    isEtf: p.type === 'ETF', website: p.homepage_url || null, cik: p.cik || null, source: 'Polygon',
  };
}

// ---------- SEC: kwartaalwinst per aandeel en insiderhandel (Form 4), zonder sleutel ----------
async function secCikOf(env, sym) {
  let ciks = {};
  try { ciks = JSON.parse((await getKv(env, 'sec_cik')) || '{}'); } catch (e) { ciks = {}; }
  if (ciks[sym]) return String(ciks[sym]).padStart(10, '0');
  let list = [];
  try { list = JSON.parse((await getKv(env, 'companies')) || '[]'); } catch (e) { list = []; }
  const alt = sym.replace('-', '.');
  const hit = list.find((x) => x[0] === sym || x[0] === alt);
  return hit && hit[2] ? String(hit[2]).padStart(10, '0') : null;
}
// Kwartaalcijfers (verwaterde winst per aandeel) uit de XBRL-gegevens: alleen werkelijk, geen verwachting
function quarterlyEps(concept) {
  const u = concept && concept.units && (concept.units['USD/shares'] || Object.values(concept.units)[0]);
  if (!Array.isArray(u)) return null;
  const by = new Map();
  u.forEach((x) => { if (/^CY\d{4}Q[1-4]$/.test(x.frame || '') && isFinite(Number(x.val)) && x.end) by.set(x.frame, { period: x.end, actual: Number(x.val), estimate: null, pct: null }); });
  const rows = [...by.values()].sort((a, c) => c.period.localeCompare(a.period)).slice(0, 4);
  return rows.length ? rows : null;
}
// Waarde binnen een element van een Form 4 (<tag> ... <value>x</value> ... </tag>)
const f4Val = (block, tag) => {
  const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'i').exec(block);
  const v = m && /<value>([^<]*)<\/value>/i.exec(m[1]);
  return v ? v[1].trim() : '';
};
function parseForm4(txt) {
  const name = xmlTag(txt, 'rptOwnerName');
  return (txt.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/gi) || []).map((b) => {
    const sh = numOrNull(f4Val(b, 'transactionShares')), d = f4Val(b, 'transactionAcquiredDisposedCode') === 'D';
    return { name, date: f4Val(b, 'transactionDate').slice(0, 10), code: xmlTag(b, 'transactionCode') || null,
      change: sh == null ? null : d ? -sh : sh, price: numOrNull(f4Val(b, 'transactionPricePerShare')), shares: numOrNull(f4Val(b, 'sharesOwnedFollowingTransaction')) };
  }).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date));
}
const SEC_FORM4_MAX = 6;
// Insidertransacties van de laatste 6 maanden uit de Form 4-meldingen (hoogstens 6 meldingen per keer)
async function secInsider(env, cik) {
  const H = { 'User-Agent': 'investment-tracker (' + env.SEC_CONTACT + ')', Accept: 'application/json' };
  let calls = 1;
  const sub = await getJson('https://data.sec.gov/submissions/CIK' + cik + '.json', H);
  if (sub.status === 403) throw new Error('SEC weigerde (403); controleer het contactadres');
  const f = sub.ok && sub.body && sub.body.filings && sub.body.filings.recent;
  if (!f || !Array.isArray(f.form)) return { calls, list: null };
  const from = ymdUTC(Date.now() - 180 * 864e5);
  const idx = [];
  for (let i = 0; i < f.form.length && idx.length < SEC_FORM4_MAX; i++) if (f.form[i] === '4' && (f.filingDate[i] || '') >= from) idx.push(i);
  const list = [];
  for (const i of idx) {
    const doc = String((f.primaryDocument && f.primaryDocument[i]) || '').replace(/^xsl[^/]*\//i, '');
    if (!/\.xml$/i.test(doc)) continue;
    calls++;
    const res = await fetch('https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + String(f.accessionNumber[i]).replace(/-/g, '') + '/' + doc, { headers: { 'User-Agent': H['User-Agent'] } });
    if (!res.ok) continue;
    list.push(...parseForm4(await res.text()));
  }
  return { calls, list: list.filter((x) => x.date >= from).sort((a, c) => c.date.localeCompare(a.date)).slice(0, 25) };
}

// ---------- Aanvulling voor Finnhub zonder Alpha Vantage ----------
// Eerst de bronnen met ruime limieten: nieuws en stemming via Polygon of Marketaux, kwartaalwinst en insiderhandel
// uit de SEC-meldingen, analisten en koersdoel via FMP (hoogstens één keer per week per aandeel). Wat daarna
// nog ontbreekt, vult de av-taak aan binnen het kleine dagbudget van Alpha Vantage.
// env._gdelt zet de planning en de marktstap uit de schakelaar 'gdelt' (GDELT heeft geen sleutel)
const altKeys = (env) => !!(env.POLYGON_KEY || env.MARKETAUX_KEY || env.SEC_CONTACT || env.FMP_KEY || env._gdelt);
const OPINION_EVERY_DAYS = 7;
// Vandaag al door een andere reserve gevuld: Alpha Vantage hoeft dit onderdeel niet meer
const altFresh = (prev, k) => !!(prev.src && prev.src[k] && prev.src[k] !== 'av' && (prev.altAt || '').slice(0, 10) === isoLocal(Date.now()).slice(0, 10));

async function altTask(env, tk) {
  const sym = SYMBOL_MAP[tk] || tk;
  let prev = {};
  try { prev = JSON.parse((await getKv(env, 'rs_' + tk)) || '{}'); } catch (e) { prev = {}; }
  const fhOn = !!env.FINNHUB_KEY && !(await srcDown(env, 'finnhub'));
  const need = avNeeds(prev, fhOn).filter((k) => !altFresh(prev, k));
  if (!need.length) return 0;
  const out = Object.assign({}, prev, { symbol: sym });
  const src = Object.assign({}, prev.src || {});
  const got = new Set();
  const set = (k, v, s) => { if (v != null && need.includes(k)) { out[k] = v; src[k] = s; got.add(k); } };
  let calls = 0;
  // Nieuws en stemming: Polygon (geeft per bericht de stemming over dit aandeel), anders Marketaux
  if (need.includes('news') || need.includes('sent')) {
    let items = null, from = null;
    const usSymNow = await usTicker(env, sym);
    if (env.POLYGON_KEY && usSymNow && !(await srcDown(env, 'polygon'))) {
      const r = await polyGet(env, '/v2/reference/news?ticker=' + encodeURIComponent(polySym(usSymNow)) + '&published_utc.gte=' + ymdUTC(Date.now() - 10 * 864e5) + '&order=desc&sort=published_utc&limit=50');
      // Stap vol: liever later via Polygon dan nu het kleine budget van Marketaux gebruiken
      if (r.busy) throw new Error('Polygon: stap vol');
      calls++;
      if (r.body && Array.isArray(r.body.results)) { items = polyNewsItems(r.body.results, polySym(usSymNow)); from = 'polygon'; }
    }
    if (!items && env.MARKETAUX_KEY) {
      const list = await mxNews(env, usSymNow || sym);
      if (list) { calls++; items = list; from = 'marketaux'; }
    }
    // GDELT (geen sleutel): zoeken op de bedrijfsnaam; geeft geen stemming, dus alleen het nieuws
    if (!items && need.includes('news') && env._gdelt) {
      const q = gdeltName(await nameOf(env, tk, sym));
      if (q) {
        const list = await gdeltNews(env, '"' + q + '" (sourcelang:english OR sourcelang:dutch)');
        // Stap vol en nog niets anders geprobeerd: liever in een volgende stap dan Alpha Vantage laten invallen
        if (list && list.busy) { if (!calls) throw new Error('GDELT: stap vol'); }
        else if (list) { calls++; items = list; from = 'gdelt'; }
      }
    }
    if (items) {
      set('news', items.filter((x) => x.t >= Date.now() - 10 * 864e5).slice(0, 6).map((x) => ({ t: x.t, headline: x.headline, source: x.source, url: x.url })), from);
      const week = items.filter((x) => x.t >= Date.now() - 7 * 864e5);
      const pos = week.filter((x) => x.tone === 1).length, neg = week.filter((x) => x.tone === -1).length;
      if (pos + neg && from !== 'gdelt') set('sent', { bull: pos / (pos + neg), bear: neg / (pos + neg), score: null, sector: null, articles: week.length, buzz: null }, from);
      try { await storeNews(env, tk, items.map((x) => ({ headline: x.headline, url: x.url, datetime: Math.floor(x.t / 1000), source: x.source, summary: x.summary })), 100); } catch (e) { console.error('nieuwsarchief', e); }
    }
  }
  // Kwartaalwinst en insiderhandel uit de SEC-meldingen (alleen bedrijven die bij de SEC rapporteren)
  const secSym = (need.includes('eps') || need.includes('insider')) && env.SEC_CONTACT ? await usTicker(env, sym) : null;
  if (secSym) {
    const cik = (await secCikOf(env, sym)) || (secSym !== sym ? await secCikOf(env, secSym) : null);
    if (cik) {
      if (need.includes('eps')) {
        calls++;
        const r = await getJson('https://data.sec.gov/api/xbrl/companyconcept/CIK' + cik + '/us-gaap/EarningsPerShareDiluted.json', { 'User-Agent': 'investment-tracker (' + env.SEC_CONTACT + ')', Accept: 'application/json' });
        if (r.status === 403) throw new Error('SEC weigerde (403); controleer het contactadres');
        if (r.ok) set('eps', quarterlyEps(r.body), 'sec');
      }
      if (need.includes('insider')) {
        const r = await secInsider(env, cik);
        calls += r.calls;
        if (r.list) {
          set('insider', r.list, 'sec');
          try { await alertInsider(env, tk, prev.insider, r.list); } catch (e) { console.error('meldingen', e); }
        }
      }
    }
  }
  // Analisten en koersdoel via FMP, als het abonnement dat geeft (anders onthouden en niet meer vragen)
  const opinionOld = !prev.fmpOpAt || dayGap(isoLocal(Date.now()), prev.fmpOpAt) >= OPINION_EVERY_DAYS;
  if ((need.includes('rec') || need.includes('target')) && env.FMP_KEY && opinionOld && !(await srcDown(env, 'fmp')) && (await getKv(env, 'fmp_opinion_denied')) !== '1') {
    try {
      const today = isoLocal(Date.now()).slice(0, 10);
      if (need.includes('rec')) {
        calls++;
        const g = (await fmp(env, '/grades-consensus?symbol=' + encodeURIComponent(sym)))[0];
        const rec = g ? { period: today.slice(0, 7) + '-01', sb: numOrNull(g.strongBuy), b: numOrNull(g.buy), h: numOrNull(g.hold), s: numOrNull(g.sell), ss: numOrNull(g.strongSell) } : null;
        if (rec && [rec.sb, rec.b, rec.h, rec.s, rec.ss].some((x) => x)) {
          const hist = (src.rec === 'fmp' && Array.isArray(prev.rec) ? prev.rec : []).filter((r) => r.period !== rec.period);
          set('rec', [rec].concat(hist).slice(0, 6), 'fmp');
        }
      }
      if (need.includes('target')) {
        calls++;
        const t = (await fmp(env, '/price-target-consensus?symbol=' + encodeURIComponent(sym)))[0];
        if (t && numOrNull(t.targetConsensus) > 0) set('target', { mean: numOrNull(t.targetConsensus), median: numOrNull(t.targetMedian), high: numOrNull(t.targetHigh), low: numOrNull(t.targetLow), updated: today }, 'fmp');
      }
      out.fmpOpAt = today;
    } catch (e) {
      if (/402|403/.test(e.message)) await setKv(env, 'fmp_opinion_denied', '1');
      else if (!/limiet/.test(e.message)) throw e;
    }
  }
  if (!calls) return 0;
  out.src = src;
  out.altAt = isoLocal(Date.now());
  if (!prev.updated) out.updated = out.altAt;
  noteOpinionDay(prev, out, ymdUTC(Date.now()));
  await setKv(env, 'rs_' + tk, JSON.stringify(out));
  if (got.size && env.FINNHUB_KEY && !fhOn) {
    const names = { polygon: 'Polygon', marketaux: 'Marketaux', sec: 'SEC', fmp: 'FMP', gdelt: 'GDELT' };
    await srcBackup(env, 'finnhub', [...new Set([...got].map((k) => names[src[k]]))].join(', ') + ' (nieuws en analisten)');
  }
  return calls;
}

// Koershistorie als FMP niets geeft: Twelve Data, Tiingo, Polygon en als laatste Alpha Vantage.
// st houdt per stap bij hoeveel er al gebruikt is. Geeft { rows, src }, { wait: true } (later opnieuw) of { none: true }.
async function eodBackup(env, sym, st) {
  let busy = false;
  if (env.TWELVEDATA_KEY && !(await srcDown(env, 'twelvedata'))) {
    if (st.td < 6) {
      st.td++; st.calls++;
      let rows = null;
      try { rows = await twelveDaily(env, sym); } catch (e) { rows = null; }
      if (rows && rows.length) return { rows, src: 'Twelve Data' };
    } else busy = true;
  }
  if (env.TIINGO_KEY) {
    const rows = await tiingoDaily(env, sym);
    if (rows) st.calls++;
    if (rows && rows.length) return { rows, src: 'Tiingo' };
  }
  if (env.POLYGON_KEY) {
    const rows = await polyDaily(env, sym);
    if (rows && rows.busy) busy = true;
    else if (rows) { st.calls++; if (rows.length) return { rows, src: 'Polygon' }; }
  }
  if (env.ALPHAVANTAGE_KEY) {
    if (!st.av && (await avCount(env, 0)) > 4) {
      st.av = true; st.calls++;
      const rows = await avDaily(env, sym);
      if (rows && rows.length) return { rows, src: 'Alpha Vantage' };
    } else busy = true;
  }
  return busy ? { wait: true } : { none: true };
}
const eodBackupKeys = (env) => !!(env.TWELVEDATA_KEY || env.TIINGO_KEY || env.POLYGON_KEY || env.ALPHAVANTAGE_KEY);

// ---------- Nieuwsarchief: berichten per aandeel bewaren en een jaar terug aanvullen (Finnhub) ----------
const NEWS_KEEP_DAYS = 400;
async function ensureNewsTable(env) {
  if ((await getKv(env, 'news_schema')) === '1') return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS news_hist (tk TEXT NOT NULL, t INTEGER NOT NULL, headline TEXT NOT NULL, source TEXT, url TEXT NOT NULL, summary TEXT, PRIMARY KEY (tk, url))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS news_hist_t ON news_hist (t)'),
  ]);
  await setKv(env, 'news_schema', '1');
}
// Hoogstens `cap` berichten, gelijkmatig over de periode verdeeld (drukke aandelen hebben honderden berichten per maand)
function newsRows(list, cap) {
  const ok = (Array.isArray(list) ? list : []).filter((n) => n && n.headline && /^https:\/\//.test(n.url || '') && n.datetime).sort((a, c) => c.datetime - a.datetime);
  if (ok.length <= cap) return ok;
  const out = [];
  const step = ok.length / cap;
  for (let i = 0; i < cap; i++) out.push(ok[Math.floor(i * step)]);
  return out;
}
async function storeNews(env, tk, list, cap) {
  const rows = newsRows(list, cap || 150);
  if (!rows.length) return 0;
  await ensureNewsTable(env);
  const st = env.DB.prepare('INSERT OR IGNORE INTO news_hist (tk, t, headline, source, url, summary) VALUES (?,?,?,?,?,?)');
  for (let i = 0; i < rows.length; i += 50) {
    await env.DB.batch(rows.slice(i, i + 50).map((n) => st.bind(tk, n.datetime * 1000, String(n.headline).slice(0, 220), String(n.source || '').slice(0, 60), String(n.url).slice(0, 500), String(n.summary || '').slice(0, 300))));
  }
  return rows.length;
}
// Eén maand ouder nieuws voor één aandeel; na een jaar is dat aandeel klaar
async function newsHistTask(env, tk) {
  if (!env.FINNHUB_KEY) return 0;
  let cur = {};
  try { cur = JSON.parse((await getKv(env, 'news_hist_cur')) || '{}'); } catch (e) { cur = {}; }
  if (cur[tk] === 'klaar') return 0;
  // Twee keer dezelfde taak kan geen dubbele berichten geven (INSERT OR IGNORE op tk + url) en de teller
  // loopt alleen verder terug in de tijd, tot een jaar; daarna doet de taak niets meer (idee 155).
  const to = cur[tk] || ymdUTC(Date.now() - 9 * 864e5);
  const fromMs = Date.parse(to + 'T00:00:00Z') - 30 * 864e5;
  const from = ymdUTC(fromMs);
  const sym = SYMBOL_MAP[tk] || tk;
  const r = await getJson(FINNHUB_BASE + '/company-news?symbol=' + encodeURIComponent(sym) + '&from=' + from + '&to=' + to + '&token=' + encodeURIComponent(env.FINNHUB_KEY));
  if (r.status === 429) throw new Error('Finnhub-limiet bereikt');
  if (r.status === 401 || r.status === 403) { cur[tk] = 'klaar'; await setKv(env, 'news_hist_cur', JSON.stringify(cur)); return 1; }
  if (!r.ok) return 1;
  await storeNews(env, tk, r.body, 150);
  cur[tk] = fromMs < Date.now() - 365 * 864e5 ? 'klaar' : from;
  await setKv(env, 'news_hist_cur', JSON.stringify(cur));
  return 1;
}
// Ouder nieuws voor de site: per aandeel of alles, nieuwste eerst, in blokken
async function newsArchive(env, q) {
  await ensureNewsTable(env);
  const before = Number(q.get('before')) || Date.now() + 864e5;
  const limit = Math.max(1, Math.min(100, Number(q.get('limit')) || 40));
  const tk = String(q.get('tk') || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 15);
  const sql = 'SELECT tk, t, headline, source, url, summary FROM news_hist WHERE t < ?' + (tk ? ' AND tk = ?' : '') + ' ORDER BY t DESC LIMIT ?';
  const { results } = await (tk ? env.DB.prepare(sql).bind(before, tk, limit + 1) : env.DB.prepare(sql).bind(before, limit + 1)).all();
  let cur = {};
  try { cur = JSON.parse((await getKv(env, 'news_hist_cur')) || '{}'); } catch (e) { cur = {}; }
  const busy = Object.values(cur).some((v) => v !== 'klaar');
  return { items: results.slice(0, limit), more: results.length > limit, filling: busy };
}

// Mening van analisten door de tijd: alleen een regel als aantallen of koersdoel veranderen, zodat de lijst klein blijft.
// Regel: [dag, sterk kopen, kopen, aanhouden, verkopen, sterk verkopen, gemiddeld koersdoel]; de stand op een dag is de laatste regel ervoor.
function noteOpinionDay(prev, out, day) {
  const r = Array.isArray(out.rec) && out.rec[0] ? out.rec[0] : null;
  const t = out.target && isFinite(Number(out.target.mean)) && Number(out.target.mean) > 0 ? Number(out.target.mean) : null;
  const h = (Array.isArray(prev.recHist) ? prev.recHist : []).filter((x) => Array.isArray(x) && x[0] < day);
  if (!r && t == null) { if (h.length) out.recHist = h; return; }
  const row = [day, r ? r.sb : null, r ? r.b : null, r ? r.h : null, r ? r.s : null, r ? r.ss : null, t];
  const last = h[h.length - 1];
  if (!last || row.slice(1).some((v, i) => v !== last[i + 1])) h.push(row);
  out.recHist = h.slice(-80);
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
      out.news = (Array.isArray(b) ? b : []).filter((n) => n.headline && /^https:\/\//.test(String(n.url || ''))).sort((a, c) => c.datetime - a.datetime).slice(0, 6)
        .map((n) => ({ t: n.datetime * 1000, headline: String(n.headline).slice(0, 220), source: n.source || '', url: n.url }));
      // Alles bewaren in het archief, niet alleen de nieuwste zes
      try { await storeNews(env, tk, b, 100); } catch (e) { console.error('nieuwsarchief', e); }
      try { await flashFromList(env, tk, b, Date.now()); } catch (e) { console.error('nieuwslijst', e); }
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
  noteOpinionDay(prev, out, today);
  try { await alertRatings(env, tk, out); } catch (e) { console.error('meldingen', e); }
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
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ext_prices_day ON ext_prices (day)'),
  ]);
  await setKv(env, 'market_schema', '1');
}

// Laatste afgesloten Amerikaanse handelsdag (feestdagen niet meegerekend); zie usTradingDay
function lastUsDay(now) {
  return usTradingDay(now.getTime());
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

// Laatste regel per positie (idee 45). Een meting schrijft alleen wat veranderde, maar de eerste meting van elk uur
// schrijft alles: elke positie staat dus in het uur van de laatste meting. Een positie die dit uur verkocht is, telt
// tot het volgende uur nog mee. Met before: de laatste meting vóór dat tijdstip.
async function lastRows(env, before) {
  const last = before ? await env.DB.prepare('SELECT MAX(ts) AS ts FROM intraday WHERE ts < ?').bind(before).first()
    : await env.DB.prepare('SELECT MAX(ts) AS ts FROM intraday').first();
  if (!last || !last.ts) return null;
  const { results } = await env.DB.prepare('SELECT ts, ticker, name, value, qty FROM intraday WHERE ts >= ? AND ts <= ? AND ticker != ? ORDER BY ts')
    .bind(hourStart(last.ts), last.ts, TOTAL).all();
  const m = new Map();
  results.forEach((r) => m.set(r.ticker, r));
  return [...m.values()];
}

async function heldStocks(env) {
  let results = await lastRows(env);
  if (!results) {
    ({ results } = await env.DB.prepare('SELECT ticker, name FROM positions WHERE date = (SELECT MAX(date) FROM positions)').all());
  }
  // Fondsen overslaan: op naam, en volgens OpenFIGI (ETF of ETP) als die het weet
  const fs = await figiSyms(env);
  return results.filter((r) => !ETF_RE.test(r.name || '') && !(fs[r.ticker] && fs[r.ticker].fund)).map((r) => ({ ticker: r.ticker, symbol: SYMBOL_MAP[r.ticker] || r.ticker }));
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

// ---------- Slimmer plannen (idee 146) ----------
// Aandelen die je bezit krijgen elke ronde onderzoek; de volglijst hoogstens één keer per twee dagen,
// want die kost hetzelfde budget zonder dat er een positie aan hangt. Rond kwartaalcijfers (van twee dagen
// ervoor tot vijf dagen erna) gaat een aandeel vooraan in de rij, ook als het op de volglijst staat.
const WATCH_EVERY_DAYS = 2;
// Hoeveel aandelen er op de volglijst mogen. Elk aandeel krijgt hoogstens eens per twee dagen onderzoek en een
// dagkoers; bij een vol dagbudget (FMP) schuift de rij gewoon door naar de volgende dag.
const WATCH_MAX = 100;
const EARN_BEFORE = 5, EARN_AFTER = 2;
const dayGap = (a, b) => Math.round((Date.parse(String(a).slice(0, 10) + 'T12:00:00Z') - Date.parse(String(b).slice(0, 10) + 'T12:00:00Z')) / 864e5);
function planResearch(held, watch, rsMap, events, today) {
  const near = new Set();
  const ok = (d) => /^\d{4}-\d{2}-\d{2}/.test(String(d || ''));
  ((events && events.earnings) || []).forEach((e) => {
    if (!ok(e.date)) return;
    const g = dayGap(e.date, today);
    if (g >= 0 && g <= EARN_BEFORE) near.add(e.ticker);
  });
  ((events && events.lastEarnings) || []).forEach((e) => {
    if (!ok(e.date)) return;
    const g = dayGap(today, e.date);
    if (g >= 0 && g <= EARN_AFTER) near.add(e.ticker);
  });
  const age = (tk) => {
    const u = ((rsMap && rsMap.get(tk)) || {}).updated || '';
    return u ? Math.max(0, dayGap(today, u)) : 99;
  };
  const first = [], rest = [], skipped = [];
  held.forEach((h) => (near.has(h.ticker) ? first : rest).push(h.ticker));
  (watch || []).forEach((w) => {
    if (near.has(w.ticker)) first.push(w.ticker);
    else if (age(w.ticker) >= WATCH_EVERY_DAYS) rest.push(w.ticker);
    else skipped.push(w.ticker);
  });
  return { order: [...new Set(first.concat(rest))], near: [...near], skipped };
}

// Dezelfde taak hoeft nooit twee keer in de rij te staan (idee 155)
const uniqTasks = (list) => [...new Set(list)];

// Zet de taken voor vandaag klaar (1x per dag na de agenda, of handmatig)
async function planMarket(env) {
  // Telt de hele koerstabel: hooguit één keer per planning
  let pcCache = null;
  const priceCounts = async () => {
    if (!pcCache) pcCache = await env.DB.prepare('SELECT symbol, COUNT(*) AS n FROM ext_prices GROUP BY symbol').all();
    return pcCache;
  };
  await ensureMarketTables(env);
  const now = new Date();
  const usDay = lastUsDay(now);
  const held = await heldStocks(env);
  const watch = (await extraStocks(env)).filter((w) => !held.some((h) => h.symbol === w.symbol));
  const all = held.concat(watch);
  const tasks = [];
  const flags = await featureFlags(env);
  env._gdelt = !!flags.gdelt;
  // Eerst welk beurssymbool bij elke ISIN hoort (OpenFIGI), zodat de bronnen hierna het juiste effect krijgen
  if (flags.openfigi && (await figiDue(env))) tasks.push('figi');
  // Bronnen zonder sleutel eerst: wisselkoersen, inflatie en indexen (1x per dag, klein)
  if (flags.fx) tasks.push('fx');
  if (flags.inflation) tasks.push('hicp');
  if (flags.indices) tasks.push('idx');
  // Onderzoek: wat je bezit elke ronde, de volglijst minder vaak, en alles rond kwartaalcijfers vooraan (idee 146)
  let rsMap = new Map();
  try {
    const { results: rs } = await env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'rs\\_%' ESCAPE '\\'").all();
    rsMap = new Map(rs.map((r) => { try { return [r.key.slice(3), JSON.parse(r.value)]; } catch (e) { return [r.key.slice(3), {}]; } }));
  } catch (e) { rsMap = new Map(); }
  let evts = null;
  try { evts = JSON.parse((await getKv(env, 'events')) || 'null'); } catch (e) { evts = null; }
  const research = planResearch(held, watch, rsMap, evts, parts(now).day);
  // Marktnieuws: met Finnhub, en anders via de reserves (Polygon, Marketaux, Alpha Vantage) (idee 153)
  if (env.FINNHUB_KEY || env.POLYGON_KEY || env.MARKETAUX_KEY || env._gdelt || env.ALPHAVANTAGE_KEY) tasks.push('fhnews');
  if (env.FINNHUB_KEY) {
    research.order.forEach((tk) => tasks.push('fh:' + tk));
    // Nieuwsarchief: per ronde voor hoogstens 12 aandelen een maand ouder nieuws, tot een jaar terug; oude berichten opruimen
    let cur = {};
    try { cur = JSON.parse((await getKv(env, 'news_hist_cur')) || '{}'); } catch (e) { cur = {}; }
    all.filter((h) => cur[h.ticker] !== 'klaar').slice(0, 12).forEach((h) => tasks.push('fhhist:' + h.ticker));
    if ((await getKv(env, 'news_schema')) === '1') await env.DB.prepare('DELETE FROM news_hist WHERE t < ?').bind(Date.now() - NEWS_KEEP_DAYS * 864e5).run();
  }
  if (altKeys(env)) {
    // Reserve met ruime limieten (Polygon, Marketaux, SEC, FMP): aandelen waar Finnhub iets mist, langst niet aangevuld eerst
    const today = parts(now).day;
    all.filter((h) => research.order.includes(h.ticker)).map((h) => ({ tk: h.ticker, prev: rsMap.get(h.ticker) || {} }))
      .filter((x) => (x.prev.altAt || '').slice(0, 10) < today && avNeeds(x.prev, !!env.FINNHUB_KEY).length)
      .sort((a, b) => (a.prev.altAt || '').localeCompare(b.prev.altAt || ''))
      .forEach((x) => tasks.push('alt:' + x.tk));
  }
  if (env.ALPHAVANTAGE_KEY) {
    // Laatste reserve: Alpha Vantage, voor wat de andere bronnen niet gaven; het dagbudget bepaalt hoeveel er lukken
    const today = parts(now).day;
    all.filter((h) => research.order.includes(h.ticker)).map((h) => ({ tk: h.ticker, prev: rsMap.get(h.ticker) || {} }))
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
  if (flags.trading && env.T212_KEY && env.T212_SECRET) {
    let ins = null;
    try { ins = JSON.parse((await getKv(env, 'instruments')) || 'null'); } catch (e) { ins = null; }
    if (!ins || (ins.updated || '') < new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)) tasks.push('instr');
  }
  if (eodBackupKeys(env)) {
    // Symbolen waarvoor FMP geen koershistorie geeft (gratis abonnement): via Twelve Data, Tiingo, Polygon of Alpha Vantage
    await ensureMarketTables(env);
    const nh = JSON.parse((await getKv(env, 'eod_unavailable')) || '[]');
    const { results: hn2 } = await priceCounts();
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
    // Zonder FMP: profielen (koers, branche, beta) via Finnhub of Polygon en koersgeschiedenis via de reserves, als die sleutels er zijn
    if (env.FINNHUB_KEY || env.POLYGON_KEY || eodBackupKeys(env)) {
      await ensureMarketTables(env);
      const { results: fr } = await env.DB.prepare('SELECT symbol FROM ext_profile WHERE updated = ?').bind(usDay).all();
      const freshP = new Set(fr.map((r) => r.symbol));
      const { results: hn } = await priceCounts();
      const nMap = new Map(hn.map((r) => [r.symbol, r.n]));
      all.forEach((h) => {
        if ((env.FINNHUB_KEY || env.POLYGON_KEY) && !freshP.has(h.symbol)) tasks.push('profile:' + h.symbol);
        if (eodBackupKeys(env) && (nMap.get(h.symbol) || 0) < 20) tasks.push('eod:' + h.symbol);
      });
    }
    const q1 = uniqTasks(tasks);
    await setKv(env, 'mkt_queue', JSON.stringify(q1));
    await setKv(env, 'mkt_planned', usDay);
    await bumpMarket(env);
    return `Extern: ${q1.length} taken klaargezet (zonder FMP).`;
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
  const { results: hist } = await priceCounts();
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
  const queue = uniqTasks(tasks);
  await setKv(env, 'mkt_queue', JSON.stringify(queue));
  await setKv(env, 'mkt_planned', usDay);
  return `Markt: ${queue.length} taken klaargezet.`;
}

async function marketStep(env) {
  let queue = [];
  try { queue = JSON.parse((await getKv(env, 'mkt_queue')) || '[]'); } catch (e) { queue = []; }
  if (!queue.length) return 'Markt: niets te doen.';
  await ensureMarketTables(env);
  const usDay = lastUsDay(new Date());
  let calls = 0, done = 0, stop = false;
  const writes = [];
  const pxDirty = new Set();   // symbolen met nieuwe koersen (zie bumpMarket)
  const errors = [];
  const noHist = JSON.parse((await getKv(env, 'eod_unavailable')) || '[]');
  const deferred = [];
  // Per stap: hoeveel de reserves voor koershistorie al deden (Twelve Data hoogstens 6, Alpha Vantage één aandeel)
  const bst = { td: 0, calls: 0, av: false };
  let unknown = [];
  try { unknown = JSON.parse((await getKv(env, 'mkt_unknown')) || '[]'); } catch (e) { unknown = []; }
  // FMP aan zijn limiet of stuk: profielen via Finnhub of Polygon, koersgeschiedenis via de reserves, de rest later
  let fmpDown = !!env.FMP_KEY && (await srcDown(env, 'fmp'));
  env._gdelt = !!(await featureFlags(env)).gdelt;
  const putProfile = (sym, keep) => {
    writes.push(env.DB.prepare('INSERT OR REPLACE INTO ext_profile (symbol, data, updated) VALUES (?,?,?)').bind(sym, JSON.stringify(keep), usDay));
    const pn = parts(new Date());
    const inSession = pn.weekday <= 5 && pn.hm >= '15:30' && pn.hm < '22:30';
    if (keep.price != null && !inSession) { writes.push(env.DB.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)').bind(sym, usDay, keep.price)); pxDirty.add(sym); }
  };
  // Profiel als FMP niets geeft: Finnhub (3 verzoeken), anders Polygon (1 verzoek, zonder koers en beta)
  const backupProfile = async (sym) => {
    let keep = null;
    if (env.FINNHUB_KEY && !(await srcDown(env, 'finnhub'))) {
      calls += 3;
      try { keep = await profileFromFinnhub(env, sym); } catch (e) { if (!/limiet/.test(e.message) || !env.POLYGON_KEY) throw e; keep = null; }
      if (keep) { putProfile(sym, keep); await srcBackup(env, 'fmp', 'Finnhub'); return keep; }
    }
    if (env.POLYGON_KEY) {
      keep = await profileFromPolygon(env, sym);
      if (keep && keep.busy) return { busy: true };
      if (keep) { calls++; putProfile(sym, keep); await srcBackup(env, 'fmp', 'Polygon (profiel)'); }
    }
    return keep;
  };
  const putRows = (sym, rows) => {
    const st = env.DB.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)');
    rows.forEach(([d, v]) => writes.push(st.bind(sym, d, v)));
    if (rows.length) pxDirty.add(sym);
  };
  // Reserve-taken voor het onderzoek van één aandeel, in volgorde: eerst de ruime bronnen, dan Alpha Vantage
  const backupResearch = (tk) => [altKeys(env) ? 'alt:' + tk : null, env.ALPHAVANTAGE_KEY ? 'av:' + tk : null].filter(Boolean);
  while (queue.length && calls < MARKET_STEP_CALLS && !stop) {
    const task = queue.shift();
    // Alpha Vantage staat 5 verzoeken per minuut toe: één aandeel per stap
    if (task.startsWith('av:') && bst.av) { deferred.push(task); continue; }
    if (task.startsWith('av:')) bst.av = true;
    const ci = task.indexOf(':');
    const kind = ci < 0 ? task : task.slice(0, ci), arg = ci < 0 ? '' : task.slice(ci + 1);
    try {
      if (kind === 'fx' || kind === 'hicp' || kind === 'idx' || kind === 'fh' || kind === 'fhhist' || kind === 'fhnews' || kind === 'sec' || kind === 'av' || kind === 'alt' || kind === 'companies' || kind === 'filings' || kind === 'f13' || kind === 'econ' || kind === 'pies' || kind === 'instr' || kind === 'figi') {
        calls += await externalTask(env, kind, arg);
      } else if (kind === 'eod2' || (kind === 'eod' && (!env.FMP_KEY || fmpDown))) {
        // Reserve voor koershistorie: Twelve Data (hoogstens 6 per stap), Tiingo, Polygon, en als laatste Alpha Vantage
        const before = bst.calls;
        const r = await eodBackup(env, arg, bst);
        calls += bst.calls - before;
        if (r.rows) { putRows(arg, r.rows); await srcBackup(env, 'fmp', r.src + ' (koershistorie)'); }
        else if (r.wait || (kind === 'eod' && fmpDown)) { deferred.push(task); continue; }
      } else if (kind === 'profile' && (!env.FMP_KEY || fmpDown)) {
        const p = await backupProfile(arg);
        if (p && p.busy) { deferred.push(task); continue; }
      } else if (kind === 'peers' && fmpDown && env.FINNHUB_KEY && !(await srcDown(env, 'finnhub'))) {
        // Reserve voor FMP: vergelijkbare bedrijven van Finnhub (zelfde sector en branche)
        calls++;
        const r = await getJson(FINNHUB_BASE + '/stock/peers?symbol=' + encodeURIComponent(arg) + '&token=' + encodeURIComponent(env.FINNHUB_KEY));
        if (r.status === 429) { await srcFail(env, 'finnhub', 'Finnhub-limiet (vergelijkbare bedrijven)', true); deferred.push(task); continue; }
        const other = (x) => x && !x.startsWith(arg) && !arg.startsWith(x);
        const pick = (Array.isArray(r.body) ? r.body : []).filter((x) => other(x) && !x.includes('.')).slice(0, PEERS_PER_STOCK);
        if (pick.length) {
          writes.push(env.DB.prepare('INSERT OR REPLACE INTO ext_peers (symbol, peers, updated) VALUES (?,?,?)').bind(arg, JSON.stringify(pick), parts(new Date()).day));
          pick.forEach((sym) => { if (!queue.includes('profile:' + sym)) queue.unshift('profile:' + sym); });
          await srcBackup(env, 'fmp', 'Finnhub (vergelijkbare bedrijven)');
        } else deferred.push(task);
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
          // Limiet of storing bij FMP: dit profiel (en bij een limiet ook de volgende) via Finnhub of Polygon
          if (!/limiet|402|401|403|FMP gaf 5/.test(e.message) || !(env.FINNHUB_KEY || env.POLYGON_KEY)) throw e;
          await srcFail(env, 'fmp', e.message, /limiet/.test(e.message));
          fmpDown = /limiet/.test(e.message) || (await srcDown(env, 'fmp'));
          const bp = await backupProfile(arg);
          if (bp && bp.busy) deferred.push(task);
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
          if (keep.price != null && !inSession) { writes.push(env.DB.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)').bind(arg, usDay, keep.price)); pxDirty.add(arg); }
        }
      } else if (kind === 'eod') {
        calls++;
        await srcOk(env, 'fmp');
        const from = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
        try {
          const rows = await fmp(env, '/historical-price-eod/light?symbol=' + encodeURIComponent(arg) + '&from=' + from);
          const st = env.DB.prepare('INSERT OR REPLACE INTO ext_prices (symbol, day, price) VALUES (?,?,?)');
          rows.filter((r) => r.date && isFinite(Number(r.price))).forEach((r) => writes.push(st.bind(arg, r.date, Number(r.price))));
          pxDirty.add(arg);
        } catch (e) {
          if (/402/.test(e.message)) { if (!noHist.includes(arg)) noHist.push(arg); if (eodBackupKeys(env) && !queue.includes('eod2:' + arg)) queue.push('eod2:' + arg); } else throw e;
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
      if (/(Polygon|GDELT): stap vol/.test(e.message)) {
        // Polygon staat 5 verzoeken per minuut toe, GDELT één per 5 seconden: deze aanvulling in een volgende stap
        deferred.push(task);
      } else if (/Alpha Vantage-limiet/.test(e.message)) {
        // Morgen verder: de av-taken blijven staan, achteraan
        deferred.push(task, ...queue.filter((t) => t.startsWith('av:')));
        queue = queue.filter((t) => !t.startsWith('av:'));
        if (/dagbudget|limiet bereikt$/.test(e.message)) await noteExtError(env, 'alphavantage', 'Daglimiet van Alpha Vantage bereikt; morgen verder.');
      } else if (/Finnhub-limiet/.test(e.message)) {
        // Finnhub zit aan zijn limiet: Finnhub-taken naar achteren, de rest (zoals FMP-koersen) gaat door
        const fh = [task].concat(queue.filter((t) => t.startsWith('fh:') || t === 'fhnews'));
        queue = queue.filter((t) => !(t.startsWith('fh:') || t === 'fhnews'));
        const st = (await srcState(env)).finnhub || {};
        if ((altKeys(env) || env.ALPHAVANTAGE_KEY) && st.minute === false) {
          // De hele dag uit: de reserves nemen je posities over (eerst Polygon, Marketaux, SEC en FMP, dan Alpha
          // Vantage met zijn kleine budget voor wat nog ontbreekt); de volglijst wacht
          const heldSet = new Set((await heldStocks(env)).map((h) => h.ticker));
          fh.forEach((t) => {
            const tk = t.slice(3);
            if (t.startsWith('fh:') && heldSet.has(tk)) backupResearch(tk).forEach((b) => { if (!queue.includes(b)) queue.push(b); });
            else deferred.push(t);
          });
          if (!altKeys(env)) await srcBackup(env, 'finnhub', 'Alpha Vantage (nieuws en analisten)');
        } else deferred.push(...fh);
      } else if (/limiet|subrequests/i.test(e.message)) { queue.unshift(task); stop = true; }
      else if (/ongeldig/i.test(e.message) && /^fh:/.test(task)) {
        // Finnhub-sleutel werkt niet: de reserves nemen het over als die sleutels er zijn
        const fhTasks = [task].concat(queue.filter((t) => t.startsWith('fh:')));
        queue = queue.filter((t) => !t.startsWith('fh:'));
        fhTasks.forEach((t) => backupResearch(t.slice(3)).forEach((b) => { if (!queue.includes(b)) queue.push(b); }));
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
  if (done || writes.length) await bumpMarket(env, [...pxDirty]);
  if (done) await saveDataCache(env, await buildData(env));
  return `Markt: ${done} taken gedaan, ${queue.length} over${errors.length ? ', ' + errors.length + ' fouten' : ''}.`;
}

// De koershistorie van alle gevolgde aandelen is verreweg de grootste lezer: duizenden rijen per opbouw, en de
// opbouw gebeurt elke 10 minuten. Die gegevens veranderen alleen als marketStep of planMarket iets schrijft
// (dan wordt mkt_ver opgehoogd) of als posities, volglijst of maatstaf anders zijn (dan verandert de vingerafdruk).
const MARKET_CACHE_MS = 12 * 3600e3;
// syms: alleen de koersen van deze symbolen zijn veranderd (de marktstap); dan leest de volgende opbouw van de
// marktgegevens alleen hun koersen opnieuw (kv 'mkt_px_dirty'). Zonder syms: alles opnieuw.
async function bumpMarket(env, syms) {
  try {
    let cur = 'all';
    if (syms) { try { cur = JSON.parse((await getKv(env, 'mkt_px_dirty')) || '[]'); } catch (e) { cur = 'all'; } }
    const next = Array.isArray(cur) ? [...new Set(cur.concat(syms))] : 'all';
    await setKv(env, 'mkt_px_dirty', JSON.stringify(Array.isArray(next) && next.length > 300 ? 'all' : next));
    await setKv(env, 'mkt_ver', String(Date.now()));
  } catch (e) { /* niet erg */ }
}
async function marketDataCached(env) {
  if ((await getKv(env, 'market_schema')) !== '1') return null;
  const held = await heldStocks(env);
  const watch = await extraStocks(env);
  const sig = JSON.stringify([(await getKv(env, 'mkt_ver')) || '', held.map((h) => h.ticker + '=' + h.symbol).sort(), watch.map((w) => w.symbol).sort()]);
  let c = null;
  try { c = JSON.parse((await getBig(env, 'market_cache')) || 'null'); } catch (e) { c = null; }
  if (c && c.sig === sig && Date.now() - c.at < MARKET_CACHE_MS) return c.data;
  // Alleen nieuwe koersen van een paar symbolen: de rest van de koersen uit de vorige versie (scheelt tienduizenden
  // gelezen rijen per marktstap). Eens per MARKET_CACHE_MS, en na andere wijzigingen, alles opnieuw.
  let dirty = 'all';
  try { dirty = JSON.parse((await getKv(env, 'mkt_px_dirty')) || '"all"'); } catch (e) { dirty = 'all'; }
  const fresh = c && c.data && c.data.prices && Array.isArray(dirty) && Date.now() - (c.full || 0) < MARKET_CACHE_MS;
  const data = await marketData(env, fresh ? { prices: c.data.prices, dirty } : null);
  try { await setBig(env, 'market_cache', JSON.stringify({ sig, at: Date.now(), full: fresh ? c.full : Date.now(), data })); } catch (e) { console.error('marktcache', e); }
  await setKv(env, 'mkt_px_dirty', '[]');
  return data;
}

async function marketData(env, inc) {
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
  const prices = {};
  let pr = [];
  if (inc) {
    // Koersen van de vorige versie houden; alleen gewijzigde of nog ontbrekende symbolen lezen (via de primaire sleutel)
    const need = [...want].filter((x) => inc.dirty.includes(x) || !inc.prices[x]);
    want.forEach((x) => { if (!need.includes(x) && inc.prices[x]) prices[x] = inc.prices[x].filter((r) => r[0] >= since); });
    for (let i = 0; i < need.length; i += 50) {
      const part = need.slice(i, i + 50);
      pr = pr.concat((await env.DB.prepare('SELECT symbol, day, price FROM ext_prices WHERE symbol IN (' + part.map(() => '?').join(',') + ') AND day >= ? ORDER BY day').bind(...part, since).all()).results);
    }
  } else pr = (await env.DB.prepare('SELECT symbol, day, price FROM ext_prices WHERE day >= ? ORDER BY day').bind(since).all()).results;
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
  await invalidateSeries(env);
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

export const _test = { parts, isLive, marketHours, shortTicker, isoLocal, isDst, hourStart, dayOf, newsHistTask, storeNews, noteOpinionDay, figiRecord, gdeltName, usTicker, heldStocks,
  tradingDay, usTradingDay, shiftDay, weekdayOf, srcPause, srcFail, srcOk, srcState, srcHistState, checkPositions, splitRatio,
  planResearch, uniqTasks, dbWatch, testKey, r2Backup, r2Info, r2Preview, healthInfo, budgetInfo, buildData, bumpMarket, ensureMarketTables, ensureIndexes, countingDb, flushCalls, srcFail, searchCompanies, checkPriceAlerts, saveMode, buildAllowed, seriesRows, todayState, seriesFull, newsKind, newsBreaking, flashMerge, newsWatch, marketDataCached, marketData, invalidateSeries, cfTrend, setBig, getBig, invalidateOrders,
  housekeeping, lastRows, ledgerCheck, watchQuotes, wqClear: () => WQ.clear(), usSym, QUOTES, kvMemoClear: () => { kvMemo = new WeakMap(); }, sicSector, parseForm4, quarterlyEps, polyNewsItems, altTask, eodBackup, planMarket };


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

// Stille uren staan uit (quietFrom gelijk aan quietTo) en meldingen gaan los, niet gebundeld
const ALERT_DEFAULTS = { move: 5, earnings: true, insider: true, drift: 5, quietFrom: 0, quietTo: 0, digest: false, digestHour: 18, ratings: true, news: 'all' };
async function alertRules(env) { const s = await getSettings(env); return Object.assign({}, ALERT_DEFAULTS, (s && s.alerts) || {}); }

// Eén keer per sleutel (bijvoorbeeld "move|2026-11-17|AAPL"); de laatste 400 sleutels worden onthouden.
// 'at' is het moment van de meting: stille uren en de dagbundel worden daaraan afgemeten, niet aan de klok
// op het moment dat deze functie toevallig draait (die lopen in de cron gelijk, maar in tests niet).
async function alertOnce(env, key, msg, at) {
  let sent = {};
  try { sent = JSON.parse((await getKv(env, 'alerts_sent')) || '{}'); } catch (e) { sent = {}; }
  if (sent[key]) return false;
  const rules = await alertRules(env);
  const now = at ? new Date(at) : new Date();
  // Stille uren en de dagbundel gelden voor alle meldingen, ook de dringende: anders is "stil" niet stil.
  // Wat wacht, gaat als één melding uit zodra het weer mag (flushAlerts).
  const quiet = inQuiet(rules, now);
  const bundle = !!rules.digest;
  let n = 0;
  if (quiet || bundle) await queueAlert(env, msg, quiet ? 'stille uren' : 'dagbundel');
  else { n = await sendPush(env, msg); await alertLogAdd(env, { title: msg.title, body: String(msg.body || '').slice(0, 160), mode: 'direct', devices: n }); }
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
  // Waarde per stuk bij de laatste meting van vóór vandaag: dan telt alleen de koers, niet wat je bijkocht of verkocht
  const per = new Map();
  try {
    const midnight = hourStart(now.getTime()) - parts(now).hour * HOUR_MS;
    const pq = (await lastRows(env, midnight)) || [];
    pq.forEach((p) => { if (p.qty > 0 && p.value > 0) per.set(p.ticker, p.value / p.qty); });
  } catch (e) { /* dan zoals voorheen tegen het dagslot */ }
  // Totaal: je huidige posities tegen hun koers van gisteren
  let totNow = 0, totPrev = 0, totVal = 0;
  rows.forEach((r) => { if (r.ticker === TOTAL || !(r.value > 0)) return; totVal += r.value; if (per.has(r.ticker) && r.qty > 0) { totNow += r.value; totPrev += per.get(r.ticker) * r.qty; } });
  const hits = [];
  for (const r of rows) {
    const c = prev.get(r.ticker);
    let ch = null;
    if (r.ticker === TOTAL) { if (totPrev > 0 && totNow >= totVal * 0.8) ch = totNow / totPrev - 1; }
    else if (per.has(r.ticker) && r.qty > 0 && r.value > 0) ch = r.value / r.qty / per.get(r.ticker) - 1;
    if (ch == null) { if (!(c > 0) || !(r.value > 0)) continue; ch = r.value / c - 1; }
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
    }, now);
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

// Je eigen aandelen met hun naam: uit de laatste meting, anders uit de laatste weekmeting; fondsen tellen niet mee
async function heldNamed(env) {
  let rows = (await lastRows(env)) || [];
  if (!rows.length) ({ results: rows } = await env.DB.prepare('SELECT ticker, name FROM positions WHERE date = (SELECT MAX(date) FROM positions)').all());
  return rows.filter((r) => !ETF_RE.test(r.name || ''));
}
// Zit dit aandeel in je portefeuille? (Meldingen over insiders, 13F en aanbevelingen gaan alleen over je eigen posities.)
async function isHeldTicker(env, tk) {
  try { return (await heldNamed(env)).some((r) => r.ticker === tk); } catch (e) { return false; }
}

// Na het ophalen bij Finnhub: nieuwe aankopen door bestuurders (alleen kopen met eigen geld, code P), alleen voor je posities
async function alertInsider(env, tk, prevList, newList) {
  if (!(await pushSubs(env)).length) return;
  const rules = await alertRules(env);
  if (!rules.insider) return;
  if (!(await isHeldTicker(env, tk))) return;
  const seen = new Set((prevList || []).map((x) => x.date + '|' + x.name + '|' + x.change));
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const month = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const buyers = new Set((newList || []).filter((y) => y.code === 'P' && y.date >= month).map((y) => y.name)).size;
  for (const x of (newList || []).filter((y) => y.code === 'P' && y.date >= since && !seen.has(y.date + '|' + y.name + '|' + y.change)).slice(0, 2)) {
    await alertOnce(env, 'ins|' + tk + '|' + x.date + '|' + x.name, {
      title: tk + ': bestuurder koopt aandelen',
      body: (x.name || 'Een bestuurder') + ' kocht ' + (x.change || '?') + ' aandelen' + (x.price ? ' à $' + x.price : '') + ' op ' + x.date + '.' +
        (buyers > 1 ? ' ' + buyers + ' bestuurders kochten deze maand.' : ''),
      url: '#bedrijf/' + encodeURIComponent(tk), tag: 'ins-' + tk,
    });
  }
}

// Melding als analisten binnen een week duidelijk van mening veranderen over een aandeel dat je hebt.
// Pas vanaf 7 dagen geschiedenis (recHist), anders lijkt de eerste meting zelf een verschuiving.
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
async function alertRatings(env, tk, out) {
  if (!(await pushSubs(env)).length) return;
  const rules = await alertRules(env);
  if (rules.ratings === false) return;
  const H = (Array.isArray(out.recHist) ? out.recHist : []).filter((x) => Array.isArray(x) && x[0]);
  if (H.length < 2 || !(dayDiff(H[0][0], H[H.length - 1][0]) >= 7)) return;
  const cur = H[H.length - 1];
  const old = H.filter((x) => x[0] <= ymdUTC(Date.now() - 7 * 864e5)).pop();
  if (!old || old === cur) return;
  const pos = (x) => (x[1] || 0) + (x[2] || 0);
  const tot = (x) => (x[1] || 0) + (x[2] || 0) + (x[3] || 0) + (x[4] || 0) + (x[5] || 0);
  const d = pos(cur) - pos(old);
  if (Math.abs(d) < 2) return;
  if (!(await isHeldTicker(env, tk))) return;
  const t0 = Number(old[6]), t1 = Number(cur[6]);
  const dT = isFinite(t0) && isFinite(t1) && t0 > 0 ? t1 / t0 - 1 : null;
  const n = Math.abs(d);
  await alertOnce(env, 'rat|' + tk + '|' + Math.floor(Date.now() / (7 * 864e5)) + '|' + (d > 0 ? 'u' : 'd'), {
    title: tk + ': ' + n + ' analist' + (n === 1 ? '' : 'en') + (d > 0 ? ' meer' : ' minder') + ' positief deze week',
    body: 'Nu zegt ' + pos(cur) + ' van de ' + tot(cur) + ' analisten kopen (was ' + pos(old) + ' van ' + tot(old) + ').' +
      (dT != null && Math.abs(dT) >= 0.02 ? ' Het gemiddelde koersdoel ging ' + (dT > 0 ? 'omhoog' : 'omlaag') + ' met ' + Math.round(Math.abs(dT) * 100) + '%.' : ''),
    url: '#bedrijf/' + encodeURIComponent(tk), tag: 'rat-' + tk,
  });
}

// Namen uit een 13F-opgave naast je eigen posities leggen: "APPLE INC" hoort bij Apple
const f13Name = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]+/g, ' ')
  .replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC|NEW|CL|CLASS|HLDGS|HOLDING|HOLDINGS|GROUP|THE|SA|NV|AG|ADR|COM|SHS|TR|LLC|LP)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();
// Melding als een grote belegger in een aandeel stapt dat jij ook hebt, of zijn positie flink wijzigt
async function alert13F(env, label, cik, acc, top, before) {
  if (!(await pushSubs(env)).length) return;
  const rules = await alertRules(env);
  if (!rules.insider) return;
  const held = (await heldNamed(env)).map((r) => ({ tk: r.ticker, key: f13Name(r.name) })).filter((x) => x.key.length >= 3);
  if (!held.length) return;
  const was = new Map((before || []).map((x) => [x.name, x]));
  const who = String(label).split(' (')[0];
  for (const x of top) {
    const key = f13Name(x.name);
    const hit = held.find((h) => key === h.key || key.startsWith(h.key + ' ') || h.key.startsWith(key + ' '));
    if (!hit) continue;
    const p = was.get(x.name);
    const chg = p && p.shares ? x.shares / p.shares - 1 : null;
    if (p && !(chg != null && Math.abs(chg) >= 0.2)) continue;
    const pct = Math.round((x.pct || 0) * 100);
    await alertOnce(env, 'f13|' + cik + '|' + acc + '|' + hit.tk, {
      title: hit.tk + ': ' + who + (!p ? ' stapte in' : chg > 0 ? ' kocht bij' : ' bouwde af'),
      body: who + ' meldt ' + (!p ? 'een nieuwe positie' : 'een wijziging van ' + (chg > 0 ? '+' : '−') + Math.round(Math.abs(chg) * 100) + '%') +
        ' in ' + x.name + ' (' + pct + '% van hun portefeuille), volgens de kwartaalopgave bij de SEC.',
      url: '#bedrijf/' + encodeURIComponent(hit.tk), tag: 'f13-' + hit.tk,
    });
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
// ---------- Logboek en apparaatcodes ----------

// Logboek: wat er met je tracker gebeurde (sleutels gewijzigd, inloggen, orders, deel-links, apparaatcodes).
// Alleen korte beschrijvingen: nooit een sleutel, code, bedrag of e-mailadres.
async function auditList(env) { try { const l = JSON.parse((await getKv(env, 'audit')) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
async function auditLog(env, kind, msg) {
  try {
    const list = await auditList(env);
    list.push({ at: isoLocal(Date.now()), kind: String(kind || '').slice(0, 24), msg: String(msg == null ? '' : msg).replace(/[\u0000-\u001f]/g, ' ').slice(0, 160) });
    await setKv(env, 'audit', JSON.stringify(list.slice(-100)));
  } catch (e) { console.error('logboek', e); }
}

// kv 'sessions' = [{ id, hash, label, at, seen, until }]
const SESSION_MAX = 10;
async function sessionList(env) { try { const l = JSON.parse((await getKv(env, 'sessions')) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
const sessionPublic = (s) => ({ id: s.id, label: s.label, at: s.at, seen: s.seen, until: s.until || null });

async function newSession(env, label, days) {
  const list = await sessionList(env);
  const token = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const d = Number(days);
  const now = Date.now();
  const s = {
    id: b64u(crypto.getRandomValues(new Uint8Array(6))),
    hash: await sha256Hex(token),
    label: (String(label || '').replace(/[^A-Za-z0-9 /+.()-]/g, '').trim().slice(0, 40)) || 'Apparaat',
    at: isoLocal(now), seen: isoLocal(now),
    until: d > 0 && d <= 400 ? isoLocal(now + d * 864e5) : null,
  };
  await setKv(env, 'sessions', JSON.stringify(list.concat([s]).slice(-SESSION_MAX)));
  await auditLog(env, 'apparaat', 'eigen code gemaakt voor ' + s.label);
  return { token, session: sessionPublic(s) };
}

async function revokeThings(env, body) {
  const out = { devices: 0, links: [] };
  if (body && body.devices) {
    out.devices = (await sessionList(env)).length;
    await setKv(env, 'sessions', '[]');
    await auditLog(env, 'apparaat', 'alle apparaatcodes ingetrokken (' + out.devices + ')');
  }
  if (body && body.links) {
    if (await getKv(env, 'share')) { await setKv(env, 'share', 'null'); await setBig(env, 'data_share', ''); out.links.push('deel-link'); }
    if (await getKv(env, 'cal_token')) { await setKv(env, 'cal_token', ''); out.links.push('agenda-link'); }
    if (out.links.length) await auditLog(env, 'link', 'ingetrokken: ' + out.links.join(' en '));
  }
  return out;
}

// ---------- Meldingen: stille uren, dagbundel en een kort logboek ----------
// alerts: { quietFrom, quietTo (uur, 0-23; gelijk = uit), digest (bundelen), digestHour } – zie ALERT_DEFAULTS
function inQuiet(rules, now) {
  const f = Math.floor(Number(rules.quietFrom)), t = Math.floor(Number(rules.quietTo));
  if (!(f >= 0 && f <= 23) || !(t >= 0 && t <= 23) || f === t) return false;
  const h = Number(parts(now).hm.slice(0, 2));
  return f < t ? h >= f && h < t : h >= f || h < t;
}

async function alertLogAdd(env, o) {
  try {
    let list = [];
    try { list = JSON.parse((await getKv(env, 'alert_log')) || '[]'); } catch (e) { list = []; }
    list.push(Object.assign({ at: isoLocal(Date.now()) }, o));
    await setKv(env, 'alert_log', JSON.stringify(list.slice(-60)));
  } catch (e) { console.error('meldingslog', e); }
}
async function alertQueue(env) { try { const l = JSON.parse((await getKv(env, 'alert_queue')) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }

// Een melding die nu niet mag (stille uren) of die gebundeld wordt, gaat in de wachtrij
async function queueAlert(env, msg, why) {
  const q = await alertQueue(env);
  q.push({ at: isoLocal(Date.now()), title: msg.title, body: msg.body, url: msg.url || '', tag: msg.tag || '' });
  await setKv(env, 'alert_queue', JSON.stringify(q.slice(-30)));
  await alertLogAdd(env, { title: msg.title, body: String(msg.body || '').slice(0, 160), mode: why, devices: 0 });
}

// Stuurt de wachtrij als één melding zodra het weer mag (na de stille uren, of in de dagbundel één keer per dag)
async function flushAlerts(env, now) {
  const q = await alertQueue(env);
  if (!q.length) return '';
  const rules = await alertRules(env);
  if (inQuiet(rules, now)) return '';
  const day = parts(now).day;
  if (rules.digest) {
    if ((await getKv(env, 'digest_day')) === day) return '';
    const h = Number(parts(now).hm.slice(0, 2));
    const want = Math.min(23, Math.max(0, Math.floor(Number(rules.digestHour)) || 18));
    if (h < want) return '';
    await setKv(env, 'digest_day', day);
  }
  await setKv(env, 'alert_queue', '[]');
  const one = q.length === 1;
  const msg = {
    title: one ? q[0].title : q.length + ' meldingen van je tracker',
    body: one ? q[0].body : q.map((x) => '\u2022 ' + x.title).join('\n').slice(0, 290),
    url: one ? q[0].url : '#overzicht', tag: 'bundel',
  };
  const n = await sendPush(env, msg);
  await alertLogAdd(env, { title: msg.title, body: String(msg.body || '').slice(0, 160), mode: 'bundel', devices: n, items: q.length });
  return q.length + (q.length === 1 ? ' melding' : ' meldingen') + ' uit de wachtrij verstuurd.';
}

// Haalt een gedeelde weergave van iemand anders op en geeft alleen percentages terug (idee 84).
// Alleen een adres van de vorm https://host/share/<code>; de link wordt niet bewaard.
async function friendCompare(env, body) {
  const u = String((body && body.url) || '').trim();
  const m = /^https:\/\/([A-Za-z0-9.-]{3,80})\/share\/([A-Za-z0-9_-]{20,80})$/.exec(u);
  if (!m) throw new Error('Dit is geen deel-link. Een deel-link ziet eruit als https://…workers.dev/share/<code>.');
  let res;
  try { res = await fetch(u, { headers: { Accept: 'application/json' } }); }
  catch (e) { throw new Error('De tracker van de ander antwoordde niet: ' + String(e.message || e).slice(0, 80) + '.'); }
  if (!res.ok) throw new Error(res.status === 404 || res.status === 410 ? 'Deze deel-link werkt niet (meer).' : 'De andere tracker gaf status ' + res.status + '.');
  const d = await res.json().catch(() => null);
  if (!d || !d.ok || !Array.isArray(d.weeks)) throw new Error('De link gaf geen bruikbare gegevens.');
  await auditLog(env, 'vergelijken', 'percentages van een gedeelde link opgehaald');
  return { pct: pctSummary(d), since: (d.shared && d.shared.since) || null, generated: d.generated || null, weeks: d.weeks.length };
}

// Rendement in percentages uit de weekmetingen: deze week, 30 dagen, dit jaar en sinds het begin.
// Per periode: (waardeverandering - nieuwe inleg) / waarde aan het begin. Werkt ook met geschaalde bedragen.
function pctSummary(d) {
  const w = (d.weeks || []).filter((x) => x && isFinite(Number(x.accountValue)));
  const last = w[w.length - 1];
  if (!last) return { week: null, month: null, ytd: null, total: null };
  const since = (from) => {
    const i = w.findIndex((x) => String(x.date) >= from);
    const base = i > 0 ? w[i - 1] : i === 0 ? w[0] : null;
    if (!base || !(base.accountValue > 0) || base === last) return null;
    const res = last.accountValue - base.accountValue - (last.netDeposits - base.netDeposits);
    return Math.round((res / base.accountValue) * 10000) / 10000;
  };
  const dayIso = (ms) => isoLocal(ms).slice(0, 10);
  const lastT = Date.parse(String(last.date).slice(0, 19)) || Date.now();
  return {
    week: last.weekResultPct == null ? null : Math.round(last.weekResultPct * 10000) / 10000,
    month: since(dayIso(lastT - 30 * 864e5)),
    ytd: since(String(last.date).slice(0, 4) + '-01-01'),
    total: last.totalResultPct == null ? null : Math.round(last.totalResultPct * 10000) / 10000,
  };
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
  // Ook het aantal stuks: met het echte aantal en de koers is de echte waarde terug te rekenen
  rows(d.intraday, [2, 3]); rows(d.hours, [2, 3, 4, 5, 6]); rows(d.days, [2, 3, 4, 5, 6, 7]); rows(d.orders, [4, 8, 9, 10, 11]);
  (d.today || []).forEach((t) => obj(t, ['current', 'low', 'high', 'avg', 'open', 'change', 'allTimeHigh', 'allTimeLow', 'avgRange']));
  (d.positions || []).forEach((p) => obj(p, ['value', 'unrealized', 'cost', 'quantity']));
  (d.weeks || []).forEach((w) => obj(w, ['accountValue', 'netDeposits', 'cash', 'costBasis', 'investmentsValue', 'unrealized', 'totalResult', 'weekChange', 'newDeposits', 'weekResult']));
  (d.peil || []).forEach((p) => { obj(p, ['total', 'investments', 'cash']); p.positions = []; });
  Object.values(d.posExtra || {}).forEach((x) => obj(x, ['fx', 'cost', 'qty']));
  obj(d.cashNow, ['cash']);
  (((d.ext2 || {}).pies || {}).list || []).forEach((x) => obj(x, ['invested', 'value', 'result', 'cash', 'divGained', 'goal']));
  ((d.ext2 || {}).interest || []).forEach((x) => obj(x, ['amount']));
  if (d.events) {
    (d.events.received || []).forEach((x) => obj(x, ['amount', 'qty', 'wht']));
    (d.events.dividends || []).forEach((x) => obj(x, ['estEur']));
  }
}

// Wat de gedeelde weergave mag zien. Een lijst van wat erin mag (geen lijst van wat eruit moet), zodat een
// nieuw veld in buildData nooit per ongeluk meegaat. Notities, andere rekeningen, voorkeuren, koersalarmen,
// sleutels, logboeken en apparaatcodes blijven dus altijd binnen je eigen Worker (idee 163).
const SHARE_KEYS = ['ok', 'generated', 'currency', 'weeks', 'positions', 'positionsDate', 'today', 'cashNow', 'orders', 'posExtra',
  'peil', 'events', 'market', 'marketNews', 'research', 'fin', 'etf', 'fx', 'hicp', 'idx', 'ext2', 'intraday', 'hours', 'days', 'newsFlash'];
// Uit ext2 mag alleen openbare marktinformatie mee; 'pies' heeft namen die je zelf hebt gekozen
const SHARE_EXT2_KEYS = ['filings', 'f13', 'econ', 'earnHist'];

function shareData(data, conf) {
  const d = {};
  SHARE_KEYS.forEach((k) => { if (data[k] !== undefined) d[k] = JSON.parse(JSON.stringify(data[k])); });
  const s = data.settings || {};
  d.settings = { targets: s.targets, targetMode: s.targetMode, watchlist: s.watchlist };
  d.features = { flags: (data.features && data.features.flags) || {}, has: (data.features && data.features.has) || {} };
  d.shared = { amounts: !!conf.amounts, since: conf.since || null, until: conf.until || null };
  if (d.ext2) { const e = {}; SHARE_EXT2_KEYS.forEach((k) => { if (d.ext2[k] !== undefined) e[k] = d.ext2[k]; }); d.ext2 = e; }
  d.ok = true;
  if (!conf.amounts) scaleMoney(d);
  return d;
}

// De kopie voor de deel-link: alleen opnieuw als het overzicht sinds de vorige kopie veranderd is (kv 'share_stamp')
async function shareBody(env, c) {
  let tags = {};
  try { tags = JSON.parse((await getKv(env, 'data_etags')) || '{}'); } catch (e) { tags = {}; }
  let body = await getBig(env, 'data_share');
  if (body && tags.core && (await getKv(env, 'share_stamp')) === tags.core) return body;
  let core = await getBig(env, 'data_core'), extra = await getBig(env, 'data_extra');
  if (!core || !extra) {
    await saveDataCache(env, await buildData(await withKeys(env)));
    core = await getBig(env, 'data_core'); extra = await getBig(env, 'data_extra');
    try { tags = JSON.parse((await getKv(env, 'data_etags')) || '{}'); } catch (e) { tags = {}; }
  }
  const data = Object.assign({}, JSON.parse((await seriesFull(env)).body), JSON.parse(extra), JSON.parse(core));
  body = JSON.stringify(shareData(data, c));
  await setBig(env, 'data_share', body);
  await setKv(env, 'share_stamp', tags.core || '');
  return body;
}

async function shareAction(env, body) {
  let c = (await shareConf(env)) || {};
  const act = body && body.action;
  if (act === 'off') { await setKv(env, 'share', 'null'); await setBig(env, 'data_share', ''); await auditLog(env, 'link', 'deel-link uitgezet'); return { on: false }; }
  if (act === 'on' || act === 'rotate' || !c.token) {
    if (act === 'rotate' || !c.token) c.token = b64u(crypto.getRandomValues(new Uint8Array(24)));
    c.since = c.since || isoLocal(Date.now());
    await auditLog(env, 'link', act === 'rotate' ? 'nieuwe deel-link gemaakt (de oude werkt niet meer)' : 'deel-link gemaakt');
  }
  if (body && typeof body.amounts === 'boolean') c.amounts = body.amounts;
  // Einddatum: aantal dagen (0 of leeg = zonder einddatum)
  if (body && body.days !== undefined) {
    const d = Math.floor(Number(body.days));
    c.until = d > 0 && d <= 400 ? isoLocal(Date.now() + d * 864e5) : null;
    if (c.token) await auditLog(env, 'link', c.until ? 'deel-link verloopt op ' + c.until.slice(0, 10) : 'deel-link zonder einddatum');
  }
  c.amounts = !!c.amounts;
  await setKv(env, 'share', JSON.stringify(c));
  await setKv(env, 'share_stamp', '');   // de kopie opnieuw opbouwen bij het volgende bezoek (bedragen of einddatum kunnen anders zijn)
  return { on: true, token: c.token, amounts: c.amounts, since: c.since, until: c.until || null };
}

// Is de deel-link verlopen? (idee 68)
const shareExpired = (c) => !!(c && c.until && Date.parse(String(c.until).replace(' ', 'T')) < Date.now());

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
  if (fresh.length) await invalidateOrders(env);

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
  // Rente over je vrije saldo (alleen in de CSV, niet in de API)
  let interest = [];
  try { interest = JSON.parse((await getKv(env, 'interest_csv')) || '[]'); } catch (e) { interest = []; }
  const ikey = (d) => d.date + '|' + Number(d.amount).toFixed(2);
  const iknown = new Set(interest.map(ikey));
  let newInt = 0;
  (Array.isArray(body && body.interest) ? body.interest : []).slice(0, 5000).forEach((d) => {
    const x = { date: str(d.date, 10), amount: n(d.amount) };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date) || x.amount == null || iknown.has(ikey(x))) return;
    iknown.add(ikey(x)); interest.push(x); newInt++;
  });
  if (newInt) { interest.sort((a, b) => a.date.localeCompare(b.date)); await setKv(env, 'interest_csv', JSON.stringify(interest)); }
  let ev = null;
  try { ev = JSON.parse((await getKv(env, 'events')) || 'null'); } catch (e) { ev = null; }
  if (ev) { ev.received = mergeCsvDividends(ev.received || [], divCsv); await setKv(env, 'events', JSON.stringify(ev)); }
  await saveDataCache(env, await buildData(env));
  return { orders: fresh.length, skipped: orders.length - fresh.length, dividends: newDiv, interest: newInt };
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
  const { results: intra } = await env.DB.prepare('SELECT ts, ticker, value, qty FROM intraday WHERE ts > ? ORDER BY ts').bind(s).all();
  const { results: hrs } = await env.DB.prepare('SELECT hour, ticker, open, close, low, high, avg FROM hours WHERE hour >= ? ORDER BY hour').bind(s - 2 * HOUR_MS).all();
  const { results: dys } = await env.DB.prepare('SELECT day, ticker, open, close, low, high, avg, range, range_pct FROM days WHERE day >= ? ORDER BY day').bind(dayOf(s - 864e5)).all();
  const last = await env.DB.prepare('SELECT MAX(ts) AS ts FROM intraday').first();
  return {
    ok: true, part: 'series', delta: true, since: s, seriesTs: (last && last.ts) || s,
    intraday: { rows: intra.map((r) => [isoLocal(r.ts), r.ticker, r.value, r.qty == null ? null : r.qty]) },
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
  for (const k of ['data_core', 'data_extra', 'data_series']) sizes[k] = ((await getBig(env, k)) || '').length;
  return {
    now: isoLocal(Date.now()), lastMeasurement: last && last.ts ? isoLocal(last.ts) : null, live: isLive(new Date()),
    lastCron: await getKv(env, 'last_cron'), lastError: await getKv(env, 'last_error'), tickFails: Number((await getKv(env, 'tick_fail')) || 0),
    lastWeek: await getKv(env, 'last_week_snapshot'), ordersSynced: await getKv(env, 'orders_synced'), marketPlanned: await getKv(env, 'mkt_planned'),
    ledger: await (async () => { try { return JSON.parse((await getKv(env, 'ledger_check')) || 'null'); } catch (e) { return null; } })(),
    queue: q.length, fmpCalls, avCalls, errors: JSON.parse((await getKv(env, 'ext_errors')) || '{}'), health: await srcState(env),
    rows: await (async () => { const d = await dbWatch(env, false); const t = (d && d.tables) || {}; const n = (k) => (t[k] ? t[k].rows : null);
      return { intraday: n('intraday'), hours: n('hours'), days: n('days'), weeks: n('weeks'), orders: n('orders') }; })(),
    sizes, devices: (await pushSubs(env)).length, companies: ((await getKv(env, 'companies_meta')) || '').slice(0, 200) || null,
    usage: JSON.parse((await getKv(env, 'api_calls')) || '{}'), siteErrors: JSON.parse((await getKv(env, 'site_errors')) || '[]'),
    tickHist: JSON.parse((await getKv(env, 'tick_hist')) || '{}'), r2: !!env.BACKUP, r2Last: await getKv(env, 'r2_last'),
    hist: await srcHistState(env), budgets: await budgetInfo(env), db: await dbWatch(env, false),
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
const BACKUP_KV = /^(settings|events|div_csv|interest_csv|pos_extra|peil_\d{4}|etf_(SP500|NDX))$/;
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
  if (table === 'kv') kvMemoOf(env).clear();
  if (['intraday', 'hours', 'days'].includes(table)) await invalidateSeries(env);
  if (table === 'orders') await invalidateOrders(env);
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
    await alertOnce(env, 'watchdog|' + parts(at).day, { title: 'Je tracker meet niet meer', body: 'Al ' + n + ' metingen op rij mislukt: ' + msg + (/401|403|sleutel/i.test(msg) ? ' Controleer je Trading 212-sleutel bij Koppelingen.' : ''), url: '#status', tag: 'watchdog', urgent: true }, at);
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
async function checkPriceAlerts(env, rows, now) {
  const s = await getSettings(env);
  const list = Array.isArray(s.priceAlerts) ? s.priceAlerts : [];
  const active = list.filter((a) => a.on && isFinite(a.price));
  if (!active.length || !(await pushSubs(env)).length) return '';
  const held = new Map(rows.filter((r) => r.ticker !== TOTAL && r.price).map((r) => [r.ticker, r.price]));
  const price = new Map();
  let quotes = 0, tdQuotes = 0;
  for (const a of active) {
    if (held.has(a.sym)) { price.set(a.sym, held.get(a.sym)); continue; }
    if (price.has(a.sym)) continue;
    if (env.FINNHUB_KEY && quotes < 10 && !(await srcDown(env, 'finnhub'))) {
      quotes++;
      const r = await getJson(FINNHUB_BASE + '/quote?symbol=' + encodeURIComponent(a.sym) + '&token=' + encodeURIComponent(env.FINNHUB_KEY));
      if (r.ok && r.body && r.body.c > 0) { price.set(a.sym, r.body.c); continue; }
      if (r.status === 429) await srcFail(env, 'finnhub', 'Finnhub-limiet (koersalarm)', true);
    }
    if (env.TWELVEDATA_KEY && tdQuotes < 5 && !(await srcDown(env, 'twelvedata'))) {
      // Reserve voor Finnhub: actuele koers van Twelve Data (1 van de 800 verzoeken per dag)
      tdQuotes++;
      const r = await getJson('https://api.twelvedata.com/price?symbol=' + encodeURIComponent(a.sym) + '&apikey=' + encodeURIComponent(env.TWELVEDATA_KEY));
      const v = r.ok && r.body ? numOrNull(r.body.price) : null;
      if (v > 0) { price.set(a.sym, v); await srcBackup(env, 'finnhub', 'Twelve Data (koersalarm)'); continue; }
      if (r.status === 429 || (r.body && r.body.code === 429)) await srcFail(env, 'twelvedata', 'Twelve Data-limiet', true);
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
      body: 'Koers nu ' + String(Math.round(p * 100) / 100).replace('.', ',') + '. Het alarm staat nu uit; zet het opnieuw aan op de pagina van het aandeel.', url: held.has(a.sym) ? '#bedrijf/' + encodeURIComponent(a.sym) : '#volg/' + encodeURIComponent(a.sym), tag: 'price-' + a.sym, urgent: true }, now);
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
  await alertOnce(env, 'deposit|' + D.month, { title: 'Inleg deze maand', body: 'Tot nu toe ' + nlEur(D.deposited) + ' van de ' + nlEur(s.monthly) + ' die je per maand wilt inleggen (stand weekmeting ' + (D.asOf || '') + ').', url: '#plannen', tag: 'deposit' }, now);
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
  exact.concat(starts.slice(0, 15), named.slice(0, 20)).forEach((x) => add(x[0], x[1], 'VS', 'lijst'));
  if (seen.size < 8 && env.FINNHUB_KEY && !(await srcDown(env, 'finnhub'))) {
    const r = await getJson(FINNHUB_BASE + '/search?q=' + encodeURIComponent(query) + '&token=' + encodeURIComponent(env.FINNHUB_KEY));
    if (r.ok && r.body && Array.isArray(r.body.result)) r.body.result.filter((x) => /Common Stock|ADR|ETP|ETF/i.test(x.type || '')).slice(0, 20).forEach((x) => add(x.symbol, x.description, x.displaySymbol !== x.symbol ? x.displaySymbol : '', 'Finnhub'));
    else if (r.status === 429) await srcFail(env, 'finnhub', 'Finnhub-limiet', true);
  }
  if (seen.size < 8 && env.TWELVEDATA_KEY && (!env.FINNHUB_KEY || (await srcDown(env, 'finnhub'))) && !(await srcDown(env, 'twelvedata'))) {
    // Reserve voor Finnhub: zoeken bij Twelve Data (alleen Amerikaanse en Europese aandelen en fondsen)
    const r = await getJson('https://api.twelvedata.com/symbol_search?symbol=' + encodeURIComponent(query) + '&outputsize=20&apikey=' + encodeURIComponent(env.TWELVEDATA_KEY));
    const data = r.ok && r.body && Array.isArray(r.body.data) ? r.body.data : [];
    data.filter((x) => /Common Stock|ETF|Depositary/i.test(x.instrument_type || '')).forEach((x) => add(x.symbol, x.instrument_name, x.exchange !== 'NASDAQ' && x.exchange !== 'NYSE' ? x.exchange : '', 'Twelve Data'));
    if (data.length) await srcBackup(env, 'finnhub', 'Twelve Data (zoeken)');
    else if (r.status === 429) await srcFail(env, 'twelvedata', 'Twelve Data-limiet', true);
  }
  return [...seen.values()].slice(0, 30);
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

// =====================================================================
// ---------- Officieel, geruchten en belangrijk nieuws ----------
// Elke ronde haalt de Worker het nieuws van vandaag en gisteren op voor een paar van je aandelen (eerst wat je hebt,
// dan de volglijst, om de beurt; alleen Amerikaanse noteringen, want die heeft Finnhub gratis). Berichten die
// officieel zijn (een persbericht via een persbureau), een gerucht (een kop met "reportedly", "people familiar",
// "in talks" en dergelijke) of belangrijk (bestuur, overname, faillissement, onderzoek ...) komen in kv 'news_flash'
// (7 dagen) en op de nieuwspagina. Over een vers belangrijk bericht gaat één melding uit (regel alerts.news).
// De officiële SEC-deponeringen (8-K) voegt de site zelf toe uit ext2.filings.
const NEWS_WATCH_N = 5, FLASH_DAYS = 7, FLASH_MAX = 80, NEWS_PUSH_MAX = 3, NEWS_FRESH_MS = 3 * 3600e3;
const OFFICIAL_SRC = /business ?wire|pr ?newswire|globe ?newswire|accesswire|access newswire|newsfile|cision|press release|company release/i;
const RUMOUR_RE = /\b(reportedly|rumou?rs?|rumou?red|speculation|speculates?|unconfirmed|people (familiar|with knowledge|close to)|according to (people|sources|a person|persons)|sources? (say|said|says|tell|told)|said to be|is said to|in (early |advanced )?talks|weighs?|weighing|mulls?|mulling|considering|explores? (a )?(sale|bid|options|deal)|exploring (a )?(sale|bid|options|deal)|could be (sold|acquired|taken)|naar verluidt|geruchten?|zou (worden )?overwegen|in gesprek)\b/i;
const BREAKING_RE = /\b(ceo|chief executive|cfo|chairman|founder|resigns?|resignation|steps? down|ousted|fired|reinstated?|reinstates|appoints?|named (as )?(ceo|chief)|merger|merge|acquires?|acquisition|takeover|buyout|bids? for|tender offer|bankrupt(cy)?|chapter 11|insolven|fda (approv|reject|clear)|recall|investigation|probe|subpoena|indict|lawsuit|sues|sued|sec charges|antitrust|guidance|profit warning|warns|halts?|halted|suspends?|delist|stock split|dividend (cut|suspen)|layoffs?|job cuts|data breach|hack(ed)?|cyberattack|sanction|export (ban|curb|control)|ontslag|overname|faillissement|onderzoek naar)\b/i;
function newsKind(n) {
  const src = String((n && n.source) || ''), head = String((n && n.headline) || '');
  if (OFFICIAL_SRC.test(src) || /^(press release|form 8-k)\b/i.test(head)) return 'official';
  if (RUMOUR_RE.test(head + ' ' + String((n && n.summary) || ''))) return 'rumour';
  return null;
}
function newsBreaking(n) { return BREAKING_RE.test(String((n && n.headline) || '')); }
// Nieuwe berichten (Finnhub-vorm) toevoegen aan de lijst; geeft de berichten terug die er nog niet in stonden
function flashMerge(fl, tk, list, at) {
  const items = Array.isArray(fl.items) ? fl.items : [];
  const have = new Set(items.map((x) => x.url));
  const since = at - FLASH_DAYS * 864e5;
  const fresh = [];
  (Array.isArray(list) ? list : []).forEach((n) => {
    if (!n || !n.headline || !/^https:\/\//.test(String(n.url || '')) || have.has(n.url)) return;
    const t = Number(n.datetime) * 1000;
    if (!(t >= since) || t > at + 3600e3) return;
    const kind = newsKind(n), breaking = newsBreaking(n);
    if (!kind && !breaking) return;
    const o = { t, tk, headline: String(n.headline).slice(0, 220), source: String(n.source || '').slice(0, 60), url: String(n.url).slice(0, 500) };
    if (kind) o.kind = kind;
    if (breaking) o.breaking = true;
    items.push(o); have.add(o.url); fresh.push(o);
  });
  fl.items = items.filter((x) => x.t >= since).sort((a, b) => b.t - a.t).slice(0, FLASH_MAX);
  return fresh;
}
// Eén melding per vers belangrijk bericht (hoogstens drie per ronde), via alertOnce
async function newsPush(env, fresh, at) {
  if (!fresh.length || !(await pushSubs(env)).length) return 0;
  const rules = await alertRules(env);
  const how = rules.news || 'all';
  if (how === 'off') return 0;
  const st = await getSettings(env);
  const mute = new Set(((st.prefs && st.prefs.newsMute) || []).map((x) => String(x).toLowerCase()));
  const held = new Set((await heldStocks(env)).map((h) => h.ticker));
  let n = 0;
  for (const o of fresh.slice().sort((a, b) => b.t - a.t)) {
    if (n >= NEWS_PUSH_MAX) break;
    if (!o.breaking || o.t < at - NEWS_FRESH_MS || mute.has(o.source.toLowerCase())) continue;
    if (how === 'official' && o.kind !== 'official') continue;
    const label = o.kind === 'official' ? 'officieel bericht' : o.kind === 'rumour' ? 'gerucht' : 'belangrijk nieuws';
    const key = 'news|' + (await sha256Hex(o.url)).slice(0, 16);
    if (await alertOnce(env, key, { title: o.tk + ': ' + label + (held.has(o.tk) ? '' : ' (volglijst)'), body: o.headline, url: '#nieuws', tag: 'news-' + o.tk, urgent: true }, at)) n++;
  }
  return n;
}
// Berichten van een ander onderdeel (de dagelijkse onderzoeksronde) ook in de lijst en eventueel een melding
async function flashFromList(env, tk, list, at) {
  let fl = {};
  try { fl = JSON.parse((await getKv(env, 'news_flash')) || '{}'); } catch (e) { fl = {}; }
  const fresh = flashMerge(fl, tk, list, at);
  if (!fresh.length) return 0;
  await setKv(env, 'news_flash', JSON.stringify(fl));
  return newsPush(env, fresh, at);
}
async function newsWatch(env, at) {
  if (!env.FINNHUB_KEY || (await srcDown(env, 'finnhub'))) return 0;
  const held = await heldStocks(env);
  const watch = (await watchStocks(env)).filter((w) => !held.some((h) => h.symbol === w.symbol));
  const syms = [];
  for (const h of held.concat(watch)) { const us = await usTicker(env, h.symbol); if (us && !syms.some((x) => x.sym === us)) syms.push({ tk: h.ticker, sym: us }); }
  if (!syms.length) return 0;
  let fl = {};
  try { fl = JSON.parse((await getKv(env, 'news_flash')) || '{}'); } catch (e) { fl = {}; }
  const start = Number(fl.i) || 0, fresh = [];
  let calls = 0;
  for (let k = 0; k < Math.min(NEWS_WATCH_N, syms.length); k++) {
    const x = syms[(start + k) % syms.length];
    calls++;
    const r = await getJson(FINNHUB_BASE + '/company-news?symbol=' + encodeURIComponent(x.sym) + '&from=' + ymdUTC(at - 2 * 864e5) + '&to=' + ymdUTC(at) + '&token=' + encodeURIComponent(env.FINNHUB_KEY));
    if (r.status === 429) { await srcFail(env, 'finnhub', 'Finnhub-limiet (nieuwswacht)', true); break; }
    if (r.status === 401 || r.status === 403) break;
    if (r.ok) fresh.push(...flashMerge(fl, x.tk, r.body, at));
  }
  fl.i = (start + calls) % syms.length;
  await setKv(env, 'news_flash', JSON.stringify(fl));
  await newsPush(env, fresh, at);
  return calls;
}

// ---------- Reservekopie naar Cloudflare R2 (optioneel, elke dag) (idee 150) ----------
// Zet in wrangler.toml een R2-binding met de naam BACKUP (zie worker/README.md). Zonder binding gebeurt er niets:
// de rest van de Worker merkt er niets van. Bewaartermijn: 7 dagkopieën en 4 weekkopieën (zondag).
const R2_KEEP_DAILY = 7, R2_KEEP_WEEKLY = 4;
const R2_KEY_RE = /^(dag|week)\/\d{4}-\d{2}-\d{2}\.json$/;
async function r2Dump(env) {
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
  return out;
}
async function r2Backup(env, at, force) {
  if (!env.BACKUP) return null;
  const day = parts(at).day;
  // Eén kopie per dag; dezelfde dag nog eens overschrijft dezelfde sleutel (idee 155)
  if (!force && (await getKv(env, 'r2_last')) === day) return null;
  const body = JSON.stringify(await r2Dump(env));
  const meta = { httpMetadata: { contentType: 'application/json' } };
  await env.BACKUP.put('dag/' + day + '.json', body, meta);
  if (parts(at).weekday === 7) await env.BACKUP.put('week/' + day + '.json', body, meta);
  await r2Prune(env);
  await setKv(env, 'r2_last', day);
  return day;
}
// Te veel kopieën weghalen; 'backup-' is de oude naamgeving (wekelijks), die wordt opgeruimd
async function r2Prune(env) {
  for (const [prefix, keep] of [['dag/', R2_KEEP_DAILY], ['week/', R2_KEEP_WEEKLY], ['backup-', 0]]) {
    const listed = await env.BACKUP.list({ prefix });
    const keys = ((listed && listed.objects) || []).map((o) => o.key).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - keep))) await env.BACKUP.delete(k);
  }
}
async function r2Info(env) {
  if (!env.BACKUP) return { on: false, copies: [], keep: { daily: R2_KEEP_DAILY, weekly: R2_KEEP_WEEKLY } };
  const copies = [];
  for (const prefix of ['dag/', 'week/']) {
    const listed = await env.BACKUP.list({ prefix });
    ((listed && listed.objects) || []).forEach((o) => copies.push({ key: o.key, kind: prefix === 'dag/' ? 'dag' : 'week', bytes: o.size || null, at: o.uploaded ? new Date(o.uploaded).toISOString() : null }));
  }
  copies.sort((a, b) => b.key.localeCompare(a.key));
  return { on: true, copies, keep: { daily: R2_KEEP_DAILY, weekly: R2_KEEP_WEEKLY }, last: await getKv(env, 'r2_last') };
}
// Voorbeeld vóór terugzetten: wat zit erin en wat verandert er tegenover wat er nu in de database staat.
// Deze functie zet niets terug; terugzetten gaat via /api/restore met de regels uit de kopie.
async function r2Preview(env, key) {
  if (!env.BACKUP) throw new Error('Er is geen R2-bucket gekoppeld (binding BACKUP).');
  if (!R2_KEY_RE.test(String(key || ''))) throw new Error('Onbekende reservekopie.');
  const obj = await env.BACKUP.get(key);
  if (!obj) throw new Error('Deze reservekopie staat er niet (meer).');
  const txt = await obj.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('Deze reservekopie is onleesbaar.'); }
  const data = (j && j.data) || {};
  const nowCounts = (await backupPart(env, null, 0)).tables || {};
  const tables = Object.keys(BACKUP_TABLES).map((t) => {
    const n = Array.isArray(data[t]) ? data[t].length : 0;
    return { table: t, inBackup: n, inDatabase: Number(nowCounts[t] || 0), diff: n - Number(nowCounts[t] || 0) };
  });
  const wk = Array.isArray(data.weeks) ? data.weeks.map((r) => String(r[0])).sort() : [];
  return { preview: { key, created: (j && j.created) || null, bytes: txt.length, tables, weeksFrom: wk[0] || null, weeksTo: wk[wk.length - 1] || null } };
}

// =====================================================================
// ---------- Bronnen: budgetten, databasegrootte, sleuteltests en de bronnenpagina ----------

// ---------- Budget per bron (idee 152) ----------
// 'own' is wat de Worker zelf per dag aanhoudt (lager dan de grens van de bron, als buffer).
// Gratis limieten van Cloudflare zelf (per UTC-dag); de Worker telt mee via countingDb en fetch
const CF_BUDGETS = {
  d1_read: { name: 'Database (D1): gelezen rijen', limit: 5e6, note: 'Daarboven weigert de database tot middernacht UTC; de site toont dan de laatst bewaarde stand.' },
  d1_write: { name: 'Database (D1): geschreven rijen', limit: 1e5, note: 'Daarboven worden metingen pas na middernacht UTC weer bewaard.' },
  worker_req: { name: 'Worker: verzoeken van de site', limit: 1e5, note: 'Verzoeken van je apparaten; de metingen om de 10 minuten tellen hier niet mee.' },
};
const SRC_BUDGETS = {
  fmp: { name: 'Financial Modeling Prep', limit: 250, per: 'dag', own: FMP_DAY_BUDGET },
  alphavantage: { name: 'Alpha Vantage', limit: 25, per: 'dag', own: AV_DAY_BUDGET },
  twelvedata: { name: 'Twelve Data', limit: 800, per: 'dag' },
  tiingo: { name: 'Tiingo', limit: 1000, per: 'dag', own: TIINGO_DAY_BUDGET },
  marketaux: { name: 'Marketaux', limit: 100, per: 'dag', own: MX_DAY_BUDGET },
  polygon: { name: 'Polygon (Massive)', limit: 5, per: 'minuut' },
  finnhub: { name: 'Finnhub', limit: 60, per: 'minuut' },
  fred: { name: 'FRED', limit: 120, per: 'minuut' },
  sec: { name: 'SEC EDGAR', limit: 10, per: 'seconde' },
  openfigi: { name: 'OpenFIGI', limit: 25, per: 'minuut' },
  gdelt: { name: 'GDELT', limit: 12, per: 'minuut' },
};
async function budgetInfo(env) {
  const day = parts(new Date()).day;
  let usage = {}, fmpC = null, avC = null;
  try { usage = JSON.parse((await getKv(env, 'api_calls')) || '{}'); } catch (e) { usage = {}; }
  try { fmpC = JSON.parse((await getKv(env, 'fmp_calls')) || 'null'); } catch (e) { fmpC = null; }
  try { avC = JSON.parse((await getKv(env, 'av_calls')) || 'null'); } catch (e) { avC = null; }
  const own = {};
  for (const [src, key] of [['tiingo', 'tiingo_calls'], ['marketaux', 'mx_calls']]) {
    try { own[src] = JSON.parse((await getKv(env, key)) || 'null'); } catch (e) { own[src] = null; }
  }
  const today = usage[day] || {};
  let cf = {};
  try { cf = JSON.parse((await getKv(env, 'cf_usage')) || '{}'); } catch (e) { cf = {}; }
  const cfDay = new Date().toISOString().slice(0, 10);
  const cfNow = cf.day === cfDay ? cf : {};
  const cloud = Object.entries(CF_BUDGETS).map(([src, b]) => {
    const used = Number(cfNow[src] || 0);
    return { src, name: b.name, used, limit: b.limit, per: 'dag', utc: true, cloudflare: true, pct: Math.min(1, used / b.limit), note: b.note };
  });
  return { day, cfDay, cloudflare: cloud, saveMode: cfShare(cfNow) >= D1_SAVE_AT, trend: cfTrend(cf), sources: Object.entries(SRC_BUDGETS).map(([src, b]) => {
    let used = Number(today[src] || 0);
    // De eigen teller is de waarheid voor de dagbudgetten: die telt ook verzoeken van vóór vandaag mee als de dag gelijk is
    if (src === 'fmp' && fmpC && fmpC.day === day) used = Math.max(used, Number(fmpC.n) || 0);
    if (src === 'alphavantage' && avC && avC.day === day) used = Math.max(used, Number(avC.n) || 0);
    if (own[src] && own[src].day === day) used = Math.max(used, Number(own[src].n) || 0);
    const cap = b.own || b.limit;
    return { src, name: b.name, used, limit: b.limit, per: b.per, own: b.own || null, pct: b.per === 'dag' ? Math.min(1, used / cap) : null };
  }) };
}

// ---------- Databasegrootte in de gaten houden (idee 151) ----------
// D1 geeft geen grootte terug, dus de Worker schat: aantal regels maal een gemiddelde regel, plus de
// werkelijke lengte van de kv- en nieuwsregels. Bij meer dan 70% ruimt hij het nieuwsarchief op, bij 85%
// komt er een melding. De grens is die van het gratis plan (500 MB per database).
const DB_LIMIT_BYTES = 500e6;
const DB_CLEAN_AT = 0.7, DB_WARN_AT = 0.85;
const NEWS_MAX_ROWS = 40000;
const ROW_BYTES = { intraday: 70, hours: 110, days: 130, weeks: 70, positions: 70, orders: 150 };
async function dbWatch(env, clean, fresh) {
  if (!clean && !fresh) {
    try {
      const c = JSON.parse((await getKv(env, 'db_watch')) || 'null');
      if (c && c.tables && Date.now() - Date.parse(c.checkedAt || 0) < 26 * 3600e3) return c;
    } catch (e) { /* opnieuw tellen */ }
  }
  const one = async (sql) => { try { const r = await env.DB.prepare(sql).first(); return r ? Number(r.n) || 0 : 0; } catch (e) { return 0; } };
  const tables = {};
  let bytes = 0;
  for (const [t, b] of Object.entries(ROW_BYTES)) {
    const n = await one('SELECT COUNT(*) AS n FROM ' + t);
    tables[t] = { rows: n, bytes: n * b };
    bytes += n * b;
  }
  const kvBytes = await one('SELECT SUM(LENGTH(key) + LENGTH(value)) AS n FROM kv');
  tables.kv = { rows: await one('SELECT COUNT(*) AS n FROM kv'), bytes: kvBytes };
  bytes += kvBytes;
  const newsRows = await one('SELECT COUNT(*) AS n FROM news_hist');
  const newsBytes = await one("SELECT SUM(LENGTH(tk) + LENGTH(headline) + LENGTH(IFNULL(source, '')) + LENGTH(url) + LENGTH(IFNULL(summary, '')) + 24) AS n FROM news_hist");
  tables.news_hist = { rows: newsRows, bytes: newsBytes };
  bytes += newsBytes;
  const out = { checked: isoLocal(Date.now()), bytes, limit: DB_LIMIT_BYTES, pct: bytes / DB_LIMIT_BYTES, tables, newsKeep: NEWS_MAX_ROWS };
  if (!clean) return out;
  // Opruimen: eerst oud nieuws, dan het nieuwsarchief terug naar het maximum aantal regels
  const removed = [];
  const run = async (sql, arg, what) => {
    try { const r = await env.DB.prepare(sql).bind(arg).run(); const n = r.meta && r.meta.changes; if (n) removed.push(n + ' ' + what); } catch (e) { /* tabel bestaat (nog) niet */ }
  };
  await run('DELETE FROM news_hist WHERE t < ?', Date.now() - NEWS_KEEP_DAYS * 864e5, 'oude nieuwsregels');
  if (newsRows > NEWS_MAX_ROWS || out.pct > DB_CLEAN_AT) {
    await run('DELETE FROM news_hist WHERE t < (SELECT t FROM news_hist ORDER BY t DESC LIMIT 1 OFFSET ?)', NEWS_MAX_ROWS, 'nieuwsregels boven het maximum');
  }
  out.cleaned = removed.join(', ') || null;
  if (removed.length) {
    const after = await dbWatch(env, false, true);
    out.bytes = after.bytes; out.pct = after.pct; out.tables = after.tables;
  }
  if (out.pct > DB_WARN_AT && (await pushSubs(env)).length) {
    await alertOnce(env, 'db|' + parts(new Date()).day.slice(0, 7), { title: 'Database raakt vol',
      body: 'De database van je tracker is naar schatting ' + Math.round(out.pct * 100) + '% van 500 MB. Op de bronnenpagina staat waar de ruimte zit.', url: '#status', tag: 'db' });
  }
  out.checkedAt = new Date().toISOString();
  await setKv(env, 'db_watch', JSON.stringify(Object.assign({ at: out.checked }, out)));
  return out;
}

// ---------- Sleutel testen zonder hem op te slaan (idee 62) ----------
// De site stuurt de ingevulde sleutel (of niets, dan test de Worker de sleutel die er al staat). De Worker doet
// één klein verzoek en geeft alleen een uitslag terug: de sleutel wordt niet bewaard en niet teruggestuurd.
const KEY_TESTABLE = ['T212_KEY', 'T212_SECRET', 'FMP_KEY', 'FINNHUB_KEY', 'ALPHAVANTAGE_KEY', 'TWELVEDATA_KEY', 'TIINGO_KEY', 'POLYGON_KEY', 'MARKETAUX_KEY', 'OPENFIGI_KEY', 'FRED_KEY', 'SEC_CONTACT', 'RESEND_KEY'];
async function testKey(env, name, value) {
  if (!KEY_TESTABLE.includes(name)) throw new Error('Deze sleutel kan de Worker niet testen.');
  const given = typeof value === 'string' ? value.trim() : '';
  if (given.length > 300) throw new Error('Deze waarde is te lang.');
  const e = Object.create(env);
  if (given) e[name] = given;
  const key = String(e[name] || '');
  if (!key) return { state: 'leeg', message: 'Er is nog geen waarde ingevuld of opgeslagen.' };
  // Nooit de sleutel zelf in de uitslag
  const hide = (t) => String(t || '').split(key).join('…').slice(0, 200);
  const nope = (status) => (status === 401 || status === 403 ? { state: 'fout', message: 'De bron weigert deze sleutel (' + status + ').' }
    : status === 429 ? { state: 'limiet', message: 'De sleutel werkt, maar de bron zit aan zijn limiet (429).' }
      : { state: 'onbekend', message: 'De bron gaf ' + status + '; dat zegt niets over de sleutel. Probeer het later nog eens.' });
  try {
    if (name === 'T212_KEY' || name === 'T212_SECRET') {
      if (!e.T212_KEY || !e.T212_SECRET) return { state: 'leeg', message: 'Vul eerst beide in: de sleutel én het secret.' };
      const res = await fetch((e.T212_BASE || 'https://live.trading212.com') + '/api/v0/equity/account/summary', { headers: { Authorization: 'Basic ' + btoa(e.T212_KEY + ':' + e.T212_SECRET) } });
      if (res.status === 200) { const j = await res.json().catch(() => null); return { state: 'ok', message: 'Werkt' + (j && j.currency ? ' (rekening in ' + j.currency + ')' : '') + '.' }; }
      if (res.status === 401) return { state: 'fout', message: 'Trading 212 weigert deze combinatie (401). Controleer sleutel en secret.' };
      if (res.status === 403) return { state: 'fout', message: 'De sleutel mist het leesrecht voor je rekening (403).' };
      return nope(res.status);
    }
    if (name === 'FMP_KEY') {
      const res = await fetch(FMP_BASE + '/profile?symbol=AAPL&apikey=' + encodeURIComponent(key));
      if (res.status === 200) {
        const j = await res.json().catch(() => null);
        if (Array.isArray(j) && j.length) return { state: 'ok', message: 'Werkt (proefvraag voor Apple gaf een profiel terug).' };
        const msg = j && (j['Error Message'] || j.message);
        if (msg && /limit/i.test(String(msg))) return { state: 'limiet', message: 'De sleutel werkt, maar het dagbudget is op.' };
        return { state: 'fout', message: 'FMP gaf geen gegevens terug: ' + hide(msg || 'onbekende reden') };
      }
      return nope(res.status);
    }
    if (name === 'FINNHUB_KEY') {
      const r = await getJson(FINNHUB_BASE + '/quote?symbol=AAPL&token=' + encodeURIComponent(key));
      if (r.ok && r.body && Number(r.body.c) > 0) return { state: 'ok', message: 'Werkt (koers van Apple ontvangen).' };
      if (r.ok) return { state: 'fout', message: 'Finnhub antwoordde wel, maar zonder koers. Controleer de sleutel.' };
      return nope(r.status);
    }
    if (name === 'ALPHAVANTAGE_KEY') {
      const r = await getJson(AV_BASE + '?function=GLOBAL_QUOTE&symbol=AAPL&apikey=' + encodeURIComponent(key));
      const b = (r.ok && r.body) || {};
      const msg = b.Information || b.Note || b['Error Message'];
      if (b['Global Quote'] && Object.keys(b['Global Quote']).length) return { state: 'ok', message: 'Werkt (koers van Apple ontvangen).' };
      if (msg && /rate limit|requests per/i.test(String(msg))) return { state: 'limiet', message: 'De sleutel werkt, maar het budget van vandaag (25 verzoeken) is op.' };
      if (msg) return { state: 'fout', message: 'Alpha Vantage zegt: ' + hide(msg) };
      return r.ok ? { state: 'onbekend', message: 'Alpha Vantage gaf een leeg antwoord.' } : nope(r.status);
    }
    if (name === 'TWELVEDATA_KEY') {
      const r = await getJson('https://api.twelvedata.com/quote?symbol=AAPL&apikey=' + encodeURIComponent(key));
      const b = (r.ok && r.body) || {};
      if (b.close != null || b.symbol) return { state: 'ok', message: 'Werkt (koers van Apple ontvangen).' };
      if (Number(b.code) === 429) return { state: 'limiet', message: 'De sleutel werkt, maar de limiet is bereikt.' };
      if (b.message) return { state: 'fout', message: 'Twelve Data zegt: ' + hide(b.message) };
      return nope(r.status);
    }
    if (name === 'TIINGO_KEY') {
      const r = await getJson(TIINGO_BASE + '/tiingo/daily/aapl', { Authorization: 'Token ' + key, Accept: 'application/json' });
      if (r.ok && r.body && r.body.ticker) return { state: 'ok', message: 'Werkt (gegevens van Apple ontvangen).' };
      const d = String((r.body && r.body.detail) || '');
      if (r.status === 429 || /limit|exceeded/i.test(d)) return { state: 'limiet', message: 'De sleutel werkt, maar de limiet (50 per uur, 1000 per dag) is bereikt.' };
      if (/token|auth|not found/i.test(d) && r.ok) return { state: 'fout', message: 'Tiingo zegt: ' + hide(d) };
      return nope(r.status);
    }
    if (name === 'POLYGON_KEY') {
      const r = await getJson(POLYGON_BASE + '/v2/aggs/ticker/AAPL/prev', { Authorization: 'Bearer ' + key, Accept: 'application/json' });
      if (r.ok && r.body && (Array.isArray(r.body.results) || r.body.status === 'OK' || r.body.status === 'DELAYED')) return { state: 'ok', message: 'Werkt (slotkoers van Apple ontvangen).' };
      if (r.status === 429) return { state: 'limiet', message: 'De sleutel werkt, maar de limiet (5 verzoeken per minuut) is even bereikt.' };
      return nope(r.status);
    }
    if (name === 'OPENFIGI_KEY') {
      const r = await figiMap(key, [{ idType: 'ID_ISIN', idValue: 'US0378331005' }]);
      if (r.ok && Array.isArray(r.body) && r.body[0] && Array.isArray(r.body[0].data)) return { state: 'ok', message: 'Werkt (ISIN van Apple gevonden).' };
      return nope(r.status);
    }
    if (name === 'MARKETAUX_KEY') {
      const r = await getJson(MARKETAUX_BASE + '/news/all?symbols=AAPL&filter_entities=true&language=en&limit=1&api_token=' + encodeURIComponent(key));
      if (r.ok && r.body && Array.isArray(r.body.data)) return { state: 'ok', message: 'Werkt (nieuws over Apple ontvangen).' };
      if (r.status === 402) return { state: 'limiet', message: 'De sleutel werkt, maar het dagbudget (100 verzoeken) is op.' };
      if (r.status === 429) return { state: 'limiet', message: 'De sleutel werkt, maar er waren net te veel verzoeken; probeer het zo nog eens.' };
      return nope(r.status);
    }
    if (name === 'FRED_KEY') {
      const r = await getJson('https://api.stlouisfed.org/fred/series?series_id=SP500&file_type=json&api_key=' + encodeURIComponent(key));
      if (r.ok && r.body && r.body.seriess) return { state: 'ok', message: 'Werkt (reeks S&P 500 gevonden).' };
      if (r.status === 400) return { state: 'fout', message: 'FRED weigert deze sleutel (400). Een FRED-sleutel is 32 tekens.' };
      return nope(r.status);
    }
    if (name === 'SEC_CONTACT') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) return { state: 'fout', message: 'Dit is geen e-mailadres; de SEC vraagt een contactadres.' };
      const res = await fetch('https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json', { headers: { 'User-Agent': 'investment-tracker (' + key + ')', Accept: 'application/json' } });
      if (res.status === 200) return { state: 'ok', message: 'Werkt (de SEC antwoordt met dit contactadres).' };
      if (res.status === 403) return { state: 'fout', message: 'De SEC weigert het verzoek (403). Vul een echt e-mailadres in.' };
      if (res.status === 404) return { state: 'ok', message: 'De SEC antwoordt met dit contactadres (de proefvraag bestaat niet meer, dat is hier geen probleem).' };
      return nope(res.status);
    }
    if (name === 'RESEND_KEY') {
      const r = await getJson('https://api.resend.com/domains', { Authorization: 'Bearer ' + key });
      if (r.ok) return { state: 'ok', message: 'Werkt (Resend accepteert de sleutel).' };
      return nope(r.status);
    }
  } catch (err) {
    return { state: 'onbekend', message: 'De proefvraag lukte niet: ' + hide(err && err.message || err) };
  }
  return { state: 'onbekend', message: 'Geen proef beschikbaar.' };
}

// ---------- Alles voor de bronnenpagina (ideeën 61, 145, 147, 148, 149, 150, 151, 152) ----------
async function healthInfo(env) {
  let rejects = [], actions = [], map = {};
  try { rejects = JSON.parse((await getKv(env, 'data_rejects')) || '[]'); } catch (e) { rejects = []; }
  try { actions = JSON.parse((await getKv(env, 'corp_actions')) || '[]'); } catch (e) { actions = []; }
  try { map = JSON.parse((await getKv(env, 'ticker_map')) || '{}'); } catch (e) { map = {}; }
  return {
    now: isoLocal(Date.now()), day: parts(new Date()).day, tradingDay: tradingDay(Date.now()), usDay: usTradingDay(Date.now()),
    sources: await srcState(env), hist: await srcHistState(env), errors: JSON.parse((await getKv(env, 'ext_errors')) || '{}'),
    budgets: await budgetInfo(env), db: await dbWatch(env, false), rejects: rejects.slice(-20).reverse(), actions: actions.slice(-10).reverse(), tickerMap: map,
    r2: await r2Info(env), backoff: SRC_BACKOFF_MIN, keys: Object.fromEntries(KEY_TESTABLE.map((k) => [k, !!env[k]])),
  };
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
      try { await alert13F(env, label, cik, acc, top, (old && old.top) || []); } catch (e) { console.error('meldingen', e); }
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

// =====================================================================
// ---------- Kopen en verkopen (optioneel, staat standaard uit) ----------
// Alleen met de schakelaar "trading" en een Trading 212-sleutel met het recht om orders te plaatsen.
// Elke order: binnen je grens per order en per dag, met een eigen id tegen dubbel versturen, en in het logboek.
const TRADE_DEFAULTS = { perOrder: 500, perDay: 1000 };
const T212_TICKER = /^[A-Za-z0-9.\-]{1,20}(_[A-Z]{2,3})?_EQ$/;
function tradeLimits(s) {
  const t = (s && s.tradeLimits) || {};
  return { perOrder: isFinite(Number(t.perOrder)) && Number(t.perOrder) > 0 ? Number(t.perOrder) : TRADE_DEFAULTS.perOrder,
    perDay: isFinite(Number(t.perDay)) && Number(t.perDay) > 0 ? Number(t.perDay) : TRADE_DEFAULTS.perDay };
}
// Versturen naar Trading 212 zonder automatisch opnieuw proberen (een tweede poging kan een dubbele order geven)
async function t212Send(env, method, path, body) {
  const url = (env.T212_BASE || 'https://live.trading212.com') + path;
  const res = await fetch(url, { method, headers: { Authorization: 'Basic ' + btoa(env.T212_KEY + ':' + env.T212_SECRET), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const txt = await res.text().catch(() => '');
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
  return { ok: res.ok, status: res.status, body: j, text: txt.slice(0, 300) };
}
function t212Error(r) {
  if (r.status === 401) return 'Trading 212-sleutel ongeldig (401).';
  if (r.status === 403) return 'Je Trading 212-sleutel mag geen orders plaatsen (403). Maak in de Trading 212-app een sleutel met het recht om orders te plaatsen en sla die op bij Koppelingen.';
  if (r.status === 429) return 'Trading 212 vraagt even te wachten (te veel verzoeken). Er is niets verstuurd; probeer het over een minuut opnieuw.';
  const B = r.body && typeof r.body === 'object' ? r.body : null;
  // Trading 212 zet de reden soms in message/code, soms in type/title/detail (bijvoorbeeld quantity-precision-mismatch)
  const parts2 = B ? [B.message, B.code, B.error, B.title, B.detail, B.type ? String(B.type).split('/').pop() : null, B.errors ? JSON.stringify(B.errors) : null]
    .filter((x) => x != null && x !== '').map(String) : [];
  const m = [...new Set(parts2)].join(' – ') || (r.text || '').trim();
  const hint = precisionError(r) ? ' Dit instrument staat zoveel decimalen in het aantal niet toe; kies een rond aantal of een kleiner aantal decimalen.'
    : /insufficient|not enough|funds/i.test(m) ? ' Er staat niet genoeg vrij saldo op je rekening.'
    : /market.?closed|not.?open|trading.?hours/i.test(m) ? ' De beurs is nu dicht.' : '';
  return 'Trading 212 gaf ' + r.status + (m ? ': ' + m.slice(0, 200) : '') + '.' + hint;
}
// Weigering omdat het aantal te veel decimalen heeft voor dit instrument
const precisionError = (r) => /precision/i.test(JSON.stringify(r.body || '') + ' ' + (r.text || ''));
// Aantal decimalen van een aantal stuks (hoogstens 8)
const qtyDecimals = (q) => { const t = String(Number(q.toFixed(8))); const i = t.indexOf('.'); return i < 0 ? 0 : t.length - i - 1; };
async function tradeGuard(env) {
  if (!(await featureFlags(env)).trading) throw new Error('Kopen en verkopen staat uit. Zet het aan bij Instellingen, Koppelingen.');
  if (!env.T212_KEY || !env.T212_SECRET) throw new Error('De Trading 212-sleutel is nog niet ingesteld.');
}
async function tradeLog(env, entry) {
  let log = [];
  try { log = JSON.parse((await getKv(env, 'trade_log')) || '[]'); } catch (e) { log = []; }
  log.push(entry);
  await setKv(env, 'trade_log', JSON.stringify(log.slice(-50)));
}
// Nu bij Trading 212 kijken: één positie (aantal, waarde in euro, koers) en/of het vrije saldo.
// Zonder herhaalpogingen: bij een limiet (429) volgt een duidelijke melding, de site probeert het niet in een lus opnieuw.
function livePosOf(list, tk) {
  const q = String(tk || '');
  const p = (Array.isArray(list) ? list : []).find((x) => x && x.instrument && (x.instrument.ticker === q || shortTicker(x.instrument.ticker) === q));
  if (!p) return null;
  const qty = num(p.quantity);
  const avail = typeof p.quantityAvailableForTrading === 'number' ? p.quantityAvailableForTrading : qty;
  return { ticker: p.instrument.ticker, qty, avail, value: r2(num(p.walletImpact && p.walletImpact.currentValue)), price: num(p.currentPrice), cur: p.instrument.currency || null };
}
async function livePosition(env, tk) {
  const r = await t212Send(env, 'GET', '/api/v0/equity/positions');
  if (!r.ok) throw new Error(t212Error(r));
  return { found: livePosOf(r.body, tk) };
}
async function liveCheck(env, tk) {
  if (!env.T212_KEY || !env.T212_SECRET) throw new Error('De Trading 212-sleutel is nog niet ingesteld.');
  const out = { at: isoLocal(Date.now()), position: null, cash: null, errors: [] };
  if (tk) {
    if (!/^[A-Za-z0-9.\-_]{1,30}$/.test(String(tk))) throw new Error('Ongeldige ticker.');
    try { const L = await livePosition(env, tk); out.position = L.found; out.held = !!L.found; }
    catch (e) { out.errors.push('positie: ' + String(e && e.message || e).slice(0, 160)); }
  }
  const s = await t212Send(env, 'GET', '/api/v0/equity/account/summary');
  if (s.ok && s.body) out.cash = r2(num(s.body.cash && s.body.cash.availableToTrade));
  else out.errors.push('saldo: ' + t212Error(s));
  if (out.position == null && out.cash == null && out.errors.length) throw new Error(out.errors.join(' '));
  return out;
}
// Live koersen voor de site: alle posities nu bij Trading 212, niets opslaan. Een paar seconden in het geheugen,
// zodat open apparaten samen hoogstens één verzoek per QUOTES_MS doen. Bij een limiet (429) de vorige stand teruggeven.
// fast=<ticker>: ook de Finnhub-sleutel en het Amerikaanse symbool, zodat de browser zelf de trades kan volgen
// (alleen voor aandelen die in dollar op een Amerikaanse beurs noteren; anders wijken de koersen van elkaar af).
// us: ook de Finnhub-sleutel en de Amerikaanse symbolen van alle posities, zodat de site die per trade kan volgen (eens per half uur)
// ---------- Volglijst vaker bijwerken ----------
// De site vraagt zolang Bedrijven open is en de Amerikaanse beurs open is elke minuut de koers van hooguit WQ_MAX
// volgaandelen (rondgaand door de lijst). Finnhub /quote, alleen in het geheugen van deze Worker en een minuut
// bewaard: geen rij in D1 en hoogstens WQ_MAX Finnhub-verzoeken per aanroep. Alleen symbolen op je volglijst.
const WQ = new Map();
const WQ_MS = 60e3, WQ_MAX = 15;
async function watchQuotes(env, symsIn) {
  if (!env.FINNHUB_KEY) return { quotes: {}, why: 'Met een gratis Finnhub-sleutel komt de koers van je volglijst elke minuut binnen.' };
  const s = await getSettings(env);
  const wl = new Set((Array.isArray(s.watchlist) ? s.watchlist : []).map((x) => String(x).toUpperCase()));
  const syms = [...new Set(String(symsIn || '').split(',').map((x) => x.trim().toUpperCase()))]
    .filter((x) => /^[A-Z0-9.\-]{1,12}$/.test(x) && wl.has(x)).slice(0, WQ_MAX);
  const now = Date.now(), quotes = {};
  let limited = await srcDown(env, 'finnhub');
  for (const sym of syms) {
    let q = WQ.get(sym);
    if ((!q || now - q.t >= WQ_MS) && !limited) {
      const r = await getJson(FINNHUB_BASE + '/quote?symbol=' + encodeURIComponent(sym) + '&token=' + encodeURIComponent(env.FINNHUB_KEY));
      if (r.status === 429) { limited = true; await srcFail(env, 'finnhub', 'Finnhub-limiet (volglijst)', true); }
      else if (r.ok && r.body) {
        // c = koers, dp = verandering vandaag in procenten, t = tijd van de koers (seconden); 0 = Finnhub kent het symbool niet
        q = { t: now, c: numOrNull(r.body.c), dp: numOrNull(r.body.dp), at: numOrNull(r.body.t) ? r.body.t * 1000 : null };
        WQ.set(sym, q);
      }
    }
    if (q) quotes[sym] = q;
  }
  return { quotes, limited };
}

async function liveQuotes(env, fast, us) {
  if (!env.T212_KEY || !env.T212_SECRET) throw new Error('De Trading 212-sleutel is nog niet ingesteld.');
  if (fast != null && !/^[A-Za-z0-9.\-]{1,20}$/.test(String(fast))) throw new Error('Ongeldige ticker.');
  let stale = false;
  if (!QUOTES.out || Date.now() - QUOTES.t >= QUOTES_MS) {
    const r = await t212Send(env, 'GET', '/api/v0/equity/positions');
    if (r.ok && Array.isArray(r.body)) {
      const positions = r.body.filter((p) => p && p.instrument).map((p) => ({
        tk: shortTicker(p.instrument.ticker), t212: p.instrument.ticker, cur: p.instrument.currency || null,
        price: num(p.currentPrice), qty: num(p.quantity), value: r2(num(p.walletImpact && p.walletImpact.currentValue)),
      }));
      QUOTES.t = Date.now();
      QUOTES.out = { at: QUOTES.t, positions, total: r2(positions.reduce((a, p) => a + p.value, 0)) };
    } else if (r.status === 429 && QUOTES.out) stale = true;
    else throw new Error(r.status === 429 ? 'Trading 212 vraagt even te wachten (te veel verzoeken).' : t212Error(r));
  }
  const out = Object.assign({ stale }, QUOTES.out);
  if (fast) {
    const p = out.positions.find((x) => x.tk === fast);
    const sym = p && p.cur === 'USD' && /_US_EQ$/.test(p.t212 || '') ? await usTicker(env, p.tk) : null;
    out.fast = { sym, key: sym && env.FINNHUB_KEY ? env.FINNHUB_KEY : null, held: !!p };
    // Niet in je portefeuille maar wel op je volglijst: Trading 212 geeft daar geen koers van. Een symbool zonder
    // beursachtervoegsel (geen ".AS", ".DE" …) staat op een Amerikaanse beurs; dat kan de site via Finnhub per trade volgen.
    if (!p) {
      const watch = ((await getSettings(env)).watchlist || []).includes(String(fast).toUpperCase());
      if (watch) {
        const ws = /^[A-Z]{1,6}(-[A-Z])?$/.test(String(fast)) ? String(fast) : null;
        out.fast = { sym: ws, key: ws && env.FINNHUB_KEY ? env.FINNHUB_KEY : null, held: false, watch: true };
      }
    }
  }
  if (us && env.FINNHUB_KEY) {
    const syms = {};
    for (const p of out.positions) {
      const sym = p.cur === 'USD' && /_US_EQ$/.test(p.t212 || '') ? await usTicker(env, p.tk) : null;
      if (sym) syms[p.tk] = sym;
    }
    out.us = { key: env.FINNHUB_KEY, syms };
  }
  return out;
}
const floor4 = (x) => Math.floor(x * 10000 + 1e-9) / 10000;

async function placeOrder(env, b) {
  await tradeGuard(env);
  const L = tradeLimits(await getSettings(env));
  const side = b && b.side === 'SELL' ? 'SELL' : b && b.side === 'BUY' ? 'BUY' : null;
  if (!side) throw new Error('Kies kopen of verkopen.');
  const type = b.type === 'limit' ? 'limit' : 'market';
  let qty = Number(b.quantity);
  if (!(qty > 0) || qty > 1e6) throw new Error('Ongeldig aantal.');
  const ticker = String(b.ticker || '');
  if (!T212_TICKER.test(ticker)) throw new Error('Onbekend instrument (' + ticker.slice(0, 30) + ').');
  const clientId = String(b.clientId || '');
  if (!/^[A-Za-z0-9-]{8,40}$/.test(clientId)) throw new Error('Order-id ontbreekt; open het orderscherm opnieuw.');
  const limitPrice = Number(b.limitPrice);
  if (type === 'limit' && !(limitPrice > 0)) throw new Error('Vul een limietprijs in.');
  // Wat de positie nu is (voor verkopen en een eigen schatting van het bedrag)
  let pe = {};
  try { pe = JSON.parse((await getKv(env, 'pos_extra')) || '{}'); } catch (e) { pe = {}; }
  const short = Object.keys(pe).find((k) => pe[k] && pe[k].t212 === ticker) || null;
  let held = null;
  if (short) held = await env.DB.prepare('SELECT value, qty FROM intraday WHERE ticker = ? ORDER BY ts DESC LIMIT 1').bind(short).first().catch(() => null);
  // Verkopen: eerst bij Trading 212 kijken wat je nu echt hebt en wat het waard is (de meting kan tien minuten oud zijn).
  // Lukt dat niet, dan geldt de laatste meting.
  let basis = 'meting';
  if (side === 'SELL') {
    try {
      const L = await livePosition(env, ticker);
      if (L.found) { held = { qty: L.found.avail, value: L.found.qty > 0 ? L.found.value * L.found.avail / L.found.qty : 0 }; basis = 'live'; }
      else held = { qty: 0, value: 0 };
    } catch (e) { /* laatste meting gebruiken */ }
    if (!held || !(held.qty > 0)) throw new Error('Je hebt dit aandeel niet (of het zit in een pie); verkopen kan niet.');
    const fraction = Number(b.fraction), valueEur = Number(b.valueEur);
    if (b.fraction != null) {
      // Deel van je positie: hetzelfde deel van wat je nu echt hebt
      if (!(fraction > 0 && fraction <= 1)) throw new Error('Ongeldig deel van je positie.');
      qty = fraction >= 0.99995 ? held.qty : floor4(fraction * held.qty);
    } else if (b.valueEur != null && type === 'market') {
      // Vast bedrag: zoveel stuks als dat bedrag nu waard is, nooit meer dan je hebt
      if (!(valueEur > 0)) throw new Error('Ongeldig bedrag.');
      const per = held.value / held.qty;
      if (!(per > 0)) throw new Error('De koers is nu onbekend; probeer het zo opnieuw.');
      qty = Math.min(held.qty, floor4(valueEur / per));
    }
    if (!(qty > 0)) throw new Error('Het aantal komt uit op 0; maak de order groter.');
    if (qty > held.qty * 1.000001) throw new Error('Je hebt maar ' + held.qty + ' stuks.');
  }
  const est = Number(b.estEur);
  const serverEst = held && held.qty > 0 ? held.value / held.qty * qty : null;
  let eur = side === 'SELL' && (b.fraction != null || b.valueEur != null) && serverEst > 0 ? serverEst : Math.max(isFinite(est) && est > 0 ? est : 0, serverEst || 0);
  if (!(eur > 0)) throw new Error('Het geschatte bedrag ontbreekt.');
  if (eur > L.perOrder) throw new Error('Deze order (± €' + eur.toFixed(2) + ') is groter dan je grens per order (€' + L.perOrder + '). Pas de grens aan bij Koppelingen als dat de bedoeling is.');
  const day = parts(new Date()).day;
  let td = {};
  try { td = JSON.parse((await getKv(env, 'trade_day')) || '{}'); } catch (e) { td = {}; }
  const used = td.day === day ? Number(td.eur) || 0 : 0;
  if (used + eur > L.perDay) throw new Error('Hiermee kom je boven je grens per dag (€' + L.perDay + '; vandaag al ± €' + used.toFixed(2) + ').');
  // Dezelfde order nooit twee keer: het id wordt bewaard vóór het versturen
  let ids = {};
  try { ids = JSON.parse((await getKv(env, 'trade_ids')) || '{}'); } catch (e) { ids = {}; }
  if (ids[clientId]) throw new Error('Deze order is al verstuurd.');
  ids[clientId] = Date.now();
  Object.keys(ids).forEach((k) => { if (ids[k] < Date.now() - 3 * 864e5) delete ids[k]; });
  await setKv(env, 'trade_ids', JSON.stringify(ids));
  const send = (q) => t212Send(env, 'POST', '/api/v0/equity/orders/' + type, type === 'limit'
    ? { ticker, quantity: side === 'SELL' ? -q : q, limitPrice, timeValidity: b.validity === 'GTC' ? 'GOOD_TILL_CANCEL' : 'DAY' }
    : { ticker, quantity: side === 'SELL' ? -q : q });
  let r = await send(qty);
  // Te veel decimalen voor dit instrument: Trading 212 weigert de order (400) en plaatst dan niets.
  // Dan opnieuw met telkens één decimaal minder (tot één decimaal), nooit naar boven afgerond.
  const asked = qty;
  for (let dec = Math.min(qtyDecimals(qty), 5) - 1, tries = 0; !r.ok && r.status === 400 && precisionError(r) && dec >= 1 && tries < 4; dec--) {
    const q2 = Math.floor(qty * 10 ** dec + 1e-9) / 10 ** dec;
    if (!(q2 > 0) || q2 >= qty) continue;
    qty = q2; tries++;
    r = await send(qty);
  }
  if (qty !== asked) eur = eur * qty / asked;
  const entry = { t: isoLocal(Date.now()), clientId, ticker, side, type, qty, limitPrice: type === 'limit' ? limitPrice : null, estEur: Math.round(eur * 100) / 100,
    ok: r.ok, id: r.body && r.body.id != null ? r.body.id : null, status: r.body && r.body.status ? r.body.status : null, error: r.ok ? null : t212Error(r) };
  await tradeLog(env, entry);
  if (!r.ok) throw new Error(entry.error);
  await setKv(env, 'trade_day', JSON.stringify({ day, eur: used + eur }));
  return { order: r.body, entry, qty, basis, rounded: qty !== asked };
}
async function openOrders(env) {
  await tradeGuard(env);
  const r = await t212Send(env, 'GET', '/api/v0/equity/orders');
  if (!r.ok) throw new Error(t212Error(r));
  let log = [];
  try { log = JSON.parse((await getKv(env, 'trade_log')) || '[]'); } catch (e) { log = []; }
  const L = tradeLimits(await getSettings(env));
  let td = {};
  try { td = JSON.parse((await getKv(env, 'trade_day')) || '{}'); } catch (e) { td = {}; }
  const open = (Array.isArray(r.body) ? r.body : []).map((o) => ({ id: o.id, ticker: o.ticker, type: o.type, status: o.status, quantity: o.quantity, filled: o.filledQuantity, limitPrice: o.limitPrice, stopPrice: o.stopPrice, created: o.creationTime }));
  return { open, log: log.slice(-20).reverse(), limits: L, today: td.day === parts(new Date()).day ? Number(td.eur) || 0 : 0 };
}
async function cancelOrder(env, id) {
  await tradeGuard(env);
  if (!/^\d{1,20}$/.test(String(id))) throw new Error('Ongeldig order-id.');
  const r = await t212Send(env, 'DELETE', '/api/v0/equity/orders/' + id);
  await tradeLog(env, { t: isoLocal(Date.now()), cancel: String(id), ok: r.ok, error: r.ok ? null : t212Error(r) });
  if (!r.ok) throw new Error(t212Error(r));
  return { cancelled: String(id) };
}
// Lijst van verhandelbare instrumenten (één keer per week), om een Trading 212-ticker bij een symbool te vinden
async function fetchInstruments(env) {
  if (!(await featureFlags(env)).trading) return 0;
  let list;
  try { list = await t212(env, '/api/v0/equity/metadata/instruments'); } catch (e) { await noteExtError(env, 'trading', String(e && e.message || e).slice(0, 120)); return 1; }
  const rows = (Array.isArray(list) ? list : []).filter((x) => x && x.ticker && /STOCK|ETF/i.test(x.type || 'STOCK'))
    .map((x) => [x.ticker, String(x.shortName || '').toUpperCase(), String(x.name || '').slice(0, 60), x.currencyCode || '', /ETF/i.test(x.type || '') ? 'ETF' : 'STOCK']);
  await setKv(env, 'instruments', JSON.stringify({ updated: parts(new Date()).day, rows }));
  return 1;
}
async function searchInstruments(env, q) {
  await tradeGuard(env);
  const Q = String(q || '').trim().toUpperCase().slice(0, 40);
  if (!Q) return [];
  let I = null;
  try { I = JSON.parse((await getKv(env, 'instruments')) || 'null'); } catch (e) { I = null; }
  if (!I) { await fetchInstruments(env); try { I = JSON.parse((await getKv(env, 'instruments')) || 'null'); } catch (e) { I = null; } }
  const rows = (I && I.rows) || [];
  const exact = rows.filter((r) => r[1] === Q), starts = rows.filter((r) => r[1] !== Q && r[1].startsWith(Q)), named = rows.filter((r) => !r[1].startsWith(Q) && r[2].toUpperCase().includes(Q));
  return exact.concat(starts.slice(0, 6), named.slice(0, 6)).slice(0, 12).map((r) => ({ ticker: r[0], short: r[1], name: r[2], cur: r[3], kind: r[4] }));
}
