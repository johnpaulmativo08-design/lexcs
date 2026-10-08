-- Acceptance tests for phase51-additional-price.sql. Safe on the live database: it borrows existing orders, changes them
-- only inside this transaction and ROLLS EVERYTHING BACK. The results arrive as an error message on purpose.
begin;
create temp table r(n serial, result text);
create temp table t(k text primary key, v text);
grant all on r, t to authenticated; grant usage on sequence r_n_seq to authenticated;
create or replace function pg_temp.ok(pass boolean, label text) returns void language sql as $$
  insert into r(result) values ((case when coalesce(pass, false) then 'PASS: ' else 'FAIL: ' end) || label) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return 'ERR ' || sqlerrm; end $$;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t where k = key $$;
create or replace function pg_temp.o() returns public.orders language sql as $$ select * from public.orders where id = pg_temp.v('order')::uuid $$;
create or replace function pg_temp.as_user(who text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.v(who), true),
         set_config('request.jwt.claims', json_build_object('sub', pg_temp.v(who), 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;

insert into t select 'admin', ur.user_id::text from public.user_roles ur join public.profiles p on p.id = ur.user_id where ur.role = 'admin' order by p.created_at limit 1;
-- a priced order whose customer is not the admin
insert into t select 'order', o.id::text from public.orders o
  where o.total_amount is not null and o.customer_id is not null and o.customer_id::text <> pg_temp.v('admin')
  order by o.created_at desc limit 1;
insert into t select 'customer', customer_id::text from public.orders where id = pg_temp.v('order')::uuid;
insert into t select 'total0', total_amount::text from public.orders where id = pg_temp.v('order')::uuid;
insert into t select 'custom0', customization_total::text from public.orders where id = pg_temp.v('order')::uuid;

-- fixture: pending, unpaid, no payments, no earlier proposal (triggers off while preparing it)
set local session_replication_role = replica;
delete from public.order_payment_attempts where order_id = pg_temp.v('order')::uuid;
update public.orders set status = 'pending', amount_paid = 0, payment_status = 'unpaid', paid_at = null, price_review = null, extra_charge = 0
  where id = pg_temp.v('order')::uuid;
set local session_replication_role = origin;

-- ---- only admin can add a price, with a sensible amount and reason
select pg_temp.as_user('customer'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.propose_order_extra(%L, 150, %L)', pg_temp.v('order'), 'Extra work')) like 'ERR%', 'a customer cannot add a price');
reset role; select pg_temp.as_user('admin'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.propose_order_extra(%L, 0, %L)', pg_temp.v('order'), 'Extra work')) like 'ERR%between%', 'an amount of zero is refused');
select pg_temp.ok(pg_temp.err(format('select public.propose_order_extra(%L, 100001, %L)', pg_temp.v('order'), 'Extra work')) like 'ERR%between%', 'an amount over ₱100,000 is refused');
select pg_temp.ok(pg_temp.err(format('select public.propose_order_extra(%L, 150, %L)', pg_temp.v('order'), ' x ')) like 'ERR%few words%', 'a missing reason is refused');
select pg_temp.ok(pg_temp.err(format('select public.propose_order_extra(%L, 150, %L)', pg_temp.v('order'), 'Hand-piped   portrait topper')) = 'ok', 'admin adds ₱150 with a reason');
reset role;
select pg_temp.ok((pg_temp.o()).price_review->>'status' = 'awaiting' and ((pg_temp.o()).price_review->>'amount')::numeric = 150
  and (pg_temp.o()).price_review->>'reason' = 'Hand-piped portrait topper', 'the order holds the waiting proposal (spaces tidied)');
select pg_temp.ok((pg_temp.o()).total_amount = pg_temp.v('total0')::numeric, 'the total does not change before the customer accepts');
select pg_temp.ok((select count(*) from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id
  where m.order_id = pg_temp.v('order')::uuid and c.order_id = m.order_id and m.message_type = 'price_review' and m.attachments->>'status' = 'awaiting') = 1,
  'a price card is posted in the order''s own chat');

-- ---- cannot confirm at the old price while waiting
select pg_temp.as_user('admin'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.set_order_status(%L, %L)', pg_temp.v('order'), 'confirmed')) like 'ERR%Waiting for the customer%', 'confirming is blocked while the price waits');
select pg_temp.ok(pg_temp.err(format('select public.propose_order_extra(%L, 200, %L)', pg_temp.v('order'), 'Two-tier sugar flowers')) = 'ok', 'admin can send a different amount');
reset role;
select pg_temp.ok((select count(*) from public.chat_messages where order_id = pg_temp.v('order')::uuid and message_type = 'price_review' and attachments->>'status' = 'awaiting') = 1
  and (select count(*) from public.chat_messages where order_id = pg_temp.v('order')::uuid and message_type = 'price_review' and attachments->>'status' = 'replaced') = 1,
  'the older card is marked replaced; only one waits');

-- ---- only the order's customer answers; decline keeps the price
select pg_temp.as_user('admin'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.respond_order_extra(%L, true)', pg_temp.v('order'))) like 'ERR%not found%', 'someone else cannot answer for the customer');
reset role; select pg_temp.as_user('customer'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.respond_order_extra(%L, false)', pg_temp.v('order'))) = 'ok', 'the customer declines');
select pg_temp.ok(pg_temp.err(format('select public.respond_order_extra(%L, true)', pg_temp.v('order'))) like 'ERR%no new price%', 'a declined price cannot be accepted later');
reset role;
select pg_temp.ok((pg_temp.o()).price_review->>'status' = 'declined' and (pg_temp.o()).status = 'pending' and (pg_temp.o()).total_amount = pg_temp.v('total0')::numeric
  and (pg_temp.o()).extra_charge = 0, 'after declining: still pending, same total, no extra charge');
select pg_temp.ok((select state from public.chat_conversations where order_id = pg_temp.v('order')::uuid) = 'needs_admin', 'the chat is flagged for LexC''s to reply');
select pg_temp.ok(exists (select 1 from public.chat_messages where order_id = pg_temp.v('order')::uuid and message_type = 'price_review' and attachments->>'status' = 'declined'), 'the card shows Declined');

-- ---- accept: price added, order confirmed, payment opens at the new amounts
select pg_temp.as_user('admin'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.propose_order_extra(%L, 200, %L)', pg_temp.v('order'), 'Two-tier sugar flowers')) = 'ok', 'admin sends the price again');
reset role; select pg_temp.as_user('customer'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.respond_order_extra(%L, true)', pg_temp.v('order'))) = 'ok', 'the customer accepts');
reset role;
select pg_temp.ok((pg_temp.o()).total_amount = pg_temp.v('total0')::numeric + 200, 'the total goes up by exactly ₱200');
select pg_temp.ok((pg_temp.o()).customization_total = pg_temp.v('custom0')::numeric + 200 and (pg_temp.o()).extra_charge = 200, 'the charge is kept with the design options and as extra_charge');
select pg_temp.ok((pg_temp.o()).deposit_due = round((pg_temp.o()).total_amount * (pg_temp.o()).deposit_rate, 2), 'the downpayment is recalculated from the new total');
select pg_temp.ok((pg_temp.o()).status = 'confirmed', 'the order is confirmed so payment opens');
select pg_temp.ok(exists (select 1 from public.chat_messages where order_id = pg_temp.v('order')::uuid and message_type = 'status_update' and body like 'The customer accepted the new price%'),
  'LexC''s is told in chat that the customer accepted');
select pg_temp.as_user('admin'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.propose_order_extra(%L, 50, %L)', pg_temp.v('order'), 'More work')) like 'ERR%before the order is confirmed%', 'no more price changes after confirming');
reset role;

-- ---- a delivery order without its fee: accepting keeps it pending (the fee comes first)
set local session_replication_role = replica;
update public.orders set status = 'pending', amount_paid = 0, payment_status = 'unpaid', price_review = null, fulfillment_method = 'lalamove',
  address = coalesce(nullif(btrim(address), ''), 'Test delivery address, Quezon City'), delivery_fee_status = 'unquoted', delivery_fee = null, total_amount = null, deposit_due = null
  where id = pg_temp.v('order')::uuid;
set local session_replication_role = origin;
select pg_temp.as_user('admin'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.propose_order_extra(%L, 100, %L)', pg_temp.v('order'), 'Custom topper')) = 'ok', 'a price can be added before the delivery fee');
reset role; select pg_temp.as_user('customer'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.respond_order_extra(%L, true)', pg_temp.v('order'))) = 'ok', 'the customer accepts it');
reset role;
select pg_temp.ok((pg_temp.o()).status = 'pending' and (pg_temp.o()).total_amount is null and (pg_temp.o()).price_review->>'status' = 'accepted', 'it stays pending until the delivery fee is set');

do $$ begin
  raise exception E'PHASE 51 TESTS (all changes rolled back): % failed\n%', (select count(*) from r where result like 'FAIL%'),
    (select string_agg(result, E'\n' order by n) from r);
end $$;
