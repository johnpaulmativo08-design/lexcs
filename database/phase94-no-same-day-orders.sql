-- Phase 94 · No same-day orders; the earliest pickup or delivery date is tomorrow.
--
-- Why: LexC's doesn't take same-day orders, but the checkout still offered today's remaining hours (docs Issue B1).
--
-- What it does:
--   1. New trigger on orders (before insert): refuses an order whose receiving date is today or earlier, Manila time.
--      Existing orders are never touched (insert only), so today's confirmed orders stay as they are.
--   2. The customer calendar (private.customer_booking_dates) shows today as not bookable. In-place patch with an
--      exact-match guard on the phase 57 version.
--   Unchanged: the ₱200 rush fee for tomorrow, the 6-per-date limit, closed dates and the booking horizon.
--
-- What it does NOT do: touch payments, inventory or RLS; change any existing order.
--
-- How to apply: rehearse with database/tests/phase94-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor. Safe to run twice.

create or replace function private.enforce_no_same_day() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.receiving_start is not null and (new.receiving_start at time zone 'Asia/Manila')::date <= (now() at time zone 'Asia/Manila')::date then
    raise exception 'Same-day orders aren''t taken. Please choose tomorrow or a later date.' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.enforce_no_same_day() from public;
drop trigger if exists orders_no_same_day on public.orders;
create trigger orders_no_same_day before insert on public.orders for each row execute function private.enforce_no_same_day();

do $$
declare def text;
  a1 text := 'coalesce(slots.has_slot,false) and d.day <= private.booking_horizon()';
  b1 text := 'coalesce(slots.has_slot,false) and d.day <= private.booking_horizon() and d.day > (now() at time zone ''Asia/Manila'')::date   -- phase 94: no same-day';
begin
  def := pg_get_functiondef('private.customer_booking_dates(date,date)'::regprocedure);
  if position('phase 94' in def) > 0 then raise notice 'customer_booking_dates already hides today.'; return; end if;
  if (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 then
    raise exception 'private.customer_booking_dates is not the phase 57 version; review before applying phase 94.'; end if;
  execute replace(def, a1, b1);
end $$;

notify pgrst, 'reload schema';

select position('phase 94' in pg_get_functiondef('private.customer_booking_dates(date,date)'::regprocedure)) > 0 as calendar_hides_today,
       exists (select 1 from pg_trigger where tgname = 'orders_no_same_day' and not tgisinternal) as trigger_on;
