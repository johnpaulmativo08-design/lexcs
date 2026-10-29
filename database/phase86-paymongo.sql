-- Phase 86 · Pay online through PayMongo (GCash and QR Ph), still confirmed by LexC's.
--
-- Why: customers can pay the downpayment, the full amount, the balance or their own amount online instead of
-- scanning a QR and uploading a receipt. PayMongo tells the site when the money is paid; LexC's still clicks
-- Confirm payment (review_order_payment) exactly as for a QR receipt, so no order is marked paid by itself.
--
-- How it fits the existing flow (nothing about amounts changes):
--   1. The customer picks "Pay online" on the payment page; start_order_payment creates the attempt as usual, with
--      the amount worked out by the database from the order (so a price change in Admin → Products is always what
--      new orders and their payments use; the browser never sends a price).
--   2. The Edge Function paymongo-checkout reads that attempt through public.paymongo_checkout_start (the customer's
--      own login), opens a PayMongo checkout for exactly attempt.amount (GCash and QR Ph only) and saves the
--      checkout id with public.paymongo_attach_checkout (service role only).
--   3. When PayMongo reports the checkout paid, the Edge Function paymongo-webhook checks PayMongo's signature and
--      calls public.paymongo_record_payment (service role only). It moves the attempt to "verification pending"
--      with the PayMongo payment id as its reference — the same state a QR receipt reaches — and keeps what PayMongo
--      reported (method, amount, time) for LexC's to see. A different amount than expected is kept and flagged,
--      never rejected, because the money was already taken.
--   4. LexC's confirms (or rejects) it in Admin as today.
--
-- What it does:
--   - order_payment_attempts: provider, provider_checkout_id, provider_payment_id, provider_method,
--     provider_amount, provider_paid_at; a submitted attempt needs a receipt image OR a PayMongo payment id.
--   - payment_methods: adds "Pay online (GCash / QR Ph)" with code 'paymongo', switched OFF. Switch it on (last
--     statement below, run separately) only after the PayMongo keys and webhook are set up.
--   - The chat message for an online payment says it came through PayMongo instead of "proof received".
--
-- What it does NOT do: change prices, existing attempts, the QR flow, or mark anything paid. No PayMongo key is
-- stored in the database or in any served file (they are Supabase Edge Function secrets).
--
-- How to apply: rehearse with database/tests/phase86-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor. Safe to run twice.

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

notify pgrst, 'reload schema';

-- After the PayMongo keys and webhook are set up and a test payment works, switch the method on (run separately):
-- update public.payment_methods set active = true where code = 'paymongo';
