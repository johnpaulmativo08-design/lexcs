-- Phase 106 · Two days' notice and the new rush fee.
-- What this does, in plain words (all dates are Philippine time):
--   1. Customers can no longer order for today or tomorrow. The earliest day is two days ahead
--      (on Nov 8 the first day they can pick is Nov 10). The owner (admin) is not limited, so you can still
--      add a reservation for any day yourself. Only a new order, or a changed pickup/delivery day, is checked.
--   2. The rush fee now depends on how many days ahead the order is for, counted from the day it is placed:
--        2 days ahead            → ₱400
--        3 or 4 days ahead       → ₱200
--        5 days ahead or more    → no rush fee
--      (e.g. placed Nov 8: Nov 10 = ₱400, Nov 11–12 = ₱200, Nov 13 onwards = ₱0)
--      Like before, the fee is added once when the order is placed and kept on the order; orders already placed
--      keep the fee they had.
-- Safe to run more than once.
begin;

-- the fee for a pickup/delivery day, counted from today
create or replace function private.rush_fee_for(receiving_day date) returns numeric
language sql stable set search_path = '' as $$
  select case when receiving_day is null then 0
              when receiving_day - (now() at time zone 'Asia/Manila')::date <= 2 then 400
              when receiving_day - (now() at time zone 'Asia/Manila')::date <= 4 then 200
              else 0 end::numeric
$$;
revoke all on function private.rush_fee_for(date) from public;
grant execute on function private.rush_fee_for(date) to authenticated;

-- same trigger as phase 59, now with the fee from the table above
create or replace function private.order_rush_fee() returns trigger
language plpgsql set search_path = '' as $$
declare fee numeric := 0;
begin
  if new.receiving_start is not null then
    fee := private.rush_fee_for((new.receiving_start at time zone 'Asia/Manila')::date);
  end if;
  if fee > 0 then
    new.rush_fee := fee;
    if new.total_amount is not null then
      new.total_amount := new.total_amount + fee;
      new.deposit_due := round(new.total_amount * new.deposit_rate, 2);
    end if;
  end if;
  return new;
end $$;
revoke all on function private.order_rush_fee() from public;

-- the booking-window trigger (phase 57) also checks the two days' notice for customers
create or replace function private.enforce_booking_horizon() returns trigger
language plpgsql set search_path = '' as $$
declare earliest date := (now() at time zone 'Asia/Manila')::date + 2;
begin
  if new.receiving_start is not null and (new.receiving_start at time zone 'Asia/Manila')::date > private.booking_horizon() then
    raise exception 'Bookings are open until %. Please choose an earlier date.', to_char(private.booking_horizon(), 'FMMonth FMDD, YYYY') using errcode = '22023';
  end if;
  if new.receiving_start is not null and not coalesce(private.is_admin(), false)
     and (tg_op = 'INSERT' or new.receiving_start is distinct from old.receiving_start)
     and (new.receiving_start at time zone 'Asia/Manila')::date < earliest then
    raise exception 'Orders need at least 2 days'' notice. The earliest day you can choose is %.', to_char(earliest, 'FMMonth FMDD, YYYY') using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.enforce_booking_horizon() from public;

commit;
notify pgrst, 'reload schema';
