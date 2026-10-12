-- Phase 61: the old all-day receiving windows that orders still used (Oct 15, 17, 18, 23) blocked the hourly times,
-- so those days showed only one time. Each one becomes the 9–10 AM hour (its orders stay attached), and every
-- missing hour 9 AM–5 PM is added. Customers can pick the same hour as others; the daily limit (6) still applies.
-- Applied on 2026-10-13. Safe to re-run.
begin;
update public.availability_slots s set ends_at = ((s.starts_at at time zone 'Asia/Manila')::date + time '10:00') at time zone 'Asia/Manila', starts_at = ((s.starts_at at time zone 'Asia/Manila')::date + time '09:00') at time zone 'Asia/Manila'
where s.starts_at > now() - interval '12 hours' and s.ends_at - s.starts_at > interval '1 hour';
insert into public.availability_slots(starts_at, ends_at, capacity, is_open)
select (d.day + make_time(h,0,0)) at time zone 'Asia/Manila', (d.day + make_time(h+1,0,0)) at time zone 'Asia/Manila', 6, true
from generate_series((now() at time zone 'Asia/Manila')::date, date '2027-12-31', interval '1 day') as g(ts)
cross join lateral (select g.ts::date as day) d cross join generate_series(9,17) as h
where (d.day + make_time(h,0,0)) at time zone 'Asia/Manila' > now()
  and not exists (select 1 from public.availability_slots s where s.starts_at < (d.day + make_time(h+1,0,0)) at time zone 'Asia/Manila' and s.ends_at > (d.day + make_time(h,0,0)) at time zone 'Asia/Manila');
commit;
