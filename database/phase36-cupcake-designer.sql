-- Phase 36: cupcake designer for Mini Cupcakes (product-5) and 3oz Cupcake (product-6).
-- Requires phases 32-35. Safe to run more than once.
--
-- How a baker builds a box, as data the customer can choose:
--   flavor   chocolate | vanilla (free)
--   pattern  same (every cupcake alike) | alternate (designs A and B in a checkerboard) | assorted (baker mixes the palette)
--   a / b    { style, colors[] }  style = rosette | two_tone | rainbow | luxe | floral (luxe and floral: regular size only)
--   finishes gold_pearls (free) | silver_pearls | white_pearls | gold_balls | leaves | edible_glitter
--   theme    none | mermaid | butterfly | unicorn | dinosaur | space | safari | custom (custom needs a short note)
-- Colours per design: rosette 1, two-tone 2, luxe 2 (light + deep), rainbow 3-5, floral 1-5; an assorted box may use
-- 2 up to max_colors (16). Extras are charged once per box (owner's placeholder ₱3), editable in Admin > Design options.
--
-- private.checkout is NOT copied here: the live function is checked by fingerprint and only its design branch is
-- widened from bento to bento + cupcake (via private.product_design). Refuses to run if checkout changed.

-- 1. Option groups ---------------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.design_options'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%group_key%lettering%'
  loop execute format('alter table public.design_options drop constraint %I', c.conname); end loop;
end $$;
alter table public.design_options add constraint design_options_group_key_check
  check (group_key in ('color', 'border', 'lettering', 'accent', 'topper', 'message', 'font', 'flavor', 'style', 'pattern', 'finish', 'theme'));

-- 2. Products: designer settings ---------------------------------------------------------------------
update public.products set customization_config = coalesce(customization_config, '{}'::jsonb)
  || jsonb_build_object('designer', 'cupcake', 'size', 'mini', 'max_colors', 16)
  where slug = 'product-5';
update public.products set customization_config = coalesce(customization_config, '{}'::jsonb)
  || jsonb_build_object('designer', 'cupcake', 'size', 'regular', 'max_colors', 16)
  where slug = 'product-6';

-- 3. Options for both cupcake products (luxe and floral only for the regular 3oz size) ---------------
insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order)
select p.id, o.group_key, o.code, o.label, o.price, o.hex, o.sort_order
from public.products p
cross join (values
  ('flavor','chocolate','Chocolate',0,null,1), ('flavor','vanilla','Vanilla',0,null,2),
  ('style','rosette','Classic rosette',0,null,1), ('style','two_tone','Two-tone swirl',3,null,2), ('style','rainbow','Rainbow swirl',3,null,3),
  ('pattern','same','All the same',0,null,1), ('pattern','alternate','Alternate two designs',3,null,2), ('pattern','assorted','Baker’s assorted',3,null,3),
  ('finish','gold_pearls','Gold pearls',0,null,1), ('finish','silver_pearls','Silver pearls',3,null,2), ('finish','white_pearls','White pearls',3,null,3),
  ('finish','gold_balls','Big gold balls',3,null,4), ('finish','leaves','Piped leaves',3,null,5), ('finish','edible_glitter','Edible glitter',3,null,6),
  ('theme','none','No theme',0,null,1), ('theme','mermaid','Mermaid',3,null,2), ('theme','butterfly','Butterfly garden',3,null,3), ('theme','unicorn','Unicorn',3,null,4),
  ('theme','dinosaur','Dinosaur',3,null,5), ('theme','space','Outer space',3,null,6), ('theme','safari','Safari',3,null,7), ('theme','custom','Your own theme',3,null,8),
  ('color','white','White',0,'#FFFFFF',1), ('color','ivory','Ivory',0,'#FFF8E7',2), ('color','cream','Cream',0,'#F6E7C8',3),
  ('color','butter','Butter yellow',0,'#F9E27D',4), ('color','lemon','Lemon',0,'#F4D03F',5), ('color','lime','Lime',0,'#DCE95A',6),
  ('color','peach','Peach',0,'#F9C8A8',7), ('color','coral','Coral',0,'#F08A74',8), ('color','blush','Blush',0,'#F7D6DA',9),
  ('color','baby_pink','Baby pink',0,'#F4B6C8',10), ('color','pink','Pink',0,'#EE82A8',11), ('color','hot_pink','Hot pink',0,'#E0457B',12),
  ('color','deep_rose','Deep rose',0,'#C2577C',13), ('color','red','Red',0,'#C8102E',14), ('color','burgundy','Burgundy',0,'#7A1F2B',15),
  ('color','lavender','Lavender',0,'#CDB8E8',16), ('color','lilac','Lilac',0,'#B79AD9',17), ('color','purple','Purple',0,'#7E57C2',18),
  ('color','periwinkle','Periwinkle',0,'#8C93E6',19), ('color','baby_blue','Baby blue',0,'#BFDDF4',20), ('color','sky_blue','Sky blue',0,'#7FB8E6',21),
  ('color','azure','Azure',0,'#29B0E8',22), ('color','denim','Denim blue',0,'#4A6898',23), ('color','navy','Navy',0,'#1F3A6D',24),
  ('color','mint','Mint',0,'#BDE8D2',25), ('color','aqua','Aqua',0,'#86DCC8',26), ('color','sage','Sage',0,'#A8BFA0',27),
  ('color','leaf_green','Leaf green',0,'#3DB65A',28), ('color','chocolate','Chocolate brown',0,'#5A3A2A',29), ('color','black','Black',0,'#1E1E1E',30)
) as o(group_key, code, label, price, hex, sort_order)
where p.slug in ('product-5', 'product-6')
on conflict (product_id, group_key, code) do nothing;

insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order)
select p.id, 'style', o.code, o.label, 3, null, o.sort_order
from public.products p cross join (values ('luxe', 'Luxe rose & blooms', 4), ('floral', 'Floral garden', 5)) as o(code, label, sort_order)
where p.slug = 'product-6'
on conflict (product_id, group_key, code) do nothing;

-- 4. Validation + pricing ------------------------------------------------------------------------------
-- One design (A or B): style must be offered for this product, colours active, count fits the style.
create or replace function private.cupcake_part(p_product public.products, part jsonb, assorted boolean, max_colors int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare style_opt public.design_options; cols jsonb := coalesce(part->'colors', '[]'); n int; lo int; hi int; labels text[] := '{}'; c text; lbl text;
begin
  if jsonb_typeof(part) is distinct from 'object' or jsonb_typeof(cols) <> 'array' then raise exception 'Invalid cupcake design.' using errcode = '22023'; end if;
  select * into style_opt from public.design_options where product_id = p_product.id and group_key = 'style' and code = part->>'style' and is_active;
  if not found then raise exception 'Choose an available piping style.' using errcode = '22023'; end if;
  n := jsonb_array_length(cols);
  if (select count(distinct v) from jsonb_array_elements_text(cols) v) <> n then raise exception 'Each color can be picked once.' using errcode = '22023'; end if;
  if assorted then lo := 2; hi := max_colors;
  else
    lo := case style_opt.code when 'rosette' then 1 when 'two_tone' then 2 when 'luxe' then 2 when 'rainbow' then 3 else 1 end;
    hi := case style_opt.code when 'rosette' then 1 when 'two_tone' then 2 when 'luxe' then 2 when 'rainbow' then 5 else 5 end;
  end if;
  if n < lo or n > hi then
    raise exception '% needs % color%.', style_opt.label, case when lo = hi then lo::text else lo || '–' || hi end, case when hi = 1 then '' else 's' end using errcode = '22023';
  end if;
  for c in select jsonb_array_elements_text(cols) loop
    select label into lbl from public.design_options where product_id = p_product.id and group_key = 'color' and code = c and is_active;
    if not found then raise exception 'Choose an available frosting color.' using errcode = '22023'; end if;
    labels := labels || lbl;
  end loop;
  return jsonb_build_object('style', style_opt.code, 'style_label', style_opt.label, 'style_price', style_opt.price, 'colors', cols, 'color_labels', to_jsonb(labels));
end $$;
revoke all on function private.cupcake_part(public.products, jsonb, boolean, int) from public;

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

  return jsonb_build_object('clean', jsonb_build_object(
      'designer', 'cupcake', 'version', 1, 'size', cfg->>'size',
      'flavor', flavor.code, 'flavor_label', flavor.label, 'pattern', pattern.code, 'pattern_label', pattern.label,
      'a', a - 'style_price', 'b', case when b is null then null else b - 'style_price' end,
      'finishes', finishes, 'theme', theme.code, 'theme_label', theme.label, 'theme_note', theme_note,
      'extras', priced, 'extras_per_item', extra, 'summary', array_to_string(parts, ' · ')) || flags,
    'extra', extra);
end $$;
revoke all on function private.cupcake_design(public.products, jsonb) from public;

-- Customers can price a cupcake design before checkout (same rules, nothing stored).
create or replace function public.quote_cupcake_design(p_product_id uuid, p_design jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.products;
begin
  select * into p from public.products where id = p_product_id and status = 'active' and customization_config->>'designer' = 'cupcake';
  if not found then raise exception 'These cupcakes cannot be designed right now.' using errcode = '22023'; end if;
  return private.cupcake_design(p, p_design);
end $$;
revoke all on function public.quote_cupcake_design(uuid, jsonb) from public;
grant execute on function public.quote_cupcake_design(uuid, jsonb) to anon, authenticated;

-- One entry point for checkout: picks the right designer for the product.
create or replace function private.product_design(p_product public.products, custom jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return case p_product.customization_config->>'designer'
    when 'bento' then private.bento_design(p_product, custom)
    when 'cupcake' then private.cupcake_design(p_product, custom)
    else null end;
end $$;
revoke all on function private.product_design(public.products, jsonb) from public;

-- 5. Checkout: widen the existing design branch (fingerprint-checked, idempotent) -----------------------
do $$
declare def text; fp text;
begin
  select md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) into fp from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'checkout';
  def := pg_get_functiondef('private.checkout(jsonb)'::regprocedure);
  if position('private.product_design(product' in def) > 0 then return; end if;   -- already applied
  if fp <> '33f27f4bee3dd816c5d74d4922e7fcf2' then
    raise exception 'private.checkout differs from the expected version (%). Review before applying phase 36.', fp;
  end if;
  def := replace(def, $q$product.customization_config->>'designer'='bento' and item->'customization' is not null$q$,
                      $q$product.customization_config->>'designer' in ('bento','cupcake') and item->'customization' is not null$q$);
  def := replace(def, $q$design:=private.bento_design(product, item->'customization');$q$, $q$design:=private.product_design(product, item->'customization');$q$);
  if position('private.product_design(product' in def) = 0 or position($q$in ('bento','cupcake')$q$ in def) = 0 then
    raise exception 'Could not update private.checkout safely.';
  end if;
  execute def;
end $$;

-- 6. Chat design card: also for cupcake orders ----------------------------------------------------------
create or replace function private.chat_design_card() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.orders; thread_id uuid; entry jsonb; kind text := new.customization->>'designer';
begin
  if new.customization is null or kind is null or kind not in ('bento', 'cupcake') then return new; end if;
  select * into o from public.orders where id = new.order_id;
  if not found then return new; end if;
  insert into public.chat_conversations(customer_id, order_id, state) values (o.customer_id, null, 'active')
    on conflict (customer_id) where order_id is null do update set updated_at = now()
    returning id into thread_id;
  entry := jsonb_build_object('line', new.line_number, 'name', new.name_snapshot, 'variant_id', new.variant_id,
    'qty', new.quantity, 'unit_price', new.unit_price + coalesce((new.customization->>'extras_per_item')::numeric, 0), 'summary', new.customization->>'summary',
    'design', new.customization, 'angle_path', new.reference_image_path, 'top_path', null);
  insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id, attachments)
    values (thread_id, 'system', 'design_card',
      'Your ' || case kind when 'cupcake' then 'cupcake' else 'bento' end || ' design for Order #' || o.order_number || ' is saved. This is what LexC''s will bake. Need a change? Reply here.',
      o.id, jsonb_build_array(entry))
    on conflict (order_id) where message_type = 'design_card'
    do update set attachments = public.chat_messages.attachments || excluded.attachments;
  return new;
end $$;
revoke all on function private.chat_design_card() from public;
