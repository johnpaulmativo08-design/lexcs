-- Generate readable item prefixes (Full Cream Milk → FCM) and make collisions deterministic.
create or replace function private.inventory_code(item_name text) returns text language sql immutable set search_path='' as $$
  select left(coalesce((select string_agg(left(token, 1), '' order by position)
    from unnest(regexp_split_to_array(trim(item_name), '\s+')) with ordinality as words(token, position)
    where token <> ''), ''), 8)
$$;

create or replace function private.inventory_action(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); action text:=payload->>'action'; b public.inventory_batches; m public.inventory_movements; item public.inventory_items; qty numeric(14,3):=nullif(payload->>'quantity','')::numeric; req uuid:=nullif(payload->>'request_id','')::uuid; code text; prefix text; candidate text; n integer; seq integer; received timestamptz:=coalesce(nullif(payload->>'received_at','')::timestamptz,now()); begin
 if u is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
 perform private.expire_inventory_batches();
 if req is null or qty is null or qty<=0 then raise exception 'A request ID and a positive quantity are required.'; end if;
 select * into m from public.inventory_movements where request_id=req; if found then return jsonb_build_object('movement_id',m.id,'batch_id',m.batch_id); end if;
 if action='restock' then
  if nullif(trim(coalesce(payload->>'item_id','')),'') is not null then select * into item from public.inventory_items where id=(payload->>'item_id')::uuid and not is_archived for update; else
   if length(trim(coalesce(payload->>'item_name','')))<2 or length(trim(coalesce(payload->>'unit','')))<1 then raise exception 'Item name and unit are required.'; end if;
   select * into item from public.inventory_items where lower(name)=lower(trim(payload->>'item_name')) and unit=trim(payload->>'unit') for update;
   if not found then
    prefix:=coalesce(nullif(upper(trim(payload->>'item_code')),''),nullif(private.inventory_code(payload->>'item_name'),''),'INV'); candidate:=prefix; seq:=2;
    while exists(select 1 from public.inventory_items where item_code=candidate) loop candidate:=left(prefix,6)||seq::text; seq:=seq+1; end loop;
    insert into public.inventory_items(name,category,inventory_type,unit,min_stock,item_code) values(trim(payload->>'item_name'),coalesce(nullif(trim(payload->>'category'),''),'Other'),coalesce(nullif(payload->>'inventory_type',''),'ingredient'),trim(payload->>'unit'),coalesce(nullif(payload->>'min_stock','')::numeric,0),candidate) returning * into item;
   end if;
  end if;
  if not found then raise exception 'Active inventory item required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(item.id::text,0));
  prefix:=coalesce(item.item_code,nullif(private.inventory_code(item.name),''),'INV');
  if item.item_code is null then update public.inventory_items set item_code=prefix where id=item.id; end if;
  select count(*)+1 into n from public.inventory_batches where item_id=item.id; code:=prefix||'-'||lpad(n::text,3,'0');
  insert into public.inventory_batches(item_id,batch_code,quantity_received,received_at,expires_on,purchase_price,notes) values(item.id,code,qty,received,nullif(payload->>'expires_on','')::date,nullif(payload->>'purchase_price','')::numeric,nullif(payload->>'note','')) returning * into b;
  insert into public.inventory_movements(batch_id,quantity_delta,reason,movement_type,note,reference,created_by,request_id) values(b.id,qty,'receipt','restock',nullif(payload->>'note',''),nullif(payload->>'reference',''),u,req) returning * into m;
 else
  select * into b from public.inventory_batches where id=(payload->>'batch_id')::uuid for update; if not found or b.archived_at is not null then raise exception 'Active batch not found.'; end if;
  if (select coalesce(sum(quantity_delta),0) from public.inventory_movements where batch_id=b.id)<qty then raise exception 'Usage cannot exceed the quantity remaining in this batch.'; end if;
  if action not in ('stock_usage','waste','remake','damaged','adjustment_negative') then raise exception 'Invalid stock-out action.'; end if;
  insert into public.inventory_movements(batch_id,quantity_delta,reason,movement_type,note,reference,created_by,request_id) values(b.id,-qty,case when action in ('waste','remake','damaged') then 'waste' else case when action='adjustment_negative' then 'adjustment' else 'usage' end end,action,nullif(payload->>'note',''),nullif(payload->>'reference',''),u,req) returning * into m;
 end if;
 perform private.sync_inventory_alerts();
 return jsonb_build_object('movement_id',m.id,'batch_id',m.batch_id,'batch_code',coalesce(b.batch_code,code),'item_id',coalesce(b.item_id,item.id));
end $$;
