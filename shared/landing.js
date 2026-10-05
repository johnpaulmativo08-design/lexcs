// LexC's landing page: links to the real catalog products, the featured-product stage, scroll reveals, the
// recent-creations gallery (published Updates photos) and the header's top-of-page state. Product links open
// the existing product page (same as ?product=<id>); nothing here changes cart, pricing or checkout.
(() => {
  const page = document.getElementById('page-home');
  if (!page || !page.classList.contains('lp')) return;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plainClick = (e) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const ARROW = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const year = page.querySelector('[data-lp-year]'); if (year) year.textContent = String(new Date().getFullYear());
  document.documentElement.classList.add('ed-js');

  // ---- Product links: resolve each slug to the live catalog product ----------------------------------
  function resolveProducts() {
    const catalog = typeof liveCatalog !== 'undefined' ? liveCatalog : [];
    page.querySelectorAll('[data-lp-product]').forEach((link) => {
      const p = catalog.find((x) => x.slug === link.dataset.slug);
      if (p) { link.dataset.productId = p.id; link.href = `?product=${encodeURIComponent(p.id)}`; }
      else { link.removeAttribute('data-product-id'); link.href = '#'; }
    });
  }
  function openProduct(link) {
    const id = link.dataset.productId;
    const p = id && typeof products !== 'undefined' ? products.find((x) => x.product_id === id) : null;
    navigate('shop');
    if (p) openProductDetails(p.id);
    else if (window.lexcCatalogState === 'ready') showToast(`${link.dataset.name || 'This treat'} isn’t on the menu right now.`);
  }
  page.addEventListener('click', (e) => {
    if (!plainClick(e)) return;   // Ctrl/⌘-click opens real links in a new tab
    const go = e.target.closest('[data-lp-page]'); if (go) { e.preventDefault(); return navigate(go.dataset.lpPage); }
    const link = e.target.closest('[data-lp-product]'); if (link) { e.preventDefault(); return openProduct(link); }
    const post = e.target.closest('[data-lp-post]');
    if (post && window.LexcFresh?.open) { e.preventDefault(); window.LexcFresh.open(post.dataset.lpPost); }
  });

  // ---- Product stage: one featured treat at a time; the headline never moves ---------------------------
  const stage = page.querySelector('[data-ed-stage]');
  if (stage) {
    const items = [...stage.querySelectorAll('.ed-stage-item')], thumbs = [...stage.querySelectorAll('[data-ed-go]')];
    const label = stage.querySelector('.ed-stage-label'), name = stage.querySelector('[data-ed-name]'), note = stage.querySelector('[data-ed-note]');
    let index = 0, timer = null, userPaused = false, inView = false;
    const show = (next) => {
      next = (next + items.length) % items.length; if (next === index) return;
      const old = items[index], cur = items[next];
      old.classList.remove('is-active'); old.classList.add('is-leaving'); old.setAttribute('aria-hidden', 'true'); old.tabIndex = -1;
      setTimeout(() => old.classList.remove('is-leaving'), 600);
      cur.classList.add('is-active'); cur.removeAttribute('aria-hidden'); cur.removeAttribute('tabindex');
      thumbs.forEach((t, i) => t.setAttribute('aria-pressed', String(i === next)));
      name.textContent = cur.dataset.name; note.textContent = cur.dataset.note || '';
      if (!reduced.matches) { label.classList.remove('is-swapping'); void label.offsetWidth; label.classList.add('is-swapping'); }
      index = next;
    };
    const stop = () => { clearInterval(timer); timer = null; };
    const start = () => { stop(); if (!userPaused && inView && !document.hidden && !reduced.matches) timer = setInterval(() => show(index + 1), 3600); };
    const userMove = (fn) => { userPaused = true; stop(); fn(); };   // manual control stops the rotation
    stage.addEventListener('click', (e) => {
      const step = e.target.closest('[data-ed-step]'); if (step) return userMove(() => show(index + Number(step.dataset.edStep)));
      const go = e.target.closest('[data-ed-go]'); if (go) return userMove(() => show(Number(go.dataset.edGo)));
    });
    stage.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); userMove(() => show(index + (e.key === 'ArrowRight' ? 1 : -1))); } });
    stage.addEventListener('pointerenter', stop); stage.addEventListener('pointerleave', start);
    stage.addEventListener('focusin', stop); stage.addEventListener('focusout', start);
    // swipe on touch screens
    let sx = null, sy = 0;
    const frame = stage.querySelector('.ed-stage-frame');
    frame.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    frame.addEventListener('touchend', (e) => {
      if (sx === null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) userMove(() => show(index + (dx < 0 ? 1 : -1)));
    });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    reduced.addEventListener?.('change', start);
    if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { inView = en.isIntersecting; inView ? start() : stop(); }, { threshold: .35 }).observe(stage);
  }

  // ---- Scroll reveals: whole groups fade up once; children of a group are staggered ----------------------
  const revealIn = (el) => el.classList.add('is-in');
  page.querySelectorAll('[data-reveal-group]').forEach((g) => [...g.children].forEach((c, i) => c.style.setProperty('--i', `${Math.min(i, 6) * 70}ms`)));
  const targets = page.querySelectorAll('[data-reveal], [data-reveal-group]');
  if (!('IntersectionObserver' in window) || reduced.matches) targets.forEach(revealIn);
  else {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { revealIn(en.target); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: .12 });
    targets.forEach((t) => io.observe(t));
  }
  // anything appended later (the gallery) reveals with its group
  const revealNew = (el) => { if (el.classList.contains('is-in')) return; [...el.children].forEach((c, i) => c.style.setProperty('--i', `${Math.min(i, 6) * 70}ms`)); };

  // ---- Recent creations: newest published Updates photos; real product photos fill any gap ---------------
  const gallery = page.querySelector('[data-lp-fresh]'), grid = gallery?.querySelector('[data-lp-fresh-list]');
  const FALLBACK = [
    ['g-red-cake', 'A red “Twenty Two” bento cake tied with black ribbon bows', 'product-8', 'Bento cake'],
    ['g-babyboy', 'Blue mini donuts spelling “A baby boy on the way”', 'product-3', 'Themed mini donuts'],
    ['g-pops', 'Character cake pops for a seventh birthday', 'cake-pops', 'Cake pops'],
    ['g-blue-cupcakes', 'Chocolate cupcakes piped with blue and white swirls', 'product-6', 'Cupcakes'],
    ['g-donut-tower', 'A tower of pink and purple mini donuts with butterfly wings', 'product-2', 'Mini donuts'],
    ['g-tower', 'A brownie tower with gold balls and a Happy Birthday topper', 'product-21', 'Brownies tower'],
  ];
  const titleOf = (caption) => {
    const line = String(caption || '').split('\n').map((s) => s.trim()).find(Boolean) || 'A fresh update from our kitchen';
    return line.length > 70 ? line.slice(0, 67).replace(/\s+\S*$/, '') + '…' : line;
  };
  const fallbackTile = ([file, alt, slug, label]) => `<a class="ed-g" href="?product=" data-lp-product data-slug="${slug}" data-name="${esc(label)}"><img src="assets/landing/ed/${file}-700.webp" width="700" height="700" loading="lazy" decoding="async" alt="${esc(alt)}"><span class="ed-g-cap">${esc(label)}</span></a>`;
  async function loadGallery() {
    if (!grid) return;
    let tiles = [];
    try {
      const rows = await LexcBackend.rpc('get_store_feed', { p_kind: 'photos', p_limit: 24 });
      // only posts tagged with a product count as creations (personal or general posts stay on the Updates page)
      const photos = (rows || []).filter((r) => r.media_kind === 'image' && r.media_path && r.product).slice(0, 6);
      if (photos.length) {
        const { data, error } = await LexcBackend.client.storage.from('post-media').createSignedUrls(photos.map((r) => r.media_path), 3600);
        if (error) throw error;
        const urls = new Map((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
        tiles = photos.filter((r) => urls.get(r.media_path)).map((r) => `<a class="ed-g" href="?post=${encodeURIComponent(r.id)}" data-lp-post="${esc(r.id)}"><img src="${esc(urls.get(r.media_path))}" width="${Number(r.media_width) || 700}" height="${Number(r.media_height) || 700}" loading="lazy" decoding="async" alt="${esc(r.media_alt || titleOf(r.caption))}"><span class="ed-g-cap">${esc(titleOf(r.caption))}</span></a>`);
      }
    } catch (error) { console.info('Recent creations: showing product photos.', error?.message || error); }
    for (const f of FALLBACK) { if (tiles.length >= 6) break; tiles.push(fallbackTile(f)); }
    grid.innerHTML = tiles.join('');
    grid.removeAttribute('aria-busy');
    grid.setAttribute('data-reveal-group', ''); revealNew(grid);
    requestAnimationFrame(() => revealIn(grid));
    resolveProducts();
  }

  // ---- Header: lighter at the very top of the home page ------------------------------------------------------
  const nav = document.getElementById('mainNav');
  const syncNav = () => nav?.classList.toggle('is-top', page.classList.contains('active') && window.scrollY < 12);
  addEventListener('scroll', syncNav, { passive: true });
  new MutationObserver(syncNav).observe(page, { attributes: true, attributeFilter: ['class'] });
  syncNav();

  if (window.lexcCatalogState === 'ready') resolveProducts();
  document.addEventListener('lexc:catalog-ready', resolveProducts);
  loadGallery();
})();
