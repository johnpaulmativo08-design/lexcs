// Recipe & materials management. Saving always creates a new version, so past order deductions
// keep pointing at the exact quantities that were used.
import { escapeHtml as e, showDetails } from '../components.js?v=3';
import { db } from '../backend-ui.js?v=3';
import { attr, icon, qty, dateTime, sectionTabs, pageHead, skeletonPanel, errorState, emptyState, toast } from '../inventory-ui.js?v=1';

const FACTORS = { mg: ['mass', 0.001], g: ['mass', 1], kg: ['mass', 1000], mL: ['volume', 1], ml: ['volume', 1], L: ['volume', 1000], l: ['volume', 1000], pcs: ['count', 1], dozen: ['count', 12], cm: ['length', 1], m: ['length', 100], inch: ['length', 2.54], yard: ['length', 91.44] };
const GROUPS = [['ingredient', 'Ingredient'], ['flavor', 'Flavor'], ['topping', 'Topping'], ['packaging', 'Packaging']];
const BASES = [['per_batch', 'Per batch (scales with pieces ÷ yield)'], ['per_unit', 'Per piece'], ['per_package', 'Per ordered box/option']];
const STATUS = { active: ['Active', 'success'], draft: ['Draft', 'warning'], archived: ['Archived', 'neutral'] };
const chip = (status) => `<span class="status-chip status-chip--${STATUS[status]?.[1] || 'neutral'}">${e(STATUS[status]?.[0] || status)}</span>`;

export async function renderRecipes(content) {
  const state = { catalog: null, stock: new Map(), filter: 'attention', openId: sessionStorage.getItem('lexc-open-recipe') || '' };
  sessionStorage.removeItem('lexc-open-recipe');
  const shell = (body) => `<section class="inventory-page stock-page">${pageHead('Inventory', 'Recipes decide which materials each confirmed order deducts.', '<button class="button button--primary" type="button" data-new-recipe>' + icon('plus') + ' New recipe</button>')}${sectionTabs('recipes')}${body}</section>`;

  const load = async () => {
    content.innerHTML = shell(`<div class="stock-recipe-grid" role="status" aria-busy="true" aria-label="Loading recipes">${Array.from({ length: 6 }, () => `<article class="stock-recipe-card">${skeletonPanel(4)}</article>`).join('')}</div>`);
    try {
      const [catalog, overview] = await Promise.all([db.rpc('recipe_catalog', {}), db.rpc('inventory_overview', {})]);
      state.catalog = catalog;
      state.stock = new Map((overview.items || []).map((item) => [item.id, item]));
      if (!content.isConnected) return;
      if (state.openId && catalog.recipes.some((r) => r.id === state.openId)) { const id = state.openId; state.openId = ''; return renderEditor(id); }
      renderList();
    } catch (error) {
      console.warn('Recipes failed:', error);
      content.innerHTML = shell(errorState('Recipes could not load'));
      content.querySelector('[data-retry]').onclick = load;
    }
  };

  const latestPerKey = () => {
    const map = new Map();
    for (const r of state.catalog.recipes) {
      const current = map.get(r.recipe_key);
      // Show the active version when one exists, otherwise the newest version.
      if (!current || (r.status === 'active' && current.status !== 'active') || (current.status !== 'active' && r.version > current.version)) map.set(r.recipe_key, r);
    }
    return [...map.values()];
  };
  const flagged = (r) => r.lines.filter((l) => l.needs_review || !['direct', 'verified'].includes(l.conversion)).length;

  const renderList = () => {
    const recipes = latestPerKey().sort((a, b) => a.name.localeCompare(b.name));
    const needs = (r) => r.status === 'draft' && (flagged(r) > 0 || !r.product_id || !r.variant_units.length);
    const filters = [['attention', 'Needs review', recipes.filter(needs).length], ['active', 'Active', recipes.filter((r) => r.status === 'active').length], ['draft', 'Drafts', recipes.filter((r) => r.status === 'draft').length], ['all', 'All', recipes.length]];
    const shown = recipes.filter((r) => state.filter === 'all' || (state.filter === 'attention' ? needs(r) : r.status === state.filter));
    const unverified = state.catalog.conversions.filter((c) => !c.is_verified);
    const linkedProducts = new Set(recipes.filter((r) => r.status === 'active').map((r) => r.product_id));
    const withoutRecipe = state.catalog.products.filter((p) => p.status === 'active' && !linkedProducts.has(p.id));
    content.innerHTML = shell(`
      <div class="stock-callout">${icon('recipe')}<div><strong>Only active recipes deduct stock.</strong> Recipes imported from your costing spreadsheets start as drafts. Review the flagged lines, verify unit conversions, then activate each recipe.
        ${withoutRecipe.length ? `<span class="stock-quiet">${withoutRecipe.length} active product${withoutRecipe.length === 1 ? ' has' : 's have'} no active recipe, so their orders are listed for manual material review.</span>` : ''}</div></div>
      <div class="stock-kinds" role="group" aria-label="Recipe filter">${filters.map(([key, label, count]) => `<button type="button" class="stock-kind${state.filter === key ? ' is-active' : ''}" data-filter="${key}" aria-pressed="${state.filter === key}">${label} <b>${count}</b></button>`).join('')}</div>
      ${shown.length ? `<div class="stock-recipe-grid">${shown.map((r) => {
        const flags = flagged(r);
        return `<article class="stock-recipe-card">
          <header><h3>${e(r.name)}</h3>${chip(r.status)}</header>
          <p class="stock-quiet">${r.product_name ? e(r.product_name) : '<span class="stock-warn-text">Not linked to a product</span>'}</p>
          <dl><div><dt>Yield</dt><dd>${Number(r.batch_yield)} ${e(r.yield_unit)} / batch</dd></div><div><dt>Materials</dt><dd>${r.lines.length}</dd></div><div><dt>Version</dt><dd>v${r.version}</dd></div></dl>
          ${flags ? `<p class="stock-flag">${icon('flag')} ${flags} line${flags === 1 ? '' : 's'} to review</p>` : r.status === 'draft' ? `<p class="stock-ok">${icon('check')} Ready to activate</p>` : ''}
          <button class="button" type="button" data-open="${attr(r.id)}">${r.status === 'draft' ? 'Review recipe' : 'Open recipe'} ${icon('arrow')}</button>
        </article>`; }).join('')}</div>` : `<div class="panel">${emptyState(state.filter === 'attention' ? 'Nothing needs review' : 'No recipes here yet', state.filter === 'attention' ? 'Every draft is ready, or all recipes are active.' : 'Create a recipe to start automatic deductions.')}</div>`}
      <section class="panel stock-conversions">
        <header class="panel__head"><div><h2>Unit conversions</h2><p>Needed when a recipe measures in a different unit type than the stock (e.g. grams of butter vs. 225 g blocks). Unverified conversions block activation.</p></div><button class="button" type="button" data-add-conversion>${icon('plus')} Add conversion</button></header>
        ${state.catalog.conversions.length ? `<div class="table-scroll"><table class="data-table stock-table"><thead><tr><th scope="col">Material</th><th scope="col">Conversion</th><th scope="col">Source / note</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${state.catalog.conversions.map((c) => `<tr>
          <td><strong>${e(c.item_name)}</strong></td><td>1 ${e(c.unit)} = ${Number(c.factor).toLocaleString('en-PH', { maximumFractionDigits: 6 })} ${e(c.item_unit)}</td><td class="stock-quiet">${e(c.note || '—')}</td>
          <td>${c.is_verified ? '<span class="status-chip status-chip--success">Verified</span>' : '<span class="status-chip status-chip--warning">Needs verification</span>'}</td>
          <td class="stock-row-actions">${c.is_verified ? '' : `<button class="button button--small" type="button" data-verify="${attr(c.item_id)}|${attr(c.unit)}">Verify</button>`}<button class="button button--small button--quiet" type="button" data-edit-conversion="${attr(c.item_id)}|${attr(c.unit)}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('No conversions yet')}
        ${unverified.length ? `<p class="stock-conversions__note">${icon('alert')} ${unverified.length} conversion${unverified.length === 1 ? '' : 's'} came from the costing sheets and must be confirmed against your actual packaging.</p>` : ''}
      </section>`);
    content.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { state.filter = b.dataset.filter; renderList(); }; });
    content.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => renderEditor(b.dataset.open); });
    content.querySelector('[data-new-recipe]').onclick = () => renderEditor(null);
    content.querySelector('[data-add-conversion]').onclick = () => conversionForm({});
    content.querySelectorAll('[data-verify]').forEach((b) => { b.onclick = async () => {
      const [itemId, unit] = b.dataset.verify.split('|'); const c = state.catalog.conversions.find((x) => x.item_id === itemId && x.unit === unit);
      b.disabled = true;
      try { await db.rpc('save_unit_conversion', { payload: { item_id: itemId, unit, factor: c.factor, note: c.note, verified: true } }); toast(`Conversion verified for ${c.item_name}.`); await load(); }
      catch (error) { toast(error.message); b.disabled = false; }
    }; });
    content.querySelectorAll('[data-edit-conversion]').forEach((b) => { b.onclick = () => { const [itemId, unit] = b.dataset.editConversion.split('|'); conversionForm(state.catalog.conversions.find((x) => x.item_id === itemId && x.unit === unit)); }; });
  };

  const conversionForm = (existing = {}, onSaved = load) => {
    const items = state.catalog.items;
    const dialog = showDetails(existing.item_id ? `Conversion — ${existing.item_name}` : 'Add unit conversion', `
      <form class="inventory-form stock-form" data-conversion>
        <label class="form-field"><span>Material</span><select name="item_id" required ${existing.item_id ? 'disabled' : ''}><option value="">Choose a material</option>${items.map((i) => `<option value="${attr(i.id)}" data-unit="${attr(i.unit)}" ${i.id === existing.item_id ? 'selected' : ''}>${e(i.name)} (stocked in ${e(i.unit)})</option>`).join('')}</select></label>
        <div class="stock-conversion-row"><span>1</span><select name="unit" aria-label="Recipe unit">${Object.keys(FACTORS).filter((u) => !['ml', 'l'].includes(u)).map((u) => `<option ${u === (existing.unit || 'g') ? 'selected' : ''}>${u}</option>`).join('')}</select><span>=</span><input name="factor" type="number" min="0" step="any" required aria-label="Amount in stock unit" value="${attr(existing.factor ?? '')}"><span data-stock-unit>${e(existing.item_unit || '')}</span></div>
        <label class="form-field"><span>Source / note</span><input name="note" maxlength="500" value="${attr(existing.note || '')}" placeholder="e.g. Our butter blocks weigh 225 g"></label>
        <label class="stock-check"><input type="checkbox" name="verified" ${existing.is_verified ? 'checked' : ''}> I have checked this against the real product</label>
        <p class="form-error" role="alert" hidden></p>
        <div class="dialog-actions"><button class="button button--quiet" type="button" data-close>Cancel</button><button class="button button--primary" type="submit">Save conversion</button></div>
      </form>`);
    const form = dialog.querySelector('[data-conversion]');
    const syncUnit = () => { const option = form.elements.item_id.selectedOptions[0]; form.querySelector('[data-stock-unit]').textContent = option?.dataset.unit || ''; };
    form.elements.item_id.onchange = syncUnit; syncUnit();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const box = form.querySelector('[role=alert]'); const submit = form.querySelector('[type=submit]'); submit.disabled = true; box.hidden = true;
      try {
        await db.rpc('save_unit_conversion', { payload: { item_id: existing.item_id || form.elements.item_id.value, unit: form.elements.unit.value, factor: form.elements.factor.value, note: form.elements.note.value, verified: form.elements.verified.checked } });
        dialog.close(); toast('Conversion saved.'); await onSaved();
      } catch (error) { box.textContent = error.message; box.hidden = false; submit.disabled = false; }
    };
  };

  // ---------------------------------------------------------------------------------------------
  const renderEditor = (recipeId) => {
    const source = state.catalog.recipes.find((r) => r.id === recipeId);
    const draft = source ? {
      recipe_key: source.recipe_key, product_id: source.product_id || '', name: source.name, batch_yield: Number(source.batch_yield), yield_unit: source.yield_unit,
      scaling_mode: source.scaling_mode, notes: source.notes, review_notes: source.review_notes,
      variant_units: Object.fromEntries(source.variant_units.map((v) => [v.variant_id, Number(v.units)])),
      lines: source.lines.map((l) => ({ item_id: l.item_id, line_group: l.line_group, quantity: Number(l.quantity), unit: l.unit, basis: l.basis, rounding: l.rounding, condition: l.condition || {}, needs_review: l.needs_review, review_note: l.review_note, source_text: l.source_text }))
    } : { recipe_key: '', product_id: '', name: '', batch_yield: 12, yield_unit: 'pcs', scaling_mode: 'proportional', notes: '', review_notes: '', variant_units: {}, lines: [{ item_id: '', line_group: 'ingredient', quantity: '', unit: 'g', basis: 'per_batch', rounding: 'exact', condition: {}, needs_review: false, review_note: '', source_text: '' }] };
    const versions = source ? state.catalog.recipes.filter((r) => r.recipe_key === source.recipe_key).sort((a, b) => b.version - a.version) : [];
    let dirty = false;

    const itemById = (id) => state.catalog.items.find((i) => i.id === id);
    const conversionState = (line) => {
      const item = itemById(line.item_id); if (!item) return 'direct';
      if (line.unit === item.unit) return 'direct';
      const from = FACTORS[line.unit]; const to = FACTORS[item.unit];
      if (from && to && from[0] === to[0]) return 'direct';
      const matches = state.catalog.conversions.filter((c) => c.item_id === item.id && FACTORS[c.unit]?.[0] === from?.[0]);
      return matches.some((c) => c.is_verified) ? 'verified' : matches.length ? 'unverified' : 'missing';
    };
    const toItemUnit = (value, line) => {
      const item = itemById(line.item_id); if (!item || !(value > 0)) return null;
      const from = FACTORS[line.unit]; const to = FACTORS[item.unit];
      if (line.unit === item.unit) return value;
      if (from && to && from[0] === to[0]) return value * from[1] / to[1];
      const c = state.catalog.conversions.find((x) => x.item_id === item.id && FACTORS[x.unit]?.[0] === from?.[0]);
      return c ? value * from[1] / FACTORS[c.unit][1] * Number(c.factor) : null;
    };
    const product = () => state.catalog.products.find((p) => p.id === draft.product_id);
    const conditionText = (cond) => {
      const parts = [];
      if (cond.variant_codes?.length) { const labels = (product()?.variants || []).filter((v) => cond.variant_codes.includes(v.code)).map((v) => v.label); parts.push(labels.length ? labels.join(', ') : cond.variant_codes.join(', ')); }
      if (cond.customization) Object.entries(cond.customization).forEach(([k, v]) => parts.push(`${k} = ${[].concat(v).join(' / ')}`));
      return parts.length ? parts.join(' · ') : 'All options';
    };

    const lineRow = (line, index) => {
      const item = itemById(line.item_id);
      const conv = conversionState(line);
      const units = Object.keys(FACTORS).filter((u) => !['ml', 'l'].includes(u));
      const variants = product()?.variants || [];
      const customText = Object.entries(line.condition.customization || {}).map(([k, v]) => `${k}=${[].concat(v).join('|')}`).join('; ');
      return `<div class="stock-line${line.needs_review ? ' stock-line--flagged' : ''}" data-line="${index}">
        <div class="stock-line__grid">
          <label><span>Group</span><select data-field="line_group">${GROUPS.map(([v, l]) => `<option value="${v}" ${line.line_group === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="stock-line__material"><span>Material</span><select data-field="item_id" required><option value="">Choose…</option>${state.catalog.items.map((i) => `<option value="${attr(i.id)}" ${i.id === line.item_id ? 'selected' : ''}>${e(i.name)} (${e(i.unit)})</option>`).join('')}</select></label>
          <label><span>Quantity</span><input data-field="quantity" type="number" min="0" step="any" inputmode="decimal" value="${attr(line.quantity)}" required></label>
          <label><span>Unit</span><select data-field="unit">${units.map((u) => `<option ${u === line.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
          <label class="stock-line__basis"><span>Scales</span><select data-field="basis">${BASES.map(([v, l]) => `<option value="${v}" ${line.basis === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label><span>Rounding</span><select data-field="rounding"><option value="exact" ${line.rounding === 'exact' ? 'selected' : ''}>Exact</option><option value="whole" ${line.rounding === 'whole' ? 'selected' : ''}>Whole units</option></select></label>
          <button class="stock-icon-button stock-line__remove" type="button" data-remove="${index}" aria-label="Remove ${attr(item?.name || 'line')}">${icon('trash')}</button>
        </div>
        <div class="stock-line__meta">
          <details class="stock-line__cond"><summary>Applies to: <strong>${e(conditionText(line.condition))}</strong></summary>
            <div>${variants.length ? `<fieldset><legend>Product options (none checked = all)</legend>${variants.map((v) => `<label class="stock-check"><input type="checkbox" data-variant="${attr(v.code)}" ${line.condition.variant_codes?.includes(v.code) ? 'checked' : ''}> ${e(v.label)}</label>`).join('')}</fieldset>` : '<p class="stock-quiet">Link a product to limit this line to specific options.</p>'}
            <label><span>Customization rule <small>(e.g. base=chocolate; topping=sprinkles|pearls)</small></span><input data-field="custom" value="${attr(customText)}"></label></div></details>
          ${conv === 'missing' || conv === 'unverified' ? `<button type="button" class="stock-pill stock-pill--warn" data-conversion-for="${index}">${icon('alert')} ${conv === 'missing' ? 'No' : 'Unverified'} ${e(line.unit)} → ${e(item?.unit || '')} conversion</button>` : ''}
          ${line.source_text ? `<span class="stock-quiet stock-line__source">Sheet: ${e(line.source_text)}</span>` : ''}
        </div>
        ${line.needs_review ? `<div class="stock-line__review">${icon('flag')}<span>${e(line.review_note || 'Marked for review')}</span><label class="stock-check"><input type="checkbox" data-reviewed="${index}"> Reviewed — quantity is correct</label></div>` : ''}
      </div>`;
    };

    const preview = (pieces) => {
      const factor = draft.scaling_mode === 'whole_batch' ? Math.ceil(pieces / draft.batch_yield) : pieces / draft.batch_yield;
      const totals = new Map();
      draft.lines.forEach((line) => {
        const item = itemById(line.item_id); if (!item) return;
        let value = toItemUnit(Number(line.quantity), line);
        if (value == null) { totals.set(item.id + line.unit, { item, missing: true, line }); return; }
        value *= line.basis === 'per_batch' ? factor : line.basis === 'per_unit' ? pieces : 1;
        if (line.rounding === 'whole') value = Math.ceil(value - 1e-9);
        const key = item.id; const prev = totals.get(key);
        totals.set(key, { item, value: (prev?.value || 0) + value, conditional: prev?.conditional || Object.keys(line.condition || {}).length > 0 });
      });
      return [...totals.values()];
    };

    const render = () => {
      const p = product();
      const flags = draft.lines.filter((l) => l.needs_review).length;
      content.innerHTML = shell(`
        <div class="stock-editor">
          <a class="text-button stock-back" href="#inventory/recipes" data-back>${icon('back')} All recipes</a>
          <header class="stock-editor__head"><div><h2>${e(draft.name || 'New recipe')}</h2><p>${source ? `${chip(source.status)} Viewing v${source.version}${source.activated_at ? ` · activated ${dateTime(source.activated_at)}` : ''} · ${source.used_by_orders} order${source.used_by_orders === 1 ? '' : 's'} used this version` : chip('draft')}</p></div></header>
          ${source?.status === 'active' ? `<p class="stock-callout stock-callout--quiet">${icon('info')} Saving changes creates version ${Math.max(...versions.map((v) => v.version)) + 1}. Orders already deducted keep the quantities from v${source.version}.</p>` : ''}
          ${draft.review_notes ? `<div class="stock-callout stock-callout--warn">${icon('flag')}<div><strong>Import notes</strong><p>${e(draft.review_notes)}</p></div></div>` : ''}
          <form data-recipe novalidate>
            <section class="panel stock-editor__section"><h3>Details</h3>
              <div class="stock-editor__fields">
                <label class="form-field"><span>Recipe name <em>*</em></span><input name="name" maxlength="150" required value="${attr(draft.name)}"></label>
                <label class="form-field"><span>Linked product</span><select name="product_id"><option value="">Not linked yet</option>${state.catalog.products.map((x) => `<option value="${attr(x.id)}" ${x.id === draft.product_id ? 'selected' : ''}>${e(x.name)}${x.status !== 'active' ? ' (archived)' : ''}</option>`).join('')}</select></label>
                <label class="form-field"><span>Batch yield <em>*</em></span><span class="stock-input-suffix"><input name="batch_yield" type="number" min="0.001" step="any" required value="${attr(draft.batch_yield)}"><input name="yield_unit" aria-label="Yield unit" value="${attr(draft.yield_unit)}" maxlength="20"></span></label>
                <label class="form-field"><span>Scaling</span><select name="scaling_mode"><option value="proportional" ${draft.scaling_mode === 'proportional' ? 'selected' : ''}>Proportional to pieces ordered</option><option value="whole_batch" ${draft.scaling_mode === 'whole_batch' ? 'selected' : ''}>Whole batches only (round up)</option></select></label>
              </div>
              <label class="form-field"><span>Notes</span><textarea name="notes" rows="2" maxlength="3000">${e(draft.notes)}</textarea></label>
            </section>
            <section class="panel stock-editor__section"><h3>Pieces per option</h3><p class="stock-quiet">How many ${e(draft.yield_unit || 'pcs')} one ordered quantity of each option contains. Options left empty are not deducted automatically.</p>
              ${p ? `<div class="stock-variant-grid">${p.variants.map((v) => `<label class="form-field"><span>${e(v.label)}</span><input type="number" min="0" step="any" data-variant-units="${attr(v.id)}" value="${attr(draft.variant_units[v.id] ?? '')}" placeholder="—"></label>`).join('')}</div>` : '<p class="stock-warn-text">Link a product to set pieces per option.</p>'}
            </section>
            <section class="panel stock-editor__section"><div class="stock-editor__section-head"><h3>Materials <small>${draft.lines.length} line${draft.lines.length === 1 ? '' : 's'}${flags ? ` · <span class="stock-warn-text">${flags} flagged</span>` : ''}</small></h3><button class="button button--small" type="button" data-add-line>${icon('plus')} Add material</button></div>
              <div class="stock-lines">${draft.lines.map(lineRow).join('')}</div>
            </section>
            <section class="panel stock-editor__section"><h3>Preview material requirements</h3>
              <div class="stock-preview-bar"><label>For <input type="number" min="1" step="1" value="${attr(Math.round(draft.batch_yield) || 12)}" data-preview-pieces aria-label="Pieces to preview"> ${e(draft.yield_unit || 'pcs')}</label><button class="button button--small" type="button" data-preview>${icon('eye')} Preview</button></div>
              <div data-preview-body><p class="stock-quiet">Estimate only — the server recalculates and re-checks stock when an order is confirmed. Per-box lines are shown for one box.</p></div>
            </section>
            <p class="form-error stock-editor__error" role="alert" hidden></p>
            <div class="stock-editor__actions">
              ${source && source.status === 'draft' && !dirty ? `<button class="button" type="button" data-activate-existing>${icon('check')} Activate v${source.version}</button>` : ''}
              ${source && source.status !== 'archived' ? `<button class="button button--quiet" type="button" data-archive>Archive</button>` : ''}
              <span class="stock-spacer"></span>
              <button class="button" type="submit" data-save="draft">Save as new draft</button>
              <button class="button button--primary" type="submit" data-save="activate">${icon('check')} Save &amp; activate</button>
            </div>
          </form>
          ${versions.length > 1 ? `<section class="panel stock-editor__section"><h3>Version history</h3><ol class="stock-versions">${versions.map((v) => `<li><button type="button" class="text-button" data-version="${attr(v.id)}">v${v.version}</button> ${chip(v.status)} <span class="stock-quiet">${dateTime(v.created_at)} · ${v.lines.length} materials · ${v.used_by_orders} order${v.used_by_orders === 1 ? '' : 's'}</span>${v.id === source.id ? ' <small>(viewing)</small>' : ''}</li>`).join('')}</ol></section>` : ''}
        </div>`);
      bindEditor();
    };

    const readForm = () => {
      const form = content.querySelector('[data-recipe]');
      draft.name = form.elements.name.value.trim();
      draft.product_id = form.elements.product_id.value;
      draft.batch_yield = Number(form.elements.batch_yield.value);
      draft.yield_unit = form.elements.yield_unit.value.trim() || 'pcs';
      draft.scaling_mode = form.elements.scaling_mode.value;
      draft.notes = form.elements.notes.value;
      content.querySelectorAll('[data-variant-units]').forEach((input) => { draft.variant_units[input.dataset.variantUnits] = input.value === '' ? null : Number(input.value); });
      content.querySelectorAll('[data-line]').forEach((row) => {
        const line = draft.lines[Number(row.dataset.line)];
        row.querySelectorAll('[data-field]').forEach((field) => {
          if (field.dataset.field === 'custom') {
            const rules = Object.fromEntries(field.value.split(';').map((part) => part.split('=').map((s) => s.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k, v.split('|').map((s) => s.trim()).filter(Boolean)]));
            if (Object.keys(rules).length) line.condition.customization = rules; else delete line.condition.customization;
          } else line[field.dataset.field] = field.dataset.field === 'quantity' ? (field.value === '' ? '' : Number(field.value)) : field.value;
        });
        const codes = [...row.querySelectorAll('[data-variant]:checked')].map((box) => box.dataset.variant);
        if (codes.length) line.condition.variant_codes = codes; else delete line.condition.variant_codes;
      });
    };

    const bindEditor = () => {
      const form = content.querySelector('[data-recipe]');
      const errorBox = content.querySelector('.stock-editor__error');
      form.addEventListener('input', () => { dirty = true; });
      form.elements.product_id.onchange = () => { readForm(); dirty = true; render(); };
      content.querySelector('[data-back]').onclick = (event) => { event.preventDefault(); if (dirty && !confirm('Discard unsaved recipe changes?')) return; renderList(); };
      content.querySelector('[data-new-recipe]').onclick = () => { if (dirty && !confirm('Discard unsaved recipe changes?')) return; renderEditor(null); };
      content.querySelector('[data-add-line]').onclick = () => { readForm(); draft.lines.push({ item_id: '', line_group: 'ingredient', quantity: '', unit: 'g', basis: 'per_batch', rounding: 'exact', condition: {}, needs_review: false, review_note: '', source_text: '' }); dirty = true; render(); content.querySelector(`[data-line="${draft.lines.length - 1}"] [data-field="item_id"]`)?.focus(); };
      content.querySelectorAll('[data-remove]').forEach((b) => { b.onclick = () => { readForm(); draft.lines.splice(Number(b.dataset.remove), 1); dirty = true; render(); }; });
      content.querySelectorAll('[data-reviewed]').forEach((box) => { box.onchange = () => { readForm(); const line = draft.lines[Number(box.dataset.reviewed)]; line.needs_review = !box.checked; dirty = true; render(); }; });
      content.querySelectorAll('[data-field="item_id"],[data-field="unit"]').forEach((select) => { select.addEventListener('change', () => { readForm(); render(); }); });
      content.querySelectorAll('[data-conversion-for]').forEach((b) => { b.onclick = () => {
        readForm(); const line = draft.lines[Number(b.dataset.conversionFor)]; const item = itemById(line.item_id);
        const existing = state.catalog.conversions.find((c) => c.item_id === item.id && FACTORS[c.unit]?.[0] === FACTORS[line.unit]?.[0]);
        conversionForm(existing || { item_id: item.id, item_name: item.name, item_unit: item.unit, unit: line.unit }, async () => { state.catalog = await db.rpc('recipe_catalog', {}); render(); });
      }; });
      content.querySelectorAll('[data-version]').forEach((b) => { b.onclick = () => renderEditor(b.dataset.version); });
      content.querySelector('[data-preview]').onclick = () => {
        readForm();
        const pieces = Number(content.querySelector('[data-preview-pieces]').value);
        const body = content.querySelector('[data-preview-body]');
        if (!(pieces > 0) || !(draft.batch_yield > 0)) { body.innerHTML = '<p class="form-error">Enter a batch yield and a positive quantity to preview.</p>'; return; }
        const rows = preview(pieces);
        body.innerHTML = rows.length ? `<div class="table-scroll"><table class="data-table stock-table"><thead><tr><th scope="col">Material</th><th scope="col" class="num">Required</th><th scope="col" class="num">Available now</th><th scope="col">Check</th></tr></thead><tbody>${rows.map((r) => {
          const stock = state.stock.get(r.item.id);
          if (r.missing) return `<tr><th scope="row">${e(r.item.name)}</th><td class="num" colspan="2"><span class="stock-warn-text">Cannot convert ${e(r.line.unit)} → ${e(r.item.unit)}</span></td><td>—</td></tr>`;
          const short = stock && Number(stock.available) < r.value;
          return `<tr><th scope="row">${e(r.item.name)}${r.conditional ? ' <small class="stock-quiet">(conditional)</small>' : ''}</th><td class="num"><strong>${qty(r.value, r.item.unit)}</strong></td><td class="num">${stock ? qty(stock.available, r.item.unit) : '—'}</td><td>${short ? `<span class="status-chip status-chip--danger">Short ${qty(r.value - Number(stock.available), r.item.unit)}</span>` : '<span class="status-chip status-chip--success">OK</span>'}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="stock-quiet">Add materials to preview.</p>';
      };
      content.querySelector('[data-activate-existing]')?.addEventListener('click', async (event) => {
        const b = event.currentTarget; b.disabled = true; errorBox.hidden = true;
        try { await db.rpc('set_recipe_status', { target_recipe: source.id, next_status: 'active' }); toast(`${source.name} is now active.`); state.openId = source.id; await load(); }
        catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; b.disabled = false; errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      });
      content.querySelector('[data-archive]')?.addEventListener('click', async (event) => {
        if (!confirm(`Archive "${source.name}" v${source.version}? Orders for this product will no longer deduct materials automatically.`)) return;
        const b = event.currentTarget; b.disabled = true;
        try { await db.rpc('set_recipe_status', { target_recipe: source.id, next_status: 'archived' }); toast('Recipe archived.'); await load(); }
        catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; b.disabled = false; }
      });
      form.onsubmit = async (event) => {
        event.preventDefault();
        readForm();
        const activate = event.submitter?.dataset.save === 'activate';
        const problems = [];
        if (draft.name.length < 2) problems.push('Enter a recipe name.');
        if (!(draft.batch_yield > 0)) problems.push('Batch yield must be greater than zero.');
        if (!draft.lines.length) problems.push('Add at least one material.');
        draft.lines.forEach((l, i) => { if (!l.item_id) problems.push(`Line ${i + 1}: choose a material.`); if (!(Number(l.quantity) > 0)) problems.push(`Line ${i + 1}: quantity must be greater than zero.`); });
        if (activate && !draft.product_id) problems.push('Link a product before activating.');
        content.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
        draft.lines.forEach((l, i) => { const row = content.querySelector(`[data-line="${i}"]`); if (!l.item_id) row.querySelector('[data-field="item_id"]').setAttribute('aria-invalid', 'true'); if (!(Number(l.quantity) > 0)) row.querySelector('[data-field="quantity"]').setAttribute('aria-invalid', 'true'); });
        if (problems.length) { errorBox.innerHTML = problems.map(e).join('<br>'); errorBox.hidden = false; errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
        const buttons = form.querySelectorAll('[type=submit]'); buttons.forEach((b) => { b.disabled = true; }); errorBox.hidden = true;
        try {
          const saved = await db.rpc('save_recipe', { payload: {
            ...draft, activate,
            variant_units: Object.entries(draft.variant_units).filter(([, units]) => units > 0).map(([variant_id, units]) => ({ variant_id, units })),
            lines: draft.lines.map((l) => ({ ...l, quantity: Number(l.quantity) }))
          } });
          toast(activate ? `${saved.name} v${saved.version} is active.` : `Saved ${saved.name} v${saved.version} as a draft.`);
          dirty = false; state.openId = saved.id; await load();
        } catch (error) {
          // A failed activation still saved nothing: write_recipe_version + activate run in one transaction.
          errorBox.textContent = error.message; errorBox.hidden = false; buttons.forEach((b) => { b.disabled = false; });
          errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      };
    };
    render();
  };

  await load();
}
