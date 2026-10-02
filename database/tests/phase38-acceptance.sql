-- LOCAL ONLY: acceptance tests for phase38-cake-pops.sql. Run on a DISPOSABLE database built from
-- tests/local-supabase-stub.sql + phases 2-38 (customer ...0c). Everything is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.who(sub text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(sub, ''), false) $$;
create or replace function pg_temp.q(d jsonb) returns jsonb language sql as $$
  select public.quote_cakepop_design((select id from public.products where slug = 'cake-pops'), d) $$;
create or replace function pg_temp.fails(d jsonb) returns text language plpgsql as $$
begin perform pg_temp.q(d); return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- 1. The product -------------------------------------------------------------------------------------
select pg_temp.check((select string_agg(v.label || '=' || v.price::int, ',' order by v.sort_order) from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'cake-pops')
  = '12pcs=220,25pcs=450,40pcs=700,60pcs=1050', 'four boxes at the owner''s prices (25 pcs ₱450)');
select pg_temp.check((select c.slug from public.products p join public.categories c on c.id = p.category_id where p.slug = 'cake-pops') = 'cakepops', 'in its own Cake Pops category');
select pg_temp.check((select status from public.products where slug = 'cake-pops') = 'active', 'on the menu');

set role anon; select pg_temp.who(null);
-- 2. Pricing (₱3 per extra, once per box) -------------------------------------------------------------
select pg_temp.check((pg_temp.q('{"designer":"cakepop","glazes":["pink"]}')->>'extra')::numeric = 0, 'plain round pop, white pearls, wrapped: free');
select pg_temp.check((pg_temp.q('{"designer":"cakepop","style":"donut","glazes":["pink"]}')->>'extra')::numeric = 0, 'donut pops cost the same');
select pg_temp.check((pg_temp.q('{"designer":"cakepop","pattern":"assorted","glazes":["pink","sky_blue","lavender"],"sprinkles":"nonpareils","sprinkle_colors":["hot_pink","purple","azure"]}')->>'extra')::numeric = 6,
  'the pastel sprinkle pops photo = assorted + nonpareils');
select pg_temp.check((pg_temp.q('{"designer":"cakepop","style":"donut","flavors":["chocolate","vanilla"],"pattern":"alternate","glazes":["azure","lemon"],"finishes":["gold_star"],"sprinkles":"gold_pearls","theme":"custom","theme_note":"blue hedgehog and friends"}')->>'extra')::numeric = 15,
  'character donut pops = mix + alternate + star + gold pearls + own theme');
select pg_temp.check(pg_temp.q('{"designer":"cakepop","pattern":"alternate","glazes":["sky_blue","pink"],"sprinkles":"nonpareils","sprinkle_colors":["white"],"theme":"baby","message":"letters","message_text":"Boy Girl"}')->'clean'->>'summary'
  = 'Round cake pops · Chocolate · Sky blue / Pink coating, alternating · Coloured nonpareils (White) · Baby shower toppers · Fondant letters "Boy Girl" (White)', 'readable summary, coating not glaze');
select pg_temp.check(pg_temp.q('{"designer":"cakepop","style":"donut","glazes":["pink"]}')->'clean'->>'style_donut' = 'yes', 'recipe flag for the shape');

-- 3. Rules ------------------------------------------------------------------------------------------------
select pg_temp.check(pg_temp.fails('{"designer":"cakepop","style":"square","glazes":["pink"]}') like '22023%round cake pops or donut pops%', 'only round or donut pops');
select pg_temp.check(pg_temp.fails('{"designer":"cakepop","flavors":["ube"],"glazes":["pink"]}') like '22023%flavor%', 'only chocolate or vanilla');
select pg_temp.check(pg_temp.fails('{"designer":"cakepop","flavors":["chocolate","vanilla","chocolate"],"glazes":["pink"]}') like '22023%', 'no more than two flavours');
select pg_temp.check(pg_temp.fails('{"designer":"cakepop","glazes":["pink"],"theme":"bees"}') like '22023%theme%', 'donut-only themes are not offered here');
select pg_temp.check(pg_temp.fails('{"designer":"cakepop","glazes":["pink"],"theme":"custom"}') like '22023%theme%', 'own theme needs a note');
select pg_temp.check(pg_temp.fails('{"designer":"donut","glazes":["pink"]}') like '22023%', 'a donut design is not a cake pop design');
select pg_temp.check((select (public.quote_donut_design((select id from public.products where slug = 'product-2'), '{"designer":"donut","glazes":["pink"]}')->>'extra')::numeric) = 0, 'donut designer unchanged');

-- 4. Checkout charges extras per box and posts the design card -------------------------------------------
reset role;
insert into public.availability_slots (starts_at, ends_at, capacity, is_open)
  values (date_trunc('day', now()) + interval '404 days 3 hours 17 minutes', date_trunc('day', now()) + interval '404 days 4 hours 17 minutes', 20, true);
create temp table t(k text primary key, v text); grant all on t to authenticated;
insert into t values
  ('slot', (select id::text from public.availability_slots where starts_at = date_trunc('day', now()) + interval '404 days 3 hours 17 minutes')),
  ('box', (select v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'cake-pops' and v.code = 'pcs25'));
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
insert into t values ('order', (select (public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Test Customer', 'phone', '09171234567',
  'fulfillment', 'pickup', 'slot_id', (select v from t where k='slot'), 'payment_method', 'maribank',
  'items', jsonb_build_array(jsonb_build_object('variant_id', (select v from t where k='box'), 'qty', 2,
     'customization', '{"designer":"cakepop","pattern":"assorted","glazes":["pink","sky_blue","lavender"],"sprinkles":"nonpareils","sprinkle_colors":["hot_pink","purple","azure"]}'::jsonb)))))->>'id'));
reset role;
select pg_temp.check((select customization_total from public.orders where id = (select v::uuid from t where k='order')) = 12, 'two 25-pc boxes × ₱6 extras = ₱12');
select pg_temp.check((select unit_price from public.order_items where order_id = (select v::uuid from t where k='order')) = 450, 'charged the 25-pc price ₱450');
select pg_temp.check((select body from public.chat_messages where order_id = (select v::uuid from t where k='order') and message_type = 'design_card') like 'Your cake pop design for Order #%', 'cake pop design card posted in chat');
rollback;
