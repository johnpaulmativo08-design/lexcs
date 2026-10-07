-- Phase 50: customization text limits.
--  * Bento cake message: up to 20 words (counted after trimming, so extra spaces never count). A 160-character cap
--    only protects the cake layout. customization_config.message_max_words = 20.
--  * Mini donuts: fondant letters are typed PER DONUT — 1 to 5 letters each — in message_pieces (one entry per donut,
--    empty = no letters on that donut). Designs saved before this (one message_text spelled across the box) still work.
--  * Cupcakes: new optional "Fondant letters" — 1 to 5 letters PER CUPCAKE, same rules. Added at ₱0 for both cupcake
--    products; Admin can set its price in Designer options.
-- The browser checks the same rules; the database re-checks every design when it is priced and when an order is placed.
-- Safe to re-run.
begin;

-- Letters per piece: an array with one entry per cupcake/donut. Spaces are removed; each non-empty entry has 1–5
-- characters (letters, numbers and ! ? & ' . , - ♥). At least one piece must have letters. Returns null when the
-- design has no per-piece letters (older designs).
create or replace function private.letter_pieces(custom jsonb, noun text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare src jsonb := custom->'message_pieces'; out_arr jsonb := '[]'; t text; i int := 0; filled int := 0;
begin
  if jsonb_typeof(src) is distinct from 'array' then return null; end if;
  if jsonb_array_length(src) > 60 then raise exception 'Too many % for letters.', noun || 's' using errcode = '22023'; end if;
  for t in select coalesce(value #>> '{}', '') from jsonb_array_elements(src) loop
    i := i + 1;
    t := regexp_replace(t, '\s+', '', 'g');
    if t <> '' then
      if char_length(t) > 5 or t !~ '^[A-Za-z0-9!?&''.,♥-]+$' then
        raise exception '% %: use 1–5 letters (letters, numbers and ! ? & '' . , - ♥).', initcap(noun), i using errcode = '22023'; end if;
      filled := filled + 1;
    end if;
    out_arr := out_arr || to_jsonb(t);
  end loop;
  if filled = 0 then raise exception 'Add letters to at least one %.', noun using errcode = '22023'; end if;
  return out_arr;
end $$;
revoke all on function private.letter_pieces(jsonb, text) from public;

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
  drip_color text := nullif(custom->>'drip_color', ''); drip_label text;
  font text := coalesce(nullif(custom->>'font', ''), 'rounded'); font_label text; fopt public.design_options;
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
  if accents ? 'drip' and drip_color is not null then
    select label into drip_label from public.design_options where product_id = p_product.id and group_key = 'color' and code = drip_color and is_active;
    if not found then raise exception 'Choose an available drip color.' using errcode = '22023'; end if;
  else drip_color := null; end if;
  for c in select jsonb_array_elements_text(accents) loop
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'accent' and code = c and is_active;
    if not found then raise exception 'A chosen decoration is no longer available.' using errcode = '22023'; end if;
    extra := extra + opt.price; priced := priced || jsonb_build_object('label', opt.label, 'price', opt.price);
    flags := flags || jsonb_build_object('accent_' || c, 'yes');
    labels := labels || (opt.label || case when c = 'drip' and drip_label is not null then ' (' || drip_label || ')' else '' end);
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
  if char_length(message) > 160 then
    raise exception 'Keep the message shorter (up to 160 characters).' using errcode = '22023'; end if;
  if btrim(message) <> '' and array_length(regexp_split_to_array(btrim(message), '\s+'), 1) > coalesce((cfg->>'message_max_words')::int, 20) then
    raise exception 'Keep the message within % words.', coalesce((cfg->>'message_max_words')::int, 20) using errcode = '22023'; end if;
  if message <> '' and array_length(string_to_array(message, E'\n'), 1) > coalesce((cfg->>'message_max_lines')::int, 3) then
    raise exception 'Keep the message within % lines.', coalesce((cfg->>'message_max_lines')::int, 3) using errcode = '22023'; end if;
  if message <> '' then
    select * into fopt from public.design_options where product_id = p_product.id and group_key = 'font' and code = font and is_active;
    if not found then raise exception 'Choose an available font.' using errcode = '22023'; end if;
    font_label := fopt.label; flags := flags || jsonb_build_object('font', fopt.code);
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
    parts := parts || ('“' || replace(message, E'\n', ' / ') || '” (' || opt.label || ', ' || font_label || ')');
  else
    lettering := null; lettering_color := null; font := null;
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
    'border', borders, 'accents', accents, 'bow_color', bow_color, 'drip_color', drip_color, 'font', font,
    'message', nullif(message, ''), 'lettering', lettering, 'lettering_color', lettering_color,
    'topper', topper, 'topper_text', topper_text,
    'extras', priced, 'extras_per_item', extra,
    'summary', array_to_string(parts, ' · ')
  ) || flags;
  return jsonb_build_object('clean', clean, 'extra', extra);
end $$;
revoke all on function private.bento_design(public.products, jsonb) from public;

create or replace function private.donut_design(p_product public.products, custom jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  max_colors int := least(coalesce((p_product.customization_config->>'max_colors')::int, 16), 31);
  opt public.design_options; pattern public.design_options; sprinkle public.design_options; theme public.design_options; message public.design_options;
  flavors jsonb := coalesce(custom->'flavors', '["vanilla"]'); glazes jsonb := coalesce(custom->'glazes', '[]');
  finishes jsonb := coalesce(custom->'finishes', '[]'); scols jsonb := coalesce(custom->'sprinkle_colors', '[]');
  flavor_labels text[]; glaze_labels text[]; scol_labels text[] := '{}'; fin_labels text[] := '{}'; f text;
  lo int; hi int; extra numeric(12,2) := 0; priced jsonb := '[]'; flags jsonb := '{}'; parts text[] := '{}';
  theme_note text := nullif(btrim(regexp_replace(coalesce(custom->>'theme_note', ''), '\s+', ' ', 'g')), '');
  msg text := nullif(btrim(regexp_replace(coalesce(custom->>'message_text', ''), '\s+', ' ', 'g')), '');
  msg_color text := custom->>'message_color'; msg_color_label text; pieces jsonb;
begin
  if jsonb_typeof(custom) is distinct from 'object' or custom->>'designer' is distinct from 'donut' then raise exception 'Invalid donut design.' using errcode = '22023'; end if;

  -- flavours: one batter, or a mix across the box
  flavor_labels := private.donut_codes(p_product, 'flavor', flavors, 1, 4, 'flavor');
  if jsonb_array_length(flavors) > 1 then
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'flavor' and code = 'mix' and is_active;
    if not found then raise exception 'Mixed flavors are not available right now.' using errcode = '22023'; end if;
    if opt.price > 0 then extra := extra + opt.price; priced := priced || jsonb_build_object('label', opt.label, 'price', opt.price); end if;
  end if;

  -- glaze dip colours, by box pattern
  select * into pattern from public.design_options where product_id = p_product.id and group_key = 'pattern' and code = coalesce(custom->>'pattern', 'same') and is_active;
  if not found then raise exception 'Choose how the glazes are arranged.' using errcode = '22023'; end if;
  lo := case pattern.code when 'same' then 1 else 2 end; hi := case pattern.code when 'same' then 1 when 'alternate' then 2 else max_colors end;
  glaze_labels := private.donut_codes(p_product, 'color', glazes, lo, hi, 'glaze color');
  if pattern.price > 0 then extra := extra + pattern.price; priced := priced || jsonb_build_object('label', pattern.label, 'price', pattern.price); end if;

  -- finishes on the glaze
  if jsonb_typeof(finishes) <> 'array' or jsonb_array_length(finishes) > 3
     or (select count(distinct v) from jsonb_array_elements_text(finishes) v) <> jsonb_array_length(finishes) then
    raise exception 'Choose up to 3 finishes.' using errcode = '22023'; end if;
  if finishes ? 'choco_drizzle' and finishes ? 'white_drizzle' then raise exception 'Choose one drizzle.' using errcode = '22023'; end if;
  for f in select jsonb_array_elements_text(finishes) loop
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'finish' and code = f and is_active;
    if not found then raise exception 'A chosen finish is no longer available.' using errcode = '22023'; end if;
    if opt.price > 0 then extra := extra + opt.price; priced := priced || jsonb_build_object('label', opt.label, 'price', opt.price); end if;
    flags := flags || jsonb_build_object('finish_' || f, 'yes'); fin_labels := fin_labels || opt.label;
  end loop;

  -- sprinkles
  select * into sprinkle from public.design_options where product_id = p_product.id and group_key = 'sprinkle' and code = coalesce(custom->>'sprinkles', 'white_pearls') and is_active;
  if not found then raise exception 'Choose available sprinkles.' using errcode = '22023'; end if;
  if sprinkle.code = 'nonpareils' then scol_labels := private.donut_codes(p_product, 'color', scols, 1, 3, 'sprinkle color');
  elsif jsonb_array_length(scols) > 0 then raise exception 'Sprinkle colors are only for coloured nonpareils.' using errcode = '22023'; end if;
  if sprinkle.price > 0 then extra := extra + sprinkle.price; priced := priced || jsonb_build_object('label', sprinkle.label, 'price', sprinkle.price); end if;

  -- fondant theme toppers
  select * into theme from public.design_options where product_id = p_product.id and group_key = 'theme' and code = coalesce(nullif(custom->>'theme', ''), 'none') and is_active;
  if not found then raise exception 'That theme is no longer available.' using errcode = '22023'; end if;
  if theme.code = 'custom' and theme_note is null then raise exception 'Tell us your theme in a few words.' using errcode = '22023'; end if;
  if theme_note is not null and (char_length(theme_note) > 60 or theme_note ~ '[\x00-\x1F\x7F<>]') then raise exception 'Keep the theme note short (up to 60 characters).' using errcode = '22023'; end if;
  if theme.code = 'none' then theme_note := null; end if;
  if theme.price > 0 then extra := extra + theme.price; priced := priced || jsonb_build_object('label', theme.label || ' toppers', 'price', theme.price); end if;

  -- fondant letters / name plaques
  select * into message from public.design_options where product_id = p_product.id and group_key = 'message' and code = coalesce(nullif(custom->>'message', ''), 'none') and is_active;
  if not found then raise exception 'Choose an available message style.' using errcode = '22023'; end if;
  if message.code = 'letters' then
    pieces := private.letter_pieces(custom, 'donut');
    if pieces is not null then msg := (select string_agg(x, ' · ') from jsonb_array_elements_text(pieces) x where x <> ''); end if;
  end if;
  if message.code = 'none' then msg := null; msg_color := null;
  else
    if msg is null then raise exception 'Type the message for the donuts.' using errcode = '22023'; end if;
    if message.code = 'letters' and pieces is null and (char_length(msg) > 40 or msg !~ '^[A-Za-z0-9 !?&''.,♥-]+$') then
      raise exception 'Letters: up to 40 characters (letters, numbers, spaces and ! ? & '' . , - ♥).' using errcode = '22023'; end if;
    if message.code = 'plaque' and (char_length(msg) > 14 or msg !~ '^[A-Za-z0-9 !?&''.,♥-]+$') then
      raise exception 'Plaque: up to 14 characters, like a name or a number.' using errcode = '22023'; end if;
    select label into msg_color_label from public.design_options where product_id = p_product.id and group_key = 'color' and code = coalesce(msg_color, 'white') and is_active;
    if not found then raise exception 'Choose an available letter color.' using errcode = '22023'; end if;
    msg_color := coalesce(msg_color, 'white');
    if message.price > 0 then extra := extra + message.price; priced := priced || jsonb_build_object('label', message.label, 'price', message.price); end if;
  end if;

  flags := flags || jsonb_build_object('pattern', pattern.code, 'sprinkles', sprinkle.code)
                 || (select coalesce(jsonb_object_agg('flavor_' || v, 'yes'), '{}'::jsonb) from jsonb_array_elements_text(flavors) v)
                 || case when theme.code <> 'none' then jsonb_build_object('theme_' || theme.code, 'yes') else '{}'::jsonb end
                 || case when message.code <> 'none' then jsonb_build_object('message_' || message.code, 'yes') else '{}'::jsonb end;

  parts := parts || array_to_string(flavor_labels, ' + ');
  parts := parts || (case pattern.code when 'same' then glaze_labels[1] || ' glaze'
                                       when 'alternate' then glaze_labels[1] || ' / ' || glaze_labels[2] || ' glaze, alternating'
                                       else 'Assorted glazes: ' || array_to_string(glaze_labels, ', ') end);
  if cardinality(fin_labels) > 0 then parts := parts || array_to_string(fin_labels, ', '); end if;
  if sprinkle.code <> 'none' then parts := parts || (sprinkle.label || case when cardinality(scol_labels) > 0 then ' (' || array_to_string(scol_labels, ', ') || ')' else '' end); end if;
  if theme.code <> 'none' then parts := parts || (theme.label || ' toppers' || coalesce(': ' || theme_note, '')); end if;
  if message.code <> 'none' then parts := parts || (message.label || ' "' || msg || '" (' || msg_color_label || ')'); end if;

  return jsonb_build_object('clean', jsonb_build_object(
      'designer', 'donut', 'version', 1,
      'flavors', flavors, 'flavor_labels', to_jsonb(flavor_labels),
      'pattern', pattern.code, 'pattern_label', pattern.label, 'glazes', glazes, 'glaze_labels', to_jsonb(glaze_labels),
      'finishes', finishes, 'finish_labels', to_jsonb(fin_labels),
      'sprinkles', sprinkle.code, 'sprinkles_label', sprinkle.label, 'sprinkle_colors', scols, 'sprinkle_color_labels', to_jsonb(scol_labels),
      'theme', theme.code, 'theme_label', theme.label, 'theme_note', theme_note,
      'message', message.code, 'message_label', message.label, 'message_text', msg, 'message_pieces', pieces, 'message_color', msg_color, 'message_color_label', msg_color_label,
      'extras', priced, 'extras_per_item', extra, 'summary', array_to_string(parts, ' · ')) || flags,
    'extra', extra);
end $$;
revoke all on function private.donut_design(public.products, jsonb) from public;

create or replace function private.cupcake_design(p_product public.products, custom jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := p_product.customization_config;
  max_colors int := least(coalesce((cfg->>'max_colors')::int, 16), 30);
  opt public.design_options; flavor public.design_options; pattern public.design_options; theme public.design_options;
  a jsonb; b jsonb := null; finishes jsonb := coalesce(custom->'finishes', '["gold_pearls"]'); f text;
  extra numeric(12,2) := 0; priced jsonb := '[]'; flags jsonb := '{}'; parts text[] := '{}'; fin_labels text[] := '{}';
  theme_note text := nullif(btrim(regexp_replace(coalesce(custom->>'theme_note', ''), '\s+', ' ', 'g')), '');
  all_colors int; desc_a text; desc_b text;
  message public.design_options; pieces jsonb; msg text; msg_color text := custom->>'message_color'; msg_color_label text;
begin
  if jsonb_typeof(custom) is distinct from 'object' or custom->>'designer' is distinct from 'cupcake' then raise exception 'Invalid cupcake design.' using errcode = '22023'; end if;
  select * into flavor from public.design_options where product_id = p_product.id and group_key = 'flavor' and code = coalesce(custom->>'flavor', 'chocolate') and is_active;
  if not found then raise exception 'Choose an available flavor.' using errcode = '22023'; end if;
  select * into pattern from public.design_options where product_id = p_product.id and group_key = 'pattern' and code = coalesce(custom->>'pattern', 'same') and is_active;
  if not found then raise exception 'Choose how the box is arranged.' using errcode = '22023'; end if;
  a := private.cupcake_part(p_product, custom->'a', pattern.code = 'assorted', max_colors);
  if pattern.code = 'alternate' then
    b := private.cupcake_part(p_product, custom->'b', false, max_colors);
    select count(distinct v) into all_colors from (select jsonb_array_elements_text(a->'colors') v union all select jsonb_array_elements_text(b->'colors')) x;
    if a->'style' = b->'style' and a->'colors' = b->'colors' then raise exception 'Make design B different from design A, or choose All the same.' using errcode = '22023'; end if;
  else all_colors := jsonb_array_length(a->'colors'); end if;
  if all_colors > max_colors then raise exception 'Use up to % colors in one box.', max_colors using errcode = '22023'; end if;

  -- prices: pattern, each priced style (once per style), finishes, theme
  if pattern.price > 0 then extra := extra + pattern.price; priced := priced || jsonb_build_object('label', pattern.label, 'price', pattern.price); end if;
  if (a->>'style_price')::numeric > 0 then extra := extra + (a->>'style_price')::numeric; priced := priced || jsonb_build_object('label', a->>'style_label', 'price', (a->>'style_price')::numeric); end if;
  if b is not null and b->>'style' <> a->>'style' and (b->>'style_price')::numeric > 0 then
    extra := extra + (b->>'style_price')::numeric; priced := priced || jsonb_build_object('label', b->>'style_label', 'price', (b->>'style_price')::numeric); end if;

  if jsonb_typeof(finishes) <> 'array' or jsonb_array_length(finishes) > 6
     or (select count(distinct v) from jsonb_array_elements_text(finishes) v) <> jsonb_array_length(finishes) then
    raise exception 'Invalid finishing choice.' using errcode = '22023'; end if;
  for f in select jsonb_array_elements_text(finishes) loop
    select * into opt from public.design_options where product_id = p_product.id and group_key = 'finish' and code = f and is_active;
    if not found then raise exception 'A chosen finish is no longer available.' using errcode = '22023'; end if;
    if opt.price > 0 then extra := extra + opt.price; priced := priced || jsonb_build_object('label', opt.label, 'price', opt.price); end if;
    flags := flags || jsonb_build_object('finish_' || f, 'yes'); fin_labels := fin_labels || opt.label;
  end loop;
  if finishes ? 'gold_pearls' and finishes ? 'silver_pearls' then raise exception 'Choose gold or silver pearls, not both.' using errcode = '22023'; end if;

  select * into theme from public.design_options where product_id = p_product.id and group_key = 'theme' and code = coalesce(nullif(custom->>'theme', ''), 'none') and is_active;
  if not found then raise exception 'That theme is no longer available.' using errcode = '22023'; end if;
  if theme.code = 'custom' and theme_note is null then raise exception 'Tell us your theme in a few words.' using errcode = '22023'; end if;
  if theme_note is not null and (char_length(theme_note) > 60 or theme_note ~ '[\x00-\x1F\x7F<>]') then raise exception 'Keep the theme note short (up to 60 characters).' using errcode = '22023'; end if;
  if theme.code = 'none' then theme_note := null; end if;
  if theme.price > 0 then extra := extra + theme.price; priced := priced || jsonb_build_object('label', theme.label || ' toppers', 'price', theme.price); end if;

  -- fondant letters, 1–5 per cupcake (phase 50). Designs from before have no message.
  select * into message from public.design_options where product_id = p_product.id and group_key = 'message' and code = coalesce(nullif(custom->>'message', ''), 'none') and is_active;
  if not found and coalesce(nullif(custom->>'message', ''), 'none') <> 'none' then raise exception 'Fondant letters are not available right now.' using errcode = '22023'; end if;
  if message.code = 'letters' then
    pieces := private.letter_pieces(custom, 'cupcake');
    if pieces is null then raise exception 'Add letters to at least one cupcake.' using errcode = '22023'; end if;
    msg := (select string_agg(x, ' · ') from jsonb_array_elements_text(pieces) x where x <> '');
    select label into msg_color_label from public.design_options where product_id = p_product.id and group_key = 'color' and code = coalesce(msg_color, 'white') and is_active;
    if not found then raise exception 'Choose an available letter color.' using errcode = '22023'; end if;
    msg_color := coalesce(msg_color, 'white');
    if message.price > 0 then extra := extra + message.price; priced := priced || jsonb_build_object('label', message.label, 'price', message.price); end if;
    flags := flags || jsonb_build_object('message_letters', 'yes');
  else msg_color := null; end if;

  flags := flags || jsonb_build_object('flavor', flavor.code, 'pattern', pattern.code, 'style_' || (a->>'style'), 'yes')
                 || case when b is not null then jsonb_build_object('style_' || (b->>'style'), 'yes') else '{}'::jsonb end
                 || case when theme.code <> 'none' then jsonb_build_object('theme_' || theme.code, 'yes') else '{}'::jsonb end;

  desc_a := (a->>'style_label') || ' (' || (select string_agg(x, ' + ') from jsonb_array_elements_text(a->'color_labels') x) || ')';
  parts := parts || flavor.label;
  if pattern.code = 'alternate' then
    desc_b := (b->>'style_label') || ' (' || (select string_agg(x, ' + ') from jsonb_array_elements_text(b->'color_labels') x) || ')';
    parts := parts || ('Alternating ' || desc_a || ' / ' || desc_b);
  elsif pattern.code = 'assorted' then
    parts := parts || ('Assorted ' || lower(a->>'style_label') || ' in ' || (select string_agg(x, ', ') from jsonb_array_elements_text(a->'color_labels') x));
  else parts := parts || desc_a; end if;
  if cardinality(fin_labels) > 0 then parts := parts || array_to_string(fin_labels, ', '); end if;
  if theme.code <> 'none' then parts := parts || (theme.label || ' toppers' || coalesce(': ' || theme_note, '')); end if;
  if msg is not null then parts := parts || (message.label || ' "' || msg || '" (' || msg_color_label || ')'); end if;

  return jsonb_build_object('clean', jsonb_build_object(
      'designer', 'cupcake', 'version', 1, 'size', cfg->>'size',
      'flavor', flavor.code, 'flavor_label', flavor.label, 'pattern', pattern.code, 'pattern_label', pattern.label,
      'a', a - 'style_price', 'b', case when b is null then null else b - 'style_price' end,
      'finishes', finishes, 'theme', theme.code, 'theme_label', theme.label, 'theme_note', theme_note,
      'message', coalesce(message.code, 'none'), 'message_label', message.label, 'message_pieces', pieces, 'message_text', msg, 'message_color', msg_color, 'message_color_label', msg_color_label,
      'extras', priced, 'extras_per_item', extra, 'summary', array_to_string(parts, ' · ')) || flags,
    'extra', extra);
end $$;
revoke all on function private.cupcake_design(public.products, jsonb) from public;

update public.products set customization_config = customization_config || '{"message_max_words": 20}'::jsonb
where customization_config->>'designer' = 'bento';

insert into public.design_options(product_id, group_key, code, label, price, hex, sort_order)
select p.id, v.group_key, v.code, v.label, 0, null, v.sort_order
from public.products p cross join (values ('message', 'none', 'No letters', 1), ('message', 'letters', 'Fondant letters', 2)) v(group_key, code, label, sort_order)
where p.customization_config->>'designer' = 'cupcake'
on conflict (product_id, group_key, code) do nothing;
commit;
