// Recipe helpers shared by the product editor (Products → Edit → Recipe) and Inventory → Conversions.
// The database is authoritative (save_recipe / activate_recipe / order deductions); these only drive the UI.
export const FACTORS = { mg: ['mass', 0.001], g: ['mass', 1], kg: ['mass', 1000], mL: ['volume', 1], ml: ['volume', 1], L: ['volume', 1000], l: ['volume', 1000], pcs: ['count', 1], dozen: ['count', 12], cm: ['length', 1], m: ['length', 100], inch: ['length', 2.54], yard: ['length', 91.44] };
export const UNITS = Object.keys(FACTORS).filter((u) => !['ml', 'l'].includes(u));
export const GROUPS = [['ingredient', 'Ingredient'], ['flavor', 'Flavor'], ['topping', 'Topping'], ['packaging', 'Packaging']];
export const BASES = [['per_batch', 'Per batch (scales with pieces ÷ yield)'], ['per_unit', 'Per piece'], ['per_package', 'Per ordered box / size']];
export const BASIS_SHORT = { per_batch: 'per batch', per_unit: 'per piece', per_package: 'per box' };

// Show conversions the natural way round: "1 pcs = 225 g" instead of "1 g = 0.004444 pcs".
export const perStockUnit = (factor) => Number((1 / Number(factor)).toPrecision(5));
export const conversionText = (c, stockUnit) => `1 ${stockUnit} = ${perStockUnit(c.factor).toLocaleString('en-PH', { maximumFractionDigits: 4 })} ${c.unit}`;

// The version an admin should see for a product: its active recipe, else its newest draft.
export function recipeForProduct(catalog, productId) {
  const mine = (catalog?.recipes || []).filter((r) => r.product_id === productId && r.status !== 'archived');
  return mine.find((r) => r.status === 'active') || mine.sort((a, b) => b.version - a.version)[0] || null;
}
export const flaggedLines = (recipe) => (recipe?.lines || []).filter((l) => l.needs_review || !['direct', 'verified'].includes(l.conversion)).length;

export function conversionState(catalog, line) {
  const item = catalog.items.find((i) => i.id === line.item_id); if (!item) return 'direct';
  if (line.unit === item.unit) return 'direct';
  const from = FACTORS[line.unit], to = FACTORS[item.unit];
  if (from && to && from[0] === to[0]) return 'direct';
  const matches = catalog.conversions.filter((c) => c.item_id === item.id && FACTORS[c.unit]?.[0] === from?.[0]);
  return matches.some((c) => c.is_verified) ? 'verified' : matches.length ? 'unverified' : 'missing';
}
export function toItemUnit(catalog, value, line) {
  const item = catalog.items.find((i) => i.id === line.item_id); if (!item || !(value > 0)) return null;
  const from = FACTORS[line.unit], to = FACTORS[item.unit];
  if (line.unit === item.unit) return value;
  if (from && to && from[0] === to[0]) return value * from[1] / to[1];
  const c = catalog.conversions.find((x) => x.item_id === item.id && FACTORS[x.unit]?.[0] === from?.[0]);
  return c ? value * from[1] / FACTORS[c.unit][1] * Number(c.factor) : null;
}
// Estimate only (the server recalculates on order confirmation): materials for N pieces.
export function previewRequirements(catalog, draft, pieces) {
  const factor = draft.scaling_mode === 'whole_batch' ? Math.ceil(pieces / draft.batch_yield) : pieces / draft.batch_yield;
  const totals = new Map();
  draft.lines.forEach((line) => {
    const item = catalog.items.find((i) => i.id === line.item_id); if (!item) return;
    let value = toItemUnit(catalog, Number(line.quantity), line);
    if (value == null) { totals.set(item.id + line.unit, { item, missing: true, line }); return; }
    value *= line.basis === 'per_batch' ? factor : line.basis === 'per_unit' ? pieces : 1;
    if (line.rounding === 'whole') value = Math.ceil(value - 1e-9);
    const prev = totals.get(item.id);
    totals.set(item.id, { item, value: (prev?.value || 0) + value, conditional: prev?.conditional || Object.keys(line.condition || {}).length > 0 });
  });
  return [...totals.values()];
}
export function conditionText(cond, variants = []) {
  const parts = [];
  if (cond?.variant_codes?.length) { const labels = variants.filter((v) => cond.variant_codes.includes(v.code)).map((v) => v.label); parts.push(labels.length ? labels.join(', ') : cond.variant_codes.join(', ')); }
  if (cond?.customization) Object.entries(cond.customization).forEach(([k, v]) => parts.push(`${k} = ${[].concat(v).join(' / ')}`));
  return parts.length ? parts.join(' · ') : '';
}
// Two lines for the same material that apply in exactly the same situations would double-deduct.
export const lineKey = (l) => [l.item_id, l.line_group, JSON.stringify(l.condition?.variant_codes || []), JSON.stringify(l.condition?.customization || {})].join('|');
