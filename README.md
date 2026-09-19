# SkinStock

Track specific skincare products across the specific websites you trust, and
check their prices — including sale/discounted prices — on demand, with one
tap, running entirely on your own phone.

## What this is, honestly

This is a **PWA** (Progressive Web App) — a real web app you install on your
Android home screen so it opens full-screen with its own icon, like a native
app. It is not a `.apk`; producing a real compiled, signed Android package
needs the Android SDK/Gradle toolchain and a live internet connection, which
isn't available in the environment I built this in. This gets you the same
day-to-day result — icon on your home screen, opens full-screen — without
that step.

**Refreshing is on-demand, not scheduled.** There's no 12-hour timer by
default anymore — you tap a refresh button (either for one product, or "check
everything") and it scrapes right then. See `server.js` if you ever want a
background schedule back (it's a one-line env var away).

**Runs entirely on your phone, no PC needed** — see `TERMUX.md` for the exact
steps. Node runs inside Termux (a terminal app) on your phone itself; Chrome
on the same phone talks to it at `localhost:3000`. The reason it can't be
"just JavaScript in the browser" with no server at all is CORS: browsers
block a web page from directly fetching other companies' websites, by
design, for security. Something has to do the actual fetching outside the
browser's restrictions — Termux-on-your-phone is that "something," and it
costs you nothing and needs no separate hosting account.

I wrote and syntax-checked every file, but couldn't run a live network test
from where I built this (no internet access in my sandbox) — so test it
before you rely on it, and tell me what breaks.

## 1. Get it running

**No PC, on your phone only:** follow `TERMUX.md`, start to finish.

**If you do get access to a PC later:** same steps work there too —
`npm install` then `npm start` (or `node server.js`), open
`http://localhost:3000`.

## 2. Speed / concurrency for checking many products at once

`server.js` checks up to 5 listings at the same time by default (raise or
lower this with `SCRAPE_CONCURRENCY=8 node server.js`). Roughly:

| Listings | ~time at concurrency 5 | ~time at concurrency 1 (old behavior) |
|---|---|---|
| 10 | ~5–10s | ~25–35s |
| 100 | ~1–2 min | ~5–7 min |

Real numbers depend on your phone's connection and how fast each site
responds. Push concurrency too high and a site is more likely to notice a
burst of requests and briefly block you — 5 is a reasonable middle ground.

## 3. If you later want it always-on and off your phone

Deploying it to a free host like Render or Railway is still an option if
you'd rather not keep Termux running — say the word and I'll walk you
through it, or turn the schedule back on with `SCHEDULE_CRON`.

## 4. How adding a product + website works

1. Tap **+** → enter the product name, pick/create a category (Toner,
   Moisturizer, Sunscreen, etc. — these are just labels you type, so name
   them however you like), optionally a picture URL and a note.
2. On the product's page, tap **+ Add a website** → paste the exact product
   page URL, name the site, and give it a **CSS selector** for the price —
   this is how the app knows *which piece of text on the page* is the
   price. There's a second, optional selector for the original/"was" price,
   for sites that show a strikethrough price during a sale — fill that in
   too and the app will show "was Rs. X · Y% off" whenever it finds one.

### Finding the CSS selector (the fiddly-sounding part, made easy)

On the product page, right-click (or long-press) the price → **Inspect**.
The highlighted line of code is the price element. If it has something like
`class="price-value"`, your selector is `.price-value`. If it has
`id="price"`, your selector is `#price`. Paste that into the selector field
and hit **Test** — it'll show you exactly what it found before you save
anything, so you're never guessing blind. Same process for the "was" price
selector, if the site has one.

Every product can have as many or as few websites as actually carry it —
one, five, none yet. The home screen always shows the lowest price found
across whichever sites you've attached. Give me your real list of sites and
I'll pre-fill known-good selectors for each so you skip this step entirely.

## 5. Data storage

Everything lives in a single `data.json` file next to the server — no
database setup needed. Back it up occasionally (it's one small file) since
it's the only copy of your product list and price history.

## What I'd extend first

- **Push notifications on price drop** — the highest-value addition. I can
  wire up web push so your phone buzzes when a tracked product's lowest
  price drops below its previous lowest.
- **Auto-detect the selector** — instead of you finding the CSS selector by
  hand, try a few common price-container patterns automatically and fall
  back to asking you only when none work.
- **Multiple currencies** — right now everything's shown as a plain number
  ("Rs.") since you said your own sites; easy to make this configurable per
  listing if some sites show USD.
- **Price history chart** — the data's already being saved every 12 hours
  (see `/api/listings/:id/history`); a small line chart on the detail page
  is a natural next step.
- **A "site down / selector broke" badge** on the home screen, so a listing
  that's been failing to scrape doesn't quietly go stale without you
  noticing.

Tell me which of these you want first and I'll build it directly into these
files.
