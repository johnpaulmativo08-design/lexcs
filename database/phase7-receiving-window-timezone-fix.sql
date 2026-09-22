-- Correct the operating windows generated with a shifted timestamp expression.
update public.availability_slots s
set starts_at=((starts_at at time zone 'Asia/Manila')::date + time '09:00') at time zone 'Asia/Manila',
    ends_at=((starts_at at time zone 'Asia/Manila')::date + time '18:00') at time zone 'Asia/Manila'
where (starts_at at time zone 'Asia/Manila')::date between (now() at time zone 'Asia/Manila')::date + 1 and (now() at time zone 'Asia/Manila')::date + 60
  and (starts_at at time zone 'Asia/Manila')::time='01:00:00'::time
  and (ends_at at time zone 'Asia/Manila')::time='10:00:00'::time
  and not exists (
    select 1 from public.availability_slots other_slot
    where other_slot.id<>s.id
      and tstzrange(other_slot.starts_at,other_slot.ends_at,'[)') && tstzrange(
        ((s.starts_at at time zone 'Asia/Manila')::date + time '09:00') at time zone 'Asia/Manila',
        ((s.starts_at at time zone 'Asia/Manila')::date + time '18:00') at time zone 'Asia/Manila','[)'
      )
  );
