/* Investeringstracker – nieuwspagina als Preact-componenten
 *
 * Eerste pagina die met componenten is gebouwd (Preact met htm, zonder build-stap; zie docs/vendor/preact-htm.js).
 * Dit is een module: hij laadt na de gewone scripts en gebruikt hun functies en gegevens (data, M, newsItems, ...).
 * Lukt het laden niet, dan blijft de oude weergave in js/12-nieuws.js gewoon werken.
 *
 * Componenten houden hun eigen toestand bij (zoals het filter), zodat een klik alleen dat stuk opnieuw tekent.
 */
import { html, render, useState, useMemo } from '../vendor/preact-htm.js';

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
      <span class=${'ntone ' + t} title="Geschat uit de woorden in de kop">${TONE_LABEL[t]}</span>
      ${fDT.format(n.t) + (n.source ? ', ' + n.source : '')}
    </span>
    <span class="news-t">${n.headline}</span>
    ${n.summary ? html`<span class="news-s">${n.summary}</span>` : null}
  </a>`;
}

function NewsList({ items, tk, onClear }) {
  const [filter, setFilter] = useState(xs.newsF || 'all');
  const shown = useMemo(() => items.filter((n) => (filter === 'all' || n.kind === filter) && (!tk || n.tk === tk)).slice(0, 40), [items, filter, tk]);
  const count = useMemo(() => { const c = { pos: 0, neg: 0, neu: 0 }; shown.forEach((n) => { c[newsTone(n)]++; }); return c; }, [shown]);
  const pick = (k) => { xs.newsF = k; setFilter(k); };
  return html`<section class="tile pad span-2 news-tile">
    <div class="plan-head"><h3>Nieuws</h3><${Seg} value=${filter} options=${FILTERS} onPick=${pick} label="Nieuws filteren" /></div>
    ${tk ? html`<p class="small news-only">Alleen ${tk} <button type="button" class="linklike" onClick=${onClear}>Toon alles</button></p>` : null}
    ${shown.length
      ? html`<p class="small muted" style="margin:2px 0 6px">${count.pos} positief, ${count.neg} negatief, ${count.neu} neutraal</p>
        <div class="news">${shown.map((n) => html`<${NewsItem} key=${n.url + '|' + n.tk + '|' + n.headline} n=${n} />`)}</div>`
      : html`<p class="muted">${filter === 'market' && !data.marketNews ? 'Marktnieuws komt van Finnhub en wordt buiten de meettijden opgehaald.' : 'Geen nieuws in deze selectie.'}</p>`}
    <p class="sub" style="margin-top:8px">Koppen en links van Finnhub (of Alpha Vantage als reserve): per aandeel de laatste tien dagen, en algemeen marktnieuws. Het artikel opent bij de bron. Positief of negatief is een schatting uit woorden in de kop en samenvatting, geen oordeel van de bron; lees bij twijfel het artikel.</p>
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
  if (!rows.length) return html`<section class="tile pad full"><h3>Analisten per bedrijf</h3><p class="muted">Nog geen aanbevelingen van analisten opgehaald.</p></section>`;
  return html`<section class="tile pad full">
    <div class="plan-head"><h3>Analisten per bedrijf</h3><${Seg} value=${sortBy} options=${[['buy', 'Meeste kopen'], ['up', 'Koersdoel'], ['rel', 'Betrouwbaarheid']]} onPick=${setSortBy} label="Sorteren" /></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bedrijf</th><th>Aanbevelingen</th><th class="num">Kopen</th><th class="num">Trend</th><th class="num">Koersdoel</th><th class="num">Betrouwbaarheid</th><th class="num">Nieuws</th></tr></thead>
      <tbody>${sorted.map((x) => html`<${AnalystRow} key=${x.o.tk} x=${x} />`)}</tbody></table></div>
    <p class="sub" style="margin-top:8px">Kopen: deel van de analisten met koop of sterk kopen. Trend: verschil met enkele maanden eerder. Koersdoel: gemiddeld koersdoel tegenover de koers nu. Betrouwbaarheid (0–10): zie de uitleg hiernaast.</p>
  </section>`;
}

// ---------- Stemmingskaart: elk aandeel als stip, analisten (links-rechts) tegenover het nieuws (onder-boven) ----------
function moodPoints(items, rows) {
  const tones = {};
  items.forEach((n) => { if (!n.tk) return; const t = tones[n.tk] || (tones[n.tk] = { pos: 0, neg: 0, n: 0 }); const k = newsTone(n); if (k !== 'neu') t[k]++; t.n++; });
  return rows.filter((x) => x.rc && isNum(x.rc.buy)).map((x) => {
    const t = tones[x.o.tk];
    const bull = x.sent && isNum(x.sent.bull) ? x.sent.bull : t && t.pos + t.neg ? t.pos / (t.pos + t.neg) : null;
    return isNum(bull) ? { tk: x.o.tk, held: x.held, buy: x.rc.buy, bull } : null;
  }).filter(Boolean);
}
function MoodMap({ pts, sel, onPick }) {
  if (pts.length < 2) return null;
  const X = (b) => Math.max(5, Math.min(90, (b - 0.3) / 0.7 * 100));
  const Y = (v) => Math.max(8, Math.min(92, (0.8 - v) / 0.6 * 100));
  const s = pts.find((p) => p.tk === sel);
  return html`<section class="tile pad mood-tile">
    <div class="plan-head"><h3>Stemmingskaart</h3><span class="muted small">klik op een stip</span></div>
    <div class="mood-map">
      <span class="mq a"></span><span class="mq b"></span><span class="mx"></span><span class="my"></span>
      <span class="ml tr">beide positief</span><span class="ml bl">beide negatief</span><span class="ml br">analisten wel, nieuws niet</span><span class="ml tl">nieuws wel, analisten niet</span>
      ${pts.map((p) => {
        const x = X(p.buy), on = sel === p.tk;
        return html`<button type="button" key=${p.tk} class=${'mood-dot' + (p.held ? '' : ' w') + (on ? ' on' : '') + (sel && !on ? ' dim' : '') + (x > 75 ? ' left' : '')}
          style=${'left:' + x.toFixed(1) + '%;top:' + Y(p.bull).toFixed(1) + '%'} aria-pressed=${String(on)}
          aria-label=${p.tk + ': ' + P1.format(p.buy) + ' van de analisten zegt kopen, nieuws ' + P1.format(p.bull) + ' positief'} onClick=${() => onPick(on ? null : p.tk)}><i></i><b>${p.tk}</b></button>`;
      })}
    </div>
    <div class="mood-ax small muted"><span>← minder analisten zeggen kopen</span><span>meer →</span></div>
    <div class="mood-leg small muted"><span><i></i>in bezit</span><span><i class="w"></i>volglijst</span><span>hoger = positiever nieuws</span></div>
    ${s ? html`<div class="mood-sel"><span><b>${s.tk}</b> · ${P1.format(s.buy)} van de analisten zegt kopen · nieuws ${P1.format(s.bull)} positief</span><button type="button" class="btn ghost" onClick=${() => onPick(null)}>Toon alles</button></div>` : null}
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
      ${seg === 'news' ? html`<div class="grid wide">${map}${list}<${Legacy} markup=${newsToolsTile()} /></div>` : null}
      ${seg === 'an' ? html`<div class="grid wide"><${Legacy} markup=${suggestTile()} /><${AnalystTable} rows=${rows} /><${Legacy} markup=${reliabilityTile()} /></div>` : null}
      ${seg === 'ins' ? html`<div class="grid wide"><${Legacy} markup=${insiderTile()} /></div>` : null}`;
  }
  return html`
    <div class="grid wide">${list}${map}</div>
    <div class="grid wide" style="margin-top:16px"><${Legacy} markup=${suggestTile()} /><${Legacy} markup=${newsToolsTile()} /></div>
    <div class="section-head"><h2>Analisten</h2><p class="muted small">Aanbevelingen, koersdoelen en hoe betrouwbaar ze zijn</p></div>
    <div class="grid wide"><${AnalystTable} rows=${rows} /><${Legacy} markup=${reliabilityTile()} /></div>
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
