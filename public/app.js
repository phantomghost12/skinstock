// app.js — plain JS, no build step needed.

const state = {
  products: [],
  categories: [],
  activeCategory: 'All',
  currentProductId: null,
};

const el = (id) => document.getElementById(id);

// ---------- API helpers ----------

async function api(path, options) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

// ---------- data loading ----------

async function loadProducts() {
  state.products = await api('/products');
  state.categories = await api('/categories');
  renderChips();
  renderGrid();
}

// ---------- home view: category chips ----------

function renderChips() {
  const container = el('categoryChips');
  const cats = ['All', ...state.categories];
  container.innerHTML = '';
  cats.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = 'chip' + (cat === state.activeCategory ? ' active' : '');
    btn.textContent = cat;
    btn.onclick = () => {
      state.activeCategory = cat;
      renderChips();
      renderGrid();
    };
    container.appendChild(btn);
  });
}

// ---------- home view: product grid ----------

function renderGrid() {
  const grid = el('productGrid');
  const empty = el('emptyState');
  const visible =
    state.activeCategory === 'All'
      ? state.products
      : state.products.filter((p) => p.category === state.activeCategory);

  grid.innerHTML = '';

  if (state.products.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  visible.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.onclick = () => openDetail(p.id);

    const img = p.image_url
      ? `<img src="${escapeAttr(p.image_url)}" alt="${escapeAttr(p.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'thumb-fallback',textContent:'${escapeAttr(p.name[0] || '?')}'}))" />`
      : `<div class="thumb-fallback">${escapeHtml(p.name[0] || '?')}</div>`;

    const siteLabel =
      p.in_stock_count < p.site_count
        ? `${p.in_stock_count} of ${p.site_count} site${p.site_count === 1 ? '' : 's'} in stock`
        : `${p.site_count} site${p.site_count === 1 ? '' : 's'}`;
    const priceHtml =
      p.lowest_price !== null
        ? `<span class="price">Rs. ${formatPrice(p.lowest_price)}</span><span class="site-count">${siteLabel}</span>`
        : p.all_out_of_stock
        ? `<span class="no-price">Out of stock everywhere</span>`
        : `<span class="no-price">No price yet</span>`;

    card.innerHTML = `
      ${img}
      <div class="card-body">
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="category">${escapeHtml(p.category)}</div>
        <div class="price-row">${priceHtml}</div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function formatPrice(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ---------- detail view ----------

async function openDetail(id) {
  state.currentProductId = id;
  const p = await api('/products/' + id);
  el('detailImg').src = p.image_url || '';
  el('detailImg').style.display = p.image_url ? 'block' : 'none';
  el('detailName').textContent = p.name;
  el('detailCategory').textContent = p.category;
  el('detailNote').value = p.note || '';
  el('allOutOfStockBanner').hidden = !p.all_out_of_stock;

  // sort in-stock listings by price first; out-of-stock ones sink to the bottom
  const listings = p.listings.slice().sort((a, b) => {
    const aOos = a.in_stock === false;
    const bOos = b.in_stock === false;
    if (aOos !== bOos) return aOos ? 1 : -1;
    if (a.current_price === null) return 1;
    if (b.current_price === null) return -1;
    return a.current_price - b.current_price;
  });
  const lowest = p.lowest_price;

  el('listingsList').innerHTML = listings.length
    ? listings.map((l) => listingRowHtml(l, lowest)).join('')
    : `<p class="muted small">No websites added yet — add one below.</p>`;

  listings.forEach((l) => {
    const removeBtn = document.querySelector(`[data-remove-listing="${l.id}"]`);
    if (removeBtn) removeBtn.onclick = () => removeListing(l.id);
    const editBtn = document.querySelector(`[data-edit-listing="${l.id}"]`);
    if (editBtn) editBtn.onclick = () => openEditListingModal(l);
  });

  const mostRecent = listings
    .map((l) => l.last_checked)
    .filter(Boolean)
    .sort()
    .pop();
  el('lastCheckedLabel').textContent = mostRecent
    ? 'Last checked ' + timeAgo(mostRecent)
    : '';

  const enteringDetailFresh = !el('homeView').hidden; // were we on the home screen just now?
  state.currentProduct = p;
  showView('detailView');
  if (enteringDetailFresh) pushNavState();
}

function listingRowHtml(l, lowest) {
  const isLowest = l.current_price !== null && l.current_price === lowest && l.in_stock !== false;
  const isOos = l.in_stock === false;
  const onSale =
    l.original_price !== null && l.original_price !== undefined && l.original_price > l.current_price;

  let priceHtml;
  if (l.current_price !== null) {
    if (onSale) {
      const pct = Math.round((1 - l.current_price / l.original_price) * 100);
      priceHtml = `
        <div class="listing-price">Rs. ${formatPrice(l.current_price)}</div>
        <div class="listing-was">was Rs. ${formatPrice(l.original_price)} &middot; ${pct}% off</div>
      `;
    } else {
      priceHtml = `<div class="listing-price">Rs. ${formatPrice(l.current_price)}</div>`;
    }
  } else {
    priceHtml = `<div class="listing-error">${l.last_error ? escapeHtml(l.last_error) : 'Not checked yet'}</div>`;
  }
  // Stock status is only ever shown when it's bad news — an in-stock
  // listing looks exactly like a listing with no stock tracking at all.
  const oosBadge = isOos ? `<div class="oos-badge">Out of stock</div>` : '';

  return `
    <div class="listing-row ${isLowest ? 'lowest' : ''} ${isOos ? 'oos' : ''}">
      <div>
        <div class="listing-site">${escapeHtml(l.website_name)}${isLowest ? ' — lowest' : ''}</div>
        <div class="listing-meta">${l.last_checked ? 'Checked ' + timeAgo(l.last_checked) : ''}</div>
        <a class="listing-link" href="${escapeAttr(l.url)}" target="_blank" rel="noopener">Open site</a>
      </div>
      <div style="text-align:right;">
        ${priceHtml}
        ${oosBadge}
        <button class="edit-listing" data-edit-listing="${l.id}" title="Edit">&#9998;</button>
        <button class="remove-listing" data-remove-listing="${l.id}" title="Remove">&times;</button>
      </div>
    </div>
  `;
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diffMs / 3600000);
  if (hrs < 1) return 'less than an hour ago';
  if (hrs === 1) return '1 hour ago';
  if (hrs < 24) return `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

async function removeListing(id) {
  await api('/listings/' + id, { method: 'DELETE' });
  openDetail(state.currentProductId);
}

function showView(name) {
  el('homeView').hidden = name !== 'homeView';
  el('detailView').hidden = name !== 'detailView';
  updateFabVisibility();
}

// ---------- Android/phone back-button handling ----------
// Without this, the phone's back gesture closes the whole app the moment
// you're on a product page or have a modal open, instead of stepping back
// through the app's own screens first. Fix: push a history entry whenever
// we go "deeper" (open a modal, or view a product), and on the phone's
// back button (which fires a popstate event), close whatever's open
// instead of letting the browser actually navigate away.

function pushNavState() {
  history.pushState({ skinstock: true }, '', location.href);
}

window.addEventListener('popstate', () => {
  if (!el('addListingModal').hidden) { el('addListingModal').hidden = true; updateFabVisibility(); return; }
  if (!el('addProductModal').hidden) { el('addProductModal').hidden = true; updateFabVisibility(); return; }
  if (!el('editProductModal').hidden) { el('editProductModal').hidden = true; updateFabVisibility(); return; }
  if (!el('detailView').hidden) { showView('homeView'); loadProducts(); return; }
  // Already at the home screen with nothing open — nothing to intercept;
  // the next back press after this will exit the app as normal.
});

// Single source of truth for whether the + button should be visible:
// only on the home screen, and never while any modal is open. Called
// explicitly wherever a modal opens/closes or the view changes.
function updateFabVisibility() {
  const anyModalOpen =
    !el('addProductModal').hidden || !el('addListingModal').hidden || !el('editProductModal').hidden;
  const onHome = !el('homeView').hidden;
  el('fab').style.display = onHome && !anyModalOpen ? 'flex' : 'none';
}

// ---------- add product modal ----------

function openAddProductModal() {
  el('newName').value = '';
  el('newCategory').value = '';
  el('newImage').value = '';
  el('newNote').value = '';
  const opts = el('categoryOptions');
  opts.innerHTML = state.categories.map((c) => `<option value="${escapeAttr(c)}">`).join('');
  el('addProductModal').hidden = false;
  el('fab').style.display = 'none';
  pushNavState();
}

async function createProduct() {
  const name = el('newName').value.trim();
  if (!name) { alert('Please enter a product name.'); return; }
  const payload = {
    name,
    category: el('newCategory').value.trim(),
    image_url: el('newImage').value.trim(),
    note: el('newNote').value.trim(),
  };
  const product = await api('/products', { method: 'POST', body: JSON.stringify(payload) });
  el('addProductModal').hidden = true;
  await loadProducts();
  openDetail(product.id);
}

// ---------- add listing modal ----------

function openAddListingModal() {
  state.editingListingId = null;
  el('listingModalTitle').textContent = 'Add a website';
  el('saveListingBtn').textContent = 'Save website';
  el('listingSite').value = '';
  el('listingUrl').value = '';
  el('listingSelector').value = '';
  el('listingOriginalSelector').value = '';
  el('listingStockSelector').value = '';
  el('testResult').hidden = true;
  el('presetNote').hidden = true;
  el('addListingModal').hidden = false;
  el('fab').style.display = 'none';
  pushNavState();
}

// Reuses the same modal to edit an existing listing's site/selectors —
// e.g. after I've improved a site's default selector, without needing to
// delete and re-add the whole listing just to pick up the fix.
function openEditListingModal(listing) {
  state.editingListingId = listing.id;
  el('listingModalTitle').textContent = 'Edit website';
  el('saveListingBtn').textContent = 'Save changes';
  el('listingSite').value = listing.website_name || '';
  el('listingUrl').value = listing.url || '';
  el('listingSelector').value = listing.css_selector || '';
  el('listingOriginalSelector').value = listing.original_selector || '';
  el('listingStockSelector').value = listing.stock_selector || '';
  el('testResult').hidden = true;
  el('presetNote').hidden = true;
  el('addListingModal').hidden = false;
  el('fab').style.display = 'none';
  pushNavState();
}

// When a URL is pasted/typed, check if it's a site I've already looked at
// and auto-fill the selectors — the person just picked the product link.
function applyPresetForUrl() {
  const raw = el('listingUrl').value.trim();
  if (!raw) return;
  let hostname;
  try {
    hostname = new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return;
  }
  const preset = window.SITE_PRESETS && window.SITE_PRESETS[hostname];
  const note = el('presetNote');
  if (!preset) {
    note.hidden = true;
    return;
  }
  if (!el('listingSelector').value.trim()) el('listingSelector').value = preset.price;
  if (!el('listingOriginalSelector').value.trim()) el('listingOriginalSelector').value = preset.original || '';
  if (!el('listingStockSelector').value.trim()) el('listingStockSelector').value = preset.stock || '';
  if (!el('listingSite').value.trim()) el('listingSite').value = hostname;
  note.textContent = preset.note;
  note.hidden = false;
}

async function testListing() {
  const url = el('listingUrl').value.trim();
  const selector = el('listingSelector').value.trim();
  const originalSelector = el('listingOriginalSelector').value.trim();
  const stockSelector = el('listingStockSelector').value.trim();
  if (!url || !selector) { alert('Enter both the URL and a CSS selector first.'); return; }
  const box = el('testResult');
  box.hidden = false;
  box.className = 'test-result';
  box.textContent = 'Checking…';
  const result = await api('/scrape/test', {
    method: 'POST',
    body: JSON.stringify({
      url,
      css_selector: selector,
      original_selector: originalSelector || undefined,
      stock_selector: stockSelector || undefined,
    }),
  });
  if (result.ok) {
    box.className = 'test-result ok';
    let msg = `Found: "${result.rawText}" → parsed as Rs. ${formatPrice(result.price)}`;
    if (originalSelector) {
      msg += result.originalPrice
        ? ` (was Rs. ${formatPrice(result.originalPrice)})`
        : ' (no original/"was" price found right now — fine if it\'s not on sale)';
    }
    if (stockSelector) {
      msg += result.inStock === false ? ' — currently OUT OF STOCK' : result.inStock === true ? ' — in stock' : ' (stock status unclear)';
    }
    if (result.debugNote) msg += ' ' + result.debugNote;
    box.textContent = msg;
  } else {
    box.className = 'test-result fail';
    box.textContent = result.error;
  }
}

async function saveListing() {
  const website_name = el('listingSite').value.trim();
  const url = el('listingUrl').value.trim();
  const css_selector = el('listingSelector').value.trim();
  const original_selector = el('listingOriginalSelector').value.trim();
  const stock_selector = el('listingStockSelector').value.trim();
  if (!website_name || !url || !css_selector) {
    alert('Please fill in website name, URL, and selector.');
    return;
  }
  const payload = {
    website_name,
    url,
    css_selector,
    original_selector: original_selector || undefined,
    stock_selector: stock_selector || undefined,
  };
  if (state.editingListingId) {
    await api(`/listings/${state.editingListingId}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api(`/products/${state.currentProductId}/listings`, { method: 'POST', body: JSON.stringify(payload) });
  }
  el('addListingModal').hidden = true;
  openDetail(state.currentProductId);
  loadProducts(); // refresh home-screen lowest price in the background
}

async function refreshCurrentProduct() {
  const btn = el('refreshProductBtn');
  btn.textContent = 'Checking…';
  await api(`/products/${state.currentProductId}/scrape`, { method: 'POST' });
  await openDetail(state.currentProductId);
  loadProducts();
  btn.innerHTML = '&#8635; Refresh this product\'s prices';
}

// ---------- edit product modal ----------

function openEditProductModal() {
  const p = state.currentProduct;
  if (!p) return;
  el('editName').value = p.name || '';
  el('editCategory').value = p.category || '';
  el('editImage').value = p.image_url || '';
  const opts = el('categoryOptionsEdit');
  opts.innerHTML = state.categories.map((c) => `<option value="${escapeAttr(c)}">`).join('');
  el('editProductModal').hidden = false;
  el('fab').style.display = 'none';
  pushNavState();
}

async function saveEditProduct() {
  const name = el('editName').value.trim();
  if (!name) { alert('Please enter a product name.'); return; }
  await api(`/products/${state.currentProductId}`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      category: el('editCategory').value.trim(),
      image_url: el('editImage').value.trim(),
    }),
  });
  el('editProductModal').hidden = true;
  await openDetail(state.currentProductId);
  loadProducts();
}

// ---------- wiring ----------

el('fab').onclick = openAddProductModal;
el('closeAddModal').onclick = () => history.back();
el('createProductBtn').onclick = createProduct;

el('backBtn').onclick = () => history.back();
el('addListingBtn').onclick = openAddListingModal;
el('refreshProductBtn').onclick = refreshCurrentProduct;
el('listingUrl').addEventListener('blur', applyPresetForUrl);
el('listingUrl').addEventListener('input', applyPresetForUrl);
el('closeListingModal').onclick = () => history.back();
el('testListingBtn').onclick = testListing;
el('saveListingBtn').onclick = saveListing;

el('editProductBtn').onclick = openEditProductModal;
el('closeEditModal').onclick = () => history.back();
el('saveEditBtn').onclick = saveEditProduct;

el('saveNoteBtn').onclick = async () => {
  await api(`/products/${state.currentProductId}`, {
    method: 'PUT',
    body: JSON.stringify({ note: el('detailNote').value }),
  });
  el('saveNoteBtn').textContent = 'Saved';
  setTimeout(() => (el('saveNoteBtn').textContent = 'Save note'), 1200);
};

el('deleteProductBtn').onclick = async () => {
  if (!confirm('Delete this product and all its saved prices?')) return;
  await api(`/products/${state.currentProductId}`, { method: 'DELETE' });
  showView('homeView');
  loadProducts();
};

el('refreshAllBtn').onclick = async () => {
  el('refreshAllBtn').textContent = '…';
  const result = await api('/scrape/run', { method: 'POST' });
  await loadProducts();
  if (!el('detailView').hidden) openDetail(state.currentProductId);
  el('refreshAllBtn').innerHTML = '&#8635;';
  if (result.seconds) console.log(`Checked ${result.checked} listing(s) in ${result.seconds}s`);
};

// ---------- backup / restore ----------

el('backupBtn').onclick = async () => {
  const data = await api('/backup');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `skinstock-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

el('restoreBtn').onclick = () => el('restoreFile').click();

el('restoreFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('This replaces everything currently in the app with the backup file. Continue?')) {
    e.target.value = '';
    return;
  }
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const result = await api('/restore', { method: 'POST', body: JSON.stringify(parsed) });
    if (result.error) {
      alert(result.error);
    } else {
      alert(`Restored ${result.products} product(s).`);
      loadProducts();
    }
  } catch (err) {
    alert('Could not read that file as a backup: ' + err.message);
  }
  e.target.value = '';
});

// register service worker for installability — updateViaCache: 'none' plus
// an explicit update() call means every page load checks for a fresh
// sw.js immediately, instead of trusting the browser's default ~24h delay.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => {});
}
updateFabVisibility();
loadProducts();
