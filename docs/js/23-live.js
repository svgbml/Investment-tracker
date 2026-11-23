/* Investeringstracker – Live koersen en snelle modus
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html).
 *
 * Live: zolang de pagina in beeld is elke 5 seconden alle posities bij Trading 212 (via /api/quotes van de Worker).
 * Alleen de getallen veranderen (totaal, verandering vandaag, waarde per positie); de grafieken blijven bij de
 * metingen van 10 minuten. Er wordt niets opgeslagen. Komt er zes keer niets nieuws (beurs dicht), dan eens per minuut.
 *
 * Snelle modus: voor één aandeel elke trade via de WebSocket van Finnhub (alleen dollaraandelen op een Amerikaanse
 * beurs), als kaarsengrafiek (30 seconden of 1 minuut per kaars). Elke minuut vergelijkt de site die koers met die van Trading 212. Voor andere aandelen
 * (of zonder Finnhub-sleutel) de koers van Trading 212 elke 2 seconden. De vergelijking met Trading 212 loopt op de
 * achtergrond; alleen bij een verschil van meer dan 0,5% toont de tegel een waarschuwing. */
'use strict';

const LIVE_MS = 5000, LIVE_FAST_MS = 2000, LIVE_SLOW_MS = 60000, LIVE_MAX_AGE = 120000;
const LS_LIVE = 'tracker.live';
const fLiveT = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const liveQ = {
  on: (() => { try { return localStorage.getItem(LS_LIVE) !== '0'; } catch (e) { return true; } })(),
  snap: null, timer: 0, same: 0, fails: 0, busy: false, demoK: new Map(),
};
const setTxt = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const liveAllowed = () => !sharedView && (demo || (isWorker() && !!getToken()));
const liveWanted = () => liveAllowed() && !!M && (liveQ.on || !!fastQ.tk);
const liveFresh = () => !!liveQ.snap && Date.now() - liveQ.snap.got < LIVE_MAX_AGE;

// Na elke tekening (render in js/10-navigatie.js): de live stand er weer overheen en de volgende vraag plannen
function liveKick() {
  livePills();
  liveApply();
  fastPaint();
  if (!liveQ.busy) liveSchedule(liveQ.snap ? 1000 : 0);
}
function liveSchedule(ms) { clearTimeout(liveQ.timer); liveQ.timer = setTimeout(livePoll, ms); }
function liveDelay() {
  if (liveQ.fails) return Math.min(LIVE_SLOW_MS, LIVE_MS * 2 ** liveQ.fails);
  if (fastQ.tk && fastQ.src === 't212') return LIVE_FAST_MS;
  if (liveQ.on) return liveQ.same >= 6 ? LIVE_SLOW_MS : LIVE_MS;
  return LIVE_SLOW_MS;   // alleen de snelle modus via Finnhub: Trading 212 is dan alleen de controle van elke minuut
}
// Volgende vraag pas na het antwoord op de vorige: bij een trage verbinding komen ze niet op elkaar te staan
async function livePoll() {
  clearTimeout(liveQ.timer);
  if (!liveWanted() || document.hidden) return;
  liveQ.busy = true;
  try {
    const s = demo ? demoQuotes() : await workerCall('/api/quotes');
    s.got = Date.now();
    liveQ.same = liveQ.snap && liveQ.snap.total === s.total ? liveQ.same + 1 : 0;
    liveQ.snap = s;
    liveQ.fails = 0;
    liveApply();
    fastFromSnap(s, false);
  } catch (e) { liveQ.fails++; }
  liveQ.busy = false;
  livePills();
  liveSchedule(liveDelay());
}

// Alleen tekst vervangen, niets opnieuw tekenen: dat blijft licht, ook op een trage telefoon
function liveApply() {
  const s = liveQ.snap;
  if (!liveQ.on || !M || !liveFresh()) return;
  const T = M.tot;
  const d = s.total - M.totalValue;
  const p = mode === 'm' ? 'm-' : '';
  setTxt($(p + 'hero-label'), heroLabelText(s.got, s.total));
  countTo($(p + 'hero-value'), heroAmount() + d, eur);
  if (!calmMode() && isNum(T.change)) {
    const before = M.totalValue - T.change;
    const ch = { change: T.change + d, changePct: before > 0 ? (T.change + d) / before : null };
    if (p) {
      const h = '<span class="pill-chg ' + tone(ch.change) + '">' + esc(changeLine(ch)) + '</span><span class="base" style="padding:6px 0 0">' + esc(baseText(T)) + '</span>';
      const el = $('m-hero-change');
      if (el && el.innerHTML !== h) el.innerHTML = h;
    } else {
      const el = $('hero-change');
      setTxt(el, changeLine(ch) + ', ' + baseText(T));
      if (el) el.className = 'hero-change ' + tone(ch.change);
    }
  }
  const vals = new Map(s.positions.map((x) => [x.tk, x.value]));
  $$('#list-grid [data-ticker] .v, #m-list-rows [data-ticker] .v').forEach((el) => {
    const v = vals.get(/** @type {HTMLElement} */ (el.closest('[data-ticker]')).dataset.ticker);
    if (isNum(v)) setTxt(el, eur(v));
  });
}

function livePills() {
  const ok = liveAllowed() && !!M;
  const t = !liveQ.on ? T('Live uit') : liveQ.fails ? T('Live: geen verbinding') : 'Live';
  $$('[data-live-toggle]').forEach((b) => {
    b.hidden = !ok;
    b.setAttribute('aria-pressed', String(liveQ.on));
    b.classList.toggle('on', liveQ.on && !liveQ.fails && liveFresh());
    setTxt(b, t);
    b.title = liveQ.on ? T('Koersen elke 5 seconden van Trading 212. Klik om uit te zetten.') : T('Klik om de koersen elke 5 seconden te volgen.');
  });
}

document.addEventListener('click', (e) => {
  const b = /** @type {Element} */ (e.target).closest && /** @type {Element} */ (e.target).closest('[data-live-toggle]');
  if (!b) return;
  liveQ.on = !liveQ.on;
  try { localStorage.setItem(LS_LIVE, liveQ.on ? '1' : '0'); } catch (err) { /* geldt dan alleen tot herladen */ }
  if (liveQ.on) liveKick();
  else { livePills(); refresh('home', 'list'); }   // terug naar de laatste meting
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { fastPause(); return; }
  if (liveWanted()) liveSchedule(300);
  fastResume();
});

// Voorbeeld (?demo): koersen die een beetje bewegen
function demoQuotes() {
  const positions = M.companies.map((c) => {
    const k = (liveQ.demoK.get(c.tk) || 1) * (1 + (Math.random() - 0.5) * 0.002);
    liveQ.demoK.set(c.tk, k);
    const last = fastQ.tk === c.tk ? fastQ.last : null;
    const price = last ? last * (1 + (Math.random() - 0.5) * 0.0006) : (c.priceNative || 0) * k;
    const value = last && c.priceNative ? c.value * price / c.priceNative : c.value * k;
    return { tk: c.tk, cur: c.cur || 'EUR', qty: c.qty, price, value: Math.round(value * 100) / 100 };
  });
  return { at: Date.now(), got: 0, stale: false, positions, total: Math.round(positions.reduce((a, x) => a + x.value, 0) * 100) / 100 };
}

// =====================================================================
// ---------- Snelle modus: elke trade van één aandeel, als kaarsen van 30 seconden of 1 minuut ----------
// Trades gaan meteen in blokjes van 30 seconden (open, hoog, laag, slot); losse trades worden niet bewaard,
// dus ook een druk aandeel kost weinig geheugen. Kaarsen van 1 minuut zijn twee blokjes samen.
const FAST_BUCKET = 30e3, FAST_KEEP = 60 * 60e3, FAST_SYNC_MS = 60e3, FAST_SYNC_WARN = 0.005;
const FAST_SIZES = [[30e3, '30 s'], [60e3, '1 min']];
const FAST_WINS = [[5 * 60e3, '5 min'], [15 * 60e3, '15 min'], [60 * 60e3, '1 uur']];
const fastQ = {
  tk: /** @type {string|null} */ (null), sym: null, src: '', ws: /** @type {WebSocket|null} */ (null),
  bars: /** @type {{t:number,o:number,h:number,l:number,c:number,n:number}[]} */ ([]), last: null, lastT: 0,
  syncs: [], size: 30e3, win: 15 * 60e3, fx: null, qty: null, cur: null,
  note: '', lastSync: 0, raf: 0, sim: 0, paused: false,
};

// Noteert het aandeel in dollar op een Amerikaanse beurs? Alleen dan kan Finnhub elke trade leveren; anders vraagt de
// snelle modus elke 2 seconden Trading 212 via de Worker, en dat kost verzoeken. null: onbekend.
function fastUsListed(tk) {
  const x = ((data && data.posExtra) || {})[tk];
  if (!x) return null;
  return x.t212 ? /_US_EQ$/.test(x.t212) && x.cur === 'USD' : x.cur === 'USD';
}
const FAST_WARN_PRE = 'Dit aandeel noteert niet in dollar op een Amerikaanse beurs. De snelle modus kan dan geen losse trades volgen en vraagt elke 2 seconden de koers van Trading 212 via je Worker: ongeveer 1.800 verzoeken per uur, van de 100.000 per dag die het gratis plan van Cloudflare toestaat. Zet hem weer uit als je klaar bent.';
const FAST_WARN_ON = 'Let op: de snelle modus vraagt nu elke 2 seconden de koers van Trading 212 via je Worker, ongeveer 1.800 verzoeken per uur (het gratis plan van Cloudflare staat 100.000 per dag toe). Zet hem weer uit als je klaar bent.';

function fastTile(c) {
  if (!liveAllowed()) return '';
  const on = fastQ.tk === c.tk;
  fastPaint();   // koptekst en grafiek vullen na het tekenen
  const seg = (attr, list, label) => tpl`<div class="seg" role="group" aria-label="${label}">${list.map(([ms, l]) => tpl`<button type="button" ${raw(attr)}="${ms}" aria-pressed="false">${l}</button>`)}</div>`;
  return String(tpl`<section class="tile pad fast-tile" data-fast-tk="${c.tk}">
    <div class="fast-head"><h3>${T('Live koers')}</h3><button type="button" class="btn ghost" data-fast-btn aria-pressed="false">${T('Snelle modus')}</button></div>
    <div class="fast-top"><div><p class="fast-lbl">${T('Koers per aandeel')}</p><p class="fast-price">${money(c.priceNative, c.cur)}</p><p class="small fast-day"></p></div>
      <div class="fast-pos"><p class="fast-lbl">${T('Jouw positie')}</p><p class="fast-val">${eur(c.value)}</p><p class="small fast-pl"></p></div></div>
    <p class="small fast-warn" hidden></p>
    <p class="sub fast-sub"></p>
    <div class="fast-ctl" hidden>${seg('data-fast-size', FAST_SIZES, 'Grootte van een kaars')}${seg('data-fast-win', FAST_WINS, 'Periode van de grafiek')}</div>
    <canvas class="fast-chart" role="img" aria-label="${'Kaarsengrafiek van ' + c.name + ' tijdens de snelle modus'}" hidden></canvas>
    <p class="small loss fast-sync" role="status"></p>
    <p class="sub">${T('De snelle modus volgt elke trade van dit aandeel via Finnhub (Amerikaanse aandelen, met een Finnhub-sleutel); anders elke 2 seconden de koers van Trading 212. Elke kaars is 30 seconden of 1 minuut: groen als de koers in die tijd steeg, rood als hij daalde. Op de achtergrond vergelijkt de tracker elke minuut beide bronnen; alleen als ze meer dan 0,5% verschillen, zie je een waarschuwing. Er wordt niets opgeslagen.')}</p>
  </section>`);
}

async function fastStart(tk, keep) {
  const kept = keep ? { bars: fastQ.bars, syncs: fastQ.syncs, last: fastQ.last, lastT: fastQ.lastT } : { bars: [], syncs: [], last: null, lastT: 0 };
  fastStop();
  const c = M && M.companies.find((x) => x.tk === tk);
  Object.assign(fastQ, kept, { tk, sym: null, src: '', note: T('Verbinden…'), lastSync: 0, paused: false,
    qty: c ? c.qty : null, cur: c ? c.cur : null, fx: null });
  fastPaint();
  if (demo) {
    // Zoals in het echt: buiten de VS geen losse trades, maar de (voorbeeld)koers van Trading 212 elke 2 seconden
    const us = fastUsListed(tk) !== false;
    Object.assign(fastQ, { src: us ? 'demo' : 't212', sym: tk, note: '' });
    if (!keep) fastDemoHistory(c);
    if (us) fastQ.sim = setInterval(fastDemoTick, 200);
    liveSchedule(0);
    return;
  }
  try {
    const r = await workerCall('/api/quotes?fast=' + encodeURIComponent(tk));
    if (fastQ.tk !== tk) return;
    r.got = Date.now();
    liveQ.snap = r;
    const f = r.fast || {};
    if (f.sym && f.key) { fastQ.sym = f.sym; fastOpen(f.key); }
    else {
      fastQ.src = 't212';
      fastQ.note = !f.held ? T('Trading 212 meldt dit aandeel niet (meer) in je portefeuille.')
        : f.sym ? T('Geen Finnhub-sleutel ingesteld: koers van Trading 212 elke 2 seconden.')
        : T('Finnhub heeft dit aandeel niet gratis (het noteert niet in dollar op een Amerikaanse beurs): koers van Trading 212 elke 2 seconden.');
    }
    fastFromSnap(r, true);
  } catch (e) {
    if (fastQ.tk !== tk) return;
    fastQ.src = 't212';
    fastQ.note = 'De snelle modus kon niet starten: ' + String(e && e.message || e).slice(0, 160);
  }
  liveSchedule(liveDelay());
  fastPaint();
}

function fastOpen(key) {
  fastQ.src = 'finnhub';
  fastQ.note = T('Verbinden met Finnhub…');
  const sym = fastQ.sym;
  let ws;
  try { ws = new WebSocket('wss://ws.finnhub.io?token=' + encodeURIComponent(key)); }
  catch (e) { fastFallback('Finnhub niet bereikbaar'); return; }
  fastQ.ws = ws;
  ws.onopen = () => { ws.send(JSON.stringify({ type: 'subscribe', symbol: sym })); fastQ.note = T('Verbonden; wacht op trades. Buiten de handelsuren van de Amerikaanse beurs komen er geen.'); fastPaint(); };
  ws.onmessage = (e) => {
    let m = null;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m && m.type === 'trade' && Array.isArray(m.data)) {
      m.data.forEach((d) => { if (d && d.s === sym && d.p > 0 && isNum(d.t)) fastAdd(d.t, d.p); });
      fastQ.note = '';
      fastPaint();
    } else if (m && m.type === 'error') fastFallback('Finnhub: ' + String(m.msg || 'fout').slice(0, 120));
  };
  ws.onclose = () => { if (fastQ.ws === ws) { fastQ.ws = null; fastFallback(T('Verbinding met Finnhub verbroken')); } };
}
// Finnhub weigert of valt weg (bijvoorbeeld een tweede apparaat met dezelfde sleutel): door met Trading 212, niet opnieuw proberen
function fastFallback(why) {
  if (fastQ.ws) { const w = fastQ.ws; fastQ.ws = null; try { w.close(); } catch (e) { /* al dicht */ } }
  fastQ.src = 't212';
  fastQ.note = why + '. ' + T('Nu de koers van Trading 212 elke 2 seconden; zet de snelle modus uit en aan om Finnhub opnieuw te proberen.');
  liveSchedule(LIVE_FAST_MS);
  fastPaint();
}
function fastStop() {
  if (fastQ.ws) { const w = fastQ.ws; fastQ.ws = null; try { w.close(); } catch (e) { /* al dicht */ } }
  clearInterval(fastQ.sim);
  fastQ.sim = 0;
  fastQ.tk = null;
  fastQ.src = '';
}
// Op de achtergrond niets openhouden; terug in beeld verder met dezelfde kaarsen
function fastPause() {
  if (!fastQ.tk || fastQ.paused) return;
  if (fastQ.ws) { const w = fastQ.ws; fastQ.ws = null; try { w.close(); } catch (e) { /* al dicht */ } }
  clearInterval(fastQ.sim);
  fastQ.paused = true;
}
function fastResume() {
  if (!fastQ.paused || !fastQ.tk) return;
  if (fastBox()) fastStart(fastQ.tk, true);
  else { fastQ.paused = false; fastStop(); }
}
const fastBox = () => (fastQ.tk ? document.querySelector('[data-fast-tk="' + CSS.escape(fastQ.tk) + '"]') : null);

// Een trade in het blokje van zijn halve minuut. Een late trade (door elkaar binnengekomen) telt in het laatste blokje.
function fastAdd(t, p) {
  const a = fastQ.bars, b = Math.floor(t / FAST_BUCKET) * FAST_BUCKET, x = a[a.length - 1];
  if (x && b <= x.t) { if (p > x.h) x.h = p; if (p < x.l) x.l = p; x.c = p; x.n++; }
  else {
    a.push({ t: b, o: p, h: p, l: p, c: p, n: 1 });
    while (a.length && a[0].t < t - FAST_KEEP) a.shift();
  }
  fastQ.last = p;
  fastQ.lastT = Math.max(fastQ.lastT, t);
}
// Voorbeeld: een uur verzonnen kaarsen, zodat bezoekers zonder sleutel meteen een volle grafiek zien
function fastDemoHistory(c) {
  let p = ((c && c.priceNative) || 100) * 0.997;
  const now = Date.now();
  for (let t = now - FAST_KEEP + FAST_BUCKET; t < now - FAST_BUCKET; t += 2000) { p *= 1 + (Math.random() - 0.495) * 0.0005; fastAdd(t, p); }
}
function fastDemoTick() {
  let p = fastQ.last || 100;
  const n = Math.random() < 0.3 ? 0 : 1 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) { p *= 1 + (Math.random() - 0.5) * 0.00015; fastAdd(Date.now(), p); }
  if (n) fastPaint();
}

// Elke live stand: wisselkoers bijwerken en eens per minuut vergelijken met de laatste trade
function fastFromSnap(s, force) {
  if (!fastQ.tk || fastQ.paused) return;
  if (!fastBox()) { fastStop(); return; }   // de pagina van het aandeel is dicht
  const p = s.positions.find((x) => x.tk === fastQ.tk);
  if (!p) return;
  if (p.qty > 0 && p.price > 0) { fastQ.fx = p.value / (p.qty * p.price); fastQ.qty = p.qty; }
  if (p.cur) fastQ.cur = p.cur;
  if (fastQ.src === 't212') fastAdd(s.got, p.price);
  else if (isNum(fastQ.last) && s.got - fastQ.lastT < 5 * 60e3 && (force || s.got - fastQ.lastSync >= FAST_SYNC_MS)) {
    fastQ.syncs.push({ t: s.got, a: p.price, b: fastQ.last });
    if (fastQ.syncs.length > 60) fastQ.syncs.shift();
    fastQ.lastSync = s.got;
  }
  fastPaint();
}

// Kaarsen van de gekozen grootte binnen de gekozen periode
function fastCandles() {
  const out = [], from = Date.now() - fastQ.win;
  fastQ.bars.forEach((b) => {
    if (b.t + FAST_BUCKET <= from) return;
    const t = Math.floor(b.t / fastQ.size) * fastQ.size, x = out[out.length - 1];
    if (x && x.t === t) { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; x.n += b.n; }
    else out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, n: b.n });
  });
  return out;
}

// Tekenen hoogstens één keer per frame, hoeveel trades er ook binnenkomen
function fastPaint() {
  if (fastQ.raf) return;
  fastQ.raf = requestAnimationFrame(() => { fastQ.raf = 0; fastDraw(); });
}
function fastDraw() {
  $$('[data-fast-tk]').forEach((box) => {
    const tk = /** @type {HTMLElement} */ (box).dataset.fastTk, on = tk === fastQ.tk;
    const btn = box.querySelector('[data-fast-btn]');
    setTxt(btn, on ? T('Snelle modus uit') : T('Snelle modus'));
    btn.setAttribute('aria-pressed', String(on));
    btn.className = 'btn ' + (on ? 'primary' : 'ghost');
    const ctl = /** @type {HTMLElement} */ (box.querySelector('.fast-ctl'));
    const cv = /** @type {HTMLCanvasElement} */ (box.querySelector('.fast-chart'));
    ctl.hidden = cv.hidden = !on;
    const h = fastHead(tk, on);
    if (h) {
      setTxt(box.querySelector('.fast-price'), money(h.price, h.cur));
      const day = box.querySelector('.fast-day');
      setTxt(day, isNum(h.day) ? spct(h.day) + ' ' + M.dayWord : '');
      day.className = 'small fast-day ' + tone(h.day);
      setTxt(box.querySelector('.fast-val'), eur(h.value));
      const pl = box.querySelector('.fast-pl');
      setTxt(pl, isNum(h.pl) ? seur(h.pl) + (isNum(h.plPct) ? ' (' + spct(h.plPct) + ')' : '') : '');
      pl.title = T('Winst of verlies sinds aankoop');
      pl.className = 'small fast-pl ' + tone(h.pl);
    }
    const sub = box.querySelector('.fast-sub'), sync = box.querySelector('.fast-sync');
    // Waarschuwing over de verzoeken: vooraf bij een aandeel van buiten de VS, en zolang Trading 212 elke 2 seconden gevraagd wordt
    const warn = /** @type {HTMLElement} */ (box.querySelector('.fast-warn'));
    const wt = on ? (fastQ.src === 't212' ? T(FAST_WARN_ON) : '') : fastUsListed(tk) === false ? T(FAST_WARN_PRE) : '';
    setTxt(warn, wt);
    warn.hidden = !wt;
    if (!on) { setTxt(sub, ''); setTxt(sync, ''); return; }
    ctl.querySelectorAll('[data-fast-size]').forEach((b) => b.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (b).dataset.fastSize) === fastQ.size)));
    ctl.querySelectorAll('[data-fast-win]').forEach((b) => b.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (b).dataset.fastWin) === fastQ.win)));
    const cs = fastCandles();
    const src = fastQ.src === 'finnhub' ? 'Finnhub, elke trade' : fastQ.src === 'demo' ? 'voorbeeld, elke trade' : 'Trading 212, elke 2 seconden';
    const n = cs.reduce((a, x) => a + x.n, 0);
    setTxt(sub, src + (n ? ' · ' + n + ' trades in ' + FAST_WINS.find((w) => w[0] === fastQ.win)[1] : '') + (fastQ.note ? '. ' + fastQ.note : ''));
    // De controle loopt op de achtergrond; alleen bij een afwijking een waarschuwing
    const sy = fastQ.syncs[fastQ.syncs.length - 1];
    const off = fastQ.src !== 't212' && sy && Math.abs(sy.b / sy.a - 1) > FAST_SYNC_WARN;
    setTxt(sync, off ? 'Let op: ' + (fastQ.src === 'demo' ? 'de voorbeeldkoers' : 'de koers van Finnhub') + ' (' + money(sy.b, fastQ.cur) + ') wijkt ' + P1.format(Math.abs(sy.b / sy.a - 1)) +
      ' af van die van Trading 212 (' + money(sy.a, fastQ.cur) + ') bij de controle van ' + fLiveT.format(sy.t) + '. Een van beide kan vertraagd zijn; reken met de koers van Trading 212.' : '');
    fastChart(cv, cs);
  });
}
// Bovenaan de tegel: links de koers van één aandeel met de verandering van vandaag, rechts je positie met winst of
// verlies sinds aankoop. In de snelle modus uit de laatste trade, anders uit de live stand of de laatste meting.
function fastHead(tk, on) {
  const c = M && M.byTk.get(tk);
  if (!c) return null;
  const s = liveQ.on && liveFresh() ? liveQ.snap.positions.find((x) => x.tk === tk) : null;
  const live = on && isNum(fastQ.last);
  const price = live ? fastQ.last : s ? s.price : c.priceNative;
  // Verandering van vandaag (in euro, zoals de rest van de tracker): die van de laatste meting, bijgewerkt met de koers van nu
  const day = isNum(c.changePct) && c.priceNative > 0 && isNum(price) ? (1 + c.changePct) * price / c.priceNative - 1 : null;
  const value = live && isNum(fastQ.qty) && isNum(fastQ.fx) ? fastQ.qty * fastQ.last * fastQ.fx : s ? s.value : c.value;
  const pl = isNum(value) && isNum(c.cost) ? value - c.cost : null;
  return { price, cur: (live && fastQ.cur) || c.cur, day, value, pl, plPct: isNum(pl) && c.cost > 0 ? pl / c.cost : null };
}

// Kaarsengrafiek op een canvas: per kaars een lont (hoog tot laag) en een blokje (open tot slot)
let fastFont = '';
function fastChart(cv, cs) {
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  if (!g) return;
  if (!fastFont) fastFont = '11px ' + getComputedStyle(document.body).fontFamily;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  g.font = fastFont;
  if (!cs.length || !isNum(fastQ.last)) {
    g.fillStyle = C.ink2;
    g.fillText(fastQ.note && !fastQ.bars.length ? T('Wacht op de eerste koers…') : T('Nog geen trades in deze periode.'), 8, H / 2);
    return;
  }
  const now = Date.now(), size = fastQ.size, slots = Math.round(fastQ.win / size);
  const end = Math.floor(now / size) * size, t0 = end - (slots - 1) * size;   // de laatste kaars is die van nu
  let lo = Infinity, hi = -Infinity;
  cs.forEach((k) => { if (k.t >= t0) { if (k.l < lo) lo = k.l; if (k.h > hi) hi = k.h; } });
  if (!isFinite(lo)) { lo = hi = fastQ.last; }
  const padP = Math.max((hi - lo) * 0.08, hi * 0.0002);
  lo -= padP; hi += padP;
  const R = 70, top = 8, bot = 20, cw = W - R, sw = cw / slots;
  const x = (t) => (t - t0) / size * sw + sw / 2;
  const y = (p) => top + (hi - p) / (hi - lo) * (H - top - bot);
  // Hulplijnen met koersen rechts, tijden onder
  g.strokeStyle = C.grid; g.globalAlpha = 0.3; g.lineWidth = 1;
  const steps = [0, 1, 2, 3].map((i) => hi - padP - (hi - lo - 2 * padP) * i / 3);
  steps.forEach((v) => { g.beginPath(); g.moveTo(0, Math.round(y(v)) + 0.5); g.lineTo(cw, Math.round(y(v)) + 0.5); g.stroke(); });
  g.globalAlpha = 1;
  g.fillStyle = C.ink2; g.textBaseline = 'middle';
  steps.forEach((v) => g.fillText(N2.format(v), cw + 6, y(v)));
  g.textBaseline = 'alphabetic';
  [t0, t0 + (slots >> 1) * size, end].forEach((t) => {
    const s = fHM.format(t), w = g.measureText(s).width;
    g.fillText(s, Math.min(Math.max(0, x(t) - w / 2), cw - w), H - 5);
  });
  // De kaarsen
  const bw = Math.max(1, Math.min(14, sw * 0.62));
  cs.forEach((k) => {
    if (k.t < t0) return;
    const cx = Math.round(x(k.t)) + 0.5;
    g.strokeStyle = g.fillStyle = k.c > k.o ? C.gain : k.c < k.o ? C.loss : C.ink2;
    g.beginPath(); g.moveTo(cx, y(k.h)); g.lineTo(cx, y(k.l)); g.stroke();
    const yo = y(k.o), yc = y(k.c);
    g.fillRect(Math.round(cx - bw / 2), Math.min(yo, yc), Math.round(bw), Math.max(1, Math.abs(yc - yo)));
  });
  // Laatste koers: lijn met label rechts
  const yl = Math.round(y(fastQ.last)) + 0.5;
  g.strokeStyle = C.accent; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, yl); g.lineTo(cw, yl); g.stroke();
  const lab = N2.format(fastQ.last), lw = g.measureText(lab).width + 10;
  g.fillStyle = C.accent; g.fillRect(cw + 2, yl - 9, Math.min(lw, R - 2), 18);
  g.fillStyle = '#FFFFFF'; g.textBaseline = 'middle'; g.fillText(lab, cw + 7, yl); g.textBaseline = 'alphabetic';
}

document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  if (!t || !t.closest) return;
  const b = t.closest('[data-fast-btn]');
  if (b) {
    const tk = /** @type {HTMLElement} */ (b.closest('[data-fast-tk]')).dataset.fastTk;
    if (fastQ.tk === tk) { fastStop(); liveSchedule(liveDelay()); fastPaint(); }
    else fastStart(tk, false);
    return;
  }
  const s = /** @type {HTMLElement|null} */ (t.closest('[data-fast-size]'));
  if (s) { fastQ.size = Number(s.dataset.fastSize); fastPaint(); return; }
  const w = /** @type {HTMLElement|null} */ (t.closest('[data-fast-win]'));
  if (w) { fastQ.win = Number(w.dataset.fastWin); fastPaint(); }
});
