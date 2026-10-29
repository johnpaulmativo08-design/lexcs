-- Phase 85 rehearsal · shell border colours WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It applies phase 85 twice (the second run must change
-- nothing), then prices designs with and without a shell colour on the bento and on each Mini Tiered tier.
-- It ends with an error on purpose so nothing is saved.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

-- ===== phase 85 (run twice) =====
-- 1. Top tier / single cake
do $$
declare def text;
  a1 text := '  drip_color text := nullif(custom->>''drip_color'', ''''); drip_label text;';
  b1 text := '  drip_color text := nullif(custom->>''drip_color'', ''''); drip_label text; shell_color text := nullif(custom->>''shell_color'', ''''); shell_label text;';
  a2 text := '    flags := flags || jsonb_build_object(''border_'' || c, ''yes''); labels := labels || opt.label;
  end loop;
';
  b2 text := '    flags := flags || jsonb_build_object(''border_'' || c, ''yes''); labels := labels || opt.label;
  end loop;
  -- shell colour (phase 85, free): the piped shells can differ from the frosting
  if jsonb_array_length(borders) > 0 and shell_color is not null then
    select label into shell_label from public.design_options where product_id = p_product.id and group_key = ''color'' and code = shell_color and is_active;
    if not found then raise exception ''Choose an available shell color.'' using errcode = ''22023''; end if;
    labels := labels || (shell_label || '' shells'');
  else shell_color := null; end if;
';
  a3 text := '''drip_color'', drip_color, ''font'', font,';
  b3 text := '''drip_color'', drip_color, ''shell_color'', shell_color, ''font'', font,';
  n int;
begin
  def := pg_get_functiondef('private.bento_design(public.products,jsonb)'::regprocedure);
  if position('shell_color' in def) > 0 then raise notice 'bento_design already handles the shell colour.'; return; end if;
  foreach n in array array[
      (length(def) - length(replace(def, a1, ''))) / length(a1),
      (length(def) - length(replace(def, a2, ''))) / length(a2),
      (length(def) - length(replace(def, a3, ''))) / length(a3)] loop
    if n <> 1 then raise exception 'private.bento_design is not the expected version; review before applying phase 85.'; end if;
  end loop;
  execute replace(replace(replace(def, a1, b1), a2, b2), a3, b3);
end $$;

-- 2. Lower tiers (Mini Tiered): one function for the middle and bottom tier
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
  shell_color text := nullif(p_tier->>'shell_color', ''); shell_label text;
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
  if jsonb_array_length(borders) > 0 and shell_color is not null then          -- shell colour (phase 85, free)
    select label into shell_label from public.design_options where product_id = p_product.id and group_key = 'color' and code = shell_color and is_active;
    if not found then raise exception 'Choose an available shell color for the %.', lname using errcode = '22023'; end if;
    labels := labels || (shell_label || ' shells');
  else shell_color := null; end if;

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
                                'bow_color', bow_color, 'drip_color', drip_color, 'shell_color', shell_color, 'extras_per_item', extra),
    'extra', extra, 'priced', priced,
    'summary', frosting_label || ' frosting' || case when cardinality(labels) > 0 then ', ' || array_to_string(labels, ', ') else '' end);
end $$;
revoke all on function private.bento_tier_design(public.products, jsonb, text) from public;

create or replace function private.bento_lower_tier(p_product public.products, p_lower jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.bento_tier_design(p_product, p_lower, 'Bottom tier')
$$;
revoke all on function private.bento_lower_tier(public.products, jsonb) from public;


-- 1. Top tier / single cake
do $$
declare def text;
  a1 text := '  drip_color text := nullif(custom->>''drip_color'', ''''); drip_label text;';
  b1 text := '  drip_color text := nullif(custom->>''drip_color'', ''''); drip_label text; shell_color text := nullif(custom->>''shell_color'', ''''); shell_label text;';
  a2 text := '    flags := flags || jsonb_build_object(''border_'' || c, ''yes''); labels := labels || opt.label;
  end loop;
';
  b2 text := '    flags := flags || jsonb_build_object(''border_'' || c, ''yes''); labels := labels || opt.label;
  end loop;
  -- shell colour (phase 85, free): the piped shells can differ from the frosting
  if jsonb_array_length(borders) > 0 and shell_color is not null then
    select label into shell_label from public.design_options where product_id = p_product.id and group_key = ''color'' and code = shell_color and is_active;
    if not found then raise exception ''Choose an available shell color.'' using errcode = ''22023''; end if;
    labels := labels || (shell_label || '' shells'');
  else shell_color := null; end if;
';
  a3 text := '''drip_color'', drip_color, ''font'', font,';
  b3 text := '''drip_color'', drip_color, ''shell_color'', shell_color, ''font'', font,';
  n int;
begin
  def := pg_get_functiondef('private.bento_design(public.products,jsonb)'::regprocedure);
  if position('shell_color' in def) > 0 then raise notice 'bento_design already handles the shell colour.'; return; end if;
  foreach n in array array[
      (length(def) - length(replace(def, a1, ''))) / length(a1),
      (length(def) - length(replace(def, a2, ''))) / length(a2),
      (length(def) - length(replace(def, a3, ''))) / length(a3)] loop
    if n <> 1 then raise exception 'private.bento_design is not the expected version; review before applying phase 85.'; end if;
  end loop;
  execute replace(replace(replace(def, a1, b1), a2, b2), a3, b3);
end $$;

-- 2. Lower tiers (Mini Tiered): one function for the middle and bottom tier
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
  shell_color text := nullif(p_tier->>'shell_color', ''); shell_label text;
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
  if jsonb_array_length(borders) > 0 and shell_color is not null then          -- shell colour (phase 85, free)
    select label into shell_label from public.design_options where product_id = p_product.id and group_key = 'color' and code = shell_color and is_active;
    if not found then raise exception 'Choose an available shell color for the %.', lname using errcode = '22023'; end if;
    labels := labels || (shell_label || ' shells');
  else shell_color := null; end if;

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
                                'bow_color', bow_color, 'drip_color', drip_color, 'shell_color', shell_color, 'extras_per_item', extra),
    'extra', extra, 'priced', priced,
    'summary', frosting_label || ' frosting' || case when cardinality(labels) > 0 then ', ' || array_to_string(labels, ', ') else '' end);
end $$;
revoke all on function private.bento_tier_design(public.products, jsonb, text) from public;

create or replace function private.bento_lower_tier(p_product public.products, p_lower jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.bento_tier_design(p_product, p_lower, 'Bottom tier')
$$;
revoke all on function private.bento_lower_tier(public.products, jsonb) from public;


do $rehearsal$
declare
  bento uuid; tiered uuid; q0 jsonb; q1 jsonb; q2 jsonb; q3 jsonb; q4 jsonb; report text := ''; ok boolean;
  top jsonb := '{"designer":"bento","frosting_color":"white","border":["shell_top","shell_bottom"],"accents":[],"message":"","topper":"none","layout":{}}';
  low jsonb := '{"frosting_color":"white","border":["shell_bottom"],"accents":[]}';
begin
  select id into bento from public.products where slug = 'product-8';
  select id into tiered from public.products where slug = 'mini-tiered-cake';
  q0 := public.quote_bento_design(bento, top);
  q1 := public.quote_bento_design(bento, top || '{"shell_color":"pink"}');
  ok := q1->'clean'->>'shell_color' = 'pink' and (q1->>'extra') = (q0->>'extra') and q1->'clean'->>'summary' like '%Pink shells%' and q0->'clean'->'shell_color' = 'null'::jsonb;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  bento shell colour saved, free (extra ' || (q0->>'extra') || ' = ' || (q1->>'extra') || ')';
  report := report || E'\nINFO  summary: ' || (q1->'clean'->>'summary');
  q2 := public.quote_bento_design(bento, (top || '{"shell_color":"pink"}') || '{"border":[]}');
  report := report || E'\n' || case when q2->'clean'->'shell_color' = 'null'::jsonb then 'PASS' else 'FAIL' end || '  no shells: shell colour dropped';
  begin perform public.quote_bento_design(bento, top || '{"shell_color":"no_such_color"}'); report := report || E'\nFAIL  unknown shell colour accepted';
  exception when others then report := report || E'\nPASS  unknown shell colour refused: ' || sqlerrm; end;
  q3 := public.quote_bento_design(tiered, top || jsonb_build_object('lower', low, 'middle', low));
  q4 := public.quote_bento_design(tiered, top || jsonb_build_object('shell_color', 'lavender', 'lower', low || '{"shell_color":"pink"}', 'middle', low || '{"shell_color":"butter"}'));
  ok := q4->'clean'->>'shell_color' = 'lavender' and q4->'clean'->'lower'->>'shell_color' = 'pink' and q4->'clean'->'middle'->>'shell_color' = 'butter'
    and (q4->>'extra') = (q3->>'extra') and q4->'clean'->>'summary' like '%Bottom tier: %Pink shells%';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  Mini Tiered: each tier keeps its own shell colour, still free (extra ' || (q3->>'extra') || ' = ' || (q4->>'extra') || ')';
  report := report || E'\nINFO  summary: ' || (q4->'clean'->>'summary');
  begin perform public.quote_bento_design(tiered, top || jsonb_build_object('lower', low || '{"shell_color":"no_such_color"}')); report := report || E'\nFAIL  unknown bottom shell colour accepted';
  exception when others then report := report || E'\nPASS  bottom tier rules apply: ' || sqlerrm; end;
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
