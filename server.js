// server.js
// The whole backend: a small REST API. Scraping only happens when you ask
// for it (the refresh buttons) — no background schedule by default, since
// this is meant to run on your own phone via Termux, on demand.
//
// Want it back on a timer instead (e.g. because you deployed it somewhere
// always-on)? Set SCHEDULE_CRON, e.g:  SCHEDULE_CRON="0 0,12 * * *"

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const db = require('./db');
const { scrapeListing, runWithConcurrency } = require('./scraper');

const app = express();
app.use(cors());
app.use(express.json());

// Never let the browser cache the service worker file itself — otherwise
// a fix to it (like this one) could get stuck the same way the old
// caching bug did. This forces every page load to check for a fresh copy.
// (Must be registered BEFORE express.static, which would otherwise serve
// this same file first with default, cacheable headers.)
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY || 5);

// ---------- helpers ----------

// Lowest price among listings that are IN STOCK (or unknown stock status —
// we only exclude ones we've positively confirmed are sold out).
function lowestInStockPrice(listings) {
  const prices = listings
    .filter((l) => l.in_stock !== false)
    .map((l) => l.current_price)
    .filter((p) => typeof p === 'number');
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

function productWithListings(data, product) {
  const listings = data.listings.filter((l) => l.product_id === product.id);
  const inStockCount = listings.filter((l) => l.in_stock !== false).length;
  return {
    ...product,
    listings,
    lowest_price: lowestInStockPrice(listings),
    site_count: listings.length,
    in_stock_count: inStockCount,
    all_out_of_stock: listings.length > 0 && inStockCount === 0,
  };
}

async function checkOneListing(data, listing) {
  try {
    const result = await scrapeListing(
      listing.url,
      listing.css_selector,
      listing.original_selector,
      listing.stock_selector
    );
    listing.last_checked = new Date().toISOString();
    if (result.ok) {
      listing.current_price = result.price;
      listing.original_price = result.originalPrice;
      listing.in_stock = result.inStock === null ? true : result.inStock; // unknown -> assume in stock
      listing.last_error = null;
      data.history.push({
        id: db.nextId(data),
        listing_id: listing.id,
        price: result.price,
        checked_at: listing.last_checked,
      });
    } else {
      listing.last_error = result.error;
    }
    return { listing_id: listing.id, ...result };
  } catch (err) {
    listing.last_checked = new Date().toISOString();
    listing.last_error = err.message;
    return { listing_id: listing.id, ok: false, error: err.message };
  }
}

// ---------- products ----------

app.get('/api/products', (req, res) => {
  const data = db.load();
  let products = data.products.map((p) => productWithListings(data, p));
  if (req.query.category) {
    products = products.filter((p) => p.category === req.query.category);
  }
  res.json(products);
});

app.get('/api/categories', (req, res) => {
  const data = db.load();
  const cats = [...new Set(data.products.map((p) => p.category).filter(Boolean))];
  res.json(cats);
});

app.get('/api/products/:id', (req, res) => {
  const data = db.load();
  const product = data.products.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(productWithListings(data, product));
});

app.post('/api/products', (req, res) => {
  const { name, category, image_url, note } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'A product name is required.' });
  }
  const data = db.load();
  const product = {
    id: db.nextId(data),
    name: name.trim(),
    category: (category || '').trim() || 'Uncategorized',
    image_url: image_url || '',
    note: note || '',
    created_at: new Date().toISOString(),
  };
  data.products.push(product);
  db.save(data);
  res.status(201).json(productWithListings(data, product));
});

app.put('/api/products/:id', (req, res) => {
  const data = db.load();
  const product = data.products.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const { name, category, image_url, note } = req.body;
  if (name !== undefined) product.name = name;
  if (category !== undefined) product.category = category || 'Uncategorized';
  if (image_url !== undefined) product.image_url = image_url;
  if (note !== undefined) product.note = note;

  db.save(data);
  res.json(productWithListings(data, product));
});

app.delete('/api/products/:id', (req, res) => {
  const data = db.load();
  const id = Number(req.params.id);
  data.products = data.products.filter((p) => p.id !== id);
  data.listings = data.listings.filter((l) => l.product_id !== id);
  db.save(data);
  res.json({ ok: true });
});

app.post('/api/products/:id/scrape', async (req, res) => {
  const data = db.load();
  const product = data.products.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const listings = data.listings.filter((l) => l.product_id === product.id);
  const results = await runWithConcurrency(listings, CONCURRENCY, (l) => checkOneListing(data, l));
  db.save(data);
  res.json({ checked: results.length, results });
});

// ---------- listings ----------

app.post('/api/products/:id/listings', async (req, res) => {
  const data = db.load();
  const product = data.products.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const { website_name, url, css_selector, original_selector, stock_selector } = req.body;
  if (!website_name || !url || !css_selector) {
    return res.status(400).json({
      error: 'website_name, url, and css_selector are all required.',
    });
  }

  const listing = {
    id: db.nextId(data),
    product_id: product.id,
    website_name,
    url,
    css_selector,
    original_selector: original_selector || null,
    stock_selector: stock_selector || null,
    current_price: null,
    original_price: null,
    in_stock: true, // assume true until we check
    last_checked: null,
    last_error: null,
  };
  data.listings.push(listing);
  db.save(data);

  const fresh = db.load();
  const l = fresh.listings.find((x) => x.id === listing.id);
  await checkOneListing(fresh, l);
  db.save(fresh);
  res.status(201).json(l);
});

app.delete('/api/listings/:id', (req, res) => {
  const data = db.load();
  const id = Number(req.params.id);
  data.listings = data.listings.filter((l) => l.id !== id);
  db.save(data);
  res.json({ ok: true });
});

// Update a listing's site/URL/selectors WITHOUT deleting it — this is
// what lets an existing listing pick up an improved selector later,
// instead of needing to be removed and re-added from scratch.
app.put('/api/listings/:id', async (req, res) => {
  const data = db.load();
  const listing = data.listings.find((l) => l.id === Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const { website_name, url, css_selector, original_selector, stock_selector } = req.body;
  if (!website_name || !url || !css_selector) {
    return res.status(400).json({ error: 'website_name, url, and css_selector are all required.' });
  }
  listing.website_name = website_name;
  listing.url = url;
  listing.css_selector = css_selector;
  listing.original_selector = original_selector || null;
  listing.stock_selector = stock_selector || null;
  db.save(data);

  const fresh = db.load();
  const l = fresh.listings.find((x) => x.id === listing.id);
  await checkOneListing(fresh, l);
  db.save(fresh);
  res.json(l);
});

app.post('/api/scrape/test', async (req, res) => {
  const { url, css_selector, original_selector, stock_selector } = req.body;
  if (!url || !css_selector) {
    return res.status(400).json({ error: 'url and css_selector are required.' });
  }
  try {
    const result = await scrapeListing(url, css_selector, original_selector, stock_selector);
    res.json(result);
  } catch (err) {
    res.json({ ok: false, error: err.message, rawText: null, price: null, originalPrice: null, inStock: null });
  }
});

app.post('/api/scrape/run', async (req, res) => {
  const data = db.load();
  const started = Date.now();
  const results = await runWithConcurrency(data.listings, CONCURRENCY, (l) => checkOneListing(data, l));
  db.save(data);
  res.json({ checked: results.length, seconds: ((Date.now() - started) / 1000).toFixed(1), results });
});

app.get('/api/listings/:id/history', (req, res) => {
  const data = db.load();
  const id = Number(req.params.id);
  res.json(data.history.filter((h) => h.listing_id === id));
});

// ---------- backup / restore ----------
// Protects against exactly what just happened: deleting the whole project
// folder (which deletes data.json along with it) wipes your product list.
// Download a backup after adding things; restore it after any update.

app.get('/api/backup', (req, res) => {
  const data = db.load();
  res.setHeader('Content-Disposition', 'attachment; filename="skinstock-backup.json"');
  res.json(data);
});

app.post('/api/restore', (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.products) || !Array.isArray(incoming.listings)) {
    return res.status(400).json({ error: 'That file doesn\'t look like a SkinStock backup.' });
  }
  db.save(incoming);
  res.json({ ok: true, products: incoming.products.length, listings: incoming.listings.length });
});

// ---------- optional background schedule ----------

if (process.env.SCHEDULE_CRON) {
  cron.schedule(process.env.SCHEDULE_CRON, async () => {
    const data = db.load();
    await runWithConcurrency(data.listings, CONCURRENCY, (l) => checkOneListing(data, l));
    db.save(data);
    console.log(`[scrape] scheduled check ran at ${new Date().toISOString()}`);
  });
  console.log(`Scheduled refresh enabled: ${process.env.SCHEDULE_CRON}`);
}

app.listen(PORT, () => {
  console.log(`SkinStock running at http://localhost:${PORT}`);
  console.log(`Refresh happens on demand (tap the button in the app). Concurrency: ${CONCURRENCY}.`);
});
