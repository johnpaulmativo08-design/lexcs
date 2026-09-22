-- Phase 7: one booking source of truth for customer checkout and Admin scheduling.
-- Hourly receiving slots remain a scheduling detail for existing orders; daily capacity
-- is enforced by booking_entries / booking_date_settings.

create or replace function private.sync_booking_for_order(target_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare source_order public.orders; summary text; custom_summary text;
begin
  select * into source_order from public.orders where id=target_order_id;
  if not found then return; end if;
  select coalesce(string_agg(i.name_snapshot || case when i.quantity > 1 then ' ×' || i.quantity else '' end, ', ' order by i.line_number),'Order'),
         nullif(string_agg(case when i.customization is not null and i.customization <> 'null'::jsonb then i.name_snapshot || ': ' || left(i.customization::text,220) end, ' · ' order by i.line_number),'')
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
end $$;
revoke all on function private.sync_booking_for_order(uuid) from public;

create or replace function private.sync_order_booking() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.sync_booking_for_order(new.id);
  return new;
end $$;
revoke all on function private.sync_order_booking() from public;

create or replace function private.sync_order_item_booking() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.sync_booking_for_order(coalesce(new.order_id,old.order_id));
  return coalesce(new,old);
end $$;
revoke all on function private.sync_order_item_booking() from public;
drop trigger if exists order_items_sync_booking on public.order_items;
create trigger order_items_sync_booking after insert or update or delete on public.order_items for each row execute function private.sync_order_item_booking();

-- Public, aggregate-only availability for the customer date picker. It exposes no
-- personal booking data and never lets a client assign capacity or closure state.
create or replace function private.customer_booking_dates(from_date date,to_date date)
returns table(booking_date date,capacity integer,active_bookings integer,remaining_slots integer,is_closed boolean,has_receiving_slot boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if from_date is null or to_date is null or to_date < from_date or to_date > from_date + 93 then
    raise exception 'Choose an availability range of up to 93 days.';
  end if;
  return query
  with dates as (select generate_series(from_date,to_date,interval '1 day')::date as day),
  entries as (select b.booking_date,count(*)::integer as count from public.booking_entries b where b.booking_date between from_date and to_date and b.status <> 'cancelled' group by b.booking_date),
  unsynced_orders as (select (o.receiving_start at time zone 'Asia/Manila')::date as day,count(*)::integer as count from public.orders o where (o.receiving_start at time zone 'Asia/Manila')::date between from_date and to_date and o.status <> 'cancelled' and not exists (select 1 from public.booking_entries b where b.order_id=o.id) group by 1),
  slots as (select (s.starts_at at time zone 'Asia/Manila')::date as day, bool_or(s.is_open and s.starts_at > now() and (select count(*) from public.orders o where o.slot_id=s.id and o.status <> 'cancelled') < s.capacity) as has_slot from public.availability_slots s where (s.starts_at at time zone 'Asia/Manila')::date between from_date and to_date group by 1)
  select d.day,coalesce(setting.capacity,6),coalesce(entries.count,0)+coalesce(unsynced_orders.count,0),
    greatest(0,coalesce(setting.capacity,6)-coalesce(entries.count,0)-coalesce(unsynced_orders.count,0)),
    coalesce(setting.is_closed,false),coalesce(slots.has_slot,false)
  from dates d left join public.booking_date_settings setting on setting.booking_date=d.day
  left join entries on entries.booking_date=d.day left join unsynced_orders on unsynced_orders.day=d.day left join slots on slots.day=d.day
  order by d.day;
end $$;
revoke all on function private.customer_booking_dates(date,date) from public;
grant execute on function private.customer_booking_dates(date,date) to anon,authenticated;
create or replace function public.get_customer_booking_dates(from_date date,to_date date)
returns table(booking_date date,capacity integer,active_bookings integer,remaining_slots integer,is_closed boolean,has_receiving_slot boolean)
language sql stable security invoker set search_path='' as $$ select * from private.customer_booking_dates(from_date,to_date) $$;
revoke all on function public.get_customer_booking_dates(date,date) from public;
grant execute on function public.get_customer_booking_dates(date,date) to anon,authenticated;

-- Customers receive their own synchronized booking status through a controlled projection.
create or replace function private.my_bookings()
returns table(order_id uuid,order_number bigint,booking_date date,scheduled_start time,scheduled_end time,fulfillment_method text,booking_status text,payment_status text,order_status text,order_total numeric,deposit_due numeric,amount_paid numeric,remaining_balance numeric,order_summary text,customization_summary text)
language sql stable security definer set search_path='' as $$
 select o.id,o.order_number,b.booking_date,b.scheduled_start,b.scheduled_end,b.fulfillment_method,b.status,b.payment_status,o.status,o.total_amount,o.deposit_due,o.amount_paid,
   case when o.total_amount is null then null else greatest(0,o.total_amount-coalesce(o.amount_paid,0)) end,b.order_summary,b.customization_summary
 from public.orders o join public.booking_entries b on b.order_id=o.id
 where o.customer_id=auth.uid() order by b.booking_date desc,b.scheduled_start desc;
$$;
revoke all on function private.my_bookings() from public;
grant execute on function private.my_bookings() to authenticated;
create or replace function public.get_my_bookings()
returns table(order_id uuid,order_number bigint,booking_date date,scheduled_start time,scheduled_end time,fulfillment_method text,booking_status text,payment_status text,order_status text,order_total numeric,deposit_due numeric,amount_paid numeric,remaining_balance numeric,order_summary text,customization_summary text)
language sql stable security invoker set search_path='' as $$ select * from private.my_bookings() $$;
revoke all on function public.get_my_bookings() from public;
grant execute on function public.get_my_bookings() to authenticated;
