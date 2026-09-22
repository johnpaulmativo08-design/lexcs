import { escapeHtml, empty, showDetails } from '../components.js?v=3';
import { db } from '../backend-ui.js';

const priority = { 'Out of Stock': 0, 'Low Stock': 1, 'Expiring Soon': 2, 'In Stock': 3, Expired: 4 };
const activeStatuses = ['Out of Stock', 'Low Stock', 'Expiring Soon', 'In Stock'];
const tones = { 'Out of Stock': 'danger', 'Low Stock': 'warning', 'Expiring Soon': 'info', 'In Stock': 'success', Expired: 'neutral' };

const formatDate = (value, fallback = '—') => value
  ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
  : fallback;
const formatTimestamp = (value) => value
  ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
  : '—';
const relativeTimestamp = (value) => {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return formatTimestamp(value);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};
const quantity = (value) => Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 });
const typeLabel = (value) => value === 'packaging' ? 'Packaging' : 'Ingredients';
const unitOptions = ['kg', 'g', 'L', 'ml', 'pcs', 'dozen', 'pack', 'box', 'roll'];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const requestId = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const escapeAttr = (value) => escapeHtml(String(value ?? '')).replaceAll('"', '&quot;');
const notify = (message) => {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 5000);
};

function asDate(value) { return value ? new Date(`${value}T12:00:00`) : null; }

function sortBatches(records, choice) {
  const list = [...records];
  return list.sort((a, b) => {
    const aDate = asDate(a.stock_in_date)?.getTime() || new Date(a.received_at || a.created_at || 0).getTime();
    const bDate = asDate(b.stock_in_date)?.getTime() || new Date(b.received_at || b.created_at || 0).getTime();
    if (choice === 'newest') return bDate - aDate;
    if (choice === 'oldest') return aDate - bDate;
    if (choice === 'name-asc') return a.item_name.localeCompare(b.item_name);
    if (choice === 'name-desc') return b.item_name.localeCompare(a.item_name);
    if (choice === 'quantity-asc') return Number(a.remaining_quantity) - Number(b.remaining_quantity);
    if (choice === 'quantity-desc') return Number(b.remaining_quantity) - Number(a.remaining_quantity);

    const difference = (priority[a.status] ?? 9) - (priority[b.status] ?? 9);
    if (difference) return difference;
    if (a.status === 'Out of Stock') return aDate - bDate;
    if (a.status === 'Low Stock') return Number(a.remaining_quantity) - Number(b.remaining_quantity);
    if (a.status === 'Expiring Soon') return (asDate(a.expires_on)?.getTime() || Infinity) - (asDate(b.expires_on)?.getTime() || Infinity);
    return bDate - aDate;
  });
}

function statusChip(status) {
  const iconName = { 'Out of Stock': 'ban', 'Low Stock': 'alert', 'Expiring Soon': 'clock', 'In Stock': 'check', Expired: 'archive' }[status] || 'archive';
  return `<span class="status-chip status-chip--${tones[status] || 'neutral'}">${icon(iconName)} ${escapeHtml(status)}</span>`;
}

function icon(name) {
  const paths = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
    alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    warning: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', pencil: '<path d="m4 16-.8 4 4-.8L18 8l-3-3L4 16Z"/><path d="m13.5 6.5 3 3"/>',
    waste: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/>',
    file: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h5"/>', archive: '<path d="M4 7h16v14H4V7ZM3 3h18v4H3V3Z"/><path d="M9 12h6"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>'
  };
  return `<svg class="inventory-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
}

function activityLabel(movement) {
  const type = movement.movement_type || movement.reason || 'adjustment';
  return {
    initial_stock: 'Initial Stock', receipt: 'Restock', restock: 'Restock', stock_usage: 'Stock Usage', usage: 'Stock Usage',
    waste: 'Waste', remake: 'Remake', damaged: 'Damaged', expired: 'Expired',
    adjustment_negative: 'Manual Adjustment', adjustment_positive: 'Manual Adjustment', adjustment: 'Manual Adjustment'
  }[type] || String(type).replaceAll('_', ' ');
}

function activityTone(movement) {
  const type = movement.movement_type || movement.reason || '';
  if (['receipt', 'restock', 'initial_stock', 'adjustment_positive'].includes(type)) return 'success';
  if (type === 'expired') return 'info';
  if (type === 'remake') return 'warning';
  return 'danger';
}

function signedQuantity(movement) {
  const value = Number(movement.quantity_delta || 0);
  return `<span class="inventory-delta ${value >= 0 ? 'inventory-delta--in' : 'inventory-delta--out'}">${value >= 0 ? '+' : ''}${quantity(value)} ${escapeHtml(movement.unit || '')}</span>`;
}

function notificationCondition(item) { return String(item.condition || item.alert_key || '').split(':')[0]; }
function notificationTone(item) {
  return { out_of_stock: 'danger', low_stock: 'danger', expiring_soon: 'warning', expired: 'info' }[notificationCondition(item)] || 'info';
}
function notificationIcon(item) {
  return { out_of_stock: 'warning', low_stock: 'alert', expiring_soon: 'clock', expired: 'info' }[notificationCondition(item)] || 'bell';
}

export async function getInventorySnapshot() {
  const snapshot = (await db.rpc('inventory_snapshot', {})) || { items: [], batches: [], movements: [], notifications: [] };
  return {
    ...snapshot,
    items: snapshot.items || [],
    batches: (snapshot.batches || []).map((batch) => ({ ...batch, id: batch.batch_id, item_name: batch.name })),
    movements: snapshot.movements || [],
    notifications: (snapshot.notifications || []).map((notification) => ({ ...notification, message: notification.detail }))
  };
}

export async function refreshInventoryNotificationBadge() {
  const badge = document.querySelector('#notification-count');
  if (!badge) return;
  try {
    const snapshot = await getInventorySnapshot();
    const unread = (snapshot.notifications || []).filter((item) => !item.is_read).length;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread === 0;
  } catch {
    badge.hidden = true;
  }
}

export async function openInventoryNotifications(opener) {
  const existing = document.querySelector('#inventory-notification-popover');
  if (existing) { existing.remove(); return; }
  let snapshot;
  try { snapshot = await getInventorySnapshot(); }
  catch (error) { notify(error.message || 'Could not load notifications.'); return; }
  const notifications = snapshot.notifications || [];
  const visibleNotifications = notifications.slice(0, 4);
  const popover = document.createElement('aside');
  popover.id = 'inventory-notification-popover';
  popover.className = 'inventory-notification-popover';
  popover.setAttribute('aria-label', 'Inventory notifications');
  popover.innerHTML = `<section class="inventory-notifications">
      <div class="inventory-notifications__head"><strong>Notifications</strong><button class="text-button" data-mark-all ${notifications.some((item) => !item.is_read) ? '' : 'disabled'}>Mark all as read</button></div>
      ${visibleNotifications.length ? visibleNotifications.map((item) => `
        <article class="inventory-notification ${item.is_read ? '' : 'inventory-notification--unread'}">
          <span class="inventory-notification__icon status-chip--${notificationTone(item)}">${icon(notificationIcon(item))}</span>
          <div class="inventory-notification__copy"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message || '')}</p><small>${relativeTimestamp(item.created_at)}</small></div>
          <div class="inventory-notification__actions">
            ${item.batch_id ? `<button class="text-button" data-view-batch="${item.batch_id}">View inventory →</button>` : ''}
            ${!item.is_read ? `<button class="text-button" data-mark-read="${item.id}">Mark read</button>` : ''}
          </div>
        </article>`).join('') : empty('No inventory notifications', 'Stock, expiry, and batch alerts will appear here.')}
      <a class="inventory-notifications__all" href="#inventory/history">View all notifications →</a>
    </section>`;
  document.body.append(popover);
  popover.addEventListener('click', async (event) => {
    const read = event.target.closest('[data-mark-read]');
    const all = event.target.closest('[data-mark-all]');
    const view = event.target.closest('[data-view-batch]');
    try {
      if (read || all) {
        await db.rpc('read_inventory_notifications', { notification_id: read?.dataset.markRead || null, mark_all: Boolean(all) });
        popover.remove(); await refreshInventoryNotificationBadge(); await openInventoryNotifications(opener);
      }
      if (view) { popover.remove(); window.location.hash = '#inventory'; sessionStorage.setItem('lexc-inventory-focus-batch', view.dataset.viewBatch); }
    } catch (error) { notify(error.message || 'Could not update notifications.'); }
  });
  const closeLater = () => setTimeout(() => { if (!popover.matches(':hover') && !opener.matches(':hover,:focus')) popover.remove(); }, 180);
  opener.addEventListener('mouseleave', closeLater, { once: true });
  popover.addEventListener('mouseleave', closeLater);
  const outside = (event) => { if (!popover.contains(event.target) && event.target !== opener) { popover.remove(); document.removeEventListener('pointerdown', outside); } };
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
}

function renderStockForm({ batch, items, onSuccess }) {
  const creating = !batch;
  const currentItem = batch?.item_id || '';
  const options = items.map((item) => `<option value="${item.id}" ${item.id === currentItem ? 'selected' : ''}>${escapeHtml(item.name)} (${escapeHtml(item.unit)})</option>`).join('');
  const dialog = showDetails(creating ? 'Add Stock' : `Add Stock — ${batch.item_name}`, `
    <form class="inventory-form" data-stock-form>
      <label class="form-field"><span>Item name</span><select name="item_id" required><option value="">Select existing item</option>${options}<option value="__new">+ Create new item</option></select></label>
      <div class="inventory-new-item" hidden>
        <label class="form-field"><span>New item name</span><input name="item_name" maxlength="120" placeholder="e.g. Full Cream Milk"></label>
        <div class="form-grid"><label class="form-field"><span>Type</span><select name="inventory_type"><option value="ingredient">Ingredients</option><option value="packaging">Packaging</option></select></label><label class="form-field"><span>Category</span><input name="category" maxlength="80" placeholder="e.g. Liquid Ingredients"></label></div>
        <div class="form-grid"><label class="form-field"><span>Unit</span><select name="new_unit">${unitOptions.map((unit) => `<option>${unit}</option>`).join('')}</select></label><label class="form-field"><span>Low-stock threshold</span><input name="min_stock" type="number" min="0" step="0.01" value="1"></label></div>
      </div>
      <div class="form-grid"><label class="form-field"><span>Quantity received <em>*</em></span><input name="quantity" type="number" min="0.01" step="0.01" required></label><label class="form-field"><span>Unit</span><input name="unit" value="${escapeAttr(batch?.unit || '')}" placeholder="Auto from item" readonly></label></div>
      <div class="form-grid"><label class="form-field"><span>Date bought / stock-in <em>*</em></span><input name="received_at" type="date" value="${today()}" required></label><label class="form-field"><span>Expiry date</span><input name="expires_on" type="date"></label></div>
      <label class="form-field"><span>Purchase price <small>(optional)</small></span><input name="purchase_price" type="number" min="0" step="0.01" placeholder="0.00"></label>
      <label class="form-field"><span>Notes <small>(optional)</small></span><textarea name="note" maxlength="500" rows="2" placeholder="Supplier, delivery note, or other detail"></textarea></label>
      <div class="dialog-actions"><button class="button button--quiet" type="button" data-close>Cancel</button><button class="button button--primary" type="submit">Add stock</button></div>
    </form>`);
  const form = dialog?.querySelector('[data-stock-form]');
  const setUnit = () => {
    const selected = items.find((item) => item.id === form.elements.item_id.value);
    form.elements.unit.value = selected?.unit || (form.elements.item_id.value === '__new' ? form.elements.new_unit.value : '');
  };
  form?.addEventListener('change', (event) => {
    if (event.target.name === 'item_id') dialog.querySelector('.inventory-new-item').hidden = event.target.value !== '__new';
    if (event.target.name === 'item_id' || event.target.name === 'new_unit') setUnit();
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form); const itemId = data.get('item_id');
    if (itemId === '__new' && !String(data.get('item_name')).trim()) { notify('Enter a name for the new inventory item.'); return; }
    const payload = {
      action: 'restock', request_id: requestId(), item_id: itemId === '__new' ? null : itemId,
      item_name: itemId === '__new' ? String(data.get('item_name')).trim() : null,
      inventory_type: data.get('inventory_type'), category: String(data.get('category')).trim() || null,
      unit: itemId === '__new' ? data.get('new_unit') : data.get('unit'), min_stock: Number(data.get('min_stock') || 0),
      quantity: Number(data.get('quantity')), received_at: `${data.get('received_at')}T12:00:00+08:00`, expires_on: data.get('expires_on') || null,
      purchase_price: data.get('purchase_price') ? Number(data.get('purchase_price')) : null, note: String(data.get('note')).trim() || null
    };
    const button = form.querySelector('[type=submit]'); button.disabled = true;
    try { await db.rpc('inventory_action', { payload }); dialog.close(); notify('New batch added to inventory.'); await onSuccess(); }
    catch (error) { notify(error.message || 'Could not add stock.'); button.disabled = false; }
  });
  setUnit();
}

function renderUsageForm(batch, onSuccess, initialAction = 'stock_usage') {
  const dialog = showDetails(`Record Stock Usage — ${batch.item_name}`, `
    <form class="inventory-form" data-usage-form>
      <div class="inventory-readonly"><span>Batch</span><strong>${escapeHtml(batch.batch_code)}</strong><small>${quantity(batch.remaining_quantity)} ${escapeHtml(batch.unit)} currently available</small></div>
      <div class="form-grid"><label class="form-field"><span>Quantity used <em>*</em></span><input name="quantity" type="number" min="0.01" max="${Number(batch.remaining_quantity)}" step="0.01" required></label><label class="form-field"><span>Unit</span><input value="${escapeAttr(batch.unit)}" readonly></label></div>
      <label class="form-field"><span>Reason <em>*</em></span><select name="action"><option value="stock_usage" ${initialAction === 'stock_usage' ? 'selected' : ''}>Order Production</option><option value="waste" ${initialAction === 'waste' ? 'selected' : ''}>Waste / Spillage</option><option value="remake">Remake</option><option value="damaged">Damaged</option><option value="adjustment_negative" ${initialAction === 'adjustment_negative' ? 'selected' : ''}>Manual Adjustment</option></select></label>
      <label class="form-field"><span>Reference <small>(optional)</small></span><input name="reference" maxlength="100" placeholder="e.g. ORD-1052"></label>
      <label class="form-field"><span>Notes <small>(optional)</small></span><textarea name="note" maxlength="500" rows="2" placeholder="Describe the stock usage"></textarea></label>
      <div class="dialog-actions"><button class="button button--quiet" type="button" data-close>Cancel</button><button class="button button--primary" type="submit">Record usage</button></div>
    </form>`);
  const form = dialog?.querySelector('[data-usage-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(form); const amount = Number(data.get('quantity'));
    if (!amount || amount > Number(batch.remaining_quantity)) { notify('Usage cannot be greater than the remaining stock in this batch.'); return; }
    const button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      await db.rpc('inventory_action', { payload: { action: data.get('action'), request_id: requestId(), batch_id: batch.id, quantity: amount, reference: String(data.get('reference')).trim() || null, note: String(data.get('note')).trim() || null } });
      dialog.close(); notify('Inventory movement recorded.'); await onSuccess();
    } catch (error) { notify(error.message || 'Could not record stock usage.'); button.disabled = false; }
  });
}

function renderItemDetails(batch, allBatches) {
  const groups = allBatches.filter((entry) => entry.item_id === batch.item_id);
  const usable = groups.filter((entry) => !entry.archived_at).reduce((sum, entry) => sum + Number(entry.remaining_quantity || 0), 0);
  const active = groups.filter((entry) => !entry.archived_at);
  const statusCounts = active.reduce((counts, entry) => ({ ...counts, [entry.status]: (counts[entry.status] || 0) + 1 }), {});
  const conditions = Object.entries(statusCounts).map(([status, count]) => `${count} ${status}`).join(', ') || 'Archived';
  const priceBatches = groups.filter((entry) => entry.purchase_price !== null && entry.purchase_price !== undefined);
  const averagePrice = priceBatches.length
    ? priceBatches.reduce((total, entry) => total + Number(entry.purchase_price || 0), 0) / priceBatches.length
    : null;
  const lastRestocked = groups.reduce((latest, entry) => {
    const date = entry.stock_in_date || String(entry.received_at || '').slice(0, 10);
    return !latest || date > latest ? date : latest;
  }, '');
  showDetails(`${batch.item_name} — Details`, `
    <section class="inventory-details">
      <div class="inventory-details__summary"><div><span>Total usable stock</span><strong>${quantity(usable)} ${escapeHtml(batch.unit)}</strong></div><div><span>Inventory condition</span><strong>${escapeHtml(active.length > 1 ? `Mixed — ${conditions}` : conditions)}</strong></div><div><span>Category</span><strong>${escapeHtml(batch.category || 'Uncategorised')}</strong></div></div>
      <h3>Batch breakdown</h3><div class="table-wrap"><table class="data-table inventory-table"><thead><tr><th>Batch ID</th><th>Quantity</th><th>Expiry</th><th>Status</th></tr></thead><tbody>${groups.map((entry) => `<tr><td><strong>${escapeHtml(entry.batch_code)}</strong></td><td>${quantity(entry.remaining_quantity)} ${escapeHtml(entry.unit)}</td><td>${formatDate(entry.expires_on)}</td><td>${statusChip(entry.status)}</td></tr>`).join('')}</tbody></table></div>
      <h3>Item information</h3><dl class="inventory-details__facts"><div><dt>Average price</dt><dd>${averagePrice === null ? 'Not recorded' : `₱${quantity(averagePrice)}`}</dd></div><div><dt>Last restocked</dt><dd>${formatDate(lastRestocked)}</dd></div><div><dt>Active batches</dt><dd>${active.length}</dd></div></dl>
      <div class="dialog-actions"><button class="button button--quiet" data-close>Close</button></div>
    </section>`);
}

function renderBatchHistory(batch, movements) {
  const list = movements.filter((movement) => movement.batch_id === batch.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  showDetails(`${batch.batch_code} — Batch History`, `
    <section class="batch-history"><p><strong>Item:</strong> ${escapeHtml(batch.item_name)} · <strong>Remaining:</strong> ${quantity(batch.remaining_quantity)} ${escapeHtml(batch.unit)}</p>
      ${list.length ? `<ol>${list.map((movement) => `<li class="batch-history__entry batch-history__entry--${escapeAttr(activityTone(movement))}"><span class="batch-history__dot"></span><div><time>${formatTimestamp(movement.created_at)}</time><strong>${escapeHtml(activityLabel(movement))} ${signedQuantity(movement)}</strong><p>${escapeHtml(movement.note || movement.reason || 'Inventory activity')}${movement.reference ? ` · Ref: ${escapeHtml(movement.reference)}` : ''}${movement.actor_name ? ` · By ${escapeHtml(movement.actor_name)}` : ' · By System'}</p></div></li>`).join('')}</ol>` : empty('No movement history', 'This batch has no recorded changes yet.')}
      <div class="dialog-actions"><button class="button button--quiet" data-close>Close</button></div>
    </section>`);
}

export async function renderInventory(content, subpage = '') {
  const initialFilters = { low: 'Low Stock', out: 'Out of Stock', expiring: 'Expiring Soon' };
  const state = {
    type: subpage === 'packaging' ? 'packaging' : 'ingredient', status: initialFilters[subpage] || '',
    category: '', expiry: '', sort: 'priority', search: '', dateFrom: '', dateTo: '',
    page: 1, pageSize: 50, archive: subpage === 'history', snapshot: null
  };
  let searchTimer;
  const load = async () => { state.snapshot = await getInventorySnapshot(); await refreshInventoryNotificationBadge(); render(); };
  const records = () => (state.snapshot?.batches || []).filter((batch) => {
    const matchingType = state.archive ? Boolean(batch.archived_at) : !batch.archived_at && batch.inventory_type === state.type;
    const searchable = `${batch.item_name} ${batch.batch_code} ${batch.category || ''}`.toLowerCase().includes(state.search.toLowerCase());
    const categoryMatches = !state.category || batch.category === state.category;
    const statusMatches = !state.status || batch.status === state.status;
    const stockDate = batch.stock_in_date || String(batch.received_at || '').slice(0, 10);
    const dateMatches = (!state.dateFrom || stockDate >= state.dateFrom) && (!state.dateTo || stockDate <= state.dateTo);
    const expiryDate = asDate(batch.expires_on); const todayDate = asDate(today());
    const daysUntilExpiry = expiryDate ? Math.ceil((expiryDate - todayDate) / 86400000) : null;
    const expiryMatches = !state.expiry
      || (state.expiry === 'none' && !batch.expires_on)
      || (state.expiry === 'expired' && batch.status === 'Expired')
      || (state.expiry === '7' && daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 7)
      || (state.expiry === '30' && daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 30);
    return matchingType && searchable && categoryMatches && statusMatches && dateMatches && expiryMatches;
  });
  const render = () => {
    const filtered = sortBatches(records(), state.sort);
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    const offset = (state.page - 1) * state.pageSize;
    const entries = filtered.slice(offset, offset + state.pageSize);
    const categories = [...new Set((state.snapshot?.batches || []).filter((batch) => state.archive ? batch.archived_at : !batch.archived_at && batch.inventory_type === state.type).map((batch) => batch.category).filter(Boolean))].sort();
    const rangeLabel = state.dateFrom || state.dateTo ? `${state.dateFrom ? formatDate(state.dateFrom) : 'Any'} – ${state.dateTo ? formatDate(state.dateTo) : 'Any'}` : 'All stock-in dates';
    content.innerHTML = `
      <section class="inventory-page">
        <header class="inventory-head"><div><h1>Inventory</h1><p>Manage ingredients and packaging supplies with traceable batch history.</p></div><button class="button button--primary" data-add-stock>＋ Add New Item / Stock</button></header>
        <nav class="inventory-tabs" aria-label="Inventory sections"><a href="#inventory" class="${!state.archive && state.type === 'ingredient' ? 'is-active' : ''}">Ingredients</a><a href="#inventory/packaging" class="${!state.archive && state.type === 'packaging' ? 'is-active' : ''}">Packaging</a><a href="#inventory/history" class="${state.archive ? 'is-active' : ''}">Archive & history</a></nav>
        <div class="inventory-filters">
          <label class="inventory-search">${icon('search')}<span class="sr-only">Search inventory</span><input class="search" type="search" value="${escapeAttr(state.search)}" placeholder="Search batch ID, item name, or category…" aria-label="Search inventory"></label>
          <details class="inventory-sort-menu">
            <summary>Sort By: ${escapeHtml({ priority: 'Priority Status', newest: 'Newest Stock-in', oldest: 'Oldest Stock-in', 'name-asc': 'Item Name A–Z', 'name-desc': 'Item Name Z–A', 'quantity-asc': 'Quantity Ascending', 'quantity-desc': 'Quantity Descending' }[state.sort])} ${icon('chevron')}</summary>
            <div class="inventory-sort-menu__panel">
              <label><span>Sort order</span><select data-sort><option value="priority" ${state.sort === 'priority' ? 'selected' : ''}>Priority Status</option><option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>Newest Stock-in</option><option value="oldest" ${state.sort === 'oldest' ? 'selected' : ''}>Oldest Stock-in</option><option value="name-asc" ${state.sort === 'name-asc' ? 'selected' : ''}>Item Name A–Z</option><option value="name-desc" ${state.sort === 'name-desc' ? 'selected' : ''}>Item Name Z–A</option><option value="quantity-asc" ${state.sort === 'quantity-asc' ? 'selected' : ''}>Quantity Ascending</option><option value="quantity-desc" ${state.sort === 'quantity-desc' ? 'selected' : ''}>Quantity Descending</option></select></label>
              <label><span>Category</span><select data-category><option value="">All Categories</option>${categories.map((category) => `<option value="${escapeAttr(category)}" ${state.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select></label>
              <label><span>Stock Status</span><select data-status><option value="">All Statuses</option>${activeStatuses.concat(state.archive ? ['Expired'] : []).map((status) => `<option value="${status}" ${state.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label>
              <label><span>Expiry</span><select data-expiry><option value="">All Dates</option><option value="7" ${state.expiry === '7' ? 'selected' : ''}>Next 7 Days</option><option value="30" ${state.expiry === '30' ? 'selected' : ''}>Next 30 Days</option><option value="none" ${state.expiry === 'none' ? 'selected' : ''}>No Expiry Date</option>${state.archive ? `<option value="expired" ${state.expiry === 'expired' ? 'selected' : ''}>Expired</option>` : ''}</select></label>
              <div class="stock-date-fields"><span>Stock-in Date · ${escapeHtml(rangeLabel)}</span><label>From<input type="date" data-date-from value="${state.dateFrom}"></label><label>To<input type="date" data-date-to value="${state.dateTo}"></label><button class="text-button" type="button" data-clear-dates>Clear range</button></div>
            </div>
          </details>
        </div>
        <section class="panel inventory-table-panel"><div class="table-wrap"><table class="data-table inventory-table"><thead><tr><th>Batch ID</th><th>Item Name</th><th>Category</th><th>In-stock</th><th>Unit</th><th>Expiry Date</th><th>Stock-in Date</th><th>Status</th><th>Action</th></tr></thead><tbody>${entries.length ? entries.map((batch) => `<tr data-batch-row="${batch.id}"><td><code>${escapeHtml(batch.batch_code)}</code></td><td><strong>${escapeHtml(batch.item_name)}</strong></td><td>${escapeHtml(batch.category || typeLabel(batch.inventory_type))}</td><td>${quantity(batch.remaining_quantity)}</td><td>${escapeHtml(batch.unit)}</td><td>${formatDate(batch.expires_on)}</td><td>${formatDate(batch.stock_in_date || String(batch.received_at || '').slice(0, 10))}</td><td>${statusChip(batch.status)}</td><td><details class="inventory-action-menu"><summary>Adjust Stock ${icon('chevron')}</summary><div><button data-batch-action="${batch.id}" data-action="restock">${icon('plus')} Stock In</button>${batch.archived_at ? '' : `<button data-batch-action="${batch.id}" data-action="adjust">${icon('pencil')} Adjust Quantity</button><button data-batch-action="${batch.id}" data-action="waste">${icon('waste')} Record Waste</button>`}<button data-batch-action="${batch.id}" data-action="details">${icon('file')} View Batch Details</button><button data-batch-action="${batch.id}" data-action="history">${icon('clock')} View Batch History</button></div></details></td></tr>`).join('') : `<tr><td colspan="9">${empty(state.archive ? 'No archived batches' : 'No matching batches')}</td></tr>`}</tbody></table></div>
          <footer class="inventory-table-footer"><span>Showing ${filtered.length ? offset + 1 : 0}–${Math.min(offset + state.pageSize, filtered.length)} of ${filtered.length} batches</span><div class="inventory-pagination"><label>Rows per page <select data-page-size><option value="10" ${state.pageSize === 10 ? 'selected' : ''}>10</option><option value="25" ${state.pageSize === 25 ? 'selected' : ''}>25</option><option value="50" ${state.pageSize === 50 ? 'selected' : ''}>50</option></select></label><button class="button button--quiet button--small" data-page-prev ${state.page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹</button><span>Page ${state.page} of ${totalPages}</span><button class="button button--quiet button--small" data-page-next ${state.page >= totalPages ? 'disabled' : ''} aria-label="Next page">›</button></div></footer></section>
        ${renderActivity(state.snapshot?.movements || [])}
      </section>`;
    bind();
  };
  const bind = () => {
    content.querySelector('[data-add-stock]')?.addEventListener('click', () => renderStockForm({ items: inventoryItems(), onSuccess: load }));
    content.querySelector('.search')?.addEventListener('input', (event) => {
      const value = event.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = value; state.page = 1; render();
        const input = content.querySelector('.search'); input?.focus(); input?.setSelectionRange(state.search.length, state.search.length);
      }, 120);
    });
    content.querySelector('[data-category]')?.addEventListener('change', (event) => { state.category = event.target.value; state.page = 1; render(); });
    content.querySelector('[data-status]')?.addEventListener('change', (event) => { state.status = event.target.value; state.page = 1; render(); });
    content.querySelector('[data-expiry]')?.addEventListener('change', (event) => { state.expiry = event.target.value; state.page = 1; render(); });
    content.querySelector('[data-sort]')?.addEventListener('change', (event) => { state.sort = event.target.value; state.page = 1; render(); });
    content.querySelector('[data-date-from]')?.addEventListener('change', (event) => { state.dateFrom = event.target.value; state.page = 1; render(); });
    content.querySelector('[data-date-to]')?.addEventListener('change', (event) => { state.dateTo = event.target.value; state.page = 1; render(); });
    content.querySelector('[data-clear-dates]')?.addEventListener('click', () => { state.dateFrom = ''; state.dateTo = ''; state.page = 1; render(); });
    content.querySelector('[data-page-size]')?.addEventListener('change', (event) => { state.pageSize = Number(event.target.value); state.page = 1; render(); });
    content.querySelector('[data-page-prev]')?.addEventListener('click', () => { state.page = Math.max(1, state.page - 1); render(); });
    content.querySelector('[data-page-next]')?.addEventListener('click', () => { state.page += 1; render(); });
    content.querySelectorAll('button[data-batch-action]').forEach((button) => button.addEventListener('click', () => {
      const batch = (state.snapshot?.batches || []).find((entry) => entry.id === button.dataset.batchAction); const action = button.dataset.action;
      button.closest('details')?.removeAttribute('open');
      if (!batch || !action) return;
      if (action === 'restock') renderStockForm({ batch, items: inventoryItems(), onSuccess: load });
      if (action === 'adjust') renderUsageForm(batch, load, 'adjustment_negative');
      if (action === 'waste') renderUsageForm(batch, load, 'waste');
      if (action === 'details') renderItemDetails(batch, state.snapshot.batches);
      if (action === 'history') renderBatchHistory(batch, state.snapshot.movements || []);
    }));
  };
  const inventoryItems = () => {
    const deduplicated = new Map();
    (state.snapshot?.items || []).forEach((item) => deduplicated.set(item.id, item));
    (state.snapshot?.batches || []).filter((batch) => !batch.archived_at).forEach((batch) => deduplicated.set(batch.item_id, { id: batch.item_id, name: batch.item_name, unit: batch.unit }));
    return [...deduplicated.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  try { await load(); }
  catch (error) { content.innerHTML = `<section class="page"><h1>Inventory</h1>${empty('Inventory could not load', escapeHtml(error.message || 'Please refresh and try again.'))}</section>`; }
}

function renderActivity(movements) {
  const recent = [...movements].slice(0, 8);
  return `<section class="panel inventory-activity"><header class="panel__head"><div><h2>Recent Stock Activity</h2><p>Every quantity change is kept in a traceable movement ledger.</p></div><a class="text-button inventory-activity__link" href="#inventory/history">View All Activity →</a></header><div class="table-wrap"><table class="data-table"><thead><tr><th>Date &amp; Time</th><th>Batch ID</th><th>Item Name</th><th>Type</th><th>Quantity</th><th>Notes</th><th>By</th></tr></thead><tbody>${recent.length ? recent.map((movement) => `<tr><td>${formatTimestamp(movement.created_at)}</td><td><code>${escapeHtml(movement.batch_code || '—')}</code></td><td>${escapeHtml(movement.item_name || 'Inventory batch')}</td><td><span class="activity-type activity-type--${activityTone(movement)}">${escapeHtml(activityLabel(movement))}</span></td><td>${signedQuantity(movement)}</td><td>${escapeHtml(movement.reference || movement.note || movement.reason || '—')}</td><td>${escapeHtml(movement.actor_name || 'System')}</td></tr>`).join('') : `<tr><td colspan="7">No stock activity has been recorded yet.</td></tr>`}</tbody></table></div></section>`;
}
