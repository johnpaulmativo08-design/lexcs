-- Phase 116: choose what each cashier can do
-- -----------------------------------------------------------------------------------------------------------------
-- What this does, in plain words:
--   * Each cashier (public.staff_members) gets on/off switches in a new "permissions" field:
--       confirm_orders · move_orders (Start making → Ready → Complete) · check_payments · record_stock ·
--       see_reservations — all ON unless the owner turns them off — and cancel_orders, OFF unless turned on.
--   * private.staff_can('<switch>') answers "may the person signed in do this?": always yes for the owner; for a
--     cashier it reads their switch (missing switches use the defaults above); no for everyone else.
--   * The database enforces the switches, so hiding a button is never the only guard:
--       - set_order_status: confirming, moving along and cancelling each need their switch (cancelling was
--         owner-only; now a cashier can cancel only if the owner turns it on).
--       - review_order_payment: checking a payment needs check_payments.
--       - get_booking_schedule: the reservation list needs see_reservations.
--       - a new trigger on inventory_movements: a cashier's manual stock entry (not tied to an order) needs
--         record_stock. Stock taken automatically when an order goes to Start making is not affected.
--     These three functions are patched in place from their live definitions: only the access check line gets
--     one more condition; if that line is not found, nothing is changed and the script stops.
--   * New RPCs: list_staff_permissions() and set_staff_permissions() for the owner, my_staff_permissions() so a
--     cashier's screen can hide what is switched off. Changes to the switches show in the Activity log (phase 115).
-- Safe to run more than once.

alter table public.staff_members add column if not exists permissions jsonb not null default '{}'::jsonb;

create or replace function private.staff_can(perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when private.is_admin() then true
    when not private.is_staff() then false
    else coalesce((select (s.permissions ->> perm)::boolean from public.staff_members s where s.user_id = auth.uid() and s.active),
                  perm <> 'cancel_orders')
  end
$$;
revoke all on function private.staff_can(text) from public;
grant execute on function private.staff_can(text) to authenticated;

-- patch the access checks in place (live definitions kept; one condition added)
do $$
declare def text; patched text;
  base constant text := 'if auth.uid() is null or not private.is_staff_or_admin() then raise exception ''Admin access required.'' using errcode=''42501''; end if;';
begin
  -- orders: confirm / move along / cancel
  def := pg_get_functiondef('private.set_order_status(uuid,text)'::regprocedure);
  if position('staff_can(' in def) = 0 then
    patched := replace(def,
      'if not private.is_admin() and next_status not in (''confirmed'', ''preparing'', ''ready'', ''completed'') then raise exception ''Only the owner can cancel orders.'' using errcode = ''42501''; end if;',
      'if not private.is_admin() then
    if next_status = ''cancelled'' and not private.staff_can(''cancel_orders'') then raise exception ''Only the owner can cancel orders.'' using errcode = ''42501''; end if;
    if next_status = ''confirmed'' and not private.staff_can(''confirm_orders'') then raise exception ''You are not allowed to confirm orders.'' using errcode = ''42501''; end if;
    if next_status in (''preparing'', ''ready'', ''completed'') and not private.staff_can(''move_orders'') then raise exception ''You are not allowed to move orders along.'' using errcode = ''42501''; end if;
    if next_status not in (''confirmed'', ''preparing'', ''ready'', ''completed'', ''cancelled'') then raise exception ''Invalid order status.'' using errcode = ''42501''; end if;
  end if;');
    if patched = def then raise exception 'set_order_status: patch point not found; nothing changed.'; end if;
    execute patched;
  end if;

  -- payments: check receipts
  def := pg_get_functiondef('private.review_order_payment(uuid,text,text)'::regprocedure);
  if position('staff_can(' in def) = 0 then
    patched := replace(def, base, base || E'\n  if not private.staff_can(''check_payments'') then raise exception ''You are not allowed to check payments.'' using errcode=''42501''; end if;');
    if patched = def then raise exception 'review_order_payment: patch point not found; nothing changed.'; end if;
    execute patched;
  end if;

  -- reservations list
  def := pg_get_functiondef('public.get_booking_schedule(date,date)'::regprocedure);
  if position('staff_can(' in def) = 0 then
    patched := replace(def, base, base || ' if not private.staff_can(''see_reservations'') then raise exception ''You are not allowed to see reservations.'' using errcode=''42501''; end if;');
    if patched = def then raise exception 'get_booking_schedule: patch point not found; nothing changed.'; end if;
    execute patched;
  end if;
end $$;

-- stock: a cashier's manual stock entry needs record_stock (order-linked deductions are not affected)
create or replace function private.staff_stock_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.order_id is null and not private.is_admin() and private.is_staff() and not private.staff_can('record_stock') then
    raise exception 'You are not allowed to record stock.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.staff_stock_guard() from public;
drop trigger if exists staff_stock_guard on public.inventory_movements;
create trigger staff_stock_guard before insert on public.inventory_movements for each row execute function private.staff_stock_guard();

-- owner: read and set the switches
create or replace function public.list_staff_permissions() returns table (user_id uuid, permissions jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only the owner can see staff permissions.' using errcode = '42501'; end if;
  return query select s.user_id, s.permissions from public.staff_members s;
end $$;

create or replace function public.set_staff_permissions(staff_user uuid, perms jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare clean jsonb := '{}'::jsonb; k text;
begin
  if not private.is_admin() then raise exception 'Only the owner can change staff permissions.' using errcode = '42501'; end if;
  if jsonb_typeof(perms) <> 'object' then raise exception 'Permissions must be a list of switches.'; end if;
  foreach k in array array['confirm_orders','move_orders','check_payments','record_stock','see_reservations','cancel_orders'] loop
    if perms ? k then
      if jsonb_typeof(perms -> k) <> 'boolean' then raise exception 'Switch % must be on or off.', k; end if;
      clean := clean || jsonb_build_object(k, perms -> k);
    end if;
  end loop;
  update public.staff_members set permissions = permissions || clean, updated_at = now() where user_id = staff_user;
  if not found then raise exception 'That person is not on your staff.'; end if;
  return (select permissions from public.staff_members where user_id = staff_user);
end $$;

-- cashier: their own switches (with defaults filled in) so the screen can hide what is off
create or replace function public.my_staff_permissions() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'confirm_orders', private.staff_can('confirm_orders'), 'move_orders', private.staff_can('move_orders'),
    'check_payments', private.staff_can('check_payments'), 'record_stock', private.staff_can('record_stock'),
    'see_reservations', private.staff_can('see_reservations'), 'cancel_orders', private.staff_can('cancel_orders'))
$$;

revoke all on function public.list_staff_permissions(), public.set_staff_permissions(uuid, jsonb), public.my_staff_permissions() from public, anon;
grant execute on function public.list_staff_permissions(), public.set_staff_permissions(uuid, jsonb), public.my_staff_permissions() to authenticated;
