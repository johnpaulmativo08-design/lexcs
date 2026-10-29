-- Phase 84 · Mocha and Ube flavours, the 3-tier size inside Mini Tiered Cake, and a decoratable middle tier.
--
-- Why: the cake designer now starts with the cake's layers (sponge + filling; the flavour is the filling), LexC's adds
-- two flavours, and the Mini 3-Tiered Cake becomes the 8x4 size of the Mini Tiered Cake with all three tiers editable.
--
-- What it does:
--   1. Adds Mocha and Ube to the bento, the Petite Cake and the Mini Tiered Cake, in every size, priced the same as
--      Chocolate in that size (change any price in Admin → Products).
--   2. Adds the 8x4 size to the Mini Tiered Cake: the 3-tier cake (8"×4" + 6"×4" + 4"×2") in Vanilla, Chocolate,
--      Mocha and Ube at ₱3,000. The separate Mini 3-Tiered Cake (phase 82, never shown) stays archived and its sizes
--      are switched off.
--   3. Every new size counts as one cake in that product's active recipe (same as the other sizes), so Start making
--      deducts it like the rest. Flavour-only recipe lines (e.g. the dark chocolate for Chocolate) are unchanged.
--   4. private.bento_tier_design(product, tier, name) checks and prices one lower tier's frosting, borders and
--      decorations (same rules as phase 82's bottom tier, with the tier's name in labels and messages), and
--      private.bento_design prices a "middle" part like the bottom one ("Middle tier — …", saved as "middle").
--
-- What it does NOT do: change existing prices, orders, stock, or the bento / Petite / Mini Tiered designs without a
-- middle tier. Sizes are matched by their codes ("6x4_chocolate"); the bento's Chocolate is the variant labelled Chocolate.
--
-- How to apply: rehearse with database/tests/phase84-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor. Safe to run twice.

-- 1–3. Flavours, the 3-tier size, recipe units
do $$
declare p public.products; choc record; base text; n int;
begin
  for p in select * from public.products where slug in ('product-8', 'petite-cake', 'mini-tiered-cake') loop
    for choc in select * from public.product_variants where product_id = p.id
                 and (code like '%\_chocolate' or (p.slug = 'product-8' and label = 'Chocolate')) loop
      base := case when p.slug = 'product-8' then '' else split_part(choc.code, '_', 1) end;   -- '' or '6x4'
      insert into public.product_variants (product_id, code, label, price, min_qty, is_active, sort_order)
      values (p.id, coalesce(nullif(base, '') || '_', '') || 'mocha', ltrim(base || ' Mocha'), choc.price, choc.min_qty, true, choc.sort_order),
             (p.id, coalesce(nullif(base, '') || '_', '') || 'ube', ltrim(base || ' Ube'), choc.price, choc.min_qty, true, choc.sort_order)
      on conflict (product_id, code) do nothing;
    end loop;
    if p.slug = 'mini-tiered-cake' then
      insert into public.product_variants (product_id, code, label, price, min_qty, is_active, sort_order)
      values (p.id, '8x4_vanilla', '8x4 Vanilla', 3000, 1, true, 0), (p.id, '8x4_chocolate', '8x4 Chocolate', 3000, 1, true, 0),
             (p.id, '8x4_mocha', '8x4 Mocha', 3000, 1, true, 0), (p.id, '8x4_ube', '8x4 Ube', 3000, 1, true, 0)
      on conflict (product_id, code) do nothing;
    end if;
    -- order: size, then Vanilla, Chocolate, Mocha, Ube
    update public.product_variants v set sort_order = o.rn
      from (select id, (row_number() over (order by coalesce((regexp_match(code, '^(\d+)x'))[1]::int, 0),
              case when code ~ 'vanilla$' or label in ('Minimalist', 'Vanilla') then 0 when code ~ 'chocolate$' or label = 'Chocolate' then 1
                   when code ~ 'mocha$' then 2 when code ~ 'ube$' then 3 else 4 end, code))::int - 1 as rn
            from public.product_variants where product_id = p.id) o
     where v.id = o.id and v.sort_order is distinct from o.rn;
    -- every size is one cake in the active recipe
    insert into public.recipe_variant_units (recipe_id, variant_id, units)
    select r.id, v.id, 1 from public.product_recipes r join public.product_variants v on v.product_id = r.product_id
     where r.product_id = p.id and r.status = 'active'
    on conflict (recipe_id, variant_id) do nothing;
  end loop;
  -- the separate Mini 3-Tiered Cake is now the Mini Tiered 8x4
  update public.product_variants set is_active = false
   where is_active and product_id = (select id from public.products where slug = 'mini-3-tiered-cake');
  update public.products set status = 'archived' where slug = 'mini-3-tiered-cake' and status <> 'archived';
end $$;

-- 4. One lower tier of a Mini Tiered cake, priced like the top (p_name: 'Middle tier' / 'Bottom tier')
create or replace function private.bento_tier_design(p_product public.products, p_tier jsonb, p_name text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := p_product.customization_config;
  opt public.design_options;
  extra numeric(12,2) := 0;
  priced jsonb := '[]';
  labels text[] := '{}';
  color_code text := p_tier->>'frosting_color';
  borders jsonb := coalesce(p_tier->'border', '[]');
  accents jsonb := coalesce(p_tier->'accents', '[]');
  bow_color text := nullif(p_tier->>'bow_color', '');
  drip_color text := nullif(p_tier->>'drip_color', '');
  lname text := lower(p_name);
  frosting_label text; drip_label text; c text;
begin
  if jsonb_typeof(p_tier) is distinct from 'object' or jsonb_typeof(borders) <> 'array' or jsonb_typeof(accents) <> 'array' then
    raise exception 'Invalid % design.', lname using errcode = '22023'; end if;
  select * into opt from public.design_options where product_id = p_product.id and group_key = 'color' and code = color_code and is_active;
  if not found then raise exception 'Choose an available frosting color for the %.', lname using errcode = '22023'; end if;
  frosting_label := opt.label;

  if jsonb_array_length(borders) > coalesce((cfg->>'max_borders')::int, 2)
     or (select count(distinct v) from jsonb_array_elements_text(borders) v) <> jsonb_array_length(borders) then
    raise exception 'Invalid border choice for the %.', lname using errcode = '22023'; end if;
  for c in select jsonb_array_elements_text(borders) loop
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'border' and code = c and is_active;
    if not found then raise exception 'That border is no longer available.' using errcode = '22023'; end if;
    extra := extra + opt.price; priced := priced || jsonb_build_object('label', p_name || ' — ' || opt.label, 'price', opt.price);
    labels := labels || opt.label;
  end loop;

  if jsonb_array_length(accents) > coalesce((cfg->>'max_accents')::int, 6)
     or (select count(distinct v) from jsonb_array_elements_text(accents) v) <> jsonb_array_length(accents) then
    raise exception 'Too many or repeated decorations on the %.', lname using errcode = '22023'; end if;
  if accents ? 'drip' and drip_color is not null then
    select label into drip_label from public.design_options where product_id = p_product.id and group_key = 'color' and code = drip_color and is_active;
    if not found then raise exception 'Choose an available drip color for the %.', lname using errcode = '22023'; end if;
  else drip_color := null; end if;
  for c in select jsonb_array_elements_text(accents) loop
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'accent' and code = c and is_active;
    if not found then raise exception 'A chosen decoration is no longer available.' using errcode = '22023'; end if;
    extra := extra + opt.price; priced := priced || jsonb_build_object('label', p_name || ' — ' || opt.label, 'price', opt.price);
    labels := labels || (opt.label || case when c = 'drip' and drip_label is not null then ' (' || drip_label || ')' else '' end);
  end loop;
  if accents ? 'pearls_gold' and accents ? 'pearls_silver' then raise exception 'Choose gold or silver pearls, not both.' using errcode = '22023'; end if;
  if accents ? 'ribbon_bows' then
    if not exists (select 1 from public.design_options where product_id = p_product.id and group_key = 'color' and code = bow_color and is_active) then
      raise exception 'Choose a ribbon color for the %.', lname using errcode = '22023'; end if;
  else bow_color := null; end if;

  return jsonb_build_object(
    'clean', jsonb_build_object('frosting_color', color_code, 'frosting_color_label', frosting_label, 'border', borders, 'accents', accents,
                                'bow_color', bow_color, 'drip_color', drip_color, 'extras_per_item', extra),
    'extra', extra, 'priced', priced,
    'summary', frosting_label || ' frosting' || case when cardinality(labels) > 0 then ', ' || array_to_string(labels, ', ') else '' end);
end $$;
revoke all on function private.bento_tier_design(public.products, jsonb, text) from public;

-- bento_design: price the middle tier too (in-place patch of the live function, with exact-match guards)
do $$
declare def text;
  a1 text := '  clean jsonb; lower_design jsonb;';
  b1 text := '  clean jsonb; lower_design jsonb; middle_design jsonb;';
  a2 text := '    parts := parts || (''Bottom tier: '' || (lower_design->>''summary''));
  end if;
';
  b2 text := '    parts := parts || (''Bottom tier: '' || (lower_design->>''summary''));
  end if;
  -- middle tier of the 3-tier Mini Tiered cake (phase 84)
  if cfg->>''cake_shape'' in (''tiered'', ''tiered3'') and jsonb_typeof(custom->''middle'') = ''object'' then
    middle_design := private.bento_tier_design(p_product, custom->''middle'', ''Middle tier'');
    extra := extra + (middle_design->>''extra'')::numeric;
    priced := priced || (middle_design->''priced'');
    parts := parts || (''Middle tier: '' || (middle_design->>''summary''));
  end if;
';
  a3 text := '''lower'', lower_design->''clean'',';
  b3 text := '''lower'', lower_design->''clean'', ''middle'', middle_design->''clean'',';
  n int;
begin
  def := pg_get_functiondef('private.bento_design(public.products,jsonb)'::regprocedure);
  if position('middle_design' in def) > 0 then raise notice 'bento_design already handles the middle tier.'; return; end if;
  foreach n in array array[
      (length(def) - length(replace(def, a1, ''))) / length(a1),
      (length(def) - length(replace(def, a2, ''))) / length(a2),
      (length(def) - length(replace(def, a3, ''))) / length(a3)] loop
    if n <> 1 then raise exception 'private.bento_design is not the expected version (phase 82 first); review before applying phase 84.'; end if;
  end loop;
  execute replace(replace(replace(def, a1, b1), a2, b2), a3, b3);
end $$;

notify pgrst, 'reload schema';
