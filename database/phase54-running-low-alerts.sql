-- Phase 54: stock alerts per material, plus an early "running low" warning.
-- Before: alerts compared each BATCH with the material's minimum, so a small leftover batch raised "low in stock"
-- (and every emptied batch "out of stock") even when the material had plenty in its other batches.
-- Now every alert uses the material's total usable stock, the same number its status shows:
--   out of stock  → nothing usable left
--   low stock     → at or below the minimum
--   running low   → within the warning margin above the minimum (default 5 of the material's own unit:
--                   5 kg, 5 pcs, 5 g, 5 mL; change it per material in Settings)
-- A batch on its own is no longer called "Low Stock". Safe to re-run.
begin;

alter table public.inventory_items add column if not exists warning_margin numeric(14,3) not null default 5;
alter table public.inventory_items drop constraint if exists inventory_items_warning_margin_check;
alter table public.inventory_items add constraint inventory_items_warning_margin_check check (warning_margin >= 0);

alter table public.inventory_alert_state drop constraint if exists inventory_alert_state_condition_check;
alter table public.inventory_alert_state add constraint inventory_alert_state_condition_check
  check (condition in ('out_of_stock','low_stock','running_low','expiring_soon','expired'));

-- material status: "Running Low" sits between Low Stock and In Stock (warning_margin is added at the end)
create or replace view public.inventory_item_stock with (security_invoker = true) as
select i.id, i.name, i.category, i.inventory_type, i.unit, i.min_stock, i.item_code, i.estimated_unit_cost, i.expiring_window_days, i.updated_at,
  coalesce(s.on_hand, 0) as on_hand,
  coalesce(s.usable, 0) as available,
  s.next_expiry,
  s.expiring_quantity,
  s.active_batches,
  s.last_movement_at,
  case when coalesce(s.usable, 0) <= 0 then 'Out of Stock'
       when coalesce(s.usable, 0) <= i.min_stock then 'Low Stock'
       when coalesce(s.usable, 0) <= i.min_stock + i.warning_margin then 'Running Low'
       when coalesce(s.expiring_quantity, 0) > 0 then 'Expiring Soon'
       else 'In Stock' end as status,
  i.warning_margin
from public.inventory_items i
left join lateral (
  select sum(bq.qty) as on_hand,
    sum(bq.qty) filter (where bq.archived_at is null and (bq.expires_on is null or bq.expires_on >= (now() at time zone 'Asia/Manila')::date)) as usable,
    min(bq.expires_on) filter (where bq.archived_at is null and bq.qty > 0 and bq.expires_on >= (now() at time zone 'Asia/Manila')::date) as next_expiry,
    sum(bq.qty) filter (where bq.archived_at is null and bq.qty > 0 and bq.expires_on >= (now() at time zone 'Asia/Manila')::date
      and bq.expires_on < (now() at time zone 'Asia/Manila')::date + i.expiring_window_days) as expiring_quantity,
    count(*) filter (where bq.archived_at is null and bq.qty > 0) as active_batches,
    max(bq.last_at) as last_movement_at
  from (select b.id, b.archived_at, b.expires_on, coalesce(sum(m.quantity_delta), 0) as qty, max(m.created_at) as last_at
        from public.inventory_batches b left join public.inventory_movements m on m.batch_id = b.id
        where b.item_id = i.id group by b.id) bq
) s on true
where not i.is_archived;
grant select on public.inventory_item_stock to authenticated;

-- batch status no longer compares one batch with the material's minimum
create or replace view public.inventory_batch_stock with (security_invoker=true) as
select b.id as batch_id,b.batch_code,b.item_id,i.name,i.category,i.inventory_type,i.unit,i.min_stock,i.expiring_window_days,
 b.quantity_received,b.received_at,b.expires_on,b.purchase_price,b.notes,b.archived_at,b.archive_reason,
 coalesce(sum(m.quantity_delta),0) as remaining_quantity,
 case when b.archived_at is not null then coalesce(b.archive_reason,'Archived')
      when coalesce(sum(m.quantity_delta),0)<=0 then 'Out of Stock'
      when b.expires_on is not null and b.expires_on >= (now() at time zone 'Asia/Manila')::date and b.expires_on < ((now() at time zone 'Asia/Manila')::date+i.expiring_window_days) then 'Expiring Soon'
      else 'In Stock' end as status,
 b.stock_in_date
from public.inventory_batches b join public.inventory_items i on i.id=b.item_id
left join public.inventory_movements m on m.batch_id=b.id
group by b.id,i.id;

-- alerts: material level for stock, batch level for expiry
create or replace function private.sync_inventory_alerts() returns void language plpgsql security definer set search_path='' as $$
declare r record; k text; is_current boolean; wanted text[] := '{}';
  amount text;
begin
 for r in select * from public.inventory_item_stock loop
  k := case when r.available <= 0 then 'out_of_stock:item:'||r.id
            when r.available <= r.min_stock then 'low_stock:item:'||r.id
            when r.available <= r.min_stock + r.warning_margin then 'running_low:item:'||r.id end;
  if k is null then continue; end if;
  wanted := wanted || k;
  amount := trim(to_char(r.available, 'FM999999990.999'), '.')||' '||r.unit||' left · minimum '||trim(to_char(r.min_stock, 'FM999999990.999'), '.')||' '||r.unit;
  is_current := coalesce((select is_active from public.inventory_alert_state where alert_key=k), false);
  insert into public.inventory_alert_state(alert_key,condition,item_id,batch_id,is_active,changed_at)
   values(k,split_part(k,':',1),r.id,null,true,now())
   on conflict(alert_key) do update set is_active=true,changed_at=case when not inventory_alert_state.is_active then now() else inventory_alert_state.changed_at end;
  if not is_current then
   insert into public.inventory_notifications(alert_key,item_id,batch_id,title,detail)
   values(k,r.id,null,
     case split_part(k,':',1) when 'out_of_stock' then r.name||' is out of stock' when 'low_stock' then r.name||' is low in stock' else r.name||' is running low' end,
     amount)
   on conflict(alert_key) do update set is_read=false,read_at=null,created_at=now(),title=excluded.title,detail=excluded.detail;
  end if;
 end loop;
 for r in select * from public.inventory_batch_stock where archived_at is null and status='Expiring Soon' loop
  k := 'expiring_soon:batch:'||r.batch_id;
  wanted := wanted || k;
  is_current := coalesce((select is_active from public.inventory_alert_state where alert_key=k), false);
  insert into public.inventory_alert_state(alert_key,condition,item_id,batch_id,is_active,changed_at)
   values(k,'expiring_soon',r.item_id,r.batch_id,true,now())
   on conflict(alert_key) do update set is_active=true,changed_at=case when not inventory_alert_state.is_active then now() else inventory_alert_state.changed_at end;
  if not is_current then
   insert into public.inventory_notifications(alert_key,item_id,batch_id,title,detail)
   values(k,r.item_id,r.batch_id,r.name||' is expiring soon',r.batch_code||' · expires '||r.expires_on::text)
   on conflict(alert_key) do update set is_read=false,read_at=null,created_at=now(),detail=excluded.detail;
  end if;
 end loop;
 -- anything no longer true switches off (including old per-batch alerts)
 update public.inventory_alert_state set is_active=false
  where is_active and condition in ('out_of_stock','low_stock','running_low','expiring_soon') and not (alert_key = any(wanted));
 for r in select b.*,i.name,i.unit from public.inventory_batches b join public.inventory_items i on i.id=b.item_id where b.archive_reason='Expired' loop
  k:='expired:batch:'||r.id;
  insert into public.inventory_alert_state(alert_key,condition,item_id,batch_id,is_active) values(k,'expired',r.item_id,r.id,true) on conflict(alert_key) do nothing;
  insert into public.inventory_notifications(alert_key,item_id,batch_id,title,detail) values(k,r.item_id,r.id,r.batch_code||' has expired',r.name||' · expired stock moved to archive') on conflict(alert_key) do nothing;
 end loop;
end $$;
revoke all on function private.sync_inventory_alerts() from public;

-- Settings: the warning margin is saved with the minimum
create or replace function public.save_inventory_item_settings(payload jsonb) returns public.inventory_items
language plpgsql security definer set search_path='' as $$
declare i public.inventory_items;
begin
  perform private.require_admin();
  if coalesce(nullif(payload->>'min_stock','')::numeric, 0) < 0 then raise exception 'Minimum stock cannot be negative.'; end if;
  if coalesce(nullif(payload->>'warning_margin','')::numeric, 0) < 0 then raise exception 'The early warning cannot be negative.'; end if;
  update public.inventory_items set
    min_stock = coalesce(nullif(payload->>'min_stock','')::numeric, min_stock),
    warning_margin = coalesce(nullif(payload->>'warning_margin','')::numeric, warning_margin),
    estimated_unit_cost = case when payload ? 'estimated_unit_cost' then nullif(payload->>'estimated_unit_cost','')::numeric else estimated_unit_cost end,
    category = coalesce(nullif(btrim(payload->>'category'),''), category)
  where id = (payload->>'item_id')::uuid returning * into i;
  if i.id is null then raise exception 'Inventory item not found.'; end if;
  perform private.sync_inventory_alerts();
  return i;
end $$;
revoke all on function public.save_inventory_item_settings(jsonb) from public, anon;
grant execute on function public.save_inventory_item_settings(jsonb) to authenticated;

select private.sync_inventory_alerts();
commit;

-- refresh the text of stock notifications that are already showing (amounts with decimals, e.g. 6.294 kg left)
begin;
update public.inventory_notifications n set detail = trim(to_char(s.available, 'FM999999990.999'), '.')||' '||s.unit||' left · minimum '||trim(to_char(s.min_stock, 'FM999999990.999'), '.')||' '||s.unit
from public.inventory_alert_state a join public.inventory_item_stock s on s.id = a.item_id
where a.alert_key = n.alert_key and a.is_active and a.condition in ('low_stock','running_low');
commit;
