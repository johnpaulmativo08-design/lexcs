// My Orders (customer): order history with tabs, search and sort; an order details sheet with the order progress,
// the payment progress (kept separate), and a Delivery Confirmation (or Pickup) section.
// Everything shown comes from the customer's own saved records (Row Level Security): orders + order_items,
// order_payment_attempts, payment_methods, order_deliveries (rider booking, phase 79/88), get_my_bookings (the
// reservation schedule LexC's manages) and the order chat's status messages (for the time of each step).
// Nothing here writes order data except the existing actions it reuses (cancel_my_order, confirm received, review).
// window.LexcOrders = { show(), open(orderId) }   · page: #page-orders → #ordersRoot
import { ask } from './ask.js?v=1';

const db = () => window.LexcBackend;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => '₱' + Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PH = { timeZone: 'Asia/Manila' };
const fmt = (v, o) => (v ? new Date(v).toLocaleString('en-PH', { ...PH, ...o }) : '');
const dayLong = (v) => fmt(v, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const dayShort = (v) => fmt(v, { month: 'short', day: 'numeric', year: 'numeric' });
const clock = (v) => fmt(v, { hour: 'numeric', minute: '2-digit' });
const stamp = (v) => fmt(v, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const svg = (d, cls = '') => `<svg class="oh-ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  bag: '<path d="M6 7h12l-1 14H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>', truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  store: '<path d="M4 10h16v10H4z"/><path d="M3 10l2-6h14l2 6"/><path d="M10 20v-5h4v5"/>', cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', pin: '<path d="M12 21s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', chat: '<path d="M4 5h16v11H8l-4 4z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/>', wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h3M3 9h15"/>', chev: '<path d="m9 6 6 6-6 6"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>', star: '<path d="M12 3l2.6 5.4 5.9.9-4.3 4.1 1 5.9L12 16.6 6.8 19.3l1-5.9L3.5 9.3l5.9-.9z"/>',
  scooter: '<circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 17h7M14 6h3l2 6.5M18 17l-2.6-6.5H11l-2.5 4M5 10h4"/>', box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  whisk: '<path d="M5 19 14 10"/><path d="M14 10c-2-4 0-8 4-8s5 4 1 7z"/>', refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
};
const SHOP = { name: 'LexC’s Snacktime', address: '66 Quezon St., Dau, Mabalacat City, Pampanga', lat: 15.172157, lng: 120.58621 };

let state = 'idle', data = null, tab = 'all', query = '', sort = 'new', openId = null, loadSeq = 0;
const root = () => document.getElementById('ordersRoot');
const isActivePage = () => document.getElementById('page-orders')?.classList.contains('active');

// ---------------------------------------------------------------------------------------------- data
async function load() {
  const b = db(), me = window.currentUser?.id;
  const [orders, attempts, methods, deliveries, bookings] = await Promise.all([
    b.orders(),
    b.client.from('order_payment_attempts').select('id,order_id,status,amount,payment_kind,payment_method_id,created_at,submitted_at,verified_at,rejected_at,rejection_reason,provider').order('created_at', { ascending: false }).then(b.unwrap),
    b.client.from('payment_methods').select('id,code,display_name').then(b.unwrap).catch(() => []),
    b.client.from('order_deliveries').select('*').then(b.unwrap).catch(() => []),
    b.rpc('get_my_bookings', {}).catch(() => []),
  ]);
  const byOrder = (rows) => { const m = new Map(); (rows || []).forEach((r) => { if (!m.has(r.order_id)) m.set(r.order_id, []); m.get(r.order_id).push(r); }); return m; };
  return {
    orders: (orders || []).filter((o) => o.customer_id === me),
    attempts: byOrder(attempts), methods: new Map((methods || []).map((m) => [m.id, m])),
    deliveries: new Map((deliveries || []).map((d) => [d.order_id, d])), bookings: new Map((bookings || []).map((x) => [x.order_id, x])),
    steps: new Map(),   // order id → status times from the order chat (loaded when the details open)
  };
}
// the time each status was reached: the system messages the database posts in the order's chat
async function loadSteps(orderId) {
  if (data.steps.has(orderId)) return data.steps.get(orderId);
  const times = {};
  try {
    // the order's chat thread(s), then the status messages the database posted there (private.chat_order_event)
    const threads = db().unwrap(await db().client.from('chat_conversations').select('id').eq('order_id', orderId)) || [];
    const rows = threads.length ? db().unwrap(await db().client.from('chat_messages').select('body,created_at').in('conversation_id', threads.map((t) => t.id))
      .eq('sender_type', 'system').eq('message_type', 'status_update').order('created_at', { ascending: true }).limit(60)) : [];
    for (const m of rows || []) {
      const body = String(m.body || '');
      const st = /confirmed your order/i.test(body) ? 'confirmed' : (/changed to ([a-z_ ]+?)[.!]/i.exec(body)?.[1] || '').trim().replace(/ /g, '_').toLowerCase();
      if (st) times[st] = m.created_at;   // the latest time each status was reached
    }
  } catch (error) { console.warn('Order times not loaded:', error); }
  data.steps.set(orderId, times);
  return times;
}

// ---------------------------------------------------------------------------------------------- what to show
const isDelivery = (o) => o.fulfillment_method === 'lalamove';
const lastAttempt = (o) => (data.attempts.get(o.id) || [])[0] || null;
const methodName = (o) => {
  const a = lastAttempt(o), m = a && data.methods.get(a.payment_method_id);
  if (m?.display_name) return m.display_name;
  if (a?.provider === 'paymongo') return 'Pay online (PayMongo)';
  const chosen = [...data.methods.values()].find((x) => x.code === o.requested_payment_method);   // chosen at checkout
  return chosen?.display_name || '';
};
const remaining = (o) => (o.total_amount == null ? null : Math.max(0, Math.round((Number(o.total_amount) - Number(o.amount_paid || 0)) * 100) / 100));
const delivery = (o) => data.deliveries.get(o.id) || null;
const group = (o) => (o.status === 'cancelled' ? 'cancelled' : o.status === 'completed' ? 'completed' : 'active');

// the schedule LexC's keeps for the order (the reservation record), falling back to the time chosen at checkout
function schedule(o) {
  const b = data.bookings.get(o.id);
  if (b?.booking_date) {
    const t = (v) => { if (!v) return ''; const [h, m] = String(v).split(':').map(Number); const d = new Date(2000, 0, 1, h, m); return d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }); };
    const date = new Date(b.booking_date + 'T12:00:00+08:00');
    return { date: dayLong(date), short: dayShort(date), time: [t(b.scheduled_start), t(b.scheduled_end)].filter(Boolean).join(' – ') };
  }
  if (!o.receiving_start) return null;
  return { date: dayLong(o.receiving_start), short: dayShort(o.receiving_start), time: [clock(o.receiving_start), clock(o.receiving_end)].filter(Boolean).join(' – ') };
}

// order progress (one label; payment is separate)
function orderStatus(o) {
  const d = delivery(o);
  if (o.status === 'cancelled') return ['Cancelled', 'off'];
  if (o.status === 'completed') return ['Completed', 'done'];
  if (o.status === 'pending') return ['Pending confirmation', 'wait'];
  if (o.status === 'ready' || d) {
    if (!isDelivery(o)) return ['Ready for pickup', 'ready'];
    if (d?.step === 'delivered') return ['Delivered', 'done'];
    if (d?.step === 'failed') return ['Delivery issue', 'bad'];
    if (d) return ['Out for delivery', 'move'];
    return ['Ready for delivery', 'ready'];
  }
  if (o.status === 'preparing') return ['Preparing', 'busy'];
  return ['Confirmed', 'ok'];
}
// payment progress (separate from the order)
function paymentStatus(o) {
  const a = lastAttempt(o);
  if (o.payment_status === 'refunded') return ['Refunded', 'off'];
  if (o.status === 'cancelled') return Number(o.amount_paid) > 0 ? ['Refund being arranged', 'wait'] : ['No payment', 'off'];
  if (o.status === 'pending' && o.price_review?.status === 'awaiting') return ['New price to accept', 'warn'];
  if (o.status === 'pending') return ['Pay after confirmation', 'off'];
  if (o.payment_status === 'paid') return ['Fully paid', 'done'];
  if (o.payment_status === 'verification_pending' || a?.status === 'verification_pending') return ['Payment under verification', 'busy'];
  if (o.payment_status === 'rejected' || (a?.status === 'rejected' && o.payment_status !== 'partially_paid')) return ['Payment rejected', 'bad'];
  if (o.payment_status === 'partially_paid') return ['Downpayment paid', 'ok'];
  return ['Awaiting payment', 'warn'];
}
// the one thing the customer should do next (if anything)
function nextAction(o) {
  const pay = 'payment/index.html?order=' + encodeURIComponent(o.id), [ps] = paymentStatus(o);
  if (o.status === 'cancelled') return null;
  if (ps === 'New price to accept') return { href: pay, label: 'Review new price', tone: 'warn' };
  if (ps === 'Payment rejected') return { href: pay, label: 'Resubmit payment', tone: 'bad' };
  if (o.status !== 'pending' && ['Awaiting payment', 'Downpayment paid'].includes(ps) && remaining(o) > 0)
    return { href: pay, label: ps === 'Downpayment paid' ? 'Pay balance · ' + money(remaining(o)) : 'Pay now · ' + money(Number(o.amount_paid) > 0 ? remaining(o) : o.deposit_due), tone: 'go' };
  return null;
}
const canCancel = (o) => ['pending', 'confirmed'].includes(o.status) && o.payment_status !== 'verification_pending';
const canReview = (o) => o.status !== 'cancelled' && (o.status === 'completed' || o.payment_status === 'paid');

const photoFor = (item) => {
  if (typeof products === 'undefined' || typeof PRODUCT_IMAGES === 'undefined') return '';
  const p = products.find((x) => x.product_id === item.product_id) || products.find((x) => x.name === item.name_snapshot);
  return p ? PRODUCT_IMAGES[p.id] || '' : '';
};
const thumb = (item, size = '') => { const src = photoFor(item); return `<span class="oh-thumb${size}" aria-hidden="true">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : esc((item.name_snapshot || 'L').slice(0, 1))}</span>`; };
const pill = ([label, tone], extra = '') => `<span class="oh-pill is-${tone}${extra}">${esc(label)}</span>`;
const addressOf = (o) => String(o.address || '').replace(/\n?Map pin: https:\/\/maps\.google\.com\/\?q=\S+/, '').trim();
const pinOf = (o) => {
  if (o.delivery_lat != null && o.delivery_lng != null) return { lat: Number(o.delivery_lat), lng: Number(o.delivery_lng) };
  const m = String(o.address || '').match(/maps\.google\.com\/\?q=(-?[0-9.]+),(-?[0-9.]+)/); return m ? { lat: +m[1], lng: +m[2] } : null;
};

// ---------------------------------------------------------------------------------------------- list
function card(o) {
  const items = o.order_items || [], count = items.reduce((n, i) => n + Number(i.quantity || 0), 0), sch = schedule(o), act = nextAction(o), st = orderStatus(o), ps = paymentStatus(o);
  const shown = items.slice(0, 2), more = items.length - shown.length, d = delivery(o);
  const confirmedDelivery = isDelivery(o) && !['pending', 'cancelled'].includes(o.status);
  return `<article class="oh-card is-${group(o)}" data-oh-order="${esc(o.id)}">
    <button type="button" class="oh-card-hit" data-oh-open="${esc(o.id)}" aria-label="Order #${esc(o.order_number)}: ${esc(st[0])}, ${esc(ps[0])}. View details"></button>
    <div class="oh-card-top">
      <div><strong class="oh-num">Order #${esc(o.order_number)}</strong><span class="oh-date">Placed ${esc(dayShort(o.created_at))}</span></div>
      ${pill(st)}
    </div>
    <div class="oh-card-body">
      <ul class="oh-lines">${shown.map((i) => `<li>${thumb(i)}<span><b>${esc(i.name_snapshot)}</b><small>${esc([i.variant_label_snapshot, '×' + i.quantity].filter(Boolean).join(' · '))}</small></span></li>`).join('')}
        ${more > 0 ? `<li class="oh-more">+${more} more item${more === 1 ? '' : 's'}</li>` : ''}</ul>
      <div class="oh-total"><small>${count} item${count === 1 ? '' : 's'}</small><strong>${o.total_amount == null ? '—' : money(o.total_amount)}</strong></div>
    </div>
    <div class="oh-meta">
      <span class="oh-chip">${svg(isDelivery(o) ? I.truck : I.store)}${isDelivery(o) ? 'Delivery' : 'Store pickup'}</span>
      ${sch ? `<span class="oh-chip">${svg(I.cal)}${esc(sch.short)}${sch.time ? ' · ' + esc(sch.time) : ''}</span>` : ''}
      ${pill(ps, ' is-pay')}
    </div>
    ${confirmedDelivery ? `<p class="oh-confirm-flag${d?.step === 'failed' ? ' is-bad' : ''}">${svg(d?.step === 'failed' ? I.alert : I.check)}${d?.step === 'failed' ? 'Delivery issue — see details' : d ? (d.step === 'delivered' ? 'Delivered' : 'Out for delivery') : 'Delivery confirmed'}${sch && !d ? ' · ' + esc(sch.short) : ''}</p>` : ''}
    <div class="oh-card-actions">
      ${act ? `<a class="oh-btn is-${act.tone}" href="${esc(act.href)}">${esc(act.label)}</a>` : ''}
      <button type="button" class="oh-btn is-quiet" data-oh-open="${esc(o.id)}">View details${svg(I.chev)}</button>
    </div>
  </article>`;
}

function filtered() {
  const q = query.replace(/[^0-9]/g, '');
  const list = data.orders.filter((o) => (tab === 'all' || group(o) === tab) && (!q || String(o.order_number).includes(q)));
  return list.sort((a, b) => (sort === 'old' ? 1 : -1) * (Date.parse(a.created_at) - Date.parse(b.created_at)));
}

function head(counts, tools = true) {
  const T = [['all', 'All'], ['active', 'Active'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
  return `<header class="oh-head">
      <p class="lx-eyebrow">Orders · Payments · Deliveries</p>
      <h1 class="lx-title">My <em>orders.</em></h1>
      <p class="lx-lede">${counts ? (counts.active ? `${counts.active} active order${counts.active === 1 ? '' : 's'}` : 'No active orders right now') : 'Your orders, payments and deliveries in one place.'}</p>
    </header>
    ${tools ? `<div class="oh-tools">
      <div class="oh-tabs" role="tablist" aria-label="Show orders">${T.map(([k, l]) => `<button type="button" role="tab" data-oh-tab="${k}" aria-selected="${tab === k}">${l}${counts ? `<i>${counts[k]}</i>` : ''}</button>`).join('')}</div>
      <div class="oh-find">
        <label class="oh-search">${svg(I.search)}<span class="oh-sr">Search by order number</span><input type="search" inputmode="numeric" placeholder="Order #" value="${esc(query)}" data-oh-search autocomplete="off"></label>
        <label class="oh-sort"><span class="oh-sr">Sort</span><select data-oh-sort><option value="new"${sort === 'new' ? ' selected' : ''}>Newest first</option><option value="old"${sort === 'old' ? ' selected' : ''}>Oldest first</option></select></label>
      </div>
    </div>` : ''}`;
}

function attention() {
  const need = data.orders.filter((o) => nextAction(o));
  if (!need.length) return '';
  return `<section class="oh-attn" aria-label="Needs your attention"><span class="oh-attn-ic">${svg(I.wallet)}</span><div><strong>${need.length === 1 ? '1 order needs' : need.length + ' orders need'} your attention</strong>
    <span>${need.slice(0, 3).map((o) => `<button type="button" data-oh-open="${esc(o.id)}">#${esc(o.order_number)} · ${esc(nextAction(o).label.split(' · ')[0])}</button>`).join('')}</span></div></section>`;
}

function render() {
  const r = root(); if (!r || !isActivePage()) return;
  if (!window.currentUser) {
    r.innerHTML = head(null, false) + `<div class="oh-empty"><span class="oh-empty-ic">${svg(I.bag)}</span><strong>Log in to see your orders</strong><p>Your orders, payments and delivery details are saved to your account.</p><button type="button" class="oh-btn is-go" data-oh-login>Log in</button></div>`;
    return;
  }
  if (!data && state !== 'error') {   // first visit: nothing loaded yet
    r.innerHTML = head(null) + `<div class="oh-list" aria-busy="true" aria-label="Loading your orders">${Array.from({ length: 3 }, () => `<div class="oh-card oh-skel" aria-hidden="true"><div class="oh-card-top"><span class="skel skel-line skel-line--short"></span><span class="skel skel-badge"></span></div><div class="oh-card-body"><span class="skel oh-skel-thumb"></span><span class="skel skel-line"></span></div><span class="skel skel-line skel-line--short"></span></div>`).join('')}</div>`;
    return;
  }
  if (state === 'error' && !data) {
    r.innerHTML = head(null) + `<div class="oh-empty" role="alert"><span class="oh-empty-ic is-bad">${svg(I.alert)}</span><strong>Your orders couldn’t load</strong><p>Your orders are safe. Check your connection and try again.</p><button type="button" class="oh-btn is-go" data-oh-retry>${svg(I.refresh)}Try again</button></div>`;
    return;
  }
  const counts = { all: data.orders.length, active: 0, completed: 0, cancelled: 0 };
  data.orders.forEach((o) => counts[group(o)]++);
  const list = filtered();
  const E = {
    all: ['No orders yet', 'When you place an order, you can follow it here — from confirmation to your door.'],
    active: ['No active orders', 'Orders being confirmed, made or delivered show here.'],
    completed: ['No completed orders yet', 'Orders you’ve received show here.'], cancelled: ['No cancelled orders', 'Nothing was cancelled.'],
  }[tab];
  const body = list.length ? `<div class="oh-list">${list.map(card).join('')}</div>`
    : `<div class="oh-empty"><span class="oh-empty-ic">${svg(I.bag)}</span><strong>${query ? `No order #${esc(query.replace(/[^0-9]/g, ''))}` : E[0]}</strong><p>${query ? 'Check the number on your receipt or chat, or clear the search.' : E[1]}</p>${!data.orders.length ? '<button type="button" class="oh-btn is-go" data-oh-shop>Browse the menu</button>' : query ? '<button type="button" class="oh-btn is-quiet" data-oh-clear>Clear search</button>' : ''}</div>`;
  const focus = document.activeElement?.matches?.('[data-oh-search]') ? document.activeElement.selectionStart : null;
  r.innerHTML = head(counts) + (tab === 'all' || tab === 'active' ? attention() : '') + body;
  if (focus != null) { const s = r.querySelector('[data-oh-search]'); s.focus(); s.setSelectionRange(focus, focus); }
}

// ---------------------------------------------------------------------------------------------- details
function timeline(o, times) {
  const d = delivery(o), pickup = !isDelivery(o), cancelled = o.status === 'cancelled';
  const S = [
    ['placed', 'Order placed', I.bag, o.created_at],
    ['confirmed', 'Confirmed', I.check, times.confirmed],
    ['preparing', 'Preparing', I.whisk, times.preparing],
    ['ready', pickup ? 'Ready for pickup' : 'Ready for delivery', I.box, times.ready],
  ];
  if (!pickup) S.push(['out', d?.step === 'delivered' ? 'Delivered' : 'Out for delivery', I.scooter, d?.step === 'delivered' ? d.delivered_at : d?.booked_at]);
  S.push(['completed', 'Completed', I.star, times.completed]);
  const rank = { pending: 0, confirmed: 1, preparing: 2, ready: 3, completed: S.length - 1 }[o.status];
  let now = cancelled ? -1 : rank ?? 0;
  if (!pickup && !cancelled && o.status !== 'completed' && d && d.step !== 'failed') now = 4;   // a booked rider = out for delivery
  // a cancelled order shows the steps it reached, then where it stopped
  const reached = cancelled ? Math.max(0, ...S.map(([k], i) => (k === 'placed' || times[k] ? i : 0))) : now;
  const rows = S.map(([k, label, ic, at], i) => {
    const done = cancelled ? i <= reached : i < now || (o.status === 'completed' && i === now) || (k === 'out' && d?.step === 'delivered');
    const cur = !cancelled && i === now && o.status !== 'completed';
    if (cancelled && i > reached) return '';
    const note = cur ? ({ placed: 'Waiting for LexC’s to confirm', confirmed: 'You can pay now', preparing: 'In the kitchen', ready: pickup ? 'Come by at your pickup time' : 'A rider is being booked', out: d?.step === 'delivered' ? 'You confirmed you received it' : 'On the way to you' }[k] || '') : '';
    return `<li class="${done ? 'is-done' : cur ? 'is-now' : 'is-next'}"${cur ? ' aria-current="step"' : ''}><span class="oh-step-ic">${svg(done && !cur ? I.check : ic)}</span><div><b>${esc(label)}</b>${at && (done || cur) ? `<time datetime="${esc(new Date(at).toISOString())}">${esc(stamp(at))}</time>` : ''}${note ? `<small>${esc(note)}</small>` : ''}</div></li>`;
  }).join('');
  const stop = cancelled ? `<li class="is-stop"><span class="oh-step-ic">${svg(I.x)}</span><div><b>Cancelled</b>${times.cancelled ? `<time>${esc(stamp(times.cancelled))}</time>` : ''}<small>${Number(o.amount_paid) > 0 ? 'LexC’s will refund what you paid.' : 'Your reservation was released.'}</small></div></li>` : '';
  const fail = d?.step === 'failed' ? `<li class="is-stop"><span class="oh-step-ic">${svg(I.alert)}</span><div><b>Delivery didn’t go through</b>${d.failed_at ? `<time>${esc(stamp(d.failed_at))}</time>` : ''}<small>${esc(d.failure_reason || 'LexC’s will message you to sort it out.')}</small></div></li>` : '';
  return `<section class="oh-sec"><h3>Order progress</h3><ol class="oh-time">${rows}${fail}${stop}</ol></section>`;
}

function mapPreview(pin) {
  if (!pin) return '';
  const d = 0.004, box = [pin.lng - d, pin.lat - d, pin.lng + d, pin.lat + d].map((n) => n.toFixed(6)).join('%2C');
  return `<figure class="oh-map"><iframe title="Delivery location on the map" loading="lazy" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=${box}&amp;layer=mapnik&amp;marker=${pin.lat.toFixed(6)}%2C${pin.lng.toFixed(6)}"></iframe>
    <figcaption><a href="https://maps.google.com/?q=${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}" target="_blank" rel="noopener">Open in Google Maps ↗</a></figcaption></figure>`;
}

// Delivery Confirmation: shown as confirmed only once LexC's has confirmed the order; otherwise the true state
function deliverySection(o) {
  const sch = schedule(o), d = delivery(o), pin = pinOf(o), addr = addressOf(o);
  const fee = o.delivery_in_deposit && Number(o.delivery_fee) > 0 ? `${money(o.delivery_fee)}${o.delivery_distance_km != null ? ` <small>estimate · ${Number(o.delivery_distance_km).toFixed(1)} km</small>` : ''}`
    : o.delivery_fee_status === 'quoted' && Number(o.delivery_fee) > 0 ? money(o.delivery_fee) : 'Paid to the Lalamove rider';
  const st = o.status === 'cancelled' ? ['Cancelled', 'off'] : o.status === 'pending' ? ['Waiting for confirmation', 'wait']
    : d?.step === 'delivered' ? ['Delivered', 'done'] : d?.step === 'failed' ? ['Delivery issue', 'bad'] : d ? ['Out for delivery', 'move']
    : o.status === 'ready' ? ['Ready · rider being booked', 'ready'] : o.status === 'completed' ? ['Completed', 'done'] : ['Scheduled', 'ok'];
  const confirmed = !['pending', 'cancelled'].includes(o.status);
  const heading = o.status === 'cancelled' ? 'Delivery cancelled' : confirmed ? (d?.step === 'delivered' ? 'Delivered' : 'Delivery confirmed') : 'Delivery details';
  const sub = o.status === 'cancelled' ? 'This order was cancelled, so nothing will be delivered.' : confirmed ? 'LexC’s confirmed this delivery. Here’s what was saved for it.' : 'LexC’s hasn’t confirmed this order yet. These are the details you sent; they’re confirmed together with the order.';
  const row = (ic, label, value) => (value ? `<div class="oh-dc-row">${svg(ic)}<div><small>${esc(label)}</small><span>${value}</span></div></div>` : '');
  return `<section class="oh-dc is-${confirmed ? (d?.step === 'failed' ? 'bad' : 'ok') : o.status === 'cancelled' ? 'off' : 'wait'}" aria-label="${esc(heading)}">
    <header class="oh-dc-head"><span class="oh-dc-badge">${svg(confirmed && d?.step !== 'failed' ? I.check : o.status === 'cancelled' ? I.x : d?.step === 'failed' ? I.alert : I.clock)}</span>
      <div><h3>${esc(heading)}</h3><p>${esc(sub)}</p></div>${pill(st)}</header>
    <div class="oh-dc-grid">
      ${row(I.cal, 'Delivery date', sch ? esc(sch.date) : 'To be scheduled')}
      ${row(I.clock, 'Time', sch?.time ? esc(sch.time) : 'To be scheduled')}
      ${row(I.pin, 'Deliver to', addr ? esc(addr).replace(/\n/g, '<br>') : '—')}
      ${row(I.truck, 'Delivery method', 'Lalamove')}
      ${row(I.wallet, 'Delivery fee', fee)}
      ${o.notes ? row(I.note, 'Delivery instructions', esc(o.notes)) : ''}
    </div>
    ${mapPreview(pin)}
    ${d && window.LexcDelivery ? `<div class="oh-dc-rider">${window.LexcDelivery.card(d)}</div>` : ''}
  </section>`;
}
function pickupSection(o) {
  const sch = schedule(o), confirmed = !['pending', 'cancelled'].includes(o.status);
  const st = o.status === 'cancelled' ? ['Cancelled', 'off'] : o.status === 'pending' ? ['Waiting for confirmation', 'wait'] : o.status === 'ready' ? ['Ready for pickup', 'ready'] : o.status === 'completed' ? ['Picked up', 'done'] : ['Scheduled', 'ok'];
  const row = (ic, label, value) => `<div class="oh-dc-row">${svg(ic)}<div><small>${esc(label)}</small><span>${value}</span></div></div>`;
  return `<section class="oh-dc is-${confirmed ? 'ok' : o.status === 'cancelled' ? 'off' : 'wait'}" aria-label="Pickup">
    <header class="oh-dc-head"><span class="oh-dc-badge">${svg(confirmed ? I.check : o.status === 'cancelled' ? I.x : I.clock)}</span>
      <div><h3>${o.status === 'cancelled' ? 'Pickup cancelled' : confirmed ? 'Pickup confirmed' : 'Pickup details'}</h3><p>${confirmed ? 'Come by at your pickup time.' : o.status === 'cancelled' ? 'This order was cancelled.' : 'Confirmed together with your order.'}</p></div>${pill(st)}</header>
    <div class="oh-dc-grid">${row(I.cal, 'Pickup date', sch ? esc(sch.date) : 'To be scheduled')}${row(I.clock, 'Time', sch?.time ? esc(sch.time) : 'To be scheduled')}
      ${row(I.store, 'Pick up at', esc(SHOP.address) + ` <a href="https://www.google.com/maps/dir/?api=1&destination=${SHOP.lat},${SHOP.lng}" target="_blank" rel="noopener">Directions ↗</a>`)}
      ${o.notes ? row(I.note, 'Your note', esc(o.notes)) : ''}</div>
  </section>`;
}

function itemsSection(o) {
  const items = o.order_items || [];
  return `<section class="oh-sec"><h3>Items</h3><ul class="oh-items">${items.map((i) => {
    const summary = i.customization?.summary || '';
    return `<li>${thumb(i, ' is-lg')}<div><b>${esc(i.name_snapshot)}</b><small>${esc([i.variant_label_snapshot, 'Qty ' + i.quantity].filter(Boolean).join(' · '))}</small>${summary ? `<p class="oh-custom">${esc(summary)}</p>` : ''}</div><strong>${money(i.line_total)}</strong></li>`;
  }).join('')}</ul></section>`;
}

function paymentSection(o) {
  const a = lastAttempt(o), ps = paymentStatus(o), left = remaining(o);
  const line = (label, value, cls = '') => `<div class="oh-sum-row${cls}"><span>${label}</span><b>${value}</b></div>`;
  const delivery = isDelivery(o) ? (o.delivery_in_deposit && Number(o.delivery_fee) > 0 ? money(o.delivery_fee) : o.delivery_fee_status === 'quoted' && Number(o.delivery_fee) > 0 ? money(o.delivery_fee) : 'Paid to rider') : null;
  return `<section class="oh-sec"><h3>Payment</h3>
    <div class="oh-paystate">${pill(ps, ' is-pay')}<span>${esc(methodName(o) || (o.status === 'pending' ? 'You can pay once LexC’s confirms' : 'No payment yet'))}</span></div>
    ${a?.status === 'rejected' && o.payment_status !== 'paid' ? `<p class="oh-reject">${svg(I.alert)}<span><b>Your last payment wasn’t accepted.</b> ${esc(a.rejection_reason || 'Please send it again.')}</span></p>` : ''}
    <div class="oh-sum">
      ${line('Subtotal', money(o.items_subtotal))}
      ${Number(o.customization_total) > 0 ? line('Design options', money(o.customization_total)) : ''}
      ${Number(o.rush_fee) > 0 ? line('Rush fee (next-day)', money(o.rush_fee)) : ''}
      ${delivery ? line('Delivery fee', delivery) : ''}
      ${Number(o.vat_amount) > 0 ? line('VAT', money(o.vat_amount)) : ''}
      ${line('Total', o.total_amount == null ? 'To be confirmed' : money(o.total_amount), ' is-total')}
      ${o.status !== 'cancelled' && o.deposit_due != null && Number(o.deposit_due) < Number(o.total_amount) ? line('Downpayment', money(o.deposit_due)) : ''}
      ${line('Paid (verified)', money(o.amount_paid))}
      ${o.status !== 'cancelled' && left != null ? line('Remaining', left > 0 ? money(left) : 'Nothing left', left > 0 ? ' is-due' : ' is-clear') : ''}
    </div></section>`;
}

function details(o, times) {
  const st = orderStatus(o), ps = paymentStatus(o), act = nextAction(o);
  return `<div class="oh-sheet-head">
      <div><p class="oh-sheet-eyebrow">Order reference</p><h2 id="ohSheetTitle">#${esc(o.order_number)}</h2><p class="oh-date">Placed ${esc(dayLong(o.created_at))} · ${esc(clock(o.created_at))}</p></div>
      <button type="button" class="oh-close" data-oh-close aria-label="Close order details">${svg(I.x)}</button>
    </div>
    <div class="oh-sheet-status"><div><small>Order</small>${pill(st)}</div><div><small>Payment</small>${pill(ps, ' is-pay')}</div><div><small>${isDelivery(o) ? 'Delivery' : 'Pickup'}</small><span class="oh-chip">${svg(isDelivery(o) ? I.truck : I.store)}${isDelivery(o) ? 'Lalamove' : 'At the shop'}</span></div></div>
    ${act ? `<a class="oh-btn is-${act.tone} oh-sheet-cta" href="${esc(act.href)}">${esc(act.label)}</a>` : ''}
    ${isDelivery(o) ? deliverySection(o) : pickupSection(o)}
    ${timeline(o, times)}
    ${itemsSection(o)}
    ${paymentSection(o)}
    <div class="oh-sheet-actions">
      <a class="oh-btn is-quiet" href="payment/index.html?order=${encodeURIComponent(o.id)}">${svg(I.wallet)}View payment</a>
      <a class="oh-btn is-quiet" href="chat/?order=${encodeURIComponent(o.id)}">${svg(I.chat)}Message LexC’s</a>
      ${canReview(o) ? `<button type="button" class="oh-btn is-quiet" data-oh-review="${esc(o.id)}">${svg(I.star)}Rate order</button>` : ''}
      ${canCancel(o) ? `<button type="button" class="oh-btn is-danger" data-oh-cancel="${esc(o.id)}">Cancel order</button>` : ''}
    </div>`;
}

let sheet = null, opener = null;
function ensureSheet() {
  if (sheet) return sheet;
  sheet = document.createElement('dialog');
  sheet.className = 'oh-sheet';
  sheet.setAttribute('aria-labelledby', 'ohSheetTitle');
  sheet.innerHTML = '<div class="oh-sheet-body" data-oh-sheet></div>';
  document.body.append(sheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-oh-close]')) closeSheet(); });
  sheet.addEventListener('close', () => { openId = null; opener?.focus?.(); });
  return sheet;
}
function closeSheet() { sheet?.open && sheet.close(); }
async function open(orderId) {
  if (!data) await refresh();
  const o = data?.orders.find((x) => x.id === orderId);
  if (!o) { window.showToast?.('That order isn’t in your account.'); return; }
  openId = o.id; opener = document.activeElement;
  const s = ensureSheet(), body = s.querySelector('[data-oh-sheet]');
  const known = data.steps.get(o.id);
  body.innerHTML = details(o, known || {});
  if (!s.open) s.showModal();
  s.querySelector('[data-oh-close]')?.focus();
  if (!known) { const times = await loadSteps(o.id); if (openId === o.id) { const top = body.scrollTop; body.innerHTML = details(data.orders.find((x) => x.id === o.id) || o, times); body.scrollTop = top; } }
}

// ---------------------------------------------------------------------------------------------- loading
async function refresh() {
  if (!window.currentUser) { data = null; render(); return; }
  const seq = ++loadSeq;
  if (!data) { state = 'loading'; render(); }
  try {
    const fresh = await load(); if (seq !== loadSeq) return;
    fresh.steps = new Map();   // status times are re-read when details open, so admin changes show
    data = fresh; state = 'ready';
  } catch (error) { console.warn('Orders failed:', error); if (seq === loadSeq && !data) state = 'error'; }
  render();
  if (openId && sheet?.open) open(openId);
}
let pending = null;   // an order to open once the page shows (from goTo)
function show(opts = {}) {
  if (opts.tab) tab = opts.tab;
  const target = opts.order || pending; pending = null;
  if (target && tab !== 'all') tab = 'all';
  render(); refresh().then(() => { if (target) open(target); });
}
// open My Orders, optionally on one order's details (used by the profile, notifications, the cart drawer and links)
function goTo(orderId, opts = {}) {
  pending = orderId || null; if (opts.tab) tab = opts.tab;
  if (isActivePage()) return show();
  window.navigate?.('orders');
}

// ---------------------------------------------------------------------------------------------- events
document.addEventListener('click', async (e) => {
  const t = e.target.closest?.('[data-oh-open],[data-oh-tab],[data-oh-retry],[data-oh-login],[data-oh-shop],[data-oh-clear],[data-oh-cancel],[data-oh-review]');
  if (!t || !(t.closest('#ordersRoot') || t.closest('.oh-sheet'))) return;
  if (t.dataset.ohOpen) return open(t.dataset.ohOpen);
  if (t.dataset.ohTab) { tab = t.dataset.ohTab; render(); root().querySelector(`[data-oh-tab="${tab}"]`)?.focus(); return; }
  if ('ohRetry' in t.dataset) return refresh();
  if ('ohLogin' in t.dataset) return window.navigate?.('login');
  if ('ohShop' in t.dataset) return window.navigate?.('shop');
  if ('ohClear' in t.dataset) { query = ''; return render(); }
  if (t.dataset.ohReview) { closeSheet(); return window.showReviewForm?.(t.dataset.ohReview); }
  if (t.dataset.ohCancel) {
    const o = data.orders.find((x) => x.id === t.dataset.ohCancel); if (!o) return;
    const paid = Number(o.amount_paid || 0);
    if (!await ask(`Cancel order #${o.order_number}? This releases its reservation.${paid > 0 ? ` LexC’s will refund the ${money(paid)} you already paid.` : ''}`, { title: 'Cancel this order?', confirm: 'Cancel order', cancel: 'Keep order', tone: 'danger' })) return;
    t.disabled = true;
    try {
      await db().rpc('cancel_my_order', { order_id: o.id });
      window.showToast?.(paid > 0 ? 'Order cancelled. LexC’s will refund what you paid; watch your chat.' : 'Order cancelled. Your reservation is free again.');
      await refresh();
    } catch (error) { t.disabled = false; window.showToast?.(error.message || 'The order could not be cancelled. Please try again.'); }
  }
});
document.addEventListener('input', (e) => { if (e.target.matches?.('#ordersRoot [data-oh-search]')) { query = e.target.value; render(); } });
document.addEventListener('change', (e) => { if (e.target.matches?.('#ordersRoot [data-oh-sort]')) { sort = e.target.value; render(); } });
// keep it current: coming back to the tab, after "I received my order", and when signing in or out
document.addEventListener('visibilitychange', () => { if (!document.hidden && isActivePage()) refresh(); });
document.addEventListener('lexc:order-received', () => { data && data.steps.clear(); if (isActivePage() || sheet?.open) refresh(); });
const baseAuth = window.updateNavAuth;
let signedInAs = window.currentUser?.id || null;
if (typeof baseAuth === 'function') window.updateNavAuth = function updateNavAuthWithOrders() {
  const r = baseAuth.apply(this, arguments), who = window.currentUser?.id || null;
  if (who !== signedInAs) { signedInAs = who; data = null; closeSheet(); if (isActivePage()) refresh(); }   // another account: never show the last one's orders
  return r;
};

window.LexcOrders = Object.freeze({ show, open, refresh, goTo });
