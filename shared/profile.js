// Customer profile (the Profile tab): a header band (photo, name; Settings · Cart · Chat beside it), My Purchases
// (To confirm · To pay · Baking · Ready · To rate, each listing its orders with the next action), Explore (the old
// "More" menu), and account details (editable). Guests see a welcome card with Log in and Explore.
// Name, phone, address and photo are saved on the customer's own profile row (phase 56); the photo is private
// (avatars/<user>/…), shown through a short-lived link.
(() => {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => '₱' + Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const when = (v) => new Date(v).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
  const icon = (d) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    bag: '<path d="M6 7h12l-1 14H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/>',
    cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.4 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
    list: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chart: '<path d="M6 20V12M12 20V6M18 20v-9"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    back: '<path d="m15 6-6 6 6 6"/>', chev: '<path d="m9 6 6 6-6 6"/>', camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    chat: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h3M3 9h15"/>',
    whisk: '<path d="M5 19 14 10"/><path d="M14 10c-2-4 0-8 4-8s5 4 1 7z"/>', truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>', box: '<path d="M3 7 12 3l9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    star: '<path d="M12 3l2.6 5.4 5.9.9-4.3 4.1 1 5.9L12 16.6 6.8 19.3l1-5.9L3.5 9.3l5.9-.9z"/>', spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1s6 1 6 1 6 2 6-1-4-3-6 1"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
  };
  // My Purchases: which orders sit in each tile (an order can be in two, e.g. "To receive" and still "To pay")
  const onTheWay = (o) => o.fulfillment_method === 'lalamove' && o.status !== 'cancelled' && ['booked', 'picked_up'].includes(buy.deliveries.get(o.id)?.step);
  const due = (o) => o.total_amount == null ? 0 : Math.max(0, Math.round((Number(o.total_amount) - Number(o.amount_paid || 0)) * 100) / 100);
  const TILES = [
    ['confirm', 'Pending', 'clock', (o) => o.status === 'pending'],
    ['pay', 'To pay', 'wallet', (o) => ['confirmed', 'preparing', 'ready'].includes(o.status) && due(o) > 0 && o.payment_status !== 'verification_pending'],
    ['receive', 'To receive', 'truck', onTheWay],
    ['ready', 'Ready', 'box', (o) => o.status === 'ready'],
    ['rate', 'To rate', 'star', (o) => o.status === 'completed' && !buy.reviewed.has(o.id)]
  ];
  let buy = null, buyTab = null;
  async function loadPurchases() {
    const db = window.LexcBackend, me = window.currentUser.id;
    const orders = (await db.orders()).filter((o) => o.customer_id === me);
    let reviewed = new Set();
    if (orders.length) try { reviewed = new Set(db.unwrap(await db.client.from('reviews').select('order_id').in('order_id', orders.map((o) => o.id))).map((r) => r.order_id)); } catch {}
    // Lalamove deliveries: "To receive" holds orders whose rider is on the way (phase 88: the customer confirms receipt)
    let deliveries = new Map();
    if (orders.length) try { deliveries = new Map(db.unwrap(await db.client.from('order_deliveries').select('order_id,step,tracking_url').in('order_id', orders.map((o) => o.id))).map((d) => [d.order_id, d])); } catch {}
    buy = { orders, reviewed, deliveries };
  }
  let pwOpen = false, profile = null, editing = false, photoUrl = '', saving = false, panel = null, panelData = null;
  const root = () => document.getElementById('profileRoot');

  async function load() {
    const user = window.currentUser;
    const db = window.LexcBackend;
    profile = db.unwrap(await db.client.from('profiles').select('*').eq('id', user.id).maybeSingle()) || { id: user.id };
    photoUrl = profile.avatar_path ? await db.privateImage('avatars', profile.avatar_path).catch(() => '') : '';
  }
  function row(ic, label, value, field, type = 'text') {
    const on = field && (editing === true || editing === field);
    const pen = field && !on ? `<button type="button" class="pf-pen" data-pf-field="${field}" aria-label="Edit ${label.toLowerCase()}">${icon(ICONS.edit)}</button>` : '';
    return `<div class="pf-row${pen ? ' has-pen' : ''}"><span class="pf-ic">${icon(ICONS[ic])}</span><span class="pf-label">${label}</span>${on
      ? `<${field === 'address' ? 'textarea rows="2"' : `input type="${type}"`} class="pf-input" name="${field}" maxlength="${field === 'address' ? 300 : 80}" ${field === 'full_name' ? 'required' : ''}${field === 'address' ? `>${esc(value || '')}</textarea>` : ` value="${esc(value || '')}">`}`
      : `<span class="pf-value${value ? '' : ' is-empty'}">${esc(value || 'Not added yet')}</span>`}${pen}</div>`;
  }
  const action = (ic, label, act, note = '') => `<button type="button" class="pf-action" data-pf="${act}"><span class="pf-ic">${icon(ICONS[ic])}</span><span>${label}${note ? `<small>${note}</small>` : ''}</span>${icon(ICONS.chev)}</button>`;

  // accounts made with Continue with Google have no password until one is set here
  const viaGoogle = () => (window.currentUser?.app_metadata?.providers || [window.currentUser?.app_metadata?.provider]).includes('google');
  const cartCount = () => (typeof cart !== 'undefined' ? cart.reduce((n, c) => n + Number(c.qty || 0), 0) : 0);
  function band(user, name, initials) {
    const count = cartCount();
    return `<header class="pf-band">
      <div class="pf-photo">${photoUrl ? `<img src="${esc(photoUrl)}" alt="Your profile photo">` : `<span>${esc(initials)}</span>`}
        ${user ? `<label class="pf-photo-btn" aria-label="Change profile photo">${icon(ICONS.camera)}<input type="file" accept="image/jpeg,image/png,image/webp" data-pf-photo hidden></label>` : ''}</div>
      <div class="pf-band-who"><p class="lx-eyebrow">${user ? 'My account' : 'Cakes · Treats · Sweeter moments'}</p><h1>${user ? esc(name || 'Your name') : 'Welcome to <em>LexC’s.</em>'}</h1><p>${esc(user ? user.email || '' : 'Homemade pastries from San Roque, Cavite City')}</p></div>
      <div class="pf-band-tools">${user ? `<button type="button" class="pf-tool" data-pf="settings" aria-label="Account settings">${icon(ICONS.gear)}</button>
        <button type="button" class="pf-tool" data-pf="cart" aria-label="Cart${count ? ', ' + count + ' item' + (count === 1 ? '' : 's') : ''}">${icon(ICONS.cart)}<i class="mnav-badge"${count ? '' : ' hidden'}>${count > 99 ? '99+' : count}</i></button>
        <a class="pf-tool" href="chat/" aria-label="Messages with LexC’s">${icon(ICONS.chat)}</a>` : ''}</div>
    </header>`;
  }
  function purchases() {
    const head = `<div class="pf-buy-head"><h2>My <em>purchases</em></h2><button type="button" data-pf="orders">View purchase history${icon(ICONS.chev)}</button></div>`;
    if (!buy) return `<section class="pf-buy" aria-label="My purchases">${head}<div class="pf-buy-skel" role="status" aria-label="Loading your orders">${'<span class="skel"></span>'.repeat(5)}</div></section>`;
    const tiles = TILES.map(([k, label, ic, test]) => { const n = buy.orders.filter(test).length;
      return `<button type="button" class="pf-tile" data-pf-tab="${k}" aria-pressed="${buyTab === k}" aria-label="${label}${n ? ', ' + n : ''}"><span class="pf-tile-ic">${icon(ICONS[ic])}<i class="mnav-badge"${n ? '' : ' hidden'}>${n}</i></span>${label}</button>`; }).join('');
    let list = '';
    if (buyTab) {
      const [, label, , test] = TILES.find((t) => t[0] === buyTab), rows = buy.orders.filter(test);
      const EMPTY = { confirm: 'Nothing waiting for confirmation.', pay: 'Nothing to pay right now.', receive: 'Nothing on the way right now.', ready: 'Nothing ready yet.', rate: 'No orders to rate.' };
      list = rows.length ? `<ul class="pf-orders" aria-label="${label}">${rows.slice(0, 8).map(orderRow).join('')}</ul>` : `<p class="pf-buy-empty">${EMPTY[buyTab]}</p>`;
    }
    return `<section class="pf-buy" aria-label="My purchases">${head}<div class="pf-tiles">${tiles}</div>${list}</section>`;
  }
  function orderRow(o) {
    const items = o.order_items || [], first = items[0]?.name_snapshot || 'Order', more = items.length > 1 ? ` +${items.length - 1} more` : '';
    const local = typeof products !== 'undefined' ? products.find((p) => p.name === first) : null, img = local && typeof PRODUCT_IMAGES !== 'undefined' ? PRODUCT_IMAGES[local.id] : '';
    const d = due(o), pickup = o.fulfillment_method !== 'lalamove';
    const A = {
      confirm: o.price_review?.status === 'awaiting' ? [`payment/index.html?order=${o.id}`, 'Review price', ''] : [`chat/?order=${o.id}`, 'Message', ' is-quiet'],
      pay: [`payment/index.html?order=${o.id}`, 'Pay ' + money(Number(o.amount_paid || 0) < Number(o.deposit_due || 0) ? Number(o.deposit_due) - Number(o.amount_paid || 0) : d), ''],
      receive: [null, 'I received it', ''], ready: [null, pickup ? 'Pickup info' : 'Track rider', ''], rate: [null, 'Rate', '']
    }[buyTab];
    const sub = { confirm: 'Waiting for LexC’s to confirm', pay: d > 0 ? money(d) + ' left to pay' : 'Paid', receive: 'On the way with Lalamove', ready: pickup ? 'Ready for pickup' : 'Ready for delivery', rate: 'Completed' }[buyTab];
    const action = buyTab === 'receive' ? `<button type="button" class="pf-order-act" data-received="${esc(o.id)}"><span>${esc(A[1])}</span></button>`
      : A[0] ? `<a class="pf-order-act${A[2]}" href="${esc(A[0])}">${esc(A[1])}</a>` : `<button type="button" class="pf-order-act${A[2]}" data-pf-order="${esc(o.id)}" data-pf-do="${buyTab}">${esc(A[1])}</button>`;
    return `<li class="pf-order"><span class="pf-order-thumb" aria-hidden="true">${img ? `<img src="${esc(img)}" alt="">` : esc(first.slice(0, 1))}</span>
      <span class="pf-order-main"><strong>${esc(first + more)}</strong><span>#${esc(o.order_number)} · ${esc(sub)}</span><em>${o.total_amount == null ? 'Total pending' : money(o.total_amount)}</em></span>${action}</li>`;
  }
  function explore() {
    const go = (ic, label, act) => `<button type="button" data-pf="${act}">${icon(ICONS[ic])}${label}</button>`;
    return `<section class="pf-card"><h3>Explore <em>more</em></h3><div class="pf-explore">${go('bag', 'Shop', 'shop')}${go('wand', 'Customize', 'diy')}${go('spark', 'Sweet moments', 'fresh')}${go('gift', 'Packages', 'packages')}${go('chat', 'Messages', 'chatpage')}${go('info', 'About', 'about')}${go('sun', 'Display', 'display')}</div></section>`;
  }
  function drawGuest() {
    root().innerHTML = `<div class="pf-guest">${band(null, '', 'L')}
      <section class="pf-card"><h3>Your orders, <em>all in one place</em></h3><p class="pf-empty" style="text-align:left;margin:0 0 12px">Log in to see what’s waiting to be paid, what’s baking, and what’s ready — and get notified at every step.</p>
        <div class="pf-guest-cta"><button type="button" class="is-primary" data-pf="login">Log in</button><button type="button" data-pf="register" style="border:1px solid #d9c9f0">Create account</button></div></section>
      ${explore()}</div>`;
  }
  function draw() {
    if (!window.currentUser) return drawGuest();
    const user = window.currentUser, name = profile.full_name || user.name || '', initials = (name || user.email || '?').slice(0, 2).toUpperCase();
    root().innerHTML = `${band(user, name, initials)}
      <div class="pf-cols"><div class="pf-col">${purchases()}${explore()}</div><div class="pf-col">
      <form class="pf-card" data-pf-form id="pfAccount"><div class="pf-card-head"><h3>Account <em>details</em></h3><button type="button" class="pf-round" data-pf="edit" aria-label="${editing ? 'Cancel editing' : 'Edit account details'}" aria-pressed="${!!editing}">${icon(editing ? ICONS.x : ICONS.edit)}</button></div>
        ${row('user', 'Full name', profile.full_name, 'full_name')}
        <div class="pf-row pf-pass"><span class="pf-ic">${icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')}</span><span class="pf-label">Password</span><span class="pf-value">••••••••</span><button type="button" class="pf-forgot" data-pf="pw" aria-expanded="${pwOpen}">${pwOpen ? 'Close' : 'Change'}</button></div>
        ${pwOpen ? `<div class="pf-pwform" data-pf-pwform>
          <label>Current password<input type="password" name="pw_current" autocomplete="current-password">${viaGoogle() ? '<small class="pf-hint">Signed up with Google and never set a password? Leave this blank.</small>' : ''}</label>
          <label>New password<input type="password" name="pw_new" autocomplete="new-password" data-pw-live></label>
          ${typeof window.passwordChecklistHTML === 'function' ? window.passwordChecklistHTML() : ''}
          <label>Confirm new password<input type="password" name="pw_confirm" autocomplete="new-password" data-pw-confirm></label>
          <p class="pf-error" data-pw-msg hidden></p>
          <div class="pf-form-actions"><button type="button" class="pf-btn" data-pf="pwsave">Save new password</button></div>
          <p class="pf-pw-forgot">Forgot your current password? <button type="button" data-pf="reset">Email me a reset link</button></p>
        </div>` : ''}
        ${row('mail', 'Email', user.email, null)}
        ${row('phone', 'Contact number', profile.phone, 'phone', 'tel')}
        ${row('pin', 'Address', profile.address, 'address')}
        ${editing ? `<div class="pf-form-actions"><button type="button" class="pf-btn pf-btn--quiet" data-pf="edit">Cancel</button><button type="submit" class="pf-btn">${saving ? 'Saving…' : 'Save changes'}</button></div>` : ''}
        <p class="pf-error" role="alert" hidden></p>
      </form>
      <section class="pf-card"><h3>Your <em>records</em></h3><div class="pf-actions">
        ${action('list', 'Order history', 'orders')}${action('x', 'Cancelled orders', 'cancelled')}${action('chart', 'Order transactions', 'payments', 'Payments you have sent')}
      </div></section>
      <button type="button" class="pf-logout" data-pf="logout">Log out</button>
      </div></div>
      ${panel ? panelCard() : ''}`;
  }
  // Order history, cancelled orders and payments: one compact card at a time, under Activities
  const PANELS = { orders: 'Order history', cancelled: 'Cancelled orders', payments: 'Order transactions' };
  const STATUS = { pending: 'Waiting for LexC’s', confirmed: 'Confirmed', preparing: 'Being made', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled',
    awaiting_payment: 'Waiting for transfer', verification_pending: 'Being verified', paid: 'Verified', rejected: 'Rejected', refunded: 'Refunded', cancelled: 'Cancelled' };
  const tone = (st) => ['paid', 'completed', 'ready', 'confirmed'].includes(st) ? 'ok' : ['rejected', 'cancelled'].includes(st) ? 'bad' : 'wait';
  const pill = (st) => `<em class="pf-pill is-${tone(st)}">${esc(STATUS[st] || st)}</em>`;
  const paymentURL = (id) => new URL('payment/index.html?order=' + encodeURIComponent(id), document.baseURI).href;
  function panelCard() {
    const rows = panelData || [];
    const empty = { orders: 'No orders yet.', cancelled: 'No cancelled orders.', payments: 'No payments yet.' }[panel];
    const body = !panelData ? '<p class="pf-empty">Loading…</p>' : !rows.length ? `<p class="pf-empty">${empty}</p>` : `<ul class="pf-mini">${rows.map((r) => panel === 'payments'
      ? `<li><span class="pf-mini-main"><strong>Order #${esc(r.order_number ?? '')}</strong><small>${when(r.created_at)}</small></span><b>${money(r.amount)}</b>${pill(r.status)}</li>`
      : `<li><a href="${esc(paymentURL(r.id))}"><span class="pf-mini-main"><strong>Order #${esc(r.order_number)}</strong><small>${when(r.created_at)} · ${r.items} item${r.items === 1 ? '' : 's'}</small></span><b>${r.total_amount == null ? '—' : money(r.total_amount)}</b>${pill(r.status)}</a></li>`).join('')}</ul>`;
    return `<div class="pf-float" data-pf-backdrop><section class="pf-panel" id="pfPanel" role="dialog" aria-modal="true" aria-label="${PANELS[panel]}"><div class="pf-card-head"><h3>${PANELS[panel]}</h3><button type="button" class="pf-close" data-pf="${panel}" aria-label="Close ${PANELS[panel].toLowerCase()}">×</button></div>${body}</section></div>`;
  }
  async function openPanel(kind) {
    if (panel === kind) { panel = null; panelData = null; draw(); return; }
    panel = kind; panelData = null; draw(); root().querySelector('.pf-panel .pf-close')?.focus();
    const db = window.LexcBackend, me = window.currentUser.id;
    try {
      let data;
      if (kind === 'payments') {
        // payments link to orders twice in the database, so order numbers are looked up separately
        const rows = db.unwrap(await db.client.from('order_payment_attempts').select('id,order_id,amount,status,created_at').order('created_at', { ascending: false }).limit(50));
        const ids = [...new Set(rows.map((r) => r.order_id))], numbers = new Map();
        if (ids.length) db.unwrap(await db.client.from('orders').select('id,order_number').in('id', ids)).forEach((o) => numbers.set(o.id, o.order_number));
        data = rows.map((r) => ({ ...r, order_number: numbers.get(r.order_id) }));
      } else {
        let q = db.client.from('orders').select('id,order_number,created_at,total_amount,status,order_items(quantity)').eq('customer_id', me).order('created_at', { ascending: false }).limit(50);
        q = kind === 'cancelled' ? q.eq('status', 'cancelled') : q.neq('status', 'cancelled');
        data = db.unwrap(await q).map((o) => ({ ...o, items: (o.order_items || []).reduce((n, i) => n + Number(i.quantity || 0), 0) }));
      }
      if (panel === kind) { panelData = data; draw(); }
    } catch (e) { panel = null; draw(); window.showToast?.(e.message); }
  }
  function error(text) { const box = root().querySelector('.pf-error'); if (box) { box.textContent = text; box.hidden = !text; } }

  async function show() {
    editing = false; panel = null; panelData = null; buy = null;
    if (!window.currentUser) { photoUrl = ''; drawGuest(); return; }
    root().innerHTML = '<div class="pf-loading" role="status"><span class="skel skel-circle"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--short"></span></div>';
    try { await load(); draw(); } catch (e) { root().innerHTML = `<p class="pf-empty" role="alert">Your profile could not load: ${esc(e.message)}</p>`; return; }
    try { await loadPurchases(); } catch (e) { console.warn('Purchases failed:', e); buy = { orders: [], reviewed: new Set(), deliveries: new Map() }; }
    if (document.getElementById('page-profile')?.classList.contains('active')) draw();
  }
  // after "I received it": the order leaves To receive (the tab stays open)
  document.addEventListener('lexc:order-received', async () => {
    if (!window.currentUser || !buy) return;
    try { await loadPurchases(); } catch {}
    if (document.getElementById('page-profile')?.classList.contains('active')) draw();
  });

  document.addEventListener('click', async (event) => {
    const b = event.target.closest?.('#profileRoot [data-pf]'); if (!b) return;
    const act = b.dataset.pf;
    if (act === 'back') return history.length > 1 ? history.back() : window.navigate('home');
    if (act === 'edit') { editing = editing ? false : true; draw(); if (editing) root().querySelector('[name=full_name]')?.focus(); return; }
    if (act === 'logout') return window.handleLogout?.();
    if (act === 'pw') { pwOpen = !pwOpen; draw(); root().querySelector('[name=pw_current]')?.focus(); return; }
    if (act === 'pwsave') {
      // no email: check the current password, then save the new one right away
      // (a Google account that never had a password leaves Current password blank and sets one directly)
      const box = root().querySelector('[data-pf-pwform]'), msg = box.querySelector('[data-pw-msg]'), say = (t, ok) => { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('is-ok', !!ok); };
      const cur = box.querySelector('[name=pw_current]').value, nw = box.querySelector('[name=pw_new]').value, cf = box.querySelector('[name=pw_confirm]').value;
      if (!cur && !viaGoogle()) return say('Enter your current password.');
      const weak = typeof window.passwordProblem === 'function' ? window.passwordProblem(nw) : (nw.length < 8 ? 'Use at least 8 characters.' : '');
      if (weak) return say(weak);
      if (nw !== cf) return say('The new passwords do not match.');
      if (cur && nw === cur) return say('Choose a password different from the current one.');
      b.disabled = true; b.textContent = 'Saving…';
      try {
        if (cur) {
          const check = await window.LexcBackend.client.auth.signInWithPassword({ email: window.currentUser.email, password: cur });
          if (check.error) throw new Error(viaGoogle() ? 'That is not your current password. If you have never set one, leave Current password blank.' : 'Your current password is not correct.');
        }
        window.LexcBackend.unwrap(await window.LexcBackend.client.auth.updateUser({ password: nw }));
        pwOpen = false; draw(); window.showToast?.(cur ? 'Password changed.' : 'Password set. You can now also log in with your email and password.');
      } catch (e) { say(/reauthenticat/i.test(e.message) ? 'For your security, log out, sign in again with Google, then set your password right away.' : e.message); b.disabled = false; b.textContent = 'Save new password'; }
      return;
    }
    if (act === 'reset') {
      // emails a secure link; opening it shows "Set a new password" on the site
      b.disabled = true; b.textContent = 'Sending…';
      try { window.LexcBackend.unwrap(await window.LexcBackend.client.auth.resetPasswordForEmail(window.currentUser.email, { redirectTo: new URL('index.html', document.baseURI).href })); window.showToast?.('We emailed a password reset link to ' + window.currentUser.email + '. Check spam if you don’t see it.'); b.textContent = 'Link sent'; }
      catch (e) { window.showToast?.(/rate limit/i.test(e.message) ? 'Too many emails were sent recently. Please wait an hour, or change your password here using your current password.' : e.message); b.disabled = false; b.textContent = 'Email me a reset link'; }
      return;
    }
    if (act === 'settings') { const box = root().querySelector('#pfAccount'); box?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); box?.querySelector('[data-pf="edit"]')?.focus({ preventScroll: true }); return; }
    if (act === 'login' || act === 'register') return window.navigate(act);
    if (act === 'fresh' || act === 'packages') return window.navigate(act);
    if (act === 'about') return window.navigate('home', 'about');
    if (act === 'chatpage') return void (location.href = 'chat/');
    if (act === 'display') return window.LexcAppearance?.open();
    if (act === 'shop') return window.navigate('shop');
    if (act === 'diy') return window.LexcCustom ? window.LexcCustom.choose() : window.navigate('shop');
    if (act === 'cart') return window.openCart?.();
    if (act === 'orders' || act === 'cancelled' || act === 'payments') return openPanel(act);
  });
  // My Purchases: a tile shows its orders; the order buttons open the order, the rider / pickup info, or the review
  document.addEventListener('click', (event) => {
    const tab = event.target.closest?.('#profileRoot [data-pf-tab]');
    if (tab) { buyTab = buyTab === tab.dataset.pfTab ? null : tab.dataset.pfTab; draw(); root().querySelector(`[data-pf-tab="${buyTab}"]`)?.focus({ preventScroll: true }); return; }
    const go = event.target.closest?.('#profileRoot [data-pf-order]');
    if (go) { const id = go.dataset.pfOrder; if (go.dataset.pfDo === 'rate' && typeof window.showReviewForm === 'function') return window.showReviewForm(id); return window.openCart?.(id); }
  });
  document.addEventListener('click', (event) => {
    const pen = event.target.closest?.('#profileRoot [data-pf-field]');
    if (pen) { editing = pen.dataset.pfField; draw(); const box = root().querySelector(`[name=${editing}]`); box?.focus(); box?.select?.(); return; }
    if (event.target.matches?.('#profileRoot [data-pf-backdrop]')) { panel = null; panelData = null; draw(); }
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && panel && root()?.isConnected) { panel = null; panelData = null; draw(); } });
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest?.('[data-pf-form]'); if (!form) return;
    event.preventDefault(); if (saving) return;
    const f = form.elements, full_name = (f.full_name ? f.full_name.value : profile.full_name || '').trim(), phone = (f.phone ? f.phone.value : profile.phone || '').trim(), address = (f.address ? f.address.value : profile.address || '').trim();
    if (full_name.length < 2) return error('Enter your full name.');
    if (phone && !/^[+\d][\d\s-]{6,19}$/.test(phone)) return error('Enter a valid contact number.');
    saving = true; draw();
    try {
      profile = window.LexcBackend.unwrap(await window.LexcBackend.client.from('profiles').update({ full_name, phone: phone || null, address: address || null }).eq('id', window.currentUser.id).select().single());
      window.currentUser.name = profile.full_name; window.currentUser.profile = profile; window.updateNavAuth?.();
      editing = false; saving = false; draw(); window.showToast?.('Profile saved.');
    } catch (e) { saving = false; draw(); error(e.message); }
  });
  document.addEventListener('change', async (event) => {
    const input = event.target.closest?.('[data-pf-photo]'); if (!input || !input.files[0]) return;
    const file = input.files[0]; input.value = '';
    try {
      const small = window.LexcInspiration ? await window.LexcInspiration.shrink(file) : file;
      const path = await window.LexcBackend.upload('avatars', window.currentUser.id, small);
      profile = window.LexcBackend.unwrap(await window.LexcBackend.client.from('profiles').update({ avatar_path: path }).eq('id', window.currentUser.id).select().single());
      photoUrl = await window.LexcBackend.privateImage('avatars', path); draw(); window.showToast?.('Profile photo updated.');
    } catch (e) { window.showToast?.(e.message || 'The photo could not be saved.'); }
  });

  window.LexcProfile = Object.freeze({ show });
})();
