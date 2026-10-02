// Product cards + Product Detail (full-screen on mobile, centered modal on desktop).
// Loaded after the storefront scripts: it replaces renderShop()/openProductDetails() only and
// reuses the existing catalog (products, PRODUCT_IMAGES, liveCatalog) and cart (addToCartById).
(() => {
  const ICON = {
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    chef: '<path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"/><path d="M6 17h12"/>',
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'
  };
  const icon = (name, cls = '') => `<svg class="pd-icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
  const esc = (value) => authEscape(String(value ?? ''));
  const money = (value) => checkoutMoney(value).replace('.00', '');

  // ---- Favorites: saved on this device only (there is no account favorites feature). ----
  const FAV_KEY = 'lexc_favorites_v1';
  const readFavs = () => { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); } };
  let favs = readFavs();
  const isFav = (p) => favs.has(p.product_id);
  function toggleFav(p) {
    if (isFav(p)) favs.delete(p.product_id); else favs.add(p.product_id);
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch { /* private mode: keep in memory */ }
    document.querySelectorAll(`[data-pd-fav="${p.id}"]`).forEach(syncFavButton);
    showToast(isFav(p) ? `Saved ${p.name} to favorites on this device` : `Removed ${p.name} from favorites`);
  }
  function syncFavButton(button) {
    const p = products.find((x) => x.id === Number(button.dataset.pdFav));
    if (!p) return;
    button.setAttribute('aria-pressed', String(isFav(p)));
    button.setAttribute('aria-label', `${isFav(p) ? 'Remove' : 'Save'} ${p.name} ${isFav(p) ? 'from' : 'to'} favorites`);
  }
  const favButton = (p, cls) => `<button type="button" class="${cls}" data-pd-fav="${p.id}" aria-pressed="${isFav(p)}" aria-label="${isFav(p) ? 'Remove' : 'Save'} ${esc(p.name)} ${isFav(p) ? 'from' : 'to'} favorites">${icon('heart')}</button>`;

  // ---- Ratings: Admin-approved reviews of orders that contained the product. ----
  let ratings = new Map();
  const ratingFor = (p) => ratings.get(p.product_id);
  (async () => {
    try {
      const rows = await LexcBackend.rpc('get_product_review_summary', {});
      ratings = new Map((rows || []).map((r) => [r.product_id, { avg: Number(r.average_rating), count: Number(r.review_count) }]));
      if (window.lexcCatalogState === 'ready') renderShop();
    } catch (error) { console.info('Product ratings unavailable:', error?.message || error); }
  })();
  const ratingLine = (p, cls = 'pd-rating') => {
    const r = ratingFor(p);
    return r && r.count ? `<span class="${cls}">${icon('star', 'pd-star')}<b>${r.avg.toFixed(1)}</b><span>(${r.count})</span></span>` : '';
  };

  const imageOf = (p) => PRODUCT_IMAGES[p.id] || '';
  // Main photo first, then the product's extra gallery photos (products.gallery_image_paths).
  const imagesOf = (p) => {
    const list = imageOf(p) ? [imageOf(p)] : [];
    for (const path of catalogRow(p)?.gallery_image_paths || []) {
      const url = LexcBackend.mediaURL(path);
      if (url && !list.includes(url)) list.push(url);
    }
    return list;
  };
  const catalogRow = (p) => (typeof liveCatalog !== 'undefined' ? liveCatalog.find((d) => d.id === p.product_id) : null);
  const priceLabel = (p) => `${p.sizes.length > 1 ? '<small>from</small>' : ''}<strong>${money(Math.min(...p.sizes.map((s) => s.price)))}</strong>`;
  const shoppable = (p) => !p.isTest;

  // ---- Product grid (same filters/search/sort as before, new card design). ----
  window.renderShop = function renderShop() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    grid.classList.add('pd-grid');
    if (window.lexcCatalogState === 'loading') {
      document.getElementById('resultsCount').textContent = 'Browse pastries';
      grid.innerHTML = Array.from({ length: 8 }, () => '<div class="pd-card pd-card--skeleton" aria-hidden="true"><span class="skel pd-card__media"></span><div class="pd-card__body"><span class="skel skel-line skel-line--long"></span><span class="skel skel-line skel-line--short"></span><span class="skel skel-line"></span></div></div>').join('');
      grid.setAttribute('aria-busy', 'true');
      return;
    }
    grid.removeAttribute('aria-busy');
    if (window.lexcCatalogState === 'error') {
      document.getElementById('resultsCount').textContent = 'Catalog unavailable';
      grid.innerHTML = '<div class="shop-no-results" role="alert"><strong>Pastries could not load.</strong><p>Check your connection and try again.</p><button class="btn-primary" type="button" onclick="loadStorefront()">Try again</button></div>';
      return;
    }
    let filtered = products.filter((p) => (shopCat === 'all' || p.cat === shopCat) && p.price <= shopMaxPrice);
    const query = document.getElementById('shopSearch').value.trim();
    let approximate = false;
    if (query) {
      const matches = LexcFuzzySearch.rank(filtered, query);
      filtered = matches.map((m) => m.product);
      approximate = matches.length > 0 && matches[0].approximate;
    }
    const sort = document.getElementById('sortSelect').value;
    if (!query && sort === 'price-asc') filtered.sort((a, b) => a.price - b.price);
    else if (!query && sort === 'price-desc') filtered.sort((a, b) => b.price - a.price);
    else if (!query && sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById('shopSearchHint').textContent = query ? (filtered.length ? (approximate ? `Closest matches for “${query}”` : `Results for “${query}”`) : `No pastries found for “${query}”. Try a shorter name.`) : '';
    document.getElementById('resultsCount').textContent = `Showing ${filtered.length} item${filtered.length !== 1 ? 's' : ''}`;
    grid.innerHTML = filtered.map(cardMarkup).join('') || '<p class="shop-no-results">No matching products right now.</p>';
    grid.querySelectorAll('img').forEach(watchImage);
    maybeOpenDeepLink();
  };

  function cardMarkup(p) {
    const img = imageOf(p);
    return `<article class="pd-card" id="pc-${p.id}" data-card="${p.id}">
      <button type="button" class="pd-card__media" data-pd-open="${p.id}" aria-label="View details for ${esc(p.name)}">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">` : `<span class="pd-emoji" aria-hidden="true">${esc(p.emoji)}</span>`}
      </button>
      ${favButton(p, 'pd-fav')}
      ${p.badge ? `<span class="pd-badge">${esc(p.badge)}</span>` : ''}
      <div class="pd-card__body">
        <button type="button" class="pd-card__name" data-pd-open="${p.id}">${esc(p.name)}</button>
        ${ratingLine(p)}
        <div class="pd-card__foot">
          <span class="pd-price">${priceLabel(p)}</span>
          <button type="button" class="pd-add" data-pd-add="${p.id}" aria-label="Add ${esc(p.name)} (${esc(p.sizes[0].label)}) to cart">${icon('plus', 'pd-add__plus')}${icon('cart', 'pd-add__cart')}<span>Add to Cart</span></button>
        </div>
      </div>
    </article>`;
  }

  function watchImage(img) {
    const failed = () => { const span = Object.assign(document.createElement('span'), { className: 'pd-emoji', textContent: '🧁' }); span.setAttribute('aria-hidden', 'true'); img.replaceWith(span); };
    if (img.complete && !img.naturalWidth) failed(); else img.addEventListener('error', failed, { once: true });
  }

  // One delegated listener for every card area (grid, detail recommendations).
  document.addEventListener('click', (event) => {
    const fav = event.target.closest('[data-pd-fav]');
    if (fav) { event.preventDefault(); const p = products.find((x) => x.id === Number(fav.dataset.pdFav)); if (p) toggleFav(p); return; }
    const add = event.target.closest('[data-pd-add]');
    if (add) { event.preventDefault(); quickAdd(Number(add.dataset.pdAdd), add); return; }
    const open = event.target.closest('[data-pd-open]');
    if (open) { event.preventDefault(); openProductDetails(Number(open.dataset.pdOpen)); }
  });

  function quickAdd(id, button) {
    const p = products.find((x) => x.id === id);
    if (!p) return showToast('This pastry is no longer available.');
    if (addToCartById(id, 0, 1)) {
      button.classList.remove('is-added'); void button.offsetWidth; button.classList.add('is-added');
      if (p.sizes.length > 1) showToast(`✓ ${p.name} (${p.sizes[0].label}) added — open the product to choose another size.`);
    }
  }

  // ---- Product Detail ----
  const state = { id: null, img: 0, size: 0, qty: 1, tab: 'description', pushed: false, scrollY: 0, reviews: new Map() };
  let dialog;

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'pd-dialog';
    dialog.setAttribute('aria-labelledby', 'pd-title');
    document.body.append(dialog);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDetail(); });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) return closeDetail();
      const t = event.target;
      if (t.closest('[data-close]')) return closeDetail();
      if (t.closest('[data-share]')) return share();
      if (t.closest('[data-prev]')) return showImage(state.img - 1);
      if (t.closest('[data-next]')) return showImage(state.img + 1);
      const thumb = t.closest('[data-thumb]'); if (thumb) return showImage(Number(thumb.dataset.thumb));
      const size = t.closest('[data-size]'); if (size) return chooseSize(Number(size.dataset.size));
      if (t.closest('[data-less]')) return setQty(state.qty - 1);
      if (t.closest('[data-more]')) return setQty(state.qty + 1);
      if (t.closest('[data-buy]')) return addFromDetail();
      const tab = t.closest('[data-tab]'); if (tab) return setTab(tab.dataset.tab);
      if (t.closest('[data-see-all]')) { dialog.querySelector('.pd-reviews')?.classList.add('is-expanded'); t.closest('[data-see-all]').remove(); }
      if (t.closest('[data-chat]')) { closeDetail(); document.querySelector('#customer-chat-toggle')?.click(); }
      if (t.closest('[data-design]')) { const kind = t.closest('[data-design]').dataset.design, id = t.closest('[data-design]').dataset.productId; closeDetail(); setTimeout(() => (kind === 'cupcake' ? window.LexcCupcake?.open({ productId: id }) : kind === 'donut' ? window.LexcDonut?.open({ productId: id }) : window.LexcBento?.open()), 200); }
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.target.closest('[role=tablist]') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const tabs = [...dialog.querySelectorAll('[data-tab]')]; const i = tabs.findIndex((x) => x.dataset.tab === state.tab);
        const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; setTab(next.dataset.tab); next.focus();
      }
      if (event.target.closest('.pd-hero') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) showImage(state.img + (event.key === 'ArrowRight' ? 1 : -1));
    });
    let startX = null;
    dialog.addEventListener('pointerdown', (e) => { if (e.target.closest('.pd-hero') && !e.target.closest('button')) startX = e.clientX; });
    dialog.addEventListener('pointerup', (e) => { if (startX == null) return; const dx = e.clientX - startX; startX = null; if (Math.abs(dx) > 40) showImage(state.img + (dx < 0 ? 1 : -1)); });
    window.addEventListener('popstate', () => { if (dialog.open && !history.state?.lexcProduct) { state.pushed = false; closeDetail(true); } });
    return dialog;
  }

  window.openProductDetails = function openProductDetails(id, options = {}) {
    const p = products.find((x) => x.id === id);
    if (!p) return showToast('This pastry is no longer available.');
    ensureDialog();
    const switching = dialog.open;
    Object.assign(state, { id, img: 0, size: 0, qty: 1, tab: 'description' });
    dialog.innerHTML = detailMarkup(p);
    dialog.querySelectorAll('img').forEach(watchImage);
    if (!switching) {
      state.scrollY = window.scrollY;
      document.documentElement.classList.add('pd-lock');
      dialog.showModal();
      if (!options.fromHistory) {
        const url = new URL(location.href); url.searchParams.set('product', p.product_id);
        history.pushState({ ...(history.state || {}), lexcProduct: p.product_id }, '', url);
        state.pushed = true;
      }
    } else {
      const url = new URL(location.href); url.searchParams.set('product', p.product_id);
      history.replaceState({ ...(history.state || {}), lexcProduct: p.product_id }, '', url);
    }
    dialog.querySelector('.pd-scroll').scrollTop = 0;
    dialog.querySelector('[data-close]').focus({ preventScroll: true });
    loadReviews(p);
  };

  function closeDetail(fromPopstate = false) {
    if (!dialog?.open) return;
    dialog.classList.add('is-closing');
    setTimeout(() => {
      dialog.classList.remove('is-closing');
      dialog.close();
      document.documentElement.classList.remove('pd-lock');
      window.scrollTo(0, state.scrollY);
      document.querySelector(`#pc-${state.id} .pd-card__name`)?.focus({ preventScroll: true });
    }, 160);
    if (!fromPopstate && state.pushed) { state.pushed = false; history.back(); }
    else if (!fromPopstate) { const url = new URL(location.href); url.searchParams.delete('product'); history.replaceState(history.state, '', url); }
  }

  function detailMarkup(p) {
    const images = imagesOf(p);
    const row = catalogRow(p);
    const category = row?.categories?.name || '';
    const size = p.sizes[0];
    const r = ratingFor(p);
    const related = products.filter((x) => x.id !== p.id && x.cat === p.cat && shoppable(x)).slice(0, 4);
    const also = products.filter((x) => x.id !== p.id && x.cat !== p.cat && shoppable(x))
      .sort((a, b) => ((ratingFor(b)?.count || 0) - (ratingFor(a)?.count || 0)) || (Boolean(b.badge) - Boolean(a.badge))).slice(0, 4);
    const short = (p.desc || '').split(/(?<=[.!?])\s/)[0] || p.desc || '';
    const hero = images.length
      ? `<img src="${esc(images[0])}" alt="${esc(p.name)}" data-hero-img decoding="async">`
      : `<span class="pd-emoji pd-emoji--hero" role="img" aria-label="${esc(p.name)}">${esc(p.emoji)}</span>`;
    const specs = [
      category && ['Category', category],
      ['Options', p.sizes.map((s) => `${s.label} — ${money(s.price)}`).join('<br>')],
      ['Ordering', 'Made to order — choose a pickup or delivery date at checkout'],
      ['Fulfillment', 'Pickup or Lalamove delivery'],
      ['Payment', '60% downpayment confirms the order'],
      ['Special requests', 'Add them in the order notes at checkout']
    ].filter(Boolean);
    return `<div class="pd-scroll">
      <section class="pd-gallery" aria-label="Product images">
        <div class="pd-hero" tabindex="0" aria-roledescription="carousel" aria-label="${esc(p.name)} images">
          ${hero}
          <div class="pd-float pd-float--left"><button type="button" class="pd-round" data-close aria-label="Back to products">${icon('back')}</button></div>
          <div class="pd-float pd-float--right">
            <button type="button" class="pd-round" data-share aria-label="Share ${esc(p.name)}">${icon('share')}</button>
            ${favButton(p, 'pd-round pd-round--fav')}
          </div>
          ${images.length > 1 ? `<button type="button" class="pd-arrow pd-arrow--prev" data-prev aria-label="Previous image">${icon('left')}</button><button type="button" class="pd-arrow pd-arrow--next" data-next aria-label="Next image">${icon('right')}</button>` : ''}
          ${images.length > 1 ? `<span class="pd-counter" aria-live="polite"><span data-counter>1</span>/${images.length}</span>` : ''}
        </div>
        ${images.length > 1 ? `<div class="pd-thumbs" role="list">${images.map((src, i) => `<button type="button" role="listitem" class="pd-thumb${i === 0 ? ' is-active' : ''}" data-thumb="${i}" aria-label="Show image ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      </section>
      <section class="pd-main">
        ${p.badge ? `<div class="pd-badges"><span class="pd-chip pd-chip--hot">${esc(p.badge)}</span>${category ? `<span class="pd-chip pd-chip--soft">${esc(category)}</span>` : ''}</div>` : category ? `<div class="pd-badges"><span class="pd-chip pd-chip--soft">${esc(category)}</span></div>` : ''}
        <h2 class="pd-title" id="pd-title">${esc(p.name)}</h2>
        <div class="pd-rating-row">${r && r.count ? `${icon('star', 'pd-star')}<b>${r.avg.toFixed(1)}</b><span>(${r.count} review${r.count === 1 ? '' : 's'})</span>` : '<span class="pd-muted">No reviews yet</span>'}</div>
        <div class="pd-price-row"><strong data-price>${money(size.price)}</strong>${p.sizes.length > 1 ? `<span class="pd-muted" data-size-label>${esc(size.label)}</span>` : ''}</div>
        <p class="pd-short">${esc(short)}</p>
        ${p.sizes.length > 1 ? `<div class="pd-options" role="radiogroup" aria-label="Choose an option">${p.sizes.map((s, i) => `<button type="button" role="radio" class="pd-option${i === 0 ? ' is-active' : ''}" data-size="${i}" aria-checked="${i === 0}"><span>${esc(s.label)}</span><small>${money(s.price)}</small></button>`).join('')}</div>` : ''}
        <ul class="pd-highlights">
          <li>${icon('clock')}<span>Made to Order</span></li>
          <li>${icon('chef')}<span>Baked from Scratch</span></li>
          <li>${icon('truck')}<span>Pickup or Delivery</span></li>
        </ul>
        ${window.LexcCupcake?.isDesignable(p.product_id) ? `<button type="button" class="pd-design" data-design="cupcake" data-product-id="${p.product_id}"><span aria-hidden="true" style="font-size:1.5rem">🧁</span><span><strong>Design your own</strong><span>Pick piping styles, colors and toppers, with a live box preview.</span></span></button>` : ''}
        ${window.LexcDonut?.isDesignable(p.product_id) ? `<button type="button" class="pd-design" data-design="donut" data-product-id="${p.product_id}"><span aria-hidden="true" style="font-size:1.5rem">🍩</span><span><strong>Design your own</strong><span>Pick glazes, sprinkles, fondant toppers and letters, in 3D.</span></span></button>` : ''}
        ${window.LexcBento?.isDesignable(p.product_id) ? '<button type="button" class="pd-design" data-design="bento"><span aria-hidden="true" style="font-size:1.5rem">🎨</span><span><strong>Design your own</strong><span>Pick colors, decorations and a message, with a live 3D preview.</span></span></button>' : ''}
      </section>
      <div class="pd-buy">
        <div class="pd-qty" role="group" aria-label="Quantity">
          <button type="button" data-less aria-label="Decrease quantity" disabled>${icon('minus')}</button>
          <output data-qty aria-live="polite">1</output>
          <button type="button" data-more aria-label="Increase quantity">${icon('plus')}</button>
        </div>
        <button type="button" class="pd-buy__add" data-buy>${icon('cart')}<span>Add to Cart</span></button>
        ${favButton(p, 'pd-buy__fav')}
      </div>
      <section class="pd-more">
        <div class="pd-tabs" role="tablist" aria-label="Product information">
          ${[['description', 'Description'], ['specifications', 'Specifications'], ['ingredients', 'Ingredients'], ['reviews', `Reviews${r && r.count ? ` (${r.count})` : ''}`]].map(([key, label]) => `<button type="button" role="tab" id="pd-tab-${key}" aria-controls="pd-panel-${key}" aria-selected="${key === 'description'}" tabindex="${key === 'description' ? 0 : -1}" data-tab="${key}">${label}</button>`).join('')}
        </div>
        <div class="pd-panel is-active" id="pd-panel-description" role="tabpanel" aria-labelledby="pd-tab-description">
          <h3>Description</h3><p>${esc(p.desc || 'Freshly made by LexC’s Snacktime.')}</p>
        </div>
        <div class="pd-panel" id="pd-panel-specifications" role="tabpanel" aria-labelledby="pd-tab-specifications">
          <h3>Specifications</h3><dl class="pd-specs">${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v.includes('<br>') ? v.split('<br>').map(esc).join('<br>') : esc(v)}</dd></div>`).join('')}</dl>
        </div>
        <div class="pd-panel" id="pd-panel-ingredients" role="tabpanel" aria-labelledby="pd-tab-ingredients">
          <h3>Ingredients</h3>
          <p class="pd-muted">A full ingredient list for this pastry isn’t published online yet. For allergens or dietary questions, message us before ordering.</p>
          <button type="button" class="pd-link" data-chat>${icon('chat')} Ask about ingredients</button>
        </div>
        <div class="pd-panel" id="pd-panel-reviews" role="tabpanel" aria-labelledby="pd-tab-reviews">
          <h3>Reviews ${r && r.count ? `<span class="pd-muted">(${r.count})</span>` : ''}</h3>
          <div class="pd-reviews" data-reviews><div class="pd-review pd-review--skeleton" aria-hidden="true"><span class="skel skel-circle"></span><span class="skel skel-line skel-line--long"></span></div></div>
        </div>
      </section>
      <aside class="pd-reco" aria-label="More pastries">
        ${related.length ? `<h3>Related Products</h3><div class="pd-reco__list">${related.map(miniMarkup).join('')}</div>` : ''}
        ${also.length ? `<h3>You May Also Like</h3><div class="pd-reco__list">${also.map(miniMarkup).join('')}</div>` : ''}
        ${!related.length && !also.length ? '<p class="pd-muted">More pastries are coming soon.</p>' : ''}
      </aside>
    </div>
    <button type="button" class="pd-close" data-close aria-label="Close product details">${icon('close')}</button>`;
  }

  function miniMarkup(p) {
    const img = imageOf(p);
    return `<article class="pd-mini">
      <button type="button" class="pd-mini__media" data-pd-open="${p.id}" aria-label="View details for ${esc(p.name)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">` : `<span class="pd-emoji" aria-hidden="true">${esc(p.emoji)}</span>`}</button>
      ${favButton(p, 'pd-fav pd-fav--mini')}
      <button type="button" class="pd-mini__name" data-pd-open="${p.id}">${esc(p.name)}</button>
      <div class="pd-mini__foot"><span class="pd-price">${priceLabel(p)}</span><button type="button" class="pd-add pd-add--mini" data-pd-add="${p.id}" aria-label="Add ${esc(p.name)} (${esc(p.sizes[0].label)}) to cart">${icon('plus', 'pd-add__plus')}</button></div>
    </article>`;
  }

  function current() { return products.find((x) => x.id === state.id); }
  function showImage(index) {
    const p = current(); const images = imagesOf(p);
    if (images.length < 2) return;
    state.img = (index + images.length) % images.length;
    const img = dialog.querySelector('[data-hero-img]');
    img.classList.add('is-switching');
    setTimeout(() => { img.src = images[state.img]; img.classList.remove('is-switching'); }, 120);
    dialog.querySelector('[data-counter]').textContent = state.img + 1;
    dialog.querySelectorAll('[data-thumb]').forEach((t, i) => t.classList.toggle('is-active', i === state.img));
  }
  function chooseSize(index) {
    const p = current(); const s = p.sizes[index]; if (!s) return;
    state.size = index;
    dialog.querySelectorAll('[data-size]').forEach((b, i) => { b.classList.toggle('is-active', i === index); b.setAttribute('aria-checked', String(i === index)); });
    dialog.querySelector('[data-price]').textContent = money(s.price);
    const label = dialog.querySelector('[data-size-label]'); if (label) label.textContent = s.label;
  }
  function setQty(value) {
    state.qty = Math.min(99, Math.max(1, value));
    dialog.querySelector('[data-qty]').textContent = state.qty;
    dialog.querySelector('[data-less]').disabled = state.qty <= 1;
    dialog.querySelector('[data-more]').disabled = state.qty >= 99;
  }
  function addFromDetail() {
    const button = dialog.querySelector('[data-buy]');
    button.disabled = true;
    const ok = addToCartById(state.id, state.size, state.qty);
    button.disabled = false;
    if (ok) { button.classList.remove('is-added'); void button.offsetWidth; button.classList.add('is-added'); }
  }
  function setTab(key) {
    state.tab = key;
    dialog.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === key; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    dialog.querySelectorAll('.pd-panel').forEach((panel) => panel.classList.toggle('is-active', panel.id === `pd-panel-${key}`));
  }
  async function share() {
    const p = current(); if (!p) return;
    const url = new URL(location.href); url.searchParams.set('product', p.product_id); url.hash = '';
    const data = { title: `${p.name} — LexC's Snacktime`, text: p.desc || p.name, url: url.toString() };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(data.url);
      showToast('Link copied — share it with anyone.');
    } catch (error) { if (error?.name !== 'AbortError') showToast('Could not share. Copy the address bar link instead.'); }
  }

  async function loadReviews(p) {
    const target = () => dialog.querySelector('[data-reviews]');
    const draw = (rows) => {
      const box = target(); if (!box || state.id !== p.id) return;
      if (!rows.length) { box.innerHTML = '<p class="pd-muted">No reviews yet. Reviews appear here after customers rate their completed orders.</p>'; return; }
      box.innerHTML = rows.map((r) => `<article class="pd-review">
          <span class="pd-avatar" aria-hidden="true">${esc((r.public_display_name || '?').trim().charAt(0).toUpperCase())}</span>
          <div><div class="pd-review__head"><strong>${esc(r.public_display_name)}</strong><span class="pd-review__stars" aria-label="${r.rating} out of 5 stars">${Array.from({ length: 5 }, (_, i) => icon('star', `pd-star${i < r.rating ? '' : ' is-empty'}`)).join('')}</span></div>
          <time class="pd-muted" datetime="${esc(r.created_at)}">${new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(r.created_at))}</time>
          ${r.review_text ? `<p>${esc(r.review_text)}</p>` : ''}</div></article>`).join('') + (rows.length > 3 ? '<button type="button" class="pd-link" data-see-all>See all reviews</button>' : '');
    };
    if (state.reviews.has(p.product_id)) return draw(state.reviews.get(p.product_id));
    try {
      const rows = await LexcBackend.rpc('get_product_reviews', { target_product: p.product_id, max_rows: 20 });
      state.reviews.set(p.product_id, rows || []);
      draw(rows || []);
    } catch (error) {
      const box = target(); if (!box || state.id !== p.id) return;
      console.info('Reviews unavailable:', error?.message || error);
      box.innerHTML = '<p class="pd-muted">Reviews could not load right now.</p><button type="button" class="pd-link" data-retry-reviews>Try again</button>';
      box.querySelector('[data-retry-reviews]').onclick = () => loadReviews(p);
    }
  }

  // Deep link: ?product=<uuid> opens that product once the catalog is ready.
  let deepLinkDone = false;
  function maybeOpenDeepLink() {
    if (deepLinkDone || window.lexcCatalogState !== 'ready') return;
    deepLinkDone = true;
    const wanted = new URL(location.href).searchParams.get('product');
    const p = wanted && products.find((x) => x.product_id === wanted);
    if (!p) {
      // A link to a treat that is no longer on the menu: say so once and drop it from the address bar.
      if (wanted) { const url = new URL(location.href); url.searchParams.delete('product'); history.replaceState(history.state, '', url); showToast('That treat is no longer on the menu.'); }
      return;
    }
    if (!document.getElementById('page-shop')?.classList.contains('active')) navigate('shop');
    history.replaceState({ ...(history.state || {}), lexcProduct: p.product_id }, '', location.href);
    openProductDetails(p.id, { fromHistory: true });
  }

  if (window.lexcCatalogState) renderShop();
})();
