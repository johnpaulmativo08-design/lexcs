-- LOCAL ONLY: acceptance tests for phase43-checkout-field-checks.sql (customer ...0c). Rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.who(sub text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(sub, ''), false) $$;
insert into public.availability_slots (starts_at, ends_at, capacity, is_open)
  values (date_trunc('day', now()) + interval '406 days 3 hours 17 minutes', date_trunc('day', now()) + interval '406 days 4 hours 17 minutes', 50, true);
create temp table t(k text primary key, v text); grant all on t to authenticated;
insert into t values
  ('slot', (select id::text from public.availability_slots where starts_at = date_trunc('day', now()) + interval '406 days 3 hours 17 minutes')),
  ('box', (select v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'cake-pops' and v.code = 'pcs12'));
-- place an order with the given name / phone / fulfillment / address; returns the error code or the stored phone
create or replace function pg_temp.place(name text, phone text, fulfillment text, address text) returns text language plpgsql as $$
declare o jsonb;
begin
  o := public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', name, 'phone', phone,
    'fulfillment', fulfillment, 'address', address, 'slot_id', (select v from t where k = 'slot'), 'payment_method', 'maribank',
    'items', jsonb_build_array(jsonb_build_object('variant_id', (select v from t where k = 'box'), 'qty', 1))));
  return (select contact_phone from public.orders where id = (o->>'id')::uuid);
exception when others then return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on all functions in schema pg_temp to authenticated;
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
select pg_temp.check(pg_temp.place('Maria Santos', '0917-123-4567', 'pickup', null) = '0917 123 4567', 'mobile number accepted and tidied');
select pg_temp.check(pg_temp.place('Maria Santos', '+63 917 123 4568', 'pickup', null) = '0917 123 4568', '+63 numbers are converted to 09…');
select pg_temp.check(pg_temp.place('Maria Santos', 'hello', 'pickup', null) like '22023%Philippine mobile%', 'letters are not a number');
select pg_temp.check(pg_temp.place('Maria Santos', '12345', 'pickup', null) like '22023%Philippine mobile%', 'too short');
select pg_temp.check(pg_temp.place('Maria Santos', '0817 123 4567', 'pickup', null) like '22023%Philippine mobile%', 'must start with 09');
select pg_temp.check(pg_temp.place('M', '0917 123 4569', 'pickup', null) like '22023%full name%', 'name needs 2 letters');
select pg_temp.check(pg_temp.place('12', '0917 123 4569', 'pickup', null) like '22023%full name%', 'digits are not a name');
select pg_temp.check(pg_temp.place('Maria Santos', '0917 123 4570', 'lalamove', 'Cebu') like '22023%delivery address%', 'delivery needs a full address');
select pg_temp.check(pg_temp.place('Maria Santos', '0917 123 4571', 'lalamove', '12 Mango St., Lahug, Cebu City') = '0917 123 4571', 'full delivery address accepted');
reset role;
rollback;
