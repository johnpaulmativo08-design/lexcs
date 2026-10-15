// Menu page layout (app-style): greeting header, search with a filter button, rounded hero, round category
// picks with photos, a "Popular treats" heading and an offer card. It only moves and decorates the existing
// Menu elements (same ids and listeners), so search, categories, price range, sort, cart and favorites work
// exactly as before. Loaded after shared/product-detail.js.
(function () {
  const page = document.getElementById('page-shop');
  if (!page || page.classList.contains('mx')) return;
  const $ = (sel) => page.querySelector(sel);
  const make = (tag, cls, html) => { const node = document.createElement(tag); node.className = cls; if (html) node.innerHTML = html; return node; };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const carousel = document.getElementById('shopCarousel'), wrapper = $('.shop-wrapper'), sidebar = wrapper?.querySelector('.sidebar');
  const searchWrap = $('.shop-search-wrap'), top = $('.products-top'), grid = document.getElementById('productsGrid'), cats = document.getElementById('catFilters');
  if (!carousel || !wrapper || !sidebar || !searchWrap || !top || !grid || !cats) return;
  page.classList.add('mx');

  // 1. Greeting + search + filter button
  const head = make('section', 'mx-head',
    '<div class="mx-greet"><p class="mx-hello" data-mx-hello>Hello, sweet tooth <span aria-hidden="true">👋</span></p>' +
    '<h1 class="mx-title">What are you <em>craving</em> today?</h1><p class="mx-sub">Freshly baked to order · pickup or delivery</p></div>');
  const row = make('div', 'mx-search');
  const filterButton = make('button', 'mx-filter-btn',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg><span class="mx-filter-dot" hidden></span>');
  filterButton.type = 'button';
  filterButton.setAttribute('aria-label', 'Filters and sort');
  filterButton.setAttribute('aria-controls', 'mxFilters');
  filterButton.setAttribute('aria-expanded', 'false');
  row.append(searchWrap, filterButton);
  head.append(row);

  // 2. Filters panel (price range + sort), opened from the filter button
  sidebar.id = 'mxFilters';
  sidebar.classList.add('mx-filters');
  sidebar.hidden = true;
  const catSection = cats.closest('.sidebar-section');
  const sortSelect = document.getElementById('sortSelect');
  const sortSection = make('div', 'sidebar-section', '<div class="sidebar-title"><label for="sortSelect">Sort by</label></div>');
  sortSection.append(sortSelect);
  sidebar.append(sortSection);
  const resetRow = make('div', 'mx-filters-actions', '<button type="button" class="mx-reset">Reset</button><button type="button" class="mx-done">Show results</button>');
  sidebar.append(resetRow);
  head.append(sidebar);
  const priceRange = document.getElementById('priceRange');
  const syncDot = () => { filterButton.querySelector('.mx-filter-dot').hidden = Number(priceRange.value) >= Number(priceRange.max) && sortSelect.value === 'default'; };
  const toggleFilters = (open) => {
    sidebar.hidden = !open; filterButton.setAttribute('aria-expanded', String(open)); filterButton.classList.toggle('is-open', open);
    if (open) sidebar.querySelector('input,select,button')?.focus();
  };
  filterButton.addEventListener('click', () => toggleFilters(sidebar.hidden));
  resetRow.querySelector('.mx-done').addEventListener('click', () => { toggleFilters(false); filterButton.focus(); grid.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  resetRow.querySelector('.mx-reset').addEventListener('click', () => {
    priceRange.value = priceRange.max; priceRange.dispatchEvent(new Event('input', { bubbles: true }));
    sortSelect.value = 'default'; sortSelect.dispatchEvent(new Event('change', { bubbles: true })); syncDot();
  });
  priceRange.addEventListener('input', syncDot); sortSelect.addEventListener('change', syncDot);
  sidebar.addEventListener('keydown', (event) => { if (event.key === 'Escape') { toggleFilters(false); filterButton.focus(); } });

  page.prepend(head);

  // 3. Hero (the existing carousel) and the round category picks right below it
  carousel.classList.add('mx-hero');
  const catNav = make('nav', 'mx-cats');
  catNav.setAttribute('aria-label', 'Categories');
  catNav.append(cats);
  catSection?.remove();
  carousel.after(catNav);

  // 4. Section heading over the grid
  const heading = make('div', 'mx-section-head', '<h2 class="mx-section-title" data-mx-title>Popular treats</h2>');
  top.prepend(heading);
  heading.append(document.getElementById('resultsCount'));

  // 5. The package promo becomes an offer card
  const promo = grid.nextElementSibling;
  if (promo && promo.tagName === 'DIV' && /Package Series/.test(promo.textContent)) {
    promo.removeAttribute('style');
    promo.className = 'mx-offer';
    promo.querySelectorAll('[style]').forEach((node) => node.removeAttribute('style'));
    promo.querySelector('button')?.classList.add('mx-offer-btn');
    promo.insertAdjacentHTML('beforeend', '<span class="mx-offer-art" aria-hidden="true">🎁</span>');
  }

  // Category picks: a photo of a treat from each category, the name, and the count for screen readers
  let decorated = false;
  function decorateCategories() {
    if (decorated || typeof products === 'undefined' || !products.length) return;
    decorated = true;
    cats.querySelectorAll('.filter-item').forEach((button) => {
      const cat = button.dataset.cat, count = button.querySelector('.filter-count');
      const label = button.textContent.replace(count?.textContent || '', '').replace(/^[^A-Za-z]+/, '').trim().replace(/^All Items$/, 'All');
      const emoji = (button.textContent.trim().match(/^[^A-Za-z\s]+/) || ['🧁'])[0];
      const pick = products.find((p) => (cat === 'all' || p.cat === cat) && PRODUCT_IMAGES[p.id]);
      const art = pick ? '<img src="' + esc(PRODUCT_IMAGES[pick.id]) + '" alt="" loading="lazy" decoding="async">' : '<span aria-hidden="true">' + esc(emoji) + '</span>';
      button.innerHTML = '<span class="mx-cat-art">' + art + '</span><span class="mx-cat-name">' + esc(label) + '</span>';
      if (count) { count.classList.add('mx-cat-count'); button.append(count); }
      button.querySelector('img')?.addEventListener('error', (event) => { event.currentTarget.replaceWith(Object.assign(document.createElement('span'), { textContent: emoji })); }, { once: true });
    });
  }
  function refresh() {
    decorateCategories();
    const active = cats.querySelector('.filter-item.active .mx-cat-name')?.textContent || 'All';
    const query = document.getElementById('shopSearch')?.value.trim();
    page.querySelector('[data-mx-title]').textContent = query ? 'Search results' : active === 'All' ? 'Popular treats' : active;
    const name = typeof currentUser !== 'undefined' && currentUser ? String(currentUser.name || currentUser.user_metadata?.full_name || '').trim().split(/\s+/)[0] : '';
    page.querySelector('[data-mx-hello]').firstChild.textContent = 'Hello, ' + (name || 'sweet tooth') + ' ';
  }
  const original = window.renderShop;
  window.renderShop = function renderShopWithMenuLayout(...args) { const result = original.apply(this, args); try { refresh(); } catch (error) { console.warn('Menu layout:', error); } return result; };
  refresh();
})();
