// Inventory movement history: every deduction, restock, adjustment, reversal and expiry, linked to orders.
import { escapeHtml as e } from '../components.js?v=3';
import { db } from '../backend-ui.js?v=3';
import { attr, icon, qty, dateTime, movementBadge, movementLabel, delta, sectionTabs, pageHead, skeletonRows, errorState, emptyState, csv, download, toast } from '../inventory-ui.js?v=3';

const KINDS = [['all', 'All movements'], ['orders', 'Orders'], ['restocks', 'Restocks'], ['adjustments', 'Adjustments'], ['reversals', 'Reversals'], ['wastage', 'Wastage'], ['expiry', 'Expiry']];
const COLUMNS = ['Date', 'Order', 'Material', 'Movement', 'Before', 'Change', 'After', 'By'];

export async function renderHistory(content) {
  const state = { kind: 'all', item_id: sessionStorage.getItem('lexc-history-item') || '', product_id: '', order_number: '', from: '', to: '', sort: 'newest', offset: 0, limit: 100, lookups: null, result: null };
  sessionStorage.removeItem('lexc-history-item');
  let token = 0;

  const filters = () => ({ kind: state.kind, item_id: state.item_id, product_id: state.product_id, order_number: state.order_number, from: state.from, to: state.to, sort: state.sort });

  const frame = () => {
    const items = state.lookups?.items || [];
    const products = state.lookups?.products || [];
    content.innerHTML = `<section class="inventory-page stock-page">
      ${pageHead('Inventory', 'Every stock change with its reason, order link and before/after quantities.', `<button class="button" type="button" data-export>${icon('download')} Export CSV</button>`)}
      ${sectionTabs('movements')}
      <div class="stock-kinds" role="group" aria-label="Movement type">${KINDS.map(([key, label]) => `<button type="button" class="stock-kind${state.kind === key ? ' is-active' : ''}" data-kind="${key}" aria-pressed="${state.kind === key}">${label}</button>`).join('')}</div>
      <form class="stock-history-filters" data-filters>
        <label><span>Material</span><select name="item_id"><option value="">All materials</option>${items.map((i) => `<option value="${attr(i.id)}" ${state.item_id === i.id ? 'selected' : ''}>${e(i.name)}</option>`).join('')}</select></label>
        <label><span>Product</span><select name="product_id"><option value="">All products</option>${products.map((p) => `<option value="${attr(p.id)}" ${state.product_id === p.id ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select></label>
        <label><span>Order #</span><input name="order_number" inputmode="numeric" placeholder="e.g. 101" value="${attr(state.order_number)}"></label>
        <label><span>From</span><input type="date" name="from" value="${attr(state.from)}"></label>
        <label><span>To</span><input type="date" name="to" value="${attr(state.to)}"></label>
        <label><span>Sort</span><select name="sort"><option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>Newest first</option><option value="oldest" ${state.sort === 'oldest' ? 'selected' : ''}>Oldest first</option></select></label>
        <button class="text-button" type="reset">Clear</button>
      </form>
      <div data-results>${skeletonRows(COLUMNS, 8)}</div>
    </section>`;
    bind();
  };

  const load = async () => {
    const mine = ++token;
    const target = content.querySelector('[data-results]');
    target.innerHTML = skeletonRows(COLUMNS, 8);
    try {
      const result = await db.rpc('inventory_history', { filters: { ...filters(), limit: state.limit, offset: state.offset } });
      if (mine !== token || !target.isConnected) return;
      state.result = result;
      renderResults();
    } catch (error) {
      if (mine !== token) return;
      console.warn('History failed:', error);
      target.innerHTML = errorState('Inventory history could not load');
      target.querySelector('[data-retry]').onclick = load;
    }
  };

  const renderResults = () => {
    const { rows, total } = state.result;
    const target = content.querySelector('[data-results]');
    if (!rows.length) { target.innerHTML = `<div class="panel">${emptyState('No movements match these filters', 'Change the movement type, dates or material.')}</div>`; return; }
    const orderCell = (r) => r.order_number ? `<a href="#orders/detail/${attr(r.order_id)}">#${e(r.order_number)}</a>` : '<span class="stock-quiet">—</span>';
    const pages = Math.max(1, Math.ceil(total / state.limit));
    const page = Math.floor(state.offset / state.limit) + 1;
    // One row per order and movement type (e.g. Order #59 · Order deduction); its materials open with the toggle.
    // Movements without an order (restocks, adjustments, expiry) stay one row each.
    const groups = [], byKey = new Map();
    rows.forEach((r) => {
      const key = r.order_id ? `${r.order_id}|${r.movement_type}` : null;
      if (key && byKey.has(key)) { byKey.get(key).rows.push(r); return; }
      const group = { key, rows: [r] }; if (key) byKey.set(key, group); groups.push(group);
    });
    const unique = (list) => [...new Set(list.filter(Boolean))];
    const by = (r) => `${e(r.actor_kind === 'system' ? 'System' : r.actor_name)}${r.actor_kind === 'system' ? `<small>via ${e(r.actor_name)}</small>` : ''}`;
    const detailRow = (r, gi) => `<tr${gi == null ? '' : ` class="hist-detail" data-hist-of="${gi}" hidden`}>
          <td class="stock-quiet">${gi == null ? dateTime(r.created_at) : ''}</td>
          <td>${gi == null ? orderCell(r) : ''}</td>
          <td${gi == null ? '' : ' class="hist-detail__material"'}><strong>${e(r.item_name)}</strong><small><code>${e(r.batch_code)}</code>${r.recipe ? ` · ${e(r.recipe)}` : ''}</small></td>
          <td>${gi == null ? movementBadge(r.movement_type) : ''}${r.note && gi == null ? `<small class="stock-note">${e(r.note)}</small>` : ''}</td>
          <td class="num stock-quiet">${r.stock_before == null ? '—' : qty(r.stock_before, r.unit)}</td>
          <td class="num">${delta(r.quantity_delta, r.unit)}</td>
          <td class="num"><strong>${r.stock_after == null ? '—' : qty(r.stock_after, r.unit)}</strong></td>
          <td class="stock-quiet">${gi == null ? by(r) : ''}</td></tr>`;
    const groupRows = (g, gi) => {
      const r = g.rows[0], n = g.rows.length, recipes = unique(g.rows.map((x) => x.recipe));
      return `<tr class="hist-group" data-hist-group="${gi}">
          <td class="stock-quiet">${dateTime(r.created_at)}</td>
          <td>${orderCell(r)}</td>
          <td><button type="button" class="hist-toggle" data-hist-toggle="${gi}" aria-expanded="false"><span class="hist-chevron" aria-hidden="true"></span><span><strong>${n} material${n === 1 ? '' : 's'}</strong><small>${e(recipes.join(', ') || unique(g.rows.map((x) => x.item_name)).slice(0, 3).join(', '))}</small></span></button></td>
          <td>${movementBadge(r.movement_type)}${r.note ? `<small class="stock-note">${e(r.note)}</small>` : ''}</td>
          <td class="num stock-quiet">—</td>
          <td class="num"><span class="hist-count">${n} change${n === 1 ? '' : 's'}</span></td>
          <td class="num stock-quiet">—</td>
          <td class="stock-quiet">${by(r)}</td></tr>${g.rows.map((x) => detailRow(x, gi)).join('')}`;
    };
    target.innerHTML = `
      <div class="panel stock-table-panel"><table class="data-table stock-table stock-table--history">
        <thead><tr>${COLUMNS.map((c, i) => `<th scope="col" class="${i >= 4 && i <= 6 ? 'num' : ''}">${c}</th>`).join('')}</tr></thead>
        <tbody>${groups.map((g, gi) => g.key ? groupRows(g, gi) : detailRow(g.rows[0], null)).join('')}</tbody>
      </table></div>
      <ul class="stock-cards stock-history-cards">${groups.map((g) => {
        const r = g.rows[0];
        if (!g.key) return `<li class="stock-card">
          <div class="stock-card__top"><h3>${e(r.item_name)}</h3>${delta(r.quantity_delta, r.unit)}</div>
          <p class="stock-card__meta">${movementBadge(r.movement_type)}</p>
          <p class="stock-card__meta">${r.stock_before == null ? '' : `${qty(r.stock_before, r.unit)} → <strong>${qty(r.stock_after, r.unit)}</strong> · `}${dateTime(r.created_at)}</p>
          ${r.note ? `<p class="stock-card__meta">${e(r.note)}</p>` : ''}
        </li>`;
        return `<li class="stock-card"><details class="hist-card">
          <summary><div class="stock-card__top"><h3>Order #${e(r.order_number)}</h3><span class="hist-count">${g.rows.length} change${g.rows.length === 1 ? '' : 's'}</span></div>
            <p class="stock-card__meta">${movementBadge(r.movement_type)} ${dateTime(r.created_at)}</p><span class="hist-card__more">Show materials</span></summary>
          <ul class="hist-card__list">${g.rows.map((x) => `<li><span><strong>${e(x.item_name)}</strong><small>${x.stock_before == null ? '' : `${qty(x.stock_before, x.unit)} → ${qty(x.stock_after, x.unit)}`}</small></span>${delta(x.quantity_delta, x.unit)}</li>`).join('')}</ul>
          <a class="hist-card__link" href="#orders/detail/${attr(r.order_id)}">Open order #${e(r.order_number)}</a>
        </details></li>`;
      }).join('')}</ul>
      <footer class="stock-pager"><span>${state.offset + 1}–${Math.min(state.offset + rows.length, total)} of ${total} movements</span>
        <div><button class="button button--small" type="button" data-page="-1" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹ Prev</button><span>Page ${page} of ${pages}</span><button class="button button--small" type="button" data-page="1" ${page >= pages ? 'disabled' : ''} aria-label="Next page">Next ›</button></div></footer>`;
    target.querySelectorAll('[data-hist-toggle]').forEach((button) => { button.onclick = () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      button.closest('tr').classList.toggle('is-open', open);
      target.querySelectorAll(`[data-hist-of="${button.dataset.histToggle}"]`).forEach((row) => { row.hidden = !open; });
    }; });
    target.querySelectorAll('[data-page]').forEach((button) => { button.onclick = () => { state.offset = Math.max(0, state.offset + Number(button.dataset.page) * state.limit); load(); content.querySelector('.stock-kinds')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }; });
  };

  const bind = () => {
    content.querySelectorAll('[data-kind]').forEach((button) => { button.onclick = () => {
      state.kind = button.dataset.kind; state.offset = 0;
      content.querySelectorAll('[data-kind]').forEach((b) => { b.classList.toggle('is-active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
      load();
    }; });
    const form = content.querySelector('[data-filters]');
    form.addEventListener('change', () => { Object.assign(state, Object.fromEntries(new FormData(form)), { offset: 0 }); load(); });
    form.addEventListener('input', (event) => { if (event.target.name !== 'order_number') return; clearTimeout(bind.t); bind.t = setTimeout(() => { state.order_number = event.target.value; state.offset = 0; load(); }, 350); });
    form.addEventListener('reset', () => setTimeout(() => { Object.assign(state, { item_id: '', product_id: '', order_number: '', from: '', to: '', sort: 'newest', offset: 0 }); load(); }));
    form.addEventListener('submit', (event) => event.preventDefault());
    content.querySelector('[data-export]').onclick = exportCsv;
  };

  const exportCsv = async (event) => {
    const button = event.currentTarget; button.disabled = true; button.lastChild.textContent = ' Exporting…';
    try {
      const all = [];
      for (let offset = 0; offset < 20000; offset += 500) {
        const page = await db.rpc('inventory_history', { filters: { ...filters(), limit: 500, offset } });
        all.push(...page.rows);
        if (all.length >= page.total || !page.rows.length) break;
      }
      const lines = [['Date (Asia/Manila)', 'Order', 'Material', 'Batch', 'Movement', 'Before', 'Change', 'After', 'Unit', 'Recipe', 'Note', 'Reference', 'By']]
        .concat(all.map((r) => [dateTime(r.created_at), r.order_number ? `#${r.order_number}` : '', r.item_name, r.batch_code, movementLabel(r.movement_type), r.stock_before ?? '', r.quantity_delta, r.stock_after ?? '', r.unit, r.recipe || '', r.note || '', r.reference || '', r.actor_kind === 'system' ? `System via ${r.actor_name}` : r.actor_name]));
      download(`lexc-inventory-history-${new Date().toISOString().slice(0, 10)}.csv`, csv(lines));
      toast(`Exported ${all.length} movements.`);
    } catch (error) { toast(error.message || 'Export failed.'); }
    finally { button.disabled = false; button.lastChild.textContent = ' Export CSV'; }
  };

  frame();
  try {
    const catalog = await db.rpc('recipe_catalog', {});
    state.lookups = { items: catalog.items, products: catalog.products };
    if (!content.isConnected) return;
    frame();
  } catch (error) { console.warn('History lookups failed:', error); }
  await load();
}
