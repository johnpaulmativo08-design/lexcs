-- Phase 82 rehearsal · tests lower-tier decorations and the Mini 3-Tiered Cake WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It applies phase 82 (twice, to prove it is safe to re-run),
-- then prices designs with quote_bento_design: the same top design on bento / Petite / Mini Tiered without a bottom
-- tier (must be unchanged), a Mini Tiered design with bottom-tier decorations (extras added, saved as "lower"), a
-- bottom tier on a Petite (ignored), and bad bottom-tier choices (refused). It also places a pretend Mini Tiered order.
-- It ends with an error on purpose: that cancels the whole transaction, so nothing is saved.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

-- ===== phase 82 (run twice) =====
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


do $rehearsal$
declare
  bento uuid; petite uuid; tiered uuid; customer_id uuid; v public.product_variants; slot_id uuid; method text; res jsonb; ord public.orders;
  q0 jsonb; q1 jsonb; q2 jsonb; q3 jsonb; report text := ''; ok boolean;
  top jsonb := '{"designer":"bento","frosting_color":"pink","border":["shell_top"],"accents":["pearls_gold"],"message":"","topper":"none","layout":{}}';
  low jsonb := '{"frosting_color":"white","border":["shell_bottom"],"accents":["ribbon_bows","piped_flowers"],"bow_color":"pink"}';
begin
  select id into bento from public.products where slug = 'product-8';
  select id into petite from public.products where slug = 'petite-cake';
  select id into tiered from public.products where slug = 'mini-tiered-cake';
  q0 := public.quote_bento_design(bento, top);
  q1 := public.quote_bento_design(tiered, top);
  report := report || E'\n' || case when (q0->>'extra') = (q1->>'extra') and q1->'clean'->'lower' = 'null'::jsonb then 'PASS' else 'FAIL' end || '  no bottom tier: same price as before (' || (q1->>'extra') || ')';
  q2 := public.quote_bento_design(tiered, top || jsonb_build_object('lower', low));
  ok := (q2->>'extra')::numeric > (q1->>'extra')::numeric and q2->'clean'->'lower'->>'frosting_color' = 'white'
        and q2->'clean'->>'summary' like '%Bottom tier: %' and exists (select 1 from jsonb_array_elements(q2->'clean'->'extras') x where x->>'label' like 'Bottom tier — %');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  bottom tier priced and saved: extra ' || (q1->>'extra') || ' → ' || (q2->>'extra');
  report := report || E'\nINFO  summary: ' || (q2->'clean'->>'summary');
  q3 := public.quote_bento_design(petite, top || jsonb_build_object('lower', low));
  report := report || E'\n' || case when (q3->>'extra') = (q1->>'extra') and q3->'clean'->'lower' = 'null'::jsonb then 'PASS' else 'FAIL' end || '  a bottom tier on the Petite is ignored';
  begin perform public.quote_bento_design(tiered, top || jsonb_build_object('lower', '{"frosting_color":"white","accents":["ribbon_bows"]}'::jsonb)); report := report || E'\nFAIL  bows without a ribbon color accepted';
  exception when others then report := report || E'\nPASS  bottom tier rules apply: ' || sqlerrm; end;
  begin perform public.quote_bento_design(tiered, top || jsonb_build_object('lower', '{"frosting_color":"white","accents":["pearls_gold","pearls_silver"]}'::jsonb)); report := report || E'\nFAIL  gold and silver pearls accepted';
  exception when others then report := report || E'\nPASS  gold or silver pearls only'; end;
  begin perform public.quote_bento_design(tiered, top || jsonb_build_object('lower', '{"frosting_color":"no_such_color"}'::jsonb)); report := report || E'\nFAIL  unknown color accepted';
  exception when others then report := report || E'\nPASS  unknown bottom color refused'; end;

  -- the Mini 3-Tiered Cake: added hidden; once shown, its lower-tier choices are priced too
  ok := (select status from public.products where slug = 'mini-3-tiered-cake') = 'archived'
        and (select count(*) from public.product_variants pv join public.products pp on pp.id = pv.product_id where pp.slug = 'mini-3-tiered-cake') = 2
        and (select count(*) from public.design_options o join public.products pp on pp.id = o.product_id where pp.slug = 'mini-3-tiered-cake') = (select count(*) from public.design_options where product_id = bento);
  report := report || E'
' || case when ok then 'PASS' else 'FAIL' end || '  Mini 3-Tiered Cake added hidden with 2 sizes and the bento options';
  update public.products set status = 'active' where slug = 'mini-3-tiered-cake';
  q3 := public.quote_bento_design((select id from public.products where slug = 'mini-3-tiered-cake'), top || jsonb_build_object('lower', low));
  report := report || E'
' || case when (q3->>'extra') = (q2->>'extra') then 'PASS' else 'FAIL' end || '  3-tier lower tiers priced like the 2-tier (' || (q3->>'extra') || ')';

  select u.id into customer_id from auth.users u join public.profiles pr on pr.id = u.id left join public.user_roles r on r.user_id = u.id
   where coalesce(r.role, 'customer') = 'customer' and u.email_confirmed_at is not null order by u.created_at limit 1;
  select * into v from public.product_variants where product_id = tiered and code = '6x4_vanilla';
  select s.id into slot_id from public.availability_slots s where s.is_open and s.starts_at > now() + interval '2 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity order by s.starts_at limit 1;
  select pm.code into method from public.payment_methods pm where pm.active order by pm.code limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  res := public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Rehearsal', 'phone', '09171234567', 'fulfillment', 'pickup',
    'slot_id', slot_id, 'notes', 'phase 82 rehearsal', 'payment_method', method,
    'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1, 'customization', top || jsonb_build_object('lower', low)))));
  perform set_config('role', 'postgres', true);
  select * into ord from public.orders where id = (res->>'id')::uuid;
  ok := ord.customization_total = (q2->>'extra')::numeric and exists (select 1 from public.order_items oi where oi.order_id = ord.id and oi.customization->'lower'->>'frosting_color' = 'white');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  Mini Tiered order: items ' || ord.items_subtotal || ' + design ' || ord.customization_total || ' (bottom tier saved on the order line)';

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
