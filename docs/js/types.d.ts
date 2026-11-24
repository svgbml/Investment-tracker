// Types van de website, voor de typecontrole zonder build-stap (tools/check-types.mjs, tsconfig.json).
// Dit bestand wordt nooit naar de browser gestuurd: TypeScript leest het alleen bij het controleren.
//
// Twee soorten afspraken staan hier:
//  1. De gegevens van de Worker (`data`), het afgeleide model (`M`), onderzoek en instellingen.
//     Zo staat op één plek wat een tegel mag verwachten. De vorm volgt buildData() in worker/src/index.js
//     en derive() in docs/js/03-model.js.
//  2. Een paar aanvullingen op de browsertypen voor dingen die de site overal doet en die de standaardtypen
//     te krap zien (e.target.closest in een klikluisteraar bijvoorbeeld).
//
// Let op: TrackerData en Model houden bewust een open indexsignatuur (`[k: string]: any`). Er komen regelmatig
// velden bij; met een gesloten type zou elk nieuw veld de typecontrole laten falen voordat het hier staat.
// De velden die hier wél staan zijn daarmee documentatie en hulp bij het schrijven, geen harde grens.

// ---------- Gegevens van de Worker (/api/data) ----------

/** Een tabel zoals de Worker die stuurt: kolomnamen plus rijen met waarden. */
interface TrackerTable {
  columns?: any[];
  rows?: any[][];
}

/** Eén positie uit de laatste meting. */
interface TrackerPosition {
  ticker?: string;
  name?: string;
  value?: number;
  unrealized?: number;
  cost?: number;
  resultPct?: number;
  quantity?: number;
  price?: number;
}

/** Eén regel "vandaag" per positie (en TOTAAL): open, laagste, hoogste en de stand nu. */
interface TrackerToday {
  ticker?: string;
  name?: string;
  current?: number;
  open?: number;
  low?: number;
  high?: number;
  avg?: number;
  change?: number;
  changePct?: number;
  allTimeHigh?: number;
  allTimeLow?: number;
  avgRange?: number;
  avgRangePct?: number;
  days?: number;
}

/** Eén weekmeting (maandagstand). */
interface TrackerWeek {
  date?: string;
  accountValue?: number;
  netDeposits?: number;
  cash?: number;
  costBasis?: number;
  investmentsValue?: number;
  unrealized?: number;
  totalResult?: number;
  totalResultPct?: number;
  weekChange?: number;
  newDeposits?: number;
  weekResult?: number;
  weekResultPct?: number;
  source?: string;
  /** Door derive() toegevoegd: de datum als getal. */
  t?: number;
}

/** Dividenden, kwartaalcijfers en andere gebeurtenissen. */
interface TrackerEvents {
  updated?: string;
  fmp?: boolean;
  errors?: string[];
  received?: Array<{ ticker?: string; date?: string; amount?: number; perShare?: number; qty?: number; [k: string]: any }>;
  earnings?: Array<{ ticker?: string; symbol?: string; date?: string; epsEst?: number; revEst?: number; src?: string; [k: string]: any }>;
  dividends?: Array<{ ticker?: string; date?: string; amount?: number; perShare?: number; declared?: string; exDate?: string; frequency?: string; [k: string]: any }>;
  lastEarnings?: Array<{ ticker?: string; date?: string; eps?: number; epsEst?: number; [k: string]: any }>;
  [k: string]: any;
}

/** Onderzoek per aandeel: nieuws, analisten, insiders en cijfers (Finnhub, Alpha Vantage of FMP). */
interface ResearchItem {
  symbol?: string;
  updated?: string;
  /** Welke bron welk onderdeel leverde, bijvoorbeeld { rec: 'av' }. */
  src?: { [part: string]: string };
  /** Onderdelen die de bron weigert (403); die worden niet opnieuw gevraagd. */
  denied?: string[];
  news?: Array<{ t?: number; headline?: string; source?: string; url?: string; [k: string]: any }>;
  rec?: Array<{ period?: string; sb?: number; b?: number; h?: number; s?: number; ss?: number; [k: string]: any }>;
  eps?: Array<{ period?: string; actual?: number; estimate?: number; pct?: number; [k: string]: any }>;
  insider?: Array<{ name?: string; date?: string; code?: string; change?: number; price?: number; shares?: number; [k: string]: any }>;
  target?: { mean?: number; median?: number; high?: number; low?: number; updated?: string; [k: string]: any } | null;
  targetHist?: Array<{ d?: string; mean?: number; [k: string]: any }>;
  sent?: { bull?: number; bear?: number; score?: number; sector?: number; articles?: number; buzz?: number; [k: string]: any } | null;
  profile?: { [k: string]: any };
  [k: string]: any;
}

/** Instellingen die de site in de Worker bewaart. */
interface TrackerSettings {
  watchlist?: any[];
  targets?: { [ticker: string]: any };
  targetMode?: string;
  goal?: number;
  goals?: Array<{ id?: string; name?: string; target?: number; share?: number; date?: string; [k: string]: any }>;
  years?: number;
  monthly?: number;
  benchmark?: string;
  notes?: { [key: string]: any };
  accounts?: Array<{ id?: string; name?: string; broker?: string; cash?: number; updated?: string; holdings?: Array<{ name?: string; value?: number; [k: string]: any }>; [k: string]: any }>;
  alerts?: { move?: number; earnings?: boolean; insider?: boolean; drift?: number; [k: string]: any };
  priceAlerts?: Array<{ id?: string; sym?: string; op?: string; price?: number; on?: boolean; hit?: string; hitPrice?: number; [k: string]: any }>;
  tradeLimits?: { [k: string]: any };
  depositReminder?: { [k: string]: any };
  mailAmounts?: boolean;
  /** Vrije voorkeuren van de site (volglijstlabels, nieuwsfilters, FIRE-kosten, box 3 …). */
  prefs?: { [k: string]: any };
  [k: string]: any;
}

/** Alles wat /api/data stuurt (core + extra + series samen). */
interface TrackerData {
  ok?: boolean;
  generated?: string;
  currency?: string;
  part?: string;
  weeks?: any[];
  positions?: any[];
  positionsDate?: string;
  today?: any[];
  cashNow?: { cash?: number; at?: string; [k: string]: any } | null;
  /** Per ticker: aankoopkoers en wisselkoers in eigen munt (zie de velden fx, avg, price, cur, since, cost). */
  posExtra?: { [ticker: string]: any };
  peil?: Array<{ date?: string; total?: number; investments?: number; cash?: number; [k: string]: any }>;
  orders?: TrackerTable;
  intraday?: TrackerTable;
  hours?: TrackerTable;
  days?: TrackerTable;
  events?: TrackerEvents | null;
  market?: { [k: string]: any } | null;
  research?: { [ticker: string]: any };
  fin?: { [ticker: string]: any };
  etf?: { [k: string]: any };
  fx?: { rates?: any; [k: string]: any } | null;
  hicp?: { [k: string]: any } | null;
  idx?: { [k: string]: any } | null;
  ext2?: { [k: string]: any };
  marketNews?: { [k: string]: any } | null;
  features?: { flags?: { [k: string]: any }; has?: { [k: string]: boolean }; [k: string]: any };
  settings?: any;
  shared?: { amounts?: boolean };
  [k: string]: any;
}

// ---------- Contract met de Worker (idee 61) ----------
// Wat de Worker altijd stuurt, ook met alleen Trading 212. De Worker-test (worker/test/run.mjs) schrijft de echte
// uitvoer van /api/data weg en laat TypeScript die tegen deze typen controleren: een veld dat verdwijnt, een andere
// naam krijgt of van soort verandert, laat de test falen. Nieuwe velden mogen erbij (open index); zet ze hier
// zodra ze vast zijn. Kolomnamen van de tabellen staan vast, zodat de site ze op positie kan lezen.

type ContractOpen = { [k: string]: unknown };

interface ContractWeek {
  date: string; accountValue: number; netDeposits: number; cash: number; costBasis: number;
  investmentsValue: number; unrealized: number; totalResult: number; totalResultPct: number;
  weekChange: number | null; newDeposits: number | null; weekResult: number | null; weekResultPct: number | null;
  source: string;
}
interface ContractPosition {
  ticker: string; name: string; value: number; unrealized: number; cost: number; quantity: number;
  /** Alleen bij een meting, niet bij de terugval op de laatste weekstand. */
  resultPct?: number; price?: number;
}
interface ContractToday {
  ticker: string; name: string; current: number; open: number; low: number; high: number; avg: number;
  change: number; changePct: number;
}

/** /api/data?part=core */
interface ContractCore {
  ok: true; part: 'core'; generated: string; currency: 'EUR';
  weeks: ContractWeek[];
  positions: ContractPosition[];
  positionsDate: string | null;
  today: ContractToday[];
  cashNow: { cash: number; at: string; [k: string]: unknown } | null;
  posExtra: { [ticker: string]: ContractOpen };
  settings: ContractOpen;
  features: { flags: { [k: string]: boolean }; has: { [k: string]: boolean } };
  newsFlash: unknown[];
  [k: string]: unknown;
}

/** /api/data?part=extra (alles in EXTRA_KEYS in de Worker) */
interface ContractExtra {
  ok: true; part: 'extra';
  events: TrackerEvents | null;
  market: ContractOpen | null;
  orders: {
    columns: ['time', 'ticker', 'name', 'side', 'qty', 'price', 'currency', 'fxRate', 'net', 'realised', 'feeFx', 'feeOther', 'kind'];
    rows: Array<[string, string, string | null, string, number, number, string, number | null, number, number | null, number | null, number | null, string | null]>;
  };
  peil: Array<{ date: string; total: number; investments: number; cash: number; [k: string]: unknown }>;
  etf: ContractOpen;
  research: { [ticker: string]: ContractOpen };
  fin: { [ticker: string]: ContractOpen };
  fx: ContractOpen | null;
  hicp: ContractOpen | null;
  idx: ContractOpen | null;
  ext2: ContractOpen;
  marketNews: ContractOpen | null;
  [k: string]: unknown;
}

/** /api/data?part=series, volledig (met kolomnamen) of als aanvulling (delta, since, zonder kolomnamen) */
interface ContractSeries {
  ok: true; part: 'series'; seriesTs: number;
  delta?: true; since?: number;
  intraday: { columns?: ['time', 'ticker', 'value', 'qty']; rows: Array<[string, string, number, number | null]> };
  hours: { columns?: ['hour', 'ticker', 'open', 'close', 'low', 'high', 'avg']; rows: Array<[string, string, number, number, number, number, number]> };
  days: { columns?: ['date', 'ticker', 'open', 'close', 'low', 'high', 'avg', 'range', 'rangePct']; rows: Array<[string, string, number, number, number, number, number, number, number]> };
}

// ---------- Afgeleid model (derive() in 03-model.js) ----------

/** Eén bedrijf in het model: waarde, dagverandering, kostprijs en gewicht. */
interface ModelCompany {
  tk?: string;
  name?: string;
  value?: number;
  change?: number;
  changePct?: number;
  open?: number;
  low?: number;
  high?: number;
  avg?: number;
  avgRange?: number;
  avgRangePct?: number;
  cost?: number;
  unreal?: number;
  qty?: number;
  resultPct?: number;
  weight?: number;
  fx?: number;
  avgNative?: number;
  priceNative?: number;
  cur?: string;
  since?: number;
  base?: { kind: string; t?: number; [k: string]: any };
  [k: string]: any;
}

/** Het model dat de tegels gebruiken: afgeleid uit `data`, nooit zelf opgeslagen. */
interface Model {
  companies?: any[];
  byTk?: Map<string, any>;
  tot?: any;
  totalValue?: number;
  accountNow?: number;
  cash?: number | null;
  cashAt?: number | null;
  weeks?: any[];
  lastWeek?: any;
  lastT?: number | null;
  isToday?: boolean;
  dayWord?: string;
  intraDays?: number;
  since?: number | null;
  canImport?: boolean;
  bench?: any;
  settings?: TrackerSettings;
  /** Reeksen per ticker, uit data.intraday/hours/days. */
  intra?: Map<string, any[]>;
  hours?: Map<string, any[]>;
  days?: Map<string, any[]>;
  series?: Map<string, any>;
  ev?: { received?: any[]; earnings?: any[]; dividends?: any[]; [k: string]: any };
  tx?: { trades?: any[]; [k: string]: any };
  mk?: { ok?: boolean; [k: string]: any };
  [k: string]: any;
}

// ---------- Aanvullingen op de browsertypen ----------

// Namen die de site van buiten krijgt (config.js, Preact-modules)
interface Window { TRACKER_CONFIG?: any; PlanView?: any; NewsView?: any; GalleryView?: any; __snapRead?: Promise<any>; }
// Safari op iPhone: of de site als app op het beginscherm draait
interface Navigator { standalone?: boolean; }
// In een klik- of wijzigluisteraar is e.target in deze site altijd een element; de standaardtypen weten dat niet.
interface EventTarget {
  closest?(selector: string): HTMLElement | null;
  matches?(selector: string): boolean;
  dataset?: DOMStringMap;
  tagName?: string;
  value?: any;
  checked?: boolean;
  files?: any;
}
