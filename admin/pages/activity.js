// Owner → Activity log (phase 115, public.audit_log): every change to orders, payments, products, prices, inventory,
// vouchers, settings, staff and the website, written by the database. Read-only; newest first, by day, 50 at a time.
// Filters: who (owner / cashier / customer / system), area, date range and search. Tap a row to see old → new values.
import { escapeHtml as e, icon } from '../components.js?v=5';
import { db } from '../backend-ui.js?v=3';

const TZ = 'Asia/Manila', PAGE = 50;
const AREAS = {
  orders: ['Orders', ['orders', 'order_payment_attempts']],
  menu: ['Products & prices', ['products', 'product_variants', 'design_options', 'categories']],
  inventory: ['Inventory', ['inventory_items', 'inventory_batches']],
  vouchers: ['Vouchers & payment', ['vouchers', 'payment_methods', 'delivery_pricing']],
  schedule: ['Schedule & kitchen', ['booking_date_settings', 'production_settings']],
  people: ['Staff & roles', ['staff_members', 'user_roles']],
  website: ['Website', ['site_faqs', 'site_announcements', 'site_content']],
};
const THING = { orders: 'order', order_payment_attempts: 'payment', products: 'product', product_variants: 'product size', design_options: 'designer option',
  categories: 'category', inventory_items: 'inventory item', inventory_batches: 'stock batch', vouchers: 'voucher', payment_methods: 'payment method',
  delivery_pricing: 'delivery pricing', booking_date_settings: 'reservation date', production_settings: 'kitchen setting', staff_members: 'cashier',
  user_roles: 'role', site_faqs: 'FAQ', site_announcements: 'announcement', site_content: 'website content' };
const ROLE = { owner: 'Owner', cashier: 'Cashier', customer: 'Customer', system: 'System' };
const words = (k) => String(k).replace(/_snapshot$|_id$/, '').replaceAll('_', ' ');
const val = (v) => v === null || v === undefined || v === '' ? '—' : v === 'true' ? 'Yes' : v === 'false' ? 'No' : String(v).replaceAll('_', ' ');
const when = (t) => new Intl.DateTimeFormat('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
const dayOf = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(t));
const dayName = (d) => new Intl.DateTimeFormat('en-PH', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(d + 'T12:00:00+08:00'));

// one plain sentence per change
function sentence(r, label) {
  const c = r.changes || {}, thing = THING[r.target_table] || words(r.target_table), name = label || '';
  if (r.target_table === 'orders' && r.action === 'update') {
    if (c.status) return `${name || 'Order'}: status ${val(c.status[0])} → ${val(c.status[1])}`;
    if (c.payment_status) return `${name || 'Order'}: payment ${val(c.payment_status[0])} → ${val(c.payment_status[1])}`;
  }
  if (r.target_table === 'orders' && r.action === 'insert') return `${name || 'Order'} placed`;
  if (r.target_table === 'order_payment_attempts' && c.status) return r.action === 'insert' ? `Payment sent for ${name || 'an order'}` : `Payment for ${name || 'an order'}: ${val(c.status[0])} → ${val(c.status[1])}`;
  if (r.action === 'update' && c.price) return `${name ? name + ': ' : ''}price ₱${val(c.price[0])} → ₱${val(c.price[1])}`;
  const keys = Object.keys(c);
  if (r.action === 'insert') return `Added ${thing}${name ? ' ' + name : ''}`;
  if (r.action === 'delete') return `Removed ${thing}${name ? ' ' + name : ''}`;
  return `Changed ${thing}${name ? ' ' + name : ''}: ${keys.slice(0, 3).map(words).join(', ')}${keys.length > 3 ? ' +' + (keys.length - 3) : ''}`;
}

export async function renderActivity(content) {
  let who = '', area = '', from = '', to = '', search = '', rows = [], done = false, loading = false;
  const people = new Map(), labels = new Map();
  content.innerHTML = `<header class="module-heading"><div><h1>Activity log</h1><p>Who changed what, and when. Recorded by the database; nobody can edit or delete it.</p></div></header>
   <section class="al-tools panel"><div class="al-chips" role="group" aria-label="Who">${[['', 'Everyone'], ['owner', 'Owner'], ['cashier', 'Cashiers'], ['customer', 'Customers'], ['system', 'System']].map(([k, l]) => `<button type="button" data-who="${k}" class="al-chip${k === who ? ' is-on' : ''}">${l}</button>`).join('')}</div>
    <div class="al-fields"><select data-area aria-label="Area"><option value="">All areas</option>${Object.entries(AREAS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <label>From <input type="date" data-from></label><label>To <input type="date" data-to></label>
    <label class="al-search">${icon('search')}<input type="search" placeholder="Search this list…" data-search></label></div></section>
   <section class="al-list" aria-live="polite"><div class="al-skel">${'<span class="skel skel-line"></span>'.repeat(6)}</div></section>
   <div class="al-more"><button type="button" class="button" data-more hidden>Load more</button></div>`;
  const list = content.querySelector('.al-list'), more = content.querySelector('[data-more]');

  async function names(batch) {
    const ids = [...new Set(batch.map((r) => r.actor_id).filter((id) => id && !people.has(id)))];
    if (ids.length) { try { (db.unwrap(await db.client.from('profiles').select('id,full_name').in('id', ids)) || []).forEach((p) => people.set(p.id, p.full_name)); } catch {} }
    const want = (table, col) => [...new Set(batch.filter((r) => r.target_table === table && r.target_id && !labels.has(table + r.target_id)).map((r) => r.target_id))];
    const look = async (table, col, fmt) => { const ids_ = want(table); if (!ids_.length) return; try { (db.unwrap(await db.client.from(table).select('id,' + col).in('id', ids_)) || []).forEach((x) => labels.set(table + x.id, fmt(x))); } catch {} };
    await Promise.all([look('orders', 'order_number', (x) => 'Order #' + x.order_number), look('products', 'name', (x) => x.name), look('inventory_items', 'name', (x) => x.name), look('vouchers', 'code', (x) => x.code)]);
    // a payment attempt or variant points at its order or product
    batch.forEach((r) => { const c = r.changes || {}; if (r.target_table === 'order_payment_attempts' && c.order_id?.[1]) labels.set(r.target_table + r.target_id, labels.get('orders' + c.order_id[1]) || ''); if (r.target_table === 'site_faqs' && c.question) labels.set(r.target_table + r.target_id, '“' + (c.question[1] || c.question[0]) + '”'); });
  }
  async function load(reset) {
    if (loading) return; loading = true;
    if (reset) { rows = []; done = false; list.innerHTML = '<div class="al-skel">' + '<span class="skel skel-line"></span>'.repeat(6) + '</div>'; }
    try {
      let q = db.client.from('audit_log').select('id,at,actor_id,actor_role,action,target_table,target_id,changes').order('at', { ascending: false }).range(rows.length, rows.length + PAGE - 1);
      if (who) q = q.eq('actor_role', who);
      if (area) q = q.in('target_table', AREAS[area][1]);
      if (from) q = q.gte('at', from + 'T00:00:00+08:00');
      if (to) q = q.lt('at', new Date(Date.parse(to + 'T00:00:00+08:00') + 86400000).toISOString());
      const batch = db.unwrap(await q) || [];
      await names(batch); rows = rows.concat(batch); done = batch.length < PAGE; draw();
    } catch (err) {
      list.innerHTML = `<p class="al-empty" role="alert">${/audit_log|schema cache/i.test(err.message || '') ? 'The activity log isn’t set up yet (database/phase115-audit-log.sql).' : 'The activity log could not load. ' + e(err.message || '')}</p>`;
    } finally { loading = false; }
  }
  function draw() {
    const s = search.trim().toLowerCase();
    const shown = rows.map((r) => ({ r, text: sentence(r, labels.get(r.target_table + r.target_id)), by: r.actor_id ? people.get(r.actor_id) || ROLE[r.actor_role] : ROLE[r.actor_role] }))
      .filter((x) => !s || (x.text + ' ' + x.by).toLowerCase().includes(s));
    more.hidden = done;
    if (!shown.length) { list.innerHTML = `<div class="al-empty">${icon('clock')}<b>No activity found</b><span>${rows.length ? 'Nothing matches your search.' : 'Try another filter or date.'}</span></div>`; return; }
    let day = '', html = '';
    shown.forEach(({ r, text, by }) => {
      const d = dayOf(r.at); if (d !== day) { html += `${day ? '</ol>' : ''}<h2 class="al-day">${e(dayName(d))}</h2><ol class="al-day-list">`; day = d; }
      const ch = Object.entries(r.changes || {});
      html += `<li class="al-row is-${e(r.actor_role)}"><details><summary><time>${e(when(r.at))}</time><span class="al-who"><i>${e(ROLE[r.actor_role])}</i>${e(by)}</span><span class="al-what">${e(text)}</span><span class="al-chev" aria-hidden="true">▾</span></summary>
        ${ch.length ? `<table class="al-diff"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${ch.map(([k, [a, b]]) => `<tr><td>${e(words(k))}</td><td>${e(val(a))}</td><td>${e(val(b))}</td></tr>`).join('')}</tbody></table>` : '<p class="al-none">No field details.</p>'}</details></li>`;
    });
    list.innerHTML = html + '</ol>';
  }
  content.querySelectorAll('[data-who]').forEach((b) => b.onclick = () => { who = b.dataset.who; content.querySelectorAll('[data-who]').forEach((x) => x.classList.toggle('is-on', x === b)); load(true); });
  content.querySelector('[data-area]').onchange = (ev) => { area = ev.target.value; load(true); };
  content.querySelector('[data-from]').onchange = (ev) => { from = ev.target.value; load(true); };
  content.querySelector('[data-to]').onchange = (ev) => { to = ev.target.value; load(true); };
  content.querySelector('[data-search]').oninput = (ev) => { search = ev.target.value; draw(); };
  more.onclick = () => load(false);
  await load(true);
}
