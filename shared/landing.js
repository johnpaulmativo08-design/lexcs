// LexC's landing page: treat filter, links to the real catalog products, and the latest store updates.
// Product cards open the existing product page (same as ?product=<id>); nothing here changes cart,
// pricing or checkout. The updates come from get_store_feed, which only returns published posts.
(() => {
  const page = document.getElementById('page-home');
  if (!page || !page.classList.contains('lp')) return;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const grid = page.querySelector('[data-lp-grid]');
  const status = page.querySelector('[data-lp-status]');
  const empty = page.querySelector('[data-lp-empty]');
  const plainClick = (e) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1);
  const year = page.querySelector('[data-lp-year]'); if (year) year.textContent = String(new Date().getFullYear());

  // ---- Filter chips (All treats / Cakes / Baked treats / Party treats) ------------------------------
  const NAMES = { all: 'treats', cakes: 'cakes', baked: 'baked treats', party: 'party treats' };
  function filter(group) {
    page.querySelectorAll('.lp-chips [data-lp-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lpFilter === group)));
    let shown = 0;
    grid.querySelectorAll('.lp-card').forEach((card) => { const on = group === 'all' || card.dataset.group === group; card.hidden = !on; if (on) shown += 1; });
    grid.classList.toggle('is-filtered', group !== 'all');
    empty.hidden = shown > 0;
    status.textContent = `Showing ${shown} ${NAMES[group] || 'treats'}`;
  }

  // ---- Product links: resolve each card's slug to the live catalog product -------------------------
  function resolveProducts() {
    const catalog = typeof liveCatalog !== 'undefined' ? liveCatalog : [];
    grid.querySelectorAll('[data-lp-product]').forEach((card) => {
      const p = catalog.find((x) => x.slug === card.dataset.slug);
      if (p) { card.dataset.productId = p.id; card.href = `?product=${encodeURIComponent(p.id)}`; }
      else { card.removeAttribute('data-product-id'); card.href = '#'; }
    });
    // Yema cake uses the store's own catalog photo.
    const yema = catalog.find((x) => x.slug === 'product-4'), box = grid.querySelector('[data-lp-catalog-photo]');
    if (box && yema?.image_path && !box.querySelector('img')) {
      box.innerHTML = `<img src="${esc(LexcBackend.mediaURL(yema.image_path))}" width="280" height="280" loading="lazy" decoding="async" alt="Yema cake from LexC’s">`;
    }
  }
  function openProduct(card) {
    const id = card.dataset.productId;
    const p = id && typeof products !== 'undefined' ? products.find((x) => x.product_id === id) : null;
    navigate('shop');
    if (p) openProductDetails(p.id);
    else if (window.lexcCatalogState === 'ready') showToast(`${card.querySelector('.lp-card-name')?.firstChild?.textContent.trim() || 'This treat'} isn’t on the menu right now.`);
  }

  page.addEventListener('click', (e) => {
    const f = e.target.closest('[data-lp-filter]'); if (f) return filter(f.dataset.lpFilter);
    if (!plainClick(e)) return;   // let Ctrl/⌘-click open real links in a new tab
    const go = e.target.closest('[data-lp-page]'); if (go) { e.preventDefault(); return navigate(go.dataset.lpPage); }
    const card = e.target.closest('[data-lp-product]'); if (card) { e.preventDefault(); return openProduct(card); }
    const post = e.target.closest('[data-lp-post]');
    if (post && window.LexcFresh?.open) { e.preventDefault(); window.LexcFresh.open(post.dataset.lpPost); }
  });

  // ---- Fresh from LexC's: newest published photo posts, those featuring a product first -------------
  const fresh = page.querySelector('[data-lp-fresh]'), list = fresh?.querySelector('[data-lp-fresh-list]');
  const titleOf = (caption) => {
    const line = String(caption || '').split('\n').map((s) => s.trim()).find(Boolean) || 'A fresh update from our kitchen';
    return line.length > 70 ? line.slice(0, 67).replace(/\s+\S*$/, '') + '…' : line;
  };
  async function loadFresh() {
    if (!fresh) return;
    fresh.hidden = false;
    list.innerHTML = '<div class="lp-update-skel" aria-hidden="true"></div>'.repeat(3);
    list.setAttribute('aria-busy', 'true');
    try {
      const rows = await LexcBackend.rpc('get_store_feed', { p_kind: 'photos', p_limit: 12 });
      const photos = (rows || []).filter((r) => r.media_kind === 'image' && r.media_path);
      const chosen = [...photos.filter((r) => r.product), ...photos.filter((r) => !r.product)].slice(0, 3);
      if (!chosen.length) { fresh.hidden = true; return; }
      const { data, error } = await LexcBackend.client.storage.from('post-media').createSignedUrls(chosen.map((r) => r.media_path), 3600);
      if (error) throw error;
      const urls = new Map((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
      list.innerHTML = chosen.map((r) => `<a class="lp-update" href="?post=${encodeURIComponent(r.id)}" data-lp-post="${esc(r.id)}">
          <span class="lp-update-img">${urls.get(r.media_path) ? `<img src="${esc(urls.get(r.media_path))}" width="${Number(r.media_width) || 600}" height="${Number(r.media_height) || 600}" loading="lazy" decoding="async" alt="${esc(r.media_alt || (r.product ? r.product.name : 'Photo from LexC’s kitchen'))}">` : ''}</span>
          <span class="lp-update-text">${r.product ? `<span class="lp-update-tag">${esc(r.product.name.split('–')[0].trim())}</span>` : ''}<span class="lp-update-title">${esc(titleOf(r.caption))}</span>
          <span class="lp-arrow" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></span></a>`).join('');
    } catch (error) {
      console.info('Store updates could not load:', error?.message || error);
      fresh.hidden = true;
    } finally { list.removeAttribute('aria-busy'); }
  }

  filter('all');
  if (window.lexcCatalogState === 'ready') resolveProducts();
  document.addEventListener('lexc:catalog-ready', resolveProducts);
  loadFresh();
})();
