-- Phase 3: batch-first inventory, alerts, expiry and immutable stock ledger.
-- This migration intentionally has no product/recipe mapping.

alter table public.inventory_items
  add column if not exists inventory_type text not null default 'ingredient' check(inventory_type in ('ingredient','packaging')),
  add column if not exists item_code text,
  add column if not exists expiring_window_days integer not null default 7 check(expiring_window_days between 1 and 365);
create unique index if not exists inventory_item_code_unique on public.inventory_items(item_code) where item_code is not null;

alter table public.inventory_batches
  add column if not exists quantity_received numeric(14,3) not null default 0 check(quantity_received>=0),
  add column if not exists purchase_price numeric(12,2) check(purchase_price>=0),
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;
create index if not exists inventory_batches_active_expiry_idx on public.inventory_batches(expires_on) where archived_at is null and expires_on is not null;

alter table public.inventory_movements add column if not exists movement_type text;
alter table public.inventory_movements add column if not exists reference text;
alter table public.inventory_movements drop constraint if exists inventory_movements_reason_check;
alter table public.inventory_movements add constraint inventory_movements_reason_check check(reason in ('receipt','usage','waste','adjustment','expired'));
alter table public.inventory_movements add constraint inventory_movements_movement_type_check check(movement_type is null or movement_type in ('restock','stock_usage','waste','remake','damaged','adjustment_positive','adjustment_negative','expired'));
update public.inventory_movements set movement_type=case reason when 'receipt' then 'restock' when 'usage' then 'stock_usage' when 'waste' then 'waste' else 'adjustment_positive' end where movement_type is null;
alter table public.inventory_movements alter column movement_type set not null;
create index if not exists inventory_movements_batch_created_idx on public.inventory_movements(batch_id,created_at desc);

create table if not exists public.inventory_alert_state (
  alert_key text primary key, condition text not null check(condition in ('out_of_stock','low_stock','expiring_soon','expired')),
  item_id uuid references public.inventory_items(id) on delete cascade,
  batch_id uuid references public.inventory_batches(id) on delete cascade,
  is_active boolean not null default true, changed_at timestamptz not null default now()
);
create table if not exists public.inventory_notifications (
  id uuid primary key default gen_random_uuid(), alert_key text not null unique,
  item_id uuid references public.inventory_items(id) on delete cascade,
  batch_id uuid references public.inventory_batches(id) on delete cascade,
  title text not null, detail text not null default '',
  is_read boolean not null default false, created_at timestamptz not null default now(), read_at timestamptz
);
create index if not exists inventory_notifications_unread_idx on public.inventory_notifications(is_read,created_at desc);
alter table public.inventory_alert_state enable row level security;
alter table public.inventory_notifications enable row level security;
revoke all on public.inventory_alert_state,public.inventory_notifications from anon,authenticated;
grant select on public.inventory_alert_state,public.inventory_notifications to authenticated;
create policy inventory_alert_admin_read on public.inventory_alert_state for select to authenticated using((select private.is_admin()));
create policy inventory_notification_admin_read on public.inventory_notifications for select to authenticated using((select private.is_admin()));

create or replace function private.inventory_code(item_name text) returns text language sql immutable set search_path='' as $$
  select left(upper(coalesce((select string_agg(left(word,1),'') from regexp_split_to_table(trim(item_name),'\\s+') word where word<>''),'')),8)
$$;
revoke all on function private.inventory_code(text) from public;

create or replace view public.inventory_batch_stock with (security_invoker=true) as
select b.id as batch_id,b.batch_code,b.item_id,i.name,i.category,i.inventory_type,i.unit,i.min_stock,i.expiring_window_days,
 b.quantity_received,b.received_at,b.expires_on,b.purchase_price,b.notes,b.archived_at,b.archive_reason,
 coalesce(sum(m.quantity_delta),0) as remaining_quantity,
 case when b.archived_at is not null then coalesce(b.archive_reason,'Archived')
      when coalesce(sum(m.quantity_delta),0)<=0 then 'Out of Stock'
      when coalesce(sum(m.quantity_delta),0)<=i.min_stock then 'Low Stock'
      when b.expires_on is not null and b.expires_on >= (now() at time zone 'Asia/Manila')::date and b.expires_on < ((now() at time zone 'Asia/Manila')::date+i.expiring_window_days) then 'Expiring Soon'
      else 'In Stock' end as status
from public.inventory_batches b join public.inventory_items i on i.id=b.item_id
left join public.inventory_movements m on m.batch_id=b.id
group by b.id,i.id;
grant select on public.inventory_batch_stock to authenticated;

create or replace function private.expire_inventory_batches() returns integer language plpgsql security definer set search_path='' as $$
declare r record; qty numeric; total integer:=0; ph_today date:=(now() at time zone 'Asia/Manila')::date; begin
 for r in select b.id,b.item_id,b.batch_code,b.expires_on from public.inventory_batches b where b.archived_at is null and b.expires_on<ph_today for update loop
  select coalesce(sum(quantity_delta),0) into qty from public.inventory_movements where batch_id=r.id;
  if qty>0 then
   insert into public.inventory_movements(batch_id,quantity_delta,reason,movement_type,note,created_by,request_id)
   values(r.id,-qty,'expired','expired','Expiry date reached',coalesce((select id from public.profiles order by created_at limit 1),auth.uid()),gen_random_uuid());
   update public.inventory_batches set archived_at=now(),archive_reason='Expired' where id=r.id;
   total:=total+1;
  else update public.inventory_batches set archived_at=now(),archive_reason='Depleted before expiry' where id=r.id; end if;
 end loop;
 return total;
end $$;
revoke all on function private.expire_inventory_batches() from public;

create or replace function private.sync_inventory_alerts() returns void language plpgsql security definer set search_path='' as $$
declare r record; k text; is_current boolean; begin
 for r in select * from public.inventory_batch_stock where archived_at is null loop
  foreach k in array array[
    case when r.remaining_quantity<=0 then 'out_of_stock:item:'||r.item_id end,
    case when r.remaining_quantity>0 and r.remaining_quantity<=r.min_stock then 'low_stock:item:'||r.item_id end,
    case when r.status='Expiring Soon' then 'expiring_soon:batch:'||r.batch_id end
  ] loop
   if k is null then continue; end if;
   is_current:=coalesce((select is_active from public.inventory_alert_state where alert_key=k),false);
   insert into public.inventory_alert_state(alert_key,condition,item_id,batch_id,is_active,changed_at)
   values(k,split_part(k,':',1),r.item_id,case when k like '%batch:%' then r.batch_id else null end,true,now())
   on conflict(alert_key) do update set is_active=true,changed_at=case when not inventory_alert_state.is_active then now() else inventory_alert_state.changed_at end;
   if not is_current then
    insert into public.inventory_notifications(alert_key,item_id,batch_id,title,detail)
    values(k,r.item_id,case when k like '%batch:%' then r.batch_id else null end,
      case split_part(k,':',1) when 'out_of_stock' then r.name||' is out of stock' when 'low_stock' then r.name||' is low in stock' else r.name||' is expiring soon' end,
      case split_part(k,':',1) when 'expiring_soon' then r.batch_code||' · expires '||r.expires_on::text else r.remaining_quantity||' '||r.unit||' remaining' end)
    on conflict(alert_key) do update set is_read=false,read_at=null,created_at=now(),detail=excluded.detail;
   end if;
  end loop;
 end loop;
 update public.inventory_alert_state s set is_active=false where is_active and not exists(
   select 1 from public.inventory_batch_stock b where b.archived_at is null and (
    (s.condition='out_of_stock' and s.item_id=b.item_id and b.remaining_quantity<=0) or
    (s.condition='low_stock' and s.item_id=b.item_id and b.remaining_quantity>0 and b.remaining_quantity<=b.min_stock) or
    (s.condition='expiring_soon' and s.batch_id=b.batch_id and b.status='Expiring Soon')
   ));
 for r in select b.*,i.name,i.unit from public.inventory_batches b join public.inventory_items i on i.id=b.item_id where b.archive_reason='Expired' loop
  k:='expired:batch:'||r.id;
  insert into public.inventory_alert_state(alert_key,condition,item_id,batch_id,is_active) values(k,'expired',r.item_id,r.id,true) on conflict(alert_key) do nothing;
  insert into public.inventory_notifications(alert_key,item_id,batch_id,title,detail) values(k,r.item_id,r.id,r.batch_code||' has expired',r.name||' · expired stock moved to archive') on conflict(alert_key) do nothing;
 end loop;
end $$;
revoke all on function private.sync_inventory_alerts() from public;

create or replace function private.inventory_action(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); action text:=payload->>'action'; b public.inventory_batches; m public.inventory_movements; item public.inventory_items; qty numeric(14,3):=nullif(payload->>'quantity','')::numeric; req uuid:=nullif(payload->>'request_id','')::uuid; code text; prefix text; n integer; received timestamptz:=coalesce(nullif(payload->>'received_at','')::timestamptz,now()); begin
 if u is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
 perform private.expire_inventory_batches();
 if req is null or qty is null or qty<=0 then raise exception 'A request ID and a positive quantity are required.'; end if;
 select * into m from public.inventory_movements where request_id=req; if found then return jsonb_build_object('movement_id',m.id,'batch_id',m.batch_id); end if;
 if action='restock' then
  if nullif(trim(coalesce(payload->>'item_id','')),'') is not null then select * into item from public.inventory_items where id=(payload->>'item_id')::uuid and not is_archived for update; else
   if length(trim(coalesce(payload->>'item_name','')))<2 or length(trim(coalesce(payload->>'unit','')))<1 then raise exception 'Item name and unit are required.'; end if;
   select * into item from public.inventory_items where lower(name)=lower(trim(payload->>'item_name')) and unit=trim(payload->>'unit') for update;
   if not found then insert into public.inventory_items(name,category,inventory_type,unit,min_stock,item_code) values(trim(payload->>'item_name'),coalesce(nullif(trim(payload->>'category'),''),'Other'),coalesce(nullif(payload->>'inventory_type',''),'ingredient'),trim(payload->>'unit'),coalesce(nullif(payload->>'min_stock','')::numeric,0),nullif(upper(trim(payload->>'item_code')),'')) returning * into item; end if;
  end if;
  if not found then raise exception 'Active inventory item required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(item.id::text,0));
  prefix:=coalesce(item.item_code,nullif(private.inventory_code(item.name),''),'INV');
  if item.item_code is null then update public.inventory_items set item_code=prefix where id=item.id; end if;
  select count(*)+1 into n from public.inventory_batches where item_id=item.id;
  code:=prefix||'-'||lpad(n::text,3,'0');
  insert into public.inventory_batches(item_id,batch_code,quantity_received,received_at,expires_on,purchase_price,notes)
    values(item.id,code,qty,received,nullif(payload->>'expires_on','')::date,nullif(payload->>'purchase_price','')::numeric,nullif(payload->>'note','')) returning * into b;
  insert into public.inventory_movements(batch_id,quantity_delta,reason,movement_type,note,reference,created_by,request_id) values(b.id,qty,'receipt','restock',nullif(payload->>'note',''),nullif(payload->>'reference',''),u,req) returning * into m;
 else
  select * into b from public.inventory_batches where id=(payload->>'batch_id')::uuid for update; if not found or b.archived_at is not null then raise exception 'Active batch not found.'; end if;
  if (select coalesce(sum(quantity_delta),0) from public.inventory_movements where batch_id=b.id)<qty then raise exception 'Usage cannot exceed the quantity remaining in this batch.'; end if;
  if action not in ('stock_usage','waste','remake','damaged','adjustment_negative') then raise exception 'Invalid stock-out action.'; end if;
  insert into public.inventory_movements(batch_id,quantity_delta,reason,movement_type,note,reference,created_by,request_id)
   values(b.id,-qty,case when action in ('waste','remake','damaged') then 'waste' else case when action='adjustment_negative' then 'adjustment' else 'usage' end end,action,nullif(payload->>'note',''),nullif(payload->>'reference',''),u,req) returning * into m;
 end if;
 perform private.sync_inventory_alerts();
 return jsonb_build_object('movement_id',m.id,'batch_id',m.batch_id,'batch_code',coalesce(b.batch_code,code),'item_id',coalesce(b.item_id,item.id));
end $$;
revoke all on function private.inventory_action(jsonb) from public;
create or replace function public.inventory_action(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.inventory_action(payload) $$;
revoke all on function public.inventory_action(jsonb) from public; grant execute on function public.inventory_action(jsonb) to authenticated;

create or replace function public.inventory_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
 perform private.expire_inventory_batches(); perform private.sync_inventory_alerts();
 return jsonb_build_object('batches',(select coalesce(jsonb_agg(to_jsonb(b) order by b.received_at desc),'[]') from public.inventory_batch_stock b),'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc),'[]') from public.inventory_movements m),'notifications',(select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]') from public.inventory_notifications n));
end $$;
revoke all on function public.inventory_snapshot() from public; grant execute on function public.inventory_snapshot() to authenticated;

create or replace function public.read_inventory_notifications(mark_all boolean default false, notification_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if; update public.inventory_notifications set is_read=true,read_at=now() where not is_read and (mark_all or id=notification_id); end $$;
revoke all on function public.read_inventory_notifications(boolean,uuid) from public; grant execute on function public.read_inventory_notifications(boolean,uuid) to authenticated;
