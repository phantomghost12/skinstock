// site-presets.js
// Autofills the price/original/stock selectors when you paste a URL from a
// site I've already checked.
//
// "shopifyvariant:price" / "shopifyvariant:available" read the exact price
// straight out of the raw page data that Shopify's own "pick a size"
// feature depends on to update the price instantly without a reload. This
// exists on every Shopify store regardless of theme, and correctly
// matches the specific variant from a ?variant=... URL. Listed first.
//
// "jsonld:price" / "jsonld:availability" read the site's Schema.org
// structured-data block as a second-choice fallback.
//
// "stock" reads the Add to Cart button as a further fallback — on
// Shopify this is almost always button[name="add"] regardless of theme.

const SHOPIFY_PRICE = 'shopifyvariant:price, jsonld:price, .price-item--sale, .price__regular .price-item--regular, meta[property="og:price:amount"]';
const SHOPIFY_STOCK = 'shopifyvariant:available, jsonld:availability, button[name="add"], .product-form__submit, [name="add"]';
const WOOCOMMERCE_STOCK = '.single_add_to_cart_button, p.stock.out-of-stock, .stock';

window.SITE_PRESETS = {
  'glowcareshop.com': {
    price: SHOPIFY_PRICE,
    original: 'shopifyvariant:original, .price__sale .price-item--regular',
    stock: SHOPIFY_STOCK,
    note: 'Now reads the exact variant price straight from the page\'s own data (the same data the site itself uses to update the price when you pick a size), with structured-data and a theme guess as backups. Please Test to confirm.',
  },
  'skinstorepakistan.com': {
    price: SHOPIFY_PRICE,
    original: 'shopifyvariant:original, .price__sale .price-item--regular',
    stock: SHOPIFY_STOCK,
    note: 'Reads the exact price/was-price straight from this theme\'s own script data (confirmed by checking a real product\'s raw HTML), with the CSS classes as a fallback if that data isn\'t found. Works for both single-size and multi-size products.',
  },
  'dubuypk.com': {
    price: SHOPIFY_PRICE,
    original: 'shopifyvariant:original, .price__sale .price-item--regular',
    stock: SHOPIFY_STOCK,
    note: 'Two earlier approaches (a meta tag, then a theme-class guess) both turned out wrong for this store. This reads the exact price straight out of the page\'s own variant data instead — the same data the site itself uses when you tap a different size — which should finally match the specific size you picked. Please Test to confirm before saving.',
  },
  'theskinfit.com': {
    price: SHOPIFY_PRICE,
    original: 'shopifyvariant:original, .price__sale .price-item--regular',
    stock: SHOPIFY_STOCK,
    note: 'Same fix as dubuypk.com — now reads the exact price from the page\'s own variant data rather than a meta tag or guessed classes. Please Test to confirm before saving.',
  },
  'kmbelle.com': {
    price: 'ins .amount, .summary .price .amount',
    original: 'del .amount',
    stock: WOOCOMMERCE_STOCK,
    note: 'Verified (WooCommerce). "ins" only exists while on sale, so the fallback covers regular-price products too.',
  },
  'tsmpk.com': {
    price: 'jsonld:price, meta[property="product:price:amount"]',
    original: '',
    stock: 'jsonld:availability, .product-stock',
    note: 'Verified directly from this store\'s real HTML: it ships clean Schema.org structured data with both price and stock in one place, so that\'s used first, with the theme\'s own ".product-stock" element as backup.',
  },
  'highfy.pk': {
    price: SHOPIFY_PRICE,
    original: 'shopifyvariant:original, .price__sale .price-item--regular',
    stock: SHOPIFY_STOCK,
    note: 'This site has no price meta tag, so it now reads the exact variant price from the page\'s own data first. Please Test before saving.',
  },
  'korean-skincare.pk': {
    price: SHOPIFY_PRICE,
    original: 'shopifyvariant:original, .price__sale .price-item--regular',
    stock: SHOPIFY_STOCK,
    note: 'Now tries the page\'s own variant data first, falling back to the previously-verified meta tag. Please Test to confirm.',
  },
  'koreanhomee.com': {
    price: 'ins .amount, .summary .price .amount',
    original: 'del .amount',
    stock: WOOCOMMERCE_STOCK,
    note: 'Could not check this one — koreanhomee.com\'s robots.txt explicitly disallows automated access. I\'d suggest checking this one\'s prices manually rather than scraping it, or dropping it from your list.',
  },
  'tokyoshelf.pk': {
    price: SHOPIFY_PRICE,
    original: 'shopifyvariant:original, .price__sale .price-item--regular',
    stock: SHOPIFY_STOCK,
    note: 'This site also has no price meta tag, so it now reads the exact variant price from the page\'s own data first. Please Test before saving.',
  },
  'colorshow.pk': {
    price: SHOPIFY_PRICE,
    original: 'shopifyvariant:original, .price__sale .price-item--regular',
    stock: SHOPIFY_STOCK,
    note: 'Now tries the page\'s own variant data first, falling back to the previously-verified meta tag. Please Test to confirm.',
  },
};
