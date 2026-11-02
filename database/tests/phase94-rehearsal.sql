-- Phase 94 rehearsal · no same-day orders, WITHOUT saving anything.
-- Run the whole file in the Supabase SQL editor. It applies phase 94 twice, checks the trigger and the calendar,
-- then ends with an error on purpose so nothing is saved.
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL lines.

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

-- second run (must say it is already applied)
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

do $rehearsal$
declare report text := ''; def text := pg_get_functiondef('private.customer_booking_dates(date,date)'::regprocedure);
  today date := (now() at time zone 'Asia/Manila')::date; t_ok boolean; later_ok boolean; slot_today bigint; msg text := '';
begin
  select has_receiving_slot into t_ok from private.customer_booking_dates(today, today);
  select bool_or(has_receiving_slot) into later_ok from private.customer_booking_dates(today + 1, today + 7);
  report := report || E'\n' || case when not coalesce(t_ok, false) then 'PASS' else 'FAIL' end || '  calendar: today is not bookable';
  report := report || E'\n' || case when coalesce(later_ok, false) then 'PASS' else 'FAIL' end || '  calendar: the next 7 days still have bookable dates';
  report := report || E'\n' || case when exists (select 1 from pg_trigger where tgname = 'orders_no_same_day' and not tgisinternal) then 'PASS' else 'FAIL' end || '  trigger orders_no_same_day is on';
  report := report || E'\n' || case when (length(def) - length(replace(def, 'phase 94', ''))) / length('phase 94') = 1 then 'PASS' else 'FAIL' end || '  calendar patched exactly once';
  report := report || E'\n' || case when position('booking_horizon()' in def) > 0 then 'PASS' else 'FAIL' end || '  booking horizon still applies';
  -- an order for later today must be refused (other checks may refuse it first; the message is shown either way)
  begin
    insert into public.orders(customer_name, contact_phone, fulfillment_method, receiving_start, receiving_end)
    values ('Rehearsal', '09170000000', 'pickup', now() + interval '1 hour', now() + interval '2 hours');
    msg := 'inserted';
  exception when others then msg := sqlerrm; end;
  report := report || E'\n' || case when msg <> 'inserted' then 'PASS' else 'FAIL' end || '  a same-day order is refused (' || left(msg, 90) || ')';
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
