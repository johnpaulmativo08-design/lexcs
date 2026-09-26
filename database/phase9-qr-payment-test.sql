-- Isolated real-money QR verification trial. It never alters operational orders.
create table if not exists public.payment_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  customer_name text not null,
  client_request_id uuid not null,
  amount_due numeric(12,2) not null default 1.00 check (amount_due = 1.00),
  currency text not null default 'PHP' check (currency = 'PHP'),
  payment_method text not null default 'MariBank QR Ph' check (payment_method = 'MariBank QR Ph'),
  payment_reference text,
  status text not null default 'awaiting_transfer' check (status in ('awaiting_transfer','submitted','verified','rejected')),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_request_id)
);

create index if not exists payment_tests_user_created_idx on public.payment_tests(user_id, created_at desc);
create index if not exists payment_tests_status_created_idx on public.payment_tests(status, created_at desc);
create unique index if not exists payment_tests_active_reference_idx
  on public.payment_tests(lower(btrim(payment_reference)))
  where payment_reference is not null and status in ('submitted','verified');

alter table public.payment_tests enable row level security;
revoke all on public.payment_tests from anon, authenticated;
grant select on public.payment_tests to authenticated;
create policy payment_tests_read on public.payment_tests for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create trigger payment_tests_touch_updated_at before update on public.payment_tests
  for each row execute function private.touch_updated_at();

create or replace function private.start_payment_test(request_id uuid)
returns public.payment_tests language plpgsql security definer set search_path = '' as $$
declare result public.payment_tests; customer text;
begin
  if auth.uid() is null then raise exception 'Sign in to start a payment test.' using errcode='42501'; end if;
  if request_id is null then raise exception 'Request ID is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment-test:' || auth.uid()::text || request_id::text, 0));
  select * into result from public.payment_tests where user_id=auth.uid() and client_request_id=request_id;
  if found then return result; end if;
  select coalesce(nullif(trim(full_name),''),'Customer') into customer from public.profiles where id=auth.uid();
  insert into public.payment_tests(user_id,customer_name,client_request_id)
    values(auth.uid(),customer,request_id) returning * into result;
  return result;
end $$;
revoke all on function private.start_payment_test(uuid) from public;
grant execute on function private.start_payment_test(uuid) to authenticated;
create or replace function public.start_payment_test(request_id uuid)
returns public.payment_tests language sql security invoker set search_path = '' as $$
  select private.start_payment_test(request_id)
$$;
revoke all on function public.start_payment_test(uuid) from public;
grant execute on function public.start_payment_test(uuid) to authenticated;

create or replace function private.submit_payment_test(test_id uuid, transfer_reference text)
returns public.payment_tests language plpgsql security definer set search_path = '' as $$
declare result public.payment_tests; normalized text := nullif(left(trim(transfer_reference),100),'');
begin
  if auth.uid() is null then raise exception 'Sign in to submit a reference.' using errcode='42501'; end if;
  if normalized is null or length(normalized) < 6 or normalized !~ '^[A-Za-z0-9 _-]+$' then
    raise exception 'Enter a valid transfer reference (6–100 letters or digits).';
  end if;
  select * into result from public.payment_tests where id=test_id and user_id=auth.uid() for update;
  if not found then raise exception 'Payment test not found.' using errcode='42501'; end if;
  if result.status not in ('awaiting_transfer','rejected') then raise exception 'This transfer has already been submitted for review.'; end if;
  update public.payment_tests set payment_reference=normalized,status='submitted',submitted_at=now(),reviewed_by=null,reviewed_at=null,review_note=null
    where id=test_id returning * into result;
  return result;
end $$;
revoke all on function private.submit_payment_test(uuid,text) from public;
grant execute on function private.submit_payment_test(uuid,text) to authenticated;
create or replace function public.submit_payment_test(test_id uuid, transfer_reference text)
returns public.payment_tests language sql security invoker set search_path = '' as $$
  select private.submit_payment_test(test_id,transfer_reference)
$$;
revoke all on function public.submit_payment_test(uuid,text) from public;
grant execute on function public.submit_payment_test(uuid,text) to authenticated;

create or replace function private.review_payment_test(test_id uuid, decision text, note text default null)
returns public.payment_tests language plpgsql security definer set search_path = '' as $$
declare result public.payment_tests;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
  if decision not in ('verified','rejected') then raise exception 'Choose verified or rejected.'; end if;
  select * into result from public.payment_tests where id=test_id for update;
  if not found then raise exception 'Payment test not found.'; end if;
  if result.status <> 'submitted' then raise exception 'Only submitted transfers can be reviewed.'; end if;
  if decision='verified' and nullif(trim(coalesce(note,'')),'') is null then
    raise exception 'Record the bank-side confirmation details before verifying.';
  end if;
  update public.payment_tests set status=decision,review_note=nullif(left(trim(note),500),''),reviewed_by=auth.uid(),reviewed_at=now()
    where id=test_id returning * into result;
  return result;
end $$;
revoke all on function private.review_payment_test(uuid,text,text) from public;
grant execute on function private.review_payment_test(uuid,text,text) to authenticated;
create or replace function public.review_payment_test(test_id uuid, decision text, note text default null)
returns public.payment_tests language sql security invoker set search_path = '' as $$
  select private.review_payment_test(test_id,decision,note)
$$;
revoke all on function public.review_payment_test(uuid,text,text) from public;
grant execute on function public.review_payment_test(uuid,text,text) to authenticated;
