-- Phase 112 · Cashier staff: a third user level between the owner (admin) and customers.
-- What this does, in plain words:
--   * A new role "staff" (cashier). The owner adds a cashier by the email of an account that already signed up,
--     and can switch a cashier off or remove them. Customers can still never change anyone's role.
--   * A cashier can: see orders, bookings, inventory and chat; move a confirmed order along
--     (Start making → Ready → Completed); mark payments received or rejected (every method); add stock and record
--     waste or recounts; read Production and the kitchen timeline; reply to customers in chat.
--   * A cashier can NOT: confirm or cancel orders, change prices, quotes or extras, waive late fees, close dates or
--     change capacity, delete or archive inventory, edit recipes, products, vouchers, the website, payment
--     methods, Settings or Reports, or manage staff. The database refuses these, whatever the screens show.
--   * Every order status change is written to a log with who did it (payments already keep verified_by).
-- How the openings are made: the functions a cashier needs are re-created from their CURRENT definition on this
-- database with the owner check widened to "owner or active cashier". Each one must contain that check; if not,
-- the whole phase stops and nothing changes. The owner-only functions are not touched.
-- Run once in the Supabase SQL editor. Safe to run again.
begin;

-- 1. the role and the cashier list -----------------------------------------------------------------------------
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.user_roles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'role';
  if c is not null then execute format('alter table public.user_roles drop constraint %I', c); end if;
end $$;
alter table public.user_roles add constraint user_roles_role_check check (role in ('customer', 'staff', 'admin'));

create table if not exists public.staff_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  active boolean not null default true,
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.staff_members enable row level security;
revoke all on public.staff_members from public, anon, authenticated;
grant select on public.staff_members to authenticated;
drop policy if exists staff_members_read on public.staff_members;
create policy staff_members_read on public.staff_members for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

-- 2. who counts as staff ------------------------------------------------------------------------------------------
create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles r join public.staff_members s on s.user_id = r.user_id
                 where r.user_id = (select auth.uid()) and r.role = 'staff' and s.active)
$$;
create or replace function private.is_staff_or_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select private.is_admin() or private.is_staff() $$;
create or replace function private.require_staff_or_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_staff_or_admin() then raise exception 'Staff access required.' using errcode = '42501'; end if;
  return auth.uid();
end $$;
revoke all on function private.is_staff(), private.is_staff_or_admin(), private.require_staff_or_admin() from public;
grant execute on function private.is_staff(), private.is_staff_or_admin() to anon, authenticated;
grant execute on function private.require_staff_or_admin() to authenticated;

-- the signed-in person's level, for the screens (owner / staff / customer); never trusted for access
create or replace function public.my_access_level() returns text
language sql stable security definer set search_path = '' as $$
  select case when private.is_admin() then 'admin' when private.is_staff() then 'staff' when auth.uid() is null then 'guest' else 'customer' end
$$;
revoke all on function public.my_access_level() from public; grant execute on function public.my_access_level() to anon, authenticated;

-- 3. open the cashier's functions (from their live definition) -----------------------------------------------------
do $$
declare
  f text; def text; before text;
  open_to_staff text[] := array[
    -- reading: Production, kitchen timeline, workloads, schedule, inventory screens
    'private.bake_timeline(date)', 'private.heavy_workload_alerts()', 'private.production_day(date)', 'private.order_workloads_for(uuid[])',
    'public.get_booking_schedule(date,date)', 'public.order_late_fee_now(uuid)',
    'public.inventory_overview()', 'public.inventory_item_detail(uuid)', 'public.inventory_history(jsonb)', 'public.inventory_snapshot()',
    'private.inventory_item_usage(uuid)', 'public.order_inventory_detail(uuid)', 'public.read_inventory_notifications(boolean,uuid)',
    -- doing: order steps, payments, stock in / waste / recount, chat
    'private.set_order_status(uuid,text)', 'private.review_order_payment(uuid,text,text)',
    'private.inventory_action(jsonb)', 'public.adjust_inventory_item(jsonb)', 'private.record_inventory(jsonb)',
    'private.send_chat_images(uuid,text[],text)', 'private.set_chat_archived(uuid,boolean)',
    -- run inside the steps above (stock is taken when an order starts; allocation after a verified payment)
    'public.allocate_order_inventory(uuid)', 'private.consume_order_inventory()', 'private.consume_inventory_run(uuid)',
    'private.preview_order_inventory(uuid)', 'private.produce_custom_cake_pops(integer,text,uuid)'];
begin
  foreach f in array open_to_staff loop
    def := pg_get_functiondef(f::regprocedure); before := def;
    def := replace(def, 'private.require_admin()', 'private.require_staff_or_admin()');
    def := replace(def, 'private.is_admin()', 'private.is_staff_or_admin()');
    if def = before and position('private.is_staff_or_admin()' in def) = 0 then raise exception 'Phase 112 stopped: no owner check found in %', f; end if;
    -- a cashier moves orders along but never confirms or cancels them
    if f = 'private.set_order_status(uuid,text)' and position('Only the owner can confirm or cancel orders' in def) = 0 then
      def := regexp_replace(def, '(raise exception ''Admin access required\.'' using errcode\s*=\s*''42501''; end if;)',
        E'\\1\n  if not private.is_admin() and next_status not in (''preparing'', ''ready'', ''completed'') then raise exception ''Only the owner can confirm or cancel orders.'' using errcode = ''42501''; end if;');
      if position('Only the owner can confirm or cancel orders' in def) = 0 then raise exception 'Phase 112 stopped: could not add the cashier limit to set_order_status'; end if;
    end if;
    execute def;
  end loop;
end $$;

-- 4. let cashiers read what those screens show (read only; owner rules stay as they are) -------------------------
do $$
declare t text; tables text[] := array[
  'orders', 'order_items', 'order_payment_attempts', 'order_deliveries', 'order_cancellations', 'order_bake_plans',
  'order_workloads', 'order_item_workloads', 'order_inventory_allocations', 'order_inventory_allocation_lines',
  'booking_entries', 'booking_date_settings', 'availability_slots', 'booking_time_blocks', 'production_settings', 'variant_prep_times',
  'chat_conversations', 'chat_messages', 'profiles', 'customer_order_pauses', 'delivery_quotes',
  'inventory_items', 'inventory_batches', 'inventory_movements', 'inventory_alert_state', 'inventory_notifications',
  'inventory_item_aliases', 'inventory_unit_conversions', 'inventory_production_requirements', 'inventory_production_runs'];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then raise notice 'skipped %, not on this database', t; continue; end if;
    execute format('drop policy if exists staff_read on public.%I', t);
    execute format('create policy staff_read on public.%I for select to authenticated using ((select private.is_staff()))', t);
  end loop;
end $$;

-- chat: a cashier writes as the shop (same rules as the owner's text messages) and marks customer messages read
drop policy if exists chat_messages_staff_send on public.chat_messages;
create policy chat_messages_staff_send on public.chat_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and message_type = 'text' and payment_id is null and sender_type = 'admin' and (select private.is_staff()));
drop policy if exists chat_messages_staff_mark_read on public.chat_messages;
create policy chat_messages_staff_mark_read on public.chat_messages for update to authenticated
  using (sender_type <> 'admin' and (select private.is_staff())) with check (sender_type <> 'admin' and (select private.is_staff()));

-- receipts, reference photos and avatars, so a cashier can check a payment and see the design
drop policy if exists staff_payment_proofs_read on storage.objects;
create policy staff_payment_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and (select private.is_staff()));
drop policy if exists staff_private_image_read on storage.objects;
create policy staff_private_image_read on storage.objects for select to authenticated
  using (bucket_id = any (array['customer-references', 'review-images', 'avatars']) and (select private.is_staff()));

-- 5. who moved each order -------------------------------------------------------------------------------------------
create table if not exists public.order_status_log (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text, to_status text not null,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists order_status_log_order on public.order_status_log (order_id, changed_at desc);
alter table public.order_status_log enable row level security;
revoke all on public.order_status_log from public, anon, authenticated;
grant select on public.order_status_log to authenticated;
drop policy if exists order_status_log_read on public.order_status_log;
create policy order_status_log_read on public.order_status_log for select to authenticated using ((select private.is_staff_or_admin()));

create or replace function private.log_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_log (order_id, from_status, to_status, changed_by) values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;
revoke all on function private.log_order_status() from public, anon, authenticated;
drop trigger if exists zz_log_order_status on public.orders;
create trigger zz_log_order_status after update of status on public.orders for each row execute function private.log_order_status();

-- 6. the owner manages cashiers ------------------------------------------------------------------------------------
create or replace function public.add_staff(staff_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid; r text;
begin
  perform private.require_admin();
  select id into u from auth.users where lower(email) = lower(trim(staff_email));
  if u is null then raise exception 'No account uses that email. Ask the cashier to sign up first, then add them.' using errcode = '22023'; end if;
  select role into r from public.user_roles where user_id = u;
  if r = 'admin' then raise exception 'That account is the owner.' using errcode = '22023'; end if;
  insert into public.user_roles (user_id, role) values (u, 'staff') on conflict (user_id) do update set role = 'staff', updated_at = now();
  insert into public.staff_members (user_id, active, added_by) values (u, true, auth.uid())
    on conflict (user_id) do update set active = true, updated_at = now();
  return jsonb_build_object('user_id', u, 'active', true);
end $$;

create or replace function public.set_staff_active(staff_user uuid, turn_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.staff_members set active = turn_on, updated_at = now() where user_id = staff_user;
  if not found then raise exception 'That person is not on the staff list.' using errcode = '22023'; end if;
  return jsonb_build_object('user_id', staff_user, 'active', turn_on);
end $$;

-- removing a cashier keeps their account as a normal customer account; their past actions stay in the logs
create or replace function public.remove_staff(staff_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  delete from public.staff_members where user_id = staff_user;
  update public.user_roles set role = 'customer', updated_at = now() where user_id = staff_user and role = 'staff';
end $$;

create or replace function public.list_staff() returns table (user_id uuid, full_name text, email text, active boolean, added_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query select s.user_id, p.full_name, u.email::text, s.active, s.added_at
    from public.staff_members s join public.profiles p on p.id = s.user_id join auth.users u on u.id = s.user_id order by s.added_at;
end $$;

revoke all on function public.add_staff(text), public.set_staff_active(uuid, boolean), public.remove_staff(uuid), public.list_staff() from public, anon;
grant execute on function public.add_staff(text), public.set_staff_active(uuid, boolean), public.remove_staff(uuid), public.list_staff() to authenticated;

commit;
