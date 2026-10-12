-- Phase 57: booking dates.
--  * Every day has its 09:00–18:00 receiving window (Mondays were missing, and windows stopped on Nov 21).
--    Windows are created through the end of 2027; Admin still closes dates in Reservations, and full days stay full.
--  * Customers can book up to the end of the month after next (on Oct 13 that is Dec 31; on Nov 1 it becomes Jan 31).
--    The calendar shows later dates as not open yet, and the database refuses orders beyond that date. Safe to re-run.
begin;

insert into public.availability_slots(starts_at, ends_at, capacity, is_open)
select (d.day + time '09:00') at time zone 'Asia/Manila', (d.day + time '18:00') at time zone 'Asia/Manila', 6, true
from generate_series((now() at time zone 'Asia/Manila')::date + 1, date '2027-12-31', interval '1 day') as g(ts)
cross join lateral (select g.ts::date as day) d
where not exists (select 1 from public.availability_slots s where (s.starts_at at time zone 'Asia/Manila')::date = d.day);

-- the last bookable day: end of the month after next (Manila time)
create or replace function private.booking_horizon() returns date
language sql stable set search_path = '' as $$
  select ((date_trunc('month', (now() at time zone 'Asia/Manila')::date) + interval '3 months')::date - 1)
$$;
revoke all on function private.booking_horizon() from public;
grant execute on function private.booking_horizon() to anon, authenticated;

-- customer calendar: days after the horizon have no receiving window yet
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
    coalesce(setting.is_closed,false),coalesce(slots.has_slot,false) and d.day <= private.booking_horizon()
  from dates d left join public.booking_date_settings setting on setting.booking_date=d.day
  left join entries on entries.booking_date=d.day left join unsynced_orders on unsynced_orders.day=d.day left join slots on slots.day=d.day
  order by d.day;
end $$;
revoke all on function private.customer_booking_dates(date,date) from public;
grant execute on function private.customer_booking_dates(date,date) to anon,authenticated;

-- orders cannot be placed for a date beyond the booking window
create or replace function private.enforce_booking_horizon() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.receiving_start is not null and (new.receiving_start at time zone 'Asia/Manila')::date > private.booking_horizon() then
    raise exception 'Bookings are open until %. Please choose an earlier date.', to_char(private.booking_horizon(), 'FMMonth FMDD, YYYY') using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.enforce_booking_horizon() from public;
drop trigger if exists orders_booking_horizon on public.orders;
create trigger orders_booking_horizon before insert on public.orders for each row execute function private.enforce_booking_horizon();
commit;
