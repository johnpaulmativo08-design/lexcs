-- Phase 85 · Shell border colour on every cake (bento, Petite, Mini Tiered — every tier).
--
-- Why: customers can now pick the colour of the piped shell borders in the cake designer, instead of the shells
-- always matching the frosting. Like the drip colour it is free and optional ("Matching" = no colour sent).
--
-- What it does:
--   1. private.bento_design (quote_bento_design and create_order) accepts "shell_color": it must be an available
--      colour; it is kept only when the cake has a shell border, saved in the design and shown in the summary
--      ("Pink shells"). In-place patch of the live function with exact-match guards.
--   2. private.bento_tier_design (lower tiers, phase 84) does the same for each tier's own shell colour, and
--      private.bento_lower_tier now simply calls it for the bottom tier, so both lower tiers follow one set of rules.
--
-- What it does NOT do: change any price (the shell colour is free), existing orders, or designs without a shell
-- colour (priced and saved exactly as before).
--
-- How to apply: rehearse with database/tests/phase85-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor. Safe to run twice.

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

notify pgrst, 'reload schema';
