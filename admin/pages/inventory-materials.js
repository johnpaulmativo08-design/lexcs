// Materials overview: item-level stock (all batches combined), status summary and the item drawer.
import { escapeHtml as e, showDetails } from '../components.js?v=3';
import { db } from '../backend-ui.js?v=3';
import {
  attr, icon, qty, dateTime, dateOnly, stockStatus, movementBadge, delta, sectionTabs, pageHead,
  skeletonSummary, skeletonRows, skeletonPanel, errorState, emptyState, openDrawer, toast, requestId
} from '../inventory-ui.js?v=1';
import { renderStockForm, refreshInventoryNotificationBadge } from './inventory.js?v=19';

// Show conversions the natural way round: "1 pcs = 225 g" instead of "1 g = 0.004444 pcs".
const perStockUnit = (factor) => Number((1 / Number(factor)).toPrecision(5));
const conversionText = (c, stockUnit) => `1 ${stockUnit} = ${perStockUnit(c.factor).toLocaleString('en-PH', { maximumFractionDigits: 4 })} ${c.unit}`;
const STATUS_ORDER = { 'Out of Stock': 0, 'Low Stock': 1, 'Expiring Soon': 2, 'In Stock': 3 };
const UNIT_GROUPS = { mass: ['g', 'kg', 'mg'], volume: ['mL', 'L'], count: ['pcs', 'dozen'], length: ['cm', 'm', 'inch', 'yard'] };
const compatibleUnits = (unit) => Object.values(UNIT_GROUPS).find((group) => group.includes(unit)) || [unit];

export async function renderMaterials(content, preset = '') {
  const state = {
    search: '', category: '', type: '', status: { low: 'Low Stock', out: 'Out of Stock', expiring: 'Expiring Soon' }[preset] || '',
    updated: '', data: null
  };
  const shell = (body) => `<section class="inventory-page stock-page">${pageHead('Inventory', 'Manage ingredients, supplies and stock movements.', `<button class="button button--primary" type="button" data-add-stock>${icon('plus')} Add stock</button>`)}${sectionTabs('materials')}${body}</section>`;

  const load = async () => {
    content.innerHTML = shell(`<div class="stock-toolbar" aria-hidden="true"><span class="skel skel-line" style="height:42px;width:min(420px,100%)"></span></div>${skeletonSummary()}${skeletonRows(['Material', 'Category', 'Current stock', 'Minimum', 'Status', 'Last updated', ''])}`);
    try {
      state.data = await db.rpc('inventory_overview', {});
      if (!content.isConnected) return;
      render();
      const focus = sessionStorage.getItem('lexc-inventory-focus-item');
      if (focus) { sessionStorage.removeItem('lexc-inventory-focus-item'); openItem(focus); }
    } catch (error) {
      console.warn('Inventory overview failed:', error);
      content.innerHTML = shell(errorState('Inventory could not load'));
      content.querySelector('[data-retry]').onclick = load;
    }
  };

  const filtered = () => {
    const now = Date.now();
    const term = state.search.trim().toLowerCase();
    return (state.data?.items || []).filter((item) =>
      (!term || `${item.name} ${item.item_code || ''} ${item.category}`.toLowerCase().includes(term))
      && (!state.category || item.category === state.category)
      && (!state.type || item.inventory_type === state.type)
      && (!state.status || item.status === state.status)
      && (!state.updated || (item.last_movement_at && now - new Date(item.last_movement_at).getTime() <= Number(state.updated) * 86400000))
    ).sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || a.name.localeCompare(b.name));
  };

  const render = () => {
    const items = state.data.items || [];
    const count = (status) => items.filter((item) => item.status === status).length;
    const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort();
    const rows = filtered();
    const tile = (label, value, status, tone) => `<button type="button" class="stock-tile stock-tile--${tone}${state.status === status ? ' is-active' : ''}" data-tile="${attr(status)}" aria-pressed="${state.status === status}"><span>${e(label)}</span><strong>${value}</strong></button>`;
    const pending = Number(state.data.pending_allocations || 0);
    content.innerHTML = shell(`
      ${pending ? `<a class="stock-banner" href="#orders">${icon('alert')}<span><strong>${pending} paid order${pending === 1 ? ' is' : 's are'} waiting for materials.</strong> Restock the missing items, then retry the allocation from the order.</span>${icon('arrow')}</a>` : ''}
      <div class="stock-toolbar">
        <label class="stock-search">${icon('search')}<span class="sr-only">Search inventory</span><input type="search" data-search value="${attr(state.search)}" placeholder="Search inventory…" autocomplete="off"></label>
        <div class="stock-filters">
          <label><span class="sr-only">Category</span><select data-filter="category"><option value="">All categories</option>${categories.map((c) => `<option ${state.category === c ? 'selected' : ''}>${e(c)}</option>`).join('')}</select></label>
          <label><span class="sr-only">Type</span><select data-filter="type"><option value="">All types</option><option value="ingredient" ${state.type === 'ingredient' ? 'selected' : ''}>Ingredients</option><option value="packaging" ${state.type === 'packaging' ? 'selected' : ''}>Packaging</option></select></label>
          <label><span class="sr-only">Status</span><select data-filter="status"><option value="">All statuses</option>${['In Stock', 'Low Stock', 'Out of Stock', 'Expiring Soon'].map((s) => `<option value="${s}" ${state.status === s ? 'selected' : ''}>${s === 'In Stock' ? 'Available' : s}</option>`).join('')}</select></label>
          <label><span class="sr-only">Last updated</span><select data-filter="updated"><option value="">Any date</option><option value="1" ${state.updated === '1' ? 'selected' : ''}>Updated today</option><option value="7" ${state.updated === '7' ? 'selected' : ''}>Last 7 days</option><option value="30" ${state.updated === '30' ? 'selected' : ''}>Last 30 days</option></select></label>
        </div>
      </div>
      <div class="stock-summary">${tile('Total materials', items.length, '', 'neutral')}${tile('Low stock', count('Low Stock'), 'Low Stock', 'warning')}${tile('Out of stock', count('Out of Stock'), 'Out of Stock', 'danger')}${tile('Expiring soon', count('Expiring Soon'), 'Expiring Soon', 'info')}</div>
      <p class="stock-count" aria-live="polite">${rows.length} of ${items.length} materials</p>
      ${rows.length ? `
      <div class="panel stock-table-panel"><table class="data-table stock-table">
        <thead><tr><th scope="col">Material</th><th scope="col">Category</th><th scope="col" class="num">Current stock</th><th scope="col" class="num">Minimum</th><th scope="col">Status</th><th scope="col">Last updated</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
        <tbody>${rows.map((item) => `<tr data-item-row="${attr(item.id)}">
          <td><strong>${e(item.name)}</strong><small>${e(item.item_code || '')}${item.recipe_count ? ` · in ${item.recipe_count} active recipe${item.recipe_count === 1 ? '' : 's'}` : ''}</small></td>
          <td>${e(item.category || (item.inventory_type === 'packaging' ? 'Packaging' : 'Ingredients'))}</td>
          <td class="num"><strong class="stock-amount">${qty(item.available, item.unit)}</strong></td>
          <td class="num stock-quiet">${qty(item.min_stock, item.unit)}</td>
          <td>${stockStatus(item.status)}</td>
          <td class="stock-quiet">${item.last_movement_at ? dateTime(item.last_movement_at) : 'No movements'}</td>
          <td><button class="button button--small" type="button" data-open-item="${attr(item.id)}" aria-label="View ${attr(item.name)}">View</button></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="stock-cards">${rows.map((item) => `<article class="stock-card">
          <div class="stock-card__top"><h3>${e(item.name)}</h3>${stockStatus(item.status)}</div>
          <p class="stock-card__amount">${qty(item.available, item.unit)} <span>available</span></p>
          <p class="stock-card__meta">Minimum: ${qty(item.min_stock, item.unit)} · ${e(item.category || '')}</p>
          <button class="button stock-card__action" type="button" data-open-item="${attr(item.id)}">View details ${icon('arrow')}</button>
        </article>`).join('')}</div>` : `<div class="panel">${emptyState('No matching materials', 'Try a different search or clear the filters.', '<button class="button" type="button" data-clear>Clear filters</button>')}</div>`}
      <section class="panel stock-recent"><header class="panel__head"><div><h2>Recent movements</h2><p>Every change is kept in the permanent inventory ledger.</p></div><a class="text-button" href="#inventory/movements">View full history →</a></header>
        ${(state.data.recent || []).length ? `<ul class="stock-feed">${state.data.recent.map((m) => `<li>${movementBadge(m.movement_type)}<span><strong>${e(m.item_name)}</strong>${m.order_number ? ` · <a href="#orders/detail/${attr(m.order_id)}">Order #${e(m.order_number)}</a>` : ''}<small>${dateTime(m.created_at)}</small></span>${delta(m.quantity_delta, m.unit)}</li>`).join('')}</ul>` : emptyState('No stock movements yet')}
      </section>`);
    bind();
  };

  const bind = () => {
    content.querySelector('[data-add-stock]').onclick = () => renderStockForm({ items: state.data?.items || [], onSuccess: load });
    const search = content.querySelector('[data-search]');
    search.oninput = () => { clearTimeout(bind.timer); bind.timer = setTimeout(() => { state.search = search.value; render(); const input = content.querySelector('[data-search]'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 140); };
    content.querySelectorAll('[data-filter]').forEach((select) => { select.onchange = () => { state[select.dataset.filter] = select.value; render(); }; });
    content.querySelectorAll('[data-tile]').forEach((tile) => { tile.onclick = () => { state.status = state.status === tile.dataset.tile ? '' : tile.dataset.tile; render(); }; });
    content.querySelector('[data-clear]')?.addEventListener('click', () => { Object.assign(state, { search: '', category: '', type: '', status: '', updated: '' }); render(); });
    content.querySelectorAll('[data-open-item]').forEach((button) => { button.onclick = (event) => { event.stopPropagation(); openItem(button.dataset.openItem); }; });
    content.querySelectorAll('[data-item-row]').forEach((row) => { row.onclick = (event) => { if (!event.target.closest('a,button')) openItem(row.dataset.itemRow); }; });
  };

  const openItem = (id) => openItemDrawer(id, { onChange: load });
  await load();
}

export async function openItemDrawer(itemId, { onChange } = {}) {
  const drawer = openDrawer('Material details', skeletonPanel(3) + '<div class="stock-drawer__stats">' + '<div class="stock-stat"><span class="skel skel-line skel-line--short"></span><span class="skel skel-value"></span></div>'.repeat(4) + '</div>' + skeletonPanel(6));
  const body = drawer.querySelector('.stock-drawer__body');
  let detail;
  const load = async () => {
    try { detail = await db.rpc('inventory_item_detail', { target_item: itemId }); }
    catch (error) {
      console.warn('Item detail failed:', error);
      body.innerHTML = errorState('Material details could not load');
      body.querySelector('[data-retry]').onclick = load; return;
    }
    if (!drawer.isConnected) return;
    const item = detail.item;
    detail.movements.forEach((m) => { m.unit = item.unit; });
    drawer.querySelector('#stock-drawer-title').textContent = item.name;
    const tabs = [['overview', 'Stock overview'], ['history', 'Movement history'], ['orders', 'Order deductions']];
    body.innerHTML = `
      <div class="stock-drawer__status">${stockStatus(item.status)}<span>${e(item.category)} · ${e(item.inventory_type === 'packaging' ? 'Packaging' : 'Ingredient')} · ${e(item.item_code || '')}</span></div>
      <div class="stock-drawer__stats">
        <div class="stock-stat stock-stat--primary"><span>Current stock</span><strong>${qty(item.available, item.unit)}</strong></div>
        <div class="stock-stat"><span>Minimum stock</span><strong>${qty(item.min_stock, item.unit)}</strong></div>
        <div class="stock-stat"><span>Next expiry</span><strong>${item.next_expiry ? dateOnly(item.next_expiry) : '—'}</strong></div>
        <div class="stock-stat"><span>Unit cost (est.)</span><strong>${item.estimated_unit_cost == null ? '—' : `₱${Number(item.estimated_unit_cost).toLocaleString('en-PH', { maximumFractionDigits: 4 })}/${e(item.unit)}`}</strong></div>
      </div>
      <div class="stock-drawer__actions">
        <button class="button button--primary" type="button" data-act="restock">${icon('plus')} Add stock</button>
        <button class="button" type="button" data-act="adjust">${icon('edit')} Adjust stock</button>
        <button class="button" type="button" data-act="settings">Settings</button>
      </div>
      <div class="stock-segment" role="tablist">${tabs.map(([key, label], i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-tab="${key}">${label}</button>`).join('')}</div>
      <div data-tab-body></div>`;
    const showTab = (key) => {
      body.querySelectorAll('[data-tab]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.tab === key)));
      const target = body.querySelector('[data-tab-body]');
      const moves = key === 'orders' ? detail.movements.filter((m) => m.order_id) : detail.movements;
      if (key === 'overview') {
        const usable = detail.batches.filter((batch) => Number(batch.remaining_quantity) > 0);
        target.innerHTML = `
          <h3 class="stock-subhead">Active batches</h3>
          ${usable.length ? `<ul class="stock-batches">${usable.map((b) => `<li><span><code>${e(b.batch_code)}</code><small>Stock-in ${dateOnly(b.stock_in_date)} · ${b.expires_on ? `expires ${dateOnly(b.expires_on)}` : 'no expiry'}</small></span><strong>${qty(b.remaining_quantity, b.unit)}</strong></li>`).join('')}</ul>` : emptyState('No active batches', 'Add stock to create a batch.')}
          <h3 class="stock-subhead">Recent activity</h3>${activityList(detail.movements.slice(0, 5))}
          <h3 class="stock-subhead">Used in recipes</h3>
          ${detail.recipes.length ? `<ul class="stock-chips">${detail.recipes.map((r) => `<li><a href="#inventory/recipes" data-recipe-link="${attr(r.id)}">${e(r.name)} · v${r.version}</a> <small>${e(r.status)}</small></li>`).join('')}</ul>` : '<p class="stock-quiet">Not used in any recipe yet.</p>'}
          ${detail.conversions.length ? `<h3 class="stock-subhead">Unit conversions</h3><ul class="stock-batches">${detail.conversions.map((c) => `<li><span>${e(conversionText(c, item.unit))}<small>${e(c.note || '')}</small></span>${c.is_verified ? '<span class="status-chip status-chip--success">Verified</span>' : '<span class="status-chip status-chip--warning">Needs verification</span>'}</li>`).join('')}</ul>` : ''}`;
      } else {
        target.innerHTML = activityList(moves) + `<a class="button stock-full-history" href="#inventory/movements" data-full-history>${icon('history')} View full history</a>`;
      }
      target.querySelector('[data-full-history]')?.addEventListener('click', () => sessionStorage.setItem('lexc-history-item', itemId));
      target.querySelectorAll('[data-recipe-link]').forEach((link) => link.addEventListener('click', () => sessionStorage.setItem('lexc-open-recipe', link.dataset.recipeLink)));
      target.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener('click', () => drawer.close()));
    };
    body.querySelectorAll('[data-tab]').forEach((tab) => { tab.onclick = () => showTab(tab.dataset.tab); });
    showTab('overview');
    body.querySelector('[data-act="restock"]').onclick = () => { drawer.close(); renderStockForm({ items: [{ id: item.id, name: item.name, unit: item.unit }], preset: item.id, onSuccess: async () => { await onChange?.(); openItemDrawer(itemId, { onChange }); } }); };
    body.querySelector('[data-act="adjust"]').onclick = () => adjustForm(item, async () => { await load(); await onChange?.(); });
    body.querySelector('[data-act="settings"]').onclick = () => settingsForm(item, async () => { await load(); await onChange?.(); });
  };
  await load();
}

function activityList(movements) {
  if (!movements.length) return emptyState('No movements yet');
  return `<ol class="stock-timeline">${movements.map((m) => `<li>
    <div class="stock-timeline__main">${movementBadge(m.movement_type)}<strong>${m.order_number ? `<a href="#orders/detail/${attr(m.order_id)}">Order #${e(m.order_number)}</a>` : e(m.note || m.reference || `Batch ${m.batch_code}`)}</strong>${delta(m.quantity_delta, m.unit || '')}</div>
    <small>${dateTime(m.created_at)} · ${e(m.actor_kind === 'system' ? `System (triggered by ${m.actor_name})` : m.actor_name)} · <code>${e(m.batch_code)}</code>${m.stock_before != null ? ` · ${qty(m.stock_before, m.unit || '')} → ${qty(m.stock_after, m.unit || '')}` : ''}</small>
    ${m.order_number && m.note ? `<small>${e(m.note)}</small>` : ''}
  </li>`).join('')}</ol>`;
}

function adjustForm(item, onSuccess) {
  const units = compatibleUnits(item.unit);
  const dialog = showDetails(`Adjust stock — ${item.name}`, `
    <form class="inventory-form stock-form" data-adjust novalidate>
      <div class="inventory-readonly"><span>Current usable stock</span><strong>${qty(item.available, item.unit)}</strong></div>
      <fieldset class="stock-choice"><legend>Direction</legend>
        <label><input type="radio" name="direction" value="decrease" checked> ${icon('minus')} Remove stock</label>
        <label><input type="radio" name="direction" value="increase"> ${icon('plus')} Add stock</label>
      </fieldset>
      <label class="form-field"><span>Type</span><select name="kind"><option value="adjustment">Count correction</option><option value="wastage">Wastage / spoilage</option><option value="expiry">Expiry write-off</option></select></label>
      <div class="form-grid"><label class="form-field"><span>Quantity <em>*</em></span><input name="quantity" type="number" min="0.001" step="any" required inputmode="decimal"></label>
        <label class="form-field"><span>Unit</span><select name="unit">${units.map((u) => `<option ${u === item.unit ? 'selected' : ''}>${e(u)}</option>`).join('')}</select></label></div>
      <label class="form-field"><span>Reason <em>*</em></span><textarea name="note" rows="2" maxlength="500" required placeholder="e.g. Physical count on Sep 29 found 2 fewer"></textarea></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button class="button button--quiet" type="button" data-close>Cancel</button><button class="button button--primary" type="submit">Save adjustment</button></div>
    </form>`);
  const form = dialog.querySelector('[data-adjust]');
  const errorBox = form.querySelector('[role=alert]');
  form.addEventListener('change', () => {
    const increase = form.elements.direction.value === 'increase';
    form.elements.kind.disabled = increase;
    if (increase) form.elements.kind.value = 'adjustment';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number(form.elements.quantity.value);
    const note = form.elements.note.value.trim();
    errorBox.hidden = true;
    if (!(amount > 0)) { errorBox.textContent = 'Enter a quantity greater than zero.'; errorBox.hidden = false; form.elements.quantity.focus(); return; }
    if (note.length < 3) { errorBox.textContent = 'A reason is required for every manual adjustment.'; errorBox.hidden = false; form.elements.note.focus(); return; }
    const submit = form.querySelector('[type=submit]'); submit.disabled = true; submit.textContent = 'Saving…';
    try {
      await db.rpc('adjust_inventory_item', { payload: { item_id: item.id, direction: form.elements.direction.value, kind: form.elements.kind.value, quantity: amount, unit: form.elements.unit.value, note, request_id: requestId() } });
      dialog.close(); toast('Stock adjustment recorded.'); await onSuccess(); refreshInventoryNotificationBadge();
    } catch (error) { errorBox.textContent = error.message || 'Could not save the adjustment.'; errorBox.hidden = false; submit.disabled = false; submit.textContent = 'Save adjustment'; }
  });
}

function settingsForm(item, onSuccess) {
  const dialog = showDetails(`Settings — ${item.name}`, `
    <form class="inventory-form stock-form" data-settings>
      <div class="form-grid"><label class="form-field"><span>Minimum stock (${e(item.unit)})</span><input name="min_stock" type="number" min="0" step="any" value="${attr(item.min_stock)}" required></label>
        <label class="form-field"><span>Estimated cost per ${e(item.unit)} (₱)</span><input name="estimated_unit_cost" type="number" min="0" step="any" value="${attr(item.estimated_unit_cost ?? '')}"></label></div>
      <label class="form-field"><span>Category</span><input name="category" maxlength="80" value="${attr(item.category)}"></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button class="button button--quiet" type="button" data-close>Cancel</button><button class="button button--primary" type="submit">Save settings</button></div>
    </form>`);
  const form = dialog.querySelector('[data-settings]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    try {
      await db.rpc('save_inventory_item_settings', { payload: { item_id: item.id, min_stock: form.elements.min_stock.value, estimated_unit_cost: form.elements.estimated_unit_cost.value, category: form.elements.category.value } });
      dialog.close(); toast('Material settings saved.'); await onSuccess();
    } catch (error) { const box = form.querySelector('[role=alert]'); box.textContent = error.message; box.hidden = false; submit.disabled = false; }
  });
}
