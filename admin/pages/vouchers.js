// Admin → Vouchers (phase 103): discount codes customers type at checkout. Create, edit, switch on/off and delete
// vouchers; see each one's status, uses and the discount given. Saving goes through public.save_voucher (admin only);
// the discount itself is always worked out by the database when the order is placed.
import { escapeHtml as e, icon, money, showDetails } from '../components.js?v=5';
import { db, loadingTable } from '../backend-ui.js?v=3';
import { ask } from '../../shared/ask.js?v=2';

const local = (iso) => iso ? new Date(new Date(iso).getTime() + 8 * 36e5).toISOString().slice(0, 16) : '';   // Manila, for <input type=datetime-local>
const fromLocal = (v) => v ? new Date(v + ':00+08:00').toISOString() : '';
const day = (iso) => iso ? new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }) : '';

function statusOf(v, used) {
  const now = Date.now();
  if (!v.is_active) return ['Off', 'off'];
  if (v.ends_at && Date.parse(v.ends_at) < now) return ['Expired', 'off'];
  if (v.starts_at && Date.parse(v.starts_at) > now) return ['Scheduled', 'wait'];
  if (v.usage_limit && used >= v.usage_limit) return ['Used up', 'off'];
  return ['Active', 'ok'];
}
const offer = (v) => v.discount_type === 'percent' ? `${Number(v.discount_value)}% off${v.max_discount ? ` (max ${money(v.max_discount)})` : ''}` : `${money(v.discount_value)} off`;

export async function renderVouchers(content, openId = null) {
  const head = `<header class="module-heading"><div><h1>Vouchers</h1><p>Discount codes customers can use at checkout.</p></div>
    <button class="button primary" type="button" data-new>${icon('plus')} New voucher</button></header>`;
  content.innerHTML = head + loadingTable(6);
  let vouchers = [], used = new Map(), given = new Map(), redemptions = [], products = [], categories = [];
  try {
    const [v, r, p, c] = await Promise.all([
      db.client.from('vouchers').select('*,voucher_products(product_id),voucher_categories(category_id)').order('created_at', { ascending: false }),
      db.client.from('voucher_redemptions').select('id,voucher_id,order_id,code,discount_amount,created_at,orders(order_number,status,customer_name)').order('created_at', { ascending: false }).limit(200),
      db.client.from('products').select('id,name,status').neq('status', 'archived').order('name'),
      db.client.from('categories').select('id,name,is_active').order('sort_order'),
    ]);
    if (v.error) throw v.error;
    vouchers = v.data || []; redemptions = (r.data || []); products = p.data || []; categories = c.data || [];
    redemptions.forEach((x) => { if (x.orders?.status === 'cancelled') return; used.set(x.voucher_id, (used.get(x.voucher_id) || 0) + 1); given.set(x.voucher_id, (given.get(x.voucher_id) || 0) + Number(x.discount_amount)); });
  } catch (error) {
    const missing = /vouchers|schema cache/i.test(error.message || '');
    content.innerHTML = head + `<div class="panel vc-empty" role="alert"><p>${missing ? 'Vouchers aren’t set up yet. Run database/phase103-vouchers.sql in the Supabase SQL editor first.' : 'Vouchers could not load.'}</p>${missing ? '' : '<button class="button" type="button" data-retry>Try again</button>'}</div>`;
    content.querySelector('[data-retry]')?.addEventListener('click', () => renderVouchers(content));
    content.querySelector('[data-new]').disabled = missing;
    return;
  }
  const totalUses = [...used.values()].reduce((a, b) => a + b, 0), totalGiven = [...given.values()].reduce((a, b) => a + b, 0);
  const active = vouchers.filter((v) => statusOf(v, used.get(v.id) || 0)[1] === 'ok').length;
  const hasShown = vouchers.length === 0 || 'show_to_customers' in vouchers[0];
  const tabs = [['all', 'All'], ['ok', 'Active'], ['wait', 'Scheduled'], ['off', 'Off & ended']];
  const scopeOf = (v) => v.applies_to === 'all' ? 'all products' : v.applies_to === 'products' ? `${v.voucher_products.length} selected product${v.voucher_products.length === 1 ? '' : 's'}` : `${v.voucher_categories.length} selected categor${v.voucher_categories.length === 1 ? 'y' : 'ies'}`;
  // the big number of the ticket: "10 % OFF" or "₱ 50 OFF"
  const big = (v) => v.discount_type === 'percent' ? `<span class="vt-num">${Number(v.discount_value)}</span><span class="vt-unit">% OFF</span>` : `<span class="vt-cur">₱</span><span class="vt-num">${Number(v.discount_value).toLocaleString('en-PH')}</span><span class="vt-unit">OFF</span>`;
  const until = (v) => v.ends_at ? `Valid until ${day(v.ends_at)}` : v.starts_at && Date.parse(v.starts_at) > Date.now() ? `Starts ${day(v.starts_at)}` : 'No end date';
  const stub = (v) => `<span class="vt-stub" aria-hidden="true">${v.discount_type === 'percent' ? '%' : '₱'}</span>`;
  // a decorative barcode drawn from the code's letters (the code itself is printed under it)
  const bars = (code) => [...code].flatMap((ch, i) => { const n = ch.charCodeAt(0) * 7 + i; return [1 + (n % 3), 1 + ((n >> 2) % 2), 2 + ((n >> 1) % 3), 1 + (n % 2)]; })
    .map((w, i) => `<i style="width:${w}px"${i % 2 ? ' class="gap"' : ''}></i>`).join('');
  let tab = 'all';
  try { tab = sessionStorage.getItem('lexc-vc-tab') || 'all'; } catch { /* private window */ }
  const byId = (id) => vouchers.find((v) => v.id === id);

  const list = () => {
    const shown = vouchers.filter((v) => tab === 'all' || statusOf(v, used.get(v.id) || 0)[1] === tab);
    content.innerHTML = head + `
    <p class="vc-stats"><span><b>${active}</b> active</span><span><b>${totalUses}</b> uses</span><span><b>${money(totalGiven)}</b> discount given</span></p>
    ${hasShown ? '' : '<p class="notice">To let customers see and pick vouchers, run database/phase105-voucher-wallet.sql in the Supabase SQL editor.</p>'}
    <nav class="vt-tabs" aria-label="Filter vouchers">${tabs.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'is-on' : ''}" aria-pressed="${k === tab}">${l}</button>`).join('')}</nav>
    ${shown.length ? `<div class="vt-list">${shown.map((v) => { const u = used.get(v.id) || 0, [label, tone] = statusOf(v, u);
      return `<button type="button" class="vt-ticket is-${tone}" data-open="${e(v.id)}" aria-label="Open voucher ${e(v.code)}">
        ${stub(v)}<span class="vt-cut" aria-hidden="true"></span>
        <span class="vt-body"><span class="vt-code">${e(v.code)}${v.show_to_customers ? '<em>Shown</em>' : ''}</span><span class="vt-big">${big(v)}</span>
        <span class="vt-until">${e(until(v))}</span></span>
        <span class="vt-side"><span class="vc-pill is-${tone}">${label}</span><span class="vt-uses">${u}${v.usage_limit ? ` / ${v.usage_limit}` : ''} used</span></span></button>`; }).join('')}</div>`
    : vouchers.length ? '<div class="panel vc-empty"><p>No vouchers here.</p></div>'
    : '<div class="panel vc-empty"><p><b>No vouchers yet.</b> Create a code like SWEET10 for 10% off, or ₱50 off a minimum order.</p></div>'}
    <section class="panel vc-history"><h2>Recent uses</h2>
      ${redemptions.length ? `<ul>${redemptions.slice(0, 30).map((x) => `<li><span class="vc-code">${e(x.code)}</span><a href="#orders/detail/${e(x.order_id)}">Order #${e(x.orders?.order_number ?? '')}</a><span>${e(x.orders?.customer_name || '')}</span><b>−${money(x.discount_amount)}</b><small>${e(day(x.created_at))}${x.orders?.status === 'cancelled' ? ' · cancelled, use returned' : ''}</small></li>`).join('')}</ul>` : '<p class="vc-muted">Codes used at checkout show here.</p>'}
    </section>`;
    content.querySelector('[data-new]').onclick = () => edit(null);
    content.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; try { sessionStorage.setItem('lexc-vc-tab', tab); } catch { /* ignore */ } list(); }));
    content.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => detail(byId(b.dataset.open))));
  };

  // one voucher, drawn as the full ticket (rules, tear line, code), with every action on it
  const detail = (v) => {
    const u = used.get(v.id) || 0, [label, tone] = statusOf(v, u);
    const rules = [Number(v.min_purchase) > 0 ? `Minimum purchase of ${money(v.min_purchase)} on eligible items.` : 'No minimum purchase.',
      v.discount_type === 'percent' && v.max_discount ? `Discount capped at ${money(v.max_discount)}.` : '',
      `Valid for ${scopeOf(v)}.`, `${v.per_customer_limit}× per customer${v.usage_limit ? ` · ${v.usage_limit} uses in total` : ''}.`,
      v.starts_at ? `Starts ${day(v.starts_at)}.` : '', 'One voucher per order. No cash value.'].filter(Boolean);
    content.innerHTML = `<header class="vt-detail-head"><button type="button" class="vt-back" data-back aria-label="Back to vouchers">‹</button><h1>Voucher</h1><span class="vc-pill is-${tone}">${label}</span></header>
    <article class="vt-detail">
      <div class="vt-detail-top">${stub(v)}<div><p class="vt-code">${e(v.code)}</p><p class="vt-big">${big(v)}</p></div></div>
      ${v.description ? `<p class="vt-desc">${e(v.description)}</p>` : ''}
      <ul class="vt-rules">${rules.map((r) => `<li>${e(r)}</li>`).join('')}</ul>
      <div class="vt-tear" aria-hidden="true"></div>
      <div class="vt-bars" aria-hidden="true">${bars(v.code)}</div><p class="vt-codeline">${e(v.code)}</p>
      <p class="vt-foot"><span>${e(until(v))}</span><span>${u} used · ${money(given.get(v.id) || 0)} given</span></p>
    </article>
    <div class="vt-actions">
      <button class="button primary" type="button" data-edit>${icon('edit')} Edit voucher</button>
      ${hasShown ? `<label class="vt-switch"><input type="checkbox" data-shown${v.show_to_customers ? ' checked' : ''}> Show to customers</label>` : ''}
      <button class="button" type="button" data-toggle>${v.is_active ? 'Turn off' : 'Turn on'}</button>
      <button class="button vc-danger" type="button" data-delete>Delete</button>
    </div><p class="vt-hint">${v.show_to_customers ? 'Customers see this in their voucher pop-up and can pick it at checkout.' : 'Hidden from the voucher pop-up. Customers can still use it by typing the code.'}</p>`;
    const again = async () => { await renderVouchers(content, v.id); };
    content.querySelector('[data-back]').onclick = () => list();
    content.querySelector('[data-edit]').onclick = () => edit(v, again);
    content.querySelector('[data-toggle]').onclick = async (ev) => { const b = ev.currentTarget; b.disabled = true; try { await db.rpc('set_voucher_active', { target: v.id, active: !v.is_active }); await again(); } catch (error) { b.disabled = false; alert(error.message); } };
    const sw = content.querySelector('[data-shown]');
    if (sw) sw.onchange = async () => { sw.disabled = true; try { await db.rpc('set_voucher_shown', { target: v.id, shown: sw.checked }); await again(); } catch (error) { sw.checked = !sw.checked; sw.disabled = false; alert(/set_voucher_shown|schema cache/i.test(error.message) ? 'Run database/phase105-voucher-wallet.sql first.' : error.message); } };
    content.querySelector('[data-delete]').onclick = async () => {
      if (!(await ask(`“${v.code}” will be deleted for good. A voucher already used on orders can only be turned off.`, { title: 'Delete this voucher?', confirm: 'Delete', tone: 'danger' }))) return;
      try { await db.rpc('delete_voucher', { target: v.id }); await renderVouchers(content); } catch (error) { alert(error.message); }
    };
  };

  if (openId && byId(openId)) detail(byId(openId)); else list();

  function edit(v, after) {
    const pick = new Set((v?.voucher_products || []).map((x) => x.product_id)), cats = new Set((v?.voucher_categories || []).map((x) => x.category_id));
    const dialog = showDetails(v ? `Edit ${v.code}` : 'New voucher', `<form class="vc-form">
      <div class="vc-grid">
        <label class="form-field">Code<input name="code" required maxlength="30" value="${e(v?.code || '')}" placeholder="SWEET10" autocapitalize="characters"></label>
        <label class="form-field">Short note (shown to customers)<input name="description" maxlength="200" value="${e(v?.description || '')}" placeholder="10% off cakes this month"></label>
        <label class="form-field">Discount type<select name="discount_type"><option value="percent"${v?.discount_type === 'percent' ? ' selected' : ''}>Percentage (%)</option><option value="fixed"${v?.discount_type === 'fixed' || !v ? ' selected' : ''}>Fixed amount (₱)</option></select></label>
        <label class="form-field">Discount<input name="discount_value" type="number" min="0.01" step="0.01" required value="${e(v?.discount_value ?? '')}"></label>
        <label class="form-field">Minimum purchase (₱)<input name="min_purchase" type="number" min="0" step="0.01" value="${e(v?.min_purchase ?? 0)}"></label>
        <label class="form-field" data-maxwrap>Maximum discount (₱, for %)<input name="max_discount" type="number" min="0.01" step="0.01" value="${e(v?.max_discount ?? '')}" placeholder="No limit"></label>
        <label class="form-field">Starts<input name="starts_at" type="datetime-local" value="${e(local(v?.starts_at))}"></label>
        <label class="form-field">Ends<input name="ends_at" type="datetime-local" value="${e(local(v?.ends_at))}"></label>
        <label class="form-field">Total uses allowed<input name="usage_limit" type="number" min="1" step="1" value="${e(v?.usage_limit ?? '')}" placeholder="Unlimited"></label>
        <label class="form-field">Uses per customer<input name="per_customer_limit" type="number" min="1" max="100" step="1" value="${e(v?.per_customer_limit ?? 1)}"></label>
      </div>
      <fieldset class="vc-scope"><legend>Applies to</legend>
        <label><input type="radio" name="applies_to" value="all"${!v || v.applies_to === 'all' ? ' checked' : ''}> All products</label>
        <label><input type="radio" name="applies_to" value="products"${v?.applies_to === 'products' ? ' checked' : ''}> Selected products</label>
        <label><input type="radio" name="applies_to" value="categories"${v?.applies_to === 'categories' ? ' checked' : ''}> Selected categories</label></fieldset>
      <div class="vc-pick" data-for="products">${products.map((p) => `<label><input type="checkbox" name="product_ids" value="${e(p.id)}"${pick.has(p.id) ? ' checked' : ''}> ${e(p.name)}</label>`).join('')}</div>
      <div class="vc-pick" data-for="categories">${categories.map((c) => `<label><input type="checkbox" name="category_ids" value="${e(c.id)}"${cats.has(c.id) ? ' checked' : ''}> ${e(c.name)}</label>`).join('')}</div>
      <label class="vc-switch"><input type="checkbox" name="is_active"${!v || v.is_active ? ' checked' : ''}> Active</label>${hasShown ? `<label class="vc-switch"><input type="checkbox" name="show_to_customers"${v?.show_to_customers ? ' checked' : ''}> Show to customers (voucher pop-up and checkout list)</label>` : ''}
      <p role="alert" class="vc-error"></p>
      <button class="button primary" type="submit">${icon('save')} Save voucher</button></form>`, null);
    const f = dialog.querySelector('form'), say = (t) => { f.querySelector('[role=alert]').textContent = t; };
    const sync = () => { const scope = f.elements.applies_to.value; f.querySelectorAll('.vc-pick').forEach((x) => { x.hidden = x.dataset.for !== scope; }); f.querySelector('[data-maxwrap]').hidden = f.elements.discount_type.value !== 'percent'; };
    f.addEventListener('change', sync); sync();
    f.onsubmit = async (ev) => {
      ev.preventDefault(); say('');
      const x = f.elements, type = x.discount_type.value, value = Number(x.discount_value.value);
      if (type === 'percent' && (value <= 0 || value > 100)) return say('A percentage must be between 0 and 100.');
      if (x.starts_at.value && x.ends_at.value && x.ends_at.value <= x.starts_at.value) return say('The end must be after the start.');
      const checked = (n) => [...f.querySelectorAll(`[name=${n}]:checked`)].map((i) => i.value);
      if (x.applies_to.value === 'products' && !checked('product_ids').length) return say('Pick at least one product.');
      if (x.applies_to.value === 'categories' && !checked('category_ids').length) return say('Pick at least one category.');
      const button = f.querySelector('[type=submit]'); button.disabled = true;
      try {
        const saved = await db.rpc('save_voucher', { payload: { id: v?.id || '', code: x.code.value, description: x.description.value, discount_type: type, discount_value: x.discount_value.value,
          min_purchase: x.min_purchase.value, max_discount: type === 'percent' ? x.max_discount.value : '', starts_at: fromLocal(x.starts_at.value), ends_at: fromLocal(x.ends_at.value),
          usage_limit: x.usage_limit.value, per_customer_limit: x.per_customer_limit.value, applies_to: x.applies_to.value, is_active: x.is_active.checked,
          product_ids: checked('product_ids'), category_ids: checked('category_ids') } });
        if (hasShown && Boolean(saved?.show_to_customers) !== x.show_to_customers.checked) await db.rpc('set_voucher_shown', { target: saved.id, shown: x.show_to_customers.checked });
        dialog.close(); if (after) await after(); else await renderVouchers(content);
      } catch (error) { button.disabled = false; say(error.message); }
    };
  }
}
