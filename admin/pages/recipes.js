// Inventory → Conversions. Recipes are now built in Products → Edit product → Recipe (same versioned recipe system,
// same deductions). Inventory keeps the unit conversions those recipes rely on, plus an overview of every recipe.
import { escapeHtml as e, showDetails } from '../components.js?v=3';
import { db } from '../backend-ui.js?v=3';
import { attr, icon, sectionTabs, pageHead, skeletonPanel, errorState, emptyState, toast } from '../inventory-ui.js?v=3';
import { UNITS, perStockUnit, conversionText, flaggedLines } from '../recipe-model.js?v=1';

const STATUS = { active: ['Active', 'success'], draft: ['Draft', 'warning'], archived: ['Archived', 'neutral'] };
const chip = (status) => `<span class="status-chip status-chip--${STATUS[status]?.[1] || 'neutral'}">${e(STATUS[status]?.[0] || status)}</span>`;

export async function renderRecipes(content) {
  const state = { catalog: null };
  const shell = (body) => `<section class="inventory-page stock-page">${pageHead('Inventory', 'Unit conversions for recipes. Recipes themselves are edited in Products.', '<a class="button" href="#products">' + icon('recipe') + ' Open Products</a>')}${sectionTabs('recipes')}${body}</section>`;

  const load = async () => {
    content.innerHTML = shell(skeletonPanel(6));
    try { state.catalog = await db.rpc('recipe_catalog', {}); if (content.isConnected) render(); }
    catch (error) { console.warn('Conversions failed:', error); content.innerHTML = shell(errorState('Conversions could not load')); content.querySelector('[data-retry]').onclick = load; }
  };

  const render = () => {
    const cat = state.catalog;
    // one row per recipe: its active version, else its newest version
    const latest = new Map();
    for (const r of cat.recipes) { const c = latest.get(r.recipe_key); if (!c || (r.status === 'active' && c.status !== 'active') || (c.status !== 'active' && r.version > c.version)) latest.set(r.recipe_key, r); }
    const recipes = [...latest.values()].filter((r) => r.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name));
    const unverified = cat.conversions.filter((c) => !c.is_verified);
    content.innerHTML = shell(`
      <div class="stock-callout">${icon('recipe')}<div><strong>Recipes moved to Products.</strong> Open a product and use <em>Edit product → Recipe</em> to choose its ingredients from Inventory. Only active recipes deduct stock when an order is confirmed — exactly as before.</div></div>
      <section class="panel stock-conversions">
        <header class="panel__head"><div><h2>Unit conversions</h2><p>Needed when a recipe measures in a different unit type than the stock (e.g. grams of butter vs. 225 g blocks). Unverified conversions keep a recipe from being activated.</p></div><button class="button" type="button" data-add-conversion>${icon('plus')} Add conversion</button></header>
        ${cat.conversions.length ? `<div class="table-scroll"><table class="data-table stock-table"><thead><tr><th scope="col">Material</th><th scope="col">Conversion</th><th scope="col">Source / note</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${cat.conversions.map((c) => `<tr>
          <td><strong>${e(c.item_name)}</strong></td><td>${e(conversionText(c, c.item_unit))}</td><td class="stock-quiet">${e(c.note || '—')}</td>
          <td>${c.is_verified ? '<span class="status-chip status-chip--success">Verified</span>' : '<span class="status-chip status-chip--warning">Needs verification</span>'}</td>
          <td class="stock-row-actions">${c.is_verified ? '' : `<button class="button button--small" type="button" data-verify="${attr(c.item_id)}|${attr(c.unit)}">Verify</button>`}<button class="button button--small button--quiet" type="button" data-edit-conversion="${attr(c.item_id)}|${attr(c.unit)}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('No conversions yet')}
        ${unverified.length ? `<p class="stock-conversions__note">${icon('alert')} ${unverified.length} conversion${unverified.length === 1 ? '' : 's'} must be confirmed against your actual packaging.</p>` : ''}
      </section>
      <section class="panel">
        <header class="panel__head"><div><h2>Recipes overview</h2><p>Each recipe belongs to a product. Edit it from the product.</p></div></header>
        ${recipes.length ? `<div class="table-scroll"><table class="data-table stock-table"><thead><tr><th scope="col">Recipe</th><th scope="col">Product</th><th scope="col">Status</th><th scope="col">Ingredients</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${recipes.map((r) => { const flags = flaggedLines(r); return `<tr>
          <td><strong>${e(r.name)}</strong> <small class="stock-quiet">v${r.version}</small></td><td>${r.product_name ? e(r.product_name) : '<span class="stock-warn-text">Not linked to a product</span>'}</td>
          <td>${chip(r.status)}${flags ? ` <span class="stock-flag">${icon('flag')} ${flags} to review</span>` : ''}</td><td>${r.lines.length}</td>
          <td class="stock-row-actions">${r.product_id ? `<a class="button button--small" href="#products/edit/${attr(r.product_id)}">Edit in Products</a>` : '<span class="stock-quiet">Link it from a product: Edit product → Recipe → start from an unlinked recipe</span>'}</td></tr>`; }).join('')}</tbody></table></div>` : emptyState('No recipes yet', 'Build one from Products → Edit product → Recipe.')}
      </section>`);
    content.querySelector('[data-add-conversion]').onclick = () => conversionForm({});
    content.querySelectorAll('[data-verify]').forEach((b) => { b.onclick = async () => {
      const [itemId, unit] = b.dataset.verify.split('|'); const c = cat.conversions.find((x) => x.item_id === itemId && x.unit === unit);
      b.disabled = true;
      try { await db.rpc('save_unit_conversion', { payload: { item_id: itemId, unit, factor: c.factor, note: c.note, verified: true } }); toast(`Conversion verified for ${c.item_name}.`); await load(); }
      catch (error) { toast(error.message); b.disabled = false; }
    }; });
    content.querySelectorAll('[data-edit-conversion]').forEach((b) => { b.onclick = () => { const [itemId, unit] = b.dataset.editConversion.split('|'); conversionForm(cat.conversions.find((x) => x.item_id === itemId && x.unit === unit)); }; });
  };

  const conversionForm = (existing = {}) => {
    const items = state.catalog.items;
    const dialog = showDetails(existing.item_id ? `Conversion — ${existing.item_name}` : 'Add unit conversion', `
      <form class="inventory-form stock-form" data-conversion>
        <label class="form-field"><span>Material</span><select name="item_id" required ${existing.item_id ? 'disabled' : ''}><option value="">Choose a material</option>${items.map((i) => `<option value="${attr(i.id)}" data-unit="${attr(i.unit)}" ${i.id === existing.item_id ? 'selected' : ''}>${e(i.name)} (stocked in ${e(i.unit)})</option>`).join('')}</select></label>
        <div class="stock-conversion-row"><span>1</span><span data-stock-unit>${e(existing.item_unit || '')}</span><span>=</span><input name="amount" type="number" min="0" step="any" required aria-label="Amount in recipe unit" placeholder="e.g. 225" value="${attr(existing.factor ? perStockUnit(existing.factor) : '')}"><select name="unit" aria-label="Recipe unit">${UNITS.map((u) => `<option ${u === (existing.unit || 'g') ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <p class="stock-quiet">Example: butter stocked in pieces → 1 pcs = 225 g.</p>
        <label class="form-field"><span>Source / note</span><input name="note" maxlength="500" value="${attr(existing.note || '')}" placeholder="e.g. Our butter blocks weigh 225 g"></label>
        <label class="stock-check"><input type="checkbox" name="verified" ${existing.is_verified ? 'checked' : ''}> I have checked this against the real product</label>
        <p class="form-error" role="alert" hidden></p>
        <div class="dialog-actions"><button class="button button--quiet" type="button" data-close>Cancel</button><button class="button button--primary" type="submit">Save conversion</button></div>
      </form>`);
    const form = dialog.querySelector('[data-conversion]');
    const syncUnit = () => { form.querySelector('[data-stock-unit]').textContent = form.elements.item_id.selectedOptions[0]?.dataset.unit || ''; };
    form.elements.item_id.onchange = syncUnit; syncUnit();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const box = form.querySelector('[role=alert]'), submit = form.querySelector('[type=submit]'); submit.disabled = true; box.hidden = true;
      try {
        await db.rpc('save_unit_conversion', { payload: { item_id: existing.item_id || form.elements.item_id.value, unit: form.elements.unit.value, factor: Number(form.elements.amount.value) > 0 ? 1 / Number(form.elements.amount.value) : '', note: form.elements.note.value, verified: form.elements.verified.checked } });
        dialog.close(); toast('Conversion saved.'); await load();
      } catch (error) { box.textContent = error.message; box.hidden = false; submit.disabled = false; }
    };
  };

  await load();
}
