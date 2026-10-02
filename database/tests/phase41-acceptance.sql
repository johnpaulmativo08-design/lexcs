-- LOCAL ONLY: acceptance tests for phase41-price-every-option.sql. Run on a DISPOSABLE database built from
-- tests/local-supabase-stub.sql + phases 2-41. Everything is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.pid(slug text) returns uuid language sql as $$ select id from public.products where products.slug = $1 $$;
create or replace function pg_temp.setp(slug text, grp text, code text, price numeric) returns void language sql as $$
  update public.design_options set price = $4 where product_id = pg_temp.pid($1) and group_key = $2 and code = $3 $$;
create or replace function pg_temp.bento_slug() returns text language sql as $$ select slug from public.products where customization_config->>'designer' = 'bento' limit 1 $$;
create or replace function pg_temp.cup_slug() returns text language sql as $$ select slug from public.products where customization_config->>'designer' = 'cupcake' order by slug limit 1 $$;

-- 1. At ₱0 nothing changes ------------------------------------------------------------------------------------------
select pg_temp.check(not exists (select 1 from public.design_options where group_key in ('color', 'font', 'flavor') and code <> 'mix' and price > 0)
  and not exists (select 1 from public.design_options o join public.products p on p.id = o.product_id where p.slug = 'cake-pops' and o.group_key = 'style' and o.price > 0),
  'colors, fonts, flavors and pop shapes all start at ₱0');
select pg_temp.check((public.quote_cakepop_design(pg_temp.pid('cake-pops'), '{"designer":"cakepop","glazes":["pink"]}')->>'extra')::numeric = 0, 'plain cake pop still free');

-- 2. Cake pops: colors (once each), flavors and the pop shape --------------------------------------------------------
select pg_temp.setp('cake-pops', 'color', 'pink', 2), pg_temp.setp('cake-pops', 'flavor', 'vanilla', 4), pg_temp.setp('cake-pops', 'style', 'donut', 5);
select pg_temp.check((public.quote_cakepop_design(pg_temp.pid('cake-pops'), '{"designer":"cakepop","glazes":["pink"]}')->>'extra')::numeric = 2, 'pink coating +₱2');
select pg_temp.check((public.quote_cakepop_design(pg_temp.pid('cake-pops'), '{"designer":"cakepop","pattern":"assorted","glazes":["pink","sky_blue"],"sprinkles":"nonpareils","sprinkle_colors":["pink"]}')->>'extra')::numeric
  = 2 + (select price from public.design_options where product_id = pg_temp.pid('cake-pops') and group_key = 'pattern' and code = 'assorted')
      + (select price from public.design_options where product_id = pg_temp.pid('cake-pops') and group_key = 'sprinkle' and code = 'nonpareils'),
  'pink used twice is charged once');
select pg_temp.check((public.quote_cakepop_design(pg_temp.pid('cake-pops'), '{"designer":"cakepop","style":"donut","flavors":["vanilla"],"glazes":["white"]}')->>'extra')::numeric = 9, 'vanilla +₱4 and donut pops +₱5');
select pg_temp.check((public.quote_cakepop_design(pg_temp.pid('cake-pops'), '{"designer":"cakepop","style":"donut","flavors":["vanilla"],"glazes":["white"]}')->'clean'->'extras')
  @> jsonb_build_array(jsonb_build_object('label', 'Vanilla flavor', 'price', 4), jsonb_build_object('label', (select label from public.design_options where product_id = pg_temp.pid('cake-pops') and group_key = 'style' and code = 'donut'), 'price', 5)),
  'listed in the price breakdown');
select pg_temp.check((private.product_design((select p from public.products p where slug = 'cake-pops'), '{"designer":"cakepop","style":"donut","flavors":["vanilla"],"glazes":["white"]}')->>'extra')::numeric = 9, 'checkout charges the same');

-- 3. Donuts, cupcakes, bento --------------------------------------------------------------------------------------
select pg_temp.setp('product-2', 'color', 'pink', 1.5);
select pg_temp.check((public.quote_donut_design(pg_temp.pid('product-2'), '{"designer":"donut","glazes":["pink"]}')->>'extra')::numeric = 1.5, 'donut glaze color +₱1.50');
select pg_temp.setp(pg_temp.cup_slug(), 'flavor', 'vanilla', 3);
select pg_temp.setp(pg_temp.cup_slug(), 'color', (select code from public.design_options where product_id = pg_temp.pid(pg_temp.cup_slug()) and group_key = 'color' order by sort_order limit 1), 2);
select pg_temp.check((public.quote_cupcake_design(pg_temp.pid(pg_temp.cup_slug()), jsonb_build_object('designer', 'cupcake', 'flavor', 'vanilla', 'finishes', '[]'::jsonb,
  'a', jsonb_build_object('style', 'rosette', 'colors', jsonb_build_array((select code from public.design_options where product_id = pg_temp.pid(pg_temp.cup_slug()) and group_key = 'color' order by sort_order limit 1)))))->>'extra')::numeric
  = 5 + coalesce((select price from public.design_options where product_id = pg_temp.pid(pg_temp.cup_slug()) and group_key = 'style' and code = 'rosette'), 0), 'cupcake flavor +₱3 and color +₱2');
select pg_temp.setp(pg_temp.bento_slug(), 'font', 'great_vibes', 6);
select pg_temp.check((public.quote_bento_design(pg_temp.pid(pg_temp.bento_slug()), '{"designer":"bento","frosting_color":"white","message":"Hi","lettering":"piped","lettering_color":"pink","font":"great_vibes"}')->>'extra')::numeric
   - (public.quote_bento_design(pg_temp.pid(pg_temp.bento_slug()), '{"designer":"bento","frosting_color":"white","message":"Hi","lettering":"piped","lettering_color":"pink","font":"rounded"}')->>'extra')::numeric = 6, 'bento message font +₱6');
rollback;
