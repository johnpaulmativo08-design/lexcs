-- Phase 32: Bento cake designer — trusted options, prices and order validation.
--
-- The Bento Cake stays a normal ('standard') product: it can still be bought as-is (Plain ₱220 /
-- Chocolate ₱250). When a cart line carries a bento design, private.checkout now validates it against
-- public.design_options, prices the extras on the server and adds them to orders.customization_total
-- (already part of total_amount = items_subtotal + customization_total + delivery_fee).
-- Extras start at ₱3 each (owner's placeholder); change them in public.design_options, no code needed.
--
-- The migration refuses to run if private.checkout or private.sync_booking_for_order differ from the
-- versions it was written against (protects any live-only changes). Safe to re-run.

do $$
declare c text; b text;
begin
  -- Fingerprints ignore whitespace (the Supabase SQL editor can change spacing when pasting).
  select md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) into c from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'checkout';
  select md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) into b from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'sync_booking_for_order';
  if c not in ('d51ada0c6a136bddd2fce71f91f773cd') and position('bento_design' in (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'checkout')) = 0 then
    raise exception 'private.checkout differs from the expected version (%). Review before applying phase 32.', c;
  end if;
  if b not in ('c7dcbd16f97dcea8b8ef6986ca5d9692') and position('customization->>''summary''' in (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'sync_booking_for_order')) = 0 then
    raise exception 'private.sync_booking_for_order differs from the expected version (%). Review before applying phase 32.', b;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Design options: one row per selectable choice. price = extra charged per cake (₱).
create table if not exists public.design_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  group_key text not null check (group_key in ('color', 'border', 'lettering', 'accent', 'topper', 'message')),
  code text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  label text not null check (char_length(label) between 1 and 60),
  price numeric(12,2) not null default 0 check (price >= 0 and price <= 10000),
  hex text check (hex is null or hex ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (product_id, group_key, code)
);
alter table public.design_options enable row level security;
revoke all on public.design_options from anon, authenticated;
grant select on public.design_options to anon, authenticated;
grant insert, update, delete on public.design_options to authenticated;
drop policy if exists design_options_read on public.design_options;
create policy design_options_read on public.design_options for select to anon, authenticated
  using ((is_active and exists (select 1 from public.products p where p.id = product_id and p.status = 'active')) or (select private.is_admin()));
drop policy if exists design_options_admin_insert on public.design_options;
create policy design_options_admin_insert on public.design_options for insert to authenticated with check ((select private.is_admin()));
drop policy if exists design_options_admin_update on public.design_options;
create policy design_options_admin_update on public.design_options for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists design_options_admin_delete on public.design_options;
create policy design_options_admin_delete on public.design_options for delete to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- Bento Cake – Chocolate Moist: designer settings and the owner's option list.
update public.products
set customization_config = jsonb_build_object('designer', 'bento', 'version', 1, 'message_max', 42, 'message_max_lines', 3,
      'max_accents', 6, 'max_borders', 2, 'topper_text_pattern', '^[0-9]{1,3}$'),
    updated_at = now()
where slug = 'product-8';

insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order)
select p.id, o.group_key, o.code, o.label, o.price, o.hex, o.sort_order
from public.products p
cross join (values
  ('color','white','White',0,'#FFFFFF',1), ('color','ivory','Ivory',0,'#FFF8E7',2), ('color','cream','Cream',0,'#F6E7C8',3),
  ('color','butter','Butter yellow',0,'#F9E27D',4), ('color','lemon','Lemon',0,'#F4D03F',5), ('color','peach','Peach',0,'#F9C8A8',6),
  ('color','coral','Coral',0,'#F08A74',7), ('color','blush','Blush',0,'#F7D6DA',8), ('color','baby_pink','Baby pink',0,'#F4B6C8',9),
  ('color','pink','Pink',0,'#EE82A8',10), ('color','hot_pink','Hot pink',0,'#E0457B',11), ('color','red','Red',0,'#C8102E',12),
  ('color','burgundy','Burgundy',0,'#7A1F2B',13), ('color','lavender','Lavender',0,'#CDB8E8',14), ('color','lilac','Lilac',0,'#B79AD9',15),
  ('color','purple','Purple',0,'#7E57C2',16), ('color','periwinkle','Periwinkle',0,'#8C93E6',17), ('color','baby_blue','Baby blue',0,'#BFDDF4',18),
  ('color','sky_blue','Sky blue',0,'#7FB8E6',19), ('color','navy','Navy',0,'#1F3A6D',20), ('color','mint','Mint',0,'#BDE8D2',21),
  ('color','sage','Sage',0,'#A8BFA0',22), ('color','chocolate','Chocolate brown',0,'#5A3A2A',23), ('color','black','Black',0,'#1E1E1E',24),
  ('border','shell_top','Shell border — top',3,null,1), ('border','shell_bottom','Shell border — bottom',3,null,2),
  ('message','custom_message','Written message',3,null,1),
  ('lettering','piped','Piped letters',0,null,1), ('lettering','pearl_letters','Pearl letters',3,null,2),
  ('accent','pearls_gold','Gold pearls',3,'#D4AF37',1), ('accent','pearls_silver','Silver pearls',3,'#C0C0C0',2),
  ('accent','ribbon_bows','Ribbon bows',3,null,3), ('accent','piped_flowers','Piped flowers',3,null,4),
  ('accent','piped_leaves','Piped leaves and dots',3,null,5), ('accent','sprinkles','Sprinkles',3,null,6),
  ('accent','gold_leaf','Gold leaf flakes',3,'#D4AF37',7), ('accent','drip','Frosting drip',3,null,8),
  ('topper','none','No topper',0,null,1), ('topper','happy_birthday','“Happy Birthday” topper',3,null,2),
  ('topper','congrats','“Congrats” topper',3,null,3), ('topper','number','Number topper',3,null,4)
) as o(group_key, code, label, price, hex, sort_order)
where p.slug = 'product-8'
on conflict (product_id, group_key, code) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Validates a bento design against the product's options and returns
-- { clean: <normalised design incl. labels, prices, summary, recipe flags>, extra: <₱ per cake> }.
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

-- Customers can price a design before checkout (same rules, nothing stored).
create or replace function public.quote_bento_design(p_product_id uuid, p_design jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.products;
begin
  select * into p from public.products where id = p_product_id and status = 'active' and customization_config->>'designer' = 'bento';
  if not found then raise exception 'This cake cannot be designed right now.' using errcode = '22023'; end if;
  return private.bento_design(p, p_design);
end $$;
revoke all on function public.quote_bento_design(uuid, jsonb) from public;
grant execute on function public.quote_bento_design(uuid, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Checkout: identical to the previous version except the bento branch and customization_total.
create or replace function private.checkout(payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
 u uuid:=auth.uid(); request_key uuid; slot public.availability_slots; existing public.orders;
 item jsonb; variant public.product_variants; product public.products; custom jsonb;
 result_id uuid; line integer:=0; qty integer; subtotal numeric(12,2):=0;
 fulfillment text; total numeric(12,2); draft jsonb:='[]'; reference_path text;
 design jsonb; custom_total numeric(12,2):=0;
begin
 if u is null then raise exception 'Please sign in before checkout.' using errcode='42501'; end if;
 request_key:=(payload->>'request_id')::uuid;
 if request_key is null then raise exception 'Missing checkout request ID.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||request_key::text,0));
 select * into existing from public.orders where customer_id=u and client_request_id=request_key;
 if found then return to_jsonb(existing)||jsonb_build_object('items',(select jsonb_agg(to_jsonb(i) order by line_number) from public.order_items i where order_id=existing.id)); end if;
 if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 100 then raise exception 'Cart must contain between 1 and 100 items.'; end if;
 if length(trim(coalesce(payload->>'name',''))) not between 1 and 150 or length(trim(coalesce(payload->>'phone',''))) not between 5 and 40 then raise exception 'Enter a name and contact number.'; end if;
 fulfillment:=payload->>'fulfillment';
 if fulfillment is null or fulfillment not in ('pickup','lalamove') then raise exception 'Choose a fulfillment method.'; end if;
 if fulfillment='lalamove' and length(trim(coalesce(payload->>'address','')))=0 then raise exception 'Delivery address is required.'; end if;
 select * into slot from public.availability_slots where id=(payload->>'slot_id')::uuid for update;
 if not found or not slot.is_open or slot.starts_at<=now() then raise exception 'The receiving slot is unavailable.'; end if;
 if (select count(*) from public.orders where slot_id=slot.id and status<>'cancelled')>=slot.capacity then raise exception 'This receiving slot is fully booked. Choose another time.'; end if;
 for item in select value from jsonb_array_elements(payload->'items') loop
  qty:=(item->>'qty')::integer;
  if qty is null or qty not between 1 and 1000 then raise exception 'Invalid quantity.'; end if;
  select * into variant from public.product_variants where id=(item->>'variant_id')::uuid and is_active for share;
  if not found or qty<variant.min_qty then raise exception 'Product option is no longer available.'; end if;
  select * into product from public.products where id=variant.product_id and status='active' for share;
  if not found then raise exception 'Product is no longer available.'; end if;
  if product.category_id is not null and not exists(select 1 from public.categories where id=product.category_id and is_active) then raise exception 'Product category is unavailable.'; end if;
  custom:=null;
  if product.kind='customizable' then
   custom:=item->'customization';
   if jsonb_typeof(custom) is distinct from 'object'
    or coalesce(custom->>'base','') not in ('vanilla','chocolate')
    or coalesce(custom->>'frosting','') not in ('swirl','rose','smooth')
    or custom->>'frosting' is distinct from variant.code
    or coalesce(custom->>'color','') !~ '^#[0-9a-fA-F]{6}$'
    or coalesce(custom->>'topping','') not in ('none','sprinkles','minimallows','pearls')
    or jsonb_typeof(custom->'default_sprinkles') is distinct from 'boolean'
   then raise exception 'Invalid cupcake customization.'; end if;
   custom:=jsonb_build_object('base',custom->>'base','frosting',custom->>'frosting','color',custom->>'color','topping',custom->>'topping','default_sprinkles',custom->'default_sprinkles');
  elsif product.customization_config->>'designer'='bento' and item->'customization' is not null and item->'customization'<>'null'::jsonb then
   design:=private.bento_design(product, item->'customization');
   custom:=design->'clean';
   custom_total:=custom_total+(design->>'extra')::numeric*qty;
  elsif item->'customization' is not null and item->'customization'<>'null'::jsonb then raise exception 'Customization is not available for this product.';
  end if;
  reference_path:=nullif(item->>'reference_image_path','');
  if reference_path is not null and (split_part(reference_path,'/',1)<>u::text or not exists(select 1 from storage.objects where bucket_id='customer-references' and name=reference_path)) then raise exception 'Invalid reference image.'; end if;
  subtotal:=subtotal+variant.price*qty;
  draft:=draft||jsonb_build_array(jsonb_build_object('product_id',product.id,'variant_id',variant.id,'name',product.name,'label',variant.label,'package',product.package_contents,'qty',qty,'price',variant.price,'customization',custom,'reference',reference_path));
 end loop;
 total:=case when fulfillment='pickup' then subtotal+custom_total else null end;
 insert into public.orders(customer_id,client_request_id,customer_name,contact_phone,fulfillment_method,address,notes,slot_id,receiving_start,receiving_end,items_subtotal,customization_total,delivery_fee,delivery_fee_status,total_amount,deposit_due,requested_payment_method)
 values(u,request_key,trim(payload->>'name'),trim(payload->>'phone'),fulfillment,left(payload->>'address',1000),left(payload->>'notes',3000),slot.id,slot.starts_at,slot.ends_at,subtotal,custom_total,case when fulfillment='pickup' then 0 else null end,case when fulfillment='pickup' then 'not_applicable' else 'unquoted' end,total,round(total*.6),payload->>'payment_method')
 returning id into result_id;
 for item in select value from jsonb_array_elements(draft) loop
  line:=line+1;
  insert into public.order_items(order_id,line_number,product_id,variant_id,name_snapshot,variant_label_snapshot,package_contents_snapshot,quantity,unit_price,line_total,customization,reference_image_path)
  values(result_id,line,(item->>'product_id')::uuid,(item->>'variant_id')::uuid,item->>'name',item->>'label',item->'package',(item->>'qty')::integer,(item->>'price')::numeric,(item->>'qty')::integer*(item->>'price')::numeric,item->'customization',item->>'reference');
 end loop;
 return (select to_jsonb(o)||jsonb_build_object('items',(select jsonb_agg(to_jsonb(i) order by line_number) from public.order_items i where order_id=result_id)) from public.orders o where id=result_id);
end $function$;

-- Booking calendar: use the design's readable summary instead of raw JSON when it has one.
create or replace function private.sync_booking_for_order(target_order_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare source_order public.orders; summary text; custom_summary text;
begin
  select * into source_order from public.orders where id=target_order_id;
  if not found then return; end if;
  select coalesce(string_agg(i.name_snapshot || case when i.quantity > 1 then ' ×' || i.quantity else '' end, ', ' order by i.line_number),'Order'),
         nullif(string_agg(case when i.customization is not null and i.customization <> 'null'::jsonb then i.name_snapshot || ': ' || coalesce(left(i.customization->>'summary',400), left(i.customization::text,220)) end, ' · ' order by i.line_number),'')
    into summary, custom_summary
  from public.order_items i where i.order_id=target_order_id;
  insert into public.booking_entries(order_id,customer_id,customer_name,customer_contact,order_reference,order_summary,customization_summary,booking_date,scheduled_start,scheduled_end,fulfillment_method,status,payment_status,order_total,deposit_due,amount_paid,notes,created_by)
  values(source_order.id,source_order.customer_id,source_order.customer_name,source_order.contact_phone,'ORD-'||source_order.order_number,summary,custom_summary,(source_order.receiving_start at time zone 'Asia/Manila')::date,(source_order.receiving_start at time zone 'Asia/Manila')::time,(source_order.receiving_end at time zone 'Asia/Manila')::time,source_order.fulfillment_method,source_order.status,source_order.payment_status,source_order.total_amount,source_order.deposit_due,source_order.amount_paid,source_order.notes,source_order.customer_id)
  on conflict(order_id) do update set
    customer_id=excluded.customer_id, customer_name=excluded.customer_name, customer_contact=excluded.customer_contact,
    order_reference=excluded.order_reference, order_summary=excluded.order_summary, customization_summary=excluded.customization_summary,
    booking_date=excluded.booking_date, scheduled_start=excluded.scheduled_start, scheduled_end=excluded.scheduled_end,
    fulfillment_method=excluded.fulfillment_method, status=excluded.status, payment_status=excluded.payment_status,
    order_total=excluded.order_total, deposit_due=excluded.deposit_due, amount_paid=excluded.amount_paid, notes=excluded.notes;
end $function$;
