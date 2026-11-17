/* Investeringstracker – kern: kleine eigen bouwstenen voor de rest van de site
 *
 * De site bestaat uit gewone scripts in docs/js/, die op volgorde laden en één bereik delen
 * (functies en constanten uit het ene bestand zijn in het volgende te gebruiken). Er is geen build-stap.
 *
 * Twee hulpmiddelen:
 *  - weergaven: een stuk van de pagina met een eigen tekenfunctie. renderAll() tekent ze allemaal,
 *    refresh('plan') alleen dat stuk. Een fout in één weergave breekt de rest van de pagina niet.
 *  - tpl`...`: HTML-sjabloon dat ingevoegde waarden automatisch ontsnapt (tegen kapotte opmaak en
 *    ingevoegde code). Voor HTML die je zelf al veilig hebt gemaakt: raw(html).
 *
 * Nieuwe pagina's kunnen ook met Preact als componenten worden gebouwd (zie js/nieuws-preact.js).
 */
'use strict';

// ---------- Weergaven ----------
const VIEWS = new Map();

// name: korte naam; draw: tekent het stuk (mag zelf bepalen of het voor desktop of telefoon is)
function defineView(name, draw) {
  VIEWS.set(name, draw);
}

// Teken de genoemde weergaven opnieuw, of alle als er geen namen zijn
function refresh(...names) {
  const list = names.length ? names : [...VIEWS.keys()];
  list.forEach((n) => {
    const draw = VIEWS.get(n);
    if (!draw) return;
    try { draw(); }
    catch (err) { console.error('Weergave "' + n + '" kon niet worden getekend:', err); }
  });
}

// ---------- HTML-sjablonen ----------
// Gemarkeerde HTML die niet opnieuw ontsnapt moet worden
class RawHtml {
  constructor(s) { this.s = String(s == null ? '' : s); }
  toString() { return this.s; }
}
const raw = (s) => new RawHtml(s);
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// tpl`<b>${naam}</b>` -> "<b>naam, ontsnapt</b>". Lijsten worden aan elkaar geplakt; null en false worden leeg.
function tplValue(v) {
  if (v == null || v === false) return '';
  if (v instanceof RawHtml) return v.s;
  if (Array.isArray(v)) return v.map(tplValue).join('');
  return escHtml(v);
}
function tpl(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += tplValue(vals[i]) + strings[i + 1];
  return raw(out);
}
