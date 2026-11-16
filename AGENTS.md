# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A personal Trading 212 investment tracker in two parts:

- `worker/` — a Cloudflare Worker with a D1 database. It measures the portfolio on a schedule, stores history, fetches optional external data and serves everything as JSON.
- `docs/` — a static website (GitHub Pages) that renders that JSON. No build step, no frameworks, no external libraries.
- `apps-script/` — the legacy Google Sheets version. Leave it alone unless asked.

The user-facing language is **Dutch**: all UI text, code comments, commit messages and READMEs. Keep it that way. Write plain, neutral Dutch, sentence case, no marketing tone.

## Layout

| Path | Purpose |
|---|---|
| `worker/src/index.js` | The whole Worker: schema, crons, external sources, HTTP API |
| `worker/wrangler.toml` | Crons, D1 binding, public vars |
| `docs/app.js` | The whole site: deriving data, rendering, charts, routing |
| `docs/index.html`, `docs/style.css` | Markup and styles (light and dark theme) |
| `docs/sw.js`, `docs/manifest.webmanifest` | PWA: offline cache and install |
| `README.md`, `worker/README.md` | Install guide, feature and source table, endpoints |

## Hard rules

- **No secrets or personal data in the repo.** It is public. API keys, tokens, the SEC contact address and portfolio figures live in Cloudflare secrets or the Worker's `kv` table, never in code, fixtures or commits.
- **Never type keys, tokens or passwords for the user**, in the site or in any dashboard. The user enters them.
- **Respect data sources.** Do not spoof a browser User-Agent, do not work around a refusal (403, 520, robots.txt), do not scrape sources that disallow it. If a source refuses the Worker, report it and offer the official route (an API key or a manual upload).
- **The base must work with Trading 212 alone.** Every other source is optional and must fail soft: a missing key or failed fetch hides or explains a tile, it never breaks the page.
- **Not investment advice.** Risk suggestions and alternatives are worked examples. Keep the existing disclaimers when touching those texts.

## Worker conventions

- Free plan: at most **50 subrequests per invocation**. `marketStep` does one queued task batch per call (max 30 external calls). Queue new work in `planMarket`; do not fetch in loops inside a request.
- Keys: `withKeys(env)` merges Cloudflare secrets with keys saved through the site (`kv` key `keys`). Cloudflare secrets win. New key names go in `KEY_NAMES`.
- A new Cloudflare secret only becomes active after the next Git build; keys saved through the site work immediately.
- Schema changes go in the embedded `SCHEMA_SQL` (`ensureSchema` applies it). Use `CREATE … IF NOT EXISTS`.
- FMP has a daily budget (counter in `kv` `fmp_calls`). Keep previous data when a fetch fails.
- Record source failures with `noteExtError(env, source, msg)`; the site shows them under *Koppelingen*.
- All `/api/*` routes require the `WEB_TOKEN`; only `/cal/<token>.ics` and `POST /api/login` are public. `/api/login` returns the `WEB_TOKEN` only when the posted Trading 212 key and secret match the ones in the Worker (constant-time compare, max 10 failures per hour, nothing stored).

## Site conventions

- Everything is plain JS in one IIFE in `docs/app.js`. Follow the existing helpers: `eur`, `seur`, `spct`, `kvList`, `stat`, `bars`, `spark`, `lineChart`, `fill`, `clickable`.
- Amounts must go through `eur`/`seur` so the "bedragen verbergen" toggle works.
- Colours come from CSS variables (`--surface`, `--ink`, `--accent`, `--gain`, `--loss`, …). Check both themes; dark overrides live under `:root[data-theme="dark"]`.
- Two layouts share the data layer: desktop (`#shell`, `page-*`) and phone (`#mshell`, `m-*`). A new tile needs to appear in both.
- Home-screen tiles fold: `foldAll()` measures and collapses long tiles, `toggleFold()` animates them. Folded tiles in one row share a height, and a chart in a folded tile must stay fully visible (`fitChart`).
- Expandable overviews are pseudo detail pages (`@account`, `@risk`, `@result`, `@deposits`) registered in `PSEUDO`.
- Keep animations, and honour `prefers-reduced-motion` (`reduceMotion()`).
- `makeDemoData()` powers the keyless demo (`?demo`). **Every new feature needs demo data**, otherwise it is invisible to visitors without a key.
- After changing any file in `docs/`, bump the cache version in three places: `?v=N` in `index.html`, the precache list in `sw.js`, and `CACHE = 'tracker-vN'`.

## Checking your work

There is no test suite. Before committing:

1. `node --check docs/app.js` and import `worker/src/index.js` in Node to catch syntax errors.
2. Serve `docs/` locally (`python3 -m http.server`) and open `/?demo` at desktop (1360×900) and phone (390×844) size. Check for console errors and look at screenshots of what you changed, in light and dark.
3. For data handling, also try sparse data: no weeks, one position, no optional sources. Tiles should explain what is missing, never show `NaN`, `undefined` or crash.
4. For Worker changes, exercise the handler against mocked `fetch` and an in-memory D1 stand-in rather than live APIs.

## Commits and deploys

- Commit messages in Dutch, one line describing the user-visible change.
- Pushing to `main` deploys both parts: GitHub Pages serves `docs/`, and Cloudflare builds the Worker from `worker/`. Allow about a minute before verifying live.
- Update the feature table in `README.md` and the endpoint list in `worker/README.md` when you add a feature, source or endpoint.
