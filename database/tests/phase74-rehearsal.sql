-- Phase 74 rehearsal · tests the gentler transfer and the repair on the real database WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It runs phase 74 (new transfer function + the one-time
-- repair of the accounts phase 72 retired), checks the repair, then pretends to be the current admin (freshly signed
-- in) and transfers admin to one of the repaired accounts, checks every result, and finally stops with an error that
-- holds the report. The error is on purpose: it cancels the whole transaction, so nothing is saved. No emails are
-- printed — only pass/fail and counts.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

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


do $rehearsal$
declare
  admin_id uuid; target_id uuid; target_email text; admin_email text; sessions_before int;
  claims_fresh text; claims_stale text; report text := ''; ok boolean; n int;
begin
  -- the repair: every retired account whose real email is still free is back; the others are skipped untouched
  select count(*) into n from public.admin_transfers t join auth.users u on u.id = t.from_user
   where t.retired_email is not null and u.email like 'retired-admin-%@lexcsnacktime.invalid'
     and not exists (select 1 from auth.users o where lower(o.email) = lower(t.retired_email) and o.id <> t.from_user);
  report := report || E'
' || case when n = 0 then 'PASS' else 'FAIL' end || '  every revivable account was revived (' || n || ' left)';
  select count(*) into n from public.admin_transfers t join auth.users u on u.id = t.from_user
   where t.retired_email is not null and lower(u.email) = lower(t.retired_email) and u.banned_until is null;
  report := report || E'
' || 'INFO  accounts back with their real email and not blocked: ' || n;
  select count(*) into n from public.admin_transfers t join auth.users u on u.id = t.from_user
   where t.retired_email is not null and u.email like 'retired-admin-%@lexcsnacktime.invalid';
  report := report || E'
' || 'INFO  skipped because another account uses the email: ' || n;
  ok := not exists (select 1 from public.admin_transfers t join auth.users u on u.id = t.from_user
                     left join public.user_roles r on r.user_id = u.id
                     where t.retired_email is not null and lower(u.email) = lower(t.retired_email) and coalesce(r.role, 'none') not in ('customer','admin'));
  report := report || E'
' || case when ok then 'PASS' else 'FAIL' end || '  every revived account has a role again (customer)';
  ok := not exists (select 1 from auth.identities i join auth.users u on u.id = i.user_id
                     where i.provider = 'email' and i.identity_data ->> 'email' is distinct from u.email and u.email not like 'retired-admin-%');
  report := report || E'
' || case when ok then 'PASS' else 'FAIL' end || '  email sign-in records match the accounts';
  select count(*) into n from public.user_roles where role = 'admin';
  report := report || E'
' || case when n = 1 then 'PASS' else 'FAIL' end || '  still exactly one admin after the repair';

  -- the new transfer: current admin → one revived account
  select ur.user_id into admin_id from public.user_roles ur where ur.role = 'admin' limit 1;
  select u.id, u.email into target_id, target_email from public.admin_transfers t join auth.users u on u.id = t.from_user
   where t.retired_email is not null and u.id <> admin_id and u.email_confirmed_at is not null
     and exists (select 1 from public.profiles p where p.id = u.id) order by t.created_at limit 1;
  if admin_id is null or target_id is null then raise exception 'REHEARSAL could not start the transfer test.%', report; end if;
  select email into admin_email from auth.users where id = admin_id;
  select count(*) into sessions_before from auth.sessions where user_id = admin_id;
  claims_fresh := json_build_object('sub', admin_id, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text;
  claims_stale := json_build_object('sub', admin_id, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 3600)))::text;

  perform set_config('request.jwt.claims', json_build_object('sub', target_id, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text, true);
  perform set_config('role', 'authenticated', true);
  begin perform public.transfer_admin(admin_email); report := report || E'\nFAIL  a customer was allowed to transfer';
  exception when others then report := report || E'\nPASS  customer refused'; end;
  perform set_config('request.jwt.claims', claims_stale, true);
  begin perform public.transfer_admin(target_email); report := report || E'\nFAIL  stale sign-in was allowed';
  exception when others then report := report || E'\nPASS  stale sign-in refused'; end;
  perform set_config('request.jwt.claims', claims_fresh, true);
  begin perform public.transfer_admin(target_email); report := report || E'\nPASS  transfer ran';
  exception when others then report := report || E'\nFAIL  transfer raised: ' || sqlerrm; end;
  perform set_config('role', 'postgres', true);

  ok := (select role = 'admin' from public.user_roles where user_id = target_id);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  new account is admin';
  ok := (select role = 'customer' from public.user_roles where user_id = admin_id);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  old admin is a customer now';
  select count(*) into n from public.user_roles where role = 'admin';
  report := report || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || '  exactly one admin';
  ok := (select email = admin_email and banned_until is null from auth.users where id = admin_id);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  old admin keeps its email and is not blocked';
  select count(*) into n from auth.sessions where user_id = admin_id;
  report := report || E'\n' || case when n = sessions_before then 'PASS' else 'FAIL' end || '  old admin sessions untouched';
  ok := exists (select 1 from public.admin_transfers where from_user = admin_id and to_user = target_id);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  transfer logged';

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
