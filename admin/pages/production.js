// Admin → Production: the kitchen's day at a glance (Today), the bake plan for any day of the week (Schedule) and one
// order's bake card (Details). Read-only views over what already exists — nothing new is stored here:
//   get_production_day (phase 96: kitchen minutes), get_bake_timeline (phase 97: bake windows), orders + order_items.
// The one button moves the order along with the same set_order_status as Orders, so the database rules stay in charge
// (payment before Start making, inventory taken once by the trigger, and so on).
import { escapeHtml as e, icon } from '../components.js?v=4';
import { db } from '../backend-ui.js?v=3';
import { ask } from '../../shared/ask.js?v=2';

const DAY = 864e5;
const manilaKey = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const plus = (k, n) => new Date(Date.parse(k + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const weekday = (k, style = 'short') => new Intl.DateTimeFormat('en-PH', { weekday: style, timeZone: 'UTC' }).format(new Date(k + 'T12:00:00Z'));
const longDay = (k) => new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(k + 'T12:00:00Z'));
const clock = (min) => { if (min == null) return '—'; const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const at = (iso) => iso ? new Date(iso).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }) : '—';
const mins = (m) => { const n = Math.max(0, Math.round(Number(m) || 0)), h = Math.floor(n / 60); return h ? `${h} hr${n % 60 ? ` ${n % 60} min` : ''}` : `${n} min`; };

const STAGE = { pending: ['Waiting to confirm', 'wait'], confirmed: ['To start', 'start'], preparing: ['Baking', 'bake'], ready: ['Ready', 'ready'] };
const PAY = { unpaid: 'Not paid yet', verification_pending: 'Receipt to check', partially_paid: 'Downpayment paid', paid: 'Fully paid', refunded: 'Refunded', rejected: 'Receipt not accepted' };
const NEXT = { confirmed: ['preparing', 'Start making'], preparing: ['ready', 'Mark ready'], ready: ['completed', 'Mark completed'] };
const FILTERS = [['all', 'All'], ['confirmed', 'To start'], ['preparing', 'Baking'], ['ready', 'Ready']];

export async function renderProduction(content, focus) {
  const today = manilaKey();
  let selected = today, filter = 'all', picked = null;
  const timelines = new Map(), orders = new Map();

  content.innerHTML = `<div class="prod">
    <section class="prod-col prod-today" data-today aria-busy="true"><div class="prod-skel"><span class="skel"></span><span class="skel"></span><span class="skel"></span></div></section>
    <section class="prod-col prod-plan" data-plan aria-busy="true"><div class="prod-skel"><span class="skel"></span><span class="skel"></span><span class="skel"></span></div></section>
    <section class="prod-col prod-detail" data-detail><div class="prod-empty">${icon('orders')}<p>Tap a bake to see its details.</p></div></section>
  </div>`;
  const $ = (s) => content.querySelector(s);

  async function timeline(date, fresh) {
    if (!fresh && timelines.has(date)) return timelines.get(date);
    let rows = [];
    try { rows = (await db.rpc('get_bake_timeline', { target_date: date })) || []; }
    catch (error) { console.warn('Bake timeline:', error); rows = null; }
    timelines.set(date, rows);
    return rows;
  }
  async function loadOrders(ids) {
    const need = ids.filter((id) => !orders.has(id));
    if (!need.length) return;
    const rows = db.unwrap(await db.client.from('orders')
      .select('id,order_number,status,payment_status,fulfillment_method,receiving_start,notes,customer_name,order_items(name_snapshot,variant_label_snapshot,quantity,customization)')
      .in('id', need));
    (rows || []).forEach((o) => orders.set(o.id, o));
  }
  const what = (o) => (o?.order_items || []).map((i) => `${i.quantity > 1 ? i.quantity + '× ' : ''}${i.name_snapshot}${i.variant_label_snapshot ? ' · ' + i.variant_label_snapshot : ''}`).join(', ') || 'Order';
  const chip = (status) => { const [label, tone] = STAGE[status] || [status, 'wait']; return `<span class="prod-chip is-${tone}">${e(label)}</span>`; };

  // ---- Today: kitchen minutes ring, stage counts, today's bakes by deadline
  async function paintToday(fresh) {
    const box = $('[data-today]');
    try {
      const [day, rows] = await Promise.all([db.rpc('get_production_day', { target_date: today }), timeline(today, fresh)]);
      const list = (rows || []).filter((r) => r.status !== 'pending');
      await loadOrders(list.map((r) => r.order_id));
      const cap = Number(day?.workload_minutes) || 0, used = Number(day?.accepted_minutes) || 0;
      const p = cap > 0 ? Math.round((used / cap) * 100) : used > 0 ? 100 : 0;
      const count = (s) => list.filter((r) => r.status === s).length;
      const late = list.filter((r) => !r.fits).length;
      const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false }));
      box.innerHTML = `
        <header class="prod-hello"><div><small>${e(longDay(today))}</small><h2>${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}</h2></div>
          <a class="prod-round is-dark" href="#bookings" title="Reserve a time" aria-label="Reserve a time">${icon('plus')}</a></header>
        <p class="prod-lede">Let’s bake <em>today’s orders</em></p>
        <div class="prod-progress">
          <div class="prod-ring" style="--p:${Math.min(100, p)}" role="img" aria-label="${p}% of today’s kitchen time used"><span>${p}%</span></div>
          <dl><div><dt>Kitchen time</dt><dd>${e(mins(used))} <small>of ${e(mins(cap))}</small></dd></div>
            <div><dt>Orders today</dt><dd>${list.length}</dd></div>
            ${late ? `<div class="is-warn"><dt>Need attention</dt><dd>${late} won’t fit</dd></div>` : day?.pending_count ? `<div><dt>Waiting to confirm</dt><dd>${Number(day.pending_count)}</dd></div>` : ''}</dl>
        </div>
        <div class="prod-row-head"><h3>Today’s bakes</h3><button type="button" class="prod-link" data-goto-today>View plan</button></div>
        <div class="prod-counts"><span><b>${count('confirmed')}</b> To start</span><span><b>${count('preparing')}</b> Baking</span><span><b>${count('ready')}</b> Ready</span></div>
        <div class="prod-cards">${list.length ? list.slice().sort((a, b) => (a.deadline_minutes ?? 0) - (b.deadline_minutes ?? 0)).map((r) => {
          const o = orders.get(r.order_id);
          return `<button type="button" class="prod-card${picked === r.order_id ? ' is-picked' : ''}" data-pick="${e(r.order_id)}" data-date="${today}">
            <span class="prod-due${r.fits ? '' : ' is-bad'}">${r.fits ? 'Due' : 'Won’t fit · due'} ${e(at(r.delivery_at))}</span>
            <b>${e(what(o))}</b><span class="prod-meta">${icon('clock')} Bake ${e(clock(r.bake_start_minutes))} – ${e(clock(r.bake_finish_minutes))} · ${e(r.customer_name || '')}</span>
            <span class="prod-foot">${chip(r.status)}<small>#${e(r.order_number)}</small></span></button>`;
        }).join('') : '<p class="prod-none">No bakes today. Enjoy the quiet kitchen.</p>'}</div>`;
      box.querySelector('[data-goto-today]').onclick = () => { selected = today; paintPlan(); };
    } catch (error) {
      box.innerHTML = `<div class="prod-error" role="alert"><p>Today’s production could not load.</p><button class="button" type="button" data-retry>Try again</button></div>`;
      box.querySelector('[data-retry]').onclick = () => paintToday(true);
    } finally { box.removeAttribute('aria-busy'); }
  }

  // ---- Schedule: week strip, stage filter, the day's bake plan in start order
  async function paintPlan(fresh) {
    const box = $('[data-plan]');
    const start = plus(selected, -((new Date(selected + 'T12:00:00Z').getUTCDay() + 6) % 7));   // Monday
    const week = Array.from({ length: 7 }, (_, i) => plus(start, i));
    box.setAttribute('aria-busy', 'true');
    const rows = await timeline(selected, fresh);
    // times the Admin reserved in Reservations (no order behind them) sit in the plan too
    let held = [];
    try { held = db.unwrap(await db.client.from('booking_entries').select('id,customer_name,scheduled_start,scheduled_end,status').eq('booking_date', selected).is('order_id', null).neq('status', 'cancelled')) || []; }
    catch (error) { console.warn('Reserved times:', error); }
    if (rows) await loadOrders(rows.map((r) => r.order_id)).catch(() => {});
    const shown = (rows || []).filter((r) => filter === 'all' || r.status === filter).sort((a, b) => (a.bake_start_minutes ?? 0) - (b.bake_start_minutes ?? 0));
    box.innerHTML = `
      <header class="prod-plan-head"><div class="prod-weeknav"><button type="button" class="prod-round" data-week="-7" aria-label="Previous week">‹</button>
        <h2>${e(longDay(selected))}</h2><button type="button" class="prod-round" data-week="7" aria-label="Next week">›</button></div>
        <p class="prod-lede">Bake <em>schedule</em></p></header>
      <div class="prod-week" role="tablist" aria-label="Days">${week.map((k) => `<button type="button" role="tab" aria-selected="${k === selected}" data-day="${k}" class="${k === selected ? 'is-on' : ''}${k === today ? ' is-today' : ''}"><small>${e(weekday(k))}</small><b>${Number(k.slice(8))}</b></button>`).join('')}</div>
      <div class="prod-filters">${FILTERS.map(([v, t]) => `<button type="button" data-filter="${v}" aria-pressed="${filter === v}">${t}</button>`).join('')}</div>
      ${rows === null ? '<p class="prod-none">The bake plan isn’t available. Run database/phase97-bake-timeline.sql.</p>'
        : shown.length ? `<ol class="prod-line">${shown.map((r) => {
          const o = orders.get(r.order_id);
          return `<li><button type="button" class="prod-slot${r.fits ? '' : ' is-bad'}${picked === r.order_id ? ' is-picked' : ''}" data-pick="${e(r.order_id)}" data-date="${selected}">
            <span class="prod-time"><b>${e(clock(r.bake_start_minutes).replace(/ [AP]M$/, ''))}</b><small>${e(clock(r.bake_start_minutes).slice(-2))}</small></span>
            <span class="prod-what"><b>${e(what(o))}</b><small>${e(mins(r.minutes))} · ${o?.fulfillment_method === 'lalamove' ? 'deliver' : 'pickup'} ${e(at(r.delivery_at))} · ${e(r.customer_name || '')}</small>
              ${r.fits ? chip(r.status) : '<span class="prod-chip is-bad">Doesn’t fit · starts before the kitchen opens</span>'}</span></button></li>`;
        }).join('')}</ol>`
        : `<p class="prod-none">${filter === 'all' ? 'Nothing to bake on this day.' : 'No bakes in this step.'}</p>`}
      ${held.length && filter === 'all' ? `<div class="prod-held"><h3>Reserved times</h3>${held.map((h) => `<a class="prod-slot is-held" href="#bookings"><span class="prod-time"><b>${e(String(h.scheduled_start || '').slice(0, 5) || '—')}</b><small>${h.scheduled_end ? 'to ' + e(String(h.scheduled_end).slice(0, 5)) : ''}</small></span><span class="prod-what"><b>${e(h.customer_name)}</b><small>Reserved in Reservations</small></span></a>`).join('')}</div>` : ''}`;
    box.removeAttribute('aria-busy');
    box.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => { selected = b.dataset.day; paintPlan(); }));
    box.querySelectorAll('[data-week]').forEach((b) => (b.onclick = () => { selected = plus(selected, Number(b.dataset.week)); paintPlan(); }));
    box.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { filter = b.dataset.filter; paintPlan(); }));
  }

  // ---- Details: one order's bake card and the single next step
  function paintDetail(id, date) {
    const box = $('[data-detail]'), r = (timelines.get(date) || []).find((x) => x.order_id === id), o = orders.get(id);
    if (!r || !o) { box.innerHTML = '<div class="prod-empty"><p>This bake is no longer on the plan.</p></div>'; return; }
    const next = NEXT[o.status], paid = o.payment_status === 'paid' || o.payment_status === 'partially_paid';
    const steps = [['confirmed', 'Confirmed'], ['preparing', 'Making'], ['ready', 'Ready']], now = steps.findIndex(([s]) => s === o.status);
    box.innerHTML = `
      <header class="prod-detail-head"><h2>Bake details</h2><small>#${e(o.order_number)}</small></header>
      <div class="prod-box"><small>Order</small><b>${e(what(o))}</b><span>${e(o.customer_name || r.customer_name || '')}</span>
        ${(o.order_items || []).some((i) => i.customization) ? `<span class="prod-note">${e((o.order_items || []).map((i) => i.customization && typeof i.customization === 'object' ? Object.entries(i.customization).filter(([, v]) => typeof v === 'string' && v && v.length < 60).map(([, v]) => v).join(' · ') : '').filter(Boolean).join(' / '))}</span>` : ''}</div>
      <div class="prod-pair"><div class="prod-box"><small>Bake window</small><b>${e(clock(r.bake_start_minutes))} – ${e(clock(r.bake_finish_minutes))}</b></div>
        <div class="prod-box"><small>${o.fulfillment_method === 'lalamove' ? 'Deliver at' : 'Pickup at'}</small><b>${e(at(r.delivery_at))}</b></div></div>
      ${r.fits ? '' : '<p class="prod-warn" role="alert">This bake would have to start before the kitchen opens. Move it, or start it the day before.</p>'}
      <div class="prod-steps" aria-label="Progress">${steps.map(([, t], i) => `<span class="${i < now ? 'is-done' : i === now ? 'is-now' : ''}">${t}</span>`).join('')}</div>
      <div class="prod-box"><small>Payment</small><b class="${paid ? 'is-ok' : ''}">${e(PAY[o.payment_status] || String(o.payment_status || '—').replace(/_/g, ' '))}</b>${o.notes ? `<span class="prod-note">${e(o.notes)}</span>` : ''}</div>
      <p role="alert" class="prod-say"></p>
      ${o.status === 'pending' ? `<a class="prod-go" href="#orders/detail/${e(o.id)}">Confirm it in Orders</a>`
        : o.status === 'confirmed' && !paid ? `<p class="prod-warn">Waiting for payment. Start making opens once you mark a payment received in Orders.</p><a class="prod-go" href="#orders/detail/${e(o.id)}">Check payment in Orders</a>`
        : next ? `<button type="button" class="prod-go" data-next="${next[0]}">${e(next[1])}</button>` : ''}
      ${Number(r.minutes) ? '' : '<p class="prod-hint">No prep time is set for this product, so it takes 0 minutes in the plan. Set it in Products → the product → Prep time.</p>'}
      <div class="prod-links"><a class="prod-link" href="#orders/detail/${e(o.id)}">Open the order ${icon('arrow')}</a><a class="prod-link" href="#bookings">See it in Reservations ${icon('arrow')}</a></div>`;
    const go = box.querySelector('[data-next]');
    if (go) go.onclick = async () => {
      const say = box.querySelector('.prod-say');
      if (go.dataset.next === 'preparing' && !(await ask('Ingredients for this order are taken from Inventory now.', { title: 'Start making?', confirm: 'Start making' }))) return;
      go.disabled = true; say.textContent = '';
      try {
        await db.rpc('set_order_status', { order_id: o.id, next_status: go.dataset.next });
        orders.delete(o.id); timelines.clear();
        await Promise.all([paintToday(true), paintPlan(true)]);
        await loadOrders([o.id]); paintDetail(o.id, date);
      } catch (error) { say.textContent = error.message || 'Could not update this order.'; go.disabled = false; }
    };
    if (matchMedia('(max-width: 1100px)').matches) box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  content.addEventListener('click', (event) => {
    const b = event.target.closest('[data-pick]');
    if (!b) return;
    picked = b.dataset.pick;
    content.querySelectorAll('[data-pick]').forEach((x) => x.classList.toggle('is-picked', x.dataset.pick === picked));
    paintDetail(picked, b.dataset.date);
  });
  // opened from Orders or Reservations (#production/<order id>): jump to that order's day and open its card
  if (focus && /^[0-9a-f-]{36}$/i.test(focus)) {
    try {
      const [o] = db.unwrap(await db.client.from('orders').select('id,receiving_start').eq('id', focus)) || [];
      if (o?.receiving_start) { selected = manilaKey(new Date(o.receiving_start)); picked = focus; }
    } catch (error) { console.warn('Production focus:', error); }
  }
  await Promise.all([paintToday(), paintPlan()]);
  if (picked) { await timeline(selected); await loadOrders([picked]).catch(() => {}); paintDetail(picked, selected); }
}
