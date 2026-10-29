-- Phase 82 · Tiered cakes: decorate the lower tiers too, and add the Mini 3-Tiered Cake.
--
-- Why: the customer can now choose the bottom tier's own frosting colour, borders and decorations (pearls, ribbon
-- bows, drip, piped flowers and leaves, sprinkles, gold leaf) in the cake designer. The message and topper stay on
-- the top tier.
--
-- What it does:
--   1. private.bento_lower_tier(product, lower) checks the bottom tier's choices against the same design options as
--      the top tier (same rules: available colour, at most max_borders / max_accents, gold or silver pearls, a ribbon
--      colour when bows are chosen) and prices each border / decoration exactly like the top tier.
--   2. private.bento_design (which quote_bento_design and create_order use) calls it only for products whose
--      customization_config.cake_shape is 'tiered' or 'tiered3', and only when the design has a "lower" part. The bottom tier's
--      extras are added to the design's extras (listed as "Bottom tier — …"), kept in the saved design as "lower",
--      and shown in the summary as "Bottom tier: …".
--
--   3. Adds the Mini 3-Tiered Cake (8"×4" bottom, 6"×4" middle, 4"×2" top, from LexC's size guide) in the Bento Cake
--      category, Vanilla or Chocolate, with the bento's design options. It is added HIDDEN (archived) with price ₱0:
--      set the price in Products → Edit product, then show it. Its lower-tier choices go on the bottom and middle tiers.
--
-- What it does NOT do: change the bento or Petite cakes, any price, or existing orders. Designs without a "lower"
-- part are priced exactly as before.
--
-- How to apply: rehearse with database/tests/phase82-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor. Safe to run twice.

create or replace function private.bento_lower_tier(p_product public.products, p_lower jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := p_product.customization_config;
  opt public.design_options;
  extra numeric(12,2) := 0;
  priced jsonb := '[]';
  labels text[] := '{}';
  color_code text := p_lower->>'frosting_color';
  borders jsonb := coalesce(p_lower->'border', '[]');
  accents jsonb := coalesce(p_lower->'accents', '[]');
  bow_color text := nullif(p_lower->>'bow_color', '');
  drip_color text := nullif(p_lower->>'drip_color', '');
  frosting_label text; drip_label text; c text;
begin
  if jsonb_typeof(p_lower) is distinct from 'object' or jsonb_typeof(borders) <> 'array' or jsonb_typeof(accents) <> 'array' then
    raise exception 'Invalid bottom tier design.' using errcode = '22023'; end if;
  select * into opt from public.design_options where product_id = p_product.id and group_key = 'color' and code = color_code and is_active;
  if not found then raise exception 'Choose an available frosting color for the bottom tier.' using errcode = '22023'; end if;
  frosting_label := opt.label;

  if jsonb_array_length(borders) > coalesce((cfg->>'max_borders')::int, 2)
     or (select count(distinct v) from jsonb_array_elements_text(borders) v) <> jsonb_array_length(borders) then
    raise exception 'Invalid border choice for the bottom tier.' using errcode = '22023'; end if;
  for c in select jsonb_array_elements_text(borders) loop
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'border' and code = c and is_active;
    if not found then raise exception 'That border is no longer available.' using errcode = '22023'; end if;
    extra := extra + opt.price; priced := priced || jsonb_build_object('label', 'Bottom tier — ' || opt.label, 'price', opt.price);
    labels := labels || opt.label;
  end loop;

  if jsonb_array_length(accents) > coalesce((cfg->>'max_accents')::int, 6)
     or (select count(distinct v) from jsonb_array_elements_text(accents) v) <> jsonb_array_length(accents) then
    raise exception 'Too many or repeated decorations on the bottom tier.' using errcode = '22023'; end if;
  if accents ? 'drip' and drip_color is not null then
    select label into drip_label from public.design_options where product_id = p_product.id and group_key = 'color' and code = drip_color and is_active;
    if not found then raise exception 'Choose an available drip color for the bottom tier.' using errcode = '22023'; end if;
  else drip_color := null; end if;
  for c in select jsonb_array_elements_text(accents) loop
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'accent' and code = c and is_active;
    if not found then raise exception 'A chosen decoration is no longer available.' using errcode = '22023'; end if;
    extra := extra + opt.price; priced := priced || jsonb_build_object('label', 'Bottom tier — ' || opt.label, 'price', opt.price);
    labels := labels || (opt.label || case when c = 'drip' and drip_label is not null then ' (' || drip_label || ')' else '' end);
  end loop;
  if accents ? 'pearls_gold' and accents ? 'pearls_silver' then raise exception 'Choose gold or silver pearls, not both.' using errcode = '22023'; end if;
  if accents ? 'ribbon_bows' then
    if not exists (select 1 from public.design_options where product_id = p_product.id and group_key = 'color' and code = bow_color and is_active) then
      raise exception 'Choose a ribbon color for the bottom tier.' using errcode = '22023'; end if;
  else bow_color := null; end if;

  return jsonb_build_object(
    'clean', jsonb_build_object('frosting_color', color_code, 'frosting_color_label', frosting_label, 'border', borders, 'accents', accents,
                                'bow_color', bow_color, 'drip_color', drip_color, 'extras_per_item', extra),
    'extra', extra, 'priced', priced,
    'summary', frosting_label || ' frosting' || case when cardinality(labels) > 0 then ', ' || array_to_string(labels, ', ') else '' end);
end $$;
revoke all on function private.bento_lower_tier(public.products, jsonb) from public;

-- Call it from bento_design for Mini Tiered cakes (in-place patch of the live function, with exact-match guards).
do $$
declare def text;
  a1 text := '  clean jsonb;';
  b1 text := '  clean jsonb; lower_design jsonb;';
  a2 text := '  clean := jsonb_build_object(';
  b2 text := '  -- bottom tier of a Mini Tiered cake (phase 82): its own frosting, borders and decorations, priced like the top
  if cfg->>''cake_shape'' in (''tiered'', ''tiered3'') and jsonb_typeof(custom->''lower'') = ''object'' then
    lower_design := private.bento_lower_tier(p_product, custom->''lower'');
    extra := extra + (lower_design->>''extra'')::numeric;
    priced := priced || (lower_design->''priced'');
    parts := parts || (''Bottom tier: '' || (lower_design->>''summary''));
  end if;

  clean := jsonb_build_object(';
  a3 text := '''topper'', topper, ''topper_text'', topper_text,';
  b3 text := '''topper'', topper, ''topper_text'', topper_text, ''lower'', lower_design->''clean'',';
  n int;
begin
  def := pg_get_functiondef('private.bento_design(public.products,jsonb)'::regprocedure);
  if position('lower_design' in def) > 0 then raise notice 'bento_design already handles the bottom tier.'; return; end if;
  foreach n in array array[
      (length(def) - length(replace(def, a1, ''))) / length(a1),
      (length(def) - length(replace(def, a2, ''))) / length(a2),
      (length(def) - length(replace(def, a3, ''))) / length(a3)] loop
    if n <> 1 then raise exception 'private.bento_design is not the expected version; review before applying phase 82.'; end if;
  end loop;
  execute replace(replace(replace(def, a1, b1), a2, b2), a3, b3);
end $$;

-- The Mini 3-Tiered Cake (hidden until LexC's sets its price)
do $$
declare bento public.products; pid uuid;
begin
  select * into bento from public.products where customization_config->>'designer' = 'bento' and slug = 'product-8';
  if bento.id is null then raise exception 'The bento product was not found; review before applying phase 82.'; end if;
  insert into public.products (slug, name, description, kind, status, category_id, emoji, customization_config, sort_order)
  values ('mini-3-tiered-cake', 'Mini 3-Tiered Cake', 'Three tiers: 8" × 4", 6" × 4" and 4" × 2" · design it like a bento', 'standard', 'archived',
          bento.category_id, '🎂', coalesce(bento.customization_config, '{}'::jsonb) || jsonb_build_object('cake_shape', 'tiered3'), coalesce(bento.sort_order, 0) + 3)
  on conflict (slug) do nothing;
  select id into pid from public.products where slug = 'mini-3-tiered-cake';
  insert into public.product_variants (product_id, code, label, price, min_qty, is_active, sort_order)
  values (pid, '8x4_vanilla', '8x4 Vanilla', 0, 1, true, 0), (pid, '8x4_chocolate', '8x4 Chocolate', 0, 1, true, 1)
  on conflict (product_id, code) do nothing;
  insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
  select pid, o.group_key, o.code, o.label, o.price, o.hex, o.sort_order, o.is_active from public.design_options o where o.product_id = bento.id
  on conflict (product_id, group_key, code) do nothing;
end $$;

notify pgrst, 'reload schema';
