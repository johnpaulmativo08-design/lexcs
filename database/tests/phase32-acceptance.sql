-- LOCAL ONLY: acceptance tests for phase32-bento-designer.sql. Run on a DISPOSABLE database built from
-- tests/local-supabase-stub.sql + phases 2-32 (Admin ...0a, customer ...0c). Everything is rolled back.
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
  ('bento', (select id::text from public.products where slug = 'product-8')),
  ('plain', (select v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'product-8' and v.label = 'Minimalist')),
  ('choco', (select v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'product-8' and v.label = 'Chocolate')),
  ('other', (select v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'product-20' limit 1));
insert into public.availability_slots (starts_at, ends_at, capacity, is_open)
  values (date_trunc('day', now()) + interval '400 days 3 hours 17 minutes', date_trunc('day', now()) + interval '400 days 4 hours 17 minutes', 20, true);
insert into t values ('slot', (select id::text from public.availability_slots where starts_at = date_trunc('day', now()) + interval '400 days 3 hours 17 minutes'));

create temp table designs(k text primary key, d jsonb); grant all on designs to anon, authenticated;
insert into designs values
  ('full', '{"designer":"bento","frosting_color":"pink","border":["shell_top"],"accents":["pearls_gold","ribbon_bows"],"bow_color":"hot_pink",
            "message":"Happy Birthday\nMika","lettering":"pearl_letters","lettering_color":"white","topper":"number","topper_text":"22"}'),
  ('simple', '{"designer":"bento","frosting_color":"lavender"}');

-- 1. Quotes (anyone can price a design; nothing is stored) ----------------------------------------
set role anon; select pg_temp.who(null);
select pg_temp.check((select (public.quote_bento_design((select v::uuid from t where k='bento'), (select d from designs where k='simple'))->>'extra')::numeric) = 0, 'plain colour design is free');
-- full: shell_top 3 + pearls 3 + bows 3 + message 3 + pearl letters 3 + number topper 3 = 18
select pg_temp.check((select (public.quote_bento_design((select v::uuid from t where k='bento'), (select d from designs where k='full'))->>'extra')::numeric) = 18, 'full design extras = ₱18');
select pg_temp.check((select public.quote_bento_design((select v::uuid from t where k='bento'), (select d from designs where k='full'))->'clean'->>'summary') like 'Pink frosting%“Happy Birthday / Mika”%Number topper 22', 'readable summary');
select pg_temp.check((select public.quote_bento_design((select v::uuid from t where k='bento'), (select d from designs where k='full'))->'clean'->>'accent_pearls_gold') = 'yes', 'recipe flag for pearls');
select pg_temp.check(pg_temp.fails($$select public.quote_bento_design((select v::uuid from t where k='bento'), '{"designer":"bento","frosting_color":"neon"}')$$) like '22023%color%', 'unknown colour rejected');
select pg_temp.check(pg_temp.fails($$select public.quote_bento_design((select v::uuid from t where k='bento'), jsonb_build_object('designer','bento','frosting_color','white','message', repeat('a',43),'lettering_color','black'))$$) like '22023%42 characters%', '43-character message rejected');
select pg_temp.check((select (public.quote_bento_design((select v::uuid from t where k='bento'), jsonb_build_object('designer','bento','frosting_color','white','message', repeat('a',42),'lettering_color','black'))->>'extra')::numeric) = 3, '42-character message accepted (₱3)');
select pg_temp.check(pg_temp.fails($$select public.quote_bento_design((select v::uuid from t where k='bento'), '{"designer":"bento","frosting_color":"white","message":"a\nb\nc\nd","lettering_color":"black"}')$$) like '22023%lines%', '4 lines rejected');
select pg_temp.check(pg_temp.fails($$select public.quote_bento_design((select v::uuid from t where k='bento'), '{"designer":"bento","frosting_color":"white","message":"Hi"}')$$) like '22023%lettering color%', 'message needs a lettering colour');
select pg_temp.check(pg_temp.fails($$select public.quote_bento_design((select v::uuid from t where k='bento'), '{"designer":"bento","frosting_color":"white","accents":["ribbon_bows"]}')$$) like '22023%ribbon%', 'bows need a colour');
select pg_temp.check(pg_temp.fails($$select public.quote_bento_design((select v::uuid from t where k='bento'), '{"designer":"bento","frosting_color":"white","accents":["pearls_gold","pearls_silver"]}')$$) like '22023%gold or silver%', 'gold and silver pearls together rejected');
select pg_temp.check(pg_temp.fails($$select public.quote_bento_design((select v::uuid from t where k='bento'), '{"designer":"bento","frosting_color":"white","accents":["sprinkles","sprinkles"]}')$$) like '22023%', 'repeated decoration rejected');
select pg_temp.check(pg_temp.fails($$select public.quote_bento_design((select v::uuid from t where k='bento'), '{"designer":"bento","frosting_color":"white","accents":["pearls_gold","ribbon_bows","piped_flowers","piped_leaves","sprinkles","gold_leaf","drip"],"bow_color":"red"}')$$) like '22023%Too many%', 'more than 6 decorations rejected');
select pg_temp.check(pg_temp.fails($$select public.quote_bento_design((select v::uuid from t where k='bento'), '{"designer":"bento","frosting_color":"white","topper":"number","topper_text":"abc"}')$$) like '22023%digits%', 'number topper needs digits');
select pg_temp.check(pg_temp.fails($$select public.quote_bento_design((select v::uuid from t where k='bento'), '{"designer":"bento","frosting_color":"white","accents":["unicorn"]}')$$) like '22023%', 'imaginary decoration rejected');
select pg_temp.check(pg_temp.fails($$select public.quote_bento_design((select id from public.products where slug='product-6'), '{"designer":"bento","frosting_color":"white"}')$$) like '22023%', 'non-bento product cannot be designed');
select pg_temp.check((select count(*) from public.design_options where group_key <> 'font' and product_id = (select v::uuid from t where k='bento')) = 41, 'customers can read the 41 bento options (fonts: phase 35, cupcakes: phase 36)');
select pg_temp.check(pg_temp.fails($$update public.design_options set price = 0$$) is not null or (select sum(price) from public.design_options) > 0, 'customers cannot change prices');
reset role;

-- 2. Checkout prices extras on the server ---------------------------------------------------------
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
insert into t values ('order', (select (public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Test Customer', 'phone', '09171234567',
  'fulfillment', 'pickup', 'slot_id', (select v from t where k='slot'), 'payment_method', 'maribank',
  'items', jsonb_build_array(
     jsonb_build_object('variant_id', (select v from t where k='choco'), 'qty', 2, 'customization', (select d from designs where k='full')),
     jsonb_build_object('variant_id', (select v from t where k='plain'), 'qty', 1),
     jsonb_build_object('variant_id', (select v from t where k='other'), 'qty', 1)))))->>'id'));
reset role;
select pg_temp.check((select customization_total from public.orders where id = (select v::uuid from t where k='order')) = 36, 'customization_total = 2 cakes × ₱18');
select pg_temp.check((select total_amount = items_subtotal + customization_total and items_subtotal = 2*250 + 220 + (select price from public.product_variants where id = (select v::uuid from t where k='other'))
  from public.orders where id = (select v::uuid from t where k='order')), 'total = items + extras');
select pg_temp.check((select unit_price from public.order_items where order_id = (select v::uuid from t where k='order') and line_number = 1) = 250, 'unit price stays the catalog price');
select pg_temp.check((select customization->>'lettering' = 'pearl_letters' and customization->>'message' = E'Happy Birthday\nMika' and (customization->>'extras_per_item')::numeric = 18
  from public.order_items where order_id = (select v::uuid from t where k='order') and line_number = 1), 'design stored with message and extras');
select pg_temp.check((select coalesce(customization, 'null'::jsonb) = 'null'::jsonb from public.order_items where order_id = (select v::uuid from t where k='order') and line_number = 2), 'plain bento needs no design');
select pg_temp.check((select customization_summary like 'Bento Cake – Chocolate Moist: Pink frosting%' from public.booking_entries where order_id = (select v::uuid from t where k='order')), 'booking shows readable summary');

-- 3. Tampering is rejected -------------------------------------------------------------------------
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
select pg_temp.check(pg_temp.fails($$select public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Test Customer', 'phone', '09171234567', 'fulfillment', 'pickup',
  'slot_id', (select v from t where k='slot'), 'payment_method', 'maribank', 'items', jsonb_build_array(jsonb_build_object('variant_id', (select v from t where k='other'), 'qty', 1,
  'customization', (select d from designs where k='simple')))))$$) like '%not available for this product%', 'design on a non-designable product rejected');
select pg_temp.check(pg_temp.fails($$select public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Test Customer', 'phone', '09171234567', 'fulfillment', 'pickup',
  'slot_id', (select v from t where k='slot'), 'payment_method', 'maribank', 'items', jsonb_build_array(jsonb_build_object('variant_id', (select v from t where k='plain'), 'qty', 1,
  'customization', '{"designer":"bento","frosting_color":"white","extras_per_item":0,"accents":["gold_leaf"],"price":1}'::jsonb))))->'items'->0->'customization'->>'extras_per_item'$$) is null, 'client-sent price fields ignored (server recomputes)');
reset role;
select pg_temp.check(exists (select 1 from public.order_items where customization->'accents' = '["gold_leaf"]'::jsonb and customization->>'frosting_color' = 'white' and (customization->>'extras_per_item')::numeric = 3), 'gold leaf charged ₱3 despite tampered payload');
rollback;
