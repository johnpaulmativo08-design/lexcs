-- Phase 58: cake pops are sold per piece. ₱30 each, minimum 12 (12 pcs = ₱360); design options are included in the
-- price. The fixed boxes (12 / 25 / 40 / 60 pcs) are switched off (kept for older orders). The recipe is the same:
-- one "Per piece" option uses 1 unit of the cake pop recipe, so stock is deducted per pop ordered. Safe to re-run.
begin;
insert into public.product_variants (product_id, code, label, price, sort_order, min_qty, is_active)
select p.id, 'piece', 'Per piece', 30, 0, 12, true from public.products p where p.slug = 'cake-pops'
on conflict (product_id, code) do update set price = 30, min_qty = 12, is_active = true, label = 'Per piece';

update public.product_variants v set is_active = false
from public.products p where p.id = v.product_id and p.slug = 'cake-pops' and v.code <> 'piece';

-- same recipe, one pop per unit
insert into public.recipe_variant_units (recipe_id, variant_id, units)
select r.id, v.id, 1 from public.product_recipes r join public.product_variants v on v.product_id = r.product_id and v.code = 'piece'
join public.products p on p.id = r.product_id and p.slug = 'cake-pops'
where r.status = 'active'
on conflict (recipe_id, variant_id) do update set units = 1;

-- every design option is included in the ₱30
update public.design_options o set price = 0 from public.products p where p.id = o.product_id and p.slug = 'cake-pops' and o.price <> 0;
commit;
