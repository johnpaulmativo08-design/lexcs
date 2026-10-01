-- Phase 34: customers can arrange decorations on the bento cake (free).
-- Requires phase 32. Safe to run more than once. Replaces private.bento_design with the phase 32 version
-- plus a "layout" block: flower positions, bow angles, topper and message positions. Positions are on a
-- cake of radius 1 (x, z), rounded to 3 decimals; anything out of range is pulled back onto the cake and
-- entries for decorations that were not chosen are dropped. Pricing is unchanged.

create or replace function private.bento_point(p jsonb, max_r numeric) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare x numeric; z numeric; r numeric;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) <> 2
     or jsonb_typeof(p->0) <> 'number' or jsonb_typeof(p->1) <> 'number' then return 'null'::jsonb; end if;
  x := (p->0)::numeric; z := (p->1)::numeric;
  if abs(x) > 100 or abs(z) > 100 then return 'null'::jsonb; end if;
  r := sqrt(x * x + z * z);
  if r > max_r then x := x * max_r / r; z := z * max_r / r; end if;
  return jsonb_build_array(round(x, 3), round(z, 3));
end $$;
revoke all on function private.bento_point(jsonb, numeric) from public;

create or replace function private.bento_design(p_product public.products, custom jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := p_product.customization_config;
  opt public.design_options;
  extra numeric(12,2) := 0;
  priced jsonb := '[]';
  flags jsonb := '{}';
  parts text[] := '{}';
  color_code text := custom->>'frosting_color';
  borders jsonb := coalesce(custom->'border', '[]');
  accents jsonb := coalesce(custom->'accents', '[]');
  bow_color text := nullif(custom->>'bow_color', '');
  message text := coalesce(custom->>'message', '');
  lettering text := nullif(custom->>'lettering', '');
  lettering_color text := nullif(custom->>'lettering_color', '');
  topper text := coalesce(nullif(custom->>'topper', ''), 'none');
  topper_text text := nullif(btrim(coalesce(custom->>'topper_text', '')), '');
  c text; frosting_label text; labels text[] := '{}';
  clean jsonb;
  lay jsonb := case when jsonb_typeof(custom->'layout') = 'object' then custom->'layout' else '{}'::jsonb end;
  layout jsonb := '{}'; pts jsonb; bow_v jsonb; i int;
begin
  if jsonb_typeof(custom) is distinct from 'object' or custom->>'designer' is distinct from 'bento' then
    raise exception 'Invalid bento design.' using errcode = '22023'; end if;
  if jsonb_typeof(borders) <> 'array' or jsonb_typeof(accents) <> 'array' then raise exception 'Invalid bento design.' using errcode = '22023'; end if;

  -- frosting colour (required, free)
  select * into opt from public.design_options where product_id = p_product.id and group_key = 'color' and code = color_code and is_active;
  if not found then raise exception 'Choose an available frosting color.' using errcode = '22023'; end if;
  frosting_label := opt.label; parts := parts || (opt.label || ' frosting');

  -- borders (0..max_borders, each priced)
  if jsonb_array_length(borders) > coalesce((cfg->>'max_borders')::int, 2)
     or (select count(distinct v) from jsonb_array_elements_text(borders) v) <> jsonb_array_length(borders) then
    raise exception 'Invalid border choice.' using errcode = '22023'; end if;
  for c in select jsonb_array_elements_text(borders) loop
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'border' and code = c and is_active;
    if not found then raise exception 'That border is no longer available.' using errcode = '22023'; end if;
    extra := extra + opt.price; priced := priced || jsonb_build_object('label', opt.label, 'price', opt.price);
    flags := flags || jsonb_build_object('border_' || c, 'yes'); labels := labels || opt.label;
  end loop;

  -- accents (0..max_accents, each priced); bows need a colour
  if jsonb_array_length(accents) > coalesce((cfg->>'max_accents')::int, 6)
     or (select count(distinct v) from jsonb_array_elements_text(accents) v) <> jsonb_array_length(accents) then
    raise exception 'Too many or repeated decorations.' using errcode = '22023'; end if;
  for c in select jsonb_array_elements_text(accents) loop
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'accent' and code = c and is_active;
    if not found then raise exception 'A chosen decoration is no longer available.' using errcode = '22023'; end if;
    extra := extra + opt.price; priced := priced || jsonb_build_object('label', opt.label, 'price', opt.price);
    flags := flags || jsonb_build_object('accent_' || c, 'yes'); labels := labels || opt.label;
  end loop;
  if accents ? 'pearls_gold' and accents ? 'pearls_silver' then raise exception 'Choose gold or silver pearls, not both.' using errcode = '22023'; end if;
  if accents ? 'ribbon_bows' then
    if not exists (select 1 from public.design_options where product_id = p_product.id and group_key = 'color' and code = bow_color and is_active) then
      raise exception 'Choose a ribbon color.' using errcode = '22023'; end if;
  else bow_color := null; end if;
  if cardinality(labels) > 0 then parts := parts || array_to_string(labels, ', '); end if;

  -- message (optional, priced once) with lettering style and colour
  message := regexp_replace(replace(message, E'\r', ''), '[ \t]+$', '', 'gm');
  message := btrim(message, E' \n');
  if message ~ '[\x00-\x09\x0B-\x1F\x7F]' then raise exception 'The message has unsupported characters.' using errcode = '22023'; end if;
  if char_length(message) > coalesce((cfg->>'message_max')::int, 42) then
    raise exception 'Keep the message within % characters.', coalesce((cfg->>'message_max')::int, 42) using errcode = '22023'; end if;
  if message <> '' and array_length(string_to_array(message, E'\n'), 1) > coalesce((cfg->>'message_max_lines')::int, 3) then
    raise exception 'Keep the message within % lines.', coalesce((cfg->>'message_max_lines')::int, 3) using errcode = '22023'; end if;
  if message <> '' then
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'message' and code = 'custom_message' and is_active;
    if not found then raise exception 'Messages are not available right now.' using errcode = '22023'; end if;
    extra := extra + opt.price; priced := priced || jsonb_build_object('label', opt.label, 'price', opt.price);
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'lettering' and code = coalesce(lettering, 'piped') and is_active;
    if not found then raise exception 'Choose an available lettering style.' using errcode = '22023'; end if;
    lettering := opt.code;
    if opt.price > 0 then extra := extra + opt.price; priced := priced || jsonb_build_object('label', opt.label, 'price', opt.price); end if;
    flags := flags || jsonb_build_object('lettering', opt.code);
    if not exists (select 1 from public.design_options where product_id = p_product.id and group_key = 'color' and code = coalesce(lettering_color, '') and is_active) then
      raise exception 'Choose a lettering color.' using errcode = '22023'; end if;
    parts := parts || ('“' || replace(message, E'\n', ' / ') || '” (' || opt.label || ')');
  else
    lettering := null; lettering_color := null;
  end if;

  -- topper (single choice)
  select * into opt from public.design_options where product_id = p_product.id and group_key = 'topper' and code = topper and is_active;
  if not found then raise exception 'That topper is no longer available.' using errcode = '22023'; end if;
  if topper = 'number' then
    if topper_text is null or topper_text !~ coalesce(cfg->>'topper_text_pattern', '^[0-9]{1,3}$') then
      raise exception 'Enter 1 to 3 digits for the number topper.' using errcode = '22023'; end if;
  else topper_text := null; end if;
  if opt.price > 0 then extra := extra + opt.price; priced := priced || jsonb_build_object('label', opt.label, 'price', opt.price); end if;
  if topper <> 'none' then flags := flags || jsonb_build_object('topper_' || topper, 'yes');
    parts := parts || (opt.label || coalesce(' ' || topper_text, '')); end if;

  -- custom placement (free, phase 34): positions on a cake of radius 1, kept only for chosen decorations
  -- and pulled back onto the cake when out of range. null = that item stays in its usual place.
  if accents ? 'piped_flowers' and jsonb_typeof(lay->'flowers') = 'array' then
    pts := '[]';
    for i in 0 .. least(jsonb_array_length(lay->'flowers'), 7) - 1 loop pts := pts || jsonb_build_array(private.bento_point(lay->'flowers'->i, 0.82)); end loop;
    if exists (select 1 from jsonb_array_elements(pts) x where x <> 'null'::jsonb) then layout := layout || jsonb_build_object('flowers', pts); end if;
  end if;
  if accents ? 'ribbon_bows' and jsonb_typeof(lay->'bows') = 'array' then
    pts := '[]';
    for i in 0 .. least(jsonb_array_length(lay->'bows'), 4) - 1 loop
      bow_v := lay->'bows'->i;
      pts := pts || case when jsonb_typeof(bow_v) = 'number' and abs(bow_v::numeric) < 1000
        then jsonb_build_array(round(((bow_v::numeric % 6.2832) + 6.2832) % 6.2832, 3)) else jsonb_build_array(null::numeric) end;
    end loop;
    if exists (select 1 from jsonb_array_elements(pts) x where x <> 'null'::jsonb) then layout := layout || jsonb_build_object('bows', pts); end if;
  end if;
  if topper <> 'none' and private.bento_point(lay->'topper', 0.7) <> 'null'::jsonb then layout := layout || jsonb_build_object('topper', private.bento_point(lay->'topper', 0.7)); end if;
  if message <> '' and private.bento_point(lay->'message', 0.45) <> 'null'::jsonb then layout := layout || jsonb_build_object('message', private.bento_point(lay->'message', 0.45)); end if;
  if layout <> '{}'::jsonb then parts := parts || 'Custom placement'::text; flags := flags || jsonb_build_object('layout', layout); end if;

  clean := jsonb_build_object(
    'designer', 'bento', 'version', 1,
    'frosting_color', color_code, 'frosting_color_label', frosting_label,
    'border', borders, 'accents', accents, 'bow_color', bow_color,
    'message', nullif(message, ''), 'lettering', lettering, 'lettering_color', lettering_color,
    'topper', topper, 'topper_text', topper_text,
    'extras', priced, 'extras_per_item', extra,
    'summary', array_to_string(parts, ' · ')
  ) || flags;
  return jsonb_build_object('clean', clean, 'extra', extra);
end $$;
revoke all on function private.bento_design(public.products, jsonb) from public;
