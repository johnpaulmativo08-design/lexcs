-- Phase 97: bake timeline (warnings only, nothing is blocked).
--  * Baking happens inside one kitchen window each day: 4:00 AM – 4:30 PM (bake_start / bake_end, in minutes after midnight).
--  * Every order must be finished baking 1 hour before its delivery time (bake_lead_minutes).
--  * Orders are packed backwards from their deadlines, latest deadline first, one after another (one oven/kitchen):
--    each order's bake ends at the earlier of its deadline and the start of the bake after it. Its prep minutes
--    (phase 96) are the bake length. If an order's bake would start before the window opens, it is flagged
--    "does not fit" so the Admin sees it before accepting (Orders → Confirm asks first).
--  * Pending, confirmed, preparing and ready orders are planned together. Completed and cancelled orders are not.
--  * Needs phase 96 (order_minutes). Safe to re-run.
begin;

alter table public.production_settings
  add column if not exists bake_start_minutes integer not null default 240 check (bake_start_minutes between 0 and 1439),
  add column if not exists bake_end_minutes integer not null default 990 check (bake_end_minutes between 1 and 1440),
  add column if not exists bake_lead_minutes integer not null default 60 check (bake_lead_minutes between 0 and 240);

-- the packing, for one Manila date. Admin only.
create or replace function private.bake_timeline(target_date date)
returns table(order_id uuid, order_number bigint, customer_name text, status text, minutes integer,
              delivery_at timestamptz, deadline_minutes integer, bake_start_minutes integer, bake_finish_minutes integer, fits boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  ps public.production_settings;
  cursor_min integer := 1440;   -- the next bake must finish before this minute
  fin integer; st integer;
  r record;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  if target_date is null then raise exception 'Choose a date.' using errcode = '22023'; end if;
  select * into ps from public.production_settings where id;

  for r in
    select o.id as oid, o.order_number as onum, o.customer_name as cname, o.status as ostatus,
           private.order_minutes(o.id) as mins, o.receiving_start as delivery,
           ((extract(hour from (o.receiving_start at time zone 'Asia/Manila')) * 60
             + extract(minute from (o.receiving_start at time zone 'Asia/Manila')))::integer - ps.bake_lead_minutes) as dl
    from public.orders o
    where (o.receiving_start at time zone 'Asia/Manila')::date = target_date
      and o.status in ('pending', 'confirmed', 'preparing', 'ready')
    order by 7 desc, o.created_at, o.id
  loop
    fin := least(r.dl, cursor_min);
    st := fin - r.mins;
    cursor_min := st;

    order_id := r.oid;
    order_number := r.onum;
    customer_name := r.cname;
    status := r.ostatus;
    minutes := r.mins;
    delivery_at := r.delivery;
    deadline_minutes := r.dl;
    bake_start_minutes := st;
    bake_finish_minutes := fin;
    fits := st >= ps.bake_start_minutes and fin <= ps.bake_end_minutes;
    return next;
  end loop;
end $$;
revoke all on function private.bake_timeline(date) from public;
grant execute on function private.bake_timeline(date) to authenticated;

create or replace function public.get_bake_timeline(target_date date)
returns table(order_id uuid, order_number bigint, customer_name text, status text, minutes integer,
              delivery_at timestamptz, deadline_minutes integer, bake_start_minutes integer, bake_finish_minutes integer, fits boolean)
language sql security invoker set search_path = '' as $$ select * from private.bake_timeline(target_date) $$;
revoke all on function public.get_bake_timeline(date) from public, anon;
grant execute on function public.get_bake_timeline(date) to authenticated;

-- checks ---------------------------------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'production_settings' and column_name = 'bake_lead_minutes') then
    raise exception 'Phase 97: production_settings is missing the bake columns';
  end if;
  if to_regprocedure('public.get_bake_timeline(date)') is null then raise exception 'Phase 97: get_bake_timeline is missing'; end if;
end $$;
commit;
