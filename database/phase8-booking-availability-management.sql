-- Operating windows and temporary pauses remain separate from the daily
-- booking-capacity rule. A pause turns one active receiving window into two
-- active windows around the closed interval; historical slots/orders remain.
create table if not exists public.booking_time_blocks (
  id uuid primary key default gen_random_uuid(),
  booking_date date not null,
  starts_at time not null,
  ends_at time not null,
  reason text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  reopened_at timestamptz,
  check (starts_at < ends_at)
);

create index if not exists booking_time_blocks_date_active_idx
  on public.booking_time_blocks(booking_date,is_active);

alter table public.booking_time_blocks enable row level security;
drop policy if exists booking_time_blocks_admin_only on public.booking_time_blocks;
create policy booking_time_blocks_admin_only on public.booking_time_blocks
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create or replace function private.manage_booking_availability(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_date date := nullif(payload->>'booking_date','')::date;
  opening time := nullif(payload->>'opening_time','')::time;
  closing time := nullif(payload->>'closing_time','')::time;
  pause_from time := nullif(payload->>'pause_from','')::time;
  pause_to time := nullif(payload->>'pause_to','')::time;
  pause_reason text := nullif(left(trim(coalesce(payload->>'reason','')),300),'');
  slot_capacity integer := 6;
  prior public.availability_slots;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Admin access required.' using errcode='42501';
  end if;
  if target_date is null or opening is null or closing is null or opening >= closing then
    raise exception 'Enter a valid operating date and hours.';
  end if;
  if (pause_from is null) <> (pause_to is null) then
    raise exception 'Enter both start and end times for a temporary closure.';
  end if;
  if pause_from is not null and (pause_from < opening or pause_to > closing or pause_from >= pause_to) then
    raise exception 'The closed time must be within the operating hours.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lexc-booking-availability:' || target_date::text, 0));
  select coalesce(s.capacity,setting.capacity,6) into slot_capacity
  from public.booking_date_settings setting
  left join lateral (
    select capacity from public.availability_slots
    where (starts_at at time zone 'Asia/Manila')::date=target_date
    order by is_open desc, starts_at desc limit 1
  ) s on true
  where setting.booking_date=target_date;
  slot_capacity := coalesce(slot_capacity,6);

  for prior in select * from public.availability_slots
    where (starts_at at time zone 'Asia/Manila')::date=target_date and is_open for update
  loop
    update public.availability_slots set is_open=false where id=prior.id;
  end loop;
  update public.booking_time_blocks set is_active=false,reopened_at=now()
    where booking_date=target_date and is_active;

  if pause_from is null then
    insert into public.availability_slots(starts_at,ends_at,capacity,is_open)
    values((target_date+opening) at time zone 'Asia/Manila',(target_date+closing) at time zone 'Asia/Manila',slot_capacity,true);
  else
    if opening < pause_from then
      insert into public.availability_slots(starts_at,ends_at,capacity,is_open)
      values((target_date+opening) at time zone 'Asia/Manila',(target_date+pause_from) at time zone 'Asia/Manila',slot_capacity,true);
    end if;
    if pause_to < closing then
      insert into public.availability_slots(starts_at,ends_at,capacity,is_open)
      values((target_date+pause_to) at time zone 'Asia/Manila',(target_date+closing) at time zone 'Asia/Manila',slot_capacity,true);
    end if;
    insert into public.booking_time_blocks(booking_date,starts_at,ends_at,reason,created_by)
    values(target_date,pause_from,pause_to,pause_reason,auth.uid());
  end if;
  return jsonb_build_object('booking_date',target_date,'opening_time',opening,'closing_time',closing,'pause_from',pause_from,'pause_to',pause_to);
end $$;
revoke all on function private.manage_booking_availability(jsonb) from public;

create or replace function public.manage_booking_availability(payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.manage_booking_availability(payload)
$$;
revoke all on function public.manage_booking_availability(jsonb) from public,anon;
grant execute on function public.manage_booking_availability(jsonb) to authenticated;
