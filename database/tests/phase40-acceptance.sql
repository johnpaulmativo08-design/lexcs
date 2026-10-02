-- LOCAL ONLY: acceptance tests for phase39-two-payment-qrs.sql and phase40-remove-payment-test.sql. Run on a
-- DISPOSABLE database built from tests/local-supabase-stub.sql + phases 2-40 (customer ...0c). Everything is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.who(sub text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(sub, ''), false) $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- 1. Two QRs only, and the ₱1 test is gone -----------------------------------------------------------------
select pg_temp.check((select string_agg(code, ',' order by code) from public.payment_methods where active) = 'gcash,maribank', 'only GCash and MariBank are offered');
select pg_temp.check((select qr_image_path from public.payment_methods where code = 'gcash') = 'payment/assets/gcash-qr.png', 'new GCash QR image');
select pg_temp.check((select qr_image_path from public.payment_methods where code = 'maribank') = 'payment/assets/maribank-qr.png', 'new MariBank QR image');
select pg_temp.check(to_regclass('public.payment_tests') is null, 'payment_tests table removed');
select pg_temp.check(not exists (select 1 from pg_proc where proname in ('start_payment_test', 'submit_payment_test', 'review_payment_test', 'enforce_payment_test_item')), 'payment test functions removed');
select pg_temp.check(not exists (select 1 from pg_trigger where tgname = 'order_items_payment_test'), 'test-only checkout trigger removed');
select pg_temp.check(not exists (select 1 from public.products where slug = 'product-a-payment-system-test' and status = 'active'), 'Product A is off the menu');
select pg_temp.check(not exists (select 1 from public.categories where slug = 'payment-test'), 'Payment Test category removed');

-- 2. A real order still checks out at 60% down and can be paid by QR ------------------------------------------
insert into public.availability_slots (starts_at, ends_at, capacity, is_open)
  values (date_trunc('day', now()) + interval '405 days 3 hours 17 minutes', date_trunc('day', now()) + interval '405 days 4 hours 17 minutes', 20, true);
create temp table t(k text primary key, v text); grant all on t to authenticated;
insert into t values
  ('slot', (select id::text from public.availability_slots where starts_at = date_trunc('day', now()) + interval '405 days 3 hours 17 minutes')),
  ('box', (select v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'cake-pops' and v.code = 'pcs25'));
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
insert into t values ('order', (select (public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Test Customer', 'phone', '09171234567',
  'fulfillment', 'pickup', 'slot_id', (select v from t where k='slot'), 'payment_method', 'maribank',
  'items', jsonb_build_array(jsonb_build_object('variant_id', (select v from t where k='box'), 'qty', 1)))))->>'id'));
reset role;
select pg_temp.check((select deposit_rate = 0.6 and deposit_due = 270 from public.orders where id = (select v::uuid from t where k='order')), '60% downpayment: ₱270 of ₱450');

set role authenticated;
do $$ begin perform public.start_order_payment((select v::uuid from t where k='order'), 'maya'); raise exception 'FAILED: Maya should be unavailable';
  exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'PASS: Maya can no longer be chosen'; end $$;
insert into t values ('pay', (select (public.start_order_payment((select v::uuid from t where k='order'), 'gcash')).id::text));
reset role;
select pg_temp.check((select amount from public.order_payment_attempts where id = (select v::uuid from t where k='pay')) = 270, 'GCash QR asks for ₱270');
insert into storage.objects (bucket_id, name, metadata, owner) values ('payment-proofs',
  '00000000-0000-0000-0000-00000000000c/' || (select v from t where k='order') || '/' || (select v from t where k='pay') || '/proof.png',
  '{"mimetype":"image/png","size":1200}', '00000000-0000-0000-0000-00000000000c');
set role authenticated;
select public.submit_order_payment((select v::uuid from t where k='pay'), 'GC-REF-40', '00000000-0000-0000-0000-00000000000c/' || (select v from t where k='order') || '/' || (select v from t where k='pay') || '/proof.png');
reset role;
select pg_temp.check((select status from public.order_payment_attempts where id = (select v::uuid from t where k='pay')) = 'verification_pending', 'proof submitted, waiting for Admin');
select pg_temp.check((select payment_status from public.orders where id = (select v::uuid from t where k='order')) = 'verification_pending', 'order shows payment under review');
rollback;
