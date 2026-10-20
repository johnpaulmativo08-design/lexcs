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
  page.prepend(head); // on the page first, so the moved controls can still be found by id
  const greet = head.querySelector('.mx-greet'), headTop = make('div', 'mx-head-top');
  greet.before(headTop); headTop.append(greet, buildBell());
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


  // 3. Hero (the existing carousel) and the round category picks right below it
  carousel.classList.add('mx-hero');
  const catNav = make('div', 'mx-cats'); // not <nav>: the site styles every nav as the fixed top bar
  catNav.setAttribute('role', 'navigation');
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
  // (the list is rebuilt from the live categories as "Name <span>count</span>", so each button is decorated once, whenever it is new)
  function decorateCategories() {
    if (typeof products === 'undefined' || !products.length) return;
    cats.querySelectorAll('.filter-item').forEach((button) => {
      if (button.querySelector('.mx-cat-art')) return;
      const cat = button.dataset.cat, count = button.querySelector('.filter-count') || button.querySelector('span:last-child');
      const label = button.textContent.replace(count?.textContent || '', '').replace(/^[^A-Za-z]+/, '').trim().replace(/^All Items$/, 'All');
      const emoji = (button.textContent.trim().match(/^[^A-Za-zs]+/) || ['🧁'])[0];
      const pick = products.find((p) => (cat === 'all' || p.cat === cat) && PRODUCT_IMAGES[p.id]);
      const art = pick ? '<img src="' + esc(PRODUCT_IMAGES[pick.id]) + '" alt="" loading="lazy" decoding="async">' : '<span aria-hidden="true">' + esc(emoji) + '</span>';
      button.innerHTML = '<span class="mx-cat-art">' + art + '</span><span class="mx-cat-name">' + esc(label) + '</span>';
      if (count) { count.classList.add('mx-cat-count'); count.prepend(' ('); count.append(' items)'); button.append(count); }
      button.querySelector('img')?.addEventListener('error', (event) => { event.currentTarget.replaceWith(Object.assign(document.createElement('span'), { textContent: emoji })); }, { once: true });
    });
  }
  // ---- Notifications bell: built from the customer's own orders (what changed and what to do next).
  // Read/unread is remembered on this device. Guests don't see the bell.
  const SEEN_KEY = 'lexc_seen_notes_v1';
  const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); } };
  var notes = [], notesLoadedAt = 0, bell, panel; // var: buildBell() runs before this line
  function buildBell() {
    const wrap = make('div', 'mx-bell-wrap',
      '<button type="button" class="mx-bell" aria-expanded="false" aria-controls="mxNotes" aria-label="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg><span class="mx-bell-count" hidden></span></button>' +
      '<div class="mx-notes" id="mxNotes" role="region" aria-label="Notifications" hidden><div class="mx-notes-head"><strong>Notifications</strong><button type="button" class="mx-notes-close" aria-label="Close notifications">×</button></div><div class="mx-notes-list" role="list"></div></div>');
    wrap.hidden = true;
    bell = wrap.querySelector('.mx-bell'); panel = wrap.querySelector('.mx-notes');
    const toggle = (open) => {
      panel.hidden = !open; bell.setAttribute('aria-expanded', String(open));
      if (open) { renderNotes(); try { localStorage.setItem(SEEN_KEY, JSON.stringify(notes.map((n) => n.key))); } catch { /* private mode */ } updateCount(); panel.querySelector('a,button')?.focus(); }
    };
    bell.addEventListener('click', () => toggle(panel.hidden));
    wrap.querySelector('.mx-notes-close').addEventListener('click', () => { toggle(false); bell.focus(); });
    document.addEventListener('click', (event) => { if (!panel.hidden && !wrap.contains(event.target)) toggle(false); });
    wrap.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.hidden) { toggle(false); bell.focus(); } });
    return wrap;
  }
  // one note per order: its current state and the next step
  function noteFor(o) {
    const n = 'Order #' + o.order_number, pay = 'payment/index.html?order=' + encodeURIComponent(o.id), chat = 'chat/?order=' + encodeURIComponent(o.id);
    if (o.status === 'cancelled') return ['cancelled', '✕', n + ' was cancelled.', 'If you already paid, message LexC’s.', chat];
    if (o.status === 'completed') return ['completed', '★', n + ' is complete.', 'Enjoy! You can now rate your treats.', pay];
    if (o.status === 'ready') return ['ready', '✓', n + ' is ready.', o.fulfillment_method === 'pickup' ? 'Ready for pickup at your reserved time.' : 'Ready for delivery at your reserved time.', pay];
    if (o.payment_status === 'rejected') return ['pay-rejected', '!', 'Payment for ' + n + ' needs attention.', 'Your proof was not accepted. Open the order to try again.', pay];
    if (o.status === 'preparing') return ['preparing', '🧁', 'We started making ' + n + '.', 'Your treats are being prepared.', pay];
    if (o.payment_status === 'paid') return ['paid', '✓', 'Payment verified for ' + n + '.', 'Fully paid. Thank you!', pay];
    if (o.payment_status === 'partially_paid') return ['part', '✓', 'Downpayment verified for ' + n + '.', 'The rest is paid later.', pay];
    if (o.payment_status === 'verification_pending') return ['review', '◷', 'We received your payment proof for ' + n + '.', 'LexC’s is checking it.', pay];
    if (o.status !== 'pending') return ['confirmed', '✓', n + ' is confirmed.', 'You can pay the downpayment or full amount now.', pay];
    return ['pending', '⋯', n + ' was received.', 'Waiting for LexC’s to confirm it.', pay];
  }
  async function loadNotes() {
    const user = typeof currentUser !== 'undefined' ? currentUser : null;
    bell.closest('.mx-bell-wrap').hidden = !user;
    if (!user || Date.now() - notesLoadedAt < 60000) return;
    notesLoadedAt = Date.now();
    try {
      const orders = (await LexcBackend.orders()).filter((o) => o.customer_id === user.id);
      notes = orders.map((o) => { const [state, mark, title, text, href] = noteFor(o); return { key: o.id + ':' + state, state, mark, title, text, href, at: o.updated_at || o.created_at }; })
        .sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 12);
      updateCount(); if (!panel.hidden) renderNotes();
    } catch (error) { notesLoadedAt = 0; console.info('Notifications unavailable:', error?.message || error); }
  }
  function updateCount() {
    const seen = readSeen(), unread = notes.filter((n) => !seen.has(n.key)).length, badge = bell.querySelector('.mx-bell-count');
    badge.hidden = !unread; badge.textContent = unread > 9 ? '9+' : String(unread);
    bell.setAttribute('aria-label', unread ? 'Notifications, ' + unread + ' new' : 'Notifications');
  }
  function renderNotes() {
    const when = (v) => { const m = Math.round((Date.now() - new Date(v)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(v).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }); };
    const seen = readSeen();
    panel.querySelector('.mx-notes-list').innerHTML = notes.length
      ? notes.map((n) => '<a role="listitem" class="mx-note is-' + n.state + (seen.has(n.key) ? '' : ' is-new') + '" href="' + esc(n.href) + '"><span class="mx-note-mark" aria-hidden="true">' + n.mark + '</span><span><strong>' + esc(n.title) + '</strong><small>' + esc(n.text) + '</small><time>' + esc(when(n.at)) + '</time></span></a>').join('')
      : '<p class="mx-notes-empty">No updates yet. Your order updates will show here.</p>';
  }

  // ---- "New on the menu": the newest active product takes the promo card's place
  let newCard = false;
  function showNewProduct() {
    if (newCard || typeof products === 'undefined' || !products.length || typeof liveCatalog === 'undefined' || !liveCatalog.length) return;
    const promo = page.querySelector('.mx-offer'); if (!promo) return;
    const newest = [...liveCatalog].filter((row) => row.created_at).sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
      .map((row) => products.find((p) => p.product_id === row.id)).find(Boolean);
    if (!newest) return;
    newCard = true;
    const img = PRODUCT_IMAGES[newest.id], from = Math.min(...newest.sizes.map((x) => x.price));
    promo.classList.add('mx-new');
    promo.innerHTML = '<div class="mx-new-copy"><div class="mx-new-eyebrow">New on the menu</div><h3>' + esc(newest.name) + '</h3><p>' + esc(newest.desc || 'Freshly added. Made to order for your date.') + '</p><button type="button" class="btn-primary mx-offer-btn" data-pd-open="' + newest.id + '">Try it · ' + (newest.sizes.length > 1 ? 'from ' : '') + esc(checkoutMoney(from).replace('.00', '')) + '</button></div>' +
      (img ? '<button type="button" class="mx-new-photo" data-pd-open="' + newest.id + '" aria-label="View ' + esc(newest.name) + '"><img src="' + esc(img) + '" alt="" loading="lazy" decoding="async"><span class="mx-new-tag">New</span></button>' : '');
  }

  function refresh() {
    decorateCategories();
    showNewProduct();
    loadNotes();
    const active = cats.querySelector('.filter-item.active .mx-cat-name')?.textContent || 'All';
    const query = document.getElementById('shopSearch')?.value.trim();
    page.querySelector('[data-mx-title]').textContent = query ? 'Search results' : active === 'All' ? 'Popular treats' : active;
    const name = typeof currentUser !== 'undefined' && currentUser ? String(currentUser.name || currentUser.user_metadata?.full_name || '').trim().split(/\s+/)[0] : '';
    page.querySelector('[data-mx-hello]').firstChild.textContent = 'Hello, ' + (name || 'sweet tooth') + ' ';
  }
  const original = window.renderShop;
  window.renderShop = function renderShopWithMenuLayout(...args) { const result = original.apply(this, args); try { refresh(); } catch (error) { console.warn('Menu layout:', error); } return result; };
  // signing in or out updates the greeting and the bell
  if (typeof window.updateNavAuth === 'function') { const nav = window.updateNavAuth; window.updateNavAuth = function (...args) { const r = nav.apply(this, args); try { notesLoadedAt = 0; refresh(); } catch { /* menu not ready */ } return r; }; }
  refresh();
})();
// Deep link: ?menu=1 opens the Menu page (like ?fresh=1 for Sweet moments).
(function () {
  const params = new URLSearchParams(location.search);
  if (!params.has('menu')) return;
  const url = new URL(location.href); url.searchParams.delete('menu'); history.replaceState(history.state, '', url);
  const go = () => window.navigate?.('shop');
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
})();
