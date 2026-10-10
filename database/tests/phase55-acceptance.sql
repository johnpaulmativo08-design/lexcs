-- Acceptance tests for phase55-chat-images-inspiration.sql. Safe on the live database: test picture records are
-- added and every change is ROLLED BACK at the end (results arrive as an error message on purpose).
begin;
create temp table r(n serial, result text);
create temp table t(k text primary key, v text);
grant all on r, t to authenticated; grant usage on sequence r_n_seq to authenticated;
create or replace function pg_temp.ok(pass boolean, label text) returns void language sql as $$
  insert into r(result) values ((case when coalesce(pass, false) then 'PASS: ' else 'FAIL: ' end) || label) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return 'ERR ' || sqlerrm; end $$;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t where k = key $$;
create or replace function pg_temp.as_user(who text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.v(who), true),
         set_config('request.jwt.claims', json_build_object('sub', pg_temp.v(who), 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;

-- a customer with an order that has a line, and another customer
insert into t select 'order', o.id::text from public.orders o where o.customer_id is not null and exists (select 1 from public.order_items i where i.order_id = o.id) order by o.created_at desc limit 1;
insert into t select 'customer', customer_id::text from public.orders where id = pg_temp.v('order')::uuid;
insert into t select 'other', p.id::text from public.profiles p where p.id::text <> pg_temp.v('customer') limit 1;
insert into t select 'line', min(line_number)::text from public.order_items where order_id = pg_temp.v('order')::uuid;
set local session_replication_role = replica;
update public.order_items set inspiration_paths = '{}' where order_id = pg_temp.v('order')::uuid;
set local session_replication_role = origin;
-- the customer's general chat (created if needed) and the other customer's chat
insert into public.chat_conversations(customer_id, state) values (pg_temp.v('customer')::uuid, 'active') on conflict do nothing;
insert into t select 'conv', id::text from public.chat_conversations where customer_id = pg_temp.v('customer')::uuid and order_id is null limit 1;
insert into public.chat_conversations(customer_id, state) values (pg_temp.v('other')::uuid, 'active') on conflict do nothing;
insert into t select 'other_conv', id::text from public.chat_conversations where customer_id = pg_temp.v('other')::uuid and order_id is null limit 1;
-- test pictures in storage (rolled back)
insert into t values ('p1', pg_temp.v('customer') || '/chat/test-1.jpg'), ('p2', pg_temp.v('customer') || '/chat/test-2.jpg'),
  ('pi', pg_temp.v('customer') || '/inspiration/test-3.jpg'), ('px', pg_temp.v('other') || '/chat/test-x.jpg');
insert into storage.objects(bucket_id, name) select 'customer-references', v from t where k in ('p1','p2','pi','px');

select pg_temp.as_user('customer'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.send_chat_images(%L, %L::text[], %L)', pg_temp.v('conv'), array[pg_temp.v('p1'), pg_temp.v('p2')], 'Like this but lilac')) = 'ok', 'a customer sends 2 pictures with a message');
select pg_temp.ok(pg_temp.err(format('select public.send_chat_images(%L, %L::text[])', pg_temp.v('conv'), array[pg_temp.v('px')])) like 'ERR%could not be found%', 'someone else''s picture is refused');
select pg_temp.ok(pg_temp.err(format('select public.send_chat_images(%L, %L::text[])', pg_temp.v('conv'), array[pg_temp.v('p1'), pg_temp.v('p1'), pg_temp.v('p1'), pg_temp.v('p1'), pg_temp.v('p1')])) like 'ERR%up to 4%', 'more than 4 pictures are refused');
select pg_temp.ok(pg_temp.err(format('select public.send_chat_images(%L, %L::text[])', pg_temp.v('conv'), '{}')) like 'ERR%at least one%', 'a message needs a picture');
select pg_temp.ok(pg_temp.err(format('select public.send_chat_images(%L, %L::text[])', pg_temp.v('conv'), array[pg_temp.v('customer') || '/chat/missing.jpg'])) like 'ERR%could not be found%', 'a picture that was never uploaded is refused');
select pg_temp.ok(pg_temp.err(format('select public.send_chat_images(%L, %L::text[])', pg_temp.v('other_conv'), array[pg_temp.v('p1')])) like 'ERR%not available%', 'pictures cannot go into someone else''s chat');
select pg_temp.ok(pg_temp.err(format('insert into public.chat_messages(conversation_id, sender_id, sender_type, message_type, body) values (%L, %L, %L, %L, %L)', pg_temp.v('conv'), pg_temp.v('customer'), 'customer', 'image', 'fake')) like 'ERR%', 'a customer cannot post a picture message directly');
reset role;
select pg_temp.ok((select attachments->'images' = to_jsonb(array[pg_temp.v('p1'), pg_temp.v('p2')]) and body = 'Like this but lilac' and sender_type = 'customer'
  from public.chat_messages where conversation_id = pg_temp.v('conv')::uuid and message_type = 'image' order by created_at desc limit 1), 'the message holds both pictures and the text');
select pg_temp.ok((select state from public.chat_conversations where id = pg_temp.v('conv')::uuid) = 'needs_admin', 'the chat is flagged for LexC''s to reply');

-- inspiration photos after checkout
select pg_temp.as_user('other'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.attach_inspiration(%L, %L::jsonb)', pg_temp.v('order'), jsonb_build_array(jsonb_build_object('line', pg_temp.v('line')::int, 'paths', jsonb_build_array(pg_temp.v('px')))))) like 'ERR%not available%', 'only the order''s customer can add inspiration');
reset role; select pg_temp.as_user('customer'); set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.attach_inspiration(%L, %L::jsonb)', pg_temp.v('order'), jsonb_build_array(jsonb_build_object('line', pg_temp.v('line')::int, 'paths', jsonb_build_array(pg_temp.v('p1'),pg_temp.v('p2'),pg_temp.v('pi'),pg_temp.v('p1')))))) like 'ERR%up to 3%', 'more than 3 inspiration photos are refused');
select pg_temp.ok(pg_temp.err(format('select public.attach_inspiration(%L, %L::jsonb)', pg_temp.v('order'), jsonb_build_array(jsonb_build_object('line', pg_temp.v('line')::int, 'paths', jsonb_build_array(pg_temp.v('pi')))))) = 'ok', 'the customer adds an inspiration photo to an order line');
select pg_temp.ok((select public.attach_inspiration(pg_temp.v('order')::uuid, jsonb_build_array(jsonb_build_object('line', pg_temp.v('line')::int, 'paths', jsonb_build_array(pg_temp.v('pi')))))) = 0, 'adding it again does nothing (retries are safe)');
reset role;
select pg_temp.ok((select inspiration_paths from public.order_items where order_id = pg_temp.v('order')::uuid and line_number = pg_temp.v('line')::int) = array[pg_temp.v('pi')], 'the order line keeps the photo');
select pg_temp.ok((select count(*) from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id
  where m.order_id = pg_temp.v('order')::uuid and c.order_id = m.order_id and m.message_type = 'image' and m.body like 'Inspiration for %') = 1, 'the photo is posted once in the order''s own chat');

do $$ begin
  raise exception E'PHASE 55 TESTS (all changes rolled back): % failed\n%', (select count(*) from r where result like 'FAIL%'),
    (select string_agg(result, E'\n' order by n) from r);
end $$;
