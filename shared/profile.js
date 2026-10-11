// Customer profile (My Profile): photo, name, email, account details (editable) and shortcuts to orders.
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
    back: '<path d="m15 6-6 6 6 6"/>', chev: '<path d="m9 6 6 6-6 6"/>', camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'
  };
  let profile = null, editing = false, photoUrl = '', saving = false, panel = null, panelData = null;
  const root = () => document.getElementById('profileRoot');

  async function load() {
    const user = window.currentUser;
    const db = window.LexcBackend;
    profile = db.unwrap(await db.client.from('profiles').select('*').eq('id', user.id).maybeSingle()) || { id: user.id };
    photoUrl = profile.avatar_path ? await db.privateImage('avatars', profile.avatar_path).catch(() => '') : '';
  }
  function row(ic, label, value, field, type = 'text') {
    return `<div class="pf-row"><span class="pf-ic">${icon(ICONS[ic])}</span><span class="pf-label">${label}</span>${editing && field
      ? `<${field === 'address' ? 'textarea rows="2"' : `input type="${type}"`} class="pf-input" name="${field}" maxlength="${field === 'address' ? 300 : 80}" ${field === 'full_name' ? 'required' : ''}${field === 'address' ? `>${esc(value || '')}</textarea>` : ` value="${esc(value || '')}">`}`
      : `<span class="pf-value${value ? '' : ' is-empty'}">${esc(value || 'Not added yet')}</span>`}</div>`;
  }
  const action = (ic, label, act, note = '') => `<button type="button" class="pf-action" data-pf="${act}"><span class="pf-ic">${icon(ICONS[ic])}</span><span>${label}${note ? `<small>${note}</small>` : ''}</span>${icon(ICONS.chev)}</button>`;

  function draw() {
    const user = window.currentUser, name = profile.full_name || user.name || '', initials = (name || user.email || '?').slice(0, 2).toUpperCase();
    root().innerHTML = `<header class="pf-head"><button type="button" class="pf-round" data-pf="back" aria-label="Back">${icon(ICONS.back)}</button><h1>My Profile</h1>
        <button type="button" class="pf-round" data-pf="edit" aria-label="${editing ? 'Cancel editing' : 'Edit profile'}" aria-pressed="${editing}">${icon(editing ? ICONS.x : ICONS.edit)}</button></header>
      <div class="pf-grid"><aside class="pf-side"><section class="pf-hero">
        <div class="pf-photo">${photoUrl ? `<img src="${esc(photoUrl)}" alt="Your profile photo">` : `<span>${esc(initials)}</span>`}
          <label class="pf-photo-btn" aria-label="Change profile photo">${icon(ICONS.camera)}<input type="file" accept="image/jpeg,image/png,image/webp" data-pf-photo hidden></label></div>
        <h2>${esc(name || 'Your name')}</h2><p>${esc(user.email || '')}</p><span class="pf-badge">Customer account</span>
      </section><button type="button" class="pf-logout" data-pf="logout">Log out</button></aside><div class="pf-main">
      <form class="pf-card" data-pf-form><h3>Account Details</h3>
        ${row('user', 'Full name', profile.full_name, 'full_name')}
        ${row('mail', 'Email', user.email, null)}
        ${row('phone', 'Contact number', profile.phone, 'phone', 'tel')}
        ${row('pin', 'Address', profile.address, 'address')}
        ${editing ? `<div class="pf-form-actions"><button type="button" class="pf-btn pf-btn--quiet" data-pf="edit">Cancel</button><button type="submit" class="pf-btn">${saving ? 'Saving…' : 'Save changes'}</button></div>` : ''}
        <p class="pf-error" role="alert" hidden></p>
      </form>
      <section class="pf-card"><h3>Activities</h3><div class="pf-actions">
        ${action('bag', 'Shop', 'shop')}${action('wand', 'DIY customization', 'diy')}${action('cart', 'Cart', 'cart')}
        ${action('list', 'Order history', 'orders')}${action('x', 'Cancelled orders', 'cancelled')}${action('chart', 'Order transactions', 'payments', 'Payments you have sent')}
      </div></section>
      ${panel ? panelCard() : ''}
      </div></div>`;
  }
  // Order history, cancelled orders and payments: one compact card at a time, under Activities
  const PANELS = { orders: 'Order history', cancelled: 'Cancelled orders', payments: 'Order transactions' };
  const STATUS = { pending: 'Waiting for LexC’s', confirmed: 'Confirmed', preparing: 'Being made', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled',
    awaiting_payment: 'Waiting for transfer', verification_pending: 'Being verified', paid: 'Verified', rejected: 'Rejected', refunded: 'Refunded' };
  const tone = (st) => ['paid', 'completed', 'ready', 'confirmed'].includes(st) ? 'ok' : ['rejected', 'cancelled'].includes(st) ? 'bad' : 'wait';
  const pill = (st) => `<em class="pf-pill is-${tone(st)}">${esc(STATUS[st] || st)}</em>`;
  const paymentURL = (id) => new URL('payment/index.html?order=' + encodeURIComponent(id), document.baseURI).href;
  function panelCard() {
    const rows = panelData || [];
    const empty = { orders: 'No orders yet.', cancelled: 'No cancelled orders.', payments: 'No payments yet.' }[panel];
    const body = !panelData ? '<p class="pf-empty">Loading…</p>' : !rows.length ? `<p class="pf-empty">${empty}</p>` : `<ul class="pf-mini">${rows.map((r) => panel === 'payments'
      ? `<li><span class="pf-mini-main"><strong>Order #${esc(r.order_number ?? '')}</strong><small>${when(r.created_at)}</small></span><b>${money(r.amount)}</b>${pill(r.status)}</li>`
      : `<li><a href="${esc(paymentURL(r.id))}"><span class="pf-mini-main"><strong>Order #${esc(r.order_number)}</strong><small>${when(r.created_at)} · ${r.items} item${r.items === 1 ? '' : 's'}</small></span><b>${r.total_amount == null ? '—' : money(r.total_amount)}</b>${pill(r.status)}</a></li>`).join('')}</ul>`;
    return `<section class="pf-card pf-panel" id="pfPanel"><div class="pf-card-head"><h3>${PANELS[panel]}</h3><button type="button" class="pf-close" data-pf="${panel}" aria-label="Close ${PANELS[panel].toLowerCase()}">×</button></div>${body}</section>`;
  }
  async function openPanel(kind) {
    if (panel === kind) { panel = null; panelData = null; draw(); return; }
    panel = kind; panelData = null; draw(); document.getElementById('pfPanel')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
    if (!window.currentUser) { window.navigate('login'); return; }
    root().innerHTML = '<div class="pf-loading" role="status"><span class="skel skel-circle"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--short"></span></div>';
    editing = false; panel = null; panelData = null;
    try { await load(); draw(); } catch (e) { root().innerHTML = `<p class="pf-empty" role="alert">Your profile could not load: ${esc(e.message)}</p>`; }
  }

  document.addEventListener('click', async (event) => {
    const b = event.target.closest?.('#profileRoot [data-pf]'); if (!b) return;
    const act = b.dataset.pf;
    if (act === 'back') return history.length > 1 ? history.back() : window.navigate('home');
    if (act === 'edit') { editing = !editing; draw(); if (editing) root().querySelector('[name=full_name]')?.focus(); return; }
    if (act === 'logout') return window.handleLogout?.();
    if (act === 'shop') return window.navigate('shop');
    if (act === 'diy') return window.LexcCustom ? window.LexcCustom.choose() : window.navigate('shop');
    if (act === 'cart') return window.openCart?.();
    if (act === 'orders' || act === 'cancelled' || act === 'payments') return openPanel(act);
  });
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest?.('[data-pf-form]'); if (!form) return;
    event.preventDefault(); if (saving) return;
    const f = form.elements, full_name = f.full_name.value.trim(), phone = f.phone.value.trim(), address = f.address.value.trim();
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
