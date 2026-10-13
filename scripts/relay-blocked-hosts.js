// scripts/relay-blocked-hosts.js
//
// Run this on a machine whose IP ISN'T blocked by the site in question
// (your phone over Termux, your home PC, etc) — not on Render. It:
//   1. Asks the live app (BASE_URL) for your current product/listing list.
//   2. Scrapes only the listings whose hostname is in LOCAL_HOSTS, using
//      this machine's own real network connection.
//   3. Reports those results back to the live app, which saves them
//      exactly as if it had scraped them itself.
//
// This doesn't try to get past any site's bot protection — it just makes
// the request from a different, unblocked connection, the same as if you
// opened the page yourself from this device.
//
// ---- Setup (one time) ----
//   This script lives inside the skinstock project and reuses its
//   scraper.js, so it needs the project's dependencies installed — if
//   you've already run `npm install` here (per TERMUX.md / README.md),
//   nothing extra is needed.
//
// ---- Configuration (environment variables) ----
//   BASE_URL      Required. Your live app's URL, e.g.
//                 https://skinstock-xxxx.onrender.com
//   APP_PASSWORD  Required if you've set APP_PASSWORD on the server.
//                 Must match it exactly.
//   LOCAL_HOSTS   Optional. Comma-separated hostnames to handle here
//                 instead of letting the server try. Defaults to
//                 "kmbelle.com".
//
// ---- Run it ----
//   BASE_URL="https://your-app.onrender.com" APP_PASSWORD="yourpassword" \
//     node scripts/relay-blocked-hosts.js
//
// ---- Running it automatically, with Termux closed ----
//   See TERMUX.md section 7 for the full walkthrough. Short version: this
//   uses Android's own job scheduler (`termux-job-scheduler`), so once
//   it's set up you never need to open Termux or the app for this to run
//   — Android wakes it on a timer by itself. It does not need the
//   SkinStock server itself running locally; it only talks to your live
//   app over the network.

const { scrapeListing } = require('../scraper');

const BASE_URL = process.env.BASE_URL;
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const LOCAL_HOSTS = (process.env.LOCAL_HOSTS || 'kmbelle.com')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function authHeaders() {
  if (!APP_PASSWORD) return {};
  const token = Buffer.from(`relay:${APP_PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

// Render's free tier spins the app down when idle, so the first request
// after a while can take a good 30-60+ seconds to respond while it wakes
// back up — that's normal and this waits it out. 120s is just a ceiling
// so a genuine network problem doesn't hang forever instead of failing.
async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${url} (Render may be slow to wake up, or may be down).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

async function main() {
  if (!BASE_URL) {
    console.error('Set BASE_URL to your live app\'s URL. See the comment at the top of this file.');
    process.exit(1);
  }

  console.log(`Fetching current listings from ${BASE_URL} (Render may take a bit to wake up)...`);
  const productsRes = await fetchWithTimeout(`${BASE_URL}/api/products`, { headers: authHeaders() });
  if (!productsRes.ok) {
    console.error(`Could not fetch products: HTTP ${productsRes.status} ${await productsRes.text()}`);
    process.exit(1);
  }
  const products = await productsRes.json();

  const targetListings = [];
  for (const p of products) {
    for (const l of p.listings || []) {
      if (LOCAL_HOSTS.includes(hostnameOf(l.url))) targetListings.push(l);
    }
  }

  if (targetListings.length === 0) {
    console.log(`No listings matched LOCAL_HOSTS (${LOCAL_HOSTS.join(', ')}). Nothing to do.`);
    return;
  }

  console.log(`Scraping ${targetListings.length} listing(s) from this machine's own connection...`);
  const results = [];
  for (const l of targetListings) {
    try {
      const result = await scrapeListing(l.url, l.css_selector, l.original_selector, l.stock_selector);
      results.push({
        listing_id: l.id,
        ok: result.ok,
        price: result.price,
        originalPrice: result.originalPrice,
        inStock: result.inStock,
        error: result.error,
      });
      console.log(`  ${result.ok ? 'OK' : 'FAILED'} — ${l.website_name}: ${result.ok ? result.price : result.error}`);
    } catch (err) {
      results.push({ listing_id: l.id, ok: false, error: err.message });
      console.log(`  FAILED — ${l.website_name}: ${err.message}`);
    }
  }

  console.log('Reporting results back to the live app...');
  const reportRes = await fetchWithTimeout(`${BASE_URL}/api/scrape/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ results }),
  });
  const reportBody = await reportRes.json();
  if (!reportRes.ok) {
    console.error(`Report failed: HTTP ${reportRes.status}`, reportBody);
    process.exit(1);
  }
  console.log(`Done — ${reportBody.applied_count} listing(s) updated.`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
