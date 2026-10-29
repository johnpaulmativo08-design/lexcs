-- Phase 84 rehearsal · Mocha/Ube, the Mini Tiered 8x4 3-tier and the middle tier WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It applies phase 84 twice (the second run must change
-- nothing), checks the new sizes, prices a 3-tier design with a middle tier, and places a pretend 8x4 Ube order with
-- all three tiers decorated, then checks Start making would deduct it. It ends with an error on purpose so nothing
-- is saved.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

-- ===== phase 84 (run twice) =====
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


do $rehearsal$
declare
  tiered uuid; customer_id uuid; v public.product_variants; slot_id uuid; method text; res jsonb; ord public.orders; req jsonb;
  q1 jsonb; q2 jsonb; report text := ''; ok boolean; bad text;
  top jsonb := '{"designer":"bento","frosting_color":"pink","border":["shell_top"],"accents":["pearls_gold"],"message":"","topper":"none","layout":{}}';
  low jsonb := '{"frosting_color":"white","border":["shell_bottom"],"accents":["ribbon_bows"],"bow_color":"pink"}';
  mid jsonb := '{"frosting_color":"lavender","border":["shell_bottom"],"accents":["piped_flowers"]}';
begin
  select id into tiered from public.products where slug = 'mini-tiered-cake';
  -- every chocolate size has a Mocha and an Ube at the same price
  select string_agg(p.slug || ':' || c.code, ', ') into bad
    from public.products p join public.product_variants c on c.product_id = p.id and (c.code like '%\_chocolate' or (p.slug = 'product-8' and c.label = 'Chocolate'))
   where p.slug in ('product-8', 'petite-cake', 'mini-tiered-cake')
     and (select count(*) from public.product_variants f where f.product_id = p.id and f.is_active and f.price = c.price
           and f.code in (regexp_replace(c.code, 'chocolate$|option-2$', '') || 'mocha', regexp_replace(c.code, 'chocolate$|option-2$', '') || 'ube')) <> 2;
  report := report || E'\n' || case when bad is null then 'PASS' else 'FAIL' end || '  Mocha and Ube in every size at the Chocolate price' || coalesce(' — missing: ' || bad, '');
  report := report || E'\nINFO  bento flavours: ' || (select string_agg(label || ' ' || price, ', ' order by sort_order) from public.product_variants where product_id = (select id from public.products where slug = 'product-8') and is_active);
  report := report || E'\nINFO  Mini Tiered: ' || (select string_agg(label || ' ' || price, ', ' order by sort_order) from public.product_variants where product_id = tiered and is_active);
  ok := (select count(*) from public.product_variants where product_id = tiered and code like '8x4\_%' and is_active and price = 3000) = 4
    and not exists (select 1 from public.product_variants v2 join public.products p on p.id = v2.product_id where p.slug = 'mini-3-tiered-cake' and v2.is_active);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  Mini Tiered 8x4 (3 tiers) in 4 flavours at 3000; old Mini 3-Tiered sizes off';
  select string_agg(p.slug || ':' || v2.code, ', ') into bad from public.products p join public.product_variants v2 on v2.product_id = p.id and v2.is_active
    join public.product_recipes r on r.product_id = p.id and r.status = 'active'
   where p.slug in ('product-8', 'petite-cake', 'mini-tiered-cake') and not exists (select 1 from public.recipe_variant_units u where u.recipe_id = r.id and u.variant_id = v2.id);
  report := report || E'\n' || case when bad is null then 'PASS' else 'FAIL' end || '  every size counted in its recipe' || coalesce(' — missing: ' || bad, '');

  q1 := public.quote_bento_design(tiered, top || jsonb_build_object('lower', low));
  q2 := public.quote_bento_design(tiered, top || jsonb_build_object('lower', low, 'middle', mid));
  ok := (q2->>'extra')::numeric > (q1->>'extra')::numeric and q2->'clean'->'middle'->>'frosting_color' = 'lavender'
    and q2->'clean'->>'summary' like '%Middle tier: %' and exists (select 1 from jsonb_array_elements(q2->'clean'->'extras') x where x->>'label' like 'Middle tier — %');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  middle tier priced and saved: extra ' || (q1->>'extra') || ' → ' || (q2->>'extra');
  report := report || E'\nINFO  summary: ' || (q2->'clean'->>'summary');
  begin perform public.quote_bento_design(tiered, top || jsonb_build_object('middle', '{"frosting_color":"white","accents":["ribbon_bows"]}'::jsonb)); report := report || E'\nFAIL  middle bows without a ribbon color accepted';
  exception when others then report := report || E'\nPASS  middle tier rules apply: ' || sqlerrm; end;

  select u.id into customer_id from auth.users u join public.profiles pr on pr.id = u.id left join public.user_roles r on r.user_id = u.id
   where coalesce(r.role, 'customer') = 'customer' and u.email_confirmed_at is not null order by u.created_at limit 1;
  select * into v from public.product_variants where product_id = tiered and code = '8x4_ube';
  select s.id into slot_id from public.availability_slots s where s.is_open and s.starts_at > now() + interval '2 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity order by s.starts_at limit 1;
  select pm.code into method from public.payment_methods pm where pm.active order by pm.code limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  res := public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Rehearsal', 'phone', '09171234567', 'fulfillment', 'pickup',
    'slot_id', slot_id, 'notes', 'phase 84 rehearsal', 'payment_method', method,
    'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1, 'customization', top || jsonb_build_object('lower', low, 'middle', mid)))));
  perform set_config('role', 'postgres', true);
  select * into ord from public.orders where id = (res->>'id')::uuid;
  ok := ord.items_subtotal = 3000 and ord.customization_total = (q2->>'extra')::numeric
    and exists (select 1 from public.order_items oi where oi.order_id = ord.id and oi.customization->'middle'->>'frosting_color' = 'lavender');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  8x4 Ube 3-tier order: items ' || ord.items_subtotal || ' + design ' || ord.customization_total || ' (middle tier saved)';
  req := private.order_requirements(ord.id);
  ok := jsonb_array_length(coalesce(req->'untracked', '[]')) = 0 and jsonb_array_length(coalesce(req->'lines', '[]')) > 0;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  Start making would deduct it: ' || jsonb_array_length(coalesce(req->'lines', '[]')) || ' material lines, untracked ' || coalesce(req->'untracked', '[]')::text;

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
