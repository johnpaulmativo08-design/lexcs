-- Phase 86 rehearsal · PayMongo online payments WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It applies phase 86 twice (the second run must change
-- nothing), switches the PayMongo method on inside the transaction, places and confirms a pretend order, starts an
-- online downpayment as the customer, then plays the two Edge Functions' database calls (checkout start as the
-- customer, attach + record as the service role) and checks who may call what. It ends with an error on purpose so
-- nothing is saved.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

-- ===== phase 86 (run twice) =====
-- 1. What PayMongo reported, kept on the attempt
alter table public.order_payment_attempts
  add column if not exists provider text check (provider is null or provider = 'paymongo'),
  add column if not exists provider_checkout_id text,
  add column if not exists provider_payment_id text,
  add column if not exists provider_method text,
  add column if not exists provider_amount numeric(12,2),
  add column if not exists provider_paid_at timestamptz;
create unique index if not exists order_payment_attempts_provider_checkout_idx on public.order_payment_attempts(provider_checkout_id) where provider_checkout_id is not null;
create unique index if not exists order_payment_attempts_provider_payment_idx on public.order_payment_attempts(provider_payment_id) where provider_payment_id is not null;

-- a submitted attempt has a receipt image (QR) or a PayMongo payment id (online)
alter table public.order_payment_attempts drop constraint if exists order_payment_attempts_check;
alter table public.order_payment_attempts add constraint order_payment_attempts_check check (
  (status = 'awaiting_payment' and submitted_at is null and transaction_reference is null and proof_storage_path is null)
  or (status <> 'awaiting_payment' and submitted_at is not null and transaction_reference is not null
      and (proof_storage_path is not null or provider_payment_id is not null)));

-- 2. The method (off until LexC's switches it on; no QR image of its own: PayMongo shows the QR Ph code)
insert into public.payment_methods (code, display_name, qr_image_path, account_name, masked_account, instructions, active)
select 'paymongo', 'Pay online (GCash / QR Ph)', '', 'PayMongo secure checkout', 'GCash · QR Ph',
       'Pay on PayMongo''s secure page with GCash or any bank / e-wallet app that scans QR Ph. LexC''s confirms the payment after PayMongo reports it.', false
where not exists (select 1 from public.payment_methods where code = 'paymongo');

-- 3. The customer's own attempt, ready for checkout (called by paymongo-checkout with the customer's login)
create or replace function private.paymongo_checkout_start(target_payment uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.order_payment_attempts; o public.orders; m public.payment_methods;
begin
  if auth.uid() is null then raise exception 'Sign in to pay.' using errcode = '42501'; end if;
  select * into p from public.order_payment_attempts where id = target_payment and customer_id = auth.uid();
  if not found then raise exception 'Payment attempt not found.' using errcode = '42501'; end if;
  select * into m from public.payment_methods where id = p.payment_method_id;
  if m.code is distinct from 'paymongo' or not m.active then raise exception 'Online payment is not available for this attempt.'; end if;
  if p.status <> 'awaiting_payment' then raise exception 'This payment was already sent.'; end if;
  select * into o from public.orders where id = p.order_id;
  if o.status = 'cancelled' or o.total_amount is null then raise exception 'This order cannot accept payment.'; end if;
  return jsonb_build_object('payment_id', p.id, 'order_id', o.id, 'order_number', o.order_number, 'amount', p.amount,
    'kind', coalesce(p.payment_kind, 'payment'), 'customer_name', o.customer_name);
end $$;
revoke all on function private.paymongo_checkout_start(uuid) from public;
grant execute on function private.paymongo_checkout_start(uuid) to authenticated;
create or replace function public.paymongo_checkout_start(target_payment uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.paymongo_checkout_start(target_payment) $$;
revoke all on function public.paymongo_checkout_start(uuid) from public, anon;
grant execute on function public.paymongo_checkout_start(uuid) to authenticated;

-- 4. Save the checkout id (service role only: the Edge Function, never the browser)
grant usage on schema private to service_role;
create or replace function private.paymongo_attach_checkout(target_payment uuid, checkout_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(checkout_id, '') !~ '^cs_[A-Za-z0-9]+$' then raise exception 'Invalid checkout id.'; end if;
  update public.order_payment_attempts set provider = 'paymongo', provider_checkout_id = checkout_id
   where id = target_payment and status = 'awaiting_payment';
  if not found then raise exception 'Payment attempt is not awaiting payment.'; end if;
end $$;
revoke all on function private.paymongo_attach_checkout(uuid, text) from public;
grant execute on function private.paymongo_attach_checkout(uuid, text) to service_role;
create or replace function public.paymongo_attach_checkout(target_payment uuid, checkout_id text)
returns void language sql security invoker set search_path = '' as $$ select private.paymongo_attach_checkout(target_payment, checkout_id) $$;
revoke all on function public.paymongo_attach_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.paymongo_attach_checkout(uuid, text) to service_role;

-- 5. PayMongo says the checkout was paid (service role only: paymongo-webhook, after checking the signature).
--    Safe to receive twice. Returns what happened: recorded / duplicate / unknown_checkout / not_awaiting.
create or replace function private.paymongo_record_payment(checkout_id text, payment_id text, amount_centavos bigint, method text, paid_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.order_payment_attempts; o public.orders;
begin
  if coalesce(payment_id, '') !~ '^pay_[A-Za-z0-9]+$' or amount_centavos is null or amount_centavos <= 0 then raise exception 'Invalid PayMongo payment.'; end if;
  select * into p from public.order_payment_attempts where provider_checkout_id = checkout_id;
  if not found then return 'unknown_checkout'; end if;
  select * into o from public.orders where id = p.order_id for update;
  select * into p from public.order_payment_attempts where id = p.id for update;
  if p.provider_payment_id = payment_id then return 'duplicate'; end if;
  if p.status <> 'awaiting_payment' then
    -- the customer moved on (e.g. sent a QR receipt instead): keep PayMongo's report for LexC's, change nothing else
    if p.provider_payment_id is null then
      update public.order_payment_attempts set provider_payment_id = payment_id, provider_method = left(method, 40),
        provider_amount = amount_centavos / 100.0, provider_paid_at = coalesce(paid_at, now()) where id = p.id;
    end if;
    return 'not_awaiting';
  end if;
  update public.order_payment_attempts set status = 'verification_pending', submitted_at = now(), transaction_reference = payment_id,
    provider = 'paymongo', provider_payment_id = payment_id, provider_method = left(method, 40),
    provider_amount = amount_centavos / 100.0, provider_paid_at = coalesce(paid_at, now())
   where id = p.id;
  update public.orders set payment_status = 'verification_pending' where id = o.id;
  return 'recorded';
end $$;
revoke all on function private.paymongo_record_payment(text, text, bigint, text, timestamptz) from public;
grant execute on function private.paymongo_record_payment(text, text, bigint, text, timestamptz) to service_role;
create or replace function public.paymongo_record_payment(checkout_id text, payment_id text, amount_centavos bigint, method text, paid_at timestamptz)
returns text language sql security invoker set search_path = '' as $$ select private.paymongo_record_payment(checkout_id, payment_id, amount_centavos, method, paid_at) $$;
revoke all on function public.paymongo_record_payment(text, text, bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function public.paymongo_record_payment(text, text, bigint, text, timestamptz) to service_role;

-- 6. Chat: an online payment is not a "proof" (in-place patch of the live trigger function, exact-match guard)
do $$
declare def text;
  a1 text := 'when ''verification_pending'' then ''Payment proof received. Admin will verify the actual bank credit. Please do not transfer again while this is pending.''';
  b1 text := 'when ''verification_pending'' then case when new.provider_payment_id is not null then ''Online payment received through PayMongo. LexC will confirm it shortly. Please do not pay again.'' else ''Payment proof received. Admin will verify the actual bank credit. Please do not transfer again while this is pending.'' end';
begin
  def := pg_get_functiondef('private.chat_payment_event()'::regprocedure);
  if position('PayMongo' in def) > 0 then raise notice 'chat_payment_event already mentions PayMongo.'; return; end if;
  if (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 then raise exception 'private.chat_payment_event is not the expected version; review before applying phase 86.'; end if;
  execute replace(def, a1, b1);
end $$;


-- 1. What PayMongo reported, kept on the attempt
alter table public.order_payment_attempts
  add column if not exists provider text check (provider is null or provider = 'paymongo'),
  add column if not exists provider_checkout_id text,
  add column if not exists provider_payment_id text,
  add column if not exists provider_method text,
  add column if not exists provider_amount numeric(12,2),
  add column if not exists provider_paid_at timestamptz;
create unique index if not exists order_payment_attempts_provider_checkout_idx on public.order_payment_attempts(provider_checkout_id) where provider_checkout_id is not null;
create unique index if not exists order_payment_attempts_provider_payment_idx on public.order_payment_attempts(provider_payment_id) where provider_payment_id is not null;

-- a submitted attempt has a receipt image (QR) or a PayMongo payment id (online)
alter table public.order_payment_attempts drop constraint if exists order_payment_attempts_check;
alter table public.order_payment_attempts add constraint order_payment_attempts_check check (
  (status = 'awaiting_payment' and submitted_at is null and transaction_reference is null and proof_storage_path is null)
  or (status <> 'awaiting_payment' and submitted_at is not null and transaction_reference is not null
      and (proof_storage_path is not null or provider_payment_id is not null)));

-- 2. The method (off until LexC's switches it on; no QR image of its own: PayMongo shows the QR Ph code)
insert into public.payment_methods (code, display_name, qr_image_path, account_name, masked_account, instructions, active)
select 'paymongo', 'Pay online (GCash / QR Ph)', '', 'PayMongo secure checkout', 'GCash · QR Ph',
       'Pay on PayMongo''s secure page with GCash or any bank / e-wallet app that scans QR Ph. LexC''s confirms the payment after PayMongo reports it.', false
where not exists (select 1 from public.payment_methods where code = 'paymongo');

-- 3. The customer's own attempt, ready for checkout (called by paymongo-checkout with the customer's login)
create or replace function private.paymongo_checkout_start(target_payment uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.order_payment_attempts; o public.orders; m public.payment_methods;
begin
  if auth.uid() is null then raise exception 'Sign in to pay.' using errcode = '42501'; end if;
  select * into p from public.order_payment_attempts where id = target_payment and customer_id = auth.uid();
  if not found then raise exception 'Payment attempt not found.' using errcode = '42501'; end if;
  select * into m from public.payment_methods where id = p.payment_method_id;
  if m.code is distinct from 'paymongo' or not m.active then raise exception 'Online payment is not available for this attempt.'; end if;
  if p.status <> 'awaiting_payment' then raise exception 'This payment was already sent.'; end if;
  select * into o from public.orders where id = p.order_id;
  if o.status = 'cancelled' or o.total_amount is null then raise exception 'This order cannot accept payment.'; end if;
  return jsonb_build_object('payment_id', p.id, 'order_id', o.id, 'order_number', o.order_number, 'amount', p.amount,
    'kind', coalesce(p.payment_kind, 'payment'), 'customer_name', o.customer_name);
end $$;
revoke all on function private.paymongo_checkout_start(uuid) from public;
grant execute on function private.paymongo_checkout_start(uuid) to authenticated;
create or replace function public.paymongo_checkout_start(target_payment uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.paymongo_checkout_start(target_payment) $$;
revoke all on function public.paymongo_checkout_start(uuid) from public, anon;
grant execute on function public.paymongo_checkout_start(uuid) to authenticated;

-- 4. Save the checkout id (service role only: the Edge Function, never the browser)
grant usage on schema private to service_role;
create or replace function private.paymongo_attach_checkout(target_payment uuid, checkout_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(checkout_id, '') !~ '^cs_[A-Za-z0-9]+$' then raise exception 'Invalid checkout id.'; end if;
  update public.order_payment_attempts set provider = 'paymongo', provider_checkout_id = checkout_id
   where id = target_payment and status = 'awaiting_payment';
  if not found then raise exception 'Payment attempt is not awaiting payment.'; end if;
end $$;
revoke all on function private.paymongo_attach_checkout(uuid, text) from public;
grant execute on function private.paymongo_attach_checkout(uuid, text) to service_role;
create or replace function public.paymongo_attach_checkout(target_payment uuid, checkout_id text)
returns void language sql security invoker set search_path = '' as $$ select private.paymongo_attach_checkout(target_payment, checkout_id) $$;
revoke all on function public.paymongo_attach_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.paymongo_attach_checkout(uuid, text) to service_role;

-- 5. PayMongo says the checkout was paid (service role only: paymongo-webhook, after checking the signature).
--    Safe to receive twice. Returns what happened: recorded / duplicate / unknown_checkout / not_awaiting.
create or replace function private.paymongo_record_payment(checkout_id text, payment_id text, amount_centavos bigint, method text, paid_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.order_payment_attempts; o public.orders;
begin
  if coalesce(payment_id, '') !~ '^pay_[A-Za-z0-9]+$' or amount_centavos is null or amount_centavos <= 0 then raise exception 'Invalid PayMongo payment.'; end if;
  select * into p from public.order_payment_attempts where provider_checkout_id = checkout_id;
  if not found then return 'unknown_checkout'; end if;
  select * into o from public.orders where id = p.order_id for update;
  select * into p from public.order_payment_attempts where id = p.id for update;
  if p.provider_payment_id = payment_id then return 'duplicate'; end if;
  if p.status <> 'awaiting_payment' then
    -- the customer moved on (e.g. sent a QR receipt instead): keep PayMongo's report for LexC's, change nothing else
    if p.provider_payment_id is null then
      update public.order_payment_attempts set provider_payment_id = payment_id, provider_method = left(method, 40),
        provider_amount = amount_centavos / 100.0, provider_paid_at = coalesce(paid_at, now()) where id = p.id;
    end if;
    return 'not_awaiting';
  end if;
  update public.order_payment_attempts set status = 'verification_pending', submitted_at = now(), transaction_reference = payment_id,
    provider = 'paymongo', provider_payment_id = payment_id, provider_method = left(method, 40),
    provider_amount = amount_centavos / 100.0, provider_paid_at = coalesce(paid_at, now())
   where id = p.id;
  update public.orders set payment_status = 'verification_pending' where id = o.id;
  return 'recorded';
end $$;
revoke all on function private.paymongo_record_payment(text, text, bigint, text, timestamptz) from public;
grant execute on function private.paymongo_record_payment(text, text, bigint, text, timestamptz) to service_role;
create or replace function public.paymongo_record_payment(checkout_id text, payment_id text, amount_centavos bigint, method text, paid_at timestamptz)
returns text language sql security invoker set search_path = '' as $$ select private.paymongo_record_payment(checkout_id, payment_id, amount_centavos, method, paid_at) $$;
revoke all on function public.paymongo_record_payment(text, text, bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function public.paymongo_record_payment(text, text, bigint, text, timestamptz) to service_role;

-- 6. Chat: an online payment is not a "proof" (in-place patch of the live trigger function, exact-match guard)
do $$
declare def text;
  a1 text := 'when ''verification_pending'' then ''Payment proof received. Admin will verify the actual bank credit. Please do not transfer again while this is pending.''';
  b1 text := 'when ''verification_pending'' then case when new.provider_payment_id is not null then ''Online payment received through PayMongo. LexC will confirm it shortly. Please do not pay again.'' else ''Payment proof received. Admin will verify the actual bank credit. Please do not transfer again while this is pending.'' end';
begin
  def := pg_get_functiondef('private.chat_payment_event()'::regprocedure);
  if position('PayMongo' in def) > 0 then raise notice 'chat_payment_event already mentions PayMongo.'; return; end if;
  if (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 then raise exception 'private.chat_payment_event is not the expected version; review before applying phase 86.'; end if;
  execute replace(def, a1, b1);
end $$;


do $rehearsal$
declare
  customer_id uuid; v public.product_variants; slot_id uuid; res jsonb; ord public.orders; pay public.order_payment_attempts; det jsonb;
  report text := ''; ok boolean; r text; msg text;
begin
  ok := exists (select 1 from public.payment_methods where code = 'paymongo' and not active);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  "Pay online" method added, switched off';
  update public.payment_methods set active = true where code = 'paymongo';

  select u.id into customer_id from auth.users u join public.profiles pr on pr.id = u.id left join public.user_roles ur on ur.user_id = u.id
   where coalesce(ur.role, 'customer') = 'customer' and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())
   order by u.created_at limit 1;
  select pv.* into v from public.product_variants pv join public.products pr on pr.id = pv.product_id left join public.categories c on c.id = pr.category_id
   where pv.is_active and pv.min_qty <= 1 and pr.status = 'active' and pr.kind = 'standard' and (pr.category_id is null or c.is_active) order by pv.price desc limit 1;
  select s.id into slot_id from public.availability_slots s where s.is_open and s.starts_at > now() + interval '2 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity order by s.starts_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  res := public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Rehearsal', 'phone', '09171234567', 'fulfillment', 'pickup',
    'slot_id', slot_id, 'notes', 'phase 86 rehearsal', 'payment_method', 'paymongo', 'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1))));
  perform set_config('role', 'postgres', true);
  update public.orders set status = 'confirmed' where id = (res->>'id')::uuid returning * into ord;
  report := report || E'\nINFO  pretend order: total ' || ord.total_amount || ', downpayment ' || ord.deposit_due;

  -- the customer chooses "Pay online" (the amount comes from the order, as for QR)
  perform set_config('role', 'authenticated', true);
  perform public.start_order_payment(ord.id, 'paymongo', 'downpayment');
  det := public.paymongo_checkout_start((select id from public.order_payment_attempts where order_id = ord.id and status = 'awaiting_payment'));
  report := report || E'\n' || case when (det->>'amount')::numeric = ord.deposit_due then 'PASS' else 'FAIL' end || '  checkout amount = downpayment from the order (' || (det->>'amount') || ')';
  begin perform public.paymongo_attach_checkout((det->>'payment_id')::uuid, 'cs_rehearsal1'); report := report || E'\nFAIL  a customer could attach a checkout';
  exception when others then report := report || E'\nPASS  customers cannot attach a checkout'; end;
  begin perform public.paymongo_record_payment('cs_rehearsal1', 'pay_rehearsal1', 100, 'gcash', now()); report := report || E'\nFAIL  a customer could record a payment';
  exception when others then report := report || E'\nPASS  customers cannot record a payment'; end;
  perform set_config('role', 'anon', true);
  begin perform public.paymongo_record_payment('cs_rehearsal1', 'pay_rehearsal1', 100, 'gcash', now()); report := report || E'\nFAIL  a guest could record a payment';
  exception when others then report := report || E'\nPASS  guests cannot record a payment'; end;

  -- the Edge Functions (service role)
  perform set_config('role', 'service_role', true);
  perform public.paymongo_attach_checkout((det->>'payment_id')::uuid, 'cs_rehearsal1');
  r := public.paymongo_record_payment('cs_unknown1', 'pay_rehearsal0', 100, 'gcash', now());
  report := report || E'\n' || case when r = 'unknown_checkout' then 'PASS' else 'FAIL' end || '  unknown checkout ignored (' || r || ')';
  r := public.paymongo_record_payment('cs_rehearsal1', 'pay_rehearsal1', round(ord.deposit_due * 100)::bigint, 'gcash', now());
  perform set_config('role', 'postgres', true);
  select * into pay from public.order_payment_attempts where id = (det->>'payment_id')::uuid;
  select * into ord from public.orders where id = ord.id;
  ok := r = 'recorded' and pay.status = 'verification_pending' and pay.transaction_reference = 'pay_rehearsal1' and pay.proof_storage_path is null
    and pay.provider_method = 'gcash' and pay.provider_amount = ord.deposit_due and ord.payment_status = 'verification_pending' and ord.amount_paid = 0;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  paid online → waiting for LexC''s to confirm, nothing marked paid (' || r || ', ' || ord.payment_status || ', paid ' || ord.amount_paid || ')';
  perform set_config('role', 'service_role', true);
  r := public.paymongo_record_payment('cs_rehearsal1', 'pay_rehearsal1', round(ord.deposit_due * 100)::bigint, 'gcash', now());
  perform set_config('role', 'postgres', true);
  report := report || E'\n' || case when r = 'duplicate' then 'PASS' else 'FAIL' end || '  the same PayMongo event twice changes nothing (' || r || ')';
  select m.body into msg from public.chat_messages m where m.payment_id = pay.id and m.message_type = 'payment_proof';
  report := report || E'\n' || case when msg like '%PayMongo%' then 'PASS' else 'FAIL' end || '  chat says: ' || coalesce(msg, '(no message)');

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
