-- LOCAL ONLY: acceptance tests for phase20-recipe-inventory.sql (spec tests 1-3, 5-10 + security).
-- Run against a DISPOSABLE database built from tests/local-supabase-stub.sql + phases 2-20, with
-- Admin 00000000-0000-0000-0000-00000000000a and customer ...0c (see RECIPE-INVENTORY.md). Never run on Supabase.
\set ON_ERROR_STOP 1
-- Helpers -------------------------------------------------------------------
create or replace function pg_temp.as_admin() returns void language sql as $$ select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) $$;
create or replace function pg_temp.as_customer() returns void language sql as $$ select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) $$;
create or replace function pg_temp.item(n text) returns uuid language sql as $$ select id from public.inventory_items where lower(name)=lower(n) $$;
create or replace function pg_temp.stock(n text) returns numeric language sql as $$ select private.item_available(pg_temp.item(n)) $$;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$ begin if not coalesce(ok,false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS  %', label; end $$;
create or replace function pg_temp.restock(n text, q numeric) returns void language sql as $$
  select public.inventory_action(jsonb_build_object('action','restock','request_id',gen_random_uuid(),'item_id',pg_temp.item(n),'quantity',q,'expires_on',(current_date+60)::text)) $$;
create or replace function pg_temp.variant(product_slug text, variant_code text) returns uuid language sql as $$ select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.slug=product_slug and v.code=variant_code $$;
create or replace function pg_temp.new_order(items jsonb) returns uuid language plpgsql as $$
declare o jsonb; s uuid; begin
  perform pg_temp.as_customer();
  select id into s from public.availability_slots where starts_at>now() and is_open order by starts_at limit 1;
  o := public.create_order(jsonb_build_object('request_id',gen_random_uuid(),'name','Test Customer','phone','09171234567','fulfillment','pickup','slot_id',s,'payment_method','maribank','items',items));
  perform pg_temp.as_admin();
  return (o->>'id')::uuid;
end $$;
create or replace function pg_temp.pay(o uuid) returns void language plpgsql as $$
declare p uuid; begin
  insert into public.order_payment_attempts(order_id,customer_id,payment_method_id,amount,status,transaction_reference,proof_storage_path,submitted_at)
  select id,customer_id,(select id from public.payment_methods where code='maribank'),deposit_due,'verification_pending','REF'||substr(md5(random()::text),1,10),'proof/'||gen_random_uuid(),now()
  from public.orders where id=o returning id into p;
  update public.orders set payment_status='verification_pending' where id=o;
  perform pg_temp.as_admin();
  perform public.review_order_payment(p,'paid','Seen in MariBank');
end $$;
create or replace function pg_temp.moves(o uuid) returns bigint language sql as $$ select count(*) from public.inventory_movements where order_id=o and movement_type='order_deduction' $$;

-- Setup ---------------------------------------------------------------------
select pg_temp.as_admin();
insert into public.availability_slots(starts_at,ends_at,capacity) select d, d+interval '2 hours', 50 from generate_series(date_trunc('hour',now())+interval '3 days', now()+interval '10 days', interval '1 day') d on conflict do nothing;
select public.save_unit_conversion(jsonb_build_object('item_id',pg_temp.item('Butter'),'unit','g','factor',1/225.0,'verified',true,'note','225 g block'));
select public.save_unit_conversion(jsonb_build_object('item_id',pg_temp.item('Vanilla Extract'),'unit','g','factor',1.25,'verified',true));
select public.set_recipe_status((select id from public.product_recipes where name='Caramel Bar'),'active');
select public.set_recipe_status((select id from public.product_recipes where name like 'Chocolate Chip Cookies — Regular%'),'active');
select pg_temp.restock(n,q) from (values ('All Purpose Flour',2),('Brown Sugar',3000),('White Sugar',3000),('Egg',30),('Butter',6),('Vanilla Extract',500),
  ('Condensed Milk',390),('Powdered Milk',300),('Cashew',450),('Baking Soda',0.5),('Chocolate Chips',1000),('Cupcake Liner 2oz',100),
  ('Box 6pcs 5x6.75x1.5"',10),('Box 12pcs 6x9x1.5"',10),('TY Sticker (Wide)',120),('Box 6pcs 4x4x2"',10),('TY Sticker (Circle)',100)) v(n,q);

-- TEST 1 + 10 + 3 + 7 ---------------------------------------------------------------------------
do $$ declare o uuid; f0 numeric:=pg_temp.stock('All Purpose Flour'); b0 numeric:=pg_temp.stock('Butter'); box0 numeric:=pg_temp.stock('Box 12pcs 6x9x1.5"'); l0 numeric:=pg_temp.stock('Cupcake Liner 2oz'); a record; begin
  o := pg_temp.new_order(jsonb_build_array(jsonb_build_object('variant_id',pg_temp.variant('product-25','option-2'),'qty',1)));
  perform pg_temp.pay(o);
  perform pg_temp.check(pg_temp.moves(o)=0, 'T5 verified payment alone (order still pending) does not deduct');
  perform public.set_order_status(o,'confirmed');
  select * into a from public.order_inventory_allocations where order_id=o;
  perform pg_temp.check(a.status='deducted', 'T1 allocation deducted on confirm + verified payment');
  perform pg_temp.check(f0-pg_temp.stock('All Purpose Flour')=0.090, 'T1 flour 120 g x 12/16 = 90 g (0.090 kg)');
  perform pg_temp.check(b0-pg_temp.stock('Butter')=0.600, 'T1 butter 135 g -> 0.600 pcs via verified conversion');
  perform pg_temp.check(box0-pg_temp.stock('Box 12pcs 6x9x1.5"')=1, 'T10 exactly one 12-pc box');
  perform pg_temp.check(l0-pg_temp.stock('Cupcake Liner 2oz')=12, 'T10 one liner per bar (12)');
  perform pg_temp.check((select bool_and(stock_after=stock_before+quantity_delta and item_id is not null and allocation_id=a.id) from public.inventory_movements where order_id=o), 'T1 every movement has item, before/after and allocation link');
  perform public.set_order_status(o,'confirmed');
  perform private.allocate_order_inventory(o,'retry');
  update public.orders set amount_paid=amount_paid where id=o;
  perform pg_temp.check(pg_temp.moves(o)=(select count(*) from public.inventory_movements where allocation_id=a.id), 'T3 re-confirm / retry / re-save adds no movements');
  perform pg_temp.check((select count(*) from public.order_inventory_allocations where order_id=o)=1, 'T3 one allocation per order');
  perform public.set_order_status(o,'preparing'); perform public.set_order_status(o,'ready'); perform public.set_order_status(o,'completed');
  perform pg_temp.check((public.inventory_history(jsonb_build_object('kind','orders','order_number',(select order_number from public.orders where id=o)))->>'total')::int=pg_temp.moves(o), 'T7 completed order remains in deduction history');
end $$;

-- TEST 2 + 6a ------------------------------------------------------------------------------------
do $$ declare o uuid; f0 numeric:=pg_temp.stock('All Purpose Flour'); d jsonb; begin
  o := pg_temp.new_order(jsonb_build_array(
    jsonb_build_object('variant_id',pg_temp.variant('product-25','option-1'),'qty',1),
    jsonb_build_object('variant_id',pg_temp.variant('product-15','option-2'),'qty',1),
    jsonb_build_object('variant_id',pg_temp.variant('product-9','option-1'),'qty',1)));
  perform public.set_order_status(o,'confirmed'); perform pg_temp.pay(o);
  perform pg_temp.check(f0-pg_temp.stock('All Purpose Flour')=private.round_stock((45+250*12/21.0)/1000), 'T2 flour aggregated across products (45 g + 142.857 g)');
  perform pg_temp.check((select count(*) from public.inventory_movements where order_id=o and item_id=pg_temp.item('All Purpose Flour'))=1, 'T2 one aggregated flour movement');
  d := public.order_inventory_detail(o);
  perform pg_temp.check(d->'allocation'->>'status'='deducted' and jsonb_array_length(d->'allocation'->'untracked')=1, 'T2 product without recipe listed as untracked, rest deducted');
  perform pg_temp.check(d->'allocation'->>'trigger_event'='Payment verified', 'T2 trigger event recorded (payment verified after confirmation)');
  perform public.set_order_status(o,'cancelled');
  perform pg_temp.check((select status from public.order_inventory_allocations where order_id=o)='reversed', 'T6 cancel from confirmed reverses automatically');
  perform pg_temp.check(pg_temp.stock('All Purpose Flour')=f0, 'T6 flour fully restored');
  perform pg_temp.check(pg_temp.moves(o)>0 and (select count(*) from public.inventory_movements where order_id=o and movement_type='order_reversal')>0, 'T6 original deductions kept + new reversal rows');
end $$;

-- TEST 6b ------------------------------------------------------------------------------------------
do $$ declare o uuid; f0 numeric; begin
  o := pg_temp.new_order(jsonb_build_array(jsonb_build_object('variant_id',pg_temp.variant('product-25','option-1'),'qty',1)));
  perform pg_temp.pay(o); perform public.set_order_status(o,'confirmed'); f0 := pg_temp.stock('All Purpose Flour');
  perform public.set_order_status(o,'preparing'); perform public.set_order_status(o,'cancelled');
  perform pg_temp.check((select status from public.order_inventory_allocations where order_id=o)='consumed' and pg_temp.stock('All Purpose Flour')=f0, 'T6 cancel during production keeps materials consumed');
  begin perform public.reverse_order_inventory(o,''); raise exception 'no'; exception when others then perform pg_temp.check(sqlerrm like '%reason%', 'T6 manual reversal requires a reason'); end;
  perform public.reverse_order_inventory(o,'Dough not started, stock unused');
  perform pg_temp.check((select status from public.order_inventory_allocations where order_id=o)='reversed' and pg_temp.stock('All Purpose Flour')>f0, 'T6 authorized reversal restores stock');
end $$;

-- TEST 5 -------------------------------------------------------------------------------------------
do $$ declare o uuid; begin
  o := pg_temp.new_order(jsonb_build_array(jsonb_build_object('variant_id',pg_temp.variant('product-25','option-1'),'qty',1)));
  update public.orders set payment_status='verification_pending' where id=o;
  perform public.set_order_status(o,'confirmed');
  perform pg_temp.check(pg_temp.moves(o)=0 and not exists(select 1 from public.order_inventory_allocations where order_id=o), 'T5 confirmed order with unverified proof deducts nothing');
end $$;

-- TEST 8 -------------------------------------------------------------------------------------------
do $$ declare before_lines jsonb; r public.product_recipes; cur public.product_recipes; begin
  select * into cur from public.product_recipes where name='Caramel Bar' and status='active';
  select jsonb_agg(to_jsonb(l) order by id) into before_lines from public.order_inventory_allocation_lines l where recipe_id=cur.id;
  r := public.save_recipe(jsonb_build_object('recipe_key',cur.recipe_key,'product_id',cur.product_id,'name',cur.name,'batch_yield',8,'activate',true,
       'variant_units',(select jsonb_agg(jsonb_build_object('variant_id',variant_id,'units',units)) from public.recipe_variant_units where recipe_id=cur.id),
       'lines',(select jsonb_agg(jsonb_build_object('item_id',item_id,'quantity',quantity,'unit',unit,'line_group',line_group,'basis',basis,'condition',condition)) from public.recipe_lines where recipe_id=cur.id)));
  perform pg_temp.check(r.version=cur.version+1 and r.status='active' and (select status from public.product_recipes where id=cur.id)='archived', 'T8 edit creates v2 and archives v1');
  perform pg_temp.check(before_lines is not null and before_lines=(select jsonb_agg(to_jsonb(l) order by id) from public.order_inventory_allocation_lines l where recipe_id=cur.id), 'T8 historical allocation lines unchanged');
end $$;

-- TEST 9 -------------------------------------------------------------------------------------------
do $$ declare o uuid; n0 bigint; ok boolean := false; det text; begin
  o := pg_temp.new_order(jsonb_build_array(jsonb_build_object('variant_id',pg_temp.variant('product-15','option-3'),'qty',20)));
  perform pg_temp.pay(o); n0 := (select count(*) from public.inventory_movements);
  begin perform public.set_order_status(o,'confirmed');
  exception when sqlstate 'LX409' then ok := true; get stacked diagnostics det = pg_exception_detail; raise notice 'shortage: % | %', sqlerrm, det; end;
  perform pg_temp.check(ok, 'T9 confirm raises INSUFFICIENT MATERIALS');
  perform pg_temp.check((select status from public.orders where id=o)='pending', 'T9 order stays pending');
  perform pg_temp.check((select count(*) from public.inventory_movements)=n0, 'T9 nothing deducted (all-or-nothing)');
  perform pg_temp.check(not exists(select 1 from public.order_inventory_allocations where order_id=o), 'T9 no allocation row left behind');
end $$;

-- TEST 9b: payment approved on an already-confirmed order with a shortage ------------------------
do $$ declare o uuid; begin
  o := pg_temp.new_order(jsonb_build_array(jsonb_build_object('variant_id',pg_temp.variant('product-15','option-3'),'qty',20)));
  perform public.set_order_status(o,'confirmed'); perform pg_temp.pay(o);
  perform pg_temp.check((select payment_status from public.orders where id=o)='partially_paid' and (select status from public.order_inventory_allocations where order_id=o)='shortage', 'T9 payment approval kept, allocation flagged as shortage');
  begin perform public.set_order_status(o,'preparing'); raise exception 'no'; exception when sqlstate 'LX409' then perform pg_temp.check(true, 'T9 production cannot start while materials are short'); end;
  perform pg_temp.restock('Chocolate Chips',2000); perform pg_temp.restock('All Purpose Flour',8); perform pg_temp.restock('Butter',20); perform pg_temp.restock('Egg',30); perform pg_temp.restock('Brown Sugar',3000); perform pg_temp.restock('White Sugar',3000); perform pg_temp.restock('TY Sticker (Circle)',10); perform pg_temp.restock('Vanilla Extract',100); perform pg_temp.restock('Baking Soda',0.5);
  perform public.allocate_order_inventory(o);
  perform pg_temp.check((select status from public.order_inventory_allocations where order_id=o)='deducted', 'T9 Admin retry after restock deducts');
end $$;

-- Extras + manual adjustments ----------------------------------------------------------------------
do $$ declare o uuid := (select order_id from public.order_inventory_allocations where status='deducted' order by created_at desc limit 1); s0 numeric := pg_temp.stock('Chocolate Chips'); rq uuid := gen_random_uuid(); begin
  perform public.record_order_extra_material(jsonb_build_object('order_id',o,'item_id',pg_temp.item('Chocolate Chips'),'quantity',20,'unit','g','note','Extra chips requested','request_id',rq));
  perform public.record_order_extra_material(jsonb_build_object('order_id',o,'item_id',pg_temp.item('Chocolate Chips'),'quantity',20,'unit','g','note','Extra chips requested','request_id',rq));
  perform pg_temp.check(s0-pg_temp.stock('Chocolate Chips')=20, 'Extra material recorded once per request id');
  begin perform public.adjust_inventory_item(jsonb_build_object('item_id',pg_temp.item('Egg'),'direction','decrease','quantity',1,'note','','request_id',gen_random_uuid())); raise exception 'no';
  exception when others then perform pg_temp.check(sqlerrm like '%reason%', 'Manual adjustment requires a reason'); end;
  perform public.adjust_inventory_item(jsonb_build_object('item_id',pg_temp.item('Egg'),'direction','decrease','kind','wastage','quantity',2,'note','Cracked in delivery','request_id',gen_random_uuid()));
  perform pg_temp.check(exists(select 1 from public.inventory_movements where movement_type='waste' and note='Cracked in delivery'), 'Wastage recorded as its own movement type');
  perform public.adjust_inventory_item(jsonb_build_object('item_id',pg_temp.item('Egg'),'direction','increase','quantity',1,'note','Recount found one more','request_id',gen_random_uuid()));
  perform pg_temp.check(exists(select 1 from public.inventory_movements where movement_type='adjustment_positive' and note='Recount found one more'), 'Positive adjustment recorded');
  perform pg_temp.check((public.inventory_history('{"kind":"wastage"}')->>'total')::int>=1 and (public.inventory_history('{"kind":"reversals"}')->>'total')::int>=1, 'History filters by movement kind');
  perform pg_temp.check(jsonb_array_length(public.inventory_overview()->'items')>50, 'Inventory overview returns items');
  perform pg_temp.check(public.inventory_item_detail(pg_temp.item('Egg'))->'item'->>'name'='Egg', 'Item detail loads');
  perform pg_temp.check((select count(*) from jsonb_array_elements(public.recipe_catalog()->'recipes') r where r->>'source'<>'Previous live recipe tables')=15, 'Recipe catalog lists 14 imports + 1 new version');
  perform pg_temp.check(jsonb_array_length(public.preview_recipe((select id from public.product_recipes where name='Caramel Bar' and status='active'),12))=12, 'Recipe preview returns every line');
end $$;

-- Immutability + security ---------------------------------------------------------------------------
do $$ begin
  begin update public.inventory_movements set note='x' where true; raise exception 'no'; exception when others then perform pg_temp.check(sqlerrm like '%permanent%', 'Ledger rows cannot be edited'); end;
  begin perform public.set_recipe_status((select id from public.product_recipes where name like 'Premium Mini Donuts — Premium%'),'active'); raise exception 'no';
  exception when others then perform pg_temp.check(sqlerrm like 'Resolve flagged lines%', 'Flagged spreadsheet recipe cannot be activated unreviewed'); end;
end $$;
select pg_temp.as_customer();
set role authenticated;
do $$ begin
  begin perform public.allocate_order_inventory((select id from public.orders limit 1)); raise exception 'no'; exception when others then perform pg_temp.check(sqlstate='42501', 'Customer cannot call allocation RPC'); end;
  begin perform public.adjust_inventory_item('{}'); raise exception 'no'; exception when others then perform pg_temp.check(sqlstate='42501', 'Customer cannot adjust inventory'); end;
  perform pg_temp.check((select count(*) from public.product_recipes)=0 and (select count(*) from public.order_inventory_allocations)=0, 'Customer RLS sees no recipes/allocations');
  begin insert into public.inventory_movements(batch_id,quantity_delta,reason,movement_type,created_by,request_id) values(gen_random_uuid(),1,'receipt','restock',auth.uid(),gen_random_uuid()); raise exception 'no';
  exception when others then perform pg_temp.check(sqlstate='42501', 'Customer cannot insert ledger rows'); end;
end $$;
reset role;
select pg_temp.check((select count(*) from public.inventory_batch_stock where remaining_quantity<0)=0, 'No batch is ever negative');
