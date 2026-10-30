// Customer notifications: order updates, payments and remaining balances, sales, and new posts — one inbox.
// Built only from what the customer can already read (no new tables): their orders, the system messages the
// database writes into each order's chat (status changes, payment verified / not accepted, new price), the
// catalog's current sales and the published store posts. "Read" is remembered per account in this browser.
(() => {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => '₱' + Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const svg = (d) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    check: '<path d="m5 12 4 4 10-10"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    whisk: '<path d="M5 19 14 10"/><path d="M14 10c-2-4 0-8 4-8s5 4 1 7z"/>', bag: '<path d="M6 7h12l-1 14H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    star: '<path d="M12 3l2.6 5.4 5.9.9-4.3 4.1 1 5.9L12 16.6 6.8 19.3l1-5.9L3.5 9.3l5.9-.9z"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h3M3 9h15"/>', alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>', spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    chev: '<path d="m9 6 6 6-6 6"/>', price: '<path d="M12 3v18M16 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8"/>'
  };
  const FILTERS = [['all', 'All'], ['orders', 'Orders'], ['payments', 'Payments'], ['promos', 'Promos'], ['posts', 'Posts']];
  let items = [], dues = [], dueOpen = false, state = 'idle', filter = 'all', loadedFor = null, lastLoad = 0, timer = 0;

  // ---- read state (per account, this browser) -----------------------------------------------
  const key = () => 'lexc_notif_' + (window.currentUser?.id || 'guest');
  function readState() {
    try { const s = JSON.parse(localStorage.getItem(key()) || 'null'); if (s && typeof s.since === 'number') return s; } catch {}
    const s = { since: Date.now() - 3 * 86400000, read: [] }; saveState(s); return s;   // first visit: only the last 3 days count as new
  }
  function saveState(s) { try { localStorage.setItem(key(), JSON.stringify({ since: s.since, read: s.read.slice(-300) })); } catch {} }
  const isUnread = (n, s = readState()) => n.at > s.since && !s.read.includes(n.id);
  function markRead(id) { const s = readState(); if (!s.read.includes(id)) { s.read.push(id); saveState(s); } }
  function markAll() { saveState({ since: Date.now(), read: [] }); paintBadges(); render(); }

  // ---- building the list ----------------------------------------------------------------------
  const remaining = (o) => o.total_amount == null ? 0 : Math.max(0, Math.round((Number(o.total_amount) - Number(o.amount_paid || 0)) * 100) / 100);
  const payURL = (id) => 'payment/index.html?order=' + encodeURIComponent(id);
  function fromMessage(m, o) {
    const n = o ? '#' + o.order_number : '', due = o ? remaining(o) : 0, pickup = o?.fulfillment_method !== 'lalamove';
    const base = { id: 'msg:' + m.id, at: Date.parse(m.created_at), order: o?.id };
    if (m.message_type === 'status_update') {
      const st = (/changed to ([a-z_ ]+)/i.exec(m.body || '')?.[1] || '').trim().replace(/ /g, '_');
      const T = {
        confirmed: ['orders', 'check', 'ok', `Order ${n} is confirmed`, due > 0 ? `You can pay the ${Number(o?.amount_paid) > 0 ? 'rest' : 'downpayment'} now — ${money(o?.amount_paid > 0 ? due : (o?.deposit_due ?? due))}.` : 'LexC’s will start on it soon.', 'pay'],
        preparing: ['orders', 'whisk', 'info', `We’re making order ${n}`, 'Your treats are in the kitchen.', 'order'],
        ready: ['orders', pickup ? 'bag' : 'truck', 'ok', pickup ? `Order ${n} is ready for pickup` : `Order ${n} is ready to go out`, pickup ? 'See your pickup time in My Orders.' : 'Track the rider in My Orders.', 'order'],
        completed: ['orders', 'star', 'ok', `Order ${n} is complete`, 'Enjoy! Tell us how it was — rate your order.', 'rate'],
        cancelled: ['orders', 'x', 'bad', `Order ${n} was cancelled`, 'Message LexC’s if you have questions about this order.', 'chat']
      }[st];
      if (!T) return null;
      return { ...base, kind: T[0], icon: T[1], tone: T[2], title: T[3], body: T[4], act: T[5] };
    }
    if (m.message_type === 'payment_verified') return { ...base, kind: 'payments', icon: 'check', tone: 'ok', title: `Payment verified for order ${n}`, body: due > 0 ? `Remaining balance: ${money(due)}.` : 'Your order is fully paid. Thank you!', act: due > 0 ? 'pay' : 'order' };
    if (m.message_type === 'payment_rejected') return { ...base, kind: 'payments', icon: 'alert', tone: 'bad', title: `Payment not accepted for order ${n}`, body: 'See the reason and send your payment again.', act: 'pay' };
    if (m.message_type === 'payment_proof') return { ...base, kind: 'payments', icon: 'receipt', tone: 'info', title: `Payment received for order ${n}`, body: 'LexC’s is checking it — no need to pay again.', act: 'pay' };
    if (m.message_type === 'price_review') return { ...base, kind: 'orders', icon: 'price', tone: 'warn', title: `New price to accept for order ${n}`, body: 'LexC’s added a charge for your custom work. Accept or decline it.', act: 'pay' };
    return null;
  }
  async function gather() {
    const db = window.LexcBackend, me = window.currentUser, out = [];
    const jobs = [];
    // sales: one per product option on sale (from the catalog the shop already loaded)
    jobs.push((async () => {
      const cat = typeof liveCatalog !== 'undefined' && liveCatalog.length ? liveCatalog : await db.catalog();
      const priced = typeof withSalePrices === 'function' ? withSalePrices(cat) : cat;
      for (const p of priced) for (const v of p.product_variants || []) if (v.is_active && v.sale) {
        const start = v.discount_starts ? Date.parse(v.discount_starts + 'T00:00:00+08:00') : Date.parse(v.updated_at || p.updated_at || '') || Date.now() - 86400000;
        out.push({ id: `sale:${v.id}:${v.sale.type}:${v.sale.value}:${v.sale.ends || ''}`, at: start, kind: 'promos', icon: 'tag', tone: 'sale',
          title: `${p.name}${v.label && !/^option/i.test(v.label) ? ' · ' + v.label : ''} is on sale`,
          body: `Now ${money(v.price)} (was ${money(v.regular_price)})${v.sale.ends ? ' · until ' + new Date(v.sale.ends + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : ''}`,
          act: 'product', product: p.id });
      }
    })().catch(() => {}));
    // new posts
    jobs.push(db.rpc('get_store_feed', { p_kind: 'all', p_before: null, p_before_id: null, p_limit: 8 }).then((rows) => {
      for (const r of rows || []) out.push({ id: 'post:' + r.id, at: Date.parse(r.published_at), kind: 'posts', icon: 'spark', tone: 'post', title: 'New from LexC’s',
        body: (String(r.caption || '').replace(/\s+/g, ' ').trim().slice(0, 110) || 'A new photo was posted.') + (String(r.caption || '').length > 110 ? '…' : ''), act: 'post', post: r.id });
    }).catch(() => {}));
    let orders = [];
    if (me) jobs.push((async () => {
      orders = (await db.orders()).filter((o) => o.customer_id === me.id);
      const byId = new Map(orders.map((o) => [o.id, o]));
      const convs = db.unwrap(await db.client.from('chat_conversations').select('id,order_id').not('order_id', 'is', null));
      const convOrder = new Map(convs.map((c) => [c.id, c.order_id]));
      if (convs.length) {
        const msgs = db.unwrap(await db.client.from('chat_messages').select('id,message_type,body,created_at,conversation_id')
          .in('conversation_id', convs.map((c) => c.id)).eq('sender_type', 'system').order('created_at', { ascending: false }).limit(120));
        for (const m of msgs) { const n = fromMessage(m, byId.get(convOrder.get(m.conversation_id))); if (n) out.push(n); }
      }
      // every order gets its "received" moment, so the list is never silent after checkout
      for (const o of orders) out.push({ id: 'placed:' + o.id, at: Date.parse(o.created_at), kind: 'orders', icon: 'clock', tone: 'info', order: o.id,
        title: `Order #${o.order_number} received`, body: 'LexC’s will check it and confirm. Please don’t pay yet.', act: 'order' });
    })());
    await Promise.all(jobs);
    // balances still to pay (shown pinned at the top, not in the timeline)
    dues = orders.filter((o) => ['confirmed', 'preparing', 'ready'].includes(o.status) && remaining(o) > 0 && o.payment_status !== 'verification_pending')
      .map((o) => ({ id: o.id, number: o.order_number, due: remaining(o), downpayment: Number(o.amount_paid || 0) < Number(o.deposit_due || 0) ? Math.max(0, Number(o.deposit_due) - Number(o.amount_paid || 0)) : null }));
    return out.filter((n) => Number.isFinite(n.at)).sort((a, b) => b.at - a.at).slice(0, 150);
  }
  async function refresh(force = false) {
    const who = window.currentUser?.id || 'guest';
    if (!force && loadedFor === who && Date.now() - lastLoad < 45000) return;
    if (!items.length || loadedFor !== who) { state = 'loading'; render(); }
    try { items = await gather(); state = 'ready'; loadedFor = who; lastLoad = Date.now(); }
    catch (e) { console.warn('Notifications failed:', e); if (!items.length) state = 'error'; }
    paintBadges(); render();
  }

  // ---- badges (bottom bar, desktop bell, profile) ---------------------------------------------
  function paintBadges() {
    const s = readState(), count = items.filter((n) => isUnread(n, s)).length;
    document.querySelectorAll('[data-notif-count]').forEach((b) => { b.hidden = !count; b.textContent = count > 99 ? '99+' : String(count); });
    document.querySelectorAll('[data-notif-bell]').forEach((b) => b.setAttribute('aria-label', count ? `Notifications, ${count} new` : 'Notifications'));
  }

  // ---- page ----------------------------------------------------------------------------------
  const root = () => document.getElementById('notificationsRoot');
  const ago = (t) => {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 7 * 86400) return Math.round(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  };
  function group(t) {
    const d = new Date(t), now = new Date(), day = 86400000, start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return t >= start ? 'Today' : t >= start - day ? 'Yesterday' : t >= start - 6 * day ? 'This week' : 'Earlier';
  }
  function row(n, s) {
    const unread = isUnread(n, s);
    return `<li><button type="button" class="nt-item is-${n.tone}${unread ? ' is-unread' : ''}" data-nt="${esc(n.id)}">
      <span class="nt-ic" aria-hidden="true">${svg(I[n.icon] || I.bell)}</span>
      <span class="nt-text"><strong>${esc(n.title)}</strong><span>${esc(n.body)}</span><small><time datetime="${new Date(n.at).toISOString()}">${ago(n.at)}</time>${unread ? '<i class="nt-new">New</i>' : ''}</small></span>
      <span class="nt-go" aria-hidden="true">${svg(I.chev)}</span></button></li>`;
  }
  function render() {
    const r = root(); if (!r || !document.getElementById('page-notifications')?.classList.contains('active')) return;
    const s = readState(), signedIn = !!window.currentUser;
    const unreadAll = items.filter((n) => isUnread(n, s)).length;
    const counts = Object.fromEntries(FILTERS.map(([k]) => [k, items.filter((n) => (k === 'all' || n.kind === k) && isUnread(n, s)).length]));
    const head = `<header class="nt-head"><div><p class="lx-eyebrow">Orders · Payments · Sweet deals</p><h1 class="lx-title">Your <em>notifications.</em></h1><p class="lx-lede">${unreadAll ? `${unreadAll} new since you last checked` : 'You’re all caught up'}</p></div>
      <button type="button" class="nt-markall" data-nt-all ${unreadAll ? '' : 'disabled'}>${svg(I.check)}Mark all as read</button></header>
      <div class="nt-filters" role="tablist" aria-label="Show">${FILTERS.filter(([k]) => signedIn || ['all', 'promos', 'posts'].includes(k)).map(([k, l]) =>
        `<button type="button" role="tab" aria-selected="${filter === k}" data-nt-filter="${k}">${l}${counts[k] ? `<i>${counts[k]}</i>` : ''}</button>`).join('')}</div>`;
    const totalDue = dues.reduce((sum, d) => sum + d.due, 0);
    const dueCard = signedIn && dues.length && ['all', 'payments', 'orders'].includes(filter) ? `<section class="nt-due" aria-label="Balance to pay">
      <div class="nt-due-top"><span class="nt-ic" aria-hidden="true">${svg(I.wallet)}</span><div><small>Remaining balance</small><strong>${money(totalDue)}</strong></div><span class="nt-due-count">${dues.length} order${dues.length === 1 ? '' : 's'}</span></div>
      <ul>${dues.slice(0, dueOpen ? dues.length : 2).map((d) => `<li><span>Order #${esc(d.number)}<small>${d.downpayment ? 'Downpayment ' + money(d.downpayment) + ' still due' : 'Balance left'}</small></span><a class="nt-pay" href="${payURL(d.id)}">Pay ${money(d.downpayment || d.due)}</a></li>`).join('')}</ul>${dues.length > 2 ? `<button type="button" class="nt-due-more" data-nt-due aria-expanded="${dueOpen}">${dueOpen ? 'Show less' : `Show all ${dues.length}`}</button>` : ''}</section>` : '';
    const guest = !signedIn ? `<section class="nt-guest"><span class="nt-ic" aria-hidden="true">${svg(I.bell)}</span><div><strong>Get updates on your orders</strong><p>Log in to see when your order is confirmed, ready, and how much is left to pay.</p></div><button type="button" class="nt-login" data-nt-login>Log in</button></section>` : '';
    let body;
    if (state === 'loading' && !items.length) body = `<ul class="nt-list" aria-busy="true" aria-label="Loading notifications">${Array.from({ length: 5 }, () => '<li class="nt-skel" aria-hidden="true"><span class="skel skel-circle"></span><span class="nt-skel-lines"><span class="skel skel-line"></span><span class="skel skel-line skel-line--short"></span></span></li>').join('')}</ul>`;
    else if (state === 'error' && !items.length) body = `<div class="nt-empty" role="alert"><span class="nt-ic is-bad" aria-hidden="true">${svg(I.alert)}</span><strong>Notifications couldn’t load</strong><p>Check your connection and try again.</p><button type="button" class="nt-retry" data-nt-retry>Try again</button></div>`;
    else {
      const list = items.filter((n) => filter === 'all' || n.kind === filter);
      if (!list.length) {
        const E = { all: ['You’re all caught up', 'Order updates, sales and new posts will show up here.'], orders: ['No order updates yet', 'When you place an order, every step shows up here.'],
          payments: ['No payment updates yet', 'Verified payments and balances show up here.'], promos: ['No sales right now', 'We’ll let you know when something’s discounted.'], posts: ['No new posts', 'Fresh photos from the kitchen will appear here.'] }[filter];
        body = `<div class="nt-empty"><span class="nt-ic" aria-hidden="true">${svg(I.bell)}</span><strong>${E[0]}</strong><p>${E[1]}</p></div>`;
      } else {
        const groups = []; for (const n of list) { const g = group(n.at); let box = groups.find((x) => x[0] === g); if (!box) groups.push(box = [g, []]); box[1].push(n); }
        body = groups.map(([g, ns]) => `<h2 class="nt-group">${g}</h2><ul class="nt-list">${ns.map((n) => row(n, s)).join('')}</ul>`).join('');
      }
    }
    r.innerHTML = head + guest + dueCard + `<div class="nt-body">${body}</div>`;
  }
  function open(n) {
    markRead(n.id); paintBadges(); render();
    if (n.act === 'pay' && n.order) return void (location.href = payURL(n.order));
    if (n.act === 'rate' && n.order && typeof window.showReviewForm === 'function') return window.showReviewForm(n.order);
    if (n.act === 'chat' && n.order) return void (location.href = 'chat/?order=' + encodeURIComponent(n.order));
    if (n.act === 'order' && n.order) return window.openCart?.(n.order);
    if (n.act === 'post' && n.post) return window.LexcFresh?.open(n.post);
    if (n.act === 'product' && n.product) {
      const local = typeof products !== 'undefined' ? products.find((p) => p.product_id === n.product) : null;
      if (local && typeof window.openProductDetails === 'function') return window.openProductDetails(local.id);
      return window.navigate?.('shop');
    }
    render();
  }

  document.addEventListener('click', (event) => {
    const t = event.target.closest?.('#notificationsRoot [data-nt],#notificationsRoot [data-nt-filter],#notificationsRoot [data-nt-all],#notificationsRoot [data-nt-retry],#notificationsRoot [data-nt-login],#notificationsRoot [data-nt-due]');
    if (!t) return;
    if (t.dataset.ntFilter) { filter = t.dataset.ntFilter; render(); return; }
    if ('ntDue' in t.dataset) { dueOpen = !dueOpen; render(); return; }
    if ('ntAll' in t.dataset) return markAll();
    if ('ntRetry' in t.dataset) return refresh(true);
    if ('ntLogin' in t.dataset) return window.navigate?.('login');
    const n = items.find((x) => x.id === t.dataset.nt); if (n) open(n);
  });

  function show() { if (!FILTERS.some(([k]) => k === filter) || (!window.currentUser && !['all', 'promos', 'posts'].includes(filter))) filter = 'all'; render(); refresh(); }
  // keep the badge fresh: on load, when signing in/out, every 90 s while visible, and when coming back to the tab
  function tick() { clearTimeout(timer); timer = setTimeout(() => { if (!document.hidden) refresh(true); tick(); }, 90000); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  const baseAuth = window.updateNavAuth;
  if (typeof baseAuth === 'function') window.updateNavAuth = function updateNavAuthWithNotifications() { baseAuth.apply(this, arguments); const who = window.currentUser?.id || 'guest'; if (who !== loadedFor) { items = []; dues = []; refresh(true); } else paintBadges(); };
  setTimeout(() => refresh(true), 1500); tick();

  window.LexcNotify = Object.freeze({ show, refresh: () => refresh(true), summary: () => ({ unread: items.filter((n) => isUnread(n)).length, dues: dues.slice() }) });
})();
