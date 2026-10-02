-- Phase 37: mini donut designer for Mini Donuts – Party Box (product-2) and – Themed Party Box (product-3).
-- Requires phases 32-36. Safe to run more than once. Both boxes are the same donuts, so they get the same choices.
--
-- How LexC's decorates a box, as data the customer can choose:
--   flavors        1-4 of vanilla | chocolate | ube | strawberry; more than one = "Mixed flavors" extra
--   pattern        same (one glaze) | alternate (two glazes, checkerboard) | assorted (2..16 glazes mixed)
--   glazes         glaze dip colours
--   finishes       0-3 of choco_drizzle | white_drizzle | honey_drip | gold_dust | edible_glitter
--   sprinkles      none | white_pearls (free) | nonpareils (+ 1-3 sprinkle_colors) | gold_pearls
--   theme          none | butterfly | garden | bees | rainbow | fairy | construction | baby | bows | custom (+ theme_note)
--   message        none | letters (fondant letters spelled across the box) | plaque (name/number plaques)
--                  + message_text, message_color
-- Extras are charged once per box (owner's price ₱3 each), editable in Admin > Designer options.

-- 1. Option groups: add 'sprinkle' ----------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.design_options'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%group_key%lettering%'
  loop execute format('alter table public.design_options drop constraint %I', c.conname); end loop;
end $$;
alter table public.design_options add constraint design_options_group_key_check
  check (group_key in ('color', 'border', 'lettering', 'accent', 'topper', 'message', 'font', 'flavor', 'style', 'pattern', 'finish', 'theme', 'sprinkle'));

-- 2. Products: designer settings ---------------------------------------------------------------------
update public.products set customization_config = coalesce(customization_config, '{}'::jsonb)
  || jsonb_build_object('designer', 'donut', 'max_colors', 16)
  where slug in ('product-2', 'product-3');

-- 3. Options (same for both boxes) ---------------------------------------------------------------------
insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order)
select p.id, o.group_key, o.code, o.label, o.price, o.hex, o.sort_order
from public.products p
cross join (values
  ('flavor','vanilla','Classic vanilla',0,null,1), ('flavor','chocolate','Chocolate',0,null,2), ('flavor','ube','Ube',0,null,3),
  ('flavor','strawberry','Strawberry',0,null,4), ('flavor','mix','Mixed flavors',3,null,9),
  ('pattern','same','One glaze',0,null,1), ('pattern','alternate','Two glazes, alternating',3,null,2), ('pattern','assorted','Assorted glazes',3,null,3),
  ('finish','choco_drizzle','Chocolate drizzle',3,null,1), ('finish','white_drizzle','White drizzle',3,null,2), ('finish','honey_drip','Honey drip',3,null,3),
  ('finish','gold_dust','Gold dust',3,null,4), ('finish','edible_glitter','Edible glitter',3,null,5),
  ('sprinkle','none','No sprinkles',0,null,1), ('sprinkle','white_pearls','White sugar pearls',0,null,2),
  ('sprinkle','nonpareils','Coloured nonpareils',3,null,3), ('sprinkle','gold_pearls','Gold pearls',3,null,4),
  ('theme','none','No toppers',0,null,1), ('theme','butterfly','Butterflies & daisies',3,null,2), ('theme','garden','Flower garden',3,null,3),
  ('theme','bees','Bees & honeycomb',3,null,4), ('theme','rainbow','Rainbows & clouds',3,null,5), ('theme','fairy','Fairy garden',3,null,6),
  ('theme','construction','Trucks & tools',3,null,7), ('theme','baby','Baby shower',3,null,8), ('theme','bows','Bows & candy',3,null,9),
  ('theme','custom','Your own theme',3,null,10),
  ('message','none','No message',0,null,1), ('message','letters','Fondant letters',3,null,2), ('message','plaque','Name plaques',3,null,3),
  ('color','white','White',0,'#FFFFFF',1), ('color','ivory','Ivory',0,'#FFF8E7',2), ('color','cream','Cream',0,'#F6E7C8',3),
  ('color','butter','Butter yellow',0,'#F9E27D',4), ('color','lemon','Lemon',0,'#F4D03F',5), ('color','lime','Lime',0,'#DCE95A',6),
  ('color','peach','Peach',0,'#F9C8A8',7), ('color','coral','Coral',0,'#F08A74',8), ('color','blush','Blush',0,'#F7D6DA',9),
  ('color','baby_pink','Baby pink',0,'#F4B6C8',10), ('color','pink','Pink',0,'#EE82A8',11), ('color','hot_pink','Hot pink',0,'#E0457B',12),
  ('color','deep_rose','Deep rose',0,'#C2577C',13), ('color','red','Red',0,'#C8102E',14), ('color','burgundy','Burgundy',0,'#7A1F2B',15),
  ('color','lavender','Lavender',0,'#CDB8E8',16), ('color','lilac','Lilac',0,'#B79AD9',17), ('color','purple','Purple',0,'#7E57C2',18),
  ('color','periwinkle','Periwinkle',0,'#8C93E6',19), ('color','baby_blue','Baby blue',0,'#BFDDF4',20), ('color','sky_blue','Sky blue',0,'#7FB8E6',21),
  ('color','azure','Azure',0,'#29B0E8',22), ('color','denim','Denim blue',0,'#4A6898',23), ('color','navy','Navy',0,'#1F3A6D',24),
  ('color','mint','Mint',0,'#BDE8D2',25), ('color','aqua','Aqua',0,'#86DCC8',26), ('color','sage','Sage',0,'#A8BFA0',27),
  ('color','leaf_green','Leaf green',0,'#3DB65A',28), ('color','chocolate','Chocolate brown',0,'#5A3A2A',29), ('color','black','Black',0,'#1E1E1E',30),
  ('color','orange','Orange',0,'#F29A3A',31)
) as o(group_key, code, label, price, hex, sort_order)
where p.slug in ('product-2', 'product-3')
on conflict (product_id, group_key, code) do nothing;

-- 4. Validation + pricing ------------------------------------------------------------------------------
create or replace function private.donut_codes(p_product public.products, grp text, codes jsonb, lo int, hi int, what text)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare out text[] := '{}'; c text; lbl text; n int;
begin
  if jsonb_typeof(codes) is distinct from 'array' then raise exception 'Invalid %.', what using errcode = '22023'; end if;
  n := jsonb_array_length(codes);
  if (select count(distinct v) from jsonb_array_elements_text(codes) v) <> n then raise exception 'Each % can be picked once.', what using errcode = '22023'; end if;
  if n < lo or n > hi then
    raise exception 'Choose % %.', case when lo = hi then lo::text else lo || '–' || hi end, what || case when hi = 1 then '' else 's' end using errcode = '22023';
  end if;
  for c in select jsonb_array_elements_text(codes) loop
    select label into lbl from public.design_options where product_id = p_product.id and group_key = grp and code = c and is_active and code <> 'mix';
    if not found then raise exception 'Choose an available %.', what using errcode = '22023'; end if;
    out := out || lbl;
  end loop;
  return out;
end $$;
revoke all on function private.donut_codes(public.products, text, jsonb, int, int, text) from public;

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
  msg_color text := custom->>'message_color'; msg_color_label text;
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
  if message.code = 'none' then msg := null; msg_color := null;
  else
    if msg is null then raise exception 'Type the message for the donuts.' using errcode = '22023'; end if;
    if message.code = 'letters' and (char_length(msg) > 40 or msg !~ '^[A-Za-z0-9 !?&''.,♥-]+$') then
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
      'message', message.code, 'message_label', message.label, 'message_text', msg, 'message_color', msg_color, 'message_color_label', msg_color_label,
      'extras', priced, 'extras_per_item', extra, 'summary', array_to_string(parts, ' · ')) || flags,
    'extra', extra);
end $$;
revoke all on function private.donut_design(public.products, jsonb) from public;

create or replace function public.quote_donut_design(p_product_id uuid, p_design jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.products;
begin
  select * into p from public.products where id = p_product_id and status = 'active' and customization_config->>'designer' = 'donut';
  if not found then raise exception 'These donuts cannot be designed right now.' using errcode = '22023'; end if;
  return private.donut_design(p, p_design);
end $$;
revoke all on function public.quote_donut_design(uuid, jsonb) from public;
grant execute on function public.quote_donut_design(uuid, jsonb) to anon, authenticated;

create or replace function private.product_design(p_product public.products, custom jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return case p_product.customization_config->>'designer'
    when 'bento' then private.bento_design(p_product, custom)
    when 'cupcake' then private.cupcake_design(p_product, custom)
    when 'donut' then private.donut_design(p_product, custom)
    else null end;
end $$;
revoke all on function private.product_design(public.products, jsonb) from public;

-- 5. Checkout: accept donut designs too (fingerprint-checked, idempotent) ------------------------------
do $$
declare def text; fp text;
begin
  select md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) into fp from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'checkout';
  def := pg_get_functiondef('private.checkout(jsonb)'::regprocedure);
  if position($q$in ('bento','cupcake','donut')$q$ in def) > 0 then return; end if;   -- already applied
  if fp <> '97dbe0fb0f9908767d5248bb258d4932' then
    raise exception 'private.checkout differs from the expected version (%). Review before applying phase 37.', fp;
  end if;
  def := replace(def, $q$in ('bento','cupcake')$q$, $q$in ('bento','cupcake','donut')$q$);
  if position($q$in ('bento','cupcake','donut')$q$ in def) = 0 then raise exception 'Could not update private.checkout safely.'; end if;
  execute def;
end $$;

-- 6. Chat design card: also for donut orders ------------------------------------------------------------
create or replace function private.chat_design_card() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.orders; thread_id uuid; entry jsonb; kind text := new.customization->>'designer';
begin
  if new.customization is null or kind is null or kind not in ('bento', 'cupcake', 'donut') then return new; end if;
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
      'Your ' || case kind when 'cupcake' then 'cupcake' when 'donut' then 'donut' else 'bento' end || ' design for Order #' || o.order_number || ' is saved. This is what LexC''s will bake. Need a change? Reply here.',
      o.id, jsonb_build_array(entry))
    on conflict (order_id) where message_type = 'design_card'
    do update set attachments = public.chat_messages.attachments || excluded.attachments;
  return new;
end $$;
revoke all on function private.chat_design_card() from public;
