-- Phase 74 · Gentler admin transfer, and bring the retired admin accounts back as customers.
--
-- Why: phase 72 "retired" the old admin account on every transfer — renamed its email, blocked it for 200 years and
-- signed it out everywhere. In practice that locked real people out of their own Gmail accounts (their Google
-- sign-in still pointed at the blocked account), and the owner decided she only wants the old admin to lose its
-- admin privilege, nothing more.
--
-- What it does:
--   1. public.transfer_admin(target_email) keeps every safety check from phase 72 (caller is the admin, signed in
--      within 5 minutes, target exists, has confirmed its email, is not the caller) and still makes the target the
--      admin in one step, so there is always exactly one admin. The only change: the old admin account simply
--      becomes a normal customer again — same email, not blocked, not signed out of anything else, its own orders
--      and chats still there. (Its admin pages stop working at once, because every admin check reads the role.)
--   2. One-time repair for the three accounts phase 72 retired (the old built-in admin and two Gmail accounts —
--      read from the admin_transfers log, not typed here):
--      put the real email back, remove the block, and make each one a customer. Each is skipped, with a notice, if a
--      different account has taken that email since. Google sign-in works again because it was never detached.
--      (When this was written, admin@lexcsnacktime.local had been signed up again as a new customer on Oct 24, so
--      the old built-in admin stays retired and that newer account keeps the address.)
--
-- What stays the same: the current admin (whoever it is when this runs) stays admin. Orders, payments, inventory,
-- chats, reports and the admin_transfers log are untouched. Customers still cannot write user_roles.
--
-- How to apply: rehearse with database/tests/phase74-rehearsal.sql (rolls itself back), then run this whole file once
-- in the Supabase SQL editor.

-- 1. Transfer: the old admin becomes a customer ---------------------------------------------------------------
create or replace function private.transfer_admin(target_email text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  me uuid := auth.uid();
  wanted text := lower(trim(coalesce(target_email, '')));
  target uuid;
  confirmed timestamptz;
  old_email text;
begin
  if me is null or not private.is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  -- a fresh sign-in (password, Google or code) within the last 5 minutes
  if not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
     where (a ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 300
  ) then
    raise exception 'For your security, enter your password again and retry.' using errcode = '42501';
  end if;
  if wanted !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'Enter the full email address of the new admin account.';
  end if;

  select u.id, u.email_confirmed_at into target, confirmed from auth.users u where lower(u.email) = wanted;
  if target is null then
    raise exception 'No account uses that email yet. Sign up with it on the shop first, then try again.';
  end if;
  if confirmed is null then
    raise exception 'That account has not confirmed its email yet. Enter the 6-digit code from its sign-up email first.';
  end if;
  if target = me then
    raise exception 'That is already the admin account.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target) then
    raise exception 'That account is not fully set up yet. Sign in with it once on the shop, then try again.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lexc-admin-transfer', 0));
  -- 1. the new account becomes the admin
  insert into public.user_roles(user_id, role) values (target, 'admin')
    on conflict (user_id) do update set role = 'admin', updated_at = now();
  -- 2. the old admin loses only its admin privilege: it is a normal customer again (not blocked, email kept)
  insert into public.user_roles(user_id, role) values (me, 'customer')
    on conflict (user_id) do update set role = 'customer', updated_at = now();
  select u.email into old_email from auth.users u where u.id = me;
  -- 3. the log (retired_email now just records the old admin's address)
  insert into public.admin_transfers(from_user, to_user, to_email, retired_email) values (me, target, wanted, old_email);
  return target;
end $$;
revoke all on function private.transfer_admin(text) from public;
grant execute on function private.transfer_admin(text) to authenticated;

-- 2. One-time repair: accounts retired by phase 72 come back as customers ------------------------------------
do $$
declare r record; restored int := 0;
begin
  for r in
    select distinct on (t.from_user) t.from_user as id, t.retired_email as real_email, u.email as current_email
      from public.admin_transfers t join auth.users u on u.id = t.from_user
     where t.retired_email is not null and u.email like 'retired-admin-%@lexcsnacktime.invalid'
     order by t.from_user, t.created_at desc
  loop
    if exists (select 1 from auth.users o where lower(o.email) = lower(r.real_email) and o.id <> r.id) then
      raise notice 'Skipped %: another account uses that email now.', r.real_email;
      continue;
    end if;
    update auth.users set email = r.real_email, banned_until = null, updated_at = now() where id = r.id;
    update auth.identities
       set identity_data = identity_data || jsonb_build_object('email', r.real_email), updated_at = now()
     where user_id = r.id and provider = 'email';
    insert into public.user_roles(user_id, role) values (r.id, 'customer')
      on conflict (user_id) do update set role = 'customer', updated_at = now()
      where public.user_roles.role <> 'admin';
    restored := restored + 1;
    raise notice 'Restored % as a customer.', r.real_email;
  end loop;
  raise notice 'Accounts restored: %', restored;
end $$;

notify pgrst, 'reload schema';
