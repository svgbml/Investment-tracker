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
 * Geheimen (stel je zelf in bij Cloudflare): T212_KEY, T212_SECRET, WEB_TOKEN.
 */

const TZ = 'Europe/Amsterdam';
const LIVE_WEEKDAYS = [1, 2, 3, 4, 5];
const LIVE_START = '08:00';
const LIVE_END = '22:30';
const KEEP_INTRADAY_MS = 3 * 864e5;
const HOUR_MS = 3600e3;
const TOTAL = 'TOTAAL';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env, new Date(event.scheduledTime), false)
      .then(() => setKv(env, 'last_cron', new Date().toISOString()))
      .catch(async (e) => {
        console.error('tick', e);
        try { await setKv(env, 'last_error', new Date().toISOString() + ' ' + String(e && e.message || e)); } catch (_) {}
      }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (!authorized(request, url, env)) {
      return json({ ok: false, error: 'Ongeldige of ontbrekende toegangscode.' }, 401, cors);
    }
    try {
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
  if (!env.T212_KEY || !env.T212_SECRET) throw new Error('T212_KEY en T212_SECRET zijn nog niet ingesteld.');
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
    msgs.push(`${positions.length} posities gemeten (totaal €${total.toFixed(2)}).`);
  }

  const p = parts(now);
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
  const account = r2(num(sum.investments.currentValue) + cash);

  const stmts = [env.DB.prepare('INSERT OR REPLACE INTO weeks (date, account_value, net_deposits, cash, cost_basis, source) VALUES (?,?,?,?,?,?)')
    .bind(day, account, r2(netDeposits), r2(cash), r2(num(sum.investments.totalCost)), 'API')];
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
    'SELECT ts, ticker, name, value, unrealized FROM intraday ORDER BY ts'
  ).all();

  // Posities: laatste meting, anders laatste weeksnapshot
  let positions = [], positionsDate = null;
  if (intra.length) {
    const lastTs = intra[intra.length - 1].ts;
    positionsDate = isoLocal(lastTs);
    positions = intra.filter((r) => r.ts === lastTs && r.ticker !== TOTAL).map((r) => ({
      ticker: r.ticker, name: r.name, value: r.value, unrealized: r.unrealized,
      cost: r2(r.value - r.unrealized), resultPct: r.value - r.unrealized ? r.unrealized / (r.value - r.unrealized) : 0,
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

  return {
    ok: true,
    generated: isoLocal(now),
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
