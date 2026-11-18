/* Investeringstracker – Galerij (?gallery): alle tegels en bedieningselementen op één pagina
 *
 * Bedoeld om snel te zien hoe alles eruitziet, in het licht en in het donker, met voorbeeldgegevens.
 * Handig bij het bouwen van een nieuwe tegel en bij het nakijken van een wijziging (en de schermafbeeldingen
 * in tools/visual.mjs kunnen hem ook openen). Zonder ?gallery in het adres doet dit bestand niets.
 *
 * Dit bestand staat niet in index.html: 19-start.js laadt het pas als ?gallery in het adres staat
 * (net als de voorbeeldgegevens in 14-demo.js). Het deelt daarna gewoon het bereik met de rest. */
'use strict';

const galOn = new URLSearchParams(location.search).has('gallery');

// De galerij is een hulpmiddel bij het bouwen; de paar eigen teksten staan hier en niet in 13-app.js,
// zodat dit bestand op zichzelf staat. Voor Duits en Frans valt het terug op het Engels.
Object.assign(EN, {
  'Galerij': 'Gallery', 'Tegels': 'Tiles', 'Bedieningselementen': 'Controls', 'Zoek een tegel': 'Search a tile',
  'Terug naar de site': 'Back to the site', 'Knoppen': 'Buttons', 'Segmenten en chips': 'Segments and chips',
  'Getalkaarten': 'Number cards', 'Meldingen': 'Banners', 'Tabel': 'Table', 'Velden': 'Fields',
  'Gewoon': 'Plain', 'Rand': 'Outline', 'Bezig': 'Busy', 'Als link': 'As a link',
});

// Elke functie met een naam die op "Tile" eindigt en geen gegevens nodig heeft, is een tegel van de site.
// Zo staat een nieuwe tegel er automatisch bij, zonder dat hier een lijst bijgehouden hoeft te worden.
function galTileNames() {
  const out = [];
  for (const k of Object.getOwnPropertyNames(window)) {
    if (!/Tile$/.test(k)) continue;
    let fn = null;
    try { fn = window[k]; } catch (e) { continue; }
    if (typeof fn === 'function' && fn.length === 0) out.push(k);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// Bedieningselementen: echte knoppen, chips, meters en lijstjes uit de site, met voorbeeldwaarden
function galControls() {
  const pts = (M.intra.get(TOTAL) || []).slice(-60).map((p) => ({ t: p.t, v: p.v }));
  const c = M.companies[0] || { tk: 'VB', name: 'Voorbeeld', value: 100, changePct: 0.012 };
  return [
    ['Knoppen', '<div class="dlg-actions" style="flex-wrap:wrap;justify-content:flex-start">' +
      '<button type="button" class="btn primary">Opslaan</button><button type="button" class="btn">Gewoon</button>' +
      '<button type="button" class="btn ghost">Rand</button><button type="button" class="btn primary busy">Bezig</button>' +
      '<button type="button" class="btn" disabled>Uit</button><button type="button" class="linklike">Als link</button></div>'],
    ['Segmenten en chips', '<div class="seg" role="group" aria-label="Periode">' + RANGES.slice(0, 4).map(([k, l], i) =>
      '<button type="button" aria-pressed="' + (i === 1) + '">' + esc(l) + '</button>').join('') + '</div>' +
      '<div class="m-chips" role="group" aria-label="Filteren" style="margin-top:10px">' +
      ['Alle', 'Gestegen', 'Gedaald', 'Volglijst'].map((l, i) => '<button type="button" aria-pressed="' + (!i) + '">' + esc(l) + '</button>').join('') + '</div>'],
    ['Getalkaarten', '<div class="grid stats">' + stat('Beleggingen nu', eur(M.totalValue), M.dayWord, '') +
      stat('Resultaat nu', seur(M.tot.change), spct(M.tot.changePct), tone(M.tot.change)) +
      stat('Vrij saldo', eur(M.cash), 'bij de broker', '') +
      stat('Zonder gegevens', '–', 'nog niets gemeten', '') + '</div>'],
    ['Lijst met waarden (kvList)', kvList([['Accountwaarde', eur(M.accountNow)], ['Netto gestort', eur((M.lastWeek && M.lastWeek.netDeposits) || 0)],
      ['Resultaat', seur(M.tot.change), tone(M.tot.change)], ['Onbekend', '–']])],
    ['Balken (bars)', bars([-0.02, 0.01, 0.035, -0.012, 0.004, null].map((v, i) => ({ v, tip: 'dag ' + (i + 1), color: toneColor(v) })))],
    ['Balken, één richting', bars(M.companies.slice(0, 6).map((x) => ({ v: x.value, tip: x.tk, color: C.accent })), true)],
    ['Lijngrafiek', '<div class="chart" data-gal-line style="height:160px"></div>'],
    ['Streepgrafiek (spark)', '<div style="max-width:220px">' + spark(pts, C.accent) + '</div>'],
    ['Een rij uit de lijst', '<div class="vlist">' + clickable(stat(c.tk, eur(c.value), c.name, tone(c.changePct)), c.tk, c.name, 'Positie') + '</div>'],
    ['Meldingen', '<div class="banner">Een gewone melding met een <a href="#">link</a>.</div>' +
      '<div class="banner error" style="margin-top:8px">Er ging iets mis bij het laden.</div>' +
      '<div class="banner update" style="margin-top:8px">Er is een nieuwe versie. <button type="button" class="btn primary">Nu bijwerken</button></div>'],
    ['Tabel', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Positie</th><th class="num">Waarde</th><th class="num">Vandaag</th></tr></thead><tbody>' +
      M.companies.slice(0, 4).map((x) => '<tr><td class="co"><b>' + esc(x.tk) + '</b><span class="nm">' + esc(x.name) + '</span></td>' +
        '<td class="num">' + esc(eur(x.value)) + '</td><td class="num ' + tone(x.changePct) + '">' + esc(spct(x.changePct)) + '</td></tr>').join('') + '</tbody></table></div>'],
    ['Velden', '<label>Bedrag<input type="number" value="100" inputmode="decimal"></label>' +
      '<label style="margin-top:8px">Zoeken<input class="search" type="search" placeholder="Zoek op naam of ticker"></label>' +
      '<label style="margin-top:8px">Keuze<select><option>Vandaag</option><option>Deze week</option></select></label>'],
    ['Begrip met uitleg (trm)', rawKv([[trm('Beweeglijkheid', 'vol'), '15,2% per jaar'], [trm('Drawdown', 'drawdown'), '− 8,4%', 'loss']])],
  ];
}

function galRender() {
  const host = document.getElementById('galerij');
  if (!host || !M) return;
  const q = (host.dataset.q || '').toLowerCase();
  const names = galTileNames().filter((n) => !q || n.toLowerCase().includes(q));
  const items = names.map((n) => {
    let html = '', err = '';
    try { html = String(window[n]() || ''); } catch (e) { err = (e && e.message) || String(e); }
    return { naam: n, html, err };
  });
  const controls = q ? [] : galControls();
  host.querySelector('[data-gal-count]').textContent = items.length + ' tegels' + (controls.length ? ' en ' + controls.length + ' bedieningselementen' : '');
  const body = host.querySelector('[data-gal-body]');
  body.innerHTML =
    (controls.length ? '<h2 class="gal-h">Bedieningselementen</h2><div class="gal-grid">' + controls.map(([naam, html]) =>
      '<div class="gal-item"><span class="gal-name">' + esc(naam) + '</span><div class="gal-box">' + html + '</div></div>').join('') + '</div>' : '') +
    '<h2 class="gal-h">Tegels</h2><div class="gal-grid">' + items.map((it) =>
      '<div class="gal-item"><span class="gal-name">' + esc(it.naam) + '</span><div class="gal-box">' +
      (it.err ? '<p class="gal-err">Fout: ' + esc(it.err) + '</p>' : it.html || '<p class="muted small">geeft niets terug</p>') + '</div></div>').join('') + '</div>';
  // Grafieken in de bedieningselementen tekenen (die hebben een echte host nodig)
  body.querySelectorAll('[data-gal-line]').forEach((el) => {
    const pts = (M.intra.get(TOTAL) || []).map((p) => ({ t: p.t, v: p.v }));
    try { lineChart(/** @type {HTMLElement} */ (el), [{ pts, color: C.accent, width: 2.5, label: 'Waarde' }], { zoom: false }); } catch (e) { /* niet erg */ }
  });
  // Tegels die zelf nog iets moeten tekenen, doen dat via hun eigen weergave; hier houden we het bij de HTML.
}

function galStart() {
  if (document.getElementById('galerij')) return;
  const box = document.createElement('div');
  box.id = 'galerij';
  box.className = 'gal';
  box.innerHTML = '<header class="gal-top"><b>Galerij</b>' +
    '<span class="muted small" data-gal-count></span>' +
    '<input class="search" type="search" data-gal-q placeholder="Zoek een tegel" aria-label="Zoek een tegel">' +
    '<span class="seg" role="group" aria-label="Thema"><button type="button" data-gal-theme="light">Licht</button><button type="button" data-gal-theme="dark">Donker</button></span>' +
    '<a href="?demo" class="linklike">Terug naar de site</a></header>' +
    '<p class="gal-note small muted">Alles met voorbeeldgetallen. Dit is geen beleggingsadvies; de getallen zijn verzonnen. ' +
    'Grafieken die de site in een eigen stap tekent, blijven hier leeg: de galerij toont wat een tegel aan HTML teruggeeft.</p>' +
    '<div data-gal-body></div>';
  document.body.appendChild(box);
  document.body.classList.add('gal-on');
  const syncTheme = () => box.querySelectorAll('[data-gal-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-gal-theme') === document.documentElement.dataset.theme)));
  box.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const b = t.closest ? t.closest('[data-gal-theme]') : null;
    if (!b) return;
    document.documentElement.dataset.theme = b.getAttribute('data-gal-theme');
    try { localStorage.setItem('tracker.theme', b.getAttribute('data-gal-theme')); } catch (err) { /* niet erg */ }
    applyTheme();
    syncTheme();
    galRender();
  });
  box.addEventListener('input', (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (!t.matches || !t.matches('[data-gal-q]')) return;
    box.dataset.q = t.value.trim();
    galRender();
  });
  syncTheme();
  galRender();
}

if (galOn) {
  // Geen rondleiding over de galerij heen
  try { localStorage.setItem(LS_TOUR, '1'); } catch (e) { /* niet erg */ }
  document.querySelectorAll('.tour, #tour').forEach((el) => el.remove());
  // De galerij werkt altijd met voorbeeldgegevens: zonder ?demo zetten we die hier zelf aan.
  if (!demo) { demo = true; load(); }
  const wait = () => {
    if (M && M.companies) { galStart(); return; }
    setTimeout(wait, 150);
  };
  wait();
}
