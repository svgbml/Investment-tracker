/* Investeringstracker – Tickerkaart: wijs een beurssymbool aan (overal waar data-ticker staat) en zie een
 * kaartje met koers, verandering vandaag, je deel en wat analisten vinden. Op een aanraakscherm: lang indrukken.
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html). */
'use strict';

const TC_DELAY = 280;   // wijzen: even wachten, zodat de kaart niet bij elke beweging opduikt
const TC_HOLD = 480;    // aanraken: lang indrukken
const tcard = { el: null, key: null, timer: null, hold: null, suppress: false };

function tcardEl() {
  if (!tcard.el) {
    const d = document.createElement('div');
    d.className = 'tcard';
    d.id = 'tcard';
    d.hidden = true;
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Kort overzicht van het aandeel');
    document.body.appendChild(d);
    tcard.el = d;
  }
  return tcard.el;
}
// Wat analisten vinden, kort: het deel dat kopen adviseert en het gemiddelde koersdoel
function tcardAnalysts(sym, cur) {
  const R = (data.research || {})[sym];
  const rec = R && (R.rec || [])[0];
  const tot = rec ? (rec.sb || 0) + (rec.b || 0) + (rec.h || 0) + (rec.s || 0) + (rec.ss || 0) : 0;
  const out = [];
  if (tot) out.push(P1.format(((rec.sb || 0) + (rec.b || 0)) / tot) + ' van ' + tot + ' adviseert kopen');
  if (R && R.target && isNum(R.target.mean)) out.push('koersdoel ' + money(R.target.mean, cur));
  return out.join(', ');
}
function tcardHtml(key) {
  const watch = isWatchKey(key);
  const sym = watch ? key.slice(1) : key;
  const c = !watch && M ? M.byTk.get(sym) : null;
  const p = M && M.mk && M.mk.ok ? (c ? M.mk.profOf(sym) : M.mk.prof(sym)) : null;
  const cur = (c && c.cur) || (p && p.currency) || 'USD';
  const name = (c && c.name) || (p && p.name) || sym;
  const mine = typeof myTargetOf === 'function' ? myTargetOf(sym) : null;
  const price = c && isNum(c.priceNative) ? c.priceNative : p && isNum(p.price) ? p.price : null;
  const ch = c ? c.changePct : p && isNum(p.change) ? p.change / 100 : null;
  const pts = c ? marketSeries(sym, '1m') : p ? M.mk.prices(sym).slice(-30).map((x) => ({ t: x.t, v: x.v })) : [];
  const an = tcardAnalysts(sym, cur);
  const rows = [
    ['Koers', isNum(price) ? money(price, cur) : '–'],
    [c ? (M.isToday ? 'Vandaag' : 'Laatste handelsdag') : 'Laatste handelsdag', isNum(ch) ? spct(ch) + (c && isNum(c.change) ? ' · ' + seur(c.change) : '') : '–', tone(ch)],
  ];
  if (c) {
    rows.push(['Waarde', eur(c.value) + (isNum(c.weight) ? ' · ' + P1.format(c.weight) + ' van je beleggingen' : '')]);
    rows.push(['Sinds aankoop', isNum(c.resultPct) ? spct1(c.resultPct) : '–', tone(c.resultPct)]);
  } else {
    rows.push(['Op je volglijst', (p && p.sector ? sectorNl(p.sector) : 'nog geen profiel')]);
  }
  if (isNum(mine)) rows.push(['Mijn koersdoel', money(mine, cur) + (isNum(price) && price > 0 ? ' · ' + spct1(mine / price - 1) : '')]);
  return '<div class="tc-h"><b>' + esc(sym) + '</b><span>' + esc(name) + '</span></div>' +
    (pts.length > 1 ? '<div class="tc-sp">' + spark(pts, toneColor(isNum(ch) ? ch : 0)) + '</div>' : '') +
    kvList(rows) +
    (an ? '<p class="tc-an">' + esc(an) + '</p>' : '') +
    '<div class="tc-acts"><button type="button" class="btn ghost" data-tc-open="' + esc(key) + '">Openen</button>' +
    '<button type="button" class="btn ghost" data-alarm="' + esc(sym) + '">' + esc(T('Koersalarm')) + '</button></div>';
}
function tcardShow(el, key) {
  if (!M || !key || key[0] === '@') return;
  const sym = isWatchKey(key) ? key.slice(1) : key;
  if (!isWatchKey(key) && !M.byTk.has(sym)) return;              // gesloten posities en losse symbolen: geen kaart
  if (isWatchKey(key) && !watchSyms().includes(sym)) return;
  const box = tcardEl();
  try { box.innerHTML = tcardHtml(key); } catch (err) { return; }
  tcard.key = key;
  box.hidden = false;
  box.classList.toggle('still', reduceMotion());
  const r = el.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
  box.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
}
function tcardHide() {
  clearTimeout(tcard.timer);
  clearTimeout(tcard.hold);
  tcard.key = null;
  if (tcard.el) tcard.el.hidden = true;
}
// Het aangewezen element met een ticker, of niets (eigen kaart, dialoog of een element met een eigen tooltip)
function tcardTarget(target) {
  const t = /** @type {Element|null} */ (target);
  if (!t || !t.closest) return null;
  if (t.closest('#tcard') || t.closest('dialog')) return null;
  const el = /** @type {HTMLElement|null} */ (t.closest('[data-ticker]'));
  if (!el || el.dataset.tip) return null;
  return el;
}

// Wijzen met de muis
document.addEventListener('pointerover', (e) => {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  const el = tcardTarget(e.target);
  if (!el) return;
  const key = el.dataset.ticker;
  if (key === tcard.key) return;
  clearTimeout(tcard.timer);
  tcard.timer = setTimeout(() => tcardShow(el, key), TC_DELAY);
});
document.addEventListener('pointerout', (e) => {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  const from = near(e, '[data-ticker], #tcard');
  if (!from) return;
  const to = /** @type {Element|null} */ (e.relatedTarget);
  if (to && to.closest && (to.closest('#tcard') || to.closest('[data-ticker]') === from)) return;
  tcardHide();
});
window.addEventListener('scroll', tcardHide, { passive: true, capture: true });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tcard.key) tcardHide(); });

// Aanraken: lang indrukken toont de kaart; een normale tik blijft gewoon werken
document.addEventListener('touchstart', (e) => {
  const el = tcardTarget(e.target);
  if (!el || (e.touches && e.touches.length > 1)) return;
  const key = el.dataset.ticker;
  clearTimeout(tcard.hold);
  tcard.hold = setTimeout(() => {
    tcardShow(el, key);
    tcard.suppress = !!tcard.key;                                // alleen de tik na het lang indrukken overslaan
  }, TC_HOLD);
}, { passive: true });
['touchmove', 'touchend', 'touchcancel'].forEach((n) => document.addEventListener(n, () => clearTimeout(tcard.hold), { passive: true }));
document.addEventListener('click', (e) => {
  const inCard = near(e, '#tcard');
  if (tcard.suppress) {
    tcard.suppress = false;
    if (!inCard) { e.preventDefault(); e.stopPropagation(); }
    return;
  }
  if (inCard) return;
  if (tcard.key) tcardHide();
}, true);
document.addEventListener('click', (e) => {
  const b = near(e, '[data-tc-open]');
  if (!b) return;
  const key = b.dataset.tcOpen;
  tcardHide();
  openDetail(key, null, true);
});
