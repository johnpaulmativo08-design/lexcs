-- Phase 38: Cake Pops — a new product (12 / 25 / 40 / 60 pcs) with its own designer.
-- Requires phases 32-37. Safe to run more than once.
--
-- Prices (owner): 25 pcs ₱450 (₱18 per pop); 12 pcs ₱220, 40 pcs ₱700, 60 pcs ₱1,050 estimated from it.
-- Every pop is wrapped in a clear pouch with a gold twist tie (included). Extras are ₱3 each, once per box.
--
-- How LexC's makes them, as data the customer can choose:
--   style          round (cake pop ball) | donut (mini donut pop) — same price
--   flavors        1-2 of chocolate | vanilla; both = "Mixed flavors" extra
--   pattern        same (one coating) | alternate (two, checkerboard) | assorted (2..16 coatings)
--   glazes         coating colours (candy melts)
--   finishes       0-3 of choco_drizzle | white_drizzle | gold_star | gold_dust | edible_glitter
--   sprinkles      none | white_pearls (free) | nonpareils (+ 1-3 sprinkle_colors) | gold_pearls
--   theme          none | baby | space | butterfly | garden | rainbow | bows | custom (+ theme_note, e.g. characters)
--   message        none | letters | plaque  + message_text, message_color

-- 1. Category and product ---------------------------------------------------------------------------
insert into public.categories (slug, name, sort_order) values ('cakepops', 'Cake Pops', 8)
on conflict (slug) do nothing;

insert into public.products (slug, name, description, kind, status, image_path, image_alt, emoji, badge_label, sort_order, legacy_id, category_id,
                             gallery_image_paths, customization_config)
select 'cake-pops', 'Cake Pops', 'Round cake pops or mini donut pops on sticks · each wrapped with a gold tie', 'standard', 'active',
       'local:assets/products/cake-pops/main.webp', 'Pink, blue and purple cake pops with sprinkles, each wrapped in a clear bag with a gold tie',
       '🍭', 'New', 26, 26, (select id from public.categories where slug = 'cakepops'),
       array['local:assets/products/cake-pops/2.webp', 'local:assets/products/cake-pops/3.webp', 'local:assets/products/cake-pops/4.webp', 'local:assets/products/cake-pops/5.webp'],
       jsonb_build_object('designer', 'cakepop', 'max_colors', 16)
where not exists (select 1 from public.products where slug = 'cake-pops');

insert into public.product_variants (product_id, code, label, price, sort_order)
select p.id, v.code, v.label, v.price, v.sort_order
from public.products p cross join (values ('pcs12', '12pcs', 220, 1), ('pcs25', '25pcs', 450, 2), ('pcs40', '40pcs', 700, 3), ('pcs60', '60pcs', 1050, 4)) as v(code, label, price, sort_order)
where p.slug = 'cake-pops'
on conflict (product_id, code) do nothing;

-- 2. Designer options ----------------------------------------------------------------------------------
insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order)
select p.id, o.group_key, o.code, o.label, o.price, o.hex, o.sort_order
from public.products p
cross join (values
  ('style','round','Round cake pops',0,null,1), ('style','donut','Mini donut pops',0,null,2),
  ('flavor','chocolate','Chocolate',0,null,1), ('flavor','vanilla','Vanilla',0,null,2), ('flavor','mix','Mixed flavors',3,null,9),
  ('pattern','same','One coating',0,null,1), ('pattern','alternate','Two coatings, alternating',3,null,2), ('pattern','assorted','Assorted coatings',3,null,3),
  ('finish','choco_drizzle','Chocolate drizzle',3,null,1), ('finish','white_drizzle','White drizzle',3,null,2), ('finish','gold_star','Gold star',3,null,3),
  ('finish','gold_dust','Gold dust',3,null,4), ('finish','edible_glitter','Edible glitter',3,null,5),
  ('sprinkle','none','No sprinkles',0,null,1), ('sprinkle','white_pearls','White sugar pearls',0,null,2),
  ('sprinkle','nonpareils','Coloured nonpareils',3,null,3), ('sprinkle','gold_pearls','Gold pearls',3,null,4),
  ('theme','none','No toppers',0,null,1), ('theme','baby','Baby shower',3,null,2), ('theme','space','Outer space',3,null,3),
  ('theme','butterfly','Butterflies & daisies',3,null,4), ('theme','garden','Flower garden',3,null,5), ('theme','rainbow','Rainbows & clouds',3,null,6),
  ('theme','bows','Bows & hearts',3,null,7), ('theme','custom','Your own theme',3,null,8),
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
where p.slug = 'cake-pops'
on conflict (product_id, group_key, code) do nothing;

-- 3. Validation + pricing: the donut rules plus the pop shape ---------------------------------------------
create or replace function private.cakepop_design(p_product public.products, custom jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  style public.design_options; base jsonb; clean jsonb;
begin
  if jsonb_typeof(custom) is distinct from 'object' or custom->>'designer' is distinct from 'cakepop' then raise exception 'Invalid cake pop design.' using errcode = '22023'; end if;
  select * into style from public.design_options where product_id = p_product.id and group_key = 'style' and code = coalesce(custom->>'style', 'round') and is_active;
  if not found then raise exception 'Choose round cake pops or donut pops.' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(custom->'flavors', '["chocolate"]')) > 2 then raise exception 'Choose up to 2 flavors.' using errcode = '22023'; end if;
  -- Same glaze / finish / sprinkle / topper / message rules as the donut designer, on this product's options.
  base := private.donut_design(p_product, jsonb_set(custom || jsonb_build_object('flavors', coalesce(custom->'flavors', '["chocolate"]')), '{designer}', '"donut"'));
  clean := (base->'clean') || jsonb_build_object('designer', 'cakepop', 'style', style.code, 'style_label', style.label, 'style_' || style.code, 'yes',
             'summary', style.label || ' · ' || replace(base->'clean'->>'summary', 'glaze', 'coating'));   -- pops are coated, not glazed
  return jsonb_build_object('clean', clean, 'extra', base->'extra');
end $$;
revoke all on function private.cakepop_design(public.products, jsonb) from public;

create or replace function public.quote_cakepop_design(p_product_id uuid, p_design jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.products;
begin
  select * into p from public.products where id = p_product_id and status = 'active' and customization_config->>'designer' = 'cakepop';
  if not found then raise exception 'These cake pops cannot be designed right now.' using errcode = '22023'; end if;
  return private.cakepop_design(p, p_design);
end $$;
revoke all on function public.quote_cakepop_design(uuid, jsonb) from public;
grant execute on function public.quote_cakepop_design(uuid, jsonb) to anon, authenticated;

create or replace function private.product_design(p_product public.products, custom jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return case p_product.customization_config->>'designer'
    when 'bento' then private.bento_design(p_product, custom)
    when 'cupcake' then private.cupcake_design(p_product, custom)
    when 'donut' then private.donut_design(p_product, custom)
    when 'cakepop' then private.cakepop_design(p_product, custom)
    else null end;
end $$;
revoke all on function private.product_design(public.products, jsonb) from public;

-- 4. Checkout: accept cake pop designs too (fingerprint-checked, idempotent) ----------------------------
do $$
declare def text; fp text;
begin
  select md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) into fp from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'checkout';
  def := pg_get_functiondef('private.checkout(jsonb)'::regprocedure);
  if position($q$in ('bento','cupcake','donut','cakepop')$q$ in def) > 0 then return; end if;   -- already applied
  if fp <> '832e52a546e7825ce82d223eab8ffe27' then
    raise exception 'private.checkout differs from the expected version (%). Review before applying phase 38.', fp;
  end if;
  def := replace(def, $q$in ('bento','cupcake','donut')$q$, $q$in ('bento','cupcake','donut','cakepop')$q$);
  if position($q$in ('bento','cupcake','donut','cakepop')$q$ in def) = 0 then raise exception 'Could not update private.checkout safely.'; end if;
  execute def;
end $$;

-- 5. Chat design card: also for cake pop orders -----------------------------------------------------------
create or replace function private.chat_design_card() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.orders; thread_id uuid; entry jsonb; kind text := new.customization->>'designer';
begin
  if new.customization is null or kind is null or kind not in ('bento', 'cupcake', 'donut', 'cakepop') then return new; end if;
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
      'Your ' || case kind when 'cupcake' then 'cupcake' when 'donut' then 'donut' when 'cakepop' then 'cake pop' else 'bento' end || ' design for Order #' || o.order_number || ' is saved. This is what LexC''s will bake. Need a change? Reply here.',
      o.id, jsonb_build_array(entry))
    on conflict (order_id) where message_type = 'design_card'
    do update set attachments = public.chat_messages.attachments || excluded.attachments;
  return new;
end $$;
revoke all on function private.chat_design_card() from public;
