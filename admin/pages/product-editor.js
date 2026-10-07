// Add / Edit Product: one drawer with three collapsible sections — Product information, Sizes & prices, Recipe.
// "Save product" saves everything in order: photo → product and sizes (save_product) → recipe (save_recipe).
// Recipes keep the existing versioned system: saving a changed recipe creates a new version, so orders already
// deducted keep the exact quantities they used. Only an ACTIVE recipe deducts stock when an order is confirmed.
import { db } from '../backend-ui.js?v=3';
import { escapeHtml as e } from '../components.js?v=3';
import { attr, icon, qty, openDrawer, toast, emptyState } from '../inventory-ui.js?v=2';
import { ask } from '../../shared/ask.js?v=1';
import { UNITS, GROUPS, BASES, BASIS_SHORT, recipeForProduct, conversionState, previewRequirements, conditionText, lineKey } from '../recipe-model.js?v=1';

const money = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const newId = () => window.crypto.randomUUID();
const blankLine = () => ({ item_id: '', line_group: 'ingredient', quantity: '', unit: 'g', basis: 'per_batch', rounding: 'exact', condition: {}, needs_review: false, review_note: '', source_text: '' });

/**
 * @param {object} o
 * @param {object|null} o.product    existing product row (db.catalog shape) or null for Add Product
 * @param {Array} o.categories
 * @param {boolean} o.packages       creating/editing a package
 * @param {Promise<object>} o.catalog  recipe_catalog() promise (ingredients, recipes, conversions)
 * @param {string} o.image           current photo URL (if any)
 * @param {Function} o.onSaved
 */
export function openProductEditor({ product, categories, packages, catalog, image, onSaved }) {
  const isNew = !product;
  const productId = product?.id || newId();
  const kind = product?.kind || (packages ? 'package' : 'standard');
  const locked = kind === 'customizable';   // the three frosting options are fixed by the designer
  const state = {
    variants: (product?.product_variants || []).filter((v) => v.is_active).map((v) => ({ id: v.id, code: v.code, label: v.label, price: Number(v.price) })),
    cat: null, recipe: null, draft: null, recipeDirty: false, productSaved: !isNew, saving: false, editing: null, photoURL: null
  };
  if (!state.variants.length) state.variants = [{ id: newId(), code: 'option-' + newId(), label: 'Standard', price: '' }];

  const drawer = openDrawer(isNew ? (packages ? 'Add package' : 'Add product') : `Edit · ${product.name}`, `
    <form class="pe" data-pe novalidate>
      <details class="pe-section" open data-section="info">
        <summary><span class="pe-step">1</span><span><strong>Product information</strong><small data-sum="info"></small></span>${icon('arrow')}</summary>
        <div class="pe-body">
          <div class="pe-photo">
            <div class="pe-photo__frame" data-photo-frame>${image ? `<img src="${attr(image)}" alt="">` : `<span>${icon('box')}<small>No photo yet</small></span>`}</div>
            <div class="pe-photo__actions"><input type="file" name="image" accept="image/jpeg,image/png,image/webp" hidden><button type="button" class="button button--small" data-photo-pick>${image ? 'Replace photo' : 'Add photo'}</button><small>JPG, PNG or WEBP · up to 5 MB</small></div>
          </div>
          <label class="form-field"><span>Product name <em>*</em></span><input name="name" maxlength="120" value="${attr(product?.name || '')}" placeholder="e.g. Chocolate Bento Cake" autocomplete="off"></label>
          <div class="form-grid">
            <label class="form-field"><span>Category</span><select name="category_id"><option value="">None</option>${categories.map((c) => `<option value="${attr(c.id)}" ${product?.category_id === c.id ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select></label>
          </div>
          <label class="form-field"><span>Description</span><textarea name="description" rows="3" maxlength="1000" placeholder="Shown on the product page">${e(product?.description || '')}</textarea></label>
          ${kind === 'package' ? `<label class="form-field"><span>Package contents <small>(one per line)</small></span><textarea name="contents" rows="4">${e((product?.package_contents || []).join('\n'))}</textarea></label>` : ''}
        </div>
      </details>
      <details class="pe-section" ${isNew ? 'open' : ''} data-section="sizes">
        <summary><span class="pe-step">2</span><span><strong>Sizes &amp; prices</strong><small data-sum="sizes"></small></span>${icon('arrow')}</summary>
        <div class="pe-body">
          ${locked ? '<p class="pe-note">This designer product always has its three frosting options. You can rename them and change prices.</p>' : ''}
          <div class="pe-variants" data-variants></div>
          ${locked ? '' : `<button type="button" class="button button--small pe-add" data-add-variant>${icon('plus')} Add size</button>`}
        </div>
      </details>
      <details class="pe-section" data-section="recipe">
        <summary><span class="pe-step">3</span><span><strong>Recipe</strong><small data-sum="recipe">Loading…</small></span>${icon('arrow')}</summary>
        <div class="pe-body" data-recipe-body><p class="pe-loading" role="status">Loading ingredients…</p></div>
      </details>
      <p class="form-error pe-error" role="alert" hidden></p>
      <footer class="pe-foot"><span class="pe-status" data-status aria-live="polite"></span><button type="button" class="button button--quiet" data-drawer-close>Cancel</button><button type="submit" class="button button--primary" data-save>${isNew ? 'Create product' : 'Save product'}</button></footer>
    </form>`, { wide: true });
  drawer.classList.add('pe-drawer');
  const form = drawer.querySelector('[data-pe]');
  const errorBox = form.querySelector('.pe-error'), status = form.querySelector('[data-status]');
  const say = (text, tone = '') => { status.textContent = text; status.className = 'pe-status' + (tone ? ' is-' + tone : ''); };

  // ------------------------------------------------------------------ summaries in the section headers
  const summarize = () => {
    const name = form.elements.name.value.trim(), cat = form.elements.category_id.selectedOptions[0];
    form.querySelector('[data-sum="info"]').textContent = [name || 'Name needed', cat?.value ? cat.textContent : ''].filter(Boolean).join(' · ');
    const prices = state.variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n >= 0);
    form.querySelector('[data-sum="sizes"]').textContent = `${state.variants.length} size${state.variants.length === 1 ? '' : 's'}${prices.length ? ' · from ' + money(Math.min(...prices)) : ''}`;
    const sum = form.querySelector('[data-sum="recipe"]');
    if (!state.cat) return;
    const lines = state.draft?.lines.filter((l) => l.item_id).length || 0;
    sum.innerHTML = !state.draft ? '<b class="pe-chip pe-chip--bad">Not configured</b>'
      : `<b class="pe-chip ${state.recipe?.status === 'active' && !state.recipeDirty ? 'pe-chip--ok' : 'pe-chip--warn'}">${state.recipeDirty ? 'Unsaved changes' : state.recipe?.status === 'active' ? 'Active' : 'Draft'}</b> ${lines} ingredient${lines === 1 ? '' : 's'}`;
  };

  // ------------------------------------------------------------------ photo
  const fileInput = form.elements.image;
  form.querySelector('[data-photo-pick]').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files[0]; errorBox.hidden = true;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5242880) { fileInput.value = ''; showError(['Choose a JPG, PNG or WEBP photo up to 5 MB.']); return; }
    if (state.photoURL) URL.revokeObjectURL(state.photoURL);
    state.photoURL = URL.createObjectURL(file);
    form.querySelector('[data-photo-frame]').innerHTML = `<img src="${state.photoURL}" alt="">`;
    form.querySelector('[data-photo-pick]').textContent = 'Replace photo';
  };

  // ------------------------------------------------------------------ sizes & prices
  const variantRow = (v, i) => `<div class="pe-variant" data-variant="${attr(v.id)}">
      <label><span>Size / option</span><input data-v="label" maxlength="60" value="${attr(v.label)}" placeholder="e.g. 6 pcs"></label>
      <label><span>Price (₱)</span><input data-v="price" type="number" min="0" step="0.01" inputmode="decimal" value="${attr(v.price)}" placeholder="0.00"></label>
      ${locked ? '' : `<button type="button" class="stock-icon-button pe-variant__remove" data-remove-variant="${attr(v.id)}" aria-label="Remove ${attr(v.label || 'size ' + (i + 1))}" ${state.variants.length === 1 ? 'disabled' : ''}>${icon('trash')}</button>`}
    </div>`;
  const drawVariants = () => { form.querySelector('[data-variants]').innerHTML = state.variants.map(variantRow).join(''); summarize(); drawPieces(); };
  form.querySelector('[data-variants]').addEventListener('input', (event) => {
    const row = event.target.closest('[data-variant]'), v = state.variants.find((x) => x.id === row?.dataset.variant); if (!v) return;
    v[event.target.dataset.v] = event.target.dataset.v === 'price' ? event.target.value : event.target.value;
    event.target.removeAttribute('aria-invalid'); summarize(); drawPieces(true);
  });
  form.querySelector('[data-variants]').addEventListener('click', (event) => {
    const b = event.target.closest('[data-remove-variant]'); if (!b || state.variants.length === 1) return;
    state.variants = state.variants.filter((v) => v.id !== b.dataset.removeVariant);
    if (state.draft) { delete state.draft.variant_units[b.dataset.removeVariant]; state.recipeDirty = true; }
    drawVariants();
  });
  form.querySelector('[data-add-variant]')?.addEventListener('click', () => {
    state.variants.push({ id: newId(), code: 'option-' + newId(), label: '', price: '' });
    drawVariants(); form.querySelector('.pe-variant:last-child [data-v="label"]').focus();
  });

  // ------------------------------------------------------------------ recipe
  const recipeBody = form.querySelector('[data-recipe-body]');
  const itemById = (id) => state.cat.items.find((i) => i.id === id);
  const variantsForConditions = () => state.variants.map((v) => ({ code: v.code, label: v.label || 'Unnamed size' }));
  const startDraft = (source) => {
    state.draft = source ? {
      recipe_key: source.recipe_key, name: source.name, batch_yield: Number(source.batch_yield), yield_unit: source.yield_unit, scaling_mode: source.scaling_mode,
      notes: source.notes || '', review_notes: source.review_notes || '',
      variant_units: Object.fromEntries((source.variant_units || []).map((v) => [v.variant_id, Number(v.units)])),
      lines: source.lines.map((l) => ({ item_id: l.item_id, line_group: l.line_group, quantity: Number(l.quantity), unit: l.unit, basis: l.basis, rounding: l.rounding, condition: l.condition || {}, needs_review: l.needs_review, review_note: l.review_note, source_text: l.source_text }))
    } : { recipe_key: '', name: '', batch_yield: 1, yield_unit: 'pcs', scaling_mode: 'proportional', notes: '', review_notes: '', variant_units: {}, lines: [] };
    state.activate = source ? source.status === 'active' || isNew : true;
  };

  const lineCard = (l, i) => {
    const item = itemById(l.item_id), conv = conversionState(state.cat, l), cond = conditionText(l.condition, variantsForConditions());
    if (state.editing === i) return lineEditor(l, i);
    return `<li class="pe-line${l.needs_review ? ' is-flagged' : ''}" data-line="${i}">
      <div class="pe-line__main"><strong>${e(item?.name || 'Choose an ingredient')}</strong>
        <span class="pe-line__qty">${l.quantity === '' ? '—' : e(Number(l.quantity).toLocaleString('en-PH', { maximumFractionDigits: 6 }))} ${e(l.unit)} <small>${e(BASIS_SHORT[l.basis] || '')}</small></span></div>
      <div class="pe-line__tags">${l.line_group !== 'ingredient' ? `<span class="pe-tag">${e(GROUPS.find((g) => g[0] === l.line_group)?.[1] || l.line_group)}</span>` : ''}${cond ? `<span class="pe-tag" title="Only deducted for: ${attr(cond)}">Only: ${e(cond)}</span>` : ''}${conv === 'missing' || conv === 'unverified' ? `<span class="pe-tag pe-tag--warn">${conv === 'missing' ? 'Needs' : 'Unverified'} ${e(l.unit)} → ${e(item?.unit || '')} conversion</span>` : ''}${l.needs_review ? `<span class="pe-tag pe-tag--warn" title="${attr(l.review_note)}">Check quantity</span>` : ''}</div>
      <div class="pe-line__actions"><button type="button" class="button button--small" data-edit-line="${i}">Edit</button><button type="button" class="stock-icon-button" data-remove-line="${i}" aria-label="Remove ${attr(item?.name || 'ingredient')}">${icon('trash')}</button></div>
    </li>`;
  };
  const lineEditor = (l, i) => {
    const item = itemById(l.item_id);
    return `<li class="pe-line pe-line--edit" data-line="${i}">
      <div class="pe-combo" data-combo>
        <label><span>Ingredient</span><input type="search" data-combo-input value="${attr(item?.name || '')}" placeholder="Search inventory ingredients…" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="pe-combo-list-${i}"></label>
        <ul class="pe-combo__list" id="pe-combo-list-${i}" role="listbox" hidden></ul>
      </div>
      <div class="pe-line__fields">
        <label><span>Quantity</span><input data-l="quantity" type="number" min="0" step="any" inputmode="decimal" value="${attr(l.quantity)}"></label>
        <label><span>Unit</span><select data-l="unit">${UNITS.map((u) => `<option ${u === l.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
        <label><span>Counts</span><select data-l="basis">${BASES.map(([v, t]) => `<option value="${v}" ${l.basis === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      <details class="pe-more"><summary>More options</summary>
        <div class="pe-line__fields">
          <label><span>Group</span><select data-l="line_group">${GROUPS.map(([v, t]) => `<option value="${v}" ${l.line_group === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label><span>Rounding</span><select data-l="rounding"><option value="exact" ${l.rounding === 'exact' ? 'selected' : ''}>Exact</option><option value="whole" ${l.rounding === 'whole' ? 'selected' : ''}>Whole units</option></select></label>
        </div>
        <fieldset class="pe-applies"><legend>Only for these sizes <small>(none ticked = every size)</small></legend>${state.variants.map((v) => `<label class="stock-check"><input type="checkbox" data-cond-variant="${attr(v.code)}" ${l.condition.variant_codes?.includes(v.code) ? 'checked' : ''}> ${e(v.label || 'Unnamed size')}</label>`).join('')}</fieldset>
        <label><span>Only for a design choice <small>(e.g. base=chocolate; topping=sprinkles|pearls)</small></span><input data-l="custom" value="${attr(Object.entries(l.condition.customization || {}).map(([k, v]) => `${k}=${[].concat(v).join('|')}`).join('; '))}"></label>
        ${l.needs_review ? `<label class="stock-check pe-reviewed"><input type="checkbox" data-reviewed> ${e(l.review_note || 'Marked for review')} — quantity checked</label>` : ''}
      </details>
      <p class="pe-line__error" role="alert" hidden></p>
      <div class="pe-line__actions"><button type="button" class="button button--quiet button--small" data-cancel-line="${i}">Cancel</button><button type="button" class="button button--primary button--small" data-done-line="${i}">Done</button></div>
    </li>`;
  };

  const drawPieces = (keepFocus) => {
    const box = recipeBody.querySelector('[data-pieces]'); if (!box || !state.draft) return;
    if (keepFocus && box.contains(document.activeElement)) return;
    box.innerHTML = state.variants.map((v) => `<label><span>${e(v.label || 'Unnamed size')}</span><input type="number" min="0" step="any" inputmode="decimal" data-pieces-for="${attr(v.id)}" value="${attr(state.draft.variant_units[v.id] ?? '')}" placeholder="—"></label>`).join('');
  };

  const drawRecipe = () => {
    if (!state.cat) return;
    if (!state.draft) {
      const unlinked = state.cat.recipes.filter((r) => !r.product_id && r.status !== 'archived');
      recipeBody.innerHTML = `<div class="pe-empty">${emptyState('No recipe configured yet.', 'Without an active recipe, orders for this product are not deducted from inventory automatically.')}
        <div class="pe-empty__actions"><button type="button" class="button button--primary" data-build>${icon('plus')} Build recipe</button>
        ${unlinked.length ? `<label class="pe-from"><span>or start from an unlinked recipe</span><select data-from><option value="">Choose…</option>${unlinked.map((r) => `<option value="${attr(r.id)}">${e(r.name)} (v${r.version}, ${r.lines.length} ingredients)</option>`).join('')}</select></label>` : ''}</div></div>`;
      recipeBody.querySelector('[data-build]').onclick = () => { startDraft(null); state.draft.lines.push(blankLine()); state.editing = 0; state.recipeDirty = true; drawRecipe(); recipeBody.querySelector('[data-combo-input]')?.focus(); };
      recipeBody.querySelector('[data-from]')?.addEventListener('change', (event) => { const r = state.cat.recipes.find((x) => x.id === event.target.value); if (!r) return; startDraft(r); state.recipeDirty = true; drawRecipe(); });
      summarize(); return;
    }
    const d = state.draft, r = state.recipe;
    const versionNote = r ? `${r.status === 'active' ? 'Active' : 'Draft'} v${r.version} · used by ${r.used_by_orders} order${r.used_by_orders === 1 ? '' : 's'}${r.status === 'active' ? ` · saving changes creates v${Math.max(...state.cat.recipes.filter((x) => x.recipe_key === r.recipe_key).map((x) => x.version)) + 1}; past deductions keep v${r.version}` : ''}` : 'New recipe';
    recipeBody.innerHTML = `
      <p class="pe-version">${e(versionNote)}</p>
      ${d.review_notes ? `<p class="pe-note pe-note--warn">${icon('flag')} ${e(d.review_notes)}</p>` : ''}
      <div class="pe-sub"><h4>Ingredients <small>${d.lines.length}</small></h4></div>
      ${d.lines.length ? `<ul class="pe-lines">${d.lines.map(lineCard).join('')}</ul>` : '<p class="stock-quiet">No ingredients yet.</p>'}
      ${state.editing === null ? `<button type="button" class="button button--small pe-add" data-add-line>${icon('plus')} Add ingredient</button>` : ''}
      <details class="pe-more pe-settings" ${!r ? 'open' : ''}><summary>Batch &amp; pieces per size</summary>
        <div class="pe-line__fields">
          <label><span>One batch makes</span><span class="stock-input-suffix"><input data-r="batch_yield" type="number" min="0.001" step="any" value="${attr(d.batch_yield)}"><input data-r="yield_unit" maxlength="20" value="${attr(d.yield_unit)}" aria-label="Yield unit"></span></label>
          <label><span>Scaling</span><select data-r="scaling_mode"><option value="proportional" ${d.scaling_mode === 'proportional' ? 'selected' : ''}>Proportional to pieces ordered</option><option value="whole_batch" ${d.scaling_mode === 'whole_batch' ? 'selected' : ''}>Whole batches only</option></select></label>
        </div>
        <p class="stock-quiet">Pieces in one of each size (e.g. a 12 pcs box → 12). Sizes left empty are not deducted automatically.</p>
        <div class="pe-pieces" data-pieces></div>
      </details>
      <details class="pe-more"><summary>Preview materials for an order</summary>
        <div class="pe-preview"><label>For <input type="number" min="1" step="1" value="${attr(Math.round(d.batch_yield) || 12)}" data-preview-pieces aria-label="Pieces"> ${e(d.yield_unit || 'pcs')}</label><button type="button" class="button button--small" data-preview>${icon('eye')} Preview</button></div>
        <div data-preview-body><p class="stock-quiet">Estimate only — the server recalculates when an order is confirmed.</p></div>
      </details>
      <label class="stock-check pe-activate"><input type="checkbox" data-activate ${state.activate ? 'checked' : ''}> Use this recipe for automatic stock deduction (active)</label>
      ${r?.status === 'active' ? '<button type="button" class="text-button pe-stop" data-stop>Stop automatic deduction for this product</button>' : ''}`;
    drawPieces();
    summarize();
    const combo = recipeBody.querySelector('[data-combo]');
    if (combo) bindCombo(combo, state.editing);
  };

  // searchable ingredient picker (inventory items only)
  const bindCombo = (combo, index) => {
    const input = combo.querySelector('[data-combo-input]'), list = combo.querySelector('[role=listbox]');
    let active = -1, shown = [];
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      shown = state.cat.items.filter((i) => !q || i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q)).slice(0, 40);
      list.innerHTML = shown.length ? shown.map((i, n) => `<li role="option" id="pe-opt-${index}-${n}" data-pick="${attr(i.id)}" aria-selected="${n === active}" class="${n === active ? 'is-active' : ''}"><strong>${e(i.name)}</strong><small>${e(i.unit)}${i.inventory_type === 'packaging' ? ' · packaging' : i.category ? ' · ' + e(i.category) : ''}</small></li>`).join('') : '<li class="pe-combo__empty">No ingredients found. Add it in Inventory first.</li>';
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    };
    const pick = (id) => {
      const it = itemById(id); if (!it) return;
      readLineEditor(index);
      const line = state.draft.lines[index]; line.item_id = it.id;
      // a new line starts in the usual recipe unit for that kind of stock (kg → g, L → mL, pcs → pcs)
      if (line.quantity === '') line.unit = ['kg', 'g', 'mg'].includes(it.unit) ? 'g' : ['L', 'mL'].includes(it.unit) ? 'mL' : UNITS.includes(it.unit) ? it.unit : line.unit;
      if (it.inventory_type === 'packaging') { line.line_group = 'packaging'; line.basis = 'per_package'; }
      state.recipeDirty = true; drawRecipe(); recipeBody.querySelector(`[data-line="${index}"] [data-l="quantity"]`)?.focus();
    };
    input.addEventListener('focus', draw);
    input.addEventListener('input', () => { active = -1; draw(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, Math.min(shown.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))); draw(); input.setAttribute('aria-activedescendant', `pe-opt-${index}-${active}`); }
      else if (event.key === 'Enter') { event.preventDefault(); if (shown[active] || shown.length === 1) pick((shown[active] || shown[0]).id); }
      else if (event.key === 'Escape') { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
    });
    list.addEventListener('pointerdown', (event) => { const li = event.target.closest('[data-pick]'); if (li) { event.preventDefault(); pick(li.dataset.pick); } });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 120));
  };

  const readLineEditor = (index) => {
    const row = recipeBody.querySelector(`[data-line="${index}"]`); if (!row) return;
    const line = state.draft.lines[index];
    row.querySelectorAll('[data-l]').forEach((f) => {
      if (f.dataset.l === 'custom') {
        const rules = Object.fromEntries(f.value.split(';').map((part) => part.split('=').map((x) => x.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k, v.split('|').map((x) => x.trim()).filter(Boolean)]));
        if (Object.keys(rules).length) line.condition.customization = rules; else delete line.condition.customization;
      } else line[f.dataset.l] = f.dataset.l === 'quantity' ? (f.value === '' ? '' : Number(f.value)) : f.value;
    });
    const codes = [...row.querySelectorAll('[data-cond-variant]:checked')].map((b) => b.dataset.condVariant);
    if (codes.length) line.condition.variant_codes = codes; else delete line.condition.variant_codes;
    const reviewed = row.querySelector('[data-reviewed]'); if (reviewed?.checked) line.needs_review = false;
  };
  const lineProblem = (index) => {
    const l = state.draft.lines[index];
    if (!l.item_id || !itemById(l.item_id)) return 'Choose an ingredient from Inventory.';
    if (!(Number(l.quantity) > 0)) return 'Quantity must be greater than zero.';
    if (!UNITS.includes(l.unit)) return 'Choose a valid unit.';
    if (state.draft.lines.some((o, j) => j !== index && o.item_id && lineKey(o) === lineKey(l))) return `${itemById(l.item_id).name} is already in this recipe for the same sizes. Edit that line instead.`;
    return '';
  };
  let lineBackup = null;
  recipeBody.addEventListener('click', (event) => {
    const t = event.target;
    const add = t.closest('[data-add-line]'), edit = t.closest('[data-edit-line]'), remove = t.closest('[data-remove-line]'), done = t.closest('[data-done-line]'), cancel = t.closest('[data-cancel-line]');
    if (add) { state.draft.lines.push(blankLine()); state.editing = state.draft.lines.length - 1; lineBackup = null; drawRecipe(); recipeBody.querySelector('[data-combo-input]')?.focus(); return; }
    if (edit) { state.editing = Number(edit.dataset.editLine); lineBackup = JSON.parse(JSON.stringify(state.draft.lines[state.editing])); drawRecipe(); return; }
    if (remove) { const i = Number(remove.dataset.removeLine), name = itemById(state.draft.lines[i].item_id)?.name; state.draft.lines.splice(i, 1); state.recipeDirty = true; drawRecipe(); if (name) toast(`${name} removed from the recipe (saved when you save the product).`); return; }
    if (done) {
      const i = Number(done.dataset.doneLine); readLineEditor(i);
      const problem = lineProblem(i), box = recipeBody.querySelector(`[data-line="${i}"] .pe-line__error`);
      if (problem) { box.textContent = problem; box.hidden = false; return; }
      state.editing = null; state.recipeDirty = true; drawRecipe(); return;
    }
    if (cancel) { const i = Number(cancel.dataset.cancelLine); if (lineBackup) state.draft.lines[i] = lineBackup; else state.draft.lines.splice(i, 1); state.editing = null; lineBackup = null; drawRecipe(); return; }
    if (t.closest('[data-preview]')) {
      readSettings();
      const pieces = Number(recipeBody.querySelector('[data-preview-pieces]').value), body = recipeBody.querySelector('[data-preview-body]');
      if (!(pieces > 0) || !(state.draft.batch_yield > 0)) { body.innerHTML = '<p class="form-error">Enter a batch size and a positive quantity.</p>'; return; }
      const rows = previewRequirements(state.cat, { ...state.draft, lines: state.draft.lines.filter((l) => l.item_id && Number(l.quantity) > 0) }, pieces);
      body.innerHTML = rows.length ? `<ul class="pe-preview-list">${rows.map((x) => x.missing ? `<li><span>${e(x.item.name)}</span><span class="stock-warn-text">needs a ${e(x.line.unit)} → ${e(x.item.unit)} conversion</span></li>` : `<li><span>${e(x.item.name)}${x.conditional ? ' <small>(some sizes/designs)</small>' : ''}</span><strong>${qty(x.value, x.item.unit)}</strong></li>`).join('')}</ul>` : '<p class="stock-quiet">Add ingredients to preview.</p>';
      return;
    }
    if (t.closest('[data-stop]')) {
      const b = t.closest('[data-stop]');
      ask(`Orders for ${product?.name || 'this product'} will no longer take ingredients from Inventory automatically; they will be listed for you to record materials by hand. The recipe is kept in history.`, { title: 'Stop automatic deduction?', confirm: 'Stop deduction', tone: 'danger' })
        .then((ok) => { if (!ok) return; b.disabled = true; return db.rpc('set_recipe_status', { target_recipe: state.recipe.id, next_status: 'archived' })
        .then(async () => { toast('Automatic deduction stopped. The recipe is archived and kept in history.'); await reloadCatalog(); state.recipe = null; state.draft = null; state.recipeDirty = false; drawRecipe(); onSaved?.({ keepOpen: true }); })
        .catch((error) => { b.disabled = false; showError([error.message]); }); });
    }
  });
  const readSettings = () => {
    if (!state.draft) return;
    recipeBody.querySelectorAll('[data-r]').forEach((f) => { state.draft[f.dataset.r] = f.dataset.r === 'batch_yield' ? Number(f.value) : f.value.trim(); });
    recipeBody.querySelectorAll('[data-pieces-for]').forEach((f) => { state.draft.variant_units[f.dataset.piecesFor] = f.value === '' ? null : Number(f.value); });
    const act = recipeBody.querySelector('[data-activate]'); if (act) state.activate = act.checked;
  };
  recipeBody.addEventListener('input', (event) => { if (event.target.closest('[data-r],[data-pieces-for],[data-activate]')) { state.recipeDirty = true; readSettings(); summarize(); } });
  recipeBody.addEventListener('change', (event) => {
    if (event.target.matches('[data-activate]')) { state.activate = event.target.checked; state.recipeDirty = true; summarize(); }
    if (event.target.closest('.pe-line--edit') && event.target.matches('[data-l="unit"]')) { readLineEditor(state.editing); drawRecipe(); }
  });

  const reloadCatalog = async () => { state.cat = await db.rpc('recipe_catalog', {}); state.recipe = recipeForProduct(state.cat, productId); };
  Promise.resolve(catalog).then((cat) => {
    if (!cat) throw new Error('no catalog');
    state.cat = cat; state.recipe = recipeForProduct(cat, productId);
    if (state.recipe) startDraft(state.recipe);
    drawRecipe();
  }).catch(() => {
    recipeBody.innerHTML = '<p class="form-error">Unable to load ingredients.</p><button type="button" class="button button--small" data-retry-recipe>Try again</button>';
    form.querySelector('[data-sum="recipe"]').textContent = 'Unavailable';
    recipeBody.querySelector('[data-retry-recipe]').onclick = () => { recipeBody.innerHTML = '<p class="pe-loading" role="status">Loading ingredients…</p>'; reloadCatalog().then(() => { if (state.recipe) startDraft(state.recipe); drawRecipe(); }).catch(() => { recipeBody.innerHTML = '<p class="form-error">Unable to load ingredients.</p>'; }); };
  });

  // ------------------------------------------------------------------ validation + save
  const showError = (problems) => { errorBox.innerHTML = problems.map(e).join('<br>'); errorBox.hidden = false; errorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  const validate = () => {
    const problems = [], open = (key) => { form.querySelector(`[data-section="${key}"]`).open = true; };
    form.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
    if (!form.elements.name.value.trim()) { problems.push('Enter the product name.'); form.elements.name.setAttribute('aria-invalid', 'true'); open('info'); }
    const labels = new Set();
    state.variants.forEach((v) => {
      const row = form.querySelector(`[data-variant="${CSS.escape(v.id)}"]`);
      if (!String(v.label).trim()) { problems.push('Every size needs a name.'); row?.querySelector('[data-v="label"]').setAttribute('aria-invalid', 'true'); open('sizes'); }
      else if (labels.has(String(v.label).trim().toLowerCase())) { problems.push(`Two sizes are called “${v.label}”.`); row?.querySelector('[data-v="label"]').setAttribute('aria-invalid', 'true'); open('sizes'); }
      labels.add(String(v.label).trim().toLowerCase());
      if (v.price === '' || !(Number(v.price) >= 0) || Number(v.price) > 1000000) { problems.push(`Enter a valid price for ${v.label || 'each size'}.`); row?.querySelector('[data-v="price"]').setAttribute('aria-invalid', 'true'); open('sizes'); }
    });
    if (state.editing !== null) { problems.push('Finish the ingredient you are editing (press Done or Cancel).'); open('recipe'); }
    if (state.draft && state.recipeDirty) {
      readSettings();
      const lines = state.draft.lines;
      if (!lines.length) problems.push('Add at least one ingredient, or remove the recipe changes.');
      lines.forEach((l, i) => { const p = lineProblem(i); if (p) problems.push(`Ingredient ${i + 1}: ${p}`); });
      if (!(state.draft.batch_yield > 0)) problems.push('“One batch makes” must be greater than zero.');
      Object.values(state.draft.variant_units).forEach((u) => { if (u != null && !(u >= 0)) problems.push('Pieces per size must be 0 or more.'); });
      if (problems.length) open('recipe');
    }
    return [...new Set(problems)];
  };

  form.addEventListener('input', (event) => { if (event.target.name === 'name' || event.target.name === 'category_id') summarize(); });
  form.addEventListener('change', (event) => { if (event.target.name === 'category_id') summarize(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.saving) return;
    errorBox.hidden = true;
    const problems = validate();
    if (problems.length) { showError(problems); say('Fix the highlighted fields.', 'bad'); return; }
    const saveButton = form.querySelector('[data-save]');
    state.saving = true; saveButton.disabled = true; saveButton.textContent = 'Saving…';
    let stage = 'product';
    try {
      say('Saving product…');
      const file = fileInput.files[0];
      const image_path = file ? await db.upload('catalog-media', 'products/' + productId, file) : product?.image_path || null;
      await db.rpc('save_product', { payload: {
        id: productId, name: form.elements.name.value.trim(), description: form.elements.description.value.trim(), category_id: form.elements.category_id.value || null,
        kind, slug: product?.slug || 'product-' + productId, image_path,
        package_contents: kind === 'package' ? form.elements.contents.value.split('\n').map((x) => x.trim()).filter(Boolean) : product?.package_contents || null,
        variants: state.variants.map((v, i) => ({ id: v.id, code: v.code, label: String(v.label).trim(), price: Number(Number(v.price).toFixed(2)), is_active: true, sort_order: i }))
      } });
      state.productSaved = true;
      let recipeNote = '';
      if (state.draft && state.recipeDirty) {
        stage = 'recipe'; say('Saving recipe…');
        const liveIds = new Set(state.variants.map((v) => v.id));
        const payload = { recipe_key: state.draft.recipe_key, product_id: productId, name: state.draft.name || form.elements.name.value.trim(), batch_yield: state.draft.batch_yield,
          yield_unit: state.draft.yield_unit || 'pcs', scaling_mode: state.draft.scaling_mode, notes: state.draft.notes, review_notes: state.draft.review_notes,
          variant_units: Object.entries(state.draft.variant_units).filter(([id, u]) => liveIds.has(id) && u > 0).map(([variant_id, units]) => ({ variant_id, units })),
          lines: state.draft.lines.map((l) => ({ ...l, quantity: Number(l.quantity) })) };
        try {
          const saved = await db.rpc('save_recipe', { payload: { ...payload, activate: state.activate } });
          recipeNote = state.activate ? ` Recipe v${saved.version} is active.` : ` Recipe saved as draft v${saved.version}.`;
        } catch (error) {
          if (!state.activate) throw error;
          // Activation failed (e.g. a unit conversion is not verified yet): keep the work as a draft.
          const saved = await db.rpc('save_recipe', { payload: { ...payload, activate: false } });
          recipeNote = ` Recipe saved as draft v${saved.version} — not active yet: ${error.message}`;
        }
        state.recipeDirty = false;
      }
      say('Saved', 'ok');
      toast(`${form.elements.name.value.trim()} saved.${recipeNote}`);
      if (recipeNote.includes('not active yet')) { await reloadCatalog(); if (state.recipe) startDraft(state.recipe); drawRecipe(); showError([recipeNote.trim()]); say('Saved — recipe needs attention', 'warn'); onSaved?.({ keepOpen: true }); }
      else { drawer.close(); onSaved?.({}); }
    } catch (error) {
      say(stage === 'recipe' ? 'Product saved — recipe not saved' : 'Error saving changes', 'bad');
      showError([(stage === 'recipe' ? 'The product was saved, but the recipe was not: ' : '') + (error.message || 'Please try again.')]);
      if (stage === 'recipe') onSaved?.({ keepOpen: true });
    } finally { state.saving = false; saveButton.disabled = false; saveButton.textContent = state.productSaved ? 'Save product' : 'Create product'; }
  });
  drawer.addEventListener('close', () => { if (state.photoURL) URL.revokeObjectURL(state.photoURL); });
  drawVariants(); summarize();
  return drawer;
}
