// scraper.js
// Fetches a product page ONCE and pulls out: the current price, an
// optional original/"was" price, and (optionally) stock status.
//
// Extraction extras:
//  1. A selector can point at a <meta> tag — its `content` attribute is
//     read instead of visible text.
//  2. A selector can be "shopifyvariant:price" / "shopifyvariant:original"
//     / "shopifyvariant:available" — these read the exact variant's data
//     directly out of the raw page (the same data Shopify's own "pick a
//     size" feature depends on), scoped to <script> blocks that actually
//     look like the real product/variants data, since some pages embed
//     the same product more than once (upsell widgets, quick-view
//     popups) and only one copy is the live pricing.
//  3. A selector can be "jsonld:price" / "jsonld:availability" — these
//     read the site's Schema.org structured-data block as a fallback.
//     This can list every variant as a separate Offer, so it's matched
//     against the ?variant=... ID from the URL the same way.
//  4. A selector can be a comma-separated ORDERED fallback list.
//  5. Stock detection reads the text of a selector (typically the
//     Add to Cart button) and looks for phrases like "sold out".

const axios = require('axios');
const cheerio = require('cheerio');

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const OUT_OF_STOCK_PHRASES = [
  'sold out',
  'out of stock',
  'unavailable',
  'notify me',
  'currently unavailable',
];

function parsePrice(rawText) {
  if (!rawText) return null;
  const cleaned = rawText.replace(/,/g, '');
  const match = cleaned.match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  return parseFloat(match[1]);
}

function extractVariantId(pageUrl) {
  try {
    return new URL(pageUrl).searchParams.get('variant');
  } catch {
    return null;
  }
}

// The URL slug (e.g. "anua-heartleaf-77-soothing-toner...") is the most
// specific signal available for telling this product's own data apart
// from an unrelated one — a "Popular Products" widget showing a totally
// different item can't coincidentally contain THIS product's exact slug.
function extractProductHandle(pageUrl) {
  try {
    const match = new URL(pageUrl).pathname.match(/\/products\/([^/?]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// Shopify's own "Add to Cart" JS updates the price instantly when you pick
// a different size, with no page reload — which means the exact price for
// EVERY variant must already be sitting somewhere in the raw page's HTML,
// in a plain JavaScript/JSON blob, regardless of theme. This finds that
// data by reading it out of <script> blocks that actually look like a
// product's variant list — NOT the whole raw page — because many Shopify
// pages embed the same product's data more than once (a "frequently
// bought together" app, a quick-view popup, a reviews widget), and only
// one of those copies is the real, live pricing data.

// Given the index of some character inside a JSON object, returns the
// full text of that object by walking outward to its matching { and }.
function findEnclosingObject(text, idx) {
  let depth = 0;
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    if (text[i] === '}') depth++;
    else if (text[i] === '{') {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start === -1) return null;
  depth = 0;
  for (let j = start; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, j + 1);
    }
  }
  return null;
}

// Collects every <script> block that actually looks like Shopify's own
// product/variants data (must literally contain a "variants" array with
// "inventory_management" or "compare_at_price" — fields specific to
// Shopify's real variant schema, not just any script mentioning prices).
// Ranked so a block containing this exact product's own URL handle wins
// outright — far more reliable than guessing from a script's id/type,
// since a widget showing unrelated products can't contain this one's slug.
// Collects every <script> block that actually looks like Shopify's own
// price/variant data — must contain "compare_at_price" or
// "inventory_management" (fields specific to Shopify's real variant
// schema). Deliberately does NOT require a "variants" wrapper key: some
// themes (confirmed on this one) emit a bare array of variant objects
// directly, e.g. [{"id":...,"price":...,"compare_at_price":...}], with
// no such key at all — requiring it was silently discarding the correct,
// product-scoped data and falling through to something worse.
// Ranked so a block containing this exact product's own URL handle wins
// outright — far more reliable than guessing from a script's id/type,
// since a widget showing unrelated products can't contain this one's slug.
function collectVariantDataBlocks($, handle) {
  const blocks = [];
  $('script').each((_, el) => {
    const text = $(el).contents().text();
    if (!text) return;
    if (!text.includes('compare_at_price') && !text.includes('inventory_management')) return;
    const id = ($(el).attr('id') || '').toLowerCase();
    let priority = id.includes('productjson') || id.includes('product-json') ? 1 : 2;
    if (handle && text.includes(`"handle":"${handle}"`)) priority = 0;
    blocks.push({ text, priority });
  });
  blocks.sort((a, b) => a.priority - b.priority);
  return blocks.map((b) => b.text);
}

// When there's no ?variant=... in the URL (a single-size product), there's
// no ID to match against — but that's fine now that collectVariantDataBlocks
// itself only returns blocks that genuinely contain Shopify's real variant
// schema (compare_at_price/inventory_management), correctly excluding
// unrelated widgets by construction (their data lives in HTML attributes,
// never inside an actual <script> tag). So it's safe to just read the
// first — and, for a single-variant product, only — real variant found in
// the highest-priority block, rather than falling back to a CSS guess.
function findFirstVariantField(blocks, field) {
  for (const text of blocks) {
    const idPattern = /"id"\s*:\s*\d+\b/g;
    let match;
    while ((match = idPattern.exec(text)) !== null) {
      const obj = findEnclosingObject(text, match.index);
      if (obj && obj.includes(`"${field}"`)) {
        const fieldRe = new RegExp(`"${field}"\\s*:\\s*"?(-?[\\w.]+)"?`);
        const fieldMatch = obj.match(fieldRe);
        if (fieldMatch) return fieldMatch[1];
      }
    }
  }
  return null;
}

function findVariantField(blocks, variantId, field) {
  if (!variantId) return findFirstVariantField(blocks, field);
  for (const text of blocks) {
    const idPattern = new RegExp(`"id"\\s*:\\s*${variantId}\\b`, 'g');
    let match;
    while ((match = idPattern.exec(text)) !== null) {
      const obj = findEnclosingObject(text, match.index);
      if (obj) {
        const fieldRe = new RegExp(`"${field}"\\s*:\\s*"?(-?[\\w.]+)"?`);
        const fieldMatch = obj.match(fieldRe);
        if (fieldMatch) return fieldMatch[1];
      }
    }
  }
  return null;
}

function shopifyVariantLookup(blocks, variantId, field) {
  if (field === 'price' || field === 'compare_at_price') {
    const raw = findVariantField(blocks, variantId, field);
    if (raw === null || raw === 'null') return { rawText: null, price: null, found: false };
    const num = parseFloat(raw);
    const price = num >= 10000 ? num / 100 : num;
    return { rawText: raw, price, found: true };
  }
  if (field === 'available') {
    const raw = findVariantField(blocks, variantId, 'available');
    if (raw === null) return { rawText: null, price: null, found: false };
    return { rawText: raw, price: null, found: true, isAvailable: raw === 'true' };
  }
  return { rawText: null, price: null, found: false };
}

function findJsonLdOffers($) {
  const offers = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let data;
    try {
      data = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const type = item['@type'];
      const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
      if (!isProduct || !item.offers) continue;
      const offerList = Array.isArray(item.offers) ? item.offers : [item.offers];
      offers.push(...offerList);
    }
  });
  return offers;
}

// Picks the offer matching `variantId` (checked against each offer's own
// `url` field, or its `sku`), falling back to the first offer if there's
// no variant id to match, or nothing matches it.
function pickOffer(offers, variantId) {
  if (offers.length === 0) return null;
  if (variantId) {
    const match = offers.find((o) => {
      const url = String(o.url || '');
      const sku = String(o.sku || '');
      return url.includes(`variant=${variantId}`) || sku === variantId;
    });
    if (match) return { offer: match, matchedVariant: true };
  }
  return { offer: offers[0], matchedVariant: false };
}

function jsonLdLookup($, field, variantId) {
  const offers = findJsonLdOffers($);
  const picked = pickOffer(offers, variantId);
  if (!picked) return { rawText: null, price: null, found: false, offerCount: 0, matchedVariant: false };
  const { offer, matchedVariant } = picked;
  if (field === 'price') {
    const raw = offer.price !== undefined ? String(offer.price) : null;
    return {
      rawText: raw,
      price: raw !== null ? parseFloat(raw) : null,
      found: raw !== null,
      offerCount: offers.length,
      matchedVariant,
    };
  }
  if (field === 'availability') {
    const raw = offer.availability || null;
    return { rawText: raw, price: null, found: raw !== null, offerCount: offers.length, matchedVariant };
  }
  return { rawText: null, price: null, found: false, offerCount: offers.length, matchedVariant };
}

function valueOf(el) {
  const isMeta = el.is('meta');
  return isMeta ? (el.attr('content') || '').trim() : el.text().trim();
}

function extract($, selectorList, variantId, variantBlocks) {
  if (!selectorList) return { rawText: null, price: null, found: true };
  const parts = selectorList.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'shopifyvariant:price') {
      const result = shopifyVariantLookup(variantBlocks, variantId, 'price');
      if (result.found) return { ...result, viaVariantJson: true };
      continue;
    }
    if (lower === 'shopifyvariant:original') {
      const result = shopifyVariantLookup(variantBlocks, variantId, 'compare_at_price');
      if (result.found) return { ...result, viaVariantJson: true };
      continue;
    }
    if (lower === 'jsonld:price') {
      const result = jsonLdLookup($, 'price', variantId);
      if (result.found) return result;
      continue;
    }
    const el = $(part).first();
    if (el.length > 0) {
      const rawText = valueOf(el);
      return { rawText, price: parsePrice(rawText), found: true };
    }
  }
  return { rawText: null, price: null, found: false };
}

function checkStock($, stockSelectorList, variantId, variantBlocks) {
  if (!stockSelectorList) return null;
  const parts = stockSelectorList.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'shopifyvariant:available') {
      const result = shopifyVariantLookup(variantBlocks, variantId, 'available');
      if (result.found) return result.isAvailable;
      continue;
    }
    if (lower === 'jsonld:availability') {
      const result = jsonLdLookup($, 'availability', variantId);
      if (result.found) {
        const text = (result.rawText || '').toLowerCase();
        return !text.includes('outofstock') && !text.includes('soldout');
      }
      continue;
    }
    const el = $(part).first();
    if (el.length > 0) {
      const text = valueOf(el).toLowerCase();
      const isDisabled = el.is('[disabled]') || el.attr('aria-disabled') === 'true';
      const matchesPhrase = OUT_OF_STOCK_PHRASES.some((p) => text.includes(p));
      if (matchesPhrase || (isDisabled && text.length > 0)) return false;
      return true;
    }
  }
  return null;
}

async function scrapeListing(url, priceSelector, originalSelector, stockSelector) {
  const response = await axios.get(url, {
    headers: REQUEST_HEADERS,
    timeout: 15000,
    maxRedirects: 5,
  });

  const $ = cheerio.load(response.data);
  const variantId = extractVariantId(url);
  const handle = extractProductHandle(url);
  const variantBlocks = collectVariantDataBlocks($, handle);

  const current = extract($, priceSelector, variantId, variantBlocks);
  if (!current.found) {
    return {
      ok: false,
      error: `No element matched the price selector "${priceSelector}". The site may have changed its layout.`,
      rawText: null,
      price: null,
      originalPrice: null,
      inStock: null,
    };
  }
  if (current.price === null) {
    return {
      ok: false,
      error: `Found the price element, but couldn't find a number in its text: "${current.rawText}".`,
      rawText: current.rawText,
      price: null,
      originalPrice: null,
      inStock: null,
    };
  }

  let originalPrice = null;
  if (originalSelector) {
    const original = extract($, originalSelector, variantId, variantBlocks);
    if (original.found && original.price !== null) originalPrice = original.price;
  }

  const inStock = checkStock($, stockSelector, variantId, variantBlocks);

  // Extra context so the Test button shows what actually happened instead
  // of a silent number you have to just trust.
  let debugNote = null;
  if (current.viaVariantJson) {
    debugNote = variantId
      ? `(read directly from the page's own variant data for ID ${variantId}, found in ${variantBlocks.length} candidate block(s))`
      : `(read from the page's variant data — no ?variant= in this URL, so this is whichever variant the page defaults to)`;
  } else if (variantId !== null && typeof current.offerCount === 'number' && current.offerCount > 1) {
    debugNote = current.matchedVariant
      ? `(matched your specific variant among ${current.offerCount} listed)`
      : `(⚠ found ${current.offerCount} variants in the page data but couldn't match yours by ID — this may be the wrong one)`;
  }

  return {
    ok: true,
    error: null,
    rawText: current.rawText,
    price: current.price,
    originalPrice,
    inStock,
    debugNote,
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await worker(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runNext);
  await Promise.all(workers);
  return results;
}

module.exports = { scrapeListing, parsePrice, runWithConcurrency };
