-- Phase 96: daily production capacity (Reservations Capacity).
--  * Two limits per day:
--      - Client slots: how many customers can book the date (was "Order limit per day"; now 1–30, default 6).
--      - Production capacity: kitchen minutes the Admin will take that day, 0–750 (12 h 30 min), default 300.
--    Both can be set for one date or for all dates. "All dates" changes the default AND resets every date from
--    today onward (a date that already has more reservations than the new slot limit keeps its limit).
--  * Prep time per size (variant_prep_times, Admin only): minutes for ONE of that size, e.g. Cupcakes 12 pcs = 35.
--    An order line's minutes = prep time × quantity, copied onto the order when it is placed (order_item_workloads),
--    so later prep-time edits do not change old orders. Each order also adds a fixed cleaning/setup time
--    (production_settings.cleaning_minutes, default 0), copied when the order is placed.
--  * Used workload = minutes of the day's ACCEPTED orders (confirmed / preparing / ready / completed). It moves by
--    itself when an order is confirmed or cancelled because it is always calculated from the orders.
--    Pending orders are shown separately as "pending minutes".
--  * Heavy production workload: an order whose minutes would take the day over its capacity. Customers can still
--    book while slots are free; the Admin sees a warning (bell + order badge + a question before confirming).
--  * Customers only see whether a date is available: get_customer_booking_dates no longer returns counts.
-- Nothing here deletes data. Safe to re-run.
begin;

-- 1. settings -------------------------------------------------------------------------------------------------
create table if not exists public.production_settings (
  id boolean primary key default true check (id),
  default_slots integer not null default 6 check (default_slots between 1 and 30),
  default_workload_minutes integer not null default 300 check (default_workload_minutes between 0 and 750),
  cleaning_minutes integer not null default 0 check (cleaning_minutes between 0 and 120),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.production_settings(id) values (true) on conflict (id) do nothing;

alter table public.booking_date_settings add column if not exists workload_minutes integer;
alter table public.booking_date_settings drop constraint if exists booking_date_settings_workload_minutes_check;
alter table public.booking_date_settings add constraint booking_date_settings_workload_minutes_check
  check (workload_minutes is null or workload_minutes between 0 and 750);

-- 2. prep time per size, and the minutes copied onto each order ----------------------------------------------
create table if not exists public.variant_prep_times (
  variant_id uuid primary key references public.product_variants(id) on delete cascade,
  minutes integer not null default 0 check (minutes between 0 and 750),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.order_workloads (
  order_id uuid primary key references public.orders(id) on delete cascade,
  cleaning_minutes integer not null default 0 check (cleaning_minutes >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.order_item_workloads (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  minutes_each integer not null default 0 check (minutes_each >= 0)
);
create index if not exists order_item_workloads_order_idx on public.order_item_workloads(order_id);

-- Admin-only: customers never read capacity, prep times or order minutes.
do $$ declare t text; begin
  foreach t in array array['production_settings','variant_prep_times','order_workloads','order_item_workloads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_admin()))', t || '_admin_read', t);
  end loop;
end $$;

-- copy the prep time (and the cleaning time, once per order) when an order line is saved
create or replace function private.capture_item_workload() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.variant_id is distinct from old.variant_id then
    insert into public.order_item_workloads(order_item_id, order_id, minutes_each)
    values (new.id, new.order_id, coalesce((select t.minutes from public.variant_prep_times t where t.variant_id = new.variant_id), 0))
    on conflict (order_item_id) do update set minutes_each = excluded.minutes_each, order_id = excluded.order_id;
  end if;
  insert into public.order_workloads(order_id, cleaning_minutes)
  values (new.order_id, coalesce((select s.cleaning_minutes from public.production_settings s where s.id), 0))
  on conflict (order_id) do nothing;
  return null;
end $$;
revoke all on function private.capture_item_workload() from public;
drop trigger if exists order_items_capture_workload on public.order_items;
create trigger order_items_capture_workload after insert or update of variant_id on public.order_items
  for each row execute function private.capture_item_workload();

-- existing orders: 0 min (no prep times existed before), no cleaning time added afterwards
insert into public.order_workloads(order_id, cleaning_minutes) select o.id, 0 from public.orders o on conflict (order_id) do nothing;
insert into public.order_item_workloads(order_item_id, order_id, minutes_each)
select i.id, i.order_id, coalesce(t.minutes, 0) from public.order_items i left join public.variant_prep_times t on t.variant_id = i.variant_id
on conflict (order_item_id) do nothing;

-- 3. helpers -------------------------------------------------------------------------------------------------
create or replace function private.order_minutes(target uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (coalesce((select w.cleaning_minutes from public.order_workloads w where w.order_id = target), 0)
        + coalesce((select sum(i.quantity * iw.minutes_each) from public.order_items i
                    join public.order_item_workloads iw on iw.order_item_id = i.id where i.order_id = target), 0))::integer
$$;
revoke all on function private.order_minutes(uuid) from public;

create or replace function private.day_workload_capacity(target_date date) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.workload_minutes from public.booking_date_settings s where s.booking_date = target_date),
                  (select p.default_workload_minutes from public.production_settings p where p.id), 300)
$$;
revoke all on function private.day_workload_capacity(date) from public;

create or replace function private.default_slots() returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.default_slots from public.production_settings p where p.id), 6)
$$;
revoke all on function private.default_slots() from public;

-- minutes of the day's accepted orders (optionally leaving one order out)
create or replace function private.day_accepted_minutes(target_date date, exclude_order uuid default null) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(private.order_minutes(o.id)), 0)::integer from public.orders o
  where (o.receiving_start at time zone 'Asia/Manila')::date = target_date
    and o.status in ('confirmed','preparing','ready','completed')
    and o.id is distinct from exclude_order
$$;
revoke all on function private.day_accepted_minutes(date, uuid) from public;

-- reservations on a date, counted the same way the booking check counts them
create or replace function private.active_bookings_on(target_date date) returns integer
language sql stable security definer set search_path = '' as $$
  select ((select count(*) from public.booking_entries b where b.booking_date = target_date and b.status <> 'cancelled')
        + (select count(*) from public.orders o where (o.receiving_start at time zone 'Asia/Manila')::date = target_date
             and o.status <> 'cancelled' and not exists (select 1 from public.booking_entries b where b.order_id = o.id)))::integer
$$;
revoke all on function private.active_bookings_on(date) from public;

-- 4. existing booking functions now use the default slot limit instead of a fixed 6 ---------------------------
create or replace function private.assert_booking_date_available(target_date date, include_existing_orders boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare setting public.booking_date_settings; active_count integer; cap integer;
begin
  if target_date is null then raise exception 'A booking date is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lexc-booking-date:' || target_date::text, 0));
  insert into public.booking_date_settings(booking_date, capacity) values(target_date, private.default_slots()) on conflict(booking_date) do nothing;
  select * into setting from public.booking_date_settings where booking_date=target_date for update;
  if setting.is_closed then raise exception 'This date is closed for bookings.'; end if;
  select count(*) into active_count from public.booking_entries where booking_date=target_date and status <> 'cancelled';
  if include_existing_orders then
    select active_count + count(*) into active_count from public.orders o
    where (o.receiving_start at time zone 'Asia/Manila')::date=target_date and o.status <> 'cancelled'
      and not exists (select 1 from public.booking_entries b where b.order_id=o.id);
  end if;
  cap:=setting.capacity;
  if active_count >= cap then raise exception 'This booking date is fully booked.'; end if;
end $$;
revoke all on function private.assert_booking_date_available(date,boolean) from public;

create or replace function private.booking_schedule(from_date date,to_date date)
returns table(id uuid,order_id uuid,customer_name text,customer_contact text,order_reference text,order_summary text,customization_summary text,booking_date date,scheduled_start time,scheduled_end time,fulfillment_method text,status text,payment_status text,order_total numeric,deposit_due numeric,amount_paid numeric,notes text,capacity integer,is_closed boolean,closed_reason text)
language sql stable security definer set search_path='' as $$
 select b.id,b.order_id,b.customer_name,b.customer_contact,b.order_reference,b.order_summary,b.customization_summary,b.booking_date,b.scheduled_start,b.scheduled_end,b.fulfillment_method,b.status,b.payment_status,b.order_total,b.deposit_due,b.amount_paid,b.notes,coalesce(s.capacity,private.default_slots()),coalesce(s.is_closed,false),s.closed_reason
 from public.booking_entries b left join public.booking_date_settings s on s.booking_date=b.booking_date
 where b.booking_date>=from_date and b.booking_date<=to_date order by b.booking_date,b.scheduled_start nulls last,b.created_at
$$;
revoke all on function private.booking_schedule(date,date) from public;
grant execute on function private.booking_schedule(date,date) to authenticated;

-- customer calendar: same columns as before (older pages keep working) but no counts —
-- capacity and active_bookings are null, remaining_slots is 1 (available) or 0 (full)
create or replace function private.customer_booking_dates(from_date date,to_date date)
returns table(booking_date date,capacity integer,active_bookings integer,remaining_slots integer,is_closed boolean,has_receiving_slot boolean)
language plpgsql stable security definer set search_path='' as $$
declare fallback integer := private.default_slots();
begin
  if from_date is null or to_date is null or to_date < from_date or to_date > from_date + 93 then
    raise exception 'Choose an availability range of up to 93 days.';
  end if;
  return query
  with dates as (select generate_series(from_date,to_date,interval '1 day')::date as day),
  entries as (select b.booking_date,count(*)::integer as count from public.booking_entries b where b.booking_date between from_date and to_date and b.status <> 'cancelled' group by b.booking_date),
  unsynced_orders as (select (o.receiving_start at time zone 'Asia/Manila')::date as day,count(*)::integer as count from public.orders o where (o.receiving_start at time zone 'Asia/Manila')::date between from_date and to_date and o.status <> 'cancelled' and not exists (select 1 from public.booking_entries b where b.order_id=o.id) group by 1),
  slots as (select (s.starts_at at time zone 'Asia/Manila')::date as day, bool_or(s.is_open and s.starts_at > now() and (select count(*) from public.orders o where o.slot_id=s.id and o.status <> 'cancelled') < s.capacity) as has_slot from public.availability_slots s where (s.starts_at at time zone 'Asia/Manila')::date between from_date and to_date group by 1)
  select d.day, null::integer, null::integer,
    case when coalesce(setting.capacity,fallback)-coalesce(entries.count,0)-coalesce(unsynced_orders.count,0) > 0 then 1 else 0 end,
    coalesce(setting.is_closed,false),coalesce(slots.has_slot,false) and d.day <= private.booking_horizon()
  from dates d left join public.booking_date_settings setting on setting.booking_date=d.day
  left join entries on entries.booking_date=d.day left join unsynced_orders on unsynced_orders.day=d.day left join slots on slots.day=d.day
  order by d.day;
end $$;
revoke all on function private.customer_booking_dates(date,date) from public;
grant execute on function private.customer_booking_dates(date,date) to anon,authenticated;

-- 5. Admin RPCs ----------------------------------------------------------------------------------------------
-- one date: capacity, used / pending minutes, slots and the day's orders with their minutes
create or replace function private.production_day(target_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare ps public.production_settings; s public.booking_date_settings; cap integer; accepted integer; pending integer; pending_n integer; day_orders jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  if target_date is null then raise exception 'Choose a date.' using errcode = '22023'; end if;
  select * into ps from public.production_settings where id;
  select * into s from public.booking_date_settings where booking_date = target_date;
  cap := coalesce(s.workload_minutes, ps.default_workload_minutes, 300);
  select coalesce(sum(mm.m) filter (where o.status <> 'pending'), 0), coalesce(sum(mm.m) filter (where o.status = 'pending'), 0),
         count(*) filter (where o.status = 'pending')
    into accepted, pending, pending_n
    from public.orders o cross join lateral (select private.order_minutes(o.id) as m) mm
    where (o.receiving_start at time zone 'Asia/Manila')::date = target_date and o.status <> 'cancelled';
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'customer_name', o.customer_name,
           'status', o.status, 'minutes', mm.m, 'accepted', o.status <> 'pending',
           'projected_minutes', case when o.status = 'pending' then accepted + mm.m else accepted end,
           'heavy', case when o.status = 'pending' then accepted + mm.m > cap else accepted > cap end)
         order by o.status <> 'pending', o.created_at), '[]'::jsonb)
    into day_orders
    from public.orders o cross join lateral (select private.order_minutes(o.id) as m) mm
    where (o.receiving_start at time zone 'Asia/Manila')::date = target_date and o.status <> 'cancelled';
  return jsonb_build_object('booking_date', target_date, 'max_minutes', 750,
    'workload_minutes', cap, 'workload_custom', s.workload_minutes is not null,
    'accepted_minutes', accepted, 'pending_minutes', pending, 'pending_count', pending_n,
    'slots', coalesce(s.capacity, ps.default_slots, 6), 'active_bookings', private.active_bookings_on(target_date),
    'is_closed', coalesce(s.is_closed, false),
    'default_workload_minutes', ps.default_workload_minutes, 'default_slots', ps.default_slots, 'cleaning_minutes', ps.cleaning_minutes,
    'orders', day_orders);
end $$;
revoke all on function private.production_day(date) from public;
grant execute on function private.production_day(date) to authenticated;
create or replace function public.get_production_day(target_date date) returns jsonb
language sql security invoker set search_path = '' as $$ select private.production_day(target_date) $$;
revoke all on function public.get_production_day(date) from public, anon;
grant execute on function public.get_production_day(date) to authenticated;

-- save the slider / slots / cleaning time for one date ('day') or as the default for every date ('all')
create or replace function private.save_production_capacity(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target_date date := nullif(payload->>'booking_date', '')::date;
  scope text := coalesce(nullif(payload->>'scope', ''), 'day');
  want_minutes integer := nullif(payload->>'workload_minutes', '')::integer;
  want_slots integer := nullif(payload->>'slots', '')::integer;
  want_clean integer := nullif(payload->>'cleaning_minutes', '')::integer;
  today date := (now() at time zone 'Asia/Manila')::date;
  skipped jsonb := '[]'::jsonb; d date; active integer;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  if scope not in ('day', 'all') then raise exception 'Choose this date or all dates.' using errcode = '22023'; end if;
  if want_minutes is not null and want_minutes not between 0 and 750 then
    raise exception 'Daily production capacity must be from 0 to 750 minutes (12 hrs 30 mins).' using errcode = '22023'; end if;
  if want_slots is not null and want_slots not between 1 and 30 then
    raise exception 'Client slots must be from 1 to 30.' using errcode = '22023'; end if;
  if want_clean is not null and want_clean not between 0 and 120 then
    raise exception 'Cleaning/setup time must be from 0 to 120 minutes.' using errcode = '22023'; end if;

  if want_clean is not null then
    update public.production_settings set cleaning_minutes = want_clean, updated_by = auth.uid(), updated_at = now() where id;
  end if;

  if scope = 'day' then
    if target_date is null then raise exception 'Choose a date.' using errcode = '22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended('lexc-booking-date:' || target_date::text, 0));
    insert into public.booking_date_settings(booking_date, capacity) values (target_date, private.default_slots()) on conflict (booking_date) do nothing;
    if want_slots is not null then
      active := private.active_bookings_on(target_date);
      if active > want_slots then
        raise exception 'This date already has % reservations. Set at least % slots.', active, active using errcode = '22023'; end if;
      update public.booking_date_settings set capacity = want_slots where booking_date = target_date;
    end if;
    if want_minutes is not null then
      update public.booking_date_settings set workload_minutes = want_minutes where booking_date = target_date;
    end if;
  else
    if want_minutes is not null then
      update public.production_settings set default_workload_minutes = want_minutes, updated_by = auth.uid(), updated_at = now() where id;
      update public.booking_date_settings set workload_minutes = null where booking_date >= today and workload_minutes is not null;
    end if;
    if want_slots is not null then
      update public.production_settings set default_slots = want_slots, updated_by = auth.uid(), updated_at = now() where id;
      for d in select g::date from generate_series(today, greatest(today, private.booking_horizon()), interval '1 day') g
               union select s.booking_date from public.booking_date_settings s where s.booking_date > private.booking_horizon()
      loop
        perform pg_advisory_xact_lock(hashtextextended('lexc-booking-date:' || d::text, 0));
        insert into public.booking_date_settings(booking_date, capacity) values (d, want_slots) on conflict (booking_date) do nothing;
        active := private.active_bookings_on(d);
        if active > want_slots then skipped := skipped || to_jsonb(d);
        else update public.booking_date_settings set capacity = want_slots where booking_date = d and capacity <> want_slots; end if;
      end loop;
    end if;
  end if;
  return jsonb_build_object('skipped', skipped);
end $$;
revoke all on function private.save_production_capacity(jsonb) from public;
grant execute on function private.save_production_capacity(jsonb) to authenticated;
create or replace function public.save_production_capacity(payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.save_production_capacity(payload) $$;
revoke all on function public.save_production_capacity(jsonb) from public, anon;
grant execute on function public.save_production_capacity(jsonb) to authenticated;

-- minutes and heavy-workload check for a list of orders (Orders page badges and the Confirm question)
create or replace function private.order_workloads_for(order_ids uuid[])
returns table(order_id uuid, booking_date date, minutes integer, workload_minutes integer, accepted_minutes integer, projected_minutes integer, heavy boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  return query
  select o.id, x.d, y.m, z.cap, z.acc, z.acc + y.m, o.status <> 'cancelled' and z.acc + y.m > z.cap
  from public.orders o
  cross join lateral (select (o.receiving_start at time zone 'Asia/Manila')::date as d) x
  cross join lateral (select private.order_minutes(o.id) as m) y
  cross join lateral (select private.day_workload_capacity(x.d) as cap, private.day_accepted_minutes(x.d, o.id) as acc) z
  where o.id = any(order_ids);
end $$;
revoke all on function private.order_workloads_for(uuid[]) from public;
grant execute on function private.order_workloads_for(uuid[]) to authenticated;
create or replace function public.get_order_workloads(order_ids uuid[])
returns table(order_id uuid, booking_date date, minutes integer, workload_minutes integer, accepted_minutes integer, projected_minutes integer, heavy boolean)
language sql security invoker set search_path = '' as $$ select * from private.order_workloads_for(order_ids) $$;
revoke all on function public.get_order_workloads(uuid[]) from public, anon;
grant execute on function public.get_order_workloads(uuid[]) to authenticated;

-- the bell: pending orders (today onward) that would take their day over capacity
create or replace function private.heavy_workload_alerts()
returns table(order_id uuid, order_number bigint, customer_name text, booking_date date, minutes integer, workload_minutes integer, accepted_minutes integer, projected_minutes integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  return query
  select w.order_id, o.order_number, o.customer_name, w.booking_date, w.minutes, w.workload_minutes, w.accepted_minutes, w.projected_minutes
  from public.orders o
  cross join lateral private.order_workloads_for(array[o.id]) w
  where o.status = 'pending' and (o.receiving_start at time zone 'Asia/Manila')::date >= (now() at time zone 'Asia/Manila')::date and w.heavy
  order by w.booking_date, o.created_at;
end $$;
revoke all on function private.heavy_workload_alerts() from public;
grant execute on function private.heavy_workload_alerts() to authenticated;
create or replace function public.get_heavy_workload_alerts()
returns table(order_id uuid, order_number bigint, customer_name text, booking_date date, minutes integer, workload_minutes integer, accepted_minutes integer, projected_minutes integer)
language sql security invoker set search_path = '' as $$ select * from private.heavy_workload_alerts() $$;
revoke all on function public.get_heavy_workload_alerts() from public, anon;
grant execute on function public.get_heavy_workload_alerts() to authenticated;

-- product editor: prep minutes per size
create or replace function private.save_variant_prep_times(target_product uuid, items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare item jsonb; v uuid; m integer; n integer := 0;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  if jsonb_typeof(items) <> 'array' then raise exception 'Prep times must be a list.' using errcode = '22023'; end if;
  for item in select * from jsonb_array_elements(items) loop
    v := nullif(item->>'variant_id', '')::uuid;
    m := coalesce(nullif(item->>'minutes', '')::integer, 0);
    if m not between 0 and 750 then raise exception 'Prep time must be from 0 to 750 minutes.' using errcode = '22023'; end if;
    if not exists (select 1 from public.product_variants pv where pv.id = v and pv.product_id = target_product) then
      raise exception 'That size does not belong to this product.' using errcode = '22023'; end if;
    insert into public.variant_prep_times(variant_id, minutes, updated_by, updated_at) values (v, m, auth.uid(), now())
    on conflict (variant_id) do update set minutes = excluded.minutes, updated_by = excluded.updated_by, updated_at = now()
      where public.variant_prep_times.minutes is distinct from excluded.minutes;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.save_variant_prep_times(uuid, jsonb) from public;
grant execute on function private.save_variant_prep_times(uuid, jsonb) to authenticated;
create or replace function public.save_variant_prep_times(target_product uuid, items jsonb) returns integer
language sql security invoker set search_path = '' as $$ select private.save_variant_prep_times(target_product, items) $$;
revoke all on function public.save_variant_prep_times(uuid, jsonb) from public, anon;
grant execute on function public.save_variant_prep_times(uuid, jsonb) to authenticated;

-- 6. checks ------------------------------------------------------------------------------------------------
do $$ begin
  if (select count(*) from public.production_settings) <> 1 then raise exception 'Phase 96: production_settings needs one row'; end if;
  if to_regprocedure('public.get_production_day(date)') is null or to_regprocedure('public.save_production_capacity(jsonb)') is null
     or to_regprocedure('public.get_order_workloads(uuid[])') is null or to_regprocedure('public.get_heavy_workload_alerts()') is null
     or to_regprocedure('public.save_variant_prep_times(uuid,jsonb)') is null then
    raise exception 'Phase 96: an Admin function is missing';
  end if;
  if exists (select 1 from private.customer_booking_dates(current_date, current_date + 3) c where c.capacity is not null or c.active_bookings is not null) then
    raise exception 'Phase 96: the customer calendar still returns counts';
  end if;
end $$;
commit;
