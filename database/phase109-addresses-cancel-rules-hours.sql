-- Phase 109 · Saved addresses, cancellation rules, and receiving times 9 AM – 10 PM.
-- What this does, in plain words:
--   1. Saved addresses (public.customer_addresses): each customer keeps up to 10 delivery addresses (name, phone,
--      address and the map pin). Checkout shows them as cards to pick; a new address is saved when an order is placed.
--      Customers only ever see and change their own; nobody else can read them except LexC's (admin).
--   2. Cancelling an order needs a reason (picked from a list). Customers may cancel up to 3 orders a day
--      (Philippine time). The 4th cancellation in a day still goes through, but new orders are then paused for
--      8 hours (public.customer_order_pauses). public.cancel_my_order_with_reason does this; the old
--      public.cancel_my_order still works and counts the same way (reason "Not given").
--      While paused, a new order is refused with the time it opens again. LexC's (admin) is never paused.
--   3. Receiving times run 9 AM – 10 PM: the hourly slots 6 PM, 7 PM, 8 PM and 9 PM are added to every day that
--      already has a 5 PM slot (same capacity, open or closed the same way). Nothing else about the slots changes.
-- Safe to run more than once.
begin;

-- 1. saved addresses -------------------------------------------------------------------------------------------
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  label text check (label is null or length(label) <= 40),
  recipient text not null check (length(btrim(recipient)) between 1 and 120),
  phone text not null check (length(btrim(phone)) between 7 and 30),
  address text not null check (length(btrim(address)) between 5 and 500),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_addresses_owner on public.customer_addresses (customer_id, updated_at desc);
alter table public.customer_addresses enable row level security;
revoke all on public.customer_addresses from anon, authenticated;
grant select, insert, update, delete on public.customer_addresses to authenticated;
drop policy if exists customer_addresses_own on public.customer_addresses;
create policy customer_addresses_own on public.customer_addresses for all to authenticated
  using (customer_id = (select auth.uid()) or (select private.is_admin())) with check (customer_id = (select auth.uid()));

create or replace function private.customer_address_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and (select count(*) from public.customer_addresses where customer_id = new.customer_id) >= 10 then
    raise exception 'You can save up to 10 addresses. Remove one first.' using errcode = '22023'; end if;
  if new.is_default then
    update public.customer_addresses set is_default = false where customer_id = new.customer_id and id <> new.id and is_default;
  end if;
  return new;
end $$;
revoke all on function private.customer_address_rules() from public;
drop trigger if exists customer_addresses_rules on public.customer_addresses;
create trigger customer_addresses_rules before insert or update on public.customer_addresses for each row execute function private.customer_address_rules();

-- 2. cancellation reasons, daily limit and the 8-hour pause -----------------------------------------------------
create table if not exists public.order_cancellations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (length(reason) between 2 and 300),
  created_at timestamptz not null default now()
);
create index if not exists order_cancellations_customer on public.order_cancellations (customer_id, created_at desc);
alter table public.order_cancellations enable row level security;
revoke all on public.order_cancellations from anon, authenticated;
grant select on public.order_cancellations to authenticated;
drop policy if exists order_cancellations_read on public.order_cancellations;
create policy order_cancellations_read on public.order_cancellations for select to authenticated
  using (customer_id = (select auth.uid()) or (select private.is_admin()));

create table if not exists public.customer_order_pauses (
  customer_id uuid primary key references public.profiles(id) on delete cascade,
  paused_until timestamptz not null,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.customer_order_pauses enable row level security;
revoke all on public.customer_order_pauses from anon, authenticated;
grant select on public.customer_order_pauses to authenticated;
drop policy if exists customer_order_pauses_read on public.customer_order_pauses;
create policy customer_order_pauses_read on public.customer_order_pauses for select to authenticated
  using (customer_id = (select auth.uid()) or (select private.is_admin()));

create or replace function private.cancel_my_order_with_reason(target_order uuid, why text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; today_count integer; pause timestamptz := null;
  day_start timestamptz := ((now() at time zone 'Asia/Manila')::date)::timestamp at time zone 'Asia/Manila';
begin
  if auth.uid() is null then raise exception 'Sign in to cancel an order.' using errcode = '42501'; end if;
  why := nullif(btrim(coalesce(why, '')), '');
  if why is null or length(why) < 2 then raise exception 'Please choose a reason for cancelling.' using errcode = '22023'; end if;
  if length(why) > 300 then why := left(why, 300); end if;
  if exists (select 1 from public.orders where id = target_order and customer_id = auth.uid() and status = 'cancelled') then
    select * into o from public.orders where id = target_order; return jsonb_build_object('order_id', o.id, 'already', true);
  end if;
  o := private.cancel_my_order(target_order);
  insert into public.order_cancellations (order_id, customer_id, reason) values (o.id, auth.uid(), why);
  select count(*) into today_count from public.order_cancellations where customer_id = auth.uid() and created_at >= day_start;
  if today_count > 3 then
    pause := now() + interval '8 hours';
    insert into public.customer_order_pauses (customer_id, paused_until, reason)
    values (auth.uid(), pause, today_count || ' cancellations on ' || to_char(now() at time zone 'Asia/Manila', 'Mon FMDD'))
    on conflict (customer_id) do update set paused_until = greatest(public.customer_order_pauses.paused_until, excluded.paused_until), reason = excluded.reason, created_at = now();
  end if;
  return jsonb_build_object('order_id', o.id, 'cancellations_today', today_count, 'paused_until', pause);
end $$;
revoke all on function private.cancel_my_order_with_reason(uuid, text) from public;
grant execute on function private.cancel_my_order_with_reason(uuid, text) to authenticated;
create or replace function public.cancel_my_order_with_reason(order_id uuid, reason text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.cancel_my_order_with_reason(order_id, reason) $$;
revoke all on function public.cancel_my_order_with_reason(uuid, text) from public, anon;
grant execute on function public.cancel_my_order_with_reason(uuid, text) to authenticated;
-- the old call counts the same way (no way around the limit)
create or replace function public.cancel_my_order(order_id uuid) returns public.orders
language plpgsql security invoker set search_path = '' as $$
declare r public.orders;
begin
  perform private.cancel_my_order_with_reason(order_id, 'Not given');
  select * into r from public.orders where id = order_id;
  return r;
end $$;

create or replace function private.order_pause_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare until timestamptz;
begin
  if coalesce(private.is_admin(), false) then return new; end if;
  select paused_until into until from public.customer_order_pauses where customer_id = new.customer_id and paused_until > now();
  if until is not null then
    raise exception 'New orders are paused until % because of too many cancellations today. Message LexC''s if you need help.',
      to_char(until at time zone 'Asia/Manila', 'Mon FMDD, FMHH12:MI AM') using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.order_pause_check() from public;
drop trigger if exists orders_pause_check on public.orders;
create trigger orders_pause_check before insert on public.orders for each row execute function private.order_pause_check();

-- 3. receiving times until 10 PM --------------------------------------------------------------------------------
insert into public.availability_slots (starts_at, ends_at, capacity, is_open)
select s.starts_at + make_interval(hours => h), s.starts_at + make_interval(hours => h + 1), s.capacity, s.is_open
  from public.availability_slots s
  cross join generate_series(1, 4) h
 where to_char(s.starts_at at time zone 'Asia/Manila', 'HH24:MI') = '17:00' and s.starts_at > now()
   and not exists (select 1 from public.availability_slots x where x.starts_at = s.starts_at + make_interval(hours => h));

commit;
notify pgrst, 'reload schema';
