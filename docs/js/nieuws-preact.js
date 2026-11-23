/* Investeringstracker – nieuwspagina als Preact-componenten
 *
 * Eerste pagina die met componenten is gebouwd (Preact met htm, zonder build-stap; zie docs/vendor/preact-htm.js).
 * Dit is een module: hij laadt na de gewone scripts en gebruikt hun functies en gegevens (data, M, newsItems, ...).
 * Lukt het laden niet, dan blijft de oude weergave in js/12-nieuws.js gewoon werken.
 *
 * Componenten houden hun eigen toestand bij (zoals het filter), zodat een klik alleen dat stuk opnieuw tekent.
 */
import { html, render, useState, useMemo, useRef, useLayoutEffect, useEffect } from '../vendor/preact-htm.js';

const TONE_LABEL = { pos: '▲ Positief', neg: '▼ Negatief', neu: '● Neutraal' };
const FILTERS = [['all', 'Alles'], ['mine', 'Mijn aandelen'], ['watch', 'Volglijst'], ['market', 'Markt']];

// Bestaande tegel (HTML-tekst uit de gewone scripts) als component, zolang die nog niet is omgezet
function Legacy({ markup }) {
  return html`<div class="legacy" style="display:contents" dangerouslySetInnerHTML=${{ __html: markup }}></div>`;
}

function Seg({ value, options, onPick, label }) {
  return html`<div class="seg light" role="group" aria-label=${label}>
    ${options.map(([k, l]) => html`<button type="button" aria-pressed=${String(value === k)} onClick=${() => onPick(k)}>${l}</button>`)}
  </div>`;
}

function NewsItem({ n }) {
  const t = newsTone(n);
  return html`<a class="news-i" href=${n.url} target="_blank" rel="noopener">
    <span class="news-m">
      ${n.tk ? html`<span class=${'tag' + (n.kind === 'watch' ? '' : ' gain')}>${n.tk}</span>` : html`<span class="tag">Markt</span>`}${' '}
      <span class=${'ntone ' + t} title=${toneTitle(n)}>${TONE_LABEL[t]}</span>
      ${fDT.format(n.t) + (n.source ? ', ' + n.source : '')}
    </span>
    <span class="news-t">${n.headline}</span>
    ${n.summary ? html`<span class="news-s">${n.summary}</span>` : null}
  </a>`;
}

// Voorbeeldweergave: verzonnen ouder nieuws, tot een jaar terug
const DEMO_OLD = ['%s houdt jaarvergadering', 'Analisten verhogen koersdoel van %s', '%s presenteert nieuwe producten', 'Kwartaalcijfers van %s boven verwachting',
  '%s kondigt inkoop van eigen aandelen aan', 'Concurrentie zet %s onder druk', '%s opent nieuwe fabriek', 'Topman van %s over de groei van volgend jaar'];
function demoOlderNews(before, tk) {
  if (before < Date.now() - 365 * 864e5) return { items: [], more: false };
  const cs = M.companies.filter((c) => !isFundC(c) && (!tk || c.tk === tk));
  const items = [];
  for (let i = 0; i < 20 && cs.length; i++) {
    const c = cs[i % cs.length];
    items.push({ tk: c.tk, t: before - (i + 1) * 0.8 * 864e5, headline: 'Voorbeeld: ' + DEMO_OLD[(i * 3 + c.tk.length) % DEMO_OLD.length].replace('%s', c.name) + ' (geen echt nieuws)', source: ['Reuters', 'Bloomberg', 'CNBC', 'FD'][i % 4], url: '#voorbeeld-' + c.tk + '-' + Math.round(before / 1000) + '-' + i, summary: '' });
  }
  return { items, more: true };
}

// Berichten over hetzelfde onderwerp: de nieuwste kop, met de andere bronnen eronder (uitklapbaar)
function NewsCluster({ c }) {
  if (c.items.length < 2) return html`<${NewsItem} n=${c.lead} />`;
  return html`<div class="news-g">
    <${NewsItem} n=${c.lead} />
    <details class="news-src"><summary>${clusterLabel(c)} over hetzelfde bericht</summary>
      <div class="news-sub">
        ${c.items.slice(1).map((n) => html`<a key=${n.url + '|' + n.headline} href=${n.url} target="_blank" rel="noopener"><span class="s">${n.source || 'bron'}</span><span class="t">${n.headline}</span></a>`)}
      </div>
    </details>
  </div>`;
}

// Hoeveel koppen er in één keer in de pagina komen; de rest volgt zodra je in de buurt scrolt
const NEWS_STEP = 30;

function NewsList({ items, tk, onClear }) {
  const [filter, setFilter] = useState(xs.newsF || 'all');
  const [older, setOlder] = useState([]);
  const [busy, setBusy] = useState(false);
  const [end, setEnd] = useState(false);
  const [note, setNote] = useState('');
  const [limit, setLimit] = useState(NEWS_STEP);
  const tail = useRef(null);
  const keep = (n) => (filter === 'all' || n.kind === filter) && (!tk || n.tk === tk);
  const shown = useMemo(() => {
    const seen = new Set();
    return items.filter(keep).concat(older.filter(keep)).filter((n) => { const k = n.url + '|' + n.tk; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [items, older, filter, tk]);
  // Eerst bundelen (berichten van meer bronnen over hetzelfde), dan hoogstens 40 bundels tonen
  const groups = useMemo(() => newsClusters(shown).slice(0, 40), [shown]);
  const listed = useMemo(() => groups.flatMap((c) => c.items), [groups]);
  const canOlder = filter !== 'market' && (demo || (typeof isWorker === 'function' && isWorker()));
  const loadOlder = async () => {
    setBusy(true); setNote('');
    try {
      const pool = shown.filter((n) => n.tk);
      const before = pool.length ? Math.min(...pool.map((n) => n.t)) : Date.now();
      const j = demo ? demoOlderNews(before, tk) : await workerCall('/api/news?limit=40&before=' + before + (tk ? '&tk=' + encodeURIComponent(tk) : ''), { method: 'GET' });
      const held = new Set(M.companies.map((c) => c.tk)), watch = new Set(watchSyms());
      const add = (j.items || []).map((n) => Object.assign({}, n, { kind: held.has(n.tk) ? 'mine' : watch.has(n.tk) ? 'watch' : 'mine' }));
      setOlder((prev) => prev.concat(add));
      if (!j.more) { setEnd(true); setNote(j.filling ? 'Het archief wordt nog aangevuld: elke ronde komt er een maand ouder nieuws bij, tot een jaar terug.' : 'Geen ouder nieuws meer.'); }
    } catch (err) { setNote('Ouder nieuws laden lukte niet: ' + err.message + '.'); }
    setBusy(false);
  };
  const count = useMemo(() => { const c = { pos: 0, neg: 0, neu: 0 }; listed.forEach((n) => { c[newsTone(n)]++; }); return c; }, [listed]);
  const pick = (k) => { xs.newsF = k; setFilter(k); };
  // Alleen tekenen wat je kunt zien: een ander filter of bedrijf begint weer bij de eerste 30 koppen
  useEffect(() => { setLimit(NEWS_STEP); }, [filter, tk]);
  const vis = groups.slice(0, limit);
  const rest = groups.length - vis.length;
  useEffect(() => {
    if (!rest) return undefined;
    if (typeof IntersectionObserver !== 'function') { setLimit(groups.length); return undefined; }
    const el = tail.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setLimit((n) => n + NEWS_STEP); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [rest, groups.length]);
  return html`<section class="tile pad span-2 news-tile">
    <div class="plan-head"><h3>Nieuws</h3><${Seg} value=${filter} options=${FILTERS} onPick=${pick} label="Nieuws filteren" /></div>
    ${tk ? html`<p class="small news-only">Alleen ${tk} <button type="button" class="linklike" onClick=${onClear}>Toon alles</button></p>` : null}
    ${shown.length
      ? html`<p class="small muted" style="margin:2px 0 6px">${count.pos} positief, ${count.neg} negatief, ${count.neu} neutraal${listed.length > groups.length ? ', ' + (listed.length - groups.length) + ' gebundeld' : ''}</p>
        <div class="news">${vis.map((c) => html`<${NewsCluster} key=${c.lead.url + '|' + c.lead.tk + '|' + c.lead.headline} c=${c} />`)}</div>
        ${rest ? html`<div class="news-tail" ref=${tail} aria-hidden="true"></div><p class="small muted" role="status" style="margin-top:6px">Nog ${rest} ${rest === 1 ? 'kop' : 'koppen'}: scrol verder.</p>` : null}
        ${canOlder && !end && !rest ? html`<div class="news-more"><button type="button" class="btn ghost" disabled=${busy} onClick=${loadOlder}>${busy ? 'Bezig met laden…' : 'Ouder nieuws laden'}</button></div>` : null}
        ${note ? html`<p class="small muted" role="status" style="margin-top:6px">${note}</p>` : null}`
      : html`<p class="muted">${filter === 'market' && !data.marketNews ? 'Marktnieuws komt van Finnhub en wordt buiten de handelsuren opgehaald.' : 'Geen nieuws in deze selectie.'}</p>`}
    <p class="sub" style="margin-top:8px">Koppen en links van Finnhub (of Alpha Vantage als reserve): per aandeel de laatste tien dagen, en algemeen marktnieuws. Het artikel opent bij de bron. Berichten met bijna dezelfde kop staan samen onder "x bronnen". Positief of negatief is een schatting uit woorden in de kop en samenvatting, geen oordeel van de bron; lees bij twijfel het artikel.</p>
  </section>`;
}

const relColor = (score) => Math.max(1, Math.min(7, 8 - Math.round(score * 0.7)));
const REC_COLORS = [['sb', '#0B7A4B'], ['b', '#5FB58A'], ['h', '#C9CED6'], ['s', '#E3A79C'], ['ss', '#B4311F']];

function AnalystRow({ x }) {
  const rec = x.rc && x.rc.rec;
  return html`<tr class="rowlink" data-ticker=${x.held ? x.o.tk : '~' + x.o.tk}>
    <td class="co"><b>${x.o.tk}</b> ${x.held ? null : html`<span class="tag">Volglijst</span>`}<span class="nm">${x.o.name}</span></td>
    <td>${rec ? html`<div class="rec-bar mini">${REC_COLORS.filter(([k]) => rec[k]).map(([k, c]) => html`<i style=${'flex:' + rec[k] + ';background:' + c}></i>`)}</div>` : '–'}</td>
    <td class="num">${x.rc ? P1.format(x.rc.buy) : '–'}${x.rc ? html`<span class="sub">${x.rc.tot} analisten</span>` : null}</td>
    <td class=${'num ' + tone(x.rc && x.rc.trend)}>${x.rc && isNum(x.rc.trend) ? sgn(x.rc.trend * 100, N1) + ' pp' : '–'}</td>
    <td class=${'num ' + tone(x.up)}>${isNum(x.up) ? spct1(x.up) : '–'}</td>
    <td class="num">${x.rel ? html`<span class="lvl" style=${'--k:' + relColor(x.rel.score)}>${x.rel.score}</span><span class="sub">${x.rel.word}</span>` : '–'}</td>
    <td class="num">${x.sent && isNum(x.sent.bull) ? P1.format(x.sent.bull) + ' positief' : '–'}</td>
  </tr>`;
}

function AnalystTable({ rows }) {
  const [sortBy, setSortBy] = useState('buy');
  const sorted = useMemo(() => rows.slice().sort((a, b) =>
    sortBy === 'rel' ? (b.rel ? b.rel.score : -1) - (a.rel ? a.rel.score : -1)
      : sortBy === 'up' ? (isNum(b.up) ? b.up : -9) - (isNum(a.up) ? a.up : -9)
        : (b.rc ? b.rc.buy : 0) - (a.rc ? a.rc.buy : 0)), [rows, sortBy]);
  if (!rows.length) {
    return html`<section class="tile pad full"><h3>Analisten per bedrijf</h3><p class="muted">Nog geen aanbevelingen van analisten opgehaald.
      ${fixShow('FINNHUB_KEY') ? html`<button type="button" class="linklike small" data-fix="FINNHUB_KEY">${fixLabel('FINNHUB_KEY')}</button>` : null}</p></section>`;
  }
  return html`<section class="tile pad full">
    <div class="plan-head"><h3>Analisten per bedrijf</h3><${Seg} value=${sortBy} options=${[['buy', 'Meeste kopen'], ['up', 'Koersdoel'], ['rel', 'Betrouwbaarheid']]} onPick=${setSortBy} label="Sorteren" /></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bedrijf</th><th>Aanbevelingen</th><th class="num">Kopen</th><th class="num">Trend</th><th class="num">Koersdoel</th><th class="num">Betrouwbaarheid</th><th class="num">Nieuws</th></tr></thead>
      <tbody>${sorted.map((x) => html`<${AnalystRow} key=${x.o.tk} x=${x} />`)}</tbody></table></div>
    <p class="sub" style="margin-top:8px">Kopen: deel van de analisten met koop of sterk kopen. Trend: verschil met enkele maanden eerder. Koersdoel: gemiddeld koersdoel tegenover de koers nu. Betrouwbaarheid (0–10): zie de uitleg hiernaast.</p>
  </section>`;
}

// ---------- Stemmingskaart: elk aandeel als stip, analisten (links-rechts) tegenover het nieuws (onder-boven) ----------
// Stemming uit de koppen: gladgestreken (neutraal telt half, en één extra positief en negatief),
// zodat één of twee berichten een aandeel niet helemaal naar boven of onder duwen.
function moodPoints(items, rows) {
  const tones = {};
  items.forEach((n) => { if (!n.tk) return; const t = tones[n.tk] || (tones[n.tk] = { pos: 0, neg: 0, neu: 0 }); t[newsTone(n)]++; });
  return rows.filter((x) => x.rc && isNum(x.rc.buy)).map((x) => {
    const t = tones[x.o.tk];
    const n = t ? t.pos + t.neg + t.neu : 0;
    const bull = x.sent && isNum(x.sent.bull) ? x.sent.bull : n ? (t.pos + t.neu / 2 + 1) / (n + 2) : null;
    return isNum(bull) ? { tk: x.o.tk, held: x.held, buy: x.rc.buy, bull, n } : null;
  }).filter(Boolean);
}
// Bereik van een as: de gegevens met wat ruimte, minstens 0,3 breed en binnen 0 tot 1
function axisRange(vals) {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(0.04, (hi - lo) * 0.12);
  lo -= pad; hi += pad;
  if (hi - lo < 0.3) { const m = (lo + hi) / 2; lo = m - 0.15; hi = m + 0.15; }
  return [Math.max(0, lo), Math.min(1, hi)];
}
function MoodMap({ pts, sel, onPick }) {
  const box = useRef(null);
  // Namen die over elkaar of over een stip vallen: eerst naar links, anders verbergen (tik op de stip toont de naam)
  const layout = () => {
    const el = box.current;
    if (!el) return;
    const outer = el.getBoundingClientRect();
    // Verborgen pagina: nog niets te meten, opnieuw zodra de kaart een maat heeft
    if (!outer.width) return;
    const dots = [...el.querySelectorAll('.mood-dot')];
    dots.forEach((d) => d.classList.remove('nolab', 'left'));
    const marks = dots.map((d) => d.querySelector('i').getBoundingClientRect());
    const placed = [...el.querySelectorAll('.ml')].map((m) => m.getBoundingClientRect());
    const hits = (r, own) => placed.some((q) => r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top) ||
      marks.some((q, j) => j !== own && r.left < q.right - 2 && r.right > q.left + 2 && r.top < q.bottom - 2 && r.bottom > q.top + 2);
    dots.forEach((d, i) => {
      const lab = d.querySelector('b');
      const try1 = lab.getBoundingClientRect();
      const fits = (r) => r.left >= outer.left + 2 && r.right <= outer.right - 2 && !hits(r, i);
      if (d.classList.contains('on') || fits(try1)) { placed.push(try1); return; }
      d.classList.add('left');
      const try2 = lab.getBoundingClientRect();
      if (fits(try2)) { placed.push(try2); return; }
      d.classList.remove('left');
      d.classList.add('nolab');
    });
  };
  useLayoutEffect(layout);
  useEffect(() => {
    // Werk samengevoegd per frame (observeSize uit js/00-kern.js), anders meet de kaart bij elke pixel opnieuw
    const ro = observeSize(box.current, layout, 'mood');
    return ro ? () => ro.disconnect() : undefined;
  }, [box.current]);
  if (pts.length < 2) return null;
  const [x0, x1] = axisRange(pts.map((p) => p.buy)), [y0, y1] = axisRange(pts.map((p) => p.bull));
  const X = (b) => 4 + (b - x0) / (x1 - x0) * 92;
  const Y = (v) => 6 + (y1 - v) / (y1 - y0) * 88;
  // Stippen op (bijna) dezelfde plek een klein beetje uit elkaar zetten
  const seen = {};
  const pos = pts.map((p) => {
    let x = X(p.buy), y = Y(p.bull);
    const k = Math.round(x / 3) + ':' + Math.round(y / 3);
    const i = seen[k] = (seen[k] || 0) + 1;
    if (i > 1) { const a = i * 2.1; x += Math.cos(a) * 2.2 * Math.ceil(i / 6); y += Math.sin(a) * 3.2 * Math.ceil(i / 6); }
    return { p, x: Math.max(3, Math.min(97, x)), y: Math.max(5, Math.min(95, y)) };
  });
  const mx = Math.max(0, Math.min(100, X(0.5))), my = Math.max(0, Math.min(100, Y(0.5)));
  const s = pts.find((p) => p.tk === sel);
  const pc = (v) => P1.format(v);
  return html`<section class="tile pad mood-tile">
    <div class="plan-head"><h3>Stemmingskaart</h3><span class="muted small">klik op een stip</span></div>
    <div class="mood-map" ref=${box}>
      <span class="mq a" style=${'left:' + mx + '%;top:0;right:0;height:' + my + '%;width:auto'}></span>
      <span class="mq b" style=${'left:0;top:' + my + '%;width:' + mx + '%;bottom:0;height:auto'}></span>
      <span class="mx" style=${'left:' + mx + '%'}></span><span class="my" style=${'top:' + my + '%'}></span>
      ${mx < 97 && my > 3 ? html`<span class="ml tr">beide positief</span>` : null}${mx > 3 && my < 97 ? html`<span class="ml bl">beide negatief</span>` : null}
      ${mx < 97 && my < 97 ? html`<span class="ml br">analisten wel, nieuws niet</span>` : null}${mx > 3 && my > 3 ? html`<span class="ml tl">nieuws wel, analisten niet</span>` : null}
      ${pos.map(({ p, x, y }) => {
        const on = sel === p.tk;
        return html`<button type="button" key=${p.tk} class=${'mood-dot' + (p.held ? '' : ' w') + (on ? ' on' : '') + (sel && !on ? ' dim' : '')}
          style=${'left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%'} aria-pressed=${String(on)} title=${p.tk}
          aria-label=${p.tk + ': ' + pc(p.buy) + ' van de analisten zegt kopen, nieuws ' + pc(p.bull) + ' positief'} onClick=${() => onPick(on ? null : p.tk)}><i></i><b>${p.tk}</b></button>`;
      })}
    </div>
    <div class="mood-ax small muted"><span>← ${pc(x0)} zegt kopen</span><span>${pc(x1)} →</span></div>
    <div class="mood-leg small muted"><span><i></i>in bezit</span><span><i class="w"></i>volglijst</span><span>hoger = positiever nieuws</span><span>namen die niet passen: tik op de stip</span></div>
    ${s ? html`<div class="mood-sel"><span><b>${s.tk}</b> · ${pc(s.buy)} van de analisten zegt kopen · nieuws ${pc(s.bull)} positief${s.n ? ' (' + s.n + ' berichten)' : ''}</span><button type="button" class="btn ghost" onClick=${() => onPick(null)}>Toon alles</button></div>` : null}
  </section>`;
}

// Meningen per sector en door de tijd: periode als eigen toestand, de inhoud komt uit js/12-nieuws.js
function OpinionTile({ stamp }) {
  const [per, setPer] = useState(xs.opPer || '30');
  const pick = (k) => { xs.opPer = k; setPer(k); };
  const body = useMemo(() => opinionBody(Number(per)), [per, stamp]);
  return html`<section class="tile pad full op-tile">
    <div class="plan-head"><h3>Meningen per sector en door de tijd</h3><${Seg} value=${per} options=${OP_PERIODS} onPick=${pick} label="Periode" /></div>
    <${Legacy} markup=${body} />
  </section>`;
}

const NEWS_SEGS = [['news', 'Nieuws'], ['an', 'Analisten'], ['ins', 'Insiders']];
function NewsPage({ stamp }) {
  // stamp verandert bij nieuwe gegevens, zodat de lijsten opnieuw worden opgebouwd
  const items = useMemo(() => newsItems(), [stamp, muteKey()]);
  const rows = useMemo(() => analystRows(), [stamp]);
  const pts = useMemo(() => moodPoints(items, rows), [items, rows]);
  const [sel, setSel] = useState(null);
  const [seg, setSeg] = useState(xs.newsSeg || 'news');
  const pickSeg = (k) => { xs.newsSeg = k; setSeg(k); };
  const map = html`<${MoodMap} pts=${pts} sel=${sel} onPick=${setSel} />`;
  const list = html`<${NewsList} items=${items} tk=${sel} onClear=${() => setSel(null)} />`;
  if (mode === 'm') {
    return html`<div class="m-ptabs news-tabs" role="group" aria-label="Onderdeel">${NEWS_SEGS.map(([k, l]) => html`<button type="button" key=${k} aria-pressed=${String(seg === k)} onClick=${() => pickSeg(k)}>${l}</button>`)}</div>
      ${seg === 'news' ? html`<div class="grid wide">${map}${list}<${Legacy} markup=${missedTile()} /><${Legacy} markup=${newsToolsTile()} /></div>` : null}
      ${seg === 'an' ? html`<div class="grid wide"><${Legacy} markup=${suggestTile()} /><${AnalystTable} rows=${rows} /><${OpinionTile} stamp=${stamp} /><${Legacy} markup=${earnSeasonTile()} /><${Legacy} markup=${analystScoreTile()} /><${Legacy} markup=${reliabilityTile()} /></div>` : null}
      ${seg === 'ins' ? html`<div class="grid wide"><${Legacy} markup=${insiderTile()} /></div>` : null}`;
  }
  return html`
    <div class="grid wide">${list}${map}</div>
    <div class="grid wide" style="margin-top:16px"><${Legacy} markup=${missedTile()} /><${Legacy} markup=${suggestTile()} /><${Legacy} markup=${newsToolsTile()} /></div>
    <div class="section-head"><h2>Analisten</h2><p class="muted small">Aanbevelingen, koersdoelen en hoe betrouwbaar ze zijn</p></div>
    <div class="grid wide"><${AnalystTable} rows=${rows} /><${Legacy} markup=${reliabilityTile()} /><${OpinionTile} stamp=${stamp} /><${Legacy} markup=${earnSeasonTile()} /><${Legacy} markup=${analystScoreTile()} /></div>
    <div class="section-head"><h2>Insiders</h2><p class="muted small">Kopen en verkopen bestuurders zelf?</p></div>
    <div class="grid wide"><${Legacy} markup=${insiderTile()} /></div>`;
}

let stampN = 0, lastData = null;
const mounted = new Set();
function clear(host) {
  if (mounted.has(host)) { render(null, host); mounted.delete(host); }
}
function draw(host) {
  if (data !== lastData) { lastData = data; stampN++; }
  // Wisselen tussen desktop en telefoon: de oude plek leegmaken
  [...mounted].forEach((h) => { if (h !== host) clear(h); });
  // De eerste keer staat er misschien nog HTML van de oude weergave in
  if (!mounted.has(host)) { host.innerHTML = ''; mounted.add(host); }
  render(html`<${NewsPage} stamp=${stampN} />`, host);
}

window.NewsView = { ok: true, draw, clear };
// De gewone scripts hebben de pagina misschien al getekend: nu met componenten opnieuw
if (typeof M !== 'undefined' && M) refresh('news');
