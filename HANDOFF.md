# SkinStock — handoff summary

## Important: attach the zip in the new chat
A new conversation starts with an empty sandbox — it has no access to files
from this one. **Attach `skinstock.zip` (from this chat's outputs) to your
first message in the new chat**, along with this summary, so Claude can
unzip it and pick up exactly where things left off.

## What this is
A personal skincare price tracker. Add a product, attach one or more
specific websites for it (exact URL + how to read the price off that
page), and it tracks price/stock over time. Runs as a Node/Express backend
+ a plain HTML/CSS/JS PWA frontend (installable to an Android home screen).

## Current deployment (as of this handoff)
- **Code**: pushed to GitHub at `github.com/phantomghost12/skinstock`.
- **Hosting**: deployed on **Render** (free tier), auto-deploys on every
  `git push` to that repo.
- **Data storage**: `data.json` (a plain file, not a real database) — **is
  currently tracked in git on purpose** (the user's choice), meaning it's
  seeded from whatever was last committed. **Before pushing any future
  code change: download a fresh backup from the live site (the in-app
  "Download backup" button), copy that file over the local `data.json`,
  and commit it together with the code change** — otherwise the push will
  reset live data back to the old committed snapshot. This is a known,
  accepted tradeoff, not a bug to fix.
- **Auto-refresh**: a free cron-job.org job hits `POST /api/scrape/run`
  every 12 hours. That endpoint replies immediately and does the actual
  scraping in the background (see "Recent architecture notes" below) —
  this was specifically built to survive cron-job.org's 30-second timeout
  cap regardless of how long scraping N listings actually takes.
- **Keep-alive**: a second free cron-job.org job pings the homepage `/`
  every 10 minutes, to prevent Render's free tier from sleeping after 15
  minutes idle (which otherwise causes a ~45s cold start on the next
  request). Confirm with the user whether this is actually set up yet.
- **Password protection**: built (HTTP Basic Auth via an `APP_PASSWORD`
  env var, checked in `server.js`), but the **user turned it off** — they
  removed the `APP_PASSWORD` variable in Render's dashboard because they
  judged the URL unlikely to be found by anyone else. This was their
  informed choice after being told the tradeoff (no login = anyone with
  the link can view/edit/delete everything).

## Key files
- `server.js` — Express API. Routes: CRUD for products/listings, on-demand
  scrape endpoints, backup/restore, price-history aggregation.
- `scraper.js` — the actual price/stock extraction logic. This is the
  most-iterated file in the whole project (see "Hard-won lessons" below).
- `db.js` — trivial JSON-file read/write, no real database.
- `public/` — the frontend: `index.html`, `app.js`, `styles.css`,
  `site-presets.js` (per-domain selector autofill), `manifest.json`,
  `sw.js` (a **self-destructing** service worker — see notes below).
- `README.md`, `TERMUX.md` — user-facing setup docs (may be slightly
  behind the Render migration; the user primarily runs this on Render now,
  not Termux, though Termux is still how they edit/push code).

## Hard-won lessons in scraper.js (read before touching selector logic)
Getting price/stock extraction reliable took many rounds of real mistakes
on real store data. Don't re-litigate these without re-reading the
reasoning:

1. **Never trust a site-wide `og:price:amount` meta tag for a product with
   size/variant options** — confirmed on multiple real stores that it can
   be frozen on the store's cheapest variant regardless of which page or
   `?variant=` you're actually viewing.
2. **`shopifyvariant:price` / `shopifyvariant:original` /
   `shopifyvariant:available`** are custom selector keywords this project
   invented: they read Shopify's own raw variant JSON directly out of the
   page's `<script>` tags (the same data the site's own "pick a size" UI
   depends on), matched by variant ID from the URL's `?variant=`, or — if
   there's no `?variant=` (single-size product) — the first real variant
   found in the highest-priority block.
3. **The block-collection filter must NOT require a `"variants"` wrapper
   key.** Some themes emit a bare array like
   `[{"id":...,"price":...,"compare_at_price":...}]` with no such key at
   all — an earlier version of this filter required that key and was
   silently discarding the exact correct data because of it. The filter
   now only requires `compare_at_price` or `inventory_management` to be
   present in the script text.
4. **Blocks are prioritized by whether they contain the current product's
   own URL handle** — far more reliable than guessing from a script's
   `id`/`type` attribute, since an unrelated "Popular Products" widget on
   the same page cannot contain this product's exact slug.
5. A real, confirmed-in-production bug: a "Popular Products" widget
   elsewhere on a page can pollute a naive CSS-class guess (e.g.
   `.price__sale .price-item--regular` matched a *different* product's
   strikethrough price first in DOM order). The `shopifyvariant:*` /
   `jsonld:*` methods exist specifically to avoid this class of bug; CSS
   class selectors are the last-resort fallback in the chain, not the
   first choice.
6. **JSON-LD (`jsonld:price`, `jsonld:availability`)** is a solid
   second-choice fallback — reads the page's Schema.org structured data.
   Also variant-matched by ID when the page has one, same reasoning.
7. Per-site selector chains live in `public/site-presets.js`, keyed by
   hostname, each with a `note` explaining confidence level. When a new
   site misbehaves: **ask the user for a raw HTML snippet** (via Chrome's
   `view-source:` + Find-in-page, or by pasting the full page source if
   needed) rather than guessing blind again — multiple rounds of blind
   CSS-class guessing wasted real effort compared to just reading real
   markup once asked for.
8. Stock detection reads an Add-to-Cart-button-style selector and checks
   for phrases like "sold out"/"out of stock" in `OUT_OF_STOCK_PHRASES`.

## Recent architecture notes
- **`POST /api/scrape/run` is fire-and-forget.** It responds immediately
  (`{ ok: true, started: true }` or `{ alreadyRunning: true }`) and runs
  the actual scrape loop in the background via a module-level
  `scrapeState` object. `GET /api/scrape/status` reports
  `{ inProgress, lastStartedAt, lastFinishedAt, lastChecked, lastFailed }`.
  **The in-app "refresh all" button in `app.js` was NOT yet updated to
  poll this status endpoint** — it may still be written assuming the old
  synchronous behavior (awaiting the full scrape before updating the UI).
  Check `el('refreshAllBtn').onclick` in `app.js` and fix if so: it should
  POST to start, then poll `/api/scrape/status` every couple seconds until
  `inProgress` is false, then reload products.
- **`sw.js` is intentionally a self-destructing service worker** (deletes
  all caches, unregisters itself, forces reload) — an earlier caching
  service worker caused real, confusing multi-day bugs where UI fixes
  silently never reached the user's phone. Do not reintroduce app-shell
  caching without a very good reason and a clear invalidation strategy.
- **The "+" floating action button's visibility** is centrally controlled
  by `updateFabVisibility()` in `app.js`, called explicitly at every modal
  open/close point — deliberately NOT via a `MutationObserver` (an earlier
  version used one and a mismatch could silently crash the rest of the
  script, breaking every button on the page).
- **Android back-button handling** uses `history.pushState`/`popstate` —
  see `pushNavState()` and the `popstate` listener in `app.js`. First pass;
  user was told to report specific repro steps if back behaves oddly.
- **Backup/restore** (`GET /api/backup`, `POST /api/restore`, buttons on
  the home screen) exist specifically because of a real data-loss incident
  earlier in this project (an `rm -rf` during a Termux update wiped
  `data.json`). Treat this feature as load-bearing, not optional polish.

## What was just being added when this handoff was written
**A price-history line chart per product** ("lowest price across all its
listings, per day, for the past year"):
- `GET /api/products/:id/price-history` in `server.js` — aggregates the
  existing `data.history` array (already populated by every scrape) into
  one `{date, price}` point per day, taking the minimum price across all
  of that product's listings that day, filtered to the last 365 days.
  **This part is done and should work as-is.**
- `renderPriceChart()` in `app.js` — draws a plain inline SVG line chart
  (no charting library), called from `openDetail()`. Shows a friendly
  placeholder message if there are fewer than 2 data points yet (expected
  for a brand new product/store).
- A `<div id="priceHistoryChart">` section was added to `index.html`
  (in the detail view, after the "Prices" section), and matching CSS
  (`.price-chart`, `.price-chart-svg`) was added to `styles.css`.
- **This was verified syntactically valid** (`node --check` on all JS,
  and both HTML/CSS confirmed to contain the new elements) but **has NOT
  been tested live** by the user yet — no visual confirmation, no check
  that the chart actually renders sensibly with real data, no check of
  how it looks with only 1-2 points, etc. Treat this as the very next
  thing to verify with the user once they're back and can deploy it.

## Suggested first steps in the new chat
1. Confirm the zip was received and unzipped correctly.
2. Walk the user through deploying this exact state to Render (backup →
   copy into `data.json` → commit → push, same as every prior update).
3. Ask the user to open a product with more than one price-check on
   record and confirm the price history chart actually renders and looks
   reasonable.
4. Check whether `refreshAllBtn`'s handler in `app.js` was ever updated to
   poll `/api/scrape/status` (see "Recent architecture notes" above) — if
   not, that's a real loose end worth closing, since right now tapping
   that button in-app may not reflect the new fire-and-forget behavior
   correctly (e.g., it might reload the product list before scraping has
   actually finished).
5. Ask if the two cron-job.org jobs (12-hourly scrape, 10-minute
   keep-alive) are both confirmed working after the most recent deploy.

## User's general working style, worth knowing
- Uses Termux on Android exclusively — no PC. Comfortable with copy-paste
  terminal commands but appreciates exact, complete commands rather than
  fragments.
- Prefers real, verified answers over plausible-sounding guesses —
  multiple rounds of this project's history involved Claude guessing a
  CSS selector wrong, and the user (correctly) pushing back each time
  asking for the guess to be replaced with something actually checked
  against real page source.
- Is fine with "your call" framing when a tradeoff is presented clearly
  (e.g., they made an informed choice to keep `data.json` in git despite
  the rollback risk, and to turn off password protection).
