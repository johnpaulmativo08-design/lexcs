// Admin → Dashboard: a calm start to the day for the chef. "Do this next" (the most urgent order, the same rule as
// Reservations), four plain numbers for today, "Your day" (the next reservations in time order, each with its next
// step) and "Needs attention" (what is wrong and what to do: past-due orders, payments to check, money to collect,
// stock). Money received is owner-only. Data: get_booking_schedule, orders, order_payment_attempts, inventory_stock,
// get_production_day (all read-only; the database decides what each person may read).
import { escapeHtml as e, icon, money } from '../components.js?v=5';
import { db, allRows } from '../backend-ui.js?v=3';

const TZ = 'Asia/Manila';
const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const plus = (k, n) => dayKey(new Date(Date.parse(k + 'T12:00:00+08:00') + n * 86400000));
const time12 = (t) => t ? new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date('1970-01-01T' + t + 'Z')) : '';
const shortDay = (k) => new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(k + 'T12:00:00Z'));
const pieces = (t) => String(t || '').split(',').reduce((n, l) => n + Number((l.match(/×\s*(\d+)/) || [])[1] || 1) * Number((l.match(/(\d+)\s*pcs/i) || [])[1] || 1), 0);
const greet = () => { const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(new Date())); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
// next step for a reservation (same meaning as the Reservations page)
const GUIDE = (x) => {
  const del = x.fulfillment_method === 'lalamove', paid = ['paid', 'partially_paid'].includes(x.payment_status);
  if (x.status === 'pending') return { k: 'confirm', rank: 0, act: 'Confirm order', why: 'Check the date and items, then confirm.' };
  if (x.status === 'ready') return { k: 'ready', rank: 2, act: 'Complete', why: del ? 'It is ready. Book the rider, then mark it complete.' : 'It is ready. Hand it over at pickup, then mark it complete.' };
  if (x.status === 'preparing') return { k: 'bake', rank: 1, act: 'Mark ready', why: 'Baking now. Mark it ready when it is done.' };
  if (x.payment_status === 'verification_pending') return { k: 'confirm', rank: 0, act: 'Check payment', why: 'A receipt was sent. Check it and mark it received.' };
  if (paid) return { k: 'bake', rank: 1, act: 'Start baking', why: 'Paid. Ready to bake.' };
  return { k: 'money', rank: 3, act: 'See order', ghost: true, unpaid: true, why: 'Waiting for the downpayment. Nothing to bake yet.' };
};
const owner = () => window.LexcAdminAuth?.level !== 'staff';

export async function renderDashboard(content) {
  const today = dayKey(), until = plus(today, 7);
  content.innerHTML = `<div class="db2"><header class="db2-hi"><div><h1>${greet()}${owner() ? ', LexC’s' : ''}</h1><p>${e(new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ }).format(new Date()))} · here is your day</p></div>
    <button type="button" class="button" data-refresh>${icon('refresh')} Refresh</button></header>
    <div class="db2-body"><div class="db2-skel">${'<span class="skel skel-line"></span>'.repeat(6)}</div></div></div>`;
  content.querySelector('[data-refresh]').onclick = () => renderDashboard(content);
  const body = content.querySelector('.db2-body');
  let sched = [], orders = [], pays = [], stock = [], kitchen = null;
  try {
    [sched, orders, pays, stock, kitchen] = await Promise.all([
      db.rpc('get_booking_schedule', { from_date: today, to_date: until }).catch(() => []),
      allRows(() => db.client.from('orders').select('id,order_number,customer_name,status,receiving_start,receiving_end,total_amount,amount_paid,payment_status').order('id')).catch(() => []),
      allRows(() => db.client.from('order_payment_attempts').select('id,amount,status,verified_at').order('id')).catch(() => []),
      allRows(() => db.client.from('inventory_stock').select('*').eq('is_archived', false).order('id')).catch(() => []),
      db.rpc('get_production_day', { target_date: today }).catch(() => null)]);
  } catch (err) { body.innerHTML = `<p class="db2-err" role="alert">The dashboard could not load. ${e(err.message || '')}</p>`; return; }
  sched = (sched || []).filter((x) => x.status !== 'cancelled');
  const open = sched.filter((x) => x.status !== 'completed').sort((a, b) => (GUIDE(a).rank - GUIDE(b).rank) || (a.booking_date + (a.scheduled_start || '')).localeCompare(b.booking_date + (b.scheduled_start || '')));
  const byTime = sched.filter((x) => x.status !== 'completed').sort((a, b) => (a.booking_date + (a.scheduled_start || '')).localeCompare(b.booking_date + (b.scheduled_start || '')));
  const todays = sched.filter((x) => x.booking_date === today);
  const nx = open[0], ng = nx && GUIDE(nx);
  const when = (x) => (x.booking_date === today ? 'today' : x.booking_date === plus(today, 1) ? 'tomorrow' : shortDay(x.booking_date)) + ' at ' + time12(x.scheduled_start);
  const next = nx
    ? `<section class="gd-next"><span class="gd-next-ic">${icon(ng.k === 'confirm' ? 'clock' : ng.k === 'money' ? 'revenue' : ng.k === 'ready' ? 'check' : 'production')}</span>
       <div><small>Do this next · ${open.length} task${open.length === 1 ? '' : 's'} this week</small><b>${ng.act === 'Check payment' ? 'Check ' + e(nx.customer_name) + '’s payment' : e(ng.ghost ? 'Follow up on' : ng.act) + ' ' + e(nx.customer_name) + '’s order'}</b><p>${nx.fulfillment_method === 'lalamove' ? 'Delivery' : 'Pickup'} ${e(when(nx))} · ${pieces(nx.order_summary)} items${Number(nx.order_total) > 0 ? ' · ' + e(money(nx.order_total)) : ''}. ${e(ng.why)}</p></div>
       <div class="gd-next-go"><a class="gd-go" href="#bookings">Open in Reservations →</a></div></section>`
    : `<section class="gd-next is-calm"><span class="gd-next-ic">${icon('check')}</span><div><small>All caught up</small><b>Nothing needs you right now</b><p>New orders and payments will show up here.</p></div></section>`;
  // four plain numbers
  const received = pays.filter((p) => p.status === 'paid' && p.verified_at && dayKey(new Date(p.verified_at)) === today).reduce((s, p) => s + Number(p.amount || 0), 0);
  const cap = Number(kitchen?.workload_minutes) || 0, used = Number(kitchen?.accepted_minutes) || 0;
  const slotsCap = todays[0]?.capacity || (await db.client.from('booking_date_settings').select('capacity').eq('booking_date', today).maybeSingle().then((r) => r.data?.capacity).catch(() => null)) || 6;
  const del = todays.filter((x) => x.fulfillment_method === 'lalamove').length;
  const tile = (label, big, sub, extra = '') => `<div class="db2-g"><small>${label}</small><b>${big}</b>${sub ? `<span>${sub}</span>` : ''}${extra}</div>`;
  const glance = `<div class="db2-glance">${tile('Orders today', todays.length, `${del} deliver${del === 1 ? 'y' : 'ies'} · ${todays.length - del} pickup${todays.length - del === 1 ? '' : 's'}`)}
    ${owner() ? tile('Received today', e(money(received)), 'verified payments only') : tile('Payments to check', pays.filter((p) => p.status === 'verification_pending').length, 'receipts waiting')}
    ${tile('Kitchen today', `${Math.round(used)} <em>of ${cap} min</em>`, '', `<span class="db2-bar"><i style="width:${cap ? Math.min(100, used / cap * 100) : 0}%"></i></span>`)}
    ${tile('Slots left today', `${Math.max(0, slotsCap - todays.length)} <em>of ${slotsCap}</em>`, 'customers can still book')}</div>`;
  // your day: next reservations in time order
  const row = (x) => { const g = GUIDE(x), [h, ap] = time12(x.scheduled_start).split(' ');
    return `<a class="db2-row" href="#bookings"><span class="db2-t"><b>${e(h || '—')}</b><small>${e(ap || '')}</small></span><span class="db2-m"><b>${e(x.customer_name)}</b><span>${x.booking_date === today ? '' : e(x.booking_date === plus(today, 1) ? 'Tomorrow · ' : shortDay(x.booking_date) + ' · ')}${x.fulfillment_method === 'lalamove' ? 'Delivery' : 'Pickup'} · ${e(String(x.order_summary || 'Order').split(',')[0])}${String(x.order_summary || '').includes(',') ? ' + more' : ''}${g.unpaid ? ' · <b class="gd-bad">Unpaid</b>' : x.payment_status === 'paid' ? ' · paid' : ''}</span></span><span class="gd-act${g.ghost ? ' is-ghost' : ''}">${e(g.act)}</span></a>`; };
  const day = `<section class="db2-card"><h2>Your day <a href="#bookings">Open Reservations</a></h2>${byTime.length ? byTime.slice(0, 6).map(row).join('') : '<p class="db2-empty">No reservations coming up this week.</p>'}</section>`;
  // needs attention: what is wrong and what to do
  const now = Date.now();
  const late = orders.filter((o) => !['completed', 'cancelled'].includes(o.status) && o.receiving_end && Date.parse(o.receiving_end) < now);
  const owe = orders.filter((o) => o.status !== 'cancelled' && Number(o.amount_paid) > 0 && Number(o.total_amount) > Number(o.amount_paid));
  const oweSum = owe.reduce((s, o) => s + Number(o.total_amount) - Number(o.amount_paid), 0);
  const toCheck = pays.filter((p) => p.status === 'verification_pending').length;
  const out = stock.filter((i) => Number(i.stock) <= 0).length, low = stock.filter((i) => Number(i.stock) > 0 && Number(i.stock) <= Number(i.min_stock)).length;
  const att = (ic, title, text, href, label) => `<div class="db2-att"><span class="db2-dot">${icon(ic)}</span><div><b>${title}</b><p>${text}</p></div>${href ? `<a class="gd-act is-ghost" href="${href}">${label}</a>` : ''}</div>`;
  const items = [
    late.length ? att('clock', `${late.length} order${late.length === 1 ? '' : 's'} past their time`, `${late.slice(0, 3).map((o) => '#' + e(o.order_number)).join(', ')}${late.length > 3 ? ' and more' : ''} ${late.length === 1 ? 'was' : 'were'} never marked complete. Mark ${late.length === 1 ? 'it' : 'them'} complete, or contact the customer.`, '#orders', 'Review') : '',
    toCheck ? att('revenue', `${toCheck} payment${toCheck === 1 ? '' : 's'} to check`, 'Customers sent receipts. Check the money arrived, then confirm.', '#orders', 'Check') : '',
    owner() && owe.length ? att('revenue', `${e(money(oweSum))} to collect`, `${owe.length} order${owe.length === 1 ? ' has a balance' : 's have balances'} due before pickup or delivery.`, '#orders', 'View') : '',
    out || low ? att('inventory', `${out + low} stock alert${out + low === 1 ? '' : 's'}`, `${out ? out + ' out of stock' : ''}${out && low ? ' · ' : ''}${low ? low + ' running low' : ''}. Restock soon.`, '#inventory', 'Inventory') : ''].filter(Boolean);
  const attention = `<section class="db2-card"><h2>Needs attention</h2>${items.length ? items.join('') : att('check', 'All good', 'No late orders, payments to check or stock problems.')}</section>`;
  body.innerHTML = next + glance + `<div class="db2-cols">${day}${attention}</div>`;
}
