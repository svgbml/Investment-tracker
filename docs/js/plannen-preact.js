/* Investeringstracker – Plannen als Preact-componenten
 *
 * Streefverdeling, inleg-assistent en vooruitblik zijn componenten: typen in een veld werkt alleen dat stuk bij,
 * zonder de hele pagina opnieuw op te bouwen (en zonder dat je cursor verspringt). De andere tegels komen nog
 * als HTML uit de gewone scripts (Legacy) en houden hun eigen klikafhandeling (planEvents, data-xa).
 * Toestand blijft in het gedeelde object 'plan' (js/06-plannen.js), zodat beide versies hetzelfde laten zien.
 * Lukt het laden van deze module niet, dan tekent renderPlan() de HTML-versie.
 */
import { html, render, useState, useMemo, useEffect, useRef } from '../vendor/preact-htm.js';

function Legacy({ markup }) {
  return html`<div style="display:contents" dangerouslySetInnerHTML=${{ __html: markup }}></div>`;
}
function Seg({ value, options, onPick, label }) {
  return html`<div class="seg light" role="group" aria-label=${label}>
    ${options.map(([k, l]) => html`<button type="button" aria-pressed=${String(String(value) === String(k))} onClick=${() => onPick(k)}>${l}</button>`)}
  </div>`;
}
const num = (v) => (v === '' || v == null ? null : Number(v));

// ---------- Streefverdeling ----------
function TargetTile({ bump }) {
  const [, setTick] = useState(0);
  const redraw = () => { setTick((n) => n + 1); bump(); };
  const t = planTargets();
  const items = allocItems(plan.mode);
  const total = M.totalValue || 0;
  const tSum = sum(Object.values(t).filter(isNum));
  const setT = (key, v) => { const n = num(v); if (n == null || !isNum(n)) delete plan.draft.t[key]; else plan.draft.t[key] = Math.max(0, Math.min(100, n)); redraw(); };
  const save = async () => {
    plan.status = 'Bezig met opslaan…'; redraw();
    try { await saveSettings({ targets: plan.draft.t, targetMode: plan.mode }); plan.status = 'Doelen opgeslagen' + (demo ? ' (in deze browser).' : '; ze gelden ook op je andere apparaten.'); }
    catch (err) { plan.status = 'Opslaan is mislukt: ' + err.message + '.'; }
    redraw(); renderDriftNote();
  };
  const row = (x) => {
    const tv = t[x.key];
    const diff = isNum(tv) ? x.w * 100 - tv : null;
    const eurDiff = isNum(tv) ? (tv / 100) * total - x.v : null;
    return html`<tr key=${x.key}>
      <td class="co"><b>${x.label}</b><span class="nm">${x.sub}</span></td>
      <td class="num">${P1.format(x.w)}<span class="bar-mini"><i style=${'width:' + Math.min(100, x.w * 200).toFixed(1) + '%'}></i></span></td>
      <td class="num"><span class="stepper"><button type="button" aria-label=${'Doel voor ' + x.label + ' 1 procent lager'} onClick=${() => setT(x.key, String(Math.max(0, Math.round(isNum(tv) ? tv : 0) - 1)))}>−</button><input class="t-in" type="number" inputmode="decimal" min="0" max="100" step="0.5" value=${isNum(tv) ? tv : ''} placeholder="–"
        aria-label=${'Doel voor ' + x.label + ' in procent'} onInput=${(e) => setT(x.key, e.currentTarget.value)} /><button type="button" aria-label=${'Doel voor ' + x.label + ' 1 procent hoger'} onClick=${() => setT(x.key, String(Math.min(100, Math.round(isNum(tv) ? tv : 0) + 1)))}>+</button></span></td>
      <td class=${'num t-diff ' + (isNum(diff) && Math.abs(diff) >= 0.5 ? (diff > 0 ? 'loss' : 'gain') : '')}>
        ${isNum(diff) ? (Math.abs(diff) < 0.05 ? 'op doel' : sgn(diff, N1) + ' pp') : ''}
        <span class="sub">${isNum(eurDiff) && Math.abs(eurDiff) >= 1 ? (eurDiff > 0 ? eur(eurDiff) + ' bijkopen' : eur(-eurDiff) + ' te veel') : ''}</span></td>
    </tr>`;
  };
  return html`<section class="tile pad plan-target">
    <div class="plan-head"><h3>Streefverdeling</h3>
      <${Seg} value=${plan.mode} options=${[['position', 'Per positie'], ['sector', 'Per sector']]} label="Streefverdeling per positie of per sector"
        onPick=${(k) => { plan.mode = k; plan.draft = null; plan.status = ''; redraw(); }} /></div>
    <p class="sub">Vul in hoeveel procent van je beleggingen (zonder vrij saldo) je in elke ${plan.mode === 'sector' ? 'sector' : 'positie'} wilt hebben. Leeg betekent: geen doel.</p>
    <div class="tbl-wrap"><table class="tbl plan-tbl"><thead><tr><th>${plan.mode === 'sector' ? 'Sector' : 'Positie'}</th><th class="num">Nu</th><th class="num">Doel %</th><th class="num">Verschil</th></tr></thead>
      <tbody>${items.map(row)}</tbody></table></div>
    <div class="plan-foot"><span class=${'t-sum ' + (Math.abs(tSum - 100) < 0.05 || !tSum ? '' : 'loss')}>Doelen samen: ${N1.format(tSum)}%${tSum && Math.abs(tSum - 100) >= 0.05 ? ' (hoort 100% te zijn)' : ''}</span>
      <span class="plan-actions">
        <button type="button" class="btn ghost" onClick=${() => { items.forEach((x) => { plan.draft.t[x.key] = Math.round(1000 / items.length) / 10; }); redraw(); }}>Gelijk verdelen</button>
        <button type="button" class="btn ghost" onClick=${() => { items.forEach((x) => { plan.draft.t[x.key] = Math.round(x.w * 1000) / 10; }); redraw(); }}>Huidige verdeling als doel</button>
        <button type="button" class="btn primary" onClick=${save}>Doelen opslaan</button></span></div>
    <p class="small plan-status" role="status">${plan.status}</p>
    <p class="sub" style="margin-top:8px">Hoe je nieuwe inleg het best verdeelt, zie je bij de inleg-assistent hieronder; die rekent meteen met wat je hier invult.</p>
  </section>`;
}

// ---------- Inleg-assistent ----------
function InlegTile({ version }) {
  const [amount, setAmount] = useState(plan.amount);
  const pick = (v) => { plan.amount = Math.max(0, Number(v) || 0); setAmount(plan.amount); };
  // Rekent opnieuw bij een ander bedrag of als de doelen veranderen (version)
  const P = useMemo(() => inlegPlan(amount), [amount, version, data]);
  return html`<section class="tile pad full inleg"><h3>Maandelijkse inleg-assistent</h3>
    <div class="plan-amount"><label for="pp-amount">Ik stort</label>
      <span class="stepper big"><button type="button" aria-label="€ 10 minder" onClick=${() => pick(Math.max(0, amount - 10))}>−</button><span class="eur-in">€<input id="pp-amount" type="number" inputmode="decimal" min="0" step="10" value=${amount} onInput=${(e) => pick(e.currentTarget.value)} /></span><button type="button" aria-label="€ 10 meer" onClick=${() => pick(amount + 10)}>+</button></span>
      <${Seg} value=${amount} options=${[[50, '€ 50'], [100, '€ 100'], [250, '€ 250'], [500, '€ 500']]} onPick=${pick} label="Bedrag kiezen" /></div>
    ${P.buys.length
      ? html`<div class="legend-list advice">${P.buys.map((o) => html`<button type="button" class="legend-row rowbtn" data-ticker=${o.c.tk} key=${o.c.tk}>
          <span class="nm"><b>${o.c.tk}</b> <span class="muted small">${o.c.name}</span></span><span class="muted small">${P1.format(o.a / amount)}</span><b>${eur(o.a)}</b></button>`)}</div>`
      : html`<p class="muted">Vul een bedrag in.</p>`}
    <div class="sug-eff" style="margin-top:12px">
      <span dangerouslySetInnerHTML=${{ __html: lvlOf(P.v0) }}></span><span class="arr" aria-hidden="true">→</span><span dangerouslySetInnerHTML=${{ __html: lvlOf(P.v1) }}></span>
      <span class="small">${isNum(P.v0) && isNum(P.v1)
        ? html`beweeglijkheid ${P1.format(P.v0)} → <b class=${P.v1 <= P.v0 + 1e-6 ? 'gain' : 'loss'}>${P1.format(P.v1)}</b> per jaar`
        : 'risico nog niet te berekenen: te weinig koershistorie'}</span></div>
    ${P.hasT
      ? html`<p class="small" style="margin-top:6px">Afstand tot je streefverdeling: ${N1.format(P.d0 * 100)} → <b class="gain">${N1.format(P.d1 * 100)}</b> procentpunt</p>`
      : html`<p class="small muted" style="margin-top:6px">Nog geen streefverdeling: de assistent kiest nu alleen wat het risico het meest verlaagt, met hoogstens 40% van het bedrag per positie.</p>`}
    <p class="sub" style="margin-top:8px">Het bedrag wordt in tien stukjes verdeeld. Elk stukje gaat naar de positie die je het dichtst bij je doelen brengt en het risico het meest verlaagt, gerekend met de koersen van het laatste jaar. Je verkoopt niets. Rekenvoorbeeld, geen beleggingsadvies.</p>
  </section>`;
}

// ---------- Vooruitblik ----------
function ForecastTile() {
  const [, setTick] = useState(0);
  const chartRef = useRef(null), xRef = useRef(null);
  const P = projection();
  const set = (k, v) => { plan[k] = k === 'years' ? Number(v) : v === '' && k === 'goal' ? 0 : Math.max(0, Number(v) || 0); setTick((n) => n + 1); };
  useEffect(() => {
    if (!chartRef.current) return;
    const sets = P.sets.slice().reverse().map((x) => ({ pts: x.pts, color: x.color, width: x.label === 'Gemiddeld' ? 3 : 2, label: x.label }));
    sets.push({ pts: P.dep, color: C.ink2, dash: true, width: 2, label: 'Alleen inleg' });
    const top = Math.max(...P.sets.map((x) => x.end));
    if (P.goal && P.goal <= top * 1.25) sets.push({ pts: P.dep.map((p) => ({ t: p.t, v: P.goal })), color: '#B45309', dash: true, width: 1.5, label: 'Doel' });
    lineChart(chartRef.current, sets, { top: 0.06, bottom: 0.04, xl: xRef.current, xcount: 4, xfmt: (t) => String(new Date(t).getFullYear()), tfmt: (t) => fMonY.format(t) });
  });
  const save = async () => {
    plan.status = 'Bezig met opslaan…'; setTick((n) => n + 1);
    try { await saveSettings({ monthly: P.monthly, goal: P.goal || 0 }); plan.status = 'Inleg en doel opgeslagen.'; }
    catch (err) { plan.status = 'Opslaan is mislukt: ' + err.message + '.'; }
    setTick((n) => n + 1);
  };
  const fY = (t) => new Date(t).getFullYear();
  return html`<section class="tile pad plan-fc"><div class="plan-head"><h3>Vooruitblik</h3>
      <${Seg} value=${P.years} options=${[5, 10, 20, 30].map((y) => [y, y + ' jaar'])} onPick=${(y) => set('years', y)} label="Aantal jaren" /></div>
    <div class="plan-inputs">
      <label>Inleg per maand<span class="stepper big"><button type="button" aria-label="€ 25 minder per maand" onClick=${(e) => { e.preventDefault(); set('monthly', Math.max(0, Math.round(P.monthly) - 25)); }}>−</button><span class="eur-in">€<input type="number" inputmode="decimal" min="0" step="10" value=${Math.round(P.monthly)} onInput=${(e) => set('monthly', e.currentTarget.value)} /></span><button type="button" aria-label="€ 25 meer per maand" onClick=${(e) => { e.preventDefault(); set('monthly', Math.round(P.monthly) + 25); }}>+</button></span></label>
      <label>Doelbedrag (optioneel)<span class="eur-in">€<input type="number" inputmode="decimal" min="0" step="500" value=${P.goal ? Math.round(P.goal) : ''} placeholder="geen" onInput=${(e) => set('goal', e.currentTarget.value)} /></span></label>
      <button type="button" class="btn ghost" onClick=${save}>Bewaren</button></div>
    <div class="chart" ref=${chartRef} style="height:220px"></div><div class="xlabels" ref=${xRef}></div>
    <div class="fc-res">${P.sets.slice().reverse().map((x) => html`<div key=${x.label}><span class="k"><i style=${'background:' + x.color}></i>${x.label} (${P1.format(x.r)} per jaar)</span><b>${eur(x.end)}</b>
        ${P.goal ? html`<span class="sub">${x.reached ? 'doel in ' + fY(x.reached) : 'doel niet binnen 60 jaar'}</span>` : null}</div>`)}
      <div><span class="k"><i class="dash"></i>Alleen inleg</span><b>${eur(P.dep[P.dep.length - 1].v)}</b></div></div>
    <div dangerouslySetInnerHTML=${{ __html: snowballLine(P) }}></div>
    <div dangerouslySetInnerHTML=${{ __html: plxRealToggle() }}></div>
    <p class="sub" style="margin-top:10px">Start: je accountwaarde nu (${eur(P.start)}). ${isNum(M.settings.monthly) || isNum(plan.monthly) ? '' : 'De maandinleg is geschat uit je stortingen van de laatste drie maanden. '}De drie rendementen zijn voorbeelden, geen verwachting: werkelijke rendementen schommelen sterk per jaar en kunnen ook negatief zijn. ${plxRealNote(P)}</p>
  </section>`;
}

// ---------- De hele pagina ----------
function Section({ title, sub, children }) {
  return html`<div class="section-head"><h2>${title}</h2>${sub ? html`<p class="muted small">${sub}</p>` : null}</div><div class="plan-grid">${children}</div>`;
}
const leg = (s) => (s ? html`<${Legacy} markup=${s} />` : null);

function PlanPage({ stamp }) {
  const [version, setVersion] = useState(0);
  const host = useRef(null);
  // Grafieken in de HTML-tegels opnieuw tekenen na elke weergave
  useEffect(() => { const root = host.current && host.current.parentElement; if (root) { drawWhatIf(root); drawWeekShare(root); drawPlanExtra(root); drawPlanExtra2(root); } });
  return html`<div style="display:contents" ref=${host} data-preact="plan">
    <${Section} title="Inleg en doelen" sub="Streefverdeling, wat je met nieuwe inleg koopt en waar je naartoe groeit">
      <${TargetTile} bump=${() => setVersion((n) => n + 1)} /><${InlegTile} version=${version + ':' + stamp} /><${ForecastTile} />${leg(goalsTile())}${leg(depositTile())}${leg(milestoneTile())}
    <//>
    <${Section} title="Wat als" sub="Je portefeuille bij tegenvallers en tegenover de index">${leg(scenarioTile())}${leg(whatIfTile())}<//>
    <${Section} title="Dividend en belasting" sub="Verwacht dividend, box 3 en het jaaroverzicht">${leg(divCalendarTile())}${leg(box3Tile())}${leg(yearTile())}<//>
    <${Section} title="Kosten en aankopen" sub="Wisselkosten, fondskosten en je aankoopdagboek">${leg(costTile())}${leg(terTile())}${leg(journalTile())}<//>
    <${Section} title="Spreiding en rekeningen" sub="Overlap met je fondsen en je andere rekeningen">${leg(overlapTile())}${leg(exposureTile())}${leg(accountsTile())}<//>
    <${Section} title="Delen en exporteren">${leg(weekShareTile())}${leg(exportTile())}<//>
    ${planExtraSections().concat(planExtraSections2()).map((x) => html`<${Section} key=${x.title} title=${x.title} sub=${x.sub}>${x.tiles.map(leg)}<//>`)}
  </div>`;
}

let stampN = 0, lastData = null;
const mounted = new Set();
function clear(host) { if (mounted.has(host)) { render(null, host); mounted.delete(host); } }
function draw(host) {
  if (data !== lastData) { lastData = data; stampN++; }
  [...mounted].forEach((h) => { if (h !== host) clear(h); });
  if (!mounted.has(host)) { host.innerHTML = ''; mounted.add(host); }
  render(html`<${PlanPage} stamp=${stampN} />`, host);
}

window.PlanView = { ok: true, draw, clear };
if (typeof M !== 'undefined' && M) refresh('plan');
