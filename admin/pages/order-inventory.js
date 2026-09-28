// "Inventory consumption" section inside the Admin order details dialog.
import { escapeHtml as e } from '../components.js?v=3';
import { db } from '../backend-ui.js?v=3';
import { attr, icon, qty, dateTime, movementBadge, delta, shortagePanel, skeletonPanel, requestId, toast, parseShortage } from '../inventory-ui.js?v=1';

const STATE_LABEL = {
  deducted: ['Deducted', 'success', 'Materials were deducted automatically.'],
  shortage: ['Insufficient materials', 'danger', 'Payment is verified but stock was short. Nothing was deducted.'],
  no_recipe: ['Manual review', 'warning', 'No active recipe covers this order, so nothing was deducted automatically.'],
  not_required: ['Not required', 'neutral', 'Test orders never use inventory.'],
  reversed: ['Reversed', 'info', 'Deducted materials were returned to stock.'],
  consumed: ['Consumed', 'warning', 'Order cancelled after production started — materials are treated as used.'],
  void: ['Cancelled', 'neutral', 'Order cancelled before materials were allocated.']
};
const BASIS = { per_batch: 'batch share', per_unit: 'per piece', per_package: 'per box', manual: 'added by Admin' };

export function orderInventorySection() {
  return `<section class="stock-order" data-order-inventory aria-live="polite"><h3>${icon('box')} Inventory consumption</h3>${skeletonPanel(5)}</section>`;
}

export async function mountOrderInventory(dialog, order, { onChanged } = {}) {
  const section = dialog.querySelector('[data-order-inventory]');
  if (!section) return;
  let detail;
  const load = async () => {
    section.innerHTML = `<h3>${icon('box')} Inventory consumption</h3>${skeletonPanel(5)}`;
    try { detail = await db.rpc('order_inventory_detail', { target_order: order.id }); }
    catch (error) {
      console.warn('Order inventory failed:', error);
      section.innerHTML = `<h3>${icon('box')} Inventory consumption</h3><div class="stock-state stock-state--error" role="alert"><p>Material details could not load.</p><button class="button button--small" type="button" data-retry>Try again</button></div>`;
      section.querySelector('[data-retry]').onclick = load; return;
    }
    if (section.isConnected) render();
  };

  const render = () => {
    const a = detail.allocation;
    const status = a ? a.status : detail.eligible ? 'pending' : 'waiting';
    const [label, tone, explain] = STATE_LABEL[status] || (order.status === 'cancelled'
      ? ['Not allocated', 'neutral', 'This order was cancelled before materials were allocated.']
      : ['Not yet deducted', 'warning', waitingReason(order)]);
    const untracked = (a?.untracked?.length ? a.untracked : detail.preview?.untracked) || [];
    const byLine = new Map();
    (detail.lines || []).forEach((l) => { const key = l.kind === 'extra' ? 'extra' : l.order_item_id; if (!byLine.has(key)) byLine.set(key, []); byLine.get(key).push(l); });
    const recipeVersions = [...new Set((detail.lines || []).filter((l) => l.recipe_name).map((l) => `${l.recipe_name} v${l.recipe_version}`))];
    const canExtra = detail.eligible && a && ['deducted', 'no_recipe'].includes(a.status);

    section.innerHTML = `
      <header class="stock-order__head"><h3>${icon('box')} Inventory consumption</h3><span class="status-chip status-chip--${tone}">${e(label)}</span></header>
      <p class="stock-quiet">${e(explain)}</p>
      ${a && ['deducted', 'reversed', 'consumed'].includes(a.status) ? `<dl class="stock-order__facts">
        <div><dt>Deduction date</dt><dd>${dateTime(a.deducted_at)}</dd></div>
        <div><dt>Movement reference</dt><dd><code>ALC-${e(String(a.id).slice(0, 8).toUpperCase())}</code></dd></div>
        <div><dt>Recipe version</dt><dd>${recipeVersions.length ? recipeVersions.map(e).join('<br>') : '—'}</dd></div>
        <div><dt>Transaction</dt><dd>${e(a.trigger_event || '—')}${a.deducted_by_name ? ` · by ${e(a.deducted_by_name)}` : ''}</dd></div>
        ${a.reversed_at ? `<div class="stock-order__wide"><dt>Reversed</dt><dd>${dateTime(a.reversed_at)} · ${e(a.reversal_reason || '')}</dd></div>` : a.status === 'consumed' ? `<div class="stock-order__wide"><dt>Note</dt><dd>${e(a.reversal_reason || '')}</dd></div>` : ''}
      </dl>` : ''}
      ${a?.status === 'shortage' ? shortagePanel(a.shortage, { orderNumber: order.order_number }) : ''}
      ${(detail.lines || []).length ? `<div class="stock-order__groups">${[...byLine.entries()].map(([key, lines]) => {
        const head = key === 'extra' ? 'Extra materials added by Admin' : `${lines[0].product_name} · ${lines[0].variant} × ${lines[0].ordered}`;
        return `<div class="stock-order__group"><h4>${e(head)}</h4><ul>${lines.map((l) => `<li><span>${e(l.item_name)}<small>${e(BASIS[l.basis] || l.basis)}${l.note ? ` · ${e(l.note)}` : ''}</small></span><strong class="stock-delta stock-delta--out">${qty(-l.required, l.unit)}</strong></li>`).join('')}</ul></div>`;
      }).join('')}</div>` : ''}
      ${!a || ['shortage', 'no_recipe'].includes(a?.status) ? previewBlock(detail.preview, a) : ''}
      ${untracked.length ? `<div class="stock-order__untracked">${icon('flag')}<div><strong>Needs manual material review</strong><ul>${untracked.map((u) => `<li>${e(u.name)} · ${e(u.variant)} × ${e(u.quantity)} — ${e(u.reason)}</li>`).join('')}</ul></div></div>` : ''}
      ${(detail.movements || []).length ? `<details class="stock-order__ledger"><summary>View deduction details (${detail.movements.length} ledger entries)</summary><div class="table-scroll"><table class="data-table stock-table"><thead><tr><th scope="col">Time</th><th scope="col">Material</th><th scope="col">Batch</th><th scope="col">Type</th><th scope="col" class="num">Before</th><th scope="col" class="num">Change</th><th scope="col" class="num">After</th></tr></thead><tbody>${detail.movements.map((m) => `<tr><td class="stock-quiet">${dateTime(m.created_at)}</td><td>${e(m.item_name)}</td><td><code>${e(m.batch_code)}</code></td><td>${movementBadge(m.movement_type)}</td><td class="num">${qty(m.stock_before, m.unit)}</td><td class="num">${delta(m.quantity_delta, m.unit)}</td><td class="num"><strong>${qty(m.stock_after, m.unit)}</strong></td></tr>`).join('')}</tbody></table></div></details>` : ''}
      <div class="stock-order__actions">
        ${a?.status === 'shortage' || (a?.status === 'no_recipe' && detail.eligible) ? `<button class="button button--primary" type="button" data-allocate>${icon('refresh')} ${a.status === 'shortage' ? 'Retry allocation' : 'Recalculate materials'}</button>` : ''}
        ${canExtra ? `<button class="button" type="button" data-extra>${icon('plus')} Record extra materials</button>` : ''}
        ${a?.status === 'consumed' && order.status === 'cancelled' ? `<button class="button" type="button" data-reverse>${icon('undo')} Return materials to stock</button>` : ''}
      </div>
      <div data-inline-form></div>
      <p class="form-error" role="alert" hidden data-inventory-error></p>`;
    bind();
  };

  const bind = () => {
    const errorBox = section.querySelector('[data-inventory-error]');
    bindShortageActions(section, dialog);
    section.querySelector('[data-allocate]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget; button.disabled = true; errorBox.hidden = true;
      try { await db.rpc('allocate_order_inventory', { target_order: order.id }); toast(`Materials allocated for Order #${order.order_number}.`); await load(); onChanged?.(); }
      catch (error) {
        const shortage = parseShortage(error);
        if (shortage) { detail.allocation = { ...(detail.allocation || {}), status: 'shortage', shortage }; render(); }
        else { errorBox.textContent = error.message; errorBox.hidden = false; button.disabled = false; }
      }
    });
    section.querySelector('[data-extra]')?.addEventListener('click', () => extraForm(order, section.querySelector('[data-inline-form]'), async () => { await load(); onChanged?.(); }));
    section.querySelector('[data-reverse]')?.addEventListener('click', () => reverseForm(order, section.querySelector('[data-inline-form]'), async () => { await load(); onChanged?.(); }));
  };
  await load();
  return { reload: load };
}

function waitingReason(order) {
  const paid = ['partially_paid', 'paid'].includes(order.payment_status);
  if (!paid && order.status === 'pending') return 'Materials are deducted automatically once the payment is verified and the order is confirmed.';
  if (!paid) return 'Order is confirmed. Materials are deducted automatically as soon as the payment is verified.';
  return 'Payment is verified. Materials are deducted automatically when you confirm the order.';
}

function previewBlock(preview, allocation) {
  if (!preview || preview.test_only) return '';
  const totals = preview.totals || [];
  if (!totals.length) return '';
  const short = totals.some((t) => Number(t.available) < Number(t.required));
  return `<div class="stock-order__preview"><h4>${allocation?.status === 'shortage' ? 'Current requirement' : 'Confirming this order will allocate'}</h4>
    <ul>${totals.map((t) => { const lacking = Number(t.available) < Number(t.required); return `<li class="${lacking ? 'is-short' : ''}"><span>${e(t.name)}<small>${qty(t.available, t.unit)} available</small></span><strong>${qty(t.required, t.unit)}</strong>${lacking ? `<em>short ${qty(Number(t.required) - Number(t.available), t.unit)}</em>` : ''}</li>`; }).join('')}</ul>
    <p class="stock-quiet">${short ? `${icon('alert')} Some materials are short — confirmation will be blocked until they are restocked.` : 'Stock is re-checked on the server at the moment of confirmation.'}</p></div>`;
}

// Used by the order status buttons: replace the generic error with an actionable shortage panel.
export function showShortageFromError(error, dialog, orderNumber) {
  const shortage = parseShortage(error);
  if (!shortage) return false;
  dialog.querySelector('[data-status-shortage]')?.remove();
  const holder = document.createElement('div');
  holder.dataset.statusShortage = '';
  holder.innerHTML = shortagePanel(shortage, { orderNumber });
  const anchor = dialog.querySelector('[data-order-inventory]') || dialog.querySelector('.dialog-body');
  anchor.before(holder);
  bindShortageActions(holder, dialog);
  holder.scrollIntoView({ block: 'center', behavior: 'smooth' });
  holder.querySelector('button, a')?.focus({ preventScroll: true });
  return true;
}

function bindShortageActions(root, dialog) {
  root.querySelectorAll('[data-shortage-review]').forEach((link) => link.addEventListener('click', () => dialog.close()));
  root.querySelectorAll('[data-shortage-return]').forEach((button) => button.addEventListener('click', () => { button.closest('[data-status-shortage]')?.remove(); dialog.querySelector('.dialog-body')?.scrollTo({ top: 0, behavior: 'smooth' }); }));
  root.querySelectorAll('[data-shortage-restock]').forEach((button) => button.addEventListener('click', () => {
    const itemId = button.dataset.shortageRestock;
    dialog.close();
    sessionStorage.setItem('lexc-inventory-focus-item', itemId);
    if (location.hash === '#inventory') window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = '#inventory';
  }));
}

async function extraForm(order, holder, onSaved) {
  let catalog;
  try { catalog = await db.rpc('recipe_catalog', {}); } catch (error) { toast(error.message); return; }
  holder.innerHTML = `
    <form class="inventory-form stock-form stock-inline-form" data-extra-form><h4>Record extra materials</h4>
      <p class="stock-quiet">Use this for custom decorations or anything the recipe does not cover. It is deducted immediately and recorded against this order.</p>
      <label class="form-field"><span>Material <em>*</em></span><select name="item_id" required><option value="">Choose a material</option>${catalog.items.map((i) => `<option value="${attr(i.id)}" data-unit="${attr(i.unit)}">${e(i.name)} (${e(i.unit)})</option>`).join('')}</select></label>
      <div class="form-grid"><label class="form-field"><span>Quantity <em>*</em></span><input name="quantity" type="number" min="0.001" step="any" required inputmode="decimal"></label><label class="form-field"><span>Unit</span><select name="unit"></select></label></div>
      <label class="form-field"><span>Reason <em>*</em></span><textarea name="note" rows="2" maxlength="500" required placeholder="e.g. Fondant figures for themed topper"></textarea></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button class="button button--quiet" type="button" data-cancel-inline>Cancel</button><button class="button button--primary" type="submit">Deduct materials</button></div>
    </form>`;
  const form = holder.querySelector('[data-extra-form]');
  form.querySelector('[data-cancel-inline]').onclick = () => { holder.innerHTML = ''; };
  form.elements.item_id.focus();
  const groups = [['g', 'kg'], ['mL', 'L'], ['pcs', 'dozen'], ['cm', 'm', 'inch', 'yard']];
  form.elements.item_id.onchange = () => {
    const unit = form.elements.item_id.selectedOptions[0]?.dataset.unit || '';
    const units = groups.find((g) => g.includes(unit)) || [unit];
    form.elements.unit.innerHTML = units.filter(Boolean).map((u) => `<option ${u === unit ? 'selected' : ''}>${e(u)}</option>`).join('');
  };
  const key = requestId();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const box = form.querySelector('[role=alert]'); box.hidden = true;
    if (!form.elements.item_id.value || !(Number(form.elements.quantity.value) > 0) || form.elements.note.value.trim().length < 3) { box.textContent = 'Choose a material, a positive quantity and a reason.'; box.hidden = false; return; }
    const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    try {
      await db.rpc('record_order_extra_material', { payload: { order_id: order.id, item_id: form.elements.item_id.value, quantity: Number(form.elements.quantity.value), unit: form.elements.unit.value, note: form.elements.note.value.trim(), request_id: key } });
      holder.innerHTML = ''; toast('Extra materials deducted and linked to the order.'); await onSaved();
    } catch (error) {
      const shortage = parseShortage(error);
      box.innerHTML = shortage ? shortagePanel(shortage, { compact: true }) : e(error.message); box.hidden = false; submit.disabled = false;
    }
  };
}

function reverseForm(order, holder, onSaved) {
  holder.innerHTML = `
    <form class="inventory-form stock-form stock-inline-form" data-reverse-form><h4>Return materials to stock</h4>
      <p>This order was cancelled after production started, so its materials were kept as used. Return them only if they were not actually consumed.</p>
      <label class="form-field"><span>Reason <em>*</em></span><textarea name="reason" rows="3" maxlength="500" required placeholder="e.g. Cancelled before baking; ingredients unused"></textarea></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button class="button button--quiet" type="button" data-cancel-inline>Cancel</button><button class="button button--primary" type="submit">${icon('undo')} Return to stock</button></div>
    </form>`;
  const form = holder.querySelector('[data-reverse-form]');
  form.querySelector('[data-cancel-inline]').onclick = () => { holder.innerHTML = ''; };
  form.elements.reason.focus();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const box = form.querySelector('[role=alert]'); const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    try { await db.rpc('reverse_order_inventory', { target_order: order.id, reason: form.elements.reason.value.trim() }); holder.innerHTML = ''; toast('Materials returned to stock with a linked reversal entry.'); await onSaved(); }
    catch (error) { box.textContent = error.message; box.hidden = false; submit.disabled = false; }
  };
}

