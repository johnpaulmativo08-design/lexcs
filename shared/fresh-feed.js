// Fresh from LexC's: customer feed of photos, short videos and store updates, plus the owner's
// Facebook-style "Create post" composer. Loaded after the storefront scripts. It reuses the existing
// catalog (liveCatalog/products), product detail (openProductDetails), navigation (navigate) and auth
// (currentUser); it never touches the cart, checkout or orders. The database enforces every permission
// (see database/phase30-store-posts.sql); owner controls here are only a convenience.
(() => {
  const BUCKET = 'post-media';
  const PAGE_SIZE = 12;
  const CAPTION_MAX = 2200;
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
  const IMAGE_MAX_INPUT = 20 * 1024 * 1024, IMAGE_MAX = 8 * 1024 * 1024, VIDEO_MAX = 50 * 1024 * 1024, VIDEO_MAX_SECONDS = 600;
  const KINDS = [['all', 'All'], ['photos', 'Photos'], ['videos', 'Videos'], ['updates', 'Updates']];
  const EMPTY = {
    all: ['Nothing fresh yet', 'New treats, kitchen moments and store updates will appear here soon.'],
    photos: ['No photos yet', 'Snack photos will show up here.'], videos: ['No videos yet', 'Short kitchen videos will show up here.'],
    updates: ['No updates yet', 'Store news and announcements will show up here.'],
    reviews: ['No reviews yet', 'Customers can rate their orders from My Orders once they are fully paid. Approved reviews appear here.']
  };
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="M18 6 6 18M6 6l12 12"/>', back: '<path d="m15 18-6-6 6-6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r=".5"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    arrow: '<path d="M7 17 17 7M8 7h9v9"/>', check: '<path d="M20 6 9 17l-5-5"/>', bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>'
  };
  const icon = (name, cls = 'ui-icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const esc = (value) => authEscape(String(value ?? ''));
  const money = (value) => checkoutMoney(value).replace('.00', '');
  const client = () => LexcBackend.client;
  const isOwner = () => window.currentUser?.role === 'admin';
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---- Shared helpers ------------------------------------------------------------------------
  const logo = document.querySelector('.nav-logo img')?.src;
  if (logo) document.documentElement.style.setProperty('--fresh-logo', `url("${logo}")`);
  const avatar = (extra = '') => `<span class="fresh-avatar${extra}" aria-hidden="true" style="${logo ? 'background-image:var(--fresh-logo);color:transparent' : ''}">L</span>`;
  const timeFull = (iso) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));
  function timeAgo(iso) {
    const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'Just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }).format(d);
  }
  const timeTag = (post) => {
    const iso = post.published_at || post.updated_at || post.created_at;
    if (!iso) return '';
    const prefix = post.status === 'draft' ? 'Edited ' : '';
    return `<time datetime="${esc(iso)}" title="${esc(timeFull(iso))}">${prefix}${esc(timeAgo(iso))}</time>`;
  };
  const excerpt = (text, n = 80) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const tone = (id) => [...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 5;
  const ratio = (post) => {
    const w = Number(post.media_width), h = Number(post.media_height);
    const r = w > 0 && h > 0 ? w / h : (post.media_kind === 'video' ? 9 / 16 : 4 / 5);
    return Math.min(1.5, Math.max(0.62, r)).toFixed(3);
  };
  const duration = (sec) => { const s = Math.round(Number(sec) || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function friendlyError(error, fallback) {
    const code = error?.code, message = String(error?.message || '');
    if (code === '42501') return 'Only the store owner can do that. Sign in again with the owner account.';
    if (code === '22023' || code === 'P0002') return message;
    if (/fetch|network|Failed to|timeout/i.test(message)) return 'Could not reach LexC’s. Check your connection and try again.';
    return fallback;
  }
  function whenCatalogReady(fn) {
    if (window.lexcCatalogState === 'ready') return fn();
    let waited = 0;
    const timer = setInterval(() => {
      waited += 200;
      if (window.lexcCatalogState === 'ready') { clearInterval(timer); fn(); }
      else if (waited > 15000 || window.lexcCatalogState === 'error') { clearInterval(timer); showToast('The menu could not load. Please try again.'); }
    }, 200);
  }
  // Current catalog facts for a product id (price/availability are never stored on posts).
  function catalogProduct(id) {
    if (!id) return null;
    const list = typeof liveCatalog !== 'undefined' ? liveCatalog : [];
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    const vs = (p.product_variants || []).filter((v) => v.is_active);
    return { id: p.id, slug: p.slug, name: p.name, kind: p.kind, image_path: p.image_path,
      min_price: vs.length ? Math.min(...vs.map((v) => Number(v.price))) : null, available: vs.length > 0 };
  }
  const productImage = (prod) => prod?.image_path ? LexcBackend.mediaURL(prod.image_path) : '';
  const productThumb = (prod) => productImage(prod) ? `<img src="${esc(productImage(prod))}" alt="" loading="lazy">` : '<span class="fresh-linked-ph" aria-hidden="true">🧁</span>';

  // Private bucket: media is shown through short-lived signed URLs. Customers can only sign files used by
  // published posts (storage policy), the owner can sign everything.
  const signed = new Map();
  async function sign(paths) {
    const need = [...new Set(paths.filter(Boolean))].filter((p) => !(signed.get(p)?.exp > Date.now() + 60000));
    if (!need.length) return;
    const { data, error } = await client().storage.from(BUCKET).createSignedUrls(need, 3600);
    if (error) { console.info('Post media could not be signed:', error.message); return; }
    for (const row of data || []) if (row.signedUrl && !row.error) signed.set(row.path, { url: row.signedUrl, exp: Date.now() + 3500000 });
  }
  const mediaUrl = (path) => signed.get(path)?.url || '';

  // Normalises a feed row (get_store_feed) or an owner table row (store_posts) into one shape.
  function normalise(row) {
    const fromTable = Object.hasOwn(row, 'status');
    return { ...row, status: row.status || 'published',
      product: fromTable ? catalogProduct(row.product_id) : row.product,
      product_unavailable: fromTable ? Boolean(row.product_id && !catalogProduct(row.product_id)) : Boolean(row.product_unavailable),
      pending: fromTable ? Boolean(row.pending_revision) : state.pendingIds.has(row.id) };
  }

  // ---- Feed ----------------------------------------------------------------------------------
  const state = { kind: 'all', mode: 'live', items: [], byId: new Map(), cursor: null, done: false, loading: false, error: false,
    token: 0, pendingIds: new Set(), loaded: false, owner: false };
  const page = document.getElementById('page-fresh');
  const grid = document.getElementById('freshFeed');
  const status = document.getElementById('freshStatus');
  const bar = $('.fresh-bar', page);

  function cardHtml(post, { preview = false } = {}) {
    const owner = state.owner && !preview;
    const menu = owner ? `<button type="button" class="fresh-owner-menu-btn" data-menu="${esc(post.id)}" aria-label="Post options" aria-haspopup="menu">${icon('dots')}</button>` : '';
    const badgeText = !owner ? '' : post.status === 'draft' ? 'Draft' : post.status === 'archived' ? 'Archived' : post.pending ? 'Unsaved edits' : '';
    const badge = badgeText ? `<span class="fresh-owner-badge">${badgeText}</span>` : '';
    const prod = post.product;
    const short = excerpt(post.caption) || (post.media_kind === 'video' ? 'Video' : 'Photo');
    if (post.media_kind === 'none') {
      const text = String(post.caption || '');
      return `<article class="fresh-card fresh-card--text fresh-tone-${tone(post.id)}" data-post="${esc(post.id)}">
        <button type="button" class="fresh-open" data-open="${esc(post.id)}" aria-label="Open update: ${esc(short)}">
          <span class="fresh-text-owner">${avatar()}LexC’s</span>
          <span class="fresh-text-body${text.length <= 90 && !text.includes('\n') ? ' is-short' : ''}">${esc(text)}</span>
          <span class="fresh-text-foot"><span>Store update · ${timeTag(post)}</span>${prod ? `<span>View snack ${icon('arrow', 'ui-icon ui-icon--small')}</span>` : ''}</span>
        </button>${badge}${menu}</article>`;
    }
    const video = post.media_kind === 'video';
    const thumbPath = video ? post.poster_path : post.media_path;
    const src = preview && post.previewThumb ? post.previewThumb : mediaUrl(thumbPath);
    const alt = post.media_alt || (video ? 'Video cover' : excerpt(post.caption, 120) || 'LexC’s Snacktime photo');
    const thumb = src
      ? `<img class="fresh-thumb" style="--ar:${ratio(post)}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" data-path="${esc(thumbPath || '')}">`
      : `<span class="fresh-thumb-fallback" style="--ar:${ratio(post)}">${video ? 'Video' : 'Photo'} preview unavailable</span>`;
    const pill = prod && !preview ? `<button type="button" class="fresh-product-pill" data-product="${esc(post.id)}" aria-label="View product: ${esc(prod.name)}"><span>View product</span>${icon('arrow')}</button>`
      : prod ? `<span class="fresh-product-pill" aria-hidden="true"><span>View product</span>${icon('arrow')}</span>` : '';
    return `<article class="fresh-card fresh-card--${video ? 'video' : 'photo'}" data-post="${esc(post.id)}">
      <div class="fresh-media">
        <button type="button" class="fresh-open" data-open="${esc(post.id)}" aria-label="${video ? 'Play video' : 'Open photo'}: ${esc(short)}">${thumb}
          <span class="fresh-chip">${avatar()}LexC’s</span>
          ${video ? `<span class="fresh-play">${'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>'}</span>${post.media_duration ? `<span class="fresh-duration">${duration(post.media_duration)}</span>` : ''}` : ''}
        </button>${pill}${badge}
      </div>
      <div class="fresh-body">${post.caption ? `<p class="fresh-caption">${esc(post.caption)}</p>` : ''}
        <div class="fresh-meta">${timeTag(post)}${post.product_unavailable || (prod && !prod.available) ? '<span class="fresh-unavailable">Treat unavailable</span>' : ''}${String(post.caption || '').length > 120 ? `<button type="button" class="fresh-more" data-open="${esc(post.id)}" tabindex="-1" aria-hidden="true">More</button>` : ''}</div>
      </div>${menu}</article>`;
  }

  function columns() {
    const w = grid.clientWidth || page.clientWidth || window.innerWidth;
    if (state.kind === 'photos') return w >= 980 ? 3 : w >= 600 ? 2 : 1;
    return w >= 1060 ? 4 : w >= 740 ? 3 : 2;
  }
  // Masonry by row spans: every card spans enough 2px grid rows for its measured height.
  const cardObserver = 'ResizeObserver' in window ? new ResizeObserver((entries) => entries.forEach((e) => sizeCell(e.target.parentElement))) : null;
  function sizeCell(cell) {
    if (!cell?.firstElementChild) return;
    const gap = parseFloat(getComputedStyle(cell).paddingBottom) || 0;
    cell.style.gridRowEnd = `span ${Math.max(1, Math.ceil((cell.firstElementChild.getBoundingClientRect().height + gap) / 2))}`;
  }
  function relayout() {
    grid.style.setProperty('--fresh-cols', columns());
    grid.querySelectorAll('.fresh-cell').forEach(sizeCell);
  }
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (page.classList.contains('active')) relayout(); }).observe(grid);
  else window.addEventListener('resize', relayout);

  function append(posts) {
    const html = posts.map((p) => `<div class="fresh-cell">${cardHtml(p)}</div>`).join('');
    grid.insertAdjacentHTML('beforeend', html);
    grid.style.setProperty('--fresh-cols', columns());
    grid.querySelectorAll('.fresh-cell:not([data-sized])').forEach((cell) => { cell.dataset.sized = '1'; sizeCell(cell); cardObserver?.observe(cell.firstElementChild); });
  }
  // Reviews tab: approved reviews for customers; the owner sees every review and can show or hide it.
  const stars = (n) => `<span class="fresh-stars" role="img" aria-label="${n} out of 5 stars">${'★'.repeat(n)}<span>${'★'.repeat(5 - n)}</span></span>`;
  // A review card names what was ordered (size, quantity, custom design); tapping it opens that product.
  const DESIGNED = { bento: 'Custom bento design', cupcake: 'Custom cupcake design', donut: 'Custom donut design', cakepop: 'Custom cake pop design' };
  const reviewDate = (iso) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
  function reviewHtml(r) {
    const owner = state.owner, hidden = r.visibility === 'hidden', rating = Math.max(1, Math.min(5, Number(r.rating) || 0));
    const items = Array.isArray(r.items) ? r.items : [];
    const itemRow = (it) => {
      const prod = catalogProduct(it.product_id);
      const meta = [it.size, it.quantity > 1 ? `×${it.quantity}` : ''].filter(Boolean).join(' · ');
      // product photo: the catalog image, or the storefront's photo for that menu item
      const local = typeof products !== 'undefined' ? products.find((x) => x.product_id === it.product_id) : null;
      const photo = productImage(prod) || (local && typeof PRODUCT_IMAGES !== 'undefined' ? PRODUCT_IMAGES[local.id] : '');
      return `<button type="button" class="fresh-review-item" data-review-product="${esc(it.product_id || '')}"${prod ? '' : ' data-unavailable'}>
          <span class="fresh-review-thumb">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy">` : '<span class="fresh-linked-ph" aria-hidden="true">🧁</span>'}</span>
          <span class="fresh-review-item-text"><strong>${esc(prod?.name || it.name)}</strong>${meta ? `<small>${esc(meta)}</small>` : ''}${it.designer ? `<em class="fresh-review-tag">${esc(DESIGNED[it.designer] || 'Custom design')}</em>` : ''}</span>
          ${prod ? icon('arrow', 'ui-icon fresh-review-go') : ''}</button>`;
    };
    const name = (r.public_display_name || 'Customer').trim();
    const long = (r.review_text || '').length > 220;
    return `<article class="fresh-review${owner && hidden ? ' is-hidden' : ''}${r.image_path ? ' has-photo' : ''}" data-review="${esc(r.id)}"${items[0]?.product_id ? ` data-review-first="${esc(items[0].product_id)}"` : ''}>
      <header class="fresh-review-head">
        <span class="fresh-review-avatar" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span>
        <span class="fresh-review-who"><strong>${esc(name)}</strong><small>${icon('check', 'ui-icon fresh-review-check')}Verified order · ${esc(reviewDate(r.created_at))}</small></span>
      </header>
      ${r.image_path ? `<button type="button" class="fresh-review-photo" data-review-photo="${esc(r.image_path)}" aria-label="Open ${esc(name)}'s photo"><span class="skel" aria-hidden="true"></span><img alt="Photo from ${esc(name)}'s order" hidden></button>` : ''}
      <div class="fresh-review-stars">${stars(rating)}<b>${rating.toFixed(1)}</b></div>
      ${r.review_text ? `<blockquote class="fresh-review-quote${long ? ' is-clamped' : ''}"><p>${esc(r.review_text)}</p></blockquote>${long ? '<button type="button" class="fresh-review-more-btn" data-review-more>Read more</button>' : ''}` : ''}
      ${items.length ? `<div class="fresh-review-items"><span class="fresh-review-label">What they ordered</span>${items.slice(0, 2).map(itemRow).join('')}${items.length > 2 ? `<small class="fresh-review-more">+${items.length - 2} more item${items.length - 2 === 1 ? '' : 's'}</small>` : ''}</div>` : ''}
      ${owner ? `<footer class="fresh-review-owner"><span class="fresh-owner-badge">${hidden ? 'Hidden from customers' : 'Shown on site'}</span><button type="button" class="fresh-btn${hidden ? ' fresh-btn--primary' : ''}" data-review-toggle="${esc(r.id)}">${hidden ? 'Show on site' : 'Hide'}</button></footer>` : ''}
    </article>`;
  }
  async function hydrateReviewPhotos() {
    const buttons = [...grid.querySelectorAll('[data-review-photo]')].filter((b) => !b.querySelector('img').getAttribute('src'));
    if (!buttons.length) return;
    try {
      const { data, error } = await client().storage.from('review-images').createSignedUrls([...new Set(buttons.map((b) => b.dataset.reviewPhoto))], 3600);
      if (error) throw error;
      const urls = new Map((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
      buttons.forEach((button) => {
        const url = urls.get(button.dataset.reviewPhoto), img = button.querySelector('img');
        if (!url) { button.remove(); return; }
        img.onload = () => { img.hidden = false; button.querySelector('.skel')?.remove(); const cell = button.closest('.fresh-cell'); if (cell) sizeCell(cell); };
        img.onerror = () => button.remove();
        img.src = url;
      });
    } catch (error) { console.info('Review photos unavailable:', error?.message || error); buttons.forEach((b) => b.remove()); }
  }
  function openReviewProduct(id) {
    const prod = catalogProduct(id);
    if (!prod) { showToast('This treat is not available to order right now.'); return; }
    goToProduct(prod);
  }
  async function loadReviews(token) {
    try {
      // get_review_feed (phase 42) adds what was ordered; older databases fall back to the plain review list.
      let rows;
      try { rows = await LexcBackend.rpc('get_review_feed', { include_hidden: state.owner }); }
      catch (error) {
        if (!/get_review_feed|PGRST202|42883/i.test(`${error?.code} ${error?.message}`)) throw error;
        rows = state.owner
          ? LexcBackend.unwrap(await client().from('reviews').select('id,rating,review_text,public_display_name,visibility,created_at').order('created_at', { ascending: false }))
          : await LexcBackend.rpc('get_public_reviews', {});
      }
      if (token !== state.token) return;
      state.reviews = new Map((rows || []).map((r) => [r.id, r]));
      grid.innerHTML = '';
      const html = (rows || []).map((r) => `<div class="fresh-cell">${reviewHtml(r)}</div>`).join('');
      grid.insertAdjacentHTML('beforeend', html);
      grid.style.setProperty('--fresh-cols', columns());
      grid.querySelectorAll('.fresh-cell').forEach((cell) => { cell.dataset.sized = '1'; sizeCell(cell); cardObserver?.observe(cell.firstElementChild); });
      state.items = rows || []; state.done = true;
      hydrateReviewPhotos();
      // product names, photos and links come from the menu; redraw once it has loaded
      if (window.lexcCatalogState !== 'ready') whenCatalogReady(() => {
        if (token !== state.token || state.kind !== 'reviews') return;
        grid.querySelectorAll('[data-review]').forEach((card) => { const r = state.reviews.get(card.dataset.review); if (r) card.outerHTML = reviewHtml(r); });
        hydrateReviewPhotos();
        grid.querySelectorAll('.fresh-cell').forEach(sizeCell);
      });
    } catch (error) {
      if (token !== state.token) return;
      console.warn('Reviews could not load:', error);
      grid.innerHTML = ''; state.error = true;
    }
    state.loading = false; state.loaded = true; renderStatus();
  }
  async function toggleReview(id, button) {
    const r = state.reviews?.get(id); if (!r || !state.owner) return;
    const next = r.visibility === 'visible' ? 'hidden' : 'visible';
    button.disabled = true;
    try {
      const saved = LexcBackend.unwrap(await client().from('reviews').update({ visibility: next }).eq('id', id).select('id'));
      if (!saved?.length) throw new Error('No review was updated.');
      r.visibility = next;
      const card = grid.querySelector(`[data-review="${CSS.escape(id)}"]`);
      if (card) card.outerHTML = reviewHtml(r);
      showToast(next === 'visible' ? 'Review is now shown on the site.' : 'Review hidden from customers.');
    } catch (error) { console.warn('Review update failed:', error); showToast(friendlyError(error, 'Could not update the review. Try again.')); button.disabled = false; }
  }

  function skeleton() {
    const heights = [260, 180, 320, 220, 280, 200, 240, 300];
    grid.style.setProperty('--fresh-cols', columns());
    grid.innerHTML = heights.slice(0, columns() * 2).map((h) => `<div class="fresh-cell" style="grid-row-end:span ${Math.ceil((h + 14) / 2)}"><span class="skel fresh-skel" style="height:${h}px" aria-hidden="true"></span></div>`).join('');
    status.innerHTML = `<span class="fresh-sr" role="status">${state.kind === 'reviews' ? 'Loading reviews…' : 'Loading posts…'}</span>`;
  }

  function renderStatus() {
    if (state.error) {
      const first = !state.items.length;
      status.innerHTML = `<div role="alert"><strong>${state.kind === 'reviews' ? 'Reviews could not load.' : first ? 'Posts could not load.' : 'More posts could not load.'}</strong><p>Check your connection and try again.</p></div><button type="button" class="fresh-btn" data-retry>Try again</button>`;
      return;
    }
    if (!state.items.length && !state.loading) {
      let title, text, action;
      if (state.kind === 'reviews') { [title, text] = EMPTY.reviews; status.innerHTML = `<strong>${title}</strong><p>${text}</p>`; return; }
      if (state.mode === 'drafts') [title, text] = ['No drafts', 'Posts you save as drafts wait here until you publish them.'];
      else if (state.mode === 'archived') [title, text] = ['Nothing archived', 'Archived posts are hidden from customers and kept here.'];
      else [title, text] = EMPTY[state.kind];
      if (state.owner && state.mode === 'live' && state.kind === 'all') { title = 'Share your first post'; text = 'Photos, short videos and updates you post appear here for customers.'; action = '<button type="button" class="fresh-btn fresh-btn--primary" data-compose>Create post</button>'; }
      else if (state.kind !== 'all') action = '<button type="button" class="fresh-btn" data-kind-all>See all posts</button>';
      else if (state.mode === 'live') action = '<button type="button" class="fresh-btn" onclick="navigate(\'shop\')">Browse the menu</button>';
      status.innerHTML = `<strong>${title}</strong><p>${text}</p>${action || ''}`;
      return;
    }
    if (state.kind === 'reviews') { status.innerHTML = ''; return; }
    status.innerHTML = state.done ? (state.items.length > PAGE_SIZE ? '<p>You’re all caught up.</p>' : '')
      : `<button type="button" class="fresh-btn" data-more${state.loading ? ' disabled' : ''}>${state.loading ? 'Loading…' : 'Load more posts'}</button>`;
  }

  async function fetchPage() {
    const kindFilter = { photos: 'image', videos: 'video', updates: 'none' }[state.kind];
    if (state.mode === 'live') {
      return LexcBackend.rpc('get_store_feed', { p_kind: state.kind, p_before: state.cursor?.at || null, p_before_id: state.cursor?.id || null, p_limit: PAGE_SIZE });
    }
    let q = client().from('store_posts').select('*').eq('status', state.mode === 'drafts' ? 'draft' : 'archived');
    if (kindFilter) q = q.eq('media_kind', kindFilter);
    const from = state.items.length;
    return LexcBackend.unwrap(await q.order('updated_at', { ascending: false }).order('id', { ascending: false }).range(from, from + PAGE_SIZE - 1));
  }

  async function load(reset) {
    const token = reset ? ++state.token : state.token;
    if (reset) {
      Object.assign(state, { items: [], cursor: null, done: false, error: false, loading: true });
      state.byId.clear(); skeleton();
      if (state.kind === 'reviews') return loadReviews(token);
    } else {
      if (state.kind === 'reviews') return;
      if (state.loading || state.done) return;
      state.loading = true; state.error = false; renderStatus();
    }
    try {
      if (reset && state.owner && state.mode === 'live') {
        const pending = await client().from('store_posts').select('id').eq('status', 'published').not('pending_revision', 'is', null);
        state.pendingIds = new Set((pending.data || []).map((r) => r.id));
      }
      const rows = (await fetchPage()) || [];
      await sign(rows.flatMap((r) => [r.media_kind === 'video' ? r.poster_path : r.media_path]));
      if (token !== state.token) return;
      const posts = rows.map(normalise);
      if (reset) grid.innerHTML = '';
      posts.forEach((p) => state.byId.set(p.id, p));
      state.items.push(...posts);
      const last = rows.at(-1);
      state.cursor = last ? { at: last.published_at, id: last.id } : state.cursor;
      state.done = rows.length < PAGE_SIZE;
      state.loading = false;
      append(posts);
    } catch (error) {
      if (token !== state.token) return;
      console.warn('Fresh feed could not load:', error);
      state.loading = false; state.error = true;
      if (reset) grid.innerHTML = '';
    }
    state.loaded = true;
    renderStatus();
  }

  // Tabs, owner modes and card actions -----------------------------------------------------------
  const tabs = [...page.querySelectorAll('[data-kind]')];
  function selectKind(kind, focus = false) {
    state.kind = kind;
    tabs.forEach((t) => { const on = t.dataset.kind === kind; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    grid.setAttribute('aria-labelledby', `fresh-tab-${kind}`);
    page.classList.toggle('is-reviews', kind === 'reviews');
    load(true);
  }
  tabs.forEach((t) => {
    t.addEventListener('click', () => { if (t.getAttribute('aria-selected') !== 'true') selectKind(t.dataset.kind); });
    t.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(t);
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault(); selectKind(tabs[(next + tabs.length) % tabs.length].dataset.kind, true);
    });
  });
  page.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    if (state.mode === b.dataset.mode) return;
    state.mode = b.dataset.mode;
    page.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load(true);
  }));

  page.addEventListener('click', (e) => {
    const t = e.target;
    const product = t.closest('[data-product]'); if (product) { const post = state.byId.get(product.dataset.product); if (post?.product) goToProduct(post.product); return; }
    const menu = t.closest('[data-menu]'); if (menu) return openMenu(menu, state.byId.get(menu.dataset.menu));
    const more = t.closest('[data-review-more]');
    if (more) { const quote = more.previousElementSibling; const open = quote.classList.toggle('is-open'); more.textContent = open ? 'Show less' : 'Read more'; const cell = more.closest('.fresh-cell'); if (cell) sizeCell(cell); return; }
    const photo = t.closest('[data-review-photo]');
    if (photo) { const src = photo.querySelector('img')?.getAttribute('src'); if (src) window.open(src, '_blank', 'noopener'); return; }
    const reviewToggle = t.closest('[data-review-toggle]'); if (reviewToggle) return toggleReview(reviewToggle.dataset.reviewToggle, reviewToggle);
    const reviewProduct = t.closest('[data-review-product]'); if (reviewProduct) return openReviewProduct(reviewProduct.dataset.reviewProduct);
    const reviewCard = t.closest('[data-review-first]'); if (reviewCard && !t.closest('a,button')) return openReviewProduct(reviewCard.dataset.reviewFirst);
    const open = t.closest('[data-open]'); if (open) return openViewer(state.byId.get(open.dataset.open), open);
    if (t.closest('[data-retry]')) return load(!state.items.length);
    if (t.closest('[data-more]')) return load(false);
    if (t.closest('[data-kind-all]')) return selectKind('all');
    if (t.closest('[data-compose]')) return Composer.open({});
    if (t.closest('[data-compose-media]')) return Composer.open({ pickMedia: true });
  });
  // Broken/expired media: re-sign once, then fall back to a label.
  grid.addEventListener('error', async (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.path) return;
    if (img.dataset.retried) { img.replaceWith(Object.assign(document.createElement('span'), { className: 'fresh-thumb-fallback', textContent: 'Photo unavailable', style: img.getAttribute('style') })); return; }
    img.dataset.retried = '1'; signed.delete(img.dataset.path);
    await sign([img.dataset.path]);
    img.src = mediaUrl(img.dataset.path) || img.src + '#x';
  }, true);

  const sentinel = document.getElementById('freshSentinel');
  if ('IntersectionObserver' in window) new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && page.classList.contains('active') && state.loaded && !state.done && !state.error) load(false);
  }, { rootMargin: '700px 0px' }).observe(sentinel);
  window.addEventListener('scroll', () => { if (page.classList.contains('active')) bar.classList.toggle('is-stuck', window.scrollY > 90); }, { passive: true });

  // ---- Linked product → existing purchase flow -----------------------------------------------
  function goToProduct(prod) {
    closeViewer({ keepHistory: true });
    whenCatalogReady(() => {
      if (prod.kind === 'package') { navigate('packages'); return; }
      const local = products.find((p) => p.product_id === prod.id);
      if (!local) { showToast('This treat is not available to order right now.'); return; }
      openProductDetails(local.id);
    });
  }

  // ---- Post viewer ---------------------------------------------------------------------------
  let viewer = null, viewerPost = null, viewerReturn = null, viewerPushed = false;
  function ensureViewer() {
    if (viewer) return viewer;
    viewer = document.createElement('dialog');
    viewer.className = 'fresh-dialog';
    viewer.setAttribute('aria-labelledby', 'fresh-viewer-title');
    document.body.append(viewer);
    viewer.addEventListener('cancel', (e) => { e.preventDefault(); closeViewer(); });
    viewer.addEventListener('click', (e) => {
      if (e.target === viewer) return closeViewer();
      const t = e.target;
      if (t.closest('[data-v-close]')) return closeViewer();
      if (t.closest('[data-v-share]')) return sharePost(viewerPost);
      if (t.closest('[data-v-product]') && viewerPost?.product) return goToProduct(viewerPost.product);
      if (t.closest('[data-v-edit]')) { const p = viewerPost; closeViewer(); return editPost(p); }
      if (t.closest('[data-v-archive]')) { const p = viewerPost; closeViewer(); return ownerAction(p, 'archive'); }
      if (t.closest('[data-v-restore]')) { const p = viewerPost; closeViewer(); return ownerAction(p, 'restore'); }
    });
    window.addEventListener('popstate', () => { if (viewer.open && !history.state?.lexcPost) { viewerPushed = false; closeViewer({ fromHistory: true }); } });
    return viewer;
  }
  function linkedBlock(post) {
    const prod = post.product;
    if (!prod) return post.product_unavailable ? '<p class="fresh-note">The treat featured in this post is no longer on the menu.</p>' : '';
    return `<div class="fresh-linked">${productThumb(prod)}<div class="fresh-linked-info"><strong>${esc(prod.name)}</strong>
      ${prod.min_price != null ? `<span>From ${esc(money(prod.min_price))}</span>` : ''}
      <span class="${prod.available ? 'is-ok' : 'is-off'}">${prod.available ? 'Available to order' : 'Not available to order right now'}</span></div></div>`;
  }
  async function openViewer(post, trigger) {
    if (!post) return;
    ensureViewer();
    viewerPost = post; viewerReturn = trigger || document.activeElement;
    await sign([post.media_path, post.poster_path]);
    const owner = state.owner;
    const media = post.media_kind === 'image'
      ? `<div class="fresh-viewer-media"><img src="${esc(mediaUrl(post.media_path))}" alt="${esc(post.media_alt || excerpt(post.caption, 120) || 'LexC’s Snacktime photo')}"></div>`
      : post.media_kind === 'video'
        ? `<div class="fresh-viewer-media"><video controls playsinline preload="metadata" ${post.poster_path ? `poster="${esc(mediaUrl(post.poster_path))}"` : ''} src="${esc(mediaUrl(post.media_path))}" aria-label="${esc(post.media_alt || 'Post video')}"></video></div>` : '';
    const prod = post.product;
    const buy = prod && prod.available ? `<button type="button" class="fresh-btn fresh-btn--primary" data-v-product>${icon('bag')} View product</button>` : '';
    const ownerFoot = owner ? `<button type="button" class="fresh-btn" data-v-edit>Edit post</button>${post.status === 'published' ? '<button type="button" class="fresh-btn" data-v-archive>Archive</button>' : post.status === 'archived' ? '<button type="button" class="fresh-btn" data-v-restore>Restore</button>' : ''}` : '';
    viewer.innerHTML = `<div class="fresh-viewer${media ? '' : ' is-text'}">${media}
      <div class="fresh-viewer-side">
        <div class="fresh-viewer-head">${avatar()}<div><strong id="fresh-viewer-title">LexC’s Snacktime</strong>${post.published_at ? `<time datetime="${esc(post.published_at)}">${esc(timeFull(post.published_at))}</time>` : '<time>Not published</time>'}</div>
          <div class="fresh-viewer-actions">${post.status === 'published' ? `<button type="button" class="fresh-icon-btn" data-v-share aria-label="Share post">${icon('share')}</button>` : ''}<button type="button" class="fresh-icon-btn" data-v-close aria-label="Close post">${icon('close')}</button></div></div>
        <div class="fresh-viewer-scroll">${post.caption ? `<p class="fresh-viewer-caption">${esc(post.caption)}</p>` : ''}${linkedBlock(post)}</div>
        ${buy || ownerFoot ? `<div class="fresh-viewer-foot">${buy}${ownerFoot}</div>` : ''}
      </div></div>`;
    if (!viewer.open) {
      viewer.showModal();
      if (post.status === 'published') {
        const url = new URL(location.href); url.searchParams.set('post', post.id); url.searchParams.delete('product');
        history.pushState({ ...(history.state || {}), lexcPost: post.id }, '', url); viewerPushed = true;
      }
    }
    viewer.querySelector('[data-v-close]').focus({ preventScroll: true });
  }
  function closeViewer({ fromHistory = false, keepHistory = false } = {}) {
    if (!viewer?.open) return;
    viewer.querySelector('video')?.pause();
    viewer.close();
    if (viewerPushed && !fromHistory) {
      viewerPushed = false;
      if (keepHistory) { const url = new URL(location.href); url.searchParams.delete('post'); const s = { ...(history.state || {}) }; delete s.lexcPost; history.replaceState(s, '', url); }
      else history.back();
    } else if (!fromHistory) { const url = new URL(location.href); if (url.searchParams.has('post')) { url.searchParams.delete('post'); history.replaceState(history.state, '', url); } }
    if (viewerReturn?.isConnected) viewerReturn.focus({ preventScroll: true });
  }
  async function sharePost(post) {
    const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('post', post.id);
    const data = { title: 'Fresh from LexC’s Snacktime', text: excerpt(post.caption, 120) || 'Fresh from LexC’s Snacktime', url: url.toString() };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(data.url); showToast('Link copied — share it with anyone.');
    } catch (error) { if (error?.name !== 'AbortError') showToast('Could not share. Copy the address bar link instead.'); }
  }
  // A broken or removed post link must not stay in the address bar (each reload would retry it).
  function dropPostParam() { const u = new URL(location.href); if (u.searchParams.has('post')) { u.searchParams.delete('post'); history.replaceState(history.state, '', u); } }
  async function openPostById(id) {
    try {
      const rows = await LexcBackend.rpc('get_store_feed', { p_kind: 'all', p_post_id: id, p_limit: 1 });
      if (!rows?.length) { dropPostParam(); showToast('That post is no longer available.'); return; }
      const post = normalise(rows[0]); state.byId.set(post.id, post);
      history.replaceState({ ...(history.state || {}) }, '', (() => { const u = new URL(location.href); u.searchParams.delete('post'); return u; })());
      openViewer(post);
    } catch (error) { console.warn('Post could not load:', error); dropPostParam(); showToast('That post could not load. Please try again.'); }
  }

  // ---- Owner menu and actions ----------------------------------------------------------------
  let menuEl = null, menuReturn = null;
  function closeMenu(focus = true) { if (!menuEl) return; menuEl.remove(); menuEl = null; if (focus) menuReturn?.focus(); }
  function openMenu(button, post) {
    if (!post || !state.owner) return;
    closeMenu(false);
    menuReturn = button;
    const items = [['edit', post.status === 'draft' ? 'Edit draft' : 'Edit post']];
    if (post.status === 'published') { items.push(['view', 'View post']); if (post.pending) items.push(['discard', 'Discard unsaved edits']); items.push(['archive', 'Archive (hide from customers)', true]); }
    if (post.status === 'archived') items.push(['restore', 'Restore to feed']);
    if (post.status === 'draft') items.push(['delete', 'Delete draft', true]);
    menuEl = document.createElement('div');
    menuEl.className = 'fresh-menu'; menuEl.setAttribute('role', 'menu'); menuEl.setAttribute('aria-label', 'Post options');
    menuEl.innerHTML = items.map(([key, label, danger]) => `<button type="button" role="menuitem" data-action="${key}"${danger ? ' class="is-danger"' : ''} tabindex="-1">${label}</button>`).join('');
    document.body.append(menuEl);
    const r = button.getBoundingClientRect(), m = menuEl.getBoundingClientRect();
    menuEl.style.left = `${Math.max(8, Math.min(window.innerWidth - m.width - 8, r.right - m.width))}px`;
    menuEl.style.top = `${r.bottom + 6 + m.height > window.innerHeight ? Math.max(8, r.top - m.height - 6) : r.bottom + 6}px`;
    const buttons = [...menuEl.querySelectorAll('button')];
    buttons[0].focus();
    menuEl.addEventListener('keydown', (e) => {
      const i = buttons.indexOf(document.activeElement);
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    });
    menuEl.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action; if (!action) return;
      closeMenu(false);
      if (action === 'edit') editPost(post);
      else if (action === 'view') openViewer(post, button);
      else ownerAction(post, action);
    });
    setTimeout(() => document.addEventListener('pointerdown', function away(e) { if (menuEl && !menuEl.contains(e.target)) { closeMenu(false); } document.removeEventListener('pointerdown', away); }), 0);
  }
  async function editPost(post) {
    try {
      const row = LexcBackend.unwrap(await client().from('store_posts').select('*').eq('id', post.id).single());
      Composer.open({ post: row });
    } catch (error) { showToast(friendlyError(error, 'This post could not open for editing. Please try again.')); }
  }
  async function ownerAction(post, action) {
    const confirmText = { archive: 'Archive this post? Customers will no longer see it. The linked product and orders are not affected.',
      delete: 'Delete this draft permanently?', discard: 'Discard your unsaved edits? Customers keep seeing the live post.' }[action];
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      if (action === 'delete') {
        const paths = await LexcBackend.rpc('delete_store_post_draft', { p_post_id: post.id });
        if (paths?.length) client().storage.from(BUCKET).remove(paths).catch(() => {});
        showToast('Draft deleted.');
      } else {
        const next = { archive: 'archived', restore: 'published', discard: 'discard_edits' }[action];
        await LexcBackend.rpc('set_store_post_status', { p_post_id: post.id, p_status: next });
        showToast({ archive: 'Post archived. It is hidden from customers.', restore: 'Post restored to the feed.', discard: 'Unsaved edits discarded.' }[action]);
      }
      load(true);
    } catch (error) { showToast(friendlyError(error, 'That change could not be saved. Please try again.')); }
  }

  // ---- Composer ------------------------------------------------------------------------------
  const Composer = (() => {
    let dialog = null;
    const c = {};
    function reset() {
      Object.assign(c, { view: 'edit', post: null, requestId: crypto.randomUUID(), folder: crypto.randomUUID(), caption: '', alt: '', media: null,
        product: null, busy: false, baseline: '', uploaded: new Set(), returnFocus: null, message: '', messageTone: '', uploadToken: 0, xhr: null, loadedPending: false });
    }
    reset();
    const snapshot = () => JSON.stringify({ c: c.caption, a: c.alt, p: c.product?.id || null, m: c.media ? (c.media.path || `local:${c.media.file?.name}`) : null });
    const dirty = () => snapshot() !== c.baseline || ['processing', 'uploading'].includes(c.media?.status);
    const mediaBusy = () => ['processing', 'uploading'].includes(c.media?.status);
    const hasContent = () => c.caption.trim() !== '' || c.media?.status === 'ready';
    const canSave = () => !c.busy && !mediaBusy() && c.media?.status !== 'error' && hasContent() && c.caption.length <= CAPTION_MAX;
    const isExisting = () => c.post && c.post.status !== 'draft';

    function ensure() {
      if (dialog) return dialog;
      dialog = document.createElement('dialog');
      dialog.className = 'fresh-composer';
      dialog.setAttribute('aria-labelledby', 'fresh-composer-title');
      document.body.append(dialog);
      dialog.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
      dialog.addEventListener('click', onClick);
      dialog.addEventListener('input', onInput);
      dialog.addEventListener('change', (e) => { if (e.target.matches('[data-c-file]')) { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickFile(f); } });
      dialog.addEventListener('keydown', trapFocus);
      return dialog;
    }
    // showModal() already makes the page inert; this keeps Tab cycling inside the sheet.
    function trapFocus(e) {
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('button:not([disabled]),textarea,input:not([type=file]),video[controls],[href]')].filter((el) => el.getClientRects().length);
      if (!items.length) return;
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function open({ post = null, pickMedia = false } = {}) {
      if (!isOwner()) { showToast('Sign in with the owner account to post.'); return; }
      if (dialog?.open) { dialog.querySelector('textarea')?.focus(); return; }
      reset();
      c.returnFocus = document.activeElement;
      if (post) {
        c.post = post;
        const src = post.status !== 'draft' && post.pending_revision ? post.pending_revision : post;
        c.loadedPending = src !== post;
        c.caption = src.caption || ''; c.alt = src.media_alt || '';
        c.product = src.product_id ? (catalogProduct(src.product_id) || { id: src.product_id, name: 'Unavailable product', available: false }) : null;
        if (src.media_kind && src.media_kind !== 'none') c.media = { kind: src.media_kind, path: src.media_path, poster_path: src.poster_path, width: src.media_width, height: src.media_height, duration: src.media_duration, status: 'ready' };
      }
      c.baseline = snapshot();
      ensure();
      render();
      dialog.showModal();
      if (pickMedia) dialog.querySelector('[data-c-file]').click();
      dialog.querySelector('textarea')?.focus();
      if (c.media?.path) sign([c.media.path, c.media.poster_path]).then(() => { if (c.view === 'edit') renderMedia(); });
    }

    function head(title, { back = false } = {}) {
      return `<div class="fresh-sheet-head">${back ? `<button type="button" class="fresh-icon-btn fresh-back" data-c="back" aria-label="Back to post">${icon('back')}</button>` : ''}
        <h2 id="fresh-composer-title">${title}</h2><button type="button" class="fresh-icon-btn" data-c="close" aria-label="Close">${icon('close')}</button></div>`;
    }
    function render() {
      const title = c.post ? (c.post.status === 'draft' ? 'Edit draft' : 'Edit post') : 'Create post';
      if (c.view === 'picker') return renderPicker();
      if (c.view === 'preview') return renderPreview();
      if (c.view === 'confirm') return renderConfirm();
      if (c.view === 'success') return renderSuccess();
      const note = c.post?.status === 'published'
        ? `<p class="fresh-edit-note">Customers keep seeing the live post until you choose <b>Save changes</b>.${c.loadedPending ? ' Showing your unsaved edits from before.' : ''}</p>`
        : c.post?.status === 'archived' ? '<p class="fresh-edit-note">This post is archived. Saving keeps it hidden — restore it from the post menu.</p>' : '';
      dialog.innerHTML = `<div class="fresh-sheet">${head(title)}<div class="fresh-sheet-body">${note}
        <div class="fresh-publisher">${avatar()}<div><b>LexC’s Snacktime</b><span class="fresh-audience">${icon('globe')} Public · Storefront</span></div></div>
        <label class="fresh-sr" for="fresh-caption">Caption</label>
        <textarea id="fresh-caption" class="fresh-caption-input" placeholder="What’s fresh at LexC’s?" rows="3" maxlength="${CAPTION_MAX + 200}">${esc(c.caption)}</textarea>
        <div class="fresh-count" data-c-count aria-live="polite"></div>
        <div data-c-media></div><div data-c-product></div>
        <div class="fresh-addbar" role="group" aria-label="Add to your post"><b aria-hidden="true">Add to your post</b>
          <button type="button" class="is-media" data-c="media">${icon('image')} Photo/video</button>
          <button type="button" class="is-product" data-c="product">${icon('tag')} Product</button></div>
        <input type="file" hidden data-c-file accept="${[...IMAGE_TYPES, ...VIDEO_TYPES].join(',')}">
        <p class="fresh-message" data-c-msg role="status"></p>
        <div class="fresh-secondary"><button type="button" data-c="draft">Save draft</button><button type="button" data-c="preview">Preview post</button></div>
        <button type="button" class="fresh-post-btn" data-c="submit">${isExisting() ? 'Save changes' : 'Post'}</button>
      </div></div>`;
      autosize(); renderMedia(); renderProduct(); updateCount(); updateButtons(); showMessage();
    }
    function autosize() { const t = dialog.querySelector('textarea'); if (!t) return; t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight + 2, window.innerHeight * 0.4)}px`; }
    function updateCount() {
      const el = dialog.querySelector('[data-c-count]'); if (!el) return;
      const n = c.caption.length;
      el.textContent = n > CAPTION_MAX - 300 ? `${n.toLocaleString()} / ${CAPTION_MAX.toLocaleString()}` : '';
      el.classList.toggle('is-over', n > CAPTION_MAX);
    }
    function updateButtons() {
      if (!dialog) return;
      const submit = dialog.querySelector('[data-c="submit"]'), draft = dialog.querySelector('[data-c="draft"]'), preview = dialog.querySelector('[data-c="preview"]');
      if (submit) { submit.disabled = !canSave(); submit.textContent = c.busy ? (isExisting() ? 'Saving…' : 'Posting…') : isExisting() ? 'Save changes' : 'Post'; }
      if (draft) draft.disabled = !canSave();
      if (preview) preview.disabled = !hasContent() || mediaBusy();
    }
    function setMessage(text, toneName = '') { c.message = text; c.messageTone = toneName; showMessage(); }
    function showMessage() {
      const el = dialog?.querySelector('[data-c-msg]'); if (!el) return;
      el.textContent = c.message || (c.media?.status === 'uploading' ? '' : 'Your post will appear in Fresh from LexC’s.');
      el.className = `fresh-message${c.messageTone ? ' is-' + c.messageTone : ''}`;
    }
    function previewSrc(m) { return m.previewUrl || mediaUrl(m.path); }
    function renderMedia() {
      const box = dialog?.querySelector('[data-c-media]'); if (!box) return;
      const m = c.media;
      if (!m) { box.innerHTML = ''; return; }
      const el = m.kind === 'video'
        ? `<video src="${esc(previewSrc(m))}" ${m.posterPreview || m.poster_path ? `poster="${esc(m.posterPreview || mediaUrl(m.poster_path))}"` : ''} controls playsinline preload="metadata" muted aria-label="Attached video preview"></video>`
        : `<img src="${esc(previewSrc(m))}" alt="Attached photo preview">`;
      const progress = ['processing', 'uploading'].includes(m.status)
        ? `<div class="fresh-progress"><span data-c-progress-text>${m.status === 'processing' ? 'Preparing…' : `Uploading ${Math.round(m.progress * 100)}%`}</span>
            <div class="fresh-progress-bar" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(m.progress * 100)}"><span style="width:${Math.round(m.progress * 100)}%"></span></div></div>` : '';
      const tools = ['processing', 'uploading'].includes(m.status)
        ? '<button type="button" data-c="cancel-upload">Cancel upload</button>'
        : `<button type="button" data-c="media">Replace</button><button type="button" data-c="remove-media" aria-label="Remove ${m.kind === 'video' ? 'video' : 'photo'}">Remove</button>`;
      box.innerHTML = `<div class="fresh-attach">${el}<div class="fresh-attach-tools">${tools}</div>${progress}</div>
        ${m.status === 'error' ? `<div class="fresh-attach-error" role="alert"><span>${esc(m.error)}</span><span>${m.file && m.retryable ? '<button type="button" data-c="retry-upload">Retry upload</button> ' : ''}<button type="button" data-c="remove-media">Remove</button></span></div>` : ''}
        ${m.status === 'ready' ? `<label class="fresh-alt">Describe this ${m.kind === 'video' ? 'video' : 'photo'} for screen readers (optional)<input type="text" data-c-alt maxlength="300" value="${esc(c.alt)}"></label>` : ''}`;
    }
    function updateProgress() {
      const m = c.media; const text = dialog?.querySelector('[data-c-progress-text]'), bar = dialog?.querySelector('.fresh-progress-bar');
      if (!m || !text || !bar) return renderMedia();
      text.textContent = m.status === 'processing' ? 'Preparing…' : `Uploading ${Math.round(m.progress * 100)}%`;
      bar.setAttribute('aria-valuenow', String(Math.round(m.progress * 100))); bar.firstElementChild.style.width = `${Math.round(m.progress * 100)}%`;
    }
    function renderProduct() {
      const box = dialog?.querySelector('[data-c-product]'); if (!box) return;
      const p = c.product;
      box.innerHTML = p ? `<div class="fresh-tagged">${productThumb(p)}<div class="fresh-tagged-name"><strong>${esc(p.name)}</strong><span>${p.available ? (p.min_price != null ? `From ${esc(money(p.min_price))} · ` : '') + 'Customers can order from the post' : 'Not available to order right now'}</span></div>
        <button type="button" data-c="product">Change</button><button type="button" data-c="remove-product" aria-label="Remove tagged product">${icon('close', 'ui-icon ui-icon--small')}</button></div>` : '';
    }
    function renderPicker() {
      dialog.innerHTML = `<div class="fresh-sheet">${head('Tag a product', { back: true })}<div class="fresh-sheet-body">
        <label class="fresh-sr" for="fresh-product-search">Search products</label>
        <input id="fresh-product-search" class="fresh-picker-search" type="search" placeholder="Search the menu" autocomplete="off" data-c-search>
        <div class="fresh-picker-list" data-c-list role="list"></div></div></div>`;
      renderPickerList('');
      dialog.querySelector('[data-c-search]').focus();
    }
    function renderPickerList(query) {
      const q = query.trim().toLowerCase();
      const list = (typeof liveCatalog !== 'undefined' ? liveCatalog : []).map((p) => catalogProduct(p.id)).filter((p) => p && p.available && (!q || p.name.toLowerCase().includes(q)));
      const box = dialog.querySelector('[data-c-list]');
      if (window.lexcCatalogState !== 'ready') { box.innerHTML = '<p class="fresh-note">The menu is still loading…</p>'; whenCatalogReady(() => { if (c.view === 'picker') renderPickerList(query); }); return; }
      box.innerHTML = list.length ? list.map((p) => `<div role="listitem"><button type="button" class="fresh-picker-item" data-pick="${esc(p.id)}" aria-pressed="${c.product?.id === p.id}">${productThumb(p)}<span><strong>${esc(p.name)}</strong><span>${p.min_price != null ? `From ${esc(money(p.min_price))}` : ''}${p.kind === 'package' ? ' · Package' : ''}</span></span></button></div>`).join('')
        : '<p class="fresh-note">No products match your search.</p>';
    }
    function previewPost() {
      const m = c.media;
      return { id: c.post?.id || 'preview', status: 'published', caption: c.caption, published_at: new Date().toISOString(), media_kind: m?.kind || 'none',
        media_path: m?.path, poster_path: m?.poster_path, media_width: m?.width, media_height: m?.height, media_duration: m?.duration, media_alt: c.alt,
        product: c.product && c.product.available !== false ? c.product : null, product_unavailable: false,
        previewThumb: m ? (m.kind === 'video' ? (m.posterPreview || mediaUrl(m.poster_path)) : previewSrc(m)) : '' };
    }
    function renderPreview() {
      dialog.innerHTML = `<div class="fresh-sheet">${head('Preview post', { back: true })}<div class="fresh-sheet-body">
        <p class="fresh-preview-label">How customers will see it in Fresh from LexC’s</p>
        <div class="fresh-preview-frame">${cardHtml(previewPost(), { preview: true })}</div>
        ${c.caption.length > 120 ? '<p class="fresh-note">Long captions are shortened on the card; customers tap the post to read everything.</p>' : ''}
        <p class="fresh-message" data-c-msg role="status"></p>
        <div class="fresh-secondary"><button type="button" data-c="back">Back to editing</button><button type="button" data-c="draft">Save draft</button></div>
        <button type="button" class="fresh-post-btn" data-c="submit">${isExisting() ? 'Save changes' : 'Post'}</button></div></div>`;
      updateButtons(); showMessage();
      dialog.querySelector('[data-c="back"]').focus();
    }
    function renderConfirm() {
      const uploading = mediaBusy();
      dialog.innerHTML = `<div class="fresh-sheet" role="alertdialog" aria-labelledby="fresh-composer-title" aria-describedby="fresh-confirm-text">${head(c.post ? 'Discard changes?' : 'Discard post?', { back: true })}<div class="fresh-sheet-body">
        <div class="fresh-confirm"><p id="fresh-confirm-text">${uploading ? 'Your upload is still in progress. ' : ''}If you leave now, your ${c.post ? 'changes' : 'post'} won’t be saved.</p>
          <button type="button" class="fresh-post-btn" data-c="back">Keep editing</button>
          ${canSave() ? '<button type="button" class="fresh-btn" data-c="draft-close">Save draft and close</button>' : ''}
          <button type="button" class="fresh-btn" data-c="discard">Discard</button></div></div></div>`;
      dialog.querySelector('[data-c="back"]').focus();
    }
    function renderSuccess() {
      const live = c.successAction === 'publish';
      dialog.innerHTML = `<div class="fresh-sheet">${head(live ? 'Posted' : 'Saved')}<div class="fresh-sheet-body">
        <div class="fresh-confirm" role="status"><span class="fresh-success-icon">${icon('check')}</span>
          <h3>${live ? 'Your post is live' : c.post?.status === 'archived' ? 'Changes saved' : 'Your changes are live'}</h3>
          <p>${c.post?.status === 'archived' ? 'The post stays archived and hidden from customers.' : 'Customers can see it in Fresh from LexC’s now.'}</p>
          ${c.post?.status === 'published' ? '<button type="button" class="fresh-post-btn" data-c="view-live">View post</button>' : ''}
          ${live ? '<button type="button" class="fresh-btn" data-c="another">Create another</button>' : ''}
          <button type="button" class="fresh-btn" data-c="done">Done</button></div></div></div>`;
      dialog.querySelector('.fresh-confirm button').focus();
    }

    function onInput(e) {
      if (e.target.id === 'fresh-caption') { c.caption = e.target.value; autosize(); updateCount(); updateButtons(); if (c.messageTone) setMessage(''); }
      else if (e.target.matches('[data-c-alt]')) c.alt = e.target.value;
      else if (e.target.matches('[data-c-search]')) renderPickerList(e.target.value);
    }
    function onClick(e) {
      if (e.target === dialog) return requestClose();
      const pick = e.target.closest('[data-pick]');
      if (pick) { c.product = catalogProduct(pick.dataset.pick); c.view = 'edit'; render(); dialog.querySelector('[data-c="product"]').focus(); return; }
      const action = e.target.closest('[data-c]')?.dataset.c; if (!action) return;
      switch (action) {
        case 'close': return requestClose();
        case 'back': c.view = 'edit'; render(); dialog.querySelector('textarea')?.focus(); return;
        case 'media': return dialog.querySelector('[data-c-file]').click();
        case 'product': c.view = 'picker'; return render();
        case 'remove-product': c.product = null; renderProduct(); dialog.querySelector('[data-c="product"]').focus(); return;
        case 'remove-media': abortUpload(); c.media = null; cleanup(); renderMedia(); updateButtons(); setMessage(''); dialog.querySelector('[data-c="media"]').focus(); return;
        case 'cancel-upload': abortUpload(); c.media = null; cleanup(); renderMedia(); updateButtons(); setMessage('Upload cancelled.'); dialog.querySelector('[data-c="media"]').focus(); return;
        case 'retry-upload': if (c.media?.file) pickFile(c.media.file); return;
        case 'preview': c.view = 'preview'; return render();
        case 'draft': return save('draft');
        case 'draft-close': return save('draft', { closeAfter: true });
        case 'submit': return save('submit');
        case 'discard': return close();
        case 'done': return close();
        case 'another': { const back = c.returnFocus; close(); open({}); c.returnFocus = back; return; }
        case 'view-live': { const id = c.post.id; close(); showLive(id); return; }
      }
    }
    function requestClose() {
      if (c.busy) return;
      if (c.view === 'success') return close();
      if (c.view === 'confirm') { c.view = 'edit'; render(); dialog.querySelector('textarea')?.focus(); return; }
      if (dirty()) { c.view = 'confirm'; return render(); }
      close();
    }
    function close() {
      abortUpload();
      cleanup(true);
      if (c.media?.previewUrl) URL.revokeObjectURL(c.media.previewUrl);
      dialog.querySelector('video')?.pause();
      dialog.close();
      const back = c.returnFocus;
      reset();
      if (back?.isConnected) back.focus({ preventScroll: true });
    }

    // Files uploaded in this session that no saved version of the post uses are removed (best effort).
    function referenced() {
      const set = new Set(); const p = c.post;
      if (p) { [p.media_path, p.poster_path, p.pending_revision?.media_path, p.pending_revision?.poster_path].forEach((x) => x && set.add(x)); }
      return set;
    }
    function cleanup(all = false) {
      const keep = referenced();
      if (!all && c.media) { keep.add(c.media.path); keep.add(c.media.poster_path); }
      const drop = [...c.uploaded].filter((path) => !keep.has(path));
      if (!drop.length) return;
      drop.forEach((path) => c.uploaded.delete(path));
      client().storage.from(BUCKET).remove(drop).catch(() => {});
    }
    function abortUpload() { c.uploadToken++; try { c.xhr?.abort(); } catch {} c.xhr = null; }

    async function pickFile(file) {
      const kind = IMAGE_TYPES.includes(file.type) ? 'image' : VIDEO_TYPES.includes(file.type) ? 'video' : null;
      abortUpload();
      if (c.media?.previewUrl && c.media.file !== file) URL.revokeObjectURL(c.media.previewUrl);
      const previewUrl = c.media?.file === file && c.media.previewUrl ? c.media.previewUrl : URL.createObjectURL(file);
      c.media = { kind: kind || 'image', file, previewUrl, status: 'processing', progress: 0 };
      cleanup(); setMessage(''); renderMedia(); updateButtons();
      const fail = (message, retryable = false) => { c.media = { ...c.media, status: 'error', error: message, retryable }; renderMedia(); updateButtons(); };
      if (!kind) return fail('Choose a JPG, PNG or WebP photo, or an MP4, WebM or MOV video.');
      if (kind === 'image' && file.size > IMAGE_MAX_INPUT) return fail('That photo is larger than 20 MB. Choose a smaller photo.');
      if (kind === 'video' && file.size > VIDEO_MAX) return fail('That video is larger than 50 MB. Trim it or choose a shorter clip.');
      const token = ++c.uploadToken;
      try {
        let blob = file, width = null, height = null, durationSec = null, poster = null;
        if (kind === 'image') ({ blob, width, height } = await processImage(file));
        else {
          const meta = await probeVideo(previewUrl);
          if (meta.duration && meta.duration > VIDEO_MAX_SECONDS) throw new Error('Videos can be up to 10 minutes long.');
          ({ width, height, poster } = meta); durationSec = Number.isFinite(meta.duration) && meta.duration >= 1 ? meta.duration : null;
          if (poster) c.media.posterPreview = URL.createObjectURL(poster);
        }
        if (token !== c.uploadToken) return;
        c.media.status = 'uploading'; renderMedia(); updateButtons();
        const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }[blob.type];
        const path = await uploadBlob(blob, `posts/${c.folder}/${stamp}.${ext}`, (f) => { if (token === c.uploadToken) { c.media.progress = poster ? f * 0.95 : f; updateProgress(); } }, token);
        c.uploaded.add(path);
        let posterPath = null;
        if (poster) { posterPath = await uploadBlob(poster, `posts/${c.folder}/${stamp}-cover.${poster.type === 'image/webp' ? 'webp' : 'jpg'}`, () => {}, token).catch((e) => { if (e.cancelled) throw e; return null; }); if (posterPath) c.uploaded.add(posterPath); }
        if (token !== c.uploadToken) return;
        Object.assign(c.media, { status: 'ready', progress: 1, path, poster_path: posterPath, width, height, duration: durationSec });
        renderMedia(); updateButtons();
        setMessage(kind === 'video' ? 'Video uploaded.' : 'Photo uploaded.', 'ok');
      } catch (error) {
        if (error?.cancelled || token !== c.uploadToken) return;
        console.warn('Post upload failed:', error);
        fail(error?.message || 'Upload failed. Check your connection and retry.', Boolean(error?.retryable));
      }
    }
    async function processImage(file) {
      let source;
      try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch { source = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('This photo could not be read. Try a JPG or PNG.')); img.src = URL.createObjectURL(file); }); }
      const w0 = source.width || source.naturalWidth, h0 = source.height || source.naturalHeight;
      const scale = Math.min(1, 1600 / Math.max(w0, h0));
      const width = Math.round(w0 * scale), height = Math.round(h0 * scale);
      const canvas = Object.assign(document.createElement('canvas'), { width, height });
      canvas.getContext('2d').drawImage(source, 0, 0, width, height);
      source.close?.();
      const encode = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
      let blob = await encode('image/webp', 0.85);
      if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.88);
      if (!blob) throw new Error('This photo could not be prepared. Try another photo.');
      if (blob.size > IMAGE_MAX) throw new Error('That photo is still larger than 8 MB after resizing. Choose a smaller photo.');
      return { blob, width, height };
    }
    function probeVideo(url) {
      return new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.preload = 'metadata'; v.muted = true; v.playsInline = true;
        const timer = setTimeout(() => reject(new Error('This video could not be read. Try an MP4 (H.264) file.')), 20000);
        v.onloadedmetadata = () => { const d = v.duration; v.currentTime = Number.isFinite(d) ? Math.min(Math.max(d * 0.15, 0.1), Math.max(d - 0.1, 0)) : 0.1; };
        v.onseeked = async () => {
          clearTimeout(timer);
          let poster = null;
          try {
            const scale = Math.min(1, 1080 / Math.max(v.videoWidth, v.videoHeight));
            const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(v.videoWidth * scale), height: Math.round(v.videoHeight * scale) });
            canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
            poster = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.82));
            if (poster && poster.type !== 'image/webp') poster = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
          } catch { poster = null; }
          resolve({ duration: v.duration, width: v.videoWidth || null, height: v.videoHeight || null, poster });
        };
        v.onerror = () => { clearTimeout(timer); reject(new Error('This video format is not supported by your browser. Try MP4 (H.264).')); };
        v.src = url;
      });
    }
    // Direct Storage upload (same endpoint supabase-js uses) so we get real progress events.
    async function uploadBlob(blob, path, onProgress, token) {
      const { data } = await client().auth.getSession();
      const session = data?.session;
      if (!session) throw Object.assign(new Error('Your owner session has expired. Sign in again, then retry.'), { retryable: true });
      if (token !== c.uploadToken) throw Object.assign(new Error('cancelled'), { cancelled: true });
      const cfg = window.LexcSupabaseConfig;
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest(); c.xhr = xhr;
        xhr.open('POST', `${cfg.url}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`);
        xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
        xhr.setRequestHeader('apikey', cfg.key);
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.setRequestHeader('cache-control', 'max-age=3600');
        xhr.setRequestHeader('content-type', blob.type);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve(path);
          let msg = ''; try { msg = JSON.parse(xhr.responseText).message || ''; } catch {}
          const retryable = (text) => Object.assign(new Error(text), { retryable: true });
          if (xhr.status === 413 || /size|large/i.test(msg)) reject(new Error('That file is too large to upload.'));
          else if (xhr.status === 401 || xhr.status === 403 || /row-level|security|jwt/i.test(msg)) reject(retryable('Only the store owner can upload. Sign in again with the owner account, then retry.'));
          else if (/mime|type/i.test(msg)) reject(new Error('That file type is not supported.'));
          else reject(retryable('Upload failed. Please retry.'));
        };
        xhr.onerror = () => reject(Object.assign(new Error('Upload failed. Check your connection and retry.'), { retryable: true }));
        xhr.onabort = () => reject(Object.assign(new Error('cancelled'), { cancelled: true }));
        xhr.send(blob);
      });
    }

    function payload() {
      const m = c.media && c.media.status === 'ready' ? c.media : null;
      return { caption: c.caption, media_kind: m ? m.kind : 'none', media_path: m?.path || null, poster_path: m?.kind === 'video' ? m.poster_path || null : null,
        media_width: m?.width || null, media_height: m?.height || null, media_duration: m?.duration ?? null, media_alt: m ? c.alt.trim() : '', product_id: c.product?.id || null };
    }
    async function save(kind, { closeAfter = false } = {}) {
      if (!canSave()) return;
      const action = kind === 'draft' ? 'draft' : (!c.post || c.post.status === 'draft') ? 'publish' : 'save';
      c.busy = true; updateButtons();
      setMessage(action === 'draft' ? 'Saving draft…' : action === 'publish' ? 'Publishing…' : 'Saving changes…');
      try {
        const row = await LexcBackend.rpc('save_store_post', { p_post_id: c.post?.id || null, p_request_id: c.requestId, p_action: action, p_payload: payload() });
        c.post = row; c.baseline = snapshot(); c.busy = false;
        cleanup();
        state.stale = true;
        if (action === 'draft') {
          if (closeAfter) { showToast(row.status === 'draft' ? 'Draft saved.' : 'Edits saved privately. Customers still see the live post.'); close(); refreshFeed(); return; }
          c.view = 'edit'; render();
          setMessage(row.status === 'draft' ? `Draft saved at ${new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}.` : 'Edits saved privately. Customers still see the live post until you choose Save changes.', 'ok');
        } else {
          c.successAction = action; c.view = 'success'; render();
        }
        refreshFeed();
      } catch (error) {
        c.busy = false;
        console.warn('Post could not be saved:', error);
        if (c.view === 'confirm') { c.view = 'edit'; render(); }
        setMessage(friendlyError(error, action === 'draft' ? 'The draft could not be saved. Your post is still here — try again.' : 'The post could not be published. Your post is still here — try again.'), 'error');
      } finally { updateButtons(); }
    }
    return { open, isOpen: () => Boolean(dialog?.open) };
  })();

  function refreshFeed() { if (page.classList.contains('active')) load(true); else state.loaded = false; }
  async function showLive(id) {
    if (!page.classList.contains('active')) navigate('fresh');
    state.mode = 'live';
    page.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === 'live')));
    if (state.kind !== 'all') selectKind('all'); else load(true);
    openPostById(id);
  }

  // ---- Owner visibility ----------------------------------------------------------------------
  function syncOwner() {
    const owner = isOwner();
    document.querySelectorAll('[data-fresh-owner]').forEach((el) => { el.hidden = !owner; });
    if (owner === state.owner) return;
    state.owner = owner;
    if (!owner && state.mode !== 'live') { state.mode = 'live'; page.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === 'live'))); }
    if (page.classList.contains('active')) load(true); else state.loaded = false;
  }
  const baseUpdateNavAuth = window.updateNavAuth;
  window.updateNavAuth = function updateNavAuth() { baseUpdateNavAuth.apply(this, arguments); syncOwner(); };

  function show() {
    const nav = document.getElementById('mainNav');
    page.style.setProperty('--fresh-top', `${nav?.offsetHeight || 70}px`);
    syncOwner();
    if (!state.loaded || state.stale) { state.stale = false; load(true); } else relayout();
  }

  window.LexcFresh = Object.freeze({ show, open: showLive, compose: (opts = {}) => { if (!page.classList.contains('active')) navigate('fresh'); Composer.open(opts); } });

  // Deep links: ?post=<id> opens that published post, ?fresh=1 opens the feed (Admin shortcut).
  const params = new URL(location.href).searchParams;
  if (params.has('post') || params.has('fresh')) {
    navigate('fresh');
    if (params.has('fresh')) { const u = new URL(location.href); u.searchParams.delete('fresh'); history.replaceState(history.state, '', u); }
    if (params.get('post')) openPostById(params.get('post'));
  } else if (page.classList.contains('active')) show();
})();
