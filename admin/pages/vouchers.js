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

export async function renderVouchers(content) {
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
  content.innerHTML = head + `
    <p class="vc-stats"><span><b>${active}</b> active</span><span><b>${totalUses}</b> uses</span><span><b>${money(totalGiven)}</b> discount given</span></p>
    ${vouchers.length ? `<div class="table-wrap"><table class="vc-table"><thead><tr><th>Code</th><th>Discount</th><th>Applies to</th><th>Dates</th><th>Uses</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${vouchers.map((v) => { const u = used.get(v.id) || 0, [label, tone] = statusOf(v, u);
        const scope = v.applies_to === 'all' ? 'All products' : v.applies_to === 'products' ? `${v.voucher_products.length} product${v.voucher_products.length === 1 ? '' : 's'}` : `${v.voucher_categories.length} categor${v.voucher_categories.length === 1 ? 'y' : 'ies'}`;
        return `<tr><td><b class="vc-code">${e(v.code)}</b>${v.description ? `<small>${e(v.description)}</small>` : ''}</td>
          <td>${e(offer(v))}${Number(v.min_purchase) > 0 ? `<small>min ${money(v.min_purchase)}</small>` : ''}</td><td>${e(scope)}</td>
          <td>${v.starts_at || v.ends_at ? `${e(day(v.starts_at) || 'Now')} – ${e(day(v.ends_at) || 'no end')}` : 'Any time'}</td>
          <td>${u}${v.usage_limit ? ` / ${v.usage_limit}` : ''}<small>${money(given.get(v.id) || 0)} given · ${v.per_customer_limit}× per customer</small></td>
          <td><span class="vc-pill is-${tone}">${label}</span></td>
          <td class="vc-actions"><button class="button" type="button" data-edit="${e(v.id)}">Edit</button>
            <button class="button" type="button" data-toggle="${e(v.id)}">${v.is_active ? 'Turn off' : 'Turn on'}</button>
            <button class="button vc-danger" type="button" data-delete="${e(v.id)}" aria-label="Delete ${e(v.code)}">${icon('close')}</button></td></tr>`; }).join('')}
      </tbody></table></div>`
    : '<div class="panel vc-empty"><p><b>No vouchers yet.</b> Create a code like SWEET10 for 10% off, or ₱50 off a minimum order.</p></div>'}
    <section class="panel vc-history"><h2>Recent uses</h2>
      ${redemptions.length ? `<ul>${redemptions.slice(0, 30).map((x) => `<li><span class="vc-code">${e(x.code)}</span><a href="#orders/detail/${e(x.order_id)}">Order #${e(x.orders?.order_number ?? '')}</a><span>${e(x.orders?.customer_name || '')}</span><b>−${money(x.discount_amount)}</b><small>${e(day(x.created_at))}${x.orders?.status === 'cancelled' ? ' · cancelled, use returned' : ''}</small></li>`).join('')}</ul>` : '<p class="vc-muted">Codes used at checkout show here.</p>'}
    </section>`;

  const byId = (id) => vouchers.find((v) => v.id === id);
  content.querySelector('[data-new]').onclick = () => edit(null);
  content.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => edit(byId(b.dataset.edit))));
  content.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = async () => {
    const v = byId(b.dataset.toggle); b.disabled = true;
    try { await db.rpc('set_voucher_active', { target: v.id, active: !v.is_active }); await renderVouchers(content); } catch (error) { b.disabled = false; alert(error.message); }
  }));
  content.querySelectorAll('[data-delete]').forEach((b) => (b.onclick = async () => {
    const v = byId(b.dataset.delete);
    if (!(await ask(`“${v.code}” will be deleted for good. A voucher already used on orders can only be turned off.`, { title: 'Delete this voucher?', confirm: 'Delete', tone: 'danger' }))) return;
    try { await db.rpc('delete_voucher', { target: v.id }); await renderVouchers(content); } catch (error) { alert(error.message); }
  }));

  function edit(v) {
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
      <label class="vc-switch"><input type="checkbox" name="is_active"${!v || v.is_active ? ' checked' : ''}> Active</label>
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
        await db.rpc('save_voucher', { payload: { id: v?.id || '', code: x.code.value, description: x.description.value, discount_type: type, discount_value: x.discount_value.value,
          min_purchase: x.min_purchase.value, max_discount: type === 'percent' ? x.max_discount.value : '', starts_at: fromLocal(x.starts_at.value), ends_at: fromLocal(x.ends_at.value),
          usage_limit: x.usage_limit.value, per_customer_limit: x.per_customer_limit.value, applies_to: x.applies_to.value, is_active: x.is_active.checked,
          product_ids: checked('product_ids'), category_ids: checked('category_ids') } });
        dialog.close(); await renderVouchers(content);
      } catch (error) { button.disabled = false; say(error.message); }
    };
  }
}
