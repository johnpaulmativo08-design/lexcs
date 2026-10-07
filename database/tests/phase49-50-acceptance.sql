-- Acceptance tests for phase 49 (batch corrections), phase 50 (customization limits) and the Product → Recipe →
-- Inventory deduction flow that Products → Edit → Recipe now drives. Safe on the live database: everything happens
-- inside this transaction and is ROLLED BACK. Results arrive as an error message on purpose (the error undoes it).
-- Uses the real RPCs: save_product, save_recipe, correct_inventory_batch, quote_*_design and the order trigger.
begin;
create temp table r(n serial, result text);
create temp table t(k text primary key, v text);
grant all on r, t to authenticated; grant usage on sequence r_n_seq to authenticated;
create or replace function pg_temp.ok(pass boolean, label text) returns void language sql as $$
  insert into r(result) values ((case when coalesce(pass, false) then 'PASS: ' else 'FAIL: ' end) || label) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return 'ERR ' || sqlerrm; end $$;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t where k = key $$;
grant execute on all functions in schema pg_temp to authenticated;

-- act as an Admin
insert into t select 'admin', id::text from public.profiles where role = 'admin' order by created_at limit 1;
select set_config('request.jwt.claim.sub', pg_temp.v('admin'), true),
       set_config('request.jwt.claims', json_build_object('sub', pg_temp.v('admin'), 'role', 'authenticated')::text, true);

-- ===================================================================== phase 49: batch corrections
insert into t select 'batch', b.batch_id::text from public.inventory_batch_stock b
  where b.archived_at is null and b.remaining_quantity > 0 and b.quantity_received > 0 order by b.remaining_quantity desc limit 1;
insert into t select 'b_recv', quantity_received::text from public.inventory_batches where id = pg_temp.v('batch')::uuid;
insert into t select 'b_left', remaining_quantity::text from public.inventory_batch_stock where batch_id = pg_temp.v('batch')::uuid;
insert into t select 'b_item', item_id::text from public.inventory_batches where id = pg_temp.v('batch')::uuid;
insert into t select 'item_avail', private.item_available(pg_temp.v('b_item')::uuid)::text;
insert into t select 'moves', count(*)::text from public.inventory_movements where batch_id = pg_temp.v('batch')::uuid;
insert into t values ('req1', gen_random_uuid()::text);
set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.correct_inventory_batch(%L)', jsonb_build_object('batch_id', pg_temp.v('batch'),
  'quantity_received', pg_temp.v('b_recv')::numeric + 1, 'reason', 'Supplier receipt says one more', 'request_id', pg_temp.v('req1'))::text)) = 'ok', 'raising a batch quantity by 1 is accepted');
reset role;
select pg_temp.ok((select remaining_quantity from public.inventory_batch_stock where batch_id = pg_temp.v('batch')::uuid) = pg_temp.v('b_left')::numeric + 1, 'the batch remainder goes up by exactly 1');
select pg_temp.ok(private.item_available(pg_temp.v('b_item')::uuid) = pg_temp.v('item_avail')::numeric + 1, 'the material total goes up by exactly 1');
select pg_temp.ok((select count(*) from public.inventory_movements where batch_id = pg_temp.v('batch')::uuid) = pg_temp.v('moves')::int + 1
  and exists (select 1 from public.inventory_movements where batch_id = pg_temp.v('batch')::uuid and reference = 'batch_correction' and quantity_delta = 1
    and movement_type = 'adjustment_positive' and note like 'Batch correction %→% (+1 %'), 'one "Batch correction" movement of +1 is in the history');
select pg_temp.ok((select stock_after - stock_before from public.inventory_movements where request_id = pg_temp.v('req1')::uuid) = 1, 'the movement records stock before → after');
select pg_temp.ok((select quantity_received from public.inventory_batches where id = pg_temp.v('batch')::uuid) = pg_temp.v('b_recv')::numeric + 1, 'the batch now says the corrected quantity received');
set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.correct_inventory_batch(%L)', jsonb_build_object('batch_id', pg_temp.v('batch'),
  'quantity_received', pg_temp.v('b_recv')::numeric + 1, 'reason', 'Supplier receipt says one more', 'request_id', pg_temp.v('req1'))::text)) = 'ok'
  and (select count(*) from public.inventory_movements where batch_id = pg_temp.v('batch')::uuid) = pg_temp.v('moves')::int + 1, 'repeating the same request does not record it twice');
select pg_temp.ok(pg_temp.err(format('select public.correct_inventory_batch(%L)', jsonb_build_object('batch_id', pg_temp.v('batch'),
  'quantity_received', 0, 'reason', 'test', 'request_id', gen_random_uuid())::text)) like 'ERR%already been used%'
  or (select quantity_received from public.inventory_batches where id = pg_temp.v('batch')::uuid) = (select remaining_quantity from public.inventory_batch_stock where batch_id = pg_temp.v('batch')::uuid),
  'it cannot go below what the batch has already used');
select pg_temp.ok(pg_temp.err(format('select public.correct_inventory_batch(%L)', jsonb_build_object('batch_id', pg_temp.v('batch'),
  'stock_in_date', '2026-01-10', 'expires_on', '2025-12-01', 'reason', 'test', 'request_id', gen_random_uuid())::text)) like 'ERR%cannot be before the stock-in date%', 'expiry before stock-in is rejected');
select pg_temp.ok(pg_temp.err(format('select public.correct_inventory_batch(%L)', jsonb_build_object('batch_id', pg_temp.v('batch'),
  'stock_in_date', (now() at time zone 'Asia/Manila')::date + 3, 'reason', 'test', 'request_id', gen_random_uuid())::text)) like 'ERR%future%', 'a future stock-in date is rejected');
select pg_temp.ok(pg_temp.err(format('select public.correct_inventory_batch(%L)', jsonb_build_object('batch_id', pg_temp.v('batch'),
  'purchase_price', 123.45, 'reason', 'Price typo', 'request_id', gen_random_uuid())::text)) = 'ok', 'a price-only correction is accepted');
reset role;
select pg_temp.ok((select count(*) from public.inventory_movements where batch_id = pg_temp.v('batch')::uuid) = pg_temp.v('moves')::int + 1
  and (select purchase_price from public.inventory_batches where id = pg_temp.v('batch')::uuid) = 123.45
  and (select notes from public.inventory_batches where id = pg_temp.v('batch')::uuid) like '%Corrected price%Price typo%', 'a price-only correction adds no stock movement and is noted on the batch');

-- ===================================================================== Product → Recipe → Inventory deduction
-- two real materials with stock, used in their own stock unit (no conversion needed)
insert into t select 'm' || row_number() over (order by s.available desc), s.id::text from (
  select i.id, private.item_available(i.id) as available from public.inventory_items i
  where not i.is_archived and i.unit in ('g','kg','pcs','mL','L') order by private.item_available(i.id) desc limit 2) s;
insert into t select 'm1_avail', private.item_available(pg_temp.v('m1')::uuid)::text;
insert into t select 'm2_avail', private.item_available(pg_temp.v('m2')::uuid)::text;
insert into t select 'm1_unit', unit from public.inventory_items where id = pg_temp.v('m1')::uuid;
insert into t select 'm2_unit', unit from public.inventory_items where id = pg_temp.v('m2')::uuid;
insert into t values ('prod', gen_random_uuid()::text), ('v6', gen_random_uuid()::text), ('v12', gen_random_uuid()::text);
set local role authenticated;
select pg_temp.ok(pg_temp.err(format('select public.save_product(%L)', jsonb_build_object('id', pg_temp.v('prod'), 'name', 'Acceptance Test Brownies', 'description', '',
  'category_id', null, 'kind', 'standard', 'slug', 'product-' || pg_temp.v('prod'), 'image_path', null, 'package_contents', null,
  'variants', jsonb_build_array(jsonb_build_object('id', pg_temp.v('v6'), 'code', 'option-6', 'label', '6 pcs', 'price', 150, 'is_active', true, 'sort_order', 0),
                                jsonb_build_object('id', pg_temp.v('v12'), 'code', 'option-12', 'label', '12 pcs', 'price', 280, 'is_active', true, 'sort_order', 1))))::text)) = 'ok',
  'Add Product with two sizes saves');
-- recipe: one batch makes 6 pieces; material 1 = 0.1% of its stock per batch, material 2 = 0.001 per piece
insert into t select 'q1', round(least(pg_temp.v('m1_avail')::numeric / 1000, 5), 3)::text;
select pg_temp.ok(pg_temp.err(format('select public.save_recipe(%L)', jsonb_build_object('product_id', pg_temp.v('prod'), 'name', 'Acceptance Test Brownies',
  'batch_yield', 6, 'yield_unit', 'pcs', 'scaling_mode', 'proportional', 'activate', true,
  'variant_units', jsonb_build_array(jsonb_build_object('variant_id', pg_temp.v('v6'), 'units', 6), jsonb_build_object('variant_id', pg_temp.v('v12'), 'units', 12)),
  'lines', jsonb_build_array(
    jsonb_build_object('item_id', pg_temp.v('m1'), 'quantity', pg_temp.v('q1')::numeric, 'unit', pg_temp.v('m1_unit'), 'basis', 'per_batch', 'line_group', 'ingredient'),
    jsonb_build_object('item_id', pg_temp.v('m2'), 'quantity', 0.001, 'unit', pg_temp.v('m2_unit'), 'basis', 'per_unit', 'line_group', 'ingredient'))))::text)) = 'ok',
  'the recipe saves and activates for the new product');
reset role;
select pg_temp.ok((select count(*) from public.product_recipes where product_id = pg_temp.v('prod')::uuid and status = 'active') = 1, 'the product has exactly one active recipe');

-- a confirmed, downpayment-paid order for one 12 pcs box (copied from a recent order; nothing is kept)
set local session_replication_role = replica;
do $$
declare src uuid; new_id uuid := gen_random_uuid(); cols text; it public.order_items;
begin
  select o.id into src from public.orders o where o.status <> 'cancelled' and o.total_amount is not null
    and exists (select 1 from public.order_items i where i.order_id = o.id) order by o.created_at desc limit 1;
  create temp table src_order as select * from public.orders where id = src;
  update src_order set id = new_id, order_number = 999999049, client_request_id = gen_random_uuid(), created_at = now(), status = 'pending', payment_status = 'unpaid', amount_paid = 0;
  select string_agg(quote_ident(attname), ',' order by attnum) into cols from pg_attribute where attrelid = 'public.orders'::regclass and attnum > 0 and not attisdropped and attgenerated = '';
  execute format('insert into public.orders(%s) overriding system value select %s from src_order', cols, cols);
  create temp table src_item as select * from public.order_items where order_id = src order by line_number limit 1;
  update src_item set order_id = new_id, line_number = 1, product_id = (select v::uuid from t where k = 'prod'), variant_id = (select v::uuid from t where k = 'v12'),
    quantity = 1, name_snapshot = 'Acceptance Test Brownies', variant_label_snapshot = '12 pcs', customization = null, reference_image_path = null;
  select string_agg(quote_ident(attname), ',' order by attnum) into cols from pg_attribute where attrelid = 'public.order_items'::regclass and attnum > 0 and not attisdropped and attgenerated = '' and attname <> 'id';
  execute format('insert into public.order_items(%s) overriding system value select %s from src_item', cols, cols);
  insert into t values ('order', new_id::text);
end $$;
set local session_replication_role = origin;
-- the real deduction trigger: order confirmed + downpayment verified
update public.orders set status = 'confirmed', payment_status = 'partially_paid', amount_paid = deposit_due where id = pg_temp.v('order')::uuid;
select pg_temp.ok((select status from public.order_inventory_allocations where order_id = pg_temp.v('order')::uuid) = 'deducted', 'confirming the paid order deducts inventory');
-- 12 pieces = 2 batches → material 1: 2 × q1 ; material 2: 12 × 0.001
select pg_temp.ok(pg_temp.v('m1_avail')::numeric - private.item_available(pg_temp.v('m1')::uuid) = round(2 * pg_temp.v('q1')::numeric, 3), 'material 1 is deducted 2 batches × the recipe amount (12 pcs size)');
select pg_temp.ok(round(pg_temp.v('m2_avail')::numeric - private.item_available(pg_temp.v('m2')::uuid), 3) = 0.012, 'material 2 is deducted 12 pieces × 0.001');
select pg_temp.ok((select count(*) from public.inventory_movements where order_id = pg_temp.v('order')::uuid and movement_type = 'order_deduction') >= 2, 'the deduction appears in the inventory history as Order deduction');

-- ===================================================================== phase 50: customization limits
insert into t select 'bento', id::text from public.products where customization_config->>'designer' = 'bento' and status = 'active' limit 1;
insert into t select 'donut', id::text from public.products where customization_config->>'designer' = 'donut' and status = 'active' limit 1;
insert into t select 'cupcake', id::text from public.products where customization_config->>'designer' = 'cupcake' and status = 'active' limit 1;
-- bento: take a design the designer accepts and only change the message
create or replace function pg_temp.bento(msg text) returns text language plpgsql as $$
declare d jsonb := jsonb_build_object('designer', 'bento', 'frosting_color', (select code from public.design_options where product_id = pg_temp.v('bento')::uuid and group_key = 'color' and is_active order by sort_order limit 1),
  'border', '[]'::jsonb, 'accents', '[]'::jsonb, 'message', msg, 'lettering', 'piped', 'lettering_color', (select code from public.design_options where product_id = pg_temp.v('bento')::uuid and group_key = 'color' and is_active order by sort_order desc limit 1), 'topper', 'none');
begin perform public.quote_bento_design(pg_temp.v('bento')::uuid, d); return 'ok'; exception when others then return 'ERR ' || sqlerrm; end $$;
select pg_temp.ok(pg_temp.bento('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty') = 'ok', 'bento: 20 words are accepted');
select pg_temp.ok(pg_temp.bento('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty more') like 'ERR%within 20 words%', 'bento: 21 words are rejected');
select pg_temp.ok(pg_temp.bento('Happy     Birthday   Mika') = 'ok', 'bento: extra spaces do not count as words');
-- donuts: letters per donut
create or replace function pg_temp.donut(extra jsonb) returns jsonb language plpgsql as $$
begin return public.quote_donut_design(pg_temp.v('donut')::uuid, jsonb_build_object('designer', 'donut', 'flavors', '["vanilla"]'::jsonb, 'pattern', 'same', 'glazes', '["pink"]'::jsonb,
  'finishes', '[]'::jsonb, 'sprinkles', 'none', 'theme', 'none', 'message', 'letters', 'message_color', 'white') || extra);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
select pg_temp.ok((pg_temp.donut('{"message_pieces":["LOVE","MOM","","JANE"]}')->'clean'->'message_pieces') = '["LOVE","MOM","","JANE"]'::jsonb, 'donut: 1–5 letters on each donut are accepted and kept per donut');
select pg_temp.ok(pg_temp.donut('{"message_pieces":["HELLOO"]}')->>'error' like 'Donut 1: use 1–5 letters%', 'donut: 6 letters on one donut are rejected');
select pg_temp.ok(pg_temp.donut('{"message_pieces":["",""]}')->>'error' like 'Add letters to at least one donut%', 'donut: letters chosen but none typed is rejected');
select pg_temp.ok(pg_temp.donut('{"message_text":"happy birthday"}')->'clean'->>'message_text' = 'happy birthday', 'donut: designs saved before (one sentence) still price');
-- cupcakes: optional letters per cupcake
create or replace function pg_temp.cupcake(extra jsonb) returns jsonb language plpgsql as $$
begin return public.quote_cupcake_design(pg_temp.v('cupcake')::uuid, jsonb_build_object('designer', 'cupcake', 'flavor', 'chocolate', 'pattern', 'same',
  'a', jsonb_build_object('style', 'rosette', 'colors', '["baby_pink"]'::jsonb), 'finishes', '[]'::jsonb, 'theme', 'none') || extra);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
select pg_temp.ok(pg_temp.cupcake('{}') ? 'clean', 'cupcake: designs without letters still price');
select pg_temp.ok(pg_temp.cupcake('{"message":"letters","message_pieces":["LOVE","JOHN","MOM","HI","JANE","BEST"],"message_color":"white"}')->'clean'->>'summary' like '%Fondant letters "LOVE · JOHN · MOM · HI · JANE · BEST"%', 'cupcake: a word on each cupcake is accepted and shown in the summary');
select pg_temp.ok(pg_temp.cupcake('{"message":"letters","message_pieces":["LOVE","HAPPYB"],"message_color":"white"}')->>'error' like 'Cupcake 2: use 1–5 letters%', 'cupcake: 6 letters on one cupcake are rejected');

do $$ begin
  raise exception E'PHASE 49-50 TESTS (all changes rolled back): % failed\n%', (select count(*) from r where result like 'FAIL%'),
    (select string_agg(result, E'\n' order by n) from r);
end $$;
