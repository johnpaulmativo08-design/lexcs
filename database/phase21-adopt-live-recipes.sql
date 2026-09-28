-- Phase 21: adopt the recipe tables that were added directly on the hosted project
-- (inventory_recipe_components / inventory_variant_recipes, deducting on "preparing").
-- Run AFTER phase20-recipe-inventory.sql. Safe to re-run; does nothing where those tables
-- do not exist.
--
-- 1. Switch off the old "preparing" trigger so materials can never be deducted twice.
--    Its tables and functions are kept (unused) for reference.
-- 2. Copy its recipes into the new versioned recipe tables as DRAFTS (Admin activates them).
-- 3. Orders that were already confirmed and paid before automatic deduction existed are
--    marked "not tracked" so they are never deducted retroactively.

drop trigger if exists order_recipe_inventory_on_preparing on public.orders;

do $$
declare
  actor uuid := private.actor_profile();
  p record; v record; lines jsonb; vunits jsonb; single_code boolean;
begin
  if to_regclass('public.inventory_variant_recipes') is null or to_regclass('public.inventory_recipe_components') is null then
    raise notice 'No previous recipe tables found — nothing to import.';
    return;
  end if;
  if actor is null then raise notice 'No Admin profile — import skipped.'; return; end if;

  for p in
    select distinct pr.id, pr.name, pr.kind
    from public.inventory_variant_recipes vr
    join public.product_variants pv on pv.id = vr.variant_id
    join public.products pr on pr.id = pv.product_id
    order by pr.name
  loop
    if exists (select 1 from public.product_recipes where recipe_key = md5('lexc-legacy-recipe:' || p.id::text)::uuid) then continue; end if;

    -- A product whose every option uses exactly one recipe code becomes a per-piece recipe.
    select bool_and(n = 1) and count(distinct code) = 1 into single_code
    from (select vr.variant_id, count(*) as n, min(vr.recipe_code) as code
          from public.inventory_variant_recipes vr join public.product_variants pv on pv.id = vr.variant_id
          where pv.product_id = p.id group by vr.variant_id) s;

    if single_code then
      vunits := (select jsonb_agg(jsonb_build_object('variant_id', vr.variant_id, 'units', vr.pieces_per_variant))
                 from public.inventory_variant_recipes vr join public.product_variants pv on pv.id = vr.variant_id where pv.product_id = p.id);
      lines := (select jsonb_agg(jsonb_build_object(
                  'item_id', rc.item_id, 'quantity', rc.quantity_per_piece, 'unit', i.unit, 'basis', 'per_unit',
                  'line_group', case when i.inventory_type = 'packaging' then 'packaging' else 'ingredient' end,
                  'source_text', 'Previous system · ' || rc.recipe_code || ' · ' || rc.quantity_per_piece || ' ' || i.unit || ' per piece'
                    || coalesce(' · ' || nullif(rc.source_note, ''), '')) order by i.inventory_type, i.name)
               from public.inventory_recipe_components rc join public.inventory_items i on i.id = rc.item_id
               where rc.recipe_code = (select min(vr.recipe_code) from public.inventory_variant_recipes vr join public.product_variants pv on pv.id = vr.variant_id where pv.product_id = p.id)
                 and rc.quantity_per_piece > 0);
    else
      -- Packages (several recipes per option): one line per material per option, totalled per package.
      vunits := (select jsonb_agg(distinct jsonb_build_object('variant_id', vr.variant_id, 'units', 1))
                 from public.inventory_variant_recipes vr join public.product_variants pv on pv.id = vr.variant_id where pv.product_id = p.id);
      lines := (select jsonb_agg(jsonb_build_object(
                  'item_id', x.item_id, 'quantity', x.qty, 'unit', x.unit, 'basis', 'per_package',
                  'line_group', case when x.inventory_type = 'packaging' then 'packaging' else 'ingredient' end,
                  'condition', jsonb_build_object('variant_codes', jsonb_build_array(x.code)),
                  'source_text', 'Previous system · ' || x.parts) order by x.code, x.inventory_type, x.name)
               from (select pv.code, rc.item_id, i.name, i.unit, i.inventory_type,
                            round(sum(vr.pieces_per_variant * rc.quantity_per_piece), 6) as qty,
                            string_agg(vr.recipe_code || ' × ' || vr.pieces_per_variant, ', ' order by vr.recipe_code) as parts
                     from public.inventory_variant_recipes vr
                     join public.product_variants pv on pv.id = vr.variant_id
                     join public.inventory_recipe_components rc on rc.recipe_code = vr.recipe_code
                     join public.inventory_items i on i.id = rc.item_id
                     where pv.product_id = p.id
                     group by pv.code, rc.item_id, i.name, i.unit, i.inventory_type
                     having round(sum(vr.pieces_per_variant * rc.quantity_per_piece), 6) > 0) x);
    end if;
    if lines is null or vunits is null then continue; end if;

    perform private.write_recipe_version(jsonb_build_object(
      'recipe_key', md5('lexc-legacy-recipe:' || p.id::text)::uuid,
      'product_id', p.id,
      'name', p.name || ' (previous system)',
      'batch_yield', 1,
      'yield_unit', 'pcs',
      'notes', 'Imported unchanged from the recipe tables that were already live (amounts are per piece, in each material''s stock unit).',
      'review_notes', 'The previous system had no packaging lines — add boxes/liners/stickers if they should be deducted. Compare with the spreadsheet draft for this product and activate the one you trust.',
      'source', 'Previous live recipe tables',
      'variant_units', vunits,
      'lines', lines), actor);
  end loop;
end $$;

-- Orders already accepted and paid before automatic deduction existed: never deduct retroactively.
insert into public.order_inventory_allocations(order_id, status, trigger_event, attempts, last_attempt_at, untracked)
select o.id, 'not_required', 'Accepted before automatic deduction was enabled — not tracked', 1, now(),
  jsonb_build_array(jsonb_build_object('name', 'Whole order', 'variant', '', 'quantity', '',
    'reason', 'This order was confirmed and paid before automatic deduction existed. Record any materials manually if needed.'))
from public.orders o
where o.status in ('confirmed','preparing','ready','completed') and o.payment_status in ('partially_paid','paid')
on conflict (order_id) do nothing;
