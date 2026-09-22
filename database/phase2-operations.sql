-- Atomic checkout and management APIs; prices and authorization are server-owned.
create function private.checkout(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); request_key uuid; slot public.availability_slots; existing public.orders;
 item jsonb; variant public.product_variants; product public.products; custom jsonb;
 result_id uuid; line integer:=0; qty integer; subtotal numeric(12,2):=0;
 fulfillment text; total numeric(12,2); draft jsonb:='[]'; reference_path text;
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
  elsif item->'customization' is not null and item->'customization'<>'null'::jsonb then raise exception 'Customization is not available for this product.';
  end if;
  reference_path:=nullif(item->>'reference_image_path','');
  if reference_path is not null and (split_part(reference_path,'/',1)<>u::text or not exists(select 1 from storage.objects where bucket_id='customer-references' and name=reference_path)) then raise exception 'Invalid reference image.'; end if;
  subtotal:=subtotal+variant.price*qty;
  draft:=draft||jsonb_build_array(jsonb_build_object('product_id',product.id,'variant_id',variant.id,'name',product.name,'label',variant.label,'package',product.package_contents,'qty',qty,'price',variant.price,'customization',custom,'reference',reference_path));
 end loop;
 total:=case when fulfillment='pickup' then subtotal else null end;
 insert into public.orders(customer_id,client_request_id,customer_name,contact_phone,fulfillment_method,address,notes,slot_id,receiving_start,receiving_end,items_subtotal,delivery_fee,delivery_fee_status,total_amount,deposit_due,requested_payment_method)
 values(u,request_key,trim(payload->>'name'),trim(payload->>'phone'),fulfillment,left(payload->>'address',1000),left(payload->>'notes',3000),slot.id,slot.starts_at,slot.ends_at,subtotal,case when fulfillment='pickup' then 0 else null end,case when fulfillment='pickup' then 'not_applicable' else 'unquoted' end,total,round(total*.6),payload->>'payment_method')
 returning id into result_id;
 for item in select value from jsonb_array_elements(draft) loop
  line:=line+1;
  insert into public.order_items(order_id,line_number,product_id,variant_id,name_snapshot,variant_label_snapshot,package_contents_snapshot,quantity,unit_price,line_total,customization,reference_image_path)
  values(result_id,line,(item->>'product_id')::uuid,(item->>'variant_id')::uuid,item->>'name',item->>'label',item->'package',(item->>'qty')::integer,(item->>'price')::numeric,(item->>'qty')::integer*(item->>'price')::numeric,item->'customization',item->>'reference');
 end loop;
 return (select to_jsonb(o)||jsonb_build_object('items',(select jsonb_agg(to_jsonb(i) order by line_number) from public.order_items i where order_id=result_id)) from public.orders o where id=result_id);
end $$;
revoke all on function private.checkout(jsonb) from public;
grant execute on function private.checkout(jsonb) to authenticated;
create function public.create_order(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.checkout(payload) $$;
revoke all on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to authenticated;

create function private.slot_availability(from_date timestamptz,to_date timestamptz)
returns table(id uuid,starts_at timestamptz,ends_at timestamptz,remaining bigint)
language sql stable security definer set search_path='' as $$
 select s.id,s.starts_at,s.ends_at,greatest(0,s.capacity-count(o.id)) from public.availability_slots s
 left join public.orders o on o.slot_id=s.id and o.status<>'cancelled'
 where s.is_open and s.starts_at>now() and s.starts_at>=from_date and s.starts_at<least(to_date,from_date+interval '93 days')
 group by s.id order by s.starts_at
$$;
revoke all on function private.slot_availability(timestamptz,timestamptz) from public;
grant execute on function private.slot_availability(timestamptz,timestamptz) to anon,authenticated;
create function public.get_availability(from_date timestamptz,to_date timestamptz)
returns table(id uuid,starts_at timestamptz,ends_at timestamptz,remaining bigint)
language sql stable security invoker set search_path='' as $$ select * from private.slot_availability(from_date,to_date) $$;
revoke all on function public.get_availability(timestamptz,timestamptz) from public;
grant execute on function public.get_availability(timestamptz,timestamptz) to anon,authenticated;

create function private.save_slot(payload jsonb) returns public.availability_slots language plpgsql security definer set search_path='' as $$
declare s public.availability_slots; target uuid:=(payload->>'id')::uuid; begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
 if target is not null then
  select * into s from public.availability_slots where id=target for update;
  if not found then raise exception 'Slot not found.'; end if;
  if exists(select 1 from public.orders where slot_id=target) and ((payload->>'starts_at')::timestamptz<>s.starts_at or (payload->>'ends_at')::timestamptz<>s.ends_at) then raise exception 'Booked slot times cannot change.'; end if;
  if (payload->>'capacity')::integer<(select count(*) from public.orders where slot_id=target and status<>'cancelled') then raise exception 'Capacity cannot be lower than existing bookings.'; end if;
  update public.availability_slots set starts_at=(payload->>'starts_at')::timestamptz,ends_at=(payload->>'ends_at')::timestamptz,capacity=(payload->>'capacity')::integer,is_open=(payload->>'is_open')::boolean where id=target returning * into s;
 else
  insert into public.availability_slots(starts_at,ends_at,capacity,is_open) values((payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,(payload->>'capacity')::integer,coalesce((payload->>'is_open')::boolean,true)) returning * into s;
 end if;
 return s;
end $$;
revoke all on function private.save_slot(jsonb) from public;
grant execute on function private.save_slot(jsonb) to authenticated;
create function public.save_slot(payload jsonb) returns public.availability_slots language sql security invoker set search_path='' as $$ select private.save_slot(payload) $$;
revoke all on function public.save_slot(jsonb) from public;
grant execute on function public.save_slot(jsonb) to authenticated;

create function private.set_order_status(order_id uuid,next_status text) returns public.orders language plpgsql security definer set search_path='' as $$
declare o public.orders; begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
 -- Same slot-first lock order as checkout; cancelled orders are never reactivated.
 perform 1 from public.availability_slots where id=(select slot_id from public.orders where id=order_id) for update;
 select * into o from public.orders where id=order_id for update;
 if not found then raise exception 'Order not found.'; end if;
 if next_status is not null and next_status=o.status then return o; end if;
 if not coalesce((o.status='pending' and next_status in ('confirmed','cancelled')) or (o.status='confirmed' and next_status in ('preparing','cancelled')) or (o.status='preparing' and next_status in ('ready','cancelled')) or (o.status='ready' and next_status in ('completed','cancelled')),false) then raise exception 'Invalid order status transition.'; end if;
 update public.orders set status=next_status where id=order_id returning * into o;
 return o;
end $$;
revoke all on function private.set_order_status(uuid,text) from public;
grant execute on function private.set_order_status(uuid,text) to authenticated;
create function public.set_order_status(order_id uuid,next_status text) returns public.orders language sql security invoker set search_path='' as $$ select private.set_order_status(order_id,next_status) $$;
revoke all on function public.set_order_status(uuid,text) from public;
grant execute on function public.set_order_status(uuid,text) to authenticated;

create function private.record_inventory(payload jsonb) returns public.inventory_movements language plpgsql security definer set search_path='' as $$
declare b uuid:=(payload->>'batch_id')::uuid; delta numeric(14,3):=(payload->>'quantity')::numeric; m public.inventory_movements; k uuid:=(payload->>'request_id')::uuid; begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
 if k is null or delta is null or delta=0 then raise exception 'Request ID and a nonzero quantity are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(k::text,0));
 select * into m from public.inventory_movements where request_id=k;
 if found then return m; end if;
 if b is null then
  if delta<=0 or payload->>'reason'<>'receipt' then raise exception 'New batches require a positive receipt.'; end if;
  if not exists(select 1 from public.inventory_items where id=(payload->>'item_id')::uuid and not is_archived) then raise exception 'Active inventory item required.'; end if;
  insert into public.inventory_batches(item_id,batch_code,expires_on,notes) values((payload->>'item_id')::uuid,payload->>'batch_code',nullif(payload->>'expires_on','')::date,payload->>'note') returning id into b;
 end if;
 perform 1 from public.inventory_batches where id=b for update;
 if not found then raise exception 'Batch not found.'; end if;
 if (select coalesce(sum(quantity_delta),0) from public.inventory_movements where batch_id=b)+delta<0 then raise exception 'Insufficient batch stock.'; end if;
 if payload->>'reason'='receipt' and delta<0 or payload->>'reason' in ('usage','waste') and delta>0 then raise exception 'Quantity sign does not match movement type.'; end if;
 insert into public.inventory_movements(batch_id,quantity_delta,reason,note,created_by,request_id) values(b,delta,payload->>'reason',payload->>'note',auth.uid(),k) returning * into m;
 return m;
end $$;
revoke all on function private.record_inventory(jsonb) from public;
grant execute on function private.record_inventory(jsonb) to authenticated;
create function public.record_inventory(payload jsonb) returns public.inventory_movements language sql security invoker set search_path='' as $$ select private.record_inventory(payload) $$;
revoke all on function public.record_inventory(jsonb) from public;
grant execute on function public.record_inventory(jsonb) to authenticated;

create function private.submit_review(payload jsonb) returns public.reviews language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r public.reviews; path text:=nullif(payload->>'image_path',''); begin
 if u is null then raise exception 'Sign in required.' using errcode='42501'; end if;
 if not exists(select 1 from public.orders where id=(payload->>'order_id')::uuid and customer_id=u and status='completed') then raise exception 'Only your completed orders can be reviewed.'; end if;
 if length(trim(coalesce(payload->>'display_name','')))=0 or length(coalesce(payload->>'text',''))>3000 then raise exception 'Enter a display name and a review of at most 3000 characters.'; end if;
 if path is not null and (split_part(path,'/',1)<>u::text or not exists(select 1 from storage.objects where bucket_id='review-images' and name=path)) then raise exception 'Invalid review image.'; end if;
 insert into public.reviews(order_id,customer_id,rating,review_text,public_display_name,image_path)
 values((payload->>'order_id')::uuid,u,(payload->>'rating')::integer,coalesce(payload->>'text',''),left(trim(payload->>'display_name'),100),path)
 on conflict(order_id) do update set rating=excluded.rating,review_text=excluded.review_text,public_display_name=excluded.public_display_name,image_path=excluded.image_path,visibility='hidden'
 returning * into r;
 return r;
end $$;
revoke all on function private.submit_review(jsonb) from public;
grant execute on function private.submit_review(jsonb) to authenticated;
create function public.submit_review(payload jsonb) returns public.reviews language sql security invoker set search_path='' as $$ select private.submit_review(payload) $$;
revoke all on function public.submit_review(jsonb) from public;
grant execute on function public.submit_review(jsonb) to authenticated;

create view public.inventory_stock with(security_invoker=true) as
select i.id,i.name,i.category,i.unit,i.min_stock,i.is_archived,coalesce(sum(m.quantity_delta),0) as stock
from public.inventory_items i left join public.inventory_batches b on b.item_id=i.id left join public.inventory_movements m on m.batch_id=b.id group by i.id;
grant select on public.inventory_stock to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('catalog-media','catalog-media',true,5242880,array['image/jpeg','image/png','image/webp']),
 ('customer-references','customer-references',false,5242880,array['image/jpeg','image/png','image/webp']),
 ('review-images','review-images',false,5242880,array['image/jpeg','image/png','image/webp']),
 ('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy catalog_upload on storage.objects for insert to authenticated with check(bucket_id='catalog-media' and (select private.is_admin()) and (storage.foldername(name))[1] in ('products','gallery'));
create policy catalog_read on storage.objects for select to authenticated using(bucket_id='catalog-media' and (select private.is_admin()));
-- Files are immutable: new UUID filenames prevent historical images being overwritten.
create policy private_image_upload on storage.objects for insert to authenticated with check(bucket_id in ('customer-references','review-images','avatars') and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy private_image_read on storage.objects for select to authenticated using(bucket_id in ('customer-references','review-images','avatars') and ((storage.foldername(name))[1]=(select auth.uid())::text or (select private.is_admin())));
create function private.review_image_visible(object_name text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.reviews where image_path=object_name and visibility='visible') $$;
revoke all on function private.review_image_visible(text) from public;
grant execute on function private.review_image_visible(text) to anon,authenticated;
create policy visible_review_image on storage.objects for select to anon,authenticated using(bucket_id='review-images' and private.review_image_visible(name));

