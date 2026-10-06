-- Acceptance tests for phase46-confirm-before-payment.sql. Safe on the live database: it borrows one existing order,
-- changes it only inside this transaction and ROLLS EVERYTHING BACK (no sequences are used). The results arrive as an
-- error message on purpose: ending in an error is what undoes the transaction.
begin;
create temp table r(n serial, result text);
create temp table t(k text primary key, v text);
grant all on r, t to authenticated; grant usage on sequence r_n_seq to authenticated;
-- an order with a price and no payments yet; a customer account to act as
insert into t select 'order', o.id::text from public.orders o
  where o.total_amount is not null and o.deposit_due < o.total_amount
    and not exists (select 1 from public.order_payment_attempts p where p.order_id = o.id)
  order by o.created_at desc limit 1;
insert into t select 'customer', customer_id::text from public.orders where id = (select v::uuid from t where k = 'order');
insert into t select 'method', code from public.payment_methods where active order by code limit 1;

create or replace function pg_temp.ok(pass boolean, label text) returns void language sql as $$
  insert into r(result) values ((case when coalesce(pass, false) then 'PASS: ' else 'FAIL: ' end) || label) $$;
create or replace function pg_temp.pay(opt text) returns text language plpgsql as $$
declare p public.order_payment_attempts;
begin
  p := public.start_order_payment((select v::uuid from t where k = 'order'), (select v from t where k = 'method'), opt);
  return p.payment_kind || ' ' || p.amount;
exception when others then return 'ERR ' || sqlerrm;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- fixture: the borrowed order is pending and unpaid (triggers off while preparing it)
set local session_replication_role = replica;
update public.orders set status = 'pending', amount_paid = 0, payment_status = 'unpaid', paid_at = null
  where id = (select v::uuid from t where k = 'order');
set local session_replication_role = origin;

select set_config('request.jwt.claim.sub', (select v from t where k = 'customer'), true),
       set_config('request.jwt.claims', json_build_object('sub', (select v from t where k = 'customer'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok(pg_temp.pay(null) like 'ERR%confirm your order before paying%', 'a pending order cannot be paid yet');
reset role;

set local session_replication_role = replica;
update public.orders set status = 'confirmed' where id = (select v::uuid from t where k = 'order');
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.ok(pg_temp.pay('weekly') like 'ERR%downpayment or full payment%', 'only downpayment or full can be chosen');
select pg_temp.ok(pg_temp.pay('downpayment') = 'downpayment ' || (select deposit_due from public.orders where id = (select v::uuid from t where k = 'order')),
  'confirmed order: downpayment asks for the deposit amount');
select pg_temp.ok(pg_temp.pay('full') = 'full ' || (select total_amount from public.orders where id = (select v::uuid from t where k = 'order')),
  'switching to full payment before sending proof asks for the total');
select pg_temp.ok((select count(*) from public.order_payment_attempts where order_id = (select v::uuid from t where k = 'order')) = 1,
  'switching updates the same payment instead of adding another');
select pg_temp.ok(pg_temp.pay(null) like 'downpayment %', 'leaving the choice out still means a downpayment (older pages)');
reset role;

-- a downpayment that was verified leaves only the balance
set local session_replication_role = replica;
update public.orders set amount_paid = deposit_due, payment_status = 'partially_paid' where id = (select v::uuid from t where k = 'order');
delete from public.order_payment_attempts where order_id = (select v::uuid from t where k = 'order');
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.ok(pg_temp.pay('downpayment') = 'balance ' || (select total_amount - deposit_due from public.orders where id = (select v::uuid from t where k = 'order')),
  'after the downpayment, the next payment is the remaining balance');
reset role;

-- a Lalamove order without a delivery fee cannot be confirmed
set local session_replication_role = replica;
delete from public.order_payment_attempts where order_id = (select v::uuid from t where k = 'order');
update public.orders set status = 'pending', amount_paid = 0, payment_status = 'unpaid', fulfillment_method = 'lalamove',
  delivery_fee_status = 'unquoted', delivery_fee = null, total_amount = null, deposit_due = null
  where id = (select v::uuid from t where k = 'order');
set local session_replication_role = origin;
do $$ begin
  update public.orders set status = 'confirmed' where id = (select v::uuid from t where k = 'order');
  perform pg_temp.ok(false, 'confirming without a delivery fee is blocked');
exception when others then
  perform pg_temp.ok(sqlerrm like 'Set the Lalamove delivery fee before confirming%', 'confirming without a delivery fee is blocked');
end $$;

-- report by raising, which also guarantees that every change above is rolled back
do $$ begin
  raise exception E'PHASE 46 TESTS (all changes rolled back): % failed\n%', (select count(*) from r where result like 'FAIL%'),
    (select string_agg(result, E'\n' order by n) from r);
end $$;
