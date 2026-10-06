-- Acceptance test for phase47-order-summary-chat.sql. Safe on the live database: copies one recent order (with a
-- fake order number, so no real order number is used up), lets the summary trigger run, checks the chat message,
-- then ROLLS EVERYTHING BACK. The results arrive as an error message on purpose: the error undoes the transaction.
begin;
create temp table r(n serial, result text);
create or replace function pg_temp.ok(pass boolean, label text) returns void language sql as $$
  insert into r(result) values ((case when coalesce(pass, false) then 'PASS: ' else 'FAIL: ' end) || label) $$;

-- the trigger must also run while the copy is inserted with the other triggers switched off
alter table public.orders enable always trigger chat_order_summary;
set local session_replication_role = replica;
do $$
declare src uuid; new_id uuid := gen_random_uuid(); cols text;
begin
  select o.id into src from public.orders o where exists (select 1 from public.order_items i where i.order_id = o.id)
    and o.status <> 'cancelled' order by o.created_at desc limit 1;
  create temp table src_order as select * from public.orders where id = src;
  update src_order set id = new_id, order_number = 999999047, client_request_id = gen_random_uuid(), created_at = now(), status = 'pending';
  select string_agg(quote_ident(attname), ',' order by attnum) into cols from pg_attribute
    where attrelid = 'public.orders'::regclass and attnum > 0 and not attisdropped and attgenerated = '';
  execute format('insert into public.orders(%s) overriding system value select %s from src_order', cols, cols);
  create temp table src_items as select * from public.order_items where order_id = src;
  update src_items set order_id = new_id;
  select string_agg(quote_ident(attname), ',' order by attnum) into cols from pg_attribute
    where attrelid = 'public.order_items'::regclass and attnum > 0 and not attisdropped and attgenerated = '' and attname <> 'id';
  execute format('insert into public.order_items(%s) overriding system value select %s from src_items', cols, cols);
end $$;
set local session_replication_role = origin;
set constraints all immediate;   -- run the deferred summary now instead of at commit

select pg_temp.ok((select count(*) from public.chat_messages where order_id = (select id from src_order) and message_type = 'order_summary') = 1,
  'one order summary is posted');
select pg_temp.ok((select c.order_id = (select id from src_order) and c.customer_id = (select customer_id from src_order)
    from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id
    where m.order_id = (select id from src_order) and m.message_type = 'order_summary'),
  'it is in that order''s own chat, for that customer');
select pg_temp.ok((select jsonb_array_length(attachments->'items') from public.chat_messages
    where order_id = (select id from src_order) and message_type = 'order_summary') = (select count(*) from src_items),
  'it lists every order line');
select pg_temp.ok((select (attachments->>'order_number')::bigint = 999999047 and attachments ? 'receiving_start' and attachments ? 'total'
    from public.chat_messages where order_id = (select id from src_order) and message_type = 'order_summary'),
  'it carries the order number, schedule and total');
select pg_temp.ok((select body like 'Order #999999047 received.%' from public.chat_messages
    where order_id = (select id from src_order) and message_type = 'order_summary'), 'the message text names the order');

do $$ begin
  raise exception E'PHASE 47 TESTS (all changes rolled back): % failed\n%', (select count(*) from r where result like 'FAIL%'),
    (select string_agg(result, E'\n' order by n) from r);
end $$;
