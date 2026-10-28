-- Phase 81 · Two new designable cakes next to the bento: Petite Cake and Mini Tiered Cake.
--
-- Why: LexC's now bakes bigger cakes. The bento stays 4" wide × 2" tall. The new cakes (width × height, inches):
--     Petite Cake       4x4 ₱799 · 6x4 ₱1,500 · 8x4 ₱2,500
--     Mini Tiered Cake  4x4 ₱2,500 · 6x4 ₱2,500   (two 2"-tall tiers; the size is the bottom tier's width)
--   Each size comes in Vanilla or Chocolate at the same price.
--
-- What it does:
--   1. Adds both products in the Bento Cake category, using the bento designer (customization_config.designer =
--      'bento', plus cake_shape 'petite' or 'tiered' so the 3D preview draws the right cake).
--   2. Adds their sizes as variants: code like 6x4_vanilla, label like "6x4 Vanilla".
--   3. Copies the bento's design options (frosting colours, borders, decorations, toppers, fonts) with the same
--      prices, so decorations cost the same on every size. The server already prices and checks every design
--      against the product it belongs to (quote_bento_design / create_order), so nothing else changes there.
--
-- What it does NOT do: change the bento, its prices or options, existing orders, recipes or inventory. The new cakes
-- have no photo or recipe yet — add them in Products → Edit product. Until a recipe exists, their order lines are
-- listed as "no active recipe" for manual stock (as for any product without one).
--
-- How to apply: rehearse with database/tests/phase81-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor. Safe to run twice (existing rows are left alone).

do $$
declare
  bento public.products;
  cake record;
  size record;
  pid uuid;
begin
  select * into bento from public.products where customization_config->>'designer' = 'bento' and slug = 'product-8';
  if bento.id is null then raise exception 'The bento product was not found; review before applying phase 81.'; end if;

  for cake in select * from (values
      ('petite-cake', 'Petite Cake', 'petite', 'Tall single-tier cake, 4" tall · design it like a bento', 1),
      ('mini-tiered-cake', 'Mini Tiered Cake', 'tiered', 'Two small tiers, 4" tall in all · design it like a bento', 2)
    ) as t(slug, name, shape, description, sort_offset)
  loop
    insert into public.products (slug, name, description, kind, status, category_id, emoji, customization_config, sort_order)
    values (cake.slug, cake.name, cake.description, 'standard', 'active', bento.category_id, '🎂',
            coalesce(bento.customization_config, '{}'::jsonb) || jsonb_build_object('cake_shape', cake.shape),
            coalesce(bento.sort_order, 0) + cake.sort_offset)
    on conflict (slug) do nothing;
    select id into pid from public.products where slug = cake.slug;

    for size in select * from (values
        ('petite', '4x4', 799, 0), ('petite', '6x4', 1500, 1), ('petite', '8x4', 2500, 2),
        ('tiered', '4x4', 2500, 0), ('tiered', '6x4', 2500, 1)
      ) as s(shape, dims, price, rank) where s.shape = cake.shape
    loop
      insert into public.product_variants (product_id, code, label, price, min_qty, is_active, sort_order)
      values (pid, size.dims || '_vanilla', size.dims || ' Vanilla', size.price, 1, true, size.rank * 2),
             (pid, size.dims || '_chocolate', size.dims || ' Chocolate', size.price, 1, true, size.rank * 2 + 1)
      on conflict (product_id, code) do nothing;
    end loop;

    insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
    select pid, o.group_key, o.code, o.label, o.price, o.hex, o.sort_order, o.is_active
      from public.design_options o where o.product_id = bento.id
    on conflict (product_id, group_key, code) do nothing;
  end loop;
end $$;

notify pgrst, 'reload schema';
