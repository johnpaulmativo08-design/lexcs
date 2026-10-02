-- LOCAL ONLY: acceptance tests for phase37-donut-designer.sql. Run on a DISPOSABLE database built from
-- tests/local-supabase-stub.sql + phases 2-37 (customer ...0c). Everything is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.who(sub text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(sub, ''), false) $$;
create or replace function pg_temp.q(slug text, d jsonb) returns jsonb language sql as $$
  select public.quote_donut_design((select id from public.products where products.slug = q.slug), d) $$;
create or replace function pg_temp.fails(slug text, d jsonb) returns text language plpgsql as $$
begin perform pg_temp.q(slug, d); return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
set role anon; select pg_temp.who(null);

-- 1. Pricing (₱3 per extra, once per box) -----------------------------------------------------------
select pg_temp.check((pg_temp.q('product-2', '{"designer":"donut","glazes":["pink"]}')->>'extra')::numeric = 0,
  'one flavour, one glaze, white pearls is free');
select pg_temp.check((pg_temp.q('product-2', '{"designer":"donut","pattern":"alternate","glazes":["hot_pink","purple"],"sprinkles":"white_pearls"}')->>'extra')::numeric = 3,
  'pink / purple alternating box (the party box photo) = ₱3');
-- bees box: honey drip + white drizzle + theme + letters = 12
select pg_temp.check((pg_temp.q('product-3', '{"designer":"donut","pattern":"alternate","glazes":["lemon","ivory"],"finishes":["honey_drip","white_drizzle"],"sprinkles":"none","theme":"bees","message":"letters","message_text":"happy birthday","message_color":"butter"}')->>'extra')::numeric = 15,
  'bees box = alternate + honey drip + white drizzle + toppers + letters');
select pg_temp.check((pg_temp.q('product-2', '{"designer":"donut","flavors":["vanilla","ube","chocolate"],"glazes":["pink"]}')->>'extra')::numeric = 3,
  'mixing flavours is one ₱3 extra');
select pg_temp.check(pg_temp.q('product-3', '{"designer":"donut","flavors":["ube"],"glazes":["azure"],"sprinkles":"nonpareils","sprinkle_colors":["white","sky_blue"],"message":"letters","message_text":"A BABY BOY ON THE WAY","theme":"baby"}')->'clean'->>'summary'
  = 'Ube · Azure glaze · Coloured nonpareils (White, Sky blue) · Baby shower toppers · Fondant letters "A BABY BOY ON THE WAY" (White)', 'readable summary');
select pg_temp.check(pg_temp.q('product-2', '{"designer":"donut","flavors":["vanilla","strawberry"],"glazes":["pink"]}')->'clean'->>'flavor_strawberry' = 'yes', 'recipe flag per flavour');

-- 2. Rules ----------------------------------------------------------------------------------------------
select pg_temp.check(pg_temp.fails('product-2', '{"designer":"donut","glazes":["pink","purple"]}') like '22023%1 glaze color%', 'one glaze means one colour');
select pg_temp.check(pg_temp.fails('product-2', '{"designer":"donut","pattern":"alternate","glazes":["pink"]}') like '22023%2 glaze colors%', 'alternate needs two');
select pg_temp.check(pg_temp.fails('product-2', '{"designer":"donut","flavors":["mix"],"glazes":["pink"]}') like '22023%flavor%', '"mix" is not a flavour');
select pg_temp.check(pg_temp.fails('product-2', '{"designer":"donut","flavors":["matcha"],"glazes":["pink"]}') like '22023%flavor%', 'unknown flavour rejected');
select pg_temp.check(pg_temp.fails('product-2', '{"designer":"donut","glazes":["pink"],"finishes":["choco_drizzle","white_drizzle"]}') like '22023%one drizzle%', 'one drizzle only');
select pg_temp.check(pg_temp.fails('product-2', '{"designer":"donut","glazes":["pink"],"sprinkles":"nonpareils"}') like '22023%sprinkle color%', 'nonpareils need a colour');
select pg_temp.check(pg_temp.fails('product-2', '{"designer":"donut","glazes":["pink"],"sprinkle_colors":["pink"]}') like '22023%only for%', 'sprinkle colours only with nonpareils');
select pg_temp.check(pg_temp.fails('product-2', '{"designer":"donut","glazes":["pink"],"theme":"custom"}') like '22023%theme%', 'own theme needs a note');
select pg_temp.check(pg_temp.fails('product-2', '{"designer":"donut","glazes":["pink"],"message":"letters"}') like '22023%message%', 'letters need text');
select pg_temp.check(pg_temp.fails('product-2', '{"designer":"donut","glazes":["pink"],"message":"letters","message_text":"<b>hi</b>"}') like '22023%Letters%', 'unsafe letters rejected');
select pg_temp.check(pg_temp.fails('product-2', '{"designer":"donut","glazes":["pink"],"message":"plaque","message_text":"A very long plaque name"}') like '22023%Plaque%', 'plaque up to 14 characters');
select pg_temp.check(pg_temp.q('product-2', '{"designer":"donut","glazes":["pink"],"message":"none","message_text":"ignored"}')->'clean'->>'message_text' is null, 'no message drops the text');
select pg_temp.check((pg_temp.q('product-2', ('{"designer":"donut","pattern":"assorted","glazes":' ||
  (select jsonb_agg(code order by sort_order) from (select code, sort_order from public.design_options where group_key='color' and product_id=(select id from public.products where slug='product-2') order by sort_order limit 16) x)::text || '}')::jsonb)->>'extra')::numeric = 3,
  'assorted box may use 16 glazes');
select pg_temp.check(pg_temp.fails('product-5', '{"designer":"donut","glazes":["pink"]}') like '22023%cannot be designed%', 'cupcakes cannot use the donut designer');

-- 3. Checkout charges extras per box and posts the design card ------------------------------------------
reset role;
insert into public.availability_slots (starts_at, ends_at, capacity, is_open)
  values (date_trunc('day', now()) + interval '403 days 3 hours 17 minutes', date_trunc('day', now()) + interval '403 days 4 hours 17 minutes', 20, true);
create temp table t(k text primary key, v text); grant all on t to authenticated;
insert into t values
  ('slot', (select id::text from public.availability_slots where starts_at = date_trunc('day', now()) + interval '403 days 3 hours 17 minutes')),
  ('box', (select v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'product-2' and v.is_active order by v.sort_order limit 1));
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
insert into t values ('order', (select (public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Test Customer', 'phone', '09171234567',
  'fulfillment', 'pickup', 'slot_id', (select v from t where k='slot'), 'payment_method', 'maribank',
  'items', jsonb_build_array(jsonb_build_object('variant_id', (select v from t where k='box'), 'qty', 2,
     'customization', '{"designer":"donut","pattern":"alternate","glazes":["hot_pink","purple"],"theme":"butterfly"}'::jsonb)))))->>'id'));
reset role;
select pg_temp.check((select customization_total from public.orders where id = (select v::uuid from t where k='order')) = 12, 'two boxes × (₱3 alternate + ₱3 toppers) = ₱12');
select pg_temp.check((select customization->>'summary' from public.order_items where order_id = (select v::uuid from t where k='order'))
  = 'Classic vanilla · Hot pink / Purple glaze, alternating · White sugar pearls · Butterflies & daisies toppers', 'stored design summary');
select pg_temp.check((select body from public.chat_messages where order_id = (select v::uuid from t where k='order') and message_type = 'design_card') like 'Your donut design for Order #%', 'donut design card posted in chat');
rollback;
