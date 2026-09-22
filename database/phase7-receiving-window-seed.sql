-- Provide normal future receiving windows for the customer booking flow.
-- These are day-level operating windows, not appointment capacities: daily booking
-- capacity remains enforced by booking_date_settings / booking_entries at six active bookings.
insert into public.availability_slots(starts_at,ends_at,capacity,is_open)
select (d.day::date + time '09:00') at time zone 'Asia/Manila', (d.day::date + time '18:00') at time zone 'Asia/Manila', 6, true
from generate_series(
  (now() at time zone 'Asia/Manila')::date + 1,
  (now() at time zone 'Asia/Manila')::date + 60,
  interval '1 day'
) as d(day)
where extract(isodow from d.day) between 1 and 6
  and not exists (
    select 1 from public.availability_slots s
    where (s.starts_at at time zone 'Asia/Manila')::date=d.day
  );
