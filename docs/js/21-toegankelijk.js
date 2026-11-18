/* Investeringstracker – Toegankelijkheid: toetsenbord, voorlezen, contrast, eenvoudige taal, leermodus
 *
 * Dit bestand voegt niets aan de gegevens toe; het maakt wat er al staat bruikbaar zonder muis en zonder beeld.
 * Het werkt met de rest van de site mee en niet erin: één keer per wijziging loopt a11yPass() de pagina na
 * (rijen die open kunnen, labels bij balken, uitleg bij begrippen) en de rest zijn losse luisteraars.
 * Zo blijven de tegels zelf onaangeraakt en kunnen ze gewoon opnieuw worden getekend.
 *
 * Gewoon script (geen module): alle bestanden in docs/js/ delen één bereik en laden op volgorde (zie index.html).
 */
'use strict';

// ---------- Meldingen voor schermlezers ----------
// Eén plek waar korte meldingen in komen (laden klaar, order verstuurd, volglijst bijgewerkt).
let a11yClear = 0;
function a11ySay(msg) {
  const el = $('a11y-live');
  if (!el || !msg) return;
  el.textContent = '';
  clearTimeout(a11yClear);
  // Leegmaken en daarna vullen: anders wordt dezelfde tekst twee keer niet voorgelezen
  setTimeout(() => { el.textContent = msg; }, 60);
  a11yClear = setTimeout(() => { el.textContent = ''; }, 8000);
}

// "Gegevens bijgewerkt" alleen melden als de gebruiker er zelf om vroeg (niet bij elke ronde op de achtergrond)
let a11yWantUpdate = false;
// In de opvangfase: het laden begint al in de klikafhandeling van de knop zelf
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  if (t && t.closest && t.closest('.btn-refresh')) { a11yWantUpdate = true; a11ySay('Gegevens worden opgehaald…'); }
}, true);
(function watchUpdated() {
  const el = document.querySelector('.updated');
  if (!el) return;
  new MutationObserver(() => {
    if (!a11yWantUpdate) return;
    a11yWantUpdate = false;
    a11ySay('Gegevens bijgewerkt, ' + (el.textContent || '').replace(/^Bijgewerkt /, ''));
  }).observe(el, { childList: true, characterData: true, subtree: true });
})();

// ---------- Toetsenbord ----------
// Rijen en stippen die geen echte knop zijn (role="button") openen met Enter of de spatiebalk
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const t = /** @type {Element} */ (e.target);
  if (!t || !t.closest) return;
  const el = /** @type {HTMLElement|null} */ (t.closest('[role="button"]'));
  if (!el || el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'INPUT') return;
  e.preventDefault();
  el.click();
});

// Keuzeknoppen (periode, filter, sorteren, tabbladen): met de pijltjes door de rij, Home en End naar het begin of eind.
// De keuze volgt de focus, zoals bij radioknoppen; na het opnieuw tekenen blijft de focus op dezelfde plek staan.
const A11Y_SEG = '.seg, .m-seg, .m-ptabs, .m-dtabs, .m-chips, .watch-tags';
const A11Y_STEP = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
function segRefocus(grp, i) {
  requestAnimationFrame(() => {
    if (!grp.isConnected) {
      // De knoppen zijn opnieuw getekend (bijvoorbeeld in het orderscherm): dan in het venster blijven
      const dlg = a11yDlg();
      if (dlg && !dlg.contains(document.activeElement)) a11yDlgFocus(dlg);
      return;
    }
    const list = [...grp.querySelectorAll('button')];
    const b = /** @type {HTMLElement|undefined} */ (list[i]);
    if (b && document.activeElement !== b) b.focus({ preventScroll: true });
  });
}
document.addEventListener('keydown', (e) => {
  const t = /** @type {Element} */ (e.target);
  if (!t || !t.closest) return;
  const grp = t.closest(A11Y_SEG);
  const btn = /** @type {HTMLButtonElement|null} */ (t.closest('button'));
  if (!grp || !btn || !grp.contains(btn)) return;
  const list = [...grp.querySelectorAll('button')].filter((b) => !(/** @type {HTMLButtonElement} */ (b).disabled));
  const i = list.indexOf(btn);
  if (i < 0) return;
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1
    : A11Y_STEP[e.key] != null ? (i + A11Y_STEP[e.key] + list.length) % list.length : -1;
  if (j < 0) return;
  e.preventDefault();
  const next = /** @type {HTMLElement} */ (list[j]);
  next.focus({ preventScroll: true });
  if (next.hasAttribute('aria-pressed')) { next.click(); segRefocus(grp, j); }
});

// ---------- Focus bij een paginawissel en in dialoogvensters ----------
const A11Y_PAGE_H = { home: 'home-title', list: 'list-title', news: 'news-title', stats: 'stats-title', plan: 'plan-title' };
function focusPageHeading() {
  const h = /** @type {HTMLElement|null} */ (mode === 'm' ? $('m-title') : $(A11Y_PAGE_H[ui.page] || ''));
  if (!h || !h.offsetParent) return;
  h.tabIndex = -1;
  h.focus({ preventScroll: true });
}
// showPage zet body[data-page]; dat is het signaal dat er een andere pagina staat
let a11yPageArmed = false;
new MutationObserver(() => {
  if (a11yPageArmed) focusPageHeading();
  a11yPageArmed = true;
}).observe(document.body, { attributes: true, attributeFilter: ['data-page'] });

// Eigen dialoogvensters (order, quiz, uitleg): focus erin houden en bij sluiten teruggeven
const A11Y_FOCUS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let a11yDlgBack = null;
const a11yDlg = () => /** @type {HTMLElement|null} */ (document.querySelector('.overlay-dlg, .term-pop'));
function a11yDlgFocus(el) {
  const first = /** @type {HTMLElement|null} */ (el.querySelector(A11Y_FOCUS));
  if (first) first.focus({ preventScroll: true });
}
new MutationObserver((recs) => {
  recs.forEach((r) => {
    r.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      const el = /** @type {HTMLElement} */ (n);
      if (!el.matches || !el.matches('.overlay-dlg, .term-pop')) return;
      const act = /** @type {HTMLElement|null} */ (document.activeElement);
      if (act && act !== document.body) a11yDlgBack = act;
      requestAnimationFrame(() => { if (el.isConnected) a11yDlgFocus(el); });
    });
    r.removedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      const el = /** @type {HTMLElement} */ (n);
      if (!el.matches || !el.matches('.overlay-dlg, .term-pop')) return;
      if (a11yDlg()) return;
      const back = a11yDlgBack;
      a11yDlgBack = null;
      // Alleen teruggeven als de focus met het venster verdween; anders niet weghalen waar de gebruiker net klikte
      const act = document.activeElement;
      if (back && back.isConnected && (!act || act === document.body)) back.focus({ preventScroll: true });
    });
  });
}).observe(document.body, { childList: true });

document.addEventListener('keydown', (e) => {
  const dlg = a11yDlg();
  if (!dlg) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    const x = /** @type {HTMLElement|null} */ (dlg.querySelector('[data-t="cancel"], [data-x], [data-term-close], [data-quiz="close"]'));
    if (x) x.click(); else dlg.remove();
    return;
  }
  if (e.key !== 'Tab') return;
  const box = dlg.querySelector('.dlg-card') || dlg;
  const list = [...box.querySelectorAll(A11Y_FOCUS)].filter((el) => /** @type {HTMLElement} */ (el).offsetParent !== null);
  if (!list.length) return;
  const first = /** @type {HTMLElement} */ (list[0]), last = /** @type {HTMLElement} */ (list[list.length - 1]);
  const act = document.activeElement;
  if (!box.contains(act)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && act === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
});

// ---------- Weergave: eenvoudige taal, dyslexievriendelijk, leermodus ----------
const A11Y_DISP = [
  ['eenvoudig', 'Eenvoudige taal (minder vaktermen en tegels met veel jargon verbergen)'],
  ['dys', 'Dyslexievriendelijk (meer ruimte tussen regels, woorden en letters)'],
  ['leer', 'Leermodus (uitleg bij een begrip de eerste keer, met een korte quiz)'],
];
A11Y_DISP.forEach((d) => DISP.push(d));
applyDisplay();
(function a11yDispOptions() {
  const box = document.querySelector('.disp-opts');
  if (!box || box.querySelector('[data-disp="dys"]')) return;
  const extra = A11Y_DISP.map(([k, l]) => '<label class="check"><input type="checkbox" data-disp="' + k + '"' + (dispOn(k) ? ' checked' : '') + '> ' + esc(l) + '</label>').join('');
  const last = box.querySelector('label.check:last-of-type');
  if (last) last.insertAdjacentHTML('afterend', extra); else box.insertAdjacentHTML('beforeend', extra);
})();
document.addEventListener('change', (e) => {
  const t = /** @type {Element} */ (e.target);
  const el = /** @type {HTMLInputElement|null} */ (t && t.closest ? t.closest('[data-disp="eenvoudig"], [data-disp="leer"]') : null);
  if (!el) return;
  // De vinkjes zelf worden door js/18-gemak.js opgeslagen; hier alleen de melding
  setTimeout(() => {
    const n = document.querySelectorAll('[data-jargon="1"]').length;
    a11ySay(el.dataset.disp === 'leer'
      ? (el.checked ? 'Leermodus staat aan: bij een begrip komt een korte uitleg.' : 'Leermodus staat uit.')
      : (el.checked ? 'Eenvoudige taal staat aan, ' + n + ' tegels met veel vaktermen zijn verborgen.' : 'Eenvoudige taal staat uit.'));
  }, 120);
});

// Eenvoudiger woorden voor de begrippen uit GLOSS (js/18-gemak.js)
const SIMPLE_TERM = {
  xirr: 'rendement per jaar', twr: 'rendement zonder stortingen', drawdown: 'diepste daling', vol: 'schommeling',
  sharpe: 'rendement per risico', sortino: 'rendement per daling', calmar: 'rendement per diepste daling',
  beta: 'meebeweging met de markt', unreal: 'nog niet verkocht', real: 'al verkocht', fxfee: 'wisselkosten',
  montecarlo: 'duizenden doorrekeningen', fire: 'stoppen met werken', rebalance: 'terug naar je verdeling',
  box3: 'belasting op vermogen', pe: 'koers tegenover winst', ter: 'kosten van een fonds',
  insider: 'bestuurders', dividend: 'dividend tegenover de koers', etf: 'indexfonds',
};
// Tegels met veel vaktermen: in eenvoudige taal verborgen (de kop moet een van deze woorden bevatten)
const JARGON_WORDS = ['ratio', 'monte carlo', 'box 3', 'xirr', 'twr', 'betrouwbaarheid', '13f', 'screener', 'drawdown',
  'terugval', 'samenhang', 'correlatie', 'gevoeligheid', 'valuta-effect', 'beweeglijkheid', 'herbalanceren', 'kwartaalcijfers tegenover'];

// ---------- Leermodus: uitleg bij een begrip, de eerste keer ----------
const LS_LEER = 'tracker.leerSeen';
function leerSeen() { try { return new Set(JSON.parse(localStorage.getItem(LS_LEER) || '[]')); } catch (e) { return new Set(); } }
function leerMark(key) {
  const s = leerSeen();
  s.add(key);
  try { localStorage.setItem(LS_LEER, JSON.stringify([...s])); } catch (e) { /* niet erg */ }
}
function leerCard(key) {
  const g = GLOSS[key];
  if (!g) return '';
  return '<div class="leer-card" role="note" data-leer="' + esc(key) + '"><b>Leermodus · ' + esc(g[0]) + '</b><p>' + esc(g[1]) + '</p>' +
    '<div class="exp"><button type="button" class="btn ghost" data-leer-ok="' + esc(key) + '">Begrepen</button>' +
    '<button type="button" class="btn ghost" data-leer-quiz>Quiz over begrippen</button></div></div>';
}
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target);
  if (!t || !t.closest) return;
  const ok = /** @type {HTMLElement|null} */ (t.closest('[data-leer-ok]'));
  if (ok) {
    e.preventDefault(); e.stopPropagation();
    leerMark(ok.dataset.leerOk);
    const card = ok.closest('.leer-card');
    if (card) card.remove();
    a11ySay('Uitleg afgevinkt.');
    return;
  }
  if (t.closest('[data-leer-quiz]')) { e.preventDefault(); e.stopPropagation(); openQuiz(); }
});

// ---------- Mini-quiz: welk begrip hoort bij de uitleg? ----------
function quizPick(n) {
  const keys = Object.keys(GLOSS);
  for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = keys[i]; keys[i] = keys[j]; keys[j] = x; }
  return keys.slice(0, Math.min(n, keys.length));
}
function openQuiz() {
  if (document.querySelector('.overlay-dlg')) return;
  const qs = quizPick(5).map((key) => {
    const wrong = quizPick(8).filter((k) => k !== key).slice(0, 3);
    const opts = [key].concat(wrong);
    for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = opts[i]; opts[i] = opts[j]; opts[j] = x; }
    return { key, opts };
  });
  let i = 0, score = 0, picked = null;
  const dlg = document.createElement('div');
  dlg.className = 'overlay-dlg quiz-dlg';
  document.body.appendChild(dlg);
  const close = () => dlg.remove();
  const draw = () => {
    if (i >= qs.length) {
      dlg.innerHTML = '<div class="dlg-card" role="dialog" aria-modal="true" aria-label="Quiz afgerond"><h3>Quiz afgerond</h3>' +
        '<p>' + score + ' van ' + qs.length + ' goed.</p><p class="sub">De uitleg van alle begrippen staat op Analyse, bij Begrippen.</p>' +
        '<div class="dlg-actions"><button type="button" class="btn ghost" data-quiz="again">Nog een ronde</button>' +
        '<button type="button" class="btn primary" data-quiz="close">Sluiten</button></div></div>';
      a11ySay('Quiz afgerond: ' + score + ' van ' + qs.length + ' goed.');
      return;
    }
    const q = qs[i];
    const good = picked === q.key;
    dlg.innerHTML = '<div class="dlg-card" role="dialog" aria-modal="true" aria-label="Quiz over begrippen">' +
      '<h3>Vraag ' + (i + 1) + ' van ' + qs.length + '</h3>' +
      '<p class="quiz-q">' + esc(GLOSS[q.key][1]) + '</p><p class="sub">Welk begrip is dit?</p>' +
      '<div class="quiz-opts">' + q.opts.map((k) => '<button type="button" class="btn ghost quiz-opt' +
        (picked ? (k === q.key ? ' good' : k === picked ? ' bad' : '') : '') + '" data-quiz-opt="' + esc(k) + '"' + (picked ? ' disabled' : '') + '>' +
        esc(GLOSS[k][0]) + (picked && k === q.key ? ' ✓' : picked && k === picked ? ' ✗' : '') + '</button>').join('') + '</div>' +
      (picked ? '<p class="small ' + (good ? 'gain' : 'loss') + '" role="status">' + (good ? 'Goed.' : 'Dat was: ' + esc(GLOSS[q.key][0]) + '.') + '</p>' : '<p class="small" role="status"></p>') +
      '<div class="dlg-actions"><button type="button" class="btn ghost" data-quiz="close">Stoppen</button>' +
      (picked ? '<button type="button" class="btn primary" data-quiz="next">' + (i === qs.length - 1 ? 'Uitslag' : 'Volgende') + '</button>' : '') + '</div></div>';
  };
  dlg.addEventListener('click', (e) => {
    const t = /** @type {Element} */ (e.target);
    if (t === dlg) { close(); return; }
    const opt = /** @type {HTMLElement|null} */ (t.closest ? t.closest('[data-quiz-opt]') : null);
    if (opt && !picked) {
      picked = opt.dataset.quizOpt;
      if (picked === qs[i].key) score++;
      leerMark(qs[i].key);
      draw();
      const nx = /** @type {HTMLElement|null} */ (dlg.querySelector('[data-quiz="next"]'));
      if (nx) nx.focus({ preventScroll: true });
      return;
    }
    const act = /** @type {HTMLElement|null} */ (t.closest ? t.closest('[data-quiz]') : null);
    if (!act) return;
    if (act.dataset.quiz === 'close') { close(); return; }
    if (act.dataset.quiz === 'again') { i = 0; score = 0; picked = null; draw(); a11yDlgFocus(dlg); return; }
    i++; picked = null; draw();
    a11yDlgFocus(dlg);
  });
  draw();
}

// ---------- Taal van losse teksten (nieuwskoppen komen vaak in het Engels) ----------
const NL_WORDS = /\b(de|het|een|van|voor|met|niet|wordt|meer|naar|bij|zijn|haar|over|door|aan|dat|dit|maar|ook|jaar|winst|koers|aandeel|aandelen|bedrijf|cijfers|miljard|miljoen|verwachting)\b/gi;
const EN_WORDS = /\b(the|of|and|to|for|with|in|on|says|after|from|its|new|stock|shares|earnings|billion|million|quarter|beats|hits|amid|as|up|down)\b/gi;
function guessLang(text) {
  const s = String(text || '');
  if (s.length < 12) return null;
  const nl = (s.match(NL_WORDS) || []).length, en = (s.match(EN_WORDS) || []).length;
  if (nl > en) return 'nl';
  if (en > nl) return 'en';
  return null;
}

// ---------- De pagina nalopen ----------
// Loopt na elke wijziging één keer over wat er staat: rijen die open kunnen, labels bij balken,
// uitleg bij begrippen en de tegels die in eenvoudige taal verborgen worden.
const A11Y_ROOTS = ['app', 'm-main', 'detail', 'notices'];
const REC_LABEL = { '#0B7A4B': 'sterk kopen', '#5FB58A': 'kopen', '#C9CED6': 'houden', '#E3A79C': 'verkopen', '#B4311F': 'sterk verkopen' };
// De browser schrijft een stijl soms als rgb(...) terug (zo zet Preact hem neer): beide vormen lezen
function styleColor(style) {
  const hex = style.match(/#[0-9A-Fa-f]{6}/);
  if (hex) return hex[0].toUpperCase();
  const rgb = style.match(/rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return rgb ? '#' + [1, 2, 3].map((i) => Number(rgb[i]).toString(16).padStart(2, '0')).join('').toUpperCase() : '';
}
// Korte naam voor een rij: bij een tabelrij de cellen met een komma ertussen, anders de tekst zelf
function shortText(el) {
  const cells = el.tagName === 'TR' ? [...el.children].map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean) : null;
  const t = cells ? cells.join(', ') : (el.textContent || '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 120);
}

function a11yRowsPass(root) {
  root.querySelectorAll('[data-ticker]:not(button):not(a), [data-open]:not(button):not(a)').forEach((el) => {
    const e = /** @type {HTMLElement} */ (el);
    if (e.closest('[aria-hidden="true"]')) return;
    if (!e.getAttribute('role')) e.setAttribute('role', 'button');
    if (!e.hasAttribute('tabindex')) e.tabIndex = 0;
    if (!e.getAttribute('aria-label')) e.setAttribute('aria-label', shortText(e) + ' – openen');
  });
}
// 95 en 86: een knop met zichtbare tekst moet die tekst ook in zijn naam hebben (anders kan wie met zijn stem
// bedient de tegel niet aanspreken). De extra uitleg uit aria-label wordt daarom alleen-voor-schermlezers tekst.
const a11yNorm = (s) => String(s || '').toLowerCase().replace(/[\u2060\u00a0\s]+/g, ' ').trim();
function a11yNamePass(root) {
  root.querySelectorAll('button[aria-label], [role="button"][aria-label]').forEach((el) => {
    const e = /** @type {HTMLElement} */ (el);
    const vis = a11yNorm(e.textContent);
    const lab = e.getAttribute('aria-label') || '';
    if (!vis || !lab || a11yNorm(lab).includes(vis)) return;
    // "Accountwaarde: bekijk waar je geld zit" wordt "bekijk waar je geld zit" als de tegel al met dat woord begint
    const cut = lab.indexOf(': ');
    const hint = cut > 0 && vis.startsWith(a11yNorm(lab.slice(0, cut))) ? lab.slice(cut + 2) : lab;
    e.removeAttribute('aria-label');
    e.insertAdjacentHTML('beforeend', '<span class="sr-only sr-extra">. ' + esc(hint) + '</span>');
  });
}
function a11yFoldPass(root) {
  root.querySelectorAll('.tile.fold > .fold-btn').forEach((el) => {
    const b = /** @type {HTMLElement} */ (el);
    const h = b.parentElement ? b.parentElement.querySelector('h3') : null;
    const t = h ? (h.textContent || '').trim() : '';
    b.setAttribute('aria-label', (b.textContent || '').trim() + (t ? ': ' + t : ''));
  });
}
function a11yBarsPass(root) {
  // Aanbevelingen van analisten als smalle balk: zonder kleur te zien staat er nu ook wat erin zit
  root.querySelectorAll('.rec-bar').forEach((el) => {
    const bar = /** @type {HTMLElement} */ (el);
    if (bar.getAttribute('aria-label')) return;
    const parts = [...bar.querySelectorAll('i')].map((seg) => {
      const st = /** @type {HTMLElement} */ (seg).getAttribute('style') || '';
      const col = styleColor(st);
      const n = (st.match(/flex:\s*([\d.]+)/) || [])[1];
      return REC_LABEL[col] ? REC_LABEL[col] + (n ? ' ' + n : '') : null;
    }).filter(Boolean);
    if (!parts.length) return;
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', 'Analisten: ' + parts.join(', '));
  });
  // Tabellen in een tegel: de kop van de tegel als naam, zodat een schermlezer weet welke tabel dit is
  root.querySelectorAll('table.tbl').forEach((el) => {
    const t = /** @type {HTMLElement} */ (el);
    if (t.getAttribute('aria-label') || t.querySelector('caption')) return;
    const tile = t.closest('section, .tile');
    const h = tile ? tile.querySelector('h3, h2') : null;
    if (h) t.setAttribute('aria-label', (h.textContent || '').trim());
  });
  // Statusregels die tijdens het werk worden bijgewerkt, altijd als meldgebied
  root.querySelectorAll('.plan-status, .watch-status, .login-st, .ledger-n').forEach((el) => {
    if (!el.getAttribute('role')) el.setAttribute('role', 'status');
  });
}
// Vakken waarin je kunt schuiven (brede tabellen, de lange transactielijst) zonder knop of link erin:
// met Tab erheen, dan schuiven met de pijltjes
function a11yScrollPass(root) {
  root.querySelectorAll('.vlist, .tbl-wrap, .yheat-wrap, .mk-grid').forEach((el) => {
    const e = /** @type {HTMLElement} */ (el);
    const over = e.scrollWidth > e.clientWidth + 4 || e.scrollHeight > e.clientHeight + 4;
    const canFocus = !!e.querySelector(A11Y_FOCUS);
    if (over && !canFocus) {
      if (!e.hasAttribute('tabindex')) e.tabIndex = 0;
    } else if (e.getAttribute('tabindex') === '0' && canFocus) e.removeAttribute('tabindex');
  });
}
function a11yLangPass(root) {
  root.querySelectorAll('.news-t, .news-s').forEach((el) => {
    const e = /** @type {HTMLElement} */ (el);
    if (e.dataset.lang === '1') return;
    const g = guessLang(e.textContent);
    e.dataset.lang = '1';
    if (g && g !== document.documentElement.lang) e.setAttribute('lang', g); else e.removeAttribute('lang');
  });
}
function a11yPlainPass(root) {
  const on = dispOn('eenvoudig');
  root.querySelectorAll('.tile, .m-stat').forEach((el) => {
    const tile = /** @type {HTMLElement} */ (el);
    const h = tile.querySelector('h3, .k');
    const t = h ? (h.textContent || '').toLowerCase() : '';
    if (t && JARGON_WORDS.some((w) => t.includes(w))) tile.dataset.jargon = '1';
    else if (tile.dataset.jargon) delete tile.dataset.jargon;
  });
  if (!on) return;
  root.querySelectorAll('.term[data-term]').forEach((el) => {
    const b = /** @type {HTMLElement} */ (el);
    const s = SIMPLE_TERM[b.dataset.term];
    if (s && (b.textContent || '').trim() !== s) b.textContent = s;
  });
}
// Hoogstens één uitleg per tegel en vier tegelijk op het scherm: anders staat de pagina vol kaarten
const LEER_MAX = 4;
function a11yLeerPass(root) {
  if (!dispOn('leer')) { root.querySelectorAll('.leer-card').forEach((c) => c.remove()); return; }
  const seen = leerSeen();
  const done = new Set();
  const tiles = new Set();
  let n = root.querySelectorAll('.leer-card').length;
  root.querySelectorAll('.term[data-term]').forEach((el) => {
    if (n >= LEER_MAX) return;
    const b = /** @type {HTMLElement} */ (el);
    const key = b.dataset.term;
    if (!key || seen.has(key) || done.has(key)) return;
    const tile = /** @type {HTMLElement|null} */ (b.closest('.tile, section'));
    if (!tile || tiles.has(tile) || tile.querySelector('.leer-card')) return;
    done.add(key);
    tiles.add(tile);
    n++;
    tile.insertAdjacentHTML('beforeend', leerCard(key));
  });
  // Bij de lijst met begrippen (Analyse) een knop naar de quiz
  root.querySelectorAll('.gloss').forEach((g) => {
    const tile = g.closest('.tile');
    if (!tile || tile.querySelector('[data-leer-quiz]')) return;
    tile.insertAdjacentHTML('beforeend', '<div class="exp" style="margin-top:10px"><button type="button" class="btn ghost" data-leer-quiz>Quiz over begrippen</button></div>');
  });
}

let a11yBusy = false, a11yTimer = 0;
function a11yPass() {
  a11yBusy = true;
  try {
    A11Y_ROOTS.forEach((id) => {
      const root = $(id);
      if (!root || root.hidden) return;
      a11yRowsPass(root);
      a11yNamePass(root);
      a11yFoldPass(root);
      a11yBarsPass(root);
      a11yScrollPass(root);
      a11yLangPass(root);
      a11yPlainPass(root);
      a11yLeerPass(root);
    });
  } catch (err) { console.error('Toegankelijkheid: nalopen kon niet:', err); }
  a11yBusy = false;
}
function a11ySoon() {
  if (a11yBusy || a11yTimer) return;
  a11yTimer = requestAnimationFrame(() => { a11yTimer = 0; a11yPass(); });
}
(function a11yWatch() {
  const mo = new MutationObserver(() => { if (!a11yBusy) a11ySoon(); });
  A11Y_ROOTS.forEach((id) => { const el = $(id); if (el) mo.observe(el, { childList: true, subtree: true }); });
  a11ySoon();
})();
