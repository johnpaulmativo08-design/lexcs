-- Phase 60: a 5 PM receiving time (17:00–18:00) every day, so customers can pick 9 AM, 10 AM … 12 NN … 5 PM.
-- Applied on 2026-10-13. Safe to re-run (skips any hour that already has a receiving time).
begin;
insert into public.availability_slots(starts_at, ends_at, capacity, is_open)
select (d.day + time '17:00') at time zone 'Asia/Manila', (d.day + time '18:00') at time zone 'Asia/Manila', 6, true
from generate_series((now() at time zone 'Asia/Manila')::date + 1, date '2027-12-31', interval '1 day') as g(ts)
cross join lateral (select g.ts::date as day) d
where not exists (select 1 from public.availability_slots s where s.starts_at < (d.day + time '18:00') at time zone 'Asia/Manila' and s.ends_at > (d.day + time '17:00') at time zone 'Asia/Manila');
commit;
