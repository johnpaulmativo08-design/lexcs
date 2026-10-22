-- Phase 72 rehearsal · tests "Transfer admin access" on the real database WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. Everything below runs as one transaction: it creates the
-- phase72 table and functions, pretends to be the current admin (freshly signed in), transfers admin to an existing
-- confirmed customer account, checks every result, tries the cases that must fail, and then stops with an error
-- message that holds the report. The error is on purpose: it cancels the whole transaction, so the phase72 setup,
-- the transfer and the retirement are all undone. No emails are printed — only pass/fail.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

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


do $rehearsal$
declare
  admin_id uuid; target_id uuid; target_email text; unconfirmed_email text;
  claims_fresh text; claims_stale text; report text := ''; msg text;
  ok boolean;
begin
  select ur.user_id into admin_id from public.user_roles ur where ur.role = 'admin' limit 1;
  select u.id, u.email into target_id, target_email
    from auth.users u join public.profiles p on p.id = u.id left join public.user_roles ur on ur.user_id = u.id
   where u.email_confirmed_at is not null and u.email is not null and coalesce(ur.role, 'customer') <> 'admin'
   order by u.created_at limit 1;
  select u.email into unconfirmed_email from auth.users u where u.email_confirmed_at is null and u.email is not null limit 1;
  if admin_id is null or target_id is null then raise exception 'REHEARSAL could not start: need one admin and one confirmed customer account.'; end if;

  claims_fresh := json_build_object('sub', admin_id, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text;
  claims_stale := json_build_object('sub', admin_id, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 3600)))::text;

  -- must fail: a customer tries to transfer
  perform set_config('request.jwt.claims', json_build_object('sub', target_id, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text, true);
  perform set_config('role', 'authenticated', true);
  begin perform public.transfer_admin(target_email); report := report || E'\nFAIL  customer was allowed to transfer';
  exception when others then report := report || E'\nPASS  customer refused: ' || sqlerrm; end;

  -- must fail: admin with an old sign-in (over 5 minutes)
  perform set_config('request.jwt.claims', claims_stale, true);
  begin perform public.transfer_admin(target_email); report := report || E'\nFAIL  stale sign-in was allowed';
  exception when others then report := report || E'\nPASS  stale sign-in refused: ' || sqlerrm; end;

  perform set_config('request.jwt.claims', claims_fresh, true);
  -- must fail: unknown email, own email, unconfirmed email
  begin perform public.transfer_admin('nobody-' || gen_random_uuid() || '@example.com'); report := report || E'\nFAIL  unknown email was allowed';
  exception when others then report := report || E'\nPASS  unknown email refused: ' || sqlerrm; end;
  begin perform public.transfer_admin((select email from auth.users where id = admin_id)); report := report || E'\nFAIL  transfer to self was allowed';
  exception when others then report := report || E'\nPASS  transfer to self refused: ' || sqlerrm; end;
  if unconfirmed_email is not null then
    begin perform public.transfer_admin(unconfirmed_email); report := report || E'\nFAIL  unconfirmed email was allowed';
    exception when others then report := report || E'\nPASS  unconfirmed email refused: ' || sqlerrm; end;
  else report := report || E'\nSKIP  unconfirmed email (no unconfirmed account exists)'; end if;

  -- the real transfer
  begin perform public.transfer_admin(upper(target_email)); report := report || E'\nPASS  transfer ran (email typed in capitals)';
  exception when others then report := report || E'\nFAIL  transfer raised: ' || sqlerrm; end;
  perform set_config('role', 'postgres', true);

  ok := exists (select 1 from public.user_roles where user_id = target_id and role = 'admin');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  new account is admin';
  ok := not exists (select 1 from public.user_roles where user_id = admin_id);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  old admin has no role (not a customer)';
  ok := (select count(*) from public.user_roles where role = 'admin') = 1;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  exactly one admin';
  ok := (select email like 'retired-admin-%@lexcsnacktime.invalid' from auth.users where id = admin_id);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  old email freed (renamed to retired address)';
  ok := (select banned_until > now() + interval '100 years' from auth.users where id = admin_id);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  old account blocked from signing in';
  ok := not exists (select 1 from auth.sessions where user_id = admin_id);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  old account signed out everywhere';
  ok := not exists (select 1 from auth.identities where user_id = admin_id and provider = 'email' and identity_data ->> 'email' not like 'retired-admin-%');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  old sign-in identity renamed too';
  ok := exists (select 1 from public.profiles where id = admin_id);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  old profile kept for history';
  ok := exists (select 1 from public.admin_transfers where from_user = admin_id and to_user = target_id and retired_email is not null);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  transfer logged';

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
