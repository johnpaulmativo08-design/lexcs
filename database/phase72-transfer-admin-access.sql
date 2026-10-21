-- Phase 72 · Transfer admin access.
--
-- Why: the admin account uses a placeholder address (…@lexcsnacktime.local) that can never receive email, so the
-- owner cannot reset its password or use email codes. Instead of changing that account's email, the owner hands
-- the admin role to a real account she already owns (for example her Gmail).
--
-- What it does:
--   1. public.admin_transfers — a log of every hand-over (from, to, the address typed, when). Admin can read it;
--      nobody can write it from the browser.
--   2. public.transfer_admin(target_email) — in one transaction: the target account becomes admin and the old
--      admin account is RETIRED. There is always exactly one admin, never zero or two.
--
-- Retired means: the old account can never sign in again (blocked, all its sessions ended), it is not a customer,
-- and its address (e.g. admin@lexcsnacktime.local) is freed — renamed to an internal retired address — so that
-- email no longer belongs to any account; signing in with it later behaves like a brand-new person. The account
-- row itself stays, because the stock ledger and other history must keep pointing at who did each thing.
--
-- Safety checks inside the function (the browser cannot skip them):
--   • the caller must be the current admin;
--   • the caller must have signed in within the last 5 minutes (the Profile page asks for the password again
--     right before transferring, which renews this);
--   • the target account must already exist, have confirmed its email (6-digit sign-up code or Google), and not be
--     the caller.
--
-- What stays the same: orders, payments, inventory, chats and reports are untouched. Records that name the old
-- account (who verified a payment, who made a change) keep naming it — that is history. Customers still cannot
-- write user_roles. Nothing is deleted.
--
-- How to apply: run this whole file once in the Supabase SQL editor. It changes no data until the owner presses
-- "Transfer admin access" in Admin → Profile.

create table if not exists public.admin_transfers (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  to_email text not null,
  retired_email text,
  created_at timestamptz not null default now()
);
alter table public.admin_transfers enable row level security;
revoke all on public.admin_transfers from anon, authenticated;
grant select on public.admin_transfers to authenticated;
drop policy if exists admin_transfers_admin_read on public.admin_transfers;
create policy admin_transfers_admin_read on public.admin_transfers for select to authenticated using (private.is_admin());

create or replace function private.transfer_admin(target_email text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  me uuid := auth.uid();
  wanted text := lower(trim(coalesce(target_email, '')));
  target uuid;
  confirmed timestamptz;
  old_email text;
  retired text := 'retired-admin-' || replace(auth.uid()::text, '-', '') || '@lexcsnacktime.invalid';
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
  -- 2. the old admin is retired: no role, blocked, email freed, signed out everywhere (history rows stay)
  delete from public.user_roles where user_id = me;
  select u.email into old_email from auth.users u where u.id = me;
  update auth.users
     set email = retired, email_change = '', email_change_token_new = '', email_change_token_current = '',
         banned_until = now() + interval '200 years', updated_at = now()
   where id = me;
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', retired), updated_at = now()
   where user_id = me and provider = 'email';
  delete from auth.sessions where user_id = me;
  delete from auth.refresh_tokens where user_id = me::text;
  -- 3. the log
  insert into public.admin_transfers(from_user, to_user, to_email, retired_email) values (me, target, wanted, old_email);
  return target;
end $$;
revoke all on function private.transfer_admin(text) from public;
grant execute on function private.transfer_admin(text) to authenticated;

create or replace function public.transfer_admin(target_email text)
returns uuid language sql security invoker set search_path='' as $$
  select private.transfer_admin(target_email)
$$;
revoke all on function public.transfer_admin(text) from public;
grant execute on function public.transfer_admin(text) to authenticated;

notify pgrst, 'reload schema';
