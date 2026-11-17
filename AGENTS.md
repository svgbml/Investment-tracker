# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A personal Trading 212 investment tracker in two parts:

- `worker/` — a Cloudflare Worker with a D1 database. It measures the portfolio on a schedule, stores history, fetches optional external data and serves everything as JSON.
- `docs/` — a static website (GitHub Pages) that renders that JSON. No build step and no CDN libraries; the only library is Preact with htm, vendored in `docs/vendor/`.
- `apps-script/` — the legacy Google Sheets version. Leave it alone unless asked.

The user-facing language is **Dutch**: all UI text, code comments, commit messages and READMEs. Keep it that way. Write plain, neutral Dutch, sentence case, no marketing tone.

## Layout

| Path | Purpose |
|---|---|
| `worker/src/index.js` | The whole Worker: schema, crons, external sources, HTTP API |
| `worker/wrangler.toml` | Crons, D1 binding, public vars |
| `docs/js/00-kern.js` … `15-start.js` | The site, as ordered classic scripts sharing one scope: core helpers, data, charts, pages, demo data, start |
| `docs/js/nieuws-preact.js` | The news page as Preact components (an ES module, loaded last) |
| `docs/vendor/preact-htm.js` | Preact 10 + hooks + htm in one file (MIT), unchanged from npm |
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
- Every external source needs a fallback where one exists. Use `srcFail` / `srcOk` / `srcDown` / `srcBackup` (`kv` `src_health`): on a limit or repeated failures, switch to the backup and record which backup did the work. Never retry a refused source in a loop.
- Write the built data only through `saveDataCache(env, data)` (it stores `data_core`, `data_extra`, their ETags and the share copy). New top-level fields that change rarely belong in `EXTRA_KEYS`.
- Push alerts go through `alertOnce(env, key, msg)` so each alert is sent once; only evaluate them when `pushSubs(env)` is non-empty.
- All `/api/*` routes require the `WEB_TOKEN` (prefer the `Authorization: Bearer` header; `?token=` is only kept for old clients and the Apps Script); only `/cal/<token>.ics`, `/share/<token>` and `POST /api/login` are public. `/share` serves a read-only copy without notes, accounts or keys, with money scaled when amounts are off. `/api/login` returns the `WEB_TOKEN` only when the posted Trading 212 key and secret match the ones in the Worker (constant-time compare, max 10 failures per hour, nothing stored).

## Site conventions

- The site is plain JS split over `docs/js/NN-*.js`. These are **classic scripts, not modules**: they load in the order of the `<script>` tags in `index.html` and share one global scope, so a top-level `const` or `function` in one file is usable in the next. Keep that order; code that runs while a file loads may only use names from the same or earlier files. Every top-level name is global: give new ones distinct names and avoid browser globals (`name`, `status`, `print`, `open`, …).
- Put new code in the file for its topic, or a new numbered file (then add it to `index.html` and `sw.js`). Follow the existing helpers: `eur`, `seur`, `spct`, `kvList`, `stat`, `bars`, `spark`, `lineChart`, `fill`, `clickable`.
- Own helpers in `00-kern.js`: `defineView(name, draw)` registers a part of the page; `renderAll()` draws all views and `refresh('plan')` only that one, and a failing view does not break the rest. `tpl` is a tagged template that escapes inserted values (`raw()` for HTML that is already safe); prefer it over string concatenation with `esc()` in new code.
- Components: new or rebuilt pages may use Preact with htm (`import { html, render, useState } from '../vendor/preact-htm.js'`) in an ES module like `nieuws-preact.js`. A module loads after the classic scripts and may use their globals. Register it on `window` and let the classic code fall back to its HTML version when the module is not there (see `renderNews`). Do not load libraries from a CDN: vendor them so the app keeps working offline.
- Amounts must go through `eur`/`seur` so the "bedragen verbergen" toggle works.
- Colours come from CSS variables (`--surface`, `--ink`, `--accent`, `--gain`, `--loss`, …). Check both themes; dark overrides live under `:root[data-theme="dark"]`.
- Two layouts share the data layer: desktop (`#shell`, `page-*`) and phone (`#mshell`, `m-*`). A new tile needs to appear in both.
- Home-screen tiles fold: `foldAll()` measures and collapses long tiles, `toggleFold()` animates them. Folded tiles in one row share a height, and a chart in a folded tile must stay fully visible (`fitChart`).
- Expandable overviews are pseudo detail pages (`@account`, `@risk`, `@result`, `@deposits`) registered in `PSEUDO`.
- Keep animations, and honour `prefers-reduced-motion` (`reduceMotion()`).
- `makeDemoData()` powers the keyless demo (`?demo`). **Every new feature needs demo data**, otherwise it is invisible to visitors without a key.
- After changing any file in `docs/`, bump the cache version: every `?v=N` in `index.html`, the precache list and `CACHE = 'tracker-vN'` in `sw.js`, and `VERSION` in `js/01-basis.js`. A new file must also be added to the precache list.

## Checking your work

There is no test suite. Before committing:

0. Run `node tools/check-site.mjs` (syntax, duplicate or browser-clashing names, cache version, script list) and `node worker/test/run.mjs` (Worker against mocked APIs and an in-memory SQLite D1). Both run in GitHub Actions; the Pages deploy and the Cloudflare build wait for them. Add a Worker test for every new route, source or fallback.
1. `node --check` every file in `docs/js/` (the module with `--input-type=module` or by importing it) and import `worker/src/index.js` in Node to catch syntax errors. Also check that no top-level name is declared twice across `docs/js/` and none is a property of `window`.
2. Serve `docs/` locally (`python3 -m http.server`) and open `/?demo` at desktop (1360×900) and phone (390×844) size. Check for console errors and look at screenshots of what you changed, in light and dark.
3. For data handling, also try sparse data: no weeks, one position, no optional sources. Tiles should explain what is missing, never show `NaN`, `undefined` or crash.
4. For Worker changes, exercise the handler against mocked `fetch` and an in-memory D1 stand-in rather than live APIs.

## Commits and deploys

- Commit messages in Dutch, one line describing the user-visible change.
- Pushing to `main` deploys both parts: GitHub Pages serves `docs/`, and Cloudflare builds the Worker from `worker/`. Allow about a minute before verifying live.
- Update the feature table in `README.md` and the endpoint list in `worker/README.md` when you add a feature, source or endpoint.
