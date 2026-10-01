-- LOCAL ONLY: acceptance tests for phase33-design-card-chat.sql. Run on a DISPOSABLE database built from
-- tests/local-supabase-stub.sql + phases 2-33 (Admin ...0a, customer ...0c). Everything is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.who(sub text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(sub, ''), false) $$;
create or replace function pg_temp.fails(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

create temp table t(k text primary key, v text); grant all on t to anon, authenticated;
insert into t values
  ('choco', (select v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'product-8' and v.label = 'Chocolate')),
  ('plain', (select v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'product-8' and v.label = 'Minimalist')),
  ('other', (select v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'product-6' limit 1));
insert into public.availability_slots (starts_at, ends_at, capacity, is_open)
  values (date_trunc('day', now()) + interval '401 days 3 hours 17 minutes', date_trunc('day', now()) + interval '401 days 4 hours 17 minutes', 20, true);
insert into t values ('slot', (select id::text from public.availability_slots where starts_at = date_trunc('day', now()) + interval '401 days 3 hours 17 minutes'));
-- Pictures the customer's browser uploaded (own folder), plus one in someone else's folder.
insert into storage.objects(bucket_id, name, metadata) values
  ('customer-references', '00000000-0000-0000-0000-00000000000c/designs/angle-1.jpg', '{}'),
  ('customer-references', '00000000-0000-0000-0000-00000000000c/designs/top-1.jpg', '{}'),
  ('customer-references', '00000000-0000-0000-0000-00000000000c/designs/top-2.jpg', '{}'),
  ('customer-references', '00000000-0000-0000-0000-00000000000a/designs/top-x.jpg', '{}');

set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
insert into t values ('order', (select (public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Test Customer', 'phone', '09171234567',
  'fulfillment', 'pickup', 'slot_id', (select v from t where k='slot'), 'payment_method', 'maribank',
  'items', jsonb_build_array(
     jsonb_build_object('variant_id', (select v from t where k='choco'), 'qty', 2, 'reference_image_path', '00000000-0000-0000-0000-00000000000c/designs/angle-1.jpg',
       'customization', '{"designer":"bento","frosting_color":"pink","accents":["pearls_gold"],"message":"Hi Mika","lettering":"piped","lettering_color":"white"}'::jsonb),
     jsonb_build_object('variant_id', (select v from t where k='other'), 'qty', 1),
     jsonb_build_object('variant_id', (select v from t where k='plain'), 'qty', 1, 'customization', '{"designer":"bento","frosting_color":"lavender"}'::jsonb)))))->>'id'));
create temp table card as select * from public.chat_messages where order_id = (select v::uuid from t where k='order') and message_type = 'design_card';
grant all on card to authenticated;
reset role;

-- 1. The card is posted automatically -------------------------------------------------------------
select pg_temp.check((select count(*) from card) = 1, 'one design card per order');
select pg_temp.check((select sender_type from card) = 'system', 'card is sent by the system');
select pg_temp.check((select c.order_id is null and c.customer_id = '00000000-0000-0000-0000-00000000000c' from card m join public.chat_conversations c on c.id = m.conversation_id), 'card goes to the customer''s general chat');
select pg_temp.check((select jsonb_array_length(attachments) from card) = 2, 'both bento lines listed, the other product is not');
select pg_temp.check((select attachments->0->>'angle_path' from card) = '00000000-0000-0000-0000-00000000000c/designs/angle-1.jpg', 'angled picture attached');
select pg_temp.check((select attachments->0->'design'->>'frosting_color' from card) = 'pink' and (select attachments->1->>'line' from card) = '3', 'design choices and line numbers kept');
select pg_temp.check((select body from card) like 'Your bento design for Order #%', 'readable message text');
-- Chocolate base + gold pearls ₱3 + message ₱3 (piped letters free)
select pg_temp.check((select (attachments->0->>'unit_price')::numeric - v.price from card, public.product_variants v where v.id = (select v::uuid from t where k='choco')) = 6, 'card price includes the extras');

-- 2. Top views: only the owner, only their own pictures -------------------------------------------
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
select pg_temp.check(public.attach_design_views((select v::uuid from t where k='order'),
  '[{"line":1,"top_path":"00000000-0000-0000-0000-00000000000c/designs/top-1.jpg"},{"line":3,"top_path":"00000000-0000-0000-0000-00000000000c/designs/top-2.jpg"}]') = 2, 'owner attaches top views');
select pg_temp.check(pg_temp.fails($$select public.attach_design_views((select v::uuid from t where k='order'), '[{"line":1,"top_path":"00000000-0000-0000-0000-00000000000a/designs/top-x.jpg"}]')$$) like '22023%', 'someone else''s picture rejected');
select pg_temp.check(pg_temp.fails($$select public.attach_design_views((select v::uuid from t where k='order'), '[{"line":1,"top_path":"00000000-0000-0000-0000-00000000000c/designs/missing.jpg"}]')$$) like '22023%', 'picture that was never uploaded rejected');
select pg_temp.check(pg_temp.fails($$update public.chat_messages set body = 'changed' where message_type = 'design_card'$$) is not null
  or (select body from public.chat_messages where order_id = (select v::uuid from t where k='order') and message_type='design_card') like 'Your bento design%', 'customer cannot edit the card');
select pg_temp.check(pg_temp.fails($$insert into public.chat_messages(conversation_id, sender_id, sender_type, message_type, body) values ((select conversation_id from card), '00000000-0000-0000-0000-00000000000c', 'customer', 'design_card', 'fake')$$) is not null, 'customer cannot post a fake card');
select pg_temp.check((select count(*) from public.chat_messages where message_type = 'design_card') >= 1, 'customer can read their card');
select pg_temp.who('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(pg_temp.fails($$select public.attach_design_views((select v::uuid from t where k='order'), '[]')$$) like '42501%', 'another account cannot touch the order');
select pg_temp.check((select count(*) from public.chat_messages where order_id = (select v::uuid from t where k='order')) = 1, 'Admin can read the card');
reset role;
select pg_temp.check((select attachments->0->>'top_path' = '00000000-0000-0000-0000-00000000000c/designs/top-1.jpg' and attachments->1->>'top_path' = '00000000-0000-0000-0000-00000000000c/designs/top-2.jpg'
  from public.chat_messages where id = (select id from card)), 'top views stored on the right lines');
select pg_temp.check((select attachments->0->>'angle_path' from public.chat_messages where id = (select id from card)) is not null, 'angled picture kept after attaching');

-- 3. Orders without a bento design post nothing -----------------------------------------------------
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
insert into t values ('plain_order', (select (public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Test Customer', 'phone', '09171234567',
  'fulfillment', 'pickup', 'slot_id', (select v from t where k='slot'), 'payment_method', 'maribank',
  'items', jsonb_build_array(jsonb_build_object('variant_id', (select v from t where k='other'), 'qty', 1)))))->>'id'));
reset role;
select pg_temp.check((select count(*) from public.chat_messages where order_id = (select v::uuid from t where k='plain_order')) = 0, 'no card for orders without a design');

rollback;
