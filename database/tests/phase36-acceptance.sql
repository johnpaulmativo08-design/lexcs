-- LOCAL ONLY: acceptance tests for phase36-cupcake-designer.sql. Run on a DISPOSABLE database built from
-- tests/local-supabase-stub.sql + phases 2-36 (customer ...0c). Everything is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.who(sub text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(sub, ''), false) $$;
create or replace function pg_temp.q(slug text, d jsonb) returns jsonb language sql as $$
  select public.quote_cupcake_design((select id from public.products where products.slug = q.slug), d) $$;
create or replace function pg_temp.fails(slug text, d jsonb) returns text language plpgsql as $$
begin perform pg_temp.q(slug, d); return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
set role anon; select pg_temp.who(null);

-- 1. Pricing (₱3 per extra, once per box) -----------------------------------------------------------
select pg_temp.check((pg_temp.q('product-5', '{"designer":"cupcake","a":{"style":"rosette","colors":["azure"]}}')->>'extra')::numeric = 0,
  'plain rosette with gold pearls is free');
select pg_temp.check((pg_temp.q('product-5', '{"designer":"cupcake","flavor":"vanilla","a":{"style":"two_tone","colors":["azure","white"]},"finishes":["gold_pearls"]}')->>'extra')::numeric = 3,
  'two-tone swirl = ₱3; minis can be vanilla');
-- alternate (3) + rosette A (0) + rosette B (0) = 3, the photo's pink/white checkerboard
select pg_temp.check((pg_temp.q('product-5', '{"designer":"cupcake","pattern":"alternate","a":{"style":"rosette","colors":["hot_pink"]},"b":{"style":"rosette","colors":["white"]}}')->>'extra')::numeric = 3,
  'pink / white alternating box = ₱3');
-- mermaid: rainbow (3) + white pearls (3) + theme (3) = 9
select pg_temp.check((pg_temp.q('product-6', '{"designer":"cupcake","a":{"style":"rainbow","colors":["pink","aqua","lavender"]},"finishes":["gold_pearls","white_pearls"],"theme":"mermaid"}')->>'extra')::numeric = 9,
  'mermaid box = rainbow + white pearls + toppers');
select pg_temp.check(pg_temp.q('product-6', '{"designer":"cupcake","a":{"style":"luxe","colors":["blush","deep_rose"]},"finishes":["gold_pearls","gold_balls"]}')->'clean'->>'summary'
  = 'Chocolate · Luxe rose & blooms (Blush + Deep rose) · Gold pearls, Big gold balls', 'readable summary');
select pg_temp.check(pg_temp.q('product-6', '{"designer":"cupcake","a":{"style":"floral","colors":["pink","lime","lilac","azure"]},"finishes":["leaves"],"theme":"none"}')->'clean'->>'style_floral' = 'yes',
  'recipe flag for the style');

-- 2. Rules ----------------------------------------------------------------------------------------------
select pg_temp.check(pg_temp.fails('product-5', '{"designer":"cupcake","a":{"style":"luxe","colors":["blush","deep_rose"]}}') like '22023%piping style%', 'luxe is regular size only');
select pg_temp.check(pg_temp.fails('product-5', '{"designer":"cupcake","a":{"style":"two_tone","colors":["azure"]}}') like '22023%2 colors%', 'two-tone needs 2 colors');
select pg_temp.check(pg_temp.fails('product-5', '{"designer":"cupcake","a":{"style":"rainbow","colors":["pink","aqua"]}}') like '22023%3–5 colors%', 'rainbow needs 3–5 colors');
select pg_temp.check(pg_temp.fails('product-5', '{"designer":"cupcake","a":{"style":"rosette","colors":["neon"]}}') like '22023%color%', 'unknown color rejected');
select pg_temp.check(pg_temp.fails('product-5', '{"designer":"cupcake","a":{"style":"rosette","colors":["pink","pink"]}}') like '22023%once%', 'repeated color rejected');
select pg_temp.check(pg_temp.fails('product-5', '{"designer":"cupcake","pattern":"alternate","a":{"style":"rosette","colors":["pink"]},"b":{"style":"rosette","colors":["pink"]}}') like '22023%different%', 'B must differ from A');
select pg_temp.check(pg_temp.fails('product-5', '{"designer":"cupcake","pattern":"alternate","a":{"style":"rosette","colors":["pink"]}}') like '22023%', 'alternate needs design B');
select pg_temp.check((pg_temp.q('product-5', ('{"designer":"cupcake","pattern":"assorted","a":{"style":"rosette","colors":' ||
  (select jsonb_agg(code order by sort_order) from (select code, sort_order from public.design_options where group_key='color' and product_id=(select id from public.products where slug='product-5') order by sort_order limit 16) x)::text || '}}')::jsonb)->>'extra')::numeric = 3,
  'assorted box may use 16 colors');
select pg_temp.check(pg_temp.fails('product-5', ('{"designer":"cupcake","pattern":"assorted","a":{"style":"rosette","colors":' ||
  (select jsonb_agg(code order by sort_order) from (select code, sort_order from public.design_options where group_key='color' and product_id=(select id from public.products where slug='product-5') order by sort_order limit 17) x)::text || '}}')::jsonb) like '22023%', '17 colors rejected');
select pg_temp.check(pg_temp.fails('product-5', '{"designer":"cupcake","a":{"style":"rosette","colors":["pink"]},"finishes":["gold_pearls","silver_pearls"]}') like '22023%gold or silver%', 'gold and silver pearls together rejected');
select pg_temp.check(pg_temp.fails('product-5', '{"designer":"cupcake","a":{"style":"rosette","colors":["pink"]},"theme":"custom"}') like '22023%theme%', 'own theme needs a note');
select pg_temp.check(pg_temp.q('product-5', '{"designer":"cupcake","a":{"style":"rosette","colors":["azure"]},"theme":"custom","theme_note":"  Sonic  and  friends "}')->'clean'->>'theme_note' = 'Sonic and friends', 'theme note tidied');
select pg_temp.check(pg_temp.fails('product-5', '{"designer":"cupcake","a":{"style":"rosette","colors":["pink"]},"theme":"custom","theme_note":"<script>"}') like '22023%', 'unsafe theme note rejected');
select pg_temp.check(pg_temp.fails('product-20', '{"designer":"cupcake","a":{"style":"rosette","colors":["pink"]}}') like '22023%cannot be designed%', 'non-cupcake product cannot use the cupcake designer');

-- 3. Checkout charges extras per box and posts the design card ------------------------------------------
reset role;
insert into public.availability_slots (starts_at, ends_at, capacity, is_open)
  values (date_trunc('day', now()) + interval '402 days 3 hours 17 minutes', date_trunc('day', now()) + interval '402 days 4 hours 17 minutes', 20, true);
create temp table t(k text primary key, v text); grant all on t to authenticated;
insert into t values
  ('slot', (select id::text from public.availability_slots where starts_at = date_trunc('day', now()) + interval '402 days 3 hours 17 minutes')),
  ('mini12', (select v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'product-5' and v.is_active order by v.sort_order limit 1));
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
insert into t values ('order', (select (public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Test Customer', 'phone', '09171234567',
  'fulfillment', 'pickup', 'slot_id', (select v from t where k='slot'), 'payment_method', 'maribank',
  'items', jsonb_build_array(jsonb_build_object('variant_id', (select v from t where k='mini12'), 'qty', 2,
     'customization', '{"designer":"cupcake","pattern":"alternate","a":{"style":"rosette","colors":["black"]},"b":{"style":"rosette","colors":["baby_pink"]},"finishes":["gold_pearls"]}'::jsonb)))))->>'id'));
reset role;
select pg_temp.check((select customization_total from public.orders where id = (select v::uuid from t where k='order')) = 6, 'two boxes × ₱3 alternate = ₱6');
select pg_temp.check((select customization->>'summary' from public.order_items where order_id = (select v::uuid from t where k='order'))
  = 'Chocolate · Alternating Classic rosette (Black) / Classic rosette (Baby pink) · Gold pearls', 'stored design summary');
select pg_temp.check((select body from public.chat_messages where order_id = (select v::uuid from t where k='order') and message_type = 'design_card') like 'Your cupcake design for Order #%', 'cupcake design card posted in chat');
select pg_temp.check((select position('private.product_design' in prosrc) > 0 from pg_proc where oid = 'private.checkout(jsonb)'::regprocedure), 'checkout uses the shared design entry point');
rollback;
